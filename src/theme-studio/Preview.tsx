/**
 * A static, screenshot-faithful WatchTrack screen for the Theme Studio. It uses the app's own utilities (btn-*, card, chip,
 * input, poster-grid) and pure components (Poster, StatusBadge, ProgressBar, StatCard, Rating, Section), with sample data
 * and live poster art. No router, no library state, no database writes: every control is inert.
 *
 * Layout breakpoints are container queries (@5xl = the app's lg sidebar breakpoint), so a frame shows the phone or
 * desktop layout from its own width, not the browser's.
 */
import {
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CirclePause,
  Compass,
  House,
  LayoutGrid,
  Library,
  List,
  ListPlus,
  Minus,
  Play,
  Plus,
  Search,
  Settings,
  Share2,
  Sparkles,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ProgressBar, Rating, Section, StatCard, StatusBadge } from '../components/cards'
import { Poster } from '../components/Poster'
import { searchTitles, type Provider } from '../lib/metadata'
import { MEDIA_LABEL, STATUS_LABEL, type MediaType, type WatchStatus } from '../lib/types'

interface Item {
  q: string
  provider: Provider
  title: string
  type: MediaType
  year: number
  status: WatchStatus
  rating?: number
  done?: number
  total?: number
  next?: string
  last?: string
  ago?: string
  line?: string
}

const LIBRARY: Item[] = [
  { q: 'Frieren', provider: 'kitsu', title: "Frieren: Beyond Journey's End", type: 'anime', year: 2023, status: 'watching', rating: 10, done: 18, total: 28, next: 'E19', last: 'E18', ago: '2 hours ago' },
  { q: 'The Boys', provider: 'tvmaze', title: 'The Boys', type: 'tv', year: 2019, status: 'watching', rating: 8, done: 29, total: 32, next: 'S4 E6', last: 'S4 E5', ago: 'yesterday' },
  { q: 'Solo Leveling', provider: 'kitsu', title: 'Solo Leveling', type: 'anime', year: 2024, status: 'watching', done: 8, total: 12, next: 'E9', last: 'E8', ago: '3 days ago' },
  { q: 'Stranger Things', provider: 'tvmaze', title: 'Stranger Things', type: 'tv', year: 2016, status: 'watching', rating: 9, done: 33, total: 34, next: 'S4 E9', last: 'S4 E8', ago: 'last week' },
  { q: 'Breaking Bad', provider: 'tvmaze', title: 'Breaking Bad', type: 'tv', year: 2008, status: 'completed', rating: 10 },
  { q: 'Spirited Away', provider: 'kitsu', title: 'Spirited Away', type: 'anime', year: 2001, status: 'completed', rating: 9 },
  { q: 'Arcane', provider: 'tvmaze', title: 'Arcane', type: 'tv', year: 2021, status: 'completed', rating: 9 },
  { q: 'Death Note', provider: 'kitsu', title: 'Death Note', type: 'anime', year: 2006, status: 'completed', rating: 8 },
  { q: 'Shōgun', provider: 'tvmaze', title: 'Shōgun', type: 'tv', year: 2024, status: 'plan' },
  { q: 'Chainsaw Man', provider: 'kitsu', title: 'Chainsaw Man', type: 'anime', year: 2022, status: 'plan' },
  { q: 'Severance', provider: 'tvmaze', title: 'Severance', type: 'tv', year: 2022, status: 'plan' },
  { q: 'The Last of Us', provider: 'tvmaze', title: 'The Last of Us', type: 'tv', year: 2023, status: 'on_hold', done: 4, total: 9, line: 'S1 E5 next' },
  { q: 'The Witcher', provider: 'tvmaze', title: 'The Witcher', type: 'tv', year: 2019, status: 'dropped', done: 11, total: 24, line: 'Stopped at S2 E3' },
]

const DISCOVER: Item[] = [
  { q: 'Andor', provider: 'tvmaze', title: 'Andor', type: 'tv', year: 2022, status: 'plan' },
  { q: 'Dandadan', provider: 'kitsu', title: 'Dandadan', type: 'anime', year: 2024, status: 'plan' },
  { q: 'The Bear', provider: 'tvmaze', title: 'The Bear', type: 'tv', year: 2022, status: 'plan' },
  { q: 'Blue Eye Samurai', provider: 'tvmaze', title: 'Blue Eye Samurai', type: 'tv', year: 2023, status: 'plan' },
  { q: 'Cowboy Bebop', provider: 'kitsu', title: 'Cowboy Bebop', type: 'anime', year: 1998, status: 'plan' },
  { q: 'Fallout', provider: 'tvmaze', title: 'Fallout', type: 'tv', year: 2024, status: 'plan' },
]

