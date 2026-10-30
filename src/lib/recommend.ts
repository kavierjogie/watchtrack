/**
 * Local recommendation engine. Pure functions only: candidates come in (see discover.ts), ranked sections come out.
 * Deterministic and rule-based: the same library, feedback and pool always give the same order.
 *
 * Signals, all from data we actually have:
 *  - the library: status, rating (1–10, optional), genres (provider categories/genres, or what the user typed), year
 *  - provider relationships: Kitsu media relationships (sequel, side story…) and TMDB recommendations
 *  - provider community score and popularity
 *  - feedback: dismissed titles and "more like this" requests
 * Reasons only quote those signals ("Sequel to X", "Shares Crime and Drama with Y"). Genres are matched as labels;
 * nothing here claims to understand plot or themes beyond what a provider tagged.
 */
import { normTitle } from './backup'
import type { MetaResult } from './metadata'
import type { MediaType, Title, WatchStatus } from './types'

export interface Candidate extends MetaResult {
  /** Provider community score on 0–100 (Kitsu average rating, TVmaze/TMDB rating × 10). Null when unrated. */
  communityScore: number | null
  /** 0–1 popularity within its provider. Null when unknown. */
  popularity: number | null
  /**
   * Kitsu only: the entry this one continues — a "prequel" Kitsu lists that was released before it (Kitsu also calls
   * later-made prequel stories "prequel", hence the date check). null = Kitsu lists none, so it's a first entry or a
   * standalone; absent = no relationship data, so nothing is assumed either way.
   */
  earlier?: Candidate | null
}

/** A provider-stated relationship from a seed (library title or a "more like" request) to a candidate. */
export interface Link {
  key: string
  seedId: string
  role: string
}

export interface FeedbackItem {
  at: string
  title: string
  mediaType: MediaType
  genres: string[]
}

export interface Feedback {
  /** Never recommended again (until restored). Their genres count slightly against similar titles. */
  dismissed: Record<string, FeedbackItem>
  /** "More like this" requests: treated like a liked title. */
  liked: Record<string, FeedbackItem>
}

export const emptyFeedback = (): Feedback => ({ dismissed: {}, liked: {} })

export const candidateKey = (c: Pick<MetaResult, 'source'>) => `${c.source.provider}:${c.source.id}`

// ---------- Weights (one place, so the ranking stays explainable and easy to tune) ----------

/** How much a library title's status says about taste. Dropped counts against its genres. */
const STATUS_WEIGHT: Record<WatchStatus, number> = { completed: 3, watching: 1.5, on_hold: 1, plan: 0.5, dropped: -1.5 }
/** Ratings at or above this get the "you rated it N/10" wording and their own row. */
const TOP_RATING = 8
/** Weight of a "more like this" request, and how much a dismissal counts against its genres. */
const LIKED_WEIGHT = 2
const DISMISSED_WEIGHT = -0.5

/**
 * Score = Σ weight × factor. Each factor is 0–1 (genre affinity −1–1), so a weight is the most points that factor can
 * add. Listed strongest first.
 *  - related:    a provider-stated relationship to a title you watched (Kitsu sequel/side story, TMDB recommendation),
 *                × the role's strength (ROLE_STRENGTH) × how much that title counts (status and rating)
 *  - genre:      affinity with your genre profile as a whole (liked genres add, dropped / low-rated ones subtract)
 *  - similar:    Jaccard overlap of genres with your single closest title, × how much that title counts
 *  - quality:    community score, 6.0/10 → 0 up to 9.5/10 → 1
 *  - format:     share of your library in this format (anime / TV series / movie)
 *  - era:        release year within ~5 years of what you usually watch, fading to 0 by 20 years
 *  - popularity: provider popularity 0–1
 */
const W = { related: 3, genre: 3, similar: 2.5, quality: 1, format: 0.5, era: 0.5, popularity: 0.5 }

/** Every threshold the rules use. */
const TUNE = {
  /** Shared genre labels needed before two titles count as similar (one broad genre like "Drama" isn't enough). */
  minShared: 2,
  /** Jaccard overlap for a title to join a "Because you watched" / "More like" row. */
  similarRow: 0.3,
  /**
   * Genre similarity between anime and live-action/other titles is multiplied by this: "Drama, Action" says much
   * less across the two (a 0.5 overlap becomes 0.25, below similarRow; it takes 0.6+ to cross), so an anime's rows
   * stay mostly anime.
   */
  crossStyle: 0.5,
  /** Community score (0–100) mapped to the quality factor's 0 and 1. */
  qualityFloor: 60,
  qualityTop: 95,
  /** Years from your usual era that still count fully, and where the era factor reaches 0. */
  eraNear: 5,
  eraFar: 20,
  /** Hidden gems / less-mainstream picks: well rated, but in the lower part of a provider's popularity. */
  gemScore: 78,
  gemPopularity: 0.35,
  /** Slots in "Recommended for You" kept for less-mainstream picks that still score at least this share of the best. */
  nicheSlots: 3,
  nicheMinShare: 0.5,
}

