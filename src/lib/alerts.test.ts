import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertUrl, describeAlert, detectEvents, recordAlerts, showSystemNotification, upcomingOf, useAlerts, type AlertEvent } from './alerts'
import { parseBackup } from './backup'
import { clearAll, getDb } from './db'
import { mirrorAlertPrefs, readMirroredPrefs, setPrefs } from './prefs'
import { isDue, refreshTitle, type Patch, type RefreshResult } from './sync'
import { createTitle } from './titles'
import type { Sequel, Title } from './types'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const DAY = 86400000

type Ep = { season: number; number: number; airstamp?: string; name?: string }
/** TVmaze /shows/:id?embed[]=episodes&embed[]=seasons */
const maze = (aired: Record<number, number>, extra: { episodes?: Ep[]; seasons?: { number: number; premiereDate: string | null }[]; status?: string } = {}) => ({
  id: 2993,
  status: extra.status ?? 'Running',
  _embedded: {
    episodes: [
      ...Object.entries(aired).flatMap(([s, n]) => Array.from({ length: n }, (_, i) => ({ id: Number(s) * 100 + i, season: Number(s), number: i + 1, airdate: '2020-01-01', airstamp: '2020-01-01T00:00:00+00:00' }))),
      ...(extra.episodes ?? []).map((e) => ({ id: 9000 + e.season * 100 + e.number, airdate: e.airstamp?.slice(0, 10) ?? '', airstamp: e.airstamp ?? null, ...e })),
    ],
    seasons: [...Object.keys(aired).map((s) => ({ number: Number(s), premiereDate: '2020-01-01' })), ...(extra.seasons ?? [])],
  },
})

function show(over: Partial<Title> = {}): Title {
  const t = createTitle({ title: 'Stranger Things', mediaType: 'tv', status: 'on_hold', rating: 9, notes: 'keep me', source: { provider: 'tvmaze', id: '2993', url: '' } })
  t.progress = { ...t.progress!, season: 4, nextEpisode: 10, seasonEpisodeCounts: { 1: 8, 2: 9, 3: 8, 4: 9 }, totalSeasons: null }
  return { ...t, ...over }
}

function store(titles: Title[]) {
  const map = new Map(titles.map((t) => [t.id, t]))
  const patch: Patch = async (id, fn) => {
    const cur = map.get(id)
    const next = cur && fn(cur)
    if (next) map.set(id, next)
    return next ?? cur
  }
  return { map, patch }
}

/** Refresh against a mocked TVmaze answer and return the alert events it produced. */
async function refreshWith(s: ReturnType<typeof store>, id: string, body: unknown): Promise<RefreshResult> {
  vi.stubGlobal('fetch', vi.fn(() => json(body)))
  return refreshTitle(s.map.get(id)!, s.patch)
}
const eventsOf = (r: RefreshResult) => (r.status === 'updated' || r.status === 'unchanged' ? r.events : [])
const kinds = (r: RefreshResult) => eventsOf(r).map((e) => e.kind)

