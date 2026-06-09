# Human Jukebox

Realtime event music queue with guest requests, host moderation, and protected admin controls.

## Features

- Realtime queue sync with Supabase Realtime.
- Guest and host authentication flows.
- Host-protected admin route with access code claim.
- Moderation controls: pause room, explicit filter toggle, vote lock, remove song.

## Setup

1. Copy `.env.example` to `.env`.
2. Keep these values configured:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=... (optional legacy key)
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_ALLOWED_HOST_EMAIL=...
RESEND_API_KEY=... (required for /api/get-updates)
UPDATES_EMAIL_FROM=... (required for /api/get-updates sender)
RESEND_UPDATES_AUDIENCE_ID=... (required to auto-store subscriber contacts)
UPDATES_BROADCAST_TOKEN=... (required to authorize broadcast trigger endpoint)
UPDATES_FALLBACK_TO_EMAIL=... (optional fallback lead inbox for Resend test mode)
BOOKING_WEBHOOK_URL=... (optional override for /api/book-show)
GITHUB_TOKEN=... (required only if using /api/report-issue)
```

3. For local phone testing only, optionally set:

```
VITE_DEV_PUBLIC_ORIGIN=http://YOUR-LAN-IP:5173
```

Do not set `VITE_DEV_PUBLIC_ORIGIN` in Vercel.

Spotify login now uses PKCE and does not require a local `SPOTIFY_CLIENT_SECRET`.
By default in local dev, Spotify callback falls back to `https://the-human-jukebox.org/callback` unless you explicitly set a local override.
Local Vite dev defaults to HTTP. If you want local callback routing over HTTPS, set `VITE_DEV_HTTPS=1`, set `SPOTIFY_REDIRECT_URI_DEV=https://localhost:5173/callback`, and trust the localhost certificate in your browser first.
If you do set Spotify redirect overrides, make sure the callback URL exactly matches the one registered in the Spotify dashboard.

4. Install dependencies:

```
npm install
```

5. Start dev server:

```
npm run dev
```

## Vercel Deployment

This project is ready to deploy on Vercel as a Vite single-page app.

### Required Vercel Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY (optional legacy key)
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_ALLOWED_HOST_EMAIL
RESEND_API_KEY
UPDATES_EMAIL_FROM
RESEND_UPDATES_AUDIENCE_ID
UPDATES_BROADCAST_TOKEN
```

### Optional Vercel Environment Variables

Configure these when their matching features are enabled:

```
BOOKING_WEBHOOK_URL   # Override booking webhook target for /api/book-show
GITHUB_TOKEN          # Required for /api/report-issue
VITE_BOOKING_URL      # Link used in update emails
UPDATES_FALLBACK_TO_EMAIL  # Optional fallback inbox for /api/get-updates in Resend test mode
UPDATES_BROADCAST_API_URL  # Optional override for CLI trigger target (defaults to production endpoint)
```

Do not add `VITE_DEV_PUBLIC_ORIGIN` in production.

### Deployment Notes

- `vercel.json` is already configured for Vite output and SPA rewrites.
- Audience, Feed, Admin, and Mirror routes will resolve correctly through the rewrite to `index.html`.
- Use the Vercel production URL for QR codes and audience links once deployed.

### Supabase Checklist Before Launch

For audience devices and phones to work correctly on a fresh origin:

1. Enable Anonymous sign-ins in Supabase Authentication -> Providers -> Anonymous.
2. Make sure your publishable key is active.
3. Confirm RLS policies are applied from `supabase-migration.sql`.

Without anonymous auth enabled, new audience users on phones may remain stuck outside the live audience flow.

## Authentication Notes

- Guests use anonymous auth from the top bar.
- Hosts can sign in with email/password from the top bar.
- To unlock admin capabilities, use host access code in the admin gate.
- Default host access code in current migration seed: `host2026`.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run sync:variants` (copy shared host logic and UI files from `src/` to `human-jukebox-web/src/` and `human-jukebox-tauri/src/`)
- `npm run sync:variants:check` (fail if root/web/tauri shared files drift)
- `npm run verify:consistency` (checks audience Supabase client sharing and mobile CSS baselines)
- `npm run ship:update -- "your message"` (sync + verify + build apps + git add/commit/push to `main`)
- `npm run test:responsive` (requires the app running at `BASE_URL`, default `http://127.0.0.1:5173`)
- `npm run send:updates -- --subject "Your update" --message "Line 1\nLine 2"` (sends a broadcast to all contacts in `RESEND_UPDATES_AUDIENCE_ID`)

## Multi-App Sync Rules

- Root `src/` is the source of truth for shared host logic (Now Playing, queue, Spotify toggle, spacebar behavior, playback, Supabase flow).
- Before shipping, run `npm run sync:variants` to propagate shared files to:
	- `human-jukebox-web/src/`
	- `human-jukebox-tauri/src/`
- Keep `audience-app` connected through `shared/supabase/supabaseClient` so it uses the same Supabase project.
- Use `npm run ship:update -- "message"` for one-command stage/commit/push and automatic Vercel redeploy on push.

## Sending Updates To Subscribers

1. Create a Resend Audience and copy its ID into `RESEND_UPDATES_AUDIENCE_ID`.
2. Set `UPDATES_BROADCAST_TOKEN` in local env and Vercel env.
3. New signups from `/api/get-updates` are auto-added to that audience.
4. Trigger broadcast to all subscribers with either:

```bash
npm run send:updates -- --subject "New June Shows" --message "We just added new dates and booking slots."
```

Or call endpoint directly:

```bash
curl -X POST https://www.the-human-jukebox.org/api/send-updates-broadcast \
	-H "Content-Type: application/json" \
	-H "x-broadcast-token: YOUR_TOKEN" \
	-d '{"subject":"New June Shows","message":"We just added new dates and booking slots."}'
```

## Responsive Baseline

- Mobile: `max-width: 600px`
- Tablet: `601px - 1024px`
- Desktop: `1025px+`

CSS token references live in [src/index.css](src/index.css).

Use this quick cross-device smoke test after UI changes:

```bash
npm run dev:web
npm run test:responsive
```
