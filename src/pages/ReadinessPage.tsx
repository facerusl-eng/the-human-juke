import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getAudienceUrl } from '../lib/audienceUrl'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'
import {
  SPACEBAR_ACTION_COOLDOWN_MS,
  SPOTIFY_ACCESS_TOKEN_STORAGE_KEY,
  SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY,
} from '../lib/constants'

type CheckId =
  | 'network'
  | 'session'
  | 'database'
  | 'realtime'
  | 'introMp3'
  | 'spotifyToggle'
  | 'spacebarRule'
  | 'shareLinks'
  | 'keepwarm'

type CheckStatus = 'idle' | 'running' | 'ok' | 'error'

type CheckResult = {
  status: CheckStatus
  detail: string
  durationMs: number | null
}

type CheckDefinition = {
  id: CheckId
  title: string
  description: string
  fixHint?: string
}

const CHECKS: CheckDefinition[] = [
  {
    id: 'network',
    title: 'Network',
    description: 'Device is online and can reach Supabase.',
    fixHint: 'Check your Wi-Fi or mobile data connection.',
  },
  {
    id: 'session',
    title: 'Host Session',
    description: 'Auth session is active for this device.',
    fixHint: 'Sign out and sign back in at /admin.',
  },
  {
    id: 'database',
    title: 'Database',
    description: 'Event data can be read from the database.',
    fixHint: 'Check Supabase status at status.supabase.com.',
  },
  {
    id: 'realtime',
    title: 'Realtime',
    description: 'Realtime channel can subscribe successfully.',
    fixHint: 'Check Supabase Realtime status at status.supabase.com.',
  },
  {
    id: 'introMp3',
    title: 'Intro MP3',
    description: 'The current gig has a playable intro MP3 configured.',
    fixHint: 'Add or re-select the intro MP3 in Gig Settings.',
  },
  {
    id: 'spotifyToggle',
    title: 'Spotify Toggle',
    description: 'Spotify access and auto-transport toggle are ready.',
    fixHint: 'Reconnect Spotify and turn auto-transport on in Gig Control.',
  },
  {
    id: 'spacebarRule',
    title: 'Spacebar Rule',
    description: 'Spacebar advance is locked to live mode and cooldown rules.',
    fixHint: 'Open the gig in Live Control to enable the live-only spacebar rule.',
  },
  {
    id: 'shareLinks',
    title: 'Share Links',
    description: 'Audience and mirror URLs generate correctly.',
    fixHint: 'Ensure an active gig is selected in Live Control.',
  },
  {
    id: 'keepwarm',
    title: 'Keep-Warm Endpoint',
    description: 'Server warm-up endpoint is reachable.',
    fixHint: 'Check Vercel deployment status at vercel.com.',
  },
]

// IDs that can safely run in parallel (fast, independent)
const PARALLEL_CHECK_IDS: CheckId[] = ['network', 'session', 'database', 'introMp3', 'spotifyToggle', 'spacebarRule', 'shareLinks', 'keepwarm']
// IDs that must run after network is confirmed (realtime needs online)
const SEQUENTIAL_CHECK_IDS: CheckId[] = ['realtime']

const READINESS_SESSION_KEY = 'human-jukebox-readiness-verdict'
const AUTO_REFRESH_INTERVAL_MS = 60_000

const DEFAULT_RESULT: CheckResult = { status: 'idle', detail: 'Not run yet.', durationMs: null }

function buildDefaultResults(): Record<CheckId, CheckResult> {
  return {
    network: { ...DEFAULT_RESULT },
    session: { ...DEFAULT_RESULT },
    database: { ...DEFAULT_RESULT },
    realtime: { ...DEFAULT_RESULT },
    introMp3: { ...DEFAULT_RESULT },
    spotifyToggle: { ...DEFAULT_RESULT },
    spacebarRule: { ...DEFAULT_RESULT },
    shareLinks: { ...DEFAULT_RESULT },
    keepwarm: { ...DEFAULT_RESULT },
  }
}

function statusIcon(status: CheckStatus) {
  if (status === 'ok') return '✓'
  if (status === 'error') return '✗'
  if (status === 'running') return '…'
  return '–'
}

type PersistedVerdict = {
  verdict: 'pass' | 'fail'
  at: string
}

function ReadinessPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { event, audienceConnectionStatus } = useQueueStore()
  const [results, setResults] = useState<Record<CheckId, CheckResult>>(buildDefaultResults)
  const [running, setRunning] = useState(false)
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [countdown, setCountdown] = useState(AUTO_REFRESH_INTERVAL_MS / 1000)
  const countdownRef = useRef<number | null>(null)
  const autoRefreshRef = useRef<number | null>(null)

  // Audience presence subscription
  useEffect(() => {
    const eventId = event?.id
    if (!eventId) {
      setAudienceCount(null)
      return
    }
    const channel = supabase.channel(`readiness-presence:${eventId}`)
    channel.on('presence', { event: 'sync' }, () => {
      setAudienceCount(Object.keys(channel.presenceState()).length)
    })
    channel.subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [event?.id])

  const runSingleCheck = useCallback(async (checkId: CheckId): Promise<void> => {
    const startedAt = performance.now()
    setResults((prev) => ({ ...prev, [checkId]: { status: 'running', detail: 'Running…', durationMs: null } }))
    try {
      switch (checkId) {
        case 'network': {
          if (!navigator.onLine) throw new Error('Device reports offline mode.')
          const { error } = await supabase.from('events').select('id').limit(1)
          if (error) throw new Error(error.message)
          break
        }
        case 'session': {
          const { data, error } = await supabase.auth.getSession()
          if (error) throw new Error(error.message)
          if (!data.session?.user) throw new Error('No active session found for this device.')
          break
        }
        case 'database': {
          const { error } = await supabase
            .from('events').select('id, name').eq('host_id', user?.id ?? '').limit(1)
          if (error) throw new Error(error.message)
          break
        }
        case 'realtime': {
          const ch = supabase.channel(`readiness-rt-${Date.now()}`)
          const status = await new Promise<string>((resolve) => {
            const tid = window.setTimeout(() => resolve('TIMED_OUT'), 4000)
            ch.on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {})
              .subscribe((s) => {
                if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
                  window.clearTimeout(tid)
                  resolve(s)
                }
              })
          })
          void supabase.removeChannel(ch)
          if (status !== 'SUBSCRIBED') throw new Error(`Realtime subscription failed (${status}).`)
          break
        }
        case 'introMp3': {
          if (!event?.introAudioUrl?.trim()) {
            throw new Error('No intro MP3 is configured for the active gig.')
          }

          const introResponse = await fetch(event.introAudioUrl, { method: 'HEAD', cache: 'no-store' })
          if (!introResponse.ok) {
            throw new Error(`Intro MP3 returned ${introResponse.status}.`)
          }
          break
        }
        case 'spotifyToggle': {
          const spotifyAccessToken = window.localStorage.getItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY)?.trim()
          if (!spotifyAccessToken) {
            throw new Error('Spotify is not connected on this device.')
          }

          const storedAutoTransport = window.localStorage.getItem(SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY)
          const autoTransportEnabled = storedAutoTransport === null ? true : storedAutoTransport === '1'
          if (!autoTransportEnabled) {
            throw new Error('Spotify auto-transport toggle is off.')
          }
          break
        }
        case 'spacebarRule': {
          if (!event?.id) {
            throw new Error('No active gig is selected.')
          }

          if (!event.roomOpen) {
            throw new Error('Spacebar advance is only enabled while the gig is live.')
          }

          if (!Number.isFinite(SPACEBAR_ACTION_COOLDOWN_MS) || SPACEBAR_ACTION_COOLDOWN_MS <= 0) {
            throw new Error('Spacebar cooldown is not configured correctly.')
          }
          break
        }
        case 'shareLinks': {
          const url = getAudienceUrl(event?.id ?? 'test', { compact: true })
          if (!url.startsWith('http')) throw new Error('Invalid audience URL format.')
          break
        }
        case 'keepwarm': {
          const res = await fetch('/api/keepwarm', { method: 'GET', cache: 'no-store' })
          if (!res.ok) throw new Error(`Keep-warm endpoint returned ${res.status}.`)
          break
        }
      }
      const durationMs = Math.round(performance.now() - startedAt)
      setResults((prev) => ({ ...prev, [checkId]: { status: 'ok', detail: 'Passed.', durationMs } }))
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt)
      setResults((prev) => ({
        ...prev,
        [checkId]: {
          status: 'error',
          detail: error instanceof Error ? error.message : 'Check failed.',
          durationMs,
        },
      }))
    }
  }, [event?.id, user?.id])

  const startCountdown = useCallback(() => {
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current)
    setCountdown(AUTO_REFRESH_INTERVAL_MS / 1000)
    countdownRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current !== null) window.clearInterval(countdownRef.current)
          countdownRef.current = null
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  const runAllChecks = useCallback(async () => {
    setRunning(true)
    setResults(buildDefaultResults())

    // Mark all parallel checks as running at once, then fire them in parallel
    const parallelIds = PARALLEL_CHECK_IDS
    setResults((prev) => {
      const next = { ...prev }
      for (const id of parallelIds) {
        next[id] = { status: 'running', detail: 'Running…', durationMs: null }
      }
      return next
    })
    await Promise.allSettled(parallelIds.map((id) => runSingleCheck(id)))

    // Then sequential checks (realtime needs network to be up)
    for (const id of SEQUENTIAL_CHECK_IDS) {
      await runSingleCheck(id)
    }

    const at = new Date().toLocaleTimeString()
    setLastRunAt(at)
    setRunning(false)
  }, [runSingleCheck])

  const warmUpAndRerun = useCallback(async () => {
    setRunning(true)
    setResults(buildDefaultResults())
    await runSingleCheck('keepwarm')
    const remainingParallel = PARALLEL_CHECK_IDS.filter((id) => id !== 'keepwarm')
    setResults((prev) => {
      const next = { ...prev }
      for (const id of remainingParallel) {
        next[id] = { status: 'running', detail: 'Running…', durationMs: null }
      }
      return next
    })
    await Promise.allSettled(remainingParallel.map((id) => runSingleCheck(id)))
    for (const id of SEQUENTIAL_CHECK_IDS) {
      await runSingleCheck(id)
    }
    setLastRunAt(new Date().toLocaleTimeString())
    setRunning(false)
  }, [runSingleCheck])

  // Persist verdict to sessionStorage after each run
  const verdict = useMemo(() => {
    const allDone = CHECKS.every((c) => results[c.id].status !== 'idle' && results[c.id].status !== 'running')
    if (!allDone) return 'pending'
    return CHECKS.some((c) => results[c.id].status === 'error') ? 'fail' : 'pass'
  }, [results])

  useEffect(() => {
    if (verdict === 'pass' || verdict === 'fail') {
      const payload: PersistedVerdict = { verdict, at: new Date().toLocaleTimeString() }
      try {
        window.sessionStorage.setItem(READINESS_SESSION_KEY, JSON.stringify(payload))
      } catch {
        // sessionStorage unavailable; non-critical
      }
    }
  }, [verdict])

  // Auto-run on mount + auto-refresh every 60s
  useEffect(() => {
    const doRun = async () => {
      await runAllChecks()
      startCountdown()
    }
    void doRun()

    autoRefreshRef.current = window.setInterval(() => {
      void (async () => {
        await runAllChecks()
        startCountdown()
      })()
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => {
      if (autoRefreshRef.current !== null) window.clearInterval(autoRefreshRef.current)
      if (countdownRef.current !== null) window.clearInterval(countdownRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doneCount = useMemo(
    () => CHECKS.filter((c) => results[c.id].status === 'ok' || results[c.id].status === 'error').length,
    [results],
  )
  const progressPct = running ? Math.round((doneCount / CHECKS.length) * 100) : verdict === 'pending' ? 0 : 100

  const realtimeLabel = {
    connected: 'Connected',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    offline: 'Offline',
  }[audienceConnectionStatus]

  const realtimeTone = audienceConnectionStatus === 'connected' ? 'ok' : 'warn'

  const handleRerun = useCallback(() => {
    if (autoRefreshRef.current !== null) window.clearInterval(autoRefreshRef.current)
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current)
    void (async () => {
      await runAllChecks()
      startCountdown()
      autoRefreshRef.current = window.setInterval(() => {
        void (async () => {
          await runAllChecks()
          startCountdown()
        })()
      }, AUTO_REFRESH_INTERVAL_MS)
    })()
  }, [runAllChecks, startCountdown])

  const handleWarmUpRerun = useCallback(() => {
    if (autoRefreshRef.current !== null) window.clearInterval(autoRefreshRef.current)
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current)
    void (async () => {
      await warmUpAndRerun()
      startCountdown()
      autoRefreshRef.current = window.setInterval(() => {
        void (async () => {
          await runAllChecks()
          startCountdown()
        })()
      }, AUTO_REFRESH_INTERVAL_MS)
    })()
  }, [warmUpAndRerun, runAllChecks, startCountdown])

  return (
    <section className="admin-shell" aria-label="Host readiness dashboard">
      <section className="queue-panel admin-card readiness-panel">

        {/* Back link */}
        <button
          type="button"
          className="readiness-back-link"
          onClick={() => navigate('/admin/gig-control')}
        >
          ← Live Control
        </button>

        <p className="eyebrow">Before you go live</p>
        <h1>Host Readiness</h1>
        <p className="subcopy">
          A live status check of every system your gig depends on. Green means you&apos;re ready.
        </p>

        {/* Verdict + audience count side-by-side */}
        <div className="readiness-top-row">
          <div className={`readiness-verdict readiness-verdict--${verdict}`} aria-live="polite">
            {verdict === 'pending' && (
              <>
                <span className="readiness-verdict-icon" aria-hidden="true">◌</span>
                <span className="readiness-verdict-label">Checking…</span>
              </>
            )}
            {verdict === 'pass' && (
              <>
                <span className="readiness-verdict-icon" aria-hidden="true">✓</span>
                <span className="readiness-verdict-label">Safe to Go Live</span>
              </>
            )}
            {verdict === 'fail' && (
              <>
                <span className="readiness-verdict-icon" aria-hidden="true">✗</span>
                <span className="readiness-verdict-label">Issues Detected</span>
              </>
            )}
          </div>

          {/* Audience count card */}
          <div className={`readiness-audience-card readiness-audience-card--${audienceCount !== null && audienceCount > 0 ? 'active' : 'idle'}`}>
            <span className="readiness-audience-count" aria-live="polite">
              {audienceCount === null ? '…' : audienceCount}
            </span>
            <span className="readiness-audience-label">
              {audienceCount === 1 ? 'audience member' : 'audience members'} online
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <progress
          className={`readiness-progress-bar-track readiness-progress-bar-track--${verdict}`}
          value={progressPct}
          max={100}
          aria-label="Readiness checks progress"
        />
        <p className="readiness-progress-label" aria-live="polite">
          {running
            ? `${doneCount} / ${CHECKS.length} checks complete`
            : verdict !== 'pending'
            ? countdown > 0
              ? `Next auto-refresh in ${countdown}s`
              : 'Refreshing…'
            : null}
        </p>

        {/* Realtime signal */}
        <div className="readiness-signals">
          <div className={`readiness-signal readiness-signal--${realtimeTone}`}>
            <span className="readiness-signal-dot" aria-hidden="true" />
            <span className="readiness-signal-label">Realtime: {realtimeLabel}</span>
          </div>
        </div>

        {/* Actions — 2-button layout, back is now the top link */}
        <div className="readiness-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleRerun}
            disabled={running}
          >
            {running ? 'Running checks…' : 'Re-run checks'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleWarmUpRerun}
            disabled={running}
          >
            Warm Up + Re-run
          </button>
        </div>

        {lastRunAt ? (
          <p className="readiness-last-run">Last run at {lastRunAt}</p>
        ) : null}

        {/* Individual checks */}
        <ul className="readiness-checklist" role="list">
          {CHECKS.map((check) => {
            const result = results[check.id]
            const showHint = result.status === 'error' && check.fixHint
            return (
              <li
                key={check.id}
                className={`readiness-check-item readiness-check-item--${result.status}`}
              >
                <span
                  className={`readiness-check-icon readiness-check-icon--${result.status}`}
                  aria-hidden="true"
                >
                  {statusIcon(result.status)}
                </span>
                <div className="readiness-check-body">
                  <p className="readiness-check-title">{check.title}</p>
                  <p className="readiness-check-detail">{result.detail}</p>
                  {result.durationMs !== null ? (
                    <p className="readiness-check-duration">{result.durationMs}ms</p>
                  ) : null}
                  {showHint ? (
                    <p className="readiness-check-hint">Fix: {check.fixHint}</p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </section>
  )
}

export default ReadinessPage
