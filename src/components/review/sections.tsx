import { CalendarHeart, CalendarRange, CircleCheckBig, Clapperboard, Coffee, Film, Flag, Flame, Hourglass, Info, Library, Medal, Milestone, Minus, Quote, Repeat, Sparkles, Timer, TrendingDown, TrendingUp, Trophy, Tv, type LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatDay, percentChange, RUNTIME_MINUTES, toHours, WEEKDAYS, type Comparison, type Moment, type PeriodStats, type YearReview } from '../../lib/review'
import { PERSONALITY_RULES, type Insight, type Personality, type PersonalityId } from '../../lib/reviewStory'
import type { Title } from '../../lib/types'
import { Poster } from '../Poster'
import { MonthChart, WeekdayChart } from './charts'

const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`
const hoursLabel = (minutes: number) => `${Math.round(toHours(minutes)).toLocaleString()}`

/** One chapter of the review: a numbered eyebrow, a heading, and its own content. Rises in as it scrolls into view. */
export function Chapter({ n, eyebrow, title, intro, children, className = '' }: { n: number; eyebrow: string; title: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`chapter-${n}`} className={`review-rise min-w-0 space-y-4 ${className}`}>
      <header className="space-y-1">
        <p className="eyebrow flex items-center gap-2">
          <span className="tabular-nums text-accent-text">{String(n).padStart(2, '0')}</span>
          <span aria-hidden className="h-px w-6 bg-line" />
          {eyebrow}
        </p>
        <h2 id={`chapter-${n}`} className="text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h2>
        {intro && <p className="max-w-2xl text-sm text-muted">{intro}</p>}
      </header>
      {children}
    </section>
  )
}

// ---------- 1. Your Year in WatchTrack ----------

export function Intro({ review: r, years, year, onYear }: { review: YearReview; years: number[]; year: number; onYear: (y: number) => void }) {
  const s = r.stats
  const headline = s.episodes >= s.movies ? { n: s.episodes, what: s.episodes === 1 ? 'episode' : 'episodes' } : { n: s.movies, what: s.movies === 1 ? 'movie' : 'movies' }
  const other = s.episodes >= s.movies ? (s.movies ? `and ${plural(s.movies, 'movie')}` : '') : s.episodes ? `and ${plural(s.episodes, 'episode')}` : ''
  const h = toHours(s.minutes)
  return (
    <header className="review-rise relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_80%_at_100%_0%,var(--glow),transparent_70%),radial-gradient(35%_55%_at_0%_100%,color-mix(in_oklab,var(--info)_10%,transparent),transparent_70%)]" />
      <div className="relative space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow text-accent-text">Your year in WatchTrack</p>
          {years.length > 1 && (
            <div role="group" aria-label="Choose a year" className="flex flex-wrap gap-1.5">
              {years.map((y) => (
                <button key={y} type="button" className="chip" aria-pressed={y === year} onClick={() => onYear(y)}>
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {r.inProgress ? `${r.year}, so far` : `Your ${r.year}`}
          </h1>
          <p className="mt-4 text-lg text-fg-2 sm:text-xl">
            You watched{' '}
            <span className="text-5xl font-bold tracking-tight text-accent-text tabular-nums sm:text-7xl">{headline.n.toLocaleString()}</span> {headline.what}
            {other && <> {other}</>}.
          </p>
          {h >= 1 && (
            <p className="mt-2 text-sm text-muted">
              That's about {Math.round(h).toLocaleString()} hours{h >= 24 ? `, or ${(h / 24).toFixed(1)} days` : ''} in front of a screen.
              <span className="sr-only"> Estimated from typical episode and movie lengths.</span>
            </p>
          )}
        </div>
        {r.coverage.startedThisYear && (
          <p className="flex items-start gap-2 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> You started logging on {formatDay(r.coverage.from, true)}, so this covers the year from then.
          </p>
        )}
      </div>
    </header>
  )
}

// ---------- 2. Your Watching Journey ----------

function Tile({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className="card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <span className={`flex size-9 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
        <p className="text-sm text-fg-2">{label}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
      </div>
    </div>
  )
}

