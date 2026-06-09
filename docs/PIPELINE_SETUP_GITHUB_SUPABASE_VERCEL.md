# Pipeline Setup: GitHub -> Supabase -> Vercel

## Folder Structure

- human-jukebox-web
- human-jukebox-tauri
- audience-app
- shared/supabase/supabaseClient.ts

## GitHub Integration

1. Keep `main` as deployment branch.
2. Push the monorepo to a single GitHub repository (recommended).
3. Keep app roots isolated:
   - `human-jukebox-web`
   - `audience-app`
   - `human-jukebox-tauri`
4. Use `.github/workflows/vercel-dual-deploy.yml` for automatic dual deploys.

## Supabase Integration

All apps use the same Supabase project.

Shared logic:
- `shared/supabase/supabaseClient.ts`

Consumers:
- `human-jukebox-web/src/lib/supabase.ts`
- `human-jukebox-tauri/src/lib/supabase.ts`
- `audience-app/src/lib/supabaseClient.ts`

Supported env names:
- `VITE_SUPABASE_URL` or `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (optional fallback)

## Vercel Deployment

Create two Vercel projects from the same repo:

1. `human-jukebox-web` project
   - Root Directory: `human-jukebox-web`
2. `audience-app` project
   - Root Directory: `audience-app`

Set env vars in BOTH Vercel projects:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (optional)
- `SUPABASE_URL` (optional alias)
- `SUPABASE_ANON_KEY` (optional alias)

Web app also needs its additional existing env vars (email/spotify/api settings).

## GitHub Actions Secrets

Set these repo secrets for dual deploy workflow:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_WEB`
- `VERCEL_PROJECT_ID_AUDIENCE`

## Local Development

### Main web app

```bash
cd human-jukebox-web
npm install
npm run dev
```

### Audience app

```bash
cd audience-app
npm install
npm run dev
```

### Tauri app

```bash
cd human-jukebox-tauri
npm install
npm run tauri dev
```

All three must point at the same Supabase project values from their `.env.local` files.

## Notes

- Vercel redeploys on every push to `main` affecting either app folder (or shared Supabase client) via workflow.
- If Supabase schema changes, both apps continue working as long as queries remain compatible and migrations are applied.
- Updating Vercel env vars requires triggering a redeploy/rebuild in each Vercel project.
