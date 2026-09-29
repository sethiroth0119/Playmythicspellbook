-- ═══════════════════════════════════════════════════════════════════════════
-- 042 · A DAY IS 24 REAL HOURS, AND IT BELONGS TO EVERYONE
--
-- Asked for: "Make the day actually connect to everyone so one day is 24 real
-- hours since it is multiplayer. Instead of spending a day, spend fuel — make
-- it 2 fuel for each move. Instead, the day gives the chance for the map to
-- change collectively."
--
-- 🔴 WHAT MOVED. The day used to be PERSONAL — it sat on each player's train
--    and ticked when they travelled, so your day 14 and someone else's day 3
--    were both true and neither meant anything to the other. That is wrong for
--    a shared city: if the whole point is that everyone raids the same map,
--    then "day 6 in Ethos Heights" has to mean one thing for all of them.
--    The day is now the world's, derived from real time, and travel costs fuel
--    instead.
--
-- 🔴 …AND THE DAILY ROLLOVER IS WHEN THE CITY CHANGES. The faction push used
--    to run every 4 hours; it now runs once per real day, for everybody, at the
--    same moment. That is the "collectively" in the request: you and everyone
--    else wake up to the SAME new board, rather than each discovering a private
--    trickle whenever you happened to open the map.
--
-- ⚠ THE PUSH RATES ARE TRIPLED TO MATCH. Six 4-hour ticks a day at 4–9 grip
--   was ~24–54 a day; one daily tick at the old rate would have been 4–9, and
--   the city would have frozen — a district would take three weeks to fall
--   instead of a few days. Tripling gives ~12–27 a day, so an ignored district
--   falls in under a week and a daily check-in is a real decision.
--   /src/missions/poi.js carries the SAME numbers; drive-mission-coop asserts
--   the two agree, so this migration and that file move together or the build
--   fails.
--
-- ⚠ ADDITIVE. mission_clock keeps its columns and its meaning; only the
--   interval and the rates change. Rollback at the foot.
-- ═══════════════════════════════════════════════════════════════════════════

-- one push per real day, not six
create or replace function public.mission_tick()
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_last timestamptz; v_owed int; v_i int; v_row record; v_add int; v_cur int;
  v_open text; v_seed int;
begin
  -- 🔴 ONE TICKER AT A TIME. Without the lock, two clients arriving in the same
  --    second both read "1 day owed" and both apply it — the factions would
  --    advance twice as fast on a busy evening as on a quiet one.
  perform pg_advisory_xact_lock(hashtext('mission_tick'));
  select last_tick into v_last from mission_clock where id = 1;
  -- 86400 = ONE REAL DAY. The cap is 6, so a month away is six days of drift,
  -- not thirty — coming back to a city that fell while you were gone is a
  -- story; coming back to one that cannot be retaken is a reason to stop.
  v_owed := least(6, floor(extract(epoch from (now() - v_last)) / 86400)::int);
  if v_owed <= 0 then return mission_state(); end if;

  for v_i in 1..v_owed loop
    for v_row in
      select distinct on (g.site_id) g.site_id, g.faction_id, g.grip, f.rate_lo, f.rate_hi,
             f.spread, f.seed_lo, f.seed_hi
        from mission_grip g join mission_factions f on f.id = g.faction_id
       where g.grip > 0
       order by g.site_id, g.grip desc, g.faction_id
    loop
      v_cur := v_row.grip;
      v_add := v_row.rate_lo + floor(random() * (v_row.rate_hi - v_row.rate_lo + 1))::int;
      v_add := least(v_add, 100 - v_cur);
      if v_add > 0 then
        insert into mission_pressure (site_id, faction_id, delta, source)
          values (v_row.site_id, v_row.faction_id, v_add, 'tick');
      end if;

      if random() < v_row.spread then
        select a.neighbor_id into v_open
          from mission_adjacency a
         where a.site_id = v_row.site_id
           and not exists (select 1 from mission_grip g2 where g2.site_id = a.neighbor_id and g2.grip > 0)
         order by random() limit 1;
        if v_open is not null then
          v_seed := v_row.seed_lo + floor(random() * (v_row.seed_hi - v_row.seed_lo + 1))::int;
          insert into mission_pressure (site_id, faction_id, delta, source)
            values (v_open, v_row.faction_id, v_seed, 'tick');
        end if;
      end if;
    end loop;
    update mission_clock set day = day + 1 where id = 1;
  end loop;

  -- ⚠ ADVANCE THE CLOCK BY WHOLE DAYS, NOT TO now(). Setting it to now() would
  --   throw away the remainder of the current day every time somebody opened
  --   the map, so the next rollover would always be a full 24h away and the day
  --   would drift later and later — a "daily" event that never lands at the
  --   same time twice.
  update mission_clock set last_tick = last_tick + (v_owed * interval '1 day') where id = 1;
  return mission_state();
end; $fn$;

-- per-DAY push rates (were per-4-hours); poi.js carries the same numbers
update public.mission_factions set rate_lo = 12, rate_hi = 27 where id = 'scum';
update public.mission_factions set rate_lo =  6, rate_hi = 18 where id = 'anomalies';
update public.mission_factions set rate_lo =  6, rate_hi = 12 where id = 'scp';

-- 🔴 THE ENCOUNTER PUSH IS RETIRED. It let a travel day move the shared city,
--    which is exactly what the day now does for everyone at once — keeping both
--    would mean the map changed twice for the same reason, once collectively
--    and once for whoever happened to be travelling. A SECURITY DEFINER
--    function that can write to the pressure ledger and is called by nothing is
--    an attack surface with no upside, so it goes rather than lingering.
drop function if exists public.mission_encounter(text, text);

-- ROLLBACK:
--   (restore the 4h interval and the old rates from sql/040 + sql/041)
