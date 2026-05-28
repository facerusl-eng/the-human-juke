import { memo, useEffect, useMemo, useState } from 'react'
import type { AudienceLocale } from '../../lib/audienceIdentity'
import { PrimaryButton } from '../ui'

const AUDIENCE_IMMERSIVE_CLASS = 'audience-immersive-mode'
const AUDIENCE_IMMERSIVE_STORAGE_KEY = 'human-jukebox-audience-immersive-mode'
const AUDIENCE_IMMERSIVE_EVENT = 'human-jukebox:audience-immersive-changed'

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
}

type AudienceFullscreenToggleButtonProps = {
  locale?: AudienceLocale
  className?: string
}

function getActiveFullscreenElement() {
  const fullscreenDocument = document as FullscreenDocument
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null
}

function supportsFullscreenApi() {
  if (typeof document === 'undefined') {
    return false
  }

  const candidate = document.documentElement as FullscreenElement
  const fullscreenDocument = document as FullscreenDocument

  return typeof candidate.requestFullscreen === 'function'
    || typeof candidate.webkitRequestFullscreen === 'function'
    || typeof candidate.webkitRequestFullScreen === 'function'
    || typeof fullscreenDocument.webkitExitFullscreen === 'function'
}

function isImmersiveModeActive() {
  if (typeof document === 'undefined') {
    return false
  }

  return document.body.classList.contains(AUDIENCE_IMMERSIVE_CLASS)
}

function applyImmersiveMode(nextEnabled: boolean) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }

  document.body.classList.toggle(AUDIENCE_IMMERSIVE_CLASS, nextEnabled)

  try {
    window.localStorage.setItem(AUDIENCE_IMMERSIVE_STORAGE_KEY, nextEnabled ? '1' : '0')
  } catch {
    // Ignore storage write failures.
  }

  window.dispatchEvent(new CustomEvent(AUDIENCE_IMMERSIVE_EVENT, { detail: { enabled: nextEnabled } }))
}

async function requestFullscreenSafe(targetElement: HTMLElement) {
  const candidate = targetElement as FullscreenElement

  if (typeof candidate.requestFullscreen === 'function') {
    await candidate.requestFullscreen()
    return
  }

  if (typeof candidate.webkitRequestFullscreen === 'function') {
    await candidate.webkitRequestFullscreen()
    return
  }

  if (typeof candidate.webkitRequestFullScreen === 'function') {
    await candidate.webkitRequestFullScreen()
  }
}

async function exitFullscreenSafe() {
  const fullscreenDocument = document as FullscreenDocument

  if (typeof document.exitFullscreen === 'function') {
    await document.exitFullscreen()
    return
  }

  if (typeof fullscreenDocument.webkitExitFullscreen === 'function') {
    await fullscreenDocument.webkitExitFullscreen()
  }
}

function AudienceFullscreenToggleButton({ locale = 'en', className }: AudienceFullscreenToggleButtonProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isImmersiveMode, setIsImmersiveMode] = useState(false)
  const [showFallbackHint, setShowFallbackHint] = useState(false)

  const copy = useMemo(() => {
    if (locale === 'da') {
      return {
        enter: 'Fuld skærm',
        exit: 'Luk fuld skærm',
        immersiveOn: 'Immersive: Til',
        immersiveOff: 'Immersive: Fra',
        unsupported: 'Fuld skærm kræver Chrome/Safari browser',
      }
    }

    if (locale === 'is') {
      return {
        enter: 'Skjarfylli',
        exit: 'Haetta i skjarfylli',
        immersiveOn: 'Immersive: A',
        immersiveOff: 'Immersive: Af',
        unsupported: 'Skjarfylli krefst Chrome/Safari',
      }
    }

    return {
      enter: 'Fullscreen',
      exit: 'Exit Fullscreen',
      immersiveOn: 'Immersive: On',
      immersiveOff: 'Immersive: Off',
      unsupported: 'Fullscreen needs Chrome/Safari browser',
    }
  }, [locale])

  const fullscreenSupported = useMemo(() => supportsFullscreenApi(), [])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const syncState = () => {
      setIsFullscreen(Boolean(getActiveFullscreenElement()))
    }

    syncState()
    document.addEventListener('fullscreenchange', syncState)
    document.addEventListener('webkitfullscreenchange', syncState)

    return () => {
      document.removeEventListener('fullscreenchange', syncState)
      document.removeEventListener('webkitfullscreenchange', syncState)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncImmersiveState = () => {
      setIsImmersiveMode(isImmersiveModeActive())
    }

    syncImmersiveState()

    const persistedValue = window.localStorage.getItem(AUDIENCE_IMMERSIVE_STORAGE_KEY)
    if (persistedValue === '1' && !isImmersiveModeActive()) {
      applyImmersiveMode(true)
      syncImmersiveState()
    }

    window.addEventListener(AUDIENCE_IMMERSIVE_EVENT, syncImmersiveState as EventListener)

    return () => {
      window.removeEventListener(AUDIENCE_IMMERSIVE_EVENT, syncImmersiveState as EventListener)
    }
  }, [])

  const onToggleFullscreen = async () => {
    if (!fullscreenSupported) {
      const nextImmersiveEnabled = !isImmersiveMode
      applyImmersiveMode(nextImmersiveEnabled)
      setIsImmersiveMode(nextImmersiveEnabled)
      return
    }

    try {
      if (getActiveFullscreenElement()) {
        await exitFullscreenSafe()
      } else {
        await requestFullscreenSafe(document.documentElement)
      }
    } catch {
      const nextImmersiveEnabled = !isImmersiveMode
      applyImmersiveMode(nextImmersiveEnabled)
      setIsImmersiveMode(nextImmersiveEnabled)

      setShowFallbackHint(true)
      window.setTimeout(() => {
        setShowFallbackHint(false)
      }, 2500)
    }
  }

  const buttonLabel = isFullscreen
    ? copy.exit
    : isImmersiveMode
    ? copy.immersiveOn
    : copy.enter

  const buttonIcon = isFullscreen || isImmersiveMode ? '⤢' : '⛶'

  return (
    <>
      <PrimaryButton
        type="button"
        variant="tertiary"
        onClick={() => { void onToggleFullscreen() }}
        className={`audience-fullscreen-toggle ${className ?? ''}`.trim()}
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        {buttonIcon} {buttonLabel}
      </PrimaryButton>
      {showFallbackHint ? <span className="audience-fullscreen-hint">{copy.unsupported}. {copy.immersiveOff} / {copy.immersiveOn} fallback enabled.</span> : null}
    </>
  )
}

export default memo(AudienceFullscreenToggleButton)
