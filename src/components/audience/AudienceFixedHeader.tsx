import { memo } from 'react'
import { Link } from 'react-router-dom'

type AudienceFixedHeaderProps = {
  eventName: string
  subtitle?: string | null
  logoSrc?: string | null
}

function AudienceFixedHeader({ eventName, subtitle, logoSrc }: AudienceFixedHeaderProps) {
  return (
    <header className="audience-fixed-header" aria-label="Event header">
      <div className="audience-fixed-header-main">
        {logoSrc ? (
          <img src={logoSrc} alt="Event logo" className="audience-fixed-logo" />
        ) : null}
        <div className="audience-fixed-copy">
          <p className="audience-fixed-kicker">Live Event</p>
          <h1>{eventName}</h1>
          {subtitle ? <p className="audience-fixed-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      <Link to="/" className="tertiary-button audience-fixed-back" aria-label="Back to home">
        Back
      </Link>
    </header>
  )
}

export default memo(AudienceFixedHeader)
