import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ActionButtonGroup, type ActionButtonConfig } from '../components/actions/ActionButtonGroup'
import { SaveStatusBadges } from '../components/settings/SaveStatusBadges'
import { SettingsSection } from '../components/settings/SettingsSection'
import { useAutosaveSaveLifecycle } from '../hooks/useAutosaveSaveLifecycle'
import { useClipboardCopy } from '../hooks/useClipboardCopy'
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
  gigDate: string
  gigStartTime: string
  gigEndTime: string
  subtitle: string
  requestInstructions: string
  playlistOnlyRequests: boolean
  mirrorPhotoSpotlightEnabled: boolean
  allowDuplicateRequests: boolean
  maxActiveRequestsPerUser: string
  selectedPlaylistIds: string[]
  roomOpen: boolean
  explicitFilterEnabled: boolean
  showInAudienceNoGig: boolean
  coverImageUrl: string
}

type UndoRedoState = SettingsState & { timestamp: number }

type GigSettingsFormProps = {
  event: NonNullable<ReturnType<typeof useQueueStore>['event']>
  hostEvents: ReturnType<typeof useQueueStore>['hostEvents']
  onBack: () => void
  updateEventSettings: ReturnType<typeof useQueueStore>['updateEventSettings']
}

const MAX_UNDO_STATES = 20
const MAX_GIG_COVER_IMAGE_BYTES = 3 * 1024 * 1024

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not process that image. Try another file.'))
    }

    reader.onerror = () => {
      reject(new Error('Could not read that image file.'))
    }

    reader.readAsDataURL(file)
  })
}

function normalizePlaylistIds(playlistIds: string[]) {
  return [...new Set(playlistIds)].sort()
}

function arePlaylistSelectionsEqual(left: string[], right: string[]) {
  const normalizedLeft = normalizePlaylistIds(left)
  const normalizedRight = normalizePlaylistIds(right)

  if (normalizedLeft.length !== normalizedRight.length) {
    return false
  }

  return normalizedLeft.every((playlistId, index) => playlistId === normalizedRight[index])
}

