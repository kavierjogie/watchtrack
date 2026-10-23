import { ImagePlus, Loader2, RotateCw, Search, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { titleKey } from '../lib/backup'
import { deleteImage, putImage, validateImage } from '../lib/db'
import { today } from '../lib/format'
import { downloadPoster, enrich, PROVIDER_LABEL, searchAll, type MetaResult, type SearchState } from '../lib/metadata'
import { getPrefs } from '../lib/prefs'
import { describePosition, emptyProgress } from '../lib/progress'
import { createTitle } from '../lib/titles'
import { MEDIA_LABEL, STATUS_LABEL, type MediaType, type Poster as PosterRef, type Title, type WatchStatus } from '../lib/types'
import { useLibrary } from '../state/library'
import { Modal } from './Modal'
import { Poster } from './Poster'
import { buildProgress, ProgressFields, progressToForm, type ProgressForm } from './ProgressEditor'

const STATUSES: WatchStatus[] = ['watching', 'plan', 'on_hold', 'completed', 'dropped']
const list = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))]

interface FormState {
  title: string
  altTitle: string
  mediaType: MediaType
  status: WatchStatus
  synopsis: string
  year: string
  genres: string
  tags: string
  rating: string
  notes: string
  watchedDate: string
}

function fromTitle(t: Title | null, defaults: Partial<FormState>): FormState {
  return {
    title: t?.title ?? '',
    altTitle: t?.altTitles.join(', ') ?? '',
    mediaType: t?.mediaType ?? 'anime',
    status: t?.status ?? 'watching',
    synopsis: t?.synopsis ?? '',
    year: t?.year ? String(t.year) : '',
    genres: t?.genres.join(', ') ?? '',
    tags: t?.tags.join(', ') ?? '',
    rating: t?.rating != null ? String(t.rating) : '',
    notes: t?.notes ?? '',
    watchedDate: t?.watchedDate ?? '',
    ...defaults,
  }
}

/** Poster choice before saving: existing, an uploaded file, a remote URL from a search, or none. */
type PosterDraft = { kind: 'keep' } | { kind: 'file'; file: File; preview: string } | { kind: 'remote'; url: string } | { kind: 'none' }

