import { describe, expect, it } from 'vitest'
import {
  buildDiscover,
  buildProfile,
  buildSimilar,
  candidateKey,
  dedupe,
  emptyFeedback,
  entryPoint,
  findTracked,
  genreSimilarity,
  indexLibrary,
  isPersonal,
  scoreCandidate,
  titleWeight,
  type Candidate,
  type DiscoverOptions,
  type Feedback,
  type Link,
} from './recommend'
import { createTitle } from './titles'
import type { MediaType, Title } from './types'

let n = 0
function cand(title: string, genres: string[], extra: Partial<Candidate> = {}): Candidate {
  const id = String(++n)
  const provider = extra.source?.provider ?? 'kitsu'
  return {
    source: { provider, id, url: `https://example.test/${id}` },
    title,
    altTitles: [],
    mediaType: 'anime',
    year: 2020,
    date: null,
    synopsis: '',
    genres,
    posterUrl: `https://example.test/${id}.jpg`,
    thumbUrl: null,
    backdropUrl: null,
    totalEpisodes: 12,
    totalSeasons: null,
    seasonEpisodeCounts: {},
    ongoing: false,
    communityScore: 70,
    popularity: 0.5,
    ...extra,
  }
}

function lib(title: string, genres: string[], over: Partial<Title> = {}): Title {
  return createTitle({ title, mediaType: (over.mediaType ?? 'anime') as MediaType, genres, status: 'completed', ...over })
}

const OPTS: DiscoverOptions = { type: 'all', genre: '', sort: 'match' }
const allKeys = (sections: { recs: { key: string }[] }[]) => sections.flatMap((s) => s.recs.map((r) => r.key))

describe('titleWeight', () => {
  it('weights completed and highly rated above just-started, and dislikes below zero', () => {
    const completed = lib('A', [])
    const loved = lib('B', [], { rating: 10 })
    const started = lib('C', [], { status: 'watching' })
    const dropped = lib('D', [], { status: 'dropped' })
    const panned = lib('E', [], { rating: 2 })
    expect(titleWeight(loved)).toBeGreaterThan(titleWeight(completed))
    expect(titleWeight(completed)).toBeGreaterThan(titleWeight(started))
    expect(titleWeight(started)).toBeLessThan(1) // first episodes: interest, not enjoyment
    expect(titleWeight(dropped)).toBeLessThan(0)
    expect(titleWeight(panned)).toBeLessThan(0)
  })
})

describe('scoring', () => {
  it('ranks a genre match to a favourite above an unrelated title, and says why', () => {
    const fav = lib('Fullmetal Alchemist', ['Action', 'Adventure', 'Fantasy'], { rating: 10 })
    const p = buildProfile([fav], emptyFeedback())
    const near = scoreCandidate(cand('Magi', ['Action', 'Adventure', 'Fantasy', 'Magic']), p, [])
    const far = scoreCandidate(cand('K-On!', ['Music', 'School']), p, [])
    expect(near.score).toBeGreaterThan(far.score)
    expect(near.reason).toBe('Similar to Fullmetal Alchemist, which you rated 10/10')
    expect(far.kind).toBe('popular')
  })

  it('uses provider relationships: a sequel to a completed title gets a sequel reason', () => {
    const aot = lib('Attack on Titan', ['Action'])
    const s2 = cand('Attack on Titan Season 2', [])
    const links: Link[] = [{ key: candidateKey(s2), seedId: aot.id, role: 'sequel' }]
    const r = scoreCandidate(s2, buildProfile([aot], emptyFeedback()), links)
    expect(r.kind).toBe('related')
    expect(r.reason).toBe('Sequel to Attack on Titan')
  })

  it('explains genre-level taste with the media type when the history supports it', () => {
    const library = [lib('X', ['Action', 'Comedy']), lib('Y', ['Action', 'Drama']), lib('Z', ['Action', 'Romance'])]
    const r = scoreCandidate(cand('Q', ['Action', 'Sports', 'Horror']), buildProfile(library, emptyFeedback()), [])
    expect(r.reason).toBe('Because you enjoyed action anime')
  })

  it('needs two shared genres before calling something similar (no theme guessing from one label)', () => {
    const p = buildProfile([lib('Seed', ['Drama'], { rating: 9 })], emptyFeedback())
    expect(scoreCandidate(cand('Other', ['Drama', 'Sports']), p, []).kind).not.toBe('similar')
  })

  it('counts dropped titles and dismissals against their genres', () => {
    const library = [lib('Liked', ['Action', 'Fantasy']), lib('Dropped', ['Horror', 'Gore'], { status: 'dropped' })]
    const p = buildProfile(library, emptyFeedback())
    expect(p.genres.get('horror')).toBeLessThan(0)
    const fb: Feedback = { ...emptyFeedback(), dismissed: { 'kitsu:9': { at: '', title: 'Nope', mediaType: 'anime', genres: ['Fantasy'] } } }
    expect(buildProfile(library, fb).genres.get('fantasy')!).toBeLessThan(p.genres.get('fantasy')!)
  })
})

