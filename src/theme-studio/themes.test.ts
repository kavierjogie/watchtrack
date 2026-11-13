import { describe, expect, it } from 'vitest'
import { checks, contrast, THEMES, tokens } from './themes'

describe('theme studio palettes', () => {
  for (const theme of THEMES)
    for (const mode of ['dark', 'light'] as const)
      it(`${theme.name} (${mode}) keeps every text pair at WCAG AA`, () => {
        const t = tokens(theme, mode)
        for (const c of checks(t)) expect(c.ratio, c.label).toBeGreaterThanOrEqual(4.5)
        // Status colours must stay apart from the primary ("watching") and from each other.
        const statuses = [t['--accent'], t['--success'], t['--info'], t['--warn'], t['--danger']]
        for (let i = 0; i < statuses.length; i++) for (let j = i + 1; j < statuses.length; j++) expect(statuses[i]).not.toBe(statuses[j])
      })

  it('measures contrast like WCAG', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
  })
})
