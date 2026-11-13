import { ArrowDown, CalendarHeart, CalendarRange, CircleCheckBig, Clapperboard, Coffee, Compass, Film, Flag, Flame, Info, Medal, Milestone, Minus, Repeat, Share2, Sparkles, Timer, TrendingDown, TrendingUp, Trophy, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BINGE_EPISODES, formatDay, monthState, MONTHS, percentChange, RUNTIME_MINUTES, toHours, WEEKDAYS, type Comparison, type Moment, type PeriodStats, type YearReview } from '../../lib/review'
import { PERSONALITY_RULES, type Insight, type Personality, type PersonalityId, type Standout } from '../../lib/reviewStory'
import type { Title } from '../../lib/types'
import { Logo } from '../Logo'
import { Poster } from '../Poster'
import { MonthChart, WeekdayChart } from './charts'

const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`
const hoursOf = (minutes: number) => Math.round(toHours(minutes))
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The headline number is episodes, unless movies outnumber them (same rule as the share cards). */
function lead(r: YearReview) {
  const s = r.stats
  const ep = { n: s.episodes, unit: s.episodes === 1 ? 'episode' : 'episodes' }
  const mv = { n: s.movies, unit: s.movies === 1 ? 'movie' : 'movies' }
  return s.episodes >= s.movies ? { main: ep, other: mv } : { main: mv, other: ep }
}

/**
 * A number that counts up the first time it scrolls into view. Screen readers (and browsers without
 * IntersectionObserver, or with Reduce Motion) get the final value straight away.
 */
export function CountUp({ value, prefix = '' }: { value: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(value)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined' || reducedMotion() || value < 10) {
      setShown(value)
      return
    }
    setShown(0)
    let frame = 0
    let done = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return
      io.disconnect()
      // Frames can stall in a background tab: the true value always lands, whatever happens to the animation.
      done = window.setTimeout(() => setShown(value), 1200)
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 1000)
        setShown(Math.round(value * (1 - (1 - t) ** 3)))
        if (t < 1) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(done)
    }
  }, [value])
  return (
    <>
      <span ref={ref} aria-hidden className="tabular-nums">
        {prefix}
        {shown.toLocaleString()}
      </span>
      <span className="sr-only">
        {prefix}
        {value.toLocaleString()}
      </span>
    </>
  )
}

/** One chapter: a numbered eyebrow, a big heading, and its own composition. Rises in as it scrolls into view. */
export function Chapter({ n, eyebrow, title, intro, children, className = '' }: { n: number; eyebrow: string; title: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={`review-${n}`} aria-labelledby={`chapter-${n}`} className={`review-rise min-w-0 scroll-mt-20 space-y-8 lg:scroll-mt-8 lg:space-y-5 ${className}`}>
      <header className="max-w-3xl space-y-3 lg:space-y-2">
        <p className="eyebrow flex items-center gap-3 text-accent-text">
          <span className="tabular-nums">{String(n).padStart(2, '0')}</span>
          <span aria-hidden className="h-px w-8 bg-accent-line" />
          {eyebrow}
        </p>
        <h2 id={`chapter-${n}`} className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl xl:text-[2.5rem] xl:leading-tight">
          {title}
        </h2>
        {intro && <p className="text-base text-fg-2 sm:text-lg lg:text-base">{intro}</p>}
      </header>
      {children}
    </section>
  )
}

// ---------- Opening ----------

export function Intro({ review: r, headline, years, year, onYear }: { review: YearReview; headline: string; years: number[]; year: number; onYear: (y: number) => void }) {
  const { main, other } = lead(r)
  const begin = () => document.getElementById('review-1')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
  return (
    <header className="relative isolate flex min-h-[min(calc(100svh-7rem),52rem)] flex-col overflow-hidden px-5 pb-10 pt-6 sm:px-10 sm:pt-8 lg:min-h-0 lg:px-10 lg:pb-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <span className="review-orb absolute -right-24 -top-32 size-[34rem] rounded-full bg-[radial-gradient(circle,rgb(139_92_246/0.45),transparent_65%)] blur-2xl" />
        <span className="review-orb absolute -bottom-40 -left-32 size-[30rem] rounded-full bg-[radial-gradient(circle,rgb(103_232_249/0.14),transparent_65%)] blur-2xl [animation-delay:-8s]" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Logo className="size-7" />
        </span>
        {years.length > 1 && (
          <div role="group" aria-label="Choose a year" className="flex flex-wrap gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                aria-pressed={y === year}
                onClick={() => onYear(y)}
                className="press min-h-9 rounded-full px-3.5 text-sm font-medium text-fg-2 tabular-nums hover:text-fg aria-pressed:bg-accent aria-pressed:text-on-accent"
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="my-auto py-12 sm:py-16 lg:py-10">
        <p className="eyebrow text-accent-text">{r.inProgress ? 'Year in review · so far' : 'Year in review'}</p>
        <h1 className="mt-4">
          <span className="review-ink block text-[clamp(6rem,30vw,15rem)] font-extrabold leading-[0.82] lg:text-[clamp(6.5rem,9vw,9rem)] tracking-[-0.06em]">{r.year}</span>
          <span className="mt-6 block max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl lg:mt-4 lg:text-4xl">{headline}</span>
        </h1>
        <p className="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-fg-2 lg:mt-6">
          <span className="text-5xl font-bold tracking-tight text-fg sm:text-6xl lg:text-5xl">
            <CountUp value={main.n} />
          </span>
          <span className="text-xl font-medium text-fg sm:text-2xl lg:text-xl">{main.unit}</span>
          <span className="text-base text-muted sm:text-lg">
            {other.n ? `and ${plural(other.n, other.unit.replace(/s$/, ''))}, ` : ''}across {plural(r.titles, 'title')}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <button type="button" className="btn-primary min-h-12 rounded-full px-6 text-base lg:min-h-11 lg:text-sm" onClick={begin}>
          Start exploring <ArrowDown className="size-4" aria-hidden />
        </button>
        {r.coverage.startedThisYear && (
          <p className="flex max-w-md items-start gap-2 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> You started logging on {formatDay(r.coverage.from, true)}, so this covers the year from then.
          </p>
        )}
      </div>
    </header>
  )
}

// ---------- 1. The numbers ----------

export function Journey({ review: r }: { review: YearReview }) {
  const s = r.stats
  const { main, other } = lead(r)
  const mix = [r.animeEpisodes && `${r.animeEpisodes.toLocaleString()} anime`, r.tvEpisodes && `${r.tvEpisodes.toLocaleString()} TV`, r.specials && plural(r.specials, 'special')].filter(Boolean).join(' · ')
  const h = toHours(s.minutes)
  const rows: { label: string; value: number; prefix?: string; hint?: string }[] = [
    ...(other.n ? [{ label: other.unit[0].toUpperCase() + other.unit.slice(1), value: other.n, hint: other.unit.startsWith('movie') && r.movieRewatches ? plural(r.distinctMovies, 'different movie') : undefined }] : []),
    { label: 'Hours, estimated', value: Math.round(h), prefix: '≈', hint: h >= 24 ? `${(h / 24).toFixed(1)} days of watching` : undefined },
    { label: 'Titles', value: r.titles, hint: r.seriesWatched && r.distinctMovies ? `${plural(r.seriesWatched, 'series', 'series')} · ${plural(r.distinctMovies, 'movie')}` : undefined },
    { label: 'Series completed', value: s.completedSeries },
    { label: 'Days you watched', value: s.activeDays },
  ]
  return (
    <Chapter n={1} eyebrow="The numbers" title="Everything you watched">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-end lg:gap-12">
        <div className="min-w-0">
          <p className="text-lg text-fg-2 lg:text-base">You watched</p>
          <p className="review-ink -ml-1 text-[clamp(5rem,26vw,11rem)] font-extrabold leading-none tracking-[-0.05em] lg:text-[clamp(5rem,7vw,7rem)]">
            <CountUp value={main.n} />
          </p>
          <p className="mt-1 text-2xl font-semibold sm:text-3xl lg:text-2xl">{main.unit}</p>
          {main.unit.startsWith('ep') && mix && <p className="mt-2 text-sm text-muted">{mix}</p>}
        </div>
        <dl className="divide-y divide-white/8 border-y border-white/8 lg:grid lg:grid-cols-2 lg:gap-x-8 lg:divide-y-0 lg:border-b-0">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 py-4 lg:border-b lg:border-white/8 lg:py-3">
              <div className="min-w-0">
                <dt className="text-fg-2">{row.label}</dt>
                {row.hint && <p className="truncate text-xs text-muted">{row.hint}</p>}
              </div>
              <dd className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-3xl">
                <CountUp value={row.value} prefix={row.prefix} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 sm:grid-cols-4">
        <Fact label="Per watching day" value={r.perActiveDay.toFixed(1)} />
        <Fact label="Per month" value={r.perMonth === null ? '—' : r.perMonth.toFixed(r.perMonth < 10 ? 1 : 0)} />
        <Fact label="Weeks with a watch" value={`${r.activeWeeks} / ${r.coveredWeeks}`} />
        <Fact label="New series started" value={r.seriesStarted.toLocaleString()} />
      </dl>
    </Chapter>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0d0b24] px-4 py-3 sm:px-5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

// ---------- 2. Month by month ----------

export function Calendar({ review: r }: { review: YearReview }) {
  const tracked = r.byMonth.filter((_, i) => monthState(r, i) === 'tracked').length
  const active = r.byMonth.filter((m) => m.watches > 0).length
  const peak = r.busiestMonth
  return (
    <Chapter
      n={2}
      eyebrow="Your watching calendar"
      title="Month by month"
      intro={
        <>
          Active in {active} of {plural(tracked, 'month')}
          {r.inProgress ? ' so far' : ''}
          {peak && active > 1 ? `, peaking in ${MONTHS[peak.month]}` : ''}. Hover or tap a month to see what you were watching.
        </>
      }
    >
      <div className="rounded-3xl border border-white/8 bg-white/[0.025] p-4 sm:p-8 lg:rounded-2xl lg:p-6">
        <MonthChart review={r} />
      </div>
    </Chapter>
  )
}

// ---------- 3. Personality ----------

const PERSONALITY_ICON: Record<PersonalityId, LucideIcon> = { marathon: Timer, binge: Flame, completionist: CircleCheckBig, weekend: CalendarRange, consistent: Repeat, anime: Sparkles, movies: Film, explorer: Compass, easygoing: Coffee }

export function PersonalityCard({ review: r, personality }: { review: YearReview; personality: { main: Personality; also: Personality[] } | null }) {
  if (!personality)
    return (
      <Chapter n={3} eyebrow="Your watching personality" title="Still getting to know you">
        <p className="rounded-3xl border border-dashed border-white/12 p-6 text-sm text-muted">Log at least 10 watches on 3 different days and your watching personality appears here.</p>
      </Chapter>
    )
  const Icon = PERSONALITY_ICON[personality.main.id]
  return (
    <Chapter n={3} eyebrow="Your watching personality" title="This year, you were…">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="relative overflow-hidden rounded-3xl border border-accent-line/70 bg-[linear-gradient(135deg,rgb(124_58_237/0.22),rgb(79_70_229/0.08)_55%,transparent)] p-6 sm:p-10 lg:rounded-2xl lg:p-7">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent lg:size-12 text-on-accent shadow-[0_12px_40px_-10px_var(--accent-strong)]">
            <Icon className="size-7 lg:size-6" aria-hidden />
          </span>
          <p className="review-ink mt-6 text-4xl font-extrabold tracking-tight text-balance sm:text-6xl lg:mt-5 lg:text-5xl">{personality.main.name}</p>
          <p className="mt-4 text-xl font-medium text-fg lg:mt-3 lg:text-lg">{personality.main.tagline}</p>
          <p className="mt-2 max-w-xl text-fg-2">{personality.main.reason}</p>
          {personality.also.length > 0 && (
            <div className="mt-6 lg:mt-5">
              <p className="eyebrow">Also a bit of</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {personality.also.map((p) => {
                  const I = PERSONALITY_ICON[p.id]
                  return (
                    <li key={p.id} title={p.reason} className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-white/5 px-3 py-1 text-xs font-medium text-fg-2">
                      <I className="size-3.5 text-accent-text" aria-hidden />
                      {p.name.replace(/^The /, '')}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-5 rounded-3xl border border-white/8 bg-white/[0.025] p-6 lg:rounded-2xl lg:p-5">
          <div>
            <p className="font-medium">When you watch</p>
            <p className="text-sm text-muted">
              {r.favouriteWeekday ? `${WEEKDAYS[r.favouriteWeekday.weekday]}s lead, with ${Math.round(r.favouriteWeekday.share * 100)}% of your watching.` : 'Spread across the week, with no clear favourite day.'}
            </p>
          </div>
          <WeekdayChart review={r} />
          <details className="text-xs text-muted">
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
    </Chapter>
  )
}

// ---------- 4. Records and moments ----------

const MOMENT_ICON: Record<Moment['kind'], LucideIcon> = { first: Flag, milestone: Milestone, streak: Flame, day: Trophy, week: CalendarHeart, binge: Timer, last: Clapperboard }

function Record({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`review-rise relative min-w-0 overflow-hidden rounded-3xl border border-white/8 bg-white/[0.03] p-6 sm:p-7 lg:rounded-2xl lg:p-5 ${className}`}>
      <p className="eyebrow">{label}</p>
      {children}
    </div>
  )
}

export function Moments({ review: r, byId }: { review: YearReview; byId: (id: string) => Title | undefined }) {
  const streak = r.stats.longestStreak
  const top = r.top[0]
  const activeMonths = r.byMonth.filter((m) => m.watches).length
  const topTitle = top && byId(top.titleId)
  const binge = r.biggestBinge && r.biggestBinge.count >= BINGE_EPISODES ? r.biggestBinge : null
  return (
    <Chapter n={4} eyebrow="Your records" title="The moments that stood out">
      <div className="grid grid-flow-dense gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {streak && streak.days >= 2 && (
          <Record label="Longest streak" className="lg:col-span-2">
            <p className="mt-3 flex items-baseline gap-3">
              <span className="review-ink text-7xl font-extrabold tracking-tight sm:text-8xl lg:text-6xl">
                <CountUp value={streak.days} />
              </span>
              <span className="text-xl font-medium lg:text-lg">days in a row</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {formatDay(streak.from)} – {formatDay(streak.to)}
            </p>
            <div aria-hidden className="mt-5 flex flex-wrap gap-1 lg:mt-4">
              {Array.from({ length: Math.min(streak.days, 30) }, (_, i) => (
                <span key={i} className="review-bar size-3 rounded-[4px] bg-linear-to-br from-accent to-[#67e8f9]" style={{ '--rise-delay': `${i * 20}ms` } as CSSProperties} />
              ))}
              {streak.days > 30 && <span className="ml-1 text-xs leading-3 text-muted">+{streak.days - 30}</span>}
            </div>
          </Record>
        )}
        {r.biggestDay && r.biggestDay.count >= 2 && (
          <Record label="Biggest day">
            <p className="mt-3 text-6xl font-extrabold tracking-tight lg:text-5xl">
              <CountUp value={r.biggestDay.count} />
            </p>
            <p className="mt-1 text-fg-2">watched in one day</p>
            <p className="text-sm text-muted">{formatDay(r.biggestDay.day, true)}</p>
          </Record>
        )}
        {r.busiestMonth && activeMonths > 1 && (
          <Record label="Most active month">
            <p className="review-ink mt-3 text-5xl font-extrabold tracking-tight lg:text-4xl xl:text-5xl">{MONTHS[r.busiestMonth.month]}</p>
            <p className="mt-2 text-fg-2">{plural(r.busiestMonth.count, 'watch', 'watches')}</p>
          </Record>
        )}
        {top && (
          <Record label="Most watched" className="sm:col-span-2">
            <Link to={`/title/${top.titleId}`} className="mt-4 flex items-center gap-4 rounded-2xl hover:opacity-90 lg:mt-3">
              <Poster poster={topTitle?.poster ?? null} source={topTitle?.source ?? null} title={top.title} mediaType={top.mediaType} className="w-16 shrink-0 rounded-lg lg:w-14" />
              <span className="min-w-0">
                <span className="line-clamp-2 text-xl font-semibold lg:text-lg">{top.title}</span>
                <span className="text-sm text-muted">
                  {plural(top.count, top.mediaType === 'movie' ? 'watch' : 'episode', top.mediaType === 'movie' ? 'watches' : 'episodes')}
                  {top.mediaType !== 'movie' && r.stats.episodes ? ` · ${Math.round((top.count / r.stats.episodes) * 100)}% of your episodes` : ''}
                </span>
              </span>
            </Link>
          </Record>
        )}
        {binge && (
          <Record label="Biggest binge" className="sm:col-span-2">
            <p className="mt-3 flex flex-wrap items-baseline gap-x-3">
              <span className="text-6xl font-extrabold tracking-tight lg:text-5xl">{binge.count}</span>
              <span className="text-lg text-fg-2">episodes of {binge.title}</span>
            </p>
            <p className="text-sm text-muted">{formatDay(binge.day, true)}</p>
          </Record>
        )}
      </div>

      <div>
        <p className="eyebrow mb-4 lg:mb-2">Along the way</p>
        <ol className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-8">
          {r.moments.map((m, i) => {
            const Icon = MOMENT_ICON[m.kind]
            const big = m.kind === 'streak' || m.kind === 'binge' || m.kind === 'day'
            return (
              <li key={`${m.kind}-${m.day}-${i}`} className="flex gap-4 border-b border-white/6 py-4 lg:gap-3 lg:py-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${big ? 'bg-accent text-on-accent' : 'bg-white/5 text-accent-text ring-1 ring-white/10'}`}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
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
      </div>
    </Chapter>
  )
}

