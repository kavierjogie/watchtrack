import { Clapperboard, Film, Tv } from 'lucide-react'
import { useEffect, useReducer, useState } from 'react'
import { getImage } from '../lib/db'
import { logPosterIssue, publicPosterUrl, recoverPosterUrl } from '../lib/posters'
import type { MediaType, MetadataSource, Poster as PosterRef } from '../lib/types'

// Object URLs for locally stored posters, shared across the app for its lifetime.
const urlCache = new Map<string, Promise<string | null>>()

function localUrl(imageId: string): Promise<string | null> {
  let p = urlCache.get(imageId)
  if (!p) {
    p = getImage(imageId).then(
      (img) => (img ? URL.createObjectURL(img.blob) : null),
      () => null,
    )
    urlCache.set(imageId, p)
  }
  return p
}

/** Object URL of a locally stored poster. undefined while it's still being read; null when there's none. */
function useLocalUrl(poster: PosterRef | null): string | null | undefined {
  const imageId = poster?.kind === 'local' ? poster.imageId : null
  const [local, setLocal] = useState<{ id: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!imageId) return
    let alive = true
    void localUrl(imageId).then((url) => alive && setLocal({ id: imageId, url }))
    return () => {
      alive = false
    }
  }, [imageId])

  if (!imageId) return null
  return local?.id === imageId ? local.url : undefined
}

/** Best URL to show a poster from: the local copy, else the URL it came from (e.g. a restored backup without its images). */
export function usePosterUrl(poster: PosterRef | null): string | null {
  const local = useLocalUrl(poster)
  if (local === undefined) return null
  return local ?? (poster?.kind === 'remote' ? poster.url || null : publicPosterUrl(poster))
}

// URLs that failed to load this session, so no card — or re-render — requests them again.
const failedUrls = new Set<string>()

const ICON: Record<MediaType, typeof Tv> = { anime: Clapperboard, tv: Tv, movie: Film }

/**
 * Tries, in order: the local copy, the poster's URL, then (only if those are missing or fail) a lookup by the
 * title's provider id. Each step is tried once; when all fail it shows the title placeholder.
 */
export function Poster({
  poster,
  title,
  mediaType,
  source = null,
  className = '',
}: {
  poster: PosterRef | null
  title: string
  mediaType: MediaType
  /** Where to look the poster up if it's missing or broken. Ignored when there's no poster at all (it may have been removed on purpose). */
  source?: Pick<MetadataSource, 'provider' | 'id'> | null
  className?: string
}) {
  const local = useLocalUrl(poster)
  const own = poster?.kind === 'remote' ? poster.url : (poster?.url ?? null)
  const sourceKey = source ? `${source.provider}:${source.id}` : null
  const [recovered, setRecovered] = useState<{ key: string; url: string | null } | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  const recoveredUrl = recovered?.key === sourceKey ? recovered.url : null
  const url = [local, own, recoveredUrl].find((u): u is string => !!u && !failedUrls.has(u)) ?? null
  const recover = !url && local !== undefined && poster !== null && !!source && recovered?.key !== sourceKey

  useEffect(() => {
    if (!recover || !source || !sourceKey) return
    let alive = true
    void recoverPosterUrl(source, title).then((u) => alive && setRecovered({ key: sourceKey, url: u }))
    return () => {
      alive = false
    }
  }, [recover, source, sourceKey, title])

  const Icon = ICON[mediaType]
  const waiting = local === undefined || recover || (!!url && loaded !== url)

  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-2 ring-1 ring-inset ring-white/5 ${waiting ? 'animate-pulse' : ''} ${className}`}>
      {url ? (
        <img
          key={url}
          src={url}
          alt={`${title} poster`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(url)}
          onError={() => {
            failedUrls.add(url)
            logPosterIssue(title, source?.provider, url, 'image failed to load (404/403, blocked, invalid or host unreachable)')
            rerender()
          }}
          className={`size-full object-cover transition-[opacity,scale] duration-300 ${loaded === url ? 'opacity-100' : 'opacity-0'}`}
        />
      ) : (
        !waiting && (
          // No artwork: a neutral placeholder with the title, never an unrelated image.
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-[radial-gradient(130%_70%_at_50%_0%,var(--glow),transparent_70%)] p-3 text-center text-muted">
            <Icon className="size-6 text-accent-text/70" aria-hidden />
            <span className="line-clamp-3 max-w-full text-xs font-semibold text-fg/75 wrap-anywhere">{title}</span>
          </div>
        )
      )}
    </div>
  )
}
