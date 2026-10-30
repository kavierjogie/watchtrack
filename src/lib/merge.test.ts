import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, BACKUP_VERSION } from './backup'
import { mergeLibraries, parseSyncDoc, type SyncDoc } from './merge'
import { createTitle } from './titles'
import type { HistoryEntry, Title } from './types'

const NOW = Date.parse('2026-10-29T12:00:00Z')
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString()
const title = (name: string, updatedDaysAgo: number, id = name): Title => ({ ...createTitle({ title: name, mediaType: 'tv' }), id, updatedAt: at(updatedDaysAgo) })
const entry = (id: string, titleId: string): HistoryEntry => ({ id, titleId, at: at(1), kind: 'episode' }) as HistoryEntry
const doc = (part: Partial<SyncDoc>): SyncDoc => ({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: at(0), titles: [], history: [], images: [], deleted: [], ...part })

describe('parseSyncDoc with hostile dates', () => {
  it('ignores deletions with unreadable or future dates, and keeps real ones', () => {
    const real = new Date(Date.now() - 86_400_000).toISOString()
    const text = JSON.stringify(doc({ titles: [title('A', 1)], deleted: [{ id: 'A', at: 'z' }, { id: 'B', at: '9999-01-01T00:00:00.000Z' }, { id: 'C', at: real }] }))
    expect(parseSyncDoc(text).deleted).toEqual([{ id: 'C', at: real }])
  })

  it('makes a far-future edit lose to a real one', () => {
    const local = title('A', 1)
    const remote = parseSyncDoc(JSON.stringify(doc({ titles: [{ ...title('A', 3), notes: 'forged', createdAt: at(30), updatedAt: '9999' }] })))
    const r = mergeLibraries(doc({ titles: [local] }), remote, Date.now())
    expect(r.doc.titles[0].notes).toBe(local.notes)
    expect(r.toLocal.titles).toEqual([])
    expect(r.push).toBe(true)
  })
})

describe('poster copies that differ only between devices', () => {
  const URL = 'https://media.kitsu.app/anime/1/large.jpg'
  const image = (id: string) => ({ id, type: 'image/jpeg', createdAt: at(1), data: 'AA==' })
  const withPoster = (poster: Title['poster']) => ({ ...title('A', 1), poster })
  const remoteUrl = withPoster({ kind: 'remote', url: URL })
  const copy = (imageId: string) => withPoster({ kind: 'local', imageId, url: URL })

  it("uses the copy Drive already has instead of downloading another", () => {
    const r = mergeLibraries(doc({ titles: [remoteUrl] }), doc({ titles: [copy('b')], images: [image('b')] }), NOW)
    expect(r.toLocal.titles[0].poster).toEqual(copy('b').poster)
    expect(r.toLocal.images.map((i) => i.id)).toEqual(['b'])
    expect(r.push).toBe(false)
  })

  it('keeps a local copy over a remote URL, and uploads it', () => {
    const r = mergeLibraries(doc({ titles: [copy('a')], images: [image('a')] }), doc({ titles: [remoteUrl] }), NOW)
    expect(r.doc.titles[0].poster).toEqual(copy('a').poster)
    expect(r.toLocal.titles).toEqual([])
    expect(r.push).toBe(true)
  })

  it('two devices with different copies settle on one, so uploads stop', () => {
    const first = mergeLibraries(doc({ titles: [copy('b')], images: [image('b')] }), doc({ titles: [copy('a')], images: [image('a')] }), NOW)
    expect(first.toLocal.titles[0].poster).toEqual(copy('a').poster)
    expect(first.push).toBe(false)
    const other = mergeLibraries(doc({ titles: [copy('a')], images: [image('a')] }), doc({ titles: [copy('b')], images: [image('b')] }), NOW)
    expect(other.doc.titles[0].poster).toEqual(copy('a').poster)
    expect(other.toLocal.titles).toEqual([])
  })

  it("another device's edit doesn't throw away the copy saved here", () => {
    const edited = { ...remoteUrl, updatedAt: at(0), notes: 'from B' }
    const r = mergeLibraries(doc({ titles: [copy('a')], images: [image('a')] }), doc({ titles: [edited] }), NOW)
    expect(r.toLocal.titles[0]).toMatchObject({ notes: 'from B', poster: copy('a').poster })
    expect(r.doc.images.map((i) => i.id)).toEqual(['a'])
  })

  it("an edit here picks up the copy Drive already has", () => {
    const edited = { ...remoteUrl, updatedAt: at(0), notes: 'mine' }
    const r = mergeLibraries(doc({ titles: [edited] }), doc({ titles: [copy('b')], images: [image('b')] }), NOW)
    expect(r.toLocal.titles[0]).toMatchObject({ notes: 'mine', poster: copy('b').poster })
    expect(r.toLocal.images.map((i) => i.id)).toEqual(['b'])
  })

  it('a poster really changed to a different image is respected', () => {
    const changed = { ...withPoster({ kind: 'remote', url: 'https://static.tvmaze.com/new.jpg' }), updatedAt: at(0) }
    const r = mergeLibraries(doc({ titles: [copy('a')], images: [image('a')] }), doc({ titles: [changed] }), NOW)
    expect(r.toLocal.titles[0].poster).toEqual(changed.poster)
  })

  it('an edit still beats a poster copy', () => {
    const edited = { ...withPoster({ kind: 'remote', url: URL }), updatedAt: at(0), notes: 'mine' }
    const r = mergeLibraries(doc({ titles: [edited] }), doc({ titles: [copy('b')], images: [image('b')] }), NOW)
    expect(r.doc.titles[0].notes).toBe('mine')
  })

  it('a removed poster is not brought back', () => {
    const r = mergeLibraries(doc({ titles: [withPoster(null)] }), doc({ titles: [copy('b')], images: [image('b')] }), NOW)
    expect(r.doc.titles[0].poster).toBeNull()
  })
})

