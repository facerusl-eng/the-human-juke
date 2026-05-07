import { useMemo, useState } from 'react'

type Venue = {
  id: string
  name: string
  type: string
  address: string
  website: string
  phone: string
  email: string
  lat: number
  lon: number
  selected: boolean
  contactEmail: string
  notes: string
}

type OutreachResult = {
  venueName: string
  email: string
  ok: boolean
  error?: string
}

type OutreachLogEntry = {
  id: string
  venueName: string
  email: string
  status: 'sent' | 'failed'
  timestamp: string
  error?: string
}

const OUTREACH_LOG_STORAGE_KEY = 'human-jukebox-outreach-log'

function parseLogEntries(raw: string | null): OutreachLogEntry[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function VenueOutreachPage() {
  const [locationQuery, setLocationQuery] = useState('Copenhagen, Denmark')
  const [radiusKm, setRadiusKm] = useState(8)
  const [conceptText, setConceptText] = useState(
    'We run a modern live music and karaoke concept where your guests can request songs live from their phones and vote in real time. We provide full host-led entertainment, energy, and a smooth setup for your venue.\n\nWould you be open to a test night or a recurring collaboration?',
  )
  const [senderName, setSenderName] = useState('Harald')
  const [senderEmail, setSenderEmail] = useState('')
  const [venues, setVenues] = useState<Venue[]>([])
  const [searching, setSearching] = useState(false)
  const [sending, setSending] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [logEntries, setLogEntries] = useState<OutreachLogEntry[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }

    return parseLogEntries(window.localStorage.getItem(OUTREACH_LOG_STORAGE_KEY))
  })

  const selectedCount = useMemo(
    () => venues.filter((venue) => venue.selected).length,
    [venues],
  )

  const withSavedLog = (entries: OutreachLogEntry[]) => {
    setLogEntries(entries)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OUTREACH_LOG_STORAGE_KEY, JSON.stringify(entries))
    }
  }

  const runVenueSearch = async () => {
    setSearching(true)
    setSearchError(null)
    setStatusText(null)

    try {
      const query = new URLSearchParams({
        location: locationQuery,
        radiusKm: String(radiusKm),
        limit: '40',
      })

      const response = await fetch(`/api/venue-search?${query.toString()}`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Venue search failed.')
      }

      const nextVenues: Venue[] = Array.isArray(payload?.venues)
        ? payload.venues.map((venue: Omit<Venue, 'selected' | 'contactEmail' | 'notes'>) => ({
          ...venue,
          selected: false,
          contactEmail: venue.email || '',
          notes: '',
        }))
        : []

      setVenues(nextVenues)
      setStatusText(`Found ${nextVenues.length} nearby places.`)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Failed to search nearby places.')
    } finally {
      setSearching(false)
    }
  }

  const updateVenue = (venueId: string, updates: Partial<Venue>) => {
    setVenues((current) => current.map((venue) => (
      venue.id === venueId
        ? { ...venue, ...updates }
        : venue
    )))
  }

  const toggleSelectAll = () => {
    const shouldSelectAll = venues.some((venue) => !venue.selected)
    setVenues((current) => current.map((venue) => ({ ...venue, selected: shouldSelectAll })))
  }

  const sendOutreach = async () => {
    setSendError(null)
    setStatusText(null)

    const selectedVenues = venues.filter((venue) => venue.selected)

    if (!selectedVenues.length) {
      setSendError('Choose at least one venue to send.')
      return
    }

    const contacts = selectedVenues
      .map((venue) => ({
        venueId: venue.id,
        venueName: venue.name,
        email: venue.contactEmail.trim(),
      }))
      .filter((contact) => contact.email.length > 0)

    if (!contacts.length) {
      setSendError('Add at least one contact email before sending.')
      return
    }

    if (!senderEmail.trim()) {
      setSendError('Sender email is required so venues can reply to you.')
      return
    }

    setSending(true)

    try {
      const response = await fetch('/api/send-outreach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          senderName,
          senderEmail,
          conceptText,
          contacts,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to send outreach emails.')
      }

      const results = Array.isArray(payload?.results) ? payload.results as OutreachResult[] : []
      const nowIso = new Date().toISOString()

      const freshLogs: OutreachLogEntry[] = results.map((result) => ({
        id: `${result.venueName}-${result.email}-${nowIso}`,
        venueName: result.venueName,
        email: result.email,
        status: result.ok ? 'sent' : 'failed',
        timestamp: nowIso,
        error: result.error,
      }))

      withSavedLog([...
        freshLogs,
        ...logEntries,
      ].slice(0, 300))

      setStatusText(`Sent ${payload.successCount ?? 0} email(s). Failed: ${payload.failureCount ?? 0}.`)

      const failedEmailSet = new Set(
        results
          .filter((result) => !result.ok)
          .map((result) => `${result.venueName.toLowerCase()}::${result.email.toLowerCase()}`),
      )

      setVenues((current) => current.map((venue) => {
        const key = `${venue.name.toLowerCase()}::${venue.contactEmail.trim().toLowerCase()}`
        return {
          ...venue,
          selected: failedEmailSet.has(key),
        }
      }))
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Failed to send outreach emails.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="create-gig-shell" aria-label="Venue outreach manager">
      <section className="hero-card create-gig-card">
        <p className="eyebrow">Admin</p>
        <h1>Venue Outreach Manager</h1>
        <p className="subcopy">
          Find nearby pubs and places to perform, pick contacts, and send your concept email from one panel.
        </p>
      </section>

      <section className="queue-panel">
        <div className="form-grid two-col">
          <label>
            Search area
            <input
              value={locationQuery}
              onChange={(event) => setLocationQuery(event.target.value)}
              placeholder="City or area"
              className="queue-input"
            />
          </label>
          <label>
            Radius (km)
            <input
              type="number"
              min={1}
              max={30}
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value) || 1)}
              className="queue-input"
            />
          </label>
          <label>
            Your name
            <input
              value={senderName}
              onChange={(event) => setSenderName(event.target.value)}
              className="queue-input"
            />
          </label>
          <label>
            Reply-to email
            <input
              type="email"
              value={senderEmail}
              onChange={(event) => setSenderEmail(event.target.value)}
              placeholder="you@example.com"
              className="queue-input"
            />
          </label>
        </div>

        <label>
          Concept message
          <textarea
            value={conceptText}
            onChange={(event) => setConceptText(event.target.value)}
            className="queue-input"
            rows={6}
          />
        </label>

        <div className="hero-actions no-margin-bottom">
          <button type="button" className="secondary-button" onClick={() => void runVenueSearch()} disabled={searching || sending}>
            {searching ? 'Searching…' : 'Find Nearby Venues'}
          </button>
          <button type="button" className="primary-button" onClick={() => void sendOutreach()} disabled={sending || searching}>
            {sending ? 'Sending…' : `Send Concept to Selected (${selectedCount})`}
          </button>
          <button type="button" className="secondary-button" onClick={toggleSelectAll} disabled={!venues.length || sending || searching}>
            Toggle Select All
          </button>
        </div>

        {searchError ? <p className="error-text">{searchError}</p> : null}
        {sendError ? <p className="error-text">{sendError}</p> : null}
        {statusText ? <p className="subcopy">{statusText}</p> : null}
      </section>

      <section className="queue-panel" aria-label="Nearby venues">
        <div className="panel-head">
          <h2>Nearby Venues</h2>
          <span className="meta-badge">{venues.length} found</span>
        </div>

        {venues.length === 0 ? (
          <p className="subcopy no-margin-bottom">Run a search to load nearby pubs and places.</p>
        ) : (
          <ul className="gig-management-list">
            {venues.map((venue) => (
              <li key={venue.id} className="gig-management-entry">
                <div className="gig-management-main">
                  <div className="gig-management-title-row">
                    <label className="queue-toggle" style={{ gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={venue.selected}
                        onChange={(event) => updateVenue(venue.id, { selected: event.target.checked })}
                      />
                      <span className="gig-management-title">{venue.name}</span>
                    </label>
                    <span className="meta-badge">{venue.type}</span>
                  </div>
                  <p className="gig-management-meta">{venue.address || 'No address listed'}</p>
                  <p className="gig-management-meta">
                    {venue.website ? <a href={venue.website} target="_blank" rel="noreferrer">Website</a> : 'No website listed'}
                    {venue.phone ? ` · ${venue.phone}` : ''}
                  </p>
                  <div className="form-grid two-col">
                    <label>
                      Contact email
                      <input
                        type="email"
                        value={venue.contactEmail}
                        onChange={(event) => updateVenue(venue.id, { contactEmail: event.target.value })}
                        placeholder="booking@venue.com"
                        className="queue-input"
                      />
                    </label>
                    <label>
                      Note (optional)
                      <input
                        value={venue.notes}
                        onChange={(event) => updateVenue(venue.id, { notes: event.target.value })}
                        placeholder="Best day to call"
                        className="queue-input"
                      />
                    </label>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="queue-panel" aria-label="Outreach log">
        <div className="panel-head">
          <h2>Outreach Log</h2>
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              onClick={() => withSavedLog([])}
              disabled={!logEntries.length}
            >
              Clear Log
            </button>
          </div>
        </div>

        {logEntries.length === 0 ? (
          <p className="subcopy no-margin-bottom">No outreach sent yet.</p>
        ) : (
          <ul className="gig-management-list">
            {logEntries.slice(0, 80).map((entry) => (
              <li key={entry.id} className="gig-management-entry">
                <div className="gig-management-main">
                  <div className="gig-management-title-row">
                    <p className="gig-management-title">{entry.venueName}</p>
                    <span className="meta-badge">{entry.status === 'sent' ? 'Sent' : 'Failed'}</span>
                  </div>
                  <p className="gig-management-meta">{entry.email}</p>
                  <p className="gig-management-meta">{new Date(entry.timestamp).toLocaleString()}</p>
                  {entry.error ? <p className="error-text">{entry.error}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}

export default VenueOutreachPage
