import { dayKey } from './format'
import type { HistoryEntry, MediaType, Title } from './types'

/**
 * Year in review, worked out on this device from the watch history. Nothing is fetched or sent: the shareable images
 * are drawn locally too (reviewImage.ts). Personality and insights live in reviewStory.ts; this file is the numbers.
 *
 * What counts: every episode, special and movie you logged, on the day you logged it. Progress jumps ("set last
 * watched", imports) aren't watches and are never counted. A period before your first logged watch is "not tracked",
 * never zero: comparisons say so instead of reporting a fall.
 */

/** Typical runtimes, for the estimated hours. No runtime is stored per title, and fetching them would leave the device. */
export const RUNTIME_MINUTES: Record<MediaType, number> = { anime: 24, tv: 45, movie: 115 }
/** The same episode logged twice this close together is one watch logged twice (a double tap, a retried save). */
const DUPLICATE_MS = 2 * 60_000
const DAY_MS = 86_400_000
/** Days with this many watches are "marathon" days; this many episodes of one title in a day is a binge. */
export const MARATHON_WATCHES = 8
export const BINGE_EPISODES = 4
const MILESTONES = [50, 100, 250, 500, 1000, 2000, 5000, 10_000]

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Monday first. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export interface Watch {
  id: string
  titleId: string
  /** ms since epoch */
  at: number
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  year: number
  kind: 'episode' | 'special' | 'movie'
  season: number | null
  episode: number | null
  /** Anime or TV for episodes, movie for movies. */
  mediaType: MediaType
  /** Estimated, from RUNTIME_MINUTES. */
  minutes: number
}

export interface ReviewIndex {
  /** Valid, de-duplicated watches, oldest first. */
  watches: Watch[]
  byYear: Map<number, Watch[]>
  /** First logged watch: before it, nothing was being tracked. */
  trackingStart: Watch | null
  /** Earliest watch per title, for "started this year". */
  firstWatch: Map<string, Watch>
  /** Watch entries skipped for an unreadable date. */
  undated: number
  /** Watch entries dropped as double logs. */
  duplicates: number
  /** Manual progress changes per year: not counted as watches. */
  corrections: Map<number, number>
  titles: Map<string, Title>
}

const isWatchKind = (k: HistoryEntry['kind']): k is Watch['kind'] => k === 'episode' || k === 'special' || k === 'movie'

/** One pass over the history. Everything else works from this, so a large history is read once per change. */
export function indexHistory(titles: Title[], history: HistoryEntry[]): ReviewIndex {
  const byTitle = new Map(titles.map((t) => [t.id, t]))
  const corrections = new Map<number, number>()
  const seenIds = new Set<string>()
  const raw: Watch[] = []
  let undated = 0
  for (const h of history) {
    if (!h || seenIds.has(h.id)) continue
    seenIds.add(h.id)
    const at = Date.parse(h.at)
    if (h.kind === 'correction') {
      if (!Number.isNaN(at)) {
        const y = new Date(at).getFullYear()
        corrections.set(y, (corrections.get(y) ?? 0) + 1)
      }
      continue
    }
    if (!isWatchKind(h.kind)) continue
    if (Number.isNaN(at)) {
      undated++
      continue
    }
    const d = new Date(at)
    // Movies by the entry's kind; episodes by their title's type. A deleted title takes its history with it, so an
    // unknown one is rare: it counts as TV for the estimate.
    const own = byTitle.get(h.titleId)?.mediaType
    const mediaType: MediaType = h.kind === 'movie' ? 'movie' : own === 'anime' ? 'anime' : 'tv'
    raw.push({
      id: h.id,
      titleId: h.titleId,
      at,
      day: dayKey(d),
      year: d.getFullYear(),
      kind: h.kind,
      season: Number.isFinite(h.season) ? h.season : null,
      episode: Number.isFinite(h.episode) ? h.episode : null,
      mediaType,
      minutes: RUNTIME_MINUTES[mediaType],
    })
  }
  raw.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))

  const watches: Watch[] = []
  const lastSame = new Map<string, number>()
  let duplicates = 0
  for (const w of raw) {
    const key = `${w.titleId}|${w.kind}|${w.season}|${w.episode}`
    const prev = lastSame.get(key)
    lastSame.set(key, w.at)
    // The same episode or movie logged again minutes later is a double log; days later it's a rewatch, which counts.
    if (prev !== undefined && w.at - prev < DUPLICATE_MS) {
      duplicates++
      continue
    }
    watches.push(w)
  }

  const byYear = new Map<number, Watch[]>()
  const firstWatch = new Map<string, Watch>()
  for (const w of watches) {
    const list = byYear.get(w.year)
    if (list) list.push(w)
    else byYear.set(w.year, [w])
    if (!firstWatch.has(w.titleId)) firstWatch.set(w.titleId, w)
  }
  return { watches, byYear, trackingStart: watches[0] ?? null, firstWatch, undated, duplicates, corrections, titles: byTitle }
}

