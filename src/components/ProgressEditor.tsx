import { useState } from 'react'
import { usePrefs } from '../lib/prefs'
import {
  describePosition,
  formatSkipRanges,
  lastWatched,
  parseSkipRanges,
  setLastWatched,
  setNextEpisode,
} from '../lib/progress'
import { applyProgress } from '../lib/titles'
import type { Numbering, Progress, Title } from '../lib/types'
import { useWatchActions } from '../state/useWatchActions'
import { Modal } from './Modal'

const toNum = (s: string): number | null => {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isInteger(n) && n >= 0 ? n : NaN
}

/** Build a Progress from form values. Shared by the editor and the add-title form. */
export function buildProgress(
  base: Progress,
  v: { mode: 'last' | 'next'; numbering: Numbering; season: string; episode: string; seasonCount: string; totalSeasons: string; totalEpisodes: string; skipped: string; rewatching: boolean },
): { progress: Progress } | { error: string } {
  const season = v.numbering === 'seasonal' ? toNum(v.season) : null
  const episode = toNum(v.episode)
  const seasonCount = toNum(v.seasonCount)
  const totalSeasons = toNum(v.totalSeasons)
  const totalEpisodes = toNum(v.totalEpisodes)
  for (const [n, label] of [
    [season, 'Season'],
    [episode, 'Episode'],
    [seasonCount, 'Episodes this season'],
    [totalSeasons, 'Total seasons'],
    [totalEpisodes, 'Total episodes'],
  ] as const) {
    if (Number.isNaN(n)) return { error: `${label} must be a whole number.` }
  }
  if (v.numbering === 'seasonal' && season === 0) return { error: 'Season starts at 1.' }
  if (v.mode === 'next' && episode === 0) return { error: 'Next episode starts at 1.' }
  if (totalSeasons != null && season != null && totalSeasons < season) return { error: 'Total seasons is lower than the current season.' }

  const counts = { ...base.seasonEpisodeCounts }
  if (season != null) {
    if (seasonCount) counts[season] = seasonCount
    else delete counts[season]
  }
  const skippedOther = base.skipped.filter((r) => r.season !== season)
  let p: Progress = {
    ...base,
    numbering: v.numbering,
    season,
    seasonEpisodeCounts: v.numbering === 'seasonal' ? counts : base.seasonEpisodeCounts,
    totalSeasons: v.numbering === 'seasonal' ? totalSeasons : base.totalSeasons,
    totalEpisodes: v.numbering === 'absolute' ? totalEpisodes || null : base.totalEpisodes,
    skipped: [...skippedOther, ...parseSkipRanges(v.skipped, season)],
    rewatching: v.rewatching,
  }
  if (episode == null) p = { ...p, nextEpisode: null }
  else p = v.mode === 'last' ? setLastWatched(p, season, episode) : setNextEpisode(p, season, episode)
  return { progress: p }
}

