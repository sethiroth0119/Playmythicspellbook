-- ═══════════════════════════════════════════════════════════════════════════
-- 040 · ETHOS HEIGHTS IS ONE CITY, SHARED BY EVERYONE
--
-- Asked for: "Add the Multiplayer factor" — one shared city, everyone's raids
-- count.
--
-- /src/missions/state.js said this in its own header before any of it existed:
--
--   "WHEN THE SHARED VERSION LANDS, THE TICK MOVES SERVER-SIDE. A client-side
--    regrow means a player who doesn't open the game has a map that never
--    decays, and two clients disagreeing about who holds Elm Street is a
--    desync you debug for a week. The shape below (append a delta, sum for
--    grip) is chosen so it ports to an append-only ledger without a rewrite."
--
-- This is that ledger. The client shape ports across unchanged.
--
-- 🔴 APPEND-ONLY. Nothing ever UPDATEs a grip column, because there isn't one.
--    Grip is sum(delta) clamped 0..100 per (site, faction), so two players
--    raiding the same district at the same moment both count and neither can
--    clobber the other's write. A last-write-wins grip column is exactly the
--    desync the module's header warns about.
--
-- 🔴 THE TICK IS SELF-THROTTLED, NOT CRONNED. mission_tick() reads a single
--    server-side clock row, computes how many 4h windows are OWED, and applies
--    only those. Any client may call it: the first one through the window does
--    the work, everyone after gets a no-op. So the world ticks without pg_cron
--    and without trusting a single client's clock — the arithmetic is entirely
--    server-side and now() is the server's.
--
-- ⚠ THE TUNING BELOW MIRRORS /src/missions/poi.js. Two copies of one truth is
--   a real cost, accepted because the server cannot import an ES module and an
--   untrusted client cannot be asked for its own push rates. The driver
--   (drive-mission-coop.mjs) asserts the two agree, so drift fails a build
--   rather than quietly changing how fast the factions take the city.
--
-- ⚠ ADDITIVE ONLY. Nothing pre-existing is dropped, renamed or rewritten.
--   Rollback is at the foot of this file.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the ledger ─────────────────────────────────────────────────────────────
create table if not exists public.mission_pressure (
  id          bigserial primary key,
  site_id     text        not null,
  faction_id  text        not null,
  delta       integer     not null,
  source      text        not null,          -- 'seed' | 'tick' | 'raid' | 'admin'
  user_id     uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists mission_pressure_site_idx on public.mission_pressure (site_id, faction_id);

alter table public.mission_pressure enable row level security;
drop policy if exists mp_sel on public.mission_pressure;
-- everyone sees the same city — that is the point
create policy mp_sel on public.mission_pressure for select to authenticated using (true);
-- 🔴 NO client INSERT policy. Every write goes through a SECURITY DEFINER
--    function below, so a player cannot hand themselves a district by posting
--    a -100 delta straight at the table.

-- ── the server's clock ─────────────────────────────────────────────────────
create table if not exists public.mission_clock (
  id        integer primary key default 1 check (id = 1),
  day       integer not null default 1,
  last_tick timestamptz not null default now()
);
insert into public.mission_clock (id) values (1) on conflict (id) do nothing;
alter table public.mission_clock enable row level security;
drop policy if exists mc_sel on public.mission_clock;
create policy mc_sel on public.mission_clock for select to authenticated using (true);

-- ── one credit per player per mission ──────────────────────────────────────
-- ⚠ KEYED ON (user_id, mission_id), NOT mission_id ALONE. The mission id is a
--   pure function of (district, faction, grip, day) — so two players raiding
--   Midtown on the same day generate the SAME id. A global unique key would
--   silently discard the second player's raid, which is precisely the
--   "everyone's raids count" this migration exists to deliver.
create table if not exists public.mission_credits (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  mission_id text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, mission_id)
);
alter table public.mission_credits enable row level security;
drop policy if exists mcr_sel on public.mission_credits;
create policy mcr_sel on public.mission_credits for select to authenticated using (true);

