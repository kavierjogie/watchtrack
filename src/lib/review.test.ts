import { describe, expect, it } from 'vitest'
import { formatDay, reviewYears, yearInReview } from './review'
import { createTitle } from './titles'
import type { HistoryEntry, Title } from './types'

/** A local date-time, so tests mean the same day in every time zone they run in. */
const at = (y: number, mo: number, d: number, h = 20) => new Date(y, mo - 1, d, h).toISOString()
let n = 0
const watch = (title: Title, when: string, kind: HistoryEntry['kind'] = 'episode'): HistoryEntry => ({
  id: `h${n++}`,
  titleId: title.id,
  at: when,
  kind,
  season: null,
  episode: null,
  label: null,
  before: null,
})

const frieren = createTitle({ title: 'Frieren', mediaType: 'anime', status: 'watching' })
const severance = createTitle({ title: 'Severance', mediaType: 'tv', status: 'watching' })
const dune = { ...createTitle({ title: 'Dune', mediaType: 'movie' }), status: 'completed' as const, completedAt: at(2026, 5, 2) }

describe('year in review', () => {
  it('counts episodes, specials and movies of that year only, and ignores corrections and status changes', () => {
    const history = [
      watch(frieren, at(2026, 1, 3)),
      watch(frieren, at(2026, 1, 4), 'special'),
      watch(dune, at(2026, 5, 2), 'movie'),
      watch(frieren, at(2026, 2, 1), 'correction'),
      watch(frieren, at(2026, 2, 1), 'status'),
      watch(frieren, at(2025, 12, 31)),
    ]
    const r = yearInReview([frieren, dune], history, 2026)
    expect(r).toMatchObject({ year: 2026, episodes: 2, movies: 1, titles: 2, completed: 1 })
    expect(r.byMonth).toEqual([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])
  })

  it('finds the longest run of days in a row, across a month end', () => {
    const history = [at(2026, 3, 30), at(2026, 3, 31), at(2026, 3, 31, 9), at(2026, 4, 1), at(2026, 4, 5), at(2026, 4, 6)].map((d) => watch(frieren, d))
    expect(yearInReview([frieren], history, 2026).longestStreak).toEqual({ days: 3, from: '2026-03-30', to: '2026-04-01' })
  })

  it('picks the busiest month and biggest day, earliest on a tie', () => {
    const history = [at(2026, 2, 10), at(2026, 2, 10), at(2026, 6, 1), at(2026, 6, 2)].map((d) => watch(severance, d))
    const r = yearInReview([severance], history, 2026)
    expect(r.busiestMonth).toEqual({ month: 1, count: 2 })
    expect(r.biggestDay).toEqual({ day: '2026-02-10', count: 2 })
  })

  it('ranks the most watched titles, leaving out ones since deleted', () => {
    const gone = createTitle({ title: 'Deleted show', mediaType: 'tv' })
    const history = [
      ...Array.from({ length: 3 }, () => watch(severance, at(2026, 7, 1))),
      watch(frieren, at(2026, 7, 2)),
      ...Array.from({ length: 9 }, () => watch(gone, at(2026, 7, 3))),
    ]
    const r = yearInReview([frieren, severance], history, 2026)
    expect(r.top.map((t) => [t.title, t.count])).toEqual([
      ['Severance', 3],
      ['Frieren', 1],
    ])
  })

  it('is empty, not broken, for a year with nothing watched', () => {
    const r = yearInReview([frieren], [watch(frieren, at(2026, 1, 1))], 2024)
    expect(r).toMatchObject({ episodes: 0, movies: 0, titles: 0, busiestMonth: null, longestStreak: null, biggestDay: null, top: [] })
  })

  it('lists the years that have watches, newest first, skipping unreadable dates', () => {
    const history = [watch(frieren, at(2024, 6, 1)), watch(frieren, at(2026, 1, 1)), watch(frieren, at(2026, 2, 1)), watch(frieren, 'not a date'), watch(frieren, at(2025, 3, 1), 'status')]
    expect(reviewYears(history)).toEqual([2026, 2024])
  })

  it('shows a stored day as that same calendar day', () => {
    expect(formatDay('2026-03-01')).toBe(new Date(2026, 2, 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))
  })
})
