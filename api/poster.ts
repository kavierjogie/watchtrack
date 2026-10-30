/**
 * Vercel function: passes on Kitsu poster images, because media.kitsu.app sends no CORS headers and the app couldn't
 * otherwise save them for offline use. Called as /api/poster?url=<image URL>. Only that host is allowed, so this can't
 * be used to fetch anything else.
 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
/** Under Vercel's 4.5 MB response limit. */
const MAX_BYTES = 4 * 1024 * 1024

function kitsuImageUrl(raw: string | null): string | null {
  try {
    const url = new URL(raw ?? '')
    return url.protocol === 'https:' && url.hostname === 'media.kitsu.app' && !url.port && !url.username && !url.password ? url.href : null
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
  let body: ArrayBuffer
  let type: string
  try {
    // redirect: 'error' so an allowed address can't lead the server somewhere else. The timeout also covers reading the body.
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) })
    if (res.status === 404) return fail(404, 'Image not available.', 'upstream-404', url, { 'Cache-Control': 'public, max-age=0, s-maxage=3600' })
    if (!res.ok) return fail(502, 'Image not available.', `upstream-${res.status}`, url)
    type = res.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? ''
    if (!ALLOWED_TYPES.includes(type)) return fail(502, 'Not an image.', 'not-an-image', url)
    if (Number(res.headers.get('Content-Length')) > MAX_BYTES) return fail(502, 'Image too large.', 'too-large', url)
    body = await res.arrayBuffer()
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') return fail(504, 'Kitsu took too long.', 'timeout', url)
    return fail(502, 'Kitsu could not be reached.', 'unreachable', url)
  }
  if (body.byteLength > MAX_BYTES) return fail(502, 'Image too large.', 'too-large', url)
  return new Response(body, {
    headers: {
      'Content-Type': type,
      // Public artwork whose address changes with its content: let Vercel's CDN answer repeat requests.
      'Cache-Control': 'public, max-age=86400, s-maxage=2592000',
    },
  })
}
