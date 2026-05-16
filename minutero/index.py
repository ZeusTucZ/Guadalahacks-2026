from __future__ import annotations

from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
CHROMA_PATH = str(BASE_DIR / "chroma_db")
COLLECTION_NAME = "minutero"
EMBEDDING_MODEL = "nomic-embed-text"


def _cliente_chroma():
    import chromadb

    return chromadb.PersistentClient(path=CHROMA_PATH)


def _coleccion():
    cliente = _cliente_chroma()
    return cliente.get_or_create_collection(name=COLLECTION_NAME)


def _embedding(texto: str) -> list[float]:
    import ollama

    respuesta: dict[str, Any] = ollama.embeddings(model=EMBEDDING_MODEL, prompt=texto)
    embedding = getattr(respuesta, "embedding", None)
    if embedding is None and isinstance(respuesta, dict):
        embedding = respuesta.get("embedding")
    if embedding is None:
        raise RuntimeError("Ollama no devolvio embedding.")
    return embedding


def limpiar_coleccion() -> None:
    cliente = _cliente_chroma()
    try:
        cliente.delete_collection(name=COLLECTION_NAME)
    except Exception:
        pass
    cliente.get_or_create_collection(name=COLLECTION_NAME)


def indexar(chunks: list[str]) -> int:
    coleccion = _coleccion()

    if not chunks:
        print("Indexacion completa.")
        return 0

    total = len(chunks)
    for i, chunk in enumerate(chunks):
        print(f"Indexando chunk {i + 1}/{total}...")
        coleccion.add(
            ids=[f"chunk_{i}"],
            embeddings=[_embedding(chunk)],
            documents=[chunk],
            metadatas=[{"orden": i}],
        )

    print("Indexacion completa.")
    return total


def contar_chunks() -> int:
    return _coleccion().count()


def obtener_chunks(limit: int | None = None) -> list[str]:
    coleccion = _coleccion()
    total = coleccion.count()
    if total == 0:
        return []

    resultado = coleccion.get(include=["documents", "metadatas"])
    documentos = resultado.get("documents", [])
    metadatas = resultado.get("metadatas", [])

    pares = []
    for documento, metadata in zip(documentos, metadatas):
        orden = metadata.get("orden", 0) if metadata else 0
        pares.append((orden, documento))

    pares.sort(key=lambda item: item[0])
    documentos_ordenados = [documento for _, documento in pares]
    return documentos_ordenados[:limit] if limit else documentos_ordenados
