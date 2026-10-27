import { CalendarClock, CalendarX, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader } from '../components/cards'
import { Poster } from '../components/Poster'
import { RELEASED, upcomingOf, useAlerts } from '../lib/alerts'
import { formatRelease, isPast, timeAgo } from '../lib/format'
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

const RECENT_DAYS = 30

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
        const label =
          r.kind === 'season'
            ? r.season != null
              ? `Season ${r.season}`
              : 'Next season'
            : r.episode == null
              ? 'Next episode'
              : seasonal && r.season != null
                ? `S${r.season} · E${r.episode}`
                : `Episode ${r.episode}`
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
  const dated = filter === 'released' ? shown : shown.filter((r) => r.date).sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!))
  const tba = filter === 'released' ? [] : shown.filter((r) => !r.date)
  const linked = lib.titles.some(canRefresh)

  return (
    <div>
      <PageHeader
        title="Upcoming"
        subtitle="Confirmed seasons and episodes for shows in your library"
        action={
          linked && (
            <button type="button" className="btn-secondary" disabled={cycle} onClick={() => void refreshAll()}>
              <RefreshCw className={`size-4 ${cycle ? 'animate-spin' : ''}`} aria-hidden /> {cycle ? 'Checking…' : 'Check now'}
            </button>
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
        <div className="space-y-2" aria-busy aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-20 rounded-2xl" />
          ))}
        </div>
      ) : !linked ? (
        <EmptyState
          icon={CalendarX}
          title="No shows to check yet"
          body="Release dates come from TVmaze, Kitsu/AniList and TMDB. Add a show through search so WatchTrack knows which one it is."
        />
      ) : !dated.length && !tba.length ? (
        <EmptyState
          icon={CalendarClock}
          title={filter === 'released' ? 'Nothing new in the last 30 days' : 'Nothing scheduled yet'}
          body={
            filter === 'released'
              ? 'Episodes and seasons that come out for your shows will be listed here.'
              : "None of your shows has a confirmed upcoming season or episode right now. WatchTrack checks each show once a day while it's open."
          }
        />
      ) : (
        <div className="space-y-8">
          {dated.length > 0 && <Rows rows={dated} />}
          {tba.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                Date TBA <span className="font-normal text-muted">· announced, no confirmed release date</span>
              </h2>
              <Rows rows={tba} />
            </section>
          )}
        </div>
      )}
      <p className="mt-8 px-1 text-xs text-muted">
        Dates are shown only when the source confirms them. Kitsu-only anime list just the next release; next seasons for anime come from AniList.
      </p>
    </div>
  )
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul className="card divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key}>
          <Link to={`/title/${r.t.id}`} className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2 sm:px-4">
            <Poster poster={r.t.poster} source={r.t.source} title={r.t.title} mediaType={r.t.mediaType} className="w-11 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r.t.title}</p>
              <p className="truncate text-sm text-fg-2">
                {r.label}
                {r.name && r.name !== r.label && <span className="text-muted"> · {r.name}</span>}
              </p>
              <p className="text-xs text-muted">{r.status}</p>
            </div>
            {r.date && (
              <time dateTime={r.date} className="shrink-0 text-right text-xs">
                <span className="block font-medium text-accent-text">{timeAgo(r.date)}</span>
                <span className="block text-muted">{formatRelease(r.date)}</span>
              </time>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}
