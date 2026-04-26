import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

const ADMIN_LOAD_TIMEOUT_MS = 9000
const ADMIN_AUTO_RECOVERY_DELAY_MS = 1200
const ADMIN_SAFE_MODE_AUTO_RETRY_MS = 5000
const ADMIN_MAX_AUTO_RECOVERY_ATTEMPTS = 3

type AdminInitErrorBoundaryProps = {
  children: ReactNode
  recoveryKey: number
  onRecoverableError: (message: string) => void
}

type AdminInitErrorBoundaryState = {
  hasError: boolean
}

class AdminInitErrorBoundary extends Component<AdminInitErrorBoundaryProps, AdminInitErrorBoundaryState> {
  state: AdminInitErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError() {
    return {
      hasError: true,
    }
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    this.props.onRecoverableError(error.message || 'A dashboard section failed to initialize.')
  }

  componentDidUpdate(prevProps: AdminInitErrorBoundaryProps) {
    if (prevProps.recoveryKey !== this.props.recoveryKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="queue-panel admin-mobile-block" role="status" aria-live="polite">
          <p className="eyebrow">Recovery in progress</p>
          <h2>Reconnecting admin controls...</h2>
          <p className="subcopy">One section failed to initialize. Retrying automatically.</p>
          <div className="admin-mobile-action-grid">
            <button
              type="button"
              className="primary-button admin-mobile-cta"
              onClick={() => this.props.onRecoverableError('Manual retry requested.')}
            >
              Retry now
            </button>
          </div>
        </section>
      )
    }

    return this.props.children
  }
}

function AdminSafeFallback({
  recoveryNotice,
  onRetry,
  onOpenMirror,
  onOpenAudience,
  onOpenGigControl,
}: {
  recoveryNotice: string | null
  onRetry: () => void
  onOpenMirror: () => void
  onOpenAudience: () => void
  onOpenGigControl: () => void
}) {
  return (
    <section className="admin-shell admin-mobile-home" aria-label="Admin dashboard safe mode">
      <section className="queue-panel admin-mobile-block admin-safe-mode-panel" role="status" aria-live="polite">
        <p className="eyebrow">Safe mode</p>
        <h1>Keeping controls online</h1>
        <p className="subcopy">
          {recoveryNotice ?? 'Reconnecting... We are restoring the full dashboard automatically.'}
        </p>
        <div className="admin-mobile-action-grid">
          <button type="button" className="primary-button admin-mobile-cta" onClick={onRetry}>
            Retry full dashboard
          </button>
          <button type="button" className="secondary-button admin-mobile-cta" onClick={onOpenGigControl}>
            Open Gig Control
          </button>
          <button type="button" className="secondary-button admin-mobile-cta" onClick={onOpenMirror}>
            Open Mirror Screen
          </button>
          <button type="button" className="secondary-button admin-mobile-cta" onClick={onOpenAudience}>
            Open Audience Screen
          </button>
        </div>
      </section>
    </section>
  )
}

function AdminLoadingBlocks() {
  return (
    <>
      <section className="queue-panel admin-mobile-block" aria-label="Current gig loading" role="status" aria-live="polite">
        <p className="eyebrow">Current Gig</p>
        <h1>Loading current gig...</h1>
        <p className="subcopy">Preparing live status and quick actions.</p>
      </section>

      <section className="queue-panel admin-mobile-block" aria-label="Quick controls loading" role="status" aria-live="polite">
        <div className="panel-head admin-mobile-section-head">
          <h2>Quick Controls</h2>
        </div>
        <div className="admin-mobile-action-grid" aria-hidden="true">
          <button type="button" className="secondary-button admin-mobile-cta" disabled>
            Reconnecting...
          </button>
          <button type="button" className="secondary-button admin-mobile-cta" disabled>
            Retrying...
          </button>
          <button type="button" className="secondary-button admin-mobile-cta" disabled>
            Reconnecting...
          </button>
        </div>
      </section>

      <section className="queue-panel admin-mobile-block" aria-label="Setlist and queue loading" role="status" aria-live="polite">
        <div className="panel-head admin-mobile-section-head">
          <h2>Setlist and Queue</h2>
        </div>
        <p className="subcopy no-margin-bottom">Loading section...</p>
      </section>

      <section className="queue-panel admin-mobile-block" aria-label="Settings loading" role="status" aria-live="polite">
        <div className="panel-head admin-mobile-section-head">
          <h2>Settings and Tools</h2>
        </div>
        <p className="subcopy no-margin-bottom">Loading section...</p>
      </section>

      <section className="queue-panel admin-mobile-block" aria-label="Profile loading" role="status" aria-live="polite">
        <div className="panel-head admin-mobile-section-head">
          <h2>Profile and Logout</h2>
        </div>
        <p className="subcopy no-margin-bottom">Loading session...</p>
      </section>
    </>
  )
}

