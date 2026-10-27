/**
 * Optional title discovery + artwork. Nothing personal is ever sent — only the search text.
 *  - Kitsu (anime): public JSON:API, no key, CORS enabled. https://kitsu.docs.apiary.io
 *  - TVmaze (TV): public REST, no key, CORS enabled, CC BY-SA (attribution required). https://www.tvmaze.com/api
 *  - TMDB (movies + TV): through this app's /api/tmdb proxy, which holds the key server-side. https://developer.themoviedb.org
 * The app works fully without any of these.
 */
import { normTitle } from './backup'
import type { MediaType, MetadataSource, Release } from './types'

export type Provider = MetadataSource['provider']

export interface MetaResult {
  source: MetadataSource
  title: string
  altTitles: string[]
  mediaType: MediaType
  year: number | null
  /** First release/air date (YYYY-MM-DD) when the provider has one; used to match the same title across providers. */
  date: string | null
  synopsis: string
  genres: string[]
  posterUrl: string | null
  /** Small version of the poster for result lists (full-size originals are megabytes). */
  thumbUrl: string | null
  backdropUrl: string | null
  totalEpisodes: number | null
  totalSeasons: number | null
  seasonEpisodeCounts: Record<number, number>
  /** Show still airing → don't treat the last known season as the end. */
  ongoing: boolean
}

export class MetadataError extends Error {
  /** Worth trying again later: rate limit, server error, timeout or network failure. */
  readonly retryable: boolean
  /** Seconds the provider asked us to wait (Retry-After), when it said. */
  readonly retryAfter: number | null
  constructor(message: string, retryable = false, retryAfter: number | null = null) {
    super(message)
    this.retryable = retryable
    this.retryAfter = retryAfter
  }
}

export const PROVIDER_LABEL: Record<Provider, string> = { kitsu: 'Kitsu', anilist: 'AniList', tvmaze: 'TVmaze', tmdb: 'TMDB' }

const stripHtml = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export async function request<T>(url: string, init: RequestInit = {}, provider: Provider): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new MetadataError("You're offline. Add the title manually.")
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  // The caller can cancel too (e.g. a newer search replaced this one).
  init.signal?.addEventListener('abort', () => ctrl.abort())
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (res.status === 429) {
      const after = Number(res.headers.get('Retry-After'))
      throw new MetadataError(`${PROVIDER_LABEL[provider]} is rate-limiting requests. Wait a minute and try again.`, true, after > 0 ? after : null)
    }
    if (res.status === 401) throw new MetadataError(`${PROVIDER_LABEL[provider]} rejected the API key.`)
    if (!res.ok) throw new MetadataError(`${PROVIDER_LABEL[provider]} returned an error (${res.status}).`, res.status >= 500)
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof MetadataError) throw err
    // A blocked/CORS-less error response also lands here, so it isn't always the user's connection.
    throw new MetadataError(`Couldn't reach ${PROVIDER_LABEL[provider]} — it may be down. Try another source or add the title manually.`, true)
  } finally {
    clearTimeout(timer)
  }
}

// ---------- Poster normalisation ----------

const TMDB_IMG = 'https://image.tmdb.org/t/p/'

export const isHttpUrl = (v: unknown): v is string => {
  if (typeof v !== 'string' || !v) return false
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol)
  } catch {
    return false
  }
}

/** First usable http(s) URL among an image object's sizes, in preference order. Providers omit sizes or send nulls. */
const pickImage = (img: unknown, sizes: string[]): string | null => {
  if (!img || typeof img !== 'object') return null
  for (const k of sizes) {
    const v = (img as Record<string, unknown>)[k]
    if (isHttpUrl(v)) return v
  }
  return null
}

type PosterPair = Pick<MetaResult, 'posterUrl' | 'thumbUrl'>
const kitsuPoster = (img: unknown): PosterPair => ({
  posterUrl: pickImage(img, ['original', 'large', 'medium', 'small']),
  thumbUrl: pickImage(img, ['small', 'medium', 'large', 'original']),
})
const mazePoster = (img: unknown): PosterPair => ({ posterUrl: pickImage(img, ['original', 'medium']), thumbUrl: pickImage(img, ['medium', 'original']) })
const tmdbPoster = (path: unknown): PosterPair =>
  typeof path === 'string' && /^\/[\w.-]+$/.test(path) ? { posterUrl: `${TMDB_IMG}w500${path}`, thumbUrl: `${TMDB_IMG}w92${path}` } : { posterUrl: null, thumbUrl: null }

