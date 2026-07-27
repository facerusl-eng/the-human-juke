import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { SupabaseClient } from '@supabase/supabase-js'
import AudienceLyricView from './AudienceLyricView'
import { useSharedLyricState } from './state'
import type { LyricSongRef } from './types'
import './dark-neon-karaoke.css'

const PEDAL_ACTION_DEBOUNCE_MS = 180
const PEDAL_SAME_ACTION_COALESCE_MS = 520

type LyricPedalAction = 'next' | 'previous'

type BluetoothRequestDevice = (options: {
  acceptAllDevices?: boolean
  optionalServices?: string[]
}) => Promise<{
  name?: string
  gatt?: {
    connected?: boolean
    connect?: () => Promise<unknown>
  }
}>

function resolveLyricActionFromKey(keyEvent: KeyboardEvent): LyricPedalAction | null {
  if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) {
    return null
  }

  const key = keyEvent.key
  const code = keyEvent.code

  if (code === 'Space') {
    return keyEvent.shiftKey ? 'previous' : 'next'
  }

  if (
    key === 'Enter' ||
    code === 'NumpadEnter' ||
    key === 'ArrowRight' ||
    key === 'ArrowDown' ||
    key === 'PageDown' ||
    key === 'MediaTrackNext'
  ) {
    return 'next'
  }

  if (
    key === 'ArrowLeft' ||
    key === 'ArrowUp' ||
    key === 'PageUp' ||
    key === 'MediaTrackPrevious'
  ) {
    return 'previous'
  }

  return null
}

