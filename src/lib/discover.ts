/**
 * Data for the Discover page: candidate titles from the providers the app already uses, cached on this device,
 * plus the user's recommendation feedback. Only public catalogue requests are made — nothing about the library is sent
 * beyond the provider ids of a few titles (to ask for their related titles) and genre names.
 *
 * What each provider can give (checked against the live APIs):
 *  - Kitsu: popular / top-rated lists, lists by category, and media relationships (sequel, side story…) per anime.
 *  - TVmaze: no "similar" or genre-filter endpoint. Its paged show index (250 shows a page, genres, rating, popularity
 *    weight) is the discovery pool; similarity is genre overlap. Rate limit: 20 requests / 10 s.
 *  - TMDB (via the /api/tmdb proxy): trending, discover-by-genre and real per-title recommendations.
 */
import { useSyncExternalStore } from 'react'
import { isObj, normTitle } from './backup'
import { dayFrom } from './format'
import { enrich, kitsuToResult, mazeToResult, MetadataError, NUMERIC_ID, request, searchTitles, tmdb, tmdbToResult, type KitsuAnime, type MazeShow, type Provider, type TmdbItem } from './metadata'
import { savePoster } from './posters'
import { emptyProgress } from './progress'
import { buildProfile, candidateKey, emptyFeedback, ROLE_STRENGTH, tasteGenres, titleWeight, type Candidate, type Feedback, type FeedbackItem, type Link, type SortKey } from './recommend'
import { createTitle, lastActivity } from './titles'
import type { MediaType, MetadataSource, Progress, Title } from './types'

const HOUR = 3_600_000
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// ---------- Cache ----------

const CACHE_PREFIX = 'watchtrack:meta:'
const CACHE_MAX_AGE = 14 * 24 * HOUR
const inFlight = new Map<string, Promise<unknown>>()

/**
 * Fetch once per `ttl`: localStorage holds the mapped results, memory dedupes concurrent and repeat calls in a session.
 * When a refetch fails (offline, rate-limited, provider down) the stale copy is used rather than nothing.
 */
export function cached<T>(key: string, ttl: number, fetcher: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = inFlight.get(key)
  if (hit) return hit as Promise<T>
  const p = (async () => {
    const stale = readCache<T>(key)
    if (stale && now - stale.at < ttl) return stale.data
    try {
      const data = await fetcher()
      try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: now, data }))
      } catch {
        // Storage full or blocked: still works, it just refetches next visit.
      }
      return data
    } catch (err) {
      if (stale) return stale.data
      throw err
    }
  })()
  inFlight.set(key, p)
  p.catch(() => inFlight.delete(key)) // a failure is retried next time, not remembered
  return p
}

function readCache<T>(key: string): { at: number; data: T } | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_PREFIX + key) ?? 'null') as { at: number; data: T } | null
  } catch {
    return null // unreadable or storage blocked: a miss
  }
}

/** Remove this cache's entries that match. Backwards, since removing shifts later keys down. */
function removeCached(drop: (key: string) => boolean) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(CACHE_PREFIX) && drop(k)) localStorage.removeItem(k)
    }
  } catch {
    // Storage blocked: nothing to remove.
  }
}

/** Drop entries nobody has refreshed in two weeks. */
export function pruneCache(now = Date.now()) {
  removeCached((k) => {
    try {
      return now - ((JSON.parse(localStorage.getItem(k) ?? '{}') as { at?: number }).at ?? 0) > CACHE_MAX_AGE
    } catch {
      return true
    }
  })
}

function clearMetaCache() {
  inFlight.clear()
  removeCached(() => true)
}

// ---------- Kitsu ----------

const KITSU = 'https://kitsu.app/api/edge/'
const KITSU_INIT = { headers: { Accept: 'application/vnd.api+json' } }
/** Recaps, music videos and commercials aren't something to recommend. */
const KITSU_SUBTYPES = new Set(['TV', 'movie', 'ONA', 'OVA'])

function kitsuCandidate(a: KitsuAnime, categories?: Map<string, string>): Candidate {
  const rank = a.attributes.popularityRank
  return {
    ...kitsuToResult(a, categories),
    communityScore: a.attributes.averageRating ? Number(a.attributes.averageRating) || null : null,
    // Rank 1 → 1, 10 → 0.75, 100 → 0.5, 1000 → 0.25.
    popularity: rank ? clamp01(1 - Math.log10(rank) / 4) : null,
  }
}

type ListAnime = KitsuAnime & { relationships?: { mediaRelationships?: { data?: { id: string }[] } } }
type Included =
  | { type: 'categories'; id: string; attributes: { title: string } }
  | { type: 'mediaRelationships'; id: string; attributes: { role: string }; relationships: { destination: { data: { type: string; id: string } | null } } }
  | (KitsuAnime & { type: 'anime' })
