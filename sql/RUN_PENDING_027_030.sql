-- ###########################################################################
-- MYTHIC SPELLBOOK — PENDING MIGRATIONS 027 · 028 · 029 · 030   (for v120t8)
--
-- Paste this whole file into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc and run it. It is idempotent and re-runnable.
--
-- ORDER MATTERS AND IT IS THE ORDER BELOW:
--   028  restores the Bank of Ethos client grants   -> unbreaks deposits NOW
--   030  moves the bank's remaining moves server-side (market, loans,
--        mercenaries, requests, exchange, maintenance fee)
--   029  lets an admin set a node's tier            -> harmless on its own
--   027  moves gift claiming server-side            -> closes the money dupe
--
-- 030 MUST COME AFTER 028: it is the other half of the same fix. 028 stopped
-- the client writing bank balance/aza; 030 gives every legitimate move that
-- used to rely on that write a server-side home. Applied alone, 028 leaves the
-- marketplace, loans, mercenary contracts, the request inbox, the Aza->Cinder
-- exchange and the maintenance fee broken.
--
-- ⚠ ONE BEHAVIOUR CHANGE TO EXPECT, and it is deliberate:
--   027 removes the player's ability to flip a gift row. Any tab still running
--   a PRE-v120t8 client from the service-worker cache will therefore fail to
--   claim gifts ("This gift was already claimed") until it reloads. NOTHING IS
--   LOST — the gift stays pending in the inbox and claims fine on the new
--   client. Same fail-closed trade sql/022 made for banking; the alternative is
--   leaving a live money dupe open. To avoid the window entirely, deploy
--   v120t8 first, wait for propagation, then run this file.
--
--   028 works with the OLD client as well as the new one, so it can go out
--   ahead of the deploy. 029 and 030 only add functions/policies the new
--   client calls — nothing existing changes behaviour when they land early.
-- ###########################################################################



-- ===========================================================================
-- ===============  BEGIN 028_boe_restore_client_grants.sql
-- ===========================================================================

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

-- ===============  END 028_boe_restore_client_grants.sql


-- ===========================================================================
-- ===============  BEGIN 030_boe_settlements.sql
-- ===========================================================================

-- ===========================================================================
-- 030 — THE BANK'S REMAINING MOVES GO SERVER-SIDE.
--
-- 028 restored the client's non-money columns on bank_of_ethos and deliberately
-- withheld `balance` and `aza` from UPDATE. That left _boeAdjust() — the client
-- helper every other bank feature routes through — writing two columns it no
-- longer holds. Broken since: the marketplace, loans, mercenary contracts, the
-- Cinder-request inbox, the Aza→Cinder exchange and the maintenance fee.
--
-- ⚠ THE OBVIOUS FIX IS THE WRONG ONE. A generic `boe_adjust(dCinder, dAza)`
--   callable by the player would restore every feature in ten minutes and hand
--   back the mint this whole line of work exists to close: `boe_adjust(1e9, 0)`
--   then withdraw. The client must not be able to name a credit. Ever.
--
-- WHAT THE CALL SITES ACTUALLY DO, once you read them all: every _boeAdjust
-- CREDIT is a claim-on-read settlement backed by a row in another table that
-- records the obligation — boe_requests.status='paid', boe_market_listings
-- .status='sold_pending_seller', boe_merc_contracts.status='completed_pending_*',
-- an inserted boe_loans row. The client was doing the credit and the status
-- flip as two separate steps, with the amount read from a row it had fetched.
--
-- That is the SAME shape as the gift dupe in 027, and it takes the same cure:
-- one SECURITY DEFINER function per settlement kind that flips the source row
-- and moves the money in a single statement-chain, reading the amount from the
-- row rather than from the caller. DEBITS need none of that ceremony — taking
-- money OUT of your own bank is safe by construction — so they share one
-- function that refuses to credit.
--
-- Net effect: every broken feature works again, and the credit path is
-- narrower than it was before 028, not wider.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- Loans had no way to tell "principal paid out" from "not yet", so a disburse
-- call could be replayed. One additive column fixes it; `if not exists` keeps
-- the file re-runnable.
alter table public.boe_loans add column if not exists disbursed_at timestamptz;

