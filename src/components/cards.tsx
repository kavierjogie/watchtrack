import { motion } from 'framer-motion'
import { Check, ChevronRight, CirclePause, Play, Star, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { daysSince, timeAgo } from '../lib/format'
import { describePosition, formatEp, lastWatched, position, progressFraction } from '../lib/progress'
import { lastActivity } from '../lib/titles'
import { MEDIA_LABEL, STATUS_LABEL, type Title, type WatchStatus } from '../lib/types'
import { useWatchActions } from '../state/useWatchActions'
import { Poster } from './Poster'
import { TitleMenu } from './TitleMenu'

const STATUS_TONE: Record<WatchStatus, string> = {
  watching: 'bg-accent-soft text-accent-text',
  on_hold: 'bg-warn/15 text-warn',
  plan: 'bg-info/15 text-info',
  completed: 'bg-success/15 text-success',
  dropped: 'bg-danger/15 text-danger',
}

const STATUS_DOT: Record<WatchStatus, string> = {
  watching: 'bg-accent',
  on_hold: 'bg-warn',
  plan: 'bg-info',
  completed: 'bg-success',
  dropped: 'bg-danger',
}

/** Status pill for use on top of artwork: dark scrim so it reads on any poster. */
function PosterBadge({ status }: { status: WatchStatus }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
      <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function StatusBadge({ status }: { status: WatchStatus }) {
  return <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
}

export function Rating({ value }: { value: number | null }) {
  if (value == null) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted" aria-label={`Rated ${value} out of 10`}>
      <Star className="size-3 fill-warn text-warn" aria-hidden />
      {value}
    </span>
  )
}

/** Short progress line for any title. */
export function progressLine(t: Title): string {
  if (!t.progress) return t.status === 'completed' ? 'Watched' : 'Not watched'
  if (t.status === 'completed') return t.progress.season ? `Completed · ${t.progress.season} season${t.progress.season > 1 ? 's' : ''}` : 'Completed'
  if (t.status === 'plan' && position(t.progress).state === 'next' && t.progress.nextEpisode === 1) return 'Not started'
  return describePosition(t.progress)
}

export function ProgressBar({ value, className = 'h-1 rounded-full bg-surface-2' }: { value: number | null; className?: string }) {
  if (value == null) return null
  return (
    <div className={`overflow-hidden ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-[inherit] bg-linear-to-r from-accent-strong to-accent" style={{ width: `${Math.max(3, value * 100)}%` }} />
    </div>
  )
}

export function TitleCard({ t, showStatus = true }: { t: Title; showStatus?: boolean }) {
  const { markWatched } = useWatchActions()
  const p = t.progress
  const pos = p ? position(p) : null
  return (
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="group min-w-0">
      <div className="relative">
        {/* Duplicate target for the pointer only; keyboard and screen readers use the title link below. */}
        <Link to={`/title/${t.id}`} tabIndex={-1} aria-hidden className="relative block overflow-hidden rounded-xl shadow-card">
          <Poster poster={t.poster} source={t.source} title={t.title} mediaType={t.mediaType} className="can-hover:group-hover:[&_img]:scale-[1.04]" />
          <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-transparent transition-colors can-hover:group-hover:ring-accent/50 group-has-focus-visible:ring-accent" />
          {showStatus && (
            <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)]">
              <PosterBadge status={t.status} />
            </div>
          )}
          {p && (
            <div className="absolute inset-x-0 bottom-0">
              <ProgressBar value={progressFraction(p)} className="h-1 bg-black/50" />
            </div>
          )}
        </Link>
        {/* Quick "watched next episode": always shown on touch, revealed on hover/focus with a mouse. */}
        {p && pos?.state === 'next' && t.status === 'watching' && (
          <button
            type="button"
            onClick={() => void markWatched(t)}
            aria-label={`Mark ${formatEp(pos.next, p.numbering)} of ${t.title} watched`}
            title={`Mark ${formatEp(pos.next, p.numbering)} watched`}
            className="press absolute bottom-3 right-2 flex size-9 items-center justify-center rounded-full bg-accent text-on-accent shadow-pop transition-[opacity,background-color] hover:bg-accent-hover can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:focus-visible:opacity-100"
          >
            <Check className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <Link to={`/title/${t.id}`} className="mt-2.5 block space-y-0.5 rounded-md px-0.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug transition-colors group-hover:text-accent-text">{t.title}</h3>
        <p className="truncate text-xs text-muted">{progressLine(t)}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span className="truncate">
            {MEDIA_LABEL[t.mediaType]}
            {t.year ? ` · ${t.year}` : ''}
          </span>
          <Rating value={t.rating} />
        </p>
      </Link>
    </motion.div>
  )
}

export function TitleRow({ t }: { t: Title }) {
  return (
    <div className="flex items-center gap-1 rounded-xl pr-1 transition-colors hover:bg-surface-2">
      <Link to={`/title/${t.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2">
        <Poster poster={t.poster} source={t.source} title={t.title} mediaType={t.mediaType} className="w-11 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{t.title}</p>
          <p className="truncate text-xs text-muted">
            {MEDIA_LABEL[t.mediaType]}
            {t.year ? ` · ${t.year}` : ''}
            <span className="md:hidden"> · {progressLine(t)}</span>
            <span className="max-md:hidden">{t.genres.length ? ` · ${t.genres.slice(0, 2).join(', ')}` : ''}</span>
          </p>
        </div>
        <p className="hidden w-44 truncate text-right text-xs text-muted md:block">{progressLine(t)}</p>
        <Rating value={t.rating} />
        <span className="max-[400px]:hidden">
          <StatusBadge status={t.status} />
        </span>
      </Link>
      <TitleMenu t={t} />
    </div>
  )
}

/** The key card: what to watch next, with one-tap "watched". */
export function ContinueCard({ t, extra }: { t: Title; extra?: ReactNode }) {
  const { markWatched, nextSeason, setStatus } = useWatchActions()
  const p = t.progress!
  const pos = position(p)
  const last = lastWatched(p)
  const idle = daysSince(lastActivity(t))

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card flex min-w-0 gap-3 p-3 sm:gap-4"
    >
      <Link to={`/title/${t.id}`} className="w-20 shrink-0 sm:w-24" tabIndex={-1} aria-hidden>
        <Poster poster={t.poster} source={t.source} title={t.title} mediaType={t.mediaType} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/title/${t.id}`} className="min-w-0 hover:text-accent-text">
            <h3 className="truncate font-semibold">{t.title}</h3>
          </Link>
          {t.status === 'on_hold' && <StatusBadge status="on_hold" />}
        </div>
        <p className="mt-0.5 text-lg font-semibold tracking-tight text-accent-text">
          {pos.state === 'next' ? `${formatEp(pos.next, p.numbering)} next` : describePosition(p)}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {last ? `Last: ${formatEp(last, p.numbering)} · ` : ''}
          {t.lastWatchedAt ? `watched ${timeAgo(t.lastWatchedAt)}` : `updated ${timeAgo(t.updatedAt)}`}
          {idle > 60 && idle !== Infinity && <span className="text-warn"> · {idle} days idle</span>}
        </p>
        <div className="mt-2">
          <ProgressBar value={progressFraction(p)} />
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {pos.state === 'next' && (
            <button type="button" className="btn-primary min-h-9 px-3" onClick={() => void markWatched(t)}>
              <Check className="size-4" aria-hidden />
              Watched {pos.next.season != null && p.numbering === 'seasonal' ? `S${pos.next.season}E${pos.next.episode}` : `E${pos.next.episode}`}
            </button>
          )}
          {pos.state === 'unknown' && (
            <Link to={`/title/${t.id}?edit=progress`} className="btn-primary min-h-9 px-3">
              Set episode
            </Link>
          )}
          {pos.state === 'season-finished' && (
            <>
              <button type="button" className="btn-primary min-h-9 px-3" onClick={() => void nextSeason(t)}>
                Start season {(p.season ?? 0) + 1}
              </button>
              <button type="button" className="btn-secondary min-h-9 px-3" onClick={() => void setStatus(t, 'completed')}>
                Mark completed
              </button>
            </>
          )}
          {pos.state === 'series-finished' && (
            <button type="button" className="btn-primary min-h-9 px-3" onClick={() => void setStatus(t, 'completed')}>
              Mark completed
            </button>
          )}
          {t.status === 'on_hold' ? (
            <button type="button" className="btn-secondary min-h-9 px-3" onClick={() => void setStatus(t, 'watching')}>
              <Play className="size-4" aria-hidden /> Resume
            </button>
          ) : (
            <Link to={`/title/${t.id}`} className="btn-ghost min-h-9 px-3">
              Continue <ChevronRight className="size-4" aria-hidden />
            </Link>
          )}
          {extra}
        </div>
      </div>
    </motion.article>
  )
}

export function StatCard({ label, value, icon: Icon, to, tone = 'bg-accent-soft text-accent-text' }: { label: string; value: number; icon: LucideIcon; to?: string; tone?: string }) {
  const body = (
    <>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold leading-tight tabular-nums">{value.toLocaleString()}</span>
        <span className="block truncate text-xs text-muted">{label}</span>
      </span>
    </>
  )
  return to ? (
    <Link to={to} className="card-link flex min-w-0 items-center gap-3 p-3">
      {body}
    </Link>
  ) : (
    <div className="card flex min-w-0 items-center gap-3 p-3">{body}</div>
  )
}

export function EmptyState({ icon: Icon = CirclePause, title, body, action }: { icon?: LucideIcon; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center bg-[radial-gradient(80%_60%_at_50%_0%,var(--glow),transparent_70%)] px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text ring-1 ring-accent-line">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <div className="mt-1 max-w-sm text-sm text-muted">{body}</div>
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** "See all >" link for section headers. */
export function SeeAll({ to, label = 'See all' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="inline-flex shrink-0 items-center gap-0.5 rounded-lg text-sm font-medium text-accent-text hover:underline">
      {label} <ChevronRight className="size-4" aria-hidden />
    </Link>
  )
}

export function PosterGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="poster-grid" aria-busy aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <div className="skeleton aspect-[2/3] rounded-xl" />
          <div className="skeleton h-3 w-3/4 rounded" />
        </div>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