describe('library matching and duplicates', () => {
  it('finds tracked titles by provider id or by name + type', () => {
    const t = lib('Steins;Gate', [], { source: { provider: 'kitsu', id: '5646', url: '' }, altTitles: ['Steins Gate'] })
    const idx = indexLibrary([t])
    expect(findTracked(cand('Something else', [], { source: { provider: 'kitsu', id: '5646', url: '' } }), idx)).toBe(t)
    expect(findTracked(cand('steins gate', [], { source: { provider: 'tvmaze', id: '1', url: '' } }), idx)).toBe(t)
    expect(findTracked(cand('Steins;Gate', [], { mediaType: 'movie' }), idx)).toBeUndefined()
  })

  it('merges the same title from two providers, keeping the first', () => {
    const a = cand('Cowboy Bebop', ['Action'], { year: 1998 })
    const b = cand('Cowboy Bebop', ['Sci-Fi'], { year: 1998, source: { provider: 'tvmaze', id: '99', url: '' } })
    const remake = cand('Cowboy Bebop', ['Action'], { year: 2021, mediaType: 'tv' })
    expect(dedupe([a, b, a, remake])).toEqual([a, remake])
  })

  it('merges an anime series listed as TV by another provider a year apart, and spots it as tracked', () => {
    const kitsu = cand('Frieren', ['Adventure', 'Fantasy'], { year: 2023 })
    const tmdb = cand('Frieren', ['Adventure', 'Fantasy'], { year: 2024, mediaType: 'tv', source: { provider: 'tmdb', id: 'tv/209867', url: '' } })
    const film = cand('Frieren', ['Fantasy'], { year: 2023, mediaType: 'movie' })
    expect(dedupe([kitsu, tmdb, film])).toEqual([kitsu, film])
    const idx = indexLibrary([lib('Frieren', [], { mediaType: 'tv' })])
    expect(findTracked(kitsu, idx)).toBeDefined()
    expect(findTracked(film, idx)).toBeUndefined()
  })
})

