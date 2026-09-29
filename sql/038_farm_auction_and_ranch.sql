-- ============================================================================
-- 038 — HOMESTEAD FARM: player-to-player livestock lots (Cinder, server-settled)
--        and the shared corp ranch.
--
-- WHAT THIS IS
-- Two things the farm (/src/farm) cannot do on the client:
--   1. Sell a beast to ANOTHER PLAYER for Cinder. Bids are escrowed from the
--      canonical wallet (user_progress.cinder, the row 023/026 locked), the
--      previous high bidder is refunded on the same statement, and the hammer
--      pays the seller minus the 2% Foundation Tax wallet_charge already takes.
--   2. A pasture a whole corporation feeds. Its state is one jsonb row per
--      corp; every contribution and claim is an APPEND-ONLY ledger row.
--
-- 🔒 RLS IS THE ENTIRE SECURITY BOUNDARY.
--   · farm_lots / farm_lot_bids: everyone signed in can READ open lots; nobody
--     can INSERT or UPDATE them directly (`with check (false)`) — every write
--     goes through a SECURITY DEFINER function below, which is the only code
--     that can move Cinder.
--   · farm_ranch / farm_ranch_ledger: readable by MEMBERS of that corp only
--     (is_corp_member, the existing definer helper); writes only via the
--     RPCs, which re-check membership.
--
-- 💰 MONEY RULES, copied from 023 / 035 rather than reinvented:
--   · Debit = one UPDATE that only succeeds when cinder >= amount, wallet_seq
--     moved in the same statement, mirror (user_profiles.gems) lowered.
--   · Credit = UPDATE + mirror raised. Ledger rows are best-effort (undefined
--     table must never roll back money), and carry `ref` for idempotency.
--   · No Cinder is ever CREATED here. A hammer moves what the bidder escrowed.
--
-- ⚠ THE ANIMAL IS CLIENT DATA. The farm lives on Profile.farm, so a lot's
--   animal (name, breed, weight) is what the seller's client says it is —
--   exactly as trusted as the rest of the farm. What is protected is the
--   Cinder, and that this beast can be claimed by ONE buyer, ONCE.
--
-- Idempotent. Safe to re-run. Ships its RLS. Ends with a verify query.
-- Run in the Supabase SQL editor for the GAME project (ktsiasyjusesawtrwrjc).
-- ============================================================================

