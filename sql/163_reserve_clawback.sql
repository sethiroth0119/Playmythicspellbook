-- ===========================================================================
-- 163_reserve_clawback.sql   APPLIED 2026-09-19 19:00Z (owner approved the 07ac0340 correction).
-- Result: 16 adjustment rows, 14,076 units / 29,603 points; 14,802 Cinder recovered (49,077 -> 34,275), no shortfall.
-- Project ktsiasyjusesawtrwrjc. Paste it into the SQL editor by hand, as with every
-- file in /sql. It is idempotent and re-runnable, and it ends with a verify query.
--
-- WHAT IT CORRECTS. The donate-dupe (fixed by 0677e2c084 + sql/162, live in v181):
-- a Reserve contribution's vault debit was reverted by the anti-wipe rule while the
-- reserve_contributions row and the addCinders(round(points * 0.5)) reward stayed.
-- review.md reconstructs it per player. ONE player (07ac0340) is LIKELY DUPE:
-- 14,076 units / 29,603 points / 14,802 Cinder. Every other donor is CLEAR.
--
-- THE SHAPE OF THE CORRECTION
--   1. public.reserve_adjustments is APPEND-ONLY and holds NEGATIVE rows only.
--      reserve_contributions is never UPDATEd. The Reserve reads
--      contributions + adjustments.
--   2. Players can read their OWN adjustment rows. Nothing that is not the table
--      owner can insert: there is no insert policy and INSERT is revoked. UPDATE and
--      DELETE are refused by a trigger, including for the owner, so the table stays a
--      ledger.
--   3. The world-visible numbers (totals, leaderboard, Reserve Powers, Influence)
--      read the NET through public.reserve_contributions_net. It exposes exactly
--      the columns reserve_contributions already shows every signed-in player, and
--      nothing from the adjustment rows except their effect.
--   4. Cinder is recovered through public._ct_cinder_take (sql/048). That is the
--      project's existing definer debit of the canonical wallet: it writes
--      user_progress.cinder, bumps wallet_seq, lowers the gems mirror and appends
--      the wallet_ledger 'charge' row. It is capped at the live balance, so it
--      never takes a balance below 0, and any shortfall is RECORDED in
--      reserve_clawback_cinder rather than dropped.
--      ⚠ This is not the "balance = sum(amount)" ledger CLAUDE.md asks for. The
--        Cinder wallet is a balance column mirrored by wallet_ledger, and every
--        debit in the project goes through wallet_charge / _ct_cinder_take. This
--        file therefore does not write user_progress itself. It only calls the
--        sanctioned function, once per player per batch, guarded by an
--        append-only log row.
--
-- 🔴 DEPENDENCIES AND ORDER
--   * Apply sql/164 (reserve_contributions read-only to players; fr_contribute RPC)
--     FIRST. Until 164 lands, rc_ins / rc_upd let any player write their own row to
--     any qty and points. An adjustment still cannot be removed, but the player
--     could simply raise the row again.
--   * The CLIENT must switch its readers to reserve_contributions_net (the list is
--     in review.md, section "Readers"). Until it does, the in-game leaderboard,
--     "my contribution", Reserve Powers and the node payout base
--     (FoundationReserve.myPoints) keep showing the gross number. The SQL readers
--     below (reserve_totals, api_reserve_totals, _inf_inputs) are fixed in this
--     file.
--   * ⚠ Node payouts pay Cinder per NEW reserve point (NODE_CINDER_PER_POINT = 4)
--     against a client-held claimedPoints. Lowering myPoints makes
--     fresh = max(0, myPoints - claimed) read 0 until the player earns past the
--     old mark. That is the intended effect: the points were never real.
--     07ac0340 has NO node_payouts rows, so no node Cinder needs recovering.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The adjustment ledger
-- ---------------------------------------------------------------------------
create table if not exists public.reserve_adjustments (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  res_id      text        not null,
  qty         numeric     not null check (qty < 0),        -- a correction only ever removes
  points      numeric     not null default 0 check (points <= 0),
  reason      text        not null check (length(btrim(reason)) > 0),
  batch       text        not null,
  created_at  timestamptz not null default now(),
  created_by  uuid        default auth.uid(),               -- null when run from the SQL editor
  unique (batch, user_id, res_id)                           -- makes every batch re-runnable
);
create index if not exists reserve_adjustments_user on public.reserve_adjustments (user_id);
create index if not exists reserve_adjustments_res  on public.reserve_adjustments (res_id);