describe('buildDiscover', () => {
  const library = [
    lib('Fullmetal Alchemist', ['Action', 'Adventure', 'Fantasy'], { rating: 10, source: { provider: 'kitsu', id: '1000', url: '' } }),
    lib('Death Note', ['Mystery', 'Thriller', 'Psychological'], { rating: 9 }),
    lib('Planned Show', ['Comedy'], { status: 'plan', mediaType: 'tv' }),
  ]
  const pool = [
    cand('Fullmetal Alchemist', ['Action'], { source: { provider: 'kitsu', id: '1000', url: '' } }), // tracked by id
    cand('Planned Show', ['Comedy'], { mediaType: 'tv', source: { provider: 'tvmaze', id: '5', url: '' } }), // tracked by name
    ...Array.from({ length: 8 }, (_, i) => cand(`Fantasy ${i}`, ['Action', 'Adventure', 'Fantasy'])),
    ...Array.from({ length: 6 }, (_, i) => cand(`Mystery ${i}`, ['Mystery', 'Thriller', 'Psychological'])),
    ...Array.from({ length: 6 }, (_, i) => cand(`Sitcom ${i}`, ['Comedy', 'Family'], { mediaType: 'tv', source: { provider: 'tvmaze', id: `${100 + i}`, url: '' } })),
    ...Array.from({ length: 3 }, (_, i) => cand(`Gem ${i}`, ['Slice of Life', 'Iyashikei'], { communityScore: 85, popularity: 0.2 })),
    // A later season whose first season isn't tracked: swapped for that first season (by Kitsu's relationship data).
    cand('Some Show Season 2', ['Action', 'Adventure', 'Fantasy'], { earlier: cand('Some Show', [], { year: 2018 }) }),
  ]

  it('excludes tracked, dismissed and duplicate titles, and never repeats a title across sections', () => {
    const dismissedKey = candidateKey(pool[2])
    const fb: Feedback = { ...emptyFeedback(), dismissed: { [dismissedKey]: { at: '', title: 'x', mediaType: 'anime', genres: [] } } }
    const { sections, personal } = buildDiscover([...pool, ...pool], [], library, fb, OPTS)
    const keys = allKeys(sections)
    expect(personal).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain(candidateKey(pool[0]))
    expect(keys).not.toContain(candidateKey(pool[1]))
    expect(keys).not.toContain(dismissedKey)
    expect(keys).not.toContain(candidateKey(pool[pool.length - 1]))
    expect(sections.map((s) => s.id)).toEqual(expect.arrayContaining(['for-you', 'gems']))
  })

  it('builds "Because You Watched" for a strong seed with enough matches', () => {
    const { sections } = buildDiscover(pool, [], library, emptyFeedback(), OPTS)
    expect(sections.some((s) => s.title === 'Because You Watched Fullmetal Alchemist' || s.title === 'Because You Watched Death Note')).toBe(true)
  })

  it('gives favourites beyond the top "Because You Watched" seeds their own row', () => {
    const third = lib('Mushishi', ['Mystery', 'Supernatural', 'Slice of Life'], { rating: 8 })
    const extra = Array.from({ length: 8 }, (_, i) => cand(`Calm ${i}`, ['Supernatural', 'Slice of Life']))
    const { sections } = buildDiscover([...pool, ...extra], [], [...library, third], emptyFeedback(), OPTS)
    const favs = sections.find((s) => s.id === 'top-rated')
    expect(favs?.recs.length).toBeGreaterThanOrEqual(3)
    expect(favs?.recs.some((r) => r.reason === 'Similar to Mushishi, which you rated 8/10')).toBe(true)
  })

  it('keeps a title added during this visit, flagged as tracked', () => {
    const added = lib('Fantasy 3', ['Action', 'Adventure', 'Fantasy'], { status: 'plan', source: pool[5].source })
    const key = candidateKey(pool[5])
    const without = allKeys(buildDiscover(pool, [], [...library, added], emptyFeedback(), OPTS).sections)
    expect(without).not.toContain(key)
    const kept = buildDiscover(pool, [], [...library, added], emptyFeedback(), { ...OPTS, keep: new Set([key]) })
    expect(kept.sections.flatMap((s) => s.recs).find((r) => r.key === key)?.tracked?.id).toBe(added.id)
  })

  it('filters by type and genre', () => {
    const tv = buildDiscover(pool, [], library, emptyFeedback(), { ...OPTS, type: 'tv' }).sections.flatMap((s) => s.recs)
    expect(tv.length).toBeGreaterThan(0)
    expect(tv.every((r) => r.c.mediaType === 'tv')).toBe(true)
    const mystery = buildDiscover(pool, [], library, emptyFeedback(), { ...OPTS, genre: 'mystery' }).sections.flatMap((s) => s.recs)
    expect(mystery.length).toBe(6)
  })

  it('"More like" includes related titles first, can show tracked ones, and never the title itself', () => {
    const fma = library[0]
    const sequel = cand('Brotherhood', ['Action', 'Adventure', 'Fantasy'])
    const links: Link[] = [{ key: candidateKey(sequel), seedId: fma.id, role: 'alternative_version' }]
    const { sections } = buildDiscover([...pool, sequel], links, library, emptyFeedback(), { ...OPTS, focus: fma.id })
    const focus = sections[0]
    expect(focus.id).toBe('focus')
    expect(focus.recs[0].key).toBe(candidateKey(sequel))
    expect(focus.recs[0].reason).toBe('Another version of Fullmetal Alchemist')
    expect(focus.recs.some((r) => r.tracked?.id === fma.id)).toBe(false)
  })

  it('works for an empty library: no personal sections, popular titles by type', () => {
    const { sections, personal } = buildDiscover(pool, [], [], emptyFeedback(), OPTS)
    expect(personal).toBe(false)
    expect(sections.map((s) => s.id)).not.toContain('for-you')
    expect(sections.find((s) => s.id === 'anime')?.recs.length).toBeGreaterThan(0)
    expect(sections.find((s) => s.id === 'tv')?.recs.length).toBe(7) // nothing is tracked, so "Planned Show" counts too
    expect(sections.flatMap((s) => s.recs).every((r) => !isPersonal(r))).toBe(true)
    expect(sections.every((s) => s.general)).toBe(true) // labelled as general picks, not personal
  })

  it('returns no sections, not an error, for an empty pool', () => {
    expect(buildDiscover([], [], library, emptyFeedback(), OPTS).sections).toEqual([])
  })
})