/** Sparse fields keep the relationship include small (destinations come back with the same few attributes). */
const LIST_FIELDS =
  'fields[anime]=slug,canonicalTitle,titles,abbreviatedTitles,synopsis,startDate,subtype,status,episodeCount,averageRating,popularityRank,posterImage,coverImage,categories,mediaRelationships' +
  '&fields[categories]=title&fields[mediaRelationships]=role,destination&fields[manga]=startDate'

/**
 * A Kitsu list with each anime's earliest earlier-released prequel (see Candidate.earlier), so later seasons are told
 * apart from first entries by Kitsu's own relationship data rather than by their names.
 */
async function kitsuList(query: string): Promise<Candidate[]> {
  const res = await request<{ data: ListAnime[]; included?: Included[] }>(
    `${KITSU}anime?${query}&page[limit]=20&include=categories,mediaRelationships.destination&${LIST_FIELDS}`,
    KITSU_INIT,
    'kitsu',
  )
  const inc = res.included ?? []
  const categories = new Map(inc.flatMap((i) => (i.type === 'categories' ? [[i.id, i.attributes.title] as const] : [])))
  // JSON:API lists a resource once: a prequel on the same page is in `data`, not repeated in `included`.
  const anime = new Map<string, KitsuAnime>([...res.data, ...inc.flatMap((i) => (i.type === 'anime' ? [i] : []))].map((a) => [a.id, a]))
  const prequelOf = new Map(
    inc.flatMap((i) => (i.type === 'mediaRelationships' && i.attributes.role === 'prequel' && i.relationships.destination.data?.type === 'anime' ? [[i.id, i.relationships.destination.data.id] as const] : [])),
  )
  return res.data
    .filter((a) => KITSU_SUBTYPES.has(a.attributes.subtype ?? ''))
    .map((a) => {
      const rels = a.relationships?.mediaRelationships?.data
      const start = a.attributes.startDate
      const earlier = rels
        ?.map((r) => anime.get(prequelOf.get(r.id) ?? ''))
        .filter((p): p is KitsuAnime => !!p && KITSU_SUBTYPES.has(p.attributes.subtype ?? '') && !!start && !!p.attributes.startDate && p.attributes.startDate < start)
        .sort((x, y) => x.attributes.startDate!.localeCompare(y.attributes.startDate!))[0]
      return { ...kitsuCandidate(a, categories), earlier: rels ? (earlier ? kitsuCandidate(earlier) : null) : undefined }
    })
}

/** Kitsu's own relationships for one anime. Related titles come without categories (Kitsu can't nest that include). */
async function kitsuRelated(id: string): Promise<{ role: string; c: Candidate }[]> {
  const res = await request<{
    data: { attributes: { role: string }; relationships: { destination: { data: { type: string; id: string } | null } } }[]
    included?: (KitsuAnime & { type: string })[]
  }>(`${KITSU}anime/${id}/media-relationships?include=destination&page[limit]=20`, KITSU_INIT, 'kitsu')
  const anime = new Map(res.included?.filter((i) => i.type === 'anime').map((i) => [i.id, i]))
  return res.data.flatMap((r) => {
    const dest = r.relationships.destination.data
    const a = dest?.type === 'anime' ? anime.get(dest.id) : undefined
    return a && ROLE_STRENGTH[r.attributes.role] && KITSU_SUBTYPES.has(a.attributes.subtype ?? '') ? [{ role: r.attributes.role, c: kitsuCandidate(a) }] : []
  })
}

// ---------- TVmaze ----------

const mazeCandidate = (s: MazeShow): Candidate => ({
  ...mazeToResult(s),
  communityScore: s.rating?.average ? s.rating.average * 10 : null,
  // TVmaze weights bunch up near the top of 0–100: 60 → 0.2, 80 → 0.6, 100 → 1.
  popularity: clamp01(((s.weight ?? 0) - 50) / 50),
})

/** TVmaze allows about 20 requests per 10 s per IP: space this app's own requests so a first visit doesn't hit it. */
const MAZE_GAP_MS = 450
let mazeNext = 0
async function mazeRequest<T>(url: string): Promise<T> {
  const now = Date.now()
  const at = Math.max(now, mazeNext)
  mazeNext = at + MAZE_GAP_MS
  if (at > now) await new Promise((r) => setTimeout(r, at - now))
  return request<T>(url, {}, 'tvmaze')
}

