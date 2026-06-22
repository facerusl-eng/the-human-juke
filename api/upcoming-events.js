const ALLOWED_ORIGINS = [
  'https://www.the-human-jukebox.org',
  'https://the-human-jukebox.org',
  'https://the-human-juke.vercel.app',
]

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function setNoStoreHeaders(res) {
  // Some mobile stacks (including Safari/WebKit paths) respect legacy cache headers.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Surrogate-Control', 'no-store')
}

function normalizeTodayIso(rawToday) {
  const trimmed = String(rawToday || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  return new Date().toISOString().slice(0, 10)
}

function buildEventsUrl(supabaseUrl, selectColumns, todayIso) {
  const url = new URL('/rest/v1/events', supabaseUrl)
  url.searchParams.set('select', selectColumns)
  url.searchParams.set('or', `(gig_date.gte.${todayIso},gig_date.is.null)`)
  // Show events explicitly enabled for no-live audience mode, plus legacy rows where the flag is null.
  url.searchParams.set('show_in_audience_no_gig', 'not.eq.false')
  url.searchParams.set('order', 'gig_date.asc.nullslast,gig_start_time.asc.nullslast,created_at.asc')
  url.searchParams.set('limit', '50')

  return url.toString()
}

async function fetchEventRows({ supabaseUrl, publishableKey, todayIso }) {
  const selectColumns = 'id,name,venue,gig_date,gig_start_time,gig_end_time,event_type,karafun_url'
  const requestUrl = buildEventsUrl(supabaseUrl, selectColumns, todayIso)

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`upcoming-events api fetch failed (${response.status}): ${message.slice(0, 120)}`)
  }

  const payload = await response.json().catch(() => [])
  return Array.isArray(payload) ? payload : []
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''

  if (req.method === 'OPTIONS') {
    return res.status(204).set(corsHeaders(origin)).end()
  }

  Object.entries(corsHeaders(origin)).forEach(([key, value]) => res.setHeader(key, value))

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || ''
  const publishableKey = process.env.VITE_SUPABASE_ANON_KEY?.trim()
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
    || ''

  if (!supabaseUrl || !publishableKey) {
    return res.status(500).json({ success: false, message: 'Supabase configuration missing' })
  }

  const todayIso = normalizeTodayIso(req.query?.today)

  try {
    const rows = await fetchEventRows({
      supabaseUrl,
      publishableKey,
      todayIso,
    })

    const mappedRows = rows.map((eventRow) => ({
      ...eventRow,
      cover_image_url: null,
      event_theme: null,
    }))

    setNoStoreHeaders(res)
    return res.status(200).json({ success: true, rows: mappedRows })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to load upcoming events',
      rows: [],
    })
  }
}
