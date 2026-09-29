-- Furniture Market: per-model DISPLAY SCALE.
-- Imported .glb models come in at wildly different native sizes (a TV stand
-- exported in cm vs m can fill an entire room). `scale` is a uniform multiplier
-- the admin sets per model so oversized pieces can be shrunk (0.2 = one-fifth
-- size) or tiny ones grown, without touching the source file. 1 = native size.
alter table if exists public.furniture_catalog
  add column if not exists scale real not null default 1;
