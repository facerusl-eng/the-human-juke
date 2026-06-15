import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGINS = [
  'https://www.the-human-jukebox.org',
  'https://the-human-jukebox.org',
  'https://the-human-juke.vercel.app',
]

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function normalizeQueryValue(value) {
  if (Array.isArray(value)) {
    return String(value[0] ?? '').trim()
  }

  return String(value ?? '').trim()
}

function parseBoolean(value, defaultValue = false) {
  const normalized = normalizeQueryValue(value).toLowerCase()

  if (!normalized) {
    return defaultValue
  }

  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function escapeCsvCell(value) {
  const text = String(value ?? '')

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }

  return text
}

function toCsvRows(songs) {
  const lines = ['song_id,title,artist']

  for (const song of songs) {
    lines.push([
      escapeCsvCell(song.song_id),
      escapeCsvCell(song.title),
      escapeCsvCell(song.artist),
    ].join(','))
  }

  return `${lines.join('\n')}\n`
}

function normalizeSectionType(rawValue) {
  const normalized = String(rawValue ?? '').trim().toLowerCase()

  if (!normalized) {
    return null
  }

  if (normalized.includes('pre-chorus') || normalized.includes('pre chorus')) {
    return 'pre-chorus'
  }

  if (normalized.includes('chorus') || normalized.includes('refrain') || normalized.includes('hook')) {
    return 'chorus'
  }

  if (normalized.includes('verse')) {
    return 'verse'
  }

  if (normalized.includes('bridge')) {
    return 'bridge'
  }

  if (normalized.includes('intro')) {
    return 'intro'
  }

  if (normalized.includes('outro')) {
    return 'outro'
  }

  if (normalized.includes('solo') || normalized.includes('instrumental')) {
    return 'instrumental'
  }

  return null
}

function parseHeadingType(line) {
  const trimmedLine = String(line ?? '').trim()
  if (!trimmedLine) {
    return null
  }

  const bracketHeading = trimmedLine.match(/^\[([^\]]+)\]$/)
  if (bracketHeading) {
    return normalizeSectionType(bracketHeading[1])
  }

  const plainHeading = trimmedLine.match(/^(intro|verse|pre-chorus|pre chorus|chorus|bridge|outro|solo|instrumental|hook|refrain)(?:\s+\d+)?\s*[:\-]?$/i)
  if (plainHeading) {
    return normalizeSectionType(plainHeading[1])
  }

  return null
}

function parseLyricsSections(rawLyrics) {
  const normalized = String(rawLyrics ?? '').replace(/\r\n/g, '\n').trim()

  if (!normalized) {
    return []
  }

  const sections = []
  let currentType = 'verse'
  let buffer = []

  const flushSection = () => {
    const text = buffer.join('\n').trim()
    if (!text) {
      buffer = []
      return
    }

    sections.push({
      type: currentType,
      text,
    })

    buffer = []
  }

  for (const line of normalized.split('\n')) {
    const headingType = parseHeadingType(line)

    if (headingType) {
      flushSection()
      currentType = headingType
      continue
    }

    buffer.push(line)
  }

  flushSection()

  if (sections.length === 0 && normalized) {
    return [{ type: 'verse', text: normalized }]
  }

  return sections
}

function resolveBaseUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim()
  if (!host) {
    return 'https://www.the-human-jukebox.org'
  }

  const forwardedProtoRaw = req.headers['x-forwarded-proto']
  const forwardedProto = Array.isArray(forwardedProtoRaw)
    ? String(forwardedProtoRaw[0] ?? '').trim()
    : String(forwardedProtoRaw ?? '').trim()
  const protocol = forwardedProto || (host.includes('localhost') ? 'http' : 'https')

  return `${protocol}://${host}`
}

async function fetchLyricsFromApi(req, song, locale, includeDebug) {
  const songTitle = String(song.title ?? '').trim()
  if (!songTitle) {
    return ''
  }

  const songArtist = String(song.artist ?? '').trim()
  const baseUrl = resolveBaseUrl(req)
  const url = new URL('/api/lyrics-genius', baseUrl)

  url.searchParams.set('song', songTitle)
  if (songArtist) {
    url.searchParams.set('artist', songArtist)
  }
  url.searchParams.set('locale', locale)

  if (includeDebug) {
    url.searchParams.set('debug', '1')
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    return ''
  }

  const payload = await response.json().catch(() => ({}))
  return typeof payload?.lyrics === 'string' ? payload.lyrics.trim() : ''
}