-- ── the tuning, mirrored from poi.js ───────────────────────────────────────
create table if not exists public.mission_factions (
  id       text primary key,
  rate_lo  integer not null,
  rate_hi  integer not null,
  spread   numeric not null,
  seed_lo  integer not null,
  seed_hi  integer not null
);
insert into public.mission_factions (id, rate_lo, rate_hi, spread, seed_lo, seed_hi) values
  ('scum',      4, 9, 0.45,  8, 16),   -- fast, wide, shallow
  ('anomalies', 2, 6, 0.30, 14, 26),   -- jumps; deep when it lands
  ('scp',       2, 4, 0.22, 10, 18)    -- slow, relentless, sticky
on conflict (id) do update set
  rate_lo = excluded.rate_lo, rate_hi = excluded.rate_hi, spread = excluded.spread,
  seed_lo = excluded.seed_lo, seed_hi = excluded.seed_hi;
alter table public.mission_factions enable row level security;
drop policy if exists mf_sel on public.mission_factions;
create policy mf_sel on public.mission_factions for select to authenticated using (true);

create table if not exists public.mission_adjacency (
  site_id     text not null,
  neighbor_id text not null,
  primary key (site_id, neighbor_id)
);
insert into public.mission_adjacency (site_id, neighbor_id) values
  ('harlem','uws'),('harlem','ues'),
  ('uws','harlem'),('uws','park'),('uws','hells'),
  ('park','uws'),('park','ues'),('park','midtown'),
  ('ues','harlem'),('ues','park'),('ues','midtown'),
  ('hells','uws'),('hells','midtown'),('hells','chelsea'),
  ('midtown','park'),('midtown','ues'),('midtown','hells'),('midtown','chelsea'),
  ('chelsea','hells'),('chelsea','midtown'),('chelsea','village'),
  ('village','chelsea'),('village','soho'),
  ('soho','village'),('soho','battery'),
  ('battery','soho')
on conflict do nothing;
alter table public.mission_adjacency enable row level security;
drop policy if exists ma_sel on public.mission_adjacency;
create policy ma_sel on public.mission_adjacency for select to authenticated using (true);

-- ── the opening board, once ────────────────────────────────────────────────
-- Matches seed() in /src/missions/state.js: a survivor pocket in the middle,
-- pressure from both ends, something very wrong in the park.
insert into public.mission_pressure (site_id, faction_id, delta, source)
select * from (values
  ('harlem','scum',38,'seed'), ('uws','anomalies',22,'seed'), ('park','anomalies',96,'seed'),
  ('hells','scum',71,'seed'),  ('midtown','scp',88,'seed'),   ('soho','scum',14,'seed'),
  ('battery','scp',57,'seed')
) as v(site_id, faction_id, delta, source)
where not exists (select 1 from public.mission_pressure where source = 'seed');

-- ── reading the city ───────────────────────────────────────────────────────
-- Grip per (site, faction) is the clamped running sum; the holder is whichever
-- faction has the most. A site with no positive total is clear.
create or replace view public.mission_grip as
  select site_id, faction_id, greatest(0, least(100, sum(delta)))::int as grip
    from public.mission_pressure
   group by site_id, faction_id;

create or replace function public.mission_state()
returns json language sql stable security definer set search_path to 'public' as $fn$
  select json_build_object(
    'day',      (select day from mission_clock where id = 1),
    'lastTick', (select last_tick from mission_clock where id = 1),
    'sites',    coalesce((
      select json_agg(json_build_object('site', s.site_id, 'faction', s.faction_id, 'grip', s.grip))
        from (
          select distinct on (site_id) site_id, faction_id, grip
            from mission_grip where grip > 0
           order by site_id, grip desc, faction_id
        ) s), '[]'::json)
  );
$fn$;

-- ── the tick ───────────────────────────────────────────────────────────────
create or replace function public.mission_tick()
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_last timestamptz; v_owed int; v_i int; v_row record; v_add int; v_cur int;
  v_open text; v_seed int;
