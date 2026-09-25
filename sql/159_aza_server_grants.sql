-- ===========================================================================
-- 159 . AZA GRANTS THAT USED TO EXIST ONLY ON THE PLAYER'S DEVICE
-- DRAFT — NOT APPLIED. Paste into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
-- Apply AFTER 024 + 025 (it uses _sov_apply), RUN_017 (aza_config — the
-- AZA→Cinder rate) and 048 (_ct_cinder_give). Independent of 155_C.
--
-- ✏ EDITED IN PLACE 2026-09-18, STILL NOT APPLIED. Nothing below was ever on
--   the live database (checked: no aza_grant_kinds table, no aza_claim_*
--   function), so the draft was changed rather than followed by a new file.
--   OWNER DECISION, verbatim, on "AZA daily caps for the season pass,
--   Territory Wars loot and Oil Sim": "give cinder instead max 15,000".
--   So those three rewards PAY CINDER, NOT AZA:
--     * the reward still NAMES an AZA amount (the season tier table, the TW
--       yield, the Oil Sim contract); the server converts it at the game's own
--       published rate, aza_config.cinder_per_aza (5,000 live on 2026-09-18 —
--       the same rate the Bank of Ethos exchange pays and the client's
--       AZA_TO_CINDER shows). The rate is READ at claim time, never copied.
--     * "max 15,000" is read as a PER-PLAYER, PER-DAY (UTC calendar day)
--       ceiling for EACH of the three rewards: 15,000 for the Season Pass,
--       15,000 for Territory Wars loot, 15,000 for the Oil Sim (contracts and
--       emergencies SHARE the Oil Sim's 15,000 — the owner named "Oil Sim" as
--       one thing). The figure is one row per reward in cinder_reward_caps.
--     * a claim that would cross the ceiling pays what room is left and is
--       consumed; a claim with NO room left is refused ('daily_cap') and NOT
--       consumed, so the Season Pass client can keep it and retry tomorrow.
--   Coupons, Luni trades and broker deals are UNCHANGED and still move AZA.
--   The old aza_claim_season / aza_claim_capped are replaced by
--   cinder_claim_season / cinder_claim_capped (and dropped if present).
--
-- Owner: "AZA from the season pass, coupons, Territory Wars loot and
-- resource-exchange sales is only added on the player's device, so it likely
-- vanishes on the next load. Fix this."
--
-- WHY THEY VANISH. Since 024/026 the canonical AZA balance is
-- user_progress.sovereigns, written only by SECURITY DEFINER functions, and
-- `authenticated` holds no UPDATE on either sovereigns column (checked live
-- 2026-09-17: user_profiles.sovereigns UPDATE f, INSERT f; user_progress f).
-- Boot adopts the server balance. So every site that does
--   Profile.sovereigns = Profile.sovereigns + n
-- shows the player n AZA that NO row anywhere records, and the next load
-- takes it away. user_profiles_history cannot show those rises for the same
-- reason: the client never managed to write them.
--
-- WHAT THE LIVE DATA SHOWS (read-only, 2026-09-17)
--   * Resource exchange (Luni) AZA sales: 7 'sale' rows, 132 AZA, every one
--     claimed by the seller, and ZERO matching wallet_ledger credits to any
--     seller and ZERO matching charges to any buyer (GreyDragon 112 AZA across
--     #1030 #1031 #1853 #1854 #1922 #1941; Mavric 20 AZA on #2234). The
--     sellers' mirrors in user_profiles_history move only on real server
--     credits (packs, gifts, covert rewards). The buyers were never charged
--     either, so no AZA was ever MOVED — it was shown and then forgotten on
--     both sides. That is why the trade functions below are a TRANSFER
--     (buyer charged, seller paid that same charge), never a credit.
--   * Coupons: forge.__redeemedCoupons__ shows 9 accounts redeemed
--     cpn_welcome2026 (a 500-AZA reward hard-coded in the client and
--     guessable from the page source) and 4 cpn_starterpack. None of the 9
--     has a +500 wallet_ledger row. One (Aurelia) holds exactly 500 canonical
--     with no ledger rows at all: that is 024's one-time seed from the
--     then-client-writable mirror, i.e. redeemed before the lock.
--   * Season pass: its state (tiers, claims, premium) is not saved to the
--     cloud at all (no column carries claimedPremiumTiers), so it cannot be
--     measured. Premium AZA tiers pay 1 + 2 + 3 + 5 = 11 per season.
--   * Territory Wars loot: no node on the live war map (tw_world_map.doc,
--     v198) has an Aza / AzaFragments yield, and tw_ownership is empty
--     (ownership is client state). The path is dormant; nobody lost AZA to it.
--   * Broker deals: broker_deals has 0 rows ever.
--
-- THE SERVER DESIGN, PER GRANT KIND
--   coupon          VERIFIED. aza_coupons is an admin-only table (is_admin()).
--                   A code with no row is refused. One redemption per
--                   user+code (aza_grant_claims unique key), optional global
--                   max_uses, expiry, enable flag. The AMOUNT comes from the
--                   row, never from the client. Codes are not readable by
--                   players (RLS: admin only), so the table cannot be browsed.
--   season_pass     CINDER, CAPPED — the server CANNOT know the tier reached
--                   or that Premium was bought: season XP, tier and
--                   premiumOwned live only on the device. So: the amount comes
--                   from aza_season_tiers (only tiers 8/15/21/28 pay; 1/2/3/5
--                   AZA-named = 5,000/10,000/15,000/25,000 Cinder at 5,000),
--                   each tier pays at most once per 80 days per user (a real
--                   season is 90 days, so an honest player is never refused),
--                   the client's claim key makes a retry idempotent, and the
--                   15,000/day Season Pass ceiling bounds the day. ⚠ Tier 28
--                   (25,000) can therefore never pay more than 15,000.
--   tw_loot         CINDER, CAPPED — ownership and yields-with-multipliers are
--                   client state. The AZA-named request is clamped to
--                   max_per_claim, converted, once per claim key, 15,000/day.
--   oilsim_contract / oilsim_emergency
--                   CINDER, CAPPED — the Oil Sim's contracts are generated and
--                   fulfilled entirely on the client (index.html _osim*).
--                   Same shape as tw_loot; the two SHARE one 15,000/day.
--   trade (Luni)    VERIFIED + CLOSED LOOP. aza_trade_pay charges the BUYER
--                   price_total of a server-written resource_trade_ledger
--                   'sale' row (rl_take_lots wrote the price, not the
--                   client). aza_trade_collect pays the SELLER exactly what
--                   that buyer was charged, and only after they were. The
--                   seller's claim row and the credit are one transaction.
--                   Nothing is minted; no cap needed.
--   broker deals    VERIFIED + CLOSED LOOP. The maker's AZA escrow is charged
--                   server-side (aza_broker_step 'escrow'); acceptance with
--                   AZA on either side goes through aza_broker_accept, which
--                   charges the taker and releases the escrow in ONE
--                   transaction; the maker's payout and a cancel refund pay
--                   only amounts a charge recorded. The deal's jsonb is
--                   maker-editable (policy broker_maker_update), so every
--                   amount is SNAPSHOTTED into aza_grant_claims at the moment
--                   it is charged and paid from there.
--
-- 🔴 NOTHING HERE LETS A CLIENT NAME AN UNBOUNDED AMOUNT. The only amounts a
--    client can influence are the Cinder kinds, each clamped per claim
--    (aza_grant_kinds.max_per_claim) AND per day (cinder_reward_caps — one
--    UPDATE to tune, 0 to switch a reward off).
-- 🔴 CINDER IS CREDITED THROUGH _ct_cinder_give, NOT wallet_credit. Both are
--    the canonical wallet write (user_progress.cinder + the gems mirror + one
--    wallet_ledger 'credit' row), but wallet_credit is the CLIENT-callable
--    credit: it keys on auth.uid(), and above its 4.5M/day window it parks the
--    excess in wallet_holds and returns a balance, not what was paid — so a
--    15,000 reward could come back "credited" while sitting in a hold. Here
--    the amount is already bounded far below that window by the server's own
--    ceiling, so the plain definer credit is the correct one; its ledger row
--    still counts toward wallet_credit's 24-hour window for later credits.
-- ⚠ CASH-OUT: cashable_cinder() is gems minus aza_exchanges. Cinder paid here
--   is therefore CASHABLE, and these three rewards are unverifiable (the
--   client can lie about reaching them). At the vault's 5,000 = $1.00 that is
--   up to 3 × 15,000 = 45,000 Cinder ≈ $9 per account per day. OWNER'S CALL.
-- ⚠ Not written to aza_reward_log on purpose: that log feeds sov_reward's
--   60/day global ceiling, and a 500-AZA coupon would lock every covert
--   reward for a day.
-- ⚠ Ledger reasons avoid the word "grant": the AZA history module labels
--   any reason matching /admin|grant|compensat/ as an admin grant.
-- RLS: every new table has RLS on and its policies in this file. No player
--   INSERT/UPDATE/DELETE policy anywhere — writes come only from the
--   definer functions below.
-- ===========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Tables
-- --------------------------------------------------------------------------

-- 🔥 THE OWNER'S CINDER CEILING — one row per reward, per player, per UTC day.
--    "give cinder instead max 15,000". To change a figure:
--      update public.cinder_reward_caps set daily_cinder = <n> where bucket = 'tw_loot';
--    0 switches that reward off (every claim is refused, nothing consumed).
--    ON CONFLICT DO NOTHING: a figure the owner has tuned survives a re-run.
create table if not exists public.cinder_reward_caps (
  bucket        text primary key,
  daily_cinder  bigint not null check (daily_cinder >= 0),
  note          text
);
insert into public.cinder_reward_caps (bucket, daily_cinder, note) values
  ('season_pass', 15000, 'Season Pass premium tiers 8/15/21/28 (were AZA). Owner 2026-09-18: max 15,000 Cinder.'),
  ('tw_loot',     15000, 'Territory Wars Aza/AzaFragments loot (was AZA). Owner 2026-09-18: max 15,000 Cinder.'),
  ('oilsim',      15000, 'Oil Sim contracts + emergencies together (were AZA). Owner 2026-09-18: max 15,000 Cinder.')
on conflict (bucket) do nothing;

-- One row per grantable kind: the per-claim clamp for the kinds the server
-- cannot verify, and an on/off switch for all of them.
-- `pays` says which wallet a kind credits. For pays = 'cinder' kinds,
-- max_per_claim is in the reward's own AZA-NAMED units (what the tier table /
-- the client names), converted at aza_config.cinder_per_aza; their day is
-- bounded by cinder_reward_caps via cinder_bucket, and daily_cap is unused (0).
create table if not exists public.aza_grant_kinds (
  kind            text primary key,
  mode            text   not null check (mode in ('coupon', 'season', 'capped', 'trade', 'broker')),
  enabled         boolean not null default true,
  max_per_claim   bigint not null default 0 check (max_per_claim >= 0),   -- capped kinds only
  daily_cap       bigint not null default 0 check (daily_cap >= 0),       -- AZA kinds; 0 = no per-day ceiling
  cooldown_days   int    not null default 0 check (cooldown_days >= 0),   -- season: per-tier
  verified        boolean not null default false,
  pays            text   not null default 'aza',   -- checked by aza_grant_kinds_pays_chk below
  cinder_bucket   text   references public.cinder_reward_caps(bucket),
  note            text,
  constraint aza_grant_kinds_cinder_bucket check ((pays = 'cinder') = (cinder_bucket is not null))
);
-- Re-run safety for a copy of the table made by an earlier draft of this file.
alter table public.aza_grant_kinds add column if not exists pays text not null default 'aza';
alter table public.aza_grant_kinds add column if not exists cinder_bucket text references public.cinder_reward_caps(bucket);

