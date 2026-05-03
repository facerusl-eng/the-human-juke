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

async function saveBookingToInbox(payload, supabaseUrl, supabaseKey) {
  if (!supabaseUrl || !supabaseKey) {
    return false
  }

  await fetch(`${supabaseUrl}/rest/v1/booking_requests`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      venue_name: payload.venueName,
      venue_address: payload.venueAddress,
      contact_person_name: payload.contactPersonName,
      email: payload.email,
      phone_number: payload.phoneNumber,
      preferred_date: payload.preferredDate,
      preferred_start_time: payload.preferredStartTime,
      event_type: payload.eventType,
      estimated_guests: Number(payload.estimatedGuests),
      frequency: payload.frequency,
      additional_message: payload.additionalMessage || null,
      status: 'new',
    }),
  })

  return true
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
  const validationError = validate(payload)

  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || ''
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ''
  const toEmail = process.env.BOOKING_TO_EMAIL?.trim() || ''
  const fromEmail = process.env.BOOKING_FROM_EMAIL?.trim() || 'The Human Jukebox <onboarding@resend.dev>'

  const canSendEmail = Boolean(resendApiKey && toEmail)
  let inboxStored = false
  let emailSent = false

  try {
    try {
      inboxStored = await saveBookingToInbox(payload, supabaseUrl, supabaseKey)
    } catch {
      inboxStored = false
    }

    if (canSendEmail) {
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

        if (!inboxStored) {
          throw new Error(resendError)
        }
      } else {
        emailSent = true
      }
    }

    if (!emailSent && !inboxStored) {
      res.status(500).json({ error: 'Booking service is not configured. Set BOOKING_TO_EMAIL and RESEND_API_KEY, or configure Supabase booking inbox env vars.' })
      return
    }

    res.status(200).json({
      ok: true,
      delivery: emailSent ? 'email' : 'inbox_only',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send booking request email.'
    res.status(500).json({ error: message })
  }
}