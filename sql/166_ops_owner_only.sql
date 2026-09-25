-- ═══════════════════════════════════════════════════════════════════════════
-- 166 — OPERATIONS ARE THE OWNER'S. (idempotent, re-runnable)
-- ═══════════════════════════════════════════════════════════════════════════
-- Player report (Gary Brooks, feature board): after people "trying to help out"
-- compromised the corporation and lost Cinder to bugs, ONLY THE CORPORATION
-- OWNER should be able to
--     1. buy an Operation          → corp_operations INSERT
--     2. employ / remove workers   → corp_operations UPDATE (workers, meta)
--     3. make or accept job offers → corp_staff_offer / _counter / _accept / _end
--     4. collect a payout          → corp_op_collect
-- Everything else on the Operations page (minigames, per-player functions,
-- applying for a job as a worker) stays open to every member.
--
-- 🔴 WHAT WAS ACTUALLY OPEN, MEASURED ON THIS DATABASE 2026-09-19:
--     cop_ins  — founder only.                                    (already right)
--     cop_upd  — founder OR a member whose role is
--                founder/owner/ceo/'corp ceo'.                    ← the hole
--     corp_op_collect — same founder-or-CEO-role test inline.     ← the hole
--     _corp_is_officer — founder OR role founder/owner/ceo, and it
--                is the ONLY gate on corp_staff_offer / _counter /
--                _accept / _end (verified: nothing else calls it). ← the hole
--   So the client-side "only the founder/CEO" messages were TRUE to the server
--   and both were wrong about who the owner is: an APPOINTED CEO had the whole
--   Operations page. Ownership here is corporations.founder_id, full stop.
--
-- ⚠ THE WORKER'S OWN SIDE IS UNTOUCHED, ON PURPOSE. corp_staff_apply (a member
--   asking for a job) is not gated here, and corp_staff_counter / _accept /
--   _end keep their "or the worker themselves" branch — a member must still be
--   able to accept the wage they were offered, counter it and quit. Only the
--   EMPLOYER side narrows, and it narrows from officer to owner.
--
-- ⚠ NOT A NEW SECURITY BOUNDARY, A NARROWER ONE. Every one of these paths was
--   already server-enforced; none of this depends on the client. The client
--   patch that ships with this file only stops offering buttons the server will
--   refuse.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── the one definition of "owner" ───────────────────────────────────────────
-- SECURITY DEFINER so it may read corporations / corp_members regardless of the
-- caller's policies, and STABLE so a policy may call it per-row cheaply.
-- ⚠ RLS RECURSION: this is exactly why it is a definer function — a policy on
--   corp_operations that sub-selected corp_members under RLS is how this
--   project has recursed before (see CLAUDE.md, is_community_member).
create or replace function public._corp_is_owner(p_corp_id uuid, p_uid uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.corporations c
     where c.id = p_corp_id and c.founder_id = p_uid and p_uid is not null
  );
$fn$;

revoke all on function public._corp_is_owner(uuid, uuid) from public, anon;
grant execute on function public._corp_is_owner(uuid, uuid) to authenticated;

-- ── 2. employ / remove workers: corp_operations UPDATE ──────────────────────
-- Also covers every other client write to the row (level, status, meta), which
-- is the same "control of the Operation" the report is about.
drop policy if exists cop_upd on public.corp_operations;
create policy cop_upd on public.corp_operations for update to authenticated
  using      (public._corp_is_owner(corp_operations.corp_id, auth.uid()))
  with check (public._corp_is_owner(corp_operations.corp_id, auth.uid()));

-- ── 1. buy an Operation: corp_operations INSERT ─────────────────────────────
-- Already founder-only; restated through the same helper so the two gates can
-- never drift apart, and so a reader sees one rule, not two spellings of it.
drop policy if exists cop_ins on public.corp_operations;
create policy cop_ins on public.corp_operations for insert to authenticated
  with check (public._corp_is_owner(corp_operations.corp_id, auth.uid()));

-- SELECT is deliberately left wide open (cop_sel, using(true)): the Registry,
-- the city manifest and every member's own Operations page read these rows.
-- Reading what a corporation operates is public; changing it is not.
-- There is no DELETE policy and none is added — an operation is retired by a
-- status flip, which cop_upd now gates.

-- ── 3. job offers: the employer side of corp_staff ──────────────────────────
-- _corp_is_officer is the ONLY gate on corp_staff_offer / _counter / _accept /
-- _end, and (verified with pg_get_functiondef across pg_proc) nothing else in
-- the database calls it. Narrowing it here narrows all four employer paths at
-- once, without re-issuing four function bodies that would then have to be kept
-- in step with sql/117. The name stays so those bodies keep compiling.
create or replace function public._corp_is_officer(p_corp_id uuid, p_uid uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $fn$
  -- sql/166: an appointed CEO is no longer an officer for staffing purposes.
  -- The corporation's owner is corporations.founder_id and nothing else.
  select public._corp_is_owner(p_corp_id, p_uid);
$fn$;

revoke all on function public._corp_is_officer(uuid, uuid) from public, anon;
grant execute on function public._corp_is_officer(uuid, uuid) to authenticated;

-- ── 4. collect a payout: corp_op_collect ────────────────────────────────────
-- Re-issued from sql/151 with ONE clause changed (the officer test). Everything
-- else — the clock, the 36 h accrual cap, the compare-and-set, the treasury
-- rows — is byte-for-byte the shipped body.
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
  -- 🔒 sql/166 — THE OWNER, AND NOBODY ELSE. This used to accept an appointed
  -- CEO as well (the 'ceo' / 'corp ceo' member role). That is the hole the
  -- owner reported: a member "trying to help out" was promoted, and a promotion
  -- handed them the corporation's production. Ownership is corporations
  -- .founder_id and nothing else; a role string is an appointment, not title.
  if not public._corp_is_owner(v_corp, v_uid) then
    raise exception 'only the corporation owner collects production' using errcode = '42501';
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

commit;

-- ── verify ──────────────────────────────────────────────────────────────────
-- Every line must read true.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_corp_is_owner') = 1                       as owner_fn_exists,
  (select position('founder_id' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_corp_is_owner')                           as owner_fn_reads_founder,
  (select position('_corp_is_owner' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_corp_is_officer')                         as officer_is_owner_now,
  (select position('ceo' in lower(pg_get_functiondef(p.oid))) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_corp_is_officer')                         as officer_no_longer_takes_ceo,
  (select position('_corp_is_owner' in coalesce(qual, '')) > 0
     from pg_policies where tablename = 'corp_operations' and policyname = 'cop_upd')      as cop_upd_owner_only,
  (select position('corp_members' in coalesce(qual, '')) = 0
     from pg_policies where tablename = 'corp_operations' and policyname = 'cop_upd')      as cop_upd_drops_role_branch,
  (select position('_corp_is_owner' in coalesce(with_check, '')) > 0
     from pg_policies where tablename = 'corp_operations' and policyname = 'cop_ins')      as cop_ins_owner_only,
  (select count(*) from pg_policies where tablename = 'corp_operations')                   as corp_operations_policy_count,
  (select relrowsecurity from pg_class where oid = 'public.corp_operations'::regclass)     as rls_on,
  (select position('only the corporation owner collects' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'corp_op_collect')                          as collect_owner_only;
