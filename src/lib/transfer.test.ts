import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, BACKUP_VERSION, type Backup } from './backup'
import { packFragment } from './share'
import { createTitle } from './titles'
import { decodeTransfer } from './transfer'

const backup = (n: number): Backup => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: '2026-10-29T12:00:00.000Z',
  titles: Array.from({ length: n }, (_, i) => ({ ...createTitle({ title: `Show ${i} ${crypto.randomUUID()}`, mediaType: 'tv', status: 'watching' }), notes: 'private note' })),
  history: [],
  images: [{ id: 'img', type: 'image/png', createdAt: '2026-10-29T12:00:00.000Z', data: 'AAAA' }],
})

describe('transfer links', () => {
  it('still opens links made before creating them was removed', async () => {
    const b = backup(3)
    const out = await decodeTransfer(`#${await packFragment(JSON.stringify({ ...b, images: [] }))}`)
    expect(out.titles.map((t) => [t.id, t.title, t.notes])).toEqual(b.titles.map((t) => [t.id, t.title, 'private note']))
    expect(out.images).toEqual([])
  })

  it('rejects damaged and non-library payloads', async () => {
    await expect(decodeTransfer('#not*valid')).rejects.toThrow(/damaged/)
    await expect(decodeTransfer(`#${await packFragment('{"format":"something-else"}')}`)).rejects.toThrow(/not a WatchTrack backup/)
    await expect(decodeTransfer(`#${await packFragment('{"format":"watchtrack-backup","version":1,"titles":[{"id":1}],"history":[],"images":[]}')}`)).rejects.toThrow()
  })
})
