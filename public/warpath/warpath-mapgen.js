/* ============================================================================
   WARPATH — deterministic world generation.
   ----------------------------------------------------------------------------
   THE WHOLE POINT OF THIS FILE: the Warpath world is a SEED, not a table.

   `warpath_runs.seed` is assigned server-side. Every client derives the exact
   same 44x30 world from it, and `public.wp_*` in the Warpath migration derives
   the same world AGAIN, in plpgsql, to validate what a client claims it found.
   No tile rows anywhere. Fog of war, node depletion, camp position and the
   hero's location are the only mutable spatial state, and those ARE rows.

   That means every function below has to obey three rules, or the SQL mirror
   silently drifts out of agreement with the browser and players start seeing
   "there is no iron node there":

     1. PURELY LOCAL. tileAt(seed,x,y) may never look at a neighbouring tile.
        A flood fill, an erosion pass or a "smooth the coastline" step is not
        reproducible in plpgsql at an acceptable cost. Everything is O(1) in
        the tile, or O(CORE_COUNT) at worst.
     2. 32-BIT EXACT. All arithmetic goes through wpHash32, whose every step is
        expressible in Postgres (`#` for xor, `>>` for logical shift, and a
        numeric cast around each multiply because uint32 * uint32 overflows
        bigint). Do not introduce Math.random, Date, or floats into the hash.
     3. NO NEGATIVE INPUTS. x, y and salts are always >= 0.

   `_selftest.js` runs 20,000 (seed,x,y) triples through this file and through
   the SQL and diffs them. If you change the hash, run it.

   Loaded as a plain <script> by public/warpath/index.html (window.WarpathMap)
   and as a CommonJS module by the test harness.
   ========================================================================= */
