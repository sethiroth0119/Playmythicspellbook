-- ════════════════════════════════════════════════════════════════════════════
-- 079a · VERIFY THE 2026-08-29 RECOVERY  ·  READ-ONLY, SAFE TO RUN ANY TIME
--
-- Nothing here writes. Run it whenever you want to confirm the state of the
-- three fixes applied on 2026-08-29:
--
--   · the River Meadows merge (two corps with the same name, one founder)
--   · the trader cap (077 — rl_post_listing carried its own flat 15)
--   · Grimalkin Lord's city (a stray row keyed to an ECONOMY NODE, not a city)
--
-- Every row prints what it found beside what it should be. Anything that does
-- not match the "expected" column is worth looking at.
-- ════════════════════════════════════════════════════════════════════════════

select 'trader cap honours the membership' as check,
       (pg_get_functiondef(p.oid) ~ 'trader_slots')::text as result,
       'true' as expected
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rl_post_listing'

union all
select 'no flat 15 left in the posting path',
       (not (pg_get_functiondef(p.oid) ~ 'if n >= 15 then'))::text, 'true'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rl_post_listing'

union all
select 'River Meadows corporations', count(*)::text, '1'
  from public.corporations where name ilike '%River Meadow%'

-- 🔴 The one that matters most. economy_nodes.corp_id is ON DELETE SET NULL
--    while every other corp_* table cascades, so deleting a corporation does
--    not remove its nodes — it orphans them. This must stay 0.
union all
select 'economy nodes owned by nobody', count(*)::text, '0'
  from public.economy_nodes where corp_id is null

union all
select 'city rows keyed to an economy node (a PRN)', count(*)::text, '0'
  from public.city_state where node_id in (select id::text from public.economy_nodes)

union all
select 'a founder owning two corporations', count(*)::text, '0'
  from (select founder_id from public.corporations
         where founder_id is not null group by founder_id having count(*) > 1) q

union all
select 'Grimalkin: city rows', count(*)::text, '1'
  from public.city_state
 where user_id = (select user_id from public.user_profiles where display_name = 'Grimalkin Lord')

union all
select 'Grimalkin: node / tiles',
       node_id || ' / ' || public.city_tile_count(state)::text, 'N-13 / 92'
  from public.city_state
 where user_id = (select user_id from public.user_profiles where display_name = 'Grimalkin Lord')

union all
select 'Grimalkin: free listing slots',
       (public.trader_slots(u.user_id) - public.trader_active_listings(u.user_id))::text,
       '65 (80 tier minus 15 live)'
  from public.user_profiles u where u.display_name = 'Grimalkin Lord';
