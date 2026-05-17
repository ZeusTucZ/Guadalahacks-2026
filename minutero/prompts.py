from __future__ import annotations


def _contiene_patrones(texto: str, patrones: list[str]) -> bool:
    texto_limpio = texto.lower()
    return any(patron in texto_limpio for patron in patrones)


SYSTEM_GUARDRAILS = """
Eres Lux, asistente local para analizar grabaciones.
Responde en espanol claro, directo y sin saludos.
No tienes internet ni APIs externas.
No inventes datos. Si depende de una grabacion, usa solo el contexto dado.
Si falta evidencia, dilo. Si usas conocimiento general local, marcalo.
""".strip()


def prompt_resumen(contexto: str) -> str:
    hay_decisiones = _contiene_patrones(
        contexto,
        [
            "decidimos",
            "se decidio",
            "se decidió",
            "acordamos",
            "se acordo",
            "se acordó",
            "queda decidido",
        ],
    )
    hay_pendientes = _contiene_patrones(
        contexto,
        [
            "pendiente",
            "tarea",
            "responsable",
            "hay que",
            "tenemos que",
            "debe hacer",
            "se encarga",
            "para manana",
            "para mañana",
        ],
    )
    estado_decisiones = "SI" if hay_decisiones else "NO"
    estado_pendientes = "SI" if hay_pendientes else "NO"

    # Compactado para reducir tokens sin cambiar formato ni reglas anti-alucinacion.
    return f"""
Contexto de la reunion:
{contexto}

Evidencia automatica:
- Decisiones explicitas: {estado_decisiones}
- Pendientes o tareas explicitas: {estado_pendientes}

Formato obligatorio:

Resumen:
1 a 3 oraciones fieles al contexto. Si el contexto es corto, resume corto.

Puntos clave:
- 1 a 5 bullets con solo hechos explicitos.
- No rellenes si hay poca informacion.
- No escribas bullets sobre informacion ausente.
- No uses "busca", "planea" u "objetivo" si el contexto no lo dice.

Decisiones tomadas:
- Solo decisiones concretas y explicitas.
- Si no hay decisiones explicitas, escribe exactamente: No se mencionaron decisiones explicitas.
- Si decisiones explicitas es NO, no infieras decisiones.

Pendientes:
- Usa "quien -> que" solo si hay responsable o accion explicita.
- Si no hay responsables o pendientes explicitos, escribe exactamente: No se mencionaron pendientes explicitos.
- Si pendientes o tareas explicitas es NO, no uses "quien -> que".
- Nunca escribas "quien -> que" como placeholder o ejemplo.

Reglas:
- Usa exclusivamente el contexto. No uses grabaciones anteriores, chat previo ni conocimiento general.
- Si el contexto dice "Hola soy Memo y estoy en la escuela", limita el resumen a Memo y la escuela.
- No inventes informacion, industrias, tecnologias, nombres, fechas, objetivos ni recomendaciones.
- No conviertas posibilidades en decisiones.
- Si algo no esta claro, escribe que no se menciono.
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
- Usa solo informacion explicita del contexto.
- Si hay poca informacion, usa pocas ramas.
- No uses bloques de codigo.
- No agregues explicaciones fuera del Markdown.
- No inventes informacion que no este en el contexto.
""".strip()


def prompt_pregunta(contexto: str, pregunta: str) -> str:
    # Compactado para reducir tokens manteniendo la regla de evidencia.
    return f"""
Contexto de la reunion:
{contexto}

Pregunta: {pregunta}

Responde solo con ese contexto, en espanol claro y maximo 3 parrafos.
Si no esta en el contexto, responde exactamente: No encontrado en la grabacion.
""".strip()


def prompt_chat(
    contexto: str,
    historial: str,
    mensaje: str,
    estado_tecnico: str,
    fuente_sugerida: str,
) -> str:
    # Compactado para reducir tokens; conserva fuentes, formato y no-invencion.
    return f"""
Contexto recuperado de la grabacion:
{contexto}

Historial reciente del chat:
{historial}

Configuracion tecnica local:
{estado_tecnico}

Mensaje actual del usuario:
{mensaje}

Fuente recomendada por el sistema:
{fuente_sugerida}

Formato obligatorio:
Fuente: [Grabacion | Chat | Grabacion + Chat | Configuracion local | Conocimiento general local | Grabacion + Conocimiento general local | No encontrado]
Respuesta: [respuesta breve]

Reglas de fuente:
- "Grabacion": dato en contexto. "Chat": dato en historial o mensaje.
- "Grabacion + Chat": combinas ambas.
- "Configuracion local": modelo, Ollama, embeddings, ejecucion local o fuentes.
- "Conocimiento general local": pregunta general fuera de la grabacion.
- "Grabacion + Conocimiento general local": opinion/sugerencia basada en la grabacion.
- "No encontrado": dato pedido de la grabacion que no aparece.

Reglas de respuesta:
- No saludes.
- No repitas preguntas al usuario salvo que falte informacion indispensable.
- No inventes decisiones, pendientes, responsables, tecnologias ni nombres.
- No menciones configuracion tecnica salvo con fuente "Configuracion local".
- Recomendaciones empiezan con "Sugerencia:".
- Si es general, aclara que no viene de la grabacion.
- Si hay conflicto entre grabacion e historial, explicalo breve.
- Si el usuario escribe "1.84 cm" como estatura humana, conserva el dato y agrega que probablemente quiso decir "1.84 m".
- Si la fuente es "No encontrado", la respuesta debe ser exactamente: No encontrado en la grabacion.
""".strip()
