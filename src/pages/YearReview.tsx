import { CalendarHeart, CircleCheck, Clapperboard, Film, Flame, Library, Share2, Trophy } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, PageHeader, PosterGridSkeleton, Section, StatCard } from '../components/cards'
import { Poster } from '../components/Poster'
import { listAllHistory } from '../lib/db'
import { errMsg } from '../lib/format'
import { formatDay, MONTHS, reviewYears, yearInReview } from '../lib/review'
import type { HistoryEntry } from '../lib/types'
import { useLibrary } from '../state/library'

/** Your year in WatchTrack, worked out on this device from the watch history. Nothing about it leaves the device. */
export function YearReviewPage() {
  const lib = useLibrary()
  const [params, setParams] = useSearchParams()
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [sharing, setSharing] = useState(false)
  const [thisYear] = useState(() => new Date().getFullYear())

  useEffect(() => {
    let live = true
    listAllHistory()
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory([]))
    return () => {
      live = false
    }
  }, [lib.historyVersion])

  const years = useMemo(() => (history ? reviewYears(history) : []), [history])
  const asked = Number(params.get('year'))
  const year = years.includes(asked) ? asked : (years[0] ?? thisYear)
  const review = useMemo(() => (history ? yearInReview(lib.titles, history, year) : null), [lib.titles, history, year])

  if (!review || lib.loading) return <PosterGridSkeleton />

  const watched = review.episodes + review.movies
  if (!watched)
    return (
      <>
        <PageHeader title="Year in review" />
        <EmptyState
          icon={CalendarHeart}
          title="Nothing logged yet"
          body="Mark episodes and movies watched, and your year in review fills in here. It's worked out on this device and never uploaded."
          action={
            <Link to="/" className="btn-primary">
              Go to Home
            </Link>
          }
        />
      </>
    )

  async function share() {
    setSharing(true)
    try {
      const { shareReviewImage } = await import('../lib/reviewImage')
      await shareReviewImage(review!)
    } catch (err) {
      toast.error("Couldn't make the image", { description: errMsg(err) })
    } finally {
      setSharing(false)
    }
  }

  const peak = Math.max(1, ...review.byMonth)
  const streak = review.longestStreak
  // One watch isn't a "biggest day".
  const bigDay = review.biggestDay && review.biggestDay.count > 1 ? review.biggestDay : null
  return (
    <div className="space-y-8">
      <PageHeader
        title={`Your ${year} in review`}
        subtitle="Worked out on this device from what you logged in WatchTrack. Nothing is uploaded."
        action={
          <button type="button" className="btn-primary" onClick={() => void share()} disabled={sharing}>
            <Share2 className="size-4" aria-hidden /> {sharing ? 'Making image…' : 'Share image'}
          </button>
        }
      />

      {years.length > 1 && (
        <nav aria-label="Year" className="flex flex-wrap gap-2">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={y === year}
              className={y === year ? 'btn-primary min-h-9 px-3' : 'btn-secondary min-h-9 px-3'}
              onClick={() => setParams(y === years[0] ? {} : { year: String(y) }, { replace: true })}
            >
              {y}
            </button>
          ))}
        </nav>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Episodes" value={review.episodes} icon={Clapperboard} />
        <StatCard label="Movies" value={review.movies} icon={Film} tone="bg-info/15 text-info" />
        <StatCard label="Titles" value={review.titles} icon={Library} tone="bg-warn/15 text-warn" />
        <StatCard label="Completed" value={review.completed} icon={CircleCheck} tone="bg-success/15 text-success" />
      </div>

      <Section title="Month by month">
        <div className="card p-4">
          <ol className="flex h-40 items-end gap-1.5 sm:gap-3" aria-label="Watches per month">
            {review.byMonth.map((n, i) => (
              <li key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" aria-label={`${MONTHS[i]}: ${n}`}>
                <span className="text-[11px] tabular-nums text-muted" aria-hidden>
                  {n || ''}
                </span>
                <span
                  aria-hidden
                  className={`w-full rounded-md ${i === review.busiestMonth?.month ? 'bg-accent' : 'bg-accent-soft'}`}
                  style={{ height: n ? `${Math.max(6, (n / peak) * 100)}%` : '3px' }}
                />
                <span className="text-xs text-muted" aria-hidden>
                  {MONTHS[i][0]}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Highlight icon={Flame} label="Longest streak" value={streak ? `${streak.days} day${streak.days === 1 ? '' : 's'}` : '—'} hint={streak && streak.days > 1 ? `${formatDay(streak.from)} – ${formatDay(streak.to)}` : undefined} />
        <Highlight icon={CalendarHeart} label="Busiest month" value={review.busiestMonth ? MONTHS[review.busiestMonth.month] : '—'} hint={review.busiestMonth ? `${review.busiestMonth.count} watched` : undefined} />
        <Highlight icon={Trophy} label="Biggest day" value={bigDay ? formatDay(bigDay.day) : '—'} hint={bigDay ? `${bigDay.count} watched` : 'No day with more than one'} />
      </div>

      {review.top.length > 0 && (
        <Section title="Most watched">
          <ol className="card divide-y divide-line">
            {review.top.map((t, i) => {
              const title = lib.byId(t.titleId)
              return (
                <li key={t.titleId}>
                  <Link to={`/title/${t.titleId}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                    <span className="w-5 text-center text-sm font-semibold text-muted tabular-nums">{i + 1}</span>
                    <Poster poster={title?.poster ?? null} source={title?.source ?? null} title={t.title} mediaType={t.mediaType} className="w-10 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                    <span className="text-sm text-muted tabular-nums">
                      {t.count} {t.mediaType === 'movie' ? 'time' : 'episode'}
                      {t.count === 1 ? '' : 's'}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </Section>
      )}
    </div>
  )
}

function Highlight({ icon: Icon, label, value, hint }: { icon: typeof Flame; label: string; value: string; hint?: string }) {
  return (
    <div className="card flex items-start gap-3 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted">{label}</span>
        <span className="block truncate font-semibold">{value}</span>
        {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
      </span>
    </div>
  )
}