/** One page of TVmaze's show index, trimmed to well-known scripted/animated shows with artwork. */
async function mazePage(n: number): Promise<Candidate[]> {
  const shows = await mazeRequest<MazeShow[]>(`https://api.tvmaze.com/shows?page=${n}`)
  return shows
    .filter((s) => (s.type === 'Scripted' || s.type === 'Animation') && s.genres?.length && (s.weight ?? 0) >= 60 && s.image)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, 120)
    .map(mazeCandidate)
}

/** A title on a release list, with the date that put it there (premiere, season premiere or first release). */
export interface Spot {
  c: Candidate
  date: string | null
  /** Season the date belongs to, when the provider numbers it (TVmaze premieres). */
  season: number | null
}

interface MazeEntry {
  season: number
  number: number | null
  airdate: string
  show?: MazeShow
  _embedded?: { show?: MazeShow }
}

/**
 * One day of TVmaze's schedule (`web` = streaming services worldwide, else US networks), cut down to what Discover
 * shows: well-followed scripted/animated shows that air that day, and the ones whose episode 1 (a series or season
 * premiere) airs that day. Only this small summary is cached, not the ~200 KB day.
 */
async function mazeDay(kind: 'web' | 'us', date: string): Promise<{ premieres: Spot[]; airing: Spot[] }> {
  const rows = await mazeRequest<MazeEntry[]>(kind === 'web' ? `https://api.tvmaze.com/schedule/web?date=${date}` : `https://api.tvmaze.com/schedule?country=US&date=${date}`)
  const premieres: Spot[] = []
  const airing = new Map<number, Spot>()
  for (const e of rows) {
    const s = e.show ?? e._embedded?.show
    if (!s || !s.image || (s.type !== 'Scripted' && s.type !== 'Animation')) continue
    const w = s.weight ?? 0
    if (e.number === 1 && w >= 70) premieres.push({ c: mazeCandidate(s), date: e.airdate || date, season: e.season ?? null })
    if (w >= 85 && s.genres?.length && !airing.has(s.id)) airing.set(s.id, { c: mazeCandidate(s), date: e.airdate || date, season: e.season ?? null })
  }
  return { premieres, airing: [...airing.values()] }
}

// ---------- TMDB (via the /api/tmdb proxy) ----------

/** TMDB's genre ids. Stable for years, so no request is spent fetching them. "Sci-Fi & Fantasy" splits into both. */
const TMDB_GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News',
  10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
}
const TMDB_MOVIE_GENRE_ID = new Map(Object.entries(TMDB_GENRES).filter(([id]) => Number(id) < 10759 || Number(id) === 10770).map(([id, g]) => [g.toLowerCase(), Number(id)]))
const TMDB_ID = /^(movie|tv)\/\d{1,10}$/

function tmdbCandidate(r: TmdbItem, kind: 'movie' | 'tv'): Candidate {
  const genres = (r.genre_ids ?? []).flatMap((id) => TMDB_GENRES[id]?.split(' & ') ?? [])
  const votes = r.vote_count ?? 0
  return {
    ...tmdbToResult(r, kind, genres),
    communityScore: votes >= 50 && r.vote_average ? r.vote_average * 10 : null,
    popularity: votes ? clamp01(Math.log10(votes) / 4.3) : null,
  }
}

/**
 * TMDB is optional: without a server key the proxy answers 503 (`vite dev` has no API routes at all). Once a list
 * request fails, TMDB is skipped for the rest of the visit and its absence isn't reported as an error.
 */
let tmdbOff = false

