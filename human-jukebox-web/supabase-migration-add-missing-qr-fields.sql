-- Add missing QR custom fields for countdown and break screens
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS mirror_countdown_qr_custom_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mirror_countdown_qr_custom_url TEXT,
  ADD COLUMN IF NOT EXISTS mirror_break_qr_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mirror_break_qr_custom_url TEXT;
