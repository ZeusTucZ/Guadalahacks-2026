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


def prompt_chat(contexto: str, historial: str, mensaje: str) -> str:
    return f"""
Eres Minutero, un asistente conversacional local para entender reuniones, clases y charlas.

Contexto recuperado de la grabacion:
{contexto}

Historial reciente del chat:
{historial}

Mensaje actual del usuario:
{mensaje}

Instrucciones:
- Responde en espanol claro, natural y conciso.
- Puedes continuar la conversacion usando el historial reciente.
- Si el usuario pregunta por datos de la grabacion, responde solo con base en el contexto recuperado y el historial.
- Puedes ayudar a ordenar ideas, explicar, convertir en pendientes, preparar una respuesta o proponer siguientes pasos derivados del contexto.
- No inventes nombres, fechas, decisiones, cifras ni hechos que no aparezcan en la grabacion o el historial.
- Si agregas una idea que no viene literalmente de la grabacion, marcala como sugerencia.
- Evita prometer capacidades no confirmadas como "tiempo real" salvo que el usuario lo pida o el contexto lo mencione.
- Si el usuario pide un dato de la grabacion y no esta disponible, responde exactamente: No encontrado en la grabacion.
- Si el mensaje no depende de la grabacion, responde como asistente general del proyecto Minutero, sin usar APIs externas.
""".strip()