/** Years with at least one watch, newest first. */
export function reviewYears(index: ReviewIndex): number[] {
  return [...index.byYear.keys()].sort((a, b) => b - a)
}

// ---------- Days (all local calendar days, built from parts so daylight saving can't skip or repeat one) ----------

const parts = (day: string) => day.split('-').map(Number) as [number, number, number]
const dayOfYear = (day: string) => {
  const [y, m, d] = parts(day)
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(y, 0, 1).getTime()) / DAY_MS)
}
const dayFromIndex = (year: number, i: number) => dayKey(new Date(year, 0, 1 + i))
const daysInYear = (year: number) => dayOfYear(`${year}-12-31`) + 1
const nextDay = (day: string) => {
  const [y, m, d] = parts(day)
  return dayKey(new Date(y, m - 1, d + 1))
}
/** Monday = 0. */
const weekdayOf = (day: string) => {
  const [y, m, d] = parts(day)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

export interface Streak {
  days: number
  from: string
  to: string
}

/** Longest run of consecutive days in a sorted list of distinct day keys; the earliest one on a tie. */
function longestRun(days: string[]): Streak | null {
  let best: Streak | null = null
  let run: Streak | null = null
  for (const day of days) {
    run = run && nextDay(run.to) === day ? { days: run.days + 1, from: run.from, to: day } : { days: 1, from: day, to: day }
    if (!best || run.days > best.days) best = run
  }
  return best
}

// ---------- Periods (the year itself, and the windows comparisons use) ----------

export interface PeriodStats {
  watches: number
  /** Episodes and specials. */
  episodes: number
  movies: number
  /** Estimated. */
  minutes: number
  activeDays: number
  longestStreak: Streak | null
  /** Series (not movies) marked completed in the period. */
  completedSeries: number
}

/** Stats for watches between `from` and `to` (local day keys, inclusive). */
export function periodStats(index: ReviewIndex, from: string, to: string): PeriodStats {
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])
  const ws = [...years].flatMap((y) => index.byYear.get(y) ?? []).filter((w) => w.day >= from && w.day <= to)
  const days = [...new Set(ws.map((w) => w.day))].sort()
  let completedSeries = 0
  for (const t of index.titles.values()) {
    if (t.mediaType === 'movie' || t.status !== 'completed' || !t.completedAt || Number.isNaN(Date.parse(t.completedAt))) continue
    const d = dayKey(new Date(t.completedAt))
    if (d >= from && d <= to) completedSeries++
  }
  let episodes = 0
  let minutes = 0
  for (const w of ws) {
    if (w.kind !== 'movie') episodes++
    minutes += w.minutes
  }
  return { watches: ws.length, episodes, movies: ws.length - episodes, minutes, activeDays: days.length, longestStreak: longestRun(days), completedSeries }
}

// ---------- The year ----------

export interface TopTitle {
  titleId: string
  title: string
  mediaType: MediaType
  count: number
  minutes: number
  /** Marked completed during this year. */
  completed: boolean
}

export interface MonthStats {
  watches: number
  episodes: number
  movies: number
  minutes: number
  /** The title watched most that month (ties: the one watched first). */
  top: { title: string; count: number } | null
}

export interface Moment {
  kind: 'first' | 'milestone' | 'streak' | 'day' | 'week' | 'binge' | 'last'
  /** Local day it happened (a streak's or week's first day). */
  day: string
  title: string
  detail: string
}

