# Minutero

Minutero es un asistente local para convertir audio de reuniones, clases o charlas en conocimiento consultable: transcripcion, resumen ejecutivo, mapa mental y chat conversacional con RAG.

El objetivo del proyecto es demostrar IA en el borde: el audio, los embeddings, la base vectorial y el LLM corren en la misma maquina del usuario, sin APIs externas de IA.

## Problema

En reuniones, clases y conferencias se pierde informacion importante porque todo ocurre de forma oral. Tomar notas en tiempo real es dificil, especialmente para personas con hipoacusia, TDAH, dislexia, fatiga cognitiva o barreras de comprension. Muchas herramientas existentes dependen de la nube, tienen costo recurrente o implican enviar audio sensible a terceros.

## Solucion

Minutero transforma una grabacion en una memoria local. La entrada puede ser un archivo de audio o una grabacion capturada desde el microfono del navegador:

```text
Audio
-> Whisper local
-> Transcripcion limpia
-> Chunks con overlap
-> Embeddings locales con Ollama
-> ChromaDB local
-> RAG con LLM local
-> Resumen / mapa mental / chat
```

La optimizacion de tokens ocurre con embeddings: el modelo no recibe toda la transcripcion en cada pregunta, solo los fragmentos semanticamente relevantes. El chat conserva historial reciente en el navegador y lo combina con retrieval local para mantener el hilo de la conversacion sin reenviar toda la reunion.

## Conversacion por voz

El chat tambien puede usarse hablando. El navegador captura un mensaje corto desde el microfono, detecta silencio para detener la grabacion, envia el clip al backend y Whisper local lo transcribe. Esa transcripcion entra al mismo endpoint `/chat`, por lo que conserva historial y RAG. La respuesta se muestra como texto y, si el navegador tiene sintesis de voz disponible, se lee en voz alta con una voz en espanol.

Este flujo evita reconocimiento de voz en la nube: la transcripcion del usuario se hace con Whisper local. La salida hablada usa las voces del sistema/navegador disponibles en la maquina.

### Accesibilidad

La conversacion por voz esta pensada para personas con baja vision o ceguera:

- Atajo de teclado **barra espaciadora** para iniciar y detener la grabacion sin tocar el raton.
- **Beeps audibles** distintos al iniciar, detener y en errores: 880 Hz arranque, 440 Hz cierre, 220 Hz error.
- **Modo conversacion continua**: tras leer la respuesta en voz alta, el microfono se reabre solo para el siguiente turno.
- **Calibracion automatica del piso de ruido**: el umbral de voz se adapta al microfono y al ambiente en los primeros 350 ms de cada turno.
- **Vista previa de la transcripcion**: lo que entendio Whisper se muestra en pantalla y se lee con TTS antes de generar la respuesta.
- `aria-live="polite"` en el estado del controlador de voz para que lectores de pantalla anuncien cambios.

### Calidad de la transcripcion por voz

El endpoint `/transcribir-chat` usa por defecto el modelo `small` de Whisper (mejor que `base` para nombres propios y terminos en ingles como "Patrick Mahomes", "quarterback", "React"). Tambien usa un `initial_prompt` bilingue para sesgar la deteccion. Puedes cambiarlo con la variable:

```bash
MINUTERO_VOICE_WHISPER_MODEL=medium uvicorn main:app --reload --port 8000
```

Opciones de calidad/velocidad: `tiny` < `base` < `small` (por defecto) < `medium` < `large`. En Mac Apple Silicon, `small` corre rapido y mejora dramaticamente la precision con nombres propios y terminos tecnicos. Si tu maquina es lenta, baja a `base`.

## Requisitos del sistema

1. Python 3.10+
2. ffmpeg instalado para Whisper
3. Ollama instalado y corriendo en `localhost:11434`
4. Navegador con permisos de microfono para la conversacion por voz

En macOS con Homebrew:

```bash
brew install ffmpeg
```

## Instalacion

```bash
cd minutero
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Modelos de Ollama

Instala Ollama desde:

```text
https://ollama.com
```

Descarga los modelos:

```bash
ollama pull gemma4:e4b
ollama pull nomic-embed-text
```

Crea el modelo personalizado `minutero` con el archivo `Modelfile` incluido:

```bash
ollama create minutero -f Modelfile
```

Contenido del `Modelfile`:

```text
FROM gemma4:e4b
PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER num_ctx 8192
SYSTEM """
Eres un asistente experto en resumir reuniones y conversaciones.
Siempre respondes en espanol claro y conciso.
Cuando resumas, usa vinetas cortas y lenguaje directo.
Nunca inventes informacion que no este en el contexto proporcionado.
Si algo no esta en el contexto, responde exactamente:
"No encontrado en la grabacion."
"""
```

## Arranque

```bash
cd minutero
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

Si trabajas con el frontend de Vite en desarrollo, deja FastAPI corriendo en
`127.0.0.1:8000` y en otra terminal arranca Vite:

```bash
cd minutero/frontend
npm run dev -- --host 127.0.0.1
```

Abre `http://127.0.0.1:5173/static/`. Si FastAPI no esta corriendo, Vite mostrara
errores como `ECONNREFUSED 127.0.0.1:8000` al llamar `/indexar`, `/chat`,
`/caption` o `/grabaciones`.

Para demo rapida en equipos con menos memoria, puedes usar un modelo local mas ligero que ya tengas en Ollama:

```bash
MINUTERO_LLM_MODEL=llama3.2:3b MINUTERO_NUM_CTX=2048 MINUTERO_NUM_PREDICT=350 uvicorn main:app --reload --port 8000
```

El modelo por defecto sigue siendo `minutero`. La variable `MINUTERO_KEEP_ALIVE` mantiene el modelo cargado en Ollama despues de la primera generacion:

```bash
MINUTERO_KEEP_ALIVE=30m uvicorn main:app --reload --port 8000
```

Abre:

```text
http://localhost:8000
```

## Prueba del pipeline en terminal

Antes de usar la interfaz, puedes validar el pipeline base:

```bash
cd minutero
source .venv/bin/activate
python run_pipeline.py /ruta/a/audio.mp3
```

Esto crea `outputs/transcripcion.txt` e indexa los chunks en `chroma_db/`.

## Demo sugerida

1. Inicia Ollama.
2. Corre el servidor local.
3. Sube el audio de la platica o graba una muestra desde el microfono.
4. Genera el resumen.
5. Genera el mapa mental.
6. Pregunta: `¿Cuales son las reglas del track?`
7. Pregunta algo no mencionado para validar que responde: `No encontrado en la grabacion.`

## Estructura

```text
minutero/
├── main.py
├── transcribe.py
├── chunk.py
├── index.py
├── query.py
├── prompts.py
├── run_pipeline.py
├── requirements.txt
├── Modelfile
└── static/
    └── index.html
```

## Notas de producto

- Whisper se usa localmente, no Whisper API.
- Ollama se usa localmente, no APIs externas de IA.
- ChromaDB corre en modo persistente local, sin servidor.
- La interfaz no usa frameworks ni CDN para mantener la demo funcional sin internet.
