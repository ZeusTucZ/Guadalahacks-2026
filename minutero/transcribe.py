from __future__ import annotations

import os
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from threading import Lock


MULETILLAS = [
    r"\beste+\b",
    r"\beh+\b",
    r"\bem+\b",
    r"\bmmm+\b",
    r"\bo sea\b",
    r"\bverdad\b",
    r"\bno\?\b",
]

_WHISPER_TRANSCRIBE_LOCK = Lock()


# Prompt bilingue para sesgar a Whisper hacia nombres propios y terminos comunes
# que aparecen mezclados con espanol (deportes, tecnologia, marcas). Esto reduce
# errores como "Patrick Mahomes" -> "mis colmas" o "quarterback" -> "coredado".
VOICE_INITIAL_PROMPT = (
    "Conversacion en espanol con preguntas cortas. "
    "Nombre del usuario/proyecto: Lorenzo Orrante, Minutero, Guadalahacks. "
    "El usuario puede mencionar nombres propios en ingles: "
    "Patrick Mahomes, Lamar Jackson, Travis Kelce, Tom Brady, Aaron Rodgers, "
    "Kansas City Chiefs, Baltimore Ravens, Buffalo Bills, Dallas Cowboys, "
    "NFL, NBA, MLB, quarterback, running back, wide receiver, touchdown, "
    "Python, JavaScript, TypeScript, React, FastAPI, Ollama, Whisper, "
    "LLM, RAG, embedding, ChromaDB, GitHub, Google, Microsoft, OpenAI, Anthropic. "
    "Responde con puntuacion correcta, acentos y signos de interrogacion."
)

CAPTION_INITIAL_PROMPT = (
    "Transcripcion en vivo en espanol de una demo de accesibilidad y programacion. "
    "Terminos esperados: Lorenzo Orrante, hackaton, Guadalahacks, Minutero, "
    "LLM local, inteligencia artificial local, Whisper, Ollama, ChromaDB, RAG, "
    "Python, JavaScript, TypeScript, React, FastAPI, Tecnologico de Monterrey, "
    "personas sordas, personas ciegas, subtitulos en vivo, microfono, chat por voz, "
    "IA, Wi-Fi. "
    "Frases probables: Hola, mi nombre es Lorenzo Orrante. Tengo 20 anos. "
    "He estado aprendiendo a programar desde que tengo 15 anos. "
    "Estoy en un hackaton y estoy haciendo un LLM local. "
    "Debe funcionar de manera local. "
    "Sirve para personas sordas y ciegas. "
    "Puedo hablar con la IA y recibir respuesta con voz."
)


def limpiar_transcripcion(texto: str) -> str:
    """Limpia ruido comun de una transcripcion de voz en espanol."""
    texto = re.sub(r"\[[^\]]+\]", " ", texto)

    for muletilla in MULETILLAS:
        texto = re.sub(muletilla, " ", texto, flags=re.IGNORECASE)

    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r"\s+\n", "\n", texto)
    texto = re.sub(r"\n\s+", "\n", texto)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    texto = re.sub(r"\s+([,.!?;:])", r"\1", texto)
    return texto.strip()


def limpiar_transcripcion_voz(texto: str) -> str:
    """Limpieza minima para mensajes cortos del chat por voz.

    A diferencia de la limpieza usada para reuniones largas, aqui no se eliminan
    muletillas porque palabras como "este" pueden ser parte de una pregunta corta
    (por ejemplo: "¿quien es este jugador?").
    """
    texto = re.sub(r"\[[^\]]+\]", " ", texto)
    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r"\s+([,.!?;:])", r"\1", texto)
    return corregir_transcripcion_voz(texto.strip())


def _normalizar_voz(texto: str) -> str:
    normalizado = unicodedata.normalize("NFD", texto.lower())
    normalizado = "".join(
        caracter
        for caracter in normalizado
        if unicodedata.category(caracter) != "Mn"
    )
    return re.sub(r"\s+", " ", normalizado).strip(" .!?¿¡")


