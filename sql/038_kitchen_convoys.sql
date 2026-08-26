-- ============================================================================
-- 038_kitchen_convoys.sql
-- 🍔 MYTHIC KITCHEN — player-to-player food convoys.
-- Idempotent. Re-runnable. RLS ships in this file. Ends with a verify query.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc
-- (there is no CLI login in this repo). Nothing in the client requires this to
-- have been applied: /src/kitchen/kitchen.api.js detects a missing table
-- (PGRST205) and reports `missing:true`, and the convoy panel then says
-- "the convoy network is not set up yet" while local practice runs keep
-- working. Applying this is an UPGRADE, never a gate.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--  1. kitchen_convoys        one row per truck. Sender writes it, recipient
--                            unloads it, NOBODY updates it directly.
--  2. kitchen_convoy_ledger  append-only movement log. Balance = sum(amount).
--                            No balance column. No UPDATE policy. Ever.
--  3. kitchen_stats          cosmetic leaderboard. NEVER an economy source.
--  4. kitchen_convoy_claim() the ONE way a convoy is claimed: SECURITY DEFINER,
--                            atomic, and idempotent under a replayed request.
--
-- ── 🔴 WHAT THE ECONOMY IS TRUSTING THIS FILE WITH ─────────────────────────
-- A claimed convoy turns into units of the LIVE resource `food` in the
-- recipient's stash. `food` prices the Gene Vault, the Bottling Line, crafting
-- and the resource market, so a convoy that pays out more than it consumed is
-- not a balance problem, it is the end of the resource economy. FOUR walls,
-- and every one of them is deliberate:
--   1. ECON.CONVOY_FOOD_PER_DISH (client) is tuned BELOW the `food` embodied in
--      the cheapest dish that can ride. Shipping is a LOSS for the pair.
--   2. `dishes` is capped by a CHECK constraint here — a tampered client cannot
--      post a thousand-box truck.
--   3. kitchen_convoy_quota_ok() rate limits how many convoys one account can
--      launch, so two colluding accounts cannot run a fast loop.
--   4. to_user <> from_user is enforced below, so the trivial "ship to myself"
--      loop cannot exist on the server at all. (Practice runs to your own city
--      are a purely LOCAL client thing and never reach this table.)
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
-- ============================================================================

begin;

-- ─── 1. TABLES ─────────────────────────────────────────────────────────────

-- One truck. Written once by the sender, flipped once by kitchen_convoy_claim().
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
--    a client-side retune never starts failing inserts, and deliberately finite
--    so a tampered client cannot post a number that matters.
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
  -- A truck cannot arrive before it left. Without this a client could post an
  -- arrives_at in 1970 and unload instantly, which makes transit time — the one
  -- thing stopping a convoy from being a vending machine — optional.
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
-- ⚠ `amount` counts DISHES, not food. The server knows how many boxes moved; it
--    does not know ECON.CONVOY_FOOD_PER_DISH, and it must not — that constant
--    is retuned in kitchen.data.js and a copy of it in SQL would be a second
--    source of truth for the most dangerous number in the feature.
create table if not exists public.kitchen_convoy_ledger (
  id         bigint generated always as identity primary key,
  -- Deliberately NOT a foreign key: deleting a convoy must never erase the
  -- history of what it moved.
  convoy_id  uuid not null,
  kind       text not null,
  from_user  uuid not null,
  to_user    uuid not null,
  resource   text not null default 'dish',
  amount     int  not null,               -- signed; positive = to_user gained
  dishes     int  not null default 0,
  note       text,
  created_at timestamptz not null default now()
);

do $$
begin
  -- 'launch' and 'spoil' are reserved now so adding them later needs no
  -- migration. Only 'claim' is written today.
  if not exists (select 1 from pg_constraint where conname = 'kitchen_convoy_ledger_kind_chk') then
    alter table public.kitchen_convoy_ledger
      add constraint kitchen_convoy_ledger_kind_chk check (kind in ('launch','claim','spoil'));
  end if;
