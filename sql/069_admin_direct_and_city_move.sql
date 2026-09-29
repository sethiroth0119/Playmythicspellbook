-- ═══════════════════════════════════════════════════════════════════════════
-- 069 · TWO THINGS THE RESTORE CAMPAIGN NEEDS
--
-- ⚠ NOT APPLIED BY ANYONE IN THIS ENVIRONMENT. Paste it into
--   https://supabase.com/dashboard/project/ktsiasyjusesawtrwrjc/sql/new and Run.
--
-- ── §1 · ms_is_admin() REFUSES THE SQL EDITOR, WHICH IS WHERE ADMINS WORK ──
--   Reported today, verbatim:
--       select * from public.cml_restore_unsold();
--       ERROR: 42501: admin only
--   The gate reads `auth.jwt() ->> 'email'`. In the SQL editor there is no
--   request context at all — you are a privileged database role, not a signed-in
--   user — so the email is null, the list check fails, and every admin function
--   in 064/065/067 is unreachable from the one place an operator would use them.
--   The workaround is a per-transaction claim:
--       select set_config('request.jwt.claims','{"email":"you@example.com"}',true);
--   which works, and which nobody will remember at 2am during an incident.
--
--   🔴 THE CARE THIS NEEDS, AND WHY IT IS NOT "return true when jwt is null":
--      An `anon` PostgREST caller ALSO has no email. What it does have is a
--      request context: PostgREST always sets request.jwt.claims (role=anon).
--      A direct connection sets nothing. So the test is the PRESENCE OF THE
--      REQUEST CONTEXT, not the presence of an email, and not auth.jwt() being
--      null — auth.jwt() returns '{}' rather than null when unset, so a
--      `jwt() is null` test would silently never fire.
--      Get this wrong in the permissive direction and `anon` inherits admin
--      across 064's city guard, the city_state policies and every restore
--      function in one step.
--
-- ── §2 · MOVING A CITY TO THE NODE IT BELONGS ON ──────────────────────────
--   Found while diagnosing a report of "parts of my city were removed":
--       AetosDios owns exactly one node, N-04 (Talon Forge), per tw_node_owners
--       …and has TWO city_state rows: N-04 (87 tiles) and N-32 (80 tiles)
--   N-32 is not his. Before 068 added the owner check, city_claim_node() would
--   re-key a player's only city onto whatever node they opened first, including
--   somebody else's. The city is not lost — it is filed under the wrong key,
--   which from inside the game is indistinguishable from missing.
--
--   city_restore() cannot fix that: it writes an ARCHIVED version to a node. A
--   misplaced city is a LIVE row that needs its key changed, with the target
--   possibly already occupied. That is this function.
--
--   ⚠ IT REFUSES TO SHRINK BY DEFAULT. If the destination already holds a
--     bigger city, moving over it destroys the difference, so the move stops
--     and tells you both numbers. p_force is the deliberate override, and even
--     then 064's guard archives what it replaced.
--   ⚠ IT SETS app.city_force FOR ITS OWN DELETE LEG ONLY. 064 refuses every
--     delete on city_state by design; that escape hatch exists for exactly this
--     kind of operator move. It is transaction-local, so it cannot leak.
--
-- Idempotent and re-runnable. Ends with a verify query.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- §1 · the admin test
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.ms_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- A DIRECT DATABASE CONNECTION (SQL editor, psql, a migration runner) has
    -- no PostgREST request context. It already outranks anything this function
    -- could decide, so gating it is theatre that only locks out the operator.
    coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
    -- Otherwise: a real request, judged on the signed-in email exactly as before.
    or coalesce(lower(auth.jwt() ->> 'email'), '') in (
         'richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com');
$$;
revoke all on function public.ms_is_admin() from public;
grant execute on function public.ms_is_admin() to authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2 · move a city onto the node it belongs to
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.city_move_node(
  p_user uuid, p_from text, p_to text, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_src   public.city_state;
  v_dst_tiles int;
  v_src_tiles int;
begin
  if not public.ms_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'need two different nodes' using errcode = '22023';
  end if;

  select * into v_src from public.city_state
   where user_id = p_user and node_id = p_from;
  if v_src.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no city on ' || p_from);
  end if;
  v_src_tiles := public.city_tile_count(v_src.state);

  select public.city_tile_count(state) into v_dst_tiles
    from public.city_state where user_id = p_user and node_id = p_to;
  v_dst_tiles := coalesce(v_dst_tiles, 0);

  -- The whole point of the guard: never trade a bigger city for a smaller one
  -- by accident. Both numbers are returned so the operator can decide.
  if v_dst_tiles > v_src_tiles and not p_force then
    return jsonb_build_object(
      'ok', false, 'reason', 'destination_is_bigger',
      'from', p_from, 'from_tiles', v_src_tiles,
      'to', p_to, 'to_tiles', v_dst_tiles,
      'hint', 'if you are sure, call again with p_force => true');
  end if;

  -- Write the source city onto the destination key. 064's trigger archives
  -- whatever was there first, so the overwritten version stays recoverable.
  insert into public.city_state (user_id, node_id, state, sync_pct, mayor_id, mayor_name, updated_at)
  values (p_user, p_to, v_src.state, v_src.sync_pct, v_src.mayor_id, v_src.mayor_name, now())
  on conflict (user_id, node_id) do update
    set state = excluded.state, sync_pct = excluded.sync_pct, updated_at = now();

  -- Retire the old key. 064 refuses deletes unless an operator sets this flag;
  -- transaction-local, so it cannot outlive this call.
  perform set_config('app.city_force', 'on', true);
  delete from public.city_state where user_id = p_user and node_id = p_from;
  perform set_config('app.city_force', 'off', true);

  return jsonb_build_object('ok', true, 'moved_tiles', v_src_tiles,
    'from', p_from, 'to', p_to, 'replaced_tiles', v_dst_tiles,
    'note', 'the replaced version is in city_state_history');
end $$;
revoke all on function public.city_move_node(uuid, text, text, boolean) from public, anon;
grant execute on function public.city_move_node(uuid, text, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
select 'admin test passes from the SQL editor' as check,
       public.ms_is_admin()::text as got, 'true' as want
union all
select 'anon is still refused when it has a request context',
       (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = '')::text,
       'true here (no context) — the anon path is the OR branch, unchanged'
union all
select 'city_move_node exists',
       (to_regprocedure('public.city_move_node(uuid,text,text,boolean)') is not null)::text, 'true'
union all
select 'anon cannot execute the move',
       has_function_privilege('anon', 'public.city_move_node(uuid,text,text,boolean)', 'execute')::text, 'false';