async function tmdbList(path: string, kind: 'movie' | 'tv'): Promise<Candidate[]> {
  if (tmdbOff) throw new MetadataError('TMDB is not set up on this server.')
  try {
    const data = await tmdb<{ results: TmdbItem[] }>(path)
    return data.results.filter((r) => !r.media_type || r.media_type === kind).map((r) => tmdbCandidate(r, kind))
  } catch (err) {
    // A list request failing means TMDB as a whole is unavailable (no key, no API route, or down): rows fall back to
    // Kitsu/TVmaze. One title's recommendations failing says nothing about the rest.
    if (!/\/\d+\//.test(path)) tmdbOff = true
    throw err
  }
}

// ---------- Requests, shared by Discover and "Similar titles" (same cache keys, so one never refetches the other's) ----------

/** Kitsu list cache keys carry a version: v2 added relationship data, so copies cached before it are refetched. */
const kitsuListTask = (cacheKey: string, ttl: number, query: string): Task => ({
  provider: 'kitsu',
  run: async () => ({ cands: await cached(`kitsu2:${cacheKey}`, ttl, () => kitsuList(query)) }),
})

const kitsuCategoryTask = (genre: string, page: number) => {
  const slug = genre.replace(/ /g, '-')
  return kitsuListTask(`cat:${slug}:${page}`, 24 * HOUR, `filter[categories]=${encodeURIComponent(slug)}&sort=popularityRank&page[offset]=${page * 20}`)
}

const kitsuRelatedTask = (seedId: string, id: string): Task => ({
  provider: 'kitsu',
  run: async () => {
    const rel = await cached(`kitsu:rel:${id}`, 7 * 24 * HOUR, () => kitsuRelated(id))
    return { cands: rel.map((r) => r.c), links: rel.map((r) => ({ key: candidateKey(r.c), seedId, role: r.role })) }
  },
})

const mazePageTask = (n: number): Task => ({ provider: 'tvmaze', run: async () => ({ cands: await cached(`tvmaze:page:${n}`, 3 * 24 * HOUR, () => mazePage(n)) }) })

const tmdbGenreTask = (genre: string, page: number): Task => ({
  provider: 'tmdb',
  run: async () => ({
    cands: await cached(`tmdb:genre:${genre}:${page}`, 24 * HOUR, () =>
      tmdbList(`discover/movie?sort_by=vote_count.desc&with_genres=${TMDB_MOVIE_GENRE_ID.get(genre)}&page=${page + 1}`, 'movie'),
    ),
  }),
})

const tmdbRecTask = (seedId: string, id: string): Task => ({
  provider: 'tmdb',
  run: async () => {
    const cands = await cached(`tmdb:rec:${id}`, 7 * 24 * HOUR, () => tmdbList(`${id}/recommendations`, id.startsWith('movie') ? 'movie' : 'tv'))
    return { cands, links: cands.map((c) => ({ key: candidateKey(c), seedId, role: 'tmdb-recommended' })) }
  },
})

// ---------- Filling in metadata for titles that have none ----------

/** Provider facts for a library title, found by exact name. Used in memory only; the saved title is never changed. */
export type Inferred = Record<string, { genres: string[]; source: MetadataSource }>

/** How many metadata-less titles to look up per visit (each lookup is cached for a month). */
const MAX_LOOKUPS = 12
const LOOKUP_PROVIDER: Partial<Record<MediaType, Provider>> = { anime: 'kitsu', tv: 'tvmaze' }

/**
 * Titles typed in by hand or imported from notes have no genres or provider id, so they'd say nothing about taste.
 * For the strongest of them, search the provider and accept only an exact name match of the same type.
 */
export async function inferMetadata(library: Title[]): Promise<Inferred> {
  const jobs = library
    .filter((t) => (!t.genres.length || !t.source) && titleWeight(t) > 0)
    .sort((a, b) => titleWeight(b) - titleWeight(a) || lastActivity(b).localeCompare(lastActivity(a)))
    .map((t) => ({ t, provider: LOOKUP_PROVIDER[t.mediaType] ?? 'tmdb' }))
    .slice(0, MAX_LOOKUPS)
  const out: Inferred = {}
  await runQueued(
    jobs.map(({ t, provider }) => ({
      provider,
      run: async () => {
        const name = normTitle(t.title)
        const hit = await cached(`match:${provider}:${t.mediaType}:${name}`, 30 * 24 * HOUR, async () => {
          const r = (await searchTitles(t.title, provider)).find((r) => r.mediaType === t.mediaType && [r.title, ...r.altTitles].some((n) => normTitle(n) === name))
          return r ? { genres: r.genres, source: r.source } : null
        })
        if (hit) out[t.id] = hit
      },
    })),
    () => {}, // a failed lookup just leaves that title as it is
  )
  return out
}

/** The library with looked-up genres/ids filled in where the user's own data has none. */
export const withInferred = (library: Title[], inferred: Inferred): Title[] =>
  library.map((t) => {
    const i = inferred[t.id]
    return i ? { ...t, genres: t.genres.length ? t.genres : i.genres, source: t.source ?? i.source } : t
  })

// ---------- Pool ----------

export interface PoolState {
  pool: Candidate[]
  links: Link[]
  /** Looked-up metadata for library titles that had none (see withInferred). */
  inferred: Inferred
  /** Requests still running. */
  pending: number
  /** Providers that failed and had nothing cached, with a readable message. */
  failed: { provider: Provider; message: string }[]
}

interface Task<T = { cands: Candidate[]; links?: Link[] }> {
  provider: Provider
  run: () => Promise<T>
}

/** Records one readable failure per provider. TMDB missing its server key isn't a failure: it's optional. */
const failureList = (failed: PoolState['failed']) => (provider: Provider, err: unknown) => {
  if (provider === 'tmdb' && tmdbOff) return
  if (!failed.some((f) => f.provider === provider)) failed.push({ provider, message: err instanceof Error ? err.message : 'Request failed.' })
}

/** Concurrent requests per provider and batch — Kitsu sits behind Cloudflare, which challenges bursts. */
const CONCURRENCY: Record<Provider, number> = { kitsu: 2, tvmaze: 2, tmdb: 3, anilist: 1 }

/** Run tasks with a small per-provider concurrency. Never rejects: failures go to onError. */
async function runQueued<T>(tasks: Task<T>[], onError: (provider: Provider, err: unknown) => void, onDone?: (i: number, value: T | null) => void) {
  const providers = [...new Set(tasks.map((t) => t.provider))]
  await Promise.all(
    providers.map(async (provider) => {
      const queue = tasks.map((t, i) => ({ ...t, i })).filter((t) => t.provider === provider)
      let next = 0
      const worker = async () => {
        while (next < queue.length) {
          const t = queue[next++]
          let value: T | null = null
          try {
            value = await t.run()
          } catch (err) {
            onError(provider, err)
          }
          onDone?.(t.i, value)
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY[provider] }, worker))
    }),
  )
}

