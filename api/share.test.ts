import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './share.js'

const ORIGIN = 'https://watchtrack.test'

describe('share store', () => {
  let store: Map<string, string>
  const fetchMock = vi.fn()
  const post = (body: string, headers: Record<string, string> = { Origin: ORIGIN, 'x-real-ip': '1.2.3.4' }) => POST(new Request(`${ORIGIN}/api/share`, { method: 'POST', body, headers }))
  const get = (id: string, headers: Record<string, string> = {}) => GET(new Request(`${ORIGIN}/api/share?id=${id}`, { headers }))

  beforeEach(() => {
    store = new Map()
    vi.stubEnv('KV_REST_API_URL', 'https://redis.test')
    vi.stubEnv('KV_REST_API_TOKEN', 'token')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    // A small stand-in for Upstash's pipeline endpoint.
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const commands = JSON.parse(init.body as string) as string[][]
      return Response.json(
        commands.map(([cmd, key, value]) => {
          if (cmd === 'INCR') {
            const n = Number(store.get(key) ?? 0) + 1
            store.set(key, String(n))
            return { result: n }
          }
          if (cmd === 'SET') {
            store.set(key, value)
            return { result: 'OK' }
          }
          if (cmd === 'GET') return { result: store.get(key) ?? null }
          return { result: 1 }
        }),
      )
    })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('stores a payload for 90 days and returns it by id', async () => {
    const res = await post('abc-_123')
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/)
    const set = (JSON.parse(fetchMock.mock.calls[1][1].body as string) as unknown[][])[0]
    expect(set).toEqual(['SET', `share:${id}`, 'abc-_123', 'NX', 'EX', 7776000])
    const got = await get(id)
    expect(got.status).toBe(200)
    expect(await got.text()).toBe('abc-_123')
  })

  it('never stores the IP address itself', async () => {
    await post('abc')
    expect(JSON.stringify([...store.keys()])).not.toContain('1.2.3.4')
  })

  it.each([
    ['bad characters', '<script>'],
    ['an empty body', ''],
    ['an oversized body', 'A'.repeat(30_001)],
  ])('refuses %s', async (_, body) => {
    expect((await post(body)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses other sites', async () => {
    expect((await post('abc', { Origin: 'https://evil.test' })).status).toBe(403)
    expect((await get('abcdefghijk', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits links per address, without affecting anyone else', async () => {
    for (let i = 0; i < 30; i++) expect((await post('abc')).status).toBe(201)
    expect((await post('abc')).status).toBe(429)
    expect((await post('abc', { Origin: ORIGIN, 'x-real-ip': '5.6.7.8' })).status).toBe(201)
  })

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await get('abcdefghijk')).status).toBe(404)
    expect((await get('share:rate:x')).status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1) // The malformed id never reaches the store.
  })

  it('answers 503 when no store is connected', async () => {
    vi.stubEnv('KV_REST_API_URL', '')
    expect((await post('abc')).status).toBe(503)
    expect((await get('abcdefghijk')).status).toBe(503)
  })

  it('answers 502 when the store fails', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }))
    expect((await post('abc')).status).toBe(502)
    expect((await get('abcdefghijk')).status).toBe(502)
  })
})
