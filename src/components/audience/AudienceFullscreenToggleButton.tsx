import { memo, useEffect, useMemo, useState } from 'react'
import type { AudienceLocale } from '../../lib/audienceIdentity'
import { PrimaryButton } from '../ui'

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
  const [showFallbackHint, setShowFallbackHint] = useState(false)

  const copy = useMemo(() => {
    if (locale === 'da') {
      return {
        enter: 'Fuld skærm',
        exit: 'Luk fuld skærm',
        unsupported: 'Fuld skærm kræver Chrome/Safari browser',
      }
    }

    if (locale === 'is') {
      return {
        enter: 'Skjarfylli',
        exit: 'Haetta i skjarfylli',
        unsupported: 'Skjarfylli krefst Chrome/Safari',
      }
    }

    return {
      enter: 'Fullscreen',
      exit: 'Exit Fullscreen',
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

  const onToggleFullscreen = async () => {
    if (!fullscreenSupported) {
      setShowFallbackHint(true)
      window.setTimeout(() => {
        setShowFallbackHint(false)
      }, 2500)
      return
    }

    try {
      if (getActiveFullscreenElement()) {
        await exitFullscreenSafe()
      } else {
        await requestFullscreenSafe(document.documentElement)
      }
    } catch {
      setShowFallbackHint(true)
      window.setTimeout(() => {
        setShowFallbackHint(false)
      }, 2500)
    }
  }

  return (
    <>
      <PrimaryButton
        type="button"
        variant="tertiary"
        onClick={() => { void onToggleFullscreen() }}
        className={`audience-fullscreen-toggle ${className ?? ''}`.trim()}
        aria-label={isFullscreen ? copy.exit : copy.enter}
        title={isFullscreen ? copy.exit : copy.enter}
      >
        {isFullscreen ? '⤢ ' : '⛶ '} {isFullscreen ? copy.exit : copy.enter}
      </PrimaryButton>
      {showFallbackHint ? <span className="audience-fullscreen-hint">{copy.unsupported}</span> : null}
    </>
  )
}

export default memo(AudienceFullscreenToggleButton)