/**
 * Gather candidates for the library. `round` (bumped by Refresh) moves list queries to their next page.
 * Calls onUpdate as each request lands so the page fills progressively. Never throws.
 */
export async function loadPool(library: Title[], feedback: Feedback, round: number, focus: string | null, onUpdate: (s: PoolState) => void): Promise<void> {
  pruneCache()
  const page = round % 5
  const results: { cands: Candidate[]; links?: Link[] }[] = []
  const failed: PoolState['failed'] = []
  let inferred: Inferred = {}
  let pending = 0
  const report = () => onUpdate({ pool: results.flatMap((r) => r.cands), links: results.flatMap((r) => r.links ?? []), inferred, pending, failed: [...failed] })
  const onError = failureList(failed)
  // Results keep task order, so when two providers return the same title the richer source (listed first) wins.
  const run = (tasks: Task[]) => {
    const base = results.length
    tasks.forEach(() => results.push({ cands: [] }))
    pending += tasks.length
    return runQueued(tasks, onError, (i, value) => {
      if (value) results[base + i] = value
      pending--
      report()
    })
  }
  // Phase 1 needs nothing from the library: popular lists. Starts at once, alongside the metadata lookups.
  const general: Task[] = [
    kitsuListTask(`popular:${page}`, 12 * HOUR, `sort=popularityRank&page[offset]=${page * 20}`),
    kitsuListTask(`movies:${page}`, 12 * HOUR, `filter[subtype]=movie&sort=popularityRank&page[offset]=${page * 20}`),
    kitsuListTask(`rated:${page}`, 24 * HOUR, `filter[subtype]=TV&sort=ratingRank&page[offset]=${40 + page * 20}`),
    // TVmaze: two fixed index pages of long-running favourites plus one that rotates with Refresh.
    ...[0, 1, 2 + (round % 8)].map(mazePageTask),
    { provider: 'tmdb', run: async () => ({ cands: await cached('tmdb:trending:movie', 12 * HOUR, () => tmdbList('trending/movie/week', 'movie')) }) },
  ]
  pending++ // the lookups below
  const generalDone = run(general)
  inferred = await inferMetadata(library)
  pending--

  // Phase 2 is driven by the (filled-in) library: favourite genres and each strong title's related titles.
  const full = withInferred(library, inferred)
  const profile = buildProfile(full, feedback)
  const focusTitle = full.find((t) => t.id === focus)
  const seeds = [
    ...profile.seeds.filter((s) => s.id === focus),
    ...(focusTitle && !profile.seeds.some((s) => s.id === focus) ? [{ id: focusTitle.id, source: focusTitle.source }] : []),
    ...profile.seeds.filter((s) => s.id !== focus && s.weight >= 1.5),
  ]
  const personal: Task[] = []
  const animeGenres = [...profile.genres]
    .filter(([g, v]) => v > 0.2 && profile.genreTypes.get(g)?.has('anime'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g)
  for (const g of animeGenres) personal.push(kitsuCategoryTask(g, page))
  for (const s of seeds.filter((s) => s.source?.provider === 'kitsu' && NUMERIC_ID.test(s.source.id)).slice(0, 5)) personal.push(kitsuRelatedTask(s.id, s.source!.id))
  const movieGenre = [...profile.genres].filter(([g, v]) => v > 0.2 && TMDB_MOVIE_GENRE_ID.has(g)).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (movieGenre) personal.push(tmdbGenreTask(movieGenre, page))
  for (const s of seeds.filter((s) => s.source?.provider === 'tmdb' && TMDB_ID.test(s.source.id)).slice(0, 4)) personal.push(tmdbRecTask(s.id, s.source!.id))
  report() // lookups done: the page can already re-rank with the filled-in library
  await Promise.all([generalDone, run(personal)])
}

/**
 * Candidates for "Similar titles" on one library title's page, from that title's own metadata: its provider
 * relationships / recommendations, and lists for its genres. Shares Discover's cache. Sends only that title's
 * provider id (or, when it has none, its name for an exact-match lookup) and genre names. Never throws.
 */
export async function loadSimilar(t: Title): Promise<Omit<PoolState, 'pending'>> {
  const inferred = await inferMetadata([t])
  const [full] = withInferred([t], inferred)
  const src = full.source
  const genres = tasteGenres(full.genres)
  const tasks: Task[] = []
  if (src?.provider === 'kitsu' && NUMERIC_ID.test(src.id)) tasks.push(kitsuRelatedTask(t.id, src.id))
  if (src?.provider === 'tmdb' && TMDB_ID.test(src.id)) tasks.push(tmdbRecTask(t.id, src.id))
  if (full.mediaType === 'anime' || src?.provider === 'kitsu') tasks.push(...genres.slice(0, 2).map((g) => kitsuCategoryTask(g, 0)))
  else if (full.mediaType === 'tv') tasks.push(...[0, 1].map(mazePageTask))
  else {
    const g = genres.find((x) => TMDB_MOVIE_GENRE_ID.has(x))
    if (g) tasks.push(tmdbGenreTask(g, 0))
  }
  const results: { cands: Candidate[]; links?: Link[] }[] = tasks.map(() => ({ cands: [] }))
  const failed: PoolState['failed'] = []
  await runQueued(
    tasks,
    failureList(failed),
    (i, value) => {
      if (value) results[i] = value
    },
  )
  return { pool: results.flatMap((r) => r.cands), links: results.flatMap((r) => r.links ?? []), inferred, failed }
}

// ---------- Highlights: what's popular now, new and coming soon ----------

/**
 * Raw lists for Discover's Trending and New & Upcoming rows; highlights.ts turns them into rows. Each list is only
 * what its provider can actually vouch for:
 *  - Kitsu: this season's anime by Kitsu popularity rank, and anime marked upcoming. (Kitsu's /trending endpoint
 *    returns all-time favourites like Death Note, so it isn't used.)
 *  - TVmaze: daily schedules — shows airing (by TVmaze follower weight) and series/season premieres (episode 1s).
 *  - TMDB, when the server has a key: weekly trending series and movies, movies upcoming and now in cinemas.
 */
export interface Highlights {
  season: Spot[]
  upcomingAnime: Spot[]
  premieres: Spot[]
  /** Shows that aired in the last week. */
  airing: Spot[]
  /** null while loading, or when TMDB isn't available. */
  tmdbTv: Spot[] | null
  tmdbMovies: Spot[] | null
  tmdbUpcoming: Spot[] | null
  tmdbNowPlaying: Spot[] | null
  pending: number
  failed: PoolState['failed']
  tmdbOff: boolean
}

/** Kitsu's seasons: winter = Jan–Mar, spring = Apr–Jun, summer = Jul–Sep, fall = Oct–Dec. */
export function animeSeason(now = Date.now()): { season: string; year: number } {
  const d = new Date(now)
  return { season: ['winter', 'spring', 'summer', 'fall'][Math.floor(d.getMonth() / 3)], year: d.getFullYear() }
}

/** Schedule days fetched: the last week (just premiered) and the next week (premiering soon). */
const PAST_DAYS = 6
const NEXT_DAYS = 7

const spotsOf = (cands: Candidate[]): Spot[] => cands.map((c) => ({ c, date: c.date, season: null }))

/** Loads every highlight list, reporting as each lands. Never throws. */
export async function loadHighlights(onUpdate: (h: Highlights) => void, now = Date.now()): Promise<void> {
  const { season, year } = animeSeason(now)
  const h: Highlights = { season: [], upcomingAnime: [], premieres: [], airing: [], tmdbTv: null, tmdbMovies: null, tmdbUpcoming: null, tmdbNowPlaying: null, pending: 0, failed: [], tmdbOff }
  const seasonPages: Candidate[][] = [[], []]
  const days = new Map<string, { premieres: Spot[]; airing: Spot[] }>()
  const today = dayFrom(now)
  const report = () => {
    h.season = spotsOf(seasonPages.flat())
    const all = [...days.entries()].sort(([a], [b]) => a.localeCompare(b))
    h.premieres = all.flatMap(([, d]) => d.premieres)
    // The most-followed shows on air this past week, each once.
    const airing = new Map<string, Spot>()
    for (const [k, d] of all) if (k.slice(k.indexOf(':') + 1) <= today) for (const s of d.airing) if (!airing.has(s.c.source.id)) airing.set(s.c.source.id, s)
    h.airing = [...airing.values()].sort((a, b) => (b.c.popularity ?? 0) - (a.c.popularity ?? 0))
    h.tmdbOff = tmdbOff
    onUpdate({ ...h, failed: [...h.failed] })
  }
  const kitsu = (key: string, query: string, ttl = 12 * HOUR) => cached(`kitsu2:${key}`, ttl, () => kitsuList(query))
  const tmdbTask = (field: 'tmdbTv' | 'tmdbMovies' | 'tmdbUpcoming' | 'tmdbNowPlaying', path: string, kind: 'movie' | 'tv'): Task<void> => ({
    provider: 'tmdb',
    run: async () => {
      h[field] = spotsOf(await cached(path === 'trending/movie/week' ? 'tmdb:trending:movie' : `tmdb:${path}`, 12 * HOUR, () => tmdbList(path, kind)))
    },
  })
  // Today first, then outwards, so the rows people look at first fill first.
  const offsets = [0, ...Array.from({ length: Math.max(PAST_DAYS, NEXT_DAYS) }, (_, i) => [i + 1, -(i + 1)]).flat()].filter((o) => o >= -PAST_DAYS && o <= NEXT_DAYS)
  const tasks: Task<void>[] = [
    ...[0, 1].map(
      (page): Task<void> => ({
        provider: 'kitsu',
        run: async () => {
          seasonPages[page] = await kitsu(`season:${season}:${year}:${page}`, `filter[season]=${season}&filter[seasonYear]=${year}&sort=popularityRank&page[offset]=${page * 20}`)
        },
      }),
    ),
    {
      provider: 'kitsu',
      run: async () => {
        h.upcomingAnime = spotsOf(await kitsu('upcoming', 'filter[status]=upcoming&sort=popularityRank'))
      },
    },
    tmdbTask('tmdbTv', 'trending/tv/week', 'tv'),
    tmdbTask('tmdbMovies', 'trending/movie/week', 'movie'),
    tmdbTask('tmdbNowPlaying', 'movie/now_playing', 'movie'),
    tmdbTask('tmdbUpcoming', 'movie/upcoming', 'movie'),
    ...offsets.flatMap((o) =>
      (['web', 'us'] as const).map((kind): Task<void> => {
        const date = dayFrom(now, o)
        // A past day's schedule doesn't change; today's and later ones gain shows as they're announced.
        return { provider: 'tvmaze', run: async () => void days.set(`${kind}:${date}`, await cached(`tvmaze:day:${kind}:${date}`, o < 0 ? 7 * 24 * HOUR : 12 * HOUR, () => mazeDay(kind, date))) }
      }),
    ),
  ]
  h.pending = tasks.length
  report()
  await runQueued(tasks, failureList(h.failed), () => {
    h.pending--
    report()
  })
}

// ---------- Saving a recommendation ----------

/**
 * A new library title from a candidate. "completed" points past the last known episode when the provider says how
 * many there are, and leaves the position unknown otherwise — never a made-up episode.
 */
export async function candidateToTitle(c: Candidate, status: 'plan' | 'completed'): Promise<Title> {
  const m = await enrich(c)
  let progress: Progress | null = null
  if (m.mediaType !== 'movie') {
    const numbering = m.mediaType === 'anime' ? 'absolute' : 'seasonal'
    const p: Progress = {
      ...emptyProgress(numbering),
      totalEpisodes: numbering === 'absolute' && m.totalEpisodes && !m.ongoing ? m.totalEpisodes : null,
      totalSeasons: m.totalSeasons,
      seasonEpisodeCounts: m.seasonEpisodeCounts,
    }
    progress = p
    if (status === 'completed') {
      const lastSeasonCount = p.totalSeasons ? p.seasonEpisodeCounts[p.totalSeasons] : undefined
      progress =
        numbering === 'absolute'
          ? { ...p, nextEpisode: p.totalEpisodes ? p.totalEpisodes + 1 : null }
          : lastSeasonCount
            ? { ...p, season: p.totalSeasons, nextEpisode: lastSeasonCount + 1 }
            : { ...p, nextEpisode: null }
    }
  }
  return createTitle({
    title: m.title,
    altTitles: m.altTitles,
    mediaType: m.mediaType,
    synopsis: m.synopsis,
    year: m.year,
    genres: m.genres,
    status,
    poster: m.posterUrl ? await savePoster(m.posterUrl) : null,
    backdropUrl: m.backdropUrl,
    source: m.source,
    progress,
  })
}

// ---------- Feedback + filters (this device only) ----------

export interface DiscoverFilters {
  type: MediaType | 'all'
  genre: string
  sort: SortKey
}

export interface DiscoverStore {
  feedback: Feedback
  filters: DiscoverFilters
  /** Candidate key → when it was on screen as a top pick before a refresh (see markSeen). */
  seen: Record<string, string>
}

const STORE_KEY = 'watchtrack:discover'
const DEFAULT_FILTERS: DiscoverFilters = { type: 'all', genre: '', sort: 'match' }
const MAX_DISMISSED = 1000
const MAX_LIKED = 30
const MAX_SEEN = 300
const SEEN_FOR = 7 * 24 * HOUR

let store: DiscoverStore | null = null
const listeners = new Set<() => void>()

/** Keep only well-formed entries: this is read back from storage the user (or an extension) could have edited. */
function cleanItems(v: unknown): Record<string, FeedbackItem> {
  if (!isObj(v)) return {}
  return Object.fromEntries(
    Object.entries(v).filter(
      ([, f]) => isObj(f) && typeof f.title === 'string' && typeof f.at === 'string' && ['anime', 'tv', 'movie'].includes(f.mediaType as string) && Array.isArray(f.genres),
    ),
  ) as Record<string, FeedbackItem>
}

export function getDiscover(): DiscoverStore {
  if (store) return store
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>
    const fb = isObj(raw.feedback) ? raw.feedback : {}
    store = {
      feedback: { dismissed: cleanItems(fb.dismissed), liked: cleanItems(fb.liked) },
      filters: { ...DEFAULT_FILTERS, ...(isObj(raw.filters) ? (raw.filters as Partial<DiscoverFilters>) : {}) },
      seen: isObj(raw.seen) ? (Object.fromEntries(Object.entries(raw.seen).filter(([, at]) => typeof at === 'string')) as Record<string, string>) : {},
    }
  } catch {
    store = { feedback: emptyFeedback(), filters: DEFAULT_FILTERS, seen: {} }
  }
  return store
}

