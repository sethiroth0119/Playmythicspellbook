-- ============================================================
-- PENDING for v121v47 — paste the whole file into the SQL editor.
-- 1) sql/116: the player-side wallet audit reader (get_my_ledger with ref)
-- ============================================================
-- 116 · The player-side wallet audit, made readable (v121v47).
--
-- Reported (PDF, "Employee Wages Not Reaching Employee Accounts"): a paid
-- player could not see WHY their balance moved — "no employee-side
-- transaction entry such as: Received wages from … +3,591".
--
-- Verified on the live database first: every corp pay / corp wage DOES land
-- (user_progress.cinder and user_profiles.gems both move, and wallet_ledger
-- carries a 'credit' row that names the payer). The missing piece was the
-- READER: the phone Ledger's "Server audit" tab and the Transaction History
-- modal both call get_my_ledger(), which bulletproof_saves.sql defines and
-- which was never applied here — so both screens have always said "not
-- installed". This file installs it, with the `ref` column added so the
-- client can tell a server-originated credit (corp pay, market sale, bank
-- withdraw on another device, held Cinder released — ref is null) from a
-- credit this device mirrored itself (ref set) and only announce the former.
--
-- Also: nothing wrong is being fixed in _ct_cinder_give — credits do not
-- bump wallet_seq on purpose (sql/023: only DEBITS move it; the client
-- adopts the higher server figure at seq level).

drop function if exists public.get_my_ledger(int);
create or replace function public.get_my_ledger(p_limit int default 100)
returns table(
  id            uuid,
  op            text,
  resource      text,
  delta         bigint,
  balance_after bigint,
  reason        text,
  meta          jsonb,
  ref           text,
  created_at    timestamptz
)
language sql security definer set search_path = public stable as $$
  select l.id, l.op, l.resource, l.delta, l.balance_after, l.reason, l.meta, l.ref, l.created_at
    from public.wallet_ledger l
   where l.user_id = auth.uid()
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
revoke all on function public.get_my_ledger(int) from public;
grant execute on function public.get_my_ledger(int) to authenticated;

-- verify
-- select proname from pg_proc where proname = 'get_my_ledger';
