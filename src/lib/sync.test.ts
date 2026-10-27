import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackup, parseBackup, planImport, resolveImport } from './backup'
import { clearAll, getTitle, saveTitle, updateTitle } from './db'
import { markWatched, position, setLastWatched } from './progress'
import { isDue, mergeEpisodeInfo, refreshTitle, syncLibrary, type EpisodeInfo, type Patch } from './sync'
import { createTitle } from './titles'
import type { Title } from './types'

const NOW = '2026-10-27T12:00:00.000Z'
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

/** Stranger Things as saved before season 5 existed: user finished S4E8 of 9, marked completed. */
function strangerThings(over: Partial<Title> = {}): Title {
  const t = createTitle({
    title: 'Stranger Things',
    mediaType: 'tv',
    status: 'completed',
    rating: 9,
    notes: 'Rewatch S1 before S5',
    tags: ['shared-with-sam'],
    source: { provider: 'tvmaze', id: '2993', url: 'https://www.tvmaze.com/shows/2993' },
  })
  t.progress = { ...t.progress!, season: 4, nextEpisode: 9, seasonEpisodeCounts: { 1: 8, 2: 9, 3: 8, 4: 9 }, totalSeasons: 4 }
  return { ...t, ...over }
}

const info = (seasons: Record<number, number>, extra: Partial<EpisodeInfo> = {}): EpisodeInfo => {
  const n = Object.values(seasons).reduce((a, b) => a + b, 0)
  return { ongoing: false, seasons, aired: n || null, total: n || null, next: null, ...extra }
}

/** Episode list as TVmaze's ?embed=episodes returns it. */
const mazeShow = (status: string, seasons: Record<number, number>, upcoming: { season: number; number: number }[] = []) => ({
  id: 2993,
  status,
  _embedded: {
    episodes: [
      ...Object.entries(seasons).flatMap(([s, n]) =>
        Array.from({ length: n }, (_, i) => ({ id: Number(s) * 100 + i, season: Number(s), number: i + 1, airdate: '2020-01-01', airstamp: '2020-01-01T00:00:00+00:00' })),
      ),
      ...upcoming.map((u) => ({ id: 9000 + u.number, season: u.season, number: u.number, airdate: '2099-12-25', airstamp: '2099-12-25T01:00:00+00:00' })),
    ],
  },
})