end $$;

-- 🔴 THE DOUBLE-CLAIM LOCK, and it is the whole of it. One 'claim' row per
--    convoy, enforced by the database rather than by a state check that a
--    replayed request could race. kitchen_convoy_claim() inserts
--    `on conflict do nothing` against this index, so calling it twice — from
--    two tabs, from a retried fetch, from a replayed request — writes one row.
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

-- Anti-spam / anti-collusion throttle, checked in the INSERT policy.
-- 🔴 THIS IS THE RECURSION TRAP IN PERSON: it is called from a policy ON
--    kitchen_convoys and it COUNTS kitchen_convoys. As SECURITY DEFINER it
--    bypasses RLS and terminates; written inline as an EXISTS in the policy it
--    would be a policy on a table querying that table.
-- ⚠ These two numbers are GUARD RAILS, not game tuning. The game's own limit is
--   ECON.CONVOY_MAX_ACTIVE (3) in kitchen.data.js; these are deliberately
--   looser so retuning the client never starts failing inserts, and still
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


-- ─── 3. RLS ────────────────────────────────────────────────────────────────
alter table public.kitchen_convoys       enable row level security;
alter table public.kitchen_convoy_ledger enable row level security;
alter table public.kitchen_stats         enable row level security;

-- ── kitchen_convoys ────────────────────────────────────────────────────────

-- LETS IN : the sender reading their own trucks, and the recipient reading the
--           trucks addressed to them.
-- KEEPS OUT: everybody else, entirely — a third party cannot see that a convoy
--           exists, who sent it, what is on it, or when it lands. There is no
--           public directory of convoys and there should not be one.
-- ⚠ Two direct column comparisons, no function call: this cannot recurse, and
--   it is the predicate the (to_user,…) and (from_user,…) indexes serve.
drop policy if exists kc_sel on public.kitchen_convoys;
create policy kc_sel on public.kitchen_convoys for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- LETS IN : a signed-in player posting ONE truck, FROM THEMSELVES, to somebody
--           else, with a sane box count, that arrives in the future, while they
--           are under the launch quota.
-- KEEPS OUT: · shipping *from* another player's kitchen (from_user pinned);
--            · shipping to yourself to farm the claim (party check constraint);
--            · a thousand-box truck (dishes check constraint);
--            · a truck that already arrived — arrives_at > now() is what makes
--              the RPC's `arrives_at <= now()` gate mean anything, and without
--              it transit time is optional and a convoy is a vending machine;
--            · a scripted loop (quota helper).
-- 🔴 `from_user = auth.uid()` is the line. If it ever goes missing, any player
--    can post convoys as any other player and this whole file is decoration.
drop policy if exists kc_ins on public.kitchen_convoys;
create policy kc_ins on public.kitchen_convoys for insert to authenticated
  with check (
    from_user = auth.uid()
    and to_user is not null
    and to_user <> auth.uid()
    and dishes >= 1 and dishes <= 500
    and arrives_at > now()
    and public.kitchen_convoy_quota_ok()
  );

-- ⚠ THERE IS DELIBERATELY NO UPDATE POLICY AND NO DELETE POLICY.
--   With RLS on and no policy, every UPDATE and DELETE from a client matches
--   zero rows. Claiming is kitchen_convoy_claim() — SECURITY DEFINER, one
--   atomic flip, one ledger row — and a convoy is history, so nobody deletes
--   one. The revokes below are belt and braces: if somebody later adds a policy
--   by mistake, the missing grant still stops the write.
drop policy if exists kc_upd on public.kitchen_convoys;
drop policy if exists kc_del on public.kitchen_convoys;
revoke update, delete on public.kitchen_convoys from anon, authenticated;
grant select, insert on public.kitchen_convoys to authenticated;

-- ── kitchen_convoy_ledger ──────────────────────────────────────────────────

