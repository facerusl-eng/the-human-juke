export type OpenMirrorScreenResult = {
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
}

export function openMirrorScreen(): OpenMirrorScreenResult {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('safeMargins', '1')
  mirrorUrl.searchParams.set('density', 'medium')

  const mirrorTab = window.open(mirrorUrl.toString(), '_blank', 'noopener,noreferrer')

  if (mirrorTab) {
    mirrorTab.focus()
    return {
      openedInPopupWindow: false,
      openedInNewTabWindow: true,
    }
  }

  return {
    openedInPopupWindow: false,
    openedInNewTabWindow: false,
  }
}