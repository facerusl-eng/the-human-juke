import 'dotenv/config'
import { spawn } from 'node:child_process'
import express from 'express'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.SPOTIFY_SERVER_PORT ?? 3001)
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const mixerPresetScriptPath = fileURLToPath(new URL('../scripts/apply-backing-preset.mjs', import.meta.url))

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID ?? '510534c3ee9046aba1b67cb526ef8b1c'
const spotifySecretKeyNames = ['SPOTIFY_CLIENT_SECRET', 'SPOTIFY_SECRET', 'SPOTIFYCLIENTSECRET']
const spotifyRedirectUriOverride = process.env.SPOTIFY_REDIRECT_URI?.trim() ?? ''
const spotifyRedirectUriDev = process.env.SPOTIFY_REDIRECT_URI_DEV ?? 'http://localhost:5173/callback'
const spotifyRedirectUriProd = process.env.SPOTIFY_REDIRECT_URI_PROD ?? spotifyRedirectUriDev
const spotifyScopes = 'user-read-playback-state user-modify-playback-state streaming'

let latestRefreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? null

app.use(express.json())

async function runMixerRepairScript() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mixerPresetScriptPath], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('Mixer repair timed out.'))
    }, 20000)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)

      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      reject(new Error(combined || `Mixer repair exited with code ${code}.`))
    })
  })
}

function getSpotifyClientSecret() {
  for (const keyName of spotifySecretKeyNames) {
    const candidate = process.env[keyName]

    if (typeof candidate === 'string') {
      const trimmed = candidate.trim()

      if (trimmed) {
        return trimmed
      }
    }
  }

  return ''
}

function getSpotifyRedirectUri() {
  if (process.env.NODE_ENV !== 'production') {
    return spotifyRedirectUriDev
  }

  if (spotifyRedirectUriOverride) {
    return spotifyRedirectUriOverride
  }

  return spotifyRedirectUriProd
}

function getAuthorizeUrl() {
  const redirectUri = getSpotifyRedirectUri()
  const params = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: spotifyScopes,
  })

  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

async function exchangeCodeForTokens(code) {
  const spotifyClientSecret = getSpotifyClientSecret()
  const redirectUri = getSpotifyRedirectUri()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
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
  const spotifyClientSecret = getSpotifyClientSecret()
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
  const spotifyClientSecret = getSpotifyClientSecret()
  const code = typeof req.query.code === 'string' ? req.query.code : ''

  if (!code) {
    res.status(400).json({ error: 'Missing Spotify authorization code.' })
    return
  }

  if (!spotifyClientSecret) {
    res.status(500).json({
      error: `Spotify client secret is missing. Configure one of: ${spotifySecretKeyNames.join(', ')}`,
    })
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
  const spotifyClientSecret = getSpotifyClientSecret()

  if (!spotifyClientSecret) {
    res.status(500).json({
      error: `Spotify client secret is missing. Configure one of: ${spotifySecretKeyNames.join(', ')}`,
    })
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

app.post('/api/mixer/auto-fix', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Mixer auto-fix is only available in the local laptop admin app.' })
    return
  }

  try {
    await runMixerRepairScript()
    res.json({ ok: true, detail: 'Local mixer preset repair ran successfully.' })
  } catch (error) {
    console.error('Mixer auto-fix error', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Mixer auto-fix failed.',
    })
  }
})

app.listen(port, () => {
  console.log(`Spotify API server running on http://localhost:${port}`)
})
