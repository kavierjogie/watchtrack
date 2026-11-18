import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('prefs', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
  })

  it('removes the TMDB key older versions saved, keeping the other preferences', async () => {
    store.set('watchtrack:prefs', JSON.stringify({ gridSize: 'lg', tmdbKey: 'secret-key' }))
    const { getPrefs } = await import('./prefs')
    expect(getPrefs().gridSize).toBe('lg')
    expect(store.get('watchtrack:prefs')).not.toContain('secret-key')
  })

  it('falls back to defaults for wrongly typed or unreadable values', async () => {
    store.set('watchtrack:prefs', JSON.stringify({ alertsOn: 'yes', gridSize: 3 }))
    const { getPrefs } = await import('./prefs')
    expect(getPrefs()).toMatchObject({ alertsOn: true, gridSize: 'md' })
  })

  it('ignores the theme setting older versions saved (the app has one dark theme)', async () => {
    store.set('watchtrack:prefs', JSON.stringify({ theme: 'light', gridSize: 'sm' }))
    const { getPrefs } = await import('./prefs')
    expect(getPrefs()).not.toHaveProperty('theme')
    expect(getPrefs().gridSize).toBe('sm')
  })
})

describe('backupNudgeDue', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')

  it('first shows at 5 titles', async () => {
    const { backupNudgeDue } = await import('./prefs')
    expect(backupNudgeDue(4, '', now)).toBe(false)
    expect(backupNudgeDue(5, '', now)).toBe(true)
  })

  it('dismissing hides it for 30 days', async () => {
    const { backupNudgeDue, getPrefs, snoozeBackupNudge } = await import('./prefs')
    snoozeBackupNudge(now)
    const { backupNudgeAfter } = getPrefs()
    expect(backupNudgeDue(10, backupNudgeAfter, now + 29 * 86_400_000)).toBe(false)
    expect(backupNudgeDue(10, backupNudgeAfter, now + 31 * 86_400_000)).toBe(true)
  })
})
