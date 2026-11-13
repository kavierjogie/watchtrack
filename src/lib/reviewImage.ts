import { getImage } from './db'
import { publicPosterUrl } from './posters'
import { MONTHS, monthState, WEEKDAYS, type TopTitle, type YearReview } from './review'
import type { Highlight, HighlightId, Personality, PersonalityId } from './reviewStory'
import { SITE_URL } from './share'
import type { MediaType, Title } from './types'

/**
 * Year in review share cards, drawn on this device as 1080×1350 PNGs (4:5, the size Instagram and most feeds show
 * uncropped). Every number on a card comes from the same YearReview the page shows; nothing is estimated (watch time
 * is left off, as runtimes aren't stored). Poster artwork is the device's own saved copy where there is one; a remote
 * poster is only drawn when its host allows it (CORS), so the canvas can't be tainted, and anything missing gets a
 * lettered tile instead. Nothing about you is sent anywhere.
 */

export type ShareVariant = 'top' | 'stats' | 'personality' | 'highlight'
export type ShareTheme = 'midnight' | 'daylight'

export interface ShareData {
  review: YearReview
  personality: { main: Personality; also: Personality[] } | null
  highlights: Highlight[]
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
export const FOOTER_TOP = 1150
const CONTENT_END = FOOTER_TOP - 36
export const SITE_HOST = new URL(SITE_URL).host
/** Top Five needs at least this many titles; with 3 or 4 it's a Top Three, never padded out. */
export const TOP_MIN = 3
export const topCount = (r: YearReview) => (r.top.length >= 5 ? 5 : r.top.length >= TOP_MIN ? TOP_MIN : 0)

const PALETTES = {
  midnight: {
    bg: ['#1d1813', '#110e0b', '#17130f'],
    glow: ['rgba(124,196,164,0.30)', 'rgba(233,184,114,0.16)', 'rgba(166,220,196,0.08)'],
    ring: 'rgba(190,226,208,',
    fg: '#f3eee7',
    fg2: '#cfc8bf',
    muted: '#a09990',
    accent: '#7cc4a4',
    cyan: '#e9b872',
    ink: ['#7cc4a4', '#b9d9a0', '#e9b872'],
    panel: 'rgba(255,255,255,0.045)',
    panelLine: 'rgba(232,224,212,0.12)',
    line: 'rgba(232,224,212,0.14)',
    track: 'rgba(232,224,212,0.08)',
    bar: ['#5f9d82', '#2f4a3d'],
    chip: ['rgba(124,196,164,0.16)', 'rgba(124,196,164,0.45)', '#cfe8dc'],
  },
  daylight: {
    bg: ['#fbf8f4', '#f4efe9', '#efe6da'],
    glow: ['rgba(47,125,97,0.18)', 'rgba(144,96,31,0.12)', 'rgba(124,196,164,0.16)'],
    ring: 'rgba(47,125,97,',
    fg: '#221c17',
    fg2: '#57514c',
    muted: '#76716b',
    accent: '#2f7d61',
    cyan: '#90601f',
    ink: ['#2f7d61', '#5f7d3a', '#90601f'],
    panel: 'rgba(255,255,255,0.62)',
    panelLine: 'rgba(47,125,97,0.16)',
    line: 'rgba(34,28,23,0.14)',
    track: 'rgba(34,28,23,0.08)',
    bar: ['#8fc4ac', '#3f8a6c'],
    chip: ['rgba(47,125,97,0.1)', 'rgba(47,125,97,0.35)', '#26644e'],
  },
}
type Palette = (typeof PALETTES)['midnight']
// ponytail: one palette per draw, set by drawReview; drawing is synchronous so two cards can't interleave.
let C: Palette = PALETTES.midnight
/** Poster overlays sit on a dark scrim in both themes. */
const ON_POSTER = { fg: '#ffffff', fg2: 'rgba(255,255,255,0.74)', ink: PALETTES.midnight.ink }

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const MEDIA: Record<MediaType, string> = { anime: 'Anime', tv: 'Series', movie: 'Movie' }
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
    if (line) {
      // Out of lines: what's left goes on this one, shortened.
      if (lines.length === maxLines - 1) {
        lines.push(fit(ctx, [line, ...words.slice(i)].join(' '), max))
        return lines
      }
      lines.push(line)
    }
    line = words[i]
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

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient, stroke?: string | CanvasGradient, lw = 2) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = lw
    ctx.stroke()
  }
}

