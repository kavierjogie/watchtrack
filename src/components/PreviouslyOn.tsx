import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatEp } from '../lib/progress'
import { getRecap, recapCredit, recapLookup, type Recap } from '../lib/recap'
import type { Title } from '../lib/types'

/**
 * "Previously on": what happened in the last episode you watched, on a show you haven't touched in a few weeks.
 * Shows nothing until a summary is available, and nothing at all when the provider has none or can't be reached.
 */
export function PreviouslyOn({ t }: { t: Title }) {
  const [result, setResult] = useState<{ key: string; recap: Recap | null } | null>(null)
  const [open, setOpen] = useState(false)
  const lookup = recapLookup(t)
  const key = lookup ? `${lookup.provider}:${lookup.id}:${lookup.season}:${lookup.episode}` : ''

  useEffect(() => {
    if (!key) return
    let live = true
    // Not cancelled on re-render: the fetch is shared and cached, and the title object changes often (poster saves, edits).
    getRecap(t)
      .then((recap) => live && setResult({ key, recap }))
      .catch(() => {}) // Offline or provider down: the card simply has no recap this time.
    return () => {
      live = false
    }
  }, [t, key])

  // A result for an earlier episode (you've since marked more watched) is never shown.
  const recap = result?.key === key ? result.recap : null
  if (!recap || !t.progress) return null
  const long = recap.summary.length > 160
  return (
    <section aria-label="Previously on" className="mt-2 rounded-xl bg-surface-2 p-2.5 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-fg">
        <History className="size-3.5 shrink-0 text-accent-text" aria-hidden />
        <span className="min-w-0 truncate">
          Previously: {formatEp(recap.episode, t.progress.numbering)}
          {recap.name ? ` · ${recap.name}` : ''}
        </span>
      </p>
      <p className={`mt-1 whitespace-pre-line text-muted ${open ? '' : 'line-clamp-3'}`}>{recap.summary}</p>
      <p className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{recapCredit(recap)}</span>
        {long && (
          <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Show less' : 'Read more'}
          </button>
        )}
      </p>
    </section>
  )
}
