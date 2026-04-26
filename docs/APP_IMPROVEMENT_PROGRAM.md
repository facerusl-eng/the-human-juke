# Human Jukebox App Improvement Program

## Goal
Ship all proposed improvements in an execution-safe order while keeping live gigs stable at every step.

## Program Principles
- Protect live operations first: reliability and recovery before growth features.
- Avoid breaking existing host and audience flows.
- Ship behind feature flags when risk is medium or high.
- Keep database changes backward compatible.
- Validate each phase with mobile-first QA and recovery tests.

## Delivery Timeline
- Phase 0: Foundation and safety rails (Week 1)
- Phase 1: Fast wins for host operations (Week 1-2)
- Phase 2: Audience growth and engagement (Week 3-4)
- Phase 3: Host intelligence and workflow acceleration (Week 5-6)
- Phase 4: Reliability hardening and graceful degradation (Week 7-8)
- Phase 5: Mirror and venue experience upgrades (Week 9)
- Phase 6: Monetization and advanced analytics (Week 10-12)

---

## Phase 0: Foundation and Safety Rails

### Objectives
- Add observability and feature gating to safely roll out all upcoming changes.

### Tickets
1. Add app-wide feature flags
- Scope: client-side config and server-validated flags.
- Acceptance:
  - Each new feature can be toggled on or off without redeploy.
  - Flags can be scoped by host id.

2. Add structured error event pipeline
- Scope: classify and capture errors by domain.
- Event categories:
  - auth
  - db
  - realtime
  - ui
  - network
- Acceptance:
  - Errors emitted with severity and context.
  - Runtime error panel can display recent issue summaries for host.

3. Add health telemetry table and retention policy
- Proposed table: app_runtime_events
- Columns:
  - id uuid primary key
  - created_at timestamptz default now()
  - event_type text
  - severity text
  - host_id uuid null
  - event_id uuid null
  - payload jsonb
- Indexes:
  - created_at desc
  - event_type, created_at desc
  - host_id, created_at desc
- Acceptance:
  - Dashboard can query the latest events in less than 200ms at moderate scale.

### Risk
- Low. Mostly additive.

---

## Phase 1: Fast Wins (Operations During Live Gigs)

### Feature 1: Pre-gig Health Check Screen
- Add a host-only page: Admin > Health Check.
- Checks:
  - Supabase connectivity
  - Auth session validity
  - Active gig fetch latency
  - Realtime channel attach status
  - Mirror route availability
  - Audience join link generation
- Acceptance:
  - Green or red status for each check.
  - One tap Retry All.
  - Last successful check timestamp visible.

### Feature 2: Panic Mode
- One tap action to stabilize live room.
- Actions on trigger:
  - Pause requests
  - Enable explicit filter block
  - Optionally lock voting
- Acceptance:
  - Action completes in under 2 seconds for active event.
  - Banner confirms mode enabled.
  - Host can undo with one tap.

### Feature 3: Queue Snapshots and Restore
- Automatically snapshot queue every 3-5 minutes and before destructive actions.
- Manual Restore from snapshot in Admin.
- Proposed table: queue_snapshots
- Columns:
  - id uuid primary key
  - event_id uuid not null
  - created_at timestamptz default now()
  - reason text
  - snapshot jsonb
  - created_by uuid null
- Acceptance:
  - Restore preview shows affected songs count.
  - Restore is transactional.
  - Last 20 snapshots retained per event by policy.

### Feature 4: One tap Share Join Link
- Add share bar in Admin mobile:
  - Copy link
  - Show QR
  - Native share API fallback
- Acceptance:
  - Works on iOS and Android browsers.
  - Fallbacks never leave host without share option.

### Feature 5: Loading Skeletons and Empty States
- Standardize section loading placeholders and actionable empty states.
- Acceptance:
  - No major page appears blank during load.
  - Empty states include next best action.

---

## Phase 2: Audience Growth and Engagement

### Feature 6: Smart Prompts
- Time and queue-aware nudges for audience.
- Examples:
  - 3 songs left
  - requests paused or reopened
- Acceptance:
  - Prompt frequency cap prevents spam.
  - Prompt CTR tracked.

### Feature 7: Loyalty Badges
- Lightweight profile progression by participation.
- Acceptance:
  - Badge updates are idempotent.
  - No impact on queue integrity.

### Feature 8: Request Templates
- Audience can pick common request intents.
- Acceptance:
  - Template selection stored with request metadata.
  - Host sees intent labels in control page.

### Feature 9: Crowd Pulse Widget
- Real-time trending artists or songs.
- Acceptance:
  - Refresh interval does not overload realtime channels.

---

## Phase 3: Host Workflow Intelligence

### Feature 10: Set Flow Modes
- Preset operating modes:
  - Chill
  - Peak
  - Cooldown
- Each mode adjusts voting and request constraints.
- Acceptance:
  - Mode switch applies atomically.
  - Settings are reversible.

### Feature 11: Zone or Table Requests
- Optional venue segmentation for requests.
- Acceptance:
  - Zone labels available in queue display and filtering.

### Feature 12: Queue Auto-clean Tools
- Duplicate and near-duplicate suggestion engine.
- Acceptance:
  - Suggestion confidence threshold configurable.
  - Never auto-delete without host confirmation.

