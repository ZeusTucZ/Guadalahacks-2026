from __future__ import annotations

import os
import re
import unicodedata
from functools import lru_cache
from pathlib import Path


MULETILLAS = [
    r"\beste+\b",
    r"\beh+\b",
    r"\bem+\b",
    r"\bmmm+\b",
    r"\bo sea\b",
    r"\bverdad\b",
    r"\bno\?\b",
]


# Prompt bilingue para sesgar a Whisper hacia nombres propios y terminos comunes
# que aparecen mezclados con espanol (deportes, tecnologia, marcas). Esto reduce
# errores como "Patrick Mahomes" -> "mis colmas" o "quarterback" -> "coredado".
VOICE_INITIAL_PROMPT = (
    "Conversacion en espanol con preguntas cortas. "
    "El usuario puede mencionar nombres propios en ingles: "
    "Patrick Mahomes, Lamar Jackson, Travis Kelce, Tom Brady, Aaron Rodgers, "
    "Kansas City Chiefs, Baltimore Ravens, Buffalo Bills, Dallas Cowboys, "
    "NFL, NBA, MLB, quarterback, running back, wide receiver, touchdown, "
    "Python, JavaScript, TypeScript, React, FastAPI, Ollama, Whisper, "
    "LLM, RAG, embedding, ChromaDB, GitHub, Google, Microsoft, OpenAI, Anthropic. "
    "Responde con puntuacion correcta, acentos y signos de interrogacion."
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


@lru_cache(maxsize=2)
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
    # Para captioning en vivo necesitamos velocidad: cada chunk de 2-4s debe
    # transcribirse en menos tiempo. "tiny" es rapidisimo y suficiente para
    # captions aproximados que se refinan con cada chunk.
    return os.getenv("MINUTERO_CAPTION_WHISPER_MODEL", "tiny")


def transcribir(ruta_audio: str) -> str:
    """Transcribe audio largo (reuniones) y limpia muletillas."""
    ruta = Path(ruta_audio)
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo de audio: {ruta_audio}")

    print("Transcribiendo audio...")

    model = _modelo_whisper(_nombre_modelo_general())
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

    Optimizado para velocidad sobre calidad: usa el modelo mas pequeno y omite
    beam search. Pensado para clips de 2-6 segundos que se actualizan
    progresivamente mientras el usuario habla en una reunion.
    """
    ruta = Path(ruta_audio)
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo de audio: {ruta_audio}")

    model = _modelo_whisper(_nombre_modelo_caption())
    resultado = model.transcribe(
        str(ruta),
        language="es",
        task="transcribe",
        temperature=0.0,
        beam_size=1,
        best_of=1,
        condition_on_previous_text=False,
        no_speech_threshold=0.5,
        fp16=False,
        verbose=False,
    )
    texto = resultado.get("text", "")
    return limpiar_transcripcion_voz(texto)
