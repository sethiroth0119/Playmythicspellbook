-- ═══════════════════════════════════════════════════════════════════════════
-- 108 · THE WORLD MAP CANNOT BE SHRUNK BY ACCIDENT — AND EVERY VERSION IS KEPT
--
-- Asked for: "This happened again stop this from happening setup a system
-- where this dont happen."
--
-- 🔴 WHAT 043 GUARDS, AND WHAT IT DOES NOT. tw_publish_world_map refuses a doc
--    whose `nodes` array is EMPTY. That stops a blank world. It does not stop
--    the failure that actually happens, which is not blank — it is SMALLER:
--
--      · a client whose world-map fetch failed falls back to the 16-node
--        starter seed (_twSeedStarterData),
--      · any admin action then fires _adminAutoPublish(0),
--      · 16 is not 0, so the guard passes,
--      · and 16 generic PRNs become the canonical map for all 121 accounts.
--
--    That exact shape is already in the record. 043's own header counts
--    FIFTEEN profiles sitting on exactly 16 nodes next to 31 on the real 40 —
--    the fingerprint of this accident, per-profile, before the map was shared.
--    Sharing the map did not remove the accident; it raised the blast radius
--    from one profile to everyone at once.
--
-- 🔴 AND THERE WAS NO WAY BACK. tw_world_map holds ONE row and no history, so
--    a bad publish overwrote the only copy. The only fallback was
--    tw_world_map_backup_20260902 — a snapshot of PROFILES from 2026-09-02,
--    which knows nothing about any map published since.
--
-- SO, TWO THINGS, AND THE SECOND IS THE ONE THAT MATTERS:
--
--   1 · SHRINKING NEEDS AN EXPLICIT YES. A publish carrying fewer nodes than
--       the live map is REFUSED and reports what it saw. A real admin deleting
--       a node passes p_force => true (the client asks them to confirm first).
--       Automatic publishes never force, so no code path can shrink the world
--       without a human saying so to that specific number.
--
--   2 · EVERY PUBLISH KEEPS THE ONE IT REPLACED. tw_world_map_history stores
--       the OUTGOING doc before each overwrite, so even a forced mistake is one
--       call to tw_restore_world_map(version) away from undone. A guard can be
--       out-thought; a backup cannot.
--
-- ⚠ THE SIGNATURE CHANGES, so the two-argument version is DROPPED, not left
--   beside the new one. PostgREST resolves overloads by argument name and
--   would refuse the call as ambiguous ("could not choose the best candidate
--   function") the moment both exist — which would break publishing for every
--   admin instead of protecting it. The client's existing two-named-argument
--   call still binds to the new function through p_force's default.
--
-- ⚠ TWO REVOKES, NOT ONE. A new function is executable by PUBLIC (Postgres's
--   own default) AND by anon (Supabase's default privileges for the role).
--   Revoking one leaves the other standing.
--
-- Idempotent and re-runnable. VERIFY block at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · every map we have ever published, keyed by the version it was ──────
create table if not exists public.tw_world_map_history (
  version      integer primary key,
  doc          jsonb   not null,
  nodes        integer not null,
  published_at timestamptz not null default now(),
  published_by uuid,
  note         text
);
alter table public.tw_world_map_history enable row level security;
-- 🔴 NO POLICY, DELIBERATELY. RLS with zero policies denies every role that is
--    not the owner, so this is reachable from the SQL editor and the service
--    role only. History is the thing you fall back ON; it must not be writable
--    by the same client that can make the mistake.

-- Seed it with the map that is live right now, so there is always something to
-- restore to — including on a database where the first publish after this
-- migration is the bad one.
insert into public.tw_world_map_history (version, doc, nodes, published_at, published_by, note)
select w.version, w.doc,
       jsonb_array_length(coalesce(w.doc->'nodes', '[]'::jsonb)),
       coalesce(w.updated_at, now()), w.updated_by,
       'seeded from the live row by sql/108'
  from public.tw_world_map w
 where w.id = 1
on conflict (version) do nothing;

-- ── 2 · publishing, with a floor under it ──────────────────────────────────
drop function if exists public.tw_publish_world_map(jsonb, integer);

create or replace function public.tw_publish_world_map(
  p_doc jsonb, p_version integer, p_force boolean default false
) returns json
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_cur integer;
  v_uid uuid := auth.uid();
  v_doc jsonb;
  v_new integer;
  v_old integer;
begin
  if v_uid is null or not is_admin() then
    return json_build_object('ok', false, 'why', 'admin only');
  end if;

  -- A map with no nodes is not a map (043's rule, kept).
  if p_doc is null or jsonb_typeof(p_doc->'nodes') <> 'array'
     or jsonb_array_length(p_doc->'nodes') = 0 then
    return json_build_object('ok', false, 'why', 'refused: the map has no nodes');
  end if;
  v_new := jsonb_array_length(p_doc->'nodes');

  -- 🔒 One publisher at a time: two admins cannot both read the same version,
  --    both pass the shrink test against it, and both write.
  select version, doc into v_cur, v_doc from tw_world_map where id = 1 for update;

  if v_cur is null then
    insert into tw_world_map (id, doc, version, updated_at, updated_by)
      values (1, p_doc, 1, now(), v_uid);
    insert into tw_world_map_history (version, doc, nodes, published_by, note)
      values (1, p_doc, v_new, v_uid, 'first publish')
      on conflict (version) do nothing;
    return json_build_object('ok', true, 'version', 1, 'nodes', v_new);
  end if;

  if p_version is not null and p_version <> v_cur then
    return json_build_object('ok', false, 'why', 'stale', 'version', v_cur);
  end if;

  v_old := jsonb_array_length(coalesce(v_doc->'nodes', '[]'::jsonb));

  /* 🔴 THE GUARD. Fewer nodes than the live map means either an admin really
     deleted some — in which case they confirm and it comes back with force —
     or a client is about to publish a fallback it built while it could not
     read the real one. The second is indistinguishable from the first at the
     wire, so the ONLY safe default is to refuse and say what we saw. */
  if v_new < v_old and not coalesce(p_force, false) then
    return json_build_object('ok', false, 'why', 'shrink',
                             'have', v_old, 'sent', v_new, 'version', v_cur);
  end if;

  -- Keep the one we are about to replace, THEN replace it.
  insert into tw_world_map_history (version, doc, nodes, published_at, published_by, note)
    values (v_cur, v_doc, v_old, coalesce((select updated_at from tw_world_map where id = 1), now()),
            v_uid, case when v_new < v_old then 'replaced by a FORCED shrink to ' || v_new else null end)
    on conflict (version) do nothing;

  update tw_world_map
     set doc = p_doc, version = v_cur + 1, updated_at = now(), updated_by = v_uid
   where id = 1;

  return json_build_object('ok', true, 'version', v_cur + 1, 'nodes', v_new,
                           'shrank_from', case when v_new < v_old then v_old else null end);
end; $fn$;

revoke all on function public.tw_publish_world_map(jsonb, integer, boolean) from public, anon;
grant execute on function public.tw_publish_world_map(jsonb, integer, boolean) to authenticated;

-- ── 3 · putting it back, in one call ───────────────────────────────────────
-- Restores a historical version AS A NEW VERSION (never by rewinding the
-- counter), so the timeline only ever moves forward and the map that was live
-- during the mistake is itself kept.
create or replace function public.tw_restore_world_map(p_version integer)
returns json
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid();
  v_doc jsonb; v_nodes integer; v_cur integer; v_curdoc jsonb;
begin
  if v_uid is null or not is_admin() then
    return json_build_object('ok', false, 'why', 'admin only');
  end if;
  select doc, nodes into v_doc, v_nodes from tw_world_map_history where version = p_version;
  if v_doc is null then
    return json_build_object('ok', false, 'why', 'no such version');
  end if;

  select version, doc into v_cur, v_curdoc from tw_world_map where id = 1 for update;
  -- The broken map is worth keeping too — it is the evidence.
  insert into tw_world_map_history (version, doc, nodes, published_by, note)
    values (v_cur, v_curdoc, jsonb_array_length(coalesce(v_curdoc->'nodes','[]'::jsonb)),
            v_uid, 'superseded by a restore of v' || p_version)
    on conflict (version) do nothing;

  update tw_world_map
     set doc = v_doc, version = v_cur + 1, updated_at = now(), updated_by = v_uid
   where id = 1;
  return json_build_object('ok', true, 'restored_from', p_version,
                           'version', v_cur + 1, 'nodes', v_nodes);
end; $fn$;

revoke all on function public.tw_restore_world_map(integer) from public, anon;
grant execute on function public.tw_restore_world_map(integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
--   -- what is live, and what we can fall back to:
--   select w.version as live_version,
--          jsonb_array_length(w.doc->'nodes') as live_nodes,
--          (select count(*) from tw_world_map_history) as versions_kept
--     from tw_world_map w where w.id = 1;
--
--   select version, nodes, published_at, note
--     from tw_world_map_history order by version desc limit 10;
--
--   -- only authenticated may publish, and it is definer:
--   select p.oid::regprocedure, p.prosecdef,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('tw_publish_world_map','tw_restore_world_map');
--   -- expect prosecdef true, anon false, authed true for both.
--
--   -- the guard actually bites (rolled back — the RAISE undoes it):
--   do $$
--   declare admin uuid; live jsonb; r json;
--   begin
--     select updated_by into admin from tw_world_map where id = 1;
--     if admin is null then select user_id into admin from user_profiles limit 1; end if;
--     select doc into live from tw_world_map where id = 1;
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', admin, 'role','authenticated')::text, true);
--     -- send a ONE-node map over the live one, without force:
--     r := public.tw_publish_world_map(
--            jsonb_build_object('regions','[]'::jsonb,'sectors','[]'::jsonb,
--                               'nodes', jsonb_build_array(live->'nodes'->0)),
--            (select version from tw_world_map where id = 1), false);
--     raise exception 'PROBE (rolled back): %', r;
--   end $$;
--   -- expect {"ok":false,"why":"shrink","have":40,"sent":1,...}
--
-- ROLLBACK:
--   drop function if exists public.tw_restore_world_map(integer);
--   drop function if exists public.tw_publish_world_map(jsonb, integer, boolean);
--   -- then re-run sql/043's function definition to get the 2-arg one back.
--   -- keep tw_world_map_history; it costs nothing and it is the safety net.
-- ═══════════════════════════════════════════════════════════════════════════
