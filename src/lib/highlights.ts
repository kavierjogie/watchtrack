/**
 * Discover's Trending and New & Upcoming rows, from the lists loadHighlights fetched (discover.ts). Pure and
 * deterministic, like recommend.ts. Labels only claim what the source measures: "Trending" is used for TMDB's weekly
 * trending lists only; Kitsu's lists are "popular this season" (Kitsu popularity rank among this season's anime) and
 * TVmaze's are "most followed on air" (TVmaze follower weight of shows airing this week).
 */
import type { Highlights, Spot } from './discover'
import { dayFrom, formatShortRelease } from './format'
import { buildProfile, candidateKey, dedupe, findTracked, indexLibrary, isPersonal, normGenre, scoreCandidate, type Feedback, type Rec } from './recommend'
import type { MediaType, Title } from './types'

export type BadgeTone = 'hot' | 'new' | 'soon'

export interface HighlightCard {
  rec: Rec
  badge: { label: string; tone: BadgeTone } | null
  /** Position in the Top 10 row. */
  rank?: number
}

export interface HighlightRow {
  id: string
  title: string
  subtitle: string
  cards: HighlightCard[]
}

export interface HighlightOptions {
  type: MediaType | 'all'
  /** Normalised genre, '' = any. */
  genre: string
}

const TOP = 10
const ROW = 20
const HERO = 5
/** "Just released" reaches this far back. */
const RECENT_DAYS = 60

/** Released on or before the viewer's today. Undated = unknown, never "released". */
export const isReleased = (date: string | null, now = Date.now()) => !!date && date.slice(0, 10) <= dayFrom(now)