export function ProgressFields({
  value,
  onChange,
}: {
  value: ProgressForm
  onChange: (v: ProgressForm) => void
}) {
  const set = <K extends keyof ProgressForm>(k: K, val: ProgressForm[K]) => onChange({ ...value, [k]: val })
  const seasonal = value.numbering === 'seasonal'

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset>
          <legend className="label">Numbering</legend>
          <div className="flex gap-2">
            {(['seasonal', 'absolute'] as const).map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={value.numbering === n} onClick={() => set('numbering', n)}>
                {n === 'seasonal' ? 'Season + episode' : 'Overall episode #'}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">I'm entering the…</legend>
          <div className="flex gap-2">
            <button type="button" className="chip" aria-pressed={value.mode === 'last'} onClick={() => set('mode', 'last')}>
              Last watched
            </button>
            <button type="button" className="chip" aria-pressed={value.mode === 'next'} onClick={() => set('mode', 'next')}>
              Next to watch
            </button>
          </div>
        </fieldset>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {seasonal && (
          <label>
            <span className="label">Season</span>
            <input className="input" inputMode="numeric" value={value.season} onChange={(e) => set('season', e.target.value)} placeholder="1" />
          </label>
        )}
        <label className={seasonal ? '' : 'col-span-2'}>
          <span className="label">{value.mode === 'last' ? 'Last episode watched' : 'Next episode to watch'}</span>
          <input
            className="input"
            inputMode="numeric"
            value={value.episode}
            onChange={(e) => set('episode', e.target.value)}
            placeholder={value.mode === 'last' ? '0 = not started' : '1'}
          />
        </label>
        {seasonal ? (
          <>
            <label>
              <span className="label">Episodes this season</span>
              <input className="input" inputMode="numeric" value={value.seasonCount} onChange={(e) => set('seasonCount', e.target.value)} placeholder="Unknown" />
            </label>
            <label>
              <span className="label">Total seasons</span>
              <input className="input" inputMode="numeric" value={value.totalSeasons} onChange={(e) => set('totalSeasons', e.target.value)} placeholder="Unknown" />
            </label>
          </>
        ) : (
          <label className="col-span-2">
            <span className="label">Total episodes</span>
            <input className="input" inputMode="numeric" value={value.totalEpisodes} onChange={(e) => set('totalEpisodes', e.target.value)} placeholder="Unknown / ongoing" />
          </label>
        )}
      </div>

      <label className="block">
        <span className="label">Skipped episodes{seasonal && value.season ? ` (season ${value.season})` : ''}</span>
        <input className="input" value={value.skipped} onChange={(e) => set('skipped', e.target.value)} placeholder="e.g. 2–9, 14" />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={value.rewatching} onChange={(e) => set('rewatching', e.target.checked)} />
        Rewatching
      </label>
      <p className="text-xs text-muted">Leave the episode empty if you don't know it yet — the title will show "episode not set" until you fill it in.</p>
    </div>
  )
}

export type ProgressForm = Parameters<typeof buildProgress>[1]

export function progressToForm(p: Progress, mode: 'last' | 'next'): ProgressForm {
  const last = lastWatched(p)
  const episode =
    p.nextEpisode == null
      ? ''
      : mode === 'next'
        ? String(p.nextEpisode)
        : last && last.season === p.season
          ? String(last.episode)
          : '0'
  return {
    mode,
    numbering: p.numbering,
    season: p.season != null ? String(p.season) : '',
    episode,
    seasonCount: p.season != null && p.seasonEpisodeCounts[p.season] ? String(p.seasonEpisodeCounts[p.season]) : '',
    totalSeasons: p.totalSeasons != null ? String(p.totalSeasons) : '',
    totalEpisodes: p.totalEpisodes != null ? String(p.totalEpisodes) : '',
    skipped: formatSkipRanges(p.skipped, p.season),
    rewatching: p.rewatching,
  }
}

export function ProgressEditor({ title, open, onClose }: { title: Title; open: boolean; onClose: () => void }) {
  const prefs = usePrefs()
  const { commit } = useWatchActions()
  const [form, setForm] = useState<ProgressForm>(() => progressToForm(title.progress!, prefs.progressMode))
  const [error, setError] = useState<string | null>(null)
  const result = buildProgress(title.progress!, form)
  const preview = 'progress' in result ? describePosition(result.progress) : null

  const save = async () => {
    if ('error' in result) return setError(result.error)
    const ok = await commit(applyProgress(title, result.progress, `Progress set: ${preview}`), 'Progress updated', `${title.title} · ${preview}`)
    if (ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Progress · ${title.title}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => void save()}>
            Save progress
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <ProgressFields
          value={form}
          onChange={(v) => {
            // Keep the episode meaning consistent when flipping last/next.
            if (v.mode !== form.mode && 'progress' in result) setForm(progressToForm(result.progress, v.mode))
            else setForm(v)
            setError(null)
          }}
        />
        <div className="mt-4 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent-text" aria-live="polite">
          {preview ?? ('error' in result ? result.error : '')}
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
