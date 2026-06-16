import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { resolveApiUrl } from '../lib/apiUrl'

const SPOTIFY_ACCESS_TOKEN_STORAGE_KEY = 'human-jukebox-spotify-access-token'

function SpotifyCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [statusText, setStatusText] = useState('Finishing Spotify login...')

  useEffect(() => {
    let cancelled = false

    const finishLogin = async () => {
      const code = searchParams.get('code')
      const error = searchParams.get('error')
      const state = searchParams.get('state')

      console.log('[SpotifyCallback] Auth response:', { code: !!code, error, state })

      if (error) {
        setStatusText(`Spotify authorization denied: ${error}. Redirecting...`)
        window.setTimeout(() => {
          navigate('/admin/gig-control', { replace: true })
        }, 2000)
        return
      }

      if (!code) {
        setStatusText('Missing Spotify code. Redirecting to Gig Control...')
        console.warn('[SpotifyCallback] No code parameter in URL')
        window.setTimeout(() => {
          navigate('/admin/gig-control', { replace: true })
        }, 900)
        return
      }

      try {
        const callbackUrl = `${resolveApiUrl('/api/spotify/callback')}?code=${encodeURIComponent(code)}`
        console.log('[SpotifyCallback] Fetching:', callbackUrl.split('?')[0])
        
        const response = await fetch(callbackUrl)
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        const payload = contentType.includes('application/json')
          ? await response.json().catch(() => ({}))
          : {}

        console.log('[SpotifyCallback] Response status:', response.status, 'has token:', !!payload.access_token)

        if (!response.ok || typeof payload.access_token !== 'string') {
          const fallbackError = !contentType.includes('application/json')
            ? `Spotify login failed (non-JSON response, status ${response.status}).`
            : 'Spotify login failed.'
          throw new Error(payload.error || fallbackError)
        }

        window.localStorage.setItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY, payload.access_token)
        console.log('[SpotifyCallback] Token saved, navigating to gig control')

        if (!cancelled) {
          setStatusText('Spotify connected. Redirecting to Gig Control...')
          window.setTimeout(() => {
            navigate('/admin/gig-control', { replace: true })
          }, 500)
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        const errorMsg = error instanceof Error ? error.message : 'Spotify callback failed.'
        console.error('[SpotifyCallback] Error:', errorMsg)
        setStatusText(errorMsg)
        
        window.setTimeout(() => {
          navigate('/admin/gig-control', { replace: true })
        }, 2000)
      }
    }

    void finishLogin()

    return () => {
      cancelled = true
    }
  }, [navigate, searchParams])

  return (
    <section className="app-shell" aria-label="Spotify callback">
      <section className="queue-panel">
        <p className="eyebrow">Spotify</p>
        <h1>Authorizing Playback</h1>
        <p className="subcopy">{statusText}</p>
      </section>
    </section>
  )
}

export default SpotifyCallbackPage
