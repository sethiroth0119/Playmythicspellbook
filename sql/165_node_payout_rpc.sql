-- ===========================================================================
-- 165 . PRN NODE PAYOUTS ARE PAID BY THE SERVER
-- APPLIED 2026-09-19 (apply_migration 165_node_payout_rpc; test plan 28/28, rolled back). Project ktsiasyjusesawtrwrjc, pasted by hand when the owner
-- approves. Idempotent and re-runnable; ends with a verify query.
-- Apply AFTER 163 (reserve_contributions_net), 164 (reserve_events,
-- _fr_hash, _fr_active_event) and 159 (cinder_reward_caps / _days).
--
-- OWNER-APPROVED CHANGE (2026-09-19): "move the node payout server-side".
--
-- WHAT WAS WRONG. nodeCollect (index.html) computed the payout on the client
-- and paid it with addCinders(pay):
--     fresh     = myPoints - meta.claimedPoints          (both client-held)
--     claimable = min(250000, floor(fresh * 4 * lvl * eff * guard))
--     pay       = min(250000, floor(claimable * townBoost * tierBp / 10000),
--                     pool slice, pool left, 24h allowance)
-- It committed the claim marker with a compare-and-swap on economy_nodes.meta
-- (a JSONB the owner may PATCH freely: en_upd), then inserted its own
-- node_payouts row (np_ins: any signed-in player, any amount) and credited
-- itself. Every input was either client state or an owner-writable column;
-- the file's own comments list four rounds of exploits through them.
--
-- THE CHANGE
--   * fr_node_payout(p_node_id uuid, p_client_nonce text) is the ONLY way a
--     PRN pays. The server:
--       - checks the caller OWNS the node (economy_nodes.owner_id = auth.uid())
--         with the row locked FOR UPDATE;
--       - derives the player's points from reserve_contributions_net (the NET
--         figure, so a sql/163 correction lowers the payout base);
--       - derives the claimed-points marker from its own append-only log
--         (node_payout_claims), never from the client;
--       - re-runs every client gate (built / risk lock / 6h cooldown) and the
--         full formula above from server tables and the tuning below;
--       - bounds the Cinder per player per UTC day by
--         cinder_reward_caps['node_payout'] (a partial last payout, as 164);
--       - is exactly-once per nonce (a replay returns the ORIGINAL result);
--       - appends the node_payouts pool row itself, writes the meta mirror the
--         UI previews from (claimedPoints / lastClaim / eff / dayPaid / rev),
--         credits through _ct_cinder_give and returns the canonical balance.
--   * np_ins is DROPPED and INSERT/UPDATE/DELETE on node_payouts revoked:
--     only this function writes the pool ledger now.
--
-- THE CLAIMED-POINTS MIGRATION. Before this file the marker lived only in
--   economy_nodes.meta.claimedPoints (server-stored, owner-writable). It is the
--   best server data there is — it is what the CAS wrote on every honest
--   collect, and node_payouts records Cinder, not points. So:
--     - SEED: every existing (node, owner) gets one 'seed' row carrying the
--       meta value (non-numeric / negative / missing -> the owner's current
--       net points, i.e. "nothing unclaimed").
--     - NEW NODES: an AFTER INSERT / UPDATE OF owner_id trigger writes a
--       'baseline' row = the owner's net points at that moment. Establishing
--       or being handed a node never pays for points earned before it.
--     - A node with no row at all (the trigger failed) gets its baseline on
--       the first collect, which then pays nothing (fail closed).
--     - The marker the server uses is GREATEST(its log, meta.claimedPoints).
--       The meta half can only LOWER a payout (a larger subtrahend), so
--       PATCHing it gains nothing — and it keeps a collect done by a
--       still-open pre-165 tab from being paid a second time. Same for the
--       cooldown (GREATEST(ledger, meta.lastClaim)) and the 24h allowance
--       (GREATEST(ledger sum, meta.dayPaid while its window is open)).
--
-- WHAT THE SERVER STILL READS OFF THE NODE ROW (owner-writable, and why each
-- is safe — the same list the client's invariant note above _nodePaidTier
-- documents): meta.eff (clamped 0..100), meta.lastTick (can only freeze decay
-- at the clamp), meta.cityLink (clamped 0..100), meta.riskClear (skips a
-- defend cost, amount unchanged), status / meta.readyAt (earlier, not bigger),
-- meta.role (one main per owner is a unique index; the town boost is capped
-- +60% and now requires corp membership), meta.tier (may only LOWER a rate:
-- every tier multiplier is min(paid, override)), level (clamped to
-- max_level = 1), corp_id (town boost needs corp_members membership).
--
-- THE NUMBERS — THE SERVER COPY WINS. node_payout_config / node_tiers /
--   node_risk_events / reserve_products (+ reserve_events.stock_mul) mirror
--   index.html (NODE_* constants, NODE_RISK_EVENTS, RESERVE_PRODUCTS,
--   RESERVE_EVENTS.stockMul, frNodePayoutMul) and /src/nodes/tiers.js.
--   `node .gauntlet/node-payout-drift-smoke.mjs` fails if they drift.
--   Seeds are ON CONFLICT DO NOTHING so a figure the owner tuned survives.
--
-- DELIBERATE DIFFERENCES FROM THE CLIENT PREVIEW (all only ever pay LESS):
--   * The 24h allowance is a SLIDING 24h sum of this node's node_payouts, not
--     the client's restart-on-expiry window (which can pay up to 2x the cap
--     inside one 24h span that straddles two windows).
--   * Treasury for the pool = sum of ALL reserve_tax_log rows (the client sums
--     its last 600). Today 30% of it is 4.4M, under the 50M floor either way.
--   * The tier override arm reads the owner's PRNs in the node's corp only.
--     The client also looks at Territory-Wars city nodes and at whatever city
--     overlay is open; those can only RAISE the best tier, and the override
--     arm can only LOWER the paid rate, so ignoring them never overpays.
--   * The jail gate (_jailBlocked) stays client-side (no server jail check
--     exists for PRNs today).
--
-- ⚠ CASH-OUT: Cinder paid here is cashable, as it was when the client paid it.
-- RLS: every new table has RLS on and its policies in this file. No player
--   INSERT/UPDATE/DELETE anywhere; writes come only from definer functions.
-- ===========================================================================

begin;

-- 0. Dependencies — fail loudly rather than half-apply.
do $d$ begin
  if to_regclass('public.cinder_reward_caps') is null or to_regclass('public.cinder_reward_days') is null then
    raise exception '165 needs sql/159 (cinder_reward_caps / cinder_reward_days) applied first';
  end if;
  if to_regprocedure('public._ct_cinder_give(uuid,bigint,text)') is null then
    raise exception '165 needs public._ct_cinder_give(uuid,bigint,text) (sql/048)';
  end if;
  if to_regclass('public.reserve_contributions_net') is null then
    raise exception '165 needs public.reserve_contributions_net (sql/163)';
  end if;
  if to_regprocedure('public._fr_active_event(timestamptz)') is null or to_regprocedure('public._fr_hash(bigint)') is null
     or to_regclass('public.reserve_events') is null then
    raise exception '165 needs sql/164 (reserve_events, _fr_hash, _fr_active_event)';
  end if;
  if to_regclass('public.economy_nodes') is null or to_regclass('public.node_payouts') is null then
    raise exception '165 needs public.economy_nodes and public.node_payouts (api.sql)';
  end if;
end $d$;

