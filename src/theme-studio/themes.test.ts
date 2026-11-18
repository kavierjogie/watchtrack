import { describe, expect, it } from 'vitest'
import { checks, contrast, THEMES, tokens } from './themes'

describe('theme studio concepts (dark-only)', () => {
  for (const theme of THEMES)
    it(`${theme.name} keeps every text pair at WCAG AA`, () => {
      const t = tokens(theme)
      for (const c of checks(t)) expect(c.ratio, c.label).toBeGreaterThanOrEqual(4.5)
      // Status colours must stay apart from the primary ("watching") and from each other.
      const statuses = [t['--accent'], t['--success'], t['--info'], t['--warn'], t['--danger']]
      expect(new Set(statuses).size).toBe(statuses.length)
      // Dark-only rules from the research: no pure black page, no pure white text.
      expect(theme.colors.bg).not.toBe('#000000')
      expect(theme.colors.text).not.toBe('#FFFFFF')
    })

  it('measures contrast like WCAG', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
  })
})
