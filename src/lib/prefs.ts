import { useSyncExternalStore } from 'react'
import { getDb } from './db'
import type { MediaType, WatchStatus } from './types'

/** Small UI preferences only — personal tracking data lives in IndexedDB. */
export interface Prefs {
  theme: 'dark' | 'light' | 'system'
  gridSize: 'sm' | 'md' | 'lg'
  libraryView: 'grid' | 'list'
  defaultType: MediaType | 'all'
  defaultStatus: WatchStatus | 'all'
  /** How progress is entered by default: "last episode watched" or "next episode to watch". */
  progressMode: 'last' | 'next'
  /** WatchTrack Alerts (alerts.ts): master switch and categories. */
  alertsOn: boolean
  alertSeasons: boolean
  alertEpisodes: boolean
  alertDates: boolean
  /** System notifications while the app is in the background or closed. Off until the user turns it on and grants permission. */
  browserNotify: boolean
  /** ISO time after which the Dashboard may nudge for a backup again ('' = whenever the library is big enough). */
  backupNudgeAfter: string
}

const KEY = 'watchtrack:prefs'
const DEFAULTS: Prefs = {
  theme: 'dark',
  gridSize: 'md',
  libraryView: 'grid',
  defaultType: 'all',
  defaultStatus: 'all',
  progressMode: 'last',
  alertsOn: true,
  alertSeasons: true,
  alertEpisodes: true,
  alertDates: true,
  browserNotify: false,
  backupNudgeAfter: '',
}

let cache: Prefs | null = null
const listeners = new Set<() => void>()

export function getPrefs(): Prefs {
  if (cache) return cache
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const saved = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    // Known keys with the right type only. Drops the TMDB key older versions kept here (TMDB now goes through /api/tmdb).
    cache = Object.fromEntries(
      Object.entries(DEFAULTS).map(([k, v]) => [k, typeof saved[k] === typeof v ? saved[k] : v]),
    ) as unknown as Prefs
    if ('tmdbKey' in saved) localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...getPrefs(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Storage blocked: preferences just won't persist.
  }
  if (Object.keys(patch).some((k) => (ALERT_KEYS as string[]).includes(k))) void mirrorAlertPrefs()
  listeners.forEach((l) => l())
}

const ALERT_KEYS = ['alertsOn', 'alertSeasons', 'alertEpisodes', 'alertDates', 'browserNotify'] satisfies (keyof Prefs)[]
const MIRROR_ROW = 'alert-prefs'

/** The service worker has no localStorage, so the settings a background check needs are copied to IndexedDB. */
export async function mirrorAlertPrefs(): Promise<void> {
  try {
    const prefs = getPrefs()
    await (await getDb()).put('settings', { key: MIRROR_ROW, value: Object.fromEntries(ALERT_KEYS.map((k) => [k, prefs[k]])) })
  } catch {
    // Storage blocked: background checks stay off, because the worker finds no copy.
  }
}

/** For the service worker. null = the app hasn't saved a copy yet, so nothing has been turned on. */
export async function readMirroredPrefs(): Promise<Prefs | null> {
  const row = await (await getDb()).get('settings', MIRROR_ROW)
  return row ? { ...DEFAULTS, ...(row.value as Partial<Prefs>) } : null
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getPrefs,
    getPrefs,
  )
}

export function applyTheme(theme: Prefs['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  // Ease real switches only: not the first paint (page still loading) and not when the user asked for less motion.
  if (root.classList.contains('dark') !== dark && document.readyState === 'complete' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-fade')
    setTimeout(() => root.classList.remove('theme-fade'), 300)
  }
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  // Match the phone's status bar to the page.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b12' : '#f7f6fb')
}

const NUDGE_TITLES = 5
const NUDGE_DAYS = 30

/** Nudge (to connect Google Drive) once there are 5+ titles, and not within 30 days of a dismissal. */
export function backupNudgeDue(titleCount: number, after: string, now = Date.now()): boolean {
  return titleCount >= NUDGE_TITLES && (!after || Date.parse(after) <= now)
}

export function snoozeBackupNudge(now = Date.now()) {
  setPrefs({ backupNudgeAfter: new Date(now + NUDGE_DAYS * 86_400_000).toISOString() })
}
