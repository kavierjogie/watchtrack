import { describe, expect, it } from 'vitest'
import { findDuplicates, parseNotes, rowToTitle } from './notesImport'
import { describePosition, position } from './progress'
import { STARTER_NOTES } from './starterNotes'
import { createTitle } from './titles'

const rows = parseNotes(STARTER_NOTES)
const row = (name: string) => rows.find((r) => r.title === name)!

describe('notes import', () => {
  it('keeps every title from the original list', () => {
    const count = STARTER_NOTES.split('\n').filter((l) => l.trim().startsWith('- ')).length
    expect(rows).toHaveLength(count)
    expect(count).toBe(64)
  })

  it('reads sections as type + status', () => {
    expect(row('Black Clover')).toMatchObject({ mediaType: 'anime', status: 'watching' })
    expect(row('Horimiya')).toMatchObject({ mediaType: 'anime', status: 'completed' })
    expect(row('Riverdale')).toMatchObject({ mediaType: 'tv', status: 'watching' })
    expect(row('I Want to Eat Your Pancreas')).toMatchObject({ mediaType: 'movie' })
  })

  it('bare numbers become last watched with a review flag', () => {
    const t = rowToTitle(row('Black Clover'))
    expect(describePosition(t.progress!)).toBe('Episode 173 next')
    expect(row('Black Clover').flags.some((f) => f.level === 'review')).toBe(true)
    expect(describePosition(rowToTitle(row('Wonder Egg Priority')).progress!)).toBe('Episode 7 next')
  })

  it('S/E notation is last watched in that season', () => {
    expect(describePosition(rowToTitle(row('Helluva Boss')).progress!)).toBe('Season 2, Episode 9 next')
    expect(describePosition(rowToTitle(row('Supergirl')).progress!)).toBe('Season 6, Episode 4 next')
  })

  it('flags high episode numbers inside a season', () => {
    expect(row('Spy x Family').flags.some((f) => /overall episode/.test(f.text))).toBe(true)
  })

  it('season-only entries keep the season with an unknown episode', () => {
    const t = rowToTitle(row('Demon Slayer'))
    expect(t.progress).toMatchObject({ season: 4, nextEpisode: null })
    expect(position(t.progress!).state).toBe('unknown')
  })

  it('parses watched and skipped ranges (Family Guy)', () => {
    const r = row('Family Guy')
    expect(r.lastEpisode).toBe(20)
    expect(r.skipped).toEqual([{ season: null, from: 2, to: 9 }])
    expect(rowToTitle(r).progress?.nextEpisode).toBe(21)
  })

  it('preserves the original line and extra details in notes', () => {
    const t = rowToTitle(row('Toradora!'))
    expect(t.importNote).toContain('1 August 2021')
    expect(t.notes).toContain('possibly first watched around 1 August 2021')
    expect(t.status).toBe('completed')
  })

  it('flags entries with no progress', () => {
    expect(row('Kakegurui').flags.some((f) => f.level === 'review')).toBe(true)
  })

  it('detects titles already in the library', () => {
    const dups = findDuplicates(rows, [createTitle({ title: 'black clover', mediaType: 'anime' })])
    expect(dups.has(row('Black Clover').key)).toBe(true)
    expect(dups.size).toBe(1)
  })

  it('uses the chosen default type for lines before any heading', () => {
    const [a, b] = parseNotes('*Supergirl. | S6 e3\n### Anime\nNaruto | 12', 'tv')
    expect(a).toMatchObject({ title: 'Supergirl.', mediaType: 'tv', numbering: 'seasonal', season: 6, lastEpisode: 3 })
    expect(b.mediaType).toBe('anime')
  })
})
