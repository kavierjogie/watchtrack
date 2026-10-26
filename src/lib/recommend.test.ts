import { describe, expect, it } from 'vitest'
import {
  buildDiscover,
  buildProfile,
  candidateKey,
  dedupe,
  emptyFeedback,
  findTracked,
  indexLibrary,
  looksLikeSequel,
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
    posterUrl: null,
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
    expect(near.reason).toBe('Similar to your favourite, Fullmetal Alchemist')
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

  it('spots later seasons by name', () => {
    expect(looksLikeSequel('Attack on Titan Season 3 Part 2')).toBe(true)
    expect(looksLikeSequel('Jujutsu Kaisen 2nd Season')).toBe(true)
    expect(looksLikeSequel('Assassination Classroom Second Season')).toBe(true)
    expect(looksLikeSequel("KonoSuba: God's Blessing on This Wonderful World! 3")).toBe(true)
    expect(looksLikeSequel('Mob Psycho 100')).toBe(false)
    expect(looksLikeSequel('Steins;Gate')).toBe(false)
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
    cand('Some Show Season 2', ['Action', 'Adventure', 'Fantasy']), // unlinked later season
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
    const favs = sections.find((s) => s.id === 'favourites')
    expect(favs?.recs.length).toBeGreaterThanOrEqual(3)
    expect(favs?.recs.some((r) => r.reason === 'Similar to your favourite, Mushishi')).toBe(true)
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
    const sequel = cand('Brotherhood', [])
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
    expect(sections.flatMap((s) => s.recs).every((r) => r.kind === 'popular' || r.kind === 'quality')).toBe(true)
  })

  it('returns no sections, not an error, for an empty pool', () => {
    expect(buildDiscover([], [], library, emptyFeedback(), OPTS).sections).toEqual([])
  })
})
