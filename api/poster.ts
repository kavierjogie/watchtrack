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

export async function GET(req: Request): Promise<Response> {
  if (req.headers.get('Sec-Fetch-Site') === 'cross-site') return Response.json({ error: 'Not allowed.' }, { status: 403 })
  const url = kitsuImageUrl(new URL(req.url).searchParams.get('url'))
  if (!url) return Response.json({ error: 'Not allowed.' }, { status: 400 })
  let res: Response
  try {
    // redirect: 'error' so an allowed address can't lead the server somewhere else.
    res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) })
  } catch {
    return Response.json({ error: 'Kitsu could not be reached.' }, { status: 502 })
  }
  if (!res.ok) return Response.json({ error: 'Image not available.' }, { status: res.status === 404 ? 404 : 502 })
  const type = res.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (!ALLOWED_TYPES.includes(type)) return Response.json({ error: 'Not an image.' }, { status: 502 })
  if (Number(res.headers.get('Content-Length')) > MAX_BYTES) return Response.json({ error: 'Image too large.' }, { status: 502 })
  const body = await res.arrayBuffer()
  if (body.byteLength > MAX_BYTES) return Response.json({ error: 'Image too large.' }, { status: 502 })
  return new Response(body, {
    headers: {
      'Content-Type': type,
      // Public artwork whose address changes with its content: let Vercel's CDN answer repeat requests.
      'Cache-Control': 'public, max-age=86400, s-maxage=2592000',
    },
  })
}
