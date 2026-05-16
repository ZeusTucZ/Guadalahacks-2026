# Minutero

Minutero es un asistente local para convertir audio de reuniones, clases o charlas en conocimiento consultable: transcripcion, resumen ejecutivo, mapa mental y preguntas libres con RAG.

El objetivo del proyecto es demostrar IA en el borde: el audio, los embeddings, la base vectorial y el LLM corren en la misma maquina del usuario, sin APIs externas de IA.

## Problema

En reuniones, clases y conferencias se pierde informacion importante porque todo ocurre de forma oral. Tomar notas en tiempo real es dificil, especialmente para personas con hipoacusia, TDAH, dislexia, fatiga cognitiva o barreras de comprension. Muchas herramientas existentes dependen de la nube, tienen costo recurrente o implican enviar audio sensible a terceros.

## Solucion

Minutero transforma una grabacion en una memoria local:

```text
Audio
-> Whisper local
-> Transcripcion limpia
-> Chunks con overlap
-> Embeddings locales con Ollama
-> ChromaDB local
-> RAG con LLM local
-> Resumen / mapa mental / preguntas
```

La optimizacion de tokens ocurre con embeddings: el modelo no recibe toda la transcripcion en cada pregunta, solo los fragmentos semanticamente relevantes.

## Requisitos del sistema

1. Python 3.10+
2. ffmpeg instalado para Whisper
3. Ollama instalado y corriendo en `localhost:11434`

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
3. Sube el audio de la platica o una grabacion corta.
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