-- Seed. ON CONFLICT DO NOTHING: a ceiling the owner has tuned is not reset
-- by re-running this file.
insert into public.aza_grant_kinds (kind, mode, enabled, max_per_claim, daily_cap, cooldown_days, verified, pays, cinder_bucket, note) values
  ('coupon',           'coupon', true, 0, 0,   0,  true, 'aza', null,
     'Amount + validity from aza_coupons (admin-only). Once per user+code.'),
  ('season_pass',      'season', true, 0, 0,   80, false, 'cinder', 'season_pass',
     'UNVERIFIABLE: tier + premium are device state. PAYS CINDER: aza_season_tiers × aza_config rate; each tier once per 80 days; 15,000/day (cinder_reward_caps).'),
  ('tw_loot',          'capped', true, 5, 0,   0,  false, 'cinder', 'tw_loot',
     'UNVERIFIABLE: TW ownership + yield multipliers are client state. PAYS CINDER. No live node yields Aza (2026-09-17).'),
  ('oilsim_contract',  'capped', true, 5, 0,   0,  false, 'cinder', 'oilsim',
     'UNVERIFIABLE: Oil Sim contracts are generated + fulfilled on the client. PAYS CINDER; client names 3-4 per contract.'),
  ('oilsim_emergency', 'capped', true, 12, 0,  0,  false, 'cinder', 'oilsim',
     'UNVERIFIABLE: Oil Sim emergencies are client-side. PAYS CINDER; client names 9-13 each.'),
  ('trade_pay',        'trade',  true, 0, 0,   0,  true,  'aza', null, 'Luni buyer pays an AZA sale: charge of the server ledger price.'),
  ('trade_collect',    'trade',  true, 0, 0,   0,  true,  'aza', null, 'Luni seller collects exactly what the buyer was charged.'),
  ('broker_escrow',    'broker', true, 0, 0,   0,  true,  'aza', null, 'Broker maker escrows AZA (charge, snapshotted).'),
  ('broker_pay',       'broker', true, 0, 0,   0,  true,  'aza', null, 'Broker taker pays the AZA ask (charge, snapshotted).'),
  ('broker_release',   'broker', true, 0, 0,   0,  true,  'aza', null, 'Escrow leaves ONCE: to the taker on accept or back to the maker on cancel.'),
  ('broker_collect',   'broker', true, 0, 0,   0,  true,  'aza', null, 'Broker maker collects what the taker paid.')
