type SetBlock = {
  name: string
  songs: number
  vibe: string
  duration: string
}

const setBlocks: SetBlock[] = [
  { name: 'Doors Open Flow', songs: 7, vibe: 'Relaxed uplift', duration: '24 min' },
  { name: 'Prime Crowd Push', songs: 12, vibe: 'Dance-heavy', duration: '44 min' },
  { name: 'Late Night Encore', songs: 5, vibe: 'Big sing-along', duration: '18 min' },
]

function SetlistsPage() {
  return (
    <section className="surface-card page-shell" aria-label="Setlists page">
      <header className="page-header">
        <p className="section-kicker">Setlists</p>
        <h2>Compose the night in reusable blocks</h2>
        <p>
          Build modular performance arcs and switch between set plans instantly without losing audience momentum.
        </p>
      </header>

      <div className="setlist-grid" role="list" aria-label="Setlist blocks">
        {setBlocks.map((block) => (
          <article key={block.name} className="setlist-card" role="listitem">
            <p className="setlist-vibe">{block.vibe}</p>
            <h3>{block.name}</h3>
            <p>{block.songs} songs</p>
            <p>{block.duration}</p>
            <button type="button">Load block</button>
          </article>
        ))}
      </div>
    </section>
  )
}

export default SetlistsPage
