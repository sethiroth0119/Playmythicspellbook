-- ===========================================================================
-- 023 . BANK OF ETHOS — THE CANONICAL WALLET (why 022 still duped)
-- ===========================================================================
-- WHAT 022 GOT RIGHT, AND THE ONE THING IT MISSED
--
--   022 made the deposit atomic: wallet debit + bank credit in one statement,
--   server-read gems, no client-held arithmetic. All of that is correct and
--   stays. It was verified working — a deposit really did take the wallet from
--   19,422 to 9,422 in a single transaction.
--
--   And the wallet still came back on refresh.
--
--   THE REASON: this game keeps Cinder in TWO server tables.
--     * user_profiles.gems   - the profile mirror. 022 debits THIS one.
--     * user_progress.cinder - the CANONICAL wallet. Moved only by
--                              wallet_charge / wallet_credit. 022 never
--                              touched it, so it kept the PRE-deposit number.
--
--   The client is built to heal a gap between those two, and it heals it
--   UPWARD, by design. walletFetchProgress() runs on every sign-in and does
--   `Profile.gems = MAX(user_progress.cinder, local)`; walletReconcile() then
--   credits the canonical row up to whatever local holds. That ratchet is
--   deliberate — it is what stops a match win from evaporating when the mirror
--   RPC fails — and its safety argument is written in the code:
--
--       "Going DOWN is impossible here because every spend goes through
--        wallet_charge first."
--
--   boe_transfer() is a spend that does NOT go through wallet_charge. That one
--   sentence stopped being true the moment 022 shipped, and the ratchet did
--   exactly what it was built to do: it read a canonical row still holding
--   19,422, decided the player had been shortchanged, and put the money back.
--   Bank keeps the +10,000. 10,000 minted. Every refresh, forever.
--
--   sql/021 already knew this invariant and wrote it down (line ~870):
--       "both have to be written on the way down or the reconcile just puts
--        the duped number back and it looks like the penalty failed."
--   The admin penalty path obeys it. boe_transfer did not.
--
-- WHAT THIS FILE DOES
--   1. boe_transfer writes BOTH wallet rows to the SAME post-move value, in
--      the same transaction as the bank credit. No divergence for the ratchet
--      to feed on.
--   2. Adds wallet_seq — a server-owned counter bumped on every server-side
--      DEBIT of a wallet. It is the signal the client was missing: "the server
--      took money out after your snapshot was taken." The client reads it and
--      switches from MAX(server, local) to adopt-server-verbatim, which is the
--      only safe rule once a debit is in play. Credits do NOT bump it, so the
--      ratchet still protects unmirrored earnings — the case it exists for.
--   3. Revokes the client's direct UPDATE/INSERT on user_progress. The wallet
--      is now unreachable except through SECURITY DEFINER RPCs.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   ** It never edits anybody's balance. ** There is no repair UPDATE here.
--   Existing drift between the two tables is left exactly as it is, for a
--   human to look at with the audit queries at the bottom. 021's rule stands:
--   a false positive that empties an honest player's account is worse than a
--   duper going uncaught for an hour.
--
-- ORDER: apply AFTER 022. Idempotent; safe to re-run.
-- APPLY BY HAND in the Supabase SQL editor (no CLI login in this repo), then
-- run the VERIFY block at the bottom.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 0. Shape guards. Never assume a column exists — earlier files created these
--    tables with partial column sets on some databases.
-- --------------------------------------------------------------------------
create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cinder  bigint not null default 0 check (cinder >= 0)
);
-- Columns the functions below touch. Spelled out because this file must apply
-- cleanly on a database where bulletproof_saves.sql was never run — otherwise
-- the first UPDATE fails on a column that only exists in the other file.
alter table public.user_progress add column if not exists ft_tax_total bigint      not null default 0;
alter table public.user_progress add column if not exists updated_at   timestamptz not null default now();
alter table public.bank_of_ethos add column if not exists aza          numeric     not null default 0;

-- 🔢 THE DEBIT COUNTER. Mirrored into both tables because the client reads
--    them at different moments in boot: cloudFetchProfile() reads
--    user_profiles, walletFetchProgress() reads user_progress. Each row
--    carries the counter for its own wallet so neither read has to wait on
--    the other. Monotonic, server-only, never decremented.
alter table public.user_progress add column if not exists wallet_seq bigint not null default 0;
alter table public.user_profiles add column if not exists wallet_seq bigint not null default 0;

