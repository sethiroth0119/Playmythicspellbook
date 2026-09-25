-- ════════════════════════════════════════════════════════════════════════════
-- 048 — GUILD TRADE: escrowed two-sided trades between corporation members
-- ════════════════════════════════════════════════════════════════════════════
-- Idempotent and re-runnable. Ships its RLS in this file. Ends with a verify.
--
-- ⚠ NUMBERING. `ls sql/` before adding 049 — 044 is the last applied number in
--   this tree and this repo has already had two files claim one number because
--   branches were cut independently. The collision is invisible until the
--   wrong migration runs.
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHY A NEW TABLE, AND NOT corp_transfers
-- ────────────────────────────────────────────────────────────────────────────
--   supabase-org-vault.sql already ships `corp_transfers` + corp_send_asset /
--   corp_claim_transfer / corp_cancel_transfer, and at a glance that looks like
--   the trade backend. It is not, and this must be said plainly because the
--   next person WILL reach for it:
--
--     corp_send_asset INSERTs a row and nothing else. It debits no sender.
--     corp_claim_transfer flips status to 'claimed' and credits no recipient.
--
--   The whole balance change lives in the client (see index.html, the corpSend
--   handler: "do not add a client-side balance change beside these calls").
--   So a corp_transfers row is a NOTE THAT SOMETHING WAS PROMISED. It is
--   one-directional, it holds no escrow, and if the sender closes the tab
--   between send and claim, nothing has moved anywhere. You cannot build a
--   two-sided swap on it: there is nothing to swap.
--
--   This file adds the missing thing — an ESCROW. The offer row holds both
--   sides. Title changes in exactly one statement (the status flip), so there
--   is no window in which both parties own the same asset or neither does.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠ WHAT THIS FILE CAN AND CANNOT PROTECT — read before extending it
-- ────────────────────────────────────────────────────────────────────────────
--   CINDER **is** server-authoritative (sql/023): the canonical balance is
--   user_progress.cinder and wallet_charge is the debit path. So the Cinder leg
--   of a trade is moved HERE, inside these functions, with the same
--   `where cinder >= amount` guard wallet_charge uses. An overdraw is refused by
--   the database, not by the client, and the same wallet_seq counter is bumped
--   on every debit so the boot reconcile in walletFetchProgress does not put the
--   money back (see index.html ~57940 — a debit that fails to bump the seq is
--   silently refunded on the player's next sign-in).
--
--   ⚠ DEPENDS ON sql/023 (+023b). The Cinder leg reads and writes
--     user_progress.cinder / .wallet_seq and the user_profiles.gems mirror. On
--     a database where 023 was never applied, propose/accept with a Cinder side
--     will raise rather than silently move nothing — which is the correct
--     failure. Goods-only trades are unaffected.
--
--   CARDS / ITEMS / RESOURCES are **not** server-authoritative. They live in the
--   player's save blob (Profile.cardCollection / itemInventory / salvage). The
--   database has no copy, so no function here can check that a player really
--   holds what they are offering, and none pretends to: the client debits its
--   own inventory before calling propose/accept and refunds on failure — the
--   proven corp_vault deposit pattern. What the server DOES enforce for those:
--   both parties' membership, no self-trade, positive integer quantities, a
--   bounded number of line items, no duplicate line, and — the part that
--   matters — that the escrowed list is written ONCE and can be claimed ONCE,
--   by exactly one account, so nothing can be delivered twice.
--
--   Closing the item gap means moving player inventories server-side, which is
--   a far larger change that would have to move every award with it. It is NOT
--   attempted here, and this comment exists so nobody reads its absence as an
--   oversight already handled somewhere else. Same position sql/043 takes.
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHY CLAIM IS A SEPARATE STEP (and why Cinder does not need it)
-- ────────────────────────────────────────────────────────────────────────────
--   Accepting decides ownership. But the ITEMS still have to be written into
--   the winner's local save, and that write can be lost (tab closed, browser
--   killed) between the RPC returning and saveProfile landing. So delivery is a
--   second, one-shot, idempotent call: corp_trade_claim flips a per-party
--   boolean with the flag itself in the WHERE clause, so a double click, a
--   retry or two tabs can only ever deliver a payload once. An unclaimed
--   payload stays visible and claimable forever instead of evaporating.
--   Cinder skips all of that — the server owns it, so it simply moves during
--   accept/decline/cancel and there is nothing left to hand over.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CONSERVATION (the property the client screen claims on screen)
-- ────────────────────────────────────────────────────────────────────────────
--   propose : proposer -> escrow      (give side leaves the proposer)
--   accept  : accepter -> escrow, then escrow -> both, atomically
--   decline : escrow -> proposer      (nothing ever left the accepter)
--   cancel  : escrow -> proposer
--   Every path is one transaction, so the sum of an asset across both accounts
--   plus escrow is invariant. Nothing in this file can create units.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0. Membership helper ────────────────────────────────────────────────────
-- SECURITY DEFINER so it bypasses RLS on corp_members and therefore TERMINATES.
-- A policy on an offers table that inlined `select 1 from corp_members` would
-- be evaluated under the caller's RLS, and any future recursive policy on
-- corp_members would take this table down with it. Route every membership
-- question through here — policies included.
--
-- 🔴 SIGNATURE AND BODY ARE VERBATIM sql/045 §1 AND sql/046 §1b. Do not retype
--    it from memory — an earlier draft of THIS file did, and got both halves
--    wrong in ways that only show on a database where 045/046 already ran:
--
--    1. It omitted `default auth.uid()`. `create or replace` CANNOT drop a
--       parameter default: Postgres refuses with
--         ERROR: cannot remove parameter defaults from existing function
--         HINT:  Use DROP FUNCTION public.is_corp_member(uuid,uuid) first.
--       That aborts the whole migration on the first statement, on every real
--       database — the ONLY place it would have "worked" is an empty one.
--
--    2. It dropped the founder branch. Because there is exactly one function
--       and three files replace it, whichever ran LAST would have silently
--       changed who counts as a member for the corp VAULT and the corp
--       TREASURY too, locking a founder whose corp_members row never landed
--       out of both — a lockout nowhere near the file that caused it. This is
--       the duplication hazard sql/046's header names explicitly, arriving
--       exactly as it predicted.
--
--    So: identical signature, identical body, `create or replace`. 045, 046 and
--    048 in any order, any number of times, leave the same single function.
--    Deliberately NOT doing 046's `drop function if exists is_corp_member(uuid)`
--    here: on a database where a one-arg overload has policies hanging off it a
--    bare DROP fails on the dependency and takes this migration down with it.
--    046 owns that cleanup; 048 only needs the two-arg form to resolve.
create or replace function public.is_corp_member(p_corp_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_corp_id is not null
     and p_user_id is not null
     and (
       exists (select 1 from public.corp_members m
                where m.corp_id = p_corp_id and m.user_id = p_user_id)
       -- The founder is a member even when the corp_members row never landed.
       -- corpEnsure() in index.html already self-heals this case client-side;
       -- without the same allowance here a founder can be locked out of their
       -- own vault by a missing row they never see.
       or exists (select 1 from public.corporations c
                   where c.id = p_corp_id and c.founder_id = p_user_id)
     );
$$;

revoke all on function public.is_corp_member(uuid, uuid) from public, anon;
grant execute on function public.is_corp_member(uuid, uuid) to authenticated;


-- ── 1. The offer / escrow table ─────────────────────────────────────────────
create table if not exists public.corp_trade_offers (
  id           uuid primary key default gen_random_uuid(),
  corp_id      uuid not null references public.corporations(id) on delete cascade,
  from_id      uuid not null references auth.users(id) on delete cascade,
  from_name    text,
  to_id        uuid not null references auth.users(id) on delete cascade,
  to_name      text,
  -- Escrowed goods. [{kind,id,name,icon,qty}] — normalised by _ct_norm below,
  -- never trusted as written by the client.
  give_items   jsonb   not null default '[]'::jsonb,
  want_items   jsonb   not null default '[]'::jsonb,
  give_cinder  bigint  not null default 0 check (give_cinder  >= 0),
  want_cinder  bigint  not null default 0 check (want_cinder  >= 0),
  note         text,
  status       text    not null default 'open'
                       check (status in ('open','accepted','declined','cancelled')),
  -- One-shot delivery flags. See "WHY CLAIM IS A SEPARATE STEP".
  from_claimed boolean not null default false,
  to_claimed   boolean not null default false,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz,
  -- Self-trade is refused in the functions too; the constraint is the backstop
  -- that survives someone adding a new write path later.
  constraint corp_trade_offers_not_self check (from_id <> to_id)
);

-- Re-runnable on an older shape: add anything a previous version lacked.
-- `create table if not exists` is NOT column-safe (learned the hard way on 039,
-- which passed its verify while missing two columns the client wrote).
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='corp_trade_offers'
                    and column_name='from_claimed') then
    alter table public.corp_trade_offers add column from_claimed boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='corp_trade_offers'
                    and column_name='to_claimed') then
    alter table public.corp_trade_offers add column to_claimed boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='corp_trade_offers'
                    and column_name='note') then
    alter table public.corp_trade_offers add column note text;
  end if;
