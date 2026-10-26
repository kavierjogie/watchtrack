import { isObj, isStr, MEDIA, STATUS } from './backup'
import { isHttpUrl } from './metadata'
import { MAX_POSTER_URL, publicPosterUrl } from './posters'
import { createTitle } from './titles'
import type { MediaType, MetadataSource, Numbering, Title, WatchStatus } from './types'

/**
 * Share links carry the whole list in the URL fragment: /shared#<payload>.
 * payload = base64url(deflate-raw(JSON)). The fragment never reaches a server, so nothing is uploaded.
 * Fragments are not encryption: anyone with the link can read it. Only display fields go in — no notes,
 * history, internal ids, timestamps, settings or keys. The public catalogue id (src) is there so the recipient can
 * look a poster up when its URL is missing or dead.
 *
 * JSON (version 1): { "v": 1, "items": SharedItem[] }. Fields added later are optional, so older links still open
 * and older versions of the app ignore what they don't know.
 */
export const SHARE_VERSION = 1
export const SHARE_PATH = '/shared'
/** Longest payload we'll put in a link. Browsers cope with far more, but messaging apps and copy/paste get flaky. */
export const MAX_PAYLOAD_CHARS = 30_000
/** Decompressed size cap, so a hostile link can't inflate into something huge. */
const MAX_JSON_BYTES = 512 * 1024
const MAX_ITEMS = 2000
const MAX_TITLE = 500
const SRC = /^(kitsu|tvmaze|tmdb):[a-z0-9/]{1,24}$/
const MAX_COUNT = 100_000

export interface SharedProgress {
  numbering: Numbering
  season: number | null
  next: number | null
  /** Episodes in the current season (seasonal) — used for the progress bar. */
  seasonEpisodes: number | null
  totalSeasons: number | null
  totalEpisodes: number | null
}

export interface SharedItem {
  title: string
  type: MediaType
  status: WatchStatus
  year?: number
  rating?: number
  poster?: string
  /** "provider:id" of the catalogue entry, e.g. "tvmaze:2993". Only sent for titles that have artwork. */
  src?: string
  progress?: SharedProgress
}

export class ShareError extends Error {}

// ---------- Encode ----------

export function toSharedItem(t: Title): SharedItem {
  const p = t.progress
  return {
    title: t.title,
    type: t.mediaType,
    status: t.status,
    year: t.year ?? undefined,
    rating: t.rating ?? undefined,
    // Downloaded copies travel as the URL they came from; uploaded files have none and can't travel in a link.
    poster: publicPosterUrl(t.poster) ?? undefined,
    // No src for titles without artwork: the user may have removed it on purpose.
    src: t.poster && t.source && t.source.provider !== 'anilist' ? `${t.source.provider}:${t.source.id}` : undefined,
    progress:
      t.mediaType === 'movie' || !p
        ? undefined
        : {
            numbering: p.numbering,
            season: p.season,
            next: p.nextEpisode,
            seasonEpisodes: p.season != null ? (p.seasonEpisodeCounts[p.season] ?? null) : null,
            totalSeasons: p.totalSeasons,
            totalEpisodes: p.totalEpisodes,
          },
  }
}

const toBase64Url = (bytes: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const pipe = (bytes: Uint8Array, stream: CompressionStream | DecompressionStream) =>
  new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(bytes as Uint8Array<ArrayBuffer>)
      c.close()
    },
  })
    .pipeThrough(stream)
    .getReader()

const concat = (chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** Payload for the URL fragment. Throws ShareError when the link would be too long. */
export async function encodeShare(titles: Title[]): Promise<string> {
  const payload = { v: SHARE_VERSION, items: titles.map(toSharedItem) }
  const reader = pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'))
  const chunks: Uint8Array[] = []
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value)
  const encoded = toBase64Url(concat(chunks))
  if (encoded.length > MAX_PAYLOAD_CHARS) {
    const fit = Math.max(1, Math.floor((titles.length * MAX_PAYLOAD_CHARS) / encoded.length))
    throw new ShareError(`${titles.length} titles is too many for one link. Select about ${fit} or fewer and try again.`)
  }
  // Same checks a recipient runs, so we never hand out a link that won't open.
  validatePayload(payload)
  return encoded
}

export const shareUrl = (payload: string, origin = window.location.origin) => `${origin}${SHARE_PATH}#${payload}`

// ---------- Decode (untrusted input) ----------

const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const optInt = (v: unknown, min: number, max: number) => v === undefined || v === null || isInt(v, min, max)