function GigSettingsForm({ event, hostEvents, onBack, updateEventSettings }: GigSettingsFormProps) {
  const { user } = useAuthStore()

  // Form State
  const [state, setState] = useState<SettingsState>({
    gigName: event.name,
    venue: event.venue ?? '',
    gigDate: event.gigDate ?? '',
    gigStartTime: event.gigStartTime ?? '',
    gigEndTime: event.gigEndTime ?? '',
    subtitle: event.subtitle ?? '',
    requestInstructions: event.requestInstructions ?? '',
    playlistOnlyRequests: event.playlistOnlyRequests,
    mirrorPhotoSpotlightEnabled: event.mirrorPhotoSpotlightEnabled,
    allowDuplicateRequests: event.allowDuplicateRequests,
    maxActiveRequestsPerUser: event.maxActiveRequestsPerUser ? String(event.maxActiveRequestsPerUser) : '',
    selectedPlaylistIds: [],
    roomOpen: event.roomOpen,
    explicitFilterEnabled: event.explicitFilterEnabled,
    showInAudienceNoGig: event.showInAudienceNoGig,
    coverImageUrl: event.coverImageUrl ?? '',
  })
  const [initialSelectedPlaylistIds, setInitialSelectedPlaylistIds] = useState<string[]>([])

  // Undo/Redo
  const [undoStack, setUndoStack] = useState<UndoRedoState[]>([])
  const [redoStack, setRedoStack] = useState<UndoRedoState[]>([])

  // UI State
  const [playlists, setPlaylists] = useState<HostPlaylist[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(true)
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['gigInfo']))
  const otherAudienceFallbackGigCount = hostEvents.filter(
    (hostEvent) => hostEvent.id !== event.id && hostEvent.showInAudienceNoGig,
  ).length
  const {
    saveStatus,
    cancelAutosave,
    markSaved,
    markError,
    scheduleAutosave,
  } = useAutosaveSaveLifecycle({
    autosaveDelayMs: 2000,
    savedResetDelayMs: 2000,
  })

  const audienceUrl = getAudienceUrl(event.id)
  const {
    copied: copiedAudienceLink,
    copyError,
    setCopyError,
    copyText,
  } = useClipboardCopy({ successDurationMs: 1500 })

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

        const loadedSelectedPlaylistIds = (selectedResult.data ?? []).map((row) => row.playlist_id as string)

        setPlaylists((playlistsResult.data ?? []) as HostPlaylist[])
        setInitialSelectedPlaylistIds(normalizePlaylistIds(loadedSelectedPlaylistIds))
        setState((current) => ({
          ...current,
          selectedPlaylistIds: loadedSelectedPlaylistIds,
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
      let coverUrl: string | null

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
      scheduleAutosave(async () => {
        void performSave(newState)
      })
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
    cancelAutosave()
  }

  const onRedo = () => {
    if (redoStack.length === 0) return
    const nextState = redoStack[redoStack.length - 1]
    setUndoStack((current) => [...current, { ...state, timestamp: Date.now() }])
    setState(nextState)
    setRedoStack((current) => current.slice(0, -1))
    cancelAutosave()
  }

  const performSave = async (saveState: SettingsState) => {
    setErrorText(null)

    if (!saveState.gigName.trim()) {
      setErrorText('Gig name is required.')
      markError()
      return
    }

    try {
      const normalizedLimit = saveState.maxActiveRequestsPerUser.trim()
      const parsedLimit = normalizedLimit ? Number.parseInt(normalizedLimit, 10) : null

      if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
        setErrorText('Request cap must be at least 1, or left blank for no cap.')
        markError()
        return
      }

      await updateEventSettings({
        name: saveState.gigName.trim(),
        venue: saveState.venue.trim(),
        gigDate: saveState.gigDate,
        gigStartTime: saveState.gigStartTime,
        gigEndTime: saveState.gigEndTime,
        subtitle: saveState.subtitle.trim(),
        requestInstructions: saveState.requestInstructions.trim(),
        playlistOnlyRequests: saveState.playlistOnlyRequests,
        selectedPlaylistIds: saveState.selectedPlaylistIds,
        mirrorPhotoSpotlightEnabled: saveState.mirrorPhotoSpotlightEnabled,
        allowDuplicateRequests: saveState.allowDuplicateRequests,
        maxActiveRequestsPerUser: parsedLimit,
        roomOpen: saveState.roomOpen,
        explicitFilterEnabled: saveState.explicitFilterEnabled,
        showInAudienceNoGig: saveState.showInAudienceNoGig,
        coverImageUrl: saveState.coverImageUrl.trim() || null,
      })

      await ensurePlaylistArtwork(saveState.selectedPlaylistIds)
      setInitialSelectedPlaylistIds(normalizePlaylistIds(saveState.selectedPlaylistIds))
      markSaved()
    } catch (error) {
      console.warn('GigSettingsPage: failed to save settings', error)
      setErrorText(error instanceof Error ? error.message : 'Unable to save gig settings.')
      markError()
    }
  }

  const onSelectCoverImage = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorText('Please choose an image file for the gig cover.')
      return
    }

    if (selectedFile.size > MAX_GIG_COVER_IMAGE_BYTES) {
      setErrorText('Cover image is too large. Use an image up to 3 MB.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      pushUndoState()
      updateState({ coverImageUrl: dataUrl })
      setErrorText(null)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to import that cover image.')
    }
  }

  const onManualSave = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    cancelAutosave()
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
    const copiedSuccessfully = await copyText(
      audienceUrl,
      'Copy failed. You can still copy the audience link manually.',
    )

    if (copiedSuccessfully) {
      markSaved(1500)
      setCopyError(null)
      setErrorText(null)
    }
  }

  const headerActions: ActionButtonConfig[] = [
    {
      id: 'go-back',
      label: 'Back',
      onClick: onBack,
    },
    {
      id: 'open-mirror-screen',
      label: 'Mirror Screen',
      onClick: () => {
        window.open('/mirror', '_blank')
      },
      title: 'Open mirror screen in new window',
      variant: 'ghost',
    },
  ]

  useEffect(() => {
    if (copyError) {
      setErrorText(copyError)
    }
  }, [copyError])

  const isModified = state.gigName !== event.name
    || state.venue !== (event.venue ?? '')
    || state.gigDate !== (event.gigDate ?? '')
    || state.gigStartTime !== (event.gigStartTime ?? '')
    || state.gigEndTime !== (event.gigEndTime ?? '')
    || state.subtitle !== (event.subtitle ?? '')
    || state.requestInstructions !== (event.requestInstructions ?? '')
    || state.playlistOnlyRequests !== event.playlistOnlyRequests
    || state.mirrorPhotoSpotlightEnabled !== event.mirrorPhotoSpotlightEnabled
    || state.allowDuplicateRequests !== event.allowDuplicateRequests
    || state.roomOpen !== event.roomOpen
    || state.explicitFilterEnabled !== event.explicitFilterEnabled
    || !arePlaylistSelectionsEqual(state.selectedPlaylistIds, initialSelectedPlaylistIds)
    || state.coverImageUrl !== (event.coverImageUrl ?? '')
    || state.showInAudienceNoGig !== event.showInAudienceNoGig

  return (
    <>
      {/* Header */}
      <section className="gig-settings-header">
        <div className="gig-settings-header-content">
          <h1>{state.gigName}</h1>
          <p className="subcopy">Manage show settings, audience access, and playback rules</p>
        </div>
        <ActionButtonGroup actions={headerActions} layoutClassName="gig-settings-header-actions" />
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

          <SaveStatusBadges
            saveStatus={saveStatus}
            showUnsaved={isModified && saveStatus === 'idle'}
            errorLabel="✗ Error"
          />

          <div className="toolbar-buttons">
            <button type="submit" className="primary-button" disabled={busy || !isModified}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Sections */}
        <SettingsSection
          id="gigInfo"
          title="Gig Info"
          icon="ℹ️"
          isExpanded={expandedSections.has('gigInfo')}
          onToggle={() => toggleSection('gigInfo')}
          expandedClassName="expanded"
          collapsedClassName="collapsed"
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

          <div className="create-gig-time-row">
            <div className="field-row">
              <label htmlFor="gig-date">Date</label>
              <input
                id="gig-date"
                type="date"
                value={state.gigDate}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ gigDate: e.target.value })
                }}
              />
            </div>

            <div className="field-row">
              <label htmlFor="gig-start-time">Start time</label>
              <input
                id="gig-start-time"
                type="time"
                value={state.gigStartTime}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ gigStartTime: e.target.value })
                }}
              />
            </div>

            <div className="field-row">
              <label htmlFor="gig-end-time">End time</label>
              <input
                id="gig-end-time"
                type="time"
                value={state.gigEndTime}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ gigEndTime: e.target.value })
                }}
              />
            </div>
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
        </SettingsSection>

        <SettingsSection
          id="requestSettings"
          title="Audience Request Rules"
          icon="🎤"
          isExpanded={expandedSections.has('requestSettings')}
          onToggle={() => toggleSection('requestSettings')}
          expandedClassName="expanded"
          collapsedClassName="collapsed"
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
        </SettingsSection>

        <SettingsSection
          id="setlistSelection"
          title="Setlist Selection"
          icon="🎵"
          isExpanded={expandedSections.has('setlistSelection')}
          onToggle={() => toggleSection('setlistSelection')}
          expandedClassName="expanded"
          collapsedClassName="collapsed"
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
        </SettingsSection>

        <SettingsSection
          id="mirrorSettings"
          title="Mirror Screen Settings"
          icon="🪞"
          isExpanded={expandedSections.has('mirrorSettings')}
          onToggle={() => toggleSection('mirrorSettings')}
          expandedClassName="expanded"
          collapsedClassName="collapsed"
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
        </SettingsSection>

        <SettingsSection
          id="audienceAccess"
          title="Audience Access & Sharing"
          icon="🔗"
          isExpanded={expandedSections.has('audienceAccess')}
          onToggle={() => toggleSection('audienceAccess')}
          expandedClassName="expanded"
          collapsedClassName="collapsed"
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
                {copiedAudienceLink ? '✓ Copied' : '📋 Copy Link'}
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
            </div>

            <div className="toggle-group">
              <label className="gig-settings-toggle-card" htmlFor="gig-show-in-audience-no-gig">
                <input
                  id="gig-show-in-audience-no-gig"
                  type="checkbox"
                  checked={state.showInAudienceNoGig}
                  onChange={(e) => {
                    pushUndoState()
                    updateState({ showInAudienceNoGig: e.target.checked })
                  }}
                />
                <div>
                  <strong>{state.showInAudienceNoGig ? '✓ Show When No Gig Is Live' : '⊘ Hidden When No Gig Is Live'}</strong>
                  <span>Show this event in the Audience App when no live gig is running</span>
                </div>
              </label>
              <p className="field-hint">
                {state.showInAudienceNoGig
                  ? `Audience fallback preview: "${state.gigName || 'Untitled Gig'}" can appear when no live room is open.`
                  : `Audience fallback preview: "${state.gigName || 'Untitled Gig'}" is hidden while no live room is open.`}
              </p>
              {state.showInAudienceNoGig && otherAudienceFallbackGigCount > 0 ? (
                <p className="error-text request-error-inline">
                  {`Heads up: ${otherAudienceFallbackGigCount} other gig${otherAudienceFallbackGigCount === 1 ? ' is' : 's are'} also set to show when no live room is open.`}
                </p>
              ) : null}
            </div>

            <div className="field-row">
              <label htmlFor="gig-cover-image">Upcoming card cover image</label>
              <input
                id="gig-cover-image"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  void onSelectCoverImage(e)
                }}
              />
              <p className="field-hint">Shown on this gig card in the Audience App when no gig is live.</p>
              {state.coverImageUrl ? (
                <div className="photo-preview">
                  <img src={state.coverImageUrl} alt="Gig cover preview" />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      pushUndoState()
                      updateState({ coverImageUrl: '' })
                    }}
                  >
                    Remove cover
                  </button>
                </div>
              ) : null}
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
        </SettingsSection>

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

