import { motion } from 'framer-motion'
import { Eye, LinkIcon, ListX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { EmptyState, PosterGridSkeleton, ProgressBar, progressLine, Rating, Section } from '../components/cards'
import { Poster } from '../components/Poster'
import { STATUS } from '../lib/backup'
import { progressFraction } from '../lib/progress'
import { decodeShare, sharedToTitle } from '../lib/share'
import { MEDIA_LABEL, STATUS_LABEL, type Title } from '../lib/types'

type State = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; titles: Title[] }
const LOADING: State = { state: 'loading' }

/** Read-only view of a shared list. Reads only the URL fragment; never touches the visitor's library. */
export function SharedPage() {
  const { hash } = useLocation()
  // Keyed by the fragment it came from, so pasting another link in this tab never shows the old list.
  const [result, setResult] = useState<{ hash: string; s: State } | null>(null)
  const s = result?.hash === hash ? result.s : LOADING

  useEffect(() => {
    let alive = true
    decodeShare(hash).then(
      (items) => alive && setResult({ hash, s: { state: 'ok', titles: items.map(sharedToTitle) } }),
      (err: unknown) => alive && setResult({ hash, s: { state: 'error', message: err instanceof Error ? err.message : 'The link could not be read.' } }),
    )
    return () => {
      alive = false
    }
  }, [hash])

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <Link to="/" className="flex items-center gap-2">
            <img src="/icon.svg" alt="" className="size-7" />
            <span className="font-semibold tracking-tight">WatchTrack</span>
          </Link>
          <Link to="/" className="btn-secondary min-h-9 px-3 text-xs">
            Open my WatchTrack
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Shared Watchlist</h1>
          {s.state === 'ok' && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              <Eye className="size-4 shrink-0" aria-hidden />
              {s.titles.length} title{s.titles.length === 1 ? '' : 's'} · read-only. Nothing here changes your own library.
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
                <p className="mt-2">
                  Shared links never expire — the whole list is stored inside the link itself. If it won't open, it was probably cut off when it was copied or sent. Ask
                  for the link again and paste it in full.
                </p>
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
                        <SharedCard key={i} t={t} />
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

/** Like TitleCard, but not a link and without any actions. */
function SharedCard({ t }: { t: Title }) {
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
      </div>
    </motion.li>
  )
}
