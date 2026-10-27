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
import { fetchMazeEpisodes, kitsuOngoing, MetadataError, request, SOURCE_ID, tmdb, type KitsuAnime } from './metadata'
import { detectEvents, type AlertEvent } from './alerts'
import { position } from './progress'
import type { MetadataSource, Release, Sequel, SyncInfo, Title } from './types'

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
  /** AniList only (undefined = this provider can't say). */
  anilistId?: number | null
  sequel?: Sequel | null
  /** Future episodes / announced seasons. undefined = this answer can't say (keep what's stored). */
  upcoming?: Release[]
}

const nextOnly = (next: SyncInfo['nextAiring']): Release[] => (next ? [{ kind: 'episode', season: next.season, episode: next.episode, name: null, airdate: next.airdate }] : [])

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

const NUMERIC_ID = /^\d{1,10}$/

export function canRefresh(t: Title): t is Title & { source: MetadataSource } {
  const s = t.source
  // AniList isn't in SOURCE_ID (its posters aren't looked up any more), but its ids still refresh.
  if (s?.provider === 'anilist') return !!t.progress && NUMERIC_ID.test(s.id)
  if (!t.progress || !s || !SOURCE_ID[s.provider]?.test(s.id)) return false
  if (s.provider === 'tmdb') return s.id.startsWith('tv/')
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
  const nx = next ? { season: null, episode: null, airdate: next } : null
  return { ongoing, seasons: {}, aired: count, total: count, next: nx, upcoming: nextOnly(nx) }
}

async function fetchTvMaze(id: string, signal?: AbortSignal): Promise<EpisodeInfo> {
  const { ongoing, aired, next, upcoming } = await fetchMazeEpisodes(id, signal)
  const n = sum(aired)
  return { ongoing, seasons: aired, aired: n || null, total: !ongoing && n ? n : null, next, upcoming }
}

interface TmdbEp {
  season_number: number
  episode_number: number
  air_date?: string | null
  name?: string | null
}

async function fetchTmdb(id: string, signal?: AbortSignal): Promise<EpisodeInfo> {
  const d = await tmdb<{
    status?: string
    seasons?: { season_number: number; episode_count: number; air_date?: string | null }[]
    last_episode_to_air?: TmdbEp | null
    next_episode_to_air?: TmdbEp | null
  }>(id, { signal })
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
  const next = nx?.air_date ? { season: nx.season_number, episode: nx.episode_number, airdate: nx.air_date } : null
  // TMDB lists a season once it's announced; one past the last aired season that hasn't started is upcoming.
  const lastSeason = last?.season_number ?? 0
  const upcoming: Release[] = (Array.isArray(d?.seasons) ? d.seasons : [])
    .filter((s) => Number.isInteger(s.season_number) && s.season_number > lastSeason && !(s.air_date && Date.parse(s.air_date) <= Date.now()))
    .map((s) => ({ kind: 'season' as const, season: s.season_number, episode: null, name: null, airdate: /^\d{4}-\d{2}-\d{2}$/.test(s.air_date ?? '') ? s.air_date! : null }))
  if (next) upcoming.push({ ...nextOnly(next)[0], name: nx?.name || null })
  return { ongoing, seasons, aired: n || null, total: !ongoing && n ? n : null, next, upcoming }
}

// ---------- AniList (anime airing data) ----------

/** AniList currently allows 30 requests a minute, so its calls are spaced ~2 s apart whatever the worker pool does. */
const ANILIST_GAP_MS = 2100
let anilistSlot = 0
async function anilistTurn(signal?: AbortSignal) {
  const now = Date.now()
  const at = Math.max(now, anilistSlot)
  anilistSlot = at + ANILIST_GAP_MS
  if (at > now) await sleep(at - now, signal)
}

const ANILIST_QUERY = `query($id:Int){Media(id:$id,type:ANIME){status episodes nextAiringEpisode{episode airingAt}
relations{edges{relationType node{id type format status siteUrl title{english romaji} startDate{year month day}}}}}}`

