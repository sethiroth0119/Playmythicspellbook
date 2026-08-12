-- =============================================================================
-- 🗺 WARPATH — Milestone 1. Run-based multiplayer expedition/draft mode.
--
-- Your Hero leaves the permanent city, enters a temporary four-player world,
-- pitches a camp, explores under fog of war, gathers, recruits, fights other
-- heroes through REAL Mythic Spellbook card battles, secures loot in a vault,
-- and extracts back home with whatever survived.
--
-- ── THREE RULES THIS FILE EXISTS TO ENFORCE ─────────────────────────────────
--
-- 1. THE WARPATH NEVER RESOLVES A CARD BATTLE.
--    warpath_battle_open() creates a battle row and returns its id. That is the
--    whole of its involvement. The battle is played by the existing engine in
--    public/index.html, and warpath_battle_report() consumes the verdict. Grep
--    this file for damage, HP-of-a-unit, or a deck: there is none. The only
--    hero HP here is expedition health, which is a map-layer stat.
--
-- 2. RUN STATE CAN NEVER REACH THE PERMANENT COLLECTION EXCEPT THROUGH
--    EXTRACTION. Every warpath_* table below is temporary and run-scoped. The
--    single row type that a permanent-side reader ever looks at is
--    warpath_grants, written ONLY by warpath_extract_finish(), which caps what
--    it writes. Nothing else in this file inserts into it.
--
-- 3. THE CLIENT CANNOT WRITE RUN STATE DIRECTLY. Every warpath_* table has a
--    SELECT policy for participants and NO insert/update/delete policy at all.
--    Mutations happen exclusively through the `security definer` RPCs at the
--    bottom, which re-derive the world from the seed and re-check every claim.
--    This is deliberately stricter than the neighbouring tw_* tables.
--
-- ── THE WORLD IS A SEED, NOT A TABLE ────────────────────────────────────────
-- There are no tile rows. warpath_runs.seed drives public/warpath/warpath-mapgen.js
-- in the browser and the wp_* functions here in Postgres, and the two agree
-- bit-for-bit — public/warpath/_sqlcheck.js diffs 20,000 samples of every
-- derived quantity across both implementations. When a client says "I harvested
-- the iron at (14,7)", the server recomputes what is at (14,7) and rejects the
-- claim if it disagrees. That is what stops a crafted client inventing a
-- Dragon Heart node.
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- Depends on: auth.users, and public.bank_of_ethos / public.boe_ledger from
-- api.sql (AZA entry). Ticket entry works without them.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — THE WORLD MIRROR
-- Every function here has a twin in public/warpath/warpath-mapgen.js. If you
-- change one, change both and re-run public/warpath/_sqlcheck.js.
-- ═══════════════════════════════════════════════════════════════════════════

-- World size and lattice. Mirrors WORLD_W / WORLD_H / LATTICE_* .
create or replace function public.wp_w() returns int language sql immutable parallel safe as $$ select 44 $$;
create or replace function public.wp_h() returns int language sql immutable parallel safe as $$ select 30 $$;

/* wp_hash32 — the contract between the browser and this database.

   Mirrors wpHash32() exactly. The `::numeric` casts are load-bearing: a
   uint32 * uint32 product reaches ~9.6e18, which overflows bigint (max
   ~9.22e18), so the modulo MUST happen in numeric before the cast back down.
   Getting this wrong does not error — it silently wraps, and then the server
   and the client disagree about what is on a tile. */
