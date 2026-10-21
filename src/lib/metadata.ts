/**
 * Optional title discovery + artwork. Nothing personal is ever sent — only the search text.
 *  - Kitsu (anime): public JSON:API, no key, CORS enabled. https://kitsu.docs.apiary.io
 *  - TVmaze (TV): public REST, no key, CORS enabled, CC BY-SA (attribution required). https://www.tvmaze.com/api
 *  - TMDB (movies + TV): needs the user's own API key, stored only in this browser. https://developer.themoviedb.org
 * The app works fully without any of these.
 */
import { getPrefs } from './prefs'
import type { MediaType, MetadataSource } from './types'

export type Provider = MetadataSource['provider']

export interface MetaResult {
  source: MetadataSource
  title: string
  altTitles: string[]
  mediaType: MediaType
  year: number | null
  synopsis: string
  genres: string[]
  posterUrl: string | null
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
    posterImage: { original?: string; large?: string } | null
    coverImage: { original?: string; large?: string } | null
  }
  relationships: { categories: { data: { id: string }[] } }
}

async function searchKitsu(q: string): Promise<MetaResult[]> {
  const url = `https://kitsu.app/api/edge/anime?filter[text]=${encodeURIComponent(q)}&page[limit]=12&include=categories&fields[categories]=title`
  const res = await request<{ data: KitsuAnime[]; included?: { id: string; attributes: { title: string } }[] }>(
    url,
    { headers: { Accept: 'application/vnd.api+json' } },
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
      synopsis: stripHtml(a.synopsis),
      genres: relationships.categories.data.map((c) => category.get(c.id)).filter((g): g is string => !!g),
      posterUrl: a.posterImage?.original ?? a.posterImage?.large ?? null,
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
  image: { medium: string; original: string } | null
}

async function searchTvMaze(q: string): Promise<MetaResult[]> {
  const rows = await request<{ show: MazeShow }[]>(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`, {}, 'tvmaze')
  return rows.map(({ show }) => ({
    source: { provider: 'tvmaze', id: String(show.id), url: show.url },
    title: show.name,
    altTitles: [],
    mediaType: show.type === 'Animation' && show.genres.includes('Anime') ? 'anime' : 'tv',
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    synopsis: stripHtml(show.summary),
    genres: show.genres,
    posterUrl: show.image?.original ?? show.image?.medium ?? null,
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

const TMDB_IMG = 'https://image.tmdb.org/t/p/'

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

async function searchTmdb(q: string, key: string): Promise<MetaResult[]> {
  const { query, init } = tmdbInit(key)
  const data = await request<{ results: TmdbItem[] }>(
    `https://api.themoviedb.org/3/search/multi?include_adult=false&query=${encodeURIComponent(q)}${query}`,
    init,
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
        synopsis: r.overview,
        genres: [],
        posterUrl: r.poster_path ? `${TMDB_IMG}w500${r.poster_path}` : null,
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

export function availableProviders(mediaType: MediaType): Provider[] {
  const hasTmdb = !!getPrefs().tmdbKey
  if (mediaType === 'anime') return ['kitsu']
  if (mediaType === 'movie') return hasTmdb ? ['tmdb', 'kitsu'] : ['kitsu']
  return hasTmdb ? ['tvmaze', 'tmdb'] : ['tvmaze']
}

export async function searchTitles(q: string, provider: Provider): Promise<MetaResult[]> {
  const query = q.trim()
  if (!query) return []
  if (provider === 'kitsu') return searchKitsu(query)
  if (provider === 'tvmaze') return searchTvMaze(query)
  const key = getPrefs().tmdbKey
  if (!key) throw new MetadataError('Add your TMDB API key in Settings to search TMDB.')
  return searchTmdb(query, key)
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

/** Try to download a poster so it works offline. Returns null if the host blocks it (CORS) or it fails. */
export async function downloadPoster(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return blob.type.startsWith('image/') ? blob : null
  } catch {
    return null
  }
}
