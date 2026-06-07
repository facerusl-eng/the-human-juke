import { createHash, randomBytes } from 'node:crypto'

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID ?? '510534c3ee9046aba1b67cb526ef8b1c'
const spotifyRedirectUriOverride = process.env.SPOTIFY_REDIRECT_URI?.trim() ?? ''
const spotifyRedirectUriDev = process.env.SPOTIFY_REDIRECT_URI_DEV?.trim() ?? ''
const spotifyRedirectUriProd = process.env.SPOTIFY_REDIRECT_URI_PROD?.trim() ?? ''
const spotifyScopes = 'user-read-playback-state user-modify-playback-state streaming playlist-read-private playlist-read-collaborative'
const REFRESH_COOKIE_NAME = 'human_jukebox_spotify_refresh_token'
const PKCE_COOKIE_NAME = 'human_jukebox_spotify_code_verifier'

function generateSpotifyPkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  return { verifier, challenge }
}

function isSecureRequest(req) {
  const forwardedProto = req.headers?.['x-forwarded-proto']

  if (typeof forwardedProto === 'string' && forwardedProto.length > 0) {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https'
  }

  if (typeof req.protocol === 'string' && req.protocol.length > 0) {
    return req.protocol.toLowerCase() === 'https'
  }

  return process.env.NODE_ENV === 'production'
}

function serializeSpotifyCookie(name, value, req, options = {}) {
  const cookieParts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax']

  if (typeof options.maxAgeSeconds === 'number') {
    cookieParts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`)
  }

  if (options.httpOnly !== false) {
    cookieParts.push('HttpOnly')
  }

  if (isSecureRequest(req)) {
    cookieParts.push('Secure')
  }

  return cookieParts.join('; ')
}

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

export function setRefreshTokenCookie(res, refreshToken, req) {
  if (!refreshToken) {
    return
  }

  const maxAgeSeconds = 60 * 60 * 24 * 30
  const cookieValue = serializeSpotifyCookie(REFRESH_COOKIE_NAME, refreshToken, req, {
    maxAgeSeconds,
    httpOnly: true,
  })
  appendSetCookieHeader(res, cookieValue)
}

export function setSpotifyPkceVerifierCookie(res, verifier, req) {
  if (!verifier) {
    return
  }

  const cookieValue = serializeSpotifyCookie(PKCE_COOKIE_NAME, verifier, req, {
    maxAgeSeconds: 60 * 10,
    httpOnly: true,
  })

  appendSetCookieHeader(res, cookieValue)
}

export function clearSpotifyPkceVerifierCookie(res, req) {
  const cookieValue = serializeSpotifyCookie(PKCE_COOKIE_NAME, '', req, {
    maxAgeSeconds: 0,
    httpOnly: true,
  })

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

export function getSpotifyPkceVerifierFromRequest(req) {
  const cookies = parseCookies(req)
  const verifier = cookies[PKCE_COOKIE_NAME]

  if (typeof verifier === 'string' && verifier.trim().length > 0) {
    return verifier.trim()
  }

  return ''
}

export function getSpotifyRedirectUri(req) {
  if (process.env.NODE_ENV !== 'production') {
    if (spotifyRedirectUriOverride) {
      return spotifyRedirectUriOverride
    }

    if (spotifyRedirectUriDev) {
      return spotifyRedirectUriDev
    }

    const devPublicOrigin = process.env.VITE_DEV_PUBLIC_ORIGIN?.trim()
    if (devPublicOrigin) {
      return `${devPublicOrigin.replace(/\/$/, '')}/callback`
    }

    const host = req?.headers?.['x-forwarded-host'] ?? req?.headers?.host
    const protocolHeader = req?.headers?.['x-forwarded-proto']
    const protocol = typeof protocolHeader === 'string' && protocolHeader.length > 0 ? protocolHeader.split(',')[0] : 'http'

    if (typeof host === 'string' && host.length > 0) {
      return `${protocol}://${host}/callback`
    }

    return 'http://localhost:5173/callback'
  }

  if (spotifyRedirectUriOverride) {
    return spotifyRedirectUriOverride
  }

  if (spotifyRedirectUriProd) {
    return spotifyRedirectUriProd
  }

  const host = req?.headers?.['x-forwarded-host'] ?? req?.headers?.host
  const protocolHeader = req?.headers?.['x-forwarded-proto']
  const protocol = typeof protocolHeader === 'string' && protocolHeader.length > 0 ? protocolHeader.split(',')[0] : 'https'

  if (typeof host === 'string' && host.length > 0) {
    return `${protocol}://${host}/callback`
  }

  return 'https://the-human-jukebox.org/callback'
}

export function getAuthorizeUrl(req, res) {
  const redirectUri = getSpotifyRedirectUri(req)
  const { verifier, challenge } = generateSpotifyPkcePair()

  if (res) {
    setSpotifyPkceVerifierCookie(res, verifier, req)
  }

  const params = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: spotifyScopes,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

export function getRequiredCode(req) {
  const code = typeof req.query?.code === 'string' ? req.query.code : ''

  if (code) {
    return code
  }

  return ''
}

export async function exchangeCodeForTokens(code, req) {
  const redirectUri = getSpotifyRedirectUri(req)
  const codeVerifier = getSpotifyPkceVerifierFromRequest(req)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: spotifyClientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
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
    client_id: spotifyClientId,
    refresh_token: refreshToken,
  })

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
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
