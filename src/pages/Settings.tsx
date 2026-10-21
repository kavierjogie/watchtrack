import { Download, FileUp, HardDrive, Smartphone, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '../components/cards'
import { Modal, useConfirm } from '../components/Modal'
import { applyImport, createBackup, downloadJson, parseBackup, planImport, type DuplicateStrategy, type ImportMode, type ImportPlan } from '../lib/backup'
import { clearAll } from '../lib/db'
import { formatBytes, today } from '../lib/format'
import { setPrefs, usePrefs, type Prefs } from '../lib/prefs'
import { MEDIA_LABEL, STATUS_LABEL, type MediaType, type WatchStatus } from '../lib/types'
import { useLibrary } from '../state/library'

function Card({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="card space-y-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  )
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button key={v} type="button" className="chip" aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function SettingsPage() {
  const prefs = usePrefs()
  const lib = useLibrary()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [key, setKey] = useState(prefs.tmdbKey)

  useEffect(() => {
    void (async () => {
      if (!navigator.storage?.estimate) return
      const e = await navigator.storage.estimate()
      const persisted = (await navigator.storage.persisted?.()) ?? false
      setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0, persisted })
    })()
  }, [lib.titles])

  const exportBackup = async () => {
    try {
      const backup = await createBackup()
      downloadJson(backup, `watchtrack-backup-${today()}.json`)
      toast.success('Backup downloaded', { description: `${backup.titles.length} titles, ${backup.history.length} history entries, ${backup.images.length} images` })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setPlan(planImport(parseBackup(await file.text()), lib.titles))
    } catch (err) {
      toast.error('Import failed', { description: err instanceof Error ? err.message : 'Invalid file.' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const clear = async () => {
    const yes = await confirm({
      title: 'Clear all data?',
      body: (
        <>
          <p>
            This permanently deletes all <strong className="text-fg">{lib.titles.length} titles</strong>, their watch history and uploaded posters from this browser.
          </p>
          <p>It can't be undone. Export a backup first if you might want this data again.</p>
        </>
      ),
      confirmLabel: 'Delete everything',
      danger: true,
      typeToConfirm: 'DELETE',
    })
    if (!yes) return
    await clearAll()
    await lib.reload()
    toast.success('All data cleared')
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Card title="Your data lives on this device" icon={<HardDrive className="size-5 text-accent-text" aria-hidden />}>
        <div className="space-y-2 text-sm text-muted">
          <p>Everything you track is stored in this browser's local database (IndexedDB). There's no account, server or cloud copy.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Clearing site data / browsing history for this site deletes your library.</li>
            <li>Other browsers and devices have their own separate copy — nothing syncs automatically.</li>
            <li>Installing as an app doesn't change this. Export backups regularly, and use them to move between devices.</li>
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Titles" value={String(lib.titles.length)} />
          <Stat label="Episodes logged" value={String(lib.episodesLogged)} />
          <Stat label="Storage used" value={usage ? formatBytes(usage.used) : 'Unavailable'} />
          <Stat label="Protected from cleanup" value={usage ? (usage.persisted ? 'Yes' : 'Best effort') : '—'} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => void exportBackup()}>
            <Download className="size-4" aria-hidden /> Export backup
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden /> Import backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <Link to="/import" className="btn-secondary">
            <FileUp className="size-4" aria-hidden /> Import from notes
          </Link>
        </div>
      </Card>

      <Card title="Appearance">
        <Choice<Prefs['theme']> label="Theme" value={prefs.theme} options={[['dark', 'Dark'], ['light', 'Light'], ['system', 'System']]} onChange={(theme) => setPrefs({ theme })} />
        <Choice<Prefs['gridSize']> label="Poster size" value={prefs.gridSize} options={[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]} onChange={(gridSize) => setPrefs({ gridSize })} />
        <Choice<Prefs['libraryView']> label="Library layout" value={prefs.libraryView} options={[['grid', 'Poster grid'], ['list', 'Compact list']]} onChange={(libraryView) => setPrefs({ libraryView })} />
      </Card>

      <Card title="Defaults">
        <Choice<Prefs['progressMode']>
          label="When editing progress, I enter the…"
          value={prefs.progressMode}
          options={[['last', 'Last episode watched'], ['next', 'Next episode to watch']]}
          onChange={(progressMode) => setPrefs({ progressMode })}
        />
        <Choice<MediaType | 'all'>
          label="Library shows type"
          value={prefs.defaultType}
          options={[['all', 'All'], ...(Object.entries(MEDIA_LABEL) as [MediaType, string][])]}
          onChange={(defaultType) => setPrefs({ defaultType })}
        />
        <Choice<WatchStatus | 'all'>
          label="Library shows status"
          value={prefs.defaultStatus}
          options={[['all', 'Any'], ...(Object.entries(STATUS_LABEL) as [WatchStatus, string][])]}
          onChange={(defaultStatus) => setPrefs({ defaultStatus })}
        />
      </Card>

      <Card title="Artwork & metadata (optional)">
        <div className="space-y-2 text-sm text-muted">
          <p>
            Search uses <strong className="text-fg">AniList</strong> for anime and <strong className="text-fg">TVmaze</strong> for TV — both free, no key needed. Only your search
            text is sent; your progress never leaves this device.
          </p>
          <p>
            For movies (and extra TV results) you can add your own free{' '}
            <a className="text-accent-text underline" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
              TMDB API key
            </a>
            . It's stored only in this browser and sent only to TMDB. Without it, add movies manually or via AniList.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setPrefs({ tmdbKey: key.trim() })
            toast.success(key.trim() ? 'TMDB key saved' : 'TMDB key removed')
          }}
        >
          <label className="flex-1">
            <span className="sr-only">TMDB API key or read access token</span>
            <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="TMDB API key or read access token" autoComplete="off" />
          </label>
          <button type="submit" className="btn-secondary">
            Save
          </button>
        </form>
      </Card>

      <Card title="Install on your phone" icon={<Smartphone className="size-5 text-accent-text" aria-hidden />}>
        <InstallHelp />
      </Card>

      <Card title="Danger zone">
        <p className="text-sm text-muted">Delete every title, history entry and uploaded poster from this browser.</p>
        <button type="button" className="btn-danger" onClick={() => void clear()} disabled={lib.titles.length === 0}>
          <Trash2 className="size-4" aria-hidden /> Clear all data
        </button>
      </Card>

      <section className="space-y-2 px-1 text-xs text-muted">
        <p>Credits: anime data from AniList; TV data from TVmaze (CC BY-SA). This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p>No analytics, tracking or telemetry.</p>
      </section>

      {plan && <ImportDialog plan={plan} onClose={() => setPlan(null)} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  )
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>
}

// Captured at startup (this module loads with the app) so the prompt isn't missed.
let deferredInstall: InstallEvent | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = e as InstallEvent
})

function InstallHelp() {
  const [evt, setEvt] = useState<InstallEvent | null>(deferredInstall)
  return (
    <div className="space-y-3 text-sm text-muted">
      {evt && (
        <button type="button" className="btn-primary" onClick={() => void evt.prompt().then(() => {
          deferredInstall = null
          setEvt(null)
        })}>
          Install app
        </button>
      )}
      <p>
        <strong className="text-fg">iPhone / iPad (Safari):</strong> tap Share → <em>Add to Home Screen</em>.
      </p>
      <p>
        <strong className="text-fg">Android (Chrome):</strong> tap ⋮ → <em>Install app</em> or <em>Add to Home screen</em>.
      </p>
      <p>The installed app works offline and uses the same browser storage — it's still not synced to other devices, so keep backups.</p>
    </div>
  )
}

function ImportDialog({ plan, onClose }: { plan: ImportPlan; onClose: () => void }) {
  const lib = useLibrary()
  const confirm = useConfirm()
  const [mode, setMode] = useState<ImportMode>('merge')
  const [dup, setDup] = useState<DuplicateStrategy>('skip')
  const [busy, setBusy] = useState(false)
  const b = plan.backup

  const run = async () => {
    if (mode === 'replace') {
      const yes = await confirm({
        title: 'Replace your library?',
        body: (
          <p>
            Your current {lib.titles.length} titles and their history will be deleted and replaced with the {b.titles.length} titles in this backup.
          </p>
        ),
        confirmLabel: 'Replace',
        danger: true,
      })
      if (!yes) return
    }
    setBusy(true)
    try {
      const res = await applyImport(plan, mode, dup)
      await lib.reload()
      toast.success('Backup imported', { description: `${res.titles.length} titles written` })
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import backup"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={mode === 'replace' ? 'btn-danger' : 'btn-primary'} onClick={() => void run()} disabled={busy}>
            {mode === 'replace' ? 'Replace library' : 'Merge into library'}
          </button>
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <p className="text-muted">Exported {new Date(b.exportedAt).toLocaleString()}</p>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Titles" value={String(b.titles.length)} />
          <Stat label="History" value={String(b.history.length)} />
          <Stat label="Images" value={String(b.images.length)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="New to this device" value={String(plan.fresh.length)} />
          <Stat label="Already here" value={String(plan.duplicates.length)} />
        </div>
        <Choice<ImportMode>
          label="How to import"
          value={mode}
          options={[
            ['merge', 'Merge with my library'],
            ['replace', 'Replace my library'],
          ]}
          onChange={setMode}
        />
        {mode === 'merge' && plan.duplicates.length > 0 && (
          <>
            <Choice<DuplicateStrategy>
              label={`For the ${plan.duplicates.length} titles already here`}
              value={dup}
              options={[
                ['skip', 'Keep mine'],
                ['overwrite', "Use backup's version"],
                ['keep-both', 'Keep both'],
              ]}
              onChange={setDup}
            />
            <details className="rounded-xl bg-surface-2 p-3">
              <summary className="cursor-pointer text-xs font-medium">Show duplicates</summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted">
                {plan.duplicates.map(({ incoming, existing }) => (
                  <li key={incoming.id}>
                    {incoming.title} <span className="opacity-70">(yours: {STATUS_LABEL[existing.status]}, backup: {STATUS_LABEL[incoming.status]})</span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </Modal>
  )
}