create or replace function public.wp_hash32(p_seed bigint, p_x int, p_y int, p_salt int)
returns bigint language plpgsql immutable parallel safe as $$
declare h bigint;
begin
  h := (p_seed % 4294967296) # 2654435769;                                   -- ^ 0x9e3779b9
  h := ((((h # p_x)::numeric * 2246822507) % 4294967296))::bigint;           -- * 0x85ebca6b
  h := ((((h # p_y)::numeric * 3266489909) % 4294967296))::bigint;           -- * 0xc2b2ae35
  h := ((((h # p_salt)::numeric * 668265263) % 4294967296))::bigint;         -- * 0x27d4eb2f
  h := h # (h >> 15);
  h := (((h::numeric * 625341585) % 4294967296))::bigint;                    -- * 0x2545f491
  h := h # (h >> 13);
  return h;
end $$;

create or replace function public.wp_roll(p_seed bigint, p_x int, p_y int, p_salt int, p_n int)
returns int language sql immutable parallel safe as $$
  select (public.wp_hash32(p_seed, p_x, p_y, p_salt) % p_n)::int
$$;

-- ── The land lattice ─────────────────────────────────────────────────────
create or replace function public.wp_on_lattice(p_x int, p_y int)
returns boolean language sql immutable parallel safe as $$
  select (p_y % 6) = 3 or (p_x % 7) = 4
$$;

-- ⚠ Scanning candidates, NOT round((y-3)/6). Postgres rounds halves away from
-- zero and JS rounds them toward +Infinity, so the two would disagree on the
-- exact halfway cases and place a gate one tile apart on client and server.
create or replace function public.wp_nearest_lattice_row(p_y int)
returns int language plpgsql immutable parallel safe as $$
declare r int; best int := 3; bd int := 9999;
begin
  r := 3;
  while r < public.wp_h() loop
    if abs(r - p_y) < bd then bd := abs(r - p_y); best := r; end if;
    r := r + 6;
  end loop;
  return best;
end $$;

create or replace function public.wp_nearest_lattice_col(p_x int)
returns int language plpgsql immutable parallel safe as $$
declare c int; best int := 4; bd int := 9999;
begin
  c := 4;
  while c < public.wp_w() loop
    if abs(c - p_x) < bd then bd := abs(c - p_x); best := c; end if;
    c := c + 7;
  end loop;
  return best;
end $$;

-- Returns ARRAY[x,y] snapped onto the lattice. Ties go to the row, as in JS.
create or replace function public.wp_snap(p_x int, p_y int)
returns int[] language plpgsql immutable parallel safe as $$
declare x int; y int; ry int; cx int;
begin
  x := greatest(0, least(public.wp_w() - 1, p_x));
  y := greatest(0, least(public.wp_h() - 1, p_y));
  if public.wp_on_lattice(x, y) then return ARRAY[x, y]; end if;
  ry := public.wp_nearest_lattice_row(y);
  cx := public.wp_nearest_lattice_col(x);
  if abs(ry - y) <= abs(cx - x) then return ARRAY[x, ry]; else return ARRAY[cx, y]; end if;
end $$;

-- ── Biome cores ──────────────────────────────────────────────────────────
-- Mirrors shuffledCells(): seeded Fisher-Yates over the 12 grid cells, so the
-- four forced pack biomes are not always in the same row of the map.
create or replace function public.wp_shuffled_cells(p_seed bigint)
returns int[] language plpgsql immutable parallel safe as $$
declare cells int[] := ARRAY[0,1,2,3,4,5,6,7,8,9,10,11]; i int; j int; t int;
begin
  i := 11;
  while i > 0 loop
    j := public.wp_roll(p_seed, i, 0, 108, i + 1);            -- S_CORE_KIND + 100
    t := cells[i + 1]; cells[i + 1] := cells[j + 1]; cells[j + 1] := t;
    i := i - 1;
  end loop;
  return cells;
end $$;

-- 12 cores as jsonb: [{x,y,b}, ...]. Mirrors biomeCores().
-- FORCED_CORES = forest, graveyard, facility, mountain (all four must exist or
-- a whole archetype is undraftable this run). CORE_POOL fills the rest.
create or replace function public.wp_cores(p_seed bigint)
returns jsonb language plpgsql immutable parallel safe as $$
declare
  forced text[] := ARRAY['forest','graveyard','facility','mountain'];
  pool   text[] := ARRAY['plains','plains','plains','wastes','wastes','forest','mountain','graveyard'];
  cells  int[]  := public.wp_shuffled_cells(p_seed);
  out jsonb := '[]'::jsonb;
  i int; cell int; cx int; cy int; jx int; jy int; px int; py int; kind text;
begin
  for i in 0..11 loop
    cell := cells[i + 1];
    cx := cell % 4; cy := cell / 4;
    jx := public.wp_roll(p_seed, i, 0, 6, 600);               -- S_CORE_X
    jy := public.wp_roll(p_seed, i, 0, 7, 600);               -- S_CORE_Y
    px := (11 * (cx * 1000 + 200 + jx)) / 1000;               -- CORE_CW = 11
    py := (10 * (cy * 1000 + 200 + jy)) / 1000;               -- CORE_CH = 10
    if i < 4 then kind := forced[i + 1];
    else kind := pool[public.wp_roll(p_seed, i, 0, 8, 8) + 1]; -- S_CORE_KIND
    end if;
    out := out || jsonb_build_object(
      'x', least(public.wp_w() - 1, px), 'y', least(public.wp_h() - 1, py), 'b', kind);
  end loop;
  return out;
end $$;

/* Nearest core, with the per-tile fuzz that ragged-edges the biome borders.
   Everything is scaled by 1000 and stays integer — the JS twin does the same —
   because an argmin over floats is precisely where two implementations
   eventually disagree by one tile. */
create or replace function public.wp_biome_at(p_seed bigint, p_x int, p_y int, p_cores jsonb default null)
returns text language plpgsql immutable parallel safe as $$
declare
  cores jsonb := coalesce(p_cores, public.wp_cores(p_seed));
  i int; dx int; dy int; d bigint; bestd bigint := null; best text := 'plains';
begin
  for i in 0..11 loop
    dx := (cores->i->>'x')::int - p_x;
    dy := (cores->i->>'y')::int - p_y;
    d := (dx::bigint * dx + dy::bigint * dy) * (940 + public.wp_roll(p_seed, p_x * 64 + i, p_y, 12, 120));
    if bestd is null or d < bestd then bestd := d; best := cores->i->>'b'; end if;
  end loop;
  return best;
end $$;

-- ── Terrain ──────────────────────────────────────────────────────────────
create or replace function public.wp_is_water(p_seed bigint, p_x int, p_y int)
returns boolean language sql immutable parallel safe as $$
  select case
    when public.wp_on_lattice(p_x, p_y) then false
    when p_x < 1 or p_y < 1 or p_x >= public.wp_w() - 1 or p_y >= public.wp_h() - 1 then false
    when public.wp_roll(p_seed, p_x / 3, p_y / 3, 1, 100) >= 17 then false
    else public.wp_roll(p_seed, p_x, p_y, 41, 100) < 62
  end
$$;

create or replace function public.wp_move_cost(p_seed bigint, p_x int, p_y int, p_biome text default null)
returns int language plpgsql immutable parallel safe as $$
declare b text; base int;
begin
  if public.wp_on_lattice(p_x, p_y) then return 1; end if;
  b := coalesce(p_biome, public.wp_biome_at(p_seed, p_x, p_y));
  base := case when b = 'mountain' then 2 else 1 end;          -- BIOMES[*].moveBase
  return least(3, base + case when public.wp_roll(p_seed, p_x, p_y, 2, 100) < 26 then 1 else 0 end);
end $$;

-- ── Resource nodes ───────────────────────────────────────────────────────
-- The weights and yields live in tables rather than inside a function so that
-- the client, this database and a human auditor are all reading the SAME
-- numbers. `ord` must match the array order in warpath-mapgen.js exactly —
-- the kind is picked by walking a cumulative weight, so order is semantic.
create table if not exists public.warpath_resources (
  kind       text primary key,
  tier       text not null check (tier in ('expedition','extraction')),
  yield_min  int  not null,
  yield_max  int  not null
);
insert into public.warpath_resources (kind, tier, yield_min, yield_max) values
  ('wood','expedition',8,22), ('stone','expedition',8,20), ('iron','expedition',5,14),
  ('food','expedition',10,28), ('essence','expedition',4,12), ('gold','expedition',12,40),
  ('dragon_heart','extraction',1,1), ('void_crystal','extraction',1,1),
  ('celestial_ore','extraction',1,1), ('ancient_bone','extraction',1,1),
  ('ouroboros_core','extraction',1,1), ('kalon_fragment','extraction',1,1)
on conflict (kind) do update set tier = excluded.tier,
  yield_min = excluded.yield_min, yield_max = excluded.yield_max;

create table if not exists public.warpath_biome_nodes (
  biome   text not null,
  ord     int  not null,
  kind    text not null references public.warpath_resources(kind),
  weight  int  not null,
  primary key (biome, ord)
);
create table if not exists public.warpath_biomes (
  biome        text primary key,
  node_density int not null,
  move_base    int not null
);
insert into public.warpath_biomes (biome, node_density, move_base) values
  ('plains',34,1), ('forest',46,1), ('graveyard',40,1),
  ('facility',36,1), ('mountain',42,2), ('wastes',22,1)
on conflict (biome) do update set node_density = excluded.node_density, move_base = excluded.move_base;

delete from public.warpath_biome_nodes;
insert into public.warpath_biome_nodes (biome, ord, kind, weight) values
  ('plains',0,'food',40),('plains',1,'gold',24),('plains',2,'wood',20),('plains',3,'stone',16),
  ('forest',0,'wood',38),('forest',1,'food',24),('forest',2,'essence',20),('forest',3,'kalon_fragment',4),('forest',4,'gold',14),
  ('graveyard',0,'essence',34),('graveyard',1,'ancient_bone',14),('graveyard',2,'stone',22),('graveyard',3,'gold',20),('graveyard',4,'void_crystal',4),('graveyard',5,'wood',12),
  ('facility',0,'iron',36),('facility',1,'essence',22),('facility',2,'ouroboros_core',12),('facility',3,'gold',22),('facility',4,'celestial_ore',5),('facility',5,'wood',8),
  ('mountain',0,'stone',34),('mountain',1,'iron',26),('mountain',2,'dragon_heart',10),('mountain',3,'celestial_ore',8),('mountain',4,'food',12),('mountain',5,'wood',8),
  ('wastes',0,'stone',30),('wastes',1,'iron',22),('wastes',2,'void_crystal',10),('wastes',3,'gold',24),('wastes',4,'essence',12),('wastes',5,'wood',10);

-- The node on a tile, or null. Mirrors nodeAt(). THIS is the function that
-- decides what a player is allowed to claim to have harvested.
create or replace function public.wp_node_at(p_seed bigint, p_x int, p_y int, p_biome text default null)
returns jsonb language plpgsql stable parallel safe as $$
declare
  b text; dens int; total int; r int; acc int := 0; k text; rec record;
  ymin int; ymax int; tier text; amt int;
begin
  if public.wp_is_water(p_seed, p_x, p_y) then return null; end if;
  b := coalesce(p_biome, public.wp_biome_at(p_seed, p_x, p_y));
  select node_density into dens from public.warpath_biomes where biome = b;
  if dens is null then return null; end if;
  if public.wp_roll(p_seed, p_x, p_y, 3, 1000) >= dens * 10 then return null; end if;   -- S_NODE

  select sum(weight) into total from public.warpath_biome_nodes where biome = b;
  r := public.wp_roll(p_seed, p_x, p_y, 4, total);                                      -- S_NODE_KIND
  for rec in select kind, weight from public.warpath_biome_nodes where biome = b order by ord loop
    acc := acc + rec.weight;
    if r < acc then k := rec.kind; exit; end if;
  end loop;
  if k is null then select kind into k from public.warpath_biome_nodes where biome = b order by ord limit 1; end if;

  select yield_min, yield_max, warpath_resources.tier into ymin, ymax, tier
    from public.warpath_resources where kind = k;
  amt := ymin + public.wp_roll(p_seed, p_x, p_y, 5, ymax - ymin + 1);                   -- S_NODE_AMT
  return jsonb_build_object('kind', k, 'amount', amt, 'tier', tier);
end $$;

/* ── Structures ───────────────────────────────────────────────────────────
   Mirrors placeStructures(): ONE pass, fixed order, 5-tile minimum separation,
   walking forward through the row-major list of lattice tiles. Placing each
   list separately is what let a spawn land on a recruitment site in the JS
   version, so this must stay a single pass here too.

   Returns [{k,id,x,y,...}] where k is 'gate' | 'site' | 'landmark' | 'spawn'. */
create or replace function public.wp_structures(p_seed bigint)
returns jsonb language plpgsql immutable parallel safe as $$
declare
  lat int[][];            -- row-major lattice tiles
  n int; claimed int[][] := ARRAY[]::int[][]; nclaim int := 0;
  cores jsonb := public.wp_cores(p_seed);
  out jsonb := '[]'::jsonb;
  i int; j int; k int; s int[]; startk int := 0; px int; py int; ok boolean;
  ox int; oy int;
  site_ids   text[] := ARRAY['forest_hollow','barrow_gate','assembly_floor'];
  site_names text[] := ARRAY['Verdant Hollow','The Barrow Gate','Assembly Floor 3'];
  gate_names text[] := ARRAY['Weeping Portal','Cracked Portal'];
  lm_ids     text[] := ARRAY['black_pyramid','the_garden','drowned_choir'];
  lm_names   text[] := ARRAY['The Black Pyramid','The Garden','The Drowned Choir'];
  qx numeric[] := ARRAY[0.16,0.84,0.16,0.84];
  qy numeric[] := ARRAY[0.18,0.18,0.82,0.82];
  li int;
  placed int[];
begin
  -- Row-major lattice tile list (order matters: the walk steps through it).
  select array_agg(ARRAY[gx2, gy2] order by gy2, gx2) into lat
    from generate_series(0, public.wp_h() - 1) gy2,
         generate_series(0, public.wp_w() - 1) gx2
   where public.wp_on_lattice(gx2, gy2);
  n := array_length(lat, 1);

  -- place(): snap, then walk forward until far enough from everything placed.
  -- Inlined as a loop below because plpgsql has no closures.
  <<placeall>>
  for i in 0..10 loop
    -- Work out the DESIRED spot for structure i, in the same fixed order the
    -- JS uses: gate_main, gate_0, gate_1, three sites, landmark, four spawns.
    if i = 0 then
      px := public.wp_w() / 2; py := public.wp_h() / 2;
    elsif i <= 2 then
      j := i - 1;
      px := public.wp_roll(p_seed, j, 0, 10, public.wp_w() - 8) + 4;         -- S_GATE
      py := public.wp_roll(p_seed, j, 1, 10, public.wp_h() - 8) + 4;
    elsif i <= 5 then
      j := i - 3;
      ox := public.wp_roll(p_seed, j, 0, 13, 7) - 3;                          -- S_RECRUIT
      oy := public.wp_roll(p_seed, j, 1, 13, 7) - 3;
      px := (cores->j->>'x')::int + ox;
      py := (cores->j->>'y')::int + oy;
    elsif i = 6 then
      px := public.wp_roll(p_seed, 1, 0, 11, public.wp_w() - 10) + 5;         -- S_LANDMARK
      py := public.wp_roll(p_seed, 1, 1, 11, public.wp_h() - 10) + 5;
    else
      j := i - 7;
      px := round(public.wp_w() * qx[j + 1])::int + public.wp_roll(p_seed, j, 0, 9, 7) - 3;   -- S_SPAWN
      py := round(public.wp_h() * qy[j + 1])::int + public.wp_roll(p_seed, j, 1, 9, 5) - 2;
    end if;

    s := public.wp_snap(px, py);
    startk := 0;
    for k in 1..n loop
      if lat[k][1] = s[1] and lat[k][2] = s[2] then startk := k - 1; exit; end if;
    end loop;

    placed := null;
    for k in 0..(n - 1) loop
      j := ((startk + k) % n) + 1;
      ok := true;
      for li in 1..nclaim loop
        if greatest(abs(lat[j][1] - claimed[li][1]), abs(lat[j][2] - claimed[li][2])) < 5 then
          ok := false; exit;
        end if;
      end loop;
      if ok then placed := ARRAY[lat[j][1], lat[j][2]]; exit; end if;
    end loop;
    if placed is null then raise exception 'wp_structures: lattice exhausted'; end if;

    nclaim := nclaim + 1;
    claimed := claimed || ARRAY[ARRAY[placed[1], placed[2]]];

    -- Emit
    if i = 0 then
      out := out || jsonb_build_object('k','gate','id','gate_main','name','The Warpath Gate',
                                       'main',true,'x',placed[1],'y',placed[2]);
    elsif i <= 2 then
      out := out || jsonb_build_object('k','gate','id','gate_' || (i-1),'name',gate_names[i],
                                       'main',false,'x',placed[1],'y',placed[2]);
    elsif i <= 5 then
      out := out || jsonb_build_object('k','site','id',site_ids[i-2],'name',site_names[i-2],
                                       'x',placed[1],'y',placed[2]);
    elsif i = 6 then
      li := public.wp_roll(p_seed, 0, 0, 11, 3);
      out := out || jsonb_build_object('k','landmark','id',lm_ids[li+1],'name',lm_names[li+1],
                                       'guardian', lm_ids[li+1] <> 'the_garden',
                                       'x',placed[1],'y',placed[2]);
    else
      out := out || jsonb_build_object('k','spawn','id','spawn_' || (i-7),'slot',i-7,
                                       'x',placed[1],'y',placed[2]);
    end if;
  end loop;
  return out;
end $$;

-- Convenience lookups over wp_structures.
create or replace function public.wp_structure_at(p_seed bigint, p_x int, p_y int)
returns jsonb language sql stable parallel safe as $$
  select s from jsonb_array_elements(public.wp_structures(p_seed)) s
   where (s->>'x')::int = p_x and (s->>'y')::int = p_y limit 1
$$;

create or replace function public.wp_spawn(p_seed bigint, p_slot int)
returns int[] language sql stable parallel safe as $$
  select ARRAY[(s->>'x')::int, (s->>'y')::int]
    from jsonb_array_elements(public.wp_structures(p_seed)) s
   where s->>'k' = 'spawn' and (s->>'slot')::int = p_slot limit 1
$$;

/* ── Movement validation ──────────────────────────────────────────────────
   Bounded Bellman-Ford over the (2*budget+1)^2 window around the hero. Budget
   is 6, so this is a 13x13 = 169-cell relaxation run 6 times — cheap enough to
   run on every move, which is the point: the server does not take the client's
   word for how far it walked. Returns the true minimum cost, or null if the
   destination is not reachable within budget. */
create or replace function public.wp_path_cost(p_seed bigint, p_fx int, p_fy int,
                                               p_tx int, p_ty int, p_budget int)
returns int language plpgsql stable parallel safe as $$
declare
  span int := p_budget; size int := p_budget * 2 + 1;
  cost int[]; nx int; ny int; ax int; ay int; tgx int; tgy int;
  pass boolean[]; mc int[];
  i int; j int; it int; changed boolean; c int; nc int;
begin
  if p_fx = p_tx and p_fy = p_ty then return 0; end if;
  if greatest(abs(p_tx - p_fx), abs(p_ty - p_fy)) > p_budget then return null; end if;

  -- Window arrays are 1-based: index (dy+span+1, dx+span+1).
  cost := array_fill(999999, ARRAY[size, size]);
  pass := array_fill(false,  ARRAY[size, size]);
  mc   := array_fill(9,      ARRAY[size, size]);
  for i in 1..size loop
    for j in 1..size loop
      ax := p_fx + (j - 1 - span); ay := p_fy + (i - 1 - span);
      if ax >= 0 and ay >= 0 and ax < public.wp_w() and ay < public.wp_h()
         and not public.wp_is_water(p_seed, ax, ay) then
        pass[i][j] := true;
        mc[i][j] := public.wp_move_cost(p_seed, ax, ay);
      end if;
    end loop;
  end loop;
  cost[span + 1][span + 1] := 0;

  for it in 1..p_budget loop
    changed := false;
    for i in 1..size loop
      for j in 1..size loop
        c := cost[i][j];
        if c >= 999999 then continue; end if;
        for ny in greatest(1, i - 1)..least(size, i + 1) loop
          for nx in greatest(1, j - 1)..least(size, j + 1) loop
            if nx = j and ny = i then continue; end if;
            if not pass[ny][nx] then continue; end if;
            nc := c + mc[ny][nx];
            if nc <= p_budget and nc < cost[ny][nx] then
              cost[ny][nx] := nc; changed := true;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
    exit when not changed;
  end loop;

  tgx := p_tx - p_fx + span + 1; tgy := p_ty - p_fy + span + 1;
  if cost[tgy][tgx] >= 999999 then return null; end if;
  return cost[tgy][tgx];
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 — RUN STATE (temporary, run-scoped, RPC-write-only)
-- ═══════════════════════════════════════════════════════════════════════════

-- 🎟 Warpath Tickets. Server-authoritative — deliberately NOT the client's
-- Profile.sovereigns wallet, which lives inside the save blob and is therefore
-- whatever the client says it is. Tickets are granted by quests / battle pass /
-- admin, and spent here.
create table if not exists public.warpath_tickets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  tickets    int not null default 0 check (tickets >= 0),
  lifetime   int not null default 0,
  updated_at timestamptz not null default now()
);

-- WarpathRun — one world, up to four heroes.
create table if not exists public.warpath_runs (
  id          uuid primary key default gen_random_uuid(),
  seed        bigint not null,
  rarity      text not null default 'common' check (rarity in ('common','rare','epic','mythic')),
  status      text not null default 'open'  check (status in ('open','active','closed')),
  turn        int  not null default 1,
  max_turns   int  not null default 60,
  max_players int  not null default 4,
  -- ⏱ Turn clock. A COLUMN DEFAULT, not a literal in a function, so the
  -- deadline can be retuned without a migration.
  turn_seconds  int not null default 90,
  turn_deadline timestamptz,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
alter table public.warpath_runs add column if not exists turn_seconds int not null default 90;
alter table public.warpath_runs add column if not exists turn_deadline timestamptz;
create index if not exists warpath_runs_open_idx on public.warpath_runs (status, created_at)
  where status = 'open';
-- Negative seeds are the ONLY inputs where warpath-mapgen.js and the wp_*
-- mirror can disagree — the JS side documents "NO NEGATIVE INPUTS" in a
-- comment and nothing enforced it. Now something does.
do $$ begin
  alter table public.warpath_runs add constraint warpath_runs_seed_nonneg check (seed >= 0);
exception when duplicate_object then null; end $$;

-- PlayerExpedition + HeroExpeditionState. One row per player per run. `fog` is
-- a 1320-bit bitmap (165 bytes) rather than a revealed-tiles table — four
-- players x ~400 tiles would be 1600 rows per run for something that is
-- literally a set of bits.
create table if not exists public.warpath_expeditions (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.warpath_runs(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  slot           int  not null check (slot between 0 and 3),
  hero_id        text not null,
  hero_name      text,
  hero_hp        int  not null default 100,
  hero_max_hp    int  not null default 100,
  x              int  not null,
  y              int  not null,
  moves_left     int  not null default 6,
  injured_turns  int  not null default 0,
  turn_ended     boolean not null default false,
  status         text not null default 'active'
                 check (status in ('active','extracting','ready','extracted','lost')),
  extract_left   int  not null default 0,
  entry_paid     text not null default 'ticket' check (entry_paid in ('ticket','aza','free')),
  fog            bytea not null default decode(repeat('00', 165), 'hex'),
  -- run statistics, for the EXPEDITION COMPLETE screen
  stat_distance  int not null default 0,
  stat_defeated  int not null default 0,
  stat_raided    int not null default 0,
  stat_bosses    int not null default 0,
  -- B4: a hero beaten in PvP cannot be re-challenged until this run turn.
  protected_until int not null default 0,
  scouted_turn    int not null default 0,
  -- ⏱ consecutive turns ended by the deadline rather than by the player
  auto_ends       int not null default 0,
  away            boolean not null default false,
  entered_at     timestamptz not null default now(),
  ended_at       timestamptz,
  unique (run_id, user_id),
  unique (run_id, slot)
);
alter table public.warpath_expeditions add column if not exists protected_until int not null default 0;
alter table public.warpath_expeditions add column if not exists scouted_turn int not null default 0;
alter table public.warpath_expeditions add column if not exists auto_ends int not null default 0;
alter table public.warpath_expeditions add column if not exists away boolean not null default false;
create index if not exists warpath_exp_user_idx on public.warpath_expeditions (user_id, status);

-- Camp. One movable camp per expedition (the brief's PACK CAMP / FORWARD CAMP;
-- Milestone 1 allows moving it, but not running two at once).
create table if not exists public.warpath_camps (
  expedition_id uuid primary key references public.warpath_expeditions(id) on delete cascade,
  run_id        uuid not null references public.warpath_runs(id) on delete cascade,
  x int not null,
  y int not null,
  buildings     jsonb not null default '{"campfire":1}'::jsonb,
  placed_turn   int not null default 1,
  moved_count   int not null default 0
);
create index if not exists warpath_camps_run_idx on public.warpath_camps (run_id);

-- ExpeditionInventory. `carried` is on the Hero and can be lost; `secured` is
-- in the camp vault and cannot. That split is the entire risk/reward loop.
create table if not exists public.warpath_inventory (
  expedition_id uuid not null references public.warpath_expeditions(id) on delete cascade,
  kind          text not null references public.warpath_resources(kind),
  carried       int  not null default 0 check (carried >= 0),
  secured       int  not null default 0 check (secured >= 0),
  primary key (expedition_id, kind)
);

-- TemporaryCardPool. Every card drafted this run. NOT the player's collection —
-- nothing reads this table from the permanent side.
create table if not exists public.warpath_cards (
  id            uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references public.warpath_expeditions(id) on delete cascade,
  card_key      text not null,
  source        text not null check (source in ('starter','recruit','discovery','boss','battle')),
  secured       boolean not null default false,
  acquired_turn int not null default 1
);
create index if not exists warpath_cards_exp_idx on public.warpath_cards (expedition_id);

-- ResourceNode depletion. A node is claimed ONCE per run, by whoever gets there
-- first — which is most of what makes four heroes on one map interesting.
create table if not exists public.warpath_node_claims (
  run_id     uuid not null references public.warpath_runs(id) on delete cascade,
  x          int  not null,
  y          int  not null,
  claimed_by uuid not null references public.warpath_expeditions(id) on delete cascade,
  kind       text not null,
  amount     int  not null,
  turn       int  not null,
  primary key (run_id, x, y)
);

-- Encounter (the draft). Rolled server-side from the tile hash and STORED, so
-- reloading the page cannot re-roll a bad pick into a good one.
create table if not exists public.warpath_encounters (
  id            uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references public.warpath_expeditions(id) on delete cascade,
  x int not null,
  y int not null,
  biome         text not null,
  offers        jsonb not null,
  picked        int,
  created_turn  int not null,
  unique (expedition_id, x, y)
);

-- RecruitmentPool claims — one recruit per site per expedition. Pick 1 of 3.
create table if not exists public.warpath_recruit_claims (
  expedition_id uuid not null references public.warpath_expeditions(id) on delete cascade,
  site_id       text not null,
  offer_idx     int  not null,
  card_key      text not null,
  turn          int  not null,
  primary key (expedition_id, site_id)
);

-- BattleEncounter. The Warpath's ENTIRE involvement in a card battle: it
-- records that one is owed, and it records the verdict when the real engine
-- returns one. There is no board, no deck and no damage in this table.
create table if not exists public.warpath_battles (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.warpath_runs(id) on delete cascade,
  kind          text not null check (kind in ('pvp','guardian')),
  attacker_id   uuid not null references public.warpath_expeditions(id) on delete cascade,
  defender_id   uuid references public.warpath_expeditions(id) on delete cascade,
  x int not null,
  y int not null,
  status        text not null default 'open' check (status in ('open','resolved','abandoned')),
  winner_id     uuid references public.warpath_expeditions(id) on delete set null,
  spoils        jsonb,
  opened_turn   int,
  -- B5: each participant's own claim about who won.
  claim_attacker uuid,
  claim_defender uuid,
  -- ⏱ WALL-CLOCK expiry, deliberately not turn-counted. See wp_expire_battles.
  expires_at    timestamptz,
  opened_at     timestamptz not null default now(),
  resolved_at   timestamptz
);
alter table public.warpath_battles add column if not exists opened_turn int;
alter table public.warpath_battles add column if not exists claim_attacker uuid;
alter table public.warpath_battles add column if not exists claim_defender uuid;
alter table public.warpath_battles add column if not exists expires_at timestamptz;
create index if not exists warpath_battles_run_idx on public.warpath_battles (run_id, status);
create index if not exists warpath_battles_pair_idx on public.warpath_battles
  (run_id, attacker_id, defender_id, opened_turn);

-- The run feed. Scout reports, extraction warnings, battle results — the
-- "⚠ A HERO IS PREPARING TO LEAVE THE WARPATH" broadcast lives here.
create table if not exists public.warpath_events (
  id            bigint generated always as identity primary key,
  run_id        uuid not null references public.warpath_runs(id) on delete cascade,
  expedition_id uuid references public.warpath_expeditions(id) on delete cascade,
  turn          int not null,
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists warpath_events_run_idx on public.warpath_events (run_id, id desc);

/* ⭐ THE ONLY BRIDGE TO PERMANENT DATA.
   warpath_extract_finish() is the only writer. The game client drains
   unclaimed rows on next load and applies them to Profile.cardCollection.
   If you are auditing "can a Warpath bug corrupt my collection?", this table
   and that one function are the entire attack surface. */
create table if not exists public.warpath_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  run_id     uuid not null references public.warpath_runs(id) on delete cascade,
  card_keys  text[] not null default '{}',
  materials  jsonb  not null default '{}'::jsonb,
  summary    jsonb  not null default '{}'::jsonb,
  claimed    boolean not null default false,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (user_id, run_id)
);
create index if not exists warpath_grants_open_idx on public.warpath_grants (user_id)
  where claimed = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3 — RLS. Read for participants. NO write policies anywhere: every
-- mutation goes through the security-definer RPCs in Part 4.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.warpath_tickets        enable row level security;
alter table public.warpath_runs           enable row level security;
alter table public.warpath_expeditions    enable row level security;
alter table public.warpath_camps          enable row level security;
alter table public.warpath_inventory      enable row level security;
alter table public.warpath_cards          enable row level security;
alter table public.warpath_node_claims    enable row level security;
alter table public.warpath_encounters     enable row level security;
alter table public.warpath_recruit_claims enable row level security;
alter table public.warpath_battles        enable row level security;
alter table public.warpath_events         enable row level security;
alter table public.warpath_grants         enable row level security;
alter table public.warpath_resources      enable row level security;
alter table public.warpath_biomes         enable row level security;
alter table public.warpath_biome_nodes    enable row level security;

-- Am I in this run?
create or replace function public.wp_in_run(p_run uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.warpath_expeditions
                  where run_id = p_run and user_id = auth.uid())
$$;
-- Is this expedition mine?
create or replace function public.wp_is_mine(p_exp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.warpath_expeditions
                  where id = p_exp and user_id = auth.uid())
$$;

drop policy if exists wp_tickets_sel on public.warpath_tickets;
create policy wp_tickets_sel on public.warpath_tickets for select to authenticated using (user_id = auth.uid());

drop policy if exists wp_runs_sel on public.warpath_runs;
create policy wp_runs_sel on public.warpath_runs for select to authenticated
  using (status = 'open' or public.wp_in_run(id));

/* ⚠ OWN ROW ONLY. This used to allow reading every expedition in your run,
   on the reasoning that warpath_state() filters other heroes against your fog
   before sending them. warpath_state() does — but a critic simply read the
   TABLE through PostgREST instead and got `x=37 y=3 hp=100` for a hero it
   could not see. Fog of war enforced by one function while the underlying row
   is world-readable to the run is not enforced at all.

   Other players now reach you ONLY through warpath_state(), which is security
   definer and applies the fog. */
drop policy if exists wp_exp_sel on public.warpath_expeditions;
create policy wp_exp_sel on public.warpath_expeditions for select to authenticated
  using (user_id = auth.uid());

-- Same reasoning: a camp's coordinates are exactly what the Watchtower is for.
-- Rival camps arrive through warpath_state(), gated on your explored fog.
drop policy if exists wp_camps_sel on public.warpath_camps;
create policy wp_camps_sel on public.warpath_camps for select to authenticated
  using (public.wp_is_mine(expedition_id));

drop policy if exists wp_inv_sel on public.warpath_inventory;
create policy wp_inv_sel on public.warpath_inventory for select to authenticated using (public.wp_is_mine(expedition_id));

drop policy if exists wp_cards_sel on public.warpath_cards;
create policy wp_cards_sel on public.warpath_cards for select to authenticated using (public.wp_is_mine(expedition_id));

drop policy if exists wp_claims_sel on public.warpath_node_claims;
create policy wp_claims_sel on public.warpath_node_claims for select to authenticated using (public.wp_in_run(run_id));

drop policy if exists wp_enc_sel on public.warpath_encounters;
create policy wp_enc_sel on public.warpath_encounters for select to authenticated using (public.wp_is_mine(expedition_id));

drop policy if exists wp_rec_sel on public.warpath_recruit_claims;
create policy wp_rec_sel on public.warpath_recruit_claims for select to authenticated using (public.wp_is_mine(expedition_id));

drop policy if exists wp_bat_sel on public.warpath_battles;
create policy wp_bat_sel on public.warpath_battles for select to authenticated using (public.wp_in_run(run_id));

drop policy if exists wp_ev_sel on public.warpath_events;
create policy wp_ev_sel on public.warpath_events for select to authenticated using (public.wp_in_run(run_id));

drop policy if exists wp_grants_sel on public.warpath_grants;
create policy wp_grants_sel on public.warpath_grants for select to authenticated using (user_id = auth.uid());

-- Static content tables — readable by anyone signed in, written by migration only.
drop policy if exists wp_res_sel on public.warpath_resources;
create policy wp_res_sel on public.warpath_resources for select to authenticated using (true);
drop policy if exists wp_biomes_sel on public.warpath_biomes;
create policy wp_biomes_sel on public.warpath_biomes for select to authenticated using (true);
drop policy if exists wp_bnodes_sel on public.warpath_biome_nodes;
create policy wp_bnodes_sel on public.warpath_biome_nodes for select to authenticated using (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4 — SERVER-SIDE CONTENT
-- The client has these same tables in public/warpath/warpath-data.js, because
-- it has to draw them. The server has them because it must never take the
-- client's word for what a recruit costs or which cards were on offer.
-- public/warpath/_sqlcheck.js diffs the two copies.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.warpath_recruit_offers (
  site_id  text not null,
  idx      int  not null,
  card_key text not null,
  rank     int  not null,
  cost     jsonb not null,
  label    text not null,
  primary key (site_id, idx)
);
delete from public.warpath_recruit_offers;
insert into public.warpath_recruit_offers (site_id, idx, card_key, rank, cost, label) values
  ('forest_hollow',0,'unit:wolf',1,'{"food":30}','Dire Wolf'),
  ('forest_hollow',1,'unit:spider',2,'{"food":40,"essence":10}','Giant Spider'),
  ('forest_hollow',2,'unit:troll',4,'{"food":100,"gold":50}','Cave Troll'),
  ('barrow_gate',0,'unit:spider',1,'{"essence":18}','Crypt Spider'),
  ('barrow_gate',1,'unit:lich',3,'{"essence":45,"gold":30}','Lich Apprentice'),
  ('barrow_gate',2,'unit:golem',3,'{"essence":35,"stone":40}','Bone Golem'),
  ('assembly_floor',0,'unit:sprite',2,'{"iron":20,"essence":10}','Ignition Wisp'),
  ('assembly_floor',1,'unit:ice',3,'{"iron":35,"essence":25}','Coolant Elemental'),
  ('assembly_floor',2,'unit:paladin',4,'{"iron":60,"gold":40}','Ouroboros Sentinel');

create table if not exists public.warpath_discovery (
  biome    text not null,
  ord      int  not null,
  card_key text not null,
  weight   int  not null,
  primary key (biome, ord)
);
create table if not exists public.warpath_discovery_meta (
  biome  text primary key,
  chance int not null,
  title  text not null
);
delete from public.warpath_discovery_meta;
insert into public.warpath_discovery_meta (biome, chance, title) values
  ('forest',16,'THE WOOD OFFERS'), ('graveyard',18,'SOMETHING SITS UP'),
  ('facility',17,'A CABINET UNSEALS'), ('mountain',15,'THE MOUNTAIN NOTICES YOU'),
  ('plains',9,'A TRAVELLER STOPS'), ('wastes',11,'BURIED, BUT NOT DEEPLY');
delete from public.warpath_discovery;
insert into public.warpath_discovery (biome, ord, card_key, weight) values
  ('forest',0,'unit:wolf',20),('forest',1,'unit:troll',8),('forest',2,'unit:spider',16),('forest',3,'unit:archer',14),
  ('forest',4,'trap:razorVines',12),('forest',5,'trap:snare',12),('forest',6,'trap:plagueBloom',8),('forest',7,'trap:sleepPowder',8),
  ('forest',8,'location:forest',18),('forest',9,'location:poisonBog',10),('forest',10,'location:mire',10),
  ('forest',11,'spell:frostwind',6),('forest',12,'spell:tarPit',8),
  ('graveyard',0,'unit:lich',12),('graveyard',1,'unit:spider',14),('graveyard',2,'unit:golem',12),('graveyard',3,'unit:priest',8),
  ('graveyard',4,'trap:soulSnare',14),('graveyard',5,'trap:hexSigil',12),('graveyard',6,'trap:boneCrusher',12),('graveyard',7,'trap:plagueSpore',10),
  ('graveyard',8,'location:cursedEarth',16),('graveyard',9,'location:necropolis',10),('graveyard',10,'location:altar',12),
  ('graveyard',11,'weather:bloodmoon',5),('graveyard',12,'weather:eclipse',5),
  ('facility',0,'unit:xenoDrone',14),('facility',1,'unit:hiveDrone',12),('facility',2,'unit:parasiteHost',8),('facility',3,'unit:ice',12),
  ('facility',4,'trap:staticMine',14),('facility',5,'trap:nullGlyph',12),('facility',6,'trap:aetherNet',12),('facility',7,'trap:xenoBurst',8),
  ('facility',8,'location:medicalCenter',12),('facility',9,'location:skyCitadel',10),('facility',10,'location:manaFont',12),
  ('facility',11,'spell:arcaneInsight',8),('facility',12,'spell:suppressAwakening',5),
  ('mountain',0,'unit:orc',16),('mountain',1,'unit:troll',12),('mountain',2,'unit:golem',14),('mountain',3,'unit:paladin',8),('mountain',4,'unit:broodTyrant',3),
  ('mountain',5,'trap:magmaVent',16),('mountain',6,'trap:flameBurst',14),('mountain',7,'trap:spikes',10),
  ('mountain',8,'location:lava',16),('mountain',9,'location:forgeAnvil',12),('mountain',10,'location:bastion',10),
  ('mountain',11,'spell:fireblast',10),('mountain',12,'spell:wrath',6),
  ('plains',0,'unit:goblin',20),('plains',1,'unit:archer',16),('plains',2,'unit:orc',14),('plains',3,'unit:priest',12),
  ('plains',4,'trap:caltrops',14),('plains',5,'trap:bearTrap',12),('plains',6,'trap:snare',10),
  ('plains',7,'location:watchtower',14),('plains',8,'location:holySpring',12),('plains',9,'location:forest',12),
  ('plains',10,'spell:rally',10),('plains',11,'spell:mend',10),
  ('wastes',0,'unit:golem',16),('wastes',1,'unit:goblin',14),('wastes',2,'unit:ice',10),('wastes',3,'unit:lich',8),
  ('wastes',4,'trap:frostGlyph',14),('wastes',5,'trap:mirePit',12),('wastes',6,'trap:caltrops',12),
  ('wastes',7,'location:sandstormDunes',16),('wastes',8,'location:mire',12),('wastes',9,'location:bastion',10),
  ('wastes',10,'weather:sandstorm',8),('wastes',11,'weather:mistveil',6);

create table if not exists public.warpath_building_costs (
  building text not null,
  level    int  not null,
  cost     jsonb not null,
  primary key (building, level)
);
delete from public.warpath_building_costs;
insert into public.warpath_building_costs (building, level, cost) values
  ('campfire',1,'{}'),
  ('recruitment',1,'{"wood":25,"food":20}'),('recruitment',2,'{"wood":60,"iron":20,"food":40}'),('recruitment',3,'{"wood":90,"iron":50,"essence":30}'),
  ('blacksmith',1,'{"stone":30,"iron":15}'),('blacksmith',2,'{"stone":60,"iron":40}'),('blacksmith',3,'{"stone":90,"iron":70,"essence":25}'),
  ('supply',1,'{"wood":20,"food":10}'),('supply',2,'{"wood":45,"stone":30}'),('supply',3,'{"wood":70,"stone":55,"iron":30}'),
  ('watchtower',1,'{"wood":40,"stone":20}'),('watchtower',2,'{"wood":70,"stone":50,"iron":25}'),
  ('arcane',1,'{"essence":25,"wood":20}'),('arcane',2,'{"essence":60,"iron":30}');

-- The kit a fresh expedition arrives with. A TABLE rather than a CASE inside
-- warpath_enter(), so public/warpath/_sqlcheck.js can diff it against
-- STARTING_STIPEND in warpath-data.js and the two copies cannot drift.
create table if not exists public.warpath_starting_stipend (
  kind   text primary key references public.warpath_resources(kind),
  amount int not null
);
delete from public.warpath_starting_stipend;
insert into public.warpath_starting_stipend (kind, amount) values
  ('wood',25),('food',20),('stone',15),('gold',10),('iron',0),('essence',0);

-- The 24-card starter pool, so the server (not the client) decides what a
-- fresh expedition walks in with. Mirrors STARTER_POOL in warpath-data.js.
create table if not exists public.warpath_starter_pool (
  ord int primary key,
  card_key text not null
);
delete from public.warpath_starter_pool;
insert into public.warpath_starter_pool (ord, card_key) values
  (0,'unit:goblin'),(1,'unit:goblin'),(2,'unit:wolf'),(3,'unit:wolf'),(4,'unit:archer'),
  (5,'unit:orc'),(6,'unit:spider'),(7,'unit:priest'),(8,'unit:sprite'),(9,'unit:golem'),
  (10,'trap:spikes'),(11,'trap:snare'),(12,'trap:caltrops'),(13,'trap:bearTrap'),
  (14,'location:forest'),(15,'location:forest'),(16,'location:manaFont'),(17,'location:manaFont'),
  (18,'location:altar'),(19,'location:holySpring'),(20,'location:watchtower'),(21,'location:mire'),
  (22,'spell:mend'),(23,'spell:bolt');

alter table public.warpath_recruit_offers  enable row level security;
alter table public.warpath_discovery       enable row level security;
alter table public.warpath_discovery_meta  enable row level security;
alter table public.warpath_building_costs  enable row level security;
alter table public.warpath_starter_pool    enable row level security;
alter table public.warpath_starting_stipend enable row level security;
do $$ declare t text; begin
  foreach t in array ARRAY['warpath_recruit_offers','warpath_discovery','warpath_discovery_meta',
                           'warpath_building_costs','warpath_starter_pool',
                           'warpath_starting_stipend'] loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_sel', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5 — RPCs. Every mutation in the mode goes through one of these.
-- All `security definer`: the tables have no client write policies at all.
-- ═══════════════════════════════════════════════════════════════════════════

/* Camp building level (0 = not built).

   ⚠ THE OUTER coalesce IS LOad-BEARING. This used to return NULL — not 0 —
   for a hero who had never pitched a camp, because the SELECT matched no row
   at all. Five of its six callers did not coalesce, and the consequences were
   inverted rules rather than errors:
     • a CAMPLESS hero passed the Recruitment Tent gate (NULL comparisons are
       not false, so `offer.rank > tent_ceiling` never fired) and hired the
       rank-4 unit that a hero WITH a camp was correctly refused
     • warpath_extract_finish computed `6 + 3 * NULL` = NULL, so `limit cap`
       became LIMIT ALL and 41 cards went into warpath_grants where the cap
       should have been 6 — no cap at all, in the one function that is the
       only bridge to the permanent collection
   One coalesce closes all five. */
create or replace function public.wp_level(p_exp uuid, p_building text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (buildings->>p_building)::int from public.warpath_camps
                    where expedition_id = p_exp), 0)
$$;

-- Vault slots for EXTRACTION MATERIALS. No Supply Tent = no vault = everything
-- you are carrying can be taken from you. Mirrors VAULT_SLOTS.
create or replace function public.wp_vault_slots(p_exp uuid)
returns int language sql stable security definer set search_path = public as $$
  select (ARRAY[0,5,10,20])[coalesce(public.wp_level(p_exp,'supply'),0) + 1]
$$;

/* Fog. `fog` is a 1320-bit bitmap; bit index is y*44+x, and Postgres numbers
   bytea bits so that bit n is `byte[n/8] | (1 << (n%8))`. The browser reads the
   same base64 with `bytes[i>>3] & (1 << (i&7))`. */
create or replace function public.wp_reveal(p_exp uuid, p_cx int, p_cy int, p_r int)
returns void language plpgsql security definer set search_path = public as $$
declare f bytea; x int; y int; bit int; w int := public.wp_w(); h int := public.wp_h();
begin
  if p_r < 0 then return; end if;
  select fog into f from public.warpath_expeditions where id = p_exp;
  if f is null then return; end if;
  for y in greatest(0, p_cy - p_r)..least(h - 1, p_cy + p_r) loop
    for x in greatest(0, p_cx - p_r)..least(w - 1, p_cx + p_r) loop
      bit := y * w + x;
      f := set_bit(f, bit, 1);
    end loop;
  end loop;
  update public.warpath_expeditions set fog = f where id = p_exp;
end $$;

create or replace function public.wp_explored(p_fog bytea, p_x int, p_y int)
returns boolean language sql immutable as $$
  select get_bit(p_fog, p_y * public.wp_w() + p_x) = 1
$$;

-- Hero vision. Base 2, +1 with a level-2 Watchtower. (Scouts are Milestone 2.)
create or replace function public.wp_vision(p_exp uuid)
returns int language sql stable security definer set search_path = public as $$
  select 2 + case when public.wp_level(p_exp,'watchtower') >= 2 then 1 else 0 end
$$;

-- Append to the run feed.
create or replace function public.wp_log(p_run uuid, p_exp uuid, p_kind text, p_payload jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare t int;
begin
  select turn into t from public.warpath_runs where id = p_run;
  insert into public.warpath_events (run_id, expedition_id, turn, kind, payload)
    values (p_run, p_exp, coalesce(t, 1), p_kind, coalesce(p_payload, '{}'));
end $$;

/* ⭐ THE CALLER'S OWN EXPEDITION, derived from auth.uid().

   ⚠ EVERY MUTATING RPC BELOW TOOK `p_exp uuid` AS ITS FIRST ARGUMENT WITH NO
   DEFAULT, AND NOTHING IN public/ EVER SENT IT. PostgREST resolves overloads by
   argument NAME, so all eleven client call sites failed with PGRST202 before
   reaching the database — and the bridge rewrote that into "The Warpath is not
   installed on this server yet", which hid it for nine review rounds. End turn
   and Abandon were both dead, and since a run can only close inside
   warpath_end_turn, warpath_enter then returned already_in_a_warpath forever:
   a player paid a ticket or 3 AZA and was locked out of the mode permanently.

   The fix is to derive the expedition here rather than to make the client pass
   an id. That is strictly stronger — a client cannot name an expedition it
   does not own even by accident, because it never names one at all — and it
   removes eleven call sites that each had to get it right. Passing p_exp
   explicitly still works (the simulator and the SQL suite do it) and is still
   ownership-checked by wp_my_exp().

   Statuses match warpath_enter's "already in a Warpath" test, so the two can
   never disagree about which expedition is live. */
create or replace function public.wp_active_exp()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.warpath_expeditions
   where user_id = auth.uid() and status in ('active','extracting','ready')
   order by entered_at desc limit 1
$$;

-- My live expedition row, or null. Guards every RPC below.
create or replace function public.wp_my_exp(p_exp uuid)
returns public.warpath_expeditions language sql stable security definer set search_path = public as $$
  select * from public.warpath_expeditions where id = p_exp and user_id = auth.uid()
$$;

/* 🎟 A free ticket, once a week. The brief lists "occasional free tickets" so
   that free players can participate; without at least one source the mode is
   unreachable in a fresh database. Quests / battle pass / events can top this
   up by writing to warpath_tickets directly from their own RPCs. */
create or replace function public.warpath_claim_free_ticket()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.warpath_tickets;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  insert into public.warpath_tickets (user_id, tickets, lifetime, updated_at)
    values (v_uid, 0, 0, now() - interval '8 days')
    on conflict (user_id) do nothing;
  select * into v_row from public.warpath_tickets where user_id = v_uid;
  if v_row.updated_at > now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed',
                              'next_at', v_row.updated_at + interval '7 days', 'tickets', v_row.tickets);
  end if;
  update public.warpath_tickets
     set tickets = tickets + 1, lifetime = lifetime + 1, updated_at = now()
   where user_id = v_uid returning * into v_row;
  return jsonb_build_object('ok', true, 'tickets', v_row.tickets);
end $$;

/* ── ENTER THE WARPATH ────────────────────────────────────────────────────
   Debits entry, joins or opens a run, plants the hero on its spawn, deals the
   starter pool and burns the fog back around the landing site.

   ⚠ AZA BUYS ENTRY, NOT POWER. The only thing p_pay changes is which balance
   is debited; nothing downstream — not the seed, not the node table, not the
   extraction cap — ever reads entry_paid. That is the no-pay-to-win rule
   expressed as the absence of a branch, and it is worth keeping that way.

   ⚠ AZA is taken from public.bank_of_ethos.aza, the SERVER-side balance, and
   never from the client's Profile.sovereigns wallet — that lives inside the
   save blob and is therefore whatever the client says it is. Players bank AZA
   to spend it here, and the debit is journalled to boe_ledger like every other
   bank movement. */
create or replace function public.warpath_enter(p_hero_id text, p_hero_name text default null,
                                                p_pay text default 'ticket')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_run public.warpath_runs; v_exp public.warpath_expeditions;
  v_slot int; v_sp int[]; v_gate int[]; v_name text;
  v_aza numeric; v_cost numeric := 3; rec record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_hero_id is null or length(p_hero_id) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_hero'); end if;
  if exists (select 1 from public.warpath_expeditions
              where user_id = v_uid and status in ('active','extracting','ready')) then
    return jsonb_build_object('ok', false, 'reason', 'already_in_a_warpath');
  end if;

  -- 1. Pay. Nothing else in this function looks at how.
  if p_pay = 'ticket' then
    update public.warpath_tickets set tickets = tickets - 1, updated_at = updated_at
      where user_id = v_uid and tickets >= 1;
    if not found then return jsonb_build_object('ok', false, 'reason', 'no_ticket'); end if;
  elsif p_pay = 'aza' then
    select aza into v_aza from public.bank_of_ethos where user_id = v_uid for update;
    if v_aza is null or v_aza < v_cost then
      return jsonb_build_object('ok', false, 'reason', 'insufficient_aza', 'need', v_cost, 'have', coalesce(v_aza,0));
    end if;
    update public.bank_of_ethos set aza = aza - v_cost, updated_at = now() where user_id = v_uid;
    insert into public.boe_ledger (user_id, kind, aza, note)
      values (v_uid, 'warpath_entry', -v_cost, 'Warpath expedition entry');
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_payment');
  end if;

  /* 2. Join an open run, or open one.

     ⚠ THE ADVISORY LOCK IS THE WHOLE LOBBY. Without it this function cannot
     assemble a shared world, which is Milestone 1's first requirement and the
     precondition for encounters, PvP, node contention and the battle bridge.
     A critic measured it: four concurrent entrants produced four separate
     single-player maps, 12 rounds out of 12, by two independent routes.

       • Cold lobby — every transaction ran the SELECT below before any of the
         others had committed its INSERT. Under READ COMMITTED none of them
         could see the others, so all four forked their own world.
       • Warm lobby — `for update skip locked` (which this used to say) let
         exactly one joiner take the open run and made every other concurrent
         joiner SKIP it and fall through to create a fresh one. skip locked was
         hired to prevent slot collisions, and it does; but it bought that by
         making the lobby unable to fill, which is worse.

     Serialising matchmaking on one key fixes both. Joiners now WAIT for the
     lobby instead of forking away from it. The lock is transaction-scoped, so
     it releases on commit or rollback with nothing to clean up, and the
     `unique (run_id, slot)` constraint still backstops the invariant.
     Matchmaking is a handful of milliseconds, so the queue is not a bottleneck.

     ⚠ `not exists` is load-bearing too. Without it, a player who has already
     extracted from this world matchmakes straight back into it, hits the
     unique (run_id, user_id) and blows up — AFTER their ticket was debited.
     You get one expedition per world, ever. */
  perform pg_advisory_xact_lock(hashtext('warpath_lobby'));

  select * into v_run from public.warpath_runs
    where status = 'open'
      and (select count(*) from public.warpath_expeditions e where e.run_id = warpath_runs.id) < max_players
      and not exists (select 1 from public.warpath_expeditions e2
                       where e2.run_id = warpath_runs.id and e2.user_id = v_uid)
    order by created_at limit 1 for update;
  if v_run.id is null then
    insert into public.warpath_runs (seed) values (floor(random() * 4294967295)::bigint)
      returning * into v_run;
  end if;

  select min(s) into v_slot from generate_series(0, v_run.max_players - 1) s
   where s not in (select slot from public.warpath_expeditions where run_id = v_run.id);
  if v_slot is null then return jsonb_build_object('ok', false, 'reason', 'run_full'); end if;

  v_sp := public.wp_spawn(v_run.seed, v_slot);

  -- ⚠ hero_name is shown to the OTHER THREE PLAYERS in this run — in the feed,
  -- on the map and in battle. It arrives from a client, so it is capped and
  -- stripped here rather than trusted. The renderers escape it as well, but a
  -- value that reaches three other people's screens should not depend on every
  -- future consumer remembering to escape; one careless innerHTML downstream
  -- would otherwise be cross-account script injection.
  v_name := nullif(btrim(regexp_replace(coalesce(p_hero_name, p_hero_id, 'Hero'),
                                        '[^[:alnum:][:space:]''_-]', '', 'g')), '');
  v_name := left(coalesce(v_name, 'Hero'), 24);

  insert into public.warpath_expeditions
    (run_id, user_id, slot, hero_id, hero_name, x, y, entry_paid)
    values (v_run.id, v_uid, v_slot, left(p_hero_id, 64), v_name,
            v_sp[1], v_sp[2], p_pay)
    returning * into v_exp;

  -- 3. Six expedition resources. Rows exist up front so every later update is
  --    a plain UPDATE and can never create a phantom resource.
  --
  --    ⚠ The stipend is not flavour. A playtest that spawned away from forest
  --    finished 14 turns with zero wood, could raise neither a Supply Tent nor
  --    a Recruitment Tent, and so had no vault and no recruiting for the whole
  --    run — it harvested a Dragon Heart and lost it at extraction. The kit is
  --    small on purpose: it buys ONE of the two tier-1 tents, not both.
  --    Mirrors STARTING_STIPEND in public/warpath/warpath-data.js.
  insert into public.warpath_inventory (expedition_id, kind, secured)
    select v_exp.id, r.kind, coalesce(k.amount, 0)
      from public.warpath_resources r
      left join public.warpath_starting_stipend k on k.kind = r.kind
     where r.tier = 'expedition';

  -- 4. The starter pool. Secured from the start — you brought these from home.
  insert into public.warpath_cards (expedition_id, card_key, source, secured, acquired_turn)
    select v_exp.id, card_key, 'starter', true, 1 from public.warpath_starter_pool order by ord;

  perform public.wp_reveal(v_exp.id, v_sp[1], v_sp[2], public.wp_vision(v_exp.id));
  -- Your Hero walked in through the Warpath Gate, so they know where the front
  -- door is. Without this the first turn is a 5x5 patch of light in a black
  -- field with nothing to walk towards, which reads as a broken screen rather
  -- than as fog. The two wandering portals stay hidden — those you have to find.
  select ARRAY[(g->>'x')::int, (g->>'y')::int] into v_gate
    from jsonb_array_elements(public.wp_structures(v_run.seed)) g
   where g->>'id' = 'gate_main' limit 1;
  if v_gate is not null then perform public.wp_reveal(v_exp.id, v_gate[1], v_gate[2], 1); end if;

  -- 5. Four heroes present closes the run to newcomers.
  if (select count(*) from public.warpath_expeditions where run_id = v_run.id) >= v_run.max_players then
    update public.warpath_runs set status = 'active' where id = v_run.id;
  end if;

  perform public.wp_log(v_run.id, v_exp.id, 'entered',
    jsonb_build_object('hero', v_name, 'slot', v_slot));

  return jsonb_build_object('ok', true, 'run_id', v_run.id, 'seed', v_run.seed,
                            'expedition_id', v_exp.id, 'slot', v_slot, 'x', v_sp[1], 'y', v_sp[2]);
end $$;

/* ── STATE ────────────────────────────────────────────────────────────────
   Everything the client needs in one round trip.

   ⚠ Other heroes are filtered against MY fog before they leave the database.
   Sending all four positions and letting the client hide three of them would
   make fog of war a rendering convention rather than a rule — the information
   would be sitting in the network tab. Heroes show only inside live vision;
   camps show once you have explored the tile they stand on. */
create or replace function public.warpath_state(p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); me public.warpath_expeditions; run public.warpath_runs;
  v_vision int; others jsonb := '[]'; rec record; seen boolean; camp jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into me from public.warpath_expeditions
    where user_id = v_uid and (p_run is null or run_id = p_run)
    order by (status in ('active','extracting','ready')) desc, entered_at desc limit 1;
  if me.id is null then return jsonb_build_object('ok', true, 'in_run', false); end if;

  /* ⏱ The turn clock is enforced HERE, on read. Every live client polls this
     every five seconds, so the first one to look pays for the tick — the same
     lazy-on-read arrangement tw_node_sim_sync uses. A world nobody is looking
     at simply does not advance, and that is the correct behaviour: the
     deadline protects players who are present. */
  perform public.wp_tick(me.run_id);
  me := public.wp_my_exp(me.id);                 -- re-read: the tick may have moved us

  select * into run from public.warpath_runs where id = me.run_id;
  v_vision := public.wp_vision(me.id);

  for rec in select e.*, c.x as cx, c.y as cy, c.buildings as cb
               from public.warpath_expeditions e
               left join public.warpath_camps c on c.expedition_id = e.id
              where e.run_id = me.run_id and e.id <> me.id loop
    seen := greatest(abs(rec.x - me.x), abs(rec.y - me.y)) <= v_vision;
    camp := null;
    if rec.cx is not null and public.wp_explored(me.fog, rec.cx, rec.cy) then
      camp := jsonb_build_object('x', rec.cx, 'y', rec.cy, 'buildings', rec.cb);
    end if;
    others := others || jsonb_build_object(
      'expedition_id', rec.id, 'slot', rec.slot, 'hero_name', rec.hero_name,
      'status', rec.status, 'visible', seen,
      -- who the barrier is waiting on, and who has walked away. Not a fog
      -- leak: it says nothing about WHERE anyone is, only whether the run is
      -- blocked on them — which is the thing a stalled player needs to know.
      'turn_ended', rec.turn_ended, 'away', rec.away,
      'x', case when seen then rec.x end, 'y', case when seen then rec.y end,
      'camp', camp);
  end loop;

  return jsonb_build_object(
    'ok', true, 'in_run', true,
    'run', jsonb_build_object('id', run.id, 'seed', run.seed, 'turn', run.turn,
                              'max_turns', run.max_turns, 'status', run.status,
                              'turn_seconds', run.turn_seconds,
                              'deadline', run.turn_deadline,
                              'seconds_left', greatest(0, extract(epoch from (run.turn_deadline - now()))::int),
                              'waiting_for', public.wp_pending_count(run.id),
                              'players', (select count(*) from public.warpath_expeditions where run_id = run.id)),
    'me', jsonb_build_object(
      'expedition_id', me.id, 'slot', me.slot, 'hero_id', me.hero_id, 'hero_name', me.hero_name,
      'x', me.x, 'y', me.y, 'hp', me.hero_hp, 'max_hp', me.hero_max_hp,
      'moves_left', me.moves_left, 'injured_turns', me.injured_turns,
      'turn_ended', me.turn_ended, 'status', me.status, 'extract_left', me.extract_left,
      'away', me.away, 'auto_ends', me.auto_ends,
      'vision', v_vision, 'vault_slots', public.wp_vault_slots(me.id),
      'extract_cap', 6 + 3 * public.wp_level(me.id, 'supply'),
      'fog', encode(me.fog, 'base64'),
      'stats', jsonb_build_object('distance', me.stat_distance, 'defeated', me.stat_defeated,
                                  'raided', me.stat_raided, 'bosses', me.stat_bosses)),
    'camp', (select jsonb_build_object('x', x, 'y', y, 'buildings', buildings, 'moved', moved_count)
               from public.warpath_camps where expedition_id = me.id),
    'inventory', coalesce((select jsonb_object_agg(kind, jsonb_build_object('carried', carried, 'secured', secured))
                             from public.warpath_inventory where expedition_id = me.id), '{}'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'key', card_key, 'source', source,
                                                           'secured', secured, 'turn', acquired_turn)
                                order by acquired_turn, id)
                         from public.warpath_cards where expedition_id = me.id), '[]'::jsonb),
    'recruited', coalesce((select jsonb_agg(site_id) from public.warpath_recruit_claims
                            where expedition_id = me.id), '[]'::jsonb),
    'claimed_nodes', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'y', y))
                                 from public.warpath_node_claims where run_id = me.run_id), '[]'::jsonb),
    'encounter', (select jsonb_build_object('id', id, 'x', x, 'y', y, 'biome', biome, 'offers', offers)
                    from public.warpath_encounters
                   where expedition_id = me.id and picked is null order by created_turn desc limit 1),
    'battles', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'status', status,
                                                             'attacker', attacker_id, 'defender', defender_id,
                                                             'winner', winner_id, 'x', x, 'y', y))
                           from public.warpath_battles
                          where run_id = me.run_id and status = 'open'
                            and (attacker_id = me.id or defender_id = me.id)), '[]'::jsonb),
    'others', others,
    'events', coalesce((select jsonb_agg(jsonb_build_object('turn', turn, 'kind', kind, 'payload', payload)
                                 order by id desc)
                          from (select * from public.warpath_events where run_id = me.run_id
                                 order by id desc limit 40) z), '[]'::jsonb),
    'grants_waiting', (select count(*) from public.warpath_grants where user_id = v_uid and claimed = false));
end $$;

/* ── MOVE ─────────────────────────────────────────────────────────────────
   The server re-derives the true path cost with wp_path_cost() — a bounded
   Bellman-Ford over the movement window — rather than trusting a cost the
   client sends. Then it reveals fog and, if the tile is new and rolls one,
   opens a discovery encounter. */
create or replace function public.warpath_move(p_exp uuid default null, p_x int default null, p_y int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.warpath_expeditions; run public.warpath_runs; cost int; enc jsonb;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  /* ⚠ turn_ended was a readiness flag, not a lock. After pressing End turn a
     hero still had its full movement and could keep moving, harvesting and
     pitching camp while the other three waited on it — the barrier announced
     you were done without making you done. */
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  if exists (select 1 from public.warpath_battles where status = 'open'
              and (attacker_id = me.id or defender_id = me.id)) then
    return jsonb_build_object('ok', false, 'reason', 'battle_pending');
  end if;
  select * into run from public.warpath_runs where id = me.run_id;
  if p_x < 0 or p_y < 0 or p_x >= public.wp_w() or p_y >= public.wp_h() then
    return jsonb_build_object('ok', false, 'reason', 'out_of_bounds'); end if;
  if public.wp_is_water(run.seed, p_x, p_y) then
    return jsonb_build_object('ok', false, 'reason', 'impassable'); end if;

  cost := public.wp_path_cost(run.seed, me.x, me.y, p_x, p_y, me.moves_left);
  if cost is null then return jsonb_build_object('ok', false, 'reason', 'out_of_range'); end if;

  update public.warpath_expeditions
     set x = p_x, y = p_y, moves_left = moves_left - cost,
         stat_distance = stat_distance + greatest(abs(p_x - me.x), abs(p_y - me.y))
   where id = me.id;
  perform public.wp_reveal(me.id, p_x, p_y, public.wp_vision(me.id));

  enc := public.warpath_encounter_open(me.id);
  return jsonb_build_object('ok', true, 'x', p_x, 'y', p_y, 'cost', cost,
                            'moves_left', me.moves_left - cost,
                            'encounter', case when (enc->>'ok')::boolean then enc->'encounter' end);
end $$;

/* ── DISCOVERY ENCOUNTER ──────────────────────────────────────────────────
   "Explore → Discover Opportunity → Make Choice → Add Card → Continue."
   Three cards from the biome's table, pick one. The offer is rolled from the
   TILE hash and then STORED, so refreshing the page cannot re-roll a bad
   choice into a good one — which is the whole difference between a draft and
   a slot machine. One encounter per tile per expedition, forever. */
create or replace function public.warpath_encounter_open(p_exp uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.warpath_expeditions; run public.warpath_runs; b text; meta record;
  total int; offers jsonb := '[]'; picks int[] := ARRAY[]::int[];
  i int; r int; acc int; rec record; k text; tries int; enc public.warpath_encounters;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  select * into enc from public.warpath_encounters where expedition_id = me.id and x = me.x and y = me.y;
  if enc.id is not null then
    if enc.picked is not null then return jsonb_build_object('ok', false, 'reason', 'already_resolved'); end if;
    return jsonb_build_object('ok', true, 'encounter',
      jsonb_build_object('id', enc.id, 'x', enc.x, 'y', enc.y, 'biome', enc.biome, 'offers', enc.offers));
  end if;
  select * into run from public.warpath_runs where id = me.run_id;
  b := public.wp_biome_at(run.seed, me.x, me.y);
  select * into meta from public.warpath_discovery_meta where biome = b;
  if meta.biome is null then return jsonb_build_object('ok', false, 'reason', 'no_table'); end if;
  -- Salt 20 is the encounter roll; distinct from every terrain salt.
  if public.wp_roll(run.seed, me.x, me.y, 20, 100) >= meta.chance then
    return jsonb_build_object('ok', false, 'reason', 'nothing_here');
  end if;

  select sum(weight) into total from public.warpath_discovery where biome = b;
  for i in 0..2 loop
    tries := 0; k := null;
    while k is null and tries < 12 loop
      r := public.wp_roll(run.seed, me.x * 97 + i * 7 + tries, me.y, 21, total);
      acc := 0;
      for rec in select ord, card_key, weight from public.warpath_discovery where biome = b order by ord loop
        acc := acc + rec.weight;
        if r < acc then
          if not (rec.ord = any(picks)) then k := rec.card_key; picks := picks || rec.ord; end if;
          exit;
        end if;
      end loop;
      tries := tries + 1;
    end loop;
    if k is not null then offers := offers || jsonb_build_object('key', k); end if;
  end loop;
  if jsonb_array_length(offers) = 0 then return jsonb_build_object('ok', false, 'reason', 'nothing_here'); end if;

  insert into public.warpath_encounters (expedition_id, x, y, biome, offers, created_turn)
    values (me.id, me.x, me.y, b, offers, run.turn)
    on conflict (expedition_id, x, y) do nothing
    returning * into enc;
  if enc.id is null then
    select * into enc from public.warpath_encounters where expedition_id = me.id and x = me.x and y = me.y;
  end if;
  return jsonb_build_object('ok', true, 'title', meta.title, 'encounter',
    jsonb_build_object('id', enc.id, 'x', enc.x, 'y', enc.y, 'biome', enc.biome, 'offers', enc.offers));
end $$;

create or replace function public.warpath_encounter_pick(p_enc uuid, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare enc public.warpath_encounters; me public.warpath_expeditions; run public.warpath_runs; k text;
begin
  select * into enc from public.warpath_encounters where id = p_enc;
  if enc.id is null then return jsonb_build_object('ok', false, 'reason', 'no_encounter'); end if;
  me := public.wp_my_exp(enc.expedition_id);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if enc.picked is not null then return jsonb_build_object('ok', false, 'reason', 'already_picked'); end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(enc.offers) then
    return jsonb_build_object('ok', false, 'reason', 'bad_index'); end if;
  k := enc.offers->p_idx->>'key';
  select * into run from public.warpath_runs where id = me.run_id;
  update public.warpath_encounters set picked = p_idx where id = enc.id;
  -- Discovered cards are CARRIED, not secured: you have to walk them home to
  -- your camp before they can be extracted. That is the risk the vault exists
  -- to answer.
  insert into public.warpath_cards (expedition_id, card_key, source, secured, acquired_turn)
    values (me.id, k, 'discovery', false, run.turn);
  return jsonb_build_object('ok', true, 'card_key', k);
end $$;

/* ── HARVEST ──────────────────────────────────────────────────────────────
   The client says "I am standing on a node". The server derives what is
   actually at that tile from the seed and credits THAT — never an amount the
   client sent. First hero to a node takes it; the run keeps the claim. */
create or replace function public.warpath_harvest(p_exp uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.warpath_expeditions; run public.warpath_runs; node jsonb; k text; amt int;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  /* ⚠ turn_ended was a readiness flag, not a lock. After pressing End turn a
     hero still had its full movement and could keep moving, harvesting and
     pitching camp while the other three waited on it — the barrier announced
     you were done without making you done. */
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  if me.moves_left < 1 then return jsonb_build_object('ok', false, 'reason', 'no_moves_left'); end if;
  select * into run from public.warpath_runs where id = me.run_id;

  node := public.wp_node_at(run.seed, me.x, me.y);
  if node is null then return jsonb_build_object('ok', false, 'reason', 'no_node_here'); end if;
  k := node->>'kind'; amt := (node->>'amount')::int;

  insert into public.warpath_node_claims (run_id, x, y, claimed_by, kind, amount, turn)
    values (me.run_id, me.x, me.y, me.id, k, amt, run.turn)
    on conflict (run_id, x, y) do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'already_harvested'); end if;

  insert into public.warpath_inventory (expedition_id, kind, carried)
    values (me.id, k, amt)
    on conflict (expedition_id, kind) do update set carried = warpath_inventory.carried + excluded.carried;
  update public.warpath_expeditions set moves_left = moves_left - 1 where id = me.id;

  if (node->>'tier') = 'extraction' then
    perform public.wp_log(me.run_id, me.id, 'material_found', jsonb_build_object('kind', k));
  end if;
  return jsonb_build_object('ok', true, 'kind', k, 'amount', amt, 'tier', node->>'tier',
                            'moves_left', me.moves_left - 1);
end $$;

/* ── CAMP ─────────────────────────────────────────────────────────────────
   Pitch or move. The brief's PACK CAMP: moving costs a turn's movement and
   resets nothing except position — the buildings travel with you, because a
   camp you have to rebuild from scratch is a camp nobody ever moves. */
create or replace function public.warpath_camp_place(p_exp uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.warpath_expeditions; run public.warpath_runs; existing public.warpath_camps;
  rec record;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  /* ⚠ turn_ended was a readiness flag, not a lock. After pressing End turn a
     hero still had its full movement and could keep moving, harvesting and
     pitching camp while the other three waited on it — the barrier announced
     you were done without making you done. */
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  select * into run from public.warpath_runs where id = me.run_id;
  if public.wp_is_water(run.seed, me.x, me.y) then
    return jsonb_build_object('ok', false, 'reason', 'impassable'); end if;

  select * into existing from public.warpath_camps where expedition_id = me.id;
  if existing.expedition_id is null then
    insert into public.warpath_camps (expedition_id, run_id, x, y, placed_turn)
      values (me.id, me.run_id, me.x, me.y, run.turn);
    perform public.wp_log(me.run_id, me.id, 'camp_placed', jsonb_build_object('x', me.x, 'y', me.y));
    return jsonb_build_object('ok', true, 'placed', true, 'x', me.x, 'y', me.y);
  end if;
  if existing.x = me.x and existing.y = me.y then
    return jsonb_build_object('ok', false, 'reason', 'camp_already_here'); end if;
  if me.moves_left < 2 then return jsonb_build_object('ok', false, 'reason', 'need_2_moves_to_pack'); end if;
  /* ⚠ TELL THE PEOPLE WHO WOULD NOTICE. A scout that discovered this camp sees
     it simply vanish from their map the moment it is packed — warpath_state
     gates rival camps on explored fog, and the NEW site is unexplored, so the
     camp reads as null with no explanation. From the client that looks like a
     bug rather than an event.

     So anyone who had explored the OLD site is told the camp struck. Only them:
     you learn a camp is gone because you knew where it was, which is the same
     rule that let you see it in the first place. Nobody is told where it went. */
  for rec in select e.id from public.warpath_expeditions e
              where e.run_id = me.run_id and e.id <> me.id
                and e.status in ('active','extracting')
                and public.wp_explored(e.fog, existing.x, existing.y) loop
    perform public.wp_log(me.run_id, rec.id, 'rival_camp_struck',
      jsonb_build_object('hero', me.hero_name, 'x', existing.x, 'y', existing.y));
  end loop;

  update public.warpath_camps set x = me.x, y = me.y, moved_count = moved_count + 1
    where expedition_id = me.id;
  update public.warpath_expeditions set moves_left = moves_left - 2 where id = me.id;
  perform public.wp_log(me.run_id, me.id, 'camp_moved', jsonb_build_object('x', me.x, 'y', me.y));
  return jsonb_build_object('ok', true, 'moved', true, 'x', me.x, 'y', me.y);
end $$;

create or replace function public.warpath_camp_build(p_exp uuid default null, p_building text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.warpath_expeditions; camp public.warpath_camps; lvl int; cost jsonb;
  k text; need int; have int;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  /* ⚠ turn_ended was a readiness flag, not a lock. After pressing End turn a
     hero still had its full movement and could keep moving, harvesting and
     pitching camp while the other three waited on it — the barrier announced
     you were done without making you done. */
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  select * into camp from public.warpath_camps where expedition_id = me.id;
  if camp.expedition_id is null then return jsonb_build_object('ok', false, 'reason', 'no_camp'); end if;
  if camp.x <> me.x or camp.y <> me.y then
    return jsonb_build_object('ok', false, 'reason', 'not_at_camp'); end if;

  lvl := coalesce((camp.buildings->>p_building)::int, 0) + 1;
  select warpath_building_costs.cost into cost from public.warpath_building_costs
    where building = p_building and level = lvl;
  if cost is null then return jsonb_build_object('ok', false, 'reason', 'max_level_or_unknown'); end if;

  -- Building spends SECURED stock. You must have walked it home first.
  for k, need in select key, value::int from jsonb_each_text(cost) loop
    select secured into have from public.warpath_inventory where expedition_id = me.id and kind = k;
    if coalesce(have, 0) < need then
      -- name the wallet: building spends SECURED, recruiting spends CARRIED,
      -- and "you have 0" without saying which one is the single most confusing
      -- message in the mode.
      return jsonb_build_object('ok', false, 'reason', 'insufficient', 'kind', k,
                                'need', need, 'have', coalesce(have, 0), 'wallet', 'secured');
    end if;
  end loop;
  for k, need in select key, value::int from jsonb_each_text(cost) loop
    update public.warpath_inventory set secured = secured - need
      where expedition_id = me.id and kind = k;
  end loop;

  update public.warpath_camps
     set buildings = buildings || jsonb_build_object(p_building, lvl)
   where expedition_id = me.id;
  -- A new Watchtower burns fog back immediately; that is what it is for.
  if p_building = 'watchtower' then
    perform public.wp_reveal(me.id, camp.x, camp.y, (ARRAY[0,5,7])[least(lvl,2) + 1]);
  end if;
  perform public.wp_log(me.run_id, me.id, 'built', jsonb_build_object('building', p_building, 'level', lvl));
  return jsonb_build_object('ok', true, 'building', p_building, 'level', lvl);
end $$;

/* ── SECURE (the Expedition Vault) ────────────────────────────────────────
   "You find a Void Crystal. You can carry it and continue exploring — but
   you're risking it. Return to camp and deposit it: SECURED."

   Expedition resources deposit freely (they are bulk). Extraction materials
   consume vault slots, and slots come from the Supply Tent — so the decision
   the brief wants ("keep exploring, or go bank the loot?") is a real one with
   a real ceiling. Carried cards are deposited here too. */
create or replace function public.warpath_secure(p_exp uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.warpath_expeditions; camp public.warpath_camps;
  slots int; used int; rec record; moved jsonb := '{}'; ncards int; nmat int := 0; room int;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  /* ⚠ turn_ended was a readiness flag, not a lock. After pressing End turn a
     hero still had its full movement and could keep moving, harvesting and
     pitching camp while the other three waited on it — the barrier announced
     you were done without making you done. */
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  select * into camp from public.warpath_camps where expedition_id = me.id;
  if camp.expedition_id is null then return jsonb_build_object('ok', false, 'reason', 'no_camp'); end if;
  if camp.x <> me.x or camp.y <> me.y then
    return jsonb_build_object('ok', false, 'reason', 'not_at_camp'); end if;

  slots := public.wp_vault_slots(me.id);
  select coalesce(sum(i.secured), 0) into used from public.warpath_inventory i
    join public.warpath_resources r on r.kind = i.kind
   where i.expedition_id = me.id and r.tier = 'extraction';

  for rec in select i.kind, i.carried, r.tier from public.warpath_inventory i
               join public.warpath_resources r on r.kind = i.kind
              where i.expedition_id = me.id and i.carried > 0 loop
    if rec.tier = 'expedition' then
      update public.warpath_inventory set secured = secured + rec.carried, carried = 0
        where expedition_id = me.id and kind = rec.kind;
      moved := moved || jsonb_build_object(rec.kind, rec.carried);
    else
      room := greatest(0, slots - used);
      if room > 0 then
        room := least(room, rec.carried);
        update public.warpath_inventory set secured = secured + room, carried = carried - room
          where expedition_id = me.id and kind = rec.kind;
        used := used + room; nmat := nmat + room;
        moved := moved || jsonb_build_object(rec.kind, room);
      end if;
    end if;
  end loop;

  update public.warpath_cards set secured = true where expedition_id = me.id and secured = false;
  get diagnostics ncards = row_count;

  return jsonb_build_object('ok', true, 'moved', moved, 'cards_secured', ncards,
                            'vault_used', used, 'vault_slots', slots,
                            -- distinguish "vault is full" from "there is no vault",
                            -- because the fix for each is a different building
                            'no_vault', slots = 0,
                            'vault_full', slots > 0 and used >= slots);
end $$;

/* ── RECRUIT ──────────────────────────────────────────────────────────────
   The brief's Goblin Encampment: three offers, you cannot afford all three.
   Rank is gated by the Recruitment Tent level, so a camp that never built the
   tent physically cannot take the commander. One recruit per site, ever. */
create or replace function public.warpath_recruit(p_exp uuid default null, p_site text default null, p_idx int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.warpath_expeditions; run public.warpath_runs; st jsonb; offer record;
  tent int; k text; need int; have int;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  /* ⚠ turn_ended was a readiness flag, not a lock. After pressing End turn a
     hero still had its full movement and could keep moving, harvesting and
     pitching camp while the other three waited on it — the barrier announced
     you were done without making you done. */
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  select * into run from public.warpath_runs where id = me.run_id;

  -- You have to actually be standing on the site. Derived, not asserted.
  st := public.wp_structure_at(run.seed, me.x, me.y);
  if st is null or st->>'k' <> 'site' or st->>'id' <> p_site then
    return jsonb_build_object('ok', false, 'reason', 'not_at_site');
  end if;
  if exists (select 1 from public.warpath_recruit_claims where expedition_id = me.id and site_id = p_site) then
    return jsonb_build_object('ok', false, 'reason', 'site_already_recruited');
  end if;
  select * into offer from public.warpath_recruit_offers where site_id = p_site and idx = p_idx;
  if offer.site_id is null then return jsonb_build_object('ok', false, 'reason', 'bad_offer'); end if;

  tent := public.wp_level(me.id, 'recruitment');
  -- Tent I recruits rank 1-2, II adds 3-4, III adds 5.
  if offer.rank > (ARRAY[0,2,4,5])[least(tent,3) + 1] then
    return jsonb_build_object('ok', false, 'reason', 'tent_too_small',
                              'need_tent', case when offer.rank <= 2 then 1 when offer.rank <= 4 then 2 else 3 end,
                              'tent', tent);
  end if;

  -- Recruiting spends CARRIED resources: you are paying them on the spot.
  for k, need in select key, value::int from jsonb_each_text(offer.cost) loop
    select carried into have from public.warpath_inventory where expedition_id = me.id and kind = k;
    if coalesce(have, 0) < need then
      return jsonb_build_object('ok', false, 'reason', 'insufficient', 'kind', k,
                                'need', need, 'have', coalesce(have, 0), 'wallet', 'carried');
    end if;
  end loop;
  for k, need in select key, value::int from jsonb_each_text(offer.cost) loop
    update public.warpath_inventory set carried = carried - need where expedition_id = me.id and kind = k;
  end loop;

  -- Recruits arrive SECURED — the brief counts "cards you successfully
  -- recruited" as extraction-eligible without a trip back to camp. A contract
  -- is not loot you are carrying in a sack.
  insert into public.warpath_cards (expedition_id, card_key, source, secured, acquired_turn)
    values (me.id, offer.card_key, 'recruit', true, run.turn);
  insert into public.warpath_recruit_claims (expedition_id, site_id, offer_idx, card_key, turn)
    values (me.id, p_site, p_idx, offer.card_key, run.turn);
  perform public.wp_log(me.run_id, me.id, 'recruited',
    jsonb_build_object('site', p_site, 'label', offer.label));
  return jsonb_build_object('ok', true, 'card_key', offer.card_key, 'label', offer.label);
end $$;

/* ── TURNS ────────────────────────────────────────────────────────────────
   Everyone moves in the same turn; the run clock advances when the last active
   hero ends theirs. Extraction countdown and injury tick here, which is what
   makes "extraction takes 1-3 turns" a window your rivals can act inside. */
/* ═══ THE TURN CLOCK ═══════════════════════════════════════════════════════
   `waiting_for` blocks a four-player world until every living expedition ends
   its turn. One player closing a tab froze the run indefinitely for three
   people who did nothing wrong — a live-service failure, not a game bug: it
   makes the mode grief-able by accident and unshippable to strangers.

   ⚠ THE CIRCULAR DEPENDENCY THIS IS BUILT AROUND.
   The deadline is PAUSED for players in an open battle, because a card battle
   happens outside the Warpath's clock and would otherwise blow the deadline
   every time. The first draft also expired an unreported battle after TWO
   TURNS. Those two rules deadlock: A and B open a battle and neither reports,
   both are paused so neither auto-ends, the barrier still waits on them so the
   turn cannot advance — and the battle's expiry is counted in turns that will
   now never arrive. C and D wait forever, frozen by precisely the failure the
   timer exists to prevent, and unreachable by the auto-end too.

   So a battle expires on ITS OWN WALL CLOCK, never on the turn counter, and
   the pause is bounded by that same expiry rather than by the battle merely
   existing — otherwise "open a challenge and never report" is a free way to
   stop your own clock. Nothing that pauses the turn clock may also be the
   thing the turn clock is responsible for ending.                           */

-- How long an unreported battle is allowed to pin two heroes.
create or replace function public.wp_battle_ttl() returns interval
  language sql immutable as $$ select interval '4 minutes' $$;

/* Am I exempt from the deadline right now? Only while a battle I am in is
   BOTH open AND not yet past its own expiry. */
create or replace function public.wp_deadline_paused(p_exp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.warpath_battles b
     where b.status = 'open'
       and (b.attacker_id = p_exp or b.defender_id = p_exp)
       and coalesce(b.expires_at, now() + public.wp_battle_ttl()) > now())
$$;

/* Who the barrier is actually waiting for. `away` players are skipped
   entirely — three consecutive auto-ends and the remaining players should not
   keep paying 90 seconds a turn for a tab nobody is looking at. */
create or replace function public.wp_pending_count(p_run uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.warpath_expeditions
   where run_id = p_run and status in ('active','extracting')
     and turn_ended = false and away = false
$$;

/* Wall-clock battle expiry. Independent of the turn barrier by design — this
   is the half of the deadlock fix that lets a paused pair release themselves. */
create or replace function public.wp_expire_battles(p_run uuid)
returns int language plpgsql security definer set search_path = public as $$
declare rec record; n int := 0;
begin
  for rec in select * from public.warpath_battles
              where run_id = p_run and status = 'open' and kind = 'pvp'
                and expires_at is not null and expires_at <= now() loop
    if rec.claim_attacker is not null or rec.claim_defender is not null then
      -- somebody said something; settle on the best word available
      if rec.claim_attacker is not null and rec.claim_defender is not null
         and rec.claim_attacker is distinct from rec.claim_defender then
        perform public.wp_log(p_run, rec.attacker_id, 'battle_disputed',
          jsonb_build_object('battle_id', rec.id, 'attacker_claimed', rec.claim_attacker,
                             'defender_claimed', rec.claim_defender));
      end if;
      perform public.wp_resolve_battle(rec.id, case
        when rec.claim_attacker is not null and rec.claim_attacker is distinct from rec.attacker_id
          then rec.claim_attacker
        when rec.claim_defender is not null and rec.claim_defender is distinct from rec.defender_id
          then rec.claim_defender
        else coalesce(rec.claim_defender, rec.claim_attacker) end);
    else
      -- nobody reported anything: it never happened. No winner, no loot, no injury.
      update public.warpath_battles set status = 'abandoned', resolved_at = now()
       where id = rec.id and status = 'open';
      if found then
        perform public.wp_log(p_run, rec.attacker_id, 'battle_abandoned',
          jsonb_build_object('battle_id', rec.id, 'reason', 'nobody reported it'));
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

/* ⏱ THE ENFORCEMENT POINT.
   No cron and no scheduler: warpath_state is polled by every live client every
   five seconds, so the first client to look pays for the tick — the same
   lazy-on-read arrangement tw_node_sim_sync already uses in this repo. A run
   with nobody watching simply does not advance, which is correct: the deadline
   exists to protect players who ARE present, not to simulate absent ones. */
create or replace function public.wp_tick(p_run uuid)
returns void language plpgsql security definer set search_path = public as $$
declare run public.warpath_runs; rec record; n int;
begin
  select * into run from public.warpath_runs where id = p_run;
  if run.id is null or run.status = 'closed' then return; end if;

  perform pg_advisory_xact_lock(hashtext('warpath_turn:' || p_run::text));
  select * into run from public.warpath_runs where id = p_run;   -- re-read under the lock

  -- 1. battles first, on their own clock. This is what releases a paused pair.
  perform public.wp_expire_battles(p_run);

  -- 2. seed a deadline for a run that has never had one
  if run.turn_deadline is null then
    update public.warpath_runs set turn_deadline = now() + make_interval(secs => run.turn_seconds)
     where id = p_run returning * into run;
    return;
  end if;
  if run.turn_deadline > now() then return; end if;

  -- 3. the deadline has passed: end the turn of anyone still thinking, unless
  --    they are mid-battle and that battle has not itself expired.
  for rec in select * from public.warpath_expeditions
              where run_id = p_run and status in ('active','extracting')
                and turn_ended = false and away = false loop
    if public.wp_deadline_paused(rec.id) then continue; end if;
    update public.warpath_expeditions
       set turn_ended = true, auto_ends = auto_ends + 1,
           away = (auto_ends + 1) >= 3
     where id = rec.id;
    if (rec.auto_ends + 1) >= 3 then
      perform public.wp_log(p_run, rec.id, 'hero_away',
        jsonb_build_object('hero', rec.hero_name));
    else
      perform public.wp_log(p_run, rec.id, 'turn_timed_out',
        jsonb_build_object('hero', rec.hero_name));
    end if;
  end loop;

  -- 4. if that emptied the barrier, advance; otherwise extend so the paused
  --    players get a fresh window once their battle clears.
  if public.wp_pending_count(p_run) = 0 then
    perform public.wp_advance_turn(p_run);
  else
    update public.warpath_runs
       set turn_deadline = now() + make_interval(secs => run.turn_seconds) where id = p_run;
  end if;
end $$;

/* ── ADVANCING THE WORLD ──────────────────────────────────────────────────
   Lifted out of warpath_end_turn so that TWO callers can drive it: the last
   player to press End turn, and wp_tick() when the deadline expires. Must be
   called holding the per-run advisory lock. */
create or replace function public.wp_advance_turn(p_run uuid)
returns public.warpath_runs language plpgsql security definer set search_path = public as $$
declare run public.warpath_runs; rec record; base int;
begin
  -- Last one in: advance the world, and start the next turn's clock.
  update public.warpath_runs
     set turn = turn + 1,
         turn_deadline = now() + make_interval(secs => turn_seconds)
   where id = p_run returning * into run;

  for rec in select * from public.warpath_expeditions
              where run_id = p_run and status in ('active','extracting') loop
    base := case when rec.injured_turns > 0 then 4 else 6 end;   -- injury costs movement
    update public.warpath_expeditions
       set turn_ended = false,
           moves_left = base,
           injured_turns = greatest(0, rec.injured_turns - 1),
           hero_hp = least(rec.hero_max_hp, rec.hero_hp + 5),
           /* ⚠ AWAY FREEZES THE COUNTDOWN. If an absent hero kept extracting,
              walking away would be the SAFEST way to leave the Warpath and B3
              (losing interrupts extraction) would be undone. Frozen, not
              cancelled: a disconnect should cost you tempo, not your run. */
           extract_left = case when rec.status = 'extracting' and not rec.away
                               then greatest(0, rec.extract_left - 1) else rec.extract_left end,
           status = case when rec.status = 'extracting' and not rec.away
                          and rec.extract_left - 1 <= 0 then 'ready' else rec.status end
     where id = rec.id;
  end loop;

  /* 🗼 THE WATCHTOWER, WHICH PROMISED THIS AND DID NOTHING.
     warpath-data.js has advertised "Enemy camps within 8 tiles are reported"
     since the first commit, the building costs 🪵40 🪨20, and the effect was
     implemented NOWHERE — a player could pay for it and get a fog bonus and
     nothing else. That is the game breaking a promise the moment somebody
     believes it, which is worse than not offering it.

     It reports CAMPS, never live hero positions: a camp is a structure that
     sits still and is fair game for a tower; where a hero is standing right
     now is what fog is for. The report works by revealing the rival camp tile
     in the observer's own fog, so it flows through exactly the same
     explored-once path warpath_state already uses for camp discovery — no
     second visibility rule to keep in sync.

     Only genuinely NEW intel raises an event, so a tower does not spam the
     feed every turn about a camp you already know about.

     ⚠ RANGE 12 / 20, NOT THE ADVERTISED 8. The "within 8 tiles" line was
     written before the map had a size. On a 44x30 world where spawns land
     29-35 tiles apart, an 8-tile tower covers about half a percent of the map
     and — measured — reported NOTHING in four mixed-roster runs. The radius is
     now set against the thing that actually determines whether it can ever
     fire: a Tower I reaches well beyond your own vision, and a Tower II can
     just about reach the nearest neighbouring spawn. It is deliberately short
     of seeing the whole map; a tower is a neighbourhood watch, not a satellite. */
  for rec in select e.id as exp_id, c.x as cx, c.y as cy,
                    coalesce((c.buildings->>'watchtower')::int, 0) as tower
               from public.warpath_expeditions e
               join public.warpath_camps c on c.expedition_id = e.id
              where e.run_id = run.id and e.status in ('active','extracting')
                and coalesce((c.buildings->>'watchtower')::int, 0) >= 1 loop
    declare foe record; f bytea;
    begin
      select fog into f from public.warpath_expeditions where id = rec.exp_id;
      for foe in select c2.x, c2.y, e2.hero_name
                   from public.warpath_camps c2
                   join public.warpath_expeditions e2 on e2.id = c2.expedition_id
                  where c2.run_id = run.id and c2.expedition_id <> rec.exp_id
                    and greatest(abs(c2.x - rec.cx), abs(c2.y - rec.cy))
                        <= (case when rec.tower >= 2 then 20 else 12 end) loop
        if f is null or not public.wp_explored(f, foe.x, foe.y) then
          perform public.wp_reveal(rec.exp_id, foe.x, foe.y, 1);
          perform public.wp_log(run.id, rec.exp_id, 'watchtower_report',
            jsonb_build_object('hero', foe.hero_name, 'x', foe.x, 'y', foe.y,
                               'dist', greatest(abs(foe.x - rec.cx), abs(foe.y - rec.cy))));
        end if;
      end loop;
    end;
  end loop;

  /* Settle any battle still contested from a previous turn. A bare win claim
     waits for corroboration (see warpath_battle_report), and without this
     nothing would ever come back to it — the client reports once. Prefer a
     concession, then the defender's word, then the attacker's. */
  for rec in select * from public.warpath_battles
              where run_id = run.id and status = 'open' and kind = 'pvp'
                and coalesce(opened_turn, 0) < run.turn
                and (claim_attacker is not null or claim_defender is not null) loop
    /* Two claims that disagree get LOGGED, not silently picked between. We
       cannot tell who is lying from here — that is what the Colyseus migration
       in docs/mp-server-authority-shared-engine.md is for — but a run whose
       feed records the disagreement is one an operator can audit later. */
    if rec.claim_attacker is not null and rec.claim_defender is not null
       and rec.claim_attacker is distinct from rec.claim_defender then
      perform public.wp_log(run.id, rec.attacker_id, 'battle_disputed',
        jsonb_build_object('battle_id', rec.id,
                           'attacker_claimed', rec.claim_attacker,
                           'defender_claimed', rec.claim_defender));
    end if;
    perform public.wp_resolve_battle(rec.id,
      case
        when rec.claim_attacker is not null and rec.claim_attacker is distinct from rec.attacker_id
          then rec.claim_attacker                                   -- attacker conceded
        when rec.claim_defender is not null and rec.claim_defender is distinct from rec.defender_id
          then rec.claim_defender                                   -- defender conceded
        else coalesce(rec.claim_defender, rec.claim_attacker)
      end);
  end loop;

  /* ⚠ A BATTLE NOBODY REPORTS IS A SOFT-LOCK ON TWO PLAYERS.
     While a battle is open, warpath_move refuses with battle_pending — for the
     ATTACKER, who chose this, and for the DEFENDER, who did not and cannot
     decline. If the attacker closes the tab between opening the battle and
     reporting it, both heroes are pinned to the map for the rest of the run.
     The defender does have an out (conceding is believed immediately), but
     "concede or stay frozen forever" is not an acceptable pair of options for
     someone who was attacked.

     So an unreported battle expires. Two full turns with NO claim from either
     side and it never happened: no winner, no loot, no injury, both released.
     That is deliberately the gentlest possible resolution, because the one
     thing we know about this battle is that we know nothing about it. */
  for rec in select * from public.warpath_battles
              where run_id = run.id and status = 'open' and kind = 'pvp'
                and claim_attacker is null and claim_defender is null
                and coalesce(opened_turn, 0) < run.turn - 1 loop
    update public.warpath_battles
       set status = 'abandoned', resolved_at = now() where id = rec.id and status = 'open';
    if found then
      perform public.wp_log(run.id, rec.attacker_id, 'battle_abandoned',
        jsonb_build_object('battle_id', rec.id, 'opened_turn', rec.opened_turn));
    end if;
  end loop;

  -- The world closes. Anyone still out there loses everything they did not
  -- extract; that is the deal.
  if run.turn > run.max_turns then
    update public.warpath_expeditions set status = 'lost', ended_at = now()
      where run_id = run.id and status in ('active','extracting');
    update public.warpath_runs set status = 'closed', closed_at = now() where id = run.id;
    perform public.wp_log(run.id, null, 'run_closed', '{}');
  end if;


  return run;
end $$;

create or replace function public.warpath_end_turn(p_exp uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.warpath_expeditions; run public.warpath_runs; pending int;
begin
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status not in ('active','extracting') then
    return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;

  /* ⚠ THE TURN BARRIER NEEDS THE SAME LOCK THE LOBBY GOT.
     Four simultaneous end_turns used to do two wrong things at once: each
     transaction set its own turn_ended and then counted the others in the SAME
     READ COMMITTED snapshot, so nobody could see anybody and 7 of 30 rounds
     advanced zero times; and on retry all four ran the advance block, updating
     warpath_runs and then every expedition row while each already held a lock
     on its own row — textbook ABBA, 20 raw 40P01s handed back to callers.
     warpath_enter already took this medicine for the lobby. Keyed per run so
     two worlds never queue behind each other. */
  perform pg_advisory_xact_lock(hashtext('warpath_turn:' || me.run_id::text));

  -- Pressing the button is proof of presence: it clears any away flag.
  update public.warpath_expeditions
     set turn_ended = true, auto_ends = 0, away = false where id = me.id;

  pending := public.wp_pending_count(me.run_id);
  if pending > 0 then
    return jsonb_build_object('ok', true, 'waiting_for', pending,
                              'turn', (select turn from public.warpath_runs where id = me.run_id),
                              'deadline', (select turn_deadline from public.warpath_runs where id = me.run_id));
  end if;

  run := public.wp_advance_turn(me.run_id);
  return jsonb_build_object('ok', true, 'turn', run.turn, 'advanced', true,
                            'deadline', run.turn_deadline);
end $$;

/* ── BATTLE BRIDGE ────────────────────────────────────────────────────────
   ⚠ THIS IS THE ARCHITECTURAL RULE, IN CODE.

   warpath_battle_open() creates a row that says "these two heroes have
   collided at (x,y)" and hands back an id. It does not shuffle a deck, deal a
   hand, roll a die or decide anything. The battle is played by the existing
   Mythic Spellbook engine — App.battlePrep → vsScreen in public/index.html —
   and warpath_battle_report() consumes the verdict it produces.

   Designed so the Colyseus migration is a no-op here: whoever reports the
   result (client today, authoritative server tomorrow) calls the same
   function, and the race gate `where status = 'open'` means a double report
   is harmless. */
create or replace function public.warpath_battle_open(p_exp uuid default null, p_target uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.warpath_expeditions; foe public.warpath_expeditions;
  run public.warpath_runs; st jsonb; b public.warpath_battles; v_kind text;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  /* ⚠ turn_ended was a readiness flag, not a lock. After pressing End turn a
     hero still had its full movement and could keep moving, harvesting and
     pitching camp while the other three waited on it — the barrier announced
     you were done without making you done. */
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  select * into run from public.warpath_runs where id = me.run_id;

  if exists (select 1 from public.warpath_battles where status = 'open'
              and (attacker_id = me.id or defender_id = me.id)) then
    return jsonb_build_object('ok', false, 'reason', 'battle_already_open');
  end if;

  if p_target is not null then
    v_kind := 'pvp';
    select * into foe from public.warpath_expeditions where id = p_target and run_id = me.run_id;
    if foe.id is null then return jsonb_build_object('ok', false, 'reason', 'no_such_hero'); end if;
    if foe.status <> 'active' and foe.status <> 'extracting' then
      return jsonb_build_object('ok', false, 'reason', 'target_not_in_play'); end if;
    -- Adjacent only. Distance is recomputed here, not sent by the client.
    if greatest(abs(foe.x - me.x), abs(foe.y - me.y)) > 1 then
      return jsonb_build_object('ok', false, 'reason', 'out_of_reach');
    end if;
    /* ⚠ ATTACKING COSTS SOMETHING, AND YOU GET ONE SWING PER TURN.
       Neither of these existed. A critic opened NINE battles in a single turn
       against one neighbour, spending no movement, and stripped them from 200
       of every resource and 9 extraction materials down to nothing — and then
       walked the spoils home through the ordinary secure→extract path into a
       permanent collection.

       Self-declared victory is inherent to the client-authoritative battle
       model this repo already uses everywhere, and Milestone 1 is not the
       place to change that. The FREE RE-ATTACK is not inherent, and it is what
       turned a raid into a vacuum. Two moves per challenge on a six-move turn,
       and never the same pairing twice in one turn. */
    if me.moves_left < 2 then
      return jsonb_build_object('ok', false, 'reason', 'need_2_moves_to_attack',
                                'moves_left', me.moves_left);
    end if;
    if exists (select 1 from public.warpath_battles
                where run_id = me.run_id and kind = 'pvp' and opened_turn = run.turn
                  and ((attacker_id = me.id and defender_id = p_target)
                    or (attacker_id = p_target and defender_id = me.id))) then
      return jsonb_build_object('ok', false, 'reason', 'already_fought_this_turn');
    end if;
    /* ⚠ B4 — A BEATEN HERO MUST BE ABLE TO LEAVE ITS OWN CAMP.
       Defeat teleports the loser home with moves_left = 0, and the
       once-per-pairing rule caps the RATE of re-attack but not the TOTAL. With
       greatest(1, hero_hp - 30) there is no death either, so a camper could
       pin someone on their own campfire indefinitely — 8 consecutive turns in
       a probe, 3 in free play, with the victim never getting a move. A short
       grace after a defeat is the difference between a raid and a hostage. */
    if foe.protected_until >= run.turn then
      return jsonb_build_object('ok', false, 'reason', 'target_regrouping',
                                'until_turn', foe.protected_until);
    end if;
  else
    -- PvE: the landmark Guardian. "You have to find the Black Pyramid during a
    -- Warpath and defeat the Guardian."
    v_kind := 'guardian';
    st := public.wp_structure_at(run.seed, me.x, me.y);
    if st is null or st->>'k' <> 'landmark' or not (st->>'guardian')::boolean then
      return jsonb_build_object('ok', false, 'reason', 'nothing_to_fight');
    end if;
    if exists (select 1 from public.warpath_battles
                where run_id = me.run_id and attacker_id = me.id and kind = 'guardian' and status = 'resolved') then
      return jsonb_build_object('ok', false, 'reason', 'guardian_already_faced');
    end if;
  end if;

  -- Guardians cost a move too; nothing in this mode should be free.
  update public.warpath_expeditions
     set moves_left = greatest(0, moves_left - case when v_kind = 'pvp' then 2 else 1 end)
   where id = me.id;

  insert into public.warpath_battles (run_id, kind, attacker_id, defender_id, x, y, opened_turn, expires_at)
    values (me.run_id, v_kind, me.id, p_target, me.x, me.y, run.turn,
            now() + public.wp_battle_ttl()) returning * into b;
  perform public.wp_log(me.run_id, me.id, 'battle_opened',
    jsonb_build_object('battle_id', b.id, 'kind', v_kind, 'x', me.x, 'y', me.y));
  return jsonb_build_object('ok', true, 'battle_id', b.id, 'kind', v_kind,
                            'defender', p_target, 'x', me.x, 'y', me.y,
                            'landmark', case when v_kind = 'guardian' then st end);
end $$;

/* Consume a verdict from the battle service. Race-gated exactly like
   mp_resolve_match: the conditional UPDATE means the second reporter reads
   back the authoritative answer instead of overwriting it. */
/* Consume a verdict from the battle service. The Warpath still resolves no
   card battle — it decides only WHOSE REPORT to believe, then applies it.

   ⚠ B5 — THIS USED TO BE DECIDED BY WHOEVER POSTED FIRST. Either participant
   could name any winner and the race gate recorded it. The gate is correct —
   exactly one verdict is ever written — but with four players anyone quick
   could simply claim every fight. Self-declared results are inherent to the
   client-authoritative battle model this repo already uses everywhere, and
   Milestone 1 is not the place to move combat server-side. What IS fixable is
   whose word counts:

     • CONCEDING IS BELIEVED IMMEDIATELY. A report naming the OTHER player as
       the winner resolves on the spot — nobody lies to lose.
     • AGREEMENT IS BELIEVED IMMEDIATELY. Both sides naming the same winner.
     • A BARE WIN CLAIM WAITS. It is recorded, and warpath_end_turn's sweep
       settles it when the clock next moves, so a closed tab cannot freeze a
       battle and pin two heroes on the map.

   PvE has one participant, so a Guardian result resolves at once. */
create or replace function public.warpath_battle_report(p_battle uuid, p_winner uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.warpath_battles; v_uid uuid := auth.uid();
  v_me uuid; v_mine uuid; v_theirs uuid; v_conceded boolean; v_agreed boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into b from public.warpath_battles where id = p_battle;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'no_such_battle'); end if;
  select id into v_me from public.warpath_expeditions
   where id in (b.attacker_id, b.defender_id) and user_id = v_uid;
  if v_me is null then return jsonb_build_object('ok', false, 'reason', 'not_a_participant'); end if;
  if p_winner is not null and p_winner not in (b.attacker_id, coalesce(b.defender_id, b.attacker_id)) then
    return jsonb_build_object('ok', false, 'reason', 'winner_not_a_participant');
  end if;
  if b.status <> 'open' then
    return jsonb_build_object('ok', true, 'we_won_race', false, 'winner', b.winner_id);
  end if;

  if b.kind <> 'pvp' or b.defender_id is null then
    return public.wp_resolve_battle(p_battle, p_winner);       -- PvE: one witness
  end if;

  if v_me = b.attacker_id then
    update public.warpath_battles set claim_attacker = p_winner where id = b.id;
    v_theirs := b.claim_defender;
  else
    update public.warpath_battles set claim_defender = p_winner where id = b.id;
    v_theirs := b.claim_attacker;
  end if;
  v_mine     := p_winner;
  v_conceded := (v_mine is distinct from v_me);
  v_agreed   := (v_theirs is not null and v_theirs is not distinct from v_mine);

  if v_conceded or v_agreed then return public.wp_resolve_battle(p_battle, p_winner); end if;
  return jsonb_build_object('ok', true, 'pending_confirmation', true,
                            'reason', 'awaiting_opponent', 'battle_id', b.id);
end $$;

/* ── Applying a battle result ─────────────────────────────────────────────
   Extracted so that TWO callers can use it: warpath_battle_report(), when the
   verdict is trustworthy enough to act on immediately, and the end-of-turn
   sweep, which settles anything still contested when the clock moves. Without
   the second caller a contested battle stays open forever and pins both heroes,
   because the client reports exactly once and nothing retries.
   Race-gated: only the transaction that flips 'open' does any work.          */
create or replace function public.wp_resolve_battle(p_battle uuid, p_winner uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.warpath_battles; upd public.warpath_battles;
  loser public.warpath_expeditions; winner public.warpath_expeditions;
  camp public.warpath_camps; rec record; v_spoils jsonb := '{}'::jsonb; take int;
  v_seed bigint; v_mat text; run_turn int;
begin
  select * into b from public.warpath_battles where id = p_battle;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'no_such_battle'); end if;
  select turn into run_turn from public.warpath_runs where id = b.run_id;
  update public.warpath_battles set status = 'resolved', winner_id = p_winner, resolved_at = now()
    where id = b.id and status = 'open' returning * into upd;
  if upd.id is null then
    select * into upd from public.warpath_battles where id = b.id;
    return jsonb_build_object('ok', true, 'we_won_race', false, 'winner', upd.winner_id);
  end if;

  if b.kind = 'guardian' then
    if p_winner = b.attacker_id then
      select * into winner from public.warpath_expeditions where id = b.attacker_id;
      -- Each landmark drops ITS OWN material, so "where did you get that?" has
      -- a specific answer rather than always being an Ouroboros Core.
      select run.seed into v_seed from public.warpath_runs run where run.id = b.run_id;
      v_mat := case (public.wp_structure_at(v_seed, b.x, b.y))->>'id'
                 when 'the_garden'    then 'kalon_fragment'
                 when 'drowned_choir' then 'void_crystal'
                 else 'ouroboros_core' end;
      -- Boss loot is secured on the spot and does not need a trip home.
      insert into public.warpath_inventory (expedition_id, kind, secured)
        values (b.attacker_id, v_mat, 1)
        on conflict (expedition_id, kind) do update set secured = warpath_inventory.secured + 1;
      update public.warpath_expeditions set stat_bosses = stat_bosses + 1 where id = b.attacker_id;
      v_spoils := jsonb_build_object('material', v_mat);
      perform public.wp_log(b.run_id, b.attacker_id, 'guardian_defeated', v_spoils);
    else
      update public.warpath_expeditions
         set injured_turns = 2, hero_hp = greatest(1, hero_hp - 25) where id = b.attacker_id;
    end if;
  else
    -- PvP. "Losing shouldn't erase everything." The loser drops half of what
    -- they were CARRYING plus one unsecured material, is injured, and retreats
    -- to their own camp. Anything already in the vault is untouched — which is
    -- the entire argument for walking home.
    select * into loser  from public.warpath_expeditions
      where id = case when p_winner = b.attacker_id then b.defender_id else b.attacker_id end;
    select * into winner from public.warpath_expeditions where id = p_winner;
    if loser.id is not null then
      for rec in select i.kind, i.carried, r.tier from public.warpath_inventory i
                   join public.warpath_resources r on r.kind = i.kind
                  where i.expedition_id = loser.id and i.carried > 0 loop
        take := case when rec.tier = 'expedition' then rec.carried / 2 else least(1, rec.carried) end;
        if take > 0 then
          update public.warpath_inventory set carried = carried - take
            where expedition_id = loser.id and kind = rec.kind;
          insert into public.warpath_inventory (expedition_id, kind, carried)
            values (winner.id, rec.kind, take)
            on conflict (expedition_id, kind) do update set carried = warpath_inventory.carried + excluded.carried;
          v_spoils := v_spoils || jsonb_build_object(rec.kind, take);
        end if;
      end loop;
      /* ⚠ UNSECURED CARDS DROP TOO. Without this, securing was free and always
         correct: warpath_secure flips every drafted card to secured at no cost,
         and a loss only took carried RESOURCES — which are worthless once
         banked. The brief's central tension ("do I push deeper, or go secure
         what I have?") did not exist, because there was nothing to lose by
         pushing. Now the newest unsecured card is left on the field. */
      delete from public.warpath_cards
       where id in (select id from public.warpath_cards
                     where expedition_id = loser.id and secured = false
                     order by acquired_turn desc, id desc limit 1);
      if found then v_spoils := v_spoils || jsonb_build_object('card_lost', 1); end if;
      select * into camp from public.warpath_camps where expedition_id = loser.id;
      /* ⚠ B3 — LOSING MUST INTERRUPT AN EXTRACTION.
         This used to retreat and injure the loser and never touch `status` or
         `extract_left`, so a hero beaten mid-extraction was carried home to its
         camp and then completed the extraction two turns later from wherever it
         happened to be standing — nowhere near a gate. The tensest moment the
         mode has (everyone is told you are leaving; the countdown is the window
         to stop you) cost the victim nothing but carried goods. Being beaten
         now puts you back on the map with the countdown cancelled: reach a gate
         again and start over. */
      update public.warpath_expeditions
         set injured_turns = 2, hero_hp = greatest(1, hero_hp - 30),
             x = coalesce(camp.x, loser.x), y = coalesce(camp.y, loser.y), moves_left = 0,
             status = case when loser.status in ('extracting','ready') then 'active'
                           else loser.status end,
             extract_left = 0,
             protected_until = run_turn + 2
       where id = loser.id;
      if loser.status in ('extracting','ready') then
        perform public.wp_log(b.run_id, loser.id, 'extraction_broken',
          jsonb_build_object('hero', loser.hero_name, 'by', winner.hero_name));
      end if;
      update public.warpath_expeditions
         set stat_defeated = stat_defeated + 1,
             stat_raided = stat_raided + case when v_spoils <> '{}'::jsonb then 1 else 0 end
       where id = winner.id;
    end if;
    perform public.wp_log(b.run_id, winner.id, 'hero_defeated',
      jsonb_build_object('winner', winner.hero_name, 'loser', loser.hero_name, 'spoils', v_spoils));
  end if;

  update public.warpath_battles set spoils = v_spoils where id = b.id;
  return jsonb_build_object('ok', true, 'we_won_race', true, 'winner', p_winner, 'spoils', v_spoils);
end $$;

/* ── EXTRACTION ───────────────────────────────────────────────────────────
   Reach a gate, then survive the countdown. Everyone in the run is told you
   are leaving — "⚠ A HERO IS PREPARING TO LEAVE THE WARPATH" — which is what
   turns the last two turns of a good run into the tensest part of it. */
create or replace function public.warpath_extract_begin(p_exp uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.warpath_expeditions; run public.warpath_runs; st jsonb; turns int; watchers int;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  /* ⚠ turn_ended was a readiness flag, not a lock. After pressing End turn a
     hero still had its full movement and could keep moving, harvesting and
     pitching camp while the other three waited on it — the barrier announced
     you were done without making you done. */
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  select * into run from public.warpath_runs where id = me.run_id;
  st := public.wp_structure_at(run.seed, me.x, me.y);
  if st is null or st->>'k' <> 'gate' then
    return jsonb_build_object('ok', false, 'reason', 'not_at_a_gate'); end if;

  -- A researched Arcane Tent shortens the wait; that is its second-level perk.
  turns := case when public.wp_level(me.id, 'arcane') >= 2 then 1 else 2 end;

  /* 🚪 THE RECIPROCAL HALF OF THE BROADCAST.
     Everyone is told a hero is leaving — the brief wants that, and the
     countdown is the mode's one scheduled collision point. But until now the
     information ran one way: the extracting player announced themselves and
     learned nothing. So the countdown was something that happened TO you.

     Now you are told how many rivals have explored THIS gate, which is exactly
     the set that can act on the news (B6 stripped the coordinates from the
     public event, so a player who has never seen this gate gets a warning
     without a map pin). Two turns at a gate three people know about is a
     different decision from two turns at one nobody has found, and now you can
     tell which one you are making before you commit. */
  select count(*) into watchers from public.warpath_expeditions e
   where e.run_id = me.run_id and e.id <> me.id
     and e.status in ('active','extracting')
     and public.wp_explored(e.fog, me.x, me.y);

  update public.warpath_expeditions
     set status = 'extracting', extract_left = turns where id = me.id;
  /* ⚠ B6 — WHAT THE BROADCAST MAY SAY, DECIDED ON PURPOSE.
     The brief wants everyone told ("⚠ A HERO IS PREPARING TO LEAVE THE
     WARPATH") and that tension is the point of the countdown. But this used to
     publish exact coordinates to every player regardless of fog, and the
     simulator's hunter used it as a homing beacon — which is not tension, it
     is a free reveal that nothing else in the mode grants.
     It now names the GATE, not the tile. A player who has explored that gate
     already knows where it is and can race you; a player who has not gets the
     warning without a map pin. The fog stays the thing that decides who can
     act on the news. */
  perform public.wp_log(me.run_id, me.id, 'extraction_started',
    jsonb_build_object('hero', me.hero_name, 'gate', st->>'name', 'turns', turns));
  return jsonb_build_object('ok', true, 'turns', turns, 'gate', st->>'name',
                            'watchers', watchers);
end $$;

/* ⭐ THE ONE FUNCTION THAT TOUCHES PERMANENT DATA.
   It writes exactly one warpath_grants row and nothing else. Everything it
   can put in that row is bounded:
     • cards  — must be SECURED cards belonging to THIS expedition, and no more
                than the extraction cap (6 + 3 per Supply Tent level)
     • materials — the SECURED extraction materials, read from inventory
   A caller cannot name a card id it does not own, cannot exceed the cap, and
   cannot run twice (unique (user_id, run_id) plus the status transition).   */
create or replace function public.warpath_extract_finish(p_exp uuid default null, p_keep uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.warpath_expeditions; run public.warpath_runs;
  cap int; keys text[]; mats jsonb; kept uuid[]; n int; summary jsonb;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'ready' then
    return jsonb_build_object('ok', false, 'reason', 'not_ready', 'status', me.status,
                              'extract_left', me.extract_left); end if;
  select * into run from public.warpath_runs where id = me.run_id;
  cap := 6 + 3 * public.wp_level(me.id, 'supply');

  -- Only secured cards of THIS expedition are eligible, whatever was asked for.
  -- ⚠ `source <> 'starter'` is not a detail. The 24 starter cards are a loaner
  -- deck, they arrive secured on turn 1, and without this they sort to the
  -- front and fill the entire extraction cap with cards the player already
  -- owned. Nothing you did not find out here comes home.
  select array_agg(id) into kept from (
    select id from public.warpath_cards
     where expedition_id = me.id and secured = true and source <> 'starter'
       and (p_keep is null or id = any(p_keep))
     order by (source = 'boss') desc, (source = 'recruit') desc, acquired_turn
     limit cap) z;
  kept := coalesce(kept, ARRAY[]::uuid[]);
  select coalesce(array_agg(card_key), ARRAY[]::text[]) into keys
    from public.warpath_cards where id = any(kept);

  select coalesce(jsonb_object_agg(i.kind, i.secured), '{}'::jsonb) into mats
    from public.warpath_inventory i join public.warpath_resources r on r.kind = i.kind
   where i.expedition_id = me.id and r.tier = 'extraction' and i.secured > 0;

  select count(*) into n from public.warpath_cards
   where expedition_id = me.id and source <> 'starter';
  /* ⚠ B8 — TWO LIES ON THE COMPLETION SCREEN.
     `array_length` on an EMPTY array returns NULL, not 0, so a run that
     extracted nothing reported "New Cards Secured: null". And
     resources_extracted counted SECURED EXPEDITION RESOURCES — including the
     70-unit starting stipend the player was given — while warpath_grants
     carries no expedition resources home at all. It reported ~150 "extracted"
     for a run that extracted none of it. Expedition resources are explicitly
     meant to evaporate, so the honest number is what you GATHERED out here,
     read from the node claims you actually made. */
  summary := jsonb_build_object(
    'cards_discovered', n,
    'cards_secured', coalesce(array_length(keys, 1), 0),
    'resources_gathered', (select coalesce(sum(c.amount), 0)
                             from public.warpath_node_claims c
                             join public.warpath_resources r on r.kind = c.kind
                            where c.claimed_by = me.id and r.tier = 'expedition'),
    'bosses_defeated', me.stat_bosses,
    'players_defeated', me.stat_defeated,
    'camps_raided', me.stat_raided,
    'distance_travelled', me.stat_distance,
    'turns', run.turn);

  insert into public.warpath_grants (user_id, run_id, card_keys, materials, summary)
    values (me.user_id, me.run_id, coalesce(keys, ARRAY[]::text[]), mats, summary)
    on conflict (user_id, run_id) do nothing;

  update public.warpath_expeditions set status = 'extracted', ended_at = now() where id = me.id;
  perform public.wp_log(me.run_id, me.id, 'extracted',
    jsonb_build_object('hero', me.hero_name, 'cards', array_length(keys, 1)));
  return jsonb_build_object('ok', true, 'card_keys', coalesce(keys, ARRAY[]::text[]),
                            'materials', mats, 'summary', summary, 'cap', cap);
end $$;

/* 🔭 SCOUT REPORT — making owned intel actionable.
   "Your scout reports: ⚠ ENEMY CAMP DISCOVERED — 2 regions east."

   This adds NO new information. It only re-surfaces what you already own: the
   rival camps sitting in your own explored fog. Camp discovery is durable but
   it is a one-off — you walk past a camp on turn 12 and by turn 40 you have no
   idea whether you are near it. The report answers "which way, roughly how
   far" on demand, which is what turns a memory into a plan.

   It costs 1 movement and is once per turn, so a player who wants to keep
   tabs on a rival is paying for it out of the same budget that buys harvesting
   and travel. Direction and a distance BAND only — never coordinates, never a
   live hero. A camp can also have been packed and moved since you saw it, and
   the report is honest about how stale it is.                                */
create or replace function public.warpath_scout_report(p_exp uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.warpath_expeditions; run public.warpath_runs; camp public.warpath_camps;
  rec record; best record; bestd int := 99999; d int; dir text; band text; out jsonb := '[]';
begin
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  if me.turn_ended then return jsonb_build_object('ok', false, 'reason', 'turn_already_ended'); end if;
  -- Acting is proof of presence: it clears the away flag and the strike count.
  if me.away or me.auto_ends > 0 then
    update public.warpath_expeditions set away = false, auto_ends = 0 where id = me.id;
  end if;
  select * into camp from public.warpath_camps where expedition_id = me.id;
  if camp.expedition_id is null then return jsonb_build_object('ok', false, 'reason', 'no_camp'); end if;
  if camp.x <> me.x or camp.y <> me.y then
    return jsonb_build_object('ok', false, 'reason', 'not_at_camp'); end if;
  select * into run from public.warpath_runs where id = me.run_id;
  if me.scouted_turn >= run.turn then
    return jsonb_build_object('ok', false, 'reason', 'already_scouted_this_turn'); end if;
  if me.moves_left < 1 then return jsonb_build_object('ok', false, 'reason', 'no_moves_left'); end if;

  for rec in select c.x, c.y, e.hero_name
               from public.warpath_camps c
               join public.warpath_expeditions e on e.id = c.expedition_id
              where c.run_id = me.run_id and c.expedition_id <> me.id
                and public.wp_explored(me.fog, c.x, c.y) loop
    d := greatest(abs(rec.x - camp.x), abs(rec.y - camp.y));
    dir := case
      when abs(rec.y - camp.y) > abs(rec.x - camp.x) * 2 then case when rec.y < camp.y then 'north' else 'south' end
      when abs(rec.x - camp.x) > abs(rec.y - camp.y) * 2 then case when rec.x < camp.x then 'west' else 'east' end
      else (case when rec.y < camp.y then 'north' else 'south' end) ||
           (case when rec.x < camp.x then 'west' else 'east' end) end;
    band := case when d <= 6 then 'close' when d <= 14 then 'nearby' else 'distant' end;
    out := out || jsonb_build_object('hero', rec.hero_name, 'dir', dir, 'band', band);
    if d < bestd then bestd := d; end if;
  end loop;

  update public.warpath_expeditions
     set moves_left = moves_left - 1, scouted_turn = run.turn where id = me.id;

  if jsonb_array_length(out) = 0 then
    return jsonb_build_object('ok', true, 'reports', out, 'moves_left', me.moves_left - 1,
                              'summary', 'Your scout finds no sign of anyone. Nobody you have seen is camped near here.');
  end if;
  perform public.wp_log(me.run_id, me.id, 'scout_report',
    jsonb_build_object('count', jsonb_array_length(out)));
  return jsonb_build_object('ok', true, 'reports', out, 'moves_left', me.moves_left - 1,
                            'nearest', bestd);
end $$;

-- Abandon: walk away with nothing. Kept so a stuck player is never trapped in
-- a run, which would also block them from ever entering another one.
create or replace function public.warpath_abandon(p_exp uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.warpath_expeditions;
begin
  -- Derive from auth.uid() when the caller did not name one (the client never does).
  p_exp := coalesce(p_exp, public.wp_active_exp());
  me := public.wp_my_exp(p_exp);
  if me.id is null then return jsonb_build_object('ok', false, 'reason', 'not_your_expedition'); end if;
  if me.status in ('extracted','lost') then return jsonb_build_object('ok', true, 'already', me.status); end if;
  update public.warpath_expeditions set status = 'lost', ended_at = now() where id = me.id;
  perform public.wp_log(me.run_id, me.id, 'abandoned', jsonb_build_object('hero', me.hero_name));
  return jsonb_build_object('ok', true);
end $$;

/* ── DRAINING THE OUTBOX — READ, THEN APPLY, THEN ACKNOWLEDGE ─────────────
   ⚠ warpath_grants_claim() below marks the grant claimed IN THE SAME CALL that
   returns it, which makes it unsafe for a browser client. A critic proved the
   failure with two tabs open: the drain ran in a NON-WRITER tab, saveProfile()
   returned early (it refuses to write from a reader tab), and the cards were
   thrown away — while the server had already recorded them as delivered. The
   player permanently lost cards they had earned.

   So the client now uses this pair instead:
     warpath_grants_pending()  — read-only, changes nothing
     warpath_grants_ack(ids)   — called ONLY after the client has verified the
                                 cards are on disk

   claim() is kept for compatibility with anything already calling it, but the
   game does not. If you are writing a new consumer, use the pair. */
create or replace function public.warpath_grants_pending()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); out jsonb := '[]'; rec record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  for rec in select * from public.warpath_grants
              where user_id = v_uid and claimed = false order by created_at loop
    out := out || jsonb_build_object('id', rec.id, 'run_id', rec.run_id,
                                     'card_keys', rec.card_keys, 'materials', rec.materials,
                                     'summary', rec.summary);
  end loop;
  return jsonb_build_object('ok', true, 'grants', out);
end $$;

-- Acknowledge specific grants. Scoped to the caller and to still-unclaimed
-- rows, so it can be retried safely and can never touch another account.
create or replace function public.warpath_grants_ack(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', true, 'acked', 0); end if;
  update public.warpath_grants set claimed = true, claimed_at = now()
   where user_id = v_uid and claimed = false and id = any(p_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'acked', n);
end $$;

/* Legacy read-and-mark drain. See the note above — the game no longer calls
   this, because marking delivered before the client has persisted anything
   loses cards whenever the write fails. */
create or replace function public.warpath_grants_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); out jsonb := '[]'; rec record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  for rec in update public.warpath_grants set claimed = true, claimed_at = now()
              where user_id = v_uid and claimed = false
              returning * loop
    out := out || jsonb_build_object('run_id', rec.run_id, 'card_keys', rec.card_keys,
                                     'materials', rec.materials, 'summary', rec.summary);
  end loop;
  return jsonb_build_object('ok', true, 'grants', out);
end $$;

/* ── EXECUTE grants ───────────────────────────────────────────────────────
   The warpath_* RPCs are the public surface: every one is security definer and
   re-checks auth.uid() internally.

   ⚠ THE wp_* HELPERS ARE NOT PUBLIC, and the first version of this loop only
   granted `warpath\_%` — which left the wp_* helpers on Postgres's default of
   EXECUTE TO PUBLIC. Two of them are security definer, mutating, and take an
   arbitrary expedition id with no ownership check. A critic called wp_reveal()
   over REST against another player's expedition and switched their fog off
   entirely: 34 bits revealed → 1320. wp_log() would let anyone forge run-feed
   entries the same way.

   So EXECUTE is revoked from public and authenticated on every wp_* function.
   The two exceptions are wp_in_run() and wp_is_mine(), which RLS policies call
   — policy expressions are evaluated as the QUERYING role, so revoking those
   would break every SELECT in the schema. Both are boolean and auth.uid()-
   scoped, so they answer nothing about anyone but the caller. */
do $$ declare f record; begin
  for f in select p.oid::regprocedure::text as sig, p.proname from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'wp\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
  end loop;
  -- the two the RLS policies themselves depend on
  for f in select p.oid::regprocedure::text as sig from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('wp_in_run', 'wp_is_mine') loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure::text as sig from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'warpath\_%' loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Read-only for clients, on every run table. There are deliberately NO
-- insert/update/delete grants and NO write policies: the only way to change
-- run state is through the security-definer RPCs above.
do $$ declare t text; begin
  for t in select tablename from pg_tables
            where schemaname = 'public' and tablename like 'warpath\_%' loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;
