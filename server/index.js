import 'dotenv/config'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import express from 'express'
import path from 'path'

// Import the keepwarm handler for local API routing
import keepwarmHandler from '../api/keepwarm.js'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.SPOTIFY_SERVER_PORT ?? 3001)
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const mixerPresetScriptPath = fileURLToPath(new URL('../scripts/apply-backing-preset.mjs', import.meta.url))

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID ?? '510534c3ee9046aba1b67cb526ef8b1c'
const spotifyRedirectUriOverride = process.env.SPOTIFY_REDIRECT_URI?.trim() ?? ''
const spotifyRedirectUriDev = process.env.SPOTIFY_REDIRECT_URI_DEV?.trim() ?? ''
const spotifyRedirectUriProd = process.env.SPOTIFY_REDIRECT_URI_PROD ?? spotifyRedirectUriDev
const spotifyScopes = 'user-read-playback-state user-modify-playback-state streaming'
const spotifyRefreshCookieName = 'human_jukebox_spotify_refresh_token'
const spotifyPkceCookieName = 'human_jukebox_spotify_code_verifier'
const resendApiUrl = 'https://api.resend.com/emails'
const resendApiRoot = 'https://api.resend.com'
const defaultBookingWebhookUrl = process.env.BOOKING_WEBHOOK_URL?.trim() || 'https://book-jukebox.base44.app/api/functions/receiveExternalBooking'
const fallbackBookingWebhookUrls = [
  'https://preview--book-jukebox.base44.app/api/functions/receiveExternalBooking',
  'https://preview--book-jukebox.base44.app/api/webhook/receiveExternalBooking',
  'https://book-jukebox.base44.app/api/webhook/receiveExternalBooking',
]

let latestRefreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? null

app.use(express.json())

// Local mirror of Vercel's /api/keepwarm endpoint
app.all('/api/keepwarm', (req, res) => {
  // Express does not use (req, res) in the same way as Vercel, so we adapt
  // The handler expects (req, res) with .method and .status/.json
  // req.method is available, and res.status/res.json are standard
  // For compatibility, ensure req.method is set and pass req/res directly
  // If using TypeScript, you may need to adjust types
  keepwarmHandler(req, res)
})

async function runMixerRepairScript() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mixerPresetScriptPath], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('Mixer repair timed out.'))
    }, 20000)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)

      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      reject(new Error(combined || `Mixer repair exited with code ${code}.`))
    })
  })
}

function generateSpotifyPkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  return { verifier, challenge }
}

function isSecureRequest(req) {
  const forwardedProto = req?.headers?.['x-forwarded-proto']

  if (typeof forwardedProto === 'string' && forwardedProto.length > 0) {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https'
  }

  if (typeof req?.protocol === 'string' && req.protocol.length > 0) {
    return req.protocol.toLowerCase() === 'https'
  }

  return process.env.NODE_ENV === 'production'
}

function appendSetCookieHeader(res, cookieValue) {
  const existing = res.getHeader('Set-Cookie')

  if (!existing) {
    res.setHeader('Set-Cookie', cookieValue)
    return
  }

  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieValue])
    return
  }

  res.setHeader('Set-Cookie', [String(existing), cookieValue])
}

