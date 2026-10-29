import { describe, expect, it } from 'vitest'
import { setLastWatched } from './progress'
import { decodeShare, encodeShare, MAX_PAYLOAD_CHARS, ShareError, shareUrl, sharedToTitle, toMyPlan, toSharedItem } from './share'
import { createTitle } from './titles'
import type { Title } from './types'

const toB64Url = (s: string | Uint8Array) => {
  const bytes = typeof s === 'string' ? new TextEncoder().encode(s) : s
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
/** Build a payload by hand, the way an attacker (or a broken encoder) would. */
async function craft(json: unknown) {
  const out = await new Response(new Blob([JSON.stringify(json)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  return toB64Url(new Uint8Array(out))
}
const item = { title: 'Frieren', type: 'anime', status: 'watching' }

function sample(): Title[] {
  const spy = createTitle({ title: 'Spy x Family', mediaType: 'anime', status: 'watching', year: 2022, rating: 9, poster: { kind: 'remote', url: 'https://media.kitsu.app/x.jpg' } })
  spy.progress = { ...setLastWatched({ ...spy.progress!, numbering: 'seasonal', season: 2 }, 2, 8), seasonEpisodeCounts: { 2: 12 }, totalSeasons: 3 }
  spy.notes = 'private note'
  const movie = createTitle({ title: 'Dune', mediaType: 'movie', status: 'completed', poster: { kind: 'local', imageId: 'img1' } })
  return [spy, movie]
}

describe('share links', () => {
  it('round-trips titles through a URL-safe fragment', async () => {
    const payload = await encodeShare(sample())
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(shareUrl(payload, 'https://watchtrack.app')).toBe(`https://watchtrack.app/shared#${payload}`)

    const [spy, movie] = (await decodeShare(`#${payload}`)).map(sharedToTitle)
    expect(spy).toMatchObject({ title: 'Spy x Family', mediaType: 'anime', status: 'watching', year: 2022, rating: 9, poster: { kind: 'remote', url: 'https://media.kitsu.app/x.jpg' } })
    expect(spy.progress).toMatchObject({ numbering: 'seasonal', season: 2, nextEpisode: 9, seasonEpisodeCounts: { 2: 12 }, totalSeasons: 3 })
    expect(movie).toMatchObject({ title: 'Dune', mediaType: 'movie', status: 'completed', progress: null, poster: null })
  })

  it('leaves out notes, ids, timestamps and local images', () => {
    const json = JSON.stringify(sample().map(toSharedItem))
    for (const leak of ['private note', 'img1', 'createdAt', 'updatedAt', '"id"', 'history']) expect(json).not.toContain(leak)
  })

  it('refuses to build a link that is too long instead of truncating', async () => {
    // Random-ish titles so compression can't squeeze them.
    const many = Array.from({ length: 3000 }, (_, i) => createTitle({ title: `${i} ${Math.random().toString(36)}${Math.random().toString(36)}`, mediaType: 'tv' }))
    await expect(encodeShare(many)).rejects.toThrow(/too many for one link/)
  })

  it('encodes an empty list, which opens as an empty watchlist', async () => {
    expect(await decodeShare(await encodeShare([]))).toEqual([])
  })

  it.each([
    ['empty fragment', ''],
    ['bad characters', 'abc$%<script>'],
    ['not deflate data', 'aGVsbG8gd29ybGQ'],
    ['oversized fragment', 'A'.repeat(MAX_PAYLOAD_CHARS + 1)],
  ])('rejects %s with a ShareError', async (_, frag) => {
    await expect(decodeShare(frag)).rejects.toBeInstanceOf(ShareError)
  })

  it('rejects a truncated link', async () => {
    const payload = await encodeShare(sample())
    await expect(decodeShare(payload.slice(0, payload.length / 2))).rejects.toBeInstanceOf(ShareError)
  })

  it.each([
    ['non-JSON', 'not json'],
    ['wrong shape', [1, 2]],
    ['missing items', { v: 1 }],
    ['newer version', { v: 99, items: [] }],
    ['bad media type', { v: 1, items: [{ ...item, type: 'book' }] }],
    ['bad status', { v: 1, items: [{ ...item, status: 'hacked' }] }],
    ['empty title', { v: 1, items: [{ ...item, title: '  ' }] }],
    ['huge title', { v: 1, items: [{ ...item, title: 'x'.repeat(501) }] }],
    ['javascript: poster', { v: 1, items: [{ ...item, poster: 'javascript:alert(1)' }] }],
    ['negative episode', { v: 1, items: [{ ...item, progress: { numbering: 'absolute', next: -3 } }] }],
    ['string season', { v: 1, items: [{ ...item, progress: { numbering: 'seasonal', season: '2' } }] }],
    ['too many items', { v: 1, items: Array(2001).fill(item) }],
  ])('rejects a crafted payload with %s', async (_, json) => {
    const frag = typeof json === 'string' ? toB64Url(json) : await craft(json)
    await expect(decodeShare(frag)).rejects.toBeInstanceOf(ShareError)
  })

  it('explains links from a newer version', async () => {
    await expect(decodeShare(await craft({ v: 2, items: [] }))).rejects.toThrow(/newer version/)
  })

  it('stops a decompression bomb before it fills memory', async () => {
    const frag = await craft({ v: 1, items: [], pad: ' '.repeat(2_000_000) })
    expect(frag.length).toBeLessThan(MAX_PAYLOAD_CHARS)
    await expect(decodeShare(frag)).rejects.toThrow(/too large/)
  })

  it('keeps markup in titles as plain data', async () => {
    const [t] = await decodeShare(await craft({ v: 1, items: [{ ...item, title: '<img src=x onerror=alert(1)>' }] }))
    expect(t.title).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('toMyPlan', () => {
  it("starts a friend's title from episode 1 in Plan to Watch, keeping its episode counts", () => {
    const friend = createTitle({ title: 'Frieren', mediaType: 'anime', status: 'completed', rating: 9 })
    friend.progress = { ...friend.progress!, nextEpisode: 20, totalEpisodes: 28 }
    const mine = toMyPlan(friend)
    expect(mine).toMatchObject({ status: 'plan', rating: null, completedAt: null })
    expect(mine.progress).toMatchObject({ nextEpisode: 1, totalEpisodes: 28, numbering: 'absolute' })
  })
})
