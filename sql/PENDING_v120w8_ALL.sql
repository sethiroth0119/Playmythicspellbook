-- ============================================================================
-- PENDING MIGRATIONS FOR RELEASE v120w8
-- ----------------------------------------------------------------------------
-- Three files, in dependency order. All are idempotent and re-runnable, so
-- re-running one that is already applied is safe.
--
-- Apply by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- RUN THEM ONE AT A TIME, in this order, and check each verify block before
-- moving on. Do not paste all three at once -- if one fails you want to know
-- which.
--
--   036  season directive expiry      (unrelated to the city; pending from before)
--   037  AZA exchange counter fix     (unrelated to the city; pending from before)
--   038  city economy trade           (REQUIRED for real city-to-city trade)
--
-- Until 038 is applied the trade layer runs against simulated partners. That is
-- by design and nothing breaks -- there are simply no real neighbours.
--
-- RLS IS THE ENTIRE SECURITY BOUNDARY IN 038. Read every policy line by line
-- before running it. Note in particular why city_trade_offers UPDATE is
-- owner-only and filling goes through the SECURITY DEFINER city_trade_fill()
-- RPC: an open UPDATE policy would let a buyer set unit_price to 0 and THEN
-- fill. The RPC takes `for update` on the row -- without that lock, two players
-- filling the last 40 units both read 0 filled, both write 40, and the seller
-- ships 80.
-- ============================================================================


-- ############################################################################
-- ##  BEGIN  sql/036_season_directive_expiry.sql
-- ############################################################################

-- ===========================================================================
-- 036 — STOP STALE RESET DIRECTIVES WIPING PLAYERS WHO CHANGE DEVICES.
--
-- THE BUG. season_apply suppresses a directive only for a user who ALREADY
-- TOOK IT. That is the wrong question. Anyone who missed it at the time — new
-- account, new device, cleared storage, a phone that had not been opened in a
-- week — is still "unapplied", so they take a reset published on 07-28 today,
-- in August, with a real collection behind them.
--
-- Observed in production: five accounts in four days each applied ALL FIVE
-- historical directives within a single minute (the fingerprint of a device
-- with no local record), every one of them ending on zero Cinder:
--
--   08-12 17:10  53af15c6   5 directives   0 cards    0 cinder
--   08-12 10:24  53eb89a1   5 directives  19 cards    0 cinder
--   08-12 08:12  37592af1   5 directives   0 cards    0 cinder
--   08-12 00:08  e40ef8ca   5 directives  50 cards    0 cinder
--   08-11 23:52  2feefce7   5 directives 420 cards    0 cinder
--
-- v120w0 retired the build-stamped one-shot, which was the other half of the
-- same fault. This is the half that survived, and it is the bigger one because
-- it reaches every player, not only those on a second device.
--
-- 🔴 WHY THE GATE LIVES ON THE SERVER, NOT IN THE CLIENT.
--    _applySeasonReset returns without touching anything unless this RPC
--    answers {ok:true, already:false}:
--        if (!_sj || _sj.ok !== true) return;
--        _seasonMarkApplied(sr.id);
--        if (_sj.already) return;
--    So refusing here protects players on OLD CACHED BUILDS too — which a
--    client-side fix cannot do, and which matters because the players being
--    hurt are by definition the ones whose install is out of date.
--
-- TWO GATES, because they fail differently:
--   • EXPIRY (72h) — a directive is an event, not a standing order. It should
--     reach everyone who plays within a few days and then stop existing. 72h
--     covers a long weekend away; past that, wiping someone does more harm
--     than leaving them un-reset.
--   • ACCOUNT AGE — an account created AFTER a directive was published was
--     never part of the economy it was correcting. It must never be wiped by
--     it, at any age, expiry window or not.
--
-- ⚠ Returns already:true rather than ok:false ON PURPOSE. The client treats
--   already:true as "someone else took care of this", marks it locally and
--   stops asking. ok:false would leave the directive permanently unapplied and
--   the client would re-fire this RPC on every 120s poll, for all nine stale
--   rows, for every player, forever.
--
-- ⚠ NOTHING IS DELETED. The nine directives and all 494 application rows stay
--   exactly as they are — this only changes who a directive may still act on.
--   skipped_reason keeps the audit honest: a row written by this gate did NOT
--   wipe anybody, and can be told apart from one that did.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- Additive and nullable: every existing row keeps meaning "this user was
-- actually wiped by this directive", which is what they do mean.
alter table public.season_reset_applied
  add column if not exists skipped_reason text;

