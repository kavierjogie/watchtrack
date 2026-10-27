/**
 * Episode/season refresh for titles already in the library.
 *
 * Provider data only ever *adds* to what's stored: episode counts and totals grow, they never shrink, and the
 * watch position (season + next episode), status, rating, notes and everything else the user owns are never touched.
 * A failed, empty or partial answer therefore can't erase anything. Both the automatic refresh (on open / return
 * to the app) and the manual "Refresh episodes" button go through refreshTitle → mergeEpisodeInfo.
 *
 * Browsers can't run this while the app is closed; it catches up the next time it's opened.
 */
import { useSyncExternalStore } from 'react'
import { fetchMazeEpisodes, kitsuOngoing, MetadataError, request, SOURCE_ID, tmdbInit, type KitsuAnime } from './metadata'
import { getPrefs } from './prefs'
import type { MetadataSource, SyncInfo, Title } from './types'

/** What a provider says has aired. Seasonal providers fill `seasons`; Kitsu has no seasons, only an overall count. */
export interface EpisodeInfo {
  ongoing: boolean
  /** Highest aired episode number per season. */
  seasons: Record<number, number>
  /** Episodes aired overall. null = unknown. */
  aired: number | null
  /** Final episode count, only once the provider says the series has ended. */
  total: number | null
  next: SyncInfo['nextAiring']
}

const sum = (counts: Record<number, number>, below = Infinity) =>
  Object.entries(counts).reduce((n, [s, c]) => (Number(s) < below ? n + c : n), 0)

const DAY = 86400000
/** Ended shows are only checked weekly (revivals are rare); running ones daily. */
const refreshEvery = (t: Title) => (t.sync && !t.sync.ongoing ? 7 * DAY : DAY)
/** After a failure, don't retry that title automatically for an hour. In memory: a reload may try again sooner. */
const FAILURE_BACKOFF = 3600000
const CONCURRENCY = 2
/** Per-worker pause between requests: 2 workers ≈ 2 req/s, under TVmaze's 20 per 10 s. */
const PACE_MS = 1000
/** Automatic cycles refresh the stalest titles first, a batch at a time, so big libraries catch up over a few opens. */
const AUTO_BATCH = 25
const AUTO_MIN_GAP = 15 * 60000

// ---------- Providers ----------

export function canRefresh(t: Title): t is Title & { source: MetadataSource } {
  const s = t.source
  if (!t.progress || !s || !SOURCE_ID[s.provider]?.test(s.id)) return false
  if (s.provider === 'tmdb') return s.id.startsWith('tv/') && !!getPrefs().tmdbKey
  return s.provider === 'tvmaze' || s.provider === 'kitsu'
}

async function fetchKitsu(id: string, signal?: AbortSignal): Promise<EpisodeInfo> {
  // Kitsu's per-episode airdates are sparse and often stale, so only the anime record is trusted:
  // episodeCount once it's finished (while airing it's the *planned* count) and nextRelease as the next date.
  const res = await request<{ data: KitsuAnime & { attributes: { nextRelease?: string | null } } }>(
    `https://kitsu.app/api/edge/anime/${id}?fields[anime]=status,episodeCount,nextRelease`,
    { headers: { Accept: 'application/vnd.api+json' }, signal },
    'kitsu',
  )
  const a = res?.data?.attributes
  if (!a) throw new MetadataError('Kitsu sent an unexpected response.', true)
  const ongoing = kitsuOngoing(a.status)
  const count = !ongoing && a.status === 'finished' && Number.isInteger(a.episodeCount) && a.episodeCount! > 0 ? a.episodeCount : null
  const next = typeof a.nextRelease === 'string' && !Number.isNaN(Date.parse(a.nextRelease)) ? a.nextRelease : null
  return { ongoing, seasons: {}, aired: count, total: count, next: next ? { season: null, episode: null, airdate: next } : null }
}

async function fetchTvMaze(id: string, signal?: AbortSignal): Promise<EpisodeInfo> {
  const { ongoing, aired, next } = await fetchMazeEpisodes(id, signal)
  const n = sum(aired)
  return { ongoing, seasons: aired, aired: n || null, total: !ongoing && n ? n : null, next }
}

interface TmdbEp {
  season_number: number
  episode_number: number
  air_date?: string | null
}