/** In-memory store with the same read-modify-write contract as library.patch. */
function memoryStore(titles: Title[]) {
  const map = new Map(titles.map((t) => [t.id, t]))
  const patch: Patch = async (id, fn) => {
    const cur = map.get(id)
    const next = cur && fn(cur)
    if (next) map.set(id, next)
    return next ?? cur
  }
  return { map, patch }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('mergeEpisodeInfo', () => {
  it('Scenario A: a new season appears; progress, status and user data are untouched', () => {
    const t = strangerThings()
    const { title, changed } = mergeEpisodeInfo(t, info({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 }), NOW)
    expect(changed).toBe(true)
    expect(title.progress!.seasonEpisodeCounts).toEqual({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 })
    expect(title.progress!.totalSeasons).toBe(5)
    expect(title.progress!.season).toBe(4)
    expect(title.progress!.nextEpisode).toBe(9)
    expect(title).toMatchObject({ status: 'completed', rating: 9, notes: t.notes, tags: t.tags, createdAt: t.createdAt, updatedAt: t.updatedAt, source: t.source })
    expect(title.sync).toMatchObject({ checkedAt: NOW, changedAt: NOW, ongoing: false })
  })

  it('revived show: S5 starts after the user finished S4, and the next mark crosses into it unwatched', () => {
    const t = strangerThings()
    t.progress = { ...t.progress!, nextEpisode: 10 } // all 9 of S4 watched → "series finished" before the refresh
    expect(position(t.progress).state).toBe('series-finished')
    const { title } = mergeEpisodeInfo(t, info({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 4 }, { ongoing: true, total: null }), NOW)
    expect(title.progress!.totalSeasons).toBeNull() // running again: end unknown
    expect(position(title.progress!)).toEqual({ state: 'season-finished', season: 4 })
    // Nothing in S5 is marked watched: the pointer still sits right after S4.
    expect(title.progress!.season).toBe(4)
  })

  it('Scenario B: more episodes in an existing season, without resetting progress', () => {
    const t = strangerThings()
    t.progress = { ...t.progress!, season: 5, nextEpisode: 4, seasonEpisodeCounts: { ...t.progress!.seasonEpisodeCounts, 5: 8 }, totalSeasons: null }
    const { title, changed } = mergeEpisodeInfo(t, info({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 10 }, { ongoing: true }), NOW)
    expect(changed).toBe(true)
    expect(title.progress!.seasonEpisodeCounts[5]).toBe(10)
    expect(title.progress!.nextEpisode).toBe(4)
  })

  it('refreshing with the same data repeatedly changes nothing and creates no duplicates', () => {
    const data = info({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 })
    const once = mergeEpisodeInfo(strangerThings(), data, NOW).title
    const twice = mergeEpisodeInfo(once, data, '2026-10-28T12:00:00.000Z')
    expect(twice.changed).toBe(false)
    expect(twice.title.progress).toEqual(once.progress)
    expect(twice.title.sync?.changedAt).toBe(NOW) // still the day something actually changed
  })

  it('Scenario C: upcoming episodes are shown but never counted', () => {
    const t = strangerThings()
    t.progress = { ...t.progress!, season: 5, nextEpisode: 5, seasonEpisodeCounts: { ...t.progress!.seasonEpisodeCounts, 5: 4 }, totalSeasons: null }
    const next = { season: 5, episode: 5, airdate: '2099-12-25T01:00:00+00:00' }
    const { title } = mergeEpisodeInfo(t, info({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 4 }, { ongoing: true, total: null, next }), NOW)
    expect(title.sync?.nextAiring).toEqual(next)
    expect(title.progress!.seasonEpisodeCounts[5]).toBe(4)
    // S5E5 hasn't aired: you can't mark it watched.
    expect(position(title.progress!).state).toBe('season-finished')
    expect(markWatched(title.progress!)).toBeNull()
  })

  it('Scenario D/E: a partial, empty or renumbered answer never removes seasons or episodes', () => {
    const t = strangerThings()
    for (const partial of [info({}), info({ 1: 8, 2: 9 }), info({ 1: 3, 2: 2, 3: 1, 4: 1 }), info({ 0: 5, [-1]: 3, 4: 2.5 } as Record<number, number>)]) {
      const { title, changed } = mergeEpisodeInfo(t, partial, NOW)
      expect(changed).toBe(false)
      expect(title.progress!.seasonEpisodeCounts).toEqual(t.progress!.seasonEpisodeCounts)
      expect(title.progress!.totalSeasons).toBe(4)
    }
  })

  it('filling counts for the first time is not announced as new episodes', () => {
    const t = strangerThings()
    t.progress = { ...t.progress!, seasonEpisodeCounts: {}, totalSeasons: null }
    const { title, changed } = mergeEpisodeInfo(t, info({ 1: 8, 2: 9 }, { ongoing: true }), NOW)
    expect(changed).toBe(false)
    expect(title.progress!.seasonEpisodeCounts).toEqual({ 1: 8, 2: 9 })
  })

  it('absolute numbering (anime): totals only grow, seasons are never invented, next airing becomes an overall number', () => {
    const t = createTitle({ title: 'Frieren', mediaType: 'anime', status: 'watching', source: { provider: 'tvmaze', id: '1', url: '' } })
    t.progress = setLastWatched(t.progress!, null, 20)
    const r = mergeEpisodeInfo(t, info({ 1: 28, 2: 3 }, { ongoing: true, total: null, next: { season: 2, episode: 4, airdate: '2099-01-01' } }), NOW)
    expect(r.title.progress!.seasonEpisodeCounts).toEqual({})
    expect(r.title.progress!.totalEpisodes).toBeNull()
    expect(r.title.progress!.nextEpisode).toBe(21)
    expect(r.title.sync).toMatchObject({ aired: 31, nextAiring: { season: null, episode: 32 } })
    const later = mergeEpisodeInfo(r.title, info({ 1: 28, 2: 5 }, { ongoing: true, total: null }), NOW)
    expect(later.changed).toBe(true) // 31 → 33 aired
  })

  it('leaves movies alone', () => {
    const m = createTitle({ title: 'Mugen Train', mediaType: 'movie' })
    expect(mergeEpisodeInfo(m, info({ 1: 1 }), NOW)).toEqual({ title: m, changed: false, newSeason: null })
  })
})

describe('AniList refresh for anime (mocked)', () => {
  const aniMedia = (over: Record<string, unknown> = {}, edges: unknown[] = []) => ({ data: { Media: { status: 'RELEASING', episodes: 28, nextAiringEpisode: { episode: 9, airingAt: 4102444800 }, relations: { edges }, ...over } } })
  const node = (id: number, format: string, status: string, relationType = 'SEQUEL') => ({
    relationType,
    node: { id, type: 'ANIME', format, status, siteUrl: `https://anilist.co/anime/${id}`, title: { english: `Frieren Season ${id}`, romaji: null }, startDate: { year: 2027, month: 1, day: null } },
  })
  const kitsuFrieren = () => {
    const t = createTitle({ title: 'Frieren', mediaType: 'anime', status: 'watching', source: { provider: 'kitsu', id: '46474', url: '' } })
    t.progress = setLastWatched(t.progress!, null, 6)
    return t
  }
  /** AniList calls are spaced ~2 s apart; fake timers keep the tests fast. */
  async function run<T>(p: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync()
    return p
  }
  const routes = (anilist: () => Promise<Response>, mapping: unknown = { data: [{ attributes: { externalSite: 'anilist/anime', externalId: '154587' } }] }) =>
    vi.fn((url: string) => (url.includes('graphql.anilist.co') ? anilist() : url.includes('/mappings') ? json(mapping) : json({ data: { id: '46474', attributes: { status: 'current', episodeCount: 28, nextRelease: null } } })))

  it('maps Kitsu → AniList by id once, then counts aired episodes from the airing schedule', async () => {
    vi.useFakeTimers()
    const t = kitsuFrieren()
    const store = memoryStore([t])
    const fetchMock = routes(() => json(aniMedia()))
    vi.stubGlobal('fetch', fetchMock)
    await run(refreshTitle(t, store.patch))
    const saved = store.map.get(t.id)!
    expect(saved.sync).toMatchObject({ anilistId: 154587, aired: 8, ongoing: true, nextAiring: { season: null, episode: 9, airdate: '2100-01-01T00:00:00.000Z' } })
    expect(saved.progress).toMatchObject({ nextEpisode: 7, totalEpisodes: null }) // still airing: no end assumed
    fetchMock.mockClear()
    await run(refreshTitle(saved, store.patch))
    expect(fetchMock.mock.calls.map(([u]) => u).filter((u) => u.includes('/mappings'))).toHaveLength(0)
  })

  it('a next season is offered, announced only once it is actually out, and never merged into this title', async () => {
    vi.useFakeTimers()
    const t = kitsuFrieren()
    const store = memoryStore([t])
    let sequelStatus = 'NOT_YET_RELEASED'
    vi.stubGlobal('fetch', routes(() => json(aniMedia({}, [node(1, 'MOVIE', 'FINISHED'), node(2, 'ONA', 'FINISHED', 'SIDE_STORY'), node(3, 'TV', sequelStatus)]))))
    const first = await run(refreshTitle(t, store.patch))
    expect(first.status).toBe('unchanged')
    expect(store.map.get(t.id)!.sync?.sequel).toEqual({ anilistId: 3, title: 'Frieren Season 3', status: 'NOT_YET_RELEASED', startDate: '2027-01', url: 'https://anilist.co/anime/3' })
    sequelStatus = 'RELEASING'
    const second = await run(refreshTitle(store.map.get(t.id)!, store.patch))
    expect(second).toMatchObject({ status: 'updated', newSeason: { anilistId: 3, status: 'RELEASING' } })
    expect(store.map.get(t.id)!.progress).toEqual(t.progress)
    const third = await run(refreshTitle(store.map.get(t.id)!, store.patch))
    expect(third.status).toBe('unchanged') // not announced twice
  })

  it("a sequel that was already out on the first refresh isn't announced as new", () => {
    const sequel = { anilistId: 3, title: 'S2', status: 'FINISHED', startDate: null, url: '' }
    expect(mergeEpisodeInfo(kitsuFrieren(), { ...info({}), sequel }, NOW).newSeason).toBeNull()
  })

  it('falls back to Kitsu when there is no AniList mapping or AniList rejects the id; keeps data when AniList is down', async () => {
    vi.useFakeTimers()
    const noMap = kitsuFrieren()
    const store = memoryStore([noMap])
    vi.stubGlobal('fetch', routes(() => json(aniMedia()), { data: [] }))
    expect((await run(refreshTitle(noMap, store.patch))).status).toBe('unchanged')
    expect(store.map.get(noMap.id)!.sync).toMatchObject({ anilistId: null, aired: null })

    const gone = kitsuFrieren()
    store.map.set(gone.id, gone)
    vi.stubGlobal('fetch', routes(() => json({}, 404)))
    await run(refreshTitle(gone, store.patch))
    expect(store.map.get(gone.id)!.sync).toMatchObject({ anilistId: 154587, ongoing: true })

    const down = kitsuFrieren()
    store.map.set(down.id, down)
    vi.stubGlobal('fetch', routes(() => json({}, 503)))
    expect((await run(refreshTitle(down, store.patch))).status).toBe('failed')
    expect(store.map.get(down.id)).toBe(down)
  })

  it('titles saved from AniList before Kitsu replaced it refresh again', async () => {
    vi.useFakeTimers()
    const t = createTitle({ title: 'Frieren', mediaType: 'anime', status: 'watching', source: { provider: 'anilist', id: '154587', url: '' } })
    const store = memoryStore([t])
    vi.stubGlobal('fetch', routes(() => json(aniMedia({ status: 'FINISHED', nextAiringEpisode: null }))))
    await run(refreshTitle(t, store.patch))
    expect(store.map.get(t.id)!.progress!.totalEpisodes).toBe(28)
  })
})

describe('refreshTitle (mocked providers)', () => {
  it('fetches TVmaze once, merges the new season and keeps a progress change made mid-refresh', async () => {
    const t = strangerThings()
    const store = memoryStore([t])
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetchMock = vi.fn(async () => {
      await gate
      return json(mazeShow('Ended', { 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const a = refreshTitle(t, store.patch)
    const b = refreshTitle(t, store.patch) // double-click: same request
    // Meanwhile the user changes their position.
    store.map.set(t.id, { ...store.map.get(t.id)!, progress: { ...t.progress!, nextEpisode: 10 }, notes: 'edited' })
    release()
    const [ra, rb] = await Promise.all([a, b])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toBeDefined()
    expect(ra).toBe(rb)
    expect(ra.status).toBe('updated')
    const saved = store.map.get(t.id)!
    expect(saved.progress).toMatchObject({ nextEpisode: 10, seasonEpisodeCounts: { 5: 8 }, totalSeasons: 5 })
    expect(saved.notes).toBe('edited')
  })

  it('a failed request or malformed response leaves saved data exactly as it was', async () => {
    const t = strangerThings()
    const store = memoryStore([t])
    vi.stubGlobal('fetch', vi.fn(() => json({}, 404)))
    expect((await refreshTitle(t, store.patch)).status).toBe('failed')
    vi.stubGlobal('fetch', vi.fn(() => json({ id: 2993, status: 'Running', _embedded: { episodes: 'oops' } })))
    expect((await refreshTitle(t, store.patch)).status).toBe('unchanged')
    expect(store.map.get(t.id)!.progress).toEqual(t.progress)
  })

  it('retries a rate-limited request and then succeeds', async () => {
    vi.useFakeTimers()
    const t = strangerThings()
    const store = memoryStore([t])
    const fetchMock = vi.fn().mockReturnValueOnce(json({}, 429)).mockReturnValueOnce(json({}, 503)).mockReturnValue(json(mazeShow('Ended', { 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 })))
    vi.stubGlobal('fetch', fetchMock)
    const run = refreshTitle(t, store.patch)
    await vi.runAllTimersAsync()
    expect((await run).status).toBe('updated')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('offline: no request, nothing changes', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const t = strangerThings({ id: 'offline-1' })
    const store = memoryStore([t])
    expect((await refreshTitle(t, store.patch)).status).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.map.get(t.id)).toBe(t)
  })

  it('Kitsu: trusts the episode count only once finished, and never fakes aired counts while airing', async () => {
    const t = createTitle({ title: 'One Piece', mediaType: 'anime', status: 'watching', source: { provider: 'kitsu', id: '12', url: '' } })
    t.progress = setLastWatched(t.progress!, null, 1100)
    const store = memoryStore([t])
    vi.stubGlobal('fetch', vi.fn(() => json({ data: { id: '12', attributes: { status: 'current', episodeCount: 12, nextRelease: '2099-11-01T09:30:00.000+09:00' } } })))
    await refreshTitle(t, store.patch)
    expect(store.map.get(t.id)!.progress!.totalEpisodes).toBeNull()
    expect(store.map.get(t.id)!.sync).toMatchObject({ ongoing: true, aired: null, nextAiring: { episode: null, airdate: '2099-11-01T09:30:00.000+09:00' } })
    vi.stubGlobal('fetch', vi.fn(() => json({ data: { id: '12', attributes: { status: 'finished', episodeCount: 1155, nextRelease: null } } })))
    await refreshTitle(t, store.patch)
    expect(store.map.get(t.id)!.progress).toMatchObject({ totalEpisodes: 1155, nextEpisode: 1101 })
  })
})

describe('syncLibrary', () => {
  it('refreshes only due titles, at most 2 at a time, one request each; a failing one does not stop the rest', async () => {
    const titles = Array.from({ length: 5 }, (_, i) => strangerThings({ id: `t${i}`, source: { provider: 'tvmaze', id: String(100 + i), url: '' } }))
    const fresh = strangerThings({ id: 'fresh', sync: { checkedAt: new Date().toISOString(), changedAt: null, ongoing: true, aired: null, nextAiring: null } })
    const manual = createTitle({ title: 'Home movies', mediaType: 'tv' }) // no provider id: can't be refreshed
    const store = memoryStore([...titles, fresh, manual])
    let active = 0
    let peak = 0
    const fetchMock = vi.fn(async (url: string) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return url.includes('/102?') ? json({}, 404) : json(mazeShow('Ended', { 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const results = await syncLibrary([...store.map.values()], store.patch)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(new Set(fetchMock.mock.calls.map(([u]) => u)).size).toBe(5)
    expect(peak).toBeLessThanOrEqual(2)
    expect(results.map((r) => r.status).sort()).toEqual(['failed', 'updated', 'updated', 'updated', 'updated'])
    expect(store.map.get('t2')!.progress).toEqual(titles[2].progress) // the failed one is untouched

    // Straight away again: everything is fresh or backing off after its failure → no requests.
    fetchMock.mockClear()
    await syncLibrary([...store.map.values()], store.patch)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isDue(store.map.get('t0')!)).toBe(false)
    expect(isDue(store.map.get('t0')!, Date.now() + 8 * 86400000)).toBe(true) // ended show: weekly
  })
})

describe('storage and backups', () => {
  it('db.updateTitle merges into the stored record; backups keep sync info and older backups still import', async () => {
    await clearAll()
    const t = strangerThings()
    await saveTitle(t)
    await updateTitle(t.id, (cur) => mergeEpisodeInfo(cur, info({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 }), NOW).title)
    const stored = (await getTitle(t.id))!
    expect(stored.progress!.seasonEpisodeCounts[5]).toBe(8)

    const backup = parseBackup(JSON.stringify(await createBackup()))
    expect(backup.titles[0].sync?.checkedAt).toBe(NOW)

    // A v1 export from before refresh existed: no sync field, and a junk one is dropped rather than rejected.
    const { sync: _, ...old } = stored
    void _
    const legacy = parseBackup(JSON.stringify({ format: 'watchtrack-backup', version: 1, exportedAt: NOW, titles: [old, { ...old, id: 'x', title: 'Other', sync: 'bad' }], history: [], images: [] }))
    expect(legacy.titles.map((x) => x.sync)).toEqual([undefined, undefined])
    const junk = parseBackup(JSON.stringify({ ...JSON.parse(JSON.stringify(backup)), titles: [{ ...stored, sync: { ...stored.sync, sequel: { title: 5 }, nextAiring: { airdate: null } } }] }))
    expect(junk.titles[0].sync).toMatchObject({ checkedAt: NOW, sequel: null, nextAiring: null })
    const { titles } = resolveImport(planImport(legacy, []), 'merge', 'skip')
    expect(titles[0].progress).toEqual(stored.progress)
    expect(isDue(titles[0])).toBe(true)
  })
})
