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

function extractEmailAddress(addressValue) {
  const value = String(addressValue || '').trim()
  const match = value.match(/<([^>]+)>/)
  const candidate = (match ? match[1] : value).trim().toLowerCase()
  return EMAIL_PATTERN.test(candidate) ? candidate : ''
}

function resolveReplyToEmail(fromEmail) {
  const configuredReplyTo = process.env.UPDATES_EMAIL_REPLY_TO?.trim().toLowerCase() || ''
  if (EMAIL_PATTERN.test(configuredReplyTo)) {
    return configuredReplyTo
  }

  const bookingContact = process.env.BOOKING_TO_EMAIL?.trim().toLowerCase() || ''
  if (EMAIL_PATTERN.test(bookingContact)) {
    return bookingContact
  }

  return extractEmailAddress(fromEmail)
}

function buildListUnsubscribeHeader(replyToEmail) {
  return EMAIL_PATTERN.test(replyToEmail)
    ? `<mailto:${replyToEmail}?subject=unsubscribe>`
    : ''
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

function getSignupEmailCopy(lang = 'en') {
  if (lang === 'da') {
    return {
      preview: 'Din forespoergsel om opdateringer er modtaget.',
      greeting: 'Hej',
      line1: 'Tak fordi du bad om opdateringer fra The Human Jukebox.',
      line2: 'Vi sender kun mails om nye datoer, ledige bookinger og vigtige nyheder.',
      line3: 'Hvis du ikke har bedt om denne mail, kan du ignorere den.',
      ctaText: 'Se booking og ledige datoer',
      signoff: 'Venlig hilsen',
      signature: 'Harald - The Human Jukebox',
    }
  }

  return {
    preview: 'Your updates request was received.',
    greeting: 'Hi',
    line1: 'Thanks for requesting updates from The Human Jukebox.',
    line2: 'We only send emails about new dates, booking availability, and key updates.',
    line3: 'If you did not request this email, you can safely ignore it.',
    ctaText: 'View booking and availability',
    signoff: 'Best regards',
    signature: 'Harald - The Human Jukebox',
  }
}

function buildEmailHtml(bookingUrl, lang = 'en') {
  const includeImage = process.env.UPDATES_EMAIL_INCLUDE_IMAGE === '1'
  const backgroundImageUrl = process.env.UPDATES_EMAIL_BACKGROUND_URL?.trim()
    || 'https://www.the-human-jukebox.org/images/Human%20Jukebox%20Mirror%20background.png'
  const copy = getSignupEmailCopy(lang)
  const imageBlock = includeImage
    ? `<tr><td style="padding:0;"><img src="${backgroundImageUrl}" alt="The Human Jukebox" width="560" style="display:block;width:100%;height:auto;border:0;" /></td></tr>`
    : ''

  return `
    <div style="margin:0;padding:20px 0;background:#f1f4fa;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${copy.preview}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="padding:0 12px;">
            <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;border-radius:10px;overflow:hidden;background:#ffffff;border:1px solid #d7deea;">
              ${imageBlock}
              <tr>
                <td valign="top" style="padding:26px 26px 24px;font-family:Arial, sans-serif;color:#16233f;line-height:1.6;">
                  <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0e1b34;">${copy.greeting}</p>
                  <p style="margin:0 0 10px;font-size:15px;">${copy.line1}</p>
                  <p style="margin:0 0 10px;font-size:15px;">${copy.line2}</p>
                  <p style="margin:0 0 18px;font-size:14px;color:#4b5a7a;">${copy.line3}</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
                    <tr>
                      <td style="border-radius:999px;background:#0f5fd6;padding:10px 18px;">
                        <a href="${bookingUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${copy.ctaText}</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:18px 0 0;font-size:14px;">${copy.signoff}<br/>${copy.signature}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `
}

function buildEmailText(bookingUrl, lang = 'en') {
  const copy = getSignupEmailCopy(lang)

  return [
    copy.greeting,
    '',
    copy.line1,
    copy.line2,
    copy.line3,
    '',
    `${copy.ctaText}: ${bookingUrl}`,
    '',
    `${copy.signoff},`,
    copy.signature,
  ].join('\n')
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
  const fromEmail = process.env.UPDATES_EMAIL_FROM?.trim() || 'The Human Jukebox <updates@the-human-jukebox.org>'
  const replyToEmail = resolveReplyToEmail(fromEmail)
  const listUnsubscribeHeader = buildListUnsubscribeHeader(replyToEmail)
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
      ? 'Din forespoergsel om opdateringer er modtaget' 
      : 'Your updates request was received'

    const directPayload = {
      from: fromEmail,
      to: [toEmail],
      subject: emailSubject,
      html: buildEmailHtml(bookingUrl, emailLang),
      text: buildEmailText(bookingUrl, emailLang),
    }

    if (EMAIL_PATTERN.test(replyToEmail)) {
      directPayload.reply_to = replyToEmail
    }

    const emailHeaders = { 'X-Auto-Response-Suppress': 'All' }
    if (listUnsubscribeHeader) {
      emailHeaders['List-Unsubscribe'] = listUnsubscribeHeader
      emailHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    }
    directPayload.headers = emailHeaders

    const { response, responseBody: errorBody } = await sendResendEmail(resendApiKey, directPayload)

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