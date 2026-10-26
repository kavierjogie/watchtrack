import { ArrowLeft, Check, Clapperboard, ExternalLink, History, Pencil, Sparkles, Star, Trash2, Undo2 } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, ProgressBar, StatusBadge } from '../components/cards'
import { Modal } from '../components/Modal'
import { Poster, usePosterUrl } from '../components/Poster'
import { ProgressEditor } from '../components/ProgressEditor'
import { TitleForm } from '../components/TitleForm'
import { listHistory } from '../lib/db'
import { formatDate, timeAgo, today } from '../lib/format'
import { PROVIDER_LABEL } from '../lib/metadata'
import { currentEpisodeCount, describePosition, formatEp, formatSkipRanges, lastWatched, position, progressFraction } from '../lib/progress'
import { MEDIA_LABEL, STATUS_LABEL, type HistoryEntry, type Title, type WatchStatus } from '../lib/types'
import { useLibrary } from '../state/library'
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
  const [editDetails, setEditDetails] = useState(false)
  const [special, setSpecial] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const notes = draft ?? t.notes
  const editProgress = params.get('edit') === 'progress' && !!t.progress
  const posterUrl = usePosterUrl(t.poster)

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
      <button type="button" onClick={() => (history.length || window.history.length > 1 ? navigate(-1) : navigate('/library'))} className="btn-ghost -ml-3 px-3">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-surface">
        {backdrop && (
          <div aria-hidden className="absolute inset-0">
            <img src={backdrop} alt="" className={`size-full object-cover ${t.backdropUrl ? 'opacity-30' : 'scale-110 opacity-25 blur-2xl'}`} />
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-surface/40" />
          </div>
        )}
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:p-8">
          <Poster poster={t.poster} source={t.source} title={t.title} mediaType={t.mediaType} className="w-36 shrink-0 shadow-2xl sm:w-48" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusBadge status={t.status} />
              <span>{MEDIA_LABEL[t.mediaType]}</span>
              {t.year && <span>· {t.year}</span>}
              {p?.rewatching && <span className="rounded-full bg-surface-2 px-2 py-0.5">Rewatching</span>}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.title}</h1>
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
              <div className="max-w-md space-y-2 rounded-2xl bg-surface-2/80 p-4">
                <p className="text-xs uppercase tracking-wide text-muted">{pos.state === 'next' ? 'Up next' : 'Progress'}</p>
                <p className="text-xl font-semibold text-accent-text">{describePosition(p)}</p>
                <p className="text-xs text-muted">
                  Last watched: {last ? formatEp(last, p.numbering) : '—'}
                  {t.lastWatchedAt && ` · ${timeAgo(t.lastWatchedAt)}`}
                </p>
                <ProgressBar value={progressFraction(p)} />
              </div>
            )}
            {!p && (
              <div className="max-w-md rounded-2xl bg-surface-2/80 p-4 text-sm">
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
                  return (
                    <li key={s} className={`card p-3 ${current ? 'border-accent/60' : ''}`}>
                      <p className="text-sm font-medium">Season {s}</p>
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
                    className={`flex size-7 items-center justify-center rounded-lg text-xs font-medium transition-colors ${
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
            <button type="button" className="btn-ghost text-danger hover:text-danger" onClick={() => void actions.remove(t).then((ok) => ok && navigate('/library'))}>
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
        </aside>
      </div>

      <AnimatePresence>{editProgress && <ProgressEditor title={t} open onClose={closeEditor} />}</AnimatePresence>
      <AnimatePresence>{editDetails && <TitleForm open existing={t} onClose={() => setEditDetails(false)} />}</AnimatePresence>
      <AnimatePresence>{special && <SpecialDialog onClose={() => setSpecial(false)} onSave={(label) => void actions.logSpecial(t, label).then(() => setSpecial(false))} />}</AnimatePresence>
    </article>
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
