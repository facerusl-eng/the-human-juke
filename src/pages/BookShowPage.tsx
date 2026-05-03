import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

type EventType = 'karaoke' | 'live jukebox' | 'private party' | 'other'
type FrequencyType = 'one-time' | 'weekly' | 'monthly' | 'special event'

type BookingFormState = {
  venueName: string
  venueAddress: string
  contactPersonName: string
  email: string
  phoneNumber: string
  preferredDate: string
  preferredStartTime: string
  eventType: '' | EventType
  estimatedGuests: string
  frequency: '' | FrequencyType
  additionalMessage: string
  authorized: boolean
}

type BookingFormErrors = Partial<Record<keyof BookingFormState, string>>

const INITIAL_FORM_STATE: BookingFormState = {
  venueName: '',
  venueAddress: '',
  contactPersonName: '',
  email: '',
  phoneNumber: '',
  preferredDate: '',
  preferredStartTime: '',
  eventType: '',
  estimatedGuests: '',
  frequency: '',
  additionalMessage: '',
  authorized: false,
}

function validateBookingForm(state: BookingFormState): BookingFormErrors {
  const errors: BookingFormErrors = {}

  if (!state.venueName.trim()) errors.venueName = 'Venue name is required.'
  if (!state.venueAddress.trim()) errors.venueAddress = 'Venue address is required.'
  if (!state.contactPersonName.trim()) errors.contactPersonName = 'Contact person name is required.'

  const normalizedEmail = state.email.trim()
  if (!normalizedEmail) {
    errors.email = 'Email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    errors.email = 'Please enter a valid email address.'
  }

  if (!state.phoneNumber.trim()) errors.phoneNumber = 'Phone number is required.'
  if (!state.preferredDate) errors.preferredDate = 'Preferred date is required.'
  if (!state.preferredStartTime) errors.preferredStartTime = 'Preferred start time is required.'
  if (!state.eventType) errors.eventType = 'Type of event is required.'
  if (!state.frequency) errors.frequency = 'Frequency is required.'

  if (!state.estimatedGuests.trim()) {
    errors.estimatedGuests = 'Estimated number of guests is required.'
  } else {
    const numericGuests = Number(state.estimatedGuests)

    if (!Number.isFinite(numericGuests) || numericGuests <= 0) {
      errors.estimatedGuests = 'Please enter a valid guest count.'
    }
  }

  if (!state.authorized) {
    errors.authorized = 'You must confirm authorization to submit this booking request.'
  }

  return errors
}

