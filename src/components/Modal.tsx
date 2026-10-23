import { motion } from 'framer-motion'
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

/** Native <dialog>: focus trapping, Esc to close and inert background for free. */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)

  // Backdrop clicks target the <dialog> itself, but so does a click whose press started inside it
  // (e.g. selecting text in a field and releasing outside) or one on the dialog's own scrollbar.
  // Only a press and release both outside the dialog's box count as "click outside to close".
  const onBackdrop = (e: MouseEvent) => {
    const d = ref.current
    if (e.target !== d || !d) return false
    const r = d.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  if (!open) return null
  const width = size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl'

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onPointerDown={(e) => (pressedBackdrop.current = onBackdrop(e))}
      onClick={(e) => {
        if (pressedBackdrop.current && onBackdrop(e)) onClose()
        pressedBackdrop.current = false
      }}
      aria-label={title}
      className={`m-0 mt-auto max-h-[92dvh] w-full max-w-none bg-transparent p-0 text-fg backdrop:bg-black/60 sm:m-auto ${width}`}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex max-h-[92dvh] flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-3xl"
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </header>
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
  const [typed, setTyped] = useState('')

  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise((resolve) => {
        setTyped('')
        setState({ ...o, resolve })
      }),
    [],
  )

  const close = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }
  const blocked = !!state?.typeToConfirm && typed !== state.typeToConfirm

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
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
    </ConfirmCtx.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const c = useContext(ConfirmCtx)
  if (!c) throw new Error('useConfirm must be used inside ConfirmProvider')
  return c
}
