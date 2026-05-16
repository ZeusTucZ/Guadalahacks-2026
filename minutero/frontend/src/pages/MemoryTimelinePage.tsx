import {
  ChevronDown,
  EyeOff,
  Folder,
  Globe,
  Lock,
  Play,
  Search,
  Star,
} from 'lucide-react'

const THUMB_BARS_PURPLE = [4, 9, 6, 12, 8, 14, 10, 16, 7, 13, 9, 11, 6, 10]
const THUMB_BARS_TEAL = [5, 8, 11, 7, 14, 9, 12, 6, 15, 8, 10, 7, 13, 9]

type MemoryCard = {
  title: string
  time: string
  starred?: boolean
  description: string
  tags: string[]
  accent: 'purple' | 'teal'
}

type TimelineSection = {
  label: string
  active?: boolean
  items: MemoryCard[]
}

const SECTIONS: TimelineSection[] = [
  {
    label: 'Hoy',
    active: true,
    items: [
      {
        title: 'Sincronización de visión de producto',
        time: '10:42 AM',
        starred: true,
        description:
          'Discutimos la hoja de ruta del Q4 y la necesidad de una arquitectura desacoplada para el procesamiento de inferencia local.',
        tags: ['#REUNIÓN', '#ARQUITECTURA'],
        accent: 'purple',
      },
      {
        title: 'Notas de lluvia de ideas',
        time: '2:15 PM',
        description:
          'Ideas iniciales para el flujo de captura de voz y cómo indexar memorias sin enviar datos a la nube.',
        tags: ['#IDEA', '#PRODUCTO'],
        accent: 'teal',
      },
    ],
  },
  {
    label: 'Ayer',
    items: [
      {
        title: 'Revisión de sprint semanal',
        time: '9:00 AM',
        starred: true,
        description:
          'Repaso de tareas completadas, bloqueos del equipo y prioridades para la siguiente iteración del hackathon.',
        tags: ['#REUNIÓN', '#SPRINT'],
        accent: 'purple',
      },
    ],
  },
  {
    label: 'Semana pasada',
    items: [
      {
        title: 'Sesión de arquitectura técnica',
        time: 'Nov 12',
        description:
          'Definición del pipeline de transcripción local con Whisper y chunking para consultas con RAG.',
        tags: ['#ARQUITECTURA', '#LOCAL-AI'],
        accent: 'teal',
      },
      {
        title: 'Diario personal matutino',
        time: 'Nov 11',
        description:
          'Reflexión sobre rutinas de productividad y objetivos de la semana del proyecto Minutero.',
        tags: ['#PERSONAL', '#PRODUCTIVIDAD'],
        accent: 'purple',
      },
    ],
  },
]

function ThumbnailWaveform({ accent }: { accent: 'purple' | 'teal' }) {
  const bars = accent === 'purple' ? THUMB_BARS_PURPLE : THUMB_BARS_TEAL
  const gradient =
    accent === 'purple'
      ? 'from-violet-600/30 to-[#c7b8ea]/80'
      : 'from-teal-600/30 to-teal-300/80'

  return (
    <div className="relative flex h-full min-h-[100px] w-[140px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-950/80 md:w-[160px]">
      <div
        className={`absolute inset-0 bg-gradient-to-br ${accent === 'purple' ? 'from-violet-600/10' : 'from-teal-600/10'} to-transparent`}
      />
      <div className="flex h-12 items-end gap-[2px]">
        {bars.map((h, i) => (
          <span
            key={i}
            className={`w-[3px] rounded-full bg-gradient-to-t ${gradient}`}
            style={{ height: `${h * 2.5}px` }}
          />
        ))}
      </div>
      <button
        type="button"
        className="absolute flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-sm"
        aria-label="Reproducir"
      >
        <Play className="h-3.5 w-3.5 fill-current" />
      </button>
    </div>
  )
}

function MemoryCardItem({ card }: { card: MemoryCard }) {
  return (
    <article className="flex gap-4 rounded-2xl border border-zinc-800/60 bg-[#141416]/80 p-4 transition hover:border-zinc-700/80 hover:bg-[#18181b]">
      <ThumbnailWaveform accent={card.accent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h4 className="font-semibold text-white">{card.title}</h4>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-zinc-500">{card.time}</span>
            {card.starred && <Star className="h-3.5 w-3.5 fill-amber-400/80 text-amber-400/80" />}
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-zinc-500">{card.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-500"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}

export function MemoryTimelinePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-4 border-b border-zinc-800/60 px-4 py-4 md:px-8">
        <div className="mx-auto flex w-full max-w-xl flex-1 items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 backdrop-blur">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            type="text"
            readOnly
            placeholder="Busca en tus memorias..."
            className="w-full bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-600"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/5 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-teal-400 sm:inline-flex">
            <Globe className="h-3 w-3" />
            PROCESAMIENTO EN DISPOSITIVO
          </span>
          <button type="button" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
            <EyeOff className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
            <Lock className="h-4 w-4" />
          </button>
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#c7b8ea] to-violet-600" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-8 md:px-10">
        {/* Page header */}
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">Línea de tiempo</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
              Un mapa temporal de tus pensamientos, capturados por voz y sintetizados localmente en
              insights accionables.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterButton label="Todas las memorias" hasChevron />
            <FilterButton icon={Star} label="Importantes" />
            <FilterButton icon={Folder} label="Categorías" />
          </div>
        </div>

        {/* Timeline */}
        <div className="relative max-w-4xl">
          <div className="absolute top-2 bottom-0 left-[7px] w-px bg-zinc-800" aria-hidden />

          {SECTIONS.map((section) => (
            <section key={section.label} className="relative mb-10 pl-10">
              <div className="absolute top-1.5 left-0 flex items-center">
                <span
                  className={`h-3.5 w-3.5 rounded-full ring-4 ring-[#0f0f10] ${
                    section.active ? 'bg-[#c7b8ea]' : 'bg-zinc-600'
                  }`}
                />
              </div>
              <h3 className="mb-4 text-sm font-semibold text-zinc-400">{section.label}</h3>
              <div className="space-y-4">
                {section.items.map((card) => (
                  <MemoryCardItem key={card.title} card={card} />
                ))}
              </div>
            </section>
          ))}

          <p className="mt-4 pl-10 text-center text-sm text-zinc-600">
            12 memorias más archivadas esta semana
          </p>
        </div>
      </main>
    </div>
  )
}

function FilterButton({
  icon: Icon,
  label,
  hasChevron,
}: {
  icon?: typeof Star
  label: string
  hasChevron?: boolean
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
      {hasChevron && <ChevronDown className="h-3 w-3 opacity-60" />}
    </button>
  )
}
