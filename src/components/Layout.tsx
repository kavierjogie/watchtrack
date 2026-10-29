import { AnimatePresence } from 'framer-motion'
import { CalendarClock, CircleCheck, CirclePause, Compass, House, Library, ListPlus, Play, Plus, Settings, Share2, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { OPEN_EVENT } from '../lib/alerts'
import type { WatchStatus } from '../lib/types'
import { useLibrary } from '../state/library'
import { useAutoSync } from '../state/useSync'
import { AlertBell } from './Alerts'
import { Logo } from './Logo'
import { ShareDialog } from './ShareDialog'
import { TitleForm } from './TitleForm'

type NavItem = { to: string; label: string; icon: LucideIcon; mobile?: boolean; status?: WatchStatus }

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: House, mobile: true },
  { to: '/continue', label: 'Continue', icon: Play, mobile: true, status: 'watching' },
  { to: '/library', label: 'Library', icon: Library, mobile: true },
  { to: '/discover', label: 'Discover', icon: Compass, mobile: true },
  { to: '/plan', label: 'Plan to Watch', icon: ListPlus, status: 'plan' },
  { to: '/on-hold', label: 'On Hold', icon: CirclePause, status: 'on_hold' },
  { to: '/completed', label: 'Completed', icon: CircleCheck, status: 'completed' },
  { to: '/settings', label: 'Settings', icon: Settings, mobile: true },
]
const BROWSE = NAV.slice(0, 4)
const LISTS = NAV.slice(4, 7)
const SETTINGS = NAV[7]
/** Desktop sidebar only; phones reach it from the top bar. */
const UPCOMING: NavItem = { to: '/upcoming', label: 'Upcoming', icon: CalendarClock }

