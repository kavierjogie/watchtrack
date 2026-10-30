const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  // Date-only values are calendar days in the viewer's own time zone, so they never show minutes or hours.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const then = new Date(dateOnly ? `${iso}T00:00:00` : iso)
  if (!dateOnly) {
    const s = Math.round((then.getTime() - now) / 1000)
    const abs = Math.abs(s)
    if (abs < 60) return 'just now'
    if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
    if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  }
  // Whole calendar days between the two dates, so "tomorrow" always means the next date. Rounding absorbs daylight saving.
  const days = Math.round((startOfDay(then) - startOfDay(new Date(now))) / 86400000)
  const abs = Math.abs(days)
  if (abs < 30) return rtf.format(days, 'day')
  if (abs < 365) return rtf.format(Math.round(days / 30), 'month')
  return rtf.format(Math.round(days / 365), 'year')
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/** A provider release date. Date-only values are calendar days (no time zone shift); timestamps show local day + time. */
export function formatRelease(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** formatRelease without the year or time, for poster-width cards. */
export function formatShortRelease(iso: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: dateOnly ? 'UTC' : undefined })
}

export const RELEASE_BUCKETS = ['This week', 'Next week', 'Later this month', 'Later'] as const
export type ReleaseBucket = (typeof RELEASE_BUCKETS)[number]

/** Which part of the calendar a future release falls in. Date-only values are calendar days in the viewer's own time zone. */
export function releaseBucket(iso: string, now = Date.now()): ReleaseBucket {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
  const n = new Date(now)
  // ponytail: weeks always start on Monday, use Intl.Locale weekInfo if a Sunday week is ever needed
  const monday = n.getDate() - ((n.getDay() + 6) % 7)
  if (d < new Date(n.getFullYear(), n.getMonth(), monday + 7)) return 'This week'
  if (d < new Date(n.getFullYear(), n.getMonth(), monday + 14)) return 'Next week'
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() ? 'Later this month' : 'Later'
}

export const daysSince =(iso: string | null, now = Date.now()) => (iso ? Math.floor((now - new Date(iso).getTime()) / 86400000) : Infinity)

export const isPast = (iso: string, now = Date.now()) => Date.parse(iso) < now

export const today = () => new Date().toISOString().slice(0, 10)

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** Browsers built into other apps (Instagram, Facebook, Android WebViews). They keep their own storage and Google blocks sign-in there. */
export const isInAppBrowser = (userAgent: string) => /Instagram|FBAN|FBAV|FB_IAB|; wv\)/.test(userAgent)

/** Where "Send feedback" links go (Settings, crash screen). Public: it's in the page source. */
export const FEEDBACK_MAILTO = 'mailto:kavier.jogie14@gmail.com?subject=WatchTrack%20feedback'
