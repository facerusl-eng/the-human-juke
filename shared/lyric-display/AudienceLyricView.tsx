import { useEffect, useMemo, useRef, useState } from 'react'
import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

const AUDIENCE_LYRIC_SCROLL_STORAGE_KEY = 'human-jukebox:audience-lyrics-scroll-v1'
const SECTION_LABEL_RE = /^(verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|hook|refrain|intro|outro|solo|instrumental)\b/i

type AudienceLyricSection = {
  id: string
  heading: string
  lines: string[]
}

export type LyricMachineDisplayPreset = 'tight' | 'balanced' | 'wide' | 'max'

type LyricMachineFitConfig = {
  contentWidth: string
  minFontSize: number
  maxFontSize: number
  lineGap: string
  contentPadding: string
  titleFontSize: string
  requesterFontSize: string
}

type LyricMachineFitColumn = {
  id: string
  lines: string[]
}

const LYRIC_MACHINE_FIT_CONFIG: Record<LyricMachineDisplayPreset, LyricMachineFitConfig> = {
  tight: {
    contentWidth: '66%',
    minFontSize: 8,
    maxFontSize: 30,
    lineGap: '0.08rem',
    contentPadding: '0.15rem 0',
    titleFontSize: 'clamp(13px, 1.55vw, 20px)',
    requesterFontSize: 'clamp(10px, 1.05vw, 14px)',
  },
  balanced: {
    contentWidth: '78%',
    minFontSize: 10,
    maxFontSize: 38,
    lineGap: '0.18rem',
    contentPadding: '0.3rem 0',
    titleFontSize: 'clamp(15px, 1.9vw, 26px)',
    requesterFontSize: 'clamp(11px, 1.15vw, 15px)',
  },
  wide: {
    contentWidth: '90%',
    minFontSize: 11,
    maxFontSize: 44,
    lineGap: '0.28rem',
    contentPadding: '0.42rem 0',
    titleFontSize: 'clamp(17px, 2.15vw, 30px)',
    requesterFontSize: 'clamp(12px, 1.3vw, 16px)',
  },
  max: {
    contentWidth: '100%',
    minFontSize: 12,
    maxFontSize: 52,
    lineGap: '0.36rem',
    contentPadding: '0.5rem 0',
    titleFontSize: 'clamp(18px, 2.4vw, 34px)',
    requesterFontSize: 'clamp(12px, 1.35vw, 17px)',
  },
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

function hasExplicitSectionHeadings(blocks: string[]) {
  for (const block of blocks) {
    const blockLines = block
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (blockLines.length === 0) {
      continue
    }

    if (normalizeSectionHeading(blockLines[0])) {
      return true
    }
  }

  return false
}

function buildAudienceLyricSections(blocks: string[]) {
  const sections: AudienceLyricSection[] = []
  const seenBodyKeys = new Map<string, number>()
  const seenBodyHeadings = new Map<string, string>()
  const explicitHeadingsDetected = hasExplicitSectionHeadings(blocks)
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

      const knownHeading = seenBodyHeadings.get(bodyKey)
      if (knownHeading) {
        sectionHeading = knownHeading
      }

      if (!sectionHeading && !explicitHeadingsDetected && previousMatches > 0) {
        sectionHeading = 'Chorus'
      } else if (!sectionHeading) {
        sectionHeading = `Verse ${verseCounter}`
        verseCounter += 1
      }
    }

    const bodyKey = normalizeSectionBodyKey(sectionLines)
    const headingLooksLikeVerse = /^verse\b/i.test(sectionHeading)
    const previousHeading = seenBodyHeadings.get(bodyKey)
    if (!previousHeading || (!headingLooksLikeVerse && /^verse\b/i.test(previousHeading))) {
      seenBodyHeadings.set(bodyKey, sectionHeading)
    }

    sections.push({
      id: `section-${blockIndex}-${sectionHeading.toLowerCase().replace(/\s+/g, '-')}`,
      heading: sectionHeading,
      lines: sectionLines,
    })
  }

  return sections
}

function splitFitModeColumns(lines: string[]) {
  if (lines.length === 0) {
    return [{ id: 'fit-column-left', lines: [] }, { id: 'fit-column-right', lines: [] }]
  }

  const midpoint = Math.ceil(lines.length / 2)
  let splitIndex = -1

  for (let offset = 0; offset < lines.length; offset += 1) {
    const beforeIndex = midpoint - offset
    const afterIndex = midpoint + offset

    if (beforeIndex > 0 && beforeIndex < lines.length - 1 && lines[beforeIndex] === '') {
      splitIndex = beforeIndex
      break
    }

    if (afterIndex > 0 && afterIndex < lines.length - 1 && lines[afterIndex] === '') {
      splitIndex = afterIndex
      break
    }
  }

  const leftLines = (splitIndex >= 0 ? lines.slice(0, splitIndex) : lines.slice(0, midpoint)).filter((line, index, values) => {
    if (line !== '') {
      return true
    }

    return index > 0 && index < values.length - 1
  })

  const rightLines = (splitIndex >= 0 ? lines.slice(splitIndex + 1) : lines.slice(midpoint)).filter((line, index, values) => {
    if (line !== '') {
      return true
    }

    return index > 0 && index < values.length - 1
  })

  return [
    { id: 'fit-column-left', lines: leftLines },
    { id: 'fit-column-right', lines: rightLines },
  ] satisfies [LyricMachineFitColumn, LyricMachineFitColumn]
}

