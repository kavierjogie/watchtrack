export type MediaType = 'anime' | 'tv' | 'movie'
export type WatchStatus = 'watching' | 'on_hold' | 'plan' | 'completed' | 'dropped'

/**
 * seasonal: Season N, Episode M (Spy x Family, Supergirl)
 * absolute: one running episode number (Black Clover ep 173)
 */
export type Numbering = 'seasonal' | 'absolute'

export interface SkipRange {
  /** null for absolute-numbered titles */
  season: number | null
  from: number
  to: number
}

/**
 * The single source of truth for a series' position is `season` + `nextEpisode`.
 * "Last watched" is always derived from it (see lastWatched() in progress.ts),
 * so the two can never disagree.
 */
export interface Progress {
  numbering: Numbering
  /** Current season. Always null for absolute numbering. */
  season: number | null
  /** Next episode to watch. null = position unknown (e.g. imported "S4" with no episode). */
  nextEpisode: number | null
  /** Known episode counts per season, keyed by season number (seasonal only). */
  seasonEpisodeCounts: Record<number, number>
  /** Total seasons if known. Unknown = never auto-advance past a finished season. */
  totalSeasons: number | null
  /** Total episodes if known (absolute numbering). */
  totalEpisodes: number | null
  skipped: SkipRange[]
  rewatching: boolean
}

export type Poster =
  | { kind: 'local'; imageId: string }
  | { kind: 'remote'; url: string }

export interface MetadataSource {
  provider: 'anilist' | 'tvmaze' | 'tmdb'
  id: string
  url: string
}

export interface Title {
  id: string
  title: string
  altTitles: string[]
  mediaType: MediaType
  synopsis: string
  year: number | null
  genres: string[]
  tags: string[]
  status: WatchStatus
  /** 1–10, null = unrated */
  rating: number | null
  notes: string
  poster: Poster | null
  backdropUrl: string | null
  /** null for movies */
  progress: Progress | null
  /** Movies: ISO date the movie was watched */
  watchedDate: string | null
  source: MetadataSource | null
  /** Original line from an imported notes list, kept verbatim. */
  importNote: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  /** Last time an episode/movie was logged as watched */
  lastWatchedAt: string | null
}

export type HistoryKind = 'episode' | 'special' | 'movie' | 'correction' | 'status'

export interface Snapshot {
  progress: Progress | null
  status: WatchStatus
  completedAt: string | null
  lastWatchedAt: string | null
  watchedDate: string | null
}

export interface HistoryEntry {
  id: string
  titleId: string
  at: string
  kind: HistoryKind
  season: number | null
  episode: number | null
  label: string | null
  /** State before this change, used for undo. */
  before: Snapshot | null
}

export interface StoredImage {
  id: string
  blob: Blob
  type: string
  createdAt: string
}

export const MEDIA_LABEL: Record<MediaType, string> = {
  anime: 'Anime',
  tv: 'TV Series',
  movie: 'Movie',
}

export const STATUS_LABEL: Record<WatchStatus, string> = {
  watching: 'Watching',
  on_hold: 'On Hold',
  plan: 'Plan to Watch',
  completed: 'Completed',
  dropped: 'Dropped',
}
