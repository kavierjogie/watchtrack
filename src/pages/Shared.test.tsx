// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listTitles } from '../lib/db'
import { encodeShare } from '../lib/share'
import { createTitle } from '../lib/titles'
import { LibraryProvider } from '../state/library'
import { SharedPage } from './Shared'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

async function open(hash: string) {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[`/shared${hash}`]}>
        <LibraryProvider>
          <Routes>
            <Route path="shared" element={<SharedPage />} />
          </Routes>
        </LibraryProvider>
      </MemoryRouter>,
    )
  })
  // Let the async decode settle.
  await act(() => new Promise((r) => setTimeout(r, 50)))
  return document.body
}

async function craftShare(body: unknown) {
  const out = await new Response(new Response(JSON.stringify(body)).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  return btoa(String.fromCharCode(...new Uint8Array(out))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('shared watchlist page', () => {
  it('shows the shared titles and writes nothing to the local library until the visitor adds them', async () => {
    const payload = await encodeShare([
      createTitle({ title: '<b>Frieren</b>', mediaType: 'anime', status: 'watching' }),
      createTitle({ title: 'Dune', mediaType: 'movie', status: 'plan' }),
    ])
    const page = await open(`#${payload}`)
    expect(page.querySelector('h1')?.textContent).toBe('Shared Watchlist')
    expect(page.textContent).toContain('<b>Frieren</b>') // rendered as text, not HTML
    expect(page.querySelector('b')).toBeNull()
    expect(page.textContent).toContain('Dune')
    // No inputs or links into title pages; the only buttons add to the visitor's own list.
    expect(page.querySelectorAll('input, select, textarea, form')).toHaveLength(0)
    expect([...page.querySelectorAll('button')].every((b) => b.textContent?.includes('to my list'))).toBe(true)
    expect([...page.querySelectorAll('a')].every((a) => a.getAttribute('href') === '/')).toBe(true)
    expect(await listTitles()).toEqual([])

    const addAll = [...page.querySelectorAll('button')].find((b) => b.textContent?.includes('Add all'))!
    await act(async () => addAll.click())
    await act(() => new Promise((r) => setTimeout(r, 50)))
    const saved = await listTitles()
    expect(saved.map((t) => [t.title, t.status]).sort()).toEqual([['<b>Frieren</b>', 'plan'], ['Dune', 'plan']])
    expect(page.textContent).toContain('In your library')
    expect(page.querySelectorAll('button')).toHaveLength(0)
  })

  it('shows a helpful error for a broken link', async () => {
    const page = await open('#not-a-real-payload')
    expect(page.textContent).toContain("This link can't be opened")
    expect(page.textContent).toContain('never expire')
  })

  it("shows posters a recipient's browser has never seen, falls back by provider id on failure, then shows a placeholder", async () => {
    const url = 'https://static.tvmaze.com/uploads/images/original_untouched/621/1552657.jpg'
    const fresh = 'https://static.tvmaze.com/uploads/images/original_untouched/621/new.jpg'
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: 28826, image: { original: fresh } }))))
    vi.stubGlobal('fetch', fetchMock)
    // Saved the way the creator's browser stores it: a local copy plus where it came from. The recipient has neither the copy nor the library.
    const euphoria = createTitle({ title: 'Euphoria', mediaType: 'tv', poster: { kind: 'local', imageId: 'creator-only', url }, source: { provider: 'tvmaze', id: '28826', url: '' } })
    const page = await open(`#${await encodeShare([euphoria])}`)
    const img = () => page.querySelector('img[alt="Euphoria poster"]')
    expect(img()?.getAttribute('src')).toBe(url)
    expect(fetchMock).not.toHaveBeenCalled()

    // The original URL 404s → one lookup by id → the new URL.
    await act(async () => void img()!.dispatchEvent(new Event('error')))
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(fetchMock.mock.calls).toEqual([['https://api.tvmaze.com/shows/28826', expect.anything()]])
    expect(img()?.getAttribute('src')).toBe(fresh)

    // That fails too → placeholder with the title; no further requests.
    await act(async () => void img()!.dispatchEvent(new Event('error')))
    expect(img()).toBeNull()
    expect(page.querySelector('li')?.textContent).toContain('Euphoria')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('looks a poster up by id when the link has no URL for it', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: 41748, image: { original: 'https://static.tvmaze.com/w.jpg' } }))))
    vi.stubGlobal('fetch', fetchMock)
    const payload = await craftShare({ v: 1, items: [{ title: 'WandaVision', type: 'tv', status: 'completed', src: 'tvmaze:41748' }] })
    const page = await open(`#${payload}`)
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(page.querySelector('img[alt="WandaVision poster"]')?.getAttribute('src')).toBe('https://static.tvmaze.com/w.jpg')
    vi.unstubAllGlobals()
  })

  it('shows an empty state for an empty list', async () => {
    const page = await open(`#${await encodeShare([])}`)
    expect(page.textContent).toContain('This watchlist is empty')
  })
})
