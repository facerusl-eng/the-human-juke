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
import { demoMode } from '../demo/demoMode'

function FeedPage() {
  const [nameInput, setNameInput] = useState('')
  const [nameCommitted, setNameCommitted] = useState(() =>
    demoMode ? 'Demo Guest' : (readCommittedAudienceName() ?? ''),
  )
  const [audienceLocale, setAudienceLocale] = useState<AudienceLocale>(() => readCommittedAudienceLocale())
  const [nameError, setNameError] = useState<string | null>(null)
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
      }

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
                <button
                  type="button"
                  className={`audience-language-option audience-language-option-en${audienceLocale === 'en' ? ' audience-language-option-active' : ''}`}
                  onClick={() => setAudienceLocale('en')}
                >
                  <span className="audience-language-option-flag" aria-hidden="true">🇬🇧</span>
                  <span className="audience-language-option-text">English</span>
                </button>
                <button
                  type="button"
                  className={`audience-language-option audience-language-option-da${audienceLocale === 'da' ? ' audience-language-option-active' : ''}`}
                  onClick={() => setAudienceLocale('da')}
                >
                  <span className="audience-language-option-flag" aria-hidden="true">🇩🇰</span>
                  <span className="audience-language-option-text">Dansk</span>
                </button>
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
      <LiveFeedPanel mode="page" title={copy.title} />
    </section>
  )
}

export default FeedPage