interface AniNode {
  id: number
  type: string
  format: string | null
  status: string | null
  siteUrl: string
  title: { english: string | null; romaji: string | null }
  startDate: { year: number | null; month: number | null; day: number | null } | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const aniDate = (d: AniNode['startDate']) => (d?.year ? [d.year, d.month && pad(d.month), d.month && d.day && pad(d.day)].filter(Boolean).join('-') : null)

/** The next TV season, if AniList links one. Films, OVAs and spin-offs aren't "the next season". */
export function pickSequel(edges: { relationType: string; node: AniNode }[] | undefined): Sequel | null {
  const n = edges?.find((e) => e.relationType === 'SEQUEL' && e.node?.type === 'ANIME' && ['TV', 'TV_SHORT', 'ONA'].includes(e.node.format ?? '') && e.node.status !== 'CANCELLED')?.node
  const title = n && (n.title?.english || n.title?.romaji)
  return n && title && Number.isInteger(n.id) ? { anilistId: n.id, title, status: n.status ?? 'NOT_YET_RELEASED', startDate: aniDate(n.startDate), url: n.siteUrl } : null
}

type AniMedia = {
  status: string
  episodes: number | null
  nextAiringEpisode: { episode: number; airingAt: number } | null
  relations?: { edges: { relationType: string; node: AniNode }[] }
}

export async function fetchAnilist(id: number, signal?: AbortSignal): Promise<EpisodeInfo> {
  await anilistTurn(signal)
  const res = await request<{ data?: { Media?: AniMedia } }>(
    'https://graphql.anilist.co',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: ANILIST_QUERY, variables: { id } }), signal },
    'anilist',
  )
  const m = res?.data?.Media
  if (!m) throw new MetadataError('AniList sent an unexpected response.')
  const finished = m.status === 'FINISHED'
  const count = Number.isInteger(m.episodes) && m.episodes! > 0 ? m.episodes : null
  const nx = m.nextAiringEpisode
  const nextEp = nx && Number.isInteger(nx.episode) && Number.isFinite(nx.airingAt) ? nx : null
  const next = nextEp && { season: null, episode: nextEp.episode, airdate: new Date(nextEp.airingAt * 1000).toISOString() }
  return {
    ongoing: !finished && m.status !== 'CANCELLED',
    seasons: {},
    // While airing, everything before the next scheduled episode has aired: AniList's own schedule, not a guess.
    aired: nextEp ? nextEp.episode - 1 || null : finished ? count : null,
    total: finished ? count : null,
    next,
    anilistId: id,
    sequel: pickSequel(m.relations?.edges),
    // The next season is a separate AniList entry, kept in `sequel`, not here.
    upcoming: nextOnly(next),
  }
}

/** Kitsu's own cross-reference to AniList (no name matching). null when it has none. */
async function kitsuAnilistId(kitsuId: string, signal?: AbortSignal): Promise<number | null> {
  const res = await request<{ data?: { attributes?: { externalSite?: string; externalId?: string } }[] }>(
    `https://kitsu.app/api/edge/anime/${kitsuId}/mappings?fields[mappings]=externalSite,externalId`,
    { headers: { Accept: 'application/vnd.api+json' }, signal },
    'kitsu',
  )
  const id = res?.data?.find?.((m) => m.attributes?.externalSite === 'anilist/anime')?.attributes?.externalId
  return id && NUMERIC_ID.test(id) ? Number(id) : null
}

/** Kitsu anime refresh from AniList's airing schedule when Kitsu maps it there; Kitsu alone otherwise. */
async function fetchKitsuAnime(t: Title, id: string, signal?: AbortSignal): Promise<EpisodeInfo> {
  const anilistId = t.sync?.anilistId !== undefined ? t.sync.anilistId : await kitsuAnilistId(id, signal)
  if (anilistId) {
    try {
      return await fetchAnilist(anilistId, signal)
    } catch (err) {
      // Down or rate-limited: try again later. A wrong or removed entry: Kitsu's own data is still better than nothing.
      if (!(err instanceof MetadataError) || err.retryable) throw err
    }
  }
  return { ...(await fetchKitsu(id, signal)), anilistId }
}

export function fetchEpisodeInfo(t: Title & { source: MetadataSource }, signal?: AbortSignal): Promise<EpisodeInfo> {
  const { provider, id } = t.source
  if (provider === 'tvmaze') return fetchTvMaze(id, signal)
  if (provider === 'kitsu') return fetchKitsuAnime(t, id, signal)
  if (provider === 'anilist') return fetchAnilist(Number(id), signal)
  return fetchTmdb(id, signal)
}

