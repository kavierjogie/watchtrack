// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

// React only warns about act() outside a test runner unless this is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  // jsdom has no top layer; the box sits at 100,100 → 500,500 so "outside" is anything beyond it.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 100, width: 400, height: 400 })
  // jsdom has no matchMedia; report a desktop-sized, motion-friendly screen.
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

let root: ReturnType<typeof createRoot> | null = null
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

function renderModal() {
  const onClose = vi.fn()
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <Modal open onClose={onClose} title="Add title">
        <input aria-label="Title" />
      </Modal>,
    ),
  )
  return { onClose, dialog: document.querySelector('dialog')!, input: document.querySelector('input')! }
}

const fire = (el: Element, type: 'pointerdown' | 'click', x: number, y: number) =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }))
  })

describe('Modal backdrop dismiss', () => {
  it('stays open when a press inside a field is released on the backdrop (the browser sends that click to <dialog>)', () => {
    const { onClose, dialog, input } = renderModal()
    fire(input, 'pointerdown', 300, 300)
    fire(dialog, 'click', 700, 300)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open on clicks that hit the dialog box itself (e.g. its scrollbar)', () => {
    const { onClose, dialog } = renderModal()
    fire(dialog, 'pointerdown', 495, 300)
    fire(dialog, 'click', 495, 300)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a real click outside', () => {
    const { onClose, dialog } = renderModal()
    fire(dialog, 'pointerdown', 700, 300)
    fire(dialog, 'click', 700, 300)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
