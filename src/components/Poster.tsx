import { Clapperboard, Film, Tv } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getImage } from '../lib/db'
import type { MediaType, Poster as PosterRef } from '../lib/types'

// Object URLs for locally stored posters, shared across the app for its lifetime.
const urlCache = new Map<string, Promise<string | null>>()

function localUrl(imageId: string): Promise<string | null> {
  let p = urlCache.get(imageId)
  if (!p) {
    p = getImage(imageId).then((img) => (img ? URL.createObjectURL(img.blob) : null))
    urlCache.set(imageId, p)
  }
  return p
}

export function usePosterUrl(poster: PosterRef | null): string | null {
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

  if (poster?.kind === 'remote') return poster.url
  return imageId && local?.id === imageId ? local.url : null
}

const ICON: Record<MediaType, typeof Tv> = { anime: Clapperboard, tv: Tv, movie: Film }

export function Poster({
  poster,
  title,
  mediaType,
  className = '',
}: {
  poster: PosterRef | null
  title: string
  mediaType: MediaType
  className?: string
}) {
  const url = usePosterUrl(poster)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = !!url && failedUrl === url
  const Icon = ICON[mediaType]

  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-2 ${className}`}>
      {url && !failed ? (
        <img
          src={url}
          alt={`${title} poster`}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
          className="size-full object-cover"
        />
      ) : (
        // No artwork: a neutral placeholder with the title, never an unrelated image.
        <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-muted">
          <Icon className="size-7 opacity-60" aria-hidden />
          <span className="line-clamp-3 text-xs font-medium">{title}</span>
        </div>
      )}
    </div>
  )
}
