const EXTERNAL_BOOKING_WEBHOOK_URL = 'https://preview--book-jukebox.base44.app/api/webhook/receiveExternalBooking'

const EXTERNAL_BOOKING_PAYLOAD = {
  venue_name: 'The Blue Note',
  date: '2026-05-20',
  gig_type: 'evening',
  requested_fee: 1500,
  contact_email: 'manager@bluenoote.dk',
  notes: 'Special requests here',
}

const ALLOWED_ORIGINS = [
  'https://www.the-human-jukebox.org',
  'https://the-human-jukebox.org',
  'https://the-human-juke.vercel.app',
]

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''

  if (req.method === 'OPTIONS') {
    return res.status(204).set(corsHeaders(origin)).end()
  }

  Object.entries(corsHeaders(origin)).forEach(([key, value]) => res.setHeader(key, value))

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const response = await fetch(EXTERNAL_BOOKING_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(EXTERNAL_BOOKING_PAYLOAD),
    })

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      return res.status(502).json({
        error: 'External booking webhook failed',
        status: response.status,
        details: bodyText.slice(0, 500),
      })
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('book-show error', error)
    return res.status(500).json({ error: 'Booking request failed' })
  }
}