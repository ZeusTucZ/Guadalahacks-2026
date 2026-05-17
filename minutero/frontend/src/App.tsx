import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Activity,
  AudioLines,
  Calendar,
  CheckSquare,
  EyeOff,
  Lightbulb,
  Lock,
  Plane,
  Play,
  Plus,
  Search,
  Shield,
  Sparkles,
  Upload,
} from 'lucide-react'
import { Sidebar, type AppView } from './components/Sidebar'
import { MindMapView } from './components/MindMapView'
import { MemoryTimelinePage } from './pages/MemoryTimelinePage'
import { RecordingsPage } from './pages/RecordingsPage'
import { useMinutero, type ImportantDate } from './useMinutero'

const WAVEFORM = [3, 7, 5, 9, 4, 8, 6, 10, 5, 7, 4, 9, 6, 8, 5, 11, 4, 7, 6, 9]
const TRANSCRIPT_PREVIEW_LIMIT = 180

function Waveform({ color }: { color: 'purple' | 'teal' }) {
  const bar =
    color === 'purple'
      ? 'bg-gradient-to-t from-violet-500/30 to-[#c7b8ea]'
      : 'bg-gradient-to-t from-teal-500/30 to-teal-300'
  return (
    <div className="mt-4 flex h-10 items-end gap-[3px]">
      {WAVEFORM.map((h, i) => (
        <span key={i} className={`w-[3px] rounded-full ${bar}`} style={{ height: `${h * 3}px` }} />
      ))}
    </div>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-500'}`}
    />
  )
}

