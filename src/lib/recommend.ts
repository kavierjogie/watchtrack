/**
 * Local recommendation engine. Pure functions only: candidates come in (see discover.ts), ranked sections come out.
 *
 * Signals, all from data we actually have:
 *  - the library: status, rating, genres (provider categories/genres, or what the user typed)
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

// ---------- Weights (one place, so the ranking stays explainable) ----------

export const STATUS_WEIGHT: Record<WatchStatus, number> = { completed: 3, watching: 1.5, on_hold: 1, plan: 0.5, dropped: -1.5 }
/** Ratings at or above this make a title a "favourite" (the library has no separate favourite flag). */
export const FAVOURITE_RATING = 8
/** Weight of a "more like this" request, and how much a dismissal counts against its genres. */
export const LIKED_WEIGHT = 2
export const DISMISSED_WEIGHT = -0.5

export const W = { genre: 3, similar: 2.5, related: 3, quality: 1, popularity: 0.5 }

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

/**
 * How much a library title says about taste. Completed and highly rated count most; a show barely started counts
 * little; a low rating or a drop counts against its genres.
 */
export function titleWeight(t: Title): number {
  let w = STATUS_WEIGHT[t.status]
  if (t.status === 'watching' && t.progress && (t.progress.season ?? 1) <= 1 && (t.progress.nextEpisode ?? 1) <= 3) w = 0.75
  if (t.status === 'dropped') return w
  // 10 → ×1.5, 8 → ×1, 6 → ×0.5, 4 or less → disliked. Unrated sits just under a solid 8.
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

const tasteGenres = (genres: string[]) => [...new Set(genres.map(normGenre))].filter((g) => g && !NOT_TASTE.has(g))

/** Overlap of two genre sets: shared / smaller set. Needs 2+ shared labels so one broad genre ("Drama") isn't "similar". */
export function genreSimilarity(a: string[], b: string[]): { sim: number; shared: string[] } {
  const bs = new Set(b)
  const shared = a.filter((g) => bs.has(g))
  if (shared.length < 2) return { sim: 0, shared }
  return { sim: shared.length / Math.min(a.length, b.length), shared }
}

// ---------- Taste profile ----------

export interface Seed {
  id: string
  title: string
  mediaType: MediaType
  source: MetaResult['source'] | null
  genres: string[]
  weight: number
  favourite: boolean
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
  /** Positively weighted titles, strongest first. */
  seeds: Seed[]
}

export function buildProfile(library: Title[], feedback: Feedback): Profile {
  const raw = new Map<string, number>()
  const labels = new Map<string, string>()
  const genreTypes = new Map<string, Set<MediaType>>()
  const seeds: Seed[] = []

  const add = (genres: string[], w: number, type: MediaType) => {
    const gs = tasteGenres(genres)
    for (const label of genres) if (!labels.has(normGenre(label))) labels.set(normGenre(label), label)
    // Titles with many tags (Kitsu has 5–10 categories) shouldn't outweigh ones with three.
    for (const g of gs) {
      raw.set(g, (raw.get(g) ?? 0) + w / Math.sqrt(gs.length))
      if (w > 0) genreTypes.set(g, (genreTypes.get(g) ?? new Set()).add(type))
    }
  }

  for (const t of library) {
    const w = titleWeight(t)
    add(t.genres, w, t.mediaType)
    if (w > 0)
      seeds.push({ id: t.id, title: t.title, mediaType: t.mediaType, source: t.source, genres: tasteGenres(t.genres), weight: w, favourite: (t.rating ?? 0) >= FAVOURITE_RATING, liked: false })
  }
  for (const [key, f] of Object.entries(feedback.liked)) {
    add(f.genres, LIKED_WEIGHT, f.mediaType)
    seeds.push({ id: `liked:${key}`, title: f.title, mediaType: f.mediaType, source: sourceOfKey(key), genres: tasteGenres(f.genres), weight: LIKED_WEIGHT, favourite: false, liked: true })
  }
  for (const f of Object.values(feedback.dismissed)) add(f.genres, DISMISSED_WEIGHT, f.mediaType)

  const max = Math.max(0, ...raw.values())
  const genres = new Map([...raw].map(([g, v]) => [g, max > 0 ? Math.max(-1, Math.min(1, v / max)) : 0]))
  seeds.sort((a, b) => b.weight - a.weight)
  return { genres, labels, genreTypes, seeds }
}

export function sourceOfKey(key: string): MetaResult['source'] | null {
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

export interface LibraryIndex {
  bySource: Map<string, Title>
  byName: Map<string, Title>
}

export function indexLibrary(library: Title[]): LibraryIndex {
  const bySource = new Map<string, Title>()
  const byName = new Map<string, Title>()
  for (const t of library) {
    if (t.source) bySource.set(`${t.source.provider}:${t.source.id}`, t)
    for (const n of namesOf(t)) byName.set(`${t.mediaType}:${n}`, t)
  }
  return { bySource, byName }
}

/** The library title this candidate already is: same provider id, or the same name and type. */
export function findTracked(c: Pick<MetaResult, 'source' | 'title' | 'altTitles' | 'mediaType'>, idx: LibraryIndex): Title | undefined {
  return idx.bySource.get(candidateKey(c)) ?? namesOf(c).map((n) => idx.byName.get(`${c.mediaType}:${n}`)).find(Boolean)
}

/** One entry per title: same provider id, or same type + name + year from another provider. First one wins. */
export function dedupe<T extends MetaResult>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const c of list) {
    const keys = [candidateKey(c), ...namesOf(c).map((n) => `${c.mediaType}:${n}:${c.year ?? ''}`)]
    if (keys.some((k) => seen.has(k))) continue
    keys.forEach((k) => seen.add(k))
    out.push(c)
  }
  return out
}

