import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { AudienceLocale } from '../../lib/audienceIdentity'

type AudienceFixedHeaderProps = {
  eventName: string
  subtitle?: string | null
  logoSrc?: string | null
  locale?: AudienceLocale
  onSignOut?: () => void
}

function AudienceFixedHeader({ eventName, subtitle, logoSrc, locale = 'en', onSignOut }: AudienceFixedHeaderProps) {
  const copy = locale === 'da'
    ? {
        headerLabel: 'Event header',
        logoAlt: 'Event logo',
        kicker: 'Live Event',
        backLabel: 'Tilbage til forsiden',
        backText: 'Tilbage',
        signOutLabel: 'Log ud',
      }
    : {
        headerLabel: 'Event header',
        logoAlt: 'Event logo',
        kicker: 'Live Event',
        backLabel: 'Back to home',
        backText: 'Back',
        signOutLabel: 'Sign Out',
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
      <div className="audience-fixed-actions">
        {onSignOut ? (
          <button
            type="button"
            className="tertiary-button"
            onClick={onSignOut}
            aria-label={copy.signOutLabel}
            title={copy.signOutLabel}
          >
            {copy.signOutLabel}
          </button>
        ) : null}
        <Link to="/" className="tertiary-button audience-fixed-back" aria-label={copy.backLabel}>
          {copy.backText}
        </Link>
      </div>
    </header>
  )
}

export default memo(AudienceFixedHeader)
