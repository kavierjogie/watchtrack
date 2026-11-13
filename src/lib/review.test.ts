import { describe, expect, it } from 'vitest'
import { buildYearReview, compareWithPreviousYear, formatDay, indexHistory, percentChange, reviewYears, RUNTIME_MINUTES, toHours } from './review'
import { createTitle } from './titles'
import type { HistoryEntry, MediaType, Title } from './types'

/** A local date-time, so every test means the same calendar day in whatever time zone it runs. */
const at = (y: number, mo: number, d: number, h = 20, min = 0) => new Date(y, mo - 1, d, h, min).toISOString()
/** "Now" for a finished year and for one still going. */
const AFTER = new Date(2027, 0, 15).getTime()
const MID_2026 = new Date(2026, 10, 13, 12).getTime()

let n = 0
const make = (title: string, mediaType: MediaType, extra: Partial<Title> = {}): Title => ({ ...createTitle({ title, mediaType, status: 'watching' }, at(2020, 1, 1)), ...extra })
const ep = (t: Title, when: string, episode: number | null = null, season: number | null = null, kind: HistoryEntry['kind'] = 'episode'): HistoryEntry => ({
  id: `h${n++}`,
  titleId: t.id,
  at: when,
  kind,
  season,
  episode,
  label: null,
  before: null,
})
const movie = (t: Title, when: string) => ep(t, when, null, null, 'movie')
const review = (titles: Title[], history: HistoryEntry[], year = 2026, now = AFTER) => buildYearReview(indexHistory(titles, history), year, now)!

const frieren = make('Frieren', 'anime')
const severance = make('Severance', 'tv')
const dune = make('Dune', 'movie')

describe('what counts as a watch', () => {
  it('counts episodes, specials and movies on the day they were logged, and nothing else', () => {
    const r = review(
      [frieren, dune],
      [ep(frieren, at(2026, 1, 3), 1), ep(frieren, at(2026, 1, 4), null, null, 'special'), movie(dune, at(2026, 5, 2)), ep(frieren, at(2026, 2, 1), 5, null, 'correction'), ep(frieren, at(2026, 2, 1), null, null, 'status'), ep(frieren, at(2025, 12, 31), 9)],
    )
    expect(r.stats).toMatchObject({ watches: 3, episodes: 2, movies: 1, activeDays: 3 })
    expect(r.specials).toBe(1)
    expect(r.corrections).toBe(1)
    expect(r.byMonth.map((m) => m.watches)).toEqual([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])
  })

  it('counts a double log once, but a rewatch on another day twice', () => {
    const idx = indexHistory(
      [frieren, dune],
      [ep(frieren, at(2026, 3, 1, 20, 0), 4), ep(frieren, at(2026, 3, 1, 20, 1), 4), ep(frieren, at(2026, 3, 1, 21, 0), 4), movie(dune, at(2026, 3, 2)), movie(dune, at(2026, 6, 2))],
    )
    expect(idx.duplicates).toBe(1)
    const r = buildYearReview(idx, 2026, AFTER)!
    expect(r.stats.episodes).toBe(2)
    expect(r).toMatchObject({ distinctMovies: 1, movieRewatches: 1 })
  })

  it('ignores the same entry twice and skips unreadable dates, saying how many', () => {
    const a = ep(frieren, at(2026, 1, 1), 1)
    const idx = indexHistory([frieren], [a, a, { ...ep(frieren, 'not a date', 2) }, { ...ep(frieren, '', 3) }])
    expect(idx.watches).toHaveLength(1)
    expect(idx.undated).toBe(2)
  })

  it('estimates time from typical runtimes for each kind', () => {
    const r = review([frieren, severance, dune], [ep(frieren, at(2026, 1, 1), 1), ep(severance, at(2026, 1, 2), 1, 1), movie(dune, at(2026, 1, 3))])
    expect(r.stats.minutes).toBe(RUNTIME_MINUTES.anime + RUNTIME_MINUTES.tv + RUNTIME_MINUTES.movie)
    expect(toHours(184)).toBe(3.1)
    expect(r).toMatchObject({ animeEpisodes: 1, tvEpisodes: 1, animeSeries: 1 })
  })
})

