-- ===========================================================================
-- 152_C — CLOSING A CORPORATION: THE FOUNDER TAKES THE TREASURY HOME.
-- DRAFT — NOT APPLIED. Paste into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
--
-- Reported (bug-mu17gpcz): "A request for a button to withdraw any Cinder from
-- the Corporate Treasury to their Wallet when closing down a Corporation."
--
-- corp_dissolve (sql/130) refuses while the treasury holds anything ("pay it
-- out first"), and the only way out was corp_pay_member_from_treasury (sql/107)
-- — which pays a MEMBER, one typed amount at a time, and cannot pay the last
-- fraction of a numeric balance, so a treasury holding 12.4 could never reach
-- the zero corp_dissolve demands.
--
-- WHAT THIS DOES, IN ONE TRANSACTION:
--   · checks auth.uid() is corporations.founder_id — the founder ONLY, not a
--     CEO: this empties the whole treasury on the way out, which is the
--     founder's decision alone (corp_dissolve has the same rule);
--   · locks the corporation row FOR UPDATE, so a deposit, a wage run or a
--     second tab cannot interleave between the read and the debit (the same
--     lock sql/107 takes);
--   · balance = sum(corp_treasury.amount) — the ledger IS the balance;
--   · appends ONE negative row for the WHOLE balance (kind 'close_withdraw');
--   · credits the founder floor(balance) through _ct_cinder_give, the one
--     wallet primitive every other server credit uses.
--
-- 🔴 NOTHING IS MINTED. The wallet receives floor(balance) and the ledger is
--    debited the full numeric balance; the difference is the fractional dust
--    op_revenue leaves behind (< 1 Cinder), which is burned, never rounded UP.
--    Debiting only the floored figure would leave e.g. 0.4 behind and
--    corp_dissolve would refuse forever over less than one Cinder.
-- 🔴 APPEND-ONLY. One INSERT, no UPDATE, no DELETE. A balance of zero or less
--    writes nothing and returns withdrawn 0 — a negative treasury is not the
--    founder's to "withdraw", and a zero row would be noise in the audit.
--
-- WORKS WITH OR WITHOUT sql/146. 146 adds ct_client_write_guard, which polices
-- only the client roles ('authenticated', 'anon'); this function is SECURITY
-- DEFINER owned by postgres, so its insert is a server write under 146 and an
-- ordinary insert without it. It writes no ref_id (146 adds that column; this
-- file neither needs nor creates it).
--
-- THE CLIENT (index.html, corpDissolve handler): shows the amount in a
-- gcConfirm, calls this, adopts the returned wallet balance, then calls
-- corp_dissolve. A database without this function (PGRST202 / 42883) gets the
-- old instruction instead: pay the treasury out first.
--
-- RLS: no table, no policy change. corp_treasury keeps its policies (ct_sel for
-- members, ct_ins for the three client debit kinds); this function is the only
-- new writer and it is definer + founder-checked. Execute is granted to
-- authenticated only.
-- ===========================================================================

create or replace function public.corp_close_withdraw(p_corp_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_bal   numeric;
  v_give  bigint;
  v_w     jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_corp_id is null then raise exception 'no corporation given' using errcode = '22023'; end if;

  -- Founder only, and the lock in the same statement: nothing moves between
  -- "you are the founder" and the debit.
  select name into v_name from corporations
   where id = p_corp_id and founder_id = v_uid
   for update;
  if v_name is null then
    raise exception 'only the founder can withdraw the treasury of a corporation they are closing'
      using errcode = '42501';
  end if;

  select coalesce(sum(amount), 0) into v_bal from corp_treasury where corp_id = p_corp_id;
  if v_bal <= 0 then
    return jsonb_build_object('ok', true, 'withdrawn', 0, 'treasury_before', floor(v_bal),
                              'treasury_balance', floor(v_bal), 'name', v_name);
  end if;

  v_give := floor(v_bal)::bigint;

  insert into corp_treasury (corp_id, user_id, amount, kind, note)
  values (p_corp_id, v_uid, -v_bal, 'close_withdraw',
          'Closing withdrawal — ' || v_give || ' Cinder to the founder''s wallet');

  v_w := _ct_cinder_give(v_uid, v_give, 'Treasury withdrawn on closing ' || v_name);

  -- History, where the vault log exists and accepts the action (the same guard
  -- _ct_log uses: an older CHECK must not roll back a real withdrawal).
  begin
    insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id,
                                name, icon, qty, counterparty_id, counterparty_name)
    values (p_corp_id, v_uid, 'Founder', 'send', 'resource', 'cinder',
            'Cinder', '🔥', v_give, v_uid, 'founder (closing)');
  exception when undefined_table or undefined_column or check_violation or not_null_violation then null;
  end;

  return jsonb_build_object(
    'ok',               true,
    'name',             v_name,
    'withdrawn',        v_give,
    'treasury_before',  v_bal,
    'treasury_balance', 0,
    'balance',          (v_w->>'balance')::bigint
  );
end $$;

revoke all on function public.corp_close_withdraw(uuid) from public, anon;
grant execute on function public.corp_close_withdraw(uuid) to authenticated;

-- ===========================================================================
-- VERIFY (read-only)
select p.oid::regprocedure as fn, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'corp_close_withdraw';
-- expect: definer true, anon_can false, authed_can true.
--
-- ROLLED-BACK LIVE PROBE (nothing persists — the RAISE undoes everything):
--   do $$
--   declare corp uuid; founder uuid; r jsonb; bal numeric; w0 bigint;
--   begin
--     select c.id, c.founder_id into corp, founder from corporations c
--      where exists (select 1 from corp_treasury t where t.corp_id = c.id)
--      order by (select sum(amount) from corp_treasury t where t.corp_id = c.id) desc limit 1;
--     select coalesce(sum(amount),0) into bal from corp_treasury where corp_id = corp;
--     select cinder into w0 from user_progress where user_id = founder;
--     perform set_config('request.jwt.claims', json_build_object('sub', founder, 'role','authenticated')::text, true);
--     r := public.corp_close_withdraw(corp);
--     raise exception 'PROBE (rolled back): treasury % -> %, wallet % -> %, dissolve now: %',
--       bal, (select sum(amount) from corp_treasury where corp_id = corp), w0, r->>'balance',
--       public.corp_dissolve(corp);
--   end $$;
-- ===========================================================================
