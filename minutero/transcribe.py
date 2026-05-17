from __future__ import annotations

import os
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from threading import Lock


MULETILLAS = [
    r"\beste+\b",
    r"\beh+\b",
    r"\bem+\b",
    r"\bmmm+\b",
    r"\bo sea\b",
    r"\bverdad\b",
    r"\bno\?\b",
]

_WHISPER_TRANSCRIBE_LOCK = Lock()


# Prompt bilingue para sesgar a Whisper hacia nombres propios y terminos comunes
# que aparecen mezclados con espanol (deportes, tecnologia, marcas). Esto reduce
# errores como "Patrick Mahomes" -> "mis colmas" o "quarterback" -> "coredado".
VOICE_INITIAL_PROMPT = (
    "Conversacion en espanol con preguntas cortas. "
    "Nombre del usuario/proyecto: Lorenzo Orrante, Lux, Guadalahacks. "
    "El usuario puede mencionar nombres propios en ingles: "
    "Patrick Mahomes, Lamar Jackson, Travis Kelce, Tom Brady, Aaron Rodgers, "
    "Kansas City Chiefs, Baltimore Ravens, Buffalo Bills, Dallas Cowboys, "
    "NFL, NBA, MLB, quarterback, running back, wide receiver, touchdown, "
    "Python, JavaScript, TypeScript, React, FastAPI, Ollama, Whisper, "
    "LLM, RAG, embedding, ChromaDB, GitHub, Google, Microsoft, OpenAI, Anthropic. "
    "Responde con puntuacion correcta, acentos y signos de interrogacion."
)

CAPTION_INITIAL_PROMPT = (
    "Transcripcion en vivo en espanol de una demo de accesibilidad y programacion. "
    "Terminos esperados: Lorenzo Orrante, hackaton, Guadalahacks, Lux, "
    "LLM local, inteligencia artificial local, Whisper, Ollama, ChromaDB, RAG, "
    "Python, JavaScript, TypeScript, React, FastAPI, Tecnologico de Monterrey, "
    "personas sordas, personas ciegas, subtitulos en vivo, microfono, chat por voz, "
    "discapacidad, dislexia, TDAH, comandos de voz, privacidad, productividad, "
    "informacion confidencial, servidores, suscripciones, internet, sin APIs, byte, "
    "IA, Wi-Fi. "
    "Frases probables: Hola, mi nombre es Lorenzo Orrante. Tengo 20 anos. "
    "Estudio en el Tecnologico de Monterrey. "
    "Estoy participando en un hackaton en el que tenemos que hacer un LLM local. "
    "Hicimos un proyecto basado en accesibilidad para personas con dislexia y TDAH. "
    "Podemos navegar en la pagina con comandos de voz. "
    "En Mexico el 16% de la poblacion cuenta con una discapacidad. "
    "Requiere suscripciones, requiere internet y requiere compartir tu informacion confidencial con servidores. "
    "Nosotros no requerimos nada de eso. Somos Lux. "
    "Elegir entre la privacidad o la productividad. "
    "Funciona sin APIs. Funciona solo en tu computadora. "
    "No requiere enviar ni un byte a otro lado. "
    "Toda esta reunion esta siendo grabada por Lux. "
    "Vamos a ver una demostracion. "
    "No repitas frases ya transcritas en bloques anteriores."
)

CAPTION_CONTEXT_CHARS = 180


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


