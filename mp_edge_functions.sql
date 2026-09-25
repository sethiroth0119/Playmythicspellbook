-- ============================================================================
-- 🛡️ mp_edge_functions.sql — server-authoritative multiplayer.
-- ----------------------------------------------------------------------------
-- Adds the columns + SECURITY DEFINER RPCs that the two Edge Functions
-- (mp_resolve_match, mp_end_turn) depend on. The Edge Functions can call
-- these RPCs with the user's JWT (so auth.uid() is the real caller) and they
-- enforce all the race-protection / participant checks the client used to do.
--
-- Run this once in the Supabase SQL editor AFTER api.sql is already applied
-- (matches table must exist).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Augment the matches table with the fields the Edge Functions need.
--    All ADD COLUMN IF NOT EXISTS so re-running this script is harmless.
-- ---------------------------------------------------------------------------
alter table public.matches
  add column if not exists current_player_id uuid references auth.users(id),
  add column if not exists turn_number       integer not null default 1,
  add column if not exists last_action_at    timestamptz not null default now(),
  add column if not exists state_snapshot    jsonb,
  add column if not exists end_reason        text;       -- 'normal' | 'disconnect' | 'concede' | 'timeout'

-- Helpful index — Edge Functions look matches up by id constantly.
create index if not exists matches_active_idx on public.matches (status, last_action_at)
  where status <> 'complete';

