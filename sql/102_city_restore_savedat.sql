-- ===========================================================================
-- 102 — city_restore() PUTS THE CITY BACK, AND THE PLAYER'S OWN DEVICE THROWS
--       IT AWAY AGAIN.
--
-- An admin restores an archived city with city_restore(). The row lands. The
-- player opens the city. Their browser still holds the localStorage blob from
-- their last session, and B.loadCity() (node-city, "THE BUILD-VANISHES BUG")
-- takes whichever copy is NEWER by the `savedAt` stamp serialize() writes:
--
--   const ls = _savedAtOf(raw), ss = _savedAtOf(server);
--   if (!B.loadUnsafe && want && sameNode && ls > ss) return raw;   // local
--
-- city_restore() copied `v_h.state` verbatim, so the restored row carried the
-- savedAt of the moment it was ARCHIVED — by construction older than anything
-- the device saved since. The device's copy wins, the next autosave writes it
-- back over the restore, and the admin's fix lasts until the player's next
-- open. Measured on the live history, 2026-09-04:
--
--   archived rows that still have a live row       27,754
--   ...whose savedAt is older than the live row's   27,754   <- every one
--   archived rows with no savedAt at all                 1   (scores 0; also loses)
--
-- So today there is NO history row a restore could hand back that the client's
-- rule would accept over a device that has been played since.
--
-- THE FIX. The restored state is stamped `savedAt = now` (epoch milliseconds,
-- the same unit Date.now() writes) as it is written. The client compares
-- numbers it does not otherwise interpret, so a restore stamped now is simply
-- the newest copy in existence and wins on every device. Nothing in the client
-- changes; the rule that threw the restore away is the rule that now keeps it.
--
-- ⚠ REJECTED: teaching the client to recognise a restore (a flag in the blob,
--   an updated_at check). The client rule is deliberately narrow — three
--   conditions of scar tissue at the site, each one a real overwrite bug — and
--   a fourth path that lets the server beat a strictly-newer local save is a
--   fourth way for the manager-overwrites-owner bug to come back. Making the
--   restore honestly newer is the one fix that adds no rule.
--
-- ⚠ NOT CHANGED: the history row itself. The archive keeps its original stamp
--   so `from_archived_at` and the blob agree about when the city was last
--   played; only the copy written to city_state is re-stamped.
--
-- The one unstamped history row: jsonb_set creates the key (create_missing
-- defaults true), so it restores stamped too. A non-object state (there are
-- none; every live and archived row is a jsonb object) is written through
-- untouched rather than have jsonb_set raise on it.
--
-- There is exactly one overload live, city_restore(uuid, bigint, text) — 065
-- dropped the (uuid, bigint, uuid) form. The drop below is repeated so an
-- environment that skipped 065 cannot keep a stale overload beside this one.
--
-- Idempotent and re-runnable. Verify block at the bottom.
-- ===========================================================================

drop function if exists public.city_restore(uuid, bigint, uuid);

create or replace function public.city_restore(
  p_user uuid, p_history_id bigint, p_node text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_h public.city_state_history; v_node text; v_had int;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_state jsonb;
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

  -- The restore must be the newest copy anywhere, or the device's local-newer-
  -- wins rule hands the player their stale blob and autosaves it over this.
  v_state := case when jsonb_typeof(v_h.state) = 'object'
                  then jsonb_set(v_h.state, '{savedAt}', to_jsonb(v_now_ms), true)
                  else v_h.state end;

  insert into public.city_state (user_id, node_id, state, sync_pct, mayor_id, mayor_name, updated_at)
  values (p_user, v_node, v_state, v_h.sync_pct, v_h.mayor_id, v_h.mayor_name, now())
  on conflict (user_id, node_id) do update
    set state = excluded.state, sync_pct = excluded.sync_pct, updated_at = now();

  return jsonb_build_object('ok', true, 'user', p_user, 'node', v_node,
    'restored_tiles', public.city_tile_count(v_h.state),
    'replaced_tiles', coalesce(v_had, 0),
    'from_archived_at', v_h.archived_at,
    'saved_at', v_now_ms);
end $$;
revoke all on function public.city_restore(uuid, bigint, text) from public, anon;
grant execute on function public.city_restore(uuid, bigint, text) to authenticated;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
select 'city_restore overloads' as check,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'city_restore') as got,
       '1' as want
union all
select 'restore stamps savedAt',
       (select (pg_get_functiondef(p.oid) like '%jsonb_set(v_h.state, ''{savedAt}''%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'city_restore' limit 1),
       'true'
union all
select 'a stamp written now beats every live row',
       (select ((extract(epoch from clock_timestamp()) * 1000)::bigint
                > coalesce(max((state->>'savedAt')::numeric), 0))::text
          from public.city_state where jsonb_typeof(state->'savedAt') = 'number'),
       'true';
