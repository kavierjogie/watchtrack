import { AnimatePresence, motion } from 'framer-motion'
import { Check, Compass, Eye, ExternalLink, FileUp, Loader2, Plus, RotateCw, Sparkles, Star, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, PageHeader, Section } from '../components/cards'
import { Modal } from '../components/Modal'
import { Poster } from '../components/Poster'
import { candidateToTitle, dismiss, likeCandidate, loadPool, restoreDismissed, setFilters, undismiss, useDiscover, withInferred, type PoolState } from '../lib/discover'
import { PROVIDER_LABEL } from '../lib/metadata'
import { usePrefs } from '../lib/prefs'
import { buildDiscover, buildProfile, findTracked, indexLibrary, isTasteGenre, normGenre, topGenres, type Candidate, type Rec, type SortKey } from '../lib/recommend'
import { MEDIA_LABEL, STATUS_LABEL } from '../lib/types'
import { useLibrary } from '../state/library'

const SORT_LABEL: Record<SortKey, string> = { match: 'Best match', popular: 'Most popular', rating: 'Highest rated', newest: 'Newest' }
// Wider cards than the library grid: each one carries a reason and three actions.
const GRID = 'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-6'
const PREVIEW = 6

const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

/** Card-sized artwork: Kitsu/TVmaze thumbnails are big enough; TMDB's thumbnail (92px) isn't. */
const cardPoster = (c: Candidate) => {
  const url = c.source.provider === 'tmdb' ? c.posterUrl : (c.thumbUrl ?? c.posterUrl)
  return url ? { kind: 'remote' as const, url } : null
}

