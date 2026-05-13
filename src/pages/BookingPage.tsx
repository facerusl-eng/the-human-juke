import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getBookingManagerUrl } from '../lib/booking'
import '../styles/booking-page.css'

function BookingPage() {
  const location = useLocation()

  const bookingUrl = useMemo(() => {
    const url = new URL(getBookingManagerUrl())
    const searchParams = new URLSearchParams(location.search)

    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value)
    })

    return url.toString()
  }, [location.search])

  return (
    <section className="booking-page-shell" aria-label="Booking">
      <section className="booking-page-header">
        <p className="eyebrow">Booking</p>
        <h1>Book The Human Jukebox</h1>
        <p className="subcopy">
          Fill out the form below and you will receive a reply as soon as possible.
        </p>
        <Link to="/" className="secondary-button booking-page-back-link">Back to home</Link>
      </section>
      <div className="booking-page-frame-shell">
        <iframe
          src={bookingUrl}
          title="Booking form"
          loading="lazy"
          className="booking-page-frame"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </section>
  )
}

export default BookingPage