function AdminDashboardContent({
  recoveryKey,
  recoveryNotice,
  onRecoverableFailure,
  onManualRetry,
}: {
  recoveryKey: number
  recoveryNotice: string | null
  onRecoverableFailure: (message: string) => void
  onManualRetry: () => void
}) {
  const navigate = useNavigate()
  const { signOut, isHost } = useAuthStore()
  const { event, hostEvents, songs, loading, setActiveEvent, toggleRoomOpen, toggleExplicitFilter } = useQueueStore()
  const [activatingEventId, setActivatingEventId] = useState<string | null>(null)
  const [activeSwitchError, setActiveSwitchError] = useState<string | null>(null)
  const [quickActionBusy, setQuickActionBusy] = useState<null | 'room' | 'explicit'>(null)
  const [quickActionError, setQuickActionError] = useState<string | null>(null)
  const [profileBusy, setProfileBusy] = useState<null | 'logout'>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [subscriptionState, setSubscriptionState] = useState<'connecting' | 'healthy' | 'degraded'>('connecting')
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)

  const totalVotes = songs.reduce((sum, song) => sum + song.votes_count, 0)
  const activeEventSummary = useMemo(
    () => hostEvents.find((hostEvent) => hostEvent.id === event?.id) ?? null,
    [hostEvents, event?.id],
  )

  useEffect(() => {
    if (!loading) {
      return
    }

    const timerId = window.setTimeout(() => {
      onRecoverableFailure('Dashboard load is taking longer than expected. Retrying...')
    }, ADMIN_LOAD_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [loading, onRecoverableFailure, recoveryKey])

  useEffect(() => {
    let isCurrent = true
    let healthChannel: ReturnType<typeof supabase.channel> | null = null
    let hasTriggeredRecovery = false

    const registerHealthSubscription = () => {
      try {
        const channelName = `admin-health-${recoveryKey}-${Date.now()}`
        setSubscriptionState('connecting')
        setSubscriptionError(null)

        const queueChangeFilter = event?.id
          ? `event_id=eq.${event.id}`
          : undefined

        healthChannel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'queue_songs',
              ...(queueChangeFilter ? { filter: queueChangeFilter } : {}),
            },
            () => {
              if (isCurrent) {
                setSubscriptionState('healthy')
              }
            },
          )
          .subscribe((status) => {
            if (!isCurrent) {
              return
            }

            if (status === 'SUBSCRIBED') {
              setSubscriptionState('healthy')
              setSubscriptionError(null)
              return
            }

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              const nextError = `Live updates temporarily disconnected (${status.toLowerCase()}).`
              setSubscriptionState('degraded')
              setSubscriptionError(nextError)

              if (!hasTriggeredRecovery) {
                hasTriggeredRecovery = true
                onRecoverableFailure(`${nextError} Retrying subscriptions...`)
              }
            }
          })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to attach live updates.'
        setSubscriptionState('degraded')
        setSubscriptionError(message)
        onRecoverableFailure(`${message} Retrying...`)
      }
    }

    registerHealthSubscription()

    return () => {
      isCurrent = false

      if (healthChannel) {
        void supabase.removeChannel(healthChannel)
      }
    }
  }, [event?.id, recoveryKey, onRecoverableFailure])

  useEffect(() => {
    const retryOnForeground = () => {
      if (document.hidden) {
        return
      }

      if (loading || subscriptionState !== 'healthy') {
        onRecoverableFailure('Reconnecting admin dashboard...')
      }
    }

    const onVisibilityChange = () => {
      if (!document.hidden) {
        retryOnForeground()
      }
    }

    window.addEventListener('focus', retryOnForeground)
    window.addEventListener('online', retryOnForeground)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', retryOnForeground)
      window.removeEventListener('online', retryOnForeground)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loading, subscriptionState, onRecoverableFailure])

  const handleToggleRoomOpen = useCallback(async () => {
    setQuickActionError(null)
    setQuickActionBusy('room')

    try {
      await toggleRoomOpen()
    } catch (error) {
      console.warn('AdminPage: failed to toggle room status', error)
      setQuickActionError(
        error instanceof Error ? error.message : 'Could not change gig status. Please try again.',
      )
    } finally {
      setQuickActionBusy(null)
    }
  }, [toggleRoomOpen])

  const handleToggleExplicitFilter = useCallback(async () => {
    setQuickActionError(null)
    setQuickActionBusy('explicit')

    try {
      await toggleExplicitFilter()
    } catch (error) {
      console.warn('AdminPage: failed to toggle explicit filter', error)
      setQuickActionError(
        error instanceof Error
          ? error.message
          : 'Could not update explicit filter. Please try again.',
      )
    } finally {
      setQuickActionBusy(null)
    }
  }, [toggleExplicitFilter])

  const contextualStripAction = useMemo<null | 'explicit' | 'mirror'>(() => {
    if (!event) {
      return 'mirror'
    }

    if (event.explicitFilterEnabled) {
      return 'explicit'
    }

    return null
  }, [event])

  return (
    <section className="admin-shell admin-mobile-home" aria-label="Admin dashboard">
      {recoveryNotice ? (
        <section className="queue-panel admin-mobile-block admin-recovery-banner" role="status" aria-live="polite">
          <p className="eyebrow">Recovery</p>
          <p className="subcopy no-margin-bottom">{recoveryNotice}</p>
        </section>
      ) : null}

      {subscriptionState !== 'healthy' || subscriptionError ? (
        <section className="queue-panel admin-mobile-block" role="status" aria-live="polite">
          <p className="eyebrow">Connection</p>
          <h2>{subscriptionState === 'degraded' ? 'Reconnecting live updates...' : 'Connecting live updates...'}</h2>
          <p className="subcopy no-margin-bottom">
            {subscriptionError ?? 'Attaching live listeners for queue and event changes.'}
          </p>
        </section>
      ) : null}

      {loading ? (
        <AdminLoadingBlocks />
      ) : (
        <>
          <section className="hero-card admin-card admin-mobile-block admin-home-hero">
            <p className="eyebrow">Current Gig</p>
            <h1>{event?.name ?? 'No active gig'}</h1>
            <p className="subcopy">
              {event
                ? `${event.venue ?? 'Venue not set'} · ${activeEventSummary?.isActive ? 'Live for audience' : 'Not live for audience'}`
                : 'Create or activate a gig to start accepting requests.'}
            </p>

            {event ? (
              <ul className="stats admin-mobile-status-grid" aria-label="Current gig status">
                <li>
                  <strong>{event.roomOpen ? 'Open' : 'Paused'}</strong>
                  <span>Gig Status</span>
                </li>
                <li>
                  <strong>{songs.length}</strong>
                  <span>Queued Tracks</span>
                </li>
                <li>
                  <strong>{totalVotes}</strong>
                  <span>Total Votes</span>
                </li>
                <li>
                  <strong>{event.explicitFilterEnabled ? 'On' : 'Off'}</strong>
                  <span>Explicit Filter</span>
                </li>
              </ul>
            ) : (
              <p className="subcopy no-margin-bottom">No active gig selected.</p>
            )}

            <div className="admin-mobile-inline-actions">
              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/admin/gig-control')}
                disabled={!event}
              >
                Open Gig Control
              </button>
              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/admin/gig-settings')}
                disabled={!event}
              >
                Open Gig Settings
              </button>
            </div>
          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Quick controls">
            <div className="panel-head admin-mobile-section-head">
              <h2>Quick Controls</h2>
              <span className="meta-badge">One-hand mode</span>
            </div>

            <div className="admin-mobile-action-grid">
              <button
                type="button"
                className={event?.roomOpen ? 'secondary-button admin-mobile-cta admin-mobile-priority' : 'primary-button admin-mobile-cta admin-mobile-priority'}
                disabled={!event || quickActionBusy !== null}
                onClick={() => {
                  void handleToggleRoomOpen()
                }}
              >
                {quickActionBusy === 'room'
                  ? 'Updating...'
                  : event?.roomOpen
                  ? 'Pause Requests'
                  : 'Open Requests'}
              </button>

              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/audience')}
              >
                Audience Screen
              </button>

              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                disabled={!event || quickActionBusy !== null}
                onClick={() => window.open('/mirror', '_blank')}
              >
                Mirror Screen
              </button>

              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                disabled={!event || quickActionBusy !== null}
                onClick={() => {
                  void handleToggleExplicitFilter()
                }}
              >
                {quickActionBusy === 'explicit'
                  ? 'Updating...'
                  : event?.explicitFilterEnabled
                  ? 'Allow Explicit'
                  : 'Block Explicit'}
              </button>
            </div>
            {quickActionError ? <p className="error-text">{quickActionError}</p> : null}
          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Setlist and queue shortcuts">
            <div className="panel-head admin-mobile-section-head">
              <h2>Setlist and Queue</h2>
            </div>

            <div className="admin-mobile-action-grid">
              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/admin/gig-control')}
                disabled={!event}
              >
                Manage Live Queue
              </button>
              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/admin/setlist-library')}
              >
                Open Setlist Library
              </button>
              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/admin/gigs')}
              >
                View All Gigs
              </button>
            </div>
          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Settings and tools">
            <div className="panel-head admin-mobile-section-head">
              <h2>Settings and Tools</h2>
            </div>

            <div className="admin-mobile-action-grid">
              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/admin/settings')}
              >
                Admin Settings
              </button>
              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/admin/create-gig')}
              >
                Create Gig
              </button>
              <button
                type="button"
                className="secondary-button admin-mobile-cta"
                onClick={() => navigate('/feed')}
              >
                Open Audience Feed
              </button>
            </div>
          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Profile and logout">
            <div className="panel-head admin-mobile-section-head">
              <h2>Profile and Logout</h2>
              <span className="meta-badge">{isHost ? 'Admin session' : 'User session'}</span>
            </div>

            <p className="subcopy">Use this section to safely end your session from mobile.</p>
            <div className="admin-mobile-action-grid">
              <button
                type="button"
                className="ghost-button admin-mobile-cta"
                disabled={profileBusy !== null}
                onClick={async () => {
                  setProfileError(null)
                  setProfileBusy('logout')

                  try {
                    await signOut()
                    navigate('/', { replace: true })
                  } catch (error) {
                    console.warn('AdminPage: sign-out failed', error)
                    setProfileError(
                      error instanceof Error ? error.message : 'Sign out failed. Please try again.',
                    )
                  } finally {
                    setProfileBusy(null)
                  }
                }}
              >
                {profileBusy === 'logout' ? 'Signing out...' : 'Logout'}
              </button>
            </div>
            {profileError ? <p className="error-text">{profileError}</p> : null}
          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Audience active gig switcher">
            <div className="panel-head admin-mobile-section-head">
              <h2>Current Gig for Audience</h2>
            </div>

            {hostEvents.length === 0 ? (
              <p className="subcopy no-margin-bottom">No gigs yet. Create your first gig to get started.</p>
            ) : (
              <ul className="queue-list admin-mobile-switch-list">
                {hostEvents.map((hostEvent) => {
                  const isBusy = activatingEventId === hostEvent.id

                  return (
                    <li key={hostEvent.id} className="admin-gig-switch-row admin-mobile-switch-row">
                      <div>
                        <p className="song">{hostEvent.name}</p>
                        <p className="artist">{hostEvent.venue ?? 'No venue set'}</p>
                        <p className="artist">
                          {hostEvent.isActive ? 'Live for audience' : 'Not live for audience'}
                          {event?.id === hostEvent.id ? ' · Open in your control panel' : ''}
                        </p>
                      </div>
                      <div className="queue-actions admin-gig-switch-actions">
                        <button
                          type="button"
                          className="secondary-button admin-mobile-cta"
                          disabled={hostEvent.isActive || isBusy}
                          onClick={async () => {
                            setActiveSwitchError(null)
                            setActivatingEventId(hostEvent.id)

                            try {
                              await setActiveEvent(hostEvent.id)
                            } catch (error) {
                              if (error instanceof Error) {
                                setActiveSwitchError(error.message)
                              } else {
                                setActiveSwitchError('Failed to change active gig. Please try again.')
                              }
                            } finally {
                              setActivatingEventId(null)
                            }
                          }}
                        >
                          {hostEvent.isActive ? 'Live Now' : isBusy ? 'Switching...' : 'Set Live for Audience'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {activeSwitchError ? <p className="error-text">{activeSwitchError}</p> : null}

            <div className="admin-mobile-action-grid">
              <button type="button" className="ghost-button admin-mobile-cta" onClick={onManualRetry}>
                Retry dashboard sync
              </button>
            </div>
          </section>

          <section
            className={`admin-mobile-live-strip${contextualStripAction ? ' admin-mobile-live-strip-with-context' : ''}`}
            aria-label="Live controls"
          >
            <button
              type="button"
              className={event?.roomOpen ? 'secondary-button admin-mobile-live-strip-button' : 'primary-button admin-mobile-live-strip-button'}
              disabled={!event || quickActionBusy !== null}
              onClick={() => {
                void handleToggleRoomOpen()
              }}
            >
              {quickActionBusy === 'room'
                ? 'Updating...'
                : event?.roomOpen
                ? 'Pause Requests'
                : 'Open Requests'}
            </button>
            <button
              type="button"
              className="secondary-button admin-mobile-live-strip-button"
              onClick={() => navigate('/audience')}
            >
              Audience
            </button>

            {contextualStripAction === 'explicit' ? (
              <button
                type="button"
                className="secondary-button admin-mobile-live-strip-button"
                disabled={!event || quickActionBusy !== null}
                onClick={() => {
                  void handleToggleExplicitFilter()
                }}
              >
                {quickActionBusy === 'explicit'
                  ? 'Updating...'
                  : event?.explicitFilterEnabled
                  ? 'Allow Explicit'
                  : 'Block Explicit'}
              </button>
            ) : null}

            {contextualStripAction === 'mirror' ? (
              <button
                type="button"
                className="secondary-button admin-mobile-live-strip-button"
                onClick={() => window.open('/mirror', '_blank')}
              >
                Mirror
              </button>
            ) : null}
          </section>
        </>
      )}
    </section>
  )
}

function AdminPage() {
  const navigate = useNavigate()

  const [recoveryKey, setRecoveryKey] = useState(0)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null)
  const [safeMode, setSafeMode] = useState(false)
  const recoveryAttemptsRef = useRef(0)
  const recoveryTimerRef = useRef<number | null>(null)

  const runRecovery = useCallback((message: string) => {
    if (recoveryTimerRef.current !== null) {
      return
    }

    recoveryAttemptsRef.current += 1
    setRecoveryNotice(message)

    if (recoveryAttemptsRef.current > ADMIN_MAX_AUTO_RECOVERY_ATTEMPTS) {
      setSafeMode(true)
      return
    }

    setSafeMode(false)
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null
      setRecoveryKey((value) => value + 1)
      setRecoveryNotice('Retrying...')
    }, ADMIN_AUTO_RECOVERY_DELAY_MS)
  }, [])

  const runManualRetry = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
    }

    recoveryAttemptsRef.current = 0
    setSafeMode(false)
    setRecoveryNotice('Retrying...')
    setRecoveryKey((value) => value + 1)
  }, [])

  useEffect(() => {
    return () => {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!safeMode) {
      return
    }

    const timerId = window.setTimeout(() => {
      runManualRetry()
    }, ADMIN_SAFE_MODE_AUTO_RETRY_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [safeMode, runManualRetry])

  if (safeMode) {
    return (
      <AdminSafeFallback
        recoveryNotice={recoveryNotice}
        onRetry={runManualRetry}
        onOpenMirror={() => window.open('/mirror', '_blank')}
        onOpenAudience={() => navigate('/audience')}
        onOpenGigControl={() => navigate('/admin/gig-control')}
      />
    )
  }

  return (
    <AdminInitErrorBoundary
      recoveryKey={recoveryKey}
      onRecoverableError={(message) => {
        runRecovery(`${message} Reconnecting...`)
      }}
    >
      <AdminDashboardContent
        recoveryKey={recoveryKey}
        recoveryNotice={recoveryNotice}
        onManualRetry={runManualRetry}
        onRecoverableFailure={runRecovery}
      />
    </AdminInitErrorBoundary>
  )
}

export default AdminPage

