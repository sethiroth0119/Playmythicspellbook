-- ═══════════════════════════════════════════════════════════════════════════
-- 041 · A DAY ON THE RAILS — encounters, and how they reach the shared city
--
-- Asked for: "make it where movement on the train costs one day. Each day can
-- cost random encounters to happen, which also make factions take parts of the
-- city map if it warrants due to multiplayer."
--
-- 🔴 THE EXPLOIT THIS EXISTS TO CLOSE. A day is PERSONAL — each player's train
--    carries its own day counter, because each player has their own train. But
--    the city is SHARED. If moving the train advanced the shared world, one
--    player shuttling between two districts could churn everybody's map, hand
--    the factions the city out of spite, or farm encounters until something
--    good fell out. So a travel day rolls a PLAYER'S encounter locally, and
--    only the faction-push outcome reaches this ledger — bounded, attributed,
--    and rate-limited per account.
--
-- 🔴 THE MULTIPLAYER PART IS THE POINT, THOUGH. With many players travelling,
--    the factions genuinely take ground between logins: the city churns
--    because the city is BUSY, which is the thing a shared map can do that a
--    single-player one cannot. The cap below is per-player, not global — ten
--    players travelling move the map ten times as much as one, and that is
--    correct.
--
-- ⚠ ADDITIVE. One function; no new tables. The budget is counted off
--   mission_pressure itself (source='encounter'), so there is no second place
--   for the truth to live and nothing to keep in step.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.mission_encounter(p_site text, p_faction text)
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid();
  v_recent int; v_cur int; v_add int; v_holder text;
begin
  if v_uid is null or p_site is null or p_faction is null then return mission_state(); end if;

  -- the district and the faction must be real; the client names both, so
  -- neither is taken on trust
  if not exists (select 1 from mission_adjacency where site_id = p_site) then return mission_state(); end if;
  if not exists (select 1 from mission_factions where id = p_faction) then return mission_state(); end if;

  -- 🔴 THE RATE LIMIT, AND IT IS THE WHOLE SAFETY OF THIS FEATURE. Six pushes
  --    an hour is roughly a player travelling hard the entire time; a script
  --    shuttling a train back and forth gets exactly the same six. Counted off
  --    the ledger rather than a counter table, so it cannot drift out of step
  --    with what was actually applied.
  select count(*) into v_recent
    from mission_pressure
   where source = 'encounter' and user_id = v_uid and created_at > now() - interval '1 hour';
  if v_recent >= 6 then return mission_state(); end if;

  -- whoever already holds it keeps it; an empty district is seeded by the
  -- faction the encounter named
  select faction_id into v_holder from mission_grip
   where site_id = p_site and grip > 0 order by grip desc limit 1;
  if v_holder is not null then p_faction := v_holder; end if;

  select coalesce(max(grip), 0) into v_cur from mission_grip
   where site_id = p_site and faction_id = p_faction;

  -- ⚠ SMALL, AND SMALLER THAN A RAID. A survived raid takes 12–22 off; one
  --   encounter must never be worth more than going in and fighting for it, or
  --   the best way to play the map would be to ride the rails and never deploy.
  v_add := 3 + floor(random() * 5)::int;              -- 3..7
  v_add := least(v_add, 100 - v_cur);
  if v_add <= 0 then return mission_state(); end if;

  insert into mission_pressure (site_id, faction_id, delta, source, user_id)
    values (p_site, p_faction, v_add, 'encounter', v_uid);
  return mission_state();
end; $fn$;

-- ROLLBACK:
--   drop function if exists public.mission_encounter(text, text);
