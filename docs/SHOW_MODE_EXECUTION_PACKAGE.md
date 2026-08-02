# Show Mode Execution Package

## Status
- Linked spec: `docs/SHOW_MODE_FEATURE_SPEC.md`
- Purpose: convert approved feature spec into implementation sequence
- Last updated: 2026-08-02

## 1. Database Migration Plan

### 1.1 Migration Strategy
- Use additive, backward-compatible migrations.
- Enable tables and RLS first, then optional indexes and quality-of-life constraints.
- Gate all new reads/writes behind feature flags until all migrations are applied.

### 1.2 Proposed Migration Files
1. `supabase-migration-show-mode-001-core-projects.sql`
2. `supabase-migration-show-mode-002-songs-assets.sql`
3. `supabase-migration-show-mode-003-lyrics-cues-popups.sql`
4. `supabase-migration-show-mode-004-footswitch-singers.sql`
5. `supabase-migration-show-mode-005-analytics-indexes.sql`
6. `supabase-migration-show-mode-006-rls-policies.sql`

### 1.3 Migration Contents

#### 001 Core Projects
- Create `show_projects` table.
- Add status/mode check constraints.
- Add `created_at`, `updated_at` defaults.

#### 002 Songs + Assets
- Create `show_songs` table with `position` ordering.
- Create `song_assets` table with `asset_type` enum-like check.
- Add FK cascade from project -> songs -> assets where appropriate.

#### 003 Lyrics + Cues + Popups
- Create `lyric_sections`.
- Create `show_cues`.
- Create `popup_messages`.
- Add basic validation constraints (`start_ms >= 0`, `duration_ms > 0`).

#### 004 Footswitch + Singers
- Create `footswitch_profiles`.
- Create `show_singer_queue`.
- Add unique partial index for default profile per host.

#### 005 Analytics + Indexes
- Create `show_analytics`.
- Add performance indexes:
  - `show_songs(show_project_id, position)`
  - `lyric_sections(show_song_id, order_index)`
  - `show_cues(show_song_id, trigger_type)`
  - `popup_messages(show_project_id, show_song_id, enabled)`

#### 006 RLS Policies
- Enable RLS on all Show Mode tables.
- Host owner full CRUD on own projects.
- Stage manager scoped update permissions.
- Audience read-only policy for approved audience feed projections.

### 1.4 Rollout Order
1. Apply all six migrations to staging.
2. Verify constraints + RLS with policy tests.
3. Deploy app code with feature flags disabled by default.
4. Enable flags for internal rehearsal accounts only.
5. Expand rollout to pilot hosts.
6. Enable generally after pilot success criteria pass.

### 1.5 Rollback Plan
- Feature-level rollback by disabling flags.
- Data-level rollback avoids destructive down migrations during live periods.
- If schema hotfix is needed, apply forward-only corrective migration.

## 2. Sprint 1 Ticket Breakdown

Sprint goal:
- Deliver Show Mode foundation with safe CRUD + import skeleton + playable local rehearsal prototype.

Duration:
- 7 working days.

### Ticket SM-01: Core Schema + RLS
- Scope:
  - Implement migrations 001 and 006 minimal subset.
  - Add policy tests.
- Acceptance:
  - Host can create and read own show project.
  - Non-owner cannot read project.

### Ticket SM-02: Show Project CRUD API
- Scope:
  - `POST /api/show-projects`
  - `GET /api/show-projects/:id`
  - `PATCH /api/show-projects/:id`
  - `POST /api/show-projects/:id/archive`
- Acceptance:
  - Validation errors are explicit.
  - Status transitions follow state rules.

### Ticket SM-03: Setlist and Song Ordering
- Scope:
  - Implement `show_songs` CRUD.
  - Add reorder endpoint with transaction safety.
- Acceptance:
  - Reorder operations are atomic and stable under rapid updates.

### Ticket SM-04: Import Adapter Framework
- Scope:
  - Add parser adapters for CSV and JSON first.
  - Stage Traxx adapter scaffold with field mapper.
  - Normalize input into common import DTO.
- Acceptance:
  - Mixed sources map to same internal song format.

### Ticket SM-05: Rehearsal Playback Skeleton
- Scope:
  - Build playback state machine (`unloaded -> preloading -> ready -> playing`).
  - Add local song start/pause/stop.
  - Stub waveform marker API.
- Acceptance:
  - First song in setlist can be played and paused from Show Mode UI.

### Ticket SM-06: Lyrics Section Prototype
- Scope:
  - Store section metadata.
  - Render section blocks with next/previous controls.
- Acceptance:
  - Operator can step through verse/chorus/bridge sections in Rehearsal Mode.

### Ticket SM-07: Feature Flag Plumbing
- Scope:
  - Add Show Mode flags (see section 3).
  - Add host-scoped flag evaluation.
- Acceptance:
  - Entire Show Mode route can be disabled instantly.

### Ticket SM-08: QA + Release Gate
- Scope:
  - Unit tests for import mapping and state transitions.
  - Integration tests for project and song CRUD.
  - Manual checklist for rehearsal flow.
- Acceptance:
  - All sprint tests pass.
  - No regressions in existing host/audience routes.

## 3. Feature-Flag Map

### 3.1 Principles
- Default OFF in production.
- Host-scoped activation for pilot rollout.
- Hard kill-switch for any live instability.

### 3.2 Flag Catalog
1. `show_mode_enabled`
  - Controls full Show Mode route/module visibility.

