import { AlertTriangle, CheckCircle2, FileText, Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '../components/cards'
import { useConfirm } from '../components/Modal'
import { bulkWrite } from '../lib/db'
import { findDuplicates, parseNotes, rowToTitle, type ParsedRow } from '../lib/notesImport'
import { describePosition, formatSkipRanges, parseSkipRanges } from '../lib/progress'
import { STARTER_NOTES } from '../lib/starterNotes'
import { MEDIA_LABEL, STATUS_LABEL, type MediaType, type Numbering, type WatchStatus } from '../lib/types'
import { useLibrary } from '../state/library'

const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Math.max(0, Math.floor(Number(s))))

export function ImportNotesPage() {
  const lib = useLibrary()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [text, setText] = useState('')
  const [defaultType, setDefaultType] = useState<MediaType>('anime')
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [saving, setSaving] = useState(false)

  const dups = useMemo(() => (rows ? findDuplicates(rows, lib.titles) : new Set<string>()), [rows, lib.titles])

  const parse = () => {
    const parsed = parseNotes(text, defaultType)
    if (!parsed.length) return toast.error('No titles found', { description: 'Put one title per line, e.g. "Black Clover | 172".' })
    const d = findDuplicates(parsed, lib.titles)
    setRows(parsed.map((r) => (d.has(r.key) ? { ...r, include: false } : r)))
  }

  const update = (key: string, patch: Partial<ParsedRow>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const included = rows?.filter((r) => r.include && r.title.trim()) ?? []
  const flagged = rows?.filter((r) => r.flags.some((f) => f.level === 'review')) ?? []
  const shown = rows?.filter((r) => !reviewOnly || r.flags.some((f) => f.level === 'review')) ?? []

  const save = async () => {
    const yes = await confirm({
      title: `Import ${included.length} titles?`,
      body: (
        <>
          <p>They'll be added to your library on this device. Existing titles are not changed.</p>
          {flagged.some((r) => r.include) && <p>{flagged.filter((r) => r.include).length} flagged entries are included — you can fix them later from each title's page.</p>}
        </>
      ),
      confirmLabel: 'Import',
    })
    if (!yes) return
    setSaving(true)
    try {
      await bulkWrite({ titles: included.map(rowToTitle), history: [], images: [] }, false)
      await lib.reload()
      toast.success(`Imported ${included.length} titles`)
      navigate('/continue')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <>
        <PageHeader title="Import from notes" subtitle="Paste your list, review every entry, then import. Nothing is saved until you confirm." />
        <div className="card space-y-4 p-5">
          <div className="space-y-1 text-sm text-muted">
            <p>One title per line. Headings set the type and status for the lines below them, e.g.:</p>
            <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 text-xs text-fg">{'### Anime — Currently Watching\n- Black Clover | 172\n- Spy x Family | S3/E38\n\n### TV Series\n- Helluva Boss | S2/E8'}</pre>
          </div>
          <label className="block">
            <span className="label">Your notes</span>
            <textarea className="input min-h-72 py-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your list here…" />
          </label>
          <label className="block max-w-xs">
            <span className="label">Lines without a heading are</span>
            <select className="input" value={defaultType} onChange={(e) => setDefaultType(e.target.value as MediaType)}>
              {(Object.keys(MEDIA_LABEL) as MediaType[]).map((m) => (
                <option key={m} value={m}>
                  {MEDIA_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={parse} disabled={!text.trim()}>
              Review entries
            </button>
            <button type="button" className="btn-secondary" onClick={() => setText(STARTER_NOTES)}>
              <FileText className="size-4" aria-hidden /> Load my starter list
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Review import"
        subtitle={`${rows.length} entries · ${flagged.length} need a look · ${dups.size} already in your library`}
        action={
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setRows(null)}>
              Back
            </button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={!included.length || saving}>
              Import {included.length}
            </button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="chip" aria-pressed={!reviewOnly} onClick={() => setReviewOnly(false)}>
          All ({rows.length})
        </button>
        <button type="button" className="chip" aria-pressed={reviewOnly} onClick={() => setReviewOnly(true)}>
          Needs review ({flagged.length})
        </button>
        <span className="ml-auto text-xs text-muted">Numbers are read as the last episode watched. Original lines are kept in each title's notes.</span>
      </div>

      <ul className="space-y-3">
        {shown.map((r) => (
          <ImportRow key={r.key} row={r} duplicate={dups.has(r.key)} onChange={(p) => update(r.key, p)} />
        ))}
      </ul>

      <div className="sticky bottom-20 mt-6 flex justify-end lg:bottom-6">
        <button type="button" className="btn-primary shadow-xl" onClick={() => void save()} disabled={!included.length || saving}>
          Import {included.length} titles
        </button>
      </div>
    </>
  )
}

function ImportRow({ row: r, duplicate, onChange }: { row: ParsedRow; duplicate: boolean; onChange: (p: Partial<ParsedRow>) => void }) {
  const preview = r.mediaType === 'movie' ? STATUS_LABEL[r.status] : (() => {
    const t = rowToTitle(r)
    return t.progress ? describePosition(t.progress) : ''
  })()
  const review = r.flags.some((f) => f.level === 'review')

  return (
    <li className={`card p-4 ${r.include ? '' : 'opacity-60'} ${review && r.include ? 'border-warn/50' : ''}`}>
      <div className="flex flex-wrap items-start gap-3">
        <input
          type="checkbox"
          className="mt-2.5 size-4 accent-[var(--accent)]"
          checked={r.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={`Include ${r.title}`}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input max-w-sm flex-1 font-medium" value={r.title} onChange={(e) => onChange({ title: e.target.value })} aria-label="Title" />
            {duplicate && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs text-warn">Already in library</span>}
            <span className="text-xs text-muted">“{r.original}”</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <select className="input" value={r.mediaType} onChange={(e) => onChange({ mediaType: e.target.value as MediaType })} aria-label="Type">
              {(Object.keys(MEDIA_LABEL) as MediaType[]).map((m) => (
                <option key={m} value={m}>
                  {MEDIA_LABEL[m]}
                </option>
              ))}
            </select>
            <select className="input" value={r.status} onChange={(e) => onChange({ status: e.target.value as WatchStatus })} aria-label="Status">
              {(Object.keys(STATUS_LABEL) as WatchStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {r.mediaType !== 'movie' && (
              <>
                <select className="input" value={r.numbering} onChange={(e) => onChange({ numbering: e.target.value as Numbering })} aria-label="Numbering">
                  <option value="seasonal">Season + ep</option>
                  <option value="absolute">Overall ep #</option>
                </select>
                {r.numbering === 'seasonal' ? (
                  <input className="input" inputMode="numeric" value={r.season ?? ''} onChange={(e) => onChange({ season: num(e.target.value) })} placeholder="Season" aria-label="Season" />
                ) : (
                  <span />
                )}
                <input
                  className="input"
                  inputMode="numeric"
                  value={r.lastEpisode ?? ''}
                  onChange={(e) => onChange({ lastEpisode: num(e.target.value) })}
                  placeholder="Last ep watched"
                  aria-label="Last episode watched"
                />
                <input
                  className="input"
                  defaultValue={formatSkipRanges(r.skipped, r.numbering === 'seasonal' ? r.season : null)}
                  onBlur={(e) => onChange({ skipped: parseSkipRanges(e.target.value, r.numbering === 'seasonal' ? r.season : null) })}
                  placeholder="Skipped e.g. 2–9"
                  aria-label="Skipped episodes"
                />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {preview && (
              <span className="inline-flex items-center gap-1 font-medium text-accent-text">
                <CheckCircle2 className="size-3.5" aria-hidden /> {r.status === 'completed' && r.mediaType !== 'movie' ? 'Completed' : preview}
              </span>
            )}
            {r.flags.map((f) => (
              <span key={f.text} className={`inline-flex items-center gap-1 ${f.level === 'review' ? 'text-warn' : 'text-muted'}`}>
                {f.level === 'review' ? <AlertTriangle className="size-3.5" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
                {f.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </li>
  )
}
