-- ════════════════════════════════════════════════════════════════════════════
-- 066 · MATCHMAKING, WRITTEN DOWN — the pairing schema leaves the JS string
--
-- ⚠ THIS FILE HAS NOT BEEN APPLIED. NOTHING IN IT HAS RUN ANYWHERE.
--   Nobody in the environment that wrote this file can execute SQL against
--   project ktsiasyjusesawtrwrjc. There is no database connection here, no
--   service-role key, and no migration runner. Pairing behaviour on the live
--   server is EXACTLY what it was before this file existed and stays that way
--   until a human opens
--       https://supabase.com/dashboard/project/ktsiasyjusesawtrwrjc/sql/new
--   pastes this file in, and clicks Run. Until that happens, both bugs
--   described below are still live and still eating real players.
--
-- ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
--   The only thing on earth that can pair two queued players is the
--   try_pair_match() trigger. Its source lived in exactly ONE place in this
--   repo: inside a JavaScript template literal, CLOUD_SQL_SCHEMA, at
--   public/index.html:56674 (function body 56823-56858). It is a comment as
--   far as the running program is concerned. There was no /sql file and no
--   supabase/migrations file for matchmaking_queue, matches, or
--   try_pair_match — so the one server object multiplayer depends on had no
--   migration, no history, and no way to be reviewed as SQL.
--
--   This file carries over ONLY the matchmaking objects from that literal:
--   matchmaking_queue, matches, try_pair_match, trigger_pair_match. It
--   deliberately does NOT carry user_profiles, friends, card_catalog,
--   touch_updated_at, or the storage policies that share that literal. Those
--   sections contain `drop policy if exists` against LIVE tables that this
--   work never intended to touch; re-running them out of a migration file
--   would strip policies off user_profiles and card_catalog for the sake of a
--   matchmaking change. Their home stays CLOUD_SQL_SCHEMA.
--
-- ── 🔴 BUG 1 — THE GHOST AT THE HEAD OF THE QUEUE (no staleness predicate) ──
--   Rows only leave matchmaking_queue three ways: the player is paired, the
--   client calls cloudLeaveMatchmaking(), or the AI-fallback path deletes the
--   row (index.html:182911). Every other exit is a leak — tab closed, browser
--   killed, network dropped, phone slept. Those rows stay in the table for
--   ever.
--
--   try_pair_match then does this:
--
--       order by queued_at asc
--       ...
--       limit 1
--
--   Oldest first. An abandoned row is by definition the oldest row in the
--   band, so it is the FIRST thing the next real player is paired against: a
--   matches row is created, the live player sits in a 'pending' match against
--   a client that will never connect, waits, gets nothing, and drops to
--   solo-vs-AI.
--
--   ⚠ CORRECTED 2026-08-27 (this file said "PINNED at the head permanently"
--     and "poisons its whole MMR band indefinitely" — both overstated, and
--     the paragraph contradicted itself two lines later). The pairing body
--     deletes BOTH rows:  delete ... where user_id in (opp.user_id,
--     new.user_id).  So a ghost is CONSUMED by its first victim. The cost is
--     one real player per ghost, not a permanently poisoned band. That is
--     still worth fixing — a leaky queue means a steady trickle of players
--     whose first search is spent on a corpse — but it is not the death
--     spiral the original wording described, and the staleness predicate
--     below is justified on the honest number.
--
-- ── 🔴 BUG 2 — JUDGED ONCE, NEVER AGAIN (AFTER INSERT is the only trigger) ──
--   trigger_pair_match is `after insert on public.matchmaking_queue`. That is
--   the ONLY moment a row is ever considered for pairing. So the first player
--   into an empty queue is evaluated exactly once, finds nobody, and is never
--   looked at again — not when the second player arrives, not ever. Pairing
--   only works if the SECOND arrival's trigger sees the first. It does, which
--   is why matchmaking works at all, but it means the first player's fate
--   rests entirely on someone else inserting within their 30-second window.
--
--   The fix is mm_try_pair() below: the same pairing body, callable by the
--   waiting player instead of fired by an insert. The client poller
--   (_startMatchmakingPoll, index.html:56110) ticks every 2.5s, and branch (b)
--   of that tick NOW CALLS `Cloud.client.rpc('mm_try_pair')` on every tick, so
--   a waiting player re-evaluates their own position every tick instead of
--   once at insert. That client change has landed; it is driven by
--   .gauntlet/drive-matchmaking.mjs.
--
--   ⚠ WHICH CHANGES NOTHING ABOUT THE PARAGRAPH AT THE TOP OF THIS FILE. This
--   file is still unapplied, so mm_try_pair() does not exist on the server and
--   every one of those rpc calls comes back PGRST202 ("could not find the
--   function ... in the schema cache"). The client records that answer as a
--   DIAGNOSIS and KEEPS CALLING anyway — it does not latch and stop, so a
--   client already sitting on the search screen picks this file up the moment
--   a human applies it, with no page reload. What it also does, once per
--   search and only at the halfway mark, is a delete-then-insert re-queue of
--   its own row: the only lever it has left, because AFTER INSERT is the only
--   trigger there is. That fallback is a workaround for this file being
--   unapplied, not a substitute for it — it re-evaluates the waiting player
--   exactly once more, not every tick, and if the re-INSERT is refused
--   (postgrest-js RESOLVES with { error }; it does not throw) the client
--   un-latches and retries on the next tick, because the DELETE has already
--   landed and a player with no queue row is invisible to the one mechanism
--   above. Bug 2 is only actually fixed when a human runs this file.
--
-- ── ⚠ A CAVEAT THAT WAS FIXED ON THE CLIENT SIDE ────────────────────────────
--   cloudEnterMatchmaking USED TO send `queued_at` from the CLIENT clock,
--   overriding this column's `default now()`. queued_at is what the pairing
--   body sorts on (`order by queued_at asc`) and what the sweep below ages
--   rows out on, so a slow phone jumped to the head of its whole MMR band and
--   a fast one was swept as stale the instant it arrived. The client no longer
--   sends the key at all — neither cloudEnterMatchmaking's insert nor the poll
--   tick's re-queue insert — so Postgres stamps it from the one clock every
--   player in the queue shares. Asserted by .gauntlet/drive-matchmaking.mjs.
--   Keep it that way: do NOT add queued_at back to either client payload.
--
--   And: the sweep is a DELETE over a range, so two concurrent sweeps can take
--   row locks in opposite orders and deadlock. Postgres aborts one of them,
--   which for the trigger means one player's INSERT errors and their client
--   retries on the next poll tick — survivable, but if that ever shows up in
--   the logs, move the sweep to a pg_cron job and leave only the `queued_at >`
--   bound in the two SELECTs.
--
-- Idempotent and re-runnable: every create is `if not exists` / `or replace`,
-- every policy is dropped before it is created, the trigger is dropped before
-- it is created. Ends with a verify query. Contains no DROP TABLE, no
-- TRUNCATE, and no DELETE without a WHERE.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1. matchmaking_queue — one row per user looking for a match
--    (carried over verbatim from CLOUD_SQL_SCHEMA, index.html:56716-56733)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.matchmaking_queue (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  mode       text not null default 'ranked',
  mmr        integer not null default 1000,
  faction_id text,
  hero_id    text,
  queued_at  timestamptz default now()
);

-- Queue needs a deck_json column to store each player's chosen deck so the
-- matchmaker can copy it onto the match row.
-- (Hoisted above the function that reads it — in CLOUD_SQL_SCHEMA this ALTER
--  sits AFTER try_pair_match, which is only survivable because plpgsql does
--  not resolve table columns at CREATE FUNCTION time. Ordering it correctly
--  costs nothing and stops a first-run reader from thinking deck_json is
--  missing.)
alter table public.matchmaking_queue add column if not exists deck_json jsonb default '{}'::jsonb;

alter table public.matchmaking_queue enable row level security;

drop policy if exists "matchmaking_self_all" on public.matchmaking_queue;
create policy "matchmaking_self_all" on public.matchmaking_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Players can also peek at the queue (for "X players in queue" displays).
drop policy if exists "matchmaking_anyone_count" on public.matchmaking_queue;
create policy "matchmaking_anyone_count" on public.matchmaking_queue
  for select using (auth.role() = 'authenticated');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. matches — completed + active matches
--    (carried over verbatim from CLOUD_SQL_SCHEMA, index.html:56734-56765)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  player1_id  uuid not null references auth.users(id),
  player2_id  uuid not null references auth.users(id),
  winner_id   uuid references auth.users(id),
  hero1_id    text,
  hero2_id    text,
  deck1       jsonb,
  deck2       jsonb,
  turns       integer,
  rr1_delta   integer default 0,
  rr2_delta   integer default 0,
  ap1_delta   integer default 0,
  ap2_delta   integer default 0,
  replay      jsonb,
  status      text default 'pending',  -- pending | active | complete
  created_at  timestamptz default now()
);

