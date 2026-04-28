import {
  ensureSpotifySecretConfigured,
  exchangeCodeForTokens,
  getRequiredCode,
  setRefreshTokenCookie,
} from './_shared.js'

export default async function handler(req, res) {
  const code = getRequiredCode(req)

  if (!code) {
    res.status(400).json({ error: 'Missing Spotify authorization code.' })
    return
  }

  if (!ensureSpotifySecretConfigured(res)) {
    return
  }

  try {
    const tokenPayload = await exchangeCodeForTokens(code)

    if (typeof tokenPayload.refresh_token === 'string' && tokenPayload.refresh_token.length > 0) {
      setRefreshTokenCookie(res, tokenPayload.refresh_token)
    }

    res.status(200).json({
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
}
