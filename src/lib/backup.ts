import { bulkWrite, listAllHistory, listImages, listTitles, newId } from './db'
import type { HistoryEntry, MediaType, Release, Sequel, StoredImage, SyncInfo, Title, WatchStatus } from './types'

/**
 * Backup file format (JSON):
 * {
 *   "format": "watchtrack-backup",
 *   "version": 1,
 *   "exportedAt": ISO string,
 *   "titles": Title[],
 *   "history": HistoryEntry[],
 *   "images": [{ "id", "type", "createdAt", "data": base64 }]   // uploaded posters
 * }
 */
export const BACKUP_FORMAT = 'watchtrack-backup'
export const BACKUP_VERSION = 1

export interface BackupImage {
  id: string
  type: string
  createdAt: string
  data: string
}

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  titles: Title[]
  history: HistoryEntry[]
  images: BackupImage[]
}

/** Case, accent and punctuation-insensitive form of a name, for comparisons only. */
// A standalone "x" between words is the "×" some sites write ("SPY x FAMILY" = "Spy×Family"), so it's dropped like punctuation.
export const normTitle = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/\sx\s/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '')

export const titleKey = (t: { title: string; mediaType: MediaType }) => `${t.mediaType}:${normTitle(t.title)}`

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function createBackup(): Promise<Backup> {
  const [titles, history, images] = await Promise.all([listTitles(), listAllHistory(), listImages()])
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    titles,
    history,
    images: await Promise.all(
      images.map(async (i) => ({ id: i.id, type: i.type, createdAt: i.createdAt, data: await blobToBase64(i.blob) })),
    ),
  }
}

export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- Validation ----------

export const MEDIA: MediaType[] = ['anime', 'tv', 'movie']
export const STATUS: WatchStatus[] = ['watching', 'on_hold', 'plan', 'completed', 'dropped']
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isStr = (v: unknown): v is string => typeof v === 'string'
const isNumOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))

function checkTitle(t: unknown, i: number): string | null {
  const at = `Title #${i + 1}`
  if (!isObj(t)) return `${at} is not an object.`
  if (!isStr(t.id) || !t.id) return `${at} has no id.`
  if (!isStr(t.title) || !t.title.trim()) return `${at} has no title.`
  if (!MEDIA.includes(t.mediaType as MediaType)) return `${at} ("${t.title}") has an invalid media type.`
  if (!STATUS.includes(t.status as WatchStatus)) return `${at} ("${t.title}") has an invalid status.`
  if (!isNumOrNull(t.rating)) return `${at} ("${t.title}") has an invalid rating.`
  if (t.progress !== null) {
    const p = t.progress
    if (!isObj(p)) return `${at} ("${t.title}") has invalid progress.`
    if (p.numbering !== 'seasonal' && p.numbering !== 'absolute') return `${at} ("${t.title}") has invalid numbering.`
    if (!isNumOrNull(p.season) || !isNumOrNull(p.nextEpisode)) return `${at} ("${t.title}") has invalid episode progress.`
    if (!Array.isArray(p.skipped) || !isObj(p.seasonEpisodeCounts)) return `${at} ("${t.title}") has invalid progress details.`
  }
  for (const k of ['createdAt', 'updatedAt'] as const) if (!isStr(t[k])) return `${at} ("${t.title}") is missing ${k}.`
  return null
}

/** Fill fields added in later versions so older backups still load. */
function normalizeTitle(t: Title): Title {
  return {
    ...t,
    altTitles: t.altTitles ?? [],
    synopsis: t.synopsis ?? '',
    year: t.year ?? null,
    genres: t.genres ?? [],
    tags: t.tags ?? [],
    notes: t.notes ?? '',
    poster: t.poster ?? null,
    backdropUrl: t.backdropUrl ?? null,
    watchedDate: t.watchedDate ?? null,
    source: t.source ?? null,
    importNote: t.importNote ?? null,
    completedAt: t.completedAt ?? null,
    lastWatchedAt: t.lastWatchedAt ?? null,
    sync: normalizeSync(t.sync),
    alerts: typeof t.alerts === 'boolean' ? t.alerts : undefined,
  }
}

const isRelease = (r: unknown): r is Release =>
  isObj(r) && (r.kind === 'episode' || r.kind === 'season') && isNumOrNull(r.season) && isNumOrNull(r.episode) && (r.airdate === null || isStr(r.airdate)) && (r.name == null || isStr(r.name))