end $$;

create index if not exists corp_trade_offers_corp on public.corp_trade_offers (corp_id, created_at desc);
create index if not exists corp_trade_offers_to   on public.corp_trade_offers (to_id, status);
create index if not exists corp_trade_offers_from on public.corp_trade_offers (from_id, status);

alter table public.corp_trade_offers enable row level security;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- SELECT only. The two parties, and only while they are still both in the corp
-- the trade belongs to. Membership goes through the SECURITY DEFINER helper,
-- never a bare `select from corp_members` (see note on the helper).
--
-- 🔴 Read this line by line. Dropping the `auth.uid()` half would expose every
--    trade in the corp to every member; dropping the is_corp_member half would
--    keep exposing a trade to an ex-member after they leave.
drop policy if exists cto_sel on public.corp_trade_offers;
create policy cto_sel on public.corp_trade_offers for select to authenticated
  using (
    (from_id = auth.uid() or to_id = auth.uid())
    and public.is_corp_member(corp_trade_offers.corp_id, auth.uid())
  );

-- No direct writes, ever. Every mutation is one of the five RPCs below, which
-- means an escrow can never be edited into existence or a status flipped
-- without the matching money movement in the same transaction.
-- `public` is in the list on purpose and is not redundant: a grant made to the
-- PUBLIC pseudo-role is inherited by anon and authenticated, so revoking from
-- those two by name leaves the privilege in place and the verify at the bottom
-- of this file would (correctly) report the table as writable.
revoke insert, update, delete on public.corp_trade_offers from public, anon, authenticated;
-- Explicit, because Supabase's default privileges are a project setting and a
-- table nobody can SELECT renders as "you have no trades" — indistinguishable
-- from the honest empty state, which is exactly the failure mode this repo
-- keeps hitting.
grant select on public.corp_trade_offers to authenticated;


