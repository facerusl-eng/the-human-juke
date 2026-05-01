import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { AudienceLocale } from '../../lib/audienceIdentity'

type AudienceFixedHeaderProps = {
  eventName: string
  subtitle?: string | null
  logoSrc?: string | null
  locale?: AudienceLocale
}

function AudienceFixedHeader({ eventName, subtitle, logoSrc, locale = 'en' }: AudienceFixedHeaderProps) {
  const copy = locale === 'da'
    ? {
        headerLabel: 'Event header',
        logoAlt: 'Event logo',
        kicker: 'Live Event',
        backLabel: 'Tilbage til forsiden',
        backText: 'Tilbage',
      }
    : {
        headerLabel: 'Event header',
        logoAlt: 'Event logo',
        kicker: 'Live Event',
        backLabel: 'Back to home',
        backText: 'Back',
      }

  return (
    <header className="audience-fixed-header" aria-label={copy.headerLabel}>
      <div className="audience-fixed-header-main">
        {logoSrc ? (
          <img src={logoSrc} alt={copy.logoAlt} className="audience-fixed-logo" />
        ) : null}
        <div className="audience-fixed-copy">
          <p className="audience-fixed-kicker">{copy.kicker}</p>
          <h1>{eventName}</h1>
          {subtitle ? <p className="audience-fixed-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      <Link to="/" className="tertiary-button audience-fixed-back" aria-label={copy.backLabel}>
        {copy.backText}
      </Link>
    </header>
  )
}

export default memo(AudienceFixedHeader)
