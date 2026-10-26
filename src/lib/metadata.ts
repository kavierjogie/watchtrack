/**
 * Optional title discovery + artwork. Nothing personal is ever sent — only the search text.
 *  - Kitsu (anime): public JSON:API, no key, CORS enabled. https://kitsu.docs.apiary.io
 *  - TVmaze (TV): public REST, no key, CORS enabled, CC BY-SA (attribution required). https://www.tvmaze.com/api
 *  - TMDB (movies + TV): needs the user's own API key, stored only in this browser. https://developer.themoviedb.org
 * The app works fully without any of these.
 */
import { normTitle } from './backup'
import { getPrefs } from './prefs'
import type { MediaType, MetadataSource } from './types'

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

export class MetadataError extends Error {}

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

async function request<T>(url: string, init: RequestInit = {}, provider: Provider): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new MetadataError("You're offline. Add the title manually.")
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  // The caller can cancel too (e.g. a newer search replaced this one).
  init.signal?.addEventListener('abort', () => ctrl.abort())
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (res.status === 429) throw new MetadataError(`${PROVIDER_LABEL[provider]} is rate-limiting requests. Wait a minute and try again.`)
    if (res.status === 401) throw new MetadataError(`${PROVIDER_LABEL[provider]} rejected the API key. Check it in Settings.`)
    if (!res.ok) throw new MetadataError(`${PROVIDER_LABEL[provider]} returned an error (${res.status}).`)
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof MetadataError) throw err
    // A blocked/CORS-less error response also lands here, so it isn't always the user's connection.
    throw new MetadataError(`Couldn't reach ${PROVIDER_LABEL[provider]} — it may be down. Try another source or add the title manually.`)
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

interface KitsuAnime {
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
    posterImage: Record<string, unknown> | null
    coverImage: { original?: string; large?: string } | null
  }
  relationships: { categories: { data: { id: string }[] } }
}

async function searchKitsu(q: string, signal?: AbortSignal): Promise<MetaResult[]> {
  const url = `https://kitsu.app/api/edge/anime?filter[text]=${encodeURIComponent(q)}&page[limit]=12&include=categories&fields[categories]=title`
  const res = await request<{ data: KitsuAnime[]; included?: { id: string; attributes: { title: string } }[] }>(
    url,
    { headers: { Accept: 'application/vnd.api+json' }, signal },
    'kitsu',
  )
  const category = new Map(res.included?.map((c) => [c.id, c.attributes.title]))
  return res.data.map(({ id, attributes: a, relationships }) => {
    const title = a.titles.en || a.canonicalTitle || a.titles.en_jp || 'Untitled'
    const alts = [a.canonicalTitle, a.titles.en_jp, a.titles.ja_jp, ...(a.abbreviatedTitles ?? [])].filter((s): s is string => !!s && s !== title)
    return {
      source: { provider: 'kitsu', id, url: `https://kitsu.app/anime/${a.slug}` },
      title,
      altTitles: [...new Set(alts)].slice(0, 4),
      mediaType: a.subtype === 'movie' ? 'movie' : 'anime',
      year: a.startDate ? Number(a.startDate.slice(0, 4)) : null,
      date: a.startDate,
      synopsis: stripHtml(a.synopsis),
      genres: relationships.categories.data.map((c) => category.get(c.id)).filter((g): g is string => !!g),
      ...kitsuPoster(a.posterImage),
      backdropUrl: a.coverImage?.original ?? a.coverImage?.large ?? null,
      totalEpisodes: a.episodeCount,
      totalSeasons: null,
      seasonEpisodeCounts: {},
      ongoing: a.status === 'current' || a.status === 'upcoming' || a.status === 'unreleased' || a.status === 'tba',
    }
  })
}

// ---------- TVmaze ----------

interface MazeShow {
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
}

async function searchTvMaze(q: string, signal?: AbortSignal): Promise<MetaResult[]> {
  const rows = await request<{ show: MazeShow }[]>(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`, { signal }, 'tvmaze')
  return rows.map(({ show }) => ({
    source: { provider: 'tvmaze', id: String(show.id), url: show.url },
    title: show.name,
    altTitles: [],
    mediaType: show.type === 'Animation' && (show.genres.includes('Anime') || show.language === 'Japanese') ? 'anime' : 'tv',
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    date: show.premiered,
    synopsis: stripHtml(show.summary),
    genres: show.genres,
    ...mazePoster(show.image),
    backdropUrl: null,
    totalEpisodes: null,
    totalSeasons: null,
    seasonEpisodeCounts: {},
    ongoing: show.status !== 'Ended',
  }))
}

async function tvMazeSeasons(r: MetaResult): Promise<MetaResult> {
  const seasons = await request<{ number: number; episodeOrder: number | null }[]>(
    `https://api.tvmaze.com/shows/${r.source.id}/seasons`,
    {},
    'tvmaze',
  )
  const counts: Record<number, number> = {}
  for (const s of seasons) if (s.episodeOrder) counts[s.number] = s.episodeOrder
  return { ...r, seasonEpisodeCounts: counts, totalSeasons: r.ongoing ? null : seasons.length || null }
}

