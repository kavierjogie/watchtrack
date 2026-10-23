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

const STATUS_TONE: Record<WatchStatus, string> = {
  watching: 'bg-accent-soft text-accent-text',
  on_hold: 'bg-warn/15 text-warn',
  plan: 'bg-surface-2 text-muted',
  completed: 'bg-success/15 text-success',
  dropped: 'bg-danger/15 text-danger',
}

export function StatusBadge({ status }: { status: WatchStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
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

export function ProgressBar({ value }: { value: number | null }) {
  if (value == null) return null
  return (
    <div className="h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, value * 100)}%` }} />
    </div>
  )
}

export function TitleCard({ t, showStatus = true }: { t: Title; showStatus?: boolean }) {
  return (
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      <Link to={`/title/${t.id}`} className="group block rounded-xl focus-visible:outline-offset-4">
        <div className="relative">
          <Poster poster={t.poster} title={t.title} mediaType={t.mediaType} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg" />
          {t.progress && <div className="absolute inset-x-2 bottom-2"><ProgressBar value={progressFraction(t.progress)} /></div>}
        </div>
        <div className="mt-2 space-y-1 px-0.5">
          <h3 className="line-clamp-1 text-sm font-medium group-hover:text-accent-text">{t.title}</h3>
          <p className="line-clamp-1 text-xs text-muted">{progressLine(t)}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            {showStatus && <StatusBadge status={t.status} />}
            <span>{MEDIA_LABEL[t.mediaType]}</span>
            {t.year && <span>{t.year}</span>}
            <Rating value={t.rating} />
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

export function TitleRow({ t }: { t: Title }) {
  return (
    <Link to={`/title/${t.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2">
      <Poster poster={t.poster} title={t.title} mediaType={t.mediaType} className="w-10 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{t.title}</p>
        <p className="truncate text-xs text-muted">
          {MEDIA_LABEL[t.mediaType]}
          {t.year ? ` · ${t.year}` : ''}
          {t.genres.length ? ` · ${t.genres.slice(0, 2).join(', ')}` : ''}
        </p>
      </div>
      <p className="hidden w-48 truncate text-right text-xs text-muted sm:block">{progressLine(t)}</p>
      <Rating value={t.rating} />
      <StatusBadge status={t.status} />
    </Link>
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
        <Poster poster={t.poster} title={t.title} mediaType={t.mediaType} />
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

export function StatCard({ label, value, icon: Icon, to }: { label: string; value: number; icon: LucideIcon; to?: string }) {
  const body = (
    <>
      <Icon className="size-4 text-accent-text" aria-hidden />
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </>
  )
  return to ? (
    <Link to={to} className="card block p-4 transition-colors hover:border-accent/50">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  )
}

export function EmptyState({ icon: Icon = CirclePause, title, body, action }: { icon?: LucideIcon; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
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
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PosterGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6" aria-busy aria-label="Loading">
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
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