on conflict (kind) do nothing;
-- WHICH WALLET is structure, not tuning, so it is (re)asserted on every run —
-- the owner's decision must hold even over a row an earlier draft seeded.
update public.aza_grant_kinds set pays = 'cinder', cinder_bucket = 'season_pass', daily_cap = 0 where kind = 'season_pass';
update public.aza_grant_kinds set pays = 'cinder', cinder_bucket = 'tw_loot',     daily_cap = 0 where kind = 'tw_loot';
update public.aza_grant_kinds set pays = 'cinder', cinder_bucket = 'oilsim',      daily_cap = 0 where kind in ('oilsim_contract', 'oilsim_emergency');
do $c$ begin
  alter table public.aza_grant_kinds add constraint aza_grant_kinds_pays_chk check (pays in ('aza', 'cinder'));
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.aza_grant_kinds add constraint aza_grant_kinds_cinder_bucket check ((pays = 'cinder') = (cinder_bucket is not null));
exception when duplicate_object then null; end $c$;

-- Admin-authored coupons. The CLIENT's DEFAULT_COUPONS / Forge.coupons still
-- carry the non-AZA rewards; only the AZA part is honoured from here.
create table if not exists public.aza_coupons (
  code        text primary key check (code = upper(btrim(code)) and length(code) between 1 and 40),
  aza         bigint not null check (aza > 0),
  max_uses    int    not null default 0 check (max_uses >= 0),     -- 0 = unlimited
  expires_at  timestamptz,
  enabled     boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);
-- ⚠ SEEDED DISABLED. WELCOME2026 is 15 AZA (owner, 2026-09-18 — the client's
--   500 was a typo, now corrected to 15 in DEFAULT_COUPONS). The code is
--   readable in the page source, so enabling it hands 15 AZA to anyone who
--   opens devtools; enabling is the owner's call.
insert into public.aza_coupons (code, aza, max_uses, enabled, note) values
  ('WELCOME2026', 15, 0, false,
   'DISABLED pending owner decision: 15 AZA, code is public in the client source. The 9 accounts that redeemed it locally were repaired to +15 each on 2026-09-18.')
on conflict (code) do nothing;

-- The Season Pass AZA tiers — lifted from SEASON_PREMIUM_REWARDS (index.html).
create table if not exists public.aza_season_tiers (
  tier  int primary key check (tier between 1 and 30),
  aza   bigint not null check (aza > 0)
);
insert into public.aza_season_tiers (tier, aza) values (8, 1), (15, 2), (21, 3), (28, 5)
on conflict (tier) do nothing;

-- Every server AZA move this file makes, with the key that makes it
-- exactly-once. aza is SIGNED: charges are negative.
-- `cinder` is what a pays = 'cinder' kind credited (aza is 0 on those rows).
-- Append-only: the day's used room is sum(cinder), never a stored counter.
create table if not exists public.aza_grant_claims (
  id          bigserial primary key,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  kind        text   not null references public.aza_grant_kinds(kind),
  claim_key   text   not null check (length(claim_key) between 1 and 160),
  aza         bigint not null,
  cinder      bigint not null default 0 check (cinder >= 0),
  meta        jsonb  not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, claim_key)
);
alter table public.aza_grant_claims add column if not exists cinder bigint not null default 0;
create index if not exists aza_grant_claims_user_kind_ts on public.aza_grant_claims (user_id, kind, created_at desc);
create index if not exists aza_grant_claims_kind_key     on public.aza_grant_claims (kind, claim_key);

-- The LOCK ROW for the Cinder ceiling: one per user + reward + UTC day. It
-- carries no money (the room is summed from aza_grant_claims); it exists so
-- two tabs claiming at once serialise on a real row (SELECT … FOR UPDATE)
-- and the second one sees the first one's claim before it measures the room.
create table if not exists public.cinder_reward_days (
  user_id     uuid not null references auth.users(id) on delete cascade,
  bucket      text not null references public.cinder_reward_caps(bucket),
  day         date not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, bucket, day)
);

-- --------------------------------------------------------------------------
-- 2. RLS — reviewed line by line.
-- --------------------------------------------------------------------------
alter table public.aza_grant_kinds  enable row level security;
alter table public.aza_coupons      enable row level security;
alter table public.aza_season_tiers enable row level security;
alter table public.aza_grant_claims enable row level security;
alter table public.cinder_reward_caps enable row level security;
alter table public.cinder_reward_days enable row level security;

-- Ceilings + tiers are public to signed-in players so the UI can show the
-- same numbers that are enforced.
drop policy if exists agk_sel on public.aza_grant_kinds;
create policy agk_sel on public.aza_grant_kinds  for select to authenticated using (true);
drop policy if exists ast_sel on public.aza_season_tiers;
create policy ast_sel on public.aza_season_tiers for select to authenticated using (true);
drop policy if exists crc_sel on public.cinder_reward_caps;
create policy crc_sel on public.cinder_reward_caps for select to authenticated using (true);
-- Lock rows: a player sees only their OWN. No write policy — only the
-- definer core below inserts them.
drop policy if exists crd_sel on public.cinder_reward_days;
create policy crd_sel on public.cinder_reward_days for select to authenticated using (user_id = auth.uid());

