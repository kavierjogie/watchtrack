import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { HistoryEntry, StoredImage, Title } from './types'

export const DB_NAME = 'watchtrack'
export const DB_VERSION = 1

interface WatchDB extends DBSchema {
  titles: { key: string; value: Title; indexes: { byUpdated: string; byStatus: string } }
  watchHistory: { key: string; value: HistoryEntry; indexes: { byTitle: string; byAt: string } }
  images: { key: string; value: StoredImage }
  settings: { key: string; value: { key: string; value: unknown } }
}

export class StorageError extends Error {
  readonly quota: boolean
  constructor(message: string, quota = false) {
    super(message)
    this.quota = quota
  }
}

let dbPromise: Promise<IDBPDatabase<WatchDB>> | null = null

/** Shared, lazily-opened connection — safe to call from many components at once. */
export function getDb(): Promise<IDBPDatabase<WatchDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WatchDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Migrations run in order. Add `if (oldVersion < 2) { ... }` for future schema changes.
        if (oldVersion < 1) {
          const titles = db.createObjectStore('titles', { keyPath: 'id' })
          titles.createIndex('byUpdated', 'updatedAt')
          titles.createIndex('byStatus', 'status')
          const history = db.createObjectStore('watchHistory', { keyPath: 'id' })
          history.createIndex('byTitle', 'titleId')
          history.createIndex('byAt', 'at')
          db.createObjectStore('images', { keyPath: 'id' })
          db.createObjectStore('settings', { keyPath: 'key' })
        }
      },
      blocking() {
        // Another tab wants a newer schema: close so it can upgrade, reopen lazily next call.
        void dbPromise?.then((db) => db.close())
        dbPromise = null
      },
    }).catch((err: unknown) => {
      dbPromise = null
      throw new StorageError(
        `Could not open local storage. ${err instanceof Error ? err.message : ''} Private browsing or blocked site data can prevent saving.`,
      )
    })
  }
  return dbPromise
}

/** Wrap a write so quota errors become a clear message. */
export async function guardWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const name = err instanceof DOMException || err instanceof Error ? err.name : ''
    if (name === 'QuotaExceededError') {
      throw new StorageError('Your browser storage is full. Remove some uploaded posters or export a backup and free space.', true)
    }
    throw err
  }
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// ---------- Titles ----------

export async function listTitles(): Promise<Title[]> {
  return (await getDb()).getAll('titles')
}

export async function getTitle(id: string): Promise<Title | undefined> {
  return (await getDb()).get('titles', id)
}

/** Save a title and (optionally) a history entry atomically. */
export async function saveTitle(title: Title, history?: HistoryEntry): Promise<void> {
  await guardWrite(async () => {
    const db = await getDb()
    const tx = db.transaction(['titles', 'watchHistory'], 'readwrite')
    await tx.objectStore('titles').put(title)
    if (history) await tx.objectStore('watchHistory').put(history)
    await tx.done
  })
}

/**
 * Read-modify-write in one transaction, so a background refresh can't overwrite progress the user saved meanwhile.
 * `fn` returns null to leave the title as it is. Resolves to the saved title, or undefined if it was deleted.
 */
export async function updateTitle(id: string, fn: (t: Title) => Title | null): Promise<Title | undefined> {
  return guardWrite(async () => {
    const tx = (await getDb()).transaction('titles', 'readwrite')
    const current = await tx.store.get(id)
    const next = current && fn(current)
    if (next) await tx.store.put(next)
    await tx.done
    return next ?? current
  })
}

/** Delete a title with its history and locally stored poster. */
export async function deleteTitle(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['titles', 'watchHistory', 'images'], 'readwrite')
  const title = await tx.objectStore('titles').get(id)
  const keys = await tx.objectStore('watchHistory').index('byTitle').getAllKeys(id)
  await Promise.all(keys.map((k) => tx.objectStore('watchHistory').delete(k)))
  if (title?.poster?.kind === 'local') await tx.objectStore('images').delete(title.poster.imageId)
  await tx.objectStore('titles').delete(id)
  await tx.done
}

// ---------- History ----------

export async function listHistory(titleId: string): Promise<HistoryEntry[]> {
  const rows = await (await getDb()).getAllFromIndex('watchHistory', 'byTitle', titleId)
  return rows.sort((a, b) => b.at.localeCompare(a.at))
}

export async function listAllHistory(): Promise<HistoryEntry[]> {
  return (await getDb()).getAll('watchHistory')
}

/** Restore the title to the state saved in a history entry, removing that entry. */
export async function undoHistory(title: Title, entry: HistoryEntry): Promise<Title> {
  if (!entry.before) throw new Error('This entry cannot be undone.')
  const restored: Title = { ...title, ...entry.before, updatedAt: new Date().toISOString() }
  await guardWrite(async () => {
    const db = await getDb()
    const tx = db.transaction(['titles', 'watchHistory'], 'readwrite')
    await tx.objectStore('titles').put(restored)
    await tx.objectStore('watchHistory').delete(entry.id)
    await tx.done
  })
  return restored
}

// ---------- Images ----------

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']

export function validateImage(file: Blob): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return 'Use a JPEG, PNG, WebP, GIF or AVIF image.'
  if (file.size > MAX_IMAGE_BYTES) return 'Images must be 5 MB or smaller.'
  return null
}

export async function putImage(blob: Blob): Promise<string> {
  const error = validateImage(blob)
  if (error) throw new Error(error)
  const id = newId()
  await guardWrite(async () =>
    (await getDb()).put('images', { id, blob, type: blob.type, createdAt: new Date().toISOString() }),
  )
  return id
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return (await getDb()).get('images', id)
}

export async function deleteImage(id: string): Promise<void> {
  await (await getDb()).delete('images', id)
}

export async function listImages(): Promise<StoredImage[]> {
  return (await getDb()).getAll('images')
}

// ---------- Whole-library operations ----------

export async function clearAll(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['titles', 'watchHistory', 'images', 'settings'], 'readwrite')
  await Promise.all([
    tx.objectStore('titles').clear(),
    tx.objectStore('watchHistory').clear(),
    tx.objectStore('images').clear(),
    tx.objectStore('settings').clear(),
  ])
  await tx.done
}

export async function bulkWrite(data: { titles: Title[]; history: HistoryEntry[]; images: StoredImage[] }, replace: boolean) {
  await guardWrite(async () => {
    const db = await getDb()
    const tx = db.transaction(['titles', 'watchHistory', 'images'], 'readwrite')
    if (replace) {
      await Promise.all([tx.objectStore('titles').clear(), tx.objectStore('watchHistory').clear(), tx.objectStore('images').clear()])
    }
    await Promise.all([
      ...data.images.map((i) => tx.objectStore('images').put(i)),
      ...data.titles.map((t) => tx.objectStore('titles').put(t)),
      ...data.history.map((h) => tx.objectStore('watchHistory').put(h)),
    ])
    await tx.done
  })
}
