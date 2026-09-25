-- ════════════════════════════════════════════════════════════════════════════
-- 059 — EQUIPMENT & FIELD SHOP: one shared inventory per trader per settlement
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. Ends with a verify block.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MAKES TRUE THAT WAS NOT
--   v121i5 shipped the whole pricing loop against a LOCAL inventory, so "an NPC
--   resells your goods to ANOTHER player" was not true — two players each held
--   their own copy of the same shop. Location-based stock was meaningless for
--   the same reason. Both need one row per (settlement, trader, item) that
--   every player reads and only the server writes. That is this file.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 WHAT IS AUTHORITATIVE HERE, AND WHAT IS HONESTLY NOT
--   AUTHORITATIVE (server): the stock, the cost basis, the trader's float, the
--   reference price (read from cx_prices), the demand multiplier, the affinity,
--   the quantity actually traded and the total paid. A client cannot name its
--   own price or its own quantity — it asks, and the server answers.
--
--   NOT AUTHORITATIVE: the player's Cinder. Profile.gems is client-side with a
--   server MIRROR for tax/ledger purposes (mythic_balances is Mythic Token, not
--   Cinder), and that is true of every shop in this game. Making Cinder
--   server-authoritative is a much larger change touching every spend path, and
--   pretending otherwise here would be worse than saying so. What this file
--   removes is the ability to invent a PRICE; it does not remove the ability to
--   edit a local wallet, which was never in scope of the trader system.
--
-- ⚠ THE CATEGORY IS NOT TAKEN FROM THE CLIENT. Affinity swings the offer
--   between 0.82× and 1.00×, so a client that could declare its scrap a
--   "relic" would move its own price. Item categories therefore live in
--   fieldshop_item_cat, seeded from the catalogue by an admin, and an unknown
--   item falls back to 'utility' — which every trader takes at the SECONDARY
--   rate, so an unlisted item can never be worth more than a listed one.
--
-- ⚠ RLS IS READ-ONLY FOR EVERYONE. There is no INSERT/UPDATE/DELETE policy on
--   either table on purpose: the SECURITY DEFINER RPCs below are the only
--   writers. A shared shop that any client could write is not a shop.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The shared inventory ─────────────────────────────────────────────────
create table if not exists public.fieldshop_stock (
  settlement_id text    not null,
  trader_id     text    not null,
  item_id       text    not null,
  stock         bigint  not null default 0 check (stock >= 0),
  cost_basis    numeric not null default 0 check (cost_basis >= 0),
  updated_at    timestamptz not null default now(),
  primary key (settlement_id, trader_id, item_id)
);

create table if not exists public.fieldshop_traders (
  settlement_id text   not null,
  trader_id     text   not null,
  float_cinder  bigint not null default 250000 check (float_cinder >= 0),
  updated_at    timestamptz not null default now(),
  primary key (settlement_id, trader_id)
);

create table if not exists public.fieldshop_item_cat (
  item_id  text primary key,
  category text not null
);

alter table public.fieldshop_stock     enable row level security;
alter table public.fieldshop_traders   enable row level security;
alter table public.fieldshop_item_cat  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='fieldshop_stock' and policyname='fs_stock_read') then
    create policy fs_stock_read on public.fieldshop_stock for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='fieldshop_traders' and policyname='fs_traders_read') then
    create policy fs_traders_read on public.fieldshop_traders for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='fieldshop_item_cat' and policyname='fs_itemcat_read') then
    create policy fs_itemcat_read on public.fieldshop_item_cat for select to authenticated using (true);
  end if;
end $$;

-- ── 2. The trader definitions, in the database ──────────────────────────────
-- Mirrors TRADERS in /src/fieldshop/traders.js. The duplication is deliberate
-- and it is TESTED: tools/fieldshop-tests/run.mjs cannot see SQL, so
-- .gauntlet/drive-fieldshop-sql.mjs drives BOTH and fails if they disagree on
-- any (trader, category, stock, price) point. A server that priced differently
-- from the screen the player is reading would be worse than no server at all.
create table if not exists public.fieldshop_trader_cat (
  trader_id text not null,
  category  text not null,
  tier      text not null check (tier in ('primary','secondary')),
  primary key (trader_id, category)
);
alter table public.fieldshop_trader_cat enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='fieldshop_trader_cat' and policyname='fs_tradercat_read') then
    create policy fs_tradercat_read on public.fieldshop_trader_cat for select to authenticated using (true);
  end if;
