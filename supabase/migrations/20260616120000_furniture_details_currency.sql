-- ============================================================================
-- 🛋️ furniture_catalog — DETAILS blurb + CURRENCY per admin-uploaded model.
-- Admins (only) upload 3D models; players buy + place them. On upload the admin
-- now also writes:
--   details:  free-text "what it does" blurb shown in the market. If left blank
--             the client falls back to "A normal <category>." (e.g. a normal
--             poster, a normal planet).
--   currency: 'cinder' (🔥, taxed by the Foundation Tax on spend) or
--             'aza' (🪙 premium, untaxed). Drives which wallet a purchase debits.
-- ============================================================================
alter table public.furniture_catalog add column if not exists details  text;
alter table public.furniture_catalog add column if not exists currency text not null default 'cinder';
