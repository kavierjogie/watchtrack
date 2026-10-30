import { CalendarClock, CalendarDays, CalendarPlus, CalendarX, ChevronLeft, ChevronRight, List, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, PageHeader, Section } from '../components/cards'
import { Poster } from '../components/Poster'
import { bucketDates, countdown, dayFrom, formatReleaseTime, formatShortRelease, RELEASE_BUCKETS, releaseBucket } from '../lib/format'
import { buildIcs } from '../lib/ics'
import { setPrefs, usePrefs } from '../lib/prefs'
import { canRefresh, useSyncState } from '../lib/sync'
import type { Title } from '../lib/types'
import { episodeCode, upcomingEpisodes, type UpcomingEpisode } from '../lib/upcoming'
import { useLibrary } from '../state/library'
import { useRefreshEpisodes } from '../state/useSync'

type Filter = 'all' | 'anime' | 'tv'
const FILTERS: [Filter, string][] = [
  ['all', 'All tracked shows'],
  ['anime', 'Anime'],
  ['tv', 'TV Shows'],
]

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

/** The clock, so an episode leaves the page when it airs and "Today" moves on at midnight, even if the app stays open. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return now
}

const groupByDay = (rows: UpcomingEpisode[]) => {
  const days = new Map<string, UpcomingEpisode[]>()
  for (const r of rows) days.set(r.day, [...(days.get(r.day) ?? []), r])
  return days
}

export function UpcomingPage() {
  const lib = useLibrary()
  const { refreshAll } = useRefreshEpisodes()
  const { cycle } = useSyncState()
  const { upcomingView: view } = usePrefs()
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('all')
  const [picked, setPicked] = useState<string | null>(null)

  // From the live library: marking an episode watched or removing a show updates this straight away.
  const rows = useMemo(() => upcomingEpisodes(lib.titles, now), [lib.titles, now])
  const shown = filter === 'all' ? rows : rows.filter((r) => r.t.mediaType === filter)
  const days = groupByDay(shown)
  // A picked day that has aired, or been filtered away, lets go by itself.
  const day = picked && days.has(picked) ? picked : null
  const linked = lib.titles.some(canRefresh)
  const pick = (d: string) => setPicked(d === day ? null : d)

  return (
    <div>
      <PageHeader
        title="Upcoming"
        subtitle="New episodes of the shows in your library"
        action={
          linked && (
            <div className="flex flex-wrap gap-2">
              {rows.length > 0 && (
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

      {lib.loading ? (
        <div className="space-y-3" aria-busy aria-label="Loading">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
      ) : !linked ? (
        <EmptyState
          icon={CalendarX}
          title="No shows to check yet"
          body="Add a TV show or anime through search so WatchTrack knows which one it is. Its new episodes will appear here."
          action={
            <Link to="?add=1" className="btn-primary">
              Add a show
            </Link>
          }
        />
      ) : !rows.length ? (
        <EmptyState
          icon={CalendarClock}
          title="No episodes scheduled"
          body="None of your tracked shows has a scheduled episode right now. Check back later: WatchTrack looks for new dates each day while it's open."
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
              {FILTERS.map(([v, l]) => (
                <button key={v} type="button" className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label="View">
              <button type="button" className="chip" aria-pressed={view !== 'calendar'} onClick={() => setPrefs({ upcomingView: 'list' })}>
                <List className="size-3.5" aria-hidden /> List
              </button>
              <button type="button" className="chip" aria-pressed={view === 'calendar'} onClick={() => setPrefs({ upcomingView: 'calendar' })}>
                <CalendarDays className="size-3.5" aria-hidden /> Calendar
              </button>
            </div>
          </div>

          {view === 'calendar' ? (
            <MonthView rows={shown} days={days} day={day} now={now} onPick={pick} />
          ) : (
            <>
              <WeekStrip days={days} day={day} now={now} onPick={pick} />
              {day ? (
                <DaySection day={day} rows={days.get(day)!} now={now} onClear={() => setPicked(null)} />
              ) : !shown.length ? (
                <NoneOfType filter={filter} onClear={() => setFilter('all')} />
              ) : (
                <div className="space-y-8">
                  {RELEASE_BUCKETS.map((b) => {
                    const list = shown.filter((r) => releaseBucket(r.airdate, now) === b)
                    return (
                      list.length > 0 && (
                        <Section key={b} title={b} action={<span className="shrink-0 text-xs text-muted sm:text-sm">{bucketDates(b, now)}</span>}>
                          <Episodes rows={list} now={now} />
                        </Section>
                      )
                    )
                  })}
                </div>
              )}
            </>
          )}
          <p className="mt-8 px-1 text-xs text-muted">
            Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ')}). "Time TBA" means the source has only given the day so far. Dates can move if a show is postponed.
          </p>
        </>
      )}
    </div>
  )
}

function NoneOfType({ filter, onClear }: { filter: Filter; onClear: () => void }) {
  return (
    <EmptyState
      icon={CalendarClock}
      title={filter === 'anime' ? 'No anime episodes scheduled' : 'No TV episodes scheduled'}
      body="Check back later, or see everything you're tracking."
      action={
        <button type="button" className="btn-secondary" onClick={onClear}>
          Show all tracked shows
        </button>
      }
    />
  )
}

function DaySection({ day, rows, now, onClear }: { day: string; rows: UpcomingEpisode[]; now: number; onClear?: () => void }) {
  return (
    <Section
      title={formatShortRelease(day, now)}
      action={
        onClear && (
          <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={onClear}>
            Show all
          </button>
        )
      }
    >
      <Episodes rows={rows} now={now} />
    </Section>
  )
}

function Episodes({ rows, now }: { rows: UpcomingEpisode[]; now: number }) {
  return (
    <ul className="grid min-w-0 gap-3 xl:grid-cols-2">
      {rows.map((r) => (
        <EpisodeCard key={r.key} r={r} now={now} />
      ))}
    </ul>
  )
}

function EpisodeCard({ r, now }: { r: UpcomingEpisode; now: number }) {
  const today = r.day === dayFrom(now)
  const code = episodeCode(r)
  const name = r.name ?? (r.kind === 'season' ? 'Season premiere' : null)
  const time = formatReleaseTime(r.airdate)
  return (
    <li className="min-w-0">
      <Link
        to={`/title/${r.t.id}`}
        className={`card-link flex min-w-0 items-center gap-3 p-2.5 sm:gap-4 sm:p-3 ${today ? 'border-accent-line bg-[radial-gradient(90%_140%_at_0%_0%,var(--glow),transparent_70%)]' : ''}`}
      >
        <Poster poster={r.t.poster} source={r.t.source} title={r.t.title} mediaType={r.t.mediaType} className="w-12 shrink-0 rounded-lg sm:w-14" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold sm:text-base">{r.t.title}</h3>
            <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium first-letter:uppercase ${today ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2'}`}>
              {countdown(r.airdate, now)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm">
            <span className="font-semibold tabular-nums text-accent-text">{code}</span>
            {name && <span className="text-fg-2"> · {name}</span>}
          </p>
          <p className="mt-1 text-xs text-muted">
            <time dateTime={r.airdate}>
              {formatShortRelease(r.airdate, now)}
              {time && ` · ${time}`}
            </time>
            {!time && ' · Time TBA'}
          </p>
        </div>
      </Link>
    </li>
  )
}

/** A date with its episodes marked. Days with nothing on them can't be picked. */
function DayCell({ day, label, count, selected, now, onPick, tall = false }: { day: string; label: string; count: number; selected: boolean; now: number; onPick: (d: string) => void; tall?: boolean }) {
  const today = day === dayFrom(now)
  const name = `${formatShortRelease(day, now)}, ${count} episode${count === 1 ? '' : 's'}`
  return (
    <button
      type="button"
      disabled={!count}
      aria-pressed={selected}
      aria-label={name}
      onClick={() => onPick(day)}
      className={`press flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-0.5 ${tall ? 'py-2' : 'min-h-12 py-1.5'} ${
        selected ? 'border-accent bg-accent-soft' : today ? 'border-accent-line' : 'border-transparent'
      } ${count ? 'hover:bg-surface-2' : 'text-faint'}`}
    >
      <span className={`text-sm tabular-nums ${today ? 'font-semibold text-accent-text' : count ? 'font-medium' : ''}`}>{label}</span>
      <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
        {Array.from({ length: Math.min(count, 3) }, (_, i) => (
          <span key={i} className="size-1.5 rounded-full bg-accent" />
        ))}
      </span>
    </button>
  )
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' })
const weekdayOf = (day: string) => WEEKDAY.format(new Date(`${day}T00:00:00Z`))

/** The next seven days at a glance. A grid, not a scroller: all seven always fit. */
function WeekStrip({ days, day, now, onPick }: { days: Map<string, UpcomingEpisode[]>; day: string | null; now: number; onPick: (d: string) => void }) {
  return (
    <div className="card mb-6 grid grid-cols-7 gap-0.5 p-1.5 sm:gap-1 sm:p-2" role="group" aria-label="Next seven days">
      {Array.from({ length: 7 }, (_, i) => {
        const d = dayFrom(now, i)
        return (
          <div key={d} className="flex min-w-0 flex-col text-center">
            <span className="truncate text-[11px] text-muted" aria-hidden>
              {weekdayOf(d)}
            </span>
            <DayCell day={d} label={String(Number(d.slice(8)))} count={days.get(d)?.length ?? 0} selected={d === day} now={now} onPick={onPick} />
          </div>
        )
      })}
    </div>
  )
}

function MonthView({ rows, days, day, now, onPick }: { rows: UpcomingEpisode[]; days: Map<string, UpcomingEpisode[]>; day: string | null; now: number; onPick: (d: string) => void }) {
  const [offset, setOffset] = useState(0)
  const today = new Date(now)
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const prefix = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`
  const last = rows.at(-1)?.day.slice(0, 7) ?? prefix
  const blanks = (first.getDay() + 6) % 7 // weeks start on Monday, as the list's do
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const inMonth = rows.filter((r) => r.day.startsWith(prefix))
  const picked = day?.startsWith(prefix) ? day : null

  return (
    <div className="space-y-6">
      <div className="card p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-semibold">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <div className="flex gap-1">
            <button type="button" className="icon-btn" disabled={offset === 0} aria-label="Previous month" onClick={() => setOffset(offset - 1)}>
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button type="button" className="icon-btn" disabled={prefix >= last} aria-label="Next month" onClick={() => setOffset(offset + 1)}>
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {/* 4 Jan 2027 is a Monday. */}
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="truncate pb-1 text-center text-[11px] text-muted" aria-hidden>
              {weekdayOf(`2027-01-${String(4 + i).padStart(2, '0')}`)}
            </span>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <span key={i} aria-hidden />
          ))}
          {Array.from({ length }, (_, i) => {
            const d = `${prefix}-${String(i + 1).padStart(2, '0')}`
            return <DayCell key={d} day={d} label={String(i + 1)} count={days.get(d)?.length ?? 0} selected={d === day} now={now} onPick={onPick} tall />
          })}
        </div>
      </div>

      {picked ? (
        <DaySection day={picked} rows={days.get(picked)!} now={now} onClear={() => onPick(picked)} />
      ) : inMonth.length ? (
        <div className="space-y-8">
          {[...groupByDay(inMonth)].map(([d, list]) => (
            <DaySection key={d} day={d} rows={list} now={now} />
          ))}
        </div>
      ) : (
        <p className="text-center text-sm text-muted">No episodes scheduled this month. Try the next one, or check back later.</p>
      )}
    </div>
  )
}
