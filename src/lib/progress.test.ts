import { describe, expect, it } from 'vitest'
import {
  describePosition,
  emptyProgress,
  lastWatched,
  markWatched,
  position,
  setLastWatched,
  setNextEpisode,
  startNextSeason,
  waitingFor,
} from './progress'
import type { Progress, SyncInfo } from './types'

const seasonal = (o: Partial<Progress> = {}): Progress => ({ ...emptyProgress('seasonal'), ...o })
const absolute = (o: Partial<Progress> = {}): Progress => ({ ...emptyProgress('absolute'), ...o })

describe('next episode calculation', () => {
  it('absolute numbering: last watched 172 → 173 next (Black Clover)', () => {
    const p = setLastWatched(absolute(), null, 172)
    expect(p.nextEpisode).toBe(173)
    expect(describePosition(p)).toBe('Episode 173 next')
    expect(lastWatched(p)).toEqual({ season: null, episode: 172 })
  })

  it('seasonal: last watched S2E8 → S2E9 next (Helluva Boss)', () => {
    const p = setLastWatched(seasonal(), 2, 8)
    expect(describePosition(p)).toBe('Season 2, Episode 9 next')
  })

  it('mark watched records the episode and advances', () => {
    const r = markWatched(seasonal({ season: 1, nextEpisode: 3 }))!
    expect(r.watched).toEqual({ season: 1, episode: 3 })
    expect(r.progress.nextEpisode).toBe(4)
    expect(r.outcome).toBe('advanced')
  })

  it('mode 2 stores the next episode exactly as entered', () => {
    const p = setNextEpisode(seasonal(), 3, 7)
    expect(p.season).toBe(3)
    expect(p.nextEpisode).toBe(7)
    expect(lastWatched(p)).toEqual({ season: 3, episode: 6 })
  })
})

describe('advancing between seasons', () => {
  it('moves to next season when the season count and total seasons are known', () => {
    const p = seasonal({ season: 1, nextEpisode: 12, seasonEpisodeCounts: { 1: 12, 2: 12 }, totalSeasons: 2 })
    const r = markWatched(p)!
    expect(r.outcome).toBe('season-advanced')
    expect(r.progress.season).toBe(2)
    expect(r.progress.nextEpisode).toBe(1)
    expect(lastWatched(r.progress)).toEqual({ season: 1, episode: 12 })
  })

  it('advances when the next season is known from episode counts (ongoing show, total unknown)', () => {
    const p = seasonal({ season: 1, nextEpisode: 10, seasonEpisodeCounts: { 1: 10, 2: 8 } })
    const r = markWatched(p)!
    expect(r.outcome).toBe('season-advanced')
    const end = markWatched({ ...r.progress, nextEpisode: 8 })!
    expect(end.outcome).toBe('season-finished')
  })

  it('reports series finished at the end of the last known season', () => {
    const p = seasonal({ season: 2, nextEpisode: 12, seasonEpisodeCounts: { 2: 12 }, totalSeasons: 2 })
    const r = markWatched(p)!
    expect(r.outcome).toBe('series-finished')
    expect(position(r.progress).state).toBe('series-finished')
    expect(markWatched(r.progress)).toBeNull()
  })

  it('absolute numbering finishes when total episodes reached', () => {
    const r = markWatched(absolute({ nextEpisode: 13, totalEpisodes: 13 }))!
    expect(r.outcome).toBe('series-finished')
  })
})

describe('unknown season counts', () => {
  it('keeps advancing when the episode count is unknown', () => {
    const r = markWatched(seasonal({ season: 4, nextEpisode: 30 }))!
    expect(r.outcome).toBe('advanced')
    expect(r.progress.nextEpisode).toBe(31)
  })

  it('never assumes another season exists when total seasons is unknown', () => {
    const p = seasonal({ season: 3, nextEpisode: 12, seasonEpisodeCounts: { 3: 12 } })
    const r = markWatched(p)!
    expect(r.outcome).toBe('season-finished')
    expect(r.progress.season).toBe(3)
    expect(position(r.progress)).toEqual({ state: 'season-finished', season: 3 })
  })

  it('user can start the next season manually', () => {
    const p = seasonal({ season: 3, nextEpisode: 13, seasonEpisodeCounts: { 3: 12 } })
    const n = startNextSeason(p)
    expect(n.season).toBe(4)
    expect(n.nextEpisode).toBe(1)
    expect(n.totalSeasons).toBeNull()
  })

  it('unknown position cannot be marked watched', () => {
    expect(markWatched(seasonal({ season: 4, nextEpisode: null }))).toBeNull()
    expect(describePosition(seasonal({ season: 4, nextEpisode: null }))).toBe('Season 4 · episode not set')
  })
})

describe('manual corrections', () => {
  it('setting last watched backwards moves the pointer back', () => {
    const p = setLastWatched(absolute({ nextEpisode: 50 }), null, 40)
    expect(p.nextEpisode).toBe(41)
  })

  it('last watched 0 means not started', () => {
    const p = setLastWatched(seasonal({ nextEpisode: 5 }), 1, 0)
    expect(p.nextEpisode).toBe(1)
    expect(lastWatched(p)).toBeNull()
  })

  it('can jump seasons via mode 2', () => {
    const p = setNextEpisode(seasonal({ season: 1, nextEpisode: 4 }), 3, 1)
    expect(p.season).toBe(3)
    expect(p.nextEpisode).toBe(1)
  })
})

