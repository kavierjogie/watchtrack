const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const s = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(s)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  if (abs < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month')
  return rtf.format(Math.round(s / (86400 * 365)), 'year')
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/** A provider release date. Date-only values are calendar days (no time zone shift); timestamps show local day + time. */
export function formatRelease(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export const daysSince = (iso: string | null, now = Date.now()) => (iso ? Math.floor((now - new Date(iso).getTime()) / 86400000) : Infinity)

export const isPast = (iso: string, now = Date.now()) => Date.parse(iso) < now

export const today = () => new Date().toISOString().slice(0, 10)

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** Where "Send feedback" links go (Settings, crash screen). Public: it's in the page source. */
export const FEEDBACK_MAILTO = 'mailto:kavier.jogie14@gmail.com?subject=WatchTrack%20feedback'
