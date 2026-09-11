-- ════════════════════════════════════════════════════════════════════════════
-- 071 · THE SERVER OWNS THE PROFILE — stage 1 of moving authority off the client
--
-- ── THE PREMISE THAT HAS TO CHANGE ────────────────────────────────────────
--
--   The game is local-first. State lives in the browser, and cloudSyncProfile()
--   upserts the WHOLE object every save — heroes, units, decks, forge, wallet,
--   all of it, every time. The server has no opinion; it stores what it is told.
--
--   That single fact is the whole bug family. A browser that booted empty is
--   able to SAY "this account has nothing", and the row obeys. Every fix in the
--   client so far — the hydration gate, the stale-cloud guard, the foreign
--   profile reset, force-restore-on-sign-in, and 070's repair trigger — is
--   someone stopping a blank client from being BELIEVED. None of them stops it
--   being ABLE TO SPEAK.
--
--   070 made the damage survivable. This file makes the sentence unsayable:
--   the client stops sending state and starts sending CHANGES. A patch that
--   omits `heroes` cannot clear `heroes`, because absence now means "I am not
--   changing this" instead of "this is empty". An empty client sends {} and {}
--   changes nothing.
--
-- ── WHAT THIS IS AND IS NOT ───────────────────────────────────────────────
--
--   IS:     the server owning the profile row. Merge happens in Postgres,
--           under auth.uid(), with a version the client cannot forge.
--   IS NOT: server-authoritative COMBAT or ECONOMY. Awarding a card, settling
--           a battle and debiting a wallet still happen client-side and are
--           still trusted. That is stage 2 and it is a much bigger job — it
--           means an RPC per mutation, not one merge function. Nothing here
--           pretends otherwise.
--
--   ⚠ ADDITIVE AND REVERSIBLE. Nothing existing is dropped or altered. The old
--     whole-object upsert keeps working exactly as it does today, so this can
--     go on the database before a single line of client changes, and the client
--     can move over one call at a time. 070's trigger stays armed underneath as
--     the backstop for anything still using the old path.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · A VERSION THE CLIENT CANNOT FORGE ─────────────────────────────────
-- Monotonic, server-assigned. Two devices can now be ORDERED, which is the
-- thing "whose timestamp is newer" could never do reliably across machines
-- with different clocks — the exact problem the client comments describe as
-- "pending is not a time machine".
alter table public.user_profiles
  add column if not exists version bigint not null default 0;

-- ── 2 · READ ──────────────────────────────────────────────────────────────
-- The client's fetch, but the server decides what your row is. Returns the
-- version alongside, which the client must echo back on its next write.
create or replace function public.profile_get()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r public.user_profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into r from public.user_profiles where user_id = auth.uid();
  if not found then return jsonb_build_object('exists', false, 'version', 0); end if;
  return jsonb_build_object(
    'exists', true, 'version', r.version,
    'display_name', r.display_name, 'records', r.records, 'competitive', r.competitive,
    'heroes', r.heroes, 'units', r.units, 'gems', r.gems, 'sovereigns', r.sovereigns,
    'deck_history', r.deck_history, 'decks', r.decks, 'settings', r.settings,
    'forge', r.forge, 'wallet_seq', r.wallet_seq, 'updated_at', r.updated_at);
end;
$fn$;

-- ── 3 · WRITE — THE ONE THAT MATTERS ──────────────────────────────────────
--
--   p_patch  : ONLY the fields that changed. A key that is absent is left
--              alone. This is the whole point of the file.
--   p_base   : the version the client last read. If the server has moved on
--              (the other device wrote), the patch is STILL APPLIED — losing a
--              real edit to win an argument about ordering is the worse
--              outcome — but the reply carries stale=true and the full current
--              row, so the client can reconcile instead of guessing.
--
--   ⚠ WHITELISTED KEYS ONLY. A patch naming anything else is ignored rather
--     than erroring, so a future client sending an unknown field degrades to a
--     no-op instead of failing every save.
--   ⚠ NO user_id IN THE PATCH, EVER. The row is chosen by auth.uid() and
--     nothing in the payload can redirect it. This is why it is SECURITY
--     DEFINER with a pinned search_path.
create or replace function public.profile_apply(p_patch jsonb, p_base bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  uid uuid := auth.uid();
  cur public.user_profiles%rowtype;
  was_stale boolean := false;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch must be a json object';
  end if;

  select * into cur from public.user_profiles where user_id = uid;
  if not found then
    insert into public.user_profiles (user_id) values (uid);
    select * into cur from public.user_profiles where user_id = uid;
  end if;

  if p_base is not null and p_base < cur.version then was_stale := true; end if;

  -- An empty patch is a legitimate no-op: it is exactly what an empty client
  -- now produces, and it must change nothing.
  update public.user_profiles set
    display_name = case when p_patch ? 'display_name' then p_patch->>'display_name' else display_name end,
    records      = case when p_patch ? 'records'      then p_patch->'records'       else records end,
    competitive  = case when p_patch ? 'competitive'  then p_patch->'competitive'   else competitive end,
    heroes       = case when p_patch ? 'heroes'       then p_patch->'heroes'        else heroes end,
    units        = case when p_patch ? 'units'        then p_patch->'units'         else units end,
    decks        = case when p_patch ? 'decks'        then p_patch->'decks'         else decks end,
    deck_history = case when p_patch ? 'deck_history' then p_patch->'deck_history'  else deck_history end,
    settings     = case when p_patch ? 'settings'     then p_patch->'settings'      else settings end,
    forge        = case when p_patch ? 'forge'        then p_patch->'forge'         else forge end,
    gems         = case when p_patch ? 'gems'         then (p_patch->>'gems')::int       else gems end,
    sovereigns   = case when p_patch ? 'sovereigns'   then (p_patch->>'sovereigns')::int else sovereigns end,
    version      = version + 1,
    updated_at   = now()
  where user_id = uid;

  select * into cur from public.user_profiles where user_id = uid;

  -- The reply is the server's view, never the client's. Whatever 070's trigger
  -- repaired on the way in is reflected here, so a client that tried to clear
  -- something is told plainly that it did not happen.
  return jsonb_build_object(
    'ok', true, 'version', cur.version, 'stale', was_stale,
    'display_name', cur.display_name, 'records', cur.records, 'competitive', cur.competitive,
    'heroes', cur.heroes, 'units', cur.units, 'gems', cur.gems, 'sovereigns', cur.sovereigns,
    'deck_history', cur.deck_history, 'decks', cur.decks, 'settings', cur.settings,
    'forge', cur.forge, 'wallet_seq', cur.wallet_seq);
end;
$fn$;

revoke all on function public.profile_apply(jsonb, bigint) from public;
revoke all on function public.profile_get() from public;
grant execute on function public.profile_apply(jsonb, bigint) to authenticated;
grant execute on function public.profile_get() to authenticated;

-- ── 4 · CLOSE THE OLD DOOR, LATER NOT NOW ─────────────────────────────────
-- When every shipped client is on profile_apply, run this to make the RPC the
-- ONLY way in. Deliberately left commented: revoking the table write while old
-- builds are still live would break saves for anyone on a cached copy, which is
-- precisely the population 070 exists to protect.
--
--   revoke insert, update on public.user_profiles from authenticated;
--
-- Check who is still on the old path first:
--   select reason, count(*) from user_profiles_history
--    where archived_at > now() - interval '7 days' group by reason;

commit;
