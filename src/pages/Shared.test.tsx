// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { listTitles } from '../lib/db'
import { encodeShare } from '../lib/share'
import { createTitle } from '../lib/titles'
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
        <Routes>
          <Route path="shared" element={<SharedPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  // Let the async decode settle.
  await act(() => new Promise((r) => setTimeout(r, 50)))
  return document.body
}

describe('shared watchlist page', () => {
  it('shows the shared titles read-only and never writes to the local library', async () => {
    const payload = await encodeShare([
      createTitle({ title: '<b>Frieren</b>', mediaType: 'anime', status: 'watching' }),
      createTitle({ title: 'Dune', mediaType: 'movie', status: 'plan' }),
    ])
    const page = await open(`#${payload}`)
    expect(page.querySelector('h1')?.textContent).toBe('Shared Watchlist')
    expect(page.textContent).toContain('<b>Frieren</b>') // rendered as text, not HTML
    expect(page.querySelector('b')).toBeNull()
    expect(page.textContent).toContain('Dune')
    // No buttons, inputs or links into title pages: nothing to change.
    expect(page.querySelectorAll('button, input, select, textarea, form')).toHaveLength(0)
    expect([...page.querySelectorAll('a')].every((a) => a.getAttribute('href') === '/')).toBe(true)
    expect(await listTitles()).toEqual([])
  })

  it('shows a helpful error for a broken link', async () => {
    const page = await open('#not-a-real-payload')
    expect(page.textContent).toContain("This link can't be opened")
    expect(page.textContent).toContain('never expire')
  })

  it('shows an empty state for an empty list', async () => {
    const page = await open(`#${await encodeShare([])}`)
    expect(page.textContent).toContain('This watchlist is empty')
  })
})
