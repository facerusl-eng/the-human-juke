const JAMZONE_API_BASE_URLS = (process.env.JAMZONE_API_BASE_URLS?.split(',') ?? [])
  .map((origin) => origin.trim())
  .filter(Boolean)

if (JAMZONE_API_BASE_URLS.length === 0) {
  // Default fallback endpoints; override via JAMZONE_API_BASE_URLS when JamZone API hosts differ.
  JAMZONE_API_BASE_URLS.push('https://api.jamzone.com/v1', 'https://api.jamzone.com')
}

function parseJsonBody(reqBody) {
  if (!reqBody) {
    return null
  }

  if (typeof reqBody === 'string') {
    try {
      return JSON.parse(reqBody)
    } catch {
      return null
    }
  }

  return reqBody
}

function loadTargets(baseUrl, playlistId, songId) {
  const encodedPlaylistId = encodeURIComponent(playlistId)
  const encodedSongId = encodeURIComponent(songId)

  return [
    {
      url: `${baseUrl}/playlists/${encodedPlaylistId}/songs/${encodedSongId}/load`,
      method: 'POST',
      body: null,
    },
    {
      url: `${baseUrl}/playlists/${encodedPlaylistId}/load-song`,
      method: 'POST',
      body: { song_id: songId },
    },
    {
      url: `${baseUrl}/songs/${encodedSongId}`,
      method: 'GET',
      body: null,
    },
  ]
}

function extractDetails(payload, fallback) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const nestedSong = source && typeof source.song === 'object' ? source.song : {}

  const readString = (value) => (typeof value === 'string' && value.trim() ? value : null)

  return {
    title: readString(source.title) ?? readString(nestedSong.title) ?? fallback.title,
    artist: readString(source.artist) ?? readString(nestedSong.artist) ?? fallback.artist,
    key: readString(source.key) ?? readString(source.song_key) ?? readString(nestedSong.key),
    bpm: source.bpm ?? source.tempo ?? nestedSong.bpm ?? nestedSong.tempo ?? null,
    notes: readString(source.notes) ?? readString(source.comment) ?? readString(nestedSong.notes),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseJsonBody(req.body)

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body.' })
    return
  }

  const apiKey = String(body.apiKey ?? '').trim()
  const playlistId = String(body.playlistId ?? '').trim()
  const songId = String(body.songId ?? '').trim()
  const fallbackTitle = String(body.title ?? '').trim()
  const fallbackArtist = String(body.artist ?? '').trim()

  if (!apiKey || !playlistId || !songId) {
    res.status(400).json({ error: 'apiKey, playlistId, and songId are required.' })
    return
  }

  const failures = []

  for (const baseUrl of JAMZONE_API_BASE_URLS) {
    for (const target of loadTargets(baseUrl, playlistId, songId)) {
      try {
        const response = await fetch(target.url, {
          method: target.method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: target.body ? JSON.stringify(target.body) : undefined,
        })

        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          failures.push({ target: target.url, status: response.status })
          continue
        }

        const details = extractDetails(payload, {
          title: fallbackTitle || null,
          artist: fallbackArtist || null,
        })

        res.status(200).json({
          ...details,
          message: 'JamZone details loaded.',
        })
        return
      } catch {
        failures.push({ target: target.url, status: 0 })
      }
    }
  }

  res.status(502).json({
    error: 'Could not load song details from JamZone.',
    attemptedTargets: failures,
  })
}
