from __future__ import annotations

from collections.abc import Iterator
from typing import Any

try:
    from .index import COLLECTION_NAME, EMBEDDING_MODEL, _cliente_chroma
    from .prompts import prompt_pregunta
except ImportError:
    from index import COLLECTION_NAME, EMBEDDING_MODEL, _cliente_chroma
    from prompts import prompt_pregunta


LLM_MODEL = "minutero"
TOP_K = 3


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


def stream_con_prompt(prompt: str) -> Iterator[str]:
    import ollama

    stream = ollama.chat(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        stream=True,
    )

    for parte in stream:
        mensaje = parte.get("message", {})
        token = mensaje.get("content", "")
        if token:
            yield token


def generar_respuesta(pregunta: str) -> Iterator[str]:
    chunks = recuperar_chunks(pregunta)
    if not chunks:
        yield "No encontrado en la grabacion."
        return

    contexto = "\n---\n".join(chunks)
    prompt = prompt_pregunta(contexto, pregunta)
    yield from stream_con_prompt(prompt)