async function persistLyricsForSong(supabase, song, lyricsText) {
  const finalLyrics = String(lyricsText ?? '').trim()

  if (!finalLyrics) {
    return false
  }

  const { error: saveError } = await supabase
    .from('library_songs')
    .update({ manual_lyrics: finalLyrics })
    .eq('id', song.song_id)

  if (saveError) {
    throw saveError
  }

  const { error: bridgeError } = await supabase
    .from('human_jukebox_lyrics')
    .upsert({
      song_id: song.song_id,
      title: song.title,
      artist: song.artist,
      imported_raw_lyrics: finalLyrics,
      imported_sections: parseLyricsSections(finalLyrics),
    }, { onConflict: 'song_id' })

  if (bridgeError) {
    throw bridgeError
  }

  return true
}

function normalizeLocale(value) {
  const normalized = normalizeQueryValue(value).toLowerCase()

  if (normalized === 'da' || normalized === 'is') {
    return normalized
  }

  return 'en'
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''

  if (req.method === 'OPTIONS') {
    return res.status(204).set(corsHeaders(origin)).end()
  }

  Object.entries(corsHeaders(origin)).forEach(([key, value]) => res.setHeader(key, value))

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const playlistId = normalizeQueryValue(req.query.playlist_id || req.query.setlist_id)
  const format = normalizeQueryValue(req.query.format || 'json').toLowerCase()
  const includeLyrics = parseBoolean(req.query.include_lyrics, true)
  const fetchMissingLyrics = parseBoolean(req.query.fetch_missing_lyrics, true)
  const includeDebug = parseBoolean(req.query.debug, false)
  const locale = normalizeLocale(req.query.locale)

  if (!playlistId) {
    return res.status(400).json({
      error: 'Missing playlist_id (or setlist_id).',
    })
  }

  if (format !== 'json' && format !== 'csv') {
    return res.status(400).json({
      error: 'Invalid format. Use format=json or format=csv.',
    })
  }

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL ?? '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  const publishableKey = String(
    process.env.VITE_SUPABASE_ANON_KEY
      || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
      || '',
  ).trim()
  const supabaseKey = serviceRoleKey || publishableKey

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: 'Supabase configuration missing (VITE_SUPABASE_URL and key).',
    })
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  const writableSupabase = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    : supabase

  const { data, error } = await supabase
    .from('playlist_songs')
    .select('position, library_songs!inner(id, title, artist, manual_lyrics)')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true })

  if (error) {
    return res.status(500).json({
      error: 'Failed to load playlist songs.',
      details: error.message,
    })
  }

  const songs = (data ?? []).flatMap((row) => {
    const librarySong = Array.isArray(row.library_songs)
      ? row.library_songs[0]
      : row.library_songs

    if (!librarySong) {
      return []
    }

    return [{
      song_id: librarySong.id,
      title: String(librarySong.title ?? '').trim(),
      artist: String(librarySong.artist ?? '').trim(),
      manual_lyrics: String(librarySong.manual_lyrics ?? '').trim(),
    }]
  })

  if (format === 'csv') {
    const csvBody = toCsvRows(songs)
    const fileName = `setlist-${playlistId}-songs.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(csvBody)
  }

  const fullSongs = []

  for (const song of songs) {
    let lyricsText = includeLyrics ? song.manual_lyrics : ''

    if (includeLyrics && !lyricsText && fetchMissingLyrics) {
      try {
        lyricsText = await fetchLyricsFromApi(req, song, locale, includeDebug)
        if (lyricsText && serviceRoleKey) {
          await persistLyricsForSong(writableSupabase, song, lyricsText)
        }
      } catch {
        lyricsText = ''
      }
    }

    fullSongs.push({
      song_id: song.song_id,
      title: song.title,
      artist: song.artist,
      sections: includeLyrics ? parseLyricsSections(lyricsText) : [],
    })
  }

  const fileName = `setlist-${playlistId}-lyrics.json`
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  res.setHeader('Cache-Control', 'no-store')

  return res.status(200).json(fullSongs)
}
