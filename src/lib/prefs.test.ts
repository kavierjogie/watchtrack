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
  it('waits for 5 titles, then respects the snooze date', async () => {
    const { backupNudgeDue } = await import('./prefs')
    const now = Date.parse('2026-10-29T12:00:00Z')
    expect(backupNudgeDue(4, '', now)).toBe(false)
    expect(backupNudgeDue(5, '', now)).toBe(true)
    expect(backupNudgeDue(5, '2026-11-01T00:00:00Z', now)).toBe(false)
    expect(backupNudgeDue(5, '2026-10-28T00:00:00Z', now)).toBe(true)
  })
})
