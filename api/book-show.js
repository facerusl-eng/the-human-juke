const RESEND_API_URL = 'https://api.resend.com/emails'

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function validate(payload) {
  const requiredFields = [
    'venueName',
    'venueAddress',
    'contactPersonName',
    'email',
    'phoneNumber',
    'preferredDate',
    'preferredStartTime',
    'eventType',
    'estimatedGuests',
    'frequency',
  ]

  for (const field of requiredFields) {
    const value = payload[field]

    if (value === undefined || value === null || String(value).trim() === '') {
      return `Missing required field: ${field}`
    }
  }

  if (payload.authorized !== true) {
    return 'Authorization confirmation is required.'
  }

  return null
}

function buildEmailHtml(payload) {
  const additionalMessage = payload.additionalMessage ? escapeHtml(payload.additionalMessage) : 'No additional message provided.'

  return `
    <h2>New Book Show Request</h2>
    <p><strong>Venue name:</strong> ${escapeHtml(payload.venueName)}</p>
    <p><strong>Venue address:</strong> ${escapeHtml(payload.venueAddress)}</p>
    <p><strong>Contact person name:</strong> ${escapeHtml(payload.contactPersonName)}</p>
    <p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
    <p><strong>Phone number:</strong> ${escapeHtml(payload.phoneNumber)}</p>
    <p><strong>Preferred date:</strong> ${escapeHtml(payload.preferredDate)}</p>
    <p><strong>Preferred start time:</strong> ${escapeHtml(payload.preferredStartTime)}</p>
    <p><strong>Type of event:</strong> ${escapeHtml(payload.eventType)}</p>
    <p><strong>Estimated number of guests:</strong> ${escapeHtml(payload.estimatedGuests)}</p>
    <p><strong>Frequency:</strong> ${escapeHtml(payload.frequency)}</p>
    <p><strong>Authorized to book:</strong> Yes</p>
    <p><strong>Additional message:</strong></p>
    <p>${additionalMessage.replace(/\n/g, '<br />')}</p>
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

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ''
  const toEmail = process.env.BOOKING_TO_EMAIL?.trim() || ''
  const fromEmail = process.env.BOOKING_FROM_EMAIL?.trim() || 'The Human Jukebox <onboarding@resend.dev>'

  if (!resendApiKey || !toEmail) {
    res.status(500).json({ error: 'Booking email service is not configured yet.' })
    return
  }

  const payload = toJsonBody(req.body)
  const validationError = validate(payload)

  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }

  try {
    const emailResponse = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: payload.email,
        subject: `New booking request from ${payload.venueName}`,
        html: buildEmailHtml(payload),
      }),
    })

    const emailPayload = await emailResponse.json().catch(() => ({}))

    if (!emailResponse.ok) {
      const resendError = typeof emailPayload?.message === 'string'
        ? emailPayload.message
        : 'Failed to send booking request email.'
      throw new Error(resendError)
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send booking request email.'
    res.status(500).json({ error: message })
  }
}