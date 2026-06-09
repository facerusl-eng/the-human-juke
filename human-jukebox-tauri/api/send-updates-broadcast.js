const RESEND_API_ROOT = 'https://api.resend.com'

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
    'Access-Control-Allow-Headers': 'Content-Type, x-broadcast-token',
  }
}

function parseJsonBody(reqBody) {
  if (!reqBody) {
    return {}
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

function extractEmailAddress(addressValue) {
  const value = String(addressValue || '').trim()
  const match = value.match(/<([^>]+)>/)
  const candidate = (match ? match[1] : value).trim().toLowerCase()
  return EMAIL_PATTERN.test(candidate) ? candidate : ''
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getDefaultBroadcastCopy(lang = 'en') {
  if (lang === 'da') {
    return {
      subject: 'Ny opdatering fra The Human Jukebox',
      heading: 'Ny opdatering fra The Human Jukebox',
      message: 'Tak fordi du er tilmeldt. Her er seneste nyt om shows, booking og nye features.',
      ctaText: 'Se booking og ledige datoer',
      footer: 'Du modtager denne mail, fordi du har tilmeldt dig opdateringer paa the-human-jukebox.org.',
    }
  }

  return {
    subject: 'New update from The Human Jukebox',
    heading: 'New update from The Human Jukebox',
    message: 'Thanks for subscribing. Here is the latest on shows, booking, and new features.',
    ctaText: 'View booking and availability',
    footer: 'You are receiving this because you subscribed for updates at the-human-jukebox.org.',
  }
}

function buildBroadcastHtml({ heading, message, ctaText, ctaUrl, footer }) {
  const messageParagraphs = String(message || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 10px;font-size:15px;color:#16233f;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join('')

  return `
    <div style="margin:0;padding:20px 0;background:#f1f4fa;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="padding:0 12px;">
            <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:#ffffff;border:1px solid #d7deea;border-radius:10px;overflow:hidden;">
              <tr>
                <td style="padding:24px 24px 22px;font-family:Arial,sans-serif;">
                  <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#0e1b34;">${escapeHtml(heading)}</h1>
                  ${messageParagraphs}
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 0;">
                    <tr>
                      <td style="border-radius:999px;background:#0f5fd6;padding:10px 18px;">
                        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${escapeHtml(ctaText)}</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:14px 0 0;font-size:12px;color:#6b7894;line-height:1.5;">${escapeHtml(footer)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `
}

function buildBroadcastText({ heading, message, ctaText, ctaUrl, footer }) {
  return [
    heading,
    '',
    message,
    '',
    `${ctaText}: ${ctaUrl}`,
    '',
    footer,
  ].join('\n')
}

async function resendRequest(resendApiKey, path, method, payload) {
  const response = await fetch(`${RESEND_API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

  const responseBody = await response.json().catch(() => null)
  return { response, responseBody }
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

  const expectedToken = process.env.UPDATES_BROADCAST_TOKEN?.trim() || ''
  const providedToken = String(req.headers['x-broadcast-token'] || body.token || '').trim()
  if (!expectedToken || providedToken !== expectedToken) {
    return res.status(401).json({ success: false, message: 'Unauthorized' })
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ''
  const audienceId = process.env.RESEND_UPDATES_AUDIENCE_ID?.trim() || ''
  const fromEmail = process.env.UPDATES_EMAIL_FROM?.trim() || 'The Human Jukebox <updates@the-human-jukebox.org>'
  const bookingUrl = process.env.VITE_BOOKING_URL?.trim() || 'https://www.the-human-jukebox.org/?booking=1'
  const replyToEmail = extractEmailAddress(process.env.UPDATES_EMAIL_REPLY_TO || process.env.BOOKING_TO_EMAIL || fromEmail)

  if (!resendApiKey) {
    return res.status(500).json({ success: false, message: 'RESEND_API_KEY is missing' })
  }

  if (!audienceId) {
    return res.status(500).json({ success: false, message: 'RESEND_UPDATES_AUDIENCE_ID is missing' })
  }

  const lang = body.lang === 'da' ? 'da' : 'en'
  const defaults = getDefaultBroadcastCopy(lang)

  const subject = String(body.subject || defaults.subject).trim().slice(0, 200)
  const heading = String(body.heading || subject || defaults.heading).trim().slice(0, 240)
  const message = String(body.message || defaults.message).trim().slice(0, 10000)
  const ctaUrl = String(body.ctaUrl || bookingUrl).trim() || bookingUrl
  const ctaText = String(body.ctaText || defaults.ctaText).trim().slice(0, 120)
  const footer = String(body.footer || defaults.footer).trim().slice(0, 300)

  if (!subject || !message) {
    return res.status(400).json({ success: false, message: 'subject and message are required' })
  }

  const html = buildBroadcastHtml({ heading, message, ctaText, ctaUrl, footer })
  const text = buildBroadcastText({ heading, message, ctaText, ctaUrl, footer })

  const createPayload = {
    audience_id: audienceId,
    from: fromEmail,
    subject,
    html,
    text,
    reply_to: replyToEmail || undefined,
  }

  const { response: createResponse, responseBody: createBody } = await resendRequest(
    resendApiKey,
    '/broadcasts',
    'POST',
    createPayload,
  )

  if (!createResponse.ok) {
    console.error('send-updates-broadcast create failed', createResponse.status, createBody)
    return res.status(502).json({
      success: false,
      message: 'Could not create broadcast',
      status: createResponse.status,
      error: createBody,
    })
  }

  const broadcastId = String(createBody?.id || '').trim()
  if (!broadcastId) {
    return res.status(502).json({ success: false, message: 'Broadcast ID missing from provider response' })
  }

  const { response: sendResponse, responseBody: sendBody } = await resendRequest(
    resendApiKey,
    `/broadcasts/${encodeURIComponent(broadcastId)}/send`,
    'POST',
    {},
  )

  if (!sendResponse.ok) {
    console.error('send-updates-broadcast send failed', sendResponse.status, sendBody)
    return res.status(502).json({
      success: false,
      message: 'Broadcast created but send failed',
      broadcast_id: broadcastId,
      status: sendResponse.status,
      error: sendBody,
    })
  }

  return res.status(200).json({
    success: true,
    broadcast_id: broadcastId,
    message: 'Broadcast queued successfully.',
    provider: sendBody,
  })
}
