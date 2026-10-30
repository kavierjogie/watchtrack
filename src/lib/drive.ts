import { useSyncExternalStore } from 'react'
import { base64ToBlob, createBackup } from './backup'
import { applySync, listTombstones } from './db'
import { mergeLibraries, parseSyncDoc } from './merge'

/**
 * Google Drive sync: the library is mirrored to one file in the user's own Drive "appDataFolder" (hidden, app-only),
 * with a few weekly safety copies beside it.
 * No WatchTrack server stores anything; api/google-token.ts only swaps OAuth codes for tokens.
 * Flow: pull the Drive copy → merge (merge.ts) → write changes locally → upload if Drive was missing something.
 */
const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
export const driveConfigured = CLIENT_ID !== ''
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const FILE_NAME = 'watchtrack-library.json'
const KEY = 'watchtrack:drive'
const OAUTH_KEY = 'watchtrack:oauth'
const redirectUri = () => `${window.location.origin}/settings`

export interface DriveState {
  /** Present while connected. */
  refresh?: string
  access?: string
  expires?: number
  fileId?: string
  lastSync?: string
  /** When the newest safety copy was made, so most syncs needn't ask Drive. */
  lastCopy?: number
  error?: string
  syncing?: boolean
}

// ---------- State (localStorage, shared with React) ----------

let state: DriveState = read()
const listeners = new Set<() => void>()

function read(): DriveState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as DriveState
  } catch {
    return {}
  }
}

function set(patch: Partial<DriveState>) {
  state = { ...state, ...patch }
  try {
    const { syncing: _, ...saved } = state
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    // Storage blocked: stays connected for this visit only.
  }
  listeners.forEach((l) => l())
}

export function useDrive(): DriveState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )
}

export const driveConnected = () => !!state.refresh

// ---------- Connect / disconnect ----------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)))

/** Leaves the page for Google's consent screen; Google sends the user back to /settings. */
export async function connectDrive() {
  const verifier = random(48)
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const st = random(16)
  sessionStorage.setItem(OAUTH_KEY, JSON.stringify({ verifier, state: st }))
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: st,
  })
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}

async function tokenCall(body: Record<string, string>) {
  const res = await fetch('/api/google-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string }
  if (data.error === 'invalid_grant') {
    disconnectLocal('Google Drive access was removed or expired. Connect again to keep syncing.')
    throw new Error(state.error)
  }
  if (!res.ok || !data.access_token) throw new Error(data.error ?? "Couldn't reach Google.")
  set({ access: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000, ...(data.refresh_token ? { refresh: data.refresh_token } : {}) })
}

/**
 * Call on /settings load. Finishes a connect that Google redirected back from. Resolves true when it connected;
 * failures land in state.error (shown in Settings), since toasts fired during page load can be missed.
 * Reads window.location directly and clears the code from the URL first, so a second call (StrictMode) is a no-op.
 */
export async function finishConnect(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('code') && !params.has('error')) return false
  const saved = sessionStorage.getItem(OAUTH_KEY)
  sessionStorage.removeItem(OAUTH_KEY)
  window.history.replaceState(null, '', '/settings')
  const { verifier, state: st } = (saved ? JSON.parse(saved) : {}) as { verifier?: string; state?: string }
  const code = params.get('code')
  try {
    if (!code || !verifier || params.get('state') !== st) throw new Error(params.get('error') === 'access_denied' ? 'Google Drive was not connected.' : 'Connecting to Google Drive failed. Try again.')
    await tokenCall({ code, verifier, redirect_uri: redirectUri() })
  } catch (err) {
    set({ error: err instanceof Error ? err.message : 'Connecting to Google Drive failed. Try again.' })
    return false
  }
  set({ error: undefined, fileId: undefined })
  return true
}

function disconnectLocal(error?: string) {
  set({ refresh: undefined, access: undefined, expires: undefined, fileId: undefined, lastSync: undefined, lastCopy: undefined, error })
}

/** Forget the tokens here and revoke them at Google. The Drive copy stays, so reconnecting brings everything back. */
export function disconnectDrive() {
  const token = state.refresh
  disconnectLocal()
  if (token) void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}

// ---------- Drive API ----------

async function accessToken(): Promise<string> {
  if (!state.refresh) throw new Error('Google Drive is not connected.')
  if (!state.access || (state.expires ?? 0) < Date.now() + 60_000) await tokenCall({ refresh_token: state.refresh })
  return state.access!
}

async function api(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` } })
  if (res.status === 401 && retry) {
    set({ access: undefined })
    return api(url, init, false)
  }
  return res
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

async function findFile(): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}'`)
  const res = await api(`${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id)`)
  if (!res.ok) throw new Error("Couldn't read your Google Drive.")
  const id = ((await res.json()) as { files?: { id: string }[] }).files?.[0]?.id ?? null
  set({ fileId: id ?? undefined })
  return id
}

