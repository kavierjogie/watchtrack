import { afterEach, describe, expect, it, vi } from 'vitest'
import { bucketDates, countdown, dayFrom, isPast, localDay, releaseBucket } from './format'
import type { Progress, Release, Sequel, Title } from './types'
import { episodeCode, upcomingEpisodes } from './upcoming'

// Friday 30 Oct 2026, midday local.
const NOW = new Date(2026, 9, 30, 12).getTime()
const ep = (season: number | null, episode: number | null, airdate: string | null, name: string | null = null): Release => ({ kind: 'episode', season, episode, name, airdate })
const seasonRelease = (season: number, airdate: string | null): Release => ({ kind: 'season', season, episode: null, name: null, airdate })
const show = (upcoming: Release[] | undefined, over: Partial<Title> = {}, progress: Partial<Progress> = {}) =>
  ({
    id: 'a',
    title: 'Show',
    mediaType: 'tv',
    status: 'watching',
    progress: { numbering: 'seasonal', season: 2, nextEpisode: 3, seasonEpisodeCounts: {}, totalSeasons: null, totalEpisodes: null, skipped: [], rewatching: false, ...progress },
    sync: { upcoming },
    ...over,
  }) as unknown as Title
const codes = (titles: Title[], now = NOW) => upcomingEpisodes(titles, now).map(episodeCode)

describe('upcomingEpisodes', () => {
  it('lists future episodes soonest first, with no time last on its day', () => {
    const rows = upcomingEpisodes([show([ep(2, 5, '2026-11-02'), ep(2, 3, '2026-11-02T20:00:00Z'), ep(2, 4, '2026-10-31')])], NOW)
    expect(rows.map(episodeCode)).toEqual(['S02 E04', 'S02 E03', 'S02 E05'])
  })

  it('keeps an episode dated today but drops anything already aired', () => {
    const later = new Date(2026, 9, 30, 20).toISOString()
    const earlier = new Date(2026, 9, 30, 9).toISOString()
    expect(codes([show([ep(2, 3, '2026-10-30'), ep(2, 4, later), ep(2, 5, earlier), ep(2, 6, '2026-10-29')])])).toEqual(['S02 E04', 'S02 E03'])
  })

  it('an episode leaves by itself once its time passes', () => {
    const at = new Date(2026, 9, 30, 20).toISOString()
    expect(codes([show([ep(2, 3, at)])], new Date(2026, 9, 30, 19).getTime())).toHaveLength(1)
    expect(codes([show([ep(2, 3, at)])], new Date(2026, 9, 30, 21).getTime())).toHaveLength(0)
  })

  it('leaves out watched and skipped episodes, and updates when progress moves', () => {
    const list = [ep(1, 12, '2026-11-01'), ep(2, 2, '2026-11-02'), ep(2, 3, '2026-11-03'), ep(2, 4, '2026-11-04')]
    expect(codes([show(list)])).toEqual(['S02 E03', 'S02 E04'])
    expect(codes([show(list, {}, { nextEpisode: 4 })])).toEqual(['S02 E04'])
    expect(codes([show(list, {}, { skipped: [{ season: 2, from: 3, to: 3 }] })])).toEqual(['S02 E04'])
  })

  it('always lists the next airing the Caught up card announces, even with the position past it', () => {
    // Black Clover: 174 aired, 175 due, position wrongly at 176.
    const list = [ep(null, 175, '2026-11-01T14:00:00Z'), ep(null, 176, '2026-11-08T14:00:00Z')]
    const sync = { upcoming: list, nextAiring: { season: null, episode: 175, airdate: '2026-11-01T14:00:00Z' } } as unknown as Title['sync']
    const absolute = { numbering: 'absolute', season: null } as const
    expect(codes([show(list, { sync }, { ...absolute, nextEpisode: 176 })])).toEqual(['Episode 175', 'Episode 176'])
    // Later episodes still follow the position.
    expect(codes([show(list, { sync }, { ...absolute, nextEpisode: 177 })])).toEqual(['Episode 175'])
  })

  it('uses running numbers for absolute numbering', () => {
    expect(codes([show([ep(null, 1100, '2026-11-01'), ep(null, 1101, '2026-11-08')], {}, { numbering: 'absolute', season: null, nextEpisode: 1101 })])).toEqual(['Episode 1101'])
  })

  it('never hides an episode it cannot place, or crashes on an unknown position', () => {
    expect(codes([show([ep(null, 1, '2026-11-01')])])).toEqual(['Episode 1'])
    expect(codes([show([ep(2, 1, '2026-11-01')], {}, { nextEpisode: null })])).toEqual(['S02 E01'])
    expect(codes([show([ep(null, null, '2026-11-01')])])).toEqual(['Next episode'])
  })

  it('skips missing and broken dates, movies, dropped and unrefreshed titles', () => {
    expect(codes([show([ep(2, 3, null), ep(2, 4, 'soon'), seasonRelease(3, null)])])).toEqual([])
    expect(codes([show([ep(2, 3, '2026-11-01')], { mediaType: 'movie' })])).toEqual([])
    expect(codes([show([ep(2, 3, '2026-11-01')], { status: 'dropped' })])).toEqual([])
    expect(codes([show(undefined, { sync: undefined })])).toEqual([])
  })

  it('a dated premiere is the first episode, without repeating one the provider also lists', () => {
    expect(codes([show([seasonRelease(3, '2026-12-01')])])).toEqual(['S03 E01'])
    expect(codes([show([seasonRelease(3, '2026-12-01'), ep(3, 1, '2026-12-01T20:00:00Z')])])).toEqual(['S03 E01'])
    expect(upcomingEpisodes([show([seasonRelease(3, '2026-12-01'), ep(3, 1, '2026-12-01T20:00:00Z')])], NOW)[0].kind).toBe('episode')
  })

  it('an announced anime sequel only counts once it has a full date', () => {
    const sequel = (startDate: string): Sequel => ({ anilistId: 1, title: 'Show 2', status: 'NOT_YET_RELEASED', startDate, url: '' })
    const withSequel = (startDate: string) => show([], { sync: { upcoming: [], sequel: sequel(startDate) } as unknown as Title['sync'] })
    expect(codes([withSequel('2027-01')])).toEqual([])
    expect(codes([withSequel('2027-01-10')])).toEqual(['New season'])
  })

  it('drops the same episode from a show added twice', () => {
    expect(codes([show([ep(2, 3, '2026-11-01')]), show([ep(2, 3, '2026-11-01T10:00:00Z')], { id: 'b', title: ' show ' })])).toHaveLength(1)
  })

  it('falls back to the next airing on titles refreshed before the list was stored', () => {
    expect(codes([show(undefined, { sync: { nextAiring: { season: 2, episode: 3, airdate: '2026-11-01' } } as Title['sync'] })])).toEqual(['S02 E03'])
  })

  it('hides placeholder episode names', () => {
    const names = upcomingEpisodes([show([ep(2, 3, '2026-11-01', 'TBA'), ep(2, 4, '2026-11-02', 'Episode 4'), ep(2, 5, '2026-11-03', 'The End')])], NOW).map((r) => r.name)
    expect(names).toEqual([null, null, 'The End'])
  })
})