comment on column public.season_reset_applied.skipped_reason is
  'NULL = the directive really was applied to this user. Non-NULL = season_apply '
  'recorded it to stop re-evaluation but deliberately did NOT wipe anything '
  '(expired directive, or an account created after the directive was published).';

create or replace function public.season_apply(p_reset_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_scope text; v_new integer;
  v_created timestamptz;
  v_acct    timestamptz;
  v_skip    text := null;
  -- A directive is an event with a short reach, not a standing order.
  c_ttl constant interval := interval '72 hours';
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;

  select scope, created_at into v_scope, v_created from season_reset where id = p_reset_id;
  if v_scope is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  -- ── THE GATE ──────────────────────────────────────────────────────────────
  -- Checked BEFORE the insert below, so a user who legitimately took this
  -- directive at the time still short-circuits on the conflict as they always
  -- have, and their row is never rewritten with a skip reason.
  if v_created is not null and v_created < now() - c_ttl then
    v_skip := 'expired';
  else
    -- An account that did not exist when the directive was published was never
    -- part of the economy it corrects. Never wipe it, at any age.
    begin
      select created_at into v_acct from auth.users where id = auth.uid();
      if v_acct is not null and v_created is not null and v_acct > v_created then
        v_skip := 'account_newer';
      end if;
    exception when others then null;   -- auth schema unreadable → fall through
    end;
  end if;

  if v_skip is not null then
    -- Record it so the client stops asking, but wipe NOTHING.
    insert into season_reset_applied (user_id, reset_id, skipped_reason)
    values (auth.uid(), p_reset_id, v_skip)
    on conflict (user_id, reset_id) do nothing;
    return jsonb_build_object('ok', true, 'already', true, 'scope', v_scope, 'skipped', v_skip);
  end if;
  -- ──────────────────────────────────────────────────────────────────────────

  insert into season_reset_applied (user_id, reset_id) values (auth.uid(), p_reset_id)
    on conflict (user_id, reset_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then return jsonb_build_object('ok', true, 'already', true, 'scope', v_scope); end if;

  if v_scope = 'full' then
    update user_progress set cinder = 0, updated_at = now() where user_id = auth.uid();
    update user_profiles set
      gems = 0,
      heroes = coalesce((select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object'
                 then (v - 'statGains' - 'evs' - 'knownMoves' - 'pendingLearn' - 'subclass') || '{"level":1,"xp":0}'::jsonb
                 else v end)
               from jsonb_each(coalesce(heroes, '{}'::jsonb)) t(k, v)), '{}'::jsonb),
      units = coalesce((select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object'
                 then (v - 'statGains' - 'evs' - 'knownMoves' - 'pendingLearn' - 'subclass') || '{"level":1,"xp":0}'::jsonb
                 else v end)
               from jsonb_each(coalesce(units, '{}'::jsonb)) t(k, v)), '{}'::jsonb),
      forge = (case when coalesce(forge, '{}'::jsonb) ? '__account__'
                 then jsonb_set(coalesce(forge, '{}'::jsonb), '{__account__}',
                      coalesce(forge->'__account__', '{}'::jsonb) || '{"level":1,"xp":0,"totalXp":0}'::jsonb)
                 else coalesce(forge, '{}'::jsonb) end)
              || jsonb_build_object('__aiHeroes__', '{}'::jsonb, '__aiUnits__', '{}'::jsonb),
      updated_at = now()
    where user_id = auth.uid();
  elsif v_scope = 'business' then
    update user_profiles set
      forge = coalesce(forge, '{}'::jsonb) || '{"__jbLocalOps__":[],"__blackRiver__":{},"__princePortfolios__":{},"__fishingCorp__":{},"__fuelCommand__":{},"__cityCards__":{}}'::jsonb,
      updated_at = now()
    where user_id = auth.uid();
  elsif v_scope = 'resources' then
    -- Salvage ledger, carried field bag, base-vault layout, and ALL gear:
    -- the item inventory, what is equipped on each unit, relic equipment and
    -- every hero loadout.
    update user_profiles set
      forge = coalesce(forge, '{}'::jsonb) || '{
        "__salvage__":{}, "__fieldBag__":{}, "__vaultLayout__":{},
        "__itemInventory__":{}, "__equipment__":{}, "__relicEquipment__":{},
        "__heroLoadouts__":{}
      }'::jsonb,
      updated_at = now()
    where user_id = auth.uid();
  elsif v_scope = 'purge' then
    -- 🧹 ECONOMY PURGE (post-exploit). Wealth and inventory go; PROGRESSION STAYS.
    -- Aza (sovereigns) is untouched - it is bought with real money.
    perform public._season_purge_apply(auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'already', false, 'scope', v_scope);
