import {
  getRefreshTokenFromRequest,
  refreshAccessToken,
  setRefreshTokenCookie,
} from './_shared.js'

export default async function handler(req, res) {
  const refreshToken = getRefreshTokenFromRequest(req)

  if (!refreshToken) {
    res.status(400).json({ error: 'No Spotify refresh token stored yet. Complete login first.' })
    return
  }

  try {
    const tokenPayload = await refreshAccessToken(refreshToken)

    if (typeof tokenPayload.refresh_token === 'string' && tokenPayload.refresh_token.length > 0) {
      setRefreshTokenCookie(res, tokenPayload.refresh_token, req)
    }

    res.status(200).json({
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
}