function text(ctx: Ctx, s: string, x: number, y: number, color: string | CanvasGradient, align: CanvasTextAlign = 'left') {
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(s, x, y)
  ctx.textAlign = 'left'
}

function eyebrow(ctx: Ctx, s: string, x: number, y: number, color = C.muted, max = INNER, size = 24) {
  font(ctx, size, 700)
  ctx.letterSpacing = '4px'
  text(ctx, fit(ctx, s.toUpperCase(), max), x, y, color)
  ctx.letterSpacing = '0px'
}

/** Mint → sage → honey across what it fills: the review's signature. */
function ink(ctx: Ctx, x0: number, x1: number, stops = C.ink, y0 = 0, y1 = 0) {
  const g = ctx.createLinearGradient(x0, y0, Math.max(x0 + 1, x1), y1)
  g.addColorStop(0, stops[0])
  g.addColorStop(0.55, stops[1])
  g.addColorStop(1, stops[2])
  return g
}

function glow(ctx: Ctx, x: number, y: number, radius: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

function rings(ctx: Ctx, x: number, y: number, radii: number[], alpha: number) {
  ctx.lineWidth = 2
  radii.forEach((radius, i) => {
    ctx.strokeStyle = `${C.ring}${alpha / (i + 1)})`
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.stroke()
  })
}

// ---------- Icons (lucide's own 24×24 outlines, so the cards match the app) ----------

const ICONS = {
  flame: ['M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4'],
  timer: ['M10 2h4', 'M12 14l3-3', 'M4 14a8 8 0 1 0 16 0a8 8 0 1 0-16 0'],
  check: ['M21.801 10A10 10 0 1 1 17 3.335', 'm9 11 3 3L22 4'],
  calendar: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M16 2v3', 'M3 9h18', 'M8 2v3', 'M17 13h-6', 'M13 17H7', 'M7 13h.01', 'M17 17h.01'],
  repeat: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  sparkles: [
    'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    'M20 2v4',
    'M22 4h-4',
    'M2 20a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  film: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M7 3v18', 'M3 7.5h4', 'M3 12h18', 'M3 16.5h4', 'M17 3v18', 'M17 7.5h4', 'M17 16.5h4'],
  coffee: ['M10 2v2', 'M14 2v2', 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1', 'M6 2v2'],
  compass: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'm16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z'],
  trophy: [
    'M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2',
    'M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2',
    'M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3',
    'M4 22h16',
    'M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z',
    'M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3',
  ],
  milestone: ['M12 13v8', 'M12 3v3', 'M18.172 6a2 2 0 0 1 1.414.586l2.06 2.06a1.207 1.207 0 0 1 0 1.708l-2.06 2.06a2 2 0 0 1-1.414.586H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z'],
  heart: ['M12.127 21H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v5.125', 'M14.62 17.8A2.25 2.25 0 1118 14.836a2.25 2.25 0 113.38 2.966l-2.626 2.856a.998.998 0 01-1.507 0z', 'M16 2v3', 'M3 9h18', 'M8 2v3'],
  layers: [
    'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
    'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12',
    'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17',
  ],
  tv: ['m17 2-5 5-5-5', 'M4 7h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z'],
  crown: ['M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z', 'M5 21h14'],
}
type IconName = keyof typeof ICONS

const PERSONALITY_ICON: Record<PersonalityId, IconName> = {
  marathon: 'timer',
  binge: 'flame',
  completionist: 'check',
  weekend: 'calendar',
  consistent: 'repeat',
  anime: 'sparkles',
  movies: 'film',
  explorer: 'compass',
  easygoing: 'coffee',
}
const HIGHLIGHT_ICON: Record<HighlightId, IconName> = { title: 'crown', binge: 'timer', streak: 'flame', month: 'heart', finished: 'check', genre: 'compass', milestone: 'milestone', furthest: 'trophy' }

function icon(ctx: Ctx, name: IconName, x: number, y: number, size: number, color: string | CanvasGradient, stroke = 2) {
  if (typeof Path2D === 'undefined') return
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of ICONS[name]) ctx.stroke(new Path2D(d))
  ctx.restore()
}

