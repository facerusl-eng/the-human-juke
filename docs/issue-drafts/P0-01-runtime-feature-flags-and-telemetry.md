# P0-01 Runtime Feature Flags and Telemetry

## Summary
Add runtime feature flags and structured telemetry events to safely roll out reliability features and quickly diagnose failures during gigs.

## Problem
New reliability features need controlled rollout and immediate observability. Right now, disabling risky functionality quickly and diagnosing failures is harder than it should be.

## Scope
- Add feature flag utility on client.
- Add runtime event logger utility.
- Add database table for telemetry events.
- Add minimal Admin view or debug retrieval path for latest events.

## Deliverables
- Feature flag reader API (host-scoped support).
- Runtime event emit API with typed event categories.
- Migration for app_runtime_events.
- Read path for recent events (last 24h).

## Event Model
- event_type: auth | db | realtime | ui | network
- severity: info | warning | error | critical
- payload: json details
- host_id: optional
- event_id: optional

## Acceptance Criteria
- Feature flags can enable or disable Panic Mode and Health Check without redeploy.
- Telemetry events are persisted with timestamp and severity.
- Querying latest events by host is fast for moderate volume.
- Telemetry writes never block critical UI interactions.

## Technical Notes
- Add indexes:
  - created_at desc
  - event_type + created_at desc
  - host_id + created_at desc
- Keep writes additive and idempotent where possible.
- Prefer non-blocking fire-and-forget telemetry with error swallow and console warning.

## Test Plan
- Unit tests for feature flag fallback behavior.
- Unit tests for logger payload validation.
- Integration test for event persistence.
- Failure test: logger unavailable should not break page interactions.

## Labels
- priority:P0
- area:platform
- area:reliability
- type:feature

## Dependencies
- None

## Estimate
- 1 day