export function DiscoverPage() {
  const lib = useLibrary()
  const prefs = usePrefs()
  const { feedback, filters } = useDiscover()
  const [params, setParams] = useSearchParams()
  const focus = params.get('like')
  const [round, setRound] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [pool, setPool] = useState<PoolState | null>(null)
  /** The request the current results finished for; loading while it differs from the one wanted now. */
  const [doneFor, setDoneFor] = useState<string | null>(null)
  /** Added during this visit: kept on screen so the card can show its new state instead of vanishing. */
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [details, setDetails] = useState<Rec | null>(null)

  // Only refetch when what we'd ask the providers about changes — not on every rating or episode logged.
  const profile = useMemo(() => buildProfile(lib.titles, feedback), [lib.titles, feedback])
  const askKey = JSON.stringify([profile.seeds.slice(0, 10).map((s) => s.id), topGenres(profile, 4)])
  const latest = useRef({ titles: lib.titles, feedback })
  useEffect(() => {
    latest.current = { titles: lib.titles, feedback }
  })

  const requestKey = JSON.stringify([round, attempt, focus, askKey, prefs.tmdbKey])
  const loading = doneFor !== requestKey
  useEffect(() => {
    if (lib.loading) return
    let alive = true
    void loadPool(latest.current.titles, latest.current.feedback, round, focus, (s) => alive && setPool(s)).finally(() => alive && setDoneFor(requestKey))
    return () => {
      alive = false
    }
  }, [lib.loading, requestKey, round, focus])

  // Titles without genres or a provider id get the ones looked up by exact name (in memory only, never saved).
  const library = useMemo(() => (pool ? withInferred(lib.titles, pool.inferred) : lib.titles), [pool, lib.titles])
  const built = useMemo(
    () => (pool ? buildDiscover(pool.pool, pool.links, library, feedback, { ...filters, focus, keep }) : null),
    [pool, library, feedback, filters, focus, keep],
  )

  // Genres offered as filters: ones that appear on several candidates, by their provider labels.
  const genres = useMemo(() => {
    const count = new Map<string, { label: string; n: number }>()
    for (const c of pool?.pool ?? []) for (const g of c.genres) count.set(normGenre(g), { label: g, n: (count.get(normGenre(g))?.n ?? 0) + 1 })
    return [...count].filter(([, v]) => v.n >= 5 && isTasteGenre(v.label)).sort((a, b) => a[1].label.localeCompare(b[1].label))
  }, [pool])

  const setFocus = (id: string | null) => {
    setParams((p) => {
      if (id) p.set('like', id)
      else p.delete('like')
      return p
    })
    if (id) window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    if (busy.has(key)) return
    setBusy((b) => new Set(b).add(key))
    try {
      await fn()
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(key)
        return n
      })
    }
  }

  /** Add to the library as planned or already watched. Never touches a title that's already tracked. */
  const save = (r: Rec, status: 'plan' | 'completed') =>
    withBusy(r.key, async () => {
      const existing = findTracked(r.c, indexLibrary(library))
      if (existing) {
        toast.info(`${existing.title} is already in your library`, { description: STATUS_LABEL[existing.status] })
        return
      }
      try {
        const title = await candidateToTitle(r.c, status)
        // The library may have changed while artwork downloaded (another tab, a double tap).
        if (findTracked(r.c, indexLibrary(lib.titles))) return
        await lib.save(title)
        setKeep((k) => new Set(k).add(r.key))
        toast.success(status === 'plan' ? `Added ${title.title} to Plan to Watch` : `Marked ${title.title} as watched`, {
          description: status === 'completed' ? 'Saved as Completed — rate it to sharpen your recommendations.' : undefined,
          duration: 6000,
          action: { label: 'Undo', onClick: () => void lib.remove(title.id).catch((err: unknown) => toast.error(errMsg(err))) },
        })
      } catch (err) {
        toast.error(errMsg(err))
      }
    })

  const onDismiss = (r: Rec) => {
    dismiss(r.c)
    setDetails(null)
    toast(`Dismissed ${r.c.title}`, { description: "It won't be recommended again.", duration: 6000, action: { label: 'Undo', onClick: () => undismiss(r.key) } })
  }

  const onMore = (r: Rec) => {
    setDetails(null)
    setFocus(r.tracked ? r.tracked.id : likeCandidate(r.c))
  }

  const refresh = () => {
    setKeep(new Set())
    setRound((n) => n + 1)
  }

  const actions = { save, onDismiss, onMore, open: setDetails, busy }
  const sections = built?.sections ?? []
  const failed = pool?.failed ?? []
  const waiting = !pool || (pool.pool.length === 0 && pool.pending > 0)
  const dismissedCount = Object.keys(feedback.dismissed).length
  const filtered = filters.type !== 'all' || !!filters.genre
  const libraryCount = lib.titles.length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Discover"
        subtitle={
          built?.personal ? (
            <>
              Picked from your {libraryCount} title{libraryCount === 1 ? '' : 's'} on this device
              {topGenres(built.profile).length > 0 && <> · you lean towards {topGenres(built.profile).join(', ')}</>}
            </>
          ) : (
            'Popular, well-rated titles to get you started.'
          )
        }
        action={
          <button type="button" className="btn-secondary" onClick={refresh} disabled={loading}>
            <RotateCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
          </button>
        }
      />

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['all', 'anime', 'tv', 'movie'] as const).map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={filters.type === m} onClick={() => setFilters({ type: m })}>
              {m === 'all' ? 'Everything' : m === 'movie' ? 'Movies' : MEDIA_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto min-w-0 max-w-full flex-1 sm:flex-none" value={filters.genre} onChange={(e) => setFilters({ genre: e.target.value })} aria-label="Genre">
            <option value="">All genres</option>
            {genres.map(([g, v]) => (
              <option key={g} value={g}>
                {v.label}
              </option>
            ))}
            {filters.genre && !genres.some(([g]) => g === filters.genre) && <option value={filters.genre}>{filters.genre}</option>}
          </select>
          <select className="input w-auto min-w-0 flex-1 sm:flex-none" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as SortKey })} aria-label="Sort by">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!lib.loading && built && !built.personal && (
        <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
            <Compass className="size-6" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{libraryCount ? 'Rate or finish a few titles to get personal picks' : 'Recommendations get personal as you go'}</h2>
            <p className="mt-1 text-sm text-muted">
              WatchTrack learns from what you complete, rate and plan — all on this device. Until then, here's what's popular. Tap{' '}
              <Sparkles className="inline size-3.5 align-[-2px]" aria-label="More like this" /> on anything that looks good to steer the picks.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="?add=1" className="btn-primary">
              <Plus className="size-4" aria-hidden /> Add title
            </Link>
            <Link to="/import" className="btn-secondary">
              <FileUp className="size-4" aria-hidden /> Import notes
            </Link>
          </div>
        </div>
      )}

      {failed.length > 0 && !waiting && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {failed.map((f) => f.message).join(' ')} {sections.length > 0 && 'Showing what could be loaded.'}
          </span>
          <button type="button" className="btn-ghost min-h-8 px-3 text-xs text-warn" onClick={() => setAttempt((n) => n + 1)} disabled={loading}>
            <RotateCw className="size-3.5" aria-hidden /> Retry
          </button>
        </div>
      )}

      {waiting ? (
        <div className="space-y-10" aria-busy aria-label="Loading recommendations">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3">
              <div className="skeleton h-5 w-48 rounded" />
              <div className={GRID}>
                {Array.from({ length: PREVIEW }, (_, j) => (
                  <div key={j} className="space-y-2">
                    <div className="skeleton aspect-[2/3] rounded-xl" />
                    <div className="skeleton h-3 w-3/4 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : sections.length === 0 ? (
        failed.length > 0 && !pool?.pool.length ? (
          <EmptyState
            icon={WifiOff}
            title="Couldn't load recommendations"
            body={<>{failed[0].message} Your library is unaffected — try again in a minute.</>}
            action={
              <button type="button" className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCw className="size-4" aria-hidden /> Try again
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={Compass}
            title={filtered ? 'Nothing matches these filters' : "You've seen everything here"}
            body={filtered ? 'Try another type or genre.' : 'Refresh for a new batch, or restore titles you dismissed.'}
            action={
              filtered ? (
                <button type="button" className="btn-secondary" onClick={() => setFilters({ type: 'all', genre: '' })}>
                  Clear filters
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={refresh}>
                  <RotateCw className="size-4" aria-hidden /> Refresh
                </button>
              )
            }
          />
        )
      ) : (
        <div className="space-y-10">
          {focus && !sections.some((s) => s.id === 'focus') && (
            <p className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
              {loading ? 'Finding similar titles…' : 'No similar titles found for that one yet.'}
              <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => setFocus(null)}>
                <X className="size-3.5" aria-hidden /> Clear
              </button>
            </p>
          )}
          {sections.map((s) => (
            <RecSection
              key={s.id}
              title={s.title}
              subtitle={s.subtitle}
              recs={s.recs}
              actions={actions}
              expanded={s.id === 'focus'}
              onClear={s.id === 'focus' ? () => setFocus(null) : undefined}
              note={
                s.id === 'movie' && !prefs.tmdbKey ? (
                  <>
                    These are anime films from Kitsu. For live-action movies,{' '}
                    <Link to="/settings" className="text-accent-text underline">
                      add a free TMDB key in Settings
                    </Link>
                    .
                  </>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      <footer className="space-y-2 border-t border-line pt-6 text-center text-xs text-muted">
        {dismissedCount > 0 && (
          <p>
            {dismissedCount} dismissed title{dismissedCount === 1 ? '' : 's'} hidden ·{' '}
            <button type="button" className="text-accent-text underline" onClick={restoreDismissed}>
              Restore all
            </button>
          </p>
        )}
        <p>Recommendations are worked out on this device from your library and these public catalogues: Kitsu, TVmaze (CC BY-SA){prefs.tmdbKey ? ' and TMDB' : ''}.</p>
      </footer>

      <AnimatePresence>{details && <RecDetails r={details} onClose={() => setDetails(null)} actions={actions} />}</AnimatePresence>
    </div>
  )
}

interface Actions {
  save: (r: Rec, status: 'plan' | 'completed') => Promise<void>
  onDismiss: (r: Rec) => void
  onMore: (r: Rec) => void
  open: (r: Rec) => void
  busy: Set<string>
}

function RecSection({ title, subtitle, recs, actions, expanded = false, onClear, note }: { title: string; subtitle?: string; recs: Rec[]; actions: Actions; expanded?: boolean; onClear?: () => void; note?: ReactNode }) {
  const [all, setAll] = useState(expanded)
  const shown = all ? recs : recs.slice(0, PREVIEW)
  return (
    <Section
      title={title}
      action={
        onClear ? (
          <button type="button" className="btn-ghost min-h-8 shrink-0 px-2 text-xs" onClick={onClear}>
            <X className="size-3.5" aria-hidden /> Clear
          </button>
        ) : (
          recs.length > PREVIEW && (
            <button type="button" className="shrink-0 text-sm text-accent-text hover:underline" onClick={() => setAll((a) => !a)} aria-expanded={all}>
              {all ? 'Show less' : `Show all ${recs.length}`}
            </button>
          )
        )
      }
    >
      {(subtitle || note) && <p className="-mt-2 text-xs text-muted">{note ?? subtitle}</p>}
      <ul className={GRID}>
        {shown.map((r) => (
          <RecCard key={r.key} r={r} actions={actions} />
        ))}
      </ul>
    </Section>
  )
}

function Score({ c }: { c: Candidate }) {
  if (c.communityScore == null) return null
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Rated ${(c.communityScore / 10).toFixed(1)} out of 10 on ${PROVIDER_LABEL[c.source.provider]}`}>
      <Star className="size-3 fill-warn text-warn" aria-hidden />
      {(c.communityScore / 10).toFixed(1)}
    </span>
  )
}

function RecCard({ r, actions }: { r: Rec; actions: Actions }) {
  const { c, tracked } = r
  const busy = actions.busy.has(r.key)
  return (
    <motion.li layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="flex min-w-0 flex-col">
      <div className="group relative">
        <button type="button" onClick={() => actions.open(r)} className="block w-full rounded-xl focus-visible:outline-offset-4" aria-label={`Details for ${c.title}`}>
          <Poster poster={cardPoster(c)} source={c.source} title={c.title} mediaType={c.mediaType} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg" />
        </button>
        {!tracked && (
          <button
            type="button"
            onClick={() => actions.onDismiss(r)}
            className="press absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75"
            aria-label={`Dismiss ${c.title}`}
            title="Not interested"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-2 min-w-0 flex-1 space-y-1 px-0.5">
        <h3 className="line-clamp-2 text-sm font-medium">
          <button type="button" onClick={() => actions.open(r)} className="text-left hover:text-accent-text">
            {c.title}
          </button>
        </h3>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
          <span>{MEDIA_LABEL[c.mediaType]}</span>
          {c.year && <span>{c.year}</span>}
          <Score c={c} />
        </p>
        <p className="flex gap-1 text-xs text-accent-text">
          <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="line-clamp-2">{r.reason}</span>
        </p>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {tracked ? (
          <Link to={`/title/${tracked.id}`} className="btn-secondary min-h-8 min-w-0 flex-1 px-2 text-xs" title={STATUS_LABEL[tracked.status]}>
            <Check className="size-3.5 shrink-0 text-success" aria-hidden /> <span className="truncate">In library</span>
          </Link>
        ) : (
          <button type="button" className="btn-primary min-h-8 min-w-0 flex-1 px-2 text-xs" disabled={busy} onClick={() => void actions.save(r, 'plan')} aria-label={`Add ${c.title} to watchlist`}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />} Add
          </button>
        )}
        {!tracked && (
          <button type="button" className="icon-btn size-8" disabled={busy} onClick={() => void actions.save(r, 'completed')} aria-label={`Mark ${c.title} as already watched`} title="Already watched">
            <Eye className="size-4" aria-hidden />
          </button>
        )}
        <button type="button" className="icon-btn size-8" onClick={() => actions.onMore(r)} aria-label={`More like ${c.title}`} title="More like this">
          <Sparkles className="size-4" aria-hidden />
        </button>
      </div>
    </motion.li>
  )
}

function RecDetails({ r, onClose, actions }: { r: Rec; onClose: () => void; actions: Actions }) {
  const { c, tracked } = r
  const busy = actions.busy.has(r.key)
  const run = async (status: 'plan' | 'completed') => {
    await actions.save(r, status)
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={c.title}
      size="lg"
      footer={
        tracked ? (
          <>
            <button type="button" className="btn-secondary" onClick={() => actions.onMore(r)}>
              <Sparkles className="size-4" aria-hidden /> More like this
            </button>
            <Link to={`/title/${tracked.id}`} className="btn-primary">
              Open in library ({STATUS_LABEL[tracked.status]})
            </Link>
          </>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={() => actions.onDismiss(r)}>
              <X className="size-4" aria-hidden /> Not interested
            </button>
            <button type="button" className="btn-secondary" onClick={() => actions.onMore(r)}>
              <Sparkles className="size-4" aria-hidden /> More like this
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run('completed')}>
              <Eye className="size-4" aria-hidden /> Already watched
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void run('plan')}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} Add to watchlist
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5 sm:flex-row">
        <Poster poster={c.posterUrl ? { kind: 'remote', url: c.posterUrl } : null} source={c.source} title={c.title} mediaType={c.mediaType} className="w-32 shrink-0 self-start sm:w-40" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{MEDIA_LABEL[c.mediaType]}</span>
            {c.year && <span>· {c.year}</span>}
            {c.totalEpisodes && c.mediaType !== 'movie' && <span>· {c.totalEpisodes} episodes</span>}
            {c.mediaType !== 'movie' && c.ongoing && <span>· Ongoing</span>}
            <Score c={c} />
          </p>
          {c.altTitles.length > 0 && <p className="text-sm text-muted">{c.altTitles.slice(0, 3).join(' · ')}</p>}
          <p className="flex gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent-text">
            <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
            {r.reason}
          </p>
          {c.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {c.genres.slice(0, 10).map((g) => (
                <span key={g} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
                  {g}
                </span>
              ))}
            </div>
          )}
          <p className="whitespace-pre-line text-sm leading-relaxed">{c.synopsis || <span className="text-muted">No synopsis from {PROVIDER_LABEL[c.source.provider]}.</span>}</p>
          {c.source.url && (
            <a href={c.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-text underline">
              View on {PROVIDER_LABEL[c.source.provider]} <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </Modal>
  )
}