describe('genre similarity', () => {
  it('is Jaccard: a title with two tags does not fully match a seed with many', () => {
    const seed = ['action', 'fantasy', 'military', 'magic', 'drama', 'adventure']
    expect(genreSimilarity(['action', 'fantasy'], seed).sim).toBeCloseTo(2 / 6)
    expect(genreSimilarity(['action', 'fantasy', 'military', 'magic'], seed).sim).toBeGreaterThan(genreSimilarity(['action', 'fantasy'], seed).sim)
    expect(genreSimilarity(['action'], seed).sim).toBe(0)
  })

  it('keeps an anime’s "More like" row to anime when live-action shares only broad genres', () => {
    const fma = lib('Fullmetal Alchemist', ['Action', 'Adventure', 'Fantasy', 'Drama'], { rating: 10, source: { provider: 'kitsu', id: '1', url: '' } })
    const anime = Array.from({ length: 3 }, (_, i) => cand(`Anime ${i}`, ['Action', 'Fantasy', 'Magic']))
    const live = Array.from({ length: 3 }, (_, i) => cand(`Live ${i}`, ['Action', 'Fantasy', 'Crime'], { mediaType: 'tv', source: { provider: 'tvmaze', id: `${900 + i}`, url: '' } }))
    const row = buildDiscover([...live, ...anime], [], [fma], emptyFeedback(), { ...OPTS, focus: fma.id }).sections.find((s) => s.id === 'focus')
    expect(row?.recs.map((r) => r.c.title).sort()).toEqual(['Anime 0', 'Anime 1', 'Anime 2'])
  })
})

