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
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_ALLOWED_HOST_EMAIL=...
```

3. For local phone testing only, optionally set:

```
VITE_DEV_PUBLIC_ORIGIN=http://YOUR-LAN-IP:5173
```

Do not set `VITE_DEV_PUBLIC_ORIGIN` in Vercel.

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
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_ALLOWED_HOST_EMAIL
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
