-- ============================================================================
-- 139 — SERIALS: the press takes its own payment, and the register fits a reply
-- Project: ktsiasyjusesawtrwrjc   Status: see the bottom of this header
-- ⚠ REQUIRES 137 AND 138.
-- ----------------------------------------------------------------------------
-- Three defects in 137, all found by checking what v121v169 would SHOW after the
-- catalogue backfill ran (52,248 numbers, 128 accounts, oldest first) rather
-- than checking that the backfill's own return value said "backfilled".
--
-- 1. 🔴 serial_claim TOOK NO PAYMENT. 137 left the charge to the client
--    (chargeCinderAtomic, then the claim, then a refund on failure). A number is
--    issued by the server, so the server was the only party able to enforce a
--    price — and it did not. Anyone who can call an RPC from a console could
--    empty a 250-copy Mythic press run for nothing. No press run existed when
--    this was found, so nothing was lost; v169 ships the button that creates
--    them. The charge now happens INSIDE the claim, in the same transaction,
--    via wallet_charge(): a claim that fails cannot leave a charge behind, and a
--    charge that fails cannot leave a number behind, so the client's
--    charge-then-refund dance is deleted rather than patched.
--    ⚠ THE PRICE COMES FROM THE RUN ROW, never from an argument. A price
--      parameter would be a price the caller chooses.
--
-- 2. 🔴 serial_claim DID NOT CHECK THE RUN'S KIND. A catalogue run is a register
--    — its numbers are issued against cards a player already holds. Claiming off
--    one issues a number with no card behind it. Refused now.
--
-- 3. 🔴 serial_mine RETURNED ONE ROW PER COPY, AND 13 PLAYERS HOLD MORE THAN THE
--    API WILL RETURN. PostgREST caps a response at 1,000 rows by default. After
--    the backfill, 13 accounts hold over 1,000 numbered copies (the largest,
--    4,407). serialFetchRuns() REPLACES its cache wholesale from this reply — on
--    purpose, so a stale number cannot outlive a sale — which means a truncated
--    reply does not show "some" badges, it silently deletes the rest. One row per
--    CARD with the serials as an array is at most 605 rows for the largest
--    collection in the game (635 for the whole catalogue).
--
-- ⚠ BOTH FUNCTIONS CHANGE RETURN TYPE, SO BOTH ARE DROPPED FIRST. This is the
--   same 42P13 that stopped 138 on first application ("cannot change return type
--   of existing function"); 958c820ccc records it. `create or replace` alone
--   would fail against every database this file is for.
-- ⚠ AND BOTH KEEP THEIR ARGUMENT LISTS EXACTLY. A changed argument list does not
--   replace a function, it adds an OVERLOAD — which here would leave the free,
--   kind-blind serial_claim(uuid) callable beside the fixed one.
-- ⚠ EXECUTE IS RE-GRANTED EXPLICITLY. Dropping a function drops its grants.
--   Supabase's default privileges happened to restore them for 138's drop, but a
--   security fix should not depend on a default nobody set in this file.
--
-- Re-runnable.
-- ============================================================================

drop function if exists public.serial_claim(uuid);
create function public.serial_claim(p_run_id uuid)
returns table(ok boolean, status text, serial integer, remaining integer,
              new_balance bigint, tax_amount bigint, wallet_seq bigint)
language plpgsql security definer set search_path = public as $fn$
declare
  v_total integer; v_kind text; v_price integer; v_name text;
  v_next integer; v_taken integer;
  w record;
begin
  if auth.uid() is null then
    return query select false, 'not signed in', 0, 0, 0::bigint, 0::bigint, 0::bigint; return;
  end if;

  select r.total, r.kind, r.price, r.card_name
    into v_total, v_kind, v_price, v_name
    from public.serialized_runs r where r.id = p_run_id
     for update;                                 -- serialises buyers of the last copy
  if v_total is null then
    return query select false, 'no such run', 0, 0, 0::bigint, 0::bigint, 0::bigint; return;
  end if;
  if v_kind is distinct from 'press' then
    -- A register issues numbers against cards already held; it is not for sale.
    return query select false, 'not for sale', 0, 0, 0::bigint, 0::bigint, 0::bigint; return;
  end if;

  select count(*)::int into v_taken from public.serial_copies c where c.run_id = p_run_id;
  if v_taken >= v_total then
    return query select false, 'sold out', 0, 0, 0::bigint, 0::bigint, 0::bigint; return;
  end if;

  -- Charge BEFORE issuing, in the same transaction. If the insert below fails
  -- for any reason the charge rolls back with it.
  if coalesce(v_price, 0) > 0 then
    select * into w from public.wallet_charge(v_price::bigint, 'Serialized press: ' || coalesce(v_name, ''));
    if w is null or not w.ok then
      return query select false, coalesce(nullif(w.reason, ''), 'payment failed'), 0, 0,
                          coalesce(w.new_balance, 0::bigint), 0::bigint, coalesce(w.wallet_seq, 0::bigint);
      return;
    end if;
  end if;

  select coalesce(max(c.serial), 0) + 1 into v_next from public.serial_copies c where c.run_id = p_run_id;
  insert into public.serial_copies (run_id, serial, owner_id, owner_name)
  values (p_run_id, v_next, auth.uid(),
          (select coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), u.email) from auth.users u where u.id = auth.uid()));

  return query select true, 'claimed', v_next, (v_total - v_taken - 1),
                      coalesce(w.new_balance, -1::bigint),   -- -1 = free run, no balance change
                      coalesce(w.tax_amount, 0::bigint),
                      coalesce(w.wallet_seq, 0::bigint);
end $fn$;

drop function if exists public.serial_mine();
create function public.serial_mine()
returns table(card_id text, card_name text, serials integer[], total integer, run_id uuid, kind text)
language sql stable security definer set search_path = public as $fn$
  select r.card_id, r.card_name, array_agg(c.serial order by c.serial), r.total, r.id, r.kind
    from public.serial_copies c join public.serialized_runs r on r.id = c.run_id
   where c.owner_id = auth.uid()
   group by r.id, r.card_id, r.card_name, r.total, r.kind
   order by r.card_name;
$fn$;

grant execute on function public.serial_claim(uuid) to authenticated;
grant execute on function public.serial_mine()      to authenticated;

-- ── verify ──────────────────────────────────────────────────────────────────
-- Exactly one of each (an overload would show as 2), and authenticated can call both.
select p.proname, count(*) as overloads,
       bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as auth_can_execute
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('serial_claim', 'serial_mine')
 group by p.proname;
