import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readCommittedAudienceLocale, readCommittedAudienceName } from '../lib/audienceIdentity'
import { getLastSongSoonAudienceMessage, isLastSongSoonOverlayMessage, isLastSongSoonPlaybackState, readSharedPlaybackState } from '../lib/playbackState'
import { fetchSongArtwork } from '../lib/songArtwork'
import { supabase } from '../lib/supabase'
import { demoMode } from '../demo/demoMode'
import { DEMO_CURATED_SONGS } from '../demo/demoSongCatalog'
import { batchFetchDemoArtwork } from '../demo/demoArtwork'
import { useQueueStore } from '../state/queueStore'
import { setEventOGTags, resetOGTags } from '../lib/metaTags'
import AudienceFullscreenToggleButton from '../components/audience/AudienceFullscreenToggleButton'
import '../audience-karafun.css'

type CuratedSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
  is_explicit: boolean
  fromKaraokeSetlist: boolean
  searchText: string
}

type SongRow = {
  song: CuratedSong
  title: string
  artist: string
  sectionLabel: string | null
}

type PerformerMode = 'performer' | 'audience'
type PlaylistType = 'human_jukebox' | 'karaoke'

type EventPlaylistRow = {
  playlist_id: string
  playlists: Array<{
    id: string
    name: string | null
    playlist_type: string | null
  }> | {
    id: string
    name: string | null
    playlist_type: string | null
  } | null
}

const SONG_FACT_ROTATE_INTERVAL_MS = 12000
const SONG_FACT_MAX_LENGTH = 220

type SongFactContext = {
  title: string
  artist: string
  isExplicit: boolean
}

function buildSongRows(songs: CuratedSong[]): SongRow[] {
  return songs.map((song, index) => {
    const title = normalizeDisplayText(song.title, 'Untitled Song')
    const artist = normalizeDisplayText(song.artist, 'Unknown Artist')
    const songKey = title.charAt(0).toUpperCase() || '#'
    const previousSong = songs[index - 1]
    const previousTitle = previousSong ? normalizeDisplayText(previousSong.title, 'Untitled Song') : ''
    const previousSongKey = previousTitle.charAt(0).toUpperCase() || '#'

    return {
      song,
      title,
      artist,
      sectionLabel: index === 0 || songKey !== previousSongKey ? songKey : null,
    }
  })
}

function buildSongSearchText(title: string, artist: string) {
  return `${title} ${artist}`.toLowerCase()
}

function decorateCuratedSong(song: Omit<CuratedSong, 'searchText'>): CuratedSong {
  return {
    ...song,
    searchText: buildSongSearchText(song.title, song.artist),
  }
}

function normalizeCoverUrl(coverUrl: string | null | undefined) {
  if (!coverUrl) {
    return null
  }

  const trimmedCoverUrl = coverUrl.trim()

  if (!trimmedCoverUrl) {
    return null
  }

  return trimmedCoverUrl.replace(/^http:\/\//i, 'https://')
}

function normalizeDisplayText(value: string | null | undefined, fallback: string) {
  const trimmedValue = value?.trim()
  return trimmedValue || fallback
}

function sortSongs(left: CuratedSong, right: CuratedSong) {
  const titleComparison = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })

  if (titleComparison !== 0) {
    return titleComparison
  }

  return left.artist.localeCompare(right.artist, undefined, { sensitivity: 'base' })
}

function truncateFact(value: string, maxLength = SONG_FACT_MAX_LENGTH) {
  const trimmed = value.trim()

  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
}

function normalizeSongFacts(facts: string[]) {
  return Array.from(new Set(
    facts
      .map((fact) => truncateFact(fact).replace(/\s+/g, ' ').trim())
      .filter((fact) => fact.length >= 18),
  ))
}

function extractInterestingSentences(extract: string) {
  const sentenceMatches = extract.match(/[^.!?]+[.!?]+/g) ?? []

  const normalizedSentences = sentenceMatches
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 260)
    .filter((sentence) => !/^coordinates?:?/i.test(sentence))

  return Array.from(new Set(normalizedSentences)).slice(0, 8)
}

