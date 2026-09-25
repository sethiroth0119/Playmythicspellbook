-- ════════════════════════════════════════════════════════════════════
-- RUN FILE 2026-09-18 — every server change still pending (152–159)
-- Project: ktsiasyjusesawtrwrjc · paste into the Supabase SQL editor.
-- Checked live before writing this file: 146 / 150 / 151 are applied; 152–159
-- are not. Every part below is idempotent (safe to re-run) and ends with its
-- own check query. Order matters:
--   1  154  security: only a node's owner / its Node Manager can raise a PRN level
--   2  159  AZA grants on the server; season pass / TW loot / Oil Sim pay Cinder (15,000/day)
--   3  156  held Cinder released first, in one step   → then 4
--   4  157  releases ClareyV's 315,908 held Cinder
--   5  158  server-set camp hire prices
--   6  152  withdraw the treasury when closing a corporation
--   7  155  a Luni sale is paid in the same step that marks it collected
--   8  153  an in-city Node Manager appointment writes a real contract
--   9  records the WELCOME2026 redemptions (needs 159)
-- ════════════════════════════════════════════════════════════════════



-- ─────────────── sql/154_B_city_set_node_level_owner_or_manager.sql ───────────────

-- ════════════════════════════════════════════════════════════════════════════
-- 154_B · A PRN's LEVEL IS RAISED BY ITS OWNER'S CITY — NOT BY ANYONE WITH A LINK
--         DRAFT — NOT APPLIED. Idempotent (CREATE OR REPLACE, same signature,
--         same return type), re-runnable, ends with a verify SELECT.
--
-- REPORTS: bug-mu2n0w7s "Since this morning, I now have my own and also another
--          Node's PRNs in my city", bug-mtwuhbwu "PRN levels in Foundation
--          Reserve should match the node levels in the city".
--
-- THE HOLE (live function, read out of pg_proc 2026-09-17):
--   city_set_node_level(p_node_id uuid, p_level int) raises economy_nodes
--   meta.level (1..50) for the node's OWNER *or for anyone holding a
--   city_node_links row for it*. The only writer of city_node_links is
--   city_push_node_boost, whose 2-argument form inserts a link for ANY node id
--   the caller names, with no ownership test at all. So one 0 % boost buys the
--   right to set a stranger's PRN to level 50.
--   MEASURED in a rolled-back probe as a player with no relation to the node
--   (b35a8809's Research PRN, meta.level 20):
--       city_set_node_level(node, 50)              → NULL   (refused)
--       city_push_node_boost(node, 0)              → ok     (link written)
--       city_set_node_level(node, 50)              → 50     (stored meta.level 50)
--   Nothing persisted (re-read after: level 20, 0 links). anon also holds
--   EXECUTE on the function today.
--   It is also the server half of bug-mu2n0w7s: a Node Manager's OWN city rang
--   a client's PRNs through their links (fixed in the client), and every level
--   that ring earned was written onto the client's nodes from a city the client
--   does not own.
--
-- THE RULE: the caller is the node's owner, or the owner's ACTIVE Node Manager
--   (node_mayors) — the same test sql/105's city_push_node_boost applies with
--   p_owner, and the same two cities that legitimately ring the node (the
--   owner's own, and the owner's city the manager runs). city_node_links no
--   longer grants anything here. The 50 ceiling is unchanged; node-city now
--   caps its own counter at the same 50 (NODE_LEVEL_MAX).
--   anon's EXECUTE is revoked (auth.uid() is null for anon, so it already
--   returned NULL — this is hygiene, not a behaviour change).
--
-- RLS: no table or policy change. economy_nodes' policies are untouched; this
--   SECURITY DEFINER function stays the only level writer the client calls.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.city_set_node_level(p_node_id uuid, p_level integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cur   integer;
  v_owner uuid;
  v_new   integer := greatest(1, least(50, coalesce(p_level, 1)));
begin
  if auth.uid() is null then return null; end if;
  select n.owner_id, coalesce((n.meta->>'level')::int, 1)
    into v_owner, v_cur
    from economy_nodes n where n.id = p_node_id;
  if v_owner is null then return null; end if;
  if v_owner <> auth.uid()
     and not exists (select 1 from node_mayors m
                      where m.owner_id = v_owner and m.mayor_id = auth.uid() and m.active) then
    return null;
  end if;
  if v_new <= v_cur then return v_cur; end if;
  update economy_nodes
     set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('level', v_new),
         updated_at = now()
   where id = p_node_id;
  return v_new;
end $$;

revoke all on function public.city_set_node_level(uuid, integer) from public, anon;
grant execute on function public.city_set_node_level(uuid, integer) to authenticated;

commit;

-- --- VERIFY. Expect: no_link_grant_t = t, manager_test_t = t, anon_exec_f = f,
--     auth_exec_t = t.
select
  (select position('city_node_links' in pg_get_functiondef('public.city_set_node_level(uuid,integer)'::regprocedure)) = 0) as no_link_grant_t,
  (select position('node_mayors' in pg_get_functiondef('public.city_set_node_level(uuid,integer)'::regprocedure)) > 0)     as manager_test_t,
  has_function_privilege('anon', 'public.city_set_node_level(uuid,integer)', 'EXECUTE')                                   as anon_exec_f,
  has_function_privilege('authenticated', 'public.city_set_node_level(uuid,integer)', 'EXECUTE')                          as auth_exec_t;


-- ─────────────── sql/159_aza_server_grants.sql ───────────────

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


-- ─────────────── sql/156_hold_release.sql ───────────────

-- ===========================================================================
-- 156 — HELD CINDER IS RELEASED IN ONE SET-BASED MOVE, SO A BIG BACKLOG CAN
--       NEVER OUTGROW THE CALL THAT IS SUPPOSED TO PAY IT — AND HELD CINDER
--       IS PAID BEFORE NEW INCOME (held-first, section 3).
-- DRAFT — NOT APPLIED. Paste into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
-- Run BEFORE sql/157 (the one-off backlog release uses the function below).
-- (Edited in place 2026-09-18 to add section 3 — still never applied, so
-- there is no earlier "156" on live to reconcile with. Live today still runs
-- sql/093's wallet_credit and wallet_holds_release.)
--
-- Reported by the owner (2026-09-17): "ClareyV has 315,908 Cinder stuck behind
-- the daily earnings cap and never released."
--
-- THE DESIGN (sql/093; section 3 below changes the ORDER — holds are now paid
-- before new income): wallet_credit pays what fits under the
-- 4,500,000-per-rolling-24h ceiling and writes the rest as a wallet_holds row.
-- wallet_holds_release() pays holds back out, oldest first, into whatever room
-- the last 24 hours leave. The client calls it after every credit, on focus,
-- on sign-in and every ten minutes. Released Cinder is an ordinary 'credit'
-- ledger row, so it occupies the window like any other income.
--
-- WHAT WENT WRONG (measured read-only on live, 2026-09-18 03:50 UTC):
--   • ClareyV (6b721987…) owns 35,688 open hold rows totalling 315,908 — an
--     average of ~9 Cinder each, because every tiny credit over the ceiling
--     became its own row (14-17 Sep). released = 0 on every one of them.
--   • She has had ROOM since 2026-09-17 13:42 UTC: 47,888 used of 4,500,000
--     in the current window. The rule said "release now". Nothing released.
--   • The 093 release is a per-row PL/pgSQL loop: for EACH hold it updates the
--     hold, upserts + updates user_progress, updates user_profiles (whose
--     up_guard trigger counts six jsonb columns and scans the salvage forge on
--     every fire) and inserts a ledger row. 35,688 × five writes blows the
--     `authenticated` role's statement_timeout (8s). The statement is
--     cancelled, EVERYTHING rolls back, the next call starts from the same
--     35,688 rows plus whatever new ones arrived — so it can never succeed and
--     only gets further from succeeding. Reproduced in a rolled-back probe:
--       ERROR 57014 canceling statement due to statement timeout
--       CONTEXT update public.user_profiles set gems = v_bal … line 36
--   • The client swallowed the error (res.error → return, silently), so the
--     player was never told the release had failed; the "is being held" toast
--     stopped too, because it only fires on a successful answer.
--   • Every other player's holds DID release (8,851 rows / 3,514,102 Cinder,
--     largest single burst 1,858 rows in one minute). ClareyV is the only open
--     balance on live, and the only one whose row count crossed the timeout.
--
-- THE FIX: the same rule, done as ONE statement.
--   1. Lock the player's user_progress row FOR UPDATE first. Every release for
--      this player now queues on that lock, so two tabs / a retry cannot both
--      read the same open holds and pay them twice.
--   2. Lock the open hold rows, then allocate the room across them oldest
--      first with a running sum, in a single UPDATE … RETURNING.
--   3. Credit the TOTAL once through _ct_cinder_give (sql/048 — the existing
--      server wallet credit path: user_progress + user_profiles mirror + a
--      'credit' ledger row). One trigger fire instead of 35,688.
--   Steps 2 and 3 are in the same transaction as the locks: a hold is marked
--   released if and only if its Cinder landed. A second call finds released =
--   amount and pays 0.
--
-- 🔴 NOTHING IS MINTED. A release only moves amount - released of an existing
--    wallet_holds row into the wallet, and bumps released by exactly that. The
--    sum of what is paid equals the sum of what `released` grew by, always.
-- 🔴 THE RELEASE IS NOT PUT THROUGH wallet_credit, so the ceiling it releases
--    under cannot re-hold it. It is bounded by the same room computation 093
--    used (c_max_day - credits in the last 24h), no more.
-- ⚠ The public signature and the JSON answer are UNCHANGED
--    ({ok, released, held, cinder, cap, frees_at} + a new `holds` count), so the
--    client that is live today starts working the moment this is applied.
--
-- No new table, so no new RLS. wallet_holds keeps sql/093's single SELECT
-- policy (own rows only) and no write policy; the functions are the writers.
--
-- HELD-FIRST (section 3). OWNER DECISION 2026-09-18, to the question "new
-- earnings use up the daily room first, so a player at the cap every day never
-- gets held Cinder back. Should held Cinder be paid out first?": "yes".
--   Under 093, wallet_credit spent the day's room on the NEW income and only
--   then did the client's release call look for room — which a player at the
--   cap every day never leaves. Their holds sat forever while newer income
--   kept being paid. Now wallet_credit, under the player's wallet lock:
--     (a) releases open holds, oldest first, into the room — by CALLING the
--         worker above, not a copy of it, so the two can never drift;
--     (b) credits the new income into whatever room is left;
--     (c) holds the rest, appended BEHIND every older hold.
--   So the queue always drains oldest-first, and Cinder earned today can never
--   overtake Cinder held from yesterday. Since (a) fills the room before (b)
--   looks, "open holds remain" implies "room is 0": new income is never paid
--   while an older hold waits.
--   Conservation, per call, to the Cinder:
--     wallet_after + held_after = wallet_before + held_before + p_amount
--   ((a) moves held → wallet, (b) and (c) split p_amount between them.)
-- ONE OPEN HOLD ROW PER PLAYER. New excess is added to the player's NEWEST
--   open hold instead of inserting a row (a new row only when nothing is
--   open). That keeps FIFO exactly: releases fill oldest first, so the open
--   holds are always the tail of the queue and the newest open row is its
--   last position — adding to it appends behind everything already queued,
--   and the part already in the row still releases first (released counts up
--   from the front of the row). This is what stops a ClareyV repeating: her
--   35,688 rows were 35,688 small over-cap credits. The per-event audit stays
--   where it always was, one 'held' wallet_ledger row per held credit (with
--   asked= and held= in its reason); wallet_holds is the queue, not the log.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The worker. Takes a user id so the one-off backlog (sql/157) runs the
--    SAME code the players call. NOT callable by clients: a caller who could
--    name any uuid could release someone else's hold into that someone's
--    wallet (harmless to them, but it is not the caller's decision). Only the
--    wrapper below and the owner in the SQL editor reach it.
-- --------------------------------------------------------------------------
create or replace function public._wallet_holds_release_for(p_uid uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_bal   bigint;
  v_day   bigint;
  v_room  bigint;
  v_rel   bigint := 0;
  v_n     integer := 0;
  v_left  bigint := 0;
  v_frees timestamptz;
  v_give  jsonb;
  -- 🔴 OWNER-SET (2026-09-03, sql/093). Must match wallet_credit's c_max_day.
  c_max_day constant bigint := 4500000;
begin
  if p_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  -- (1) One release per player at a time. The row is created if missing so the
  --     lock always has something to hold (a player with holds always has one).
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  select coalesce(cinder, 0) into v_bal from public.user_progress where user_id = p_uid for update;

  select coalesce(sum(delta), 0) into v_day
    from public.wallet_ledger
   where user_id = p_uid and resource = 'cinder' and op = 'credit'
     and created_at > now() - interval '24 hours';
  v_room := greatest(0, c_max_day - v_day);

  if v_room > 0 then
    -- (2) Lock the open holds (FOR UPDATE cannot sit on the windowed query
    --     below, so it is taken here, separately, in the same order).
    perform 1 from public.wallet_holds
      where user_id = p_uid and released < amount
      order by created_at, id
        for update;

    with open_h as (
      select id, amount - released as rem,
             coalesce(sum(amount - released) over (order by created_at, id
                        rows between unbounded preceding and 1 preceding), 0) as before
        from public.wallet_holds
       where user_id = p_uid and released < amount
    ), take as (
      select id, least(rem, v_room - before) as t
        from open_h
       where before < v_room
    ), upd as (
      update public.wallet_holds h
         set released = h.released + take.t, updated_at = now()
        from take
       where h.id = take.id and take.t > 0
      returning take.t
    )
    select coalesce(sum(t), 0), count(*) into v_rel, v_n from upd;

    -- (3) Exactly what `released` grew by, credited once.
    if v_rel > 0 then
      v_give := public._ct_cinder_give(p_uid, v_rel,
                  'Held Cinder released (24h ceiling) x' || v_n || ' holds');
      v_bal := coalesce((v_give ->> 'balance')::bigint, v_bal + v_rel);
    end if;
  end if;

  select coalesce(sum(amount - released), 0) into v_left
    from public.wallet_holds where user_id = p_uid and released < amount;

  -- When the oldest credit in the window ages out: the earliest moment more
  -- room can appear. Only meaningful while something is still held.
  if v_left > 0 then
    select min(created_at) + interval '24 hours' into v_frees
      from public.wallet_ledger
     where user_id = p_uid and resource = 'cinder' and op = 'credit'
       and created_at > now() - interval '24 hours';
  end if;

  return jsonb_build_object('ok', true, 'released', v_rel, 'holds', v_n, 'held', v_left,
                            'cinder', coalesce(v_bal, 0), 'cap', c_max_day, 'frees_at', v_frees);
end$function$;
revoke all on function public._wallet_holds_release_for(uuid) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. The player's call — same name and answer as sql/093, only ever for
--    auth.uid(). The client calls it on sign-in, after every credit, on focus
--    and every ten minutes.
-- --------------------------------------------------------------------------
create or replace function public.wallet_holds_release()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  return public._wallet_holds_release_for(auth.uid());
end$function$;
revoke all on function public.wallet_holds_release() from public, anon;
grant execute on function public.wallet_holds_release() to authenticated;

-- --------------------------------------------------------------------------
-- 3. wallet_credit — HELD FIRST. Started from the LIVE definition
--    (pg_get_functiondef, 2026-09-18), which is sql/093's body with the
--    comments stripped and no logic change. Same signature, same bigint
--    answer (the wallet balance after the call — now including anything the
--    call released), same refusals, same ref rule. Seven server functions call
--    it (depot_claim, influence_resolve, merc_claim, merc_cancel_contract,
--    wallet_reconcile_self, and farm via _farm_wallet_credit) and all of them
--    only read that balance, so none of them change.
--
--    ⚠ LOCK ORDER. user_progress (this player) FOR UPDATE first, then the
--      hold rows — the same order as _wallet_holds_release_for, which takes
--      the same row lock again (a no-op inside one transaction). A credit and
--      a release for one player therefore queue behind each other instead of
--      deadlocking, and cannot both see the same open holds. The lock is
--      taken BEFORE the ref check, so two same-ref retries racing each other
--      now serialize and the second finds the ref (093 checked first and
--      locked later, so both could pass the check).
--    ⚠ The lock is taken only if the row already exists: creating an empty
--      user_progress row here, for a call that is then refused, would make a
--      brand-new player's client skip its first-sign-in seed (progress_ensure
--      only seeds when there is no row). The paying paths create it as 093 did.
--    ⚠ The single and hourly refusals run BEFORE the release, exactly where 093
--      had them, so releasing holds can never be what gets new income refused.
--    ⚠ A release is NOT routed through wallet_credit (it goes worker →
--      _ct_cinder_give), so nothing re-holds released Cinder.
-- --------------------------------------------------------------------------
create or replace function public.wallet_credit(p_amount bigint, p_reason text default 'reward', p_ref text default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid  uuid := auth.uid();
  v_bal  bigint;
  v_hour bigint;
  v_day  bigint;
  v_room bigint;
  v_hold bigint;
  v_rel  jsonb;
  v_hid  uuid;
  c_max_single constant bigint := 2000000;
  c_max_hour   constant bigint := 10000000;
  -- 🔴 OWNER-SET (2026-09-03, sql/093). Must match _wallet_holds_release_for's c_max_day.
  c_max_day    constant bigint := 4500000;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;

  -- (0) The player's wallet lock, first (see the lock-order note above).
  select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid for update;

  if p_ref is not null and exists (
       select 1 from public.wallet_ledger where user_id = v_uid and ref = p_ref) then
    return coalesce(v_bal, 0::bigint);
  end if;

  if p_amount > c_max_single then
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (v_uid, 'refused', 'cinder', 0, coalesce(v_bal,0),
              'REFUSED single>' || c_max_single || ' asked=' || p_amount || ' as=' || coalesce(p_reason,''));
    exception when undefined_table or undefined_column then null; end;
    return coalesce(v_bal, 0::bigint);
  end if;

  select coalesce(sum(delta),0) into v_hour
    from public.wallet_ledger
   where user_id = v_uid and resource='cinder' and op='credit'
     and created_at > now() - interval '1 hour';

  if v_hour + p_amount > c_max_hour then
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (v_uid, 'refused', 'cinder', 0, coalesce(v_bal,0),
              'REFUSED hourly>' || c_max_hour || ' used=' || v_hour || ' asked=' || p_amount || ' as=' || coalesce(p_reason,''));
    exception when undefined_table or undefined_column then null; end;
    return coalesce(v_bal, 0::bigint);
  end if;

  -- (a) ⏳ HELD FIRST. Older held Cinder takes the room before this income
  --     does. The worker is the one the players' release call runs; it locks
  --     user_progress (already ours) then the holds, and credits what it
  --     releases as a 'credit' ledger row — so the window sum below sees it.
  if exists (select 1 from public.wallet_holds where user_id = v_uid and released < amount) then
    v_rel := public._wallet_holds_release_for(v_uid);
    if coalesce((v_rel ->> 'released')::bigint, 0) > 0 then
      v_bal := coalesce((v_rel ->> 'cinder')::bigint, v_bal);
    end if;
  end if;

  -- (b) The new income gets only the room the holds left.
  select coalesce(sum(delta),0) into v_day
    from public.wallet_ledger
   where user_id = v_uid and resource='cinder' and op='credit'
     and created_at > now() - interval '24 hours';

  v_room := greatest(0, c_max_day - v_day);
  v_hold := greatest(0, p_amount - v_room);

  -- (c) What does not fit is appended BEHIND every older hold — into the
  --     player's newest open hold row (the tail of the queue), or a new row
  --     when nothing is open. See "ONE OPEN HOLD ROW PER PLAYER" in the header.
  if v_hold > 0 then
    update public.wallet_holds h
       set amount = h.amount + v_hold, updated_at = now()
     where h.id = (select id from public.wallet_holds
                    where user_id = v_uid and released < amount
                    order by created_at desc, id desc
                    limit 1)
    returning h.id into v_hid;
    if v_hid is null then
      insert into public.wallet_holds (user_id, amount, reason) values (v_uid, v_hold, p_reason);
    end if;
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (v_uid, 'held', 'cinder', 0, coalesce(v_bal,0),
              'HELD daily>' || c_max_day || ' used=' || v_day || ' asked=' || p_amount || ' held=' || v_hold || ' as=' || coalesce(p_reason,''),
              case when v_room > 0 then null else p_ref end);
    exception
      when unique_violation then null;
      when undefined_table or undefined_column then null;
    end;
    p_amount := p_amount - v_hold;
    if p_amount <= 0 then return coalesce(v_bal, 0::bigint); end if;
  end if;

  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.user_progress
     set cinder = coalesce(cinder, 0) + p_amount, updated_at = now()
   where user_id = v_uid
   returning cinder into v_bal;

  update public.user_profiles set gems = v_bal
   where user_id = v_uid and coalesce(gems, 0) < v_bal;

  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (v_uid, 'credit', 'cinder', p_amount, coalesce(v_bal, 0::bigint), p_reason, p_ref);
  exception
    when unique_violation then null;
    when undefined_table or undefined_column then null;
  end;

  return coalesce(v_bal, 0::bigint);
end$function$;
-- Same grants as live (authenticated + service_role; never anon).
revoke all on function public.wallet_credit(bigint, text, text) from public, anon;
grant execute on function public.wallet_credit(bigint, text, text) to authenticated, service_role;

-- ===========================================================================
-- VERIFY (read-only)
-- ===========================================================================
select
  (select prosrc not like '%for r in%' and prosrc like '%_ct_cinder_give%'
     from pg_proc where proname = '_wallet_holds_release_for')              as worker_is_set_based,
  (select prosrc like '%_wallet_holds_release_for(auth.uid())%'
     from pg_proc where proname = 'wallet_holds_release')                   as wrapper_uses_worker,
  has_function_privilege('authenticated', 'public.wallet_holds_release()', 'execute')              as players_can_release,
  not has_function_privilege('authenticated', 'public._wallet_holds_release_for(uuid)', 'execute') as players_cannot_name_a_uid,
  not has_function_privilege('anon', 'public.wallet_holds_release()', 'execute')                   as anon_cannot_call,
  (select prosrc like '%_wallet_holds_release_for(v_uid)%' and prosrc like '%for update%'
          and position('_wallet_holds_release_for(v_uid)' in prosrc) < position('v_room := greatest' in prosrc)
     from pg_proc where proname = 'wallet_credit')                          as credit_is_held_first,
  not has_function_privilege('anon', 'public.wallet_credit(bigint,text,text)', 'execute')          as anon_cannot_credit,
  (select count(*) from (select user_id from public.wallet_holds where released < amount
                          group by user_id having count(*) > 1) x)          as players_with_many_open_rows,  -- only pre-156 rows; shrinks as they drain
  (select count(*) from pg_policies where tablename = 'wallet_holds')        as wallet_holds_policies,   -- 1 (select own)
  (select count(distinct user_id) from public.wallet_holds where released < amount) as players_still_held,
  (select coalesce(sum(amount - released), 0) from public.wallet_holds where released < amount) as cinder_still_held;


-- ─────────────── sql/157_hold_release_backlog.sql ───────────────

-- ===========================================================================
-- 157 — ONE-OFF: RELEASE THE HELD CINDER THAT THE BROKEN 093 RELEASE STRANDED.
-- DRAFT — NOT APPLIED. Run by the owner in the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc, AFTER sql/156 is applied. Idempotent: safe to re-run.
--
-- WHY: until sql/156, wallet_holds_release() paid holds one row at a time and
-- timed out (statement_timeout 8s) for any player with tens of thousands of
-- small hold rows, rolling back every attempt. Those players' Cinder has sat in
-- wallet_holds ever since. See sql/156's header for the measurements.
--
-- WHO (measured read-only on live, 2026-09-18 03:50 UTC — the only open holds):
--
--   display name   user id    open hold rows   held Cinder   wallet today
--   ------------   --------   --------------   -----------   ------------
--   ClareyV        6b721987           35,688       315,908     13,773,946
--
--   Total: 1 player, 315,908 Cinder. Every other player's holds had already
--   released (8,851 hold rows / 3,514,102 Cinder across 4 players).
--   A rolled-back rehearsal of exactly this call as ClareyV released 315,908 in
--   622 ms into a wallet of 14,089,854; a second call released 0.
--
-- HOW: the SAME worker the players call (public._wallet_holds_release_for,
-- sql/156) — the same 4,500,000-per-24h room rule, oldest hold first, same
-- locks, same _ct_cinder_give credit. Nothing here computes an amount.
--
-- 🔴 NEVER TWICE. The worker only pays amount - released of an open hold and
--    raises `released` by exactly that in the same transaction, under a lock
--    on the player's wallet row and on the hold rows. Re-running this file
--    finds nothing open (or only what the room rule still holds back) and
--    pays 0 again. Nothing is minted: the paid total equals the growth in
--    wallet_holds.released.
-- ⚠ If a player's last-24h window is ALREADY full when this runs, the room rule
--   releases only what fits and the rest waits for the client's normal calls
--   (now that they work). The final SELECT shows anything still held.
--   ClareyV had 4,452,112 of room at measurement time — far more than 315,908.
-- ⚠ HELD-FIRST (sql/156 section 3): once 156 is applied, wallet_credit itself
--   runs this same worker before paying any new income, so ClareyV's first
--   credit after 156 may already release her backlog before this file runs.
--   That is fine: this file then finds nothing open for her, releases 0, and
--   the VERIFY below still shows her row (still_held 0, released_total up by
--   315,908 plus whatever she has been held since). Either path is the SAME
--   worker, so the backlog can never be paid twice.
-- ===========================================================================

do $backlog$
declare
  r   record;
  j   jsonb;
  tot bigint := 0;
begin
  if to_regprocedure('public._wallet_holds_release_for(uuid)') is null then
    raise exception 'sql/156 is not applied — apply it first (this file uses its worker)';
  end if;

  for r in
    select h.user_id, left(h.user_id::text, 8) as uid8, p.display_name,
           sum(h.amount - h.released) as held, count(*) as n
      from public.wallet_holds h
      left join public.user_profiles p on p.user_id = h.user_id
     where h.released < h.amount
     group by h.user_id, p.display_name
     order by min(h.created_at)
  loop
    j := public._wallet_holds_release_for(r.user_id);
    tot := tot + coalesce((j ->> 'released')::bigint, 0);
    raise notice '% (%): held % in % rows -> released %, still held %, wallet %',
      coalesce(r.display_name, '?'), r.uid8, r.held, r.n,
      j ->> 'released', j ->> 'held', j ->> 'cinder';
  end loop;
  raise notice 'backlog release total: %', tot;
end
$backlog$;

-- ===========================================================================
-- VERIFY — expect zero rows (nothing still held), or only players whose
-- 24-hour window is full right now (they drain on their next client call).
-- ===========================================================================
select left(h.user_id::text, 8) as uid8, p.display_name,
       count(*) filter (where h.released < h.amount) as open_rows,
       sum(h.amount - h.released)                    as still_held,
       sum(h.released)                               as released_total,
       (select cinder from public.user_progress up where up.user_id = h.user_id) as wallet
  from public.wallet_holds h
  left join public.user_profiles p on p.user_id = h.user_id
 group by h.user_id, p.display_name
having sum(h.amount - h.released) > 0
    or h.user_id = '6b721987-c16b-42c7-af03-c394323ebdec'   -- always show ClareyV
 order by still_held desc;


-- ─────────────── sql/158_camp_hire_server_price.sql ───────────────

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


-- ─────────────── sql/152_C_corp_close_withdraw.sql ───────────────

-- ===========================================================================
-- 152_C — CLOSING A CORPORATION: THE FOUNDER TAKES THE TREASURY HOME.
-- DRAFT — NOT APPLIED. Paste into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
--
-- Reported (bug-mu17gpcz): "A request for a button to withdraw any Cinder from
-- the Corporate Treasury to their Wallet when closing down a Corporation."
--
-- corp_dissolve (sql/130) refuses while the treasury holds anything ("pay it
-- out first"), and the only way out was corp_pay_member_from_treasury (sql/107)
-- — which pays a MEMBER, one typed amount at a time, and cannot pay the last
-- fraction of a numeric balance, so a treasury holding 12.4 could never reach
-- the zero corp_dissolve demands.
--
-- WHAT THIS DOES, IN ONE TRANSACTION:
--   · checks auth.uid() is corporations.founder_id — the founder ONLY, not a
--     CEO: this empties the whole treasury on the way out, which is the
--     founder's decision alone (corp_dissolve has the same rule);
--   · locks the corporation row FOR UPDATE, so a deposit, a wage run or a
--     second tab cannot interleave between the read and the debit (the same
--     lock sql/107 takes);
--   · balance = sum(corp_treasury.amount) — the ledger IS the balance;
--   · appends ONE negative row for the WHOLE balance (kind 'close_withdraw');
--   · credits the founder floor(balance) through _ct_cinder_give, the one
--     wallet primitive every other server credit uses.
--
-- 🔴 NOTHING IS MINTED. The wallet receives floor(balance) and the ledger is
--    debited the full numeric balance; the difference is the fractional dust
--    op_revenue leaves behind (< 1 Cinder), which is burned, never rounded UP.
--    Debiting only the floored figure would leave e.g. 0.4 behind and
--    corp_dissolve would refuse forever over less than one Cinder.
-- 🔴 APPEND-ONLY. One INSERT, no UPDATE, no DELETE. A balance of zero or less
--    writes nothing and returns withdrawn 0 — a negative treasury is not the
--    founder's to "withdraw", and a zero row would be noise in the audit.
--
-- WORKS WITH OR WITHOUT sql/146. 146 adds ct_client_write_guard, which polices
-- only the client roles ('authenticated', 'anon'); this function is SECURITY
-- DEFINER owned by postgres, so its insert is a server write under 146 and an
-- ordinary insert without it. It writes no ref_id (146 adds that column; this
-- file neither needs nor creates it).
--
-- THE CLIENT (index.html, corpDissolve handler): shows the amount in a
-- gcConfirm, calls this, adopts the returned wallet balance, then calls
-- corp_dissolve. A database without this function (PGRST202 / 42883) gets the
-- old instruction instead: pay the treasury out first.
--
-- RLS: no table, no policy change. corp_treasury keeps its policies (ct_sel for
-- members, ct_ins for the three client debit kinds); this function is the only
-- new writer and it is definer + founder-checked. Execute is granted to
-- authenticated only.
-- ===========================================================================

create or replace function public.corp_close_withdraw(p_corp_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_bal   numeric;
  v_give  bigint;
  v_w     jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_corp_id is null then raise exception 'no corporation given' using errcode = '22023'; end if;

  -- Founder only, and the lock in the same statement: nothing moves between
  -- "you are the founder" and the debit.
  select name into v_name from corporations
   where id = p_corp_id and founder_id = v_uid
   for update;
  if v_name is null then
    raise exception 'only the founder can withdraw the treasury of a corporation they are closing'
      using errcode = '42501';
  end if;

  select coalesce(sum(amount), 0) into v_bal from corp_treasury where corp_id = p_corp_id;
  if v_bal <= 0 then
    return jsonb_build_object('ok', true, 'withdrawn', 0, 'treasury_before', floor(v_bal),
                              'treasury_balance', floor(v_bal), 'name', v_name);
  end if;

  v_give := floor(v_bal)::bigint;

  insert into corp_treasury (corp_id, user_id, amount, kind, note)
  values (p_corp_id, v_uid, -v_bal, 'close_withdraw',
          'Closing withdrawal — ' || v_give || ' Cinder to the founder''s wallet');

  v_w := _ct_cinder_give(v_uid, v_give, 'Treasury withdrawn on closing ' || v_name);

  -- History, where the vault log exists and accepts the action (the same guard
  -- _ct_log uses: an older CHECK must not roll back a real withdrawal).
  begin
    insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id,
                                name, icon, qty, counterparty_id, counterparty_name)
    values (p_corp_id, v_uid, 'Founder', 'send', 'resource', 'cinder',
            'Cinder', '🔥', v_give, v_uid, 'founder (closing)');
  exception when undefined_table or undefined_column or check_violation or not_null_violation then null;
  end;

  return jsonb_build_object(
    'ok',               true,
    'name',             v_name,
    'withdrawn',        v_give,
    'treasury_before',  v_bal,
    'treasury_balance', 0,
    'balance',          (v_w->>'balance')::bigint
  );
end $$;

revoke all on function public.corp_close_withdraw(uuid) from public, anon;
grant execute on function public.corp_close_withdraw(uuid) to authenticated;

-- ===========================================================================
-- VERIFY (read-only)
select p.oid::regprocedure as fn, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'corp_close_withdraw';
-- expect: definer true, anon_can false, authed_can true.
--
-- ROLLED-BACK LIVE PROBE (nothing persists — the RAISE undoes everything):
--   do $$
--   declare corp uuid; founder uuid; r jsonb; bal numeric; w0 bigint;
--   begin
--     select c.id, c.founder_id into corp, founder from corporations c
--      where exists (select 1 from corp_treasury t where t.corp_id = c.id)
--      order by (select sum(amount) from corp_treasury t where t.corp_id = c.id) desc limit 1;
--     select coalesce(sum(amount),0) into bal from corp_treasury where corp_id = corp;
--     select cinder into w0 from user_progress where user_id = founder;
--     perform set_config('request.jwt.claims', json_build_object('sub', founder, 'role','authenticated')::text, true);
--     r := public.corp_close_withdraw(corp);
--     raise exception 'PROBE (rolled back): treasury % -> %, wallet % -> %, dissolve now: %',
--       bal, (select sum(amount) from corp_treasury where corp_id = corp), w0, r->>'balance',
--       public.corp_dissolve(corp);
--   end $$;
-- ===========================================================================


-- ─────────────── sql/155_C_rl_claim_sale_pay.sql ───────────────

-- ===========================================================================
-- 155_C — A LUNI SALE IS PAID BY THE SERVER, IN THE SAME TRANSACTION AS ITS CLAIM.
-- DRAFT — NOT APPLIED. Paste into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
--
-- Reported (bug-mtyn1mcn): "Luni payment bug: 2 lots of water @ 50k c each were
-- sold without payment. Total 100K c".
--
-- WHAT THE DATA SAYS (read-only, 2026-09-17): the seller (Mavric) listed 5 lots
-- of 100 water at 50,000 (resource_listings 21609071…). THREE sold and all three
-- were paid (resource_trade_ledger 2105 / 2167 / 2189, each with a seller claim
-- and a wallet_ledger 'credit' of 50,000, "Resource exchange sale"). The other
-- TWO did not sell: ledger 2386 kind 'expire', 200 units, claimed 2026-09-12
-- 02:47 UTC — and the client live that day announced a returned expiry under
-- "💰 Exchange collected: 200 💧 back", a money headline over goods that came
-- home. He re-listed those 200 water at 16:57 (listing e35a563d…) and reported
-- at 17:07. The headline was split later (_resEntryNotice, "Did not sell").
--
-- THE STRUCTURAL HOLE THIS CLOSES. A seller is paid by THEIR OWN CLIENT, later:
-- rl_claim spends the one-time claim, THEN the client credits itself through
-- wallet_credit(p_amount). wallet_credit may REFUSE (single > 2,000,000; hourly
-- > 10,000,000) or HOLD (daily > 4,500,000) and still returns a balance, not an
-- error — so the client books the Cinder locally, the claim is gone, and the
-- next wallet refresh adopts the server's lower balance. That is exactly "sold
-- without payment", and nothing could ever re-offer the row.
--
-- rl_claim_sale_pay(p_ledger_id) pays a CINDER SALE from the row the server
-- itself wrote (rl_take_lots set price_total from the listing): it claims and
-- credits in ONE transaction through _ct_cinder_give, so a claim can never be
-- spent without the credit, and a credit can never land twice (the claim's
-- primary key (ledger_id, party) is the idempotence key).
--
-- 🔴 NOTHING NEW IS MINTED. The seller was already credited price_total by the
--    client path this replaces; this moves the same credit server-side. The
--    Foundation tax is 0 today (index.html FR_TAX_RATE = 0) and so is not taken
--    here — if the tax is ever turned back on, it must be taken HERE, and that
--    is an owner decision.
-- ⚠ Only kind 'sale', currency 'cinders', seller = auth.uid(), not voided.
--   Aza / trade / barter rows, expiries, cancels and clawbacks keep the
--   existing rl_claim + client-leg path.
-- RLS: no table or policy change. resource_trade_claims keeps its policies;
-- this definer function is the only new writer. Execute: authenticated only.
-- ===========================================================================

create or replace function public.rl_claim_sale_pay(p_ledger_id bigint)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  e      public.resource_trade_ledger%rowtype;
  v_got  bigint;
  v_amt  bigint;
  v_w    jsonb;
begin
  if me is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;

  select * into e from public.resource_trade_ledger where id = p_ledger_id for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'no such trade'); end if;
  if e.seller_id is distinct from me then raise exception 'not your sale' using errcode = '42501'; end if;
  if e.kind <> 'sale' or coalesce(e.currency, 'cinders') <> 'cinders' or e.voided_at is not null then
    return jsonb_build_object('ok', false, 'why', 'not a cinder sale', 'fallback', true);
  end if;

  insert into public.resource_trade_claims (ledger_id, party, claimed_by)
  values (e.id, 'seller', me)
  on conflict (ledger_id, party) do nothing
  returning ledger_id into v_got;
  if v_got is null then
    return jsonb_build_object('ok', true, 'claimed', false, 'paid', 0);
  end if;

  v_amt := greatest(0, coalesce(e.price_total, 0))::bigint;
  v_w := _ct_cinder_give(me, v_amt, 'Resource exchange sale #' || e.id);

  return jsonb_build_object('ok', true, 'claimed', true, 'paid', v_amt,
                            'balance', (v_w->>'balance')::bigint, 'ledger_id', e.id);
end $$;

revoke all on function public.rl_claim_sale_pay(bigint) from public, anon;
grant execute on function public.rl_claim_sale_pay(bigint) to authenticated;

-- ===========================================================================
-- VERIFY (read-only)
select p.oid::regprocedure as fn, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rl_claim_sale_pay';
-- expect: definer true, anon_can false, authed_can true.
-- ===========================================================================


-- ─────────────── sql/153_B_city_set_mayor_writes_contract.sql ───────────────

-- ════════════════════════════════════════════════════════════════════════════
-- 153_B · AN IN-CITY "APPOINT NODE MANAGER" WRITES THE CONTRACT THE MANAGER USES
--         DRAFT — NOT APPLIED. Needs the owner's yes (see DECISION below).
--         Idempotent: CREATE OR REPLACE of the sql/148 function, same signature,
--         same grants. Re-runnable. Ends with a verify SELECT.
--
-- REPORTS: bug-mtyo8e66 "When Davos tries to add me to his Aritzal Ascension city
--          as the mayor, he gets the attached error", bug-mtyd8sio "Davos has
--          registered/claimed two new nodes — I am supposed to be mayoring them
--          all, but I can't see them in the Client City list".
--
-- WHAT THE ERROR WAS: the pre-148 city_set_mayor upserted city_state
--   ON CONFLICT (user_id) on a table keyed (user_id, node_id) and raised on every
--   call. sql/148 (applied 2026-09-17) replaced it, so that error is gone.
--
-- WHAT 148 STILL DOES WRONG — MEASURED 2026-09-17 in a rolled-back probe on the
-- live function, as Davos (owner of N-26, where the reporter ALREADY holds the
-- active node_mayors contract):
--     city_set_mayor(<reporter>, 'probe', 500, 'probe', 'N-26')
--       → {"ok": true, "paid": 500}      (500 Cinder taken, a pay row written)
--     node_mayors active rows for the reporter: before 6, after 6
--     city_state: N-26.mayor_id = <reporter>
--   i.e. the in-city appointment charges the owner and writes ONLY
--   city_state.mayor_id — a column nothing reads any more (cityMayorGet, the
--   Client City list, _twIAmMayorOf, _openNodeCity's admission and
--   city_state_can_write all read node_mayors). The appointee never sees the
--   city, and re-appointing the manager who already holds the contract is not
--   refused because 148's "already appointed" test reads that same dead column.
--   Live: 0 city_state rows carry a mayor_id; every one of the 21 active seats
--   came through the Mayor Hall (mayor_accept_offer).
--
-- THE CHANGE (paid hire only; the Remove branch and the unpaid path are 148's):
--   · the caller must OWN the node in tw_node_owners — the same test
--     mayor_accept_offer makes. node_mayors is keyed on node_id alone, so a city
--     on a node the caller does not own must never write that node's contract.
--   · an ACTIVE contract on the node is read first:
--       same manager      → 'that Node Manager is already appointed' (nothing paid)
--       another manager   → 'this node already has a Node Manager under contract'
--                           (a Mayor Hall contract's negotiated terms are never
--                           overwritten by a flat in-city fee)
--   · after the escrow (unchanged) it upserts node_mayors for the node with the
--     table's DEFAULT terms (30 % / CINDER / 20 h / owner / owner), active, and
--     answers `contract: true`. The client (cityMayorSet) reads that flag and
--     tells the owner the city is now in the manager's Client City list; without
--     it, the owner is told the appointment reaches nobody until a Hall offer.
--
-- DECISION FOR THE OWNER: should an in-city appointment create a Node Manager
--   contract at default terms (this file), or should the in-city Appoint button
--   be removed so every hire goes through the Mayor Hall negotiation? Until one
--   of the two ships, the in-city appointment takes 500 Cinder for a seat nobody
--   can use (the client now refuses the "same manager" and "already under
--   contract" cases before paying, and says so after paying).
--
-- RLS: no new table and no policy change. node_mayors keeps its single
--   `node_mayors_read` (select, true) policy and no write policy; this function
--   is SECURITY DEFINER and is the write path, exactly like mayor_accept_offer.
--   city_mayor_pay's policies/grants are 148's and are untouched.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.city_set_mayor(p_mayor_id uuid, p_mayor_name text,
                                                 p_pay integer default 0, p_from text default null,
                                                 p_node_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_amt   bigint := least(100000, greatest(0, coalesce(p_pay, 0)));
  v_paid  boolean;
  v_found boolean;
  v_prev  uuid;
  v_cur   uuid;
  v_take  jsonb;
  v_id    uuid;
  v_n     int;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  v_paid := p_mayor_id is not null and v_amt > 0;

  if v_paid then
    if p_mayor_id = v_uid then raise exception 'you cannot hire yourself'; end if;
    if not exists (select 1 from auth.users u where u.id = p_mayor_id) then
      raise exception 'no such player';
    end if;
    if p_node_id is null then raise exception 'which city? a paid hire must name the node'; end if;
    select true, c.mayor_id into v_found, v_prev
      from public.city_state c
     where c.user_id = v_uid and c.node_id = p_node_id
       for update;
    if not coalesce(v_found, false) then raise exception 'you have no city on that node to hire for'; end if;
    -- 153_B: a contract is the NODE's, so only the node's owner writes one.
    if not exists (select 1 from public.tw_node_owners w
                    where w.node_id = p_node_id and w.user_id = v_uid) then
      raise exception 'you do not own that node — only its owner can appoint its Node Manager';
    end if;
    -- 153_B: the seat that counts is node_mayors, not city_state.mayor_id.
    select m.mayor_id into v_cur
      from public.node_mayors m
     where m.node_id = p_node_id and m.active
       for update;
    if v_cur is not null and v_cur = p_mayor_id then
      raise exception 'that Node Manager is already appointed';
    end if;
    if v_cur is not null then
      raise exception 'this node already has a Node Manager under contract — end that contract first';
    end if;
    if v_prev is not distinct from p_mayor_id then
      raise exception 'that Node Manager is already appointed';
    end if;
  end if;

  update public.city_state c
     set mayor_id = p_mayor_id, mayor_name = left(p_mayor_name, 60), updated_at = now()
   where c.user_id = v_uid and (p_node_id is null or c.node_id = p_node_id);
  get diagnostics v_n = row_count;

  if not v_paid then
    return jsonb_build_object('ok', true, 'paid', 0, 'cities', v_n);
  end if;

  v_take := public._ct_cinder_take(v_uid, v_amt, 'Node Manager hiring pay (escrow)');

  insert into public.city_mayor_pay (user_id, amount, from_name, funded)
  values (p_mayor_id, v_amt, left(coalesce(p_from, ''), 60), true)
  returning id into v_id;

  -- 153_B: the contract. Omitted columns take the table defaults, and the
  -- conflict branch copies those same defaults from `excluded` — an ended
  -- (inactive) row for this node is re-opened with default terms, never with
  -- the terms somebody negotiated for a previous manager.
  insert into public.node_mayors (node_id, mayor_id, owner_id, offer_id, active, started_at, ended_at)
  values (p_node_id, p_mayor_id, v_uid, null, true, now(), null)
  on conflict (node_id) do update
    set mayor_id = excluded.mayor_id, owner_id = excluded.owner_id, offer_id = null,
        player_pct = excluded.player_pct, currency = excluded.currency,
        hours_per_month = excluded.hours_per_month, card_policy = excluded.card_policy,
        resource_policy = excluded.resource_policy, active = true,
        started_at = now(), ended_at = null
    where not public.node_mayors.active;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    -- An active contract appeared between the check and here: undo everything.
    raise exception 'this node already has a Node Manager under contract — end that contract first';
  end if;

  return jsonb_build_object('ok', true, 'paid', v_amt, 'pay_id', v_id, 'contract', true,
                            'cinder', (v_take->>'balance')::bigint,
                            'wallet_seq', (v_take->>'wallet_seq')::bigint);
end $$;

revoke all on function public.city_set_mayor(uuid, text, integer, text, text) from public, anon;
grant execute on function public.city_set_mayor(uuid, text, integer, text, text) to authenticated;

commit;

-- --- VERIFY. Expect: fn_writes_contract_t = t, fn_checks_tw_owner_t = t,
--     anon_exec_f = f, auth_exec_t = t, node_mayors_rls_t = t,
--     node_mayors_write_policies_expect_0 = 0, client_can_insert_node_mayors_f = f.
select
  (select position('insert into public.node_mayors' in pg_get_functiondef('public.city_set_mayor(uuid,text,integer,text,text)'::regprocedure)) > 0)
                                                                                           as fn_writes_contract_t,
  (select position('tw_node_owners' in pg_get_functiondef('public.city_set_mayor(uuid,text,integer,text,text)'::regprocedure)) > 0)
                                                                                           as fn_checks_tw_owner_t,
  has_function_privilege('anon', 'public.city_set_mayor(uuid,text,integer,text,text)', 'EXECUTE')          as anon_exec_f,
  has_function_privilege('authenticated', 'public.city_set_mayor(uuid,text,integer,text,text)', 'EXECUTE') as auth_exec_t,
  (select relrowsecurity from pg_class where oid = 'public.node_mayors'::regclass)          as node_mayors_rls_t,
  (select count(*) from pg_policies where tablename = 'node_mayors' and cmd <> 'SELECT')    as node_mayors_write_policies_expect_0,
  has_table_privilege('authenticated', 'public.node_mayors', 'INSERT')
    and exists (select 1 from pg_policies where tablename = 'node_mayors' and cmd in ('INSERT','ALL'))
                                                                                           as client_can_insert_node_mayors_f;


-- ─────────────── 9 · WELCOME2026 redemption records (after 159) ───────────────
-- So none of the 9 redeemers can claim WELCOME2026 again if it is switched on.
insert into public.aza_grant_claims (user_id, kind, claim_key, aza, meta)
select u, 'coupon', 'WELCOME2026', 15, jsonb_build_object('source', 'repair 2026-09-18')
  from unnest(array[
    '29e5da8b-ac64-412a-9bd4-c348e61c55c9', 'b46f7086-94ac-4ecc-b4b0-24d32ec0c7a0',
    '40c677ff-9eb3-4fa5-87ea-413cc3162ae2', 'd41b1b6f-ca04-4beb-b224-36f15c5feb64',
    '2feefce7-d155-47b8-8a10-3cbfb3a0b812', 'f9eff35e-29d1-47d0-9c99-346c2478cd6a',
    '1cf61751-32b2-4930-8292-a05f23c1feb6', '31ce4c00-fc3b-42ed-abac-403b34edc5bd',
    '281f9cba-b318-43e3-9466-d746281824a3']::uuid[]) as u
on conflict (user_id, kind, claim_key) do nothing;

select count(*) as welcome2026_claims_recorded from public.aza_grant_claims where kind = 'coupon' and claim_key = 'WELCOME2026';
