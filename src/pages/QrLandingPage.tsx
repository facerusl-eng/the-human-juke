import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function QrLandingPage() {
  const navigate = useNavigate()
  const { search } = useLocation()
  
  const customUrl = useMemo(() => {
    const params = new URLSearchParams(search)
    const url = params.get('url')?.trim()
    
    // Only allow http/https URLs
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url
    }
    return null
  }, [search])

  useEffect(() => {
    // If no valid URL is provided, redirect to audience
    if (!customUrl) {
      const redirectTimer = window.setTimeout(() => {
        navigate('/audience', { replace: true })
      }, 500)

      return () => {
        window.clearTimeout(redirectTimer)
      }
    }
  }, [customUrl, navigate])

  if (!customUrl) {
    return (
      <section className="app-shell" aria-label="Invalid QR link">
        <section className="queue-panel">
          <p className="eyebrow">Invalid Link</p>
          <h1>Redirecting...</h1>
          <p className="subcopy">Taking you to the lounge now.</p>
        </section>
      </section>
    )
  }

  return (
    <section className="qr-landing-shell" aria-label="QR code landing page">
      <div className="qr-landing-container">
        <iframe
          src={customUrl}
          className="qr-landing-iframe"
          title="QR code destination content"
          sandbox="allow-same-origin allow-forms allow-scripts allow-popups"
        />
        <div className="qr-landing-button-overlay">
          <a
            href="/audience"
            className="qr-landing-button"
            aria-label="Go to audience lounge"
          >
            Go to Lounge
          </a>
        </div>
      </div>
    </section>
  )
}

export default QrLandingPage
