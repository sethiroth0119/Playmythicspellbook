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
