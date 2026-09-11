-- ════════════════════════════════════════════════════════════════════════════
-- 079b · URDA — give him a node and move his city onto it
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  EDIT TWO THINGS ON LINES 32 AND 33, THEN RUN THE WHOLE FILE.               │
-- │                                                                          │
-- │    v_node  := 'N-03';        ← the node he gets                          │
-- │    v_armed := true;          ← nothing happens until this is true        │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- THE SITUATION
--   URDA is active, has a real 33-tile city, and owns NO node — so nothing can
--   open it. The city sits on N-02, which belongs to LIDS (who has his own
--   126-tile city there). He built it believing it was his.
--
-- WHY YOU HAVE TO CHOOSE
--   39 of 40 node ids are owned, the node list lives CLIENT-SIDE (tw_sectors,
--   tw_territories and tw_regions are all empty), and creating a node is an
--   admin-only action in the World Map. The database cannot mint one: an
--   ownership row for a node the map does not draw leaves him worse off.
--
--   'N-03'  KuyaGamerz,     last seen 31 days ago, holds NO city there
--   'N-15'  Enchanted Lily, last seen 32 days ago, holds NO city there
--   or a node you create in the admin World Map first, then name here.
--
--   Both listed options are EMPTY CLAIMS — the previous owner loses the claim
--   and nothing else, and it is backed up so it can be handed straight back.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_node  text    := 'N-00';        -- ← 'N-03' | 'N-15' | the node you created
  v_armed boolean := false;         -- ← true to run
  v_urda  uuid;
  v_tiles int;
  v_holder uuid;
  v_holder_city int;
begin
  if not v_armed then
    raise exception
      'Not armed — set v_node to the node URDA should get and v_armed := true, then run again. Nothing was changed.';
  end if;
  if v_node = 'N-00' then
    raise exception 'v_node is still the placeholder. Choose a real node. Nothing was changed.';
  end if;

  select user_id into v_urda from public.user_profiles where display_name = 'URDA';
  if v_urda is null then raise exception 'URDA not found. Nothing was changed.'; end if;

  if exists (select 1 from public.tw_node_owners where user_id = v_urda) then
    raise exception 'URDA already owns a node — somebody got there first. Nothing was changed.';
  end if;

  select public.city_tile_count(state) into v_tiles
    from public.city_state where user_id = v_urda and node_id = 'N-02';
  if v_tiles is null then
    raise exception 'URDA has no city on N-02 any more — re-check before running. Nothing was changed.';
  end if;

  /* 🔴 THE TARGET MUST BE EMPTY. Handing over a node somebody has BUILT on
     would take a real city from a real player — the exact opposite of the bug
     this repairs. Both suggested nodes are empty; this refuses if that has
     changed since. */
  select user_id into v_holder from public.tw_node_owners where node_id = v_node;
  if v_holder is not null then
    select coalesce(public.city_tile_count(state), 0) into v_holder_city
      from public.city_state where user_id = v_holder and node_id = v_node;
    if coalesce(v_holder_city, 0) > 0 then
      raise exception 'Refusing: % carries a % tile city belonging to its owner. Nothing was changed.',
        v_node, v_holder_city;
    end if;
  end if;

  if exists (select 1 from public.city_state where user_id = v_urda and node_id = v_node) then
    raise exception 'Refusing: URDA already has a city row on % — that needs a hand-merge. Nothing was changed.', v_node;
  end if;

  -- Everything that is about to move, kept first.
  create table if not exists public.urda_recovery_backup_20260829 (src text, row jsonb);
  insert into public.urda_recovery_backup_20260829
  select 'tw_node_owners', to_jsonb(t) from public.tw_node_owners t where t.node_id = v_node;
  insert into public.urda_recovery_backup_20260829
  select 'city_state', to_jsonb(t) from public.city_state t
   where t.user_id = v_urda and t.node_id = 'N-02';

  delete from public.tw_node_owners where node_id = v_node;
  insert into public.tw_node_owners (node_id, user_id, display_name, assigned_by, updated_at)
  values (v_node, v_urda, 'URDA', 'recovery_079b', now());

  /* Re-key the city. city_state_guard archives the pre-move row on the way
     through, and nothing shrinks, so it passes rather than refusing. */
  update public.city_state set node_id = v_node, updated_at = now()
   where user_id = v_urda and node_id = 'N-02';

  raise notice 'URDA now owns % and his % tile city moved there.', v_node, v_tiles;
end $$;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'URDA owns' as check,
       coalesce((select string_agg(node_id, ',') from public.tw_node_owners
                  where user_id = (select user_id from public.user_profiles where display_name = 'URDA')),
                '(still nothing)') as result
union all
select 'his city',
       coalesce((select cs.node_id || ' / ' || public.city_tile_count(cs.state)::text || ' tiles'
                   from public.city_state cs
                  where cs.user_id = (select user_id from public.user_profiles where display_name = 'URDA')),
                '(no city row)')
union all
select 'LIDS still holds his own N-02 city',
       coalesce((select public.city_tile_count(state)::text || ' tiles'
                   from public.city_state
                  where node_id = 'N-02'
                    and user_id = (select user_id from public.user_profiles where display_name = 'LIDS')),
                '(MISSING — STOP AND RESTORE)');