function scrollToRef(ref: RefObject<HTMLElement | null>) {
  ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function App() {
  const [view, setView] = useState<AppView>('dashboard')
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const m = useMinutero()
  const uploadRef = useRef<HTMLElement>(null)
  const outputsRef = useRef<HTMLElement>(null)
  const questionsRef = useRef<HTMLElement>(null)
  const statusRef = useRef<HTMLElement>(null)

  const localActive = m.ollamaOk && m.modelOk
  const canExpandPreview = m.preview.length > TRANSCRIPT_PREVIEW_LIMIT
  const previewText =
    !previewExpanded && canExpandPreview
      ? `${m.preview.slice(0, TRANSCRIPT_PREVIEW_LIMIT).trimEnd()}...`
      : m.preview

  useEffect(() => {
    setPreviewExpanded(false)
  }, [m.preview])

  return (
    <div className="flex min-h-screen bg-[#09090b] text-zinc-100">
      <Sidebar
        activeView={view}
        localActive={localActive}
        onNavigate={setView}
        onNewRecording={m.openFilePicker}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {view === 'recordings' ? (
          <RecordingsPage minutero={m} />
        ) : view === 'timeline' ? (
          <MemoryTimelinePage
            chatSessions={m.chatSessions}
            activeChatId={m.activeChatId}
            onOpenChat={(id) => {
              m.openChatSession(id)
              setView('recordings')
            }}
          />
        ) : (
          <>
        <header className="flex items-center gap-4 border-b border-zinc-800/60 px-4 py-4 md:px-8">
          <div className="mx-auto flex w-full max-w-xl items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 backdrop-blur">
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              type="text"
              readOnly
              onFocus={() => scrollToRef(questionsRef)}
              placeholder="Busca en tus memorias..."
              className="w-full bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-600"
            />
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <button type="button" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
              <EyeOff className="h-4 w-4" />
            </button>
            <button type="button" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
              <Lock className="h-4 w-4" />
            </button>
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#c7b8ea] to-violet-600" />
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto px-4 pb-28 md:px-8">
            {/* Hero */}
            <section className="mb-8 flex flex-col gap-4 pt-6 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                  Tu memoria personal
                </h2>
                <p className="mt-2 max-w-xl text-sm text-zinc-500">
                  Capturada localmente, asegurada para siempre. Convierte audio en resúmenes, mapas
                  mentales y respuestas consultables.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold tracking-wider ${
                    m.ollamaOk
                      ? 'border-teal-500/40 text-teal-400'
                      : 'border-zinc-700 text-zinc-500'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${m.ollamaOk ? 'bg-teal-400' : 'bg-zinc-600'}`} />
                  EJECUTANDO LOCAL
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-zinc-500">
                  <Plane className="h-3 w-3" />
                  MODO OFFLINE
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-zinc-500">
                  <Shield className="h-3 w-3" />
                  SIN NUBE
                </span>
              </div>
            </section>

            {/* Status — hidden visually in grid but keeps data for logic */}
            <section
              ref={statusRef}
              className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3"
              aria-label="Estado del sistema"
            >
              <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <span className="text-xs text-zinc-500">Ollama</span>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  <StatusDot ok={m.ollamaOk} />
                  {m.ollamaOk ? 'Conectado' : 'No conectado'}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <span className="text-xs text-zinc-500">Modelo local</span>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  <StatusDot ok={m.modelOk} />
                  {m.modelOk ? m.modelName || 'Listo' : 'No disponible'}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <span className="text-xs text-zinc-500">Chunks indexados</span>
                <p className="mt-1 text-lg font-semibold">{m.chunkCount}</p>
              </article>
            </section>

            {/* Upload / Recent recordings */}
            <section ref={uploadRef} className="mb-8">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Grabaciones recientes</h3>
                <button
                  type="button"
                  onClick={m.openFilePicker}
                  className="text-xs font-medium text-[#c7b8ea] hover:underline"
                >
                  Ver todas
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Upload card */}
                <article
                  className={`rounded-2xl border bg-zinc-900/50 p-5 transition ${
                    m.isDragOver ? 'border-[#c7b8ea]/60 bg-[#c7b8ea]/5' : 'border-zinc-800'
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Seleccionar archivo de audio"
                    onClick={m.openFilePicker}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        m.openFilePicker()
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      m.setIsDragOver(true)
                    }}
                    onDragLeave={() => m.setIsDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      m.setIsDragOver(false)
                      m.handleFiles(e.dataTransfer.files)
                    }}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/20 text-[#c7b8ea]">
                        <Upload className="h-5 w-5" />
                      </div>
                      <span className="text-xs text-zinc-600">Ahora</span>
                    </div>
                    <h4 className="mt-4 font-semibold text-white">Subir audio</h4>
                    <p className="mt-1 text-xs text-zinc-500">
                      Suelta un archivo o haz clic · .wav, .mp3, .m4a, .ogg, .mp4
                    </p>
                    {m.fileMeta && <p className="mt-2 text-xs font-medium text-[#c7b8ea]">{m.fileMeta}</p>}
                    <Waveform color="purple" />
                  </div>

                  <input
                    ref={m.audioInputRef}
                    type="file"
                    accept=".wav,.mp3,.m4a,.ogg,.webm,.mp4,audio/*,video/mp4"
                    hidden
                    onChange={(e) => m.handleFiles(e.target.files)}
                  />

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={m.indexBtnDisabled}
                      onClick={() => void m.indexAudio()}
                      className="rounded-lg bg-[#c7b8ea] px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-[#d4c8f0] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Transcribir e indexar
                    </button>
                    {m.isWorking && (
                      <span
                        className="inline-block h-4 w-4 rounded-full border-2 border-zinc-700 border-t-[#c7b8ea] spinner-active"
                        aria-hidden
                      />
                    )}
                    <span className="text-xs text-zinc-500">{m.uploadMessage}</span>
                  </div>
                </article>

                {/* Preview card */}
                <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300">
                      <AudioLines className="h-5 w-5" />
                    </div>
                    <span className="text-xs text-zinc-600">Vista previa</span>
                  </div>
                  <h4 className="mt-4 font-semibold text-white">Transcripción</h4>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
                    {previewText}
                  </p>
                  {canExpandPreview && (
                    <button
                      type="button"
                      onClick={() => setPreviewExpanded((current) => !current)}
                      className="mt-3 text-xs font-medium text-[#c7b8ea] transition hover:text-[#d4c8f0]"
                    >
                      {previewExpanded ? 'Ver menos' : 'Ver más'}
                    </button>
                  )}
                  <Waveform color="teal" />
                </article>
              </div>
            </section>

            {/* Key insights = outputs */}
            <section
              ref={outputsRef}
              className={`mb-8 ${!m.workEnabled ? 'pointer-events-none opacity-40' : ''}`}
            >
              <h3 className="mb-4 text-lg font-semibold text-white">Insights clave</h3>

              <div className="mb-4 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#c7b8ea]">
                      <Sparkles className="h-4 w-4" />
                      <span className="text-sm font-medium">Resumen ejecutivo</span>
                    </div>
                    <button
                      type="button"
                      onClick={m.generateSummary}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-[#c7b8ea]/50 hover:text-white"
                    >
                      Generar resumen
                    </button>
                  </div>
                  <div
                    className="output-box min-h-[140px] rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3 text-zinc-300"
                    aria-live="polite"
                  >
                    {m.summaryOutput || (
                      <span className="text-zinc-600">El resumen aparecerá aquí.</span>
                    )}
                  </div>
                  {m.summaryOutput && (
                    <p className="mt-3 text-[10px] font-semibold tracking-wider text-zinc-600">
                      EXTRAÍDO DE LA GRABACIÓN INDEXADA
                    </p>
                  )}
                </article>

                <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-400">
                      <Lightbulb className="h-4 w-4" />
                      <span className="text-sm font-medium">Mapa mental</span>
                    </div>
                    <button
                      type="button"
                      onClick={m.generateMap}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-[#c7b8ea]/50 hover:text-white"
                    >
                      Generar mapa mental
                    </button>
                  </div>
                  <div
                    className="mindmap output-box min-h-[140px] rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3 text-zinc-300"
                    aria-live="polite"
                  >
                    <MindMapView markdown={m.mapMarkdown} loading={m.mapGenerating} />
                  </div>
                </article>
              </div>
            </section>

            {/* Questions */}
            <section
              ref={questionsRef}
              className={`mb-8 ${!m.workEnabled ? 'pointer-events-none opacity-40' : ''}`}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Chat de la reunión</h3>
                  <p className="mt-1 text-xs text-zinc-500">Conserva el hilo y consulta el audio indexado.</p>
                </div>
                <button
                  type="button"
                  onClick={m.resetConversation}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Limpiar chat
                </button>
              </div>

              <div className="mb-4 flex max-h-[360px] min-h-[220px] flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                {m.conversation.length === 0 ? (
                  <div className="m-auto max-w-md text-center text-sm text-zinc-600">
                    Pregunta algo sobre la grabación o continúa la conversación como lo harías con ChatGPT.
                  </div>
                ) : (
                  m.conversation.map((message, index) => (
                    <article
                      key={`${message.role}-${index}`}
                      className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        message.role === 'user'
                          ? 'self-end bg-[#c7b8ea] text-zinc-950'
                          : 'self-start border border-zinc-800 bg-zinc-950/60 text-zinc-200'
                      }`}
                    >
                      {message.content}
                    </article>
                  ))
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={m.question}
                  onChange={(e) => m.setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') m.askQuestion()
                  }}
                  placeholder="Pregunta algo o sigue la conversación..."
                  className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-[#c7b8ea]/50"
                />
                <button
                  type="button"
                  onClick={m.askQuestion}
                  disabled={m.isChatting}
                  className="rounded-xl bg-[#c7b8ea] px-6 py-3 text-sm font-semibold text-zinc-900 hover:bg-[#d4c8f0]"
                >
                  {m.isChatting ? 'Generando...' : 'Enviar'}
                </button>
              </div>
            </section>

            <section className="mb-8 xl:hidden">
              <WidgetDates dates={m.importantDates} />
            </section>
          </main>

          {/* Right panel */}
          <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-zinc-800/60 bg-[#0c0c0e]/50 p-5 xl:block">
            <WidgetActionItems workEnabled={m.workEnabled} chunkCount={m.chunkCount} />
            <WidgetDates dates={m.importantDates} />
            <WidgetSmartInsights
              chunkCount={m.chunkCount}
              ollamaOk={m.ollamaOk}
              preview={m.preview}
            />
          </aside>
        </div>

        <nav className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/90 px-2 py-2 shadow-2xl backdrop-blur-md">
          <button
            type="button"
            onClick={() => setView('recordings')}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white"
          >
            <Plus className="h-4 w-4" />
            Grabar
          </button>
          <button
            type="button"
            onClick={() => scrollToRef(outputsRef)}
            className="flex items-center gap-2 rounded-full bg-[#c7b8ea] px-5 py-2.5 text-xs font-semibold text-zinc-900"
          >
            <Play className="h-4 w-4 fill-current" />
            Reproducir
          </button>
          <button
            type="button"
            onClick={() => scrollToRef(statusRef)}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white"
          >
            <Activity className="h-4 w-4" />
            Estado local
          </button>
        </nav>
          </>
        )}
      </div>
    </div>
  )
}

function WidgetActionItems({
  workEnabled,
  chunkCount,
}: {
  workEnabled: boolean
  chunkCount: number
}) {
  const steps = [
    { label: 'Subir audio', done: workEnabled || chunkCount > 0 },
    { label: 'Transcribir e indexar', done: chunkCount > 0 },
    { label: 'Generar resumen', done: false },
    { label: 'Hacer preguntas', done: chunkCount > 0 },
  ]

  return (
    <article className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <CheckSquare className="h-4 w-4 text-zinc-500" />
        Tareas
      </h4>
      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                step.done ? 'border-[#c7b8ea] bg-[#c7b8ea]/20' : 'border-zinc-600'
              }`}
            >
              {step.done && <span className="h-2 w-2 rounded-sm bg-[#c7b8ea]" />}
            </span>
            <span className="text-sm text-zinc-400">{step.label}</span>
            {step.label === 'Subir audio' && (
              <span className="ml-auto rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold text-orange-400">
                Alta
              </span>
            )}
            {step.label === 'Generar resumen' && (
              <span className="ml-auto rounded bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-400">
                Med
              </span>
            )}
          </li>
        ))}
      </ul>
    </article>
  )
}

function WidgetDates({ dates }: { dates: ImportantDate[] }) {
  return (
    <article className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <Calendar className="h-4 w-4 text-zinc-500" />
        Fechas importantes
      </h4>
      {dates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-relaxed text-zinc-500">
          Cuando menciones una fecha en el chat, aparecerá aquí automáticamente.
        </p>
      ) : (
        <ul className="space-y-4">
          {dates.map((d) => (
            <li key={d.id} className="flex gap-3">
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/50 text-center">
                <span className="text-[9px] font-bold text-zinc-500">{d.day}</span>
                <span className="text-sm font-bold text-white">{d.num}</span>
              </div>
              <div>
                <p className="text-sm font-medium text-white">{d.title}</p>
                <p className="text-xs text-zinc-500">{d.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function WidgetSmartInsights({
  chunkCount,
  ollamaOk,
  preview,
}: {
  chunkCount: number
  ollamaOk: boolean
  preview: string
}) {
  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="mb-3 text-sm font-semibold text-white">Insights inteligentes</h4>
      <p className="text-sm leading-relaxed text-zinc-400">
        {chunkCount > 0 ? (
          <>
            Tienes{' '}
            <span className="font-medium text-teal-400">{chunkCount} fragmentos</span> indexados.
            {ollamaOk ? (
              <>
                {' '}
                El modelo local está listo para generar{' '}
                <span className="text-[#c7b8ea]">resúmenes</span> y{' '}
                <span className="text-amber-400">mapas mentales</span>.
              </>
            ) : (
              ' Conecta Ollama para habilitar la generación.'
            )}
          </>
        ) : (
          'Sube y procesa una grabación para empezar a extraer insights de tus reuniones.'
        )}
      </p>
      {preview.length > 20 && (
        <p className="mt-3 line-clamp-2 text-xs italic text-zinc-500">&ldquo;{preview.slice(0, 120)}…&rdquo;</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {['#reuniones', '#productividad', '#local-ai'].map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] text-zinc-500"
          >
            {tag}
          </span>
        ))}
      </div>
    </article>
  )
}