function GigSettingsPage() {
  const navigate = useNavigate()
  const { event, hostEvents, loading, updateEventSettings, setActiveEvent } = useQueueStore()
  const [selectedGigId, setSelectedGigId] = useState<string>('')
  const [switchingGig, setSwitchingGig] = useState(false)
  const [switchGigError, setSwitchGigError] = useState<string | null>(null)

  useEffect(() => {
    if (event?.id) {
      setSelectedGigId(event.id)
    }
  }, [event?.id])

  const onSwitchGig = async () => {
    const targetGigId = selectedGigId.trim()

    if (!targetGigId || !event || targetGigId === event.id) {
      return
    }

    setSwitchGigError(null)
    setSwitchingGig(true)

    try {
      await setActiveEvent(targetGigId)
    } catch (error) {
      setSwitchGigError(error instanceof Error ? error.message : 'Unable to switch gig.')
    } finally {
      setSwitchingGig(false)
    }
  }

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
      {hostEvents.length > 1 ? (
        <section className="queue-panel">
          <div className="field-row">
            <label htmlFor="gig-settings-target-gig">Choose gig to apply settings</label>
            <select
              id="gig-settings-target-gig"
              value={selectedGigId}
              onChange={(e) => {
                setSelectedGigId(e.target.value)
              }}
              disabled={switchingGig}
            >
              {hostEvents.map((hostGig) => (
                <option key={hostGig.id} value={hostGig.id}>
                  {hostGig.name}{hostGig.venue ? ` - ${hostGig.venue}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void onSwitchGig()
              }}
              disabled={switchingGig || !event || selectedGigId === event.id}
            >
              {switchingGig ? 'Switching...' : 'Switch to Selected Gig'}
            </button>
          </div>
          {switchGigError ? <p className="error-text">{switchGigError}</p> : null}
        </section>
      ) : null}

      <GigSettingsForm
        key={event.id}
        event={event}
        hostEvents={hostEvents}
        onBack={() => navigate('/admin/gig-control')}
        updateEventSettings={updateEventSettings}
      />
    </section>
  )
}

export default GigSettingsPage