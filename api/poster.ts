/**
 * Vercel function: passes on Kitsu poster images, because media.kitsu.app sends no CORS headers and the app couldn't
 * otherwise save them for offline use. Called as /api/poster?url=<image URL>. Only that host is allowed, so this can't
 * be used to fetch anything else.
 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
/** Under Vercel's 4.5 MB response limit. */
const MAX_BYTES = 4 * 1024 * 1024
/** A given address always holds the same image, so "too big" stays true: the CDN answers every device after the first. */
const TOO_LARGE_CACHE = { 'Cache-Control': 'public, max-age=86400, s-maxage=2592000' }
/** Same check as isKitsuOriginal in src/lib/metadata.ts. Originals average 1.1 MB and run past 4 MB, against about 50 KB for the sizes Kitsu generates. */
const isOriginal = (url: string) => !/\/(tiny|small|medium|large)[.-][^/]*$/.test(new URL(url).pathname)

function kitsuImageUrl(raw: string | null): string | null {
  try {
    const url = new URL(raw ?? '')
    // Image paths only, and at most Kitsu's own numeric version (?1597604210): anything else could make up endless addresses to get past the CDN's cache.
    const image = /^\/anime\/[\w./-]+\.(jpe?g|png|webp|gif|avif)$/i.test(url.pathname) && !url.pathname.includes('..') && /^(\?\d+)?$/.test(url.search)
    return url.protocol === 'https:' && url.hostname === 'media.kitsu.app' && !url.port && !url.username && !url.password && image ? url.href : null
  } catch {
    return null
  }
}

/** A refusal, with its reason in the function logs. `url` is only ever an allowed one, never what the caller sent. */
function fail(status: number, error: string, reason: string, url?: string, headers?: Record<string, string>): Response {
  console.warn(JSON.stringify({ poster: reason, status, url }))
  return Response.json({ error }, { status, headers })
}

export async function GET(req: Request): Promise<Response> {
  if (req.headers.get('Sec-Fetch-Site') === 'cross-site') return fail(403, 'Not allowed.', 'cross-site')
  const url = kitsuImageUrl(new URL(req.url).searchParams.get('url'))
  if (!url) return fail(400, 'Not allowed.', 'bad-url')
  // No app card needs one, so don't relay it. The client then looks up the current size by provider id.
  if (isOriginal(url)) return fail(413, 'Image too large.', 'original', url, TOO_LARGE_CACHE)
  let body: ArrayBuffer
  let type: string
  try {
    // redirect: 'error' so an allowed address can't lead the server somewhere else. The timeout also covers reading the body.
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) })
    if (res.status === 404) return fail(404, 'Image not available.', 'upstream-404', url, { 'Cache-Control': 'public, max-age=0, s-maxage=3600' })
    if (!res.ok) return fail(502, 'Image not available.', `upstream-${res.status}`, url)
    type = res.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? ''
    if (!ALLOWED_TYPES.includes(type)) return fail(502, 'Not an image.', 'not-an-image', url)
    if (Number(res.headers.get('Content-Length')) > MAX_BYTES) {
      await res.body?.cancel() // Stop the download rather than leave it running.
      return fail(413, 'Image too large.', 'too-large', url, TOO_LARGE_CACHE)
    }
    body = await res.arrayBuffer()
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') return fail(504, 'Kitsu took too long.', 'timeout', url)
    return fail(502, 'Kitsu could not be reached.', 'unreachable', url)
  }
  if (body.byteLength > MAX_BYTES) return fail(413, 'Image too large.', 'too-large', url, TOO_LARGE_CACHE)
  return new Response(body, {
    headers: {
      'Content-Type': type,
      // Public artwork whose address changes with its content: let Vercel's CDN and the browser answer repeat requests.
      'Cache-Control': 'public, max-age=2592000, s-maxage=2592000',
    },
  })
}
