from __future__ import annotations

import shutil
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, Query, UploadFile
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
        obtener_chunks_ultima_grabacion,
    )
    from .query import (
        LLM_MODEL,
        approx_tokens,
        calentar_modelo,
        generar_chat,
        generar_mapa_seguro,
        generar_respuesta,
        generar_resumen_seguro,
        log_metric,
    )
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
        obtener_chunks_ultima_grabacion,
    )
    from query import (
        LLM_MODEL,
        approx_tokens,
        calentar_modelo,
        generar_chat,
        generar_mapa_seguro,
        generar_respuesta,
        generar_resumen_seguro,
        log_metric,
    )
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

app = FastAPI(title="Lux", version="0.1.0")

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
        chunks = obtener_chunks_ultima_grabacion(limit=limit)
    except Exception:
        return ""
    return "\n---\n".join(chunks)


@app.post("/indexar")
def indexar_audio(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    reemplazar: bool = Query(False, description="Si true, borra toda la memoria previa"),
) -> JSONResponse:
    started_at = time.perf_counter()
    TEMP_DIR.mkdir(exist_ok=True)
    nombre_seguro = Path(audio.filename or "audio").name
    ruta_audio = TEMP_DIR / f"index-{uuid4().hex}-{nombre_seguro}"
    log_metric(
        "INDEX",
        {
            "endpoint": "/indexar",
            "phase": "start",
            "audio_name": nombre_seguro,
            "reemplazar": reemplazar,
        },
    )

    try:
        with ruta_audio.open("wb") as destino:
            shutil.copyfileobj(audio.file, destino)

        transcribe_start = time.perf_counter()
        texto = transcribir(str(ruta_audio))
        transcripcion_ms = (time.perf_counter() - transcribe_start) * 1000
        if not texto.strip():
            log_metric(
                "INDEX",
                {
                    "endpoint": "/indexar",
                    "phase": "end",
                    "status": "no_voice",
                    "audio_name": nombre_seguro,
                    "transcripcion_ms": round(transcripcion_ms, 2),
                    "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                    "chunks": 0,
                    "transcript_chars": 0,
                    "transcript_tokens_aprox": 0,
                    "avg_chunk_chars": 0,
                },
            )
            return JSONResponse(
                status_code=422,
                content={"ok": False, "error": "No se detecto voz clara en el audio."},
            )

        chunks = chunkear(texto)
        transcript_chars = len(texto)
        avg_chunk_chars = round(
            sum(len(chunk) for chunk in chunks) / len(chunks),
            2,
        ) if chunks else 0
        if not chunks:
            log_metric(
                "INDEX",
                {
                    "endpoint": "/indexar",
                    "phase": "end",
                    "status": "no_chunks",
                    "audio_name": nombre_seguro,
                    "transcripcion_ms": round(transcripcion_ms, 2),
                    "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                    "chunks": 0,
                    "transcript_chars": transcript_chars,
                    "transcript_tokens_aprox": approx_tokens(texto),
                    "avg_chunk_chars": 0,
                },
            )
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
        log_metric(
            "INDEX",
            {
                "endpoint": "/indexar",
                "phase": "end",
                "status": "ok",
                "audio_name": nombre_seguro,
                "audio_id": audio_id,
                "transcripcion_ms": round(transcripcion_ms, 2),
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                "chunks": len(chunks),
                "indexed_chunks": total,
                "transcript_chars": transcript_chars,
                "transcript_tokens_aprox": approx_tokens(texto),
                "avg_chunk_chars": avg_chunk_chars,
            },
        )

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
        log_metric(
            "INDEX",
            {
                "endpoint": "/indexar",
                "phase": "end",
                "status": "error",
                "audio_name": nombre_seguro,
                "error": type(exc).__name__,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
            },
        )
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
def caption_audio(
    audio: UploadFile = File(...),
    contexto: str = Form("", description="Texto previo acumulado para mejorar continuidad"),
) -> JSONResponse:
    """Transcribe un chunk corto para captioning en vivo durante grabacion."""
    started_at = time.perf_counter()
    TEMP_DIR.mkdir(exist_ok=True)
    nombre_seguro = Path(audio.filename or "caption.webm").name
    ruta_audio = TEMP_DIR / f"caption-{uuid4().hex}-{nombre_seguro}"
    log_metric(
        "WHISPER_ONLY",
        {
            "endpoint": "/caption",
            "phase": "start",
            "audio_name": nombre_seguro,
            "context_chars": len(contexto),
            "context_tokens_aprox": approx_tokens(contexto),
            "uses_llm_tokens": False,
        },
    )

    try:
        with ruta_audio.open("wb") as destino:
            shutil.copyfileobj(audio.file, destino)
        whisper_start = time.perf_counter()
        texto = transcribir_caption(str(ruta_audio), contexto_previo=contexto)
        log_metric(
            "WHISPER_ONLY",
            {
                "endpoint": "/caption",
                "phase": "end",
                "status": "ok",
                "audio_name": nombre_seguro,
                "output_chars": len(texto),
                "output_tokens_aprox": 0,
                "whisper_ms": round((time.perf_counter() - whisper_start) * 1000, 2),
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                "uses_llm_tokens": False,
            },
        )
        return JSONResponse({"ok": True, "texto": texto})
    except Exception as exc:
        log_metric(
            "WHISPER_ONLY",
            {
                "endpoint": "/caption",
                "phase": "end",
                "status": "error",
                "audio_name": nombre_seguro,
                "error": type(exc).__name__,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                "uses_llm_tokens": False,
            },
        )
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
    started_at = time.perf_counter()
    TEMP_DIR.mkdir(exist_ok=True)
    nombre_seguro = Path(audio.filename or "mensaje-voz.webm").name
    ruta_audio = TEMP_DIR / f"chat-{uuid4().hex}-{nombre_seguro}"
    log_metric(
        "WHISPER_ONLY",
        {
            "endpoint": "/transcribir-chat",
            "phase": "start",
            "audio_name": nombre_seguro,
            "uses_llm_tokens": False,
        },
    )

    try:
        with ruta_audio.open("wb") as destino:
            shutil.copyfileobj(audio.file, destino)

        whisper_start = time.perf_counter()
        texto = transcribir_voz_chat(str(ruta_audio))
        if not texto.strip():
            log_metric(
                "WHISPER_ONLY",
                {
                    "endpoint": "/transcribir-chat",
                    "phase": "end",
                    "status": "no_voice",
                    "audio_name": nombre_seguro,
                    "output_chars": 0,
                    "output_tokens_aprox": 0,
                    "whisper_ms": round((time.perf_counter() - whisper_start) * 1000, 2),
                    "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                    "uses_llm_tokens": False,
                },
            )
            return JSONResponse(
                status_code=422,
                content={"ok": False, "error": "No se detecto voz clara en el audio."},
            )

        log_metric(
            "WHISPER_ONLY",
            {
                "endpoint": "/transcribir-chat",
                "phase": "end",
                "status": "ok",
                "audio_name": nombre_seguro,
                "output_chars": len(texto),
                "output_tokens_aprox": 0,
                "whisper_ms": round((time.perf_counter() - whisper_start) * 1000, 2),
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                "uses_llm_tokens": False,
            },
        )
        return JSONResponse({"ok": True, "texto": texto})
    except Exception as exc:
        log_metric(
            "WHISPER_ONLY",
            {
                "endpoint": "/transcribir-chat",
                "phase": "end",
                "status": "error",
                "audio_name": nombre_seguro,
                "error": type(exc).__name__,
                "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
                "uses_llm_tokens": False,
            },
        )
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
    started_at = time.perf_counter()
    log_metric("ENDPOINT", {"endpoint": "/resumir", "phase": "start"})
    contexto = _contexto_general(limit=5)
    chunks_contexto = contexto.split("\n---\n") if contexto else []
    if not contexto:
        tokens = _stream_texto("No hay audio indexado.")
    else:
        tokens = generar_resumen_seguro(contexto)

    log_metric(
        "ENDPOINT",
        {
            "endpoint": "/resumir",
            "phase": "response_started",
            "context_chunks": len(chunks_contexto),
            "context_chars": len(contexto),
            "context_tokens_aprox": approx_tokens(contexto),
            "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
        },
    )
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
    started_at = time.perf_counter()
    log_metric(
        "ENDPOINT",
        {
            "endpoint": "/preguntar",
            "phase": "start",
            "question_chars": len(q),
            "question_tokens_aprox": approx_tokens(q),
        },
    )
    tokens = generar_respuesta(q)
    log_metric(
        "ENDPOINT",
        {
            "endpoint": "/preguntar",
            "phase": "response_started",
            "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
        },
    )
    return StreamingResponse(
        _stream_eventos(tokens),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/chat")
def chat(payload: ChatRequest) -> StreamingResponse:
    started_at = time.perf_counter()
    historial = [{"role": turno.role, "content": turno.content} for turno in payload.historial]
    history_chars = sum(len(turno["content"]) for turno in historial)
    log_metric(
        "ENDPOINT",
        {
            "endpoint": "/chat",
            "phase": "start",
            "history_messages": len(historial),
            "history_chars": history_chars,
            "history_tokens_aprox": approx_tokens("".join(turno["content"] for turno in historial)),
            "user_msg_chars": len(payload.mensaje),
            "user_msg_tokens_aprox": approx_tokens(payload.mensaje),
            "modo_lectura_facil": payload.modo_lectura_facil,
        },
    )
    tokens = generar_chat(
        payload.mensaje,
        historial,
        modo_lectura_facil=payload.modo_lectura_facil,
    )
    log_metric(
        "ENDPOINT",
        {
            "endpoint": "/chat",
            "phase": "response_started",
            "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
        },
    )
    return StreamingResponse(
        _stream_eventos(tokens),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/calentar")
def calentar() -> JSONResponse:
    started_at = time.perf_counter()
    log_metric("ENDPOINT", {"endpoint": "/calentar", "phase": "start"})
    calentar_modelo()
    log_metric(
        "ENDPOINT",
        {
            "endpoint": "/calentar",
            "phase": "end",
            "total_ms": round((time.perf_counter() - started_at) * 1000, 2),
        },
    )
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
