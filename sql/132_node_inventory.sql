-- ============================================================================
-- 132_node_inventory.sql — 📦 NODE INVENTORY (owner, v121v117)
-- "Make a Node Inventory on every node owner city Node Modal that they can
--  collect the resources that the node produces."
--
-- The server keeps ONE thing: when the node's shelf was last emptied
-- (meta.invAt, ms). node_inventory_claim() returns the hours that have
-- accrued since (capped) and stamps now, so two devices cannot collect the
-- same hours twice. The client turns hours into units with the node's
-- resource, tier, node-power level and city level (see _nodeInvYield in
-- index.html) and banks them through addRes() — resources are the player's
-- stash, which lives on the profile, exactly like every other producer.
-- Idempotent. Re-runnable. Ends with a verify query.
-- ============================================================================
create or replace function public.node_inventory_claim(p_node_id uuid, p_cap_hours numeric default 48)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_meta jsonb;
  v_since bigint;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_hours numeric;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'why', 'signed-out'); end if;
  select owner_id, coalesce(meta, '{}'::jsonb) into v_owner, v_meta from economy_nodes where id = p_node_id;
  if v_owner is null then return jsonb_build_object('ok', false, 'why', 'no-node'); end if;
  if v_owner <> auth.uid() then return jsonb_build_object('ok', false, 'why', 'not-owner'); end if;
  v_since := coalesce(nullif(v_meta->>'invAt', '')::bigint, v_now - 24 * 3600 * 1000);   -- a shelf never emptied starts a day full
  v_hours := least(greatest(0, (v_now - v_since) / 3600000.0), greatest(1, coalesce(p_cap_hours, 48)));
  update economy_nodes set meta = v_meta || jsonb_build_object('invAt', v_now), updated_at = now() where id = p_node_id;
  return jsonb_build_object('ok', true, 'hours', round(v_hours, 3), 'since', v_since, 'now', v_now);
end $$;
grant execute on function public.node_inventory_claim(uuid, numeric) to authenticated;

-- verify
select proname, pg_get_function_arguments(oid) from pg_proc where proname = 'node_inventory_claim';
