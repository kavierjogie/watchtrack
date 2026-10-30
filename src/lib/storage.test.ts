import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyImport, createBackup, parseBackup, planImport, resolveImport, type Backup } from './backup'
import { clearAll, deleteTitle, getImage, getTitle, listHistory, listTitles, listTombstones, putImage, saveTitle, undoHistory } from './db'
import { mergeLibraries, type Tombstone } from './merge'
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

  describe('restoring while Drive sync is on', () => {
    const merged = async (remote: Backup, deleted: Tombstone[] = []) => mergeLibraries({ ...(await createBackup()), deleted: await listTombstones() }, { ...remote, deleted })

    it('beats a newer Drive version and an earlier deletion', async () => {
      const t = { ...createTitle({ title: 'Loki', mediaType: 'tv' }), notes: 'from backup', updatedAt: '2020-01-01T00:00:00.000Z' }
      await saveTitle(t)
      const backup = await createBackup()
      const remote = { ...backup, titles: [{ ...t, notes: 'from drive', updatedAt: '2021-01-01T00:00:00.000Z' }] }

      await applyImport(planImport(backup, await listTitles()), 'merge', 'overwrite', true)
      expect((await merged(remote)).doc.titles.map((x) => x.notes)).toEqual(['from backup'])

      const res = await merged({ ...backup, titles: [] }, [{ id: t.id, at: '2021-01-01T00:00:00.000Z' }])
      expect(res.doc.titles.map((x) => x.id)).toEqual([t.id])
      expect(res.toLocal.deleteIds).toEqual([])
    })

    it('Replace keeps removed titles from coming back', async () => {
      const a = createTitle({ title: 'Loki', mediaType: 'tv' })
      const b = createTitle({ title: 'Wednesday', mediaType: 'tv', status: 'watching' })
      await saveTitle(a)
      const backup = await createBackup()
      const c = applyMarkWatched(b)!
      await saveTitle(c.title, c.history)
      const remote = await createBackup()

      await applyImport(planImport(backup, await listTitles()), 'replace', 'skip', true)
      const res = await merged(remote)
      expect(res.doc.titles.map((t) => t.id)).toEqual([a.id])
      expect(res.doc.history).toEqual([])
      expect(res.toLocal.titles.filter((t) => t.id === b.id)).toEqual([])
      expect(res.push).toBe(true)
    })

    it('without sync, import leaves dates and deletions alone', async () => {
      const t = { ...createTitle({ title: 'Loki', mediaType: 'tv' }), updatedAt: '2020-01-01T00:00:00.000Z' }
      const other = createTitle({ title: 'Wednesday', mediaType: 'tv' })
      await saveTitle(t)
      const backup = await createBackup()
      await saveTitle(other)
      await applyImport(planImport(backup, await listTitles()), 'replace', 'skip')
      expect((await getTitle(t.id))?.updatedAt).toBe(t.updatedAt)
      expect(await listTombstones()).toEqual([])
    })
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

describe('backup import hardening', () => {
  const file = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      format: 'watchtrack-backup',
      version: 1,
      titles: [{ ...createTitle({ title: 'Frieren', mediaType: 'anime' }), ...over }],
      history: [],
      images: [],
      ...extra,
    })

  it('drops non-http links and wrongly typed fields instead of trusting them', () => {
    const [t] = parseBackup(
      file({
        source: { provider: 'kitsu', id: '1', url: 'javascript:alert(1)' },
        poster: { kind: 'remote', url: 'data:text/html,<script>alert(1)</script>' },
        backdropUrl: 'javascript:alert(1)',
        genres: 'Action',
        altTitles: [1, 'Sousou no Frieren'],
        notes: { evil: true },
        sync: { checkedAt: '2026-01-01', sequel: { anilistId: 1, title: 'S2', status: 'X', url: 'javascript:alert(1)' } },
      }),
    ).titles
    expect(t.source).toBeNull()
    expect(t.poster).toBeNull()
    expect(t.backdropUrl).toBeNull()
    expect(t.genres).toEqual([])
    expect(t.altTitles).toEqual(['Sousou no Frieren'])
    expect(t.notes).toBe('')
    expect(t.sync?.sequel).toBeNull()
  })

  it('rejects unusable progress numbers', () => {
    const bad = (progress: Record<string, unknown>) => () =>
      parseBackup(file({ progress: { numbering: 'absolute', season: null, nextEpisode: 1, seasonEpisodeCounts: {}, totalSeasons: null, totalEpisodes: null, skipped: [], rewatching: false, ...progress } }))
    expect(bad({ nextEpisode: 1.5 })).toThrow(/invalid episode progress/)
    expect(bad({ skipped: [{ season: null, from: 1, to: '9' }] })).toThrow(/invalid progress details/)
    expect(bad({ seasonEpisodeCounts: { 1: '12' } })).toThrow(/invalid progress details/)
    expect(bad({ totalEpisodes: -1 })).toThrow(/invalid episode totals/)
  })

  it('rejects duplicate ids and non-image or corrupt images', () => {
    const t = createTitle({ title: 'A', mediaType: 'tv' })
    expect(() => parseBackup(JSON.stringify({ format: 'watchtrack-backup', version: 1, titles: [t, t], history: [], images: [] }))).toThrow(/appears twice/)
    const img = { id: 'i', createdAt: '2026-01-01', type: 'image/png', data: 'aGVsbG8=' }
    expect(() => parseBackup(file({}, { images: [img] }))).not.toThrow()
    expect(() => parseBackup(file({}, { images: [{ ...img, type: 'text/html' }] }))).toThrow(/invalid image/)
    expect(() => parseBackup(file({}, { images: [{ ...img, data: 'not base64!' }] }))).toThrow(/invalid image/)
  })

  it('drops undo snapshots that would restore broken progress', () => {
    const t = createTitle({ title: 'A', mediaType: 'tv' })
    const h = { id: 'h', titleId: t.id, at: '2026-01-01', kind: 'episode', season: 1, episode: 2, label: null }
    const json = (before: unknown) => JSON.stringify({ format: 'watchtrack-backup', version: 1, titles: [t], history: [{ ...h, before }], images: [] })
    expect(parseBackup(json({ status: 'watching', progress: { numbering: 'nope' } })).history[0].before).toBeNull()
    const good = { status: 'watching', progress: t.progress, completedAt: null, lastWatchedAt: null, watchedDate: null }
    expect(parseBackup(json(good)).history[0].before).toEqual(good)
  })
})
