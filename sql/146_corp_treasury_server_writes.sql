-- ════════════════════════════════════════════════════════════════════════════
-- 146 · CORP TREASURY: A CREDIT IS WRITTEN BY THE SERVER OR NOT AT ALL
--       (draft, NOT applied)
--
-- THE HOLE. Live policy (sql/046, still in place 2026-09-17):
--     ct_ins  for insert to authenticated
--             with check (user_id = auth.uid() and is_corp_member(corp_id, auth.uid()))
-- Nothing bounds `amount` or `kind`. corp_members.cm_ins lets any player join
-- any corporation (sql/142 header, sql/143 header), so ANY signed-in player
-- could run, from the console:
--     Cloud.client.from('corp_treasury').insert({corp_id, user_id: me,
--                                                amount: 16000000, kind: 'deposit'})
-- and the corporation's treasury grew by 16M without one Cinder leaving any
-- wallet. The client paid the depositor's side (spendGems) in a SEPARATE step
-- the server never saw, so the two halves of a deposit were never tied
-- together. The treasury is then spent on construction and operations
-- (index.html nodeEstablish, corpTreasuryDeposit, _opTreasuryRow), so forged
-- rows are real purchasing power. It also reaches sql/142: a forged
-- kind='node_manager_fee' row under the forger's own user_id inflates
-- corp_node_manager_list().corp_fees_total, the number a corporation reads to
-- decide what its Node Manager contracts are worth.
--
-- THE RULE THIS FILE MAKES STRUCTURAL:
--   A POSITIVE corp_treasury row exists only because a SECURITY DEFINER
--   function wrote it in the same transaction as the thing that pays for it.
--     · deposit          corp_treasury_deposit()   — takes the Cinder from the
--                        depositor's canonical wallet (_ct_cinder_take →
--                        user_progress + wallet_ledger) in the same statement
--                        sequence as the credit. Short wallet → nothing moves.
--     · refund           corp_treasury_refund()    — the amount is READ from
--                        the debit row it reverses, never taken from the
--                        client, at most once per debit, and refused once the
--                        debit's filing landed.
--     · op_revenue       corp_treasury_op_revenue() — see its header: still a
--                        client-computed figure, now bounded (ownership, one
--                        settlement per op per 11h, a derived hourly ceiling).
--                        SUPERSEDED by sql/151 corp_op_collect() (server-
--                        computed); apply 146 then 151. 151 revokes this
--                        function from clients, and the tail of this file
--                        keeps it revoked on a re-run.
--     · node_manager_fee city_owner_ledger_apply()  (sql/142 / sql/145) only.
--     · staff_wage/wage  corp_staff_payroll / corp_pay_member_from_treasury —
--                        already SECURITY DEFINER, unchanged.
--   A CLIENT may insert only a NEGATIVE row of a spend kind
--   (construction / op_salary / op_startup). Spending your corp's treasury on
--   its behalf mints nothing; debit-then-refund nets exactly zero because the
--   refund is the debit's own amount.
--
-- TWO LAYERS, ON PURPOSE:
--   1. ct_ins (RLS) — the documented boundary.
--   2. _ct_client_write_guard (trigger) — refuses the same rows when the
--      writer is a client role, WHATEVER the policy says. This exists because
--      index.html still carries FOUNDATION_RESERVE_SQL, a legacy setup string
--      that does `drop policy if exists ct_ins; create policy ct_ins ... with
--      check (user_id = auth.uid())` — an admin re-running "Reserve setup"
--      would silently reopen the hole. The trigger survives that. It keys off
--      current_user: a PostgREST request runs as `authenticated`/`anon`; a
--      SECURITY DEFINER function owned by postgres runs as `postgres`, which
--      is exactly the "server wrote it" test we want. (An INVOKER function
--      called by a client still runs as `authenticated` and is refused — also
--      what we want.)
--
-- REJECTED:
--   · A GUC set by city_owner_ledger_apply to mark node_manager_fee rows.
--     It would mean editing sql/142/145 (other lanes) and a missed set_config
--     would roll back every Node Manager payout. The current_user test already
--     proves "written by a definer function", and the verify block below
--     checks that city_owner_ledger_apply is the only definer body that names
--     the kind.
--   · Debits through an RPC with a balance check. Worth doing, but a client
--     negative row is a spend of the corp's OWN money; it mints nothing. Who
--     may spend (cm_ins lets strangers join) is the membership follow-up
--     sql/143 already names, and is out of this file's lane.
--   · Clamping the treasury at zero anywhere. Balance = sum(amount), unclamped
--     (index.html corpTreasuryFetch explains why).
--
-- COLUMN CHANGE: one nullable `ref_id uuid`. Additive, no default, no
-- rewrite; every client read names its columns explicitly (corpTreasuryFetch)
-- so nothing that reads the table changes shape. For a refund it is the debit
-- it reverses; for op_revenue it is the corp_operations row that earned it.
--
-- Idempotent and re-runnable. Ends with a verify query. Requires sql/046
-- (is_corp_member) and sql/023-era _ct_cinder_take.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.corp_treasury add column if not exists ref_id uuid;

