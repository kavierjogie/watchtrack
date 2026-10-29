import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('prefs', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
  })

  it('removes the TMDB key older versions saved, keeping the other preferences', async () => {
    store.set('watchtrack:prefs', JSON.stringify({ theme: 'light', tmdbKey: 'secret-key' }))
    const { getPrefs } = await import('./prefs')
    expect(getPrefs().theme).toBe('light')
    expect(store.get('watchtrack:prefs')).not.toContain('secret-key')
  })

  it('falls back to defaults for wrongly typed or unreadable values', async () => {
    store.set('watchtrack:prefs', JSON.stringify({ alertsOn: 'yes', theme: 3 }))
    const { getPrefs } = await import('./prefs')
    expect(getPrefs()).toMatchObject({ alertsOn: true, theme: 'dark' })
  })
})

describe('backupNudgeDue', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')

  it('first shows at 5 titles', async () => {
    const { backupNudgeDue } = await import('./prefs')
    expect(backupNudgeDue(4, 0, '', now)).toBe(false)
    expect(backupNudgeDue(5, 0, '', now)).toBe(true)
  })

  it('after an export, waits for both 30 days and 5 new titles', async () => {
    const { backupNudgeDue, getPrefs, markBackedUp } = await import('./prefs')
    markBackedUp(20, now)
    const { backupCountAtExport, backupNudgeAfter } = getPrefs()
    const later = now + 31 * 86_400_000
    expect(backupNudgeDue(30, backupCountAtExport, backupNudgeAfter, now + 86_400_000)).toBe(false) // grown, too soon
    expect(backupNudgeDue(22, backupCountAtExport, backupNudgeAfter, later)).toBe(false) // time passed, barely grown
    expect(backupNudgeDue(25, backupCountAtExport, backupNudgeAfter, later)).toBe(true)
  })

  it('dismissing hides it for 30 days', async () => {
    const { backupNudgeDue, getPrefs, snoozeBackupNudge } = await import('./prefs')
    snoozeBackupNudge(now)
    const { backupNudgeAfter } = getPrefs()
    expect(backupNudgeDue(10, 0, backupNudgeAfter, now + 29 * 86_400_000)).toBe(false)
    expect(backupNudgeDue(10, 0, backupNudgeAfter, now + 31 * 86_400_000)).toBe(true)
  })
})