beforeEach(async () => {
  await clearAll()
  setPrefs({ alertsOn: true, alertSeasons: true, alertEpisodes: true, alertDates: true, browserNotify: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('release detection (mocked TVmaze)', () => {
  it('first refresh of a title with several finished seasons only learns: no alerts for old episodes or known seasons', async () => {
    const s = store([show()])
    const r = await refreshWith(s, s.map.keys().next().value!, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: null }] }))
    expect(eventsOf(r)).toEqual([])
    expect(s.map.values().next().value!.sync?.upcoming).toEqual([{ kind: 'season', season: 5, episode: null, name: null, airdate: null }])
  })

  it('announced season → date confirmed → date changed, each once; re-refreshing adds nothing; progress untouched', async () => {
    const t = show()
    const s = store([t])
    await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 })) // baseline
    const announced = await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: null }] }))
    expect(eventsOf(announced)).toMatchObject([{ kind: 'season_announced', id: 'tvmaze:2993:announced:s5', label: 'Season 5', date: null }])
    expect(describeAlert(eventsOf(announced)[0])).toBe('Season 5 has been announced. No release date yet.')
    // Announced, no episodes yet: not counted as released.
    expect(s.map.get(t.id)!.progress).toEqual(t.progress)

    const dated = await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: '2099-11-26' }] }))
    expect(eventsOf(dated)).toMatchObject([{ kind: 'date_confirmed', id: 'tvmaze:2993:date:s5:2099-11-26', date: '2099-11-26' }])
    expect(kinds(await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: '2099-11-26' }] })))).toEqual([])

    const moved = await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: '2099-12-03' }] }))
    expect(eventsOf(moved)).toMatchObject([{ kind: 'date_changed', id: 'tvmaze:2993:date:s5:2099-12-03' }])
    expect(s.map.get(t.id)).toMatchObject({ status: 'on_hold', rating: 9, notes: 'keep me' })
  })

  it('a scheduled premiere episode on the same day as the season date is not alerted twice', async () => {
    const t = show()
    const s = store([t])
    await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: null }] }))
    const r = await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: '2099-11-26' }], episodes: [{ season: 5, number: 1, airstamp: '2099-11-26T01:00:00+00:00', name: 'The Crawl' }] }))
    expect(kinds(r)).toEqual(['date_confirmed'])
  })

  it('upcoming episode after a break is alerted (labelled upcoming); weekly next episodes are not', async () => {
    const t = show({ progress: { ...show().progress!, seasonEpisodeCounts: { 1: 8, 2: 9, 3: 8, 4: 9, 5: 4 } } })
    const s = store([t])
    await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 4 }))
    const r = await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 4 }, { episodes: [{ season: 5, number: 5, airstamp: '2099-12-25T01:00:00+00:00', name: 'Sorcerer' }] }))
    expect(eventsOf(r)).toMatchObject([{ kind: 'upcoming_episode', label: 'S5 · E5', detail: 'Sorcerer', date: '2099-12-25T01:00:00+00:00' }])
    expect(describeAlert(eventsOf(r)[0])).toMatch(/^S5 · E5 “Sorcerer” airs .+\. Not out yet\.$/)
    const weekly = await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 4 }, { episodes: [{ season: 5, number: 5, airstamp: '2099-12-25T01:00:00+00:00' }, { season: 5, number: 6, airstamp: '2100-01-01T01:00:00+00:00' }] }))
    expect(kinds(weekly)).toEqual([])
  })

  it('once the air date passes the title is due again, and the episode is reported released exactly once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-24T12:00:00Z'))
    const t = show({ progress: { ...show().progress!, seasonEpisodeCounts: { 1: 8, 2: 9, 3: 8, 4: 9, 5: 4 } } })
    const s = store([t])
    const body = maze({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 4 }, { episodes: [{ season: 5, number: 5, airstamp: '2026-12-25T01:00:00+00:00', name: 'Sorcerer' }] })
    await refreshWith(s, t.id, body)
    expect(isDue(s.map.get(t.id)!)).toBe(false)
    vi.setSystemTime(new Date('2026-12-25T02:00:00Z')) // checked 14 h ago (normally fresh for a day), but the release time has passed
    expect(isDue(s.map.get(t.id)!)).toBe(true)
    const r = await refreshWith(s, t.id, body) // same provider data; the airstamp is now in the past
    expect(eventsOf(r)).toMatchObject([{ kind: 'episode_released', id: 'tvmaze:2993:released:s5e5', label: 'S5 · E5', detail: 'Sorcerer', date: '2026-12-25T01:00:00+00:00' }])
    expect(s.map.get(t.id)!.progress).toMatchObject({ season: 4, nextEpisode: 10 }) // progress never moves
    expect(isDue(s.map.get(t.id)!)).toBe(false)
    expect(kinds(await refreshWith(s, t.id, body))).toEqual([])
  })

  it('a whole season dropping at once is one "season available" alert, not one per episode', async () => {
    const t = show()
    const s = store([t])
    await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: null }] }))
    const r = await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 }))
    expect(eventsOf(r)).toMatchObject([{ kind: 'season_available', label: 'Season 5', detail: '8 episodes out' }])
    expect(s.map.get(t.id)!.progress).toMatchObject({ season: 4, nextEpisode: 10, seasonEpisodeCounts: { 5: 8 } })
  })

  it('provider failure, malformed answer and offline: no alerts and nothing erased', async () => {
    const t = show()
    const s = store([t])
    await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { seasons: [{ number: 5, premiereDate: '2099-11-26' }] }))
    const before = s.map.get(t.id)!
    expect((await refreshWith(s, t.id, {})).status).toBe('unchanged') // malformed: no episode list
    expect(s.map.get(t.id)!.sync?.upcoming).toEqual(before.sync?.upcoming)
    vi.stubGlobal('fetch', vi.fn(() => json({}, 404)))
    expect((await refreshTitle(s.map.get(t.id)!, s.patch)).status).toBe('failed')
    vi.stubGlobal('navigator', { onLine: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const off = await refreshTitle({ ...s.map.get(t.id)!, id: 'other' }, s.patch)
    expect(off.status).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s.map.get(t.id)!.progress).toEqual(t.progress)
  })

  it('a show with no known future release has nothing upcoming and no alerts', async () => {
    const t = show()
    const s = store([t])
    await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { status: 'Ended' }))
    const r = await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9 }, { status: 'Ended' }))
    expect(eventsOf(r)).toEqual([])
    expect(upcomingOf(s.map.get(t.id)!)).toEqual([])
  })

  it('one TVmaze request per show fetches episodes and seasons together', async () => {
    const t = show()
    const s = store([t])
    const fetchMock = vi.fn(() => json(maze({ 1: 8 })))
    vi.stubGlobal('fetch', fetchMock)
    await refreshTitle(t, s.patch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual([expect.stringContaining('/shows/2993?embed[]=episodes&embed[]=seasons'), expect.anything()])
  })
})

