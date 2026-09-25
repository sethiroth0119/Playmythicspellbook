-- ════════════════════════════════════════════════════════════════════════════
-- 154_B · A PRN's LEVEL IS RAISED BY ITS OWNER'S CITY — NOT BY ANYONE WITH A LINK
--         DRAFT — NOT APPLIED. Idempotent (CREATE OR REPLACE, same signature,
--         same return type), re-runnable, ends with a verify SELECT.
--
-- REPORTS: bug-mu2n0w7s "Since this morning, I now have my own and also another
--          Node's PRNs in my city", bug-mtwuhbwu "PRN levels in Foundation
--          Reserve should match the node levels in the city".
--
-- THE HOLE (live function, read out of pg_proc 2026-09-17):
--   city_set_node_level(p_node_id uuid, p_level int) raises economy_nodes
--   meta.level (1..50) for the node's OWNER *or for anyone holding a
--   city_node_links row for it*. The only writer of city_node_links is
--   city_push_node_boost, whose 2-argument form inserts a link for ANY node id
--   the caller names, with no ownership test at all. So one 0 % boost buys the
--   right to set a stranger's PRN to level 50.
--   MEASURED in a rolled-back probe as a player with no relation to the node
--   (b35a8809's Research PRN, meta.level 20):
--       city_set_node_level(node, 50)              → NULL   (refused)
--       city_push_node_boost(node, 0)              → ok     (link written)
--       city_set_node_level(node, 50)              → 50     (stored meta.level 50)
--   Nothing persisted (re-read after: level 20, 0 links). anon also holds
--   EXECUTE on the function today.
--   It is also the server half of bug-mu2n0w7s: a Node Manager's OWN city rang
--   a client's PRNs through their links (fixed in the client), and every level
--   that ring earned was written onto the client's nodes from a city the client
--   does not own.
--
-- THE RULE: the caller is the node's owner, or the owner's ACTIVE Node Manager
--   (node_mayors) — the same test sql/105's city_push_node_boost applies with
--   p_owner, and the same two cities that legitimately ring the node (the
--   owner's own, and the owner's city the manager runs). city_node_links no
--   longer grants anything here. The 50 ceiling is unchanged; node-city now
--   caps its own counter at the same 50 (NODE_LEVEL_MAX).
--   anon's EXECUTE is revoked (auth.uid() is null for anon, so it already
--   returned NULL — this is hygiene, not a behaviour change).
--
-- RLS: no table or policy change. economy_nodes' policies are untouched; this
--   SECURITY DEFINER function stays the only level writer the client calls.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.city_set_node_level(p_node_id uuid, p_level integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cur   integer;
  v_owner uuid;
  v_new   integer := greatest(1, least(50, coalesce(p_level, 1)));
begin
  if auth.uid() is null then return null; end if;
  select n.owner_id, coalesce((n.meta->>'level')::int, 1)
    into v_owner, v_cur
    from economy_nodes n where n.id = p_node_id;
  if v_owner is null then return null; end if;
  if v_owner <> auth.uid()
     and not exists (select 1 from node_mayors m
                      where m.owner_id = v_owner and m.mayor_id = auth.uid() and m.active) then
    return null;
  end if;
  if v_new <= v_cur then return v_cur; end if;
  update economy_nodes
     set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('level', v_new),
         updated_at = now()
   where id = p_node_id;
  return v_new;
end $$;

revoke all on function public.city_set_node_level(uuid, integer) from public, anon;
grant execute on function public.city_set_node_level(uuid, integer) to authenticated;

commit;

-- --- VERIFY. Expect: no_link_grant_t = t, manager_test_t = t, anon_exec_f = f,
--     auth_exec_t = t.
select
  (select position('city_node_links' in pg_get_functiondef('public.city_set_node_level(uuid,integer)'::regprocedure)) = 0) as no_link_grant_t,
  (select position('node_mayors' in pg_get_functiondef('public.city_set_node_level(uuid,integer)'::regprocedure)) > 0)     as manager_test_t,
  has_function_privilege('anon', 'public.city_set_node_level(uuid,integer)', 'EXECUTE')                                   as anon_exec_f,
  has_function_privilege('authenticated', 'public.city_set_node_level(uuid,integer)', 'EXECUTE')                          as auth_exec_t;
