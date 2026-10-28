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
