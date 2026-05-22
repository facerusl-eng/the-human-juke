import './App.css'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import LibraryPage from './pages/LibraryPage'
import SetlistsPage from './pages/SetlistsPage'
import LiveConsolePage from './pages/LiveConsolePage'

function App() {
  const capabilityCards = [
    {
      title: 'Live Ops Console',
      copy: 'One-screen control for go-live, break, recovery, and emergency fallback with large stage-safe actions.',
      tone: 'capability-card-ops',
    },
    {
      title: 'Audience Conversion Engine',
      copy: 'QR landing optimized for first-time guests with zero-confusion join flow and faster song request activation.',
      tone: 'capability-card-convert',
    },
    {
      title: 'Mirror Broadcast Pro',
      copy: 'Distance-readable layouts and scan-safe QR presets tuned for venue displays from 3 to 6 meters.',
      tone: 'capability-card-mirror',
    },
  ]

  const sprintItems = [
    {
      label: 'Sprint 1',
      title: 'Core Surface Upgrade',
      detail: 'Rebuild gig control shell, modern audience onboarding, and resilient pre-show countdown states.',
    },
    {
      label: 'Sprint 2',
      title: 'Reliability + Recovery',
      detail: 'Realtime drift guards, offline fallback UX, and one-tap session recovery for host devices.',
    },
    {
      label: 'Sprint 3',
      title: 'Growth + Analytics',
      detail: 'Scan-to-join funnel telemetry, request completion metrics, and retention loops for repeat audiences.',
    },
  ]

  return (
    <BrowserRouter>
      <div className="app-shell-next">
        <nav className="top-nav" aria-label="Primary">
          <p className="brand-mark">HJ Next</p>
          <div className="nav-links">
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/library">Library</NavLink>
            <NavLink to="/setlists">Setlists</NavLink>
            <NavLink to="/live-console">Live Console</NavLink>
          </div>
        </nav>

        <Routes>
          <Route path="/" element={<OverviewPage capabilityCards={capabilityCards} sprintItems={sprintItems} />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/setlists" element={<SetlistsPage />} />
          <Route path="/live-console" element={<LiveConsolePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

type CapabilityCard = {
  title: string
  copy: string
  tone: string
}

type SprintItem = {
  label: string
  title: string
  detail: string
}

type OverviewPageProps = {
  capabilityCards: CapabilityCard[]
  sprintItems: SprintItem[]
}

function OverviewPage({ capabilityCards, sprintItems }: OverviewPageProps) {
  return (
    <>
      <header className="hero-next" aria-label="Next-gen Human Jukebox">
        <p className="hero-kicker">Human Jukebox Next</p>
        <h1>Build The Stage OS, Not Just The Song Queue</h1>
        <p className="hero-subcopy">
          A separate, clean-slate app focused on performance reliability, rapid host control,
          and audience experiences that convert in seconds.
        </p>
        <div className="hero-cta-row">
          <button type="button" className="primary-cta">Start Sprint 1</button>
          <button type="button" className="ghost-cta">Open Product Brief</button>
        </div>
        <div className="hero-metrics" role="list" aria-label="Readiness metrics">
          <article role="listitem" className="metric-card">
            <p className="metric-value">99.95%</p>
            <p className="metric-label">Target show uptime</p>
          </article>
          <article role="listitem" className="metric-card">
            <p className="metric-value">&lt; 2 taps</p>
            <p className="metric-label">Audience join path</p>
          </article>
          <article role="listitem" className="metric-card">
            <p className="metric-value">4-6m</p>
            <p className="metric-label">Reliable QR scan distance</p>
          </article>
        </div>
      </header>

      <section className="capabilities-grid" aria-label="Core capability pillars">
        {capabilityCards.map((card) => (
          <article key={card.title} className={`capability-card ${card.tone}`}>
            <h2>{card.title}</h2>
            <p>{card.copy}</p>
          </article>
        ))}
      </section>

      <section className="sprint-track" aria-label="Delivery roadmap">
        <div className="section-head">
          <p className="section-kicker">Delivery Plan</p>
          <h2>Three Sprints To A Production-Ready Stage Platform</h2>
        </div>
        <div className="sprint-list" role="list">
          {sprintItems.map((item) => (
            <article key={item.label} className="sprint-item" role="listitem">
              <p className="sprint-label">{item.label}</p>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

export default App