-- ⚠ AZA IS NOT GIVEN A CANONICAL ROW HERE, ON PURPOSE.
--   user_progress.sovereigns exists in the schema and is 0 for every account —
--   nothing has ever written it. Promoting it to canonical looks like exact
--   parity with Cinder, and it would break Aza banking outright: Aza is only
--   ever credited client-side (addSovereigns -> profile upload; even the
--   Stripe path writes user_profiles.sovereigns), so the canonical row would
--   never be topped up and every deposit after this migration would be refused
--   as insufficient. A half-maintained canonical row is what produced the
--   Cinder drift this file is cleaning up; one is enough.
--   Aza therefore keeps its single store, user_profiles.sovereigns, which
--   boe_transfer_aza already moves atomically. See §1b for what it does get.

-- --------------------------------------------------------------------------
-- 1. THE TRANSFER, corrected. Same contract as 022 (p_amount always positive,
--    direction never inferred from a sign, SECURITY DEFINER on auth.uid() so a
--    caller can only move their OWN money) — the change is WHICH rows move.
--
--    ⚠ THE STARTING WALLET IS user_progress.cinder ALONE — the mirror is read
--      for nothing but the lockstep write. greatest(cinder, gems) is tempting
--      (it is the number on screen, so it never refuses a visibly affordable
--      deposit) and it is wrong, because user_profiles.gems is CLIENT-WRITABLE
--      through the ordinary profile upload. Two tabs is all it takes: deposit
--      in a non-writer tab, whose saveProfile() early-returns, and the writer
--      tab — still holding the pre-deposit number in memory — uploads it back
--      over the mirror. greatest() would then read the restored figure and
--      fund the next deposit from money the bank already has. Reading only the
--      row no client can write removes the whole vector.
--
--      The cost is a deposit refused when the canonical row lags the display.
--      That is bounded and self-healing: _serverMirrorCredit() pushes every
--      reward to the canonical row as it is earned, and walletReconcile()
--      lifts it to the player's own figure at each sign-in. And a refusal is
--      recoverable — a mint is not. Fails closed, as 022 set out to.
--
--    ⚠ LOCK ORDER: user_profiles -> user_progress -> bank_of_ethos, the same
--      order in both directions. wallet_charge only ever locks user_progress,
--      so no cycle exists between them.
-- --------------------------------------------------------------------------
create or replace function public.boe_transfer(p_amount numeric, p_dir text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $t$
declare
  v_uid    uuid    := auth.uid();
  v_amt    bigint  := floor(coalesce(p_amount, 0))::bigint;
  v_gems   bigint;   -- user_profiles.gems
  v_cinder bigint;   -- user_progress.cinder
  v_wallet bigint;   -- the spendable wallet = the CANONICAL row, nothing else
  v_new    bigint;   -- post-move wallet, written to BOTH
  v_bal    bigint;   -- bank_of_ethos.balance
  v_seq    bigint;   -- user_profiles.wallet_seq after the move
  v_pseq   bigint;   -- user_progress.wallet_seq after the move
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_amt is null or v_amt <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  if p_dir is null or p_dir not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'bad_direction');
  end if;

  -- Make both rows exist before locking anything, so a first-time banker does
  -- not fail on a missing row. A user_progress row created here starts at 0,
  -- which makes the mirror look ahead and returns 'wallet_resyncing' below —
  -- the client then reconciles the real balance up and retries, which is
  -- exactly the right outcome: the canonical row gets seeded from the player's
  -- own audited figure instead of from a number this function guessed.
  --
  -- ⚠ Deliberately NOT touching user_profiles.updated_at. Money is exempted
  --   from the client's freshness comparison by wallet_seq now, and making the
  --   cloud row look artificially fresh here would tip that comparison the
  --   other way and let a stale cloud snapshot overwrite newer local
  --   PROGRESSION — trading a currency bug for a lost-decks bug.
  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  insert into public.bank_of_ethos (user_id, balance) values (v_uid, 0) on conflict (user_id) do nothing;

  -- Lock in a fixed order. Every concurrent move for this user serialises
  -- here; two tabs cannot both read the same balance and both succeed.
  select coalesce(gems, 0)::bigint into v_gems
    from public.user_profiles where user_id = v_uid for update;
  if v_gems is null then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;

  select coalesce(cinder, 0) into v_cinder
    from public.user_progress where user_id = v_uid for update;

  select coalesce(balance, 0)::bigint into v_bal
    from public.bank_of_ethos where user_id = v_uid for update;

  -- Canonical only. See the header: the mirror is client-writable, so letting
  -- it raise the spendable wallet reopens the exploit through a second tab.
  v_wallet := coalesce(v_cinder, 0);

  /* 🛑 MIRROR AHEAD OF CANONICAL -> REFUSE, DO NOT SILENTLY RESOLVE IT.
     Both wallet rows get written to the post-move canonical figure below, so
     if the mirror is currently HIGHER this move would quietly delete the
     difference — and that difference is real: it is a reward whose
     _serverMirrorCredit() call failed, money the player genuinely earned.
     Taking it while they were trying to bank is not an acceptable way to
     close a dupe.
     The two alternatives are both worse. Spending from the mirror is the hole
     this file exists to close. Letting the rows diverge leaves the player
     watching their balance flip between two numbers on every boot.
     So: refuse, and name the reason. The client answers 'wallet_resyncing' by
     running walletReconcile() — the existing, diff-based path that lifts the
     canonical row up to what the player actually holds, and which cannot
     double-credit because it re-reads the server rather than replaying a
     queue — then retries. Nothing is lost and nothing is invented. */
  if coalesce(v_gems, 0) > v_wallet then
    return jsonb_build_object('ok', false, 'error', 'wallet_resyncing',
                              'gems', coalesce(v_gems, 0), 'balance', v_bal);
  end if;

  if p_dir = 'deposit' then
    if v_wallet < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_wallet',
                                'gems', v_wallet, 'balance', v_bal);
    end if;
    v_new := v_wallet - v_amt;
    -- 🔴 BOTH WALLET ROWS, SAME VALUE, SAME TRANSACTION. This single pair of
    --    statements is the whole fix. Writing one without the other is what
    --    let the reconcile put the money back.
    update public.user_profiles
       set gems = v_new, wallet_seq = coalesce(wallet_seq, 0) + 1
     where user_id = v_uid;
    update public.user_progress
       set cinder = v_new, wallet_seq = coalesce(wallet_seq, 0) + 1, updated_at = now()
     where user_id = v_uid;
    update public.bank_of_ethos set balance = coalesce(balance, 0) + v_amt where user_id = v_uid;
  else
    -- Withdraw RAISES the wallet, so the MAX ratchet cannot undo it and the
    -- debit counter deliberately does NOT move. Leaving it alone keeps the
    -- ratchet available to protect an unmirrored local gain, which is the
    -- exact case it was built for.
    if coalesce(v_bal, 0) < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_bank',
                                'gems', v_wallet, 'balance', v_bal);
    end if;
    v_new := v_wallet + v_amt;
    update public.bank_of_ethos set balance = coalesce(balance, 0) - v_amt where user_id = v_uid;
    update public.user_profiles  set gems   = v_new where user_id = v_uid;
    update public.user_progress  set cinder = v_new, updated_at = now() where user_id = v_uid;
  end if;

  -- Same transaction: if a ledger write fails the money move rolls back with it.
  insert into public.boe_ledger (user_id, kind, cinder, note)
  values (v_uid, p_dir, case when p_dir = 'deposit' then v_amt else -v_amt end,
          'atomic ' || p_dir || ' (canonical)');

  -- The canonical audit trail every other spend writes to. Wrapped because
  -- wallet_ledger ships in bulletproof_saves.sql, which may not be applied on
  -- a given database — a missing audit table must not block the money move.
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid,
            case when p_dir = 'deposit' then 'charge' else 'credit' end,
            'cinder',
            case when p_dir = 'deposit' then -v_amt else v_amt end,
            v_new,
            'Bank of Ethos ' || p_dir);
  exception when undefined_table or undefined_column then null;
  end;

  -- BOTH counters go back to the caller. The two tables bump in lockstep here
  -- but their absolute values differ (wallet_charge moves only the progress
  -- one), so the client cannot derive either from the other — and a client
  -- left guessing would fall behind and start discarding its own unmirrored
  -- earnings on the next boot.
  select coalesce(gems, 0)::bigint, coalesce(wallet_seq, 0) into v_new, v_seq
    from public.user_profiles where user_id = v_uid;
  select coalesce(wallet_seq, 0) into v_pseq
    from public.user_progress where user_id = v_uid;
  select coalesce(balance, 0)::bigint into v_bal
    from public.bank_of_ethos where user_id = v_uid;

  return jsonb_build_object('ok', true, 'gems', v_new, 'balance', v_bal,
                            'moved', v_amt, 'dir', p_dir,
                            'wallet_seq', v_seq, 'progress_seq', v_pseq);
