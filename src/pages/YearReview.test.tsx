// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, saveTitle } from '../lib/db'
import { createTitle } from '../lib/titles'
import { LibraryProvider } from '../state/library'
import { YearReviewPage } from './YearReview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null
const fetchMock = vi.fn(() => Promise.reject(new Error('no network in this test')))
beforeEach(async () => {
  await clearAll()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
})
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function open(url = '/review') {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <LibraryProvider>
          <Routes>
            <Route path="review" element={<YearReviewPage />} />
          </Routes>
        </LibraryProvider>
      </MemoryRouter>,
    )
  })
  await act(() => new Promise((r) => setTimeout(r, 50)))
  return document.body
}

const episode = (titleId: string, at: string, i: number) => ({ id: `${titleId}-${i}`, titleId, at, kind: 'episode' as const, season: null, episode: i, label: null, before: null })

describe('Year in review page', () => {
  it('shows the year from local history without touching the network', async () => {
    const t = createTitle({ title: 'Frieren', mediaType: 'anime', status: 'watching' })
    await saveTitle(t)
    for (const [i, d] of [new Date(2026, 2, 1, 20), new Date(2026, 2, 2, 20), new Date(2025, 5, 1, 20)].entries()) await saveTitle(t, episode(t.id, d.toISOString(), i))

    const body = await open()
    expect(body.textContent).toContain('Your 2026 in review')
    expect(body.textContent).toContain('Episodes')
    expect(body.textContent).toContain('2 days')
    expect(body.textContent).toContain('Frieren')
    // Another year to look back at.
    expect([...body.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent)).toEqual(['2026', '2025'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explains itself when nothing has been logged yet', async () => {
    const body = await open()
    expect(body.textContent).toContain('Nothing logged yet')
  })
})
