import {
  Bot,
  ChevronDown,
  Clock3,
  EyeOff,
  Folder,
  Globe,
  Inbox,
  Lock,
  MessageCircle,
  Search,
  Star,
  User,
} from 'lucide-react'
import type { ChatMessage, ChatSession } from '../useMinutero'

const THUMB_BARS_PURPLE = [4, 9, 6, 12, 8, 14, 10, 16, 7, 13, 9, 11, 6, 10]
const THUMB_BARS_TEAL = [5, 8, 11, 7, 14, 9, 12, 6, 15, 8, 10, 7, 13, 9]

type TimelineSection = {
  label: string
  active?: boolean
  items: ChatSession[]
}

function formatSessionTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Ahora'

  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function sectionLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recientes'

  const today = new Date()
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startToday - startDate) / 86_400_000)

  if (diffDays === 0) return 'Hoy'
  if (diffDays === 1) return 'Ayer'

  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

function buildSections(sessions: ChatSession[]) {
  const sections = new Map<string, TimelineSection>()

  sessions.forEach((session) => {
    const label = sectionLabel(session.updatedAt)
    const section = sections.get(label) ?? { label, active: label === 'Hoy', items: [] }
    section.items.push(session)
    sections.set(label, section)
  })

  return Array.from(sections.values())
}

function lastMessages(session: ChatSession) {
  return session.messages.slice(-3)
}

function lastUserMessage(session: ChatSession) {
  return [...session.messages].reverse().find((message) => message.role === 'user')?.content
}

function countMessages(session: ChatSession, role?: ChatMessage['role']) {
  return session.messages.filter((message) => !role || message.role === role).length
}

function ThumbnailWaveform({ accent }: { accent: 'purple' | 'teal' }) {
  const bars = accent === 'purple' ? THUMB_BARS_PURPLE : THUMB_BARS_TEAL
  const gradient =
    accent === 'purple'
      ? 'from-violet-600/30 to-[#c7b8ea]/80'
      : 'from-teal-600/30 to-teal-300/80'

  return (
    <div className="relative flex h-full min-h-[116px] w-[118px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-950/80 md:w-[148px]">
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
      <span className="absolute flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-sm">
        <MessageCircle className="h-3.5 w-3.5" />
      </span>
    </div>
  )
}

function MessagePreview({ message }: { message: ChatMessage }) {
  const Icon = message.role === 'user' ? User : Bot
  const label = message.role === 'user' ? 'Tú' : 'Minutero'

  return (
    <li className="flex min-w-0 items-start gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/35 px-3 py-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
      <p className="min-w-0 text-xs leading-relaxed text-zinc-400">
        <span className="font-medium text-zinc-300">{label}: </span>
        <span className="line-clamp-2">{message.content}</span>
      </p>
    </li>
  )
}

function TimelineChatItem({
  session,
  active,
  accent,
  onOpen,
}: {
  session: ChatSession
  active: boolean
  accent: 'purple' | 'teal'
  onOpen: (id: string) => void
}) {
  const messages = lastMessages(session)
  const userMessages = countMessages(session, 'user')

  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      className={`flex w-full gap-4 rounded-2xl border bg-[#141416]/80 p-4 text-left transition hover:border-zinc-700/80 hover:bg-[#18181b] ${
        active ? 'border-[#c7b8ea]/70 ring-1 ring-[#c7b8ea]/30' : 'border-zinc-800/60'
      }`}
      aria-current={active ? 'true' : undefined}
    >
      <ThumbnailWaveform accent={accent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="truncate font-semibold text-white">{session.title}</h4>
            <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
              {lastUserMessage(session) || 'Conversación local'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <Clock3 className="h-3 w-3" />
              {formatSessionTime(session.updatedAt)}
            </span>
            {active && <Star className="h-3.5 w-3.5 fill-amber-400/80 text-amber-400/80" />}
          </div>
        </div>

        <ul className="mt-3 space-y-2">
          {messages.map((message, index) => (
            <MessagePreview key={`${message.role}-${index}-${message.content.slice(0, 18)}`} message={message} />
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-500">
            #CHAT
          </span>
          <span className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-500">
            {userMessages} preguntas
          </span>
          <span className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-500">
            {session.messages.length} mensajes
          </span>
        </div>
      </div>
    </button>
  )
}

export function MemoryTimelinePage({
  chatSessions,
  activeChatId,
  onOpenChat,
}: {
  chatSessions: ChatSession[]
  activeChatId: string | null
  onOpenChat: (id: string) => void
}) {
  const sections = buildSections(chatSessions)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-zinc-800/60 px-4 py-4 md:px-8">
        <div className="mx-auto flex w-full max-w-xl flex-1 items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 backdrop-blur">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            type="text"
            readOnly
            placeholder="Busca en tus chats..."
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
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">Línea de tiempo</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
              Historial local de conversaciones sobre tus grabaciones indexadas.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterButton label="Chats recientes" hasChevron />
            <FilterButton icon={Star} label="Activos" />
            <FilterButton icon={Folder} label="Locales" />
          </div>
        </div>

        <div className="relative max-w-5xl">
          <div className="absolute top-2 bottom-0 left-[7px] w-px bg-zinc-800" aria-hidden />

          {sections.length === 0 ? (
            <section className="relative pl-10">
              <div className="absolute top-1.5 left-0 flex items-center">
                <span className="h-3.5 w-3.5 rounded-full bg-zinc-600 ring-4 ring-[#0f0f10]" />
              </div>
              <article className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8">
                <Inbox className="h-6 w-6 text-zinc-600" />
                <h3 className="mt-4 text-lg font-semibold text-white">Sin chats guardados</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
                  Cuando converses con Minutero, los hilos aparecerán aquí con sus últimos mensajes.
                </p>
              </article>
            </section>
          ) : (
            sections.map((section) => (
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
                  {section.items.map((session, index) => (
                    <TimelineChatItem
                      key={session.id}
                      session={session}
                      active={session.id === activeChatId}
                      accent={index % 2 === 0 ? 'purple' : 'teal'}
                      onOpen={onOpenChat}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
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
