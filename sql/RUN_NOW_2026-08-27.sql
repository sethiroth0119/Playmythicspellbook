-- ═══════════════════════════════════════════════════════════════════════════
-- RUN-NOW · 2026-08-27 — all four migrations, in order, in one paste
--
-- HOW TO RUN THIS
--   1. Supabase Dashboard -> your project -> SQL Editor -> New query
--   2. Select ALL of this file, paste it in, press Run
--   3. Read the verify block at the very bottom — every line should read
--      got = want. If one does not, stop and send me that line.
--
-- THE ORDER IS NOT ARBITRARY. 064 and 067 make the damage RECOVERABLE;
-- 065 and 066 change how data is keyed and paired. Recoverability first, so
-- there is a safety net under the migrations that move live player data.
--
-- The SQL editor runs this as one transaction: if any statement fails,
-- NOTHING is committed and the database is exactly as it was. Re-running the
-- whole file is safe — every file in it is idempotent.
--
-- AFTER IT SUCCEEDS, the restore commands are at the bottom of this file.
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- ##  sql/064_cities_never_wipe.sql
-- ##  CITIES · history + refusal to destroy + seed from the 25 Aug backup
-- ###########################################################################

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


-- ###########################################################################
-- ##  sql/065_city_node_key.sql
-- ##  CITIES · the cause: the all-zeros node key, and city_claim_node()
-- ###########################################################################

-- ════════════════════════════════════════════════════════════════════════════
-- 065 · THE NODE KEY — why five players' cities overwrite each other
--
-- ⚠ RUN 064 FIRST. 064 makes city loss recoverable and refuses the destructive
--   write. This file removes the reason it was happening. Running 065 without
--   064 means fixing the cause with no safety net under the migration, which is
--   the wrong order for a change that re-keys live player data.
--
-- ── THE BUG, END TO END ────────────────────────────────────────────────────
--
--   Two tables disagree about what a node id IS.
--
--     city_profiles.node_id   text   'local-city', 'N-20', or a uuid
--     city_state.node_id      uuid   uuid only
--
--   city_state's key is (user_id, node_id), so it is built to hold one city per
--   node. But the client cannot put a non-uuid in a uuid column, so
--   _cityNodeKey() in index.html does this:
--
--       return /^[0-9a-f-]{36}$/i.test(n) ? n : CITY_NODE_SENTINEL;
--
--   Every node id that is not uuid-shaped silently becomes the all-zeros
--   sentinel. Live counts, 2026-08-26:
--
--       city_state rows                          12
--       …with node_id = the sentinel             12    ← all of them
--       city_profiles on 'local-city'             9 players
--       players holding cities on 2+ nodes        5
--
--   Every city, on every node, is being written into ONE row per player. The
--   autosave from city B lands on top of city A. That is the whole report:
--   "people's cities keep being removed and vanished."
--
--   It is also the unfixed half of a bug that was already reported and
--   half-fixed — see the note at _openNodeCity in index.html, "I go to a
--   client's node and their city shows, then go back to my own and my city
--   never appears". The FRAME half was fixed in that pass. The KEY half is this.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
--   Make city_state.node_id text, exactly like city_profiles.node_id, so the
--   real anchor id survives. Then the client can stop discarding it.
--
--   ⚠ AND THE MIGRATION HAZARD, WHICH IS THE DANGEROUS PART:
--     the moment the client starts keying on the real node id, every existing
--     player's city — all of which live under the sentinel — stops being found.
--     The read misses, the player is handed an EMPTY GRID, and they build over
--     nothing while their real city sits one key away. That is a worse outcome
--     than the bug. city_claim_node() below is what stops it, and the client
--     MUST call it before it is ever allowed to conclude "you have no city".
--
-- Idempotent and re-runnable. Ends with a verify query.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1. node_id: uuid -> text
-- ════════════════════════════════════════════════════════════════════════════
-- Checked before writing this: no foreign key references city_state.node_id, no
-- view reads it, and none of the five RLS policies mention it (they all key on
-- user_id / mayor_id). The primary key index rebuilds; there are 12 rows.
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema='public' and table_name='city_state' and column_name='node_id') = 'uuid' then

    alter table public.city_state
      alter column node_id type text using node_id::text;

    -- The sentinel keeps its exact spelling, so a client that has not shipped
    -- yet keeps matching the same rows it always did. This migration is
    -- deliberately a no-op for the old client.
    alter table public.city_state
      alter column node_id set default '00000000-0000-0000-0000-000000000000';
  end if;
end $$;

-- The same guard the uuid type used to give for free: no empty string, no
-- absurd length, and the sentinel remains legal.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid='public.city_state'::regclass and conname='city_state_node_id_sane') then
    alter table public.city_state
      add constraint city_state_node_id_sane
      check (node_id is not null and char_length(node_id) between 1 and 64);
  end if;
end $$;

-- ⚠ city_recovery (064 §5) SELECTS history.node_id, and Postgres refuses to
--   alter a column a view depends on: '0A000: cannot alter type of a column used
--   by a view or rule'. Hit on the first apply. The view is dropped here and
--   rebuilt below rather than the alter being skipped.
drop view if exists public.city_recovery;

-- 064's history table typed node_id as uuid to match. Widen it too, or the
-- archive trigger starts throwing the moment a real node id is written.
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema='public' and table_name='city_state_history' and column_name='node_id') = 'uuid' then
    alter table public.city_state_history alter column node_id type text using node_id::text;
  end if;
end $$;

