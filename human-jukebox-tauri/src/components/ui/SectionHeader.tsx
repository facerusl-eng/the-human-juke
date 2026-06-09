type SectionHeaderProps = {
  title: string
  subtitle?: string
  eyebrow?: string
  className?: string
  titleLevel?: 1 | 2 | 3
}

function SectionHeader({ title, subtitle, eyebrow, className = '', titleLevel = 2 }: SectionHeaderProps) {
  const classes = ['ui-section-header', className].filter(Boolean).join(' ')
  const TitleTag = titleLevel === 1 ? 'h1' : titleLevel === 3 ? 'h3' : 'h2'

  return (
    <header className={classes}>
      {eyebrow ? <p className="ui-section-eyebrow">{eyebrow}</p> : null}
      <TitleTag className="ui-section-title">{title}</TitleTag>
      {subtitle ? <p className="ui-section-subtitle">{subtitle}</p> : null}
    </header>
  )
}

export default SectionHeader