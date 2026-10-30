// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveTitle } from '../lib/db'
import { createTitle } from '../lib/titles'
import { LibraryProvider, useLibrary } from '../state/library'
import { ShareDialog } from './ShareDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The app only opens the dialog once the library has loaded. */
function Loaded() {
  return useLibrary().loading ? null : <ShareDialog onClose={() => {}} />
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 50)))
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(name))
const linkField = () => document.querySelector<HTMLInputElement>('input[readonly]')!

describe('ShareDialog', () => {
  let root: ReturnType<typeof createRoot>
  const fetchMock = vi.fn()

  beforeEach(async () => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    // jsdom has neither a top layer nor matchMedia.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true
    }
    window.matchMedia ??= (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    await saveTitle(createTitle({ title: 'Dialog Dune', mediaType: 'movie', status: 'plan' }))
    root = createRoot(document.body.appendChild(document.createElement('div')))
    await act(async () => {
      root.render(
        <MemoryRouter>
          <LibraryProvider>
            <Loaded />
          </LibraryProvider>
        </MemoryRouter>,
      )
    })
    // Building the list is async: Create link turns on when it's ready.
    await vi.waitFor(
      async () => {
        await settle()
        expect(button('Create link')?.disabled).toBe(false)
      },
      { timeout: 3000 },
    )
  })
  afterEach(() => {
    act(() => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('uploads nothing until Create link is pressed, and a changed selection needs a new link', async () => {
    expect(fetchMock).not.toHaveBeenCalled()
    expect(button('Copy link')).toBeUndefined()

    fetchMock.mockResolvedValue(Response.json({ id: 'abcdefghijk' }, { status: 201 }))
    await act(async () => button('Create link')!.click())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/share')
    expect(linkField().value).toBe(`${window.location.origin}/s/abcdefghijk`)
    expect(button('Copy link')).toBeDefined()

    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await settle()
    expect(linkField().value).not.toContain('/s/')
    expect(button('Create link')).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to a long link when the server cannot store the list', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'nope' }, { status: 503 }))
    await act(async () => button('Create link')!.click())
    await settle()
    expect(linkField().value).toContain('/shared#')
    expect(document.body.textContent).toContain("Couldn't create a short link")
    expect(document.body.textContent).toContain('stored inside the link itself')
  })
})