// ---------- Kitsu ----------

export interface KitsuAnime {
  id: string
  attributes: {
    slug: string
    canonicalTitle: string
    titles: Record<string, string | null>
    abbreviatedTitles: string[] | null
    synopsis: string | null
    startDate: string | null
    subtype: string | null
    status: string | null
    episodeCount: number | null
    /** 0–100 as a string, e.g. "82.35". Only present when requested. */
    averageRating?: string | null
    /** 1 = most popular. Only present when requested. */
    popularityRank?: number | null
    posterImage: Record<string, unknown> | null
    coverImage: { original?: string; large?: string } | null
  }
  /** Absent when categories weren't included in the request. */
  relationships?: { categories?: { data?: { id: string }[] } }
}

async function searchKitsu(q: string, signal?: AbortSignal): Promise<MetaResult[]> {
  const url = `https://kitsu.app/api/edge/anime?filter[text]=${encodeURIComponent(q)}&page[limit]=12&include=categories&fields[categories]=title`
  const res = await request<{ data: KitsuAnime[]; included?: { id: string; attributes: { title: string } }[] }>(
    url,
    { headers: { Accept: 'application/vnd.api+json' }, signal },
    'kitsu',
  )
  const category = new Map(res.included?.map((c) => [c.id, c.attributes.title]))
  return res.data.map((a) => kitsuToResult(a, category))
}

export const kitsuOngoing = (status: string | null | undefined) => status === 'current' || status === 'upcoming' || status === 'unreleased' || status === 'tba'

/** One Kitsu anime → MetaResult. `category` maps category ids to names (from `include=categories`). */
export function kitsuToResult({ id, attributes: a, relationships }: KitsuAnime, category: Map<string, string> = new Map()): MetaResult {
  const title = a.titles?.en || a.canonicalTitle || a.titles?.en_jp || 'Untitled'
  const alts = [a.canonicalTitle, a.titles?.en_jp, a.titles?.ja_jp, ...(a.abbreviatedTitles ?? [])].filter((s): s is string => !!s && s !== title)
  return {
    source: { provider: 'kitsu', id, url: `https://kitsu.app/anime/${a.slug}` },
    title,
    altTitles: [...new Set(alts)].slice(0, 4),
    mediaType: a.subtype === 'movie' ? 'movie' : 'anime',
    year: a.startDate ? Number(a.startDate.slice(0, 4)) : null,
    date: a.startDate,
    synopsis: stripHtml(a.synopsis),
    genres: (relationships?.categories?.data ?? []).map((c) => category.get(c.id)).filter((g): g is string => !!g),
    ...kitsuPoster(a.posterImage),
    backdropUrl: a.coverImage?.original ?? a.coverImage?.large ?? null,
    totalEpisodes: a.episodeCount,
    totalSeasons: null,
    seasonEpisodeCounts: {},
    ongoing: kitsuOngoing(a.status),
  }
}

// ---------- TVmaze ----------

export interface MazeShow {
  id: number
  name: string
  url: string
  premiered: string | null
  genres: string[]
  summary: string | null
  status: string
  type: string
  language: string | null
  image: { medium?: string | null; original?: string | null } | null
  /** Present on show records (not always on search results). */
  rating?: { average: number | null } | null
  /** TVmaze's 0–100 popularity. */
  weight?: number | null
}