-- --------------------------------------------------------------------------
-- 1. Tuning — one row. Mirrors index.html; THE SERVER COPY WINS.
-- --------------------------------------------------------------------------
create table if not exists public.node_payout_config (
  id                   int primary key default 1 check (id = 1),
  enabled              boolean not null default true,
  cinder_per_point     numeric not null check (cinder_per_point >= 0),      -- NODE_CINDER_PER_POINT
  cooldown_ms          bigint  not null check (cooldown_ms >= 0),           -- NODE_CLAIM_COOLDOWN_MS
  eff_decay_per_hr     numeric not null check (eff_decay_per_hr >= 0),      -- NODE_EFF_DECAY_PER_HR
  eff_floor            int     not null check (eff_floor between 0 and 100),-- NODE_EFF_FLOOR
  payout_cap           bigint  not null check (payout_cap >= 0),            -- NODE_PAYOUT_CAP
  daily_cap_per_rate   numeric not null check (daily_cap_per_rate >= 0),    -- NODE_DAILY_CAP_PER_RATE
  day_ms               bigint  not null check (day_ms > 0),                 -- NODE_DAY_MS
  max_level            int     not null check (max_level >= 1),             -- NODE_PAY_MAX_LEVEL
  level_step           numeric not null check (level_step >= 0),            -- _nodeClaimable: 1 + 0.25 (lvl - 1)
  pool_floor           bigint  not null check (pool_floor >= 0),            -- NODE_POOL_FLOOR_CINDER
  pool_treasury_share  numeric not null check (pool_treasury_share >= 0),   -- NODE_POOL_TREASURY_SHARE
  tier_payout_max_bp   int     not null check (tier_payout_max_bp >= 10000),-- NODE_TIER_PAYOUT_MAX_BP
  town_boost_per_tier  numeric not null check (town_boost_per_tier >= 0),   -- TOWN_BOOST_PER_TIER
  town_boost_cap       numeric not null check (town_boost_cap >= 0),        -- TOWN_BOOST_CAP
  risk_window_ms       bigint  not null check (risk_window_ms > 0),         -- NODE_RISK_WINDOW_MS
  risk_gate            int     not null check (risk_gate >= 1),             -- _nodeActiveRisk: sec ? 6 : 4
  risk_gate_sec        int     not null check (risk_gate_sec >= 1),
  risk_sec_mul         numeric not null check (risk_sec_mul >= 0),          -- effHit * 0.6 with Security
  guard_crisis         numeric not null,                                    -- frNodePayoutMul
  guard_strained       numeric not null,
  guard_event          numeric not null,
  guard_pool_low_frac  numeric not null,
  guard_pool_low_mul   numeric not null,
  guard_pool_mid_frac  numeric not null,
  guard_pool_mid_mul   numeric not null,
  guard_floor          numeric not null check (guard_floor > 0),
  note                 text
);
insert into public.node_payout_config (id, enabled, cinder_per_point, cooldown_ms, eff_decay_per_hr, eff_floor, payout_cap,
                                       daily_cap_per_rate, day_ms, max_level, level_step, pool_floor, pool_treasury_share,
                                       tier_payout_max_bp, town_boost_per_tier, town_boost_cap, risk_window_ms, risk_gate,
                                       risk_gate_sec, risk_sec_mul, guard_crisis, guard_strained, guard_event,
                                       guard_pool_low_frac, guard_pool_low_mul, guard_pool_mid_frac, guard_pool_mid_mul,
                                       guard_floor, note)
values (1, true, 4, 21600000, 2.2, 20, 250000,
        7500, 86400000, 1, 0.25, 50000000, 0.30,
        12000, 0.35, 0.60, 21600000, 4,
        6, 0.6, 0.5, 0.8, 0.65,
        0.10, 0.40, 0.25, 0.70,
        0.30, 'Mirrors index.html NODE_* / frNodePayoutMul (drift: node .gauntlet/node-payout-drift-smoke.mjs).')
on conflict (id) do nothing;

-- /src/nodes/tiers.js NODE_TIERS (ord = table order = rank) + PLEDGE_TO_TIER.
create table if not exists public.node_tiers (
  id         text primary key check (id ~ '^[a-z][a-z0-9_-]{0,31}$'),
  ord        int  not null unique check (ord >= 0),
  name       text not null,
  rate       numeric not null check (rate > 0),          -- a PERCENT, as tiers.js
  pledge_id  text unique                                 -- pledge_purchases.tier_id that buys it
);
insert into public.node_tiers (id, ord, name, rate, pledge_id) values
  ('free', 0, 'Free', 0.5, null),
  ('starter', 1, 'Starter', 1, 'node-starter'),
  ('outpost', 2, 'Outpost Operator', 3, 'outpost'),
  ('foundation', 3, 'Foundation Contributor', 5, 'foundation'),
  ('dominion', 4, 'Dominion Founder', 8, 'dominion'),
  ('titan', 5, 'Titan Node Founder', 10, 'titan'),
  ('eternal', 6, 'Eternal Founder', 20, 'eternal')
on conflict (id) do nothing;

-- index.html NODE_RISK_EVENTS, in client order.
create table if not exists public.node_risk_events (
  ord      int  primary key check (ord >= 0),
  id       text not null unique,
  eff_hit  int  not null check (eff_hit >= 0),
  lock     boolean not null default false,
  vuln     text[] not null default '{}'
);
insert into public.node_risk_events (ord, id, eff_hit, lock, vuln) values
  (0, 'raid', 35, false, array['mining', 'fuel', 'storage', 'supply']::text[]),
  (1, 'sabotage', 25, false, array['mfg', 'fuel', 'research', 'mining', 'convoy', 'storage', 'supply', 'security']::text[]),
  (2, 'scp', 50, true, array['research', 'mfg', 'security']::text[]),
  (3, 'convoy', 30, true, array['convoy', 'supply', 'fuel']::text[])
on conflict (ord) do nothing;

-- index.html RESERVE_PRODUCTS (recipe + max) — the inputs of frEconomyState,
-- which throttles node payouts (frNodePayoutMul).
create table if not exists public.reserve_products (
  id         text primary key,
  ord        int  not null unique check (ord >= 0),
  max_units  bigint not null check (max_units > 0),
  recipe     jsonb not null check (jsonb_typeof(recipe) = 'object')
);
insert into public.reserve_products (id, ord, max_units, recipe) values
  ('genesis', 0, 100000, '{"metal": 5, "fuel": 2, "supplies": 3, "memoryShards": 1}'::jsonb),
  ('scpcorr', 1, 60000, '{"corruptedEssence": 4, "dna": 2, "memoryShards": 1}'::jsonb),
  ('arsenal', 2, 80000, '{"ammo": 8, "fuel": 5, "metal": 10}'::jsonb),
  ('relicarc', 3, 30000, '{"memoryShards": 5, "corruptedEssence": 1, "dna": 2}'::jsonb),
  ('medrelief', 4, 50000, '{"medicine": 12, "water": 6, "supplies": 4}'::jsonb),
  ('expkit', 5, 70000, '{"food": 6, "water": 6, "ammo": 4, "supplies": 3}'::jsonb)
on conflict (id) do nothing;

-- RESERVE_EVENTS[].stockMul (sql/164 created the table without it).
alter table public.reserve_events add column if not exists stock_mul numeric;
update public.reserve_events e set stock_mul = v.m
  from (values ('fuelCrisis', 0.35), ('bioLock', 0.40), ('shardDrought', 0.45), ('outbreak', 0.50), ('reliefSurge', 1.30)) v(id, m)
 where e.id = v.id and e.stock_mul is null;

-- 🔥 The owner's Cinder ceiling for PRN payouts, per player per UTC day.
--    PLACEHOLDER — OWNER TO CONFIRM. The largest honest day on 2026-09-19 is
--    22,500 (six Free-tier PRNs x 3,750); a Starter owner with six PRNs is
--    45,000. 50,000 covers both; a paid Eternal operator (150,000 per PRN per
--    24h) would be clamped by it — raise it if/when one exists.
insert into public.cinder_reward_caps (bucket, daily_cinder, note) values
  ('node_payout', 50000, 'PRN node payouts (sql/165). PLACEHOLDER — OWNER TO CONFIRM the figure.')
on conflict (bucket) do nothing;

-- Every claim marker and every payout the server made. APPEND-ONLY: the
-- current marker is the newest row for (node, user); a day's paid Cinder is
-- sum(amount) of today's 'payout' rows — never a stored counter.
create table if not exists public.node_payout_claims (
  id              bigserial primary key,
  node_id         uuid    not null,          -- no FK: history outlives a released node
  user_id         uuid    not null,          -- no FK: a ledger row is never cascaded away
  kind            text    not null check (kind in ('seed', 'baseline', 'payout')),
  nonce           text    check (nonce is null or length(nonce) between 8 and 100),
  claimed_points  numeric not null check (claimed_points >= 0),
  net_points      numeric not null default 0,
  amount          bigint  not null default 0 check (amount >= 0),
  wanted          bigint  not null default 0 check (wanted >= 0 and amount <= wanted),
  detail          jsonb,
  created_at      timestamptz not null default now(),
  check ((kind = 'payout') = (nonce is not null)),
  unique (user_id, nonce)
);
create index if not exists node_payout_claims_node_user on public.node_payout_claims (node_id, user_id, id desc);
create index if not exists node_payout_claims_user_ts   on public.node_payout_claims (user_id, created_at desc) where kind = 'payout';
create index if not exists node_payouts_node_ts         on public.node_payouts (node_id, created_at desc);

