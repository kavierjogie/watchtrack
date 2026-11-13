import { getImage } from './db'
import { publicPosterUrl } from './posters'
import { MONTHS, toHours, WEEKDAYS, type TopTitle, type YearReview } from './review'
import { reviewHeadline, shareHighlight, type Insight, type Personality } from './reviewStory'
import { SITE_URL } from './share'
import type { Title } from './types'

/**
 * Year in review share cards, drawn on this device as 1080×1350 PNGs (4:5, the size Instagram and most feeds show
 * uncropped). Every number on a card comes from the same YearReview the page shows. Poster artwork is the device's own
 * saved copy where there is one; a remote poster is only drawn when its host allows it (CORS), so the canvas can't be
 * tainted, and anything missing gets a typographic tile instead. Nothing about you is sent anywhere.
 */

export type ShareVariant = 'summary' | 'top' | 'stats' | 'personality'

export interface ShareData {
  review: YearReview
  personality: { main: Personality; also: Personality[] } | null
  insights: Insight[]
}

type Art = ImageBitmap | HTMLImageElement
/** Poster images by title id, loaded once per share session (loadArtwork). */
export type Artwork = Map<string, Art>

export const W = 1080
export const H = 1350
/** Safe margin: feeds and story crops eat into the edges, so nothing that matters sits within 80px of one. */
export const PAD = 80
const INNER = W - PAD * 2
/** Everything above this line is the viewer's year; below it, the WatchTrack sign-off. */
export const FOOTER_TOP = 1130
const CONTENT_END = FOOTER_TOP - 36
export const SITE_HOST = new URL(SITE_URL).host

