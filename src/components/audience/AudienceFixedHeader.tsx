import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { AudienceLocale } from '../../lib/audienceIdentity'
import { PrimaryButton } from '../ui'

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
    : locale === 'is'
    ? {
        headerLabel: 'Vidhburdarhaus',
        logoAlt: 'Vidhburdarlogo',
        kicker: 'Live vidburdur',
        backLabel: 'Til baka a forsidu',
        backText: 'Til baka',
        signOutLabel: 'Skra ut',
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
          <PrimaryButton type="button" variant="tertiary" onClick={onSignOut} aria-label={copy.signOutLabel} title={copy.signOutLabel}>
            {copy.signOutLabel}
          </PrimaryButton>
        ) : null}
        <Link to="/" className="ui-icon-button audience-fixed-back-link" aria-label={copy.backLabel} title={copy.backText}>
          <span aria-hidden="true">←</span>
        </Link>
      </div>
    </header>
  )
}

export default memo(AudienceFixedHeader)
