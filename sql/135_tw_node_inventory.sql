-- ============================================================================
-- 135_tw_node_inventory.sql — 📦 NODE INVENTORY, IN THE ID SPACE THE MODAL USES
--
-- Owner: "This button is not working fix this here, Make sure it gives players
--         their node resource yield."
--
-- ⚠ WHY 132 COULD NEVER HAVE WORKED FROM THIS SCREEN. node_inventory_claim()
--   takes `p_node_id uuid` and reads `economy_nodes` — the PRN table. The node
--   modal that renders the Collect button shows TERRITORY-WAR nodes, whose ids
--   are TEXT ('N-01') in tw_node_owners. index.html already documents this exact
--   trap for the "🏛 Make capital" button:
--
--     "the node modal shows TERRITORY-WAR nodes — 'N-01' (tw_node_owners.node_id)
--      FoundationReserve.nodes are PRN rows — economy_nodes.id, a UUID
--      so the find() missed on EVERY click … which is exactly what 'the button
--      does nothing' feels like from the outside"
--     …and: "economy_nodes still has no column referencing a TW node, so that
--      lookup can never be made to work."
--
--   So this is NOT a re-point of 132. It is the same clock kept in the other id
--   space, because the two cannot be joined. 132 stays exactly as it is for PRN
--   nodes, which do have a meta.invAt and do collect correctly today.
--
-- The server keeps ONE fact: when this owner last emptied this node's shelf.
-- The client turns hours into units using the node's OWN resourceYield, which
-- is what the RESOURCE YIELD panel beside it already promises.
-- Idempotent. Re-runnable. Ends with a verify query.
-- ============================================================================

create table if not exists public.tw_node_inventory (
  node_id    text        not null,
  user_id    uuid        not null,
  inv_at     timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (node_id, user_id)
);

alter table public.tw_node_inventory enable row level security;

-- The owner may READ their own shelf clock, so the modal can show how many
-- hours have accrued. Nobody writes through the API: the claim RPC is the only
-- writer, and it is security definer.
drop policy if exists tni_sel_own on public.tw_node_inventory;
create policy tni_sel_own on public.tw_node_inventory
  for select using (user_id = auth.uid());

create or replace function public.tw_node_inventory_claim(p_node_id text, p_cap_hours numeric default 48)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me    uuid := auth.uid();
  v_owner uuid;
  v_since timestamptz;
  v_now   timestamptz := now();
  v_hours numeric;
begin
  if v_me is null then return jsonb_build_object('ok', false, 'why', 'signed-out'); end if;
  if p_node_id is null or length(trim(p_node_id)) = 0 then return jsonb_build_object('ok', false, 'why', 'no-node'); end if;

  -- Ownership comes from tw_node_owners, the same table the map and the modal
  -- read, so the button can never pay someone who does not hold the node.
  select user_id into v_owner from tw_node_owners where node_id = p_node_id;
  if v_owner is null then return jsonb_build_object('ok', false, 'why', 'no-node'); end if;
  if v_owner <> v_me then return jsonb_build_object('ok', false, 'why', 'not-owner'); end if;

  -- A shelf never emptied starts A DAY FULL. That is deliberate and matches what
  -- this screen has been showing players all along ("240 ready · 24.0 h"), so
  -- the first collect after this fix pays what they were already promised
  -- instead of resetting them to zero.
  select inv_at into v_since from tw_node_inventory where node_id = p_node_id and user_id = v_me;
  if v_since is null then v_since := v_now - interval '24 hours'; end if;

  v_hours := least(
    greatest(0, extract(epoch from (v_now - v_since)) / 3600.0),
    greatest(1, coalesce(p_cap_hours, 48))
  );

  insert into tw_node_inventory (node_id, user_id, inv_at, updated_at)
  values (p_node_id, v_me, v_now, v_now)
  on conflict (node_id, user_id) do update set inv_at = v_now, updated_at = v_now;

  return jsonb_build_object(
    'ok',    true,
    'hours', round(v_hours, 3),
    'since', (extract(epoch from v_since) * 1000)::bigint,
    'now',   (extract(epoch from v_now) * 1000)::bigint
  );
end $$;

grant execute on function public.tw_node_inventory_claim(text, numeric) to authenticated;
grant select on public.tw_node_inventory to authenticated;

-- verify
select proname, pg_get_function_arguments(oid) from pg_proc where proname = 'tw_node_inventory_claim';
