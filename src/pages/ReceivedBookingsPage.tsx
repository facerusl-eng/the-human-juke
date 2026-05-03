import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

type BookingStatus = 'new' | 'reviewed' | 'declined'

type BookingRequest = {
  id: string
  created_at: string
  venue_name: string
  venue_address: string
  contact_person_name: string
  email: string
  phone_number: string
  preferred_date: string
  preferred_start_time: string
  event_type: string
  estimated_guests: number
  frequency: string
  additional_message: string | null
  status: BookingStatus
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatTime(timeStr: string) {
  try {
    const [h, m] = timeStr.split(':')
    const d = new Date()
    d.setHours(Number(h), Number(m))
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return timeStr
  }
}

const STATUS_LABELS: Record<BookingStatus, string> = {
  new: '🟡 New',
  reviewed: '🟢 Reviewed',
  declined: '🔴 Declined',
}

function ReceivedBookingsPage() {
  const [bookings, setBookings] = useState<BookingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadBookings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('booking_requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (fetchError) throw fetchError
      setBookings((data as BookingRequest[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadBookings() }, [loadBookings])

  const updateStatus = async (id: string, status: BookingStatus) => {
    setUpdatingId(id)
    try {
      const { error: updateError } = await supabase
        .from('booking_requests')
        .update({ status })
        .eq('id', id)
      if (updateError) throw updateError
      setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status } : b))
    } catch (err) {
      console.error('Failed to update booking status', err)
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <section className="create-gig-shell received-bookings-shell" aria-label="Received bookings">
      <section className="hero-card create-gig-card">
        <p className="eyebrow">Admin</p>
        <h1>Received Booking Requests</h1>
        <p className="subcopy">All booking inquiries submitted via the public booking form.</p>
      </section>

      {loading ? (
        <section className="queue-panel">
          <p className="subcopy">Loading bookings…</p>
        </section>
      ) : error ? (
        <section className="queue-panel">
          <p className="error-text">{error}</p>
          <button type="button" className="secondary-button" onClick={loadBookings}>Retry</button>
        </section>
      ) : bookings.length === 0 ? (
        <section className="queue-panel">
          <p className="subcopy">No booking requests yet.</p>
        </section>
      ) : (
        <section className="queue-panel received-bookings-list" aria-label="Booking requests">
          {bookings.map((booking) => {
            const isExpanded = expandedId === booking.id
            return (
              <article key={booking.id} className={`received-booking-card${booking.status === 'new' ? ' received-booking-card-new' : ''}`}>
                <div className="received-booking-head">
                  <div className="received-booking-summary">
                    <span className="meta-badge received-booking-status-badge">{STATUS_LABELS[booking.status] ?? booking.status}</span>
                    <p className="received-booking-venue">{booking.venue_name}</p>
                    <p className="received-booking-meta">{formatDate(booking.preferred_date)} · {formatTime(booking.preferred_start_time)} · {booking.event_type}</p>
                  </div>
                  <div className="received-booking-actions">
                    <button
                      type="button"
                      className="secondary-button received-booking-expand-btn"
                      onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="received-booking-detail">
                    <div className="received-booking-detail-grid">
                      <div>
                        <p className="received-booking-label">Contact</p>
                        <p>{booking.contact_person_name}</p>
                        <p><a href={`mailto:${booking.email}`}>{booking.email}</a></p>
                        <p>{booking.phone_number}</p>
                      </div>
                      <div>
                        <p className="received-booking-label">Venue</p>
                        <p>{booking.venue_name}</p>
                        <p className="subcopy">{booking.venue_address}</p>
                      </div>
                      <div>
                        <p className="received-booking-label">Event</p>
                        <p>{booking.event_type} · {booking.estimated_guests} guests</p>
                        <p className="subcopy">{booking.frequency}</p>
                      </div>
                      <div>
                        <p className="received-booking-label">Date &amp; Time</p>
                        <p>{formatDate(booking.preferred_date)}</p>
                        <p className="subcopy">{formatTime(booking.preferred_start_time)}</p>
                      </div>
                    </div>
                    {booking.additional_message ? (
                      <div className="received-booking-message">
                        <p className="received-booking-label">Message</p>
                        <p>{booking.additional_message}</p>
                      </div>
                    ) : null}
                    <p className="received-booking-received">Received {formatDate(booking.created_at)}</p>
                    <div className="received-booking-status-actions">
                      {(['new', 'reviewed', 'declined'] as BookingStatus[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`secondary-button${booking.status === s ? ' received-booking-status-active' : ''}`}
                          disabled={booking.status === s || updatingId === booking.id}
                          onClick={() => void updateStatus(booking.id, s)}
                        >
                          {STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>
      )}
    </section>
  )
}

export default ReceivedBookingsPage
