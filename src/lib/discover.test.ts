import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolState } from './discover'
import type { Candidate } from './recommend'
import { createTitle } from './titles'

type DiscoverModule = typeof import('./discover')

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    clear: () => m.clear(),
    get length() {
      return m.size
    },
  }
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

const mazeShow = (id: number, name: string, genres: string[]) => ({
  id,
  name,
  url: `https://www.tvmaze.com/shows/${id}`,
  premiered: '2015-01-01',
  genres,
  summary: '<p>A show.</p>',
  status: 'Ended',
  type: 'Scripted',
  language: 'English',
  image: { medium: `https://static.tvmaze.com/${id}m.jpg`, original: `https://static.tvmaze.com/${id}.jpg` },
  rating: { average: 8.1 },
  weight: 95,
})

let d: DiscoverModule
beforeEach(async () => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.resetModules() // fresh in-memory cache and feedback store, as on a new visit
  d = await import('./discover')
})

describe('metadata cache', () => {
  it('fetches once, then serves memory and local storage', async () => {
    const fetcher = vi.fn(async () => [1, 2])
    expect(await d.cached('k', 60_000, fetcher)).toEqual([1, 2])
    expect(await d.cached('k', 60_000, fetcher)).toEqual([1, 2])
    expect(fetcher).toHaveBeenCalledTimes(1)
    // A new visit: memory is gone but the stored copy is still fresh.
    vi.resetModules()
    const again = await import('./discover')
    expect(await again.cached('k', 60_000, fetcher)).toEqual([1, 2])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('falls back to a stale copy when the refetch fails', async () => {
    localStorage.setItem('watchtrack:meta:k', JSON.stringify({ at: 0, data: 'old' }))
    expect(await d.cached('k', 1000, () => Promise.reject(new Error('rate limited')))).toBe('old')
  })

  it('throws without a copy, and retries on the next call instead of remembering the failure', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('ok')
    await expect(d.cached('k', 1000, fetcher)).rejects.toThrow('down')
    expect(await d.cached('k', 1000, fetcher)).toBe('ok')
  })

  it('prunes entries older than two weeks and leaves other keys alone', () => {
    localStorage.setItem('watchtrack:meta:old', JSON.stringify({ at: 0, data: 1 }))
    localStorage.setItem('watchtrack:meta:new', JSON.stringify({ at: Date.now(), data: 1 }))
    localStorage.setItem('watchtrack:prefs', '{}')
    d.pruneCache()
    expect(localStorage.getItem('watchtrack:meta:old')).toBeNull()
    expect(localStorage.getItem('watchtrack:meta:new')).not.toBeNull()
    expect(localStorage.getItem('watchtrack:prefs')).toBe('{}')
  })
})

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  source: { provider: 'kitsu', id: '42', url: 'https://kitsu.app/anime/x' },
  title: 'Mob Psycho 100',
  altTitles: [],
  mediaType: 'anime',
  year: 2016,
  date: '2016-07-11',
  synopsis: 'Psychic kid.',
  genres: ['Action', 'Comedy'],
  posterUrl: null,
  thumbUrl: null,
  backdropUrl: null,
  totalEpisodes: 12,
  totalSeasons: null,
  seasonEpisodeCounts: {},
  ongoing: false,
  communityScore: 83,
  popularity: 0.6,
  ...over,
})

describe('feedback persistence', () => {
  it('remembers dismissals and filters across visits', async () => {
    d.dismiss(candidate())
    d.setFilters({ type: 'tv', sort: 'rating' })
    vi.resetModules()
    const next = await import('./discover')
    expect(Object.keys(next.getDiscover().feedback.dismissed)).toEqual(['kitsu:42'])
    expect(next.getDiscover().filters).toMatchObject({ type: 'tv', sort: 'rating', genre: '' })
    next.restoreDismissed()
    expect(next.getDiscover().feedback.dismissed).toEqual({})
  })

  it('dismissing a title drops its "more like this", and undo restores it to the pool', () => {
    expect(d.likeCandidate(candidate())).toBe('liked:kitsu:42')
    d.dismiss(candidate())
    expect(d.getDiscover().feedback.liked).toEqual({})
    d.undismiss('kitsu:42')
    expect(d.getDiscover().feedback.dismissed).toEqual({})
  })

  it('ignores corrupted or tampered storage', async () => {
    localStorage.setItem('watchtrack:discover', JSON.stringify({ feedback: { dismissed: { a: 'nope', b: { title: 1 } } }, filters: 'x' }))
    vi.resetModules()
    const next = await import('./discover')
    expect(next.getDiscover().feedback).toEqual({ dismissed: {}, liked: {} })
    localStorage.setItem('watchtrack:discover', '{not json')
    vi.resetModules()
    expect((await import('./discover')).getDiscover().filters.sort).toBe('match')
  })
})

