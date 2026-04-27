import { useEffect, useRef, useState } from 'react'

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js'

function ensureSpotifyScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Spotify SDK can only run in the browser.'))
  }

  if (window.Spotify) {
    return Promise.resolve()
  }

  const existing = document.querySelector(`script[src="${SDK_URL}"]`)

  if (existing) {
    return new Promise((resolve, reject) => {
      const previousReadyHandler = window.onSpotifyWebPlaybackSDKReady
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (typeof previousReadyHandler === 'function') {
          previousReadyHandler()
        }
        resolve()
      }

      existing.addEventListener('error', () => reject(new Error('Failed to load Spotify SDK script.')), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true

    const previousReadyHandler = window.onSpotifyWebPlaybackSDKReady
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (typeof previousReadyHandler === 'function') {
        previousReadyHandler()
      }
      resolve()
    }

    script.onerror = () => {
      reject(new Error('Failed to load Spotify SDK script.'))
    }

    document.body.appendChild(script)
  })
}

async function parseJson(response) {
  return response.json().catch(() => ({}))
}

function SpotifyPlayerWithSDK({ accessToken, onRefreshToken }) {
  const playerRef = useRef(null)
  const accessTokenRef = useRef(accessToken)

  const [isSdkReady, setIsSdkReady] = useState(false)
  const [deviceId, setDeviceId] = useState(null)
  const [playerStatus, setPlayerStatus] = useState('Spotify player is idle.')
  const [spotifyUriInput, setSpotifyUriInput] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  accessTokenRef.current = accessToken

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      try {
        await ensureSpotifyScript()

        if (cancelled || !window.Spotify) {
          return
        }

        setIsSdkReady(true)

        const player = new window.Spotify.Player({
          name: 'Human Jukebox Gig Control',
          getOAuthToken: (cb) => {
            cb(accessTokenRef.current)
          },
          volume: 0.6,
        })

        const onReady = ({ device_id: readyDeviceId }) => {
          setDeviceId(readyDeviceId)
          setPlayerStatus('Spotify device is ready.')
        }

        const onNotReady = ({ device_id: offlineDeviceId }) => {
          setPlayerStatus(`Spotify device went offline: ${offlineDeviceId}`)
        }

        player.addListener('ready', onReady)
        player.addListener('not_ready', onNotReady)
        player.addListener('initialization_error', ({ message }) => {
          setPlayerStatus(`Initialization error: ${message}`)
        })
        player.addListener('authentication_error', ({ message }) => {
          setPlayerStatus(`Authentication error: ${message}`)

          if (onRefreshToken) {
            void onRefreshToken()
              .then((newToken) => {
                accessTokenRef.current = newToken
                setPlayerStatus('Spotify token refreshed after authentication error.')
              })
              .catch((refreshError) => {
                setPlayerStatus(
                  refreshError instanceof Error
                    ? refreshError.message
                    : 'Spotify token refresh failed after authentication error.',
                )
              })
          }
        })
        player.addListener('account_error', ({ message }) => {
          setPlayerStatus(`Account error: ${message}`)
        })
        player.addListener('playback_error', ({ message }) => {
          setPlayerStatus(`Playback error: ${message}`)
        })

        await player.connect()
        playerRef.current = player
      } catch (error) {
        setPlayerStatus(error instanceof Error ? error.message : 'Spotify SDK setup failed.')
      }
    }

    void initialize()

    return () => {
      cancelled = true

      const currentPlayer = playerRef.current
      if (currentPlayer) {
        currentPlayer.removeListener('ready')
        currentPlayer.removeListener('not_ready')
        currentPlayer.removeListener('initialization_error')
        currentPlayer.removeListener('authentication_error')
        currentPlayer.removeListener('account_error')
        currentPlayer.removeListener('playback_error')
        currentPlayer.disconnect()
      }

      playerRef.current = null
      setDeviceId(null)
    }
  }, [])

  const canControlPlayback = Boolean(deviceId)

  const withRefreshRetry = async (action) => {
    try {
      return await action(accessTokenRef.current)
    } catch (error) {
      if (!onRefreshToken) {
        throw error
      }

      const refreshedToken = await onRefreshToken()
      accessTokenRef.current = refreshedToken
      return action(refreshedToken)
    }
  }

  const togglePlay = async () => {
    if (!playerRef.current) return

    setActionBusy(true)
    try {
      await playerRef.current.togglePlay()
      setPlayerStatus('Toggled play/pause.')
    } catch (error) {
      setPlayerStatus(error instanceof Error ? error.message : 'Toggle play failed.')
    } finally {
      setActionBusy(false)
    }
  }

  const nextTrack = async () => {
    if (!playerRef.current) return

    setActionBusy(true)
    try {
      await playerRef.current.nextTrack()
      setPlayerStatus('Skipped to next track.')
    } catch (error) {
      setPlayerStatus(error instanceof Error ? error.message : 'Next track failed.')
    } finally {
      setActionBusy(false)
    }
  }

  const previousTrack = async () => {
    if (!playerRef.current) return

    setActionBusy(true)
    try {
      await playerRef.current.previousTrack()
      setPlayerStatus('Moved to previous track.')
    } catch (error) {
      setPlayerStatus(error instanceof Error ? error.message : 'Previous track failed.')
    } finally {
      setActionBusy(false)
    }
  }

  const startPlayback = async (spotifyUri) => {
    if (!spotifyUri || !deviceId) {
      setPlayerStatus('Provide a Spotify URI and wait for device readiness.')
      return
    }

    setActionBusy(true)

    try {
      await withRefreshRetry(async (token) => {
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: [spotifyUri] }),
        })

        if (response.status === 401) {
          throw new Error('Spotify access token expired.')
        }

        if (!response.ok) {
          const payload = await parseJson(response)
          const message = payload?.error?.message || payload?.error_description || 'Start playback failed.'
          throw new Error(message)
        }
      })

      setPlayerStatus(`Started playback for ${spotifyUri}.`)
    } catch (error) {
      setPlayerStatus(error instanceof Error ? error.message : 'Start playback failed.')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <section className="queue-panel" aria-label="Spotify playback controls">
      <div className="panel-head">
        <h2>Spotify Web Playback SDK</h2>
        <span className="meta-badge">{deviceId ? 'Connected' : 'Disconnected'}</span>
      </div>

      <p className="subcopy">
        SDK status: {isSdkReady ? 'Loaded' : 'Loading'}
      </p>
      <p className="subcopy">Device ID: {deviceId ?? 'Waiting for ready event...'}</p>
      <p className="subcopy">{playerStatus}</p>

      <div className="hero-actions">
        <button type="button" className="secondary-button" disabled={actionBusy || !canControlPlayback} onClick={togglePlay}>
          Toggle Play
        </button>
        <button type="button" className="secondary-button" disabled={actionBusy || !canControlPlayback} onClick={previousTrack}>
          Previous
        </button>
        <button type="button" className="secondary-button" disabled={actionBusy || !canControlPlayback} onClick={nextTrack}>
          Next
        </button>
      </div>

      <label htmlFor="spotify-uri-input" className="gig-switcher-label">Spotify URI (spotify:track:...)</label>
      <input
        id="spotify-uri-input"
        type="text"
        value={spotifyUriInput}
        onChange={(event) => setSpotifyUriInput(event.target.value)}
        placeholder="spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"
        className="gig-switcher-select"
      />
      <div className="hero-actions no-margin-bottom">
        <button
          type="button"
          className="primary-button"
          disabled={actionBusy || !deviceId}
          onClick={async () => {
            await startPlayback(spotifyUriInput.trim())
          }}
        >
          Start Playback
        </button>
      </div>
    </section>
  )
}

export default SpotifyPlayerWithSDK