export interface Comparison {
  previousYear: number
  /** The same calendar dates in both years (local day keys). */
  previousFrom: string
  previousTo: string
  currentFrom: string
  currentTo: string
  /** The viewed year is still going, so only the dates up to today are compared. */
  toToday: boolean
  /** Logging started partway through the previous year, so only the dates logged in both years are compared. */
  narrowed: boolean
  /** The window is long enough (4+ weeks) for percentages to mean something. */
  fair: boolean
  current: PeriodStats
  previous: PeriodStats
}

export interface YearReview {
  year: number
  /** The year isn't over yet. */
  inProgress: boolean
  /** The days this review speaks for: from Jan 1 (or the first logged watch) to Dec 31 (or today). */
  coverage: { from: string; to: string; days: number; startedThisYear: boolean }
  stats: PeriodStats
  specials: number
  /** Different titles you watched something of. */
  titles: number
  /** Episodes (specials included) by type. */
  animeEpisodes: number
  tvEpisodes: number
  /** Different anime titles you watched episodes of. */
  animeSeries: number
  distinctMovies: number
  /** Movie watches beyond the first of each movie this year. */
  movieRewatches: number
  seriesWatched: number
  /** Series whose first-ever logged episode, this year, was episode 1. */
  seriesStarted: number
  byMonth: MonthStats[]
  /** Monday first. */
  byWeekday: number[]
  busiestMonth: { month: number; count: number } | null
  /** Only with 14+ watches over 7+ active days, and when the day clearly leads (20% over an even split). */
  favouriteWeekday: { weekday: number; count: number; share: number } | null
  weekendShare: number
  biggestDay: { day: string; count: number } | null
  /** Best 7 days in a row. */
  biggestWeek: { from: string; to: string; count: number } | null
  biggestBinge: { day: string; titleId: string; title: string; count: number } | null
  /** Days with MARATHON_WATCHES or more watches. */
  marathonDays: number
  /** Share of episodes watched in a binge (BINGE_EPISODES+ of one title in a day). */
  bingeShare: number
  bingeSessions: number
  /** Weeks (Monday to Sunday) with a watch, out of the weeks the review covers. */
  activeWeeks: number
  coveredWeeks: number
  perActiveDay: number
  /** Watches per month across the months covered; null under ~6 weeks of coverage. */
  perMonth: number | null
  top: TopTitle[]
  /** Genres of the titles watched this year (from each title's own genre list), most titles first. */
  genres: { name: string; titles: number }[]
  /** Titles watched this year that have any genre listed: what `genres` shares are out of. */
  genreTitles: number
  /** Series (not movies) marked completed in each month of the year. */
  completedByMonth: number[]
  /** The furthest episode reached in an overall-numbered series (One Piece E1100). */
  furthest: { titleId: string; title: string; episode: number } | null
  moments: Moment[]
  comparison: Comparison | null
  /** Manual progress changes this year, which aren't counted as watches. */
  corrections: number
}

const titleName = (index: ReviewIndex, id: string) => index.titles.get(id)?.title ?? 'A deleted title'