// ---------- Merge (pure) ----------

/**
 * Fold provider info into a stored title. Only provider-owned fields change: season episode counts, total
 * seasons/episodes and `sync`. Counts only grow. `changed` = new episodes or seasons are now known (worth telling
 * the user); filling in counts for the first time, or a new next-airing date, doesn't count.
 */
export function mergeEpisodeInfo(t: Title, info: EpisodeInfo, now: string): { title: Title; changed: boolean; newSeason: Sequel | null } {
  const p = t.progress
  if (!p) return { title: t, changed: false, newSeason: null }
  let changed = false
  let progress = p
  let next = info.next
  let upcoming = info.upcoming ?? t.sync?.upcoming

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
    if (info.upcoming)
      upcoming = info.upcoming.map((r) => (r.kind === 'episode' && r.season != null && r.episode != null ? { ...r, season: null, episode: sum(info.seasons, r.season) + r.episode } : r))
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

  // A sequel is news once it's actually out (announcements aren't), and only on later refreshes: the first one just
  // learns what already exists. A sequel already seen out isn't announced again.
  const sequel = info.sequel !== undefined ? info.sequel : t.sync?.sequel
  const prev = t.sync?.sequel
  const isOut = (s: Sequel | null | undefined): s is Sequel => !!s && s.status !== 'NOT_YET_RELEASED'
  const newSeason = t.sync && isOut(sequel) && !(prev?.anilistId === sequel.anilistId && isOut(prev)) ? sequel : null

  const sync: SyncInfo = {
    checkedAt: now,
    changedAt: changed || newSeason ? now : (t.sync?.changedAt ?? null),
    ongoing: info.ongoing,
    aired: info.aired,
    nextAiring: next,
    anilistId: info.anilistId !== undefined ? info.anilistId : t.sync?.anilistId,
    sequel,
    upcoming,
  }
  // updatedAt is left alone: a metadata refresh isn't user activity and mustn't reorder "recently updated" lists.
  return { title: { ...t, progress, sync }, changed, newSeason }
}

// ---------- Refresh lifecycle ----------

/** Successful refreshes carry the alert events found by comparing the stored title before and after (see alerts.ts). */
export type RefreshResult =
  | { status: 'updated'; title: Title; newSeason: Sequel | null; events: AlertEvent[] }
  | { status: 'unchanged'; title: Title; events: AlertEvent[] }
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
      const info = await withRetry(() => fetchEpisodeInfo(t, signal), signal)
      const now = new Date().toISOString()
      let changed = false
      let newSeason: Sequel | null = null
      let events: AlertEvent[] = []
      const saved = await patch(t.id, (current) => {
        const r = mergeEpisodeInfo(current, info, now)
        ;({ changed, newSeason } = r)
        // Diffed against the stored record inside the same write, so two tabs can't both report the same change.
        events = detectEvents(current, r.title, now)
        return r.title
      })
      if (!saved) return { status: 'skipped', title: t } // deleted while we were fetching
      failedAt.delete(t.id)
      return changed || newSeason ? { status: 'updated', title: saved, newSeason, events } : { status: 'unchanged', title: saved, events }
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
  if (Number.isNaN(last) || now - last >= refreshEvery(t)) return true
  // A known release date has passed since the last check: ask the provider whether it's actually out.
  const due = nextReleaseAt(t)
  return due != null && due <= now && last < due
}

/** Earliest dated release the provider gave for this title, as a timestamp. */
export function nextReleaseAt(t: Title): number | null {
  const dates = [t.sync?.nextAiring?.airdate, ...(t.sync?.upcoming ?? []).map((r) => r.airdate)].map((d) => Date.parse(d ?? '')).filter((n) => !Number.isNaN(n))
  return dates.length ? Math.min(...dates) : null
}

/** Lower runs first: paused or caught-up shows waiting on news, then the rest, then dropped ones. */
function priority(t: Title): number {
  if (t.status === 'dropped') return 2
  const state = t.progress && position(t.progress).state
  if (t.status === 'on_hold' || t.status === 'watching' || state === 'season-finished' || state === 'series-finished' || nextReleaseAt(t) != null) return 0
  return 1
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
    .sort((a, b) => priority(a) - priority(b) || checked(a) - checked(b))
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
