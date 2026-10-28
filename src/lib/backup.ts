import { ALLOWED_IMAGE_TYPES, bulkWrite, listAllHistory, listImages, listTitles, newId } from './db'
import { isHttpUrl } from './metadata'
import type { HistoryEntry, HistoryKind, MediaType, MetadataSource, Poster, Release, Sequel, StoredImage, SyncInfo, Title, WatchStatus } from './types'

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
/** Episode and season numbers: whole and non-negative. No upper cap, so backups with any typed-in value still load. */
const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0
const isCountOrNull = (v: unknown) => v === null || isCount(v)
const isSkipRange = (r: unknown) => isObj(r) && isCountOrNull(r.season) && isCount(r.from) && isCount(r.to)

/** Why a progress record is unusable, or null when it's fine. Also used for undo snapshots in history. */
function checkProgress(p: unknown): string | null {
  if (!isObj(p)) return 'invalid progress'
  if (p.numbering !== 'seasonal' && p.numbering !== 'absolute') return 'invalid numbering'
  if (!isCountOrNull(p.season) || !isCountOrNull(p.nextEpisode)) return 'invalid episode progress'
  if (!(p.totalSeasons == null || isCount(p.totalSeasons)) || !(p.totalEpisodes == null || isCount(p.totalEpisodes))) return 'invalid episode totals'
  if (!Array.isArray(p.skipped) || !p.skipped.every(isSkipRange) || !isObj(p.seasonEpisodeCounts) || !Object.values(p.seasonEpisodeCounts).every(isCount))
    return 'invalid progress details'
  return null
}

function checkTitle(t: unknown, i: number): string | null {
  const at = `Title #${i + 1}`
  if (!isObj(t)) return `${at} is not an object.`
  if (!isStr(t.id) || !t.id) return `${at} has no id.`
  if (!isStr(t.title) || !t.title.trim()) return `${at} has no title.`
  if (!MEDIA.includes(t.mediaType as MediaType)) return `${at} ("${t.title}") has an invalid media type.`
  if (!STATUS.includes(t.status as WatchStatus)) return `${at} ("${t.title}") has an invalid status.`
  if (!isNumOrNull(t.rating)) return `${at} ("${t.title}") has an invalid rating.`
  if (t.progress !== null) {
    const err = checkProgress(t.progress)
    if (err) return `${at} ("${t.title}") has ${err}.`
  }
  for (const k of ['createdAt', 'updatedAt'] as const) if (!isStr(t[k])) return `${at} ("${t.title}") is missing ${k}.`
  return null
}

const strOr = <T,>(v: unknown, fallback: T) => (isStr(v) ? v : fallback)
const strList = (v: unknown) => (Array.isArray(v) ? v.filter(isStr) : [])
const httpOrNull = (v: unknown) => (isHttpUrl(v) ? v : null)
const PROVIDERS: MetadataSource['provider'][] = ['kitsu', 'anilist', 'tvmaze', 'tmdb']

/** Only shapes the app can render; links must be http(s). Anything else is dropped rather than trusted. */
function normalizePoster(p: unknown): Poster | null {
  if (!isObj(p)) return null
  if (p.kind === 'remote') return isHttpUrl(p.url) ? { kind: 'remote', url: p.url } : null
  if (p.kind === 'local' && isStr(p.imageId) && p.imageId) return isHttpUrl(p.url) ? { kind: 'local', imageId: p.imageId, url: p.url } : { kind: 'local', imageId: p.imageId }
  return null
}

function normalizeSource(s: unknown): MetadataSource | null {
  return isObj(s) && PROVIDERS.includes(s.provider as MetadataSource['provider']) && isStr(s.id) && isHttpUrl(s.url)
    ? { provider: s.provider as MetadataSource['provider'], id: s.id, url: s.url }
    : null
}

/**
 * Fill fields added in later versions so older backups still load, and coerce wrongly-typed optional fields to
 * their defaults so a damaged record can't crash the pages that render it. Also run on records read from IndexedDB.
 */
export function normalizeTitle(t: Title): Title {
  return {
    ...t,
    altTitles: strList(t.altTitles),
    synopsis: strOr(t.synopsis, ''),
    year: Number.isInteger(t.year) ? t.year : null,
    genres: strList(t.genres),
    tags: strList(t.tags),
    notes: strOr(t.notes, ''),
    poster: normalizePoster(t.poster),
    backdropUrl: httpOrNull(t.backdropUrl),
    watchedDate: strOr(t.watchedDate, null),
    source: normalizeSource(t.source),
    importNote: strOr(t.importNote, null),
    completedAt: strOr(t.completedAt, null),
    lastWatchedAt: strOr(t.lastWatchedAt, null),
    sync: normalizeSync(t.sync),
    alerts: typeof t.alerts === 'boolean' ? t.alerts : undefined,
  }
}

const HISTORY_KINDS: HistoryKind[] = ['episode', 'special', 'movie', 'correction', 'status']

/** An undo snapshot that would restore unusable progress is dropped: that entry just can't be undone. */
const validSnapshot = (s: unknown) => isObj(s) && STATUS.includes(s.status as WatchStatus) && (s.progress === null || !checkProgress(s.progress))

function normalizeHistory(h: HistoryEntry): HistoryEntry {
  return {
    ...h,
    kind: HISTORY_KINDS.includes(h.kind) ? h.kind : 'correction',
    season: isCountOrNull(h.season) ? h.season : null,
    episode: isCountOrNull(h.episode) ? h.episode : null,
    label: strOr(h.label, null),
    before: validSnapshot(h.before) ? h.before : null,
  }
}

const isRelease = (r: unknown): r is Release =>
  isObj(r) && (r.kind === 'episode' || r.kind === 'season') && isNumOrNull(r.season) && isNumOrNull(r.episode) && (r.airdate === null || isStr(r.airdate)) && (r.name == null || isStr(r.name))

/** Optional refresh state: dropped if malformed, so the title simply gets refreshed again. */
function normalizeSync(s: unknown): Title['sync'] {
  if (!isObj(s) || !isStr(s.checkedAt)) return undefined
  const q = s.sequel
  const sequel = q === undefined ? undefined : isObj(q) && Number.isInteger(q.anilistId) && isStr(q.title) && isStr(q.status) && isHttpUrl(q.url) ? (q as unknown as Sequel) : null
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
  const ids = new Set<string>()
  raw.titles.forEach((t, i) => {
    const err = checkTitle(t, i)
    if (err) throw new Error(err)
    const { id, title } = t as Title
    if (ids.has(id)) throw new Error(`Title #${i + 1} ("${title}") appears twice in the backup.`)
    ids.add(id)
  })
  for (const h of raw.history) {
    if (!isObj(h) || !isStr(h.id) || !isStr(h.titleId) || !isStr(h.at)) throw new Error('The backup contains an invalid history entry.')
  }
  for (const img of raw.images) {
    if (!isObj(img) || !isStr(img.id) || !isStr(img.createdAt) || !ALLOWED_IMAGE_TYPES.includes(img.type as string) || !isStr(img.data) || !BASE64.test(img.data))
      throw new Error('The backup contains an invalid image.')
  }
  return {
    ...(raw as unknown as Backup),
    titles: (raw.titles as Title[]).map(normalizeTitle),
    history: (raw.history as HistoryEntry[]).map(normalizeHistory),
  }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
/** Bigger than any real library with uploaded posters; stops a wrong or hostile file from exhausting memory. */
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024

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