function setDiscover(next: DiscoverStore) {
  store = next
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: feedback lasts for this visit only.
  }
  listeners.forEach((l) => l())
}

export function useDiscover(): DiscoverStore {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getDiscover,
    getDiscover,
  )
}

const itemOf = (c: Candidate): FeedbackItem => ({ at: new Date().toISOString(), title: c.title, mediaType: c.mediaType, genres: c.genres })

/** Oldest first out once over the cap. */
const capped = (items: Record<string, FeedbackItem>, max: number) =>
  Object.fromEntries(Object.entries(items).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, max))

export function setFilters(patch: Partial<DiscoverFilters>) {
  const s = getDiscover()
  setDiscover({ ...s, filters: { ...s.filters, ...patch } })
}

export function dismiss(c: Candidate) {
  const { feedback, filters, seen } = getDiscover()
  const { [candidateKey(c)]: _, ...liked } = feedback.liked
  setDiscover({ filters, seen, feedback: { liked, dismissed: capped({ ...feedback.dismissed, [candidateKey(c)]: itemOf(c) }, MAX_DISMISSED) } })
}

export function undismiss(key: string) {
  const { feedback, filters, seen } = getDiscover()
  const { [key]: _, ...dismissed } = feedback.dismissed
  setDiscover({ filters, seen, feedback: { ...feedback, dismissed } })
}

