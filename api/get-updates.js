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
      teaser: '...fordi du fortjener underholdning, der er levende, uforudsigelig og lidt ude af kontrol.',
      greeting: 'Hey du',
      intro: 'Hvis du vil vaere foerst med nye shows, special events, bar takeovers, private fester og alt det kaos, jeg paa en eller anden maade faar sat i gang paa scenen, saa er du landet det rigtige sted.',
      simpleLead: 'The Human Jukebox er simpelt:',
      simpleLine1: 'Du vaelger sangene.',
      simpleLine2: 'Jeg spiller dem live.',
      simpleLine3: 'Ingen backing tracks. Intet sikkerhedsnet.',
      simpleLine4: 'Kun mig, en guitar, en stemme og tvivlsomme beslutninger i realtid.',
      audience: 'Publikum bliver en del af showet - sender requests, stemmer, jubler, driller mig (kaerligt) og forvandler en helt almindelig aften til et "skete-det-virkelig"-minde.',
      roles: 'Uanset om du ejer en bar, planlaegger events, holder fest, eller bare elsker at se en voksen mand synge hvad end fremmede finder paa... saa har jeg opdateringer, du faktisk gider laese.',
      signupLead: 'Tilmeld dig, saa sender jeg:',
      bullet1: 'Kommende showdatoer',
      bullet2: 'Bookingmuligheder',
      bullet3: 'Nye features i live request-systemet',
      bullet4: 'Bagom-kaos og backstage-oeblikke',
      bullet5: 'Lejlighedsvise jokes, som maaske er sjove',
      closeLine1: 'Ingen spam. Ingen nonsens.',
      closeLine2: 'Bare rendyrket Human Jukebox-energi.',
      signoff: 'Vi ses paa request-listen',
      signature: '- Harald',
      ctaText: 'Book nu',
    }
  }

  return {
    teaser: "...because you deserve entertainment that's alive, unpredictable, and slightly unhinged.",
    greeting: 'Hey there',
    intro: "If you want to stay in the loop about new shows, special events, bar takeovers, private parties, and all the ridiculous things I somehow get myself into on stage, then you're in the right place.",
    simpleLead: 'The Human Jukebox is simple:',
    simpleLine1: 'You pick the songs.',
    simpleLine2: 'I perform them live.',
    simpleLine3: 'No backing tracks. No safety net.',
    simpleLine4: 'Just me, a guitar, a voice, and questionable decision-making skills.',
    audience: 'Your audience becomes part of the show - sending requests, voting, cheering, roasting me (gently), and turning a normal night out into a "did-that-really-happen" memory.',
    roles: "Whether you're a bar owner, event planner, party host, or just someone who enjoys watching a grown man sing whatever strangers throw at him... I've got updates you'll actually want to read.",
    signupLead: "Sign up, and I'll send you:",
    bullet1: 'Upcoming show dates',
    bullet2: 'Booking opportunities',
    bullet3: 'New features in the live request system',
    bullet4: 'Behind-the-scenes chaos',
    bullet5: 'Occasional jokes that may or may not be funny',
    closeLine1: 'No spam. No nonsense.',
    closeLine2: 'Just pure Human Jukebox energy.',
    signoff: 'See you on the request list',
    signature: '- Harald',
    ctaText: 'Book now',
  }
}

function buildEmailHtml(bookingUrl, lang = 'en') {
  const backgroundImageUrl = process.env.UPDATES_EMAIL_BACKGROUND_URL?.trim()
    || 'https://www.the-human-jukebox.org/images/Human%20Jukebox%20Mirror%20background.png'
  const copy = getSignupEmailCopy(lang)

  return `
    <div style="margin:0;padding:24px 0;background:#070b1a;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="padding:0 12px;">
            <table role="presentation" width="595" cellpadding="0" cellspacing="0" border="0" style="width:595px;max-width:595px;border-radius:14px;overflow:hidden;background-color:#101737;background-image:linear-gradient(180deg, rgba(8, 11, 24, 0.58) 0%, rgba(8, 11, 24, 0.9) 42%, rgba(8, 11, 24, 0.97) 100%), url('${backgroundImageUrl}');background-size:cover;background-position:center top;">
              <tr>
                <td valign="top" style="height:842px;padding:42px 38px;font-family:Arial, sans-serif;color:#ffffff;line-height:1.55;background-color:rgba(5,9,22,0.72);border:1px solid rgba(255,255,255,0.14);border-radius:12px;text-shadow:0 2px 3px rgba(0,0,0,0.6);">
                  <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#ffe089;">${copy.teaser}</p>
                  <p style="margin:0 0 18px;font-size:20px;font-weight:700;">${copy.greeting}</p>
                  <p style="margin:0 0 14px;font-size:16px;">${copy.intro}</p>
                  <p style="margin:0 0 10px;font-size:16px;font-weight:700;">${copy.simpleLead}</p>
                  <p style="margin:0 0 4px;font-size:16px;">${copy.simpleLine1}</p>
                  <p style="margin:0 0 4px;font-size:16px;">${copy.simpleLine2}</p>
                  <p style="margin:0 0 18px;font-size:16px;">${copy.simpleLine3}<br/>${copy.simpleLine4}</p>
                  <p style="margin:0 0 14px;font-size:16px;">${copy.audience}</p>
                  <p style="margin:0 0 14px;font-size:16px;">${copy.roles}</p>
                  <p style="margin:0 0 10px;font-size:16px;font-weight:700;">${copy.signupLead}</p>
                  <ul style="margin:0 0 22px;padding-left:20px;font-size:16px;">
                    <li style="margin-bottom:6px;">${copy.bullet1}</li>
                    <li style="margin-bottom:6px;">${copy.bullet2}</li>
                    <li style="margin-bottom:6px;">${copy.bullet3}</li>
                    <li style="margin-bottom:6px;">${copy.bullet4}</li>
                    <li>${copy.bullet5}</li>
                  </ul>
                  <p style="margin:0 0 10px;font-size:16px;">${copy.closeLine1}<br/>${copy.closeLine2}</p>
                  <p style="margin:0 0 24px;font-size:16px;">${copy.signoff}<br/>${copy.signature}</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
                    <tr>
                      <td style="border-radius:999px;background:linear-gradient(90deg,#ff4fb2 0%,#5cc6ff 100%);padding:12px 22px;">
                        <a href="${bookingUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">${copy.ctaText}</a>
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

function buildEmailText(bookingUrl, lang = 'en') {
  const copy = getSignupEmailCopy(lang)

  return [
    copy.teaser,
    '',
    copy.greeting,
    '',
    copy.intro,
    '',
    copy.simpleLead,
    copy.simpleLine1,
    copy.simpleLine2,
    copy.simpleLine3,
    copy.simpleLine4,
    '',
    copy.audience,
    '',
    copy.roles,
    '',
    copy.signupLead,
    `- ${copy.bullet1}`,
    `- ${copy.bullet2}`,
    `- ${copy.bullet3}`,
    `- ${copy.bullet4}`,
    `- ${copy.bullet5}`,
    '',
    copy.closeLine1,
    copy.closeLine2,
    '',
    copy.signoff,
    copy.signature,
    '',
    `${copy.ctaText}: ${bookingUrl}`,
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