-- ── 1. Player lots ─────────────────────────────────────────────────────────
create table if not exists public.farm_lots (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null references auth.users(id) on delete cascade,
  seller_name  text,
  animal       jsonb not null,            -- { sp, name, breed, ageH, grownH, health, prize, value }
  min_bid      bigint not null,
  current_bid  bigint not null default 0,
  high_bidder  uuid references auth.users(id) on delete set null,
  ends_at      timestamptz not null,
  status       text not null default 'open',   -- open | sold | unsold
  claimed      boolean not null default false, -- the beast has been handed over (to buyer, or back to seller)
  paid         boolean not null default false, -- the seller has been credited
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index if not exists farm_lots_open on public.farm_lots (status, ends_at);
create index if not exists farm_lots_seller on public.farm_lots (seller_id, created_at desc);

create table if not exists public.farm_lot_bids (
  id        uuid primary key default gen_random_uuid(),
  lot_id    uuid not null references public.farm_lots(id) on delete cascade,
  bidder_id uuid not null references auth.users(id) on delete cascade,
  bidder_name text,
  amount    bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists farm_lot_bids_lot on public.farm_lot_bids (lot_id, created_at desc);

alter table public.farm_lots enable row level security;
alter table public.farm_lot_bids enable row level security;
drop policy if exists fl_sel on public.farm_lots;
create policy fl_sel on public.farm_lots for select to authenticated using (true);
drop policy if exists fl_ins on public.farm_lots;
create policy fl_ins on public.farm_lots for insert to authenticated with check (false);
drop policy if exists fl_upd on public.farm_lots;
create policy fl_upd on public.farm_lots for update to authenticated using (false) with check (false);
drop policy if exists flb_sel on public.farm_lot_bids;
create policy flb_sel on public.farm_lot_bids for select to authenticated using (true);
drop policy if exists flb_ins on public.farm_lot_bids;
create policy flb_ins on public.farm_lot_bids for insert to authenticated with check (false);

-- Internal money helpers. NOT granted to anyone: only the RPCs below call them.
create or replace function public._farm_wallet_debit(p_uid uuid, p_amount bigint, p_reason text, p_ref text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_amount is null or p_amount <= 0 then return false; end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  update public.user_progress g
     set cinder = g.cinder - p_amount, wallet_seq = g.wallet_seq + 1, updated_at = now()
   where g.user_id = p_uid and g.cinder >= p_amount
   returning g.cinder into v_bal;
  if v_bal is null then return false; end if;
  update public.user_profiles set gems = v_bal where user_id = p_uid and coalesce(gems, 0) > v_bal;
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (p_uid, 'charge', 'cinder', -p_amount, v_bal, p_reason, p_ref);
  exception when unique_violation then null; when undefined_table or undefined_column then null; end;
  return true;
end$$;
revoke all on function public._farm_wallet_debit(uuid, bigint, text, text) from public, anon, authenticated;

create or replace function public._farm_wallet_credit(p_uid uuid, p_amount bigint, p_reason text, p_ref text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_amount is null or p_amount <= 0 then return true; end if;
  if p_ref is not null and exists (select 1 from public.wallet_ledger where user_id = p_uid and ref = p_ref) then return true; end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  update public.user_progress set cinder = coalesce(cinder, 0) + p_amount, wallet_seq = coalesce(wallet_seq, 0) + 1, updated_at = now()
   where user_id = p_uid returning cinder into v_bal;
  update public.user_profiles set gems = v_bal where user_id = p_uid and coalesce(gems, 0) < v_bal;
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (p_uid, 'credit', 'cinder', p_amount, v_bal, p_reason, p_ref);
  exception when unique_violation then null; when undefined_table or undefined_column then null; end;
  return true;
end$$;
revoke all on function public._farm_wallet_credit(uuid, bigint, text, text) from public, anon, authenticated;

-- Post a lot. The client has already removed the beast from its farm.
create or replace function public.farm_lot_post(p_animal jsonb, p_min_bid bigint, p_hours int, p_seller_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_hours int := greatest(6, least(72, coalesce(p_hours, 24)));
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if p_animal is null or p_animal->>'sp' is null then return jsonb_build_object('ok', false, 'error', 'bad_animal'); end if;
  if p_min_bid is null or p_min_bid < 500 then return jsonb_build_object('ok', false, 'error', 'min_bid_500'); end if;
  if (select count(*) from public.farm_lots where seller_id = v_uid and status = 'open') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'max_3_open_lots');
  end if;
  insert into public.farm_lots (seller_id, seller_name, animal, min_bid, ends_at)
    values (v_uid, left(coalesce(p_seller_name, ''), 40), p_animal, p_min_bid, now() + make_interval(hours => v_hours))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'ends_at', now() + make_interval(hours => v_hours));
end$$;
revoke all on function public.farm_lot_post(jsonb, bigint, int, text) from public, anon;
grant execute on function public.farm_lot_post(jsonb, bigint, int, text) to authenticated;

-- Bid. Escrows the bid; refunds the previous high bidder in the same call.
create or replace function public.farm_lot_bid(p_lot uuid, p_amount bigint, p_bidder_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); l public.farm_lots%rowtype; v_min bigint; v_prev uuid; v_prev_amt bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into l from public.farm_lots where id = p_lot for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_lot'); end if;
  if l.status <> 'open' or l.ends_at <= now() then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if l.seller_id = v_uid then return jsonb_build_object('ok', false, 'error', 'own_lot'); end if;
  if l.high_bidder = v_uid then return jsonb_build_object('ok', false, 'error', 'already_high'); end if;
  v_min := greatest(l.min_bid, l.current_bid + greatest(100, (l.current_bid * 5) / 100));
  if p_amount is null or p_amount < v_min then return jsonb_build_object('ok', false, 'error', 'min_bid', 'min', v_min); end if;
  if not public._farm_wallet_debit(v_uid, p_amount, 'farm_lot_bid', 'farmbid:' || l.id || ':' || v_uid || ':' || p_amount) then
    return jsonb_build_object('ok', false, 'error', 'insufficient');
  end if;
  v_prev := l.high_bidder; v_prev_amt := l.current_bid;
  if v_prev is not null and v_prev_amt > 0 then
    perform public._farm_wallet_credit(v_prev, v_prev_amt, 'farm_lot_outbid', 'farmrefund:' || l.id || ':' || v_prev || ':' || v_prev_amt);
  end if;
  update public.farm_lots
     set current_bid = p_amount, high_bidder = v_uid,
         ends_at = greatest(ends_at, now() + interval '5 minutes')   -- anti-snipe
   where id = l.id;
  insert into public.farm_lot_bids (lot_id, bidder_id, bidder_name, amount) values (l.id, v_uid, left(coalesce(p_bidder_name, ''), 40), p_amount);
  return jsonb_build_object('ok', true, 'current_bid', p_amount, 'ends_at', greatest(l.ends_at, now() + interval '5 minutes'));
end$$;
revoke all on function public.farm_lot_bid(uuid, bigint, text) from public, anon;
grant execute on function public.farm_lot_bid(uuid, bigint, text) to authenticated;

-- Settle: anyone may call once the clock has run out; idempotent.
create or replace function public.farm_lot_settle(p_lot uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); l public.farm_lots%rowtype; v_tax bigint; v_net bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into l from public.farm_lots where id = p_lot for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_lot'); end if;
  if l.status <> 'open' then return jsonb_build_object('ok', true, 'status', l.status); end if;
  if l.ends_at > now() then return jsonb_build_object('ok', false, 'error', 'still_open', 'ends_at', l.ends_at); end if;
  if l.high_bidder is null then
    update public.farm_lots set status = 'unsold', settled_at = now() where id = l.id;
    return jsonb_build_object('ok', true, 'status', 'unsold');
  end if;
  v_tax := floor(l.current_bid * 0.02); v_net := l.current_bid - v_tax;
  perform public._farm_wallet_credit(l.seller_id, v_net, 'farm_lot_sold', 'farmsold:' || l.id);
  begin
    insert into public.reserve_tax_log (seller_id, resource, quantity, sale_value, tax_rate, tax_amount, market_type)
      values (l.seller_id, 'livestock', 1, l.current_bid, 0.02, v_tax, 'farm_lot');
  exception when undefined_table or undefined_column then null; end;
  update public.farm_lots set status = 'sold', paid = true, settled_at = now() where id = l.id;
  return jsonb_build_object('ok', true, 'status', 'sold', 'net', v_net);
end$$;
revoke all on function public.farm_lot_settle(uuid) from public, anon;
grant execute on function public.farm_lot_settle(uuid) to authenticated;

-- Claim the beast: the winner of a sold lot, or the seller of an unsold one. Once.
create or replace function public.farm_lot_claim(p_lot uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); l public.farm_lots%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into l from public.farm_lots where id = p_lot for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_lot'); end if;
  if l.claimed then return jsonb_build_object('ok', false, 'error', 'already_claimed'); end if;
  if l.status = 'sold' and l.high_bidder = v_uid then
    update public.farm_lots set claimed = true where id = l.id;
    return jsonb_build_object('ok', true, 'animal', l.animal, 'role', 'buyer');
  end if;
  if l.status = 'unsold' and l.seller_id = v_uid then
    update public.farm_lots set claimed = true where id = l.id;
    return jsonb_build_object('ok', true, 'animal', l.animal, 'role', 'seller');
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_yours');
end$$;
revoke all on function public.farm_lot_claim(uuid) from public, anon;
grant execute on function public.farm_lot_claim(uuid) to authenticated;

-- ── 2. The corp ranch ──────────────────────────────────────────────────────
create table if not exists public.farm_ranch (
  corp_id    uuid primary key references public.corporations(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  version    bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.farm_ranch_ledger (
  id         uuid primary key default gen_random_uuid(),
  corp_id    uuid not null references public.corporations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  user_name  text,
  kind       text not null,          -- feed | stock | claim
  resource   text,
  amount     bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists farm_ranch_ledger_corp on public.farm_ranch_ledger (corp_id, created_at desc);

alter table public.farm_ranch enable row level security;
alter table public.farm_ranch_ledger enable row level security;
drop policy if exists fr_sel on public.farm_ranch;
create policy fr_sel on public.farm_ranch for select to authenticated using (public.is_corp_member(corp_id, auth.uid()));
drop policy if exists fr_ins on public.farm_ranch;
create policy fr_ins on public.farm_ranch for insert to authenticated with check (false);
drop policy if exists fr_upd on public.farm_ranch;
create policy fr_upd on public.farm_ranch for update to authenticated using (false) with check (false);
drop policy if exists frl_sel on public.farm_ranch_ledger;
create policy frl_sel on public.farm_ranch_ledger for select to authenticated using (public.is_corp_member(corp_id, auth.uid()));
drop policy if exists frl_ins on public.farm_ranch_ledger;
create policy frl_ins on public.farm_ranch_ledger for insert to authenticated with check (false);

-- Read the ranch + everyone's feed over the share window. Creates the row on first touch.
create or replace function public.farm_ranch_get(p_corp uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r public.farm_ranch%rowtype; v_mine bigint; v_all bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if not public.is_corp_member(p_corp, v_uid) then return jsonb_build_object('ok', false, 'error', 'not_a_member'); end if;
  insert into public.farm_ranch (corp_id) values (p_corp) on conflict (corp_id) do nothing;
  select * into r from public.farm_ranch where corp_id = p_corp;
  select coalesce(sum(amount), 0) into v_mine from public.farm_ranch_ledger where corp_id = p_corp and user_id = v_uid and kind = 'feed' and created_at > now() - interval '7 days';
  select coalesce(sum(amount), 0) into v_all  from public.farm_ranch_ledger where corp_id = p_corp and kind = 'feed' and created_at > now() - interval '7 days';
  return jsonb_build_object('ok', true, 'state', r.state, 'version', r.version, 'updated_at', r.updated_at,
                            'my_feed', v_mine, 'all_feed', v_all,
                            'ledger', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'resource', resource, 'amount', amount, 'who', user_name, 'at', created_at) order by created_at desc), '[]'::jsonb)
                                         from (select * from public.farm_ranch_ledger where corp_id = p_corp order by created_at desc limit 30) x));
end$$;
revoke all on function public.farm_ranch_get(uuid) from public, anon;
grant execute on function public.farm_ranch_get(uuid) to authenticated;

-- Save the (client-simulated) ranch state with a version check, and append the
-- ledger rows that describe what this save did (feed added, stock bought, goods
-- claimed). The client runs the same pure simulation every farm runs.
create or replace function public.farm_ranch_save(p_corp uuid, p_state jsonb, p_version bigint, p_entries jsonb default '[]'::jsonb, p_user_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cur bigint; e jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if not public.is_corp_member(p_corp, v_uid) then return jsonb_build_object('ok', false, 'error', 'not_a_member'); end if;
  if p_state is null or pg_column_size(p_state) > 60000 then return jsonb_build_object('ok', false, 'error', 'bad_state'); end if;
  insert into public.farm_ranch (corp_id) values (p_corp) on conflict (corp_id) do nothing;
  select version into v_cur from public.farm_ranch where corp_id = p_corp for update;
  if v_cur <> coalesce(p_version, -1) then return jsonb_build_object('ok', false, 'error', 'stale', 'version', v_cur); end if;
  update public.farm_ranch set state = p_state, version = v_cur + 1, updated_at = now(), updated_by = v_uid where corp_id = p_corp;
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    if (e->>'kind') in ('feed', 'stock', 'claim') and coalesce((e->>'amount')::bigint, 0) > 0 then
      insert into public.farm_ranch_ledger (corp_id, user_id, user_name, kind, resource, amount)
        values (p_corp, v_uid, left(coalesce(p_user_name, ''), 40), e->>'kind', left(coalesce(e->>'resource', ''), 32), (e->>'amount')::bigint);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'version', v_cur + 1);
end$$;
revoke all on function public.farm_ranch_save(uuid, jsonb, bigint, jsonb, text) from public, anon;
grant execute on function public.farm_ranch_save(uuid, jsonb, bigint, jsonb, text) to authenticated;

-- ── Verify ─────────────────────────────────────────────────────────────────
select t.tablename, t.rowsecurity, (select count(*) from pg_policies p where p.tablename = t.tablename) as policies
  from pg_tables t where t.schemaname = 'public' and t.tablename in ('farm_lots', 'farm_lot_bids', 'farm_ranch', 'farm_ranch_ledger')
 order by 1;
select proname, pg_get_function_arguments(oid) from pg_proc where proname like 'farm_%' order by 1;