// ---------- TMDB (user key) ----------

function tmdbInit(key: string): { query: string; init: RequestInit } {
  // Long JWT-style tokens are "API Read Access Tokens" (Bearer); short ones are v3 API keys.
  return key.length > 40
    ? { query: '', init: { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } } }
    : { query: `&api_key=${encodeURIComponent(key)}`, init: {} }
}

interface TmdbItem {
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
}

async function searchTmdb(q: string, key: string, signal?: AbortSignal): Promise<MetaResult[]> {
  const { query, init } = tmdbInit(key)
  const data = await request<{ results: TmdbItem[] }>(
    `https://api.themoviedb.org/3/search/multi?include_adult=false&query=${encodeURIComponent(q)}${query}`,
    { ...init, signal },
    'tmdb',
  )
  return data.results
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => {
      const title = r.title ?? r.name ?? 'Untitled'
      const original = r.original_title ?? r.original_name
      const date = r.release_date || r.first_air_date
      const kind = r.media_type === 'movie' ? 'movie' : 'tv'
      return {
        source: { provider: 'tmdb' as const, id: `${kind}/${r.id}`, url: `https://www.themoviedb.org/${kind}/${r.id}` },
        title,
        altTitles: original && original !== title ? [original] : [],
        mediaType: kind === 'movie' ? 'movie' : r.original_language === 'ja' && r.genre_ids?.includes(16) ? 'anime' : 'tv',
        year: date ? Number(date.slice(0, 4)) : null,
        date: date || null,
        synopsis: r.overview,
        genres: [],
        ...tmdbPoster(r.poster_path),
        backdropUrl: r.backdrop_path ? `${TMDB_IMG}w1280${r.backdrop_path}` : null,
        totalEpisodes: null,
        totalSeasons: null,
        seasonEpisodeCounts: {},
        ongoing: true,
      }
    })
}

async function tmdbDetails(r: MetaResult, key: string): Promise<MetaResult> {
  const { query, init } = tmdbInit(key)
  const d = await request<{
    genres: { name: string }[]
    status?: string
    number_of_seasons?: number
    number_of_episodes?: number
    seasons?: { season_number: number; episode_count: number }[]
  }>(`https://api.themoviedb.org/3/${r.source.id}?${query.slice(1)}`, init, 'tmdb')
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

/** Every source the unified search asks. TMDB only joins when the user has added their own key. */
export function searchProviders(): Provider[] {
  return getPrefs().tmdbKey ? ['kitsu', 'tvmaze', 'tmdb'] : ['kitsu', 'tvmaze']
}

export async function searchTitles(q: string, provider: Provider, signal?: AbortSignal): Promise<MetaResult[]> {
  const query = q.trim()
  if (!query) return []
  if (provider === 'kitsu') return searchKitsu(query, signal)
  if (provider === 'tvmaze') return searchTvMaze(query, signal)
  const key = getPrefs().tmdbKey
  if (!key) throw new MetadataError('Add your TMDB API key in Settings to search TMDB.')
  return searchTmdb(query, key, signal)
}

// ---------- Unified search ----------

/** Which provider's record wins when the same title comes from several (richest data for that type first). */
const PRIORITY: Record<MediaType, Provider[]> = {
  anime: ['kitsu', 'tvmaze', 'tmdb'],
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

/** Fetch extra details (season/episode counts, genres). Falls back to the search result on failure. */
export async function enrich(r: MetaResult): Promise<MetaResult> {
  try {
    if (r.source.provider === 'tvmaze') return await tvMazeSeasons(r)
    const key = getPrefs().tmdbKey
    if (r.source.provider === 'tmdb' && key) return await tmdbDetails(r, key)
  } catch {
    // Details are a bonus; the search result is still usable.
  }
  return r
}

/** Provider ids we'll look up. Ids can come from shared links, so anything else is ignored rather than put in a URL. */
const SOURCE_ID: Partial<Record<Provider, RegExp>> = { kitsu: /^\d{1,10}$/, tvmaze: /^\d{1,10}$/, tmdb: /^(movie|tv)\/\d{1,10}$/ }

/**
 * Poster for a title that's already identified, looked up by its provider id — never by name, so a remake, season or
 * namesake can't swap in. Null when the provider has no artwork or can't be asked (AniList is retired; TMDB needs a key).
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
  const key = getPrefs().tmdbKey
  if (!key) return null
  const { query, init } = tmdbInit(key)
  return tmdbPoster((await request<{ poster_path?: string | null }>(`https://api.themoviedb.org/3/${id}?${query.slice(1)}`, init, 'tmdb')).poster_path).posterUrl
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
