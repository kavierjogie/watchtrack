import { ArrowLeft, Bell, Layers, Loader2, BellOff, CalendarClock, Check, Clapperboard, Compass, ExternalLink, History, Pencil, Plus, RefreshCw, Share2, Sparkles, Star, Trash2, Undo2 } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, ProgressBar, StatusBadge } from '../components/cards'
import { Modal } from '../components/Modal'
import { Poster, usePosterUrl } from '../components/Poster'
import { ProgressEditor } from '../components/ProgressEditor'
import { TitleForm } from '../components/TitleForm'
import { SimilarTitles } from './Discover'
import { alertsOn } from '../lib/alerts'
import { normTitle } from '../lib/backup'
import { usePrefs } from '../lib/prefs'
import { listHistory } from '../lib/db'
import { formatDate, isPast, timeAgo, today } from '../lib/format'
import { findWholeShow, PROVIDER_LABEL, showName } from '../lib/metadata'
import { currentEpisodeCount, describePosition, formatEp, formatSkipRanges, lastWatched, position, progressFraction } from '../lib/progress'
import { canRefresh, useSyncState } from '../lib/sync'
import { MEDIA_LABEL, STATUS_LABEL, type HistoryEntry, type Numbering, type Sequel, type SyncInfo, type Title, type WatchStatus } from '../lib/types'
import { relinkTitle } from '../lib/titles'
import { useLibrary } from '../state/library'
import { useRefreshEpisodes } from '../state/useSync'
import { useWatchActions } from '../state/useWatchActions'

const STATUSES: WatchStatus[] = ['watching', 'on_hold', 'plan', 'completed', 'dropped']

export function TitleDetails() {
  const { id = '' } = useParams()
  const lib = useLibrary()
  const t = lib.byId(id)

  if (lib.loading) return <div className="skeleton h-72 rounded-2xl" aria-busy />
  if (!t)
    return (
      <EmptyState
        title="Title not found"
        body="It may have been deleted, or it was added in another browser (data isn't shared between devices)."
        action={
          <Link to="/library" className="btn-primary">
            Back to library
          </Link>
        }
      />
    )
  return <Details key={t.id} t={t} />
}

