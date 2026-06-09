// KaraokeLyrics Component
// Time-synced lyrics display with dark neon theme
// Supports desktop (fullscreen board), mobile (audience), and stage use

import { useMemo, useEffect, useRef, useState } from 'react'
import type { LyricContext as LyricContextType } from '../lib/lyricEngine'
import { getLyricContext, loadLyrics as loadLyricsEngine, unloadLyrics } from '../lib/lyricEngine'
import '../audience-karafun.css'

type KaraokeLyricsProps = {
  context: LyricContextType
  // Display mode
  mode?: 'fullscreen' | 'audience' | 'compact'
  // Theme variant
  theme?: 'neon' | 'soft' | 'high-contrast'
  // Show previous/next lines
  showHistory?: number // number of previous lines to show
  showPreview?: number // number of next lines to show
  // Animation
  animate?: boolean
  // Custom className
  className?: string
}

// Neon color palette
interface ColorPalette {
  background: string
  currentText: string
  currentGlow: string
  previousText: string
  nextText: string
  accent: string
  progress: string
}

const NEON_COLORS: ColorPalette = {
  background: '#0a0a0f',
  currentText: '#00ffcc',
  currentGlow: '#00ffcc',
  previousText: '#4a5568',
  nextText: '#a0aec0',
  accent: '#ff00ff',
  progress: '#00ffcc',
}

const SOFT_COLORS: ColorPalette = {
  background: '#1a1a2e',
  currentText: '#e2e8f0',
  currentGlow: '#6366f1',
  previousText: '#475569',
  nextText: '#94a3b8',
  accent: '#818cf8',
  progress: '#6366f1',
}

const HIGH_CONTRAST_COLORS: ColorPalette = {
  background: '#000000',
  currentText: '#ffffff',
  currentGlow: '#ffffff',
  previousText: '#888888',
  nextText: '#cccccc',
  accent: '#ffff00',
  progress: '#ffffff',
}

function getColors(theme: 'neon' | 'soft' | 'high-contrast'): ColorPalette {
  if (theme === 'high-contrast') return HIGH_CONTRAST_COLORS
  if (theme === 'soft') return SOFT_COLORS
  return NEON_COLORS
}

// Current line display with progress highlight
function CurrentLineDisplay({
  line,
  progress,
  theme,
  animate: animateProp = true,
}: {
  line: string
  progress: number
  theme: 'neon' | 'soft' | 'high-contrast'
  animate?: boolean
}) {
  // Always call useMemo first (React hooks rule)
  const colors = getColors(theme)
  const words = useMemo(() => line.split(/\s+/), [line])
  const highlightedWordCount = useMemo(() => Math.floor(words.length * progress), [words.length, progress])

  if (!line) {
    return <div className="karaoke-current-line karaoke-empty">Waiting for lyrics...</div>
  }

  return (
    <div
      className="karaoke-current-line"
      style={{
        color: colors.currentText,
        textShadow: `0 0 20px ${colors.currentGlow}, 0 0 40px ${colors.currentGlow}40`,
      }}
    >
      {words.map((word, index) => {
        const isSung = index < highlightedWordCount
        const isCurrent = index === highlightedWordCount && progress < 1
        return (
          <span
            key={index}
            className={`${isSung ? 'karaoke-word-sung' : ''} ${isCurrent ? 'karaoke-word-current' : ''}`}
            style={{
              opacity: isSung ? 1 : isCurrent ? 0.7 : 1,
              transition: animateProp ? 'opacity 0.1s ease' : 'none',
            }}
          >
            {word}
            {index < words.length - 1 ? ' ' : ''}
          </span>
        )
      })}
    </div>
  )
}

// Previous line (dimmed)
function PreviousLineDisplay({
  line,
  theme,
}: {
  line: string
  theme: 'neon' | 'soft' | 'high-contrast'
}) {
  if (!line) return null

  const colors = getColors(theme)

  return (
    <div
      className="karaoke-previous-line"
      style={{ color: colors.previousText }}
    >
      {line}
    </div>
  )
}

