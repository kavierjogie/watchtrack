import { CalendarClock, CalendarPlus, CalendarX, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, PageHeader, PosterGridSkeleton, Section } from '../components/cards'
import { Poster } from '../components/Poster'
import { RELEASED, releaseLabel, upcomingOf, useAlerts } from '../lib/alerts'
import { formatRelease, formatShortRelease, isPast, RELEASE_BUCKETS, releaseBucket, timeAgo } from '../lib/format'
import { buildIcs } from '../lib/ics'
import { canRefresh, useSyncState } from '../lib/sync'
import type { Title } from '../lib/types'
import { useLibrary } from '../state/library'
import { useRefreshEpisodes } from '../state/useSync'

type Filter = 'all' | 'season' | 'episode' | 'released'
const FILTERS: [Filter, string][] = [
  ['all', 'All upcoming'],
  ['season', 'Seasons'],
  ['episode', 'Episodes'],
  ['released', 'Newly released'],
]

interface Row {
  key: string
  t: Title
  kind: 'season' | 'episode'
  label: string
  name: string | null
  /** Confirmed date, or null (TBA). */
  date: string | null
  status: string
}

/** One show's next release; `more` holds what follows it. */
interface Card {
  row: Row
  more: Row[]
}

const RECENT_DAYS = 30

function downloadCalendar(titles: Title[]) {
  const ics = buildIcs(titles)
  if (!ics) return
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'watchtrack-upcoming.ics'
  a.click()
  URL.revokeObjectURL(url)
  toast.success('Calendar file saved', { description: 'Open it to add the dates to your calendar. Export again later to pick up changes.' })
}

/** One card per show, led by its earliest dated release. TBA releases sort last, so they lead only when nothing is dated. */
function byShow(rows: Row[]): Card[] {
  const sorted = [...rows].sort((a, b) => (a.date ? Date.parse(a.date) : Infinity) - (b.date ? Date.parse(b.date) : Infinity))
  const cards = new Map<string, Card>()
  for (const row of sorted) {
    const card = cards.get(row.t.id)
    if (card) card.more.push(row)
    else cards.set(row.t.id, { row, more: [] })
  }
  return [...cards.values()]
}

