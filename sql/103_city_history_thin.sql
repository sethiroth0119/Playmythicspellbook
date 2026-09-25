-- ===========================================================================
-- 103 — city_state_history STOPS ARCHIVING A COPY OF AN IDLE CITY EVERY MINUTE
--
-- 064 made the city_state guard archive the version being replaced on EVERY
-- update, "ALWAYS, before deciding anything". That was the right instinct on
-- the day cities were vanishing: a copy of everything, no exceptions, and
-- argue about volume later. Later is now. The client's periodicSaveTick
-- (node-city, SAVE_EVERY_SEC) upserts the whole blob once a minute whether or
-- not anything changed, and the blob averages 159 KB (286 KB at the top), so
-- a city left open on a desk archives itself sixty times an hour. Measured
-- on the live table, 2026-09-04:
--
--   city_state_history rows                     28,266      898 MB
--   archived in the last 24 h                    3,567      (148/hour)
--   ...written by a save that changed no tile    2,193      61%
--   ...of those, < 10 min after the last archive 2,102
--   busiest single city, 24 h                      854      one every 65 s
--
-- (A save "changed no tile" when the copy it archived has the same tiles as
-- the NEXT copy archived for that city — the next archive's OLD is this
-- write's NEW.) Three fifths of the day's rows are the same city, tile for
-- tile, a minute apart. The only fields that differ between those copies are
-- the ones that always differ — savedAt, the event feed, the citizen list —
-- none of which is what city_restore() is reached for. Nobody has ever
-- restored a city to get its log back.
--
-- THE RULE. An UPDATE whose NEW.state->'tiles' is the same jsonb as
-- OLD.state->'tiles' is NOT archived when the newest archive for that
-- (user_id, node_id) is younger than ten minutes. Everything else archives
-- exactly as before: any tile change, and a forced DELETE. An idle open city
-- therefore leaves at most six copies an hour instead of sixty, and the copy
-- it does leave is at most ten minutes stale in the fields that were changing
-- anyway.
--
-- 🔴 A REFUSED WRITE NEVER ARCHIVED, AND THIS FILE STOPS SAYING IT DID.
--   064 inserted the archive and then RAISEd, and its error message quoted
--   the new archive id. RAISE aborts the statement, and the trigger's INSERT
--   is part of that statement, so the row it named was rolled back before
--   the client ever read the message. Run under an embedded Postgres 17 with
--   064's exact body: two refusals (an emptying UPDATE and a DELETE), both
--   messages naming an id, 0 rows in city_state_history afterwards. The live
--   table agrees — 28,266 rows, and of the non-update reasons only ONE
--   'delete', a forced one. The refusal is decided first here and raises at
--   once; the message no longer names an archive that does not exist. What
--   protects a refused write is that it is refused: the row in city_state is
--   untouched, and that row IS the copy.
--
--   Persisting an archive across a RAISE needs an autonomous transaction
--   (dblink with a stored password inside a security-definer function), or
--   a BEFORE trigger that returns NULL to skip the write silently — which the
--   client cannot distinguish from a save that landed, and node-city's
--   "A refused write is not the same as no write" rule exists because that
--   distinction has already lost a player a city once. Neither is worth it
--   for an archive of a row that was never changed.
--
-- The tile comparison is jsonb equality on the whole 'tiles' value
-- (IS NOT DISTINCT FROM, so a city with no tiles key at all counts as
-- unchanged too), not city_tile_count(): a building swapped for another of
-- the same footprint keeps the count and must still archive.
--
-- "Newest archive younger than ten minutes" is a lookup on
-- (user_id, node_id, archived_at desc). The two indexes 064 built are
-- (user_id, archived_at) and (user_id, tiles); neither has node_id, and a
-- player with cities on several nodes would scan every archive of all of
-- them on every save. The third index below makes the lookup one probe.
--
-- ⚠ REJECTED: thinning on the client (save only when dirty). Every autosave
--   bug in node-city's history ("THE BUILD-VANISHES BUG", the pendingPower
--   erase, the 300,000 🔥 tranche) came from the client deciding a save was
--   not needed. The minute-by-minute upsert stays; only the copy of the
--   copy goes.
-- ⚠ REJECTED: a nightly job that deletes near-duplicate history. It is a
--   DELETE on the one table 064 promised is append-only, running unattended,
--   and it does nothing about the ~160 KB per minute of write traffic that
--   is the actual cost.
-- ⚠ NOT DONE: pruning the 28,266 rows already there. That is an operator's
--   decision with a human watching; this file only stops the growth.
--
-- sql/RUN_NOW_2026-08-27.sql carries the 064 body of this guard as part of a
-- run-once bundle. Re-running that bundle after this file would put the
-- archive-everything guard back; run this file again afterwards if it is.
--
-- Idempotent and re-runnable. Verify block at the bottom.
-- ===========================================================================

create index if not exists city_state_history_city_idx
  on public.city_state_history (user_id, node_id, archived_at desc);

create or replace function public.city_state_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_tiles int;
  v_new_tiles int;
  v_thin      boolean := false;   -- true when this is an idle-autosave copy we skip
  v_force     boolean := coalesce(current_setting('app.city_force', true), '') = 'on';
