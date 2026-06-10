import { useEffect, useMemo, useRef } from 'react'
import type { LyricLine } from './types'
import './karaoke-lyrics.css'

export type KaraokeLyricsProps = {
  current: LyricLine | null
  previous?: LyricLine | null
  next?: LyricLine | null
  next2?: LyricLine | null
  allLines?: LyricLine[]
  currentIndex?: number
  isBeforeFirstLine?: boolean
  isAfterLastLine?: boolean
  mode?: 'main' | 'audience' | 'board'
  className?: string
  autoScrollEnabled?: boolean
  autoScrollCurrentTimeSeconds?: number | null
  autoScrollDurationSeconds?: number | null
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
  allLines = [],
  currentIndex = -1,
  isBeforeFirstLine = false,
  isAfterLastLine = false,
  mode = 'main',
  className = '',
  autoScrollEnabled = false,
  autoScrollCurrentTimeSeconds = null,
  autoScrollDurationSeconds = null,
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
  const hasFullAutoScrollLines = allLines.length > 0

  const lineProgress = useMemo(() => {
    if (!current || !next) {
      return null
    }

    if (!Number.isFinite(autoScrollCurrentTimeSeconds ?? NaN)) {
      return null
    }

    const segmentDuration = next.timeSeconds - current.timeSeconds
    if (!Number.isFinite(segmentDuration) || segmentDuration <= 0) {
      return null
    }

    const elapsed = (autoScrollCurrentTimeSeconds ?? 0) - current.timeSeconds
    return Math.min(1, Math.max(0, elapsed / segmentDuration))
  }, [autoScrollCurrentTimeSeconds, current, next])

  const secondsToNextLine = useMemo(() => {
    if (!next || !Number.isFinite(autoScrollCurrentTimeSeconds ?? NaN)) {
      return null
    }

    return Math.max(0, next.timeSeconds - (autoScrollCurrentTimeSeconds ?? 0))
  }, [autoScrollCurrentTimeSeconds, next])

  const autoScrollProgress = useMemo(() => {
    if (!autoScrollEnabled) {
      return null
    }

    if (!Number.isFinite(autoScrollCurrentTimeSeconds ?? NaN) || !Number.isFinite(autoScrollDurationSeconds ?? NaN)) {
      return null
    }

    if ((autoScrollDurationSeconds ?? 0) <= 0) {
      return null
    }

    return Math.min(1, Math.max(0, (autoScrollCurrentTimeSeconds ?? 0) / (autoScrollDurationSeconds ?? 1)))
  }, [autoScrollCurrentTimeSeconds, autoScrollDurationSeconds, autoScrollEnabled])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const activeLine = container.querySelector('[data-karaoke-current="true"]')

    if (hasFullAutoScrollLines && activeLine) {
      activeLine.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      return
    }

    if (autoScrollProgress !== null) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      container.scrollTop = maxScrollTop * autoScrollProgress
      return
    }

    if (!activeLine) {
      return
    }

    activeLine.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [autoScrollProgress, currentIndex, currentKey, hasFullAutoScrollLines])

  const statusText = isBeforeFirstLine
    ? 'Waiting for song start...'
    : isAfterLastLine
    ? 'Song section ended'
    : null

  return (
    <section className={stageClassName} aria-live="polite" aria-atomic="true">
      <div className="karaoke-stage__inner" ref={containerRef} data-auto-scroll={autoScrollEnabled ? 'true' : 'false'}>
        {secondsToNextLine !== null ? (
          <div className="karaoke-stage__cue" aria-live="off">
            <span className="karaoke-stage__cue-label">Next line in {secondsToNextLine.toFixed(1)}s</span>
            <progress className="karaoke-stage__line-progress" max={1} value={lineProgress ?? 0} />
          </div>
        ) : null}

        {statusText ? <p className="karaoke-stage__status">{statusText}</p> : null}

        {previous ? (
          <p className="karaoke-line karaoke-line--previous karaoke-line--muted">{previous.text}</p>
        ) : null}

        {hasFullAutoScrollLines ? (
          allLines.map((line, lineIndex) => {
            const isCurrentLine = lineIndex === currentIndex
            const isPreviousLine = lineIndex < currentIndex
            const lineClassName = isCurrentLine
              ? 'karaoke-line karaoke-line--current'
              : (isPreviousLine
                ? 'karaoke-line karaoke-line--previous karaoke-line--muted'
                : 'karaoke-line karaoke-line--next')

            return (
              <p
                key={`${line.sourceLineNumber}:${line.timeSeconds}:${line.text}`}
                className={lineClassName}
                data-karaoke-current={isCurrentLine ? 'true' : undefined}
              >
                {line.text}
              </p>
            )
          })
        ) : current ? (
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