/** "2027-01" → "Jan 2027": the provider's own rough window, never turned into a day. */
const formatWindow = (w: string) => (/^\d{4}-\d{2}$/.test(w) ? new Date(`${w}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : w)

export function UpcomingPage() {
  const lib = useLibrary()
  const { items } = useAlerts()
  const { refreshAll } = useRefreshEpisodes()
  const { cycle } = useSyncState()
  const [filter, setFilter] = useState<Filter>('all')
  const [openedAt] = useState(() => Date.now())

  const upcoming = useMemo(() => {
    const rows: Row[] = []
    for (const t of lib.titles) {
      if (t.status === 'dropped') continue
      const seasonal = t.progress?.numbering === 'seasonal'
      for (const r of upcomingOf(t)) {
        // Past its date: waiting for the provider to confirm it's out (the next refresh checks), so not "upcoming".
        if (r.airdate && isPast(r.airdate)) continue
        const label = releaseLabel(r, seasonal)
        const status = r.kind === 'episode' ? 'Upcoming episode' : r.airdate ? 'Premiere date confirmed' : r.window ? `Announced · expected ${formatWindow(r.window)}` : 'Announced · date TBA'
        rows.push({ key: `${t.id}:${r.kind}:${r.season}:${r.episode}:${r.name}`, t, kind: r.kind, label, name: r.name, date: r.airdate, status })
      }
    }
    return rows
  }, [lib.titles])

  const released = useMemo(() => {
    const since = openedAt - RECENT_DAYS * 86400000
    return items
      .filter((a) => RELEASED.includes(a.kind) && Date.parse(a.createdAt) >= since)
      .flatMap((a): Row[] => {
        const t = lib.byId(a.titleId)
        return t ? [{ key: a.id, t, kind: a.kind === 'season_available' ? 'season' : 'episode', label: a.label, name: a.detail, date: a.date, status: `Released · found ${timeAgo(a.createdAt)}` }] : []
      })
  }, [items, lib, openedAt])

  const shown = filter === 'released' ? released : upcoming.filter((r) => filter === 'all' || r.kind === filter)
  const cards = filter === 'released' ? shown.map((row): Card => ({ row, more: [] })) : byShow(shown)
  const sections: [string, Card[]][] = [
    ...RELEASE_BUCKETS.map((b): [string, Card[]] => [b, cards.filter((c) => c.row.date && releaseBucket(c.row.date) === b)]),
    ['Date TBA', cards.filter((c) => !c.row.date)],
  ]
  const linked = lib.titles.some(canRefresh)

  return (
    <div>
      <PageHeader
        title="Upcoming"
        subtitle="Confirmed seasons and episodes for shows in your library"
        action={
          linked && (
            <div className="flex flex-wrap gap-2">
              {upcoming.some((r) => r.date) && (
                <button type="button" className="btn-secondary" onClick={() => downloadCalendar(lib.titles)}>
                  <CalendarPlus className="size-4" aria-hidden /> Add to calendar
                </button>
              )}
              <button type="button" className="btn-secondary" disabled={cycle} onClick={() => void refreshAll()}>
                <RefreshCw className={`size-4 ${cycle ? 'animate-spin' : ''}`} aria-hidden /> {cycle ? 'Checking…' : 'Check now'}
              </button>
            </div>
          )
        }
      />
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map(([v, l]) => (
          <button key={v} type="button" className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>
            {l}
          </button>
        ))}
      </div>

      {lib.loading ? (
        <PosterGridSkeleton />
      ) : !linked ? (
        <EmptyState
          icon={CalendarX}
          title="No shows to check yet"
          body="Release dates come from TVmaze, Kitsu/AniList and TMDB. Add a show through search so WatchTrack knows which one it is."
        />
      ) : !cards.length ? (
        <EmptyState
          icon={CalendarClock}
          title={filter === 'released' ? 'Nothing new in the last 30 days' : 'Nothing scheduled yet'}
          body={
            filter === 'released'
              ? 'Episodes and seasons that come out for your shows will be listed here.'
              : "None of your shows has a confirmed upcoming season or episode right now. WatchTrack checks each show once a day while it's open."
          }
        />
      ) : filter === 'released' ? (
        <Cards cards={cards} />
      ) : (
        <div className="space-y-8">
          {sections.map(
            ([title, list]) =>
              list.length > 0 && (
                <Section key={title} title={title}>
                  <Cards cards={list} />
                </Section>
              ),
          )}
        </div>
      )}
      <p className="mt-8 px-1 text-xs text-muted">
        Dates are shown only when the source confirms them. Kitsu-only anime list just the next release; next seasons for anime come from AniList.
      </p>
    </div>
  )
}

const describe = (r: Row) => (r.name && r.name !== r.label ? `${r.label} · ${r.name}` : r.label)

function Cards({ cards }: { cards: Card[] }) {
  return (
    <ul className="poster-grid">
      {cards.map(({ row: r, more }) => (
        <li key={r.key} className="group min-w-0">
          <Link to={`/title/${r.t.id}`} className="block rounded-xl">
            <div className="overflow-hidden rounded-xl shadow-card">
              <Poster poster={r.t.poster} source={r.t.source} title={r.t.title} mediaType={r.t.mediaType} className="can-hover:group-hover:[&_img]:scale-[1.04]" />
            </div>
            <div className="mt-2.5 space-y-0.5 px-0.5">
              <h3 className="line-clamp-2 text-sm font-medium leading-snug transition-colors group-hover:text-accent-text">{r.t.title}</h3>
              <p className="truncate text-xs text-fg-2" title={describe(r)}>
                {r.label}
              </p>
              {r.date && (
                <time dateTime={r.date} title={formatRelease(r.date)} className="block text-xs">
                  <span className="block font-medium text-accent-text">{timeAgo(r.date)}</span>
                  <span className="block text-muted">{formatShortRelease(r.date)}</span>
                </time>
              )}
              {(!r.date || r.status.startsWith('Released')) && <p className="text-xs text-muted">{r.status}</p>}
            </div>
          </Link>
          {more.length > 0 && (
            <details className="mt-1 px-0.5 text-xs">
              <summary className="cursor-pointer rounded font-medium text-accent-text">+{more.length} more</summary>
              <ul className="mt-1 space-y-1 text-muted">
                {more.map((m) => (
                  <li key={m.key}>
                    <span className="text-fg-2">{m.label}</span>
                    <span className="block">{m.date ? formatShortRelease(m.date) : 'Date TBA'}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}
