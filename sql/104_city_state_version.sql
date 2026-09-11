-- ===========================================================================
-- 104 — city_state IS VERSIONED. A CLIENT CANNOT OVERWRITE A NEWER ROW.
--
-- The city save was an unconditional upsert: whatever a device held went over
-- whatever the row held, and the row was never asked. Two devices on the same
-- city — a phone and a laptop, or an owner and their mayor — took turns
-- erasing each other one 60-second autosave at a time: device A loads, device
-- B builds thirty plots and saves, A's periodicSaveTick fires with the city A
-- loaded an hour ago, and B's thirty plots are gone. No demolish action, no
-- error, and city_state_guard (064/103) cannot see it: thirty plots on a city
-- of two hundred is neither "emptying" nor "collapsing", so the write passes.
-- The archive keeps a copy, but nobody knows to ask for it.
--
-- THE FIX. A `version` column, bumped by trigger on every UPDATE, that the
-- client reads with the row and writes back as a condition:
--
--   UPDATE city_state SET state = … WHERE user_id = … AND node_id = …
--                                     AND version = <the version it read>
--
-- Zero rows matched means the row moved since that device read it; the client
-- (public/index.html cityStateSave) reports a conflict instead of a save, and
-- node-city keeps the refused payload aside and reloads the server row. A
-- write that lands adopts the bumped version from RETURNING.
--
-- ⚠ THE TRIGGER OWNS THE NUMBER, NOT THE CLIENT. A client that sent its own
--   version+1 could send anything; the BEFORE UPDATE trigger overwrites
--   whatever arrives with OLD.version + 1, so the only way to produce a
--   version is to have written the row. city_restore() (102) writes through
--   ON CONFLICT DO UPDATE and therefore bumps it too — which is exactly right:
--   the player's open device is refused on its next autosave and reloads the
--   restore, instead of the local-newer-wins rule 102 had to out-stamp.
-- ⚠ BEFORE, not AFTER, and alphabetically after city_state_guard_trg. Postgres
--   fires same-event row triggers in name order; the guard's refusals raise
--   first, and a refused write bumps nothing.
-- ⚠ THE CLIENT DOES NOT NEED THIS FILE TO BE APPLIED. It asks for `version`
--   with the row, detects 42703 once per session if the column is missing, and
--   falls back to `updated_at` equality as the write condition. This file makes
--   the condition exact (updated_at is client-stamped and nullable; version is
--   neither).
--
-- Idempotent and re-runnable. Verify block at the bottom.
-- ===========================================================================

alter table public.city_state
  add column if not exists version bigint not null default 1;

create or replace function public.city_state_version()
returns trigger language plpgsql as $$
begin
  NEW.version := coalesce(OLD.version, 0) + 1;
  return NEW;
end $$;

drop trigger if exists city_state_version_trg on public.city_state;
create trigger city_state_version_trg
  before update on public.city_state
  for each row execute function public.city_state_version();

-- ===========================================================================
-- VERIFY
-- ===========================================================================
select 'version column present' as check,
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'city_state' and column_name = 'version') as got,
       '1' as want
union all
select 'no row without a version',
       (select count(*)::text from public.city_state where version is null), '0'
union all
select 'version trigger armed, BEFORE UPDATE',
       (select count(*)::text from pg_trigger
         where tgrelid = 'public.city_state'::regclass and tgname = 'city_state_version_trg'
           and (tgtype & 2) = 2), '1'
union all
select 'the guard fires before the bump (name order)',
       (select ('city_state_guard_trg' < 'city_state_version_trg')::text), 'true';
