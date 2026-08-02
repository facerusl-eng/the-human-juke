# Human Jukebox Show Mode Feature Specification

## Status
- Draft: Implementation-ready baseline
- Owner: Product + Engineering
- Last updated: 2026-08-02

## 1. Purpose
Show Mode turns Human Jukebox into a complete live concert assistant that can run an entire performance with minimal manual intervention. It combines backing-track playback, lyric guidance, visuals, footswitch operations, setlist flow intelligence, and optional on-screen MTV-style pop-up messages.

Primary objective:
- Keep the performer hands-free and safe during live operation.

Secondary objectives:
- Reduce setup friction before shows.
- Improve consistency from rehearsal to live performance.
- Capture post-show analytics for continuous improvement.

## 2. Scope

### In Scope (v1-v3)
- Show project creation and management.
- Multi-format song import and normalization pipeline.
- Backing-track playback with safety controls.
- Lyrics presentation with section navigation.
- Visual engine for images/video with transitions.
- Footswitch mapping and mode-aware controls.
- Live dashboard with auto-flow to next song.
- MTV Pop-Up Mode (manual and timed triggers).
- Smart setlist suggestions.
- Singer queue and profile basics.
- Dual-screen performer/audience output.
- Song notes, cues, and post-show analytics.
- Cloud sync, backup, and offline-resilient behavior.

### Out of Scope (initial release)
- Full DAW-grade mixing.
- Live pitch-correction and vocal effects.
- Third-party marketplace for plugins.
- Fully autonomous AI decisions without manual override.

## 3. User Roles
- Performer: Runs show from performer screen and footswitch.
- Stage Manager (optional): Controls notes, popups, emergency actions.
- Singer (karaoke/mixed mode): Uses queue and countdown tools.
- Audience: Receives visuals/lyrics on audience screen.

## 4. Core Concepts
- Show Project: Concert-level container with setlist and assets.
- Song Package: Song metadata + audio + lyrics + optional visuals.
- Mode: Rehearsal Mode or Live Mode.
- Cue: Timestamped or manual trigger for actions/messages.
- Scene: Current visual + lyric + audio state for a song.

## 5. Functional Requirements

### 5.1 Project Structure
Show Mode adds a project type named "Concert/Show" with lifecycle:
1. Create Concert/Show.
2. Import setlist.
3. Attach songs and assets.
4. Rehearse.
5. Run live.
6. Save analytics and logs.

Each show project stores:
- Concert name.
- Venue and date/time.
- Song order.
- Backing tracks.
- Lyrics and section metadata.
- Visual assets.
- Footswitch mapping profile.
- Notes, cues, and popup definitions.

### 5.2 Song Import
Accepted sources:
- CSV.
- JSON.
- Stage Traxx export.
- Internal Human Jukebox catalog.

Per-song fields:
- Title.
- Artist.
- BPM.
- Key.
- Backing track file.
- Lyrics file.
- Optional visuals.

Auto-processing pipeline:
1. Normalize audio loudness to target LUFS.
2. Add configurable count-in (default 2 bars).
3. Trim leading/trailing silence with guard threshold.
4. Build waveform + marker map.
5. Sync lyrics to timeline.
6. Generate lyric sections: verse, chorus, bridge, outro.
7. Prepare visual cards and optional video previews.

### 5.3 Backing Track Integration
Supported formats:
- WAV.
- MP3.
- Stems (multi-track bundle).

Playback features:
- Volume normalization.
- Peak protection limiter.
- Optional click track bus.
- Song markers.
- Smooth fade-in and fade-out.
- Emergency fade-out.

### 5.4 Lyrics System
Lyrics UI requirements:
- High-contrast display.
- Large, readable typography.
- Smooth section transitions.
- Footswitch section navigation.
- Dual-screen routing (performer + audience).

Behavior:
- Auto-advance by timeline in Live Mode.
- Manual step-through in Rehearsal Mode.
- Instant jump actions (chorus/bridge/custom marker).

### 5.5 Visuals Engine
Per-song visual asset types:
- Background image.
- Artist photo.
- Album art.
- Video loop.
- Custom media set.

Visual controls:
- Fullscreen audience mode.
- Fade transitions.
- Auto-change at song start/cue points.
- Manual override at any time.

### 5.6 Footswitch Control
Supported actions:
- Start/pause track.
- Next/previous song.
- Next/previous lyric section.
- Jump to chorus.
- Fade out.
- Emergency stop.

Mode behavior:
- Rehearsal Mode: permissive, step-focused, slower timing.
- Live Mode: locked/safe mode to avoid accidental destructive actions.

### 5.7 Live Concert Assistant Dashboard
Required live widgets:
- Current song.
- Next song.
- Show timer.
- BPM.
- Key.
- Waveform with markers.
- Current lyric section.
- Visual preview/state.

Auto-flow behaviors:
- Preload next song assets.
- Preload next lyrics sections.
- Preload next visuals.
- Perform safe transition checks before cross-song change.

