import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

type ItunesSearchResponse = {
  results?: Array<{
    trackName?: string
    artistName?: string
    artworkUrl100?: string
  }>
}

function upscaleArtworkUrl(artworkUrl: string) {
  return artworkUrl.replace(/\/100x100bb\./, '/600x600bb.')
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(live|acoustic|version|remaster(ed)?|feat\.?|ft\.?)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildQueries(title: string, artist: string) {
  const cleanTitle = normalizeSearchText(title)
  const cleanArtist = normalizeSearchText(artist)

  return [...new Set([
    `${artist} ${title}`.trim(),
    `${cleanArtist} ${cleanTitle}`.trim(),
    `${title} ${artist}`.trim(),
    title.trim(),
    cleanTitle,
  ].filter(Boolean))]
}

function scoreResult(payload: { trackName?: string; artistName?: string }, title: string, artist: string) {
  const targetTitle = normalizeSearchText(title)
  const targetArtist = normalizeSearchText(artist)
  const resultTitle = normalizeSearchText(payload.trackName ?? '')
  const resultArtist = normalizeSearchText(payload.artistName ?? '')

  let score = 0

  if (resultTitle && targetTitle && resultTitle === targetTitle) {
    score += 6
  } else if (resultTitle && targetTitle && (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle))) {
    score += 3
  }

  if (resultArtist && targetArtist && resultArtist === targetArtist) {
    score += 5
  } else if (resultArtist && targetArtist && (resultArtist.includes(targetArtist) || targetArtist.includes(resultArtist))) {
    score += 2
  }

  return score
}

const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: jsonHeaders,
    })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ coverUrl: null }), {
      status: 405,
      headers: jsonHeaders,
    })
  }

  const { title, artist } = await request.json().catch(() => ({ title: '', artist: '' })) as {
    title?: string
    artist?: string
  }

  if (!title?.trim() || !artist?.trim()) {
    return new Response(JSON.stringify({ coverUrl: null }), {
      headers: jsonHeaders,
    })
  }

  try {
    const queries = buildQueries(title, artist)
    let bestArtworkUrl: string | null = null
    let bestScore = -1

    for (const query of queries) {
      const encodedQuery = encodeURIComponent(query)
      const response = await fetch(`https://itunes.apple.com/search?term=${encodedQuery}&entity=song&limit=5`, {
        headers: {
          'User-Agent': 'human-jukebox-song-artwork',
        },
      })

      if (!response.ok) {
        continue
      }

      const payload = await response.json() as ItunesSearchResponse
      const candidates = payload.results ?? []

      for (const candidate of candidates) {
        const artworkUrl = candidate.artworkUrl100

        if (!artworkUrl) {
          continue
        }

        const score = scoreResult(candidate, title, artist)

        if (score > bestScore) {
          bestScore = score
          bestArtworkUrl = artworkUrl
        }
      }

      if (bestArtworkUrl && bestScore >= 9) {
        break
      }
    }

    return new Response(JSON.stringify({
      coverUrl: bestArtworkUrl ? upscaleArtworkUrl(bestArtworkUrl) : null,
    }), {
      headers: jsonHeaders,
    })
  } catch {
    return new Response(JSON.stringify({ coverUrl: null }), {
      headers: jsonHeaders,
    })
  }
})