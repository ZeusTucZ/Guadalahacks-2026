from __future__ import annotations

import os
import re
import time
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

try:
    from .index import COLLECTION_NAME, EMBEDDING_MODEL, _cliente_chroma
    from .prompts import SYSTEM_GUARDRAILS, prompt_chat, prompt_pregunta, prompt_resumen
except ImportError:
    from index import COLLECTION_NAME, EMBEDDING_MODEL, _cliente_chroma
    from prompts import SYSTEM_GUARDRAILS, prompt_chat, prompt_pregunta, prompt_resumen


LLM_MODEL = os.getenv("MINUTERO_LLM_MODEL", "minutero")
LLM_KEEP_ALIVE = os.getenv("MINUTERO_KEEP_ALIVE", "30m")
LLM_NUM_CTX = int(os.getenv("MINUTERO_NUM_CTX", "4096"))
LLM_NUM_PREDICT = int(os.getenv("MINUTERO_NUM_PREDICT", "512"))
LLM_TEMPERATURE = float(os.getenv("MINUTERO_TEMPERATURE", "0.1"))
LLM_TOP_P = float(os.getenv("MINUTERO_TOP_P", "0.85"))
TOP_K = 3
MAX_CHAT_TURNS = 8
MAX_CHAT_CHARS = 1200
OPT_CHAT_MESSAGES = 6
OPT_USER_CHARS = 600
OPT_ASSISTANT_CHARS = 300
TASK_NUM_PREDICT = {
    "/chat": 300,
    "/preguntar": 220,
    "/resumir": 450,
    "/calentar": 2,
}


def approx_tokens(text: str) -> int:
    return len(text or "") // 4


def _metric_key(key: str) -> str:
    return key.replace("_tokens_aprox", "_tokens~")


def _metric_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, float):
        return f"{value:.2f}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_metric_value(item) for item in value) + "]"
    text = str(value).replace("\n", "\\n")
    if " " in text:
        return repr(text)
    return text


def log_metric(event_name: str, data: dict[str, Any]) -> None:
    payload = {"timestamp": datetime.now(timezone.utc).isoformat(), **data}
    fields = " ".join(
        f"{_metric_key(key)}={_metric_value(value)}" for key, value in payload.items()
    )
    print(f"[TOKEN_BASELINE][{event_name}] {fields}", flush=True)


def log_optimized(event_name: str, data: dict[str, Any]) -> None:
    payload = {"timestamp": datetime.now(timezone.utc).isoformat(), **data}
    fields = " ".join(
        f"{_metric_key(key)}={_metric_value(value)}" for key, value in payload.items()
    )
    print(f"[TOKEN_OPTIMIZED][{event_name}] {fields}", flush=True)


@dataclass
class ChatMemory:
    nombre: str | None = None
    edad: str | None = None
    altura: str | None = None


def _opciones_generacion(num_predict: int | None = None) -> dict[str, float | int]:
    return {
        "temperature": LLM_TEMPERATURE,
        "top_p": LLM_TOP_P,
        "num_ctx": LLM_NUM_CTX,
        "num_predict": num_predict or LLM_NUM_PREDICT,
    }


def _num_predict_para_task(task: str) -> int | None:
    return TASK_NUM_PREDICT.get(task)


def _embedding(texto: str) -> list[float]:
    import ollama

    respuesta: dict[str, Any] = ollama.embeddings(model=EMBEDDING_MODEL, prompt=texto)
    embedding = getattr(respuesta, "embedding", None)
    if embedding is None and isinstance(respuesta, dict):
        embedding = respuesta.get("embedding")
    if embedding is None:
        raise RuntimeError("Ollama no devolvio embedding.")
    return embedding


def recuperar_chunks(pregunta: str, task: str = "RAG", top_k: int | None = None) -> list[str]:
    cliente = _cliente_chroma()
    coleccion = cliente.get_or_create_collection(name=COLLECTION_NAME)
    effective_top_k = top_k or TOP_K

    total = coleccion.count()
    if total == 0:
        log_metric(
            "RAG",
            {
                "task": task,
                "pregunta_chars": len(pregunta),
                "pregunta_tokens_aprox": approx_tokens(pregunta),
                "top_k": effective_top_k,
                "chunks": 0,
                "rag_chars": 0,
                "rag_tokens_aprox": 0,
                "embedding_ms": 0,
                "search_ms": 0,
                "collection_chunks": 0,
            },
        )
        log_optimized(
            "RAG",
            {
                "task": task,
                "top_k": effective_top_k,
                "chunks_recuperados": 0,
                "rag_chars": 0,
                "rag_tokens_aprox": 0,
                "embedding_ms": 0,
                "search_ms": 0,
            },
        )
        return []

    embedding_start = time.perf_counter()
    pregunta_embedding = _embedding(pregunta)
    embedding_ms = (time.perf_counter() - embedding_start) * 1000

    search_start = time.perf_counter()
    resultado = coleccion.query(
        query_embeddings=[pregunta_embedding],
        n_results=min(effective_top_k, total),
        include=["documents", "distances"],
    )
    search_ms = (time.perf_counter() - search_start) * 1000

    documentos = resultado.get("documents", [[]])
    chunks = documentos[0] if documentos else []
    rag_text = "\n---\n".join(chunks)
    distances = resultado.get("distances", [[]])
    distance_values = distances[0] if distances else []
    log_metric(
        "RAG",
        {
            "task": task,
            "pregunta_chars": len(pregunta),
            "pregunta_tokens_aprox": approx_tokens(pregunta),
            "top_k": effective_top_k,
            "n_results": min(effective_top_k, total),
            "chunks": len(chunks),
            "rag_chars": len(rag_text),
            "rag_tokens_aprox": approx_tokens(rag_text),
            "embedding_ms": round(embedding_ms, 2),
            "search_ms": round(search_ms, 2),
            "collection_chunks": total,
            "distances": [round(float(value), 4) for value in distance_values],
        },
    )
    log_optimized(
        "RAG",
        {
            "task": task,
            "top_k": effective_top_k,
            "chunks_recuperados": len(chunks),
            "rag_chars": len(rag_text),
            "rag_tokens_aprox": approx_tokens(rag_text),
            "embedding_ms": round(embedding_ms, 2),
            "search_ms": round(search_ms, 2),
        },
    )
    return chunks


def _normalizar_historial_baseline(historial: list[dict[str, str]]) -> list[dict[str, str]]:
    historial_limpio: list[dict[str, str]] = []

    for turno in historial[-MAX_CHAT_TURNS:]:
        rol = str(turno.get("role", "")).strip().lower()
        contenido = str(turno.get("content", "")).strip()
        if rol not in {"user", "assistant"} or not contenido:
            continue
        historial_limpio.append(
            {
                "role": rol,
                "content": contenido[:MAX_CHAT_CHARS],
            }
        )

    return historial_limpio


def _normalizar_historial(historial: list[dict[str, str]]) -> list[dict[str, str]]:
    historial_limpio: list[dict[str, str]] = []

    for turno in historial[-OPT_CHAT_MESSAGES:]:
        rol = str(turno.get("role", "")).strip().lower()
        contenido = str(turno.get("content", "")).strip()
        if rol not in {"user", "assistant"} or not contenido:
            continue
        limite = OPT_USER_CHARS if rol == "user" else OPT_ASSISTANT_CHARS
        historial_limpio.append(
            {
                "role": rol,
                "content": contenido[:limite],
            }
        )

    return historial_limpio


