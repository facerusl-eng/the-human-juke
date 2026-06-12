import { useCallback, useMemo, useRef, useState } from 'react'
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

type CsvImportRow = {
  title: string
  artist: string
  lyrics: string
}

type CsvImportResult = {
  title: string
  artist: string
  status: 'ok' | 'skipped' | 'error'
  message: string
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let insideQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        insideQuotes = !insideQuotes
      }
    } else if (char === ',' && !insideQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

function parseCsvText(text: string): CsvImportRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const rows: CsvImportRow[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      continue
    }

    const fields = parseCsvLine(line)
    if (i === 0) {
      const header = fields.map((f) => f.trim().toLowerCase())
      if (header.includes('title') || header.includes('song')) {
        continue
      }
    }

    const title = (fields[0] ?? '').trim()
    const artist = (fields[1] ?? '').trim()
    const lyrics = (fields[2] ?? '').trim()

    if (title) {
      rows.push({ title, artist, lyrics })
    }
  }

  return rows
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
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResults, setCsvResults] = useState<CsvImportResult[]>([])
  const csvInputRef = useRef<HTMLInputElement>(null)

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

  const saveSingleLyricsRow = useCallback(async (row: CsvImportRow): Promise<CsvImportResult> => {
    const { title, artist } = row
    let { lyrics } = row
    let autoFetched = false

    if (!lyrics) {
      try {
        const params = new URLSearchParams({ song: title })
        if (artist) {
          params.set('artist', artist)
        }
        const response = await fetch(`/api/lyrics-genius?${params.toString()}`, { cache: 'no-store' })
        if (response.ok) {
          const data = await response.json() as { lyrics?: string }
          const fetched = (data.lyrics ?? '').trim()
          if (fetched) {
            lyrics = fetched
            autoFetched = true
          }
        }
      } catch {
        // fall through to skip
      }

      if (!lyrics) {
        return { title, artist, status: 'skipped', message: 'No lyrics in CSV and auto-fetch found nothing' }
      }
    }

    try {
      let findQuery = supabase
        .from('library_songs')
        .select('id,title,artist')
        .ilike('title', `%${title}%`)
        .limit(1)

      if (artist) {
        findQuery = findQuery.ilike('artist', `%${artist}%`)
      }

      if (user?.id) {
        findQuery = findQuery.eq('host_id', user.id)
      }

      const { data: foundRows, error: findError } = await findQuery

      if (findError || !foundRows?.length) {
        return { title, artist, status: 'error', message: 'Song not found in library' }
      }

      const songId = foundRows[0].id as string

      const { error: saveError } = await supabase
        .from('library_songs')
        .update({ manual_lyrics: lyrics })
        .eq('id', songId)

      if (saveError) {
        return { title, artist, status: 'error', message: saveError.message }
      }

      const importedSections = buildSectionsFromLyrics(lyrics)
      const { error: bridgeError } = await supabase
        .from('human_jukebox_lyrics')
        .upsert({
          song_id: songId,
          title: foundRows[0].title,
          artist: foundRows[0].artist,
          imported_raw_lyrics: lyrics,
          imported_sections: importedSections.length > 0 ? importedSections : null,
        }, { onConflict: 'song_id' })

      if (bridgeError) {
        return { title, artist, status: 'ok', message: 'Saved to song but bridge sync failed' }
      }

      return { title, artist, status: 'ok', message: autoFetched ? 'Auto-fetched, saved and synced' : 'Saved and synced' }
    } catch {
      return { title, artist, status: 'error', message: 'Unexpected error' }
    }
  }, [user])

  const handleCsvFile = useCallback(async (file: File) => {
    setCsvResults([])
    setCsvImporting(true)
    setStatusMessage(null)

    try {
      const text = await file.text()
      const rows = parseCsvText(text)

      if (rows.length === 0) {
        setStatusMessage('CSV file had no valid rows. Expected columns: title, artist, lyrics')
        return
      }

      const results: CsvImportResult[] = []
      for (const row of rows) {
        const result = await saveSingleLyricsRow(row)
        results.push(result)
        setCsvResults([...results])
      }

      const okCount = results.filter((r) => r.status === 'ok').length
      const errorCount = results.filter((r) => r.status === 'error').length
      setStatusMessage(`CSV import done: ${okCount} saved, ${errorCount} failed, ${results.length - okCount - errorCount} skipped.`)
    } catch {
      setStatusMessage('Could not read CSV file.')
    } finally {
      setCsvImporting(false)
      if (csvInputRef.current) {
        csvInputRef.current.value = ''
      }
    }
  }, [saveSingleLyricsRow])

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

      <div className="queue-panel lyrics-admin-csv-section">
        <h2 className="lyrics-admin-csv-heading">Import from CSV</h2>
        <p className="subcopy">CSV format: <code>title,artist,lyrics</code> — lyrics column supports section headings like <code>[Verse 1]</code>, <code>[Chorus]</code>.</p>
        <div className="hero-actions lyrics-admin-search-row">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose CSV file"
            className="lyrics-admin-csv-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void handleCsvFile(file)
              }
            }}
            disabled={csvImporting}
          />
          {csvImporting ? <span className="subcopy">Importing…</span> : null}
        </div>
        {csvResults.length > 0 ? (
          <ul className="lyrics-admin-csv-results">
            {csvResults.map((result, index) => (
              <li key={index} className={`lyrics-admin-csv-row lyrics-admin-csv-row--${result.status}`}>
                <span className="lyrics-admin-csv-song">{result.title}{result.artist ? ` - ${result.artist}` : ''}</span>
                <span className="lyrics-admin-csv-msg">{result.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

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