describe('profile and factors', () => {
  it('uses several top-rated titles across genres, each with its own picks and factual reasons', () => {
    const library = [
      lib('Frieren', ['Adventure', 'Fantasy', 'Drama'], { rating: 10, year: 2023 }),
      lib('Monster', ['Mystery', 'Thriller', 'Psychological'], { rating: 9, year: 2004 }),
      lib('Haikyu', ['Sports', 'Comedy', 'School'], { rating: 8, year: 2014 }),
    ]
    const pool = [
      ...Array.from({ length: 4 }, (_, i) => cand(`Quest ${i}`, ['Adventure', 'Fantasy', 'Drama'], { year: 2020 })),
      ...Array.from({ length: 4 }, (_, i) => cand(`Case ${i}`, ['Mystery', 'Thriller', 'Psychological'], { year: 2010 })),
      ...Array.from({ length: 4 }, (_, i) => cand(`Rally ${i}`, ['Sports', 'Comedy', 'School'], { year: 2016 })),
      ...Array.from({ length: 4 }, (_, i) => cand(`Other ${i}`, ['Horror', 'Gore'])),
    ]
    const { sections, personal } = buildDiscover(pool, [], library, emptyFeedback(), OPTS)
    expect(personal).toBe(true)
    const forYou = sections.find((s) => s.id === 'for-you')!
    expect(new Set(forYou.recs.map((r) => r.seedId)).size).toBe(3) // every top-rated title is represented
    expect(forYou.recs.some((r) => r.c.title.startsWith('Other'))).toBe(false)
    const r = forYou.recs[0]
    expect(r.match).toBeGreaterThan(0)
    expect(r.match).toBeLessThanOrEqual(100)
    expect(r.factors.length).toBeGreaterThan(1)
    expect(r.factors[0].points).toBeGreaterThanOrEqual(r.factors[r.factors.length - 1].points) // biggest first
    expect(r.factors.some((f) => /^Shares .* with (Frieren|Monster|Haikyu)$/.test(f.label))).toBe(true)
  })

  it('scores titles with no genres, rating, popularity or year without NaN, and drops ones it cannot judge or show', () => {
    const library = [lib('Seed', ['Action', 'Drama'], { rating: 9, year: 2015 })]
    const bare = cand('Bare', ['Action', 'Drama'], { communityScore: null, popularity: null, year: null })
    const noGenres = cand('No Genres', [])
    const noArt = cand('No Art', ['Action', 'Drama'], { posterUrl: null, thumbUrl: null })
    const untitled = cand('Untitled', ['Action', 'Drama'])
    const r = scoreCandidate(bare, buildProfile(library, emptyFeedback()), [])
    expect(Number.isFinite(r.score)).toBe(true)
    expect(Number.isFinite(r.match)).toBe(true)
    expect(allKeys(buildDiscover([bare, noGenres, noArt, untitled], [], library, emptyFeedback(), OPTS).sections)).toEqual([candidateKey(bare)])
  })

  it('still recommends when the most obvious picks are already in the library', () => {
    const library = [lib('Fullmetal Alchemist', ['Action', 'Adventure', 'Fantasy'], { rating: 10 })]
    const obvious = Array.from({ length: 4 }, (_, i) => cand(`Obvious ${i}`, ['Action', 'Adventure', 'Fantasy'], { popularity: 1, communityScore: 90 }))
    const saved = obvious.map((c) => lib(c.title, c.genres, { status: 'plan', source: c.source }))
    const rest = Array.from({ length: 4 }, (_, i) => cand(`Next ${i}`, ['Action', 'Fantasy', 'Magic']))
    const keys = allKeys(buildDiscover([...obvious, ...rest], [], [...library, ...saved], emptyFeedback(), OPTS).sections)
    for (const c of obvious) expect(keys).not.toContain(candidateKey(c))
    expect(keys.length).toBe(4)
  })

  it('breaks ties the same way every time, whatever order the providers answered in', () => {
    const library = [lib('Seed', ['Action', 'Drama'], { rating: 9 })]
    const pool = Array.from({ length: 10 }, (_, i) => cand(`Twin ${i}`, ['Action', 'Drama']))
    const a = allKeys(buildDiscover(pool, [], library, emptyFeedback(), OPTS).sections)
    expect(allKeys(buildDiscover([...pool].reverse(), [], library, emptyFeedback(), OPTS).sections)).toEqual(a)
    // "Another set" only reshuffles exact ties: same titles.
    expect(new Set(allKeys(buildDiscover(pool, [], library, emptyFeedback(), { ...OPTS, round: 1 }).sections))).toEqual(new Set(a))
  })

  it('handles a tiny catalogue', () => {
    const { sections } = buildDiscover([cand('Only', ['Action', 'Drama'])], [], [lib('Seed', ['Action', 'Drama'], { rating: 9 })], emptyFeedback(), OPTS)
    expect(allKeys(sections)).toHaveLength(1)
  })
})

