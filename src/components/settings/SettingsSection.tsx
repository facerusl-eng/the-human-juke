import type { ReactNode } from 'react'

type SettingsSectionProps = {
  id: string
  title: string
  icon?: string
  isExpanded: boolean
  onToggle: () => void
  children: ReactNode
  as?: 'div' | 'section'
  contentIdPrefix?: string
  expandedClassName?: string
  collapsedClassName?: string
  expandedToggleLabel?: string
  collapsedToggleLabel?: string
  dataSection?: boolean
}

export function SettingsSection({
  id,
  title,
  icon,
  isExpanded,
  onToggle,
  children,
  as = 'section',
  contentIdPrefix = 'section-content',
  expandedClassName,
  collapsedClassName,
  expandedToggleLabel = '▼',
  collapsedToggleLabel = '▶',
  dataSection = false,
}: SettingsSectionProps) {
  const containerClassName = [
    'collapsible-section',
    isExpanded ? expandedClassName : collapsedClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const contentId = `${contentIdPrefix}-${id}`
  const containerProps = dataSection ? { 'data-section': id } : undefined
  const Container = as

  return (
    <Container className={containerClassName} {...containerProps}>
      <button
        type="button"
        className="section-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
      >
        {icon ? <span className="section-icon">{icon}</span> : null}
        <span className="section-title">{title}</span>
        <span className="section-toggle">{isExpanded ? expandedToggleLabel : collapsedToggleLabel}</span>
      </button>
      {isExpanded ? (
        <div id={contentId} className="section-content">
          {children}
        </div>
      ) : null}
    </Container>
  )
}