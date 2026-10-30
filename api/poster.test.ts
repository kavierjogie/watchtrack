import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './poster.js'

const call = (url: string) => GET(new Request(`https://watchtrack.test/api/poster?url=${encodeURIComponent(url)}`))
const IMG = 'https://media.kitsu.app/anime/1/poster_image/a.jpg'

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
    'not a url',
    '',
  ])('refuses %s without fetching it', async (url) => {
    expect((await call(url)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses anything that is not a plain image', async () => {
    fetchMock.mockImplementation(async () => new Response('<svg onload="x"/>', { headers: { 'Content-Type': 'image/svg+xml' } }))
    expect((await call(IMG)).status).toBe(502)
    fetchMock.mockImplementation(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))
    expect((await call(IMG)).status).toBe(502)
  })

  it('refuses an image too big to send', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }))
    expect((await call(IMG)).status).toBe(502)
  })

  it('refuses a declared oversize image without reading it, and other websites', async () => {
    const huge = new Response(new Uint8Array(1), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(50 * 1024 * 1024) } })
    const read = vi.spyOn(huge, 'arrayBuffer')
    fetchMock.mockResolvedValue(huge)
    expect((await call(IMG)).status).toBe(502)
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
})
