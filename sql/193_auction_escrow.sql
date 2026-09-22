-- ============================================================================
-- 193 — SERVER-SIDE ESCROW FOR PLAYER-MARKET AUCTION BIDS (card_market_listings)
--
-- WHY
-- Cloud auction bids used a CLIENT "self-escrow": the bidder's Cinder was
-- soft-locked in Profile.lockedGems and released by a loop keyed to
-- CardMarket.myBids, which only ever lived in memory. lockedGems is not
-- restored by loadForge either, so a RELOAD dropped the lock: the bidder could
-- spend the escrowed Cinder and still win, and settlement clamped
-- `Profile.gems = Math.max(0, gems - bid)` — the winner paid less than the bid
-- while the seller still collected all of it. Restoring the lock on the client
-- alone would strand the funds after being outbid (nothing would release it).
-- Owner decision (2026-09-22): the escrow moves to the server.
--
-- WHAT
--   · auction_escrow          one row per (listing, bidder): status only.
--   · auction_escrow_ledger   APPEND-ONLY. `amount` is the signed change in what
--                             that (listing, bidder) escrow holds, so
--                             held = sum(amount). Nothing here is ever UPDATEd.
--   · auction_escrow_bid(listing, amount, name)
--        debits the bidder's canonical wallet by (amount − what they already
--        hold on this listing), and refunds the previous high bidder IN THE
--        SAME TRANSACTION, under a row lock on the listing.
--   · auction_escrow_buy_now(listing)
--        debits the buy-now price the same way, refunds every other hold,
--        marks the listing sold to the caller.
--   · auction_escrow_settle(listing)
--        after ends_at, by the seller OR the winner: listing → sold, winner's
--        escrow → 'won'. The winner gets a one-shot claim (grant the card);
--        the seller is paid out of escrow (full bid — see TAX).
--   · auction_escrow_sync()
--        the caller's reconcile, called on every market fetch: refunds each
--        of their holds that is no longer the live high bid (outbid by a
--        legacy client, listing cancelled/deleted, sold to someone else),
--        pays them for any of their auctions that settled while away, hands
--        back unclaimed wins, and returns what they still hold — so the
--        client rebuilds its "locked" display from the SERVER after a reload —
--        plus how recently closed holds ended (an outbid is refunded inside the
--        outbidder's transaction; this is how the outbid player's client learns).
--
-- 💰 MONEY PATH — the same statements wallet_charge / _sov_apply use, not new
--   ones: debit = one UPDATE of user_progress that only succeeds when the
--   balance is sufficient, wallet_seq moved in the same statement, the
--   user_profiles mirror lowered; credit = UPDATE + mirror raised. Every move
--   carries a wallet_ledger `ref` (unique per user, wallet_ledger_user_ref_uidx)
--   and is skipped if that ref already exists, so a replay cannot move money
--   twice. No Cinder or Aza is ever CREATED here: a payout moves what a bidder
--   escrowed.
--
-- TAX: today's client pays the seller the FULL bid (cardMarketFetch addGems)
--   and bills 2% Foundation Tax on the winner's spend as a LOGGED tax
--   (wallet_charge: ft_tax_total + reserve_tax_log, not deducted). The payout
--   here does exactly that — seller gets the full bid, 2% is logged against
--   the winner at payout (market_type 'auction'). Changing that to a deducted
--   seller fee (the farm_lot_settle shape) is an economy decision, not this
--   file's.
--
-- ⚠ WHAT STAYS CLIENT-TRUSTED (not closed by this file):
--   · The CARD itself. Granting the won card and returning an unsold one run in
--     the client (_cmGrantPurchase / _restoreCardCopy). What is protected is the
--     Cinder, and that a win can be claimed ONCE (claimed_at).
--   · Legacy direct writes. cml_upd still lets any signed-in user UPDATE an
--     open row (cml_guard limits WHAT), so an old build can still bid, buy or
--     collect the old way. Such a bid has no escrow row; settle answers
--     'no_escrow' and the client falls back to its old path for that listing.
--     Closing that needs cml_upd tightened once every client is on the RPCs.
--   · Fixed-price sales (cardMarketBuy) are untouched.
--   · The seller may still rewrite their own listing (cml_guard lets them).
--     That cannot take escrow: a payout only happens when the winner's hold
--     equals current_bid at settlement; anything else refunds the hold.
--   · No anti-snipe extension: cml_guard forbids a non-seller changing ends_at
--     (the client's last-minute extension makes a legacy bid FAIL — see the
--     report; not changed here).
--
-- 🔒 RLS: a bidder reads only their own escrow + ledger rows. No policy allows
--   insert/update/delete; every write goes through the SECURITY DEFINER
--   functions below. The internal helpers are revoked from every client role.
--
-- Idempotent. Safe to re-run. Ships its RLS. Ends with a verify query.
-- Apply by hand in the Supabase SQL editor for the GAME project
-- (ktsiasyjusesawtrwrjc). Requires card_market_listings (+ 067 cml_guard),
-- user_progress, user_profiles, wallet_ledger — all live.
-- ============================================================================

