import { ArrowRightLeft, Bell, BellRing, Check, Cloud, Copy, HardDrive, Mail, RefreshCw, Share2, Shield, Smartphone, Trash2, Upload } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { alertsOn, notifySupported, showSystemNotification } from '../lib/alerts'
import { AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '../components/cards'
import { Modal, useConfirm } from '../components/Modal'
import { copyText } from '../components/ShareDialog'
import { applyImport, MAX_BACKUP_BYTES, parseBackup, planImport, type DuplicateStrategy, type ImportMode, type ImportPlan } from '../lib/backup'
import { clearAll } from '../lib/db'
import { resetDiscover } from '../lib/discover'
import { connectDrive, disconnectDrive, driveConfigured, driveConnected, finishConnect, markDirty, syncDrive, useDrive } from '../lib/drive'
import { FEEDBACK_MAILTO, formatBytes, timeAgo } from '../lib/format'
import { setPrefs, usePrefs, type Prefs } from '../lib/prefs'
import { canRefresh, useSyncState } from '../lib/sync'
import { encodeTransfer, MAX_QR_PAYLOAD, transferUrl } from '../lib/transfer'
import { MEDIA_LABEL, STATUS_LABEL, type MediaType, type WatchStatus } from '../lib/types'
import { useLibrary } from '../state/library'
import { useRefreshEpisodes } from '../state/useSync'

/** Manual library-wide refresh. The same check runs on its own when the app is opened. */
function NewEpisodes() {
  const { refreshAll } = useRefreshEpisodes()
  const { cycle } = useSyncState()
  return (
    <div className="space-y-2 text-sm text-muted">
      <p>
        New seasons and episodes are checked automatically when you open the app (each show at most once a day; ended shows weekly). Your progress is never
        changed. The browser can't check while the app is closed.
      </p>
      <button type="button" className="btn-secondary" disabled={cycle} onClick={() => void refreshAll()}>
        <RefreshCw className={`size-4 ${cycle ? 'animate-spin' : ''}`} aria-hidden /> {cycle ? 'Checking…' : 'Check for new episodes now'}
      </button>
    </div>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-muted">{hint}</span>}
      </span>
    </label>
  )
}

function AlertSettings() {
  const prefs = usePrefs()
  const lib = useLibrary()
  const supported = notifySupported()
  const [permission, setPermission] = useState(() => (supported ? Notification.permission : 'denied'))
  const shows = lib.titles.filter(canRefresh).sort((a, b) => a.title.localeCompare(b.title))

  useEffect(() => {
    // Linked from the alerts page; after Layout's scroll-to-top on navigation.
    if (window.location.hash === '#alerts') setTimeout(() => document.getElementById('alerts')?.scrollIntoView({ block: 'start' }))
  }, [])

  const enableBrowser = async (on: boolean) => {
    if (!on) return setPrefs({ browserNotify: false })
    // Asked only here, after the user switched it on — never on page load.
    const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    setPermission(result)
    if (result === 'granted') {
      setPrefs({ browserNotify: true })
      toast.success('Browser notifications on')
    } else toast.error('Notifications are blocked', { description: 'Allow notifications for this site in your browser settings, then try again. Alerts still appear in the app.' })
  }

  const test = async () => {
    const ok = await showSystemNotification('WatchTrack test notification', 'This is how new seasons and episodes will appear.', '/notifications', 'watchtrack-test')
    if (!ok) toast.error("Couldn't show a notification", { description: 'Check that notifications are allowed for this site.' })
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Hear about newly announced seasons, confirmed or changed release dates and new episodes for shows in your library. Alerts appear under the bell. Dropped shows
        are left out unless you turn them on below.
      </p>
      <Toggle label="Release alerts" checked={prefs.alertsOn} onChange={(alertsOn) => setPrefs({ alertsOn })} />
      <div className="space-y-3 border-l-2 border-line pl-4">
        <Toggle label="New seasons" hint="Announced seasons and seasons now available" checked={prefs.alertSeasons} disabled={!prefs.alertsOn} onChange={(alertSeasons) => setPrefs({ alertSeasons })} />
        <Toggle label="Release dates" hint="When a date is confirmed or changes" checked={prefs.alertDates} disabled={!prefs.alertsOn} onChange={(alertDates) => setPrefs({ alertDates })} />
        <Toggle label="Episodes" hint="New episodes out, and premieres with a confirmed air date" checked={prefs.alertEpisodes} disabled={!prefs.alertsOn} onChange={(alertEpisodes) => setPrefs({ alertEpisodes })} />
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-medium">Browser notifications</p>
        {!supported ? (
          <p className="text-sm text-muted">This browser doesn't support notifications. On iPhone and iPad, add WatchTrack to your Home Screen first. Alerts still appear in the app.</p>
        ) : (
          <>
            <Toggle
              label="Notify me when WatchTrack is in the background"
              hint={
                permission === 'denied'
                  ? 'Blocked by your browser. Allow notifications for this site in its settings to use this.'
                  : 'Your browser will ask for permission. Used only for these alerts.'
              }
              checked={prefs.browserNotify && permission === 'granted'}
              disabled={!prefs.alertsOn || permission === 'denied'}
              onChange={(on) => void enableBrowser(on)}
            />
            {prefs.browserNotify && permission === 'granted' && (
              <button type="button" className="btn-secondary" onClick={() => void test()}>
                <BellRing className="size-4" aria-hidden /> Send a test notification
              </button>
            )}
          </>
        )}
        <p className="text-xs text-muted">
          Checks run only while WatchTrack is open (including in a background tab or installed app window) — each show at most once a day, and again soon after a known
          release date passes. Browsers can't check while it's closed: that would need a server sending push messages, which WatchTrack doesn't have because your data
          never leaves this device.
        </p>
      </div>

      {shows.length > 0 && (
        <details className="rounded-xl bg-surface-2 p-3">
          <summary className="cursor-pointer text-sm font-medium">Choose shows ({shows.filter(alertsOn).length} of {shows.length} on)</summary>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {shows.map((t) => (
              <li key={t.id}>
                <Toggle
                  label={t.title}
                  hint={STATUS_LABEL[t.status]}
                  checked={alertsOn(t)}
                  onChange={(on) => void lib.patch(t.id, (cur) => ({ ...cur, alerts: on })).catch(() => toast.error("Couldn't save that change."))}
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Card({ id, title, children, icon }: { id?: string; title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-6 space-y-4 p-5">
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

  useEffect(() => {
    void (async () => {
      if (!navigator.storage?.estimate) return
      const e = await navigator.storage.estimate()
      const persisted = (await navigator.storage.persisted?.()) ?? false
      setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0, persisted })
    })()
  }, [lib.titles])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error(`This file is ${formatBytes(file.size)}, too large to be a WatchTrack backup.`)
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
          <p>It can't be undone.{driveConnected() ? ' Google Drive is disconnected too; the copy in your Drive is kept.' : ''}</p>
        </>
      ),
      confirmLabel: 'Delete everything',
      danger: true,
      typeToConfirm: 'DELETE',
    })
    if (!yes) return
    // Otherwise the next sync would bring everything straight back from Drive.
    disconnectDrive()
    await clearAll()
    resetDiscover()
    await lib.reload()
    toast.success('All data cleared')
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Card title="Your data lives on this device" icon={<HardDrive className="size-5 text-accent-text" aria-hidden />}>
        <div className="space-y-2 text-sm text-muted">
          <p>Everything you track is stored in this browser's local database (IndexedDB). There's no WatchTrack account or server.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Clearing site data / browsing history for this site deletes your library, unless Google Drive sync is on.</li>
            <li>Other browsers and devices have their own copy. Turn on Google Drive sync, or use a transfer link below, to move between them.</li>
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Titles" value={String(lib.titles.length)} />
          <Stat label="Episodes logged" value={String(lib.episodesLogged)} />
          <Stat label="Storage used" value={usage ? formatBytes(usage.used) : 'Unavailable'} />
          <Stat label="Protected from cleanup" value={usage ? (usage.persisted ? 'Yes' : 'Best effort') : '—'} />
        </div>
        <DriveSync />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden /> Import backup file
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
      </Card>

      <Card title="Move to another device" icon={<ArrowRightLeft className="size-5 text-accent-text" aria-hidden />}>
        <TransferLink />
      </Card>

      <Card id="alerts" title="WatchTrack Alerts" icon={<Bell className="size-5 text-accent-text" aria-hidden />}>
        <AlertSettings />
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

      <Card title="New episodes">
        <NewEpisodes />
      </Card>

      <Card title="Install on your phone" icon={<Smartphone className="size-5 text-accent-text" aria-hidden />}>
        <InstallHelp />
      </Card>

      <Card title="Feedback" icon={<Mail className="size-5 text-accent-text" aria-hidden />}>
        <p className="text-sm text-muted">Found a bug or have an idea? Send it over — every message gets read.</p>
        <a href={FEEDBACK_MAILTO} className="btn-secondary">
          <Mail className="size-4" aria-hidden /> Send feedback
        </a>
      </Card>

      <Card title="Danger zone">
        <p className="text-sm text-muted">Delete every title, history entry and uploaded poster from this browser.</p>
        <button type="button" className="btn-danger" onClick={() => void clear()} disabled={lib.titles.length === 0}>
          <Trash2 className="size-4" aria-hidden /> Clear all data
        </button>
      </Card>

      <Card id="privacy" title="Privacy" icon={<Shield className="size-5 text-accent-text" aria-hidden />}>
        <div className="space-y-2 text-sm text-muted">
          <p>WatchTrack is free, has no accounts, ads or tracking cookies, and never sells or shares your data.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Visits are counted with Vercel Web Analytics, which is cookie-free and sees only the page address (never titles, searches or share links), referrer,
              browser, device type and country.
            </li>
            <li>Your library, history, notes and posters are stored only in this browser. WatchTrack's developer can't see them.</li>
            <li>
              To find titles, posters and new episodes, the app sends title names and IDs (never your library or progress) to the data sources below. TMDB requests
              go through WatchTrack's server (hosted on Vercel) to keep its API key private. As with any website, these services see your IP address.
            </li>
            <li>Share links put the list you chose in the link itself; only people you send it to can see it.</li>
            <li>Notifications are optional and shown by your own browser — nothing is sent to a push server.</li>
          </ul>
          <p>
            <a href="/about#privacy" className="underline hover:text-fg">
              How WatchTrack stores your data
            </a>
          </p>
        </div>
      </Card>

      <Card title="Credits">
        <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="inline-block">
          <img src="/tmdb.svg" alt="TMDB" className="h-4 w-auto" />
        </a>
        <ul className="space-y-1 text-sm text-muted">
          <li>
            Movie and TV data and images from <Ext href="https://www.themoviedb.org">TMDB</Ext>. This product uses the TMDB API but is not endorsed or certified by TMDB.
          </li>
          <li>
            TV data from <Ext href="https://www.tvmaze.com">TVmaze</Ext> (<Ext href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</Ext>).
          </li>
          <li>
            Anime data from <Ext href="https://kitsu.app">Kitsu</Ext> and <Ext href="https://anilist.co">AniList</Ext>.
          </li>
        </ul>
      </Card>

      <AnimatePresence>{plan && <ImportDialog plan={plan} onClose={() => setPlan(null)} />}</AnimatePresence>
    </div>
  )
}

/** Google Drive sync controls (lib/drive.ts). Hidden when the deployment has no Google client configured. */
function DriveSync() {
  const drive = useDrive()
  const { reload } = useLibrary()

  useEffect(() => {
    if (!driveConfigured) return
    // Back from Google's consent screen with ?code=…; the card itself shows the outcome.
    void finishConnect().then((connected) => {
      if (connected)
        void syncDrive().then((changed) => {
          if (changed) void reload()
        })
    })
  }, [reload])

  if (!driveConfigured) return null

  const syncNow = () =>
    void syncDrive().then((changed) => {
      if (changed) void reload()
    })

  return (
    <div className="space-y-3 rounded-xl bg-surface-2 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Cloud className="size-4 text-accent-text" aria-hidden /> Google Drive sync
      </p>
      {drive.refresh ? (
        <>
          <p className="text-muted">
            {drive.syncing ? 'Syncing…' : drive.lastSync ? `Synced to your Google Drive ${timeAgo(drive.lastSync)}.` : 'Connected.'} Changes save automatically and
            appear on every device where you connect the same Google account.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={drive.syncing} onClick={syncNow}>
              <RefreshCw className={`size-4 ${drive.syncing ? 'animate-spin' : ''}`} aria-hidden /> Sync now
            </button>
            <button type="button" className="btn-ghost" onClick={disconnectDrive}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted">
            Save your library to your own Google Drive and get it back on any device. WatchTrack can only see its own hidden app folder, not your files, and the
            developer never sees your data.
          </p>
          <button type="button" className="btn-primary" onClick={() => void connectDrive()}>
            <Cloud className="size-4" aria-hidden /> Connect Google Drive
          </button>
        </>
      )}
      {drive.error && (
        <p className="text-warn" role="alert">
          {drive.error}
        </p>
      )}
    </div>
  )
}

/** One-off copy of the whole library to another device, carried inside a link (see lib/transfer.ts). */
function TransferLink() {
  const lib = useLibrary()
  const [link, setLink] = useState<{ url: string; qr: string | null } | null>(null)
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  const create = async () => {
    try {
      const payload = await encodeTransfer()
      const url = transferUrl(payload)
      let qr: string | null = null
      if (payload.length <= MAX_QR_PAYLOAD) {
        const code = qrcode(0, 'L')
        code.addData(url)
        code.make()
        qr = code.createDataURL(4, 4)
      }
      setLink({ url, qr })
      setCopied(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the link.")
    }
  }

  const copy = async () => {
    if (!link) return
    if (await copyText(link.url, field.current)) {
      setCopied(true)
      toast.success('Link copied', { description: 'Open it on your other device.' })
    } else toast.error("Couldn't copy the link", { description: 'Select the link and copy it manually.' })
  }

  const share = async () => {
    if (!link) return
    if (!navigator.share) return copy()
    try {
      await navigator.share({ title: 'My WatchTrack library', url: link.url })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') await copy()
    }
  }

  return (
    <div className="space-y-3 text-sm text-muted">
      <p>
        Copy your whole library to a new phone or browser. Open the link there and choose to merge or replace. Posters you uploaded yourself stay on this device.
      </p>
      {!link ? (
        <button type="button" className="btn-secondary" disabled={lib.titles.length === 0} onClick={() => void create()}>
          <ArrowRightLeft className="size-4" aria-hidden /> Create transfer link
        </button>
      ) : (
        <>
          {link.qr ? (
            <div className="flex flex-wrap items-center gap-4">
              <img src={link.qr} alt="QR code for the transfer link" className="size-44 rounded-xl bg-white p-1 [image-rendering:pixelated]" />
              <p className="max-w-xs">Scan with your other phone's camera, or copy the link below.</p>
            </div>
          ) : (
            <p>Too much for a QR code: send the link to yourself (email, notes or chat) and open it on the other device.</p>
          )}
          <input ref={field} className="input font-mono text-xs!" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Transfer link" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => void copy()}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void share()}>
              <Share2 className="size-4" aria-hidden /> Share
            </button>
          </div>
        </>
      )}
      <p className="text-xs">This link contains your whole library, including notes. Send it only to yourself.</p>
    </div>
  )
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">
      {children}
    </a>
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

export function ImportDialog({ plan, onClose }: { plan: ImportPlan; onClose: () => void }) {
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
      markDirty()
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
