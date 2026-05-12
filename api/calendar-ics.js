function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
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
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`
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

  const supabaseUrl = clean(process.env.VITE_SUPABASE_URL)
  const supabaseAnonKey = clean(process.env.VITE_SUPABASE_ANON_KEY)
  const supabasePublishableKey = clean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const publishableKey = supabaseAnonKey || supabasePublishableKey

  if (!supabaseUrl || !publishableKey) {
    res.status(500).send('Supabase env vars not configured')
    return
  }

  const apiUrl = `${supabaseUrl}/rest/v1/events?select=id,name,venue&id=eq.${encodeURIComponent(eventId)}&limit=1`

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

    // Fetch additional event details in a second query if needed
    const range = event.gig_date ? buildDateRange(event.gig_date, event.gig_start_time, event.gig_end_time) : null
    if (!range && event.gig_date) {
      res.status(422).send('Event date/time is invalid')
      return
    }

    // If we don't have date/time info yet, fetch it separately
    if (!range) {
      const dateUrl = `${supabaseUrl}/rest/v1/events?select=gig_date,gig_start_time,gig_end_time&id=eq.${encodeURIComponent(eventId)}&limit=1`
      try {
        const dateResponse = await fetch(dateUrl, {
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${publishableKey}`,
            Accept: 'application/json',
          },
        })
        if (dateResponse.ok) {
          const datePayload = await dateResponse.json().catch(() => ({}))
          const dateEvent = Array.isArray(datePayload) ? datePayload[0] : datePayload
          if (dateEvent?.gig_date) {
            const dateRange = buildDateRange(dateEvent.gig_date, dateEvent.gig_start_time, dateEvent.gig_end_time)
            if (dateRange) {
              event.gig_date = dateEvent.gig_date
              event.gig_start_time = dateEvent.gig_start_time
              event.gig_end_time = dateEvent.gig_end_time
            }
          }
        }
      } catch {
        // Silently fail - we'll use the event data we have
      }
    }

    const name = sanitizeText(event.name) || 'Human Jukebox Event'
    const venue = sanitizeText(event.venue)

    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Human Jukebox//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${event.id}@the-human-jukebox.org`,
      `DTSTART:${toIcsDate(range.startDate)}`,
      `DTEND:${toIcsDate(range.endDate)}`,
      `SUMMARY:${name}`,
      venue ? `LOCATION:${venue}` : null,
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n')

    const fileName = `${name.replace(/[^a-z0-9\-_. ]/gi, '').trim() || 'event'}.ics`

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300')
    res.status(200).send(icsLines)
  } catch {
    res.status(502).send('Calendar export failed')
  }
}
