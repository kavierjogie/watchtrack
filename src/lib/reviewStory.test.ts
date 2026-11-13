import { describe, expect, it } from 'vitest'
import { buildYearReview, indexHistory, type YearReview } from './review'
import { lookingBack, PERSONALITY_MIN_WATCHES, reviewHeadline, reviewInsights, standoutRecord, watchingPersonality, type Personality } from './reviewStory'
import { createTitle } from './titles'
import type { HistoryEntry, MediaType, Title } from './types'

const at = (y: number, mo: number, d: number, h = 20, min = 0) => new Date(y, mo - 1, d, h, min).toISOString()
const AFTER = new Date(2027, 0, 15).getTime()
let n = 0
const make = (title: string, mediaType: MediaType, extra: Partial<Title> = {}): Title => ({ ...createTitle({ title, mediaType, status: 'watching' }, at(2020, 1, 1)), ...extra })
const ep = (t: Title, when: string, episode: number, kind: HistoryEntry['kind'] = 'episode'): HistoryEntry => ({ id: `s${n++}`, titleId: t.id, at: when, kind, season: null, episode, label: null, before: null })
const build = (titles: Title[], history: HistoryEntry[]) => buildYearReview(indexHistory(titles, history), 2026, AFTER)!
const personalityOf = (titles: Title[], history: HistoryEntry[]) => watchingPersonality(build(titles, history))

/** One watch on each of `days` (day-of-year numbers, from 1 January 2026), cycling through `titles`. */
const spread = (titles: Title[], days: number[], hour = 20) => days.map((d, i) => ep(titles[i % titles.length], new Date(2026, 0, d, hour).toISOString(), i + 1, titles[i % titles.length].mediaType === 'movie' ? 'movie' : 'episode'))

describe('watching personality', () => {
  it('needs enough data before naming one', () => {
    const t = make('A', 'tv')
    expect(personalityOf([t], spread([t], Array.from({ length: PERSONALITY_MIN_WATCHES - 1 }, (_, i) => i * 3 + 1)))).toBeNull()
  })

  it('names an anime-only year The Anime Explorer, with the numbers behind it', () => {
    const shows = ['A', 'B', 'C', 'D'].map((x) => make(x, 'anime'))
    // Every 9th day, so no weekday, week or binge habit stands out.
    const p = personalityOf(shows, spread(shows, Array.from({ length: 20 }, (_, i) => i * 9 + 1)))!
    expect(p.main.id).toBe('anime')
    expect(p.main.reason).toBe('100% of your episodes were anime, across 4 series.')
  })

  it('names a movies-only year The Movie Enthusiast', () => {
    const films = Array.from({ length: 12 }, (_, i) => make(`Film ${i}`, 'movie'))
    const p = personalityOf(films, spread(films, Array.from({ length: 12 }, (_, i) => i * 11 + 2)))!
    expect(p.main.id).toBe('movies')
    expect(p.main.reason).toMatch(/^You watched 12 movies: 100% of everything you logged\.$/)
  })

  it('spots a Weekend Warrior from Saturdays and Sundays', () => {
    const t = make('Show', 'tv')
    // 3 January 2026 is a Saturday: every weekend day for 10 weekends, one episode each.
    const days = Array.from({ length: 10 }, (_, w) => [3 + w * 7, 4 + w * 7]).flat()
    const p = personalityOf([t], spread([t], days))!
    expect(p.main.id).toBe('weekend')
    expect(p.main.reason).toContain('100% of everything you watched was on a Saturday or Sunday')
  })

  it('spots a Binge Watcher and a Marathon Watcher from big days', () => {
    const a = make('A', 'tv')
    const history = [1, 15, 29].flatMap((d) => Array.from({ length: 9 }, (_, i) => ep(a, at(2026, 1, d, 10, i * 30), d * 10 + i)))
    const p = personalityOf([a], history)!
    // 3 marathon days (score 1) and every episode in a binge (score 2.5): binge wins, marathon is listed too.
    expect(p.main.id).toBe('binge')
    expect(p.also.map((x) => x.id)).toContain('marathon')
  })

  it('spots a Completionist', () => {
    const shows = Array.from({ length: 5 }, (_, i) => make(`S${i}`, 'tv', { status: 'completed', completedAt: at(2026, 6, 1 + i) }))
    const p = personalityOf(shows, spread(shows, Array.from({ length: 10 }, (_, i) => i * 13 + 5)))!
    expect(p.main.id === 'completionist' || p.also.some((x) => x.id === 'completionist')).toBe(true)
    expect(p.main.reason.length).toBeGreaterThan(0)
  })

  it('spots a Consistent Viewer who watches most weeks', () => {
    const t = make('Show', 'tv')
    const days = Array.from({ length: 40 }, (_, i) => 5 + i * 9) // every 9 days through the year, rotating weekdays
    const p = personalityOf([t], spread([t], days))!
    expect([p.main.id, ...p.also.map((x) => x.id)]).toContain('consistent')
  })

  it('falls back to The Easygoing Viewer when no habit stands out', () => {
    const shows = [make('A', 'tv'), make('B', 'tv'), make('C', 'anime')]
    const p = personalityOf(shows, spread(shows, [1, 40, 80, 120, 160, 200, 240, 280, 320, 360]))!
    expect(p.main.id).toBe('easygoing')
    expect(p.main.reason).toContain('10 watches across 3 titles on 10 days')
  })

  it('is deterministic: the same history always gives the same answer', () => {
    const shows = ['A', 'B', 'C', 'D'].map((x) => make(x, 'anime'))
    const h = spread(shows, Array.from({ length: 20 }, (_, i) => i * 9 + 1))
    expect(personalityOf(shows, h)).toEqual(personalityOf(shows, [...h].reverse()))
  })
})

