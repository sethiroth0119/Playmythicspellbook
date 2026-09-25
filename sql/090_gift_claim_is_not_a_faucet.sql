-- ===========================================================================
-- 090 — AN ADMIN GIFT IS NOT A FAUCET: gift_claim stops paying through the
--       rate-capped wallet_credit, and can no longer mark a gift claimed
--       without actually paying it.
--
-- Reported as: "I sent 200,000 to AetosDios, he claimed the reward and it
-- didn't go into his wallet." (2026-09-03, gift 9a03ab7c.)
--
-- THE CAUSE is two functions that are each correct alone and wrong together:
--
--   1. sql/047 set wallet_credit's DAILY ceiling to 500,000 on purpose, below
--      measured play, to throttle the game's Cinder FAUCETS (sales, deliveries,
--      addGems). When the ceiling binds it does not raise: it logs a
--      'REFUSED daily>' ledger row and returns the unchanged balance.
--   2. sql/027's gift_claim flips the gift to 'claimed' FIRST, then calls
--      wallet_credit, and trusts whatever comes back. A refusal looks exactly
--      like success to it: status = claimed, paid = true, balance unchanged.
--
--   AetosDios had 502,782 credited in the previous 24 h, so his 200,000 gift
--   was refused by the day test and the row stayed claimed. The Cinder was
--   never anywhere. The ledger says so in one line:
--       REFUSED daily>500000 used=502782 asked=200000 as=Gift claim: Cinder
--
-- WHY GIFTS BYPASS THE CAP rather than the cap being raised: the ceiling in
-- 047 is the owner's inflation policy for what PLAY can mint. A gift is the
-- owner's own deliberate grant, inserted through an admin-only RLS policy into
-- a row players cannot edit (027). Throttling the owner's grant by the owner's
-- faucet cap is a category error: it turns an admin decision into a support
-- ticket and, worse, deletes the money. So gifts credit through a new
-- INTERNAL function with no rate tests, callable only from SECURITY DEFINER
-- code (no grant to authenticated or anon, so no client can reach it).
--
-- AND THE FLIP IS NOW TIED TO THE PAYMENT. If the credit returns null the
-- function raises, which rolls back the status flip in the same transaction,
-- and the gift stays in the inbox. A claimed-but-unpaid gift can no longer
-- exist.
--
-- Idempotent and re-runnable. The recovery at the bottom is keyed by ledger
-- ref, so running this file twice pays AetosDios once.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. _wallet_credit_direct: the audited credit body without the faucet
--    tests. Same three writes as wallet_credit (canonical cinder, display
--    mirror, ledger row), same ref idempotency. Leading underscore and no
--    execute grant, like _sov_apply: server code only.
-- --------------------------------------------------------------------------
create or replace function public._wallet_credit_direct(p_uid uuid, p_amount bigint, p_reason text, p_ref text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $d$
declare
  v_bal bigint;
begin
  if p_uid is null or p_amount is null or p_amount <= 0 then return null; end if;

  -- Already paid under this ref: report the balance, add nothing.
  if p_ref is not null and exists (
       select 1 from public.wallet_ledger where user_id = p_uid and ref = p_ref) then
    select coalesce(cinder, 0) into v_bal from public.user_progress where user_id = p_uid;
    return coalesce(v_bal, 0);
  end if;

  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  update public.user_progress
     set cinder = coalesce(cinder, 0) + p_amount, updated_at = now()
   where user_id = p_uid
   returning cinder into v_bal;
  if v_bal is null then return null; end if;

  update public.user_profiles set gems = v_bal
   where user_id = p_uid and coalesce(gems, 0) < v_bal;

  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (p_uid, 'credit', 'cinder', p_amount, v_bal, p_reason, p_ref);
  exception
    when unique_violation then null;
    when undefined_table or undefined_column then null;
  end;
  return v_bal;
end;
$d$;
revoke all on function public._wallet_credit_direct(uuid, bigint, text, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. gift_claim: identical to 027 except the two Cinder branches credit
--    directly, carry the gift id as the ledger ref, and RAISE on a null
--    result so the status flip above rolls back with them.
-- --------------------------------------------------------------------------
create or replace function public.gift_claim(p_gift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $g$
declare
  v_uid  uuid := auth.uid();
  v_cid  text;
  v_qty  bigint;
  v_bal  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_gift_id is null then return jsonb_build_object('ok', false, 'error', 'bad_args'); end if;

  update public.gifts
     set status = 'claimed', claimed_at = now()
   where id = p_gift_id
     and to_user = v_uid
     and status = 'pending'
   returning card_id, greatest(0, coalesce(qty, 0))::bigint
        into v_cid, v_qty;

  if v_cid is null then
    return jsonb_build_object('ok', false, 'error', 'not_claimable');
  end if;

  if v_cid = '__cinder__' then
    if v_qty > 0 then
      v_bal := public._wallet_credit_direct(v_uid, v_qty, 'Gift claim: Cinder', 'gift:' || p_gift_id::text);
      if v_bal is null then
        raise exception 'gift_claim: Cinder credit failed for gift %', p_gift_id;
      end if;
    end if;
    return jsonb_build_object('ok', true, 'kind', v_cid, 'qty', v_qty,
                              'paid', true, 'cinder', v_bal);

  elsif v_cid = '__coupon__' then
    if v_qty > 0 then
      v_bal := public._wallet_credit_direct(v_uid, v_qty, 'Gift claim: coupon', 'gift:' || p_gift_id::text);
      if v_bal is null then
        raise exception 'gift_claim: coupon credit failed for gift %', p_gift_id;
      end if;
    end if;
    return jsonb_build_object('ok', true, 'kind', v_cid, 'qty', v_qty,
                              'paid', true, 'cinder', v_bal);

  elsif v_cid = '__aza__' then
    if v_qty > 0 then
      v_bal := public._sov_apply(v_uid, v_qty, 'Aza gift claim');
      if v_bal is null then
        raise exception 'gift_claim: Aza credit failed for gift %', p_gift_id;
      end if;
    end if;
    return jsonb_build_object('ok', true, 'kind', v_cid, 'qty', v_qty,
                              'paid', true, 'aza', v_bal);
  end if;

  return jsonb_build_object('ok', true, 'kind', v_cid, 'qty', v_qty, 'paid', false);
end;
$g$;
revoke all on function public.gift_claim(uuid) from public, anon;
grant execute on function public.gift_claim(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 3. RECOVERY: pay the one gift this bug ate. Keyed by ref, so re-running
--    is a no-op. The ledger search that found it (run before this file):
--      select user_id, reason from wallet_ledger
--       where op='refused' and reason like '%as=Gift claim%';
--    returned exactly one row, AetosDios, gift 9a03ab7c.
-- --------------------------------------------------------------------------
select public._wallet_credit_direct(
  '29e5da8b-ac64-412a-9bd4-c348e61c55c9',
  200000,
  'Gift claim: Cinder (restored by sql/090, refused by the daily cap on 2026-09-03)',
  'gift:9a03ab7c-25e2-4d92-8b77-649fc36f6783') as aetosdios_balance_after;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- 1) Nobody but server code can call the direct credit:
-- select grantee, privilege_type from information_schema.routine_privileges
--  where routine_name = '_wallet_credit_direct';            -- postgres only
-- 2) AetosDios holds the 200,000:
-- select cinder from user_progress where user_id='29e5da8b-ac64-412a-9bd4-c348e61c55c9';  -- 433508
-- 3) No claimed money gift without a matching ledger credit, from now on:
-- select g.id from gifts g where g.status='claimed' and g.card_id='__cinder__'
--    and g.claimed_at > now() and not exists
--    (select 1 from wallet_ledger l where l.ref = 'gift:'||g.id::text);       -- 0 rows