async function fetchWikipediaSongFacts(title: string, artist: string, signal: AbortSignal) {
  const candidateTitles = [
    `${title} (song)`,
    title,
    `${title} (${artist} song)`,
    `${title} ${artist}`,
    artist,
  ]

  for (const candidateTitle of candidateTitles) {
    try {
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidateTitle)}`
      const summaryResponse = await fetch(summaryUrl, { signal })

      if (!summaryResponse.ok) {
        continue
      }

      const summaryPayload = await summaryResponse.json() as { extract?: string }
      const extract = summaryPayload.extract?.trim()

      if (!extract) {
        continue
      }

      const facts = extractInterestingSentences(extract)
      if (facts.length >= 2) {
        return facts
      }
    } catch {
      // Try the next candidate title.
    }
  }

  return []
}

async function fetchMusicBrainzSongFacts(title: string, artist: string, signal: AbortSignal) {
  const query = `recording:${JSON.stringify(title)} AND artist:${JSON.stringify(artist)}`
  const searchUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=1`

  try {
    const response = await fetch(searchUrl, {
      signal,
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return []
    }

    const payload = await response.json() as {
      recordings?: Array<{
        length?: number
        'first-release-date'?: string
        releases?: Array<{ title?: string }>
      }>
    }

    const recording = payload.recordings?.[0]

    if (!recording) {
      return []
    }

    const releaseTitle = recording.releases?.[0]?.title?.trim()
    const firstReleaseDate = recording['first-release-date']?.trim()
    const releaseYear = firstReleaseDate ? firstReleaseDate.slice(0, 4) : null
    const durationMs = recording.length ?? 0
    const durationMin = durationMs > 0 ? Math.floor(durationMs / 60000) : 0
    const durationSec = durationMs > 0 ? String(Math.round((durationMs % 60000) / 1000)).padStart(2, '0') : '00'
    const durationLabel = durationMs > 0 ? `${durationMin}:${durationSec}` : null

    return [
      releaseYear ? `"${title}" was first released in ${releaseYear}.` : null,
      releaseTitle && releaseTitle.toLowerCase() !== title.toLowerCase()
        ? `The track originally appeared on the album "${releaseTitle}".`
        : null,
      durationLabel ? `Track length is about ${durationLabel}.` : null,
    ].filter((fact): fact is string => Boolean(fact))
  } catch {
    return []
  }
}

function buildLocalSongFacts(song: SongFactContext) {
  const titleWordCount = song.title.trim().split(/\s+/).filter(Boolean).length
  const hasFeature = /\b(feat\.?|ft\.?)\b/i.test(song.title)
  const hasBrackets = /[()\[\]]/.test(song.title)

  return [
    hasFeature
      ? `This looks like a collaboration track: "${song.title}".`
      : `"${song.title}" appears as a solo-style title with no feature tag.`,
    hasBrackets
      ? `The title includes brackets, often used for remixes or live edits.`
      : `No bracket tags in the title, which usually means a standard version.`,
    song.isExplicit
      ? `This song is marked explicit.`
      : `This song is marked clean for all-audience singalongs.`,
    titleWordCount >= 6
      ? `Long title alert: this track name has ${titleWordCount} words.`
      : `Quick title: this track name has ${titleWordCount} words.`,
  ]
}

async function buildInterestingSongFacts(song: SongFactContext, signal: AbortSignal) {
  const wikipediaFacts = await fetchWikipediaSongFacts(song.title, song.artist, signal)
  const musicBrainzFacts = wikipediaFacts.length >= 3
    ? []
    : await fetchMusicBrainzSongFacts(song.title, song.artist, signal)
  const localFacts = buildLocalSongFacts(song)

  return normalizeSongFacts([
    ...wikipediaFacts,
    ...musicBrainzFacts,
    ...localFacts,
  ]).slice(0, 8)
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

function AudienceSongListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    event,
    songs,
    addSong,
    audienceConnectionStatus,
    queueOperatingMode,
    queueHealthMessage,
  } = useQueueStore()

  const [curatedSongs, setCuratedSongs] = useState<CuratedSong[]>([])
  const [showTopVoted, setShowTopVoted] = useState(false)
  const [hasKaraokePlaylist, setHasKaraokePlaylist] = useState(false)
  const [hasHumanJukeboxPlaylist, setHasHumanJukeboxPlaylist] = useState(false)
  const [songSearchQuery, setSongSearchQuery] = useState('')
  const [loadingSongs, setLoadingSongs] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [isFinalSongRequestsClosed, setIsFinalSongRequestsClosed] = useState(false)
  const [selectedSong, setSelectedSong] = useState<CuratedSong | null>(null)
  const [submittingMode, setSubmittingMode] = useState<PerformerMode | null>(null)
  const [activeSetlist, setActiveSetlist] = useState<'human_jukebox' | 'karaoke' | null>(null)
  const [karaokeConfirmPending, setKaraokeConfirmPending] = useState(false)
  const [selectedSongFacts, setSelectedSongFacts] = useState<string[]>([])
  const [currentSongFactIndex, setCurrentSongFactIndex] = useState(0)
  const [loadingSelectedSongFacts, setLoadingSelectedSongFacts] = useState(false)
  const [lastHealthySyncAt, setLastHealthySyncAt] = useState<number | null>(null)
  const [diagnosticsNowMs, setDiagnosticsNowMs] = useState(() => Date.now())

  const audienceName = readCommittedAudienceName()
  const audienceLocale = readCommittedAudienceLocale()
  const performerDisplayName = 'Performer'

  const topVotedSongs = useMemo(
    () => [...songs].filter((s) => !s.is_removed && s.votes_count > 0).sort((a, b) => b.votes_count - a.votes_count),
    [songs],
  )
  const copy = audienceLocale === 'da'
    ? {
        back: 'Tilbage',
        eyebrow: 'Sangliste',
        pickPlaylist: 'Vælg en playliste',
        greeting: 'Hej',
        guest: 'Gæst',
        choosePlaylistFirst: 'vælg først en playliste.',
        chooseRequest: 'vælg en sang nedenfor og send dit ønske.',
        finalSongRequestsClosed: getLastSongSoonAudienceMessage('da'),
        loadingSongs: 'Indlæser sange...',
        hostPlays: 'Værten synger - du vælger sangen',
        youSing: 'Du går på scenen og synger selv',
        songs: 'sange',
        searchSongs: 'Søg sange',
        searchPlaceholder: 'Søg på sangtitel eller artist',
        availableSuffix: 'tilgængelige',
        karaokeSongsLabel: 'Karaoke-sange',
        jukeboxSongsLabel: 'Human Jukebox-sange',
        iSing: 'Jeg synger',
        explicit: 'Eksplicit',
        allMatchingQueued: 'Alle matchende sange ligger allerede i køen.',
        noSongsAssigned: 'Der er endnu ikke lagt sange ind til dette gig.',
        chooseWhoSings: 'Vælg hvem der synger',
        selected: 'Valgt',
        untitledSong: 'Unavngiven sang',
        unknownArtist: 'Ukendt kunstner',
        adding: 'Tilføjer...',
        requestAdded: 'Demo: Dit ønske er lagt i køen.',
        addKaraoke: 'Tilføj karaokeønske (jeg synger denne)',
        karaokeConfirmHeading: 'Vent lige, rockstjerne.',
        karaokeConfirmBody: 'Hvis du fortsætter nu, melder du dig frivilligt - ja, helt personligt - til at gå på scenen og synge denne sang foran alle. Værten kalder dit navn op. Folk vil kigge. Der er ingen vej tilbage. Det bliver fantastisk (eller i det mindste uforglemmeligt).',
        karaokeConfirmGo: 'Ja, jeg gør det!',
        karaokeConfirmAbort: 'Nej tak, ikke alligevel.',
        performerSings: 'Performeren synger sangen',
        iWantToSing: '🎤 Jeg vil synge sangen',
        cancel: 'Annuller',
        unableToLoadSongs: 'Kan ikke indlæse sanglisten lige nu. Prøv igen.',
        unableToAddRequest: 'Kan ikke tilføje dette ønske lige nu.',
      }
    : audienceLocale === 'is'
    ? {
        back: 'Til baka',
        eyebrow: 'Lagalisti',
        pickPlaylist: 'Veldu Lagalista',
        greeting: 'Halló',
        guest: 'Gestur',
        choosePlaylistFirst: 'veldu fyrst playlista.',
        chooseRequest: 'Skrollaðu og veldu lag til að syngja',
        finalSongRequestsClosed: getLastSongSoonAudienceMessage('is'),
        loadingSongs: 'Hleður lög...',
        hostPlays: 'Skemmtarinn spilar — Þú velur lagið',
        youSing: 'Þú brillerar og kemur sjálf/ur uppá sviðið og syngur',
        songs: 'lög',
        searchSongs: 'Leita í lögunum',
        searchPlaceholder: 'Leita eftir lagatitli eða flytjanda',
        availableSuffix: 'tiltæk',
        karaokeSongsLabel: 'Karaoke lög',
        jukeboxSongsLabel: 'Human Jukebox lög',
        iSing: 'Ég syng',
        explicit: 'Explicit',
        allMatchingQueued: 'Öll samsvarandi lög eru þgar í kö.',
        noSongsAssigned: 'Engin lög eru tengd þessu giggi enn.',
        chooseWhoSings: 'Veldu hver syngur',
        selected: 'Valið',
        untitledSong: 'Lag án titils',
        unknownArtist: 'Ókunnur flytjandi',
        adding: 'Bæti við...',
        requestAdded: 'Demo: Óskin þín var bætt í röðina.',
        addKaraoke: 'Bæta við Laginu og ég syng það',
        karaokeConfirmHeading: 'Bíddu aðeins, rokkstjarna.',
        karaokeConfirmBody: 'Ef þú heldur áfram núna ertu basically að segja: "Ó já, ég ætla að fara upp á svið og syngja þetta fyrir framan áhorfendur."\n\nSviðstjórinn mun kalla nafnið þitt hátt og skýrt. Fólk mun snúa sér við. Sumir munu taka upp símann sinn.\n\nEngin leið til baka.\n\nÞetta verður GEGGJAÐÐ!!... eða að minnsta kosti eithvað sem þú munt segja vinum þínum frá á morgun.',
        karaokeConfirmGo: 'Já, ég geri þetta!',
        karaokeConfirmAbort: 'Nei, ég ætla að láta eins og að ég hafi rekist í takkann.',
        performerSings: 'Flytjandinn syngur lagið',
        iWantToSing: '🎸 Ég vil/Vill syngja lagið',
        cancel: 'Hætta við',
        unableToLoadSongs: 'Get ekki hlaðið lagavali núna. Reyndu aftur.',
        unableToAddRequest: 'Get ekki bætt við þessari ósk núna.',
      }
    : {
        back: 'Back',
        eyebrow: 'Song List',
        pickPlaylist: 'Pick a playlist',
        greeting: 'Hi',
        guest: 'Guest',
        choosePlaylistFirst: 'choose a playlist first.',
        chooseRequest: 'Type a song and artist, then hit Add to Queue!',
        finalSongRequestsClosed: getLastSongSoonAudienceMessage('en'),
        loadingSongs: 'Loading songs...',
        hostPlays: 'The host plays — you pick the song',
        youSing: 'You get up and sing it yourself',
        songs: 'songs',
        searchSongs: 'Search songs',
        searchPlaceholder: 'Search by song title or artist',
        availableSuffix: 'available',
        karaokeSongsLabel: 'Karaoke songs',
        jukeboxSongsLabel: 'Human jukebox songs',
        iSing: 'I sing',
        explicit: 'Explicit',
        allMatchingQueued: 'All matching songs are already in queue.',
        noSongsAssigned: 'No songs are assigned to this gig yet.',
        chooseWhoSings: 'Choose who sings',
        selected: 'Selected',
        untitledSong: 'Untitled Song',
        unknownArtist: 'Unknown Artist',
        adding: 'Adding...',
        requestAdded: 'Demo: Your request was added to the queue.',
        addKaraoke: 'Add Karaoke Request (I sing this one)',
        karaokeConfirmHeading: 'Steady on, rockstar.',
        karaokeConfirmBody: 'By proceeding, you are volunteering yourself — yes, you, personally — to walk onto that stage and sing this song in front of everyone here. The host will call your name. People will look at you. There is absolutely no backing out. It is going to be legendary (or at the very least, deeply memorable).',
        karaokeConfirmGo: 'Right, I\'m absolutely doing this.',
        karaokeConfirmAbort: 'On reflection, perhaps not.',
        performerSings: `${performerDisplayName} sings the song`,
        iWantToSing: '🎤 I want to sing the song',
        cancel: 'Cancel',
        unableToLoadSongs: 'Unable to load song choices right now. Please try again.',
        unableToAddRequest: 'Unable to add this request right now.',
      }
  const deferredSongSearchQuery = useDeferredValue(songSearchQuery)
  const normalizedSearchQuery = deferredSongSearchQuery.trim().toLowerCase()

  const connectionStatusLabel = audienceConnectionStatus === 'connected'
    ? 'Connected'
    : audienceConnectionStatus === 'reconnecting'
    ? 'Reconnecting'
    : audienceConnectionStatus === 'offline'
    ? 'Offline'
    : 'Connecting'
  const connectionStatusToneClassName = audienceConnectionStatus === 'connected'
    ? 'is-ok'
    : audienceConnectionStatus === 'reconnecting'
    ? 'is-warn'
    : audienceConnectionStatus === 'offline'
    ? 'is-danger'
    : 'is-muted'

  const formatDurationSinceHealthySync = (ageMs: number) => {
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      return 'just now'
    }

    const ageSeconds = Math.floor(ageMs / 1000)
    if (ageSeconds < 60) {
      return `${ageSeconds}s ago`
    }

    const ageMinutes = Math.floor(ageSeconds / 60)
    if (ageMinutes < 60) {
      return `${ageMinutes}m ago`
    }

    const ageHours = Math.floor(ageMinutes / 60)
    const remainingMinutes = ageMinutes % 60
    if (remainingMinutes === 0) {
      return `${ageHours}h ago`
    }

    return `${ageHours}h ${remainingMinutes}m ago`
  }

  const healthySyncAgeText = lastHealthySyncAt === null
    ? 'waiting for first stable sync'
    : formatDurationSinceHealthySync(diagnosticsNowMs - lastHealthySyncAt)

  const queuedLibrarySongIds = useMemo(() => (
    new Set(
      songs
        .map((song) => song.library_song_id)
        .filter((songId): songId is string => Boolean(songId)),
    )
  ), [songs])

  useEffect(() => {
    if (audienceConnectionStatus === 'connected' && queueOperatingMode === 'normal') {
      setLastHealthySyncAt(Date.now())
    }
  }, [audienceConnectionStatus, queueOperatingMode])

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setDiagnosticsNowMs(Date.now())
    }, 30_000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  const availableSongs = useMemo(() => {
    const explicitFilterEnabled = event?.explicitFilterEnabled ?? false
    const policyFilteredSongs = explicitFilterEnabled
      ? curatedSongs.filter((song) => !song.is_explicit)
      : curatedSongs

    if (!normalizedSearchQuery) {
      return policyFilteredSongs
    }

    return policyFilteredSongs.filter((song) => (
      song.searchText.includes(normalizedSearchQuery)
    ))
  }, [curatedSongs, event?.explicitFilterEnabled, normalizedSearchQuery])

  const humanJukeboxSongs = useMemo(
    () => availableSongs.filter((song) => !song.fromKaraokeSetlist),
    [availableSongs],
  )
  const karaokeSongs = useMemo(
    () => availableSongs.filter((song) => song.fromKaraokeSetlist),
    [availableSongs],
  )
  const humanJukeboxRows = useMemo(() => buildSongRows(humanJukeboxSongs), [humanJukeboxSongs])
  const karaokeRows = useMemo(() => buildSongRows(karaokeSongs), [karaokeSongs])

  useEffect(() => {
    if (!selectedSong || typeof document === 'undefined') {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedSong])

  useEffect(() => {
    if (!selectedSong) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingMode) {
        setSelectedSong(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedSong, submittingMode])

  useEffect(() => {
    if (!selectedSong) {
      setSelectedSongFacts([])
      setCurrentSongFactIndex(0)
      setLoadingSelectedSongFacts(false)
      return
    }

    let isCurrent = true
    const abortController = new AbortController()

    setLoadingSelectedSongFacts(true)
    setSelectedSongFacts([])
    setCurrentSongFactIndex(0)

    void buildInterestingSongFacts({
      title: selectedSong.title,
      artist: selectedSong.artist,
      isExplicit: selectedSong.is_explicit,
    }, abortController.signal)
      .then((facts) => {
        if (!isCurrent) {
          return
        }

        setSelectedSongFacts(facts)
      })
      .catch(() => {
        if (!isCurrent) {
          return
        }

        setSelectedSongFacts(buildLocalSongFacts({
          title: selectedSong.title,
          artist: selectedSong.artist,
          isExplicit: selectedSong.is_explicit,
        }))
      })
      .finally(() => {
        if (isCurrent) {
          setLoadingSelectedSongFacts(false)
        }
      })

    return () => {
      isCurrent = false
      abortController.abort()
    }
  }, [selectedSong])

  useEffect(() => {
    if (!selectedSong || selectedSongFacts.length <= 1) {
      return
    }

    const intervalId = window.setInterval(() => {
      setCurrentSongFactIndex((currentIndex) => (currentIndex + 1) % selectedSongFacts.length)
    }, SONG_FACT_ROTATE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [selectedSong, selectedSongFacts])

  useEffect(() => {
    if (!demoMode && !audienceName) {
      navigate('/audience', { replace: true })
    }
  }, [audienceName, navigate])

  // Update OG meta tags for social media sharing
  useEffect(() => {
    if (!event) {
      resetOGTags()
      return
    }

    const description = event.venue
      ? `Browse and request songs for ${event.name} in ${event.venue}!`
      : `Browse and request songs for ${event.name}!`

    setEventOGTags(event.name, description, undefined, typeof window !== 'undefined' ? window.location.href : undefined)
  }, [event, event?.id, event?.name, event?.venue])

  useEffect(() => {
    const activeEventId = event?.id

    if (!activeEventId || demoMode) {
      setIsFinalSongRequestsClosed(false)
      return
    }

    let isCurrent = true
    let playbackChannel: ReturnType<typeof supabase.channel> | null = null

    const syncFinalSongRequestsClosed = async () => {
      const sharedPlaybackState = await readSharedPlaybackState(activeEventId)

      if (!isCurrent) {
        return
      }

      setIsFinalSongRequestsClosed(isLastSongSoonPlaybackState(sharedPlaybackState))
    }

    void syncFinalSongRequestsClosed()

    playbackChannel = supabase
      .channel(`audience-song-list-playback:${activeEventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'playback_state',
          filter: `event_id=eq.${activeEventId}`,
        },
        () => {
          void syncFinalSongRequestsClosed()
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void syncFinalSongRequestsClosed()
        }
      })

    return () => {
      isCurrent = false
      if (playbackChannel) {
        void supabase.removeChannel(playbackChannel)
      }
    }
  }, [event?.id])

  useEffect(() => {
    if (!isFinalSongRequestsClosed) {
      return
    }

    setSelectedSong(null)
    setKaraokeConfirmPending(false)
    setSubmittingMode(null)
  }, [isFinalSongRequestsClosed])

  useEffect(() => {
    let isCurrent = true

    const loadCuratedSongs = async () => {
      setLoadingSongs(true)
      setErrorText(null)

      if (demoMode) {
        const sorted = [...DEMO_CURATED_SONGS].map(decorateCuratedSong).sort(sortSongs)
        if (isCurrent) {
          setHasKaraokePlaylist(true)
          setHasHumanJukeboxPlaylist(true)
          setCuratedSongs(sorted)
          setLoadingSongs(false)
        }
        // Fetch real album art in background, then do one batch update
        void batchFetchDemoArtwork(sorted).then((artworkMap) => {
          if (!isCurrent || Object.keys(artworkMap).length === 0) return
          setCuratedSongs((current) =>
            current.map((s) => artworkMap[s.id] ? { ...s, cover_url: artworkMap[s.id] } : s),
          )
        })
        return
      }

      const loadFallbackSongs = async () => {
        if (isCurrent) {
          setHasKaraokePlaylist(false)
          setHasHumanJukeboxPlaylist(false)
        }

        const { data: coveredFallbackSongs, error: coveredFallbackSongsError } = await supabase
          .from('library_songs')
          .select('id, title, artist, cover_url, is_explicit')
          .not('cover_url', 'is', null)
          .neq('cover_url', '')
          .order('created_at', { ascending: false })
          .limit(220)

        if (coveredFallbackSongsError) {
          if (isCurrent) {
            setErrorText(coveredFallbackSongsError.message)
          }
          return
        }

        const nextSongsSource = ((coveredFallbackSongs ?? []) as Array<Omit<CuratedSong, 'fromKaraokeSetlist' | 'searchText'>>)
          .map((song) => decorateCuratedSong({ ...song, fromKaraokeSetlist: false }))

        if (nextSongsSource.length === 0) {
          const { data: fallbackSongs, error: fallbackSongsError } = await supabase
            .from('library_songs')
            .select('id, title, artist, cover_url, is_explicit')
            .order('created_at', { ascending: false })
            .limit(220)

          if (fallbackSongsError) {
            if (isCurrent) {
              setErrorText(fallbackSongsError.message)
            }
            return
          }

          if (isCurrent) {
            const nextSongs = ((fallbackSongs ?? []) as Array<Omit<CuratedSong, 'fromKaraokeSetlist' | 'searchText'>>)
              .map((song) => decorateCuratedSong({ ...song, fromKaraokeSetlist: false }))
              .sort(sortSongs)
            setCuratedSongs(nextSongs)
          }
          return
        }

        if (isCurrent) {
          const nextSongs = nextSongsSource.sort(sortSongs)
          setCuratedSongs(nextSongs)
        }
      }

      try {
        if (!event?.id) {
          await loadFallbackSongs()
          return
        }

        if (!event.playlistOnlyRequests) {
          await loadFallbackSongs()
          return
        }

        let eventPlaylistsRows: EventPlaylistRow[] = []

        const { data: eventPlaylistsWithType, error: eventPlaylistsWithTypeError } = await supabase
          .from('event_playlists')
          .select('playlist_id, playlists!inner(id, name, playlist_type)')
          .eq('event_id', event.id)

        if (eventPlaylistsWithTypeError && !isMissingPlaylistTypeColumnError(eventPlaylistsWithTypeError)) {
          if (isCurrent) {
            setErrorText(eventPlaylistsWithTypeError.message)
          }
          return
        }

        if (eventPlaylistsWithTypeError && isMissingPlaylistTypeColumnError(eventPlaylistsWithTypeError)) {
          const { data: fallbackEventPlaylists, error: fallbackEventPlaylistsError } = await supabase
            .from('event_playlists')
            .select('playlist_id, playlists!inner(id, name)')
            .eq('event_id', event.id)

          if (fallbackEventPlaylistsError) {
            if (isCurrent) {
              setErrorText(fallbackEventPlaylistsError.message)
            }
            return
          }

          eventPlaylistsRows = (fallbackEventPlaylists ?? []) as EventPlaylistRow[]
        } else {
          eventPlaylistsRows = (eventPlaylistsWithType ?? []) as EventPlaylistRow[]
        }

        const playlistTypeById = new Map<string, PlaylistType>()

        for (const row of eventPlaylistsRows) {
          const playlistData = Array.isArray(row.playlists) ? row.playlists[0] : row.playlists

          if (!playlistData) {
            continue
          }

          playlistTypeById.set(
            row.playlist_id,
            inferPlaylistType(playlistData.playlist_type, playlistData.name),
          )
        }

        if (!playlistTypeById.size && event.hostId) {
          const { data: hostPlaylistsWithType, error: hostPlaylistsWithTypeError } = await supabase
            .from('playlists')
            .select('id, name, playlist_type')
            .eq('user_id', event.hostId)

          if (hostPlaylistsWithTypeError && !isMissingPlaylistTypeColumnError(hostPlaylistsWithTypeError)) {
            if (isCurrent) {
              setErrorText(hostPlaylistsWithTypeError.message)
            }
            return
          }

          if (hostPlaylistsWithTypeError && isMissingPlaylistTypeColumnError(hostPlaylistsWithTypeError)) {
            const { data: hostPlaylistsWithoutType, error: hostPlaylistsWithoutTypeError } = await supabase
              .from('playlists')
              .select('id, name')
              .eq('user_id', event.hostId)

            if (hostPlaylistsWithoutTypeError) {
              if (isCurrent) {
                setErrorText(hostPlaylistsWithoutTypeError.message)
              }
              return
            }

            for (const playlist of (hostPlaylistsWithoutType ?? []) as Array<{ id: string; name: string | null }>) {
              playlistTypeById.set(playlist.id, inferPlaylistType(null, playlist.name))
            }
          } else {
            for (const playlist of (hostPlaylistsWithType ?? []) as Array<{ id: string; name: string | null; playlist_type: string | null }>) {
              playlistTypeById.set(playlist.id, inferPlaylistType(playlist.playlist_type, playlist.name))
            }
          }
        }

        const playlistIds = [...playlistTypeById.keys()]
        const assignedSetlistTypes = new Set<PlaylistType>(playlistTypeById.values())

        if (isCurrent) {
          setHasKaraokePlaylist(assignedSetlistTypes.has('karaoke'))
          setHasHumanJukeboxPlaylist(assignedSetlistTypes.has('human_jukebox'))
        }

        if (!playlistIds.length) {
          if (isCurrent) {
            setCuratedSongs([])
          }
          return
        }

        const { data: playlistSongs, error: playlistSongsError } = await supabase
          .from('playlist_songs')
          .select('playlist_id, song_id')
          .in('playlist_id', playlistIds)

        if (playlistSongsError) {
          if (isCurrent) {
            setErrorText(playlistSongsError.message)
          }
          return
        }

        const karaokeSongIds = new Set<string>()
        const songIds = new Set<string>()

        for (const row of (playlistSongs ?? []) as Array<{ playlist_id?: string | null; song_id?: string | null }>) {
          if (!row.song_id) {
            continue
          }

          songIds.add(row.song_id)

          if (row.playlist_id && playlistTypeById.get(row.playlist_id) === 'karaoke') {
            karaokeSongIds.add(row.song_id)
          }
        }

        if (!songIds.size) {
          if (isCurrent) {
            setCuratedSongs([])
          }
          return
        }

        const { data: librarySongs, error: librarySongsError } = await supabase
          .from('library_songs')
          .select('id, title, artist, cover_url, is_explicit')
          .in('id', [...songIds])

        if (librarySongsError) {
          if (isCurrent) {
            setErrorText(librarySongsError.message)
          }
          return
        }

        if (isCurrent) {
          const dedupedSongs = new Map<string, CuratedSong>()

          for (const song of (librarySongs ?? []) as Array<Omit<CuratedSong, 'fromKaraokeSetlist' | 'searchText'>>) {
            if (!dedupedSongs.has(song.id)) {
              dedupedSongs.set(song.id, {
                ...decorateCuratedSong({
                  ...song,
                  fromKaraokeSetlist: karaokeSongIds.has(song.id),
                }),
              })
            }
          }

          const nextSongs = [...dedupedSongs.values()].sort(sortSongs)

          setCuratedSongs(nextSongs)
        }
      } catch (error) {
        console.warn('AudienceSongListPage: failed to load songs', error)
        if (isCurrent) {
          setErrorText(copy.unableToLoadSongs)
        }
      } finally {
        if (isCurrent) {
          setLoadingSongs(false)
        }
      }
    }

    void loadCuratedSongs()

    return () => {
      isCurrent = false
    }
  }, [copy.unableToLoadSongs, event?.id, event?.hostId, event?.playlistOnlyRequests])

  useEffect(() => {
    if (demoMode) {
      return
    }

    const songsMissingArtwork = curatedSongs
      .filter((song) => !song.cover_url?.trim())
      .slice(0, 8)

    if (!songsMissingArtwork.length) {
      return
    }

    let isCancelled = false

    const hydrateArtwork = async () => {
      for (const song of songsMissingArtwork) {
        let coverUrl: string | null

        try {
          coverUrl = await fetchSongArtwork(song.title, song.artist)
        } catch {
          continue
        }

        if (!coverUrl || isCancelled) {
          continue
        }

        const normalizedCover = normalizeCoverUrl(coverUrl)

        if (!normalizedCover) {
          continue
        }

        const { error } = await supabase
          .from('library_songs')
          .update({ cover_url: normalizedCover })
          .eq('id', song.id)

        if (!error && !isCancelled) {
          setCuratedSongs((currentSongs) => currentSongs.map((currentSong) => (
            currentSong.id === song.id ? { ...currentSong, cover_url: normalizedCover } : currentSong
          )))
        }
      }
    }

    void hydrateArtwork()

    return () => {
      isCancelled = true
    }
  }, [curatedSongs])

  const submitSongRequest = async (mode: PerformerMode) => {
    if (!selectedSong || submittingMode) {
      return
    }

    if (!event?.roomOpen) {
      setErrorText('Requests are currently paused. You can browse songs, but cannot submit right now.')
      return
    }

    if (isFinalSongRequestsClosed) {
      setErrorText(copy.finalSongRequestsClosed)
      return
    }

    const effectiveMode: PerformerMode = selectedSong.fromKaraokeSetlist ? 'audience' : mode

    setSubmittingMode(effectiveMode)
    setErrorText(null)

    // Capture position before the async insert so we can show it on the next screen.
    const estimatedQueuePosition = songs.length + 1

    try {
      await addSong(selectedSong.title, selectedSong.artist, selectedSong.is_explicit, {
        coverUrl: selectedSong.cover_url,
        librarySongId: selectedSong.id,
        performerMode: effectiveMode,
      })

      const baseAudienceUrl = `/audience${location.search || ''}`
      const separator = location.search ? '&' : '?'
      const targetAudienceUrl = `${baseAudienceUrl}${separator}queued=${estimatedQueuePosition}`

      if (demoMode) {
        navigate(targetAudienceUrl, {
          replace: true,
          state: { requestConfirmation: copy.requestAdded },
        })
        return
      }

      // Use a full navigation to avoid stale lazy-chunk errors after rapid deploys.
      if (typeof window !== 'undefined') {
        window.location.assign(targetAudienceUrl)
        return
      }

      navigate(targetAudienceUrl, { replace: true })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : copy.unableToAddRequest)
      setSubmittingMode(null)
    }
  }

  // Derived: setlist chooser should appear when both playlist modes are assigned.
  const hasBothSetlists = hasKaraokePlaylist && hasHumanJukeboxPlaylist
  const effectiveSetlist = activeSetlist ?? (hasKaraokePlaylist && !hasHumanJukeboxPlaylist ? 'karaoke' : 'human_jukebox')
  const showPlaylistPicker = !loadingSongs && hasBothSetlists && activeSetlist === null
  const activeRows = effectiveSetlist === 'karaoke' ? karaokeRows : humanJukeboxRows
  const handleSelectSong = useCallback((song: CuratedSong) => {
    if (!event?.roomOpen) {
      setErrorText('Requests are currently paused. You can browse songs, but cannot submit right now.')
      return
    }

    if (isFinalSongRequestsClosed) {
      setErrorText(copy.finalSongRequestsClosed)
      return
    }

    setSelectedSong(song)
    setKaraokeConfirmPending(audienceLocale === 'is' && song.fromKaraokeSetlist)
    setErrorText(null)
  }, [audienceLocale, copy.finalSongRequestsClosed, event?.roomOpen, isFinalSongRequestsClosed])

  const currentSongFact = selectedSongFacts.length > 0
    ? selectedSongFacts[currentSongFactIndex % selectedSongFacts.length]
    : null

  return (
    <section className="audience-song-list-shell audience-karafun" aria-label="Song list page">
      <header className="audience-song-list-header">
        <div className="audience-song-list-top-actions">
          <button
            type="button"
            className="secondary-button audience-song-list-back"
            onClick={() => {
              if (activeSetlist !== null && hasBothSetlists) {
                setActiveSetlist(null)
                setSongSearchQuery('')
              } else {
                navigate(`/audience${location.search || ''}`, { replace: true })
              }
            }}
          >
            ← {copy.back}
          </button>
          <AudienceFullscreenToggleButton locale={audienceLocale} className="audience-song-list-fullscreen" />
        </div>
        <div className="audience-song-list-header-copy">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{showPlaylistPicker ? copy.pickPlaylist : effectiveSetlist === 'karaoke' ? 'Karaoke' : 'Human Jukebox'}</h1>
          <p className="subcopy">{copy.greeting} {audienceName || copy.guest} — {showPlaylistPicker ? copy.choosePlaylistFirst : copy.chooseRequest}</p>
        </div>
        {topVotedSongs.length > 0 ? (
          <div className="audience-top-voted-tabs">
            <button
              type="button"
              className={`audience-top-voted-tab${!showTopVoted ? ' is-active' : ''}`}
              onClick={() => setShowTopVoted(false)}
            >
              ♪ Song List
            </button>
            <button
              type="button"
              className={`audience-top-voted-tab${showTopVoted ? ' is-active' : ''}`}
              onClick={() => setShowTopVoted(true)}
            >
              ★ Top Voted
            </button>
          </div>
        ) : null}
      </header>

      <section className="audience-song-list-live-diagnostics" aria-label="Live sync diagnostics" role="status" aria-live="polite">
        <div className="audience-song-list-live-diagnostics-head">
          <span className={`meta-badge audience-song-list-live-diagnostics-pill ${connectionStatusToneClassName}`}>
            Live sync: {connectionStatusLabel}
          </span>
          {queueOperatingMode === 'degraded' ? <span className="meta-badge audience-song-list-live-diagnostics-pill is-degraded">Fallback mode</span> : null}
        </div>
        <p className="subcopy audience-song-list-live-diagnostics-meta">Last healthy sync: {healthySyncAgeText}</p>
        {queueHealthMessage ? <p className="subcopy audience-song-list-live-diagnostics-message">{queueHealthMessage}</p> : null}
      </section>

      {/* ── Top Voted view ── */}
      {showTopVoted ? (
        <div className="audience-top-voted-panel">
          <p className="audience-top-voted-eyebrow">★ Most voted tonight</p>
          {topVotedSongs.length === 0 ? (
            <p className="subcopy">No votes yet — cast yours below!</p>
          ) : (
            <ol className="audience-top-voted-list">
              {topVotedSongs.map((song, index) => (
                <li key={song.id} className="audience-top-voted-item">
                  <span className="audience-top-voted-rank">#{index + 1}</span>
                  <div className="audience-top-voted-info">
                    <span className="audience-top-voted-title">{song.title}</span>
                    <span className="audience-top-voted-artist">{song.artist}</span>
                  </div>
                  <span className="audience-top-voted-votes">+{song.votes_count}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      {!showTopVoted && loadingSongs ? (
        <div className="audience-song-list-logo-loader" role="status" aria-live="polite" aria-label={copy.loadingSongs}>
          <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="72" height="72" />
        </div>
      ) : null}
      {isFinalSongRequestsClosed ? <p className="request-error-inline audience-requests-closed-notice" role="status">{copy.finalSongRequestsClosed}</p> : null}
      {!event?.roomOpen ? <p className="request-error-inline audience-requests-closed-notice" role="status">Requests are paused right now. Browse songs while you wait.</p> : null}
      {errorText ? <p className={`request-error-inline${isLastSongSoonOverlayMessage(errorText) ? ' audience-requests-closed-notice' : ' error-text'}`}>{errorText}</p> : null}

      {/* ── Playlist picker ── */}
      {!showTopVoted && showPlaylistPicker ? (
        <div className="audience-playlist-picker">
          {event?.requestInstructions ? <p className="subcopy audience-song-list-note">{event.requestInstructions}</p> : null}
          <button
            type="button"
            className="audience-playlist-choice audience-playlist-choice-jukebox"
            disabled={isFinalSongRequestsClosed}
            onClick={() => setActiveSetlist('human_jukebox')}
          >
            <img src="/images/Human%20jukebox%20Live%20playlist.png" alt="Human Jukebox playlist cover" className="audience-playlist-choice-cover audience-playlist-choice-cover-jukebox" />
            <div className="audience-playlist-choice-overlay">
              <strong className="audience-playlist-choice-title">Human Jukebox</strong>
              <span className="audience-playlist-choice-sub">{copy.hostPlays}</span>
              <span className="audience-playlist-choice-count">{humanJukeboxRows.length} {copy.songs}</span>
            </div>
          </button>
          <button
            type="button"
            className="audience-playlist-choice audience-playlist-choice-karaoke"
            disabled={isFinalSongRequestsClosed}
            onClick={() => setActiveSetlist('karaoke')}
          >
            <img src="/images/Karaoke%20live%20playlist.png" alt="Karaoke playlist cover" className="audience-playlist-choice-cover" />
            <div className="audience-playlist-choice-overlay">
              <strong className="audience-playlist-choice-title">Karaoke</strong>
              <span className="audience-playlist-choice-sub">{copy.youSing}</span>
              <span className="audience-playlist-choice-count">{karaokeRows.length} {copy.songs}</span>
            </div>
          </button>
        </div>
      ) : null}

      {/* ── Song list ── */}
      {!showTopVoted && !loadingSongs && !showPlaylistPicker ? (
        <>
          <section className="audience-song-list-search">
            <label htmlFor="audience-song-list-search-input">{copy.searchSongs}</label>
            <input
              id="audience-song-list-search-input"
              value={songSearchQuery}
              onChange={(event) => setSongSearchQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
            />
          </section>

          {event?.requestInstructions ? <p className="subcopy audience-song-list-note">{event.requestInstructions}</p> : null}

          <div className="audience-song-list-scroll">
            <p className="curated-picker-results" aria-live="polite">
              {activeRows.length} {copy.songs} {copy.availableSuffix}
            </p>
            <div className="audience-song-list-section">
              <ul
                className="audience-song-list-grid audience-song-list-viewport"
                aria-label={effectiveSetlist === 'karaoke' ? copy.karaokeSongsLabel : copy.jukeboxSongsLabel}
              >
                {activeRows.map((row) => {
                  const isQueued = queuedLibrarySongIds.has(row.song.id)
                  const isSelected = selectedSong?.id === row.song.id
                  const isHighlighted = isQueued || isSelected

                  return (
                    <li
                      key={row.song.id}
                      className={`audience-song-list-item${isHighlighted ? ' is-highlighted' : ''}`}
                    >
                      {row.sectionLabel ? <p className="curated-section-label" aria-hidden="true">{row.sectionLabel}</p> : null}
                      <button
                        type="button"
                        className={`audience-song-list-card${effectiveSetlist === 'karaoke' ? ' audience-song-list-card-karaoke' : ''}${isQueued ? ' is-queued' : ''}${isSelected ? ' is-selected' : ''}`}
                        disabled={isFinalSongRequestsClosed}
                        onClick={() => handleSelectSong(row.song)}
                      >
                        {row.song.cover_url ? (
                          <img
                            src={normalizeCoverUrl(row.song.cover_url) ?? row.song.cover_url}
                            alt={`Cover art for ${row.title}`}
                            className="audience-song-list-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="audience-song-list-cover song-cover-fallback" aria-hidden="true">♪</span>
                        )}
                        <span className="audience-song-list-copy">
                          <span className="audience-song-list-title">{row.title}</span>
                          <span className="audience-song-list-artist">{row.artist}</span>
                          {effectiveSetlist === 'karaoke' ? <span className="karaoke-tag">{copy.iSing}</span> : null}
                          {row.song.is_explicit ? <span className="curated-pick-meta">{copy.explicit}</span> : null}
                        </span>
                        {isHighlighted ? (
                          <span className="audience-song-list-selection-badge" aria-hidden="true">
                            {isQueued ? `✓ ${copy.selected}` : copy.selected}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {!activeRows.length ? (
                <p className="subcopy">
                  {curatedSongs.length ? copy.allMatchingQueued : copy.noSongsAssigned}
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {selectedSong ? (
        <aside
          className="audience-song-choice-overlay"
          aria-label={copy.chooseWhoSings}
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget && !submittingMode) {
              setSelectedSong(null)
              setKaraokeConfirmPending(false)
            }
          }}
        >
          <div className="audience-song-choice-sheet">
            {karaokeConfirmPending ? (
              <>
                {selectedSong.cover_url ? (
                  <img
                    src={normalizeCoverUrl(selectedSong.cover_url) ?? ''}
                    alt={selectedSong.title}
                    className="audience-song-choice-cover"
                  />
                ) : null}
                <p className="audience-song-choice-karaoke-eyebrow">🎤 {copy.karaokeConfirmHeading}</p>
                <p className="audience-song-choice-karaoke-body">{copy.karaokeConfirmBody}</p>
                {loadingSelectedSongFacts ? <p className="subcopy">Loading an interesting song fact...</p> : null}
                {!loadingSelectedSongFacts && currentSongFact ? <p className="subcopy">Interesting fact: {currentSongFact}</p> : null}
                <div className="audience-song-choice-actions karaoke-confirm-actions">
                  <button
                    type="button"
                    className="primary-button audience-song-choice-button"
                    disabled={Boolean(submittingMode) || isFinalSongRequestsClosed || !event?.roomOpen}
                    onClick={() => { void submitSongRequest('audience') }}
                  >
                    {submittingMode === 'audience' ? copy.adding : copy.karaokeConfirmGo}
                  </button>
                  <button
                    type="button"
                    className="tertiary-button audience-song-choice-button"
                    disabled={Boolean(submittingMode)}
                    onClick={() => setKaraokeConfirmPending(false)}
                  >
                    {copy.karaokeConfirmAbort}
                  </button>
                </div>
              </>
            ) : (
              <>
            {selectedSong.cover_url ? (
              <img
                src={normalizeCoverUrl(selectedSong.cover_url) ?? ''}
                alt={selectedSong.title}
                className="audience-song-choice-cover"
              />
            ) : null}
            <p className="eyebrow audience-song-choice-selected-eyebrow">{copy.selected}</p>
            <h2>{normalizeDisplayText(selectedSong.title, copy.untitledSong)}</h2>
            <p className="subcopy">{normalizeDisplayText(selectedSong.artist, copy.unknownArtist)}</p>
            {loadingSelectedSongFacts ? <p className="subcopy">Loading an interesting song fact...</p> : null}
            {!loadingSelectedSongFacts && currentSongFact ? <p className="subcopy">Interesting fact: {currentSongFact}</p> : null}
            <div className="audience-song-choice-actions">
              {selectedSong.fromKaraokeSetlist ? (
                <button
                  type="button"
                  className="secondary-button audience-song-choice-button"
                  disabled={Boolean(submittingMode) || isFinalSongRequestsClosed || !event?.roomOpen}
                  onClick={() => setKaraokeConfirmPending(true)}
                >
                  {copy.addKaraoke}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary-button audience-song-choice-button"
                    disabled={Boolean(submittingMode) || isFinalSongRequestsClosed || !event?.roomOpen}
                    onClick={() => {
                      void submitSongRequest('performer')
                    }}
                  >
                    {submittingMode === 'performer' ? copy.adding : copy.performerSings}
                  </button>
                  <button
                    type="button"
                    className="secondary-button audience-song-choice-button"
                    disabled={Boolean(submittingMode) || isFinalSongRequestsClosed || !event?.roomOpen}
                    onClick={() => {
                      void submitSongRequest('audience')
                    }}
                  >
                    {submittingMode === 'audience' ? copy.adding : copy.iWantToSing}
                  </button>
                </>
              )}
              <button
                type="button"
                className="tertiary-button audience-song-choice-button"
                disabled={Boolean(submittingMode)}
                onClick={() => setSelectedSong(null)}
              >
                {copy.cancel}
              </button>
            </div>
              </>
            )}
          </div>
        </aside>
      ) : null}
    </section>
  )
}

export default AudienceSongListPage

