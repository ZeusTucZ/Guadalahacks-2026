from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

try:
    from .chunk import chunkear
    from .index import contar_chunks, indexar, limpiar_coleccion, obtener_chunks
    from .prompts import prompt_mapa_mental, prompt_resumen
    from .query import LLM_MODEL, generar_respuesta, stream_con_prompt
    from .transcribe import transcribir
except ImportError:
    from chunk import chunkear
    from index import contar_chunks, indexar, limpiar_coleccion, obtener_chunks
    from prompts import prompt_mapa_mental, prompt_resumen
    from query import LLM_MODEL, generar_respuesta, stream_con_prompt
    from transcribe import transcribir


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMP_DIR = BASE_DIR / "temp_audio"

app = FastAPI(title="Minutero", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def inicio() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


def _sse(data: str) -> str:
    data = data.replace("\r", "")
    lineas = data.split("\n")
    return "".join(f"data: {linea}\n" for linea in lineas) + "\n"


def _stream_eventos(tokens: Iterator[str]) -> Iterator[str]:
    try:
        for token in tokens:
            yield _sse(token)
        yield _sse("[DONE]")
    except GeneratorExit:
        print("Cliente desconectado del stream.")
        return
    except Exception as exc:
        yield _sse(f"[ERROR] {exc}")
        yield _sse("[DONE]")


def _stream_texto(texto: str) -> Iterator[str]:
    yield texto


def _contexto_general(limit: int = 5) -> str:
    try:
        chunks = obtener_chunks(limit=limit)
    except Exception:
        return ""
    return "\n---\n".join(chunks)


@app.post("/indexar")
def indexar_audio(audio: UploadFile = File(...)) -> JSONResponse:
    TEMP_DIR.mkdir(exist_ok=True)
    nombre_seguro = Path(audio.filename or "audio").name
    ruta_audio = TEMP_DIR / nombre_seguro

    try:
        with ruta_audio.open("wb") as destino:
            shutil.copyfileobj(audio.file, destino)

        texto = transcribir(str(ruta_audio))
        chunks = chunkear(texto)
        limpiar_coleccion()
        total = indexar(chunks)

        return JSONResponse(
            {
                "ok": True,
                "chunks": total,
                "preview": texto[:200] + ("..." if len(texto) > 200 else ""),
            }
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": str(exc)},
        )
    finally:
        try:
            ruta_audio.unlink(missing_ok=True)
        finally:
            audio.file.close()


@app.get("/resumir")
def resumir() -> StreamingResponse:
    contexto = _contexto_general(limit=5)
    if not contexto:
        tokens = _stream_texto("No hay audio indexado.")
    else:
        tokens = stream_con_prompt(prompt_resumen(contexto))

    return StreamingResponse(
        _stream_eventos(tokens),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/mapa")
def mapa() -> StreamingResponse:
    contexto = _contexto_general(limit=5)
    if not contexto:
        tokens = _stream_texto("# Sin audio indexado\n- Sube y procesa una grabacion primero.")
    else:
        tokens = stream_con_prompt(prompt_mapa_mental(contexto))

    return StreamingResponse(
        _stream_eventos(tokens),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/preguntar")
def preguntar(q: str = Query(..., min_length=1)) -> StreamingResponse:
    return StreamingResponse(
        _stream_eventos(generar_respuesta(q)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _nombres_modelos_ollama(respuesta: Any) -> list[str]:
    modelos = getattr(respuesta, "models", None)
    if modelos is None and isinstance(respuesta, dict):
        modelos = respuesta.get("models", [])

    nombres: list[str] = []
    for modelo in modelos or []:
        nombre = getattr(modelo, "model", None) or getattr(modelo, "name", None)
        if nombre is None and isinstance(modelo, dict):
            nombre = modelo.get("model") or modelo.get("name")
        if nombre:
            nombres.append(str(nombre))
    return nombres


def _estado_ollama() -> tuple[bool, bool]:
    try:
        import ollama

        respuesta = ollama.list()
        nombres = _nombres_modelos_ollama(respuesta)
        modelo_listo = any(nombre == LLM_MODEL or nombre.startswith(f"{LLM_MODEL}:") for nombre in nombres)
        return True, modelo_listo
    except Exception:
        return False, False


@app.get("/estado")
def estado() -> JSONResponse:
    ollama_ok, modelo_ok = _estado_ollama()
    try:
        chunks = contar_chunks()
    except Exception:
        chunks = 0

    return JSONResponse(
        {
            "ollama": ollama_ok,
            "modelo": modelo_ok,
            "chunks_indexados": chunks,
        }
    )
