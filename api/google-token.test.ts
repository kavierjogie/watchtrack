import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './google-token.js'

const call = (body: unknown, origin = 'https://watchtrack.test') =>
  POST(new Request('https://watchtrack.test/api/google-token', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) }))

describe('google-token', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('refuses other websites without calling Google', async () => {
    expect((await call({ refresh_token: 'r' }, 'https://evil.example')).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects anything but a code exchange or a refresh, without calling Google', async () => {
    expect((await call({ grant_type: 'client_credentials' })).status).toBe(400)
    expect((await call({ code: 'c', verifier: 'v', redirect_uri: 'https://evil.example/settings' })).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds the secret server-side and returns only the token fields', async () => {
    fetchMock.mockResolvedValue(Response.json({ access_token: 'a', expires_in: 3599, refresh_token: 'r', id_token: 'x' }))
    const res = await call({ code: 'c', verifier: 'v', redirect_uri: 'https://watchtrack.test/settings' })
    expect(await res.json()).toEqual({ access_token: 'a', expires_in: 3599, refresh_token: 'r' })
    const sent = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(sent.get('client_secret')).toBe('secret')
    expect(sent.get('grant_type')).toBe('authorization_code')
  })

  it('reports a revoked refresh token as invalid_grant', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 }))
    const res = await call({ refresh_token: 'old' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_grant' })
  })

  it('says so when the server has no Google credentials', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    expect((await call({ refresh_token: 'r' })).status).toBe(503)
  })
})
