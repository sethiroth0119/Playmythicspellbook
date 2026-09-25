-- =============================================================================
-- 🎖 tw_node_milestones — make the rebuild MILESTONES server-authoritative.
-- Before: each client tracked node.recon.milestones locally, so the corruption
-- heal was invisible under the shared cloud row and the cinder/prestige reward
-- could be double-claimed. Now:
--   • the node-level REACHED set + corruption heal live on tw_node_recon and are
--     applied ONCE, inside tw_node_contribute (so every player sees the heal).
--   • each contributor CLAIMS the cinder/prestige reward exactly once per
--     threshold via tw_node_claim_milestone (dedup'd by a claims table).
--
-- Milestones: 25% Foothold (250🔥/+10/-5 corr) · 50% Stabilized (500🔥/+15/-8)
--             75% Thriving (900🔥/+25/-10) · 100% RESTORED (2000🔥/+50/-25, floor 8)
-- Rebuilt % = (roads/roads_total)*0.5 + (buildings/buildings_total)*0.5.
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- Requires Stage 1 (tw_node_recon) + Stage 2 (tw_node_sim) migrations.
-- =============================================================================

-- node-level reached-milestones set (e.g. [25,50]) — healed/recorded once
alter table public.tw_node_recon add column if not exists milestones jsonb not null default '[]'::jsonb;

-- ── tw_node_milestone_claims — per-player reward ledger (dedup) ──────────────
create table if not exists public.tw_node_milestone_claims (
  node_id    text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  pct        integer not null,
  claimed_at timestamptz not null default now(),
  primary key (node_id, user_id, pct)
);
alter table public.tw_node_milestone_claims enable row level security;
-- a player can read their OWN claims (to know what's already collected).
drop policy if exists tw_node_ms_claims_sel on public.tw_node_milestone_claims;
create policy tw_node_ms_claims_sel on public.tw_node_milestone_claims
  for select to authenticated using (user_id = auth.uid());
-- writes happen only through the security-definer rpc below.

-- ── tw_node_contribute — re-applied with authoritative milestone heal ────────
create or replace function public.tw_node_contribute(
  p_node_id text,
  p_buildings integer,
  p_roads integer,
  p_civ integer,
  p_roads_total integer default 60,
  p_buildings_total integer default 48,
  p_civ_total integer default 200000,
  p_camp_name text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_b integer := greatest(0, coalesce(p_buildings, 0));
  v_r integer := greatest(0, coalesce(p_roads, 0));
  v_c integer := greatest(0, coalesce(p_civ, 0));
  v_pct integer;
  v_ms  jsonb;
  v_thr record;
  v_row json;
begin
  if p_node_id is null or v_uid is null then return null; end if;

  insert into public.tw_node_recon (node_id, roads_total, buildings_total, civilians_total, population)
    values (p_node_id, coalesce(p_roads_total, 60), coalesce(p_buildings_total, 48), coalesce(p_civ_total, 200000), coalesce(p_civ_total, 200000))
    on conflict (node_id) do nothing;

  update public.tw_node_recon set
    roads_repaired     = least(roads_total, roads_repaired + v_r),
    buildings_restored = least(buildings_total, buildings_restored + v_b),
    civilians_saved    = least(civilians_total, civilians_saved + v_c),
    campaigns_run      = campaigns_run + 1,
    updated_at         = now()
  where node_id = p_node_id;

  -- Fully rebuilt → RESTORED (population recovers). Idempotent.
  update public.tw_node_recon set
    restored   = true,
    population = civilians_total,
    updated_at = now()
  where node_id = p_node_id
    and restored = false
    and roads_repaired >= roads_total
    and buildings_restored >= buildings_total;

  -- Record + heal any newly-crossed milestones, ONCE (node-level).
  select round((least(1.0, roads_repaired::numeric / nullif(roads_total,0)) * 0.5
              + least(1.0, buildings_restored::numeric / nullif(buildings_total,0)) * 0.5) * 100)::int,
         coalesce(milestones, '[]'::jsonb)
    into v_pct, v_ms
    from public.tw_node_recon where node_id = p_node_id;
  v_pct := coalesce(v_pct, 0);
  for v_thr in select * from (values (25,5),(50,8),(75,10),(100,25)) as t(thr, drp) loop
    if v_pct >= v_thr.thr
       and not exists (select 1 from jsonb_array_elements_text(coalesce(v_ms,'[]'::jsonb)) x where x = v_thr.thr::text) then
      update public.tw_node_recon set
        milestones = coalesce(milestones, '[]'::jsonb) || to_jsonb(v_thr.thr),
        corruption = greatest(case when v_thr.thr = 100 then 8 else 0 end, corruption - v_thr.drp),
        updated_at = now()
      where node_id = p_node_id;
      v_ms := coalesce(v_ms,'[]'::jsonb) || to_jsonb(v_thr.thr);   -- so we don't re-add this call
    end if;
  end loop;

  insert into public.tw_node_contrib (node_id, user_id, buildings, roads, civ, camp_name, updated_at)
    values (p_node_id, v_uid, v_b, v_r, v_c, p_camp_name, now())
    on conflict (node_id, user_id) do update set
      buildings  = tw_node_contrib.buildings + v_b,
      roads      = tw_node_contrib.roads + v_r,
      civ        = tw_node_contrib.civ + v_c,
      camp_name  = coalesce(p_camp_name, tw_node_contrib.camp_name),
      updated_at = now();

  select row_to_json(t) into v_row from public.tw_node_recon t where t.node_id = p_node_id;
  return v_row;
end; $$;
grant execute on function public.tw_node_contribute(text, integer, integer, integer, integer, integer, integer, text) to authenticated;

-- ── tw_node_claim_milestone — per-player reward claim (verified + dedup'd) ────
-- Grants the cinder/prestige for a milestone IFF (a) the node has actually
-- reached it (it's in tw_node_recon.milestones — set server-side, not by the
-- caller), (b) the caller contributed to the node, and (c) they haven't already
-- claimed it. Returns {granted, cinder, prestige, label, restored}.
create or replace function public.tw_node_claim_milestone(p_node_id text, p_pct integer)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reached boolean;
  v_contributed boolean;
  v_rows integer;
  v_cinder integer;
  v_prestige integer;
  v_label text;
begin
  if v_uid is null or p_node_id is null then return json_build_object('granted', false, 'reason', 'auth'); end if;

  select exists (
    select 1 from jsonb_array_elements_text(
      coalesce((select milestones from public.tw_node_recon where node_id = p_node_id), '[]'::jsonb)
    ) x where x = p_pct::text
  ) into v_reached;
  if not v_reached then return json_build_object('granted', false, 'reason', 'not_reached'); end if;

  select exists (select 1 from public.tw_node_contrib where node_id = p_node_id and user_id = v_uid) into v_contributed;
  if not v_contributed then return json_build_object('granted', false, 'reason', 'no_contribution'); end if;

  insert into public.tw_node_milestone_claims (node_id, user_id, pct)
    values (p_node_id, v_uid, p_pct)
    on conflict (node_id, user_id, pct) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return json_build_object('granted', false, 'reason', 'already_claimed'); end if;

  v_cinder   := case p_pct when 25 then 250 when 50 then 500 when 75 then 900 when 100 then 2000 else 0 end;
  v_prestige := case p_pct when 25 then 10  when 50 then 15  when 75 then 25  when 100 then 50   else 0 end;
  v_label    := case p_pct when 25 then 'Foothold' when 50 then 'Stabilized' when 75 then 'Thriving' when 100 then 'RESTORED' else '' end;
  return json_build_object('granted', true, 'cinder', v_cinder, 'prestige', v_prestige, 'label', v_label, 'restored', p_pct >= 100);
end; $$;
grant execute on function public.tw_node_claim_milestone(text, integer) to authenticated;
