-- ===========================================================================
-- 024 . AZA — A REAL SERVER-OWNED WALLET (the thing 023 said it was skipping)
-- ===========================================================================
-- WHY THIS EXISTS
--
--   023 gave Cinder a server guarantee: bank deposits spend from
--   user_progress.cinder, a row no client can write. Aza got only client-side
--   protection, because it had no canonical row and could not be given one
--   without first fixing how it is CREDITED. This file does that fix.
--
--   ⚠ THE HOLE THIS CLOSES IS NOT THE BANK DUPE. It is much plainer than that.
--     `authenticated` holds column UPDATE on user_profiles.sovereigns and RLS
--     lets you update your own row, so one PostgREST PATCH sets any player's
--     Aza to any number. No exploit chain, no race. Aza is bought with REAL
--     MONEY, which makes that the most serious open door in the economy.
--
--   The lock itself — revoking those column privileges — is deliberately NOT
--   in this file. It goes in 025, AFTER the client stops uploading the column
--   and after the credit paths below are live. Revoke first and a real paid
--   purchase would silently fail to persist, which is a worse bug than the one
--   being fixed. Order matters more than speed here.
--
-- THE SHAPE, MATCHING CINDER
--   * user_progress.sovereigns  - CANONICAL. Written only by the functions
--                                 below, all SECURITY DEFINER.
--   * user_profiles.sovereigns  - display mirror, kept in lockstep on every
--                                 move so the two can never drift and hand a
--                                 stale value back (the 022 lesson).
--
-- WHO MAY CREDIT
--   Aza is not earned by playing — it is bought, or granted. So unlike
--   wallet_credit (which the client must be able to call, because Cinder
--   rewards are computed client-side), NOTHING here lets a client name its own
--   credit amount:
--     * sov_credit    - service_role ONLY. The Worker calls it after Stripe
--                       has confirmed payment.
--     * aza_fulfill   - service_role ONLY, idempotent per Stripe session.
--     * aza_gift_claim- callable by the player, but the amount comes from the
--                       gift ROW, never from a parameter.
--     * sov_charge    - callable by the player. Spending your own balance
--                       DOWN needs no protection.
--
-- ORDER: apply AFTER 023. Idempotent; safe to re-run.
-- It never edits a balance except the one-time seed described in §1, which
-- can only raise a column that has always been zero.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 0. Shape guards.
-- --------------------------------------------------------------------------
alter table public.user_progress add column if not exists sovereigns bigint not null default 0;
alter table public.user_profiles add column if not exists wallet_seq bigint not null default 0;
alter table public.bank_of_ethos add column if not exists aza        numeric not null default 0;

-- --------------------------------------------------------------------------
-- 1. ONE-TIME SEED OF THE CANONICAL ROW.
--
--    user_progress.sovereigns has existed since bulletproof_saves.sql and
--    nothing has ever written it: it is 0 for every account while the real Aza
--    sits in the mirror. The functions below treat it as canonical, which they
--    cannot do while it reads 0 for everyone — every deposit and every spend
--    would be refused as insufficient.
--
--    ⚠ A SEED, NOT A REPAIR. greatest() can only lift an always-unused zero up
--      to what the player already holds. It cannot lower anyone, and it makes
--      no judgement about whether any of that Aza was legitimately obtained —
--      that stays a human decision, as in 021 and 023.
--
--    Runs before the functions are replaced, while nothing reads the column.
-- --------------------------------------------------------------------------
insert into public.user_progress (user_id)
select p.user_id
  from public.user_profiles p
  left join public.user_progress g on g.user_id = p.user_id
 where g.user_id is null
   and coalesce(p.sovereigns, 0) > 0
on conflict (user_id) do nothing;

update public.user_progress g
   set sovereigns = greatest(coalesce(g.sovereigns, 0), coalesce(p.sovereigns, 0)::bigint)
  from public.user_profiles p
 where p.user_id = g.user_id
   and coalesce(p.sovereigns, 0)::bigint > coalesce(g.sovereigns, 0);

