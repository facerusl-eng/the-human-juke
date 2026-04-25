import { useEffect, useRef, useState } from 'react'
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

type SettingsState = {
  gigName: string
  venue: string
  subtitle: string
  requestInstructions: string
  playlistOnlyRequests: boolean
  mirrorPhotoSpotlightEnabled: boolean
  allowDuplicateRequests: boolean
  maxActiveRequestsPerUser: string
  selectedPlaylistIds: string[]
  roomOpen: boolean
  explicitFilterEnabled: boolean
}

type UndoRedoState = SettingsState & { timestamp: number }

type GigSettingsFormProps = {
  event: NonNullable<ReturnType<typeof useQueueStore>['event']>
  onBack: () => void
  updateEventSettings: ReturnType<typeof useQueueStore>['updateEventSettings']
}

const AUTOSAVE_DELAY_MS = 2000
const MAX_UNDO_STATES = 20

function GigSettingsForm({ event, onBack, updateEventSettings }: GigSettingsFormProps) {
  const { user } = useAuthStore()

  // Form State
  const [state, setState] = useState<SettingsState>({
    gigName: event.name,
    venue: event.venue ?? '',
    subtitle: event.subtitle ?? '',
    requestInstructions: event.requestInstructions ?? '',
    playlistOnlyRequests: event.playlistOnlyRequests,
    mirrorPhotoSpotlightEnabled: event.mirrorPhotoSpotlightEnabled,
    allowDuplicateRequests: event.allowDuplicateRequests,
    maxActiveRequestsPerUser: event.maxActiveRequestsPerUser ? String(event.maxActiveRequestsPerUser) : '',
    selectedPlaylistIds: [],
    roomOpen: event.roomOpen,
    explicitFilterEnabled: event.explicitFilterEnabled,
  })

  // Undo/Redo
  const [undoStack, setUndoStack] = useState<UndoRedoState[]>([])
  const [redoStack, setRedoStack] = useState<UndoRedoState[]>([])

  // UI State
  const [playlists, setPlaylists] = useState<HostPlaylist[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['gigInfo']))

  // Autosave
  const autosaveTimerRef = useRef<number | null>(null)

  const audienceUrl = getAudienceUrl(event.id)

  // Load playlists
  useEffect(() => {
    if (!user?.id || !event?.id) {
      return
    }

    let isCurrent = true

    const loadPlaylists = async () => {
      setLoadingPlaylists(true)
      setErrorText(null)

      try {
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
          throw playlistsResult.error
        }

        if (selectedResult.error) {
          throw selectedResult.error
        }

        if (!isCurrent) {
          return
        }

        setPlaylists((playlistsResult.data ?? []) as HostPlaylist[])
        setState((current) => ({
          ...current,
          selectedPlaylistIds: (selectedResult.data ?? []).map((row) => row.playlist_id as string),
        }))
      } catch (error) {
        console.warn('GigSettingsPage: failed to load playlists', error)
        if (isCurrent) {
          setErrorText(error instanceof Error ? error.message : 'Unable to load playlists.')
        }
      } finally {
        if (isCurrent) {
          setLoadingPlaylists(false)
        }
      }
    }

    void loadPlaylists()

    return () => {
      isCurrent = false
    }
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
      let coverUrl: string | null = null

      try {
        coverUrl = await fetchSongArtwork(song.title, song.artist)
      } catch (error) {
        console.warn('GigSettingsPage: artwork fetch failed', { songId: song.id, error })
        continue
      }

      if (!coverUrl) {
        continue
      }

      const { error: updateError } = await supabase
        .from('library_songs')
        .update({ cover_url: coverUrl })
        .eq('id', song.id)

      if (updateError) {
        console.warn('GigSettingsPage: artwork update failed', { songId: song.id, error: updateError })
      }
    }
  }

  // State update helpers
  const updateState = (updates: Partial<SettingsState>) => {
    setState((current) => {
      const newState = { ...current, ...updates }
      triggerAutosave(newState)
      return newState
    })
  }

  const pushUndoState = () => {
    setUndoStack((current) => [...current.slice(-MAX_UNDO_STATES + 1), { ...state, timestamp: Date.now() }])
    setRedoStack([])
  }

  const onUndo = () => {
    if (undoStack.length === 0) return
    const previousState = undoStack[undoStack.length - 1]
    setRedoStack((current) => [...current, { ...state, timestamp: Date.now() }])
    setState(previousState)
    setUndoStack((current) => current.slice(0, -1))
    clearAutosaveTimer()
  }

  const onRedo = () => {
    if (redoStack.length === 0) return
    const nextState = redoStack[redoStack.length - 1]
    setUndoStack((current) => [...current, { ...state, timestamp: Date.now() }])
    setState(nextState)
    setRedoStack((current) => current.slice(0, -1))
    clearAutosaveTimer()
  }

  // Autosave
  const clearAutosaveTimer = () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }

  const triggerAutosave = (newState: SettingsState) => {
    clearAutosaveTimer()
    setSaveStatus('saving')
    autosaveTimerRef.current = window.setTimeout(() => {
      void performSave(newState)
    }, AUTOSAVE_DELAY_MS)
  }

  const performSave = async (saveState: SettingsState) => {
    setErrorText(null)

    if (!saveState.gigName.trim()) {
      setErrorText('Gig name is required.')
      setSaveStatus('error')
      return
    }

    try {
      const normalizedLimit = saveState.maxActiveRequestsPerUser.trim()
      const parsedLimit = normalizedLimit ? Number.parseInt(normalizedLimit, 10) : null

      if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
        setErrorText('Request cap must be at least 1, or left blank for no cap.')
        setSaveStatus('error')
        return
      }

      await updateEventSettings({
        name: saveState.gigName.trim(),
        venue: saveState.venue.trim(),
        subtitle: saveState.subtitle.trim(),
        requestInstructions: saveState.requestInstructions.trim(),
        playlistOnlyRequests: saveState.playlistOnlyRequests,
        selectedPlaylistIds: saveState.selectedPlaylistIds,
        mirrorPhotoSpotlightEnabled: saveState.mirrorPhotoSpotlightEnabled,
        allowDuplicateRequests: saveState.allowDuplicateRequests,
        maxActiveRequestsPerUser: parsedLimit,
        roomOpen: saveState.roomOpen,
        explicitFilterEnabled: saveState.explicitFilterEnabled,
      })

      await ensurePlaylistArtwork(saveState.selectedPlaylistIds)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      console.warn('GigSettingsPage: failed to save settings', error)
      setErrorText(error instanceof Error ? error.message : 'Unable to save gig settings.')
      setSaveStatus('error')
    }
  }

  const onManualSave = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    clearAutosaveTimer()
    setBusy(true)
    await performSave(state)
    setBusy(false)
  }

  const toggleSection = (sectionId: string) => {
    setExpandedSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  const copyAudienceUrl = async () => {
    try {
      await navigator.clipboard.writeText(audienceUrl)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1500)
      return
    } catch {
      // Fall through to legacy copy method
    }

    try {
      const fallbackInput = document.createElement('textarea')
      fallbackInput.value = audienceUrl
      fallbackInput.setAttribute('readonly', '')
      fallbackInput.style.position = 'fixed'
      fallbackInput.style.left = '-9999px'
      document.body.appendChild(fallbackInput)
      fallbackInput.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(fallbackInput)

      if (!copied) {
        throw new Error('copy-failed')
      }

      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1500)
    } catch (error) {
      console.warn('GigSettingsPage: failed to copy audience URL', error)
      setErrorText('Copy failed. You can still copy the audience link manually.')
    }
  }

  const isModified = state.gigName !== event.name
    || state.venue !== (event.venue ?? '')
    || state.subtitle !== (event.subtitle ?? '')
    || state.requestInstructions !== (event.requestInstructions ?? '')
    || state.playlistOnlyRequests !== event.playlistOnlyRequests
    || state.mirrorPhotoSpotlightEnabled !== event.mirrorPhotoSpotlightEnabled
    || state.allowDuplicateRequests !== event.allowDuplicateRequests
    || state.roomOpen !== event.roomOpen
    || state.explicitFilterEnabled !== event.explicitFilterEnabled

  return (
    <>
      {/* Header */}
      <section className="gig-settings-header">
        <div className="gig-settings-header-content">
          <h1>{state.gigName}</h1>
          <p className="subcopy">Manage show settings, audience access, and playback rules</p>
        </div>
        <div className="gig-settings-header-actions">
          <button type="button" className="secondary-button" onClick={onBack}>
            Back
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => window.open('/mirror', '_blank')}
            title="Open mirror screen in new window"
          >
            Mirror Screen
          </button>
        </div>
      </section>

      {/* Main Content */}
      <form className="gig-settings-form" onSubmit={onManualSave}>
        {/* Undo/Redo & Status Bar */}
        <div className="gig-settings-toolbar">
          <div className="toolbar-group">
            <button
              type="button"
              className="icon-button secondary-button"
              onClick={onUndo}
              disabled={undoStack.length === 0}
              title="Undo last change"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              className="icon-button secondary-button"
              onClick={onRedo}
              disabled={redoStack.length === 0}
              title="Redo last change"
            >
              ↷ Redo
            </button>
          </div>

          <div className="toolbar-status">
            {saveStatus === 'saving' && <span className="status-badge saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="status-badge saved">✓ Saved</span>}
            {saveStatus === 'error' && <span className="status-badge error">✗ Error</span>}
            {isModified && saveStatus === 'idle' && <span className="status-badge unsaved">Unsaved changes</span>}
          </div>

          <div className="toolbar-buttons">
            <button type="submit" className="primary-button" disabled={busy || !isModified}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Sections */}
        <CollapsibleSection
          id="gigInfo"
          title="Gig Info"
          icon="ℹ️"
          isExpanded={expandedSections.has('gigInfo')}
          onToggle={() => toggleSection('gigInfo')}
        >
          <div className="field-row">
            <label htmlFor="gig-name">Gig Name</label>
            <input
              id="gig-name"
              type="text"
              value={state.gigName}
              onChange={(e) => {
                pushUndoState()
                updateState({ gigName: e.target.value })
              }}
              placeholder="Friday Night at The Anchor"
              required
            />
          </div>

          <div className="field-row">
            <label htmlFor="gig-venue">Venue</label>
            <input
              id="gig-venue"
              type="text"
              value={state.venue}
              onChange={(e) => {
                pushUndoState()
                updateState({ venue: e.target.value })
              }}
              placeholder="The Anchor Bar, Main Stage"
            />
          </div>

          <div className="field-row">
            <label htmlFor="gig-subtitle">Show Subtitle</label>
            <input
              id="gig-subtitle"
              type="text"
              value={state.subtitle}
              onChange={(e) => {
                pushUndoState()
                updateState({ subtitle: e.target.value })
              }}
              placeholder="Soul, funk, and crowd favorites"
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="requestSettings"
          title="Audience Request Rules"
          icon="🎤"
          isExpanded={expandedSections.has('requestSettings')}
          onToggle={() => toggleSection('requestSettings')}
        >
          <div className="field-row">
            <label htmlFor="gig-instructions">Request Instructions</label>
            <textarea
              id="gig-instructions"
              value={state.requestInstructions}
              onChange={(e) => {
                pushUndoState()
                updateState({ requestInstructions: e.target.value })
              }}
              placeholder="Tell the audience how to request songs..."
              rows={3}
            />
          </div>

          <div className="field-row">
            <label htmlFor="gig-request-cap">Max Requests Per Person</label>
            <input
              id="gig-request-cap"
              type="number"
              min="1"
              step="1"
              value={state.maxActiveRequestsPerUser}
              onChange={(e) => {
                pushUndoState()
                updateState({ maxActiveRequestsPerUser: e.target.value })
              }}
              placeholder="Leave blank for no limit"
            />
          </div>

          <div className="toggle-group">
            <label className="toggle-card" htmlFor="gig-room-open">
              <input
                id="gig-room-open"
                type="checkbox"
                checked={state.roomOpen}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ roomOpen: e.target.checked })
                }}
              />
              <div>
                <strong>{state.roomOpen ? '✓ Room Open' : '⊘ Room Paused'}</strong>
                <span>Audience can submit requests</span>
              </div>
            </label>

            <label className="toggle-card" htmlFor="gig-playlist-only">
              <input
                id="gig-playlist-only"
                type="checkbox"
                checked={state.playlistOnlyRequests}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ playlistOnlyRequests: e.target.checked })
                }}
              />
              <div>
                <strong>{state.playlistOnlyRequests ? '📋 Playlists Only' : '🔓 Open Text'}</strong>
                <span>Restrict to setlist or allow any song</span>
              </div>
            </label>

            <label className="toggle-card" htmlFor="gig-allow-duplicates">
              <input
                id="gig-allow-duplicates"
                type="checkbox"
                checked={state.allowDuplicateRequests}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ allowDuplicateRequests: e.target.checked })
                }}
              />
              <div>
                <strong>{state.allowDuplicateRequests ? '✓ Duplicates Allowed' : '✗ Block Duplicates'}</strong>
                <span>Allow same song requested multiple times</span>
              </div>
            </label>

            <label className="toggle-card" htmlFor="gig-explicit-filter">
              <input
                id="gig-explicit-filter"
                type="checkbox"
                checked={state.explicitFilterEnabled}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ explicitFilterEnabled: e.target.checked })
                }}
              />
              <div>
                <strong>{state.explicitFilterEnabled ? '🔇 Explicit Blocked' : '🔊 Explicit Allowed'}</strong>
                <span>Block requests for explicit tracks</span>
              </div>
            </label>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="setlistSelection"
          title="Setlist Selection"
          icon="🎵"
          isExpanded={expandedSections.has('setlistSelection')}
          onToggle={() => toggleSection('setlistSelection')}
        >
          <div className="playlist-section">
            {loadingPlaylists ? (
              <p className="subcopy">Loading playlists...</p>
            ) : playlists.length === 0 ? (
              <p className="subcopy">No playlists yet. Create playlists in Setlist Library.</p>
            ) : (
              <>
                <div className="playlist-count">
                  <span className="meta-badge">{state.selectedPlaylistIds.length} selected</span>
                </div>
                <div className="playlist-grid">
                  {playlists.map((playlist) => {
                    const isSelected = state.selectedPlaylistIds.includes(playlist.id)
                    return (
                      <label
                        key={playlist.id}
                        className={`playlist-card ${isSelected ? 'selected' : ''}`}
                        htmlFor={`playlist-${playlist.id}`}
                      >
                        <input
                          id={`playlist-${playlist.id}`}
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            pushUndoState()
                            updateState({
                              selectedPlaylistIds: e.target.checked
                                ? [...state.selectedPlaylistIds, playlist.id]
                                : state.selectedPlaylistIds.filter((id) => id !== playlist.id),
                            })
                          }}
                        />
                        <div className="playlist-info">
                          <strong>{playlist.name}</strong>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="mirrorSettings"
          title="Mirror Screen Settings"
          icon="🪞"
          isExpanded={expandedSections.has('mirrorSettings')}
          onToggle={() => toggleSection('mirrorSettings')}
        >
          <div className="toggle-group">
            <label className="toggle-card" htmlFor="gig-mirror-spotlight">
              <input
                id="gig-mirror-spotlight"
                type="checkbox"
                checked={state.mirrorPhotoSpotlightEnabled}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ mirrorPhotoSpotlightEnabled: e.target.checked })
                }}
              />
              <div>
                <strong>{state.mirrorPhotoSpotlightEnabled ? '✓ Photo Spotlight On' : '⊘ Photo Spotlight Off'}</strong>
                <span>Show audience photos as large 7-second spotlight on mirror</span>
              </div>
            </label>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="audienceAccess"
          title="Audience Access & Sharing"
          icon="🔗"
          isExpanded={expandedSections.has('audienceAccess')}
          onToggle={() => toggleSection('audienceAccess')}
        >
          <div className="access-section">
            <div className="link-card">
              <span className="link-label">Audience Link</span>
              <code className="link-value">{audienceUrl}</code>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void copyAudienceUrl()}
              >
                📋 Copy Link
              </button>
            </div>

            <div className="quick-links">
              <button
                type="button"
                className="secondary-button"
                onClick={() => window.open('/audience', '_blank')}
              >
                Open Audience View
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => window.open('/mirror', '_blank')}
              >
                Open Mirror Screen
              </button>
            </div>

            <div className="status-grid">
              <div className="status-item">
                <span className="status-icon">{state.roomOpen ? '✓' : '✗'}</span>
                <div>
                  <strong>{state.roomOpen ? 'Room Open' : 'Room Paused'}</strong>
                  <span className="small-text">Queue status</span>
                </div>
              </div>
              <div className="status-item">
                <span className="status-icon">{state.explicitFilterEnabled ? '🔇' : '🔊'}</span>
                <div>
                  <strong>{state.explicitFilterEnabled ? 'Explicit Blocked' : 'Explicit Allowed'}</strong>
                  <span className="small-text">Content policy</span>
                </div>
              </div>
              <div className="status-item">
                <span className="status-icon">📍</span>
                <div>
                  <strong>{state.venue || 'Not set'}</strong>
                  <span className="small-text">Venue</span>
                </div>
              </div>
              <div className="status-item">
                <span className="status-icon">👥</span>
                <div>
                  <strong>{state.maxActiveRequestsPerUser || 'No limit'}</strong>
                  <span className="small-text">Requests per person</span>
                </div>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        {/* Error Message */}
        {errorText && (
          <div className="error-message">
            <span>⚠️</span>
            <p>{errorText}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy || !isModified}>
            {busy ? 'Saving...' : 'Save Changes'}
          </button>
          <button type="button" className="secondary-button" onClick={onBack} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </>
  )
}

// Collapsible Section Component
interface CollapsibleSectionProps {
  id: string
  title: string
  icon?: string
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function CollapsibleSection({ id, title, icon, isExpanded, onToggle, children }: CollapsibleSectionProps) {
  return (
    <section className={`collapsible-section ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        type="button"
        className="section-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`section-content-${id}`}
      >
        <span className="section-icon">{icon}</span>
        <span className="section-title">{title}</span>
        <span className="section-toggle">{isExpanded ? '▼' : '▶'}</span>
      </button>
      {isExpanded && (
        <div id={`section-content-${id}`} className="section-content">
          {children}
        </div>
      )}
    </section>
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