-- DC-win marker on matches so admins can audit forfeit games.
alter table public.matches add column if not exists dc_win boolean default false;

alter table public.matches enable row level security;
-- Either participant can SELECT the match. INSERTs come from the matchmaker
-- (Edge Function later). For now permit authenticated inserts gated by:
drop policy if exists "matches_participants_select" on public.matches;
create policy "matches_participants_select" on public.matches
  for select using (auth.uid() = player1_id or auth.uid() = player2_id);
drop policy if exists "matches_participants_update" on public.matches;
create policy "matches_participants_update" on public.matches
  for update using (auth.uid() = player1_id or auth.uid() = player2_id);
-- Insert allowed only when the player listing themselves as player1 OR player2.
drop policy if exists "matches_self_insert" on public.matches;
create policy "matches_self_insert" on public.matches
  for insert with check (auth.uid() = player1_id or auth.uid() = player2_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. try_pair_match — the AFTER-INSERT matchmaker
--
--    Body is the one from index.html:56823-56853, changed in exactly TWO
--    places, both marked 🔴 BUG 1 below. The 500-point MMR band, the mode
--    equality, the FOR UPDATE SKIP LOCKED, the insert column list and the
--    two-row cleanup delete are untouched.
-- ════════════════════════════════════════════════════════════════════════════

-- 7) AUTO-PAIRING TRIGGER — server-side matchmaker. When a player INSERTs a
--    queue row, this finds an opponent within their MMR band and creates a
--    matches row pairing them. Both clients hear about the match via the
--    realtime channel they subscribed to in cloudEnterMatchmaking().
create or replace function public.try_pair_match()
returns trigger language plpgsql security definer as $$
declare
  opp record;
  new_match_id uuid;
