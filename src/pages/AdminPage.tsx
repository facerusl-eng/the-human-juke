import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ActionButtonGroup, type ActionButtonConfig } from '../components/actions/ActionButtonGroup'
import { useGigActions } from '../hooks/useGigActions'
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
  const safeModeActions: ActionButtonConfig[] = [
    {
      id: 'retry-dashboard',
      label: 'Retry full dashboard',
      onClick: onRetry,
      variant: 'primary',
    },
    {
      id: 'open-gig-control',
      label: 'Open Gig Control',
      onClick: onOpenGigControl,
    },
    {
      id: 'open-mirror',
      label: 'Open Mirror Screen',
      onClick: onOpenMirror,
    },
    {
      id: 'open-audience',
      label: 'Open Audience Screen',
      onClick: onOpenAudience,
    },
  ]

  return (
    <section className="admin-shell admin-mobile-home" aria-label="Admin dashboard safe mode">
      <section className="queue-panel admin-mobile-block admin-safe-mode-panel" role="status" aria-live="polite">
        <p className="eyebrow">Safe mode</p>
        <h1>Keeping controls online</h1>
        <p className="subcopy">
          {recoveryNotice ?? 'Reconnecting... We are restoring the full dashboard automatically.'}
        </p>
        <ActionButtonGroup actions={safeModeActions} layoutClassName="admin-mobile-action-grid" buttonClassName="admin-mobile-cta" />
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
  const [activeSwitchError, setActiveSwitchError] = useState<string | null>(null)
  const [quickActionError, setQuickActionError] = useState<string | null>(null)
  const [profileBusy, setProfileBusy] = useState<null | 'logout'>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [subscriptionState, setSubscriptionState] = useState<'connecting' | 'healthy' | 'degraded'>('connecting')
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)

  const activeGigActions = useGigActions({
    setActiveEvent,
    setErrorText: setActiveSwitchError,
    errors: {
      setActiveEvent: 'Failed to change active gig. Please try again.',
    },
  })

  const quickGigActions = useGigActions({
    toggleRoomOpen,
    toggleExplicitFilter,
    setErrorText: setQuickActionError,
    errors: {
      toggleRoomOpen: 'Could not change gig status. Please try again.',
      toggleExplicitFilter: 'Could not update explicit filter. Please try again.',
    },
  })

  const totalVotes = songs.reduce((sum, song) => sum + song.votes_count, 0)
  const activeEventSummary = useMemo(
    () => hostEvents.find((hostEvent) => hostEvent.id === event?.id) ?? null,
    [hostEvents, event?.id],
  )
  const openGigControl = useCallback(() => {
    navigate('/admin/gig-control')
  }, [navigate])
  const openGigSettings = useCallback(() => {
    navigate('/admin/gig-settings')
  }, [navigate])
  const openAudienceScreen = useCallback(() => {
    navigate('/audience')
  }, [navigate])
  const openMirrorScreen = useCallback(() => {
    window.open('/mirror', '_blank')
  }, [])
  const openSetlistLibrary = useCallback(() => {
    navigate('/admin/setlist-library')
  }, [navigate])
  const openGigList = useCallback(() => {
    navigate('/admin/gigs')
  }, [navigate])
  const openAdminSettings = useCallback(() => {
    navigate('/admin/settings')
  }, [navigate])
  const openCreateGig = useCallback(() => {
    navigate('/admin/create-gig')
  }, [navigate])
  const openAudienceFeed = useCallback(() => {
    navigate('/feed')
  }, [navigate])

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

  const contextualStripAction = useMemo<null | 'explicit' | 'mirror'>(() => {
    if (!event) {
      return 'mirror'
    }

    if (event.explicitFilterEnabled) {
      return 'explicit'
    }

    return null
  }, [event])
  const quickControlActions = useMemo<ActionButtonConfig[]>(() => [
    {
      id: 'toggle-room-open',
      label: quickGigActions.roomToggleBusy
        ? 'Updating...'
        : event?.roomOpen
        ? 'Pause Requests'
        : 'Open Requests',
      onClick: async () => {
        await quickGigActions.runToggleRoomOpen()
      },
      disabled: !event || quickGigActions.quickActionBusy,
      variant: event?.roomOpen ? 'secondary' : 'primary',
      className: 'admin-mobile-priority',
    },
    {
      id: 'open-audience',
      label: 'Audience Screen',
      onClick: openAudienceScreen,
    },
    {
      id: 'open-mirror',
      label: 'Mirror Screen',
      onClick: openMirrorScreen,
      disabled: !event || quickGigActions.quickActionBusy,
    },
    {
      id: 'toggle-explicit-filter',
      label: quickGigActions.explicitToggleBusy
        ? 'Updating...'
        : event?.explicitFilterEnabled
        ? 'Allow Explicit'
        : 'Block Explicit',
      onClick: async () => {
        await quickGigActions.runToggleExplicitFilter()
      },
      disabled: !event || quickGigActions.quickActionBusy,
    },
  ], [
    event,
    openAudienceScreen,
    openMirrorScreen,
    quickGigActions.explicitToggleBusy,
    quickGigActions.quickActionBusy,
    quickGigActions.roomToggleBusy,
    quickGigActions.runToggleExplicitFilter,
    quickGigActions.runToggleRoomOpen,
  ])
  const queueShortcutActions: ActionButtonConfig[] = [
    {
      id: 'open-gig-control',
      label: 'Manage Live Queue',
      onClick: openGigControl,
      disabled: !event,
    },
    {
      id: 'open-setlist-library',
      label: 'Open Setlist Library',
      onClick: openSetlistLibrary,
    },
    {
      id: 'open-gig-list',
      label: 'View All Gigs',
      onClick: openGigList,
    },
  ]
  const settingsToolActions: ActionButtonConfig[] = [
    {
      id: 'open-gig-settings',
      label: 'Gig Settings',
      onClick: openGigSettings,
      disabled: !event,
    },
    {
      id: 'open-admin-settings',
      label: 'Admin Settings',
      onClick: openAdminSettings,
    },
    {
      id: 'open-create-gig',
      label: 'Create Gig',
      onClick: openCreateGig,
    },
    {
      id: 'open-audience-feed',
      label: 'Open Audience Feed',
      onClick: openAudienceFeed,
    },
  ]
  const retryDashboardActions: ActionButtonConfig[] = [
    {
      id: 'retry-dashboard-sync',
      label: 'Retry dashboard sync',
      onClick: onManualRetry,
      variant: 'ghost',
    },
  ]
  const liveStripActions = useMemo<ActionButtonConfig[]>(() => {
    const actions: ActionButtonConfig[] = [
      {
        id: 'strip-toggle-room-open',
        label: quickGigActions.roomToggleBusy
          ? 'Updating...'
          : event?.roomOpen
          ? 'Pause Requests'
          : 'Open Requests',
        onClick: async () => {
          await quickGigActions.runToggleRoomOpen()
        },
        disabled: !event || quickGigActions.quickActionBusy,
        variant: event?.roomOpen ? 'secondary' : 'primary',
      },
      {
        id: 'strip-open-audience',
        label: 'Audience',
        onClick: openAudienceScreen,
      },
    ]

    if (contextualStripAction === 'explicit') {
      actions.push({
        id: 'strip-toggle-explicit-filter',
        label: quickGigActions.explicitToggleBusy
          ? 'Updating...'
          : event?.explicitFilterEnabled
          ? 'Allow Explicit'
          : 'Block Explicit',
        onClick: async () => {
          await quickGigActions.runToggleExplicitFilter()
        },
        disabled: !event || quickGigActions.quickActionBusy,
      })
    }

    if (contextualStripAction === 'mirror') {
      actions.push({
        id: 'strip-open-mirror',
        label: 'Mirror',
        onClick: openMirrorScreen,
      })
    }

    return actions
  }, [
    contextualStripAction,
    event,
    openAudienceScreen,
    openMirrorScreen,
    quickGigActions.explicitToggleBusy,
    quickGigActions.quickActionBusy,
    quickGigActions.roomToggleBusy,
    quickGigActions.runToggleExplicitFilter,
    quickGigActions.runToggleRoomOpen,
  ])

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

          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Quick controls">
            <div className="panel-head admin-mobile-section-head">
              <h2>Quick Controls</h2>
              <span className="meta-badge">One-hand mode</span>
            </div>

            <ActionButtonGroup actions={quickControlActions} layoutClassName="admin-mobile-action-grid" buttonClassName="admin-mobile-cta" />
            {quickActionError ? <p className="error-text">{quickActionError}</p> : null}
          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Setlist and queue shortcuts">
            <div className="panel-head admin-mobile-section-head">
              <h2>Setlist and Queue</h2>
            </div>

            <ActionButtonGroup actions={queueShortcutActions} layoutClassName="admin-mobile-action-grid" buttonClassName="admin-mobile-cta" />
          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Settings and tools">
            <div className="panel-head admin-mobile-section-head">
              <h2>Settings and Tools</h2>
            </div>

            <ActionButtonGroup actions={settingsToolActions} layoutClassName="admin-mobile-action-grid" buttonClassName="admin-mobile-cta" />
          </section>

          <section className="queue-panel admin-mobile-block" aria-label="Profile and logout">
            <div className="panel-head admin-mobile-section-head">
              <h2>Profile and Logout</h2>
              <span className="meta-badge">{isHost ? 'Admin session' : 'User session'}</span>
            </div>

            <p className="subcopy">Use this section to safely end your session from mobile.</p>
            <ActionButtonGroup
              actions={[
                {
                  id: 'logout',
                  label: profileBusy === 'logout' ? 'Signing out...' : 'Logout',
                  onClick: async () => {
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
                  },
                  disabled: profileBusy !== null,
                  variant: 'ghost',
                },
              ]}
              layoutClassName="admin-mobile-action-grid"
              buttonClassName="admin-mobile-cta"
            />
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
                  const isBusy = activeGigActions.activatingEventId === hostEvent.id

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
                            await activeGigActions.switchActiveGig(hostEvent.id)
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

            <ActionButtonGroup actions={retryDashboardActions} layoutClassName="admin-mobile-action-grid" buttonClassName="admin-mobile-cta" />
          </section>

          <ActionButtonGroup
            actions={liveStripActions}
            layoutClassName={
              `admin-mobile-live-strip${contextualStripAction ? ' admin-mobile-live-strip-with-context' : ''}`
            }
            buttonClassName="admin-mobile-live-strip-button"
          />
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