-- ── 1. Tables ───────────────────────────────────────────────────────────────
create table if not exists public.auction_escrow (
  listing_id     uuid        not null,          -- card_market_listings.id; NO FK: a
                                                -- deleted listing must not take the
                                                -- escrow row (and the refund) with it
  bidder_id      uuid        not null,
  seller_id      uuid,
  currency       text        not null default 'cinders' check (currency in ('cinders', 'aza')),
  status         text        not null default 'held'
                   check (status in ('held', 'refunded', 'won', 'settled')),
  claimed_at     timestamptz,                   -- winner took the card (once)
  seller_paid_at timestamptz,                   -- seller was paid from this escrow (once)
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  primary key (listing_id, bidder_id)
);
create index if not exists auction_escrow_bidder_idx on public.auction_escrow (bidder_id, status);
create index if not exists auction_escrow_seller_idx on public.auction_escrow (seller_id, status);

create table if not exists public.auction_escrow_ledger (
  id           bigserial   primary key,
  listing_id   uuid        not null,
  bidder_id    uuid        not null,
  currency     text        not null,
  kind         text        not null check (kind in ('hold', 'refund', 'settle')),
  amount       bigint      not null,            -- signed change in what the escrow holds
  counterparty uuid,                            -- settle: the seller who was paid
  ref          text        not null,
  meta         jsonb,
  created_at   timestamptz not null default now()
);
create unique index if not exists auction_escrow_ledger_ref_uidx on public.auction_escrow_ledger (ref);
create index if not exists auction_escrow_ledger_pair_idx on public.auction_escrow_ledger (listing_id, bidder_id);

alter table public.auction_escrow        enable row level security;
alter table public.auction_escrow_ledger enable row level security;

drop policy if exists ae_select on public.auction_escrow;
create policy ae_select on public.auction_escrow
  for select to authenticated using (bidder_id = auth.uid());
drop policy if exists ae_insert on public.auction_escrow;
create policy ae_insert on public.auction_escrow
  for insert to authenticated with check (false);
drop policy if exists ae_update on public.auction_escrow;
create policy ae_update on public.auction_escrow
  for update to authenticated using (false) with check (false);
drop policy if exists ae_delete on public.auction_escrow;
create policy ae_delete on public.auction_escrow
  for delete to authenticated using (false);

drop policy if exists ael_select on public.auction_escrow_ledger;
create policy ael_select on public.auction_escrow_ledger
  for select to authenticated using (bidder_id = auth.uid());
drop policy if exists ael_insert on public.auction_escrow_ledger;
create policy ael_insert on public.auction_escrow_ledger
  for insert to authenticated with check (false);
drop policy if exists ael_update on public.auction_escrow_ledger;
create policy ael_update on public.auction_escrow_ledger
  for update to authenticated using (false) with check (false);
drop policy if exists ael_delete on public.auction_escrow_ledger;
create policy ael_delete on public.auction_escrow_ledger
  for delete to authenticated using (false);

