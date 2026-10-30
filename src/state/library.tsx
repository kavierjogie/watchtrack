import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { normalizeTitle } from '../lib/backup'
import * as db from '../lib/db'
import { driveConnected, markDirty, onDirty, syncDrive } from '../lib/drive'
import { saveKitsuPosters } from '../lib/posters'
import type { Change } from '../lib/titles'
import type { Title } from '../lib/types'

interface LibraryState {
  titles: Title[]
  loading: boolean
  error: string | null
  /** Episodes logged via "mark watched" (from watch history). */
  episodesLogged: number
  /** Bumped whenever history changes, so detail views can refetch. */
  historyVersion: number
  byId: (id: string) => Title | undefined
  save: (title: Title) => Promise<void>
  /** Atomic update of the stored title (no history entry); see db.updateTitle. */
  patch: (id: string, fn: (t: Title) => Title | null) => Promise<Title | undefined>
  commit: (change: Change) => Promise<void>
  remove: (id: string) => Promise<void>
  undoLast: (titleId: string) => Promise<Title | null>
  reload: () => Promise<void>
}

const Ctx = createContext<LibraryState | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [titles, setTitles] = useState<Title[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [episodesLogged, setEpisodesLogged] = useState(0)
  const [historyVersion, setHistoryVersion] = useState(0)

  const reload = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([db.listTitles(), db.listAllHistory()])
      // Stored records are untrusted too (older versions, imports, manual edits): a damaged field mustn't crash a page.
      setTitles(t.map(normalizeTitle))
      setEpisodesLogged(h.filter((e) => e.kind === 'episode').length)
      setHistoryVersion((v) => v + 1)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your library.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useDriveAutoSync(reload)

  const upsert = (t: Title) => setTitles((prev) => (prev.some((p) => p.id === t.id) ? prev.map((p) => (p.id === t.id ? t : p)) : [...prev, t]))

  // Once per app open, after the library first loads.
  const postersSaved = useRef(false)
  useEffect(() => {
    if (loading || postersSaved.current || !navigator.onLine) return
    postersSaved.current = true
    void saveKitsuPosters(titles, (t) => {
      upsert(normalizeTitle(t))
      markDirty()
    }).catch(() => {})
  }, [loading, titles])

  const value = useMemo<LibraryState>(() => {
    const index = new Map(titles.map((t) => [t.id, t]))
    return {
      titles,
      loading,
      error,
      episodesLogged,
      historyVersion,
      byId: (id) => index.get(id),
      save: async (title) => {
        await db.saveTitle(title)
        upsert(title)
        markDirty()
      },
      patch: async (id, fn) => {
        const t = await db.updateTitle(id, fn)
        if (t) upsert(normalizeTitle(t))
        return t
      },
      commit: async ({ title, history }) => {
        await db.saveTitle(title, history)
        upsert(title)
        markDirty()
        if (history.kind === 'episode') setEpisodesLogged((n) => n + 1)
        setHistoryVersion((v) => v + 1)
      },
      remove: async (id) => {
        await db.deleteTitle(id)
        setTitles((prev) => prev.filter((t) => t.id !== id))
        markDirty()
        const h = await db.listAllHistory()
        setEpisodesLogged(h.filter((e) => e.kind === 'episode').length)
      },
      undoLast: async (titleId) => {
        const title = index.get(titleId)
        const [last] = await db.listHistory(titleId)
        if (!title || !last?.before) return null
        const restored = await db.undoHistory(title, last)
        upsert(restored)
        markDirty()
        if (last.kind === 'episode') setEpisodesLogged((n) => Math.max(0, n - 1))
        setHistoryVersion((v) => v + 1)
        return restored
      },
      reload,
    }
  }, [titles, loading, error, episodesLogged, historyVersion, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLibrary(): LibraryState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider')
  return ctx
}

/** Google Drive sync triggers: app opened, brought back to the front, back online, and 5 s after the last local edit. */
function useDriveAutoSync(reload: () => Promise<void>) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastRun = 0
    const run = () => {
      clearTimeout(timer)
      lastRun = Date.now()
      if (driveConnected() && navigator.onLine) void syncDrive().then((changed) => {
        if (changed) void reload()
      })
    }
    // Each sync downloads the whole file, so flicking between tabs mustn't start one every time.
    const visible = () => document.visibilityState === 'visible' && Date.now() - lastRun >= 60_000 && run()
    run()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', run)
    const off = onDirty(() => {
      clearTimeout(timer)
      timer = setTimeout(run, 5000)
    })
    return () => {
      clearTimeout(timer)
      off()
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('online', run)
    }
  }, [reload])
}