/**
 * The highest score the factors can realistically add up to: a candidate gets either a relationship or genre
 * similarity as its main personal link, rarely both at full strength. Match % = score / this.
 */
const MAX_SCORE = Math.max(W.related, W.similar) + W.genre + W.quality + W.format + W.era + W.popularity

/** How strongly a relationship role suggests "watch this next". Roles not listed (summaries, cameos, ads) are ignored. */
export const ROLE_STRENGTH: Record<string, number> = {
  sequel: 1,
  'tmdb-recommended': 0.8,
  prequel: 0.7,
  parent_story: 0.7,
  full_story: 0.7,
  side_story: 0.5,
  spinoff: 0.5,
  alternative_setting: 0.4,
  alternative_version: 0.3,
}

const ROLE_REASON: Record<string, (t: string) => string> = {
  sequel: (t) => `Sequel to ${t}`,
  prequel: (t) => `Prequel to ${t}`,
  parent_story: (t) => `The main story behind ${t}`,
  full_story: (t) => `The full story behind ${t}`,
  side_story: (t) => `Side story of ${t}`,
  spinoff: (t) => `Spin-off of ${t}`,
  alternative_setting: (t) => `Set in the world of ${t}`,
  alternative_version: (t) => `Another version of ${t}`,
  'tmdb-recommended': (t) => `TMDB recommends it to fans of ${t}`,
}
const roleReason = (role: string, t: string) => (ROLE_REASON[role] ?? ((x: string) => `Related to ${x}`))(t)

/**
 * How much a library title says about taste. Completed and highly rated count most; a show barely started counts
 * little; a low rating or a drop counts against its genres.
 */
export function titleWeight(t: Title): number {
  let w = STATUS_WEIGHT[t.status]
  if (t.status === 'watching' && t.progress && (t.progress.season ?? 1) <= 1 && (t.progress.nextEpisode ?? 1) <= 3) w = 0.75
  if (t.status === 'dropped') return w
  // 10 → ×1.5, 8 → ×1, 6 → ×0.5, 4 or less → disliked. Unrated isn't a guess at a rating: it just counts a bit less
  // than a confirmed 8.
  return w * (t.rating == null ? 0.85 : (t.rating - 4) / 4)
}

// ---------- Genres ----------

const GENRE_ALIAS: Record<string, string> = { 'sci fi': 'science fiction', scifi: 'science fiction' }
/**
 * Labels that say nothing about taste: the media type itself, and Kitsu's setting/bookkeeping categories that most
 * anime carry ("Present", "Earth", "Japan"). They'd make "Shares Present and Japan with X" — true, but no reason.
 */
const NOT_TASTE = new Set(['anime', 'present', 'past', 'future', 'earth', 'japan', 'asia', 'plot continuity', 'stereotypes', 'other planet'])
export const isTasteGenre = (g: string) => !NOT_TASTE.has(normGenre(g))

export const normGenre = (g: string) => {
  const n = g.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return GENRE_ALIAS[n] ?? n
}

export const tasteGenres = (genres: string[]) => [...new Set(genres.map(normGenre))].filter((g) => g && !NOT_TASTE.has(g))

/**
 * Jaccard overlap of two normalised genre sets: shared / all distinct. Needs TUNE.minShared shared labels, so one
 * broad genre isn't "similar" — and unlike shared / smaller set, a title with two tags doesn't match everything.
 */
export function genreSimilarity(a: string[], b: string[]): { sim: number; shared: string[] } {
  const bs = new Set(b)
  const shared = a.filter((g) => bs.has(g))
  if (shared.length < TUNE.minShared) return { sim: 0, shared }
  return { sim: shared.length / new Set([...a, ...b]).size, shared }
}

/** Anime (including Kitsu's anime films) vs everything else. */
const styleOf = (mediaType: MediaType, provider?: string) => (mediaType === 'anime' || provider === 'kitsu' ? 'anime' : 'other')

