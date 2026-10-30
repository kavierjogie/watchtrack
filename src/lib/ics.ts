import { releaseLabel } from './alerts'
import { isDateOnly } from './format'
import type { Title } from './types'
import { upcomingEpisodes } from './upcoming'

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

const encoder = new TextEncoder()

/** Lines may be at most 75 bytes; longer ones continue on the next line after a space. Never splits a character. */
function fold(line: string): string {
  const parts: string[] = []
  let part = ''
  let bytes = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(part)
      part = ''
      bytes = 0
    }
    part += ch
    bytes += size
  }
  return [...parts, part].join('\r\n ')
}

const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/**
 * Calendar file of the episodes on the Upcoming page, or null when there are none. UIDs are stable, so exporting again
 * can update events rather than duplicate them.
 */
export function buildIcs(titles: Title[], now = Date.now()): string | null {
  const events = upcomingEpisodes(titles, now).map((r) => {
    const label = releaseLabel(r, r.t.progress?.numbering === 'seasonal')
    const dateOnly = isDateOnly(r.airdate)
    return [
      'BEGIN:VEVENT',
      `UID:${escapeText(`${r.t.id}-${r.kind}-${r.season ?? ''}-${r.episode ?? ''}`)}@watchtrack`,
      `DTSTAMP:${utcStamp(now)}`,
      dateOnly ? `DTSTART;VALUE=DATE:${r.airdate.replace(/-/g, '')}` : `DTSTART:${utcStamp(Date.parse(r.airdate))}`,
      `SUMMARY:${escapeText(`${r.t.title} · ${label}`)}`,
      ...(r.name && r.name !== label ? [`DESCRIPTION:${escapeText(r.name)}`] : []),
      'TRANSP:TRANSPARENT', // never shows as busy
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`${r.t.title} · ${label}`)}`,
      dateOnly ? 'TRIGGER:PT9H' : 'TRIGGER:-PT1H', // 9am on the day, or an hour before a known time
      'END:VALARM',
      'END:VEVENT',
    ]
  })
  if (!events.length) return null
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WatchTrack//Upcoming releases//EN', 'CALSCALE:GREGORIAN', ...events.flat(), 'END:VCALENDAR']
  return lines.map(fold).join('\r\n') + '\r\n'
}
