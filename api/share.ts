import { createHash, randomBytes } from 'node:crypto'

/**
 * Vercel function: stores share lists so a link can be short (/s/<id>) whatever the size of the list.
 *   POST <payload>   → { id }, the same base64url payload a /shared# link carries
 *   GET ?id=<id>     → the payload, or 404 once it has expired
 * Env: KV_REST_API_URL and KV_REST_API_TOKEN (set by Vercel's Upstash integration), or UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN. Without them this answers 503 and the app falls back to a long link.
 * ponytail: the payload isn't parsed here, so junk can be stored up to the size and rate limits. Recipients validate it in
 * decodeShare, so junk only ever shows an error page. Run decodeShare here too if that's ever abused.
 */
/** Same as MAX_PAYLOAD_CHARS in src/lib/share.ts. */
const MAX_PAYLOAD_CHARS = 30_000
const TTL_SECONDS = 90 * 24 * 60 * 60
const MAX_PER_HOUR = 30
const PAYLOAD = /^[A-Za-z0-9_-]+$/
const ID = /^[A-Za-z0-9_-]{11}$/

const redisEnv = () => {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

/** Runs commands in order over Upstash's REST API and returns their results. */
async function redis(env: { url: string; token: string }, ...commands: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(`${env.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`redis-${res.status}`)
  return ((await res.json()) as { result: unknown }[]).map((r) => r.result)
}

/** Hashed so the store never holds an IP address. Vercel sets x-real-ip itself, so a caller can't choose it. */
const rateKey = (req: Request) => `share:rate:${createHash('sha256').update(req.headers.get('x-real-ip') ?? 'unknown').digest('base64url')}`

export async function POST(req: Request): Promise<Response> {
  if (req.headers.get('Origin') !== new URL(req.url).origin) return Response.json({ error: 'Not allowed.' }, { status: 403 })
  const env = redisEnv()
  if (!env) return Response.json({ error: 'Short links are not configured on the server.' }, { status: 503 })
  const payload = await req.text()
  if (payload.length > MAX_PAYLOAD_CHARS || !PAYLOAD.test(payload)) return Response.json({ error: 'Not a share list.' }, { status: 400 })
  try {
    const key = rateKey(req)
    const [count] = await redis(env, ['INCR', key], ['EXPIRE', key, 3600, 'NX'])
    if ((count as number) > MAX_PER_HOUR) return Response.json({ error: 'Too many links. Try again later.' }, { status: 429 })
    const id = randomBytes(8).toString('base64url')
    const [stored] = await redis(env, ['SET', `share:${id}`, payload, 'NX', 'EX', TTL_SECONDS])
    if (stored !== 'OK') return Response.json({ error: 'Could not store the list.' }, { status: 502 })
    return Response.json({ id }, { status: 201 })
  } catch (err) {
    console.warn(JSON.stringify({ share: 'store-failed', reason: err instanceof Error ? err.message : 'unknown' }))
    return Response.json({ error: 'Could not store the list.' }, { status: 502 })
  }
}

export async function GET(req: Request): Promise<Response> {
  if (req.headers.get('Sec-Fetch-Site') === 'cross-site') return Response.json({ error: 'Not allowed.' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !ID.test(id)) return Response.json({ error: 'Not found.' }, { status: 404 })
  const env = redisEnv()
  if (!env) return Response.json({ error: 'Short links are not configured on the server.' }, { status: 503 })
  try {
    const [payload] = await redis(env, ['GET', `share:${id}`])
    if (typeof payload !== 'string') return Response.json({ error: 'Not found.' }, { status: 404 })
    // A stored list never changes, so reloads can come from the browser. Not the CDN: it would outlive the 90 days.
    return new Response(payload, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=3600' } })
  } catch (err) {
    console.warn(JSON.stringify({ share: 'read-failed', reason: err instanceof Error ? err.message : 'unknown' }))
    return Response.json({ error: 'Could not read the list.' }, { status: 502 })
  }
}
