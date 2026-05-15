import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

function QrLandingPage() {
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

  return (
    <section className="qr-landing-shell" aria-label="QR code landing page">
      <div className="qr-landing-button-overlay">
        <a
          href="/audience"
          className="qr-landing-button"
          aria-label="Go to audience lounge"
        >
          Go to Lounge
        </a>
      </div>
      
      <div className="qr-landing-container">
        {customUrl ? (
          <iframe
            src={customUrl}
            className="qr-landing-iframe"
            title="QR code destination content"
            sandbox="allow-same-origin allow-forms allow-scripts allow-popups"
          />
        ) : (
          <div className="qr-landing-empty-state">
            <p>Welcome! Click the button above to join the lounge.</p>
          </div>
        )}
      </div>
    </section>
  )
}

export default QrLandingPage
