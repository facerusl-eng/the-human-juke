const RESEND_API_URL = 'https://api.resend.com/emails'

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeString(value) {
  return String(value ?? '').trim()
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function toJsonBody(body) {
  if (!body) {
    return {}
  }

  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return {}
    }
  }

  if (typeof body === 'object') {
    return body
  }

  return {}
}

function buildEmailHtml({ venueName, senderName, conceptText }) {
  return `
    <h2>Live Music Concept for ${escapeHtml(venueName)}</h2>
    <p>Hi ${escapeHtml(venueName)} team,</p>
    <p>${escapeHtml(conceptText).replace(/\n/g, '<br />')}</p>
    <p>Best regards,<br />${escapeHtml(senderName)}</p>
    <hr />
    <p style="font-size:12px;color:#555;">Sent via The Human Jukebox Outreach Manager.</p>
  `
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS')
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const payload = toJsonBody(req.body)
  const contacts = Array.isArray(payload.contacts) ? payload.contacts : []
  const conceptText = normalizeString(payload.conceptText)
  const senderName = normalizeString(payload.senderName) || 'The Human Jukebox'
  const senderEmail = normalizeString(payload.senderEmail)

  if (!contacts.length) {
    res.status(400).json({ error: 'At least one contact is required.' })
    return
  }

  if (!conceptText) {
    res.status(400).json({ error: 'Concept text is required.' })
    return
  }

  if (!senderEmail || !isValidEmail(senderEmail)) {
    res.status(400).json({ error: 'A valid sender email is required.' })
    return
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ''
  const fromEmail = process.env.BOOKING_FROM_EMAIL?.trim() || 'The Human Jukebox <onboarding@resend.dev>'

  if (!resendApiKey) {
    res.status(500).json({ error: 'RESEND_API_KEY is not configured.' })
    return
  }

  const results = []

  for (const contact of contacts) {
    const venueName = normalizeString(contact?.venueName) || 'Venue'
    const toEmail = normalizeString(contact?.email)

    if (!isValidEmail(toEmail)) {
      results.push({
        venueName,
        email: toEmail,
        ok: false,
        error: 'Missing or invalid email address.',
      })
      continue
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
          reply_to: senderEmail,
          subject: `Live music concept for ${venueName}`,
          html: buildEmailHtml({ venueName, senderName, conceptText }),
        }),
      })

      const responsePayload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message = typeof responsePayload?.message === 'string'
          ? responsePayload.message
          : 'Failed to send email.'

        results.push({
          venueName,
          email: toEmail,
          ok: false,
          error: message,
        })
        continue
      }

      results.push({
        venueName,
        email: toEmail,
        ok: true,
      })
    } catch (error) {
      results.push({
        venueName,
        email: toEmail,
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to send email.',
      })
    }
  }

  const successCount = results.filter((result) => result.ok).length

  res.status(200).json({
    ok: successCount > 0,
    successCount,
    failureCount: results.length - successCount,
    results,
  })
}
