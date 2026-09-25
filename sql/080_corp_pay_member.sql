-- ============================================================================
-- 080 · CORP PAY — a payment that actually moves Cinder.
-- ============================================================================
-- THE REPORT, made more than once: "when a corp owner pays the people they
-- hired in their corp, transfer the cinder to the player who is getting paid's
-- wallet."
--
-- WHY EVERY EARLIER FIX MISSED IT. The payment path never touched a wallet on
-- either side. Read the two functions it used:
--
--   corp_send_asset()      INSERTs a corp_transfers row + a vault_log row.
--                          Debits NOBODY.
--   corp_claim_transfer()  UPDATEs that row's status to 'claimed'.
--                          Credits NOBODY.
--
-- The only arithmetic was in the BROWSER — the sender's copy of Profile.gems
-- went down, the recipient's went up when they clicked Claim — while the
-- canonical wallet (user_progress.cinder) sat untouched. walletReconcile()
-- then re-reads that canonical row and, by design, "never lowers anything"
-- and adopts the server value when it is ahead. So the local credit was
-- undone on the next sync and the money was never there to begin with.
--
-- PROVED ON PRODUCTION BEFORE WRITING THIS, not inferred: the one claimed
-- transfer on record (LIDS → URDA, 10,000, claimed 2026-08-25) has NO
-- wallet_ledger row on either side, and URDA's ledger across that whole
-- session runs 1,450 → 3,335 on achievements, missions and node milestones
-- with no 10,000 anywhere in it. Sender not debited, recipient not credited.
--
-- WHAT THIS DOES. One atomic function that moves the money at PAY time, using
-- the same two primitives the corp TRADE escrow already uses (_ct_cinder_take
-- / _ct_cinder_give — they write user_progress.cinder, mirror
-- user_profiles.gems and append wallet_ledger). No claim step: the money is in
-- the recipient's wallet when the payer's button returns.
--
-- 🔴 CINDER ONLY, AND THAT IS NOT LAZINESS. Cards, items and other resources
--    have NO server-side inventory in this game — screens.jsx says so where it
--    refuses to build a picker for them. There is nowhere on the server to move
--    a card FROM or TO, so those keep the existing pending/claim flow, where
--    the client is the only thing that can do it. Making them look like they
--    settle server-side would be the same lie this file removes.
--
-- ⚠ THE CLAIM WINDOW IS GONE FOR CINDER, DELIBERATELY. It existed so a sender
--   could cancel a mistake. It is also exactly what was failing to reach
--   players. A wage that lands is worth more than an undo on a wage that never
--   arrives, and the owner has asked for the former three times.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

create or replace function public.corp_pay_member(
  p_corp_id   uuid,
  p_to_id     uuid,
  p_qty       bigint,
  p_note      text default null,
  p_from_name text default null,
  p_to_name   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_qty  bigint := floor(coalesce(p_qty, 0));
  v_take jsonb;
  v_give jsonb;
  v_id   uuid;
  v_a    uuid;
  v_b    uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if v_qty <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_to_id is null then raise exception 'pick who to pay'; end if;
  if p_to_id = v_uid then raise exception 'cannot pay yourself'; end if;

  -- Both ends must be in the corporation. Checked on the SERVER because a
  -- SECURITY DEFINER function is reachable by anyone with a session — the
  -- screen's own guard is a convenience, not a control.
  if not exists (select 1 from corp_members where corp_id = p_corp_id and user_id = v_uid) then
    raise exception 'you are not a member of that corporation';
  end if;
  if not exists (select 1 from corp_members where corp_id = p_corp_id and user_id = p_to_id) then
    raise exception 'they are not a member of that corporation';
  end if;

  -- 🔒 LOCK BOTH WALLETS IN A FIXED ORDER (lowest uuid first) BEFORE TOUCHING
  --    EITHER. Two colleagues paying each other at the same instant would
  --    otherwise take the two rows in opposite orders and deadlock — one of
  --    them loses their payment to a serialisation failure, which is the kind
  --    of once-a-month fault nobody can ever reproduce.
  insert into user_progress (user_id) values (v_uid)   on conflict (user_id) do nothing;
  insert into user_progress (user_id) values (p_to_id) on conflict (user_id) do nothing;
  if v_uid < p_to_id then v_a := v_uid; v_b := p_to_id; else v_a := p_to_id; v_b := v_uid; end if;
  perform 1 from user_progress where user_id = v_a for update;
  perform 1 from user_progress where user_id = v_b for update;

  -- The money. _ct_cinder_take raises 'not enough Cinder' when the payer
  -- cannot cover it, and because this is one function it is one transaction:
  -- if the credit fails for any reason the debit is rolled back with it, so
  -- there is no state in which the Cinder exists on neither side.
  v_take := _ct_cinder_take(v_uid,   v_qty, 'Corp pay to ' || coalesce(p_to_name, 'a colleague'));
  v_give := _ct_cinder_give(p_to_id, v_qty, 'Corp pay from ' || coalesce(p_from_name, 'a colleague'));

  -- The receipt. Recorded as already settled, because it is: 'claimed' with a
  -- settled_at is the only shape corp_transfers_status_check allows for a
  -- transfer that is finished, and inventing a fourth status would break every
  -- reader of this table for cosmetic accuracy.
  insert into corp_transfers (corp_id, from_id, from_name, to_id, to_name,
                              kind, item_id, name, icon, qty, note, status, settled_at)
  values (p_corp_id, v_uid, p_from_name, p_to_id, p_to_name,
          'resource', 'cinder', 'Cinder', '🔥', v_qty, p_note, 'claimed', now())
  returning id into v_id;

  -- Two log lines, because two things happened and they happened to two
  -- different people. The vault log is what a founder reads to see where the
  -- treasury went, and one line would leave the receiving half unattributed.
  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id,
                              name, icon, qty, counterparty_id, counterparty_name)
  values (p_corp_id, v_uid, p_from_name, 'send', 'resource', 'cinder',
          'Cinder', '🔥', v_qty, p_to_id, p_to_name);
  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id,
                              name, icon, qty, counterparty_id, counterparty_name)
  values (p_corp_id, p_to_id, p_to_name, 'claim', 'resource', 'cinder',
          'Cinder', '🔥', v_qty, v_uid, p_from_name);

  -- 🔴 THE BALANCES AND THE SEQ ARE RETURNED, AND THE CLIENT MUST USE THEM.
  --    _ct_cinder_take bumps user_progress.wallet_seq; a payer whose client
  --    keeps its old seq will have walletReconcile see the server ahead of it,
  --    adopt downward and — correctly but confusingly — appear to be charged a
  --    second time on screen. Handing back the authoritative pair lets the
  --    client land on the server's own numbers immediately.
  --    The recipient needs no seq: _ct_cinder_give does NOT bump it, so their
  --    next reconcile sees server > local and adopts UPWARD on its own. That is
  --    why a paid player who is offline right now still finds the money waiting
  --    the next time they sign in.
  return jsonb_build_object(
    'id',             v_id,
    'qty',            v_qty,
    'from_balance',   (v_take->>'balance')::bigint,
    'from_wallet_seq',(v_take->>'wallet_seq')::bigint,
    'to_balance',     (v_give->>'balance')::bigint
  );
end $$;

revoke all on function public.corp_pay_member(uuid, uuid, bigint, text, text, text) from public, anon;
grant execute on function public.corp_pay_member(uuid, uuid, bigint, text, text, text) to authenticated;