### 5.8 MTV Pop-Up Mode
Popup use cases:
- Fun facts.
- Crowd interaction prompts.
- Singer info.
- Announcements.
- Sponsor messages.

Popup capabilities:
- Song-scoped or show-global messages.
- Timing controls (absolute, relative, marker-based).
- Animation style presets.
- Screen position presets.
- Manual trigger or auto-trigger.
- Optional footswitch trigger mapping.

### 5.9 Smart Setlist Flow
Analysis factors:
- Energy level.
- BPM transitions.
- Key compatibility.
- Manual crowd reaction input.

Output:
- Suggested next song ranking.
- Confidence score.
- Explanation (for operator trust).

### 5.10 Singer Interaction Tools
For karaoke/mixed mode:
- Singer queue.
- Singer profile (range, preferred songs).
- Singer history.
- Auto-transpose request for backing tracks.
- Countdown timer before stage entry.

### 5.11 Dual-Screen Mode
Performer screen includes:
- Playback controls.
- Waveform and markers.
- Notes/cues.
- Popup control panel.

Audience screen includes:
- Lyrics.
- Visuals.
- Popups.

### 5.12 Notes and Cues
Each song can store:
- Personal notes.
- Cue markers.
- Auto-cue popups.

Cue triggers:
- Timeline.
- Marker.
- Manual (tap/footswitch).

### 5.13 Performance Analytics
Post-show analytics include:
- Song performance stats.
- Crowd reaction score timeline.
- Timing deviations and transition latency logs.
- Singer-specific stats.

### 5.14 Cloud Sync and Backup
- Cloud backup of projects and metadata.
- Multi-device sync for performer/stage manager setups.
- Offline-capable operation with deferred sync.

### 5.15 Future-Proof Plugin System
Plugin extension points (future):
- Audio effects.
- Visualizers.
- AI lyric sync.
- AI vocal guide track.

## 6. Non-Functional Requirements

### 6.1 Reliability and Safety
- No hard dependency on network during active song playback.
- Emergency stop path must always be local and immediate.
- Fail-safe fallback to manual controls when automation errors occur.

### 6.2 Performance Targets
- Project load under 2.0s for cached medium show (up to 40 songs).
- Song-to-song transition prep under 500ms after preload.
- UI command response under 100ms on target hardware.
- Audio underrun rate effectively zero in nominal conditions.

### 6.3 Availability Targets
- Rehearsal sessions: >= 99.5% operational continuity.
- Live sessions: >= 99.9% operational continuity.

### 6.4 Security and Access
- Role-based access for performer/stage manager controls.
- Project-level write locks during Live Mode (except approved actions).
- Audit trail for destructive actions and emergency commands.

## 7. Proposed Data Model (Supabase)

### 7.1 Core Tables
- `show_projects`
  - `id uuid pk`
  - `host_id uuid`
  - `name text`
  - `venue text`
  - `show_date timestamptz`
  - `mode text` (`rehearsal|live`)
  - `status text` (`draft|ready|in_progress|completed|archived`)
  - `created_at timestamptz`
  - `updated_at timestamptz`

- `show_songs`
  - `id uuid pk`
  - `show_project_id uuid fk -> show_projects`
  - `library_song_id uuid null`
  - `position int`
  - `title text`
  - `artist text`
  - `bpm numeric`
  - `musical_key text`
  - `energy_score int null`
  - `created_at timestamptz`

- `song_assets`
  - `id uuid pk`
  - `show_song_id uuid fk -> show_songs`
  - `asset_type text` (`backing|lyrics|image|video|art|click|stem`)
  - `storage_path text`
  - `checksum text`
  - `duration_ms int null`
  - `metadata jsonb`
  - `created_at timestamptz`

- `lyric_sections`
  - `id uuid pk`
  - `show_song_id uuid fk -> show_songs`
  - `section_type text` (`verse|chorus|bridge|outro|custom`)
  - `label text`
  - `start_ms int`
  - `end_ms int`
  - `order_index int`

- `show_cues`
  - `id uuid pk`
  - `show_song_id uuid fk -> show_songs`
  - `cue_type text` (`note|marker|popup|action`)
  - `trigger_type text` (`time|marker|manual|footswitch`)
  - `trigger_value text`
  - `payload jsonb`

- `popup_messages`
  - `id uuid pk`
  - `show_project_id uuid fk -> show_projects`
  - `show_song_id uuid null fk -> show_songs`
  - `message text`
  - `style text`
  - `position text`
  - `start_ms int null`
  - `duration_ms int`
  - `trigger_mode text` (`manual|auto`)
  - `enabled boolean`

- `footswitch_profiles`
  - `id uuid pk`
  - `host_id uuid`
  - `name text`
  - `mapping jsonb`
  - `is_default boolean`

- `show_singer_queue`
  - `id uuid pk`
  - `show_project_id uuid fk -> show_projects`
  - `singer_id uuid`
  - `show_song_id uuid null`
  - `position int`
  - `countdown_seconds int`

