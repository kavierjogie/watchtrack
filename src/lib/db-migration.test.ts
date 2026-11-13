import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'

describe('IndexedDB schema upgrade', () => {
  it('upgrades a version 1 library in place and counts its episodes by index', async () => {
    // A library as the first release stored it.
    const v1 = await openDB('watchtrack', 1, {
      upgrade(db) {
        const titles = db.createObjectStore('titles', { keyPath: 'id' })
        titles.createIndex('byUpdated', 'updatedAt')
        titles.createIndex('byStatus', 'status')
        const history = db.createObjectStore('watchHistory', { keyPath: 'id' })
        history.createIndex('byTitle', 'titleId')
        history.createIndex('byAt', 'at')
        db.createObjectStore('images', { keyPath: 'id' })
        db.createObjectStore('settings', { keyPath: 'key' })
      },
    })
    await v1.put('titles', { id: 't1', title: 'Kept', updatedAt: '2026-01-01T00:00:00.000Z', status: 'watching' })
    for (const [id, kind] of [['h1', 'episode'], ['h2', 'episode'], ['h3', 'season'], ['h4', 'episode']])
      await v1.put('watchHistory', { id, kind, titleId: 't1', at: '2026-01-01T00:00:00.000Z' })
    v1.close()

    // Imported only now, so it opens the database after the old version exists.
    const { countEpisodes, listTitles } = await import('./db')
    expect(await countEpisodes()).toBe(3)
    expect((await listTitles()).map((t) => t.title)).toEqual(['Kept'])
  })
})