### Feature 13: Now Playing Assistant
- Quick actions:
  - mark played
  - requeue
  - announce next
- Acceptance:
  - One tap path for most frequent host operations.

---

## Phase 4: Reliability Hardening and Graceful Degradation

### Feature 14: Offline Queue for Host Actions
- Client queue for write actions when offline.
- Sync when online with conflict handling.
- Acceptance:
  - Pending operations visible to host.
  - Replay is ordered and idempotent.

### Feature 15: Realtime Circuit Breaker
- Automatically switch from realtime to short polling on repeated failures.
- Acceptance:
  - Recovery back to realtime when healthy.
  - Host gets status banner only when necessary.

### Feature 16: Degradation Profiles
- Keep core flows alive when optional subsystems fail.
- Profiles:
  - core queue only
  - queue plus audience requests
  - full mode
- Acceptance:
  - Hard refresh never required to recover baseline operations.

---

## Phase 5: Mirror Upgrades

### Feature 17: Venue Layout Profiles
- TV, projector, portrait kiosk presets.
- Acceptance:
  - Profile switch under 1 second.

### Feature 18: Burn-in Safe Motion
- Subtle movement for static elements.
- Acceptance:
  - Motion can be disabled globally.

### Feature 19: Crowd Cam Split Mode
- Optional media panel with now-playing details.
- Acceptance:
  - Frame rate remains stable on mid-range hardware.

---

## Phase 6: Monetization and Analytics

### Feature 20: Priority Boost Requests
- Paid queue boost with host approval gate.
- Acceptance:
  - Queue fairness controls in settings.
  - Audit trail for boosted actions.

### Feature 21: Sponsor Slots
- Rotating sponsor content in mirror and audience feed.
- Acceptance:
  - Frequency caps and explicit placement rules.

### Feature 22: Tip-linked Shoutouts
- Optional shoutout after successful tip event.
- Acceptance:
  - Moderation and profanity filtering in place.

### Feature 23: Pro Tier Controls
- Multi-host and advanced analytics.
- Acceptance:
  - Permission boundaries enforced via RLS and role checks.

### Feature 24: Gig Recap Analytics
- Report includes:
  - requests accepted or rejected
  - peak request windows
  - top artists and songs
  - no-show metrics
- Acceptance:
  - Report generated in under 3 seconds for typical gig size.

---

## Data and Schema Workstream

## New or Updated Tables
- app_runtime_events
- queue_snapshots
- audience_prompts_log
- loyalty_progress
- request_templates
- venue_zones
- monetization_events
- gig_analytics_rollups

## Database Best Practices
- Use partial indexes for high-selectivity active rows.
- Prefer additive migrations before destructive cleanup.
- Keep writes idempotent for retries and offline replay.
- Add RLS policies for each new table before enabling UI paths.
- Use pagination and bounded query windows for analytics reads.

## Suggested Migration Batches
1. Observability and snapshots
2. Growth metadata
3. Reliability and offline queue metadata
4. Monetization and analytics rollups

---

## Frontend Workstream

## Shared Components to Add
- HealthCheckCard
- RecoveryBanner
- RetryPanel
- SnapshotRestoreDialog
- ShareLinkSheet
- LiveStripConfigSheet

## App-level Services to Add
- runtimeHealthService
- queueSnapshotService
- circuitBreakerService
- offlineActionQueueService
- analyticsService

---

## QA and Release Strategy

## Test Tracks per Phase
- Unit tests for services and reducers.
- Integration tests for queue mutation flows.
- Mobile interaction tests for one-hand controls.
- Recovery tests:
  - forced network drop
  - channel attach failure
  - delayed data load
- Rollback test before each production release.

## Rollout Strategy
- Start with 5 to 10 percent host cohort.
- Monitor error and latency thresholds.
- Expand to 50 percent, then 100 percent.

## Core SLO Targets
- Admin home interactive under 1.5s on warm load.
- Critical host actions under 800ms median.
- Recovery from realtime failure under 6s.
- No hard refresh requirement for baseline operations.

---

## Team Execution Board (Ready to Create as Issues)

## Priority P0
- P0-01 Feature flags and runtime event logging
- P0-02 Pre-gig health check
- P0-03 Panic mode
- P0-04 Queue snapshots and restore
- P0-05 Realtime circuit breaker

## Priority P1
- P1-01 Share join link bar and QR improvements
- P1-02 Audience prompts engine
- P1-03 Set flow modes
- P1-04 Queue duplicate suggestions
- P1-05 Gig recap analytics

## Priority P2
- P2-01 Loyalty and templates
- P2-02 Venue zoning
- P2-03 Monetization features
- P2-04 Mirror split mode and advanced layouts

---

## Immediate Next 7 Days (Concrete Build Sequence)
1. Add P0-01 migrations and runtime event client utility.
2. Implement health check page and check runners.
3. Implement panic mode action with undo and banner.
4. Implement queue snapshot creation and restore dialog.
5. Add circuit breaker in queue subscriptions with fallback polling.
6. Run mobile QA matrix and chaos tests.
7. Release behind feature flags to pilot hosts.

---

## Definition of Done
- Feature behind flag (if risky).
- No regression in existing gig flow.
- Build and lint pass.
- Recovery scenarios tested and documented.
- Telemetry dashboard updated.
- Rollback plan confirmed.
