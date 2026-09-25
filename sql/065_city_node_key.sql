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
-- ⚠ SUPERSEDED BY 102. This version copies the archived state verbatim, so the
--   restored row keeps the savedAt of the moment it was archived, and the
--   client's local-newer-wins rule (B.loadCity in node-city) hands the player
--   their device's blob instead — 27,754 of 27,754 archived rows on 2026-09-04
--   were older than their live row. 102 redefines city_restore to stamp the
--   restored state with savedAt = now so it is the newest copy anywhere. Keep
--   applying this file first; 102 replaces the body.
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