/** Paths a notification click may open (it arrives from the service worker or a plain Notification). */
const OPENABLE = /^\/(title\/[^/?#]+|notifications|upcoming)$/

/** Notification clicks: the service worker (or a fallback Notification) asks the open app to show a page. */
function useNotificationClicks() {
  const navigate = useNavigate()
  useEffect(() => {
    const go = (url: unknown) => typeof url === 'string' && OPENABLE.test(url) && navigate(url)
    const onEvent = (e: Event) => go((e as CustomEvent).detail)
    const onMessage = (e: MessageEvent) => e.data?.type === OPEN_EVENT && go(e.data.url)
    window.addEventListener(OPEN_EVENT, onEvent)
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener(OPEN_EVENT, onEvent)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [navigate])
}

const ADD_STATUS: Record<string, WatchStatus> = { plan: 'plan', watching: 'watching', on_hold: 'on_hold', completed: 'completed' }

/** index.html's title is the homepage title; app pages get "Label · WatchTrack". */
const HOME_TITLE = document.title
const PAGE_LABELS: Record<string, string> = { '/upcoming': 'Upcoming', '/notifications': 'Notifications', '/transfer': 'Move library', ...Object.fromEntries(NAV.map((n) => [n.to, n.label])) }
const SITE_URL = 'https://watchtrack-eta.vercel.app'

/**
 * Only "/" is indexable. Every other app route shows this device's own (for a crawler: empty) library, so it's noindex.
 * That also covers unknown paths, which render the dashboard with a 200 (SPA rewrite) and would otherwise be soft 404s.
 */
export function PageMeta({ pathname }: { pathname: string }) {
  useEffect(() => {
    const label = pathname === '/' ? null : (PAGE_LABELS[pathname] ?? (pathname.startsWith('/title/') ? 'Title' : pathname === '/shared' ? 'Shared watchlist' : null))
    document.title = label ? `${label} · WatchTrack` : HOME_TITLE
  }, [pathname])
  return pathname === '/' ? <link rel="canonical" href={`${SITE_URL}/`} /> : <meta name="robots" content="noindex" />
}

export function Layout() {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const { error, titles } = useLibrary()
  const add = params.get('add')
  useAutoSync()
  useNotificationClicks()
  const counts = useMemo(() => {
    const c: Partial<Record<WatchStatus, number>> = {}
    for (const t of titles) c[t.status] = (c[t.status] ?? 0) + 1
    return c
  }, [titles])

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
      p.delete('q')
      return p
    })
  const share = params.has('share') && titles.length > 0
  const closeShare = () =>
    setParams((p) => {
      p.delete('share')
      return p
    })

  return (
    // minmax(0,1fr): a plain 1fr track grows to its content's min-content width (e.g. the horizontal poster rail), pushing the page past the viewport.
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <PageMeta pathname={pathname} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-divider bg-bg-2 px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2.5 rounded-xl px-3">
            <Logo className="size-8" />
          </Link>
          <AlertBell />
        </div>
        <button type="button" onClick={openAdd} className="btn-primary mb-6 w-full">
          <Plus className="size-4" aria-hidden /> Add title
        </button>
        <nav className="space-y-6" aria-label="Main">
          <ul className="space-y-0.5">
            {BROWSE.map((n) => (
              <SideItem key={n.to} {...n} count={n.status ? counts[n.status] : undefined} />
            ))}
            <SideItem {...UPCOMING} />
          </ul>
          <div>
            <p className="eyebrow mb-1.5 px-3">Lists</p>
            <ul className="space-y-0.5">
              {LISTS.map((n) => (
                <SideItem key={n.to} {...n} count={n.status ? counts[n.status] : undefined} />
              ))}
            </ul>
          </div>
        </nav>
        <div className="mt-auto space-y-3 pt-6">
          <ul>
            <SideItem {...SETTINGS} />
          </ul>
          <p className="px-3 text-[11px] leading-relaxed text-muted">
            Your data is stored only in this browser on this device.{' '}
            <a href="/about" className="underline hover:text-fg">
              About WatchTrack
            </a>
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-divider bg-bg/80 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl lg:hidden reduce-transparency:bg-bg reduce-transparency:backdrop-blur-none">
        <Link to="/" className="flex min-w-0 items-center gap-2 rounded-lg">
          <Logo />
        </Link>
        <div className="flex items-center">
          <NavLink to="/upcoming" className={({ isActive }) => `icon-btn ${isActive ? 'text-accent-text' : ''}`} aria-label="Upcoming releases">
            <CalendarClock className="size-5" aria-hidden />
          </NavLink>
          <AlertBell />
          {titles.length > 0 && (
            <Link to="?share=1" className="icon-btn" aria-label="Share watchlist">
              <Share2 className="size-5" aria-hidden />
            </Link>
          )}
          <NavLink to="/settings" className={({ isActive }) => `icon-btn ${isActive ? 'text-accent-text' : ''}`} aria-label="Settings">
            <Settings className="size-5" aria-hidden />
          </NavLink>
        </div>
      </header>

      <main id="main" className="mx-auto w-full min-w-0 max-w-7xl px-4 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
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
        className="fixed inset-x-0 bottom-0 z-30 border-t border-divider bg-bg-2/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden reduce-transparency:bg-bg-2 reduce-transparency:backdrop-blur-none"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5 px-1">
          {BROWSE.slice(0, 2).map((n) => (
            <MobileItem key={n.to} {...n} />
          ))}
          <li className="flex items-center justify-center">
            <button
              type="button"
              onClick={openAdd}
              aria-label="Add title"
              className="press flex size-12 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-[0_8px_24px_-10px_var(--accent-strong)] hover:bg-accent-hover"
            >
              <Plus className="size-6" aria-hidden />
            </button>
          </li>
          {BROWSE.slice(2).map((n) => (
            <MobileItem key={n.to} {...n} />
          ))}
        </ul>
      </nav>

      <AnimatePresence>{add && <TitleForm open onClose={closeAdd} defaultStatus={ADD_STATUS[add]} initialQuery={params.get('q') ?? undefined} />}</AnimatePresence>
      <AnimatePresence>{share && <ShareDialog onClose={closeShare} only={params.get('share') !== '1' ? (params.get('share') ?? undefined) : undefined} />}</AnimatePresence>
    </div>
  )
}

function SideItem({ to, label, icon: Icon, count }: NavItem & { count?: number }) {
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/'}
        className={({ isActive }) =>
          `relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
            isActive
              ? 'bg-accent-soft text-accent-text before:absolute before:inset-y-2.5 before:-left-3 before:w-1 before:rounded-r-full before:bg-accent'
              : 'text-fg-2 hover:bg-surface-2 hover:text-fg'
          }`
        }
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!!count && <span className="text-xs tabular-nums opacity-70">{count}</span>}
      </NavLink>
    </li>
  )
}

function MobileItem({ to, label, icon: Icon }: NavItem) {
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/'}
        className={({ isActive }) =>
          `group flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium ${isActive ? 'text-accent-text' : 'text-fg-2 hover:text-fg'}`
        }
      >
        {({ isActive }) => (
          <>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${isActive ? 'bg-accent-soft' : 'group-hover:bg-surface-2'}`}>
              <Icon className="size-5" aria-hidden />
            </span>
            {label}
          </>
        )}
      </NavLink>
    </li>
  )
}