async function fetchTmdb(id: string, signal?: AbortSignal): Promise<EpisodeInfo> {
  const { query, init } = tmdbInit(getPrefs().tmdbKey)
  const d = await request<{ status?: string; seasons?: { season_number: number; episode_count: number }[]; last_episode_to_air?: TmdbEp | null; next_episode_to_air?: TmdbEp | null }>(
    `https://api.themoviedb.org/3/${id}?${query.slice(1)}`,
    { ...init, signal },
    'tmdb',
  )
  const last = d?.last_episode_to_air
  const seasons: Record<number, number> = {}
  // TMDB's episode_count includes announced episodes, so the current season stops at the last one that aired.
  if (last && Number.isInteger(last.season_number) && Number.isInteger(last.episode_number))
    for (const s of d.seasons ?? []) {
      if (s.season_number > 0 && s.season_number < last.season_number && s.episode_count > 0) seasons[s.season_number] = s.episode_count
      if (s.season_number === last.season_number && last.episode_number > 0) seasons[s.season_number] = last.episode_number
    }
  const ongoing = d?.status !== 'Ended' && d?.status !== 'Canceled'
  const n = sum(seasons)
  const nx = d?.next_episode_to_air
  return {
    ongoing,
    seasons,
    aired: n || null,
    total: !ongoing && n ? n : null,
    next: nx?.air_date ? { season: nx.season_number, episode: nx.episode_number, airdate: nx.air_date } : null,
  }
}

export function fetchEpisodeInfo(source: MetadataSource, signal?: AbortSignal): Promise<EpisodeInfo> {
  if (source.provider === 'tvmaze') return fetchTvMaze(source.id, signal)
  if (source.provider === 'kitsu') return fetchKitsu(source.id, signal)
  return fetchTmdb(source.id, signal)
}

// ---------- Merge (pure) ----------

/**
 * Fold provider info into a stored title. Only provider-owned fields change: season episode counts, total
 * seasons/episodes and `sync`. Counts only grow. `changed` = new episodes or seasons are now known (worth telling
 * the user); filling in counts for the first time, or a new next-airing date, doesn't count.
 */
export function mergeEpisodeInfo(t: Title, info: EpisodeInfo, now: string): { title: Title; changed: boolean } {
  const p = t.progress
  if (!p) return { title: t, changed: false }
  let changed = false
  let progress = p
  let next = info.next

  if (p.numbering === 'seasonal') {
    const counts = { ...p.seasonEpisodeCounts }
    const hadCounts = Object.keys(counts).length > 0
    let maxSeason = 0
    for (const [k, n] of Object.entries(info.seasons)) {
      const s = Number(k)
      if (!Number.isInteger(s) || s < 1 || !Number.isInteger(n) || n < 1) continue
      maxSeason = Math.max(maxSeason, s)
      if (n > (counts[s] ?? 0)) {
        counts[s] = n
        changed ||= hadCounts
      }
    }
    let totalSeasons = p.totalSeasons
    // A season past the stored total: the show came back. Unknown end again while it's running.
    if (totalSeasons != null && maxSeason > totalSeasons) {
      totalSeasons = info.ongoing ? null : maxSeason
      changed = true
    } else if (totalSeasons == null && !info.ongoing && maxSeason > 0) totalSeasons = maxSeason
    progress = { ...p, seasonEpisodeCounts: counts, totalSeasons }
  } else {
    // Absolute numbering: never invent seasons. A seasonal provider's next episode becomes its overall number.
    if (next?.season != null && next.episode != null) next = { season: null, episode: sum(info.seasons, next.season) + next.episode, airdate: next.airdate }
    let total = p.totalEpisodes
    if (info.total != null && !info.ongoing && (total == null || info.total > total)) {
      changed ||= total != null
      total = info.total
    } else if (total != null && info.aired != null && info.aired > total) {
      total = info.ongoing ? null : info.aired
      changed = true
    }
    const before = t.sync?.aired
    if (before != null && info.aired != null && info.aired > before) changed = true
    progress = { ...p, totalEpisodes: total }
  }

  const sync: SyncInfo = { checkedAt: now, changedAt: changed ? now : (t.sync?.changedAt ?? null), ongoing: info.ongoing, aired: info.aired, nextAiring: next }
  // updatedAt is left alone: a metadata refresh isn't user activity and mustn't reorder "recently updated" lists.
  return { title: { ...t, progress, sync }, changed }
}

