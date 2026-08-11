-- ===========================================================================
-- 023b . RESTORE wallet_ledger — the missing table that silently disabled the
--        entire "bulletproof saves" wallet
-- ===========================================================================
-- WHAT WAS WRONG
--
--   public.wallet_ledger does not exist. It did once — 16 user_progress rows
--   carry a non-zero ft_tax_total, and in wallet_charge the tax update runs
--   AFTER the ledger insert, so those charges must have ledgered successfully
--   at the time. Something dropped it since (economy_reset / season_purge are
--   the obvious suspects; neither recreates it).
--
--   Both wallet_charge and wallet_credit inserted into it UNGUARDED. With the
--   table gone, every call raised 42P01 undefined_table and the whole function
--   aborted. So:
--
--     * chargeCinderAtomic() — the "bulletproof" spend — has been failing on
--       every call. And it does NOT fall back: the client's
--       _walletRpcUnavailable() regex looks for "function ... does not exist",
--       while Postgres said "relation ... does not exist", so the error was
--       surfaced as a plain refusal instead of triggering the offline path.
--     * _serverMirrorCredit() / walletReconcile() — every reward's route to
--       the canonical wallet — failed the same way and just re-armed the
--       reconcile flag forever.
--
--   That is the real reason 67 of 87 user_progress rows still read cinder = 0
--   while their owners plainly have Cinder. It was never drift; the only
--   function that could have lifted them has been dead.
--
-- ⚠ WHY THIS IS URGENT NOW, AND NOT BEFORE
--   023 wrapped wallet_charge's ledger inserts in exception handlers, so
--   wallet_charge started working — reading a canonical row that is 0 for most
--   accounts and correctly answering "insufficient". Before 023 it errored;
--   after 023 it refuses. Either way the purchase fails, but the refusal path
--   is the one players notice. wallet_credit is still unguarded and still
--   dead, so the reconcile cannot lift anyone out of it.
--
--   Recreating the table fixes both, and the existing sign-in reconcile then
--   heals each account's canonical row from their own balance on next boot.
--
-- WHAT THIS FILE DOES NOT DO
--   It does not seed anybody's canonical Cinder. walletReconcile() already
--   does that from the player's own figure, diff-based, at sign-in — the
--   audited path. Mass-writing balances here would bless every duped mirror
--   value in one statement with no record of the decision.
--
-- Apply AFTER 023, BEFORE 024. Idempotent.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The table, exactly as bulletproof_saves.sql declares it.
-- --------------------------------------------------------------------------
create table if not exists public.wallet_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  op            text not null,       -- 'charge' | 'credit' | 'inv_grant' | 'inv_consume' | 'tax'
  resource      text not null,       -- 'cinder' | 'sovereigns' | item_id
  delta         bigint not null,     -- positive for credit/grant, negative for charge/consume
  balance_after bigint,              -- canonical balance after the op; null for inventory
  reason        text,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists wallet_ledger_user_time on public.wallet_ledger (user_id, created_at desc);

alter table public.wallet_ledger enable row level security;
drop policy if exists wl_sel on public.wallet_ledger;
create policy wl_sel on public.wallet_ledger for select to authenticated using (user_id = auth.uid());
-- Inserts come ONLY from SECURITY DEFINER RPCs. `with check (false)` is
-- deliberate: it makes a direct client insert impossible while leaving the
-- definer functions (which bypass RLS) free to write.
drop policy if exists wl_ins on public.wallet_ledger;
create policy wl_ins on public.wallet_ledger for insert to authenticated with check (false);

-- --------------------------------------------------------------------------
-- 2. wallet_credit — guarded, and it now keeps the mirror in step.
--
--    GUARDED: the unguarded insert is what killed it. A missing audit table
--    must never be able to swallow a player's reward again; the same treatment
--    023 gave wallet_charge.
--
--    MIRROR SYNC: user_profiles.gems is what cloudFetchProfile reads on boot
--    and what the admin player list displays. Once the client stops uploading
--    that column (needed before the 026 revoke) nothing else would ever raise
--    it, and every player's displayed Cinder would freeze at its last uploaded
--    value. Only ever raises — a credit must not be able to lower a balance.
--
--    Signature and return type are unchanged, so no client edit is required.
-- --------------------------------------------------------------------------
create or replace function public.wallet_credit(p_amount bigint, p_reason text default 'reward')
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;
  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.user_progress
     set cinder = coalesce(cinder, 0) + p_amount, updated_at = now()
   where user_id = v_uid
   returning cinder into v_bal;

  -- Raise the display mirror to match. Never lowers.
  update public.user_profiles
     set gems = v_bal
   where user_id = v_uid and coalesce(gems, 0) < v_bal;

  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (v_uid, 'credit', 'cinder', p_amount, coalesce(v_bal, 0::bigint), p_reason);
  exception when undefined_table or undefined_column then null;
  end;

  return coalesce(v_bal, 0::bigint);
end$$;

-- anon can call this today. auth.uid() is null for anon so it returns 0 and
-- moves nothing, but there is no reason for the grant to exist.
revoke all on function public.wallet_credit(bigint, text) from public, anon;
grant execute on function public.wallet_credit(bigint, text) to authenticated;

-- ⚠ NOT ADDRESSED HERE, DELIBERATELY: wallet_credit remains callable by any
--   signed-in player with any amount, which means Cinder is mintable in one
--   RPC call. That grant exists because Cinder rewards are computed on the
--   client and no server currently knows what a match win is worth. Closing it
--   means server-authoritative rewards — a much larger piece of work than this
--   file, and it should be a deliberate decision, not a side effect of a
--   repair. See sql/024 §3 for the same argument applied to Aza, which CAN be
--   closed because it is never earned by playing.

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- select to_regclass('public.wallet_ledger') as table_exists;   -- not null

-- Canonical rows still behind their mirror. These heal themselves at each
-- owner's next sign-in now that wallet_credit works again — this is a
-- watch-list, not a to-do list.
-- select count(*) as accounts_awaiting_reconcile
--   from public.user_profiles p
--   join public.user_progress g on g.user_id = p.user_id
--  where coalesce(g.cinder, 0) < coalesce(p.gems, 0);

-- After a few players have signed in, the ledger should start filling:
-- select op, resource, count(*), sum(delta)
--   from public.wallet_ledger group by 1, 2 order by 1, 2;
