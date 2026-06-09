# Audience App

Standalone audience deployment for Human Jukebox.

## Local Dev

```bash
npm install
npm run dev
```

## Required Env Vars

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY)

This app intentionally uses the same Supabase project as the host apps.

## Consistency Notes

- Audience Supabase client is wired through `shared/supabase/supabaseClient` to keep backend/project alignment with host apps.
- Audience UI now uses `src/app.css` with responsive mobile breakpoints and touch-friendly controls.
- Run from the repo root:
	- `npm run verify:consistency`
	- `npm run build:apps`
