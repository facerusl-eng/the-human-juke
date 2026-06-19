/**
 * Keep-warm endpoint — called by Vercel cron every 5 minutes.
 * Runs a minimal read against Supabase so the DB project never goes cold
 * before a gig starts.
 */

const ALLOWED_ORIGINS = [
  'https://www.the-human-jukebox.org',
  'https://the-human-jukebox.org',
  'https://the-human-juke.vercel.app',
  'https://tauri.localhost',
  'tauri://localhost',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

function getRequestOrigin(req) {
  const rawOrigin = req.headers?.origin

  if (Array.isArray(rawOrigin)) {
    return String(rawOrigin[0] ?? '').trim()
  }

  return typeof rawOrigin === 'string' ? rawOrigin.trim() : ''
}

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function applyCorsHeaders(res, origin) {
  Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
    res.setHeader(key, value)
  })
}

export default async function handler(req, res) {
  const origin = getRequestOrigin(req)
  applyCorsHeaders(res, origin)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  // Only allow GET (cron) and HEAD requests.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || ''
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() || ''
  const supabasePublishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''
  const publishableKey = supabaseAnonKey || supabasePublishableKey

  if (!supabaseUrl || !publishableKey) {
    res.status(500).json({ error: 'Supabase env vars not configured' })
    return
  }

  const pingUrl = `${supabaseUrl}/rest/v1/events?select=id&limit=1`

  try {
    const startMs = Date.now()

    const response = await fetch(pingUrl, {
      method: 'GET',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        Accept: 'application/json',
      },
    })

    const durationMs = Date.now() - startMs

    if (!response.ok) {
      res.status(502).json({ ok: false, status: response.status, durationMs })
      return
    }

    res.status(200).json({ ok: true, durationMs, ts: new Date().toISOString() })
  } catch (error) {
    res.status(502).json({ ok: false, error: String(error) })
  }
}
