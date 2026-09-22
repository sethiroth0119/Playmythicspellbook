-- ===========================================================================
-- 192 — city_profiles: RE-KEY the old PRN-keyed rows onto the city's TW node,
--        and clear the stale ones.   (bug-mtqasoy6 / bug-mucvogzk, owner's
--        decision D, 2026-09-22)
--
-- WHY
--   cityTradePublish (index.html) upserted city_profiles on (owner_id, node_id)
--   with node_id = the city economy's GROUND, which was game.anchors[0] — a PRN
--   uuid from economy_nodes, in whatever order the reserve happened to load.
--   So one city filed a new row every time its first anchor changed, and two
--   cities of one owner that rang the same PRNs overwrote one row between them.
--   The client now publishes node_id = the city's own TW node ('N-25', what
--   city_state is keyed by, and what sql/088, 088b and 129 already join on).
--
--   MEASURED before this file (read-only, 2026-09-22):
--       91 rows / 28 owners:  64 PRN-uuid keyed · 27 'local-city' · 0 TW keyed
--       of the 64 uuid rows:   9 map to exactly one city via city_state
--                              (the economy blob's saved ground = the key; 3 of
--                              the 9 had two candidate cities, resolved by the
--                              economy day matching the row's economy_day)
--                             55 map to no city at all (stale grounds); 45 of
--                              those carry no open trade offer.
--
-- WHAT IT DOES (in this order, all idempotent)
--   0. snapshots every row it may touch into city_profiles_rekey_backup_192
--      (service role only — RLS on, no policies). The 064 archive trigger ALSO
--      copies each updated/deleted row into city_profiles_history.
--   1. RE-KEYS a uuid row to its city's TW node when the city is identifiable
--      and the owner has no TW row there yet. An UPDATE keeps the row id, so
--      its offers, agreements and labour pool (all FK ON DELETE CASCADE to
--      city_profiles.id) are kept. updated_at is left alone, so a re-keyed
--      stale row does not jump to the top of the trade market.
--   2. DELETES a uuid row that is still uuid-keyed after step 1 ONLY when it
--      has no OPEN trade offer and no trade agreement of any status. A row that
--      still has one is left in place and is reported by the verify query; it
--      is swept by a later re-run once its offers expire (7 days).
--   'local-city' rows are NOT touched: a city on no TW node still publishes
--   under that key, and the corp roster already ignores it.
--
-- RLS: city_profiles policies are UNCHANGED. The only new table is the backup,
--   which is service role only (RLS enabled, no policies, grants revoked).
--
-- APPLY: by hand in the Supabase SQL editor, project ktsiasyjusesawtrwrjc.
--   Safe to run before or after the client ships, and safe to run again.
-- ===========================================================================

-- ── 0 · backup (service role only) ─────────────────────────────────────────
create table if not exists public.city_profiles_rekey_backup_192 as
  select p.*, now() as backed_up_at from public.city_profiles p where false;
alter table public.city_profiles_rekey_backup_192 enable row level security;
-- No policies on purpose: service role only. Not readable by clients.
revoke all on public.city_profiles_rekey_backup_192 from anon, authenticated;

insert into public.city_profiles_rekey_backup_192
select p.*, now()
  from public.city_profiles p
 where p.node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists (select 1 from public.city_profiles_rekey_backup_192 b where b.id = p.id);

-- ── 1 · re-key the rows whose city can be identified ───────────────────────
with cand as (
  select p.id as pid, p.owner_id, p.updated_at as p_at, c.node_id as tw,
         row_number() over (
           partition by p.id
           order by (case when (c.state->'economy'->>'day') ~ '^[0-9]+(\.[0-9]+)?$'
                           and floor((c.state->'economy'->>'day')::numeric)::int = p.economy_day
                          then 0 else 1 end),
                    c.updated_at desc nulls last
         ) as rk
    from public.city_profiles p
    join public.city_state c
      on c.user_id = p.owner_id
     and c.state->'economy'->>'nodeId' = p.node_id
   where p.node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and c.node_id is not null and c.node_id <> '' and c.node_id <> 'local-city'
     and c.node_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
pick as (
  -- one row per (owner, TW node): the freshest one
  select distinct on (owner_id, tw) pid, owner_id, tw
    from cand where rk = 1
   order by owner_id, tw, p_at desc nulls last
)
update public.city_profiles p
   set node_id = k.tw
  from pick k
 where p.id = k.pid
   and not exists (select 1 from public.city_profiles x
                    where x.owner_id = k.owner_id and x.node_id = k.tw);

-- ── 2 · clear the stale uuid rows that hold nothing open ────────────────────
do $$
begin
  delete from public.city_profiles p
   where p.node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (to_regclass('public.city_trade_offers') is null or not exists (
           select 1 from public.city_trade_offers o
            where o.city_id = p.id and o.filled_units < o.units and o.expires_at > now()))
     and (to_regclass('public.city_trade_agreements') is null or not exists (
           select 1 from public.city_trade_agreements a
            where a.proposer_city = p.id or a.partner_city = p.id));
exception when undefined_table then
  -- city_trade_offers / agreements absent (038/039 never applied): only rows
  -- with nothing that could reference them exist, so a plain sweep is safe.
  delete from public.city_profiles p
   where p.node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
end $$;

-- ── verify ─────────────────────────────────────────────────────────────────
-- Expect: uuid_keyed = only rows still holding an open offer or an agreement
-- (re-run after they expire to sweep them); tw_keyed grows as cities republish;
-- dup_owner_node = 0 (the unique key guarantees it; shown for the record).
select
  count(*)                                                            as total,
  count(*) filter (where node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as uuid_keyed,
  count(*) filter (where node_id = 'local-city')                      as local_city,
  count(*) filter (where node_id ~ '^N-')                             as tw_keyed,
  (select count(*) from public.city_profiles_rekey_backup_192)        as backed_up,
  (select count(*) from (select owner_id, node_id from public.city_profiles
                          group by 1, 2 having count(*) > 1) d)       as dup_owner_node,
  count(*) filter (where node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     and updated_at > now() - interval '1 day')       as uuid_rows_touched_by_old_clients_24h
from public.city_profiles;
