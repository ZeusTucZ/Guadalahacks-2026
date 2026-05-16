from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

try:
    from .index import COLLECTION_NAME, EMBEDDING_MODEL, _cliente_chroma
    from .prompts import prompt_chat, prompt_pregunta
except ImportError:
    from index import COLLECTION_NAME, EMBEDDING_MODEL, _cliente_chroma
    from prompts import prompt_chat, prompt_pregunta


LLM_MODEL = os.getenv("MINUTERO_LLM_MODEL", "minutero")
LLM_KEEP_ALIVE = os.getenv("MINUTERO_KEEP_ALIVE", "30m")
LLM_NUM_CTX = int(os.getenv("MINUTERO_NUM_CTX", "4096"))
LLM_NUM_PREDICT = int(os.getenv("MINUTERO_NUM_PREDICT", "512"))
TOP_K = 3
MAX_CHAT_TURNS = 8
MAX_CHAT_CHARS = 1200


def _opciones_generacion(num_predict: int | None = None) -> dict[str, float | int]:
    return {
        "temperature": 0.3,
        "top_p": 0.9,
        "num_ctx": LLM_NUM_CTX,
        "num_predict": num_predict or LLM_NUM_PREDICT,
    }


def _embedding(texto: str) -> list[float]:
    import ollama

    respuesta: dict[str, Any] = ollama.embeddings(model=EMBEDDING_MODEL, prompt=texto)
    embedding = getattr(respuesta, "embedding", None)
    if embedding is None and isinstance(respuesta, dict):
        embedding = respuesta.get("embedding")
    if embedding is None:
        raise RuntimeError("Ollama no devolvio embedding.")
    return embedding


def recuperar_chunks(pregunta: str) -> list[str]:
    cliente = _cliente_chroma()
    coleccion = cliente.get_or_create_collection(name=COLLECTION_NAME)

    total = coleccion.count()
    if total == 0:
        return []

    pregunta_embedding = _embedding(pregunta)
    resultado = coleccion.query(
        query_embeddings=[pregunta_embedding],
        n_results=min(TOP_K, total),
        include=["documents"],
    )
    documentos = resultado.get("documents", [[]])
    return documentos[0] if documentos else []


def _normalizar_historial(historial: list[dict[str, str]]) -> list[dict[str, str]]:
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


def _formatear_historial(historial: list[dict[str, str]]) -> str:
    historial_limpio = _normalizar_historial(historial)
    if not historial_limpio:
        return "Sin historial previo."

    etiquetas = {"user": "Usuario", "assistant": "Minutero"}
    return "\n".join(
        f"{etiquetas[turno['role']]}: {turno['content']}" for turno in historial_limpio
    )


def _consulta_para_retrieval(mensaje: str, historial: list[dict[str, str]]) -> str:
    historial_limpio = _normalizar_historial(historial)
    ultimos_usuarios = [
        turno["content"] for turno in historial_limpio if turno["role"] == "user"
    ][-3:]
    return " ".join([*ultimos_usuarios, mensaje]).strip()


def stream_con_prompt(prompt: str) -> Iterator[str]:
    import ollama

    stream = ollama.chat(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        stream=True,
        keep_alive=LLM_KEEP_ALIVE,
        options=_opciones_generacion(),
    )

    for parte in stream:
        mensaje = parte.get("message", {})
        token = mensaje.get("content", "")
        if token:
            yield token


def calentar_modelo() -> None:
    """Carga el modelo en Ollama para reducir la latencia del primer token."""
    try:
        import ollama

        ollama.chat(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": "Responde solo: ok"}],
            stream=False,
            keep_alive=LLM_KEEP_ALIVE,
            options=_opciones_generacion(num_predict=2),
        )
        print(f"Modelo {LLM_MODEL} caliente.")
    except Exception as exc:
        print(f"No se pudo calentar el modelo {LLM_MODEL}: {exc}")


def generar_respuesta(pregunta: str) -> Iterator[str]:
    chunks = recuperar_chunks(pregunta)
    if not chunks:
        yield "No encontrado en la grabacion."
        return

    contexto = "\n---\n".join(chunks)
    prompt = prompt_pregunta(contexto, pregunta)
    yield from stream_con_prompt(prompt)


def generar_chat(mensaje: str, historial: list[dict[str, str]]) -> Iterator[str]:
    consulta = _consulta_para_retrieval(mensaje, historial)
    chunks = recuperar_chunks(consulta or mensaje)
    if not chunks:
        yield "No hay audio indexado. Sube o graba audio primero para poder conversar sobre la reunion."
        return

    contexto = "\n---\n".join(chunks)
    prompt = prompt_chat(contexto, _formatear_historial(historial), mensaje)
    yield from stream_con_prompt(prompt)
