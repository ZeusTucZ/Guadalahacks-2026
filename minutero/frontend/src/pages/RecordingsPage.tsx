import {
  AudioLines,
  Bookmark,
  CloudOff,
  Lightbulb,
  Lock,
  Mic,
  Pause,
  Send,
  Sparkles,
  Square,
  Target,
  Upload,
} from 'lucide-react'
import { MindMapView } from '../components/MindMapView'
import { VoiceChatControls } from '../components/VoiceChatControls'
import type { MinuteroController } from '../useMinutero'

const LIVE_BARS = [
  4, 8, 6, 12, 7, 14, 9, 16, 11, 18, 8, 15, 10, 13, 6, 11, 9, 14, 7, 12, 10, 17, 8, 13, 11, 15, 9, 12, 6, 10,
]

function LiveWaveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-16 items-end justify-center gap-[3px]">
      {LIVE_BARS.map((h, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-gradient-to-t from-violet-600/40 to-[#c7b8ea] ${
            active ? 'animate-pulse' : ''
          }`}
          style={{ height: `${h * 3}px`, animationDelay: `${i * 40}ms` }}
        />
      ))}
    </div>
  )
}

export function RecordingsPage({ minutero: m }: { minutero: MinuteroController }) {
  const recordingLabel = m.isRecording
    ? m.isPaused
      ? 'GRABACIÓN PAUSADA'
      : 'GRABACIÓN ACTIVA'
    : m.uploadSelected
      ? 'AUDIO LISTO'
      : 'LISTO PARA GRABAR'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <span className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/5 px-3 py-1.5 text-xs font-medium text-teal-400">
          <Target className="h-3.5 w-3.5" />
          Procesando localmente
        </span>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-500 md:inline-flex">
            {m.modelName || 'modelo local'}
          </span>
          <button
            type="button"
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800/80 hover:text-zinc-300"
            aria-label="Modo sin nube"
          >
            <CloudOff className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800/80 hover:text-zinc-300"
            aria-label="Bloqueado"
          >
            <Lock className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-12 md:px-10">
        <section className="relative flex flex-col items-center justify-center rounded-3xl border border-zinc-800/60 bg-zinc-950/30 px-6 py-10">
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            <div className="h-72 w-72 rounded-full bg-violet-600/10 blur-3xl" />
          </div>

          <p className="relative font-mono text-6xl font-light tracking-tight text-white tabular-nums md:text-7xl">
            {m.recordingTime}
          </p>
          <p className="relative mt-3 text-[11px] font-medium tracking-[0.35em] text-zinc-500">
            {recordingLabel}
          </p>

          <div className="relative mt-10 w-full max-w-md">
            <LiveWaveform active={m.isRecording && !m.isPaused} />
          </div>

          {m.isRecording && (
            <div
              className="relative mt-6 w-full max-w-3xl rounded-2xl border border-teal-500/30 bg-teal-500/5 px-4 py-3 text-sm leading-relaxed text-teal-100"
              role="region"
              aria-label="Subtítulos en vivo"
              aria-live="polite"
              aria-atomic="false"
              aria-relevant="additions text"
            >
              <p className="mb-1 text-[10px] font-semibold tracking-[0.35em] text-teal-300">
                SUBTÍTULOS EN VIVO
              </p>
              <p className="min-h-[2.5rem] whitespace-pre-wrap break-words text-left text-base font-medium">
                {m.liveCaption || (
                  <span className="italic text-teal-300/60">
                    Esperando audio. Los subtítulos aparecerán aquí en unos segundos.
                  </span>
                )}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (m.isRecording) return
              void m.startRecording()
            }}
            disabled={m.isRecording}
            className="relative mt-10 flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[#c7b8ea]/25 ring-1 ring-[#c7b8ea]/30 transition hover:bg-[#c7b8ea]/35 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Grabar con micrófono"
          >
            <Mic className="h-9 w-9 text-[#c7b8ea]" strokeWidth={1.5} />
          </button>

          <div className="relative mt-10 flex items-center gap-8 md:gap-12">
            <ControlButton
              icon={Pause}
              label={m.isPaused ? 'Reanudar' : 'Pausar'}
              onClick={m.pauseRecording}
              disabled={!m.isRecording}
            />
            <ControlButton
              icon={Square}
              label="Detener"
              variant="stop"
              onClick={m.stopRecording}
              disabled={!m.isRecording}
            />
            <ControlButton
              icon={Bookmark}
              label="Marcar"
              onClick={m.addMarker}
              disabled={!m.isRecording && !m.uploadSelected}
            />
          </div>

          <input
            ref={m.audioInputRef}
            type="file"
            accept=".wav,.mp3,.m4a,.ogg,.webm,.mp4,audio/*,video/mp4"
            hidden
            onChange={(e) => m.handleFiles(e.target.files)}
          />

          <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={m.openFilePicker}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-[#c7b8ea]/50 hover:text-white"
            >
              <Upload className="h-4 w-4" />
              Subir audio
            </button>
            <button
              type="button"
              disabled={m.indexBtnDisabled}
              onClick={() => void m.indexAudio()}
              className="rounded-xl bg-[#c7b8ea] px-5 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-[#d4c8f0] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {m.isWorking ? 'Procesando...' : 'Transcribir e indexar'}
            </button>
          </div>

          <p className="relative mt-4 max-w-2xl text-center text-sm text-zinc-500">{m.uploadMessage}</p>

          {m.recordingUrl && (
            <audio className="relative mt-4 w-full max-w-xl" src={m.recordingUrl} controls />
          )}

          {m.markers.length > 0 && (
            <div className="relative mt-4 flex flex-wrap justify-center gap-2">
              {m.markers.map((marker) => (
                <span
                  key={marker}
                  className="rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1 text-xs text-zinc-400"
                >
                  {marker}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <div className="space-y-6">
            <article className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 md:p-8">
              <span className="inline-flex items-center gap-2 rounded-md border border-teal-500/30 bg-teal-500/5 px-2.5 py-1 text-[11px] font-medium text-teal-400">
                <AudioLines className="h-3.5 w-3.5" />
                Transcripción
              </span>
              <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                {m.preview}
                {m.isWorking && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[#c7b8ea]" />}
              </p>
            </article>

            <div className={`grid gap-6 lg:grid-cols-2 ${!m.workEnabled ? 'pointer-events-none opacity-40' : ''}`}>
              <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[#c7b8ea]">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-sm font-medium">Resumen ejecutivo</span>
                  </div>
                  <button
                    type="button"
                    onClick={m.generateSummary}
                    disabled={m.summaryGenerating}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-[#c7b8ea]/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {m.summaryGenerating ? 'Generando...' : 'Generar'}
                  </button>
                </div>
                <div className="output-box min-h-[210px] rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3 text-zinc-300">
                  {m.summaryOutput || <span className="text-zinc-600">El resumen aparecerá aquí.</span>}
                </div>
              </article>

              <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-amber-400">
                    <Lightbulb className="h-4 w-4" />
                    <span className="text-sm font-medium">Mapa mental</span>
                  </div>
                  <button
                    type="button"
                    onClick={m.generateMap}
                    disabled={m.mapGenerating}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-[#c7b8ea]/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {m.mapGenerating ? 'Generando...' : 'Generar'}
                  </button>
                </div>
                <div
                  className="mindmap output-box min-h-[210px] rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3 text-zinc-300"
                >
                  <MindMapView markdown={m.mapMarkdown} loading={m.mapGenerating} />
                </div>
              </article>
            </div>
          </div>

          <section className={`rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 ${!m.workEnabled ? 'pointer-events-none opacity-40' : ''}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Chat de la grabación</h2>
                <p className="mt-1 text-xs text-zinc-500">Conserva el hilo y consulta el audio indexado.</p>
              </div>
              <button
                type="button"
                onClick={m.resetConversation}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Limpiar
              </button>
            </div>

            <div className="flex h-[420px] flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              {m.conversation.length === 0 ? (
                <div className="m-auto max-w-xs text-center text-sm text-zinc-600">
                  Pregunta algo o pídele que convierta la reunión en tareas, pitch o plan.
                </div>
              ) : (
                m.conversation.map((message, index) => (
                  <article
                    key={`${message.role}-${index}`}
                    className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'self-end bg-[#c7b8ea] text-zinc-950'
                        : 'self-start border border-zinc-800 bg-zinc-900 text-zinc-200'
                    }`}
                  >
                    {message.content}
                  </article>
                ))
              )}
            </div>

            <div className="mt-4">
              <VoiceChatControls minutero={m} />
            </div>

            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={m.question}
                onChange={(e) => m.setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') m.askQuestion()
                }}
                placeholder="Sigue la conversación..."
                className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-[#c7b8ea]/50"
              />
              <button
                type="button"
                onClick={m.askQuestion}
                disabled={m.isChatting}
                className="inline-flex items-center gap-2 rounded-xl bg-[#c7b8ea] px-4 py-3 text-sm font-semibold text-zinc-900 hover:bg-[#d4c8f0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                Enviar
              </button>
            </div>
          </section>
        </section>
      </main>
    </div>
  )
}

function ControlButton({
  icon: Icon,
  label,
  variant,
  onClick,
  disabled,
}: {
  icon: typeof Pause
  label: string
  variant?: 'stop'
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-center gap-2.5 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full border transition ${
          variant === 'stop'
            ? 'border-red-900/50 bg-red-950/40 text-red-400/80 group-hover:border-red-800/60'
            : 'border-zinc-800 bg-zinc-900/80 text-zinc-500 group-hover:border-zinc-700 group-hover:text-zinc-300'
        }`}
      >
        <Icon className="h-4 w-4" fill={variant === 'stop' ? 'currentColor' : 'none'} />
      </span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </button>
  )
}