begin
  -- 🔴 BUG 1 (the ghost at the head of the queue): abandoned rows never leave
  -- the table, and `order by queued_at asc` below picks the OLDEST row, so a
  -- dead row is the first thing the next real player is paired against — that
  -- player burns their search on a client that will never connect. The delete
  -- at the end of this function consumes the ghost along with the live row, so
  -- it costs ONE player per ghost rather than poisoning the band (corrected
  -- 2026-08-27; the header used to overstate this). Sweep before we look, so
  -- the SELECT can never see a row this statement was about to remove.
  delete from public.matchmaking_queue where queued_at < now() - interval '45 seconds';

  -- Lock the queue row (avoid race when two players hit insert at the same time)
  select * into opp
  from public.matchmaking_queue
  where user_id <> new.user_id
    and mode = new.mode
    and abs(mmr - new.mmr) < 500
    -- 🔴 BUG 1, second half: the sweep above and this SELECT are separate
    -- statements, so a row can age past the cutoff between them, and a
    -- concurrent inserter's sweep can be rolled back. The bound here is what
    -- actually guarantees the opponent we pair with is live. 45s is chosen to
    -- sit ABOVE MATCHMAKING_AI_FALLBACK_MS (30000 → 30s, index.html:182865):
    -- a row younger than the fallback window belongs to a player who is still
    -- watching the search screen. Shortening this below 30s would start
    -- discarding players who are still waiting.
    and queued_at > now() - interval '45 seconds'
  order by queued_at asc
  for update skip locked
  limit 1;

  if found then
    -- Create the match. Both players have realtime subscriptions on the
    -- matches table filtered by player1_id=eq.self OR player2_id=eq.self.
    insert into public.matches
      (player1_id, player2_id, hero1_id, hero2_id, deck1, deck2, status)
    values
      (opp.user_id, new.user_id, opp.hero_id, new.hero_id, opp.deck_json, new.deck_json, 'pending')
    returning id into new_match_id;

    -- Remove both players from the queue so they aren't matched again.
    delete from public.matchmaking_queue
      where user_id in (opp.user_id, new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists trigger_pair_match on public.matchmaking_queue;
create trigger trigger_pair_match
  after insert on public.matchmaking_queue
  for each row execute function public.try_pair_match();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. mm_try_pair — 🔴 BUG 2: the same pairing body, for the CALLER
--
--    trigger_pair_match is AFTER INSERT only, so a queue row is judged once,
--    at the instant it is written, and never again. The first player into an
--    empty band is therefore never re-evaluated no matter how long they wait.
--    This function is the same matchmaker addressed to whoever calls it, so a
--    waiting player can ask again on every poll tick.
--
--    SECURITY DEFINER because it must insert into `matches` on behalf of BOTH
--    players and delete the OPPONENT's queue row — neither is permitted by the
--    self-scoped RLS policies above. It is scoped by auth.uid() and nothing
--    else: there is no parameter, so a caller cannot aim it at another
--    account. search_path is pinned because a SECURITY DEFINER function that
--    inherits the caller's search_path can be pointed at attacker-owned
--    tables of the same name.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.mm_try_pair()
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  me  record;
  opp record;
  new_match_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- 🔴 BUG 1 (the ghost at the head of the queue): same sweep as the trigger,
  -- and it must run BEFORE anything is selected. Note this can remove the
  -- CALLER's own row — that is correct: a player queued longer than 45s has
  -- already passed MATCHMAKING_AI_FALLBACK_MS (30s) and been dropped to
  -- solo-vs-AI by the client, so pairing them would create a match nobody
  -- shows up to. That is the same dead match bug 1 is about, seen from the
  -- other side.
  delete from public.matchmaking_queue where queued_at < now() - interval '45 seconds';

  select * into me
  from public.matchmaking_queue
  where user_id = auth.uid()
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_queued');
  end if;

  -- Lock the queue row (avoid race when two players hit insert at the same time)
  select * into opp
  from public.matchmaking_queue
  where user_id <> me.user_id
    and mode = me.mode
    and abs(mmr - me.mmr) < 500
    -- 🔴 BUG 1, second half — see try_pair_match above for why 45s and why the
    -- bound is needed in addition to the sweep.
    and queued_at > now() - interval '45 seconds'
  order by queued_at asc
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'paired', false);
  end if;

  -- Same column list and same player1/player2 assignment as the trigger, so a
  -- match created by a poll tick is indistinguishable from one created by an
  -- insert. Both clients read it out of `matches` the same way.
  insert into public.matches
    (player1_id, player2_id, hero1_id, hero2_id, deck1, deck2, status)
  values
    (opp.user_id, me.user_id, opp.hero_id, me.hero_id, opp.deck_json, me.deck_json, 'pending')
  returning id into new_match_id;

  -- Remove both players from the queue so they aren't matched again.
  delete from public.matchmaking_queue
    where user_id in (opp.user_id, me.user_id);

  return jsonb_build_object('ok', true, 'paired', true, 'match_id', new_match_id);
