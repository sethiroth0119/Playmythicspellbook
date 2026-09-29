-- ===========================================================================
-- 158 · A CAMP HIRE IS PRICED BY THE SERVER, NEVER BY THE HIRER'S DEVICE.
-- DRAFT — NOT APPLIED. Paste into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
-- Ends with a verify SELECT.
--
-- THE ASK (owner, 2026-09-17): "Hire prices for camp workers are set by the
-- player's device, so a player could pick their own price. Fix this server side
-- and make sure server side works great."
--
-- THE HOLE. camp_hire_from_city(p_city_id, p_role, p_qty, p_cost) (sql/088)
-- charged EXACTLY p_cost — a number the client computed in _campHireCost() and
-- sent along. It skipped the charge entirely when p_cost <= 0. So from a
-- console: rpc('camp_hire_from_city', {..., p_qty: 50, p_cost: 0}) moved fifty
-- residents out of another player's city for nothing. p_cost was also a TOTAL,
-- not a per-worker price, so even an honest-looking p_cost bought p_qty workers.
--
-- WHAT THE LIVE DATA SAYS (read-only, 2026-09-17): 208 'Hired %' charges in
-- wallet_ledger, all qty 1, 2026-09-10 .. 09-15; sum(city_labour_pool.hired)
-- is also 208, so no hire has ever gone through uncharged. Every one of the 208
-- amounts equals the client formula evaluated against the hirer's registered
-- node on tw_world_map (Builder 90, Guard 110, Farmer 70, Doctor 190,
-- Engineer 200, Mechanic 130 / 91 prime on N-26 METAL, Merchant 120,
-- Researcher 220, Civilian 31 = prime on every node whose resource has no
-- mapped trade). NOBODY HAS UNDERPAID. This closes the door before anyone does.
--
-- THE PRICE, REPRODUCED EXACTLY. The client formula (index.html _campHireCost):
--     Math.round(wage * 5 * tierMul(node) * (primeRole(node) === role ? 0.7 : 1))
--     tierMul   = 1 + (tier - 1) * 0.25,  tier = digits of node.difficulty, || 1
--     primeRole = PRIME_MAP[first key of node.resourceYield, upper-cased] || 'Civilian'
-- The server evaluates the same expression in float8 (IEEE double, the same as
-- JS) and rounds with floor(x + 0.5) (= Math.round for positives). This matters:
-- Civilian prime is 45 * 0.7 = 31.499999999999996 in double, so it is 31, not
-- 32 — and the 15 live Civilian hires were charged 31. A numeric() evaluation
-- would say 31.5 -> 32 and overcharge every one of them by 1.
--   · camp_hire_prices.cinder is the wage*5 figure (the 5-day advance at tier 1,
--     non-prime) per role — seeded from CAMP_WORKER_ROLES, numbers identical.
--   · camp_hire_rules holds the tier step, the prime discount and the
--     resource -> prime trade map (seeded from _nodePrimeRole, identical).
--   · the NODE comes from tw_world_map (the admin-published shared map; RLS:
--     is_admin() to write), never from the caller's user_profiles.forge copy,
--     which is player-writable and measured to differ between players (17
--     profiles have N-02 as FUEL, the live map says ETHER).
--   ⚠ The client's PRIME_MAP keys (FOOD, STEEL, METAL, WOOD, MEDICINE, FUEL,
--     RESEARCH, GOLD) do not match most live map resources (MED, ELEC, ETHER,
--     CRYSTAL, BIO, RELIC) — so most nodes' prime trade is Civilian. That is the
--     CURRENT behaviour and it is reproduced, not fixed, here. Changing it is a
--     one-row admin edit of camp_hire_rules.prime_map (owner decision).
--
-- COMPATIBILITY. The signature is UNCHANGED — (uuid, text, integer, integer) —
-- and p_cost is accepted and IGNORED. Live v175 clients keep calling it
-- unchanged; they are charged the server price and adopt the balance returned
-- (bug-mtyp80rx path), so an old client that asks to pay 0 pays the real price.
-- The response now also carries unit_price and price_source='server'.
--
-- SAFE TO RE-RUN. Seeds use ON CONFLICT DO NOTHING so an admin's edit to a
-- price is never reverted by a re-run.
-- ===========================================================================

-- ── 1. THE PRICE LIST ──────────────────────────────────────────────────────
create table if not exists public.camp_hire_prices (
  role       text        primary key,
  -- the 5-day wage advance at tier 1 for a non-prime trade (= wage * 5)
  cinder     integer     not null check (cinder >= 0 and cinder <= 10000000),
  updated_at timestamptz not null default now()
);

