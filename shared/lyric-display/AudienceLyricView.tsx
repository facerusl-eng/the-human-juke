import { useEffect, useMemo, useRef } from 'react'
import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

const AUDIENCE_LYRIC_SCROLL_STORAGE_KEY = 'human-jukebox:audience-lyrics-scroll-v1'

function normalizeSongIdentityPart(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildAudienceLyricScrollKey(song: LyricDisplayState['song']) {
  if (!song) {
    return null
  }

  const id = normalizeSongIdentityPart(song.librarySongId ?? song.id)
  const title = normalizeSongIdentityPart(song.title)
  const artist = normalizeSongIdentityPart(song.artist)

  if (!id && !title && !artist) {
    return null
  }

  return `${id}::${artist}::${title}`
}

type AudienceLyricViewProps = {
  state: LyricDisplayState
  onBack?: () => void
}

export default function AudienceLyricView({ state, onBack }: AudienceLyricViewProps) {
  const scrollShellRef = useRef<HTMLElement | null>(null)
  const scrollKey = useMemo(() => buildAudienceLyricScrollKey(state.song), [state.song])
  const songLabel = state.song ? `${state.song.artist} - ${state.song.title}` : null
  const introRequesterLabel = state.song?.audience_sings && state.song.createdByName?.trim()
    ? `Requested by ${state.song.createdByName.trim()}`
    : null

  useEffect(() => {
    if (typeof window === 'undefined' || !scrollKey) {
      return
    }

    const scrollShell = scrollShellRef.current
    if (!scrollShell) {
      return
    }

    try {
      const storedValue = window.sessionStorage.getItem(AUDIENCE_LYRIC_SCROLL_STORAGE_KEY)
      if (!storedValue) {
        return
      }

      const parsedMap = JSON.parse(storedValue) as Record<string, number>
      const scrollTop = parsedMap[scrollKey]
      if (Number.isFinite(scrollTop) && scrollTop >= 0) {
        scrollShell.scrollTop = scrollTop
      }
    } catch {
      // Ignore malformed session data.
    }
  }, [scrollKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !scrollKey) {
      return
    }

    const scrollShell = scrollShellRef.current
    if (!scrollShell) {
      return
    }

    const saveScrollPosition = () => {
      try {
        const storedValue = window.sessionStorage.getItem(AUDIENCE_LYRIC_SCROLL_STORAGE_KEY)
        const parsedMap = storedValue ? JSON.parse(storedValue) as Record<string, number> : {}
        parsedMap[scrollKey] = scrollShell.scrollTop
        window.sessionStorage.setItem(AUDIENCE_LYRIC_SCROLL_STORAGE_KEY, JSON.stringify(parsedMap))
      } catch {
        // Ignore storage write failures.
      }
    }

    scrollShell.addEventListener('scroll', saveScrollPosition, { passive: true })
    return () => {
      scrollShell.removeEventListener('scroll', saveScrollPosition)
    }
  }, [scrollKey])

  return (
    <section ref={scrollShellRef} className="lyric-dark-neon-shell audience-lyric-scroll-shell" aria-label="Audience lyric view">
      {onBack ? (
        <div className="audience-lyric-back-bar">
          <button type="button" className="audience-lyric-back-btn" onClick={onBack}>
            ← Back to Lounge
          </button>
        </div>
      ) : null}
      <article className="lyric-dark-neon-stage audience-lyric-scroll-body">
        {songLabel ? (
          <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro audience-lyric-scroll-title">{songLabel}</p>
        ) : null}
        {introRequesterLabel ? (
          <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro">{introRequesterLabel}</p>
        ) : null}
        {state.blocks.length > 0
          ? state.blocks.map((block, index) => (
              <p key={index} className="lyric-dark-neon-copy lyric-dark-neon-copy-control audience-lyric-scroll-block">{block}</p>
            ))
          : <p className="lyric-dark-neon-meta">Waiting for lyrics...</p>
        }
      </article>
    </section>
  )
}