type AudienceLyricViewProps = {
  state: LyricDisplayState
  onBack?: () => void
  layoutMode?: 'scroll' | 'fit-16-9'
  fitPreset?: LyricMachineDisplayPreset
}

export default function AudienceLyricView({ state, onBack, layoutMode = 'scroll', fitPreset = 'wide' }: AudienceLyricViewProps) {
  const scrollShellRef = useRef<HTMLElement | null>(null)
  const fitFrameRef = useRef<HTMLElement | null>(null)
  const fitContentRef = useRef<HTMLDivElement | null>(null)
  const fitFrameAnimationFrameRef = useRef<number | null>(null)
  const [fitFontSizePx, setFitFontSizePx] = useState(36)
  const scrollKey = useMemo(() => buildAudienceLyricScrollKey(state.song), [state.song])
  const lyricSections = useMemo(() => buildAudienceLyricSections(state.blocks), [state.blocks])
  const fitModeLines = useMemo(() => {
    if (lyricSections.length === 0) {
      return [] as string[]
    }

    const lines: string[] = []
    lyricSections.forEach((section, sectionIndex) => {
      for (const line of section.lines) {
        if (line.trim()) {
          lines.push(line.trim())
        }
      }

      if (sectionIndex < lyricSections.length - 1) {
        lines.push('')
      }
    })

    return lines
  }, [lyricSections])
  const fitModeColumns = useMemo(() => splitFitModeColumns(fitModeLines), [fitModeLines])
  const songLabel = state.song ? `${state.song.artist} - ${state.song.title}` : null
  const introRequesterLabel = state.song?.audience_sings && state.song.createdByName?.trim()
    ? `Requested by ${state.song.createdByName.trim()}`
    : null
  const fitConfig = LYRIC_MACHINE_FIT_CONFIG[fitPreset]

  useEffect(() => {
    if (layoutMode !== 'fit-16-9') {
      return
    }

    const frameElement = fitFrameRef.current
    const contentElement = fitContentRef.current
    if (!frameElement || !contentElement) {
      return
    }

    const MIN_FONT_SIZE = fitConfig.minFontSize
    const MAX_FONT_SIZE = fitConfig.maxFontSize

    const fitFontSize = () => {
      if (fitFrameAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameAnimationFrameRef.current)
      }

      fitFrameAnimationFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameAnimationFrameRef.current = null
        const availableHeight = frameElement.clientHeight
        const availableWidth = frameElement.clientWidth
        if (availableHeight <= 0 || availableWidth <= 0) {
          return
        }

        let fontSize = MAX_FONT_SIZE
        contentElement.style.fontSize = `${fontSize}px`

        while (
          fontSize > MIN_FONT_SIZE
          && (contentElement.scrollHeight > availableHeight || contentElement.scrollWidth > availableWidth)
        ) {
          fontSize -= 1
          contentElement.style.fontSize = `${fontSize}px`
        }

        setFitFontSizePx((currentFontSize) => (currentFontSize === fontSize ? currentFontSize : fontSize))
      })
    }

    fitFontSize()

    const resizeObserver = new ResizeObserver(() => {
      fitFontSize()
    })
    resizeObserver.observe(frameElement)

    return () => {
      if (fitFrameAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameAnimationFrameRef.current)
        fitFrameAnimationFrameRef.current = null
      }

      resizeObserver.disconnect()
    }
  }, [fitConfig.maxFontSize, fitConfig.minFontSize, fitModeColumns, introRequesterLabel, layoutMode, songLabel])

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

  if (layoutMode === 'fit-16-9') {
    return (
      <section className="lyric-dark-neon-shell audience-lyric-fit-shell" aria-label="Lyric machine full lyric view">
        <article ref={fitFrameRef} className="audience-lyric-fit-frame">
          {songLabel ? (
            <p
              className="lyric-dark-neon-meta lyric-dark-neon-meta-intro audience-lyric-fit-title"
              style={{ fontSize: fitConfig.titleFontSize }}
            >
              {songLabel}
            </p>
          ) : null}
          {introRequesterLabel ? (
            <p
              className="lyric-dark-neon-meta lyric-dark-neon-meta-intro audience-lyric-fit-requester"
              style={{ fontSize: fitConfig.requesterFontSize }}
            >
              {introRequesterLabel}
            </p>
          ) : null}

          <div
            ref={fitContentRef}
            className="audience-lyric-fit-content"
            style={{
              fontSize: `${fitFontSizePx}px`,
              width: fitConfig.contentWidth,
              padding: fitConfig.contentPadding,
              gap: fitConfig.lineGap,
            }}
          >
            {fitModeColumns.some((column) => column.lines.length > 0)
              ? fitModeColumns.map((column) => (
                  <div key={column.id} className="audience-lyric-fit-column">
                    {column.lines.map((line, index) => (
                      <p key={`${column.id}-line-${index}`} className="lyric-dark-neon-copy audience-lyric-fit-line">
                        {line || '\u00A0'}
                      </p>
                    ))}
                  </div>
                ))
              : <p className="lyric-dark-neon-meta">Waiting for lyrics...</p>
            }
          </div>
        </article>
      </section>
    )
  }

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
