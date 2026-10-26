import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyImport, createBackup, parseBackup, planImport, resolveImport } from './backup'
import { clearAll, deleteTitle, getImage, getTitle, listHistory, listTitles, putImage, saveTitle, undoHistory } from './db'
import { setLastWatched } from './progress'
import { toSharedItem } from './share'
import { applyMarkWatched, applyMovieWatched, applyProgress, createTitle } from './titles'

const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' })

beforeEach(async () => {
  await clearAll()
})

describe('IndexedDB persistence', () => {
  it('saves and reads back a title with progress', async () => {
    const t = createTitle({ title: 'Black Clover', mediaType: 'anime', status: 'watching' })
    t.progress = setLastWatched(t.progress!, null, 172)
    await saveTitle(t)
    const back = await getTitle(t.id)
    expect(back?.progress?.nextEpisode).toBe(173)
  })

  it('mark watched writes title + history atomically, and undo restores', async () => {
    const t = createTitle({ title: 'Spy x Family', mediaType: 'anime', status: 'watching' })
    t.progress = { ...t.progress!, numbering: 'seasonal', season: 3, nextEpisode: 5 }
    await saveTitle(t)
    const change = applyMarkWatched(t)!
    await saveTitle(change.title, change.history)
    expect((await getTitle(t.id))?.progress?.nextEpisode).toBe(6)
    const [h] = await listHistory(t.id)
    expect(h.episode).toBe(5)
    const restored = await undoHistory(change.title, h)
    expect(restored.progress?.nextEpisode).toBe(5)
    expect(await listHistory(t.id)).toHaveLength(0)
  })

  it('manual corrections are undoable', async () => {
    const t = createTitle({ title: 'Jujutsu Kaisen', mediaType: 'anime', status: 'watching' })
    await saveTitle(t)
    const c = applyProgress(t, setLastWatched(t.progress!, null, 16), 'Set last watched')
    await saveTitle(c.title, c.history)
    const [h] = await listHistory(t.id)
    expect((await undoHistory(c.title, h)).progress?.nextEpisode).toBe(1)
  })

  it('completed movies keep watched date and status', async () => {
    const m = createTitle({ title: 'I Want to Eat Your Pancreas', mediaType: 'movie' })
    expect(m.progress).toBeNull()
    const c = applyMovieWatched(m, '2026-10-01')
    await saveTitle(c.title, c.history)
    const back = await getTitle(m.id)
    expect(back).toMatchObject({ status: 'completed', watchedDate: '2026-10-01' })
    expect(back?.completedAt).not.toBeNull()
  })

  it('deleting a title removes its history and local poster', async () => {
    const imageId = await putImage(png())
    const t = createTitle({ title: 'Wednesday', mediaType: 'tv', status: 'watching', poster: { kind: 'local', imageId } })
    await saveTitle(t)
    const c = applyMarkWatched(t)!
    await saveTitle(c.title, c.history)
    await deleteTitle(t.id)
    expect(await getTitle(t.id)).toBeUndefined()
    expect(await listHistory(t.id)).toHaveLength(0)
    expect(await getImage(imageId)).toBeUndefined()
  })

  it('rejects invalid image types', async () => {
    await expect(putImage(new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow(/JPEG/)
  })
})

describe('backup export / import', () => {
  async function seed() {
    const imageId = await putImage(png())
    const a = createTitle({ title: 'Helluva Boss', mediaType: 'tv', status: 'watching', poster: { kind: 'local', imageId } })
    a.progress = setLastWatched(a.progress!, 2, 8)
    const c = applyMarkWatched(a)!
    await saveTitle(c.title, c.history)
    const b = createTitle({ title: 'Loki', mediaType: 'tv', status: 'completed' })
    await saveTitle(b)
    return { a: c.title, b, imageId }
  }

  it('round-trips titles, history and images through JSON', async () => {
    const { a, imageId } = await seed()
    const json = JSON.stringify(await createBackup())
    await clearAll()
    const backup = parseBackup(json)
    await applyImport(planImport(backup, []), 'replace', 'skip')
    const titles = await listTitles()
    expect(titles).toHaveLength(2)
    expect((await getTitle(a.id))?.progress).toMatchObject({ season: 2, nextEpisode: 10 })
    expect(await listHistory(a.id)).toHaveLength(1)
    const img = await getImage(imageId)
    expect(img?.type).toBe('image/png')
    expect(new Uint8Array(await img!.blob.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 1, 2, 3]))
  })

  it("keeps a downloaded poster's source URL through backup and restore, so it can still be shared", async () => {
    const url = 'https://static.tvmaze.com/uploads/images/original_untouched/595/1489169.jpg'
    const t = createTitle({ title: 'Stranger Things', mediaType: 'tv', poster: { kind: 'local', imageId: await putImage(png()), url } })
    await saveTitle(t)
    const json = JSON.stringify(await createBackup())
    await clearAll()
    await applyImport(planImport(parseBackup(json), []), 'replace', 'skip')
    const back = await getTitle(t.id)
    expect(back?.poster).toEqual(t.poster)
    expect(toSharedItem(back!).poster).toBe(url)
  })

  it('detects duplicates by id and by title', async () => {
    await seed()
    const backup = await createBackup()
    const extra = createTitle({ title: 'LOKI!', mediaType: 'tv' }) // same normalized title as existing Loki
    backup.titles.push(extra)
    const plan = planImport(backup, await listTitles())
    expect(plan.duplicates).toHaveLength(3)
    expect(plan.fresh).toHaveLength(0)
  })

  it('merge + skip leaves existing data untouched', async () => {
    const { a } = await seed()
    const backup = await createBackup()
    backup.titles = backup.titles.map((t) => ({ ...t, notes: 'from backup' }))
    await applyImport(planImport(backup, await listTitles()), 'merge', 'skip')
    expect((await getTitle(a.id))?.notes).toBe('')
  })

  it('merge + overwrite replaces matching titles', async () => {
    const { a } = await seed()
    const backup = await createBackup()
    backup.titles = backup.titles.map((t) => ({ ...t, notes: 'from backup' }))
    await applyImport(planImport(backup, await listTitles()), 'merge', 'overwrite')
    expect((await getTitle(a.id))?.notes).toBe('from backup')
    expect(await listTitles()).toHaveLength(2)
  })

  it('merge + keep-both adds copies without touching original history', async () => {
    const { a } = await seed()
    const backup = await createBackup()
    const data = resolveImport(planImport(backup, await listTitles()), 'merge', 'keep-both')
    expect(data.titles.every((t) => t.id !== a.id)).toBe(true)
    expect(data.history.every((h) => h.titleId !== a.id)).toBe(true)
    await applyImport(planImport(backup, await listTitles()), 'merge', 'keep-both')
    expect(await listTitles()).toHaveLength(4)
    expect(await listHistory(a.id)).toHaveLength(1)
  })

  it('rejects invalid files with a clear message', () => {
    expect(() => parseBackup('not json')).toThrow(/not valid JSON/)
    expect(() => parseBackup('{"format":"other"}')).toThrow(/not a WatchTrack backup/)
    expect(() =>
      parseBackup(JSON.stringify({ format: 'watchtrack-backup', version: 1, titles: [{ id: 'x', title: 'A', mediaType: 'book' }], history: [], images: [] })),
    ).toThrow(/invalid media type/)
    expect(() => parseBackup(JSON.stringify({ format: 'watchtrack-backup', version: 99, titles: [], history: [], images: [] }))).toThrow(
      /newer version/,
    )
  })
})