revoke insert, update, delete on public.auction_escrow, public.auction_escrow_ledger from anon, authenticated;
grant select on public.auction_escrow, public.auction_escrow_ledger to authenticated;

-- ── 2. Internal helpers (never callable by a client) ────────────────────────
-- Move p_delta of the caller's canonical currency. Returns the new balance, or
-- NULL when a debit is not covered. A ref already on wallet_ledger = the move
-- already happened: return the current balance and move nothing.
create or replace function public._ae_wallet_move(p_uid uuid, p_cur text, p_delta bigint, p_reason text, p_ref text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_uid is null or p_delta is null then return null; end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  if p_ref is not null and exists (select 1 from public.wallet_ledger where user_id = p_uid and ref = p_ref) then
    select case when p_cur = 'aza' then coalesce(g.sovereigns, 0) else coalesce(g.cinder, 0) end
      into v_bal from public.user_progress g where g.user_id = p_uid;
    return v_bal;
  end if;
  if p_delta = 0 then
    select case when p_cur = 'aza' then coalesce(g.sovereigns, 0) else coalesce(g.cinder, 0) end
      into v_bal from public.user_progress g where g.user_id = p_uid;
    return v_bal;
  end if;

  if p_cur = 'aza' then
    -- the _sov_apply statements, plus a ref
    update public.user_progress g
       set sovereigns = coalesce(g.sovereigns, 0) + p_delta, updated_at = now()
     where g.user_id = p_uid and coalesce(g.sovereigns, 0) + p_delta >= 0
     returning g.sovereigns into v_bal;
    if v_bal is null then return null; end if;
    update public.user_profiles
       set sovereigns = v_bal,
           wallet_seq = case when p_delta < 0 then coalesce(wallet_seq, 0) + 1 else coalesce(wallet_seq, 0) end
     where user_id = p_uid;
  else
    -- the wallet_charge / _wallet_credit_direct statements (the `g` alias is
    -- load-bearing in wallet_charge; kept for the same reason)
    if p_delta < 0 then
      update public.user_progress g
         set cinder = coalesce(g.cinder, 0) + p_delta, wallet_seq = coalesce(g.wallet_seq, 0) + 1, updated_at = now()
       where g.user_id = p_uid and coalesce(g.cinder, 0) >= -p_delta
       returning g.cinder into v_bal;
      if v_bal is null then return null; end if;
      update public.user_profiles set gems = v_bal where user_id = p_uid and coalesce(gems, 0) > v_bal;
    else
      update public.user_progress g
         set cinder = coalesce(g.cinder, 0) + p_delta, updated_at = now()
       where g.user_id = p_uid
       returning g.cinder into v_bal;
      if v_bal is null then return null; end if;
      update public.user_profiles set gems = v_bal where user_id = p_uid and coalesce(gems, 0) < v_bal;
    end if;
  end if;

  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (p_uid, case when p_delta < 0 then 'charge' else 'credit' end,
              case when p_cur = 'aza' then 'sovereigns' else 'cinder' end,
              p_delta, v_bal, p_reason, p_ref);
  exception when undefined_table or undefined_column then null;
  end;
  return v_bal;
end$$;
revoke all on function public._ae_wallet_move(uuid, text, bigint, text, text) from public, anon, authenticated;

-- What (listing, bidder) holds right now — the ledger sum, never a stored total.
create or replace function public._ae_held(p_listing uuid, p_bidder uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::bigint from public.auction_escrow_ledger
   where listing_id = p_listing and bidder_id = p_bidder;
$$;
revoke all on function public._ae_held(uuid, uuid) from public, anon, authenticated;

-- The caller's balances, for the client to adopt.
create or replace function public._ae_balances(p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cinder',     coalesce((select g.cinder     from public.user_progress g where g.user_id = p_uid), 0),
    'aza',        coalesce((select g.sovereigns from public.user_progress g where g.user_id = p_uid), 0),
    'wallet_seq', coalesce((select g.wallet_seq from public.user_progress g where g.user_id = p_uid), 0));
$$;
revoke all on function public._ae_balances(uuid) from public, anon, authenticated;

-- Return everything (listing, bidder) holds. Once: the escrow row is locked and
-- must be 'held'; the refund ref names the ledger position, so it is unique.
create or replace function public._ae_refund(p_listing uuid, p_bidder uuid, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare e public.auction_escrow%rowtype; v_held bigint; v_n bigint; v_ref text;
begin
  select * into e from public.auction_escrow where listing_id = p_listing and bidder_id = p_bidder for update;
  if e.listing_id is null or e.status <> 'held' then return 0; end if;
  v_held := public._ae_held(p_listing, p_bidder);
  if v_held > 0 then
    select count(*) into v_n from public.auction_escrow_ledger where listing_id = p_listing and bidder_id = p_bidder;
    v_ref := 'ae:refund:' || p_listing || ':' || p_bidder || ':' || v_n;
    perform public._ae_wallet_move(p_bidder, e.currency, v_held, p_reason, v_ref);
    insert into public.auction_escrow_ledger (listing_id, bidder_id, currency, kind, amount, ref, meta)
      values (p_listing, p_bidder, e.currency, 'refund', -v_held, v_ref, jsonb_build_object('reason', p_reason));
  end if;
  update public.auction_escrow set status = 'refunded', closed_at = now()
   where listing_id = p_listing and bidder_id = p_bidder;
  return greatest(v_held, 0);
end$$;
revoke all on function public._ae_refund(uuid, uuid, text) from public, anon, authenticated;

-- Pay the seller out of the winner's 'won' escrow. Once. MUST run as the seller
-- (auth.uid() = seller_id): the paid_out flip below goes through cml_guard, which
-- lets only the seller touch paid_out. If a legacy client already collected
-- (paid_out = true), the escrow is closed WITHOUT paying again.
create or replace function public._ae_payout(p_listing uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare e public.auction_escrow%rowtype; l public.card_market_listings%rowtype; v_held bigint; v_tax bigint; v_ref text;
begin
  select * into l from public.card_market_listings where id = p_listing for update;
  select * into e from public.auction_escrow where listing_id = p_listing and status = 'won' for update;
  if e.listing_id is null or e.seller_paid_at is not null then return 0; end if;
  if l.id is null or l.seller_id is distinct from auth.uid() then return 0; end if;
  v_held := public._ae_held(p_listing, e.bidder_id);
  v_ref := 'ae:settle:' || p_listing;
  if coalesce(l.paid_out, false) then
    -- collected by the old path already: close, do not pay twice
    insert into public.auction_escrow_ledger (listing_id, bidder_id, currency, kind, amount, counterparty, ref, meta)
      values (p_listing, e.bidder_id, e.currency, 'settle', -v_held, l.seller_id, v_ref,
              jsonb_build_object('legacy_collected', true))
      on conflict (ref) do nothing;
    update public.auction_escrow set status = 'settled', seller_paid_at = now(), closed_at = now()
     where listing_id = p_listing and bidder_id = e.bidder_id;
    return 0;
  end if;
  if v_held > 0 then
    perform public._ae_wallet_move(l.seller_id, e.currency, v_held, 'Card market auction sold', v_ref);
  end if;
  v_tax := case when e.currency = 'cinders' then floor(v_held * 0.02) else 0 end;
  insert into public.auction_escrow_ledger (listing_id, bidder_id, currency, kind, amount, counterparty, ref, meta)
    values (p_listing, e.bidder_id, e.currency, 'settle', -v_held, l.seller_id, v_ref,
            jsonb_build_object('paid', v_held, 'tax_logged', v_tax))
    on conflict (ref) do nothing;
  update public.auction_escrow set status = 'settled', seller_paid_at = now(), closed_at = now()
   where listing_id = p_listing and bidder_id = e.bidder_id;
  update public.card_market_listings set paid_out = true where id = p_listing;
  -- Foundation Tax on the winner's spend, LOGGED like wallet_charge (not deducted)
  if v_tax > 0 then
    update public.user_progress set ft_tax_total = coalesce(ft_tax_total, 0) + v_tax where user_id = e.bidder_id;
    begin
      insert into public.reserve_tax_log (seller_id, buyer_id, resource, quantity, sale_value, tax_rate, tax_amount, market_type)
        values (l.seller_id, e.bidder_id, 'card_market_auction', 1, v_held, 0.02, v_tax, 'auction');
    exception when undefined_table or undefined_column then null;
    end;
  end if;
  return v_held;
end$$;
revoke all on function public._ae_payout(uuid) from public, anon, authenticated;

-- ── 3. Client RPCs ──────────────────────────────────────────────────────────
-- BID. Escrows the new high bid, refunds the previous high bidder — one transaction.
create or replace function public.auction_escrow_bid(p_listing uuid, p_amount bigint, p_bidder_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); l public.card_market_listings%rowtype;
  v_cur text; v_min bigint; v_mine bigint := 0; v_need bigint; v_bal bigint; v_prev uuid;
  v_name text; v_hist jsonb; v_n bigint; v_ref text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into l from public.card_market_listings where id = p_listing for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_listing'); end if;
  if coalesce(l.listing_type, 'fixed') <> 'auction' then return jsonb_build_object('ok', false, 'error', 'not_auction'); end if;
  if l.status <> 'open' or (l.ends_at is not null and l.ends_at <= now()) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  if l.seller_id = v_uid then return jsonb_build_object('ok', false, 'error', 'own_listing'); end if;
  v_cur := case when l.currency = 'aza' then 'aza' else 'cinders' end;
  -- _cmMinNextBid, verbatim: opening = starting_bid (or 5); then +max(5, ceil(5%))
  v_min := case when coalesce(l.current_bid, 0) <= 0 then greatest(coalesce(nullif(l.starting_bid, 0), 5), 1)
                else l.current_bid + greatest(5, (l.current_bid * 5 + 99) / 100) end;
  if p_amount is null or p_amount < v_min then
    return jsonb_build_object('ok', false, 'error', 'min_bid', 'min', v_min);
  end if;

  if exists (select 1 from public.auction_escrow where listing_id = l.id and bidder_id = v_uid and status = 'held') then
    v_mine := public._ae_held(l.id, v_uid);        -- raising my own bid: pay only the difference
  end if;
  v_need := p_amount - v_mine;
  -- The ref names the LEDGER POSITION, not the amount: a seller may reset their
  -- own current_bid (cml_guard allows it), and an amount-keyed ref could then
  -- collide with an earlier hold and fail the bid.
  select count(*) into v_n from public.auction_escrow_ledger where listing_id = l.id and bidder_id = v_uid;
  v_ref := 'ae:hold:' || l.id || ':' || v_uid || ':' || v_n;
  v_bal := public._ae_wallet_move(v_uid, v_cur, -v_need, 'Card market auction bid', v_ref);
  if v_bal is null then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'need', v_need) || public._ae_balances(v_uid);
  end if;
  insert into public.auction_escrow (listing_id, bidder_id, seller_id, currency, status)
    values (l.id, v_uid, l.seller_id, v_cur, 'held')
    on conflict (listing_id, bidder_id) do update
      set status = 'held', closed_at = null, seller_id = excluded.seller_id, currency = excluded.currency;
  if v_need <> 0 then
    insert into public.auction_escrow_ledger (listing_id, bidder_id, currency, kind, amount, ref)
      values (l.id, v_uid, v_cur, 'hold', v_need, v_ref);
  end if;

  v_prev := l.current_bidder_id;
  if v_prev is not null and v_prev <> v_uid then
    perform public._ae_refund(l.id, v_prev, 'Card market auction outbid');
  end if;

  v_name := left(coalesce(nullif(btrim(p_bidder_name), ''), 'Bidder'), 40);
  select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb) into v_hist
    from (select v, o from jsonb_array_elements(
            coalesce(l.bid_history, '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object('bidderName', v_name, 'amount', p_amount,
                                                    'at', (extract(epoch from now()) * 1000)::bigint)))
            with ordinality t(v, o)) x
   where x.o > jsonb_array_length(coalesce(l.bid_history, '[]'::jsonb)) + 1 - 30;
  -- cml_guard BID branch: stays open, bid goes up, bidder names themselves,
  -- price/starting/buy_now/ends_at/paid_out untouched — all true here.
  update public.card_market_listings
     set current_bid = p_amount, current_bidder_id = v_uid, current_bidder_name = v_name, bid_history = v_hist
   where id = l.id;
  return jsonb_build_object('ok', true, 'current_bid', p_amount, 'held', p_amount, 'charged', v_need)
         || public._ae_balances(v_uid);
end$$;
revoke all on function public.auction_escrow_bid(uuid, bigint, text) from public, anon;
grant execute on function public.auction_escrow_bid(uuid, bigint, text) to authenticated;

-- BUY NOW. Pays the buy-now price from escrow, refunds every other hold, sold.
create or replace function public.auction_escrow_buy_now(p_listing uuid, p_buyer_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); l public.card_market_listings%rowtype;
  v_cur text; v_price bigint; v_mine bigint := 0; v_need bigint; v_bal bigint; r record; v_n bigint; v_ref text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into l from public.card_market_listings where id = p_listing for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_listing'); end if;
  if coalesce(l.listing_type, 'fixed') <> 'auction' then return jsonb_build_object('ok', false, 'error', 'not_auction'); end if;
  if l.status <> 'open' or (l.ends_at is not null and l.ends_at <= now()) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  if l.seller_id = v_uid then return jsonb_build_object('ok', false, 'error', 'own_listing'); end if;
  v_price := coalesce(l.buy_now_price, 0);
  if v_price <= 0 then return jsonb_build_object('ok', false, 'error', 'no_buy_now'); end if;
  v_cur := case when l.currency = 'aza' then 'aza' else 'cinders' end;

  if exists (select 1 from public.auction_escrow where listing_id = l.id and bidder_id = v_uid and status = 'held') then
    v_mine := public._ae_held(l.id, v_uid);
  end if;
  v_need := v_price - v_mine;
  select count(*) into v_n from public.auction_escrow_ledger where listing_id = l.id and bidder_id = v_uid;
  v_ref := 'ae:hold:' || l.id || ':' || v_uid || ':' || v_n;
  v_bal := public._ae_wallet_move(v_uid, v_cur, -v_need, 'Card market auction buy now', v_ref);
  if v_bal is null then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'need', v_need) || public._ae_balances(v_uid);
  end if;
  insert into public.auction_escrow (listing_id, bidder_id, seller_id, currency, status)
    values (l.id, v_uid, l.seller_id, v_cur, 'held')
    on conflict (listing_id, bidder_id) do update
      set status = 'held', closed_at = null, seller_id = excluded.seller_id, currency = excluded.currency;
  if v_need <> 0 then
    insert into public.auction_escrow_ledger (listing_id, bidder_id, currency, kind, amount, ref)
      values (l.id, v_uid, v_cur, 'hold', v_need, v_ref);
  end if;
  for r in select bidder_id from public.auction_escrow
            where listing_id = l.id and bidder_id <> v_uid and status = 'held' loop
    perform public._ae_refund(l.id, r.bidder_id, 'Card market auction bought out');
  end loop;
  -- cml_guard CLAIM branch: open → sold, buyer names themselves, terms untouched.
  update public.card_market_listings
     set status = 'sold', buyer_id = v_uid, current_bid = v_price, current_bidder_id = v_uid,
         current_bidder_name = left(coalesce(nullif(btrim(p_buyer_name), ''), 'Buyer'), 40)
   where id = l.id;
  update public.auction_escrow set status = 'won', claimed_at = now()
   where listing_id = l.id and bidder_id = v_uid;
  select * into l from public.card_market_listings where id = p_listing;
  return jsonb_build_object('ok', true, 'claim', true, 'paid', v_price, 'charged', v_need, 'listing', to_jsonb(l))
         || public._ae_balances(v_uid);
