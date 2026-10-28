/**
 * WatchTrack Alerts: release news found by comparing a title before and after a provider refresh (sync.ts).
 *
 * detectEvents is pure and runs inside the refresh's own read-modify-write, so it sees exactly what that refresh changed.
 * Each event id is stable — provider id + what happened ("tvmaze:2993:announced:s6", "…:date:s6:2027-03-01",
 * "…:released:s5e3-4") — and ids are remembered after the alert is dismissed or pruned, so refreshing, reopening the
 * app or importing a backup never alerts twice. A title's first refresh only learns what already exists.
 *
 * Checks only run while the app is open. A scheduled server job could run the same refresh + detectEvents and send
 * Web Push; only the store and showSystemNotification below are browser-specific.
 */
import { useSyncExternalStore } from 'react'
import { getDb, guardWrite } from './db'
import { formatRelease } from './format'
import { getPrefs, type Prefs } from './prefs'
import type { Release, Title } from './types'

export type AlertKind = 'season_announced' | 'date_confirmed' | 'date_changed' | 'upcoming_episode' | 'episode_released' | 'season_available'

export interface AlertEvent {
  /** Stable: the same news always gets the same id. */
  id: string
  kind: AlertKind
  titleId: string
  /** "Season 6", "S5 · E3–E4", "Episode 1102", "Next season" */
  label: string
  /** Release date when the provider gave one (YYYY-MM-DD or timestamp). */
  date: string | null
  /** Episode or next-season name. */
  detail: string | null
}

export interface Alert extends AlertEvent {
  showTitle: string
  createdAt: string
  read: boolean
  dismissed: boolean
  /** Found while alerts were off for this title or kind: never notified, but still listed as a release on the Upcoming page. */
  muted: boolean
}

export const ALERT_HEADING: Record<AlertKind, string> = {
  season_announced: 'New season announced',
  date_confirmed: 'Release date confirmed',
  date_changed: 'Release date changed',
  upcoming_episode: 'Upcoming episode',
  episode_released: 'New episode released',
  season_available: 'New season available',
}

export const RELEASED: AlertKind[] = ['episode_released', 'season_available']

// ---------- Detection (pure) ----------

const day = (d: string | null | undefined) => d?.slice(0, 10) ?? null
const fullDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)
const range = (from: number, to: number) => (from === to ? `${to}` : `${from}–${to}`)

