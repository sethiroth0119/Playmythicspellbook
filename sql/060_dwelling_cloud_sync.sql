-- ════════════════════════════════════════════════════════════════════════════
-- 060 — MY DWELLING: the house follows the ACCOUNT, not the device
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. Ends with a verify block.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MAKES TRUE THAT WAS NOT
--   The dwelling's persistence fix (v121i2) made the LOCAL save honest: a load
--   gate, a loss guard, a snapshot ring, revisions. All of it is IndexedDB with
--   a localStorage fallback, which is DEVICE-LOCAL. So two things from the
--   original brief were never covered and it would have been dishonest to imply
--   otherwise:
--     · "switching devices" — a player's home simply does not exist on their
--       phone, and never did;
--     · "restore from purchase history" — decoration packs bought with real
--       currency lived in the same device-local blob as the layout, so clearing
--       site data cost the player things they had PAID FOR.
--   This file is the account-side half.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 THE THREE RULES THAT MAKE A SECOND DEVICE SAFE
--
--   1. THE LOSS GUARD IS ENFORCED HERE TOO, NOT ONLY IN THE IFRAME.
--      The client guard cannot protect the cloud copy, because the dangerous
--      case is precisely a client that believes the house is empty. A phone
--      that opens the dwelling before its first load completes would push
--      `items: []` and erase a layout built over weeks on the desktop. So
--      dwelling_save() refuses a write that drops the item count by more than
--      DROP_ALLOWED unless the caller says, explicitly, that the player emptied
--      the room themselves.
--
--   2. REVISIONS GO FORWARD ONLY.
--      Every save carries the rev it is replacing. If the stored rev has moved
--      on, another device saved first and this write is stale — it is refused
--      and the caller is handed the newer document to reconcile against. Last-
--      write-wins across devices is how you lose a room and never find out.
--
--   3. OWNERSHIP IS A UNION AND IS NEVER REDUCED.
--      `owned` (the decoration packs the player has bought) is merged, never
--      replaced. A device that has never seen a purchase cannot un-buy it, a
--      corrupted document cannot cost a player money, and "restore from
--      purchase history" is simply what a fresh device already does on load.
--      This is the same reasoning as the vehicle union-by-id in the Prince
--      Portfolio fix: an OWNED thing may be added by any device and removed by
--      none.
--
-- ⚠ THE LAYOUT IS A BLOB AND THAT IS DELIBERATE. Per-object columns would make
--   this a schema that has to change every time a new piece of furniture ships.
--   The server does not need to understand a sofa; it needs to know how many
--   objects there are (rule 1) and which revision it is (rule 2). Both are
--   stored as real columns beside the blob so no policy or guard ever has to
--   parse JSON to make a decision.
--
-- ⚠ THE IFRAME HAS NO SUPABASE CLIENT. /dwelling/index.html is sandboxed and
--   talks to the game by postMessage. These RPCs are therefore called by the
--   PARENT (public/index.html), which already holds the authenticated client,
--   and the result is posted back down. Nothing here assumes otherwise.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The house ────────────────────────────────────────────────────────────
create table if not exists public.player_dwellings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  rev         int         not null default 0 check (rev >= 0),
  item_count  int         not null default 0 check (item_count >= 0),
  doc         jsonb       not null default '{}'::jsonb,
  -- Kept OUT of the blob on purpose: rule 3 unions this column, and a value the
  -- merge logic has to dig out of a document is a value a bad document can hide.
  owned       jsonb       not null default '[]'::jsonb,
  saved_at    timestamptz not null default now(),
  device      text,
  updated_at  timestamptz not null default now()
);

-- ── 2. The snapshot ring, server side ───────────────────────────────────────
-- The client keeps its own ring; this one survives the device. Append-only, and
-- trimmed by the save RPC rather than by a policy, so "how many do we keep" is
-- one number in one place.
create table if not exists public.player_dwelling_snapshots (
  id         bigserial primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  rev        int         not null,
  item_count int         not null,
  doc        jsonb       not null,
  created_at timestamptz not null default now()
);
create index if not exists pdwell_snap_user
  on public.player_dwelling_snapshots (user_id, created_at desc);

-- ── 3. RLS — every table, same migration ────────────────────────────────────
-- ⚠ READ-ONLY FOR THE OWNER, WRITE ONLY THROUGH THE RPCs. There is no INSERT or
--   UPDATE policy on player_dwellings on purpose: the loss guard and the
--   revision check are the entire value of this table, and a direct UPDATE
--   route would let any client walk straight past both. The SELECT policy
--   exists so a client can read its own house without an RPC round trip.
alter table public.player_dwellings          enable row level security;
alter table public.player_dwelling_snapshots enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='player_dwellings'
                   and policyname='pdwell_sel_own') then
    create policy pdwell_sel_own on public.player_dwellings
      for select to authenticated using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='player_dwelling_snapshots'
                   and policyname='pdwell_snap_sel_own') then
    create policy pdwell_snap_sel_own on public.player_dwelling_snapshots
      for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;