describe('calendar days', () => {
  it('groups by the viewer\'s days', () => {
    expect(releaseBucket('2026-10-30', NOW)).toBe('Today')
    expect(releaseBucket('2026-10-31', NOW)).toBe('Tomorrow')
    expect(releaseBucket('2026-11-01', NOW)).toBe('This Week')
    expect(releaseBucket('2026-11-02', NOW)).toBe('Next Week')
    expect(releaseBucket('2026-11-08', NOW)).toBe('Next Week')
    expect(releaseBucket('2026-11-09', NOW)).toBe('Later')
  })

  it('on a Sunday, tomorrow beats next week', () => {
    const sunday = new Date(2026, 10, 1, 12).getTime()
    expect(releaseBucket('2026-11-02', sunday)).toBe('Tomorrow')
    expect(releaseBucket('2026-11-03', sunday)).toBe('Next Week')
  })

  it('counts down in hours today, then calendar days', () => {
    expect(countdown(new Date(2026, 9, 30, 15).toISOString(), NOW)).toBe('in 3 hours')
    expect(countdown('2026-10-30', NOW)).toBe('today')
    expect(countdown(new Date(2026, 9, 31, 1).toISOString(), NOW)).toBe('tomorrow')
    expect(countdown('2026-11-01', NOW)).toBe('in 2 days')
  })

  it('names the dates a heading covers', () => {
    expect(bucketDates('Today', NOW)).toContain('30')
    expect(bucketDates('Later', NOW)).toContain('9')
    expect(bucketDates('Later', NOW)).toMatch(/^From /)
  })

  it('crosses daylight saving without losing a day', () => {
    // UK clocks go back on Sun 25 Oct 2026, US on Sun 1 Nov.
    expect(dayFrom(new Date(2026, 9, 24, 12).getTime(), 2)).toBe('2026-10-26')
    expect(dayFrom(NOW, 3)).toBe('2026-11-02')
  })
})

describe('time zones', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('a timestamp lands on the viewer\'s own day; a date-only value never moves', () => {
    const stamp = '2026-11-01T01:00:00Z'
    vi.stubEnv('TZ', 'America/New_York')
    expect(localDay(stamp)).toBe('2026-10-31')
    expect(localDay('2026-11-01')).toBe('2026-11-01')
    vi.stubEnv('TZ', 'Asia/Tokyo')
    expect(localDay(stamp)).toBe('2026-11-01')
    expect(localDay('2026-11-01')).toBe('2026-11-01')
  })

  it('a date-only release stays until the day ends, west and east of UTC', () => {
    for (const tz of ['Pacific/Honolulu', 'Pacific/Auckland']) {
      vi.stubEnv('TZ', tz)
      expect(isPast('2026-10-30', new Date(2026, 9, 30, 23, 30).getTime())).toBe(false)
      expect(isPast('2026-10-30', new Date(2026, 9, 31, 0, 30).getTime())).toBe(true)
    }
  })
})