// ---------- Poster artwork ----------

type Urls = Record<string, string | null>
let shared: Promise<Urls> | null = null

/** Real poster URLs from Kitsu / TVmaze (the app's own search), fetched once per page load and shared by every frame. */
function loadPosters(): Promise<Urls> {
  shared ??= Promise.all(
    [...LIBRARY, ...DISCOVER].map((it) =>
      searchTitles(it.q, it.provider).then(
        // TVmaze's full-size poster is a 2000px original; its "medium" is plenty for a card.
        (r) => [it.q, (it.provider === 'tvmaze' ? r[0]?.thumbUrl : null) ?? r[0]?.posterUrl ?? null] as const,
        () => [it.q, null] as const,
      ),
    ),
  ).then(Object.fromEntries)
  return shared
}

function usePosters() {
  const [urls, setUrls] = useState<Urls>({})
  useEffect(() => {
    let alive = true
    void loadPosters().then((u) => alive && setUrls(u))
    return () => {
      alive = false
    }
  }, [])
  return urls
}

function Art({ it, urls, className = '' }: { it: Item; urls: Urls; className?: string }) {
  const url = urls[it.q]
  return <Poster poster={url ? { kind: 'remote', url } : null} title={it.title} mediaType={it.type} className={className} />
}

// ---------- Pieces ----------

const DOT: Record<WatchStatus, string> = { watching: 'bg-accent', on_hold: 'bg-warn', plan: 'bg-info', completed: 'bg-success', dropped: 'bg-danger' }

function PosterBadge({ status }: { status: WatchStatus }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
      <span className={`size-1.5 shrink-0 rounded-full ${DOT[status]}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

const lineOf = (it: Item) => it.line ?? (it.status === 'watching' ? `${it.next} next` : it.status === 'completed' ? 'Completed' : 'Not started')

/** The brand mark, recoloured from the theme: dim track, watched track in the primary, knob in the text colour. */
function Mark({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={`${className} shrink-0`} aria-hidden>
      <rect width="512" height="512" rx="116" fill="var(--surface-2)" />
      <g fill="none" strokeWidth={60} strokeLinecap="round" strokeLinejoin="round">
        <path d="M104 150 L188 362 L256 226 L324 362 L408 150" stroke="var(--accent-line)" />
        <path d="M104 150 L188 362 L256 226 L324 362 L372.7 239" stroke="var(--accent)" />
      </g>
      <circle cx="372.7" cy="239" r="38" fill="var(--text)" stroke="var(--surface-2)" strokeWidth={22} paintOrder="stroke" />
    </svg>
  )
}

function Brand({ size }: { size?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Mark className={size} />
      <span className="truncate text-[15px] font-semibold tracking-[-0.02em]">
        Watch<span className="text-accent-text">Track</span>
      </span>
    </span>
  )
}

function SideItem({ icon: Icon, label, count, active }: { icon: LucideIcon; label: string; count?: number; active?: boolean }) {
  return (
    <li>
      <span
        className={`relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
          active ? 'bg-accent-soft text-accent-text before:absolute before:inset-y-2.5 before:-left-3 before:w-1 before:rounded-r-full before:bg-accent' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'
        }`}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!!count && <span className="text-xs tabular-nums opacity-70">{count}</span>}
      </span>
    </li>
  )
}

function Sidebar() {
  return (
    <aside className="hidden flex-col border-r border-divider bg-bg-2 px-3 py-5 @5xl:flex">
      <div className="mb-6 flex items-center justify-between gap-2 px-3">
        <Brand size="size-8" />
        <span className="icon-btn relative">
          <Bell className="size-5" aria-hidden />
          <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-(--accent-2) ring-2 ring-bg-2" />
        </span>
      </div>
      <button type="button" className="btn-primary mb-6 w-full">
        <Plus className="size-4" aria-hidden /> Add title
      </button>
      <nav className="space-y-6">
        <ul className="space-y-0.5">
          <SideItem icon={House} label="Home" active />
          <SideItem icon={Play} label="Continue" count={4} />
          <SideItem icon={Library} label="Library" />
          <SideItem icon={Compass} label="Discover" />
          <SideItem icon={CalendarClock} label="Upcoming" />
        </ul>
        <div>
          <p className="eyebrow mb-1.5 px-3">Lists</p>
          <ul className="space-y-0.5">
            <SideItem icon={ListPlus} label="Plan to Watch" count={3} />
            <SideItem icon={CirclePause} label="On Hold" count={1} />
            <SideItem icon={CircleCheck} label="Completed" count={4} />
          </ul>
        </div>
      </nav>
      <div className="mt-auto space-y-3 pt-6">
        <ul>
          <SideItem icon={Settings} label="Settings" />
        </ul>
        <p className="px-3 text-[11px] leading-relaxed text-muted">Your data stays in this browser unless you turn on Google Drive sync.</p>
      </div>
    </aside>
  )
}

function MobileTop() {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-divider bg-bg/85 px-4 py-2 backdrop-blur-xl @5xl:hidden">
      <Brand />
      <div className="flex items-center">
        <span className="icon-btn">
          <CalendarClock className="size-5" aria-hidden />
        </span>
        <span className="icon-btn">
          <Bell className="size-5" aria-hidden />
        </span>
        <span className="icon-btn">
          <Share2 className="size-5" aria-hidden />
        </span>
      </div>
    </header>
  )
}

function MobileNav() {
  const item = (Icon: LucideIcon, label: string, active = false) => (
    <li key={label}>
      <span className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-accent-text' : 'text-fg-2'}`}>
        <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-accent-soft' : ''}`}>
          <Icon className="size-5" aria-hidden />
        </span>
        {label}
      </span>
    </li>
  )
  return (
    <nav className="border-t border-divider bg-bg-2/90 backdrop-blur-xl @5xl:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5 px-1">
        {item(House, 'Home', true)}
        {item(Play, 'Continue')}
        <li className="flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-[0_8px_24px_-10px_var(--accent-glow)]">
            <Plus className="size-6" aria-hidden />
          </span>
        </li>
        {item(Library, 'Library')}
        {item(Compass, 'Discover')}
      </ul>
    </nav>
  )
}

