from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from .chunk import chunkear
    from .index import (
        borrar_grabacion,
        contar_chunks,
        indexar,
        limpiar_coleccion,
        listar_grabaciones,
        obtener_chunks,
    )
    from .query import LLM_MODEL, calentar_modelo, generar_chat, generar_mapa_seguro, generar_respuesta, generar_resumen_seguro
    from .transcribe import transcribir, transcribir_caption, transcribir_voz_chat
except ImportError:
    from chunk import chunkear
    from index import (
        borrar_grabacion,
        contar_chunks,
        indexar,
        limpiar_coleccion,
        listar_grabaciones,
        obtener_chunks,
    )
    from query import LLM_MODEL, calentar_modelo, generar_chat, generar_mapa_seguro, generar_respuesta, generar_resumen_seguro
    from transcribe import transcribir, transcribir_caption, transcribir_voz_chat


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMP_DIR = BASE_DIR / "temp_audio"


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    mensaje: str = Field(..., min_length=1)
    historial: list[ChatTurn] = Field(default_factory=list)
    modo_lectura_facil: bool = False

app = FastAPI(title="Minutero", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
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


# Intervalo de heartbeat. Resumenes y mapas pueden tardar 20-40s en producir el
# primer token cuando llaman al LLM en modo no-streaming. Sin heartbeats, los
# proxies (Vite, nginx) y algunos navegadores cierran la conexion con 502 al
# pasar ~30 segundos sin recibir bytes.
_HEARTBEAT_SECONDS = 2.0
_SSE_SENTINEL_DONE = object()
_SSE_ERROR_MARKER = "__SSE_ERROR__"


def _stream_eventos(tokens: Iterator[str]) -> Iterator[str]:
    """Convierte un iterador de tokens en eventos SSE, intercalando heartbeats.

    Ejecuta el iterador en un hilo separado para poder emitir comentarios SSE
    `: heartbeat` cuando no hay datos, manteniendo la conexion viva mientras el
    LLM bloquea esperando una respuesta completa.
    """
    import queue
    import threading

    q: "queue.Queue[Any]" = queue.Queue()

    def producer() -> None:
        try:
            for token in tokens:
                q.put(token)
        except Exception as exc:  # noqa: BLE001
            q.put((_SSE_ERROR_MARKER, str(exc)))
        finally:
            q.put(_SSE_SENTINEL_DONE)

    threading.Thread(target=producer, daemon=True).start()

    try:
        while True:
            try:
                item = q.get(timeout=_HEARTBEAT_SECONDS)
            except queue.Empty:
                # Comentario SSE: el navegador lo ignora, el proxy ve trafico.
                yield ": heartbeat\n\n"
                continue

            if item is _SSE_SENTINEL_DONE:
                yield _sse("[DONE]")
                return
            if isinstance(item, tuple) and item and item[0] == _SSE_ERROR_MARKER:
                yield _sse(f"[ERROR] {item[1]}")
                yield _sse("[DONE]")
                return
            yield _sse(item)
    except GeneratorExit:
        print("Cliente desconectado del stream.")
        return


def _stream_texto(texto: str) -> Iterator[str]:
    yield texto


def _contexto_general(limit: int = 5) -> str:
    try:
        chunks = obtener_chunks(limit=limit)
    except Exception:
        return ""
    return "\n---\n".join(chunks)


@app.post("/indexar")
def indexar_audio(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    reemplazar: bool = Query(False, description="Si true, borra toda la memoria previa"),
) -> JSONResponse:
    TEMP_DIR.mkdir(exist_ok=True)
    nombre_seguro = Path(audio.filename or "audio").name
    ruta_audio = TEMP_DIR / f"index-{uuid4().hex}-{nombre_seguro}"

    try:
        with ruta_audio.open("wb") as destino:
            shutil.copyfileobj(audio.file, destino)

        texto = transcribir(str(ruta_audio))
        if not texto.strip():
            return JSONResponse(
                status_code=422,
                content={"ok": False, "error": "No se detecto voz clara en el audio."},
            )

        chunks = chunkear(texto)
        if not chunks:
            return JSONResponse(
                status_code=422,
                content={"ok": False, "error": "La transcripcion no produjo fragmentos indexables."},
            )

        if reemplazar:
            limpiar_coleccion()
        # Acumulativo por defecto: cada grabacion se anade con su propio
        # audio_id, conservando el historial cruzado para busqueda RAG.
        audio_id = uuid4().hex
        total = indexar(chunks, audio_id=audio_id, audio_name=nombre_seguro)
        background_tasks.add_task(calentar_modelo)

        return JSONResponse(
            {
                "ok": True,
                "audio_id": audio_id,
                "audio_name": nombre_seguro,
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


@app.get("/grabaciones")
def listar_grabaciones_endpoint() -> JSONResponse:
    """Lista todas las grabaciones indexadas en la memoria local."""
    return JSONResponse({"ok": True, "grabaciones": listar_grabaciones()})


@app.delete("/grabaciones/{audio_id}")
def borrar_grabacion_endpoint(audio_id: str) -> JSONResponse:
    eliminados = borrar_grabacion(audio_id)
    return JSONResponse({"ok": True, "eliminados": eliminados})


@app.delete("/grabaciones")
def borrar_todas_grabaciones() -> JSONResponse:
    limpiar_coleccion()
    return JSONResponse({"ok": True})


@app.post("/caption")
def caption_audio(audio: UploadFile = File(...)) -> JSONResponse:
    """Transcribe un chunk corto para captioning en vivo durante grabacion."""
    TEMP_DIR.mkdir(exist_ok=True)
    nombre_seguro = Path(audio.filename or "caption.webm").name
    ruta_audio = TEMP_DIR / f"caption-{uuid4().hex}-{nombre_seguro}"

    try:
        with ruta_audio.open("wb") as destino:
            shutil.copyfileobj(audio.file, destino)
        texto = transcribir_caption(str(ruta_audio))
        return JSONResponse({"ok": True, "texto": texto})
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


@app.post("/transcribir-chat")
def transcribir_chat_audio(audio: UploadFile = File(...)) -> JSONResponse:
    TEMP_DIR.mkdir(exist_ok=True)
    nombre_seguro = Path(audio.filename or "mensaje-voz.webm").name
    ruta_audio = TEMP_DIR / f"chat-{uuid4().hex}-{nombre_seguro}"

    try:
        with ruta_audio.open("wb") as destino:
            shutil.copyfileobj(audio.file, destino)

        texto = transcribir_voz_chat(str(ruta_audio))
        if not texto.strip():
            return JSONResponse(
                status_code=422,
                content={"ok": False, "error": "No se detecto voz clara en el audio."},
            )

        return JSONResponse({"ok": True, "texto": texto})
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
        tokens = generar_resumen_seguro(contexto)

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
        tokens = generar_mapa_seguro(contexto)

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


@app.post("/chat")
def chat(payload: ChatRequest) -> StreamingResponse:
    historial = [{"role": turno.role, "content": turno.content} for turno in payload.historial]
    return StreamingResponse(
        _stream_eventos(
            generar_chat(
                payload.mensaje,
                historial,
                modo_lectura_facil=payload.modo_lectura_facil,
            )
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/calentar")
def calentar() -> JSONResponse:
    calentar_modelo()
    return JSONResponse({"ok": True, "modelo": LLM_MODEL})


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
            "modelo_nombre": LLM_MODEL,
            "chunks_indexados": chunks,
        }
    )
