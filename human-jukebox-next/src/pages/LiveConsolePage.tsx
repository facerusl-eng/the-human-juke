import { useAppData } from '../state/AppDataContext'

function LiveConsolePage() {
  const { data, isLoading, errorMessage, refresh } = useAppData()
  const liveConsole = data?.liveConsole ?? null

  return (
    <section className="surface-card page-shell" aria-label="Live console page">
      <header className="page-header">
        <p className="section-kicker">Live Console</p>
        <h2>Stage-safe controls for real-time shows</h2>
        <p>
          Large control targets, immediate state feedback, and clear recovery actions designed for high-pressure moments.
        </p>
      </header>

      {isLoading ? <p className="page-state">Loading live console state...</p> : null}
      {errorMessage ? (
        <div className="page-state page-state-error" role="alert">
          <p>{errorMessage}</p>
          <button type="button" onClick={() => void refresh()}>Retry</button>
        </div>
      ) : null}

      <div className="console-grid">
        <article className="console-panel">
          <p className="panel-label">Show State</p>
          <h3>{liveConsole ? `Current mode: ${liveConsole.state.replace('_', ' ')}` : 'No snapshot yet'}</h3>
          <p>{liveConsole ? `Next transition in ${liveConsole.nextTransitionIn}` : 'Waiting for console snapshot...'}</p>
          <div className="action-row">
            <button type="button" className="btn-live">Go Live</button>
            <button type="button" className="btn-break">Break</button>
          </div>
        </article>

        <article className="console-panel">
          <p className="panel-label">Recovery</p>
          <h3>Connection drift guard</h3>
          <p>{liveConsole ? `All audience clients synced within ${liveConsole.syncLatencyMs}ms.` : 'Sync metrics are initializing.'}</p>
          <div className="action-row">
            <button type="button">Resync mirror</button>
            <button type="button">Recover session</button>
          </div>
        </article>
      </div>
    </section>
  )
}

export default LiveConsolePage