-- Coupons: ADMIN ONLY, every verb. A player must not be able to list codes.
drop policy if exists acp_admin_sel on public.aza_coupons;
create policy acp_admin_sel on public.aza_coupons for select to authenticated using (public.is_admin());
drop policy if exists acp_admin_ins on public.aza_coupons;
create policy acp_admin_ins on public.aza_coupons for insert to authenticated with check (public.is_admin());
drop policy if exists acp_admin_upd on public.aza_coupons;
create policy acp_admin_upd on public.aza_coupons for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists acp_admin_del on public.aza_coupons;
create policy acp_admin_del on public.aza_coupons for delete to authenticated using (public.is_admin());

-- Claims: a player reads their OWN rows. No write policy.
drop policy if exists agc_sel on public.aza_grant_claims;
create policy agc_sel on public.aza_grant_claims for select to authenticated using (user_id = auth.uid());

revoke all on public.aza_grant_kinds, public.aza_season_tiers, public.aza_grant_claims from anon;
revoke insert, update, delete on public.aza_grant_kinds, public.aza_season_tiers, public.aza_grant_claims from authenticated;
grant select on public.aza_grant_kinds, public.aza_season_tiers, public.aza_grant_claims to authenticated;
revoke all on public.aza_coupons from anon;
grant select, insert, update, delete on public.aza_coupons to authenticated;   -- RLS makes this admin-only
revoke all on sequence public.aza_grant_claims_id_seq from anon, authenticated;
revoke all on public.cinder_reward_caps, public.cinder_reward_days from anon;
revoke insert, update, delete on public.cinder_reward_caps, public.cinder_reward_days from authenticated;
grant select on public.cinder_reward_caps, public.cinder_reward_days to authenticated;

-- --------------------------------------------------------------------------
-- 3. Private helpers
-- --------------------------------------------------------------------------
-- Balance read for replies that move nothing.
create or replace function public._aza_bal(p_uid uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select sovereigns from public.user_progress where user_id = p_uid), 0)::bigint
$$;
revoke all on function public._aza_bal(uuid) from public, anon, authenticated;