end$$;
revoke all on function public.auction_escrow_buy_now(uuid, text) from public, anon;
grant execute on function public.auction_escrow_buy_now(uuid, text) to authenticated;

-- SETTLE an ended auction. Seller or winner. Idempotent.
--   no bids            → {status:'no_bids'} (the client returns the card to the seller)
--   winner has no hold → {error:'no_escrow'} — a legacy bid; the client falls back.
--                        A hold that does not match current_bid is refunded first,
--                        so the fallback's full charge can never double it.
create or replace function public.auction_escrow_settle(p_listing uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); l public.card_market_listings%rowtype; e public.auction_escrow%rowtype;
  v_win uuid; v_held bigint; v_paid bigint := 0; v_claim boolean := false; r record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into l from public.card_market_listings where id = p_listing for update;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_listing'); end if;
  if coalesce(l.listing_type, 'fixed') <> 'auction' then return jsonb_build_object('ok', false, 'error', 'not_auction'); end if;

  if l.status = 'open' then
    if l.ends_at is null or l.ends_at > now() then
      return jsonb_build_object('ok', false, 'error', 'still_open', 'ends_at', l.ends_at);
    end if;
    v_win := l.current_bidder_id;
    if v_uid <> l.seller_id and v_uid is distinct from v_win then
      return jsonb_build_object('ok', false, 'error', 'not_yours');
    end if;
    if v_win is null or coalesce(l.current_bid, 0) <= 0 then
      for r in select bidder_id from public.auction_escrow where listing_id = l.id and status = 'held' loop
        perform public._ae_refund(l.id, r.bidder_id, 'Card market auction ended unsold');
      end loop;
      return jsonb_build_object('ok', true, 'status', 'no_bids') || public._ae_balances(v_uid);
    end if;
    select * into e from public.auction_escrow where listing_id = l.id and bidder_id = v_win and status = 'held' for update;
    v_held := case when e.listing_id is null then 0 else public._ae_held(l.id, v_win) end;
    if e.listing_id is null or v_held <> l.current_bid then
      v_paid := public._ae_refund(l.id, v_win, 'Card market auction escrow mismatch');
      return jsonb_build_object('ok', false, 'error', 'no_escrow', 'refunded', v_paid) || public._ae_balances(v_uid);
    end if;
    for r in select bidder_id from public.auction_escrow
              where listing_id = l.id and bidder_id <> v_win and status = 'held' loop
      perform public._ae_refund(l.id, r.bidder_id, 'Card market auction lost');
    end loop;
    -- winner: cml_guard CLAIM branch (buyer_id = auth.uid()); seller: owner branch
    update public.card_market_listings set status = 'sold', buyer_id = v_win where id = l.id;
    update public.auction_escrow set status = 'won' where listing_id = l.id and bidder_id = v_win;
    l.status := 'sold'; l.buyer_id := v_win;
  end if;

  if l.status <> 'sold' then
    return jsonb_build_object('ok', true, 'status', l.status) || public._ae_balances(v_uid);
  end if;
  select * into e from public.auction_escrow where listing_id = l.id and status in ('won', 'settled') for update;
  if e.listing_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_escrow') || public._ae_balances(v_uid);
  end if;
  if v_uid = l.seller_id then
    v_paid := public._ae_payout(l.id);
  end if;
  if v_uid = e.bidder_id and e.claimed_at is null then
    update public.auction_escrow set claimed_at = now() where listing_id = l.id and bidder_id = v_uid;
    v_claim := true;
  end if;
  return jsonb_build_object('ok', true, 'status', 'sold',
                            'role', case when v_uid = l.seller_id then 'seller' else 'buyer' end,
                            'paid', v_paid, 'claim', v_claim, 'amount', l.current_bid,
                            'listing', case when v_claim then to_jsonb(l) else null end)
         || public._ae_balances(v_uid);