export function buildHighlights(h: Highlights, library: Title[], feedback: Feedback, opts: HighlightOptions, now = Date.now()) {
  const profile = buildProfile(library, feedback, now)
  const personal = [...profile.genres.values()].some((v) => v > 0)
  const idx = indexLibrary(library)
  const today = dayFrom(now)
  const recentFrom = dayFrom(now, -RECENT_DAYS)
  const when = (d: string) => formatShortRelease(d.slice(0, 10), now)

  /** A card, or null when dismissed, filtered out or not showable. `signal` is the reason line for general picks. */
  const card = (s: Spot, signal: string, badge: HighlightCard['badge'] = null): HighlightCard | null => {
    const { c } = s
    if (feedback.dismissed[candidateKey(c)] || !(c.posterUrl || c.thumbUrl) || !c.title.trim()) return null
    if (opts.type !== 'all' && c.mediaType !== opts.type) return null
    if (opts.genre && !c.genres.some((g) => normGenre(g) === opts.genre)) return null
    const scored = scoreCandidate(c, profile, [])
    const rec: Rec = { ...scored, tracked: findTracked(c, idx) }
    // A later season of something in the library: say so, whatever else it matches.
    const prev = c.earlier && findTracked(c.earlier, idx)
    if (prev) return { badge, rec: { ...rec, kind: 'related', seedId: prev.id, reason: `Continues ${prev.title}, which is in your library` } }
    return { badge, rec: isPersonal(rec) ? rec : { ...rec, reason: signal } }
  }
  const cards = (spots: Spot[], make: (s: Spot, i: number) => HighlightCard | null) =>
    dedupeCards(spots.map((s, i) => make(s, i)).filter((x): x is HighlightCard => !!x))

  // One entry per title across every row below, in the order rows are built.
  const used = new Set<string>()
  const take = (list: HighlightCard[], n = ROW) => {
    const out: HighlightCard[] = []
    for (const x of list) {
      if (out.length >= n) break
      if (used.has(x.rec.key)) continue
      used.add(x.rec.key)
      out.push(x)
    }
    return out
  }
  const rows = (list: HighlightRow[]) => list.filter((r) => r.cards.length >= 2)

  // ---------- Trending ----------
  const hot = (label: string) => ({ label, tone: 'hot' as const })
  const animeSeason = h.season.filter((s) => s.c.mediaType === 'anime')
  const anime = cards(animeSeason, (s, i) => card(s, `#${i + 1} this season on Kitsu`, hot('This season')))
  const tv = h.tmdbTv
    ? cards(h.tmdbTv, (s, i) => card(s, `#${i + 1} trending on TMDB this week`, hot('Trending')))
    : cards(h.airing, (s) => card(s, 'One of the most-followed shows on air this week (TVmaze)', hot('On air')))
  const filmSeason = h.season.filter((s) => s.c.mediaType === 'movie')
  const movies = h.tmdbMovies
    ? cards(h.tmdbMovies, (s, i) => card(s, `#${i + 1} trending on TMDB this week`, hot('Trending')))
    : cards(filmSeason, (s, i) => card(s, `#${i + 1} anime film this season on Kitsu`, hot('This season')))

  // Top 10: the leaders of each category in turn, so no single provider fills it.
  const top: HighlightCard[] = []
  if (opts.type === 'all') {
    const lists = [anime, tv, movies]
    for (let i = 0; top.length < TOP && lists.some((l) => i < l.length); i++)
      for (const l of lists) if (l[i] && top.length < TOP && !used.has(l[i].rec.key)) top.push(...take([l[i]], 1))
  }
  const ranked = top.map((x, i) => ({ ...x, rank: i + 1 }))
  const trending = rows([
    { id: 'top', title: 'Top 10 Right Now', subtitle: 'The leaders across anime, series and movies, from each catalogue’s own popularity signal.', cards: ranked },
    { id: 'trend-anime', title: 'Popular Anime This Season', subtitle: 'This season’s anime, by Kitsu popularity rank.', cards: take(anime) },
    h.tmdbTv
      ? { id: 'trend-tv', title: 'Trending Series', subtitle: 'TMDB’s trending series this week.', cards: take(tv) }
      : { id: 'trend-tv', title: 'Most-Followed Series On Air', subtitle: 'Shows that aired this week, by TVmaze follower count.', cards: take(tv) },
    h.tmdbMovies
      ? { id: 'trend-movie', title: 'Trending Movies', subtitle: 'TMDB’s trending movies this week.', cards: take(movies) }
      : { id: 'trend-movie', title: 'Anime Films This Season', subtitle: 'This season’s anime films, by Kitsu popularity rank.', cards: take(movies) },
  ])
  // Featured: the Top 10's leaders, or the leaders of the one category picked.
  const hero = (ranked.length ? ranked : (trending[0]?.cards ?? [])).slice(0, HERO)

  // ---------- New & Upcoming ----------
  const later = (s: Spot) => (s.season != null ? s.season > 1 : !!s.c.earlier)
  const dated = (s: Spot) => s.date?.slice(0, 10) ?? ''
  const released = (s: Spot) => isReleased(s.date, now)
  const recent = (s: Spot) => released(s) && dated(s) >= recentFrom
  const upcoming = (s: Spot) => !!s.date && dated(s) > today

  const newOut = { label: 'Out now', tone: 'new' as const }
  const justReleased = cards(
    [...h.season.filter((s) => recent(s) && !later(s)), ...h.premieres.filter((s) => recent(s) && !later(s)), ...(h.tmdbNowPlaying ?? []).filter(recent)].sort((a, b) => dated(b).localeCompare(dated(a))),
    (s) => card(s, `${s.season === 1 ? 'Series premiered' : s.c.mediaType === 'movie' ? 'Released' : 'Started'} ${when(dated(s))}`, newOut),
  )
  const seasonNo = (s: Spot) => (s.season != null ? `Season ${s.season}` : 'New season')
  // Seasons of shows already in the library first: that's the news people track a show for.
  const inLibrary = (x: HighlightCard) => !!x.rec.tracked || x.rec.reason.startsWith('Continues ')
  const byLibrary = (a: HighlightCard, b: HighlightCard) => Number(inLibrary(b)) - Number(inLibrary(a))
  const newSeasons = cards(
    [...h.season.filter((s) => recent(s) && later(s)), ...h.premieres.filter((s) => recent(s) && later(s))].sort((a, b) => dated(b).localeCompare(dated(a))),
    (s) => card(s, `${seasonNo(s)} premiered ${when(dated(s))}`, { label: seasonNo(s), tone: 'new' }),
  ).sort(byLibrary)
  // Coming soon, ordered by the user's interests when there are any, else soonest first.
  const soon = cards(
    [...h.upcomingAnime, ...h.season, ...h.premieres, ...(h.tmdbUpcoming ?? [])].filter(upcoming).sort((a, b) => dated(a).localeCompare(dated(b))),
    (s) => {
      const label = s.c.mediaType === 'movie' ? 'In cinemas' : s.season != null && s.season > 1 ? `Season ${s.season} premieres` : later(s) ? 'New season premieres' : 'Premieres'
      return card(s, `${label} ${when(dated(s))}`, { label: when(dated(s)), tone: 'soon' })
    },
  )
  if (personal) soon.sort((a, b) => byLibrary(a, b) || Number(isPersonal(b.rec)) - Number(isPersonal(a.rec)) || b.rec.score - a.rec.score)
  const fresh = rows([
    { id: 'new', title: 'Just Released', subtitle: 'New series, anime and films from the last two months.', cards: take(justReleased) },
    { id: 'seasons', title: 'New Seasons', subtitle: 'Returning shows with a season that just started.', cards: take(newSeasons) },
    { id: 'soon', title: 'Coming Soon', subtitle: personal ? 'Not out yet — the ones closest to your taste first.' : 'Not out yet — announced premieres and releases.', cards: take(soon) },
  ])

  return { hero, trending, fresh, personal }
}

/** One card per title, the first one winning (dedupe across providers by id, or name and year). */
function dedupeCards(list: HighlightCard[]): HighlightCard[] {
  const keep = new Set(dedupe(list.map((x) => x.rec.c)))
  return list.filter((x) => keep.has(x.rec.c))
}