export function restoreDismissed() {
  const { feedback, filters, seen } = getDiscover()
  setDiscover({ filters, seen, feedback: { ...feedback, dismissed: {} } })
}

/** "More like this" for a title that isn't in the library: remembered as a liked title. Returns its seed id. */
export function likeCandidate(c: Candidate): string {
  const { feedback, filters, seen } = getDiscover()
  const key = candidateKey(c)
  setDiscover({ filters, seen, feedback: { ...feedback, liked: capped({ ...feedback.liked, [key]: itemOf(c) }, MAX_LIKED) } })
  return `liked:${key}`
}

/**
 * Remember the picks on screen when the user asks for another set, so the next set leads with titles they haven't
 * been shown (buildDiscover's `seen`). Forgotten after a week, so a good match isn't buried for ever.
 */
export function markSeen(keys: string[], now = Date.now()) {
  const s = getDiscover()
  const at = new Date(now).toISOString()
  const fresh = Object.entries(s.seen).filter(([, t]) => now - Date.parse(t) < SEEN_FOR)
  setDiscover({ ...s, seen: Object.fromEntries([...fresh, ...keys.map((k) => [k, at] as const)].sort((a, b) => b[1].localeCompare(a[1])).slice(0, MAX_SEEN)) })
}

/** Keys from markSeen still within their week. */
export const seenKeys = (seen: Record<string, string>, now = Date.now()) => new Set(Object.entries(seen).flatMap(([k, t]) => (now - Date.parse(t) < SEEN_FOR ? [k] : [])))

export function resetDiscover() {
  setDiscover({ feedback: emptyFeedback(), filters: DEFAULT_FILTERS, seen: {} })
  clearMetaCache()
}
