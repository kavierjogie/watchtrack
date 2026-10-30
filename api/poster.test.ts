import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './poster.js'

const call = (url: string) => GET(new Request(`https://watchtrack.test/api/poster?url=${encodeURIComponent(url)}`))
const IMG = 'https://media.kitsu.app/anime/1/poster_image/large-a.jpg'

describe('poster', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('passes on a Kitsu image, without following redirects', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }))
    const res = await call(IMG)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock.mock.calls[0][0]).toBe(IMG)
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error')
  })

  it.each([
    'https://example.com/a.jpg',
    'https://media.kitsu.app.evil.com/a.jpg',
    'https://media.kitsu.app@evil.com/a.jpg',
    'https://user@media.kitsu.app/a.jpg',
    'https://media.kitsu.app:8080/a.jpg',
    'http://media.kitsu.app/a.jpg',
    'http://169.254.169.254/latest/meta-data',
    // Made-up addresses on the right host would each get past the CDN's cache.
    'https://media.kitsu.app/anime/1/large-a.jpg?bust=1',
    'https://media.kitsu.app/anime/1/large-a.jpg?x',
    'https://media.kitsu.app/anime/1/a.html',
    'https://media.kitsu.app/users/avatars/1/a.jpg',
    'https://media.kitsu.app/anime/../secret.jpg',
    'not a url',
    '',
  ])('refuses %s without fetching it', async (url) => {
    expect((await call(url)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['https://media.kitsu.app/anime/poster_images/14172/large.jpg?1597604210', 'https://media.kitsu.app/anime/47711/poster_image/medium-4978105f.jpeg'])('allows real Kitsu poster address %s', async (url) => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(1), { headers: { 'Content-Type': 'image/jpeg' } }))
    expect((await call(url)).status).toBe(200)
  })

  it('refuses anything that is not a plain image', async () => {
    fetchMock.mockImplementation(async () => new Response('<svg onload="x"/>', { headers: { 'Content-Type': 'image/svg+xml' } }))
    expect((await call(IMG)).status).toBe(502)
    fetchMock.mockImplementation(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))
    expect((await call(IMG)).status).toBe(502)
  })

  it('refuses an image too big to send', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }))
    const res = await call(IMG)
    expect(res.status).toBe(413)
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=2592000') // every other device gets this from the CDN
  })

  it('refuses a declared oversize image without reading it, and other websites', async () => {
    const huge = new Response(new Uint8Array(1), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(50 * 1024 * 1024) } })
    const read = vi.spyOn(huge, 'arrayBuffer')
    fetchMock.mockResolvedValue(huge)
    const res = await call(IMG)
    expect(res.status).toBe(413)
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=2592000')
    expect(read).not.toHaveBeenCalled()
    fetchMock.mockClear()
    const cross = await GET(new Request(`https://watchtrack.test/api/poster?url=${encodeURIComponent(IMG)}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))
    expect(cross.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports upstream failures without details', async () => {
    fetchMock.mockRejectedValueOnce(new Error('secret detail'))
    const down = await call(IMG)
    expect(down.status).toBe(502)
    expect(await down.text()).not.toContain('secret')
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    expect((await call(IMG)).status).toBe(404)
  })

  it('lets the CDN answer repeats of a missing image, but never of an outage', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    expect((await call(IMG)).headers.get('Cache-Control')).toContain('s-maxage=3600')
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const down = await call(IMG)
    expect(down.status).toBe(502)
    expect(down.headers.get('Cache-Control')).toBeNull()
  })

  it('caches a good image at the CDN and in the browser', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(1), { headers: { 'Content-Type': 'image/jpeg' } }))
    const cache = (await call(IMG)).headers.get('Cache-Control')
    expect(cache).toContain('s-maxage=2592000')
    expect(cache).toContain(' max-age=2592000')
  })

  // Addresses seen in production: these averaged 1.1 MB each.
  it.each(['https://media.kitsu.app/anime/poster_images/14172/original.jpg', 'https://media.kitsu.app/anime/47711/poster_image/b6a6e8714cee53051ba14c9d799c00aa.png'])('refuses original %s without fetching it', async (url) => {
    const res = await call(url)
    expect(res.status).toBe(413)
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=2592000')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a request with no url at all', async () => {
    expect((await GET(new Request('https://watchtrack.test/api/poster'))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a slow Kitsu as a timeout, however far the response got', async () => {
    const timeout = () => new DOMException('slow', 'TimeoutError')
    fetchMock.mockRejectedValueOnce(timeout())
    expect((await call(IMG)).status).toBe(504)
    const stalled = new Response(new ReadableStream({ start: (c) => c.error(timeout()) }), { headers: { 'Content-Type': 'image/jpeg' } })
    fetchMock.mockResolvedValueOnce(stalled)
    expect((await call(IMG)).status).toBe(504)
  })

  it('reports a body that breaks off instead of throwing', async () => {
    const broken = new Response(new ReadableStream({ start: (c) => c.error(new TypeError('terminated')) }), { headers: { 'Content-Type': 'image/jpeg' } })
    fetchMock.mockResolvedValueOnce(broken)
    expect((await call(IMG)).status).toBe(502)
  })

  it('gives its fetch a deadline', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(1), { headers: { 'Content-Type': 'image/jpeg' } }))
    await call(IMG)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps concurrent requests apart when some fail', async () => {
    fetchMock.mockImplementation(async (u: string) =>
      u.includes('missing') ? new Response('', { status: 404 }) : new Response(u, { headers: { 'Content-Type': 'image/jpeg' } }),
    )
    const urls = Array.from({ length: 12 }, (_, i) => `https://media.kitsu.app/anime/${i % 3 ? 'ok' : 'missing'}/large-${i}.jpg`)
    const out = await Promise.all(urls.map(call))
    expect(out.map((r) => r.status)).toEqual(urls.map((u) => (u.includes('missing') ? 404 : 200)))
    expect(await out[1].text()).toBe(urls[1])
  })

  it('logs why it refused, not what the caller sent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await call('https://evil.example/secret')
    expect(warn.mock.calls[0][0]).toContain('bad-url')
    expect(warn.mock.calls[0][0]).not.toContain('evil')
    warn.mockRestore()
  })
})