function ContinueCard({ it, urls }: { it: Item; urls: Urls }) {
  return (
    <article className="card flex min-w-0 gap-3 p-3 @lg:gap-4">
      <div className="w-20 shrink-0 @lg:w-24">
        <Art it={it} urls={urls} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate font-semibold">{it.title}</h3>
        <p className="display mt-0.5 text-2xl font-semibold leading-tight tracking-tight text-accent-text">{it.next} next</p>
        <p className="mt-0.5 text-xs text-muted">
          Last: {it.last} · watched {it.ago}
        </p>
        <div className="mt-2">
          <ProgressBar value={it.done! / it.total!} />
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <button type="button" className="btn-primary min-h-9 px-3">
            <Check className="size-4" aria-hidden /> Watched {it.next}
          </button>
          <button type="button" className="btn-ghost min-h-9 px-3">
            Continue <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </article>
  )
}

function TitleCard({ it, urls }: { it: Item; urls: Urls }) {
  return (
    <div className="group min-w-0">
      <div className="relative overflow-hidden rounded-xl shadow-card">
        <Art it={it} urls={urls} className="can-hover:group-hover:[&_img]:scale-[1.04]" />
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-transparent transition-colors can-hover:group-hover:ring-accent/50" />
        <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)]">
          <PosterBadge status={it.status} />
        </div>
        {it.done != null && (
          <div className="absolute inset-x-0 bottom-0">
            <ProgressBar value={it.done / it.total!} className="h-1 bg-black/50" />
          </div>
        )}
      </div>
      <div className="mt-2.5 space-y-0.5 px-0.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug transition-colors group-hover:text-accent-text">{it.title}</h3>
        <p className="truncate text-xs text-muted">{lineOf(it)}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span className="truncate">
            {MEDIA_LABEL[it.type]} · {it.year}
          </span>
          <Rating value={it.rating ?? null} />
        </p>
      </div>
    </div>
  )
}

