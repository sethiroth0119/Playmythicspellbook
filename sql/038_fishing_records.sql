-- ===========================================================================
-- 038 — FISHING TOURNAMENTS: the weekly heaviest-catch board.
--
-- Woods Fishing records a trophy weight per species on the client (live.catchLog
-- .bestKg). This table lets a player POST that record so everyone sees a
-- leaderboard; the client keeps working with no table at all (local records
-- only, panel says so) — the Corp.* guarded pattern.
--
-- SHAPE. One row per (user, species, week). `week` is floor(epoch / 604800),
-- the client computes the same number, so a board is "this week's" without a
-- timezone argument. `kg` only ever goes UP for a row: the submit RPC keeps
-- the max, so a lighter re-submit (or a replayed request) can never lower a
-- record.
--
-- 🔒 RLS IS THE ENTIRE SECURITY BOUNDARY.
--   • select — any signed-in player (it is a public leaderboard).
--   • insert/update — ONLY through fishing_record_submit(), which is
--     SECURITY DEFINER, stamps auth.uid() itself and clamps the weight to the
--     heaviest species in the game (a 60 kg Leviathan Fry is the ceiling;
--     anything above it is a forged request, not a fish). Direct INSERT /
--     UPDATE / DELETE policies are deliberately NOT created, so the only way
--     to write is the RPC. Same posture as chat_send().
--   ⚠ display_name is client-supplied text. It is length-capped here and the
--     client escapes it on render; it is never trusted for anything else.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

create table if not exists public.fishing_records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text,
  species       text not null,
  kg            numeric(8,2) not null check (kg > 0 and kg <= 120),
  boat          text,
  biome         text,
  week          integer not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, species, week)
);
create index if not exists fishing_records_week_species_kg
  on public.fishing_records (week, species, kg desc);

alter table public.fishing_records enable row level security;

drop policy if exists fishing_records_select on public.fishing_records;
create policy fishing_records_select on public.fishing_records
  for select to authenticated using (true);
-- No insert / update / delete policies on purpose: writes go through the RPC.

create or replace function public.fishing_record_submit(
  p_species text, p_kg numeric, p_boat text default null, p_biome text default null, p_display_name text default null
) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid  uuid := auth.uid();
  v_week integer := floor(extract(epoch from now()) / 604800)::integer;
  v_kg   numeric := round(least(120, greatest(0.01, coalesce(p_kg, 0)))::numeric, 2);
  v_row  public.fishing_records%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_species is null or length(p_species) = 0 or length(p_species) > 40 then
    return jsonb_build_object('ok', false, 'error', 'bad_species');
  end if;

  insert into public.fishing_records (user_id, display_name, species, kg, boat, biome, week)
  values (v_uid, left(coalesce(p_display_name, ''), 40), left(p_species, 40), v_kg, left(coalesce(p_boat, ''), 60), left(coalesce(p_biome, ''), 40), v_week)
  on conflict (user_id, species, week) do update
    set kg           = greatest(public.fishing_records.kg, excluded.kg),
        boat         = case when excluded.kg > public.fishing_records.kg then excluded.boat  else public.fishing_records.boat  end,
        biome        = case when excluded.kg > public.fishing_records.kg then excluded.biome else public.fishing_records.biome end,
        display_name = coalesce(nullif(excluded.display_name, ''), public.fishing_records.display_name),
        updated_at   = now()
  returning * into v_row;

  return jsonb_build_object('ok', true, 'week', v_row.week, 'kg', v_row.kg, 'species', v_row.species);
end;
$function$;

revoke all on function public.fishing_record_submit(text, numeric, text, text, text) from public;
grant execute on function public.fishing_record_submit(text, numeric, text, text, text) to authenticated;

-- ── verify ────────────────────────────────────────────────────────────────
select relname, relrowsecurity from pg_class where relname = 'fishing_records';
select policyname, cmd from pg_policies where tablename = 'fishing_records';
select count(*) as rows_this_week from public.fishing_records
 where week = floor(extract(epoch from now()) / 604800)::integer;
