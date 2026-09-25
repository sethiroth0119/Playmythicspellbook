-- ════════════════════════════════════════════════════════════════════════════
-- RUN FILE 2026-09-18 — owner-approved AZA repairs
-- Project: ktsiasyjusesawtrwrjc · paste into the Supabase SQL editor.
-- Safe to run NOW (AZA is server-owned: user_progress.sovereigns +
-- wallet_ledger, written through _sov_apply, which the client cannot undo).
-- Idempotent: every line carries a reason marker and is skipped if already done.
-- Order inside: credits first, then charges, so no charge can fail for a
-- balance that one of these credits was about to top up.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Luni AZA sales where the SELLER was shown the payment but never received
--    it (the trade legs ran on the device only). Sellers are paid.
-- 2. The same trades: the BUYER kept the goods but was never charged. Buyers
--    are charged what they owed.
-- 3. WELCOME2026: 8 accounts redeemed the coupon and were shown AZA that
--    never reached the server. ⚠ APPLIED 2026-09-18 05:15 with 500 each, which
--    was wrong: the coupon is 15. Corrected the same day by two rows per player
--    ('Correction: WELCOME2026 is 50 AZA, not 500' -450, then 'Correction:
--    WELCOME2026 is 15 AZA' -35), so each nets +15. Re-running this file credits nothing again (the marker is
--    already there). Aurelia (the 9th redeemer) already held hers.
-- 4. If sql/159 is already applied, the coupon redemption is also recorded in
--    aza_grant_claims for all 9 redeemers, so none of them can claim
--    WELCOME2026 a second time if it is ever switched on. If 159 is applied
--    LATER, re-run this file once afterwards — part 4 then records them.
do $$
declare
  r record;
  v_bal bigint;
begin
  -- ── credits ────────────────────────────────────────────────────────────────
  for r in
    select * from (values
      ('b35a8809-d5cf-4356-8af1-44646550e11b'::uuid, 'GreyDragon',        112::bigint, 'Repair: Luni AZA sale never paid to seller (2026-09-18)'),
      ('41c880ac-828b-4ed9-9dbb-cac15984e355'::uuid, 'Mavric',             20::bigint, 'Repair: Luni AZA sale never paid to seller (2026-09-18)'),
      ('29e5da8b-ac64-412a-9bd4-c348e61c55c9'::uuid, 'AetosDios',         500::bigint, 'Repair: WELCOME2026 coupon AZA never credited (2026-09-18)'),
      ('b46f7086-94ac-4ecc-b4b0-24d32ec0c7a0'::uuid, 'Aston Drakonis',    500::bigint, 'Repair: WELCOME2026 coupon AZA never credited (2026-09-18)'),
      ('d41b1b6f-ca04-4beb-b224-36f15c5feb64'::uuid, 'Davos',             500::bigint, 'Repair: WELCOME2026 coupon AZA never credited (2026-09-18)'),
      ('2feefce7-d155-47b8-8a10-3cbfb3a0b812'::uuid, 'Seth the test',     500::bigint, 'Repair: WELCOME2026 coupon AZA never credited (2026-09-18)'),
      ('f9eff35e-29d1-47d0-9c99-346c2478cd6a'::uuid, 'Sethiroth Tha Dev', 500::bigint, 'Repair: WELCOME2026 coupon AZA never credited (2026-09-18)'),
      ('1cf61751-32b2-4930-8292-a05f23c1feb6'::uuid, 'Sludgequeen',       500::bigint, 'Repair: WELCOME2026 coupon AZA never credited (2026-09-18)'),
      ('31ce4c00-fc3b-42ed-abac-403b34edc5bd'::uuid, 'SupahJay',          500::bigint, 'Repair: WELCOME2026 coupon AZA never credited (2026-09-18)'),
      ('281f9cba-b318-43e3-9466-d746281824a3'::uuid, 'Tha Prince',        500::bigint, 'Repair: WELCOME2026 coupon AZA never credited (2026-09-18)')
    ) as t(uid, name, amount, reason)
  loop
    if exists (select 1 from public.wallet_ledger w
                where w.user_id = r.uid and w.resource = 'sovereigns' and w.reason = r.reason) then
      raise notice '% — already credited (% AZA), skipped', r.name, r.amount;
    else
      v_bal := public._sov_apply(r.uid, r.amount, r.reason);
      raise notice '% — credited % AZA, balance now %', r.name, r.amount, v_bal;
    end if;
  end loop;

  -- ── charges ────────────────────────────────────────────────────────────────
  -- _sov_apply refuses a charge that would go below zero and returns null.
  -- In that case the full amount is NOT taken and the notice says so.
  for r in
    select * from (values
      ('f9eff35e-29d1-47d0-9c99-346c2478cd6a'::uuid, 'Sethiroth Tha Dev', 108::bigint),
      ('b46f7086-94ac-4ecc-b4b0-24d32ec0c7a0'::uuid, 'Aston Drakonis',     16::bigint),
      ('41c880ac-828b-4ed9-9dbb-cac15984e355'::uuid, 'Mavric',              8::bigint)
    ) as t(uid, name, amount)
  loop
    if exists (select 1 from public.wallet_ledger w
                where w.user_id = r.uid and w.resource = 'sovereigns'
                  and w.reason = 'Repair: Luni AZA purchase never charged to buyer (2026-09-18)') then
      raise notice '% — already charged, skipped', r.name;
    else
      v_bal := public._sov_apply(r.uid, -r.amount, 'Repair: Luni AZA purchase never charged to buyer (2026-09-18)');
      if v_bal is null then
        raise notice '% — NOT charged: balance below % AZA', r.name, r.amount;
      else
        raise notice '% — charged % AZA, balance now %', r.name, r.amount, v_bal;
      end if;
    end if;
  end loop;

  -- ── coupon redemption record (only if sql/159 is applied) ──────────────────
  if to_regclass('public.aza_grant_claims') is not null then
    execute $q$
      insert into public.aza_grant_claims (user_id, kind, claim_key, aza, meta)
      select u, 'coupon', 'WELCOME2026', 15, jsonb_build_object('source', 'repair 2026-09-18')
        from unnest(array[
          '29e5da8b-ac64-412a-9bd4-c348e61c55c9', 'b46f7086-94ac-4ecc-b4b0-24d32ec0c7a0',
          '40c677ff-9eb3-4fa5-87ea-413cc3162ae2', 'd41b1b6f-ca04-4beb-b224-36f15c5feb64',
          '2feefce7-d155-47b8-8a10-3cbfb3a0b812', 'f9eff35e-29d1-47d0-9c99-346c2478cd6a',
          '1cf61751-32b2-4930-8292-a05f23c1feb6', '31ce4c00-fc3b-42ed-abac-403b34edc5bd',
          '281f9cba-b318-43e3-9466-d746281824a3']::uuid[]) as u
      on conflict (user_id, kind, claim_key) do nothing
    $q$;
    raise notice 'WELCOME2026 redemptions recorded for the 9 redeemers (sql/159 present)';
  else
    raise notice 'sql/159 not applied yet: re-run this file once after applying it, to record the WELCOME2026 redemptions';
  end if;
end $$;

-- Check: expect 13 rows — 10 credits (GreyDragon +112, Mavric +20, eight +500)
-- and 3 charges (Sethiroth Tha Dev −108, Aston Drakonis −16, Mavric −8).
select p.display_name, w.delta, w.balance_after, w.reason, w.created_at
  from public.wallet_ledger w join public.user_profiles p using (user_id)
 where w.resource = 'sovereigns' and w.reason like 'Repair: %(2026-09-18)'
 order by w.reason, p.display_name;