-- A debit can be reversed once. The unique index is the guarantee; the
-- function's own check only produces a readable message first.
create unique index if not exists corp_treasury_refund_once
  on public.corp_treasury (ref_id) where kind = 'refund';
create index if not exists corp_treasury_ref
  on public.corp_treasury (ref_id, kind, created_at desc) where ref_id is not null;

-- ── layer 1: RLS ─────────────────────────────────────────────────────────────
alter table public.corp_treasury enable row level security;

drop policy if exists ct_ins on public.corp_treasury;
create policy ct_ins on public.corp_treasury
  for insert to authenticated
  with check (
        user_id = auth.uid()
    and public.is_corp_member(corp_id, auth.uid())
    and amount < 0
    and kind in ('construction', 'op_salary', 'op_startup')
    and ref_id is null
  );
-- ct_sel (sql/046, members read) is left exactly as it is. No update/delete
-- policy exists and none is added: the ledger is append-only.

-- The grants were still ALL for the client roles; with no policy they were
-- refused anyway, but an append-only ledger should not depend on a missing
-- policy to stay append-only.
revoke update, delete, truncate on public.corp_treasury from anon, authenticated;

-- ── layer 2: the trigger ─────────────────────────────────────────────────────
create or replace function public._ct_client_write_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Server-side writers (definer functions owned by postgres, service_role,
  -- the SQL editor) are not policed here.
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'corp_treasury is append-only' using errcode = '42501';
  end if;
  if new.amount is null or new.amount >= 0 then
    raise exception 'a corporation treasury credit is written by the server (use corp_treasury_deposit)'
      using errcode = '42501';
  end if;
  if new.kind is null or new.kind not in ('construction', 'op_salary', 'op_startup') then
    raise exception 'treasury kind % is server-only', coalesce(new.kind, 'null')
      using errcode = '42501';
  end if;
  if new.ref_id is not null then
    raise exception 'ref_id is set by the server' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists ct_client_write_guard on public.corp_treasury;
create trigger ct_client_write_guard
  before insert or update or delete on public.corp_treasury
  for each row execute function public._ct_client_write_guard();