// ---------- 5. Top five ----------

const countText = (t: YearReview['top'][number]) => plural(t.count, t.mediaType === 'movie' ? 'watch' : 'episode', t.mediaType === 'movie' ? 'watches' : 'episodes')

export function Top5({ review: r, byId }: { review: YearReview; byId: (id: string) => Title | undefined }) {
  if (!r.top.length) return null
  const [first, ...rest] = r.top
  const t1 = byId(first.titleId)
  return (
    <Chapter n={5} eyebrow={`Your top ${r.top.length}`} title="What you couldn't stop watching">
      <ol className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-6 lg:space-y-0">
        <li>
          <Link to={`/title/${first.titleId}`} className="group relative flex flex-col gap-6 overflow-hidden rounded-3xl border border-accent-line/60 bg-[linear-gradient(120deg,rgb(124_58_237/0.2),transparent_60%)] p-5 sm:flex-row sm:items-end sm:p-8 lg:h-full lg:gap-5 lg:rounded-2xl lg:p-5">
            <Poster poster={t1?.poster ?? null} source={t1?.source ?? null} title={first.title} mediaType={first.mediaType} className="review-rise w-40 shrink-0 rounded-2xl shadow-pop sm:w-56 lg:w-32 xl:w-40" />
            <div className="min-w-0">
              <p className="review-ink text-7xl font-extrabold leading-none tracking-tight sm:text-9xl lg:text-6xl xl:text-7xl">#1</p>
              <p className="mt-3 line-clamp-3 text-3xl font-semibold tracking-tight text-balance wrap-anywhere sm:text-4xl lg:mt-2 lg:text-2xl">{first.title}</p>
              <p className="mt-2 text-fg-2">
                {countText(first)} · ≈{plural(hoursOf(first.minutes), 'hour')}
              </p>
              {first.completed && <p className="mt-3 inline-flex rounded-full border border-[#67e8f9]/40 bg-[#67e8f9]/10 px-3 py-1 text-xs font-semibold text-[#67e8f9]">Completed in {r.year}</p>}
            </div>
          </Link>
        </li>
        {rest.length > 0 && (
          <li>
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6 lg:gap-4">
              {rest.map((t, i) => {
                const title = byId(t.titleId)
                return (
                  <li key={t.titleId} className="review-rise min-w-0" style={{ '--rise-delay': `${i * 70}ms` } as CSSProperties}>
                    <Link to={`/title/${t.titleId}`} className="group block">
                      <div className="relative">
                        <Poster poster={title?.poster ?? null} source={title?.source ?? null} title={t.title} mediaType={t.mediaType} className="w-full rounded-2xl transition-transform duration-300 group-hover:-translate-y-1" />
                        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 rounded-b-2xl bg-linear-to-t from-black/80 to-transparent" />
                        <span className="absolute bottom-2 left-3 text-4xl font-extrabold tracking-tight text-white drop-shadow sm:text-5xl lg:text-3xl">#{i + 2}</span>
                      </div>
                      <p className="mt-3 line-clamp-2 font-medium wrap-anywhere lg:mt-2 lg:text-sm">{t.title}</p>
                      <p className="text-xs text-muted">{countText(t)}</p>
                    </Link>
                  </li>
                )
              })}
            </ol>
          </li>
        )}
      </ol>
    </Chapter>
  )
}