const C = {
  fg: '#f5f3ff',
  fg2: '#cfc9e6',
  muted: '#9b94bb',
  violet: '#a78bfa',
  lavender: '#ddd6fe',
  electric: '#8b5cf6',
  indigo: '#6366f1',
  cyan: '#67e8f9',
  tile: '#171531',
  line: 'rgba(221,214,254,0.14)',
  track: 'rgba(221,214,254,0.08)',
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

/** The largest size from `start` down to `min` at which `text` fits on one line (and leaves that font set). */
function fitSize(ctx: Ctx, text: string, weight: number, start: number, min: number, max: number): number {
  for (let size = start; size > min; size -= 2) {
    font(ctx, size, weight)
    if (ctx.measureText(text).width <= max) return size
  }
  font(ctx, min, weight)
  return min
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient, stroke?: string) {
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

function text(ctx: Ctx, s: string, x: number, y: number, color: string | CanvasGradient, align: CanvasTextAlign = 'left') {
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(s, x, y)
  ctx.textAlign = 'left'
}

function eyebrow(ctx: Ctx, s: string, x: number, y: number, color = C.muted, max = INNER) {
  font(ctx, 24, 700)
  ctx.letterSpacing = '4px'
  text(ctx, fit(ctx, s.toUpperCase(), max), x, y, color)
  ctx.letterSpacing = '0px'
}

/** Violet → periwinkle → cyan, across the text it fills: the review's signature. */
function brand(ctx: Ctx, x0: number, x1: number) {
  const g = ctx.createLinearGradient(x0, 0, Math.max(x0 + 1, x1), 0)
  g.addColorStop(0, C.violet)
  g.addColorStop(0.55, '#a5b4fc')
  g.addColorStop(1, C.cyan)
  return g
}

function glow(ctx: Ctx, x: number, y: number, radius: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

/** The app icon (public/icon.svg), drawn rather than loaded: a W as a scrub track, watched part in lavender. */
function logo(ctx: Ctx, x: number, y: number, size: number) {
  const k = size / 512
  rect(ctx, x, y, size, size, 116 * k, '#171725', 'rgba(167,139,250,0.35)')
  const pts: [number, number][] = [
    [104, 150],
    [188, 362],
    [256, 226],
    [324, 362],
    [408, 150],
  ]
  const line = (ps: [number, number][], color: string) => {
    ctx.strokeStyle = color
    ctx.beginPath()
    ps.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * k, y + py * k) : ctx.moveTo(x + px * k, y + py * k)))
    ctx.stroke()
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 60 * k
  line(pts, '#5d4f8f')
  line([...pts.slice(0, 4), [372.7, 239]], C.violet)
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  for (const [r, color] of [
    [49, '#171725'],
    [38, C.fg],
  ] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x + 372.7 * k, y + 239 * k, r * k, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Background, brand row and sign-off: the same frame on every card, so any one of them reads as WatchTrack. */
function frame(ctx: Ctx, r: YearReview) {
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H)
  bg.addColorStop(0, '#0e0a2a')
  bg.addColorStop(0.55, '#08071a')
  bg.addColorStop(1, '#0c0922')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  glow(ctx, W * 0.92, 40, 820, 'rgba(139,92,246,0.36)')
  glow(ctx, -80, H * 0.6, 760, 'rgba(79,70,229,0.2)')
  glow(ctx, W + 40, H - 120, 560, 'rgba(103,232,249,0.1)')
  // Ripples off the top-right glow: the one decorative accent.
  ctx.lineWidth = 2
  for (const [radius, a] of [
    [300, 0.14],
    [450, 0.09],
    [600, 0.05],
  ]) {
    ctx.strokeStyle = `rgba(196,181,253,${a})`
    ctx.beginPath()
    ctx.arc(W - 30, 30, radius, 0, Math.PI * 2)
    ctx.stroke()
  }

  logo(ctx, PAD, PAD, 60)
  font(ctx, 36, 750)
  text(ctx, 'Watch', PAD + 78, PAD + 43, C.fg)
  text(ctx, 'Track', PAD + 78 + ctx.measureText('Watch').width, PAD + 43, C.violet)

  const chip = (r.inProgress ? `${r.year} so far` : `${r.year} in review`).toUpperCase()
  font(ctx, 22, 700)
  ctx.letterSpacing = '3px'
  const cw = ctx.measureText(chip).width + 52
  rect(ctx, W - PAD - cw, PAD + 4, cw, 52, 26, 'rgba(139,92,246,0.16)', 'rgba(167,139,250,0.45)')
  text(ctx, chip, W - PAD - cw / 2 + 1.5, PAD + 38, C.lavender, 'center')
  ctx.letterSpacing = '0px'

  ctx.fillStyle = C.line
  ctx.fillRect(PAD, FOOTER_TOP, INNER, 2)
  font(ctx, 30, 750)
  text(ctx, fit(ctx, 'Your watching story, your way.', INNER), PAD, FOOTER_TOP + 52, C.fg)
  font(ctx, 24, 500)
  text(ctx, fit(ctx, 'Create your own Year in Review with WatchTrack.', INNER), PAD, FOOTER_TOP + 90, C.muted)
  font(ctx, 26, 750)
  text(ctx, fit(ctx, SITE_HOST, INNER), PAD, FOOTER_TOP + 130, C.violet)
}

/** Big headline, up to two lines. Returns the last line's baseline. */
function headline(ctx: Ctx, s: string, y: number, size = 60): number {
  font(ctx, size, 800)
  ctx.letterSpacing = '-1px'
  const lh = Math.round(size * 1.12)
  const lines = wrap(ctx, s, INNER, 2)
  lines.forEach((l, i) => text(ctx, l, PAD - 2, y + i * lh, C.fg))
  ctx.letterSpacing = '0px'
  return y + (lines.length - 1) * lh
}

/** A huge number in the brand gradient, with what it counts set beside it. */
function heroNumber(ctx: Ctx, num: string, unit: string, sub: string, baseline: number, start: number) {
  const size = fitSize(ctx, num, 800, start, 96, INNER - 260)
  ctx.letterSpacing = '-4px'
  const nw = ctx.measureText(num).width
  text(ctx, num, PAD - 6, baseline, brand(ctx, PAD, PAD + nw))
  ctx.letterSpacing = '0px'
  const ux = PAD + nw + 24
  font(ctx, 42, 750)
  text(ctx, fit(ctx, unit, W - PAD - ux), ux, baseline - Math.round(size * 0.36), C.fg)
  font(ctx, 28, 500)
  text(ctx, fit(ctx, sub, W - PAD - ux), ux, baseline - 6, C.muted)
}

/** Columns of value + label, split by hairlines. `y` is the values' baseline; labels sit 40px under it. */
function statRow(ctx: Ctx, items: [string, string][], y: number, size = 60) {
  const colW = INNER / items.length
  items.forEach(([value, label], i) => {
    const x = PAD + i * colW + (i ? 32 : 0)
    const w = colW - (i ? 32 : 0) - 16
    if (i) {
      ctx.fillStyle = C.line
      ctx.fillRect(PAD + i * colW, y - size * 0.8, 2, size * 0.8 + 50)
    }
    fitSize(ctx, value, 800, size, 32, w)
    text(ctx, value, x, y, C.fg)
    font(ctx, 22, 600)
    text(ctx, fit(ctx, label, w), x, y + 40, C.muted)
  })
}

const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`
const hours = (r: YearReview) => `≈${Math.round(toHours(r.stats.minutes)).toLocaleString()}`
const countLabel = (t: TopTitle) => plural(t.count, t.mediaType === 'movie' ? 'watch' : 'episode', t.mediaType === 'movie' ? 'watches' : 'episodes')

/** The headline number is episodes, unless movies outnumber them. */
function lead(r: YearReview) {
  const s = r.stats
  const ep = { n: s.episodes, unit: s.episodes === 1 ? 'episode' : 'episodes' }
  const mv = { n: s.movies, unit: s.movies === 1 ? 'movie' : 'movies' }
  return s.episodes >= s.movies ? { main: ep, other: mv } : { main: mv, other: ep }
}

// ---------- Posters ----------

const size = (img: Art) => ('naturalWidth' in img ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height])

/** A poster cropped to fill the box, or, with no artwork, a lettered tile in the brand colours. */
function poster(ctx: Ctx, t: TopTitle, art: Artwork | undefined, x: number, y: number, w: number, h: number, r: number) {
  const img = art?.get(t.titleId)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.clip()
  const [iw, ih] = img ? size(img) : [0, 0]
  if (img && iw && ih) {
    const k = Math.max(w / iw, h / ih)
    ctx.drawImage(img, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k)
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h)
    g.addColorStop(0, '#3b2a78')
    g.addColorStop(1, '#151a4a')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
    const initial = [...t.title.trim()][0]?.toUpperCase() ?? '?'
    font(ctx, Math.round(w * 0.46), 800)
    text(ctx, initial, x + w / 2, y + h / 2 + w * 0.16, 'rgba(221,214,254,0.85)', 'center')
    if (w >= 150) {
      font(ctx, 18, 700)
      ctx.letterSpacing = '3px'
      text(ctx, t.mediaType === 'tv' ? 'TV' : t.mediaType.toUpperCase(), x + w / 2 + 1.5, y + h - 24, 'rgba(221,214,254,0.6)', 'center')
      ctx.letterSpacing = '0px'
    }
  }
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 2
  ctx.stroke()
}

// ---------- The four cards ----------

function drawSummary(ctx: Ctx, d: ShareData, art?: Artwork) {
  const r = d.review
  const { main, other } = lead(r)
  const who = d.personality ? ` · ${d.personality.main.name}` : ''
  eyebrow(ctx, `${r.inProgress ? `My ${r.year} so far` : `My ${r.year}`}${who}`, PAD, 236, C.violet)
  let y = headline(ctx, reviewHeadline(r, d.personality?.main ?? null), 308)

  y += 186
  heroNumber(ctx, main.n.toLocaleString(), main.unit, 'watched', y, 176)

  const third: [string, string] = r.stats.completedSeries ? [r.stats.completedSeries.toLocaleString(), 'Series completed'] : [r.stats.activeDays.toLocaleString(), 'Days watching']
  y += 104
  statRow(ctx, [other.n ? [other.n.toLocaleString(), other.unit[0].toUpperCase() + other.unit.slice(1)] : [r.titles.toLocaleString(), 'Titles'], [hours(r), 'Hours, estimated'], third], y)

  // Top titles: as many rows as fit, one line each, with a small poster.
  y += 112
  const room = Math.floor((CONTENT_END - 70 - (y + 22)) / 58)
  const top = r.top.slice(0, Math.max(0, Math.min(5, room)))
  if (top.length) {
    eyebrow(ctx, `My top ${top.length}`, PAD, y)
    y += 22
    for (const [i, t] of top.entries()) {
      const ry = y + i * 58
      poster(ctx, t, art, PAD, ry, 34, 50, 8)
      font(ctx, 30, 800)
      text(ctx, String(i + 1), PAD + 74, ry + 36, i === 0 ? C.violet : C.muted, 'center')
      font(ctx, 24, 600)
      const count = countLabel(t)
      const cw = ctx.measureText(count).width
      text(ctx, count, W - PAD, ry + 35, C.fg2, 'right')
      font(ctx, 30, i === 0 ? 750 : 600)
      text(ctx, fit(ctx, t.title, INNER - 112 - cw - 24), PAD + 112, ry + 36, C.fg)
    }
    y += top.length * 58
  }

  const hl = shareHighlight(d.insights)
  if (hl && y + 56 <= CONTENT_END) {
    y += 52
    ctx.fillStyle = C.cyan
    ctx.beginPath()
    ctx.arc(PAD + 7, y - 10, 7, 0, Math.PI * 2)
    ctx.fill()
    font(ctx, 26, 500)
    text(ctx, fit(ctx, hl.text, INNER - 32), PAD + 32, y, C.fg2)
  }
}

function drawTop(ctx: Ctx, d: ShareData, art?: Artwork) {
  const r = d.review
  eyebrow(ctx, `My top ${r.top.length}`, PAD, 236, C.violet)
  const y = headline(ctx, r.top.length > 1 ? 'The titles that defined my year.' : 'The title that defined my year.', 308)
  const [first, ...rest] = r.top
  if (!first) return

  // Number one, large.
  const y0 = y + 56
  const pw = 200
  poster(ctx, first, art, PAD, y0, pw, 300, 22)
  const x = PAD + pw + 44
  const cw = W - PAD - x
  font(ctx, 120, 800)
  ctx.letterSpacing = '-4px'
  text(ctx, '#1', x - 4, y0 + 100, brand(ctx, x, x + ctx.measureText('#1').width))
  ctx.letterSpacing = '0px'
  font(ctx, 50, 750)
  let ty = y0 + 172
  for (const line of wrap(ctx, first.title, cw, 2)) {
    text(ctx, line, x, ty, C.fg)
    ty += 58
  }
  font(ctx, 28, 600)
  text(ctx, fit(ctx, `${countLabel(first)}  ·  ≈${plural(Math.round(toHours(first.minutes)), 'hour')}`, cw), x, ty + 4, C.fg2)
  if (first.completed) {
    font(ctx, 22, 700)
    const label = `Completed in ${r.year}`
    const bw = ctx.measureText(label).width + 40
    rect(ctx, x, ty + 30, bw, 44, 22, 'rgba(103,232,249,0.12)', 'rgba(103,232,249,0.4)')
    text(ctx, label, x + 20, ty + 60, C.cyan)
  }

  // Two to five, in a two-by-two grid, posters as tall as the room allows (150–200px).
  const y1 = y0 + 300 + 40
  const rows = Math.ceil(rest.length / 2)
  const step = rows ? Math.min(224, Math.floor((CONTENT_END - y1) / rows)) : 0
  const ph = Math.max(150, step - 24)
  const sw = Math.round(ph / 1.5)
  const cellW = (INNER - 32) / 2
  for (const [i, t] of rest.entries()) {
    const cx = PAD + (i % 2) * (cellW + 32)
    const cy = y1 + Math.floor(i / 2) * step
    poster(ctx, t, art, cx, cy, sw, ph, 14)
    const tx = cx + sw + 24
    const tw = cellW - sw - 24
    const ty = cy + Math.max(0, (ph - 150) / 2)
    font(ctx, 34, 800)
    text(ctx, `#${i + 2}`, tx, ty + 38, C.violet)
    font(ctx, 28, 700)
    const lines = wrap(ctx, t.title, tw, 2)
    lines.forEach((l, k) => text(ctx, l, tx, ty + 80 + k * 34, C.fg))
    font(ctx, 22, 500)
    text(ctx, fit(ctx, countLabel(t), tw), tx, ty + 84 + lines.length * 34, C.muted)
  }
}

