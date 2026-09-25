-- ════════════════════════════════════════════════════════════════════════════
-- 068 · city_claim_node MUST NOT ADOPT ONTO SOMEBODY ELSE'S NODE
--
-- ⚠ NOT APPLIED. Nobody in this environment can run this file — there is no
--   database connection here and no credential to make one. Until a human runs
--   it against the live project, `city_claim_node` on the server is EXACTLY the
--   body sql/065 installed and this file has changed nothing. The client-side
--   half of this fix (public/index.html, _cityClaimNode) is the only part that
--   is live.
--
-- ⚠ NUMBERING: sql/067_market_never_vanishes.sql already exists. These two are
--   unrelated (market vs city) and both idempotent, so the order they are run
--   in does not matter — but a human tidying the directory should renumber one
--   of them.
--
-- ── THE BUG ────────────────────────────────────────────────────────────────
--
--   065 made node_id half of city_state's primary key, and gave the client
--   city_claim_node() so that a player's one existing (sentinel-keyed) city
--   moves onto the first real node they open instead of vanishing.
--
--   But "the node they open" is not necessarily THEIR node. index.html's
--   _openNodeCity deliberately supports a CONNECTED SETTLER opening a node that
--   belongs to another player — it says so at the guard: "there is one city per
--   USER, not per node". App._cityNodeId is therefore whatever node is being
--   LOOKED AT, _cityNodeKey() hands that straight to the read, the read misses
--   on (me, theirNode), and the client calls city_claim_node('their-node').
--
--   The 065 body keys entirely on auth.uid(). It asks nothing at all about who
--   owns p_node. So it happily re-keys the settler's ONLY city onto a node id
--   they do not own — and because the branch consumes the sentinel row, it is
--   ONE-WAY AND ONE-TIME (065's own header). The player comes home to an empty
--   grid and cannot get the city back by retrying.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
--   Before the re-key, look p_node up in tw_node_owners. If there is a row and
--   it names somebody other than the caller, answer
--
--       { ok: true, action: 'new_city', reason: 'not_your_node' }
--
--   — never 'adopted'. 'new_city' is already the "there was nothing to adopt"
--   answer the client understands, so nothing downstream needs to change: the
--   client treats it as a miss and the sentinel row stays exactly where it is,
--   still adoptable by the player's own node later.
--
-- ⚠ NO OWNERSHIP ROW STILL ADOPTS, AND THAT IS DELIBERATE.
--   Most nodes have no tw_node_owners row at all, and unowned/unknown is the
--   overwhelmingly common case for a real settler. 065's migration-hazard note
--   is explicit that handing a player an empty grid while their city sits one
--   key away is WORSE than the bug it is guarding, so the test is POSITIVE
--   PROOF of a foreign owner — an existing row, with a non-null user_id, that
--   is not auth.uid(). Missing row, null owner: adopt.
--
--   This is the same rule the client half applies (public/index.html,
--   _cityClaimNode: it refuses only when _twNodeOwnerUser(nodeKey) resolves to a
--   user_id that is not mine, and adopts on a cold or unloaded cache). The two
--   halves are independent — either alone closes the hole — but they MUST agree
--   on the unknown-owner case, or the player gets the toast without the re-key
--   or the re-key without the toast.
--
-- ⚠ SECURITY DEFINER IS LOAD-BEARING FOR THE LOOKUP. tw_node_owners' select
--   policy (sql/044) is `to authenticated using (true)`, so today a caller
--   could see the row anyway — but the check must not silently start passing if
--   that policy is ever tightened. Running as definer, it does not.
--
-- ⚠ THE HISTORY INSERT IS NOT DOUBLE-FIRED. The refusal RETURNS before the
--   update, so the single `insert into city_state_history` below is reached on
--   exactly the same path as in 065, once, and only after a real re-key.
--   city_state_history is append-only; nothing here deletes from it.
--
-- Idempotent and re-runnable: it is a `create or replace function` on the same
-- signature 065 declared, plus the same revoke/grant pair. Ends with a verify
-- query that FAILS against the 065 body.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. PRECONDITIONS ────────────────────────────────────────────────────────
-- Fail loudly and early rather than installing a function whose body cannot
-- resolve tw_node_owners at call time (plpgsql resolves it on first execution,
-- so a missing table would surface as a runtime error in front of a player).
do $$
begin
  if to_regclass('public.tw_node_owners') is null then
    raise exception '067: public.tw_node_owners does not exist - run the territory-wars schema first';
  end if;
  if to_regprocedure('public.city_claim_node(text)') is null then
    raise exception '067: public.city_claim_node(text) does not exist - run sql/065_city_node_key.sql first';
  end if;
  if to_regprocedure('public.city_tile_count(jsonb)') is null then
    raise exception '067: public.city_tile_count(jsonb) does not exist - run sql/065_city_node_key.sql first';
  end if;
end $$;

-- ── 1. THE FUNCTION ─────────────────────────────────────────────────────────
-- Whole body restated from 065 (create or replace has no partial form). The
-- ONLY change is the `not_your_node` block, marked below, sitting immediately
-- before the update that re-keys the row.
create or replace function public.city_claim_node(p_node text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sent constant text := '00000000-0000-0000-0000-000000000000';
  v_rows int; v_tiles int; v_state jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_node is null or p_node = '' then return jsonb_build_object('ok', false, 'reason', 'no_node'); end if;

  -- Already keyed correctly. The overwhelmingly common case after migration.
  if exists (select 1 from public.city_state where user_id = v_uid and node_id = p_node) then
    return jsonb_build_object('ok', true, 'action', 'none');
  end if;

  -- Opening the original city itself: nothing to adopt, the sentinel IS the key.
  if p_node = v_sent then
    return jsonb_build_object('ok', true, 'action', 'none');
  end if;

  select count(*) into v_rows from public.city_state where user_id = v_uid;
  if v_rows <> 1 then
    return jsonb_build_object('ok', true, 'action', 'new_city', 'rows', v_rows);
  end if;

  select state, public.city_tile_count(state) into v_state, v_tiles
    from public.city_state where user_id = v_uid and node_id = v_sent;

  if v_state is null then
    return jsonb_build_object('ok', true, 'action', 'new_city');
  end if;
  -- An empty sentinel row is not a city worth adopting; let this node start clean.
  if coalesce(v_tiles, 0) = 0 then
    return jsonb_build_object('ok', true, 'action', 'new_city', 'reason', 'sentinel_empty');
  end if;

  -- ══ 067 · THE OWNER CHECK. Everything above this line is 065 verbatim. ════
  -- A connected settler opens a node they do not own; their read misses; the
  -- client asks to claim. Re-keying here would move their ONLY city onto
  -- somebody else's node, one-way and one-time. Refuse, and leave the sentinel
  -- row untouched so their own node can still adopt it later.
  -- POSITIVE PROOF ONLY: an existing row naming a DIFFERENT non-null user. No
  -- row, or a null user_id, falls through and adopts, because an empty grid is
  -- the worse outcome (065's header) and because the client half decides the
  -- unknown case the same way.
  if exists (
    select 1 from public.tw_node_owners o
     where o.node_id = p_node
       and o.user_id is not null
       and o.user_id <> v_uid
  ) then
    return jsonb_build_object('ok', true, 'action', 'new_city', 'reason', 'not_your_node', 'node', p_node);
  end if;
  -- ══ end 067 ══════════════════════════════════════════════════════════════

  update public.city_state
     set node_id = p_node, updated_at = now()
   where user_id = v_uid and node_id = v_sent;

  insert into public.city_state_history
    (user_id, node_id, state, reason, tiles, bytes)
  values (v_uid, p_node, v_state, 'claim_node', v_tiles, length(v_state::text));

  return jsonb_build_object('ok', true, 'action', 'adopted', 'tiles', v_tiles, 'node', p_node);
end $$;

-- ── 2. GRANTS (this file ships its own; it does not lean on 065's) ──────────
revoke all on function public.city_claim_node(text) from public, anon;
grant execute on function public.city_claim_node(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ────────────────────────────────────────────────────────────────────────────
-- Every row below is FALSE against the 065 body. Reading prosrc is the only way
-- to assert the ORDER of two statements inside a function without a live
-- session to call it from, and order is the whole point: an owner check that
-- ran after the update would have already moved the city.
-- ════════════════════════════════════════════════════════════════════════════
with src as (
  select prosrc as s
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'city_claim_node'
     and pg_get_function_identity_arguments(p.oid) = 'text'
)
select 'function exists' as check,
       (select (count(*) = 1)::text from src) as got, 'true' as want
union all
select 'refuses a foreign node (not_your_node present)',
       (select (s like '%not_your_node%')::text from src), 'true'
union all
select 'it consults tw_node_owners',
       (select (s like '%tw_node_owners%')::text from src), 'true'
union all
select 'the owner check runs BEFORE the re-key',
       (select (position('not_your_node' in s) > 0
                and position('not_your_node' in s) < position('set node_id = p_node' in s))::text
          from src), 'true'
union all
select 'the history insert still fires exactly once',
       (select ((length(s) - length(replace(s, 'city_state_history', ''))) / length('city_state_history') = 1)::text
          from src), 'true'
union all
select 'an unowned node can still adopt (adopted branch intact)',
       (select (s like '%''adopted''%')::text from src), 'true'
union all
select 'execute granted to authenticated only',
       (select (has_function_privilege('authenticated', 'public.city_claim_node(text)', 'execute')
                and not has_function_privilege('anon', 'public.city_claim_node(text)', 'execute'))::text),
       'true';
