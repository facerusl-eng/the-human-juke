const RESEND_API_URL = 'https://api.resend.com/emails'

const ALLOWED_ORIGINS = [
  'https://www.the-human-jukebox.org',
  'https://the-human-jukebox.org',
  'https://the-human-juke.vercel.app',
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function parseResendAllowedTestRecipient(errorMessage) {
  const match = String(errorMessage || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match ? match[0].trim().toLowerCase() : ''
}

function isResendTestingRestriction(errorBody) {
  const text = `${String(errorBody?.name || '')} ${String(errorBody?.message || '')}`.toLowerCase()
  return text.includes('only send testing emails to your own email address')
}

function isResendAuthConfigurationError(errorBody) {
  const text = `${String(errorBody?.name || '')} ${String(errorBody?.message || '')}`.toLowerCase()
  return text.includes('api key is invalid')
    || text.includes('invalid api key')
    || text.includes('missing api key')
    || text.includes('unauthorized')
    || text.includes('authentication')
}

function resolveFallbackRecipient(errorBody) {
  const configuredFallback = process.env.UPDATES_FALLBACK_TO_EMAIL?.trim().toLowerCase() || ''
  if (EMAIL_PATTERN.test(configuredFallback)) {
    return configuredFallback
  }

  const parsedAllowedRecipient = parseResendAllowedTestRecipient(errorBody?.message)
  if (EMAIL_PATTERN.test(parsedAllowedRecipient)) {
    return parsedAllowedRecipient
  }

  const bookingFallback = process.env.BOOKING_TO_EMAIL?.trim().toLowerCase() || ''
  if (EMAIL_PATTERN.test(bookingFallback)) {
    return bookingFallback
  }

  return ''
}

function buildManualFallbackResponse(lang) {
  return {
    success: true,
    message: lang === 'da'
      ? 'Din forespoergsel er modtaget. Vi kontakter dig snart med detaljer.'
      : 'Your request was received. We will contact you shortly with details.',
    fallback_routed: true,
    delivery: 'manual-fallback',
  }
}

async function sendResendEmail(resendApiKey, payload) {
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const responseBody = await response.json().catch(() => null)
  return { response, responseBody }
}

function buildFallbackLeadHtml(requestedEmail, lang, bookingUrl) {
  const safeRequestedEmail = String(requestedEmail || '').trim().toLowerCase()
  const safeLang = lang === 'da' ? 'da' : 'en'
  const nowIso = new Date().toISOString()

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a44;">
      <h2 style="margin-bottom: 8px;">Update Request Captured (Fallback)</h2>
      <p style="margin-top: 0;">Resend test-mode blocked direct send to requester. Lead details:</p>
      <ul style="padding-left: 18px; margin-top: 0;">
        <li><strong>Requested email:</strong> ${safeRequestedEmail}</li>
        <li><strong>Language:</strong> ${safeLang}</li>
        <li><strong>Captured at:</strong> ${nowIso}</li>
      </ul>
      <p>
        Booking link currently configured:
        <a href="${bookingUrl}" style="color: #0b63ce; font-weight: 700;">${bookingUrl}</a>
      </p>
    </div>
  `
}

function buildEmailHtml(bookingUrl, lang = 'en') {
  if (lang === 'da') {
    return `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a44;">
        <h2 style="margin-bottom: 8px;">Tak for din interesse i The Human Jukebox</h2>
        <p style="margin-top: 0;">Her er et hurtigt overblik over konceptet og hvordan booking fungerer.</p>

        <h3 style="margin-bottom: 6px;">Sådan fungerer konceptet</h3>
        <ul style="padding-left: 18px; margin-top: 0;">
          <li>Gæsterne scanner en QR-kode og deltager øjeblikkeligt fra deres telefon.</li>
          <li>De ønsker sange og stemmer live, så rummet former setlisten sammen.</li>
          <li>En fælles live-skærm holder alle engagerede med nu-spiller og kø-opdateringer.</li>
        </ul>

        <h3 style="margin-bottom: 6px;">Hvorfor spillesteder bruger det</h3>
        <ul style="padding-left: 18px; margin-top: 0;">
          <li>Ingen app-friktioner for gæster.</li>
          <li>Simpel drift for personalet under servicen.</li>
          <li>Interaktive aftener der holder momentum.</li>
        </ul>

        <p>
          Klar til at planlægge din dato?
          <a href="${bookingUrl}" style="color: #0b63ce; font-weight: 700;">Book showet her</a>.
        </p>

        <p style="font-size: 13px; color: #57607a;">Du modtog denne besked, fordi du anmodede om opdateringer på The Human Jukebox-webstedet.</p>
      </div>
    `
  }

  // English (default)
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
  const emailLang = body.lang === 'da' ? 'da' : 'en'
  if (!EMAIL_PATTERN.test(toEmail)) {
    return res.status(400).json({ success: false, message: 'A valid email is required.' })
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ''
  const fromEmail = process.env.UPDATES_EMAIL_FROM?.trim() || 'The Human Jukebox <noreply@the-human-jukebox.org>'
  const bookingUrl = process.env.VITE_BOOKING_URL?.trim() || 'https://www.the-human-jukebox.org/?booking=1'

  if (!resendApiKey) {
    console.warn('get-updates manual fallback: RESEND_API_KEY missing', {
      email: toEmail,
      lang: emailLang,
      source: body.source ?? null,
      intent: body.intent ?? null,
    })
    return res.status(200).json(buildManualFallbackResponse(emailLang))
  }

  try {
    const emailSubject = emailLang === 'da' 
      ? 'Din Human Jukebox-koncept og bookinginfo' 
      : 'Your Human Jukebox concept and booking info'

    const { response, responseBody: errorBody } = await sendResendEmail(resendApiKey, {
      from: fromEmail,
      to: [toEmail],
      subject: emailSubject,
      html: buildEmailHtml(bookingUrl, emailLang),
    })

    if (!response.ok) {
      const errorText = errorBody?.message || errorBody?.name || JSON.stringify(errorBody) || ''

      if (isResendAuthConfigurationError(errorBody)) {
        console.error('Resend auth/config error; switching to manual fallback', response.status, errorBody)
        console.warn('get-updates manual fallback: invalid Resend configuration', {
          email: toEmail,
          lang: emailLang,
          source: body.source ?? null,
          intent: body.intent ?? null,
        })
        return res.status(200).json(buildManualFallbackResponse(emailLang))
      }

      if (isResendTestingRestriction(errorBody)) {
        const fallbackRecipient = resolveFallbackRecipient(errorBody)
        if (EMAIL_PATTERN.test(fallbackRecipient)) {
          const fallbackSubject = `Fallback update lead: ${toEmail}`
          const fallbackHtml = buildFallbackLeadHtml(toEmail, emailLang, bookingUrl)
          const { response: fallbackResponse, responseBody: fallbackErrorBody } = await sendResendEmail(resendApiKey, {
            from: fromEmail,
            to: [fallbackRecipient],
            subject: fallbackSubject,
            html: fallbackHtml,
          })

          if (fallbackResponse.ok) {
            return res.status(200).json({
              success: true,
              message: 'Update request received. We will contact you shortly.',
              fallback_routed: true,
              delivery: 'fallback',
            })
          }

          console.error('Resend fallback error', fallbackResponse.status, fallbackErrorBody)
        }
      }

      console.error('Resend error', response.status, errorBody)
      return res.status(502).json({
        success: false,
        code: 'updates_delivery_failed',
        message: 'Could not send update email right now. Please try again shortly.',
      })
    }

    return res.status(200).json({
      success: true,
      message: 'Update email sent.',
      delivery: 'direct',
    })
  } catch (error) {
    console.error('get-updates error', error)
    return res.status(500).json({
      success: false,
      code: 'updates_delivery_failed',
      message: 'Could not send update email right now. Please try again shortly.',
    })
  }
}