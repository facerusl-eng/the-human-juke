import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function resolveDestination(rawPath: string, fallbackPath: string) {
  const normalizedPath = rawPath.trim()

  if (!normalizedPath) {
    return { type: 'internal', value: fallbackPath }
  }

  if (normalizedPath.startsWith('/') && !normalizedPath.startsWith('//')) {
    return { type: 'internal', value: normalizedPath }
  }

  try {
    const parsedUrl = new URL(normalizedPath)

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { type: 'internal', value: fallbackPath }
    }

    if (typeof window !== 'undefined' && parsedUrl.origin === window.location.origin) {
      return {
        type: 'internal',
        value: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
      }
    }

    return { type: 'external', value: parsedUrl.toString() }
  } catch {
    return { type: 'internal', value: fallbackPath }
  }
}

function openDestination(
  navigate: ReturnType<typeof useNavigate>,
  destination: { type: string; value: string },
  replace = false,
) {
  if (destination.type === 'external') {
    if (replace) {
      window.location.replace(destination.value)
      return
    }

    window.location.assign(destination.value)
    return
  }

  navigate(destination.value, { replace })
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

  const joinDestination = resolveDestination(params.get('join') ?? '', joinFallback)
  const loungeDestination = resolveDestination(params.get('lounge') ?? '', loungeFallback)
  const chooserEnabled = params.get('chooser') === '1'

  // Legacy mode: keep supporting direct redirect links.
  const explicitPath = params.get('to')?.trim() ?? ''

  const autoDestination = resolveDestination(explicitPath, joinDestination.value)

  return {
    chooserEnabled,
    joinDestination,
    loungeDestination,
    autoDestination,
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
      openDestination(navigate, destination.autoDestination, true)
    }, 120)

    return () => {
      window.clearTimeout(redirectTimer)
    }
  }, [destination.autoDestination, destination.chooserEnabled, navigate])

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
              openDestination(navigate, destination.joinDestination)
            }}
          >
            Join Audience
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              openDestination(navigate, destination.loungeDestination)
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
