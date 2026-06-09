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
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: 760, lineHeight: 1.5 }}>
      <h1>Human Jukebox Audience App</h1>
      <p>{status}</p>
      <p>This deployment is isolated from the host app but uses the same Supabase project and auth pipeline.</p>
    </main>
  )
}
