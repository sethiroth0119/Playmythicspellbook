-- ===========================================================================
-- 010 - A NODE MANAGER SPENDS THE OWNER'S LEDGER, NOT THEIR OWN
--
-- A hired mayor running someone else's city currently spends their OWN camp
-- resources and Cinder, and everything the city produces lands in their OWN
-- stores. Both directions are wrong: a manager can pour a personally farmed
-- hoard into a city that is not theirs, and can drain that city's output into
-- their own camp.
--
-- These two RPCs give the mayor read/write access to the OWNER's ledger, and
-- ONLY that owner's, and ONLY while the mayoralty is active.
--
-- Requires node_mayors (supabase-mayors.sql). Idempotent. Plain ASCII.
--
-- ---------------------------------------------------------------------------
-- ! HONEST LIMITATION, because it decides when this is safe to rely on.
--   Camp resources live in user_profiles.forge->'__salvage__', and the OWNER's
--   own client uploads that WHOLE forge blob when it saves. So if the owner is
--   playing at the same moment a mayor spends, the owner's next upload can
--   overwrite the mayor's change - a last-write-wins race identical in shape to
--   the bank bug fixed in v120g5.
--   These functions narrow it as far as is possible without rebuilding the camp
--   ledger as server-authoritative: they use jsonb_set on the ONE key rather
--   than rewriting the blob, so nothing else the owner owns is ever touched.
--   In practice a mayor is hired precisely because the owner is away, so the
--   windows rarely overlap - but it is a race, not a guarantee, and pretending
--   otherwise would be the wrong kind of confidence.
-- ===========================================================================


-- --- 1. AUTHORITY. Only an ACTIVE hired mayor of THIS node, and the answer
--        carries the owner id so no caller ever names the owner themselves.
create or replace function public._node_manager_owner(p_node_id text)
returns uuid language sql stable security definer set search_path = public as $$
  select m.owner_id
    from public.node_mayors m
   where m.node_id = p_node_id
     and m.mayor_id = auth.uid()
     and coalesce(m.active, true)
   limit 1;
$$;


-- --- 2. READ the owner's ledger.
create or replace function public.city_owner_ledger_get(p_node_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_salvage jsonb; v_cinder numeric;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_owner := public._node_manager_owner(p_node_id);
  if v_owner is null then raise exception 'you do not manage this node'; end if;

  select coalesce(forge->'__salvage__', '{}'::jsonb), coalesce(gems, 0)
    into v_salvage, v_cinder
    from public.user_profiles where user_id = v_owner;

  return jsonb_build_object('ok', true, 'owner_id', v_owner,
                            'cinder', coalesce(v_cinder, 0),
                            'salvage', coalesce(v_salvage, '{}'::jsonb));
end $$;


-- --- 3. APPLY a delta, atomically, refusing anything that would go negative.
--        p_salvage_delta is { resourceId: signedNumber }.
create or replace function public.city_owner_ledger_apply(
  p_node_id text, p_cinder_delta numeric default 0, p_salvage_delta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner   uuid;
  v_salvage jsonb;
  v_cinder  numeric;
  k         text;
  v_have    numeric;
  v_next    numeric;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_owner := public._node_manager_owner(p_node_id);
  if v_owner is null then raise exception 'you do not manage this node'; end if;

  -- Lock the owner's row for the whole check-and-apply. Without this, two
  -- managers (or a manager and a retrying client) can both read the same
  -- balance and both spend it.
  select coalesce(forge->'__salvage__', '{}'::jsonb), coalesce(gems, 0)
    into v_salvage, v_cinder
    from public.user_profiles where user_id = v_owner for update;

  if v_salvage is null then raise exception 'owner has no profile'; end if;

  -- Cinder first: a refusal here must happen before any resource moves.
  v_cinder := v_cinder + coalesce(p_cinder_delta, 0);
  if v_cinder < 0 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_cinder',
                              'cinder', coalesce((select gems from user_profiles where user_id = v_owner), 0));
  end if;

  for k in select jsonb_object_keys(coalesce(p_salvage_delta, '{}'::jsonb))
  loop
    v_have := coalesce((v_salvage->>k)::numeric, 0);
    v_next := v_have + coalesce((p_salvage_delta->>k)::numeric, 0);
    if v_next < 0 then
      return jsonb_build_object('ok', false, 'error', 'insufficient_resource',
                                'resource', k, 'have', v_have);
    end if;
    v_salvage := jsonb_set(v_salvage, array[k], to_jsonb(v_next), true);
  end loop;

  -- ! jsonb_set on the ONE key. Writing the whole forge blob back would
  --   destroy every other thing the owner changed since we read it.
  update public.user_profiles
     set forge = jsonb_set(coalesce(forge, '{}'::jsonb), '{__salvage__}', v_salvage, true),
         gems  = v_cinder
   where user_id = v_owner;

  -- Keep the canonical wallet in step. Missing this is exactly how the v120g6
  -- drift happened: gems and user_progress.cinder disagreeing forever.
  begin
    update public.user_progress set cinder = greatest(0, v_cinder) where user_id = v_owner;
  exception when undefined_table or undefined_column then null;
  end;

  return jsonb_build_object('ok', true, 'cinder', v_cinder, 'salvage', v_salvage);
end $$;


revoke all on function public._node_manager_owner(text) from public, anon;
revoke all on function public.city_owner_ledger_get(text) from public, anon;
revoke all on function public.city_owner_ledger_apply(text, numeric, jsonb) from public, anon;
grant execute on function public.city_owner_ledger_get(text) to authenticated;
grant execute on function public.city_owner_ledger_apply(text, numeric, jsonb) to authenticated;


-- --- VERIFY. Expect rpcs 3.
select count(*) as rpcs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('_node_manager_owner','city_owner_ledger_get','city_owner_ledger_apply');
