import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getAudienceUrl } from '../lib/audienceUrl'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

type HealthCheckId =
  | 'network'
  | 'connectionStrength'
  | 'deviceMemory'
  | 'cpuCapacity'
  | 'session'
  | 'database'
  | 'activeGig'
  | 'realtime'
  | 'shareLinks'

type HealthCheckStatus = 'idle' | 'running' | 'ok' | 'error'

type HealthCheckResult = {
  status: HealthCheckStatus
  detail: string
  durationMs: number | null
}

type HealthCheckDefinition = {
  id: HealthCheckId
  title: string
  description: string
}

const HEALTH_CHECKS: HealthCheckDefinition[] = [
  {
    id: 'network',
    title: 'Network Reachability',
    description: 'Confirms the device is online and can reach live services.',
  },
  {
    id: 'connectionStrength',
    title: 'Internet Strength',
    description: 'Measures latency and connection quality to the live server.',
  },
  {
    id: 'deviceMemory',
    title: 'RAM Availability',
    description: 'Checks available device memory indicators for stable live playback.',
  },
  {
    id: 'cpuCapacity',
    title: 'CPU Readiness',
    description: 'Checks CPU core count and short main-thread responsiveness.',
  },
  {
    id: 'session',
    title: 'Host Session',
    description: 'Checks whether your host auth session is active.',
  },
  {
    id: 'database',
    title: 'Database Access',
    description: 'Verifies reads against your event data succeed.',
  },
  {
    id: 'activeGig',
    title: 'Active Gig Lookup',
    description: 'Ensures your active gig can be loaded for live control.',
  },
  {
    id: 'realtime',
    title: 'Realtime Subscription',
    description: 'Confirms realtime channels can subscribe successfully.',
  },
  {
    id: 'shareLinks',
    title: 'Audience Share Links',
    description: 'Validates audience and mirror URLs are generated correctly.',
  },
]

const DEFAULT_RESULT: HealthCheckResult = {
  status: 'idle',
  detail: 'Not run yet.',
  durationMs: null,
}

function buildDefaultResults(): Record<HealthCheckId, HealthCheckResult> {
  return {
    network: { ...DEFAULT_RESULT },
    connectionStrength: { ...DEFAULT_RESULT },
    deviceMemory: { ...DEFAULT_RESULT },
    cpuCapacity: { ...DEFAULT_RESULT },
    session: { ...DEFAULT_RESULT },
    database: { ...DEFAULT_RESULT },
    activeGig: { ...DEFAULT_RESULT },
    realtime: { ...DEFAULT_RESULT },
    shareLinks: { ...DEFAULT_RESULT },
  }
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return '—'
  }

  return `${durationMs}ms`
}