-- LETS IN : the two parties to the movement, reading their own history.
-- KEEPS OUT: everyone else, and every writer — there is no insert, update or
--            delete policy on this table at all, which is what makes
--            "append-only" enforceable rather than aspirational. The only
--            writer is kitchen_convoy_claim(), which is SECURITY DEFINER and
--            bypasses RLS.
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

revoke insert, update, delete on public.kitchen_convoy_ledger from anon, authenticated;
grant select on public.kitchen_convoy_ledger to authenticated;

-- ── kitchen_stats ──────────────────────────────────────────────────────────

-- LETS IN : any signed-in player reading the whole board. It is a leaderboard;
--           being readable is the entire feature.
-- KEEPS OUT: anonymous readers. Nothing sensitive is here — a display name the
--           player already publishes, a level and a served count.
drop policy if exists ks_sel on public.kitchen_stats;
create policy ks_sel on public.kitchen_stats for select to authenticated using (true);

-- LETS IN : a player writing their OWN scoreboard row.
-- KEEPS OUT: writing a row under someone else's user_id — which would be
--           impersonation on a public board, the only real risk this table has.
drop policy if exists ks_ins on public.kitchen_stats;
create policy ks_ins on public.kitchen_stats for insert to authenticated
  with check (user_id = auth.uid());

-- LETS IN : a player updating their own row (the client upserts every session).
-- KEEPS OUT: editing anyone else's row, and — via the with check — reassigning
--           your row to another user_id, which is the same impersonation by a
--           slower route.
drop policy if exists ks_upd on public.kitchen_stats;
create policy ks_upd on public.kitchen_stats for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete policy: a scoreboard row is not worth a delete path.
drop policy if exists ks_del on public.kitchen_stats;
revoke delete on public.kitchen_stats from anon, authenticated;
grant select, insert, update on public.kitchen_stats to authenticated;

commit;


-- ============================================================================
-- 4. THE CLAIM RPC. The only way a convoy is ever claimed.
--    Derives the actor from auth.uid() and never trusts a caller-supplied
--    identity, quantity or payout.
-- ============================================================================

-- 🔴 IDEMPOTENT BY THE UNIQUE INDEX, NOT BY A STATE CHECK.
--    CONTRACT §10 describes the gate as `state = 'transit' and arrives_at <=
--    now()`. This raises on the arrival gate but deliberately does NOT raise on
--    an already-claimed convoy: it returns the row again, unchanged, having
--    written nothing. WHY, because the obvious version is worse — a client that
--    lost the response to its first call, or whose stash hit the resource cap
--    part way through unloading, has to be able to ask again. If a replay threw,
--    the food would be stranded with no way to collect it, and "the server says
--    it paid you and you did not get it" is the worst failure this feature has.
--    The thing that must be impossible is a SECOND LEDGER ROW, and the unique
--    index on (convoy_id, kind) makes it impossible even under a replayed
--    request, a double-click, or two tabs racing.
create or replace function public.kitchen_convoy_claim(p_id uuid)
returns public.kitchen_convoys
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  c  public.kitchen_convoys;
begin
  if me is null   then raise exception 'NOT_SIGNED_IN'; end if;
  if p_id is null then raise exception 'BAD_CONVOY';    end if;

  -- FOR UPDATE: two tabs pressing Claim at the same moment serialise here
  -- rather than both reading 'transit' and both proceeding.
  select * into c from public.kitchen_convoys where id = p_id for update;
  if not found then raise exception 'CONVOY_GONE'; end if;

  -- 🔴 THE AUTHORISATION LINE. The sender may not claim their own convoy and a
  --    third party may not touch it at all. RLS already hides the row from
  --    everyone else, but this function is SECURITY DEFINER and therefore runs
  --    with RLS BYPASSED — so the check has to be here, in full, explicitly.
  if c.to_user <> me then raise exception 'NOT_YOURS'; end if;

  -- Transit time is the mechanic. Enforced here on the SERVER clock, because
  -- the client's clock is a suggestion.
  if c.arrives_at > now() then raise exception 'STILL_IN_TRANSIT'; end if;

  -- Already unloaded → hand the same row back. No second ledger row, no second
  -- state change, no exception. See the block comment above.
  if c.state = 'claimed' then
    return c;
  end if;

  -- The append. `amount` is DISHES (see the table comment): the server records
  -- the movement it can actually verify and leaves the food conversion to ECON.
  insert into public.kitchen_convoy_ledger
    (convoy_id, kind, from_user, to_user, resource, amount, dishes, note)
  values
    (c.id, 'claim', c.from_user, me, 'dish', c.dishes, c.dishes,
     left(coalesce(c.from_name, 'Survivor') || ' -> ' || coalesce(c.to_name, 'Survivor'), 120))
  on conflict (convoy_id, kind) do nothing;

  update public.kitchen_convoys
     set state      = 'claimed',
         claimed_at = coalesce(claimed_at, now())
   where id = c.id
  returning * into c;

  return c;
