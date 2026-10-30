import { describe, expect, it } from 'vitest'
import { buildIcs } from './ics'
import type { Release, Title } from './types'

const NOW = Date.UTC(2026, 9, 30, 12)
const ep = (episode: number, airdate: string | null, name: string | null = null): Release => ({ kind: 'episode', season: 2, episode, name, airdate })
const show = (upcoming: Release[], over: Partial<Title> = {}) =>
  ({ id: 'abc', title: 'Show', status: 'watching', progress: { numbering: 'seasonal' }, sync: { upcoming }, ...over }) as unknown as Title

const unfold = (ics: string) => ics.replace(/\r\n /g, '')

describe('buildIcs', () => {
  it('returns null with nothing dated', () => {
    expect(buildIcs([show([ep(1, null)])], NOW)).toBeNull()
  })

  it('makes date-only values all-day and timestamps UTC', () => {
    const ics = buildIcs([show([ep(1, '2026-11-01'), ep(2, '2026-11-08T20:30:00-05:00')])], NOW)!
    expect(ics).toContain('DTSTART;VALUE=DATE:20261101\r\n')
    expect(ics).toContain('DTSTART:20261109T013000Z\r\n')
    expect(ics).toContain('SUMMARY:Show · S2 · E1\r\n')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('leaves out TBA, past and invalid dates, and dropped shows', () => {
    const ics = buildIcs([show([ep(1, null), ep(2, '2026-10-01'), ep(3, 'soon'), ep(4, '2026-12-01')]), show([ep(5, '2026-12-02')], { id: 'x', status: 'dropped' })], NOW)!
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics).toContain('20261201')
  })

  it('escapes text', () => {
    const ics = buildIcs([show([ep(1, '2026-11-01', 'One, two; three\\four\nfive')], { title: 'A, B' })], NOW)!
    expect(ics).toContain('SUMMARY:A\\, B · S2 · E1')
    expect(ics).toContain('DESCRIPTION:One\\, two\\; three\\\\four\\nfive')
  })

  it('folds long lines by bytes without splitting a character', () => {
    const title = 'é'.repeat(100)
    const ics = buildIcs([show([ep(1, '2026-11-01')], { title })], NOW)!
    const bytes = new TextEncoder()
    for (const line of ics.split('\r\n')) expect(bytes.encode(line).length).toBeLessThanOrEqual(75)
    expect(ics).not.toContain('�')
    expect(unfold(ics)).toContain(`SUMMARY:${title} · S2 · E1`)
  })

  it('keeps UIDs stable when a date changes', () => {
    const uid = (date: string) => buildIcs([show([ep(1, date)])], NOW)!.match(/UID:(.*)\r\n/)![1]
    expect(uid('2026-11-01')).toBe(uid('2026-11-15'))
    expect(uid('2026-11-01')).toBe('abc-episode-2-1@watchtrack')
  })
})