end $function$;

revoke all on function public.season_apply(uuid) from public, anon;
grant execute on function public.season_apply(uuid) to authenticated;

-- ===========================================================================
-- VERIFY
--
-- 1) Every existing directive should now be out of reach (all are 10-16 days old):
--      select scope, to_char(created_at,'MM-DD') as published,
--             round(extract(epoch from (now()-created_at))/3600) as age_hours,
--             (created_at < now() - interval '72 hours') as expired
--        from public.season_reset order by created_at;
--
-- 2) Nothing was destroyed — counts must be unchanged (9 and 494):
--      select (select count(*) from public.season_reset) as directives,
--             (select count(*) from public.season_reset_applied) as applications,
--             (select count(*) from public.season_reset_applied
--               where skipped_reason is not null) as skips_so_far;
--
-- 3) Watch the gate work. Rows appearing here wiped NOBODY:
--      select skipped_reason, count(*), max(applied_at)
--        from public.season_reset_applied
--       where skipped_reason is not null group by 1;
--
-- 4) And the real thing to watch — this should stay empty from now on:
--      select to_char(a.applied_at,'MM-DD HH24:MI') as applied,
--             left(a.user_id::text,8) as usr, sr.scope, a.skipped_reason
--        from public.season_reset_applied a
--        join public.season_reset sr on sr.id = a.reset_id
--       where a.applied_at > now() - interval '2 days'
--         and a.skipped_reason is null
--       order by 1 desc;
--
-- 🎯 PUBLISHING A NEW RESET STILL WORKS. A directive created now is inside the
--    72h window, so it applies to every account that predates it, exactly as
--    before. The gate only refuses history.
-- ===========================================================================


-- ############################################################################
-- ##  END  sql/036_season_directive_expiry.sql
-- ############################################################################


-- ############################################################################
-- ##  BEGIN  sql/037_aza_exchange_fix.sql
-- ############################################################################

-- ===========================================================================
-- 037 — THE BANK OF ETHOS EXCHANGE COUNTER HAS NEVER WORKED. Fix it.
--
-- Reported as "The exchange did not go through — nothing moved" on the market
-- site. It is not intermittent: public.aza_exchanges has ZERO rows, so not one
-- Aza → Cinder exchange has ever completed.
--
-- THE BUG. aza_to_cinder_exchange reads
--     v_cfg.max_aza_per_tx
-- from a public.aza_config%rowtype. That column does not exist — the table has
-- `max_aza_per_day`. Referencing a missing field on a plpgsql record RAISES
-- (`record "v_cfg" has no field "max_aza_per_tx"`), it does not return null. So
-- every single call threw before touching a balance.
--
-- ⚠ WHY IT LOOKED LIKE A SILENT FAILURE RATHER THAN AN ERROR. The site's
--   readiness probe calls cinder_from_aza_total(), which is a different
--   function and succeeds regardless — so the counter renders OPEN. The throw
--   then arrives as a transport error, and the client's message chain has no
--   arm for it, so it fell through to the generic "nothing moved". Three
--   separate things had to line up to make a hard crash look like a no-op.
--   The client half of this is fixed alongside (every error code now has a
--   message, and an unknown one says so instead of pretending).
--
-- 🟢 NOTHING WAS EVER LOST. The throw happened BEFORE the sovereigns debit, and
--    plpgsql rolls the whole function back on an exception anyway. Players who
--    tried and saw the error kept their Aza. No restitution is needed — verify
--    with the query at the bottom.
--
-- WHAT max_aza_per_day SHOULD MEAN. The name says per DAY, and the original
-- used it as a per-transaction ceiling. Implemented as the daily cap it is
-- named for: today's exchanged total plus this request must fit inside it.
-- A single request larger than the whole day's allowance is refused
-- separately, because "split it into smaller exchanges" is useless advice when
-- the limit is a daily total.
--
-- min_aza was likewise ignored — the old check was `p_aza <= 0`. Honoured now.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

