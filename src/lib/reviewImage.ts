import { MONTHS, toHours, type YearReview } from './review'
import type { Insight, Personality } from './reviewStory'

/**
 * Year in review share cards, drawn on this device as 1080×1350 PNGs (4:5, the size Instagram and most feeds show
 * uncropped). Text and shapes only: no posters or promotional artwork, no network, and nothing can "taint" the canvas.
 * Every number on a card comes from the same YearReview the page shows.
 */

export type ShareVariant = 'summary' | 'top' | 'stats' | 'personality'

export interface ShareData {
  review: YearReview
  personality: { main: Personality; also: Personality[] } | null
  insights: Insight[]
}

export const W = 1080
export const H = 1350
const PAD = 84
const INNER = W - PAD * 2
const C = {
  bg: '#0b0b12',
  surface: '#171725',
  surface2: '#202033',
  line: '#2e2c44',
  fg: '#f5f3ff',
  fg2: '#c4c0d4',
  muted: '#9a94b0',
  violet: '#a78bfa',
  violetDeep: '#7c3aed',
  indigo: '#818cf8',
  cyan: '#67e8f9',
  soft: '#251b3d',
}
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
type Ctx = CanvasRenderingContext2D

const font = (ctx: Ctx, size: number, weight = 500) => {
  ctx.font = `${weight} ${size}px ${FONT}`
}

/** Shortens `text` with an ellipsis until it fits `max` pixels at the current font. */
export function fit(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/** Word-wraps `text` into at most `maxLines` lines of `max` pixels; the last line gets an ellipsis if text is left over. */
export function wrap(ctx: Ctx, text: string, max: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (ctx.measureText(next).width <= max) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = words[i]
    if (lines.length === maxLines - 1) {
      lines.push(fit(ctx, [line, ...words.slice(i + 1)].join(' '), max))
      return lines
    }
  }
  if (line) lines.push(fit(ctx, line, max))
  return lines.slice(0, maxLines)
}

