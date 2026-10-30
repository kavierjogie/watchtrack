import { Check, Copy, Share2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { withPublicPosters } from '../lib/posters'
import { encodeShare, shareUrl } from '../lib/share'
import { MEDIA, STATUS } from '../lib/backup'
import { MEDIA_LABEL, STATUS_LABEL, type Title } from '../lib/types'
import { useLibrary } from '../state/library'
import { Modal } from './Modal'

type Link = { url: string } | { error: string }

/** Longer links get cut off when sent in an Instagram DM, and a cut link can't be opened. */
const INSTAGRAM_DM_LIMIT = 1000

/** Copy via the Clipboard API, falling back to selecting the field (insecure contexts, older browsers). */
export async function copyText(text: string, field: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (!field) return false
    field.select()
    return document.execCommand('copy')
  }
}

/** `only`: start with just this title selected (sharing from its page) instead of the whole library. */
export function ShareDialog({ onClose, only }: { onClose: () => void; only?: string }) {
  const { titles, save } = useLibrary()
  const [selected, setSelected] = useState(() => new Set(only && titles.some((t) => t.id === only) ? [only] : titles.map((t) => t.id)))
  // Keyed by the selection it was built for, so a stale link is never shown or copied.
  const [built, setBuilt] = useState<{ for: Title[]; link: Link } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const chosen = useMemo(() => titles.filter((t) => selected.has(t.id)), [titles, selected])
  const link = built?.for === chosen ? built.link : null

  // Rebuild the link whenever the selection changes, so Copy/Share run inside the click (browsers require that).
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
        (payload) => alive && setBuilt({ for: chosen, link: { url: shareUrl(payload) } }),
        (err: unknown) => alive && setBuilt({ for: chosen, link: { error: err instanceof Error ? err.message : 'Could not create the link.' } }),
      )
    return () => {
      alive = false
    }
  }, [chosen, save])

  const url = link && 'url' in link ? link.url : null

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
        <>
          <button type="button" className="btn-secondary" onClick={() => void copy()} disabled={!url}>
            {copied === url ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied === url ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" className="btn-primary" onClick={() => void share()} disabled={!url}>
            <Share2 className="size-4" aria-hidden /> Share
          </button>
        </>
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
              value={url ?? (chosen.length ? 'Creating link…' : 'Select at least one title')}
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

        <p className="text-xs text-muted">Anyone with this link can see the titles in it. The list is stored inside the link itself, not uploaded anywhere.</p>
      </div>
    </Modal>
  )
}
