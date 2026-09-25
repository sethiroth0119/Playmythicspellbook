-- ════════════════════════════════════════════════════════════════════════════
-- 148 · NODE MANAGER HIRING PAY: PAID FROM A WALLET, CLAIMED ONCE, BY THE SERVER
--       APPLIED 2026-09-17 (owner approved). Verify block all as expected
--       (5 historical rows / 2,500 left unfunded). Behaviour proven in a rolled-back
--       probe: self-hire refused, hire debited 500, re-appoint refused, claim
--       credited 500 once, a second claim got 0.
--
-- THE HOLE (live 2026-09-17, read out of pg_proc / pg_policies):
--   city_set_mayor(p_mayor_id, p_mayor_name, p_pay, p_from) is SECURITY DEFINER
--   and did
--       insert into city_mayor_pay (user_id, amount, from_name)
--       values (p_mayor_id, least(100000, p_pay), p_from);
--   with NO wallet debit. The owner's 500 hiring fee was taken on the client
--   (spendGems) in a separate step the server never saw, so the row itself was
--   unfunded. Nothing checked that the caller had a city, that the payee
--   existed, or that the payee was not the caller. So from the console:
--       for (;;) await Cloud.client.rpc('city_set_mayor',
--         { p_mayor_id: me, p_mayor_name: 'x', p_pay: 100000, p_from: 'x' })
--   wrote 100,000 Cinder of pay per call to oneself.
--   The payee then claimed it on the CLIENT (index.html _mayorPayClaim): read
--   unclaimed rows, UPDATE claimed = true, addCinders(total) locally. And the
--   UPDATE policy
--       cmp_upd  for update to authenticated
--                using (user_id = auth.uid()) with check (user_id = auth.uid())
--   let the payee set claimed back to FALSE and claim the same rows forever.
--   anon and authenticated also held INSERT/UPDATE/DELETE grants on the table.
--
-- THE RULE THIS FILE MAKES STRUCTURAL:
--   · Hiring pay is an ESCROW, not a mint. city_set_mayor takes the fee from
--     the caller's canonical wallet (_ct_cinder_take → user_progress +
--     wallet_ledger, raises 'not enough Cinder' so nothing at all is written
--     on a short wallet) in the same transaction that writes the pay row, and
--     marks that row funded = true.
--   · Only a funded row can ever be claimed. The five historical rows (all
--     already claimed, 2,500 total) and anything the OLD function writes
--     between now and applying this file stay funded = false and are never
--     credited by the new claim path.
--   · Claiming is city_mayor_pay_claim(): one UPDATE … WHERE NOT claimed …
--     RETURNING under row locks, then _ct_cinder_give for exactly that sum.
--     A concurrent second call re-checks `not claimed` on the locked rows and
--     gets nothing, so each row is credited at most once. The client adopts
--     the figure the server returns; it never computes the total.
--   · Clients cannot write the table at all: cmp_upd is dropped and INSERT /
--     UPDATE / DELETE are revoked from anon and authenticated. SELECT stays
--     (own rows only, cmp_sel) so the claim toast can still show a name.
--   · Paid hires are refused for: no session, hiring yourself, a payee that is
--     not a real account, no node named, a caller with no city_state row on
--     that node (no city to hire for), and re-appointing the manager already
--     seated (a second fee for the same seat is a double charge, not a hire).
--     A 0-pay call (Remove) moves no money and only ever UPDATEs the caller's
--     own city_state rows.
--
-- NET EFFECT ON THE WALLET LEDGER: hire writes −fee on the payer; claim writes
-- +fee on the payee. Summed across both parties: 0. Proven on live in a
-- rolled-back DO block before this file was filed (see the builder notes).
--
-- Idempotent: every statement is re-runnable. RLS for the table is in this
-- file. Ends with a verify query.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.city_mayor_pay add column if not exists funded boolean not null default false;

alter table public.city_mayor_pay enable row level security;

-- Client writes: none. The only writers are the two definer functions below.
drop policy if exists cmp_upd on public.city_mayor_pay;
drop policy if exists cmp_ins on public.city_mayor_pay;
drop policy if exists cmp_del on public.city_mayor_pay;
drop policy if exists cmp_sel on public.city_mayor_pay;
create policy cmp_sel on public.city_mayor_pay
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete, truncate, references, trigger on public.city_mayor_pay from anon, authenticated;
revoke all on public.city_mayor_pay from anon;
grant select on public.city_mayor_pay to authenticated;

-- The return type changes (void -> jsonb) and a parameter is added, which
-- CREATE OR REPLACE cannot do. Old deployed clients call with the four named
-- arguments; PostgREST still resolves those to this function because
-- p_node_id has a default.
drop function if exists public.city_set_mayor(uuid, text, integer, text);
drop function if exists public.city_set_mayor(uuid, text, integer, text, text);

