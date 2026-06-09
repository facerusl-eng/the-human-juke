# Issue Drafts (Sprint 01 P0)

Use these files as copy-paste starters for GitHub Issues.

## Recommended Labels
- priority:P0
- area:admin
- area:reliability
- area:platform
- type:feature
- type:tech-debt

## Suggested Milestone
- Sprint 01 (P0 Reliability)

## Draft List
- [P0-01 Runtime Feature Flags and Telemetry](./P0-01-runtime-feature-flags-and-telemetry.md)
- [P0-02 Pre-gig Health Check](./P0-02-pre-gig-health-check.md)
- [P0-03 Panic Mode](./P0-03-panic-mode.md)
- [P0-04 Queue Snapshots and Restore](./P0-04-queue-snapshots-and-restore.md)
- [P0-05 Realtime Circuit Breaker](./P0-05-realtime-circuit-breaker.md)

## Definition of Done (All P0)
- Feature works on mobile and desktop.
- Recovery behavior does not require hard refresh.
- Build passes.
- Existing Admin, Audience, Mirror flows are not regressed.
- Instrumentation events are emitted for failures and retries.
