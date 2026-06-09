import { useState } from 'react'
import { createICSFromEvent, downloadICSFile, type CalendarEventInput } from '../lib/icsUtils'

type Props = {
  event: CalendarEventInput
  /** CSS class(es) for the button. Defaults to the app's secondary-button style. */
  className?: string
  /** Button label text. Defaults to "📅 Add to Calendar" */
  label?: string
  /** Label shown briefly after a successful download */
  successLabel?: string
}

/**
 * A reusable "Add to Calendar" button that generates a standards-compliant
 * .ics file client-side and triggers a browser download.
 *
 * Compatible with:
 * - Apple Calendar (iOS + macOS): Safari opens .ics directly in Calendar app
 * - Google Calendar: prompts to import the downloaded file
 * - Outlook (desktop + web): imports via file open or drag-and-drop
 * - Android calendar apps: system handles .ics via default calendar app
 *
 * Follows RFC 5545 (iCalendar) with proper line folding, TEXT escaping,
 * UTC DTSTAMP, and floating local DTSTART/DTEND for venue-correct times.
 */
export default function AddToCalendarButton({
  event,
  className = 'secondary-button',
  label = '📅 Add to Calendar',
  successLabel = '✓ Added to Calendar',
}: Props) {
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const handleClick = () => {
    const result = createICSFromEvent(event)

    if (!result) {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
      return
    }

    downloadICSFile(result.content, result.filename)
    setStatus('success')
    setTimeout(() => setStatus('idle'), 4000)
  }

  return (
    <button
      type="button"
      className={`${className}${status === 'success' ? ' add-to-calendar-success' : ''}`}
      onClick={handleClick}
      aria-label={`Add ${event.name} to calendar`}
      disabled={status === 'success'}
    >
      {status === 'success'
        ? successLabel
        : status === 'error'
        ? '⚠ Date unavailable'
        : label}
    </button>
  )
}
