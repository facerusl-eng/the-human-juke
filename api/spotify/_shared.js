const spotifyClientId = process.env.SPOTIFY_CLIENT_ID ?? '510534c3ee9046aba1b67cb526ef8b1c'
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? ''
const spotifyRedirectUriOverride = process.env.SPOTIFY_REDIRECT_URI?.trim() ?? ''
const spotifyRedirectUriDev = process.env.SPOTIFY_REDIRECT_URI_DEV ?? 'http://localhost:5173/callback'
const spotifyRedirectUriProd = process.env.SPOTIFY_REDIRECT_URI_PROD ?? spotifyRedirectUriDev
const spotifyScopes = 'user-read-playback-state user-modify-playback-state streaming'
const REFRESH_COOKIE_NAME = 'human_jukebox_spotify_refresh_token'

function appendSetCookieHeader(res, cookieValue) {
  const existing = res.getHeader('Set-Cookie')

  if (!existing) {
    res.setHeader('Set-Cookie', cookieValue)
    return
  }

  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieValue])
    return
  }

  res.setHeader('Set-Cookie', [String(existing), cookieValue])
}

export function setRefreshTokenCookie(res, refreshToken) {
  if (!refreshToken) {
    return
  }

  const encodedToken = encodeURIComponent(refreshToken)
  const maxAgeSeconds = 60 * 60 * 24 * 30
  const cookieValue = `${REFRESH_COOKIE_NAME}=${encodedToken}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`
  appendSetCookieHeader(res, cookieValue)
}

export function parseCookies(req) {
  const header = req.headers?.cookie

  if (!header) {
    return {}
  }

  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=')
      if (separatorIndex <= 0) {
        return cookies
      }

      const key = part.slice(0, separatorIndex).trim()
      const value = part.slice(separatorIndex + 1).trim()

      if (!key) {
        return cookies
      }

      cookies[key] = decodeURIComponent(value)
      return cookies
    }, {})
}

export function getRefreshTokenFromRequest(req) {
  const cookies = parseCookies(req)
  const cookieToken = cookies[REFRESH_COOKIE_NAME]

  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken
  }

  const envToken = process.env.SPOTIFY_REFRESH_TOKEN ?? ''
  return envToken.trim() || null
}

export function getSpotifyRedirectUri() {
  if (process.env.NODE_ENV !== 'production') {
    return spotifyRedirectUriDev
  }

  if (spotifyRedirectUriOverride) {
    return spotifyRedirectUriOverride
  }

  return spotifyRedirectUriProd
}

export function getAuthorizeUrl() {
  const redirectUri = getSpotifyRedirectUri()
  const params = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: spotifyScopes,
  })

  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

export function ensureSpotifySecretConfigured(res) {
  if (spotifyClientSecret) {
    return true
  }

  res.status(500).json({ error: 'SPOTIFY_CLIENT_SECRET is not configured.' })
  return false
}

export function getRequiredCode(req) {
  const code = typeof req.query?.code === 'string' ? req.query.code : ''

  if (code) {
    return code
  }

  return ''
}

export async function exchangeCodeForTokens(code) {
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

export async function refreshAccessToken(refreshToken) {
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