describe('anime next season (AniList, explicit status only)', () => {
  const anime = (sequel: Sequel | null): Title => {
    const t = createTitle({ title: 'Frieren', mediaType: 'anime', status: 'completed', source: { provider: 'kitsu', id: '46474', url: '' } })
    return { ...t, sync: { checkedAt: '2026-10-01T00:00:00Z', changedAt: null, ongoing: false, aired: 28, nextAiring: null, anilistId: 154587, sequel } }
  }
  const seq = (status: string, startDate: string | null) => ({ anilistId: 182255, title: 'Frieren Season 2', status, startDate, url: '' })
  const NOW = '2026-10-27T00:00:00Z'

  it('announced (window only) → date confirmed → out now', () => {
    const a = detectEvents(anime(null), anime(seq('NOT_YET_RELEASED', '2027-01')), NOW)
    expect(a).toMatchObject([{ kind: 'season_announced', id: 'kitsu:46474:announced:ani182255', date: null, detail: 'Frieren Season 2' }]) // a month isn't a date
    expect(detectEvents(anime(seq('NOT_YET_RELEASED', '2027-01')), anime(seq('NOT_YET_RELEASED', '2027-01-16')), NOW)).toMatchObject([{ kind: 'date_confirmed', date: '2027-01-16' }])
    expect(detectEvents(anime(seq('NOT_YET_RELEASED', '2027-01-16')), anime(seq('RELEASING', '2027-01-16')), NOW)).toMatchObject([{ kind: 'season_available' }])
    expect(detectEvents(anime(seq('RELEASING', '2027-01-16')), anime(seq('FINISHED', '2027-01-16')), NOW)).toEqual([])
  })

  it('an announced season shows on the Upcoming page as Date TBA with its window, never as a fake date', () => {
    expect(upcomingOf(anime(seq('NOT_YET_RELEASED', '2027')))).toEqual([{ kind: 'season', season: null, episode: null, name: 'Frieren Season 2', airdate: null, window: '2027' }])
  })
})

