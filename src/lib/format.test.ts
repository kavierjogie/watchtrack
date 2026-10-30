import { describe, expect, it } from 'vitest'
import { releaseBucket, timeAgo } from './format'

describe('timeAgo', () => {
  // Friday 30 Oct 2026, mid-afternoon.
  const now = new Date(2026, 9, 30, 14, 30).getTime()
  const at = (day: number, hour = 0) => new Date(2026, 9, day, hour).toISOString()

  it('counts calendar days for date-only values', () => {
    expect(timeAgo('2026-10-30', now)).toBe('today')
    expect(timeAgo('2026-10-31', now)).toBe('tomorrow')
    expect(timeAgo('2026-11-01', now)).toBe('in 2 days')
    expect(timeAgo('2026-11-05', now)).toBe('in 6 days')
    expect(timeAgo('2026-10-29', now)).toBe('yesterday')
  })

  it('counts calendar days for timestamps a day or more away', () => {
    expect(timeAgo(at(32), now)).toBe('in 2 days') // midnight Sunday, 33.5 hours away
    expect(timeAgo(at(29, 2), now)).toBe('yesterday') // 36.5 hours ago
    expect(timeAgo(at(28, 20), now)).toBe('2 days ago') // 42.5 hours ago
  })

  it('keeps minutes and hours for timestamps under a day away', () => {
    expect(timeAgo(new Date(now + 20_000).toISOString(), now)).toBe('just now')
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 minutes ago')
    expect(timeAgo(at(30, 18), now)).toBe('in 4 hours')
  })

  it('moves to months and years for far dates', () => {
    expect(timeAgo('2027-02-10', now)).toBe('in 3 months')
    expect(timeAgo('2028-11-01', now)).toBe('in 2 years')
  })
})

describe('releaseBucket', () => {
  // Wednesday 7 Oct 2026, so the week runs Mon 5 to Sun 11.
  const now = new Date(2026, 9, 7, 12).getTime()

  it('splits weeks on Monday', () => {
    expect(releaseBucket('2026-10-11', now)).toBe('This week')
    expect(releaseBucket('2026-10-12', now)).toBe('Next week')
    expect(releaseBucket('2026-10-18', now)).toBe('Next week')
  })

  it('separates the rest of this month from later', () => {
    expect(releaseBucket('2026-10-19', now)).toBe('Later this month')
    expect(releaseBucket('2026-11-01', now)).toBe('Later')
    expect(releaseBucket('2027-10-19', now)).toBe('Later')
  })

  it('handles timestamps', () => {
    expect(releaseBucket(new Date(2026, 9, 11, 23, 30).toISOString(), now)).toBe('This week')
    expect(releaseBucket(new Date(2026, 9, 12, 0, 30).toISOString(), now)).toBe('Next week')
  })

  it('keeps next week ahead of the month boundary', () => {
    const endOfMonth = new Date(2026, 9, 30, 12).getTime() // Friday
    expect(releaseBucket('2026-11-01', endOfMonth)).toBe('This week')
    expect(releaseBucket('2026-11-08', endOfMonth)).toBe('Next week')
    expect(releaseBucket('2026-11-09', endOfMonth)).toBe('Later')
  })
})
