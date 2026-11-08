# Lux

Lux is a local AI assistant that turns speech into accessible memory: live
subtitles, transcription, an executive summary, a mind map, and conversational
RAG chat. It was built for the Guadalahacks 2026 hackathon.

The goal is to demonstrate AI at the edge: audio, embeddings, the vector
database and the LLM all run on the user's own machine — no external AI APIs.

## Problem

In meetings, classes and talks, important information is lost because
everything happens out loud. Taking notes in real time is hard, especially for
people with hearing loss, ADHD, dyslexia, cognitive fatigue or comprehension
barriers. Many existing tools depend on the cloud, have a recurring cost, or
send sensitive audio to third parties.

## Solution

Lux turns a recording into local memory. The input can be an audio file or a
recording captured from the browser microphone:

```text
Audio
-> local Whisper
-> clean transcription
-> chunks with overlap
-> local embeddings with Ollama
-> local ChromaDB
-> RAG with a local LLM
-> summary / mind map / chat
```

Token usage is optimized with embeddings: the model does not receive the whole
transcription on every question, only the semantically relevant fragments.
The chat keeps recent history in the browser and combines it with local
retrieval, so it stays on topic without resending the whole meeting.

> **Portfolio/CV claim:** RAG reduces input tokens by about 30% compared with
> sending the full transcript. This figure comes from the author's CV and
> portfolio — it is **not** measured in this repository.

## Voice conversation

The chat can also be used by speaking. The browser captures a short message
from the microphone, detects silence to stop recording, sends the clip to the
backend, and local Whisper transcribes it. That transcription goes into the
same `/chat` endpoint, so it keeps history and RAG. The answer is shown as
text and, if the browser has speech synthesis available, read aloud with a
Spanish voice.

This flow avoids cloud speech recognition: transcribing the user is done with
local Whisper. Spoken output uses the voices available on the machine/browser.

### Accessibility

Voice conversation is designed for people with low vision or blindness:

- **Spacebar** shortcut to start and stop recording without touching the mouse.
- **Audible beeps** that differ on start, stop and error: 880 Hz start,
  440 Hz stop, 220 Hz error.
- **Continuous conversation mode**: after reading the answer aloud, the
  microphone reopens by itself for the next turn.
- **Automatic noise-floor calibration**: the voice threshold adapts to the
  microphone and environment during the first 350 ms of each turn.
- **Transcription preview**: what Whisper understood is shown on screen and
  read with TTS before the answer is generated.
- `aria-live="polite"` on the voice controller status so screen readers
  announce changes.

### Transcription quality for voice chat

The `/transcribir-chat` endpoint uses Whisper `small` by default (better than
`base` for proper names and English terms such as "Patrick Mahomes",
"quarterback", "React"). It also uses a bilingual `initial_prompt` to bias
detection. Change it with:

```bash
MINUTERO_VOICE_WHISPER_MODEL=medium uvicorn main:app --reload --port 8000
```

Quality/speed options: `tiny` < `base` < `small` (default) < `medium` <
`large`. On Mac Apple Silicon, `small` runs fast and greatly improves accuracy
on proper names and technical terms. If your machine is slow, drop to `base`.

For live subtitles, Lux uses `MINUTERO_CAPTION_WHISPER_MODEL=base` by
default. `tiny` is faster but confuses names and technical terms easily. You
can reinforce the expected vocabulary of a demo with:

```bash
MINUTERO_CAPTION_CONTEXT="Lorenzo Orrante, hackaton, LLM local" uvicorn main:app --reload --port 8000
```

Subtitles do not appear word by word. They update in 5-second blocks so
Whisper gets enough audio.

Accuracy improvement implemented: each subtitle block sends the backend a
short window of the text already transcribed. Whisper uses that context in the
`initial_prompt` to keep continuity between blocks, proper names and technical
terms. The backend also applies local vocabulary corrections for frequent demo
mistakes such as "LLM local", "Tecnologico de Monterrey", "personas ciegas",
"transcriben" and accessibility phrases. Everything still runs locally.

## System requirements

1. Python 3.10+
2. `ffmpeg` installed (for Whisper)
3. Ollama installed and running on `localhost:11434`
4. A browser with microphone permissions (for voice conversation)

On macOS with Homebrew:

```bash
brew install ffmpeg
```

## Installation

```bash
cd minutero
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Ollama models

Install Ollama from `https://ollama.com`, then download the models:

