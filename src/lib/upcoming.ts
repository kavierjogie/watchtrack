/**
 * The Upcoming page's list and calendar export: future episodes of shows in the library, worked out from what each
 * refresh already stored (sync.ts), so this makes no requests of its own. Dates are only ever the provider's.
 */
import { upcomingOf } from './alerts'
import { titleKey } from './backup'
import { isDateOnly, isPast, localDay } from './format'
import { isSkipped } from './progress'
import type { Progress, Release, Title } from './types'

export interface UpcomingEpisode extends Release {
  key: string
  t: Title
  airdate: string
  /** The viewer's calendar day. */
  day: string
}

/** Past the watch position (marked ahead) or in a skipped range. A provider number with no season can't be compared to a seasonal position, so it stays. */
function alreadyDealtWith(p: Progress, season: number | null, episode: number | null): boolean {
  if (p.numbering === 'seasonal' && season != null && p.season != null && season < p.season) return true
  if (episode == null) return false
  if (isSkipped(p, season, episode)) return true
  if (p.nextEpisode == null) return false
  return episode < p.nextEpisode && (p.numbering === 'absolute' || season === p.season)
}

/** Providers often say "TBA" or "Episode 5" when an episode has no real name. */
const realName = (name: string | null) => (name && !/^(tba|tbd|to be announced|episode \d+)$/i.test(name.trim()) ? name : null)

function releasesOf(t: Title): Release[] {
  // Refreshed before the full list was stored: the next airing is still good.
  const n = t.sync?.nextAiring
  return t.sync?.upcoming ? upcomingOf(t) : n ? [{ kind: 'episode', season: n.season, episode: n.episode, name: null, airdate: n.airdate }] : []
}

/**
 * Soonest first. A season with a dated premiere counts as its first episode, unless that episode is already listed.
 * Undated releases aren't episodes anyone can plan around, so they're left to alerts and the title's own page.
 */
export function upcomingEpisodes(titles: Title[], now = Date.now()): UpcomingEpisode[] {
  const seen = new Set<string>()
  const rows: UpcomingEpisode[] = []
  for (const t of titles) {
    const p = t.progress
    if (t.status === 'dropped' || t.mediaType === 'movie' || !p) continue
    const dated = releasesOf(t).filter((r): r is Release & { airdate: string } => !!r.airdate && !Number.isNaN(Date.parse(r.airdate)) && !isPast(r.airdate, now))
    const episodes = dated.filter((r) => r.kind === 'episode')
    const premieres = dated.filter((r) => r.kind === 'season' && !episodes.some((e) => (r.season != null && e.season === r.season) || localDay(e.airdate) === localDay(r.airdate)))
    for (const r of [...episodes, ...premieres]) {
      // The next airing can't have been watched yet, whatever the position says (e.g. a mistaken "last watched"), and the Caught up card announces it.
      const announced = r.kind === 'episode' && r.season === t.sync?.nextAiring?.season && r.episode === t.sync?.nextAiring?.episode
      if (!announced && alreadyDealtWith(p, r.season, r.episode ?? (r.kind === 'season' ? 1 : null))) continue
      const key = `${titleKey(t)}:${r.kind}:${r.season ?? ''}:${r.episode ?? localDay(r.airdate)}`
      if (seen.has(key)) continue // the same show added twice, e.g. from two providers
      seen.add(key)
      rows.push({ ...r, name: realName(r.name), key, t, day: localDay(r.airdate) })
    }
  }
  // On the same day, known times come first; a day with no time could be any of them.
  return rows.sort((a, b) => a.day.localeCompare(b.day) || Number(isDateOnly(a.airdate)) - Number(isDateOnly(b.airdate)) || Date.parse(a.airdate) - Date.parse(b.airdate) || a.t.title.localeCompare(b.t.title))
}

const two = (n: number) => String(n).padStart(2, '0')

/** "S02 E05", "Episode 1102", or the plainest honest name when the provider gave no number. */
export function episodeCode(r: UpcomingEpisode): string {
  const seasonal = r.t.progress?.numbering === 'seasonal'
  if (r.kind === 'season') return r.season == null ? 'New season' : seasonal ? `S${two(r.season)} E01` : `Season ${r.season} premiere`
  if (r.episode == null) return 'Next episode'
  return seasonal && r.season != null ? `S${two(r.season)} E${two(r.episode)}` : `Episode ${r.episode}`
}