function drawStats(ctx: Ctx, d: ShareData) {
  const r = d.review
  eyebrow(ctx, 'By the numbers', PAD, 236, C.violet)
  const title = r.inProgress ? `My ${r.year} so far, in numbers.` : `My ${r.year}, in numbers.`
  const hs = fitSize(ctx, title, 800, 60, 40, INNER)
  text(ctx, title, PAD - 2, 308, C.fg)

  const { main, other } = lead(r)
  const big = (value: string, unit: string, sub: string, baseline: number, start: number, gradient: boolean) => {
    const s = fitSize(ctx, value, 800, start, 64, INNER - 300)
    ctx.letterSpacing = '-3px'
    const vw = ctx.measureText(value).width
    text(ctx, value, PAD - 4, baseline, gradient ? brand(ctx, PAD, PAD + vw) : C.fg)
    ctx.letterSpacing = '0px'
    const ux = PAD + vw + 24
    font(ctx, 40, 750)
    text(ctx, fit(ctx, unit, W - PAD - ux), ux, baseline - Math.round(s * 0.34), C.fg)
    font(ctx, 24, 500)
    text(ctx, fit(ctx, sub, W - PAD - ux), ux, baseline - 4, C.muted)
    ctx.fillStyle = C.line
    ctx.fillRect(PAD, baseline + 34, INNER, 2)
  }
  const mix = [r.animeEpisodes && `${r.animeEpisodes.toLocaleString()} anime`, r.tvEpisodes && `${r.tvEpisodes.toLocaleString()} TV`].filter(Boolean).join(' · ')
  big(main.n.toLocaleString(), main.unit, main.unit.startsWith('ep') ? mix || 'watched' : 'watched', 308 + hs * 0.2 + 160, 170, true)
  const rows: [string, string, string][] = []
  if (other.n) rows.push([other.n.toLocaleString(), other.unit, 'watched'])
  rows.push([hours(r), 'hours', 'estimated from typical lengths'])
  if (rows.length < 2) rows.push([r.titles.toLocaleString(), r.titles === 1 ? 'title' : 'titles', 'watched something of'])
  big(...rows[0], 616, 104, false)
  big(...rows[1], 751, 104, false)

  statRow(
    ctx,
    [
      [r.stats.activeDays.toLocaleString(), 'Days watching'],
      [String(r.stats.longestStreak?.days ?? 0), 'Longest streak'],
      [r.stats.completedSeries ? r.stats.completedSeries.toLocaleString() : r.titles.toLocaleString(), r.stats.completedSeries ? 'Series completed' : 'Titles'],
    ],
    870,
    56,
  )

  eyebrow(ctx, r.busiestMonth ? `Busiest month: ${MONTHS[r.busiestMonth.month]}` : 'Month by month', PAD, 972)
  bars(
    ctx,
    r.byMonth.map((m) => m.watches),
    r.busiestMonth?.month ?? -1,
    MONTHS.map((m) => m[0]),
    984,
    70,
  )
}

