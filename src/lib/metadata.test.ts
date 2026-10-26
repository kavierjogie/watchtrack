import { afterEach, describe, expect, it, vi } from 'vitest'
import { combineResults, enrich, MetadataError, sameTitle, searchAll, searchTitles, type MetaResult, type Provider, type SearchState } from './metadata'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

afterEach(() => vi.unstubAllGlobals())

describe('metadata providers (mocked network)', () => {
  it('maps Kitsu results, genres from included categories, and strips HTML from synopsis', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      json({
        data: [
          {
            id: '13209',
            attributes: {
              slug: 'black-clover-tv',
              canonicalTitle: 'Black Clover',
              titles: { en: 'Black Clover', en_jp: 'Black Clover', ja_jp: 'ブラッククローバー' },
              abbreviatedTitles: [],
              synopsis: 'Asta<br>wants to be <i>Wizard King</i>.',
              startDate: '2017-10-03',
              subtype: 'TV',
              status: 'finished',
              episodeCount: 170,
              posterImage: { original: 'https://media.kitsu.app/x.jpg' },
              coverImage: null,
            },
            relationships: { categories: { data: [{ id: '1' }, { id: '2' }] } },
          },
        ],
        included: [
          { id: '1', attributes: { title: 'Action' } },
          { id: '2', attributes: { title: 'Fantasy' } },
        ],
      }),
    ))
    const [r] = await searchTitles('black clover', 'kitsu')
    expect(r).toMatchObject({ title: 'Black Clover', mediaType: 'anime', year: 2017, totalEpisodes: 170, ongoing: false, posterUrl: 'https://media.kitsu.app/x.jpg', genres: ['Action', 'Fantasy'] })
    expect(r.synopsis).toBe('Asta\nwants to be Wizard King.')
    expect(r.altTitles).toEqual(['ブラッククローバー'])
  })

  it('maps TVmaze search and fills season episode counts on enrich', async () => {
    const fetchMock = vi.fn((url: string) =>
      url.includes('/seasons')
        ? json([{ number: 1, episodeOrder: 8 }, { number: 2, episodeOrder: 8 }])
        : json([{ show: { id: 1, name: 'Helluva Boss', url: 'https://www.tvmaze.com/shows/1', premiered: '2020-10-31', genres: ['Comedy'], summary: '<p>Imps</p>', status: 'Running', type: 'Animation', image: { medium: 'https://static.tvmaze.com/m.jpg', original: 'https://static.tvmaze.com/o.jpg' } } }]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const [r] = await searchTitles('helluva', 'tvmaze')
    expect(r).toMatchObject({ title: 'Helluva Boss', mediaType: 'tv', year: 2020, posterUrl: 'https://static.tvmaze.com/o.jpg', thumbUrl: 'https://static.tvmaze.com/m.jpg', synopsis: 'Imps', ongoing: true })
    const e = await enrich(r)
    expect(e.seasonEpisodeCounts).toEqual({ 1: 8, 2: 8 })
    expect(e.totalSeasons).toBeNull() // still running: never assume the last known season is the end
  })

  it('turns rate limits and network failures into friendly errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({}, 429)))
    await expect(searchTitles('x', 'tvmaze')).rejects.toThrow(/rate-limiting/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(searchTitles('x', 'kitsu')).rejects.toBeInstanceOf(MetadataError)
  })
})

const result = (o: Partial<MetaResult> & { provider: Provider; id: string; title: string }): MetaResult => ({
  source: { provider: o.provider, id: o.id, url: `https://example.test/${o.id}` },
  altTitles: [],
  mediaType: 'anime',
  year: null,
  date: null,
  synopsis: '',
  genres: [],
  posterUrl: null,
  thumbUrl: null,
  backdropUrl: null,
  totalEpisodes: null,
  totalSeasons: null,
  seasonEpisodeCounts: {},
  ongoing: false,
  ...o,
})

// Shapes and values taken from real Kitsu / TVmaze answers for these queries.
const kitsuDemonSlayer = [
  result({ provider: 'kitsu', id: '41370', title: 'Demon Slayer: Kimetsu no Yaiba', altTitles: ['Kimetsu no Yaiba'], year: 2019, date: '2019-04-06', totalEpisodes: 26, posterUrl: 'k.jpg' }),
  result({ provider: 'kitsu', id: '42422', title: 'Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train', mediaType: 'movie', year: 2020, date: '2020-10-16' }),
  result({ provider: 'kitsu', id: '44081', title: 'Demon Slayer: Kimetsu no Yaiba - Entertainment District Arc', year: 2021, date: '2021-12-05' }),
  result({ provider: 'kitsu', id: '11891', title: 'Onigiri', year: 2016, date: '2016-04-07' }),
]
const mazeDemonSlayer = [result({ provider: 'tvmaze', id: '41469', title: 'Demon Slayer', year: 2019, date: '2019-04-06', synopsis: 'Tanjiro…', posterUrl: 't.jpg' })]