async function pull(): Promise<string | null> {
  const id = state.fileId ?? (await findFile())
  if (!id) return null
  const res = await api(`${DRIVE}/${id}?alt=media`)
  if (res.status === 404) {
    set({ fileId: undefined })
    return (await findFile()) ? pull() : null
  }
  if (!res.ok) throw new Error("Couldn't download your library from Google Drive.")
  return res.text()
}

function createFile(name: string, json: string) {
  const boundary = random(12)
  const meta = JSON.stringify({ name, parents: ['appDataFolder'] })
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`
  return api(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
}

async function upload(json: string) {
  const id = state.fileId
  let res: Response
  if (id) {
    res = await api(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json })
  } else {
    res = await createFile(FILE_NAME, json)
    if (res.ok) set({ fileId: ((await res.clone().json()) as { id: string }).id })
  }
  if (!res.ok) throw new Error("Couldn't save your library to Google Drive.")
}

// ---------- Safety copies ----------

// A mistaken delete syncs everywhere, so a few older versions of the Drive file are kept beside it.
const COPY_PREFIX = 'watchtrack-safety-'
const COPY_EVERY_MS = 7 * 86_400_000
const COPIES_KEPT = 4

export interface SafetyCopy {
  id: string
  createdTime: string
}

/** Newest first. */
export async function listSafetyCopies(): Promise<SafetyCopy[]> {
  const q = encodeURIComponent(`name contains '${COPY_PREFIX}'`)
  const res = await api(`${DRIVE}?spaces=appDataFolder&q=${q}&orderBy=createdTime%20desc&fields=files(id,createdTime)`)
  if (!res.ok) throw new Error("Couldn't read your Google Drive.")
  return ((await res.json()) as { files?: SafetyCopy[] }).files ?? []
}

export async function readSafetyCopy(id: string): Promise<string> {
  const res = await api(`${DRIVE}/${id}?alt=media`)
  if (!res.ok) throw new Error("Couldn't download that copy from Google Drive.")
  return res.text()
}

/** Saves the Drive file as it was before this sync overwrites it, once a week across all devices. */
async function keepSafetyCopy(json: string, now = Date.now()) {
  if (state.lastCopy && now - state.lastCopy < COPY_EVERY_MS) return
  const copies = await listSafetyCopies()
  const newest = copies[0] ? Date.parse(copies[0].createdTime) : 0
  if (now - newest < COPY_EVERY_MS) return set({ lastCopy: newest })
  const res = await createFile(`${COPY_PREFIX}${new Date(now).toISOString().slice(0, 10)}.json`, json)
  if (!res.ok) throw new Error("Couldn't save a safety copy.")
  set({ lastCopy: now })
  await Promise.all(copies.slice(COPIES_KEPT - 1).map((c) => api(`${DRIVE}/${c.id}`, { method: 'DELETE' })))
}

// ---------- Sync ----------

let running: Promise<boolean> | null = null

/**
 * One full sync. Resolves true when this device's library changed (the caller reloads it). Never throws: errors are
 * shown via state.error, and nothing is deleted or overwritten when a step fails.
 * ponytail: pull → merge → push has a seconds-wide race if two devices save at once (the later upload drops the
 * other's change until it syncs again, which re-merges it). Use Drive's If-Match etag if that ever bites.
 */
export function syncDrive(): Promise<boolean> {
  if (!state.refresh) return Promise.resolve(false)
  running ??= (async () => {
    set({ syncing: true })
    try {
      const [backup, deleted, remoteText] = await Promise.all([createBackup(), listTombstones(), pull()])
      // An unreadable Drive copy is left alone rather than overwritten.
      const remote = remoteText === null ? null : parseSyncDoc(remoteText)
      const { doc, toLocal, push } = mergeLibraries({ ...backup, deleted }, remote)
      await applySync({ ...toLocal, images: toLocal.images.map((i) => ({ id: i.id, type: i.type, createdAt: i.createdAt, blob: base64ToBlob(i.data, i.type) })) })
      if (push) {
        // Never blocks syncing: a failed copy is simply tried again on the next upload.
        if (remoteText !== null) await keepSafetyCopy(remoteText).catch(() => {})
        await upload(JSON.stringify(doc))
      }
      set({ lastSync: new Date().toISOString(), error: undefined })
      return toLocal.titles.length + toLocal.history.length + toLocal.deleteIds.length > 0
    } catch (err) {
      if (state.refresh) set({ error: err instanceof Error ? err.message : 'Sync failed.' })
      return false
    } finally {
      set({ syncing: false })
      running = null
    }
  })()
  return running
}

// Local edits mark the library dirty; useDriveAutoSync (state/library.tsx) syncs a few seconds later.
const dirtyListeners = new Set<() => void>()
export const markDirty = () => dirtyListeners.forEach((l) => l())
export function onDirty(fn: () => void) {
  dirtyListeners.add(fn)
  return () => void dirtyListeners.delete(fn)
}
