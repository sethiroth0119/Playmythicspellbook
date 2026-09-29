-- ============================================================================
-- 144 — USER_PROFILES WRITES ARE COMPARE-AND-SET (proof only, NO schema change)
-- Project: ktsiasyjusesawtrwrjc
-- Status: DRAFT — NOT APPLIED. Running it changes nothing: it is one verify
--         block whose every probe is rolled back.
-- ----------------------------------------------------------------------------
-- THE BUG. cloudSyncProfile() re-armed its own 2 s timer on success, so every
-- signed-in tab upserted its whole row every ~2 s (pg_stat 2026-09-17:
-- 5,460,940 updates on 129 rows), and none of the triggers on user_profiles
-- (up_farm_keep, up_guard_upd, user_profiles_touch) checks for a stale write.
-- A device that read the row before another device's edit wrote its older copy
-- back within one cycle.
--
-- THE FIX IS IN THE CLIENT (public/index.html, _profileRowWrite) and needs no
-- migration, on purpose — CLAUDE.md: the app must work before a table or
-- column exists. It uses what is already live:
--   update public.user_profiles set …            (PostgREST PATCH)
--    where user_id = <me> and updated_at = <the updated_at this device last read or wrote>
--   returning updated_at
--   · user_profiles_touch sets updated_at := now() on EVERY update, so a row
--     somebody else wrote no longer matches: zero rows back = "reload and merge".
--   · Two racing writers with the same base: the second blocks on the row lock,
--     re-evaluates the WHERE against the committed row (READ COMMITTED), and
--     matches nothing. now() is the transaction start, which differs between
--     PostgREST requests, so a new stamp never equals the base it replaced.
--   · RLS is unchanged and is still the boundary: up_update_own /
--     user_profiles_self_update (auth.uid() = user_id). A foreign bearer's
--     conditional update matches zero rows exactly like a stale one.
--   · A device that found NO row creates it with INSERT (not upsert), so of two
--     first-time devices the second gets 23505 and takes the merge path.
--
-- ⚠ NOT DONE HERE, and an owner decision: refusing BLIND writes server-side.
--   A cached pre-fix build still upserts without a base. Rejecting those would
--   also reject every save from players who have not reloaded yet, so it waits
--   until the fixed build has been live long enough.
-- No table, function, policy or grant is created, so there is no RLS to add.
-- Re-runnable.
-- ============================================================================

-- ── verify (no side effects: the probe block is rolled back) ────────────────
do $$
declare
  v_uid  uuid;
  v_at   timestamptz;
  v_at2  timestamptz;
  v_n    int;
  v_log  text := '';
begin
  select user_id, updated_at into v_uid, v_at
    from public.user_profiles where updated_at is not null
   order by updated_at limit 1;
  if v_uid is null then raise notice '144: no profile row to probe with'; return; end if;

  begin
    -- 1. a stale base matches nothing
    update public.user_profiles set display_name = display_name
     where user_id = v_uid and updated_at = v_at - interval '1 second';
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception '144 FAIL: a stale base matched % row(s)', v_n; end if;
    v_log := v_log || 'stale=0 ';

    -- 2. the current base matches exactly one row, and the touch trigger moves updated_at
    update public.user_profiles set display_name = display_name
     where user_id = v_uid and updated_at = v_at
     returning updated_at into v_at2;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception '144 FAIL: the current base matched % row(s)', v_n; end if;
    if v_at2 is not distinct from v_at then raise exception '144 FAIL: updated_at did not move'; end if;
    v_log := v_log || 'fresh=1 moved ';

    -- 3. the base that was just used is now stale (the second of two racing devices)
    update public.user_profiles set display_name = display_name
     where user_id = v_uid and updated_at = v_at;
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception '144 FAIL: a replaced base still matched'; end if;
    v_log := v_log || 'replaced=0 ';

    -- 4. RLS: another signed-in account's conditional update matches nothing
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
    update public.user_profiles set display_name = display_name
     where user_id = v_uid and updated_at = v_at2;
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception '144 FAIL: a foreign bearer updated the row'; end if;
    v_log := v_log || 'foreign=0 ';

    -- 5. the owner, with the current base, matches one row
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
    update public.user_profiles set display_name = display_name
     where user_id = v_uid and updated_at = v_at2;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception '144 FAIL: the owner with the current base matched % row(s)', v_n; end if;
    v_log := v_log || 'owner=1';

    raise exception using errcode = 'P0144', message = v_log;   -- roll the probes back
  exception when sqlstate 'P0144' then
    raise notice '144 OK (rolled back): %', sqlerrm;
  end;
end $$;
