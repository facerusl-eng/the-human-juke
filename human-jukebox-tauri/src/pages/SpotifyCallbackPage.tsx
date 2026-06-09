import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const SPOTIFY_ACCESS_TOKEN_STORAGE_KEY = 'human-jukebox-spotify-access-token'

function resolveSpotifyApiUrl(path: '/api/spotify/callback') {
  const isLocalHttpDev = (
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    && window.location.protocol === 'http:'
  )

  if (isLocalHttpDev) {
    return path
  }

  const spotifyApiOrigin = (import.meta.env.VITE_SPOTIFY_API_ORIGIN?.trim() || 'https://www.the-human-jukebox.org').replace(/\/$/, '')
  return `${spotifyApiOrigin}${path}`
}

function SpotifyCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [statusText, setStatusText] = useState('Finishing Spotify login...')

  useEffect(() => {
    let cancelled = false

    const finishLogin = async () => {
      const code = searchParams.get('code')

      if (!code) {
        setStatusText('Missing Spotify code. Redirecting to Gig Control...')
        window.setTimeout(() => {
          navigate('/admin/gig-control', { replace: true })
        }, 900)
        return
      }

      try {
        const callbackUrl = `${resolveSpotifyApiUrl('/api/spotify/callback')}?code=${encodeURIComponent(code)}`
        const response = await fetch(callbackUrl)
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || typeof payload.access_token !== 'string') {
          throw new Error(payload.error || 'Spotify login failed.')
        }

        window.localStorage.setItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY, payload.access_token)

        if (!cancelled) {
          setStatusText('Spotify connected. Redirecting to Gig Control...')
          navigate('/admin/gig-control', { replace: true })
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        setStatusText(error instanceof Error ? error.message : 'Spotify callback failed.')
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
