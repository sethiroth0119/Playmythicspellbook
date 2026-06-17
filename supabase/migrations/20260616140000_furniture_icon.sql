-- ============================================================================
-- 🛋️ furniture_catalog — admin-set ICON per model. Shown on the market card
-- (and mirrored into the housing dwelling). Either an emoji (🛏️, 🖼️…) or an
-- image URL — the client renders an <img> when it looks like a URL, else text.
-- ============================================================================
alter table public.furniture_catalog add column if not exists icon text;