end;
$t$;

revoke all on function public.boe_transfer(numeric, text) from public, anon;
grant execute on function public.boe_transfer(numeric, text) to authenticated;

-- --------------------------------------------------------------------------
-- 1b. THE SAME MOVE FOR AZA. Unchanged arithmetic from 022 — Aza genuinely has
--     only ONE server home (user_profiles.sovereigns); user_progress.sovereigns
--     exists in the schema but nothing reads or writes it, so there is no
--     second row to keep in step and no MAX ratchet on this currency.
--
--     What Aza DID share with Cinder is the other half of the bug: the client's
--     freshness guard. cloudFetchProfile() skips the whole cloud merge whenever
--     local looks newer — which it always does right after a deposit — and then
--     uploads the stale local sovereigns straight over the server's debit. The
--     wallet_seq bump below is what lets the client tell that apart from an
--     ordinary stale row and adopt the server's number instead.
--
--     ⚠ Aza is bought with REAL MONEY, so this is the more serious of the two,
--       and it is worth being exact about how far this protection reaches.
--       Cinder gets a SERVER guarantee: boe_transfer spends only from
--       user_progress.cinder, a row no client can write, so nothing a client
--       uploads can fund a deposit. Aza cannot have that today — its only
--       store is the client-writable user_profiles.sovereigns (see §0).
--       So Aza is closed on the client instead, in two places:
--         * the wallet_seq bump here, which makes cloudFetchProfile adopt the
--           server's sovereigns instead of trusting a fresher-looking local
--           copy — this closes the single-tab deposit/refresh loop;
--         * a BroadcastChannel 'wallet' message, which stops a second tab
--           re-uploading its pre-deposit copy.
--       Both are sound, neither is a server guarantee. Closing Aza the way
--       Cinder is closed means giving it a canonical row AND routing every
--       credit (addSovereigns, and the Stripe purchase path) through an RPC
--       that maintains it. That is a separate change and should not be
--       half-done — see §0.
-- --------------------------------------------------------------------------
create or replace function public.boe_transfer_aza(p_amount numeric, p_dir text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid  uuid   := auth.uid();
  v_amt  bigint := floor(coalesce(p_amount, 0))::bigint;
  v_sov  bigint;
  v_bank bigint;
  v_seq  bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_amt is null or v_amt <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  if p_dir is null or p_dir not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'bad_direction');
  end if;

  insert into public.bank_of_ethos (user_id, balance) values (v_uid, 0)
    on conflict (user_id) do nothing;

  select coalesce(sovereigns, 0)::bigint into v_sov
    from public.user_profiles where user_id = v_uid for update;
  if v_sov is null then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;

  select coalesce(aza, 0)::bigint into v_bank
    from public.bank_of_ethos where user_id = v_uid for update;

  if p_dir = 'deposit' then
    if v_sov < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_wallet',
                                'aza', v_sov, 'bank_aza', v_bank);
    end if;
    -- Debit -> bump the counter, same as a Cinder deposit.
    update public.user_profiles
       set sovereigns = v_sov - v_amt, wallet_seq = coalesce(wallet_seq, 0) + 1
     where user_id = v_uid;
    update public.bank_of_ethos set aza = coalesce(aza, 0) + v_amt where user_id = v_uid;
  else
    if v_bank < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_bank',
                                'aza', v_sov, 'bank_aza', v_bank);
    end if;
    update public.bank_of_ethos set aza        = coalesce(aza, 0) - v_amt where user_id = v_uid;
    update public.user_profiles  set sovereigns = v_sov + v_amt          where user_id = v_uid;
  end if;

  insert into public.boe_ledger (user_id, kind, aza, note)
  values (v_uid, p_dir || '_aza',
          case when p_dir = 'deposit' then v_amt else -v_amt end,
          'atomic ' || p_dir || ' (aza)');

  select coalesce(sovereigns, 0)::bigint, coalesce(wallet_seq, 0) into v_sov, v_seq
    from public.user_profiles where user_id = v_uid;
  select coalesce(aza, 0)::bigint into v_bank
    from public.bank_of_ethos where user_id = v_uid;

  return jsonb_build_object('ok', true, 'aza', v_sov, 'bank_aza', v_bank,
                            'moved', v_amt, 'dir', p_dir, 'wallet_seq', v_seq);