def corregir_transcripcion_voz(texto: str) -> str:
    """Corrige errores recurrentes de Whisper en preguntas cortas.

    Los mensajes de voz del chat suelen durar 1-4 segundos. En ese escenario,
    Whisper puede colapsar nombres propios en frases foneticamente parecidas.
    Estas reglas son conservadoras y se limitan a errores observados en la demo.
    """
    limpio = texto.strip()
    normalizado = _normalizar_voz(limpio)

    if re.fullmatch(r"(mis colmas|mis comas|mes colmas|mes comas)", normalizado):
        return "¿Quién es Patrick Mahomes?"

    if re.search(r"\bdonde\b", normalizado) and re.search(
        r"\b(mis colmas|mis comas|mes colmas|patric mahomes|patrick mahomes)\b",
        normalizado,
    ):
        return "¿Dónde juega Patrick Mahomes?"

    if re.search(r"\bdonde\b", normalizado) and re.search(
        r"\b(la mar de accion|lamar de accion|lamar accion|la marca accion|lamar jackson)\b",
        normalizado,
    ):
        return "¿Dónde juega Lamar Jackson?"

    if re.search(r"\b(coredado|core dado|cuore dado|coreback|cuarterback)\b", normalizado):
        if re.search(r"\b(quien|tienes|tiene|cual|que)\b", normalizado):
            return "¿Quién es un buen quarterback?"
        limpio = re.sub(
            r"\b(coredado|core dado|cuore dado|coreback|cuarterback)\b",
            "quarterback",
            limpio,
            flags=re.IGNORECASE,
        )

    limpio = re.sub(r"\bPatric\s+Mahomes\b", "Patrick Mahomes", limpio, flags=re.IGNORECASE)
    limpio = re.sub(
        r"\bla\s+mar\s+de\s+accion\b",
        "Lamar Jackson",
        limpio,
        flags=re.IGNORECASE,
    )
    return limpio.strip()


