import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPosterUrl } from './metadata'
import { publicPosterUrl, withPublicPosters } from './posters'
import { decodeShare, encodeShare, sharedToTitle } from './share'
import { createTitle } from './titles'
import type { Poster } from './types'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
afterEach(() => vi.unstubAllGlobals())

const IMG = 'https://static.tvmaze.com/uploads/images/original_untouched/'
/**
 * The eight titles reported without posters in shared lists. TVmaze ids and image URLs as returned by
 * api.tvmaze.com/singlesearch/shows on 2026-10-26; each image answered 200 image/jpeg with Access-Control-Allow-Origin: *
 * and is under 5 MB — which is exactly why the app downloaded them into IndexedDB and the share link dropped them.
 */
const AFFECTED = [
  ['Stranger Things', 2993, '595/1489169.jpg'],
  ['Titans', 27557, '457/1143752.jpg'],
  ['Monsters at Work', 41698, '507/1268353.jpg'],
  ['One of Us Is Lying', 43878, '424/1060717.jpg'],
  ['The Umbrella Academy', 30386, '529/1324589.jpg'],
  ['Euphoria', 28826, '621/1552657.jpg'],
  ['WandaVision', 41748, '295/738028.jpg'],
  ['Big Mouth', 28757, '560/1401497.jpg'],
] as const

const mazeTitle = (name: string, id: number, poster: Poster) =>
  createTitle({ title: name, mediaType: 'tv', status: 'watching', poster, source: { provider: 'tvmaze', id: String(id), url: `https://www.tvmaze.com/shows/${id}` } })

describe('publicPosterUrl', () => {
  it.each<[string, Poster | null, string | null]>([
    ['remote', { kind: 'remote', url: 'https://media.kitsu.app/a.jpg' }, 'https://media.kitsu.app/a.jpg'],
    ['downloaded copy', { kind: 'local', imageId: 'x', url: 'https://static.tvmaze.com/a.jpg' }, 'https://static.tvmaze.com/a.jpg'],
    ['uploaded file', { kind: 'local', imageId: 'x' }, null],
    ['empty', { kind: 'remote', url: '' }, null],
    ['javascript:', { kind: 'remote', url: 'javascript:alert(1)' }, null],
    ['blob:', { kind: 'remote', url: 'blob:http://localhost/1' }, null],
    ['none', null, null],
  ])('%s', (_, poster, want) => expect(publicPosterUrl(poster)).toBe(want))
})

describe('shared posters for the eight affected titles', () => {
  it('carries downloaded posters (as saved now) through encode → decode on a device with no local data', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const titles = AFFECTED.map(([name, id, path]) => mazeTitle(name, id, { kind: 'local', imageId: `img-${id}`, url: IMG + path }))
    const shared = (await decodeShare(await encodeShare(await withPublicPosters(titles)))).map(sharedToTitle)
    expect(shared.map((t) => [t.title, t.poster])).toEqual(AFFECTED.map(([name, , path]) => [name, { kind: 'remote', url: IMG + path }]))
    expect(shared.map((t) => t.source?.id)).toEqual(AFFECTED.map(([, id]) => String(id)))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('recovers posters saved before the URL was kept, by TVmaze id — never by searching the name', async () => {
    const byId = new Map(AFFECTED.map(([, id, path]) => [`https://api.tvmaze.com/shows/${id}`, IMG + path]))
    const fetchMock = vi.fn((url: string) => json({ id: 0, image: { medium: 'https://static.tvmaze.com/m.jpg', original: byId.get(url) } }))
    vi.stubGlobal('fetch', fetchMock)
    const legacy = AFFECTED.map(([name, id]) => mazeTitle(name, id, { kind: 'local', imageId: `old-${id}` }))

    const ready = await withPublicPosters(legacy)
    expect(ready.map((t) => publicPosterUrl(t.poster))).toEqual(AFFECTED.map(([, , path]) => IMG + path))
    expect(ready.every((t) => t.poster?.kind === 'local')).toBe(true) // the offline copy is kept
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([...byId.keys()])

    // Second share in the same session: no new requests.
    await withPublicPosters(legacy)
    expect(fetchMock).toHaveBeenCalledTimes(AFFECTED.length)
  })
})

describe('shared posters for other titles', () => {
  it('leaves working remote posters (e.g. Kitsu anime) alone, and never shares uploaded files', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const spy = createTitle({ title: 'Spy x Family', mediaType: 'anime', poster: { kind: 'remote', url: 'https://media.kitsu.app/anime/45398/poster_image/cc0bbc0dd2a123fb79b041078fce6f89.jpg' }, source: { provider: 'kitsu', id: '45398', url: '' } })
    const upload = createTitle({ title: 'Home video', mediaType: 'movie', poster: { kind: 'local', imageId: 'u1' } })
    const removed = createTitle({ title: 'No art', mediaType: 'tv', source: { provider: 'tvmaze', id: '1', url: '' } })
    const ready = await withPublicPosters([spy, upload, removed])
    expect(ready[0]).toBe(spy)
    const [a, b, c] = (await decodeShare(await encodeShare(ready))).map(sharedToTitle)
    expect(a.poster).toEqual(spy.poster)
    expect(b.poster).toBeNull()
    expect(c.poster).toBeNull() // no artwork on purpose → the recipient won't look one up either
    expect(c.source).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a title whose poster URL could not be found still lets the recipient look it up by id', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    const t = mazeTitle('Offline', 999001, { kind: 'local', imageId: 'z' })
    const [shared] = (await decodeShare(await encodeShare(await withPublicPosters([t])))).map(sharedToTitle)
    expect(shared.poster).toEqual({ kind: 'remote', url: '' })
    expect(shared.source).toMatchObject({ provider: 'tvmaze', id: '999001' })
  })

  it('opens links made before src existed', async () => {
    const raw = { v: 1, items: [{ title: 'Old', type: 'tv', status: 'plan', poster: 'https://static.tvmaze.com/a.jpg' }] }
    const frag = await craft(raw)
    expect((await decodeShare(frag)).map(sharedToTitle)[0]).toMatchObject({ poster: { kind: 'remote', url: 'https://static.tvmaze.com/a.jpg' }, source: null })
    await expect(decodeShare(await craft({ v: 1, items: [{ ...raw.items[0], src: 'evil:../../x' }] }))).rejects.toThrow(/invalid source/)
  })
})

describe('fetchPosterUrl normalises every provider', () => {
  it('Kitsu: skips null sizes in the nested posterImage', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ data: { id: '1', attributes: { posterImage: { original: null, large: 'https://media.kitsu.app/l.jpg' } } } })))
    expect(await fetchPosterUrl({ provider: 'kitsu', id: '1' })).toBe('https://media.kitsu.app/l.jpg')
  })

  it('TVmaze: null image → null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ id: 5, image: null })))
    expect(await fetchPosterUrl({ provider: 'tvmaze', id: '5' })).toBeNull()
  })

  it('TMDB without a key, retired AniList and malformed ids make no request', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect(await fetchPosterUrl({ provider: 'tmdb', id: 'tv/1399' })).toBeNull()
    expect(await fetchPosterUrl({ provider: 'anilist', id: '1' })).toBeNull()
    expect(await fetchPosterUrl({ provider: 'tvmaze', id: '../search?q=x' })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})

async function craft(body: unknown) {
  const out = await new Response(new Blob([JSON.stringify(body)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  return btoa(String.fromCharCode(...new Uint8Array(out))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