describe('unified search', () => {
  it('merges the same show from two providers, keeps the richer source, and keeps seasons/films separate', () => {
    const out = combineResults('demon slayer', [kitsuDemonSlayer, mazeDemonSlayer])
    expect(out.map((r) => r.source.id)).toEqual(['41370', '42422', '44081'])
    expect(out[0]).toMatchObject({ source: { provider: 'kitsu', id: '41370' }, totalEpisodes: 26, posterUrl: 'k.jpg', synopsis: 'Tanjiro…' })
    expect(out[0].altTitles).toContain('Demon Slayer')
  })

  it('drops unrelated filler (Kitsu answers "Breaking Bad" with random anime)', () => {
    const kitsu = [result({ provider: 'kitsu', id: '1', title: 'Ali Baba to 40-hiki no Touzoku', year: 1971 })]
    const maze = [result({ provider: 'tvmaze', id: '169', title: 'Breaking Bad', mediaType: 'tv', year: 2008, date: '2008-01-20' })]
    expect(combineResults('Breaking Bad', [kitsu, maze]).map((r) => r.title)).toEqual(['Breaking Bad'])
  })

  it('matches partial, differently-cased queries and puts closer names first', () => {
    const out = combineResults('DEMON sla', [kitsuDemonSlayer, mazeDemonSlayer])
    expect(out[0].source.id).toBe('41370')
    expect(out.some((r) => r.title === 'Onigiri')).toBe(false)
  })

  it('never merges on name alone: remakes, other types and unknown dates stay separate', () => {
    const a = result({ provider: 'kitsu', id: '1', title: 'Hunter x Hunter', year: 1999, date: '1999-10-16' })
    expect(sameTitle(a, result({ provider: 'tvmaze', id: '2', title: 'Hunter x Hunter', year: 2011, date: '2011-10-02' }))).toBe(false)
    expect(sameTitle(a, result({ provider: 'tvmaze', id: '3', title: 'Hunter x Hunter', mediaType: 'tv', year: 1999 }))).toBe(false)
    expect(sameTitle(a, result({ provider: 'tvmaze', id: '4', title: 'Hunter x Hunter' }))).toBe(false)
    expect(sameTitle(a, result({ provider: 'tvmaze', id: '5', title: 'HUNTER X HUNTER!', year: 1999 }))).toBe(true)
  })

  it('matches query words against the start of title words, not letters spanning words', () => {
    const maze = [result({ provider: 'tvmaze', id: '1', title: "James Ellroy's LA: City of Demons", mediaType: 'tv' })]
    expect(combineResults('demon sla', [kitsuDemonSlayer, maze]).some((r) => r.source.id === '1')).toBe(false)
    expect(combineResults('zzqxqv nothing', [kitsuDemonSlayer, maze])).toEqual([])
  })

  const mazeRow = { show: { id: 169, name: 'Breaking Bad', url: 'https://www.tvmaze.com/shows/169', premiered: '2008-01-20', genres: ['Drama'], summary: null, status: 'Ended', type: 'Scripted', language: 'English', image: null } }

  it('shows results from the providers that answered when another fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (url.includes('kitsu') ? Promise.reject(new TypeError('Failed to fetch')) : json([mazeRow]))))
    const updates: SearchState[] = []
    await searchAll('breaking bad', new AbortController().signal, (s) => updates.push(s))
    const last = updates.at(-1)!
    expect(last).toMatchObject({ pending: 0, failed: ['kitsu'], error: null })
    expect(last.results.map((r) => r.title)).toEqual(['Breaking Bad'])
    expect(last.results[0]).toMatchObject({ posterUrl: null, synopsis: '', source: { provider: 'tvmaze', id: '169' } })
  })

  it('reports an error only when every provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({}, 500)))
    const updates: SearchState[] = []
    await searchAll('breaking bad', new AbortController().signal, (s) => updates.push(s))
    expect(updates[0].error).toBeNull()
    expect(updates.at(-1)).toMatchObject({ pending: 0, results: [], error: expect.stringMatching(/Couldn't reach any search source/) })
  })

  it('never reports a search that was replaced by a newer one, even if it answers last', async () => {
    let releaseOld!: () => void
    const gate = new Promise<void>((r) => (releaseOld = r))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('q=old') || url.includes('%5Btext%5D=old') || url.includes('[text]=old')) await gate
      return url.includes('kitsu') ? json({ data: [] }) : json([mazeRow])
    }))
    const seen: string[] = []
    const old = new AbortController()
    const oldRun = searchAll('old', old.signal, (s) => seen.push(s.query))
    old.abort() // user kept typing
    await searchAll('breaking bad', new AbortController().signal, (s) => seen.push(s.query))
    releaseOld()
    await oldRun
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((q) => q === 'breaking bad')).toBe(true)
  })
})