-- --------------------------------------------------------------------------
-- 0. _boe_apply — THE ONE PLACE A BANK BALANCE CHANGES.
--
--    Private (no grant to anon/authenticated) and takes a uid rather than
--    reading auth.uid(), exactly like _sov_apply in 024. Every public function
--    below delegates here, so "write the row and ledger it" has exactly one
--    implementation and the overdraft guard cannot drift between callers.
--
--    Deltas are signed. Negative = debit, and the guard is in the same
--    statement as the write — there is no read-modify-write window for a stale
--    base to overwrite, which was the original 2026-08-05 farming exploit.
-- --------------------------------------------------------------------------
create or replace function public._boe_apply(
  p_uid uuid, p_dcinder numeric, p_daza numeric,
  p_kind text, p_note text, p_counterparty text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $b$
declare
  v_bal bigint;
  v_aza bigint;
begin
  if p_uid is null then return null; end if;
  insert into public.bank_of_ethos (user_id, balance) values (p_uid, 0)
    on conflict (user_id) do nothing;

  update public.bank_of_ethos
     set balance    = coalesce(balance, 0) + coalesce(p_dcinder, 0),
         aza        = coalesce(aza, 0)     + coalesce(p_daza, 0),
         updated_at = now()
   where user_id = p_uid
     -- The guard IS the WHERE clause. No row updated = insufficient funds.
     and coalesce(balance, 0) + coalesce(p_dcinder, 0) >= 0
     and coalesce(aza, 0)     + coalesce(p_daza, 0)    >= 0
   returning coalesce(balance, 0)::bigint, coalesce(aza, 0)::bigint
        into v_bal, v_aza;

  if v_bal is null then return null; end if;   -- refused; caller reports why

  begin
    insert into public.boe_ledger (user_id, kind, cinder, aza, note, counterparty)
      values (p_uid, p_kind, coalesce(p_dcinder, 0), coalesce(p_daza, 0),
              p_note, nullif(p_counterparty, ''));
  exception when undefined_table or undefined_column then null;
  end;

  return jsonb_build_object('balance', v_bal, 'aza', v_aza);
end;
$b$;
revoke all on function public._boe_apply(uuid, numeric, numeric, text, text, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 1. boe_spend — DEBITS ONLY, and that is why it can be generic.
--
--    Takes POSITIVE amounts to REMOVE. A negative is rejected rather than
--    negated: inferring direction from a sign is how you end up with a credit
--    RPC wearing a debit's name, and sql/022 already made that mistake's twin
--    (p_amount is always positive there, direction never inferred).
--
--    Covers: paying a Cinder request, buying on the marketplace (both
--    currencies), loan repayment, and the 30-day maintenance fee.
-- --------------------------------------------------------------------------
create or replace function public.boe_spend(
  p_cinder numeric default 0, p_aza numeric default 0, p_reason text default 'bank spend')
returns jsonb
language plpgsql
security definer
set search_path = public
as $s$
declare
  v_uid uuid := auth.uid();
  v_c   bigint := floor(coalesce(p_cinder, 0))::bigint;
  v_a   bigint := floor(coalesce(p_aza, 0))::bigint;
  v_r   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if v_c < 0 or v_a < 0 then
    return jsonb_build_object('ok', false, 'error', 'credit_refused');
  end if;
  if v_c = 0 and v_a = 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;

  v_r := public._boe_apply(v_uid, -v_c, -v_a, 'spend', coalesce(p_reason, 'bank spend'));
  if v_r is null then
    return jsonb_build_object('ok', false, 'error', 'insufficient_bank');
  end if;
  return jsonb_build_object('ok', true, 'balance', v_r->'balance', 'aza', v_r->'aza');
end;
$s$;
revoke all on function public.boe_spend(numeric, numeric, text) from public, anon;
grant execute on function public.boe_spend(numeric, numeric, text) to authenticated;

-- --------------------------------------------------------------------------
-- 2. boe_request_settle — someone paid a Cinder request I sent.
--    Amount comes from the row; the status flip and the credit are one chain.
-- --------------------------------------------------------------------------
create or replace function public.boe_request_settle(p_request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $r$
declare
  v_uid uuid := auth.uid();
  v_amt bigint;
  v_cp  text;
  v_r   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  update public.boe_requests
     set status = 'settled', resolved_at = now()
   where id = p_request_id
     and from_user = v_uid
     and status = 'paid'
   returning greatest(0, floor(coalesce(amount, 0)))::bigint, coalesce(to_handle, '')
        into v_amt, v_cp;

  if v_amt is null then return jsonb_build_object('ok', false, 'error', 'not_settleable'); end if;
  if v_amt = 0 then return jsonb_build_object('ok', true, 'credited', 0); end if;

  v_r := public._boe_apply(v_uid, v_amt, 0, 'request_received', 'Request paid', v_cp);
  if v_r is null then raise exception 'boe_request_settle: credit failed for %', p_request_id; end if;
  return jsonb_build_object('ok', true, 'credited', v_amt,
                            'balance', v_r->'balance', 'aza', v_r->'aza');
end;
$r$;
revoke all on function public.boe_request_settle(bigint) from public, anon;
grant execute on function public.boe_request_settle(bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 3. boe_market_settle — a listing of mine sold and the buyer has paid.
--    Price AND currency both come from the row, so the caller cannot ask to be
--    paid in the more valuable of the two.
-- --------------------------------------------------------------------------
create or replace function public.boe_market_settle(p_listing_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $m$
declare
  v_uid uuid := auth.uid();
  v_price bigint;
  v_cur   text;
  v_cp    text;
  v_r     jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  update public.boe_market_listings
     set status = 'paid', settled_at = now()
   where id = p_listing_id
     and seller_user = v_uid
     and status = 'sold_pending_seller'
   returning greatest(0, floor(coalesce(price, 0)))::bigint,
             lower(coalesce(currency, 'cinder')), coalesce(buyer_handle, '')
        into v_price, v_cur, v_cp;

  if v_price is null then return jsonb_build_object('ok', false, 'error', 'not_settleable'); end if;
  if v_price = 0 then return jsonb_build_object('ok', true, 'credited', 0); end if;

  if v_cur = 'aza' then
    v_r := public._boe_apply(v_uid, 0, v_price, 'market_sale', 'Marketplace sale', v_cp);
  else
    v_r := public._boe_apply(v_uid, v_price, 0, 'market_sale', 'Marketplace sale', v_cp);
  end if;
  if v_r is null then raise exception 'boe_market_settle: credit failed for %', p_listing_id; end if;
  return jsonb_build_object('ok', true, 'credited', v_price, 'currency', v_cur,
                            'balance', v_r->'balance', 'aza', v_r->'aza');
end;
$m$;
revoke all on function public.boe_market_settle(bigint) from public, anon;
grant execute on function public.boe_market_settle(bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 4. boe_merc_settle — both phases of a mercenary contract, one function.
--
--    Phase 1 (clock-out, status active/paused/offered): the SERVER splits
--    target_cinder using the same 40/52 split the client showed, stamps both
--    payouts and the Foundation tax onto the row, moves the contract to
--    completed_pending_<other side>, and credits the clocker their share.
--    Phase 2 (the other side claims): credits the payout ALREADY STAMPED on
--    the row in phase 1 and closes the contract.
--
--    ⚠ The split lives here now, not in the client. BOE_MERC_SHARE_MERC /
--      _EMPLOYER in index.html are display constants from this point on — if
--      you retune them, retune them HERE too or the UI will promise a number
--      the bank does not pay.
-- --------------------------------------------------------------------------
create or replace function public.boe_merc_settle(p_contract_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $c$
declare
  v_uid    uuid := auth.uid();
  v_row    public.boe_merc_contracts%rowtype;
  v_isMerc boolean;
  v_target bigint;
  v_merc   bigint;
  v_emp    bigint;
  v_share  bigint;
  v_next   text;
  v_cp     text;
  v_r      jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select * into v_row from public.boe_merc_contracts where id = p_contract_id for update;
  if v_row.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_row.employer_user <> v_uid and v_row.mercenary_user <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_a_party');
  end if;
  v_isMerc := (v_row.mercenary_user = v_uid);

  if v_row.status in ('offered', 'active', 'paused') then
    v_target := greatest(0, floor(coalesce(v_row.target_cinder, 0)))::bigint;
    v_merc   := floor(v_target * 0.40)::bigint;
    v_emp    := floor(v_target * 0.52)::bigint;
    v_share  := case when v_isMerc then v_merc else v_emp end;
    v_next   := case when v_isMerc then 'completed_pending_employer' else 'completed_pending_merc' end;

    update public.boe_merc_contracts
       set status = v_next, clocked_out_at = now(),
           merc_payout = v_merc, employer_payout = v_emp,
           fr_tax = greatest(0, v_target - v_merc - v_emp)
     where id = p_contract_id and status = v_row.status;   -- lost race = no-op

  elsif (v_row.status = 'completed_pending_merc' and v_isMerc)
     or (v_row.status = 'completed_pending_employer' and not v_isMerc) then
    v_share := greatest(0, floor(case when v_isMerc then coalesce(v_row.merc_payout, 0)
                                                    else coalesce(v_row.employer_payout, 0) end))::bigint;
    update public.boe_merc_contracts set status = 'completed'
     where id = p_contract_id and status = v_row.status;

  else
    return jsonb_build_object('ok', false, 'error', 'not_settleable');
  end if;

  if v_share is null or v_share = 0 then
    return jsonb_build_object('ok', true, 'credited', 0);
  end if;
  v_cp := case when v_isMerc then coalesce(v_row.employer_handle, '') else coalesce(v_row.mercenary_handle, '') end;
  v_r := public._boe_apply(v_uid, v_share, 0,
                           case when v_isMerc then 'merc_earn' else 'merc_yield' end,
                           'Mercenary contract settled', v_cp);
  if v_r is null then raise exception 'boe_merc_settle: credit failed for %', p_contract_id; end if;
  return jsonb_build_object('ok', true, 'credited', v_share,
                            'balance', v_r->'balance', 'aza', v_r->'aza');
end;
$c$;
revoke all on function public.boe_merc_settle(bigint) from public, anon;
grant execute on function public.boe_merc_settle(bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 5. boe_loan_disburse — pay a loan's principal into the bank, exactly once.
--    `disbursed_at is null` in the WHERE is the once-only guard, same shape as
--    the status guards above.
-- --------------------------------------------------------------------------
create or replace function public.boe_loan_disburse(p_loan_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $l$
declare
  v_uid uuid := auth.uid();
  v_amt bigint;
  v_r   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  update public.boe_loans
     set disbursed_at = now()
   where id = p_loan_id
     and user_id = v_uid
     and status = 'active'
     and disbursed_at is null
   returning greatest(0, floor(coalesce(cinder_owed, 0)))::bigint into v_amt;

  if v_amt is null then return jsonb_build_object('ok', false, 'error', 'not_disbursable'); end if;
  if v_amt = 0 then return jsonb_build_object('ok', true, 'credited', 0); end if;

  v_r := public._boe_apply(v_uid, v_amt, 0, 'loan_principal', 'Loan principal → bank');
  if v_r is null then raise exception 'boe_loan_disburse: credit failed for %', p_loan_id; end if;
  return jsonb_build_object('ok', true, 'credited', v_amt,
                            'balance', v_r->'balance', 'aza', v_r->'aza');
end;
$l$;
revoke all on function public.boe_loan_disburse(bigint) from public, anon;
grant execute on function public.boe_loan_disburse(bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 6. boe_exchange_aza — Aza → Cinder, WHOLE move server-side.
--
--    The client used to do this in three pieces: spend Aza from the wallet,
--    debit the rest from the bank, credit the Cinder. The rate lived in JS.
--    Wallet-first then bank, same order as before; the rate is here now.
--    ⚠ AZA_TO_CINDER in index.html is a display constant from this point on.
-- --------------------------------------------------------------------------
create or replace function public.boe_exchange_aza(p_aza numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $x$
declare
  v_uid    uuid := auth.uid();
  v_aza    bigint := floor(coalesce(p_aza, 0))::bigint;
  v_rate   bigint := 5000;                      -- 1 Aza -> 5,000 Cinder
  v_wallet bigint;
  v_bank   bigint;
  v_wTake  bigint;
  v_bTake  bigint;
  v_out    bigint;
  v_sov    bigint;
  v_r      jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if v_aza <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;

  insert into public.bank_of_ethos (user_id, balance) values (v_uid, 0) on conflict (user_id) do nothing;
  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;

  select coalesce(sovereigns, 0) into v_wallet from public.user_progress  where user_id = v_uid for update;
  select coalesce(aza, 0)::bigint into v_bank   from public.bank_of_ethos where user_id = v_uid for update;

  if coalesce(v_wallet, 0) + coalesce(v_bank, 0) < v_aza then
    return jsonb_build_object('ok', false, 'error', 'insufficient_aza',
                              'aza', v_wallet, 'bank_aza', v_bank);
  end if;

  v_wTake := least(v_aza, greatest(0, v_wallet));
  v_bTake := v_aza - v_wTake;
  v_out   := v_aza * v_rate;

  if v_wTake > 0 then
    v_sov := public._sov_apply(v_uid, -v_wTake, 'Aza -> Cinder exchange');
    if v_sov is null then
      return jsonb_build_object('ok', false, 'error', 'insufficient_aza');
    end if;
  else
    v_sov := v_wallet;
  end if;

  -- Both bank legs in ONE statement — an exchange must never half-apply.
  v_r := public._boe_apply(v_uid, v_out, -v_bTake, 'exchange', 'Exchanged Aza -> Cinder');
  if v_r is null then
    -- Put the wallet Aza back; nothing else has moved.
    if v_wTake > 0 then perform public._sov_apply(v_uid, v_wTake, 'Exchange rollback'); end if;
    return jsonb_build_object('ok', false, 'error', 'insufficient_bank');
  end if;

  return jsonb_build_object('ok', true, 'moved', v_aza, 'cinder_out', v_out,
                            'aza', v_sov, 'balance', v_r->'balance', 'bank_aza', v_r->'aza');
end;
$x$;
revoke all on function public.boe_exchange_aza(numeric) from public, anon;
grant execute on function public.boe_exchange_aza(numeric) to authenticated;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- 1) All seven exist, every one SECURITY DEFINER:
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname='public'
--    and p.proname in ('_boe_apply','boe_spend','boe_request_settle',
--                      'boe_market_settle','boe_merc_settle','boe_loan_disburse',
--                      'boe_exchange_aza')
--  order by 1;
--
-- 2) _boe_apply must NOT be callable by a player — it is the raw mover:
--
-- select has_function_privilege('authenticated',
--   'public._boe_apply(uuid,numeric,numeric,text,text,text)', 'execute');
--   -> expect false
--
-- 3) boe_spend must refuse to credit (this is the whole reason it is not
--    called boe_adjust):
--
-- select public.boe_spend(-1000000, 0, 'nice try');
--   -> {"ok": false, "error": "credit_refused"}
--
-- 4) And the client still cannot write the columns directly (028 holds):
--
-- select privilege_type, string_agg(column_name, ', ' order by column_name)
--   from information_schema.column_privileges
--  where table_schema='public' and table_name='bank_of_ethos'
--    and grantee='authenticated' and privilege_type='UPDATE'
--  group by privilege_type;
--   -> balance and aza must be ABSENT from the list.
-- ===========================================================================

-- ===============  END 030_boe_settlements.sql


-- ===========================================================================
-- ===============  BEGIN 029_node_tier_admin.sql
-- ===========================================================================

-- ===========================================================================
-- 029 — LET AN ADMIN SET A NODE'S TIER.
--
-- v120t8 adds PRN node tiers (Free 0.5% … Eternal Founder 20%). The tier is
-- stamped on economy_nodes.meta.tier — JSONB, so there is no schema change and
-- no new column to grant; every other per-node fact already lives there.
--
-- The one thing that does need changing is the UPDATE policy. It reads:
--
--     en_upd  UPDATE  using (owner_id = auth.uid()) with check (owner_id = auth.uid())
--
-- which is correct for a player maintaining their own node and wrong for the
-- feature being asked for: assigning a tier is an ADMIN act, performed on
-- somebody else's node from the Node City tier modal. Without this file the
-- admin's UPDATE matches zero rows and returns NO ERROR — the silent-no-op that
-- has now bitten this codebase twice (bank_of_ethos in 028, gifts in 027). The
-- client checks the returned row and says so, but the real fix is here.
--
-- ⚠ SCOPE: this widens economy_nodes UPDATE to admins for the WHOLE row, not
--   just meta.tier — Postgres RLS gates rows, not JSONB keys. That is the same
--   trust already granted to admins over gifts, detention and court records in
--   api.sql, and is_admin() is the verified top-level JWT email claim (never
--   user_metadata). If per-key control is ever wanted it needs a SECURITY
--   DEFINER setter, not a policy.
--
-- Idempotent and re-runnable. Verify query at the bottom.
-- ===========================================================================

drop policy if exists en_upd on public.economy_nodes;
create policy en_upd on public.economy_nodes
  for update to authenticated
  using      (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- 1) The policy must name both the owner AND is_admin() on each side:
--
-- select policyname, cmd, qual, with_check
--   from pg_policies
--  where schemaname='public' and tablename='economy_nodes' and cmd='UPDATE';
--
-- 2) A non-admin must still be unable to touch a node they do not own
--    (rolls back, changes nothing):
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims =
--     '{"sub":"<some NON-owner, NON-admin user_id>","role":"authenticated","email":"nobody@example.com"}';
--   update public.economy_nodes
--      set meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{tier}', '"eternal"')
--    where id = '<a node they do not own>'
--    returning id;
--   -> expect ZERO rows
-- rollback;
--
-- 3) And an admin must be able to:
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims =
--     '{"sub":"<any user_id>","role":"authenticated","email":"play@mythicsoa.com"}';
--   update public.economy_nodes
--      set meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{tier}', '"titan"')
--    where id = '<any node>'
--    returning id, meta->>'tier';
--   -> expect ONE row, tier = titan
-- rollback;
-- ===========================================================================

-- ===============  END 029_node_tier_admin.sql


-- ===========================================================================
-- ===============  BEGIN 027_gift_claim_server_side.sql
-- ===========================================================================

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

-- ===============  END 027_gift_claim_server_side.sql