end;
$a$;

revoke all on function public.boe_transfer_aza(numeric, text) from public, anon;
grant execute on function public.boe_transfer_aza(numeric, text) to authenticated;

-- --------------------------------------------------------------------------
-- 2. wallet_charge — the ordinary spend path — also bumps the counter and
--    hands it back, so a client that just spent stays in step and keeps the
--    protective MAX for its unmirrored gains. Without this the client would
--    fall behind on every purchase and start adopting the server verbatim,
--    which would throw away exactly the earnings the ratchet exists to save.
--
--    ⚠ RETURN TYPE CHANGES (a column is added), and Postgres cannot do that
--      through CREATE OR REPLACE — hence the DROP. The added column is
--      trailing and the client reads the row by NAME, so an already-loaded
--      older tab keeps working against the new function.
-- --------------------------------------------------------------------------
drop function if exists public.wallet_charge(bigint, text);
create or replace function public.wallet_charge(p_amount bigint, p_reason text default 'Cinder spending')
returns table(new_balance bigint, tax_amount bigint, ok boolean, reason text, wallet_seq bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
  v_tax bigint;
  v_seq bigint;
  v_rate numeric := 0.02;
begin
  if v_uid is null then
    return query select 0::bigint, 0::bigint, false, 'not_signed_in'::text, 0::bigint; return;
  end if;
  if p_amount is null or p_amount <= 0 then
    return query select 0::bigint, 0::bigint, false, 'bad_amount'::text, 0::bigint; return;
  end if;

  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;

  -- Atomic deduct — only succeeds when the balance is sufficient. The counter
  -- moves in the SAME statement, so a debit can never land uncounted.
  --
  -- ⚠ THE `g` ALIAS IS LOAD-BEARING, not tidiness. `wallet_seq` is now both a
  --   RETURNS TABLE output column (which plpgsql exposes as a variable) and a
  --   real column on this table, so a bare reference to it on the right-hand
  --   side or in RETURNING raises "column reference is ambiguous" at runtime —
  --   every spend in the game would start failing. Qualifying through the
  --   alias removes the ambiguity. SET targets stay unqualified; that is
  --   required syntax, and unambiguous anyway.
  update public.user_progress g
     set cinder     = g.cinder - p_amount,
         wallet_seq = g.wallet_seq + 1,
         updated_at = now()
   where g.user_id = v_uid and g.cinder >= p_amount
   returning g.cinder, g.wallet_seq into v_bal, v_seq;

  if v_bal is null then
    select g.cinder, coalesce(g.wallet_seq, 0) into v_bal, v_seq
      from public.user_progress g where g.user_id = v_uid;
    return query select coalesce(v_bal, 0::bigint), 0::bigint, false, 'insufficient'::text,
                        coalesce(v_seq, 0::bigint);
    return;
  end if;

  -- 🪞 Keep the profile mirror in step on the way DOWN. 021 line ~870 spells
  --    out why: leave the mirror high and the reconcile puts the spend back.
  update public.user_profiles set gems = v_bal where user_id = v_uid and coalesce(gems, 0) > v_bal;

  -- Wrapped: wallet_ledger ships in bulletproof_saves.sql. If that file was
  -- never applied, a missing audit table must not roll back a real spend.
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (v_uid, 'charge', 'cinder', -p_amount, v_bal, p_reason);
  exception when undefined_table or undefined_column then null;
  end;

  -- Foundation Tax. Rate lives in ONE place per the handoff; 0.02 here is the
  -- historical wallet_charge rate and is intentionally left untouched by this
  -- file — changing it is an economy decision, not an anti-dupe one.
  v_tax := floor(p_amount * v_rate);
  if v_tax > 0 then
    update public.user_progress set ft_tax_total = coalesce(ft_tax_total, 0) + v_tax where user_id = v_uid;
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, meta)
        values (v_uid, 'tax', 'cinder', 0, v_bal, 'Foundation Tax (2%)',
                jsonb_build_object('tax_amount', v_tax, 'parent_reason', p_reason));
    exception when undefined_table or undefined_column then null;
    end;
    begin
      insert into public.reserve_tax_log (seller_id, resource, quantity, sale_value, tax_rate, tax_amount, market_type)
        values (v_uid, p_reason, 0, p_amount, v_rate, v_tax, 'spend');
    exception when undefined_table then null;
    end;
  end if;

  return query select v_bal, coalesce(v_tax, 0::bigint), true, ''::text, coalesce(v_seq, 0::bigint);
