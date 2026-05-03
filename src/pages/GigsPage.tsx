import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGigActions } from '../hooks/useGigActions'
import { useQueueStore } from '../state/queueStore'

const SPOTIFY_ACCESS_TOKEN_STORAGE_KEY = 'human-jukebox-spotify-access-token'
const SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY = 'human-jukebox-spotify-auto-transport'

function formatGigDate(createdAt: string) {
  if (!createdAt) {
    return 'Created recently'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(createdAt))
}

function formatEventTypeLabel(eventType: 'halli-live' | 'karaoke' | 'build-self') {
  if (eventType === 'karaoke') return 'Karaoke'
  if (eventType === 'build-self') return 'Build Self Gig'
  return 'Halli Playing Music'
}

function resolveGigStartAt(gigDate: string | null, gigStartTime: string | null) {
  if (!gigDate || !gigStartTime) {
    return null
  }

  const normalizedTime = gigStartTime.length === 5 ? `${gigStartTime}:00` : gigStartTime
  const startAt = new Date(`${gigDate}T${normalizedTime}`)
  return Number.isNaN(startAt.getTime()) ? null : startAt
}

async function sendSpotifyTransportCommand(mode: 'play' | 'pause') {
  if (typeof window === 'undefined') {
    return false
  }

  const accessToken = window.localStorage.getItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (!accessToken) {
    return false
  }

  const endpoint = mode === 'pause'
    ? 'https://api.spotify.com/v1/me/player/pause'
    : 'https://api.spotify.com/v1/me/player/play'

  try {
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    return response.ok
  } catch {
    return false
  }
}

function isSpotifyAutoTransportEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY) !== '0'
}

async function playIntroAudioWithSpotifyBridge(introAudioUrl: string) {
  const shouldBridgeSpotify = isSpotifyAutoTransportEnabled()

  if (shouldBridgeSpotify) {
    await sendSpotifyTransportCommand('pause')
  }

  const introAudio = new Audio(introAudioUrl)
  introAudio.preload = 'auto'

  try {
    await introAudio.play()
  } catch (error) {
    if (shouldBridgeSpotify) {
      await sendSpotifyTransportCommand('play')
    }
    throw error
  }

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      introAudio.removeEventListener('ended', onEnded)
      introAudio.removeEventListener('error', onError)
    }

    const onEnded = () => {
      cleanup()
      if (shouldBridgeSpotify) {
        void sendSpotifyTransportCommand('play')
      }
      resolve()
    }

    const onError = () => {
      cleanup()
      if (shouldBridgeSpotify) {
        void sendSpotifyTransportCommand('play')
      }
      resolve()
    }

    introAudio.addEventListener('ended', onEnded, { once: true })
    introAudio.addEventListener('error', onError, { once: true })
  })
}

