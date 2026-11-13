// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRecap, recapLookup, RECAP_AFTER_DAYS } from './recap'
import { createTitle } from './titles'
import type { MetadataSource, Progress, Title } from './types'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

function show(source: MetadataSource | null, progress: Partial<Progress>, idleDays = 40): Title {
  const t = createTitle({ title: 'Show', mediaType: 'tv', status: 'watching', source }, daysAgo(400))
  return { ...t, progress: { ...t.progress!, ...progress }, lastWatchedAt: daysAgo(idleDays) }
}
const maze = (id = '82') => ({ provider: 'tvmaze' as const, id, url: `https://www.tvmaze.com/shows/${id}` })
const seasonal = { numbering: 'seasonal' as const, season: 2, nextEpisode: 4 }

const fetchMock = vi.fn()
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('recapLookup', () => {
  it('only offers a recap once a show has been idle for a while', () => {
    expect(recapLookup(show(maze(), seasonal, RECAP_AFTER_DAYS - 1), NOW)).toBeNull()
    expect(recapLookup(show(maze(), seasonal, RECAP_AFTER_DAYS), NOW)).toMatchObject({ provider: 'tvmaze', season: 2, episode: 3 })
  })

  it('recaps the last episode watched, never the next one', () => {
    expect(recapLookup(show(maze(), { numbering: 'absolute', season: null, nextEpisode: 173 }), NOW)).toMatchObject({ episode: 172, absolute: true })
  })

  it('has nothing to offer before the first episode, for movies, unlinked titles or AniList', () => {
    expect(recapLookup(show(maze(), { ...seasonal, season: 1, nextEpisode: 1 }), NOW)).toBeNull()
    expect(recapLookup({ ...show(maze(), seasonal), mediaType: 'movie' }, NOW)).toBeNull()
    expect(recapLookup(show(null, seasonal), NOW)).toBeNull()
    expect(recapLookup(show({ provider: 'anilist', id: '1', url: 'https://anilist.co/anime/1' }, seasonal), NOW)).toBeNull()
  })

  it("doesn't guess a TMDB episode from an overall number", () => {
    const tmdb = { provider: 'tmdb' as const, id: 'tv/1399', url: 'https://www.themoviedb.org/tv/1399' }
    expect(recapLookup(show(tmdb, seasonal), NOW)).toMatchObject({ id: '1399', season: 2, episode: 3 })
    expect(recapLookup(show(tmdb, { numbering: 'absolute', season: null, nextEpisode: 9 }), NOW)).toBeNull()
  })
})

describe('getRecap', () => {
  it('asks TVmaze for that exact episode, strips its HTML, and keeps it on this device', async () => {
    fetchMock.mockImplementation(() => json({ name: 'Hello, Ms. Cobel', summary: '<p>Mark &amp; Helly <b>find</b> a room.</p>' }))
    const t = show(maze(), seasonal)
    const r = await getRecap(t, undefined, NOW)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.tvmaze.com/shows/82/episodebynumber?season=2&number=3')
    expect(r).toMatchObject({ name: 'Hello, Ms. Cobel', summary: 'Mark & Helly find a room.', provider: 'tvmaze', episode: { season: 2, episode: 3 } })
    await getRecap(t, undefined, NOW + 1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('counts overall numbering through regular TVmaze episodes, skipping specials', async () => {
    fetchMock.mockImplementation(() =>
      json([
        { season: 1, number: 1, name: 'One', summary: 'first' },
        { season: 1, number: null, type: 'insignificant_special', name: 'Special', summary: 'special' },
        { season: 1, number: 2, name: 'Two', summary: 'second' },
        { season: 2, number: 1, name: 'Three', summary: 'third' },
      ]),
    )
    const r = await getRecap(show(maze('7'), { numbering: 'absolute', season: null, nextEpisode: 4 }), undefined, NOW)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.tvmaze.com/shows/7/episodes')
    expect(r?.name).toBe('Three')
  })

  it('remembers that a provider has no summary, but retries after a failure to reach it', async () => {
    const t = show(maze('9'), seasonal)
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('offline')))
    await expect(getRecap(t, undefined, NOW)).rejects.toThrow()
    fetchMock.mockImplementationOnce(() => json({ error: 'not found' }, 404))
    expect(await getRecap(t, undefined, NOW)).toBeNull()
    expect(await getRecap(t, undefined, NOW)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats an empty summary as none', async () => {
    fetchMock.mockImplementation(() => json({ name: 'Untitled', summary: '<p></p>' }))
    expect(await getRecap(show(maze('11'), seasonal), undefined, NOW)).toBeNull()
  })

  it('uses Kitsu episode synopses and TMDB through the proxy', async () => {
    fetchMock.mockImplementationOnce(() => json({ data: [{ attributes: { number: 3, canonicalTitle: 'Ep 3', synopsis: 'Kitsu text' } }] }))
    const kitsu = await getRecap(show({ provider: 'kitsu', id: '12', url: 'https://kitsu.app/anime/12' }, seasonal), undefined, NOW)
    expect(fetchMock.mock.calls[0][0]).toBe('https://kitsu.app/api/edge/anime/12/episodes?filter[number]=3&fields[episodes]=canonicalTitle,synopsis,description,number')
    expect(kitsu?.summary).toBe('Kitsu text')

    fetchMock.mockImplementationOnce(() => json({ name: 'The Kingsroad', overview: 'TMDB text' }))
    const tmdb = await getRecap(show({ provider: 'tmdb', id: 'tv/1399', url: 'https://www.themoviedb.org/tv/1399' }, seasonal), undefined, NOW)
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/tmdb?path=${encodeURIComponent('tv/1399/season/2/episode/3')}`)
    expect(tmdb?.summary).toBe('TMDB text')
  })

  it('shortens a very long summary at a word', async () => {
    fetchMock.mockImplementation(() => json({ name: 'Long', summary: 'word '.repeat(300) }))
    const r = await getRecap(show(maze('13'), seasonal), undefined, NOW)
    expect(r!.summary.length).toBeLessThanOrEqual(601)
    expect(r!.summary).toMatch(/word…$/)
  })
})
