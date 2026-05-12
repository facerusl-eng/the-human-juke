function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCoverUrl(value) {
  const trimmed = clean(value)
  if (!trimmed) return null
  return trimmed.replace(/^http:\/\//i, 'https://')
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS')
    res.status(204).end()
    return
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS')
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const eventId = clean(req.query?.id)
  if (!eventId) {
    res.status(400).json({ error: 'Missing event id' })
    return
  }

  const supabaseUrl = clean(process.env.VITE_SUPABASE_URL)
  const supabaseAnonKey = clean(process.env.VITE_SUPABASE_ANON_KEY)
  const supabasePublishableKey = clean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const publishableKey = supabaseAnonKey || supabasePublishableKey

  if (!supabaseUrl || !publishableKey) {
    res.status(500).json({ error: 'Supabase env vars not configured' })
    return
  }

  const apiUrl = `${supabaseUrl}/rest/v1/events?select=id,cover_image_url&id=eq.${encodeURIComponent(eventId)}&limit=1`

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      res.status(502).json({ error: 'Failed to fetch event cover' })
      return
    }

    const payload = await response.json().catch(() => [])
    const eventRow = Array.isArray(payload) ? payload[0] : null
    const coverImageUrl = normalizeCoverUrl(eventRow?.cover_image_url)

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300')
    res.status(200).json({ coverImageUrl })
  } catch {
    res.status(502).json({ error: 'Event cover lookup failed' })
  }
}
