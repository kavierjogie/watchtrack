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
