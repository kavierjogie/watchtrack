import { useSyncExternalStore } from 'react'
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
  /** Optional user-supplied TMDB key. Stays in this browser. */
  tmdbKey: string
}

const KEY = 'watchtrack:prefs'
const DEFAULTS: Prefs = {
  theme: 'dark',
  gridSize: 'md',
  libraryView: 'grid',
  defaultType: 'all',
  defaultStatus: 'all',
  progressMode: 'last',
  tmdbKey: '',
}

let cache: Prefs | null = null
const listeners = new Set<() => void>()

export function getPrefs(): Prefs {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }
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
  listeners.forEach((l) => l())
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
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}