async function searchTvMaze(q: string, signal?: AbortSignal): Promise<MetaResult[]> {
  const rows = await request<{ show: MazeShow }[]>(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`, { signal }, 'tvmaze')
  return rows.map(({ show }) => mazeToResult(show))
}

export function mazeToResult(show: MazeShow): MetaResult {
  const genres = show.genres ?? []
  return {
    source: { provider: 'tvmaze', id: String(show.id), url: show.url },
    title: show.name,
    altTitles: [],
    mediaType: show.type === 'Animation' && (genres.includes('Anime') || show.language === 'Japanese') ? 'anime' : 'tv',
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    date: show.premiered,
    synopsis: stripHtml(show.summary),
    genres,
    ...mazePoster(show.image),
    backdropUrl: null,
    totalEpisodes: null,
    totalSeasons: null,
    seasonEpisodeCounts: {},
    ongoing: show.status !== 'Ended',
  }
}

export interface MazeEpisode {
  id: number
  season: number
  /** null for specials */
  number: number | null
  type?: string
  /** YYYY-MM-DD, '' when not scheduled yet */
  airdate: string | null
  airstamp: string | null
  name?: string | null
}

export interface MazeSeason {
  number: number
  /** YYYY-MM-DD; null while the season is announced without a date. */
  premiereDate: string | null
}

/** Future episodes kept per title (enough for the Upcoming page; a whole scheduled season is rarely more). */
const MAX_UPCOMING = 12

/**
 * Episodes per season from TVmaze's full episode list (one request: show + embedded episodes and seasons).
 * Only episodes that have aired are counted; the earliest dated future episode is the next airing.
 * Undated episodes are announcements, not confirmed releases, so they're never given a date. TVmaze only lists a
 * season once it's been ordered/renewed, so a listed season with nothing aired yet is an announced season.
 * `upcoming` is undefined when the episode list is missing, so a bad answer can't wipe the stored one.
 */
export async function fetchMazeEpisodes(id: string, signal?: AbortSignal, now = Date.now()) {
  const show = await request<MazeShow & { _embedded?: { episodes?: MazeEpisode[]; seasons?: MazeSeason[] } }>(
    `https://api.tvmaze.com/shows/${id}?embed[]=episodes&embed[]=seasons`,
    { signal },
    'tvmaze',
  )
  const list = show?._embedded?.episodes
  const episodes = Array.isArray(list) ? list : []
  const aired: Record<number, number> = {}
  let next: { season: number; episode: number; airdate: string; at: number } | null = null
  const future: { at: number; r: Release }[] = []
  for (const e of episodes) {
    if (!Number.isInteger(e?.season) || !Number.isInteger(e.number) || e.number! < 1 || e.season < 1 || e.type?.includes('special')) continue
    const at = Date.parse(e.airstamp || e.airdate || '')
    if (Number.isNaN(at)) continue
    if (at <= now) aired[e.season] = Math.max(aired[e.season] ?? 0, e.number!)
    else {
      future.push({ at, r: { kind: 'episode', season: e.season, episode: e.number!, name: e.name || null, airdate: (e.airstamp || e.airdate)! } })
      if (!next || at < next.at) next = { season: e.season, episode: e.number!, airdate: (e.airstamp || e.airdate)!, at }
    }
  }
  const lastAired = Math.max(0, ...Object.keys(aired).map(Number))
  const seasons: Release[] = (Array.isArray(show?._embedded?.seasons) ? show._embedded.seasons : [])
    .filter((s) => Number.isInteger(s?.number) && s.number > lastAired && (!s.premiereDate || !(Date.parse(s.premiereDate) <= now)))
    .map((s) => ({ kind: 'season' as const, season: s.number, episode: null, name: null, airdate: /^\d{4}-\d{2}-\d{2}$/.test(s.premiereDate ?? '') ? s.premiereDate : null }))
  const upcoming = Array.isArray(list)
    ? [...seasons, ...future.sort((a, b) => a.at - b.at).slice(0, MAX_UPCOMING).map((f) => f.r)]
    : undefined
  return { ongoing: show?.status !== 'Ended', aired, next: next && { season: next.season, episode: next.episode, airdate: next.airdate }, upcoming }
}

async function tvMazeSeasons(r: MetaResult): Promise<MetaResult> {
  const { aired, ongoing } = await fetchMazeEpisodes(r.source.id)
  const seasons = Object.keys(aired).map(Number)
  return { ...r, seasonEpisodeCounts: aired, ongoing, totalSeasons: ongoing || !seasons.length ? null : Math.max(...seasons) }
}

