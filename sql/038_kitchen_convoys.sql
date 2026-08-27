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
  claimed_at  timestamptz
);

-- Re-runnable against an earlier shape.
alter table public.kitchen_convoys add column if not exists from_name  text;
alter table public.kitchen_convoys add column if not exists to_name    text;
alter table public.kitchen_convoys add column if not exists tier       text;
alter table public.kitchen_convoys add column if not exists claimed_at timestamptz;

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

-- Anti-spam / anti-collusion throttle.
-- 🔴 THIS IS THE RECURSION TRAP IN PERSON: it counts kitchen_convoys and it is
--    called from code that writes kitchen_convoys. As SECURITY DEFINER it
--    bypasses RLS and terminates.
-- ⚠ These two numbers are GUARD RAILS, not game tuning. The game's own limit is
--   ECON.CONVOY_MAX_ACTIVE (3) in kitchen.data.js; these are deliberately
--   looser so retuning the client never starts failing launches, and still
--   finite so a scripted client cannot loop.
create or replace function public.kitchen_convoy_quota_ok()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (
    select count(*) from public.kitchen_convoys
     where from_user = auth.uid() and state = 'transit'
  ) < 10
  and (
    select count(*) from public.kitchen_convoys
     where from_user = auth.uid() and launched_at > now() - interval '1 hour'
  ) < 20;
$$;

grant execute on function public.is_convoy_party(uuid)        to authenticated;
grant execute on function public.kitchen_convoy_quota_ok()    to authenticated;
revoke all on function public.is_convoy_party(uuid)           from public, anon;
revoke all on function public.kitchen_convoy_quota_ok()       from public, anon;


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
-- ⚠ THE CLAMP IS A GUARD RAIL, NOT TUNING. The game's shortest truck is 30
--   minutes (CONVOY_TIERS) and its longest is 6 hours. The floor here is 10
--   minutes and the ceiling 12 hours: loose enough that retuning the client
--   never starts failing launches, tight enough that neither a zero nor a
--   decade can be posted.
-- ⚠ EVERY PARAMETER AFTER p_to CARRIES A DEFAULT. PostgREST resolves an RPC by
--   the exact set of keys in the request body, so a client that is one deploy
--   behind and omits a key would otherwise get PGRST202 — "function not found" —
--   which the client correctly but confusingly reports as "the convoy network is
--   not set up yet". Defaults make an older client degrade to a sane truck
--   instead of to a banner.
create or replace function public.kitchen_convoy_launch(
  p_to         uuid,
  p_to_name    text    default null,
  p_from_name  text    default null,
  p_tier       text    default 'van',
  p_items      jsonb   default '{}'::jsonb,
  p_dishes     int     default 1,
  p_transit_ms bigint  default 1800000
)
returns public.kitchen_convoys
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  v_id    uuid := gen_random_uuid();
  v_ms    bigint;
  v_dish  int;
  v_items jsonb;
  c       public.kitchen_convoys;
begin
  if me is null    then raise exception 'NOT_SIGNED_IN'; end if;
  if p_to is null  then raise exception 'NO_RECIPIENT';  end if;

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

  if not public.kitchen_convoy_quota_ok() then raise exception 'LAUNCH_QUOTA'; end if;

  v_dish := least(greatest(coalesce(p_dishes, 0), 1), 500);
  v_ms   := least(greatest(coalesce(p_transit_ms, 0), 600000), 43200000);

  -- `items` is display-only and the payout never reads it, but it is still
  -- client-supplied text sitting in our table. Anything that is not a small
  -- object becomes an empty one rather than a place to park a megabyte.
  v_items := coalesce(p_items, '{}'::jsonb);
  if jsonb_typeof(v_items) <> 'object' or length(v_items::text) > 2000 then
    v_items := '{}'::jsonb;
  end if;

  insert into public.kitchen_convoys
    (id, from_user, to_user, from_name, to_name, tier, items, dishes,
     launched_at, arrives_at, state)
  values
    (v_id, me, p_to,
     left(coalesce(nullif(btrim(p_from_name), ''), 'Survivor'), 40),
     left(nullif(btrim(coalesce(p_to_name, '')), ''), 40),
     left(coalesce(nullif(btrim(p_tier), ''), 'van'), 24),
     v_items, v_dish,
     now(), now() + (v_ms::text || ' milliseconds')::interval, 'transit')
  returning * into c;

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

revoke all on function public.kitchen_convoy_launch(uuid, text, text, text, jsonb, int, bigint) from public, anon;
grant execute on function public.kitchen_convoy_launch(uuid, text, text, text, jsonb, int, bigint) to authenticated;


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


-- ─── 6. RLS ────────────────────────────────────────────────────────────────
alter table public.kitchen_convoys       enable row level security;
alter table public.kitchen_convoy_ledger enable row level security;
alter table public.kitchen_stats         enable row level security;

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
-- ============================================================================
select 'tables' as check,
       case when count(*) = 3 then 'ok' else 'MISSING (' || count(*) || '/3)' end as result
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('kitchen_convoys','kitchen_convoy_ledger','kitchen_stats')

union all
select 'rls enabled',
       case when bool_and(c.relrowsecurity) then 'ok' else 'RLS OFF SOMEWHERE' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('kitchen_convoys','kitchen_convoy_ledger','kitchen_stats')

union all
-- ONE select policy and nothing else. An insert policy here means somebody gave
-- the client a way around kitchen_convoy_launch() and its server clock; an
-- update or delete policy means a way around kitchen_convoy_claim().
select 'convoy policies',
       case when count(*) = 1
             and count(*) filter (where cmd = 'SELECT') = 1
            then 'ok' else 'WRONG POLICY SET (' || count(*) || ')' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_convoys'

union all
-- The ledger is append-only: exactly one policy, and it is a SELECT.
select 'ledger append-only',
       case when count(*) = 1 and count(*) filter (where cmd = 'SELECT') = 1
            then 'ok' else 'LEDGER IS WRITABLE' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_convoy_ledger'

union all
-- One SELECT policy on the scoreboard. Writing is the RPC's job.
select 'stats policies',
       case when count(*) = 1 and count(*) filter (where cmd = 'SELECT') = 1
            then 'ok' else 'CLIENT CAN WRITE STATS DIRECTLY' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_stats'

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
                   'kitchen_convoys_time_chk','kitchen_convoys_party_chk');
-- ============================================================================