-- ---------------------------------------------------------------------------
-- 2) mp_resolve_match — race-safe winner_id arbitration.
--    Replaces the client-side "UPDATE … WHERE winner_id IS NULL" with a
--    server-side version that ALSO validates:
--      • caller is one of the two participants
--      • claimed winner is one of the two participants
--    Returns the authoritative winner_id even when this caller lost the race.
-- ---------------------------------------------------------------------------
create or replace function public.mp_resolve_match(
  p_match_id    uuid,
  p_winner_id   uuid,
  p_turns       integer default 0,
  p_end_reason  text    default 'normal'
)
returns table(
  ok           boolean,
  winner_id    uuid,
  we_won_race  boolean,
  reason       text
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_match     public.matches;
  v_updated   public.matches;
begin
  if v_uid is null then
    return query select false, null::uuid, false, 'not_signed_in'::text; return;
  end if;
  if p_match_id is null or p_winner_id is null then
    return query select false, null::uuid, false, 'bad_input'::text; return;
  end if;

  -- Pull the row once so we can validate participants.
  select * into v_match from public.matches where id = p_match_id;
  if v_match.id is null then
    return query select false, null::uuid, false, 'match_not_found'::text; return;
  end if;

  -- Caller must be a participant (else they have no business resolving it).
  if v_uid <> v_match.player1_id and v_uid <> v_match.player2_id then
    return query select false, v_match.winner_id, false, 'not_participant'::text; return;
  end if;

  -- Claimed winner must also be a participant — no third-party victories.
  if p_winner_id <> v_match.player1_id and p_winner_id <> v_match.player2_id then
    return query select false, v_match.winner_id, false, 'bad_winner'::text; return;
  end if;

  -- 🛡️ Atomic write — only succeeds if winner_id is STILL null. This is the
  -- moment-of-truth race gate. Postgres serializes UPDATEs on a given row so
  -- exactly one caller wins it; the other gets 0 rows back.
  update public.matches
     set winner_id     = p_winner_id,
         status        = 'complete',
         turns         = greatest(coalesce(p_turns, 0), coalesce(turn_number, 0)),
         end_reason    = coalesce(p_end_reason, 'normal'),
         last_action_at = now()
   where id = p_match_id
     and winner_id is null
   returning * into v_updated;

  if v_updated.id is not null then
    return query select true, v_updated.winner_id, true, ''::text; return;
  end if;

  -- We lost the race — re-read the authoritative result and return it.
  select * into v_match from public.matches where id = p_match_id;
  return query select true, v_match.winner_id, false, 'already_resolved'::text;
end$$;
grant execute on function public.mp_resolve_match(uuid, uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) mp_end_turn — server-side turn sequencer.
--    Atomic check: the caller must currently be the active player, AND the
--    turn-number they claim to be ending must match what the server has.
--    On success: flips current_player_id to the opponent, increments
--    turn_number, stamps last_action_at, optionally stores a state snapshot.
--    On failure: returns the authoritative state so the client can resync.
--
--    If the snapshot carries gameOver === 'player' or 'ai', this function
--    ALSO finalizes winner_id atomically (so a DoT-death at end-of-turn
--    closes the match in the same round-trip).
-- ---------------------------------------------------------------------------
create or replace function public.mp_end_turn(
  p_match_id        uuid,
  p_expected_turn   integer,
  p_state_snapshot  jsonb default null,
  p_gameover_winner uuid  default null     -- null = turn just passes; uuid = end-of-turn DoT killed someone
)
returns table(
  ok                 boolean,
  current_player_id  uuid,
  turn_number        integer,
  winner_id          uuid,
  reason             text
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_match   public.matches;
  v_opp     uuid;
  v_updated public.matches;
begin
  if v_uid is null then
    return query select false, null::uuid, 0, null::uuid, 'not_signed_in'::text; return;
  end if;
  if p_match_id is null or p_expected_turn is null then
    return query select false, null::uuid, 0, null::uuid, 'bad_input'::text; return;
  end if;

  -- Lock the row for the duration of this transaction so two end-turn
  -- attempts can't both pass the same check. FOR UPDATE blocks concurrent
  -- writers on this match until we commit/return.
  select * into v_match from public.matches where id = p_match_id for update;
  if v_match.id is null then
    return query select false, null::uuid, 0, null::uuid, 'match_not_found'::text; return;
  end if;

  -- Caller must be a participant.
  if v_uid <> v_match.player1_id and v_uid <> v_match.player2_id then
    return query select false, v_match.current_player_id, v_match.turn_number, v_match.winner_id, 'not_participant'::text; return;
  end if;

  -- Match already over — no further turn changes allowed.
  if v_match.winner_id is not null or v_match.status = 'complete' then
    return query select false, v_match.current_player_id, v_match.turn_number, v_match.winner_id, 'match_already_ended'::text; return;
  end if;

  -- First-ever turn pass: current_player_id may still be NULL because the
  -- match row was inserted before this column was populated. Adopt the caller
  -- as the active player (they're the one who just played turn 1).
  if v_match.current_player_id is null then
    v_match.current_player_id := v_uid;
  end if;

  -- Caller must currently hold the turn.
  if v_match.current_player_id <> v_uid then
    return query select false, v_match.current_player_id, v_match.turn_number, v_match.winner_id, 'not_your_turn'::text; return;
  end if;

  -- Turn number check — protects against stale duplicate end-turn packets,
  -- but FORGIVES the case where the client's expected is ahead of ours
  -- (e.g. SQL was applied mid-match → existing row has turn_number=1 even
  -- though both clients have been playing for many rounds). In that case
  -- accept the client's number as authoritative and catch the server up.
  --   • expected == server  → normal path
  --   • expected >  server  → server fell behind, adopt client's value
  --   • expected <  server  → client is stale, reject (their UI is behind)
  if p_expected_turn < coalesce(v_match.turn_number, 1) then
    return query select false, v_match.current_player_id, v_match.turn_number, v_match.winner_id, 'turn_stale'::text; return;
  end if;
  if p_expected_turn > coalesce(v_match.turn_number, 1) then
    -- Catch up. The race-safety still holds via current_player_id check above.
    v_match.turn_number := p_expected_turn;
  end if;

  v_opp := case when v_uid = v_match.player1_id then v_match.player2_id else v_match.player1_id end;

  -- 🏁 End-of-turn DoT death path — finalize winner_id in the same write.
  if p_gameover_winner is not null then
    if p_gameover_winner <> v_match.player1_id and p_gameover_winner <> v_match.player2_id then
      return query select false, v_match.current_player_id, v_match.turn_number, v_match.winner_id, 'bad_winner'::text; return;
    end if;
    update public.matches
       set winner_id        = p_gameover_winner,
           status           = 'complete',
           turn_number      = v_match.turn_number + 1,
           current_player_id = v_opp,
           state_snapshot   = coalesce(p_state_snapshot, state_snapshot),
           last_action_at   = now(),
           end_reason       = 'normal',
           turns            = v_match.turn_number + 1
     where id = p_match_id
       and winner_id is null   -- race-gate just in case
     returning * into v_updated;
    if v_updated.id is not null then
      return query select true, v_updated.current_player_id, v_updated.turn_number, v_updated.winner_id, ''::text; return;
    end if;
    -- Race: somebody else closed it. Return the authoritative row.
    select * into v_match from public.matches where id = p_match_id;
    return query select true, v_match.current_player_id, v_match.turn_number, v_match.winner_id, 'already_resolved'::text; return;
  end if;

  -- Normal turn-pass — flip the active player and bump the counter.
  update public.matches
     set current_player_id = v_opp,
         turn_number      = v_match.turn_number + 1,
         state_snapshot   = coalesce(p_state_snapshot, state_snapshot),
         last_action_at   = now()
   where id = p_match_id
   returning * into v_updated;

  return query select true, v_updated.current_player_id, v_updated.turn_number, v_updated.winner_id, ''::text;
end$$;
grant execute on function public.mp_end_turn(uuid, integer, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) mp_init_match — call this right after the matches row is created so
--    current_player_id is populated with the opener. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.mp_init_match(
  p_match_id      uuid,
  p_opener_id     uuid
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_m   public.matches;
begin
  if v_uid is null or p_match_id is null or p_opener_id is null then return false; end if;
  select * into v_m from public.matches where id = p_match_id;
  if v_m.id is null then return false; end if;
  if v_uid <> v_m.player1_id and v_uid <> v_m.player2_id then return false; end if;
  if p_opener_id <> v_m.player1_id and p_opener_id <> v_m.player2_id then return false; end if;
  -- Only ever set it once — the opener is decided at match-start.
  update public.matches
     set current_player_id = p_opener_id,
         turn_number       = greatest(coalesce(turn_number, 1), 1),
         last_action_at    = now()
   where id = p_match_id
     and current_player_id is null;
  return true;
end$$;
grant execute on function public.mp_init_match(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Realtime — make sure matches row updates are broadcast. Both clients
--    subscribe via Postgres Changes on filter id=eq.<matchId> so they hear
--    about winner_id / current_player_id transitions even if the realtime
--    broadcast channel hiccups.
-- ---------------------------------------------------------------------------
do $$
begin
  -- Add matches to the realtime publication if not already there.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches'
  ) then
    execute 'alter publication supabase_realtime add table public.matches';
  end if;
exception when others then
  -- Publication may be managed differently in this project — swallow.
  null;
end$$;
