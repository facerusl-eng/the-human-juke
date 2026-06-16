import { useEffect, useMemo, useState } from 'react'
import { prefetchAndCacheLyrics } from '../../lib/lyricsPrefetch'
import { supabase } from '../../lib/supabase'
import { Card, PrimaryButton, SectionHeader } from '../ui'
import CustomSongForm from './CustomSongForm'
import CustomSongList, { type CustomSong } from './CustomSongList'
import PlaylistSongSelector, { type PlaylistSong } from './PlaylistSongSelector'

type AddSongOptions = {
  coverUrl?: string | null
  librarySongId?: string | null
  performerMode?: 'performer' | 'audience'
  bypassEventRules?: boolean
  requesterName?: string | null
}

type AddSongTabsProps = {
  eventId: string
  userId: string | null
  queuedLibrarySongIds: Set<string>
  unavailableLibrarySongIds: Set<string>
  addSong: (title: string, artist: string, isExplicit: boolean, options?: AddSongOptions) => Promise<void>
}

type ToastState = {
  tone: 'success' | 'error'
  message: string
} | null

function AddSongTabs({ eventId, userId, queuedLibrarySongIds, unavailableLibrarySongIds, addSong }: AddSongTabsProps) {
  const [activeTab, setActiveTab] = useState<'human_jukebox' | 'karaoke' | 'setlist_by_name' | 'custom'>('human_jukebox')
  const [customSongs, setCustomSongs] = useState<CustomSong[]>([])
  const [loadingCustomSongs, setLoadingCustomSongs] = useState(false)
  const [customSongsError, setCustomSongsError] = useState<string | null>(null)
  const [addingSongId, setAddingSongId] = useState<string | null>(null)
  const [addingRandomCount, setAddingRandomCount] = useState<number | null>(null)
  const [toastState, setToastState] = useState<ToastState>(null)
  const [hostRequesterName, setHostRequesterName] = useState('')

  const canUseCustomSongs = useMemo(() => Boolean(userId), [userId])

  useEffect(() => {
    if (!userId) {
      setCustomSongs([])
      setCustomSongsError('Sign in as host to save custom songs.')
      return
    }

    let isCurrent = true

    const loadCustomSongs = async () => {
      setLoadingCustomSongs(true)
      setCustomSongsError(null)

      try {
        const { data, error } = await supabase
          .from('custom_songs')
          .select('id, title, artist, cover_url, created_at')
          .eq('created_by', userId)
          .order('created_at', { ascending: false })

        if (error) {
          throw error
        }

        if (isCurrent) {
          const mappedSongs = ((data ?? []) as Array<Record<string, unknown>>).map((songRow) => ({
            id: String(songRow.id ?? ''),
            title: (songRow.title as string | null) ?? 'Untitled Song',
            artist: (songRow.artist as string | null) ?? null,
            cover_url: (songRow.cover_url as string | null) ?? null,
            created_at: (songRow.created_at as string | null) ?? new Date().toISOString(),
          }))

          setCustomSongs(mappedSongs)
        }
      } catch (error) {
        console.warn('AddSongTabs: failed to load custom songs', error)

        if (isCurrent) {
          setCustomSongs([])
          setCustomSongsError(error instanceof Error ? error.message : 'Could not load custom songs.')
        }
      } finally {
        if (isCurrent) {
          setLoadingCustomSongs(false)
        }
      }
    }

    void loadCustomSongs()

    return () => {
      isCurrent = false
    }
  }, [userId])

  useEffect(() => {
    if (!toastState) {
      return
    }

    const timerId = window.setTimeout(() => {
      setToastState(null)
    }, 2500)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [toastState])

  const showToast = (message: string, tone: 'success' | 'error') => {
    setToastState({ message, tone })
  }

  const normalizedRequesterName = hostRequesterName.trim()
  const requesterNameOption = normalizedRequesterName.length > 0 ? normalizedRequesterName : null
  const resolvePerformerMode = (song: PlaylistSong) => (
    song.playlist_type === 'karaoke' || song.playlist_type === 'setlist_by_name'
      ? 'audience'
      : 'performer'
  )

  const addPlaylistSongToQueue = async (song: PlaylistSong, options?: { requesterNameOverride?: string | null }) => {
    if (addingSongId) {
      return
    }

    setAddingSongId(song.id)

    const requesterNameOverride = options?.requesterNameOverride?.trim() ?? ''
    const requesterName = requesterNameOverride || requesterNameOption

    try {
      await addSong(song.title, song.artist, song.is_explicit, {
        librarySongId: song.id,
        coverUrl: song.cover_url,
        performerMode: resolvePerformerMode(song),
        bypassEventRules: true,
        requesterName,
      })
      prefetchAndCacheLyrics(song.title, song.artist)
      showToast(`${song.title} added to queue.`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add playlist song to queue.', 'error')
    } finally {
      setAddingSongId(null)
    }
  }

  const addCustomSongToQueue = async (song: CustomSong) => {
    if (addingSongId) {
      return
    }

    setAddingSongId(song.id)

    try {
      await addSong(song.title, song.artist?.trim() || 'Unknown Artist', false, {
        coverUrl: song.cover_url,
        performerMode: 'performer',
        bypassEventRules: true,
        requesterName: requesterNameOption,
      })
      prefetchAndCacheLyrics(song.title, song.artist?.trim() || 'Unknown Artist')
      showToast(`${song.title} added to queue.`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add custom song to queue.', 'error')
    } finally {
      setAddingSongId(null)
    }
  }

  const addRandomPlaylistSongsToQueue = async (candidateSongs: PlaylistSong[], requestedCount: number) => {
    if (addingSongId || addingRandomCount) {
      return
    }

    const preferredPool = candidateSongs.filter((song) => (
      song.playlist_type === 'setlist_by_name'
        ? !queuedLibrarySongIds.has(song.id)
        : !unavailableLibrarySongIds.has(song.id)
    ))
    const sourcePool = preferredPool.length > 0 ? preferredPool : candidateSongs

    if (sourcePool.length === 0) {
      showToast('No songs available to add.', 'error')
      return
    }

    const randomizedSongs = [...sourcePool]

    for (let index = randomizedSongs.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1))
      const currentSong = randomizedSongs[index]
      randomizedSongs[index] = randomizedSongs[randomIndex]
      randomizedSongs[randomIndex] = currentSong
    }

    const songsToAdd = randomizedSongs.slice(0, Math.min(requestedCount, randomizedSongs.length))

    setAddingRandomCount(requestedCount)

    let addedCount = 0
    let firstErrorMessage: string | null = null

    for (const song of songsToAdd) {
      try {
        await addSong(song.title, song.artist, song.is_explicit, {
          librarySongId: song.id,
          coverUrl: song.cover_url,
          performerMode: resolvePerformerMode(song),
          bypassEventRules: true,
          requesterName: requesterNameOption,
        })
        prefetchAndCacheLyrics(song.title, song.artist)
        addedCount += 1
      } catch (error) {
        if (!firstErrorMessage) {
          firstErrorMessage = error instanceof Error ? error.message : 'Could not add some random songs to queue.'
        }
      }
    }

    if (addedCount > 0) {
      const trimmedNote = songsToAdd.length < requestedCount ? ` (only ${songsToAdd.length} available)` : ''
      showToast(`${addedCount} random song${addedCount === 1 ? '' : 's'} added to queue${trimmedNote}.`, 'success')
    }

    if (addedCount === 0) {
      showToast(firstErrorMessage ?? 'Could not add random songs to queue.', 'error')
    } else if (firstErrorMessage) {
      showToast(`Added ${addedCount} songs, but some could not be added.`, 'error')
    }

    setAddingRandomCount(null)
  }

  const pushSavedSong = (song: CustomSong) => {
    setCustomSongs((currentSongs) => [song, ...currentSongs])
  }

  return (
    <Card className="gig-add-song-tabs" aria-label="Add song options">
      <SectionHeader
        eyebrow="Queue control"
        title="Add Songs"
        subtitle="Choose from Human Jukebox, Karaoke, Setlist by Name, or save custom songs for quick reuse."
      />
      <label className="gig-add-song-requester-field" htmlFor="gig-control-picked-by">
        <span className="gig-add-song-requester-label">Picked by name (optional)</span>
        <input
          id="gig-control-picked-by"
          type="text"
          maxLength={40}
          value={hostRequesterName}
          onChange={(event) => setHostRequesterName(event.target.value)}
          placeholder="Host, table, or guest name"
          className="gig-add-song-requester-input"
        />
      </label>
      <div className="gig-add-song-tab-switcher" aria-label="Song source tabs">
        <PrimaryButton
          variant="secondary"
          className={`secondary-button gig-add-song-tab-button${activeTab === 'human_jukebox' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('human_jukebox')}
        >
          Human Jukebox
        </PrimaryButton>
        <PrimaryButton
          variant="secondary"
          className={`secondary-button gig-add-song-tab-button${activeTab === 'karaoke' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('karaoke')}
        >
          Karaoke
        </PrimaryButton>
        <PrimaryButton
          variant="secondary"
          className={`secondary-button gig-add-song-tab-button${activeTab === 'custom' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('custom')}
        >
          Custom Song
        </PrimaryButton>
        <PrimaryButton
          variant="secondary"
          className={`secondary-button gig-add-song-tab-button${activeTab === 'setlist_by_name' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('setlist_by_name')}
        >
          Setlist by Name
        </PrimaryButton>
      </div>

      {toastState ? (
        <p className={toastState.tone === 'error' ? 'error-text' : 'meta-badge'} role="status" aria-live="polite">
          {toastState.message}
        </p>
      ) : null}

      {activeTab === 'human_jukebox' ? (
        <PlaylistSongSelector
          eventId={eventId}
          userId={userId}
          playlistTypeFilter="human_jukebox"
          queuedLibrarySongIds={queuedLibrarySongIds}
          unavailableLibrarySongIds={unavailableLibrarySongIds}
          addingSongId={addingSongId}
          addingRandomCount={addingRandomCount}
          onAddSong={addPlaylistSongToQueue}
          onAddRandomSongs={addRandomPlaylistSongsToQueue}
        />
      ) : activeTab === 'karaoke' ? (
        <PlaylistSongSelector
          eventId={eventId}
          userId={userId}
          playlistTypeFilter="karaoke"
          queuedLibrarySongIds={queuedLibrarySongIds}
          unavailableLibrarySongIds={unavailableLibrarySongIds}
          addingSongId={addingSongId}
          addingRandomCount={addingRandomCount}
          onAddSong={addPlaylistSongToQueue}
          onAddRandomSongs={addRandomPlaylistSongsToQueue}
        />
      ) : activeTab === 'setlist_by_name' ? (
        <PlaylistSongSelector
          eventId={eventId}
          userId={userId}
          playlistTypeFilter="setlist_by_name"
          queuedLibrarySongIds={queuedLibrarySongIds}
          unavailableLibrarySongIds={unavailableLibrarySongIds}
          addingSongId={addingSongId}
          addingRandomCount={addingRandomCount}
          onAddSong={addPlaylistSongToQueue}
          onAddRandomSongs={addRandomPlaylistSongsToQueue}
        />
      ) : (
        <section className="gig-add-song-tab-content" aria-label="Custom song">
          {!canUseCustomSongs || !userId ? (
            <p className="error-text">Sign in as host to save and reuse custom songs.</p>
          ) : (
            <>
              <CustomSongForm
                userId={userId}
                onSavedSong={pushSavedSong}
                onStatus={showToast}
              />
              {loadingCustomSongs ? <p className="meta-badge" role="status" aria-live="polite">Loading custom songs...</p> : null}
              {customSongsError ? <p className="error-text">{customSongsError}</p> : null}
              {!loadingCustomSongs ? (
                <CustomSongList songs={customSongs} addingSongId={addingSongId} onAddSong={addCustomSongToQueue} />
              ) : null}
            </>
          )}
        </section>
      )}
    </Card>
  )
}

export default AddSongTabs