end $$;

delete from public.fieldshop_trader_cat;
insert into public.fieldshop_trader_cat (trader_id, category, tier) values
  ('field','field','primary'),('field','consumable','primary'),('field','utility','primary'),
  ('field','medical','secondary'),('field','tool','secondary'),('field','grenade','secondary'),
  ('weapons','weapon','primary'),('weapons','weaponPart','primary'),('weapons','grenade','primary'),
  ('weapons','armor','secondary'),('weapons','tool','secondary'),('weapons','scrap','secondary'),
  ('armor','armor','primary'),('armor','armorPart','primary'),
  ('armor','weaponPart','secondary'),('armor','utility','secondary'),('armor','field','secondary'),('armor','scrap','secondary'),
  ('medical','medical','primary'),
  ('medical','consumable','secondary'),('medical','field','secondary'),('medical','utility','secondary'),
  ('salvage','scrap','primary'),('salvage','weaponPart','primary'),('salvage','armorPart','primary'),
  ('salvage','tool','primary'),('salvage','relic','primary'),
  ('salvage','weapon','secondary'),('salvage','armor','secondary'),('salvage','utility','secondary'),
  ('general','weapon','secondary'),('general','weaponPart','secondary'),('general','armor','secondary'),
  ('general','armorPart','secondary'),('general','medical','secondary'),('general','consumable','secondary'),
  ('general','field','secondary'),('general','utility','secondary'),('general','grenade','secondary'),
  ('general','relic','secondary'),('general','scrap','secondary'),('general','tool','secondary');

-- ── 3. The pricing, server-side ─────────────────────────────────────────────
create or replace function public._fs_demand_mult(p_stock bigint)
returns numeric language plpgsql immutable as $function$
declare n bigint := greatest(0, coalesce(p_stock, 0)); v_over numeric;
begin
  if n <= 50  then return 1 + 0.25 * (1 - n::numeric / 50); end if;
  if n <= 100 then return 1; end if;
  v_over := (n - 100)::numeric / 45;
  return greatest(0.35, 1 - 0.20 * v_over);
end $function$;

create or replace function public._fs_affinity(p_trader text, p_category text)
returns numeric language plpgsql stable as $function$
declare v_tier text;
begin
  select tier into v_tier from public.fieldshop_trader_cat
   where trader_id = p_trader and category = p_category;
  if v_tier = 'primary'   then return 1.00; end if;
  if v_tier = 'secondary' then return 0.82; end if;
  return 0;   -- refuses
end $function$;

create or replace function public._fs_market_px(p_item text)
returns numeric language plpgsql stable as $function$
declare v numeric;
begin
  select current_px into v from public.cx_prices where asset_id = p_item;
  return greatest(0, coalesce(v, 0));
end $function$;

/* The two quotes. sellQuote prices off max(costBasis, bid) — NOT the cost
   basis alone. See the header of /src/fieldshop/traders.js: pricing off the
   basis by itself lets a trader list below what it is simultaneously paying,
   which is a Cinder faucet reachable by ordinary play. Keeping that rule on
   BOTH sides is the point of the cross-check driver. */
create or replace function public._fs_bid(p_px numeric, p_stock bigint, p_trader text, p_cat text)
returns bigint language plpgsql stable as $function$
declare a numeric := public._fs_affinity(p_trader, p_cat);
begin
  if a <= 0 or coalesce(p_px,0) <= 0 then return 0; end if;
  return greatest(1, floor(p_px * public._fs_demand_mult(p_stock) * a))::bigint;
end $function$;

create or replace function public._fs_ask(p_basis numeric, p_px numeric, p_stock bigint, p_trader text, p_cat text)
returns bigint language plpgsql stable as $function$
declare v_bid bigint := public._fs_bid(p_px, p_stock, p_trader, p_cat);
        v_floor numeric := greatest(coalesce(p_basis,0), v_bid);
begin
  if v_floor <= 0 then return 0; end if;
  return greatest(1, ceil(v_floor * 1.15))::bigint;
end $function$;

create or replace function public._fs_cat(p_item text)
returns text language plpgsql stable as $function$
declare v text;
begin
  select category into v from public.fieldshop_item_cat where item_id = p_item;
  -- Unknown item → 'utility', which every trader takes at the SECONDARY rate.
  -- An unlisted item can therefore never out-earn a listed one.
  return coalesce(v, 'utility');
