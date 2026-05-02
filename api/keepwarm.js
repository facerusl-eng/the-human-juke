/**
 * Keep-warm endpoint — called by Vercel cron every 5 minutes.
 * Runs a minimal read against Supabase so the DB project never goes cold
 * before a gig starts.
 */

export default async function handler(req, res) {
  // Only allow GET (cron) and HEAD requests.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || ''
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''

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