-- Append-only, enforced below RLS, so that not even a definer function can quietly
-- rewrite history. A mistaken row is corrected by a NEW batch, never an edit.
create or replace function public.reserve_adjustments_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'reserve_adjustments is append-only (% refused)', tg_op;
end $$;
drop trigger if exists reserve_adjustments_no_update on public.reserve_adjustments;
create trigger reserve_adjustments_no_update
  before update or delete on public.reserve_adjustments
  for each row execute function public.reserve_adjustments_append_only();
-- (TRUNCATE is not a row event, so it is revoked instead.)

alter table public.reserve_adjustments enable row level security;
drop policy if exists radj_sel_own on public.reserve_adjustments;
create policy radj_sel_own on public.reserve_adjustments
  for select to authenticated using (user_id = auth.uid());
-- NO insert / update / delete policy, on purpose. Belt and braces:
revoke all on public.reserve_adjustments from anon;
revoke insert, update, delete, truncate on public.reserve_adjustments from authenticated;
grant select on public.reserve_adjustments to authenticated;

-- Cinder recovery log. One row per (batch, player), written in the same
-- transaction as the _ct_cinder_take call, so a re-run can never charge twice.
create table if not exists public.reserve_clawback_cinder (
  id          bigint generated always as identity primary key,
  batch       text        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  planned     bigint      not null check (planned >= 0),
  charged     bigint      not null check (charged >= 0),
  shortfall   bigint      not null check (shortfall >= 0),
  balance_before bigint   not null,
  balance_after  bigint   not null check (balance_after >= 0),
  note        text,
  created_at  timestamptz not null default now(),
  unique (batch, user_id),
  check (charged + shortfall = planned)
);
drop trigger if exists reserve_clawback_cinder_no_update on public.reserve_clawback_cinder;
create trigger reserve_clawback_cinder_no_update
  before update or delete on public.reserve_clawback_cinder
  for each row execute function public.reserve_adjustments_append_only();
alter table public.reserve_clawback_cinder enable row level security;
drop policy if exists rcc_sel_own on public.reserve_clawback_cinder;
create policy rcc_sel_own on public.reserve_clawback_cinder
  for select to authenticated using (user_id = auth.uid());
revoke all on public.reserve_clawback_cinder from anon;
revoke insert, update, delete, truncate on public.reserve_clawback_cinder from authenticated;
grant select on public.reserve_clawback_cinder to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The NET read model: contributions + adjustments
-- ---------------------------------------------------------------------------
-- ⚠ DEFINER RIGHTS (security_invoker = false) ON PURPOSE. reserve_adjustments is
--   own-rows-only, so an invoker view would net only the CALLER's corrections,
--   and every other player's totals would stay gross. It exposes only
--   user_id / user_name / resource / qty / points / updated_at, which rc_sel
--   (using true, to authenticated) already shows every signed-in player. anon
--   gets nothing, which matches rc_sel being TO authenticated.
create or replace view public.reserve_contributions_net with (security_invoker = false) as
  select c.user_id, c.user_name, c.resource,
         greatest(c.qty    + coalesce(a.qty, 0),    0)::numeric as qty,
         greatest(c.points + coalesce(a.points, 0), 0)::numeric as points,
         c.updated_at
    from public.reserve_contributions c
    left join (select user_id, res_id, sum(qty) as qty, sum(points) as points
                 from public.reserve_adjustments group by user_id, res_id) a
      on a.user_id = c.user_id and a.res_id = c.resource;
revoke all on public.reserve_contributions_net from anon;
grant select on public.reserve_contributions_net to authenticated;

-- reserve_totals: same columns, same security_invoker, now over the net.
create or replace view public.reserve_totals with (security_invoker = true) as
  select c.resource, greatest(c.contributed - coalesce(x.consumed, 0), 0)::numeric as total, c.points, c.contributors
    from (select resource, sum(qty)::numeric as contributed, sum(points)::numeric as points,
                 count(distinct user_id) filter (where qty > 0) as contributors
            from public.reserve_contributions_net group by resource) c
    left join (select resource, sum(qty)::numeric as consumed from public.reserve_consumption group by resource) x
      on x.resource = c.resource;
grant select on public.reserve_totals to authenticated;

-- api_reserve_totals (worker.js /api -> 'api_reserve_totals?select=*'): a definer
-- view, as in api.sql. Same columns.
create or replace view public.api_reserve_totals as
  select c.resource, greatest(c.contributed - coalesce(x.consumed, 0), 0)::numeric as total, c.points, c.contributors
    from (select resource, sum(qty)::numeric as contributed, sum(points)::numeric as points,
                 count(distinct user_id) filter (where qty > 0) as contributors
            from public.reserve_contributions_net group by resource) c
    left join (select resource, sum(qty)::numeric as consumed from public.reserve_consumption group by resource) x
      on x.resource = c.resource;

