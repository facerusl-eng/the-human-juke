import { useAppData } from '../state/AppDataContext'

function SetlistsPage() {
  const { data, isLoading, errorMessage, refresh } = useAppData()
  const setBlocks = data?.setBlocks ?? []

  return (
    <section className="surface-card page-shell" aria-label="Setlists page">
      <header className="page-header">
        <p className="section-kicker">Setlists</p>
        <h2>Compose the night in reusable blocks</h2>
        <p>
          Build modular performance arcs and switch between set plans instantly without losing audience momentum.
        </p>
      </header>

      {isLoading ? <p className="page-state">Loading setlists...</p> : null}
      {errorMessage ? (
        <div className="page-state page-state-error" role="alert">
          <p>{errorMessage}</p>
          <button type="button" onClick={() => void refresh()}>Retry</button>
        </div>
      ) : null}

      <div className="setlist-grid" role="list" aria-label="Setlist blocks">
        {setBlocks.map((block) => (
          <article key={block.id} className="setlist-card" role="listitem">
            <p className="setlist-vibe">{block.vibe}</p>
            <h3>{block.name}</h3>
            <p>{block.songs} songs</p>
            <p>{block.duration}</p>
            <button type="button">Load block</button>
          </article>
        ))}
        {!isLoading && !errorMessage && setBlocks.length === 0 ? (
          <p className="page-state">No set blocks available yet.</p>
        ) : null}
      </div>
    </section>
  )
}

export default SetlistsPage
