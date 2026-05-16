import {
  Bookmark,
  CloudOff,
  Lock,
  Mic,
  Pause,
  Square,
  Target,
} from 'lucide-react'

const LIVE_BARS = [
  4, 8, 6, 12, 7, 14, 9, 16, 11, 18, 8, 15, 10, 13, 6, 11, 9, 14, 7, 12, 10, 17, 8, 13, 11, 15, 9, 12, 6, 10,
]

function LiveWaveform() {
  return (
    <div className="flex h-16 items-end justify-center gap-[3px]">
      {LIVE_BARS.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-gradient-to-t from-violet-600/40 to-[#c7b8ea]"
          style={{ height: `${h * 3}px` }}
        />
      ))}
    </div>
  )
}

export function RecordingsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <span className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/5 px-3 py-1.5 text-xs font-medium text-teal-400">
          <Target className="h-3.5 w-3.5" />
          Procesando localmente
        </span>
        <div className="flex items-center gap-2">
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

      {/* Recording center */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-6">
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          <div className="h-72 w-72 rounded-full bg-violet-600/10 blur-3xl" />
        </div>

        <p className="relative font-mono text-6xl font-light tracking-tight text-white tabular-nums md:text-7xl">
          04:21:08
        </p>
        <p className="relative mt-3 text-[11px] font-medium tracking-[0.35em] text-zinc-500">
          GRABACIÓN ACTIVA
        </p>

        <div className="relative mt-10 w-full max-w-md">
          <LiveWaveform />
        </div>

        <button
          type="button"
          className="relative mt-10 flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[#c7b8ea]/25 ring-1 ring-[#c7b8ea]/30 transition hover:bg-[#c7b8ea]/35"
          aria-label="Micrófono"
        >
          <Mic className="h-9 w-9 text-[#9b8ab8]" strokeWidth={1.5} />
        </button>

        <div className="relative mt-10 flex items-center gap-12">
          <ControlButton icon={Pause} label="Pausar" />
          <ControlButton icon={Square} label="Detener" variant="stop" />
          <ControlButton icon={Bookmark} label="Marcar" />
        </div>
      </div>

      {/* Live transcription */}
      <section className="mx-4 mb-8 md:mx-10">
        <article className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 md:p-8">
          <span className="inline-flex rounded-md border border-teal-500/30 bg-teal-500/5 px-2.5 py-1 text-[11px] font-medium text-teal-400">
            Transcripción en vivo
          </span>
          <p className="mt-5 text-sm leading-relaxed text-zinc-500">
            …y fue entonces cuando me di cuenta de que la arquitectura necesitaba estar
            completamente desacoplada del hilo principal.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-zinc-100">
            Al priorizar la inferencia local, no solo mejoramos la velocidad de la interfaz, sino
            que también garantizamos que los datos del usuario nunca salgan de su dispositivo físico.
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[#c7b8ea]" />
          </p>
        </article>
      </section>
    </div>
  )
}

function ControlButton({
  icon: Icon,
  label,
  variant,
}: {
  icon: typeof Pause
  label: string
  variant?: 'stop'
}) {
  return (
    <button type="button" className="group flex flex-col items-center gap-2.5">
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