-- ── 4. How much loss is allowed without the player saying so ────────────────
-- A single accidental drag can delete one item; a broken load deletes all of
-- them. The client counts DELIBERATE removals and passes them in, so this is
-- only ever the backstop for a client that lost its own state.
create or replace function public._dwell_drop_allowed(p_before int)
returns int language sql immutable as $$
  -- Three items, or a fifth of the room, whichever is larger. A room of 4 may
  -- lose 3; a room of 60 may lose 12. Below that it is a player tidying up.
  select greatest(3, (p_before / 5)::int);
$$;

-- ── 5. LOAD ─────────────────────────────────────────────────────────────────
create or replace function public.dwelling_load()
returns table (rev int, item_count int, doc jsonb, owned jsonb, saved_at timestamptz)
language sql security definer set search_path = public as $$
  select d.rev, d.item_count, d.doc, d.owned, d.saved_at
    from public.player_dwellings d
   where d.user_id = auth.uid();
$$;

-- ── 6. SAVE ─────────────────────────────────────────────────────────────────
-- Returns a verdict rather than raising, because every refusal here is a thing
-- the player must be TOLD ('another device saved first', 'that would delete 40
-- items') and an exception string is not a user-facing sentence.
--
--   p_base_rev        the rev the client believes it is replacing
--   p_item_count      how many objects are in the document being saved
--   p_explicit_removals how many the player deleted on purpose this session
--   p_owned           packs this device knows about — UNIONED, never replacing
create or replace function public.dwelling_save(
  p_doc               jsonb,
  p_base_rev          int,
  p_item_count        int,
  p_explicit_removals int  default 0,
  p_owned             jsonb default '[]'::jsonb,
  p_device            text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_cur   public.player_dwellings%rowtype;
  v_drop  int;
  v_owned jsonb;
  v_rev   int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'anon',
      'msg', 'You are signed out — your home was not saved to the cloud.');
  end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'baddoc', 'msg', 'Malformed home document.');
  end if;
  if p_item_count is null or p_item_count < 0 then
    return jsonb_build_object('ok', false, 'code', 'badcount', 'msg', 'Malformed item count.');
  end if;

  select * into v_cur from public.player_dwellings where user_id = v_uid for update;

  -- First save ever: nothing to guard against.
  if not found then
    insert into public.player_dwellings (user_id, rev, item_count, doc, owned, saved_at, device, updated_at)
    values (v_uid, 1, p_item_count, p_doc,
            coalesce(p_owned, '[]'::jsonb), now(), p_device, now());
    return jsonb_build_object('ok', true, 'rev', 1, 'created', true,
                              'owned', coalesce(p_owned, '[]'::jsonb));
  end if;

  -- RULE 2 — revisions go forward only.
  if p_base_rev is null or p_base_rev < v_cur.rev then
    return jsonb_build_object(
      'ok', false, 'code', 'stale', 'rev', v_cur.rev,
      'msg', 'Another device saved your home more recently. Nothing was overwritten.',
      'doc', v_cur.doc, 'item_count', v_cur.item_count, 'owned', v_cur.owned);
  end if;

  -- RULE 1 — the loss guard, minus what the player deleted on purpose.
  v_drop := v_cur.item_count - p_item_count - greatest(0, coalesce(p_explicit_removals, 0));
  if v_drop > public._dwell_drop_allowed(v_cur.item_count) then
    -- The refused document is kept as a snapshot, NOT discarded: if the guard
    -- is ever wrong, the player's work still exists somewhere.
    insert into public.player_dwelling_snapshots (user_id, rev, item_count, doc)
    values (v_uid, v_cur.rev, p_item_count, p_doc);
    return jsonb_build_object(
      'ok', false, 'code', 'loss', 'rev', v_cur.rev,
      'msg', format('SAVE BLOCKED — %s items are stored and this device only has %s. Your home was not overwritten.',
                    v_cur.item_count, p_item_count),
      'doc', v_cur.doc, 'item_count', v_cur.item_count, 'owned', v_cur.owned);
  end if;

  -- RULE 3 — ownership is a union and is never reduced.
  select coalesce(jsonb_agg(distinct e), '[]'::jsonb) into v_owned
    from (
      select jsonb_array_elements(v_cur.owned) as e
      union
      select jsonb_array_elements(coalesce(p_owned, '[]'::jsonb)) as e
    ) u;

  -- Snapshot what we are ABOUT to replace, never what we are writing.
  insert into public.player_dwelling_snapshots (user_id, rev, item_count, doc)
  values (v_uid, v_cur.rev, v_cur.item_count, v_cur.doc);

  v_rev := v_cur.rev + 1;
  update public.player_dwellings
     set rev = v_rev, item_count = p_item_count, doc = p_doc, owned = v_owned,
         saved_at = now(), device = coalesce(p_device, device), updated_at = now()
   where user_id = v_uid;

  -- Trim the ring. 10 is generous for a decoration layout and bounded.
  delete from public.player_dwelling_snapshots
   where id in (select id from public.player_dwelling_snapshots
                 where user_id = v_uid order by created_at desc offset 10);

  return jsonb_build_object('ok', true, 'rev', v_rev, 'owned', v_owned);
