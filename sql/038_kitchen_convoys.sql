-- ============================================================================
-- 038_kitchen_convoys.sql
-- 🍔 MYTHIC KITCHEN — player-to-player food convoys.
-- Idempotent. Re-runnable. RLS ships in this file. Ends with a verify query.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc
-- (there is no CLI login in this repo). Nothing in the client requires this to
-- have been applied: /src/kitchen/kitchen.api.js detects a missing table or a
-- missing function (PGRST205 / PGRST202) and reports `missing:true`, and the
-- convoy panel then says "the convoy network is not set up yet" while local
-- practice runs keep working. Applying this is an UPGRADE, never a gate.
--
-- 🔴 IF YOU APPLIED AN EARLIER COPY OF THIS FILE, RE-RUN IT. Round 1's version
--    shipped a claim RPC that could pay twice (see §4) and a client INSERT path
--    that let the device clock decide when a truck landed (see §5). Both are
--    fixed by re-running: the file drops and recreates what it has to, revokes
--    what it must, and the verify block at the bottom names either defect
--    explicitly if it is still present.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--  1. kitchen_convoys         one row per truck. Written ONLY by the launch
--                             RPC, flipped ONLY by the claim RPC. The client
--                             has no INSERT, UPDATE or DELETE on it at all.
--  2. kitchen_convoy_ledger   append-only movement log. Balance = sum(amount).
--                             No balance column. No write policy. Ever.
--  3. kitchen_stats           cosmetic leaderboard. NEVER an economy source.
--  4. kitchen_convoy_launch() the ONE way a convoy is created. Computes
--                             arrives_at on the SERVER clock.
--  5. kitchen_convoy_claim()  the ONE way a convoy is claimed. SECURITY
--                             DEFINER, atomic, and — new in this revision —
--                             it REPORTS whether this call was the first, so a
--                             replayed request cannot be paid twice.
--  6. kitchen_stats_upsert()  the ONE way a scoreboard row is written.
--  7. kitchen_convoy_tiers    the truck table, ON THE SERVER. New in round 3 and
--                             it is the fix for the unpriced faucet: the launch
--                             RPC used to take the box count and the transit
--                             time from the client and clamp them GLOBALLY
--                             (1..500 boxes, 10min..12h) even though the tier
--                             was sitting right there in p_tier.
--
-- ── 🔴 WHAT THE ECONOMY IS TRUSTING THIS FILE WITH ─────────────────────────
-- A claimed convoy turns into units of the LIVE resource `food` in the
-- recipient's stash. `food` prices the Gene Vault, the Bottling Line, crafting
-- and the resource market, so a convoy that pays out more than it consumed is
-- not a balance problem, it is the end of the resource economy. SIX walls, and
-- every one of them is deliberate:
--   1. ECON.CONVOY_FOOD_PER_DISH (client) is tuned BELOW the `food` embodied in
--      the cheapest dish that can ride. Shipping is a LOSS for the pair.
--   2. `dishes` is clamped by the launch RPC and by a CHECK constraint here — a
--      tampered client cannot post a thousand-box truck.
--   3. kitchen_convoy_quota_ok() rate limits how many convoys one account can
--      launch, so two colluding accounts cannot run a fast loop.
--   4. to_user <> from_user is enforced below, so the trivial "ship to myself"
--      loop cannot exist on the server at all. (Practice runs to your own city
--      are a purely LOCAL client thing and never reach this table.)
--   5. TRANSIT IS COMPUTED HERE, from now(). The client posts a duration, not a
--      timestamp. A fast device clock buys nothing.
--   6. THE CLAIM RPC RETURNS `delivered_dishes`, which is 0 on a replay, and
--      the client is only allowed to pay on that number. This is the wall that
--      was missing in round 1.
--
-- ── 🔴 THE ROUND-2 HOLE, AND WHY SIX WALLS WERE STILL NOT ENOUGH ───────────
-- Every one of those six walls was real and every one of them was reviewed, and
-- the feature still shipped a faucet, because wall 1 — the only wall that makes
-- shipping net-NEGATIVE — lives in kitchen.data.js and is therefore enforced by
-- the honest client only. Walls 2..6 constrain the SHAPE of a launch; not one of
-- them constrains its SIZE against anything the sender actually did. Proven on a
-- real PostgreSQL 16: as plain `authenticated`,
--     kitchen_convoy_launch(B,'B','A','rig','{}',500,1)
-- succeeded ten times in one transaction — 5,000 boxes, zero cooking, every
-- truck landing in ten minutes. `rig` is 120 boxes over six hours in
-- CONVOY_TIERS. The server took 500 boxes over ten minutes because it never
-- looked at p_tier for anything but the text it stored. With the hourly cap that
-- is 10,000 units of live `food` per hour into a colluding account, ~500× the
-- legitimate rate with the sign flipped — and it is WORSE than a raw edit of the
-- player's save, because the convoy path LAUNDERS it: kitchen_convoy_ledger is
-- the append-only record this feature offers as evidence, so an audit reading it
-- sees a delivered convoy vouching for the balance.
--
-- THREE MORE WALLS, ALL SERVER-SIDE, ALL IN THIS FILE:
--   7. TIER-TRUE CLAMPS. kitchen_convoy_tiers holds capacity and transit per
--      truck and the launch RPC clamps to the row it looks up, not to a global
--      constant. A rig is 120 boxes over six hours because the DATABASE says so.
--   8. THE THROUGHPUT BUDGET — the production link. A kitchen is a physical
--      thing with a maximum output rate, so `sum(dishes)` launched in the last
--      hour is bounded by what a kitchen could actually have COOKED in an hour.
--      This is the wall the critic asked for: a server-side link between what a
--      sender shipped and what they could have produced.
--   9. THE LIFETIME BUDGET. The same statement over the account's whole life,
--      against auth.users.created_at, so a fresh mule account cannot open with a
--      burst it had no time to cook.
--
-- ── 🔴 THE ROUND-3 HOLE: NINE WALLS THAT ALL FAILED IN THE SAME INSTANT ────
-- Walls 1..9 were reviewed, applied to a real database, and attacked one call
-- at a time, and they held: a brand-new account launching SEQUENTIALLY got one
-- truck and 120 boxes and was refused nine times. Then the same account launched
-- SIXTY TIMES IN PARALLEL and got 22 trucks and 2,640 boxes (47 / 5,640 on the
-- reviewer's hardware). Nothing was bypassed. Every wall was consulted and every
-- wall said yes, because kitchen_convoy_quota_ok() is four SELECT counts and at
-- READ COMMITTED sixty concurrent transactions all count the world as it was
-- before any of them wrote. A rule enforced by reading is not enforced.
--
--  10. THE SERIALISER. `pg_advisory_xact_lock` keyed on the SENDER, taken at the
--      top of the launch RPC, so one account's concurrent launches queue and the
--      counts in walls 1..4 are finally taken against a world that includes the
--      trucks that just left. Same account, same sixty parallel calls, with the
--      lock: 1 truck / 120 boxes — identical to sequential. See the block in
--      kitchen_convoy_launch(), and the verify check that fails if it is removed.
--
-- ── ⚠ RLS RECURSION ────────────────────────────────────────────────────────
-- A policy on a table that itself queries that table can re-enter RLS and
-- recurse. Everything below that needs to ask a question ABOUT kitchen_convoys
-- from inside a policy goes through a SECURITY DEFINER helper, which bypasses
-- RLS and therefore terminates — the same shape sql/001_community_core.sql uses
-- for is_community_member(). Do not inline those EXISTS clauses back into the
-- policies, however tidy it looks in the diff.
--
-- 🔴 RLS IS THE ENTIRE SECURITY BOUNDARY. Every policy below carries a comment
-- saying WHAT IT LETS IN and WHAT IT KEEPS OUT. A missing `using (auth.uid() =
-- …)` is a data breach and looks completely fine in review.
--
-- ⚠ GRANTS ARE THE OTHER HALF, AND THE `PUBLIC` PSEUDO-ROLE IS THE TRAP.
-- `revoke … from anon, authenticated` does NOT remove a privilege held by
-- PUBLIC, and every login role inherits PUBLIC. Round 1's verify block only
-- looked at grantee = 'authenticated', so a PUBLIC grant on the append-only
-- ledger would have printed 'ok'. Every revoke below names `public` explicitly
-- and the verify block reads pg_class.relacl through aclexplode(), which is the
-- only view of grants that shows PUBLIC at all.
-- ============================================================================

begin;

-- ─── 1. TABLES ─────────────────────────────────────────────────────────────

-- One truck. Written once by kitchen_convoy_launch(), flipped once by
-- kitchen_convoy_claim(). No client ever writes it directly.
create table if not exists public.kitchen_convoys (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references auth.users(id) on delete cascade,
  to_user     uuid not null references auth.users(id) on delete cascade,
  from_name   text,
  to_name     text,
  tier        text,                       -- CONVOY_TIERS id: van | truck | rig
  -- {recipeId: qty}. Display only: the payout is derived from `dishes`, never
  -- from this, because the sender's client wrote it.
  items       jsonb not null default '{}'::jsonb,
  dishes      int  not null,
  launched_at timestamptz not null default now(),
  arrives_at  timestamptz not null,
  state       text not null default 'transit',
  claimed_at  timestamptz,
  -- ── THE ROAD (round 3) ───────────────────────────────────────────────────
  -- 🔴 THE HOLD-UP IS ROLLED HERE, ON THE SERVER, AND IT IS ALREADY BAKED INTO
  --    `arrives_at`. It is NOT a second number the client adds on top.
  --    WHY the server and not convoy.js: a convoy crossing a ruined city has to
  --    be able to go wrong or the road is a progress bar with scenery on it, and
  --    round 2's review said exactly that. But the client cannot own the
  --    outcome — it would reload until it rolled a clean run, and worse, it
  --    would DISAGREE with `arrives_at`, which is the one timestamp the claim
  --    RPC enforces. So the server rolls it once, adds it to the transit it was
  --    going to charge anyway, and STORES what it rolled so the client can draw
  --    the story it is already living through.
  --    ⚠ IT COSTS TIME AND NEVER BOXES. Spoilage — losing part of the load — is
  --      a separate, client-side, ECON-armed model (see convoy.js §3), and it is
  --      deliberately OFF: a convoy MOVES value between two players, and
  --      destroying part of a transfer reads to both of them as the game eating
  --      their food. A delay costs the sender nothing they can count and still
  --      makes the road an event.
  delay_ms    int not null default 0,      -- 0 = a clean run
  delay_leg   int not null default 0,      -- 1-based leg it happened on; 0 = none
  -- ── 🔴 THE IDEMPOTENCY KEY (round 5). THE ANSWER TO "DID MY INSERT LAND?" ──
  --    A client-generated uuid, unique per (from_user, client_ref). It exists
  --    because of a defect that needs no attacker at all:
  --
  --      The sender's client calls the launch RPC. The RPC commits the row. The
  --      REPLY IS LOST — a dropped mobile connection, a suspended tab, a TLS
  --      reset, a 502 from the gateway. The client cannot tell that apart from
  --      "the server never got it", so round 4's client did the only thing it
  --      could think of and turned the truck back into a local practice run
  --      that the SENDER unloads. The server row was still on the road to the
  --      recipient. Forty dishes left the pass once and EIGHTY units of live
  --      `food` were created — an effective 2.0 food per dish, straight through
  --      the wall the header of this file calls the most dangerous number in
  --      the feature.
  --
  --    🔴 THE CLIENT CANNOT ANSWER THE QUESTION, SO THE SERVER HAS TO MAKE IT
  --       ANSWERABLE. With a client_ref the retry is free of consequence:
  --       kitchen_convoy_launch() looks the ref up first and RETURNS THE ROW IT
  --       ALREADY WROTE instead of writing a second one, and the client can ask
  --       "is my ref up there?" on the next heartbeat and get a yes/no it can
  --       act on. Nothing is paid out until that answer arrives.
  --
  --    ⚠ THE RECIPIENT CAN READ IT (kc_sel returns the whole row to both
  --      parties) AND THAT IS HARMLESS. The idempotency lookup is scoped
  --      `from_user = me`, so a ref only ever identifies a convoy for the
  --      account that sent it; a recipient replaying somebody else's ref gets a
  --      brand-new truck of their own, which is what any other uuid would have
  --      done. Measured on a live database. kitchen.api.js still keeps it off
  --      the INBOUND select — no reason to hand out a key nobody can use.
  --    ⚠ NULLABLE, and the unique index below is PARTIAL. Rows written before
  --      this migration have no ref, and two of them must not collide with each
  --      other on a NULL. A caller that omits the ref simply gets no
  --      idempotency — which is round 4's behaviour, i.e. the bug — so the
  --      client always sends one and the verify block asserts the parameter
  --      exists.
  client_ref  uuid
);

-- Re-runnable against an earlier shape.
alter table public.kitchen_convoys add column if not exists from_name  text;
alter table public.kitchen_convoys add column if not exists to_name    text;
alter table public.kitchen_convoys add column if not exists tier       text;
alter table public.kitchen_convoys add column if not exists claimed_at timestamptz;
alter table public.kitchen_convoys add column if not exists delay_ms   int not null default 0;
alter table public.kitchen_convoys add column if not exists delay_leg  int not null default 0;
alter table public.kitchen_convoys add column if not exists client_ref uuid;

-- Constraints added by name so a re-run does not duplicate them.
-- 🔴 `dishes` ceiling: the biggest truck in CONVOY_TIERS is 120 boxes and the
--    warehouse upgrade multiplies it by 1.5 → 180. 500 is deliberately loose so
--    a client-side retune never starts failing launches, and deliberately
--    finite so a tampered client cannot post a number that matters.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kitchen_convoys_dishes_chk') then
    alter table public.kitchen_convoys
      add constraint kitchen_convoys_dishes_chk check (dishes >= 1 and dishes <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kitchen_convoys_state_chk') then
    alter table public.kitchen_convoys
      add constraint kitchen_convoys_state_chk check (state in ('transit','arrived','claimed'));
  end if;
  -- A truck cannot arrive before it left. Belt and braces now that the launch
  -- RPC computes both timestamps from the same now() — but it stays, because a
  -- constraint that is currently unreachable is exactly the constraint that
  -- catches the next person who adds a second write path.
  if not exists (select 1 from pg_constraint where conname = 'kitchen_convoys_time_chk') then
    alter table public.kitchen_convoys
      add constraint kitchen_convoys_time_chk check (arrives_at > launched_at);
  end if;
  -- Shipping to yourself is a LOCAL practice run in the client and must never
  -- reach the network: a self-addressed row would give one truck two claim
  -- paths (local grant + RPC) and one of them would pay twice.
  if not exists (select 1 from pg_constraint where conname = 'kitchen_convoys_party_chk') then
    alter table public.kitchen_convoys
      add constraint kitchen_convoys_party_chk check (to_user <> from_user);
  end if;
end $$;

create index if not exists kitchen_convoys_to_idx
  on public.kitchen_convoys (to_user, state, arrives_at);
create index if not exists kitchen_convoys_from_idx
  on public.kitchen_convoys (from_user, launched_at desc);

-- 🔴 THE GHOST-CONVOY LOCK. One truck per (sender, client_ref), enforced by the
--    database and not by a check the launch RPC could be edited around.
--    kitchen_convoy_launch() looks the ref up under its advisory lock and
--    returns the existing row, so this index should never actually fire — and
--    it stays because "should never fire" is exactly the guarantee that stops
--    being true the next time somebody adds a second write path. A duplicate
--    launch then fails loudly instead of putting a second truck on the road.
-- ⚠ PARTIAL. Pre-migration rows carry client_ref = null and two nulls are not
--   equal under a unique index anyway; `where client_ref is not null` makes that
--   explicit rather than incidental, and keeps the index off every legacy row.
-- ⚠ It is ALSO the client's reconcile key: kitchen.api.js asks
--   `select … where client_ref in (…)` to settle a launch whose reply was lost,
--   and this index is what makes that lookup an index scan rather than a seq
--   scan of every convoy the sender has ever posted.
create unique index if not exists kitchen_convoys_client_ref_once
  on public.kitchen_convoys (from_user, client_ref)
  where client_ref is not null;


-- APPEND-ONLY. One row per settled movement.
-- 🔴 Balance = sum(amount). There is no balance column and there never will be
--    (CLAUDE.md, corp_treasury). Nothing here is ever UPDATEd: what happened is
--    a fact, and a fact does not get edited.
-- ⚠ `amount` counts DISHES, not food, and it is SIGNED. A 'launch' row is
--    -dishes (the boxes left the sender's kitchen) and a 'claim' row is +dishes
--    (they landed), so sum(amount) over one convoy is -dishes while it is on
--    the road and 0 once it is delivered. The server records the movement it
--    can actually verify and leaves the food conversion to ECON: it does not
--    know CONVOY_FOOD_PER_DISH and it must not, because a copy of that constant
--    in SQL would be a second source of truth for the most dangerous number in
--    the feature.
create table if not exists public.kitchen_convoy_ledger (
  id         bigint generated always as identity primary key,
  -- Deliberately NOT a foreign key: deleting a convoy must never erase the
  -- history of what it moved.
  convoy_id  uuid not null,
  kind       text not null,
  from_user  uuid not null,
  to_user    uuid not null,
  resource   text not null default 'dish',
  amount     int  not null,               -- signed; see the note above
  dishes     int  not null default 0,
  note       text,
  created_at timestamptz not null default now()
);

do $$
begin
  -- 'spoil' is reserved so a future server-side loss model needs no migration.
  -- 'launch' and 'claim' are both written today.
  if not exists (select 1 from pg_constraint where conname = 'kitchen_convoy_ledger_kind_chk') then
    alter table public.kitchen_convoy_ledger
      add constraint kitchen_convoy_ledger_kind_chk check (kind in ('launch','claim','spoil'));
  end if;
end $$;

-- 🔴 THE DOUBLE-CLAIM LOCK, and it is the whole of it. One row per (convoy,
--    kind), enforced by the database rather than by a state check a replayed
--    request could race. kitchen_convoy_claim() inserts `on conflict do
--    nothing` against this index and then reads ROW_COUNT — which is how it
--    knows whether THIS call was the one that delivered. Two tabs, a retried
--    fetch and a duplicated request all end with exactly one 'claim' row and
--    exactly one caller told `first_claim = true`.
create unique index if not exists kitchen_convoy_ledger_once
  on public.kitchen_convoy_ledger (convoy_id, kind);
create index if not exists kitchen_convoy_ledger_to_idx
  on public.kitchen_convoy_ledger (to_user, created_at desc);


-- Cosmetic scoreboard. 🔴 EVERY NUMBER IN HERE IS WRITTEN BY THE PLAYER'S OWN
-- CLIENT. It is a wall to put a name on. It is not a ledger, it is not
-- evidence, and nothing anywhere may read it back and grant anything.
create table if not exists public.kitchen_stats (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text,
  level      int not null default 1,
  served     bigint not null default 0,
  days       int not null default 0,
  popularity int not null default 50,
  updated_at timestamptz not null default now()
);
create index if not exists kitchen_stats_served_idx on public.kitchen_stats (served desc);


-- ============================================================================
-- 🔴 THE TRUCK TABLE. The round-3 fix for the unpriced faucet.
-- ============================================================================
-- Round 2's launch RPC accepted `p_tier` and STORED it and never once used it to
-- bound anything. The clamps were global — `least(greatest(p_dishes,1),500)` and
-- a 10-minute floor on transit — so a client that said 'rig' got a rig's NAME
-- and 500 boxes at ten minutes, when a rig is 120 boxes over six hours. The tier
-- was right there in the argument list. It is used now.
--
-- 🔴 THESE ROWS MIRROR `CONVOY_TIERS` IN public/src/kitchen/kitchen.data.js.
--    THEY ARE NOT A SECOND SOURCE OF TRUTH — the client draws the truck, quotes
--    the freight and gates the level off ITS table; this one exists so a
--    tampered client cannot post a number the real table never offered. If you
--    retune CONVOY_TIERS, RE-RUN THIS FILE. The verify block at the bottom
--    prints the seeded numbers so a drift is visible on every apply.
--
-- ⚠ WHY `on conflict do update` AND NOT `do nothing`. A hand-edit made in the
--   SQL editor to "just try something" would otherwise survive every future
--   apply of this file and silently outrank kitchen.data.js forever. The file is
--   the source of truth; the table is a cache of it.
--
-- ⚠ NO RLS POLICY AND NO CLIENT GRANT, DELIBERATELY. Nothing in the browser
--   reads this — the client already has CONVOY_TIERS. Only the SECURITY DEFINER
--   launch RPC reads it, and definer bypasses RLS. RLS is still enabled below so
--   that a future grant added by mistake still matches zero rows.
create table if not exists public.kitchen_convoy_tiers (
  id            text primary key,
  name          text not null,
  capacity      int  not null,      -- 🔴 the real box ceiling for this truck
  transit_ms    bigint not null,    -- 🔴 the real time on the road
  min_level     int  not null default 1,
  -- The road, per tier. A longer haul crosses more of the ruin, so it is likelier
  -- to be held up; the hold is a fraction of the trip, so the long haul's
  -- fraction is smaller and the absolute delay still grows.
  risk_pct      numeric not null default 0,
  delay_max_pct numeric not null default 0
);

insert into public.kitchen_convoy_tiers
  (id, name, capacity, transit_ms, min_level, risk_pct, delay_max_pct)
values
  ('van',   'Delivery Van', 12,    1200000, 1,  0.22, 0.25),   -- 20 min
  ('truck', 'Box Truck',    40,    7200000, 12, 0.28, 0.20),   -- 2 h
  ('rig',   'Road Train',   120,  21600000, 20, 0.34, 0.15)    -- 6 h
on conflict (id) do update
  set name          = excluded.name,
      capacity      = excluded.capacity,
      transit_ms    = excluded.transit_ms,
      min_level     = excluded.min_level,
      risk_pct      = excluded.risk_pct,
      delay_max_pct = excluded.delay_max_pct;


-- ─── 2. SECURITY DEFINER HELPERS (the anti-recursion layer) ────────────────

-- "Am I one of the two parties to this convoy?"
-- ⚠ SECURITY DEFINER because a policy that asks this question by selecting
--   kitchen_convoys re-enters RLS. Definer bypasses RLS and therefore
--   terminates. STABLE so a policy can call it once per row.
create or replace function public.is_convoy_party(p_convoy uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.kitchen_convoys c
     where c.id = p_convoy
       and (c.from_user = auth.uid() or c.to_user = auth.uid())
  );
$$;

-- ============================================================================
-- 🔴 THE THROTTLE. Four walls, and the last two are the production link.
-- ============================================================================
-- 🔴 THIS IS THE RECURSION TRAP IN PERSON: it counts kitchen_convoys and it is
--    called from code that writes kitchen_convoys. As SECURITY DEFINER it
--    bypasses RLS and terminates.
--
-- ── 🔴 WALL 1 WAS A PERMANENT LOCKOUT, AND IT WAS PROVEN, NOT THEORISED ────
-- Round 2 counted `state = 'transit'` and nothing else. NOTHING IN THE SERVER
-- EVER WROTE 'arrived' — only the claim RPC moved a row off 'transit' — so a
-- convoy the recipient simply never unloaded held one of the ten slots FOREVER.
-- Reproduced on a real database: ten convoys aged to `launched_at = now() - 30
-- days` still counted `transit | 10`, and the eleventh launch raised
-- LAUNCH_QUOTA a month after the hourly window had closed. In the live client
-- that surfaced as the cruellest possible shape — the freight fee was charged,
-- the dishes left the pass, the toast blamed the network ("the truck turned back
-- to your own city"), the recipient heard nothing, and every future attempt
-- would do the same thing for the rest of the account's life.
--
-- TWO CHANGES CLOSE IT AND BOTH ARE HERE:
--   · `and arrives_at > now()` — a LANDED truck is not on the road, whatever its
--     state column says. This alone makes the lockout impossible even if the
--     state machine breaks again.
--   · both RPCs now SWEEP their caller's landed trucks to 'arrived' (see §3/§4),
--     so the state column stops lying as well.
--
-- ── ⚠ WHAT THESE NUMBERS ARE ──────────────────────────────────────────────
-- GUARD RAILS, not game tuning. The game's own limit is ECON.CONVOY_MAX_ACTIVE
-- (3) in kitchen.data.js and these are deliberately looser, so retuning the
-- client never starts failing launches, and still finite so a scripted client
-- cannot loop. Walls 3 and 4 are the ones that carry the economy.
--
-- ── 🔴 WALL 3: THE THROUGHPUT BUDGET (the production link) ─────────────────
-- Every box on a truck was PLATED, one at a time, by a player watching a timer.
-- A kitchen is therefore a physical thing with a maximum output rate, and the
-- number below is that rate written down where the server can see it:
--
--   240 boxes/hour = two full Road Trains, or twenty full Delivery Vans.
--
-- Sized against the honest ceiling and against the exploit, both measured:
--   · legitimate play tops out near 20 boxes/hour (one 120-box rig every six
--     hours, which is the largest truck in the game) — so this is ~12× looser
--     than the best real player and cannot bite anybody;
--   · the round-2 exploit ran at 10,000 boxes/hour. This is 40× tighter than
--     that, and it is the wall that survives when the client is a lie.
-- It is a SUM OVER DISHES, not a count of launches, which is the whole point:
-- round 2 limited how many trucks you could send and never once looked at how
-- much was on them.
--
-- ── 🔴 WALL 4: THE LIFETIME BUDGET ────────────────────────────────────────
-- The same statement over the account's whole life. A mule account registered
-- sixty seconds ago has not cooked anything, and the rolling hour cannot say so
-- on its first launch. `auth.users.created_at` can — and reading it is exactly
-- why this function is SECURITY DEFINER.
-- ⚠ THE `+ 120` IS THE OPENING GRACE AND IT IS ONE FULL ROAD TRAIN, NOT ONE
--   HOUR'S PRODUCTION. It was 240 (an hour's worth) for about five minutes and
--   that was wrong in an obvious way the moment it was measured: a mule account
--   sixty seconds old launched TWO full rigs before wall 4 bit. A brand-new
--   player can only fly the van — twelve boxes — so 120 is still ten of their
--   trucks, and it costs the attacker their entire first hour.
-- ⚠ The zero-argument version is DROPPED, not left beside this one. Postgres
--   would happily keep both, `kitchen_convoy_quota_ok()` would still resolve,
--   and a stale call site would then be throttled by round 2's rules with none
--   of walls 3 and 4 — a security regression that compiles and passes review.
--   The default on p_dishes means an explicit `quota_ok()` call still works.
drop function if exists public.kitchen_convoy_quota_ok();

create or replace function public.kitchen_convoy_quota_ok(p_dishes int default 0)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select
  -- 1 · trucks ACTUALLY ON THE ROAD. `arrives_at > now()` is the lockout fix.
  (
    select count(*) from public.kitchen_convoys
     where from_user = auth.uid()
       and state = 'transit'
       and arrives_at > now()
  ) < 10
  -- 2 · launches per hour. Caps van-spam independently of box count.
  and (
    select count(*) from public.kitchen_convoys
     where from_user = auth.uid() and launched_at > now() - interval '1 hour'
  ) < 20
  -- 3 · BOXES per hour, including the one being launched right now.
  and (
    (
      select coalesce(sum(dishes), 0) from public.kitchen_convoys
       where from_user = auth.uid() and launched_at > now() - interval '1 hour'
    ) + greatest(coalesce(p_dishes, 0), 0)
  ) <= 240
  -- 4 · BOXES per account lifetime, against what the account had time to cook.
  and (
    (
      select coalesce(sum(dishes), 0) from public.kitchen_convoys
       where from_user = auth.uid()
    ) + greatest(coalesce(p_dishes, 0), 0)
  ) <= 120 + 240 * greatest(
        extract(epoch from (now() - coalesce(
          (select u.created_at from auth.users u where u.id = auth.uid()),
          now()))) / 3600.0, 0);
$$;

grant execute on function public.is_convoy_party(uuid)            to authenticated;
grant execute on function public.kitchen_convoy_quota_ok(int)     to authenticated;
revoke all on function public.is_convoy_party(uuid)               from public, anon;
revoke all on function public.kitchen_convoy_quota_ok(int)        from public, anon;


-- ============================================================================
-- 3. THE LAUNCH RPC. The only way a convoy is ever created.
-- ============================================================================
-- 🔴 THE SERVER OWNS THE CLOCK, AND THAT IS THE ENTIRE POINT OF THIS FUNCTION.
--    Round 1 let the client INSERT directly and post its own `arrives_at`; the
--    only check was `arrives_at > now()`. Two things followed, and both were
--    real:
--      · a tampered client posted `now() + 1 millisecond` and skipped transit
--        entirely. Transit time is the one thing standing between a convoy and
--        a vending machine, so "optional" is the same as "absent".
--      · a player whose device clock ran 40 minutes slow FAILED that check on
--        every launch, forever. Their truck was silently downgraded to a local
--        run and the person they addressed it to never heard about it.
--    The client now posts a DURATION. This function decides when the truck
--    lands, from now(), in one place, for everybody.
--
-- ── 🔴 ROUND 3: THE CLAMPS ARE TIER-TRUE. THIS IS THE FAUCET FIX. ─────────
--    Round 2 clamped globally — 1..500 boxes, 10 minutes..12 hours — with the
--    tier sitting unused in `p_tier`. Proven on a real database: 'rig' with
--    p_dishes => 500, p_transit_ms => 1 was accepted ten times in a row. A rig
--    is 120 boxes over six hours.
--    Now the tier row is LOOKED UP and it decides:
--      · v_dish := least(client, t.capacity)   — the truck's real bed;
--      · v_ms   := greatest(client, t.transit_ms) — the truck's real road.
--    ⚠ NOTE THE DIRECTIONS. Boxes clamp DOWN and time clamps UP, because those
--      are the two safe directions: a client can always ask for a smaller load
--      or a longer trip (both cost it), and can never ask for a bigger load or a
--      shorter trip (both would print food). A client that is a deploy AHEAD of
--      this file — a retune that shortened a tier — gets the older, longer road
--      rather than a refusal, which is a cosmetic disagreement instead of a
--      broken feature. Re-run this file after retuning CONVOY_TIERS.
--    ⚠ AN UNKNOWN TIER FALLS BACK TO THE VAN, THE SMALLEST TRUCK. A client one
--      deploy ahead with a new tier id under-ships rather than over-ships. Wrong
--      in the safe direction, every time.
--    The global 500 / 12h clamps are KEPT as an outer wall underneath, so a tier
--    row hand-edited to something silly in the SQL editor still cannot mint.
--    ⚠ THE 12h WALL BOUNDS THE ROAD, NOT THE ARRIVAL. The hold-up rolled below
--      is added AFTER the clamp, so `p_transit_ms = 2^63-1` lands at 12h plus up
--      to the tier's `delay_max_pct` of it — measured at 13:28:30 on a van. That
--      is deliberate and it is the safe direction: capping the TOTAL would mean
--      silently discarding part of a hold-up that `delay_ms` says happened, and
--      `arrives_at` disagreeing with `delay_ms` is the one thing the client
--      cannot draw honestly. Every wall in this file exists to stop a SHORT
--      road; a longer one only ever costs the sender.
--
-- ⚠ EVERY PARAMETER AFTER p_to CARRIES A DEFAULT. PostgREST resolves an RPC by
--   the exact set of keys in the request body, so a client that is one deploy
--   behind and omits a key would otherwise get PGRST202 — "function not found" —
--   which the client correctly but confusingly reports as "the convoy network is
--   not set up yet". Defaults make an older client degrade to a sane truck
--   instead of to a banner.
-- ── 🔴 ROUND 5: THE LAUNCH IS IDEMPOTENT. THE GHOST CONVOY FIX. ──────────
--    Rounds 2 and 3 made the server own the CLOCK and the SIZE. What was still
--    client-owned was the ANSWER TO "DID IT LAND?", and nobody could give it:
--
--      client → RPC → row committed → **reply lost on the way back**
--
--    A dropped mobile connection, a suspended tab, a TLS reset, a 502 from the
--    gateway. Round 4's client could not distinguish that from "the depot never
--    heard me", so it turned the truck back into a local practice run and paid
--    the SENDER for it while the committed server row was still on the road to
--    the recipient. 40 dishes left the pass once; 80 units of live `food` came
--    out. That is the food printer this file spends four hundred lines
--    preventing, opened by a flaky connection rather than by an attacker.
--
--    `p_client_ref` closes it, and note WHICH property does the work: the retry
--    has to be FREE OF CONSEQUENCE. Under the same advisory lock that
--    serialises wall 10, the function looks the ref up FIRST and returns the row
--    it already wrote — no second truck, no second ledger row, and crucially NO
--    SECOND BITE OF THE QUOTA, so an honest client on a bad connection is not
--    throttled for retrying. The unique index kitchen_convoys_client_ref_once is
--    the backstop underneath, and the nested exception block below turns even a
--    lost race into the same answer instead of an error the player cannot act on.
--
--    ⚠ THE OLD 7-ARGUMENT FUNCTION IS DROPPED, NOT LEFT BESIDE THIS ONE.
--      PostgREST resolves an RPC by the exact set of keys in the request body,
--      so an overload without `p_client_ref` is not a harmless leftover: it is a
--      SECOND LAUNCH PATH with no idempotency at all, reachable by anything that
--      omits the key, and it would pass every other check in the verify block.
--      That is the same trap the zero-argument quota function was dropped for.
--      The verify block asserts there is exactly ONE launch function.
--    ⚠ CONSEQUENCE FOR DEPLOY ORDER: a client carrying the round-5 convoy.js
--      against a database that has NOT had this file re-applied sends
--      `p_client_ref` and gets PGRST202. kitchen.api.js reads that as
--      `missing:true`, the panel says "the convoy network is not set up yet",
--      and the launch turns back locally — which is a DEFINITE refusal (the
--      function does not exist, so nothing was written) and therefore cannot
--      ghost. Re-run this file and it lights up. Never the other way round.
drop function if exists public.kitchen_convoy_launch(uuid, text, text, text, jsonb, int, bigint);

create or replace function public.kitchen_convoy_launch(
  p_to         uuid,
  p_to_name    text    default null,
  p_from_name  text    default null,
  p_tier       text    default 'van',
  p_items      jsonb   default '{}'::jsonb,
  p_dishes     int     default 1,
  p_transit_ms bigint  default 1800000,
  p_client_ref uuid    default null
)
returns public.kitchen_convoys
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  v_id    uuid := gen_random_uuid();
  v_ms    bigint;
  v_dish  int;
  v_items jsonb;
  v_delay int := 0;
  v_leg   int := 0;
  t       public.kitchen_convoy_tiers;
  c       public.kitchen_convoys;
begin
  if me is null    then raise exception 'NOT_SIGNED_IN'; end if;
  if p_to is null  then raise exception 'NO_RECIPIENT';  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 🔴 WALL 10 — THE SERIALISER. WITHOUT THIS LINE WALLS 1..4 ARE DECORATION.
  -- ══════════════════════════════════════════════════════════════════════════
  -- kitchen_convoy_quota_ok() is four SELECT counts and nothing else. Counts
  -- read a SNAPSHOT. PostgREST runs every rpc() in its own transaction on a
  -- pooled connection at READ COMMITTED, so sixty simultaneous calls from one
  -- account each take their snapshot BEFORE any of the others has committed a
  -- row — every one of them counts zero trucks and zero lifetime boxes, every
  -- one of them passes all four walls, and all four walls fail in the same
  -- instant. The quota is not wrong; it is simply being asked a question about
  -- a world that has not happened yet.
  --
  -- MEASURED, on this exact file, on a real PostgreSQL 16, from one brand-new
  -- account (auth.users.created_at = now(), lifetime budget 120 boxes):
  --     SEQUENTIAL  60 launches → 1 truck  /   120 boxes  (2..60 LAUNCH_QUOTA)
  --     CONCURRENT  60 launches → 22 trucks/ 2,640 boxes  ← 22× the budget
  -- The critic measured 47 / 5,640 on their hardware. The number is whatever
  -- the machine's parallelism buys; the hole is the same hole. And it is the
  -- OPENING BURST that matters — the header of this file (see wall 9) stakes
  -- itself on "a fresh mule account cannot open with a burst it had no time to
  -- cook", and every one of those trucks writes a kitchen_convoy_ledger row,
  -- so the laundering this table exists to prevent is done with our receipt.
  --
  -- ONE LINE CLOSES IT. An advisory lock keyed on the SENDER makes concurrent
  -- launches from one account queue behind each other; at READ COMMITTED each
  -- waiter's next statement takes a FRESH snapshot after the lock is released,
  -- so the quota finally counts the trucks that were just committed.
  --     CONCURRENT 60, WITH THIS LINE → 1 truck / 120 boxes  ← equals sequential
  --
  -- ⚠ IT IS `_xact_` AND THAT IS LOAD-BEARING. `pg_advisory_lock` is held for
  --   the SESSION; on a pooled PostgREST connection that leaks a lock onto the
  --   next request that happens to reuse the connection and eventually wedges
  --   every launch by that sender forever. `pg_advisory_xact_lock` is released
  --   by COMMIT or ROLLBACK, always, including on an exception.
  -- ⚠ IT IS KEYED ON THE SENDER, NOT ON THE TABLE. Two different players never
  --   contend, so this costs nothing under real load — the only thing it
  --   serialises is one account against itself, which is exactly the shape of
  --   the attack and never the shape of play.
  -- ⚠ IT IS TAKEN HERE, BEFORE THE SWEEP, so everything this function reads or
  --   writes on behalf of `me` is inside it. No deadlock is possible against
  --   kitchen_convoy_claim(): claim takes a ROW lock and never takes this one,
  --   so there is no cycle to close.
  -- ⚠ WHAT IT DOES NOT COVER, said plainly: sixty DIFFERENT accounts launching
  --   at once are sixty different keys and do not queue. That is correct — each
  --   of them is still bounded by its own wall 9 lifetime budget, and the cost
  --   of the attack becomes "register sixty accounts", which is an auth problem
  --   and not this file's. Under REPEATABLE READ the snapshot is frozen for the
  --   whole transaction and the lock cannot help; PostgREST is READ COMMITTED,
  --   and if that ever changes this needs revisiting.
  -- 🔴 THE VERIFY BLOCK AT THE BOTTOM FAILS IF THIS LINE IS DELETED. It has to:
  --    removing it leaves a function that still passes every other check.
  perform pg_advisory_xact_lock(hashtextextended('kitchen_convoy_launch:' || me::text, 0));

  -- ══════════════════════════════════════════════════════════════════════════
  -- 🔴 THE IDEMPOTENT REPLY. THIS IS THE GHOST-CONVOY FIX AND IT IS FOUR LINES.
  -- ══════════════════════════════════════════════════════════════════════════
  -- If this ref already has a truck, that truck IS the answer. Return it and
  -- write nothing. A client whose first reply was lost asks again with the same
  -- ref and learns, definitively, that its convoy exists — which is the one
  -- question round 4's client could not ask, and the reason it invented a
  -- second copy of the load out of nothing.
  --
  -- ⚠ IT IS INSIDE THE ADVISORY LOCK AND THAT IS THE WHOLE ORDERING. Two
  --   simultaneous retries of the same ref would otherwise both read "no row"
  --   at READ COMMITTED and both insert — the identical shape as the round-3
  --   quota race. Serialised, the second one sees the first one's committed row.
  -- ⚠ IT IS BEFORE THE QUOTA CHECK, ON PURPOSE. A retry must not spend a second
  --   slot of walls 1..4: an honest client on a bad connection would otherwise
  --   be rate-limited for the network's failure, which is the round-2 lockout
  --   wearing a different hat.
  -- ⚠ `from_user = me` IS NOT DECORATION. The unique index is on (from_user,
  --   client_ref), so refs are only unique per sender; without this predicate a
  --   caller could hand back another player's convoy row by guessing a uuid.
  --   RLS does not help — this function is SECURITY DEFINER.
  if p_client_ref is not null then
    select * into c from public.kitchen_convoys
     where kitchen_convoys.from_user  = me
       and kitchen_convoys.client_ref = p_client_ref;
    if found then return c; end if;
  end if;

  -- 🔴 LAND WHAT HAS LANDED, FIRST. The server used to write 'arrived' nowhere
  --    at all, so a truck the recipient never unloaded held an in-flight slot
  --    for the life of the account (see kitchen_convoy_quota_ok's header for the
  --    thirty-day reproduction). The quota's `arrives_at > now()` makes the
  --    lockout impossible on its own; this makes the STATE COLUMN honest too, so
  --    anything reading it later — a report, a support query, the next person to
  --    add a write path — is not reading a lie.
  -- ⚠ Scoped to this caller's own rows, both directions, and served by both
  --   indexes. It is not a global sweep and must not become one: a table-wide
  --   update on every launch is a lock convoy nobody asked for.
  -- ⚠ EVERY COLUMN IN THE `where` IS QUALIFIED, AND THAT IS NOT STYLE.
  --   `kitchen_convoy_claim` is `returns table (… state text, …)`, which puts an
  --   OUT VARIABLE CALLED `state` in scope for the whole body. An unqualified
  --   `where state = 'transit'` is then ambiguous and plpgsql refuses the
  --   statement AT RUNTIME — the function still creates cleanly, the verify
  --   block still prints 'ok', and every single claim raises "column reference
  --   state is ambiguous". That is exactly what happened the first time this
  --   sweep was written, and it was caught by driving the real RPC on a real
  --   PostgreSQL 16 rather than by reading it. The file already carries the same
  --   warning for `id` a few lines down; this is the second instance of it.
  --   (The left-hand side of `set` is unambiguous by rule — only the `where`
  --   needs qualifying — but all of it is qualified so nobody has to know that.)
  update public.kitchen_convoys
     set state = 'arrived'
   where kitchen_convoys.state = 'transit'
     and kitchen_convoys.arrives_at <= now()
     and (kitchen_convoys.from_user = me or kitchen_convoys.to_user = me);

  -- 🔴 THE AUTHORISATION LINE. `from_user` is auth.uid() and there is no
  --    parameter for it. A caller-supplied sender id would be the ability to
  --    ship *from* another player's kitchen, which is the worst thing this
  --    table could allow.
  if p_to = me then raise exception 'NO_SELF_SHIP'; end if;

  -- A convoy to a user id that does not exist would fail the FK with a message
  -- the player cannot act on. Fail early with one they can.
  if not exists (select 1 from auth.users u where u.id = p_to) then
    raise exception 'NO_SUCH_PLAYER';
  end if;

  -- 🔴 THE TRUCK DECIDES, NOT THE CALLER. Unknown tier → the van (smallest).
  select * into t from public.kitchen_convoy_tiers
   where kitchen_convoy_tiers.id = left(coalesce(nullif(btrim(p_tier), ''), 'van'), 24);
  if not found then
    select * into t from public.kitchen_convoy_tiers where kitchen_convoy_tiers.id = 'van';
  end if;
  -- The tier table is seeded by this same file, so `not found` twice means
  -- somebody deleted the seed. Refuse rather than fall back to the round-2
  -- global clamps, which is precisely the state this whole section exists to
  -- make unreachable.
  if t.id is null then raise exception 'NO_TIER_TABLE'; end if;

  -- Boxes clamp DOWN to the truck's bed; the global 500 stays as an outer wall.
  v_dish := least(greatest(coalesce(p_dishes, 0), 1), greatest(t.capacity, 1), 500);
  -- Time clamps UP to the truck's road; the global 12h stays as an outer wall.
  v_ms   := least(greatest(coalesce(p_transit_ms, 0), t.transit_ms, 600000), 43200000);

  -- 🔴 THE BUDGET SEES THE BOX COUNT. Round 2 asked the quota nothing about SIZE
  --    and that is how 500-box rigs got through. `v_dish`, not `p_dishes`: ask
  --    about what is actually going to be written.
  if not public.kitchen_convoy_quota_ok(v_dish) then raise exception 'LAUNCH_QUOTA'; end if;

  -- ── THE ROAD ───────────────────────────────────────────────────────────────
  -- Roll the hold-up ONCE, here, and bake it into arrives_at. See the column
  -- comments on kitchen_convoys.delay_ms for why this cannot live in the client.
  -- ⚠ `random()` is fine and is not a security surface: the result is STORED, so
  --   it cannot be re-rolled by anybody, and the only thing it can do is make
  --   the truck later — which is a cost to the sender and a benefit to nobody.
  if coalesce(t.risk_pct, 0) > 0 and random() < t.risk_pct then
    -- 0.35..1.0 of the tier's maximum, so an incident is always felt.
    v_delay := floor(v_ms * coalesce(t.delay_max_pct, 0) * (0.35 + random() * 0.65))::int;
    -- 1..5. convoy.js clamps this into whatever ECON.CONVOY_ROUTE_LEGS it is
    -- drawing, so the two cannot disagree about which marker to flag.
    v_leg   := 1 + floor(random() * 5)::int;
    if v_delay <= 0 then v_leg := 0; end if;
  end if;

  -- `items` is display-only and the payout never reads it, but it is still
  -- client-supplied text sitting in our table. Anything that is not a small
  -- object becomes an empty one rather than a place to park a megabyte.
  v_items := coalesce(p_items, '{}'::jsonb);
  if jsonb_typeof(v_items) <> 'object' or length(v_items::text) > 2000 then
    v_items := '{}'::jsonb;
  end if;

  -- ⚠ THE NESTED BLOCK IS THE BACKSTOP UNDER THE LOOKUP ABOVE, NOT A
  --   DUPLICATE OF IT. The advisory lock plus the lookup is what normally makes
  --   a retry return the first truck; this catches the case where that pair is
  --   ever broken — a lock removed, a lookup edited, a second write path added
  --   by somebody who did not read this far — and turns it into the SAME answer
  --   (the existing row) rather than a unique_violation the player cannot act
  --   on and the client would classify as ambiguous all over again.
  -- ⚠ It is a subtransaction, so the failed insert rolls back cleanly and the
  --   advisory lock — taken OUTSIDE this block — is untouched.
  begin
    insert into public.kitchen_convoys
      (id, from_user, to_user, from_name, to_name, tier, items, dishes,
       launched_at, arrives_at, state, delay_ms, delay_leg, client_ref)
    values
      (v_id, me, p_to,
       left(coalesce(nullif(btrim(p_from_name), ''), 'Survivor'), 40),
       left(nullif(btrim(coalesce(p_to_name, '')), ''), 40),
       -- 🔴 THE TIER THAT WAS ACTUALLY APPLIED, not the string the client sent.
       --    Storing the client's word for it while clamping to something else is
       --    how a row ends up describing a truck that never existed.
       t.id,
       v_items, v_dish,
       now(), now() + ((v_ms + v_delay)::text || ' milliseconds')::interval, 'transit',
       v_delay, v_leg, p_client_ref)
    returning * into c;
  exception when unique_violation then
    select * into c from public.kitchen_convoys
     where kitchen_convoys.from_user  = me
       and kitchen_convoys.client_ref = p_client_ref;
    if found then return c; end if;
    raise;
  end;

  -- The other half of the append-only ledger. -dishes: the boxes left the
  -- sender. The 'claim' row that lands them is +dishes, so a delivered convoy
  -- sums to zero and one still on the road sums to -dishes.
  insert into public.kitchen_convoy_ledger
    (convoy_id, kind, from_user, to_user, resource, amount, dishes, note)
  values
    (c.id, 'launch', me, p_to, 'dish', -v_dish, v_dish,
     left(coalesce(c.from_name, 'Survivor') || ' -> ' || coalesce(c.to_name, 'Survivor'), 120))
  on conflict (convoy_id, kind) do nothing;

  return c;
end $$;

revoke all on function public.kitchen_convoy_launch(uuid, text, text, text, jsonb, int, bigint, uuid) from public, anon;
grant execute on function public.kitchen_convoy_launch(uuid, text, text, text, jsonb, int, bigint, uuid) to authenticated;


-- ============================================================================
-- 4. THE CLAIM RPC. The only way a convoy is ever claimed.
--    Derives the actor from auth.uid() and never trusts a caller-supplied
--    identity, quantity or payout.
-- ============================================================================
--
-- 🔴 THE ROUND-1 BUG, WRITTEN OUT SO IT CANNOT COME BACK.
--    The old version returned `public.kitchen_convoys` — the convoy row and
--    nothing else. On an already-claimed convoy it returned that same row
--    again, having written nothing, which was the right behaviour and a
--    catastrophic interface: **a first claim and a replay were byte-identical
--    to the caller.** convoy.js treated any successful response as
--    authorisation to credit the stash, so two tabs claiming one 40-box truck
--    credited 80 units of `food` — a mint, in the resource that prices the Gene
--    Vault, the Bottling Line, crafting and the market.
--
--    THE FIX IS TO ANSWER THE QUESTION. The insert against
--    kitchen_convoy_ledger_once is still `on conflict do nothing`, but now the
--    function reads ROW_COUNT and returns:
--        first_claim      — was THIS call the one that delivered the convoy?
--        delivered_dishes — how many boxes THIS call delivered. 0 on a replay.
--    The client is only permitted to pay on `delivered_dishes`. A replay pays
--    zero because the server says zero.
--
--    ⚠ IT STILL DOES NOT RAISE ON A REPLAY, and that is deliberate. A client
--    that lost the response to its first call, or whose stash hit the resource
--    cap part way through unloading, has to be able to ask again without being
--    told the convoy never existed. "The server says it paid you and you did
--    not get it" is the worst failure this feature has. Idempotency lives in
--    the unique index; the ANSWER lives in first_claim.
--
-- ⚠ The return TYPE changes with this revision, so the old function has to be
--   dropped rather than replaced — `create or replace` cannot change a return
--   type. `drop … if exists` keeps the file re-runnable.
drop function if exists public.kitchen_convoy_claim(uuid);

create or replace function public.kitchen_convoy_claim(p_id uuid)
returns table (
  id               uuid,
  from_user        uuid,
  to_user          uuid,
  from_name        text,
  to_name          text,
  tier             text,
  items            jsonb,
  dishes           int,
  launched_at      timestamptz,
  arrives_at       timestamptz,
  state            text,
  claimed_at       timestamptz,
  delay_ms         int,
  delay_leg        int,
  first_claim      boolean,
  delivered_dishes int
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  c       public.kitchen_convoys;
  n       int := 0;
  isfirst boolean := false;
begin
  if me is null   then raise exception 'NOT_SIGNED_IN'; end if;
  if p_id is null then raise exception 'BAD_CONVOY';    end if;

  -- Same honest-state sweep the launch RPC runs, for the same reason and scoped
  -- the same way. A recipient who only ever CLAIMS would otherwise never cause
  -- 'arrived' to be written for anything, and the sender's in-flight count would
  -- go on describing trucks that landed hours ago. It is not load-bearing —
  -- kitchen_convoy_quota_ok() reads `arrives_at`, not `state` — and that is
  -- exactly why it is safe to do here rather than in a job nobody scheduled.
  -- ⚠ EVERY COLUMN IN THE `where` IS QUALIFIED, AND THAT IS NOT STYLE.
  --   `kitchen_convoy_claim` is `returns table (… state text, …)`, which puts an
  --   OUT VARIABLE CALLED `state` in scope for the whole body. An unqualified
  --   `where state = 'transit'` is then ambiguous and plpgsql refuses the
  --   statement AT RUNTIME — the function still creates cleanly, the verify
  --   block still prints 'ok', and every single claim raises "column reference
  --   state is ambiguous". That is exactly what happened the first time this
  --   sweep was written, and it was caught by driving the real RPC on a real
  --   PostgreSQL 16 rather than by reading it. The file already carries the same
  --   warning for `id` a few lines down; this is the second instance of it.
  --   (The left-hand side of `set` is unambiguous by rule — only the `where`
  --   needs qualifying — but all of it is qualified so nobody has to know that.)
  update public.kitchen_convoys
     set state = 'arrived'
   where kitchen_convoys.state = 'transit'
     and kitchen_convoys.arrives_at <= now()
     and (kitchen_convoys.from_user = me or kitchen_convoys.to_user = me);

  -- FOR UPDATE: two tabs pressing Claim at the same moment serialise here
  -- rather than both reading 'transit' and both proceeding.
  -- ⚠ `kitchen_convoys.id` is qualified because `returns table` puts an OUT
  --   variable called `id` in scope; an unqualified `id` here is ambiguous and
  --   plpgsql would refuse to run the function at all.
  select * into c
    from public.kitchen_convoys
   where kitchen_convoys.id = p_id
     for update;
  if not found then raise exception 'CONVOY_GONE'; end if;

  -- 🔴 THE AUTHORISATION LINE. The sender may not claim their own convoy and a
  --    third party may not touch it at all. RLS already hides the row from
  --    everyone else, but this function is SECURITY DEFINER and therefore runs
  --    with RLS BYPASSED — so the check has to be here, in full, explicitly.
  if c.to_user <> me then raise exception 'NOT_YOURS'; end if;

  -- Transit time is the mechanic. Enforced here on the SERVER clock, because
  -- the client's clock is a suggestion — and set here too, by the launch RPC,
  -- so there is exactly one clock in the whole round trip.
  if c.arrives_at > now() then raise exception 'STILL_IN_TRANSIT'; end if;

  -- THE APPEND, and the ROW_COUNT read is the double-payout wall.
  insert into public.kitchen_convoy_ledger
    (convoy_id, kind, from_user, to_user, resource, amount, dishes, note)
  values
    (c.id, 'claim', c.from_user, me, 'dish', c.dishes, c.dishes,
     left(coalesce(c.from_name, 'Survivor') || ' -> ' || coalesce(c.to_name, 'Survivor'), 120))
  on conflict (convoy_id, kind) do nothing;
  get diagnostics n = row_count;
  isfirst := (n = 1);

  if isfirst then
    update public.kitchen_convoys
       set state      = 'claimed',
           claimed_at = coalesce(kitchen_convoys.claimed_at, now())
     where kitchen_convoys.id = c.id
    returning * into c;
  end if;

  return query
    select c.id, c.from_user, c.to_user, c.from_name, c.to_name, c.tier,
           c.items, c.dishes, c.launched_at, c.arrives_at, c.state, c.claimed_at,
           c.delay_ms, c.delay_leg,
           isfirst,
           case when isfirst then c.dishes else 0 end;
end $$;

revoke all on function public.kitchen_convoy_claim(uuid) from public, anon;
grant execute on function public.kitchen_convoy_claim(uuid) to authenticated;


-- ============================================================================
-- 5. THE SCOREBOARD RPC.
-- ============================================================================
-- ⚠ WHY AN RPC FOR A COSMETIC TABLE. PostgREST's `.upsert()` compiles to
--   `insert … on conflict (user_id) do update set user_id = excluded.user_id, …`
--   which requires an UPDATE privilege on `user_id` — that is, the ability to
--   move a row onto another player's id. Impersonation on a public board is the
--   only real risk this table has, and it is not worth carrying to save one
--   function. With this in place the client holds NO write grant on
--   kitchen_stats at all.
create or replace function public.kitchen_stats_upsert(
  p_name   text,
  p_level  int,
  p_served bigint,
  p_days   int,
  p_pop    int
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  insert into public.kitchen_stats
    (user_id, name, level, served, days, popularity, updated_at)
  values
    (me,
     left(coalesce(nullif(btrim(p_name), ''), 'Survivor'), 40),
     least(greatest(coalesce(p_level, 1), 1), 999),
     least(greatest(coalesce(p_served, 0), 0), 1000000000),
     least(greatest(coalesce(p_days, 0), 0), 1000000),
     least(greatest(coalesce(p_pop, 50), 0), 100),
     now())
  on conflict (user_id) do update
    set name       = excluded.name,
        level      = excluded.level,
        served     = excluded.served,
        days       = excluded.days,
        popularity = excluded.popularity,
        updated_at = now();
end $$;

revoke all on function public.kitchen_stats_upsert(text, int, bigint, int, int) from public, anon;
grant execute on function public.kitchen_stats_upsert(text, int, bigint, int, int) to authenticated;


-- ============================================================================
-- 5b. 🔴 THE TRIPWIRE THAT MAKES THE VERIFY BLOCK MEAN SOMETHING.
-- ============================================================================
-- ROUND 5, FINDING #2, AND IT IS THE WORST KIND OF DEFECT: A GUARD THAT LIES.
--
-- Several checks at the bottom of this file assert that a load-bearing
-- STATEMENT is still inside a function — the advisory lock of wall 10, the
-- `arrives_at > now()` of the lockout fix, the tier clamps of the faucet fix.
-- They did it with `p.prosrc like '%pg_advisory_xact_lock%'`. **`prosrc`
-- INCLUDES THE FUNCTION'S OWN COMMENTS**, and the block explaining wall 10
-- names `pg_advisory_xact_lock` four times inside the body.
--
-- MEASURED, on a real PostgreSQL 16: delete ONLY the
-- `perform pg_advisory_xact_lock(...)` statement, leave every comment intact,
-- re-apply this file — the verify block prints `launch serialises one sender |
-- ok` and every other row 'ok' as well. The identical sixty-parallel burst on
-- that "verified" function put 33 trucks and 3,960 boxes on the road against a
-- lifetime budget of 120. `quota releases landed trucks` failed the same way:
-- the comment quotes the predicate it is checking for.
--
-- This file is applied BY HAND in the Supabase SQL editor. That verify table is
-- the ONLY signal a human gets that the apply did what it says. A check that
-- passes on a function with the guard removed is worse than no check at all,
-- because the next maintainer trusts it and stops looking.
--
-- SO THE CHECKS MATCH THE CODE, NOT THE PROSE. `kitchen_sql_strip()` removes
-- `--` line comments and `/* */` block comments; `kitchen_fn_body()` is the
-- comment-free source of a named function; and the checks use a regex for the
-- STATEMENT (`perform\s+pg_advisory_xact_lock\s*\(`) rather than a substring
-- that a sentence can satisfy.
--
-- ⚠ AND THE STRIPPER ITSELF IS CHECKED. A stripper that quietly stopped
--   stripping would restore the exact hole this section exists to close, and it
--   would do it silently, so the verify block feeds it a known comment and
--   asserts the token inside that comment is gone. A tripwire on the tripwire.
-- ⚠ NOT SECURITY DEFINER and deliberately so: it reads pg_proc, which every
--   role can already read. It is a diagnostic, granted to nobody.
create or replace function public.kitchen_sql_strip(p_src text)
returns text
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select regexp_replace(
           regexp_replace(coalesce(p_src, ''), '/\*.*?\*/', ' ', 'g'),
           '--[^' || chr(10) || ']*', ' ', 'g')
$$;

create or replace function public.kitchen_fn_body(p_name text)
returns text
language sql stable set search_path = pg_catalog, pg_temp as $$
  select public.kitchen_sql_strip(string_agg(p.prosrc, chr(10)))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_name
$$;

revoke all on function public.kitchen_sql_strip(text) from public, anon, authenticated;
revoke all on function public.kitchen_fn_body(text)   from public, anon, authenticated;


-- ─── 6. RLS ────────────────────────────────────────────────────────────────
alter table public.kitchen_convoys       enable row level security;
alter table public.kitchen_convoy_ledger enable row level security;
alter table public.kitchen_stats         enable row level security;
alter table public.kitchen_convoy_tiers  enable row level security;

-- ── kitchen_convoys ────────────────────────────────────────────────────────

-- kc_sel  using (from_user = auth.uid() or to_user = auth.uid())
-- LETS IN : the sender reading their own trucks, and the recipient reading the
--           trucks addressed to them. Nothing else. Both sides of the OR are a
--           direct comparison against auth.uid(); neither can be satisfied by a
--           row belonging to two other people.
-- KEEPS OUT: everybody else, entirely — a third party cannot see that a convoy
--           exists, who sent it, what is on it, or when it lands. There is no
--           public directory of convoys and there should not be one. `anon` is
--           excluded by `to authenticated` AND by auth.uid() being null.
-- ⚠ Two direct column comparisons, no function call: this cannot recurse, and
--   it is the predicate the (to_user,…) and (from_user,…) indexes serve.
drop policy if exists kc_sel on public.kitchen_convoys;
create policy kc_sel on public.kitchen_convoys for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- ⚠ THERE IS DELIBERATELY NO INSERT, UPDATE OR DELETE POLICY ON THIS TABLE.
--   With RLS on and no policy, every one of those from a client matches zero
--   rows. Creation is kitchen_convoy_launch() and claiming is
--   kitchen_convoy_claim(); both are SECURITY DEFINER, both bypass RLS, and
--   both derive the actor from auth.uid(). A convoy is history, so nobody
--   deletes one. The revokes below are belt and braces: if somebody later adds
--   a policy by mistake, the missing grant still stops the write.
-- 🔴 kc_ins IS DROPPED, NOT EDITED. It allowed a client INSERT with a
--    client-supplied `arrives_at`, which is finding #5 — the device clock
--    deciding when a truck lands. Dropping it is what makes the launch RPC the
--    only path rather than the polite one.
drop policy if exists kc_ins on public.kitchen_convoys;
drop policy if exists kc_upd on public.kitchen_convoys;
drop policy if exists kc_del on public.kitchen_convoys;

-- `from public` is not decoration: every login role inherits PUBLIC, so a
-- privilege granted there survives `revoke … from anon, authenticated` and is
-- invisible to any check that filters on grantee = 'authenticated'.
-- ⚠ `service_role` IS DELIBERATELY LEFT ALONE, here and on both other tables.
--   It is the server-side key that never reaches a browser, Supabase's own
--   tooling and backups run under it, and revoking it here would break those
--   while protecting nothing a player can reach. The verify block checks
--   anon / authenticated / PUBLIC for the same reason.
revoke all on public.kitchen_convoys from anon, authenticated;
revoke all on public.kitchen_convoys from public;
grant select on public.kitchen_convoys to authenticated;

-- ── kitchen_convoy_ledger ──────────────────────────────────────────────────

-- kcl_sel  using (from_user = auth.uid() or to_user = auth.uid()
--                 or public.is_convoy_party(convoy_id))
-- LETS IN : the two parties to the movement, reading their own history.
-- KEEPS OUT: everyone else, and EVERY WRITER — there is no insert, update or
--            delete policy on this table at all, which is what makes
--            "append-only" enforceable rather than aspirational. The only
--            writers are kitchen_convoy_launch() and kitchen_convoy_claim(),
--            both SECURITY DEFINER and both bypassing RLS.
-- ⚠ The predicate uses the DENORMALISED from_user/to_user columns first and the
--   helper only as a fallback. WHY: the ledger has no FK to kitchen_convoys
--   precisely so history outlives the convoy, and is_convoy_party() returns
--   false once the convoy row is gone — reading it alone would quietly lock a
--   player out of their own past. The helper stays in the OR for rows written
--   by a future `kind` that does not carry both parties.
drop policy if exists kcl_sel on public.kitchen_convoy_ledger;
create policy kcl_sel on public.kitchen_convoy_ledger for select to authenticated
  using (
    from_user = auth.uid()
    or to_user = auth.uid()
    or public.is_convoy_party(convoy_id)
  );

revoke all on public.kitchen_convoy_ledger from anon, authenticated;
revoke all on public.kitchen_convoy_ledger from public;
grant select on public.kitchen_convoy_ledger to authenticated;

-- ── kitchen_stats ──────────────────────────────────────────────────────────

-- ks_sel  using (true)
-- LETS IN : any signed-in player reading the whole board. It is a leaderboard;
--           being readable is the entire feature, and `using (auth.uid() = …)`
--           on a leaderboard would be a leaderboard with one row in it.
-- KEEPS OUT: anonymous readers (`to authenticated`), and — this is the round-2
--           change — `user_id`. A `using (true)` policy grants nothing on its
--           own: what a role may read is the intersection of the policy and the
--           COLUMN GRANTS, and the grant below does not include `user_id`.
-- 🔴 WHY THAT MATTERS. Round 1 paired this policy with
--    `select('user_id,name,level,…')` in kitchen.api.js, which made the board a
--    paginated dump of auth.users UUIDs to every signed-in player. The board
--    never used the id — it was selected and discarded. Revoking the column is
--    what stops it quietly coming back the next time somebody types `*`.
drop policy if exists ks_sel on public.kitchen_stats;
create policy ks_sel on public.kitchen_stats for select to authenticated using (true);

-- 🔴 NO CLIENT WRITE POLICIES AND NO CLIENT WRITE GRANTS. Writing goes through
--    kitchen_stats_upsert(), which pins user_id = auth.uid(). ks_ins/ks_upd are
--    dropped rather than kept "just in case": a policy nobody needs is a door
--    nobody is watching.
drop policy if exists ks_ins on public.kitchen_stats;
drop policy if exists ks_upd on public.kitchen_stats;
drop policy if exists ks_del on public.kitchen_stats;

revoke all on public.kitchen_stats from anon, authenticated;
revoke all on public.kitchen_stats from public;
grant select (name, level, served, days, popularity, updated_at)
  on public.kitchen_stats to authenticated;

-- ── kitchen_convoy_tiers ───────────────────────────────────────────────────
-- 🔴 NO POLICY AND NO GRANT. NOT AN OVERSIGHT — THE POINT.
--    This table is the server's OWN copy of the truck numbers and it exists
--    solely so the launch RPC can refuse a load the real table never offered. A
--    browser has no business reading it (the client already has CONVOY_TIERS in
--    kitchen.data.js) and absolutely no business writing it: a client that could
--    UPDATE `capacity` would be a client that could set its own faucet, which is
--    the exact bug this table was added to close. The only reader is
--    kitchen_convoy_launch(), which is SECURITY DEFINER and bypasses RLS.
--    RLS is enabled anyway so that a grant added by mistake in some later
--    migration still matches zero rows — two locks, not one.
revoke all on public.kitchen_convoy_tiers from anon, authenticated;
revoke all on public.kitchen_convoy_tiers from public;

commit;

-- PostgREST caches the schema. Without this the brand-new RPCs answer PGRST202
-- ("function not found") for up to a few minutes, which the client correctly
-- but unhelpfully reports as "the convoy network is not set up yet".
notify pgrst, 'reload schema';

-- Optional, for an instant inbound badge instead of the client's 60s poll:
--   alter publication supabase_realtime add table public.kitchen_convoys;


-- ============================================================================
-- VERIFY — every line should read 'ok'.
--
-- ⚠ THE GRANT CHECKS READ pg_class.relacl / pg_attribute.attacl THROUGH
--   aclexplode(), NOT information_schema. Two reasons, both of which bit round
--   1's version of this block:
--     · information_schema's privilege views are filtered to roles the current
--       user belongs to, so what they show depends on who runs the file;
--     · a privilege held by the PUBLIC pseudo-role shows up in aclexplode with
--       grantee = 0 and is simply absent from a `grantee = 'authenticated'`
--       filter. Every login role inherits PUBLIC, so that is a real hole that
--       printed 'ok'.
--   `left join pg_roles` + `coalesce(rolname,'PUBLIC')` is what makes PUBLIC
--   visible at all. Do not "simplify" it back to an inner join.
--
-- ── 🔴 THE POLICY CHECKS READ THE PREDICATE NOW, NOT JUST THE COUNT ────────
-- Round 2's block COUNTED policies and never once looked at what they let
-- through, so it could not see the exact failure this file's own header names in
-- capitals: "a missing `using (auth.uid() = …)` is a data breach and looks
-- completely fine in review." That was demonstrated, not argued — `kc_sel` was
-- replaced with `using (true)`, which hands every signed-in player every convoy
-- in the game (both parties' ids, names, cargo and timings), the block was
-- re-run verbatim, and it printed `convoy policies | ok`. A third-party session
-- then read all ten rows.
-- For a migration applied BY HAND, whose only review artefact is this block,
-- that is the one green check capable of hiding a breach. So every policy check
-- below now asserts its `qual`:
--   · the two private tables must mention auth.uid();
--   · the leaderboard must be EXACTLY `true` — asserted deliberately, not
--     ignored, so that tightening it (a one-row board) or loosening it further
--     both show up here rather than in a bug report.
-- ⚠ `qual like '%auth.uid()%'` is a shape test, not a proof of correctness — it
--   cannot tell `from_user = auth.uid()` from `from_user <> auth.uid()`. It
--   catches the failure that actually happens (the guard going MISSING) and the
--   line-by-line read CLAUDE.md demands catches the rest. It is a smoke alarm,
--   not a fire marshal.
-- ============================================================================
select 'tables' as check,
       case when count(*) = 4 then 'ok' else 'MISSING (' || count(*) || '/4)' end as result
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('kitchen_convoys','kitchen_convoy_ledger','kitchen_stats',
                      'kitchen_convoy_tiers')

union all
select 'rls enabled',
       case when bool_and(c.relrowsecurity) then 'ok' else 'RLS OFF SOMEWHERE' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('kitchen_convoys','kitchen_convoy_ledger','kitchen_stats',
                     'kitchen_convoy_tiers')

union all
-- ONE select policy and nothing else, AND it must be guarded. An insert policy
-- here means somebody gave the client a way around kitchen_convoy_launch() and
-- its server clock; an update or delete policy means a way around
-- kitchen_convoy_claim(); an unguarded `using` means every player can read every
-- convoy in the game.
select 'convoy policy predicate',
       case when count(*) = 1
             and count(*) filter (where cmd = 'SELECT') = 1
             and bool_and(coalesce(qual, '') like '%auth.uid()%')
            then 'ok'
            when count(*) <> 1 then 'WRONG POLICY SET (' || count(*) || ')'
            else 'UNGUARDED PREDICATE — EVERY PLAYER READS EVERY CONVOY' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_convoys'

union all
-- The ledger is append-only: exactly one policy, it is a SELECT, and it is
-- guarded. An unguarded ledger is every player's shipping history.
select 'ledger policy predicate',
       case when count(*) = 1
             and count(*) filter (where cmd = 'SELECT') = 1
             and bool_and(coalesce(qual, '') like '%auth.uid()%')
            then 'ok'
            when count(*) <> 1 then 'LEDGER IS WRITABLE (' || count(*) || ' policies)'
            else 'UNGUARDED PREDICATE — EVERY PLAYER READS EVERY MOVEMENT' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_convoy_ledger'

union all
-- One SELECT policy on the scoreboard, and it is `true` ON PURPOSE — a
-- leaderboard guarded by auth.uid() is a leaderboard with one row in it. The
-- privacy here is the COLUMN GRANT (user_id is revoked), checked further down.
select 'stats policy predicate',
       case when count(*) = 1
             and count(*) filter (where cmd = 'SELECT') = 1
             and bool_and(coalesce(qual, '') = 'true')
            then 'ok'
            when count(*) <> 1 then 'CLIENT CAN WRITE STATS DIRECTLY'
            else 'STATS POLICY CHANGED — re-read it against the column grants' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_stats'

union all
-- The tier table is server-only: RLS on, and NO policy at all, so even a grant
-- added by mistake matches zero rows.
select 'tiers have no policy',
       case when count(*) = 0 then 'ok'
            else 'TIER TABLE IS REACHABLE FROM A CLIENT (' || count(*) || ')' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_convoy_tiers'

union all
select 'double-claim lock',
       case when count(*) = 1 then 'ok' else 'UNIQUE INDEX MISSING' end
  from pg_indexes
 where schemaname = 'public' and indexname = 'kitchen_convoy_ledger_once'

union all
-- All five functions present AND all five SECURITY DEFINER. A helper that lost
-- `security definer` stops bypassing RLS and starts recursing.
select 'security definer fns',
       case when count(*) = 5 and bool_and(p.prosecdef) then 'ok'
            else 'MISSING OR NOT DEFINER (' || count(*) || '/5)' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('is_convoy_party','kitchen_convoy_quota_ok',
                     'kitchen_convoy_claim','kitchen_convoy_launch',
                     'kitchen_stats_upsert')

union all
-- 🔴 THE DOUBLE-PAYOUT CHECK. If this line is not 'ok' the claim RPC is still
--    round 1's shape and a replayed claim pays twice.
select 'claim reports first_claim',
       case when exists (
              select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'kitchen_convoy_claim'
                 and p.proargnames @> array['first_claim','delivered_dishes']
            ) then 'ok' else 'CLAIM RPC IS PRE-FIX — REPLAY PAYS TWICE' end

union all
-- The client must hold NO write privilege on the convoy table, by any route,
-- including PUBLIC.
select 'no client write grant on convoys',
       case when count(*) = 0 then 'ok' else 'CLIENT CAN WRITE CONVOYS' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(case when array_length(c.relacl, 1) > 0 then c.relacl end) a
  left join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and c.relname = 'kitchen_convoys'
   and coalesce(r.rolname, 'PUBLIC') in ('anon','authenticated','PUBLIC')
   and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')

union all
select 'no ledger write grant',
       case when count(*) = 0 then 'ok' else 'CLIENT CAN WRITE THE LEDGER' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(case when array_length(c.relacl, 1) > 0 then c.relacl end) a
  left join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and c.relname = 'kitchen_convoy_ledger'
   and coalesce(r.rolname, 'PUBLIC') in ('anon','authenticated','PUBLIC')
   and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')

union all
select 'no client write grant on stats',
       case when count(*) = 0 then 'ok' else 'CLIENT CAN WRITE STATS' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(case when array_length(c.relacl, 1) > 0 then c.relacl end) a
  left join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and c.relname = 'kitchen_stats'
   and coalesce(r.rolname, 'PUBLIC') in ('anon','authenticated','PUBLIC')
   and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')

union all
-- 🔴 THE UUID LEAK CHECK. A table-wide SELECT grant on kitchen_stats covers
--    every column, `user_id` included, and the `using (true)` policy then hands
--    the whole of auth.users' id space to any signed-in player.
select 'stats: no table-wide select',
       case when count(*) = 0 then 'ok' else 'STATS LEAKS user_id' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(case when array_length(c.relacl, 1) > 0 then c.relacl end) a
  left join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and c.relname = 'kitchen_stats'
   and coalesce(r.rolname, 'PUBLIC') in ('anon','authenticated','PUBLIC')
   and a.privilege_type = 'SELECT'

union all
select 'stats: user_id not readable',
       case when count(*) = 0 then 'ok' else 'STATS LEAKS user_id' end
  from pg_attribute at
  join pg_class c on c.oid = at.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(case when array_length(at.attacl, 1) > 0 then at.attacl end) a
  left join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and c.relname = 'kitchen_stats'
   and at.attname = 'user_id'
   and coalesce(r.rolname, 'PUBLIC') in ('anon','authenticated','PUBLIC')
   and a.privilege_type = 'SELECT'

union all
select 'stats: board is readable',
       case when count(*) = 5 then 'ok'
            else 'BOARD NOT READABLE (' || count(*) || '/5 cols)' end
  from pg_attribute at
  join pg_class c on c.oid = at.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(case when array_length(at.attacl, 1) > 0 then at.attacl end) a
  left join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and c.relname = 'kitchen_stats'
   and at.attname in ('name','level','served','days','popularity')
   and coalesce(r.rolname, 'PUBLIC') = 'authenticated'
   and a.privilege_type = 'SELECT'

union all
select 'guard constraints',
       case when count(*) = 4 then 'ok' else 'MISSING (' || count(*) || '/4)' end
  from pg_constraint
 where conname in ('kitchen_convoys_dishes_chk','kitchen_convoys_state_chk',
                   'kitchen_convoys_time_chk','kitchen_convoys_party_chk')

union all
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 THE FAUCET CHECKS. Every one of these was 'ok'-by-absence in round 2.
-- ══════════════════════════════════════════════════════════════════════════

-- The truck table exists and carries the three trucks the client draws. If this
-- is not 'ok' the launch RPC raises NO_TIER_TABLE and nothing ships — which is
-- the correct failure, but you want to see it here and not in a support ticket.
select 'tiers seeded',
       case when count(*) = 3 then 'ok'
            else 'TIER SEED MISSING (' || count(*) || '/3) — LAUNCHES WILL REFUSE' end
  from public.kitchen_convoy_tiers
 where id in ('van','truck','rig')

union all
-- 🔴 The seeded numbers, printed rather than asserted, because the thing that
--    goes wrong here is DRIFT against kitchen.data.js CONVOY_TIERS and only a
--    human comparing the two can see it. Expect, as of this file:
--        van 12/1200000 · truck 40/7200000 · rig 120/21600000
select 'tiers (compare to CONVOY_TIERS)',
       string_agg(id || ' ' || capacity || '/' || transit_ms, ' · ' order by transit_ms)
  from public.kitchen_convoy_tiers

union all
-- 🔴 THE FAUCET. Round 2's launch clamped `least(greatest(p_dishes,1),500)` with
--    no reference to the tier and accepted 500-box rigs landing in ten minutes.
--    If `t.capacity` is not in the body, that hole is open again.
-- ⚠ COMMENT-STRIPPED (§5b). Every prosrc check below reads
--   kitchen_fn_body(), which is the function's source with `--` and `/* */`
--   removed, and matches the STATEMENT with a regex. The substring versions
--   these replace were satisfiable by the comments explaining the guard, and
--   two of them were demonstrated passing on a function with the guard deleted.
select 'launch clamps to the tier',
       case when public.kitchen_fn_body('kitchen_convoy_launch') ~ 't\.capacity'
             and public.kitchen_fn_body('kitchen_convoy_launch') ~ 't\.transit_ms'
            then 'ok'
            else 'LAUNCH RPC IS PRE-FIX — 500-BOX RIGS AT TEN MINUTES' end

union all
-- 🔴 THE SERIALISER (wall 10). Without it walls 1..4 are four SELECT counts read
--    from a pre-burst snapshot and sixty parallel calls from ONE account put 22
--    trucks and 2,640 boxes on the road against a lifetime budget of 120.
--    Measured on this file, on a real PostgreSQL 16, before the lock was added.
--    ⚠ `_xact_` is asserted specifically: `pg_advisory_lock` (session-scoped)
--      would pass a naive "does it lock" test and then leak the lock onto the
--      next request that reuses the pooled PostgREST connection.
--    🔴 AND THIS IS THE CHECK THAT DID NOT WORK. `prosrc like
--      '%pg_advisory_xact_lock%'` was satisfied by the comment block above the
--      statement, which names the function four times. The statement was
--      deleted, every comment left in place, the file re-applied — this row
--      printed 'ok' and the sixty-parallel burst put 33 trucks / 3,960 boxes on
--      the road. It matches `perform <fn> (` on comment-stripped source now.
select 'launch serialises one sender',
       case when public.kitchen_fn_body('kitchen_convoy_launch')
                  ~ 'perform\s+pg_advisory_xact_lock\s*\('
            then 'ok'
            else 'QUOTA LOSES A RACE — 60 PARALLEL CALLS BEAT ALL FOUR WALLS' end

union all
-- 🔴 THE PRODUCTION LINK. The quota must see the box count, or it is round 2's
--    quota: a limit on how many trucks you send and none on what is on them.
select 'quota sees the box count',
       case when exists (
              select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'kitchen_convoy_quota_ok'
                 and p.pronargs = 1)
             and public.kitchen_fn_body('kitchen_convoy_quota_ok')
                 ~ 'sum\s*\(\s*dishes\s*\)'
            then 'ok'
            else 'QUOTA IGNORES CARGO SIZE — THE FAUCET IS OPEN' end

union all
-- 🔴 THE PERMANENT LOCKOUT. Counting `state = 'transit'` alone locked a sender
--    out forever the first time a recipient did not unload. Reproduced at
--    thirty days on a real database.
--    🔴 THE SECOND CHECK THAT DID NOT WORK: the header of
--      kitchen_convoy_quota_ok() quotes the predicate verbatim, so dropping
--      `and arrives_at > now()` from wall 1 still printed 'ok'.
select 'quota releases landed trucks',
       case when public.kitchen_fn_body('kitchen_convoy_quota_ok')
                  ~ 'arrives_at\s*>\s*now\s*\(\s*\)'
            then 'ok'
            else 'PERMANENT LOCKOUT — an unclaimed convoy holds a slot forever' end

union all
-- Exactly one quota function. Two (the old zero-arg beside the new one) means a
-- stale call site can still be throttled by round 2's rules.
select 'one quota function',
       case when count(*) = 1 then 'ok'
            else 'TWO QUOTA FUNCTIONS — the zero-arg one still resolves' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'kitchen_convoy_quota_ok'

union all
-- The server writes 'arrived' somewhere, so the state column stops lying.
select 'server lands its own trucks',
       case when public.kitchen_fn_body('kitchen_convoy_launch')
                  ~ 'set\s+state\s*=\s*''arrived'''
            then 'ok' else 'NOTHING EVER WRITES arrived' end

union all
-- The road columns exist and the claim RPC hands them back, so convoy.js can
-- draw the hold-up rather than inventing one.
select 'road columns',
       case when count(*) = 2 then 'ok' else 'MISSING delay_ms/delay_leg' end
  from information_schema.columns
 where table_schema = 'public' and table_name = 'kitchen_convoys'
   and column_name in ('delay_ms','delay_leg')

union all
select 'claim returns the road',
       case when exists (
              select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'kitchen_convoy_claim'
                 and p.proargnames @> array['delay_ms','delay_leg']
            ) then 'ok' else 'CLAIM RPC PREDATES THE ROAD' end

union all
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 THE GHOST-CONVOY CHECKS (round 5). Wall 11: the launch is idempotent.
-- ══════════════════════════════════════════════════════════════════════════

-- The column the client keys its retry on. Without it there is no way for a
-- sender to ask "did my insert land?", and round 4's client answered that
-- question by inventing a second copy of the load.
select 'convoy carries a client ref',
       case when count(*) = 1 then 'ok' else 'NO client_ref — A LOST REPLY DUPLICATES FOOD' end
  from information_schema.columns
 where table_schema = 'public' and table_name = 'kitchen_convoys'
   and column_name = 'client_ref'

union all
-- The database-level backstop. The RPC's lookup is the normal path; this index
-- is what makes a second truck for one ref impossible rather than unlikely.
select 'one truck per client ref',
       case when count(*) = 1 then 'ok' else 'IDEMPOTENCY INDEX MISSING' end
  from pg_indexes
 where schemaname = 'public' and indexname = 'kitchen_convoys_client_ref_once'

union all
-- The parameter exists, so a client can actually send a ref.
select 'launch takes a client ref',
       case when exists (
              select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'kitchen_convoy_launch'
                 and p.proargnames @> array['p_client_ref']
            ) then 'ok' else 'LAUNCH RPC PREDATES THE IDEMPOTENCY KEY' end

union all
-- 🔴 …AND IT USES IT, ON THE PATH BEFORE THE INSERT. The parameter being
--    present proves nothing, and neither does the ref appearing SOMEWHERE in
--    the body: the exception backstop mentions it too, so a check that only
--    looked for `client_ref = p_client_ref` still printed 'ok' with the whole
--    pre-insert lookup deleted. That was caught by mutating this file and
--    re-applying it, which is the only way any of these checks are worth
--    anything. Both halves of the guarded lookup are asserted.
select 'launch is idempotent per ref',
       case when public.kitchen_fn_body('kitchen_convoy_launch')
                  ~ 'p_client_ref\s+is\s+not\s+null'
             and public.kitchen_fn_body('kitchen_convoy_launch')
                  ~ 'client_ref\s*=\s*p_client_ref'
            then 'ok'
            else 'RETRY WRITES A SECOND TRUCK — THE GHOST CONVOY IS BACK' end

union all
-- The backstop under the lookup: if the lock or the lookup is ever broken, a
-- duplicate insert must come back as the FIRST truck, not as a 23505 the client
-- would classify as ambiguous all over again.
select 'launch survives a lost race',
       case when public.kitchen_fn_body('kitchen_convoy_launch')
                  ~ 'exception\s+when\s+unique_violation'
            then 'ok'
            else 'A DUPLICATE LAUNCH ERRORS INSTEAD OF RETURNING THE FIRST TRUCK' end

union all
-- 🔴 EXACTLY ONE LAUNCH FUNCTION. PostgREST resolves an RPC by the exact set of
--    keys in the body, so a leftover 7-argument overload is a SECOND launch path
--    with no idempotency, reachable by anything that omits p_client_ref, and it
--    would pass every other check on this list. Same trap as the zero-argument
--    quota function.
select 'one launch function',
       case when count(*) = 1 then 'ok'
            else 'TWO LAUNCH FUNCTIONS — the non-idempotent one still resolves' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'kitchen_convoy_launch'

union all
-- 🔴 THE TRIPWIRE ON THE TRIPWIRE (§5b). Five checks above are only as good as
--    kitchen_sql_strip(). Feed it a comment containing the exact token those
--    checks hunt for: if the token survives, the stripper has stopped stripping
--    and every one of those 'ok's is meaningless again — silently, which is how
--    round 4 shipped a guard that lied. This row is what makes that loud.
select 'comment stripper works',
       case when public.kitchen_sql_strip(
                   'x := 1; -- perform pg_advisory_xact_lock(9)' || chr(10) ||
                   '/* client_ref = p_client_ref */ y := 2;')
                  !~ 'pg_advisory_xact_lock'
             and public.kitchen_sql_strip(
                   'x := 1; -- perform pg_advisory_xact_lock(9)' || chr(10) ||
                   '/* client_ref = p_client_ref */ y := 2;')
                  !~ 'client_ref'
             and public.kitchen_sql_strip('perform pg_advisory_xact_lock(9);')
                  ~ 'pg_advisory_xact_lock'
            then 'ok'
            else 'STRIPPER IS BROKEN — EVERY prosrc CHECK ABOVE IS MEANINGLESS' end

union all
-- The tier table must be unreachable from a browser by ANY route, PUBLIC
-- included. A client that could UPDATE `capacity` could set its own faucet.
select 'no client grant on tiers',
       case when count(*) = 0 then 'ok' else 'CLIENT CAN REACH THE TIER TABLE' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(case when array_length(c.relacl, 1) > 0 then c.relacl end) a
  left join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and c.relname = 'kitchen_convoy_tiers'
   and coalesce(r.rolname, 'PUBLIC') in ('anon','authenticated','PUBLIC');
-- ============================================================================
