from __future__ import annotations

import re


CHUNK_SIZE = 800
OVERLAP = 160
MIN_CHUNK_SIZE = 100


def _buscar_corte(texto: str, inicio: int, limite: int) -> int:
    limite = min(limite, len(texto))
    ventana = texto[inicio:limite]

    mejor = max(ventana.rfind(". "), ventana.rfind("? "), ventana.rfind("! "))
    if mejor != -1 and mejor > int(len(ventana) * 0.55):
        return inicio + mejor + 1

    coma = ventana.rfind(", ")
    if coma != -1 and coma > int(len(ventana) * 0.65):
        return inicio + coma + 1

    espacio = ventana.rfind(" ")
    if espacio != -1 and espacio > int(len(ventana) * 0.5):
        return inicio + espacio

    return limite


def _normalizar(texto: str) -> str:
    texto = re.sub(r"\s+", " ", texto)
    return texto.strip()


def chunkear(texto: str) -> list[str]:
    texto = _normalizar(texto)
    if not texto:
        print("Dividiendo en 0 chunks...")
        return []

    if len(texto) <= CHUNK_SIZE:
        chunks = [texto] if len(texto) >= MIN_CHUNK_SIZE else [texto]
        print(f"Dividiendo en {len(chunks)} chunks...")
        return chunks

    chunks: list[str] = []
    inicio = 0

    while inicio < len(texto):
        limite = inicio + CHUNK_SIZE
        fin = _buscar_corte(texto, inicio, limite)
        chunk = texto[inicio:fin].strip()

        if len(chunk) >= MIN_CHUNK_SIZE:
            chunks.append(chunk)

        if fin >= len(texto):
            break

        siguiente_inicio = max(0, fin - OVERLAP)
        if siguiente_inicio <= inicio:
            siguiente_inicio = fin
        while siguiente_inicio < len(texto) and texto[siguiente_inicio] != " ":
            siguiente_inicio += 1
        inicio = min(siguiente_inicio + 1, len(texto))

    print(f"Dividiendo en {len(chunks)} chunks...")
    return chunks