function serializeSpotifyCookie(name, value, req, options = {}) {
  const cookieParts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax']

  if (typeof options.maxAgeSeconds === 'number') {
    cookieParts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`)
  }

  if (options.httpOnly !== false) {
    cookieParts.push('HttpOnly')
  }

  if (isSecureRequest(req)) {
    cookieParts.push('Secure')
  }

  return cookieParts.join('; ')
}

function parseCookies(req) {
  const header = req.headers?.cookie

  if (!header) {
    return {}
  }

  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=')

      if (separatorIndex <= 0) {
        return cookies
      }

      const key = part.slice(0, separatorIndex).trim()
      const value = part.slice(separatorIndex + 1).trim()

      if (!key) {
        return cookies
      }

      cookies[key] = decodeURIComponent(value)
      return cookies
    }, {})
}

function getSpotifyPkceVerifierFromRequest(req) {
  const cookies = parseCookies(req)
  const verifier = cookies[spotifyPkceCookieName]

  if (typeof verifier === 'string' && verifier.trim().length > 0) {
    return verifier.trim()
  }

  return ''
}

function setRefreshTokenCookie(res, refreshToken, req) {
  if (!refreshToken) {
    return
  }

  const cookieValue = serializeSpotifyCookie(spotifyRefreshCookieName, refreshToken, req, {
    maxAgeSeconds: 60 * 60 * 24 * 30,
    httpOnly: true,
  })

  appendSetCookieHeader(res, cookieValue)
}

function setSpotifyPkceVerifierCookie(res, verifier, req) {
  if (!verifier) {
    return
  }

  const cookieValue = serializeSpotifyCookie(spotifyPkceCookieName, verifier, req, {
    maxAgeSeconds: 60 * 10,
    httpOnly: true,
  })

  appendSetCookieHeader(res, cookieValue)
}

function clearSpotifyPkceVerifierCookie(res, req) {
  const cookieValue = serializeSpotifyCookie(spotifyPkceCookieName, '', req, {
    maxAgeSeconds: 0,
    httpOnly: true,
  })

  appendSetCookieHeader(res, cookieValue)
}

function getSpotifyRedirectUri(req) {
  if (process.env.NODE_ENV !== 'production') {
    if (spotifyRedirectUriOverride) {
      return spotifyRedirectUriOverride
    }

    if (spotifyRedirectUriDev) {
      return spotifyRedirectUriDev
    }

    const devPublicOrigin = process.env.VITE_DEV_PUBLIC_ORIGIN?.trim()
    if (devPublicOrigin) {
      return `${devPublicOrigin.replace(/\/$/, '')}/callback`
    }

    return 'http://localhost:5173/callback'
  }

  if (spotifyRedirectUriOverride) {
    return spotifyRedirectUriOverride
  }

  if (spotifyRedirectUriProd) {
    return spotifyRedirectUriProd
  }

  const host = req?.headers?.['x-forwarded-host'] ?? req?.headers?.host
  const protocolHeader = req?.headers?.['x-forwarded-proto']
  const protocol = typeof protocolHeader === 'string' && protocolHeader.length > 0 ? protocolHeader.split(',')[0] : 'https'

  if (typeof host === 'string' && host.length > 0) {
    return `${protocol}://${host}/callback`
  }

  return 'https://the-human-jukebox.org/callback'
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
}

function extractEmailAddress(addressValue) {
  const value = String(addressValue || '').trim()
  const match = value.match(/<([^>]+)>/)
  const candidate = (match ? match[1] : value).trim().toLowerCase()
  return isValidEmail(candidate) ? candidate : ''
}

function resolveUpdatesReplyToEmail(fromEmail) {
  const configuredReplyTo = process.env.UPDATES_EMAIL_REPLY_TO?.trim().toLowerCase() || ''
  if (isValidEmail(configuredReplyTo)) {
    return configuredReplyTo
  }

  const bookingContact = process.env.BOOKING_TO_EMAIL?.trim().toLowerCase() || ''
  if (isValidEmail(bookingContact)) {
    return bookingContact
  }

  return extractEmailAddress(fromEmail)
}

function buildListUnsubscribeHeader(replyToEmail) {
  return isValidEmail(replyToEmail)
    ? `<mailto:${replyToEmail}?subject=unsubscribe>`
    : ''
}

function buildBookingWebhookTargets(primaryUrl) {
  const targets = [String(primaryUrl || '').trim(), ...fallbackBookingWebhookUrls]
  return [...new Set(targets.filter(Boolean))]
}

function getSignupEmailCopy(lang = 'en') {
  if (lang === 'da') {
    return {
      preview: 'Din forespoergsel om opdateringer er modtaget.',
      greeting: 'Hej',
      teaser: '...fordi du fortjener underholdning, der er levende, uforudsigelig og lidt ude af kontrol.',
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
      consentLine: 'Du modtager denne mail, fordi du selv tilmeldte dig opdateringer paa the-human-jukebox.org. Svar med "afmeld" for at stoppe mails.',
      ctaText: 'Se booking og ledige datoer',
      signoff: 'Venlig hilsen',
      signature: 'Harald - The Human Jukebox',
    }
  }

  return {
    preview: 'Your updates request was received.',
    greeting: 'Hi',
    teaser: "...because you deserve entertainment that's alive, unpredictable, and slightly unhinged.",
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
    consentLine: 'You are receiving this because you signed up for updates at the-human-jukebox.org. Reply with "unsubscribe" to stop update emails.',
    ctaText: 'Book now',
    signoff: 'Best regards',
    signature: 'Harald - The Human Jukebox',
  }
}

