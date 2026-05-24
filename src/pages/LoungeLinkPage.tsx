import { useEffect, useMemo } from 'react'
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
  const destination = useMemo(() => resolveLoungeDestination(search), [search])
  const customLink = useMemo(() => {
    const params = new URLSearchParams(search)
    return normalizeExternalLink(params.get('url'))
  }, [search])
  const backToWelcomePath = useMemo(() => resolveSafeBackPath(search), [search])

  useEffect(() => {
    if (customLink) {
      return
    }

    const redirectTimer = window.setTimeout(() => {
      navigate(destination, { replace: true })
    }, 120)

    return () => {
      window.clearTimeout(redirectTimer)
    }
  }, [customLink, destination, navigate])

  return (
    <section className="app-shell" aria-label="Opening lounge link">
      <section className="queue-panel">
        <p className="eyebrow">Link Detour</p>
        <h1>Choose your next glorious move</h1>
        <p className="subcopy">
          You can open the provided link, then use the button below to return to the welcome screen where a brand-new bit of nonsense awaits.
        </p>
        <div style={{ display: 'grid', gap: '0.8rem', marginTop: '1rem' }}>
          {customLink ? (
            <a href={customLink} target="_blank" rel="noopener noreferrer" className="qr-landing-button qr-landing-button-link">
              Open provided link
            </a>
          ) : null}
          <button type="button" className="qr-landing-button qr-landing-button-back" onClick={() => navigate(backToWelcomePath, { replace: true })}>
            Back to welcome
          </button>
        </div>
      </section>
    </section>
  )
}

export default LoungeLinkPage