describe('insights', () => {
  it('only says what the data supports, and never invents a comparison', () => {
    const t = make('Frieren', 'anime')
    const r = build([t], [ep(t, at(2026, 3, 1), 1), ep(t, at(2026, 3, 2), 2)])
    const ids = reviewInsights(r).map((i) => i.id)
    expect(ids).not.toContain('compare')
    expect(ids).not.toContain('month') // 2 watches is too few to call a month "most active"
    expect(ids).not.toContain('completed')
  })

  it('reports year-on-year change, top show, busiest month and completions from real numbers', () => {
    const t = make('Frieren', 'anime', { status: 'completed', completedAt: at(2026, 10, 30) })
    const last = Array.from({ length: 10 }, (_, i) => ep(t, at(2025, 1 + i, 1), i + 1))
    const now = [...Array.from({ length: 8 }, (_, i) => ep(t, at(2026, 10, 1 + i), 20 + i)), ...Array.from({ length: 5 }, (_, i) => ep(t, at(2026, 3, 1 + i), 40 + i))]
    const r = build([t], [ep(t, at(2025, 1, 1, 8), 0), ...last, ...now])
    const text = Object.fromEntries(reviewInsights(r).map((i) => [i.id, i.text]))
    // 13 episodes in 2026 against 11 in 2025: +18%.
    expect(text.compare).toBe('You watched 18% more episodes than in 2025.')
    expect(text.top).toBe('Frieren was your show of the year: 13 episodes, 100% of all your episodes.')
    expect(text.month).toBe('You were most active in October, with 8 watches.')
    expect(text.completed).toBe('You completed 1 series this year.')
  })

  it('compares only the dates logged in both years when logging started partway through last year', () => {
    const t = make('Show', 'tv')
    const last = Array.from({ length: 12 }, (_, i) => ep(t, at(2025, 9, 1 + i), i + 1))
    const febThisYear = Array.from({ length: 3 }, (_, i) => ep(t, at(2026, 2, 1 + i), 20 + i))
    const sepThisYear = Array.from({ length: 6 }, (_, i) => ep(t, at(2026, 9, 1 + i), 30 + i))
    const r = build([t], [...last, ...febThisYear, ...sepThisYear])
    expect(r.comparison).toMatchObject({ narrowed: true, fair: true })
    // September to December: 6 this year against 12 last year. February isn't compared, as 2025 wasn't logged then.
    expect(reviewInsights(r).find((i) => i.id === 'compare')?.text).toBe('You watched 50% fewer episodes than over the same dates in 2025.')
  })

  it('makes no percentage claim from a few overlapping days', () => {
    const t = make('Show', 'tv')
    const r = build([t], [...Array.from({ length: 12 }, (_, i) => ep(t, at(2025, 12, 20, 8, i), i + 1)), ep(t, at(2026, 12, 22), 30)])
    expect(r.comparison?.fair).toBe(false)
    expect(reviewInsights(r).map((i) => i.id)).not.toContain('compare')
  })
})

describe('looking back', () => {
  it('summarises the year from its own facts', () => {
    const t = make('Frieren', 'anime')
    const r = build([t], [1, 2, 3].map((d) => ep(t, at(2026, 4, d), d)))
    expect(lookingBack(r, null)).toBe('In 2026, you watched 3 episodes across 1 title, on 3 different days. Frieren kept pulling you back, 3 times in all. At your best, you didn\'t miss a day for 3 days straight.')
  })
})

describe('headline and standout', () => {
  const base = (over: Omit<Partial<YearReview>, 'stats'> & { stats?: Partial<YearReview['stats']> }): YearReview =>
    ({
      year: 2026,
      inProgress: false,
      titles: 3,
      biggestDay: null,
      busiestMonth: null,
      coverage: { from: '2026-01-01', to: '2026-12-31', days: 365, startedThisYear: false },
      ...over,
      stats: { watches: 20, episodes: 20, movies: 0, minutes: 0, activeDays: 9, longestStreak: null, completedSeries: 0, ...over.stats },
    }) as YearReview

  it('picks the headline from the dominant habit, and from the numbers otherwise', () => {
    const r = base({})
    expect(reviewHeadline(r, { id: 'anime' } as Personality)).toBe('A year full of anime adventures.')
    expect(reviewHeadline(r, null)).toBe('You watched your way through 2026.')
    expect(reviewHeadline(base({ inProgress: true }), null)).toBe('Your 2026, one episode at a time.')
    expect(reviewHeadline(base({ stats: { episodes: 0, movies: 8 } }), null)).toBe('Your 2026, one movie at a time.')
    expect(reviewHeadline(base({ stats: { episodes: 400 } }), { id: 'easygoing' } as Personality)).toBe('Your year, measured in episodes.')
  })

  it('stands out with the best record the year has', () => {
    expect(standoutRecord(base({ stats: { longestStreak: { days: 12, from: '2026-03-01', to: '2026-03-12' } } }))).toMatchObject({ value: '12', unit: 'days in a row' })
    expect(standoutRecord(base({ biggestDay: { day: '2026-05-05', count: 9 } }))).toMatchObject({ value: '9', unit: 'watched in one day' })
    expect(standoutRecord(base({ busiestMonth: { month: 7, count: 14 } }))).toMatchObject({ value: '14', unit: 'watches in August' })
    expect(standoutRecord(base({}))).toMatchObject({ value: '9', unit: 'days with something on' })
  })
})