export function Journey({ review: r }: { review: YearReview }) {
  const s = r.stats
  const mix = [r.animeEpisodes && `${r.animeEpisodes.toLocaleString()} anime`, r.tvEpisodes && `${r.tvEpisodes.toLocaleString()} TV`].filter(Boolean).join(' · ')
  return (
    <Chapter n={2} eyebrow="Your watching journey" title="Everything you watched">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Tv} label="Episodes" value={s.episodes.toLocaleString()} hint={[mix, r.specials ? `${r.specials} specials` : ''].filter(Boolean).join(' · ') || undefined} tone="bg-accent-soft text-accent-text" />
        <Tile icon={Film} label="Movies" value={s.movies.toLocaleString()} hint={r.movieRewatches ? `${plural(r.distinctMovies, 'different movie')}` : undefined} tone="bg-info/15 text-info" />
        <Tile icon={Hourglass} label="Hours, estimated" value={`≈${hoursLabel(s.minutes)}`} hint={toHours(s.minutes) >= 24 ? `${(toHours(s.minutes) / 24).toFixed(1)} days of watching` : undefined} tone="bg-warn/15 text-warn" />
        <Tile icon={Library} label="Titles" value={r.titles.toLocaleString()} hint={r.seriesWatched && r.distinctMovies ? `${plural(r.seriesWatched, 'series', 'series')} · ${plural(r.distinctMovies, 'movie')}` : undefined} tone="bg-success/15 text-success" />
      </div>
      <dl className="card grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
        <Fact label="Days you watched" value={s.activeDays.toLocaleString()} />
        <Fact label="Per watching day" value={r.perActiveDay.toFixed(1)} />
        <Fact label="Per month" value={r.perMonth === null ? '—' : r.perMonth.toFixed(r.perMonth < 10 ? 1 : 0)} />
        <Fact label="Series completed" value={s.completedSeries.toLocaleString()} />
      </dl>
    </Chapter>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

// ---------- 3. Your Watching Calendar ----------

export function Calendar({ review: r }: { review: YearReview }) {
  return (
    <Chapter n={3} eyebrow="Your watching calendar" title="Month by month" intro="Hover or tap a month to see what you were watching.">
      <div className="card p-4 sm:p-6">
        <MonthChart review={r} />
      </div>
    </Chapter>
  )
}

// ---------- 4. Your Watching Personality ----------

const PERSONALITY_ICON: Record<PersonalityId, LucideIcon> = {
  marathon: Timer,
  binge: Flame,
  completionist: CircleCheckBig,
  weekend: CalendarRange,
  consistent: Repeat,
  anime: Sparkles,
  movies: Film,
  easygoing: Coffee,
}

export function PersonalityCard({ review: r, personality }: { review: YearReview; personality: { main: Personality; also: Personality[] } | null }) {
  return (
    <Chapter n={4} eyebrow="Your watching personality" title={personality ? personality.main.name : 'Still getting to know you'}>
      {personality ? (
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="relative overflow-hidden rounded-3xl border border-accent-line bg-accent-soft p-6 sm:p-8">
            <PersonalityIcon id={personality.main.id} />
            <p className="mt-5 text-lg font-medium text-fg">{personality.main.tagline}</p>
            <p className="mt-2 text-sm text-fg-2">{personality.main.reason}</p>
            {personality.also.length > 0 && (
              <div className="mt-5">
                <p className="eyebrow">Also a bit of</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {personality.also.map((p) => (
                    <li key={p.id} title={p.reason} className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-surface/60 px-3 py-1 text-xs font-medium text-fg-2">
                      <TraitIcon id={p.id} />
                      {p.name.replace(/^The /, '')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="card space-y-4 p-5">
            <div>
              <p className="text-sm font-medium">When you watch</p>
              <p className="text-xs text-muted">
                {r.favouriteWeekday ? `${WEEKDAYS[r.favouriteWeekday.weekday]}s lead, with ${Math.round(r.favouriteWeekday.share * 100)}% of your watching.` : 'Spread across the week, with no clear favourite day.'}
              </p>
            </div>
            <WeekdayChart review={r} />
            <details className="group text-xs text-muted">
              <summary className="cursor-pointer font-medium text-fg-2 hover:text-fg">How this works</summary>
              <p className="mt-2">Worked out from your own numbers with fixed rules. The highest score wins, measured as how far past its threshold you are:</p>
              <ul className="mt-2 space-y-1">
                {PERSONALITY_RULES.map((rule) => (
                  <li key={rule.id}>
                    <span className="font-medium text-fg-2">{rule.name}</span>: {rule.rule}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      ) : (
        <div className="card p-6 text-sm text-muted">Log at least 10 watches on 3 different days and your watching personality appears here.</div>
      )}
    </Chapter>
  )
}

function TraitIcon({ id }: { id: PersonalityId }) {
  const Icon = PERSONALITY_ICON[id]
  return <Icon className="size-3.5 text-accent-text" aria-hidden />
}

function PersonalityIcon({ id }: { id: PersonalityId }) {
  const Icon = PERSONALITY_ICON[id]
  return (
    <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-[0_12px_30px_-12px_var(--accent-strong)]">
      <Icon className="size-7" aria-hidden />
    </span>
  )
}

// ---------- 5. Your Biggest Moments ----------

const MOMENT_ICON: Record<Moment['kind'], LucideIcon> = { first: Flag, milestone: Milestone, streak: Flame, day: Trophy, week: CalendarHeart, binge: Timer, last: Clapperboard }

export function Moments({ review: r }: { review: YearReview }) {
  return (
    <Chapter n={5} eyebrow="Your biggest moments" title="The year, in highlights">
      <ol className="card relative space-y-0 p-4 sm:p-6">
        {r.moments.map((m, i) => {
          const Icon = MOMENT_ICON[m.kind]
          const big = m.kind === 'streak' || m.kind === 'binge' || m.kind === 'day'
          return (
            <li key={`${m.kind}-${m.day}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
              {i < r.moments.length - 1 && <span aria-hidden className="absolute top-10 bottom-0 left-[1.1rem] w-px bg-line" />}
              <span className={`relative flex size-9 shrink-0 items-center justify-center rounded-full ${big ? 'bg-accent text-on-accent' : 'bg-surface-2 text-accent-text ring-1 ring-line'}`}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 pt-1">
                <p className="text-xs text-muted">
                  <time dateTime={m.day}>{formatDay(m.day)}</time>
                </p>
                <p className="font-semibold">{m.title}</p>
                <p className="text-sm text-fg-2 wrap-anywhere">{m.detail}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </Chapter>
  )
}

// ---------- 6. Your Top 5 ----------

export function Top5({ review: r, byId }: { review: YearReview; byId: (id: string) => Title | undefined }) {
  if (!r.top.length) return null
  const max = r.top[0].count
  return (
    <Chapter n={6} eyebrow={`Your top ${r.top.length}`} title="What you watched most">
      <ol className="space-y-2">
        {r.top.map((t, i) => {
          const title = byId(t.titleId)
          const first = i === 0
          return (
            <li key={t.titleId}>
              <Link to={`/title/${t.titleId}`} className={`card-link flex items-center gap-3 p-3 sm:gap-4 ${first ? 'sm:p-4' : ''}`}>
                <span className={`w-6 shrink-0 text-center font-semibold tabular-nums ${first ? 'text-2xl text-accent-text' : 'text-lg text-muted'}`}>{i + 1}</span>
                <Poster poster={title?.poster ?? null} source={title?.source ?? null} title={t.title} mediaType={t.mediaType} className={`shrink-0 rounded-lg ${first ? 'w-14 sm:w-16' : 'w-10'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${first ? 'text-base sm:text-lg' : 'text-sm'}`}>{t.title}</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <span className="review-bar block h-full origin-left rounded-full bg-accent" style={{ width: `${(t.count / max) * 100}%`, '--rise-delay': `${i * 60}ms` } as CSSProperties} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {plural(t.count, t.mediaType === 'movie' ? 'watch' : 'episode', t.mediaType === 'movie' ? 'watches' : 'episodes')} · ≈{hoursLabel(t.minutes)} h
                    {t.completed && <span className="ml-1.5 font-medium text-success">· Completed</span>}
                  </p>
                </div>
              </Link>
            </li>
          )
        })}
      </ol>
    </Chapter>
  )
}

// ---------- 7. Year Compared ----------

function Delta({ current, previous, fair, unit = '' }: { current: number; previous: number; fair: boolean; unit?: string }) {
  const change = fair ? percentChange(current, previous) : null
  if (change === null) return <span className="text-xs text-muted">{current - previous > 0 ? '+' : ''}{(current - previous).toLocaleString()}{unit}</span>
  const Icon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus
  // Watching less isn't a failure, so a fall is neutral, not red.
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${change > 0 ? 'text-success' : 'text-muted'}`}>
      <Icon className="size-3.5" aria-hidden />
      {change > 0 ? '+' : ''}
      {change}%
    </span>
  )
}

export function Compared({ review: r }: { review: YearReview }) {
  const c = r.comparison
  return (
    <Chapter
      n={7}
      eyebrow="Year compared"
      title={c ? `${r.year} against ${c.previousYear}` : 'Your first year in WatchTrack'}
      intro={c ? compareIntro(c) : `Nothing was logged before ${r.year}, so there's no earlier year to compare with. Next year, this is where you'll see how ${r.year} measures up.`}
    >
      {c && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-4 py-3 font-medium sm:px-5">
                  <span className="sr-only">Measure</span>
                </th>
                <th scope="col" className="px-2 py-3 text-right font-medium">
                  {c.previousYear}
                </th>
                <th scope="col" className="px-2 py-3 text-right font-medium text-fg">
                  {r.year}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium sm:px-5">
                  Change
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              <Row label="Episodes" get={(s) => s.episodes} c={c} />
              <Row label="Movies" get={(s) => s.movies} c={c} />
              <Row label="Hours, estimated" get={(s) => Math.round(toHours(s.minutes))} c={c} />
              <Row label="Days you watched" get={(s) => s.activeDays} c={c} />
              <Row label="Series completed" get={(s) => s.completedSeries} c={c} />
              <Row label="Longest streak (days)" get={(s) => s.longestStreak?.days ?? 0} c={c} />
            </tbody>
          </table>
        </div>
      )}
    </Chapter>
  )
}

function compareIntro(c: Comparison): string {
  const dates = `${formatDay(c.previousFrom)} – ${formatDay(c.previousTo)}`
  if (!c.fair) return `You started logging on ${formatDay(c.previousFrom, true)}, so there are only a few days to compare: the numbers are shown, but not as percentages.`
  if (c.narrowed) return `Compared over ${dates} in both years: you started logging on ${formatDay(c.previousFrom, true)}, so earlier dates aren't counted against you.`
  if (c.toToday) return `Compared over ${dates} in both years, since this year isn't over yet.`
  return 'Both whole years, side by side.'
}

function Row({ label, get, c }: { label: string; get: (s: PeriodStats) => number; c: Comparison }) {
  const prev = get(c.previous)
  const cur = get(c.current)
  return (
    <tr>
      <th scope="row" className="px-4 py-3 text-left font-normal text-fg-2 sm:px-5">
        {label}
      </th>
      <td className="px-2 py-3 text-right text-muted tabular-nums">{prev.toLocaleString()}</td>
      <td className="px-2 py-3 text-right font-semibold tabular-nums">{cur.toLocaleString()}</td>
      <td className="px-4 py-3 text-right sm:px-5">
        <Delta current={cur} previous={prev} fair={c.fair} />
      </td>
    </tr>
  )
}

// ---------- 8. Looking Back ----------

export function LookingBack({ summary, insights, children }: { summary: string; insights: Insight[]; children?: ReactNode }) {
  return (
    <Chapter n={8} eyebrow="Looking back" title="Your year, in a few lines">
      <figure className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <Quote className="size-8 text-accent-line" aria-hidden />
        <blockquote className="mt-3 text-lg leading-relaxed text-fg sm:text-xl">{summary}</blockquote>
      </figure>
      {insights.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {insights.map((i, n) => (
            <li key={i.id} className="review-rise card flex items-start gap-3 p-4 text-sm" style={{ '--rise-delay': `${n * 50}ms` } as CSSProperties}>
              <Medal className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
              <span className="text-fg-2">{i.text}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </Chapter>
  )
}

/** The small print: what's counted, what's estimated, and anything that was left out. */
export function DataNotes({ review: r, undated, duplicates }: { review: YearReview; undated: number; duplicates: number }) {
  return (
    <aside className="space-y-1 rounded-2xl border border-dashed border-line p-4 text-xs text-muted">
      <p className="font-medium text-fg-2">About these numbers</p>
      <p>Worked out on this device from what you logged in WatchTrack. Nothing is uploaded or sent anywhere.</p>
      <p>
        Hours are estimates from typical lengths (anime {RUNTIME_MINUTES.anime} min, TV {RUNTIME_MINUTES.tv} min, movies {RUNTIME_MINUTES.movie} min), since WatchTrack doesn't store runtimes.
      </p>
      <p>Only episodes you marked watched count. {r.corrections ? `Your ${plural(r.corrections, 'manual progress change')} this year ${r.corrections === 1 ? "isn't" : "aren't"} counted as watches.` : 'Jumping your progress ahead isn’t counted as watching.'}</p>
      {(undated > 0 || duplicates > 0) && (
        <p>
          {undated > 0 && `${plural(undated, 'entry', 'entries')} with an unreadable date ${undated === 1 ? 'was' : 'were'} left out. `}
          {duplicates > 0 && `${plural(duplicates, 'double-logged watch', 'double-logged watches')} (the same episode within two minutes) ${duplicates === 1 ? 'was' : 'were'} counted once.`}
        </p>
      )}
    </aside>
  )
}
