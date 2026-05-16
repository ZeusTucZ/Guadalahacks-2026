from __future__ import annotations

import re
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


def transcribir(ruta_audio: str) -> str:
    ruta = Path(ruta_audio)
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo de audio: {ruta_audio}")

    print("Transcribiendo audio...")

    import whisper

    model = whisper.load_model("base")
    resultado = model.transcribe(str(ruta), language="es", verbose=False)
    texto = resultado.get("text", "")
    texto_limpio = limpiar_transcripcion(texto)

    print("Listo.")
    return texto_limpio
