-- ===========================================================================
-- 107 — WAGES COME OUT OF THE CORPORATION, NOT OUT OF THE FOUNDER'S POCKET.
--
-- Reported: "when players who own a corporation or a CEO of a corporation pays
-- their member in Cinder with the Pay button, take from the Corp Treasury and
-- then pay the player."
--
-- corp_pay_member() (sql/080) debits auth.uid()'s PERSONAL wallet. That was
-- right for a member handing a colleague some Cinder, and wrong for the thing
-- the button is actually used for: an owner paying wages. The founder of Hidn
-- Studios has 962,190 🔥 sitting in the corporation and was being charged from
-- his own 69,795 🔥 to pay a member — and the modal told him so, which is why
-- it reads as the money coming from the wrong place.
--
-- This is a SECOND function, not a change to the first. corp_pay_member stays
-- exactly as it is for member-to-member gifts; the client picks the treasury
-- one only when the payer can actually spend the treasury. Rewriting 080 in
-- place would silently change what every existing caller does with somebody
-- else's money.
--
-- ⚠ WHO MAY SPEND IT. The founder (corporations.founder_id) or a member whose
--   role is one the corporation gives spending authority: founder, owner, CEO.
--   Compared case-insensitively because corp_members.role holds display-cased
--   strings ('CEO', 'Bank Teller') alongside lowercase ones ('founder',
--   'member') — a `role = 'ceo'` test would silently refuse every real CEO.
-- ⚠ THE BALANCE IS A SUM, NOT A COLUMN. corp_treasury is append-only, so the
--   balance is sum(amount) and a spend is a NEGATIVE row. The corporation row
--   is locked FOR UPDATE first, so two simultaneous wage payments cannot both
--   read the same balance and both pass the affordability test.
-- ⚠ NUMERIC, NOT bigint, on the ledger side: corp_treasury.amount is numeric
--   and op_revenue writes fractions into it. The Cinder leg is floored to a
--   whole number because wallets are integers, and the SAME floored figure is
--   what the treasury is debited, so the two sides cannot disagree by a
--   fraction that accumulates.
--
-- Idempotent and re-runnable. Verify block at the bottom.
-- ===========================================================================

create or replace function public.corp_pay_member_from_treasury(
  p_corp_id uuid, p_to_id uuid, p_qty bigint,
  p_note text default null, p_from_name text default null, p_to_name text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid   uuid := auth.uid();
  v_qty   bigint := floor(coalesce(p_qty, 0));
  v_bal   numeric;
  v_give  jsonb;
  v_id    uuid;
  v_corp  text;
  v_may   boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_qty <= 0 then raise exception 'amount must be greater than zero' using errcode = '22023'; end if;
  if p_to_id is null then raise exception 'pick who to pay' using errcode = '22023'; end if;

  select name into v_corp from corporations where id = p_corp_id;
  if v_corp is null then raise exception 'no such corporation' using errcode = 'P0002'; end if;

  /* Spending authority: the founder, or a member holding a role the
     corporation trusts with the treasury. coalesce(...,false) because a NULL
     from either test must read as "not allowed", never as "not denied". */
  select coalesce(
    (select true from corporations c
      where c.id = p_corp_id and c.founder_id = v_uid),
    (select true from corp_members m
      where m.corp_id = p_corp_id and m.user_id = v_uid
        and lower(coalesce(m.role,'')) in ('founder','owner','ceo')),
    false) into v_may;
  if not v_may then
    raise exception 'only the founder or a CEO can pay wages from the treasury'
      using errcode = '42501';
  end if;

  if not exists (select 1 from corp_members where corp_id = p_corp_id and user_id = p_to_id) then
    raise exception 'they are not a member of that corporation' using errcode = '22023';
  end if;

  -- One payer at a time per corporation: two wage runs cannot both read the
  -- same balance and both decide they can afford it.
  perform 1 from corporations where id = p_corp_id for update;

  select coalesce(sum(amount), 0) into v_bal from corp_treasury where corp_id = p_corp_id;
  if v_bal < v_qty then
    raise exception 'the corporation treasury holds % and the payment is %', floor(v_bal), v_qty
      using errcode = '22023';
  end if;

  insert into corp_treasury (corp_id, user_id, amount, kind, note)
  values (p_corp_id, p_to_id, -v_qty, 'wage',
          coalesce(nullif(btrim(coalesce(p_note,'')), ''), 'Wage') ||
          ' — paid to ' || coalesce(p_to_name, 'a member') ||
          ' by ' || coalesce(p_from_name, 'an officer'));

  -- The member's own wallet, through the same primitive every other credit uses.
  v_give := _ct_cinder_give(p_to_id, v_qty, 'Corp wage from ' || v_corp);

  insert into corp_transfers (corp_id, from_id, from_name, to_id, to_name,
                              kind, item_id, name, icon, qty, note, status, settled_at)
  values (p_corp_id, v_uid, coalesce(p_from_name, v_corp), p_to_id, p_to_name,
          'resource', 'cinder', 'Cinder', '🔥', v_qty,
          coalesce(p_note, 'Wage'), 'claimed', now())
  returning id into v_id;

  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id,
                              name, icon, qty, counterparty_id, counterparty_name)
  values (p_corp_id, v_uid, p_from_name, 'send', 'resource', 'cinder',
          'Cinder', '🔥', v_qty, p_to_id, p_to_name);

  return jsonb_build_object(
    'id',               v_id,
    'qty',              v_qty,
    'source',           'treasury',
    'treasury_before',  floor(v_bal),
    'treasury_balance', floor(v_bal - v_qty),
    'to_balance',       (v_give->>'balance')::bigint
  );
end $$;

revoke all on function public.corp_pay_member_from_treasury(uuid, uuid, bigint, text, text, text) from public, anon;
grant execute on function public.corp_pay_member_from_treasury(uuid, uuid, bigint, text, text, text) to authenticated;

-- ===========================================================================
-- VERIFY
--   -- the function exists, is definer, and only authenticated may call it:
--   select p.oid::regprocedure, p.prosecdef,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'corp_pay_member_from_treasury';
--   -- expect prosecdef true, anon false, authed true.
--
--   -- and a rolled-back live probe (nothing persists — the RAISE undoes it):
--   do $$
--   declare corp uuid; founder uuid; member uuid; r jsonb; bal numeric;
--   begin
--     select id, founder_id into corp, founder from corporations where name ilike '%Hidn%' limit 1;
--     select user_id into member from corp_members
--      where corp_id = corp and user_id <> founder limit 1;
--     select coalesce(sum(amount),0) into bal from corp_treasury where corp_id = corp;
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', founder, 'role','authenticated')::text, true);
--     r := public.corp_pay_member_from_treasury(corp, member, 1000, 'probe', 'Founder', 'Member');
--     raise exception 'PROBE (rolled back): treasury % -> %, member balance %, was %',
--       r->>'treasury_before', r->>'treasury_balance', r->>'to_balance', bal;
--   end $$;
-- ===========================================================================
