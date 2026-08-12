-- ===========================================================================
-- 033 — NODE HIERARCHY: a MAIN node, TOWN nodes, and a city per node.
--
-- WHAT THIS ENABLES
--   • Every node can carry its OWN city (city_state is currently one row per
--     USER, so a player with six nodes has one city that all six overwrite).
--   • One node is the MAIN (the capital); the rest are TOWNS.
--   • Towns feed the main node a boost scaled by their tier.
--
-- ⚠ SPLIT INTO TWO PARTS ON PURPOSE. Part A is additive and reversible. Part B
--   re-keys a live table holding 22 players' cities and is the one that
--   deserves supervision. Run A, verify, then run B.
--
-- ---------------------------------------------------------------------------
-- THE STATE THIS WAS WRITTEN AGAINST (measured, 2026-08-12)
--   city_state     : 22 rows, PRIMARY KEY (user_id), node_id column EXISTS and
--                    is NULL on all 22.
--   economy_nodes  : 27 rows, 4 owners, ALL FOUR own multiple nodes, and no
--                    node carries meta.role yet.
--   The client ALREADY sends node_id on save but uses onConflict:'user_id', so
--   today two nodes' cities genuinely overwrite each other. The plumbing is
--   half-built; this finishes the server half.
-- ===========================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — ROLES.  Additive. No existing row is re-keyed. Safe to run alone.
-- ═══════════════════════════════════════════════════════════════════════════

-- Which node is the capital? The one the owner has invested in most: highest
-- performance (efficiency, what their roads feed it, level), oldest as the
-- tie-break. Deliberately NOT "first created" — a player's first node is often
-- the one they outgrew.
--
-- ⚠ Idempotent: only stamps owners who have no main yet, so re-running never
--   reassigns a capital the player has since chosen for themselves.
with ranked as (
  select owner_id, id,
         row_number() over (
           partition by owner_id
           order by (coalesce((meta->>'eff')::numeric, 100) / 100 * 0.5
                   + coalesce((meta->>'cityLink')::numeric, 0) / 100 * 0.35
                   + least(coalesce((meta->>'level')::int, 1), 10)::numeric / 10 * 0.15) desc,
                    created_at asc nulls last, id asc
         ) as rn
  from public.economy_nodes
  where owner_id is not null
),
needs_main as (
  select owner_id from public.economy_nodes
  where owner_id is not null
  group by owner_id
  having count(*) filter (where coalesce(meta->>'role','') = 'main') = 0
)
update public.economy_nodes n
   set meta = coalesce(n.meta, '{}'::jsonb)
              || jsonb_build_object('role', case when r.rn = 1 then 'main' else 'town' end)
  from ranked r
 where r.id = n.id
   and r.owner_id in (select owner_id from needs_main);

-- A node with no role at all reads as a town. Belt and braces for any node
-- created between this migration and the client shipping.
update public.economy_nodes
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('role', 'town')
 where owner_id is not null
   and coalesce(meta->>'role', '') not in ('main', 'town');

-- 🔒 EXACTLY ONE MAIN PER OWNER, enforced by the database rather than by hope.
-- A partial unique index is the right shape: it constrains only the 'main'
-- rows and leaves any number of towns alone.
create unique index if not exists economy_nodes_one_main_per_owner
  on public.economy_nodes (owner_id)
  where (meta->>'role') = 'main';

-- Promote a node to main, demoting the previous one, in a single statement so
-- the partial index above can never see two mains at once.
-- SECURITY DEFINER because it must touch two rows the caller owns; the owner
-- check is explicit and is the whole authorisation.
create or replace function public.node_set_main(p_node_id uuid)
returns table (ok boolean, main_id uuid, note text)
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.economy_nodes where id = p_node_id;
  if v_owner is null then
    return query select false, null::uuid, 'no such node'::text; return;
  end if;
  -- ⚠ The caller must own it. is_admin() may override, matching 029.
  if v_owner <> auth.uid() and not public.is_admin() then
    return query select false, null::uuid, 'not your node'::text; return;
  end if;
  update public.economy_nodes
     set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('role','town')
   where owner_id = v_owner and (meta->>'role') = 'main' and id <> p_node_id;
  update public.economy_nodes
     set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('role','main')
   where id = p_node_id;
  return query select true, p_node_id, 'main set'::text;
end;
$$;
revoke all on function public.node_set_main(uuid) from public, anon;
grant execute on function public.node_set_main(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — ONE CITY PER NODE.  RE-KEYS A LIVE TABLE. Run this deliberately.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 🔴 WHY A SENTINEL RATHER THAN A NULLABLE KEY. `unique (user_id, node_id)`
--    treats NULLs as DISTINCT in Postgres, so every NULL-node row would be
--    allowed to duplicate — the exact opposite of the constraint we want, and
--    it would fail silently. Making node_id NOT NULL with an all-zeros sentinel
--    meaning "the legacy city" gives a plain unique constraint, which is also
--    the only form PostgREST can use as an onConflict target.
--
-- 🔴 THE 22 EXISTING CITIES ARE NOT REASSIGNED TO A NODE. They become the
--    sentinel row — the player's existing city, untouched, still the one that
--    opens by default. Guessing which node an existing city "belonged to"
--    would be inventing history: node_id has been NULL on every row since the
--    column was added, so that information does not exist. Players attach
--    cities to nodes themselves from here on.
--
-- No `state` JSON is read, rewritten or migrated by this file.

-- B1. Backfill the sentinel, then forbid NULL.
update public.city_state
   set node_id = '00000000-0000-0000-0000-000000000000'::uuid
 where node_id is null;

alter table public.city_state
  alter column node_id set default '00000000-0000-0000-0000-000000000000'::uuid;

alter table public.city_state
  alter column node_id set not null;

-- B2. Swap the key. user_id alone is what limits a player to one city.
alter table public.city_state drop constraint if exists city_state_pkey;
alter table public.city_state add constraint city_state_pkey
  primary key (user_id, node_id);

-- ===========================================================================
-- VERIFY
--
-- PART A
--   -- exactly one main per owner, every node roled:
--   select count(*) filter (where meta->>'role' = 'main')  as mains,
--          count(*) filter (where meta->>'role' = 'town')  as towns,
--          count(*) filter (where meta->>'role' is null)   as unroled
--     from public.economy_nodes where owner_id is not null;
--   -- expect mains = number of node-owning players (4), unroled = 0
--
--   select owner_id, count(*) filter (where meta->>'role'='main') as mains
--     from public.economy_nodes where owner_id is not null
--    group by owner_id having count(*) filter (where meta->>'role'='main') <> 1;
--   -- expect ZERO rows
--
-- PART B
--   select count(*) as rows, count(*) filter (where node_id is null) as nulls,
--          count(distinct user_id) as users from public.city_state;
--   -- expect rows = 22, nulls = 0, users = 22 (nothing gained or lost)
--
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.city_state'::regclass and contype = 'p';
--   -- expect PRIMARY KEY (user_id, node_id)
--
-- ROLLBACK OF PART B (nothing is destroyed, so this is clean):
--   alter table public.city_state drop constraint city_state_pkey;
--   alter table public.city_state alter column node_id drop not null;
--   update public.city_state set node_id = null
--    where node_id = '00000000-0000-0000-0000-000000000000'::uuid;
--   alter table public.city_state add constraint city_state_pkey primary key (user_id);
-- ===========================================================================
