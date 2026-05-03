import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getAudienceUrl } from '../lib/audienceUrl'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

type CheckId =
  | 'network'
  | 'session'
  | 'database'
  | 'realtime'
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
}

const CHECKS: CheckDefinition[] = [
  {
    id: 'network',
    title: 'Network',
    description: 'Device is online and can reach Supabase.',
  },
  {
    id: 'session',
    title: 'Host Session',
    description: 'Auth session is active for this device.',
  },
  {
    id: 'database',
    title: 'Database',
    description: 'Event data can be read from the database.',
  },
  {
    id: 'realtime',
    title: 'Realtime',
    description: 'Realtime channel can subscribe successfully.',
  },
  {
    id: 'shareLinks',
    title: 'Share Links',
    description: 'Audience and mirror URLs generate correctly.',
  },
  {
    id: 'keepwarm',
    title: 'Keep-Warm Endpoint',
    description: 'Server warm-up endpoint is reachable.',
  },
]

const DEFAULT_RESULT: CheckResult = { status: 'idle', detail: 'Not run yet.', durationMs: null }

function buildDefaultResults(): Record<CheckId, CheckResult> {
  return {
    network: { ...DEFAULT_RESULT },
    session: { ...DEFAULT_RESULT },
    database: { ...DEFAULT_RESULT },
    realtime: { ...DEFAULT_RESULT },
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

function ReadinessPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { event, audienceConnectionStatus } = useQueueStore()
  const [results, setResults] = useState<Record<CheckId, CheckResult>>(buildDefaultResults)
  const [running, setRunning] = useState(false)
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Audience presence subscription
  useEffect(() => {
    const eventId = event?.id

    if (!eventId) {
      setAudienceCount(null)
      return
    }

    const channel = supabase.channel(`readiness-presence:${eventId}`)
    presenceChannelRef.current = channel

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      setAudienceCount(Object.keys(state).length)
    })

    channel.subscribe()

    return () => {
      void supabase.removeChannel(channel)
      presenceChannelRef.current = null
    }
  }, [event?.id])

  const runCheck = useCallback(async (checkId: CheckId) => {
    const startedAt = performance.now()

    setResults((prev) => ({
      ...prev,
      [checkId]: { status: 'running', detail: 'Running…', durationMs: null },
    }))

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
            .from('events')
            .select('id, name')
            .eq('host_id', user?.id ?? '')
            .limit(1)
          if (error) throw new Error(error.message)
          break
        }

        case 'realtime': {
          const channel = supabase.channel(`readiness-rt-${Date.now()}`)
          const status = await new Promise<string>((resolve) => {
            const tid = window.setTimeout(() => resolve('TIMED_OUT'), 4000)
            channel
              .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {})
              .subscribe((s) => {
                if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
                  window.clearTimeout(tid)
                  resolve(s)
                }
              })
          })
          void supabase.removeChannel(channel)
          if (status !== 'SUBSCRIBED') throw new Error(`Realtime subscription failed (${status}).`)
          break
        }

        case 'shareLinks': {
          const eventId = event?.id ?? 'test'
          const url = getAudienceUrl(eventId, { compact: true })
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

  const runAllChecks = useCallback(async () => {
    setRunning(true)
    setResults(buildDefaultResults())

    for (const check of CHECKS) {
      await runCheck(check.id)
    }

    setLastRunAt(new Date().toLocaleTimeString())
    setRunning(false)
  }, [runCheck])

  const warmUpAndRerun = useCallback(async () => {
    setResults(buildDefaultResults())
    setRunning(true)

    // keepwarm first, then all checks
    await runCheck('keepwarm')
    for (const check of CHECKS) {
      if (check.id !== 'keepwarm') await runCheck(check.id)
    }

    setLastRunAt(new Date().toLocaleTimeString())
    setRunning(false)
  }, [runCheck])

  // Auto-run on mount
  useEffect(() => {
    void runAllChecks()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const verdict = useMemo(() => {
    const allDone = CHECKS.every((c) => results[c.id].status !== 'idle' && results[c.id].status !== 'running')
    if (!allDone) return 'pending'
    const anyFailed = CHECKS.some((c) => results[c.id].status === 'error')
    return anyFailed ? 'fail' : 'pass'
  }, [results])

  const realtimeLabel = {
    connected: 'Connected',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    offline: 'Offline',
  }[audienceConnectionStatus]

  const realtimeTone = audienceConnectionStatus === 'connected' ? 'ok' : 'warn'

  return (
    <section className="admin-shell" aria-label="Host readiness dashboard">
      <section className="queue-panel admin-card readiness-panel">
        <p className="eyebrow">Before you go live</p>
        <h1>Host Readiness</h1>
        <p className="subcopy">
          A live status check of every system your gig depends on. Green means you&apos;re ready.
        </p>

        {/* Big verdict */}
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

        {/* Live signals */}
        <div className="readiness-signals">
          <div className={`readiness-signal readiness-signal--${realtimeTone}`}>
            <span className="readiness-signal-dot" aria-hidden="true" />
            <span className="readiness-signal-label">Realtime: {realtimeLabel}</span>
          </div>
          <div className={`readiness-signal readiness-signal--${audienceCount !== null ? 'ok' : 'idle'}`}>
            <span className="readiness-signal-dot" aria-hidden="true" />
            <span className="readiness-signal-label">
              {audienceCount === null
                ? 'Audience: connecting…'
                : audienceCount === 0
                ? 'No audience online yet'
                : `${audienceCount} audience member${audienceCount === 1 ? '' : 's'} online`}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="hero-actions no-margin-bottom">
          <button
            type="button"
            className="primary-button"
            onClick={() => void runAllChecks()}
            disabled={running}
          >
            {running ? 'Running checks…' : 'Re-run checks'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void warmUpAndRerun()}
            disabled={running}
          >
            Warm Up + Re-run
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => navigate('/admin/gig-control')}
          >
            Back to Live Control
          </button>
        </div>

        {lastRunAt ? (
          <p className="readiness-last-run">Last run at {lastRunAt}</p>
        ) : null}

        {/* Individual checks */}
        <ul className="readiness-checklist" role="list">
          {CHECKS.map((check) => {
            const result = results[check.id]
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
                  {result.status === 'ok' && result.durationMs !== null ? (
                    <p className="readiness-check-duration">{result.durationMs}ms</p>
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