-- --------------------------------------------------------------------------
-- 2. THE ONE PLACE AZA MOVES. Every public function below delegates here, so
--    there is exactly one implementation of "write both rows and ledger it".
--
--    Private on purpose: no grant to anon or authenticated, and it takes a
--    user id rather than reading auth.uid(), because the Worker calls it for
--    a player who is not the caller.
--
--    ⚠ user_profiles.sovereigns is INTEGER while the canonical column is
--      bigint. A value past 2,147,483,647 raises out-of-range and rolls the
--      whole move back — refusing rather than silently truncating a real-money
--      balance, which is the behaviour we want.
-- --------------------------------------------------------------------------
create or replace function public._sov_apply(p_uid uuid, p_delta bigint, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = public
as $s$
declare
  v_bal bigint;
begin
  if p_uid is null or coalesce(p_delta, 0) = 0 then
    return null;
  end if;

  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;

  -- Lock, then apply. The guard in the WHERE is what makes an over-spend
  -- impossible rather than merely unlikely: if the balance is short, zero rows
  -- update and v_bal comes back null.
  update public.user_progress
     set sovereigns = coalesce(sovereigns, 0) + p_delta,
         updated_at = now()
   where user_id = p_uid
     and coalesce(sovereigns, 0) + p_delta >= 0
   returning sovereigns into v_bal;

  if v_bal is null then
    return null;                              -- insufficient; caller reports
  end if;

  -- 🪞 Mirror in lockstep. Skipping this is exactly how 022 duped: leave the
  --    mirror high and the next sync hands the spend straight back.
  update public.user_profiles
     set sovereigns = v_bal,
         wallet_seq = case when p_delta < 0 then coalesce(wallet_seq, 0) + 1
                           else coalesce(wallet_seq, 0) end
   where user_id = p_uid;

  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (p_uid, case when p_delta < 0 then 'charge' else 'credit' end,
            'sovereigns', p_delta, v_bal, coalesce(p_reason, 'aza'));
  exception when undefined_table or undefined_column then null;
  end;

  return v_bal;
end;
$s$;
revoke all on function public._sov_apply(uuid, bigint, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. sov_credit — SERVICE ROLE ONLY.
--
--    ⚠ THE GRANT IS THE WHOLE POINT. Compare wallet_credit, which is granted
--      to authenticated (and to anon) and therefore lets any signed-in player
--      mint unlimited Cinder in one RPC call. That grant exists because Cinder
--      rewards are computed on the client and there is currently no server
--      that knows what a match win is worth — a real problem, but a much
--      larger one than this file.
--      Aza has no such excuse: it is bought or granted, never earned in play.
--      So it is never callable by a player.
-- --------------------------------------------------------------------------
create or replace function public.sov_credit(p_user_id uuid, p_amount bigint, p_reason text default 'aza credit')
returns jsonb
language plpgsql
security definer
set search_path = public
as $c$
declare v_bal bigint;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'bad_user'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  v_bal := public._sov_apply(p_user_id, p_amount, p_reason);
  if v_bal is null then return jsonb_build_object('ok', false, 'error', 'apply_failed'); end if;
  return jsonb_build_object('ok', true, 'aza', v_bal, 'credited', p_amount);
end;
$c$;
revoke all on function public.sov_credit(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.sov_credit(uuid, bigint, text) to service_role;

-- --------------------------------------------------------------------------
-- 4. sov_charge — the player CAN call this. Spending your own balance down
--    cannot be abused, and refusing an over-spend is enforced by the same
--    statement that moves the money, so it cannot half-apply.
-- --------------------------------------------------------------------------
create or replace function public.sov_charge(p_amount bigint, p_reason text default 'aza spend')
returns jsonb
language plpgsql
security definer
set search_path = public
as $h$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
  v_have bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;

  v_bal := public._sov_apply(v_uid, -p_amount, p_reason);
  if v_bal is null then
    select coalesce(sovereigns, 0) into v_have from public.user_progress where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'aza', coalesce(v_have, 0));
  end if;
  return jsonb_build_object('ok', true, 'aza', v_bal, 'charged', p_amount);
end;
$h$;
revoke all on function public.sov_charge(bigint, text) from public, anon;
grant execute on function public.sov_charge(bigint, text) to authenticated;

-- --------------------------------------------------------------------------
-- 5. aza_fulfill — the Stripe path, moved off the client.
--
--    Today /api/buy/confirm verifies the payment properly (paid, and the
--    session belongs to the caller) and then hands the AMOUNT BACK to the
--    client to credit itself. The verification is sound and the crediting is
--    not: the client decides what to write, and it drives the aza_purchases
--    insert that is supposed to make it exactly-once.
--
--    Here the Worker calls this with SB_SERVICE instead. Idempotence comes
--    from the UNIQUE session_id — the same on-conflict-returning trick
--    shop_fulfill uses, so a double call credits nothing extra.
-- --------------------------------------------------------------------------
create or replace function public.aza_fulfill(p_user uuid, p_session text, p_aza bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_new int := 0;
  v_bal bigint;
begin
  if p_user is null or coalesce(p_session, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;
  if p_aza is null or p_aza <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;

  with ins as (
    insert into public.aza_purchases (user_id, session_id, aza)
    values (p_user, p_session, p_aza)
    on conflict (session_id) do nothing
    returning id
  ) select count(*)::int into v_new from ins;

  if v_new = 0 then
    -- Already credited on an earlier call. Report the balance so the client
    -- can still settle its display, but move nothing.
    select coalesce(sovereigns, 0) into v_bal from public.user_progress where user_id = p_user;
    return jsonb_build_object('ok', true, 'already', true, 'aza', coalesce(v_bal, 0));
  end if;

  v_bal := public._sov_apply(p_user, p_aza, 'Aza pack purchase ' || p_session);
  if v_bal is null then
    -- Roll the receipt back with it, or the money is owed and the session is
    -- burnt — the player would have paid and have no way to be credited.
    raise exception 'aza_fulfill: credit failed for % (session %)', p_user, p_session;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'aza', v_bal, 'credited', p_aza);
end;
$f$;
revoke all on function public.aza_fulfill(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.aza_fulfill(uuid, text, bigint) to service_role;

-- --------------------------------------------------------------------------
-- 6. aza_gift_claim — the other way Aza arrives (Shop tiers deliver it as an
--    '__aza__' gift, and admins grant it the same way).
--
--    The client currently flips the gift row to claimed and then calls
--    addSovereigns(qty) with a qty IT holds. Once sov_credit is service-role
--    only that path simply stops working, and it should: the amount has to
--    come from the row.
--
--    Flip and credit happen in ONE statement-chain here, so a gift cannot be
--    marked claimed without paying out, or pay out twice. The status guard in
--    the UPDATE is what prevents the double-claim, exactly as the client's
--    version did — but now the payout is bound to it.
-- --------------------------------------------------------------------------
create or replace function public.aza_gift_claim(p_gift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $g$
declare
  v_uid uuid := auth.uid();
  v_qty bigint;
  v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_gift_id is null then return jsonb_build_object('ok', false, 'error', 'bad_args'); end if;

  -- Only this player's own pending Aza gift, and only once. qty is read from
  -- the row inside the same statement that claims it.
  update public.gifts
     set status = 'claimed', claimed_at = now()
   where id = p_gift_id
     and to_user = v_uid
     and card_id = '__aza__'
     and status = 'pending'
   returning greatest(0, coalesce(qty, 0))::bigint into v_qty;

  if v_qty is null then
    return jsonb_build_object('ok', false, 'error', 'not_claimable');
  end if;
  if v_qty = 0 then
    return jsonb_build_object('ok', true, 'aza', null, 'credited', 0);
  end if;

  v_bal := public._sov_apply(v_uid, v_qty, 'Aza gift claim');
  if v_bal is null then
    raise exception 'aza_gift_claim: credit failed for gift %', p_gift_id;
  end if;
  return jsonb_build_object('ok', true, 'aza', v_bal, 'credited', v_qty);
end;
$g$;
revoke all on function public.aza_gift_claim(uuid) from public, anon;
grant execute on function public.aza_gift_claim(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 7. boe_transfer_aza — now spends from the canonical row, like its Cinder
--    twin in 023. The mirror is still client-writable until 025 lands, so
--    reading it here would leave the bank fundable by a PATCH.
--
--    No 'wallet_resyncing' handshake, unlike Cinder. That refusal exists
--    because Cinder can legitimately sit higher in the mirror than in the
--    canonical row (a reward whose background mirror call failed). Aza has no
--    such path any more — every credit above writes both rows together — so a
--    mirror running ahead is staleness, not money, and the lockstep write
--    below simply corrects it.
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
  v_new  bigint;
  v_seq  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if v_amt is null or v_amt <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if p_dir is null or p_dir not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'bad_direction');
  end if;

  if not exists (select 1 from public.user_profiles where user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;

  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  insert into public.bank_of_ethos (user_id, balance) values (v_uid, 0) on conflict (user_id) do nothing;

  -- Same lock order as boe_transfer: profiles -> progress -> bank.
  perform 1 from public.user_profiles where user_id = v_uid for update;
  select coalesce(sovereigns, 0) into v_sov from public.user_progress where user_id = v_uid for update;
  select coalesce(aza, 0)::bigint into v_bank from public.bank_of_ethos where user_id = v_uid for update;

  if p_dir = 'deposit' then
    if coalesce(v_sov, 0) < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_wallet',
                                'aza', coalesce(v_sov, 0), 'bank_aza', v_bank);
    end if;
    v_new := public._sov_apply(v_uid, -v_amt, 'Bank of Ethos deposit (aza)');
    if v_new is null then
      return jsonb_build_object('ok', false, 'error', 'insufficient_wallet',
                                'aza', coalesce(v_sov, 0), 'bank_aza', v_bank);
    end if;
    update public.bank_of_ethos set aza = coalesce(aza, 0) + v_amt where user_id = v_uid;
  else
    if coalesce(v_bank, 0) < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_bank',
                                'aza', coalesce(v_sov, 0), 'bank_aza', v_bank);
    end if;
    update public.bank_of_ethos set aza = coalesce(aza, 0) - v_amt where user_id = v_uid;
    v_new := public._sov_apply(v_uid, v_amt, 'Bank of Ethos withdrawal (aza)');
    if v_new is null then
      raise exception 'boe_transfer_aza: withdraw credit failed for %', v_uid;
    end if;
  end if;

  insert into public.boe_ledger (user_id, kind, aza, note)
  values (v_uid, p_dir || '_aza',
          case when p_dir = 'deposit' then v_amt else -v_amt end,
          'canonical ' || p_dir || ' (aza)');

  select coalesce(wallet_seq, 0) into v_seq from public.user_profiles where user_id = v_uid;
  select coalesce(aza, 0)::bigint into v_bank from public.bank_of_ethos where user_id = v_uid;

  return jsonb_build_object('ok', true, 'aza', v_new, 'bank_aza', v_bank,
                            'moved', v_amt, 'dir', p_dir, 'wallet_seq', v_seq);
end;
$a$;
revoke all on function public.boe_transfer_aza(numeric, text) from public, anon;
grant execute on function public.boe_transfer_aza(numeric, text) to authenticated;

-- --------------------------------------------------------------------------
-- 8. boe_balances — report the canonical Aza, not the mirror.
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
  select coalesce(gems, 0)::bigint, coalesce(wallet_seq, 0)
    into v_gems, v_seq
    from public.user_profiles where user_id = v_uid;
  select coalesce(cinder, 0), coalesce(sovereigns, 0)
    into v_cinder, v_sov
    from public.user_progress where user_id = v_uid;
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

-- ===========================================================================
-- VERIFY — run after applying.
-- ===========================================================================

-- 8a. Grants are the security boundary here. Read this one carefully.
-- select p.proname,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') as service
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('_sov_apply','sov_credit','sov_charge','aza_fulfill',
--                      'aza_gift_claim','boe_transfer_aza','boe_balances')
--  order by p.proname;
--   -> _sov_apply      f / f / t      (service_role keeps it via Supabase's
--                                     blanket GRANT ALL on the schema; that is
--                                     expected and harmless — service_role is
--                                     the Worker's own key. What matters is
--                                     that `authed` is false.)
--   -> sov_credit      f / f / t      ← MUST be false for authenticated
--   -> aza_fulfill     f / f / t      ← MUST be false for authenticated
--   -> sov_charge      t / f / t
--   -> aza_gift_claim  t / f / t
--   -> boe_transfer_aza t / f / t
--   -> boe_balances    t / f / t

-- 8b. The seed landed and the two rows agree.
-- select count(*) filter (where coalesce(g.sovereigns,0) <> coalesce(p.sovereigns,0)::bigint) as disagreeing,
--        count(*) filter (where coalesce(g.sovereigns,0) > 0) as holders
--   from public.user_profiles p join public.user_progress g on g.user_id = p.user_id;
--   -> disagreeing should be 0 immediately after applying

-- 8c. Who holds Aza, and where.
-- select p.display_name, p.sovereigns as mirror, g.sovereigns as canonical,
--        b.aza as banked
--   from public.user_profiles p
--   left join public.user_progress g on g.user_id = p.user_id
--   left join public.bank_of_ethos b on b.user_id = p.user_id
--  where coalesce(p.sovereigns,0) > 0 or coalesce(g.sovereigns,0) > 0 or coalesce(b.aza,0) > 0
--  order by coalesce(g.sovereigns,0) desc;

-- ⚠ 025 IS THE LOCK. Until `revoke update (sovereigns) on user_profiles` runs,
--   everything above can still be bypassed with a single PATCH. Do not treat
--   Aza as closed on the strength of this file alone.