function checkItem(it: unknown, i: number) {
  const bad = (what: string) => new ShareError(`Item ${i + 1} has ${what}.`)
  if (!isObj(it)) throw bad('an invalid format')
  if (!isStr(it.title) || !it.title.trim() || it.title.length > MAX_TITLE) throw bad('an invalid title')
  if (!MEDIA.includes(it.type as MediaType)) throw bad('an invalid media type')
  if (!STATUS.includes(it.status as WatchStatus)) throw bad('an invalid status')
  if (!optInt(it.year, 1800, 3000)) throw bad('an invalid year')
  if (it.rating !== undefined && !(typeof it.rating === 'number' && it.rating >= 0 && it.rating <= 10)) throw bad('an invalid rating')
  if (it.poster !== undefined && !(isStr(it.poster) && it.poster.length <= MAX_POSTER_URL && isHttpUrl(it.poster))) throw bad('an invalid poster URL')
  if (it.src !== undefined && !(isStr(it.src) && SRC.test(it.src))) throw bad('an invalid source')
  if (it.progress !== undefined) {
    const p = it.progress
    if (!isObj(p) || (p.numbering !== 'seasonal' && p.numbering !== 'absolute')) throw bad('invalid progress')
    for (const k of ['season', 'next', 'seasonEpisodes', 'totalSeasons', 'totalEpisodes'] as const)
      if (!optInt(p[k], 1, MAX_COUNT)) throw bad('invalid progress')
  }
}

function validatePayload(raw: unknown): SharedItem[] {
  if (!isObj(raw) || typeof raw.v !== 'number') throw new ShareError('The link does not contain a WatchTrack watchlist.')
  if (raw.v > SHARE_VERSION) throw new ShareError('This link was made by a newer version of WatchTrack. Reload the page to update, then open the link again.')
  if (raw.v !== SHARE_VERSION) throw new ShareError('The link does not contain a WatchTrack watchlist.')
  if (!Array.isArray(raw.items)) throw new ShareError('The link is missing its list of titles.')
  if (raw.items.length > MAX_ITEMS) throw new ShareError('The link contains too many titles.')
  raw.items.forEach(checkItem)
  return raw.items as SharedItem[]
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const reader = pipe(bytes, new DecompressionStream('deflate-raw'))
  const chunks: Uint8Array[] = []
  let size = 0
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.length
    if (size > MAX_JSON_BYTES) {
      void reader.cancel()
      throw new ShareError('The shared list is too large to open.')
    }
    chunks.push(r.value)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(concat(chunks))
}

/** Decode a fragment (with or without the leading #). Throws ShareError with a readable message on any problem. */
export async function decodeShare(fragment: string): Promise<SharedItem[]> {
  const s = fragment.replace(/^#/, '').trim()
  if (!s) throw new ShareError('This link has no watchlist attached.')
  if (s.length > MAX_PAYLOAD_CHARS || !/^[A-Za-z0-9_-]+$/.test(s)) throw new ShareError('The link is damaged or incomplete.')
  let json: string
  try {
    json = await inflate(fromBase64Url(s))
  } catch (err) {
    if (err instanceof ShareError) throw err
    throw new ShareError('The link is damaged or incomplete.')
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ShareError('The link is damaged or incomplete.')
  }
  return validatePayload(raw)
}

const SOURCE_PAGE: Record<Exclude<MetadataSource['provider'], 'anilist'>, (id: string) => string> = {
  kitsu: (id) => `https://kitsu.app/anime/${id}`,
  tvmaze: (id) => `https://www.tvmaze.com/shows/${id}`,
  tmdb: (id) => `https://www.themoviedb.org/${id}`,
}

function sourceOf(src: string | undefined): MetadataSource | null {
  if (!src) return null
  const [provider, id] = src.split(/:(.*)/) as [keyof typeof SOURCE_PAGE, string]
  return { provider, id, url: SOURCE_PAGE[provider](id) }
}

/** A display-only Title, so the shared view can reuse the app's progress helpers and components. Never saved. */
export function sharedToTitle(it: SharedItem): Title {
  const p = it.progress
  const source = sourceOf(it.src)
  return createTitle({
    title: it.title,
    mediaType: it.type,
    status: it.status,
    year: it.year ?? null,
    rating: it.rating ?? null,
    // src without a URL means the creator had artwork we couldn't link to: an empty URL lets <Poster> look it up by source.
    poster: it.poster || source ? { kind: 'remote', url: it.poster ?? '' } : null,
    source,
    progress: p && {
      numbering: p.numbering,
      season: p.numbering === 'seasonal' ? (p.season ?? null) : null,
      nextEpisode: p.next ?? null,
      seasonEpisodeCounts: p.season != null && p.seasonEpisodes != null ? { [p.season]: p.seasonEpisodes } : {},
      totalSeasons: p.totalSeasons ?? null,
      totalEpisodes: p.totalEpisodes ?? null,
      skipped: [],
      rewatching: false,
    },
  })
}
