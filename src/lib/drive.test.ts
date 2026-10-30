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

describe('skipping the download when nothing changed', () => {
  /** A Drive that really stores the file, and counts downloads and uploads. */
  function realishDrive() {
    const d = { text: emptyDoc, md5: 'v0', downloads: 0, uploads: 0, metaStatus: 200, failUpload: false }
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (url === '/api/google-token') return Response.json({ access_token: 'fresh', expires_in: 3600 })
      if (init.method === 'PATCH') {
        if (d.failUpload) return new Response('', { status: 400 })
        d.uploads++
        d.text = init.body as string
        d.md5 = `v${d.uploads}-up`
        return Response.json({ md5Checksum: d.md5 })
      }
      if (url.includes('fields=md5Checksum')) return d.metaStatus === 200 ? Response.json({ md5Checksum: d.md5 }) : new Response('', { status: d.metaStatus })
      if (url.includes('alt=media')) {
        d.downloads++
        return new Response(d.text)
      }
      if (url.includes('?spaces=')) return Response.json({ files: url.includes('safety') ? [] : [{ id: 'main' }] })
      return Response.json({})
    })
    return d
  }
  /** A fresh import is what a reopened app has: only what was saved. */
  const open = async () => {
    vi.resetModules()
    return (await import('./drive')).syncDrive()
  }
  const settled = async () => {
    const d = realishDrive()
    await open()
    d.downloads = d.uploads = 0
    return d
  }

  beforeEach(async () => {
    const store = new Map([['watchtrack:drive', JSON.stringify({ refresh: 'r', access: 'a', expires: Date.now() + DAY, fileId: 'main' })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    await clearAll()
    await saveTitle(createTitle({ title: 'Loki', mediaType: 'tv' }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reopening with no changes downloads and uploads nothing', async () => {
    const d = await settled()
    await open()
    await open()
    expect(d).toMatchObject({ downloads: 0, uploads: 0 })
  })

  it('an edit is uploaded, even one made while no sync was listening', async () => {
    const d = await settled()
    await saveTitle(createTitle({ title: 'Severance', mediaType: 'tv' }))
    await open()
    expect(d).toMatchObject({ downloads: 1, uploads: 1 })
    expect(d.text).toContain('Severance')
    await open()
    expect(d).toMatchObject({ downloads: 1, uploads: 1 })
  })

  it('a deletion is uploaded', async () => {
    const d = await settled()
    const { deleteTitle, listTitles } = await import('./db')
    await deleteTitle((await listTitles())[0].id)
    await open()
    expect(d.uploads).toBe(1)
    expect(d.text).not.toContain('Loki')
  })

  it("another device's change is downloaded", async () => {
    const d = await settled()
    const other = createTitle({ title: 'Andor', mediaType: 'tv' })
    d.text = JSON.stringify({ ...JSON.parse(d.text), titles: [...JSON.parse(d.text).titles, other] })
    d.md5 = 'other-device'
    await open()
    expect(d.downloads).toBe(1)
    expect((await (await import('./db')).listTitles()).map((t) => t.title)).toContain('Andor')
  })

  it('an edit made during a sync still goes up next time', async () => {
    const d = realishDrive()
    const late = createTitle({ title: 'Mid-sync', mediaType: 'tv' })
    const real = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PATCH') await saveTitle(late)
      return real(url, init)
    })
    await open()
    expect(d.text).not.toContain('Mid-sync')
    vi.stubGlobal('fetch', real)
    await open()
    expect(d.text).toContain('Mid-sync')
  })

  it('a failed upload is tried again rather than remembered as synced', async () => {
    const d = await settled()
    await saveTitle(createTitle({ title: 'Severance', mediaType: 'tv' }))
    d.failUpload = true
    await open()
    d.failUpload = false
    await open()
    expect(d.text).toContain('Severance')
  })

  it('does a real sync once a day regardless', async () => {
    const d = await settled()
    const later = Date.now() + 25 * 3_600_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    await open()
    expect(d.downloads).toBe(1)
  })

  it('falls back to a real sync when Drive will not say, or the file has gone', async () => {
    const d = await settled()
    d.metaStatus = 404
    await open()
    expect(d.downloads).toBe(1)
  })
})

describe('Google token refreshes', () => {
  const tokenCalls = (ok: boolean) => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === '/api/google-token') {
        calls.push(url)
        return ok ? Response.json({ access_token: 'new', expires_in: 3600 }) : Response.json({ error: 'Google refused the request.' }, { status: 400 })
      }
      return Response.json({ files: [] })
    })
    return calls
  }

  beforeEach(async () => {
    const store = new Map([['watchtrack:drive', JSON.stringify({ refresh: 'r', fileId: 'main' })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    await clearAll()
    vi.resetModules()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('calls made together share one refresh, and the new token is reused', async () => {
    const calls = tokenCalls(true)
    const { listSafetyCopies } = await import('./drive')
    await Promise.all([listSafetyCopies(), listSafetyCopies(), listSafetyCopies()])
    await listSafetyCopies()
    expect(calls).toHaveLength(1)
  })

  it('a failed refresh backs off instead of asking Google again on the next sync', async () => {
    const calls = tokenCalls(false)
    const { syncDrive } = await import('./drive')
    await syncDrive()
    await syncDrive()
    await syncDrive()
    expect(calls).toHaveLength(1)
  })
})

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
