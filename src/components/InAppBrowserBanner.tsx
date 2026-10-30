import { Copy, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { isInAppBrowser } from '../lib/format'
import { copyText } from './ShareDialog'

export const inAppBrowser = isInAppBrowser(navigator.userAgent)

const browserName = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'Safari' : 'Chrome'

/** A library saved in an app's built-in browser stays there, so send people to their real browser before they start. */
export function InAppBrowserBanner() {
  const [dismissed, setDismissed] = useState(false)
  if (!inAppBrowser || dismissed) return null

  const copy = async () => {
    // The full address, so the list inside a share link's # comes along.
    if (await copyText(window.location.href, null)) toast.success('Link copied', { description: `Paste it into ${browserName}.` })
    else toast.error("Couldn't copy the link", { description: 'Use this app\'s ⋯ menu to open it in your browser.' })
  }

  return (
    <div role="status" className="flex items-start gap-3 border-b border-warn/40 bg-warn/10 px-4 py-3 text-sm">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">Open in {browserName} to keep your list</p>
        <p className="text-muted">Anything you add here stays inside this app's browser. Tap ⋯ → Open in browser, or copy the link.</p>
        <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={() => void copy()}>
          <Copy className="size-4" aria-hidden /> Copy link
        </button>
      </div>
      <button type="button" className="btn-ghost size-9 shrink-0 p-0" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