- `show_analytics`
  - `id uuid pk`
  - `show_project_id uuid fk -> show_projects`
  - `metrics jsonb`
  - `created_at timestamptz`

### 7.2 Indexes
- `show_songs(show_project_id, position)`.
- `lyric_sections(show_song_id, order_index)`.
- `show_cues(show_song_id, trigger_type)`.
- `popup_messages(show_project_id, show_song_id, enabled)`.

### 7.3 RLS Strategy
- Host owner full access to own projects.
- Read-only scoped access for audience-render feeds.
- Stage manager role with constrained update permissions.

## 8. Service/API Boundaries

### 8.1 Client Modules
- `show-mode/project-manager`
- `show-mode/import-pipeline`
- `show-mode/playback-engine`
- `show-mode/lyrics-engine`
- `show-mode/visual-engine`
- `show-mode/footswitch-adapter`
- `show-mode/popup-engine`
- `show-mode/analytics-recorder`

### 8.2 API Endpoints (proposed)
- `POST /api/show-projects`
- `GET /api/show-projects/:id`
- `POST /api/show-projects/:id/import`
- `POST /api/show-projects/:id/process`
- `POST /api/show-projects/:id/live/start`
- `POST /api/show-projects/:id/live/stop`
- `POST /api/show-projects/:id/emergency-fade`
- `POST /api/show-projects/:id/emergency-stop`
- `POST /api/show-projects/:id/popups/trigger`
- `POST /api/show-projects/:id/analytics/finalize`

## 9. State Machine

### 9.1 Show State
- `draft` -> `ready` -> `in_progress` -> `completed`.
- `in_progress` can be paused/resumed.
- Any live state can enter `emergency` sub-state.

### 9.2 Song State
- `unloaded` -> `preloading` -> `ready` -> `playing` -> `paused` -> `ended`.
- Emergency actions can force `playing|paused -> ended`.

## 10. Rehearsal vs Live Mode Rules

### Rehearsal Mode
- Editable setlist and cues during playback.
- Slower defaults for transitions.
- Expanded on-screen diagnostics.

### Live Mode
- Locked setlist order by default.
- Guard dialogs for risky actions.
- Reduced UI noise and large critical controls.
- Audit logging for manual overrides.

## 11. Error Handling and Fallbacks
- If visuals fail: continue lyrics + audio without interruption.
- If lyrics sync fails: fallback to section-level manual stepping.
- If cloud sync fails: local queue persists and retries later.
- If footswitch disconnects: hotkey/touch controls remain active.

## 12. Observability
- Event logs per show session:
  - transport events
  - playback state changes
  - manual overrides
  - emergency commands
  - popup trigger outcomes
- Performance counters:
  - preload duration
  - transition latency
  - cue trigger drift
  - render frame drops (visual screen)

## 13. UX Acceptance Criteria
- Performer can run an entire set without touching mouse in standard flow.
- Emergency fade-out and stop are reachable in one action.
- Lyrics remain readable from stage distance targets.
- Audience screen never exposes performer-only controls.
- Transition between songs does not blank screen longer than 200ms when preloaded.

## 14. Delivery Plan

### Phase 1: Foundation
- Data model and migrations.
- Show project CRUD.
- Import parser framework.
- Playback engine shell.

### Phase 2: Core Performance Flow
- Audio normalization and count-in.
- Lyrics sectioning + navigation.
- Visual engine with transitions.
- Rehearsal Mode end-to-end.

### Phase 3: Live Safety + Control
- Live Mode lock/safety guards.
- Footswitch mapping profiles.
- Emergency commands.
- Dual-screen performer/audience routing.

### Phase 4: Enhanced Experience
- MTV Popup Mode.
- Smart setlist suggestions.
- Singer queue/profile tools.

### Phase 5: Analytics + Sync + Plugins
- Performance analytics reports.
- Cloud backup and offline sync hardening.
- Plugin API surface (v1 contracts).

## 15. Risks and Mitigations
- Risk: Footswitch hardware variability.
  - Mitigation: device profile abstraction + calibration wizard.
- Risk: Audio latency on weaker devices.
  - Mitigation: preload strategy + quality presets.
- Risk: Operator overload.
  - Mitigation: Live Mode simplified UI and guarded actions.
- Risk: Asset preparation delays.
  - Mitigation: asynchronous pre-processing queue with readiness indicators.

## 16. Open Decisions
- Final loudness target (LUFS) for show playback.
- Default count-in style and metronome source.
- Audience popup density and max frequency cap.
- Exact crowd reaction input model (manual-only vs hybrid).
- Licensing policy for third-party visual packs/plugins.

## 17. Definition of Done (Show Mode MVP)
- End-to-end rehearsal flow from import to full set run works without critical defects.
- Live Mode supports safe playback, lyrics, visuals, next-song transitions, and emergency controls.
- Footswitch mapping is configurable and persistent.
- Dual-screen performer/audience rendering is stable.
- Post-show analytics record is generated and viewable.