import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'

export default function App() {
  const [status, setStatus] = useState('Checking Supabase connection...')

  useEffect(() => {
    let cancelled = false

    async function checkConnection() {
      const { error } = await supabase.from('events').select('id').limit(1)

      if (cancelled) {
        return
      }

      if (error) {
        setStatus(`Supabase error: ${error.message}`)
        return
      }

      setStatus('Audience app is connected to Supabase.')
    }

    void checkConnection()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="audience-shell">
      <section className="audience-card" aria-label="Audience app status">
        <h1 className="audience-title">Human Jukebox Audience App</h1>
        <p className="audience-status">{status}</p>
        <p className="audience-copy">
          This deployment is isolated from the host app but uses the same Supabase project and auth pipeline.
        </p>
        <div className="audience-actions">
          <button type="button" className="audience-button">Open Audience Flow</button>
        </div>
      </section>
    </main>
  )
}
