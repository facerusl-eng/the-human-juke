function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value))
}

function normalizeTimeForDate(value) {
  const normalized = clean(value)
  if (!normalized) return null
  return normalized.length > 5 && normalized[2] === ':' && normalized[5] === ':'
    ? normalized.slice(0, 5)
    : normalized
}

function toIcsDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  // Floating local time (no timezone suffix) — appears at correct clock time in any calendar
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`
}

function toIcsUtcDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`
}

/** Escape ICS TEXT values per RFC 5545 §3.3.11 */
function escapeText(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n')
}

/** Fold long lines per RFC 5545 §3.1 — max 75 octets per line */
function foldLine(line) {
  const MAX = 75
  if (line.length <= MAX) return line
  let folded = ''
  let pos = 0
  while (pos < line.length) {
    if (pos === 0) {
      folded += line.slice(0, MAX)
      pos = MAX
    } else {
      folded += '\r\n ' + line.slice(pos, pos + MAX - 1)
      pos += MAX - 1
    }
  }
  return folded
}

function buildDateRange(gigDate, gigStartTime, gigEndTime) {
  if (!gigDate) return null

  const normalizedStart = normalizeTimeForDate(gigStartTime) ?? '18:00'
  const startDate = new Date(`${gigDate}T${normalizedStart}:00`)
  if (Number.isNaN(startDate.getTime())) return null

  if (gigEndTime) {
    const normalizedEnd = normalizeTimeForDate(gigEndTime)
    const candidateEnd = new Date(`${gigDate}T${normalizedEnd}:00`)
    if (!Number.isNaN(candidateEnd.getTime())) {
      return { startDate, endDate: candidateEnd }
    }
  }

  return { startDate, endDate: new Date(startDate.getTime() + 2 * 60 * 60 * 1000) }
}

function sanitizeText(value) {
  return clean(value).replace(/[\r\n]/g, ' ')
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).send('Method Not Allowed')
    return
  }

  const eventId = clean(req.query?.event)
  if (!eventId) {
    res.status(400).send('Missing event id')
    return
  }

  if (!isUuid(eventId)) {
    res.status(400).send('Invalid event id')
    return
  }

  const supabaseUrl = clean(process.env.VITE_SUPABASE_URL)
  const supabaseAnonKey = clean(process.env.VITE_SUPABASE_ANON_KEY)
  const supabasePublishableKey = clean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const publishableKey = supabaseAnonKey || supabasePublishableKey

  if (!supabaseUrl || !publishableKey) {
    res.status(500).send('Supabase env vars not configured')
    return
  }

  const apiUrl = `${supabaseUrl}/rest/v1/events?select=id,name,venue,gig_date,gig_start_time,gig_end_time&id=eq.${encodeURIComponent(eventId)}&limit=1`

  try {
    const response = await fetch(apiUrl, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      res.status(502).send('Failed to load event')
      return
    }

    const payload = await response.json().catch(() => [])
    const event = Array.isArray(payload) ? payload[0] : null

    if (!event) {
      res.status(404).send('Event not found')
      return
    }

    const range = buildDateRange(event.gig_date, event.gig_start_time, event.gig_end_time)
    if (!range) {
      res.status(422).send('Event date/time is invalid')
      return
    }

    const name = sanitizeText(event.name) || 'Human Jukebox Event'
    const venue = sanitizeText(event.venue)
    const eventUrl = `https://www.the-human-jukebox.org/audience?event=${encodeURIComponent(event.id)}`
    const dtstamp = toIcsUtcDate(new Date())

    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Human Jukebox//Human Jukebox App 1.0//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Human Jukebox Events',
      'X-WR-TIMEZONE:Europe/Copenhagen',
      'BEGIN:VEVENT',
      `UID:${event.id}@the-human-jukebox.org`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${toIcsDate(range.startDate)}`,
      `DTEND:${toIcsDate(range.endDate)}`,
      `SUMMARY:${escapeText(name)}`,
      venue ? `LOCATION:${escapeText(venue)}` : null,
      `URL:${eventUrl}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).map(foldLine).join('\r\n')

    const fileName = `${name.replace(/[^a-z0-9\-_. ]/gi, '').trim() || 'event'}.ics`

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300')
    res.status(200).send(icsLines)
  } catch {
    res.status(502).send('Calendar export failed')
  }
}
