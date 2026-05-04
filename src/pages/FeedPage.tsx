import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import LiveFeedPanel from '../components/LiveFeedPanel'
import {
  commitAudienceIdentity,
  readCommittedAudienceLocale,
  readCommittedAudienceName,
  type AudienceLocale,
} from '../lib/audienceIdentity'
import { useQueueStore } from '../state/queueStore'
import { demoMode } from '../demo/demoMode'

function FeedPage() {
  const { event } = useQueueStore()
  const [nameInput, setNameInput] = useState('')
  const [nameCommitted, setNameCommitted] = useState(() =>
    demoMode ? 'Demo Guest' : (readCommittedAudienceName() ?? ''),
  )
  const [audienceLocale, setAudienceLocale] = useState<AudienceLocale>(() => readCommittedAudienceLocale())
  const [nameError, setNameError] = useState<string | null>(null)
  const audienceLanguageOptions = (event?.audienceIcelandicEnabled ?? false)
    ? [
        { code: 'en' as const, label: 'English', flagCode: 'gb' },
        { code: 'da' as const, label: 'Dansk', flagCode: 'dk' },
        { code: 'is' as const, label: 'Íslenska', flagCode: 'is' },
      ]
    : [
        { code: 'en' as const, label: 'English', flagCode: 'gb' },
        { code: 'da' as const, label: 'Dansk', flagCode: 'dk' },
      ]
  const copy = audienceLocale === 'da'
    ? {
        title: 'Publikumsfeed',
        heading: 'Skriv dit navn for at fortsætte',
        intro: 'Dette feed er for det aktive publikum. Sæt først dit navn for at være med.',
        nameLabel: 'Dit navn',
        namePlaceholder: 'Dit navn',
        languageLabel: 'Sprog',
        continue: 'Fortsæt til feed',
        enterName: 'Skriv dit navn før du fortsætter.',
        back: 'Tilbage til publikum',
        displayNameLabel: 'Dit navn',
        messageLabel: 'Besked',
        takePhotoLabel: 'Tag Foto',
        choosePhotoLabel: 'Vælg Foto',
        phoneHelpText: 'På telefon: tryk "Tag Foto" for at optage og dele direkte til live-feed.',
      }
    : audienceLocale === 'is'
    ? {
        title: 'Live Feed',
        heading: 'Skraddu nafnid thitt til ad halda afram',
        intro: 'Thetta feed er fyrir virka ahorfendur. Skraddu fyrst nafnid thitt.',
        nameLabel: 'Nafnid thitt',
        namePlaceholder: 'Nafnid thitt',
        languageLabel: 'Tungumal',
        continue: 'Afram i feed',
        enterName: 'Skraddu nafnid thitt adur en thu heldur afram.',
        back: 'Til baka i ahorfendur',
        displayNameLabel: 'Nafn sem byrtist',
        messageLabel: 'Skilaboð',
        takePhotoLabel: 'Taktu mynd',
        choosePhotoLabel: 'Veldu Mynd',
        phoneHelpText: 'Í síma: Veldu \'Taka mynd\' til að taka og senda beint í live‑Feed',
      }
    : {
        title: 'Audience Feed',
        heading: 'Enter your name to continue',
        intro: 'This feed is for the active audience. Set your name first to join in.',
        nameLabel: 'Your name',
        namePlaceholder: 'Your name',
        languageLabel: 'Language',
        continue: 'Continue to Feed',
        enterName: 'Please enter your name before continuing.',
        back: 'Back to Audience',
        displayNameLabel: 'Display name',
        messageLabel: 'Message',
        takePhotoLabel: 'Take Photo',
        choosePhotoLabel: 'Choose Photo',
        phoneHelpText: 'On phone: tap Take Photo to capture and share instantly to the live feed.',
      }

  useEffect(() => {
    if ((event?.audienceIcelandicEnabled ?? false) || audienceLocale !== 'is') {
      return
    }

    setAudienceLocale('en')
  }, [audienceLocale, event?.audienceIcelandicEnabled])

  useEffect(() => {
    const storedName = readCommittedAudienceName()

    if (storedName) {
      setNameCommitted(storedName)
      setNameInput(storedName)
    }

    setAudienceLocale(readCommittedAudienceLocale())
  }, [])

  const onCommitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedName = nameInput.trim()

    if (!normalizedName) {
      setNameError(copy.enterName)
      return
    }

    setNameError(null)
    commitAudienceIdentity({ name: normalizedName, locale: audienceLocale })
    setNameCommitted(normalizedName)
  }

  if (!nameCommitted) {
    return (
      <section className="audience-entry-shell" aria-label="Feed entry">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow">{copy.title}</p>
          <h1>{copy.heading}</h1>
          <p className="subcopy audience-entry-copy">{copy.intro}</p>
          <form className="queue-form audience-entry-form" onSubmit={onCommitName}>
            <div className="field-row">
              <label htmlFor="feed-entry-name">{copy.nameLabel}</label>
              <input
                id="feed-entry-name"
                value={nameInput}
                onChange={(nextEvent) => {
                  setNameInput(nextEvent.target.value)
                  if (nameError) {
                    setNameError(null)
                  }
                }}
                placeholder={copy.namePlaceholder}
                maxLength={40}
                autoFocus
                required
              />
            </div>
            <div className="field-row">
              <span id="feed-entry-language" className="audience-entry-label">{copy.languageLabel}</span>
              <div className="audience-language-picker" role="radiogroup" aria-labelledby="feed-entry-language">
                {audienceLanguageOptions.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    className={`audience-language-option audience-language-option-${option.code}${audienceLocale === option.code ? ' audience-language-option-active' : ''}`}
                    onClick={() => setAudienceLocale(option.code)}
                  >
                    <img className="audience-language-option-flag" src={`https://flagcdn.com/w320/${option.flagCode}.png`} alt="" aria-hidden="true" />
                    <span className="audience-language-option-text">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {nameError ? <p className="error-text">{nameError}</p> : null}
            <button type="submit" className="primary-button">{copy.continue}</button>
          </form>
        </article>
      </section>
    )
  }

  return (
    <section className="feed-page-shell audience-karafun" aria-label="Feed page">
      <div className="feed-page-actions">
        <Link to="/audience" className="secondary-button feed-back-button">
          {copy.back}
        </Link>
      </div>
      <LiveFeedPanel mode="page" title={copy.title} composerCopy={{
        displayNameLabel: copy.displayNameLabel,
        messageLabel: copy.messageLabel,
        takePhotoLabel: copy.takePhotoLabel,
        choosePhotoLabel: copy.choosePhotoLabel,
        phoneHelpText: copy.phoneHelpText,
      }} />
    </section>
  )
}

export default FeedPage