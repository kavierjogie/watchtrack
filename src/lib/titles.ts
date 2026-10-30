import { newId } from './db'
import type { MetaResult } from './metadata'
import { emptyProgress, formatEpLong, markWatched, type MarkOutcome } from './progress'
import type { HistoryEntry, HistoryKind, Progress, Snapshot, Title, WatchStatus } from './types'

export type NewTitleInput = Partial<Omit<Title, 'id' | 'createdAt' | 'updatedAt'>> & Pick<Title, 'title' | 'mediaType'>

export function createTitle(input: NewTitleInput, now = new Date().toISOString()): Title {
  const status = input.status ?? 'plan'
  return {
    altTitles: [],
    synopsis: '',
    year: null,
    genres: [],
    tags: [],
    rating: null,
    notes: '',
    poster: null,
    backdropUrl: null,
    watchedDate: null,
    source: null,
    importNote: null,
    lastWatchedAt: null,
    ...input,
    title: input.title.trim(),
    status,
    progress: input.mediaType === 'movie' ? null : (input.progress ?? emptyProgress(input.mediaType === 'anime' ? 'absolute' : 'seasonal')),
    completedAt: input.completedAt ?? (status === 'completed' ? now : null),
    id: newId(),
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Point a title at another provider entry (e.g. a single-season anime entry → the whole show). Only provider-owned
 * fields change: the old source's episode counts, totals and sync state (AniList id, sequel, dates) don't apply to the new one.
 */
export function relinkTitle(t: Title, meta: MetaResult): Title {
  const p = t.progress
  return {
    ...t,
    source: meta.source,
    backdropUrl: meta.backdropUrl ?? t.backdropUrl,
    sync: undefined,
    progress: p && {
      ...p,
      seasonEpisodeCounts: { ...meta.seasonEpisodeCounts },
      totalSeasons: meta.totalSeasons,
      totalEpisodes: meta.totalEpisodes && !meta.ongoing ? meta.totalEpisodes : null,
    },
  }
}

const snapshot = (t: Title): Snapshot => ({
  progress: t.progress,
  status: t.status,
  completedAt: t.completedAt,
  lastWatchedAt: t.lastWatchedAt,
  watchedDate: t.watchedDate,
})

function entry(t: Title, kind: HistoryKind, at: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id: newId(), titleId: t.id, at, kind, season: null, episode: null, label: null, before: snapshot(t), ...extra }
}

export interface Change {
  title: Title
  history: HistoryEntry
}

function withStatus(t: Title, status: WatchStatus, now: string): Title {
  return {
    ...t,
    status,
    completedAt: status === 'completed' ? (t.completedAt ?? now) : null,
    updatedAt: now,
  }
}

export function applyMarkWatched(t: Title, now = new Date().toISOString()): (Change & { outcome: MarkOutcome }) | null {
  if (!t.progress) return null
  const r = markWatched(t.progress)
  if (!r) return null
  const title: Title = {
    ...t,
    progress: r.progress,
    // Marking an episode on a planned/paused title means you're watching it now.
    status: t.status === 'completed' ? t.status : 'watching',
    lastWatchedAt: now,
    updatedAt: now,
  }
  return {
    title,
    outcome: r.outcome,
    history: entry(t, 'episode', now, {
      season: r.watched.season,
      episode: r.watched.episode,
      label: formatEpLong(r.watched, t.progress.numbering),
    }),
  }
}

export function applyProgress(t: Title, progress: Progress, label: string, now = new Date().toISOString()): Change {
  return { title: { ...t, progress, updatedAt: now }, history: entry(t, 'correction', now, { label }) }
}

export function applyStatus(t: Title, status: WatchStatus, now = new Date().toISOString()): Change {
  return { title: withStatus(t, status, now), history: entry(t, 'status', now, { label: status }) }
}

export function applyMovieWatched(t: Title, date: string, now = new Date().toISOString()): Change {
  return {
    title: { ...withStatus(t, 'completed', now), watchedDate: date, lastWatchedAt: now },
    history: entry(t, 'movie', now, { label: 'Watched movie' }),
  }
}

export function applySpecial(t: Title, label: string, now = new Date().toISOString()): Change {
  return { title: { ...t, lastWatchedAt: now, updatedAt: now }, history: entry(t, 'special', now, { label }) }
}

/** Most recent activity time, used for "not watched in a while" and sorting. */
export const lastActivity = (t: Title) => t.lastWatchedAt ?? t.updatedAt

/** Titles with a concrete next episode first, then ones needing attention, each by recent activity. */
export function byContinue(a: Title, b: Title): number {
  const rank = (t: Title) => (t.progress && t.progress.nextEpisode != null ? 0 : 1)
  return rank(a) - rank(b) || lastActivity(b).localeCompare(lastActivity(a))
}