// ---------- TMDB (via the /api/tmdb proxy) ----------

/** GET a TMDB v3 path (with its query string) through the app's proxy, which adds the key (api/tmdb.ts). */
export const tmdb = <T>(path: string, init: RequestInit = {}) => request<T>(`/api/tmdb?path=${encodeURIComponent(path)}`, init, 'tmdb')

export interface TmdbItem {
  id: number
  media_type: string
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  original_language?: string
  genre_ids?: number[]
  vote_average?: number
  vote_count?: number
}

async function searchTmdb(q: string, signal?: AbortSignal): Promise<MetaResult[]> {
  const data = await tmdb<{ results: TmdbItem[] }>(`search/multi?include_adult=false&query=${encodeURIComponent(q)}`, { signal })
  return data.results
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => tmdbToResult(r))
}

/** `kind` is needed for endpoints that don't send media_type (recommendations, discover). */
export function tmdbToResult(r: TmdbItem, kind: 'movie' | 'tv' = r.media_type === 'movie' ? 'movie' : 'tv', genres: string[] = []): MetaResult {
  const title = r.title ?? r.name ?? 'Untitled'
  const original = r.original_title ?? r.original_name
  const date = r.release_date || r.first_air_date
  return {
    source: { provider: 'tmdb' as const, id: `${kind}/${r.id}`, url: `https://www.themoviedb.org/${kind}/${r.id}` },
    title,
    altTitles: original && original !== title ? [original] : [],
    mediaType: kind === 'movie' ? 'movie' : r.original_language === 'ja' && r.genre_ids?.includes(16) ? 'anime' : 'tv',
    year: date ? Number(date.slice(0, 4)) : null,
    date: date || null,
    synopsis: r.overview,
    genres,
    ...tmdbPoster(r.poster_path),
    backdropUrl: r.backdrop_path ? `${TMDB_IMG}w1280${r.backdrop_path}` : null,
    totalEpisodes: null,
    totalSeasons: null,
    seasonEpisodeCounts: {},
    ongoing: true,
  }
}

async function tmdbDetails(r: MetaResult): Promise<MetaResult> {
  const d = await tmdb<{
    genres: { name: string }[]
    status?: string
    number_of_seasons?: number
    number_of_episodes?: number
    seasons?: { season_number: number; episode_count: number }[]
  }>(r.source.id)
  const counts: Record<number, number> = {}
  for (const s of d.seasons ?? []) if (s.season_number > 0 && s.episode_count) counts[s.season_number] = s.episode_count
  const ended = d.status === 'Ended' || d.status === 'Canceled'
  return {
    ...r,
    genres: d.genres.map((g) => g.name),
    seasonEpisodeCounts: counts,
    totalSeasons: ended ? (d.number_of_seasons ?? null) : null,
    ongoing: !ended,
  }
}

// ---------- Public API ----------

/** Every source the unified search asks. */
export function searchProviders(): Provider[] {
  return ['kitsu', 'tvmaze', 'tmdb']
}

export async function searchTitles(q: string, provider: Provider, signal?: AbortSignal): Promise<MetaResult[]> {
  const query = q.trim()
  if (!query) return []
  if (provider === 'kitsu') return searchKitsu(query, signal)
  if (provider === 'tvmaze') return searchTvMaze(query, signal)
  return searchTmdb(query, signal)
}

// ---------- Unified search ----------

/** Which provider's record wins when the same title comes from several (richest data for that type first). */
const PRIORITY: Record<MediaType, Provider[]> = {
  // TVmaze first for anime series: it keeps every season under one show and has dated episodes, so refresh works fully.
  // Kitsu still fills alt titles and art, and is the source when TVmaze doesn't have the show.
  anime: ['tvmaze', 'kitsu', 'tmdb'],
  tv: ['tvmaze', 'tmdb', 'kitsu'],
  movie: ['tmdb', 'kitsu', 'tvmaze'],
}

const names = (r: MetaResult) => [r.title, ...r.altTitles].map(normTitle).filter(Boolean)

