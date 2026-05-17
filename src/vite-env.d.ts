/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_ALLOWED_HOST_EMAIL: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_VERCEL_GIT_COMMIT_SHA?: string
  readonly VITE_GIT_COMMIT_SHA?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
