import { isObj, isStr, parseBackup, safeTime, type Backup, type BackupImage } from './backup'
import type { HistoryEntry, Title } from './types'

/** A deleted title or history entry. Ids are UUIDs, so both kinds share one list. */
export interface Tombstone {
  id: string
  at: string
}

/** What's stored in Google Drive: a backup file plus deletions, so a title deleted on one device stays deleted on the others. */
export interface SyncDoc extends Backup {
  deleted: Tombstone[]
}

/** Long enough for every device to sync at least once; after that a deletion has nothing left to delete. */
const KEEP_TOMBSTONES_MS = 90 * 86_400_000

export function parseSyncDoc(text: string): SyncDoc {
  const backup = parseBackup(text)
  const raw = (backup as { deleted?: unknown }).deleted ?? []
  if (!Array.isArray(raw) || !raw.every((d) => isObj(d) && isStr(d.id) && isStr(d.at))) throw new Error('The Google Drive copy has an invalid deletion list.')
  // A deletion with an unreadable or future date would beat every later edit, so it's ignored.
  const deleted = (raw as Tombstone[]).flatMap((d) => {
    const at = safeTime(d.at)
    return at ? [{ id: d.id, at }] : []
  })
  return { ...backup, deleted }
}

export interface MergeResult {
  /** The merged library, to upload. */
  doc: SyncDoc
  /** What this device must write to match it. `deleteIds` are title and history ids. */
  toLocal: { titles: Title[]; history: HistoryEntry[]; images: BackupImage[]; deleteIds: string[]; tombstones: Tombstone[] }
  /** The Drive copy is missing something this device has. */
  push: boolean
}

/**
 * Saving a poster copy leaves updatedAt alone, so two devices can differ only in that. Take a copy Drive already has
 * rather than download another, and if both made one, settle on the same one everywhere so they don't keep overwriting
 * each other's upload.
 */
function betterPoster(remote: Title, local: Title): boolean {
  if (remote.poster?.kind !== 'local' || !local.poster) return false
  return local.poster.kind !== 'local' || remote.poster.imageId < local.poster.imageId
}

/**
 * Two-way merge. Per title the newer `updatedAt` wins; history and images are unions; a deletion wins over the
 * title only when it's newer than the title's last edit. Pure, so every rule is unit-tested.
 */
export function mergeLibraries(local: SyncDoc, remote: SyncDoc | null, now = Date.now()): MergeResult {
  const r: SyncDoc = remote ?? { ...local, titles: [], history: [], images: [], deleted: [] }
  let push = !remote

  const deleted = new Map<string, string>()
  for (const d of [...r.deleted, ...local.deleted]) if (!deleted.has(d.id) || d.at > deleted.get(d.id)!) deleted.set(d.id, d.at)
  for (const [id, at] of deleted) if (now - Date.parse(at) > KEEP_TOMBSTONES_MS) deleted.delete(id)
  const remoteDeleted = new Set(r.deleted.map((d) => d.id))
  if ([...deleted.keys()].some((id) => !remoteDeleted.has(id))) push = true

  const localTitles = new Map(local.titles.map((t) => [t.id, t]))
  const remoteTitles = new Map(r.titles.map((t) => [t.id, t]))
  const titles: Title[] = []
  const toLocalTitles: Title[] = []
  for (const id of new Set([...localTitles.keys(), ...remoteTitles.keys()])) {
    const l = localTitles.get(id)
    const rt = remoteTitles.get(id)
    const remoteNewer = !!rt && (!l || rt.updatedAt > l.updatedAt || (rt.updatedAt === l.updatedAt && betterPoster(rt, l)))
    const win = remoteNewer ? rt! : (l ?? rt!)
    const del = deleted.get(id)
    if (del && del >= win.updatedAt) continue
    // Edited after it was deleted somewhere else: keep the edit.
    if (del) deleted.delete(id)
    titles.push(win)
    if (remoteNewer) toLocalTitles.push(win)
    if (l && (!rt || l.updatedAt > rt.updatedAt)) push = true
  }

  const kept = new Set(titles.map((t) => t.id))
  const live = (h: HistoryEntry) => kept.has(h.titleId) && !deleted.has(h.id)
  const localHistory = new Set(local.history.map((h) => h.id))
  const remoteHistory = new Set(r.history.map((h) => h.id))
  const history = [...local.history.filter(live), ...r.history.filter((h) => live(h) && !localHistory.has(h.id))]
  if (local.history.some((h) => live(h) && !remoteHistory.has(h.id))) push = true

  const used = new Set(titles.flatMap((t) => (t.poster?.kind === 'local' ? [t.poster.imageId] : [])))
  const localImages = new Set(local.images.map((i) => i.id))
  const remoteImages = new Set(r.images.map((i) => i.id))
  const images = [...local.images, ...r.images.filter((i) => !localImages.has(i.id))].filter((i) => used.has(i.id))
  if (images.some((i) => !remoteImages.has(i.id))) push = true

  const tombstones = [...deleted].map(([id, at]) => ({ id, at }))
  return {
    doc: { ...r, format: local.format, version: local.version, exportedAt: new Date(now).toISOString(), titles, history, images, deleted: tombstones },
    toLocal: {
      titles: toLocalTitles,
      history: r.history.filter((h) => live(h) && !localHistory.has(h.id)),
      images: r.images.filter((i) => used.has(i.id) && !localImages.has(i.id)),
      deleteIds: [...[...localTitles.keys()].filter((id) => !kept.has(id)), ...local.history.filter((h) => !live(h)).map((h) => h.id)],
      tombstones,
    },
    push,
  }
}
