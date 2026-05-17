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

function buildEmailHtml(bookingUrl) {
  const backgroundImageUrl = process.env.UPDATES_EMAIL_BACKGROUND_URL?.trim()
    || 'https://www.the-human-jukebox.org/images/Harald%20live%20Mirror%20background.png'

  return `
    <div style="margin:0;padding:24px 0;background:#070b1a;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="padding:0 12px;">
            <table role="presentation" width="595" cellpadding="0" cellspacing="0" border="0" style="width:595px;max-width:595px;border-radius:14px;overflow:hidden;background-color:#101737;background-image:linear-gradient(180deg, rgba(8, 11, 24, 0.32) 0%, rgba(8, 11, 24, 0.82) 42%, rgba(8, 11, 24, 0.94) 100%), url('${backgroundImageUrl}');background-size:cover;background-position:center top;">
              <tr>
                <td valign="top" style="height:842px;padding:42px 38px;font-family:Arial, sans-serif;color:#f5f8ff;line-height:1.55;">
                  <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#ffe089;">...because you deserve entertainment that's alive, unpredictable, and slightly unhinged.</p>
                  <p style="margin:0 0 18px;font-size:20px;font-weight:700;">Hey there</p>
                  <p style="margin:0 0 14px;font-size:16px;">If you want to stay in the loop about new shows, special events, bar takeovers, private parties, and all the ridiculous things I somehow get myself into on stage, then you're in the right place.</p>
                  <p style="margin:0 0 10px;font-size:16px;font-weight:700;">The Human Jukebox is simple:</p>
                  <p style="margin:0 0 4px;font-size:16px;">You pick the songs.</p>
                  <p style="margin:0 0 4px;font-size:16px;">I perform them live.</p>
                  <p style="margin:0 0 18px;font-size:16px;">No backing tracks. No safety net.<br/>Just me, a guitar, a voice, and questionable decision-making skills.</p>
                  <p style="margin:0 0 14px;font-size:16px;">Your audience becomes part of the show - sending requests, voting, cheering, roasting me (gently), and turning a normal night out into a "did-that-really-happen" memory.</p>
                  <p style="margin:0 0 14px;font-size:16px;">Whether you're a bar owner, event planner, party host, or just someone who enjoys watching a grown man sing whatever strangers throw at him... I've got updates you'll actually want to read.</p>
                  <p style="margin:0 0 10px;font-size:16px;font-weight:700;">Sign up, and I'll send you:</p>
                  <ul style="margin:0 0 22px;padding-left:20px;font-size:16px;">
                    <li style="margin-bottom:6px;">Upcoming show dates</li>
                    <li style="margin-bottom:6px;">Booking opportunities</li>
                    <li style="margin-bottom:6px;">New features in the live request system</li>
                    <li style="margin-bottom:6px;">Behind-the-scenes chaos</li>
                    <li>Occasional jokes that may or may not be funny</li>
                  </ul>
                  <p style="margin:0 0 10px;font-size:16px;">No spam. No nonsense.<br/>Just pure Human Jukebox energy.</p>
                  <p style="margin:0 0 24px;font-size:16px;">See you on the request list<br/>- Harald 🎤✨</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
                    <tr>
                      <td style="border-radius:999px;background:linear-gradient(90deg,#ff4fb2 0%,#5cc6ff 100%);padding:12px 22px;">
                        <a href="${bookingUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">Book now</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `
}

function buildEmailText(bookingUrl) {
  return [
    "...because you deserve entertainment that's alive, unpredictable, and slightly unhinged.",
    '',
    'Hey there',
    '',
    "If you want to stay in the loop about new shows, special events, bar takeovers, private parties, and all the ridiculous things I somehow get myself into on stage, then you're in the right place.",
    '',
    'The Human Jukebox is simple:',
    'You pick the songs.',
    'I perform them live.',
    'No backing tracks. No safety net.',
    'Just me, a guitar, a voice, and questionable decision-making skills.',
    '',
    "Your audience becomes part of the show - sending requests, voting, cheering, roasting me (gently), and turning a normal night out into a \"did-that-really-happen\" memory.",
    '',
    "Whether you're a bar owner, event planner, party host, or just someone who enjoys watching a grown man sing whatever strangers throw at him... I've got updates you'll actually want to read.",
    '',
    "Sign up, and I'll send you:",
    '- Upcoming show dates',
    '- Booking opportunities',
    '- New features in the live request system',
    '- Behind-the-scenes chaos',
    '- Occasional jokes that may or may not be funny',
    '',
    'No spam. No nonsense.',
    'Just pure Human Jukebox energy.',
    '',
    'See you on the request list',
    '- Harald 🎤✨',
    '',
    `Book now: ${bookingUrl}`,
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
      ? 'Din Human Jukebox-koncept og bookinginfo' 
      : 'Your Human Jukebox concept and booking info'

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

    if (listUnsubscribeHeader) {
      directPayload.headers = { 'List-Unsubscribe': listUnsubscribeHeader }
    }

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