function BookShowPage() {
  const [formState, setFormState] = useState<BookingFormState>(INITIAL_FORM_STATE)
  const [errors, setErrors] = useState<BookingFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const hasErrors = useMemo(() => Object.keys(errors).length > 0, [errors])

  const updateField = <K extends keyof BookingFormState>(key: K, value: BookingFormState[K]) => {
    setFormState((current) => ({ ...current, [key]: value }))
    setSubmitSuccess(null)
    setSubmitError(null)

    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const validationErrors = validateBookingForm(formState)
    setErrors(validationErrors)

    if (Object.keys(validationErrors).length > 0) {
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(null)

    try {
      const response = await fetch('/api/book-show', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          venueName: formState.venueName.trim(),
          venueAddress: formState.venueAddress.trim(),
          contactPersonName: formState.contactPersonName.trim(),
          email: formState.email.trim(),
          phoneNumber: formState.phoneNumber.trim(),
          preferredDate: formState.preferredDate,
          preferredStartTime: formState.preferredStartTime,
          eventType: formState.eventType,
          estimatedGuests: Number(formState.estimatedGuests),
          frequency: formState.frequency,
          additionalMessage: formState.additionalMessage.trim(),
          authorized: formState.authorized,
        }),
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        const message = payload && typeof payload.error === 'string'
          ? payload.error
          : 'Unable to send booking request right now. Please try again.'
        throw new Error(message)
      }

      setSubmitSuccess('Thank you! Your booking request has been sent.')
      setFormState(INITIAL_FORM_STATE)
      setErrors({})
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to send booking request right now. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="book-show-shell" aria-label="Book show page">
      <article className="queue-panel book-show-panel">
        <header className="book-show-header">
          <p className="eyebrow">Booking Request</p>
          <h1>Book The Human Jukebox</h1>
          <p className="subcopy">Tell us about your venue and event. We will follow up to confirm availability and details.</p>
        </header>

        <form className="book-show-form" onSubmit={onSubmit} noValidate>
          <label className="book-show-field">
            <span>Venue name</span>
            <input
              type="text"
              value={formState.venueName}
              onChange={(event) => updateField('venueName', event.target.value)}
              required
            />
            {errors.venueName ? <span className="error-text">{errors.venueName}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Venue address</span>
            <input
              type="text"
              value={formState.venueAddress}
              onChange={(event) => updateField('venueAddress', event.target.value)}
              required
            />
            {errors.venueAddress ? <span className="error-text">{errors.venueAddress}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Contact person name</span>
            <input
              type="text"
              value={formState.contactPersonName}
              onChange={(event) => updateField('contactPersonName', event.target.value)}
              required
            />
            {errors.contactPersonName ? <span className="error-text">{errors.contactPersonName}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Email</span>
            <input
              type="email"
              value={formState.email}
              onChange={(event) => updateField('email', event.target.value)}
              required
            />
            {errors.email ? <span className="error-text">{errors.email}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Phone number</span>
            <input
              type="text"
              value={formState.phoneNumber}
              onChange={(event) => updateField('phoneNumber', event.target.value)}
              required
            />
            {errors.phoneNumber ? <span className="error-text">{errors.phoneNumber}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Preferred date</span>
            <input
              type="date"
              value={formState.preferredDate}
              onChange={(event) => updateField('preferredDate', event.target.value)}
              required
            />
            {errors.preferredDate ? <span className="error-text">{errors.preferredDate}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Preferred start time</span>
            <input
              type="time"
              value={formState.preferredStartTime}
              onChange={(event) => updateField('preferredStartTime', event.target.value)}
              required
            />
            {errors.preferredStartTime ? <span className="error-text">{errors.preferredStartTime}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Type of event</span>
            <select
              value={formState.eventType}
              onChange={(event) => updateField('eventType', event.target.value as BookingFormState['eventType'])}
              required
            >
              <option value="">Select event type</option>
              <option value="karaoke">Karaoke</option>
              <option value="live jukebox">Live Jukebox</option>
              <option value="private party">Private Party</option>
              <option value="other">Other</option>
            </select>
            {errors.eventType ? <span className="error-text">{errors.eventType}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Estimated number of guests</span>
            <input
              type="number"
              min={1}
              value={formState.estimatedGuests}
              onChange={(event) => updateField('estimatedGuests', event.target.value)}
              required
            />
            {errors.estimatedGuests ? <span className="error-text">{errors.estimatedGuests}</span> : null}
          </label>

          <label className="book-show-field">
            <span>Frequency</span>
            <select
              value={formState.frequency}
              onChange={(event) => updateField('frequency', event.target.value as BookingFormState['frequency'])}
              required
            >
              <option value="">Select frequency</option>
              <option value="one-time">One-time</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="special event">Special event</option>
            </select>
            {errors.frequency ? <span className="error-text">{errors.frequency}</span> : null}
          </label>

          <label className="book-show-field book-show-field-full">
            <span>Additional message</span>
            <textarea
              rows={5}
              value={formState.additionalMessage}
              onChange={(event) => updateField('additionalMessage', event.target.value)}
              placeholder="Tell us anything else we should know about your event."
            />
          </label>

          <label className="book-show-checkbox book-show-field-full">
            <input
              type="checkbox"
              checked={formState.authorized}
              onChange={(event) => updateField('authorized', event.target.checked)}
              required
            />
            <span>I confirm I am authorized to book events for this venue</span>
          </label>
          {errors.authorized ? <p className="error-text book-show-field-full">{errors.authorized}</p> : null}

          <div className="book-show-actions book-show-field-full">
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Sending booking request...' : 'Send booking request'}
            </button>
          </div>

          {hasErrors ? <p className="subcopy book-show-field-full">Please fix the highlighted fields and submit again.</p> : null}
          {submitError ? <p className="error-text book-show-field-full">{submitError}</p> : null}
          {submitSuccess ? <p className="book-show-success book-show-field-full">{submitSuccess}</p> : null}
        </form>
      </article>
    </section>
  )
}

export default BookShowPage