function formatBytesToMb(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function HealthCheckPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { event } = useQueueStore()
  const [results, setResults] = useState<Record<HealthCheckId, HealthCheckResult>>(buildDefaultResults)
  const [runningAll, setRunningAll] = useState(false)
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)

  const runCheck = useCallback(async (checkId: HealthCheckId) => {
    const startedAt = performance.now()

    setResults((currentResults) => ({
      ...currentResults,
      [checkId]: {
        status: 'running',
        detail: 'Running check...',
        durationMs: null,
      },
    }))

    try {
      switch (checkId) {
        case 'network': {
          if (!navigator.onLine) {
            throw new Error('Device reports offline mode.')
          }

          const { error } = await supabase.from('events').select('id').limit(1)
          if (error) {
            throw new Error(error.message)
          }

          break
        }

        case 'connectionStrength': {
          if (!navigator.onLine) {
            throw new Error('Device is offline — cannot measure connection strength.')
          }

          // Measure round-trip latency with a lightweight timed fetch
          const pingStart = performance.now()
          const pingUrl = `${window.location.origin}/the-human-jukebox-logo.svg?_=${Date.now()}`
          await fetch(pingUrl, { method: 'HEAD', cache: 'no-store' })
          const rttMeasured = Math.round(performance.now() - pingStart)

          // Read Network Information API when available
          const conn = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection
          const effectiveType = conn?.effectiveType ?? null
          const downlink = typeof conn?.downlink === 'number' ? conn.downlink : null
          const apiRtt = typeof conn?.rtt === 'number' ? conn.rtt : null

          const rating =
            rttMeasured < 120 ? 'Excellent'
            : rttMeasured < 280 ? 'Good'
            : rttMeasured < 600 ? 'Fair'
            : 'Poor'

          const parts: string[] = [`Latency: ${rttMeasured}ms (${rating})`]
          if (effectiveType) parts.push(`Type: ${effectiveType}`)
          if (downlink !== null) parts.push(`Downlink: ${downlink} Mbps`)
          if (apiRtt !== null) parts.push(`Browser RTT: ${apiRtt}ms`)

          const durationMs = Math.round(performance.now() - startedAt)

          if (rttMeasured >= 600) {
            throw new Error(`Weak connection — ${parts.join(' · ')}`)
          }

          setResults((currentResults) => ({
            ...currentResults,
            connectionStrength: {
              status: rttMeasured >= 280 ? 'error' : 'ok',
              detail: parts.join(' · '),
              durationMs,
            },
          }))
          return
        }

        case 'deviceMemory': {
          const navWithMemory = navigator as Navigator & { deviceMemory?: number }
          const perfWithMemory = performance as Performance & {
            memory?: {
              usedJSHeapSize: number
              totalJSHeapSize: number
              jsHeapSizeLimit: number
            }
          }

          const deviceMemoryGb = typeof navWithMemory.deviceMemory === 'number' ? navWithMemory.deviceMemory : null
          const heap = perfWithMemory.memory

          const detailParts: string[] = []
          let shouldFail = false

          if (deviceMemoryGb !== null) {
            detailParts.push(`Device memory: ${deviceMemoryGb} GB`)
            if (deviceMemoryGb < 2) {
              shouldFail = true
            }
          } else {
            detailParts.push('Device memory API unavailable in this browser')
          }

          if (heap) {
            const usedPct = Math.round((heap.usedJSHeapSize / heap.jsHeapSizeLimit) * 100)
            detailParts.push(
              `JS heap: ${formatBytesToMb(heap.usedJSHeapSize)} / ${formatBytesToMb(heap.jsHeapSizeLimit)} (${usedPct}%)`,
            )

            if (usedPct >= 90) {
              shouldFail = true
            }
          } else {
            detailParts.push('JS heap metrics unavailable in this browser')
          }

          const durationMs = Math.round(performance.now() - startedAt)

          setResults((currentResults) => ({
            ...currentResults,
            deviceMemory: {
              status: shouldFail ? 'error' : 'ok',
              detail: detailParts.join(' · '),
              durationMs,
            },
          }))

          if (shouldFail) {
            throw new Error(detailParts.join(' · '))
          }

          return
        }

        case 'cpuCapacity': {
          const logicalCores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null
          const delayStart = performance.now()
          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), 0)
          })
          const eventLoopDelayMs = Math.round(performance.now() - delayStart)

          const detailParts: string[] = []
          let shouldFail = false

          if (logicalCores !== null) {
            detailParts.push(`Logical cores: ${logicalCores}`)
            if (logicalCores < 2) {
              shouldFail = true
            }
          } else {
            detailParts.push('CPU core API unavailable in this browser')
          }

          detailParts.push(`Main-thread delay: ${eventLoopDelayMs}ms`)
          if (eventLoopDelayMs >= 250) {
            shouldFail = true
          }

          const durationMs = Math.round(performance.now() - startedAt)

          setResults((currentResults) => ({
            ...currentResults,
            cpuCapacity: {
              status: shouldFail ? 'error' : 'ok',
              detail: detailParts.join(' · '),
              durationMs,
            },
          }))

          if (shouldFail) {
            throw new Error(detailParts.join(' · '))
          }

          return
        }

        case 'session': {
          const { data, error } = await supabase.auth.getSession()

          if (error) {
            throw new Error(error.message)
          }

          if (!data.session?.user) {
            throw new Error('No active session found for this device.')
          }

          break
        }

        case 'database': {
          const { error } = await supabase
            .from('events')
            .select('id, name')
            .eq('host_id', user?.id ?? '')
            .limit(1)

          if (error) {
            throw new Error(error.message)
          }

          break
        }

        case 'activeGig': {
          const { data, error } = await supabase
            .from('events')
            .select('id, name, is_active')
            .eq('host_id', user?.id ?? '')
            .eq('is_active', true)
            .limit(1)
            .maybeSingle()

          if (error) {
            throw new Error(error.message)
          }

          if (!data) {
            throw new Error('No active gig is currently marked live.')
          }

          break
        }

        case 'realtime': {
          const channel = supabase.channel(`health-check-${Date.now()}`)

          const status = await new Promise<string>((resolve) => {
            const timeoutId = window.setTimeout(() => {
              resolve('TIMED_OUT')
            }, 3500)

            channel
              .on(
                'postgres_changes',
                {
                  event: '*',
                  schema: 'public',
                  table: 'events',
                },
                () => {
                  // no-op
                },
              )
              .subscribe((nextStatus) => {
                if (nextStatus === 'SUBSCRIBED' || nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT') {
                  window.clearTimeout(timeoutId)
                  resolve(nextStatus)
                }
              })
          })

          void supabase.removeChannel(channel)

          if (status !== 'SUBSCRIBED') {
            throw new Error(`Realtime subscription failed (${status}).`)
          }

          break
        }

        case 'shareLinks': {
          const eventId = event?.id ?? 'test'
          const audienceUrl = getAudienceUrl(eventId, { compact: true })
          const mirrorUrl = `${window.location.origin}/mirror`

          if (!audienceUrl.startsWith('http') || !mirrorUrl.startsWith('http')) {
            throw new Error('Invalid share URL format.')
          }

          break
        }
      }

      const durationMs = Math.round(performance.now() - startedAt)

      setResults((currentResults) => ({
        ...currentResults,
        [checkId]: {
          status: 'ok',
          detail: 'Check passed.',
          durationMs,
        },
      }))
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt)

      setResults((currentResults) => ({
        ...currentResults,
        [checkId]: {
          status: 'error',
          detail: error instanceof Error ? error.message : 'Check failed.',
          durationMs,
        },
      }))
    }
  }, [event?.id, user?.id])

  const runAllChecks = useCallback(async () => {
    setRunningAll(true)

    for (const check of HEALTH_CHECKS) {
      await runCheck(check.id)
    }

    setLastRunAt(new Date().toLocaleTimeString())
    setRunningAll(false)
  }, [runCheck])

  useEffect(() => {
    void runAllChecks()
  }, [runAllChecks])

  const summary = useMemo(() => {
    const allResults = HEALTH_CHECKS.map((check) => results[check.id])
    const failedCount = allResults.filter((result) => result.status === 'error').length

    if (failedCount === 0) {
      return {
        label: 'All checks passed',
        tone: 'saved',
      }
    }

    return {
      label: `${failedCount} check${failedCount === 1 ? '' : 's'} need attention`,
      tone: 'error',
    }
  }, [results])

  return (
    <section className="admin-shell" aria-label="Pre-gig health check">
      <section className="queue-panel admin-card">
        <p className="eyebrow">Pre-gig checks</p>
        <h1>Health Check</h1>
        <p className="subcopy">
          Run this before going live to confirm auth, database, realtime, and share links are healthy.
        </p>
        <div className="hero-actions no-margin-bottom">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              void runAllChecks()
            }}
            disabled={runningAll}
          >
            {runningAll ? 'Running checks...' : 'Run all checks'}
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
            Back to Dashboard
          </button>
        </div>
        <div className="toolbar-status">
          <span className={`status-badge ${summary.tone}`}>{summary.label}</span>
          {lastRunAt ? <span className="status-badge">Last run: {lastRunAt}</span> : null}
        </div>
      </section>

      {HEALTH_CHECKS.map((check) => {
        const result = results[check.id]
        const tone = result.status === 'ok' ? 'saved' : result.status === 'error' ? 'error' : result.status === 'running' ? 'saving' : 'unsaved'

        return (
          <section key={check.id} className="queue-panel admin-mobile-block" aria-label={`${check.title} status`}>
            <div className="panel-head">
              <h2>{check.title}</h2>
              <span className={`status-badge ${tone}`}>{result.status.toUpperCase()}</span>
            </div>
            <p className="subcopy">{check.description}</p>
            <p className="subcopy no-margin-bottom">{result.detail}</p>
            <div className="hero-actions no-margin-bottom">
              <span className="meta-badge">Duration: {formatDuration(result.durationMs)}</span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  void runCheck(check.id)
                }}
                disabled={result.status === 'running' || runningAll}
              >
                Retry check
              </button>
            </div>
          </section>
        )
      })}
    </section>
  )
}

export default HealthCheckPage