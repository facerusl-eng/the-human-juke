export type OpenLyricMachineWindowResult = {
  openedInNewTabWindow: boolean
  blockedByPopup: boolean
  errorMessage?: string | null
}

type OpenLyricMachineScreenOptions = {
  eventId?: string | null
  title?: string | null
  artist?: string | null
  songId?: string | null
  librarySongId?: string | null
  album?: string | null
  duration?: number | string | null
}

export function openLyricMachineScreen(options: OpenLyricMachineScreenOptions = {}): OpenLyricMachineWindowResult {
  const lyricMachineUrl = new URL('/lyric-machine', window.location.origin)
  const resolvedEventId = (() => {
    const explicitEventId = (options.eventId ?? '').trim()
    if (explicitEventId) {
      return explicitEventId
    }

    try {
      const authSnapshot = JSON.parse(window.localStorage.getItem('human-jukebox-auth-session-snapshot') ?? '{}') as { activeEventId?: string | null }
      return (authSnapshot.activeEventId ?? '').trim()
    } catch {
      return ''
    }
  })()

  if (resolvedEventId) {
    lyricMachineUrl.searchParams.set('event', resolvedEventId)
  }

  if (options.title?.trim()) {
    lyricMachineUrl.searchParams.set('title', options.title.trim())
  }

  if (options.artist?.trim()) {
    lyricMachineUrl.searchParams.set('artist', options.artist.trim())
  }

  if (options.songId?.trim()) {
    lyricMachineUrl.searchParams.set('songId', options.songId.trim())
  }

  if (options.librarySongId?.trim()) {
    lyricMachineUrl.searchParams.set('librarySongId', options.librarySongId.trim())
  }

  if (options.album?.trim()) {
    lyricMachineUrl.searchParams.set('album', options.album.trim())
  }

  if (typeof options.duration === 'number' && Number.isFinite(options.duration)) {
    lyricMachineUrl.searchParams.set('duration', String(options.duration))
  } else if (typeof options.duration === 'string' && options.duration.trim()) {
    lyricMachineUrl.searchParams.set('duration', options.duration.trim())
  }

  const lyricMachineWindowFeatures = 'width=1280,height=800,noopener,noreferrer'
  const lyricMachineWindowTarget = 'lyric-machine-window'
  const lyricMachineTab = window.open(lyricMachineUrl.toString(), lyricMachineWindowTarget, lyricMachineWindowFeatures)

  if (lyricMachineTab) {
    lyricMachineTab.focus()
    return {
      openedInNewTabWindow: true,
      blockedByPopup: false,
    }
  }

  return {
    openedInNewTabWindow: false,
    blockedByPopup: true,
    errorMessage: 'Pop-up blocked. Please allow pop-ups for this site and try again.',
  }
}
