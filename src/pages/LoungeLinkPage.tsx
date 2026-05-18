import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

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
  const destination = useMemo(() => resolveLoungeDestination(search), [search])

  useEffect(() => {
    const redirectTimer = window.setTimeout(() => {
      navigate(destination, { replace: true })
    }, 120)

    return () => {
      window.clearTimeout(redirectTimer)
    }
  }, [destination, navigate])

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

export default LoungeLinkPage
