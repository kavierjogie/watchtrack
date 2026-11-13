// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, saveTitle } from '../lib/db'
import { createTitle } from '../lib/titles'
import type { HistoryEntry, Title } from '../lib/types'
import { LibraryProvider } from '../state/library'
import { YearReviewPage } from './YearReview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null
const fetchMock = vi.fn(() => Promise.reject(new Error('no network in this test')))
const getContext = HTMLCanvasElement.prototype.getContext
beforeEach(async () => {
  await clearAll()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  // jsdom has no canvas: the share preview then simply doesn't draw.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof getContext
  // jsdom has neither a top layer nor matchMedia.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  HTMLCanvasElement.prototype.getContext = getContext
})

const settle = () => act(() => new Promise((r) => setTimeout(r, 60)))

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
  await settle()
  return document.body
}

let n = 0
const entry = (t: Title, at: Date, kind: HistoryEntry['kind'] = 'episode'): HistoryEntry => ({ id: `p${n++}`, titleId: t.id, at: at.toISOString(), kind, season: null, episode: n, label: null, before: null })

async function seed() {
  const frieren = createTitle({ title: 'Frieren', mediaType: 'anime', status: 'watching' })
  const dune = createTitle({ title: 'Dune', mediaType: 'movie', status: 'completed' })
  await saveTitle(frieren)
  await saveTitle(dune)
  // 2025 from 1 January (a whole year logged), then 2026.
  const dates = [new Date(2025, 0, 1, 20), new Date(2025, 5, 1, 20), new Date(2026, 2, 1, 20), new Date(2026, 2, 2, 20), new Date(2026, 2, 3, 20)]
  for (const d of dates) await saveTitle(frieren, entry(frieren, d))
  await saveTitle(dune, entry(dune, new Date(2026, 3, 4, 20), 'movie'))
  await saveTitle(frieren, entry(frieren, new Date(2026, 3, 5, 20), 'correction'))
}

const text = () => document.body.textContent ?? ''
const yearButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Choose a year"] button')]

describe('Year in review page', () => {
  it('tells the whole year as an opening, seven chapters and an ending, from local history, without touching the network', async () => {
    await seed()
    await open()
    const chapters = [...document.querySelectorAll('section[aria-labelledby^="chapter-"] h2')].map((h) => h.textContent)
    expect(chapters).toHaveLength(7) // + the opening, which is the page's h1, and the finale
    expect(document.querySelector('h1')?.textContent).toMatch(/2026/)
    expect(document.querySelector('#review-finale')?.textContent).toContain('That was your 2026')
    expect(text()).toContain('You watched')
    expect(text()).toContain('Month by month')
    expect(text()).toContain('3-day streak')
    expect(text()).toContain('Longest streak')
    expect(text()).toContain('2026 against 2025')
    expect(text()).toContain('Frieren')
    // Corrections aren't counted, and the page says so.
    expect(text()).toContain("Your 1 manual progress change this year isn't counted as watches.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('switches years and compares honestly', async () => {
    await seed()
    await open()
    expect(yearButtons().map((b) => b.textContent)).toEqual(['2026', '2025'])
    await act(async () => yearButtons()[1].click())
    await settle()
    expect(document.querySelector('h1')?.textContent).toContain('2025')
    // Nothing was logged before 2025: no comparison is invented.
    expect(text()).toContain('Your first year in WatchTrack')
    // Unlogged history is named as untracked, never shown as zero.
    expect(text()).toContain("isn't zero, it just wasn't tracked")
    expect(text()).not.toContain('2025 against 2024')
  })

  it('makes no network request when the share panel opens either', async () => {
    await seed()
    await open()
    const make = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Share your year'))!
    await act(async () => make.click())
    // The image code is a lazy chunk: give it a moment to load and (in jsdom) fail to draw.
    for (let i = 0; i < 20 && !text().includes("Couldn't draw this card"); i++) await settle()
    expect([...document.querySelectorAll('[aria-label="Card design"] [role=tab]:not(:disabled) span span:first-child')].map((b) => b.textContent)).toContain('The Numbers')
    // jsdom can't draw: the studio says so and offers a retry instead of hanging on a spinner.
    expect(text()).toContain("Couldn't draw this card")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explains itself when nothing has been logged yet', async () => {
    await open()
    expect(text()).toContain('Nothing logged yet')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