-- _inf_inputs: the live body (pg_get_functiondef, 2026-09-19) with ONE change:
-- rep points are read from the net instead of the gross contributions.
create or replace function public._inf_inputs(p_uid uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_xp bigint := 0; v_pts numeric := 0; v_rep integer := 0;
  v_node integer := 0; v_tier text; v_lv integer; v_stand numeric;
begin
  select coalesce(xp, 0) into v_xp from public.influence_state where user_id = p_uid;
  v_xp := coalesce(v_xp, 0);

  begin
    select coalesce(sum(points), 0) into v_pts
      from public.reserve_contributions_net where user_id = p_uid;   -- 163: was reserve_contributions
  exception when undefined_table or undefined_column then v_pts := 0; end;
  v_pts := coalesce(v_pts, 0);
  v_rep := public._inf_rep_rank(v_pts);

  begin
    select case p.tier_id
             when 'eternal' then 'eternal' when 'titan' then 'titan'
             when 'dominion' then 'dominion' when 'foundation' then 'foundation'
             when 'outpost' then 'outpost' when 'node-starter' then 'starter'
             else null end
      into v_tier
      from public.pledge_purchases p
     where p.user_id = p_uid
       and lower(coalesce(p.status, '')) in ('paid','completed','complete','succeeded')
     order by case p.tier_id
                when 'eternal' then 6 when 'titan' then 5 when 'dominion' then 4
                when 'foundation' then 3 when 'outpost' then 2 when 'node-starter' then 1
                else 0 end desc
     limit 1;
  exception when undefined_table or undefined_column then v_tier := null; end;

  v_node := case v_tier
              when 'eternal' then 6 when 'titan' then 5 when 'dominion' then 4
              when 'foundation' then 3 when 'outpost' then 2 when 'starter' then 1
              else 0 end;

  v_lv := public._inf_level_from_xp(v_xp);

  v_stand := 0.30 * (v_node::numeric / 6.0)
           + 0.45 * ((v_lv - 1)::numeric / 9.0)
           + 0.25 * least(1.0, log(10, 1 + v_pts) / log(10, 50001));
  v_stand := greatest(0.0, least(1.0, v_stand));

  return jsonb_build_object(
    'level', v_lv, 'standing', round(v_stand, 4), 'rep_points', v_pts,
    'rep_rank', v_rep, 'node_rank', v_node, 'node_tier', coalesce(v_tier,'free'), 'xp', v_xp);
end$function$;

-- ---------------------------------------------------------------------------
-- 3. Batch donate_dupe_20260919: the adjustment rows (review.md, 07ac0340)
-- ---------------------------------------------------------------------------
-- Every qty is <= that row's live reserve_contributions.qty. The DO block checks
-- this and refuses the WHOLE batch if a row would net below zero, because that
-- would mean the data moved since the review.
do $$
declare
  c_batch constant text := 'donate_dupe_20260919';
  c_uid   constant uuid := '07ac0340-be12-4719-9953-df21c3d56ecd';
  r record; v_have numeric;
begin
  create temp table _plan (res_id text primary key, qty numeric, points numeric) on commit drop;
  insert into _plan values
    ('metal',            -4270, -5760),  -- 11 x 427 in 11 min 09-19 09:36-09:47; server vault stayed 427
    ('aluminumOre',      -3724, -7448),  -- 29 x 133 09-18 23:16 -> 09-19 01:05; one debit of 133
    ('medicine',         -2186, -8854),  -- 5 x 437 (09:35) + 2 x 438 (08:46), specialty rate; no debit
    ('supplies',          -942,  -942),  -- 4 x 314 09:37-09:46; no debit
    ('copperOre',         -924, -1848),  -- 5 x 154 at 13:39 + 2 x 154 at 07:41; + half the coal|copperOre run
    ('coal',              -154,  -308),  -- other half of the 4 x 154 coal|copperOre run (01:23)
    ('corn',              -453,  -906),  -- 4 x 151; one debit
    ('corruptedEssence',  -222, -1332),  -- 5 x 50 (07:40-07:51) + 2 x 22
    ('divineSigils',       -60,  -120),
    ('ancientCoins',       -10,   -20),
    ('cloth',             -107,  -214),  -- last donation 07:38, stack of 107 still held 3h+ later
    ('lumber',            -100,  -200),
    ('planks',            -200,  -400),
    ('stone',             -208,  -416),
    ('water',             -197,  -197),
    ('wood',              -319,  -638);

  for r in select * from _plan loop
    select qty into v_have from public.reserve_contributions where user_id = c_uid and resource = r.res_id;
    if coalesce(v_have, 0)
       + coalesce((select sum(qty) from public.reserve_adjustments
                    where user_id = c_uid and res_id = r.res_id and batch <> c_batch), 0)
       + r.qty < 0 then
      raise exception '163: % would net below zero for % (have %, adjusting %) - data changed since the review, batch refused',
        r.res_id, c_uid, v_have, r.qty;
    end if;
  end loop;

  insert into public.reserve_adjustments (user_id, res_id, qty, points, reason, batch)
  select c_uid, p.res_id, p.qty, p.points,
         'Donate-dupe correction: Reserve credited a donation whose vault debit was reverted (review.md 2026-09-19)',
         c_batch
    from _plan p
  on conflict (batch, user_id, res_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Batch donate_dupe_20260919: Cinder recovery (capped at the live balance)
-- ---------------------------------------------------------------------------
do $$
declare
  c_batch   constant text   := 'donate_dupe_20260919';
  c_uid     constant uuid   := '07ac0340-be12-4719-9953-df21c3d56ecd';
  c_planned constant bigint := 14802;   -- sum of the rewards those donations were paid (review.md)
  v_bal bigint; v_take bigint; v_after bigint; v_res jsonb;
begin
  if exists (select 1 from public.reserve_clawback_cinder where batch = c_batch and user_id = c_uid) then
    raise notice '163: Cinder for % already recovered in %, skipping', c_uid, c_batch;
    return;
  end if;

  -- The player's wallet lock, the same lock order _ct_cinder_take and wallet_credit use.
  insert into public.user_progress (user_id) values (c_uid) on conflict (user_id) do nothing;
  select coalesce(cinder, 0) into v_bal from public.user_progress where user_id = c_uid for update;

  -- Snapshot BEFORE, the exploit_rollback_log pattern of the 2026-09-12 clawbacks.
  insert into public.exploit_rollback_log (batch, kind, user_id, note, payload)
  select c_batch, 'user_progress_before', c_uid, 'wallet before donate-dupe Cinder recovery',
         jsonb_build_object('cinder', g.cinder, 'wallet_seq', g.wallet_seq, 'gems_mirror', p.gems)
    from public.user_progress g left join public.user_profiles p on p.user_id = g.user_id
   where g.user_id = c_uid;

  v_take := least(c_planned, greatest(v_bal, 0));     -- never below 0
  if v_take > 0 then
    v_res := public._ct_cinder_take(c_uid, v_take, 'Reserve donate-dupe correction (' || c_batch || ')');
    v_after := coalesce((v_res ->> 'balance')::bigint, v_bal - v_take);
  else
    v_after := v_bal;
  end if;

  insert into public.reserve_clawback_cinder
    (batch, user_id, planned, charged, shortfall, balance_before, balance_after, note)
  values (c_batch, c_uid, c_planned, v_take, c_planned - v_take, v_bal, v_after,
          case when v_take < c_planned then 'balance too low: shortfall recorded, not charged' end);
end $$;

-- ═══ VERIFY ════════════════════════════════════════════════════════════════
select
  (select count(*) from public.reserve_adjustments where batch = 'donate_dupe_20260919')              as adj_rows,          -- expect 16
  (select -sum(qty)    from public.reserve_adjustments where batch = 'donate_dupe_20260919')          as adj_units,         -- expect 14076
  (select -sum(points) from public.reserve_adjustments where batch = 'donate_dupe_20260919')          as adj_points,        -- expect 29603
  (select row_to_json(c) from public.reserve_clawback_cinder c where batch = 'donate_dupe_20260919') as cinder_recovery,   -- charged + shortfall = 14802
  (select count(*) from public.reserve_contributions_net where qty < 0 or points < 0)                 as negative_net_rows, -- expect 0
  (select count(*) from pg_policies where tablename = 'reserve_adjustments' and cmd <> 'SELECT')      as radj_write_policies, -- expect 0
  has_table_privilege('authenticated', 'public.reserve_adjustments', 'INSERT')                        as players_can_insert,  -- expect false
  (select sum(points) from public.reserve_contributions_net where user_id = '07ac0340-be12-4719-9953-df21c3d56ecd') as net_points_07ac0340, -- expect 61201 - 29603 = 31598
  position('reserve_contributions_net' in pg_get_functiondef('public._inf_inputs'::regproc)) > 0     as influence_reads_net;