(function (root) {
'use strict';

// ── World dimensions ──────────────────────────────────────────────────────
// 44x30 = 1320 tiles. Sized for the Milestone-1 brief: four players, a run
// that lasts roughly 40-70 turns, and enough distance that two heroes can
// spend a while not finding each other.
var WORLD_W = 44;
var WORLD_H = 30;

// ── The land lattice ──────────────────────────────────────────────────────
// Water is placed by a local hash roll, which on its own can enclose a pocket
// of land and strand a resource node (or, much worse, a player). Rather than
// run a connectivity pass — which would break rule 1 — we simply declare that
// two families of lines are ALWAYS land:
//
//     every row where  y % 6 === 3
//     every column where x % 7 === 4
//
// Those lines form a connected grid spanning the whole map, so the land is
// guaranteed connected, provably, with no global computation. Everything the
// run cannot function without — spawns, extraction gates, recruitment sites,
// the landmark — is snapped ONTO the lattice, so all of it is always reachable
// from everything else. Ponds off the lattice are allowed to strand a resource
// node; that is a flavour of bad luck, not a broken run.
var LATTICE_ROW = 6, LATTICE_ROW_OFF = 3;
var LATTICE_COL = 7, LATTICE_COL_OFF = 4;

// ── Salts ─────────────────────────────────────────────────────────────────
// Distinct salts keep the different rolls for one tile independent. These
// values are duplicated in the migration; changing one means changing both.
var S_WATER = 1, S_TERRAIN = 2, S_NODE = 3, S_NODE_KIND = 4, S_NODE_AMT = 5,
    S_CORE_X = 6, S_CORE_Y = 7, S_CORE_KIND = 8, S_SPAWN = 9, S_GATE = 10,
    S_LANDMARK = 11, S_BIOME_FUZZ = 12, S_RECRUIT = 13;

/* ── wpHash32 ──────────────────────────────────────────────────────────────
   A 32-bit integer hash (murmur-ish finaliser). Mirrored EXACTLY by
   public.wp_hash32(bigint,int,int,int) in the migration.

   Math.imul(a,b) returns the low 32 bits of a*b as a signed int32; the low 32
   bits are identical whether you read the operands as signed or unsigned, so
   `Math.imul(a,b) >>> 0` is precisely `(a*b) mod 2^32`. That is what the SQL
   side computes with `(a::numeric * b) % 4294967296`.                       */
function wpHash32(seed, x, y, salt) {
  var h = ((seed >>> 0) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (y >>> 0), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (salt >>> 0), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}
// Convenience: a hash roll reduced into [0, n).
function wpRoll(seed, x, y, salt, n) { return wpHash32(seed, x, y, salt) % n; }

/* ── Biomes ───────────────────────────────────────────────────────────────
   The brief's framing: "different locations become packs". Each biome is a
   booster with a different card pool, so a player learning the map is learning
   the draft. `pack` is the line the UI shows when you first set foot in one. */
var BIOMES = {
  plains: {
    id: 'plains', name: 'Open Steppe', icon: '🌾', tone: '#9db071',
    pack: 'Common units, Food and Expedition Gold. Safe ground, thin rewards.',
    nodeDensity: 34, moveBase: 1,
    nodes: [['food', 40], ['gold', 24], ['wood', 20], ['stone', 16]],
  },
  forest: {
    id: 'forest', name: 'Ancient Forest', icon: '🌲', tone: '#3f7d4a',
    pack: 'Nature units, Beast and Poison cards, Nature equipment.',
    nodeDensity: 46, moveBase: 1,
    nodes: [['wood', 38], ['food', 24], ['essence', 20], ['kalon_fragment', 4], ['gold', 14]],
  },
  graveyard: {
    id: 'graveyard', name: 'The Graveyard', icon: '🪦', tone: '#6b5f80',
    pack: 'Undead units, Graveyard triggers, Necromancy, cursed artifacts.',
    nodeDensity: 40, moveBase: 1,
    // Dead trees. Wood is thin outside the forest but never absent — a run
    // that cannot find any wood cannot build a camp at all (see the note on
    // STARTING_STIPEND in warpath-data.js).
    nodes: [['essence', 34], ['ancient_bone', 14], ['stone', 22], ['gold', 20], ['void_crystal', 4], ['wood', 12]],
  },
  facility: {
    id: 'facility', name: 'Ouroboros Facility', icon: '🧪', tone: '#4f86a8',
    pack: 'Rare artifacts, experimental equipment, strange trigger cards.',
    nodeDensity: 36, moveBase: 1,
    nodes: [['iron', 36], ['essence', 22], ['ouroboros_core', 12], ['gold', 22], ['celestial_ore', 5], ['wood', 8]],
  },
  mountain: {
    id: 'mountain', name: 'Dragon Mountain', icon: '🌋', tone: '#a3583f',
    pack: 'Dragon units, Fire resources, Dragon equipment, legendary foes.',
    nodeDensity: 42, moveBase: 2,
    nodes: [['stone', 34], ['iron', 26], ['dragon_heart', 10], ['celestial_ore', 8], ['food', 12], ['wood', 8]],
  },
  wastes: {
    id: 'wastes', name: 'The Ashen Wastes', icon: '🏜', tone: '#8a7b62',
    pack: 'Little grows here. What you find, nobody else wanted to walk for.',
    nodeDensity: 22, moveBase: 1,
    nodes: [['stone', 30], ['iron', 22], ['void_crystal', 10], ['gold', 24], ['essence', 12], ['wood', 10]],
  },
};
var BIOME_ORDER = ['plains', 'forest', 'graveyard', 'facility', 'mountain', 'wastes'];

/* ── Resources ────────────────────────────────────────────────────────────
   Two tiers, and the split is the mode's whole risk/reward economy.

   EXPEDITION resources are spent inside the run — building the camp,
   recruiting, surviving — and evaporate at the end. EXTRACTION materials are
   the things you are actually out here for; they cannot be obtained in the
   permanent city at all, and they only become yours if you secure them in the
   camp vault and then walk your Hero to a gate.                            */
var EXPEDITION_RESOURCES = ['wood', 'stone', 'iron', 'food', 'essence', 'gold'];
var EXTRACTION_MATERIALS  = ['dragon_heart', 'void_crystal', 'celestial_ore',
                             'ancient_bone', 'ouroboros_core', 'kalon_fragment'];
var RESOURCES = {
  wood:            { id: 'wood',            name: 'Wood',            icon: '🪵', tier: 'expedition', yieldMin: 8,  yieldMax: 22 },
  stone:           { id: 'stone',           name: 'Stone',           icon: '🪨', tier: 'expedition', yieldMin: 8,  yieldMax: 20 },
  iron:            { id: 'iron',            name: 'Iron',            icon: '⛓️', tier: 'expedition', yieldMin: 5,  yieldMax: 14 },
  food:            { id: 'food',            name: 'Food',            icon: '🍖', tier: 'expedition', yieldMin: 10, yieldMax: 28 },
  essence:         { id: 'essence',         name: 'Essence',         icon: '✨', tier: 'expedition', yieldMin: 4,  yieldMax: 12 },
  gold:            { id: 'gold',            name: 'Expedition Gold', icon: '🪙', tier: 'expedition', yieldMin: 12, yieldMax: 40 },
  dragon_heart:    { id: 'dragon_heart',    name: 'Dragon Heart',    icon: '🫀', tier: 'extraction', yieldMin: 1, yieldMax: 1 },
  void_crystal:    { id: 'void_crystal',    name: 'Void Crystal',    icon: '🔮', tier: 'extraction', yieldMin: 1, yieldMax: 1 },
  celestial_ore:   { id: 'celestial_ore',   name: 'Celestial Ore',   icon: '🌟', tier: 'extraction', yieldMin: 1, yieldMax: 1 },
  ancient_bone:    { id: 'ancient_bone',    name: 'Ancient Bone',    icon: '🦴', tier: 'extraction', yieldMin: 1, yieldMax: 1 },
  ouroboros_core:  { id: 'ouroboros_core',  name: 'Ouroboros Core',  icon: '⚙️', tier: 'extraction', yieldMin: 1, yieldMax: 1 },
  kalon_fragment:  { id: 'kalon_fragment',  name: 'Kalon Fragment',  icon: '🍎', tier: 'extraction', yieldMin: 1, yieldMax: 1 },
};

/* ── Lattice helpers ──────────────────────────────────────────────────────
   ⚠ INTEGER ONLY, deliberately. An earlier draft used
   `LATTICE_ROW_OFF + LATTICE_ROW * Math.round((y - LATTICE_ROW_OFF)/LATTICE_ROW)`,
   which is floating point AND relies on JS's round-half-toward-+Infinity rule.
   Postgres `round()` on numeric is round-half-AWAY-from-zero, so the two
   languages would disagree on exactly the halfway cases — and a structure
   placed one tile apart on the server and the client is a silent, intermittent
   "you are not standing on the gate" bug. Scanning the handful of candidate
   lines instead is unambiguous in both languages and costs nothing.          */
function onLattice(x, y) {
  return (y % LATTICE_ROW) === LATTICE_ROW_OFF || (x % LATTICE_COL) === LATTICE_COL_OFF;
}
function nearestLatticeRow(y) {
  var best = LATTICE_ROW_OFF, bd = 9999, r;
  for (r = LATTICE_ROW_OFF; r < WORLD_H; r += LATTICE_ROW) {
    var d = Math.abs(r - y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
function nearestLatticeCol(x) {
  var best = LATTICE_COL_OFF, bd = 9999, c;
  for (c = LATTICE_COL_OFF; c < WORLD_W; c += LATTICE_COL) {
    var d = Math.abs(c - x);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
// Snap an arbitrary point onto the nearest lattice line, clamped in-bounds.
// Used for every structure that MUST be reachable.
function snapToLattice(x, y) {
  x = Math.max(0, Math.min(WORLD_W - 1, x | 0));
  y = Math.max(0, Math.min(WORLD_H - 1, y | 0));
  if (onLattice(x, y)) return { x: x, y: y };
  var ry = nearestLatticeRow(y), cx = nearestLatticeCol(x);
  // Ties go to the row, in both languages.
  return (Math.abs(ry - y) <= Math.abs(cx - x)) ? { x: x, y: ry } : { x: cx, y: y };
}

/* ── Biome cores ──────────────────────────────────────────────────────────
   Biome regions are a Voronoi over 12 cores. Cores are laid out one per cell
   of a 4x3 grid — which is what keeps regions spread out instead of clumping
   into one corner — and jittered inside their cell by the hash.

   The first four cores are FORCED to be the four "pack" biomes, because the
   brief's draft depends on all four existing: a run where Dragon Mountain
   never generated is a run where nobody can build a fire deck. Cores 4..11
   roll from a weighted pool.                                                */
var CORE_COLS = 4, CORE_ROWS = 3, CORE_COUNT = 12;
var FORCED_CORES = ['forest', 'graveyard', 'facility', 'mountain'];
var CORE_POOL = ['plains', 'plains', 'plains', 'wastes', 'wastes',
                 'forest', 'mountain', 'graveyard'];

/* ⚠ THE CELLS ARE SHUFFLED, and that is not decoration.
   The first version put core i in cell i, so cores 0..3 — the four FORCED pack
   biomes — always landed in the top row of cells. Dumping a world to ASCII made
   it obvious: forest/graveyard/facility/mountain across the north, plains and
   wastes across the south, every single seed. The brief is explicit that
   "players shouldn't memorize 'Dragon is always at coordinate 42'", and that
   layout is worse — Dragon Mountain was always in the north-east.

   So the 12 grid cells are permuted by a seeded Fisher-Yates first, and core i
   takes cells[i]. The four pack biomes still all exist (that is what FORCED
   is for) but no player can learn where they will be. The SQL mirror runs the
   identical shuffle. */
function shuffledCells(seed) {
  var cells = [], i, j, t;
  for (i = 0; i < CORE_COUNT; i++) cells.push(i);
  for (i = CORE_COUNT - 1; i > 0; i--) {
    j = wpRoll(seed, i, 0, S_CORE_KIND + 100, i + 1);
    t = cells[i]; cells[i] = cells[j]; cells[j] = t;
  }
  return cells;
}

// CW/CH are exact: 44/4 = 11 and 30/3 = 10. Kept as constants so the SQL
// mirror does not have to divide.
var CORE_CW = 11, CORE_CH = 10;

function biomeCores(seed) {
  var cores = [], i;
  var cells = shuffledCells(seed);
  for (i = 0; i < CORE_COUNT; i++) {
    var cell = cells[i];
    var cellX = cell % CORE_COLS, cellY = (cell / CORE_COLS) | 0;
    // Jitter within the middle 60% of the cell so cores never land flush
    // against a cell border (which would put two cores adjacent).
    // ⚠ Integer arithmetic only — the roll IS the per-mille offset, so there
    // is no float here for the plpgsql mirror to disagree with.
    var jx = wpRoll(seed, i, 0, S_CORE_X, 600);
    var jy = wpRoll(seed, i, 0, S_CORE_Y, 600);
    var px = Math.floor((CORE_CW * (cellX * 1000 + 200 + jx)) / 1000);
    var py = Math.floor((CORE_CH * (cellY * 1000 + 200 + jy)) / 1000);
    var kind;
    if (i < FORCED_CORES.length) kind = FORCED_CORES[i];
    else kind = CORE_POOL[wpRoll(seed, i, 0, S_CORE_KIND, CORE_POOL.length)];
    cores.push({ i: i, x: Math.min(WORLD_W - 1, px), y: Math.min(WORLD_H - 1, py), biome: kind });
  }
  return cores;
}

/* Nearest core by squared euclidean distance, with a per-tile fuzz so the
   borders between biomes are ragged rather than a clean Voronoi edge.

   ⚠ The fuzz is applied as `d * (940 + roll)` — i.e. everything is scaled by
   1000 and stays an INTEGER — rather than `d + d*(roll-60)/1000`, which was
   the first version and produced a float. Comparing floats for the argmin is
   exactly where the JS and plpgsql copies would eventually disagree by one
   tile, and a biome that differs between client and server means the server
   rejecting a legitimate harvest. Max magnitude here is 2836 * 1059 ≈ 3.0e6:
   nowhere near overflow in either language.                                  */
function biomeAt(seed, cores, x, y) {
  var best = 0, bestD = Infinity, i;
  for (i = 0; i < cores.length; i++) {
    var dx = cores[i].x - x, dy = cores[i].y - y;
    var d = (dx * dx + dy * dy) * (940 + wpRoll(seed, x * 64 + i, y, S_BIOME_FUZZ, 120));
    if (d < bestD) { bestD = d; best = i; }
  }
  return cores[best].biome;
}

/* ── Terrain ──────────────────────────────────────────────────────────────
   Water is blobby because the roll is taken at 3x3 block granularity, then
   thinned per-tile — so you get small ponds and inlets rather than salt-and-
   pepper noise. Never on the lattice, never in the outer ring (an edge lake
   looks like a rendering bug). */
function isWater(seed, x, y) {
  if (onLattice(x, y)) return false;
  if (x < 1 || y < 1 || x >= WORLD_W - 1 || y >= WORLD_H - 1) return false;
  if (wpRoll(seed, (x / 3) | 0, (y / 3) | 0, S_WATER, 100) >= 17) return false;
  return wpRoll(seed, x, y, S_WATER + 40, 100) < 62;
}

// Move cost. Mountains are slow, forests are slow, roughness is a hash roll.
// Everything a hero must reach sits on the lattice, and the lattice is never
// rough — so the arterial routes stay fast and the interior is where you pay.
function moveCostAt(seed, biome, x, y) {
  if (onLattice(x, y)) return 1;
  var b = BIOMES[biome];
  var rough = wpRoll(seed, x, y, S_TERRAIN, 100) < 26 ? 1 : 0;
  return Math.min(3, b.moveBase + rough);
}

/* ── Structures ───────────────────────────────────────────────────────────
   Spawns, extraction gates, recruitment sites and the landmark. All of them
   are derived from the cores and snapped onto the lattice, so all of them are
   always reachable from each other. The SQL mirror recomputes this list the
   same way when it needs to answer "is the hero standing on an extraction
   gate?" or "which tile does slot 2 start on?" without storing anything.

   ⚠ THEY ARE PLACED IN ONE PASS, NOT FOUR. The first version of this file
   deduped each list separately, and the self-test immediately found seeds
   where a spawn landed exactly on a recruitment site — a free draft on turn 1
   for whoever got that slot — and seeds where a portal sat on the Barrow Gate.
   Placement now runs through a single occupancy list with a minimum
   separation, in a FIXED order, so the outcome stays deterministic.          */

// Every lattice tile in row-major order. The placement walk steps through
// this array, which is what guarantees it terminates on a free tile.
function latticeTiles() {
  var out = [], x, y;
  for (y = 0; y < WORLD_H; y++) for (x = 0; x < WORLD_W; x++) if (onLattice(x, y)) out.push([x, y]);
  return out;
}

var MIN_SEP = 5;   // Chebyshev tiles between any two structures

function placeStructures(seed) {
  var LAT = latticeTiles();
  var index = {}, i;
  for (i = 0; i < LAT.length; i++) index[LAT[i][0] + ':' + LAT[i][1]] = i;
  var claimed = [];

  // Walk forward through the lattice from the desired spot until we find a
  // tile far enough from everything already placed.
  function place(hx, hy) {
    var s = snapToLattice(hx, hy);
    var start = index[s.x + ':' + s.y];
    if (start == null) start = 0;
    for (var k = 0; k < LAT.length; k++) {
      var p = LAT[(start + k) % LAT.length];
      var ok = true;
      for (var j = 0; j < claimed.length; j++) {
        if (chebyshev(p[0], p[1], claimed[j][0], claimed[j][1]) < MIN_SEP) { ok = false; break; }
      }
      if (ok) { claimed.push(p); return { x: p[0], y: p[1] }; }
    }
    // Unreachable in practice: ~370 lattice tiles, 11 structures, sep 5.
    throw new Error('warpath-mapgen: lattice exhausted placing a structure');
  }

  var cores = biomeCores(seed);
  var out = { gates: [], sites: [], spawns: [], landmark: null };

  // 1 — the Warpath Gate, dead centre. Everyone knows where the safe exit is;
  //     that is the point. Placed first so nothing can displace it.
  var mid = place(WORLD_W >> 1, WORLD_H >> 1);
  out.gates.push({ id: 'gate_main', name: 'The Warpath Gate', icon: '🚪', x: mid.x, y: mid.y, main: true });

  // 2 — two wandering portals.
  var portalNames = ['Weeping Portal', 'Cracked Portal'];
  for (i = 0; i < 2; i++) {
    var gx = wpRoll(seed, i, 0, S_GATE, WORLD_W - 8) + 4;
    var gy = wpRoll(seed, i, 1, S_GATE, WORLD_H - 8) + 4;
    var g = place(gx, gy);
    out.gates.push({ id: 'gate_' + i, name: portalNames[i], icon: '🌀', x: g.x, y: g.y, main: false });
  }

  // 3 — three recruitment sites, one anchored in each unit-bearing pack biome.
  for (i = 0; i < RECRUIT_SITES.length; i++) {
    var spec = RECRUIT_SITES[i], c = cores[spec.core];
    var ox = wpRoll(seed, i, 0, S_RECRUIT, 7) - 3;
    var oy = wpRoll(seed, i, 1, S_RECRUIT, 7) - 3;
    var p = place(c.x + ox, c.y + oy);
    out.sites.push({ id: spec.id, name: spec.name, icon: spec.icon, biome: spec.biome,
                     blurb: spec.blurb, x: p.x, y: p.y });
  }

  // 4 — the landmark: one per world, identity hidden until you walk in.
  var l = LANDMARKS[wpRoll(seed, 0, 0, S_LANDMARK, LANDMARKS.length)];
  var lx = wpRoll(seed, 1, 0, S_LANDMARK, WORLD_W - 10) + 5;
  var ly = wpRoll(seed, 1, 1, S_LANDMARK, WORLD_H - 10) + 5;
  var lp = place(lx, ly);
  out.landmark = { id: l.id, name: l.name, icon: l.icon, blurb: l.blurb,
                   guardian: l.guardian, reward: l.reward, x: lp.x, y: lp.y };

  // 5 — four spawns, one per quadrant. Placed LAST so a hero never begins on
  //     top of a gate, a site or the landmark.
  var qx = [0.16, 0.84, 0.16, 0.84], qy = [0.18, 0.18, 0.82, 0.82];
  for (i = 0; i < 4; i++) {
    var jx = wpRoll(seed, i, 0, S_SPAWN, 7) - 3;
    var jy = wpRoll(seed, i, 1, S_SPAWN, 5) - 2;
    var sp = place(Math.round(WORLD_W * qx[i]) + jx, Math.round(WORLD_H * qy[i]) + jy);
    out.spawns.push({ slot: i, x: sp.x, y: sp.y });
  }
  return out;
}

// Three recruitment sites — the brief's "Pick 1 of 3" draft locations. One is
// anchored to each of the three pack biomes that recruit *units*: the forest
// (beasts), the graveyard (undead) and the facility (constructs). Dragon
// Mountain deliberately has none: its dragons are boss loot, not hirelings.
var RECRUIT_SITES = [
  { core: 0, id: 'forest_hollow',  name: 'Verdant Hollow',    icon: '🌿', biome: 'forest',
    blurb: 'Beasts and wardens of the old wood. They hire for meat.' },
  { core: 1, id: 'barrow_gate',    name: 'The Barrow Gate',   icon: '💀', biome: 'graveyard',
    blurb: 'The dead take essence, not coin. They do not eat.' },
  { core: 2, id: 'assembly_floor', name: 'Assembly Floor 3',  icon: '🤖', biome: 'facility',
    blurb: 'Ouroboros constructs, mid-fabrication. Iron finishes them.' },
];
function recruitSites(seed) { return placeStructures(seed).sites; }

// Extraction gates. One is the Warpath Gate itself, at the centre of the map —
// everyone knows where it is, which is the point: the safest exit is the one
// your rivals are also watching. Two more portals are hash-placed.
function gates(seed) { return placeStructures(seed).gates; }

// One rare landmark per world — the brief's "??? Unidentified Structure". You
// do not know which one it is until you walk into it.
var LANDMARKS = [
  { id: 'black_pyramid', name: 'The Black Pyramid', icon: '🔺',
    blurb: 'It was not built. It was left. A Guardian stands at the only door.',
    guardian: true, reward: 'ouroboros_core' },
  { id: 'the_garden', name: 'The Garden', icon: '🍏',
    blurb: 'Cultivated. Recently. There is fruit on the tree and nobody here.',
    guardian: false, reward: 'kalon_fragment' },
  { id: 'drowned_choir', name: 'The Drowned Choir', icon: '🕯',
    blurb: 'Thirty voices, no throats. They are still holding the note.',
    guardian: true, reward: 'void_crystal' },
];
function landmark(seed) { return placeStructures(seed).landmark; }

// Four spawn anchors, one per map quadrant, so no two heroes start on top of
// each other. Milestone 1 is a four-player mode; index 0..3 is the slot the
// server hands out at join time.
function spawns(seed) { return placeStructures(seed).spawns; }

/* ── Resource nodes ───────────────────────────────────────────────────────
   Density and the kind table come from the biome. A node's yield is rolled
   from the hash too, so the server can independently compute exactly how much
   a player is allowed to have harvested from tile (x,y) — the client never
   gets to name the number.                                                  */
function nodeAt(seed, biome, x, y) {
  var b = BIOMES[biome];
  if (wpRoll(seed, x, y, S_NODE, 1000) >= b.nodeDensity * 10) return null;
  var total = 0, i;
  for (i = 0; i < b.nodes.length; i++) total += b.nodes[i][1];
  var r = wpRoll(seed, x, y, S_NODE_KIND, total), acc = 0, kind = b.nodes[0][0];
  for (i = 0; i < b.nodes.length; i++) {
    acc += b.nodes[i][1];
    if (r < acc) { kind = b.nodes[i][0]; break; }
  }
  var meta = RESOURCES[kind];
  var span = meta.yieldMax - meta.yieldMin + 1;
  var amount = meta.yieldMin + wpRoll(seed, x, y, S_NODE_AMT, span);
  return { kind: kind, amount: amount, tier: meta.tier,
           name: meta.name, icon: meta.icon };
}

/* ── tileAt — the single entry point ──────────────────────────────────────
   Everything above, composed. `cores` is passed in by the caller when it is
   walking the whole map (generate()) so the 12 cores aren't recomputed 1320
   times; callers with one tile can omit it.                                */
function tileAt(seed, x, y, cores) {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return null;
  cores = cores || biomeCores(seed);
  var water = isWater(seed, x, y);
  var biome = biomeAt(seed, cores, x, y);
  var t = {
    x: x, y: y,
    biome: water ? 'water' : biome,
    water: water,
    passable: !water,
    lattice: onLattice(x, y),
    moveCost: water ? 0 : moveCostAt(seed, biome, x, y),
    node: null,
  };
  if (!water) t.node = nodeAt(seed, biome, x, y);
  return t;
}

/* ── generate — the whole world, once, for the renderer ───────────────────
   Returns tiles as a flat row-major array plus the structure lists. The
   client calls this once when the run loads and then never again; the SQL
   side never calls anything like it (it only ever asks about single tiles). */
function generate(seed) {
  seed = seed >>> 0;
  var cores = biomeCores(seed);
  var tiles = new Array(WORLD_W * WORLD_H);
  var x, y;
  for (y = 0; y < WORLD_H; y++) {
    for (x = 0; x < WORLD_W; x++) tiles[y * WORLD_W + x] = tileAt(seed, x, y, cores);
  }
  var st = placeStructures(seed);   // ONE pass — see the note above placeStructures
  var world = {
    seed: seed, w: WORLD_W, h: WORLD_H,
    cores: cores, tiles: tiles,
    spawns: st.spawns, gates: st.gates, sites: st.sites, landmark: st.landmark,
  };
  // Structures sit on the lattice, which is never water — but assert it, so a
  // future change to isWater() fails loudly here instead of stranding a player.
  var all = world.spawns.concat(world.gates, world.sites, [world.landmark]);
  for (var i = 0; i < all.length; i++) {
    var tt = tiles[all[i].y * WORLD_W + all[i].x];
    if (!tt || !tt.passable) throw new Error('warpath-mapgen: structure on impassable tile ' + all[i].x + ',' + all[i].y);
  }
  world.at = function (px, py) {
    return (px < 0 || py < 0 || px >= WORLD_W || py >= WORLD_H) ? null : tiles[py * WORLD_W + px];
  };
  return world;
}

// ── Movement ──────────────────────────────────────────────────────────────
// 8-way, Chebyshev. Vision is Chebyshev too, so the fog reveal is a square —
// which reads correctly on a square grid and is trivial for SQL to re-check.
function chebyshev(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
function neighbours(x, y) {
  var out = [], dx, dy;
  for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    var nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < WORLD_W && ny < WORLD_H) out.push([nx, ny]);
  }
  return out;
}

/* Dijkstra over move cost, bounded by the movement points the hero has left.
   Returns { "x,y": costToReach } for everything affordable this turn. The
   client uses it to paint the reachable set and to animate the walk; the
   server re-derives the same bound to validate the destination. */
function reachable(world, sx, sy, budget) {
  var dist = {}, key = sx + ',' + sy;
  dist[key] = 0;
  var frontier = [[0, sx, sy]];
  while (frontier.length) {
    frontier.sort(function (a, b) { return a[0] - b[0]; });
    var cur = frontier.shift();
    var d = cur[0], x = cur[1], y = cur[2];
    if (d > (dist[x + ',' + y] != null ? dist[x + ',' + y] : 1e9)) continue;
    var ns = neighbours(x, y), i;
    for (i = 0; i < ns.length; i++) {
      var t = world.at(ns[i][0], ns[i][1]);
      if (!t || !t.passable) continue;
      var nd = d + t.moveCost;
      if (nd > budget) continue;
      var k = ns[i][0] + ',' + ns[i][1];
      if (dist[k] == null || nd < dist[k]) { dist[k] = nd; frontier.push([nd, ns[i][0], ns[i][1]]); }
    }
  }
  return dist;
}

// A concrete path for the walk animation, reconstructed greedily downhill
// through the reachable set. Cheap and good enough — this is cosmetic.
function pathTo(world, dist, sx, sy, tx, ty) {
  var path = [], x = tx, y = ty, guard = 0;
  while (!(x === sx && y === sy) && guard++ < 400) {
    path.unshift([x, y]);
    var ns = neighbours(x, y), best = null, bestD = dist[x + ',' + y];
    for (var i = 0; i < ns.length; i++) {
      var k = ns[i][0] + ',' + ns[i][1];
      if (dist[k] != null && dist[k] < bestD) { bestD = dist[k]; best = ns[i]; }
    }
    if (!best) break;
    x = best[0]; y = best[1];
  }
  path.unshift([sx, sy]);
  return path;
}

root.WarpathMap = {
  WORLD_W: WORLD_W, WORLD_H: WORLD_H,
  BIOMES: BIOMES, BIOME_ORDER: BIOME_ORDER,
  RESOURCES: RESOURCES,
  EXPEDITION_RESOURCES: EXPEDITION_RESOURCES,
  EXTRACTION_MATERIALS: EXTRACTION_MATERIALS,
  LANDMARKS: LANDMARKS,
  wpHash32: wpHash32, wpRoll: wpRoll,
  onLattice: onLattice, snapToLattice: snapToLattice,
  nearestLatticeRow: nearestLatticeRow, nearestLatticeCol: nearestLatticeCol,
  biomeCores: biomeCores, shuffledCells: shuffledCells, biomeAt: biomeAt, isWater: isWater,
  moveCostAt: moveCostAt, nodeAt: nodeAt,
  spawns: spawns, gates: gates, recruitSites: recruitSites, landmark: landmark,
  placeStructures: placeStructures, latticeTiles: latticeTiles, MIN_SEP: MIN_SEP,
  tileAt: tileAt, generate: generate,
  chebyshev: chebyshev, neighbours: neighbours,
  reachable: reachable, pathTo: pathTo,
};

})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
