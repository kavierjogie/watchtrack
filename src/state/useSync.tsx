import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { autoSyncAllowed, refreshTitle, syncLibrary, type RefreshResult } from '../lib/sync'
import type { Title } from '../lib/types'
import { useLibrary } from './library'

const SAFE = "Couldn't refresh episodes. Your saved progress is safe."

function announceUpdates(results: RefreshResult[], open: (t: Title) => void) {
  const rows = results.filter((r) => r.status === 'updated')
  const updated = rows.map((r) => r.title)
  if (rows.length === 1) {
    const [{ title: t, newSeason }] = rows
    toast.success(`${t.title} has been updated`, {
      description: newSeason ? `${newSeason.title} is ${newSeason.status === 'FINISHED' ? 'out' : 'airing'}.` : 'New episodes are available.',
      action: { label: 'View', onClick: () => open(t) },
    })
  } else if (updated.length > 1) {
    toast.success(`${updated.length} shows have new episodes`, { description: updated.slice(0, 3).map((t) => t.title).join(', ') + (updated.length > 3 ? '…' : '') })
  }
  return updated.length
}

/**
 * Background refresh: shortly after the library loads, and whenever the app comes back to the foreground or online.
 * Quiet unless something new turned up — failures (often just offline) are retried on a later open.
 */
export function useAutoSync() {
  const lib = useLibrary()
  const navigate = useNavigate()
  const latest = useRef({ lib, navigate })
  useLayoutEffect(() => {
    latest.current = { lib, navigate }
  })

  useEffect(() => {
    if (lib.loading) return
    const ctrl = new AbortController()
    const run = () => {
      if (document.visibilityState !== 'visible' || !autoSyncAllowed()) return
      const { lib, navigate } = latest.current
      void syncLibrary(lib.titles, lib.patch, { signal: ctrl.signal }).then((r) => !ctrl.signal.aborted && announceUpdates(r, (t) => navigate(`/title/${t.id}`)))
    }
    // Let the first screen settle before touching the network.
    const timer = setTimeout(run, 3000)
    document.addEventListener('visibilitychange', run)
    window.addEventListener('online', run)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', run)
      window.removeEventListener('online', run)
      ctrl.abort()
    }
  }, [lib.loading])
}

/** Manual refresh of one title or the whole library, with feedback either way. */
export function useRefreshEpisodes() {
  const lib = useLibrary()
  const navigate = useNavigate()

  const refreshOne = useCallback(
    async (t: Title) => {
      const r = await refreshTitle(t, lib.patch)
      if (r.status === 'updated') announceUpdates([r], (x) => navigate(`/title/${x.id}`))
      else if (r.status === 'unchanged') toast.success(`${t.title} is up to date`, { description: 'No new episodes yet.' })
      else if (r.status === 'failed') toast.error(SAFE, { description: r.error })
    },
    [lib.patch, navigate],
  )

  const refreshAll = useCallback(async () => {
    const results = await syncLibrary(lib.titles, lib.patch, { force: true })
    const failed = results.filter((r) => r.status === 'failed').length
    const updated = announceUpdates(results, (x) => navigate(`/title/${x.id}`))
    if (failed) toast.error(SAFE, { description: `${failed} of ${results.length} titles couldn't be checked. Try again later.` })
    else if (!updated) toast.success('Your library is up to date.', { description: results.length ? `Checked ${results.length} titles.` : 'No titles linked to TVmaze, Kitsu or TMDB.' })
  }, [lib.patch, lib.titles, navigate])

  return { refreshOne, refreshAll }
}
