import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type CrashTelemetryRow = {
  id: string
  route: string
  error_fingerprint: string
  error_message: string
  stack_snippet: string | null
  created_at: string
}

const DEFAULT_LIMIT = 25

const TIME_WINDOW_OPTIONS = [
  { value: '1h', label: 'Last hour', milliseconds: 60 * 60 * 1000 },
  { value: '6h', label: 'Last 6 hours', milliseconds: 6 * 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', milliseconds: 24 * 60 * 60 * 1000 },
  { value: '72h', label: 'Last 72 hours', milliseconds: 72 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: 'Last 30 days', milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { value: 'all', label: 'All time', milliseconds: null },
] as const

type TimeWindowValue = (typeof TIME_WINDOW_OPTIONS)[number]['value']

type TelemetryFilters = {
  routeFilter: string
  fingerprintFilter: string
  timeWindow: TimeWindowValue
}

function resolveWindowStartIso(timeWindow: TimeWindowValue) {
  const selectedWindow = TIME_WINDOW_OPTIONS.find((option) => option.value === timeWindow)

  if (!selectedWindow || selectedWindow.milliseconds === null) {
    return null
  }

  return new Date(Date.now() - selectedWindow.milliseconds).toISOString()
}

function formatTimestamp(isoTimestamp: string) {
  const date = new Date(isoTimestamp)

  if (Number.isNaN(date.getTime())) {
    return isoTimestamp
  }

  return date.toLocaleString()
}

function escapeCsvValue(value: string) {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}

function buildCrashTelemetryCsv(rows: CrashTelemetryRow[]) {
  const header = ['created_at', 'route', 'error_fingerprint', 'error_message', 'stack_snippet']
  const csvRows = rows.map((row) => [
    row.created_at,
    row.route,
    row.error_fingerprint,
    row.error_message,
    row.stack_snippet ?? '',
  ])

  return [header, ...csvRows]
    .map((columns) => columns.map((column) => escapeCsvValue(String(column))).join(','))
    .join('\n')
}

function CrashTelemetryPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<CrashTelemetryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [routeFilter, setRouteFilter] = useState('')
  const [fingerprintFilter, setFingerprintFilter] = useState('')
  const [timeWindow, setTimeWindow] = useState<TimeWindowValue>('24h')

  const downloadCsv = () => {
    if (rows.length === 0 || typeof window === 'undefined') {
      return
    }

    const csvText = buildCrashTelemetryCsv(rows)
    const csvBlob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' })
    const downloadUrl = window.URL.createObjectURL(csvBlob)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const anchor = document.createElement('a')

    anchor.href = downloadUrl
    anchor.download = `crash-telemetry-${timestamp}.csv`
    anchor.style.display = 'none'

    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.URL.revokeObjectURL(downloadUrl)
  }

  const loadTelemetry = useCallback(async (showRefreshingState: boolean, nextFilters?: Partial<TelemetryFilters>) => {
    if (showRefreshingState) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setErrorText(null)

    try {
      const effectiveRouteFilter = (nextFilters?.routeFilter ?? routeFilter).trim()
      const effectiveFingerprintFilter = (nextFilters?.fingerprintFilter ?? fingerprintFilter).trim()
      const effectiveTimeWindow = nextFilters?.timeWindow ?? timeWindow
      const windowStartIso = resolveWindowStartIso(effectiveTimeWindow)

      let query = supabase
        .from('crash_telemetry')
        .select('id, route, error_fingerprint, error_message, stack_snippet, created_at')
        .order('created_at', { ascending: false })
        .limit(DEFAULT_LIMIT)

      if (windowStartIso) {
        query = query.gte('created_at', windowStartIso)
      }

      if (effectiveRouteFilter) {
        query = query.ilike('route', `%${effectiveRouteFilter}%`)
      }

      if (effectiveFingerprintFilter) {
        query = query.ilike('error_fingerprint', `%${effectiveFingerprintFilter}%`)
      }

      const { data, error } = await query

      if (error) {
        throw error
      }

      setRows((data ?? []) as CrashTelemetryRow[])
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to load crash telemetry.')
    } finally {
      if (showRefreshingState) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }, [fingerprintFilter, routeFilter, timeWindow])

  const applyQuickPreset = (preset: Partial<TelemetryFilters>) => {
    const resolvedFilters: TelemetryFilters = {
      routeFilter: preset.routeFilter ?? routeFilter,
      fingerprintFilter: preset.fingerprintFilter ?? fingerprintFilter,
      timeWindow: preset.timeWindow ?? timeWindow,
    }

    setRouteFilter(resolvedFilters.routeFilter)
    setFingerprintFilter(resolvedFilters.fingerprintFilter)
    setTimeWindow(resolvedFilters.timeWindow)
    void loadTelemetry(true, resolvedFilters)
  }

  useEffect(() => {
    void loadTelemetry(false)
  }, [loadTelemetry])

  return (
    <section className="admin-shell" aria-label="Crash telemetry diagnostics">
      <section className="hero-card admin-card">
        <p className="eyebrow">Diagnostics</p>
        <h1>Crash Telemetry</h1>
        <p className="subcopy">
          Recent runtime failures captured for post-gig diagnostics. Showing the newest {DEFAULT_LIMIT} events.
        </p>
        <div className="hero-actions no-margin-bottom">
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate('/admin')}
          >
            Back to Dashboard
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={refreshing || loading}
            onClick={() => {
              void loadTelemetry(true)
            }}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={loading || rows.length === 0}
            onClick={downloadCsv}
          >
            Export CSV
          </button>
        </div>
      </section>

      <section className="queue-panel">
        <section className="crash-telemetry-quick-filters" aria-label="Quick filters">
          <button
            type="button"
            className="secondary-button"
            disabled={refreshing || loading}
            onClick={() => {
              applyQuickPreset({
                routeFilter: '',
                fingerprintFilter: '',
                timeWindow: '24h',
              })
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={refreshing || loading}
            onClick={() => {
              applyQuickPreset({
                routeFilter: '',
                fingerprintFilter: '',
                timeWindow: '1h',
              })
            }}
          >
            Last 1h
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={refreshing || loading}
            onClick={() => {
              applyQuickPreset({
                routeFilter: '',
                fingerprintFilter: '',
                timeWindow: '24h',
              })
            }}
          >
            Last 24h
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={refreshing || loading}
            onClick={() => {
              applyQuickPreset({ routeFilter: '/admin' })
            }}
          >
            Route: /admin
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={refreshing || loading}
            onClick={() => {
              applyQuickPreset({ routeFilter: '/mirror' })
            }}
          >
            Route: /mirror
          </button>
        </section>

        <form
          className="crash-telemetry-filters"
          onSubmit={(event) => {
            event.preventDefault()
            void loadTelemetry(true)
          }}
        >
          <div className="field-row">
            <label htmlFor="crash-route-filter">Route contains</label>
            <input
              id="crash-route-filter"
              type="text"
              value={routeFilter}
              onChange={(event) => setRouteFilter(event.target.value)}
              placeholder="/admin"
            />
          </div>

          <div className="field-row">
            <label htmlFor="crash-fingerprint-filter">Fingerprint contains</label>
            <input
              id="crash-fingerprint-filter"
              type="text"
              value={fingerprintFilter}
              onChange={(event) => setFingerprintFilter(event.target.value)}
              placeholder="typeerror"
            />
          </div>

          <div className="field-row">
            <label htmlFor="crash-time-window">Time window</label>
            <select
              id="crash-time-window"
              value={timeWindow}
              onChange={(event) => setTimeWindow(event.target.value as TimeWindowValue)}
            >
              {TIME_WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="hero-actions no-margin-bottom crash-telemetry-filter-actions">
            <button type="submit" className="primary-button" disabled={refreshing || loading}>
              {refreshing ? 'Applying...' : 'Apply Filters'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={refreshing || loading}
              onClick={() => {
                setRouteFilter('')
                setFingerprintFilter('')
                setTimeWindow('24h')
              }}
            >
              Reset
            </button>
          </div>
        </form>

        {loading ? <p className="subcopy no-margin-bottom">Loading crash telemetry...</p> : null}
        {errorText ? <p className="error-text no-margin">{errorText}</p> : null}

        {!loading && !errorText ? (
          <p className="subcopy no-margin-bottom">Showing {rows.length} result{rows.length === 1 ? '' : 's'}.</p>
        ) : null}

        {!loading && !errorText && rows.length === 0 ? (
          <p className="subcopy no-margin-bottom">No crash telemetry events match these filters.</p>
        ) : null}

        {!loading && !errorText && rows.length > 0 ? (
          <div className="setlist-table-wrap">
            <table className="setlist-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Route</th>
                  <th scope="col">Fingerprint</th>
                  <th scope="col">Message</th>
                  <th scope="col">Stack Snippet</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatTimestamp(row.created_at)}</td>
                    <td>{row.route}</td>
                    <td>{row.error_fingerprint}</td>
                    <td>{row.error_message}</td>
                    <td>
                      {row.stack_snippet ? (
                        <details>
                          <summary>View</summary>
                          <pre className="crash-telemetry-stack-snippet">{row.stack_snippet}</pre>
                        </details>
                      ) : (
                        <span className="subcopy">n/a</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  )
}

export default CrashTelemetryPage