create or replace function public._np_claims_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'node_payout_claims is append-only (% refused)', tg_op;
end $$;
drop trigger if exists node_payout_claims_append_only on public.node_payout_claims;
create trigger node_payout_claims_append_only before update or delete on public.node_payout_claims
  for each row execute function public._np_claims_append_only();

-- --------------------------------------------------------------------------
-- 2. RLS + grants — reviewed line by line.
-- --------------------------------------------------------------------------
alter table public.node_payout_config  enable row level security;
alter table public.node_tiers          enable row level security;
alter table public.node_risk_events    enable row level security;
alter table public.reserve_products    enable row level security;
alter table public.node_payout_claims  enable row level security;

-- The numbers are public to signed-in players so the UI can show what is enforced.
drop policy if exists npc_sel on public.node_payout_config;
create policy npc_sel on public.node_payout_config for select to authenticated using (true);
drop policy if exists ntr_sel on public.node_tiers;
create policy ntr_sel on public.node_tiers         for select to authenticated using (true);
drop policy if exists nre_sel on public.node_risk_events;
create policy nre_sel on public.node_risk_events   for select to authenticated using (true);
drop policy if exists rpr_sel on public.reserve_products;
create policy rpr_sel on public.reserve_products   for select to authenticated using (true);
-- The claim log: a player reads their OWN rows only.
drop policy if exists npl_sel on public.node_payout_claims;
create policy npl_sel on public.node_payout_claims for select to authenticated using (user_id = auth.uid());

revoke all on public.node_payout_config, public.node_tiers, public.node_risk_events, public.reserve_products,
              public.node_payout_claims from anon;
revoke insert, update, delete, truncate on public.node_payout_config, public.node_tiers, public.node_risk_events,
                                            public.reserve_products, public.node_payout_claims from authenticated;
grant select on public.node_payout_config, public.node_tiers, public.node_risk_events, public.reserve_products,
                public.node_payout_claims to authenticated;
revoke all on sequence public.node_payout_claims_id_seq from anon, authenticated;

-- node_payouts (the global pool ledger) becomes READ-ONLY to players.
-- Checked 2026-09-19: the only writer is index.html nodeCollect (moved to
-- fr_node_payout by the paired client patch); no database function writes
-- it. np_sel (select to authenticated using true) is KEPT: nodePoolFetch
-- sums it for the pool bar. Live grants were ALL verbs to anon AND
-- authenticated; RLS (np_ins) was the only thing in the way.
drop policy if exists np_ins on public.node_payouts;
revoke insert, update, delete, truncate on public.node_payouts from anon, authenticated;
grant select on public.node_payouts to authenticated;

-- reserve_contributions_net is a DEFINER view (sql/163). It is not
-- auto-updatable (it joins), but a definer view must never carry write grants
-- that a later "simplification" of its body could make live — as of
-- 2026-09-19 authenticated held INSERT/UPDATE/DELETE on it.
revoke insert, update, delete, truncate on public.reserve_contributions_net from anon, authenticated;
grant select on public.reserve_contributions_net to authenticated;

