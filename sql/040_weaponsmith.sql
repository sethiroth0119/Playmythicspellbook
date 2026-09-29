-- ===========================================================================
-- 038 — THE WEAPON SMITH. Server-side truth for crafted weapons, blueprint
--       entitlements and shop reputation.
--
-- Three tables and four functions. The design is docs/weaponsmith-design.md;
-- what follows is why each piece is shaped the way it is.
--
-- 🔴 WHY ANY OF THIS IS ON THE SERVER AT ALL.
--    Crafted weapons are SELLABLE. A stat block computed on the client and
--    posted to a table is a forged stat block — one console call away from a
--    +99 ATK rifle on the open market. So the client posts WHAT IT DID (the
--    blueprint, the parts, the build log) and the server decides what it got.
--    ws_mint recomputes quality and stats from scratch and CLAMPS TO THE
--    BLUEPRINT BUDGET. The client's own arithmetic is never trusted, never
--    read, and never stored.
--
-- 🔴 WHY BLUEPRINTS ARE A ROW AND NOT A FLAG.
--    A blueprint can be bought with AZA, which is real money (Profile
--    .sovereigns, purchased through Stripe). Profile.gems and
--    Profile.sovereigns are deliberately NOT uploaded to the cloud save, so a
--    local flag is a device-local cache — and the Oil Sim already stores its
--    Aza-bought licences that way (_osimState.blueprints). For a real-money
--    purchase that means a device change or a cache clear destroys something
--    the player paid cash for. Do not copy that pattern. ws_blueprints_owned
--    is the record, written in the same transaction as the charge and
--    verified against the sov_charge ledger id.
--
-- 🔴 WHY REPUTATION IS ON THE SERVER, for a different reason.
--    Rep gates content — blueprint tiers and concurrent contract slots. A
--    number that decides what a player may unlock cannot live somewhere they
--    can edit it. ws_shop is the record; the client keeps a mirror purely so
--    the bench can draw something before the round-trip returns.
--
-- RLS IS THE ENTIRE SECURITY BOUNDARY (CLAUDE.md). Every table below is
-- owner-scoped on select and `with check (false)` on write, so every mutation
-- has to go through a SECURITY DEFINER function. Review the policies line by
-- line: a missing `using (owner_id = auth.uid())` is a data breach and looks
-- fine in review.
--
-- ⚠ jsonb_exists() is used instead of the `?` operator throughout. They mean
--   the same thing, but `?` is also the bind placeholder for several drivers,
--   so a function body containing it can be mangled by whatever ships it.
--
-- ⚠ RLS RECURSION. Nothing here has a policy that queries its own table, and
--   it must stay that way. If a membership-style check is ever needed, route
--   it through a SECURITY DEFINER helper the way is_community_member does.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. BLUEPRINT CATALOGUE — server's copy of the point budgets.
--
-- ⚠ THIS TABLE IS THE REASON ws_mint CAN BE TRUSTED. The budget cannot come
--   from the client, or "clamp to the budget" clamps to whatever number the
--   caller sent. It is a small, admin-owned catalogue: public-read so the shop
--   can price things, and writable by nobody through the API.
--
-- ⚠ KEEP IN STEP WITH src/weaponsmith/blueprints.js. Two copies of a number is
--   normally a smell, and here it is deliberate — the client copy drives the
--   UI, this one decides the outcome. They are checked against each other by
--   the verify query at the bottom; if they ever disagree, THIS ONE WINS and
--   the client is the thing that is wrong.
-- ---------------------------------------------------------------------------
create table if not exists public.ws_blueprints (
  id          text primary key,
  name        text not null,
  tier        int  not null default 1 check (tier between 1 and 5),
  slot_type   text not null default 'primeWeapon',
  budget      int  not null check (budget >= 0 and budget <= 60),
  weapon      jsonb not null default '{}'::jsonb,   -- { range, crit } — class properties, NOT budget
  aza_price   int,                                  -- null = not sold for Aza
  rep_required int not null default 0,              -- 0 = not gated on reputation
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.ws_blueprints (id, name, tier, slot_type, budget, weapon, aza_price, rep_required) values
  ('ws_bp_carbine',  'Field Carbine',   1, 'primeWeapon',     8,  '{"range":2}'::jsonb,          null,  0),
  ('ws_bp_sidearm',  'Sidearm',         1, 'secondaryWeapon', 4,  '{"range":1}'::jsonb,          null,  0),
  ('ws_bp_breacher', 'Breacher',        2, 'primeWeapon',     14, '{"range":1,"crit":8}'::jsonb, 12,   20),
  ('ws_bp_lance',    'Pulse Lance',     2, 'primeWeapon',     10, '{"range":2}'::jsonb,          12,   20),
  ('ws_bp_marksman', 'Marksman Rifle',  3, 'primeWeapon',     14, '{"range":3}'::jsonb,          22,   45)
on conflict (id) do update
  set name = excluded.name, tier = excluded.tier, slot_type = excluded.slot_type,
      budget = excluded.budget, weapon = excluded.weapon,
      aza_price = excluded.aza_price, rep_required = excluded.rep_required;

alter table public.ws_blueprints enable row level security;
drop policy if exists wsbp_sel on public.ws_blueprints;
create policy wsbp_sel on public.ws_blueprints for select to authenticated using (enabled);
-- No insert/update/delete policy at all. A table with RLS on and no write
-- policy is closed to the API entirely; the catalogue is edited in the SQL
-- editor, which is exactly the access level it should need.

-- ---------------------------------------------------------------------------
-- 2. ENTITLEMENTS — what this player may build.
--
-- One row per (owner, blueprint) so a grant is naturally idempotent: buying
-- twice cannot happen, and a retried grant is a no-op rather than a double
-- charge.
-- ---------------------------------------------------------------------------
create table if not exists public.ws_blueprints_owned (
  owner_id      uuid not null references auth.users(id) on delete cascade,
  blueprint_id  text not null references public.ws_blueprints(id) on delete cascade,
  source        text not null check (source in ('aza', 'loot', 'rep', 'grant')),
  aza_ledger_id uuid,                    -- set when source='aza'; the sov_charge receipt
  granted_at    timestamptz not null default now(),
  primary key (owner_id, blueprint_id)
);

-- 🔴 ONE LEDGER ID CAN BUY ONE BLUEPRINT. Without this a client could call
--    ws_grant_blueprint repeatedly with the SAME receipt and collect the whole
--    catalogue for one purchase. The primary key above stops a repeat of the
--    same blueprint; this stops a repeat across different ones.
create unique index if not exists ws_bpo_ledger_once
  on public.ws_blueprints_owned (aza_ledger_id)
  where aza_ledger_id is not null;

alter table public.ws_blueprints_owned enable row level security;
drop policy if exists wsbpo_sel on public.ws_blueprints_owned;
create policy wsbpo_sel on public.ws_blueprints_owned for select to authenticated using (owner_id = auth.uid());
drop policy if exists wsbpo_ins on public.ws_blueprints_owned;
create policy wsbpo_ins on public.ws_blueprints_owned for insert to authenticated with check (false);
drop policy if exists wsbpo_upd on public.ws_blueprints_owned;
create policy wsbpo_upd on public.ws_blueprints_owned for update to authenticated using (false) with check (false);
drop policy if exists wsbpo_del on public.ws_blueprints_owned;
create policy wsbpo_del on public.ws_blueprints_owned for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- 3. CRAFTED WEAPONS — the minted items themselves.
--
-- `stats` and `quality` are SERVER-COMPUTED. There is deliberately no update
-- policy: a minted weapon is immutable (condition never decays on a finished
-- weapon, §6c), so the only legitimate change is ownership, and that goes
-- through a function.
-- ---------------------------------------------------------------------------
create table if not exists public.crafted_weapons (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  item_id      text not null,                  -- the 'wsc_…' id the client keys its book by
  blueprint_id text not null references public.ws_blueprints(id),
  parts        jsonb not null default '[]'::jsonb,
  quality      int  not null check (quality between 0 and 100),
  stats        jsonb not null default '{}'::jsonb,
  weapon       jsonb not null default '{}'::jsonb,
  listed       boolean not null default false,  -- true while on the market
  created_at   timestamptz not null default now()
);
create index if not exists crafted_weapons_owner on public.crafted_weapons (owner_id, created_at desc);
create unique index if not exists crafted_weapons_item on public.crafted_weapons (owner_id, item_id);

alter table public.crafted_weapons enable row level security;
drop policy if exists cw_sel on public.crafted_weapons;
-- Readable by the owner, and by anyone while it is listed — a buyer has to be
-- able to see the stats of the thing they are bidding on.
create policy cw_sel on public.crafted_weapons for select to authenticated
  using (owner_id = auth.uid() or listed = true);
drop policy if exists cw_ins on public.crafted_weapons;
create policy cw_ins on public.crafted_weapons for insert to authenticated with check (false);
drop policy if exists cw_upd on public.crafted_weapons;
create policy cw_upd on public.crafted_weapons for update to authenticated using (false) with check (false);
drop policy if exists cw_del on public.crafted_weapons;
create policy cw_del on public.crafted_weapons for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- 4. THE SHOP — reputation and the order board.
-- ---------------------------------------------------------------------------
create table if not exists public.ws_shop (
  owner_id    uuid primary key references auth.users(id) on delete cascade,
  rep         int not null default 0 check (rep between 0 and 100),
  rep_quality int not null default 0,
  rep_speed   int not null default 0,
  rep_spec    int not null default 0,
  delivered   int not null default 0,
  failed      int not null default 0,
  contracts   jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.ws_shop enable row level security;
drop policy if exists wss_sel on public.ws_shop;
create policy wss_sel on public.ws_shop for select to authenticated using (owner_id = auth.uid());
drop policy if exists wss_ins on public.ws_shop;
create policy wss_ins on public.ws_shop for insert to authenticated with check (false);
drop policy if exists wss_upd on public.ws_shop;
create policy wss_upd on public.ws_shop for update to authenticated using (false) with check (false);
drop policy if exists wss_del on public.ws_shop;
create policy wss_del on public.ws_shop for delete to authenticated using (false);

-- ===========================================================================
-- FUNCTIONS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5. ws_grant_blueprint — the ONLY way an entitlement is created.
--
-- For source='aza' it VERIFIES THE LEDGER ID before granting: the receipt must
-- exist, belong to the caller, be a sovereigns charge, be recent, and cover
-- the blueprint's price. Without that check the function is just "grant me
-- anything" wearing a receipt-shaped hat.
-- ---------------------------------------------------------------------------
create or replace function public.ws_grant_blueprint(
  p_blueprint_id text,
  p_source       text default 'loot',
  p_ledger_id    uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_bp  public.ws_blueprints%rowtype;
  v_led public.wallet_ledger%rowtype;
  v_rep int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_source not in ('aza', 'loot', 'rep') then
    return jsonb_build_object('ok', false, 'error', 'bad_source');
  end if;

  select * into v_bp from public.ws_blueprints where id = p_blueprint_id and enabled;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_blueprint'); end if;

  -- Already owned is a SUCCESS, not an error. A retried grant after a dropped
  -- response must not read as a failure and prompt a second purchase.
  if exists (select 1 from public.ws_blueprints_owned where owner_id = v_uid and blueprint_id = p_blueprint_id) then
    return jsonb_build_object('ok', true, 'already', true, 'blueprint_id', p_blueprint_id);
  end if;

  if p_source = 'aza' then
    if v_bp.aza_price is null then
      return jsonb_build_object('ok', false, 'error', 'not_for_sale');
    end if;
    if p_ledger_id is null then
      return jsonb_build_object('ok', false, 'error', 'missing_receipt');
    end if;
    select * into v_led from public.wallet_ledger
     where id = p_ledger_id
       and user_id = v_uid                    -- 🔴 somebody else's receipt is not a receipt
       and resource = 'sovereigns'
       and op = 'charge';
    if not found then return jsonb_build_object('ok', false, 'error', 'bad_receipt'); end if;
    -- delta is negative for a charge; the magnitude must cover the price.
    if abs(v_led.delta) < v_bp.aza_price then
      return jsonb_build_object('ok', false, 'error', 'underpaid');
    end if;
    -- A receipt from last month is not evidence of this purchase.
    if v_led.created_at < now() - interval '1 hour' then
      return jsonb_build_object('ok', false, 'error', 'stale_receipt');
    end if;

  elsif p_source = 'rep' then
    select rep into v_rep from public.ws_shop where owner_id = v_uid;
    if coalesce(v_rep, 0) < v_bp.rep_required then
      return jsonb_build_object('ok', false, 'error', 'rep_too_low', 'need', v_bp.rep_required, 'have', coalesce(v_rep, 0));
    end if;
  end if;

  -- The unique index on aza_ledger_id is what makes one receipt buy one
  -- blueprint. Catching the violation here turns a race into a clean refusal.
  begin
    insert into public.ws_blueprints_owned (owner_id, blueprint_id, source, aza_ledger_id)
    values (v_uid, p_blueprint_id, p_source, case when p_source = 'aza' then p_ledger_id else null end);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'receipt_already_used');
  end;

  return jsonb_build_object('ok', true, 'blueprint_id', p_blueprint_id, 'source', p_source);
end;
$fn$;
revoke all on function public.ws_grant_blueprint(text, text, uuid) from public, anon;
grant execute on function public.ws_grant_blueprint(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. ws_mint — the balance rule, enforced.
--
-- Takes what the client DID: a blueprint, the parts, and the two components of
-- the build score. Recomputes the stats and CLAMPS TO THE BUDGET. The client's
-- own stat block is not a parameter, so there is nothing for it to lie about.
--
-- ⚠ p_quality is a client number and is treated as one — clamped to
--   [60, 100] and further capped by the worst part's condition tier, which the
--   server derives from the part IDS rather than trusting a reported cap.
--   Condition is a tier baked into the id (…_shot / _worn / _pristine), which
--   is exactly what makes it checkable here.
-- ---------------------------------------------------------------------------
create or replace function public.ws_mint(
  p_blueprint_id text,
  p_item_id      text,
  p_parts        jsonb,
  p_quality      int,
  p_alloc        jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid    uuid := auth.uid();
  v_bp     public.ws_blueprints%rowtype;
  v_q      int;
  v_cap    int := 100;
  v_pts    int;
  v_wsum   numeric := 0;
  v_stats  jsonb := '{}'::jsonb;
  v_total  int := 0;
  v_key    text;
  v_val    numeric;
  v_n      int;
  v_part   text;
  v_id     uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select * into v_bp from public.ws_blueprints where id = p_blueprint_id and enabled;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_blueprint'); end if;

  -- 🔴 You may only build what you own.
  if not exists (select 1 from public.ws_blueprints_owned where owner_id = v_uid and blueprint_id = p_blueprint_id) then
    return jsonb_build_object('ok', false, 'error', 'blueprint_not_owned');
  end if;

  if p_item_id is null or p_item_id !~ '^wsc_[a-z0-9_]{1,48}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_item_id');
  end if;

  -- Condition ceiling, derived from the part ids rather than reported.
  for v_part in select jsonb_array_elements_text(coalesce(p_parts, '[]'::jsonb)) loop
    if v_part like '%\_shot'     then v_cap := least(v_cap, 75);
    elsif v_part like '%\_worn'  then v_cap := least(v_cap, 90);
    end if;
  end loop;

  v_q := least(v_cap, greatest(60, least(100, coalesce(p_quality, 60))));

  -- points = floor(budget * quality). The single place a quality becomes a
  -- pool, mirroring budgetPoints() on the client.
  v_pts := floor(v_bp.budget * (v_q::numeric / 100.0));

  -- Normalise the allocation weights. Non-positive weights are dropped, which
  -- also means a client cannot smuggle in a negative to inflate another stat.
  for v_key, v_val in select key, (value #>> '{}')::numeric from jsonb_each(coalesce(p_alloc, '{}'::jsonb)) loop
    if v_key ~ '^(atk|mag|def|res|spd|crit)$' and v_val > 0 then v_wsum := v_wsum + v_val; end if;
  end loop;
  if v_wsum <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_allocation'); end if;

  -- Floor each share, which can only ever come in UNDER the pool. The client
  -- hands out the rounding remainder; the server does not, because a server
  -- that rounds up is a server that can exceed the budget.
  for v_key, v_val in select key, (value #>> '{}')::numeric from jsonb_each(coalesce(p_alloc, '{}'::jsonb)) loop
    if v_key ~ '^(atk|mag|def|res|spd|crit)$' and v_val > 0 then
      v_n := floor(v_pts * v_val / v_wsum);
      if v_n > 0 then
        v_stats := v_stats || jsonb_build_object(v_key, v_n);
        v_total := v_total + v_n;
      end if;
    end if;
  end loop;

  -- 🔴 THE INVARIANT. Everything above is arithmetic a later edit could get
  --    wrong; this is the guarantee. Refuse rather than mint over budget.
  if v_total > v_bp.budget then
    return jsonb_build_object('ok', false, 'error', 'over_budget', 'total', v_total, 'budget', v_bp.budget);
  end if;

  insert into public.crafted_weapons (owner_id, item_id, blueprint_id, parts, quality, stats, weapon)
  values (v_uid, p_item_id, p_blueprint_id, coalesce(p_parts, '[]'::jsonb), v_q, v_stats, v_bp.weapon)
  on conflict (owner_id, item_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'duplicate_item_id');
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'item_id', p_item_id,
                            'quality', v_q, 'stats', v_stats, 'weapon', v_bp.weapon,
                            'budget', v_bp.budget, 'spent', v_total);
end;
$fn$;
revoke all on function public.ws_mint(text, text, jsonb, int, jsonb) from public, anon;
grant execute on function public.ws_mint(text, text, jsonb, int, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. ws_deliver — score a contract and move reputation.
--
-- The contract spec and the weapon are both server-side, so the match is
-- decided here. Rep is never a client write.
--
-- ⚠ Reputation moves are DELTAS applied to the stored value, not a value the
--   caller supplies. The three axes are stored separately so the shop can show
--   a player WHY their rep is what it is rather than one opaque number.
-- ---------------------------------------------------------------------------
create or replace function public.ws_deliver(p_contract_id text, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_w    public.crafted_weapons%rowtype;
  v_shop public.ws_shop%rowtype;
  v_c    jsonb;
  v_spec jsonb;
  v_ok   boolean := true;
  v_late boolean;
  v_dq   int; v_ds int; v_dp int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  insert into public.ws_shop (owner_id) values (v_uid) on conflict (owner_id) do nothing;
  select * into v_shop from public.ws_shop where owner_id = v_uid;

  select c into v_c from jsonb_array_elements(v_shop.contracts) c
   where c ->> 'id' = p_contract_id limit 1;
  if v_c is null then return jsonb_build_object('ok', false, 'error', 'unknown_contract'); end if;

  select * into v_w from public.crafted_weapons where owner_id = v_uid and item_id = p_item_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_weapon'); end if;
  if v_w.listed then return jsonb_build_object('ok', false, 'error', 'weapon_is_listed'); end if;

  v_spec := coalesce(v_c -> 'spec', '{}'::jsonb);

  -- Spec match. Every stated minimum has to be met; an unstated one is not a
  -- constraint. Overshooting is not rewarded — repSpec is about hitting the
  -- brief, not about building the biggest thing that satisfies it.
  if jsonb_exists(v_spec, 'minAtk')   and coalesce((v_w.stats  ->> 'atk')::int, 0)   < (v_spec ->> 'minAtk')::int   then v_ok := false; end if;
  if jsonb_exists(v_spec, 'minSpd')   and coalesce((v_w.stats  ->> 'spd')::int, 0)   < (v_spec ->> 'minSpd')::int   then v_ok := false; end if;
  if jsonb_exists(v_spec, 'minCrit')  and coalesce((v_w.stats  ->> 'crit')::int, 0)  < (v_spec ->> 'minCrit')::int  then v_ok := false; end if;
  if jsonb_exists(v_spec, 'minRange') and coalesce((v_w.weapon ->> 'range')::int, 0) < (v_spec ->> 'minRange')::int then v_ok := false; end if;
  if jsonb_exists(v_spec, 'blueprint') and v_w.blueprint_id <> (v_spec ->> 'blueprint') then v_ok := false; end if;

  v_late := jsonb_exists(v_c, 'dueAt') and (to_timestamp(((v_c ->> 'dueAt')::bigint) / 1000.0) < now());

  if not v_ok then
    -- A board with no downside is a board with no decisions.
    update public.ws_shop
       set rep = greatest(0, rep - 3), rep_spec = greatest(0, rep_spec - 2),
           failed = failed + 1,
           contracts = (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(contracts) c where c ->> 'id' <> p_contract_id),
           updated_at = now()
     where owner_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'spec_not_met');
  end if;

  v_dq := greatest(0, (v_w.quality - 60) / 10);          -- 0..4 from build quality
  v_ds := case when v_late then 0 else 2 end;
  v_dp := 2;

  update public.ws_shop
     set rep         = least(100, rep + v_dq + v_ds + v_dp),
         rep_quality = rep_quality + v_dq,
         rep_speed   = rep_speed + v_ds,
         rep_spec    = rep_spec + v_dp,
         delivered   = delivered + 1,
         contracts   = (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(contracts) c where c ->> 'id' <> p_contract_id),
         updated_at  = now()
   where owner_id = v_uid;

  -- The weapon is handed over, so it leaves the player's hands.
  delete from public.crafted_weapons where id = v_w.id;

  select * into v_shop from public.ws_shop where owner_id = v_uid;
  return jsonb_build_object('ok', true, 'rep', v_shop.rep, 'late', v_late,
                            'gained', jsonb_build_object('quality', v_dq, 'speed', v_ds, 'spec', v_dp),
                            'pays', coalesce(v_c -> 'pays', '{}'::jsonb));
end;
$fn$;
revoke all on function public.ws_deliver(text, text) from public, anon;
grant execute on function public.ws_deliver(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. ws_state — one round-trip for everything the bench mirrors.
--
-- The client's rep / contracts / blueprints fields are a CACHE; this is what
-- refills them. One call rather than three because they are always wanted
-- together and three round-trips on opening a screen is three chances to show
-- a half-populated bench.
-- ---------------------------------------------------------------------------
create or replace function public.ws_state()
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_shop public.ws_shop%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  insert into public.ws_shop (owner_id) values (v_uid) on conflict (owner_id) do nothing;
  select * into v_shop from public.ws_shop where owner_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'rep', v_shop.rep, 'repQuality', v_shop.rep_quality,
    'repSpeed', v_shop.rep_speed, 'repSpec', v_shop.rep_spec,
    'delivered', v_shop.delivered, 'failed', v_shop.failed,
    'contracts', v_shop.contracts,
    'blueprints', (select coalesce(jsonb_agg(blueprint_id), '[]'::jsonb)
                     from public.ws_blueprints_owned where owner_id = v_uid),
    'weapons', (select coalesce(jsonb_agg(jsonb_build_object(
                         'itemId', item_id, 'blueprintId', blueprint_id,
                         'quality', quality, 'stats', stats, 'weapon', weapon,
                         'parts', parts, 'listed', listed)), '[]'::jsonb)
                  from public.crafted_weapons where owner_id = v_uid)
  );
end;
$fn$;
revoke all on function public.ws_state() from public, anon;
grant execute on function public.ws_state() to authenticated;

-- ===========================================================================
-- VERIFY
-- ===========================================================================

-- 8a. Every table has RLS ON and no table is writable directly.
--     Expect rowsecurity = true for all four.
-- select relname, relrowsecurity
--   from pg_class where relname in
--   ('ws_blueprints','ws_blueprints_owned','crafted_weapons','ws_shop');

-- 8b. The write policies. Everything except the two SELECTs should be
--     permissive-false — i.e. only SECURITY DEFINER functions can write.
-- select tablename, policyname, cmd, qual, with_check
--   from pg_policies where schemaname = 'public'
--     and tablename in ('ws_blueprints','ws_blueprints_owned','crafted_weapons','ws_shop')
--   order by tablename, cmd;

-- 8c. Grants. All four functions: authed true, anon false.
-- select p.proname,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') as anon
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('ws_grant_blueprint','ws_mint','ws_deliver','ws_state')
--  order by p.proname;

-- 8d. 🔴 THE BUDGET INVARIANT, checked against real data. This must return
--     ZERO ROWS, always. A row here means a weapon exists whose stats exceed
--     the pool its blueprint allows — the one failure this whole design is
--     built to make impossible.
-- select w.id, w.item_id, w.blueprint_id, b.budget,
--        (select sum((value #>> '{}')::int) from jsonb_each(w.stats)) as spent
--   from public.crafted_weapons w
--   join public.ws_blueprints b on b.id = w.blueprint_id
--  where (select sum((value #>> '{}')::int) from jsonb_each(w.stats)) > b.budget;

-- 8e. ⚠ THE TWO BUDGET TABLES MUST AGREE. This one is a manual read: compare
--     against SEED/BLUEPRINTS in public/src/weaponsmith/blueprints.js. If they
--     disagree, THIS table wins and the client is wrong.
-- select id, name, tier, budget, weapon, aza_price, rep_required
--   from public.ws_blueprints order by tier, id;
--   -> carbine 8 / sidearm 4 / breacher 14 / lance 10 / marksman 14

-- 8f. One receipt buys one blueprint. Should return zero rows.
-- select aza_ledger_id, count(*) from public.ws_blueprints_owned
--  where aza_ledger_id is not null group by 1 having count(*) > 1;
-- ===========================================================================