function Details({ t }: { t: Title }) {
  const lib = useLibrary()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const actions = useWatchActions()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  /** A string opens the edit dialog with its source search prefilled. */
  const [editDetails, setEditDetails] = useState<boolean | string>(false)
  const [special, setSpecial] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const notes = draft ?? t.notes
  const editProgress = params.get('edit') === 'progress' && !!t.progress
  const posterUrl = usePosterUrl(t.poster)
  const { refreshOne } = useRefreshEpisodes()
  const refreshing = useSyncState().ids.has(t.id)

  useEffect(() => {
    let alive = true
    void listHistory(t.id).then((h) => alive && setHistory(h))
    return () => {
      alive = false
    }
  }, [t.id, lib.historyVersion])

  const closeEditor = () =>
    setParams((p) => {
      p.delete('edit')
      return p
    })

  const saveNotes = async () => {
    setDraft(null)
    if (notes === t.notes) return
    try {
      await lib.save({ ...t, notes, updatedAt: new Date().toISOString() })
      toast.success('Notes saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save notes.')
    }
  }

  const setRating = async (rating: number | null) => {
    await lib.save({ ...t, rating, updatedAt: new Date().toISOString() })
  }

  const p = t.progress
  const pos = p ? position(p) : null
  const last = p ? lastWatched(p) : null
  const backdrop = t.backdropUrl ?? posterUrl

  return (
    <article className="space-y-8">
      <div className="-mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => (history.length || window.history.length > 1 ? navigate(-1) : navigate('/library'))} className="btn-ghost -ml-3 px-3">
          <ArrowLeft className="size-4" aria-hidden /> Back
        </button>
        {/* Secondary actions: always in reach, never competing with progress. */}
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost px-3" onClick={() => setEditDetails(true)}>
            <Pencil className="size-4" aria-hidden /> <span className="max-[400px]:sr-only">Edit</span>
          </button>
          <Link to={`?share=${t.id}`} className="icon-btn" aria-label="Share this title" title="Share">
            <Share2 className="size-4" aria-hidden />
          </Link>
          <button
            type="button"
            className="icon-btn hover:bg-danger/10 hover:text-danger"
            aria-label="Delete title"
            title="Delete"
            onClick={() => void actions.remove(t).then((ok) => ok && navigate('/library'))}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
        {backdrop && (
          <div aria-hidden className="absolute inset-0">
            <img src={backdrop} alt="" className={`size-full object-cover ${t.backdropUrl ? 'opacity-35' : 'scale-110 opacity-30 blur-2xl'}`} />
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/85 to-surface/30 sm:bg-gradient-to-r" />
          </div>
        )}
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:p-8">
          <Poster poster={t.poster} source={t.source} title={t.title} mediaType={t.mediaType} className="w-32 shrink-0 shadow-pop sm:w-48" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusBadge status={t.status} />
              <span>{MEDIA_LABEL[t.mediaType]}</span>
              {t.year && <span>· {t.year}</span>}
              {p?.rewatching && <span className="rounded-full bg-surface-2 px-2 py-0.5">Rewatching</span>}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere sm:text-4xl">{t.title}</h1>
            {t.altTitles.length > 0 && <p className="text-sm text-muted">{t.altTitles.join(' · ')}</p>}
            {t.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.genres.map((g) => (
                  <span key={g} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {p && pos && (
              <div className="max-w-md space-y-2 rounded-2xl border border-line bg-surface-2/80 p-4">
                <p className="eyebrow">{pos.state === 'next' ? 'Up next' : 'Progress'}</p>
                <p className="text-xl font-semibold text-accent-text">{describePosition(p)}</p>
                <p className="text-xs text-muted">
                  Last watched: {last ? formatEp(last, p.numbering) : '—'}
                  {t.lastWatchedAt && ` · ${timeAgo(t.lastWatchedAt)}`}
                </p>
                <ProgressBar value={progressFraction(p)} />
                {t.sync?.nextAiring && <NextAiring next={t.sync.nextAiring} numbering={p.numbering} />}
              </div>
            )}
            {!p && (
              <div className="max-w-md rounded-2xl border border-line bg-surface-2/80 p-4 text-sm">
                {t.status === 'completed' ? (
                  <p>
                    Watched{t.watchedDate ? ` on ${formatDate(t.watchedDate)}` : ''}
                  </p>
                ) : (
                  <p className="text-muted">Not watched yet</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {p && pos?.state === 'next' && (
                <button type="button" className="btn-primary" onClick={() => void actions.markWatched(t)}>
                  <Check className="size-4" aria-hidden /> Mark {formatEp(pos.next, p.numbering)} watched
                </button>
              )}
              {p && pos?.state === 'season-finished' && (
                <>
                  <button type="button" className="btn-primary" onClick={() => void actions.nextSeason(t)}>
                    Start season {(p.season ?? 0) + 1}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void actions.setStatus(t, 'completed')}>
                    Mark series completed
                  </button>
                </>
              )}
              {p && pos?.state === 'series-finished' && t.status !== 'completed' && (
                <button type="button" className="btn-primary" onClick={() => void actions.setStatus(t, 'completed')}>
                  Mark completed
                </button>
              )}
              {!p && t.status !== 'completed' && (
                <button type="button" className="btn-primary" onClick={() => void actions.movieWatched(t, today())}>
                  <Check className="size-4" aria-hidden /> Mark watched
                </button>
              )}
              {p && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setParams((q) => {
                      q.set('edit', 'progress')
                      return q
                    })
                  }
                >
                  <Pencil className="size-4" aria-hidden /> {pos?.state === 'unknown' ? 'Set episode' : 'Change progress'}
                </button>
              )}
              {p && (
                <button type="button" className="btn-ghost" onClick={() => setSpecial(true)}>
                  <Sparkles className="size-4" aria-hidden /> Log special
                </button>
              )}
              <Link to={`/discover?like=${t.id}`} className="btn-ghost">
                <Compass className="size-4" aria-hidden /> More like this
              </Link>
              {history[0]?.before && (
                <button type="button" className="btn-ghost" onClick={() => void actions.undo(t.id)}>
                  <Undo2 className="size-4" aria-hidden /> Undo last
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {t.synopsis && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Synopsis</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{t.synopsis}</p>
            </section>
          )}

          <section>
            <label htmlFor="notes" className="mb-2 block text-sm font-semibold">
              Personal notes
            </label>
            <textarea
              id="notes"
              className="input min-h-28 py-2"
              value={notes}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void saveNotes()}
              placeholder="Where you left off, thoughts, who recommended it…"
            />
            {t.importNote && <p className="mt-1 text-xs text-muted">Original note: “{t.importNote}”</p>}
          </section>

          {p && p.numbering === 'seasonal' && Object.keys(p.seasonEpisodeCounts).length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Seasons</h2>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(p.seasonEpisodeCounts).map(([s, count]) => {
                  const n = Number(s)
                  const done = p.season != null && (n < p.season || (n === p.season && pos?.state !== 'next' && pos?.state !== 'unknown'))
                  const current = n === p.season
                  const watched = done ? count : current && p.nextEpisode ? Math.min(count, p.nextEpisode - 1) : 0
                  const airing = t.sync?.nextAiring?.season === n
                  return (
                    <li key={s} className={`card p-3 ${current ? 'border-accent/60' : ''}`}>
                      <p className="text-sm font-medium">
                        Season {s}
                        {airing && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-muted">Airing</span>}
                      </p>
                      <p className="mb-2 text-xs text-muted">
                        {watched} / {count} episodes
                      </p>
                      <ProgressBar value={watched / count} />
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <History className="size-4" aria-hidden /> Watch history
            </h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted">No history yet. Marking episodes watched adds timestamped entries here.</p>
            ) : (
              <ol className="card divide-y divide-line">
                {history.slice(0, 50).map((h, i) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {h.kind === 'episode' || h.kind === 'movie' ? (
                        <Check className="size-4 shrink-0 text-success" aria-hidden />
                      ) : h.kind === 'special' ? (
                        <Sparkles className="size-4 shrink-0 text-accent-text" aria-hidden />
                      ) : (
                        <Pencil className="size-4 shrink-0 text-muted" aria-hidden />
                      )}
                      <span className="truncate">
                        {h.kind === 'status' ? `Status → ${STATUS_LABEL[h.label as WatchStatus] ?? h.label}` : h.label}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                      <time dateTime={h.at} title={new Date(h.at).toLocaleString()}>
                        {timeAgo(h.at)}
                      </time>
                      {i === 0 && h.before && (
                        <button type="button" className="icon-btn size-8" aria-label="Undo this change" onClick={() => void actions.undo(t.id)}>
                          <Undo2 className="size-4" />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="card space-y-4 p-4">
            <label className="block">
              <span className="label">Status</span>
              <select className="input" value={t.status} onChange={(e) => void actions.setStatus(t, e.target.value as WatchStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="label">Your rating</span>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Rating">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={t.rating === n}
                    aria-label={`${n} out of 10`}
                    onClick={() => void setRating(t.rating === n ? null : n)}
                    className={`flex size-9 items-center justify-center rounded-lg text-xs sm:size-8 font-medium transition-colors ${
                      t.rating != null && n <= t.rating ? 'bg-warn/20 text-warn' : 'bg-surface-2 text-muted hover:text-fg'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {t.rating != null && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                  <Star className="size-3 fill-warn text-warn" aria-hidden /> {t.rating}/10 · tap again to clear
                </p>
              )}
            </div>
            {!p && (
              <label className="block">
                <span className="label">Watched on</span>
                <input
                  type="date"
                  className="input"
                  max={today()}
                  value={t.watchedDate ?? ''}
                  onChange={(e) => void lib.save({ ...t, watchedDate: e.target.value || null, updatedAt: new Date().toISOString() })}
                />
              </label>
            )}
          </div>

          <dl className="card grid grid-cols-2 gap-x-3 gap-y-3 p-4 text-sm">
            {p && (
              <>
                <Fact label="Numbering" value={p.numbering === 'seasonal' ? 'Season + episode' : 'Overall episode #'} />
                {p.numbering === 'seasonal' ? (
                  <Fact label="Total seasons" value={p.totalSeasons ?? 'Unknown'} />
                ) : (
                  <Fact label="Total episodes" value={p.totalEpisodes ?? 'Unknown'} />
                )}
                {p.numbering === 'seasonal' && <Fact label="Eps this season" value={currentEpisodeCount(p) ?? 'Unknown'} />}
                {p.numbering === 'absolute' && p.totalEpisodes == null && t.sync?.aired != null && <Fact label="Aired so far" value={t.sync.aired} />}
                {p.skipped.length > 0 && <Fact label="Skipped" value={formatSkipRanges(p.skipped, p.season) || `${p.skipped.length} range(s)`} />}
              </>
            )}
            <Fact label="Added" value={formatDate(t.createdAt)} />
            <Fact label="Updated" value={formatDate(t.updatedAt)} />
            {t.completedAt && <Fact label="Completed" value={formatDate(t.completedAt)} />}
            {t.lastWatchedAt && <Fact label="Last watched" value={formatDate(t.lastWatchedAt)} />}
            {t.tags.length > 0 && <Fact label="Tags" value={t.tags.join(', ')} />}
          </dl>

          <div className="flex flex-col gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEditDetails(true)}>
              <Pencil className="size-4" aria-hidden /> Edit details
            </button>
            <button type="button" className="btn-ghost text-danger hover:bg-danger/10 hover:text-danger" onClick={() => void actions.remove(t).then((ok) => ok && navigate('/library'))}>
              <Trash2 className="size-4" aria-hidden /> Delete title
            </button>
          </div>

          {t.source && (
            <p className="text-xs text-muted">
              Details & artwork from{' '}
              <a href={t.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-text underline">
                {PROVIDER_LABEL[t.source.provider]} <ExternalLink className="size-3" aria-hidden />
              </a>
              {t.source.provider === 'tvmaze' && ' (CC BY-SA)'}
            </p>
          )}
          {t.sync?.sequel && <SequelCard t={t} sequel={t.sync.sequel} onPickSource={() => setEditDetails(showName(t.title))} />}
          {canRefresh(t) && <AlertToggle t={t} />}
          {canRefresh(t) && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span aria-live="polite">{refreshing ? 'Checking for new episodes…' : `Episodes checked ${timeAgo(t.sync?.checkedAt ?? null)}`}</span>
              <button type="button" className="btn-ghost h-8 px-2 text-xs" disabled={refreshing} onClick={() => void refreshOne(t)}>
                <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden /> Refresh episodes
              </button>
            </div>
          )}
        </aside>
      </div>

      <SimilarTitles t={t} />

      <AnimatePresence>{editProgress && <ProgressEditor title={t} open onClose={closeEditor} />}</AnimatePresence>
      <AnimatePresence>{editDetails && <TitleForm open existing={t} initialQuery={typeof editDetails === 'string' ? editDetails : undefined} onClose={() => setEditDetails(false)} />}</AnimatePresence>
      <AnimatePresence>{special && <SpecialDialog onClose={() => setSpecial(false)} onSave={(label) => void actions.logSpecial(t, label).then(() => setSpecial(false))} />}</AnimatePresence>
    </article>
  )
}

/** Per-show release alerts, plus what this title's provider can actually tell us. */
function AlertToggle({ t }: { t: Title }) {
  const lib = useLibrary()
  const { alertsOn: global } = usePrefs()
  const on = alertsOn(t)
  const p = t.source?.provider
  const limit =
    p === 'kitsu' && t.sync?.anilistId === null
      ? "Kitsu only gives this anime's next release date, so new-season alerts aren't available for it."
      : p === 'kitsu' || p === 'anilist'
        ? 'Anime seasons are separate entries: you’ll hear when the next one is announced, dated or out.'
        : null
  return (
    <div className="card space-y-2 p-4 text-sm">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-accent"
          checked={on}
          onChange={(e) => void lib.patch(t.id, (cur) => ({ ...cur, alerts: e.target.checked })).catch(() => toast.error("Couldn't save that change."))}
        />
        <span>
          <span className="flex items-center gap-1.5 font-medium">
            {on ? <Bell className="size-4 text-accent-text" aria-hidden /> : <BellOff className="size-4 text-muted" aria-hidden />} Notify me about new seasons
          </span>
          <span className="block text-xs text-muted">Also new episodes and release dates.{t.status === 'dropped' && t.alerts === undefined ? ' Off because this show is dropped.' : ''}</span>
        </span>
      </label>
      {on && !global && (
        <p className="text-xs text-warn">
          Release alerts are off in{' '}
          <Link to="/settings#alerts" className="underline">
            Settings
          </Link>
          .
        </p>
      )}
      {limit && <p className="text-xs text-muted">{limit}</p>}
    </div>
  )
}

const SEQUEL_STATUS: Record<string, string> ={ RELEASING: 'Airing now', FINISHED: 'Out now', HIATUS: 'On hiatus' }

/** The next season as its own entry (anime sites list seasons separately), offered to add rather than merged in. */
function SequelCard({ t, sequel, onPickSource }: { t: Title; sequel: Sequel; onPickSource: () => void }) {
  const lib = useLibrary()
  const { refreshOne } = useRefreshEpisodes()
  const [linking, setLinking] = useState(false)
  const key = normTitle(sequel.title)
  const owned = lib.titles.find(
    (x) => x.sync?.anilistId === sequel.anilistId || (x.source?.provider === 'anilist' && x.source.id === String(sequel.anilistId)) || [x.title, ...x.altTitles].some((n) => normTitle(n) === key),
  )
  const announced = sequel.status === 'NOT_YET_RELEASED'
  const status = announced ? `Announced${sequel.startDate ? ` · starts ${sequel.startDate.length === 10 ? formatDate(sequel.startDate) : sequel.startDate}` : ''}` : (SEQUEL_STATUS[sequel.status] ?? sequel.status)

  // Watching later seasons in this one title: link the whole show so new episodes of every season are found.
  async function trackAllSeasons() {
    setLinking(true)
    try {
      const show = await findWholeShow(t)
      if (!show) {
        toast.info("Couldn't match the whole show automatically", { description: 'Pick it from the search instead.' })
        return onPickSource()
      }
      const saved = await lib.patch(t.id, (cur) => relinkTitle(cur, show))
      if (!saved) return
      toast.success(`Now tracking every season of ${saved.title}`, { description: `Linked to ${PROVIDER_LABEL[show.source.provider]}.` })
      void refreshOne(saved)
    } catch (err) {
      toast.error("Couldn't link the whole show", { description: err instanceof Error ? err.message : undefined })
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="card space-y-2 p-4 text-sm">
      <p className="eyebrow">Next season</p>
      <p className="font-medium wrap-anywhere">{sequel.title}</p>
      <p className="text-xs text-muted">
        {status} ·{' '}
        <a href={sequel.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-text underline">
          AniList <ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
      {owned ? (
        <Link to={`/title/${owned.id}`} className="btn-secondary w-full">
          <Check className="size-4" aria-hidden /> In your library
        </Link>
      ) : (
        <Link to={`?add=${announced ? 'plan' : '1'}&q=${encodeURIComponent(sequel.title)}`} className="btn-secondary w-full">
          <Plus className="size-4" aria-hidden /> {announced ? 'Add to Plan to Watch' : 'Add to library'}
        </Link>
      )}
      {!owned && t.progress && (
        <>
          <button type="button" className="btn-ghost w-full" disabled={linking} onClick={() => void trackAllSeasons()}>
            {linking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Layers className="size-4" aria-hidden />} Track all seasons in this title
          </button>
          <p className="text-xs text-muted">Already past this season? Links the whole show so new episodes keep coming.</p>
        </>
      )}
    </div>
  )
}

/** Confirmed next release from the provider. It hasn't aired, so it never counts toward progress. */
function NextAiring({ next, numbering }: { next: NonNullable<SyncInfo['nextAiring']>; numbering: Numbering }) {
  if (isPast(next.airdate)) return null // aired since the last refresh; the next one will count it
  const ep = next.episode != null ? formatEp({ season: next.season, episode: next.episode }, numbering) : 'Next episode'
  return (
    <p className="flex items-center gap-1.5 pt-1 text-xs text-muted">
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      <span>
        Upcoming: {ep} airs <time dateTime={next.airdate} title={new Date(next.airdate).toLocaleString()}>{timeAgo(next.airdate)}</time>
      </span>
    </p>
  )
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  )
}

function SpecialDialog({ onClose, onSave }: { onClose: () => void; onSave: (label: string) => void }) {
  const [label, setLabel] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title="Log a special / OVA / movie"
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="special-form" className="btn-primary" disabled={!label.trim()}>
            <Clapperboard className="size-4" aria-hidden /> Log it
          </button>
        </>
      }
    >
      <form
        id="special-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (label.trim()) onSave(label.trim())
        }}
      >
        <label className="block">
          <span className="label">What did you watch?</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Episode 12.5, OVA 2, Mugen Train" autoFocus />
        </label>
        <p className="mt-2 text-xs text-muted">Specials are added to your history without moving your next-episode position.</p>
      </form>
    </Modal>
  )
}