create or replace function public.aza_to_cinder_exchange(p_aza integer)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid   uuid := auth.uid();
  v_cfg   public.aza_config%rowtype;
  v_mint  bigint;
  v_ok    boolean := false;
  v_sov   int;
  v_today bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_cfg from public.aza_config where id = 1;
  if not found or not v_cfg.enabled then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if p_aza is null or p_aza <= 0 or p_aza < coalesce(v_cfg.min_aza, 1) then
    return jsonb_build_object('ok', false, 'error', 'bad_amount',
                              'min_aza', coalesce(v_cfg.min_aza, 1));
  end if;

  -- 🔴 THE LINE THAT BROKE IT: this read v_cfg.max_aza_per_tx, which is not a
  --    column on aza_config. A missing record field raises, so every call died
  --    here. The real column is max_aza_per_day, and it is a DAILY total.
  if coalesce(v_cfg.max_aza_per_day, 0) > 0 then
    if p_aza > v_cfg.max_aza_per_day then
      -- Bigger than the entire day's allowance: splitting cannot help.
      return jsonb_build_object('ok', false, 'error', 'amount_too_large',
                                'max_aza_per_day', v_cfg.max_aza_per_day);
    end if;
    select coalesce(sum(aza_spent), 0) into v_today
      from public.aza_exchanges
     where user_id = v_uid and created_at >= date_trunc('day', now());
    if v_today + p_aza > v_cfg.max_aza_per_day then
      return jsonb_build_object('ok', false, 'error', 'daily_cap',
                                'max_aza_per_day', v_cfg.max_aza_per_day,
                                'used_today', v_today,
                                'remaining', greatest(0, v_cfg.max_aza_per_day - v_today));
    end if;
  end if;

  v_mint := (p_aza::bigint) * v_cfg.cinder_per_aza;

  -- Balance test lives IN the WHERE clause: this is the concurrency guard as
  -- well as the affordability check, so two calls cannot both overdraw.
  update public.user_profiles
     set sovereigns = sovereigns - p_aza
   where user_id = v_uid and coalesce(sovereigns, 0) >= p_aza
  returning true into v_ok;

  if not coalesce(v_ok, false) then
    select coalesce(sovereigns, 0) into v_sov from public.user_profiles where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'insufficient_aza',
                              'sovereigns', coalesce(v_sov, 0));
  end if;

  update public.user_profiles
     set gems = coalesce(gems, 0) + v_mint
   where user_id = v_uid;

  insert into public.aza_exchanges (user_id, aza_spent, cinder_minted, rate)
  values (v_uid, p_aza, v_mint, v_cfg.cinder_per_aza);

  return jsonb_build_object(
    'ok', true,
    'aza_spent', p_aza,
    'cinder_credited', v_mint,
    'rate', v_cfg.cinder_per_aza,
    'locked_cinder', public.cinder_from_aza_total(),
    'sovereigns', (select coalesce(sovereigns, 0) from public.user_profiles where user_id = v_uid),
    'balance', (select coalesce(gems, 0) from public.user_profiles where user_id = v_uid)
  );
end;
$function$;

revoke all on function public.aza_to_cinder_exchange(integer) from public, anon;
grant execute on function public.aza_to_cinder_exchange(integer) to authenticated;

-- ===========================================================================
-- VERIFY
--
-- 1) The old code path is gone — this must return 0:
--      select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='aza_to_cinder_exchange'
--         and pg_get_functiondef(p.oid) like '%max_aza_per_tx%';
--
-- 2) Nobody lost Aza to the broken version (the throw preceded the debit):
--      select count(*) as exchanges_ever from public.aza_exchanges;
--      -- was 0 before this fix; anything here now is a real, completed exchange.
--
-- 3) Live round trip (ROLL BACK — it moves real balances):
--      begin;
--        select set_config('request.jwt.claims',
--          '{"sub":"<a user with Aza>","role":"authenticated","email":"x@y.z"}', true);
--        set local role authenticated;
--        select public.aza_to_cinder_exchange(11);
--      rollback;
--
-- 4) Daily cap behaviour:
--      select user_id, sum(aza_spent) as used_today
--        from public.aza_exchanges where created_at >= date_trunc('day', now())
--       group by 1;
-- ===========================================================================


-- ############################################################################
-- ##  END  sql/037_aza_exchange_fix.sql
-- ############################################################################


-- ############################################################################
-- ##  BEGIN  sql/038_city_economy_trade.sql
-- ############################################################################

