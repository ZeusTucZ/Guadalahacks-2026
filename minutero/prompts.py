from __future__ import annotations


def prompt_resumen(contexto: str) -> str:
    return f"""
Contexto de la reunion:
{contexto}

Genera un resumen ejecutivo en espanol claro y conciso.

Formato obligatorio:

1. Un parrafo inicial de 2 a 3 oraciones con la idea central de la reunion.

Puntos clave:
- 5 a 7 bullets concisos.

Decisiones tomadas:
- Lista las decisiones concretas.
- Si no hay decisiones explicitas, escribe: No se mencionaron decisiones explicitas.

Pendientes:
- Usa el formato "quien -> que".
- Si no hay responsables o pendientes explicitos, escribe: No se mencionaron pendientes explicitos.

Reglas:
- No inventes informacion que no este en el contexto.
- Si algo no esta claro, dilo de forma explicita.
""".strip()


def prompt_mapa_mental(contexto: str) -> str:
    return f"""
Contexto de la reunion:
{contexto}

Convierte el contexto en un mapa mental en Markdown jerarquico.

Reglas obligatorias:
- Devuelve Markdown puro unicamente.
- Usa un titulo principal con # que sea el tema de la reunion.
- Usa maximo 4 ramas principales con ##.
- Cada rama debe tener sub-items con "-".
- No uses bloques de codigo.
- No agregues explicaciones fuera del Markdown.
- No inventes informacion que no este en el contexto.
""".strip()


def prompt_pregunta(contexto: str, pregunta: str) -> str:
    return f"""
Contexto de la reunion:
{contexto}

Pregunta: {pregunta}

Responde solo con base en el contexto anterior.
Usa espanol claro y respuesta concisa, maximo 3 parrafos.
Si la respuesta no esta en el contexto, responde exactamente:
No encontrado en la grabacion.
""".strip()
