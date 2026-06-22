/**
 * RFC 5545 compliant ICS (iCalendar) utilities.
 * Generates .ics files that work with Apple Calendar, Google Calendar,
 * Outlook, and Android calendar apps.
 */

export type ICSEventData = {
  /** Unique identifier, e.g. "event-id@the-human-jukebox.org" */
  uid: string
  title: string
  /** Local start time (no timezone conversion applied — floating time) */
  startDate: Date
  /** Local end time */
  endDate: Date
  location?: string | null
  description?: string | null
  /** URL to the event page */
  url?: string | null
}

/** Pad a number to 2 digits */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Format a Date as an ICS "floating" local datetime (no timezone suffix).
 * Floating times appear at the same clock time regardless of the viewer's timezone —
 * ideal for live events where the time is already in the venue's local time.
 */
function toICSLocalDateTime(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}00`
  )
}

/**
 * Format a Date as an ICS UTC datetime (Z suffix).
 * Used for DTSTAMP which must always be UTC per RFC 5545.
 */
function toICSUtcDateTime(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`
  )
}

/**
 * Escape special characters in ICS TEXT values per RFC 5545 §3.3.11.
 * Escapes: backslash, semicolon, comma, newline.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n')
}

/**
 * Fold long ICS property lines per RFC 5545 §3.1.
 * Lines MUST NOT be longer than 75 octets (bytes). Long lines are folded
 * by inserting CRLF + a single space before the continuation.
 */
function foldLine(line: string): string {
  const MAX_BYTES = 75
  // Work with UTF-8 bytes for accurate byte-count folding
  const encoder = new TextEncoder()
  const bytes = encoder.encode(line)

  if (bytes.length <= MAX_BYTES) return line

  const decoder = new TextDecoder()
  const chunks: string[] = []
  let offset = 0
  let isFirst = true

  while (offset < bytes.length) {
    const limit = isFirst ? MAX_BYTES : MAX_BYTES - 1 // account for leading space
    // Avoid splitting a multi-byte UTF-8 sequence
    let end = offset + limit
    while (end > offset && (bytes[end] & 0xc0) === 0x80) end--
    chunks.push(decoder.decode(bytes.slice(offset, end)))
    offset = end
    isFirst = false
  }

  return chunks.join('\r\n ')
}

/**
 * Build a complete RFC 5545 VCALENDAR string.
 */
export function createICSContent(event: ICSEventData): string {
  const dtstamp = toICSUtcDateTime(new Date())
  const dtstart = toICSLocalDateTime(event.startDate)
  const dtend = toICSLocalDateTime(event.endDate)

  const properties: Array<string | null> = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Human Jukebox//Human Jukebox App 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // Apple Calendar hint
    'X-WR-CALNAME:Human Jukebox Events',
    'X-WR-TIMEZONE:Europe/Copenhagen',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeText(event.title)}`,
    event.location ? `LOCATION:${escapeText(event.location)}` : null,
    event.description ? `DESCRIPTION:${escapeText(event.description)}` : null,
    event.url ? `URL:${event.url}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return properties
    .filter((line): line is string => line !== null)
    .map(foldLine)
    .join('\r\n')
}

/**
 * Trigger a download of the .ics file in the browser.
 * On iOS Safari this opens the file directly in the Calendar app.
 * On Android, Chrome downloads the file and the system handles it.
 * On desktop it downloads as a file.
 */
export function downloadICSFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.ics') ? filename : `${filename}.ics`
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  // Cleanup after a short delay to allow the download to start
  setTimeout(() => {
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }, 150)
}

/** Strip seconds from a Postgres 'HH:MM:SS' time string */
function normalizeTime(t: string | null): string {
  if (!t) return '18:00'
  const s = t.trim()
  return s.length > 5 && s[2] === ':' && s[5] === ':' ? s.slice(0, 5) : s
}

export type CalendarEventInput = {
  id: string
  name: string
  gigDate: string | null
  gigStartTime: string | null
  gigEndTime: string | null
  venue?: string | null
  description?: string | null
  eventPageUrl?: string | null
}

/**
 * High-level helper: build ICS content from a Human Jukebox event object.
 * Returns null if the event date is missing or invalid.
 */
export function createICSFromEvent(event: CalendarEventInput): { content: string; filename: string } | null {
  if (!event.gigDate) return null

  const startTime = normalizeTime(event.gigStartTime)
  const startDate = new Date(`${event.gigDate}T${startTime}:00`)
  if (Number.isNaN(startDate.getTime())) return null

  let endDate: Date
  if (event.gigEndTime) {
    const endTime = normalizeTime(event.gigEndTime)
    const candidate = new Date(`${event.gigDate}T${endTime}:00`)
    if (Number.isNaN(candidate.getTime())) {
      endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000)
    } else {
      // End times that are earlier than (or equal to) the start are treated as next-day overnight gigs.
      if (candidate.getTime() <= startDate.getTime()) {
        candidate.setDate(candidate.getDate() + 1)
      }
      endDate = candidate
    }
  } else {
    endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000)
  }

  const origin = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://www.the-human-jukebox.org'

  const url = event.eventPageUrl ?? `${origin}/audience?event=${encodeURIComponent(event.id)}`

  const content = createICSContent({
    uid: `${event.id}@the-human-jukebox.org`,
    title: event.name,
    startDate,
    endDate,
    location: event.venue ?? null,
    description: event.description ?? null,
    url,
  })

  const safeName = event.name.replace(/[^a-z0-9\-_. ]/gi, '').trim() || 'event'
  const filename = `${safeName}.ics`

  return { content, filename }
}