/** null when the year has no watches. `now` decides whether the year is still going. */
export function buildYearReview(index: ReviewIndex, year: number, now = Date.now(), topCount = 5): YearReview | null {
  const ws = index.byYear.get(year)
  if (!ws?.length || !index.trackingStart) return null
  const today = dayKey(new Date(now))
  const inProgress = new Date(now).getFullYear() === year
  const start = index.trackingStart.day
  const from = start > `${year}-01-01` ? start : `${year}-01-01`
  const to = inProgress ? today : `${year}-12-31`
  const coverageDays = Math.max(1, dayOfYear(to) - dayOfYear(from) + 1)

  const n = daysInYear(year)
  const perDay = new Array<number>(n).fill(0)
  const byMonth: MonthStats[] = Array.from({ length: 12 }, () => ({ watches: 0, episodes: 0, movies: 0, minutes: 0, top: null }))
  const monthTitle = Array.from({ length: 12 }, () => new Map<string, number>())
  const byWeekday = new Array<number>(7).fill(0)
  const perTitle = new Map<string, { count: number; minutes: number }>()
  const perTitleDay = new Map<string, number>()
  const series = new Set<string>()
  const animeTitles = new Set<string>()
  const movies = new Set<string>()
  let specials = 0
  let anime = 0
  let tv = 0
  let furthest: YearReview['furthest'] = null
  const moments: Moment[] = []

  for (const [i, w] of ws.entries()) {
    const m = Number(w.day.slice(5, 7)) - 1
    const mo = byMonth[m]
    mo.watches++
    mo.minutes += w.minutes
    if (w.kind === 'movie') mo.movies++
    else mo.episodes++
    monthTitle[m].set(w.titleId, (monthTitle[m].get(w.titleId) ?? 0) + 1)
    perDay[dayOfYear(w.day)]++
    byWeekday[weekdayOf(w.day)]++
    const pt = perTitle.get(w.titleId)
    perTitle.set(w.titleId, { count: (pt?.count ?? 0) + 1, minutes: (pt?.minutes ?? 0) + w.minutes })
    if (w.kind === 'movie') movies.add(w.titleId)
    else {
      series.add(w.titleId)
      const k = `${w.day}|${w.titleId}`
      perTitleDay.set(k, (perTitleDay.get(k) ?? 0) + 1)
      if (w.kind === 'special') specials++
      if (w.mediaType === 'anime') {
        anime++
        animeTitles.add(w.titleId)
      } else tv++
      if (w.kind === 'episode' && w.season == null && w.episode != null && (!furthest || w.episode > furthest.episode))
        furthest = { titleId: w.titleId, title: titleName(index, w.titleId), episode: w.episode }
    }
    // Milestones: the 50th, 100th, 250th… watch of the year, and what it was.
    if (MILESTONES.includes(i + 1)) moments.push({ kind: 'milestone', day: w.day, title: `Watch number ${(i + 1).toLocaleString()}`, detail: titleName(index, w.titleId) })
  }
  for (const [m, map] of monthTitle.entries()) {
    let best: { id: string; count: number } | null = null
    for (const [id, c] of map) if (!best || c > best.count) best = { id, count: c }
    byMonth[m].top = best && { title: titleName(index, best.id), count: best.count }
  }

  const stats = periodStats(index, `${year}-01-01`, `${year}-12-31`)
  const peakMonth = Math.max(...byMonth.map((m) => m.watches))
  const busiestMonth = peakMonth ? { month: byMonth.findIndex((m) => m.watches === peakMonth), count: peakMonth } : null

  const topDay = Math.max(...byWeekday)
  const favouriteWeekday =
    ws.length >= 14 && stats.activeDays >= 7 && topDay / ws.length >= (1 / 7) * 1.2 ? { weekday: byWeekday.indexOf(topDay), count: topDay, share: topDay / ws.length } : null

  // Earliest wins ties: the scans only replace on a strictly bigger value.
  let biggestDay: YearReview['biggestDay'] = null
  let biggestWeek: YearReview['biggestWeek'] = null
  let marathonDays = 0
  let week = 0
  for (let i = 0; i < n; i++) {
    const c = perDay[i]
    if (c >= MARATHON_WATCHES) marathonDays++
    if (c && (!biggestDay || c > biggestDay.count)) biggestDay = { day: dayFromIndex(year, i), count: c }
    week += c - (i >= 7 ? perDay[i - 7] : 0)
    if (week && (!biggestWeek || week > biggestWeek.count)) {
      // The 7 days ending today, or from 1 January while the year is less than a week old.
      const startIdx = Math.max(0, i - 6)
      biggestWeek = { from: dayFromIndex(year, startIdx), to: dayFromIndex(year, Math.max(i, startIdx)), count: week }
    }
  }
  // Trim the week to its first and last active days, so "Mar 3 – 9" doesn't claim empty days.
  if (biggestWeek) {
    const [a, b] = [dayOfYear(biggestWeek.from), dayOfYear(biggestWeek.to)]
    let lo = a
    let hi = b
    while (lo < hi && !perDay[lo]) lo++
    while (hi > lo && !perDay[hi]) hi--
    biggestWeek = { ...biggestWeek, from: dayFromIndex(year, lo), to: dayFromIndex(year, hi) }
  }

  let biggestBinge: YearReview['biggestBinge'] = null
  let bingeEpisodes = 0
  let bingeSessions = 0
  for (const [k, c] of perTitleDay) {
    if (c < BINGE_EPISODES) continue
    bingeEpisodes += c
    bingeSessions++
    const [day, id] = k.split('|')
    if (!biggestBinge || c > biggestBinge.count || (c === biggestBinge.count && day < biggestBinge.day)) biggestBinge = { day, titleId: id, title: titleName(index, id), count: c }
  }

  // Weeks run Monday to Sunday; the partial weeks at either end of the covered span still count.
  const weekOf = (day: string) => Math.floor((dayOfYear(day) + weekdayOf(`${year}-01-01`)) / 7)
  const activeWeeks = new Set(ws.map((w) => weekOf(w.day))).size
  const coveredWeeks = Math.max(1, weekOf(to) - weekOf(from) + 1)

  const top: TopTitle[] = []
  for (const [titleId, v] of perTitle) {
    const t = index.titles.get(titleId)
    if (!t) continue
    const completed = t.status === 'completed' && !!t.completedAt && new Date(t.completedAt).getFullYear() === year
    top.push({ titleId, title: t.title, mediaType: t.mediaType, count: v.count, minutes: v.minutes, completed })
  }
  top.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))

  // Genres as each title lists them ("Anime" is a format here, not a genre); a title counts once per genre.
  const genreCount = new Map<string, number>()
  let genreTitles = 0
  for (const titleId of perTitle.keys()) {
    const names = new Set((index.titles.get(titleId)?.genres ?? []).map((g) => g.trim()).filter((g) => g && g.toLowerCase() !== 'anime'))
    if (names.size) genreTitles++
    for (const g of names) genreCount.set(g, (genreCount.get(g) ?? 0) + 1)
  }
  const genres = [...genreCount].map(([name, titles]) => ({ name, titles })).sort((a, b) => b.titles - a.titles || a.name.localeCompare(b.name))

  // Same rule as periodStats' completedSeries, split by month.
  const completedByMonth = new Array<number>(12).fill(0)
  for (const t of index.titles.values()) {
    if (t.mediaType === 'movie' || t.status !== 'completed' || !t.completedAt || Number.isNaN(Date.parse(t.completedAt))) continue
    const d = dayKey(new Date(t.completedAt))
    if (d.startsWith(`${year}-`)) completedByMonth[Number(d.slice(5, 7)) - 1]++
  }

  let seriesStarted = 0
  for (const id of series) {
    const f = index.firstWatch.get(id)
    if (f && f.year === year && f.kind === 'episode' && f.episode === 1 && (f.season == null || f.season === 1)) seriesStarted++
  }

  // The year's story, in date order.
  moments.unshift({ kind: 'first', day: ws[0].day, title: 'First watch of the year', detail: titleName(index, ws[0].titleId) })
  const streak = stats.longestStreak
  if (streak && streak.days >= 3) moments.push({ kind: 'streak', day: streak.from, title: `${streak.days}-day streak`, detail: `Something watched every day, ${formatDay(streak.from)} – ${formatDay(streak.to)}` })
  // A biggest day that was all one binge is told once, as the binge.
  const dayIsBinge = !!biggestDay && biggestBinge?.day === biggestDay.day && biggestBinge.count === biggestDay.count
  if (biggestDay && biggestDay.count >= 3 && !dayIsBinge) moments.push({ kind: 'day', day: biggestDay.day, title: 'Biggest day', detail: `${biggestDay.count} watched in one day` })
  if (biggestWeek && biggestWeek.count >= 5 && biggestWeek.from !== biggestWeek.to)
    moments.push({ kind: 'week', day: biggestWeek.from, title: 'Biggest week', detail: `${biggestWeek.count} watched, ${formatDay(biggestWeek.from)} – ${formatDay(biggestWeek.to)}` })
  if (biggestBinge) moments.push({ kind: 'binge', day: biggestBinge.day, title: 'Biggest binge', detail: `${biggestBinge.count} episodes of ${biggestBinge.title}` })
  const last = ws[ws.length - 1]
  if (!inProgress && ws.length > 1) moments.push({ kind: 'last', day: last.day, title: 'Last watch of the year', detail: titleName(index, last.titleId) })
  // Same day: keep the order they were added (first watch, milestones, then records).
  moments.sort((a, b) => a.day.localeCompare(b.day))

  return {
    year,
    inProgress,
    coverage: { from, to, days: coverageDays, startedThisYear: start > `${year}-01-01` },
    stats,
    specials,
    titles: perTitle.size,
    animeEpisodes: anime,
    tvEpisodes: tv,
    animeSeries: animeTitles.size,
    distinctMovies: movies.size,
    movieRewatches: stats.movies - movies.size,
    seriesWatched: series.size,
    seriesStarted,
    byMonth,
    byWeekday,
    busiestMonth,
    favouriteWeekday,
    weekendShare: (byWeekday[5] + byWeekday[6]) / ws.length,
    biggestDay,
    biggestWeek,
    biggestBinge,
    marathonDays,
    bingeShare: stats.episodes ? bingeEpisodes / stats.episodes : 0,
    bingeSessions,
    activeWeeks,
    coveredWeeks,
    perActiveDay: ws.length / stats.activeDays,
    perMonth: coverageDays >= 45 ? ws.length / (coverageDays / 30.44) : null,
    top: top.slice(0, topCount),
    genres,
    genreTitles,
    completedByMonth,
    furthest,
    moments,
    comparison: compareWithPreviousYear(index, year, inProgress ? today : null),
    corrections: index.corrections.get(year) ?? 0,
  }
}

