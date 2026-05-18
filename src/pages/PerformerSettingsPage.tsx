import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import SetlistManager from '../components/performer/SetlistManager'
import { loadPerformerSettings, loadSetlistSongs, savePerformerSettings, saveSetlistSongs } from '../lib/performerStorage'
import { DEFAULT_PERFORMER_SETTINGS, type PerformerSettings, type SetlistSong } from '../lib/performerTypes'
import { useAuthStore } from '../state/authStore'

export default function PerformerSettingsPage() {
  const { user } = useAuthStore()
  const [settings, setSettings] = useState<PerformerSettings>(DEFAULT_PERFORMER_SETTINGS)
  const [setlistSongs, setSetlistSongs] = useState<SetlistSong[]>([])
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  useEffect(() => {
    setSettings(loadPerformerSettings(user?.id))
    setSetlistSongs(loadSetlistSongs(user?.id))
    setSaveNotice(null)
  }, [user?.id])

  const updateSettingsField = (field: keyof PerformerSettings) => (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = field === 'auto_refresh_interval'
      ? Number(event.target.value)
      : event.target.value

    setSettings((current) => ({
      ...current,
      [field]: nextValue,
    }))
    setSaveNotice(null)
  }

  const saveAll = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    savePerformerSettings(user?.id, settings)
    saveSetlistSongs(user?.id, setlistSongs)
    setSaveNotice('Performer companion settings saved.')
  }

  const handleSetlistChange = (songs: SetlistSong[]) => {
    setSetlistSongs(songs)
    setSaveNotice(null)
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-purple-300">Performer Companion</p>
        <h1 className="mt-2 text-3xl font-semibold text-gray-100">Settings & Setlist</h1>
        <p className="mt-1 text-sm text-gray-400">
          Configure Human Jukebox and JamZone access, plus your playable setlist.
        </p>
      </header>

      <form className="grid gap-4 rounded-2xl border border-purple-400/20 bg-gray-900/70 p-5 md:grid-cols-2" onSubmit={saveAll}>
        <label className="grid gap-1 text-sm text-gray-200">
          Human Jukebox API key
          <input
            type="password"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            value={settings.human_jukebox_api_key}
            onChange={updateSettingsField('human_jukebox_api_key')}
            autoComplete="off"
          />
        </label>

        <label className="grid gap-1 text-sm text-gray-200">
          Human Jukebox Gig ID
          <input
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            value={settings.human_jukebox_gig_id}
            onChange={updateSettingsField('human_jukebox_gig_id')}
            autoComplete="off"
          />
        </label>

        <label className="grid gap-1 text-sm text-gray-200">
          JamZone API key
          <input
            type="password"
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            value={settings.jamzone_api_key}
            onChange={updateSettingsField('jamzone_api_key')}
            autoComplete="off"
          />
        </label>

        <label className="grid gap-1 text-sm text-gray-200">
          JamZone Playlist ID
          <input
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            value={settings.jamzone_playlist_id}
            onChange={updateSettingsField('jamzone_playlist_id')}
            autoComplete="off"
          />
        </label>

        <label className="grid gap-1 text-sm text-gray-200">
          Auto-refresh interval (seconds)
          <input
            type="number"
            min={5}
            max={120}
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            value={settings.auto_refresh_interval}
            onChange={updateSettingsField('auto_refresh_interval')}
          />
        </label>

        <div className="flex items-end justify-start md:justify-end">
          <button type="submit" className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
            Save settings
          </button>
        </div>

        {saveNotice ? (
          <p className="md:col-span-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {saveNotice}
          </p>
        ) : null}
        <p className="md:col-span-2 text-xs text-amber-200/90">
          Security note: API keys are stored only in this browser profile for convenience. Use dedicated low-scope keys and clear them after gigs on shared devices.
        </p>
      </form>

      <SetlistManager songs={setlistSongs} onChange={handleSetlistChange} />
    </section>
  )
}
