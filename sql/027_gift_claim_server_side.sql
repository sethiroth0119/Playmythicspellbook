-- ===========================================================================
-- 027 — THE GIFT INBOX STOPS BEING PLAYER-WRITABLE.
--
-- Reported as: "when I Grant a reward in User Management it keeps sending them
-- the same amount of money." One admin grant, paid out over and over.
--
-- THE CAUSE, and it is one policy line (api.sql):
--
--     create policy gifts_upd on public.gifts for update to authenticated
--       using (to_user = auth.uid()) with check (to_user = auth.uid());
--
-- That lets the recipient UPDATE ANY COLUMN of their own gift row. The claim
-- was a client-side flip:
--
--     .update({status:'claimed'}).eq('id',…).eq('status','pending')
--
-- ...which reads like a guard and is not one. It stops two TABS racing. It
-- does nothing about a player who simply sets status back to 'pending' and
-- claims again. Unlimited replays of a single admin grant — the reported dupe.
--
-- And the same policy line is a second, worse hole: `qty` is player-writable
-- too. The payout amount was read from the row (client-side for Cinder, and
-- server-side but still FROM THE ROW in aza_gift_claim). So a player could
-- set qty on a 1-Aza gift to any number and claim it. Aza is bought with real
-- money and sov_credit is service-role precisely so the client can never name
-- an amount — this policy handed that back. `card_id` was writable as well, so
-- a resource gift could be rewritten into a Cinder one.
--
-- THE FIX: players get no UPDATE on gifts at all. Claiming moves into
-- gift_claim(), a SECURITY DEFINER function that flips pending -> claimed and
-- pays out in one statement-chain, reading the amount from the row the player
-- can no longer touch. Exactly the shape sql/024 already used for
-- aza_gift_claim — this generalises it to every gift kind and, by removing the
-- UPDATE grant, finally makes aza_gift_claim's own `qty` read trustworthy.
--
-- ⚠ FAILS CLOSED, deliberately, like sql/022's boe_transfer. Until this file is
--   applied the RPC is absent and the client refuses to claim rather than
--   falling back to the old client-side flip. A gift that waits in the inbox is
--   a support ticket; a gift that can be claimed forever is a money supply.
--
-- Idempotent and re-runnable. Verify query at the bottom.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Take the UPDATE grant away from players.
--
--    Nothing legitimate is lost. The only writes a player ever needed were the
--    claim flip and the two un-claim rollbacks in claimGift(), and both now go
--    through the SECURITY DEFINER functions below, which bypass RLS.
--
--    Admins keep UPDATE so a mis-typed grant can still be cancelled or
--    corrected from the dossier. is_admin() is the verified top-level JWT email
--    claim (api.sql), not user_metadata.
-- --------------------------------------------------------------------------
drop policy if exists gifts_upd on public.gifts;
create policy gifts_upd on public.gifts
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- DELETE was never granted to anyone; assert that rather than assume it. A
-- player who can delete a claimed row can re-request it from any code path
-- that re-inserts on absence.
drop policy if exists gifts_del on public.gifts;
create policy gifts_del on public.gifts
  for delete to authenticated
  using (public.is_admin());

