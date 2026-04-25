import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import LiveFeedPanel from '../components/LiveFeedPanel'
import { commitAudienceName, readCommittedAudienceName } from '../lib/audienceIdentity'

function FeedPage() {
  const [nameInput, setNameInput] = useState('')
  const [nameCommitted, setNameCommitted] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    const storedName = readCommittedAudienceName()

    if (storedName) {
      setNameCommitted(storedName)
      setNameInput(storedName)
    }
  }, [])

  const onCommitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedName = nameInput.trim()

    if (!normalizedName) {
      setNameError('Please enter your name before continuing.')
      return
    }

    setNameError(null)
    commitAudienceName(normalizedName)
    setNameCommitted(normalizedName)
  }

  if (!nameCommitted) {
    return (
      <section className="audience-entry-shell" aria-label="Feed entry">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow">Audience Feed</p>
          <h1>Enter your name to continue</h1>
          <p className="subcopy audience-entry-copy">This feed is for the active audience. Set your name first to join in.</p>
          <form className="queue-form audience-entry-form" onSubmit={onCommitName}>
            <div className="field-row">
              <label htmlFor="feed-entry-name">Your name</label>
              <input
                id="feed-entry-name"
                value={nameInput}
                onChange={(nextEvent) => {
                  setNameInput(nextEvent.target.value)
                  if (nameError) {
                    setNameError(null)
                  }
                }}
                placeholder="Your name"
                maxLength={40}
                autoFocus
                required
              />
            </div>
            {nameError ? <p className="error-text">{nameError}</p> : null}
            <button type="submit" className="primary-button">Continue to Feed</button>
          </form>
        </article>
      </section>
    )
  }

  return (
    <section className="feed-page-shell" aria-label="Feed page">
      <div className="feed-page-actions">
        <Link to="/audience" className="secondary-button feed-back-button">
          Back to Audience
        </Link>
      </div>
      <LiveFeedPanel mode="page" title="Audience Feed" />
    </section>
  )
}

export default FeedPage