// Next lines (preview)
function NextLinesDisplay({
  lines,
  theme,
}: {
  lines: Array<{ text: string } | null | undefined>
  theme: 'neon' | 'soft' | 'high-contrast'
}) {
  const colors = getColors(theme)

  // Filter valid lines safely
  const validLines: { text: string }[] = []
  for (const l of lines) {
    if (l && l.text && l.text.length > 0) {
      validLines.push(l)
    }
  }

  if (validLines.length === 0) return null

  return (
    <div className="karaoke-next-lines">
      {validLines.map((line, index) => (
        <div
          key={index}
          className="karaoke-next-line"
          style={{
            color: colors.nextText,
            opacity: 0.5 + (index * 0.15),
          }}
        >
          {line.text}
        </div>
      ))}
    </div>
  )
}

// Progress bar through current line
function ProgressBar({
  progress,
  theme,
}: {
  progress: number
  theme: 'neon' | 'soft' | 'high-contrast'
}) {
  const colors = getColors(theme)

  return (
    <div className="karaoke-progress-bar-container">
      <div
        className="karaoke-progress-bar"
        style={{
          width: `${Math.max(0, Math.min(100, progress * 100))}%`,
          backgroundColor: colors.progress,
          boxShadow: `0 0 10px ${colors.progress}`,
        }}
      />
    </div>
  )
}

// Mobile/compact version
function CompactDisplay({
  context,
  theme,
}: {
  context: LyricContextType
  theme: 'neon' | 'soft' | 'high-contrast'
}) {
  const colors = getColors(theme)

  return (
    <div className="karaoke-compact" style={{ backgroundColor: colors.background }}>
      {context.previous && (
        <PreviousLineDisplay line={context.previous.text} theme={theme} />
      )}
      {context.current && (
        <CurrentLineDisplay
          line={context.current.text}
          progress={context.progress}
          theme={theme}
        />
      )}
      <NextLinesDisplay
        lines={[context.next, context.nextNext]}
        theme={theme}
      />
    </div>
  )
}

