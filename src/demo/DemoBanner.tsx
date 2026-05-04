/**
 * DemoBanner — a fixed top bar shown in demo mode so users always know
 * they are in a simulated environment with no real data.
 */
export function DemoBanner() {
  const exitDemo = () => {
    window.location.href = '/'
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="demo-banner"
    >
      <span>🎉 DEMO MODE — This is a simulated event. No real data is read or written.</span>
      <button
        type="button"
        className="demo-banner-exit"
        onClick={exitDemo}
        aria-label="Exit demo and return to home"
      >
        ✕ Exit demo
      </button>
    </div>
  )
}
