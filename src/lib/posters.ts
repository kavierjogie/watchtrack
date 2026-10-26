import { fetchPosterUrl, isHttpUrl } from './metadata'
import type { MetadataSource, Poster, Title } from './types'

export const MAX_POSTER_URL = 2000

/**
 * The URL a poster can be shown from on any device: the remote URL, or where a local copy was downloaded from.
 * Null for uploaded files and anything that isn't plain http(s).
 */
export function publicPosterUrl(p: Poster | null): string | null {
  const url = p?.kind === 'remote' ? p.url : p?.url
  return isHttpUrl(url) && url.length <= MAX_POSTER_URL ? url : null
}

// One lookup per title per session, however many cards show it or how often they render.
const lookups = new Map<string, Promise<string | null>>()

/** Look a poster up by provider id (never by name). Null when there's none or the provider can't be reached. */
export function recoverPosterUrl(source: Pick<MetadataSource, 'provider' | 'id'>, title: string): Promise<string | null> {
  const key = `${source.provider}:${source.id}`
  let p = lookups.get(key)
  if (!p) {
    p = fetchPosterUrl(source).then(
      (url) => {
        if (!url) logPosterIssue(title, source.provider, null, 'provider has no poster for this id')
        return url
      },
      (err: unknown) => {
        logPosterIssue(title, source.provider, null, err instanceof Error ? err.message : 'lookup failed')
        return null
      },
    )
    lookups.set(key, p)
  }
  return p
}

/**
 * Local copies saved before their source URL was kept have nothing a share link can carry.
 * Find their URL by provider id; returns the same objects for titles that needed nothing.
 */
export function withPublicPosters(titles: Title[]): Promise<Title[]> {
  return Promise.all(
    titles.map(async (t) => {
      if (t.poster?.kind !== 'local' || publicPosterUrl(t.poster) || !t.source) return t
      const url = await recoverPosterUrl(t.source, t.title)
      return url ? { ...t, poster: { ...t.poster, url } } : t
    }),
  )
}

const logged = new Set<string>()

/** Dev-only, once per title+reason. Title, provider and image URL only — nothing personal. */
export function logPosterIssue(title: string, provider: string | undefined, url: string | null, reason: string) {
  if (!import.meta.env.DEV) return
  const key = `${title}|${url}|${reason}`
  if (logged.has(key)) return
  logged.add(key)
  console.warn('[WatchTrack poster]', { title, provider: provider ?? 'none', url: url?.startsWith('blob:') ? '(local copy)' : url, reason })
}