begin
  -- 🔴 ONE TICKER AT A TIME. Without the lock, two clients arriving in the same
  --    second both read "1 window owed" and both apply it — the factions would
  --    advance twice as fast on a busy evening as on a quiet one.
  perform pg_advisory_xact_lock(hashtext('mission_tick'));
  select last_tick into v_last from mission_clock where id = 1;
  -- 4 real hours per push, and a month away is not 180 pushes
  v_owed := least(6, floor(extract(epoch from (now() - v_last)) / 14400)::int);
  if v_owed <= 0 then return mission_state(); end if;

  for v_i in 1..v_owed loop
    -- every held district tightens its grip
    for v_row in
      select distinct on (g.site_id) g.site_id, g.faction_id, g.grip, f.rate_lo, f.rate_hi,
             f.spread, f.seed_lo, f.seed_hi
        from mission_grip g join mission_factions f on f.id = g.faction_id
       where g.grip > 0
       order by g.site_id, g.grip desc, g.faction_id
    loop
      v_cur := v_row.grip;
      v_add := v_row.rate_lo + floor(random() * (v_row.rate_hi - v_row.rate_lo + 1))::int;
      -- clamp on INSERT as well as on read: an unbounded running total would
      -- need a matching mountain of negative deltas before a raid moved it
      v_add := least(v_add, 100 - v_cur);
      if v_add > 0 then
        insert into mission_pressure (site_id, faction_id, delta, source)
          values (v_row.site_id, v_row.faction_id, v_add, 'tick');
      end if;

      -- …and sometimes spills into an empty neighbour
      if random() < v_row.spread then
        select a.neighbor_id into v_open
          from mission_adjacency a
         where a.site_id = v_row.site_id
           and not exists (select 1 from mission_grip g2 where g2.site_id = a.neighbor_id and g2.grip > 0)
         order by random() limit 1;
        if v_open is not null then
          v_seed := v_row.seed_lo + floor(random() * (v_row.seed_hi - v_row.seed_lo + 1))::int;
          insert into mission_pressure (site_id, faction_id, delta, source)
            values (v_open, v_row.faction_id, v_seed, 'tick');
        end if;
      end if;
    end loop;
    update mission_clock set day = day + 1 where id = 1;
  end loop;

  update mission_clock set last_tick = now() where id = 1;
  return mission_state();
end; $fn$;

-- ── crediting a survived raid ──────────────────────────────────────────────
-- ⚠ THE CALLER PROVES NOTHING, AND CANNOT. The client says "I cleared
--   msn_midtown_scum_60_1"; the server has no battle engine to check that
--   against. What it CAN enforce is that one player credits one mission id
--   once, that the cut is the server's number rather than the caller's, and
--   that the delta lands on the faction actually holding the district. That is
--   the same trust model tw_node_contribute already runs on.
create or replace function public.mission_raid(p_mission_id text)
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid(); v_site text; v_fac text; v_grip int; v_cut int;
begin
  if v_uid is null or p_mission_id is null then return mission_state(); end if;
  if p_mission_id !~ '^msn_[a-z]+_' then return mission_state(); end if;

  -- one credit per player per mission; a repeat is a silent no-op
  begin
    insert into mission_credits (user_id, mission_id) values (v_uid, p_mission_id);
  exception when unique_violation then
    return mission_state();
  end;

  v_site := split_part(p_mission_id, '_', 2);
  select faction_id, grip into v_fac, v_grip
    from mission_grip where site_id = v_site and grip > 0
   order by grip desc limit 1;
  if v_fac is null then return mission_state(); end if;   -- already clear

  v_cut := 12 + floor(random() * 11)::int;                -- RAID_CUT [12,22]
  insert into mission_pressure (site_id, faction_id, delta, source, user_id)
    values (v_site, v_fac, -least(v_cut, v_grip), 'raid', v_uid);
  return mission_state();
end; $fn$;

-- ROLLBACK (nothing outside this file references any of it):
--   drop function if exists public.mission_raid(text);
--   drop function if exists public.mission_tick();
--   drop function if exists public.mission_state();
--   drop view     if exists public.mission_grip;
--   drop table    if exists public.mission_credits;
--   drop table    if exists public.mission_adjacency;
--   drop table    if exists public.mission_factions;
--   drop table    if exists public.mission_clock;
--   drop table    if exists public.mission_pressure;