-- ════════════════════════════════════════════════════════════════════════════
-- 038 — CITY ECONOMY: specializations + city-to-city trade
-- ----------------------------------------------------------------------------
-- "YOUR CITY NEEDS OTHER CITIES."
--
-- Two tables:
--   city_profiles      what a city IS — its node, its earned specializations,
--                      and what it can sell / must buy. One row per city.
--   city_trade_offers  standing offers and wants. Append-mostly; a fill is an
--                      UPDATE of `filled_units` and nothing else.
--
-- 🔴 THE CLIENT MUST WORK WITHOUT THIS FILE EVER BEING RUN.
--    CLAUDE.md: "All Supabase access is guarded. The app MUST still work
--    offline / before tables exist, degrading to mock or empty data."
--    /src/economy/trade.js holds NO Supabase calls at all. With no network it
--    trades against SIMULATED partners derived from neighbouring node ids,
--    using the same endowment function real nodes use. This migration upgrades
--    those partners to real cities; it does not enable the feature.
--
-- 🔴 RLS IS THE ENTIRE SECURITY BOUNDARY. Every policy below is scoped by
--    auth.uid(). A missing `using (...)` here is a data breach that looks fine
--    in review — read every line.
--
-- Idempotent and re-runnable. Ends with a verify query.
-- Apply by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- ════════════════════════════════════════════════════════════════════════════

-- ── city_profiles ───────────────────────────────────────────────────────────
create table if not exists public.city_profiles (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  node_id          text not null,
  city_name        text not null default 'Unnamed City',
  -- Earned, never chosen. See /src/economy/trade.js: a city is known for what
  -- it has actually produced and exported for a sustained period.
  specializations  text[] not null default '{}',
  -- What this city can supply and what it structurally cannot make. Derived
  -- client-side from the node endowment; stored so other players can match
  -- against it without simulating someone else's city.
  sells            jsonb  not null default '{}'::jsonb,
  buys             jsonb  not null default '{}'::jsonb,
  economy_day      integer not null default 0,
  population       integer not null default 0,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  -- One profile per city, and a city is one node owned by one player.
  unique (owner_id, node_id)
);

create index if not exists city_profiles_node_idx  on public.city_profiles (node_id);
create index if not exists city_profiles_owner_idx on public.city_profiles (owner_id);
-- Partner discovery reads by specialization; GIN keeps that from scanning.
create index if not exists city_profiles_spec_idx  on public.city_profiles using gin (specializations);

-- ── city_trade_offers ───────────────────────────────────────────────────────
create table if not exists public.city_trade_offers (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  city_id      uuid not null references public.city_profiles(id) on delete cascade,
  side         text not null check (side in ('sell','buy')),
  resource_id  text not null,
  units        numeric not null check (units > 0),
  filled_units numeric not null default 0 check (filled_units >= 0),
  unit_price   numeric not null check (unit_price >= 0),
  -- A gap the city cannot mine at all outbids an ordinary shortfall.
  urgent       boolean not null default false,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now(),
  -- An offer can never be over-filled. This is the ONLY place that invariant
  -- can be enforced against a concurrent second buyer.
  constraint city_trade_offers_fill_bounds check (filled_units <= units)
);

create index if not exists city_trade_offers_open_idx
  on public.city_trade_offers (resource_id, side, expires_at)
  where filled_units < units;
create index if not exists city_trade_offers_city_idx on public.city_trade_offers (city_id);

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.city_profiles     enable row level security;
alter table public.city_trade_offers enable row level security;

-- ── city_profiles ───────────────────────────────────────────────────────────
-- READ: any signed-in player may read any city profile. That is the point of
-- the table — you cannot trade with a city you cannot see. It carries no
-- private data: node, name, specializations, and what it trades.
drop policy if exists city_profiles_read on public.city_profiles;
create policy city_profiles_read on public.city_profiles
  for select to authenticated
  using (true);

-- WRITE: only your own, and only ever your own. `with check` on insert stops a
-- player writing a row that claims someone else's owner_id; `using` on
-- update/delete stops them touching a row that is not theirs. Both are needed —
-- `using` alone would let an UPDATE rewrite owner_id and hand the row away.
drop policy if exists city_profiles_insert on public.city_profiles;
create policy city_profiles_insert on public.city_profiles
  for insert to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists city_profiles_update on public.city_profiles;
create policy city_profiles_update on public.city_profiles
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists city_profiles_delete on public.city_profiles;
create policy city_profiles_delete on public.city_profiles
  for delete to authenticated
  using (auth.uid() = owner_id);

-- ── city_trade_offers ───────────────────────────────────────────────────────
-- READ: open offers are public — a market nobody can read is not a market.
drop policy if exists city_trade_offers_read on public.city_trade_offers;
create policy city_trade_offers_read on public.city_trade_offers
  for select to authenticated
  using (true);