/** genreSimilarity between a candidate and a seed, damped by TUNE.crossStyle across anime / other. */
function seedSimilarity(c: Pick<MetaResult, 'genres' | 'mediaType' | 'source'>, s: Seed): { sim: number; shared: string[] } {
  const { sim, shared } = genreSimilarity(tasteGenres(c.genres), s.genres)
  return { sim: styleOf(c.mediaType, c.source.provider) === styleOf(s.mediaType, s.source?.provider) ? sim : sim * TUNE.crossStyle, shared }
}

// ---------- Taste profile ----------

export interface Seed {
  id: string
  title: string
  mediaType: MediaType
  source: MetaResult['source'] | null
  genres: string[]
  weight: number
  year: number | null
  /** The user's own rating, when they gave one. */
  rating: number | null
  /** Library status; null for a "more like this" request. */
  status: WatchStatus | null
  /** From a "more like this" request rather than the library. */
  liked: boolean
}

export interface Profile {
  /** Normalised genre → affinity in [-1, 1], 1 = strongest liked genre. */
  genres: Map<string, number>
  /** Display label for a normalised genre. */
  labels: Map<string, string>
  /** Media types of the liked titles behind each genre, for "action anime" vs "action series". */
  genreTypes: Map<string, Set<MediaType>>
  /** Share (0–1) of the positive library weight in each format. Empty without history. */
  formats: Map<MediaType, number>
  /** Weighted median release year of liked titles, when at least three have a year. */
  era: number | null
  /** Positively weighted titles, strongest first. */
  seeds: Seed[]
}

const seedOf = (t: Title, weight = titleWeight(t)): Seed => ({
  id: t.id,
  title: t.title,
  mediaType: t.mediaType,
  source: t.source,
  genres: tasteGenres(t.genres),
  weight,
  year: t.year,
  rating: t.rating,
  status: t.status,
  liked: false,
})

export function buildProfile(library: Title[], feedback: Feedback): Profile {
  const raw = new Map<string, number>()
  const labels = new Map<string, string>()
  const genreTypes = new Map<string, Set<MediaType>>()
  const formatRaw = new Map<MediaType, number>()
  const seeds: Seed[] = []

  const add = (genres: string[], w: number, type: MediaType) => {
    const gs = tasteGenres(genres)
    for (const label of genres) if (!labels.has(normGenre(label))) labels.set(normGenre(label), label)
    // Titles with many tags (Kitsu has 5–10 categories) shouldn't outweigh ones with three.
    for (const g of gs) {
      raw.set(g, (raw.get(g) ?? 0) + w / Math.sqrt(gs.length))
      if (w > 0) genreTypes.set(g, (genreTypes.get(g) ?? new Set()).add(type))
    }
    if (w > 0) formatRaw.set(type, (formatRaw.get(type) ?? 0) + w)
  }

  for (const t of library) {
    const w = titleWeight(t)
    add(t.genres, w, t.mediaType)
    if (w > 0) seeds.push(seedOf(t, w))
  }
  for (const [key, f] of Object.entries(feedback.liked)) {
    add(f.genres, LIKED_WEIGHT, f.mediaType)
    seeds.push({ id: `liked:${key}`, title: f.title, mediaType: f.mediaType, source: sourceOfKey(key), genres: tasteGenres(f.genres), weight: LIKED_WEIGHT, year: null, rating: null, status: null, liked: true })
  }
  for (const f of Object.values(feedback.dismissed)) add(f.genres, DISMISSED_WEIGHT, f.mediaType)

  const max = Math.max(0, ...raw.values())
  const genres = new Map([...raw].map(([g, v]) => [g, max > 0 ? Math.max(-1, Math.min(1, v / max)) : 0]))
  const formatTotal = [...formatRaw.values()].reduce((a, b) => a + b, 0)
  const formats = new Map([...formatRaw].map(([t, v]) => [t, v / formatTotal]))
  seeds.sort((a, b) => b.weight - a.weight)
  return { genres, labels, genreTypes, formats, era: weightedMedianYear(seeds), seeds }
}

function weightedMedianYear(seeds: Seed[]): number | null {
  const dated = seeds.filter((s) => s.year != null).sort((a, b) => a.year! - b.year!)
  if (dated.length < 3) return null
  const half = dated.reduce((s, x) => s + x.weight, 0) / 2
  let acc = 0
  for (const s of dated) if ((acc += s.weight) >= half) return s.year
  return null
}

function sourceOfKey(key: string): MetaResult['source'] | null {
  const m = /^(kitsu|tvmaze|tmdb):(.+)$/.exec(key)
  return m ? { provider: m[1] as 'kitsu' | 'tvmaze' | 'tmdb', id: m[2], url: '' } : null
}