-- ── deposit: the wallet and the treasury move in ONE transaction ────────────
-- p_bank = the Bank of Ethos transfer (boeCorpDeposit). It is the only path
-- with a fee, and it only funds a corporation the caller FOUNDED (that
-- function's header explains the incident). The fee is ceil(1%) with a floor
-- of 1, exactly BOE_CORP_FEE_PCT in index.html; the client passes the flag,
-- never the fee, so a forged call cannot pick its own fee.
-- The GROSS leaves the wallet; the treasury receives gross − fee.
create or replace function public.corp_treasury_deposit(
  p_corp_id uuid,
  p_amount  bigint,
  p_bank    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_bank_fee_pct constant numeric := 0.01;   -- = BOE_CORP_FEE_PCT (index.html)
  v_uid   uuid := auth.uid();
  v_amt   bigint := floor(coalesce(p_amount, 0));
  v_corp  record;
  v_fee   bigint := 0;
  v_net   bigint;
  v_take  jsonb;
  v_id    uuid;
  v_bal   numeric;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_amt <= 0 then raise exception 'amount must be greater than zero' using errcode = '22023'; end if;

  select id, name, founder_id into v_corp from public.corporations where id = p_corp_id;
  if v_corp.id is null then raise exception 'no such corporation' using errcode = 'P0002'; end if;
  if not public.is_corp_member(p_corp_id, v_uid) then
    raise exception 'you are not a member of that corporation' using errcode = '42501';
  end if;
  if coalesce(p_bank, false) then
    if v_corp.founder_id is distinct from v_uid then
      raise exception 'the bank only funds a corporation you founded' using errcode = '42501';
    end if;
    v_fee := greatest(1, ceil(v_amt * c_bank_fee_pct))::bigint;
  end if;
  v_net := v_amt - v_fee;
  if v_net <= 0 then
    raise exception 'too small to move: the fee would take all of it' using errcode = '22023';
  end if;

  -- Takes the GROSS. Raises 'not enough Cinder' (and moves nothing) when the
  -- canonical wallet is short; that aborts the whole call, so no credit row
  -- can exist without its debit.
  v_take := public._ct_cinder_take(v_uid, v_amt,
              case when coalesce(p_bank, false)
                   then 'Bank of Ethos → ' || v_corp.name || ' Treasury (' || v_fee || ' fee)'
                   else 'Deposit → ' || v_corp.name || ' Treasury' end);

  insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
  values (p_corp_id, v_uid, v_net, 'deposit',
          case when coalesce(p_bank, false)
               then 'Bank of Ethos transfer — ' || v_amt || ' sent, ' || v_fee || ' fee (1%)'
               else 'member deposit' end)
  returning id into v_id;

  select coalesce(sum(amount), 0) into v_bal from public.corp_treasury where corp_id = p_corp_id;

  -- Same three numbers wallet_charge hands back, so the client adopts them
  -- with _applyServerCharge and never mutates Profile.gems a second time.
  return jsonb_build_object(
    'id',               v_id,
    'gross',            v_amt,
    'fee',              v_fee,
    'net',              v_net,
    'new_balance',      (v_take->>'balance')::bigint,
    'wallet_seq',       (v_take->>'wallet_seq')::bigint,
    'tax_amount',       0,
    'treasury_balance', floor(v_bal));
end $$;

-- ── refund: the amount comes from the debit, never from the caller ──────────
-- Used when a treasury-funded construction or operation founding FAILED after
-- its debit landed. Refused when:
--   · the debit is not the caller's, not a refundable spend kind, or older
--     than an hour (the client refunds within the same click);
--   · it was already refunded (also the unique index);
--   · the filing it paid for LANDED. For each kind the number of filings made
--     since the debit must be below the number of still-open debits of that
--     kind since the debit — so two concurrent builds, one filed and one
--     failed, still refund the failed one, but a player cannot keep the node
--     AND take the Cinder back.
create or replace function public.corp_treasury_refund(
  p_debit_id uuid,
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_d      public.corp_treasury%rowtype;
  v_filed  bigint := 0;
  v_open   bigint := 0;
  v_id     uuid;
  v_bal    numeric;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;

  select * into v_d from public.corp_treasury where id = p_debit_id for update;
  if v_d.id is null then raise exception 'no such treasury debit' using errcode = 'P0002'; end if;
  if v_d.user_id is distinct from v_uid then
    raise exception 'that debit is not yours to refund' using errcode = '42501';
  end if;
  if v_d.amount >= 0 or v_d.kind not in ('construction', 'op_startup') then
    raise exception 'only a construction or startup debit can be refunded' using errcode = '22023';
  end if;
  if not public.is_corp_member(v_d.corp_id, v_uid) then
    raise exception 'you are not a member of that corporation' using errcode = '42501';
  end if;
  if v_d.created_at < now() - interval '1 hour' then
    raise exception 'that debit is too old to refund' using errcode = '22023';
  end if;
  if exists (select 1 from public.corp_treasury r where r.kind = 'refund' and r.ref_id = v_d.id) then
    raise exception 'that debit was already refunded' using errcode = '23505';
  end if;

  select count(*) into v_open
    from public.corp_treasury x
   where x.corp_id = v_d.corp_id and x.user_id = v_uid and x.kind = v_d.kind
     and x.amount < 0 and x.created_at >= v_d.created_at
     and not exists (select 1 from public.corp_treasury r where r.kind = 'refund' and r.ref_id = x.id);

  if v_d.kind = 'construction' then
    -- nodeEstablish stamps meta.funded = 'treasury'; a personally-funded
    -- node the same player files meanwhile is not this debit's filing.
    select count(*) into v_filed
      from public.economy_nodes n
     where n.corp_id = v_d.corp_id and n.owner_id = v_uid
       and n.created_at >= v_d.created_at
       and coalesce(n.meta->>'funded', '') = 'treasury';
  else
    select count(*) into v_filed
      from public.corp_operations o
     where o.corp_id = v_d.corp_id and o.created_at >= v_d.created_at;
  end if;
  if v_filed >= v_open then
    raise exception 'that debit paid for a filing that landed; nothing to refund' using errcode = '22023';
  end if;

  insert into public.corp_treasury (corp_id, user_id, amount, kind, note, ref_id)
  values (v_d.corp_id, v_uid, -v_d.amount, 'refund',
          left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), coalesce(v_d.note, 'refund')), 200),
          v_d.id)
  returning id into v_id;

  select coalesce(sum(amount), 0) into v_bal from public.corp_treasury where corp_id = v_d.corp_id;
  return jsonb_build_object('id', v_id, 'amount', -v_d.amount, 'treasury_balance', floor(v_bal));