// ---------- 6. Year compared ----------

function Delta({ current, previous, fair }: { current: number; previous: number; fair: boolean }) {
  const change = fair ? percentChange(current, previous) : null
  if (change === null) {
    const diff = current - previous
    return <span className="text-xs font-semibold text-muted tabular-nums">{diff > 0 ? '+' : ''}{diff.toLocaleString()}</span>
  }
  const Icon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus
  // Watching less isn't a failure, so a fall is neutral, not red.
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${change > 0 ? 'bg-success/15 text-success' : 'bg-white/5 text-muted'}`}>
      <Icon className="size-3.5" aria-hidden />
      {change > 0 ? '+' : ''}
      {change}%
    </span>
  )
}

const METRICS: { label: string; get: (s: PeriodStats) => number }[] = [
  { label: 'Episodes', get: (s) => s.episodes },
  { label: 'Movies', get: (s) => s.movies },
  { label: 'Hours, estimated', get: (s) => hoursOf(s.minutes) },
  { label: 'Days you watched', get: (s) => s.activeDays },
  { label: 'Series completed', get: (s) => s.completedSeries },
  { label: 'Longest streak (days)', get: (s) => s.longestStreak?.days ?? 0 },
]

export function Compared({ review: r }: { review: YearReview }) {
  const c = r.comparison
  if (!c)
    return (
      <Chapter n={6} eyebrow="Year compared" title="Your first year in WatchTrack">
        <div className="rounded-3xl border border-dashed border-white/15 p-6 sm:p-8 lg:rounded-2xl lg:p-6">
          <p className="text-lg font-medium">No {r.year - 1} history to compare with</p>
          <p className="mt-2 max-w-2xl text-fg-2">
            Nothing was logged before {formatDay(r.coverage.from, true)}. That isn't zero, it just wasn't tracked, so no comparison is made up. Next year, this is where you'll see how {r.year} measures up.
          </p>
        </div>
      </Chapter>
    )
  const prevEp = c.previous.episodes
  const curEp = c.current.episodes
  const change = c.fair ? percentChange(curEp, prevEp) : null
  return (
    <Chapter n={6} eyebrow="Year compared" title={`${r.year} against ${c.previousYear}`} intro={compareIntro(c)}>
      <div className="grid gap-8 lg:gap-4">
        <div>
          <p className="text-7xl font-extrabold tracking-tight sm:text-8xl lg:text-6xl">
            <span className={change !== null && change > 0 ? 'review-ink' : ''}>
              {change !== null ? `${change > 0 ? '+' : ''}${change}%` : `${curEp - prevEp > 0 ? '+' : ''}${(curEp - prevEp).toLocaleString()}`}
            </span>
          </p>
          <p className="mt-2 text-lg text-fg-2 lg:mt-1 lg:text-base">
            {change !== null ? (change >= 0 ? 'more episodes' : 'fewer episodes') : curEp - prevEp >= 0 ? 'more episodes' : 'fewer episodes'} than {c.previousYear}
            {c.narrowed || c.toToday ? ', over the same dates' : ''}.
          </p>
        </div>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {METRICS.map((m) => {
            const prev = m.get(c.previous)
            const cur = m.get(c.current)
            const max = Math.max(1, prev, cur)
            return (
              <li key={m.label} className="space-y-2 border-b border-white/6 py-4 lg:space-y-1.5 lg:py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-fg-2">{m.label}</p>
                  <Delta current={cur} previous={prev} fair={c.fair} />
                </div>
                <Bar year={c.previousYear} value={prev} max={max} muted />
                <Bar year={r.year} value={cur} max={max} />
              </li>
            )
          })}
        </ul>
      </div>
    </Chapter>
  )
}

function Bar({ year, value, max, muted = false }: { year: number; value: number; max: number; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-10 text-[11px] tabular-nums ${muted ? 'text-muted' : 'font-semibold text-fg'}`}>{year}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/6">
        <span className={`review-bar block h-full origin-left rounded-full ${muted ? 'bg-white/25' : 'bg-linear-to-r from-accent to-[#67e8f9]'}`} style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className={`w-12 text-right text-sm tabular-nums ${muted ? 'text-muted' : 'font-semibold'}`}>{value.toLocaleString()}</span>
    </div>
  )
}