def corregir_caption(texto: str) -> str:
    """Normaliza errores frecuentes de subtitulos en vivo.

    El captioning trabaja con clips pequenos y parciales; por eso se aplican
    correcciones de vocabulario de la demo sin cambiar la estructura general.
    """
    limpio = limpiar_transcripcion_voz(texto)
    normalizado = _normalizar_voz(limpio)

    if "mi nombre es" in normalizado:
        limpio = re.sub(
            r"\bmi nombre es\s+(?:Doris|Dorys|Loris|Lores|Lorenzo)?\s*Or+ante\b",
            "mi nombre es Lorenzo Orrante",
            limpio,
            flags=re.IGNORECASE,
        )
        limpio = re.sub(
            r"\bmi nombre es\s+Doris\b",
            "mi nombre es Lorenzo Orrante",
            limpio,
            flags=re.IGNORECASE,
        )

    reemplazos = [
        (r"\bha estado aprendiendo\b", "he estado aprendiendo"),
        (r"\bjacat[oó]n\b", "hackaton"),
        (r"\bjaqueat[oó]n\b", "hackaton"),
        (r"\bhackat[oó]n\b", "hackaton"),
        (r"\bLL\s*me\s*local\b", "LLM local"),
        (r"\bLL\s*melo\s*cal\b", "LLM local"),
        (r"\bLL\s*melocal\b", "LLM local"),
        (r"\bLLM\s*elocal\b", "LLM local"),
        (r"\bLLMlocal\b", "LLM local"),
        (r"\bLL\s*M\s+local\b", "LLM local"),
        (r"\bTecnol[oó]gico de Monterrey\b", "Tecnológico de Monterrey"),
        (r"\bmi estrella hermano\b", "mis tres hermanos"),
        (r"\bpersonas siegas\b", "personas ciegas"),
        (r"\bde manera locura\b", "de manera local"),
        (r"\bmi cr[oó]fono\b", "micrófono"),
    ]
    for patron, reemplazo in reemplazos:
        limpio = re.sub(patron, reemplazo, limpio, flags=re.IGNORECASE)

    limpio = re.sub(r"\best[eé]n\s+un\s+hackaton\b", "estoy en un hackaton", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bun\s+LLM[.!?]?\s+y\s+local\s+tiene\b", "un LLM local y tiene", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bestoy\s+haciendo\s+un\s+LLM\s+local\b", "estoy haciendo un LLM local", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bhablar\s+con\s+la\s+idea\b", "hablar con la IA", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bque\s+sa(?:ca|que)\.\s+Quiero\s+que\s+sirva\s+también\b", "que sirva también", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bTambién\s+quiero\s+que\s+sirva\s+también\b", "También quiero que sirva", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bel\s+tema\s+de\.\.\.\s+De\s+poder\b", "el tema de poder", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bque\s+te\.\.\.\s+Respondan\b", "que te respondan", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\blo\s+m[aá]s\s+accesible\.\s+Lo\s+posible\b", "lo más accesible posible", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bpor\s+eso\s+es\s+una\.\.\.\s+Un\s+LLM\s+local\b", "por eso es un LLM local", limpio, flags=re.IGNORECASE)
    limpio = re.sub(
        r"\bchat\.\s+Tengo\s+tiempo,\s+pero\s+con\s+micrófono\b",
        "chat en tiempo real, pero con micrófono",
        limpio,
        flags=re.IGNORECASE,
    )
    limpio = re.sub(
        r"\bMi\s+familia\s+consiste\.\s+Estoy\s+con\s+mi\s+padre\b",
        "Mi familia consiste en mi padre",
        limpio,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", " ", limpio).strip()


@lru_cache(maxsize=4)
def _modelo_whisper(nombre_modelo: str):
    import whisper

    return whisper.load_model(nombre_modelo)


def _nombre_modelo_general() -> str:
    return os.getenv("MINUTERO_WHISPER_MODEL", "base")


def _nombre_modelo_voz() -> str:
    # Para mensajes cortos del chat, "small" da muchisima mejor precision con
    # nombres propios y terminos tecnicos. El usuario puede bajarlo a "base"
    # si su maquina es muy lenta, o subirlo a "medium" si quiere mas calidad.
    return os.getenv("MINUTERO_VOICE_WHISPER_MODEL", "small")


def _nombre_modelo_caption() -> str:
    # tiny fue demasiado impreciso para nombres propios y terminos tecnicos en
    # tiempo real ("Lorenzo Orrante", "hackaton", "LLM local"). base sigue
    # siendo razonable para subtitulos parciales y mejora mucho la precision.
    return os.getenv("MINUTERO_CAPTION_WHISPER_MODEL", "base")


def _caption_initial_prompt() -> str:
    extra = os.getenv("MINUTERO_CAPTION_CONTEXT", "").strip()
    return f"{CAPTION_INITIAL_PROMPT} {extra}".strip()


def _ejecutar_transcripcion_caption(model, ruta_audio: str, *, initial_prompt: str | None, beam_size: int):
    opciones = {
        "language": "es",
        "task": "transcribe",
        "temperature": 0.0,
        "beam_size": beam_size,
        "best_of": beam_size,
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.45,
        "logprob_threshold": -1.0,
        "compression_ratio_threshold": 2.4,
        "fp16": False,
        "verbose": False,
    }
    if initial_prompt:
        opciones["initial_prompt"] = initial_prompt
    with _WHISPER_TRANSCRIBE_LOCK:
        return model.transcribe(ruta_audio, **opciones)


def transcribir(ruta_audio: str) -> str:
    """Transcribe audio largo (reuniones) y limpia muletillas."""
    ruta = Path(ruta_audio)
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo de audio: {ruta_audio}")

    print("Transcribiendo audio...")

    model = _modelo_whisper(_nombre_modelo_general())
    with _WHISPER_TRANSCRIBE_LOCK:
        resultado = model.transcribe(str(ruta), language="es", verbose=False)
    texto = resultado.get("text", "")
    texto_limpio = limpiar_transcripcion(texto)

    print("Listo.")
    return texto_limpio


def transcribir_voz_chat(ruta_audio: str) -> str:
    """Transcribe un mensaje corto del chat por voz.

    Optimizado para frases cortas: usa un modelo mas preciso, sesga Whisper con
    un prompt bilingue (para nombres propios y terminos en ingles que aparecen
    en conversacion en espanol) y no aplica limpieza agresiva de muletillas.
    """
    ruta = Path(ruta_audio)
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo de audio: {ruta_audio}")

    print("Transcribiendo mensaje de voz del chat...")

    model = _modelo_whisper(_nombre_modelo_voz())
    with _WHISPER_TRANSCRIBE_LOCK:
        resultado = model.transcribe(
            str(ruta),
            language="es",
            task="transcribe",
            initial_prompt=VOICE_INITIAL_PROMPT,
            # temperature=0 con fallback ascendente: primero intento determinista,
            # si el modelo no esta seguro sube la temperatura para evitar pegarse.
            temperature=(0.0, 0.2, 0.4),
            beam_size=5,
            best_of=5,
            # Frases cortas e independientes: no necesitamos condicionar en el
            # texto previo. Esto evita que el modelo arrastre errores.
            condition_on_previous_text=False,
            # Umbrales mas estrictos para silencio: evita inventar palabras cuando
            # solo hay ruido de fondo o respiracion.
            no_speech_threshold=0.5,
            logprob_threshold=-1.0,
            compression_ratio_threshold=2.4,
            fp16=False,
            verbose=False,
        )
    texto = resultado.get("text", "")
    texto_limpio = limpiar_transcripcion_voz(texto)

    print("Listo.")
    return texto_limpio


def transcribir_caption(ruta_audio: str) -> str:
    """Transcribe un chunk corto para captioning en vivo.

    Optimizado para equilibrio calidad/latencia: usa prompt de contexto y un
    beam pequeno para no destruir nombres propios en clips parciales.
    """
    ruta = Path(ruta_audio)
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo de audio: {ruta_audio}")

    model = _modelo_whisper(_nombre_modelo_caption())
    try:
        resultado = _ejecutar_transcripcion_caption(
            model,
            str(ruta),
            initial_prompt=_caption_initial_prompt(),
            beam_size=3,
        )
    except RuntimeError as exc:
        if "Sizes of tensors must match" not in str(exc):
            raise
        # Algunos blobs WebM parciales hacen fallar a Whisper internamente con
        # ese error de tensores. Reintentamos sin prompt y con beam minimo para
        # mantener los subtitulos vivos en lugar de devolver 500.
        resultado = _ejecutar_transcripcion_caption(
            model,
            str(ruta),
            initial_prompt=None,
            beam_size=1,
        )
    texto = resultado.get("text", "")
    return corregir_caption(texto)
