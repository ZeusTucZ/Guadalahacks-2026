from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


BASE_DIR = Path(__file__).resolve().parent
CHROMA_PATH = str(BASE_DIR / "chroma_db")
COLLECTION_NAME = "minutero"
EMBEDDING_MODEL = "nomic-embed-text"
_CLIENTE_CHROMA: Any | None = None
_CLIENTE_CHROMA_LOCK = threading.Lock()


def _cliente_chroma():
    global _CLIENTE_CHROMA

    if _CLIENTE_CHROMA is not None:
        return _CLIENTE_CHROMA

    import chromadb

    with _CLIENTE_CHROMA_LOCK:
        if _CLIENTE_CHROMA is None:
            _CLIENTE_CHROMA = chromadb.PersistentClient(path=CHROMA_PATH)
        return _CLIENTE_CHROMA


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
    """Borra TODOS los chunks de TODAS las grabaciones. Usalo solo si el
    usuario explicitamente quiere reiniciar la memoria."""
    cliente = _cliente_chroma()
    try:
        cliente.delete_collection(name=COLLECTION_NAME)
    except Exception:
        pass
    cliente.get_or_create_collection(name=COLLECTION_NAME)


def borrar_grabacion(audio_id: str) -> int:
    """Borra solo los chunks de una grabacion especifica."""
    coleccion = _coleccion()
    resultado = coleccion.get(where={"audio_id": audio_id}, include=[])
    ids = resultado.get("ids", []) or []
    if ids:
        coleccion.delete(ids=ids)
    return len(ids)


def indexar(
    chunks: list[str],
    audio_id: str | None = None,
    audio_name: str | None = None,
) -> int:
    """Indexa una nueva grabacion. Los chunks se ACUMULAN con grabaciones
    anteriores; el chat puede consultar entre todas. Cada chunk lleva metadata
    para saber a que grabacion pertenece.
    """
    coleccion = _coleccion()

    if not chunks:
        print("Indexacion completa.")
        return 0

    if audio_id is None:
        audio_id = uuid4().hex
    indexado_en = datetime.now(timezone.utc).isoformat()
    nombre = audio_name or "grabacion"

    total = len(chunks)
    for i, chunk in enumerate(chunks):
        print(f"Indexando chunk {i + 1}/{total} de {nombre}...")
        coleccion.add(
            ids=[f"{audio_id}_{i}"],
            embeddings=[_embedding(chunk)],
            documents=[chunk],
            metadatas=[
                {
                    "audio_id": audio_id,
                    "audio_name": nombre,
                    "indexado_en": indexado_en,
                    "orden": i,
                }
            ],
        )

    print("Indexacion completa.")
    return total


def contar_chunks() -> int:
    return _coleccion().count()


def obtener_chunks(
    limit: int | None = None,
    audio_id: str | None = None,
) -> list[str]:
    """Devuelve chunks ordenados. Si audio_id se especifica, solo trae los de
    esa grabacion; sin filtro, devuelve los mas recientes primero (util para
    el resumen general que muestra la sesion mas reciente)."""
    coleccion = _coleccion()
    total = coleccion.count()
    if total == 0:
        return []

    where: dict[str, Any] | None = {"audio_id": audio_id} if audio_id else None
    resultado = coleccion.get(where=where, include=["documents", "metadatas"])
    documentos = resultado.get("documents", [])
    metadatas = resultado.get("metadatas", [])

    pares = []
    for documento, metadata in zip(documentos, metadatas):
        meta = metadata or {}
        indexado_en = meta.get("indexado_en", "")
        orden = meta.get("orden", 0)
        pares.append((indexado_en, orden, documento))

    # Ordenamos por (timestamp DESC, orden ASC). El resumen y mapa usan los
    # de la grabacion mas reciente sin tener que conocer su audio_id.
    pares.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    documentos_ordenados = [documento for _, _, documento in pares]
    return documentos_ordenados[:limit] if limit else documentos_ordenados


def listar_grabaciones() -> list[dict[str, Any]]:
    """Devuelve la lista de grabaciones indexadas con su nombre y conteo."""
    coleccion = _coleccion()
    resultado = coleccion.get(include=["metadatas"])
    metadatas = resultado.get("metadatas", []) or []

    agrupado: dict[str, dict[str, Any]] = {}
    legacy_chunks = 0
    for metadata in metadatas:
        if not metadata:
            legacy_chunks += 1
            continue
        audio_id = metadata.get("audio_id")
        if not audio_id:
            # Chunks indexados con la version anterior del schema, sin audio_id.
            legacy_chunks += 1
            continue
        if audio_id not in agrupado:
            agrupado[audio_id] = {
                "audio_id": audio_id,
                "audio_name": metadata.get("audio_name", "grabacion"),
                "indexado_en": metadata.get("indexado_en", ""),
                "chunks": 0,
            }
        agrupado[audio_id]["chunks"] += 1

    if legacy_chunks > 0:
        agrupado["__legacy__"] = {
            "audio_id": "__legacy__",
            "audio_name": "Grabacion anterior (sin metadata)",
            "indexado_en": "",
            "chunks": legacy_chunks,
        }

    return sorted(
        agrupado.values(),
        key=lambda item: item["indexado_en"],
        reverse=True,
    )
