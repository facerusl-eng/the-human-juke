import type { SaveLifecycleStatus } from '../../hooks/useAutosaveSaveLifecycle'

type SaveStatusBadgesProps = {
  saveStatus: SaveLifecycleStatus
  showUnsaved?: boolean
  unsavedLabel?: string
  savingLabel?: string
  savedLabel?: string
  errorLabel?: string
}

export function SaveStatusBadges({
  saveStatus,
  showUnsaved = false,
  unsavedLabel = 'Unsaved changes',
  savingLabel = 'Saving...',
  savedLabel = '✓ Saved',
  errorLabel = '✕ Error',
}: SaveStatusBadgesProps) {
  return (
    <div className="toolbar-status">
      {showUnsaved ? <span className="status-badge unsaved">{unsavedLabel}</span> : null}
      {saveStatus === 'saving' ? <span className="status-badge saving">{savingLabel}</span> : null}
      {saveStatus === 'saved' ? <span className="status-badge saved">{savedLabel}</span> : null}
      {saveStatus === 'error' ? <span className="status-badge error">{errorLabel}</span> : null}
    </div>
  )
}