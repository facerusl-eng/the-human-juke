# Duplicate Actions Audit and Simplification

## Scope
Audit of duplicate actions, repeated logic, and redundant controls across Admin, Gig Control, Gig Settings, and shared navigation.

## Duplicate Patterns Found

1. Clipboard copy logic duplicated
- Same copy-with-fallback code existed in multiple pages.
- Impact: duplicated error handling and behavior drift risk.

2. Audience access controls repeated inside the same feature area
- Gig Control exposed copy audience link in multiple places.
- Gig Settings exposed mirror-open in multiple places.
- Impact: redundant UI and multiple action entry points.

3. Save-flow patterns duplicated
- Settings and Gig Settings each had custom autosave timer and status flow.
- Impact: inconsistent behavior risk and harder maintenance.

4. Gig action controls duplicated across pages
- Room open, explicit filter, set active gig appear in multiple pages.
- Impact: expected by role context but should be standardized by shared handlers/components.

## Changes Applied in This Pass

1. Centralized clipboard copy behavior
- Added shared hook:
  - src/hooks/useClipboardCopy.ts
- Refactored these pages to use it:
  - src/pages/GigControlPage.tsx
  - src/pages/GigSettingsPage.tsx
- Result: one source of truth for copy fallback, timing, and error propagation.

2. Removed redundant UI controls
- Removed duplicate "Copy Audience Link" in Gig Control header actions.
  - Kept it in Audience Join QR panel (most logical location).
- Removed duplicate "Open Mirror Screen" button from Gig Settings audience access quick-links.
  - Kept mirror shortcut in header where mirror controls are grouped.

3. Mobile nav cleanup already applied in prior pass
- Home/non-audience now uses collapsible menu instead of cramped horizontal nav.
- Result: cleaner single entry point behavior on mobile navigation.

4. Centralized gig action handlers (second pass)
- Added shared hook:
  - src/hooks/useGigActions.ts
- Refactored these pages to use it:
  - src/pages/AdminPage.tsx
  - src/pages/GigControlPage.tsx
  - src/pages/GigsPage.tsx
- Shared actions now use one logic path for:
  - setActiveEvent
  - toggleRoomOpen
  - toggleExplicitFilter
- Result: one source of truth for busy-state locking and error-message fallback handling.

5. Centralized autosave and save-status lifecycle (third pass)
- Added shared hook:
  - src/hooks/useAutosaveSaveLifecycle.ts
- Refactored these pages to use it:
  - src/pages/SettingsPage.tsx
  - src/pages/GigSettingsPage.tsx
- Shared lifecycle now owns:
  - autosave timer scheduling
  - autosave cancellation
  - saving/saved/error/unsaved state transitions
  - saved-to-idle reset timing
- Result: one source of truth for save-state UX timing and autosave cleanup behavior.

6. Centralized Admin dashboard shortcut actions (fourth pass)
- Refactored:
  - src/pages/AdminPage.tsx
- Added shared local renderer and action model for Admin dashboard buttons.
- Moved duplicate hero shortcuts out of the Current Gig card so actions live in one clearer section.
- Consolidated these Admin action groups behind shared definitions:
  - quick controls
  - setlist and queue shortcuts
  - settings and tools shortcuts
  - safe mode recovery actions
  - live strip actions
- Result: one source of truth for Admin action labels, disabled states, and click handlers.

7. Centralized app-owned local storage persistence (fifth pass)
- Extended shared helpers in:
  - src/lib/saveHandling.ts
- Refactored these callers to use shared storage helpers:
  - src/components/LiveFeedPanel.tsx
  - src/lib/audienceIdentity.ts
  - src/pages/MirrorPage.tsx
  - src/lib/playbackState.ts
  - src/state/queueStore.tsx
- Shared helpers now cover:
  - raw text preference reads/writes
  - JSON payload reads/writes
  - consistent failure handling for restricted storage environments
- Intentional exception kept:
  - src/lib/supabase.ts retains its dedicated auth-storage adapter because it must satisfy the Supabase storage contract and memory fallback behavior.
- Result: one source of truth for app-owned preference and sync persistence paths.

8. Centralized reusable settings UI primitives (sixth pass)
- Added shared components:
  - src/components/settings/SettingsSection.tsx
  - src/components/settings/SaveStatusBadges.tsx
- Refactored these pages to use them:
  - src/pages/SettingsPage.tsx
  - src/pages/GigSettingsPage.tsx
- Shared primitives now own:
  - collapsible settings section shell and accessibility wiring
  - save-status badge rendering
  - page-specific toggle glyph and wrapper differences through props instead of duplicate component copies
- Result: one source of truth for settings-section scaffolding and save-state badge markup.

9. Centralized cross-page shortcut/action button groups (seventh pass)
- Added shared component:
  - src/components/actions/ActionButtonGroup.tsx
- Refactored these pages to use it:
  - src/pages/AdminPage.tsx
  - src/pages/GigControlPage.tsx
  - src/pages/GigSettingsPage.tsx
- Shared primitive now owns:
  - variant-to-button-class mapping
  - async-safe click handling
  - shared button group rendering for page-specific layouts
- Result: one source of truth for repeated shortcut/action button group markup across major admin surfaces.

## Current Single-Place Mapping (Post-pass)

- Copy Audience Link:
  - Primary: Gig Control -> Audience Join QR panel
  - Secondary usage in Gig Settings reuses same shared copy hook and status behavior

- Open Mirror Screen:
  - Primary: Gig Control and Gig Settings header controls
  - Removed extra duplicate in Gig Settings audience quick-links

- Audience Screen shortcut:
  - Primary quick access remains on Admin Home and Gig Settings audience access section

## Remaining Consolidation Opportunities (Next Pass)

1. Intentional storage-boundary cleanup
- Optionally extract the Supabase auth storage adapter into a dedicated storage utility if you want every storage implementation to live under one module, while preserving its different contract.

2. Settings toolbar normalization
- If desired, extract the undo/redo plus action-button toolbar shell used by Settings and Gig Settings into a final shared toolbar component.

3. Queue/admin status-row primitives
- Optionally extract repeated status-summary cards or rows if you want to continue reducing display-layer duplication without changing page-specific content.

## Safety Constraints Honored
- No core feature removed.
- Only duplicate actions and duplicate logic were consolidated/trimmed.
- Build remains green after refactor.
