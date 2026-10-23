import { CircleCheck, CirclePause, Ellipsis, ExternalLink, ListPlus, Pencil, Play, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Title } from '../lib/types'
import { useWatchActions } from '../state/useWatchActions'
import { ProgressEditor } from './ProgressEditor'

/** Overflow menu with quick actions for a title card. */
export function TitleMenu({ t }: { t: Title }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { setStatus, undo } = useWatchActions()

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const items = [
    t.progress && { label: 'Change progress', icon: Pencil, run: () => setEditing(true) },
    t.status !== 'watching' && { label: 'Resume watching', icon: Play, run: () => void setStatus(t, 'watching') },
    t.status !== 'on_hold' && { label: 'Pause (on hold)', icon: CirclePause, run: () => void setStatus(t, 'on_hold') },
    t.status !== 'plan' && { label: 'Move to plan to watch', icon: ListPlus, run: () => void setStatus(t, 'plan') },
    t.status !== 'completed' && { label: 'Mark completed', icon: CircleCheck, run: () => void setStatus(t, 'completed') },
    { label: 'Undo last change', icon: Undo2, run: () => void undo(t.id) },
    { label: 'Open details', icon: ExternalLink, run: () => navigate(`/title/${t.id}`) },
  ].filter((x): x is { label: string; icon: typeof Pencil; run: () => void } => !!x)

  return (
    <div ref={ref} className="relative">
      <button type="button" className="icon-btn size-9" aria-label={`More actions for ${t.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis className="size-5" />
      </button>
      <AnimatePresence>
        {open && (
          // Grows out of the ⋯ button (bottom-right corner) and shrinks back into it.
          <motion.ul
            role="menu"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.2 }}
            className="absolute bottom-full right-0 z-20 mb-1 w-52 origin-bottom-right overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl"
          >
            {items.map(({ label, icon: Icon, run }) => (
              <li key={label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    setOpen(false)
                    run()
                  }}
                >
                  <Icon className="size-4 text-muted" aria-hidden />
                  {label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <AnimatePresence>{editing && t.progress && <ProgressEditor title={t} open onClose={() => setEditing(false)} />}</AnimatePresence>
    </div>
  )
}