insert into public.camp_hire_prices (role, cinder) values
  ('Builder',    90),   -- wage 18
  ('Guard',     110),   -- wage 22
  ('Farmer',     70),   -- wage 14
  ('Doctor',    190),   -- wage 38
  ('Engineer',  200),   -- wage 40
  ('Mechanic',  130),   -- wage 26
  ('Researcher',220),   -- wage 44
  ('Merchant',  120),   -- wage 24
  ('Civilian',   45)    -- wage 9
on conflict (role) do nothing;

-- ── 2. THE RULES (one row) ─────────────────────────────────────────────────
create table if not exists public.camp_hire_rules (
  id         integer     primary key default 1 check (id = 1),
  tier_step  numeric     not null default 0.25 check (tier_step >= 0 and tier_step <= 10),
  prime_mul  numeric     not null default 0.7  check (prime_mul >= 0 and prime_mul <= 10),
  -- node resource (upper-case) -> the trade that node is "rich in"
  prime_map  jsonb       not null default '{}'::jsonb check (jsonb_typeof(prime_map) = 'object'),
  updated_at timestamptz not null default now()
);

insert into public.camp_hire_rules (id, tier_step, prime_mul, prime_map) values
  (1, 0.25, 0.7, '{"FOOD":"Farmer","STEEL":"Builder","METAL":"Mechanic","WOOD":"Builder","MEDICINE":"Doctor","FUEL":"Engineer","RESEARCH":"Researcher","GOLD":"Merchant"}'::jsonb)
on conflict (id) do nothing;

create or replace function public._camp_hire_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists camp_hire_prices_touch on public.camp_hire_prices;
create trigger camp_hire_prices_touch before update on public.camp_hire_prices
  for each row execute function public._camp_hire_touch();
drop trigger if exists camp_hire_rules_touch on public.camp_hire_rules;
create trigger camp_hire_rules_touch before update on public.camp_hire_rules
  for each row execute function public._camp_hire_touch();

-- ── 3. RLS — read by any signed-in player, written by admins only ─────────
-- is_admin() is the project's JWT-email admin check (same as tw_world_map's
-- twm_ins / twm_upd). A price list is not private: the board shows it.
alter table public.camp_hire_prices enable row level security;
alter table public.camp_hire_rules  enable row level security;

drop policy if exists chp_sel on public.camp_hire_prices;
drop policy if exists chp_ins on public.camp_hire_prices;
drop policy if exists chp_upd on public.camp_hire_prices;
drop policy if exists chp_del on public.camp_hire_prices;
create policy chp_sel on public.camp_hire_prices for select to authenticated using (true);
create policy chp_ins on public.camp_hire_prices for insert to authenticated with check (public.is_admin());
create policy chp_upd on public.camp_hire_prices for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy chp_del on public.camp_hire_prices for delete to authenticated using (public.is_admin());

drop policy if exists chr_sel on public.camp_hire_rules;
drop policy if exists chr_ins on public.camp_hire_rules;
drop policy if exists chr_upd on public.camp_hire_rules;
drop policy if exists chr_del on public.camp_hire_rules;
create policy chr_sel on public.camp_hire_rules for select to authenticated using (true);
create policy chr_ins on public.camp_hire_rules for insert to authenticated with check (public.is_admin());
create policy chr_upd on public.camp_hire_rules for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy chr_del on public.camp_hire_rules for delete to authenticated using (public.is_admin());

revoke all on public.camp_hire_prices from anon;
revoke all on public.camp_hire_rules  from anon;
grant select, insert, update, delete on public.camp_hire_prices to authenticated;
grant select, insert, update, delete on public.camp_hire_rules  to authenticated;

-- ── 4. THE PRICE FUNCTION — one copy, used by the quote AND the hire ───────
-- Returns NULL for an unknown role, or a node that is not on the world map
-- (the client cannot hire there either: getCampNode() returns null).
create or replace function public._camp_hire_unit_price(p_node text, p_role text)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_base   integer;
  v_rules  public.camp_hire_rules;
  v_nd     jsonb;
  v_digits text;
  v_tier   integer;
  v_res    text;
  v_prime  text;
  v_x      float8;
