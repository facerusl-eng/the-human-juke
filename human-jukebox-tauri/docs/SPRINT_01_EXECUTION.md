# Sprint 01 Execution Plan (P0)

## Sprint Objective
Deliver high-confidence operational stability features for live gigs.

## Duration
- 7 working days

## Tickets

### P0-01 Runtime Feature Flags and Error Telemetry
- Owner: Full-stack
- Estimate: 1 day
- Deliverables:
  - Feature flag utility
  - Runtime event logger
  - app_runtime_events migration
- Acceptance:
  - Flags can toggle Panic Mode and Health Check page.
  - Runtime events can be viewed for last 24 hours.

### P0-02 Pre-gig Health Check
- Owner: Frontend + Platform
- Estimate: 1.5 days
- Deliverables:
  - Admin health check page
  - check runners for db, auth, realtime, mirror, audience
- Acceptance:
  - Check statuses show pass or fail with retry.

### P0-03 Panic Mode
- Owner: Frontend + State
- Estimate: 1 day
- Deliverables:
  - Panic action button
  - Undo panic action
  - confirmation banner
- Acceptance:
  - Room pause + explicit block complete in one action.

### P0-04 Queue Snapshots and Restore
- Owner: Full-stack
- Estimate: 2 days
- Deliverables:
  - queue_snapshots table + policies
  - snapshot creation hooks
  - restore dialog with preview
- Acceptance:
  - Restore rehydrates queue atomically.

### P0-05 Realtime Circuit Breaker
- Owner: State + Infra
- Estimate: 1.5 days
- Deliverables:
  - Detect repeated realtime attach failures
  - fallback polling mode
  - auto-recover to realtime
- Acceptance:
  - No hard refresh needed after realtime instability.

## QA Checklist
- Simulate offline and reconnect.
- Simulate realtime channel timeout.
- Simulate slow query latency over 10 seconds.
- Verify panic mode undo returns previous settings.
- Validate mobile usability on small screens.

## Release Gate
- All P0 acceptance criteria pass.
- No critical regressions in Admin, Audience, Mirror flows.
- Feature flags allow emergency disable.
