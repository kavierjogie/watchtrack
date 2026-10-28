import type { Numbering, Progress, SkipRange, SyncInfo } from './types'

export interface EpisodeRef {
  season: number | null
  episode: number
}

export function emptyProgress(numbering: Numbering = 'seasonal'): Progress {
  return {
    numbering,
    season: numbering === 'seasonal' ? 1 : null,
    nextEpisode: 1,
    seasonEpisodeCounts: {},
    totalSeasons: null,
    totalEpisodes: null,
    skipped: [],
    rewatching: false,
  }
}

const sameSeason = (r: SkipRange, season: number | null) => r.season === season

const skipAt = (p: Progress, season: number | null, ep: number) => p.skipped.find((r) => sameSeason(r, season) && ep >= r.from && ep <= r.to)

export function isSkipped(p: Progress, season: number | null, ep: number): boolean {
  return !!skipAt(p, season, ep)
}

/** First episode >= ep in `season` that is not in a skipped range. Jumps whole ranges, so huge ranges can't hang. */
function firstUnskippedFrom(p: Progress, season: number | null, ep: number): number {
  let e = ep
  for (let i = 0, r = skipAt(p, season, e); r && i <= p.skipped.length; i++, r = skipAt(p, season, e)) e = r.to + 1
  return e
}

/** Episode count for the current season (seasonal) or the whole show (absolute). */
export function currentEpisodeCount(p: Progress): number | null {
  if (p.numbering === 'absolute') return p.totalEpisodes
  if (p.season == null) return null
  return p.seasonEpisodeCounts[p.season] ?? null
}

/** True when another season is definitely known to exist (total seasons, or a known episode count for it). */
export function hasKnownNextSeason(p: Progress): boolean {
  if (p.numbering !== 'seasonal' || p.season == null) return false
  return (p.totalSeasons != null && p.season < p.totalSeasons) || p.seasonEpisodeCounts[p.season + 1] != null
}

export type Position =
  | { state: 'unknown' } // no episode position recorded
  | { state: 'next'; next: EpisodeRef } // a concrete next episode
  | { state: 'season-finished'; season: number } // season done, next season unknown/unconfirmed
  | { state: 'series-finished' } // every known episode watched

export function position(p: Progress): Position {
  if (p.nextEpisode == null) return { state: 'unknown' }
  const count = currentEpisodeCount(p)
  if (count != null && p.nextEpisode > count) {
    if (p.numbering === 'absolute') return { state: 'series-finished' }
    if (p.totalSeasons != null && p.season != null && p.season >= p.totalSeasons) return { state: 'series-finished' }
    return { state: 'season-finished', season: p.season ?? 1 }
  }
  return { state: 'next', next: { season: p.season, episode: p.nextEpisode } }
}

/**
 * Caught up on a show that's still airing: the user's next episode hasn't aired yet. Returns the confirmed next
 * release (episode null when the provider gives only a date, airdate null when nothing is scheduled), or null when
 * there's an aired episode to watch or the show has ended.
 */
export function waitingFor(p: Progress, sync: SyncInfo | undefined, now = Date.now()): { episode: EpisodeRef | null; airdate: string | null } | null {
  if (!sync?.ongoing) return null
  const n = sync.nextAiring && !(Date.parse(sync.nextAiring.airdate) < now) ? sync.nextAiring : null
  const release = { episode: n?.episode != null ? { season: n.season, episode: n.episode } : null, airdate: n?.airdate ?? null }
  const pos = position(p)
  if (pos.state === 'next') {
    const { season, episode } = pos.next
    const unaired =
      (n?.episode != null && n.season === season && episode >= n.episode) ||
      (p.numbering === 'absolute' && sync.aired != null && episode > sync.aired)
    return unaired ? release : null
  }
  // Watched every aired episode of the season: waiting for the rest of it, or for the next season to be scheduled.
  if (pos.state === 'season-finished') return n ? release : hasKnownNextSeason(p) ? null : release
  if (pos.state === 'series-finished' && n) return release
  return null
}

/** Derived: the most recent episode completed, or null if unknown/not started. */
export function lastWatched(p: Progress): EpisodeRef | null {
  if (p.nextEpisode == null) return null
  let e = p.nextEpisode - 1
  for (let i = 0, r = skipAt(p, p.season, e); r && i <= p.skipped.length; i++, r = skipAt(p, p.season, e)) e = r.from - 1
  if (e >= 1) return { season: p.season, episode: e }
  // Next is the start of a season: last watched was the end of the previous one, if known.
  if (p.numbering === 'seasonal' && p.season != null && p.season > 1) {
    const prev = p.seasonEpisodeCounts[p.season - 1]
    if (prev) return { season: p.season - 1, episode: prev }
  }
  return null
}

