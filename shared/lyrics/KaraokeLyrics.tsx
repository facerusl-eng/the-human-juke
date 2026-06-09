import { useEffect, useMemo, useRef } from 'react'
import type { LyricLine } from './types'
import './karaoke-lyrics.css'

export type KaraokeLyricsProps = {
  current: LyricLine | null
  previous?: LyricLine | null
  next?: LyricLine | null
  next2?: LyricLine | null
  isBeforeFirstLine?: boolean
  isAfterLastLine?: boolean
  mode?: 'main' | 'audience' | 'board'
  className?: string
}

function lineKey(line: LyricLine | null | undefined) {
  if (!line) {
    return 'line:none'
  }

  return `${line.timeSeconds}:${line.text}`
}

export default function KaraokeLyrics({
  current,
  previous,
  next,
  next2,
  isBeforeFirstLine = false,
  isAfterLastLine = false,
  mode = 'main',
  className = '',
}: KaraokeLyricsProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const stageClassName = useMemo(() => {
    const classes = ['karaoke-stage', `karaoke-stage--${mode}`]
    if (className.trim().length > 0) {
      classes.push(className)
    }

    return classes.join(' ')
  }, [className, mode])

  const currentKey = lineKey(current)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const activeLine = container.querySelector('[data-karaoke-current="true"]')
    if (!activeLine) {
      return
    }

    activeLine.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [currentKey])

  const statusText = isBeforeFirstLine
    ? 'Waiting for song start...'
    : isAfterLastLine
    ? 'Song section ended'
    : null

  return (
    <section className={stageClassName} aria-live="polite" aria-atomic="true">
      <div className="karaoke-stage__inner" ref={containerRef}>
        {statusText ? <p className="karaoke-stage__status">{statusText}</p> : null}

        {previous ? (
          <p className="karaoke-line karaoke-line--previous karaoke-line--muted">{previous.text}</p>
        ) : null}

        {current ? (
          <p className="karaoke-line karaoke-line--current" data-karaoke-current="true">{current.text}</p>
        ) : (
          <p className="karaoke-line karaoke-line--current karaoke-line--muted" data-karaoke-current="true">
            Lyrics unavailable
          </p>
        )}

        {next ? <p className="karaoke-line karaoke-line--next">{next.text}</p> : null}
        {next2 ? <p className="karaoke-line karaoke-line--next karaoke-line--next-secondary">{next2.text}</p> : null}
      </div>
    </section>
  )
}