/** A round badge with an icon in it. */
function badge(ctx: Ctx, name: IconName, x: number, y: number, size: number) {
  ctx.beginPath()
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
  ctx.fillStyle = ink(ctx, x, x + size, C.ink, y, y + size)
  ctx.fill()
  const s = size * 0.5
  icon(ctx, name, x + (size - s) / 2, y + (size - s) / 2, s, '#ffffff', 2.2)
}

// ---------- Frame ----------

/** The app icon (public/icon.svg), drawn rather than loaded: a W as a scrub track, watched part in mint. */
function logo(ctx: Ctx, x: number, y: number, size: number) {
  const k = size / 512
  rect(ctx, x, y, size, size, 116 * k, '#221d19', 'rgba(124,196,164,0.35)')
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
  line(pts, '#445c4e')
  line([...pts.slice(0, 4), [372.7, 239]], '#7cc4a4')
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  for (const [r, color] of [
    [49, '#221d19'],
    [38, '#f3eee7'],
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
  bg.addColorStop(0, C.bg[0])
  bg.addColorStop(0.55, C.bg[1])
  bg.addColorStop(1, C.bg[2])
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  glow(ctx, W * 0.92, 40, 820, C.glow[0])
  glow(ctx, -80, H * 0.62, 760, C.glow[1])
  glow(ctx, W + 40, H - 160, 560, C.glow[2])
  rings(ctx, W - 30, 30, [300, 450, 600], 0.14)

  logo(ctx, PAD, PAD, 60)
  font(ctx, 36, 750)
  text(ctx, 'Watch', PAD + 78, PAD + 43, C.fg)
  text(ctx, 'Track', PAD + 78 + ctx.measureText('Watch').width, PAD + 43, C.accent)

  const chip = (r.inProgress ? `${r.year} so far` : `${r.year} in review`).toUpperCase()
  font(ctx, 22, 700)
  ctx.letterSpacing = '3px'
  const cw = ctx.measureText(chip).width + 52
  rect(ctx, W - PAD - cw, PAD + 4, cw, 52, 26, C.chip[0], C.chip[1])
  text(ctx, chip, W - PAD - cw / 2 + 1.5, PAD + 38, C.chip[2], 'center')
  ctx.letterSpacing = '0px'

  ctx.fillStyle = C.line
  ctx.fillRect(PAD, FOOTER_TOP, INNER, 2)
  font(ctx, 26, 750)
  const hw = ctx.measureText(SITE_HOST).width
  text(ctx, SITE_HOST, W - PAD, FOOTER_TOP + 54, C.accent, 'right')
  font(ctx, 30, 750)
  text(ctx, fit(ctx, 'Your watching story, your way.', INNER - hw - 32), PAD, FOOTER_TOP + 54, C.fg)
  font(ctx, 24, 500)
  text(ctx, fit(ctx, 'Create your own Year in Review with WatchTrack.', INNER), PAD, FOOTER_TOP + 94, C.muted)
}

/** Eyebrow and a one-line title under it. Returns the title's baseline. */
function heading(ctx: Ctx, kicker: string, title: string): number {
  eyebrow(ctx, kicker, PAD, 232, C.accent)
  fitSize(ctx, title, 800, 60, 40, INNER)
  ctx.letterSpacing = '-1px'
  text(ctx, fit(ctx, title, INNER), PAD - 2, 300, C.fg)
  ctx.letterSpacing = '0px'
  return 300
}

const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`
const countLabel = (t: TopTitle) => (t.mediaType === 'movie' ? plural(t.count, 'watch', 'watches') : plural(t.count, 'episode'))
const soFar = (r: YearReview) => (r.inProgress ? ' so far' : '')

// ---------- Posters ----------

const size = (img: Art) => ('naturalWidth' in img ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height])

/** A poster cropped to fill the box, or, with no artwork, a lettered tile in the brand colours. */
function poster(ctx: Ctx, t: { titleId: string; title: string }, art: Artwork | undefined, x: number, y: number, w: number, h: number, r: number) {
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
    g.addColorStop(0, '#2f5a48')
    g.addColorStop(0.6, '#2a221b')
    g.addColorStop(1, '#3d2f1f')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
    glow(ctx, x + w * 0.8, y + h * 0.1, w, 'rgba(233,184,114,0.18)')
    const initial = [...t.title.trim()][0]?.toUpperCase() ?? '?'
    font(ctx, Math.round(w * 0.42), 800)
    // High in the tile: the bottom is kept for the rank and title laid over it.
    text(ctx, initial, x + w / 2, y + h * 0.3 + w * 0.15, 'rgba(243,238,231,0.9)', 'center')
  }
  ctx.restore()
}

/** A poster with its rank, title and type laid over a dark scrim at the bottom. */
function rankedPoster(ctx: Ctx, t: TopTitle, rank: number, art: Artwork | undefined, x: number, y: number, w: number, h: number, big: boolean) {
  const r = big ? 28 : 20
  poster(ctx, t, art, x, y, w, h, r)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.clip()
  const s = ctx.createLinearGradient(0, y + h * 0.34, 0, y + h)
  s.addColorStop(0, 'rgba(10,8,6,0)')
  s.addColorStop(0.55, 'rgba(10,8,6,0.72)')
  s.addColorStop(1, 'rgba(10,8,6,0.95)')
  ctx.fillStyle = s
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.strokeStyle = big ? ink(ctx, x, x + w, ON_POSTER.ink, y, y + h) : 'rgba(255,255,255,0.14)'
  ctx.lineWidth = big ? 4 : 2
  ctx.stroke()

  // Overlay sizes follow the tile's width; only a wide hero tile gets the large type.
  const wide = big && w >= 400
  const pad = wide ? 36 : big ? 26 : 20
  const tw = w - pad * 2
  if (big) {
    font(ctx, 18, 750)
    ctx.letterSpacing = '3px'
    const label = 'MY NUMBER ONE'
    const lw = ctx.measureText(label).width + 36
    rect(ctx, x + 24, y + 24, lw, 42, 21, 'rgba(10,8,6,0.62)', 'rgba(255,255,255,0.22)')
    text(ctx, label, x + 24 + 18 + 1.5, y + 52, ON_POSTER.fg)
    ctx.letterSpacing = '0px'
  }
  let metaY = y + h - pad
  font(ctx, wide ? 20 : big ? 18 : 16, 750)
  ctx.letterSpacing = wide ? '3px' : '2px'
  if (wide) text(ctx, fit(ctx, `${MEDIA[t.mediaType]} · ${countLabel(t)}`.toUpperCase(), tw), x + pad, metaY, ON_POSTER.fg2)
  else {
    // Narrow tiles: the count on its own line, so it's never cut off.
    text(ctx, fit(ctx, countLabel(t).toUpperCase(), tw), x + pad, metaY, ON_POSTER.fg2)
    metaY -= big ? 28 : 24
    text(ctx, MEDIA[t.mediaType].toUpperCase(), x + pad, metaY, ON_POSTER.ink[2])
  }
  ctx.letterSpacing = '0px'
  font(ctx, wide ? 46 : big ? 34 : 26, 800)
  const lh = wide ? 54 : big ? 40 : 31
  const lines = wrap(ctx, t.title, tw, 2)
  const lastY = metaY - (wide ? 44 : big ? 36 : 30)
  lines.forEach((l, i) => text(ctx, l, x + pad, lastY - (lines.length - 1 - i) * lh, ON_POSTER.fg))
  const rankSize = wide ? 132 : big ? 96 : 64
  font(ctx, rankSize, 850)
  ctx.letterSpacing = wide ? '-6px' : big ? '-4px' : '-2px'
  const num = String(rank).padStart(2, '0')
  const rankY = lastY - (lines.length - 1) * lh - (wide ? 62 : big ? 50 : 38)
  text(ctx, num, x + pad - (big ? 6 : 3), rankY, ink(ctx, x + pad, x + pad + ctx.measureText(num).width, ON_POSTER.ink))
  ctx.letterSpacing = '0px'
}

// ---------- 1. The Top Five ----------

function drawTop(ctx: Ctx, d: ShareData, art?: Artwork) {
  const r = d.review
  const n = topCount(r)
  const word = n === 5 ? 'five' : 'three'
  heading(ctx, `My top ${word} of ${r.year}`, `The ${word} that defined my year${soFar(r)}.`)
  const top = r.top.slice(0, n)
  if (!top.length) return
  const y0 = 344
  if (n === 5) {
    // Number one tall on the left, two to five in a two-by-two beside it.
    const bw = 460
    const gh = 690
    rankedPoster(ctx, top[0], 1, art, PAD, y0, bw, gh, true)
    const gx = PAD + bw + 24
    const cw = (W - PAD - gx - 20) / 2
    const ch = (gh - 20) / 2
    top.slice(1).forEach((t, i) => rankedPoster(ctx, t, i + 2, art, gx + (i % 2) * (cw + 20), y0 + Math.floor(i / 2) * (ch + 20), cw, ch, false))
  } else {
    // A podium: bottoms level, number one taller in the middle.
    const cw = (INNER - 48) / 3
    const bottom = y0 + 640
    const slots = [
      [PAD + cw + 24, y0],
      [PAD, y0 + 110],
      [PAD + (cw + 24) * 2, y0 + 110],
    ]
    top.forEach((t, i) => rankedPoster(ctx, t, i + 1, art, slots[i][0], slots[i][1], cw, bottom - slots[i][1], i === 0))
  }
  const eps = top.filter((t) => t.mediaType !== 'movie').reduce((s, t) => s + t.count, 0)
  const mv = top.filter((t) => t.mediaType === 'movie').reduce((s, t) => s + t.count, 0)
  const between = [eps && plural(eps, 'episode'), mv && plural(mv, 'movie watch', 'movie watches')].filter(Boolean).join(' and ')
  icon(ctx, 'layers', PAD, 1052, 32, C.accent)
  font(ctx, 28, 600)
  text(ctx, fit(ctx, `Between them: ${between}.`, INNER - 52), PAD + 50, 1078, C.fg2)
}

// ---------- 2. The Numbers ----------

/** Rounded bars on a faint track; the peak in the brand gradient. Letters sit 30px under the bars. */
function bars(ctx: Ctx, values: (number | null)[], peakIndex: number, letters: string[], y: number, h: number) {
  const gap = values.length > 7 ? 12 : 18
  const bw = (INNER - gap * (values.length - 1)) / values.length
  const peak = Math.max(1, ...values.map((v) => v ?? 0))
  values.forEach((n, i) => {
    const bx = PAD + i * (bw + gap)
    rect(ctx, bx, y, bw, h, 8, n === null ? 'rgba(0,0,0,0)' : C.track, n === null ? C.track : undefined)
    if (n) {
      const bh = Math.max(10, (n / peak) * h)
      const g = ctx.createLinearGradient(0, y + h - bh, 0, y + h)
      g.addColorStop(0, i === peakIndex ? C.ink[2] : C.bar[0])
      g.addColorStop(1, i === peakIndex ? C.ink[0] : C.bar[1])
      rect(ctx, bx, y + h - bh, bw, bh, 8, g)
    }
    font(ctx, 20, 700)
    text(ctx, letters[i], bx + bw / 2, y + h + 30, i === peakIndex ? C.fg : C.muted, 'center')
  })
}

function drawStats(ctx: Ctx, d: ShareData) {
  const r = d.review
  const s = r.stats
  heading(ctx, 'By the numbers', `My ${r.year}${soFar(r)}, in numbers.`)

  // The headline number is episodes, unless movies outnumber them.
  const eps = s.episodes >= s.movies
  const lead = eps ? { n: s.episodes, unit: s.episodes === 1 ? 'episode' : 'episodes' } : { n: s.movies, unit: s.movies === 1 ? 'movie' : 'movies' }
  const mix = eps ? [r.animeEpisodes && `${r.animeEpisodes.toLocaleString()} anime`, r.tvEpisodes && `${r.tvEpisodes.toLocaleString()} series`].filter(Boolean).join(' · ') : ''
  const value = lead.n.toLocaleString()
  const size = fitSize(ctx, value, 850, 220, 110, INNER - 320)
  ctx.letterSpacing = '-6px'
  const vw = ctx.measureText(value).width
  const base = 524
  text(ctx, value, PAD - 8, base, ink(ctx, PAD, PAD + vw))
  ctx.letterSpacing = '0px'
  const ux = PAD + vw + 28
  font(ctx, 48, 800)
  text(ctx, fit(ctx, lead.unit, W - PAD - ux), ux, base - Math.round(size * 0.4), C.fg)
  font(ctx, 26, 500)
  text(ctx, fit(ctx, mix.includes(' · ') ? mix : 'watched', W - PAD - ux), ux, base - 8, C.muted)

  const tiles: [number, string, IconName][] = [
    [r.titles, r.titles === 1 ? 'title watched' : 'titles watched', 'layers'],
    eps ? [s.movies, s.movies === 1 ? 'movie watched' : 'movies watched', 'film'] : [s.episodes, s.episodes === 1 ? 'episode watched' : 'episodes watched', 'tv'],
    [s.completedSeries, 'series & anime completed', 'check'],
    [s.activeDays, s.activeDays === 1 ? 'day with something on' : 'days with something on', 'heart'],
    [s.longestStreak && s.longestStreak.days >= 2 ? s.longestStreak.days : 0, 'days, longest streak', 'flame'],
    [r.seriesStarted, 'new series started', 'sparkles'],
  ]
  const shown = tiles.filter(([v]) => v > 0).slice(0, 4)
  const ty = 600
  const th = 178
  const tw = (INNER - 24) / 2
  shown.forEach(([v, label, ic], i) => {
    const full = i === shown.length - 1 && shown.length % 2 === 1
    const x = PAD + (i % 2) * (tw + 24)
    const y = ty + Math.floor(i / 2) * (th + 24)
    const w = full ? INNER : tw
    rect(ctx, x, y, w, th, 28, C.panel, C.panelLine)
    icon(ctx, ic, x + w - 32 - 40, y + 30, 40, C.accent)
    const vs = v.toLocaleString()
    fitSize(ctx, vs, 800, 76, 40, w - 140)
    text(ctx, vs, x + 32, y + 104, C.fg)
    font(ctx, 24, 600)
    text(ctx, fit(ctx, label, w - 64), x + 32, y + 146, C.muted)
  })

  const peak = r.busiestMonth
  eyebrow(ctx, peak && peak.count > 1 ? `Busiest month: ${MONTHS[peak.month]}` : 'Month by month', PAD, 1028, C.muted)
  bars(
    ctx,
    r.byMonth.map((m, i) => (monthState(r, i) === 'tracked' ? m.watches : null)),
    peak?.month ?? -1,
    MONTHS.map((m) => m[0]),
    1044,
    40,
  )
}

// ---------- 3. The Personality ----------

function drawPersonality(ctx: Ctx, d: ShareData) {
  const p = d.personality
  eyebrow(ctx, 'My watching personality', PAD, 232, C.accent, INNER - 260)
  if (!p) return
  const main = p.main

  // The emblem: the trait's icon in a gradient tile, haloed.
  const es = 208
  const ex = W - PAD - es
  const ey = 196
  glow(ctx, ex + es / 2, ey + es / 2, 300, C.glow[0])
  rings(ctx, ex + es / 2, ey + es / 2, [150, 196, 244], 0.32)
  rect(ctx, ex, ey, es, es, 56, ink(ctx, ex, ex + es, C.ink, ey, ey + es), 'rgba(255,255,255,0.3)')
  icon(ctx, PERSONALITY_ICON[main.id], ex + 50, ey + 50, es - 100, '#ffffff', 1.8)

  let y = 372
  // The largest size at which the name fits two lines without being cut.
  let ns = 92
  ctx.letterSpacing = '-3px'
  for (; ns > 60; ns -= 4) {
    font(ctx, ns, 850)
    if (!wrap(ctx, main.name, INNER - es - 40, 2).some((l) => l.endsWith('…'))) break
  }
  font(ctx, ns, 850)
  for (const line of wrap(ctx, main.name, INNER - es - 40, 2)) {
    text(ctx, line, PAD - 4, y, ink(ctx, PAD, PAD + ctx.measureText(line).width))
    y += 100
  }
  ctx.letterSpacing = '0px'
  y -= 20
  font(ctx, 40, 700)
  for (const line of wrap(ctx, main.tagline, INNER, 2)) {
    text(ctx, line, PAD, y, C.fg)
    y += 52
  }
  y += 6
  font(ctx, 28, 500)
  for (const line of wrap(ctx, main.reason, INNER, 2)) {
    text(ctx, line, PAD, y, C.fg2)
    y += 40
  }

  // The number behind it.
  y += 24
  const ph = 170
  rect(ctx, PAD, y, INNER, ph, 32, C.panel, C.panelLine)
  eyebrow(ctx, 'The proof', PAD + 40, y + 48, C.accent, INNER - 80, 20)
  fitSize(ctx, main.stat.value, 850, 96, 56, 380)
  ctx.letterSpacing = '-3px'
  const vw = ctx.measureText(main.stat.value).width
  const vb = y + ph - 34
  text(ctx, main.stat.value, PAD + 36, vb, ink(ctx, PAD + 40, PAD + 40 + vw))
  ctx.letterSpacing = '0px'
  const lx = PAD + 40 + vw + 32
  font(ctx, 30, 650)
  const lines = wrap(ctx, main.stat.label, W - PAD - 40 - lx, 2)
  const ly = vb - (lines.length - 1) * 38 - 4
  lines.forEach((l, i) => text(ctx, l, lx, ly + i * 38, C.fg))
  y += ph + 52

  // Other traits it also qualified for, as chips, while there's room.
  if (p.also.length && y + 70 <= CONTENT_END) {
    eyebrow(ctx, 'Also a bit of', PAD, y, C.muted, INNER, 20)
    let x = PAD
    font(ctx, 24, 650)
    for (const a of p.also) {
      const label = a.name.replace(/^The /, '')
      const w = ctx.measureText(label).width + 40 + 36
      if (x + w > W - PAD) break
      rect(ctx, x, y + 20, w, 50, 25, C.chip[0], C.chip[1])
      icon(ctx, PERSONALITY_ICON[a.id], x + 18, y + 33, 24, C.accent)
      font(ctx, 24, 650)
      text(ctx, label, x + 52, y + 54, C.fg)
      x += w + 12
    }
    y += 122
  }

  // When you watch, in whatever room is left: eyebrow, then bars, then letters 30px under them.
  const r = d.review
  const chartH = Math.min(90, CONTENT_END - 30 - (y + 18))
  if (chartH >= 36) {
    const fav = r.favouriteWeekday
    eyebrow(ctx, fav ? `When I watch: ${WEEKDAYS[fav.weekday]}s lead` : 'When I watch', PAD, y, C.muted, INNER, 20)
    bars(ctx, r.byWeekday, fav?.weekday ?? -1, ['M', 'T', 'W', 'T', 'F', 'S', 'S'], y + 18, chartH)
  }
}

// ---------- 4. The Highlight Reel ----------

function drawHighlight(ctx: Ctx, d: ShareData, art?: Artwork) {
  const r = d.review
  const [hero, ...rest] = d.highlights
  heading(ctx, 'My highlight reel', `The best bit of my ${r.year}${soFar(r)}.`)
  if (!hero) return
  const more = rest.slice(0, 2)
  const y = 344
  const h = more.length ? 474 : CONTENT_END - y
  const panel = ctx.createLinearGradient(PAD, y, W - PAD, y + h)
  panel.addColorStop(0, C === PALETTES.midnight ? 'rgba(47,125,97,0.26)' : 'rgba(47,125,97,0.14)')
  panel.addColorStop(1, C === PALETTES.midnight ? 'rgba(233,184,114,0.06)' : 'rgba(255,255,255,0.55)')
  rect(ctx, PAD, y, INNER, h, 40, panel, ink(ctx, PAD, W - PAD, C.ink, y, y + h), 3)
  // A large faint echo of the icon behind the text.
  ctx.save()
  ctx.globalAlpha = 0.08
  icon(ctx, HIGHLIGHT_ICON[hero.id], W - PAD - 330, y + h - 330, 300, C.accent, 1.5)
  ctx.restore()

  const hasPoster = !!hero.titleId && !!art?.has(hero.titleId)
  const ph = h - 96
  const pw = Math.min(Math.round(ph / 1.5), 320)
  const px = W - PAD - 48 - pw
  if (hasPoster) {
    poster(ctx, { titleId: hero.titleId!, title: hero.unit }, art, px, y + 48, pw, ph, 22)
    ctx.beginPath()
    ctx.roundRect(px, y + 48, pw, ph, 22)
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  const x = PAD + 48
  const tw = (hasPoster ? px - 40 : W - PAD - 48) - x
  badge(ctx, HIGHLIGHT_ICON[hero.id], x, y + 48, 64)
  eyebrow(ctx, hero.label, x + 84, y + 90, C.accent, tw - 84, 22)

  const start = more.length ? 160 : 240
  const vs = fitSize(ctx, hero.value, 850, start, 64, tw)
  ctx.letterSpacing = '-5px'
  const vy = y + 120 + Math.round(vs * 0.76)
  text(ctx, hero.value, x - 6, vy, ink(ctx, x, x + ctx.measureText(hero.value).width))
  ctx.letterSpacing = '0px'
  let ly = vy + 56
  font(ctx, 36, 750)
  const unit = wrap(ctx, hero.unit, tw, 2)
  for (const l of unit) {
    text(ctx, l, x, ly, C.fg)
    ly += 44
  }
  ly += 4
  font(ctx, 26, 500)
  const room = Math.max(0, Math.floor((y + h - 40 - ly + 34) / 36))
  for (const l of wrap(ctx, hero.detail, tw, Math.min(2, room))) {
    text(ctx, l, x, ly, C.fg2)
    ly += 36
  }

  // Runners-up.
  if (!more.length) return
  const y2 = y + h + 26
  const h2 = CONTENT_END - y2
  const w2 = more.length === 1 ? INNER : (INNER - 24) / 2
  more.forEach((m, i) => {
    const x2 = PAD + i * (w2 + 24)
    rect(ctx, x2, y2, w2, h2, 32, C.panel, C.panelLine)
    icon(ctx, HIGHLIGHT_ICON[m.id], x2 + 32, y2 + 32, 34, C.accent)
    eyebrow(ctx, m.label, x2 + 80, y2 + 58, C.muted, w2 - 112, 18)
    fitSize(ctx, m.value, 800, 76, 36, w2 - 64)
    text(ctx, m.value, x2 + 30, y2 + 148, C.fg)
    font(ctx, 24, 600)
    wrap(ctx, m.unit, w2 - 64, 2).forEach((l, k) => text(ctx, l, x2 + 32, y2 + 192 + k * 32, C.fg2))
  })
}

const DRAW: Record<ShareVariant, (ctx: Ctx, d: ShareData, art?: Artwork) => void> = { top: drawTop, stats: drawStats, personality: drawPersonality, highlight: drawHighlight }

export function drawReview(d: ShareData, variant: ShareVariant, art?: Artwork, theme: ShareTheme = 'midnight'): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This browser can't make images.")
  C = PALETTES[theme]
  ctx.textBaseline = 'alphabetic'
  frame(ctx, d.review)
  DRAW[variant](ctx, d, art)
  return canvas
}

const SLUG: Record<ShareVariant, string> = { top: 'top-five', stats: 'numbers', personality: 'personality', highlight: 'highlight' }
export const fileName = (r: YearReview, variant: ShareVariant, theme: ShareTheme = 'midnight') => `watchtrack-${r.year}-${SLUG[variant]}${theme === 'daylight' ? '-light' : ''}.png`

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the image."))), 'image/png'))

/**
 * The finished PNG. The preview shows this exact blob and sharing sends it, so what you see is what you post. Waits for
 * fonts first; if a poster somehow tainted the canvas, it's drawn again without artwork rather than failing.
 */
export async function renderReview(d: ShareData, variant: ShareVariant, art?: Artwork, theme: ShareTheme = 'midnight'): Promise<Blob> {
  await document.fonts?.ready
  try {
    return await toBlob(drawReview(d, variant, art, theme))
  } catch (err) {
    if (art?.size && (err as Error).name === 'SecurityError') return toBlob(drawReview(d, variant, undefined, theme))
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

/** Whether the image can go on the clipboard (the fallback where there's no share sheet: paste into a chat or post). */
export const canCopyImage = () => typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'

export const copyImage = (blob: Blob) => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])

/** Opens the share sheet with the card. 'cancelled' when the user closes it. */
export async function shareImage(blob: Blob, name: string, year: number): Promise<'shared' | 'cancelled'> {
  const file = new File([blob], name, { type: 'image/png' })
  try {
    await navigator.share({ files: [file], title: `My ${year} in WatchTrack` })
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
