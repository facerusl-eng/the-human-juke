# P0-04 Queue Snapshots and Restore

## Summary
Implement periodic queue snapshots and one-tap restore to recover from accidental queue damage.

## Problem
Hosts need safe rollback for queue state during live gigs without manual reconstruction.

## Scope
- Add queue_snapshots table and policies.
- Capture snapshots:
  - Every 3-5 minutes
  - Before destructive queue operations
- Add snapshot restore dialog with impact preview.

## Deliverables
- Migration and policies for queue_snapshots.
- Snapshot creation service.
- Restore workflow UI in Admin.
- Retention policy (latest N snapshots per event).

## Acceptance Criteria
- Snapshot creation does not block host actions.
- Restore is transactional and consistent.
- Preview clearly shows number of affected entries.
- Host can safely cancel before restore.

## Technical Notes
- Store queue payload as jsonb with version marker.
- Index event_id + created_at desc.
- Use row-level security to restrict access to host/event ownership.

## Test Plan
- Create snapshots under load.
- Restore from most recent and older snapshot.
- Validate queue ordering and vote counts post-restore.
- Validate retention cleanup behavior.

## Labels
- priority:P0
- area:admin
- area:reliability
- type:feature

## Dependencies
- P0-01 feature flags and telemetry

## Estimate
- 2 days
