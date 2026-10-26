import { animate, AnimatePresence, motion, useDragControls, useIsPresent, useMotionValue, type PanInfo } from 'framer-motion'
import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Footer actions */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

/** Critically damped: settles without overshoot. Apple's default for UI that wasn't thrown. */
const SPRING = { type: 'spring', bounce: 0, duration: 0.3 } as const

/** Where a flick would come to rest (Apple's scroll-deceleration projection, rate 0.998). */
const project = (velocity: number) => ((velocity / 1000) * 0.998) / (1 - 0.998)

/**
 * Native <dialog>: focus trapping, Esc to close and inert background for free.
 * To animate out, mount it conditionally inside <AnimatePresence> (`<AnimatePresence>{x && <Modal open …/>}</AnimatePresence>`):
 * the panel's exit plays before the dialog leaves the page.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const pressedBackdrop = useRef(false)
  const present = useIsPresent()
  const drag = useDragControls()
  const y = useMotionValue(0)
  // Phones get a bottom sheet that slides from (and back to) the bottom edge and can be swiped down.
  const [sheet] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  const hidden = { opacity: 0, y: sheet ? window.innerHeight : 24 }

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // Backdrop clicks target the <dialog> itself, but so does a click whose press started inside it
  // (e.g. selecting text in a field and releasing outside) or one on the dialog's own scrollbar.
  // Only a press and release both outside the dialog's box count as "click outside to close".
  const onBackdrop = (e: MouseEvent) => {
    const d = ref.current
    if (e.target !== d || !d) return false
    const r = d.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }

  // Close when the release point plus the flick's momentum lands past half the sheet; otherwise it springs back.
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const height = panel.current?.offsetHeight ?? window.innerHeight
    if (info.offset.y + project(info.velocity.y) > height / 2) onClose()
    // Not closing: spring home, starting at the finger's speed so there's no seam between drag and animation.
    // (A flick earns a little bounce.) Closing: the exit animation carries on from here instead.
    else animate(y, 0, { type: 'spring', bounce: 0.15, duration: 0.35, velocity: info.velocity.y })
  }

  if (!open) return null
  const width = size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl'

  return (
    <dialog
      ref={ref}
      data-closing={present ? undefined : ''}
      onCancel={(e) => {
        e.preventDefault()
        if (present) onClose()
      }}
      onPointerDown={(e) => (pressedBackdrop.current = onBackdrop(e))}
      onClick={(e) => {
        if (pressedBackdrop.current && onBackdrop(e)) onClose()
        pressedBackdrop.current = false
      }}
      aria-label={title}
      className={`m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-visible bg-transparent p-0 text-fg sm:m-auto ${width}`}
    >
      <motion.div
        ref={panel}
        initial={hidden}
        animate={{ opacity: 1, y: 0 }}
        exit={hidden}
        transition={SPRING}
        drag={sheet ? 'y' : false}
        dragListener={false}
        dragControls={drag}
        style={{ y }}
        // Follows the finger 1:1 downward; resists strongly upward (rubber band) instead of stopping dead.
        // Only the top is constrained and momentum is off, so the release is ours alone (see onDragEnd).
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0.08 }}
        dragMomentum={false}
        dragTransition={{ bounceStiffness: 500, bounceDamping: 45 }}
        onDragEnd={onDragEnd}
        className="flex max-h-[92dvh] flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-3xl"
      >
        <div onPointerDown={(e) => sheet && drag.start(e)} className={sheet ? 'touch-none select-none' : undefined}>
          {sheet && <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line" aria-hidden />}
          <header className={`flex items-center justify-between gap-4 border-b border-line px-5 ${sheet ? 'pb-3 pt-1' : 'py-3'}`}>
            <h2 className="line-clamp-2 min-w-0 text-base font-semibold wrap-anywhere">{title}</h2>
            <button type="button" className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
              <X className="size-5" />
            </button>
          </header>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </motion.div>
    </dialog>
  )
}

// ---------- Confirm ----------

interface ConfirmOptions {
  title: string
  body: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** User must type this text to enable the confirm button. */
  typeToConfirm?: string
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>
const ConfirmCtx = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  // Separate from `state` so the dialog keeps its content while it animates out.
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')

  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise((resolve) => {
        setTyped('')
        setState({ ...o, resolve })
        setOpen(true)
      }),
    [],
  )

  const close = (v: boolean) => {
    if (!open) return
    state?.resolve(v)
    setOpen(false)
  }
  const blocked = !!state?.typeToConfirm && typed !== state.typeToConfirm

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {open && (
          <Modal
            open={open}
            onClose={() => close(false)}
            title={state?.title ?? ''}
            size="sm"
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => close(false)}>
                  {state?.cancelLabel ?? 'Cancel'}
                </button>
                <button
                  type="button"
                  className={state?.danger ? 'btn-danger' : 'btn-primary'}
                  disabled={blocked}
                  onClick={() => close(true)}
                  autoFocus={!state?.danger}
                >
                  {state?.confirmLabel ?? 'Confirm'}
                </button>
              </>
            }
          >
            <div className="space-y-3 text-sm text-muted">{state?.body}</div>
            {state?.typeToConfirm && (
              <label className="mt-4 block">
                <span className="label">
                  Type <strong className="text-fg">{state.typeToConfirm}</strong> to confirm
                </span>
                <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
            )}
          </Modal>
        )}
      </AnimatePresence>
    </ConfirmCtx.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const c = useContext(ConfirmCtx)
  if (!c) throw new Error('useConfirm must be used inside ConfirmProvider')
  return c
}