describe('skipped episodes', () => {
  it('skips over skipped ranges when advancing (Family Guy 2–9 skipped)', () => {
    const p = absolute({ nextEpisode: 1, skipped: [{ season: null, from: 2, to: 9 }] })
    const r = markWatched(p)!
    expect(r.progress.nextEpisode).toBe(10)
  })

  it('last watched steps back over skipped ranges', () => {
    const p = absolute({ nextEpisode: 10, skipped: [{ season: null, from: 2, to: 9 }] })
    expect(lastWatched(p)).toEqual({ season: null, episode: 1 })
  })

  it('skipped ranges are per-season', () => {
    const p = seasonal({ season: 2, nextEpisode: 2, skipped: [{ season: 1, from: 3, to: 3 }] })
    expect(markWatched(p)!.progress.nextEpisode).toBe(3)
  })

  it('first episode of new season respects skips', () => {
    const p = seasonal({
      season: 1,
      nextEpisode: 2,
      seasonEpisodeCounts: { 1: 2 },
      totalSeasons: 2,
      skipped: [{ season: 2, from: 1, to: 1 }],
    })
    const r = markWatched(p)!
    expect(r.progress).toMatchObject({ season: 2, nextEpisode: 2 })
  })
})

describe('waitingFor (caught up on a show still airing)', () => {
  const NOW = Date.parse('2026-10-28T12:00:00Z')
  const sync = (over: Partial<SyncInfo> = {}): SyncInfo => ({ checkedAt: '', changedAt: null, ongoing: true, aired: null, nextAiring: null, ...over })
  const inSeason = (season: number, nextEpisode: number, counts: Record<number, number>): Progress => ({ ...emptyProgress('seasonal'), season, nextEpisode, seasonEpisodeCounts: counts })
  const friday = '2026-10-30T20:00:00Z'

  it('waits for the next episode of the current season once every aired one is watched', () => {
    const p = inSeason(2, 6, { 1: 10, 2: 5 })
    expect(waitingFor(p, sync({ nextAiring: { season: 2, episode: 6, airdate: friday } }), NOW)).toEqual({ episode: { season: 2, episode: 6 }, airdate: friday })
  })

  it('waits for an announced next season, or says nothing is scheduled yet', () => {
    const p = inSeason(2, 9, { 1: 10, 2: 8 })
    expect(waitingFor(p, sync({ nextAiring: { season: 3, episode: 1, airdate: friday } }), NOW)?.episode).toEqual({ season: 3, episode: 1 })
    expect(waitingFor(p, sync(), NOW)).toEqual({ episode: null, airdate: null })
  })

  it('works for overall numbering, from the next airing or the aired count', () => {
    const p: Progress = { ...emptyProgress('absolute'), nextEpisode: 13 }
    expect(waitingFor(p, sync({ nextAiring: { season: null, episode: 13, airdate: friday } }), NOW)?.airdate).toBe(friday)
    expect(waitingFor(p, sync({ aired: 12 }), NOW)).toEqual({ episode: null, airdate: null })
  })

  it('is null when there is an aired episode to watch, the show has ended, or the date has passed', () => {
    expect(waitingFor(inSeason(2, 3, { 2: 5 }), sync({ nextAiring: { season: 2, episode: 6, airdate: friday } }), NOW)).toBeNull()
    expect(waitingFor(inSeason(2, 6, { 2: 5 }), sync({ ongoing: false }), NOW)).toBeNull()
    expect(waitingFor(inSeason(2, 6, { 2: 5 }), undefined, NOW)).toBeNull()
    const aired = sync({ nextAiring: { season: 2, episode: 6, airdate: '2026-10-27T20:00:00Z' } })
    expect(waitingFor({ ...emptyProgress('absolute'), nextEpisode: 6 }, aired, NOW)).toBeNull()
    // Between seasons with the next one already known: starting it is the right action, not waiting.
    expect(waitingFor({ ...inSeason(2, 9, { 2: 8, 3: 10 }) }, sync(), NOW)).toBeNull()
  })
})

describe('huge skipped ranges', () => {
  // A crafted backup (or a typo like "1-999999999") used to loop once per episode and freeze the app.
  const p = { ...emptyProgress('absolute'), nextEpisode: 1_000_000_001, skipped: [{ season: null, from: 1, to: 1_000_000_000 }] }

  it('works out "last watched" without stepping through every episode', () => {
    expect(lastWatched(p)).toBeNull()
    expect(lastWatched({ ...p, skipped: [{ season: null, from: 5, to: 1_000_000_000 }] })).toEqual({ season: null, episode: 4 })
  })

  it('jumps over a skipped range when advancing', () => {
    expect(setLastWatched({ ...p, nextEpisode: 1 }, null, 0).nextEpisode).toBe(1_000_000_001)
    const chained = { ...p, nextEpisode: 1, skipped: [{ season: null, from: 1, to: 3 }, { season: null, from: 4, to: 6 }] }
    expect(setLastWatched(chained, null, 0).nextEpisode).toBe(7)
  })
})
