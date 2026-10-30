/**
 * Vercel function: forwards the app's TMDB reads with the server's token (env TMDB_API_KEY), so it never reaches the browser.
 * Called as /api/tmdb?path=<TMDB v3 path + query>. Only the exact requests the app makes are allowed: one spelling per
 * request, so every user shares one CDN entry and made-up variations can't get past the cache to spend the shared token.
 * Per-IP limits live in the Vercel Firewall, which runs in front of this.
 */
const MAX_QUERY = 200
const MAX_PAGE = 500
const TIMEOUT_MS = 5000
const DEFAULT_PAUSE_S = 10
const MAX_PAUSE_S = 60
const HOUR = 3600
const DAY = 24 * HOUR
/** discover/movie genres the app can ask for (TMDB_MOVIE_GENRE_ID in src/lib/discover.ts). */
const MOVIE_GENRES = new Set(['12', '14', '16', '18', '27', '28', '35', '36', '37', '53', '80', '99', '878', '9648', '10402', '10749', '10751', '10752', '10770'])

const SHORT = { fresh: 6 * HOUR, stale: DAY }
const LONG = { fresh: DAY, stale: 7 * DAY }

/** The one allowed spelling of a request and how long the CDN keeps it, or null if the app never sends it. */
function route(raw: string): { url: string; cache: { fresh: number; stale: number } } | null {
  const q = raw.indexOf('?')
  const path = q < 0 ? raw : raw.slice(0, q)
  const params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1))
  if (path === 'search/multi') {
    const query = params.get('query') ?? ''
    // Same normalising as searchTmdb in src/lib/metadata.ts. A different spelling is refused below, not silently fixed, as it would still be a separate CDN entry.
    if (query !== query.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ') || /\p{Cc}/u.test(query) || query.length < 2 || query.length > MAX_QUERY) return null
    return { url: `search/multi?include_adult=false&query=${encodeURIComponent(query)}`, cache: SHORT }
  }
  if (path === 'discover/movie') {
    const page = Number(params.get('page'))
    const genre = params.get('with_genres') ?? ''
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE || !MOVIE_GENRES.has(genre)) return null
    return { url: `discover/movie?sort_by=vote_count.desc&with_genres=${genre}&page=${page}`, cache: LONG }
  }
  if (path === 'trending/movie/week') return { url: path, cache: SHORT }
  const m = /^(movie|tv)\/[1-9]\d{0,9}(\/recommendations)?$/.exec(path)
  return m ? { url: path, cache: m[2] ? LONG : SHORT } : null
}

const fail = (status: number, error: string, retryAfter?: number) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } })

const cached = (body: ReadableStream | string | null, status: number, fresh: number, stale: number) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      // A short browser cache, so retyping a search doesn't touch the network at all.
      'Cache-Control': 'public, max-age=300',
      // Public catalogue data: let Vercel's CDN share answers between users to stay well under TMDB's rate limit.
      'Vercel-CDN-Cache-Control': `s-maxage=${fresh}${stale ? `, stale-while-revalidate=${stale}` : ''}`,
    },
  })

// TMDB said to slow down: this instance stops calling it for a moment. Per instance, so it softens a spike rather than enforcing a limit.
let pausedUntil = 0

export async function GET(req: Request): Promise<Response> {
  // Other websites can't spend the token. A script can fake this, so the Vercel Firewall limits those. Allowed when missing, as Safari before 16.4 doesn't send it.
  const site = req.headers.get('Sec-Fetch-Site')
  if (site && site !== 'same-origin') return fail(403, 'Not allowed.')
  const { search, searchParams } = new URL(req.url)
  const raw = searchParams.get('path') ?? ''
  const allowed = route(raw)
  if (!allowed || raw !== allowed.url || search !== `?path=${encodeURIComponent(raw)}`) return fail(400, 'Not allowed.')

  const key = process.env.TMDB_API_KEY
  if (!key) return fail(503, 'TMDB is not configured on the server.')
  const wait = Math.ceil((pausedUntil - Date.now()) / 1000)
  if (wait > 0) return fail(429, 'TMDB is busy. Try again shortly.', wait)

  let res: Response
  try {
    res = await fetch(`https://api.themoviedb.org/3/${allowed.url}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    // Never echo the upstream error. No retry here either: when TMDB is struggling, retries make it worse.
    return err instanceof Error && err.name === 'TimeoutError' ? fail(504, 'TMDB took too long to respond.', 5) : fail(502, 'TMDB could not be reached.')
  }
  if (res.ok) return cached(res.body, 200, allowed.cache.fresh, allowed.cache.stale)
  if (res.status === 404) return cached(JSON.stringify({ error: 'Not found.' }), 404, HOUR, 0)
  if (res.status === 429) {
    const after = Math.min(Number(res.headers.get('Retry-After')) || DEFAULT_PAUSE_S, MAX_PAUSE_S)
    pausedUntil = Date.now() + after * 1000
    return fail(429, 'TMDB is busy. Try again shortly.', after)
  }
  // Rejected token: only the owner can fix it, so it goes in the logs. No request details, as those include what users searched for.
  if (res.status === 401 || res.status === 403) console.error(`TMDB rejected the API token (${res.status}).`)
  return fail(502, 'TMDB returned an error.')
}