export type MarkOutcome = 'advanced' | 'season-advanced' | 'season-finished' | 'series-finished'

export interface MarkResult {
  progress: Progress
  watched: EpisodeRef
  outcome: MarkOutcome
}

/** Move the pointer to just after `ep` in the current season, crossing into the next known season if needed. */
function advanceFrom(p: Progress, ep: number): { progress: Progress; outcome: MarkOutcome } {
  const next = firstUnskippedFrom(p, p.season, ep + 1)
  const count = currentEpisodeCount(p)
  if (count == null || next <= count) {
    return { progress: { ...p, nextEpisode: next }, outcome: 'advanced' }
  }
  if (p.numbering === 'absolute') {
    return { progress: { ...p, nextEpisode: next }, outcome: 'series-finished' }
  }
  if (hasKnownNextSeason(p)) {
    const season = (p.season ?? 1) + 1
    const moved = { ...p, season }
    return { progress: { ...moved, nextEpisode: firstUnskippedFrom(moved, season, 1) }, outcome: 'season-advanced' }
  }
  const outcome: MarkOutcome = p.totalSeasons != null ? 'series-finished' : 'season-finished'
  return { progress: { ...p, nextEpisode: next }, outcome }
}

/**
 * Mark the current next episode as watched.
 * Returns null when there is nothing concrete to mark (unknown position or already finished).
 */
export function markWatched(p: Progress): MarkResult | null {
  const pos = position(p)
  if (pos.state !== 'next') return null
  const { progress, outcome } = advanceFrom(p, pos.next.episode)
  return { progress, watched: pos.next, outcome }
}

/** Mode 1: "the last episode I watched was X" — next is calculated. */
export function setLastWatched(p: Progress, season: number | null, episode: number): Progress {
  const base = { ...p, season: p.numbering === 'seasonal' ? (season ?? p.season ?? 1) : null }
  if (episode <= 0) return { ...base, nextEpisode: firstUnskippedFrom(base, base.season, 1) }
  return advanceFrom(base, episode).progress
}

/** Mode 2: "the next episode I need to watch is X". Stored exactly as entered. */
export function setNextEpisode(p: Progress, season: number | null, episode: number): Progress {
  return {
    ...p,
    season: p.numbering === 'seasonal' ? (season ?? p.season ?? 1) : null,
    nextEpisode: Math.max(1, episode),
  }
}

/** User confirmed a new season exists after finishing the current one. */
export function startNextSeason(p: Progress): Progress {
  const season = (p.season ?? 0) + 1
  const moved = { ...p, season }
  return {
    ...moved,
    totalSeasons: p.totalSeasons != null && p.totalSeasons < season ? season : p.totalSeasons,
    nextEpisode: firstUnskippedFrom(moved, season, 1),
  }
}

export function formatEp(ref: EpisodeRef | null, numbering: Numbering): string {
  if (!ref) return '—'
  return numbering === 'seasonal' && ref.season != null ? `S${ref.season} · E${ref.episode}` : `Episode ${ref.episode}`
}

export function formatEpLong(ref: EpisodeRef, numbering: Numbering): string {
  return numbering === 'seasonal' && ref.season != null
    ? `Season ${ref.season}, Episode ${ref.episode}`
    : `Episode ${ref.episode}`
}

/** Human summary of where a title is, e.g. "Season 2, Episode 9 next". */
export function describePosition(p: Progress): string {
  const pos = position(p)
  switch (pos.state) {
    case 'unknown':
      return p.numbering === 'seasonal' && p.season != null ? `Season ${p.season} · episode not set` : 'Episode not set'
    case 'next':
      return `${formatEpLong(pos.next, p.numbering)} next`
    case 'season-finished':
      return `Finished season ${pos.season}`
    case 'series-finished':
      return 'All known episodes watched'
  }
}

/** 0–1 progress through the current season (or whole show for absolute), if computable. */
export function progressFraction(p: Progress): number | null {
  const count = currentEpisodeCount(p)
  if (!count || p.nextEpisode == null) return null
  return Math.min(1, Math.max(0, (p.nextEpisode - 1) / count))
}

export function parseSkipRanges(input: string, season: number | null): SkipRange[] {
  const out: SkipRange[] = []
  for (const part of input.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/)
    if (!m) continue
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    out.push({ season, from: Math.min(a, b), to: Math.max(a, b) })
  }
  return out
}

export function formatSkipRanges(ranges: SkipRange[], season: number | null): string {
  return ranges
    .filter((r) => r.season === season)
    .map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`))
    .join(', ')
}