end$$;

revoke all on function public.wallet_charge(bigint, text) from public, anon;
grant execute on function public.wallet_charge(bigint, text) to authenticated;

-- --------------------------------------------------------------------------
-- 3. boe_balances — authoritative read, now reporting the max of both wallet
--    rows (what the player actually holds) plus the counter, so the client can
--    resync without trusting its own cached numbers.
-- --------------------------------------------------------------------------
create or replace function public.boe_balances()
returns jsonb
language plpgsql
security definer
set search_path = public
as $b$
declare
  v_uid uuid := auth.uid();
  v_gems bigint; v_cinder bigint; v_bal bigint; v_seq bigint; v_sov bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select coalesce(gems, 0)::bigint, coalesce(sovereigns, 0)::bigint, coalesce(wallet_seq, 0)
    into v_gems, v_sov, v_seq
    from public.user_profiles where user_id = v_uid;
  select coalesce(cinder, 0) into v_cinder from public.user_progress where user_id = v_uid;
  select coalesce(balance, 0)::bigint into v_bal from public.bank_of_ethos where user_id = v_uid;
  return jsonb_build_object('ok', true,
                            'gems', greatest(coalesce(v_gems, 0), coalesce(v_cinder, 0)),
                            'aza', coalesce(v_sov, 0),
                            'balance', coalesce(v_bal, 0),
                            'wallet_seq', coalesce(v_seq, 0));