/** Rounded bars on a faint track; the peak in the brand gradient. Letters sit 34px under the bars. */
function bars(ctx: Ctx, values: number[], peakIndex: number, letters: string[], y: number, h: number) {
  const gap = values.length > 7 ? 12 : 18
  const bw = (INNER - gap * (values.length - 1)) / values.length
  const peak = Math.max(1, ...values)
  values.forEach((n, i) => {
    const bx = PAD + i * (bw + gap)
    rect(ctx, bx, y, bw, h, 8, C.track)
    if (n) {
      const bh = Math.max(10, (n / peak) * h)
      const g = ctx.createLinearGradient(0, y + h - bh, 0, y + h)
      g.addColorStop(0, i === peakIndex ? C.cyan : '#7c6cd6')
      g.addColorStop(1, i === peakIndex ? C.electric : '#3d3480')
      rect(ctx, bx, y + h - bh, bw, bh, 8, g)
    }
    font(ctx, 20, 700)
    text(ctx, letters[i], bx + bw / 2, y + h + 34, i === peakIndex ? C.fg : C.muted, 'center')
  })
}

function drawPersonality(ctx: Ctx, d: ShareData) {
  const r = d.review
  const p = d.personality
  eyebrow(ctx, 'My watching personality', PAD, 236, C.violet)
  if (!p) return
  let y = 330
  font(ctx, 88, 800)
  ctx.letterSpacing = '-2px'
  for (const line of wrap(ctx, p.main.name, INNER, 2)) {
    text(ctx, line, PAD - 4, y, brand(ctx, PAD, PAD + ctx.measureText(line).width))
    y += 96
  }
  ctx.letterSpacing = '0px'
  y += 6
  font(ctx, 40, 650)
  for (const line of wrap(ctx, p.main.tagline, INNER, 2)) {
    text(ctx, line, PAD, y, C.lavender)
    y += 52
  }
  y += 14
  font(ctx, 30, 500)
  for (const line of wrap(ctx, p.main.reason, INNER, 4)) {
    text(ctx, line, PAD, y, C.fg2)
    y += 42
  }
  y += 76
  statRow(
    ctx,
    [
      [r.stats.watches.toLocaleString(), 'Watched'],
      [r.stats.activeDays.toLocaleString(), 'Days'],
      [String(r.stats.longestStreak?.days ?? 0), 'Best streak'],
    ],
    y,
    56,
  )
  y += 110
  if (p.also.length && y + 60 < CONTENT_END - 140) {
    eyebrow(ctx, 'Also a bit of', PAD, y)
    font(ctx, 30, 600)
    text(ctx, fit(ctx, p.also.map((a) => a.name.replace(/^The /, '')).join('  ·  '), INNER), PAD, y + 46, C.fg2)
    y += 100
  }
  // When you watch, sized to the room left: eyebrow, 20px, bars, then letters 34px under them.
  const chartH = Math.min(110, CONTENT_END - (y + 20) - 34)
  if (chartH >= 50) {
    eyebrow(ctx, r.favouriteWeekday ? `When I watch: ${WEEKDAYS[r.favouriteWeekday.weekday]}s lead` : 'When I watch', PAD, y)
    bars(ctx, r.byWeekday, r.favouriteWeekday?.weekday ?? -1, ['M', 'T', 'W', 'T', 'F', 'S', 'S'], y + 20, chartH)
  }
}