end $$;

-- ── op_revenue: still client-computed, now BOUNDED ──────────────────────────
-- The revenue of a corp operation is _opComputed() in index.html: workers ×
-- rate × live exchange multiplier × AI standing × site efficiency × terroir ×
-- hours. The market and terroir inputs live in the client, so the server
-- cannot reproduce the exact figure (porting it is an owner decision, reported
-- with this file). What the server CAN prove:
--   · the operation exists and belongs to a corporation the caller is in;
--   · one settlement per operation per 11h (client cooldown OP_COLLECT_CD_MS is
--     12h; the hour of slack absorbs device clock skew);
--   · amount ≤ c_rev_ceiling_per_hr × hours since that op's previous
--     settlement, hours capped at 36 (OP_ACCRUAL_CAP_H).
-- c_rev_ceiling_per_hr is DERIVED, not tuned: the largest, over OPS_ECON, of
--     maxWorkers × ratePerWorkerHr × OP_SITE_EFF_MAX 1.45
--       × (only for an op that yields something: CX_MUL_MAX 2.2
--          × AI_TRADE_MUL_MAX 1.15 × RICH yieldMul 1.60 × SEAM_BONUS_MUL 3)
-- (cxYieldMul, _aiYieldTradeMul and opGrossMul all return exactly 1 for an
-- op with no yields — rail, bank, dojo). Largest today: construction,
-- 25 × 800 × 1.45 × 2.2 × 1.15 × 4.8 = 352,176 per hour, 12.7M per 36 h.
-- Live, the largest op_revenue row ever written is 821,675 (rail, whose own
-- ceiling is 104,400/h — about 8 h of accrual). This turns "any number" into
-- a rate. _corptreasury_smoke.mjs recomputes it from source and fails if the two
-- drift. ⚠ An admin override (Forge/Catalog opsEcon) that raises a rate above
-- that product will be refused here — raise the constant with it.
create or replace function public.corp_treasury_op_revenue(
  p_op_id  uuid,
  p_amount bigint,
  p_note   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_rev_ceiling_per_hr constant numeric := 352176;   -- derived; see header
  c_accrual_cap_h      constant numeric := 36;
  c_cooldown           constant interval := interval '11 hours';
  v_uid   uuid := auth.uid();
  v_amt   bigint := floor(coalesce(p_amount, 0));
  v_op    record;
  v_last  timestamptz;
  v_hrs   numeric;
  v_cap   bigint;
  v_id    uuid;
  v_bal   numeric;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_amt <= 0 then raise exception 'amount must be greater than zero' using errcode = '22023'; end if;

  -- FOR UPDATE serialises two devices settling the same operation.
  select id, corp_id, op_type, created_at into v_op
    from public.corp_operations where id = p_op_id for update;
  if v_op.id is null then raise exception 'no such operation' using errcode = 'P0002'; end if;
  if not public.is_corp_member(v_op.corp_id, v_uid) then
    raise exception 'you are not a member of that corporation' using errcode = '42501';
  end if;

  -- Rows written before this file have no ref_id; they are matched by the
  -- note the client has always written ('<op_type> production').
  select max(t.created_at) into v_last
    from public.corp_treasury t
   where t.corp_id = v_op.corp_id and t.kind = 'op_revenue'
     and (t.ref_id = v_op.id or (t.ref_id is null and t.note = v_op.op_type || ' production'));
  if v_last is not null and v_last > now() - c_cooldown then
    raise exception 'this operation was settled % ago', date_trunc('minute', now() - v_last)
      using errcode = '22023';
  end if;

  v_hrs := least(c_accrual_cap_h, greatest(0,
             extract(epoch from (now() - coalesce(v_last, v_op.created_at, now() - interval '36 hours'))) / 3600.0));
  v_cap := ceil(c_rev_ceiling_per_hr * v_hrs)::bigint;
  if v_amt > v_cap then
    raise exception 'revenue % exceeds what this operation can earn in % h (%)', v_amt, round(v_hrs, 2), v_cap
      using errcode = '22023';
  end if;

  insert into public.corp_treasury (corp_id, user_id, amount, kind, note, ref_id)
  values (v_op.corp_id, v_uid, v_amt, 'op_revenue',
          left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_op.op_type || ' production'), 200),
          v_op.id)
  returning id into v_id;

  select coalesce(sum(amount), 0) into v_bal from public.corp_treasury where corp_id = v_op.corp_id;
  return jsonb_build_object('id', v_id, 'amount', v_amt, 'cap', v_cap, 'treasury_balance', floor(v_bal));