drop policy if exists city_trade_offers_insert on public.city_trade_offers;
create policy city_trade_offers_insert on public.city_trade_offers
  for insert to authenticated
  with check (
    auth.uid() = owner_id
    -- ...and the city you are posting for must actually be yours. Without this
    -- a player could post offers in another city's name.
    and exists (
      select 1 from public.city_profiles p
      where p.id = city_id and p.owner_id = auth.uid()
    )
  );

-- ⚠ UPDATE IS DELIBERATELY OWNER-ONLY, AND FILLING GOES THROUGH THE RPC BELOW.
--   A buyer must be able to fill someone else's offer, but they must NOT be
--   able to UPDATE that row — an open update policy would let them set
--   unit_price to 0 and then fill it. So the counterparty path is a
--   SECURITY DEFINER function with its own checks, and the table itself stays
--   locked to its owner.
drop policy if exists city_trade_offers_update on public.city_trade_offers;
create policy city_trade_offers_update on public.city_trade_offers
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists city_trade_offers_delete on public.city_trade_offers;
create policy city_trade_offers_delete on public.city_trade_offers
  for delete to authenticated
  using (auth.uid() = owner_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 🤝 FILLING AN OFFER
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER because the buyer legitimately needs to modify a row they
-- do not own, and only in one specific way: raise `filled_units`, never past
-- `units`, never touching price or expiry.
--
-- ⚠ `for update` TAKES THE ROW LOCK. Two players filling the last 40 units of
--   the same offer at the same moment would otherwise both read 0 filled, both
--   write 40, and the seller would ship 80 — the classic double-spend. The
--   lock plus the re-read inside the transaction is what makes the check-then-
--   write atomic. The CHECK constraint above is the second line of defence.
--
-- ⚠ RLS RECURSION (CLAUDE.md): this function reads city_profiles from inside a
--   context that bypasses RLS, which is exactly why it terminates. Do NOT
--   "tidy" it into a policy that queries the same table it guards.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.city_trade_fill(
  p_offer_id uuid,
  p_units    numeric
)
returns table (filled numeric, remaining numeric, unit_price numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer   public.city_trade_offers%rowtype;
  v_take    numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_units is null or p_units <= 0 then
    raise exception 'units must be positive';
  end if;

  select * into v_offer
    from public.city_trade_offers
   where id = p_offer_id
     for update;                      -- ← the lock. See the note above.

  if not found then
    raise exception 'offer not found';
  end if;
  if v_offer.expires_at <= now() then
    raise exception 'offer expired';
  end if;
  -- You cannot trade with yourself. Without this a player could launder goods
  -- between two of their own cities and farm the spread indefinitely.
  if v_offer.owner_id = auth.uid() then
    raise exception 'cannot fill your own offer';
  end if;

  v_take := least(p_units, v_offer.units - v_offer.filled_units);
  if v_take <= 0 then
    raise exception 'offer already filled';
  end if;

  update public.city_trade_offers
     set filled_units = filled_units + v_take
   where id = p_offer_id;

  return query
    select v_take,
           (v_offer.units - v_offer.filled_units - v_take),
           v_offer.unit_price;
end;
$$;

revoke all on function public.city_trade_fill(uuid, numeric) from public;
grant execute on function public.city_trade_fill(uuid, numeric) to authenticated;

-- ── Housekeeping: drop expired, fully-filled offers. Safe to call from
--    anywhere; it can only ever remove rows that are already dead.
create or replace function public.city_trade_sweep()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.city_trade_offers
     where expires_at <= now() - interval '1 day'
        or filled_units >= units
    returning 1
  )
  select coalesce(count(*), 0)::integer from gone;
$$;

revoke all on function public.city_trade_sweep() from public;
grant execute on function public.city_trade_sweep() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════════════
select
  (select count(*) from pg_tables
    where schemaname = 'public'
      and tablename in ('city_profiles','city_trade_offers'))               as tables_created,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('city_profiles','city_trade_offers'))               as policies_created,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('city_trade_fill','city_trade_sweep'))              as functions_created,
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'public'
      and tablename in ('city_profiles','city_trade_offers'))               as rls_enabled;
-- Expect: tables_created = 2, policies_created = 8, functions_created = 2,
--         rls_enabled = true


-- ############################################################################
-- ##  END  sql/038_city_economy_trade.sql
-- ############################################################################