/** Strongest liked genres, for the "based on" summary. */
export const topGenres = (p: Profile, n = 3) =>
  [...p.genres]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([g]) => p.labels.get(g) ?? g)

// ---------- Library matching ----------

const namesOf = (t: { title: string; altTitles: string[] }) => [t.title, ...t.altTitles].map(normTitle).filter(Boolean)
/**
 * Providers disagree on whether an anime series is "anime" or "TV" (TMDB/TVmaze only call it anime when it's Japanese
 * animation), so series match each other by name; movies only match movies.
 */
const family = (m: MediaType) => (m === 'movie' ? 'movie' : 'series')

export interface LibraryIndex {
  bySource: Map<string, Title>
  byName: Map<string, Title>
}

export function indexLibrary(library: Title[]): LibraryIndex {
  const bySource = new Map<string, Title>()
  const byName = new Map<string, Title>()
  for (const t of library) {
    if (t.source) bySource.set(`${t.source.provider}:${t.source.id}`, t)
    for (const n of namesOf(t)) byName.set(`${family(t.mediaType)}:${n}`, t)
  }
  return { bySource, byName }
}

/** The library title this candidate already is: same provider id, or the same name and format. */
export function findTracked(c: Pick<MetaResult, 'source' | 'title' | 'altTitles' | 'mediaType'>, idx: LibraryIndex): Title | undefined {
  return idx.bySource.get(candidateKey(c)) ?? namesOf(c).map((n) => idx.byName.get(`${family(c.mediaType)}:${n}`)).find(Boolean)
}

/**
 * One entry per title: same provider id, or the same name and format within a year of each other (providers date
 * the same release a few months apart). First one wins, so list the richer source first.
 */
export function dedupe<T extends MetaResult>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const c of list) {
    const names = namesOf(c).map((n) => `${family(c.mediaType)}:${n}`)
    const y = c.year
    const check = [candidateKey(c), ...names.flatMap((n) => (y == null ? [`${n}:`] : [`${n}:${y - 1}`, `${n}:${y}`, `${n}:${y + 1}`]))]
    if (check.some((k) => seen.has(k))) continue
    ;[candidateKey(c), ...names.map((n) => `${n}:${y ?? ''}`)].forEach((k) => seen.add(k))
    out.push(c)
  }
  return out
}

/**
 * Which entry of a series to suggest, from Kitsu's relationship data only. A later season is skipped when an entry
 * before it is in the library (alerts and Upcoming announce new seasons of those), and otherwise swapped
 * for the earliest entry the pool can vouch for (nobody should start at season 3). An earlier entry known only by
 * reference can't be confirmed as the start (it may have its own prequel), so the later season is skipped instead.
 * Titles without relationship data, and standalones, pass through unchanged. Returns null to skip.
 */
export function entryPoint(c: Candidate, byKey: Map<string, Candidate>, idx: LibraryIndex): Candidate | null {
  let cur = c
  for (let hop = 0; hop < 6 && cur.earlier; hop++) {
    if (findTracked(cur.earlier, idx)) return null
    const prev = byKey.get(candidateKey(cur.earlier))
    if (!prev) return null
    cur = prev
  }
  return cur.earlier ? null : cur
}

/** Enough to show and judge: a real title, artwork, and genres or a provider relationship to rank it by. */
const isUsable = (c: Candidate, linked: Set<string>) =>
  !!c.title.trim() && c.title !== 'Untitled' && !!(c.posterUrl || c.thumbUrl) && (c.genres.length > 0 || linked.has(candidateKey(c)))

// ---------- Scoring ----------

export type ReasonKind = 'related' | 'similar' | 'genre' | 'liked' | 'quality' | 'popular'

/** One scoring factor that contributed, in words, with the points it added (negative = counted against). */
export interface Factor {
  label: string
  points: number
}

export interface Rec {
  c: Candidate
  key: string
  score: number
  /** score as 0–100 of what the factors can add up to. A relevance score for sorting, not a probability. */
  match: number
  reason: string
  kind: ReasonKind
  /** Seed behind a related/similar reason. */
  seedId: string | null
  /** The factors behind the score, biggest first. */
  factors: Factor[]
  /** Attributes shared with the title a "More like" / "Similar" row is about (genres, format, decade, relationship). */
  shared?: string[]
  tracked?: Title
}

const MEDIA_NOUN: Record<MediaType, string> = { anime: 'anime', tv: 'series', movie: 'movies' }
const FORMAT_LABEL: Record<MediaType, string> = { anime: 'Anime', tv: 'TV series', movie: 'Movie' }
const PROVIDER_NAME: Record<string, string> = { kitsu: 'Kitsu', tvmaze: 'TVmaze', tmdb: 'TMDB', anilist: 'AniList' }

