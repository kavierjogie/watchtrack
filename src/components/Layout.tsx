import { AnimatePresence } from 'framer-motion'
import { CircleCheck, CirclePause, House, Library, ListPlus, Play, Plus, Settings, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import type { WatchStatus } from '../lib/types'
import { useLibrary } from '../state/library'
import { TitleForm } from './TitleForm'

const NAV: { to: string; label: string; icon: LucideIcon; mobile?: boolean }[] = [
  { to: '/', label: 'Home', icon: House, mobile: true },
  { to: '/continue', label: 'Continue', icon: Play, mobile: true },
  { to: '/library', label: 'Library', icon: Library, mobile: true },
  { to: '/plan', label: 'Plan to Watch', icon: ListPlus },
  { to: '/on-hold', label: 'On Hold', icon: CirclePause },
  { to: '/completed', label: 'Completed', icon: CircleCheck },
  { to: '/settings', label: 'Settings', icon: Settings, mobile: true },
]

const ADD_STATUS: Record<string, WatchStatus> = { plan: 'plan', watching: 'watching', on_hold: 'on_hold', completed: 'completed' }

export function Layout() {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const { error } = useLibrary()
  const add = params.get('add')

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const openAdd = () =>
    setParams((p) => {
      p.set('add', '1')
      return p
    })
  const closeAdd = () =>
    setParams((p) => {
      p.delete('add')
      return p
    })

  return (
    // minmax(0,1fr): a plain 1fr track grows to its content's min-content width (e.g. the horizontal poster rail), pushing the page past the viewport.
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-3">
          <img src="/icon.svg" alt="" className="size-7" />
          <span className="font-semibold tracking-tight">WatchTrack</span>
        </div>
        <button type="button" onClick={openAdd} className="btn-primary mb-4 w-full">
          <Plus className="size-4" aria-hidden /> Add title
        </button>
        <nav className="space-y-1" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-surface-2 hover:text-fg'
                }`
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="mt-auto px-3 text-[11px] leading-relaxed text-muted">Your data is stored only in this browser on this device.</p>
      </aside>

      <main id="main" className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        {error && (
          <div className="mb-6 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
            {error}
          </div>
        )}
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/75 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden reduce-transparency:bg-surface reduce-transparency:backdrop-blur-none"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {NAV.filter((n) => n.mobile)
            .slice(0, 3)
            .map((n) => (
              <MobileItem key={n.to} {...n} />
            ))}
          <li className="flex items-center justify-center">
            <button type="button" onClick={openAdd} aria-label="Add title" className="flex size-12 items-center justify-center rounded-2xl bg-accent text-white shadow-lg">
              <Plus className="size-6" aria-hidden />
            </button>
          </li>
          <MobileItem {...NAV[NAV.length - 1]} />
        </ul>
      </nav>

      <AnimatePresence>{add && <TitleForm open onClose={closeAdd} defaultStatus={ADD_STATUS[add]} />}</AnimatePresence>
    </div>
  )
}

function MobileItem({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/'}
        className={({ isActive }) =>
          `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-accent-text' : 'text-muted'}`
        }
      >
        <Icon className="size-5" aria-hidden />
        {label}
      </NavLink>
    </li>
  )
}
