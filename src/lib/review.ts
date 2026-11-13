import { dayKey } from './format'
import type { HistoryEntry, MediaType, Title } from './types'

/**
 * Year in review, worked out on this device from the watch history. Nothing is sent anywhere: the shareable image is
 * drawn locally too (see YearReview.tsx). Counts what was logged in WatchTrack, so episodes from before you started
 * using it, or bulk progress jumps, aren't included.
 */

const WATCH_KINDS = new Set<HistoryEntry['kind']>(['episode', 'special', 'movie'])

export interface TopTitle {
  titleId: string
  title: string
  mediaType: MediaType
  count: number
}

export interface YearReview {
  year: number
  /** Episodes and specials. */
  episodes: number
  movies: number
  /** Different titles you watched something of. */
  titles: number
  /** Titles marked completed this year. */
  completed: number
  /** Watches per month, January first. */
  byMonth: number[]
  busiestMonth: { month: number; count: number } | null
  /** Most consecutive days with at least one watch. `from` and `to` are local days (YYYY-MM-DD). */
  longestStreak: { days: number; from: string; to: string } | null
  biggestDay: { day: string; count: number } | null
  top: TopTitle[]
}

const isWatch = (h: HistoryEntry) => WATCH_KINDS.has(h.kind) && !Number.isNaN(Date.parse(h.at))

/** Years with at least one watch, newest first. */
export function reviewYears(history: HistoryEntry[]): number[] {
  return [...new Set(history.filter(isWatch).map((h) => new Date(h.at).getFullYear()))].sort((a, b) => b - a)
}

/** The day after a local YYYY-MM-DD, built from parts so daylight-saving changes can't skip or repeat a day. */
function nextDay(day: string): string {
  const [y, mo, d] = day.split('-').map(Number)
  return dayKey(new Date(y, mo - 1, d + 1))
}

export function yearInReview(titles: Title[], history: HistoryEntry[], year: number, topCount = 5): YearReview {
  const byId = new Map(titles.map((t) => [t.id, t]))
  const watches = history.filter((h) => isWatch(h) && new Date(h.at).getFullYear() === year)

  const byMonth = Array.from({ length: 12 }, () => 0)
  const perDay = new Map<string, number>()
  const perTitle = new Map<string, number>()
  let episodes = 0
  let movies = 0
  for (const h of watches) {
    const at = new Date(h.at)
    byMonth[at.getMonth()]++
    const day = dayKey(at)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    perTitle.set(h.titleId, (perTitle.get(h.titleId) ?? 0) + 1)
    if (h.kind === 'movie') movies++
    else episodes++
  }

  // Ties go to the earlier month or day, so the answer doesn't depend on history order.
  const peak = Math.max(0, ...byMonth)
  const busiestMonth = peak ? { month: byMonth.indexOf(peak), count: peak } : null
  let biggestDay: YearReview['biggestDay'] = null
  for (const [day, count] of perDay) if (!biggestDay || count > biggestDay.count || (count === biggestDay.count && day < biggestDay.day)) biggestDay = { day, count }

  let longestStreak: YearReview['longestStreak'] = null
  let run = { days: 0, from: '', to: '' }
  for (const day of [...perDay.keys()].sort()) {
    run = run.days && nextDay(run.to) === day ? { days: run.days + 1, from: run.from, to: day } : { days: 1, from: day, to: day }
    if (!longestStreak || run.days > longestStreak.days) longestStreak = run
  }

  const top = [...perTitle]
    .flatMap(([titleId, count]) => {
      const t = byId.get(titleId)
      return t ? [{ titleId, title: t.title, mediaType: t.mediaType, count }] : []
    })
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, topCount)

  const completed = titles.filter((t) => t.status === 'completed' && t.completedAt && new Date(t.completedAt).getFullYear() === year).length

  return { year, episodes, movies, titles: perTitle.size, completed, byMonth, busiestMonth, longestStreak, biggestDay, top }
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A local YYYY-MM-DD for display, built from its parts so it never shifts a day across time zones. */
export function formatDay(day: string): string {
  const [y, mo, d] = day.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
