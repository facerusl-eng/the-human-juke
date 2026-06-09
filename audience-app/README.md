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