const joinAnd = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''))
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const labelOf = (p: Profile, g: string) => p.labels.get(g) ?? g

/** "Similar to X, which you rated 9/10" when the user rated it highly, else the shared genres. */
const similarReason = (s: Seed, shared: string[], p: Profile) =>
  s.liked
    ? `More like ${s.title}, as you asked`
    : s.rating != null && s.rating >= TOP_RATING
      ? `Similar to ${s.title}, which you rated ${s.rating}/10`
      : `Shares ${joinAnd(shared.slice(0, 2).map((g) => labelOf(p, g)))} with ${s.title}`

export function scoreCandidate(c: Candidate, profile: Profile, links: Link[]): Omit<Rec, 'tracked'> {
  const key = candidateKey(c)
  const gs = tasteGenres(c.genres)
  const provider = PROVIDER_NAME[c.source.provider]

  // Genre affinity: liked genres add, disliked ones subtract.
  const genreMatch = gs.length ? Math.max(-1, Math.min(1, gs.reduce((s, g) => s + (profile.genres.get(g) ?? 0), 0) / Math.sqrt(gs.length))) : 0

  // Closest seed by shared genres, scaled by how much that seed counts (a completed 9/10 > a planned title).
  let similar = { v: 0, seed: null as Seed | null, shared: [] as string[] }
  for (const s of profile.seeds) {
    const { sim, shared } = seedSimilarity(c, s)
    const v = sim * Math.min(1, s.weight / 3)
    if (v > similar.v) similar = { v, seed: s, shared }
  }

  // Strongest provider-stated relationship to a seed.
  let related = { v: 0, seed: null as Seed | null, role: '' }
  for (const l of links) {
    if (l.key !== key) continue
    const seed = profile.seeds.find((s) => s.id === l.seedId)
    const v = seed ? (ROLE_STRENGTH[l.role] ?? 0) * Math.min(1, seed.weight / 3) : 0
    if (v > related.v) related = { v, seed: seed!, role: l.role }
  }

  const quality = c.communityScore == null ? 0 : clamp01((c.communityScore - TUNE.qualityFloor) / (TUNE.qualityTop - TUNE.qualityFloor))
  const popularity = c.popularity ?? 0
  const format = profile.formats.get(c.mediaType) ?? 0
  const era = profile.era == null || c.year == null ? 0 : clamp01(1 - (Math.abs(c.year - profile.era) - TUNE.eraNear) / (TUNE.eraFar - TUNE.eraNear))
  const parts = {
    related: W.related * related.v,
    genre: W.genre * genreMatch,
    similar: W.similar * similar.v,
    quality: W.quality * quality,
    format: W.format * format,
    era: W.era * era,
    popularity: W.popularity * popularity,
  }
  const score = Object.values(parts).reduce((a, b) => a + b, 0)

  // Each factor in words, from the same numbers that made the score.
  const liked = gs.filter((g) => (profile.genres.get(g) ?? 0) > 0.25).sort((a, b) => profile.genres.get(b)! - profile.genres.get(a)!)
  const disliked = gs.filter((g) => (profile.genres.get(g) ?? 0) < 0)
  const factors: Factor[] = []
  const add = (points: number, label: string) => Math.abs(points) >= 0.05 && factors.push({ label, points: Math.round(points * 10) / 10 })
  if (related.seed) add(parts.related, `${roleReason(related.role, related.seed.title)} (${related.role === 'tmdb-recommended' ? 'TMDB' : 'Kitsu'})`)
  if (parts.genre > 0 && liked.length) add(parts.genre, `Fits genres you watch most: ${joinAnd(liked.slice(0, 3).map((g) => labelOf(profile, g)))}`)
  else if (parts.genre < 0) add(parts.genre, `Has genres you dropped, rated low or dismissed: ${joinAnd(disliked.slice(0, 3).map((g) => labelOf(profile, g)))}`)
  if (similar.seed) add(parts.similar, `Shares ${joinAnd(similar.shared.slice(0, 3).map((g) => labelOf(profile, g)))} with ${similar.seed.title}`)
  if (c.communityScore != null) add(parts.quality, `Rated ${(c.communityScore / 10).toFixed(1)}/10 on ${provider}`)
  add(parts.format, `${FORMAT_LABEL[c.mediaType]}, ${Math.round(format * 100)}% of what you watch`)
  if (profile.era != null && c.year != null) add(parts.era, `From ${c.year}, near the years you usually watch (around ${profile.era})`)
  add(parts.popularity, popularity >= 0.6 ? `Widely watched on ${provider}` : `Some following on ${provider}`)
  factors.sort((a, b) => b.points - a.points)

  // The reason is the largest personal contribution; generic quality/popularity only when nothing personal applies.
  const base = { c, key, score, match: Math.round(100 * clamp01(score / MAX_SCORE)), factors }
  if (related.seed && parts.related >= parts.similar && parts.related >= Math.max(0.5, parts.genre))
    return { ...base, kind: 'related', seedId: related.seed.id, reason: roleReason(related.role, related.seed.title) }
  if (similar.seed && parts.similar >= Math.max(0.6, parts.genre * 0.6))
    return { ...base, kind: similar.seed.liked ? 'liked' : 'similar', seedId: similar.seed.id, reason: similarReason(similar.seed, similar.shared, profile) }
  if (liked.length && parts.genre >= 0.6) {
    const top = liked.slice(0, 2)
    const noun = top.every((g) => profile.genreTypes.get(g)?.has(c.mediaType)) ? MEDIA_NOUN[c.mediaType] : 'titles'
    return { ...base, kind: 'genre', seedId: null, reason: `Because you enjoyed ${joinAnd(top.map((g) => labelOf(profile, g).toLowerCase()))} ${noun}` }
  }
  if (c.communityScore != null && c.communityScore >= 75)
    return { ...base, kind: 'quality', seedId: null, reason: `Highly rated on ${provider} (${(c.communityScore / 10).toFixed(1)}/10)` }
  return { ...base, kind: 'popular', seedId: null, reason: `Popular on ${provider}` }
}