// Fullscreen version with smooth scrolling
function FullscreenDisplay({
  context,
  theme,
  animate: animateProp = true,
}: {
  context: LyricContextType
  theme: 'neon' | 'soft' | 'high-contrast'
  animate?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const colors = getColors(theme)

  // Auto-scroll to current line
  useEffect(() => {
    if (!animateProp || !containerRef.current || !context.current) return

    const container = containerRef.current
    const currentElement = container.querySelector('.karaoke-current-line')

    if (currentElement) {
      currentElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [context.current?.text, animateProp])

  return (
    <div
      ref={containerRef}
      className="karaoke-fullscreen"
      style={{ backgroundColor: colors.background }}
    >
      {/* Top section: previous line (scrolled away) */}
      <div className="karaoke-section karaoke-section-previous">
        {context.previous && (
          <PreviousLineDisplay line={context.previous.text} theme={theme} />
        )}
      </div>

      {/* Center section: current line */}
      <div className="karaoke-section karaoke-section-current">
        {context.isBeforeStart ? (
          <div
            className="karaoke-waiting"
            style={{ color: colors.nextText }}
          >
            Waiting for song to start...
          </div>
        ) : context.isAfterEnd ? (
          <div
            className="karaoke-ended"
            style={{ color: colors.previousText }}
          >
            End of lyrics
          </div>
        ) : context.current ? (
          <>
            <CurrentLineDisplay
              line={context.current.text}
              progress={context.progress}
              theme={theme}
              animate={animateProp}
            />
            <ProgressBar progress={context.progress} theme={theme} />
          </>
        ) : null}
      </div>

      {/* Bottom section: upcoming lines */}
      <div className="karaoke-section karaoke-section-next">
        <NextLinesDisplay
          lines={[context.next, context.nextNext]}
          theme={theme}
        />
      </div>
    </div>
  )
}

// Main component - always call hooks before any early returns
export default function KaraokeLyrics({
  context,
  mode = 'fullscreen',
  theme = 'neon',
  animate = true,
  className = '',
}: KaraokeLyricsProps) {
  // Always call useMemo at the top level before any early returns
  const componentClass = `karaoke-lyrics karaoke-mode-${mode} karaoke-theme-${theme} ${className}`
  const colors = getColors(theme)
  const currentLine = context.current
  const previousLine = context.previous
  const nextLine = context.next
  const nextNextLine = context.nextNext

  // Render based on mode
  if (mode === 'compact') {
    return (
      <CompactDisplay context={context} theme={theme} />
    )
  }

  if (mode === 'audience') {
    // Show previous, current, and next lines for audience view
    return (
      <div
        className={`${componentClass} karaoke-audience`}
        style={{ backgroundColor: colors.background }}
      >
        {/* Header showing current song time context */}
        <div className="karaoke-audience-header">
          {context.isBeforeStart && (
            <span style={{ color: colors.nextText }}>Get ready...</span>
          )}
          {context.isAfterEnd && (
            <span style={{ color: colors.previousText }}>Song ended</span>
          )}
        </div>

        {/* Previous line (faded) */}
        <div className="karaoke-audience-previous">
          {previousLine && (
            <PreviousLineDisplay line={previousLine.text} theme={theme} />
          )}
        </div>

        {/* Current line (highlighted) */}
        <div className="karaoke-audience-current">
          {currentLine ? (
            <CurrentLineDisplay
              line={currentLine.text}
              progress={context.progress}
              theme={theme}
            />
          ) : !context.isAfterEnd ? (
            <div
              className="karaoke-empty"
              style={{ color: colors.nextText }}
            >
              {context.isBeforeStart ? 'Starting soon...' : 'Loading lyrics...'}
            </div>
          ) : null}
        </div>

        {/* Next lines (preview) */}
        <div className="karaoke-audience-next">
          <NextLinesDisplay
            lines={[nextLine, nextNextLine]}
            theme={theme}
          />
        </div>
      </div>
    )
  }

  // Default: fullscreen mode
  return (
    <div className={componentClass}>
      <FullscreenDisplay
        context={context}
        theme={theme}
        animate={animate}
      />
    </div>
  )
}

// Hook for integrating with audio source (Jamzone)
export function useLyricSync(
  getCurrentTimeSeconds: () => number,
  options?: {
    updateInterval?: number // ms between updates (default: 50ms for smooth 20fps)
    onSongChange?: (songId: string | null, title: string, artist: string) => void
  }
) {
  const {
    updateInterval = 50,
    onSongChange,
  } = options ?? {}

  // Local state for lyric context
  const [context, setContext] = useState<LyricContextType>({
    current: null,
    previous: null,
    next: null,
    nextNext: null,
    isBeforeStart: true,
    isAfterEnd: false,
    progress: 0,
  })

  const songRef = useRef<{
    songId: string | null
    title: string
    artist: string
  } | null>(null)

  const intervalRef = useRef<number | null>(null)

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  // Start sync loop
  useEffect(() => {
    const sync = () => {
      const currentSeconds = getCurrentTimeSeconds()
      const currentMs = Math.round(currentSeconds * 1000)
      const newContext = getLyricContext(currentMs)
      setContext(newContext)
    }

    intervalRef.current = window.setInterval(sync, updateInterval)
    sync() // Initial sync

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [getCurrentTimeSeconds, updateInterval])

  // Return context getter and load function
  return {
    context,
    loadLyrics: async (songId: string | null, title: string, artist: string) => {
      // Skip if same song
      if (
        songRef.current?.songId === songId &&
        songRef.current?.title === title &&
        songRef.current?.artist === artist
      ) {
        return true
      }

      // Unload previous
      unloadLyrics()

      // Load new
      const loaded = await loadLyricsEngine(songId, title, artist)

      if (loaded) {
        songRef.current = { songId, title, artist }
        onSongChange?.(songId, title, artist)
      }

      return loaded
    },
  }
}

// Re-export types for external use
export type { LyricContextType as LyricContext }