/** Optional refresh state: dropped if malformed, so the title simply gets refreshed again. */
function normalizeSync(s: unknown): Title['sync'] {
  if (!isObj(s) || !isStr(s.checkedAt)) return undefined
  const q = s.sequel
  const sequel = isObj(q) && Number.isInteger(q.anilistId) && isStr(q.title) && isStr(q.status) && isStr(q.url) ? (q as unknown as Sequel) : null
  const next = isObj(s.nextAiring) && isStr(s.nextAiring.airdate) ? (s.nextAiring as unknown as SyncInfo['nextAiring']) : null
  // A malformed list is dropped as a whole: the next refresh just re-learns it without alerting.
  const upcoming = Array.isArray(s.upcoming) && s.upcoming.every(isRelease) ? s.upcoming : undefined
  return { ...(s as unknown as SyncInfo), nextAiring: next, sequel, upcoming }
}

export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new Error('This is not a WatchTrack backup file.')
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION)
    throw new Error('This backup was made by a newer version of the app. Update the app and try again.')
  if (!Array.isArray(raw.titles) || !Array.isArray(raw.history) || !Array.isArray(raw.images))
    throw new Error('The backup is missing titles, history or images.')
  raw.titles.forEach((t, i) => {
    const err = checkTitle(t, i)
    if (err) throw new Error(err)
  })
  for (const h of raw.history) {
    if (!isObj(h) || !isStr(h.id) || !isStr(h.titleId) || !isStr(h.at)) throw new Error('The backup contains an invalid history entry.')
  }
  for (const img of raw.images) {
    if (!isObj(img) || !isStr(img.id) || !isStr(img.type) || !isStr(img.data)) throw new Error('The backup contains an invalid image.')
  }
  return { ...(raw as unknown as Backup), titles: (raw.titles as Title[]).map(normalizeTitle) }
}

// ---------- Import planning ----------

export interface ImportPlan {
  backup: Backup
  fresh: Title[]
  duplicates: { incoming: Title; existing: Title }[]
}

export function planImport(backup: Backup, existing: Title[]): ImportPlan {
  const byId = new Map(existing.map((t) => [t.id, t]))
  const byKey = new Map(existing.map((t) => [titleKey(t), t]))
  const fresh: Title[] = []
  const duplicates: ImportPlan['duplicates'] = []
  for (const t of backup.titles) {
    const match = byId.get(t.id) ?? byKey.get(titleKey(t))
    if (match) duplicates.push({ incoming: t, existing: match })
    else fresh.push(t)
  }
  return { backup, fresh, duplicates }
}

export type ImportMode = 'merge' | 'replace'
export type DuplicateStrategy = 'skip' | 'overwrite' | 'keep-both'

/** Build the exact records to write. Pure, so it can be tested without IndexedDB. */
export function resolveImport(plan: ImportPlan, mode: ImportMode, dup: DuplicateStrategy) {
  const { backup } = plan
  const images = new Map(backup.images.map((i) => [i.id, i]))
  const titles: Title[] = []
  const idMap = new Map<string, string>() // incoming title id → id written

  const take = (t: Title, id = t.id) => {
    titles.push({ ...t, id })
    idMap.set(t.id, id)
  }

  if (mode === 'replace') {
    backup.titles.forEach((t) => take(t))
  } else {
    plan.fresh.forEach((t) => take(t))
    for (const { incoming, existing } of plan.duplicates) {
      if (dup === 'overwrite') take(incoming, existing.id)
      else if (dup === 'keep-both') take(incoming, existing.id === incoming.id ? newId() : incoming.id)
    }
  }

  // Remapped titles (keep-both) get fresh history ids so they never clobber the original's history.
  const history: HistoryEntry[] = backup.history
    .filter((h) => idMap.has(h.titleId))
    .map((h) => {
      const titleId = idMap.get(h.titleId)!
      return { ...h, titleId, id: titleId === h.titleId ? h.id : newId() }
    })

  const usedImages = new Set(titles.flatMap((t) => (t.poster?.kind === 'local' ? [t.poster.imageId] : [])))
  const storedImages: StoredImage[] = [...usedImages]
    .filter((id) => images.has(id))
    .map((id) => {
      const i = images.get(id)!
      return { id: i.id, type: i.type, createdAt: i.createdAt, blob: base64ToBlob(i.data, i.type) }
    })

  return { titles, history, images: storedImages }
}

export async function applyImport(plan: ImportPlan, mode: ImportMode, dup: DuplicateStrategy) {
  const data = resolveImport(plan, mode, dup)
  await bulkWrite(data, mode === 'replace')
  return data
}
