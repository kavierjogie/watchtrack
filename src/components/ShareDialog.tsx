import { Check, Copy, LinkIcon, Share2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { copyText } from '../lib/format'
import { withPublicPosters } from '../lib/posters'
import { createShortLink, encodeShare, shareUrl } from '../lib/share'
import { MEDIA, STATUS } from '../lib/backup'
import { MEDIA_LABEL, STATUS_LABEL, type Title } from '../lib/types'
import { useLibrary } from '../state/library'
import { Modal } from './Modal'

type Link = { payload: string } | { error: string }

/** Longer links get cut off when sent in an Instagram DM, and a cut link can't be opened. Only the long fallback link can get there. */
const INSTAGRAM_DM_LIMIT = 1000

/** `only`: start with just this title selected (sharing from its page) instead of the whole library. */
export function ShareDialog({ onClose, only }: { onClose: () => void; only?: string }) {
  const { titles, save } = useLibrary()
  const [selected, setSelected] = useState(() => new Set(only && titles.some((t) => t.id === only) ? [only] : titles.map((t) => t.id)))
  // Keyed by the selection it was built for, so a stale link is never shown or copied.
  const [built, setBuilt] = useState<{ for: Title[]; link: Link } | null>(null)
  // The stored link for a selection, also keyed so it's never reused. url null: the server couldn't store it, so use the long link.
  const [short, setShort] = useState<{ for: Title[]; url: string | null } | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const chosen = useMemo(() => titles.filter((t) => selected.has(t.id)), [titles, selected])
  const link = built?.for === chosen ? built.link : null
  const made = short?.for === chosen ? short : null

  // Rebuild the payload whenever the selection changes. Local only: nothing is uploaded until Create link is pressed.
  useEffect(() => {
    if (!chosen.length) return
    let alive = true
    withPublicPosters(chosen)
      .then((ready) => {
        // Remember recovered poster URLs so the lookup happens once, not on every share. The saves re-run this effect.
        ready.forEach((t, i) => t !== chosen[i] && void save(t).catch(() => {}))
        return encodeShare(ready)
      })
      .then(
        (payload) => alive && setBuilt({ for: chosen, link: { payload } }),
        (err: unknown) => alive && setBuilt({ for: chosen, link: { error: err instanceof Error ? err.message : 'Could not create the link.' } }),
      )
    return () => {
      alive = false
    }
  }, [chosen, save])

  const payload = link && 'payload' in link ? link.payload : null
  const url = made && payload ? (made.url ?? shareUrl(payload)) : null

  const create = async () => {
    if (!payload) return
    setCreating(true)
    const shortUrl = await createShortLink(payload).catch(() => null)
    setShort({ for: chosen, url: shortUrl })
    setCreating(false)
  }

  const copy = async () => {
    if (!url) return
    if (await copyText(url, field.current)) {
      setCopied(url)
      toast.success('Link copied', { description: 'Paste it into any chat or message.' })
    } else toast.error("Couldn't copy the link", { description: 'Select the link above and copy it manually.' })
  }

  const share = async () => {
    if (!url) return
    if (!navigator.share) return copy()
    try {
      await navigator.share({ title: 'My WatchTrack watchlist', text: `My watchlist — ${chosen.length} title${chosen.length === 1 ? '' : 's'}`, url })
    } catch (err) {
      // Closing the share sheet is not an error.
      if ((err as Error).name !== 'AbortError') await copy()
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
  const selectWhere = (match: (t: Title) => boolean) => setSelected(new Set(titles.filter(match).map((t) => t.id)))
  const statuses = STATUS.filter((s) => titles.some((t) => t.status === s))
  const types = MEDIA.filter((m) => titles.some((t) => t.mediaType === m))

  return (
    <Modal
      open
      onClose={onClose}
      title="Share watchlist"
      footer={
        url ? (
          <>
            <button type="button" className="btn-secondary" onClick={() => void copy()}>
              {copied === url ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied === url ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" className="btn-primary" onClick={() => void share()}>
              <Share2 className="size-4" aria-hidden /> Share
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary" onClick={() => void create()} disabled={!payload || creating}>
            <LinkIcon className="size-4" aria-hidden /> {creating ? 'Creating link…' : 'Create link'}
          </button>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Your friend opens the link in any browser and sees a read-only copy — no app, account or file needed. It includes titles, type, status, progress,
          year, rating and online poster images. Notes, history and settings are never included.
        </p>

        <div>
          <p className="label">Quick select</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="chip" onClick={() => selectWhere(() => true)}>
              All
            </button>
            {types.map((m) => (
              <button key={m} type="button" className="chip" onClick={() => selectWhere((t) => t.mediaType === m)}>
                {MEDIA_LABEL[m]}
              </button>
            ))}
            {statuses.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => selectWhere((t) => t.status === s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => setSelected(new Set())}>
              None
            </button>
          </div>
        </div>

        {/* min-w-0: fieldsets default to min-width: min-content, so a long title would widen the sheet and scroll sideways. */}
        <fieldset className="min-w-0">
          <legend className="label">
            {chosen.length} of {titles.length} selected
          </legend>
          <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {titles.map((t) => (
              <li key={t.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                  <input type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {MEDIA_LABEL[t.mediaType]} · {STATUS_LABEL[t.status]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {link && 'error' in link ? (
          <p className="flex gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-warn" role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {link.error}
          </p>
        ) : (
          <label className="block">
            <span className="label">Share link</span>
            <input
              ref={field}
              className="input font-mono text-xs!"
              readOnly
              value={url ?? (chosen.length ? 'Press Create link when your selection is ready' : 'Select at least one title')}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}

        {url && url.length > INSTAGRAM_DM_LIMIT && (
          <p className="flex gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-warn" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            This link is too long for Instagram DMs. Send it on WhatsApp or pick fewer titles.
          </p>
        )}

        {made && !made.url && url && (
          <p className="text-xs text-muted" role="status">
            Couldn't create a short link, so this one holds the whole list instead.
          </p>
        )}

        <p className="text-xs text-muted">
          {made && !made.url
            ? 'Anyone with this link can see the titles in it. The list is stored inside the link itself, not uploaded anywhere.'
            : "Anyone with this link can see the titles in it. The list is stored on WatchTrack's server for 90 days, then deleted."}
        </p>
      </div>
    </Modal>
  )
}
