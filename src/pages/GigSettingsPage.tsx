import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import AudioPlayer from '../components/ui/AudioPlayer'
import { ActionButtonGroup, type ActionButtonConfig } from '../components/actions/ActionButtonGroup'
import { SaveStatusBadges } from '../components/settings/SaveStatusBadges'
import { SettingsSection } from '../components/settings/SettingsSection'
import { useAutosaveSaveLifecycle } from '../hooks/useAutosaveSaveLifecycle'
import { useClipboardCopy } from '../hooks/useClipboardCopy'
import { getAudienceUrl } from '../lib/audienceUrl'
import { registerBackgroundSync } from '../lib/backgroundSync'
import { openMirrorScreen } from '../lib/openMirrorScreen'
import { fetchSongArtwork } from '../lib/songArtwork'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

type HostPlaylist = {
  id: string
  name: string
  playlist_type: 'human_jukebox' | 'karaoke'
}

type PlaylistType = 'human_jukebox' | 'karaoke'

type PlaylistArtworkSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
}

type PlaylistOption = {
  id: string
  label: string
  helper: string
}

type IntroAudioLibraryItem = {
  path: string
  name: string
  url: string
  createdAt: string | null
  source: 'current-gig' | 'library'
}

type PlaylistArtworkRow = {
  library_songs: PlaylistArtworkSong | PlaylistArtworkSong[] | null
}

type SettingsState = {
  gigName: string
  venue: string
  eventType: 'halli-live' | 'harald-live' | 'karaoke' | 'build-self'
  karafunUrl: string
  gigDate: string
  gigStartTime: string
  gigEndTime: string
  subtitle: string
  requestInstructions: string
  instagramUrl: string
  tiktokUrl: string
  youtubeUrl: string
  facebookUrl: string
  paypalUrl: string
  mobilpayUrl: string
  contactEmail: string
  playlistOnlyRequests: boolean
  mirrorPhotoSpotlightEnabled: boolean
  mirrorCountdownEnabled: boolean
  mirrorBannerEnabled: boolean
  mirrorBrbQrLink: string
  mirrorBrbQrText: string
  allowDuplicateRequests: boolean
  maxActiveRequestsPerUser: string
  selectedPlaylistIds: string[]
  roomOpen: boolean
  explicitFilterEnabled: boolean
  showInAudienceNoGig: boolean
  coverImageUrl: string
  venueLogoUrl: string
  venueLogoScale: number
  venueLogoOffsetX: number
  venueLogoOffsetY: number
  showCustomButton: boolean
  customButtonLabel: string
  customButtonLink: string
  tipThankYouMessageDA: string
  tipThankYouMessageEN: string
  artistName: string
  audienceVotingEnabled: boolean
  audienceIcelandicEnabled: boolean
  autoLiveEnabled: boolean
  introAudioUrl: string
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
const MAX_GIG_INTRO_AUDIO_BYTES = 12 * 1024 * 1024
const VENUE_LOGO_SCALE_MIN = 20
const VENUE_LOGO_SCALE_MAX = 500

function clampVenueLogoScale(value: number) {
  if (!Number.isFinite(value)) {
    return 100
  }

  return Math.min(VENUE_LOGO_SCALE_MAX, Math.max(VENUE_LOGO_SCALE_MIN, Math.round(value)))
}

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

function isMissingPlaylistTypeColumnError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    hint?: unknown
  }

  const code = typeof normalizedError.code === 'string' ? normalizedError.code : ''
  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return (code === '42703' || code === 'PGRST204') && text.includes('playlist_type')
}

function inferPlaylistType(rawType: string | null | undefined, playlistName: string | null | undefined): PlaylistType {
  if (rawType === 'karaoke') {
    return 'karaoke'
  }

  if ((playlistName ?? '').toLowerCase().includes('karaoke')) {
    return 'karaoke'
  }

  return 'human_jukebox'
}

function getPlaylistThemeLabel(playlistType: PlaylistType) {
  return playlistType === 'karaoke' ? 'Karaoke' : 'Human Jukebox'
}

function getPlaylistThemeDescription(playlistType: PlaylistType) {
  return playlistType === 'karaoke'
    ? 'Audience sing-along requests with a karaoke tag in the live queue.'
    : 'The main request setlist for the regular Human Jukebox flow.'
}

function buildPlaylistOptions(playlists: HostPlaylist[], playlistType: PlaylistType): PlaylistOption[] {
  const typedPlaylists = playlists.filter((playlist) => playlist.playlist_type === playlistType)

  return [
    {
      id: '',
      label: playlistType === 'karaoke' ? 'No karaoke setlist attached' : 'No Human Jukebox setlist selected',
      helper: playlistType === 'karaoke'
        ? 'Leave karaoke optional for this gig.'
        : 'Pick one main setlist for regular requests.',
    },
    ...typedPlaylists.map((playlist) => ({
      id: playlist.id,
      label: playlist.name,
      helper: getPlaylistThemeDescription(playlistType),
    })),
  ]
}

function normalizeTimeValue(value: string | null | undefined): string {
  // Postgres returns 'HH:MM:SS', but <input type="time"> works with 'HH:MM'.
  // Strip the seconds so the comparison never shows a false dirty state.
  const trimmed = (value ?? '').trim()
  return trimmed.length > 5 && trimmed[2] === ':' && trimmed[5] === ':' ? trimmed.slice(0, 5) : trimmed
}

function normalizeRequestCapValue(value: number | string | null | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value))
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (!trimmed) {
      return ''
    }

    const parsed = Number.parseInt(trimmed, 10)
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : trimmed
  }

  return ''
}

function normalizeEventTypeForSave(eventType: SettingsState['eventType']): 'halli-live' | 'karaoke' | 'build-self' {
  return eventType === 'harald-live' ? 'halli-live' : eventType
}

function normalizeEventThemeForSave(eventType: SettingsState['eventType']): 'harald-live' | 'human-jukebox' | 'karaoke' {
  if (eventType === 'karaoke') {
    return 'karaoke'
  }

  if (eventType === 'harald-live') {
    return 'harald-live'
  }

  return 'human-jukebox'
}

