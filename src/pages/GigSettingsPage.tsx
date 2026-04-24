import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAudienceUrl } from '../lib/audienceUrl'
import { fetchSongArtwork } from '../lib/songArtwork'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

type HostPlaylist = {
  id: string
  name: string
}

type PlaylistArtworkSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
}

type PlaylistArtworkRow = {
  library_songs: PlaylistArtworkSong | PlaylistArtworkSong[] | null
}

type GigSettingsFormProps = {
  event: NonNullable<ReturnType<typeof useQueueStore>['event']>
  onBack: () => void
  updateEventSettings: ReturnType<typeof useQueueStore>['updateEventSettings']
}

function GigSettingsForm({ event, onBack, updateEventSettings }: GigSettingsFormProps) {
  const { user } = useAuthStore()
  const [gigName, setGigName] = useState(event.name)
  const [venue, setVenue] = useState(event.venue ?? '')
  const [subtitle, setSubtitle] = useState(event.subtitle ?? '')
  const [requestInstructions, setRequestInstructions] = useState(event.requestInstructions ?? '')
  const [playlistOnlyRequests, setPlaylistOnlyRequests] = useState(event.playlistOnlyRequests)
  const [mirrorPhotoSpotlightEnabled, setMirrorPhotoSpotlightEnabled] = useState(event.mirrorPhotoSpotlightEnabled)
  const [allowDuplicateRequests, setAllowDuplicateRequests] = useState(event.allowDuplicateRequests)
  const [maxActiveRequestsPerUser, setMaxActiveRequestsPerUser] = useState(
    event.maxActiveRequestsPerUser ? String(event.maxActiveRequestsPerUser) : '',
  )
  const [playlists, setPlaylists] = useState<HostPlaylist[]>([])
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(true)
  const [roomOpen, setRoomOpen] = useState(event.roomOpen)
  const [explicitFilterEnabled, setExplicitFilterEnabled] = useState(event.explicitFilterEnabled)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const audienceUrl = getAudienceUrl()

  useEffect(() => {
    if (!user?.id || !event?.id) {
      return
    }

    void (async () => {
      setLoadingPlaylists(true)
      const [playlistsResult, selectedResult] = await Promise.all([
        supabase
          .from('playlists')
          .select('id, name')
          .eq('user_id', user.id)
          .order('name', { ascending: true }),
        supabase
          .from('event_playlists')
          .select('playlist_id')
          .eq('event_id', event.id),
      ])

      if (playlistsResult.error) {
        setErrorText(playlistsResult.error.message)
        setLoadingPlaylists(false)
        return
      }

      if (selectedResult.error) {
        setErrorText(selectedResult.error.message)
        setLoadingPlaylists(false)
        return
      }

      setPlaylists((playlistsResult.data ?? []) as HostPlaylist[])
      setSelectedPlaylistIds((selectedResult.data ?? []).map((row) => row.playlist_id as string))
      setLoadingPlaylists(false)
    })()
  }, [event.id, user?.id])

  const ensurePlaylistArtwork = async (playlistIds: string[]) => {
    if (!playlistIds.length) {
      return
    }

    const { data, error } = await supabase
      .from('playlist_songs')
      .select('library_songs!inner(id, title, artist, cover_url)')
      .in('playlist_id', playlistIds)

    if (error) {
      throw error
    }

    const songsMissingArtwork = [...new Map(
      ((data ?? []) as PlaylistArtworkRow[])
        .flatMap((row) => {
          const librarySong = Array.isArray(row.library_songs) ? row.library_songs[0] : row.library_songs
          return librarySong ? [librarySong] : []
        })
        .filter((song) => !song.cover_url?.trim())
        .map((song) => [song.id, song]),
    ).values()]

    for (const song of songsMissingArtwork) {
      const coverUrl = await fetchSongArtwork(song.title, song.artist)

      if (!coverUrl) {
        continue
      }

      await supabase
        .from('library_songs')
        .update({ cover_url: coverUrl })
        .eq('id', song.id)
    }
  }

  const onSubmit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    setErrorText(null)
    setSaved(false)

    if (!gigName.trim()) {
      setErrorText('Gig name is required.')
      return
    }

    setBusy(true)

    try {
      const normalizedLimit = maxActiveRequestsPerUser.trim()
      const parsedLimit = normalizedLimit ? Number.parseInt(normalizedLimit, 10) : null

      if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
        setErrorText('Request cap must be at least 1, or left blank for no cap.')
        setBusy(false)
        return
      }

      await updateEventSettings({
        name: gigName.trim(),
        venue: venue.trim(),
        subtitle: subtitle.trim(),
        requestInstructions: requestInstructions.trim(),
        playlistOnlyRequests,
        selectedPlaylistIds,
        mirrorPhotoSpotlightEnabled,
        allowDuplicateRequests,
        maxActiveRequestsPerUser: parsedLimit,
        roomOpen,
        explicitFilterEnabled,
      })

      await ensurePlaylistArtwork(selectedPlaylistIds)
      setSaved(true)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to save gig settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="hero-card admin-card gig-settings-hero">
        <div>
          <p className="eyebrow">Gig Settings</p>
          <h1>{event.name}</h1>
          <p className="subcopy">
            Update the active show details, room status, and audience rules for this gig.
          </p>
        </div>
        <div className="gig-settings-hero-actions">
          <button type="button" className="secondary-button" onClick={onBack}>
            Back to Gig Control
          </button>
          <button type="button" className="ghost-button" onClick={() => window.open('/mirror', '_blank')}>
            Open Mirror Screen
          </button>
        </div>
      </section>

      <section className="gig-settings-layout">
        <form className="queue-panel gig-settings-form" onSubmit={onSubmit}>
          <div className="panel-head">
            <h2>Show Details</h2>
            {saved ? <span className="meta-badge settings-saved-badge">Saved</span> : null}
          </div>

          <div className="field-row">
            <label htmlFor="gig-settings-name">Gig name</label>
            <input
              id="gig-settings-name"
              value={gigName}
              onChange={(event) => setGigName(event.target.value)}
              placeholder="Friday Night at The Anchor"
            />
          </div>

          <div className="field-row">
            <label htmlFor="gig-settings-venue">Venue</label>
            <input
              id="gig-settings-venue"
              value={venue}
              onChange={(event) => setVenue(event.target.value)}
              placeholder="The Anchor Bar, Main Stage"
            />
          </div>

          <div className="field-row">
            <label htmlFor="gig-settings-subtitle">Show subtitle</label>
            <input
              id="gig-settings-subtitle"
              value={subtitle}
              onChange={(event) => setSubtitle(event.target.value)}
              placeholder="Soul, funk, and crowd favorites all night"
            />
          </div>

          <div className="field-row">
            <label htmlFor="gig-settings-instructions">Audience request note</label>
            <textarea
              id="gig-settings-instructions"
              value={requestInstructions}
              onChange={(event) => setRequestInstructions(event.target.value)}
              placeholder="Add the song title and artist. Requests stay cleaner when you include both."
              rows={4}
            />
          </div>

          <div className="field-row">
            <label htmlFor="gig-settings-request-cap">Active requests per audience member</label>
            <input
              id="gig-settings-request-cap"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={maxActiveRequestsPerUser}
              onChange={(event) => setMaxActiveRequestsPerUser(event.target.value)}
              placeholder="Leave blank for no cap"
            />
          </div>

          <div className="gig-settings-toggles">
            <label className="gig-settings-toggle-card" htmlFor="gig-room-open">
              <input
                id="gig-room-open"
                type="checkbox"
                checked={roomOpen}
                onChange={(event) => setRoomOpen(event.target.checked)}
              />
              <div>
                <strong>{roomOpen ? 'Room Open' : 'Room Paused'}</strong>
                <span>Allow the audience to submit new song requests.</span>
              </div>
            </label>

            <label className="gig-settings-toggle-card" htmlFor="gig-explicit-filter">
              <input
                id="gig-explicit-filter"
                type="checkbox"
                checked={explicitFilterEnabled}
                onChange={(event) => setExplicitFilterEnabled(event.target.checked)}
              />
              <div>
                <strong>{explicitFilterEnabled ? 'Explicit Filter On' : 'Explicit Filter Off'}</strong>
                <span>Block explicit requests automatically during this show.</span>
              </div>
            </label>

            <label className="gig-settings-toggle-card" htmlFor="gig-duplicates-allowed">
              <input
                id="gig-duplicates-allowed"
                type="checkbox"
                checked={allowDuplicateRequests}
                onChange={(event) => setAllowDuplicateRequests(event.target.checked)}
              />
              <div>
                <strong>{allowDuplicateRequests ? 'Duplicate Requests Allowed' : 'Duplicate Requests Blocked'}</strong>
                <span>Prevent the same title and artist from being added twice to the live queue.</span>
              </div>
            </label>

            <label className="gig-settings-toggle-card" htmlFor="gig-playlist-only-requests">
              <input
                id="gig-playlist-only-requests"
                type="checkbox"
                checked={playlistOnlyRequests}
                onChange={(event) => setPlaylistOnlyRequests(event.target.checked)}
              />
              <div>
                <strong>{playlistOnlyRequests ? 'Audience Restricted To Gig Playlists' : 'Audience Can Type Any Song'}</strong>
                <span>When enabled, audience can only request songs from playlists selected below.</span>
              </div>
            </label>

            <label className="gig-settings-toggle-card" htmlFor="gig-mirror-photo-spotlight">
              <input
                id="gig-mirror-photo-spotlight"
                type="checkbox"
                checked={mirrorPhotoSpotlightEnabled}
                onChange={(event) => setMirrorPhotoSpotlightEnabled(event.target.checked)}
              />
              <div>
                <strong>{mirrorPhotoSpotlightEnabled ? 'Mirror Photo Spotlight On' : 'Mirror Photo Spotlight Off'}</strong>
                <span>Show audience photo posts as a large 7-second polaroid spotlight on mirror.</span>
              </div>
            </label>
          </div>

          <section className="gig-settings-playlist-picker" aria-label="Playlists for this gig">
            <div className="panel-head">
              <h2>Playlists For This Gig</h2>
              <span className="meta-badge">{selectedPlaylistIds.length} selected</span>
            </div>
            {loadingPlaylists ? <p className="subcopy no-margin">Loading playlists…</p> : null}
            {!loadingPlaylists && playlists.length === 0 ? (
              <p className="subcopy no-margin">No playlists yet. Create playlists in Setlist Library first.</p>
            ) : null}
            {!loadingPlaylists && playlists.length > 0 ? (
              <div className="gig-settings-playlist-list">
                {playlists.map((playlist) => {
                  const isSelected = selectedPlaylistIds.includes(playlist.id)

                  return (
                    <label key={playlist.id} className="gig-settings-playlist-option" htmlFor={`gig-playlist-${playlist.id}`}>
                      <input
                        id={`gig-playlist-${playlist.id}`}
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => {
                          setSelectedPlaylistIds((currentIds) => {
                            if (event.target.checked) {
                              return [...currentIds, playlist.id]
                            }

                            return currentIds.filter((playlistId) => playlistId !== playlist.id)
                          })
                        }}
                      />
                      <div>
                        <strong>{playlist.name}</strong>
                      </div>
                    </label>
                  )
                })}
              </div>
            ) : null}
          </section>

          {errorText ? <p className="error-text no-margin">{errorText}</p> : null}

          <div className="hero-actions no-margin-bottom">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Saving...' : 'Save Gig Settings'}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={onBack}>
              Cancel
            </button>
          </div>
        </form>

        <section className="queue-panel gig-settings-sidecar">
          <div className="panel-head">
            <h2>Audience Access</h2>
            <span className="meta-badge">Live</span>
          </div>

          <p className="subcopy">
            Share the audience link, then control whether the room is open and whether explicit tracks are allowed.
          </p>

          <div className="gig-settings-link-card">
            <span className="gig-settings-link-label">Audience Link</span>
            <p className="gig-settings-link-value">{audienceUrl}</p>
          </div>

          <div className="gig-settings-status-list">
            <div>
              <strong>{roomOpen ? 'Open' : 'Paused'}</strong>
              <span>Queue status</span>
            </div>
            <div>
              <strong>{explicitFilterEnabled ? 'Blocked' : 'Allowed'}</strong>
              <span>Explicit tracks</span>
            </div>
            <div>
              <strong>{venue || 'Not set'}</strong>
              <span>Venue</span>
            </div>
            <div>
              <strong>{subtitle || 'No subtitle yet'}</strong>
              <span>Show subtitle</span>
            </div>
            <div>
              <strong>{maxActiveRequestsPerUser.trim() || 'No cap'}</strong>
              <span>Requests per audience member</span>
            </div>
            <div>
              <strong>{allowDuplicateRequests ? 'Allowed' : 'Blocked'}</strong>
              <span>Duplicate songs</span>
            </div>
            <div>
              <strong>{playlistOnlyRequests ? 'Playlist only' : 'Open text requests'}</strong>
              <span>Audience request mode</span>
            </div>
            <div>
              <strong>{selectedPlaylistIds.length}</strong>
              <span>Gig playlists selected</span>
            </div>
            <div>
              <strong>{mirrorPhotoSpotlightEnabled ? 'Enabled' : 'Disabled'}</strong>
              <span>Mirror photo spotlight</span>
            </div>
          </div>

          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              onClick={async () => {
                await navigator.clipboard.writeText(audienceUrl)
                setSaved(true)
              }}
            >
              Copy Audience Link
            </button>
            <button type="button" className="ghost-button" onClick={() => window.open('/audience', '_blank')}>
              Open Audience View
            </button>
          </div>
        </section>
      </section>
    </>
  )
}

function GigSettingsPage() {
  const navigate = useNavigate()
  const { event, loading, updateEventSettings } = useQueueStore()

  if (loading) {
    return <section className="gig-settings-shell"><section className="queue-panel">Loading gig settings...</section></section>
  }

  if (!event) {
    return (
      <section className="gig-settings-shell" aria-label="Gig settings">
        <section className="hero-card admin-card">
          <p className="eyebrow">No active gig</p>
          <h1>Gig Settings</h1>
          <p className="subcopy">Create a gig first before editing its settings.</p>
          <div className="hero-actions no-margin-bottom">
            <button type="button" className="primary-button" onClick={() => navigate('/admin/create-gig')}>
              Create Gig
            </button>
            <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
              Back to Dashboard
            </button>
          </div>
        </section>
      </section>
    )
  }

  return (
    <section className="gig-settings-shell" aria-label="Gig settings">
      <GigSettingsForm
        key={event.id}
        event={event}
        onBack={() => navigate('/admin/gig-control')}
        updateEventSettings={updateEventSettings}
      />
    </section>
  )
}

export default GigSettingsPage