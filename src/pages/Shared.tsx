import { motion } from 'framer-motion'
import { Check, Eye, LinkIcon, ListX, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, PosterGridSkeleton, ProgressBar, progressLine, Rating, Section } from '../components/cards'
import { PageMeta } from '../components/Layout'
import { Logo } from '../components/Logo'
import { Poster } from '../components/Poster'
import { STATUS, titleKey } from '../lib/backup'
import { progressFraction } from '../lib/progress'
import { decodeShare, fetchShare, sharedToTitle, toMyPlan } from '../lib/share'
import { MEDIA_LABEL, STATUS_LABEL, type Title } from '../lib/types'
import { useLibrary } from '../state/library'

type State = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; titles: Title[] }
const LOADING: State = { state: 'loading' }

/** Read-only view of a shared list, from a short link (/s/:id) or the URL fragment; never touches the visitor's library. */
export function SharedPage() {
  const { hash } = useLocation()
  const { id } = useParams()
  const from = id ?? hash
  // Keyed by the link it came from, so pasting another link in this tab never shows the old list.
  const [result, setResult] = useState<{ from: string; s: State } | null>(null)
  const s = result?.from === from ? result.s : LOADING
  const lib = useLibrary()
  const mine = new Set(lib.titles.map(titleKey))
  const missing = s.state === 'ok' ? s.titles.filter((t) => !mine.has(titleKey(t))) : []

  /** Copies into the visitor's own library as Plan to Watch. Skips titles they already have. */
  const add = async (ts: Title[]) => {
    const fresh = ts.filter((t) => !mine.has(titleKey(t))).map(toMyPlan)
    try {
      for (const t of fresh) await lib.save(t)
    } catch {
      return void toast.error("Couldn't add to your library.", { description: 'Check that this browser allows site storage, then try again.' })
    }
    toast.success(fresh.length === 1 ? `Added “${fresh[0].title}” to Plan to Watch` : `Added ${fresh.length} titles to Plan to Watch`, {
      action: { label: 'Undo', onClick: () => void Promise.all(fresh.map((t) => lib.remove(t.id))) },
    })
  }

  useEffect(() => {
    let alive = true
    ;(id ? fetchShare(id) : decodeShare(hash)).then(
      (items) => alive && setResult({ from: id ?? hash, s: { state: 'ok', titles: items.map(sharedToTitle) } }),
      (err: unknown) => alive && setResult({ from: id ?? hash, s: { state: 'error', message: err instanceof Error ? err.message : 'The link could not be read.' } }),
    )
    return () => {
      alive = false
    }
  }, [id, hash])

  return (
    <div className="min-h-dvh">
      <PageMeta pathname="/shared" />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <Link to="/" className="flex items-center gap-2">
            <Logo />
          </Link>
          <Link to="/" className="btn-secondary min-h-9 px-3 text-xs">
            Open my WatchTrack
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Shared Watchlist</h1>
          {s.state === 'ok' && missing.length > 1 && (
            <button type="button" className="btn-primary mt-4" disabled={lib.loading} onClick={() => void add(missing)}>
              <Plus className="size-4" aria-hidden /> Add {missing.length === s.titles.length ? 'all' : `${missing.length} new`} to my list
            </button>
          )}
          {s.state === 'ok' && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              <Eye className="size-4 shrink-0" aria-hidden />
              {s.titles.length} title{s.titles.length === 1 ? '' : 's'} · nothing changes in your library unless you add it.
            </p>
          )}
        </header>

        {s.state === 'loading' ? (
          <PosterGridSkeleton />
        ) : s.state === 'error' ? (
          <EmptyState
            icon={LinkIcon}
            title="This link can't be opened"
            body={
              <>
                <p>{s.message}</p>
                {!id && (
                  <p className="mt-2">
                    Links like this one never expire — the whole list is stored inside the link itself. If it won't open, it was probably cut off when it was copied or sent. Ask
                    for the link again and paste it in full.
                  </p>
                )}
              </>
            }
            action={
              <Link to="/" className="btn-secondary">
                Go to WatchTrack
              </Link>
            }
          />
        ) : s.titles.length === 0 ? (
          <EmptyState icon={ListX} title="This watchlist is empty" body="The link works, but no titles were included when it was shared." />
        ) : (
          <div className="space-y-10">
            {STATUS.map((status) => {
              const group = s.titles.filter((t) => t.status === status)
              return (
                group.length > 0 && (
                  <Section key={status} title={`${STATUS_LABEL[status]} (${group.length})`}>
                    <ul className="poster-grid">
                      {group.map((t, i) => (
                        <SharedCard key={i} t={t} owned={mine.has(titleKey(t))} disabled={lib.loading} onAdd={() => void add([t])} />
                      ))}
                    </ul>
                  </Section>
                )
              )
            })}
          </div>
        )}

        <p className="mt-12 text-center text-xs text-muted">Anyone with this link can see this list. Shared with WatchTrack — the private, offline watch tracker.</p>
      </main>
    </div>
  )
}

/** Like TitleCard, but not a link; the only action is copying it into your own list. */
function SharedCard({ t, owned, disabled, onAdd }: { t: Title; owned: boolean; disabled: boolean; onAdd: () => void }) {
  return (
    <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      <div className="relative">
        <Poster poster={t.poster} source={t.source} title={t.title} mediaType={t.mediaType} />
        {t.progress && (
          <div className="absolute inset-x-2 bottom-2">
            <ProgressBar value={progressFraction(t.progress)} />
          </div>
        )}
      </div>
      <div className="mt-2 space-y-1 px-0.5">
        <h3 className="line-clamp-2 text-sm font-medium">{t.title}</h3>
        <p className="line-clamp-1 text-xs text-muted">{progressLine(t)}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          <span>{MEDIA_LABEL[t.mediaType]}</span>
          {t.year && <span>{t.year}</span>}
          <Rating value={t.rating} />
        </div>
        {owned ? (
          <p className="flex items-center gap-1 pt-1 text-xs text-muted">
            <Check className="size-3.5" aria-hidden /> In your library
          </p>
        ) : (
          <button type="button" className="btn-secondary mt-1 min-h-8 w-full px-2 text-xs" disabled={disabled} onClick={onAdd} aria-label={`Add ${t.title} to my list`}>
            <Plus className="size-3.5" aria-hidden /> Add to my list
          </button>
        )}
      </div>
    </motion.li>
  )
}
