/**
 * Vercel function: forwards the app's TMDB reads with the server's key (env TMDB_API_KEY), so the key never reaches the browser.
 * Called as /api/tmdb?path=<TMDB v3 path + query>. Only the endpoints the app uses are allowed.
 */
const ALLOWED = /^(search\/multi|trending\/movie\/week|discover\/movie|(movie|tv)\/\d{1,10}(\/recommendations)?)$/
const ALLOWED_PARAMS = ['query', 'include_adult', 'page', 'sort_by', 'with_genres']
const MAX_QUERY = 200

export async function GET(req: Request): Promise<Response> {
  // Other websites can't spend the shared key. A script can fake this, so the Vercel Firewall limits those.
  if (req.headers.get('Sec-Fetch-Site') === 'cross-site') return Response.json({ error: 'Not allowed.' }, { status: 403 })
  const key = process.env.TMDB_API_KEY
  if (!key) return Response.json({ error: 'TMDB_API_KEY is not set on the server.' }, { status: 503 })
  const outer = new URL(req.url).searchParams
  const raw = outer.get('path') ?? ''
  const q = raw.indexOf('?')
  const path = q < 0 ? raw : raw.slice(0, q)
  if (!ALLOWED.test(path) || [...outer.keys()].some((k) => k !== 'path')) return Response.json({ error: 'Not allowed.' }, { status: 400 })
  const params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1))
  // Extra or made-up parameters would each miss the CDN cache and use up the key's rate limit.
  if ([...params.keys()].some((k) => !ALLOWED_PARAMS.includes(k)) || (params.get('query') ?? '').length > MAX_QUERY) return Response.json({ error: 'Not allowed.' }, { status: 400 })
  // Long JWT-style tokens are "API Read Access Tokens" (Bearer); short ones are v3 API keys.
  const bearer = key.length > 40
  if (bearer) params.delete('api_key')
  else params.set('api_key', key)
  let res: Response
  try {
    res = await fetch(`https://api.themoviedb.org/3/${path}?${params}`, {
      headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    // Never echo the upstream error: its message can include the request URL, and with it the key.
    return Response.json({ error: 'TMDB could not be reached.' }, { status: 502 })
  }
  const retryAfter = res.headers.get('Retry-After')
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      // Public catalogue data: let Vercel's CDN share answers between users to stay well under TMDB's rate limit.
      ...(res.ok ? { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } : {}),
      ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
    },
  })
}