-- ── 2. corp_vault_log — widen the action vocabulary ─────────────────────────
-- The ledger ships in supabase-org-vault.sql with
--   check (action in ('deposit','withdraw','send','claim','cancel'))
-- Trade rows need their own verbs or Logistics/Mailbox cannot tell a trade from
-- a payment. Guarded: on a database where the ledger was never installed this
-- is a no-op rather than a failed migration.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='corp_vault_log') then
    alter table public.corp_vault_log drop constraint if exists corp_vault_log_action_check;
    alter table public.corp_vault_log add constraint corp_vault_log_action_check
      check (action in ('deposit','withdraw','send','claim','cancel',
                        'trade_offer','trade_accept','trade_decline','trade_cancel','trade_claim'));
  end if;
end $$;


-- ── 3. Internals — not granted to anyone ────────────────────────────────────

-- Normalise + validate one side's goods. Raises rather than silently dropping a
-- line: a side that quietly loses an item would make the totals the player was
-- shown disagree with what actually moves, which is the exact defect this
-- screen was rebuilt to remove.
create or replace function public._ct_norm(p_items jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_el  jsonb;
  v_seen text[] := '{}';
  v_key text;
  v_qty numeric;
  v_kind text;
  v_id  text;
begin
  if p_items is null or jsonb_typeof(p_items) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'trade goods must be an array'; end if;
  if jsonb_array_length(p_items) > 20 then raise exception 'at most 20 lines per side'; end if;

  for v_el in select * from jsonb_array_elements(p_items) loop
    v_kind := coalesce(v_el->>'kind', '');
    v_id   := coalesce(v_el->>'id', '');
    if v_kind not in ('card','item','resource') then
      raise exception 'unknown asset kind: %', v_kind;
    end if;
    if v_id = '' or length(v_id) > 80 then raise exception 'bad asset id'; end if;
    v_qty := coalesce((v_el->>'qty')::numeric, 0);
    if v_qty <> floor(v_qty) or v_qty <= 0 or v_qty > 1000000000 then
      raise exception 'quantity must be a whole number between 1 and 1000000000';
    end if;
    v_key := v_kind || '|' || v_id;
    if v_key = any (v_seen) then
      raise exception 'duplicate line in offer: %', v_key;
    end if;
    v_seen := v_seen || v_key;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', v_kind,
      'id',   v_id,
      'name', left(coalesce(v_el->>'name', v_id), 80),
      'icon', left(coalesce(v_el->>'icon', ''), 12),
      'qty',  v_qty::bigint
    ));
  end loop;
  return v_out;
