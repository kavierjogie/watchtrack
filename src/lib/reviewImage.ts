import { MONTHS, type YearReview } from './review'

/**
 * The year in review as a PNG, drawn on this device. Text and shapes only (no posters), so it needs no network and the
 * canvas never gets "tainted" by images from other sites. Portrait 4:5, the size social apps show without cropping.
 */
const W = 1080
const H = 1350
const PAD = 80
const C = { bg: '#0b0b12', surface: '#171725', fg: '#f4f2fb', muted: '#918ba6', accent: '#a78bfa', accentSoft: '#251b3d' }
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** Shortens `text` with an ellipsis until it fits `max` pixels at the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

export function drawReview(r: YearReview, host: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This browser can't make images.")

  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W, 0, 0, W, 0, W * 0.9)
  glow.addColorStop(0, 'rgba(167,139,250,0.28)')
  glow.addColorStop(1, 'rgba(167,139,250,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.accent
  ctx.font = `600 30px ${FONT}`
  ctx.fillText('WATCHTRACK', PAD, PAD + 30)
  ctx.fillStyle = C.fg
  ctx.font = `700 88px ${FONT}`
  ctx.fillText(`My ${r.year}`, PAD, PAD + 140)
  ctx.fillText('in review', PAD, PAD + 240)

  // Four stat tiles.
  const stats: [string, number][] = [
    ['Episodes', r.episodes],
    ['Movies', r.movies],
    ['Titles', r.titles],
    ['Completed', r.completed],
  ]
  const gap = 24
  const tileW = (W - PAD * 2 - gap) / 2
  const tileH = 150
  stats.forEach(([label, value], i) => {
    const x = PAD + (i % 2) * (tileW + gap)
    const y = 400 + Math.floor(i / 2) * (tileH + gap)
    roundRect(ctx, x, y, tileW, tileH, 28, C.surface)
    ctx.fillStyle = C.fg
    ctx.font = `700 64px ${FONT}`
    ctx.fillText(value.toLocaleString(), x + 32, y + 82)
    ctx.fillStyle = C.muted
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(label, x + 32, y + 124)
  })

  // Watches per month.
  const chartTop = 780
  const chartH = 170
  const barGap = 14
  const barW = (W - PAD * 2 - barGap * 11) / 12
  const peak = Math.max(1, ...r.byMonth)
  r.byMonth.forEach((n, i) => {
    const x = PAD + i * (barW + barGap)
    const h = n ? Math.max(10, (n / peak) * chartH) : 6
    roundRect(ctx, x, chartTop + chartH - h, barW, h, 10, i === r.busiestMonth?.month ? C.accent : C.accentSoft)
    ctx.fillStyle = C.muted
    ctx.font = `500 24px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(MONTHS[i][0], x + barW / 2, chartTop + chartH + 40)
    ctx.textAlign = 'left'
  })

  // Highlights.
  const lines: [string, string][] = []
  if (r.top[0]) lines.push(['Most watched', `${r.top[0].title} · ${r.top[0].count}`])
  if (r.longestStreak && r.longestStreak.days > 1) lines.push(['Longest streak', `${r.longestStreak.days} days in a row`])
  if (r.busiestMonth) lines.push(['Busiest month', MONTHS[r.busiestMonth.month]])
  lines.slice(0, 3).forEach(([label, value], i) => {
    const y = 1075 + i * 62
    ctx.fillStyle = C.muted
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(label, PAD, y)
    ctx.fillStyle = C.fg
    ctx.font = `600 32px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText(fit(ctx, value, W - PAD * 2 - 280), W - PAD, y)
    ctx.textAlign = 'left'
  })

  ctx.fillStyle = C.muted
  ctx.font = `500 24px ${FONT}`
  ctx.fillText(fit(ctx, `Tracked privately with WatchTrack · ${host}`, W - PAD * 2), PAD, H - PAD + 10)
  return canvas
}

/** Shares the image on phones (installed apps can't always download), downloads it elsewhere. False if cancelled. */
export async function shareReviewImage(r: YearReview): Promise<boolean> {
  const canvas = drawReview(r, location.host)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error("Couldn't make the image.")
  const file = new File([blob], `watchtrack-${r.year}-in-review.png`, { type: 'image/png' })
  if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `My ${r.year} in WatchTrack` })
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