```bash
ollama pull gemma4:e4b
ollama pull nomic-embed-text
```

Create the custom `minutero` model with the included `Modelfile`:

```bash
ollama create minutero -f Modelfile
```

The `Modelfile`:

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

## Running

```bash
cd minutero
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

If you work with the Vite frontend in development, leave FastAPI running on
`127.0.0.1:8000` and start Vite in another terminal:

```bash
cd minutero/frontend
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/static/`. If FastAPI is not running, Vite shows
errors such as `ECONNREFUSED 127.0.0.1:8000` when calling `/indexar`, `/chat`,
`/caption` or `/grabaciones`.

For a quick demo on machines with less memory, you can use a lighter local
model you already have in Ollama:

```bash
MINUTERO_LLM_MODEL=llama3.2:3b MINUTERO_NUM_CTX=2048 MINUTERO_NUM_PREDICT=350 uvicorn main:app --reload --port 8000
```

The default model is still `minutero`. The `MINUTERO_KEEP_ALIVE` variable
keeps the model loaded in Ollama after the first generation:

```bash
MINUTERO_KEEP_ALIVE=30m uvicorn main:app --reload --port 8000
```

Open:

```text
http://localhost:8000
```

## Testing the pipeline from the terminal

Before using the interface, you can validate the base pipeline:

```bash
cd minutero
source .venv/bin/activate
python run_pipeline.py /path/to/audio.mp3
```

This creates `outputs/transcripcion.txt` and indexes the chunks in
`chroma_db/`.

## Suggested demo

1. Start Ollama.
2. Run the local server.
3. Upload the talk audio or record a sample from the microphone.
4. Generate the summary.
5. Generate the mind map.
6. Ask: `¿Cuales son las reglas del track?`
7. Ask something not mentioned to check it answers:
   `No encontrado en la grabacion.`

## Structure

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
├── frontend/        # Vite + React + TypeScript app
└── static/
    └── index.html
```

## Stack

- Backend: Python 3.10+, FastAPI / Uvicorn, `openai-whisper`, `ollama`,
  `chromadb` (local persistent mode, no server), `python-multipart`
- LLM: custom Ollama model `minutero` (from `gemma4:e4b`); embeddings with
  `nomic-embed-text`
- Frontend: Vite + React 19 + TypeScript + Tailwind CSS
- `ffmpeg` for audio handling

## Product notes

- Whisper runs locally, not the Whisper API.
- Ollama runs locally — no external AI APIs.
- ChromaDB runs in local persistent mode, without a server.
- The interface uses no frameworks or CDNs, so the demo works without
  internet.

## Current state and limitations

- No live demo URL and no screenshots in this repository.
- No quantified results measured in this repository (see the token-reduction
  claim above, which comes from the author's CV/portfolio).
- No hackathon placement stated.

---

## Resumen en español

**Lux** es un asistente local que convierte voz en memoria accesible:
subtítulos en vivo, transcripción, resumen ejecutivo, mapa mental y chat
conversacional con RAG. Fue construido para el hackatón Guadalahacks 2026.

Todo corre en la máquina del usuario — audio, embeddings, base vectorial y
LLM — sin APIs externas de IA, lo que protege la privacidad del audio y
evita costos recurrentes. El flujo es: audio → Whisper local → transcripción
→ fragmentos con solapamiento → embeddings locales con Ollama → ChromaDB
local → RAG con un LLM local (`minutero`, un modelo personalizado basado en
`gemma`, con embeddings `nomic-embed-text`).

El chat también funciona por voz, con funciones de accesibilidad: atajo de
barra espaciadora, beeps audibles, modo de conversación continua, calibración
automática del piso de ruido y `aria-live` para lectores de pantalla.

Para ejecutarlo: instala Ollama y `ffmpeg`, descarga los modelos
(`gemma4:e4b`, `nomic-embed-text`), crea el modelo `minutero` con el
`Modelfile` incluido, instala las dependencias con
`pip install -r requirements.txt` y arranca el backend con
`uvicorn main:app --reload --port 8000`. El frontend de Vite está en
`minutero/frontend`. Abre `http://localhost:8000`.

> **Aclaración:** la reducción de ~30% en tokens de entrada atribuida a RAG
> es una afirmación del CV/portafolio del autor, no una medición realizada
> en este repositorio. No hay demo en vivo ni capturas de pantalla.
