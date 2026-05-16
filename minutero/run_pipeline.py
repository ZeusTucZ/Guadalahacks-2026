from __future__ import annotations

import argparse
from pathlib import Path

try:
    from .chunk import chunkear
    from .index import indexar, limpiar_coleccion
    from .transcribe import transcribir
except ImportError:
    from chunk import chunkear
    from index import indexar, limpiar_coleccion
    from transcribe import transcribir


def main() -> None:
    parser = argparse.ArgumentParser(description="Pipeline local de Minutero")
    parser.add_argument("audio", help="Ruta del archivo de audio")
    parser.add_argument(
        "--out",
        default="outputs",
        help="Carpeta donde se guarda la transcripcion",
    )
    args = parser.parse_args()

    salida = Path(args.out)
    salida.mkdir(parents=True, exist_ok=True)

    texto = transcribir(args.audio)
    (salida / "transcripcion.txt").write_text(texto, encoding="utf-8")

    chunks = chunkear(texto)
    limpiar_coleccion()
    total = indexar(chunks)

    print(f"Pipeline completo. Chunks indexados: {total}")
    print(f"Transcripcion guardada en: {salida / 'transcripcion.txt'}")


if __name__ == "__main__":
    main()
