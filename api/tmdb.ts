/**
 * Vercel function: forwards the app's TMDB reads with the server's key (env TMDB_API_KEY), so the key never reaches the browser.
 * Called as /api/tmdb?path=<TMDB v3 path + query>. Only the endpoints the app uses are allowed.
 */
const ALLOWED = /^(search\/multi|trending\/movie\/week|discover\/movie|(movie|tv)\/\d{1,10}(\/recommendations)?)$/

export async function GET(req: Request): Promise<Response> {
  const key = process.env.TMDB_API_KEY
  if (!key) return Response.json({ error: 'TMDB_API_KEY is not set on the server.' }, { status: 503 })
  const raw = new URL(req.url).searchParams.get('path') ?? ''
  const q = raw.indexOf('?')
  const path = q < 0 ? raw : raw.slice(0, q)
  if (!ALLOWED.test(path)) return Response.json({ error: 'Not allowed.' }, { status: 400 })
  const params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1))
  // Long JWT-style tokens are "API Read Access Tokens" (Bearer); short ones are v3 API keys.
  const bearer = key.length > 40
  if (!bearer) params.set('api_key', key)
  const res = await fetch(`https://api.themoviedb.org/3/${path}?${params}`, {
    headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${key}` } : {}) },
  })
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      // Public catalogue data: let Vercel's CDN share answers between users to stay well under TMDB's rate limit.
      ...(res.ok ? { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } : {}),
      ...(res.headers.get('Retry-After') ? { 'Retry-After': res.headers.get('Retry-After')! } : {}),
    },
  })
}