-- ⚠ THE LIVE FUNCTION IS ALSO DEAD TODAY. It upserts city_state
--   ON CONFLICT (user_id), but the key of city_state has been
--   (user_id, node_id) since the one-row-per-player collapse was fixed (a
--   player owns several cities), so every live call raises "no unique or
--   exclusion constraint matching the ON CONFLICT specification" before it
--   reaches the pay insert. That is the ONLY reason the faucet is not flowing
--   right now; fixing the upsert alone would have switched it back on. This
--   version never INSERTs a city_state row (a hire is not a way to create a
--   city): it UPDATEs the caller's own row for p_node_id, and a paid hire must
--   name one that exists.
create function public.city_set_mayor(p_mayor_id uuid, p_mayor_name text,
                                      p_pay integer default 0, p_from text default null,
                                      p_node_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_amt   bigint := least(100000, greatest(0, coalesce(p_pay, 0)));
  v_paid  boolean;
  v_found boolean;
  v_prev  uuid;
  v_take  jsonb;
  v_id    uuid;
  v_n     int;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  v_paid := p_mayor_id is not null and v_amt > 0;

  if v_paid then
    if p_mayor_id = v_uid then raise exception 'you cannot hire yourself'; end if;
    if not exists (select 1 from auth.users u where u.id = p_mayor_id) then
      raise exception 'no such player';
    end if;
    if p_node_id is null then raise exception 'which city? a paid hire must name the node'; end if;
    select true, c.mayor_id into v_found, v_prev
      from public.city_state c
     where c.user_id = v_uid and c.node_id = p_node_id
       for update;
    if not coalesce(v_found, false) then raise exception 'you have no city on that node to hire for'; end if;
    if v_prev is not distinct from p_mayor_id then
      raise exception 'that Node Manager is already appointed';
    end if;
  end if;

  -- Own rows only (user_id = auth.uid()). Without a node, a Remove clears
  -- the column on every city the caller owns, which is what the old one-row
  -- upsert meant.
  update public.city_state c
     set mayor_id = p_mayor_id, mayor_name = left(p_mayor_name, 60), updated_at = now()
   where c.user_id = v_uid and (p_node_id is null or c.node_id = p_node_id);
  get diagnostics v_n = row_count;

  if not v_paid then
    return jsonb_build_object('ok', true, 'paid', 0, 'cities', v_n);
  end if;

  -- The payer's side FIRST: a short wallet raises here and the appointment
  -- above rolls back with it.
  v_take := public._ct_cinder_take(v_uid, v_amt, 'Node Manager hiring pay (escrow)');

  insert into public.city_mayor_pay (user_id, amount, from_name, funded)
  values (p_mayor_id, v_amt, left(coalesce(p_from, ''), 60), true)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'paid', v_amt, 'pay_id', v_id,
                            'cinder', (v_take->>'balance')::bigint,
                            'wallet_seq', (v_take->>'wallet_seq')::bigint);
end $$;

create or replace function public.city_mayor_pay_claim()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_total bigint;
  v_n     int;
  v_from  text;
  v_give  jsonb;
begin
  if v_uid is null then raise exception 'sign in first'; end if;

  with c as (
    update public.city_mayor_pay p
       set claimed = true
     where p.user_id = v_uid and p.funded and not p.claimed and p.amount > 0
     returning p.amount, p.from_name, p.created_at
  )
  select coalesce(sum(amount), 0), count(*),
         (array_agg(from_name order by created_at desc))[1]
    into v_total, v_n, v_from
    from c;

  if v_total <= 0 then
    return jsonb_build_object('claimed', 0, 'rows', 0);
  end if;

  v_give := public._ct_cinder_give(v_uid, v_total,
              'Node Manager hiring pay (' || v_n || ' payment' || case when v_n = 1 then '' else 's' end || ')');

  return jsonb_build_object('claimed', v_total, 'rows', v_n, 'from_name', v_from,
                            'credit_cinder', v_total,
                            'balance', (v_give->>'balance')::bigint);
end $$;

revoke all on function public.city_set_mayor(uuid, text, integer, text, text) from public, anon;
revoke all on function public.city_mayor_pay_claim()                    from public, anon;
grant execute on function public.city_set_mayor(uuid, text, integer, text, text) to authenticated;
grant execute on function public.city_mayor_pay_claim()                    to authenticated;

commit;

-- --- VERIFY. Expect rls_t = t, write_policies_expect_0 = 0, sel_policy_own_t = t,
--     client_insert_f = f, client_update_f = f, client_delete_f = f,
--     anon_select_f = f, funded_col_t = t, set_mayor_debits_t = t,
--     claim_fn_t = t, anon_exec_f = f, historical_rows_expect_5 = 5,
--     historical_sum_expect_2500 = 2500 (on the day this was written).
select
  (select relrowsecurity from pg_class where oid = 'public.city_mayor_pay'::regclass)          as rls_t,
  (select count(*) from pg_policies where tablename = 'city_mayor_pay' and cmd <> 'SELECT')   as write_policies_expect_0,
  (select bool_and(qual = '(user_id = auth.uid())') from pg_policies
    where tablename = 'city_mayor_pay' and cmd = 'SELECT')                                     as sel_policy_own_t,
  has_table_privilege('authenticated', 'public.city_mayor_pay', 'INSERT')                      as client_insert_f,
  has_table_privilege('authenticated', 'public.city_mayor_pay', 'UPDATE')                      as client_update_f,
  has_table_privilege('authenticated', 'public.city_mayor_pay', 'DELETE')                      as client_delete_f,
  has_table_privilege('anon', 'public.city_mayor_pay', 'SELECT')                               as anon_select_f,
  exists (select 1 from information_schema.columns where table_schema = 'public'
            and table_name = 'city_mayor_pay' and column_name = 'funded')                      as funded_col_t,
  (select position('_ct_cinder_take' in pg_get_functiondef('public.city_set_mayor(uuid,text,integer,text,text)'::regprocedure)) > 0)
                                                                                               as set_mayor_debits_t,
  (to_regprocedure('public.city_mayor_pay_claim()') is not null)                               as claim_fn_t,
  has_function_privilege('anon', 'public.city_mayor_pay_claim()', 'EXECUTE')                   as anon_exec_f,
  (select count(*) from public.city_mayor_pay where not funded)                                as historical_rows_expect_5,
  (select coalesce(sum(amount), 0) from public.city_mayor_pay where not funded)                as historical_sum_expect_2500;