describe('habits and records', () => {
  it('finds the longest run of days in a row, across a month end', () => {
    const days = [at(2026, 3, 30), at(2026, 3, 31), at(2026, 3, 31, 9), at(2026, 4, 1), at(2026, 4, 5), at(2026, 4, 6)]
    expect(review([frieren], days.map((d, i) => ep(frieren, d, i + 1))).stats.longestStreak).toEqual({ days: 3, from: '2026-03-30', to: '2026-04-01' })
  })

  it('picks the busiest month, biggest day and biggest week, the earliest on a tie', () => {
    const r = review([severance], [at(2026, 2, 10), at(2026, 2, 10, 21), at(2026, 6, 1), at(2026, 6, 2)].map((d, i) => ep(severance, d, i + 1, 1)))
    expect(r.busiestMonth).toEqual({ month: 1, count: 2 })
    expect(r.biggestDay).toEqual({ day: '2026-02-10', count: 2 })
    // Trimmed to the days actually watched, not the whole 7-day window.
    expect(r.biggestWeek).toEqual({ from: '2026-02-10', to: '2026-02-10', count: 2 })
  })

  it('spots binges, marathon days and the favourite weekday only with enough data', () => {
    // 8 episodes on Saturday 7 March 2026, plus 6 spread over weekdays: 14 watches on 7 days.
    const sat = Array.from({ length: 8 }, (_, i) => ep(frieren, at(2026, 3, 7, 12, i * 20), i + 1))
    const weekdays = [2, 3, 4, 5, 9, 10].map((d, i) => ep(severance, at(2026, 3, d), i + 1, 1))
    const r = review([frieren, severance], [...sat, ...weekdays])
    expect(r.biggestBinge).toMatchObject({ day: '2026-03-07', title: 'Frieren', count: 8 })
    expect(r).toMatchObject({ marathonDays: 1, bingeSessions: 1 })
    expect(r.bingeShare).toBeCloseTo(8 / 14)
    expect(r.favouriteWeekday).toEqual({ weekday: 5, count: 8, share: 8 / 14 })
    expect(r.weekendShare).toBeCloseTo(8 / 14)
    // Too little to call a favourite day.
    expect(review([frieren], sat.slice(0, 5)).favouriteWeekday).toBeNull()
  })

  it('averages per watching day and per covered month', () => {
    const r = review([frieren], [ep(frieren, at(2026, 1, 1), 1), ep(frieren, at(2026, 1, 1, 21), 2), ep(frieren, at(2026, 7, 1), 3)])
    expect(r.perActiveDay).toBe(1.5)
    expect(r.perMonth).toBeCloseTo(3 / (365 / 30.44))
  })

  it('counts weeks with a watch out of the weeks covered', () => {
    const r = review([frieren], [ep(frieren, at(2026, 1, 5), 1), ep(frieren, at(2026, 1, 6), 2), ep(frieren, at(2026, 1, 13), 3)])
    expect(r.activeWeeks).toBe(2)
    // Coverage starts at the first logged watch (Monday 5 January), so weeks 2 to 53 of the year: 52.
    expect(r.coveredWeeks).toBe(52)
    expect(review([frieren], [ep(frieren, at(2025, 12, 1), 1), ep(frieren, at(2026, 1, 1), 2)]).coveredWeeks).toBe(53) // the partial first week counts
  })
})

