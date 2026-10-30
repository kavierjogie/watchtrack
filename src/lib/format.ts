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

/** formatRelease without the time, and without the year unless it's another year. */
export function formatShortRelease(iso: string, now = Date.now()): string {
  const dateOnly = isDateOnly(iso)
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  const year = localDay(iso).slice(0, 4) === localDay(new Date(now).toISOString()).slice(0, 4) ? undefined : 'numeric'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year, timeZone: dateOnly ? 'UTC' : undefined })
}

/** Local time of a release, or null when the provider only gave a day. */
export const formatReleaseTime = (iso: string) => (isDateOnly(iso) ? null : new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))

export const isDateOnly = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso)

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The calendar day (YYYY-MM-DD) a release falls on for this viewer. Date-only values are that day everywhere, never shifted. */
export const localDay = (iso: string) => (isDateOnly(iso) ? iso : dayKey(new Date(iso)))

/** The viewer's calendar day `offset` days from now. Built from local parts, so daylight saving can't skip a day. */
export function dayFrom(now: number, offset = 0): string {
  const n = new Date(now)
  return dayKey(new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset))
}

/** "in 3 hours" later today, otherwise whole calendar days ("tomorrow", "in 2 days"). */
export const countdown = (iso: string, now = Date.now()) => timeAgo(!isDateOnly(iso) && localDay(iso) === dayFrom(now) ? iso : localDay(iso), now)

export const RELEASE_BUCKETS = ['Today', 'Tomorrow', 'This Week', 'Next Week', 'Later'] as const
export type ReleaseBucket = (typeof RELEASE_BUCKETS)[number]

// ponytail: weeks always start on Monday, use Intl.Locale weekInfo if a Sunday week is ever needed
const daysToSunday = (now: number) => 6 - ((new Date(now).getDay() + 6) % 7)

/** Which part of the calendar a future release falls in, by the viewer's own calendar days. */
export function releaseBucket(iso: string, now = Date.now()): ReleaseBucket {
  const day = localDay(iso)
  if (day <= dayFrom(now)) return 'Today'
  if (day === dayFrom(now, 1)) return 'Tomorrow'
  const sunday = daysToSunday(now)
  if (day <= dayFrom(now, sunday)) return 'This Week'
  return day <= dayFrom(now, sunday + 7) ? 'Next Week' : 'Later'
}

const SHORT_DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const utcDay = (day: string) => new Date(`${day}T00:00:00Z`)

/** The dates a bucket covers, for its heading: "Fri, 30 Oct" or "Mon, 2 – Sun, 8 Nov". */
export function bucketDates(bucket: ReleaseBucket, now = Date.now()): string {
  const sunday = daysToSunday(now)
  const range = (from: number, to: number) => (from >= to ? SHORT_DAY.format(utcDay(dayFrom(now, to))) : SHORT_DAY.formatRange(utcDay(dayFrom(now, from)), utcDay(dayFrom(now, to))))
  if (bucket === 'Today') return range(0, 0)
  if (bucket === 'Tomorrow') return range(1, 1)
  if (bucket === 'This Week') return range(2, sunday)
  if (bucket === 'Next Week') return range(Math.max(2, sunday + 1), sunday + 7)
  return `From ${range(sunday + 8, sunday + 8)}`
}

export const daysSince =(iso: string | null, now = Date.now()) => (iso ? Math.floor((now - new Date(iso).getTime()) / 86400000) : Infinity)

/** A date-only release has no known time, so it isn't past until the viewer's whole day is over. */
export const isPast = (iso: string, now = Date.now()) => (isDateOnly(iso) ? iso < dayFrom(now) : Date.parse(iso) < now)

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

/** Copy via the Clipboard API, falling back to selecting the field (insecure contexts, older browsers). */
export async function copyText(text: string, field: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (!field) return false
    field.select()
    return document.execCommand('copy')
  }
}