/**
 * Later seasons/parts look like separate titles in Kitsu lists. Without a relationship to the user's library they're
 * poor picks (nobody starts at season 3). ponytail: name heuristic; swap for Kitsu relationship lookups if it misfires.
 */
export const looksLikeSequel = (title: string) =>
  /\b(season|part|cour)\s*([2-9]|\d{2})\b|\b(2nd|3rd|[4-9]th|second|third|fourth|fifth|final)\s+(season|part)\b|\brecap\b|\b(s|season )\d+\s*$|[!?.]\s+[2-9]$/i.test(title)

// ---------- Scoring ----------

export type ReasonKind = 'related' | 'similar' | 'genre' | 'liked' | 'quality' | 'popular'

export interface Rec {
  c: Candidate
  key: string
  score: number
  reason: string
  kind: ReasonKind
  /** Seed behind a related/similar reason. */
  seedId: string | null
  tracked?: Title
}

const MEDIA_NOUN: Record<MediaType, string> = { anime: 'anime', tv: 'series', movie: 'movies' }
const PROVIDER_NAME: Record<string, string> = { kitsu: 'Kitsu', tvmaze: 'TVmaze', tmdb: 'TMDB', anilist: 'AniList' }

const joinAnd = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''))

export function scoreCandidate(c: Candidate, profile: Profile, links: Link[]): Omit<Rec, 'tracked'> {
  const key = candidateKey(c)
  const gs = tasteGenres(c.genres)

  // Genre affinity: liked genres add, disliked ones subtract.
  const genreMatch = gs.length ? Math.max(-1, Math.min(1, gs.reduce((s, g) => s + (profile.genres.get(g) ?? 0), 0) / Math.sqrt(gs.length))) : 0

  // Closest seed by shared genres, scaled by how much that seed counts (a completed favourite > a planned title).
  let similar = { v: 0, seed: null as Seed | null, shared: [] as string[] }
  for (const s of profile.seeds) {
    const { sim, shared } = genreSimilarity(gs, s.genres)
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

  const quality = c.communityScore == null ? 0 : Math.max(0, Math.min(1, (c.communityScore - 60) / 35))
  const popularity = c.popularity ?? 0
  const parts = { genre: W.genre * genreMatch, similar: W.similar * similar.v, related: W.related * related.v, quality: W.quality * quality, popularity: W.popularity * popularity }
  const score = parts.genre + parts.similar + parts.related + parts.quality + parts.popularity

  // The reason is the largest personal contribution; generic quality/popularity only when nothing personal applies.
  const base = { c, key, score }
  if (related.seed && parts.related >= parts.similar && parts.related >= Math.max(0.5, parts.genre))
    return { ...base, kind: 'related', seedId: related.seed.id, reason: (ROLE_REASON[related.role] ?? ((t: string) => `Related to ${t}`))(related.seed.title) }
  if (similar.seed && parts.similar >= Math.max(0.6, parts.genre * 0.6)) {
    const s = similar.seed
    const shared = joinAnd(similar.shared.slice(0, 2).map((g) => profile.labels.get(g) ?? g))
    return {
      ...base,
      kind: s.liked ? 'liked' : 'similar',
      seedId: s.id,
      reason: s.liked ? `More like ${s.title}, as you asked` : s.favourite ? `Similar to your favourite, ${s.title}` : `Shares ${shared} with ${s.title}`,
    }
  }
  const liked = gs.filter((g) => (profile.genres.get(g) ?? 0) > 0.25).sort((a, b) => profile.genres.get(b)! - profile.genres.get(a)!)
  if (liked.length && parts.genre >= 0.6) {
    const top = liked.slice(0, 2)
    const noun = top.every((g) => profile.genreTypes.get(g)?.has(c.mediaType)) ? MEDIA_NOUN[c.mediaType] : 'titles'
    return { ...base, kind: 'genre', seedId: null, reason: `Because you enjoyed ${joinAnd(top.map((g) => (profile.labels.get(g) ?? g).toLowerCase()))} ${noun}` }
  }
  const provider = PROVIDER_NAME[c.source.provider]
  if (c.communityScore != null && c.communityScore >= 75)
    return { ...base, kind: 'quality', seedId: null, reason: `Highly rated on ${provider} (${(c.communityScore / 10).toFixed(1)}/10)` }
  return { ...base, kind: 'popular', seedId: null, reason: `Popular on ${provider}` }
}

// ---------- Sections ----------

export type SortKey = 'match' | 'popular' | 'rating' | 'newest'

export interface DiscoverOptions {
  type: MediaType | 'all'
  /** Normalised genre, '' = any. */
  genre: string
  sort: SortKey
  /** Show "More like" this seed: a library title id or `liked:<key>`. */
  focus?: string | null
  /** Tracked titles to keep showing (added during this visit), so their card can say "In your library". */
  keep?: Set<string>
}

export interface DiscoverSection {
  id: string
  title: string
  subtitle?: string
  recs: Rec[]
}

const SORTS: Record<SortKey, (a: Rec, b: Rec) => number> = {
  match: (a, b) => b.score - a.score,
  popular: (a, b) => (b.c.popularity ?? -1) - (a.c.popularity ?? -1) || b.score - a.score,
  rating: (a, b) => (b.c.communityScore ?? -1) - (a.c.communityScore ?? -1) || b.score - a.score,
  newest: (a, b) => (b.c.year ?? 0) - (a.c.year ?? 0) || b.score - a.score,
}

export const GEM = { minScore: 78, maxPopularity: 0.35 }
const SIZE = { forYou: 12, because: 8, favourites: 12, gems: 12, type: 18, focus: 18 }
const MIN_SECTION = 3
const MAX_PER_SEED = 3

export function buildDiscover(pool: Candidate[], links: Link[], library: Title[], feedback: Feedback, opts: DiscoverOptions) {
  const profile = buildProfile(library, feedback)
  const idx = indexLibrary(library)
  const linked = new Set(links.map((l) => l.key))
  // Personal only when the library says something a candidate can match: liked genres or a provider relationship.
  const personal = [...profile.genres.values()].some((v) => v > 0) || links.some((l) => profile.seeds.some((s) => s.id === l.seedId))

  const all: Rec[] = []
  for (const c of dedupe(pool)) {
    const key = candidateKey(c)
    if (feedback.dismissed[key]) continue
    if (opts.type !== 'all' && c.mediaType !== opts.type) continue
    if (opts.genre && !c.genres.some((g) => normGenre(g) === opts.genre)) continue
    if (c.source.provider === 'kitsu' && !linked.has(key) && looksLikeSequel(c.title)) continue
    all.push({ ...scoreCandidate(c, profile, links), tracked: findTracked(c, idx) })
  }
  all.sort(SORTS.match)

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
    if (s.recs.length >= min) sections.push({ ...s, recs: [...s.recs].sort(SORTS[opts.sort]) })
    else s.recs.forEach((r) => used.delete(r.key)) // too thin to show: free its titles for later sections
  }

  // "More like X": related or genre-similar to that one title. Tracked titles stay in, flagged, since the user asked.
  const focusTitle = opts.focus ? library.find((t) => t.id === opts.focus) : undefined
  const focus =
    profile.seeds.find((s) => s.id === opts.focus) ??
    (focusTitle && { id: focusTitle.id, title: focusTitle.title, mediaType: focusTitle.mediaType, source: focusTitle.source, genres: tasteGenres(focusTitle.genres), weight: 3, favourite: false, liked: false })
  if (focus) {
    const focusLinks = new Set(links.filter((l) => l.seedId === focus.id).map((l) => l.key))
    const near = (r: Rec) => (focusLinks.has(r.key) ? 2 : 0) + genreSimilarity(tasteGenres(r.c.genres), focus.genres).sim
    const self = focus.id.replace(/^liked:/, '')
    const matches = all
      .filter((r) => r.tracked?.id !== focus.id && r.key !== self && near(r) >= 0.5)
      .sort((a, b) => near(b) - near(a) || b.score - a.score)
      .map((r) => ({ ...r, reason: reasonFor(r, { ...focus, favourite: false }, links, profile) }))
    sections.push({ id: 'focus', title: `More like ${focus.title}`, subtitle: 'Related titles and shared genres from the providers.', recs: take(matches, SIZE.focus) })
  }

  if (personal) {
    // A few per seed, so one favourite doesn't fill the row and the "Because you watched" rows keep their best picks.
    const perSeed = new Map<string, number>()
    const forYou = take(open, SIZE.forYou, (r) => {
      if (r.kind === 'popular' || r.kind === 'quality') return false
      if (!r.seedId) return true
      const n = perSeed.get(r.seedId) ?? 0
      if (n >= MAX_PER_SEED) return false
      perSeed.set(r.seedId, n + 1)
      return true
    })
    push({ id: 'for-you', title: 'Recommended for You', subtitle: 'Your best matches across everything below.', recs: forYou })

    // "Because you watched": the strongest completed or loved library titles that actually have matches.
    let becauseCount = 0
    for (const s of profile.seeds) {
      if (becauseCount >= 2 || s.liked || s.weight < 2) continue
      const recs = take(open, SIZE.because, (r) => links.some((l) => l.key === r.key && l.seedId === s.id) || genreSimilarity(tasteGenres(r.c.genres), s.genres).sim >= 0.5)
      if (recs.length >= MIN_SECTION) becauseCount++
      push({ id: `because:${s.id}`, title: `Because You Watched ${s.title}`, recs: recs.map((r) => (r.seedId === s.id ? r : { ...r, reason: reasonFor(r, s, links, profile) })) })
    }

    const favs = profile.seeds.filter((s) => s.favourite)
    if (favs.length) {
      const near = (r: Rec) => favs.find((s) => links.some((l) => l.key === r.key && l.seedId === s.id) || genreSimilarity(tasteGenres(r.c.genres), s.genres).sim >= 0.5)
      const recs = take(open, SIZE.favourites, (r) => !!near(r)).map((r) => {
        const s = near(r)!
        return r.seedId === s.id ? r : { ...r, reason: reasonFor(r, s, links, profile) }
      })
      push({ id: 'favourites', title: 'More Like Your Favourites', subtitle: `Titles you rated ${FAVOURITE_RATING}+ out of 10.`, recs })
    }
  }

  // Claimed before the type sections so they don't swallow every gem; shown last.
  push({ id: 'gems', title: 'Hidden Gems', subtitle: 'Well rated, but less widely watched.', recs: take(open, SIZE.gems, (r) => (r.c.communityScore ?? 0) >= GEM.minScore && r.c.popularity != null && r.c.popularity <= GEM.maxPopularity && r.score > 0) })
  // Without history there's nothing personal to rank by: lead with popular, well-liked titles.
  const general = (r: Rec) => (r.c.popularity ?? 0) * 2 + (r.c.communityScore ?? 0) / 50
  const typeList = personal ? open : [...open].sort((a, b) => general(b) - general(a))
  for (const [type, title] of [['anime', 'Discover Anime'], ['tv', 'Discover TV Series'], ['movie', 'Discover Movies']] as const)
    push({ id: type, title, recs: take(typeList, SIZE.type, (r) => r.c.mediaType === type && r.score > -1) }, 1)

  const order = ['focus', 'for-you', 'because', 'favourites', 'anime', 'tv', 'movie', 'gems']
  sections.sort((a, b) => order.indexOf(a.id.split(':')[0]) - order.indexOf(b.id.split(':')[0]))
  return { sections, profile, personal, total: all.length }
}

/** Reason text for a rec shown under a specific seed's section. */
function reasonFor(r: Rec, s: Seed, links: Link[], profile: Profile): string {
  const role = links.find((l) => l.key === r.key && l.seedId === s.id)?.role
  if (role && ROLE_REASON[role]) return ROLE_REASON[role](s.title)
  const shared = genreSimilarity(tasteGenres(r.c.genres), s.genres).shared.slice(0, 2).map((g) => profile.labels.get(g) ?? g)
  return s.favourite ? `Similar to your favourite, ${s.title}` : `Shares ${joinAnd(shared)} with ${s.title}`
}