begin
  select cinder into v_base from public.camp_hire_prices where role = p_role;
  if v_base is null then return null; end if;

  select e.value into v_nd
    from public.tw_world_map w, jsonb_array_elements(
           case when jsonb_typeof(w.doc->'nodes') = 'array' then w.doc->'nodes' else '[]'::jsonb end) e
   where w.id = 1 and e.value->>'id' = p_node
   limit 1;
  if v_nd is null then return null; end if;

  select * into v_rules from public.camp_hire_rules where id = 1;
  if v_rules.id is null then
    v_rules.tier_step := 0.25; v_rules.prime_mul := 0.7; v_rules.prime_map := '{}'::jsonb;
  end if;

  -- JS: parseInt(String(node.difficulty || 'T1').replace(/[^0-9]/g, ''), 10) || 1
  v_digits := regexp_replace(coalesce(nullif(v_nd->>'difficulty', ''), 'T1'), '[^0-9]', '', 'g');
  v_tier := case when v_digits = '' then 1 else coalesce(nullif(left(v_digits, 9)::integer, 0), 1) end;

  -- JS: Object.keys(node.resourceYield || {})[0]. Every live node has exactly
  -- one key (measured), so jsonb's key re-ordering cannot pick a different one.
  if jsonb_typeof(v_nd->'resourceYield') = 'object' then
    select k into v_res from jsonb_object_keys(v_nd->'resourceYield') k limit 1;
  end if;
  v_prime := coalesce(v_rules.prime_map->>upper(coalesce(v_res, '')), 'Civilian');

  -- float8 on purpose — see the header (Civilian prime is 31, not 32).
  v_x := v_base::float8 * (1::float8 + (v_tier - 1)::float8 * v_rules.tier_step::float8);
  if v_prime = p_role then v_x := v_x * v_rules.prime_mul::float8; end if;
  return greatest(0, floor(v_x + 0.5))::integer;
end $$;

revoke all on function public._camp_hire_unit_price(text, text) from public, anon, authenticated;

-- ── 5. THE QUOTE — what the board shows, from the same function ────────────
create or replace function public.camp_hire_quote()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_node text;
  v_out  jsonb := '{}'::jsonb;
  r      record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'why', 'Sign in to see prices.'); end if;
  select node_id into v_node from public.tw_camp_registrations where user_id = v_uid;
  if v_node is null then return jsonb_build_object('ok', false, 'why', 'Register your camp to a District Node first.'); end if;
  for r in select role from public.camp_hire_prices loop
    v_out := v_out || jsonb_build_object(r.role, public._camp_hire_unit_price(v_node, r.role));
  end loop;
  return jsonb_build_object('ok', true, 'node_id', v_node, 'prices', v_out, 'price_source', 'server');
end $$;

revoke all on function public.camp_hire_quote() from public, anon;
grant execute on function public.camp_hire_quote() to authenticated;

