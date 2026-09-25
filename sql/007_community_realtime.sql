-- ===========================================================================
-- 007 - REALTIME FOR COMMUNITIES
--
-- Postgres only streams changes for tables in the supabase_realtime
-- publication. guild_chat was added when the Guild Wire was built; the
-- community tables were not, so announcements, votes and payouts could only be
-- seen by reloading.
--
-- RLS still applies to realtime, so a player only ever receives rows they were
-- already allowed to SELECT. Adding a table here does not widen access.
--
-- Idempotent - each add is guarded, so re-running is safe.
-- Plain ASCII. Supabase SQL editor, project ktsiasyjusesawtrwrjc.
-- ===========================================================================

do $$
declare
  t text;
  tables text[] := array[
    'community_announcements',   -- new announcement -> notify the community
    'community_votes',           -- vote opened / closed -> notify
    'community_rewards',         -- a payout landed for you
    'community_members',         -- joins + approvals show up live
    'guild_chat'                 -- already added when the Wire shipped; harmless
  ];
begin
  for t in select unnest(tables) loop
    -- Skip if the table is already published, else ALTER PUBLICATION errors.
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added % to supabase_realtime', t;
    else
      raise notice '% already published', t;
    end if;
  end loop;
end $$;


-- Realtime sends only the primary key on UPDATE/DELETE unless the replica
-- identity is FULL. Announcements and votes are read as whole rows by the
-- notifier, so give it the full row.
alter table public.community_announcements replica identity full;
alter table public.community_votes         replica identity full;
alter table public.community_rewards       replica identity full;


-- verify: expect 5 rows
select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public'
   and tablename in ('community_announcements','community_votes','community_rewards',
                     'community_members','guild_chat')
 order by tablename;
