-- ===========================================================================
-- 155_C — A LUNI SALE IS PAID BY THE SERVER, IN THE SAME TRANSACTION AS ITS CLAIM.
-- DRAFT — NOT APPLIED. Paste into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
--
-- Reported (bug-mtyn1mcn): "Luni payment bug: 2 lots of water @ 50k c each were
-- sold without payment. Total 100K c".
--
-- WHAT THE DATA SAYS (read-only, 2026-09-17): the seller (Mavric) listed 5 lots
-- of 100 water at 50,000 (resource_listings 21609071…). THREE sold and all three
-- were paid (resource_trade_ledger 2105 / 2167 / 2189, each with a seller claim
-- and a wallet_ledger 'credit' of 50,000, "Resource exchange sale"). The other
-- TWO did not sell: ledger 2386 kind 'expire', 200 units, claimed 2026-09-12
-- 02:47 UTC — and the client live that day announced a returned expiry under
-- "💰 Exchange collected: 200 💧 back", a money headline over goods that came
-- home. He re-listed those 200 water at 16:57 (listing e35a563d…) and reported
-- at 17:07. The headline was split later (_resEntryNotice, "Did not sell").
--
-- THE STRUCTURAL HOLE THIS CLOSES. A seller is paid by THEIR OWN CLIENT, later:
-- rl_claim spends the one-time claim, THEN the client credits itself through
-- wallet_credit(p_amount). wallet_credit may REFUSE (single > 2,000,000; hourly
-- > 10,000,000) or HOLD (daily > 4,500,000) and still returns a balance, not an
-- error — so the client books the Cinder locally, the claim is gone, and the
-- next wallet refresh adopts the server's lower balance. That is exactly "sold
-- without payment", and nothing could ever re-offer the row.
--
-- rl_claim_sale_pay(p_ledger_id) pays a CINDER SALE from the row the server
-- itself wrote (rl_take_lots set price_total from the listing): it claims and
-- credits in ONE transaction through _ct_cinder_give, so a claim can never be
-- spent without the credit, and a credit can never land twice (the claim's
-- primary key (ledger_id, party) is the idempotence key).
--
-- 🔴 NOTHING NEW IS MINTED. The seller was already credited price_total by the
--    client path this replaces; this moves the same credit server-side. The
--    Foundation tax is 0 today (index.html FR_TAX_RATE = 0) and so is not taken
--    here — if the tax is ever turned back on, it must be taken HERE, and that
--    is an owner decision.
-- ⚠ Only kind 'sale', currency 'cinders', seller = auth.uid(), not voided.
--   Aza / trade / barter rows, expiries, cancels and clawbacks keep the
--   existing rl_claim + client-leg path.
-- RLS: no table or policy change. resource_trade_claims keeps its policies;
-- this definer function is the only new writer. Execute: authenticated only.
-- ===========================================================================

create or replace function public.rl_claim_sale_pay(p_ledger_id bigint)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  e      public.resource_trade_ledger%rowtype;
  v_got  bigint;
  v_amt  bigint;
  v_w    jsonb;
begin
  if me is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;

  select * into e from public.resource_trade_ledger where id = p_ledger_id for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'no such trade'); end if;
  if e.seller_id is distinct from me then raise exception 'not your sale' using errcode = '42501'; end if;
  if e.kind <> 'sale' or coalesce(e.currency, 'cinders') <> 'cinders' or e.voided_at is not null then
    return jsonb_build_object('ok', false, 'why', 'not a cinder sale', 'fallback', true);
  end if;

  insert into public.resource_trade_claims (ledger_id, party, claimed_by)
  values (e.id, 'seller', me)
  on conflict (ledger_id, party) do nothing
  returning ledger_id into v_got;
  if v_got is null then
    return jsonb_build_object('ok', true, 'claimed', false, 'paid', 0);
  end if;

  v_amt := greatest(0, coalesce(e.price_total, 0))::bigint;
  v_w := _ct_cinder_give(me, v_amt, 'Resource exchange sale #' || e.id);

  return jsonb_build_object('ok', true, 'claimed', true, 'paid', v_amt,
                            'balance', (v_w->>'balance')::bigint, 'ledger_id', e.id);
end $$;

revoke all on function public.rl_claim_sale_pay(bigint) from public, anon;
grant execute on function public.rl_claim_sale_pay(bigint) to authenticated;

-- ===========================================================================
-- VERIFY (read-only)
select p.oid::regprocedure as fn, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rl_claim_sale_pay';
-- expect: definer true, anon_can false, authed_can true.
-- ===========================================================================