end$$;
revoke all on function public.auction_escrow_settle(uuid) from public, anon;
grant execute on function public.auction_escrow_settle(uuid) to authenticated;

-- SYNC — the reload-proof replacement for the in-memory CardMarket.myBids loop.
create or replace function public.auction_escrow_sync()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); r record; l public.card_market_listings%rowtype;
  v_refunded bigint := 0; v_paid bigint := 0; v_holds jsonb := '{}'::jsonb; v_claims jsonb := '[]'::jsonb;
  v_refunds jsonb := '{}'::jsonb; v_recent jsonb; v_amt bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;

  -- 1. my holds: keep the live high bids, refund the rest
  for r in select listing_id, currency from public.auction_escrow
            where bidder_id = v_uid and status = 'held' order by created_at limit 200 loop
    select * into l from public.card_market_listings where id = r.listing_id for update;
    if l.id is not null and l.status = 'open' and l.current_bidder_id = v_uid then
      v_holds := v_holds || jsonb_build_object(r.listing_id::text,
                   jsonb_build_object('amount', public._ae_held(r.listing_id, v_uid), 'currency', r.currency));
    elsif l.id is not null and l.status = 'sold' and l.buyer_id = v_uid then
      -- sold to me by another path while my hold stood: the hold IS the payment
      update public.auction_escrow set status = 'won' where listing_id = r.listing_id and bidder_id = v_uid;
    else
      v_amt := public._ae_refund(r.listing_id, v_uid, 'Card market auction outbid');
      v_refunded := v_refunded + v_amt;
      v_refunds := v_refunds || jsonb_build_object(r.listing_id::text, v_amt);
    end if;
  end loop;

  -- 2. my auctions that settled while I was away: pay me
  for r in select listing_id from public.auction_escrow
            where seller_id = v_uid and status = 'won' and seller_paid_at is null limit 100 loop
    v_paid := v_paid + public._ae_payout(r.listing_id);
  end loop;

  -- 3. wins I have not taken the card for yet (the seller settled first)
  for r in select e.listing_id from public.auction_escrow e
            where e.bidder_id = v_uid and e.status in ('won', 'settled') and e.claimed_at is null limit 50 loop
    select * into l from public.card_market_listings where id = r.listing_id;
    update public.auction_escrow set claimed_at = now() where listing_id = r.listing_id and bidder_id = v_uid;
    if l.id is not null then v_claims := v_claims || jsonb_build_array(to_jsonb(l)); end if;
  end loop;

  -- 4. how my recently closed holds ended. An outbid is refunded inside the
  --    OTHER bidder's transaction, so step 1 never sees it; without this the
  --    client cannot tell "refunded" from "won and claimed elsewhere".
  select coalesce(jsonb_object_agg(x.listing_id::text, x.status), '{}'::jsonb) into v_recent
    from (select listing_id, status from public.auction_escrow
           where bidder_id = v_uid and status <> 'held' order by created_at desc limit 200) x;

  return jsonb_build_object('ok', true, 'refunded', v_refunded, 'refunds', v_refunds, 'recent', v_recent,
                            'paid', v_paid, 'holds', v_holds, 'claims', v_claims)
         || public._ae_balances(v_uid);
end$$;
revoke all on function public.auction_escrow_sync() from public, anon;
grant execute on function public.auction_escrow_sync() to authenticated;

-- ── 4. Verify ───────────────────────────────────────────────────────────────
-- Expect: 2 tables with rls = true; 8 policies (ae_*/ael_* × select/insert/update/delete);
-- 4 client RPCs executable by authenticated; 5 helpers NOT executable by authenticated.
select 'table' as kind, c.relname as name, c.relrowsecurity::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('auction_escrow', 'auction_escrow_ledger')
union all
select 'policy', tablename || '.' || policyname, cmd
  from pg_policies where schemaname = 'public' and tablename in ('auction_escrow', 'auction_escrow_ledger')
union all
select 'function', p.proname, 'authenticated can execute: ' || has_function_privilege('authenticated', p.oid, 'execute')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('auction_escrow_bid', 'auction_escrow_buy_now', 'auction_escrow_settle', 'auction_escrow_sync',
                     '_ae_wallet_move', '_ae_held', '_ae_balances', '_ae_refund', '_ae_payout')
order by 1, 2;
