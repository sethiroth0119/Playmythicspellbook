-- ============================================================================
-- 🛋️ furniture_catalog — TYPE (placement) + FUNCTION (interaction) per model.
-- Admins now choose, on upload, HOW a model is placed and WHAT it does:
--   mount:  'floor' | 'wall' | 'flat' | 'ceiling'   (how it sits)
--   func:   '' | 'bed' | 'storage' | 'counter' | 'binder' | 'open'  (walk-up + E)
-- A model with a func becomes an interactive fixture in the walkable shop
-- (placed as a station so it gets the proximity prompt + Enter handler).
-- ============================================================================
alter table public.furniture_catalog add column if not exists func  text;
alter table public.furniture_catalog add column if not exists mount text not null default 'floor';
