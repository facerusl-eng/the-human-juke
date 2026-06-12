import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../state/authStore'
import '../styles/lyrics-admin.css'

type SongRow = {
  id: string
  title: string | null
  artist: string | null
  manual_lyrics: string | null
}

type ImportedSection = {
  order: number
  imported_label: string
  type: string
  text: string
}

function toNonEmptyString(value: string | null | undefined) {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : ''
}

function parseHeadingType(label: string) {
  const normalized = label.toLowerCase()

  if (normalized.includes('chorus') || normalized.includes('refrain') || normalized.includes('hook')) {
    return 'Chorus'
  }

  if (normalized.includes('verse')) {
    return 'Verse'
  }

  if (normalized.includes('bridge')) {
    return 'Bridge'
  }

  if (normalized.includes('solo') || normalized.includes('instrumental')) {
    return 'Solo'
  }

  return 'Section'
}

function buildSectionsFromLyrics(rawLyrics: string) {
  const lines = rawLyrics.replace(/\r\n/g, '\n').split('\n')
  const sections: ImportedSection[] = []

  let currentLabel = 'Section 1'
  let currentType = 'Section'
  let currentLines: string[] = []

  const flushSection = () => {
    const text = currentLines.join('\n').trim()
    if (!text) {
      return
    }

    sections.push({
      order: sections.length + 1,
      imported_label: currentLabel,
      type: currentType,
      text,
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const bracketHeading = line.match(/^\[([^\]]+)\]$/)

    if (bracketHeading) {
      flushSection()
      currentLabel = bracketHeading[1].trim() || `Section ${sections.length + 1}`
      currentType = parseHeadingType(currentLabel)
      currentLines = []
      continue
    }

    currentLines.push(rawLine)
  }

  flushSection()
  return sections
}

export default function LyricsAdminPage() {
  const { user } = useAuthStore()
  const [titleQuery, setTitleQuery] = useState('')
  const [artistQuery, setArtistQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<SongRow[]>([])
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null)
  const [lyricsDraft, setLyricsDraft] = useState('')

  const selectedSong = useMemo(
    () => searchResults.find((song) => song.id === selectedSongId) ?? null,
    [searchResults, selectedSongId],
  )

  const runSearch = async () => {
    const normalizedTitle = toNonEmptyString(titleQuery)
    const normalizedArtist = toNonEmptyString(artistQuery)

    if (!normalizedTitle) {
      setStatusMessage('Enter at least a song title to search.')
      return
    }

    setSearchBusy(true)
    setStatusMessage(null)

    try {
      let query = supabase
        .from('library_songs')
        .select('id,title,artist,manual_lyrics')
        .ilike('title', `%${normalizedTitle}%`)
        .order('title', { ascending: true })
        .limit(50)

      if (normalizedArtist) {
        query = query.ilike('artist', `%${normalizedArtist}%`)
      }

      if (user?.id) {
        query = query.eq('host_id', user.id)
      }

      const { data, error } = await query

      if (error) {
        setStatusMessage(error.message)
        setSearchResults([])
        setSelectedSongId(null)
        return
      }

      const rows = Array.isArray(data) ? (data as SongRow[]) : []
      setSearchResults(rows)

      if (rows.length === 0) {
        setSelectedSongId(null)
        setLyricsDraft('')
        setStatusMessage('No songs matched your search.')
        return
      }

      const firstSong = rows[0]
      setSelectedSongId(firstSong.id)
      setLyricsDraft(firstSong.manual_lyrics ?? '')
      setStatusMessage(`Loaded ${rows.length} matching songs.`)
    } catch {
      setStatusMessage('Could not run lyrics search.')
      setSearchResults([])
      setSelectedSongId(null)
    } finally {
      setSearchBusy(false)
    }
  }

  const selectSong = (song: SongRow) => {
    setSelectedSongId(song.id)
    setLyricsDraft(song.manual_lyrics ?? '')
    setStatusMessage(null)
  }

  const saveLyrics = async () => {
    if (!selectedSong) {
      setStatusMessage('Select a song first.')
      return
    }

    const normalizedLyrics = lyricsDraft.trim()
    if (!normalizedLyrics) {
      setStatusMessage('Lyrics cannot be empty.')
      return
    }

    setSaveBusy(true)
    setStatusMessage(null)

    try {
      const { error: saveError } = await supabase
        .from('library_songs')
        .update({ manual_lyrics: normalizedLyrics })
        .eq('id', selectedSong.id)

      if (saveError) {
        setStatusMessage(`Saved failed: ${saveError.message}`)
        return
      }

      setSearchResults((currentRows) => currentRows.map((row) => (
        row.id === selectedSong.id
          ? { ...row, manual_lyrics: normalizedLyrics }
          : row
      )))

      const importedSections = buildSectionsFromLyrics(normalizedLyrics)
      const payload = {
        song_id: selectedSong.id,
        title: selectedSong.title,
        artist: selectedSong.artist,
        imported_raw_lyrics: normalizedLyrics,
        imported_sections: importedSections.length > 0 ? importedSections : null,
      }

      const { error: bridgeError } = await supabase
        .from('human_jukebox_lyrics')
        .upsert(payload, { onConflict: 'song_id' })

      if (bridgeError) {
        setStatusMessage('Lyrics saved to song, but bridge table sync failed.')
        return
      }

      setStatusMessage('Lyrics saved and synced to lyric rule table.')
    } catch {
      setStatusMessage('Could not save lyrics right now.')
    } finally {
      setSaveBusy(false)
    }
  }

  return (
    <section className="queue-panel" aria-label="Lyrics admin">
      <p className="eyebrow">Lyrics</p>
      <h1>Lyrics Manager</h1>
      <p className="subcopy">Search a song, edit sectioned lyrics, and save directly in Human Jukebox.</p>

      <div className="hero-actions lyrics-admin-search-row">
        <input
          type="text"
          value={titleQuery}
          onChange={(event) => setTitleQuery(event.target.value)}
          placeholder="Song title"
          aria-label="Song title"
        />
        <input
          type="text"
          value={artistQuery}
          onChange={(event) => setArtistQuery(event.target.value)}
          placeholder="Artist"
          aria-label="Artist"
        />
        <button type="button" className="primary-button" onClick={() => { void runSearch() }} disabled={searchBusy}>
          {searchBusy ? 'Searching...' : 'Search'}
        </button>
      </div>

      {searchResults.length > 0 ? (
        <div className="queue-panel lyrics-admin-results">
          <p className="subcopy">Matches</p>
          <div className="hero-actions">
            {searchResults.map((song) => (
              <button
                type="button"
                key={song.id}
                className={song.id === selectedSongId ? 'primary-button' : 'secondary-button'}
                onClick={() => selectSong(song)}
              >
                {(song.title ?? 'Untitled').trim()} - {(song.artist ?? 'Unknown artist').trim()}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selectedSong ? (
        <>
          <p className="subcopy">
            Editing: {(selectedSong.title ?? 'Untitled').trim()} - {(selectedSong.artist ?? 'Unknown artist').trim()}
          </p>
          <textarea
            className="lyrics-manual-entry-input"
            value={lyricsDraft}
            onChange={(event) => setLyricsDraft(event.target.value)}
            rows={16}
            placeholder="Use sections like [Verse 1], [Chorus], [Bridge]"
            aria-label="Lyrics editor"
          />
          <div className="hero-actions lyrics-admin-save-row">
            <button type="button" className="primary-button" onClick={() => { void saveLyrics() }} disabled={saveBusy}>
              {saveBusy ? 'Saving...' : 'Save Lyrics'}
            </button>
          </div>
        </>
      ) : null}

      {statusMessage ? <p className="subcopy lyrics-admin-status">{statusMessage}</p> : null}
    </section>
  )
}