function normalizeSectionLineBreaks(rawLyrics: string) {
  return rawLyrics
    .replace(/\r\n/g, '\n')
    .replace(/\]\s*\[/g, ']\n\n[')
    .replace(/(\[[^\]]+\])\s+(?=[^\n\[])/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function sanitizeInternalPath(value: string | null | undefined) {
  const trimmed = (value ?? '').trim()
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null
  }

  return trimmed
}

function buildAudienceDefaultReturnPath(search: string) {
  const params = new URLSearchParams(search)
  const audienceParams = new URLSearchParams()

  const eventId = (params.get('event') ?? params.get('eventId') ?? '').trim()
  if (eventId) {
    audienceParams.set('event', eventId)
  }

  const locale = (params.get('locale') ?? '').trim().toLowerCase()
  if (locale === 'en' || locale === 'da' || locale === 'is') {
    audienceParams.set('locale', locale)
  }

  const query = audienceParams.toString()
  return query ? `/audience?${query}` : '/audience'
}

type LyricDisplayProps = {
  supabase: SupabaseClient
  activeSong: LyricSongRef | null
  returnToPath: string
  autoOpenOnMount?: boolean
}

export default function LyricDisplay({
  supabase,
  activeSong,
  returnToPath,
  autoOpenOnMount = false,
}: LyricDisplayProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const lastAutoOpenedSongKeyRef = useRef<string | null>(null)
  const [pedalStatus, setPedalStatus] = useState('Pedal: keyboard fallback ready')
  const [isPairingPedal, setIsPairingPedal] = useState(false)
  const [isEditingLyric, setIsEditingLyric] = useState(false)
  const [draftLyricText, setDraftLyricText] = useState('')
  const lastPedalActionAtRef = useRef(0)
  const lastPedalActionTypeRef = useRef<LyricPedalAction | null>(null)
  const {
    state,
    setActiveView,
    openLyricForSong,
    closeLyric,
    setBlocks,
    setShowOnMirror,
    nextBlock,
    previousBlock,
  } = useSharedLyricState(supabase, 'control')

  const adminControlsVisible = useMemo(() => {
    const isAdminReturnPath = /\/admin\b/i.test(returnToPath)

    if (typeof window === 'undefined') {
      return isAdminReturnPath
    }

    const isAdminRoute = /\/admin\b/i.test(window.location.pathname)
    const isAdminContext = isAdminRoute || isAdminReturnPath

    if (!isAdminContext) {
      return false
    }

    const searchParams = new URLSearchParams(window.location.search)
    const stageModeParam = searchParams.get('stage')

    // Explicit stage=0 should force the audience-friendly full lyric view,
    // even when the return path points back to Gig Control.
    if (stageModeParam === '0') {
      return false
    }

    // Gig Control can still keep controls visible in admin context.
    if (isAdminReturnPath) {
      return true
    }

    const isStageMode = stageModeParam === '1'
    return !isStageMode
  }, [returnToPath])

  const currentBlock = useMemo(() => {
    if (!state.blocks.length) {
      return 'No lyric loaded.'
    }

    return state.blocks[state.currentBlockIndex] ?? state.blocks[0]
  }, [state.blocks, state.currentBlockIndex])

  const isIntroScreen = state.currentBlockIndex < 0
  const introSongLabel = state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'
  const introRequesterLabel = state.song?.audience_sings && state.song.createdByName?.trim()
    ? `Requested by ${state.song.createdByName.trim()}`
    : null

  const audienceDefaultReturnPath = useMemo(
    () => buildAudienceDefaultReturnPath(location.search),
    [location.search],
  )

  const audienceReturnPath = useMemo(() => {
    const configuredReturnPath = sanitizeInternalPath(returnToPath)
    const stateReturnPath = sanitizeInternalPath(state.returnToPath)

    const audiencePathPattern = /^\/audience\b|^\/event\b|^\/events\b/i

    if (configuredReturnPath && audiencePathPattern.test(configuredReturnPath)) {
      return configuredReturnPath
    }

    if (stateReturnPath && audiencePathPattern.test(stateReturnPath)) {
      return stateReturnPath
    }

    return audienceDefaultReturnPath
  }, [audienceDefaultReturnPath, returnToPath, state.returnToPath])

  const goBack = useCallback(() => {
    closeLyric()
    const targetPath = sanitizeInternalPath(state.returnToPath)
      ?? sanitizeInternalPath(returnToPath)
      ?? audienceDefaultReturnPath
    navigate(targetPath, { replace: false })
  }, [audienceDefaultReturnPath, closeLyric, navigate, returnToPath, state.returnToPath])

  const goBackToAudience = useCallback(() => {
    closeLyric()
    navigate(audienceReturnPath, { replace: false })
  }, [audienceReturnPath, closeLyric, navigate])

  useEffect(() => {
    if (!autoOpenOnMount || !activeSong) {
      return
    }

    // If lyric state is already live (typically driven by now-playing from Gig Control),
    // do not override it only when it already matches the active song.
    const stateMatchesActiveSong = Boolean(
      state.song
      && state.blocks.length > 0
      && state.song.id === activeSong.id
      && state.song.title.trim().toLowerCase() === activeSong.title.trim().toLowerCase()
      && state.song.artist.trim().toLowerCase() === activeSong.artist.trim().toLowerCase(),
    )

    if (stateMatchesActiveSong) {
      return
    }

    const songKey = `${activeSong.id}::${activeSong.artist.toLowerCase()}::${activeSong.title.toLowerCase()}`
    if (lastAutoOpenedSongKeyRef.current === songKey) {
      return
    }

    lastAutoOpenedSongKeyRef.current = songKey
    void openLyricForSong(activeSong, returnToPath)
  }, [activeSong, autoOpenOnMount, openLyricForSong, returnToPath, state.blocks.length, state.song])

  useEffect(() => {
    if (state.activeView !== 'lyric') {
      return
    }

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (state.activeView !== 'lyric') {
        return
      }

      const target = keyEvent.target as HTMLElement | null
      const textEntryTarget = target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
      if (textEntryTarget) {
        return
      }

      if (adminControlsVisible) {
        const backKey = keyEvent.key === 'ArrowLeft'
          || keyEvent.key === 'PageUp'
          || keyEvent.key === 'MediaTrackPrevious'

        if (backKey && !keyEvent.repeat) {
          keyEvent.preventDefault()
          keyEvent.stopPropagation()
          goBack()
          return
        }
      }

      const action = resolveLyricActionFromKey(keyEvent)
      if (!action) {
        return
      }

      if (keyEvent.repeat) {
        return
      }

      const now = Date.now()
      if (now - lastPedalActionAtRef.current < PEDAL_ACTION_DEBOUNCE_MS) {
        return
      }

      if (
        lastPedalActionTypeRef.current === action
        && now - lastPedalActionAtRef.current < PEDAL_SAME_ACTION_COALESCE_MS
      ) {
        return
      }

      lastPedalActionAtRef.current = now
      lastPedalActionTypeRef.current = action

      // Pedals commonly emit Enter/Space that can also trigger focused buttons.
      // Block default behavior early so lyric controls do not reopen stale route songs.
      keyEvent.preventDefault()
      keyEvent.stopPropagation()

      if (action === 'previous') {
        previousBlock()
      } else {
        nextBlock()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [adminControlsVisible, goBack, nextBlock, previousBlock, state.activeView])

  const openLyric = async () => {
    const songToOpen = activeSong ?? state.song
    if (!songToOpen) {
      return
    }

    const stateAlreadyOnSong = Boolean(
      state.activeView === 'lyric'
      && state.blocks.length > 0
      && state.song
      && state.song.title.trim().toLowerCase() === songToOpen.title.trim().toLowerCase()
      && state.song.artist.trim().toLowerCase() === songToOpen.artist.trim().toLowerCase(),
    )

    if (stateAlreadyOnSong) {
      return
    }

    setActiveView('lyric')
    await openLyricForSong(songToOpen, returnToPath)
  }

  const connectBluetoothPedal = async () => {
    if (typeof navigator === 'undefined') {
      setPedalStatus('Pedal: browser does not expose device pairing here')
      return
    }

    const bluetooth = (navigator as Navigator & {
      bluetooth?: {
        requestDevice?: BluetoothRequestDevice
      }
    }).bluetooth

    if (!bluetooth?.requestDevice) {
      setPedalStatus('Pedal: Bluetooth pairing unavailable in this browser')
      return
    }

    setIsPairingPedal(true)
    setPedalStatus('Pedal: pairing... use your browser chooser')

    try {
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information'],
      })

      if (device.gatt?.connect && !device.gatt.connected) {
        try {
          await device.gatt.connect()
        } catch {
          // Some pedals pair at OS level and do not expose GATT data.
        }
      }

      const label = device.name?.trim() || 'Pedal connected'
      setPedalStatus(`Pedal: ${label}`)
    } catch {
      setPedalStatus('Pedal: pairing canceled or failed')
    } finally {
      setIsPairingPedal(false)
    }
  }

  const openLyricEditor = () => {
    setDraftLyricText(state.blocks.join('\n\n'))
    setIsEditingLyric(true)
  }

  const cancelLyricEditor = () => {
    setIsEditingLyric(false)
    setDraftLyricText('')
  }

  const saveEditedLyric = () => {
    const normalized = normalizeSectionLineBreaks(draftLyricText)
    const nextBlocks = normalized
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)

    if (nextBlocks.length === 0) {
      return
    }

    setBlocks(nextBlocks)
    setIsEditingLyric(false)
  }

  if (!adminControlsVisible) {
    return <AudienceLyricView state={state} onBack={goBackToAudience} />
  }

  return (
    <section className="lyric-dark-neon-shell" aria-label="Lyric display">
      {adminControlsVisible ? (
      <div className="lyric-dark-neon-controls" data-spacebar-ignore="true">
        <button
          type="button"
          className="lyric-dark-neon-button"
          onClick={openLyric}
          onKeyDown={(event) => {
            if (resolveLyricActionFromKey(event.nativeEvent) === null) {
              return
            }

            event.preventDefault()
            event.stopPropagation()
          }}
          onKeyUp={(event) => {
            if (resolveLyricActionFromKey(event.nativeEvent) === null) {
              return
            }

            event.preventDefault()
            event.stopPropagation()
          }}
        >
          Show Lyric
        </button>
        {state.blocks.length > 0 ? (
          <button
            type="button"
            className="lyric-dark-neon-button"
            onClick={() => setShowOnMirror(!state.showOnMirror)}
          >
            Show in Mirror Screen
          </button>
        ) : null}
        <button type="button" className="lyric-dark-neon-button" onClick={openLyricEditor}>
          Edit Lyric
        </button>
        <button
          type="button"
          className="lyric-dark-neon-button"
          onClick={connectBluetoothPedal}
          disabled={isPairingPedal}
        >
          {isPairingPedal ? 'Pairing Pedal...' : 'Connect Bluetooth Pedal'}
        </button>
        <p className="lyric-dark-neon-pedal-status">{pedalStatus}</p>
      </div>
      ) : null}

      {adminControlsVisible && isEditingLyric ? (
        <section className="lyric-dark-neon-editor" data-spacebar-ignore="true" aria-label="Edit lyric">
          <p className="lyric-dark-neon-editor-title">Edit lyric text (separate sections with blank lines)</p>
          <textarea
            className="lyric-dark-neon-editor-textarea"
            value={draftLyricText}
            onChange={(event) => setDraftLyricText(event.target.value)}
            spellCheck={false}
            aria-label="Lyric editor"
            placeholder="Paste or edit full lyric text here"
          />
          <div className="lyric-dark-neon-editor-actions">
            <button type="button" className="lyric-dark-neon-button" onClick={saveEditedLyric}>Save Lyric</button>
            <button type="button" className="lyric-dark-neon-button" onClick={cancelLyricEditor}>Cancel</button>
          </div>
        </section>
      ) : null}

      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        {isIntroScreen ? (
          <div className="lyric-dark-neon-intro">
            <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active lyric-dark-neon-copy-intro-title">
              {introSongLabel}
            </p>
            {introRequesterLabel ? (
              <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro">{introRequesterLabel}</p>
            ) : null}
            <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro">
              Press the foot pedal to start the lyric
            </p>
          </div>
        ) : (
          <>
            <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active">{currentBlock}</p>
            <p className="lyric-dark-neon-meta">
              {introSongLabel}
              {adminControlsVisible ? (
                <>
                  {' • '}
                  Block {Math.min(state.currentBlockIndex + 1, Math.max(1, state.blocks.length))}/{Math.max(1, state.blocks.length)}
                  {' • '}
                  Space/Enter/PageDown next, Shift/Space/PageUp previous
                </>
              ) : null}
            </p>
          </>
        )}
      </article>
    </section>
  )
}