end $$;

-- anon must never reach a SECURITY DEFINER matchmaker: it inserts rows into
-- `matches` naming two auth.users ids, and an unauthenticated caller has no
-- auth.uid() to be scoped by.
revoke execute on function public.mm_try_pair() from anon;
revoke execute on function public.mm_try_pair() from public;
grant execute on function public.mm_try_pair() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
--
-- Run this AFTER the file. Against the function body that is on the server
-- today — the one from CLOUD_SQL_SCHEMA, which has no queued_at bound, no
-- sweep and no companion RPC — rows 1, 2 and 3 return 'false' and row 4
-- returns '0'. If they already say true before you run this file, then either
-- someone else applied it or you are not looking at ktsiasyjusesawtrwrjc.
-- ════════════════════════════════════════════════════════════════════════════
select 'try_pair_match bounds the opponent by queued_at' as check,
       coalesce((select (pg_get_functiondef(oid) ilike '%queued_at > now() - interval ''45 seconds''%')::text
                   from pg_proc
                  where proname = 'try_pair_match'
                    and pronamespace = 'public'::regnamespace), 'MISSING') as got,
       'true' as want
union all
select 'try_pair_match sweeps stale rows',
       coalesce((select (pg_get_functiondef(oid) ilike '%delete from public.matchmaking_queue where queued_at <%')::text
                   from pg_proc
                  where proname = 'try_pair_match'
                    and pronamespace = 'public'::regnamespace), 'MISSING'),
       'true'
union all
select 'mm_try_pair exists',
       (to_regprocedure('public.mm_try_pair()') is not null)::text,
       'true'
union all
select 'mm_try_pair is SECURITY DEFINER with a pinned search_path',
       coalesce((select (prosecdef and proconfig::text ilike '%search_path=public%')::text
                   from pg_proc
                  where proname = 'mm_try_pair'
                    and pronamespace = 'public'::regnamespace), 'MISSING'),
       'true'
union all
select 'anon cannot execute mm_try_pair',
       coalesce((select has_function_privilege('anon', oid, 'EXECUTE')::text
                   from pg_proc
                  where proname = 'mm_try_pair'
                    and pronamespace = 'public'::regnamespace), 'MISSING'),
       'false'
union all
select 'authenticated can execute mm_try_pair',
       coalesce((select has_function_privilege('authenticated', oid, 'EXECUTE')::text
                   from pg_proc
                  where proname = 'mm_try_pair'
                    and pronamespace = 'public'::regnamespace), 'MISSING'),
       'true'
union all
select 'RLS on both matchmaking tables',
       (select count(*)::text from pg_class
         where oid in (to_regclass('public.matchmaking_queue'), to_regclass('public.matches'))
           and relrowsecurity),
       '2'
union all
select 'ghosts still sitting in the queue right now',
       (select count(*)::text from public.matchmaking_queue
         where queued_at < now() - interval '45 seconds'),
       '0 after this file runs; whatever it says before is the size of the bug';
