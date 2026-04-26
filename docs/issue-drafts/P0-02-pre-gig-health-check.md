# P0-02 Pre-gig Health Check

## Summary
Create a host-only Pre-gig Health Check page to validate critical systems before a live show.

## Problem
Hosts need confidence that auth, data, realtime, mirror, and audience access are healthy before going live.

## Scope
- Add Admin page: Health Check.
- Add checks for:
  - Supabase connectivity
  - Session validity
  - Active gig load
  - Realtime subscription attach
  - Mirror route open
  - Audience join URL generation
- Add Retry All action.

## Deliverables
- Health check UI card list with pass/fail states.
- Per-check run duration and status text.
- Last successful full check timestamp.
- Retry action for single check and all checks.

## Acceptance Criteria
- Every check shows green or red with actionable detail.
- Retry All re-runs all checks without page reload.
- Failures show clear next actions.
- Works well on mobile controls layout.

## Technical Notes
- Use timeout wrappers for each async check.
- Catch and classify all errors into telemetry categories.
- Keep check routines isolated so one failure does not block others.

## Test Plan
- Simulate network offline.
- Simulate expired session.
- Simulate realtime attach failure.
- Validate recovery after reconnect.

## Labels
- priority:P0
- area:admin
- area:reliability
- type:feature

## Dependencies
- P0-01 feature flags and telemetry

## Estimate
- 1.5 days
