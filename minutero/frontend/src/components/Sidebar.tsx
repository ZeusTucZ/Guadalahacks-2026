import {
  Activity,
  LayoutDashboard,
  Mic,
  Search,
  Settings,
  Shield,
} from 'lucide-react'

export type AppView = 'dashboard' | 'recordings'

type NavItem = {
  id: AppView | 'timeline' | 'search' | 'settings'
  icon: typeof LayoutDashboard
  label: string
}

const NAV: NavItem[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'recordings', icon: Mic, label: 'Grabaciones' },
  { id: 'timeline', icon: Activity, label: 'Línea de tiempo' },
  { id: 'search', icon: Search, label: 'Buscar' },
  { id: 'settings', icon: Settings, label: 'Ajustes' },
]

type SidebarProps = {
  activeView: AppView
  localActive: boolean
  onNavigate: (view: AppView) => void
  onNewRecording?: () => void
}

export function Sidebar({ activeView, localActive, onNavigate, onNewRecording }: SidebarProps) {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-zinc-800/80 bg-[#0c0c0e] px-5 py-6 lg:flex">
      <div className="mb-8">
        <h1 className="text-xl font-bold tracking-tight text-white">Minutero</h1>
        <p className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
          <span className={`h-2 w-2 rounded-full ${localActive ? 'bg-teal-400' : 'bg-amber-500'}`} />
          {localActive ? 'IA local activa' : 'IA local pendiente'}
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const isPage = item.id === 'dashboard' || item.id === 'recordings'
          const isActive = item.id === activeView
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                if (isPage) onNavigate(item.id)
              }}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                isActive
                  ? 'border-l-2 border-[#c7b8ea] bg-[#c7b8ea]/10 text-white'
                  : 'border-l-2 border-transparent text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
              }`}
            >
              <item.icon className={`h-4 w-4 ${isActive ? 'text-[#c7b8ea]' : ''}`} />
              {item.label}
            </button>
          )
        })}
      </nav>

      {activeView === 'dashboard' && onNewRecording && (
        <button
          type="button"
          onClick={onNewRecording}
          className="mt-6 w-full rounded-xl bg-[#c7b8ea] px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-[#d4c8f0]"
        >
          Nueva grabación
        </button>
      )}

      <button
        type="button"
        className={`flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs text-zinc-400 transition hover:text-zinc-200 ${
          activeView === 'recordings' ? 'mt-auto' : 'mt-6'
        }`}
      >
        <Shield className="h-4 w-4" />
        Estado de privacidad
      </button>
    </aside>
  )
}
