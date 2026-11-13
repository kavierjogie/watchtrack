import { NUMERIC_ID, PROVIDER_LABEL, request, stripHtml, tmdb, type Provider } from './metadata'
import { lastWatched, type EpisodeRef } from './progress'
import { daysSince } from './format'
import { lastActivity } from './titles'
import type { Title } from './types'

/**
 * "Previously on": the summary of the last episode you watched, for a show you haven't touched in a while, so you can
 * pick it up again without rewatching an episode to remember where you were. Only ever the episode you've already seen,
 * never a later one, so it can't spoil anything. Only public provider ids and episode numbers are sent.
 */

/** A show needs this long without activity before its card offers a recap. */
export const RECAP_AFTER_DAYS = 21
/** Episode summaries don't change, so a fetched one (or "none available") is kept this long. */
const TTL = 30 * 86_400_000
const MAX_ENTRIES = 60
const STORE_KEY = 'watchtrack:recaps'
/** Longest summary kept: a recap is a reminder, not the episode. */
const MAX_SUMMARY = 600

export interface Recap {
  episode: EpisodeRef
  name: string | null
  summary: string
  provider: Provider
}

type Lookup = { provider: Provider; id: string; season: number | null; episode: number; absolute: boolean }

/** What to look up for this title, or null when it has no recap to offer (not idle, nothing watched, provider can't). */
export function recapLookup(t: Title, now = Date.now()): (Lookup & { ref: EpisodeRef }) | null {
  const p = t.progress
  const s = t.source
  if (!p || !s || t.mediaType === 'movie' || daysSince(lastActivity(t), now) < RECAP_AFTER_DAYS) return null
  const ref = lastWatched(p)
  if (!ref) return null
  const absolute = p.numbering === 'absolute'
  const season = absolute ? null : ref.season
  if (s.provider === 'tvmaze' && NUMERIC_ID.test(s.id) && (absolute || season != null)) return { provider: 'tvmaze', id: s.id, season, episode: ref.episode, absolute, ref }
  // Kitsu lists each season as its own entry, numbered from 1, so the episode number alone is right.
  if (s.provider === 'kitsu' && NUMERIC_ID.test(s.id)) return { provider: 'kitsu', id: s.id, season, episode: ref.episode, absolute, ref }
  // TMDB numbers by season; there's no reliable way to map an overall episode number to one.
  const tv = /^tv\/(\d{1,10})$/.exec(s.id)
  if (s.provider === 'tmdb' && tv && !absolute && season != null) return { provider: 'tmdb', id: tv[1], season, episode: ref.episode, absolute, ref }
  return null
}

const cacheKey = (l: Lookup) => `${l.provider}:${l.id}:${l.absolute ? 'a' : l.season}:${l.episode}`

type Entry = { at: number; data: { name: string | null; summary: string } | null }

function readStore(): Record<string, Entry> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Entry>) : {}
  } catch {
    return {}
  }
}

function writeStore(key: string, entry: Entry, now: number) {
  try {
    const live = Object.entries(readStore()).filter(([k, e]) => k !== key && now - (e?.at ?? 0) < TTL)
    const kept = live.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES - 1)
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries([...kept, [key, entry]])))
  } catch {
    // Storage full or blocked: it's fetched again next time.
  }
}

const clean = (name: unknown, summary: unknown): Entry['data'] => {
  const text = stripHtml(typeof summary === 'string' ? summary : '')
  if (!text) return null
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    summary: text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, '')}…` : text,
  }
}

/** A provider's 404 means it doesn't list that episode: "no recap", cached. Anything else is a failure to retry. */
const missing = (err: unknown) => {
  if (err instanceof Error && err.message.includes('(404)')) return null
  throw err
}

async function fetchSummary(l: Lookup, signal?: AbortSignal): Promise<Entry['data']> {
  if (l.provider === 'tvmaze') {
    type Ep = { name?: string; summary?: string | null; season?: number; number?: number | null; type?: string }
    if (!l.absolute) {
      const e = await request<Ep>(`https://api.tvmaze.com/shows/${l.id}/episodebynumber?season=${l.season}&number=${l.episode}`, { signal }, 'tvmaze').catch(missing)
      return e ? clean(e.name, e.summary) : null
    }
    // Overall numbering: the Nth regular episode in airing order, as progress counts them.
    const list = await request<Ep[]>(`https://api.tvmaze.com/shows/${l.id}/episodes`, { signal }, 'tvmaze')
    const regular = (Array.isArray(list) ? list : []).filter((e) => Number.isInteger(e?.number) && (e.number ?? 0) > 0 && (e.season ?? 0) > 0 && !e.type?.includes('special'))
    const e = regular[l.episode - 1]
    return e ? clean(e.name, e.summary) : null
  }
  if (l.provider === 'kitsu') {
    type Res = { data?: { attributes?: { canonicalTitle?: string; synopsis?: string | null; description?: string | null; number?: number } }[] }
    const res = await request<Res>(
      `https://kitsu.app/api/edge/anime/${l.id}/episodes?filter[number]=${l.episode}&fields[episodes]=canonicalTitle,synopsis,description,number`,
      { signal },
      'kitsu',
    )
    const a = (Array.isArray(res?.data) ? res.data : []).find((d) => d?.attributes?.number === l.episode)?.attributes
    return a ? clean(a.canonicalTitle, a.synopsis || a.description) : null
  }
  const e = await tmdb<{ name?: string; overview?: string }>(`tv/${l.id}/season/${l.season}/episode/${l.episode}`, { signal }).catch(missing)
  return e ? clean(e.name, e.overview) : null
}

const inFlight = new Map<string, Promise<Recap | null>>()

/**
 * The recap for a title, from this device's cache when it has one. Resolves null when the provider has no summary for
 * that episode (also cached, so it isn't asked again). Rejects only when the provider couldn't be reached.
 */
export function getRecap(t: Title, signal?: AbortSignal, now = Date.now()): Promise<Recap | null> {
  const l = recapLookup(t, now)
  if (!l) return Promise.resolve(null)
  const key = cacheKey(l)
  const toRecap = (d: Entry['data']): Recap | null => d && { episode: l.ref, provider: l.provider, ...d }
  const hit = readStore()[key]
  if (hit && now - hit.at < TTL) return Promise.resolve(toRecap(hit.data))
  const running = inFlight.get(key)
  if (running) return running
  const job = fetchSummary(l, signal)
    .then((data) => {
      writeStore(key, { at: now, data }, now)
      return toRecap(data)
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

export const recapCredit = (r: Recap) => `Summary from ${PROVIDER_LABEL[r.provider]}`
