function LiveConsolePage() {
  return (
    <section className="surface-card page-shell" aria-label="Live console page">
      <header className="page-header">
        <p className="section-kicker">Live Console</p>
        <h2>Stage-safe controls for real-time shows</h2>
        <p>
          Large control targets, immediate state feedback, and clear recovery actions designed for high-pressure moments.
        </p>
      </header>

      <div className="console-grid">
        <article className="console-panel">
          <p className="panel-label">Show State</p>
          <h3>Pre-show countdown active</h3>
          <p>Next transition in 07:18</p>
          <div className="action-row">
            <button type="button" className="btn-live">Go Live</button>
            <button type="button" className="btn-break">Break</button>
          </div>
        </article>

        <article className="console-panel">
          <p className="panel-label">Recovery</p>
          <h3>Connection drift guard</h3>
          <p>All audience clients synced within 220ms.</p>
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
