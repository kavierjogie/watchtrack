/**
 * Vercel function: the Google OAuth token exchange for Drive sync. Google needs the client secret for it, so it can't
 * happen in the browser. Stateless: tokens are passed straight back and never stored or logged here.
 *   POST { code, verifier, redirect_uri }  → first connect (PKCE authorization code)
 *   POST { refresh_token }                 → a fresh access token
 * Env: VITE_GOOGLE_CLIENT_ID (public, also used by the app) and GOOGLE_CLIENT_SECRET (server only).
 */
const str = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

export async function POST(req: Request): Promise<Response> {
  // Only this site's pages. Stops other websites using this endpoint; a script can fake the header, so the Vercel Firewall limits those.
  if (req.headers.get('Origin') !== new URL(req.url).origin) return Response.json({ error: 'Not allowed.' }, { status: 403 })
  const id = process.env.VITE_GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) return Response.json({ error: 'Google Drive sync is not configured on the server.' }, { status: 503 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Bad request.' }, { status: 400 })
  }

  const params = new URLSearchParams({ client_id: id, client_secret: secret })
  if (str(body?.code) && str(body.verifier, 128) && str(body.redirect_uri)) {
    // Only this site's own settings page may receive the code.
    if (body.redirect_uri !== `${new URL(req.url).origin}/settings`) return Response.json({ error: 'Bad request.' }, { status: 400 })
    params.set('grant_type', 'authorization_code')
    params.set('code', body.code)
    params.set('code_verifier', body.verifier)
    params.set('redirect_uri', body.redirect_uri)
  } else if (str(body?.refresh_token)) {
    params.set('grant_type', 'refresh_token')
    params.set('refresh_token', body.refresh_token)
  } else return Response.json({ error: 'Bad request.' }, { status: 400 })

  let res: Response
  try {
    res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params, signal: AbortSignal.timeout(8000) })
  } catch {
    return Response.json({ error: 'Google could not be reached.' }, { status: 502 })
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const noStore = { 'Cache-Control': 'no-store' }
  if (!res.ok) {
    // invalid_grant = revoked or expired: the app asks the user to connect again. Nothing else is echoed.
    return Response.json({ error: data.error === 'invalid_grant' ? 'invalid_grant' : 'Google refused the request.' }, { status: res.status < 500 ? 400 : 502, headers: noStore })
  }
  return Response.json({ access_token: data.access_token, expires_in: data.expires_in, refresh_token: data.refresh_token }, { headers: noStore })
}
