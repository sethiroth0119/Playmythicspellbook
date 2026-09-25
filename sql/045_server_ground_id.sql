-- ═══════════════════════════════════════════════════════════════════════════
-- 045 · THE GROUND BELONGS TO THE ACCOUNT, AND THE SERVER SAYS SO
--
-- Asked for: "the game is a full on multiplayer always online game so make sure
-- that every account have their own information and stop tying everyone
-- together as local and make it server side… you can do one more reroll and
-- then send everyone 100,000 cinder as a reward to replace their building cost."
--
-- 🔴 WHERE THE GROUND CAME FROM UNTIL NOW. node-city derived it on the client:
--    the anchor node id when game.anchors happened to be loaded, and the
--    literal 'local-city' when it was not. /src/resmap, /src/water and
--    /src/power all hash that string to place the aquifers, the ore and the
--    oil — so the answer was a race, and because the race usually lost, MOST
--    CITIES IN THE GAME ARE STANDING ON THE SAME SEED. One shared world under
--    everybody, in a game where every account is supposed to have its own.
--
-- ⭐ SO THE SERVER MINTS IT, ONCE, PER CITY. city_state is already keyed
--    (user_id, node_id) — that pair IS the city's identity, and it is the one
--    the server has always used. ground_id is derived from it once and then
--    STORED, so it is a fact about the city rather than a derivation that can
--    be re-run differently later.
--
-- ⚠ STORED, NOT RE-DERIVED, AND THAT IS THE WHOLE POINT. Deriving it live from
--   (user_id, node_id) would look identical and be wrong: city_move_node()
--   exists, so a city's node CAN change, and a live derivation would re-roll
--   the ground under a city that merely relocated. Minted once, the column
--   travels with the row.
--   🔴 A MOVE THAT RECREATES THE ROW RATHER THAN UPDATING IT WOULD LOSE THE
--      COLUMN and the city would re-mint on its new node — a re-roll. That is
--      stated rather than guarded because city_move_node is admin-only and rare;
--      if it ever starts deleting and re-inserting, carry ground_id across.
--
-- ⚠ THIS IS THE ONE AUTHORISED RE-ROLL. Every existing city moves from the
--   shared 'local-city' seed to its own, exactly once, and never again. The
--   client half makes the server's answer outrank its own saved pin for
--   precisely this reason — see cityGroundId() in node-city/index.html.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · the column ────────────────────────────────────────────────────────
alter table public.city_state add column if not exists ground_id text;

-- ── 2 · the mint, server-side and once ────────────────────────────────────
-- Returns the caller's ground id for one of THEIR cities, minting and storing
-- it on first ask. SECURITY DEFINER because it writes a column the player's own
-- RLS policy has no business updating — the ground is not theirs to choose.
create or replace function public.city_ground_id(p_node text)
returns text language plpgsql security definer set search_path to 'public' as $fn$
declare v_uid uuid := auth.uid(); v_id text;
begin
  -- 🔴 NO SESSION, NO ANSWER, AND NEVER A DEFAULT. An anon caller getting a
  --    plausible-looking string back is how the client ends up seeding a world
  --    on something that is not this player's. null means "ask again once you
  --    are signed in", and the client treats it that way.
  if v_uid is null or p_node is null or p_node = '' then return null; end if;

  select ground_id into v_id
    from public.city_state where user_id = v_uid and node_id = p_node;
  if v_id is not null and v_id <> '' then return v_id; end if;

  -- Deterministic so a lost UPDATE cannot produce two different answers for the
  -- same city, and namespaced by version so a future re-roll is a deliberate
  -- act with a new salt rather than an accident.
  v_id := 'cg_' || substr(md5(v_uid::text || ':' || p_node || ':ground-v1'), 1, 20);

  update public.city_state
     set ground_id = v_id
   where user_id = v_uid and node_id = p_node
     and (ground_id is null or ground_id = '');

  -- No row yet (the city has never been saved server-side). The id is still the
  -- right answer — it is a pure function of this account and this node — and the
  -- next call after the first save will store it.
  return v_id;
end; $fn$;

revoke all on function public.city_ground_id(text) from public, anon;
grant execute on function public.city_ground_id(text) to authenticated;

-- ── 3 · the compensation, once per account ────────────────────────────────
-- 🔴 A PER-FAUCET RPC, NOT A wallet_credit CALL FROM THE CLIENT, and that is
--    deliberate. wallet_credit is currently executable by `authenticated` and
--    takes the AMOUNT as an argument, which sql/034 already records as the
--    known hole ("the planned real fix is per-faucet server RPCs, after which
--    wallet_credit is revoked from authenticated"). This faucet takes no
--    arguments at all: the amount is in the function body, so a caller can ask
--    for this grant and cannot ask for a bigger one.
-- ⚠ IDEMPOTENT ON THE LEDGER REF, which is the same lock wallet_credit already
--   uses for outbox replays — the row IS the record that it was paid. Claiming
--   twice returns the same balance and moves nothing.
create or replace function public.claim_ground_reroll_grant()
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid();
  v_ref constant text := 'ground-reroll-v1';
  v_amt constant bigint := 100000;
  v_bal bigint;
begin
  if v_uid is null then return json_build_object('ok', false, 'why', 'not signed in'); end if;

  if exists (select 1 from public.wallet_ledger where user_id = v_uid and ref = v_ref) then
    return json_build_object('ok', true, 'already', true, 'amount', 0);
  end if;

  v_bal := public.wallet_credit(v_amt, 'Ground re-roll compensation — rebuild what the shift cost you', v_ref);

  -- wallet_credit returns the balance whether it credited or refused (a ceiling,
  -- a replay). The ledger is what says which happened, so that is what is read
  -- back rather than trusting the return value.
  if not exists (select 1 from public.wallet_ledger where user_id = v_uid and ref = v_ref) then
    return json_build_object('ok', false, 'why', 'the credit did not land', 'balance', v_bal);
  end if;
  return json_build_object('ok', true, 'already', false, 'amount', v_amt, 'balance', v_bal);
end; $fn$;

revoke all on function public.claim_ground_reroll_grant() from public, anon;
grant execute on function public.claim_ground_reroll_grant() to authenticated;

-- ROLLBACK:
--   drop function if exists public.claim_ground_reroll_grant();
--   drop function if exists public.city_ground_id(text);
--   -- the column is harmless; dropping it would re-roll every city again:
--   -- alter table public.city_state drop column if exists ground_id;