function compareIntro(c: Comparison): string {
  const dates = `${formatDay(c.previousFrom)} – ${formatDay(c.previousTo)}`
  if (!c.fair) return `You started logging on ${formatDay(c.previousFrom, true)}, so there are only a few days to compare: the numbers are shown, but not as percentages.`
  if (c.narrowed) return `Compared over ${dates} in both years: you started logging on ${formatDay(c.previousFrom, true)}, so earlier dates aren't counted against you.`
  if (c.toToday) return `Compared over ${dates} in both years, since this year isn't over yet.`
  return 'Both whole years, side by side.'
}

// ---------- 7. Looking back ----------

export function LookingBack({ summary, insights }: { summary: string; insights: Insight[] }) {
  return (
    <Chapter n={7} eyebrow="Looking back" title="Your year, in a few lines">
      <blockquote className="max-w-4xl border-l-2 border-accent pl-5 text-2xl leading-snug font-medium text-balance sm:pl-8 sm:text-3xl lg:pl-5 lg:text-xl">{summary}</blockquote>
      {insights.length > 0 && (
        <ul className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-1">
          {insights.map((i, n) => (
            <li key={i.id} className="review-rise flex items-start gap-3 border-b border-white/6 py-4 lg:py-3" style={{ '--rise-delay': `${n * 50}ms` } as CSSProperties}>
              <Medal className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
              <span className="text-fg-2">{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Chapter>
  )
}

// ---------- Ending ----------

export function Finale({ review: r, standout, byId, onShare }: { review: YearReview; standout: Standout; byId: (id: string) => Title | undefined; onShare: () => void }) {
  const top = r.top[0]
  const t = top && byId(top.titleId)
  const totals = [r.stats.episodes && plural(r.stats.episodes, 'episode'), r.stats.movies && plural(r.stats.movies, 'movie'), `≈${plural(hoursOf(r.stats.minutes), 'hour')}`].filter(Boolean).join(' · ')
  return (
    <section aria-labelledby="review-finale" className="review-rise relative isolate overflow-hidden rounded-[2rem] border border-accent-line/60 p-6 text-center sm:p-14 lg:rounded-3xl lg:p-10">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_50%_0%,rgb(139_92_246/0.38),transparent_70%),radial-gradient(50%_50%_at_50%_110%,rgb(103_232_249/0.14),transparent_70%)]" />
      <p className="eyebrow text-accent-text">{r.inProgress ? 'So far' : 'That’s a wrap'}</p>
      <h2 id="review-finale" className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-4xl xl:text-5xl">
        That was your {r.year}{r.inProgress ? ', so far' : ''}.
      </h2>

      <div className="mx-auto mt-10 grid max-w-3xl gap-8 sm:grid-cols-2 sm:text-left lg:mt-8">
        <div>
          <p className="eyebrow">Your standout</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 max-sm:justify-center">
            <span className="review-ink text-7xl font-extrabold tracking-tight lg:text-6xl">{standout.value}</span>
            <span className="text-lg font-medium">{standout.unit}</span>
          </p>
          <p className="text-sm text-muted">{standout.detail}</p>
        </div>
        {top && (
          <div>
            <p className="eyebrow">Your top title</p>
            <div className="mt-3 flex items-center gap-4 max-sm:justify-center">
              <Poster poster={t?.poster ?? null} source={t?.source ?? null} title={top.title} mediaType={top.mediaType} className="w-14 shrink-0 rounded-lg" />
              <div className="min-w-0 text-left">
                <p className="line-clamp-2 text-xl font-semibold wrap-anywhere">{top.title}</p>
                <p className="text-sm text-muted">{countText(top)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-10 text-lg text-fg-2 lg:mt-8 lg:text-base">{totals}</p>
      <button type="button" className="btn-primary mt-8 min-h-14 rounded-full px-8 text-base lg:mt-6 lg:min-h-12" onClick={onShare}>
        <Share2 className="size-5" aria-hidden /> Share your year
      </button>
      <div className="mt-12 flex flex-col items-center gap-2 text-sm text-muted lg:mt-8">
        <span className="flex items-center gap-2 text-fg">
          <Logo className="size-6" />
        </span>
        Your watching story, your way.
      </div>
    </section>
  )
}

/** The small print: what's counted, what's estimated, and anything that was left out. */
export function DataNotes({ review: r, undated, duplicates }: { review: YearReview; undated: number; duplicates: number }) {
  return (
    <aside className="space-y-1 rounded-2xl border border-dashed border-white/12 p-4 text-xs text-muted">
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
