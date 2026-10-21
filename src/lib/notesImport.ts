import { titleKey } from './backup'
import { emptyProgress, setLastWatched } from './progress'
import { createTitle } from './titles'
import type { MediaType, Numbering, SkipRange, Title, WatchStatus } from './types'

export interface ImportFlag {
  level: 'review' | 'info'
  text: string
}

export interface ParsedRow {
  key: string
  include: boolean
  original: string
  title: string
  mediaType: MediaType
  status: WatchStatus
  numbering: Numbering
  season: number | null
  /** Last episode watched (mode 1); null = unknown */
  lastEpisode: number | null
  skipped: SkipRange[]
  /** Extra text from the note that isn't progress (e.g. "possibly first watched around 1 August 2021") */
  extra: string
  flags: ImportFlag[]
}

interface Section {
  mediaType: MediaType
  status: WatchStatus
  assumedStatus: boolean
}

function sectionFrom(header: string, prev: Section): Section {
  const h = header.toLowerCase()
  const mediaType: MediaType = h.includes('anime') ? 'anime' : h.includes('movie') ? 'movie' : h.includes('tv') || h.includes('series') || h.includes('show') ? 'tv' : prev.mediaType
  if (h.includes('watching') || h.includes('unfinished')) return { mediaType, status: 'watching', assumedStatus: false }
  if (h.includes('completed') || h.includes('finished')) return { mediaType, status: 'completed', assumedStatus: false }
  if (h.includes('plan')) return { mediaType, status: 'plan', assumedStatus: false }
  if (h.includes('hold') || h.includes('paused')) return { mediaType, status: 'on_hold', assumedStatus: false }
  return { mediaType, status: 'watching', assumedStatus: true }
}

const RANGE = String.raw`(\d+)\s*(?:[-–—]|to)\s*(\d+)`

export function parseLine(line: string, section: Section, index: number): ParsedRow | null {
  const text = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()
  if (!text) return null

  const pipe = text.indexOf('|')
  let name = (pipe >= 0 ? text.slice(0, pipe) : text).trim()
  const rest = pipe >= 0 ? text.slice(pipe + 1).trim() : ''

  const row: ParsedRow = {
    key: `row-${index}`,
    include: true,
    original: line.trim().replace(/^[-*•]\s*/, ''),
    title: name,
    mediaType: section.mediaType,
    status: section.status,
    numbering: section.mediaType === 'anime' ? 'absolute' : 'seasonal',
    season: null,
    lastEpisode: null,
    skipped: [],
    extra: '',
    flags: [],
  }

  if (/\(movie\)/i.test(name)) {
    name = name.replace(/\s*\(movie\)\s*/i, '').trim()
    row.title = name
    row.mediaType = 'movie'
    row.numbering = 'absolute'
    row.flags.push({ level: 'info', text: 'Marked as a movie in your notes.' })
  }
  if (section.assumedStatus) row.flags.push({ level: 'info', text: 'Status not stated in your notes — assumed Watching.' })

  if (row.mediaType === 'movie') {
    if (rest) row.extra = rest
    return row
  }

  let m: RegExpMatchArray | null
  if (!rest) {
    if (row.status !== 'completed') row.flags.push({ level: 'review', text: 'No progress recorded — set season and episode.' })
  } else if ((m = rest.match(/^S(\d+)\s*\/?\s*E(\d+)$/i))) {
    row.numbering = 'seasonal'
    row.season = Number(m[1])
    row.lastEpisode = Number(m[2])
    row.flags.push({ level: 'info', text: `Read as last watched: Season ${m[1]}, Episode ${m[2]}.` })
    if (row.lastEpisode > 30)
      row.flags.push({ level: 'review', text: `Episode ${m[2]} is high for one season — it may be an overall episode number.` })
  } else if ((m = rest.match(/^S(\d+)$/i))) {
    row.numbering = 'seasonal'
    row.season = Number(m[1])
    if (row.status === 'completed') row.flags.push({ level: 'info', text: `Recorded as completed through Season ${m[1]}.` })
    else row.flags.push({ level: 'review', text: `Only the season is recorded (S${m[1]}) — set the episode, or leave it as "not set".` })
  } else if ((m = rest.match(/^(\d+)$/))) {
    row.numbering = 'absolute'
    row.lastEpisode = Number(m[1])
    row.flags.push({ level: 'review', text: `"${m[1]}" read as the last episode watched (next: ${Number(m[1]) + 1}). Check it isn't the next episode.` })
  } else if ((m = rest.match(/^S(\d+)\s*[,;]\s*(.+)$/i))) {
    row.numbering = 'seasonal'
    row.season = Number(m[1])
    row.extra = m[2].trim()
    row.flags.push({ level: 'review', text: 'Extra details kept in notes — check the date or season.' })
  } else {
    const watched = rest.match(new RegExp(`watched\\s+(?:episodes?\\s+)?${RANGE}`, 'i'))
    const skipped = rest.match(new RegExp(`skipped\\s+(?:episodes?\\s+)?${RANGE}`, 'i'))
    if (watched) {
      row.numbering = 'absolute'
      row.lastEpisode = Number(watched[2])
      if (skipped) row.skipped = [{ season: null, from: Number(skipped[1]), to: Number(skipped[2]) }]
      row.flags.push({
        level: 'review',
        text: `Read as last watched ${watched[2]}${skipped ? `, skipped ${skipped[1]}–${skipped[2]}` : ''}. No season recorded — set one if needed.`,
      })
    } else {
      row.extra = rest
      row.flags.push({ level: 'review', text: 'Could not read the progress — kept it in notes.' })
    }
  }
  return row
}

export function parseNotes(text: string): ParsedRow[] {
  let section: Section = { mediaType: 'anime', status: 'watching', assumedStatus: true }
  const rows: ParsedRow[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (/^#{1,6}\s/.test(trimmed) || /:\s*$/.test(trimmed)) {
      section = sectionFrom(trimmed.replace(/^#+\s*/, ''), section)
      return
    }
    const row = parseLine(trimmed, section, i)
    if (row) rows.push(row)
  })
  return rows
}

export function rowToTitle(row: ParsedRow): Title {
  // The original line is kept verbatim in importNote (shown on the title page); notes get any extra details.
  const notes = row.extra
  if (row.mediaType === 'movie') {
    return createTitle({ title: row.title, mediaType: 'movie', status: row.status, notes, importNote: row.original })
  }
  let progress = { ...emptyProgress(row.numbering), season: row.numbering === 'seasonal' ? row.season : null, nextEpisode: null as number | null, skipped: row.skipped }
  if (row.lastEpisode != null) progress = setLastWatched(progress, row.season, row.lastEpisode)
  else if (row.status === 'plan') progress = { ...progress, season: row.numbering === 'seasonal' ? 1 : null, nextEpisode: 1 }
  if (row.status === 'completed' && row.season != null) progress.totalSeasons = row.season
  return createTitle({ title: row.title, mediaType: row.mediaType, status: row.status, progress, notes, importNote: row.original })
}

/** Mark rows that already exist in the library (or repeat earlier rows). */
export function findDuplicates(rows: ParsedRow[], existing: Title[]): Set<string> {
  const seen = new Set(existing.map(titleKey))
  const dups = new Set<string>()
  for (const r of rows) {
    const k = titleKey(r)
    if (seen.has(k)) dups.add(r.key)
    seen.add(k)
  }
  return dups
}
