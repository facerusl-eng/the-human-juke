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
const resendApiUrl = 'https://api.resend.com/emails'
const resendApiRoot = 'https://api.resend.com'
const defaultBookingWebhookUrl = process.env.BOOKING_WEBHOOK_URL?.trim() || 'https://book-jukebox.base44.app/api/functions/receiveExternalBooking'
const fallbackBookingWebhookUrls = [
  'https://preview--book-jukebox.base44.app/api/functions/receiveExternalBooking',
  'https://preview--book-jukebox.base44.app/api/webhook/receiveExternalBooking',
  'https://book-jukebox.base44.app/api/webhook/receiveExternalBooking',
]

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
      resolve({ code, stdout, stderr })
    })
  })
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