function buildUpdatesEmailHtml(bookingUrl, lang = 'en') {
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
                  <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#24355f;">${copy.teaser}</p>
                  <p style="margin:0 0 10px;font-size:15px;">${copy.intro}</p>
                  <p style="margin:0 0 8px;font-size:15px;font-weight:700;">${copy.simpleLead}</p>
                  <p style="margin:0 0 4px;font-size:15px;">${copy.simpleLine1}</p>
                  <p style="margin:0 0 4px;font-size:15px;">${copy.simpleLine2}</p>
                  <p style="margin:0 0 12px;font-size:15px;">${copy.simpleLine3}<br/>${copy.simpleLine4}</p>
                  <p style="margin:0 0 10px;font-size:15px;">${copy.audience}</p>
                  <p style="margin:0 0 10px;font-size:15px;">${copy.roles}</p>
                  <p style="margin:0 0 8px;font-size:15px;font-weight:700;">${copy.signupLead}</p>
                  <ul style="margin:0 0 14px;padding-left:20px;font-size:15px;color:#16233f;">
                    <li style="margin-bottom:4px;">${copy.bullet1}</li>
                    <li style="margin-bottom:4px;">${copy.bullet2}</li>
                    <li style="margin-bottom:4px;">${copy.bullet3}</li>
                    <li style="margin-bottom:4px;">${copy.bullet4}</li>
                    <li>${copy.bullet5}</li>
                  </ul>
                  <p style="margin:0 0 18px;font-size:15px;">${copy.closeLine1}<br/>${copy.closeLine2}</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
                    <tr>
                      <td style="border-radius:999px;background:#0f5fd6;padding:10px 18px;">
                        <a href="${bookingUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${copy.ctaText}</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:14px 0 0;font-size:12px;color:#6b7894;">${copy.consentLine}</p>
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

function buildUpdatesEmailText(bookingUrl, lang = 'en') {
  const copy = getSignupEmailCopy(lang)

  return [
    copy.greeting,
    '',
    copy.teaser,
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
    `${copy.ctaText}: ${bookingUrl}`,
    '',
    copy.consentLine,
    '',
    `${copy.signoff},`,
    copy.signature,
  ].join('\n')
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

function resolveUpdatesFallbackRecipient(errorBody) {
  const configuredFallback = process.env.UPDATES_FALLBACK_TO_EMAIL?.trim().toLowerCase() || ''
  if (isValidEmail(configuredFallback)) {
    return configuredFallback
  }

  const parsedAllowedRecipient = parseResendAllowedTestRecipient(errorBody?.message)
  if (isValidEmail(parsedAllowedRecipient)) {
    return parsedAllowedRecipient
  }

  const bookingFallback = process.env.BOOKING_TO_EMAIL?.trim().toLowerCase() || ''
  if (isValidEmail(bookingFallback)) {
    return bookingFallback
  }

  return ''
}

function buildUpdatesFallbackLeadHtml(requestedEmail, lang, bookingUrl) {
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

function buildUpdatesManualFallbackResponse(lang) {
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
  const response = await fetch(resendApiUrl, {
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

async function addContactToResendAudience(resendApiKey, audienceId, email, name) {
  const trimmedAudienceId = String(audienceId || '').trim()
  if (!trimmedAudienceId || !isValidEmail(email)) {
    return { ok: true, skipped: true }
  }

  const payload = {
    email,
    first_name: String(name || '').trim().slice(0, 80) || undefined,
    unsubscribed: false,
  }

  const response = await fetch(`${resendApiRoot}/audiences/${encodeURIComponent(trimmedAudienceId)}/contacts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const responseBody = await response.json().catch(() => null)
  if (response.ok) {
    return { ok: true, responseBody }
  }

  const responseText = `${String(responseBody?.name || '')} ${String(responseBody?.message || '')}`.toLowerCase()
  const alreadyExists = response.status === 409
    || responseText.includes('already exists')
    || responseText.includes('already in this audience')
    || responseText.includes('duplicate')

  if (alreadyExists) {
    return { ok: true, duplicate: true, responseBody }
  }

  return { ok: false, status: response.status, responseBody }
}

function getAuthorizeUrl(req, res) {
  const redirectUri = getSpotifyRedirectUri(req)
  const { verifier, challenge } = generateSpotifyPkcePair()

  if (res) {
    setSpotifyPkceVerifierCookie(res, verifier, req)
  }

  const params = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: spotifyScopes,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

async function exchangeCodeForTokens(code, req) {
  const redirectUri = getSpotifyRedirectUri(req)
  const codeVerifier = getSpotifyPkceVerifierFromRequest(req)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: spotifyClientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = typeof payload?.error_description === 'string'
      ? payload.error_description
      : 'Token exchange failed.'
    throw new Error(message)
  }

  return payload
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: spotifyClientId,
    refresh_token: refreshToken,
  })

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = typeof payload?.error_description === 'string'
      ? payload.error_description
      : 'Access token refresh failed.'
    throw new Error(message)
  }

  return payload
}

app.get('/api/spotify/login', (req, res) => {
  res.redirect(getAuthorizeUrl(req, res))
})

app.get('/api/spotify/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''

  if (!code) {
    res.status(400).json({ error: 'Missing Spotify authorization code.' })
    return
  }

  try {
    const tokenPayload = await exchangeCodeForTokens(code, req)

    if (typeof tokenPayload.refresh_token === 'string' && tokenPayload.refresh_token.length > 0) {
      latestRefreshToken = tokenPayload.refresh_token
      setRefreshTokenCookie(res, tokenPayload.refresh_token, req)
    }

    clearSpotifyPkceVerifierCookie(res, req)

    res.json({
      access_token: tokenPayload.access_token,
      token_type: tokenPayload.token_type,
      expires_in: tokenPayload.expires_in,
    })
  } catch (error) {
    clearSpotifyPkceVerifierCookie(res, req)
    console.error('Spotify callback error', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Spotify callback failed.',
    })
  }
})

app.get('/api/spotify/token', async (_req, res) => {
  if (!latestRefreshToken) {
    res.status(400).json({ error: 'No Spotify refresh token stored yet. Complete login first.' })
    return
  }

  try {
    const tokenPayload = await refreshAccessToken(latestRefreshToken)

    if (typeof tokenPayload.refresh_token === 'string' && tokenPayload.refresh_token.length > 0) {
      latestRefreshToken = tokenPayload.refresh_token
    }

    res.json({
      access_token: tokenPayload.access_token,
      token_type: tokenPayload.token_type,
      expires_in: tokenPayload.expires_in,
    })
  } catch (error) {
    console.error('Spotify refresh error', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Spotify token refresh failed.',
    })
  }
})

app.post('/api/book-show', async (req, res) => {
  const booking = req.body?.booking ?? req.body ?? {}
  const venueName = String(booking.venue_name || '').trim()
  const date = String(booking.date || '').trim()
  const gigType = String(booking.gig_type || '').trim()
  const notes = String(booking.notes || '').trim()
  const externalContactEmail = String(booking.contact_email || booking.external_contact_email || '').trim()
  const fee = booking.requested_fee ?? booking.fee
  const webhookTargets = buildBookingWebhookTargets(defaultBookingWebhookUrl)

  if (webhookTargets.length === 0) {
    res.status(400).json({ success: false, message: 'Webhook URL is required.' })
    return
  }

  if (!venueName) {
    res.status(400).json({ success: false, message: 'venue_name is required.' })
    return
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD.' })
    return
  }

  if (!['afternoon', 'evening', 'both'].includes(gigType)) {
    res.status(400).json({ success: false, message: 'gig_type must be afternoon, evening, or both.' })
    return
  }

  if (!isValidEmail(externalContactEmail)) {
    res.status(400).json({ success: false, message: 'external_contact_email is required and must be valid.' })
    return
  }

  if (fee !== undefined && fee !== null && fee !== '' && Number.isNaN(Number(fee))) {
    res.status(400).json({ success: false, message: 'fee must be a number when provided.' })
    return
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
      res.status(200).json({
        success: true,
        gig_id: upstream?.gig_id || '',
        message: upstream?.message || 'Booking received',
        routed_to: target,
      })
      return
    } catch (error) {
      failures.push({ target, status: 0, details: error instanceof Error ? error.message : 'Network error' })
    }
  }

  res.status(502).json({
    success: false,
    message: 'External booking webhook failed',
    details: failures,
  })
})

app.post('/api/get-updates', async (req, res) => {
  const toEmail = String(req.body?.email || '').trim().toLowerCase()
  const emailLang = req.body?.lang === 'da' ? 'da' : 'en'

  if (!isValidEmail(toEmail)) {
    res.status(400).json({ success: false, message: 'A valid email is required.' })
    return
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ''
  const updatesAudienceId = process.env.RESEND_UPDATES_AUDIENCE_ID?.trim() || ''
  const fromEmail = process.env.UPDATES_EMAIL_FROM?.trim() || 'The Human Jukebox <updates@the-human-jukebox.org>'
  const replyToEmail = resolveUpdatesReplyToEmail(fromEmail)
  const listUnsubscribeHeader = buildListUnsubscribeHeader(replyToEmail)
  const bookingUrl = process.env.VITE_BOOKING_URL?.trim() || 'https://www.the-human-jukebox.org/?booking=1'

  if (!resendApiKey) {
    console.warn('get-updates local dev manual fallback: RESEND_API_KEY missing', {
      email: toEmail,
      lang: emailLang,
      source: req.body?.source ?? null,
      intent: req.body?.intent ?? null,
    })
    res.status(200).json(buildUpdatesManualFallbackResponse(emailLang))
    return
  }

  try {
    const signupName = String(req.body?.name || '').trim()
    if (updatesAudienceId) {
      const audienceResult = await addContactToResendAudience(resendApiKey, updatesAudienceId, toEmail, signupName)
      if (!audienceResult.ok) {
        console.warn('get-updates local audience add failed', {
          status: audienceResult.status,
          response: audienceResult.responseBody,
          email: toEmail,
        })
      }
    }

    const emailSubject = emailLang === 'da'
      ? 'Din forespoergsel om opdateringer er modtaget'
      : 'Your updates request was received'

    const directPayload = {
      from: fromEmail,
      to: [toEmail],
      subject: emailSubject,
      html: buildUpdatesEmailHtml(bookingUrl, emailLang),
      text: buildUpdatesEmailText(bookingUrl, emailLang),
    }

    if (isValidEmail(replyToEmail)) {
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
      if (isResendAuthConfigurationError(errorBody)) {
        console.error('Resend auth/config error (local dev); switching to manual fallback', response.status, errorBody)
        console.warn('get-updates local dev manual fallback: invalid Resend configuration', {
          email: toEmail,
          lang: emailLang,
          source: req.body?.source ?? null,
          intent: req.body?.intent ?? null,
        })
        res.status(200).json(buildUpdatesManualFallbackResponse(emailLang))
        return
      }

      if (isResendTestingRestriction(errorBody)) {
        const fallbackRecipient = resolveUpdatesFallbackRecipient(errorBody)
        if (isValidEmail(fallbackRecipient)) {
          const fallbackSubject = `Fallback update lead: ${toEmail}`
          const fallbackHtml = buildUpdatesFallbackLeadHtml(toEmail, emailLang, bookingUrl)
          const { response: fallbackResponse, responseBody: fallbackErrorBody } = await sendResendEmail(resendApiKey, {
            from: fromEmail,
            to: [fallbackRecipient],
            subject: fallbackSubject,
            html: fallbackHtml,
          })

          if (fallbackResponse.ok) {
            res.status(200).json({
              success: true,
              message: 'Update request received. We will contact you shortly.',
              fallback_routed: true,
              delivery: 'fallback',
            })
            return
          }

          console.error('Resend fallback error (local dev)', fallbackResponse.status, fallbackErrorBody)
        }
      }

      res.status(502).json({
        success: false,
        code: 'updates_delivery_failed',
        message: 'Could not send update email right now. Please try again shortly.',
      })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Update email sent.',
      delivery: 'direct',
    })
  } catch (error) {
    console.error('get-updates local dev error', error)
    res.status(500).json({
      success: false,
      code: 'updates_delivery_failed',
      message: 'Could not send update email right now. Please try again shortly.',
    })
  }
})

app.post('/api/mixer/auto-fix', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Mixer auto-fix is only available in the local laptop admin app.' })
    return
  }

  try {
    await runMixerRepairScript()
    res.json({ ok: true, detail: 'Local mixer preset repair ran successfully.' })
  } catch (error) {
    console.error('Mixer auto-fix error', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Mixer auto-fix failed.',
    })
  }
})

app.listen(port, () => {
  console.log(`Spotify API server running on http://localhost:${port}`)
})