const wordsOf = (s: string) => s.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** 3 = exact name, 2 = name starts with the query, 1 = every query word starts a word of the name, 0 = unrelated. */
function relevance(r: MetaResult, q: string, words: string[]): number {
  const ns = names(r)
  if (ns.includes(q)) return 3
  if (ns.some((n) => n.startsWith(q))) return 2
  const titles = [r.title, ...r.altTitles].map(wordsOf)
  if (titles.some((tw) => words.every((w) => tw.some((t) => t.startsWith(w))))) return 1
  return 0
}

/**
 * Conservative: same type, and either the same name in the same year, or the same premiere day where one name
 * is a shortened form of the other ("Demon Slayer" vs "Demon Slayer: Kimetsu no Yaiba"). Seasons, remakes and
 * films have their own dates, so they stay separate. When unsure, don't merge.
 */
export function sameTitle(a: MetaResult, b: MetaResult): boolean {
  if (a.mediaType !== b.mediaType) return false
  const an = names(a)
  const bn = names(b)
  if (a.year != null && a.year === b.year && an.some((n) => bn.includes(n))) return true
  return !!a.date && a.date === b.date && an.some((x) => bn.some((y) => Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))))
}

function merge(a: MetaResult, b: MetaResult): MetaResult {
  const order = PRIORITY[a.mediaType]
  const [main, other] = order.indexOf(a.source.provider) <= order.indexOf(b.source.provider) ? [a, b] : [b, a]
  return {
    ...main,
    // The other provider's name goes first: it's often the common short name ("Demon Slayer").
    altTitles: [...new Set([other.title, ...main.altTitles, ...other.altTitles])].filter((t) => t !== main.title).slice(0, 5),
    synopsis: main.synopsis || other.synopsis,
    genres: main.genres.length ? main.genres : other.genres,
    // Poster and thumbnail travel together so they always show the same artwork.
    ...(main.posterUrl ? {} : { posterUrl: other.posterUrl, thumbUrl: other.thumbUrl }),
    backdropUrl: main.backdropUrl ?? other.backdropUrl,
  }
}

/** One list from several providers: same titles merged, unrelated filler dropped, best matches first. */
export function combineResults(query: string, lists: MetaResult[][]): MetaResult[] {
  const q = normTitle(query)
  const words = wordsOf(query)
  const rows: { r: MetaResult; providers: Set<Provider>; score: number; rank: number }[] = []
  for (const list of lists) {
    list.forEach((r, rank) => {
      const score = relevance(r, q, words)
      const twin = rows.find((row) => !row.providers.has(r.source.provider) && sameTitle(row.r, r))
      if (!twin) return void rows.push({ r, providers: new Set([r.source.provider]), score, rank })
      twin.r = merge(twin.r, r)
      twin.providers.add(r.source.provider)
      twin.score = Math.max(twin.score, score)
      twin.rank = Math.min(twin.rank, rank)
    })
  }
  // Providers always return something (Kitsu answers "Breaking Bad" or gibberish with unrelated anime), so keep only
  // results whose name actually matches. ponytail: no typo tolerance; add fuzzy matching if misspellings come up a lot.
  return rows
    .filter((row) => row.score > 0)
    .sort((x, y) => y.score - x.score || x.rank - y.rank)
    .map((row) => row.r)
}

export interface SearchState {
  query: string
  results: MetaResult[]
  /** Providers still loading. */
  pending: number
  /** Providers that failed this search. */
  failed: Provider[]
  /** Set only when every provider failed. */
  error: string | null
}

/**
 * Ask every provider at once and report after each answer, so fast sources show up without waiting for slow ones.
 * Nothing is reported once `signal` aborts, so an older search can never overwrite a newer one.
 */
