const APP_ORIGIN = 'https://the-human-jukebox.org'
const LOGO_URL = `${APP_ORIGIN}/the-human-jukebox-logo.png`
const DEFAULT_TITLE = 'Join The Human Jukebox'
const DEFAULT_DESCRIPTION = 'Join the Human Jukebox - request songs and vote live with the audience.'

// Known social-media and search crawlers that need OG meta tags.
// Real browsers won't match any of these, so they get an instant redirect.
const CRAWLER_UA_PATTERN = /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegram|slackbot|discordbot|googlebot|bingbot|yandex|applebot|duckduckbot|pinterestbot|vkshare|w3c_validator|preview/i

function isCrawler(req) {
  const ua = req?.headers?.['user-agent'] ?? ''
  return CRAWLER_UA_PATTERN.test(ua)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toAbsoluteOrigin(req) {
  const host = req?.headers?.['x-forwarded-host'] ?? req?.headers?.host
  const protoHeader = req?.headers?.['x-forwarded-proto']
  const protocol = typeof protoHeader === 'string' && protoHeader.length > 0 ? protoHeader.split(',')[0] : 'https'

  if (typeof host === 'string' && host.trim()) {
    return `${protocol}://${host.trim()}`
  }

  return APP_ORIGIN
}

async function fetchEventMeta(eventId) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || ''
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''

  if (!supabaseUrl || !publishableKey || !eventId) {
    return null
  }

  const apiUrl = `${supabaseUrl}/rest/v1/events?select=id,name,venue,subtitle,gig_date,gig_start_time&id=eq.${encodeURIComponent(eventId)}&limit=1`
  const response = await fetch(apiUrl, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    return null
  }

  const payload = await response.json().catch(() => [])
  const event = Array.isArray(payload) ? payload[0] : null

  if (!event || typeof event !== 'object') {
    return null
  }

  return {
    name: typeof event.name === 'string' ? event.name.trim() : '',
    venue: typeof event.venue === 'string' ? event.venue.trim() : '',
    subtitle: typeof event.subtitle === 'string' ? event.subtitle.trim() : '',
    gigDate: typeof event.gig_date === 'string' ? event.gig_date.trim() : '',
    gigStartTime: typeof event.gig_start_time === 'string' ? event.gig_start_time.trim() : '',
  }
}

function buildDescription(eventMeta) {
  if (!eventMeta || !eventMeta.name) {
    return DEFAULT_DESCRIPTION
  }

  const parts = []
  if (eventMeta.venue) {
    parts.push(`at ${eventMeta.venue}`)
  }
  if (eventMeta.gigDate) {
    parts.push(`on ${eventMeta.gigDate}`)
  }
  if (eventMeta.gigStartTime) {
    parts.push(`starting ${eventMeta.gigStartTime}`)
  }

  const whereWhen = parts.length > 0 ? ` ${parts.join(' ')}` : ''
  const subtitle = eventMeta.subtitle ? ` ${eventMeta.subtitle}` : ''
  return `Join ${eventMeta.name}${whereWhen}. Request songs and vote live in Human Jukebox.${subtitle}`.trim()
}

export default async function handler(req, res) {
  const eventId = typeof req.query?.event === 'string' ? req.query.event.trim() : ''
  const origin = toAbsoluteOrigin(req)
  const targetUrl = eventId ? `${origin}/audience?event=${encodeURIComponent(eventId)}` : `${origin}/audience`

  // Real browsers get an immediate redirect — no loading screen, no delay.
  // Only serve the OG meta HTML to social crawlers so link previews work.
  if (!isCrawler(req)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Location', targetUrl)
    res.status(302).end()
    return
  }

  const eventMeta = await fetchEventMeta(eventId)

  const title = eventMeta?.name ? `${eventMeta.name} | Human Jukebox` : DEFAULT_TITLE
  const description = buildDescription(eventMeta)
  const shareUrl = eventId ? `${origin}/a/${encodeURIComponent(eventId)}` : `${origin}/audience`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')

  res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:image" content="${escapeHtml(LOGO_URL)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(LOGO_URL)}" />
    <meta property="og:image:alt" content="The Human Jukebox logo" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(LOGO_URL)}" />
    <link rel="canonical" href="${escapeHtml(shareUrl)}" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(targetUrl)}" />
    <script>
      window.location.replace(${JSON.stringify(targetUrl)});
    </script>
  </head>
  <body>
    <p>Opening Human Jukebox...</p>
  </body>
</html>`)
}