/** Personal = based on the user's library or feedback; the rest are general popular/well-rated picks. */
export const isPersonal = (r: Pick<Rec, 'kind'>) => r.kind !== 'popular' && r.kind !== 'quality'

// ---------- Ordering ----------

/** FNV-1a: a stable, evenly spread number for a string, so ties don't depend on which provider answered first. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}
const tie = (salt: number) => (a: Rec, b: Rec) => hash(`${salt}:${a.key}`) - hash(`${salt}:${b.key}`)

export type SortKey = 'match' | 'popular' | 'rating' | 'newest'

const SORTS: Record<SortKey, (a: Rec, b: Rec) => number> = {
  match: (a, b) => b.score - a.score,
  popular: (a, b) => (b.c.popularity ?? -1) - (a.c.popularity ?? -1) || b.score - a.score,
  rating: (a, b) => (b.c.communityScore ?? -1) - (a.c.communityScore ?? -1) || b.score - a.score,
  newest: (a, b) => (b.c.year ?? 0) - (a.c.year ?? 0) || b.score - a.score,
}

// ---------- Pool → scored recs ----------

/**
 * Every usable candidate scored, best first: earlier entries swapped in for later seasons, one entry per title
 * across providers, dismissed and unusable ones out. Tracked titles stay in, flagged, for callers to drop or keep.
 */
function scorePool(pool: Candidate[], links: Link[], library: Title[], feedback: Feedback, profile: Profile, salt: number): Rec[] {
  const idx = indexLibrary(library)
  const ids = new Set(library.map((t) => t.id))
  // The next season of a library title isn't a recommendation; related lists carry no `earlier` for entryPoint to see.
  const sequels = new Set(links.filter((l) => l.role === 'sequel' && ids.has(l.seedId)).map((l) => l.key))
  const usable = links.filter((l) => l.role !== 'sequel')
  const linked = new Set(usable.map((l) => l.key))
  const byKey = new Map(pool.map((c) => [candidateKey(c), c]))
  const entries = pool.flatMap((c) => entryPoint(c, byKey, idx) ?? [])

  const out: Rec[] = []
  for (const c of dedupe(entries)) {
    const key = candidateKey(c)
    if (feedback.dismissed[key] || sequels.has(key) || !isUsable(c, linked)) continue
    out.push({ ...scoreCandidate(c, profile, usable), tracked: findTracked(c, idx) })
  }
  return out.sort((a, b) => SORTS.match(a, b) || tie(salt)(a, b))
}

/**
 * Titles like one seed, ordered by relationship strength (ROLE_STRENGTH) plus Jaccard genre overlap, so a strong
 * genre match can outrank a loose "same world" link. Each lists what it shares (relationship, genres, format, decade).
 * The seed itself is never included.
 */
