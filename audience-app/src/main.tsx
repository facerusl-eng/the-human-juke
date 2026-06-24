import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './app.css'

const CHUNK_RECOVERY_LAST_ATTEMPT_KEY = 'human-jukebox:audience-chunk-recovery-last-attempt'
const CHUNK_RECOVERY_THROTTLE_MS = 15_000

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      return message
    }
  }

  return ''
}

function isChunkLoadFailure(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()

  return message.includes('failed to fetch dynamically imported module')
    || message.includes('failed to load module script')
    || message.includes('importing a module script failed')
    || message.includes('chunkloaderror')
    || (message.includes('unexpected token') && message.includes('<'))
}

function recoverFromChunkLoadFailure(error: unknown): boolean {
  if (typeof window === 'undefined' || !isChunkLoadFailure(error)) {
    return false
  }

  const now = Date.now()
  const previousAttemptRaw = window.sessionStorage.getItem(CHUNK_RECOVERY_LAST_ATTEMPT_KEY)
  const previousAttempt = Number(previousAttemptRaw ?? '0')

  if (Number.isFinite(previousAttempt) && now - previousAttempt < CHUNK_RECOVERY_THROTTLE_MS) {
    return false
  }

  window.sessionStorage.setItem(CHUNK_RECOVERY_LAST_ATTEMPT_KEY, `${now}`)

  const hardRefreshUrl = new URL(window.location.href)
  hardRefreshUrl.searchParams.set('build-refresh', now.toString(36))
  window.location.replace(hardRefreshUrl.toString())
  return true
}

function setupAudienceRuntimeRecovery() {
  if (typeof window === 'undefined') {
    return
  }

  window.addEventListener('error', (event) => {
    if (recoverFromChunkLoadFailure(event.error)) {
      return
    }

    const target = event.target
    if (!(target instanceof HTMLScriptElement || target instanceof HTMLLinkElement)) {
      return
    }

    const assetUrl = target instanceof HTMLScriptElement ? target.src : target.href
    if (!assetUrl || !assetUrl.includes('/assets/')) {
      return
    }

    void recoverFromChunkLoadFailure('Failed to load module script')
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    void recoverFromChunkLoadFailure(event.reason)
  })
}

setupAudienceRuntimeRecovery()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
