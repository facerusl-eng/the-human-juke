import 'dotenv/config'
import express from 'express'

const app = express()
const port = Number(process.env.SPOTIFY_SERVER_PORT ?? 3001)

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID ?? '510534c3ee9046aba1b67cb526ef8b1c'
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? ''
const spotifyRedirectUri = process.env.SPOTIFY_REDIRECT_URI ?? 'http://localhost:5173/callback'
const spotifyScopes = 'user-read-playback-state user-modify-playback-state streaming'

let latestRefreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? null

app.use(express.json())

function getAuthorizeUrl() {
  const params = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri,
    scope: spotifyScopes,
  })

  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: spotifyRedirectUri,
  })

  const authHeader = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64')

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = typeof payload?.error_description === 'string'
      ? payload.error_description
      : 'Token exchange failed.'
    throw new Error(message)
  }

  return payload
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const authHeader = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64')

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = typeof payload?.error_description === 'string'
      ? payload.error_description
      : 'Access token refresh failed.'
    throw new Error(message)
  }

  return payload
}

app.get('/api/spotify/login', (_req, res) => {
  res.redirect(getAuthorizeUrl())
})

app.get('/api/spotify/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''

  if (!code) {
    res.status(400).json({ error: 'Missing Spotify authorization code.' })
    return
  }

  if (!spotifyClientSecret) {
    res.status(500).json({ error: 'SPOTIFY_CLIENT_SECRET is not configured.' })
    return
  }

  try {
    const tokenPayload = await exchangeCodeForTokens(code)

    if (typeof tokenPayload.refresh_token === 'string' && tokenPayload.refresh_token.length > 0) {
      latestRefreshToken = tokenPayload.refresh_token
    }

    res.json({
      access_token: tokenPayload.access_token,
      token_type: tokenPayload.token_type,
      expires_in: tokenPayload.expires_in,
    })
  } catch (error) {
    console.error('Spotify callback error', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Spotify callback failed.',
    })
  }
})

app.get('/api/spotify/token', async (_req, res) => {
  if (!spotifyClientSecret) {
    res.status(500).json({ error: 'SPOTIFY_CLIENT_SECRET is not configured.' })
    return
  }

  if (!latestRefreshToken) {
    res.status(400).json({ error: 'No Spotify refresh token stored yet. Complete login first.' })
    return
  }

  try {
    const tokenPayload = await refreshAccessToken(latestRefreshToken)

    if (typeof tokenPayload.refresh_token === 'string' && tokenPayload.refresh_token.length > 0) {
      latestRefreshToken = tokenPayload.refresh_token
    }

    res.json({
      access_token: tokenPayload.access_token,
      token_type: tokenPayload.token_type,
      expires_in: tokenPayload.expires_in,
    })
  } catch (error) {
    console.error('Spotify refresh error', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Spotify token refresh failed.',
    })
  }
})

app.listen(port, () => {
  console.log(`Spotify API server running on http://localhost:${port}`)
})