const DRAW: Record<ShareVariant, (ctx: Ctx, d: ShareData, art?: Artwork) => void> = { summary: drawSummary, top: drawTop, stats: drawStats, personality: drawPersonality }

export function drawReview(d: ShareData, variant: ShareVariant, art?: Artwork): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This browser can't make images.")
  ctx.textBaseline = 'alphabetic'
  frame(ctx, d.review)
  DRAW[variant](ctx, d, art)
  return canvas
}

export const fileName = (r: YearReview, variant: ShareVariant) => `watchtrack-${r.year}-${variant === 'summary' ? 'in-review' : variant}.png`

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the image."))), 'image/png'))

/**
 * The finished PNG. The preview shows this exact blob and sharing sends it, so what you see is what you post. Waits for
 * fonts first; if a poster somehow tainted the canvas, it's drawn again without artwork rather than failing.
 */
export async function renderReview(d: ShareData, variant: ShareVariant, art?: Artwork): Promise<Blob> {
  await document.fonts?.ready
  try {
    return await toBlob(drawReview(d, variant, art))
  } catch (err) {
    if (art?.size && (err as Error).name === 'SecurityError') return toBlob(drawReview(d, variant))
    throw err
  }
}

// ---------- Artwork ----------

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

async function loadPoster(t: Title): Promise<Art | null> {
  if (t.poster?.kind === 'local') {
    const stored = await getImage(t.poster.imageId).catch(() => undefined)
    if (stored) return createImageBitmap(stored.blob)
  }
  // A remote poster only when online, and only if its host allows canvas use (otherwise it fails here, not later).
  const url = publicPosterUrl(t.poster)
  if (!url || !navigator.onLine) return null
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.src = url
  await img.decode()
  return img
}

/** Posters for the given titles. Missing or failing ones are left out, and their cards use lettered tiles. */
export async function loadArtwork(titles: (Title | undefined)[], timeoutMs = 5000): Promise<Artwork> {
  const out: Artwork = new Map()
  await Promise.all(
    titles.map(async (t) => {
      if (!t?.poster) return
      const img = await withTimeout(loadPoster(t), timeoutMs).catch(() => null)
      if (img) out.set(t.id, img)
    }),
  )
  return out
}

// ---------- Getting it off the device ----------

/** Whether this browser can hand an image to the system share sheet. */
export function canShareFiles(): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [new File([new Uint8Array(1)], 'x.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

/** Opens the share sheet with the card. 'cancelled' when the user closes it. */
export async function shareImage(blob: Blob, d: ShareData, variant: ShareVariant): Promise<'shared' | 'cancelled'> {
  const file = new File([blob], fileName(d.review, variant), { type: 'image/png' })
  try {
    await navigator.share({ files: [file], title: `My ${d.review.year} in WatchTrack` })
    return 'shared'
  } catch (err) {
    if ((err as Error).name === 'AbortError') return 'cancelled'
    throw err
  }
}

export function downloadImage(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