end $$;

revoke all on function public.corp_treasury_deposit(uuid, bigint, boolean)  from public, anon;
revoke all on function public.corp_treasury_refund(uuid, text)              from public, anon;
revoke all on function public.corp_treasury_op_revenue(uuid, bigint, text)  from public, anon;
revoke all on function public._ct_client_write_guard()                      from public, anon, authenticated;
grant execute on function public.corp_treasury_deposit(uuid, bigint, boolean) to authenticated;
grant execute on function public.corp_treasury_refund(uuid, text)             to authenticated;
grant execute on function public.corp_treasury_op_revenue(uuid, bigint, text) to authenticated;

-- sql/151 (server-computed op revenue) supersedes the client-figure path above
-- and revokes it. Re-running THIS file after 151 must not hand it back, so the
-- grant is taken away again whenever 151's corp_op_collect exists. Before 151
-- this block does nothing and the bounded client path stays the live one.
do $$
begin
  if to_regprocedure('public.corp_op_collect(uuid,numeric)') is not null then
    execute 'revoke all on function public.corp_treasury_op_revenue(uuid, bigint, text) from public, anon, authenticated';
  end if;
end $$;

commit;

-- --- VERIFY. Expect rls_t = t, ct_ins_bounded_t = t, write_policies_expect_1 = 1,
--     trigger_t = t, fns_expect_3 = 3, client_update_expect_false = f,
--     client_delete_expect_false = f, fee_writers_expect_1 = 1,
--     refund_once_index_t = t.
select
  (select relrowsecurity from pg_class where oid = 'public.corp_treasury'::regclass) as rls_t,
  (select with_check ~ 'amount < ' and with_check ~ 'op_startup' and with_check !~ 'deposit'
     from pg_policies where tablename = 'corp_treasury' and policyname = 'ct_ins')      as ct_ins_bounded_t,
  (select count(*) from pg_policies where tablename = 'corp_treasury' and cmd <> 'SELECT') as write_policies_expect_1,
  exists (select 1 from pg_trigger where tgrelid = 'public.corp_treasury'::regclass
            and tgname = 'ct_client_write_guard' and not tgisinternal)                 as trigger_t,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('corp_treasury_deposit', 'corp_treasury_refund', 'corp_treasury_op_revenue'))   as fns_expect_3,
  has_table_privilege('authenticated', 'public.corp_treasury', 'UPDATE')                as client_update_expect_false,
  has_table_privilege('authenticated', 'public.corp_treasury', 'DELETE')                as client_delete_expect_false,
  -- Before sql/142 is applied this reads 0; after, 1 (city_owner_ledger_apply).
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'corp_node_manager_list'
      and position('''node_manager_fee''' in pg_get_functiondef(p.oid)) > 0)            as fee_writers_expect_1,
  (to_regclass('public.corp_treasury_refund_once') is not null)                          as refund_once_index_t;