def _formatear_historial(historial: list[dict[str, str]]) -> str:
    historial_limpio = _normalizar_historial(historial)
    if not historial_limpio:
        return "Sin historial previo."

    etiquetas = {
        "user": "Usuario (evidencia del chat)",
        "assistant": "Lux (respuesta previa; no usar como evidencia factual)",
    }
    return "\n".join(
        f"{etiquetas[turno['role']]}: {turno['content']}" for turno in historial_limpio
    )


def _consulta_para_retrieval(mensaje: str, historial: list[dict[str, str]]) -> str:
    historial_limpio = _normalizar_historial(historial)
    ultimos_usuarios = [
        turno["content"] for turno in historial_limpio if turno["role"] == "user"
    ][-3:]
    return " ".join([*ultimos_usuarios, mensaje]).strip()


def _normalizar_texto(texto: str) -> str:
    normalizado = unicodedata.normalize("NFD", texto.lower())
    return "".join(
        caracter
        for caracter in normalizado
        if unicodedata.category(caracter) != "Mn"
    ).strip()


def _texto_rag(chunks: list[str]) -> str:
    return "\n---\n".join(chunks)


def _tokens_dedup(texto: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{4,}", _normalizar_texto(texto)))


def _deduplicar_chunks_rag(chunks: list[str], task: str) -> list[str]:
    """Deduplicacion conservadora para no mandar overlap repetido al prompt."""
    before_text = _texto_rag(chunks)
    deduped: list[str] = []
    normalized_kept: list[str] = []
    token_sets: list[set[str]] = []

    for chunk in chunks:
        normalized = re.sub(r"\s+", " ", _normalizar_texto(chunk)).strip()
        words = _tokens_dedup(chunk)
        duplicate = False

        for kept_normalized, kept_words in zip(normalized_kept, token_sets):
            contained = (
                len(normalized) > 80
                and len(kept_normalized) > 80
                and (normalized in kept_normalized or kept_normalized in normalized)
            )
            union = words | kept_words
            similarity = (len(words & kept_words) / len(union)) if union else 0.0
            too_similar = len(words) >= 20 and len(kept_words) >= 20 and similarity >= 0.92
            if contained or too_similar:
                duplicate = True
                break

        if not duplicate:
            deduped.append(chunk)
            normalized_kept.append(normalized)
            token_sets.append(words)

    after_text = _texto_rag(deduped)
    log_optimized(
        "RAG_DEDUP",
        {
            "task": task,
            "chunks_before": len(chunks),
            "chunks_after": len(deduped),
            "chars_before": len(before_text),
            "chars_after": len(after_text),
            "tokens_before_aprox": approx_tokens(before_text),
            "tokens_after_aprox": approx_tokens(after_text),
        },
    )
    return deduped


def _estado_tecnico() -> str:
    return (
        f"LLM activo: {LLM_MODEL}. "
        "LLM por defecto si no se define MINUTERO_LLM_MODEL: minutero. "
        "Modelo base del Modelfile minutero: gemma4:e4b. "
        f"Modelo de embeddings: {EMBEDDING_MODEL}. "
        "La aplicacion usa Ollama local, ChromaDB local y no consulta internet."
    )


def _es_pregunta_configuracion(mensaje: str) -> bool:
    texto = _normalizar_texto(mensaje)
    if re.search(r"\b(que es|que significa|define|explica)\b", texto):
        return False

    patrones = [
        r"\bmodelo\b",
        r"\bollama\b",
        r"\bembedding",
        r"\bapi\b",
        r"\binternet\b",
        r"\bnube\b",
        r"de donde obtienes",
        r"de donde sacas",
        r"fuente",
        r"que estamos usando",
        r"cual estamos usando",
        r"\bllm\b.*\b(usando|utilizando|activo|actual)\b",
        r"\b(usando|utilizando|activo|actual)\b.*\bllm\b",
    ]
    return any(re.search(patron, texto) for patron in patrones)


def _respuesta_configuracion(mensaje: str) -> str | None:
    texto = _normalizar_texto(mensaje)

    if re.search(r"(de donde obtienes|de donde sacas|internet|nube|api|fuente)", texto):
        return (
            "Fuente: Configuracion local\n"
            "Respuesta: Obtengo informacion de tres lugares locales: la grabacion "
            "transcrita e indexada en ChromaDB, el historial reciente del chat y el "
            "conocimiento general aprendido por el modelo local. No consulto internet "
            "ni APIs externas. Cuando algo no viene de la grabacion, debo marcarlo como "
            "Chat, Configuracion local o Conocimiento general local."
        )

    if re.search(
        r"\b(modelo|ollama|embedding|que estamos usando|cual estamos usando)\b",
        texto,
    ) or re.search(
        r"\bllm\b.*\b(usando|utilizando|activo|actual)\b|\b(usando|utilizando|activo|actual)\b.*\bllm\b",
        texto,
    ):
        return (
            "Fuente: Configuracion local\n"
            "Respuesta: El LLM local activo es "
            f"{LLM_MODEL}. Si no se define MINUTERO_LLM_MODEL, Lux usa el modelo "
            "personalizado minutero, basado en gemma4:e4b. Para vectorizacion usamos "
            f"{EMBEDDING_MODEL} en Ollama."
        )

    return None


def _respuesta_definicion_general(mensaje: str) -> str | None:
    texto = _normalizar_texto(mensaje)

    if re.search(r"\b(que es|que significa|define|explica)\b.*\bllm\b", texto):
        return (
            "Fuente: Conocimiento general local\n"
            "Respuesta: Un LLM es un modelo grande de lenguaje, es decir, un modelo de "
            "inteligencia artificial entrenado para entender y generar texto. En Lux, "
            "el LLM local se usa para resumir, responder preguntas y conversar sobre el "
            "contenido transcrito."
        )

    if re.search(r"\b(que es|que significa|define|explica)\b.*\buml\b", texto):
        return (
            "Fuente: Conocimiento general local\n"
            "Respuesta: UML significa Lenguaje Unificado de Modelado. Es una forma visual "
            "de representar sistemas de software, por ejemplo clases, relaciones, casos de "
            "uso o flujos de comportamiento."
        )

    return None


def _respuesta_deportes_general(mensaje: str) -> str | None:
    texto = _normalizar_texto(mensaje)

    if re.search(r"\bpatrick\s+mahomes\b", texto):
        if re.search(r"\b(donde|juega|equipo)\b", texto):
            return (
                "Fuente: Conocimiento general local\n"
                "Respuesta: Patrick Mahomes juega como quarterback en los Kansas City Chiefs."
            )
        if re.search(r"\b(quien es|que sabes|hablame|cuentame)\b", texto):
            return (
                "Fuente: Conocimiento general local\n"
                "Respuesta: Patrick Mahomes es un quarterback de la NFL. Juega para los "
                "Kansas City Chiefs y es conocido por su brazo fuerte, movilidad y creatividad."
            )

    if re.search(r"\blamar\s+jackson\b", texto):
        if re.search(r"\b(donde|juega|equipo)\b", texto):
            return (
                "Fuente: Conocimiento general local\n"
                "Respuesta: Lamar Jackson juega como quarterback en los Baltimore Ravens."
            )
        if re.search(r"\b(quien es|que sabes|hablame|cuentame)\b", texto):
            return (
                "Fuente: Conocimiento general local\n"
                "Respuesta: Lamar Jackson es un quarterback de la NFL. Juega para los "
                "Baltimore Ravens y destaca por su velocidad, movilidad y capacidad para correr."
            )

    if re.search(r"\b(quien es|cual es|dime|menciona)\b.*\bbuen\s+quarterback\b", texto):
        return (
            "Fuente: Conocimiento general local\n"
            "Respuesta: Patrick Mahomes es un buen ejemplo de quarterback. También Lamar "
            "Jackson es muy destacado por su movilidad y juego terrestre."
        )

    return None


def _mensajes_usuario(historial: list[dict[str, str]], mensaje: str | None = None) -> list[str]:
    mensajes = [
        turno["content"]
        for turno in _normalizar_historial(historial)
        if turno["role"] == "user"
    ]
    if mensaje:
        mensajes.append(mensaje)
    return mensajes


def _normalizar_estatura(valor: str, unidad: str | None) -> str:
    valor_limpio = valor.replace(",", ".").strip()
    unidad_limpia = _normalizar_texto(unidad or "")

    if unidad_limpia in {"metro", "metros"}:
        unidad_limpia = "m"
    elif unidad_limpia == "centimetros":
        unidad_limpia = "cm"

    if not unidad_limpia:
        try:
            numero = float(valor_limpio)
        except ValueError:
            numero = 0.0
        unidad_limpia = "m" if 1.0 <= numero <= 2.5 else "cm"

    return f"{valor_limpio} {unidad_limpia}".strip()


def _valor_estatura(estatura: str | None) -> str | None:
    if not estatura:
        return None
    coincidencia = re.search(r"(\d+(?:\.\d+)?)", estatura)
    return coincidencia.group(1) if coincidencia else None


def _extraer_estatura(texto: str) -> str | None:
    texto_normalizado = _normalizar_texto(texto)
    patrones = [
        r"\blorenzo\s+mide\s+(\d+(?:[\.,]\d+)?)\s*(cm|m|metro|metros)?\b",
        r"\bmido\s+(\d+(?:[\.,]\d+)?)\s*(cm|m|metro|metros)?\b",
        r"\bmi\s+estatura\s+es\s+(\d+(?:[\.,]\d+)?)\s*(cm|m|metro|metros)?\b",
    ]

    for patron in patrones:
        coincidencia = re.search(patron, texto_normalizado)
        if coincidencia:
            return _normalizar_estatura(coincidencia.group(1), coincidencia.group(2))

    return None


def _extraer_edad(texto: str) -> str | None:
    texto_normalizado = _normalizar_texto(texto)
    patrones = [
        r"\blorenzo\s+tiene\s+(\d{1,3})\s+anos\b",
        r"\btengo\s+(\d{1,3})\s+anos\b",
    ]
    for patron in patrones:
        coincidencia = re.search(patron, texto_normalizado)
        if coincidencia:
            return coincidencia.group(1)
    return None


def _extraer_nombre(texto: str) -> str | None:
    coincidencia = re.search(
        r"\b(?:mi nombre es|me llamo|soy)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,3})",
        texto,
        flags=re.IGNORECASE,
    )
    if not coincidencia:
        return None
    return coincidencia.group(1).strip(" .,:;")


def _aplicar_correccion_estatura(texto: str, altura_previa: str | None) -> str | None:
    texto_normalizado = _normalizar_texto(texto)
    valor_previo = _valor_estatura(altura_previa)

    coincidencia = re.search(r"\b(\d+(?:[\.,]\d+)?)\s*(cm|m|metro|metros)\b", texto_normalizado)
    if coincidencia and re.search(r"\b(si|sí|correcto|eran|era|es|son)\b", texto_normalizado):
        return _normalizar_estatura(coincidencia.group(1), coincidencia.group(2))

    menciona_metros = re.search(r"\b(m|metro|metros)\b", texto_normalizado)
    corrige_centimetros = re.search(r"\b(no\s+centimetros|no\s+cm|eran\s+metros|era\s+metros|metros\s+no)\b", texto_normalizado)
    if valor_previo and menciona_metros and corrige_centimetros:
        return f"{valor_previo} m"

    menciona_centimetros = re.search(r"\b(cm|centimetros)\b", texto_normalizado)
    corrige_metros = re.search(r"\b(no\s+metros|no\s+m|eran\s+centimetros|era\s+centimetros|centimetros\s+no)\b", texto_normalizado)
    if valor_previo and menciona_centimetros and corrige_metros:
        return f"{valor_previo} cm"

    return None


def _construir_memoria_chat(mensaje: str, historial: list[dict[str, str]]) -> ChatMemory:
    memoria = ChatMemory()

    for contenido in _mensajes_usuario(historial, mensaje):
        nombre = _extraer_nombre(contenido)
        if nombre:
            memoria.nombre = nombre

        edad = _extraer_edad(contenido)
        if edad:
            memoria.edad = edad

        estatura = _extraer_estatura(contenido)
        if estatura:
            memoria.altura = estatura
            continue

        estatura_corregida = _aplicar_correccion_estatura(contenido, memoria.altura)
        if estatura_corregida:
            memoria.altura = estatura_corregida

    return memoria


def _nota_estatura(estatura: str) -> str:
    if estatura.endswith("cm") and re.match(r"^\d+\.\d+\s+cm$", estatura):
        return " Nota: para una estatura humana, probablemente quisiste decir metros."
    return ""


def _respuesta_memoria_actual(mensaje: str, historial: list[dict[str, str]]) -> str | None:
    memoria_previa = _construir_memoria_chat("", historial)
    memoria_actual = _construir_memoria_chat(mensaje, historial)
    texto = _normalizar_texto(mensaje)

    es_afirmacion_estatura = bool(
        _extraer_estatura(mensaje)
        or _aplicar_correccion_estatura(mensaje, memoria_previa.altura)
    )
    if es_afirmacion_estatura and memoria_actual.altura:
        accion = "Actualizado" if memoria_previa.altura and memoria_previa.altura != memoria_actual.altura else "Registrado"
        return (
            "Fuente: Chat\n"
            f"Respuesta: {accion}: Lorenzo mide {memoria_actual.altura}."
            f"{_nota_estatura(memoria_actual.altura)}"
        )

    if re.search(r"^(si|sí|correcto|exacto|asi es|así es)\b", texto) and memoria_actual.altura and memoria_previa.altura != memoria_actual.altura:
        return (
            "Fuente: Chat\n"
            f"Respuesta: Actualizado: Lorenzo mide {memoria_actual.altura}."
            f"{_nota_estatura(memoria_actual.altura)}"
        )

    return None


def _respuesta_estatura(mensaje: str, historial: list[dict[str, str]]) -> str | None:
    texto = _normalizar_texto(mensaje)
    if not re.search(r"\b(cuanto mide|altura|estatura|mide lorenzo)\b", texto):
        return None

    memoria = _construir_memoria_chat(mensaje, historial)
    if memoria.altura:
        return (
            "Fuente: Chat\n"
            f"Respuesta: Segun el chat, Lorenzo mide {memoria.altura}."
            f"{_nota_estatura(memoria.altura)}"
        )

    return "Fuente: No encontrado\nRespuesta: No encontrado en la grabacion."


def _extraer_tema_mencion_grabacion(mensaje: str) -> str | None:
    texto = _normalizar_texto(mensaje)
    patrones = [
        r"\bque\s+(?:menciono|dijo|hablo|comento)\s+lorenzo\s+(?:acerca\s+de|sobre|de)\s+(.+)",
        r"\blorenzo\s+(?:menciono|dijo|hablo|comento)\s+(?:acerca\s+de|sobre|de)?\s*(.+)",
        r"\b(?:en\s+la\s+grabacion|en\s+el\s+audio)\s+(?:que\s+)?(?:se\s+)?(?:menciono|dijo|hablo|comento)\s+(?:acerca\s+de|sobre|de)?\s*(.+)",
    ]

    for patron in patrones:
        coincidencia = re.search(patron, texto)
        if coincidencia:
            tema = coincidencia.group(1).strip(" ?.!,:;")
            tema = re.sub(r"^(el|la|los|las|un|una|unos|unas|su|sus)\s+", "", tema)
            return tema or None

    return None


def _tokens_significativos(texto: str) -> list[str]:
    texto_normalizado = _normalizar_texto(texto)
    tokens = re.findall(r"[a-z0-9]+", texto_normalizado)
    stopwords = {
        "a",
        "acerca",
        "al",
        "algo",
        "de",
        "del",
        "el",
        "en",
        "la",
        "las",
        "lo",
        "los",
        "que",
        "se",
        "sobre",
        "su",
        "sus",
        "un",
        "una",
        "unos",
        "unas",
    }
    return [token for token in tokens if token not in stopwords and len(token) > 2]


# Palabras interrogativas y articulos que podrian aparecer capitalizadas al
# inicio de una pregunta. Las filtramos para no considerarlas entidades.
_PALABRAS_NO_ENTIDAD = {
    "que",
    "quien",
    "donde",
    "cuando",
    "cuanto",
    "cuantos",
    "cuantas",
    "como",
    "cual",
    "cuales",
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "unos",
    "unas",
    "del",
    "de",
    "y",
    "o",
    "no",
    "si",
    "tu",
    "tus",
    "su",
    "sus",
    "es",
    "son",
    "lo",
    "este",
    "esta",
    "estos",
    "estas",
    "ese",
    "esa",
    "esto",
    "porque",
    "para",
    "por",
    "con",
    "sin",
}


def _entidades_propias(mensaje: str) -> list[str]:
    """Extrae nombres propios y acronimos mencionados en la pregunta.

    Detecta secuencias capitalizadas tipo "Patrick Mahomes" o "Lamar Jackson"
    y siglas tipo "NFL" o "NBA". Filtra palabras interrogativas (Quién, Qué,
    Cuándo, etc.) que aparecen capitalizadas al inicio de la frase.
    """
    nombre_propio = r"[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*"
    acronimo = r"[A-Z]{2,}"
    patron = rf"\b({nombre_propio}|{acronimo})\b"

    entidades: list[str] = []
    vistos: set[str] = set()
    for match in re.finditer(patron, mensaje):
        entidad = match.group(1).strip()
        clave = _normalizar_texto(entidad)
        if not clave or clave in _PALABRAS_NO_ENTIDAD:
            continue
        if clave in vistos:
            continue
        vistos.add(clave)
        entidades.append(entidad)
    return entidades


def _entidad_en_contexto(entidad: str, contexto: str) -> bool:
    """Confirma que una entidad de la pregunta aparece en el contexto indexado."""
    contexto_normalizado = _normalizar_texto(contexto)
    entidad_normalizada = _normalizar_texto(entidad)
    if not entidad_normalizada:
        return False

    # Para nombres compuestos, basta con que aparezca el apellido o cualquier
    # token significativo (>3 chars) para considerar que el contexto habla del
    # mismo entidad. "Patrick Mahomes" matchea si aparece "Mahomes" en contexto.
    tokens = [t for t in entidad_normalizada.split() if len(t) > 2]
    if not tokens:
        return False
    return any(
        re.search(rf"\b{re.escape(token)}\b", contexto_normalizado) for token in tokens
    )


def _pregunta_es_sobre_grabacion(mensaje: str, contexto: str) -> bool:
    """Indica si la pregunta puede responderse desde la grabacion indexada.

    Si la pregunta menciona entidades propias (nombres, siglas) que no aparecen
    en el contexto, asumimos que es una pregunta de conocimiento general y la
    grabacion no aplica.
    """
    entidades = _entidades_propias(mensaje)
    if not entidades:
        # Sin entidades propias: la pregunta es generica, decidiremos por
        # otros heuristicos (palabras tipo "grabacion", "audio", etc.).
        return True
    return all(_entidad_en_contexto(entidad, contexto) for entidad in entidades)


def _tema_en_contexto(tema: str, contexto: str) -> bool:
    contexto_normalizado = _normalizar_texto(contexto)
    tokens = _tokens_significativos(tema)
    if not tokens:
        return False
    return all(re.search(rf"\b{re.escape(token)}\b", contexto_normalizado) for token in tokens)


def _fuente_sugerida(
    mensaje: str,
    historial: list[dict[str, str]] | None = None,
    contexto: str | None = None,
) -> str:
    texto = _normalizar_texto(mensaje)
    historial_limpio = _normalizar_historial(historial or [])
    hay_hechos_usuario = any(turno["role"] == "user" for turno in historial_limpio)

    # Si la pregunta cita explicitamente la grabacion ("¿que dijo X?"), insistimos
    # en grabacion aunque no haya match de entidad.
    if _extraer_tema_mencion_grabacion(mensaje):
        return "Grabacion"

    # Si el usuario nombra entidades propias (Patrick Mahomes, NFL, Lamar Jackson)
    # que NO aparecen en el contexto indexado, la pregunta es de conocimiento
    # general — no debemos atribuirla a la grabacion ni forzar al LLM a inventar.
    entidades = _entidades_propias(mensaje)
    if contexto is not None and entidades:
        fuera_de_contexto = [e for e in entidades if not _entidad_en_contexto(e, contexto)]
        if fuera_de_contexto and len(fuera_de_contexto) == len(entidades):
            return "Conocimiento general local"

    if re.search(r"\b(hablame|cuentame|dime algo|que sabes)\b", texto):
        if not re.search(r"\b(lorenzo|grabacion|audio|reunion|menciono|dijo|producto)\b", texto):
            return "Conocimiento general local"
    if re.search(r"\blorenzo\b", texto) and re.search(r"\b(desarrolla|desarrollando|crea|creando|producto)\b", texto):
        return "Grabacion"
    if re.search(r"\b(opinas|opinion|opinión|que te parece|qué te parece|retroalimentacion|retroalimentación)\b", texto):
        return "Grabacion + Conocimiento general local"
    if re.search(r"\b(que es|que significa|define|explica|cuantos jugadores|futbol|fútbol|nfl|nba|mlb|quarterback|temporada)\b", texto):
        return "Conocimiento general local"
    # "Quien es un/una/los mejores X" es definicion/recomendacion generica.
    if re.search(r"\bquien es (un|una|unos|unas|el mejor|la mejor|los mejores|las mejores)\b", texto):
        return "Conocimiento general local"
    if _es_pregunta_configuracion(mensaje):
        return "Configuracion local"
    if re.search(r"^(mido|soy|tengo|me llamo|mi nombre|lorenzo mide)\b", texto):
        return "Chat"
    if re.search(r"\b(grabacion|grabación|audio|transcripcion|transcripción|reunion|reunión|dijo|menciono|mencionó)\b", texto):
        return "Grabacion"
    if re.search(r"\b(quien|quién|cuantos|cuántos|cual|cuál|cuando|cuándo|donde|dónde|altura|mide)\b", texto):
        # Solo asumimos grabacion si la pregunta no menciona entidades externas
        # o si esas entidades estan en el contexto.
        if contexto is None or not entidades or all(
            _entidad_en_contexto(e, contexto) for e in entidades
        ):
            return "Grabacion + Chat" if hay_hechos_usuario else "Grabacion"
        return "Conocimiento general local"
    if re.search(r"\b(recomienda|sugerencia|mejora|proyecto)\b", texto):
        return "Grabacion + Chat"
    return "Conocimiento general local"


def _fuente_normalizada(fuente_sugerida: str) -> str:
    fuentes_validas = {
        "Grabacion",
        "Chat",
        "Grabacion + Chat",
        "Configuracion local",
        "Conocimiento general local",
        "Grabacion + Conocimiento general local",
        "No encontrado",
    }
    if fuente_sugerida in fuentes_validas:
        return fuente_sugerida
    return "Conocimiento general local"


def _limpiar_respuesta_chat(respuesta: str) -> str:
    lineas = [
        linea.strip()
        for linea in respuesta.strip().splitlines()
        if linea.strip() and not re.match(r"^Fuente\s*:", linea.strip(), flags=re.IGNORECASE)
    ]
    if lineas and "?" in lineas[0] and len(lineas) > 1:
        lineas = lineas[1:]
    limpio = "\n".join(lineas).strip()
    limpio = re.sub(r"^Sugerencia:\s*", "", limpio, flags=re.IGNORECASE)
    return limpio or "No encontrado en la grabacion."


def _contenido_respuesta_formateada(respuesta: str) -> str:
    coincidencia = re.search(
        r"Respuesta\s*:\s*(.*)",
        respuesta,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if coincidencia:
        return coincidencia.group(1).strip()
    return respuesta.strip()


def _asegurar_formato_chat(respuesta: str, fuente_sugerida: str) -> str:
    respuesta = respuesta.strip()
    respuesta_normalizada = _normalizar_texto(respuesta)
    fuente = _fuente_normalizada(fuente_sugerida)
    if fuente in {"Grabacion", "Grabacion + Chat"} and re.search(
        r"\b(no se menciona|no encontrado|no esta|no aparece|no tengo informacion)\b",
        respuesta_normalizada,
    ):
        return "Fuente: No encontrado\nRespuesta: No encontrado en la grabacion."

    contenido = _limpiar_respuesta_chat(_contenido_respuesta_formateada(respuesta))
    return f"Fuente: {fuente}\nRespuesta: {contenido}"


def _describe_producto_desde_contexto(contexto: str) -> str | None:
    texto = _normalizar_texto(contexto)
    if "llm local" in texto and ("audio" in texto or "transcribir" in texto):
        return (
            "Lorenzo esta desarrollando un producto con un LLM local para "
            "transcribir audio a texto y procesar el contenido."
        )
    if "audio" in texto and "texto" in texto:
        return "Lorenzo esta desarrollando un producto para transcribir audio a texto."
    return None


def _respuesta_grabacion_directa(mensaje: str, contexto: str) -> str | None:
    texto = _normalizar_texto(mensaje)
    tema_mencion = _extraer_tema_mencion_grabacion(mensaje)

    if tema_mencion and not _tema_en_contexto(tema_mencion, contexto):
        return "Fuente: No encontrado\nRespuesta: No encontrado en la grabacion."

    # Si la pregunta menciona entidades propias (Patrick Mahomes, NFL, etc.)
    # que no aparecen en el contexto, no usamos atajos hacia la grabacion: la
    # respuesta debe venir del LLM con fuente "Conocimiento general local".
    if not _pregunta_es_sobre_grabacion(mensaje, contexto):
        return None

    if re.search(r"\blorenzo\b", texto) and re.search(r"\b(desarrolla|desarrollando|crea|creando|producto)\b", texto):
        descripcion = _describe_producto_desde_contexto(contexto)
        if descripcion:
            return f"Fuente: Grabacion\nRespuesta: {descripcion}"

    # "Cuantos anos / edad" solo aplica si la persona del contexto es la
    # referenciada (mencionando "Lorenzo" o sin entidad propia).
    if re.search(r"\b(cuantos anos|edad|anos tiene)\b", texto):
        edad = _extraer_edad(contexto)
        if edad and (re.search(r"\blorenzo\b", texto) or not _entidades_propias(mensaje)):
            return f"Fuente: Grabacion\nRespuesta: Lorenzo tiene {edad} años."

    # "Quien es" solo dispara para "quien es lorenzo" o cuando el nombre
    # mencionado coincide con el del contexto. Antes este branch devolvia
    # "Lorenzo" para cualquier "quien es X" (incluido Patrick Mahomes).
    pregunta_sobre_lorenzo = bool(re.search(r"\bquien es lorenzo\b", texto))
    entidades = _entidades_propias(mensaje)
    if not pregunta_sobre_lorenzo and entidades:
        nombre_contexto = _extraer_nombre(contexto)
        nombre_contexto_norm = _normalizar_texto(nombre_contexto or "")
        if not any(
            nombre_contexto_norm and _normalizar_texto(e).startswith(nombre_contexto_norm.split()[0])
            for e in entidades
        ):
            return None

    # "Quien es un/una/unos/unas X" es una pregunta genérica/definición y no
    # se refiere al sujeto de la grabacion. Ej: "quien es un buen quarterback".
    pregunta_generica = bool(re.search(r"\bquien es (un|una|unos|unas|el mejor|la mejor|los mejores|las mejores)\b", texto))

    if (
        re.search(r"\bquien es\b", texto)
        and (pregunta_sobre_lorenzo or not entidades)
        and not pregunta_generica
    ):
        nombre = _extraer_nombre(contexto) or "Lorenzo"
        edad = _extraer_edad(contexto)
        descripcion = f"{nombre}"
        if edad:
            descripcion += f", de {edad} años"
        producto = _describe_producto_desde_contexto(contexto)
        if producto:
            descripcion += f". {producto}"
        return f"Fuente: Grabacion\nRespuesta: {descripcion.rstrip('.')}."

    return None


def _respuesta_opinion(mensaje: str, contexto: str) -> str | None:
    texto = _normalizar_texto(mensaje)
    pide_opinion = re.search(
        r"\b(opinas|opinion|que te parece|retroalimentacion|crear un llm|utiliza audios|convertirlos a texto)\b",
        texto,
    )
    if not pide_opinion:
        return None

    descripcion = _describe_producto_desde_contexto(contexto)
    base = (
        "La idea es solida porque resuelve un problema real: convertir audio de "
        "reuniones, clases o charlas en texto consultable sin depender de la nube."
    )
    if descripcion:
        base = f"Con base en la grabacion, {descripcion} La idea es solida porque conserva privacidad y permite consultar el contenido despues."

    return (
        "Fuente: Grabacion + Conocimiento general local\n"
        f"Respuesta: {base} Sugerencia: enfoca la demo en tres diferenciales: "
        "privacidad local, evidencia trazable de donde sale cada respuesta y bajo costo "
        "al usar modelos locales con embeddings."
    )


def _emitir_texto(texto: str) -> Iterator[str]:
    yield texto


def stream_con_prompt(
    prompt: str,
    task: str = "LLM",
    num_predict: int | None = None,
) -> Iterator[str]:
    import ollama

    opciones = _opciones_generacion(num_predict or _num_predict_para_task(task))
    prompt_total = f"{SYSTEM_GUARDRAILS}\n{prompt}"
    started_at = time.perf_counter()
    first_token_at: float | None = None
    output_parts: list[str] = []
    logged_end = False

    log_metric(
        "LLM_START",
        {
            "task": task,
            "model": LLM_MODEL,
            "prompt_chars": len(prompt_total),
            "prompt_tokens_aprox": approx_tokens(prompt_total),
            "system_chars": len(SYSTEM_GUARDRAILS),
            "user_prompt_chars": len(prompt),
            "num_ctx": opciones["num_ctx"],
            "num_predict": opciones["num_predict"],
            "temperature": opciones["temperature"],
            "top_p": opciones["top_p"],
            "keep_alive": LLM_KEEP_ALIVE,
        },
    )
    log_optimized(
        "LLM_START",
        {
            "task": task,
            "model": LLM_MODEL,
            "prompt_chars": len(prompt_total),
            "prompt_tokens_aprox": approx_tokens(prompt_total),
            "num_ctx": opciones["num_ctx"],
            "num_predict": opciones["num_predict"],
            "temperature": opciones["temperature"],
            "top_p": opciones["top_p"],
            "keep_alive": LLM_KEEP_ALIVE,
        },
    )

    try:
        stream = ollama.chat(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_GUARDRAILS},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            keep_alive=LLM_KEEP_ALIVE,
            options=opciones,
        )

        for parte in stream:
            mensaje = parte.get("message", {})
            token = mensaje.get("content", "")
            if token:
                if first_token_at is None:
                    first_token_at = time.perf_counter()
                output_parts.append(token)
                yield token
    except Exception as exc:
        output = "".join(output_parts)
        log_metric(
            "LLM_END",
            {
                "task": task,
                "model": LLM_MODEL,
                "status": "error",
                "error": type(exc).__name__,
                "output_chars": len(output),
                "output_tokens_aprox": approx_tokens(output),
                "ttft_ms": round((first_token_at - started_at) * 1000, 2)
                if first_token_at
                else None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
        log_optimized(
            "LLM_END",
            {
                "task": task,
                "model": LLM_MODEL,
                "status": "error",
                "error": type(exc).__name__,
                "output_chars": len(output),
                "output_tokens_aprox": approx_tokens(output),
                "ttft_ms": round((first_token_at - started_at) * 1000, 2)
                if first_token_at
                else None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
        logged_end = True
        raise
    finally:
        if not logged_end:
            output = "".join(output_parts)
            log_metric(
                "LLM_END",
                {
                    "task": task,
                    "model": LLM_MODEL,
                    "status": "ok",
                    "output_chars": len(output),
                    "output_tokens_aprox": approx_tokens(output),
                    "ttft_ms": round((first_token_at - started_at) * 1000, 2)
                    if first_token_at
                    else None,
                    "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                },
            )
            log_optimized(
                "LLM_END",
                {
                    "task": task,
                    "model": LLM_MODEL,
                    "status": "ok",
                    "output_chars": len(output),
                    "output_tokens_aprox": approx_tokens(output),
                    "ttft_ms": round((first_token_at - started_at) * 1000, 2)
                    if first_token_at
                    else None,
                    "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                },
            )


def texto_con_prompt(
    prompt: str,
    num_predict: int | None = None,
    task: str = "LLM_TEXT",
) -> str:
    import ollama

    opciones = _opciones_generacion(num_predict=num_predict or _num_predict_para_task(task))
    prompt_total = f"{SYSTEM_GUARDRAILS}\n{prompt}"
    started_at = time.perf_counter()
    log_metric(
        "LLM_START",
        {
            "task": task,
            "model": LLM_MODEL,
            "prompt_chars": len(prompt_total),
            "prompt_tokens_aprox": approx_tokens(prompt_total),
            "system_chars": len(SYSTEM_GUARDRAILS),
            "user_prompt_chars": len(prompt),
            "num_ctx": opciones["num_ctx"],
            "num_predict": opciones["num_predict"],
            "temperature": opciones["temperature"],
            "top_p": opciones["top_p"],
            "keep_alive": LLM_KEEP_ALIVE,
        },
    )
    log_optimized(
        "LLM_START",
        {
            "task": task,
            "model": LLM_MODEL,
            "prompt_chars": len(prompt_total),
            "prompt_tokens_aprox": approx_tokens(prompt_total),
            "num_ctx": opciones["num_ctx"],
            "num_predict": opciones["num_predict"],
            "temperature": opciones["temperature"],
            "top_p": opciones["top_p"],
            "keep_alive": LLM_KEEP_ALIVE,
        },
    )
    try:
        respuesta = ollama.chat(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_GUARDRAILS},
                {"role": "user", "content": prompt},
            ],
            stream=False,
            keep_alive=LLM_KEEP_ALIVE,
            options=opciones,
        )
        mensaje = respuesta.get("message", {})
        output = str(mensaje.get("content", "")).strip()
        log_metric(
            "LLM_END",
            {
                "task": task,
                "model": LLM_MODEL,
                "status": "ok",
                "output_chars": len(output),
                "output_tokens_aprox": approx_tokens(output),
                "ttft_ms": None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
        log_optimized(
            "LLM_END",
            {
                "task": task,
                "model": LLM_MODEL,
                "status": "ok",
                "output_chars": len(output),
                "output_tokens_aprox": approx_tokens(output),
                "ttft_ms": None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
        return output
    except Exception as exc:
        log_metric(
            "LLM_END",
            {
                "task": task,
                "model": LLM_MODEL,
                "status": "error",
                "error": type(exc).__name__,
                "output_chars": 0,
                "output_tokens_aprox": 0,
                "ttft_ms": None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
        log_optimized(
            "LLM_END",
            {
                "task": task,
                "model": LLM_MODEL,
                "status": "error",
                "error": type(exc).__name__,
                "output_chars": 0,
                "output_tokens_aprox": 0,
                "ttft_ms": None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
        raise


def _hay_decisiones_explicitas(contexto: str) -> bool:
    texto = _normalizar_texto(contexto)
    patrones = [
        "decidimos",
        "se decidio",
        "acordamos",
        "se acordo",
        "queda decidido",
    ]
    return any(patron in texto for patron in patrones)


def _hay_pendientes_explicitos(contexto: str) -> bool:
    texto = _normalizar_texto(contexto)
    patrones = [
        "pendiente",
        "tarea",
        "responsable",
        "hay que",
        "tenemos que",
        "debe hacer",
        "se encarga",
        "para manana",
    ]
    return any(patron in texto for patron in patrones)


def _normalizar_seccion(texto: str, titulo: str, contenido: str) -> str:
    titulos = [
        "Resumen",
        "Puntos clave",
        "Decisiones tomadas",
        "Pendientes",
    ]
    siguientes = [nombre for nombre in titulos if nombre != titulo]
    patron_siguientes = "|".join(re.escape(nombre) for nombre in siguientes)
    patron = rf"({re.escape(titulo)}\s*:\s*)(.*?)(?=\n\s*(?:{patron_siguientes})\s*:|\Z)"

    if re.search(patron, texto, flags=re.IGNORECASE | re.DOTALL):
        return re.sub(
            patron,
            rf"\1{contenido}\n",
            texto,
            flags=re.IGNORECASE | re.DOTALL,
        ).strip()

    return f"{texto.strip()}\n\n{titulo}:\n{contenido}".strip()


def _capitalizar_oracion(texto: str) -> str:
    texto = texto.strip(" .")
    if not texto:
        return texto
    return texto[0].upper() + texto[1:] + "."


def _limpiar_fragmento_contexto(fragmento: str) -> str:
    limpio = re.sub(r"\s+", " ", fragmento).strip(" ,.;:-")
    limpio = re.sub(r"^(hola|bueno|este|eh|mmm)\b[,\s]*", "", limpio, flags=re.IGNORECASE)
    limpio = re.sub(
        r"^de esto lo que se trata del producto es como de\s+",
        "el producto trata de ",
        limpio,
        flags=re.IGNORECASE,
    )
    limpio = re.sub(r"^como de\s+", "", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bjacat[oó]n\b", "hackaton", limpio, flags=re.IGNORECASE)

    nombre = re.match(r"^mi nombre es\s+(.+)$", limpio, flags=re.IGNORECASE)
    if nombre:
        return f"La persona se presenta como {nombre.group(1).strip()}"

    soy = re.match(r"^soy\s+(.+)$", limpio, flags=re.IGNORECASE)
    if soy:
        return f"La persona se presenta como {soy.group(1).strip()}"

    edad = re.match(r"^tengo\s+(.+)$", limpio, flags=re.IGNORECASE)
    if edad:
        return f"Indica que tiene {edad.group(1).strip()}"

    limpio = re.sub(r"^estoy participando en\s+", "participa en ", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"^estoy creando\s+", "esta creando ", limpio, flags=re.IGNORECASE)
    return limpio.strip()


def _puntos_clave_extractivos(contexto: str, limite: int = 5) -> list[str]:
    texto = re.sub(r"\s+", " ", contexto).strip()
    fragmentos = re.split(r"(?<=[.!?])\s+|,\s+|\s+y\s+", texto)

    puntos: list[str] = []
    vistos: set[str] = set()
    for fragmento in fragmentos:
        limpio = _limpiar_fragmento_contexto(fragmento)
        if len(limpio) < 10:
            continue

        clave = _normalizar_texto(limpio)
        if clave in vistos:
            continue

        vistos.add(clave)
        puntos.append(_capitalizar_oracion(limpio[:180]))
        if len(puntos) >= limite:
            break

    if not puntos and texto:
        puntos.append(_capitalizar_oracion(texto[:180]))

    return puntos


def _resumen_extractivo(contexto: str) -> str:
    puntos = _puntos_clave_extractivos(contexto, limite=3)
    if not puntos:
        return "No hay suficiente informacion para generar un resumen."
    return " ".join(puntos)


def _limpiar_resumen(contexto: str, resumen: str) -> str:
    limpio = resumen.strip()
    puntos = _puntos_clave_extractivos(contexto)

    limpio = _normalizar_seccion(
        limpio,
        "Resumen",
        _resumen_extractivo(contexto),
    )

    if puntos:
        limpio = _normalizar_seccion(
            limpio,
            "Puntos clave",
            "\n".join(f"- {punto}" for punto in puntos),
        )

    if not _hay_decisiones_explicitas(contexto):
        limpio = _normalizar_seccion(
            limpio,
            "Decisiones tomadas",
            "No se mencionaron decisiones explicitas.",
        )

    if not _hay_pendientes_explicitos(contexto):
        limpio = _normalizar_seccion(
            limpio,
            "Pendientes",
            "No se mencionaron pendientes explicitos.",
        )

    return limpio


def generar_resumen_seguro(contexto: str) -> Iterator[str]:
    """Stream del resumen token por token con post-procesado al final.

    Antes esta funcion bloqueaba hasta tener el resumen completo (15-40s) y
    luego yieldeaba todo de golpe. Eso provocaba 502 en proxies con timeout de
    ~30s. Ahora streameamos los tokens segun llegan de Ollama (primer token en
    1-3s) y al final aplicamos el modo seguro con un marcador especial que el
    cliente interpreta como "reemplaza lo anterior con esto".
    """
    buffer: list[str] = []
    for token in stream_con_prompt(prompt_resumen(contexto), task="/resumir"):
        buffer.append(token)
        yield token

    raw = "".join(buffer).strip()
    if not raw:
        return

    cleaned = _limpiar_resumen(contexto, raw)
    if cleaned.strip() == raw.strip():
        return
    # Marcador para que el frontend reemplace el resumen mostrado con la
    # version corregida una vez termina el stream.
    yield "[[REWRITE]]"
    yield cleaned


def _titulo_mapa(contexto: str) -> str:
    texto = _normalizar_texto(contexto)
    if "llm local" in texto and ("audio" in texto or "transcribir" in texto):
        return "LLM local para transcripcion de audio"
    if "reunion" in texto:
        return "Resumen de la reunion"
    puntos = _puntos_clave_extractivos(contexto, limite=1)
    if puntos:
        return puntos[0].rstrip(".")[:80]
    return "Mapa mental de la grabacion"


def generar_mapa_seguro(contexto: str) -> Iterator[str]:
    puntos = _puntos_clave_extractivos(contexto, limite=8)
    datos: list[str] = []
    producto: list[str] = []
    otros: list[str] = []

    for punto in puntos:
        clave = _normalizar_texto(punto)
        if any(palabra in clave for palabra in ["presenta", "tiene", "participa"]):
            datos.append(punto)
        elif any(palabra in clave for palabra in ["producto", "llm", "audio", "texto", "transcribir", "proces"]):
            producto.append(punto)
        else:
            otros.append(punto)

    lineas = [f"# {_titulo_mapa(contexto)}"]
    if datos:
        lineas.append("## Datos mencionados")
        lineas.extend(f"- {punto}" for punto in datos)
    if producto:
        lineas.append("## Producto")
        lineas.extend(f"- {punto}" for punto in producto)
    if otros:
        lineas.append("## Otros puntos")
        lineas.extend(f"- {punto}" for punto in otros)
    if len(lineas) == 1:
        lineas.append("## Informacion mencionada")
        lineas.append("- No se encontraron puntos suficientes en la grabacion.")

    yield "\n".join(lineas)


def calentar_modelo() -> None:
    """Carga el modelo en Ollama para reducir la latencia del primer token."""
    try:
        import ollama

        prompt = "Responde solo: ok"
        opciones = _opciones_generacion(num_predict=TASK_NUM_PREDICT["/calentar"])
        started_at = time.perf_counter()
        log_metric(
            "LLM_START",
            {
                "task": "/calentar",
                "model": LLM_MODEL,
                "prompt_chars": len(prompt),
                "prompt_tokens_aprox": approx_tokens(prompt),
                "system_chars": 0,
                "user_prompt_chars": len(prompt),
                "num_ctx": opciones["num_ctx"],
                "num_predict": opciones["num_predict"],
                "temperature": opciones["temperature"],
                "top_p": opciones["top_p"],
                "keep_alive": LLM_KEEP_ALIVE,
            },
        )
        log_optimized(
            "LLM_START",
            {
                "task": "/calentar",
                "model": LLM_MODEL,
                "prompt_chars": len(prompt),
                "prompt_tokens_aprox": approx_tokens(prompt),
                "num_ctx": opciones["num_ctx"],
                "num_predict": opciones["num_predict"],
                "temperature": opciones["temperature"],
                "top_p": opciones["top_p"],
                "keep_alive": LLM_KEEP_ALIVE,
            },
        )
        respuesta = ollama.chat(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            stream=False,
            keep_alive=LLM_KEEP_ALIVE,
            options=opciones,
        )
        output = str(respuesta.get("message", {}).get("content", "")).strip()
        log_metric(
            "LLM_END",
            {
                "task": "/calentar",
                "model": LLM_MODEL,
                "status": "ok",
                "output_chars": len(output),
                "output_tokens_aprox": approx_tokens(output),
                "ttft_ms": None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
        log_optimized(
            "LLM_END",
            {
                "task": "/calentar",
                "model": LLM_MODEL,
                "status": "ok",
                "output_chars": len(output),
                "output_tokens_aprox": approx_tokens(output),
                "ttft_ms": None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
        print(f"Modelo {LLM_MODEL} caliente.")
    except Exception as exc:
        log_metric(
            "LLM_END",
            {
                "task": "/calentar",
                "model": LLM_MODEL,
                "status": "error",
                "error": type(exc).__name__,
                "output_chars": 0,
                "output_tokens_aprox": 0,
                "ttft_ms": None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2)
                if "started_at" in locals()
                else 0,
            },
        )
        log_optimized(
            "LLM_END",
            {
                "task": "/calentar",
                "model": LLM_MODEL,
                "status": "error",
                "error": type(exc).__name__,
                "output_chars": 0,
                "output_tokens_aprox": 0,
                "ttft_ms": None,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2)
                if "started_at" in locals()
                else 0,
            },
        )
        print(f"No se pudo calentar el modelo {LLM_MODEL}: {exc}")


def generar_respuesta(pregunta: str) -> Iterator[str]:
    chunks = recuperar_chunks(pregunta, task="/preguntar", top_k=3)
    chunks = _deduplicar_chunks_rag(chunks, task="/preguntar")
    if not chunks:
        yield "No encontrado en la grabacion."
        return

    contexto = _texto_rag(chunks)
    prompt = prompt_pregunta(contexto, pregunta)
    yield from stream_con_prompt(prompt, task="/preguntar")


EASY_READ_INSTRUCTIONS = (
    "MODO LECTURA FACIL ACTIVADO. Reglas adicionales obligatorias:\n"
    "- Usa frases cortas, maximo 12 palabras por frase.\n"
    "- Vocabulario nivel A2 (basico). Evita tecnicismos.\n"
    "- Si tienes que usar un termino tecnico, explicalo entre parentesis.\n"
    "- Una idea por frase. Una linea en blanco entre ideas.\n"
    "- No uses metaforas, ironia ni sarcasmo.\n"
    "- Mantente fiel al contenido pero simplifica."
)


def generar_chat(
    mensaje: str,
    historial: list[dict[str, str]],
    modo_lectura_facil: bool = False,
) -> Iterator[str]:
    historial_baseline = _normalizar_historial_baseline(historial)
    historial_limpio = _normalizar_historial(historial)
    historial_baseline_texto = "\n".join(turno["content"] for turno in historial_baseline)
    historial_texto = "\n".join(turno["content"] for turno in historial_limpio)
    baseline_chars = len(historial_baseline_texto)
    optimized_chars = len(historial_texto)
    log_metric(
        "CHAT_HISTORY",
        {
            "task": "/chat",
            "messages": len(historial_baseline),
            "raw_messages": len(historial),
            "history_chars": baseline_chars,
            "history_tokens_aprox": approx_tokens(historial_baseline_texto),
            "user_msg_chars": len(mensaje),
            "user_msg_tokens_aprox": approx_tokens(mensaje),
            "modo_lectura_facil": modo_lectura_facil,
        },
    )
    log_optimized(
        "CHAT_HISTORY",
        {
            "task": "/chat",
            "messages": len(historial_limpio),
            "raw_messages": len(historial),
            "history_chars": optimized_chars,
            "history_tokens_aprox": approx_tokens(historial_texto),
            "user_msg_chars": len(mensaje),
            "user_msg_tokens_aprox": approx_tokens(mensaje),
            "reduced_chars": max(0, baseline_chars - optimized_chars),
            "reduced_tokens_aprox": max(
                0,
                approx_tokens(historial_baseline_texto) - approx_tokens(historial_texto),
            ),
            "baseline_messages": len(historial_baseline),
        },
    )

    respuesta_memoria = _respuesta_memoria_actual(mensaje, historial)
    if respuesta_memoria:
        yield respuesta_memoria
        return

    respuesta_local = _respuesta_configuracion(mensaje)
    if respuesta_local:
        yield respuesta_local
        return

    respuesta_definicion = _respuesta_definicion_general(mensaje)
    if respuesta_definicion:
        yield respuesta_definicion
        return

    respuesta_deportes = _respuesta_deportes_general(mensaje)
    if respuesta_deportes:
        yield respuesta_deportes
        return

    respuesta_estatura = _respuesta_estatura(mensaje, historial)
    if respuesta_estatura:
        yield respuesta_estatura
        return

    consulta = _consulta_para_retrieval(mensaje, historial)
    chunks = recuperar_chunks(consulta or mensaje, task="/chat", top_k=2)
    chunks = _deduplicar_chunks_rag(chunks, task="/chat")
    if not chunks:
        yield (
            "Fuente: No encontrado\n"
            "Respuesta: No hay audio indexado. Sube o graba audio primero para poder "
            "conversar sobre la reunion."
        )
        return

    contexto = _texto_rag(chunks)
    fuente = _fuente_sugerida(mensaje, historial, contexto=contexto)

    respuesta_grabacion = _respuesta_grabacion_directa(mensaje, contexto)
    if respuesta_grabacion:
        yield respuesta_grabacion
        return

    respuesta_opinion = _respuesta_opinion(mensaje, contexto)
    if respuesta_opinion:
        yield respuesta_opinion
        return

    estado_tecnico = (
        _estado_tecnico()
        if fuente == "Configuracion local"
        else "No relevante para esta pregunta. No menciones modelos, Ollama, ChromaDB ni embeddings salvo que el usuario pregunte por configuracion."
    )
    if modo_lectura_facil:
        estado_tecnico = f"{estado_tecnico}\n\n{EASY_READ_INSTRUCTIONS}"
    # Cuando la fuente es de conocimiento general o configuracion, el contexto
    # de la grabacion no es relevante y puede contaminar la respuesta (por
    # ejemplo, hacer que el modelo conteste "Lorenzo" para una pregunta sobre
    # Patrick Mahomes). Lo sustituimos por un marcador explicito.
    contexto_para_prompt = (
        contexto
        if fuente not in {"Conocimiento general local", "Configuracion local"}
        else "(La pregunta no depende de la grabacion. Responde usando conocimiento general y deja claro que no proviene del audio indexado.)"
    )
    prompt = prompt_chat(
        contexto=contexto_para_prompt,
        historial=_formatear_historial(historial),
        mensaje=mensaje,
        estado_tecnico=estado_tecnico,
        fuente_sugerida=fuente,
    )

    # Streaming token a token para que la conexion no se caiga por timeout y
    # el usuario vea progreso inmediato. Al final, si el formato no respeta el
    # patron "Fuente: ... / Respuesta: ...", emitimos un REWRITE con la version
    # normalizada.
    buffer: list[str] = []
    for token in stream_con_prompt(prompt, task="/chat"):
        buffer.append(token)
        yield token

    raw = "".join(buffer).strip()
    if not raw:
        return

    formatted = _asegurar_formato_chat(raw, fuente)
    if formatted.strip() == raw.strip():
        return
    yield "[[REWRITE]]"
    yield formatted