describe('alert store: dedupe, preferences, backups', () => {
  const ev = (id: string, kind: AlertEvent['kind'] = 'episode_released'): AlertEvent => ({ id, kind, titleId: 't1', label: 'S5 · E5', date: null, detail: null })

  it('the same event is stored once however often it is found, even after being dismissed', async () => {
    const t = show({ id: 't1' })
    expect(await recordAlerts([{ title: t, events: [ev('a'), ev('b')] }])).toHaveLength(2)
    expect(await recordAlerts([{ title: t, events: [ev('a'), ev('b')] }])).toEqual([])
    const row = await (await getDb()).get('settings', 'alerts')
    expect((row!.value as { items: unknown[] }).items).toHaveLength(2)
  })

  it('alerts off for a show (or dropped by default) or for a category are kept muted and never shown', async () => {
    expect(await recordAlerts([{ title: show({ id: 't1', alerts: false }), events: [ev('x')] }])).toEqual([])
    expect(await recordAlerts([{ title: show({ id: 't1', status: 'dropped' }), events: [ev('y')] }])).toEqual([])
    expect(await recordAlerts([{ title: show({ id: 't1', status: 'dropped', alerts: true }), events: [ev('z')] }])).toHaveLength(1)
    setPrefs({ alertDates: false })
    expect(await recordAlerts([{ title: show({ id: 't1' }), events: [ev('d', 'date_changed')] }])).toEqual([])
    const items = ((await (await getDb()).get('settings', 'alerts'))!.value as { items: { id: string; muted: boolean }[] }).items
    expect(items.filter((a) => a.muted).map((a) => a.id).sort()).toEqual(['d', 'x', 'y'])
  })

  it('a background check follows the prefs copied to IndexedDB, since a service worker has no localStorage', async () => {
    setPrefs({ alertDates: false, browserNotify: true })
    await mirrorAlertPrefs()
    const copy = (await readMirroredPrefs())!
    expect(copy.browserNotify).toBe(true)
    setPrefs({ alertDates: true }) // what this page reads no longer matches; the passed copy must win
    expect(await recordAlerts([{ title: show({ id: 't1' }), events: [ev('d', 'date_changed')] }], undefined, copy)).toEqual([])
    expect(await recordAlerts([{ title: show({ id: 't1' }), events: [ev('e')] }], undefined, copy)).toHaveLength(1)
  })

  it('older backups (no sync / alerts / upcoming) import; junk new fields are dropped; first refresh after import is silent', async () => {
    const t = show()
    const legacy = parseBackup(JSON.stringify({ format: 'watchtrack-backup', version: 1, exportedAt: '2025-01-01', titles: [t, { ...t, id: 'j', alerts: 'yes', sync: { checkedAt: 'x', upcoming: [{ kind: 'bogus' }] } }], history: [], images: [] }))
    expect(legacy.titles[0].alerts).toBeUndefined()
    expect(legacy.titles[1].alerts).toBeUndefined()
    expect(legacy.titles[1].sync?.upcoming).toBeUndefined()
    const s = store([legacy.titles[0]])
    expect(eventsOf(await refreshWith(s, t.id, maze({ 1: 8, 2: 9, 3: 8, 4: 9, 5: 8 }, { seasons: [{ number: 6, premiereDate: null }] })))).toEqual([])
  })

  it('browser notifications: denied or unsupported permission shows nothing (in-app alerts still work)', async () => {
    expect(await showSystemNotification('t', 'b', '/upcoming')).toBe(false) // no Notification API in this environment
    const ctor = vi.fn()
    vi.stubGlobal('window', {})
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'denied' }))
    ;(globalThis.window as unknown as Record<string, unknown>).Notification = globalThis.Notification
    expect(await showSystemNotification('t', 'b', '/upcoming')).toBe(false)
    expect(ctor).not.toHaveBeenCalled()
  })

  it('a notification opens its show', () => {
    expect(alertUrl({ titleId: 'abc-123' })).toBe('/title/abc-123')
    expect(typeof useAlerts).toBe('function')
  })
})

it('a dated season more than a day out is not mistaken for released', () => {
  const t = show()
  const after = { ...t, sync: { checkedAt: '', changedAt: null, ongoing: true, aired: 34, nextAiring: null, upcoming: [{ kind: 'season' as const, season: 5, episode: null, name: null, airdate: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10) }] } }
  const before = { ...after, sync: { ...after.sync, upcoming: [] } }
  expect(detectEvents(before, after, new Date().toISOString()).map((e) => e.kind)).toEqual(['season_announced'])
})
