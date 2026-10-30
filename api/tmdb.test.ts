import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SEARCH = 'search/multi?include_adult=false&query=breaking%20bad'

describe('tmdb', () => {
  const fetchMock = vi.fn()
  const call = async (path: string, headers: Record<string, string> = {}, extra = '') => {
    const { GET } = await import('./tmdb.js')
    return GET(new Request(`https://watchtrack.test/api/tmdb?path=${encodeURIComponent(path)}${extra}`, { headers }))
  }

  beforeEach(() => {
    vi.resetModules() // Each test starts without a pause left by an earlier 429.
    vi.stubEnv('TMDB_API_KEY', 'read-token')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => Response.json({ results: [] }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each([SEARCH, 'discover/movie?sort_by=vote_count.desc&with_genres=12&page=2', 'movie/123', 'tv/5', 'tv/5/recommendations', 'movie/5/recommendations', 'trending/movie/week'])(
    'forwards what the app sends: %s',
    async (path) => {
      expect((await call(path)).status).toBe(200)
      expect(fetchMock.mock.calls[0][0]).toBe(`https://api.themoviedb.org/3/${path}`)
    },
  )

  it.each([
    'account/1',
    'movie/0123',
    'movie/123?append_to_response=credits',
    'movie/1/credits',
    'search/multi',
    'search/multi?query=loki',
    'search/multi?include_adult=true&query=loki',
    'search/multi?query=loki&include_adult=false',
    'search/multi?include_adult=false&query=loki&cachebust=1',
    'search/multi?include_adult=false&query=loki&query=thor',
    'search/multi?include_adult=false&query=Loki',
    'search/multi?include_adult=false&query=%20loki',
    'search/multi?include_adult=false&query=a',
    'search/multi?include_adult=false&query=a%00b',
    'search/multi?include_adult=false&query=breaking+bad',
    `search/multi?include_adult=false&query=${'a'.repeat(201)}`,
    'discover/movie?sort_by=vote_count.desc&with_genres=12',
    'discover/movie?sort_by=vote_count.desc&with_genres=12&page=0',
    'discover/movie?sort_by=vote_count.desc&with_genres=12&page=501',
    'discover/movie?sort_by=vote_count.desc&with_genres=12&page=1.5',
    'discover/movie?sort_by=vote_count.desc&with_genres=10759&page=1',
    'discover/movie?sort_by=revenue.desc&with_genres=12&page=1',
    'discover/movie?page=1&sort_by=vote_count.desc&with_genres=12',
  ])('refuses %s without spending the token', async (path) => {
    expect((await call(path)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses extra outer parameters and other websites, but not browsers without the header', async () => {
    expect((await call('movie/1', {}, '&x=1')).status).toBe(400)
    expect((await call('movie/1', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    expect((await call('movie/1', { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await call('movie/1', { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200)
    expect((await call('movie/2')).status).toBe(200)
  })

  it('sends the token only as a header', async () => {
    await call('movie/1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).not.toContain('read-token')
    expect(init.headers.Authorization).toBe('Bearer read-token')
  })

  it('caches by route on the CDN', async () => {
    const cdn = async (path: string) => (await call(path)).headers.get('Vercel-CDN-Cache-Control')
    expect(await cdn(SEARCH)).toBe('s-maxage=21600, stale-while-revalidate=86400')
    expect(await cdn('tv/5')).toBe('s-maxage=21600, stale-while-revalidate=86400')
    expect(await cdn('tv/5/recommendations')).toBe('s-maxage=86400, stale-while-revalidate=604800')
    expect(await cdn('discover/movie?sort_by=vote_count.desc&with_genres=12&page=1')).toBe('s-maxage=86400, stale-while-revalidate=604800')
    expect((await call('tv/5')).headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('caches a 404 briefly, without TMDB\'s body', async () => {
    fetchMock.mockImplementation(async () => Response.json({ status_message: 'upstream detail' }, { status: 404 }))
    const res = await call('movie/999')
    expect(res.status).toBe(404)
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe('s-maxage=3600')
    expect(await res.text()).not.toContain('upstream')
  })

  it('reports a timeout as 504 and a network failure as 502, without details or caching', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('slow'), { name: 'TimeoutError' }))
    const slow = await call('movie/1')
    expect(slow.status).toBe(504)
    expect(slow.headers.get('Retry-After')).toBe('5')
    expect(slow.headers.get('Cache-Control')).toBe('no-store')
    fetchMock.mockRejectedValueOnce(new Error('failed: https://api.themoviedb.org/3/movie/1 read-token'))
    const down = await call('movie/1')
    expect(down.status).toBe(502)
    expect(await down.text()).not.toContain('read-token')
  })

  it('hides a rejected token from the browser and logs it, without what was searched', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockImplementation(async () => Response.json({ status_message: 'Invalid API key' }, { status: 401 }))
    const res = await call(SEARCH)
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('Invalid')
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0][0]).not.toContain('breaking')
    log.mockRestore()
  })

  it('never caches an upstream 5xx', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }))
    const res = await call('movie/1')
    expect(res.status).toBe(502)
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull()
  })

  it('stops calling TMDB after a 429, capping how long it will wait', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '9999' } }))
    const first = await call('movie/1')
    expect(first.status).toBe(429)
    expect(first.headers.get('Retry-After')).toBe('60')
    const second = await call('movie/2')
    expect(second.status).toBe(429)
    expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('says so when the server has no token', async () => {
    vi.stubEnv('TMDB_API_KEY', '')
    expect((await call('movie/1')).status).toBe(503)
  })
})