describe('sequels and seasons (Kitsu relationship data only)', () => {
  const s1 = cand('Show', ['Action', 'Drama'], { year: 2018 })
  const s2 = cand('Show 2', ['Action', 'Drama'], { year: 2020, earlier: { ...s1, genres: [] } })
  const s3 = cand('Show 3', ['Action', 'Drama'], { year: 2022, earlier: s2 })
  const byKey = new Map([s1, s2, s3].map((c) => [candidateKey(c), c]))

  it('suggests the first entry when nothing of the series is tracked', () => {
    expect(entryPoint(s3, byKey, indexLibrary([]))).toBe(s1)
  })

  it('suggests the next entry after a completed one, and nothing after a planned or dropped one', () => {
    const done = indexLibrary([lib('Show', [], { source: s1.source })])
    expect(entryPoint(s2, byKey, done)).toBe(s2)
    expect(entryPoint(s3, byKey, done)).toBe(s2)
    expect(entryPoint(s2, byKey, indexLibrary([lib('Show', [], { status: 'plan', source: s1.source })]))).toBeNull()
    expect(entryPoint(s2, byKey, indexLibrary([lib('Show', [], { status: 'dropped', source: s1.source })]))).toBeNull()
  })

  it('never excludes a standalone or a title without relationship data, whatever its name', () => {
    const standalone = cand('Mob Psycho 100', ['Action'], { earlier: null })
    const unknown = cand('Some Show Season 2', ['Action']) // no relationship data: nothing assumed
    expect(entryPoint(standalone, byKey, indexLibrary([]))).toBe(standalone)
    expect(entryPoint(unknown, byKey, indexLibrary([]))).toBe(unknown)
  })

  it('skips a later entry when the entry before it is only known by reference (it may not be the start)', () => {
    const lone = cand('Lone 3', ['Action', 'Drama'], { earlier: cand('Lone 2', []) })
    expect(entryPoint(lone, new Map(), indexLibrary([]))).toBeNull()
    // …unless that entry is tracked: then the library decides.
    expect(entryPoint(lone, new Map(), indexLibrary([lib('Lone 2', [], { source: lone.earlier!.source })]))).toBe(lone)
  })

  it('ignores "sequel" links from titles the user has only planned', () => {
    const planned = lib('Planned', ['Action', 'Drama'], { status: 'plan' })
    const sequel = cand('Planned 2', [])
    const links: Link[] = [{ key: candidateKey(sequel), seedId: planned.id, role: 'sequel' }]
    expect(allKeys(buildDiscover([sequel], links, [planned], emptyFeedback(), OPTS).sections)).not.toContain(candidateKey(sequel))
  })
})

describe('buildSimilar (title details)', () => {
  it('lists related and genre-similar titles with what they share, never the title itself or tracked ones', () => {
    const t = lib('Mushishi', ['Mystery', 'Supernatural', 'Slice of Life'], { rating: 9, year: 2005, source: { provider: 'kitsu', id: '77', url: '' } })
    const self = cand('Mushishi', ['Mystery', 'Supernatural', 'Slice of Life'], { source: t.source! })
    const sideStory = cand('Mushishi Special', [])
    const calm = cand('Natsume', ['Supernatural', 'Slice of Life', 'Drama'], { year: 2008 })
    const tracked = cand('Tracked', ['Supernatural', 'Slice of Life'])
    const loud = cand('Loud', ['Action', 'Mecha'])
    const library = [t, lib('Tracked', [], { source: tracked.source })]
    const links: Link[] = [{ key: candidateKey(sideStory), seedId: t.id, role: 'side_story' }]
    const recs = buildSimilar([self, sideStory, calm, tracked, loud], links, library, emptyFeedback(), t.id)
    const byTitle = new Map(recs.map((r) => [r.c.title, r]))
    expect([...byTitle.keys()].sort()).toEqual(['Mushishi Special', 'Natsume'])
    expect(byTitle.get('Mushishi Special')?.reason).toBe('Side story of Mushishi')
    expect(byTitle.get('Natsume')?.shared).toEqual(['Supernatural', 'Slice of Life', 'Anime', '2000s'])
  })

  it('returns nothing for an unknown title or an empty pool', () => {
    expect(buildSimilar([], [], [], emptyFeedback(), 'nope')).toEqual([])
    const t = lib('X', ['Action', 'Drama'])
    expect(buildSimilar([], [], [t], emptyFeedback(), t.id)).toEqual([])
  })
})
