// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildYearReview, indexHistory, type YearReview } from './review'
import { drawReview, fileName, fit, FOOTER_TOP, H, SITE_HOST, topCount, wrap, W, type Artwork, type ShareData, type ShareTheme, type ShareVariant } from './reviewImage'
import { reviewHighlights, watchingPersonality } from './reviewStory'
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
    lineCap: 'butt',
    lineJoin: 'miter',
    images: 0,
    measureText(s: string) {
      const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 16)
      return { width: s.length * size * 0.6 }
    },
    fillText(s: string, x: number, y: number) {
      const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 16)
      drawn.push({ text: s, x, y, size, width: this.measureText(s).width, align: this.textAlign })
    },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    save() {},
    restore() {},
    clip() {},
    drawImage() {
      this.images++
    },
    fillRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    translate() {},
    scale() {},
    globalAlpha: 1,
  }
  return { ctx, drawn }
}

let drawn: Drawn[] = []
let ctxNow: ReturnType<typeof fakeContext>['ctx']
const original = HTMLCanvasElement.prototype.getContext
beforeEach(() => {
  const f = fakeContext()
  drawn = f.drawn
  ctxNow = f.ctx
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
  return { review, personality: watchingPersonality(review), highlights: reviewHighlights(review) }
}

const LONG = 'The Extraordinarily Long Official English Title Of A Light Novel Adaptation That Never Seems To End: Season 2'
function busyYear(): ShareData {
  const shows = [make(LONG, 'anime'), make('Frieren', 'anime'), make('Severance', 'tv'), make('Pluribus', 'tv'), make('Dandadan', 'anime'), make('Dune', 'movie')]
  const history: HistoryEntry[] = []
  for (let d = 0; d < 300; d += 2) for (let k = 0; k < (d % 7) + 1; k++) history.push(ep(shows[(d + k) % 5], new Date(2026, 0, 1 + d, 18, k * 25).toISOString()))
  history.push(ep(shows[5], at(2026, 6, 6), 'movie'))
  return data(shows, history)
}

const VARIANTS: ShareVariant[] = ['top', 'stats', 'personality', 'highlight']
const THEMES: ShareTheme[] = ['midnight', 'daylight']
const words = () => drawn.map((t) => t.text).join(' ')

describe('share cards', () => {
  const FOOTER = ['Your watching story, your way.', 'Create your own Year in Review with WatchTrack.', SITE_HOST]
  it.each(VARIANTS.flatMap((v) => THEMES.map((t) => [v, t] as const)))('%s (%s): every line of text stays inside the 1080×1350 card and clear of the sign-off, even with very long titles', (variant, theme) => {
    const d = busyYear()
    const canvas = drawReview(d, variant, undefined, theme)
    expect([canvas.width, canvas.height]).toEqual([W, H])
    expect(drawn.length).toBeGreaterThan(5)
    for (const t of drawn) {
      const left = t.align === 'right' ? t.x - t.width : t.align === 'center' ? t.x - t.width / 2 : t.x
      // 80px safe margins on every side.
      expect(left, t.text).toBeGreaterThanOrEqual(80 - 8)
      expect(left + t.width, t.text).toBeLessThanOrEqual(W - 80)
      expect(t.y - t.size, t.text).toBeGreaterThanOrEqual(80 - 6)
      expect(t.y, t.text).toBeLessThanOrEqual(H - 80)
      const footer = FOOTER.some((f) => t.text === f || (t.text.endsWith('…') && f.startsWith(t.text.slice(0, -1))))
      if (footer) expect(t.y, t.text).toBeGreaterThan(FOOTER_TOP)
      else expect(t.y, t.text).toBeLessThanOrEqual(FOOTER_TOP - 30)
    }
  })

  it.each(VARIANTS)('%s: signs off with WatchTrack and the site address', (variant) => {
    drawReview(busyYear(), variant)
    const texts = drawn.map((t) => t.text)
    expect(texts).toContain(SITE_HOST)
    expect(texts.some((t) => t === 'Your watching story, your way.' || (t.endsWith('…') && 'Your watching story, your way.'.startsWith(t.slice(0, -1))))).toBe(true)
    expect(texts.some((t) => t.startsWith('Create your own Year in Review'))).toBe(true)
  })

  it('ranks the top five with their type and count, posters where it has them and lettered tiles for the rest', () => {
    const d = busyYear()
    const art: Artwork = new Map([[d.review.top[0].titleId, { width: 300, height: 450 } as ImageBitmap]])
    drawReview(d, 'top', art)
    expect(ctxNow.images).toBe(1)
    for (const t of d.review.top.slice(1)) expect(drawn.some((x) => x.text === t.title[0].toUpperCase())).toBe(true)
    for (const rank of ['01', '02', '03', '04', '05']) expect(drawn.map((x) => x.text)).toContain(rank)
    for (const t of d.review.top) expect(words()).toContain(`${t.count.toLocaleString()} ${t.mediaType === 'movie' ? 'WATCH' : 'EPISODE'}`)
    expect(words()).toContain('ANIME ·')
    expect(words()).toContain('SERIES ·')
  })

  it('never pads out a top five: 3 or 4 titles make a top three, fewer make none', () => {
    const shows = ['A', 'B', 'C', 'D'].map((x) => make(x, 'tv'))
    const d4 = data(shows, shows.map((s, i) => ep(s, at(2026, 2, i + 1))))
    expect(topCount(d4.review)).toBe(3)
    drawReview(d4, 'top')
    expect(words()).toContain('MY TOP THREE')
    expect(drawn.map((x) => x.text)).not.toContain('04')
    expect(topCount(data(shows.slice(0, 2), [ep(shows[0], at(2026, 2, 1)), ep(shows[1], at(2026, 2, 2))]).review)).toBe(0)
  })

  it('shows the same numbers as the review, and no estimated watch time', () => {
    const d = busyYear()
    drawReview(d, 'stats')
    const texts = drawn.map((t) => t.text)
    expect(texts).toContain(d.review.stats.episodes.toLocaleString())
    expect(texts).toContain(d.review.stats.activeDays.toLocaleString())
    expect(texts).toContain(d.review.titles.toLocaleString())
    expect(words().toLowerCase()).not.toContain('hour')
  })

  it('leaves zero stats off the numbers card instead of showing them', () => {
    const t = make('Frieren', 'anime')
    drawReview(data([t], [ep(t, at(2026, 2, 1)), ep(t, at(2026, 2, 3))]), 'stats')
    expect(words()).not.toContain('movies watched')
    expect(words()).not.toContain('completed')
  })

  it('names the personality, with the number that earned it', () => {
    const d = busyYear()
    expect(d.personality).not.toBeNull()
    drawReview(d, 'personality')
    expect(words().replace(/\s+/g, ' ')).toContain(d.personality!.main.name.split(' ').slice(-1)[0])
    expect(drawn.map((x) => x.text)).toContain(d.personality!.main.stat.value)
  })

  it('leads the highlight reel with the best highlight and its runners-up', () => {
    const d = busyYear()
    expect(d.highlights.length).toBeGreaterThan(1)
    drawReview(d, 'highlight')
    const texts = drawn.map((x) => x.text)
    expect(texts).toContain(d.highlights[0].value)
    expect(texts).toContain(d.highlights[1].value)
    expect(words()).toContain(d.highlights[0].label.toUpperCase())
  })

  it('works for a tiny year, a movies-only year, and a year still going', () => {
    const t = make('Frieren', 'anime')
    for (const v of VARIANTS) expect(() => drawReview(data([t], [ep(t, at(2026, 2, 1))]), v)).not.toThrow()
    const films = [make('A', 'movie'), make('B', 'movie')]
    drawn.length = 0
    expect(() => drawReview(data(films, films.map((f, i) => ep(f, at(2026, 3, i + 1), 'movie'))), 'stats')).not.toThrow()
    expect(drawn.some((x) => x.text === 'movies')).toBe(true)
    const going = buildYearReview(indexHistory([t], [ep(t, at(2026, 2, 1))]), 2026, new Date(2026, 5, 1).getTime())!
    drawn.length = 0
    drawReview({ review: going, personality: null, highlights: [] }, 'stats')
    expect(words()).toContain('so far')
  })

  it('names files by year, design and style', () => {
    const d = busyYear()
    expect(fileName(d.review, 'top')).toBe('watchtrack-2026-top-five.png')
    expect(fileName(d.review, 'stats', 'daylight')).toBe('watchtrack-2026-numbers-light.png')
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
