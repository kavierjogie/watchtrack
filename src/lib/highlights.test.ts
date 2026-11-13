import { describe, expect, it } from 'vitest'
import type { Highlights, Spot } from './discover'
import { buildHighlights } from './highlights'
import { candidateKey, emptyFeedback, type Candidate } from './recommend'
import { createTitle } from './titles'

const NOW = new Date(2026, 10, 13, 12).getTime() // 13 Nov 2026, local noon
let n = 0
function spot(title: string, extra: Partial<Candidate> = {}, date: string | null = '2026-11-01', season: number | null = null): Spot {
  const id = String(++n)
  const c: Candidate = {
    source: { provider: extra.source?.provider ?? 'kitsu', id, url: '' },
    title,
    altTitles: [],
    mediaType: 'anime',
    year: 2026,
    date,
    synopsis: '',
    genres: ['Action', 'Fantasy'],
    posterUrl: `https://example.test/${id}.jpg`,
    thumbUrl: null,
    backdropUrl: null,
    totalEpisodes: null,
    totalSeasons: null,
    seasonEpisodeCounts: {},
    ongoing: true,
    communityScore: 80,
    popularity: 0.5,
    ...extra,
  }
  return { c, date, season }
}
const empty = (): Highlights => ({ season: [], upcomingAnime: [], premieres: [], airing: [], tmdbTv: null, tmdbMovies: null, tmdbUpcoming: null, tmdbNowPlaying: null, pending: 0, failed: [], tmdbOff: true })
const ALL = { type: 'all' as const, genre: '' }
const titles = (cards: { rec: { c: Candidate } }[]) => cards.map((x) => x.rec.c.title)

describe('buildHighlights', () => {
  it('only says "Trending" for TMDB trending lists, and labels the fallbacks by their real signal', () => {
    const h = { ...empty(), airing: [spot('Show A', { mediaType: 'tv', source: { provider: 'tvmaze', id: 'a', url: '' } }), spot('Show B', { mediaType: 'tv', source: { provider: 'tvmaze', id: 'b', url: '' } })] }
    const off = buildHighlights(h, [], emptyFeedback(), ALL, NOW)
    expect(off.trending.map((r) => r.title)).not.toContain('Trending Series')
    expect(off.trending.flatMap((r) => r.cards).every((x) => !/trending/i.test(x.rec.reason))).toBe(true)

    const tv = [spot('T1', { mediaType: 'tv', source: { provider: 'tmdb', id: 'tv/1', url: '' } }), spot('T2', { mediaType: 'tv', source: { provider: 'tmdb', id: 'tv/2', url: '' } }), spot('T3', { mediaType: 'tv', source: { provider: 'tmdb', id: 'tv/3', url: '' } })]
    const on = buildHighlights({ ...h, tmdbTv: tv }, [], emptyFeedback(), { type: 'tv', genre: '' }, NOW)
    expect(on.trending[0].title).toBe('Trending Series')
    expect(on.trending[0].cards[0].rec.reason).toBe('#1 trending on TMDB this week')
  })

  it('builds a Top 10 that takes turns between categories, without repeating titles in later rows', () => {
    const season = Array.from({ length: 8 }, (_, i) => spot(`Anime ${i}`))
    const airing = Array.from({ length: 8 }, (_, i) => spot(`Show ${i}`, { mediaType: 'tv', source: { provider: 'tvmaze', id: `s${i}`, url: '' } }))
    const r = buildHighlights({ ...empty(), season, airing }, [], emptyFeedback(), ALL, NOW)
    const top = r.trending.find((x) => x.id === 'top')!
    expect(titles(top.cards).slice(0, 4)).toEqual(['Anime 0', 'Show 0', 'Anime 1', 'Show 1'])
    expect(top.cards.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const keys = r.trending.flatMap((x) => x.cards.map((c) => c.rec.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('separates released from upcoming, and puts new seasons of library shows first', () => {
    const tracked = spot('Library Show', { mediaType: 'tv', source: { provider: 'tvmaze', id: '77', url: '' } }, '2026-11-10', 3)
    const other = spot('Other Show', { mediaType: 'tv', source: { provider: 'tvmaze', id: '78', url: '' } }, '2026-11-12', 2)
    const other2 = spot('Other Show 2', { mediaType: 'tv', source: { provider: 'tvmaze', id: '79', url: '' } }, '2026-11-11', 2)
    const premiere = spot('Brand New', { mediaType: 'tv', source: { provider: 'tvmaze', id: '80', url: '' } }, '2026-11-09', 1)
    const premiere2 = spot('Brand New 2', { mediaType: 'tv', source: { provider: 'tvmaze', id: '81', url: '' } }, '2026-11-08', 1)
    const future = spot('Soon Show', { mediaType: 'tv', source: { provider: 'tvmaze', id: '82', url: '' } }, '2026-11-18', 1)
    const future2 = spot('Soon Anime', {}, '2027-01-09')
    const library = [createTitle({ title: 'Library Show', mediaType: 'tv', status: 'watching', source: { provider: 'tvmaze', id: '77', url: '' } })]
    const r = buildHighlights({ ...empty(), premieres: [tracked, other, other2, premiere, premiere2, future], upcomingAnime: [future2] }, library, emptyFeedback(), ALL, NOW)
    const row = (id: string) => r.fresh.find((x) => x.id === id)!
    expect(titles(row('seasons').cards)[0]).toBe('Library Show')
    expect(row('seasons').cards[0].rec.tracked?.title).toBe('Library Show')
    expect(titles(row('new').cards)).toEqual(['Brand New', 'Brand New 2'])
    expect(titles(row('soon').cards).sort()).toEqual(['Soon Anime', 'Soon Show'])
    expect(row('soon').cards.every((x) => x.badge?.tone === 'soon')).toBe(true)
  })

  it('leaves out dismissed titles and respects the type filter', () => {
    const a = spot('Keep'),
      b = spot('Dismiss me'),
      c = spot('Also keep'),
      film = spot('Film', { mediaType: 'movie' })
    const fb = { ...emptyFeedback(), dismissed: { [candidateKey(b.c)]: { at: '', title: 'Dismiss me', mediaType: 'anime' as const, genres: [] } } }
    const r = buildHighlights({ ...empty(), season: [a, b, c, film] }, [], fb, { type: 'anime', genre: '' }, NOW)
    const shown = r.trending.flatMap((x) => titles(x.cards))
    expect(shown).toEqual(['Keep', 'Also keep'])
  })
})
