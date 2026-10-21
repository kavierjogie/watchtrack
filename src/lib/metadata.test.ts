import { afterEach, describe, expect, it, vi } from 'vitest'
import { enrich, MetadataError, searchTitles } from './metadata'

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
        : json([{ show: { id: 1, name: 'Helluva Boss', url: 'https://www.tvmaze.com/shows/1', premiered: '2020-10-31', genres: ['Comedy'], summary: '<p>Imps</p>', status: 'Running', type: 'Animation', image: { medium: 'm.jpg', original: 'o.jpg' } } }]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const [r] = await searchTitles('helluva', 'tvmaze')
    expect(r).toMatchObject({ title: 'Helluva Boss', mediaType: 'tv', year: 2020, posterUrl: 'o.jpg', synopsis: 'Imps', ongoing: true })
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
