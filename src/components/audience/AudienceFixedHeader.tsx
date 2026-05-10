import { memo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AudienceLocale } from '../../lib/audienceIdentity'
import { PrimaryButton } from '../ui'

type AudienceFixedHeaderProps = {
  eventName: string
  subtitle?: string | null
  logoSrc?: string | null
  locale?: AudienceLocale
  shareUrl?: string | null
  onSignOut?: () => void
}

function AudienceFixedHeader({ eventName, subtitle, logoSrc, locale = 'en', shareUrl, onSignOut }: AudienceFixedHeaderProps) {
  const [pendingSignOut, setPendingSignOut] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  const copy = locale === 'da'
    ? {
        headerLabel: 'Event header',
        logoAlt: 'Event logo',
        kicker: 'Live Event',
        backLabel: 'Tilbage til forsiden',
        backText: 'Tilbage',
        signOutLabel: 'Log ud',
        signOutConfirm: 'Sikker?',
        shareLabel: 'Del',
        shareCopied: 'Kopieret!',
      }
    : locale === 'is'
    ? {
        headerLabel: 'Vidhburdarhaus',
        logoAlt: 'Vidhburdarlogo',
        kicker: 'Live Viðburður',
        backLabel: 'Til baka a forsidu',
        backText: 'Til baka',
        signOutLabel: 'Skrá Út',
        signOutConfirm: 'Ertu viss?',
        shareLabel: 'Deila',
        shareCopied: 'Afritað!',
      }
    : {
        headerLabel: 'Event header',
        logoAlt: 'Event logo',
        kicker: 'Live Event',
        backLabel: 'Back to home',
        backText: 'Back',
        signOutLabel: 'Sign Out',
        signOutConfirm: 'Sure?',
        shareLabel: 'Share',
        shareCopied: 'Copied!',
      }

  const handleSignOutClick = () => {
    if (pendingSignOut) {
      onSignOut?.()
      setPendingSignOut(false)
    } else {
      setPendingSignOut(true)
      window.setTimeout(() => setPendingSignOut(false), 3500)
    }
  }

  const handleShare = async () => {
    if (!shareUrl) return
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ url: shareUrl, title: eventName })
        return
      } catch {
        // fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 2500)
    } catch {
      // silent fail
    }
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
        {shareUrl ? (
          <PrimaryButton type="button" variant="tertiary" onClick={() => { void handleShare() }} aria-label={copy.shareLabel} title={copy.shareLabel}>
            {shareCopied ? copy.shareCopied : `🔗 ${copy.shareLabel}`}
          </PrimaryButton>
        ) : null}
        {onSignOut ? (
          <PrimaryButton
            type="button"
            variant="tertiary"
            onClick={handleSignOutClick}
            aria-label={copy.signOutLabel}
            title={copy.signOutLabel}
            className={pendingSignOut ? 'audience-signout-confirm' : undefined}
          >
            {pendingSignOut ? copy.signOutConfirm : copy.signOutLabel}
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
