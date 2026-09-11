-- 127_fishing_records.sql — the weekly Woods Fishing tournament board.
--
-- WOODS_FISHING_HANDOFF round 2: "a weekly tournament board". One record per
-- player per ISO-ish week (floor(epoch / 7 days)); the heaviest catch wins.
-- The client never inserts directly: fishing_record_submit() is the only door,
-- security definer, and it clamps kg to (0, 120] server-side so a forged
-- weight above the heaviest species in the game cannot post. display_name is
-- text the player controls — length-capped here, escaped on render. Reads are
-- open to every signed-in player (a leaderboard is public by nature); nothing
-- from auth.users is exposed. Idempotent, re-runnable, ends with a verify.

create table if not exists public.fishing_records (
  id            bigserial primary key,
  week          integer     not null,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  display_name  text        not null default 'Survivor' check (char_length(display_name) <= 40),
  species       text        not null check (char_length(species) <= 60),
  kg            numeric     not null check (kg > 0 and kg <= 120),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint fishing_records_week_user_uniq unique (week, user_id)
);
create index if not exists fishing_records_week_kg_idx on public.fishing_records (week, kg desc);

alter table public.fishing_records enable row level security;
drop policy if exists fishing_records_read on public.fishing_records;
create policy fishing_records_read on public.fishing_records
  for select to authenticated using (true);
-- no insert/update/delete policies: writes go through the RPC below only.

create or replace function public.fishing_record_submit(p_species text, p_kg numeric, p_display text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_week integer; v_kg numeric; v_have numeric; v_name text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_week := floor(extract(epoch from now()) / 604800)::integer;
  v_kg := least(120, greatest(0.1, coalesce(p_kg, 0)));
  v_name := left(coalesce(nullif(trim(p_display), ''), 'Survivor'), 40);
  select kg into v_have from public.fishing_records where week = v_week and user_id = auth.uid();
  if v_have is not null and v_have >= v_kg then
    return jsonb_build_object('ok', true, 'kept', true, 'kg', v_have, 'week', v_week);
  end if;
  insert into public.fishing_records (week, user_id, display_name, species, kg)
    values (v_week, auth.uid(), v_name, left(coalesce(p_species, 'fish'), 60), v_kg)
  on conflict (week, user_id) do update
    set kg = excluded.kg, species = excluded.species, display_name = excluded.display_name, updated_at = now();
  return jsonb_build_object('ok', true, 'kept', false, 'kg', v_kg, 'week', v_week);
end $$;

create or replace function public.fishing_records_top(p_week integer default null, p_limit integer default 20)
returns table (display_name text, species text, kg numeric, mine boolean)
language sql stable security definer set search_path = public as $$
  select r.display_name, r.species, r.kg, (r.user_id = auth.uid()) as mine
    from public.fishing_records r
   where r.week = coalesce(p_week, floor(extract(epoch from now()) / 604800)::integer)
   order by r.kg desc, r.updated_at asc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.fishing_record_submit(text, numeric, text) from public, anon;
revoke all on function public.fishing_records_top(integer, integer) from public, anon;
grant execute on function public.fishing_record_submit(text, numeric, text) to authenticated;
grant execute on function public.fishing_records_top(integer, integer) to authenticated;

-- verify
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'fishing_records';
select polname from pg_policy where polrelid = 'public.fishing_records'::regclass;
select count(*) as rows from public.fishing_records;
