import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, saveTitle } from './db'
import { createTitle } from './titles'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const emptyDoc = JSON.stringify({ format: 'watchtrack-backup', version: 1, exportedAt: ago(1), titles: [], history: [], images: [], deleted: [] })

/** A fake Drive holding the library file and the given safety copies. Records every write. */
function fakeDrive(copies: { id: string; createdTime: string }[], copyStatus = 200) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (method === 'GET' && url.includes('watchtrack-safety')) return Response.json({ files: copies })
    if (method === 'GET' && url.includes('?spaces=')) return Response.json({ files: [{ id: 'main' }] })
    if (method === 'GET') return new Response(emptyDoc)
    if (method === 'POST') {
      calls.push(`create ${/"name":"([^"]+)"/.exec(init.body as string)?.[1]}`)
      return Response.json({ id: 'new' }, { status: copyStatus })
    }
    calls.push(`${method} ${url.split('/files/')[1].split('?')[0]}`)
    return new Response('{}')
  })
  return calls
}

async function sync() {
  vi.resetModules()
  const { syncDrive } = await import('./drive')
  await syncDrive()
}

describe('Drive safety copies', () => {
  beforeEach(async () => {
    const store = new Map([['watchtrack:drive', JSON.stringify({ refresh: 'r', access: 'a', expires: Date.now() + DAY })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    await clearAll()
    await saveTitle(createTitle({ title: 'Loki', mediaType: 'tv' })) // Something Drive lacks, so the sync uploads.
  })

  afterEach(() => vi.unstubAllGlobals())

  it('saves one when the newest is over a week old, and prunes to the newest 4', async () => {
    const calls = fakeDrive([8, 15, 22, 29].map((d, i) => ({ id: `c${i}`, createdTime: ago(d) })))
    await sync()
    expect(calls).toEqual([`create watchtrack-safety-${new Date().toISOString().slice(0, 10)}.json`, 'DELETE c3', 'PATCH main'])
  })

  it('saves nothing when the newest is under a week old', async () => {
    const calls = fakeDrive([{ id: 'c0', createdTime: ago(2) }])
    await sync()
    expect(calls).toEqual(['PATCH main'])
  })

  it('still syncs when saving a copy fails', async () => {
    const calls = fakeDrive([], 500)
    await sync()
    expect(calls.at(-1)).toBe('PATCH main')
  })

  it('stops calling Drive after a 429, until the wait is over', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { syncDrive } = await import('./drive')
    await syncDrive()
    const after = fetchMock.mock.calls.length
    expect(after).toBeGreaterThan(0)
    await syncDrive()
    expect(fetchMock.mock.calls.length).toBe(after)
  })

  it('refuses a Drive file too large to load, leaving Drive alone', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method) calls.push(init.method)
      if (url.includes('?spaces=')) return Response.json({ files: [{ id: 'main' }] })
      return new Response('{}', { headers: { 'Content-Length': String(201 * 1024 * 1024) } })
    })
    vi.resetModules()
    const { syncDrive } = await import('./drive')
    expect(await syncDrive()).toBe(false)
    expect(calls).toEqual([])
  })

  it('does not put tokens back when a refresh finishes after disconnecting', async () => {
    const store = new Map([['watchtrack:drive', JSON.stringify({ refresh: 'r' })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    vi.resetModules()
    const { disconnectDrive, syncDrive } = await import('./drive')
    let answer!: (r: Response) => void
    vi.stubGlobal('fetch', (url: string) => (url === '/api/google-token' ? new Promise((r) => (answer = r)) : Promise.resolve(new Response(''))))
    const running = syncDrive()
    await vi.waitFor(() => expect(answer).toBeDefined())
    disconnectDrive()
    answer(Response.json({ access_token: 'late', expires_in: 3600 }))
    await running
    expect(store.get('watchtrack:drive')).not.toContain('late')
  })
})
