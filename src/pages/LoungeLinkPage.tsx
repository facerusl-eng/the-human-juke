import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function normalizeExternalLink(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return null
  }

  if (trimmedValue.startsWith('http://') || trimmedValue.startsWith('https://')) {
    return trimmedValue
  }

  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmedValue)) {
    return `https://${trimmedValue}`
  }

  return null
}

function resolveSafeBackPath(search: string): string {
  const params = new URLSearchParams(search)
  const backPath = params.get('back')?.trim() ?? ''
  const returnIndex = Math.floor(Math.random() * 10_000)

  if (backPath.startsWith('/') && !backPath.startsWith('//')) {
    try {
      const parsedBackUrl = new URL(backPath, window.location.origin)
      parsedBackUrl.searchParams.set('rm', 'bar')
      parsedBackUrl.searchParams.set('ri', String(returnIndex))
      return `${parsedBackUrl.pathname}${parsedBackUrl.search}`
    } catch {
      return '/qr-landing?rm=bar&ri=0'
    }
  }

  return `/qr-landing?rm=bar&ri=${returnIndex}`
}

function resolveLoungeDestination(search: string) {
  const params = new URLSearchParams(search)
  const explicitPath = params.get('to')?.trim() ?? ''
  const isTestPreviewMode = params.get('test') === '1'
  const locale = params.get('locale')?.trim() || params.get('lang')?.trim() || ''
  const countdownTargetMs = params.get('ct')?.trim() || params.get('countdownTargetMs')?.trim() || ''
  const audienceLinkVersion = params.get('v')?.trim() || ''

  const audienceParams = new URLSearchParams()

  if (isTestPreviewMode) {
    audienceParams.set('test', '1')
  }

  if (locale) {
    audienceParams.set('locale', locale)
  }

  if (countdownTargetMs) {
    audienceParams.set('ct', countdownTargetMs)
  }

  if (audienceLinkVersion) {
    audienceParams.set('v', audienceLinkVersion)
  }

  // Allow same-site route redirects only.
  if (explicitPath.startsWith('/') && !explicitPath.startsWith('//')) {
    return explicitPath
  }

  const eventId = params.get('event')?.trim() || params.get('eventId')?.trim()

  if (eventId) {
    audienceParams.set('event', eventId)
    return `/audience?${audienceParams.toString()}`
  }

  const audienceQueryString = audienceParams.toString()
  return audienceQueryString ? `/audience?${audienceQueryString}` : '/audience'
}

function LoungeLinkPage() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const mode = useMemo(() => {
    const params = new URLSearchParams(search)
    const rawMode = params.get('mode')?.trim().toLowerCase()
    return rawMode === 'bar' ? 'bar' : 'lounge'
  }, [search])
  const destination = useMemo(() => resolveLoungeDestination(search), [search])
  const customLink = useMemo(() => {
    const params = new URLSearchParams(search)
    return normalizeExternalLink(params.get('url'))
  }, [search])
  const backToWelcomePath = useMemo(() => resolveSafeBackPath(search), [search])
  const destinationHref = customLink ?? destination
  const openButtonLabel = mode === 'bar' ? 'Check out the bar' : 'Open the Lounge'
  const panelLabel = mode === 'bar' ? 'Bar choices' : 'Audience lounge'
  const showOpenButton = mode !== 'bar'

  if (destinationHref) {
    return (
      <section className="app-shell" aria-label="QR destination viewer" style={{ minHeight: '100dvh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
        <section
          className="queue-panel"
          style={{
            margin: 0,
            borderRadius: 0,
            padding: '0.85rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.85rem',
            flexWrap: 'wrap',
          }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>{panelLabel}</p>
          <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
            {showOpenButton ? (
              <a href={destinationHref} target="_blank" rel="noopener noreferrer" className="qr-landing-button qr-landing-button-link">
                {openButtonLabel}
              </a>
            ) : null}
            <button type="button" className="qr-landing-button qr-landing-button-back" onClick={() => navigate(backToWelcomePath, { replace: true })}>
              Back to Start
            </button>
          </div>
        </section>
        <iframe
          src={destinationHref}
          title={panelLabel}
          style={{ width: '100%', height: '100%', border: 'none', background: '#060a1a' }}
          referrerPolicy="no-referrer"
        />
      </section>
    )
  }

  return (
    <section className="app-shell" aria-label="Opening lounge link">
      <section className="queue-panel">
        <p className="eyebrow">Quick Choice</p>
        <h1>{mode === 'bar' ? 'Bar route selected' : 'Lounge route selected'}</h1>
        <p className="subcopy">
          Open your destination in a new tab, or jump straight back to the QR choice screen.
        </p>
        <div style={{ display: 'grid', gap: '0.8rem', marginTop: '1rem' }}>
          <a href={destinationHref} target="_blank" rel="noopener noreferrer" className="qr-landing-button qr-landing-button-link">
            {openButtonLabel}
          </a>
          <button type="button" className="qr-landing-button qr-landing-button-back" onClick={() => navigate(backToWelcomePath, { replace: true })}>
            Back to Start
          </button>
        </div>
      </section>
    </section>
  )
}

export default LoungeLinkPage