end $$;

-- Debit the canonical Cinder wallet. Mirrors wallet_charge (sql/023) exactly,
-- MINUS the 2% Foundation Tax: a trade between two members of the same guild is
-- not a market sale, and taxing it would break the conservation property this
-- file's header promises. Bumps wallet_seq — see the header note; a debit that
-- does not bump it is handed back to the player on their next sign-in.
create or replace function public._ct_cinder_take(p_uid uuid, p_amt bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bal bigint; v_seq bigint;
begin
  if coalesce(p_amt, 0) <= 0 then return jsonb_build_object('moved', 0); end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  update public.user_progress g
     set cinder = g.cinder - p_amt, wallet_seq = g.wallet_seq + 1, updated_at = now()
   where g.user_id = p_uid and g.cinder >= p_amt
   returning g.cinder, g.wallet_seq into v_bal, v_seq;
  if v_bal is null then
    raise exception 'not enough Cinder';
  end if;
  -- Keep the display mirror in step on the way DOWN (023 line ~437: leave the
  -- mirror high and the reconcile puts the spend back).
  update public.user_profiles set gems = v_bal where user_id = p_uid and coalesce(gems,0) > v_bal;
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (p_uid, 'charge', 'cinder', -p_amt, v_bal, p_reason);
  exception when undefined_table or undefined_column then null;
  end;
  return jsonb_build_object('moved', p_amt, 'balance', v_bal, 'wallet_seq', v_seq);
end $$;

-- Credit the canonical Cinder wallet. Mirrors wallet_credit (sql/023b): raises
-- the display mirror, never lowers it, and does NOT bump wallet_seq (credits
-- never do — that counter exists to distinguish server debits).
create or replace function public._ct_cinder_give(p_uid uuid, p_amt bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if coalesce(p_amt, 0) <= 0 then return jsonb_build_object('moved', 0); end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  update public.user_progress
     set cinder = coalesce(cinder,0) + p_amt, updated_at = now()
   where user_id = p_uid
   returning cinder into v_bal;
  update public.user_profiles set gems = v_bal where user_id = p_uid and coalesce(gems,0) < v_bal;
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (p_uid, 'credit', 'cinder', p_amt, coalesce(v_bal,0), p_reason);
  exception when undefined_table or undefined_column then null;
  end;
  return jsonb_build_object('moved', p_amt, 'balance', v_bal);
end $$;

-- History. Guarded on the ledger existing at all, and on its action vocabulary
-- (an older corp_vault_log whose CHECK was not widened must not roll back a
-- real trade just because it cannot describe it).
create or replace function public._ct_log(
  p_corp uuid, p_actor uuid, p_actor_name text, p_action text,
  p_kind text, p_item text, p_name text, p_icon text, p_qty numeric,
  p_other uuid, p_other_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id,
                                       name, icon, qty, counterparty_id, counterparty_name)
    values (p_corp, p_actor, p_actor_name, p_action, p_kind, p_item,
            p_name, p_icon, p_qty, p_other, p_other_name);
  exception when undefined_table or undefined_column or check_violation then null;
  end;
end $$;

-- Write one ledger line per escrowed good, plus one for a Cinder leg.
create or replace function public._ct_log_side(
  p_corp uuid, p_actor uuid, p_actor_name text, p_action text,
  p_items jsonb, p_cinder bigint, p_other uuid, p_other_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_el jsonb;
begin
  for v_el in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    perform public._ct_log(p_corp, p_actor, p_actor_name, p_action,
                           v_el->>'kind', v_el->>'id', v_el->>'name', v_el->>'icon',
                           (v_el->>'qty')::numeric, p_other, p_other_name);
  end loop;
  if coalesce(p_cinder,0) > 0 then
    perform public._ct_log(p_corp, p_actor, p_actor_name, p_action,
                           'cinder', 'cinder', 'Cinder', '🔥', p_cinder, p_other, p_other_name);
  end if;
end $$;

revoke all on function public._ct_norm(jsonb) from public, anon, authenticated;
revoke all on function public._ct_cinder_take(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public._ct_cinder_give(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public._ct_log(uuid, uuid, text, text, text, text, text, text, numeric, uuid, text) from public, anon, authenticated;
revoke all on function public._ct_log_side(uuid, uuid, text, text, jsonb, bigint, uuid, text) from public, anon, authenticated;


-- ── 4. PROPOSE ──────────────────────────────────────────────────────────────
-- The proposer's side is escrowed here and now. The "want" side is a demand,
-- not an escrow — the accepter's goods are escrowed at accept time, in the same
-- transaction that hands them over, so they are never held hostage by an offer
-- they have not agreed to.
create or replace function public.corp_trade_propose(
  p_corp_id uuid, p_to_id uuid,
  p_give jsonb, p_give_cinder bigint,
  p_want jsonb, p_want_cinder bigint,
  p_note text default null, p_from_name text default null, p_to_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_give jsonb; v_want jsonb;
  v_gc bigint := greatest(0, coalesce(p_give_cinder, 0));
  v_wc bigint := greatest(0, coalesce(p_want_cinder, 0));
  v_id uuid; v_cash jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_to_id = v_uid then raise exception 'cannot trade with yourself'; end if;
  -- BOTH sides must be in the org, checked server-side. Without the recipient
  -- check this becomes a way to move assets to any account in the game.
  if not public.is_corp_member(p_corp_id, v_uid)   then raise exception 'not a member of that corporation'; end if;
  if not public.is_corp_member(p_corp_id, p_to_id) then raise exception 'they are not a member of that corporation'; end if;

  v_give := public._ct_norm(p_give);
  v_want := public._ct_norm(p_want);
  if jsonb_array_length(v_give) = 0 and v_gc = 0
     and jsonb_array_length(v_want) = 0 and v_wc = 0 then
    raise exception 'an offer must contain something on at least one side';
  end if;

  -- Escrow the Cinder leg. Raises 'not enough Cinder' — the database, not the
  -- client, is what refuses an overdraw here.
  v_cash := public._ct_cinder_take(v_uid, v_gc, 'Guild trade escrow');

  insert into public.corp_trade_offers
    (corp_id, from_id, from_name, to_id, to_name,
     give_items, want_items, give_cinder, want_cinder, note)
  values
    (p_corp_id, v_uid, left(coalesce(p_from_name,''),40), p_to_id, left(coalesce(p_to_name,''),40),
     v_give, v_want, v_gc, v_wc, left(coalesce(p_note,''), 240))
  returning id into v_id;

  perform public._ct_log_side(p_corp_id, v_uid, p_from_name, 'trade_offer', v_give, v_gc, p_to_id, p_to_name);

  return jsonb_build_object('id', v_id, 'cinder', v_cash->'balance', 'wallet_seq', v_cash->'wallet_seq');
end $$;


-- ── 5. ACCEPT — the swap ────────────────────────────────────────────────────
-- One transaction. `for update` serialises two accepters (there can only be
-- one, but a double-click is two requests), and the status guard means the
-- second one finds nothing open and raises instead of paying twice.
create or replace function public.corp_trade_accept(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.corp_trade_offers;
  v_cash jsonb := '{}'::jsonb;
  v_bal bigint;
  v_seq bigint;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into r from public.corp_trade_offers where id = p_id for update;
  if r.id is null then raise exception 'offer not found'; end if;
  if r.to_id <> v_uid then raise exception 'this offer was not made to you'; end if;
  if r.status <> 'open' then raise exception 'that offer is no longer open'; end if;
  -- Re-check membership AT ACCEPT TIME. Either party may have left the corp in
  -- the meantime, and an offer must not survive as a back door out of it.
  if not public.is_corp_member(r.corp_id, r.from_id) then raise exception 'the proposer has left the corporation'; end if;
  if not public.is_corp_member(r.corp_id, r.to_id)   then raise exception 'you have left that corporation'; end if;

  -- My Cinder out first: if I cannot cover it the whole transaction rolls back
  -- and their escrow is untouched.
  v_cash := public._ct_cinder_take(v_uid, r.want_cinder, 'Guild trade');
  v_seq  := nullif(v_cash->>'wallet_seq', '')::bigint;
  -- Then both credits. The proposer's escrowed Cinder was already taken at
  -- propose time, so this is escrow -> me, not a mint.
  perform public._ct_cinder_give(v_uid,     r.give_cinder, 'Guild trade');
  perform public._ct_cinder_give(r.from_id, r.want_cinder, 'Guild trade');

  update public.corp_trade_offers
     set status = 'accepted', settled_at = now()
   where id = r.id and status = 'open';

  perform public._ct_log_side(r.corp_id, v_uid, r.to_name, 'trade_accept', r.want_items, r.want_cinder, r.from_id, r.from_name);

  /* WHAT THE CLIENT IS TOLD, AND WHY IT IS SPLIT IN TWO.
       `cinder`        — the balance immediately after MY DEBIT, with its
                         wallet_seq. The client adopts a debit answer verbatim,
                         exactly as chargeCinderAtomic does after wallet_charge.
       `credit_cinder` — what this trade PAID me. The client adds it locally
                         and does NOT mirror it, because the credit above has
                         already landed in user_progress.
     ⚠ DO NOT "simplify" this into one post-credit balance. Adopting a figure
       produced by a pure CREDIT would silently drop any legitimate local
       balance whose own mirror call had failed — which is the precise thing
       walletFetchProgress's MAX exists to protect, and the reason the wallet
       counter only ever moves on debits. */
  v_bal := nullif(v_cash->>'balance', '')::bigint;

  -- The goods themselves are handed over by corp_trade_claim; the caller
  -- normally calls it immediately. claim_now says so out loud.
  return jsonb_build_object(
    'ok', true,
    'claim_now',     jsonb_array_length(r.give_items) > 0,
    'cinder',        v_bal,
    'wallet_seq',    v_seq,
    'credit_cinder', coalesce(r.give_cinder, 0));
end $$;


-- ── 6. DECLINE / CANCEL — escrow returns ────────────────────────────────────
-- The Cinder goes straight back (the server owns it). The goods wait for the
-- proposer to claim them, for the same reason a delivery does.
create or replace function public.corp_trade_decline(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r public.corp_trade_offers;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into r from public.corp_trade_offers where id = p_id for update;
  if r.id is null then raise exception 'offer not found'; end if;
  if r.to_id <> v_uid then raise exception 'this offer was not made to you'; end if;
  if r.status <> 'open' then raise exception 'that offer is no longer open'; end if;

  update public.corp_trade_offers set status = 'declined', settled_at = now()
   where id = r.id and status = 'open';
  perform public._ct_cinder_give(r.from_id, r.give_cinder, 'Guild trade declined — escrow returned');
  perform public._ct_log_side(r.corp_id, v_uid, r.to_name, 'trade_decline', r.give_items, r.give_cinder, r.from_id, r.from_name);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.corp_trade_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r public.corp_trade_offers;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into r from public.corp_trade_offers where id = p_id for update;
  if r.id is null then raise exception 'offer not found'; end if;
  if r.from_id <> v_uid then raise exception 'that is not your offer'; end if;
  if r.status <> 'open' then raise exception 'that offer is no longer open'; end if;

  update public.corp_trade_offers set status = 'cancelled', settled_at = now()
   where id = r.id and status = 'open';
  perform public._ct_cinder_give(v_uid, r.give_cinder, 'Guild trade cancelled — escrow returned');
  perform public._ct_log_side(r.corp_id, v_uid, r.from_name, 'trade_cancel', r.give_items, r.give_cinder, r.to_id, r.to_name);
  -- A pure credit, so the client ADDS this locally rather than adopting a
  -- balance — see the note in corp_trade_accept for why that distinction is
  -- load-bearing and not tidiness.
  return jsonb_build_object('ok', true, 'credit_cinder', coalesce(r.give_cinder, 0));
end $$;


-- ── 7. CLAIM — one-shot delivery of the goods ───────────────────────────────
-- Idempotent BY CONSTRUCTION, the same way corp_claim_transfer is: the flag
-- being false is part of the WHERE clause, so the second call updates zero rows
-- and returns an empty payload instead of a second copy of the goods.
create or replace function public.corp_trade_claim(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r public.corp_trade_offers; v_items jsonb; v_n int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into r from public.corp_trade_offers where id = p_id for update;
  if r.id is null then raise exception 'offer not found'; end if;

  if r.status = 'accepted' then
    if v_uid = r.to_id then
      update public.corp_trade_offers set to_claimed = true
       where id = r.id and status = 'accepted' and to_claimed = false;
      get diagnostics v_n = row_count;
      v_items := case when v_n = 1 then r.give_items else '[]'::jsonb end;
    elsif v_uid = r.from_id then
      update public.corp_trade_offers set from_claimed = true
       where id = r.id and status = 'accepted' and from_claimed = false;
      get diagnostics v_n = row_count;
      v_items := case when v_n = 1 then r.want_items else '[]'::jsonb end;
    else
      raise exception 'not your trade';
    end if;
  elsif r.status in ('declined','cancelled') then
    -- Only the proposer ever had goods in escrow, so only they get a refund.
    if v_uid <> r.from_id then raise exception 'nothing here for you'; end if;
    update public.corp_trade_offers set from_claimed = true
     where id = r.id and status in ('declined','cancelled') and from_claimed = false;
    get diagnostics v_n = row_count;
    v_items := case when v_n = 1 then r.give_items else '[]'::jsonb end;
  else
    raise exception 'that offer has not settled yet';
  end if;

  if jsonb_array_length(v_items) > 0 then
    perform public._ct_log_side(r.corp_id, v_uid, null, 'trade_claim', v_items, 0,
                                case when v_uid = r.from_id then r.to_id else r.from_id end, null);
  end if;
  return jsonb_build_object('items', v_items);
end $$;


-- ── 8. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.corp_trade_propose(uuid,uuid,jsonb,bigint,jsonb,bigint,text,text,text) from public, anon;
revoke all on function public.corp_trade_accept(uuid)  from public, anon;
revoke all on function public.corp_trade_decline(uuid) from public, anon;
revoke all on function public.corp_trade_cancel(uuid)  from public, anon;
revoke all on function public.corp_trade_claim(uuid)   from public, anon;

grant execute on function public.corp_trade_propose(uuid,uuid,jsonb,bigint,jsonb,bigint,text,text,text) to authenticated;
grant execute on function public.corp_trade_accept(uuid)  to authenticated;
grant execute on function public.corp_trade_decline(uuid) to authenticated;
grant execute on function public.corp_trade_cancel(uuid)  to authenticated;
grant execute on function public.corp_trade_claim(uuid)   to authenticated;


-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Counts COLUMNS as well as objects. A verify that only counts tables reports
-- green against a table of the wrong SHAPE — that is how 039 passed while
-- missing two columns the shipped client wrote on every insert.
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='corp_trade_offers')                       as table_expect_1,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='corp_trade_offers')                       as cols_expect_16,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='corp_trade_offers')                          as policies_expect_1,
  (select count(*) from pg_tables
    where schemaname='public' and tablename='corp_trade_offers' and rowsecurity)          as rls_expect_1,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('corp_trade_propose','corp_trade_accept','corp_trade_decline',
       'corp_trade_cancel','corp_trade_claim','is_corp_member'))                          as fns_expect_6,
  -- Nobody may write the table directly. has_table_privilege() already folds in
  -- anything granted via the PUBLIC pseudo-role, so this one boolean covers the
  -- inheritance the revoke above has to spell out.
  (select bool_or(has_table_privilege('authenticated','public.corp_trade_offers', p))
     from unnest(array['insert','update','delete']) p)                                    as client_can_write_expect_false;
