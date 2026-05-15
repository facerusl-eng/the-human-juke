import { useMemo, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function QrLandingPage() {
  const { search } = useLocation()
  const [showButton, setShowButton] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  
  const params = useMemo(() => {
    const searchParams = new URLSearchParams(search)
    return {
      eventId: searchParams.get('event'),
      url: searchParams.get('url'),
    }
  }, [search])

  const customUrl = useMemo(() => {
    const url = params.url?.trim()
    // Only allow http/https URLs
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url
    }
    return null
  }, [params.url])

  // Fetch event settings to verify custom QR is enabled
  useEffect(() => {
    const checkCustomQrEnabled = async () => {
      try {
        if (!params.eventId) {
          setShowButton(false)
          setIsLoading(false)
          return
        }

        const { data, error } = await supabase
          .from('events')
          .select('mirror_countdown_qr_custom_enabled, mirror_break_qr_enabled')
          .eq('id', params.eventId)
          .single()

        if (error || !data) {
          setShowButton(false)
        } else {
          // Show button if either countdown or break custom QR is enabled
          const isEnabled = (data.mirror_countdown_qr_custom_enabled ?? false) || (data.mirror_break_qr_enabled ?? false)
          setShowButton(isEnabled)
        }
      } catch {
        setShowButton(false)
      } finally {
        setIsLoading(false)
      }
    }

    void checkCustomQrEnabled()
  }, [params.eventId])

  return (
    <section className="qr-landing-shell" aria-label="QR code landing page">
      {showButton && !isLoading && (
        <div className="qr-landing-button-overlay">
          <a
            href="/audience"
            className="qr-landing-button"
            aria-label="Go to audience lounge"
          >
            Go to Lounge
          </a>
        </div>
      )}
      
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