begin
  -- ── refusals first. A refusal raises, RAISE rolls the statement back, and
  --    nothing inserted here would survive it — so nothing is inserted first.
  --    The row in city_state is left exactly as it was; that row is the copy.
  if TG_OP = 'DELETE' and not v_force then
    -- Nothing in the game legitimately deletes a city row. 052 does, and 052
    -- runs as an operator who can set the flag.
    raise exception
      'city_state rows are not deleted. The city is still in city_state; set local app.city_force to force.'
      using errcode = '42501';
  end if;

  if TG_OP = 'UPDATE' then
    v_old_tiles := public.city_tile_count(OLD.state);
    v_new_tiles := public.city_tile_count(NEW.state);
    if not v_force then
      -- (a) emptying a real city
      if v_old_tiles > 0 and v_new_tiles = 0 then
        raise exception
          'refused: this write would empty a % tile city. The city is untouched in city_state.',
          v_old_tiles
          using errcode = '55006';
      end if;
      -- (b) collapsing one
      if v_old_tiles >= 8 and v_new_tiles < (v_old_tiles / 4) then
        raise exception
          'refused: this write would cut a % tile city down to %. That is a cross-city overwrite, not a save. The city is untouched in city_state.',
          v_old_tiles, v_new_tiles
          using errcode = '55006';
      end if;
    end if;

    -- ── the thinning rule: same tiles, and an archive under ten minutes old.
    --    No archive at all for this city, or a stale one, and it archives.
    v_thin := (NEW.state -> 'tiles') is not distinct from (OLD.state -> 'tiles')
          and exists (
                select 1 from public.city_state_history h
                 where h.user_id = OLD.user_id
                   and h.node_id = OLD.node_id
                   and h.archived_at > now() - interval '10 minutes');
  end if;

  -- ── archive the version being replaced, unless it is an idle-autosave copy
  --    of one we archived in the last ten minutes. A forced DELETE always
  --    lands here: even a sanctioned wipe stays recoverable.
  if not v_thin then
    insert into public.city_state_history
      (user_id, node_id, state, sync_pct, mayor_id, mayor_name, row_updated, reason, tiles, bytes)
    values (OLD.user_id, OLD.node_id, OLD.state, OLD.sync_pct, OLD.mayor_id, OLD.mayor_name,
            OLD.updated_at, lower(TG_OP),
            public.city_tile_count(OLD.state), length(OLD.state::text));
  end if;

  return case TG_OP when 'DELETE' then OLD else NEW end;
end $$;

-- The trigger itself is unchanged from 064 (BEFORE UPDATE OR DELETE, per row);
-- repeated so an environment that lost it gets it back with the new body.
drop trigger if exists city_state_guard_trg on public.city_state;
create trigger city_state_guard_trg
  before update or delete on public.city_state
  for each row execute function public.city_state_guard();

-- ===========================================================================
-- VERIFY
-- ===========================================================================
select 'guard has the thinning branch' as check,
       (select (pg_get_functiondef(p.oid) like '%is not distinct from (OLD.state -> ''tiles'')%'
                and pg_get_functiondef(p.oid) like '%interval ''10 minutes''%')::text as got
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'city_state_guard'),
       'true' as want
union all
select 'refusals raise before the archive, and name no phantom id',
       (select (position('using errcode = ''55006''' in pg_get_functiondef(p.oid))
              < position('insert into public.city_state_history' in pg_get_functiondef(p.oid))
              and pg_get_functiondef(p.oid) not like '%city_state_history id %')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'city_state_guard'),
       'true'
union all
select 'city index present',
       (select count(*)::text from pg_indexes
         where tablename = 'city_state_history' and indexname = 'city_state_history_city_idx'), '1'
union all
select 'guard trigger armed',
       (select count(*)::text from pg_trigger
         where tgrelid = 'public.city_state'::regclass and tgname = 'city_state_guard_trg'), '1'
union all
-- What the rule would have skipped over the last day: rows whose tiles match
-- the next archive of the same city (so the save that wrote them changed no
-- tile) and that landed under ten minutes after the archive before them. Run
-- this again tomorrow: over rows written AFTER this file it is 0 by
-- construction, and the hourly rate a fraction of the 148/hour of 2026-09-04.
select 'idle copies in the last 24 h (would now be skipped)',
       (with h as (
          select archived_at, state -> 'tiles' as t,
                 lead(state -> 'tiles') over (partition by user_id, node_id order by archived_at) as next_t,
                 lag(archived_at)       over (partition by user_id, node_id order by archived_at) as prev_at
            from public.city_state_history
           where archived_at > now() - interval '24 hours')
        select count(*)::text from h
         where next_t is not null
           and t is not distinct from next_t
           and prev_at > archived_at - interval '10 minutes'),
       '2102 on 2026-09-04; 0 once the table only holds rows written after this file'
union all
select 'archives in the last hour',
       (select count(*)::text from public.city_state_history
         where archived_at > now() - interval '1 hour'),
       'a fraction of 148';