end $$;

revoke all on function public.kitchen_convoy_claim(uuid) from public, anon;
grant execute on function public.kitchen_convoy_claim(uuid) to authenticated;

-- Optional, for an instant inbound badge instead of the client's 60s poll:
--   alter publication supabase_realtime add table public.kitchen_convoys;


-- ============================================================================
-- VERIFY — every line should read 'ok'.
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
-- select + insert and NOTHING else. An update or delete policy appearing here
-- means somebody gave the client a way around kitchen_convoy_claim().
select 'convoy policies',
       case when count(*) filter (where cmd = 'SELECT') = 1
             and count(*) filter (where cmd = 'INSERT') = 1
             and count(*) filter (where cmd in ('UPDATE','DELETE','ALL')) = 0
            then 'ok' else 'WRONG POLICY SET' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_convoys'

union all
-- The ledger is append-only: exactly one policy, and it is a SELECT.
select 'ledger append-only',
       case when count(*) = 1 and count(*) filter (where cmd = 'SELECT') = 1
            then 'ok' else 'LEDGER IS WRITABLE' end
  from pg_policies where schemaname = 'public' and tablename = 'kitchen_convoy_ledger'

union all
select 'double-claim lock',
       case when count(*) = 1 then 'ok' else 'UNIQUE INDEX MISSING' end
  from pg_indexes
 where schemaname = 'public' and indexname = 'kitchen_convoy_ledger_once'

union all
-- All three functions present AND all three SECURITY DEFINER. A helper that
-- lost `security definer` stops bypassing RLS and starts recursing.
select 'security definer fns',
       case when count(*) = 3 and bool_and(p.prosecdef) then 'ok'
            else 'MISSING OR NOT DEFINER (' || count(*) || '/3)' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('is_convoy_party','kitchen_convoy_quota_ok','kitchen_convoy_claim')

union all
-- The client must not hold a direct write grant on the convoy table.
select 'no client update grant',
       case when count(*) = 0 then 'ok' else 'CLIENT CAN UPDATE CONVOYS' end
  from information_schema.table_privileges
 where table_schema = 'public' and table_name = 'kitchen_convoys'
   and grantee = 'authenticated' and privilege_type in ('UPDATE','DELETE')

union all
select 'no ledger write grant',
       case when count(*) = 0 then 'ok' else 'CLIENT CAN WRITE THE LEDGER' end
  from information_schema.table_privileges
 where table_schema = 'public' and table_name = 'kitchen_convoy_ledger'
   and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')

union all
select 'guard constraints',
       case when count(*) = 4 then 'ok' else 'MISSING (' || count(*) || '/4)' end
  from pg_constraint
 where conname in ('kitchen_convoys_dishes_chk','kitchen_convoys_state_chk',
                   'kitchen_convoys_time_chk','kitchen_convoys_party_chk');
-- ============================================================================