describe('loadPool', () => {
  const run = async (library = [createTitle({ title: 'Seed', mediaType: 'tv', status: 'completed', genres: ['Drama'] })]) => {
    const updates: PoolState[] = []
    await d.loadPool(library, { dismissed: {}, liked: {} }, 0, null, (s) => updates.push(s))
    return updates[updates.length - 1]
  }

  it('keeps going when one provider is rate-limited, and reports which one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => (url.includes('kitsu') ? json({}, 429) : json([mazeShow(1, 'Broadchurch', ['Drama', 'Crime']), mazeShow(2, 'Luther', ['Crime'])]))),
    )
    const s = await run()
    expect(s.pending).toBe(0)
    expect(s.failed).toEqual([{ provider: 'kitsu', message: expect.stringMatching(/rate-limiting/) }])
    expect(s.pool.map((c) => c.title)).toContain('Broadchurch')
    expect(s.pool.find((c) => c.title === 'Luther')).toMatchObject({ mediaType: 'tv', communityScore: 81, popularity: 0.9 })
  })

  it('never throws when everything is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const s = await run([])
    expect(s.pool).toEqual([])
    expect(s.failed.map((f) => f.provider).sort()).toEqual(['kitsu', 'tvmaze'])
  })

  it("doesn't refetch what it already has", async () => {
    const fetchMock = vi.fn((url: string) =>
      url.includes('kitsu') ? json({ data: [] }) : url.includes('/search/') ? json([]) : json([mazeShow(1, 'Broadchurch', ['Drama'])]),
    )
    vi.stubGlobal('fetch', fetchMock)
    await run()
    const first = fetchMock.mock.calls.length
    expect(first).toBeGreaterThan(0)
    await run()
    expect(fetchMock.mock.calls.length).toBe(first)
  })

  it('asks Kitsu for related titles of a strong seed and links them', async () => {
    const seed = createTitle({ title: 'Mob Psycho 100', mediaType: 'anime', status: 'completed', rating: 9, source: { provider: 'kitsu', id: '11578', url: '' } })
    const anime = (id: number) => ({
      id: String(id),
      type: 'anime',
      attributes: { slug: `s${id}`, canonicalTitle: `Mob ${id}`, titles: {}, subtype: 'TV', startDate: '2019-01-01', posterImage: null, coverImage: null, synopsis: '', status: 'finished', episodeCount: 13, abbreviatedTitles: [] },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/anime/11578/media-relationships'))
          return json({
            data: [
              { attributes: { role: 'sequel' }, relationships: { destination: { data: { type: 'anime', id: '2' } } } },
              { attributes: { role: 'summary' }, relationships: { destination: { data: { type: 'anime', id: '3' } } } },
            ],
            included: [anime(2), anime(3)],
          })
        return url.includes('kitsu') ? json({ data: [] }) : json([])
      }),
    )
    const s = await run([seed])
    expect(s.links).toEqual([{ key: 'kitsu:2', seedId: seed.id, role: 'sequel' }]) // recaps/summaries are skipped
    expect(s.pool.map((c) => c.title)).toContain('Mob 2')
  })
})

describe('inferMetadata', () => {
  it('fills genres and ids for titles without them by exact name only, without changing the saved title', async () => {
    const lost = createTitle({ title: 'Toradora!', mediaType: 'anime', status: 'completed' })
    const fuzzy = createTitle({ title: 'Toradora Two', mediaType: 'anime', status: 'completed' })
    const show = createTitle({ title: 'Luther', mediaType: 'tv', status: 'completed' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('tvmaze')) return json([{ show: mazeShow(2, 'Luther', ['Crime', 'Drama']) }])
        return json({
          data: [
            { id: '3532', attributes: { slug: 'toradora', canonicalTitle: 'Toradora!', titles: { en: 'Toradora!' }, subtype: 'TV', startDate: '2008-10-02', posterImage: null, coverImage: null, synopsis: '', status: 'finished', episodeCount: 25, abbreviatedTitles: [] }, relationships: { categories: { data: [{ id: '1' }] } } },
          ],
          included: [{ id: '1', attributes: { title: 'Romance' } }],
        })
      }),
    )
    const inferred = await d.inferMetadata([lost, fuzzy, show])
    expect(inferred[lost.id]).toEqual({ genres: ['Romance'], source: { provider: 'kitsu', id: '3532', url: 'https://kitsu.app/anime/toradora' } })
    expect(inferred[fuzzy.id]).toBeUndefined() // "Toradora Two" isn't "Toradora!"
    expect(inferred[show.id]?.source.provider).toBe('tvmaze')
    const [filled] = d.withInferred([lost], inferred)
    expect(filled.genres).toEqual(['Romance'])
    expect(lost.genres).toEqual([]) // the user's own record is untouched
  })
})

describe('candidateToTitle', () => {
  it('saves a finished anime as completed, positioned after its last known episode', async () => {
    const t = await d.candidateToTitle(candidate(), 'completed')
    expect(t).toMatchObject({ title: 'Mob Psycho 100', status: 'completed', source: { provider: 'kitsu', id: '42' }, genres: ['Action', 'Comedy'] })
    expect(t.progress).toMatchObject({ numbering: 'absolute', totalEpisodes: 12, nextEpisode: 13 })
    expect(t.completedAt).not.toBeNull()
  })

  it('leaves the position unknown when the episode count is unknown, instead of inventing one', async () => {
    const t = await d.candidateToTitle(candidate({ totalEpisodes: null, ongoing: true }), 'completed')
    expect(t.progress?.nextEpisode).toBeNull()
  })

  it('plans a TV series from episode 1 with season counts, and a movie without progress', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json([{ number: 1, episodeOrder: 8 }, { number: 2, episodeOrder: 6 }])))
    const tv = await d.candidateToTitle(candidate({ mediaType: 'tv', source: { provider: 'tvmaze', id: '7', url: '' } }), 'plan')
    expect(tv.progress).toMatchObject({ numbering: 'seasonal', season: 1, nextEpisode: 1, seasonEpisodeCounts: { 1: 8, 2: 6 }, totalSeasons: 2 })
    const movie = await d.candidateToTitle(candidate({ mediaType: 'movie' }), 'plan')
    expect(movie.progress).toBeNull()
  })
})
