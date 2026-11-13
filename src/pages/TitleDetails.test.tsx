// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../components/Modal'
import { clearAll, getTitle, saveTitle } from '../lib/db'
import { onDirty } from '../lib/drive'
import { createTitle } from '../lib/titles'
import { LibraryProvider } from '../state/library'
import { TitleDetails } from './TitleDetails'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null
beforeEach(async () => {
  await clearAll()
  // No metadata provider is reachable in tests; the page must still work.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

const settle = () => act(() => new Promise((r) => setTimeout(r, 50)))

async function open(id: string) {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[`/title/${id}`]}>
        <LibraryProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="title/:id" element={<TitleDetails />} />
            </Routes>
          </ConfirmProvider>
        </LibraryProvider>
      </MemoryRouter>,
    )
  })
  await settle()
  return document.body
}

describe('TitleDetails release alerts toggle', () => {
  it('saves the choice as an edit, so Google Drive sync sends it to other devices', async () => {
    // A provider link is what makes the toggle appear.
    const t = { ...createTitle({ title: 'Frieren', mediaType: 'anime', status: 'watching', source: { provider: 'anilist', id: '154587', url: 'https://anilist.co/anime/154587' } }, '2026-01-01T00:00:00.000Z') }
    await saveTitle(t)
    const body = await open(t.id)

    const dirty = vi.fn()
    const off = onDirty(dirty)
    const box = [...body.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find((el) => el.closest('label')?.textContent?.includes('Notify me about new seasons'))
    expect(box?.checked).toBe(true)
    await act(async () => box!.click())
    await settle()
    off()

    const saved = await getTitle(t.id)
    expect(saved?.alerts).toBe(false)
    // Sync compares updatedAt: without the bump the other device would keep its old choice.
    expect(saved?.updatedAt).not.toBe(t.updatedAt)
    expect(dirty).toHaveBeenCalled()
  })
})
