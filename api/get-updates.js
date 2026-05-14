const RESEND_API_URL = 'https://api.resend.com/emails'

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

function buildEmailHtml(bookingUrl) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a44;">
      <h2 style="margin-bottom: 8px;">Thanks for your interest in The Human Jukebox</h2>
      <p style="margin-top: 0;">Here is a quick overview of the concept and how booking works.</p>

      <h3 style="margin-bottom: 6px;">How the concept works</h3>
      <ul style="padding-left: 18px; margin-top: 0;">
        <li>Guests scan a QR and join instantly from any phone.</li>
        <li>They request songs and vote live, so the room shapes the setlist together.</li>
        <li>A shared live screen keeps everyone engaged with now playing and queue updates.</li>
      </ul>

      <h3 style="margin-bottom: 6px;">Why venues use it</h3>
      <ul style="padding-left: 18px; margin-top: 0;">
        <li>No app friction for guests.</li>
        <li>Simple operation for staff during service.</li>
        <li>Interactive nights that keep momentum high.</li>
      </ul>

      <p>
        Ready to plan your date?
        <a href="${bookingUrl}" style="color: #0b63ce; font-weight: 700;">Book the show here</a>.
      </p>

      <p style="font-size: 13px; color: #57607a;">You received this because you requested availability updates on the Human Jukebox website.</p>
    </div>
  `
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''

  if (req.method === 'OPTIONS') {
    return res.status(204).set(corsHeaders(origin)).end()
  }

  Object.entries(corsHeaders(origin)).forEach(([key, value]) => res.setHeader(key, value))

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' })
  }

  const body = parseJsonBody(req.body)
  if (!body) {
    return res.status(400).json({ success: false, message: 'Invalid JSON body' })
  }

  const toEmail = String(body.email || '').trim().toLowerCase()
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailPattern.test(toEmail)) {
    return res.status(400).json({ success: false, message: 'A valid email is required.' })
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ''
  const fromEmail = process.env.UPDATES_EMAIL_FROM?.trim() || 'The Human Jukebox <noreply@the-human-jukebox.org>'
  const bookingUrl = process.env.VITE_BOOKING_URL?.trim() || 'https://book-jukebox.base44.app/'

  if (!resendApiKey) {
    return res.status(500).json({ success: false, message: 'Email service is not configured.' })
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: 'Your Human Jukebox concept and booking info',
        html: buildEmailHtml(bookingUrl),
      }),
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      const errorText = errorBody?.message || errorBody?.name || JSON.stringify(errorBody) || ''
      console.error('Resend error', response.status, errorBody)
      return res.status(502).json({
        success: false,
        message: `Email could not be sent: ${errorText || response.status}`,
        details: errorBody,
      })
    }

    return res.status(200).json({ success: true, message: 'Update email sent.' })
  } catch (error) {
    console.error('get-updates error', error)
    return res.status(500).json({ success: false, message: 'Could not send update email.' })
  }
}