export async function searchAll(query: string, signal: AbortSignal, onUpdate: (s: SearchState) => void): Promise<void> {
  const providers = searchProviders()
  const lists: MetaResult[][] = providers.map(() => [])
  const failed: Provider[] = []
  let pending = providers.length
  let firstError: string | null = null
  await Promise.all(
    providers.map(async (p, i) => {
      try {
        lists[i] = await searchTitles(query, p, signal)
      } catch (err) {
        failed.push(p)
        firstError ??= err instanceof Error ? err.message : 'Search failed.'
      }
      pending--
      if (signal.aborted) return
      const allFailed = pending === 0 && failed.length === providers.length
      onUpdate({
        query,
        results: combineResults(query, lists),
        pending,
        failed: [...failed],
        // The offline message is the useful one; otherwise a per-provider message would wrongly blame just one source.
        error: allFailed ? (typeof navigator !== 'undefined' && navigator.onLine === false ? firstError : "Couldn't reach any search source. Check your connection and try again.") : null,
      })
    }),
  )
}

/**
 * The TVmaze show a single-season anime entry belongs to: same name (title or alt title) and same premiere year.
 * Kitsu's first-season entry shares both with the show. When unsure, no match: the user picks by hand instead.
 * ponytail: TVmaze only; add TMDB as a second source if shows turn up that TVmaze doesn't have.
 */
export function wholeShowMatch(t: { title: string; altTitles: string[]; year: number | null }, results: MetaResult[]): MetaResult | null {
  const mine = [t.title, ...t.altTitles].map(normTitle).filter(Boolean)
  return results.find((r) => r.mediaType !== 'movie' && r.year != null && r.year === t.year && names(r).some((n) => mine.includes(n))) ?? null
}

/** A season entry's name without its season part: "My Hero Academia Season 2" → "My Hero Academia". */
export const showName = (title: string) => title.replace(/[\s:,-]+(season|part|cour)\s*\d+.*$/i, '').replace(/\s+\d+(st|nd|rd|th)? season$/i, '') || title

export async function findWholeShow(t: { title: string; altTitles: string[]; year: number | null }): Promise<MetaResult | null> {
  const match = wholeShowMatch(t, await searchTitles(showName(t.title), 'tvmaze'))
  return match && enrich(match)
}

/** Fetch extra details (season/episode counts, genres). Falls back to the search result on failure. */
export async function enrich(r: MetaResult): Promise<MetaResult> {
  try {
    if (r.source.provider === 'tvmaze') return await tvMazeSeasons(r)
    if (r.source.provider === 'tmdb') return await tmdbDetails(r)
  } catch {
    // Details are a bonus; the search result is still usable.
  }
  return r
}

/** Provider ids we'll look up. Ids can come from shared links, so anything else is ignored rather than put in a URL. */
export const SOURCE_ID: Partial<Record<Provider, RegExp>> = { kitsu: /^\d{1,10}$/, tvmaze: /^\d{1,10}$/, tmdb: /^(movie|tv)\/\d{1,10}$/ }

/**
 * Poster for a title that's already identified, looked up by its provider id — never by name, so a remake, season or
 * namesake can't swap in. Null when the provider has no artwork or can't be asked (AniList is retired).
 * Throws MetadataError when the provider can't be reached.
 */
export async function fetchPosterUrl(source: Pick<MetadataSource, 'provider' | 'id'>): Promise<string | null> {
  const { provider, id } = source
  if (!SOURCE_ID[provider]?.test(id)) return null
  if (provider === 'tvmaze') return mazePoster((await request<MazeShow>(`https://api.tvmaze.com/shows/${id}`, {}, 'tvmaze')).image).posterUrl
  if (provider === 'kitsu') {
    const res = await request<{ data: KitsuAnime }>(
      `https://kitsu.app/api/edge/anime/${id}?fields[anime]=posterImage`,
      { headers: { Accept: 'application/vnd.api+json' } },
      'kitsu',
    )
    return kitsuPoster(res.data?.attributes?.posterImage).posterUrl
  }
  return tmdbPoster((await tmdb<{ poster_path?: string | null }>(id)).poster_path).posterUrl
}

/** Try to download a poster so it works offline. Returns null if the host blocks it (CORS) or it fails. */
export async function downloadPoster(url: string): Promise<Blob | null> {
  try {
    // Saving waits on this, so don't let a slow image host hold the form; the remote URL is the fallback.
    const res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const blob = await res.blob()
    return blob.type.startsWith('image/') ? blob : null
  } catch {
    return null
  }
}