export function TitleForm({
  open,
  onClose,
  existing,
  defaultStatus,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  existing?: Title
  defaultStatus?: WatchStatus
  onSaved?: (t: Title) => void
}) {
  const lib = useLibrary()
  const editing = !!existing
  const [form, setForm] = useState<FormState>(() => fromTitle(existing ?? null, defaultStatus ? { status: defaultStatus } : {}))
  const [progress, setProgress] = useState<ProgressForm>(() =>
    progressToForm(existing?.progress ?? emptyProgress('absolute'), getPrefs().progressMode),
  )
  const [meta, setMeta] = useState<MetaResult | null>(null)
  const [poster, setPoster] = useState<PosterDraft>({ kind: 'keep' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setError(null)
  }

  useEffect(() => () => {
    if (poster.kind === 'file') URL.revokeObjectURL(poster.preview)
  }, [poster])

  const duplicate =
    !editing && form.title.trim()
      ? lib.titles.find(
          (t) =>
            titleKey(t) === titleKey({ title: form.title, mediaType: form.mediaType }) ||
            (meta && t.source?.provider === meta.source.provider && t.source.id === meta.source.id),
        )
      : undefined

  const applyMeta = (r: MetaResult) => {
    setMeta(r)
    setForm((f) => ({
      ...f,
      title: r.title,
      altTitle: r.altTitles.join(', '),
      mediaType: r.mediaType,
      synopsis: r.synopsis,
      year: r.year ? String(r.year) : '',
      genres: r.genres.join(', '),
    }))
    if (r.posterUrl) setPoster({ kind: 'remote', url: r.posterUrl })
    const numbering = r.mediaType === 'anime' ? 'absolute' : 'seasonal'
    setProgress((p) => ({
      ...p,
      numbering,
      season: numbering === 'seasonal' ? p.season || '1' : '',
      totalEpisodes: r.totalEpisodes && !r.ongoing ? String(r.totalEpisodes) : '',
      totalSeasons: r.totalSeasons ? String(r.totalSeasons) : '',
      seasonCount: r.seasonEpisodeCounts[Number(p.season || 1)] ? String(r.seasonEpisodeCounts[Number(p.season || 1)]) : '',
    }))
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    const err = validateImage(file)
    if (err) return toast.error(err)
    setPoster({ kind: 'file', file, preview: URL.createObjectURL(file) })
  }

  const previewPoster: PosterRef | null =
    poster.kind === 'file'
      ? { kind: 'remote', url: poster.preview }
      : poster.kind === 'remote'
        ? { kind: 'remote', url: poster.url }
        : poster.kind === 'none'
          ? null
          : (existing?.poster ?? null)

  async function resolvePoster(): Promise<PosterRef | null> {
    if (poster.kind === 'keep') return existing?.poster ?? null
    if (poster.kind === 'none') return null
    if (poster.kind === 'file') return { kind: 'local', imageId: await putImage(poster.file) }
    // Remote artwork: keep a local copy for offline use when the host allows it.
    const blob = await downloadPoster(poster.url)
    if (blob && !validateImage(blob)) return { kind: 'local', imageId: await putImage(blob) }
    return { kind: 'remote', url: poster.url }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Give the title a name.')
    const year = form.year.trim() ? Number(form.year) : null
    if (year != null && (!Number.isInteger(year) || year < 1870 || year > 2100)) return setError('Year looks wrong.')
    const rating = form.rating ? Number(form.rating) : null

    let progressValue = existing?.progress ?? null
    if (!editing && form.mediaType !== 'movie') {
      const built = buildProgress(emptyProgress(progress.numbering), progress)
      if ('error' in built) return setError(built.error)
      progressValue = built.progress
      if (meta) progressValue = { ...progressValue, seasonEpisodeCounts: { ...meta.seasonEpisodeCounts, ...progressValue.seasonEpisodeCounts } }
      if (form.status === 'plan' && progressValue.nextEpisode == null) progressValue = { ...progressValue, nextEpisode: 1, season: progressValue.numbering === 'seasonal' ? progressValue.season ?? 1 : null }
    }
    if (editing && existing.mediaType !== form.mediaType) {
      // Changing type: movies have no episode progress, series need one.
      progressValue = form.mediaType === 'movie' ? null : (existing.progress ?? emptyProgress(form.mediaType === 'anime' ? 'absolute' : 'seasonal'))
    }

    setSaving(true)
    try {
      const posterRef = await resolvePoster()
      const now = new Date().toISOString()
      const fields = {
        title: form.title.trim(),
        altTitles: list(form.altTitle),
        mediaType: form.mediaType,
        status: form.status,
        synopsis: form.synopsis.trim(),
        year,
        genres: list(form.genres),
        tags: list(form.tags),
        rating,
        notes: form.notes,
        poster: posterRef,
        progress: progressValue,
        watchedDate: form.mediaType === 'movie' ? form.watchedDate || (form.status === 'completed' && !existing?.watchedDate ? today() : null) : null,
      }
      let saved: Title
      if (existing) {
        saved = {
          ...existing,
          ...fields,
          completedAt: form.status === 'completed' ? (existing.completedAt ?? now) : null,
          updatedAt: now,
        }
        await lib.save(saved)
        // Drop the old uploaded poster if it was replaced.
        if (existing.poster?.kind === 'local' && posterRef?.kind !== 'local') await deleteImage(existing.poster.imageId)
        if (existing.poster?.kind === 'local' && posterRef?.kind === 'local' && posterRef.imageId !== existing.poster.imageId)
          await deleteImage(existing.poster.imageId)
        toast.success('Saved', { description: saved.title })
      } else {
        saved = createTitle({ ...fields, backdropUrl: meta?.backdropUrl ?? null, source: meta?.source ?? null }, now)
        await lib.save(saved)
        toast.success(`Added ${saved.title}`, { description: saved.progress ? describePosition(saved.progress) : STATUS_LABEL[saved.status] })
      }
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${existing.title}` : 'Add title'}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="title-form" className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {editing ? 'Save changes' : duplicate ? 'Add anyway' : 'Add title'}
          </button>
        </>
      }
    >
      {!editing && <MetadataSearch onPick={applyMeta} picked={meta} />}

      <form id="title-form" onSubmit={(e) => void submit(e)} className="space-y-5">
        <div className="flex gap-4">
          <div className="w-28 shrink-0 space-y-2 sm:w-36">
            <Poster poster={previewPoster} title={form.title || 'Poster'} mediaType={form.mediaType} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button type="button" className="btn-secondary w-full min-h-9 px-2 text-xs" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="size-4" aria-hidden /> Upload
            </button>
            {previewPoster && (
              <button type="button" className="btn-ghost w-full min-h-8 px-2 text-xs" onClick={() => setPoster({ kind: 'none' })}>
                <Trash2 className="size-3.5" aria-hidden /> Remove
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <label className="block">
              <span className="label">Title *</span>
              <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} required autoComplete="off" />
            </label>
            {duplicate && (
              <p className="rounded-lg bg-warn/15 px-3 py-2 text-xs text-warn" role="status">
                "{duplicate.title}" is already in your library ({STATUS_LABEL[duplicate.status]}).
              </p>
            )}
            <label className="block">
              <span className="label">Alternative titles</span>
              <input className="input" value={form.altTitle} onChange={(e) => set('altTitle', e.target.value)} placeholder="Comma separated" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="label">Type</span>
                <select className="input" value={form.mediaType} onChange={(e) => {
                    const m = e.target.value as MediaType
                    set('mediaType', m)
                    // Default numbering follows the type: anime → overall episode #, TV → season + episode.
                    if (!editing) setProgress((p) => ({ ...p, numbering: m === 'anime' ? 'absolute' : 'seasonal', season: m === 'anime' ? '' : p.season || '1' }))
                  }}>
                  {(Object.keys(MEDIA_LABEL) as MediaType[]).map((m) => (
                    <option key={m} value={m}>
                      {MEDIA_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Status</span>
                <select className="input" value={form.status} onChange={(e) => set('status', e.target.value as WatchStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        {!editing && form.mediaType !== 'movie' && (
          <fieldset className="card space-y-3 p-4">
            <legend className="px-1 text-sm font-semibold">Progress</legend>
            <ProgressFields value={progress} onChange={setProgress} />
          </fieldset>
        )}
        {form.mediaType === 'movie' && (
          <label className="block">
            <span className="label">Watched on (optional)</span>
            <input type="date" className="input" value={form.watchedDate} max={today()} onChange={(e) => set('watchedDate', e.target.value)} />
          </label>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label>
            <span className="label">Release year</span>
            <input className="input" inputMode="numeric" value={form.year} onChange={(e) => set('year', e.target.value)} />
          </label>
          <label>
            <span className="label">Your rating</span>
            <select className="input" value={form.rating} onChange={(e) => set('rating', e.target.value)}>
              <option value="">Unrated</option>
              {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
                <option key={n} value={n}>
                  {n} / 10
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className="label">Genres</span>
            <input className="input" value={form.genres} onChange={(e) => set('genres', e.target.value)} placeholder="Action, Comedy" />
          </label>
        </div>
        <label className="block">
          <span className="label">Tags / lists</span>
          <input className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="e.g. weekend, rewatch-worthy" />
        </label>
        <label className="block">
          <span className="label">Synopsis</span>
          <textarea className="input min-h-20 py-2" value={form.synopsis} onChange={(e) => set('synopsis', e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Personal notes</span>
          <textarea className="input min-h-20 py-2" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

const MIN_QUERY = 2
const DEBOUNCE_MS = 350

function MetadataSearch({ onPick, picked }: { onPick: (r: MetaResult) => void; picked: MetaResult | null }) {
  const lib = useLibrary()
  const [q, setQ] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState<SearchState | null>(null)
  const [showResults, setShowResults] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const skipDebounce = useRef(false)
  const query = q.trim()
  const active = query.length >= MIN_QUERY

  useEffect(() => {
    if (query.length < MIN_QUERY) return
    // Each run owns its AbortController: a newer query (or closing the form) cancels it and silences its results.
    const ctrl = new AbortController()
    const timer = setTimeout(() => void searchAll(query, ctrl.signal, setSearch), skipDebounce.current ? 0 : DEBOUNCE_MS)
    skipDebounce.current = false
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query, attempt])

  const current = active && search?.query === query ? search : null
  const loading = active && (!current || current.pending > 0)
  // Until the new query answers, keep showing the previous results rather than flashing an empty list.
  const results = active ? ((current ?? search)?.results ?? []) : []
  const retry = () => {
    skipDebounce.current = true
    setSearch(null) // show "Searching…" instead of the previous error until the new answers arrive
    setAttempt((n) => n + 1)
  }

  const inLibrary = (r: MetaResult) =>
    lib.titles.some((t) => (t.source?.provider === r.source.provider && t.source.id === r.source.id) || titleKey(t) === titleKey(r))

  async function pick(r: MetaResult) {
    setBusy(r.source.id)
    onPick(await enrich(r))
    setShowResults(false)
    setBusy(null)
  }

  return (
    <div className="mb-5 space-y-3 rounded-2xl bg-surface-2 p-3">
      <p className="text-sm font-medium">
        Find artwork & details <span className="font-normal text-muted">(optional)</span>
      </p>
      {/* Not a <form>: it sits inside the dialog next to the main form. */}
      <div className="relative">
        {loading ? (
          <Loader2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />
        ) : (
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        )}
        <input
          className="input pl-9"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setShowResults(true)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (active) retry()
          }}
          placeholder="Search anime, series, or movies…"
          aria-label="Search anime, series, or movies"
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      {showResults && (
        <div role="status" aria-live="polite" className="text-xs text-muted empty:hidden">
          {current?.error ? (
            <span className="flex flex-wrap items-center gap-2 text-danger">
              {current.error}
              <button type="button" className="btn-ghost min-h-7 px-2 text-xs" onClick={retry}>
                <RotateCw className="size-3.5" aria-hidden /> Retry
              </button>
            </span>
          ) : current && !loading && results.length === 0 ? (
            `No matches for "${query}". Try another spelling, or fill in the details below.`
          ) : loading && results.length === 0 ? (
            'Searching…'
          ) : current && !loading && current.failed.length > 0 ? (
            <span className="flex flex-wrap items-center gap-2">
              {current.failed.map((p) => PROVIDER_LABEL[p]).join(' and ')} didn't respond, so some results may be missing.
              <button type="button" className="btn-ghost min-h-7 px-2 text-xs" onClick={retry}>
                <RotateCw className="size-3.5" aria-hidden /> Retry
              </button>
            </span>
          ) : null}
        </div>
      )}

      {showResults && results.length > 0 && (
        <ul className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto" aria-label="Search results">
          {results.map((r) => (
            <li key={`${r.source.provider}-${r.source.id}`}>
              <button
                type="button"
                onClick={() => void pick(r)}
                disabled={!!busy}
                className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface"
              >
                <Poster poster={r.thumbUrl ? { kind: 'remote', url: r.thumbUrl } : null} title={r.title} mediaType={r.mediaType} className="w-10 shrink-0 rounded-md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                    <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-fg">{MEDIA_LABEL[r.mediaType]}</span>
                    <span className="truncate">{[r.year, r.totalEpisodes ? `${r.totalEpisodes} eps` : null, r.altTitles[0]].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted">
                  {busy === r.source.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : inLibrary(r) && <span className="text-accent-text">In library</span>}
                  <span>{PROVIDER_LABEL[r.source.provider]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked && !showResults && (
        <p className="text-xs text-muted">
          Filled from{' '}
          <a href={picked.source.url} target="_blank" rel="noreferrer" className="text-accent-text underline">
            {PROVIDER_LABEL[picked.source.provider]}
          </a>
          . Review the details below before saving.
        </p>
      )}
    </div>
  )
}