-- --------------------------------------------------------------------------
-- 3. Pure helpers — ports of the index.html functions they name.
-- --------------------------------------------------------------------------
-- JS Number() of a JSON value, for the node meta: a number, or a numeric
-- string; anything else (NaN in JS) is NULL here and each caller applies
-- the client's fallback.
create or replace function public._np_num(j jsonb)
returns double precision language plpgsql immutable set search_path = public as $$
declare s text;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'number' then return (j #>> '{}')::double precision; end if;
  if jsonb_typeof(j) = 'string' then
    s := btrim(j #>> '{}');
    if s ~ '^-?[0-9]{1,18}(\.[0-9]{1,18})?$' then return s::double precision; end if;
  end if;
  return null;
exception when others then return null;
end $$;
revoke all on function public._np_num(jsonb) from public, anon, authenticated;

-- _nodeSeed(id): FNV-1a over the id's characters, unsigned 32-bit.
create or replace function public._np_node_seed(p_id text)
returns bigint language plpgsql immutable set search_path = public as $$
declare h bigint := 2166136261; i int;
begin
  for i in 1 .. coalesce(length(p_id), 0) loop
    h := ((h # ascii(substr(p_id, i, 1))) * 16777619) % 4294967296;
  end loop;
  return h;
end $$;
revoke all on function public._np_node_seed(text) from public, anon, authenticated;

-- _nodeActive(n).
create or replace function public._np_active(p_status text, p_meta jsonb, p_now_ms bigint)
returns boolean language plpgsql immutable set search_path = public as $$
declare r double precision;
begin
  if p_status = 'building' then
    r := public._np_num(p_meta -> 'readyAt');
    return r is not null and r <> 0 and p_now_ms >= r;
  end if;
  return coalesce(p_status = 'active', false);
end $$;
revoke all on function public._np_active(text, jsonb, bigint) from public, anon, authenticated;

-- _nodeActiveRisk's roll for (node, window): the event, or NULL. The caller
-- has already applied "not active -> none" and "riskClear = window -> none".
create or replace function public._np_risk_pick(p_id text, p_type text, p_w bigint, p_sec boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cfg  public.node_payout_config%rowtype;
  ev   public.node_risk_events%rowtype;
  h    bigint;
  gate int;
  n    int;
  hit  int;
begin
  select * into cfg from public.node_payout_config where id = 1;
  -- JS: _frHash(_nodeSeed(id) ^ Math.imul(w, 0x9e3779b1)) — imul is the product mod 2^32.
  h := public._fr_hash((public._np_node_seed(p_id) # ((p_w * 2654435761) % 4294967296)) & 4294967295);
  gate := case when p_sec then cfg.risk_gate_sec else cfg.risk_gate end;
  if h % gate <> 0 then return null; end if;
  select count(*) into n from public.node_risk_events where p_type = any(vuln);
  if n > 0 then
    select * into ev from public.node_risk_events where p_type = any(vuln) order by ord offset ((h >> 3) % n) limit 1;
  else
    select count(*) into n from public.node_risk_events;
    if n = 0 then return null; end if;
    select * into ev from public.node_risk_events order by ord offset ((h >> 3) % n) limit 1;
  end if;
  hit := case when p_sec then floor(ev.eff_hit::double precision * cfg.risk_sec_mul::double precision + 0.5)::int else ev.eff_hit end;
  return jsonb_build_object('id', ev.id, 'eff_hit', hit, 'lock', ev.lock, 'window', p_w, 'mitigated', p_sec);
end $$;
revoke all on function public._np_risk_pick(text, text, bigint, boolean) from public, anon, authenticated;

-- _nodeEff(n) with the risk hit already resolved. Math.round = floor(x + .5).
create or replace function public._np_eff(p_meta jsonb, p_updated timestamptz, p_now_ms bigint, p_risk_hit int)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  cfg    public.node_payout_config%rowtype;
  stored double precision;
  v_tick double precision;
  hrs    double precision;
  link   double precision;
  v      double precision;
begin
  select * into cfg from public.node_payout_config where id = 1;
  stored := greatest(0, least(100, coalesce(public._np_num(p_meta -> 'eff'), 100)));
  -- JS: m.lastTick || Date.parse(updated_at) || now
  v_tick := public._np_num(p_meta -> 'lastTick');
  if v_tick is null or v_tick = 0 then
    v_tick := case when p_updated is not null then floor(extract(epoch from p_updated) * 1000) else p_now_ms end;
  end if;
  hrs := greatest(0, (p_now_ms - v_tick) / 3600000.0::double precision);
  link := greatest(0, least(100, trunc(coalesce(public._np_num(p_meta -> 'cityLink'), 0))));
  v := stored - hrs * cfg.eff_decay_per_hr::double precision * (1 - (link / 100) * 0.6);
  v := v - coalesce(p_risk_hit, 0);
  return greatest(cfg.eff_floor + floor(link * 0.5 + 0.5), floor(v + 0.5))::int;
end $$;
revoke all on function public._np_eff(jsonb, timestamptz, bigint, int) from public, anon, authenticated;

-- frEconomyState() over a {resource: total} map and the active event.
create or replace function public._np_econ_state(p_totals jsonb, p_ev public.reserve_events)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  p        record;
  e        record;
  v_can    double precision;
  v_per    double precision;
  v_have   double precision;
  v_pct    double precision;
  v_n      int;
  v_hit    boolean;
  stalled  int := 0;
  critical int := 0;
begin
  for p in select * from public.reserve_products order by ord loop
    v_can := 'Infinity'; v_n := 0;
    v_hit := p_ev.ord is not null and (coalesce(p_ev.relief, false)
             or exists (select 1 from jsonb_object_keys(p.recipe) k where k = any(coalesce(p_ev.res, '{}'::text[]))));
    for e in select key, value from jsonb_each(p.recipe) loop
      v_per := public._np_num(e.value);
      if v_per is null or v_per <= 0 then continue; end if;
      v_n := v_n + 1;
      v_have := coalesce(public._np_num(p_totals -> e.key), 0);
      v_can := least(v_can, floor(v_have / v_per));
    end loop;
    if v_n = 0 then v_can := 0; end if;                                     -- JS: !isFinite(can) -> 0
    if v_hit then v_can := floor(v_can * coalesce(p_ev.stock_mul, 1)::double precision); end if;
    v_can := greatest(0, least(p.max_units::double precision, v_can));
    v_pct := floor(v_can / p.max_units::double precision * 100 + 0.5);
    if v_can <= 0 then stalled := stalled + 1;
    elsif v_pct < 15 then critical := critical + 1;
    end if;
  end loop;
  return case when stalled >= 3 then 'CRISIS' when stalled >= 1 or critical >= 2 then 'STRAINED' else 'STABLE' end;
end $$;
revoke all on function public._np_econ_state(jsonb, public.reserve_events) from public, anon, authenticated;

-- frNodePayoutMul(): the inflation guard, in [guard_floor, 1].
create or replace function public._np_guard(p_state text, p_event_hot boolean, p_total double precision, p_avail double precision)
returns double precision language plpgsql stable security definer set search_path = public as $$
declare cfg public.node_payout_config%rowtype; m double precision := 1; f double precision;
begin
  select * into cfg from public.node_payout_config where id = 1;
  if p_state = 'CRISIS' then m := cfg.guard_crisis;
  elsif p_state = 'STRAINED' then m := cfg.guard_strained;
  end if;
  if coalesce(p_event_hot, false) then m := least(m, cfg.guard_event::double precision); end if;
  if p_total > 0 then
    f := p_avail / p_total;
    if f < cfg.guard_pool_low_frac then m := least(m, cfg.guard_pool_low_mul::double precision);
    elsif f < cfg.guard_pool_mid_frac then m := least(m, cfg.guard_pool_mid_mul::double precision);
    end if;
  end if;
  return greatest(cfg.guard_floor::double precision, least(1, m));
end $$;
revoke all on function public._np_guard(text, boolean, double precision, double precision) from public, anon, authenticated;

-- A tier's rate by id (meta.tier), or NULL for an unknown / absent id.
create or replace function public._np_tier_rate(p_id text)
returns numeric language sql stable security definer set search_path = public as $$
  select rate from public.node_tiers where id = p_id
$$;
revoke all on function public._np_tier_rate(text) from public, anon, authenticated;

-- nodeTierFetchPledge + resolveTier(null, ctx): the best tier the player
-- PAID for (pledge_purchases — written only by the payment webhook), else Free.
create or replace function public._np_paid_rate(p_uid uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.rate from public.pledge_purchases pp join public.node_tiers t on t.pledge_id = pp.tier_id
      where pp.user_id = p_uid
        and lower(coalesce(pp.status, '')) in ('', 'paid', 'completed', 'complete', 'succeeded')
      order by t.ord desc limit 1),
    (select rate from public.node_tiers where id = 'free'),
    0.5)
$$;
revoke all on function public._np_paid_rate(uuid) from public, anon, authenticated;

-- The player's NET Reserve points (sql/163's view — what every reader now uses).
create or replace function public._np_net_points(p_uid uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(floor(sum(points)), 0)::bigint from public.reserve_contributions_net where user_id = p_uid
$$;
revoke all on function public._np_net_points(uuid) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 4. The claimed-points marker: seed existing nodes, baseline new ones.
-- --------------------------------------------------------------------------
insert into public.node_payout_claims (node_id, user_id, kind, claimed_points, net_points, detail)
select e.id, e.owner_id, 'seed',
       case when jsonb_typeof(e.meta -> 'claimedPoints') = 'number' and (e.meta ->> 'claimedPoints')::numeric >= 0
            then floor((e.meta ->> 'claimedPoints')::numeric) else coalesce(np.pts, 0) end,
       coalesce(np.pts, 0),
       jsonb_build_object('from', case when jsonb_typeof(e.meta -> 'claimedPoints') = 'number' and (e.meta ->> 'claimedPoints')::numeric >= 0
                                       then 'meta.claimedPoints' else 'net_points' end, 'sql', '165')
  from public.economy_nodes e
  left join (select user_id, floor(sum(points)) pts from public.reserve_contributions_net group by user_id) np on np.user_id = e.owner_id
 where e.owner_id is not null
   and not exists (select 1 from public.node_payout_claims c where c.node_id = e.id and c.user_id = e.owner_id);

-- A new node (or a node handed to a new owner — admin only under en_upd)
-- starts at its owner's CURRENT net points. Never blocks the node write: a
-- failure here only means the first collect sets the baseline and pays 0.
create or replace function public._np_node_baseline()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v bigint;
begin
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    begin
      v := public._np_net_points(new.owner_id);
      insert into public.node_payout_claims (node_id, user_id, kind, claimed_points, net_points, detail)
      values (new.id, new.owner_id, 'baseline', v, v, jsonb_build_object('op', tg_op));
    exception when others then
      raise warning '_np_node_baseline: % for node %', sqlerrm, new.id;
    end;
  end if;
  return null;
end $$;
revoke all on function public._np_node_baseline() from public, anon, authenticated;
drop trigger if exists economy_nodes_payout_baseline on public.economy_nodes;
create trigger economy_nodes_payout_baseline after insert or update of owner_id on public.economy_nodes
  for each row execute function public._np_node_baseline();

-- --------------------------------------------------------------------------
-- 5. The payout. One transaction: validate -> lock the user's day -> exactly
--    once per nonce -> lock the node -> gates -> compute -> log -> pool row ->
--    meta mirror -> credit. Every refusal returns before any money or ledger
--    write (the only earlier writes are the moneyless day-lock row and, for
--    a node with no marker at all, its baseline row); an exception rolls it
--    all back. So "ok: false" always means nothing was paid.
-- --------------------------------------------------------------------------
create or replace function public._np_replay(lg public.node_payout_claims, p_node_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_bal bigint; v_seq bigint;
begin
  if lg.node_id <> p_node_id then return jsonb_build_object('ok', false, 'error', 'nonce_conflict'); end if;
  select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = lg.user_id;
  return coalesce(lg.detail, jsonb_build_object('ok', true, 'node_id', lg.node_id, 'credited', lg.amount, 'wanted', lg.wanted))
         || jsonb_build_object('already', true, 'cinder', coalesce(v_bal, 0), 'wallet_seq', coalesce(v_seq, 0));
end $$;
revoke all on function public._np_replay(public.node_payout_claims, uuid) from public, anon, authenticated;

create or replace function public._fr_node_payout_core(p_uid uuid, p_node_id uuid, p_client_nonce text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg        public.node_payout_config%rowtype;
  lg         public.node_payout_claims%rowtype;
  n          public.economy_nodes%rowtype;
  ev         public.reserve_events%rowtype;
  v_nonce    text := btrim(coalesce(p_client_nonce, ''));
  v_now_ms   bigint := floor(extract(epoch from now()) * 1000)::bigint;
  v_day      date := (now() at time zone 'utc')::date;
  v_from     timestamptz;
  v_meta     jsonb;
  v_w        bigint;
  v_rc       double precision;
  v_sec      boolean;
  v_risk     jsonb;
  v_last_ms  double precision;
  v_cd_left  bigint;
  v_net      bigint;
  v_claimed  numeric;
  v_mclaim   double precision;
  v_fresh    double precision;
  v_lvl      int;
  v_lvl_mul  double precision;
  v_eff      int;
  v_totals   jsonb;
  v_state    text;
  v_guard    double precision;
  v_tax      numeric;
  v_pool_tot bigint;
  v_pool_paid numeric;
  v_avail    bigint;
  v_paid     numeric;
  v_best     numeric;
  v_rate     numeric;
  v_tier     text;
  v_bp       bigint;
  v_share    double precision;
  v_town     double precision := 0;
  v_boost    double precision := 1;
  v_claimable bigint;
  v_accrual  bigint;
  v_bounded  bigint;
  v_day_cap  bigint;
  v_day_used numeric;
  v_mday     double precision;
  v_mstart   double precision;
  v_day_left bigint;
  v_slice    bigint;
  v_pay      bigint;
  v_want     bigint;
  v_cap      bigint;
  v_used     bigint;
  v_room     bigint;
  v_id       bigint;
  v_res      jsonb;
  v_give     jsonb;
  v_bal      bigint;
  v_seq      bigint;
  v_oldest   timestamptz;
  t          record;
begin
  if p_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_node_id is null then return jsonb_build_object('ok', false, 'error', 'not_your_node'); end if;
  if length(v_nonce) < 8 or length(v_nonce) > 100 then return jsonb_build_object('ok', false, 'error', 'bad_nonce'); end if;
  select * into cfg from public.node_payout_config where id = 1;
  if cfg.id is null or not cfg.enabled then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;

  -- Fast path: a retry of a payout that already landed gets the ORIGINAL result.
  select * into lg from public.node_payout_claims where user_id = p_uid and nonce = v_nonce;
  if lg.id is not null then return public._np_replay(lg, p_node_id); end if;

  -- The per-user, per-UTC-day lock row (sql/159's table, bucket 'node_payout').
  -- Two tabs, two nodes, or a retry racing its own timed-out original all
  -- serialise HERE, so the day's room is measured after the other payment.
  insert into public.cinder_reward_days (user_id, bucket, day) values (p_uid, 'node_payout', v_day)
  on conflict (user_id, bucket, day) do nothing;
  perform 1 from public.cinder_reward_days where user_id = p_uid and bucket = 'node_payout' and day = v_day for update;
  select * into lg from public.node_payout_claims where user_id = p_uid and nonce = v_nonce;
  if lg.id is not null then return public._np_replay(lg, p_node_id); end if;

  -- The node, locked. Ownership is the server's column, never a client claim.
  select * into n from public.economy_nodes where id = p_node_id for update;
  if n.id is null or n.owner_id is distinct from p_uid then
    return jsonb_build_object('ok', false, 'error', 'not_your_node');
  end if;
  v_meta := case when jsonb_typeof(n.meta) = 'object' then n.meta else '{}'::jsonb end;

  -- Gate 1: built. (_nodeActive)
  if not public._np_active(n.status, v_meta, v_now_ms) then
    return jsonb_build_object('ok', false, 'error', 'building', 'node_id', n.id);
  end if;

  -- Gate 2: an active hazard that locks the node. (_nodeActiveRisk)
  v_w := floor(v_now_ms::numeric / cfg.risk_window_ms)::bigint;
  v_sec := n.corp_id is not null and (
             exists (select 1 from public.corp_licenses l where l.corp_id = n.corp_id and l.license_type = 'security' and l.status = 'active')
          or exists (select 1 from public.economy_nodes s where s.corp_id = n.corp_id and s.node_type = 'security'
                        and public._np_active(s.status, case when jsonb_typeof(s.meta) = 'object' then s.meta else '{}'::jsonb end, v_now_ms)));
  v_rc := public._np_num(v_meta -> 'riskClear');
  if v_rc is not null and trunc(v_rc) = v_w then v_risk := null;
  else v_risk := public._np_risk_pick(n.id::text, n.node_type, v_w, v_sec);
  end if;
  if v_risk is not null and (v_risk ->> 'lock')::boolean then
    return jsonb_build_object('ok', false, 'error', 'locked', 'node_id', n.id, 'risk', v_risk);
  end if;

  -- Gate 3: the per-node cooldown, from the pool ledger + this log. The meta
  -- stamp can only make it LONGER (a pre-165 tab's collect still counts).
  select greatest(
           (select floor(extract(epoch from max(created_at)) * 1000) from public.node_payouts where node_id = n.id),
           (select floor(extract(epoch from max(created_at)) * 1000) from public.node_payout_claims where node_id = n.id and kind = 'payout'),
           public._np_num(v_meta -> 'lastClaim'))
    into v_last_ms;
  if v_last_ms is not null and v_last_ms > 0 and v_last_ms + cfg.cooldown_ms > v_now_ms then
    v_cd_left := ceil(v_last_ms + cfg.cooldown_ms - v_now_ms)::bigint;
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'node_id', n.id, 'left_ms', v_cd_left);
  end if;

  -- The points: NET, and the server's own marker (the meta mirror may only raise it).
  v_net := public._np_net_points(p_uid);
  select c.claimed_points into v_claimed from public.node_payout_claims c
   where c.node_id = n.id and c.user_id = p_uid order by c.id desc limit 1;
  if v_claimed is null then
    insert into public.node_payout_claims (node_id, user_id, kind, claimed_points, net_points, detail)
    values (n.id, p_uid, 'baseline', v_net, v_net, jsonb_build_object('op', 'first_collect'));
    return jsonb_build_object('ok', false, 'error', 'nothing_new', 'node_id', n.id, 'baseline', true);
  end if;
  v_mclaim := public._np_num(v_meta -> 'claimedPoints');
  if v_mclaim is not null and v_mclaim > v_claimed then v_claimed := floor(v_mclaim); end if;
  v_fresh := greatest(0, v_net - v_claimed)::double precision;

  -- The accrual (_nodeClaimable), with the Director's inflation guard.
  v_lvl := greatest(1, least(cfg.max_level, coalesce(nullif(n.level, 0), 1)));
  v_lvl_mul := 1 + cfg.level_step::double precision * (v_lvl - 1);
  v_eff := public._np_eff(v_meta, n.updated_at, v_now_ms, coalesce((v_risk ->> 'eff_hit')::int, 0));
  select coalesce(jsonb_object_agg(resource, total), '{}'::jsonb) into v_totals from public.reserve_totals;
  ev := public._fr_active_event(now());
  v_state := public._np_econ_state(v_totals, ev);
  select coalesce(sum(tax_amount), 0) into v_tax from public.reserve_tax_log;
  v_pool_tot := greatest(cfg.pool_floor, floor(v_tax * cfg.pool_treasury_share))::bigint;
  select coalesce(sum(amount), 0) into v_pool_paid from public.node_payouts;
  v_avail := greatest(0, floor(v_pool_tot - v_pool_paid))::bigint;
  v_guard := public._np_guard(v_state, coalesce(ev.ord is not null and not ev.relief, false), v_pool_tot::double precision, v_avail::double precision);
  v_claimable := least(cfg.payout_cap::double precision,
                       floor(v_fresh * cfg.cinder_per_point::double precision * v_lvl_mul * (v_eff::double precision / 100) * v_guard))::bigint;
  if v_claimable <= 0 then
    return jsonb_build_object('ok', false, 'error', 'nothing_new', 'node_id', n.id, 'net_points', v_net, 'claimed_points', v_claimed);
  end if;

  -- The tier: what the owner PAID for; an override on a node may only LOWER it.
  v_paid := public._np_paid_rate(p_uid);
  v_share := least(coalesce(public._np_tier_rate(v_meta ->> 'tier'), v_paid), v_paid)::double precision / 100;   -- _nodeTierPoolShare
  select max(coalesce(public._np_tier_rate(case when jsonb_typeof(s.meta) = 'object' then s.meta ->> 'tier' end), v_paid))
    into v_best from public.economy_nodes s
   where s.owner_id = p_uid and s.corp_id is not distinct from n.corp_id;                                           -- _myTierNode (PRNs)
  v_rate := least(v_paid, coalesce(v_best, v_paid));                                                                  -- _nodeOwnerTierMul
  v_bp := least(cfg.tier_payout_max_bp, greatest(10000, 10000 + floor(v_rate * 100 + 0.5)))::bigint;
  select name into v_tier from public.node_tiers where rate = v_rate order by ord limit 1;

  -- The capital's town boost (_nodeTownBoost) — only for a member of the node's corp.
  if (v_meta ->> 'role') = 'main' and n.corp_id is not null
     and exists (select 1 from public.corp_members m where m.user_id = p_uid and m.corp_id = n.corp_id) then
    for t in select s.meta from public.economy_nodes s where s.corp_id = n.corp_id and s.id <> n.id order by s.created_at, s.id loop
      if jsonb_typeof(t.meta) = 'object' and (t.meta ->> 'role') = 'main' then continue; end if;
      v_town := v_town + greatest(0.005::double precision, least(0.20::double precision,
                  least(coalesce(public._np_tier_rate(case when jsonb_typeof(t.meta) = 'object' then t.meta ->> 'tier' end), v_paid), v_paid)::double precision / 100))
                * cfg.town_boost_per_tier::double precision;
    end loop;
    if v_town > 0 then v_boost := 1 + least(cfg.town_boost_cap::double precision, v_town); end if;
  end if;

  -- _nodeRealPay.
  v_accrual := floor(v_claimable * v_boost)::bigint;
  v_bounded := least(cfg.payout_cap, floor((v_accrual::numeric * v_bp) / 10000))::bigint;
  v_day_cap := floor(v_rate * cfg.daily_cap_per_rate)::bigint;
  select coalesce(sum(amount), 0) into v_day_used from public.node_payouts
   where node_id = n.id and created_at > now() - make_interval(secs => cfg.day_ms / 1000.0);
  v_mday := public._np_num(v_meta -> 'dayPaid'); v_mstart := public._np_num(v_meta -> 'dayStart');
  if v_mday is not null and v_mstart is not null and v_mstart > 0 and (v_now_ms - v_mstart) < cfg.day_ms and v_mday > v_day_used then
    v_day_used := floor(v_mday);
  end if;
  v_day_left := greatest(0, v_day_cap - v_day_used)::bigint;
  v_slice := floor(v_avail * v_share)::bigint;
  v_pay := greatest(0, least(v_bounded, v_slice, v_avail, v_day_left));
  if v_pay <= 0 then
    return jsonb_build_object('ok', false, 'error', case when v_day_left <= 0 then 'day_cap' else 'pool_empty' end,
                              'node_id', n.id, 'day_cap', v_day_cap, 'pool_avail', v_avail);
  end if;

  -- The owner's ceiling for PRN Cinder, per player per UTC day.
  select daily_cinder into v_cap from public.cinder_reward_caps where bucket = 'node_payout';
  v_from := v_day::timestamp at time zone 'utc';
  select coalesce(sum(amount), 0) into v_used from public.node_payout_claims
   where user_id = p_uid and kind = 'payout' and created_at >= v_from and created_at < v_from + interval '1 day';
  v_room := greatest(0, coalesce(v_cap, 0) - v_used);
  if v_room <= 0 then
    -- Nothing moves and the marker does NOT advance: the accrual is kept for tomorrow.
    return jsonb_build_object('ok', false, 'error', 'daily_cap', 'node_id', n.id, 'cap', coalesce(v_cap, 0), 'used_today', v_used);
  end if;
  v_want := v_pay;
  v_pay := least(v_pay, v_room);

  v_res := jsonb_build_object(
    'ok', true, 'already', false, 'node_id', n.id, 'credited', v_pay, 'wanted', v_want, 'clamped', v_pay < v_want,
    'cap', coalesce(v_cap, 0), 'used_today', v_used + v_pay,
    'net_points', v_net, 'claimed_from', v_claimed, 'claimed_points', v_net, 'fresh_points', v_fresh,
    'eff', v_eff, 'guard', v_guard, 'state', v_state, 'boost', v_boost, 'accrual', v_accrual, 'bounded', v_bounded,
    'tier', jsonb_build_object('rate', v_rate, 'paid_rate', v_paid, 'bp', v_bp, 'mul', v_bp / 10000.0, 'name', v_tier),
    'day', jsonb_build_object('cap', v_day_cap, 'used', v_day_used + v_pay),
    'pool', jsonb_build_object('total', v_pool_tot, 'paid', v_pool_paid + v_pay, 'avail', greatest(0, v_avail - v_pay), 'slice', v_slice),
    'risk', v_risk, 'paid_at_ms', v_now_ms);

  insert into public.node_payout_claims (node_id, user_id, kind, nonce, claimed_points, net_points, amount, wanted, detail)
  values (n.id, p_uid, 'payout', v_nonce, v_net, v_net, v_pay, v_want, v_res)
  on conflict (user_id, nonce) do nothing returning id into v_id;
  if v_id is null then
    -- Unreachable under the day lock; refuse rather than pay twice.
    return jsonb_build_object('ok', false, 'error', 'nonce_conflict');
  end if;

  -- The global pool ledger (nodePoolFetch sums it).
  insert into public.node_payouts (node_id, corp_id, user_id, amount) values (n.id, n.corp_id, p_uid, v_pay);

  -- The meta mirror the client previews from. rev is bumped, so any client
  -- compare-and-swap in flight on this row (Maintain / Defend) loses and re-reads.
  select min(created_at) into v_oldest from public.node_payouts
   where node_id = n.id and created_at > now() - make_interval(secs => cfg.day_ms / 1000.0);
  update public.economy_nodes
     set status = 'active', updated_at = now(),
         meta = v_meta || jsonb_build_object(
           'claimedPoints', v_net, 'lastClaim', v_now_ms, 'eff', v_eff, 'lastTick', v_now_ms,
           'dayStart', coalesce(floor(extract(epoch from v_oldest) * 1000)::bigint, v_now_ms), 'dayPaid', v_day_used + v_pay,
           'rev', case when jsonb_typeof(v_meta -> 'rev') = 'number' then (v_meta ->> 'rev')::numeric + 1 else 1 end)
   where id = n.id;

  -- The Cinder: the canonical definer credit. No balance is written here.
  v_give := public._ct_cinder_give(p_uid, v_pay, 'PRN payout: ' || left(coalesce(n.name, 'node'), 60));
  if v_give is null or coalesce((v_give ->> 'moved')::bigint, 0) <> v_pay then
    raise exception '_fr_node_payout_core: credit failed for % (%)', p_uid, v_nonce;
  end if;
  select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = p_uid;
  return v_res || jsonb_build_object('cinder', coalesce(v_bal, 0), 'wallet_seq', coalesce(v_seq, 0));
end $$;
revoke all on function public._fr_node_payout_core(uuid, uuid, text) from public, anon, authenticated;

-- 🔌 Collect a PRN. The only way a node pays.
create or replace function public.fr_node_payout(p_node_id uuid, p_client_nonce text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public._fr_node_payout_core(auth.uid(), p_node_id, p_client_nonce);
end $$;
revoke all on function public.fr_node_payout(uuid, text) from public, anon;
grant execute on function public.fr_node_payout(uuid, text) to authenticated;

commit;

-- ===========================================================================
-- VERIFY (read-only). Expect every *_ok column = t and:
--   node_cap = 50000 (or the owner's figure), np_player_writes = f,
--   unmarked_nodes = 0, seed_rows = the node count on first apply (33 on
--   2026-09-19), tiers = 7, risk_events = 4, products = 6. node_seed_ok /
--   risk_ok / econ_ok compare the SQL ports with values computed by the JS
--   functions themselves (_nodeSeed, _nodeActiveRisk's roll, frEconomyState).
select
  (select count(*) from pg_class where oid in ('public.node_payout_config'::regclass, 'public.node_tiers'::regclass,
      'public.node_risk_events'::regclass, 'public.reserve_products'::regclass, 'public.node_payout_claims'::regclass)
      and relrowsecurity) = 5                                                                              as rls_ok,
  (select count(*) from public.node_tiers)                                                                 as tiers,
  (select count(*) from public.node_risk_events)                                                           as risk_events,
  (select count(*) from public.reserve_products)                                                           as products,
  (select count(*) from public.reserve_events where stock_mul is null) = 0                                as stock_mul_ok,
  (select daily_cinder from public.cinder_reward_caps where bucket = 'node_payout')                        as node_cap,
  (select count(*) from pg_policies where tablename = 'node_payouts' and cmd <> 'SELECT') = 0             as np_no_write_policy_ok,
  (has_table_privilege('authenticated', 'public.node_payouts', 'INSERT')
    or has_table_privilege('authenticated', 'public.node_payouts', 'UPDATE')
    or has_table_privilege('authenticated', 'public.node_payouts', 'DELETE')
    or has_table_privilege('anon', 'public.node_payouts', 'INSERT'))                                       as np_player_writes,
  has_table_privilege('authenticated', 'public.node_payouts', 'SELECT')                                   as np_read_ok,
  not (has_table_privilege('authenticated', 'public.reserve_contributions_net', 'INSERT')
    or has_table_privilege('authenticated', 'public.reserve_contributions_net', 'UPDATE')
    or has_table_privilege('authenticated', 'public.reserve_contributions_net', 'DELETE'))                as net_view_readonly_ok,
  (select count(*) from pg_policies where tablename in ('node_payout_config', 'node_tiers', 'node_risk_events',
      'reserve_products', 'node_payout_claims') and cmd <> 'SELECT') = 0                                  as no_write_policies_ok,
  (has_function_privilege('authenticated', 'public.fr_node_payout(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fr_node_payout(uuid,text)', 'EXECUTE'))                 as grants_ok,
  not (has_function_privilege('authenticated', 'public._fr_node_payout_core(uuid,uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._np_risk_pick(text,text,bigint,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._np_paid_rate(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._np_net_points(uuid)', 'EXECUTE'))                  as helpers_private_ok,
  (select count(*) from public.economy_nodes e where e.owner_id is not null
      and not exists (select 1 from public.node_payout_claims c where c.node_id = e.id and c.user_id = e.owner_id)) as unmarked_nodes,
  (select count(*) from public.node_payout_claims where kind = 'seed')                                     as seed_rows,
  exists (select 1 from pg_trigger where tgname = 'economy_nodes_payout_baseline' and tgrelid = 'public.economy_nodes'::regclass) as baseline_trigger_ok,
  (public._np_node_seed('0bc6c60b-f803-4bd8-9de5-473890c1a3b7') = 425621163
    and public._np_node_seed('9d58af05-953f-4902-8441-01aaeac441f7') = 663772036
    and public._np_node_seed('a22d13a4-9b34-42ac-891d-73df00955957') = 4197528393
    and public._np_node_seed('bd127606-995b-49cf-95a4-9008c6247f1a') = 92629874
    and public._np_node_seed('71d42444-1b47-49bb-a177-ca83d379e809') = 2871220484
    and public._np_node_seed('node-A') = 616818675
    and public._np_node_seed('') = 2166136261
    and public._np_node_seed('x') = 4245442695)
                                                                                                           as node_seed_ok,
  (public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'supply', 82890, false) is null
    and public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'supply', 82890, true) is null
    and public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'fuel', 82891, false) is null
    and public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'fuel', 82891, true) is null
    and public._np_risk_pick('a22d13a4-9b34-42ac-891d-73df00955957', 'mining', 82892, false) is null
    and public._np_risk_pick('a22d13a4-9b34-42ac-891d-73df00955957', 'mining', 82892, true) is null
    and public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'mfg', 82893, false) is null
    and public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'mfg', 82893, true) is null
    and (public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'convoy', 82894, false) ->> 'id') = 'sabotage' and (public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'convoy', 82894, false) ->> 'eff_hit')::int = 25
    and (public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'convoy', 82894, true) ->> 'id') = 'sabotage' and (public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'convoy', 82894, true) ->> 'eff_hit')::int = 15
    and public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'storage', 82895, false) is null
    and public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'storage', 82895, true) is null
    and public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'security', 82896, false) is null
    and public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'security', 82896, true) is null
    and public._np_risk_pick('a22d13a4-9b34-42ac-891d-73df00955957', 'research', 82897, false) is null
    and public._np_risk_pick('a22d13a4-9b34-42ac-891d-73df00955957', 'research', 82897, true) is null
    and (public._np_risk_pick('a22d13a4-9b34-42ac-891d-73df00955957', 'mfg', 82902, false) ->> 'id') = 'scp' and (public._np_risk_pick('a22d13a4-9b34-42ac-891d-73df00955957', 'mfg', 82902, false) ->> 'eff_hit')::int = 50
    and (public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'supply', 82908, true) ->> 'id') = 'convoy' and (public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'supply', 82908, true) ->> 'eff_hit')::int = 18
    and (public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'storage', 82913, false) ->> 'id') = 'raid' and (public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'storage', 82913, false) ->> 'eff_hit')::int = 35
    and (public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'storage', 82913, true) ->> 'id') = 'raid' and (public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'storage', 82913, true) ->> 'eff_hit')::int = 21
    and (public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'security', 82914, true) ->> 'id') = 'scp' and (public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'security', 82914, true) ->> 'eff_hit')::int = 30
    and (public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'research', 82915, false) ->> 'id') = 'sabotage' and (public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'research', 82915, false) ->> 'eff_hit')::int = 25
    and public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'research', 82915, true) is null
    and (public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'convoy', 82921, false) ->> 'id') = 'convoy' and (public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'convoy', 82921, false) ->> 'eff_hit')::int = 30
    and public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'mfg', 82938, false) is null
    and public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'mfg', 82938, true) is null
    and public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'founder', 82961, false) is null
    and public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'founder', 82961, true) is null
    and public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'convoy', 82984, false) is null
    and public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'convoy', 82984, true) is null
    and public._np_risk_pick('a22d13a4-9b34-42ac-891d-73df00955957', 'supply', 83007, false) is null
    and public._np_risk_pick('a22d13a4-9b34-42ac-891d-73df00955957', 'supply', 83007, true) is null
    and (public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'storage', 83030, false) ->> 'id') = 'sabotage' and (public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'storage', 83030, false) ->> 'eff_hit')::int = 25
    and (public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'storage', 83030, true) ->> 'id') = 'sabotage' and (public._np_risk_pick('0bc6c60b-f803-4bd8-9de5-473890c1a3b7', 'storage', 83030, true) ->> 'eff_hit')::int = 15
    and public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'fuel', 83053, false) is null
    and public._np_risk_pick('bd127606-995b-49cf-95a4-9008c6247f1a', 'fuel', 83053, true) is null
    and public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'security', 83076, false) is null
    and public._np_risk_pick('9d58af05-953f-4902-8441-01aaeac441f7', 'security', 83076, true) is null
    and public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'mining', 83099, false) is null
    and public._np_risk_pick('71d42444-1b47-49bb-a177-ca83d379e809', 'mining', 83099, true) is null)
                                                                                                           as risk_ok,
  (public._np_econ_state('{}'::jsonb, null::public.reserve_events) = 'CRISIS'
    and public._np_econ_state('{}'::jsonb, (select e from public.reserve_events e where e.id = 'fuelCrisis')) = 'CRISIS'
    and public._np_econ_state('{}'::jsonb, (select e from public.reserve_events e where e.id = 'bioLock')) = 'CRISIS'
    and public._np_econ_state('{}'::jsonb, (select e from public.reserve_events e where e.id = 'shardDrought')) = 'CRISIS'
    and public._np_econ_state('{}'::jsonb, (select e from public.reserve_events e where e.id = 'outbreak')) = 'CRISIS'
    and public._np_econ_state('{}'::jsonb, (select e from public.reserve_events e where e.id = 'reliefSurge')) = 'CRISIS'
    and public._np_econ_state('{"metal":100000,"fuel":100000,"supplies":100000,"memoryShards":100000,"corruptedEssence":100000,"dna":100000,"ammo":100000,"medicine":100000,"water":100000,"food":100000}'::jsonb, null::public.reserve_events) = 'STABLE'
    and public._np_econ_state('{"metal":100000,"fuel":100000,"supplies":100000,"memoryShards":100000,"corruptedEssence":100000,"dna":100000,"ammo":100000,"medicine":100000,"water":100000,"food":100000}'::jsonb, (select e from public.reserve_events e where e.id = 'fuelCrisis')) = 'STRAINED'
    and public._np_econ_state('{"metal":100000,"fuel":100000,"supplies":100000,"memoryShards":100000,"corruptedEssence":100000,"dna":100000,"ammo":100000,"medicine":100000,"water":100000,"food":100000}'::jsonb, (select e from public.reserve_events e where e.id = 'bioLock')) = 'STABLE'
    and public._np_econ_state('{"metal":100000,"fuel":100000,"supplies":100000,"memoryShards":100000,"corruptedEssence":100000,"dna":100000,"ammo":100000,"medicine":100000,"water":100000,"food":100000}'::jsonb, (select e from public.reserve_events e where e.id = 'shardDrought')) = 'STRAINED'
    and public._np_econ_state('{"metal":100000,"fuel":100000,"supplies":100000,"memoryShards":100000,"corruptedEssence":100000,"dna":100000,"ammo":100000,"medicine":100000,"water":100000,"food":100000}'::jsonb, (select e from public.reserve_events e where e.id = 'outbreak')) = 'STRAINED'
    and public._np_econ_state('{"metal":100000,"fuel":100000,"supplies":100000,"memoryShards":100000,"corruptedEssence":100000,"dna":100000,"ammo":100000,"medicine":100000,"water":100000,"food":100000}'::jsonb, (select e from public.reserve_events e where e.id = 'reliefSurge')) = 'STABLE'
    and public._np_econ_state('{"metal":5000,"fuel":2000,"supplies":3000,"memoryShards":1000,"corruptedEssence":4000,"dna":2000,"ammo":8000,"medicine":12000,"water":6000,"food":6000}'::jsonb, null::public.reserve_events) = 'STRAINED'
    and public._np_econ_state('{"metal":5000,"fuel":2000,"supplies":3000,"memoryShards":1000,"corruptedEssence":4000,"dna":2000,"ammo":8000,"medicine":12000,"water":6000,"food":6000}'::jsonb, (select e from public.reserve_events e where e.id = 'fuelCrisis')) = 'STRAINED'
    and public._np_econ_state('{"metal":5000,"fuel":2000,"supplies":3000,"memoryShards":1000,"corruptedEssence":4000,"dna":2000,"ammo":8000,"medicine":12000,"water":6000,"food":6000}'::jsonb, (select e from public.reserve_events e where e.id = 'bioLock')) = 'STRAINED'
    and public._np_econ_state('{"metal":5000,"fuel":2000,"supplies":3000,"memoryShards":1000,"corruptedEssence":4000,"dna":2000,"ammo":8000,"medicine":12000,"water":6000,"food":6000}'::jsonb, (select e from public.reserve_events e where e.id = 'shardDrought')) = 'STRAINED'
    and public._np_econ_state('{"metal":5000,"fuel":2000,"supplies":3000,"memoryShards":1000,"corruptedEssence":4000,"dna":2000,"ammo":8000,"medicine":12000,"water":6000,"food":6000}'::jsonb, (select e from public.reserve_events e where e.id = 'outbreak')) = 'STRAINED'
    and public._np_econ_state('{"metal":5000,"fuel":2000,"supplies":3000,"memoryShards":1000,"corruptedEssence":4000,"dna":2000,"ammo":8000,"medicine":12000,"water":6000,"food":6000}'::jsonb, (select e from public.reserve_events e where e.id = 'reliefSurge')) = 'STRAINED'
    and public._np_econ_state('{"metal":500000,"fuel":30000,"supplies":150000,"memoryShards":60000,"corruptedEssence":40000,"dna":60000,"ammo":280000,"medicine":70000,"water":200000,"food":20000}'::jsonb, null::public.reserve_events) = 'STRAINED'
    and public._np_econ_state('{"metal":500000,"fuel":30000,"supplies":150000,"memoryShards":60000,"corruptedEssence":40000,"dna":60000,"ammo":280000,"medicine":70000,"water":200000,"food":20000}'::jsonb, (select e from public.reserve_events e where e.id = 'fuelCrisis')) = 'STRAINED'
    and public._np_econ_state('{"metal":500000,"fuel":30000,"supplies":150000,"memoryShards":60000,"corruptedEssence":40000,"dna":60000,"ammo":280000,"medicine":70000,"water":200000,"food":20000}'::jsonb, (select e from public.reserve_events e where e.id = 'bioLock')) = 'STRAINED'
    and public._np_econ_state('{"metal":500000,"fuel":30000,"supplies":150000,"memoryShards":60000,"corruptedEssence":40000,"dna":60000,"ammo":280000,"medicine":70000,"water":200000,"food":20000}'::jsonb, (select e from public.reserve_events e where e.id = 'shardDrought')) = 'STRAINED'
    and public._np_econ_state('{"metal":500000,"fuel":30000,"supplies":150000,"memoryShards":60000,"corruptedEssence":40000,"dna":60000,"ammo":280000,"medicine":70000,"water":200000,"food":20000}'::jsonb, (select e from public.reserve_events e where e.id = 'outbreak')) = 'STRAINED'
    and public._np_econ_state('{"metal":500000,"fuel":30000,"supplies":150000,"memoryShards":60000,"corruptedEssence":40000,"dna":60000,"ammo":280000,"medicine":70000,"water":200000,"food":20000}'::jsonb, (select e from public.reserve_events e where e.id = 'reliefSurge')) = 'STRAINED'
    and public._np_econ_state('{"metal":12,"fuel":0,"supplies":7,"memoryShards":3}'::jsonb, null::public.reserve_events) = 'CRISIS'
    and public._np_econ_state('{"metal":12,"fuel":0,"supplies":7,"memoryShards":3}'::jsonb, (select e from public.reserve_events e where e.id = 'fuelCrisis')) = 'CRISIS'
    and public._np_econ_state('{"metal":12,"fuel":0,"supplies":7,"memoryShards":3}'::jsonb, (select e from public.reserve_events e where e.id = 'bioLock')) = 'CRISIS'
    and public._np_econ_state('{"metal":12,"fuel":0,"supplies":7,"memoryShards":3}'::jsonb, (select e from public.reserve_events e where e.id = 'shardDrought')) = 'CRISIS'
    and public._np_econ_state('{"metal":12,"fuel":0,"supplies":7,"memoryShards":3}'::jsonb, (select e from public.reserve_events e where e.id = 'outbreak')) = 'CRISIS'
    and public._np_econ_state('{"metal":12,"fuel":0,"supplies":7,"memoryShards":3}'::jsonb, (select e from public.reserve_events e where e.id = 'reliefSurge')) = 'CRISIS'
    and public._np_econ_state('{"metal":1000000,"fuel":1000000,"supplies":1000000,"memoryShards":1000000,"corruptedEssence":1000000,"dna":1000000,"ammo":1000000,"medicine":30000,"water":1000000,"food":1000000}'::jsonb, null::public.reserve_events) = 'STABLE'
    and public._np_econ_state('{"metal":1000000,"fuel":1000000,"supplies":1000000,"memoryShards":1000000,"corruptedEssence":1000000,"dna":1000000,"ammo":1000000,"medicine":30000,"water":1000000,"food":1000000}'::jsonb, (select e from public.reserve_events e where e.id = 'fuelCrisis')) = 'STABLE'
    and public._np_econ_state('{"metal":1000000,"fuel":1000000,"supplies":1000000,"memoryShards":1000000,"corruptedEssence":1000000,"dna":1000000,"ammo":1000000,"medicine":30000,"water":1000000,"food":1000000}'::jsonb, (select e from public.reserve_events e where e.id = 'bioLock')) = 'STABLE'
    and public._np_econ_state('{"metal":1000000,"fuel":1000000,"supplies":1000000,"memoryShards":1000000,"corruptedEssence":1000000,"dna":1000000,"ammo":1000000,"medicine":30000,"water":1000000,"food":1000000}'::jsonb, (select e from public.reserve_events e where e.id = 'shardDrought')) = 'STABLE'
    and public._np_econ_state('{"metal":1000000,"fuel":1000000,"supplies":1000000,"memoryShards":1000000,"corruptedEssence":1000000,"dna":1000000,"ammo":1000000,"medicine":30000,"water":1000000,"food":1000000}'::jsonb, (select e from public.reserve_events e where e.id = 'outbreak')) = 'STABLE'
    and public._np_econ_state('{"metal":1000000,"fuel":1000000,"supplies":1000000,"memoryShards":1000000,"corruptedEssence":1000000,"dna":1000000,"ammo":1000000,"medicine":30000,"water":1000000,"food":1000000}'::jsonb, (select e from public.reserve_events e where e.id = 'reliefSurge')) = 'STABLE')
                                                                                                           as econ_ok,
  (public._np_eff('{"eff":100,"lastTick":1789808400000,"cityLink":0}'::jsonb, '2026-09-19T08:00:00Z'::timestamptz, 1789819200000, 0) = 93
    and public._np_eff('{"eff":100,"lastTick":1789711200000,"cityLink":0}'::jsonb, '2026-09-19T08:00:00Z'::timestamptz, 1789819200000, 0) = 34
    and public._np_eff('{"eff":70,"lastTick":1789801200000,"cityLink":100}'::jsonb, '2026-09-19T08:00:00Z'::timestamptz, 1789819200000, 0) = 70
    and public._np_eff('{"eff":1000000,"lastTick":1789819200000,"cityLink":30}'::jsonb, '2026-09-19T08:00:00Z'::timestamptz, 1789819200000, 0) = 100
    and public._np_eff('{"eff":"abc","lastTick":1789794000000,"cityLink":96}'::jsonb, '2026-09-19T08:00:00Z'::timestamptz, 1789819200000, 0) = 93
    and public._np_eff('{"lastTick":0,"cityLink":5}'::jsonb, '2026-09-19T08:00:00Z'::timestamptz, 1789819200000, 0) = 91
    and public._np_eff('{"eff":55.5,"lastTick":1789817965433,"cityLink":"40"}'::jsonb, '2026-09-19T08:00:00Z'::timestamptz, 1789819200000, 0) = 55
    and public._np_eff('{"eff":-20,"lastTick":1789462800000,"cityLink":250}'::jsonb, '2026-09-19T08:00:00Z'::timestamptz, 1789819200000, 0) = 70)
                                                                                                           as eff_ok;
-- ===========================================================================