describe('mergeLibraries', () => {
  it('uploads everything when Drive has no copy yet', () => {
    const r = mergeLibraries(doc({ titles: [title('A', 1)] }), null, NOW)
    expect(r.push).toBe(true)
    expect(r.doc.titles.map((t) => t.id)).toEqual(['A'])
    expect(r.toLocal.titles).toEqual([])
  })

  it('keeps the newer edit of each title, from either side', () => {
    const local = doc({ titles: [title('A', 1), { ...title('B', 5), notes: 'old' }] })
    const remote = doc({ titles: [title('A', 3), { ...title('B', 2), notes: 'new' }, title('C', 4)] })
    const r = mergeLibraries(local, remote, NOW)
    expect(r.doc.titles.map((t) => t.id).sort()).toEqual(['A', 'B', 'C'])
    expect(r.doc.titles.find((t) => t.id === 'B')?.notes).toBe('new')
    expect(r.toLocal.titles.map((t) => t.id).sort()).toEqual(['B', 'C'])
    expect(r.push).toBe(true) // A is newer here
  })

  it('does nothing when both sides already match', () => {
    const same = doc({ titles: [title('A', 1)], history: [entry('h1', 'A')] })
    const r = mergeLibraries(same, same, NOW)
    expect(r.push).toBe(false)
    expect(r.toLocal).toMatchObject({ titles: [], history: [], images: [], deleteIds: [] })
  })

  it('unions history, dropping entries for deleted titles and undone entries', () => {
    const local = doc({ titles: [title('A', 1)], history: [entry('h1', 'A')] })
    const remote = doc({ titles: [title('A', 1)], history: [entry('h1', 'A'), entry('h2', 'A'), entry('h3', 'A')], deleted: [{ id: 'h3', at: at(1) }] })
    const r = mergeLibraries(local, remote, NOW)
    expect(r.doc.history.map((h) => h.id).sort()).toEqual(['h1', 'h2'])
    expect(r.toLocal.history.map((h) => h.id)).toEqual(['h2'])
  })

  it('a deletion beats an older title but not a newer edit', () => {
    const local = doc({ titles: [title('A', 5), title('B', 1)], history: [entry('hA', 'A')] })
    const remote = doc({ titles: [title('A', 5), title('B', 5)], deleted: [{ id: 'A', at: at(2) }, { id: 'B', at: at(2) }] })
    const r = mergeLibraries(local, remote, NOW)
    expect(r.doc.titles.map((t) => t.id)).toEqual(['B'])
    expect(r.toLocal.deleteIds.sort()).toEqual(['A', 'hA'])
    expect(r.doc.deleted.map((d) => d.id)).toEqual(['A'])
  })

  it('forgets deletions after 90 days', () => {
    const r = mergeLibraries(doc({ deleted: [{ id: 'old', at: at(91) }, { id: 'new', at: at(10) }] }), null, NOW)
    expect(r.doc.deleted.map((d) => d.id)).toEqual(['new'])
  })

  it('only keeps uploaded posters a title still uses', () => {
    const t = { ...title('A', 1), poster: { kind: 'local' as const, imageId: 'img1' } }
    const img = (id: string) => ({ id, type: 'image/png', createdAt: at(1), data: 'AAAA' })
    const r = mergeLibraries(doc({ titles: [t] }), doc({ titles: [t], images: [img('img1'), img('orphan')] }), NOW)
    expect(r.doc.images.map((i) => i.id)).toEqual(['img1'])
    expect(r.toLocal.images.map((i) => i.id)).toEqual(['img1'])
  })
})

describe('parseSyncDoc', () => {
  it('reads a Drive copy and rejects a bad deletion list', () => {
    const ok = JSON.stringify(doc({ deleted: [{ id: 'x', at: at(1) }] }))
    expect(parseSyncDoc(ok).deleted).toEqual([{ id: 'x', at: at(1) }])
    expect(() => parseSyncDoc(JSON.stringify({ ...doc({}), deleted: [{ id: 1 }] }))).toThrow(/deletion list/)
  })
})
