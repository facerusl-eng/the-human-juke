import { useEffect, useMemo, useRef } from 'react'
import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

const AUDIENCE_LYRIC_SCROLL_STORAGE_KEY = 'human-jukebox:audience-lyrics-scroll-v1'
const SECTION_LABEL_RE = /^(verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|hook|refrain|intro|outro|solo|instrumental)\b/i

type AudienceLyricSection = {
  id: string
  heading: string
  lines: string[]
}

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

function normalizeSectionHeading(rawHeading: string) {
  const unwrappedHeading = rawHeading.trim().replace(/^\[|\]$/g, '').trim()
  const normalizedHeading = unwrappedHeading
    .replace(/\s+/g, ' ')
    .replace(/\s*[:\-]+\s*$/, '')

  if (!normalizedHeading) {
    return null
  }

  if (!SECTION_LABEL_RE.test(normalizedHeading)) {
    return null
  }

  const canonicalHeading = normalizedHeading
    .replace(/^pre[- ]?chorus/i, 'Pre-Chorus')
    .replace(/^post[- ]?chorus/i, 'Post-Chorus')
    .replace(/^verse/i, 'Verse')
    .replace(/^chorus/i, 'Chorus')
    .replace(/^bridge/i, 'Bridge')
    .replace(/^hook/i, 'Hook')
    .replace(/^refrain/i, 'Refrain')
    .replace(/^intro/i, 'Intro')
    .replace(/^outro/i, 'Outro')
    .replace(/^solo/i, 'Solo')
    .replace(/^instrumental/i, 'Instrumental')

  return canonicalHeading
}

function normalizeSectionBodyKey(lines: string[]) {
  return lines
    .join('\n')
    .toLowerCase()
    .replace(/[^a-z0-9\n\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildAudienceLyricSections(blocks: string[]) {
  const sections: AudienceLyricSection[] = []
  const seenBodyKeys = new Map<string, number>()
  let pendingHeading: string | null = null
  let verseCounter = 1

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex]
    const blockLines = block
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (blockLines.length === 0) {
      continue
    }

    const firstLineHeading = normalizeSectionHeading(blockLines[0])

    if (firstLineHeading && blockLines.length === 1) {
      pendingHeading = firstLineHeading
      continue
    }

    let sectionHeading = pendingHeading
    let sectionLines = blockLines

    if (firstLineHeading) {
      sectionHeading = firstLineHeading
      sectionLines = blockLines.slice(1).filter(Boolean)
    }

    pendingHeading = null

    if (sectionLines.length === 0) {
      continue
    }

    if (!sectionHeading) {
      const bodyKey = normalizeSectionBodyKey(sectionLines)
      const previousMatches = seenBodyKeys.get(bodyKey) ?? 0
      seenBodyKeys.set(bodyKey, previousMatches + 1)

      if (previousMatches > 0) {
        sectionHeading = 'Chorus'
      } else {
        sectionHeading = `Verse ${verseCounter}`
        verseCounter += 1
      }
    }

    sections.push({
      id: `section-${blockIndex}-${sectionHeading.toLowerCase().replace(/\s+/g, '-')}`,
      heading: sectionHeading,
      lines: sectionLines,
    })
  }

  return sections
}

type AudienceLyricViewProps = {
  state: LyricDisplayState
  onBack?: () => void
}

export default function AudienceLyricView({ state, onBack }: AudienceLyricViewProps) {
  const scrollShellRef = useRef<HTMLElement | null>(null)
  const scrollKey = useMemo(() => buildAudienceLyricScrollKey(state.song), [state.song])
  const lyricSections = useMemo(() => buildAudienceLyricSections(state.blocks), [state.blocks])
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
        {lyricSections.length > 0
          ? lyricSections.map((section) => (
              <section key={section.id} className="audience-lyric-scroll-section" aria-label={section.heading}>
                <h2 className="audience-lyric-scroll-section-heading">{section.heading}</h2>
                <div className="audience-lyric-scroll-lines">
                  {section.lines.map((line, index) => (
                    <p key={`${section.id}-line-${index}`} className="lyric-dark-neon-copy audience-lyric-scroll-line">{line}</p>
                  ))}
                </div>
              </section>
            ))
          : <p className="lyric-dark-neon-meta">Waiting for lyrics...</p>
        }
      </article>
    </section>
  )
}
