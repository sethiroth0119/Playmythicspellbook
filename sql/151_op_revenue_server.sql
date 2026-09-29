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