-- The per-kind daily ceiling. NULL = allowed, else an error jsonb.
create or replace function public._aza_cap_check(p_uid uuid, p_kind text, p_amt bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k public.aza_grant_kinds%rowtype;
  v_today bigint;
begin
  select * into k from public.aza_grant_kinds where kind = p_kind;
  if k.kind is null then return jsonb_build_object('ok', false, 'error', 'unknown_kind'); end if;
  if not k.enabled then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if k.daily_cap > 0 then
    select coalesce(sum(aza), 0) into v_today from public.aza_grant_claims
     where user_id = p_uid and kind = p_kind and aza > 0 and created_at > now() - interval '24 hours';
    if v_today + p_amt > k.daily_cap then
      return jsonb_build_object('ok', false, 'error', 'daily_cap', 'today', v_today, 'cap', k.daily_cap);
    end if;
  end if;
  return null;
end $$;
revoke all on function public._aza_cap_check(uuid, text, bigint) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 4. COUPON — verified against the admin table, once per user+code.
-- --------------------------------------------------------------------------
create or replace function public.aza_redeem_coupon(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  c      public.aza_coupons%rowtype;
  v_used int;
  v_err  jsonb;
  v_id   bigint;
  v_bal  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if length(v_code) < 1 or length(v_code) > 40 then return jsonb_build_object('ok', false, 'error', 'unknown_coupon'); end if;

  -- Row lock: serialises concurrent redemptions so max_uses cannot be overrun.
  select * into c from public.aza_coupons where code = v_code for update;
  if c.code is null then return jsonb_build_object('ok', false, 'error', 'unknown_coupon'); end if;
  if not c.enabled then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if c.expires_at is not null and c.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;

  if exists (select 1 from public.aza_grant_claims where user_id = v_uid and kind = 'coupon' and claim_key = v_code) then
    return jsonb_build_object('ok', true, 'already', true, 'credited', 0, 'aza', public._aza_bal(v_uid));
  end if;
  if c.max_uses > 0 then
    select count(*) into v_used from public.aza_grant_claims where kind = 'coupon' and claim_key = v_code;
    if v_used >= c.max_uses then return jsonb_build_object('ok', false, 'error', 'used_up'); end if;
  end if;
  v_err := public._aza_cap_check(v_uid, 'coupon', c.aza);
  if v_err is not null then return v_err; end if;

  insert into public.aza_grant_claims (user_id, kind, claim_key, aza, meta)
  values (v_uid, 'coupon', v_code, c.aza, jsonb_build_object('code', v_code))
  on conflict (user_id, kind, claim_key) do nothing returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', true, 'already', true, 'credited', 0, 'aza', public._aza_bal(v_uid));
  end if;

  v_bal := public._sov_apply(v_uid, c.aza, 'Aza reward: coupon ' || v_code);
  if v_bal is null then raise exception 'aza_redeem_coupon: credit failed for % (%)', v_uid, v_code; end if;
  return jsonb_build_object('ok', true, 'already', false, 'credited', c.aza, 'aza', v_bal, 'code', v_code);
end $$;
revoke all on function public.aza_redeem_coupon(text) from public, anon;
grant execute on function public.aza_redeem_coupon(text) to authenticated;

-- --------------------------------------------------------------------------
-- 5-6. THE CINDER REWARDS — season pass, Territory Wars loot, Oil Sim.
--    OWNER 2026-09-18: "give cinder instead max 15,000". These were AZA
--    grants (aza_claim_season / aza_claim_capped in the earlier draft, never
--    applied). They now credit CINDER, converted from the AZA amount the
--    reward names at aza_config.cinder_per_aza, bounded per player per UTC
--    day per reward by cinder_reward_caps.
-- --------------------------------------------------------------------------
drop function if exists public.aza_claim_season(int, text);
drop function if exists public.aza_claim_capped(text, text, bigint);

-- The game's own published AZA→Cinder rate (RUN_017; the Bank of Ethos
-- exchange pays at it). NULL when the config is missing — the caller refuses
-- rather than inventing a number.
create or replace function public._cinder_per_aza()
returns bigint language sql stable security definer set search_path = public as $$
  -- NOT gated on aza_config.enabled: that switches the exchange ATM off, it
  -- does not change what an AZA-named reward is worth.
  select cinder_per_aza::bigint from public.aza_config where id = 1 and cinder_per_aza > 0
$$;
revoke all on function public._cinder_per_aza() from public, anon, authenticated;

-- The one place a Cinder reward is paid. Callers have already resolved the
-- kind and clamped the AZA-named amount; this function:
--   1. locks the user's (reward, UTC day) row — two tabs serialise HERE;
--   2. returns 'already' if this claim key was paid (retry-safe);
--   3. season kind: refuses a tier paid within cooldown_days;
--   4. measures the day's room = cap − sum(cinder) of this reward's claims;
--      no room → 'daily_cap', NOTHING consumed (the client may retry later);
--   5. pays least(wanted, room) — a partial last claim — records the claim
--      (consumed ONCE, whatever it paid) and credits via _ct_cinder_give.
-- Returns { ok, credited, wanted, clamped, cinder, wallet_seq, cap, used_today, room_left }.
create or replace function public._cinder_reward_pay(
  p_uid uuid, p_kind text, p_key text, p_aza_named bigint, p_meta jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k       public.aza_grant_kinds%rowtype;
  v_cap   bigint;
  v_rate  bigint;
  v_want  bigint;
  v_day   date := (now() at time zone 'utc')::date;
  v_from  timestamptz;
  v_used  bigint;
  v_room  bigint;
  v_pay   bigint;
  v_last  timestamptz;
  v_tier  int := nullif(p_meta->>'tier', '')::int;
  v_id    bigint;
  v_give  jsonb;
  v_bal   bigint;
  v_seq   bigint;
begin
  select * into k from public.aza_grant_kinds where kind = p_kind;
  if k.kind is null or k.pays <> 'cinder' or k.cinder_bucket is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_kind');
  end if;
  if not k.enabled then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select daily_cinder into v_cap from public.cinder_reward_caps where bucket = k.cinder_bucket;
  if coalesce(v_cap, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  v_rate := public._cinder_per_aza();
  if v_rate is null then return jsonb_build_object('ok', false, 'error', 'no_rate'); end if;
  if coalesce(p_aza_named, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  v_want := p_aza_named * v_rate;

  -- 1. The row lock. Insert-if-absent, then lock it: a concurrent claim for
  --    the same user + reward + day waits here until this one commits.
  insert into public.cinder_reward_days (user_id, bucket, day) values (p_uid, k.cinder_bucket, v_day)
  on conflict (user_id, bucket, day) do nothing;
  perform 1 from public.cinder_reward_days
   where user_id = p_uid and bucket = k.cinder_bucket and day = v_day for update;

  -- 2. Exactly once per claim key.
  if exists (select 1 from public.aza_grant_claims where user_id = p_uid and kind = p_kind and claim_key = p_key) then
    select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = p_uid;
    return jsonb_build_object('ok', true, 'already', true, 'credited', 0,
                              'cinder', coalesce(v_bal, 0), 'wallet_seq', coalesce(v_seq, 0));
  end if;

  -- 3. Season: each tier at most once per cooldown_days (a season is 90).
  if k.mode = 'season' then
    select max(created_at) into v_last from public.aza_grant_claims
     where user_id = p_uid and kind = p_kind and (meta->>'tier')::int = v_tier;
    if v_last is not null and v_last > now() - make_interval(days => coalesce(k.cooldown_days, 80)) then
      return jsonb_build_object('ok', false, 'error', 'cooldown', 'tier', v_tier,
                                'next_at', v_last + make_interval(days => coalesce(k.cooldown_days, 80)));
    end if;
  end if;

  -- 4. The day's room for THIS reward (all its kinds — Oil Sim's two share).
  v_from := v_day::timestamp at time zone 'utc';
  select coalesce(sum(c.cinder), 0) into v_used
    from public.aza_grant_claims c
    join public.aza_grant_kinds gk on gk.kind = c.kind
   where c.user_id = p_uid and gk.cinder_bucket = k.cinder_bucket
     and c.created_at >= v_from and c.created_at < v_from + interval '1 day';
  v_room := greatest(0, v_cap - v_used);
  if v_room <= 0 then
    return jsonb_build_object('ok', false, 'error', 'daily_cap', 'cap', v_cap, 'used_today', v_used,
                              'retry_after', v_from + interval '1 day');
  end if;

  -- 5. Pay what fits; the claim is consumed once, whatever it paid.
  v_pay := least(v_want, v_room);
  insert into public.aza_grant_claims (user_id, kind, claim_key, aza, cinder, meta)
  values (p_uid, p_kind, p_key, 0, v_pay,
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('aza_named', p_aza_named, 'rate', v_rate,
                                                              'wanted', v_want, 'day', v_day))
  on conflict (user_id, kind, claim_key) do nothing returning id into v_id;
  if v_id is null then
    select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = p_uid;
    return jsonb_build_object('ok', true, 'already', true, 'credited', 0,
                              'cinder', coalesce(v_bal, 0), 'wallet_seq', coalesce(v_seq, 0));
  end if;
  v_give := public._ct_cinder_give(p_uid, v_pay, p_reason);
  if v_give is null or coalesce((v_give->>'moved')::bigint, 0) <> v_pay then
    raise exception '_cinder_reward_pay: credit failed for % (% %)', p_uid, p_kind, p_key;
  end if;
  select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = p_uid;
  return jsonb_build_object('ok', true, 'already', false, 'credited', v_pay, 'wanted', v_want,
                            'clamped', v_pay < v_want, 'cinder', coalesce(v_bal, 0),
                            'wallet_seq', coalesce(v_seq, 0), 'cap', v_cap,
                            'used_today', v_used + v_pay, 'room_left', v_room - v_pay);
end $$;
revoke all on function public._cinder_reward_pay(uuid, text, text, bigint, jsonb, text) from public, anon, authenticated;

-- SEASON PASS — the amount comes from aza_season_tiers (never the client);
-- tier reach and Premium are NOT verifiable, so each tier pays once per
-- cooldown_days. p_claim_key is the client's id for this claim (season start
-- + tier) and exists only to make a retry idempotent.
create or replace function public.cinder_claim_season(p_tier int, p_claim_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_key text := btrim(coalesce(p_claim_key, ''));
  v_amt bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if length(v_key) < 1 or length(v_key) > 160 then return jsonb_build_object('ok', false, 'error', 'bad_key'); end if;
  select aza into v_amt from public.aza_season_tiers where tier = p_tier;
  if v_amt is null then return jsonb_build_object('ok', false, 'error', 'not_a_reward_tier'); end if;
  return public._cinder_reward_pay(v_uid, 'season_pass', v_key, v_amt,
                                   jsonb_build_object('tier', p_tier), 'Season Pass reward — tier ' || p_tier)
         || jsonb_build_object('tier', p_tier);
end $$;
revoke all on function public.cinder_claim_season(int, text) from public, anon;
grant execute on function public.cinder_claim_season(int, text) to authenticated;

-- CAPPED KINDS — the server cannot verify these at all. p_requested is the
-- AZA amount the client's reward names; it is clamped to max_per_claim, then
-- converted and bounded by the day. Only mode 'capped' + pays 'cinder' kinds
-- are accepted, so this cannot be pointed at a coupon, trade or season kind.
create or replace function public.cinder_claim_capped(p_kind text, p_claim_key text, p_requested bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  k     public.aza_grant_kinds%rowtype;
  v_key text := btrim(coalesce(p_claim_key, ''));
  v_amt bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select * into k from public.aza_grant_kinds where kind = p_kind;
  if k.kind is null or k.mode <> 'capped' or k.pays <> 'cinder' then return jsonb_build_object('ok', false, 'error', 'unknown_kind'); end if;
  if length(v_key) < 1 or length(v_key) > 160 then return jsonb_build_object('ok', false, 'error', 'bad_key'); end if;
  v_amt := least(greatest(coalesce(p_requested, 0), 0), k.max_per_claim);
  if v_amt <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  return public._cinder_reward_pay(v_uid, p_kind, v_key, v_amt,
                                   jsonb_build_object('requested', p_requested),
                                   case p_kind when 'tw_loot' then 'Territory Wars loot'
                                               when 'oilsim_emergency' then 'Oil field emergency'
                                               when 'oilsim_contract' then 'Oil field contract'
                                               else 'Reward: ' || p_kind end);
end $$;
revoke all on function public.cinder_claim_capped(text, text, bigint) from public, anon;
grant execute on function public.cinder_claim_capped(text, text, bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 7. LUNI (resource exchange) — a transfer, not a credit.
-- --------------------------------------------------------------------------
-- The BUYER pays for an AZA sale row rl_take_lots wrote. Charge first; the
-- claim row is written only after the charge landed, under the ledger row's
-- lock, so two calls cannot both charge.
create or replace function public.aza_trade_pay(p_ledger_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  e     public.resource_trade_ledger%rowtype;
  v_amt bigint;
  v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select * into e from public.resource_trade_ledger where id = p_ledger_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_such_trade'); end if;
  if e.buyer_id is distinct from v_uid then return jsonb_build_object('ok', false, 'error', 'not_your_purchase'); end if;
  if e.kind <> 'sale' or coalesce(e.currency, '') <> 'aza' or e.voided_at is not null then
    return jsonb_build_object('ok', false, 'error', 'not_an_aza_sale', 'fallback', true);
  end if;
  if exists (select 1 from public.aza_grant_claims where kind = 'trade_pay' and claim_key = e.id::text) then
    return jsonb_build_object('ok', true, 'already', true, 'paid', 0, 'aza', public._aza_bal(v_uid));
  end if;
  v_amt := greatest(0, coalesce(e.price_total, 0))::bigint;
  if v_amt > 0 then
    v_bal := public._sov_apply(v_uid, -v_amt, 'Resource exchange purchase #' || e.id);
    if v_bal is null then
      return jsonb_build_object('ok', false, 'error', 'insufficient', 'need', v_amt, 'aza', public._aza_bal(v_uid));
    end if;
  else
    v_bal := public._aza_bal(v_uid);
  end if;
  insert into public.aza_grant_claims (user_id, kind, claim_key, aza, meta)
  values (v_uid, 'trade_pay', e.id::text, -v_amt, jsonb_build_object('ledger_id', e.id));
  return jsonb_build_object('ok', true, 'already', false, 'paid', v_amt, 'aza', v_bal);
end $$;
revoke all on function public.aza_trade_pay(bigint) from public, anon;
grant execute on function public.aza_trade_pay(bigint) to authenticated;

-- The SELLER collects what the buyer was charged. The resource_trade_claims
-- seller row and the credit are one transaction (the 155_C pattern), so a
-- claim can never be spent without the AZA, nor pay twice.
-- ⚠ Foundation tax: FR_TAX_RATE is 0 today, so none is taken, matching
--   155_C. If the tax is turned on it must be taken HERE (owner decision).
create or replace function public.aza_trade_collect(p_ledger_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid  uuid := auth.uid();
  e      public.resource_trade_ledger%rowtype;
  v_paid bigint;
  v_got  bigint;
  v_bal  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select * into e from public.resource_trade_ledger where id = p_ledger_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_such_trade'); end if;
  if e.seller_id is distinct from v_uid then return jsonb_build_object('ok', false, 'error', 'not_your_sale'); end if;
  if e.kind <> 'sale' or coalesce(e.currency, '') <> 'aza' or e.voided_at is not null then
    return jsonb_build_object('ok', false, 'error', 'not_an_aza_sale', 'fallback', true);
  end if;
  select -aza into v_paid from public.aza_grant_claims where kind = 'trade_pay' and claim_key = e.id::text;
  if v_paid is null then
    -- The buyer has not paid on the server yet. Leave the row unclaimed so it
    -- stays on the board; it is collectable the moment they do.
    return jsonb_build_object('ok', false, 'error', 'buyer_not_paid', 'waiting', true);
  end if;
  insert into public.resource_trade_claims (ledger_id, party, claimed_by)
  values (e.id, 'seller', v_uid)
  on conflict (ledger_id, party) do nothing returning ledger_id into v_got;
  if v_got is null then
    return jsonb_build_object('ok', true, 'claimed', false, 'credited', 0, 'aza', public._aza_bal(v_uid));
  end if;
  insert into public.aza_grant_claims (user_id, kind, claim_key, aza, meta)
  values (v_uid, 'trade_collect', e.id::text, v_paid, jsonb_build_object('ledger_id', e.id));
  if v_paid > 0 then
    v_bal := public._sov_apply(v_uid, v_paid, 'Resource exchange sale #' || e.id);
    if v_bal is null then raise exception 'aza_trade_collect: credit failed for % (#%)', v_uid, e.id; end if;
  else
    v_bal := public._aza_bal(v_uid);
  end if;
  return jsonb_build_object('ok', true, 'claimed', true, 'credited', v_paid, 'aza', v_bal, 'ledger_id', e.id);
end $$;
revoke all on function public.aza_trade_collect(bigint) from public, anon;
grant execute on function public.aza_trade_collect(bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 8. BROKER DEALS — escrow, accept, collect, refund. Every payout pays an
--    amount a charge recorded; the deal jsonb is never trusted after the
--    moment it is charged (the maker may edit it — broker_maker_update).
-- --------------------------------------------------------------------------
create or replace function public._aza_int(j jsonb)
returns bigint language sql immutable as $$
  select case when jsonb_typeof(j) = 'number' then greatest(0, floor((j)::text::numeric))::bigint else 0 end
$$;

create or replace function public.aza_broker_step(p_deal_id uuid, p_step text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  d     public.broker_deals%rowtype;
  v_key text := coalesce(p_deal_id::text, '');
  v_amt bigint;
  v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select * into d from public.broker_deals where id = p_deal_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_such_deal'); end if;
  if d.maker_id is distinct from v_uid then return jsonb_build_object('ok', false, 'error', 'not_your_deal'); end if;

  if p_step = 'escrow' then
    if d.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'not_open'); end if;
    if exists (select 1 from public.aza_grant_claims where kind = 'broker_escrow' and claim_key = v_key) then
      return jsonb_build_object('ok', true, 'already', true, 'aza', public._aza_bal(v_uid));
    end if;
    v_amt := public._aza_int(d.give->'aza');
    if v_amt <= 0 then return jsonb_build_object('ok', true, 'escrowed', 0, 'aza', public._aza_bal(v_uid)); end if;
    v_bal := public._sov_apply(v_uid, -v_amt, 'Broker deal escrow #' || left(v_key, 8));
    if v_bal is null then return jsonb_build_object('ok', false, 'error', 'insufficient', 'need', v_amt, 'aza', public._aza_bal(v_uid)); end if;
    insert into public.aza_grant_claims (user_id, kind, claim_key, aza) values (v_uid, 'broker_escrow', v_key, -v_amt);
    return jsonb_build_object('ok', true, 'escrowed', v_amt, 'aza', v_bal);

  elsif p_step = 'collect' then
    if d.status <> 'accepted' then return jsonb_build_object('ok', false, 'error', 'not_accepted'); end if;
    select -aza into v_amt from public.aza_grant_claims where kind = 'broker_pay' and claim_key = v_key;
    if v_amt is null then return jsonb_build_object('ok', false, 'error', 'taker_not_paid', 'waiting', true); end if;
    if exists (select 1 from public.aza_grant_claims where kind = 'broker_collect' and claim_key = v_key) then
      return jsonb_build_object('ok', true, 'already', true, 'credited', 0, 'aza', public._aza_bal(v_uid));
    end if;
    insert into public.aza_grant_claims (user_id, kind, claim_key, aza) values (v_uid, 'broker_collect', v_key, v_amt);
    v_bal := case when v_amt > 0 then public._sov_apply(v_uid, v_amt, 'Broker deal sale #' || left(v_key, 8)) else public._aza_bal(v_uid) end;
    if v_bal is null then raise exception 'aza_broker_step collect: credit failed'; end if;
    return jsonb_build_object('ok', true, 'credited', v_amt, 'aza', v_bal);

  elsif p_step = 'refund' then
    if d.status <> 'cancelled' then return jsonb_build_object('ok', false, 'error', 'not_cancelled'); end if;
    select -aza into v_amt from public.aza_grant_claims where kind = 'broker_escrow' and claim_key = v_key;
    if v_amt is null then return jsonb_build_object('ok', true, 'credited', 0, 'aza', public._aza_bal(v_uid)); end if;
    -- The escrow leaves exactly ONCE — whichever of taker-receive and refund
    -- comes first. Checked under the deal row's lock.
    if exists (select 1 from public.aza_grant_claims where kind = 'broker_release' and claim_key = v_key) then
      return jsonb_build_object('ok', true, 'already', true, 'credited', 0, 'aza', public._aza_bal(v_uid));
    end if;
    insert into public.aza_grant_claims (user_id, kind, claim_key, aza, meta)
    values (v_uid, 'broker_release', v_key, v_amt, jsonb_build_object('to', 'maker'));
    v_bal := case when v_amt > 0 then public._sov_apply(v_uid, v_amt, 'Broker deal escrow returned #' || left(v_key, 8)) else public._aza_bal(v_uid) end;
    if v_bal is null then raise exception 'aza_broker_step refund: credit failed'; end if;
    return jsonb_build_object('ok', true, 'credited', v_amt, 'aza', v_bal);
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_step');
end $$;
revoke all on function public.aza_broker_step(uuid, text) from public, anon;
grant execute on function public.aza_broker_step(uuid, text) to authenticated;

-- Accept + pay + receive in ONE transaction. p_expected_want is the AZA ask
-- the taker was SHOWN: if the maker edited the deal since, refuse rather than
-- charge a different number.
create or replace function public.aza_broker_accept(p_deal_id uuid, p_taker_name text, p_expected_want bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid  uuid := auth.uid();
  d      public.broker_deals%rowtype;
  v_key  text := coalesce(p_deal_id::text, '');
  v_want bigint;
  v_esc  bigint;
  v_bal  bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into d from public.broker_deals where id = p_deal_id for update;
  if not found or d.status <> 'open' or d.maker_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'deal_unavailable');
  end if;
  v_want := public._aza_int(d.want->'aza');
  if v_want <> greatest(0, coalesce(p_expected_want, 0)) then
    return jsonb_build_object('ok', false, 'error', 'deal_changed');
  end if;
  -- The maker's AZA escrow must exist if the deal offers AZA; otherwise the
  -- taker would be accepting goods that were never set aside.
  select -aza into v_esc from public.aza_grant_claims where kind = 'broker_escrow' and claim_key = v_key;
  if public._aza_int(d.give->'aza') > 0 and v_esc is null then
    return jsonb_build_object('ok', false, 'error', 'escrow_missing');
  end if;
  -- What the taker is shown (give.aza) must be what is actually escrowed, and
  -- an escrow that already went back to the maker cannot be offered again (a
  -- maker can flip a cancelled row back to 'open' under broker_maker_update).
  if public._aza_int(d.give->'aza') <> coalesce(v_esc, 0)
     or exists (select 1 from public.aza_grant_claims where kind = 'broker_release' and claim_key = v_key) then
    return jsonb_build_object('ok', false, 'error', 'deal_changed');
  end if;

  if v_want > 0 then
    v_bal := public._sov_apply(v_uid, -v_want, 'Broker deal purchase #' || left(v_key, 8));
    if v_bal is null then return jsonb_build_object('ok', false, 'error', 'insufficient', 'need', v_want, 'aza', public._aza_bal(v_uid)); end if;
    insert into public.aza_grant_claims (user_id, kind, claim_key, aza) values (v_uid, 'broker_pay', v_key, -v_want);
  end if;
  if coalesce(v_esc, 0) > 0 then
    insert into public.aza_grant_claims (user_id, kind, claim_key, aza, meta)
    values (v_uid, 'broker_release', v_key, v_esc, jsonb_build_object('to', 'taker'));
    v_bal := public._sov_apply(v_uid, v_esc, 'Broker deal received #' || left(v_key, 8));
    if v_bal is null then raise exception 'aza_broker_accept: release failed'; end if;
  end if;

  update public.broker_deals set status = 'accepted', taker_id = v_uid,
         taker_name = coalesce(p_taker_name, 'Player'), accepted_at = now()
   where id = p_deal_id;
  return jsonb_build_object('ok', true, 'give', d.give, 'want', d.want, 'maker_id', d.maker_id,
                            'paid', v_want, 'received', coalesce(v_esc, 0), 'aza', public._aza_bal(v_uid));
end $$;
revoke all on function public.aza_broker_accept(uuid, text, bigint) from public, anon;
grant execute on function public.aza_broker_accept(uuid, text, bigint) to authenticated;

-- The old accept RPC must not take an AZA deal: it moves no AZA, so a taker
-- would receive the maker's goods without paying and the maker's payout would
-- wait forever. Same body as live (read 2026-09-17) plus the refusal.
create or replace function public.broker_accept_deal(p_deal_id uuid, p_taker_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v broker_deals%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if exists (select 1 from broker_deals where id = p_deal_id
              and (public._aza_int(give->'aza') > 0 or public._aza_int(want->'aza') > 0)) then
    return jsonb_build_object('ok', false, 'error', 'use_aza_accept');
  end if;
  update broker_deals set status = 'accepted', taker_id = auth.uid(),
    taker_name = coalesce(p_taker_name, 'Player'), accepted_at = now()
    where id = p_deal_id and status = 'open' and maker_id <> auth.uid()
    returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'deal_unavailable'); end if;
  return jsonb_build_object('ok', true, 'give', v.give, 'want', v.want, 'maker_id', v.maker_id);
end $$;
revoke all on function public.broker_accept_deal(uuid, text) from public, anon;
grant execute on function public.broker_accept_deal(uuid, text) to authenticated;

commit;

-- ===========================================================================
-- VERIFY (read-only). Expect:
--   rls_on_4 = 4, coupons_readable_by_players_f = f (checked as policy text),
--   authed_can_coupon / authed_can_collect = t, anon_can_any = f, helpers_private = f,
--   kinds >= 11, tiers = 4, welcome_enabled = f,
--   rls_on_cinder_2 = 2, cinder_caps = 'oilsim=15000,season_pass=15000,tw_loot=15000',
--   cinder_kinds = 'oilsim_contract,oilsim_emergency,season_pass,tw_loot',
--   cinder_per_aza = 5000 (the rate the rewards convert at), old_aza_claims_gone = t,
--   authed_can_cinder = t, cinder_helpers_private = f.
select
  (select count(*) from pg_class where oid in ('public.aza_grant_kinds'::regclass, 'public.aza_coupons'::regclass,
      'public.aza_season_tiers'::regclass, 'public.aza_grant_claims'::regclass) and relrowsecurity)        as rls_on_4,
  (select count(*) from pg_class where oid in ('public.cinder_reward_caps'::regclass, 'public.cinder_reward_days'::regclass)
      and relrowsecurity)                                                                                  as rls_on_cinder_2,
  (select string_agg(bucket || '=' || daily_cinder, ',' order by bucket) from public.cinder_reward_caps)    as cinder_caps,
  (select string_agg(kind, ',' order by kind) from public.aza_grant_kinds where pays = 'cinder')           as cinder_kinds,
  public._cinder_per_aza()                                                                                as cinder_per_aza,
  (to_regprocedure('public.aza_claim_season(integer,text)') is null
    and to_regprocedure('public.aza_claim_capped(text,text,bigint)') is null)                               as old_aza_claims_gone,
  (has_function_privilege('authenticated', 'public.cinder_claim_season(integer,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.cinder_claim_capped(text,text,bigint)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.cinder_claim_season(integer,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.cinder_claim_capped(text,text,bigint)', 'EXECUTE'))     as authed_can_cinder,
  (has_function_privilege('authenticated', 'public._cinder_reward_pay(uuid,text,text,bigint,jsonb,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._cinder_per_aza()', 'EXECUTE'))                      as cinder_helpers_private,
  (select count(*) from pg_policies where tablename in ('cinder_reward_caps', 'cinder_reward_days') and cmd <> 'SELECT') as cinder_write_policies_0,
  (select bool_or(coalesce(qual, with_check, '') !~ 'is_admin') from pg_policies where tablename = 'aza_coupons') as coupons_readable_by_players_f,
  (select count(*) from pg_policies where tablename = 'aza_grant_claims' and cmd <> 'SELECT')               as claim_write_policies_0,
  has_function_privilege('authenticated', 'public.aza_redeem_coupon(text)', 'EXECUTE')                    as authed_can_coupon,
  has_function_privilege('authenticated', 'public.aza_trade_collect(bigint)', 'EXECUTE')                  as authed_can_collect,
  (has_function_privilege('anon', 'public.aza_redeem_coupon(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.cinder_claim_capped(text,text,bigint)', 'EXECUTE')
    or has_function_privilege('anon', 'public.aza_trade_pay(bigint)', 'EXECUTE')
    or has_function_privilege('anon', 'public.aza_broker_accept(uuid,text,bigint)', 'EXECUTE'))           as anon_can_any,
  (has_function_privilege('authenticated', 'public._aza_cap_check(uuid,text,bigint)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._aza_bal(uuid)', 'EXECUTE'))                       as helpers_private,
  (select count(*) from public.aza_grant_kinds)                                                           as kinds,
  (select count(*) from public.aza_season_tiers)                                                          as tiers,
  (select enabled from public.aza_coupons where code = 'WELCOME2026')                                     as welcome_enabled;
-- ===========================================================================