function similarMatches(focus: Seed, recs: Rec[], links: Link[], profile: Profile): Rec[] {
  const roles = new Map(links.filter((l) => l.seedId === focus.id && ROLE_STRENGTH[l.role]).map((l) => [l.key, l.role]))
  const self = new Set([focus.id.replace(/^liked:/, ''), focus.source ? candidateKey({ source: focus.source }) : ''])
  const decade = (y: number | null) => (y == null ? null : Math.floor(y / 10) * 10)
  return recs
    .flatMap((r) => {
      if (r.tracked?.id === focus.id || self.has(r.key)) return []
      const role = roles.get(r.key)
      const { sim, shared } = seedSimilarity(r.c, focus)
      if (!role && sim < TUNE.similarRow) return []
      const attrs = [
        ...(role ? [roleReason(role, focus.title)] : []),
        ...shared.slice(0, 4).map((g) => labelOf(profile, g)),
        ...(r.c.mediaType === focus.mediaType ? [FORMAT_LABEL[r.c.mediaType]] : []),
        ...(decade(r.c.year) != null && decade(r.c.year) === decade(focus.year) ? [`${decade(r.c.year)}s`] : []),
      ]
      const reason = role ? roleReason(role, focus.title) : similarReason({ ...focus, liked: false }, shared, profile)
      return [{ r: { ...r, reason, shared: attrs }, near: (role ? ROLE_STRENGTH[role] : 0) + sim }]
    })
    .sort((a, b) => b.near - a.near || b.r.score - a.r.score)
    .map((x) => x.r)
}

// ---------- Sections ----------

export interface DiscoverOptions {
  type: MediaType | 'all'
  /** Normalised genre, '' = any. */
  genre: string
  sort: SortKey
  /** Show "More like" this seed: a library title id or `liked:<key>`. */
  focus?: string | null
  /** Tracked titles to keep showing (added during this visit), so their card can say "In your library". */
  keep?: Set<string>
  /** Refresh count: reshuffles exact ties so "another set" can differ even from the same pool. */
  round?: number
}

export interface DiscoverSection {
  id: string
  title: string
  subtitle?: string
  /** General discovery picks, not based on the library. */
  general?: boolean
  recs: Rec[]
}

const SIZE = { forYou: 12, because: 8, topRated: 12, gems: 12, type: 18, focus: 18, similar: 12 }
const MIN_SECTION = 3
const MAX_PER_SEED = 3