describe('titles', () => {
  it('ranks the top titles, leaving out ones since deleted, and marks the ones completed this year', () => {
    const done = make('Severance', 'tv', { status: 'completed', completedAt: at(2026, 7, 4) })
    const gone = make('Deleted show', 'tv')
    const history = [...Array.from({ length: 3 }, (_, i) => ep(done, at(2026, 7, 1 + i), i + 1, 1)), ep(frieren, at(2026, 7, 2), 1), ...Array.from({ length: 9 }, (_, i) => ep(gone, at(2026, 7, 3, 1, i * 10), i + 1))]
    const r = review([frieren, done], history)
    expect(r.top.map((t) => [t.title, t.count, t.completed])).toEqual([
      ['Severance', 3, true],
      ['Frieren', 1, false],
    ])
    expect(r.stats.completedSeries).toBe(1)
  })

  it('counts series started from episode 1 this year, not ones picked up partway or started earlier', () => {
    const a = make('A', 'anime')
    const b = make('B', 'tv')
    const c = make('C', 'anime')
    const r = review([a, b, c], [ep(a, at(2026, 2, 1), 1), ep(b, at(2026, 2, 1), 7, 2), ep(c, at(2025, 2, 1), 1), ep(c, at(2026, 2, 2), 2)])
    expect(r.seriesStarted).toBe(1)
    expect(r.seriesWatched).toBe(3)
  })

  it('reports the furthest episode reached in an overall-numbered series', () => {
    const op = make('One Piece', 'anime')
    expect(review([op], [ep(op, at(2026, 1, 1), 1099), ep(op, at(2026, 1, 2), 1100)]).furthest).toEqual({ titleId: op.id, title: 'One Piece', episode: 1100 })
  })

  it('has nothing completed for a user who finished nothing', () => {
    const r = review([frieren], [ep(frieren, at(2026, 1, 1), 1)])
    expect(r.stats.completedSeries).toBe(0)
    expect(r.top[0].completed).toBe(false)
  })
})

describe('the year as a story', () => {
  it('lists moments in date order, with milestones naming what was watched', () => {
    const history = Array.from({ length: 50 }, (_, i) => ep(frieren, at(2026, 1, 1 + Math.floor(i / 5), 20, i % 5), i + 1))
    const r = review([frieren], history)
    // Every day is the same 5-episode binge, so the biggest day is told once, as the binge.
    expect(r.moments.map((m) => m.kind)).toEqual(['first', 'streak', 'week', 'binge', 'milestone', 'last'])
    expect(r.moments.find((m) => m.kind === 'milestone')).toMatchObject({ day: '2026-01-10', title: 'Watch number 50', detail: 'Frieren' })
    expect(r.moments.every((m, i, all) => i === 0 || all[i - 1].day <= m.day)).toBe(true)
  })

  it('has no "last watch" while the year is still going', () => {
    const r = review([frieren], [ep(frieren, at(2026, 1, 1), 1), ep(frieren, at(2026, 2, 1), 2)], 2026, MID_2026)
    expect(r.inProgress).toBe(true)
    expect(r.moments.some((m) => m.kind === 'last')).toBe(false)
    expect(r.coverage.to).toBe('2026-11-13')
  })
})