/**
 * The year before, over the same calendar dates in both years: up to today while this year is still going (so January
 * to November isn't set against a whole year), and from your first logged watch when that fell partway through last
 * year (so untracked weeks aren't read as weeks of watching nothing). null when last year has no logged days at all.
 */
export function compareWithPreviousYear(index: ReviewIndex, year: number, today: string | null): Comparison | null {
  const start = index.trackingStart?.day
  const previousYear = year - 1
  if (!start || start > `${previousYear}-12-31`) return null
  // 29 February has no twin in a non-leap year: start from 1 March, or end on the 28th.
  const fromMd = start > `${previousYear}-01-01` ? (start.slice(5) === '02-29' ? '03-01' : start.slice(5)) : '01-01'
  const toMd = today ? (today.slice(5) === '02-29' ? '02-28' : today.slice(5)) : '12-31'
  if (fromMd > toMd) return null
  const previousFrom = `${previousYear}-${fromMd}`
  const previousTo = `${previousYear}-${toMd}`
  return {
    previousYear,
    previousFrom,
    previousTo,
    currentFrom: `${year}-${fromMd}`,
    currentTo: `${year}-${toMd}`,
    toToday: !!today,
    narrowed: fromMd !== '01-01',
    fair: dayOfYear(previousTo) - dayOfYear(previousFrom) + 1 >= 28,
    current: periodStats(index, `${year}-${fromMd}`, `${year}-${toMd}`),
    previous: periodStats(index, previousFrom, previousTo),
  }
}

export type MonthState = 'tracked' | 'untracked' | 'future'

/** A month before the first logged watch isn't "zero", it wasn't tracked; one after today hasn't happened yet. */
export function monthState(r: YearReview, m: number): MonthState {
  const first = `${r.year}-${String(m + 1).padStart(2, '0')}-01`
  const last = `${r.year}-${String(m + 1).padStart(2, '0')}-31`
  if (last < r.coverage.from) return 'untracked'
  if (first > r.coverage.to) return 'future'
  return 'tracked'
}

/** Whole-number percentage change, or null when there's nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null
}

/** Estimated minutes as hours, one decimal. */
export const toHours = (minutes: number) => Math.round(minutes / 6) / 10

/** A local YYYY-MM-DD for display, built from its parts so it never shifts a day across time zones. */
export function formatDay(day: string, withYear = false): string {
  const [y, mo, d] = parts(day)
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}
