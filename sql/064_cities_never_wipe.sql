-- ════════════════════════════════════════════════════════════════════════════
-- 064 · CITIES NEVER WIPE — history, and a refusal to destroy
--
-- 🔴 RUN THIS FIRST, BEFORE 065. It does not fix the bug that is eating cities;
--    it makes that bug — and every future one — NON-DESTRUCTIVE. 065 fixes the
--    cause. This file is the one that stops the bleeding today.
--
-- ── WHAT WAS ACTUALLY FOUND (audited 2026-08-26) ───────────────────────────
--
--   city_state's key is (user_id, node_id) and node_id is a uuid. But the
--   client's _cityNodeKey() substitutes an all-zeros SENTINEL whenever
--   App._cityNodeId is not a 36-char uuid — and the ids the game actually
--   passes around are things like 'N-25' and 'local-city'.
--
--   Read out of the live database:
--       city_state rows            12
--       …with node_id = all-zeros  12      ← every single one
--       players with >1 city       5       (per city_profiles, which stores the
--                                            REAL anchor node, as text)
--
--   So five players own cities on more than one node, and all of those cities
--   are being written into ONE row each. Open city A, build, open city B — the
--   autosave puts B's layout in the same row A lives in. Go back to A and it is
--   gone. The bug report already quoted at _openNodeCity ("I go to a client's
--   node and their city shows, then go back to my own and my city never
--   appears") was half-fixed: the FRAME half was, the KEY half was not.
--
--   Grimalkin Lord is one of the five: 2 city_profiles rows, both on real uuid
--   nodes, and exactly 1 city_state row under the sentinel.
--
-- ── AND WHAT WAS RULED OUT, SO NOBODY RE-CHASES IT ────────────────────────
--   · pg_cron — one job, tier_drops_run, does not touch cities.
--   · season_apply()/_season_purge_apply() — DOES blank city_state.state to
--     '{}', but every season_reset directive is 23+ days old and the TTL is 72
--     hours, so none are live. Not the current cause. §4 disarms it anyway,
--     because a single new row in season_reset would blank every player's city
--     within three days and nothing about that is obvious from the outside.
--   · sql/052 — the 25 Aug wipe was deliberate and explains 24 -> 12 rows. It
--     does not explain a city built AFTER it going missing.
--
-- ── WHAT THIS FILE DOES ────────────────────────────────────────────────────
--   1. every version of every city is kept, forever, append-only
--      (⚠ narrowed by sql/103 on 2026-09-04: an autosave that changed no tile
--       is not archived while the newest archive is under ten minutes old.
--       61% of a day's 3,567 archives were that copy, 159 KB a minute.)
--   2. a write that would destroy a city is REFUSED, not archived-and-allowed
--   3. players cannot DELETE a city at all; `anon` cannot touch one
--   4. the season purge can no longer blank a city
--   5. an admin restore that is itself non-destructive
--
-- Idempotent and re-runnable. RLS ships in this file. Ends with a verify query.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 0. A shared admin test (062 creates this; repeated so 064 can be run alone)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ms_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in (
    'richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com');
$$;
revoke all on function public.ms_is_admin() from public;
grant execute on function public.ms_is_admin() to authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. HISTORY — the thing city_state has never had
-- ════════════════════════════════════════════════════════════════════════════
-- index.html says it plainly at cityStateSave: "the city_state upsert is one
-- row per user with no history, so a single write over a save we were refused
-- is permanent loss." That sentence is the whole reason this table exists.
-- Every prior version is kept. A bug can now cost a player time; it can no
-- longer cost them their city.
create table if not exists public.city_state_history (
  id          bigserial primary key,
  user_id     uuid not null,
  node_id     uuid,
  state       jsonb not null,
  sync_pct    integer,
  mayor_id    uuid,
  mayor_name  text,
  archived_at timestamptz not null default now(),
  row_updated timestamptz,
  reason      text,                       -- 'update' | 'delete' | 'manual'
  tiles       integer,                    -- denormalised so a human can SEE the
  bytes       integer                     -- shape of a save without opening it
);
create index if not exists city_state_history_user_idx
  on public.city_state_history (user_id, archived_at desc);
create index if not exists city_state_history_big_idx
  on public.city_state_history (user_id, tiles desc);

create table if not exists public.city_profiles_history (
  id          bigserial primary key,
  profile_id  uuid,
  owner_id    uuid not null,
  node_id     text,
  city_name   text,
  specializations text[],
  sells jsonb, buys jsonb,
  economy_day integer,
  population  integer,
  archived_at timestamptz not null default now(),
  reason      text
);
create index if not exists city_profiles_history_owner_idx
  on public.city_profiles_history (owner_id, archived_at desc);

alter table public.city_state_history    enable row level security;
alter table public.city_profiles_history enable row level security;

drop policy if exists city_state_history_read    on public.city_state_history;
drop policy if exists city_profiles_history_read on public.city_profiles_history;

-- A player may read their own history (so "restore my city" can one day be a
-- button rather than a support ticket). Nobody is granted INSERT, UPDATE or
-- DELETE — the trigger writes it, and it is append-only for everyone else.
create policy city_state_history_read on public.city_state_history
  for select to authenticated using (user_id = auth.uid() or public.ms_is_admin());
create policy city_profiles_history_read on public.city_profiles_history
  for select to authenticated using (owner_id = auth.uid() or public.ms_is_admin());

grant select on public.city_state_history, public.city_profiles_history to authenticated;
revoke insert, update, delete on public.city_state_history    from authenticated, anon;
revoke insert, update, delete on public.city_profiles_history from authenticated, anon;

-- ── how big is a city? one definition, used by the trigger and by humans ────
-- ⚠ COUNTS TILES, NOT BYTES. A save can grow in bytes while losing every
--   building — logs, citizen lists and the event feed all inflate it. Tiles are
--   the thing a player would call "my city".
create or replace function public.city_tile_count(p_state jsonb)
returns integer language sql immutable as $$
  select case
    when p_state is null then 0
    when jsonb_typeof(p_state -> 'tiles') = 'object'
      then (select count(*)::int from jsonb_object_keys(p_state -> 'tiles'))
    when jsonb_typeof(p_state -> 'tiles') = 'array'
      then jsonb_array_length(p_state -> 'tiles')
    else 0 end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE GUARD — archive everything, and REFUSE the catastrophic write
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 THIS IS THE PART THAT ANSWERS "make it where these cities do not wipe
--    unless we do it". Archiving alone would keep the city recoverable but the
--    player would still watch it disappear and still have to ask for it back.
--    A refusal means it never disappears in the first place.
--
-- What counts as catastrophic, and why these numbers:
--   · ANY write that empties a non-empty city ({} or zero tiles). There is no
--     legitimate save that does this. _season_purge_apply does exactly it.
--   · a write that drops a city of 8+ tiles to under a QUARTER of its size.
--     Autosaves are frequent and incremental; nothing a player does in one
--     save interval removes three quarters of their town. A cross-city
--     overwrite, however, looks exactly like this — which is the bug in 065.
--
-- ⚠ THE BYPASS IS DELIBERATE AND IT IS NOT A BACK DOOR. `set local
--   app.city_force = 'on'` inside a transaction lets an operator do a
--   sanctioned wipe (a real season reset, sql/052) without editing this
--   trigger out and forgetting to put it back. It is session-local, it cannot
--   be set by PostgREST from a browser, and the archive still runs first — so
--   even a forced wipe is recoverable.
--
-- 🔴 SUPERSEDED BY sql/103 (2026-09-04). The body below archives and THEN
--   raises, and its messages quote the archive id. RAISE aborts the statement
--   and the trigger's INSERT with it, so a refused write never left the row
--   the message named — proven with this exact body under Postgres 17: two
--   refusals, zero archives. A refused write is protected by being refused;
--   the live row is untouched. 103 also skips the archive for an autosave
--   that changed no tile within ten minutes of the last one. Kept here as the
--   record of what shipped on 2026-08-26; do not run this file over 103.
create or replace function public.city_state_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_tiles int;
  v_new_tiles int;
  v_arch      bigint;
  v_force     boolean := coalesce(current_setting('app.city_force', true), '') = 'on';
begin
  -- ── archive the version being replaced, ALWAYS, before deciding anything ──
  if TG_OP in ('UPDATE', 'DELETE') then
    insert into public.city_state_history
      (user_id, node_id, state, sync_pct, mayor_id, mayor_name, row_updated, reason, tiles, bytes)
    values (OLD.user_id, OLD.node_id, OLD.state, OLD.sync_pct, OLD.mayor_id, OLD.mayor_name,
            OLD.updated_at, lower(TG_OP),
            public.city_tile_count(OLD.state), length(OLD.state::text))
    returning id into v_arch;
  end if;

  if TG_OP = 'DELETE' then
    if v_force then return OLD; end if;
    -- Nothing in the game legitimately deletes a city row. 052 does, and 052
    -- runs as an operator who can set the flag.
    raise exception
      'city_state rows are not deleted. The city is archived in city_state_history id %; use city_restore(), or set local app.city_force to force.', v_arch
      using errcode = '42501';
  end if;

  v_new_tiles := public.city_tile_count(NEW.state);
  if TG_OP = 'UPDATE' then
    v_old_tiles := public.city_tile_count(OLD.state);

    if not v_force then
      -- (a) emptying a real city
      if v_old_tiles > 0 and v_new_tiles = 0 then
        raise exception
          'refused: this write would empty a % tile city. Archived as city_state_history id %.',
          v_old_tiles, v_arch
          using errcode = '55006';
      end if;
      -- (b) collapsing one
      if v_old_tiles >= 8 and v_new_tiles < (v_old_tiles / 4) then
        raise exception
          'refused: this write would cut a % tile city down to %. That is a cross-city overwrite, not a save. Archived as city_state_history id %.',
          v_old_tiles, v_new_tiles, v_arch
          using errcode = '55006';
      end if;
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists city_state_guard_trg on public.city_state;
create trigger city_state_guard_trg
  before update or delete on public.city_state
  for each row execute function public.city_state_guard();

-- ── city_profiles: archive only. A profile is public identity, not the build,
--    so losing one costs a name and a market listing rather than a town. It is
--    kept because it is the only record of WHICH NODE a city was anchored at,
--    which is precisely what 065 needs to put things back.
create or replace function public.city_profiles_archive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.city_profiles_history
    (profile_id, owner_id, node_id, city_name, specializations, sells, buys,
     economy_day, population, reason)
  values (OLD.id, OLD.owner_id, OLD.node_id, OLD.city_name, OLD.specializations,
          OLD.sells, OLD.buys, OLD.economy_day, OLD.population, lower(TG_OP));
  return case TG_OP when 'DELETE' then OLD else NEW end;
end $$;

drop trigger if exists city_profiles_archive_trg on public.city_profiles;
create trigger city_profiles_archive_trg
  before update or delete on public.city_profiles
  for each row execute function public.city_profiles_archive();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. PRIVILEGES — who may touch a city at all
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 READ OUT OF THE LIVE DATABASE, 2026-08-26:
--        anon          -> INSERT, SELECT, UPDATE, DELETE on city_state
--        authenticated -> INSERT, SELECT, UPDATE, DELETE on city_state
--    `anon` is the UNAUTHENTICATED role, and the anon key is shipped in
--    wrangler.jsonc and in every copy of index.html. RLS is what has been
--    holding that door shut; the grant should never have been open behind it.
--    Defence in depth means the grant closes too.
revoke all on public.city_state    from anon;
revoke all on public.city_profiles from anon;
grant select on public.city_state    to anon;   -- reads are RLS-gated already
grant select on public.city_profiles to anon;

-- A player never deletes their own city. There is no button for it, there is no
-- flow that needs it, and the only thing the grant has ever done is give a bug
-- somewhere the ability to do it.
revoke delete on public.city_state    from authenticated;
revoke delete on public.city_profiles from authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. DISARM THE SEASON PURGE'S CITY CLAUSE
-- ════════════════════════════════════════════════════════════════════════════
-- Not the current cause — every directive is 23+ days old against a 72 hour
-- TTL — but it is one INSERT away from being it, and the blast radius is every
-- player who signs in during the following three days. The Cinder and forge
-- clauses are left exactly as they were; only the city is spared, because a
-- built city is the one thing in this game that cannot be re-earned by playing.
create or replace function public._season_purge_apply(p_uid uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare v_cleared text[] := '{}';
begin
  if p_uid is null then return v_cleared; end if;

  if to_regclass('public.user_progress') is not null then
    update public.user_progress
       set cinder = 0, item_inventory = '{}'::jsonb, equipment = '{}'::jsonb,
           relic_equipment = '{}'::jsonb, updated_at = now()
     where user_id = p_uid;
    if found then v_cleared := v_cleared || 'progress'::text; end if;
  end if;

  if to_regclass('public.user_profiles') is not null then
    update public.user_profiles
       set gems = 0,
           forge = coalesce(forge, '{}'::jsonb)
                     - '__blackRiver__' - '__princePortfolios__' - '__fishingCorp__'
                     - '__fuelCommand__' - '__cityCards__' - '__jbLocalOps__'
                     - '__itemInventory__' - '__equipment__' - '__relicEquipment__'
                     - '__heroLoadouts__'
                     - '__salvage__' - '__fieldBag__' - '__vaultLayout__'
                     - '__cardCollection__',
           updated_at = now()
     where user_id = p_uid;
    if found then v_cleared := v_cleared || 'profile'::text; end if;
  end if;

  /* 🔴 THE CITY CLAUSE IS GONE ON PURPOSE (2026-08-26).
     It used to run:
         update public.city_state set state = '{}'::jsonb where user_id = p_uid;
     which is the single most destructive statement in this database, fired by
     a CLIENT calling season_apply() when it notices a directive. Even with the
     guard in §2 refusing it, this would now throw mid-purge and abort the rest
     of the reset — so it is removed rather than left to fail. A season reset
     that must also clear cities is an operator job: run it with
         set local app.city_force = 'on';
     in a transaction, where a human is watching, and the history table in §1
     keeps every city recoverable afterwards regardless. */

  return v_cleared;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. RESTORE — and it is itself non-destructive
-- ════════════════════════════════════════════════════════════════════════════
-- Putting a city back is a write like any other, so it goes through the same
-- trigger: the version being replaced is archived first. Restoring the wrong
-- version is therefore also undoable, which matters, because the times you
-- reach for this function are the times you are in a hurry.
create or replace function public.city_restore(
  p_user uuid, p_history_id bigint, p_node uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h public.city_state_history; v_node uuid; v_had int;
begin
  if not public.ms_is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  select * into v_h from public.city_state_history where id = p_history_id;
  if v_h is null then raise exception 'no such history row' using errcode = 'P0002'; end if;
  if v_h.user_id <> p_user then
    raise exception 'that history row belongs to a different player' using errcode = '22023';
  end if;

  v_node := coalesce(p_node, v_h.node_id, '00000000-0000-0000-0000-000000000000'::uuid);
  select public.city_tile_count(state) into v_had
    from public.city_state where user_id = p_user and node_id = v_node;

  insert into public.city_state (user_id, node_id, state, sync_pct, mayor_id, mayor_name, updated_at)
  values (p_user, v_node, v_h.state, v_h.sync_pct, v_h.mayor_id, v_h.mayor_name, now())
  on conflict (user_id, node_id) do update
    set state = excluded.state, sync_pct = excluded.sync_pct, updated_at = now();

  return jsonb_build_object('ok', true, 'user', p_user, 'node', v_node,
    'restored_tiles', public.city_tile_count(v_h.state),
    'replaced_tiles', coalesce(v_had, 0),
    'from_archived_at', v_h.archived_at);
end $$;

revoke all on function public.city_restore(uuid, bigint, uuid) from public, anon;
grant execute on function public.city_restore(uuid, bigint, uuid) to authenticated;

-- What is recoverable, at a glance. The query a human actually wants when a
-- player says "my city is gone".
create or replace view public.city_recovery as
  select h.user_id,
         coalesce(up.display_name, '(no name)') as player,
         h.id as history_id, h.node_id, h.tiles, h.bytes,
         h.archived_at, h.reason
    from public.city_state_history h
    left join public.user_profiles up on up.user_id = h.user_id
   where public.ms_is_admin()
   order by h.user_id, h.tiles desc, h.archived_at desc;
grant select on public.city_recovery to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. SEED THE HISTORY FROM THE 25 AUG BACKUP
-- ════════════════════════════════════════════════════════════════════════════
-- The trigger only sees writes from now on, so without this the twelve cities
-- that were wiped on 25 Aug would still be unrecoverable through city_restore()
-- even though the bytes are sitting right there. Guarded on the backup existing
-- and on not double-seeding, so re-running this file is safe.
do $$
begin
  if to_regclass('public.city_state_backup_20260825') is not null
     and not exists (select 1 from public.city_state_history where reason = 'seed_20260825') then
    insert into public.city_state_history
      (user_id, node_id, state, sync_pct, mayor_id, mayor_name, row_updated, reason, tiles, bytes)
    select b.user_id, b.node_id, b.state, b.sync_pct, b.mayor_id, b.mayor_name,
           b.updated_at, 'seed_20260825',
           public.city_tile_count(b.state), length(b.state::text)
      from public.city_state_backup_20260825 b;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════════════
select 'history table' as check, (to_regclass('public.city_state_history') is not null)::text as got, 'true' as want
union all
select 'guard trigger armed',
       (select count(*)::text from pg_trigger where tgrelid='public.city_state'::regclass and tgname='city_state_guard_trg'), '1'
union all
select 'anon can still write cities',
       has_table_privilege('anon','public.city_state','UPDATE')::text, 'false'
union all
select 'players can delete cities',
       has_table_privilege('authenticated','public.city_state','DELETE')::text, 'false'
union all
select 'season purge still blanks cities',
       (pg_get_functiondef((select oid from pg_proc where proname='_season_purge_apply'
                             and pronamespace='public'::regnamespace))
        ilike '%update public.city_state set state%')::text, 'false'
union all
select 'recoverable versions on file',
       (select count(*)::text from public.city_state_history), '>= 24 after seeding'
union all
select 'players with a recoverable city',
       (select count(distinct user_id)::text from public.city_state_history), 'the 24 from the backup';