export function detectEvents(before: Title, after: Title, now: string): AlertEvent[] {
  const b = before.sync
  const a = after.sync
  const p0 = before.progress
  const p1 = after.progress
  // Never refreshed before (new title, older backup): this refresh only learns the baseline.
  if (!b || !a || !p0 || !p1) return []
  const key = after.source ? `${after.source.provider}:${after.source.id}` : after.id
  const out: AlertEvent[] = []
  const push = (kind: AlertKind, id: string, label: string, date: string | null = null, detail: string | null = null) =>
    out.push({ id: `${key}:${id}`, kind, titleId: after.id, label, date, detail })
  const wasDue = (season: number | null, episode: number) => b.upcoming?.find((r) => r.kind === 'episode' && r.season === season && r.episode === episode) ?? null

  // Released: counts only grow (sync.ts), so a diff is new episodes and can't overlap an earlier one.
  if (p1.numbering === 'seasonal') {
    const c0 = p0.seasonEpisodeCounts
    if (Object.keys(c0).length)
      for (const [k, n] of Object.entries(p1.seasonEpisodeCounts)) {
        const s = Number(k)
        const was = c0[s] ?? 0
        if (n <= was) continue
        const r = wasDue(s, n)
        if (was === 0) push('season_available', `available:s${s}`, `Season ${s}`, r?.airdate ?? null, `${n} episode${n > 1 ? 's' : ''} out`)
        else push('episode_released', `released:s${s}e${range(was + 1, n)}`, `S${s} · E${range(was + 1, n)}`, r?.airdate ?? null, n === was + 1 ? (r?.name ?? null) : null)
      }
  } else if (b.aired != null && a.aired != null && a.aired > b.aired) {
    const r = wasDue(null, a.aired)
    push('episode_released', `released:e${range(b.aired + 1, a.aired)}`, `Episode${a.aired > b.aired + 1 ? 's' : ''} ${range(b.aired + 1, a.aired)}`, r?.airdate ?? null, a.aired === b.aired + 1 ? (r?.name ?? null) : null)
  }

  const datedSeasons = new Set<string>()
  const dateChange = (prev: string | null, next: string | null, id: string, label: string, detail: string | null, season: number | null) => {
    if (!next || day(next) === day(prev)) return
    push(prev ? 'date_changed' : 'date_confirmed', `date:${id}:${day(next)}`, label, next, detail)
    if (season != null) datedSeasons.add(`${season}:${day(next)}`)
  }

  // Announced seasons (TVmaze / TMDB list a season once it's ordered). Absent list before = first look: learn only.
  if (b.upcoming) {
    for (const r of a.upcoming ?? []) {
      if (r.kind !== 'season' || r.season == null) continue
      const prev = b.upcoming.find((x) => x.kind === 'season' && x.season === r.season)
      if (prev) dateChange(prev.airdate, r.airdate, `s${r.season}`, `Season ${r.season}`, null, r.season)
      else if (!(r.season in p0.seasonEpisodeCounts)) {
        push('season_announced', `announced:s${r.season}`, `Season ${r.season}`, r.airdate)
        if (r.airdate) datedSeasons.add(`${r.season}:${day(r.airdate)}`)
      }
    }
  }

  // Anime: the next season is its own AniList entry. Only explicit statuses count: NOT_YET_RELEASED = announced.
  if (b.anilistId != null && a.sequel) {
    const s0 = b.sequel
    const s1 = a.sequel
    const same = s0?.anilistId === s1.anilistId
    const announced = (s: typeof s0) => s?.status === 'NOT_YET_RELEASED'
    if (!announced(s1)) {
      if (!(same && !announced(s0))) push('season_available', `available:ani${s1.anilistId}`, 'Next season', null, s1.title)
    } else if (!same) push('season_announced', `announced:ani${s1.anilistId}`, 'Next season', fullDate(s1.startDate), s1.title)
    else dateChange(fullDate(s0?.startDate), fullDate(s1.startDate), `ani${s1.anilistId}`, 'Next season', s1.title, null)
  }

  // Upcoming episode: only when a date appears after a gap (premiere, return from a break) — a weekly show's next
  // episode is always dated, and its release alert already covers it. Skipped when a season alert gave the same day.
  const n = a.nextAiring
  if (n && !b.nextAiring && Date.parse(n.airdate) > Date.parse(now) && !(n.season != null && datedSeasons.has(`${n.season}:${day(n.airdate)}`))) {
    const known = n.season != null && b.upcoming?.some((r) => r.kind === 'season' && r.season === n.season && day(r.airdate) === day(n.airdate))
    if (!known) {
      const name = a.upcoming?.find((r) => r.kind === 'episode' && r.season === n.season && r.episode === n.episode)?.name ?? null
      const label = n.episode == null ? 'Next episode' : n.season != null && p1.numbering === 'seasonal' ? `S${n.season} · E${n.episode}` : `Episode ${n.episode}`
      push('upcoming_episode', `upcoming:${n.episode == null ? day(n.airdate) : `s${n.season ?? ''}e${n.episode}`}`, label, n.airdate, name)
    }
  }
  return out
}

export function describeAlert(a: AlertEvent): string {
  const when = a.date ? formatRelease(a.date) : null
  const what = a.detail && a.label === 'Next season' ? a.detail : a.label
  switch (a.kind) {
    case 'season_announced':
      return `${what} has been announced${when ? ` for ${when}` : '. No release date yet'}.`
    case 'date_confirmed':
      return `${what} premieres ${when}.`
    case 'date_changed':
      return `${what} has moved to ${when}.`
    case 'upcoming_episode':
      return `${a.label}${a.detail ? ` “${a.detail}”` : ''} airs ${when ?? 'soon'}. Not out yet.`
    case 'episode_released':
      return `${a.label}${a.detail ? ` “${a.detail}”` : ''} ${a.label.startsWith('Episodes') || a.label.includes('–') ? 'are' : 'is'} out now.`
    case 'season_available':
      return `${what} is out now${a.detail && what !== a.detail ? ` · ${a.detail}` : ''}.`
  }
}

// ---------- Who gets alerted ----------

const CATEGORY: Record<AlertKind, keyof Pick<Prefs, 'alertSeasons' | 'alertEpisodes' | 'alertDates'>> = {
  season_announced: 'alertSeasons',
  season_available: 'alertSeasons',
  date_confirmed: 'alertDates',
  date_changed: 'alertDates',
  upcoming_episode: 'alertEpisodes',
  episode_released: 'alertEpisodes',
}

/** Per-title choice; by default every status except Dropped. */
export const alertsOn = (t: Pick<Title, 'alerts' | 'status'>) => t.alerts ?? t.status !== 'dropped'

export const wanted = (kind: AlertKind, t: Title, prefs = getPrefs()) => prefs.alertsOn && alertsOn(t) && prefs[CATEGORY[kind]]

// ---------- Store (IndexedDB `settings` row, so no schema change and Clear all data removes it) ----------

