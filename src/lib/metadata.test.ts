import { afterEach, describe, expect, it, vi } from 'vitest'
import { combineResults, enrich, findPosters, MetadataError, sameTitle, searchAll, searchTitles, seasonEntries, seasonOf, showName, wholeShowMatch, type MetaResult, type Provider, type SearchState } from './metadata'
import { createTitle, relinkTitle } from './titles'

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
      url.includes('embed[]=episodes')
        ? json({
            id: 1,
            status: 'Running',
            _embedded: {
              episodes: [
                ...Array.from({ length: 8 }, (_, i) => ({ id: i, season: 1, number: i + 1, airdate: '2020-11-01', airstamp: '2020-11-01T00:00:00+00:00' })),
                ...Array.from({ length: 8 }, (_, i) => ({ id: 10 + i, season: 2, number: i + 1, airdate: i < 6 ? '2024-01-01' : '2099-01-01', airstamp: null })),
                { id: 99, season: 2, number: null, type: 'significant_special', airdate: '2024-01-01', airstamp: null },
              ],
            },
          })
        : json([{ show: { id: 1, name: 'Helluva Boss', url: 'https://www.tvmaze.com/shows/1', premiered: '2020-10-31', genres: ['Comedy'], summary: '<p>Imps</p>', status: 'Running', type: 'Animation', image: { medium: 'https://static.tvmaze.com/m.jpg', original: 'https://static.tvmaze.com/o.jpg' } } }]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const [r] = await searchTitles('helluva', 'tvmaze')
    expect(r).toMatchObject({ title: 'Helluva Boss', mediaType: 'tv', year: 2020, posterUrl: 'https://static.tvmaze.com/o.jpg', thumbUrl: 'https://static.tvmaze.com/m.jpg', synopsis: 'Imps', ongoing: true })
    const e = await enrich(r)
    // Only aired episodes count: S2 has 8 listed but 2 are still to come; the special isn't numbered.
    expect(e.seasonEpisodeCounts).toEqual({ 1: 8, 2: 6 })
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
  it('merges the same show from two providers, keeps TVmaze for anime series (all seasons, refreshable), and keeps seasons/films separate', () => {
    const out = combineResults('demon slayer', [kitsuDemonSlayer, mazeDemonSlayer])
    expect(out.map((r) => r.source.id)).toEqual(['41469', '42422', '44081'])
    expect(out[0]).toMatchObject({ source: { provider: 'tvmaze', id: '41469' }, posterUrl: 't.jpg', synopsis: 'Tanjiro…' })
    // Kitsu's names still help later searches.
    expect(out[0].altTitles).toEqual(expect.arrayContaining(['Demon Slayer: Kimetsu no Yaiba', 'Kimetsu no Yaiba']))
  })

  it('drops unrelated filler (Kitsu answers "Breaking Bad" with random anime)', () => {
    const kitsu = [result({ provider: 'kitsu', id: '1', title: 'Ali Baba to 40-hiki no Touzoku', year: 1971 })]
    const maze = [result({ provider: 'tvmaze', id: '169', title: 'Breaking Bad', mediaType: 'tv', year: 2008, date: '2008-01-20' })]
    expect(combineResults('Breaking Bad', [kitsu, maze]).map((r) => r.title)).toEqual(['Breaking Bad'])
  })

  it('matches partial, differently-cased queries and puts closer names first', () => {
    const out = combineResults('DEMON sla', [kitsuDemonSlayer, mazeDemonSlayer])
    expect(out[0].source.id).toBe('41469')
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

  it('collects artwork from every provider that answered, skipping failures, movies and unrelated titles', async () => {
    const show = (id: number, name: string, image: string | null) => ({ show: { ...mazeRow.show, id, name, image: image && { medium: `${image}-m`, original: image } } })
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      url.includes('kitsu')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : url.startsWith('/api/tmdb')
          ? json({ results: [
              { id: 1396, media_type: 'tv', name: 'Breaking Bad', first_air_date: '2008-01-20', overview: '', poster_path: '/bb.jpg', backdrop_path: null },
              { id: 559969, media_type: 'movie', title: 'El Camino: A Breaking Bad Movie', release_date: '2019-10-11', overview: '', poster_path: '/ec.jpg', backdrop_path: null },
            ] })
          : json([show(169, 'Breaking Bad', 'https://tvmaze/bb.jpg'), show(2, 'Breaking Bad', null), show(3, 'Better Call Saul', 'https://tvmaze/bcs.jpg')]),
    ))
    const out = await findPosters('Breaking Bad', 'tv')
    expect(out.map((o) => [o.provider, o.posterUrl])).toEqual([
      ['tvmaze', 'https://tvmaze/bb.jpg'],
      ['tmdb', 'https://image.tmdb.org/t/p/w500/bb.jpg'],
    ])
    expect(out[0]).toMatchObject({ thumbUrl: 'https://tvmaze/bb.jpg-m', label: 'Breaking Bad · 2008' })
  })

  it('shows results from the providers that answered when another fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (url.includes('kitsu') ? Promise.reject(new TypeError('Failed to fetch')) : url.startsWith('/api/tmdb') ? json({ results: [] }) : json([mazeRow]))))
    await searchAll('  Breaking   BAD ', new AbortController().signal, () => {})
    expect(vi.mocked(fetch).mock.calls.map((c) => String(c[0]))).toContain(`/api/tmdb?path=${encodeURIComponent('search/multi?include_adult=false&query=breaking%20bad')}`)
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

describe('linking a single-season anime entry to the whole show', () => {
  const s1 = createTitle({
    title: 'My Hero Academia',
    altTitles: ['Boku no Hero Academia'],
    year: 2016,
    mediaType: 'anime',
    source: { provider: 'kitsu', id: '11469', url: '' },
    progress: { numbering: 'seasonal', season: 5, nextEpisode: 3, seasonEpisodeCounts: { 1: 13 }, totalSeasons: 1, totalEpisodes: 13, skipped: [], rewatching: false },
    sync: { checkedAt: '2026-01-01', changedAt: null, ongoing: false, aired: 13, nextAiring: null, anilistId: 21459, sequel: null },
  })

  it('matches the show by name and premiere year, never a later season or namesake', () => {
    const show = result({ provider: 'tvmaze', id: '13615', title: 'My Hero Academia', year: 2016 })
    const others = [
      result({ provider: 'tvmaze', id: '1', title: 'My Hero Academia: Vigilantes', year: 2025 }),
      result({ provider: 'tvmaze', id: '2', title: 'My Hero Academia', year: 2030 }),
    ]
    expect(wholeShowMatch(s1, [...others, show])).toBe(show)
    expect(wholeShowMatch(s1, others)).toBeNull()
    expect(wholeShowMatch({ ...s1, title: 'MHA' }, [result({ provider: 'tvmaze', id: '3', title: 'Boku no Hero Academia', year: 2016 })])?.source.id).toBe('3')
  })

  it('matches a later-season entry to its show only when asked, and only by a stripped season name', () => {
    const show = result({ provider: 'tvmaze', id: '13615', title: 'My Hero Academia', year: 2016 })
    const s2 = { title: 'My Hero Academia Season 2', altTitles: ['Boku no Hero Academia 2nd Season'], year: 2017 }
    expect(wholeShowMatch(s2, [show])).toBeNull()
    expect(wholeShowMatch(s2, [show], true)).toBe(show)
    // A show that started after the season can't be its parent; a same-name remake without a season part isn't a season.
    expect(wholeShowMatch(s2, [result({ provider: 'tvmaze', id: '9', title: 'My Hero Academia', year: 2030 })], true)).toBeNull()
    expect(wholeShowMatch({ title: 'Hunter x Hunter', altTitles: [], year: 2011 }, [result({ provider: 'tvmaze', id: '5', title: 'Hunter x Hunter', year: 1999 })], true)).toBeNull()
  })

  it('folds season entries away only when their whole show is in the results', () => {
    const show = result({ provider: 'tvmaze', id: '60', title: 'Spy×Family', year: 2022 })
    const part2 = result({ provider: 'kitsu', id: '1', title: 'SPY x FAMILY Part 2', year: 2022 })
    const s2 = result({ provider: 'kitsu', id: '2', title: 'SPY x FAMILY Season 2', year: 2023 })
    const special = result({ provider: 'kitsu', id: '3', title: 'Ayataka Spy x Family Movie Campaign', year: 2024 })
    expect([...seasonEntries([show, part2, s2, special])]).toEqual([part2, s2])
    // No whole show listed: the season entries are all there is, so nothing is hidden.
    expect(seasonEntries([part2, s2]).size).toBe(0)
  })

  it('reads the season number and split-season parts from an entry name', () => {
    expect(seasonOf('Mushoku Tensei: Jobless Reincarnation Season 2')).toEqual({ season: 2, part: false })
    expect(seasonOf('Mushoku Tensei: Isekai Ittara Honki Dasu 3rd Season')).toEqual({ season: 3, part: false })
    expect(seasonOf('SPY x FAMILY Part 2')).toEqual({ season: null, part: true })
    expect(seasonOf('Attack on Titan: Season 3 Part 2')).toEqual({ season: 3, part: true })
    expect(seasonOf('Frieren')).toEqual({ season: null, part: false })
  })

  it('strips the season part from a season entry name', () => {
    expect(showName('My Hero Academia Season 2')).toBe('My Hero Academia')
    expect(showName('Attack on Titan: Season 3 Part 2')).toBe('Attack on Titan')
    expect(showName('Mob Psycho 100 II')).toBe('Mob Psycho 100 II')
    expect(showName('Mob Psycho 100')).toBe('Mob Psycho 100')
  })

  it("relinks keeping the user's position but dropping the old source's counts and sync state", () => {
    const show = result({ provider: 'tvmaze', id: '13615', title: 'My Hero Academia', year: 2016, ongoing: true, seasonEpisodeCounts: { 1: 13, 2: 25 } })
    const t = relinkTitle(s1, show)
    expect(t.source).toEqual(show.source)
    expect(t.sync).toBeUndefined()
    expect(t.progress).toMatchObject({ season: 5, nextEpisode: 3, seasonEpisodeCounts: { 1: 13, 2: 25 }, totalSeasons: null, totalEpisodes: null })
    expect(t.title).toBe('My Hero Academia')
  })
})
