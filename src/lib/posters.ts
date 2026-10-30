import { deleteImage, putImage, updateTitle, validateImage } from './db'
import { downloadPoster, fetchPosterUrl, isHttpUrl } from './metadata'
import type { MetadataSource, Poster, Title } from './types'

export const MAX_POSTER_URL = 2000
const MAX_SAVES_PER_OPEN = 20
const SAVE_PAUSE_MS = 250
const SAVE_RETRY_MS = 7 * 24 * 60 * 60 * 1000
const FAILED_SAVES_KEY = 'watchtrack:poster-save-failed'
const MAX_LOOKUPS = 2

/**
 * The URL a poster can be shown from on any device: the remote URL, or where a local copy was downloaded from.
 * Null for uploaded files and anything that isn't plain http(s).
 */
export function publicPosterUrl(p: Poster | null): string | null {
  const url = p?.kind === 'remote' ? p.url : p?.url
  return isHttpUrl(url) && url.length <= MAX_POSTER_URL ? url : null
}

/** Remote artwork for a new title: a local copy for offline use when the host allows it, plus the URL so it can still be shared. */
export async function savePoster(url: string): Promise<Poster> {
  const blob = await downloadPoster(url)
  if (blob && !validateImage(blob)) return { kind: 'local', imageId: await putImage(blob), url }
  return { kind: 'remote', url }
}

/**
 * Titles added before Kitsu posters could be saved still only have the remote URL: save a copy now, one at a time.
 * A failure just leaves the URL in place, to try again next time the app opens. updatedAt is left alone: nothing the
 * user did changed, and Drive sync uploads the new image anyway. Capped per app open, with a pause, because each one
 * goes through our shared function and an imported file can hold any number of these URLs.
 * A stored URL that can't be saved (too big, or gone) is swapped for what Kitsu lists now. If that fails too it isn't
 * tried again for a week, so it neither calls the function on every open nor keeps the others from their turn.
 */
export async function saveKitsuPosters(titles: Title[], onSaved: (t: Title) => void) {
  // One tab at a time: a second open tab would download all the same posters. Skips quietly if another tab is on it.
  if (navigator.locks) await navigator.locks.request('watchtrack:save-posters', { ifAvailable: true }, (lock) => (lock ? saveBatch(titles, onSaved) : undefined))
  else await saveBatch(titles, onSaved)
}

async function saveBatch(titles: Title[], onSaved: (t: Title) => void) {
  const failed = readFailedSaves()
  const pending = titles
    .filter((t) => t.poster?.kind === 'remote' && t.poster.url.startsWith('https://media.kitsu.app/') && !(Date.now() - failed[t.poster.url] < SAVE_RETRY_MS))
    .slice(0, MAX_SAVES_PER_OPEN)
  for (const [i, t] of pending.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, SAVE_PAUSE_MS))
    const url = t.poster?.kind === 'remote' ? t.poster.url : ''
    let poster: Poster
    try {
      poster = await savePoster(url)
      if (poster.kind !== 'local' && t.source?.provider === 'kitsu') {
        const current = await recoverPosterUrl(t.source, t.title)
        if (current && current !== url) poster = await savePoster(current)
      }
    } catch {
      // Storage is full or blocked, so the rest would fail too. Without this the same poster would download on every open and never be kept.
      rememberFailedSave(url)
      return
    }
    if (poster.kind !== 'local') {
      if (!navigator.onLine) return // Says nothing about the poster: try again next time.
      rememberFailedSave(url)
      continue
    }
    // Re-checked against the stored title, in case the poster was changed while downloading.
    const saved = await updateTitle(t.id, (cur) => (cur.poster?.kind === 'remote' && cur.poster.url === url ? { ...cur, poster } : null))
    if (saved?.poster?.kind === 'local' && saved.poster.imageId === poster.imageId) onSaved(saved)
    else await deleteImage(poster.imageId) // Lost the race, so nothing points at this copy.
  }
}

function readFailedSaves(): Record<string, number> {
  try {
    return (JSON.parse(localStorage.getItem(FAILED_SAVES_KEY) ?? '{}') as Record<string, number> | null) ?? {}
  } catch {
    return {}
  }
}

function rememberFailedSave(url: string) {
  try {
    const live = Object.entries(readFailedSaves()).filter(([, at]) => Date.now() - at < SAVE_RETRY_MS)
    localStorage.setItem(FAILED_SAVES_KEY, JSON.stringify({ ...Object.fromEntries(live), [url]: Date.now() }))
  } catch {
    // Only costs a retry next time.
  }
}

// One lookup per title per session, however many cards show it or how often they render.
const lookups = new Map<string, Promise<string | null>>()

// If an image host goes down every card looks its poster up at once, so only a few run at a time.
let activeLookups = 0
const waitingLookups: (() => void)[] = []

async function limitLookup<T>(fn: () => Promise<T>): Promise<T> {
  if (activeLookups >= MAX_LOOKUPS) await new Promise<void>((r) => waitingLookups.push(r))
  else activeLookups++
  try {
    return await fn()
  } finally {
    const next = waitingLookups.shift()
    if (next) next() // Hands this slot on.
    else activeLookups--
  }
}

/** Look a poster up by provider id (never by name). Null when there's none or the provider can't be reached. */
export function recoverPosterUrl(source: Pick<MetadataSource, 'provider' | 'id'>, title: string): Promise<string | null> {
  const key = `${source.provider}:${source.id}`
  let p = lookups.get(key)
  if (!p) {
    p = limitLookup(() => fetchPosterUrl(source)).then(
      (url) => {
        if (!url) logPosterIssue(title, source.provider, null, 'provider has no poster for this id')
        return url
      },
      (err: unknown) => {
        logPosterIssue(title, source.provider, null, err instanceof Error ? err.message : 'lookup failed')
        return null
      },
    )
    lookups.set(key, p)
  }
  return p
}

/**
 * Local copies saved before their source URL was kept have nothing a share link can carry.
 * Find their URL by provider id; returns the same objects for titles that needed nothing.
 */
export function withPublicPosters(titles: Title[]): Promise<Title[]> {
  return Promise.all(
    titles.map(async (t) => {
      if (t.poster?.kind !== 'local' || publicPosterUrl(t.poster) || !t.source) return t
      const url = await recoverPosterUrl(t.source, t.title)
      return url ? { ...t, poster: { ...t.poster, url } } : t
    }),
  )
}

const logged = new Set<string>()

/** Dev-only, once per title+reason. Title, provider and image URL only — nothing personal. */
export function logPosterIssue(title: string, provider: string | undefined, url: string | null, reason: string) {
  if (!import.meta.env.DEV) return
  const key = `${title}|${url}|${reason}`
  if (logged.has(key)) return
  logged.add(key)
  console.warn('[WatchTrack poster]', { title, provider: provider ?? 'none', url: url?.startsWith('blob:') ? '(local copy)' : url, reason })
}