end;
$b$;
revoke all on function public.boe_balances() from public, anon;
grant execute on function public.boe_balances() to authenticated;

-- --------------------------------------------------------------------------
-- 4. CLOSE THE RAW WRITE PATH.
--    bulletproof_saves.sql gave `authenticated` a direct INSERT + UPDATE on
--    user_progress. That makes the canonical wallet settable to any number
--    with one PostgREST PATCH, no exploit required — and it makes every
--    guarantee above decorative.
--
--    Safe to drop: the client only ever SELECTs this table (three call sites,
--    all `.select`), and every writer — wallet_charge, wallet_credit,
--    progress_ensure, inv_grant, boe_transfer — is SECURITY DEFINER and
--    therefore bypasses RLS anyway.
--
--    ⚠ TO REVERSE, if something unforeseen turns out to need it:
--        create policy up_ins on public.user_progress for insert to authenticated
--          with check (user_id = auth.uid());
--        create policy up_upd on public.user_progress for update to authenticated
--          using (user_id = auth.uid()) with check (user_id = auth.uid());
-- --------------------------------------------------------------------------
alter table public.user_progress enable row level security;
drop policy if exists up_ins on public.user_progress;
drop policy if exists up_upd on public.user_progress;
-- SELECT stays — the client must be able to read its own wallet.
drop policy if exists up_sel on public.user_progress;
create policy up_sel on public.user_progress
  for select to authenticated using (user_id = auth.uid());

-- ===========================================================================
-- VERIFY — run after applying.
-- ===========================================================================

-- 4a. Both counters exist.
-- select table_name, column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public' and column_name = 'wallet_seq'
--  order by table_name;
--   -> expect two rows: user_profiles, user_progress

-- 4b. The wallet is unwritable from the client role.
-- select polname, polcmd from pg_policy
--  where polrelid = 'public.user_progress'::regclass;
--   -> expect exactly one row: up_sel / r   (no 'a' insert, no 'w' update)

-- 4c. Functions present and SECURITY DEFINER.
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('boe_transfer','boe_transfer_aza','boe_balances','wallet_charge')
--  order by p.proname;
--   -> expect 4 rows, prosecdef = true on all

-- 4d. AUDIT ONLY — where the two wallet rows currently disagree. This file
--     does NOT touch these. Read it, decide per account, act by hand.
--     A positive `mirror_minus_canonical` on an account that has used the bank
--     is the fingerprint of the 022-era dupe; the reconcile would have lifted
--     the canonical row to match on their next sign-in.
-- select p.user_id, p.display_name,
--        coalesce(p.gems, 0)   as mirror_gems,
--        coalesce(g.cinder, 0) as canonical_cinder,
--        coalesce(p.gems, 0) - coalesce(g.cinder, 0) as mirror_minus_canonical,
--        coalesce(b.balance, 0) as bank_balance,
--        coalesce(p.wallet_seq, 0) as profile_seq,
--        coalesce(g.wallet_seq, 0) as progress_seq
--   from public.user_profiles p
--   left join public.user_progress  g on g.user_id = p.user_id
--   left join public.bank_of_ethos  b on b.user_id = p.user_id
--  where coalesce(p.gems, 0) <> coalesce(g.cinder, 0)
--  order by abs(coalesce(p.gems, 0) - coalesce(g.cinder, 0)) desc
--  limit 100;