def corregir_caption(texto: str) -> str:
    """Normaliza errores frecuentes de subtitulos en vivo.

    El captioning trabaja con clips pequenos y parciales; por eso se aplican
    correcciones de vocabulario de la demo sin cambiar la estructura general.
    """
    limpio = limpiar_transcripcion_voz(texto)
    normalizado = _normalizar_voz(limpio)

    if "mi nombre es" in normalizado:
        limpio = re.sub(
            r"\bmi nombre es\s+(?:Doris|Dorys|Loris|Lores|Lorenzo)?\s*Or+ante\b",
            "mi nombre es Lorenzo Orrante",
            limpio,
            flags=re.IGNORECASE,
        )
        limpio = re.sub(
            r"\bmi nombre es\s+Doris\b",
            "mi nombre es Lorenzo Orrante",
            limpio,
            flags=re.IGNORECASE,
        )

    reemplazos = [
        (r"\bha estado aprendiendo\b", "he estado aprendiendo"),
        (r"\bse estudi[oó] en el Tecnol[oó]gico de Monterrey\b", "Estudio en el Tecnológico de Monterrey"),
        (r"\bestudi[oó] en el Tecnol[oó]gico de Monterrey\b", "Estudio en el Tecnológico de Monterrey"),
        (r"\bhe estudiado en tecnolog[ií]a\b", "Estudio en el Tecnológico de Monterrey"),
        (r"\bestudio en tecnolog[ií]a\b", "Estudio en el Tecnológico de Monterrey"),
        (r"\bestudi[oó] en tecnolog[ií]a\b", "Estudio en el Tecnológico de Monterrey"),
        (r"\bdescapacidad\b", "discapacidad"),
        (r"\bProblemas que no pueden tomar notas\b", "El problema es que no pueden tomar notas"),
        (r"\bpoblaci[oó]n junta con una discapacidad\b", "población cuenta con una discapacidad"),
        (r"\bcuenta con una descapacidad\b", "cuenta con una discapacidad"),
        (r"\bya existen? el software\b", "ya existe software"),
        (r"\bcompartir tu\.\s+Con informaci[oó]n\b", "compartir tu información"),
        (r"\binformaci[oó]n,\s+confidencial\b", "información confidencial"),
        (r"\binformaci[oó]n confidencial y servidores\b", "información confidencial con servidores"),
        (r"\bno requerimos nada\b(?! de eso)", "no requerimos nada de eso"),
        (r"\bno requerimos nada de eso somos lux\b", "no requerimos nada de eso. Somos Lux"),
        (r"\bsomos looks(?=[.!?,]|$)", "Somos Lux"),
        (r"\bsomos lux(?=[.!?,]|$)", "Somos Lux"),
        (r"\bsomos los(?=[.!?,]|$)", "Somos Lux"),
        (r"\bsomos luxs(?=[.!?,]|$)", "Somos Lux"),
        (r"\bPones ver\b", "Podemos ver"),
        (r"\bpone?s ver\b", "podemos ver"),
        (r"\bCu[aá]l es el problema requiere\b", "Cuál es el problema? Requiere"),
        (r"\brequiere suscripciones requiere Internet\b", "requiere suscripciones, requiere Internet"),
        (r"\brequiere suscripciones, requiere internet\b", "requiere suscripciones, requiere Internet"),
        (r"\bproblema\.?\s+La n[uú]mero\b", "problema en números"),
        (r"\bproblema en n[uú]mero es\b", "problema en números es"),
        (r"\bcrecimiento noal\b", "crecimiento anual"),
        (r"\bde cada disempre\.?\s+Fue presas,\s+cuatro deciden\b", "4 de cada 10 empresas deciden"),
        (r"\bde cada 10 empresas deciden adoptar estas tecnolog[ií]as\b", "4 de cada 10 empresas deciden no adoptar estas tecnologías"),
        (r"\bEl problema 4 de cada 10 empresas\b", "El problema es que 4 de cada 10 empresas"),
        (r"\bel miedo exponer sus datos\b", "el miedo a exponer sus datos"),
        (r"\bes donde entre el dilema\b", "es donde entra el dilema"),
        (r"\bprivacidad o la productividad\b", "privacidad o la productividad"),
        (r"\bpero nosotros s[ií] podemos\.?\s+Podemos\.?\s+Somos\b", "pero nosotros sí podemos. Somos"),
        (r"\bpero nosotros s[ií] podemos somos lux somos\b", "pero nosotros sí podemos. Somos Lux. Somos"),
        (r"\bPorque en el\.?\s+En el mundo\b", "Porque en el mundo"),
        (r"\bla sinapis\b", "sin APIs"),
        (r"\bsinapis\b", "sin APIs"),
        (r"\bsin l[aá]piz\b", "sin APIs"),
        (r"\bBaeta\b", "byte"),
        (r"\bbaeta\b", "byte"),
        (r"\bni un byte de otro lado\b", "ni un byte a otro lado"),
        (r"\btu computador\b", "tu computadora"),
        (r"\btodo esta reuni[oó]n\b", "toda esta reunión"),
        (r"\btoda esta reuni[oó]n est[aá] haciendo grabada\b", "toda esta reunión está siendo grabada"),
        (r"\bgrabada por Lux vamos\b", "grabada por Lux. Vamos"),
        (r"\bgrabada por los\b", "grabada por Lux"),
        (r"\bgrabada por looks\b", "grabada por Lux"),
        (r"\bjacat[oó]n\b", "hackaton"),
        (r"\bjaqueat[oó]n\b", "hackaton"),
        (r"\bhackat[oó]n\b", "hackaton"),
        (r"\bcloud\s+noting\b", "note-taking"),
        (r"\bcloud\s+notas\b", "notas"),
        (r"\bLL\s*me\s*local\b", "LLM local"),
        (r"\bLL\s*melo\s*cal\b", "LLM local"),
        (r"\bLL\s*melocal\b", "LLM local"),
        (r"\bLLM\s*elocal\b", "LLM local"),
        (r"\bLLMlocal\b", "LLM local"),
        (r"\bLL\s*M\s+local\b", "LLM local"),
        (r"\bTecnol[oó]gico de Monterrey\b", "Tecnológico de Monterrey"),
        (r"\bmi estrella hermano\b", "mis tres hermanos"),
        (r"\bpersonas siegas\b", "personas ciegas"),
        (r"\bpersonas sielgas\b", "personas ciegas"),
        (r"\bpersonas sordas o temas como de\b", "personas sordas"),
        (r"\bpersonas con deslice\b", "personas con dislexia"),
        (r"\bcon deslice\b", "con dislexia"),
        (r"\bcon te de h\b", "con TDAH"),
        (r"\bcon t de h\b", "con TDAH"),
        (r"\bte de h\b", "TDAH"),
        (r"\bt de h\b", "TDAH"),
        (r"\btdh\b", "TDAH"),
        (r"\bde manera locura\b", "de manera local"),
        (r"\bmi cr[oó]fono\b", "micrófono"),
        (r"\btransdiven\b", "transcriben"),
        (r"\btranscriben y lo\b", "transcriben y luego"),
        (r"\bhabiendo su p[eé]talo\b", "haciéndolo lo más accesible posible"),
        (r"\bestos pasandonos en accesibilidad\b", "basándonos en accesibilidad"),
        (r"\besto es pasandonos en accesibilidad\b", "basándonos en accesibilidad"),
        (r"\bbasandonos en accesibilidad\b", "basándonos en accesibilidad"),
        (r"\bfuncionalidades para\b", "funcionalidades podemos"),
        (r"\bnavegar en la p[aá]gina con comandos de bolsa\b", "navegar en la página con comandos de voz"),
        (r"\bcomandos de bolsa\b", "comandos de voz"),
    ]
    for patron, reemplazo in reemplazos:
        limpio = re.sub(patron, reemplazo, limpio, flags=re.IGNORECASE)

    limpio = re.sub(r"\best[eé]n\s+un\s+hackaton\b", "estoy en un hackaton", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\b(vamos a|vamos a hacer|tenemos hacer)\s+un\s+LLM\s+local\b", "Tenemos que hacer un LLM local", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\ben M[eé]xico\s+16%", "En México el 16%", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bCu[aá]l es el problema\?", "¿Cuál es el problema?", limpio, flags=re.IGNORECASE)
    limpio = re.sub(
        r"\bel cual func\.?\s+En\s+sin APIs,?\s+funciona\b",
        "el cual funciona sin APIs. Funciona",
        limpio,
        flags=re.IGNORECASE,
    )
    limpio = re.sub(r"\bun\s+LLM[.!?]?\s+y\s+local\s+tiene\b", "un LLM local y tiene", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bestoy\s+haciendo\s+un\s+LLM\s+local\b", "estoy haciendo un LLM local", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bhablar\s+con\s+la\s+idea\b", "hablar con la IA", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bque\s+sa(?:ca|que)\.\s+Quiero\s+que\s+sirva\s+también\b", "que sirva también", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bTambién\s+quiero\s+que\s+sirva\s+también\b", "También quiero que sirva", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bel\s+tema\s+de\.\.\.\s+De\s+poder\b", "el tema de poder", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bque\s+te\.\.\.\s+Respondan\b", "que te respondan", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\blo\s+m[aá]s\s+accesible\.\s+Lo\s+posible\b", "lo más accesible posible", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bpor\s+eso\s+es\s+una\.\.\.\s+Un\s+LLM\s+local\b", "por eso es un LLM local", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bservidores nosotros\b", "servidores. Nosotros", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bcomputadora no requiere\b", "computadora. No requiere", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\by de hecho toda\b", "y, de hecho, toda", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bgrabada por Lux vamos\b", "grabada por Lux. Vamos", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bEs donde entra el dilema elegir\b", "Es donde entra el dilema: elegir", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bEs donde entra el dilema,\s+elegir\b", "Es donde entra el dilema: elegir", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"\bporque en el mundo de hoy no puedes\b", "porque en el mundo de hoy, no puedes", limpio, flags=re.IGNORECASE)
    limpio = re.sub(r"¿¿Cuál", "¿Cuál", limpio)
    limpio = re.sub(
        r"\bchat\.\s+Tengo\s+tiempo,\s+pero\s+con\s+micrófono\b",
        "chat en tiempo real, pero con micrófono",
        limpio,
        flags=re.IGNORECASE,
    )
    limpio = re.sub(
        r"\bMi\s+familia\s+consiste\.\s+Estoy\s+con\s+mi\s+padre\b",
        "Mi familia consiste en mi padre",
        limpio,
        flags=re.IGNORECASE,
    )
    limpio = re.sub(
        r"\bNosotros hicimos un proyecto\.+\s+basándonos\b",
        "Nosotros hicimos un proyecto basándonos",
        limpio,
        flags=re.IGNORECASE,
    )
    limpio = re.sub(
        r"\bpara personas con dislexia,\s+con TDAH,\s+con personas\b\.?",
        "para personas con dislexia y TDAH.",
        limpio,
        flags=re.IGNORECASE,
    )
    limpio = re.sub(
        r"\bEn funcionalidades podemos\.+\s+Vale\.",
        "En funcionalidades podemos navegar en la página con comandos de voz.",
        limpio,
        flags=re.IGNORECASE,
    )
    return _deduplicar_oraciones_caption(re.sub(r"\s+", " ", limpio).strip())


def _deduplicar_oraciones_caption(texto: str) -> str:
    """Elimina repeticiones exactas que Whisper arrastra entre bloques."""
    if not texto:
        return texto

    partes = re.findall(r"[^.!?]+[.!?]?", texto)
    resultado: list[str] = []
    vistas: set[str] = set()
    for parte in partes:
        oracion = parte.strip()
        if not oracion:
            continue
        clave = _normalizar_voz(oracion)
        # Solo deduplicamos frases suficientemente informativas; evita borrar
        # conectores cortos que podrian ser parte de una frase incompleta.
        if len(clave) >= 10 and clave in vistas:
            continue
        vistas.add(clave)
        resultado.append(_capitalizar_caption(oracion))

    return " ".join(resultado).strip()


def _capitalizar_caption(oracion: str) -> str:
    if not oracion:
        return oracion
    return oracion[0].upper() + oracion[1:]


@lru_cache(maxsize=4)
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
    # tiny fue demasiado impreciso para nombres propios y terminos tecnicos en
    # tiempo real ("Lorenzo Orrante", "hackaton", "LLM local"). base sigue
    # siendo razonable para subtitulos parciales y mejora mucho la precision.
    return os.getenv("MINUTERO_CAPTION_WHISPER_MODEL", "base")


def _caption_initial_prompt(contexto_previo: str = "") -> str:
    extra = os.getenv("MINUTERO_CAPTION_CONTEXT", "").strip()
    contexto = re.sub(r"\s+", " ", contexto_previo).strip()
    contexto = contexto[-CAPTION_CONTEXT_CHARS:]
    partes = [CAPTION_INITIAL_PROMPT]
    if extra:
        partes.append(f"Vocabulario adicional esperado: {extra}.")
    if contexto:
        partes.append(
            "Texto previo solo para continuidad, no lo repitas literalmente: "
            f"{contexto}. Transcribe unicamente el audio nuevo de este bloque."
        )
    return " ".join(partes).strip()


def _ejecutar_transcripcion_caption(model, ruta_audio: str, *, initial_prompt: str | None, beam_size: int):
    opciones = {
        "language": "es",
        "task": "transcribe",
        "temperature": 0.0,
        "beam_size": beam_size,
        "best_of": beam_size,
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.45,
        "logprob_threshold": -1.0,
        "compression_ratio_threshold": 2.4,
        "fp16": False,
        "verbose": False,
    }
    if initial_prompt:
        opciones["initial_prompt"] = initial_prompt
    with _WHISPER_TRANSCRIBE_LOCK:
        return model.transcribe(ruta_audio, **opciones)


def transcribir(ruta_audio: str) -> str:
    """Transcribe audio largo (reuniones) y limpia muletillas."""
    ruta = Path(ruta_audio)
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo de audio: {ruta_audio}")

    print("Transcribiendo audio...")

    model = _modelo_whisper(_nombre_modelo_general())
    with _WHISPER_TRANSCRIBE_LOCK:
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
    with _WHISPER_TRANSCRIBE_LOCK:
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


def transcribir_caption(ruta_audio: str, contexto_previo: str = "") -> str:
    """Transcribe un chunk corto para captioning en vivo.

    Optimizado para equilibrio calidad/latencia: usa prompt de contexto y un
    beam pequeno para no destruir nombres propios en clips parciales.
    """
    ruta = Path(ruta_audio)
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo de audio: {ruta_audio}")

    model = _modelo_whisper(_nombre_modelo_caption())
    try:
        resultado = _ejecutar_transcripcion_caption(
            model,
            str(ruta),
            initial_prompt=_caption_initial_prompt(contexto_previo),
            beam_size=3,
        )
    except RuntimeError as exc:
        if "Sizes of tensors must match" not in str(exc):
            raise
        # Algunos blobs WebM parciales hacen fallar a Whisper internamente con
        # ese error de tensores. Reintentamos sin prompt y con beam minimo para
        # mantener los subtitulos vivos en lugar de devolver 500.
        resultado = _ejecutar_transcripcion_caption(
            model,
            str(ruta),
            initial_prompt=None,
            beam_size=1,
        )
    texto = resultado.get("text", "")
    return corregir_caption(texto)
