# P0-05 Realtime Circuit Breaker

## Summary
Add automatic fallback from realtime subscriptions to short polling when repeated channel failures occur, and recover back to realtime when healthy.

## Problem
Realtime instability can leave screens stale. We need automatic degradation and self-recovery with no hard refresh.

## Scope
- Detect repeated realtime failures per session.
- Switch to polling fallback mode.
- Periodically test realtime health and switch back automatically.
- Surface connection status minimally in UI.

## Deliverables
- Circuit breaker service/state.
- Polling fallback path for queue/event refresh.
- Realtime health probe and auto-recover logic.
- Status banner component for degraded connection.

## Acceptance Criteria
- After repeated realtime failures, polling fallback activates automatically.
- Core queue operations remain functional during fallback.
- When realtime is healthy again, app returns to realtime without reload.
- Status message is clear but non-intrusive.

## Technical Notes
- Use bounded retry with backoff.
- Avoid duplicate refresh storms while switching modes.
- Emit telemetry for mode transitions.

## Test Plan
- Force CHANNEL_ERROR and TIMED_OUT repeatedly.
- Validate automatic switch to polling.
- Restore network and validate switch back to realtime.
- Verify no duplicate or conflicting subscriptions remain.

## Labels
- priority:P0
- area:reliability
- area:state
- type:feature

## Dependencies
- P0-01 feature flags and telemetry

## Estimate
- 1.5 days
