-- 118 · Nodes for sale, with Hidn Studios escrow (v121v56).
--
-- Asked for: "a For Sale button that puts a For Sale sign on the node, lets
-- the owner set the price and write what the node comes with (real estate,
-- operations and more), shows the Cinder price and its worth in USD, and a
-- note that Hidn Studios holds all sales in escrow until payment has been
-- fully transferred between players and ownership."
--
-- One listing per node (the node id is the key). Only the node's owner
-- (tw_node_owners.user_id) can list or cancel. A purchase is ONE
-- transaction: the buyer's Cinder is taken into escrow (_ct_cinder_take,
-- ledger "held in escrow by Hidn Studios"), ownership moves to the buyer,
-- any active mayor contract on the node ends (the new owner appoints their
-- own), the seller's city on that node moves with it when the listing says
-- the city is included and the buyer has no city there yet, and only then
-- is the escrow released to the seller (_ct_cinder_give, ledger "escrow
-- released by Hidn Studios"). If any step fails the whole thing rolls back —
-- nobody is ever paid for a node they still own, and nobody ever pays for a
-- node they did not receive. node_sale_log keeps the escrow trail.

create table if not exists public.node_sales (
  node_id      text primary key,
  seller_id    uuid not null,
  seller_name  text,
  price        bigint not null check (price > 0 and price <= 2000000000),
  details      text,
  includes     jsonb not null default '{}'::jsonb,   -- {city, realEstate, operations, resources, mayor}
  status       text not null default 'listed',       -- listed | sold | cancelled
  buyer_id     uuid,
  buyer_name   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sold_at      timestamptz
);
create table if not exists public.node_sale_log (
  id           uuid primary key default gen_random_uuid(),
  node_id      text not null,
  action       text not null,            -- listed | cancelled | escrow_held | ownership_moved | escrow_released
  actor_id     uuid,
  counterparty uuid,
  amount       bigint,
  note         text,
  created_at   timestamptz not null default now()
);
alter table public.node_sales enable row level security;
alter table public.node_sale_log enable row level security;
drop policy if exists node_sales_read on public.node_sales;
create policy node_sales_read on public.node_sales for select to authenticated using (true);
drop policy if exists node_sale_log_read on public.node_sale_log;
create policy node_sale_log_read on public.node_sale_log for select to authenticated
  using (actor_id = auth.uid() or counterparty = auth.uid() or public.is_admin());
revoke insert, update, delete on public.node_sales, public.node_sale_log from authenticated, anon;
grant select on public.node_sales, public.node_sale_log to authenticated;

-- the owner lists (or re-prices) their node
create or replace function public.node_sale_list(p_node_id text, p_price bigint, p_details text default null, p_includes jsonb default '{}'::jsonb, p_seller_name text default null)
returns public.node_sales
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.node_sales;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_node_id is null or char_length(p_node_id) = 0 then raise exception 'no node' using errcode = '22023'; end if;
  if p_price is null or p_price <= 0 then raise exception 'set a price above zero' using errcode = '22023'; end if;
  if p_price > 2000000000 then raise exception 'that price is above the 2,000,000,000 🔥 ceiling' using errcode = '22023'; end if;
  if not exists (select 1 from public.tw_node_owners o where o.node_id = p_node_id and o.user_id = v_uid) then
    raise exception 'only the owner of this node can put it up for sale' using errcode = '42501'; end if;
  insert into public.node_sales (node_id, seller_id, seller_name, price, details, includes, status, buyer_id, buyer_name, updated_at, sold_at)
  values (p_node_id, v_uid, p_seller_name, p_price, left(coalesce(p_details, ''), 2000), coalesce(p_includes, '{}'::jsonb), 'listed', null, null, now(), null)
  on conflict (node_id) do update
     set seller_id = excluded.seller_id, seller_name = excluded.seller_name, price = excluded.price, details = excluded.details,
         includes = excluded.includes, status = 'listed', buyer_id = null, buyer_name = null, updated_at = now(), sold_at = null
  returning * into v_row;
  insert into public.node_sale_log (node_id, action, actor_id, amount, note) values (p_node_id, 'listed', v_uid, p_price, left(coalesce(p_details, ''), 200));
  return v_row;
end $$;
revoke all on function public.node_sale_list(text, bigint, text, jsonb, text) from public, anon;
grant execute on function public.node_sale_list(text, bigint, text, jsonb, text) to authenticated;

-- the owner (or an admin) takes the sign down
create or replace function public.node_sale_cancel(p_node_id text)
returns public.node_sales
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.node_sales;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_row from public.node_sales where node_id = p_node_id for update;
  if v_row.node_id is null then raise exception 'this node is not for sale' using errcode = 'P0002'; end if;
  if v_row.status <> 'listed' then raise exception 'this listing is already closed' using errcode = '22023'; end if;
  if v_row.seller_id <> v_uid and not public.is_admin()
     and not exists (select 1 from public.tw_node_owners o where o.node_id = p_node_id and o.user_id = v_uid) then
    raise exception 'only the seller can cancel this listing' using errcode = '42501'; end if;
  update public.node_sales set status = 'cancelled', updated_at = now() where node_id = p_node_id returning * into v_row;
  insert into public.node_sale_log (node_id, action, actor_id) values (p_node_id, 'cancelled', v_uid);
  return v_row;
end $$;
revoke all on function public.node_sale_cancel(text) from public, anon;
grant execute on function public.node_sale_cancel(text) to authenticated;

-- the purchase: escrow in, ownership across, escrow out — one transaction
create or replace function public.node_sale_buy(p_node_id text, p_buyer_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_row public.node_sales; v_take jsonb; v_give jsonb; v_city_moved boolean := false; v_mayor_ended boolean := false;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_row from public.node_sales where node_id = p_node_id for update;
  if v_row.node_id is null or v_row.status <> 'listed' then raise exception 'this node is not for sale' using errcode = 'P0002'; end if;
  if v_row.seller_id = v_uid then raise exception 'you cannot buy your own node' using errcode = '22023'; end if;
  if not exists (select 1 from public.tw_node_owners o where o.node_id = p_node_id and o.user_id = v_row.seller_id) then
    update public.node_sales set status = 'cancelled', updated_at = now() where node_id = p_node_id;
    raise exception 'the seller no longer owns this node — the listing has been taken down' using errcode = '22023';
  end if;
  perform 1 from public.tw_node_owners where node_id = p_node_id for update;

  -- 1 · the buyer's Cinder goes into escrow (refuses if they cannot pay)
  v_take := public._ct_cinder_take(v_uid, v_row.price, 'Node purchase — ' || p_node_id || ' (held in escrow by Hidn Studios)');
  insert into public.node_sale_log (node_id, action, actor_id, counterparty, amount, note)
  values (p_node_id, 'escrow_held', v_uid, v_row.seller_id, v_row.price, 'Hidn Studios holds the payment until ownership has moved');

  -- 2 · ownership moves to the buyer
  update public.tw_node_owners set user_id = v_uid, display_name = coalesce(p_buyer_name, display_name), assigned_by = v_uid, updated_at = now()
   where node_id = p_node_id;
  insert into public.node_sale_log (node_id, action, actor_id, counterparty, note)
  values (p_node_id, 'ownership_moved', v_row.seller_id, v_uid, 'tw_node_owners now names the buyer');

  -- 3 · the old owner's mayor contract on this node ends; the new owner appoints their own
  begin
    update public.node_mayors set active = false, ended_at = now() where node_id = p_node_id and active = true;
    if found then v_mayor_ended := true; end if;
  exception when undefined_table then null; end;

  -- 4 · the city moves with the land when the listing says so and the buyer has none there yet
  begin
    if coalesce((v_row.includes->>'city')::boolean, false)
       and exists (select 1 from public.city_state c where c.user_id = v_row.seller_id and c.node_id = p_node_id)
       and not exists (select 1 from public.city_state c where c.user_id = v_uid and c.node_id = p_node_id) then
      update public.city_state set user_id = v_uid, mayor_id = null, mayor_name = null, updated_at = now()
       where user_id = v_row.seller_id and node_id = p_node_id;
      v_city_moved := true;
    end if;
  exception when undefined_table or undefined_column then null; end;

  -- 5 · escrow released to the seller
  v_give := public._ct_cinder_give(v_row.seller_id, v_row.price, 'Node sale — ' || p_node_id || ' (escrow released by Hidn Studios)');
  insert into public.node_sale_log (node_id, action, actor_id, counterparty, amount, note)
  values (p_node_id, 'escrow_released', v_row.seller_id, v_uid, v_row.price, 'payment and ownership both complete');

  update public.node_sales set status = 'sold', buyer_id = v_uid, buyer_name = p_buyer_name, sold_at = now(), updated_at = now() where node_id = p_node_id;
  return jsonb_build_object('ok', true, 'node_id', p_node_id, 'price', v_row.price, 'seller_id', v_row.seller_id,
                            'buyer_balance', (v_take->>'balance')::bigint, 'buyer_wallet_seq', (v_take->>'wallet_seq')::bigint,
                            'city_moved', v_city_moved, 'mayor_ended', v_mayor_ended);
end $$;
revoke all on function public.node_sale_buy(text, text) from public, anon;
grant execute on function public.node_sale_buy(text, text) to authenticated;

-- verify
-- select proname from pg_proc where proname like 'node_sale%';
