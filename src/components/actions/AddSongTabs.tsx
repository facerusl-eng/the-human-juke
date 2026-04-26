import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import CustomSongForm from './CustomSongForm'
import CustomSongList, { type CustomSong } from './CustomSongList'
import PlaylistSongSelector, { type PlaylistSong } from './PlaylistSongSelector'

type AddSongOptions = {
  coverUrl?: string | null
  librarySongId?: string | null
  performerMode?: 'performer' | 'audience'
  bypassEventRules?: boolean
}

type AddSongTabsProps = {
  eventId: string
  userId: string | null
  queuedLibrarySongIds: Set<string>
  addSong: (title: string, artist: string, isExplicit: boolean, options?: AddSongOptions) => Promise<void>
}

type ToastState = {
  tone: 'success' | 'error'
  message: string
} | null

function AddSongTabs({ eventId, userId, queuedLibrarySongIds, addSong }: AddSongTabsProps) {
  const [activeTab, setActiveTab] = useState<'playlist' | 'custom'>('playlist')
  const [customSongs, setCustomSongs] = useState<CustomSong[]>([])
  const [loadingCustomSongs, setLoadingCustomSongs] = useState(false)
  const [customSongsError, setCustomSongsError] = useState<string | null>(null)
  const [addingSongId, setAddingSongId] = useState<string | null>(null)
  const [toastState, setToastState] = useState<ToastState>(null)

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

  const addPlaylistSongToQueue = async (song: PlaylistSong) => {
    if (addingSongId) {
      return
    }

    setAddingSongId(song.id)

    try {
      await addSong(song.title, song.artist, song.is_explicit, {
        librarySongId: song.id,
        coverUrl: song.cover_url,
        performerMode: 'performer',
        bypassEventRules: true,
      })
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
      })
      showToast(`${song.title} added to queue.`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add custom song to queue.', 'error')
    } finally {
      setAddingSongId(null)
    }
  }

  const pushSavedSong = (song: CustomSong) => {
    setCustomSongs((currentSongs) => [song, ...currentSongs])
  }

  return (
    <section className="gig-add-song-tabs" aria-label="Add song options">
      <div className="gig-add-song-tab-switcher" aria-label="Song source tabs">
        <button
          type="button"
          className={`secondary-button gig-add-song-tab-button${activeTab === 'playlist' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('playlist')}
        >
          Playlist Songs
        </button>
        <button
          type="button"
          className={`secondary-button gig-add-song-tab-button${activeTab === 'custom' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('custom')}
        >
          Custom Song
        </button>
      </div>

      {toastState ? (
        <p className={toastState.tone === 'error' ? 'error-text' : 'meta-badge'} role="status" aria-live="polite">
          {toastState.message}
        </p>
      ) : null}

      {activeTab === 'playlist' ? (
        <PlaylistSongSelector
          eventId={eventId}
          queuedLibrarySongIds={queuedLibrarySongIds}
          addingSongId={addingSongId}
          onAddSong={addPlaylistSongToQueue}
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
    </section>
  )
}

export default AddSongTabs
