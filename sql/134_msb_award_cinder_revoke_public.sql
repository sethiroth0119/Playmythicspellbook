-- 134_msb_award_cinder_revoke_public.sql — hardening, not a bug fix.
--
-- ⚠ ALREADY APPLIED to ktsiasyjusesawtrwrjc on 2026-09-24. Idempotent.
--
-- FOUND BY: a sweep of the Supabase security advisors, which flagged 198
-- SECURITY DEFINER functions as anon-executable. Almost all of those are BY
-- DESIGN — this app's whole architecture is RLS-locked tables plus definer
-- RPCs, which necessarily produces that warning en masse. The audit that
-- mattered was the other one: every currency and resource primitive
-- (_ct_cinder_give, _sov_apply, _wh_credit_resources, _wh_debit_resources,
-- _faucet_settle, sov_credit, _fr_contribute_core) is correctly revoked from
-- both anon and authenticated. Nobody can mint Cinder by calling the helpers
-- directly. That discipline is already right and should stay right.
--
-- msb_award_cinder was the single outlier: reachable by anon. It was never
-- exploitable — the function gates on auth.jwt() ->> 'email' against the admin
-- allowlist, and an anon caller has a null JWT, so it raises 'Not authorized to
-- award bounties'. But anon can never legitimately succeed at it, so the grant
-- was surface area for nothing: it let an unauthenticated caller reach a
-- SECURITY DEFINER body that touches the Cinder ledger, and it padded the
-- advisor list where a real finding could hide.
--
-- 🔴 THE TRAP, WRITTEN DOWN BECAUSE IT COST A ROUND HERE.
--    The first attempt was `revoke execute ... from anon`. It returned SUCCESS
--    and changed NOTHING. anon never held a direct grant — it inherits from
--    PUBLIC, which shows in proacl as a leading `=` with no role name:
--        =X/postgres | postgres=X/postgres | authenticated=X/postgres | ...
--    has_function_privilege('anon', ...) keeps returning true until PUBLIC
--    itself is revoked. A "success" return means the statement ran, NOT that
--    the grant is gone. Verify proacl, never the return code.
--
-- Safe: the explicit `authenticated=X` grant is untouched, so the admin path
-- still works, and the in-function email check remains the real boundary.
revoke execute on function public.msb_award_cinder(uuid, integer, text) from public;

-- verify — expect anon=false, authenticated=true, and no leading `=` in the acl
select 'msb_award_cinder' as check,
       has_function_privilege('anon', 'public.msb_award_cinder(uuid,integer,text)', 'EXECUTE')          as anon_can_call,
       has_function_privilege('authenticated', 'public.msb_award_cinder(uuid,integer,text)', 'EXECUTE') as authed_can_call,
       array_to_string(proacl, ' | ') as acl
  from pg_proc where oid = 'public.msb_award_cinder(uuid,integer,text)'::regprocedure;