/** The largest size from `start` down to `min` at which `text` fits on one line. */
function fitSize(ctx: Ctx, text: string, weight: number, start: number, min: number, max: number): number {
  for (let size = start; size > min; size -= 4) {
    font(ctx, size, weight)
    if (ctx.measureText(text).width <= max) return size
  }
  font(ctx, min, weight)
  return min
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function text(ctx: Ctx, s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') {
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(s, x, y)
  ctx.textAlign = 'left'
}

function eyebrow(ctx: Ctx, s: string, x: number, y: number, color = C.muted) {
  font(ctx, 26, 650)
  ctx.letterSpacing = '3px'
  text(ctx, s.toUpperCase(), x, y, color)
  ctx.letterSpacing = '0px'
}

/** Background, glow, brand row and footer: the same frame on every card. */
function frame(ctx: Ctx, r: YearReview, host: string) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  const glow = (x: number, y: number, radius: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  glow(W, 0, 900, 'rgba(167,139,250,0.24)')
  glow(0, H, 700, 'rgba(103,232,249,0.08)')

  // Brand mark: a violet tile with a play triangle, then the name.
  rect(ctx, PAD, PAD - 6, 52, 52, 14, C.violet)
  ctx.fillStyle = C.bg
  ctx.beginPath()
  ctx.moveTo(PAD + 20, PAD + 6)
  ctx.lineTo(PAD + 38, PAD + 20)
  ctx.lineTo(PAD + 20, PAD + 34)
  ctx.closePath()
  ctx.fill()
  font(ctx, 32, 700)
  text(ctx, 'WatchTrack', PAD + 70, PAD + 31, C.fg)

  const chip = r.inProgress ? `${r.year} so far` : `${r.year} in review`
  font(ctx, 26, 600)
  const cw = ctx.measureText(chip).width + 44
  rect(ctx, W - PAD - cw, PAD - 4, cw, 48, 24, C.soft, C.line)
  text(ctx, chip, W - PAD - cw / 2, PAD + 29, C.violet, 'center')

  ctx.fillStyle = C.line
  ctx.fillRect(PAD, H - PAD - 46, INNER, 2)
  font(ctx, 24, 500)
  text(ctx, fit(ctx, 'Tracked privately with WatchTrack', INNER * 0.62), PAD, H - PAD + 2, C.muted)
  text(ctx, fit(ctx, host, INNER * 0.36), W - PAD, H - PAD + 2, C.muted, 'right')
}

function monthBars(ctx: Ctx, r: YearReview, x: number, y: number, w: number, h: number) {
  const gap = 12
  const bw = (w - gap * 11) / 12
  const peak = Math.max(1, ...r.byMonth.map((m) => m.watches))
  r.byMonth.forEach((m, i) => {
    const bx = x + i * (bw + gap)
    const bh = m.watches ? Math.max(10, (m.watches / peak) * h) : 6
    rect(ctx, bx, y + h - bh, bw, bh, 8, i === r.busiestMonth?.month ? C.violet : m.watches ? '#4c3a7a' : C.surface2)
    font(ctx, 22, 600)
    text(ctx, MONTHS[i][0], bx + bw / 2, y + h + 36, i === r.busiestMonth?.month ? C.fg : C.muted, 'center')
  })
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
function weekdayBars(ctx: Ctx, r: YearReview, x: number, y: number, w: number, h: number) {
  const gap = 18
  const bw = (w - gap * 6) / 7
  const peak = Math.max(1, ...r.byWeekday)
  r.byWeekday.forEach((n, i) => {
    const bx = x + i * (bw + gap)
    const bh = n ? Math.max(10, (n / peak) * h) : 6
    const lead = i === r.favouriteWeekday?.weekday
    rect(ctx, bx, y + h - bh, bw, bh, 10, lead ? C.violet : i >= 5 ? '#3b6f8a' : '#4c3a7a')
    font(ctx, 22, 600)
    text(ctx, DAY_LETTERS[i], bx + bw / 2, y + h + 34, lead ? C.fg : C.muted, 'center')
  })
}

function statTile(ctx: Ctx, x: number, y: number, w: number, h: number, value: string, label: string, accent = C.fg, valueSize = 68) {
  rect(ctx, x, y, w, h, 28, C.surface, C.line)
  fitSize(ctx, value, 750, valueSize, 36, w - 56)
  text(ctx, value, x + 28, y + h / 2 + (valueSize < 68 ? 4 : 8), accent)
  font(ctx, 26, 500)
  text(ctx, fit(ctx, label, w - 56), x + 28, y + h - 30, C.muted)
}

const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`
const hoursText = (r: YearReview) => `≈${Math.round(toHours(r.stats.minutes)).toLocaleString()} hours`

// ---------- The four cards ----------

function drawSummary(ctx: Ctx, d: ShareData) {
  const r = d.review
  let y = PAD + 150
  font(ctx, 52, 600)
  text(ctx, r.inProgress ? `My ${r.year} so far` : `My ${r.year}`, PAD, y, C.fg2)

  // The headline number.
  const lead = r.stats.episodes >= r.stats.movies ? { n: r.stats.episodes, what: r.stats.episodes === 1 ? 'episode' : 'episodes' } : { n: r.stats.movies, what: r.stats.movies === 1 ? 'movie' : 'movies' }
  const num = lead.n.toLocaleString()
  const size = fitSize(ctx, num, 800, 220, 120, INNER * 0.7)
  y += size + 10
  text(ctx, num, PAD - 6, y, C.violet)
  const nw = ctx.measureText(num).width
  font(ctx, 48, 600)
  text(ctx, lead.what, PAD + nw + 18, y - 8, C.fg)

  const other = lead.what.startsWith('episode') ? (r.stats.movies ? plural(r.stats.movies, 'movie') : '') : r.stats.episodes ? plural(r.stats.episodes, 'episode') : ''
  y += 66
  font(ctx, 34, 500)
  text(ctx, fit(ctx, [other, hoursText(r), plural(r.stats.activeDays, 'day')].filter(Boolean).join('  ·  '), INNER), PAD, y, C.fg2)

  if (d.personality) {
    y += 56
    font(ctx, 34, 700)
    const name = fit(ctx, d.personality.main.name, INNER - 80)
    const pw = ctx.measureText(name).width + 64
    rect(ctx, PAD, y, pw, 70, 35, C.soft, '#49336d')
    text(ctx, name, PAD + 32, y + 47, C.violet)
    y += 70
  }

  // Top three.
  y += 82
  eyebrow(ctx, 'Most watched', PAD, y)
  y += 20
  for (const [i, t] of r.top.slice(0, 3).entries()) {
    const ry = y + i * 74
    rect(ctx, PAD, ry, INNER, 62, 18, i === 0 ? C.surface2 : C.surface)
    font(ctx, 30, 800)
    text(ctx, String(i + 1), PAD + 34, ry + 42, i === 0 ? C.violet : C.muted, 'center')
    font(ctx, 30, 600)
    const count = String(t.count)
    text(ctx, fit(ctx, t.title, INNER - 200), PAD + 72, ry + 42, C.fg)
    text(ctx, count, W - PAD - 28, ry + 42, C.fg2, 'right')
  }
  y += Math.min(3, r.top.length) * 74 + 40

  // Two insights, wrapped, as long as they fit above the footer.
  font(ctx, 30, 500)
  for (const ins of d.insights.filter((i) => i.id !== 'time' && i.id !== 'top').slice(0, 2)) {
    const lines = wrap(ctx, ins.text, INNER - 36, 2)
    if (y + lines.length * 42 > H - PAD - 80) break
    ctx.fillStyle = C.cyan
    ctx.beginPath()
    ctx.arc(PAD + 8, y - 10, 6, 0, Math.PI * 2)
    ctx.fill()
    for (const line of lines) {
      text(ctx, line, PAD + 36, y, C.fg2)
      y += 42
    }
    y += 18
  }
}

function drawTop(ctx: Ctx, d: ShareData) {
  const r = d.review
  let y = PAD + 200
  eyebrow(ctx, 'Most watched', PAD, y - 64, C.violet)
  font(ctx, 84, 750)
  text(ctx, `My top ${r.top.length}`, PAD, y + 20, C.fg)
  y += 90
  const max = r.top[0]?.count ?? 1
  const rowH = Math.min(170, (H - PAD - 120 - y) / Math.max(1, r.top.length))
  for (const [i, t] of r.top.entries()) {
    const ry = y + i * rowH
    const first = i === 0
    rect(ctx, PAD, ry, INNER, rowH - 20, 30, first ? C.surface2 : C.surface, first ? '#49336d' : C.line)
    font(ctx, first ? 64 : 52, 800)
    text(ctx, String(i + 1), PAD + 62, ry + (rowH - 20) / 2 + 20, first ? C.violet : C.muted, 'center')
    const tx = PAD + 124
    const tw = INNER - 124 - 36
    font(ctx, first ? 42 : 36, 650)
    text(ctx, fit(ctx, t.title, tw), tx, ry + 58, C.fg)
    const bw = tw * (t.count / max)
    rect(ctx, tx, ry + 78, tw, 12, 6, '#2a2740')
    rect(ctx, tx, ry + 78, Math.max(12, bw), 12, 6, first ? C.violet : C.indigo)
    font(ctx, 26, 500)
    const unit = t.mediaType === 'movie' ? (t.count === 1 ? 'watch' : 'watches') : t.count === 1 ? 'episode' : 'episodes'
    text(ctx, fit(ctx, `${t.count.toLocaleString()} ${unit}${t.completed ? '  ·  completed' : ''}`, tw), tx, ry + 124, C.muted)
  }
}

function drawStats(ctx: Ctx, d: ShareData) {
  const r = d.review
  let y = PAD + 200
  eyebrow(ctx, 'By the numbers', PAD, y - 64, C.violet)
  font(ctx, 84, 750)
  text(ctx, r.inProgress ? `${r.year} so far` : `${r.year}`, PAD, y + 20, C.fg)
  y += 70
  const gap = 24
  const tw = (INNER - gap) / 2
  const th = 170
  const tiles: [string, string, string?][] = [
    [r.stats.episodes.toLocaleString(), 'Episodes', C.violet],
    [r.stats.movies.toLocaleString(), 'Movies'],
    [hoursText(r).replace(' hours', ''), 'Hours, estimated', C.cyan],
    [r.stats.activeDays.toLocaleString(), 'Days you watched'],
    [`${r.stats.longestStreak?.days ?? 0}`, 'Longest streak (days)'],
    [r.titles.toLocaleString(), 'Titles'],
  ]
  tiles.forEach(([v, l, color], i) => statTile(ctx, PAD + (i % 2) * (tw + gap), y + Math.floor(i / 2) * (th + gap), tw, th, v, l, color))
  y += 3 * (th + gap) + 30
  eyebrow(ctx, r.busiestMonth ? `Busiest month: ${MONTHS[r.busiestMonth.month]}` : 'Month by month', PAD, y)
  monthBars(ctx, r, PAD, y + 30, INNER, 150)
}

function drawPersonality(ctx: Ctx, d: ShareData) {
  const r = d.review
  const p = d.personality
  let y = PAD + 210
  eyebrow(ctx, 'My watching personality', PAD, y - 64, C.violet)
  if (!p) return
  font(ctx, 96, 800)
  for (const line of wrap(ctx, p.main.name, INNER, 2)) {
    text(ctx, line, PAD - 4, y + 40, C.fg)
    y += 108
  }
  y += 24
  font(ctx, 40, 600)
  for (const line of wrap(ctx, p.main.tagline, INNER, 2)) {
    text(ctx, line, PAD, y, C.violet)
    y += 54
  }
  y += 18
  font(ctx, 32, 500)
  for (const line of wrap(ctx, p.main.reason, INNER, 4)) {
    text(ctx, line, PAD, y, C.fg2)
    y += 46
  }
  y += 40
  const gap = 24
  const tw = (INNER - gap * 2) / 3
  const tiles: [string, string][] = [
    [r.stats.watches.toLocaleString(), 'Watched'],
    [r.stats.activeDays.toLocaleString(), 'Days'],
    [`${r.stats.longestStreak?.days ?? 0}`, 'Best streak'],
  ]
  tiles.forEach(([v, l], i) => statTile(ctx, PAD + i * (tw + gap), y, tw, 130, v, l, i === 0 ? C.violet : C.fg, 56))
  y += 130 + 48
  if (p.also.length && y < H - PAD - 140) {
    eyebrow(ctx, 'Also a bit of', PAD, y)
    font(ctx, 32, 600)
    text(ctx, fit(ctx, p.also.map((a) => a.name.replace(/^The /, '')).join('  ·  '), INNER), PAD, y + 50, C.fg2)
    y += 104
  }
  // When you watch, sized to the room left above the footer (eyebrow, bars, then day letters 34px below them).
  // 30px clear above the footer line.
  const chartH = Math.min(120, H - PAD - 60 - 30 - (y + 24 + 34))
  if (chartH >= 60) {
    eyebrow(ctx, 'When I watch', PAD, y)
    weekdayBars(ctx, r, PAD, y + 24, INNER, chartH)
  }
}

const DRAW: Record<ShareVariant, (ctx: Ctx, d: ShareData) => void> = { summary: drawSummary, top: drawTop, stats: drawStats, personality: drawPersonality }

export function drawReview(d: ShareData, variant: ShareVariant, host: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This browser can't make images.")
  ctx.textBaseline = 'alphabetic'
  frame(ctx, d.review, host)
  DRAW[variant](ctx, d)
  return canvas
}

export const fileName = (r: YearReview, variant: ShareVariant) => `watchtrack-${r.year}-${variant === 'summary' ? 'in-review' : variant}.png`

/** A preview for the page, as a short-lived object URL. */
export async function previewReview(d: ShareData, variant: ShareVariant): Promise<string> {
  const blob = await toBlob(drawReview(d, variant, location.host))
  return URL.createObjectURL(blob)
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the image."))), 'image/png'))

/** Shares the card on phones (installed apps can't always download), downloads it elsewhere. False if cancelled. */
export async function shareReviewImage(d: ShareData, variant: ShareVariant = 'summary'): Promise<boolean> {
  const blob = await toBlob(drawReview(d, variant, location.host))
  const file = new File([blob], fileName(d.review, variant), { type: 'image/png' })
  if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `My ${d.review.year} in WatchTrack` })
      return true
    } catch (err) {
      if ((err as Error).name === 'AbortError') return false
      // Refused: download instead.
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