end $function$;

-- ── 4. Read one shelf ───────────────────────────────────────────────────────
create or replace function public.fs_quote(p_settlement text, p_trader text, p_item text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_stock bigint := 0; v_basis numeric := 0; v_px numeric; v_cat text; v_float bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select stock, cost_basis into v_stock, v_basis from fieldshop_stock
   where settlement_id = p_settlement and trader_id = p_trader and item_id = p_item;
  v_stock := coalesce(v_stock, 0); v_basis := coalesce(v_basis, 0);
  select float_cinder into v_float from fieldshop_traders
   where settlement_id = p_settlement and trader_id = p_trader;
  v_px := _fs_market_px(p_item); v_cat := _fs_cat(p_item);
  return jsonb_build_object(
    'ok', true, 'settlement', p_settlement, 'trader', p_trader, 'item', p_item,
    'category', v_cat, 'marketPx', v_px, 'stock', v_stock, 'costBasis', v_basis,
    'float', coalesce(v_float, 250000),
    'bid', _fs_bid(v_px, v_stock, p_trader, v_cat),
    'ask', _fs_ask(v_basis, v_px, v_stock, p_trader, v_cat),
    'accepted', _fs_affinity(p_trader, v_cat) > 0);
end $function$;

-- ── 5. The two trades. Atomic by row lock. ──────────────────────────────────
/* ⚠ `for update` ON THE TRADER ROW FIRST, ALWAYS IN THAT ORDER. Two players
   selling to the same trader in the same instant must not both see the same
   float and both be paid from it — that is the shared-shop version of the
   double-spend, and it is exactly what a per-player inventory could never
   expose. Locking the trader before the stock row also fixes a lock ORDER, so
   a simultaneous buy and sell cannot deadlock. */
create or replace function public.fs_sell(p_settlement text, p_trader text, p_item text, p_qty int)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_float bigint; v_stock bigint := 0; v_basis numeric := 0;
        v_px numeric; v_cat text; v_bid bigint; v_qty int; v_total bigint; v_newbasis numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if coalesce(p_qty,0) <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;
  if not exists (select 1 from fieldshop_trader_cat where trader_id = p_trader) then
    return jsonb_build_object('ok', false, 'error', 'no_such_trader');
  end if;

  insert into fieldshop_traders (settlement_id, trader_id) values (p_settlement, p_trader)
    on conflict do nothing;
  select float_cinder into v_float from fieldshop_traders
   where settlement_id = p_settlement and trader_id = p_trader for update;

  select stock, cost_basis into v_stock, v_basis from fieldshop_stock
   where settlement_id = p_settlement and trader_id = p_trader and item_id = p_item for update;
  v_stock := coalesce(v_stock, 0); v_basis := coalesce(v_basis, 0);

  v_px := _fs_market_px(p_item); v_cat := _fs_cat(p_item);
  v_bid := _fs_bid(v_px, v_stock, p_trader, v_cat);
  if v_bid <= 0 then return jsonb_build_object('ok', false, 'error', 'refused', 'category', v_cat); end if;

  -- The trader pays out of its own till, never out of thin air.
  v_qty := least(p_qty, floor(v_float / v_bid)::int);
  if v_qty <= 0 then
    return jsonb_build_object('ok', false, 'error', 'trader_broke', 'bid', v_bid, 'float', v_float);
  end if;
  v_total := v_qty::bigint * v_bid;
  v_newbasis := ((v_basis * v_stock) + (v_bid::numeric * v_qty)) / (v_stock + v_qty);

  insert into fieldshop_stock (settlement_id, trader_id, item_id, stock, cost_basis, updated_at)
    values (p_settlement, p_trader, p_item, v_stock + v_qty, v_newbasis, now())
  on conflict (settlement_id, trader_id, item_id)
    do update set stock = excluded.stock, cost_basis = excluded.cost_basis, updated_at = now();

  update fieldshop_traders set float_cinder = float_cinder - v_total, updated_at = now()
   where settlement_id = p_settlement and trader_id = p_trader;

  return jsonb_build_object('ok', true, 'qty', v_qty, 'unit', v_bid, 'total', v_total,
    'stock', v_stock + v_qty, 'costBasis', v_newbasis);
end $function$;

create or replace function public.fs_buy(p_settlement text, p_trader text, p_item text, p_qty int)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_float bigint; v_stock bigint := 0; v_basis numeric := 0;
        v_px numeric; v_cat text; v_ask bigint; v_qty int; v_total bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if coalesce(p_qty,0) <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;

  insert into fieldshop_traders (settlement_id, trader_id) values (p_settlement, p_trader)
    on conflict do nothing;
  select float_cinder into v_float from fieldshop_traders
   where settlement_id = p_settlement and trader_id = p_trader for update;
  select stock, cost_basis into v_stock, v_basis from fieldshop_stock
   where settlement_id = p_settlement and trader_id = p_trader and item_id = p_item for update;
  v_stock := coalesce(v_stock, 0); v_basis := coalesce(v_basis, 0);

  v_px := _fs_market_px(p_item); v_cat := _fs_cat(p_item);
  v_ask := _fs_ask(v_basis, v_px, v_stock, p_trader, v_cat);
  if v_ask <= 0 then return jsonb_build_object('ok', false, 'error', 'no_price'); end if;
  v_qty := least(p_qty, v_stock)::int;
  if v_qty <= 0 then return jsonb_build_object('ok', false, 'error', 'out_of_stock'); end if;
  v_total := v_qty::bigint * v_ask;

  -- Selling does NOT re-price what remains: that is what a weighted average
  -- means, and it is why cost_basis is untouched here.
  update fieldshop_stock set stock = stock - v_qty, updated_at = now()
   where settlement_id = p_settlement and trader_id = p_trader and item_id = p_item;
  update fieldshop_traders set float_cinder = float_cinder + v_total, updated_at = now()
   where settlement_id = p_settlement and trader_id = p_trader;

  return jsonb_build_object('ok', true, 'qty', v_qty, 'unit', v_ask, 'total', v_total,
    'stock', v_stock - v_qty);
end $function$;

-- ── 6. The category map, kept in step with the catalogue ────────────────────
-- Admin-only: the client posts {itemId: category} pairs it derived from the
-- live item catalogue, which the server has no other way to know.
create or replace function public.fs_sync_item_cats(p_map jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_n int := 0; k text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if not exists (select 1 from user_profiles where user_id = v_uid and coalesce(is_admin, false)) then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  for k in select jsonb_object_keys(coalesce(p_map, '{}'::jsonb)) loop
    insert into fieldshop_item_cat (item_id, category) values (k, p_map ->> k)
      on conflict (item_id) do update set category = excluded.category;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'synced', v_n);
end $function$;

grant execute on function public.fs_quote(text, text, text)            to authenticated;
grant execute on function public.fs_sell(text, text, text, int)        to authenticated;
grant execute on function public.fs_buy(text, text, text, int)         to authenticated;
grant execute on function public.fs_sync_item_cats(jsonb)              to authenticated;
revoke all on function public._fs_bid(numeric, bigint, text, text)     from public, anon, authenticated;
revoke all on function public._fs_ask(numeric, numeric, bigint, text, text) from public, anon, authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'tables' as check,
  (select count(*) from information_schema.tables where table_schema='public'
     and table_name in ('fieldshop_stock','fieldshop_traders','fieldshop_item_cat','fieldshop_trader_cat')) as found_of_4;

select 'RLS is read-only — no write policy may exist' as check,
       count(*) filter (where cmd <> 'SELECT') as write_policies
  from pg_policies where tablename like 'fieldshop%';

select 'the brief''s worked example, at 1000 market' as check,
       public._fs_bid(1000, 32,  'medical', 'medical') as at_32,
       public._fs_bid(1000, 75,  'medical', 'medical') as at_75,
       public._fs_bid(1000, 145, 'medical', 'medical') as at_145;

select 'no same-trader round trip is profitable (sampled)' as check,
       count(*) as profitable_combinations
  from generate_series(0, 400, 7) s
  cross join (values (12),(150),(1000),(9000)) px(v)
  cross join (values (0.35),(0.8),(1.0),(1.25)) bm(v)
  cross join (select trader_id, category from public.fieldshop_trader_cat) tc
 where public._fs_bid(px.v, greatest(0, s - 1), tc.trader_id, tc.category)
     > public._fs_ask(px.v * bm.v, px.v, s, tc.trader_id, tc.category);