interface Saved {
  items: Alert[]
  /** Every event id ever recorded, newest last. */
  seen: string[]
}
const ROW = 'alerts'
const MAX_ITEMS = 200
const MAX_SEEN = 5000

type Snap = { items: Alert[]; status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null }
let snap: Snap = { items: [], status: 'idle', error: null }
const listeners = new Set<() => void>()
const set = (s: Partial<Snap>) => {
  snap = { ...snap, ...s }
  listeners.forEach((l) => l())
}

const read = (v: unknown): Saved => {
  const s = v as Partial<Saved> | undefined
  return { items: Array.isArray(s?.items) ? s.items : [], seen: Array.isArray(s?.seen) ? s.seen : [] }
}

/** One transaction per change, so two tabs can't overwrite each other's alerts. */
async function mutate(fn: (s: Saved) => Saved): Promise<Saved> {
  const next = await guardWrite(async () => {
    const tx = (await getDb()).transaction('settings', 'readwrite')
    const s = fn(read((await tx.store.get(ROW))?.value))
    await tx.store.put({ key: ROW, value: s })
    await tx.done
    return s
  })
  set({ items: next.items, status: 'ready', error: null })
  return next
}

export async function loadAlerts(): Promise<void> {
  if (snap.status === 'idle') set({ status: 'loading' })
  try {
    const row = await (await getDb()).get('settings', ROW)
    set({ items: read(row?.value).items, status: 'ready', error: null })
  } catch (err) {
    set({ status: 'error', error: err instanceof Error ? err.message : 'Could not load alerts.' })
  }
}

/** Save refresh events not seen before. Resolves to the new alerts that should be shown (not muted). */
export async function recordAlerts(found: { title: Title; events: AlertEvent[] }[], now = new Date().toISOString()): Promise<Alert[]> {
  if (!found.some((f) => f.events.length)) return []
  const prefs = getPrefs()
  let fresh: Alert[] = []
  await mutate((s) => {
    const seen = new Set(s.seen)
    fresh = []
    for (const { title, events } of found)
      for (const e of events) {
        if (seen.has(e.id)) continue
        seen.add(e.id)
        fresh.push({ ...e, showTitle: title.title, createdAt: now, read: false, dismissed: false, muted: !wanted(e.kind, title, prefs) })
      }
    return { items: [...fresh, ...s.items].slice(0, MAX_ITEMS), seen: [...seen].slice(-MAX_SEEN) }
  })
  return fresh.filter((a) => !a.muted)
}

export const markRead = (ids: string[] | 'all') =>
  mutate((s) => ({ ...s, items: s.items.map((a) => (ids === 'all' || ids.includes(a.id) ? { ...a, read: true } : a)) }))

export const dismissAlert = (id: string) => mutate((s) => ({ ...s, items: s.items.map((a) => (a.id === id ? { ...a, dismissed: true, read: true } : a)) }))

/** Alerts for the bell and history: not muted, not dismissed, newest first. */
export const visible = (items: Alert[]) => items.filter((a) => !a.muted && !a.dismissed)

export function useAlerts(): Snap {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      if (snap.status === 'idle') void loadAlerts()
      return () => listeners.delete(cb)
    },
    () => snap,
    () => snap,
  )
}

// ---------- Browser notifications (only while the app is open; see Settings for why) ----------

export const OPEN_EVENT = 'watchtrack:open'
export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window

/** Uses the service worker when there is one (needed on Android, and its click handler reopens the app). */
export async function showSystemNotification(title: string, body: string, url: string, tag?: string): Promise<boolean> {
  if (!notifySupported() || Notification.permission !== 'granted') return false
  const opts: NotificationOptions = { body, icon: '/pwa-192.png', badge: '/badge-96.png', tag, data: { url } }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, opts)
      return true
    }
    const n = new Notification(title, opts)
    n.onclick = () => {
      window.focus()
      window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: url }))
      n.close()
    }
    return true
  } catch {
    return false
  }
}

export const alertUrl = (a: Pick<AlertEvent, 'titleId'>) => `/title/${encodeURIComponent(a.titleId)}`

/** Upcoming releases for the Upcoming page: the provider's own list plus an announced anime sequel. */
export function upcomingOf(t: Title): (Release & { window: string | null })[] {
  const list: (Release & { window: string | null })[] = (t.sync?.upcoming ?? []).map((r) => ({ ...r, window: null }))
  const s = t.sync?.sequel
  if (s?.status === 'NOT_YET_RELEASED') {
    const d = fullDate(s.startDate)
    list.push({ kind: 'season', season: null, episode: null, name: s.title, airdate: d, window: d ? null : s.startDate })
  }
  return list
}
