// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Layout } from './Layout'

vi.mock('../state/library', () => ({ useLibrary: () => ({ error: null, titles: [{ id: 'a', status: 'plan' }] }) }))
vi.mock('../state/useSync', () => ({ useAutoSync: () => {} }))
vi.mock('./Alerts', () => ({ AlertBell: () => null }))
vi.mock('./ShareDialog', () => ({
  ShareDialog: ({ onClose }: { onClose: () => void }) => (
    <button type="button" id="close" onClick={onClose}>
      close
    </button>
  ),
}))

function Page() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  return (
    <button type="button" id="back" onClick={() => navigate(-1)}>
      {pathname + search}
    </button>
  )
}

let root: Root
const click = async (id: string) => {
  await act(async () => document.getElementById(id)!.click())
}
const where = () => document.getElementById('back')!.textContent

const open = async (entries: string[]) => {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<Page />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    ),
  )
}

describe('closing a dialog opened from the URL', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    window.scrollTo = vi.fn()
    root = createRoot(document.body.appendChild(document.createElement('div')))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  it('Back goes to the previous page instead of reopening the dialog', async () => {
    await open(['/library', '/title/a', '/title/a?share=a'])
    await click('close')
    expect(where()).toBe('/title/a')
    await click('back')
    expect(where()).toBe('/library')
    expect(document.getElementById('close')).toBeNull()
  })

  it('stays on the page when a link landed straight on the dialog', async () => {
    await open(['/title/a?share=a'])
    await click('close')
    expect(where()).toBe('/title/a')
    expect(document.getElementById('close')).toBeNull()
  })
})