function GigSettingsForm({ event, hostEvents, onBack, updateEventSettings }: GigSettingsFormProps) {
  const { user } = useAuthStore()

  // Form State
  const resolvedInitialEventType: SettingsState['eventType'] = event.eventTheme === 'harald-live'
    ? 'harald-live'
    : (event.eventType === 'halli-live' ? 'halli-live' : (event.eventType ?? 'halli-live'))

  const [state, setState] = useState<SettingsState>({
    gigName: event.name,
    venue: event.venue ?? '',
    eventType: resolvedInitialEventType,
    karafunUrl: event.karafunUrl ?? '',
    artistName: event.artistName ?? '',
    audienceVotingEnabled: event.audienceVotingEnabled ?? true,
    audienceIcelandicEnabled: event.audienceIcelandicEnabled ?? false,
    gigDate: event.gigDate ?? '',
      autoLiveEnabled: event.autoLiveEnabled ?? false,
      introAudioUrl: event.introAudioUrl ?? '',
    gigStartTime: normalizeTimeValue(event.gigStartTime),
    gigEndTime: normalizeTimeValue(event.gigEndTime),
    subtitle: event.subtitle ?? '',
    requestInstructions: event.requestInstructions ?? '',
    instagramUrl: event.instagramUrl ?? '',
    tiktokUrl: event.tiktokUrl ?? '',
    youtubeUrl: event.youtubeUrl ?? '',
    facebookUrl: event.facebookUrl ?? '',
    paypalUrl: event.paypalUrl ?? '',
    mobilpayUrl: event.mobilpayUrl ?? '',
    contactEmail: event.contactEmail ?? '',
    playlistOnlyRequests: event.playlistOnlyRequests,
    mirrorPhotoSpotlightEnabled: event.mirrorPhotoSpotlightEnabled,
    mirrorCountdownEnabled: event.mirrorCountdownEnabled,
    mirrorBannerEnabled: event.mirrorBannerEnabled ?? true,
    mirrorBrbQrLink: event.mirrorBrbQrLink ?? '',
    mirrorBrbQrText: event.mirrorBrbQrText ?? '',
    allowDuplicateRequests: event.allowDuplicateRequests,
    maxActiveRequestsPerUser: normalizeRequestCapValue(event.maxActiveRequestsPerUser),
    selectedPlaylistIds: [],
    roomOpen: event.roomOpen,
    explicitFilterEnabled: event.explicitFilterEnabled,
    showInAudienceNoGig: event.showInAudienceNoGig,
    coverImageUrl: event.coverImageUrl ?? '',
    venueLogoUrl: event.venueLogoUrl ?? '',
    venueLogoScale: event.venueLogoScale ?? 100,
    venueLogoOffsetX: event.venueLogoOffsetX ?? 0,
    venueLogoOffsetY: event.venueLogoOffsetY ?? 0,
    showCustomButton: event.showCustomButton ?? false,
    customButtonLabel: event.customButtonLabel ?? '',
    customButtonLink: event.customButtonLink ?? '',
    tipThankYouMessageDA: event.tipThankYouMessageDA ?? '',
    tipThankYouMessageEN: event.tipThankYouMessageEN ?? '',
  })
  const [initialSelectedPlaylistIds, setInitialSelectedPlaylistIds] = useState<string[]>([])

  // Undo/Redo
  const [undoStack, setUndoStack] = useState<UndoRedoState[]>([])
  const [redoStack, setRedoStack] = useState<UndoRedoState[]>([])

  // UI State
  const [playlists, setPlaylists] = useState<HostPlaylist[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(true)
  const [busy, setBusy] = useState(false)
  const [processingCoverImage, setProcessingCoverImage] = useState(false)
  const [processingVenueLogo, setProcessingVenueLogo] = useState(false)
  const [processingIntroAudio, setProcessingIntroAudio] = useState(false)
  const [introAudioLibrary, setIntroAudioLibrary] = useState<IntroAudioLibraryItem[]>([])
  const [introAudioLibraryLoading, setIntroAudioLibraryLoading] = useState(false)
  const [selectedIntroAudioPath, setSelectedIntroAudioPath] = useState('')
  const [fetchingLinksFromSettings, setFetchingLinksFromSettings] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['gigInfo', 'mirrorSettings']))
  const isMountedRef = useRef(true)
  const manualSaveInFlightRef = useRef(false)
  const coverImageInFlightRef = useRef(false)
  const venueLogoInFlightRef = useRef(false)
  const introAudioInFlightRef = useRef(false)

  useEffect(() => {
    if (!user?.id) {
      setIntroAudioLibrary([])
      setSelectedIntroAudioPath('')
      return
    }

    let isCurrent = true

    const loadIntroAudioLibrary = async () => {
      setIntroAudioLibraryLoading(true)

      try {
        const [rootListResult, eventListResult] = await Promise.all([
          supabase.storage.from('gig-intro-audio').list(user.id, {
            limit: 100,
            sortBy: { column: 'created_at', order: 'desc' },
          }),
          supabase.storage.from('gig-intro-audio').list(`${user.id}/${event.id}`, {
            limit: 100,
            sortBy: { column: 'created_at', order: 'desc' },
          }),
        ])

        const rootItems = (rootListResult.data ?? [])
          .filter((entry) => !entry.name.endsWith('/'))
          .filter((entry) => entry.name.toLowerCase().endsWith('.mp3'))
          .map((entry) => ({
            path: `${user.id}/${entry.name}`,
            name: entry.name,
            createdAt: entry.created_at ?? null,
            source: 'library' as const,
          }))

        const eventItems = (eventListResult.data ?? [])
          .filter((entry) => !entry.name.endsWith('/'))
          .filter((entry) => entry.name.toLowerCase().endsWith('.mp3'))
          .map((entry) => ({
            path: `${user.id}/${event.id}/${entry.name}`,
            name: entry.name,
            createdAt: entry.created_at ?? null,
            source: 'current-gig' as const,
          }))

        const merged = [...rootItems, ...eventItems]
        const dedupedByPath = Array.from(new Map(merged.map((entry) => [entry.path, entry])).values())
        const mappedLibrary = dedupedByPath.map((entry) => {
          const { data: publicUrlData } = supabase.storage.from('gig-intro-audio').getPublicUrl(entry.path)

          return {
            path: entry.path,
            name: entry.name,
            url: publicUrlData.publicUrl,
            createdAt: entry.createdAt,
            source: entry.source,
          } satisfies IntroAudioLibraryItem
        })

        if (!isCurrent) {
          return
        }

        setIntroAudioLibrary(mappedLibrary)

        if (state.introAudioUrl) {
          const currentSelection = mappedLibrary.find((item) => item.url === state.introAudioUrl)
          setSelectedIntroAudioPath(currentSelection?.path ?? '')
        } else {
          setSelectedIntroAudioPath('')
        }
      } catch (error) {
        console.warn('GigSettingsPage: failed to load intro audio library', error)
      } finally {
        if (isCurrent) {
          setIntroAudioLibraryLoading(false)
        }
      }
    }

    void loadIntroAudioLibrary()

    return () => {
      isCurrent = false
    }
  }, [event.id, state.introAudioUrl, user?.id])
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

  const audienceUrl = getAudienceUrl(event.id, { compact: true })
  const {
    copied: copiedAudienceLink,
    copyError,
    setCopyError,
    copyText,
  } = useClipboardCopy({ successDurationMs: 1500 })

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Reload playlists whenever the page regains visibility (e.g. user returns from Setlist Library)
  const [playlistRefreshToken, setPlaylistRefreshToken] = useState(0)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setPlaylistRefreshToken((t) => t + 1)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

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
        let loadedPlaylists: HostPlaylist[] = []

        const { data: playlistsWithType, error: playlistsWithTypeError } = await supabase
          .from('playlists')
          .select('id, name, playlist_type')
          .eq('user_id', user.id)
          .order('name', { ascending: true })

        if (playlistsWithTypeError && !isMissingPlaylistTypeColumnError(playlistsWithTypeError)) {
          throw playlistsWithTypeError
        }

        if (playlistsWithTypeError && isMissingPlaylistTypeColumnError(playlistsWithTypeError)) {
          const { data: playlistsWithoutType, error: playlistsWithoutTypeError } = await supabase
            .from('playlists')
            .select('id, name')
            .eq('user_id', user.id)
            .order('name', { ascending: true })

          if (playlistsWithoutTypeError) {
            throw playlistsWithoutTypeError
          }

          loadedPlaylists = ((playlistsWithoutType ?? []) as Array<{ id: string; name: string }>).map((playlist) => ({
            ...playlist,
            playlist_type: inferPlaylistType(null, playlist.name),
          }))
        } else {
          loadedPlaylists = ((playlistsWithType ?? []) as Array<{ id: string; name: string; playlist_type?: string | null }>).map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            playlist_type: inferPlaylistType(playlist.playlist_type, playlist.name),
          }))
        }

        const { data: selectedPlaylists, error: selectedResultError } = await supabase
          .from('event_playlists')
          .select('playlist_id')
          .eq('event_id', event.id)

        if (selectedResultError) {
          throw selectedResultError
        }

        if (!isCurrent) {
          return
        }

        const loadedSelectedPlaylistIds = (selectedPlaylists ?? []).map((row) => row.playlist_id as string)
        const loadedPlaylistIdSet = new Set(loadedPlaylists.map((p) => p.id))
        const validSelectedPlaylistIds = loadedSelectedPlaylistIds.filter((id) => loadedPlaylistIdSet.has(id))

        setPlaylists(loadedPlaylists)
        setInitialSelectedPlaylistIds(normalizePlaylistIds(validSelectedPlaylistIds))
        setState((current) => ({
          ...current,
          selectedPlaylistIds: validSelectedPlaylistIds,
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
  }, [event.id, user?.id, playlistRefreshToken])

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
        eventType: normalizeEventTypeForSave(saveState.eventType),
        eventTheme: normalizeEventThemeForSave(saveState.eventType),
        karafunUrl: saveState.karafunUrl.trim() || null,
        artistName: saveState.artistName.trim() || null,
        audienceVotingEnabled: saveState.audienceVotingEnabled,
        audienceIcelandicEnabled: saveState.audienceIcelandicEnabled,
        gigDate: saveState.gigDate,
        gigStartTime: saveState.gigStartTime,
          autoLiveEnabled: saveState.autoLiveEnabled,
          introAudioUrl: saveState.introAudioUrl.trim() || null,
        gigEndTime: saveState.gigEndTime,
        subtitle: saveState.subtitle.trim(),
        requestInstructions: saveState.requestInstructions.trim(),
        instagramUrl: saveState.instagramUrl.trim(),
        tiktokUrl: saveState.tiktokUrl.trim(),
        youtubeUrl: saveState.youtubeUrl.trim(),
        facebookUrl: saveState.facebookUrl.trim(),
        paypalUrl: saveState.paypalUrl.trim(),
        mobilpayUrl: saveState.mobilpayUrl.trim(),
        contactEmail: saveState.contactEmail.trim(),
        playlistOnlyRequests: saveState.playlistOnlyRequests,
        selectedPlaylistIds: saveState.selectedPlaylistIds,
        mirrorPhotoSpotlightEnabled: saveState.mirrorPhotoSpotlightEnabled,
        mirrorCountdownEnabled: saveState.mirrorCountdownEnabled,
        mirrorBannerEnabled: saveState.mirrorBannerEnabled,
        mirrorBrbQrLink: saveState.mirrorBrbQrLink.trim() || null,
        mirrorBrbQrText: saveState.mirrorBrbQrText.trim() || null,
        allowDuplicateRequests: saveState.allowDuplicateRequests,
        maxActiveRequestsPerUser: parsedLimit,
        maxQueueSize: null,
        roomOpen: saveState.roomOpen,
        explicitFilterEnabled: saveState.explicitFilterEnabled,
        showInAudienceNoGig: saveState.showInAudienceNoGig,
        coverImageUrl: saveState.coverImageUrl.trim() || null,
        venueLogoUrl: saveState.venueLogoUrl.trim() || null,
        venueLogoScale: saveState.venueLogoScale,
        venueLogoOffsetX: saveState.venueLogoOffsetX,
        venueLogoOffsetY: saveState.venueLogoOffsetY,
        showCustomButton: saveState.showCustomButton,
        customButtonLabel: saveState.customButtonLabel.trim() || null,
        customButtonLink: saveState.customButtonLink.trim() || null,
        tipThankYouMessageDA: saveState.tipThankYouMessageDA.trim() || null,
        tipThankYouMessageEN: saveState.tipThankYouMessageEN.trim() || null,
      })

      await ensurePlaylistArtwork(saveState.selectedPlaylistIds)
      setInitialSelectedPlaylistIds(normalizePlaylistIds(saveState.selectedPlaylistIds))
      markSaved()
      await registerBackgroundSync('jukebox-sync')
    } catch (error) {
      console.warn('GigSettingsPage: failed to save settings', error)
      const message = error instanceof Error
        ? error.message
        : (typeof error === 'object' && error !== null && 'message' in error)
          ? String((error as { message: unknown }).message)
          : 'Unable to save gig settings.'
      setErrorText(message)
      markError()
    }
  }

  const onSelectCoverImage = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    if (coverImageInFlightRef.current) {
      return
    }

    coverImageInFlightRef.current = true
    setProcessingCoverImage(true)

    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      coverImageInFlightRef.current = false
      if (isMountedRef.current) {
        setProcessingCoverImage(false)
      }
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorText('Please choose an image file for the gig cover.')
      coverImageInFlightRef.current = false
      setProcessingCoverImage(false)
      return
    }

    if (selectedFile.size > MAX_GIG_COVER_IMAGE_BYTES) {
      setErrorText('Cover image is too large. Use an image up to 3 MB.')
      coverImageInFlightRef.current = false
      setProcessingCoverImage(false)
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)

      if (!isMountedRef.current) {
        return
      }

      pushUndoState()
      updateState({ coverImageUrl: dataUrl })
      setErrorText(null)
    } catch (error) {
      if (!isMountedRef.current) {
        return
      }

      setErrorText(error instanceof Error ? error.message : 'Unable to import that cover image.')
    } finally {
      coverImageInFlightRef.current = false

      if (isMountedRef.current) {
        setProcessingCoverImage(false)
      }
    }
  }

  const onSelectVenueLogo = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    if (venueLogoInFlightRef.current) {
      return
    }

    venueLogoInFlightRef.current = true
    setProcessingVenueLogo(true)

    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      venueLogoInFlightRef.current = false
      if (isMountedRef.current) {
        setProcessingVenueLogo(false)
      }
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorText('Please choose an image file for the venue logo.')
      venueLogoInFlightRef.current = false
      setProcessingVenueLogo(false)
      return
    }

    if (selectedFile.size > MAX_GIG_COVER_IMAGE_BYTES) {
      setErrorText('Venue logo is too large. Use an image up to 3 MB.')
      venueLogoInFlightRef.current = false
      setProcessingVenueLogo(false)
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)

      if (!isMountedRef.current) {
        return
      }

      pushUndoState()
      updateState({ venueLogoUrl: dataUrl })
      setErrorText(null)
    } catch (error) {
      if (!isMountedRef.current) {
        return
      }

      setErrorText(error instanceof Error ? error.message : 'Unable to import that venue logo.')
    } finally {
      venueLogoInFlightRef.current = false

      if (isMountedRef.current) {
        setProcessingVenueLogo(false)
      }
    }
  }

  const onSelectIntroAudio = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    if (introAudioInFlightRef.current) {
      return
    }

    introAudioInFlightRef.current = true
    setProcessingIntroAudio(true)

    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      introAudioInFlightRef.current = false
      if (isMountedRef.current) {
        setProcessingIntroAudio(false)
      }
      return
    }

    const isLikelyMp3 = selectedFile.type === 'audio/mpeg' || selectedFile.name.toLowerCase().endsWith('.mp3')
    if (!isLikelyMp3) {
      setErrorText('Please choose an MP3 file for the intro song.')
      introAudioInFlightRef.current = false
      setProcessingIntroAudio(false)
      return
    }

    if (selectedFile.size > MAX_GIG_INTRO_AUDIO_BYTES) {
      setErrorText('Intro audio is too large. Use an MP3 up to 12 MB.')
      introAudioInFlightRef.current = false
      setProcessingIntroAudio(false)
      return
    }

    if (!user?.id) {
      setErrorText('You must be signed in as host to upload intro audio.')
      introAudioInFlightRef.current = false
      setProcessingIntroAudio(false)
      return
    }

    try {
      const sanitizedFileName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${user.id}/${event.id}/${Date.now()}-${sanitizedFileName}`

      const { error: uploadError } = await supabase
        .storage
        .from('gig-intro-audio')
        .upload(storagePath, selectedFile, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'audio/mpeg',
        })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      const { data: publicUrlData } = supabase
        .storage
        .from('gig-intro-audio')
        .getPublicUrl(storagePath)

      if (!isMountedRef.current) {
        return
      }

      pushUndoState()
      updateState({ introAudioUrl: publicUrlData.publicUrl })
      setSelectedIntroAudioPath(storagePath)
      setErrorText(null)
    } catch (error) {
      if (!isMountedRef.current) {
        return
      }

      const message = error instanceof Error ? error.message : 'Unable to upload intro audio.'
      setErrorText(message)
    } finally {
      introAudioInFlightRef.current = false

      if (isMountedRef.current) {
        setProcessingIntroAudio(false)
      }
    }
  }

  const onSelectSavedIntroAudio = (nextPath: string) => {
    setSelectedIntroAudioPath(nextPath)

    if (!nextPath) {
      pushUndoState()
      updateState({ introAudioUrl: '' })
      return
    }

    const selectedTrack = introAudioLibrary.find((track) => track.path === nextPath)

    if (!selectedTrack) {
      return
    }

    pushUndoState()
    updateState({ introAudioUrl: selectedTrack.url })
    setErrorText(null)
  }

  const onManualSave = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()

    if (manualSaveInFlightRef.current) {
      return
    }

    manualSaveInFlightRef.current = true
    cancelAutosave()
    setBusy(true)

    try {
      await performSave(state)
    } finally {
      manualSaveInFlightRef.current = false

      if (isMountedRef.current) {
        setBusy(false)
      }
    }
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

  const fetchLinksFromSettings = async () => {
    if (!user?.id || fetchingLinksFromSettings) {
      return
    }

    setFetchingLinksFromSettings(true)
    setErrorText(null)

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, mobilpay_url, contact_email')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        throw error
      }

      pushUndoState()
      updateState({
        instagramUrl: data?.instagram_url ?? '',
        tiktokUrl: data?.tiktok_url ?? '',
        youtubeUrl: data?.youtube_url ?? '',
        facebookUrl: data?.facebook_url ?? '',
        paypalUrl: data?.paypal_url ?? '',
        mobilpayUrl: data?.mobilpay_url ?? '',
        contactEmail: data?.contact_email ?? '',
      })
    } catch (error) {
      console.warn('GigSettingsPage: failed to fetch links from settings', error)
      setErrorText(error instanceof Error ? error.message : 'Unable to fetch links from Settings.')
    } finally {
      if (isMountedRef.current) {
        setFetchingLinksFromSettings(false)
      }
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
        void openMirrorScreen()
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

  const selectedHumanJukeboxPlaylistId = state.selectedPlaylistIds.find((playlistId) => (
    playlists.find((playlist) => playlist.id === playlistId)?.playlist_type === 'human_jukebox'
  )) ?? ''

  const selectedKaraokePlaylistId = state.selectedPlaylistIds.find((playlistId) => (
    playlists.find((playlist) => playlist.id === playlistId)?.playlist_type === 'karaoke'
  )) ?? ''

  const currentGigIntroTracks = introAudioLibrary.filter((track) => track.source === 'current-gig')
  const libraryIntroTracks = introAudioLibrary.filter((track) => track.source === 'library')

  const humanJukeboxOptions = buildPlaylistOptions(playlists, 'human_jukebox')
  const karaokeOptions = buildPlaylistOptions(playlists, 'karaoke')

  const setSelectedPlaylistForType = (playlistType: PlaylistType, playlistId: string) => {
    setState((current) => {
      const retainedPlaylistIds = current.selectedPlaylistIds.filter((id) => {
        const matchingPlaylist = playlists.find((playlist) => playlist.id === id)
        return matchingPlaylist?.playlist_type !== playlistType
      })

      const nextSelectedPlaylistIds = playlistId
        ? [...retainedPlaylistIds, playlistId]
        : retainedPlaylistIds

      const nextState = {
        ...current,
        selectedPlaylistIds: nextSelectedPlaylistIds,
      }

      scheduleAutosave(async () => {
        void performSave(nextState)
      })

      return nextState
    })
  }

  const isModified = state.gigName !== event.name
    || state.venue !== (event.venue ?? '')
    || normalizeEventTypeForSave(state.eventType) !== (event.eventType ?? 'halli-live')
    || normalizeEventThemeForSave(state.eventType) !== (event.eventTheme ?? (event.eventType === 'karaoke' ? 'karaoke' : 'human-jukebox'))
    || state.karafunUrl !== (event.karafunUrl ?? '')
    || state.gigDate !== (event.gigDate ?? '')
    || state.gigStartTime !== normalizeTimeValue(event.gigStartTime)
    || state.gigEndTime !== normalizeTimeValue(event.gigEndTime)
    || state.subtitle !== (event.subtitle ?? '')
    || state.requestInstructions !== (event.requestInstructions ?? '')
    || state.instagramUrl !== (event.instagramUrl ?? '')
    || state.tiktokUrl !== (event.tiktokUrl ?? '')
    || state.youtubeUrl !== (event.youtubeUrl ?? '')
    || state.facebookUrl !== (event.facebookUrl ?? '')
    || state.paypalUrl !== (event.paypalUrl ?? '')
    || state.mobilpayUrl !== (event.mobilpayUrl ?? '')
    || state.contactEmail !== (event.contactEmail ?? '')
    || state.playlistOnlyRequests !== event.playlistOnlyRequests
    || state.mirrorPhotoSpotlightEnabled !== event.mirrorPhotoSpotlightEnabled
    || state.mirrorCountdownEnabled !== event.mirrorCountdownEnabled
    || state.mirrorBannerEnabled !== (event.mirrorBannerEnabled ?? true)
    || state.mirrorBrbQrLink !== (event.mirrorBrbQrLink ?? '')
    || state.mirrorBrbQrText !== (event.mirrorBrbQrText ?? '')
    || state.allowDuplicateRequests !== event.allowDuplicateRequests
    || normalizeRequestCapValue(state.maxActiveRequestsPerUser) !== normalizeRequestCapValue(event.maxActiveRequestsPerUser)
    || state.roomOpen !== event.roomOpen
    || state.explicitFilterEnabled !== event.explicitFilterEnabled
    || !arePlaylistSelectionsEqual(state.selectedPlaylistIds, initialSelectedPlaylistIds)
    || state.coverImageUrl !== (event.coverImageUrl ?? '')
    || state.showInAudienceNoGig !== event.showInAudienceNoGig
    || state.venueLogoUrl !== (event.venueLogoUrl ?? '')
    || state.venueLogoScale !== (event.venueLogoScale ?? 100)
    || state.venueLogoOffsetX !== (event.venueLogoOffsetX ?? 0)
    || state.venueLogoOffsetY !== (event.venueLogoOffsetY ?? 0)
    || state.showCustomButton !== (event.showCustomButton ?? false)
    || state.customButtonLabel !== (event.customButtonLabel ?? '')
    || state.customButtonLink !== (event.customButtonLink ?? '')
    || state.tipThankYouMessageDA !== (event.tipThankYouMessageDA ?? '')
    || state.tipThankYouMessageEN !== (event.tipThankYouMessageEN ?? '')
    || state.artistName !== (event.artistName ?? '')
    || state.audienceVotingEnabled !== (event.audienceVotingEnabled ?? true)
    || state.audienceIcelandicEnabled !== (event.audienceIcelandicEnabled ?? false)
  || state.autoLiveEnabled !== (event.autoLiveEnabled ?? false)
  || state.introAudioUrl !== (event.introAudioUrl ?? '')

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

          <div className="field-row">
            <label htmlFor="gig-event-type">Event Type</label>
            <select
              id="gig-event-type"
              value={state.eventType}
              onChange={(e) => {
                pushUndoState()
                updateState({ eventType: e.target.value as 'halli-live' | 'harald-live' | 'karaoke' | 'build-self' })
              }}
            >
              <option value="harald-live">Harald Live</option>
              <option value="halli-live">The Human Jukebox</option>
              <option value="karaoke">Karaoke Event</option>
              <option value="build-self">Build Self Gig</option>
            </select>
          </div>

          {state.eventType === 'karaoke' ? (
            <div className="field-row">
              <label htmlFor="gig-karafun-url">KaraFun Playlist URL</label>
              <input
                id="gig-karafun-url"
                type="url"
                value={state.karafunUrl}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ karafunUrl: e.target.value })
                }}
                placeholder="https://www.karafun.com/..."
              />
              <p className="field-hint">Visible on audience and no-live event cards for karaoke events.</p>
            </div>
          ) : null}

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

          <label className="checkbox-row" htmlFor="gig-auto-live">
            <input
              id="gig-auto-live"
              type="checkbox"
              checked={state.autoLiveEnabled}
              onChange={(e) => {
                pushUndoState()
                updateState({ autoLiveEnabled: e.target.checked })
              }}
            />
            <span>Automatically go live at scheduled start time</span>
          </label>
          {state.autoLiveEnabled ? (
            <p className="field-hint">The gig will activate automatically when the scheduled start time is reached - as long as the host dashboard is open in a browser.</p>
          ) : null}

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

          <div className="field-row">
            <label htmlFor="gig-cover-image">Gig Photo</label>
            <input
              id="gig-cover-image"
              type="file"
              accept="image/*"
              onChange={(e) => {
                void onSelectCoverImage(e)
              }}
              disabled={busy || processingCoverImage}
            />
            <p className="field-hint">Cover photo shown on the audience app and upcoming event card. Max 3 MB.</p>
            {processingCoverImage ? <p className="field-hint">Processing image…</p> : null}
            {state.coverImageUrl ? (
              <div className="photo-preview">
                <img src={state.coverImageUrl} alt="Gig photo preview" />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    pushUndoState()
                    updateState({ coverImageUrl: '' })
                  }}
                >
                  Remove photo
                </button>
              </div>
            ) : null}
          </div>

          <div className="field-row create-gig-intro-panel">
            <label htmlFor="gig-intro-audio">Intro MP3 (optional)</label>
            <input
              id="gig-intro-audio"
              type="file"
              accept=".mp3,audio/mpeg"
              onChange={(e) => {
                void onSelectIntroAudio(e)
              }}
              disabled={busy || processingIntroAudio}
            />
            <p className="field-hint">Upload intro tracks once, then pick any saved MP3 for this gig. Max 12 MB per file.</p>
            {processingIntroAudio ? <p className="field-hint">Uploading intro audio…</p> : null}

            <label htmlFor="gig-intro-audio-library">Saved intro MP3 library</label>
            <select
              id="gig-intro-audio-library"
              value={selectedIntroAudioPath}
              onChange={(e) => onSelectSavedIntroAudio(e.target.value)}
              disabled={busy || processingIntroAudio || introAudioLibraryLoading}
            >
              <option value="">Choose saved MP3…</option>
              {currentGigIntroTracks.length > 0 ? (
                <optgroup label="Current Gig Uploads">
                  {currentGigIntroTracks.map((track) => (
                    <option key={track.path} value={track.path}>
                      {track.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {libraryIntroTracks.length > 0 ? (
                <optgroup label="My Library">
                  {libraryIntroTracks.map((track) => (
                    <option key={track.path} value={track.path}>
                      {track.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {introAudioLibraryLoading ? <p className="field-hint">Loading saved intro tracks…</p> : null}

            {state.introAudioUrl ? (
              <div className="photo-preview create-gig-intro-preview">
                <AudioPlayer src={state.introAudioUrl} />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    pushUndoState()
                    updateState({ introAudioUrl: '' })
                    setSelectedIntroAudioPath('')
                  }}
                >
                  Remove intro audio
                </button>
              </div>
            ) : null}
          </div>

          {state.eventType === 'build-self' ? (
            <>
              <div className="field-row">
                <label htmlFor="gig-artist-name">Artist / performer name</label>
                <input
                  id="gig-artist-name"
                  value={state.artistName}
                  onChange={(e) => {
                    pushUndoState()
                    updateState({ artistName: e.target.value })
                  }}
                  placeholder="Your artist or band name"
                />
              </div>
              <label className="checkbox-row" htmlFor="gig-audience-voting">
                <input
                  id="gig-audience-voting"
                  type="checkbox"
                  checked={state.audienceVotingEnabled}
                  onChange={(e) => {
                    pushUndoState()
                    updateState({ audienceVotingEnabled: e.target.checked })
                  }}
                />
                <span>Allow audience to choose and vote for songs</span>
              </label>
              {!state.audienceVotingEnabled ? (
                <p className="field-hint">Audience will see the setlist only - no requests or voting.</p>
              ) : null}
            </>
          ) : null}
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
            <label className={`toggle-card ${state.roomOpen ? 'toggle-card-active' : 'toggle-card-inactive'}`} htmlFor="gig-room-open">
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
                <strong>{state.roomOpen ? '🟢 Requests Open' : '⏸ Requests Paused'}</strong>
                <span>{state.roomOpen ? 'Audience can add song requests now.' : 'Audience can browse songs, but cannot submit requests.'}</span>
              </div>
            </label>

            <label className={`toggle-card ${state.playlistOnlyRequests ? 'toggle-card-active' : 'toggle-card-inactive'}`} htmlFor="gig-playlist-only">
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
                <strong>{state.playlistOnlyRequests ? '📋 Setlist Only' : '🌐 Any Song Request'}</strong>
                <span>{state.playlistOnlyRequests ? 'Guests can request only songs in your selected setlists.' : 'Guests can type and request songs outside your setlists.'}</span>
              </div>
            </label>

            <label className={`toggle-card ${state.allowDuplicateRequests ? 'toggle-card-active' : 'toggle-card-inactive'}`} htmlFor="gig-allow-duplicates">
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
                <strong>{state.allowDuplicateRequests ? '🔁 Duplicate Requests On' : '🚫 Duplicate Requests Off'}</strong>
                <span>{state.allowDuplicateRequests ? 'The same song can be requested by multiple guests.' : 'A song can only appear once in the live queue.'}</span>
              </div>
            </label>

            <label className={`toggle-card ${state.explicitFilterEnabled ? 'toggle-card-active' : 'toggle-card-inactive'}`} htmlFor="gig-explicit-filter">
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
                <strong>{state.explicitFilterEnabled ? '🧼 Clean Mode On' : '🔊 Explicit Allowed'}</strong>
                <span>{state.explicitFilterEnabled ? 'Tracks marked explicit are blocked from audience requests.' : 'Explicit tracks can be requested by guests.'}</span>
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
                  <span className="meta-badge">{state.selectedPlaylistIds.length} active setlist{state.selectedPlaylistIds.length === 1 ? '' : 's'}</span>
                </div>
                <div className="playlist-type-groups">
                  <section className="playlist-type-group" aria-label="Human Jukebox playlist selection">
                    <div className="playlist-type-group-header">
                      <div>
                        <p className="eyebrow">Primary setlist</p>
                        <h3>Human Jukebox</h3>
                        <p className="subcopy">Choose the main request playlist guests see first.</p>
                      </div>
                    </div>
                    <div className="playlist-grid">
                      {humanJukeboxOptions.map((option) => {
                        const isSelected = selectedHumanJukeboxPlaylistId === option.id

                        return (
                          <label
                            key={`human-jukebox-${option.id || 'none'}`}
                            className={`playlist-card playlist-card-${option.id ? 'active' : 'empty'} playlist-card-human-jukebox ${isSelected ? 'selected' : ''}`}
                            htmlFor={`human-jukebox-playlist-${option.id || 'none'}`}
                          >
                            <input
                              id={`human-jukebox-playlist-${option.id || 'none'}`}
                              type="radio"
                              name="human-jukebox-playlist"
                              checked={isSelected}
                              onChange={() => {
                                pushUndoState()
                                setSelectedPlaylistForType('human_jukebox', option.id)
                              }}
                            />
                            <div className="playlist-card-art" aria-hidden="true">
                              <span className="playlist-card-art-badge">{option.id ? 'Main' : 'Off'}</span>
                              <strong>Human Jukebox</strong>
                            </div>
                            <div className="playlist-info">
                              <strong>{option.label}</strong>
                              <span className="subcopy">{option.helper}</span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </section>

                  <section className="playlist-type-group" aria-label="Karaoke playlist selection">
                    <div className="playlist-type-group-header">
                      <div>
                        <p className="eyebrow">Optional second lane</p>
                        <h3>Karaoke</h3>
                        <p className="subcopy">Choose a separate karaoke-only playlist. Songs from it keep the Karaoke tag in queue.</p>
                      </div>
                    </div>
                    <div className="playlist-grid">
                      {karaokeOptions.map((option) => {
                        const isSelected = selectedKaraokePlaylistId === option.id

                        return (
                          <label
                            key={`karaoke-${option.id || 'none'}`}
                            className={`playlist-card playlist-card-${option.id ? 'active' : 'empty'} playlist-card-karaoke ${isSelected ? 'selected' : ''}`}
                            htmlFor={`karaoke-playlist-${option.id || 'none'}`}
                          >
                            <input
                              id={`karaoke-playlist-${option.id || 'none'}`}
                              type="radio"
                              name="karaoke-playlist"
                              checked={isSelected}
                              onChange={() => {
                                pushUndoState()
                                setSelectedPlaylistForType('karaoke', option.id)
                              }}
                            />
                            <div className="playlist-card-art" aria-hidden="true">
                              <span className="playlist-card-art-badge">{option.id ? 'Sing' : 'Off'}</span>
                              <strong>{getPlaylistThemeLabel('karaoke')}</strong>
                            </div>
                            <div className="playlist-info">
                              <strong>{option.label}</strong>
                              <span className="subcopy">{option.helper}</span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </section>
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
          <div className="field-row">
            <label>Scrolling banner</label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                pushUndoState()
                updateState({ mirrorBannerEnabled: !state.mirrorBannerEnabled })
              }}
            >
              {state.mirrorBannerEnabled ? 'Turn Banner Off' : 'Turn Banner On'}
            </button>
            <p className="field-hint">Quick toggle for the mirror scroller banner.</p>
          </div>

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
                <span>Show audience photos as large 10-second spotlight on mirror</span>
              </div>
            </label>
            <label className="toggle-card" htmlFor="gig-mirror-countdown">
              <input
                id="gig-mirror-countdown"
                type="checkbox"
                checked={state.mirrorCountdownEnabled}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ mirrorCountdownEnabled: e.target.checked })
                }}
              />
              <div>
                <strong>{state.mirrorCountdownEnabled ? '✓ Pre-Show Countdown On' : '⊘ Pre-Show Countdown Off'}</strong>
                <span>Show a live countdown on the mirror before the gig goes live</span>
              </div>
            </label>
            <label className="toggle-card" htmlFor="gig-mirror-banner">
              <input
                id="gig-mirror-banner"
                type="checkbox"
                checked={state.mirrorBannerEnabled}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ mirrorBannerEnabled: e.target.checked })
                }}
              />
              <div>
                <strong>{state.mirrorBannerEnabled ? '✓ Scrolling Banner On' : '⊘ Scrolling Banner Off'}</strong>
                <span>Show or hide the promotional scrolling banner on the mirror screen</span>
              </div>
            </label>
          </div>

          <div className="field-row">
            <label htmlFor="gig-mirror-brb-qr-link">Break Screen QR Link (Optional)</label>
            <input
              id="gig-mirror-brb-qr-link"
              type="url"
              placeholder="https://example.com/offers"
              value={state.mirrorBrbQrLink}
              onChange={(e) => {
                pushUndoState()
                updateState({ mirrorBrbQrLink: e.target.value })
              }}
            />
            <p className="field-hint">When break mode or countdown mode is active, this link is turned into a QR code on the mirror.</p>
          </div>

          <div className="field-row">
            <label htmlFor="gig-mirror-brb-qr-text">Break Screen QR Text (Optional)</label>
            <input
              id="gig-mirror-brb-qr-text"
              type="text"
              placeholder="Scan for menu, offers, or socials"
              value={state.mirrorBrbQrText}
              onChange={(e) => {
                pushUndoState()
                updateState({ mirrorBrbQrText: e.target.value })
              }}
            />
            <p className="field-hint">Short text shown under that QR code on break and countdown screens.</p>
          </div>

          <div className="field-row">
            <label htmlFor="gig-venue-logo">Venue Logo (Optional)</label>
            <input
              id="gig-venue-logo"
              type="file"
              accept="image/*"
              onChange={(e) => {
                void onSelectVenueLogo(e)
              }}
              disabled={busy || processingVenueLogo}
            />
            <p className="field-hint">Display your venue's logo at the top of the mirror screen alongside the event name.</p>
            {state.venueLogoUrl ? (
              <div className="photo-preview">
                <img
                  src={state.venueLogoUrl}
                  alt="Venue logo preview"
                  style={{
                    transform: `scale(${clampVenueLogoScale(state.venueLogoScale) / 100})`,
                    transformOrigin: 'center center',
                  }}
                />
                <label htmlFor="gig-venue-logo-scale">Logo Zoom ({clampVenueLogoScale(state.venueLogoScale)}%)</label>
                <input
                  id="gig-venue-logo-scale"
                  type="range"
                  min={VENUE_LOGO_SCALE_MIN}
                  max={VENUE_LOGO_SCALE_MAX}
                  step={1}
                  value={clampVenueLogoScale(state.venueLogoScale)}
                  onChange={(e) => {
                    pushUndoState()
                    updateState({ venueLogoScale: clampVenueLogoScale(Number(e.target.value)) })
                  }}
                  disabled={busy}
                />
                <p className="field-hint">Adjust how much space the logo uses in the mirror logo block.</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    pushUndoState()
                    updateState({ venueLogoUrl: '', venueLogoScale: 100, venueLogoOffsetX: 0, venueLogoOffsetY: 0 })
                  }}
                >
                  Remove logo
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    pushUndoState()
                    updateState({ venueLogoScale: 100 })
                  }}
                  disabled={busy || clampVenueLogoScale(state.venueLogoScale) === 100}
                >
                  Reset zoom
                </button>
              </div>
            ) : null}
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
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  void fetchLinksFromSettings()
                }}
                disabled={!user?.id || fetchingLinksFromSettings}
              >
                {fetchingLinksFromSettings ? 'Fetching...' : 'Fetch from Settings'}
              </button>
            </div>
            <p className="field-hint">Copies your saved social, email, and tip links from Settings into this gig.</p>

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
              <label htmlFor="gig-contact-email">Audience contact email</label>
              <input
                id="gig-contact-email"
                type="email"
                value={state.contactEmail}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ contactEmail: e.target.value })
                }}
                placeholder="booking@example.com"
              />
              <p className="field-hint">This gig-specific email overrides the host default on the audience page.</p>
            </div>

            <div className="toggle-group">
              <label className="gig-settings-toggle-card" htmlFor="gig-show-custom-button">
                <input
                  id="gig-show-custom-button"
                  type="checkbox"
                  checked={state.showCustomButton}
                  onChange={(e) => {
                    pushUndoState()
                    updateState({ showCustomButton: e.target.checked })
                  }}
                />
                <div>
                  <strong>{state.showCustomButton ? '✓ Custom Button Enabled' : '⊘ Custom Button Off'}</strong>
                  <span>Show a custom action button in the Audience App</span>
                </div>
              </label>
              <label className="gig-settings-toggle-card" htmlFor="gig-audience-icelandic">
                <input
                  id="gig-audience-icelandic"
                  type="checkbox"
                  checked={state.audienceIcelandicEnabled}
                  onChange={(e) => {
                    pushUndoState()
                    updateState({ audienceIcelandicEnabled: e.target.checked })
                  }}
                />
                <div>
                  <strong>{state.audienceIcelandicEnabled ? '✓ Icelandic Language Enabled' : '⊘ Icelandic Language Hidden'}</strong>
                  <span>Show an Icelandic language option in the Audience App.</span>
                </div>
              </label>
              {state.showCustomButton ? (
                <>
                  <div className="field-row">
                    <label htmlFor="gig-custom-button-label">Button label</label>
                    <input
                      id="gig-custom-button-label"
                      type="text"
                      value={state.customButtonLabel}
                      onChange={(e) => {
                        pushUndoState()
                        updateState({ customButtonLabel: e.target.value })
                      }}
                      placeholder="e.g. Beer Menu, Wine List, Food Menu"
                      maxLength={50}
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="gig-custom-button-link">Button link (URL)</label>
                    <input
                      id="gig-custom-button-link"
                      type="url"
                      value={state.customButtonLink}
                      onChange={(e) => {
                        pushUndoState()
                        updateState({ customButtonLink: e.target.value })
                      }}
                      placeholder="https://example.com/menu.pdf"
                    />
                    <p className="field-hint">Link to a PDF, webpage, image, or any URL you want to share with the audience.</p>
                  </div>
                </>
              ) : null}
            </div>

            <div className="field-row">
              <label htmlFor="gig-instagram-url">Instagram URL</label>
              <input
                id="gig-instagram-url"
                type="url"
                value={state.instagramUrl}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ instagramUrl: e.target.value })
                }}
                placeholder="https://instagram.com/your-show"
              />
            </div>

            <div className="field-row">
              <label htmlFor="gig-tiktok-url">TikTok URL</label>
              <input
                id="gig-tiktok-url"
                type="url"
                value={state.tiktokUrl}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ tiktokUrl: e.target.value })
                }}
                placeholder="https://tiktok.com/@your-show"
              />
            </div>

            <div className="field-row">
              <label htmlFor="gig-youtube-url">YouTube URL</label>
              <input
                id="gig-youtube-url"
                type="url"
                value={state.youtubeUrl}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ youtubeUrl: e.target.value })
                }}
                placeholder="https://youtube.com/@your-show"
              />
            </div>

            <div className="field-row">
              <label htmlFor="gig-facebook-url">Facebook URL</label>
              <input
                id="gig-facebook-url"
                type="url"
                value={state.facebookUrl}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ facebookUrl: e.target.value })
                }}
                placeholder="https://facebook.com/your-show"
              />
            </div>

            <div className="field-row">
              <label htmlFor="gig-paypal-url">PayPal URL</label>
              <input
                id="gig-paypal-url"
                type="url"
                value={state.paypalUrl}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ paypalUrl: e.target.value })
                }}
                placeholder="https://paypal.me/your-show"
              />
            </div>

            <div className="field-row">
              <label htmlFor="gig-mobilpay-url">MobilePay</label>
              <input
                id="gig-mobilpay-url"
                type="text"
                value={state.mobilpayUrl}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ mobilpayUrl: e.target.value })
                }}
                placeholder="+45 12 34 56 78 or MobilePay link"
              />
              <p className="field-hint">Accepts either a MobilePay phone number or a full link.</p>
            </div>

            <div className="field-row">
              <label htmlFor="gig-tip-thankyou-da">Tip thank-you message (Danish)</label>
              <input
                id="gig-tip-thankyou-da"
                type="text"
                value={state.tipThankYouMessageDA}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ tipThankYouMessageDA: e.target.value })
                }}
                placeholder="Tusind tak for din støtte — det betyder meget. — Harald"
              />
              <p className="field-hint">Shown to Danish-language audience members after they click the tip jar. Leave blank for the default message.</p>
            </div>

            <div className="field-row">
              <label htmlFor="gig-tip-thankyou-en">Tip thank-you message (English)</label>
              <input
                id="gig-tip-thankyou-en"
                type="text"
                value={state.tipThankYouMessageEN}
                onChange={(e) => {
                  pushUndoState()
                  updateState({ tipThankYouMessageEN: e.target.value })
                }}
                placeholder="Thank you so much for your support — it means a lot. — Harald"
              />
              <p className="field-hint">Shown to English-language audience members after they click the tip jar. Leave blank for the default message.</p>
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
  const switchGigInFlightRef = useRef(false)

  useEffect(() => {
    if (event?.id) {
      setSelectedGigId(event.id)
    }
  }, [event?.id])

  const onSwitchGig = async () => {
    const targetGigId = selectedGigId.trim()

    if (!targetGigId || !event || targetGigId === event.id || switchGigInFlightRef.current) {
      return
    }

    switchGigInFlightRef.current = true
    setSwitchGigError(null)
    setSwitchingGig(true)

    try {
      await setActiveEvent(targetGigId)
    } catch (error) {
      setSwitchGigError(error instanceof Error ? error.message : 'Unable to switch gig.')
    } finally {
      switchGigInFlightRef.current = false
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