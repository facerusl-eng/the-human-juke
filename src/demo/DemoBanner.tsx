/**
 * DemoBanner — a fixed top bar shown in demo mode so users always know
 * they are in a simulated environment with no real data.
 */
export function DemoBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="demo-banner"
    >
      🎉 DEMO MODE — This is a simulated event. No real data is read or written.
    </div>
  )
}
