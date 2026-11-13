import { AnimatePresence, m } from 'framer-motion'
import { CalendarClock, Check, ChevronLeft, ChevronRight, Compass, Eye, ExternalLink, Flame, Info, Loader2, Plus, RotateCw, Sparkles, Star, WifiOff, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, PageHeader, Section } from '../components/cards'
import { Modal } from '../components/Modal'
import { Poster } from '../components/Poster'
import { candidateToTitle, dismiss, likeCandidate, loadHighlights, loadPool, loadSimilar, markSeen, restoreDismissed, seenKeys, setFilters, undismiss, useDiscover, withInferred, type Highlights, type PoolState } from '../lib/discover'
import { errMsg, formatShortRelease } from '../lib/format'
import { buildHighlights, isReleased, type HighlightCard, type HighlightRow } from '../lib/highlights'
import { PROVIDER_LABEL } from '../lib/metadata'
import { buildDiscover, buildProfile, buildSimilar, findTracked, indexLibrary, isPersonal, isTasteGenre, normGenre, topGenres, type Candidate, type Rec, type SortKey } from '../lib/recommend'
import { MEDIA_LABEL, STATUS_LABEL, type Title } from '../lib/types'
import { useLibrary } from '../state/library'

const SORT_LABEL: Record<SortKey, string> = { match: 'Best match', popular: 'Most popular', rating: 'Highest rated', newest: 'Newest' }
// Wider cards than the library grid: each one carries a reason and three actions.
const GRID = 'poster-grid [--card-min:clamp(8.5rem,22vw,11rem)]'
const PREVIEW = 6


/** Card-sized artwork: Kitsu/TVmaze thumbnails are big enough; TMDB's thumbnail (92px) isn't. */
const cardPoster = (c: Candidate) => {
  const url = c.source.provider === 'tmdb' ? c.posterUrl : (c.thumbUrl ?? c.posterUrl)
  return url ? { kind: 'remote' as const, url } : null
}