end $$;

-- ── 7. OWN A PACK — the purchase half, on its own ───────────────────────────
-- Separate from dwelling_save because a purchase must land even if the layout
-- save is refused: those are different facts, and tying them together is how a
-- player pays for a pack and does not get it.
create or replace function public.dwelling_own(p_pack text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_owned jsonb;
begin
  if v_uid is null or p_pack is null or length(trim(p_pack)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'anon');
  end if;
  insert into public.player_dwellings (user_id, owned)
  values (v_uid, jsonb_build_array(to_jsonb(p_pack)))
  on conflict (user_id) do update
    set owned = (
          select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from (
            select jsonb_array_elements(public.player_dwellings.owned) as e
            union select to_jsonb(p_pack) as e) u),
        updated_at = now()
  returning owned into v_owned;
  return jsonb_build_object('ok', true, 'owned', v_owned);
end $$;

-- ── 8. RESTORE — hand back a snapshot the player can see ────────────────────
create or replace function public.dwelling_history()
returns table (rev int, item_count int, created_at timestamptz)
language sql security definer set search_path = public as $$
  select s.rev, s.item_count, s.created_at
    from public.player_dwelling_snapshots s
   where s.user_id = auth.uid()
   order by s.created_at desc;
$$;

-- ⚠ RESTORE DELIBERATELY GOES THROUGH dwelling_save's RULES. It reads the
--   snapshot and writes it as a NEW revision rather than rewinding `rev`, so
--   restoring is itself undoable and a second device is never handed a rev
--   number it has already seen meaning something else.
create or replace function public.dwelling_restore(p_created_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_snap public.player_dwelling_snapshots%rowtype; v_cur int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'anon'); end if;
  select * into v_snap from public.player_dwelling_snapshots
   where user_id = v_uid and created_at = p_created_at limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'nosnap', 'msg', 'That version is no longer stored.');
  end if;
  select rev into v_cur from public.player_dwellings where user_id = v_uid;
  -- A restore is an intentional replacement, so every removal it implies is
  -- explicit by definition. That is the ONE place the guard is told to stand
  -- down, and it is told so by the server, not by a client claim.
  return public.dwelling_save(v_snap.doc, coalesce(v_cur, 0), v_snap.item_count,
                              2147483647, '[]'::jsonb, 'restore');
end $$;

grant execute on function public.dwelling_load()      to authenticated;
grant execute on function public.dwelling_save(jsonb, int, int, int, jsonb, text) to authenticated;
grant execute on function public.dwelling_own(text)   to authenticated;
grant execute on function public.dwelling_history()   to authenticated;
grant execute on function public.dwelling_restore(timestamptz) to authenticated;

-- ── 9. VERIFY ───────────────────────────────────────────────────────────────
select 'tables' as check,
       (select count(*) from information_schema.tables
         where table_schema='public'
           and table_name in ('player_dwellings','player_dwelling_snapshots')) as found,
       2 as expected;

select 'rls enabled' as check, relname, relrowsecurity
  from pg_class where relname in ('player_dwellings','player_dwelling_snapshots');

select 'policies' as check, tablename, policyname, cmd
  from pg_policies where schemaname='public'
   and tablename in ('player_dwellings','player_dwelling_snapshots')
 order by tablename, policyname;

-- 🔴 THIS ONE MUST RETURN ZERO ROWS. A write policy on player_dwellings would
--    route around the loss guard and the revision check, which is the whole
--    reason the table exists.
select 'NO write policy may exist on player_dwellings' as check, policyname, cmd
  from pg_policies
 where schemaname='public' and tablename='player_dwellings'
   and cmd in ('INSERT','UPDATE','DELETE','ALL');

select 'functions' as check, proname
  from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('dwelling_load','dwelling_save','dwelling_own',
                   'dwelling_history','dwelling_restore','_dwell_drop_allowed')
 order by proname;

select 'drop allowance' as check,
       public._dwell_drop_allowed(4)  as room_of_4_may_lose,
       public._dwell_drop_allowed(60) as room_of_60_may_lose;