describe('coverage and comparisons', () => {
  it('starts coverage at the first logged watch, never assuming earlier viewing', () => {
    const r = review([frieren], [ep(frieren, at(2026, 8, 4), 1)])
    expect(r.coverage).toMatchObject({ from: '2026-08-04', to: '2026-12-31', startedThisYear: true })
    expect(r.comparison).toBeNull()
    expect(r.perMonth).toBeCloseTo(1 / (150 / 30.44))
  })

  it('compares whole years once a year is over', () => {
    const history = [...[1, 2].map((d) => ep(frieren, at(2025, 1, d), d)), ...[1, 2, 3].map((d) => ep(frieren, at(2026, 3, d), d + 2))]
    const c = review([frieren], history).comparison!
    expect(c).toMatchObject({ previousYear: 2025, toToday: false, narrowed: false, fair: true, previousFrom: '2025-01-01', previousTo: '2025-12-31' })
    expect([c.previous.episodes, c.current.episodes]).toEqual([2, 3])
    expect(percentChange(c.current.episodes, c.previous.episodes)).toBe(50)
  })

  it('compares the same dates while the year is still going', () => {
    const history = [ep(frieren, at(2025, 1, 1), 1), ep(frieren, at(2025, 11, 1), 2), ep(frieren, at(2025, 12, 20), 3), ep(frieren, at(2026, 11, 1), 4)]
    const c = review([frieren], history, 2026, MID_2026).comparison!
    expect(c).toMatchObject({ toToday: true, narrowed: false, previousTo: '2025-11-13', currentTo: '2026-11-13' })
    // 20 December 2025 is after "today" last year, so it isn't compared yet.
    expect([c.previous.watches, c.current.watches]).toEqual([2, 1])
  })

  it('compares only the dates logged in both years when logging started partway through the previous one', () => {
    const history = [ep(frieren, at(2025, 8, 4), 1), ep(frieren, at(2026, 2, 1), 2), ep(frieren, at(2026, 9, 1), 3)]
    const c = review([frieren], history).comparison!
    expect(c).toMatchObject({ narrowed: true, fair: true, previousFrom: '2025-08-04', currentFrom: '2026-08-04', currentTo: '2026-12-31' })
    // February 2026 has no logged twin in February 2025, so it's left out of the comparison (not the year).
    expect([c.previous.watches, c.current.watches]).toEqual([1, 1])
  })

  it('shows no percentages when the overlap is under four weeks', () => {
    const c = review([frieren], [ep(frieren, at(2025, 12, 20), 1), ep(frieren, at(2026, 12, 21), 2)]).comparison!
    expect(c).toMatchObject({ narrowed: true, fair: false })
  })

  it('handles 29 February when comparing with a non-leap year', () => {
    const idx = indexHistory([frieren], [ep(frieren, at(2027, 2, 1), 1), ep(frieren, at(2028, 2, 29), 2)])
    expect(compareWithPreviousYear(idx, 2028, '2028-02-29')?.previousTo).toBe('2027-02-28')
  })

  it('never divides by an empty year', () => {
    expect(percentChange(5, 0)).toBeNull()
    expect(percentChange(0, 4)).toBe(-100)
  })
})

describe('years and edge cases', () => {
  it('lists years with watches, newest first, and has no review for an empty year or a new user', () => {
    const idx = indexHistory([frieren], [ep(frieren, at(2024, 6, 1), 1), ep(frieren, at(2026, 1, 1), 2), ep(frieren, at(2025, 3, 1), null, null, 'status')])
    expect(reviewYears(idx)).toEqual([2026, 2024])
    expect(buildYearReview(idx, 2025, AFTER)).toBeNull()
    expect(buildYearReview(indexHistory([], []), 2026, AFTER)).toBeNull()
  })

  it('covers a movies-only year', () => {
    const films = Array.from({ length: 4 }, (_, i) => make(`Film ${i}`, 'movie'))
    const r = review(films, films.map((f, i) => movie(f, at(2026, 4, 1 + i))))
    expect(r.stats).toMatchObject({ episodes: 0, movies: 4 })
    expect(r).toMatchObject({ seriesWatched: 0, distinctMovies: 4, bingeShare: 0, furthest: null })
  })

  it('works through a very large history quickly', () => {
    const titles = Array.from({ length: 200 }, (_, i) => make(`Show ${i}`, i % 3 ? 'tv' : 'anime'))
    const start = new Date(2020, 0, 1).getTime()
    const history = Array.from({ length: 100_000 }, (_, i) => ep(titles[i % 200], new Date(start + i * 30 * 60_000).toISOString(), (i % 500) + 1, 1))
    const t0 = performance.now()
    const idx = indexHistory(titles, history)
    for (const y of reviewYears(idx)) buildYearReview(idx, y, AFTER)
    // About 0.7 s alone (index ~200 ms, ~80 ms a year). The budget leaves room for a busy parallel test run while still
    // catching anything accidentally quadratic, which would take minutes at this size.
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(idx.watches.length).toBe(100_000)
  })

  it('shows a stored day as that same calendar day', () => {
    expect(formatDay('2026-03-01')).toBe(new Date(2026, 2, 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))
  })
})