export function DiscoverPage() {
  const lib = useLibrary()
  const { feedback, filters, seen } = useDiscover()
  const [params, setParams] = useSearchParams()
  const focus = params.get('like')
  const [round, setRound] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [pool, setPool] = useState<PoolState | null>(null)
  const [hl, setHl] = useState<Highlights | null>(null)
  /** The request the current results finished for; loading while it differs from the one wanted now. */
  const [doneFor, setDoneFor] = useState<string | null>(null)

  // Only refetch when what we'd ask the providers about changes — not on every rating or episode logged.
  const profile = useMemo(() => buildProfile(lib.titles, feedback), [lib.titles, feedback])
  const askKey = JSON.stringify([profile.seeds.slice(0, 10).map((s) => s.id), topGenres(profile, 4)])
  const latest = useRef({ titles: lib.titles, feedback })
  useEffect(() => {
    latest.current = { titles: lib.titles, feedback }
  })

  const requestKey = JSON.stringify([round, attempt, focus, askKey])
  const loading = doneFor !== requestKey
  useEffect(() => {
    if (lib.loading) return
    let alive = true
    void loadPool(latest.current.titles, latest.current.feedback, round, focus, (s) => alive && setPool(s)).finally(() => alive && setDoneFor(requestKey))
    return () => {
      alive = false
    }
  }, [lib.loading, requestKey, round, focus])

  // Trending and new releases don't depend on the library: loaded once per visit (and on Retry), cached for hours.
  useEffect(() => {
    let alive = true
    void loadHighlights((h) => alive && setHl(h))
    return () => {
      alive = false
    }
  }, [attempt])

  // Titles without genres or a provider id get the ones looked up by exact name (in memory only, never saved).
  const library = useMemo(() => (pool ? withInferred(lib.titles, pool.inferred) : lib.titles), [pool, lib.titles])
  const setFocus = (id: string | null) => {
    setParams((p) => {
      if (id) p.set('like', id)
      else p.delete('like')
      return p
    })
    if (id) window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const { actions, keep, setKeep, details, setDetails } = useRecActions(library, (r) => setFocus(moreLikeId(r)))
  const seenSet = useMemo(() => seenKeys(seen), [seen])
  const built = useMemo(
    () => (pool ? buildDiscover(pool.pool, pool.links, library, feedback, { ...filters, focus, keep, round, seen: seenSet }) : null),
    [pool, library, feedback, filters, focus, keep, round, seenSet],
  )
  const highlights = useMemo(() => (hl ? buildHighlights(hl, library, feedback, filters) : null), [hl, library, feedback, filters])

  // Genres offered as filters: ones that appear on several candidates, by their provider labels.
  const genres = useMemo(() => {
    const count = new Map<string, { label: string; n: number }>()
    const all = [...(pool?.pool ?? []), ...(hl ? [...hl.season, ...hl.airing, ...hl.premieres, ...(hl.tmdbTv ?? []), ...(hl.tmdbMovies ?? [])].map((s) => s.c) : [])]
    for (const c of all) for (const g of c.genres) count.set(normGenre(g), { label: g, n: (count.get(normGenre(g))?.n ?? 0) + 1 })
    return [...count].filter(([, v]) => v.n >= 5 && isTasteGenre(v.label)).sort((a, b) => a[1].label.localeCompare(b[1].label))
  }, [pool, hl])

  const sections = built?.sections ?? []
  const focusSection = sections.find((s) => s.id === 'focus')
  const recSections = sections.filter((s) => s.id !== 'focus')

  /** Another set: the picks on screen now go to the back of the queue for a week (markSeen), then the next pages load. */
  const refresh = () => {
    markSeen(recSections.flatMap((s) => s.recs.map((r) => r.key)))
    setKeep(new Set())
    setRound((n) => n + 1)
  }

  const failed = [...(pool?.failed ?? []), ...(hl?.failed ?? [])].filter((f, i, all) => all.findIndex((x) => x.provider === f.provider) === i)
  const waiting = !pool || (pool.pool.length === 0 && pool.pending > 0)
  const hlWaiting = !hl || hl.pending > 0
  const dismissedCount = Object.keys(feedback.dismissed).length
  const filtered = filters.type !== 'all' || !!filters.genre
  const libraryCount = lib.titles.length
  const retry = () => setAttempt((n) => n + 1)

  return (
    <div className="space-y-10 sm:space-y-12">
      <div>
        <PageHeader
          title="Discover"
          subtitle={
            built?.personal ? (
              <>
                What's popular, what's new, and picks from your {libraryCount} title{libraryCount === 1 ? '' : 's'}
                {topGenres(built.profile).length > 0 && <> · you lean towards {topGenres(built.profile).join(', ')}</>}
              </>
            ) : (
              "What's popular right now, what's new, and what's coming soon."
            )
          }
        />
        {/* Filters apply to every row on the page. */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter Discover">
          {(['all', 'anime', 'tv', 'movie'] as const).map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={filters.type === t} onClick={() => setFilters({ type: t })}>
              {t === 'all' ? 'Everything' : t === 'movie' ? 'Movies' : MEDIA_LABEL[t]}
            </button>
          ))}
          <select className="input ml-auto w-auto min-w-0 max-w-full sm:max-w-56" value={filters.genre} onChange={(e) => setFilters({ genre: e.target.value })} aria-label="Genre">
            <option value="">All genres</option>
            {genres.map(([g, v]) => (
              <option key={g} value={g}>
                {v.label}
              </option>
            ))}
            {filters.genre && !genres.some(([g]) => g === filters.genre) && <option value={filters.genre}>{filters.genre}</option>}
          </select>
        </div>
      </div>

      {failed.length > 0 && !waiting && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{failed.map((f) => f.message).join(' ')} Showing what could be loaded.</span>
          <button type="button" className="btn-ghost min-h-8 px-3 text-xs text-warn" onClick={retry} disabled={loading}>
            <RotateCw className="size-3.5" aria-hidden /> Retry
          </button>
        </div>
      )}

      {focus &&
        (focusSection ? (
          <Rail id="focus" title={focusSection.title} subtitle={focusSection.subtitle} items={focusSection.recs.map((rec) => ({ rec }))} actions={actions} onClear={() => setFocus(null)} />
        ) : (
          <p className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
            {loading ? 'Finding similar titles…' : 'No similar titles found for that one yet.'}
            <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => setFocus(null)}>
              <X className="size-3.5" aria-hidden /> Clear
            </button>
          </p>
        ))}

      <Hero cards={highlights?.hero ?? []} loading={hlWaiting} actions={actions} />

      {/* 1. What is everyone watching? */}
      <Group icon={Flame} eyebrow="Trending" title="What everyone's watching">
        {filters.type === 'movie' && hl?.tmdbOff && (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">Live-action movie trends come from TMDB, which isn't set up on this server — showing this season's anime films from Kitsu instead.</p>
        )}
        <Rows rows={highlights?.trending ?? []} loading={hlWaiting} actions={actions} empty={filtered ? 'Nothing popular matches these filters right now.' : 'Popular lists couldn’t be loaded.'} />
      </Group>

      {/* 2. What's new and worth checking out? */}
      <Group icon={CalendarClock} eyebrow="New & upcoming" title="Fresh releases, worth a look">
        <Rows rows={highlights?.fresh ?? []} loading={hlWaiting} actions={actions} empty={filtered ? 'No new or upcoming releases match these filters.' : 'Release lists couldn’t be loaded.'} />
      </Group>

      {/* 3. What would I enjoy next? */}
      <Group
        icon={Sparkles}
        eyebrow="Recommended"
        title="Picked for you"
        action={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <select className="input w-auto min-w-0 flex-1 sm:flex-none" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as SortKey })} aria-label="Sort picks by">
              {(Object.keys(SORT_LABEL) as SortKey[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
            <button type="button" className="btn-secondary" onClick={refresh} disabled={loading} title="Show titles you haven't been shown yet">
              <RotateCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh picks
            </button>
          </div>
        }
      >
        {!lib.loading && built && !built.personal && (
          <div className="card flex flex-col gap-4 bg-[radial-gradient(70%_120%_at_0%_0%,var(--glow),transparent_70%)] p-5 sm:flex-row sm:items-center">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-text ring-1 ring-accent-line">
              <Compass className="size-6" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">{libraryCount ? 'Rate or finish a few titles to get personal picks' : 'Recommendations get personal as you go'}</h3>
              <p className="mt-1 text-sm text-muted">
                WatchTrack learns from what you complete, rate and plan — all on this device. Until then, here are popular, well-rated titles. Tap{' '}
                <Sparkles className="inline size-3.5 align-[-2px]" aria-label="More like this" /> on anything that looks good to steer the picks.
              </p>
            </div>
            <Link to="?add=1" className="btn-primary">
              <Plus className="size-4" aria-hidden /> Add title
            </Link>
          </div>
        )}
        {waiting ? (
          <RailSkeleton count={2} />
        ) : recSections.length === 0 ? (
          failed.length > 0 && !pool?.pool.length ? (
            <EmptyState
              icon={WifiOff}
              title="Couldn't load recommendations"
              body={<>{failed[0].message} Your library is unaffected — try again in a minute.</>}
              action={
                <button type="button" className="btn-primary" onClick={retry}>
                  <RotateCw className="size-4" aria-hidden /> Try again
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={Compass}
              title={filtered ? 'No picks match these filters' : "You've seen everything here"}
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
          recSections.map((s) => <Rail key={s.id} id={s.id} title={s.title} subtitle={s.subtitle} items={s.recs.map((rec) => ({ rec }))} general={s.general} actions={actions} />)
        )}
      </Group>

      <footer className="space-y-2 border-t border-line pt-6 text-center text-xs text-muted">
        {dismissedCount > 0 && (
          <p>
            {dismissedCount} dismissed title{dismissedCount === 1 ? '' : 's'} hidden ·{' '}
            <button type="button" className="text-accent-text underline" onClick={restoreDismissed}>
              Restore all
            </button>
          </p>
        )}
        <p>
          Worked out on this device from your library and these public catalogues: Kitsu, TVmaze (CC BY-SA){hl?.tmdbOff ? '' : ' and TMDB'}. "Trending" means a catalogue's own
          trending list; other rows say which signal they use.
        </p>
      </footer>

      <AnimatePresence>{details && <RecDetails r={details} onClose={() => setDetails(null)} actions={actions} />}</AnimatePresence>
    </div>
  )
}

// ---------- Layout pieces ----------

/** A titled block of rows: one of the page's three questions. */
function Group({ icon: Icon, eyebrow, title, action, children }: { icon: LucideIcon; eyebrow: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-accent-soft to-surface-2 text-accent-text shadow-card ring-1 ring-accent-line">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="eyebrow text-accent-text">{eyebrow}</p>
            <h2 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Rows({ rows, loading, actions, empty }: { rows: HighlightRow[]; loading: boolean; actions: Actions; empty: string }) {
  if (!rows.length) return loading ? <RailSkeleton count={2} /> : <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{empty}</p>
  return (
    <>
      {rows.map((r) => (
        <Rail key={r.id} id={r.id} title={r.title} subtitle={r.subtitle} items={r.cards} actions={actions} />
      ))}
      {loading && <RailSkeleton count={1} />}
    </>
  )
}

const RAIL_ITEM = 'w-[clamp(8.5rem,38vw,10.5rem)] shrink-0 snap-start'
/** Edge-to-edge on phones (into the page padding), inside the column from lg up. */
const RAIL_BLEED = '-mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 lg:mx-0 lg:px-0 lg:scroll-px-0'

function RailSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-10" aria-busy aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-4">
          <div className="skeleton h-5 w-52 rounded" />
          <div className={`flex gap-4 overflow-hidden ${RAIL_BLEED}`}>
            {Array.from({ length: 8 }, (_, j) => (
              <div key={j} className={`space-y-2 ${RAIL_ITEM}`}>
                <div className="skeleton aspect-[2/3] rounded-xl" />
                <div className="skeleton h-3 w-3/4 rounded" />
                <div className="skeleton h-3 w-1/2 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface RailItem {
  rec: Rec
  badge?: HighlightCard['badge']
  rank?: number
}

/** A horizontal, snap-scrolling row with arrow buttons (pointer devices), and View all to show it as a grid. */
function Rail({
  id,
  title,
  subtitle,
  items,
  actions,
  general = false,
  onClear,
}: {
  id: string
  title: string
  subtitle?: string
  items: RailItem[]
  actions: Actions
  general?: boolean
  onClear?: () => void
}) {
  const [all, setAll] = useState(false)
  const ref = useRef<HTMLUListElement>(null)
  const [edge, setEdge] = useState({ start: true, end: true })
  const update = () => {
    const el = ref.current
    if (el) setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }
  useEffect(update, [items.length, all])
  const scroll = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' })
  }
  const headingId = `rail-${id}`
  const arrow = 'absolute top-[calc(var(--poster-h)/2)] z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-overlay/90 text-fg shadow-pop backdrop-blur-sm transition-opacity hover:bg-overlay can-hover:flex disabled:pointer-events-none disabled:opacity-0'
  return (
    <section className="min-w-0 space-y-4" aria-labelledby={headingId}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 id={headingId} className="truncate text-lg font-semibold tracking-tight">
            {title}
          </h3>
          {(subtitle || general) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {general && <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-fg-2">General picks</span>}
              {subtitle}
            </p>
          )}
        </div>
        {onClear ? (
          <button type="button" className="btn-ghost min-h-8 shrink-0 px-2 text-xs" onClick={onClear}>
            <X className="size-3.5" aria-hidden /> Clear
          </button>
        ) : (
          items.length > 5 && (
            <button type="button" className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent-text hover:underline" onClick={() => setAll((a) => !a)} aria-expanded={all}>
              {all ? 'Show less' : `View all ${items.length}`} <ChevronRight className={`size-4 transition-transform ${all ? 'rotate-90' : ''}`} aria-hidden />
            </button>
          )
        )}
      </div>
      {all ? (
        <ul className={GRID}>
          {items.map((x) => (
            <RecCard key={x.rec.key} {...x} actions={actions} />
          ))}
        </ul>
      ) : (
        <div className="relative [--poster-h:clamp(12.75rem,57vw,15.75rem)]">
          <button type="button" className={`${arrow} -left-3`} onClick={() => scroll(-1)} disabled={edge.start} aria-label={`Scroll ${title} back`}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <ul ref={ref} onScroll={update} className={`scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-1 ${RAIL_BLEED}`}>
            {items.map((x) => (
              <RecCard key={x.rec.key} {...x} actions={actions} className={RAIL_ITEM} />
            ))}
          </ul>
          <button type="button" className={`${arrow} -right-3`} onClick={() => scroll(1)} disabled={edge.end} aria-label={`Scroll ${title} forward`}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      )}
    </section>
  )
}

/** The featured area: the current leaders, big, with their wide artwork when the provider has some. */
function Hero({ cards, loading, actions }: { cards: HighlightCard[]; loading: boolean; actions: Actions }) {
  const [at, setAt] = useState(0)
  if (!cards.length) return loading ? <div className="skeleton h-[clamp(22rem,48vw,27rem)] rounded-3xl" aria-busy aria-label="Loading featured titles" /> : null
  const x = cards[Math.min(at, cards.length - 1)]
  const { c, tracked } = x.rec
  const busy = actions.busy.has(x.rec.key)
  const wide = !!c.backdropUrl
  return (
    <section aria-roledescription="carousel" aria-label="Featured titles" className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface shadow-pop">
      <AnimatePresence initial={false}>
        <m.img
          key={x.rec.key}
          src={c.backdropUrl ?? c.posterUrl ?? c.thumbUrl ?? undefined}
          alt=""
          aria-hidden
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
          className={`absolute inset-0 -z-10 size-full object-cover ${wide ? '' : 'scale-110 blur-2xl'}`}
        />
      </AnimatePresence>
      {/* Scrims: dark enough for white text on any artwork, tinted with the theme's accent glow. */}
      <div className="absolute inset-0 -z-10 bg-linear-to-t from-black/90 via-black/60 to-black/20 sm:bg-linear-to-r sm:from-black/90 sm:via-black/60 sm:to-black/5" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_0%_100%,color-mix(in_oklab,var(--accent)_28%,transparent),transparent_70%)]" aria-hidden />
      <div className="flex min-h-[clamp(22rem,48vw,27rem)] flex-col justify-end gap-5 p-5 text-white sm:flex-row sm:items-end sm:p-8">
        <button type="button" onClick={() => actions.open(x.rec)} className="hidden w-36 shrink-0 overflow-hidden rounded-xl shadow-pop ring-1 ring-white/15 sm:block lg:w-40" aria-label={`Details for ${c.title}`}>
          <Poster poster={cardPoster(c)} source={c.source} title={c.title} mediaType={c.mediaType} />
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            {x.rank && <span className="rounded-full bg-accent px-2.5 py-1 text-on-accent">#{x.rank} Top 10</span>}
            {x.badge && <span className="rounded-full bg-white/15 px-2.5 py-1 backdrop-blur-sm">{x.badge.label}</span>}
          </p>
          <h2 className="line-clamp-2 text-2xl font-semibold tracking-tight sm:text-4xl">{c.title}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/75">
            <span>{MEDIA_LABEL[c.mediaType]}</span>
            {c.year && <span>· {c.year}</span>}
            {c.communityScore != null && (
              <span className="inline-flex items-center gap-1">
                · <Star className="size-3.5 fill-warn text-warn" aria-hidden /> {(c.communityScore / 10).toFixed(1)}
              </span>
            )}
            {c.genres.filter(isTasteGenre).slice(0, 3).length > 0 && <span>· {c.genres.filter(isTasteGenre).slice(0, 3).join(', ')}</span>}
          </p>
          {c.synopsis && <p className="line-clamp-2 max-w-2xl text-sm leading-relaxed text-white/80 sm:line-clamp-3">{c.synopsis}</p>}
          <p className="flex items-center gap-1.5 text-xs text-white/70">
            {isPersonal(x.rec) ? <Sparkles className="size-3.5 shrink-0" aria-hidden /> : <Flame className="size-3.5 shrink-0" aria-hidden />}
            {x.rec.reason}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {tracked ? (
              <Link to={`/title/${tracked.id}`} className="btn-primary">
                <Check className="size-4" aria-hidden /> In your library
              </Link>
            ) : (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void actions.save(x.rec, 'plan')}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} Add to watchlist
              </button>
            )}
            <button type="button" className="btn border border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20" onClick={() => actions.open(x.rec)}>
              <Info className="size-4" aria-hidden /> Details
            </button>
          </div>
        </div>
        {cards.length > 1 && (
          <div className="flex shrink-0 gap-2 sm:flex-col" role="group" aria-label="Choose featured title">
            {cards.map((y, i) => (
              <button
                key={y.rec.key}
                type="button"
                onClick={() => setAt(i)}
                aria-label={`Feature ${y.rec.c.title}`}
                aria-current={i === at}
                className={`h-1.5 rounded-full transition-all sm:h-8 sm:w-1.5 ${i === at ? 'w-8 bg-white sm:h-12' : 'w-4 bg-white/35 hover:bg-white/60'}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

interface Actions {
  save: (r: Rec, status: 'plan' | 'completed') => Promise<void>
  onDismiss: (r: Rec) => void
  onMore: (r: Rec) => void
  open: (r: Rec) => void
  busy: Set<string>
}

/** The seed id for "More like this": the library title, or the candidate remembered as a liked title. */
const moreLikeId = (r: Rec) => (r.tracked ? r.tracked.id : likeCandidate(r.c))

/** Card actions shared by Discover and "Similar titles": add, mark watched, dismiss, details. */
function useRecActions(library: Title[], onMore: (r: Rec) => void) {
  const lib = useLibrary()
  /** Added during this visit: kept on screen so the card can show its new state instead of vanishing. */
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [details, setDetails] = useState<Rec | null>(null)

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

  const actions: Actions = {
    save,
    onDismiss,
    onMore: (r) => {
      setDetails(null)
      onMore(r)
    },
    open: setDetails,
    busy,
  }
  return { actions, keep, setKeep, details, setDetails }
}

/**
 * "Similar titles" for one library title, from its own provider metadata (relationships, recommendations, genre
 * lists). Library titles are left out; each card lists what it shares with this one.
 */
export function SimilarTitles({ t }: { t: Title }) {
  const lib = useLibrary()
  const { feedback } = useDiscover()
  const navigate = useNavigate()
  const [attempt, setAttempt] = useState(0)
  const [res, setRes] = useState<{ for: string; data: Awaited<ReturnType<typeof loadSimilar>> } | null>(null)
  // Refetch only when what we'd ask about changes — not on every episode logged or rating changed.
  const ask = JSON.stringify([t.id, t.mediaType, t.source?.provider, t.source?.id, t.genres, attempt])
  const latest = useRef(t)
  useEffect(() => {
    latest.current = t
  })
  useEffect(() => {
    let alive = true
    void loadSimilar(latest.current).then((data) => alive && setRes({ for: ask, data }))
    return () => {
      alive = false
    }
  }, [ask])

  const data = res?.data
  const library = useMemo(() => (data ? withInferred(lib.titles, data.inferred) : lib.titles), [data, lib.titles])
  const { actions, keep, details, setDetails } = useRecActions(library, (r) => navigate(`/discover?like=${encodeURIComponent(moreLikeId(r))}`))
  const recs = useMemo(() => (data ? buildSimilar(data.pool, data.links, library, feedback, t.id, keep) : []), [data, library, feedback, t.id, keep])
  const loading = res?.for !== ask

  return (
    <>
      {loading ? (
        <Section title="Similar titles">
          <p className="-mt-2 text-xs text-muted">Looking at {t.title}'s provider links and genres…</p>
          <div className={GRID} aria-busy aria-label="Loading similar titles">
            <SkeletonCards />
          </div>
        </Section>
      ) : recs.length ? (
        <Rail id="similar" title="Similar titles" subtitle={`Based on ${t.title}'s own metadata: provider relationships and shared genres.`} items={recs.map((rec) => ({ rec }))} actions={actions} />
      ) : (
        <Section title="Similar titles">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
            <span className="min-w-0 flex-1">
              {data?.failed.length
                ? `${data.failed[0].message} Couldn't load similar titles.`
                : t.genres.length || t.source
                  ? 'Nothing similar found that isn’t already in your library.'
                  : 'Link this title to a provider or add genres to see similar titles.'}
            </span>
            {data?.failed.length ? (
              <button type="button" className="btn-ghost min-h-8 px-3 text-xs" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCw className="size-3.5" aria-hidden /> Retry
              </button>
            ) : null}
          </p>
        </Section>
      )}
      <AnimatePresence>{details && <RecDetails r={details} onClose={() => setDetails(null)} actions={actions} />}</AnimatePresence>
    </>
  )
}

const SkeletonCards = () =>
  Array.from({ length: PREVIEW }, (_, j) => (
    <div key={j} className="space-y-2">
      <div className="skeleton aspect-[2/3] rounded-xl" />
      <div className="skeleton h-3 w-3/4 rounded" />
    </div>
  ))

function Score({ c }: { c: Candidate }) {
  if (c.communityScore == null) return null
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Rated ${(c.communityScore / 10).toFixed(1)} out of 10 on ${PROVIDER_LABEL[c.source.provider]}`}>
      <Star className="size-3 fill-warn text-warn" aria-hidden />
      {(c.communityScore / 10).toFixed(1)}
    </span>
  )
}

const MATCH_HINT = 'Relevance score out of 100 from the factors behind this pick — not a probability that you will like it.'

function Match({ r }: { r: Rec }) {
  return (
    <span className="tabular-nums" title={MATCH_HINT}>
      Match {r.match}
      <span className="sr-only">/100, a relevance score, not a probability</span>
    </span>
  )
}

const BADGE_DOT: Record<NonNullable<HighlightCard['badge']>['tone'], string> = { hot: 'bg-accent', new: 'bg-success', soon: 'bg-info' }

/** Not out yet: nobody can have watched it. */
const unreleased = (c: Candidate) => !!c.date && !isReleased(c.date)

function RecCard({ rec: r, badge, rank, actions, className = '' }: { rec: Rec; badge?: HighlightCard['badge']; rank?: number; actions: Actions; className?: string }) {
  const { c, tracked } = r
  const busy = actions.busy.has(r.key)
  const personal = isPersonal(r)
  return (
    <m.li layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className={`relative flex min-w-0 flex-col ${className}`}>
      <div className="group relative">
        <button type="button" onClick={() => actions.open(r)} className="block w-full overflow-hidden rounded-xl shadow-card focus-visible:outline-offset-4" aria-label={`Details for ${c.title}`}>
          <Poster poster={cardPoster(c)} source={c.source} title={c.title} mediaType={c.mediaType} className="transition-transform duration-300 ease-out can-hover:group-hover:scale-[1.04]" />
          <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/5 transition-[box-shadow] duration-200 can-hover:group-hover:ring-2 can-hover:group-hover:ring-accent/70" aria-hidden />
        </button>
        {badge && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex max-w-[calc(100%-3rem)] items-center gap-1.5 truncate rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            <span className={`size-1.5 shrink-0 rounded-full ${BADGE_DOT[badge.tone]}`} aria-hidden />
            {badge.label}
          </span>
        )}
        {rank && (
          <span className="pointer-events-none absolute -bottom-2 left-1 text-5xl font-black leading-none tracking-tighter text-white [-webkit-text-stroke:1.5px_var(--accent)] [text-shadow:0_4px_16px_rgb(0_0_0/0.6)]" aria-label={`Number ${rank}`}>
            {rank}
          </span>
        )}
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
          {personal && <Match r={r} />}
        </p>
        <p className={`flex gap-1 text-xs ${personal ? 'text-accent-text' : 'text-muted'}`}>
          {personal ? <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden /> : <Compass className="mt-0.5 size-3 shrink-0" aria-hidden />}
          <span className="line-clamp-2">{r.reason}</span>
        </p>
        {r.shared && r.shared.length > 0 && (
          <p className="line-clamp-2 text-[11px] text-muted">
            <span className="sr-only">Shared with this title: </span>
            {r.shared.slice(0, 4).join(' · ')}
          </p>
        )}
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
        {!tracked && !unreleased(c) && (
          <button type="button" className="icon-btn size-8" disabled={busy} onClick={() => void actions.save(r, 'completed')} aria-label={`Mark ${c.title} as already watched`} title="Already watched">
            <Eye className="size-4" aria-hidden />
          </button>
        )}
        <button type="button" className="icon-btn size-8" onClick={() => actions.onMore(r)} aria-label={`More like ${c.title}`} title="More like this">
          <Sparkles className="size-4" aria-hidden />
        </button>
      </div>
    </m.li>
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
            {!unreleased(c) && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run('completed')}>
                <Eye className="size-4" aria-hidden /> Already watched
              </button>
            )}
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
            {c.date ? <span>· {unreleased(c) ? `Coming ${formatShortRelease(c.date.slice(0, 10))}` : c.year}</span> : c.year && <span>· {c.year}</span>}
            {c.totalEpisodes && c.mediaType !== 'movie' && <span>· {c.totalEpisodes} episodes</span>}
            {c.mediaType !== 'movie' && c.ongoing && <span>· Ongoing</span>}
            <Score c={c} />
          </p>
          {c.altTitles.length > 0 && <p className="text-sm text-muted">{c.altTitles.slice(0, 3).join(' · ')}</p>}
          {isPersonal(r) ? (
            <div className="space-y-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent-text">
              <p className="flex gap-2">
                <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{r.reason}</span>
                <span className="shrink-0 tabular-nums font-medium">Match {r.match}</span>
              </p>
              <details className="text-xs">
                <summary className="cursor-pointer select-none">Why this pick</summary>
                <ul className="mt-1.5 space-y-1">
                  {r.factors.map((f) => (
                    <li key={f.label} className="flex justify-between gap-3">
                      <span className="min-w-0">{f.label}</span>
                      <span className="shrink-0 tabular-nums">
                        {f.points > 0 ? '+' : ''}
                        {f.points.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-accent-text/80">{MATCH_HINT}</p>
              </details>
            </div>
          ) : (
            <p className="flex gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
              <Compass className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {r.reason}. A general pick, not based on your library.
              </span>
            </p>
          )}
          {r.shared && r.shared.length > 0 && <p className="text-xs text-muted">In common: {r.shared.join(' · ')}</p>}
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
