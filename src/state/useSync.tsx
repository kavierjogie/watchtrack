import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ALERT_HEADING, alertUrl, describeAlert, loadAlerts, recordAlerts, showSystemNotification, type Alert } from '../lib/alerts'
import { getPrefs } from '../lib/prefs'
import { autoSyncAllowed, refreshTitle, syncLibrary, type RefreshResult } from '../lib/sync'
import type { Title } from '../lib/types'
import { useLibrary } from './library'

const SAFE = "Couldn't refresh episodes. Your saved progress is safe."
/** While the app stays open (e.g. a background tab), look again this often; each title still only refreshes when due. */
const OPEN_INTERVAL = 30 * 60000

/**
 * Save new alerts and tell the user once: a system notification when the app is in the background (if they turned
 * those on), otherwise a toast. Resolves to the number of new alerts shown.
 */
async function deliver(results: RefreshResult[], go: (url: string) => void): Promise<number> {
  let fresh: Alert[] = []
  try {
    fresh = await recordAlerts(results.flatMap((r) => (r.status === 'updated' || r.status === 'unchanged' ? [{ title: r.title, events: r.events }] : [])))
  } catch {
    return 0 // storage blocked: the refresh itself is saved; alerts just can't be kept
  }
  if (!fresh.length) return 0
  if (document.visibilityState === 'hidden' && getPrefs().browserNotify) {
    const shown = fresh.length > 3 ? fresh.slice(0, 2) : fresh
    for (const a of shown) await showSystemNotification(`${ALERT_HEADING[a.kind]} · ${a.showTitle}`, describeAlert(a), alertUrl(a), a.id)
    if (fresh.length > 3) await showSystemNotification(`${fresh.length - 2} more WatchTrack alerts`, 'Open WatchTrack to see them all.', '/notifications', 'watchtrack-more')
  } else if (fresh.length === 1) {
    const [a] = fresh
    toast(`${ALERT_HEADING[a.kind]} · ${a.showTitle}`, { description: describeAlert(a), action: { label: 'View', onClick: () => go(alertUrl(a)) } })
  } else {
    toast(`${fresh.length} new alerts`, {
      description: [...new Set(fresh.map((a) => a.showTitle))].slice(0, 3).join(', '),
      action: { label: 'View', onClick: () => go('/notifications') },
    })
  }
  return fresh.length
}

/**
 * Background refresh: shortly after the library loads, whenever the app comes back to the foreground or online, and
 * every half hour while it stays open. Quiet unless something new turned up — failures (often just offline) are
 * retried on a later open. Nothing runs while the app is closed.
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
    const run = (background = false) => {
      if ((!background && document.visibilityState !== 'visible') || !autoSyncAllowed()) return
      void loadAlerts() // another tab may have added some
      const { lib, navigate } = latest.current
      void syncLibrary(lib.titles, lib.patch, { signal: ctrl.signal }).then((r) => (ctrl.signal.aborted ? 0 : deliver(r, navigate)))
    }
    const onShow = () => run()
    // Let the first screen settle before touching the network.
    const timer = setTimeout(onShow, 3000)
    const interval = setInterval(() => run(true), OPEN_INTERVAL)
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('online', onShow)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('online', onShow)
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
      if (r.status === 'failed') return void toast.error(SAFE, { description: r.error })
      if (r.status === 'skipped' || (await deliver([r], navigate))) return
      if (r.status === 'updated') toast.success(`${t.title} has been updated`, { description: 'New episodes are available.' })
      else toast.success(`${t.title} is up to date`, { description: 'No new episodes yet.' })
    },
    [lib.patch, navigate],
  )

  const refreshAll = useCallback(async () => {
    const results = await syncLibrary(lib.titles, lib.patch, { force: true })
    const failed = results.filter((r) => r.status === 'failed').length
    const alerts = await deliver(results, navigate)
    const updated = results.filter((r) => r.status === 'updated').length
    if (failed) toast.error(SAFE, { description: `${failed} of ${results.length} titles couldn't be checked. Try again later.` })
    else if (!alerts && updated) toast.success(`${updated} show${updated > 1 ? 's' : ''} updated`, { description: 'New episodes are available.' })
    else if (!alerts) toast.success('Your library is up to date.', { description: results.length ? `Checked ${results.length} titles.` : 'No titles linked to TVmaze, Kitsu or TMDB.' })
  }, [lib.patch, lib.titles, navigate])

  return { refreshOne, refreshAll }
}
