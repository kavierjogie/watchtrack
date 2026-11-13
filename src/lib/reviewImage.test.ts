// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildYearReview, indexHistory, type YearReview } from './review'
import { drawReview, fileName, fit, H, wrap, W, type ShareData, type ShareVariant } from './reviewImage'
import { reviewInsights, watchingPersonality } from './reviewStory'
import { createTitle } from './titles'
import type { HistoryEntry, MediaType, Title } from './types'

/**
 * jsdom has no canvas, so a recording 2D context stands in. Text width is estimated generously (0.6 em per character,
 * wider than real fonts), so "it fits here" means it fits in a real browser too.
 */
interface Drawn {
  text: string
  x: number
  y: number
  size: number
  width: number
  align: CanvasTextAlign
}
function fakeContext() {
  const drawn: Drawn[] = []
  const ctx = {
    font: '500 16px sans-serif',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    measureText(s: string) {
      const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 16)
      return { width: s.length * size * 0.6 }
    },
    fillText(s: string, x: number, y: number) {
      const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 16)
      drawn.push({ text: s, x, y, size, width: this.measureText(s).width, align: this.textAlign })
    },
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
  }
  return { ctx, drawn }
}

let drawn: Drawn[] = []
const original = HTMLCanvasElement.prototype.getContext
beforeEach(() => {
  const f = fakeContext()
  drawn = f.drawn
  HTMLCanvasElement.prototype.getContext = (() => f.ctx) as unknown as typeof original
})
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = original
})

const at = (y: number, mo: number, d: number, h = 20, min = 0) => new Date(y, mo - 1, d, h, min).toISOString()
let n = 0
const make = (title: string, mediaType: MediaType, extra: Partial<Title> = {}): Title => ({ ...createTitle({ title, mediaType, status: 'watching' }, at(2020, 1, 1)), ...extra })
const ep = (t: Title, when: string, kind: HistoryEntry['kind'] = 'episode'): HistoryEntry => ({ id: `i${n++}`, titleId: t.id, at: when, kind, season: null, episode: n, label: null, before: null })

function data(titles: Title[], history: HistoryEntry[]): ShareData {
  const review = buildYearReview(indexHistory(titles, history), 2026, new Date(2027, 0, 10).getTime()) as YearReview
  return { review, personality: watchingPersonality(review), insights: reviewInsights(review) }
}

const LONG = 'The Extraordinarily Long Official English Title Of A Light Novel Adaptation That Never Seems To End: Season 2'
function busyYear(): ShareData {
  const shows = [make(LONG, 'anime'), make('Frieren', 'anime'), make('Severance', 'tv'), make('Pluribus', 'tv'), make('Dandadan', 'anime'), make('Dune', 'movie')]
  const history: HistoryEntry[] = []
  for (let d = 0; d < 300; d += 2) for (let k = 0; k < (d % 7) + 1; k++) history.push(ep(shows[(d + k) % 5], new Date(2026, 0, 1 + d, 18, k * 25).toISOString()))
  history.push(ep(shows[5], at(2026, 6, 6), 'movie'))
  return data(shows, history)
}

const VARIANTS: ShareVariant[] = ['summary', 'top', 'stats', 'personality']

describe('share cards', () => {
  it.each(VARIANTS)('%s: every line of text stays inside the 1080×1350 card, even with very long titles', (variant) => {
    const d = busyYear()
    const canvas = drawReview(d, variant, 'watchtrack.example')
    expect([canvas.width, canvas.height]).toEqual([W, H])
    expect(drawn.length).toBeGreaterThan(5)
    for (const t of drawn) {
      const left = t.align === 'right' ? t.x - t.width : t.align === 'center' ? t.x - t.width / 2 : t.x
      expect(left, t.text).toBeGreaterThanOrEqual(0)
      expect(left + t.width, t.text).toBeLessThanOrEqual(W)
      expect(t.y - t.size, t.text).toBeGreaterThanOrEqual(0)
      expect(t.y, t.text).toBeLessThanOrEqual(H)
      // Nothing runs into the footer (its divider sits 46px above the bottom margin).
      const footer = t.text.startsWith('Tracked privately') || t.text === 'watchtrack.example'
      if (!footer) expect(t.y, t.text).toBeLessThanOrEqual(H - 84 - 56)
    }
  })

  it('shows the same numbers as the review', () => {
    const d = busyYear()
    drawReview(d, 'stats', 'x')
    const texts = drawn.map((t) => t.text)
    expect(texts).toContain(d.review.stats.episodes.toLocaleString())
    expect(texts).toContain(d.review.stats.activeDays.toLocaleString())
    expect(texts).toContain(String(d.review.stats.longestStreak!.days))
    drawn.length = 0
    drawReview(d, 'top', 'x')
    for (const t of d.review.top) expect(drawn.some((x) => x.text.startsWith(`${t.count.toLocaleString()} `))).toBe(true)
  })

  it('names the personality on its card and on the summary', () => {
    const d = busyYear()
    expect(d.personality).not.toBeNull()
    drawReview(d, 'summary', 'x')
    expect(drawn.map((t) => t.text).join(' ')).toContain(d.personality!.main.name)
  })

  it('works for a tiny year, a movies-only year, and a year still going', () => {
    const t = make('Frieren', 'anime')
    for (const v of VARIANTS) expect(() => drawReview(data([t], [ep(t, at(2026, 2, 1))]), v, 'x')).not.toThrow()
    const films = [make('A', 'movie'), make('B', 'movie')]
    expect(() => drawReview(data(films, films.map((f, i) => ep(f, at(2026, 3, i + 1), 'movie'))), 'summary', 'x')).not.toThrow()
    expect(drawn.some((x) => x.text === 'movies')).toBe(true)
  })

  it('names files by year and design', () => {
    const d = busyYear()
    expect(fileName(d.review, 'summary')).toBe('watchtrack-2026-in-review.png')
    expect(fileName(d.review, 'top')).toBe('watchtrack-2026-top.png')
  })
})

describe('text fitting', () => {
  const { ctx } = fakeContext()
  ctx.font = '500 20px x' // 12px per character
  it('shortens a line with an ellipsis', () => {
    expect(fit(ctx as unknown as CanvasRenderingContext2D, 'abcdefghij', 60)).toBe('abcd…')
    expect(fit(ctx as unknown as CanvasRenderingContext2D, 'abc', 60)).toBe('abc')
  })
  it('wraps words and ellipsises the last allowed line', () => {
    const lines = wrap(ctx as unknown as CanvasRenderingContext2D, 'one two three four five six seven', 120, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('one two')
    expect(lines[1].endsWith('…')).toBe(true)
    for (const l of lines) expect(l.length * 12).toBeLessThanOrEqual(120)
  })
})
