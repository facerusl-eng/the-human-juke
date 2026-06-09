# P0-03 Panic Mode

## Summary
Add one-tap Panic Mode to immediately stabilize the live room.

## Problem
During chaotic moments, hosts need an instant safety action without digging through multiple settings.

## Scope
- Add Panic Mode action in Admin controls.
- Panic Mode should:
  - Pause requests
  - Enable explicit filter block
  - Optionally lock voting (flagged behavior)
- Add undo action and status banner.

## Deliverables
- Panic button with confirmation state.
- Undo panic action.
- Visible status indicator on Admin home and control pages.

## Acceptance Criteria
- Panic action completes in one interaction.
- Status updates propagate to all relevant pages.
- Undo restores previous state safely.
- Errors show retry options and do not freeze UI.

## Technical Notes
- Persist previous values for undo.
- Use idempotent updates.
- Emit telemetry events for trigger and rollback.

## Test Plan
- Trigger panic while queue is active.
- Trigger panic with intermittent connectivity.
- Undo after reconnect.
- Validate audience screen behavior updates.

## Labels
- priority:P0
- area:admin
- area:reliability
- type:feature

## Dependencies
- P0-01 feature flags and telemetry

## Estimate
- 1 day