// ---------- Refresh lifecycle ----------

export type RefreshResult =
  | { status: 'updated' | 'unchanged'; title: Title }
  | { status: 'failed'; title: Title; error: string }
  | { status: 'skipped'; title: Title }

/** Persist with a read-modify-write on the *current* stored title (library.patch / db.updateTitle). */
export type Patch = (id: string, fn: (t: Title) => Title | null) => Promise<Title | undefined>

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true })
  })

/** Up to 3 tries for rate limits, timeouts and server errors; honours Retry-After when the provider sends it. */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (signal?.aborted || attempt >= 3 || !(err instanceof MetadataError && err.retryable)) throw err
      await sleep(Math.min(30, err.retryAfter ?? 2 ** attempt * 2) * 1000, signal)
    }
  }
}

const inflight = new Map<string, Promise<RefreshResult>>()
const failedAt = new Map<string, number>()
let cycle: Promise<RefreshResult[]> | null = null
let lastAutoRun = 0

// Tiny store so buttons can show a spinner for titles being refreshed by either path.
type Snapshot = { ids: ReadonlySet<string>; cycle: boolean }
let snap: Snapshot = { ids: new Set(), cycle: false }
const listeners = new Set<() => void>()
const emit = () => {
  snap = { ids: new Set(inflight.keys()), cycle: cycle != null }
  listeners.forEach((l) => l())
}

export function useSyncState(): Snapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snap,
    () => snap,
  )
}

/** Refresh one title. A second call while it's running gets the same promise, so it's never fetched twice at once. */
export function refreshTitle(t: Title, patch: Patch, signal?: AbortSignal): Promise<RefreshResult> {
  const running = inflight.get(t.id)
  if (running) return running
  const job = (async (): Promise<RefreshResult> => {
    if (!canRefresh(t)) return { status: 'skipped', title: t }
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new MetadataError("You're offline.")
      const info = await withRetry(() => fetchEpisodeInfo(t.source, signal), signal)
      let changed = false
      const now = new Date().toISOString()
      const saved = await patch(t.id, (current) => {
        const r = mergeEpisodeInfo(current, info, now)
        changed = r.changed
        return r.title
      })
      if (!saved) return { status: 'skipped', title: t } // deleted while we were fetching
      failedAt.delete(t.id)
      return { status: changed ? 'updated' : 'unchanged', title: saved }
    } catch (err) {
      failedAt.set(t.id, Date.now())
      return { status: 'failed', title: t, error: err instanceof Error ? err.message : 'Refresh failed.' }
    }
  })().finally(() => {
    inflight.delete(t.id)
    emit()
  })
  inflight.set(t.id, job)
  emit()
  return job
}

export function isDue(t: Title, now = Date.now()): boolean {
  if (!canRefresh(t)) return false
  if (now - (failedAt.get(t.id) ?? 0) < FAILURE_BACKOFF) return false
  const last = t.sync ? Date.parse(t.sync.checkedAt) : NaN
  return Number.isNaN(last) || now - last >= refreshEvery(t)
}

/**
 * Refresh several titles with a small worker pool. `force` = every refreshable title (manual "check all"),
 * otherwise only the stalest due batch. One failing title never stops the rest. A call while a cycle is
 * running joins it instead of starting another.
 */
export function syncLibrary(titles: Title[], patch: Patch, { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {}): Promise<RefreshResult[]> {
  if (cycle) return cycle
  const now = Date.now()
  const checked = (t: Title) => (t.sync ? Date.parse(t.sync.checkedAt) || 0 : 0)
  const queue = titles
    .filter((t) => (force ? canRefresh(t) : isDue(t, now)))
    .sort((a, b) => checked(a) - checked(b))
    .slice(0, force ? undefined : AUTO_BATCH)
  const results: RefreshResult[] = []
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      results.push(await refreshTitle(queue.shift()!, patch, signal))
      if (queue.length) await sleep(PACE_MS, signal).catch(() => {})
    }
  }
  cycle = Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    .then(() => results)
    .finally(() => {
      cycle = null
      emit()
    })
  emit()
  return cycle
}

/** Automatic runs (app opened / brought back) at most every 15 minutes, and only when online. */
export function autoSyncAllowed(now = Date.now()): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (now - lastAutoRun < AUTO_MIN_GAP) return false
  lastAutoRun = now
  return true
}