2. `show_mode_project_crud_enabled`
  - Enables project creation/editing endpoints and UI.

3. `show_mode_import_enabled`
  - Enables CSV/JSON/Stage Traxx import pipeline.

4. `show_mode_playback_engine_enabled`
  - Enables backing-track playback engine in Show Mode.

5. `show_mode_lyrics_engine_enabled`
  - Enables sectioning/navigation lyric UI.

6. `show_mode_visual_engine_enabled`
  - Enables image/video visuals and transitions.

7. `show_mode_dual_screen_enabled`
  - Enables performer/audience split rendering.

8. `show_mode_footswitch_enabled`
  - Enables hardware and mapping controls.

9. `show_mode_live_lock_enabled`
  - Enables Live Mode lock/safety behavior.

10. `show_mode_popup_enabled`
  - Enables MTV Pop-Up message system.

11. `show_mode_smart_flow_enabled`
  - Enables smart setlist ranking suggestions.

12. `show_mode_singer_tools_enabled`
  - Enables singer queue/profile workflow.

13. `show_mode_analytics_enabled`
  - Enables post-show analytics collection/view.

14. `show_mode_cloud_sync_enabled`
  - Enables cross-device sync and backup workflows.

### 3.3 Safe Rollout Matrix
- Internal dev hosts:
  - Flags 1-7 ON, others OFF.
- Pilot hosts:
  - Flags 1-10 ON, 11-14 staged gradually.
- General availability:
  - All flags ON except experimental features.

### 3.4 Emergency Disable Sequence
1. Disable `show_mode_playback_engine_enabled` if audio path instability appears.
2. Disable `show_mode_live_lock_enabled` only if lock logic blocks recovery controls.
3. Disable `show_mode_enabled` for complete rollback.

## 4. Dependencies and Ownership

### Engineering Dependencies
- Supabase migrations and policy test harness.
- Audio pipeline utilities (normalization/marker generation).
- Shared route/state architecture across root, web, and tauri variants.

### Suggested Owners
- Platform: migrations, RLS, flags, observability.
- Frontend: Show Mode UI, lyrics/visual engine, dual-screen UX.
- Audio: playback engine, normalization, fade safety.
- QA: rehearsal/live checklists and regression suite.

## 5. Exit Criteria For Sprint 1
- Project CRUD is production-safe behind flags.
- At least one imported song can be loaded and rehearsed in prototype flow.
- Security policies verified for owner and non-owner access.
- Rollback path validated via flag toggles.

## 6. Production Readiness Track

### 6.1 Workstream PR-01: Safety Envelope Implementation
- Deliverables:
  - local emergency command path independent of network
  - Safe Degraded Mode fallback UI and control set
  - emergency SLA telemetry (`trigger_ts`, `action_ts`, `elapsed_ms`)
- Exit criteria:
  - emergency stop/fade under 100ms p95 on target hardware

### 6.2 Workstream PR-02: Hardware Qualification Matrix
- Deliverables:
  - tested device matrix document (audio, footswitch, displays)
  - compatibility labels in settings UI (`tested`, `experimental`, `unsupported`)
  - first-run calibration flow for footswitch latency
- Exit criteria:
  - minimum supported device list published before pilot expansion

### 6.3 Workstream PR-03: Audio Pipeline Contract
- Deliverables:
  - enforce default loudness and peak ceilings
  - click track routing safety guard
  - transpose quality mode toggle (rehearsal/live)
- Exit criteria:
  - all imported audio validated against loudness/peak contract

### 6.4 Workstream PR-04: Runbooks and Incident Flow
- Deliverables:
  - pre-show checklist
  - live incident decision tree
  - post-show review checklist
  - operator quick-reference card
- Exit criteria:
  - runbooks exercised in at least 3 simulation sessions

### 6.5 Workstream PR-05: Soak and Stress Test Program
- Required tests:
  - 2-hour rehearsal soak
  - 4-hour live soak
  - 50+ rapid transition stress pass
  - disconnect/reconnect drills for network/audio/footswitch/display
- Exit criteria:
  - no critical failures; recovery path proven for each failure class

## 7. Auto-Disable Guardrails

### 7.1 Telemetry Thresholds
Auto-disable affected feature flags when any threshold is exceeded:
- `audio_command_timeout_rate > 1%` (15-minute rolling window)
- `cue_drift_p95_ms > 250`
- `popup_trigger_failure_rate > 3%`
- `critical_playback_errors >= 3` per session

### 7.2 Flag Response Mapping
- Audio instability -> disable `show_mode_playback_engine_enabled` for impacted host.
- Cue drift instability -> disable `show_mode_popup_enabled` and `show_mode_smart_flow_enabled` for impacted host.
- Persistent failures -> disable `show_mode_enabled` and force Safe Degraded Mode availability.

## 8. Security and Privacy Readiness
- Add policy tests for performer/stage-manager/audience role boundaries.
- Add singer profile retention configuration and deletion workflow validation.
- Verify live override actions generate immutable audit records.

## 9. Release Scorecard (Pilot -> GA)

### 9.1 Mandatory Pass Metrics
- 10 full live pilot sessions with zero critical incidents.
- Emergency command SLA passes p95 and p99 budgets.
- Existing host/audience/mirror flows have zero critical and zero high regressions.
- RLS policy suite fully green in CI and staging.

### 9.2 GA Decision Rule
- GA is approved only when all mandatory pass metrics are green.
- Any red metric blocks GA and triggers remediation sprint.