function TitleRow({ it, urls }: { it: Item; urls: Urls }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2">
      <Art it={it} urls={urls} className="w-11 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{it.title}</p>
        <p className="truncate text-xs text-muted">
          {MEDIA_LABEL[it.type]} · {it.year} · {lineOf(it)}
        </p>
      </div>
      <Rating value={it.rating ?? null} />
      <StatusBadge status={it.status} />
    </div>
  )
}

/** Episodes logged per month; the busiest month takes the secondary accent. */
const MONTHS = [22, 31, 18, 40, 36, 52, 47, 29, 44, 61, 38, 26]

function YearCard() {
  const max = Math.max(...MONTHS)
  const split: [WatchStatus, number][] = [
    ['watching', 4],
    ['completed', 4],
    ['plan', 3],
    ['on_hold', 1],
    ['dropped', 1],
  ]
  const total = split.reduce((n, [, v]) => n + v, 0)
  let at = 0
  const ring = split.map(([s, v]) => `var(--${{ watching: 'accent', completed: 'success', plan: 'info', on_hold: 'warn', dropped: 'danger' }[s]}) ${(at / total) * 360}deg ${((at += v) / total) * 360}deg`).join(', ')
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">This year</p>
          <p className="display mt-1 text-3xl font-semibold tracking-tight tabular-nums">444</p>
          <p className="text-sm text-muted">episodes · 168 hours watched</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-(--accent-2-soft) px-2.5 py-1 text-xs font-medium text-(--accent-2)">
          <Sparkles className="size-3.5" aria-hidden /> Year in review
        </span>
      </div>
      <div className="mt-5 flex h-24 items-end gap-1.5" aria-hidden>
        {MONTHS.map((v, i) => (
          <div key={i} className={`flex-1 rounded-t-md ${v === max ? 'bg-(--accent-2)' : 'bg-fg/15'}`} style={{ height: `${(v / max) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-faint">
        <span>Jan</span>
        <span>Jun</span>
        <span>Dec</span>
      </div>
      <div className="mt-5 flex items-center gap-4 border-t border-divider pt-4">
        <div className="keep-round relative size-16 shrink-0 rounded-full" style={{ background: `conic-gradient(${ring})` }}>
          <div className="keep-round absolute inset-2.5 rounded-full bg-surface" />
        </div>
        <ul className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {split.map(([s, v]) => (
            <li key={s} className="flex min-w-0 items-center gap-1.5 text-fg-2">
              <span className={`size-2 shrink-0 rounded-full ${DOT[s]}`} />
              <span className="truncate">{STATUS_LABEL[s]}</span>
              <span className="ml-auto tabular-nums text-muted">{v}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function UpcomingCard({ urls }: { urls: Urls }) {
  const rows: [Item, string, string, boolean][] = [
    [LIBRARY[0], 'E19 · "A Real Hero"', 'Out now', true],
    [LIBRARY[1], 'S4 E7', 'Airs Thursday', false],
    [LIBRARY[2], 'E10', 'Airs Saturday · 17:30', false],
  ]
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Upcoming</h3>
        <span className="inline-flex items-center gap-0.5 text-sm font-medium text-accent-text">
          Calendar <ChevronRight className="size-4" aria-hidden />
        </span>
      </div>
      <ul className="mt-3 space-y-1">
        {rows.map(([it, ep, when, isNew]) => (
          <li key={it.q} className="flex items-center gap-3 rounded-xl py-1.5">
            <Art it={it} urls={urls} className="w-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{it.title}</p>
              <p className="truncate text-xs text-muted">{ep}</p>
            </div>
            {isNew ? (
              <span className="rounded-full bg-(--accent-2-soft) px-2 py-0.5 text-[11px] font-semibold text-(--accent-2)">New</span>
            ) : (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-info">
                <CalendarClock className="size-3.5" aria-hidden /> {when}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Chip({ children, on = false }: { children: ReactNode; on?: boolean }) {
  return (
    <button type="button" aria-pressed={on} className="chip">
      {children}
    </button>
  )
}

function Discover({ urls }: { urls: Urls }) {
  return (
    <Section title="Discover" action={<span className="text-sm font-medium text-accent-text">Browse all</span>}>
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input pl-9" placeholder="Search anime, TV shows and movies" defaultValue="" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Chip on>All</Chip>
          <Chip>Anime</Chip>
          <Chip>TV</Chip>
          <Chip>Movies</Chip>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-5 pb-28 @2xl:grid-cols-6">
        {DISCOVER.map((it, i) => (
          <div key={it.q} className="relative min-w-0">
            <div className="relative">
              <Art it={it} urls={urls} />
              {i === 0 && <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">#1 this week</span>}
            </div>
            <p className="mt-2 truncate text-sm font-medium">{it.title}</p>
            <p className="truncate text-[11px] text-muted">
              {MEDIA_LABEL[it.type]} · {it.year}
            </p>
            {i === 1 ? (
              <span className="mt-2 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-success/15 text-xs font-medium text-success">
                <Check className="size-3.5" aria-hidden /> In library
              </span>
            ) : (
              <button type="button" className={`btn-secondary mt-2 min-h-8 w-full px-2 text-xs ${i === 2 ? 'border-line-strong bg-surface-2' : ''}`}>
                <Plus className="size-3.5" aria-hidden /> Add <ChevronDown className="size-3.5 opacity-60" aria-hidden />
              </button>
            )}
            {/* One "Add to list" menu shown open, to preview popovers. */}
            {i === 2 && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-overlay p-1 text-sm shadow-pop">
                {(['watching', 'plan', 'completed'] as WatchStatus[]).map((s, j) => (
                  <span key={s} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${j === 1 ? 'bg-surface-2 text-fg' : 'text-fg-2'}`}>
                    <span className={`size-2 rounded-full ${DOT[s]}`} /> {STATUS_LABEL[s]}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

function Switch({ on }: { on: boolean }) {
  return (
    <span role="switch" aria-checked={on} className={`relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-surface-2 ring-1 ring-inset ring-line'}`}>
      <span className={`absolute top-1 size-4 rounded-full shadow-sm transition-[left] ${on ? 'left-5 bg-on-accent' : 'left-1 bg-faint'}`} />
    </span>
  )
}

/** The title editor as it looks open: backdrop over the page, dialog on the overlay surface. */
function ModalShowcase({ urls }: { urls: Urls }) {
  const it = LIBRARY[0]
  return (
    <Section title="Title details (modal)">
      <div className="relative overflow-hidden rounded-3xl border border-line">
        <div className="absolute inset-0 grid grid-cols-4 content-start gap-3 p-4 @2xl:grid-cols-8" aria-hidden>
          {[...LIBRARY.slice(4, 12), ...LIBRARY.slice(0, 8)].map((x, i) => (
            <Art key={i} it={x} urls={urls} />
          ))}
        </div>
        <div className="absolute inset-0 bg-(--backdrop)" />
        <div className="relative flex items-center justify-center px-3 py-10 @lg:px-6">
          <div className="w-full max-w-md rounded-2xl border border-line bg-overlay p-4 shadow-pop @lg:p-5">
            <div className="flex items-start gap-3">
              <Art it={it} urls={urls} className="w-14 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-snug">{it.title}</h3>
                <p className="mt-0.5 text-xs text-muted">Anime · 2023 · 28 episodes</p>
                <div className="mt-1.5 flex gap-1.5">
                  <StatusBadge status="watching" />
                  <span className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-2">Fantasy</span>
                </div>
              </div>
              <span className="icon-btn -mr-2 -mt-2">
                <X className="size-5" aria-hidden />
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <span className="label">Status</span>
                <select className="input" defaultValue="watching">
                  {(Object.keys(STATUS_LABEL) as WatchStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="label">Next episode</span>
                <div className="flex items-center gap-1 rounded-xl border border-line bg-bg-2 p-0.5">
                  <span className="icon-btn size-9">
                    <Minus className="size-4" aria-hidden />
                  </span>
                  <span className="flex-1 text-center text-sm font-semibold tabular-nums">19</span>
                  <span className="icon-btn size-9">
                    <Plus className="size-4" aria-hidden />
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <span className="label">Your rating</span>
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <Star key={i} className={`size-5 ${i < 9 ? 'fill-warn text-warn' : 'text-faint'}`} aria-hidden />
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
              <span className="text-sm">
                Remind me when new episodes air
                <span className="block text-xs text-muted">Notifications on this device</span>
              </span>
              <Switch on />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-divider pt-4">
              <button type="button" className="btn-danger min-h-9 px-3">
                <Trash2 className="size-4" aria-hidden /> Remove
              </button>
              <span className="flex-1" />
              <button type="button" className="btn-secondary min-h-9 px-3">
                Cancel
              </button>
              <button type="button" className="btn-primary min-h-9 px-3">
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ---------- The screen ----------

/** `data` carries the concept's card / pill / backdrop switches for studio.css; `style` its tokens and look variables. */
export function Preview({ style, data }: { style: CSSProperties; data?: Record<string, string> }) {
  const urls = usePosters()
  const watching = LIBRARY.filter((t) => t.status === 'watching')
  return (
    <div className="concept @container bg-bg text-fg antialiased" style={style} {...data}>
      <div className="@5xl:grid @5xl:grid-cols-[15rem_minmax(0,1fr)]">
        <Sidebar />
        <div className="min-w-0">
          <MobileTop />
          <main className="space-y-10 px-4 pb-10 pt-5 @2xl:px-6 @5xl:px-10 @5xl:pt-10">
            <header className="hero relative overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-card @2xl:p-8">
              <div aria-hidden className="hero-glow pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_100%_0%,var(--glow),transparent_70%)]" />
              {/* Backdrop concepts: the show you're watching, blurred and faded into the surface. */}
              <div aria-hidden className="hero-art pointer-events-none absolute inset-0">
                <div className="absolute -inset-8 opacity-45 blur-2xl saturate-125 [&_img]:size-full [&_img]:object-cover">
                  <Art it={watching[0]} urls={urls} className="h-full" />
                </div>
                <div className="absolute inset-0 bg-linear-to-r from-surface via-surface/85 to-surface/30" />
              </div>
              <div className="relative">
                <p className="eyebrow text-accent-text">WatchTrack</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight @2xl:text-4xl">Good evening</h1>
                <p className="mt-2 max-w-xl text-sm text-muted @2xl:text-base">4 titles in progress · 1,284 episodes logged</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary">
                    <Plus className="size-4" aria-hidden /> Add title
                  </button>
                  <button type="button" className="btn-secondary">
                    <Library className="size-4" aria-hidden /> Browse library
                  </button>
                  <button type="button" className="btn-ghost @max-lg:hidden">
                    <Share2 className="size-4" aria-hidden /> Share watchlist
                  </button>
                </div>
              </div>
            </header>

            <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
              <StatCard label="Watching" value={4} icon={Play} />
              <StatCard label="Completed" value={4} icon={CircleCheck} tone="bg-success/15 text-success" />
              <StatCard label="Plan to watch" value={3} icon={ListPlus} tone="bg-info/15 text-info" />
              <StatCard label="On hold" value={1} icon={CirclePause} tone="bg-warn/15 text-warn" />
            </div>

            <Section title="Continue watching" action={<span className="text-sm font-medium text-accent-text">See all 4</span>}>
              <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
                {watching.map((it) => (
                  <ContinueCard key={it.q} it={it} urls={urls} />
                ))}
              </div>
            </Section>

            <div className="grid gap-4 @4xl:grid-cols-[1fr_1fr]">
              <YearCard />
              <UpcomingCard urls={urls} />
            </div>

            <Section
              title="Library"
              action={
                <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-0.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-fg">
                    <LayoutGrid className="size-4" aria-hidden />
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-lg text-muted">
                    <List className="size-4" aria-hidden />
                  </span>
                </div>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <Chip on>All · 13</Chip>
                <Chip>Watching</Chip>
                <Chip>Plan to Watch</Chip>
                <Chip>Completed</Chip>
                <Chip>On Hold</Chip>
                <select className="input ml-auto w-auto min-w-0" defaultValue="updated" aria-label="Sort">
                  <option value="updated">Recently updated</option>
                  <option value="title">Title A–Z</option>
                  <option value="rating">Highest rated</option>
                </select>
              </div>
              <div className="poster-grid" style={{ '--card-min': '8.5rem' } as CSSProperties}>
                {LIBRARY.slice(0, 12).map((it) => (
                  <TitleCard key={it.q} it={it} urls={urls} />
                ))}
              </div>
              <div className="card divide-y divide-divider p-1.5">
                {[LIBRARY[1], LIBRARY[4], LIBRARY[8], LIBRARY[11], LIBRARY[12]].map((it) => (
                  <TitleRow key={it.q} it={it} urls={urls} />
                ))}
              </div>
            </Section>

            <Discover urls={urls} />
            <ModalShowcase urls={urls} />
          </main>
        </div>
      </div>
      <MobileNav />
    </div>
  )
}