-- city_restore's signature carried the uuid too. Replace it with the text form
-- and drop the old one so there is exactly one function to call.
drop function if exists public.city_restore(uuid, bigint, uuid);
create or replace function public.city_restore(
  p_user uuid, p_history_id bigint, p_node text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h public.city_state_history; v_node text; v_had int;
begin
  if not public.ms_is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  select * into v_h from public.city_state_history where id = p_history_id;
  if v_h is null then raise exception 'no such history row' using errcode = 'P0002'; end if;
  if v_h.user_id <> p_user then
    raise exception 'that history row belongs to a different player' using errcode = '22023';
  end if;

  v_node := coalesce(p_node, v_h.node_id, '00000000-0000-0000-0000-000000000000');
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
revoke all on function public.city_restore(uuid, bigint, text) from public, anon;
grant execute on function public.city_restore(uuid, bigint, text) to authenticated;

-- Rebuilt now that the column is text.
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
-- 2. THE ADOPTION — what stops the fix from looking like the bug
-- ════════════════════════════════════════════════════════════════════════════
-- Called by the client on every city open, BEFORE it is allowed to decide the
-- player has no city here.
--
--   · already have a row for this node          → nothing to do
--   · no row for this node, and my ONLY city is
--     the sentinel one, and it is non-empty     → re-key it to this node
--   · anything else                             → null; genuinely a new city
--
-- ⚠ THE SECOND BRANCH IS A JUDGEMENT CALL AND IT IS WRITTEN DOWN AS ONE.
--   A player who really did own two cities has already lost one to the bug —
--   that is what the bug DID — so at migration time there is exactly one save
--   left and no way to know which node it belonged to. Adopting it to the first
--   node they open is a guess. It is the right guess, because the alternative
--   is handing them an empty grid while their city sits one key away, and
--   because 064 archives the row before the re-key, so a wrong guess is undone
--   with city_restore() rather than lived with.
--
-- ⚠ ONE-WAY AND ONE-TIME. Once the sentinel row is re-keyed there is no
--   sentinel row left, so the branch cannot fire again for that player and a
--   second node correctly starts empty.
create or replace function public.city_claim_node(p_node text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sent constant text := '00000000-0000-0000-0000-000000000000';
  v_rows int; v_tiles int; v_state jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_node is null or p_node = '' then return jsonb_build_object('ok', false, 'reason', 'no_node'); end if;

  -- Already keyed correctly. The overwhelmingly common case after migration.
  if exists (select 1 from public.city_state where user_id = v_uid and node_id = p_node) then
    return jsonb_build_object('ok', true, 'action', 'none');
  end if;

  -- Opening the original city itself: nothing to adopt, the sentinel IS the key.
  if p_node = v_sent then
    return jsonb_build_object('ok', true, 'action', 'none');
  end if;

  select count(*) into v_rows from public.city_state where user_id = v_uid;
  if v_rows <> 1 then
    return jsonb_build_object('ok', true, 'action', 'new_city', 'rows', v_rows);
  end if;

  select state, public.city_tile_count(state) into v_state, v_tiles
    from public.city_state where user_id = v_uid and node_id = v_sent;

  if v_state is null then
    return jsonb_build_object('ok', true, 'action', 'new_city');
  end if;
  -- An empty sentinel row is not a city worth adopting; let this node start clean.
  if coalesce(v_tiles, 0) = 0 then
    return jsonb_build_object('ok', true, 'action', 'new_city', 'reason', 'sentinel_empty');
  end if;

  update public.city_state
     set node_id = p_node, updated_at = now()
   where user_id = v_uid and node_id = v_sent;

  insert into public.city_state_history
    (user_id, node_id, state, reason, tiles, bytes)
  values (v_uid, p_node, v_state, 'claim_node', v_tiles, length(v_state::text));

  return jsonb_build_object('ok', true, 'action', 'adopted', 'tiles', v_tiles, 'node', p_node);
end $$;

revoke all on function public.city_claim_node(text) from public, anon;
grant execute on function public.city_claim_node(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════════════
select 'city_state.node_id type' as check,
       (select data_type from information_schema.columns
         where table_schema='public' and table_name='city_state' and column_name='node_id') as got,
       'text' as want
union all
select 'history node_id type',
       (select data_type from information_schema.columns
         where table_schema='public' and table_name='city_state_history' and column_name='node_id'), 'text'
union all
select 'city_claim_node exists',
       (to_regprocedure('public.city_claim_node(text)') is not null)::text, 'true'
union all
select 'rows still on the sentinel',
       (select count(*)::text from public.city_state
         where node_id = '00000000-0000-0000-0000-000000000000'),
       '12 now; falls as players open their cities and adopt'
union all
select 'players holding 2+ cities (per profiles)',
       (select count(*)::text from (select owner_id from public.city_profiles
                                     group by owner_id having count(*) > 1) x),
       '5 — these are the players the bug was eating';


-- ###########################################################################
-- ##  sql/067_market_never_vanishes.sql
-- ##  MARKET · history + the guard that closes the any-player-can-rewrite hole
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- 067 · THE MARKET NEVER VANISHES — history, and a refusal to destroy
--
-- ⚠ THIS FILE HAS NOT BEEN APPLIED. NOTHING IN IT HAS RUN ANYWHERE.
--   Nobody in the environment that wrote it can execute SQL against project
--   ktsiasyjusesawtrwrjc — no database connection, no service-role key, no
--   migration runner. Listings are being lost on the live server EXACTLY as
--   they were before this file existed, and stay that way until a human opens
--       https://supabase.com/dashboard/project/ktsiasyjusesawtrwrjc/sql/new
--   pastes this in, and clicks Run.
--
-- ── THE REPORT ─────────────────────────────────────────────────────────────
--   "Items that were in the player market have been removed. I said do not
--    remove anything that is added, anything saved — make sure it isn't
--    removed. Restore all items that were missing on the marketplace."
--
-- ── WHAT WAS FOUND, READING THE SHIPPED CODE AND THE SHIPPED RLS ───────────
--
--   1. 🔴 ANY SIGNED-IN PLAYER CAN REWRITE ANY LIVE LISTING. This is the one
--      that removes other people's items, and it needs no bug to fire — the
--      policy grants it:
--
--        create policy cml_upd on public.card_market_listings
--          for update to authenticated
--          using (status = 'open' or seller_id = auth.uid())
--          with check (true);
--
--      `using (status = 'open')` is EVERY live listing in the game, and
--      `with check (true)` places no limit on what the row may become. So one
--      account can flip another player's listing to status='sold' — it leaves
--      the board instantly and looks exactly like "my item was removed" — or
--      rewrite its price, its buyer, or its seller_id. The policy exists
--      because a BUYER has to be able to claim an open row (index.html:59797,
--      :59905, :59682 all UPDATE somebody else's listing), and a policy alone
--      cannot express "only this transition" because RLS cannot see OLD.
--      A trigger can. §2 is that trigger.
--
--   2. 🔴 EXPIRY IS A HARD DELETE, AND THE RETURN IS CLIENT-SIDE.
--      index.html:59669 — every time the market loads, the client finds its own
--      listings older than CARD_MARKET_TTL_MS (14 days) and DELETEs the row,
--      then hands the card back with _restoreCardCopy(). The row is destroyed
--      first and the item is re-granted second, in the browser, by a save that
--      may never be written. Close the tab in between and the listing is gone
--      from the database and the card is not in the collection. There is no
--      copy of the row anywhere. Same shape at :59694 for an auction that ends
--      with no bids.
--
--   3. Nothing else in this repo deletes a listing — no cron job, no admin
--      wipe, no cascade other than `on delete cascade` from auth.users (which
--      only fires if the ACCOUNT is deleted). Ruled out by search, not assumed.
--
-- ── WHAT THIS FILE DOES ────────────────────────────────────────────────────
--   §1 every version of every listing is kept forever, append-only, including
--      the version that was about to be deleted
--   §2 a write that is not a legal market transition is REFUSED, not archived-
--      and-allowed. Closes the hole in 1 without breaking the current client.
--   §3 `anon` cannot touch the table at all
--   §4 restore: what is recoverable is recovered, and what is not is NAMED
--   §5 the same archive treatment for resource_listings, if it exists
--
-- ⚠ DELETE IS DELIBERATELY STILL ALLOWED TO THE SELLER. Revoking it would
--   break the expiry path in 2 — the client only returns the card when the
--   delete reports a row — and an expired listing would then sit on the board
--   forever with the card locked inside it. The delete now copies the row to
--   history first, so the destructive half is gone while the client keeps
--   working unchanged. Making expiry a status flip is a CLIENT change and is
--   listed at the end of this file, not done here.
--
-- Idempotent and re-runnable. RLS ships in this file. Ends with a verify query.
-- Modelled on sql/064_cities_never_wipe.sql, which does this for cities.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. A shared admin test (062/064 create this; repeated so 067 can run alone)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.ms_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in (
    'richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com');
$$;
revoke all on function public.ms_is_admin() from public;
grant execute on function public.ms_is_admin() to authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0b. READ-ONLY DIAGNOSIS — run this section on its own FIRST if you want to
--     see the damage before changing anything. It writes nothing.
-- ═══════════════════════════════════════════════════════════════════════════
--   select status, count(*), min(created_at), max(created_at)
--     from public.card_market_listings group by status order by 2 desc;
--
--   -- listings that left the board but are still in the table: RECOVERABLE
--   select count(*) as sold_with_no_buyer
--     from public.card_market_listings
--    where status = 'sold' and buyer_id is null;
--
--   -- who is holding what
--   select seller_id, seller_name, status, count(*)
--     from public.card_market_listings group by 1,2,3 order by 4 desc limit 50;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. HISTORY — every version of every listing, forever
--
-- The trigger in §2 writes here BEFORE the row changes or disappears, so the
-- copy exists even when the change is one that gets refused later in the same
-- statement. Append-only by grant: nothing but the definer functions may
-- update or delete a history row.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.card_market_listings_history (
  hid           bigserial primary key,
  id            uuid not null,
  seller_id     uuid,
  seller_name   text,
  kind          text,
  card_id       text,
  card_json     jsonb,
  unit_json     jsonb,
  listing_type  text,
  currency      text,
  price         integer,
  starting_bid  integer,
  current_bid   integer,
  current_bidder_id uuid,
  buy_now_price integer,
  bid_history   jsonb,
  ends_at       timestamptz,
  buyer_id      uuid,
  status        text,
  paid_out      boolean,
  row_created   timestamptz,
  reason        text not null,           -- 'update' | 'delete' | 'seed' | 'restore'
  actor_id      uuid,                    -- who caused it (auth.uid() at the time)
  archived_at   timestamptz not null default now()
);
create index if not exists cmlh_id_idx     on public.card_market_listings_history (id, archived_at desc);
create index if not exists cmlh_seller_idx on public.card_market_listings_history (seller_id, archived_at desc);
create index if not exists cmlh_reason_idx on public.card_market_listings_history (reason, archived_at desc);

alter table public.card_market_listings_history enable row level security;

-- A player may read their own history (their listings, their purchases).
-- Admins read everything. Nobody writes through the API — only the triggers,
-- which run as definer.
drop policy if exists cmlh_sel on public.card_market_listings_history;
create policy cmlh_sel on public.card_market_listings_history
  for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.ms_is_admin());

revoke insert, update, delete on public.card_market_listings_history from anon, authenticated;
revoke all on public.card_market_listings_history from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE GUARD — archive first, then allow only a legal transition
--
-- RLS cannot express this: a policy sees only the NEW row, so it cannot say
-- "status may go open→sold but nothing else may move". A BEFORE trigger sees
-- OLD and NEW and can. The legal transitions below are exactly the ones the
-- shipped client performs, so applying this file changes nothing a player can
-- legitimately do and refuses everything else.
--
--   SELLER (or admin) may:  price, starting_bid, buy_now_price, ends_at,
--                           paid_out, status → 'cancelled' | 'sold' | 'open'
--   BUYER  may, and only in one of these two shapes:
--       CLAIM  status 'open' → 'sold', buyer_id = self
--              (current_bid / current_bidder_* may move with it — Buy Now
--               writes them in the same statement, index.html:59905)
--       BID    status stays 'open', current_bid strictly increases,
--              current_bidder_id = self, bid_history may grow
--   NOBODY may change: id, seller_id, kind, card_id, card_json, unit_json,
--                      listing_type, currency, created_at.
--      That list is the identity of the listing. A market where the seller of
--      a row can be rewritten is not a market.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cml_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.ms_is_admin();
  v_seller boolean;
begin
  -- ── archive the outgoing version FIRST, whatever happens next ────────────
  insert into public.card_market_listings_history
    (id, seller_id, seller_name, kind, card_id, card_json, unit_json, listing_type,
     currency, price, starting_bid, current_bid, current_bidder_id, buy_now_price,
     bid_history, ends_at, buyer_id, status, paid_out, row_created, reason, actor_id)
  values
    (OLD.id, OLD.seller_id, OLD.seller_name, OLD.kind, OLD.card_id, OLD.card_json,
     OLD.unit_json, OLD.listing_type, OLD.currency, OLD.price, OLD.starting_bid,
     OLD.current_bid, OLD.current_bidder_id, OLD.buy_now_price, OLD.bid_history,
     OLD.ends_at, OLD.buyer_id, OLD.status, OLD.paid_out, OLD.created_at,
     lower(TG_OP), v_uid);

  if TG_OP = 'DELETE' then
    -- The row is now recoverable, so the delete may proceed. Only the seller
    -- can reach here at all (policy cml_del), and the client only fires it for
    -- an expired or bidless listing.
    return OLD;
  end if;

  v_seller := (v_uid is not null and v_uid = OLD.seller_id);

  -- ── identity is immutable for everyone, including the seller ─────────────
  if NEW.id            is distinct from OLD.id
     or NEW.seller_id  is distinct from OLD.seller_id
     or NEW.kind       is distinct from OLD.kind
     or NEW.card_id    is distinct from OLD.card_id
     or NEW.card_json  is distinct from OLD.card_json
     or NEW.unit_json  is distinct from OLD.unit_json
     or NEW.listing_type is distinct from OLD.listing_type
     or NEW.currency   is distinct from OLD.currency
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'market: a listing''s identity cannot be rewritten (id/seller/card/type)'
      using errcode = 'check_violation';
  end if;

  if v_admin or v_seller then
    return NEW;                       -- the owner may manage their own listing
  end if;

  -- ── from here down the writer is NOT the seller ──────────────────────────
  if v_uid is null then
    raise exception 'market: anonymous writes are not allowed' using errcode = 'check_violation';
  end if;

  -- CLAIM: open → sold, by the buyer, naming themselves
  if OLD.status = 'open' and NEW.status = 'sold' and NEW.buyer_id = v_uid then
    if NEW.price is distinct from OLD.price
       or NEW.starting_bid  is distinct from OLD.starting_bid
       or NEW.buy_now_price is distinct from OLD.buy_now_price
       or NEW.ends_at       is distinct from OLD.ends_at
       or NEW.paid_out      is distinct from OLD.paid_out then
      raise exception 'market: a buyer may not change the terms while buying'
        using errcode = 'check_violation';
    end if;
    return NEW;
  end if;

  -- BID: stays open, the bid goes UP, the bidder names themselves
  if OLD.status = 'open' and NEW.status = 'open'
     and NEW.buyer_id is not distinct from OLD.buyer_id
     and NEW.current_bidder_id = v_uid
     and coalesce(NEW.current_bid, 0) > coalesce(OLD.current_bid, 0) then
    if NEW.price is distinct from OLD.price
       or NEW.starting_bid  is distinct from OLD.starting_bid
       or NEW.buy_now_price is distinct from OLD.buy_now_price
       or NEW.ends_at       is distinct from OLD.ends_at
       or NEW.paid_out      is distinct from OLD.paid_out then
      raise exception 'market: a bidder may not change the terms while bidding'
        using errcode = 'check_violation';
    end if;
    return NEW;
  end if;

  -- Anything else by a non-seller is the hole this file closes.
  raise exception 'market: only the seller may change this listing (attempted % → %)',
        OLD.status, NEW.status
    using errcode = 'check_violation';
end $$;

revoke all on function public.cml_guard() from public, anon, authenticated;

drop trigger if exists cml_guard_upd on public.card_market_listings;
create trigger cml_guard_upd
  before update on public.card_market_listings
  for each row execute function public.cml_guard();

drop trigger if exists cml_guard_del on public.card_market_listings;
create trigger cml_guard_del
  before delete on public.card_market_listings
  for each row execute function public.cml_guard();

-- Tighten what is left of the policy. The trigger is the real enforcement —
-- this only stops `anon` and keeps the surface honest.
revoke all on public.card_market_listings from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RESTORE
--
-- 🔴 READ THIS BEFORE RUNNING ANYTHING IN §3.
--   What can be recovered depends entirely on whether the row still exists:
--
--   RECOVERABLE NOW — the row is in the table but off the board. A listing
--     flipped to 'sold' by somebody who never paid for it, or a status this
--     file's guard would now refuse. §3a finds them; §3b re-opens them.
--
--   RECOVERABLE ONLY IF IT WAS ARCHIVED — history starts the moment this file
--     is applied. A row hard-deleted last week was never copied anywhere and
--     is NOT in it. §3c restores from history for everything after today.
--
--   NOT RECOVERABLE HERE — rows hard-deleted before this file was applied.
--     There is no backup table for the market (cities have one,
--     city_state_backup_20260825; the market never got one). The only route
--     is Supabase Point-in-Time Recovery:
--       Dashboard → Database → Backups → Point in Time
--     restore to a timestamp before the loss into a CLONE, then copy the rows
--     out of the clone. Do not PITR the live project over the top of itself —
--     that would roll every other table back with it.
--     If PITR is not enabled on this plan, those rows are gone, and saying so
--     is better than pretending a function can bring them back.
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. WHAT IS SITTING THERE, RECOVERABLE, RIGHT NOW (read-only)
create or replace function public.cml_recoverable()
returns table (id uuid, seller_id uuid, seller_name text, card_id text,
               status text, buyer_id uuid, paid_out boolean, created_at timestamptz, why text)
language sql stable security definer set search_path = public as $$
  select l.id, l.seller_id, l.seller_name, l.card_id, l.status, l.buyer_id,
         l.paid_out, l.created_at,
         case
           when l.status = 'sold' and l.buyer_id is null
             then 'left the board with no buyer — nobody bought this'
           when l.status not in ('open','sold','cancelled')
             then 'unknown status: ' || coalesce(l.status,'(null)')
           else 'off the board'
         end
    from public.card_market_listings l
   where l.status <> 'open'
   order by l.created_at desc;
$$;
revoke all on function public.cml_recoverable() from public, anon;
grant execute on function public.cml_recoverable() to authenticated;

-- 3b. PUT THEM BACK ON THE BOARD.
--     Only touches rows that left with NO buyer — a genuine sale is left alone.
--     Admin-only, and it is itself archived by the guard, so an unwanted
--     restore can be undone from history.
create or replace function public.cml_restore_unsold()
returns table (restored integer, skipped integer)
language plpgsql security definer set search_path = public as $$
declare v_restored integer := 0;
begin
  if not public.ms_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  update public.card_market_listings
     set status = 'open', buyer_id = null
   where status = 'sold' and buyer_id is null;
  get diagnostics v_restored = row_count;
  return query select v_restored,
    (select count(*)::integer from public.card_market_listings
      where status = 'sold' and buyer_id is not null);
end $$;
revoke all on function public.cml_restore_unsold() from public, anon, authenticated;
grant execute on function public.cml_restore_unsold() to authenticated;   -- gated inside

-- 3c. RESURRECT A SPECIFIC LISTING FROM HISTORY (works for anything archived
--     after this file is applied). Re-inserts the newest archived version.
create or replace function public.cml_restore_from_history(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare h public.card_market_listings_history;
begin
  if not public.ms_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.card_market_listings where id = p_id) then
    return 'still present — nothing to restore';
  end if;
  select * into h from public.card_market_listings_history
   where id = p_id order by archived_at desc limit 1;
  if h.hid is null then
    return 'no archived copy — this row predates the history table (see §3, PITR)';
  end if;
  insert into public.card_market_listings
    (id, seller_id, seller_name, kind, card_id, card_json, unit_json, listing_type,
     currency, price, starting_bid, current_bid, current_bidder_id, buy_now_price,
     bid_history, ends_at, buyer_id, status, paid_out, created_at)
  values
    (h.id, h.seller_id, h.seller_name, h.kind, h.card_id, h.card_json, h.unit_json,
     h.listing_type, h.currency, h.price, h.starting_bid, h.current_bid,
     h.current_bidder_id, h.buy_now_price, h.bid_history, h.ends_at, h.buyer_id,
     'open', h.paid_out, h.created_at);
  return 'restored from ' || h.archived_at::text;
end $$;
revoke all on function public.cml_restore_from_history(uuid) from public, anon, authenticated;
grant execute on function public.cml_restore_from_history(uuid) to authenticated;  -- gated inside

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. THE RESOURCE MARKET, same treatment — only if that table exists.
--    Guarded so this file runs on a project that never created it.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.resource_listings') is not null then
    execute $sql$
      create table if not exists public.resource_listings_history (
        hid bigserial primary key,
        row_id uuid,
        payload jsonb not null,
        reason text not null,
        actor_id uuid,
        archived_at timestamptz not null default now()
      );
      alter table public.resource_listings_history enable row level security;
      revoke insert, update, delete on public.resource_listings_history from anon, authenticated;

      create or replace function public.reslisting_archive()
      returns trigger language plpgsql security definer set search_path = public as $fn$
      begin
        insert into public.resource_listings_history (row_id, payload, reason, actor_id)
        values ((to_jsonb(OLD) ->> 'id')::uuid, to_jsonb(OLD), lower(TG_OP), auth.uid());
        -- 🔴 BEFORE UPDATE writes the row it returns. `return OLD` here made every
        --    update to resource_listings a silent no-op (expiry, cancel and sale
        --    never stuck; refunds repeated on every sweep). See sql/113.
        if TG_OP = 'DELETE' then return OLD; end if;
        return NEW;
      end $fn$;

      drop trigger if exists reslisting_archive_upd on public.resource_listings;
      create trigger reslisting_archive_upd before update on public.resource_listings
        for each row execute function public.reslisting_archive();
      drop trigger if exists reslisting_archive_del on public.resource_listings;
      create trigger reslisting_archive_del before delete on public.resource_listings
        for each row execute function public.reslisting_archive();
    $sql$;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — every line should read want = got
-- ═══════════════════════════════════════════════════════════════════════════
select 'history table exists' as check,
       (to_regclass('public.card_market_listings_history') is not null)::text as got,
       'true' as want
union all
select 'guard armed on UPDATE',
       (select count(*)::text from pg_trigger
         where tgrelid = 'public.card_market_listings'::regclass and tgname = 'cml_guard_upd'), '1'
union all
select 'guard armed on DELETE',
       (select count(*)::text from pg_trigger
         where tgrelid = 'public.card_market_listings'::regclass and tgname = 'cml_guard_del'), '1'
union all
select 'anon can write listings',
       has_table_privilege('anon','public.card_market_listings','UPDATE')::text, 'false'
union all
select 'listings off the board, recoverable now',
       (select count(*)::text from public.card_market_listings where status <> 'open'), 'run cml_recoverable() to see them'
union all
select 'open listings on the board',
       (select count(*)::text from public.card_market_listings where status = 'open'), 'the market as players see it';

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTER APPLYING — the two client changes this file deliberately does NOT make
--
--   1. index.html:59669 / :59694 — expiry and bidless-auction reclaim should
--      become `update status='cancelled'` + return, not DELETE + return. The
--      guard makes the delete non-destructive today, but a listing that is
--      cancelled instead of deleted can be shown back to the seller as
--      "returned to you" and audited. That is a code change, not SQL.
--   2. CARD_MARKET_TTL_MS is 14 days (index.html:59562). If the report is
--      "my listing disappeared" and the listing was two weeks old, that is
--      this constant working as designed — decide whether 14 days is the
--      policy you want before treating it as a bug.
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- ##  sql/066_matchmaking_server.sql
-- ##  MATCHMAKING · the pairing trigger, written down as SQL at last
-- ###########################################################################

-- ════════════════════════════════════════════════════════════════════════════
-- 066 · MATCHMAKING, WRITTEN DOWN — the pairing schema leaves the JS string
--
-- ⚠ THIS FILE HAS NOT BEEN APPLIED. NOTHING IN IT HAS RUN ANYWHERE.
--   Nobody in the environment that wrote this file can execute SQL against
--   project ktsiasyjusesawtrwrjc. There is no database connection here, no
--   service-role key, and no migration runner. Pairing behaviour on the live
--   server is EXACTLY what it was before this file existed and stays that way
--   until a human opens
--       https://supabase.com/dashboard/project/ktsiasyjusesawtrwrjc/sql/new
--   pastes this file in, and clicks Run. Until that happens, both bugs
--   described below are still live and still eating real players.
--
-- ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
--   The only thing on earth that can pair two queued players is the
--   try_pair_match() trigger. Its source lived in exactly ONE place in this
--   repo: inside a JavaScript template literal, CLOUD_SQL_SCHEMA, at
--   public/index.html:56674 (function body 56823-56858). It is a comment as
--   far as the running program is concerned. There was no /sql file and no
--   supabase/migrations file for matchmaking_queue, matches, or
--   try_pair_match — so the one server object multiplayer depends on had no
--   migration, no history, and no way to be reviewed as SQL.
--
--   This file carries over ONLY the matchmaking objects from that literal:
--   matchmaking_queue, matches, try_pair_match, trigger_pair_match. It
--   deliberately does NOT carry user_profiles, friends, card_catalog,
--   touch_updated_at, or the storage policies that share that literal. Those
--   sections contain `drop policy if exists` against LIVE tables that this
--   work never intended to touch; re-running them out of a migration file
--   would strip policies off user_profiles and card_catalog for the sake of a
--   matchmaking change. Their home stays CLOUD_SQL_SCHEMA.
--
-- ── 🔴 BUG 1 — THE GHOST AT THE HEAD OF THE QUEUE (no staleness predicate) ──
--   Rows only leave matchmaking_queue three ways: the player is paired, the
--   client calls cloudLeaveMatchmaking(), or the AI-fallback path deletes the
--   row (index.html:182911). Every other exit is a leak — tab closed, browser
--   killed, network dropped, phone slept. Those rows stay in the table for
--   ever.
--
--   try_pair_match then does this:
--
--       order by queued_at asc
--       ...
--       limit 1
--
--   Oldest first. An abandoned row is by definition the oldest row in the
--   band, so it is PINNED at the head of the queue permanently. Every real
--   player who queues is matched against the ghost: a matches row is created,
--   both queue rows are deleted, and the live player is now sitting in a
--   'pending' match against a client that will never connect. They wait, get
--   nothing, and drop to solo-vs-AI. One dead row poisons its whole MMR band
--   indefinitely, and the more the queue leaks the worse it gets.
--
-- ── 🔴 BUG 2 — JUDGED ONCE, NEVER AGAIN (AFTER INSERT is the only trigger) ──
--   trigger_pair_match is `after insert on public.matchmaking_queue`. That is
--   the ONLY moment a row is ever considered for pairing. So the first player
--   into an empty queue is evaluated exactly once, finds nobody, and is never
--   looked at again — not when the second player arrives, not ever. Pairing
--   only works if the SECOND arrival's trigger sees the first. It does, which
--   is why matchmaking works at all, but it means the first player's fate
--   rests entirely on someone else inserting within their 30-second window.
--
--   The fix is mm_try_pair() below: the same pairing body, callable by the
--   waiting player instead of fired by an insert. The client poller
--   (_startMatchmakingPoll, index.html:56110) ticks every 2.5s, and branch (b)
--   of that tick NOW CALLS `Cloud.client.rpc('mm_try_pair')` on every tick, so
--   a waiting player re-evaluates their own position every tick instead of
--   once at insert. That client change has landed; it is driven by
--   .gauntlet/drive-matchmaking.mjs.
--
--   ⚠ WHICH CHANGES NOTHING ABOUT THE PARAGRAPH AT THE TOP OF THIS FILE. This
--   file is still unapplied, so mm_try_pair() does not exist on the server and
--   every one of those rpc calls comes back PGRST202 ("could not find the
--   function ... in the schema cache"). The client records that answer as a
--   DIAGNOSIS and KEEPS CALLING anyway — it does not latch and stop, so a
--   client already sitting on the search screen picks this file up the moment
--   a human applies it, with no page reload. What it also does, once per
--   search and only at the halfway mark, is a delete-then-insert re-queue of
--   its own row: the only lever it has left, because AFTER INSERT is the only
--   trigger there is. That fallback is a workaround for this file being
--   unapplied, not a substitute for it — it re-evaluates the waiting player
--   exactly once more, not every tick, and if the re-INSERT is refused
--   (postgrest-js RESOLVES with { error }; it does not throw) the client
--   un-latches and retries on the next tick, because the DELETE has already
--   landed and a player with no queue row is invisible to the one mechanism
--   above. Bug 2 is only actually fixed when a human runs this file.
--
-- ── ⚠ A CAVEAT THAT WAS FIXED ON THE CLIENT SIDE ────────────────────────────
--   cloudEnterMatchmaking USED TO send `queued_at` from the CLIENT clock,
--   overriding this column's `default now()`. queued_at is what the pairing
--   body sorts on (`order by queued_at asc`) and what the sweep below ages
--   rows out on, so a slow phone jumped to the head of its whole MMR band and
--   a fast one was swept as stale the instant it arrived. The client no longer
--   sends the key at all — neither cloudEnterMatchmaking's insert nor the poll
--   tick's re-queue insert — so Postgres stamps it from the one clock every
--   player in the queue shares. Asserted by .gauntlet/drive-matchmaking.mjs.
--   Keep it that way: do NOT add queued_at back to either client payload.
--
--   And: the sweep is a DELETE over a range, so two concurrent sweeps can take
--   row locks in opposite orders and deadlock. Postgres aborts one of them,
--   which for the trigger means one player's INSERT errors and their client
--   retries on the next poll tick — survivable, but if that ever shows up in
--   the logs, move the sweep to a pg_cron job and leave only the `queued_at >`
--   bound in the two SELECTs.
--
-- Idempotent and re-runnable: every create is `if not exists` / `or replace`,
-- every policy is dropped before it is created, the trigger is dropped before
-- it is created. Ends with a verify query. Contains no DROP TABLE, no
-- TRUNCATE, and no DELETE without a WHERE.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1. matchmaking_queue — one row per user looking for a match
--    (carried over verbatim from CLOUD_SQL_SCHEMA, index.html:56716-56733)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.matchmaking_queue (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  mode       text not null default 'ranked',
  mmr        integer not null default 1000,
  faction_id text,
  hero_id    text,
  queued_at  timestamptz default now()
);

-- Queue needs a deck_json column to store each player's chosen deck so the
-- matchmaker can copy it onto the match row.
-- (Hoisted above the function that reads it — in CLOUD_SQL_SCHEMA this ALTER
--  sits AFTER try_pair_match, which is only survivable because plpgsql does
--  not resolve table columns at CREATE FUNCTION time. Ordering it correctly
--  costs nothing and stops a first-run reader from thinking deck_json is
--  missing.)
alter table public.matchmaking_queue add column if not exists deck_json jsonb default '{}'::jsonb;

alter table public.matchmaking_queue enable row level security;

drop policy if exists "matchmaking_self_all" on public.matchmaking_queue;
create policy "matchmaking_self_all" on public.matchmaking_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Players can also peek at the queue (for "X players in queue" displays).
drop policy if exists "matchmaking_anyone_count" on public.matchmaking_queue;
create policy "matchmaking_anyone_count" on public.matchmaking_queue
  for select using (auth.role() = 'authenticated');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. matches — completed + active matches
--    (carried over verbatim from CLOUD_SQL_SCHEMA, index.html:56734-56765)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  player1_id  uuid not null references auth.users(id),
  player2_id  uuid not null references auth.users(id),
  winner_id   uuid references auth.users(id),
  hero1_id    text,
  hero2_id    text,
  deck1       jsonb,
  deck2       jsonb,
  turns       integer,
  rr1_delta   integer default 0,
  rr2_delta   integer default 0,
  ap1_delta   integer default 0,
  ap2_delta   integer default 0,
  replay      jsonb,
  status      text default 'pending',  -- pending | active | complete
  created_at  timestamptz default now()
);

-- DC-win marker on matches so admins can audit forfeit games.
alter table public.matches add column if not exists dc_win boolean default false;

alter table public.matches enable row level security;
-- Either participant can SELECT the match. INSERTs come from the matchmaker
-- (Edge Function later). For now permit authenticated inserts gated by:
drop policy if exists "matches_participants_select" on public.matches;
create policy "matches_participants_select" on public.matches
  for select using (auth.uid() = player1_id or auth.uid() = player2_id);
drop policy if exists "matches_participants_update" on public.matches;
create policy "matches_participants_update" on public.matches
  for update using (auth.uid() = player1_id or auth.uid() = player2_id);
-- Insert allowed only when the player listing themselves as player1 OR player2.
drop policy if exists "matches_self_insert" on public.matches;
create policy "matches_self_insert" on public.matches
  for insert with check (auth.uid() = player1_id or auth.uid() = player2_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. try_pair_match — the AFTER-INSERT matchmaker
--
--    Body is the one from index.html:56823-56853, changed in exactly TWO
--    places, both marked 🔴 BUG 1 below. The 500-point MMR band, the mode
--    equality, the FOR UPDATE SKIP LOCKED, the insert column list and the
--    two-row cleanup delete are untouched.
-- ════════════════════════════════════════════════════════════════════════════

-- 7) AUTO-PAIRING TRIGGER — server-side matchmaker. When a player INSERTs a
--    queue row, this finds an opponent within their MMR band and creates a
--    matches row pairing them. Both clients hear about the match via the
--    realtime channel they subscribed to in cloudEnterMatchmaking().
create or replace function public.try_pair_match()
returns trigger language plpgsql security definer as $$
declare
  opp record;
  new_match_id uuid;
begin
  -- 🔴 BUG 1 (the ghost at the head of the queue): abandoned rows never leave
  -- the table, and `order by queued_at asc` below picks the OLDEST row, so a
  -- dead row is pinned at the head of its MMR band for ever and every real
  -- player who queues is paired with it. Sweep before we look, so the SELECT
  -- can never see a row this statement was about to remove.
  delete from public.matchmaking_queue where queued_at < now() - interval '45 seconds';

  -- Lock the queue row (avoid race when two players hit insert at the same time)
  select * into opp
  from public.matchmaking_queue
  where user_id <> new.user_id
    and mode = new.mode
    and abs(mmr - new.mmr) < 500
    -- 🔴 BUG 1, second half: the sweep above and this SELECT are separate
    -- statements, so a row can age past the cutoff between them, and a
    -- concurrent inserter's sweep can be rolled back. The bound here is what
    -- actually guarantees the opponent we pair with is live. 45s is chosen to
    -- sit ABOVE MATCHMAKING_AI_FALLBACK_MS (30000 → 30s, index.html:182865):
    -- a row younger than the fallback window belongs to a player who is still
    -- watching the search screen. Shortening this below 30s would start
    -- discarding players who are still waiting.
    and queued_at > now() - interval '45 seconds'
  order by queued_at asc
  for update skip locked
  limit 1;

  if found then
    -- Create the match. Both players have realtime subscriptions on the
    -- matches table filtered by player1_id=eq.self OR player2_id=eq.self.
    insert into public.matches
      (player1_id, player2_id, hero1_id, hero2_id, deck1, deck2, status)
    values
      (opp.user_id, new.user_id, opp.hero_id, new.hero_id, opp.deck_json, new.deck_json, 'pending')
    returning id into new_match_id;

    -- Remove both players from the queue so they aren't matched again.
    delete from public.matchmaking_queue
      where user_id in (opp.user_id, new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists trigger_pair_match on public.matchmaking_queue;
create trigger trigger_pair_match
  after insert on public.matchmaking_queue
  for each row execute function public.try_pair_match();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. mm_try_pair — 🔴 BUG 2: the same pairing body, for the CALLER
--
--    trigger_pair_match is AFTER INSERT only, so a queue row is judged once,
--    at the instant it is written, and never again. The first player into an
--    empty band is therefore never re-evaluated no matter how long they wait.
--    This function is the same matchmaker addressed to whoever calls it, so a
--    waiting player can ask again on every poll tick.
--
--    SECURITY DEFINER because it must insert into `matches` on behalf of BOTH
--    players and delete the OPPONENT's queue row — neither is permitted by the
--    self-scoped RLS policies above. It is scoped by auth.uid() and nothing
--    else: there is no parameter, so a caller cannot aim it at another
--    account. search_path is pinned because a SECURITY DEFINER function that
--    inherits the caller's search_path can be pointed at attacker-owned
--    tables of the same name.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.mm_try_pair()
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  me  record;
  opp record;
  new_match_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- 🔴 BUG 1 (the ghost at the head of the queue): same sweep as the trigger,
  -- and it must run BEFORE anything is selected. Note this can remove the
  -- CALLER's own row — that is correct: a player queued longer than 45s has
  -- already passed MATCHMAKING_AI_FALLBACK_MS (30s) and been dropped to
  -- solo-vs-AI by the client, so pairing them would create a match nobody
  -- shows up to. That is the same dead match bug 1 is about, seen from the
  -- other side.
  delete from public.matchmaking_queue where queued_at < now() - interval '45 seconds';

  select * into me
  from public.matchmaking_queue
  where user_id = auth.uid()
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_queued');
  end if;

  -- Lock the queue row (avoid race when two players hit insert at the same time)
  select * into opp
  from public.matchmaking_queue
  where user_id <> me.user_id
    and mode = me.mode
    and abs(mmr - me.mmr) < 500
    -- 🔴 BUG 1, second half — see try_pair_match above for why 45s and why the
    -- bound is needed in addition to the sweep.
    and queued_at > now() - interval '45 seconds'
  order by queued_at asc
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'paired', false);
  end if;

  -- Same column list and same player1/player2 assignment as the trigger, so a
  -- match created by a poll tick is indistinguishable from one created by an
  -- insert. Both clients read it out of `matches` the same way.
  insert into public.matches
    (player1_id, player2_id, hero1_id, hero2_id, deck1, deck2, status)
  values
    (opp.user_id, me.user_id, opp.hero_id, me.hero_id, opp.deck_json, me.deck_json, 'pending')
  returning id into new_match_id;

  -- Remove both players from the queue so they aren't matched again.
  delete from public.matchmaking_queue
    where user_id in (opp.user_id, me.user_id);

  return jsonb_build_object('ok', true, 'paired', true, 'match_id', new_match_id);
end $$;

-- anon must never reach a SECURITY DEFINER matchmaker: it inserts rows into
-- `matches` naming two auth.users ids, and an unauthenticated caller has no
-- auth.uid() to be scoped by.
revoke execute on function public.mm_try_pair() from anon;
revoke execute on function public.mm_try_pair() from public;
grant execute on function public.mm_try_pair() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
--
-- Run this AFTER the file. Against the function body that is on the server
-- today — the one from CLOUD_SQL_SCHEMA, which has no queued_at bound, no
-- sweep and no companion RPC — rows 1, 2 and 3 return 'false' and row 4
-- returns '0'. If they already say true before you run this file, then either
-- someone else applied it or you are not looking at ktsiasyjusesawtrwrjc.
-- ════════════════════════════════════════════════════════════════════════════
select 'try_pair_match bounds the opponent by queued_at' as check,
       coalesce((select (pg_get_functiondef(oid) ilike '%queued_at > now() - interval ''45 seconds''%')::text
                   from pg_proc
                  where proname = 'try_pair_match'
                    and pronamespace = 'public'::regnamespace), 'MISSING') as got,
       'true' as want
union all
select 'try_pair_match sweeps stale rows',
       coalesce((select (pg_get_functiondef(oid) ilike '%delete from public.matchmaking_queue where queued_at <%')::text
                   from pg_proc
                  where proname = 'try_pair_match'
                    and pronamespace = 'public'::regnamespace), 'MISSING'),
       'true'
union all
select 'mm_try_pair exists',
       (to_regprocedure('public.mm_try_pair()') is not null)::text,
       'true'
union all
select 'mm_try_pair is SECURITY DEFINER with a pinned search_path',
       coalesce((select (prosecdef and proconfig::text ilike '%search_path=public%')::text
                   from pg_proc
                  where proname = 'mm_try_pair'
                    and pronamespace = 'public'::regnamespace), 'MISSING'),
       'true'
union all
select 'anon cannot execute mm_try_pair',
       coalesce((select has_function_privilege('anon', oid, 'EXECUTE')::text
                   from pg_proc
                  where proname = 'mm_try_pair'
                    and pronamespace = 'public'::regnamespace), 'MISSING'),
       'false'
union all
select 'authenticated can execute mm_try_pair',
       coalesce((select has_function_privilege('authenticated', oid, 'EXECUTE')::text
                   from pg_proc
                  where proname = 'mm_try_pair'
                    and pronamespace = 'public'::regnamespace), 'MISSING'),
       'true'
union all
select 'RLS on both matchmaking tables',
       (select count(*)::text from pg_class
         where oid in (to_regclass('public.matchmaking_queue'), to_regclass('public.matches'))
           and relrowsecurity),
       '2'
union all
select 'ghosts still sitting in the queue right now',
       (select count(*)::text from public.matchmaking_queue
         where queued_at < now() - interval '45 seconds'),
       '0 after this file runs; whatever it says before is the size of the bug';


-- ###########################################################################
-- ##  AFTER THE RUN — restoring what was lost
-- ##  These are NOT run by the paste above. Run them one at a time, read the
-- ##  output, then run the next. Nothing here destroys anything.
-- ###########################################################################

-- ── 1. THE MARKET · what is off the board but still recoverable ───────────
-- select * from public.cml_recoverable();

-- ── 2. THE MARKET · put back everything that left with NO buyer ───────────
--     A real sale (buyer_id is set) is left alone. Admin only.
-- select * from public.cml_restore_unsold();

-- ── 3. CITIES · every recoverable version, biggest first ──────────────────
--     `tiles` is how much city is in that version. Pick the biggest one per
--     player unless they tell you otherwise.
-- select id, user_id, node_id, tiles, reason, archived_at
--   from public.city_state_history
--  order by user_id, tiles desc;

-- ── 4. CITIES · restore one player from one history row ───────────────────
--     p_node is optional: leave it null to put the city back where it was.
-- select public.city_restore('<user-uuid>', <history_id>, null);

-- ── 5. CITIES · then have that player OPEN the city once in-game ──────────
--     city_claim_node() re-keys their sentinel city onto the real node the
--     moment they open it, which is what stops the two cities sharing a row.

-- ── 6. WHAT IS NOT RECOVERABLE, AND WHY ───────────────────────────────────
--     Market rows HARD-DELETED BEFORE 067 was applied were never copied
--     anywhere — the market had no backup table (cities did:
--     city_state_backup_20260825). The only route for those is Supabase
--     Point-in-Time Recovery restored into a CLONE, never over the live
--     project, and only if PITR is on your plan. Everything deleted from the
--     moment 067 is applied is recoverable forever.
