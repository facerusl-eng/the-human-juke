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
        title: 'Livefeed for publikum',
        heading: 'Skriv dit navn for at fortsætte',
        intro: 'Dette livefeed er for det aktive publikum. Angiv først dit navn for at være med.',
        nameLabel: 'Dit navn',
        namePlaceholder: 'Dit navn',
        languageLabel: 'Sprog',
        continue: 'Fortsæt til feed',
        enterName: 'Skriv dit navn før du fortsætter.',
        back: 'Tilbage til publikum',
        displayNameLabel: 'Dit navn',
        messageLabel: 'Besked',
        messagePlaceholder: 'Send en hilsen, en dedikation eller del et øjeblik...',
        takePhotoLabel: 'Tag foto',
        choosePhotoLabel: 'Vælg foto',
        phoneHelpText: 'På telefon: tryk "Tag foto" for at tage et billede og dele direkte i livefeedet.',
        submitLabel: 'Send til livefeed',
        submitPostingLabel: 'Sender...',
        emptyFeedText: 'Ingen opslag i livefeedet endnu. Start samtalen.',
        warningText: 'Alt indhold i livefeedet er brugerens eget ansvar. Hvis værten vurderer, at indhold er upassende eller ikke passer til arrangementet, kan brugeren blive blokeret fra eventet.',
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
        back: 'Til baka í salinn',
        displayNameLabel: 'Nafn sem byrtist',
        messageLabel: 'Skilaboð',
        messagePlaceholder: 'Sendu kveðju, tileinka lag eða deildu stemmningunni með öllum!',
        takePhotoLabel: 'Taktu mynd',
        choosePhotoLabel: 'Veldu Mynd',
        phoneHelpText: 'Í síma: Veldu \'Taktu mynd\' Eða veldu eina úr albúminu þínu og senda beint í live‑Feed.',
        submitLabel: 'Sendu á Live Feed',
        submitPostingLabel: 'Sendir...',
        emptyFeedText: 'Engin skilaboð hafa verið send, Taktu þátt í gleðinni og sendu á Feediö!',
        warningText: 'Allt efni sem birt er í Live Feedinu er á ábyrgð notandans. Ef gestgjafinn telur að efnið sé óviðeigandi eða ekki við hæfi fyrir viðburðinn, getur notandinn verið lokaður úti frá viðburðinum.',
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
        messagePlaceholder: 'Send a shout-out, dedication, or crowd moment...',
        takePhotoLabel: 'Take Photo',
        choosePhotoLabel: 'Choose Photo',
        phoneHelpText: 'On phone: tap Take Photo to capture and share instantly to the live feed.',
        submitLabel: 'Post to Feed',
        submitPostingLabel: 'Posting...',
        emptyFeedText: 'No feed posts yet. Start the conversation.',
        warningText: 'All content published in the Live Feed is the responsibility of the user. If the host considers any post inappropriate or unfitting for the event, the user may be blocked from the event.',
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
        messagePlaceholder: copy.messagePlaceholder,
        takePhotoLabel: copy.takePhotoLabel,
        choosePhotoLabel: copy.choosePhotoLabel,
        phoneHelpText: copy.phoneHelpText,
        submitLabel: copy.submitLabel,
        submitPostingLabel: copy.submitPostingLabel,
        emptyFeedText: copy.emptyFeedText,
        warningText: copy.warningText,
      }} />
    </section>
  )
}

export default FeedPage