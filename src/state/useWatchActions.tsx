import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfirm } from '../components/Modal'
import { errMsg } from '../lib/format'
import { describePosition, startNextSeason } from '../lib/progress'
import { applyMarkWatched, applyMovieWatched, applyProgress, applySpecial, applyStatus, type Change } from '../lib/titles'
import { STATUS_LABEL, type Title, type WatchStatus } from '../lib/types'
import { useLibrary } from './library'


/** All progress-changing actions, with toasts, undo and confirmations. */
export function useWatchActions() {
  const lib = useLibrary()
  const confirm = useConfirm()
  const navigate = useNavigate()

  const undo = useCallback(
    async (titleId: string) => {
      try {
        const restored = await lib.undoLast(titleId)
        if (restored) toast.success('Undone', { description: restored.progress ? describePosition(restored.progress) : undefined })
        else toast.error('Nothing to undo for this title.')
      } catch (err) {
        toast.error(errMsg(err))
      }
    },
    [lib],
  )

  const commit = useCallback(
    async (change: Change, message: string, description?: string) => {
      try {
        await lib.commit(change)
        toast.success(message, {
          description,
          action: { label: 'Undo', onClick: () => void undo(change.title.id) },
        })
        return true
      } catch (err) {
        toast.error(errMsg(err))
        return false
      }
    },
    [lib, undo],
  )

  const setStatus = useCallback(
    (t: Title, status: WatchStatus) => commit(applyStatus(t, status), `${t.title} → ${STATUS_LABEL[status]}`),
    [commit],
  )

  const markWatched = useCallback(
    async (t: Title) => {
      const change = applyMarkWatched(t)
      if (!change) {
        toast.error('Set the current episode first', { description: 'Open the title and enter where you are.' })
        navigate(`/title/${t.id}?edit=progress`)
        return
      }
      const watched = change.history.label ?? 'Episode'
      const next = describePosition(change.title.progress!)
      const ok = await commit(change, `Watched ${watched}`, `${t.title} · ${next}`)
      if (!ok) return

      if (change.outcome === 'season-advanced') {
        toast.info(`On to season ${change.title.progress!.season}`, { description: t.title })
      } else if (change.outcome === 'season-finished') {
        const p = change.title.progress!
        toast(`Finished season ${p.season} of ${t.title}`, {
          description: 'Next season unknown — start it if it exists, or mark the series completed.',
          duration: 10000,
          action: {
            label: `Start S${(p.season ?? 0) + 1}`,
            onClick: () => void commit(applyProgress(change.title, startNextSeason(p), `Started season ${(p.season ?? 0) + 1}`), `Started season ${(p.season ?? 0) + 1}`),
          },
        })
      } else if (change.outcome === 'series-finished') {
        const yes = await confirm({
          title: 'Series finished?',
          body: <>You've watched every known episode of <strong className="text-fg">{t.title}</strong>. Mark it as completed?</>,
          confirmLabel: 'Mark completed',
          cancelLabel: 'Not yet',
        })
        if (yes) await setStatus(change.title, 'completed')
      }
    },
    [commit, confirm, navigate, setStatus],
  )

  const nextSeason = useCallback(
    (t: Title) => {
      if (!t.progress) return
      const p = startNextSeason(t.progress)
      return commit(applyProgress(t, p, `Started season ${p.season}`), `Started season ${p.season}`, t.title)
    },
    [commit],
  )

  const movieWatched = useCallback(
    (t: Title, date: string) => commit(applyMovieWatched(t, date), `Watched ${t.title}`),
    [commit],
  )

  const logSpecial = useCallback(
    (t: Title, label: string) => commit(applySpecial(t, label), `Logged ${label}`, t.title),
    [commit],
  )

  const remove = useCallback(
    async (t: Title) => {
      const yes = await confirm({
        title: `Delete ${t.title}?`,
        body: (
          <>
            <p>This removes the title, its watch history and any uploaded poster from this device.</p>
            <p>It can only be recovered from a backup you've exported.</p>
          </>
        ),
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!yes) return false
      try {
        await lib.remove(t.id)
        toast.success(`Deleted ${t.title}`)
        return true
      } catch (err) {
        toast.error(errMsg(err))
        return false
      }
    },
    [confirm, lib],
  )

  return { markWatched, setStatus, nextSeason, movieWatched, logSpecial, remove, undo, commit }
}