-- --------------------------------------------------------------------------
-- 2. gift_claim — flip and pay in one place.
--
--    Returns the KIND and the QUANTITY so the client can apply the
--    non-monetary half locally (cards, items, resources, cosmetics, packs,
--    nodes all live in client-held progression and are not money). Money is
--    NEVER returned for the client to apply — it is credited here:
--
--      __cinder__ / __coupon__  -> wallet_credit()  (canonical user_progress)
--      __aza__                  -> _sov_apply()     (canonical + ledger)
--
--    wallet_credit() reads auth.uid() internally. That is still the claiming
--    player inside a SECURITY DEFINER function — definer rights change the
--    privilege context, not the request's JWT claims — so calling it here
--    reuses its audited body (ledger row + display-mirror raise) rather than
--    re-implementing a second credit path that could drift from it.
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

  -- The claim IS this statement. `status = 'pending'` in the WHERE is what
  -- makes it exactly-once, and it is now load-bearing because the player can
  -- no longer put the row back to pending afterwards.
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

  -- 💰 Money kinds settle here and are not handed back to the client.
  if v_cid = '__cinder__' then
    if v_qty > 0 then v_bal := public.wallet_credit(v_qty, 'Gift claim: Cinder'); end if;
    return jsonb_build_object('ok', true, 'kind', v_cid, 'qty', v_qty,
                              'paid', true, 'cinder', v_bal);

  elsif v_cid = '__coupon__' then
    -- A coupon's face value pays out in Cinder, and the coupon record itself is
    -- cosmetic history the client keeps. `paid` tells the client the Cinder is
    -- already in the canonical row so it must not add it a second time.
    if v_qty > 0 then v_bal := public.wallet_credit(v_qty, 'Gift claim: coupon'); end if;
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

  -- Everything else is inventory, not money. The client applies it; `paid` is
  -- false so there is never any ambiguity about who moved what.
  return jsonb_build_object('ok', true, 'kind', v_cid, 'qty', v_qty, 'paid', false);
end;
$g$;
revoke all on function public.gift_claim(uuid) from public, anon;
grant execute on function public.gift_claim(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 3. gift_unclaim — the rollback claimGift() already had, made safe.
--
--    Two client paths un-claim a gift when the local half fails: a PRN node
--    grant with no corporation row to attach to, and a booster pack whose
--    definition has not reached the catalog yet. Both must keep working or the
--    gift is silently destroyed.
--
--    ⚠ MONEY KINDS ARE REFUSED. If this accepted '__cinder__' it would be the
--      replay hole again wearing an RPC's clothes — claim, un-claim, claim.
--      Only the kinds whose payout the client applies (and which therefore have
--      a real failure mode worth rolling back) are eligible.
-- --------------------------------------------------------------------------
create or replace function public.gift_unclaim(p_gift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $u$
declare
  v_uid uuid := auth.uid();
  v_cid text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_gift_id is null then return jsonb_build_object('ok', false, 'error', 'bad_args'); end if;

  update public.gifts
     set status = 'pending', claimed_at = null
   where id = p_gift_id
     and to_user = v_uid
     and status = 'claimed'
     and card_id not in ('__cinder__', '__aza__', '__coupon__')
   returning card_id into v_cid;

  if v_cid is null then
    return jsonb_build_object('ok', false, 'error', 'not_unclaimable');
  end if;
  return jsonb_build_object('ok', true, 'kind', v_cid);
end;
$u$;
revoke all on function public.gift_unclaim(uuid) from public, anon;
grant execute on function public.gift_unclaim(uuid) to authenticated;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- 1) No player-writable path into the gift row. Expect gifts_upd and gifts_del
--    to be admin-gated, and NO policy whose qual mentions `to_user = auth.uid()`
--    for update/delete:
--
-- select policyname, cmd, qual, with_check
--   from pg_policies where schemaname='public' and tablename='gifts'
--  order by cmd, policyname;
--
-- 2) Both functions exist and are SECURITY DEFINER (prosecdef must be true —
--    they bypass RLS on purpose, and that is the whole mechanism):
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public' and p.proname in ('gift_claim','gift_unclaim')
--  order by 1;
--
-- 3) The replay is dead. As a normal player, against your own claimed gift:
--
-- update public.gifts set status='pending' where id='<a gift of yours>';
--   -> UPDATE 0   (RLS filters it; not an error, just no rows)
-- select public.gift_claim('<the same gift id>');
--   -> {"ok": false, "error": "not_claimable"}
--
-- 4) The amount is no longer player-chosen:
--
-- update public.gifts set qty = 999999 where id='<a pending gift of yours>';
--   -> UPDATE 0
-- ===========================================================================
