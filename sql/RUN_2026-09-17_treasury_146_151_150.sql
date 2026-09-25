-- ════════════════════════════════════════════════════════════════════
-- RUN FILE 2026-09-17 — paste into the Supabase SQL editor (ktsiasyjusesawtrwrjc)
-- Order matters: 146, then 151 (same sitting), then 150.
-- Each part is its own transaction with its own verify query at the end.
-- 150 reverses the THREE certain unbacked deposits only; the uncertain
-- Talon Forge row is present but commented out. Skip PART 3 if you have not
-- decided on the reversals yet.
-- ════════════════════════════════════════════════════════════════════

-- ─── PART 1 of 3 · sql/146_corp_treasury_server_writes.sql ───

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


-- ─── PART 2 of 3 · sql/151_op_revenue_server.sql ───

-- ════════════════════════════════════════════════════════════════════════════
-- 151 · A CORPORATION'S BUSINESS REVENUE IS CALCULATED ON THE SERVER
--       (draft, NOT applied)
-- Project: ktsiasyjusesawtrwrjc
--
-- OWNER DECISION (2026-09-17): "a corporation's business revenue should be
-- calculated on the server".
--
-- ORDER: sql/146 FIRST, then this file, in the same sitting.
--   · 151 needs 146's corp_treasury.ref_id column and its client-write guard
--     (without 146 a client can still insert its own op_revenue row directly,
--     and server-computed revenue would be decoration).
--   · 146 on its own still lets the CLIENT name the op_revenue figure
--     (corp_treasury_op_revenue, bounded at up to ~12.7M per settlement). 151
--     replaces that: corp_op_collect() computes the figure, and this file
--     REVOKES execute on corp_treasury_op_revenue from clients, so after 151
--     the only way an op_revenue row is written is the formula below.
--   · 146 was edited for this (its tail): re-running 146 after 151 would
--     re-grant corp_treasury_op_revenue, so 146 now revokes it again whenever
--     corp_op_collect exists. Nothing else in 146 changed.
--
-- THE CLIENT FORMULA THIS REPLACES (index.html _opComputed / _opSettle):
--   w          = min(maxWorkers, npcWorkers + agreedStaff)
--   hrs        = min(36, now − meta.lastCollect)
--   grossPerHr = w × ratePerWorkerHr × mktMul × stdMul × supply × siteEff × terroirGross
--   salary     = floor(npcWorkers × salaryPerWorkerHr × hrs)
--   gross      = floor(grossPerHr × hrs);  net = max(0, gross − salary)
--   treasury short of salary → pay what is there, gross halved.
--
-- WHAT THE SERVER USES FOR EACH FACTOR, AND WHY:
--   ratePerWorkerHr / salaryPerWorkerHr / maxWorkers
--              → public.corp_op_econ, seeded from OPS_ECON's values today
--                (card_catalog.moves.__ops_econ__ is {} live, so there is no
--                published override to carry over). Admin-only writes.
--   workers    → corp_operations.workers (NPC) capped at max_workers, plus
--                corp_staff rows with status 'agreed', total capped at
--                max_workers. ⚠ The client did NOT cap the NPC count used for
--                salary; the server does, so a hand-written workers=10000 can
--                neither earn nor bill beyond the cap.
--   hrs        → server clock (see THE CLOCK), capped at 36 (OP_ACCRUAL_CAP_H).
--   mktMul     → 1.0. A server-readable table exists (cx_prices.current_px),
--                but it is NOT a trustworthy source: every signed-in client
--                may upsert any price into it (live policy cxp_write ALL true;
--                sql/143 narrows this only in draft) and the BASE price the
--                multiplier divides by lives only in the client
--                (_cxBasePrice). Reading it would move the forgeable input,
--                not remove it. OWNER DECISION to revisit once prices are
--                server-written.
--   stdMul     → 1.0 (AI standing, _aiYieldTradeMul, client-only state).
--   terroir    → 1.0 (window.MythicTerroir, client-only survey state).
--   supply     → p_supply from the client, clamped to [0, 1]. The input
--                stockpile is the player's local inventory, which the server
--                does not hold. A lying client can only claim 1, which is the
--                ceiling the formula already allows — it cannot mint above it.
--   siteEff    → corp_operations.meta.site.eff clamped to [1, 1.45]
--                (OP_SITE_EFF_MIN/MAX), exactly as _opSiteEff reads it.
--                ⚠ meta is writable by the founder/CEO (cop_upd), so this is
--                "at most +45%", the same trust the workers column already has.
--   → Net effect vs the client: ops with favourable market/standing/terroir
--     earn LESS, ops in a crashed market or on barren ground earn MORE than
--     the client used to show. Reported to the owner with this file.
--
-- THE CLOCK. meta.lastCollect is client-writable (cop_upd lets the founder/CEO
--   update meta), so a server clock that trusted it could be rewound 36 h
--   before every collect. public.corp_op_clock holds the server's own stamp and
--   has NO client write policy. The accrual start is the LATEST of:
--     corp_op_clock.last_collect_at, meta.lastCollect, the op's last op_revenue
--     row, created_at — clamped to now.
--   "Latest" means a rewind of meta can never add hours; a forward-set meta can
--   only cost its writer. Old cached clients that still claim meta directly
--   also move the start forward, so they cannot be paid twice either.
--
-- DOUBLE COLLECT. Two layers:
--   1. SELECT … FOR UPDATE on the corp_operations row serialises two tabs.
--   2. COMPARE-AND-SET on corp_op_clock: the stamp is advanced only where it
--      still equals the value this call read; zero rows → 40001, nothing
--      written (the whole call rolls back).
--   The second of two immediate collects measures ~0 h and pays ~0. There is
--   deliberately NO cooldown refusal: accrual is proportional to time and each
--   figure is floored, so collecting often can never pay more than collecting
--   rarely. The 12 h cooldown stays a client-side pacing rule.
--
-- WHO. is_corp_member(corp_id, auth.uid()) (sql/149 made membership a real
--   boundary) AND founder/owner/CEO — the exact set cop_upd already demands for
--   the client claim today. Membership alone would WIDEN who may collect
--   (every member, and the collector receives the op's resource yield on their
--   own device). corp_members.role is frozen against client writes by sql/149.
--
-- WHAT IS WRITTEN (all by this definer, so 146's guard stands aside):
--   · one op_salary row  −salary_paid   (if > 0), ref_id = op id
--   · one op_revenue row +net           (if > 0), ref_id = op id
--   · corp_op_clock advanced; corp_operations.meta.lastCollect = now (ms) so
--     the client's cooldown display keeps working.
--   Player staff are still paid by corp_staff_payroll (sql/117), which the
--   client calls right after, unchanged. Nothing else is written. No balance
--   column exists or is updated; balance = sum(amount).
--
-- REJECTED:
--   · Porting cxYieldMul over cx_prices — see mktMul above.
--   · Keeping corp_treasury_op_revenue callable as a fallback — it is the
--     client-figure path this file exists to close.
--   · Trusting meta.lastCollect alone — see THE CLOCK.
--
-- Idempotent and re-runnable (the tuning seed is ON CONFLICT DO NOTHING, so a
-- re-run never undoes an admin retune). Ends with a verify query.
-- Requires: sql/046 is_corp_member, sql/117 corp_staff, sql/143-era is_admin(),
--           sql/146 (ref_id + guard).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── tuning: the server's copy of OPS_ECON's money columns ──────────────────
create table if not exists public.corp_op_econ (
  op_type             text primary key,
  rate_per_worker_hr  numeric not null check (rate_per_worker_hr >= 0),
  salary_per_worker_hr numeric not null check (salary_per_worker_hr >= 0),
  max_workers         integer not null check (max_workers >= 0),
  updated_at          timestamptz not null default now()
);

-- Values = OPS_ECON in public/index.html on 2026-09-17. _opserver_smoke.mjs
-- re-reads OPS_ECON and fails if this list drifts from it.
insert into public.corp_op_econ (op_type, rate_per_worker_hr, salary_per_worker_hr, max_workers) values
  ('mining',         900,  220, 12),
  ('oil',           1300,  320, 10),
  ('construction',   800,  200, 25),
  ('medical',       1000,  260, 10),
  ('agri',           700,  170, 14),
  ('research',      1700,  430,  8),
  ('smuggling',     1900,  360,  8),
  ('salvage',        650,  150, 14),
  ('trashcrusher',   660,  155, 14),
  ('gas',            850,  200, 12),
  ('cars',          1100,  280, 10),
  ('fishing',        750,  180, 14),
  ('cannery',        700,  170, 10),
  ('cardshop',       500,  120,  6),
  ('warehouse',      420,  130, 12),
  ('dojo',           450,  110,  6),
  ('genelab',       1200,  300,  8),
  ('restaurant',     780,  190, 10),
  ('transport',     1000,  300, 10),
  ('feed',           900,  240, 10),
  ('bank',          1500,  400,  8),
  ('bus',           1400,  520, 16),
  ('rail',          3600,  900, 20),
  ('weaponsmith',   1300,  320,  8)
on conflict (op_type) do nothing;

alter table public.corp_op_econ enable row level security;

-- Tuning is not secret: the Just Business cards print these numbers.
drop policy if exists coe_sel on public.corp_op_econ;
create policy coe_sel on public.corp_op_econ
  for select to authenticated
  using (true);
-- Admins only, and every write policy says so on both sides.
drop policy if exists coe_ins on public.corp_op_econ;
create policy coe_ins on public.corp_op_econ
  for insert to authenticated
  with check (public.is_admin());
drop policy if exists coe_upd on public.corp_op_econ;
create policy coe_upd on public.corp_op_econ
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
drop policy if exists coe_del on public.corp_op_econ;
create policy coe_del on public.corp_op_econ
  for delete to authenticated
  using (public.is_admin());

revoke all on public.corp_op_econ from anon;
revoke truncate on public.corp_op_econ from authenticated;

-- ── the server clock ────────────────────────────────────────────────────────
create table if not exists public.corp_op_clock (
  op_id           uuid primary key references public.corp_operations(id) on delete cascade,
  corp_id         uuid not null,
  last_collect_at timestamptz not null,
  collects        bigint not null default 0,
  updated_at      timestamptz not null default now()
);

alter table public.corp_op_clock enable row level security;

-- Members may read their own corporation's clocks. There is NO write policy:
-- only corp_op_collect (definer) writes here.
drop policy if exists coc_sel on public.corp_op_clock;
create policy coc_sel on public.corp_op_clock
  for select to authenticated
  using (public.is_corp_member(corp_id, auth.uid()));

revoke all on public.corp_op_clock from anon;
revoke insert, update, delete, truncate on public.corp_op_clock from authenticated;

-- ── the collect ─────────────────────────────────────────────────────────────
create or replace function public.corp_op_collect(
  p_op_id  uuid,
  p_supply numeric default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_accrual_cap_h constant numeric := 36;     -- = OP_ACCRUAL_CAP_H
  c_site_min      constant numeric := 1;      -- = OP_SITE_EFF_MIN
  c_site_max      constant numeric := 1.45;   -- = OP_SITE_EFF_MAX
  c_mkt_mul       constant numeric := 1;      -- no trustworthy server source; see header
  v_uid     uuid := auth.uid();
  v_now     timestamptz := now();
  v_corp    uuid;
  v_op      record;
  v_econ    public.corp_op_econ%rowtype;
  v_clock   public.corp_op_clock%rowtype;
  v_meta_ts timestamptz;
  v_rev_ts  timestamptz;
  v_prev    timestamptz;
  v_hrs     numeric;
  v_supply  numeric;
  v_site    numeric := 1;
  v_npc     integer;
  v_staff   integer;
  v_w       integer;
  v_gross   bigint;
  v_salary  bigint;
  v_pay     bigint;
  v_net     bigint;
  v_short   boolean := false;
  v_bal     numeric;
  v_n       integer;
  v_sal_id  uuid;
  v_rev_id  uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;

  select corp_id into v_corp from public.corp_operations where id = p_op_id;
  if v_corp is null then raise exception 'no such operation' using errcode = 'P0002'; end if;
  if not public.is_corp_member(v_corp, v_uid) then
    raise exception 'you are not a member of that corporation' using errcode = '42501';
  end if;
  if not (
       exists (select 1 from public.corporations c where c.id = v_corp and c.founder_id = v_uid)
    or exists (select 1 from public.corp_members m
                where m.corp_id = v_corp and m.user_id = v_uid
                  and lower(coalesce(m.role, '')) in ('founder', 'owner', 'ceo', 'corp ceo'))
  ) then
    raise exception 'only the founder or CEO collects production' using errcode = '42501';
  end if;

  -- Same lock order as corp_staff_payroll (corporation first), so the balance
  -- read below cannot interleave with a payroll run.
  perform 1 from public.corporations where id = v_corp for update;
  select id, corp_id, op_type, workers, status, meta, created_at into v_op
    from public.corp_operations where id = p_op_id for update;
  if v_op.id is null or v_op.corp_id is distinct from v_corp then
    raise exception 'operation moved' using errcode = '40001';
  end if;
  if coalesce(v_op.status, 'active') <> 'active' then
    raise exception 'operation is not active' using errcode = '22023';
  end if;

  select * into v_econ from public.corp_op_econ where op_type = v_op.op_type;
  if v_econ.op_type is null then
    raise exception 'no server tuning for operation type %', v_op.op_type using errcode = 'P0002';
  end if;

  -- ── the accrual start: the LATEST of every stamp we know ──
  select * into v_clock from public.corp_op_clock where op_id = p_op_id;
  if jsonb_typeof(v_op.meta -> 'lastCollect') = 'number' then
    v_meta_ts := to_timestamp(((v_op.meta ->> 'lastCollect')::numeric) / 1000.0);
  end if;
  select max(t.created_at) into v_rev_ts
    from public.corp_treasury t
   where t.corp_id = v_corp and t.kind = 'op_revenue'
     and (t.ref_id = p_op_id or (t.ref_id is null and t.note = v_op.op_type || ' production'));
  v_prev := least(v_now, greatest(v_clock.last_collect_at, v_meta_ts, v_rev_ts, v_op.created_at, v_now - interval '36 hours'));
  v_hrs  := least(c_accrual_cap_h, greatest(0, extract(epoch from (v_now - v_prev)) / 3600.0));

  -- ── factors ──
  v_supply := coalesce(p_supply, 1);
  if v_supply = 'NaN'::numeric then v_supply := 1; end if;
  v_supply := least(1, greatest(0, v_supply));

  if jsonb_typeof(v_op.meta -> 'site') = 'object'
     and jsonb_typeof(v_op.meta -> 'site' -> 'eff') = 'number' then
    v_site := least(c_site_max, greatest(c_site_min, (v_op.meta -> 'site' ->> 'eff')::numeric));
  end if;

  v_npc := least(greatest(0, coalesce(v_op.workers, 0)), v_econ.max_workers);
  select count(*) into v_staff from public.corp_staff s
   where s.op_id = p_op_id and s.corp_id = v_corp and s.status = 'agreed';
  v_w := least(v_econ.max_workers, v_npc + v_staff);

  v_gross  := floor(v_w * v_econ.rate_per_worker_hr * c_mkt_mul * v_supply * v_site * v_hrs)::bigint;
  v_salary := floor(v_npc * v_econ.salary_per_worker_hr * v_hrs)::bigint;

  select coalesce(sum(amount), 0) into v_bal from public.corp_treasury where corp_id = v_corp;
  v_pay := v_salary;
  if v_bal < v_salary then
    v_short := true;
    v_pay   := greatest(0, floor(v_bal))::bigint;
    v_gross := floor(v_gross * 0.5)::bigint;
  end if;
  v_net := greatest(0, v_gross - v_pay);

  -- ── compare-and-set the clock BEFORE anything is paid ──
  if v_clock.op_id is null then
    insert into public.corp_op_clock (op_id, corp_id, last_collect_at, collects, updated_at)
    values (p_op_id, v_corp, v_now, 1, v_now)
    on conflict (op_id) do nothing;
  else
    update public.corp_op_clock
       set last_collect_at = v_now, collects = collects + 1, updated_at = v_now
     where op_id = p_op_id and last_collect_at = v_clock.last_collect_at;
  end if;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'already collected from another tab or device' using errcode = '40001';
  end if;

  update public.corp_operations
     set meta = coalesce(meta, '{}'::jsonb)
                || jsonb_build_object('lastCollect', floor(extract(epoch from v_now) * 1000)::bigint),
         updated_at = v_now
   where id = p_op_id;

  if v_pay > 0 then
    insert into public.corp_treasury (corp_id, user_id, amount, kind, note, ref_id)
    values (v_corp, v_uid, -v_pay, 'op_salary', v_op.op_type || ' wages', p_op_id)
    returning id into v_sal_id;
  end if;
  if v_net > 0 then
    insert into public.corp_treasury (corp_id, user_id, amount, kind, note, ref_id)
    values (v_corp, v_uid, v_net, 'op_revenue', v_op.op_type || ' production', p_op_id)
    returning id into v_rev_id;
  end if;

  select coalesce(sum(amount), 0) into v_bal from public.corp_treasury where corp_id = v_corp;

  return jsonb_build_object(
    'source',           'server',
    'op_id',            p_op_id,
    'op_type',          v_op.op_type,
    'hours',            round(v_hrs, 6),
    'workers',          v_w,
    'workers_npc',      v_npc,
    'workers_staff',    v_staff,
    'rate',             v_econ.rate_per_worker_hr,
    'salary_rate',      v_econ.salary_per_worker_hr,
    'max_workers',      v_econ.max_workers,
    'supply',           v_supply,
    'site_eff',         v_site,
    'market_mul',       c_mkt_mul,
    'gross',            v_gross,
    'salary',           v_pay,
    'salary_owed',      v_salary,
    'net',              v_net,
    'wages_short',      v_short,
    'salary_id',        v_sal_id,
    'revenue_id',       v_rev_id,
    'prev_collect_ms',  floor(extract(epoch from v_prev) * 1000)::bigint,
    'last_collect_ms',  floor(extract(epoch from v_now) * 1000)::bigint,
    'treasury_balance', floor(v_bal));
end $$;

revoke all on function public.corp_op_collect(uuid, numeric) from public, anon;
grant execute on function public.corp_op_collect(uuid, numeric) to authenticated;

-- ── close the client-figure path from sql/146 ───────────────────────────────
-- The function is kept (146's verify and its smoke describe it) but no client
-- may call it: after 151 an op_revenue amount is never chosen by a client.
do $$
begin
  if to_regprocedure('public.corp_treasury_op_revenue(uuid,bigint,text)') is not null then
    execute 'revoke all on function public.corp_treasury_op_revenue(uuid, bigint, text) from public, anon, authenticated';
  end if;
end $$;

commit;

-- --- VERIFY. Expect econ_rows_ge_24 >= 24, econ_rls_t = t,
--     econ_write_policies_admin_3 = 3, clock_rls_t = t,
--     clock_client_write_f = f, collect_definer_t = t,
--     collect_client_exec_t = t, collect_anon_exec_f = f,
--     client_figure_path_f = f (null before 146 is applied).
select
  (select count(*) from public.corp_op_econ)                                          as econ_rows_ge_24,
  (select relrowsecurity from pg_class where oid = 'public.corp_op_econ'::regclass)   as econ_rls_t,
  (select count(*) from pg_policies where tablename = 'corp_op_econ' and cmd <> 'SELECT'
      and coalesce(qual, with_check) ~ 'is_admin\(\)'
      and (with_check is null or with_check ~ 'is_admin\(\)'))                       as econ_write_policies_admin_3,
  (select relrowsecurity from pg_class where oid = 'public.corp_op_clock'::regclass)  as clock_rls_t,
  (has_table_privilege('authenticated', 'public.corp_op_clock', 'INSERT')
    or has_table_privilege('authenticated', 'public.corp_op_clock', 'UPDATE'))       as clock_client_write_f,
  (select prosecdef from pg_proc where oid = 'public.corp_op_collect(uuid,numeric)'::regprocedure) as collect_definer_t,
  has_function_privilege('authenticated', 'public.corp_op_collect(uuid,numeric)', 'EXECUTE') as collect_client_exec_t,
  has_function_privilege('anon', 'public.corp_op_collect(uuid,numeric)', 'EXECUTE')          as collect_anon_exec_f,
  case when to_regprocedure('public.corp_treasury_op_revenue(uuid,bigint,text)') is null then null
       else has_function_privilege('authenticated', 'public.corp_treasury_op_revenue(uuid,bigint,text)', 'EXECUTE')
  end                                                                                 as client_figure_path_f;


-- ─── PART 3 of 3 · sql/150_treasury_audit_reversal_DRAFT.sql ───

-- ════════════════════════════════════════════════════════════════════════════
-- 150 · CORP TREASURY AUDIT: REVERSE THE UNBACKED DEPOSITS
--
--   ██ DRAFT — NOT APPLIED. Owner decision required before running. ██
--
-- WHY. sql/146's header describes the hole: until 146, ct_ins let any member
-- INSERT a corp_treasury row with any amount, and the wallet debit
-- (spendGems) was a separate client step the server never tied to it.
-- "42 past deposit rows totalling 78.8M" is simply EVERY kind='deposit' row
-- (42 rows, 78,769,515) — 146 names no finer criterion. The audit
-- (2026-09-17, read-only) matched each row to a wallet_ledger debit
-- (resource 'cinder', op 'charge') by the same user, for the GROSS amount
-- (the "N sent" figure for a Bank of Ethos transfer), within ±5 min, each
-- debit used at most once:
--   33 BACKED        63,540,649   debit found, balance_after contiguous
--    4 UNBACKED      10,628,866   the four rows below
--    5 UNDETERMINABLE 4,600,000   08-08 .. 08-11 12:28, before wallet_ledger
--                                 recorded client spends ('legacy spend
--                                 mirror' starts 08-11 20:12). NOT reversed
--                                 here: absence of a row proves nothing then.
--
-- ROWS THIS FILE REVERSES (corp_treasury.id):
--   135efa81-a6be-4b3e-947a-5e2cd0b8fa9a  CLAR  10,000,000  08-23 11:15:19
--       Only 10M debit that day (ad0f1fb7…, 11:13:46) already backs the
--       10M deposit 52f6efbe… 93 s earlier; wallet then held 2,525,276.
--   4e070741-ac1f-446e-99c3-d2dca6868bd3  TALO     215,433  09-05 00:18:51
--       Duplicate of 6c36519d… (same note, 26 s earlier); one debit
--       (2f4a7b9f…) exists for the pair.
--   e2a7bde8-f1a7-4043-a022-4cd89c0617bc  TALO     198,000  09-05 00:19:21
--       "200,000 sent": no 200,000 debit by that user at any nearby time.
--
-- OPTIONAL (commented out below — owner call):
--   6c36519d-bb6e-4dba-a0f4-d31bd1eedbc1  TALO     215,433  09-05 00:18:25
--       Its debit 2f4a7b9f… (-217,610, balance → 0) was re-credited 67 s
--       later by wallet_reconcile_self ('reconcile_canonical_wallet'
--       +217,610), so the wallet's NET movement for it is zero. That credit
--       is a separate wallet-side question (sql/046), which is why this row
--       is not in the default set. ⚠ Including it takes TALO to −25,994.
--
-- IMPACT (balances at audit time, sum(amount)):
--   CLAR  17,842,578 → 7,842,578
--   TALO     602,872 → 189,439   (→ −25,994 with the optional row)
--   Balance is unclamped by design (sql/146 REJECTED list); a negative
--   treasury is the honest figure, not something to clamp.
--
-- SHAPE. Append-only: one NEGATIVE row per reversed deposit, kind
-- 'audit_reversal', user_id = the original depositor (so the reversal shows
-- against the same member), note carrying a unique marker
-- 'audit_reversal:sql150:<deposit id>'. Never UPDATE or DELETE the original.
-- Re-runnable: a marker already present inserts nothing; the unique partial
-- index makes a double reversal impossible even under a concurrent re-run.
-- Run in the SQL editor as postgres. If sql/146 is applied by then, its
-- _ct_client_write_guard admits this (current_user = postgres), and
-- ct_ins is irrelevant (RLS does not apply to the table owner session).
-- ⚠ Check the client renders an unknown kind sanely in the treasury log
--   (corpTreasuryFetch) before running; it sums amount regardless of kind.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create unique index if not exists corp_treasury_audit_reversal_once
  on public.corp_treasury (note) where kind = 'audit_reversal';

with targets(deposit_id) as (
  values
    ('135efa81-a6be-4b3e-947a-5e2cd0b8fa9a'::uuid),
    ('4e070741-ac1f-446e-99c3-d2dca6868bd3'::uuid),
    ('e2a7bde8-f1a7-4043-a022-4cd89c0617bc'::uuid)
    -- , ('6c36519d-bb6e-4dba-a0f4-d31bd1eedbc1'::uuid)   -- OPTIONAL, see header
)
insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
select d.corp_id, d.user_id, -d.amount, 'audit_reversal',
       'audit_reversal:sql150:' || d.id::text
         || ' — unbacked deposit of ' || d.amount::bigint
         || ' on ' || to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC'
  from targets t
  join public.corp_treasury d on d.id = t.deposit_id
 where d.kind = 'deposit'
   and d.amount > 0
   and not exists (
         select 1 from public.corp_treasury r
          where r.kind = 'audit_reversal'
            and r.note like 'audit_reversal:sql150:' || d.id::text || '%')
on conflict do nothing;

commit;

-- --- VERIFY. Expect one row per target with reversed_t = t and
-- --- net_zero_t = t; corp balances as in the header.
select d.id                          as deposit_id,
       c.tag,
       d.amount                      as deposit,
       r.amount                      as reversal,
       (r.id is not null)            as reversed_t,
       (d.amount + coalesce(r.amount, 0) = 0) as net_zero_t,
       (select count(*) from public.corp_treasury x
         where x.kind = 'audit_reversal'
           and x.note like 'audit_reversal:sql150:' || d.id::text || '%') as reversals_expect_1,
       (select sum(amount) from public.corp_treasury b where b.corp_id = d.corp_id) as corp_balance_now
  from public.corp_treasury d
  join public.corporations c on c.id = d.corp_id
  left join public.corp_treasury r
         on r.kind = 'audit_reversal'
        and r.note like 'audit_reversal:sql150:' || d.id::text || '%'
 where d.id in ('135efa81-a6be-4b3e-947a-5e2cd0b8fa9a',
                '4e070741-ac1f-446e-99c3-d2dca6868bd3',
                'e2a7bde8-f1a7-4043-a022-4cd89c0617bc',
                '6c36519d-bb6e-4dba-a0f4-d31bd1eedbc1')
 order by d.created_at;
