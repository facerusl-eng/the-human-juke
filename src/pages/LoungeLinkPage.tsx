import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function resolveSameSitePath(rawPath: string, fallbackPath: string) {
  const normalizedPath = rawPath.trim()

  if (normalizedPath.startsWith('/') && !normalizedPath.startsWith('//')) {
    return normalizedPath
  }

  return fallbackPath
}

function resolveLoungeDestination(search: string) {
  const params = new URLSearchParams(search)
  const eventId = params.get('event')?.trim() || params.get('eventId')?.trim() || ''
  const joinFallback = eventId
    ? `/audience?event=${encodeURIComponent(eventId)}`
    : '/audience'
  const loungeFallback = eventId
    ? `/feed?event=${encodeURIComponent(eventId)}`
    : '/feed'

  const joinPath = resolveSameSitePath(params.get('join') ?? '', joinFallback)
  const loungePath = resolveSameSitePath(params.get('lounge') ?? '', loungeFallback)
  const chooserEnabled = params.get('chooser') === '1'

  // Legacy mode: keep supporting direct redirect links.
  const explicitPath = params.get('to')?.trim() ?? ''

  const autoPath = resolveSameSitePath(explicitPath, joinPath)

  return {
    chooserEnabled,
    joinPath,
    loungePath,
    autoPath,
  }
}

function LoungeLinkPage() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const destination = useMemo(() => resolveLoungeDestination(search), [search])

  useEffect(() => {
    if (destination.chooserEnabled) {
      return
    }

    const redirectTimer = window.setTimeout(() => {
      navigate(destination.autoPath, { replace: true })
    }, 120)

    return () => {
      window.clearTimeout(redirectTimer)
    }
  }, [destination.autoPath, destination.chooserEnabled, navigate])

  if (!destination.chooserEnabled) {
    return (
      <section className="app-shell" aria-label="Opening lounge link">
        <section className="queue-panel">
          <p className="eyebrow">Preparing Link</p>
          <h1>Opening lounge...</h1>
          <p className="subcopy">Taking you to your destination now.</p>
        </section>
      </section>
    )
  }

  return (
    <section className="app-shell" aria-label="Join or lounge chooser">
      <section className="queue-panel">
        <p className="eyebrow">The Human Jukebox</p>
        <h1>Scan to join and choose</h1>
        <p className="subcopy">Pick where you want to go right now.</p>
        <div className="hero-actions no-margin-bottom">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              navigate(destination.joinPath)
            }}
          >
            Join Audience
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              navigate(destination.loungePath)
            }}
          >
            Open Lounge
          </button>
        </div>
      </section>
    </section>
  )
}

export default LoungeLinkPage
