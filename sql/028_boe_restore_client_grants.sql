-- ===========================================================================
-- 028 — GIVE THE BANK BACK ITS NON-MONEY COLUMNS.
--
-- Reported as: "players cannot deposit Aza or resources in the Bank of Ethos,
-- or from the city."
--
-- THE CAUSE. `authenticated` holds only SELECT on public.bank_of_ethos:
--
--   select privilege_type from information_schema.role_table_grants
--    where table_name='bank_of_ethos' and grantee='authenticated';
--     -> REFERENCES, SELECT, TRIGGER, TRUNCATE      (no INSERT, no UPDATE)
--
-- Something applied 026's revoke half to this table and never the re-grant
-- half. The RLS policies are all still there and still correct (boe_ins,
-- boe_upd, both user_id = auth.uid()) — they are simply never consulted,
-- because a table privilege check runs FIRST and fails:
--
--   ERROR: 42501: permission denied for table bank_of_ethos
--
-- This is the same trap 026 documented for user_profiles: Postgres reports DML
-- privilege failures at TABLE granularity, so the error never names a column
-- and looks nothing like a policy problem.
--
-- WHY IT STOPS DEPOSITS OF EVERY KIND, INCLUDING THE ONES THAT USE RPCs.
-- boeFetch() creates the player's bank row on first visit with a plain INSERT.
-- That INSERT is now denied, so boeFetch returns false, BankEthos.ready stays
-- false, and EVERY deposit path bails at its first line with "Bank not ready."
-- Cinder and Aza move through SECURITY DEFINER RPCs which bypass grants
-- entirely and were never broken — but the player can't reach them, because
-- they have no bank. 71 of 93 accounts have no bank row, including every one
-- of the top Aza holders. Resource deposits fail one step later, on the
-- resources UPDATE (that path refunds correctly, so nothing was lost).
--
-- THE FIX, and it is 026's pattern rather than 026's blunt instrument: grant
-- INSERT/UPDATE back column by column, holding back exactly the two the server
-- owns. `balance` and `aza` stay unwritable by any client, so this restores
-- banking WITHOUT reopening the read-modify-write hole sql/022 exists to close.
--
-- ⚠ Worth knowing: 022 tried to close that hole by dropping policies named
--   `boe_self_upd` / `boe_self_ins`. api.sql calls them `boe_upd` / `boe_ins`,
--   so those drops never matched anything and the policies survive to this day.
--   The table-level revoke is what actually locked the table — and it locked
--   far more than intended. After this file, the money columns are protected by
--   the thing that genuinely protects them: the absence of a column grant.
--
-- ⚠ Re-run this file after any `alter table public.bank_of_ethos add column`.
--   Same cost as 026: the grant is enumerated, so a new column starts with no
--   client write privilege. Idempotent and instant.
-- ===========================================================================

do $$
declare
  v_all  text;
  v_safe text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_all
    from information_schema.columns
   where table_schema = 'public' and table_name = 'bank_of_ethos';

  -- UPDATE excludes the two the server owns. Those only ever move through
  -- boe_transfer / boe_transfer_aza, and UPDATE is where the read-modify-write
  -- hole lives: an existing row's balance must never be client-writable.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_safe
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'bank_of_ethos'
     and column_name not in ('balance', 'aza');

  if v_safe is null then
    raise exception '028: bank_of_ethos has no grantable columns — refusing to lock the table out entirely';
  end if;

  execute 'revoke insert, update on public.bank_of_ethos from anon, authenticated';
  /* ⚠ INSERT IS GRANTED ON *EVERY* COLUMN, INCLUDING balance AND aza — on
     purpose, and it is safe only because of the WITH CHECK on boe_ins below,
     which pins both to zero on the way in.

     The reason is deployment order. The client in the field right now opens a
     bank with `insert({user_id, balance: 0})`. Withholding the balance column
     would reject that INSERT outright, so this file would fix nothing until the
     new client had shipped AND every service-worker-cached tab had reloaded —
     the exact trap 026 fell into (a ~7 minute silent outage while stale tabs
     kept sending a revoked column). Granting the column and constraining the
     VALUE instead means old and new clients both work, so this can be applied
     immediately, before the deploy, which is the whole point of a hotfix. */
  execute 'grant insert (' || v_all  || ') on public.bank_of_ethos to authenticated';
  execute 'grant update (' || v_safe || ') on public.bank_of_ethos to authenticated';

  -- anon gets nothing back, as in 026. RLS already blocks it (auth.uid() is
  -- null so no row matches); the grant would only ever become a problem later.
end $$;

-- The RLS policies are the row-scoping half and are already correct; assert
-- them rather than trust that they survived, since the whole reason this file
-- exists is a change that half-landed.
-- 🔴 The two zero-pins are what make the INSERT column grant above safe: a
--    player may CREATE their bank, but only an empty one. Opening an account
--    pre-loaded with a billion Cinder is the obvious attack and this is the
--    line that refuses it.
drop policy if exists boe_ins on public.bank_of_ethos;
create policy boe_ins on public.bank_of_ethos
  for insert to authenticated
  with check (user_id = auth.uid()
              and coalesce(balance, 0) = 0
              and coalesce(aza, 0)     = 0);
drop policy if exists boe_upd on public.bank_of_ethos;
create policy boe_upd on public.bank_of_ethos
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 022 created a second, identical SELECT policy under a different name. Two
-- permissive SELECT policies OR together, so it is harmless — but it is also
-- pure confusion for the next person reading pg_policies. api.sql's boe_sel is
-- the one that stays.
drop policy if exists boe_self_sel on public.bank_of_ethos;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- 1) The money columns must be ABSENT from this list; everything else present:
--
-- select privilege_type, string_agg(column_name, ', ' order by column_name)
--   from information_schema.column_privileges
--  where table_schema='public' and table_name='bank_of_ethos'
--    and grantee='authenticated' and privilege_type in ('INSERT','UPDATE')
--  group by privilege_type;
--
-- 2) There must be NO table-level INSERT/UPDATE left (that would cover every
--    column and silently re-expose balance/aza):
--
-- select privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='bank_of_ethos'
--    and grantee='authenticated';
--   -> expect REFERENCES / SELECT / TRIGGER / TRUNCATE only.
--
-- 3) End to end, as a real player (rolls back, changes nothing):
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<a user_id>","role":"authenticated"}';
--   insert into public.bank_of_ethos (user_id) values (auth.uid());     -- must succeed
--   update public.bank_of_ethos set resources = '{"metal":5}'::jsonb
--    where user_id = auth.uid();                                        -- must succeed
--   update public.bank_of_ethos set balance = 999999
--    where user_id = auth.uid();                                        -- MUST be denied
-- rollback;
-- ===========================================================================
