import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './tmdb.js'

const call = (path: string, headers: Record<string, string> = {}, extra = '') => GET(new Request(`https://watchtrack.test/api/tmdb?path=${encodeURIComponent(path)}${extra}`, { headers }))

describe('tmdb', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubEnv('TMDB_API_KEY', 'short-key')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => Response.json({ results: [] }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each(['search/multi?include_adult=false&query=loki', 'discover/movie?sort_by=vote_count.desc&with_genres=12&page=2', 'movie/123', 'tv/5/recommendations', 'trending/movie/week'])(
    'forwards what the app sends: %s',
    async (path) => {
      expect((await call(path)).status).toBe(200)
      expect(fetchMock).toHaveBeenCalledOnce()
    },
  )

  it.each(['account/1', 'search/multi?query=a&cachebust=1', 'movie/123?append_to_response=credits', `search/multi?query=${'a'.repeat(201)}`])(
    'refuses %s without spending the key',
    async (path) => {
      expect((await call(path)).status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('refuses extra outer parameters and other websites', async () => {
    expect((await call('movie/1', {}, '&x=1')).status).toBe(400)
    expect((await call('movie/1', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never echoes the key when TMDB fails', async () => {
    fetchMock.mockRejectedValue(new Error('failed: https://api.themoviedb.org/3/movie/1?api_key=short-key'))
    const res = await call('movie/1')
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('short-key')
  })
})
