const DEFAULT_WEBHOOK_URL = process.env.BOOKING_WEBHOOK_URL?.trim() || 'https://preview--book-jukebox.base44.app/api/webhook/receiveExternalBooking'
const FALLBACK_WEBHOOK_URLS = [
  'https://book-jukebox.base44.app/api/webhook/receiveExternalBooking',
]

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

function parseJsonBody(reqBody) {
  if (!reqBody) {
    return null
  }

  if (typeof reqBody === 'string') {
    try {
      return JSON.parse(reqBody)
    } catch {
      return null
    }
  }

  return reqBody
}

function buildWebhookTargets(primaryUrl) {
  const targets = [String(primaryUrl || '').trim(), ...FALLBACK_WEBHOOK_URLS]
  return [...new Set(targets.filter(Boolean))]
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

  const body = parseJsonBody(req.body)
  if (!body) {
    return res.status(400).json({ success: false, message: 'Invalid JSON body' })
  }

  const webhookTargets = buildWebhookTargets(DEFAULT_WEBHOOK_URL)
  const booking = body.booking || body

  const venueName = String(booking.venue_name || '').trim()
  const date = String(booking.date || '').trim()
  const gigType = String(booking.gig_type || '').trim()
  const notes = String(booking.notes || '').trim()
  const externalContactEmail = String(booking.contact_email || booking.external_contact_email || '').trim()
  const fee = booking.requested_fee ?? booking.fee

  if (webhookTargets.length === 0) {
    return res.status(400).json({ success: false, message: 'Webhook URL is required.' })
  }

  if (!venueName) {
    return res.status(400).json({ success: false, message: 'venue_name is required.' })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD.' })
  }

  if (!['afternoon', 'evening', 'both'].includes(gigType)) {
    return res.status(400).json({ success: false, message: 'gig_type must be afternoon, evening, or both.' })
  }

  if (!externalContactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(externalContactEmail)) {
    return res.status(400).json({ success: false, message: 'external_contact_email is required and must be valid.' })
  }

  if (fee !== undefined && fee !== null && Number.isNaN(Number(fee))) {
    return res.status(400).json({ success: false, message: 'fee must be a number when provided.' })
  }

  const payload = {
    venue_name: venueName,
    date,
    gig_type: gigType,
    requested_fee: fee === undefined || fee === null || fee === '' ? undefined : Number(fee),
    contact_email: externalContactEmail,
    notes: notes || undefined,
  }

  const failures = []

  for (const target of webhookTargets) {
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '')
        failures.push({ target, status: response.status, details: bodyText.slice(0, 500) })
        continue
      }

      const upstream = await response.json().catch(() => ({}))

      return res.status(200).json({
        success: true,
        gig_id: upstream?.gig_id || '',
        message: upstream?.message || 'Booking received',
        routed_to: target,
      })
    } catch (error) {
      failures.push({ target, status: 0, details: error instanceof Error ? error.message : 'Network error' })
    }
  }

  console.error('book-show error', { message: 'All external webhooks failed', failures })
  return res.status(502).json({
    success: false,
    message: 'External booking webhook failed',
    details: failures,
  })
}