function GigsPage() {
  const navigate = useNavigate()
  const { event, hostEvents, setActiveEvent, endGig, deleteEvent, setEventAudienceNoGigVisibility } = useQueueStore()
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  const [endingEventId, setEndingEventId] = useState<string | null>(null)
  const [togglingAudienceFallbackEventId, setTogglingAudienceFallbackEventId] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const autoLiveInFlightRef = useRef(false)
  const attemptedAutoLiveGigIdsRef = useRef<Set<string>>(new Set())
  const gigActions = useGigActions({
    setActiveEvent,
    setErrorText,
    errors: {
      setActiveEvent: 'Failed to switch gig. Please try again.',
    },
  })

  const chooseGig = async (gigId: string, goToControl = true) => {
    const switched = await gigActions.switchActiveGig(gigId)

    if (switched && goToControl) {
      navigate('/admin/gig-control')
    }
  }

  const removeGig = async (gigId: string, gigName: string) => {
    const confirmed = window.confirm(`Delete "${gigName}"? This removes its queue, feed posts, and mirror state.`)

    if (!confirmed) {
      return
    }

    setErrorText(null)
    setDeletingEventId(gigId)

    try {
      await deleteEvent(gigId)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to delete gig. Please try again.')
    } finally {
      setDeletingEventId(null)
    }
  }

  const endSavedGig = async (gigId: string, gigName: string) => {
    const confirmed = window.confirm(`End "${gigName}" now? This will close audience access for this gig.`)

    if (!confirmed) {
      return
    }

    setErrorText(null)
    setEndingEventId(gigId)

    try {
      await endGig(gigId)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to end gig. Please try again.')
    } finally {
      setEndingEventId(null)
    }
  }

  const toggleAudienceFallbackVisibility = async (gigId: string, visible: boolean) => {
    setErrorText(null)
    setTogglingAudienceFallbackEventId(gigId)

    try {
      await setEventAudienceNoGigVisibility(gigId, visible)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to update audience no-live visibility. Please try again.')
    } finally {
      setTogglingAudienceFallbackEventId(null)
    }
  }

  useEffect(() => {
    const validGigIds = new Set(
      hostEvents
        .filter((hostEvent) => hostEvent.autoLiveEnabled && !hostEvent.isActive)
        .map((hostEvent) => hostEvent.id),
    )

    attemptedAutoLiveGigIdsRef.current = new Set(
      [...attemptedAutoLiveGigIdsRef.current].filter((gigId) => validGigIds.has(gigId)),
    )
  }, [hostEvents])

  useEffect(() => {
    const runAutoLiveCheck = async () => {
      if (autoLiveInFlightRef.current) {
        return
      }

      const now = Date.now()
      const dueEvent = hostEvents.find((hostEvent) => {
        if (hostEvent.isActive || !hostEvent.autoLiveEnabled) {
          return false
        }

        if (attemptedAutoLiveGigIdsRef.current.has(hostEvent.id)) {
          return false
        }

        const startAt = resolveGigStartAt(hostEvent.gigDate, hostEvent.gigStartTime)
        return Boolean(startAt && startAt.getTime() <= now)
      })

      if (!dueEvent) {
        return
      }

      autoLiveInFlightRef.current = true
      attemptedAutoLiveGigIdsRef.current.add(dueEvent.id)

      try {
        const switched = await gigActions.switchActiveGig(dueEvent.id)

        if (!switched) {
          return
        }

        if (dueEvent.introAudioUrl) {
          try {
            await playIntroAudioWithSpotifyBridge(dueEvent.introAudioUrl)
          } catch {
            setErrorText('Gig went live automatically, but intro audio was blocked by browser autoplay settings. Press play manually in Gig Settings preview if needed.')
          }
        }
      } finally {
        autoLiveInFlightRef.current = false
      }
    }

    void runAutoLiveCheck()
    const timerId = window.setInterval(() => {
      void runAutoLiveCheck()
    }, 20_000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [gigActions, hostEvents])

  return (
    <section className="gigs-shell" aria-label="Gig management">
      <section className="hero-card gigs-hero-card">
        <p className="eyebrow">Gig Manager</p>
        <h1>Your Gigs</h1>
        <p className="subcopy">
          See every gig you have created, choose which one to control, and remove gigs you no longer want.
        </p>
        <div className="hero-actions no-margin-bottom">
          <button type="button" className="primary-button" onClick={() => navigate('/admin/create-gig')}>
            Create Gig
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
            Back to Dashboard
          </button>
        </div>
      </section>

      <section className="queue-panel gigs-list-panel" aria-label="Created gigs list">
        <div className="panel-head">
          <h2>Saved Gigs</h2>
          <span className="meta-badge">{hostEvents.length} total</span>
        </div>

        {hostEvents.length === 0 ? (
          <p className="subcopy no-margin-bottom">No gigs yet. Create your first gig to start taking requests.</p>
        ) : (
          <ul className="gig-management-list">
            {hostEvents.map((hostEvent) => {
              const isCurrentGig = event?.id === hostEvent.id
              const isActivating = gigActions.activatingEventId === hostEvent.id
              const isDeleting = deletingEventId === hostEvent.id
              const isEnding = endingEventId === hostEvent.id
              const isUpdatingNoLiveVisibility = togglingAudienceFallbackEventId === hostEvent.id
              const isBusy = isActivating || isDeleting || isEnding || isUpdatingNoLiveVisibility

              return (
                <li key={hostEvent.id} className="gig-management-entry">
                  <div className="gig-management-main">
                    <div className="gig-management-title-row">
                      <p className="gig-management-title">{hostEvent.name}</p>
                      <span className="meta-badge">{formatEventTypeLabel(hostEvent.eventType)}</span>
                      {hostEvent.autoLiveEnabled ? <span className="meta-badge">Auto Live</span> : null}
                      {hostEvent.isActive ? <span className="meta-badge">Live for audience</span> : null}
                      {hostEvent.showInAudienceNoGig ? <span className="meta-badge">Shown when no live gig</span> : null}
                      {isCurrentGig ? <span className="meta-badge">Open in control panel</span> : null}
                    </div>
                    <p className="gig-management-meta">{hostEvent.venue ?? 'No venue set'}</p>
                    <p className="gig-management-meta">Created {formatGigDate(hostEvent.createdAt)}</p>
                  </div>

                  <div className="gig-management-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isBusy}
                      onClick={() => {
                        if (isCurrentGig) {
                          navigate('/admin/gig-control')
                          return
                        }

                        void chooseGig(hostEvent.id)
                      }}
                    >
                      {isCurrentGig ? 'Open Control' : isActivating ? 'Choosing…' : 'Choose Gig'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={hostEvent.isActive || isBusy}
                      onClick={() => {
                        void chooseGig(hostEvent.id, false)
                      }}
                    >
                      {hostEvent.isActive ? 'Live Now' : isActivating ? 'Switching…' : 'Set Live Only'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={!hostEvent.isActive || isBusy}
                      onClick={() => {
                        void endSavedGig(hostEvent.id, hostEvent.name)
                      }}
                    >
                      {!hostEvent.isActive ? 'Ended' : isEnding ? 'Ending…' : 'End Gig'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={isBusy}
                      onClick={() => {
                        void toggleAudienceFallbackVisibility(hostEvent.id, !hostEvent.showInAudienceNoGig)
                      }}
                    >
                      {isUpdatingNoLiveVisibility
                        ? 'Saving…'
                        : hostEvent.showInAudienceNoGig
                        ? 'Hide from No-Live Page'
                        : 'Show on No-Live Page'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger-button"
                      disabled={isBusy}
                      onClick={() => {
                        void removeGig(hostEvent.id, hostEvent.name)
                      }}
                    >
                      {isDeleting ? 'Deleting…' : 'Delete Gig'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {errorText ? <p className="error-text">{errorText}</p> : null}
      </section>
    </section>
  )
}

export default GigsPage