export function buildDiscover(pool: Candidate[], links: Link[], library: Title[], feedback: Feedback, opts: DiscoverOptions) {
  const profile = buildProfile(library, feedback)
  const salt = opts.round ?? 0
  // Personal only when the library says something a candidate can match: liked genres or a provider relationship.
  const personal = [...profile.genres.values()].some((v) => v > 0) || links.some((l) => profile.seeds.some((s) => s.id === l.seedId))

  const all = scorePool(pool, links, library, feedback, profile, salt).filter(
    (r) => (opts.type === 'all' || r.c.mediaType === opts.type) && (!opts.genre || r.c.genres.some((g) => normGenre(g) === opts.genre)),
  )

  // Ordinary sections skip tracked titles, except ones added during this visit so their card can show the new state.
  const open = all.filter((r) => !r.tracked || opts.keep?.has(r.key))
  const used = new Set<string>()
  const take = (list: Rec[], n: number, ok: (r: Rec) => boolean = () => true) => {
    const out: Rec[] = []
    for (const r of list) {
      if (out.length >= n) break
      if (used.has(r.key) || !ok(r)) continue
      used.add(r.key)
      out.push(r)
    }
    return out
  }
  const sections: DiscoverSection[] = []
  const push = (s: DiscoverSection, min = MIN_SECTION) => {
    if (s.recs.length >= min) sections.push({ ...s, recs: [...s.recs].sort((a, b) => SORTS[opts.sort](a, b) || tie(salt)(a, b)) })
    else s.recs.forEach((r) => used.delete(r.key)) // too thin to show: free its titles for later sections
  }
  const near = (r: Rec, s: Seed) => links.some((l) => l.key === r.key && l.seedId === s.id) || seedSimilarity(r.c, s).sim >= TUNE.similarRow
  const reasonUnder = (r: Rec, s: Seed) => (r.seedId === s.id ? r : (similarMatches(s, [r], links, profile)[0] ?? r))

  // "More like X": related or genre-similar to that one title. Tracked titles stay in, flagged, since the user asked.
  const focusTitle = opts.focus ? library.find((t) => t.id === opts.focus) : undefined
  const focus = profile.seeds.find((s) => s.id === opts.focus) ?? (focusTitle && seedOf(focusTitle, 3))
  if (focus)
    sections.push({ id: 'focus', title: `More like ${focus.title}`, subtitle: 'Related titles and shared genres from the providers.', recs: take(similarMatches(focus, all, links, profile), SIZE.focus) })

  if (personal) {
    // Relevance first, a few per seed so one title doesn't fill the row, and a few slots for less-mainstream picks
    // that still score well, so the row isn't all blockbusters.
    const perSeed = new Map<string, number>()
    const fits = (r: Rec) => {
      if (!isPersonal(r)) return false
      if (!r.seedId) return true
      const n = perSeed.get(r.seedId) ?? 0
      if (n >= MAX_PER_SEED) return false
      perSeed.set(r.seedId, n + 1)
      return true
    }
    const best = open.find(isPersonal)?.score ?? 0
    const niche = (r: Rec) => r.c.popularity != null && r.c.popularity <= TUNE.gemPopularity && r.score >= best * TUNE.nicheMinShare
    const head = take(open, SIZE.forYou - TUNE.nicheSlots, fits)
    const gems = take(open, TUNE.nicheSlots, (r) => niche(r) && fits(r))
    push({ id: 'for-you', title: 'Recommended for You', subtitle: 'Your best matches, with a few less-mainstream picks.', recs: [...head, ...gems, ...take(open, SIZE.forYou - head.length - gems.length, fits)] })

    // "Because you watched": the strongest completed or loved library titles that actually have matches.
    let becauseCount = 0
    for (const s of profile.seeds) {
      if (becauseCount >= 2 || s.liked || s.weight < 2) continue
      const recs = take(open, SIZE.because, (r) => near(r, s))
      if (recs.length >= MIN_SECTION) becauseCount++
      push({ id: `because:${s.id}`, title: `Because You Watched ${s.title}`, recs: recs.map((r) => reasonUnder(r, s)) })
    }

    const top = profile.seeds.filter((s) => s.rating != null && s.rating >= TOP_RATING)
    if (top.length) {
      const nearTop = (r: Rec) => top.find((s) => near(r, s))
      const recs = take(open, SIZE.topRated, (r) => !!nearTop(r)).map((r) => reasonUnder(r, nearTop(r)!))
      push({ id: 'top-rated', title: 'More Like Your Top Rated', subtitle: `Close to titles you rated ${TOP_RATING}+ out of 10.`, recs })
    }
  }

  // Claimed before the type sections so they don't swallow every gem; shown last.
  push({
    id: 'gems',
    title: 'Hidden Gems',
    subtitle: personal ? 'Well rated, less widely watched, and not against your taste.' : 'Well rated, but less widely watched. General picks, not based on your library.',
    general: !personal,
    recs: take(open, SIZE.gems, (r) => (r.c.communityScore ?? 0) >= TUNE.gemScore && r.c.popularity != null && r.c.popularity <= TUNE.gemPopularity && r.score > 0),
  })
  // Without history there's nothing personal to rank by: lead with popular, well-liked titles.
  const general = (r: Rec) => (r.c.popularity ?? 0) * 2 + (r.c.communityScore ?? 0) / 50
  const typeList = personal ? open : [...open].sort((a, b) => general(b) - general(a) || tie(salt)(a, b))
  for (const [type, title] of [['anime', 'Discover Anime'], ['tv', 'Discover TV Series'], ['movie', 'Discover Movies']] as const)
    push(
      { id: type, title, general: !personal, subtitle: personal ? undefined : 'General picks: popular and well rated, not based on your library.', recs: take(typeList, SIZE.type, (r) => r.c.mediaType === type && r.score > -1) },
      1,
    )

  const order = ['focus', 'for-you', 'because', 'top-rated', 'anime', 'tv', 'movie', 'gems']
  sections.sort((a, b) => order.indexOf(a.id.split(':')[0]) - order.indexOf(b.id.split(':')[0]))
  return { sections, profile, personal, total: all.length }
}

/** "Similar titles" for one library title (its details page): never tracked titles, except ones kept this visit. */
export function buildSimilar(pool: Candidate[], links: Link[], library: Title[], feedback: Feedback, titleId: string, keep?: Set<string>): Rec[] {
  const t = library.find((x) => x.id === titleId)
  if (!t) return []
  const profile = buildProfile(library, feedback)
  const all = scorePool(pool, links, library, feedback, profile, 0)
  return similarMatches(seedOf(t, 3), all, links, profile)
    .filter((r) => !r.tracked || keep?.has(r.key))
    .slice(0, SIZE.similar)
}