-- ── 6. THE HIRE — same signature, p_cost IGNORED ───────────────────────────
create or replace function public.camp_hire_from_city(p_city_id uuid, p_role text, p_qty integer, p_cost integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_node     text;
  v_owner    uuid;
  v_want     integer;
  v_avail    integer;
  v_city     text;
  v_cityown  uuid;
  v_citynode text;
  v_unit     integer;
  v_total    bigint;
  v_take     jsonb;
  v_bal      bigint;
  v_seq      bigint;
begin
  -- 🔴 p_cost IS NOT READ ANYWHERE BELOW. It stays in the signature only so the
  --    live v175 client (which still sends it) keeps resolving to this function.
  --    Reading it for anything — even a "refuse if it disagrees" check — would
  --    hand the price back to the device.
  if v_uid is null then raise exception 'not signed in'; end if;
  v_want := greatest(0, least(50, coalesce(p_qty, 0)));
  if v_want <= 0 then return jsonb_build_object('ok', false, 'why', 'Ask for at least one worker.'); end if;

  -- Unknown trade: refused before anything else is looked at or locked.
  if not exists (select 1 from public.camp_hire_prices where role = p_role) then
    return jsonb_build_object('ok', false, 'why', 'Nobody hires ' || coalesce(p_role, 'that trade') || ' here.');
  end if;

  select node_id into v_node from public.tw_camp_registrations where user_id = v_uid;
  if v_node is null then
    return jsonb_build_object('ok', false, 'why', 'Register your camp to a District Node first.');
  end if;

  select o.user_id into v_owner from public.tw_node_owners o where o.node_id = v_node;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'why', 'Nobody owns that node yet, so there is no one to hire from.');
  end if;
  if v_owner = v_uid then
    return jsonb_build_object('ok', false, 'why', 'You own this node. Register with another player''s node to hire their residents.');
  end if;

  select cp.city_name, cp.owner_id, cp.node_id
    into v_city, v_cityown, v_citynode
    from public.city_profiles cp where cp.id = p_city_id;
  if v_city is null then return jsonb_build_object('ok', false, 'why', 'That city is gone.'); end if;
  if v_cityown = v_uid then
    return jsonb_build_object('ok', false, 'why', 'That is your own city.');
  end if;
  -- the same reach test camp_labour_market uses (088b)
  if not (v_citynode = v_node or v_cityown = v_owner) then
    return jsonb_build_object('ok', false, 'why',
      v_city || ' is not in reach of your camp. Register with the node whose owner runs it.');
  end if;

  -- 💰 THE PRICE IS THE SERVER'S: role + the registered node on the shared map.
  v_unit := public._camp_hire_unit_price(v_node, p_role);
  if v_unit is null then
    return jsonb_build_object('ok', false, 'why', 'Your camp''s node is not on the world map, so there is no price for this hire.');
  end if;
  -- PER WORKER. 088 charged p_cost once for up to 50 workers.
  v_total := v_unit::bigint * v_want;

  -- 🔒 LOCK, THEN MEASURE (two camps hiring the last farmer at once).
  select available into v_avail from public.city_labour_pool
   where city_id = p_city_id and role = p_role
   for update;
  if v_avail is null then
    return jsonb_build_object('ok', false, 'why', 'That city is not offering ' || coalesce(p_role, 'that trade') || '.');
  end if;
  if v_avail < v_want then
    return jsonb_build_object('ok', false, 'why',
      v_city || ' has only ' || v_avail || ' ' || coalesce(p_role, 'worker') || ' looking for work.');
  end if;

  -- _ct_cinder_take RAISES on a short wallet (it has no ok field). The block is
  -- a savepoint: a refusal undoes the take and returns before the pool moves,
  -- so a short wallet writes NOTHING. Caught narrowly (raise_exception only).
  if v_total > 0 then
    begin
      v_take := public._ct_cinder_take(v_uid, v_total,
                  'Hired ' || v_want || ' ' || p_role || ' from ' || v_city);
    exception when raise_exception then
      select g.cinder into v_bal from public.user_progress g where g.user_id = v_uid;
      return jsonb_build_object('ok', false, 'why', 'Not enough Cinder — this costs ' || v_total || '.',
                                'cost', v_total, 'unit_price', v_unit, 'balance', coalesce(v_bal, 0),
                                'price_source', 'server');
    end;
    v_bal := (v_take->>'balance')::bigint;
    v_seq := (v_take->>'wallet_seq')::bigint;
  else
    -- an admin priced it at 0: still return the real balance, not null
    select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = v_uid;
  end if;

  update public.city_labour_pool
     set available  = available - v_want,
         hired      = hired + v_want,
         updated_at = now()
   where city_id = p_city_id and role = p_role;

  return jsonb_build_object('ok', true, 'hired', v_want, 'cost', v_total, 'unit_price', v_unit,
                            'price_source', 'server',
                            'city_name', v_city, 'role', p_role,
                            'balance', v_bal, 'wallet_seq', v_seq);
end $$;

-- CREATE OR REPLACE keeps the existing ACL; restated so a fresh database matches.
revoke all on function public.camp_hire_from_city(uuid, text, integer, integer) from public, anon;
grant execute on function public.camp_hire_from_city(uuid, text, integer, integer) to authenticated;

-- ── 7. VERIFY ──────────────────────────────────────────────────────────────
-- Expect: 9 price rows; rules row present; RLS on both; 8 policies; the hire
-- function body no longer mentions p_cost outside its comment/signature; and
-- every live hire's charge equals what the server would charge today
-- (mismatches = 0 on the data measured 2026-09-17).
select
  (select count(*) from public.camp_hire_prices)                                   as price_rows,
  (select count(*) from public.camp_hire_rules)                                    as rules_rows,
  (select relrowsecurity from pg_class where oid = 'public.camp_hire_prices'::regclass) as prices_rls,
  (select relrowsecurity from pg_class where oid = 'public.camp_hire_rules'::regclass)  as rules_rls,
  (select count(*) from pg_policy where polrelid in ('public.camp_hire_prices'::regclass, 'public.camp_hire_rules'::regclass)) as policies,
  (position('_camp_hire_unit_price' in pg_get_functiondef('public.camp_hire_from_city(uuid,text,integer,integer)'::regprocedure)) > 0) as hire_uses_server_price,
  (select count(*) from (
     select -l.delta amt, public._camp_hire_unit_price(r.node_id, substring(l.reason from '^Hired \d+ (\S+) ')) exp
       from public.wallet_ledger l
       join public.tw_camp_registrations r on r.user_id = l.user_id
      where l.reason like 'Hired %') x where x.amt is distinct from x.exp)          as live_hire_mismatches;
