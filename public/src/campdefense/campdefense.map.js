/* ════════════════════════════════════════════════════════════════════════════
   🏰 CAMP DEFENCE — turning the camp the player BUILT into the map they FIGHT on.
   ----------------------------------------------------------------------------
   `Forge.campLayout` and `Forge.campZones` decide where every building, wall
   and prop stands in the camp. Today that placement is decoration: raids
   resolve as arithmetic against a `campFortify` number and the layout is never
   consulted. This file is the contract that changes that.

   THE TRANSLATION, and the reasoning behind each rule:

     BUILDINGS → COVER + OBSTACLES.
       A building's footprint is impassable; the tiles immediately around it are
       COVER.

       ⚠ WHAT MATTERS IS CONNECTED COVER, NOT THE COUNT OF COVER TILES, and
       getting that backwards is an easy and expensive mistake. Four scattered
       buildings produce MORE total cover tiles than four clustered ones,
       because clustered rings overlap and scattered rings do not
       (_campdefense_smoke.mjs measured 48 vs 33 and caught exactly this).
       But scattered cover is four isolated islands: a defender crossing
       between them is in the open the whole way. Clustered cover is one
       contiguous region you can fight and fall back through — which is the
       property that actually wins a defence. So `coverRegions()` below
       measures the LARGEST CONNECTED region and the fortify score reads that,
       never the raw total.

     WALLS → THE PERIMETER, AND ITS GAPS.
       Attackers enter through the gaps. A camp with a complete wall funnels
       them to its gate; a camp with a hole in the north-east is attacked from
       the north-east. `entryPoints()` finds those gaps rather than picking
       spawn corners at random — being attacked where you are actually weak is
       the feedback that makes anyone rebuild a wall.

     DOORS → DEFENDER SPAWNS.
       Defenders start at the doors of their own buildings, because that is
       where they would be. It also means a camp with more buildings deploys
       more spread out, which is a real trade-off against the cover clustering
       buys.

   🔴 THIS FILE IS PURE. No DOM, no THREE, no globals — layout in, battle map
   out. That is what lets the derivation be tested (see _campdefense_smoke.mjs)
   and what stops it becoming a second copy of the camp renderer.

   🔴 IT NEVER MUTATES THE LAYOUT. The camp is the player's; a defence is a READ
   of it. Anything that writes back to campLayout from a battle is a bug — a
   lost raid must not rearrange somebody's camp.

   ⚒ ATHENA: `athenaAdapter()` at the bottom registers this as an Athena Engine
   game scene, so the map can be built and walked in 3D. See the note there for
   how the 3D world and this grid stay in agreement.
   ════════════════════════════════════════════════════════════════════════════ */

export const TILE = {
  OPEN:     0,   // walkable, no cover
  COVER:    1,   // walkable, grants cover — the ring around a building
  BLOCKED:  2,   // a building footprint — impassable
  WALL:     3,   // perimeter wall — impassable, destructible
  GATE:     4,   // a deliberate opening
  BREACH:   5,   // an ACCIDENTAL opening — a gap the player left
};

export const DEFAULT_DIMS = { w: 20, h: 15 };

/* ── Read the layout, defensively ────────────────────────────────────────
   Every field is optional because campLayout has been through several shapes
   and an old profile must still produce a playable map rather than a throw. */
export function readLayout(layout, zone) {
  const l = (layout && typeof layout === 'object') ? layout : {};
  const z = (zone && typeof zone === 'object') ? zone : {};
  const w = Math.max(8, Math.min(40, (l.mapW | 0) || (z.mapW | 0) || DEFAULT_DIMS.w));
  const h = Math.max(6, Math.min(30, (l.mapH | 0) || (z.mapH | 0) || DEFAULT_DIMS.h));

  const raw = []
    .concat(Array.isArray(l.buildings) ? l.buildings : [])
    .concat(Array.isArray(l.props) ? l.props : [])
    .concat(Array.isArray(z.buildings) ? z.buildings : []);

  const buildings = raw.map(bl => bl && {
    id: bl.id || bl.key || 'b',
    name: bl.name || bl.id || 'Structure',
    x: bl.x | 0, y: bl.y | 0,
    w: Math.max(1, (bl.w | 0) || 1),
    h: Math.max(1, (bl.h | 0) || 1),
    door: bl.door && typeof bl.door === 'object' ? { x: bl.door.x | 0, y: bl.door.y | 0 } : null,
    kind: bl.kind || (String(bl.id || '').includes('wall') ? 'wall' : 'building'),
    hp: (bl.hp | 0) || null,
  }).filter(Boolean);

  return { w, h, buildings };
}

const key = (x, y) => y * 1000 + x;

/* ── layout → battle grid ────────────────────────────────────────────────
   Returns { w, h, tiles: Uint8Array, cover:[…], spawns:{defender:[],attacker:[]},
             structures:[…], breaches:[…] } */
export function buildBattleMap(layout, zone, opts) {
  const { w, h, buildings } = readLayout(layout, zone);
  const o = opts || {};
  const tiles = new Uint8Array(w * h);            // TILE.OPEN everywhere by default
  const at = (x, y) => y * w + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

  const structures = [];
  const doors = [];

  // 1️⃣ Footprints.
  for (const b of buildings) {
    const isWall = b.kind === 'wall';
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        if (!inside(xx, yy)) continue;
        tiles[at(xx, yy)] = isWall ? TILE.WALL : TILE.BLOCKED;
      }
    }
    structures.push({
      id: b.id, name: b.name, kind: b.kind,
      x: b.x, y: b.y, w: b.w, h: b.h,
      // Destructible: a building's HP scales with its footprint, so a big depot
      // takes longer to level than a shack. Attackers CAN knock these down,
      // which is what makes rebuilding after a lost raid meaningful.
      hp: b.hp || Math.max(20, b.w * b.h * 15),
    });
    if (b.door && inside(b.door.x, b.door.y)) doors.push({ x: b.door.x, y: b.door.y, of: b.id });
  }

  // 2️⃣ Cover — the ring around every non-wall structure. Applied AFTER all
  //    footprints so a tile between two buildings is cover, not overwritten
  //    back to open by the second building's pass.
  const coverSet = Object.create(null);
  for (const b of buildings) {
    if (b.kind === 'wall') continue;
    for (let yy = b.y - 1; yy <= b.y + b.h; yy++) {
      for (let xx = b.x - 1; xx <= b.x + b.w; xx++) {
        if (!inside(xx, yy)) continue;
        if (tiles[at(xx, yy)] !== TILE.OPEN) continue;   // never downgrade a wall/footprint
        coverSet[key(xx, yy)] = true;
      }
    }
  }
  const cover = [];
  for (const k of Object.keys(coverSet)) {
    const y = Math.floor(k / 1000), x = k % 1000;
    tiles[at(x, y)] = TILE.COVER;
    cover.push({ x, y });
  }

  // 3️⃣ Doors read as gates — walkable openings, and defender spawns.
  for (const d of doors) {
    if (tiles[at(d.x, d.y)] === TILE.BLOCKED || tiles[at(d.x, d.y)] === TILE.WALL) {
      tiles[at(d.x, d.y)] = TILE.GATE;
    }
  }

  // 4️⃣ Where can attackers get in?
  const breaches = entryPoints(tiles, w, h);
  for (const b of breaches) if (tiles[at(b.x, b.y)] === TILE.OPEN) tiles[at(b.x, b.y)] = TILE.BREACH;

  // Connected cover — the number that actually describes how defensible this
  // layout is. See the header note; the raw `cover` length is kept for display
  // but must never be the thing a score or a decision reads.
  const regions = coverRegions(tiles, w, h);

  return {
    w, h, tiles, cover, structures, breaches,
    coverRegions: regions,
    largestCover: regions.length ? regions[0].length : 0,
    spawns: {
      // Defenders at their own doorways, falling back to the camp centre for a
      // camp with no buildings at all (a brand-new player being raided).
      defender: doors.length ? doors.map(d => ({ x: d.x, y: d.y })) : centreRing(w, h),
      attacker: breaches.length ? breaches : edgeTiles(tiles, w, h).slice(0, 6),
    },
    fortifyScore: fortifyScore(tiles, w, h, structures),
    meta: { derivedAt: Date.now(), source: o.source || 'campLayout' },
  };
}

/* ── The gaps in the perimeter ───────────────────────────────────────────
   Walks the map border and returns every edge tile an attacker can step onto.
   A fully walled camp returns only its gates; a camp with a hole returns the
   hole, which is where the attack comes from. THIS is the feedback loop —
   see the header. */
export function entryPoints(tiles, w, h) {
  const at = (x, y) => y * w + x;
  const open = [];
  /* 🔴 TILE.BREACH COUNTS AS AN OPENING — this function must be IDEMPOTENT.
     buildBattleMap calls entryPoints, stamps the tiles it finds as BREACH, and
     then fortifyScore calls entryPoints AGAIN on those same (now stamped)
     tiles. Leaving BREACH out of this list made the second pass find nothing,
     so a camp with a hole in its wall scored identically to a sealed one
     (_campdefense_smoke.mjs caught 70 == 70). A breach tile is, by definition,
     a way in; listing it here is both the fix and the honest reading. */
  const edge = (x, y) => {
    const t = tiles[at(x, y)];
    if (t === TILE.OPEN || t === TILE.COVER || t === TILE.GATE || t === TILE.BREACH) {
      open.push({ x, y, side: sideOf(x, y, w, h) });
    }
  };
  for (let x = 0; x < w; x++) { edge(x, 0); edge(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { edge(0, y); edge(w - 1, y); }

  /* Collapse runs of adjacent openings into ONE entry each. A 6-tile hole is
     one breach an attacking squad pours through, not six separate spawns —
     spawning six units across it would make a big hole *easier* to defend than
     a small one, which is exactly backwards.

     🔴 THE GROUPING IS TRANSITIVE, AND IT HAS TO BE. The first version of this
     compared every candidate against the run's SEED tile and took anything
     within 2, which splits a 5-wide gap into two breaches of 3 and 2 — the
     tiles at the far end are simply too far from the seed. A run is a chain:
     each tile extends it from whatever is currently on the END, not from where
     it started. _campdefense_smoke.mjs asserts the 5-wide case for this reason.
     Walking each side in sorted order makes the chain trivial to follow. */
  const out = [];
  const SIDES = ['north', 'south', 'west', 'east'];
  for (const side of SIDES) {
    // Along a side, one coordinate is fixed; sort by the one that varies so
    // adjacency is just "the next entry is one step along".
    const horiz = (side === 'north' || side === 'south');
    const run = open.filter(p => p.side === side)
                    .sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
    let i = 0;
    while (i < run.length) {
      let j = i;
      while (j + 1 < run.length) {
        const a = run[j], bb = run[j + 1];
        const step = horiz ? (bb.x - a.x) : (bb.y - a.y);
        if (step > 1) break;                  // a wall between them ends the run
        j++;
      }
      const group = run.slice(i, j + 1);
      const mid = group[Math.floor(group.length / 2)];
      out.push({ x: mid.x, y: mid.y, side, width: group.length });
      i = j + 1;
    }
  }
  return out;
}

/* ── Connected cover regions ─────────────────────────────────────────────
   Flood-fills the cover tiles into connected regions (4-way) and returns them
   largest first. THE measure of how defensible a layout is — see the note at
   the top of this file about why the raw cover count is the wrong number. */
export function coverRegions(tiles, w, h) {
  const at = (x, y) => y * w + x;
  const seen = new Uint8Array(w * h);
  const regions = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[at(x, y)] !== TILE.COVER || seen[at(x, y)]) continue;
      const stack = [[x, y]];
      seen[at(x, y)] = 1;
      const region = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        region.push({ x: cx, y: cy });
        const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (seen[at(nx, ny)] || tiles[at(nx, ny)] !== TILE.COVER) continue;
          seen[at(nx, ny)] = 1;
          stack.push([nx, ny]);
        }
      }
      regions.push(region);
    }
  }
  return regions.sort((a, b) => b.length - a.length);
}

function sideOf(x, y, w, h) {
  if (y === 0) return 'north';
  if (y === h - 1) return 'south';
  if (x === 0) return 'west';
  return 'east';
}

function edgeTiles(tiles, w, h) {
  const out = [];
  for (let x = 0; x < w; x++) { out.push({ x, y: 0 }); out.push({ x, y: h - 1 }); }
  for (let y = 1; y < h - 1; y++) { out.push({ x: 0, y }); out.push({ x: w - 1, y }); }
  return out;
}

function centreRing(w, h) {
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  return [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx + 1, y: cy }, { x: cx, y: cy - 1 }];
}

/* ── A number the camp panel can show BEFORE a raid ──────────────────────
   0..100. Rewards enclosure and cover, punishes wide-open breaches. It is a
   PREVIEW of the derivation above, computed from the same tiles, so the number
   the player optimises against and the map they fight on can never disagree —
   which they would the moment this became an independent formula. */
export function fortifyScore(tiles, w, h, structures) {
  const total = w * h;
  const breaches = entryPoints(tiles, w, h);

  /* 🔴 EACH BREACH COSTS A FIXED CHUNK, NOT A SHARE OF THE PERIMETER.
     The first version divided total breach width by the perimeter length. On a
     12×10 camp that made one hole in a wall worth 1/40th of the enclosure term
     — about 1.3 points, which rounded away to nothing, and a sealed camp and a
     breached one both scored 68 (_campdefense_smoke.mjs caught it). A hole in
     your wall is not a rounding error: it is the difference between a raid
     funnelled into your guns and a raid in your kitchen. So the FIRST breach
     is expensive and each further one costs less (you are already open; the
     second door matters less than the first), and width scales each cost. */
  let enclosure = 1;
  for (let i = 0; i < breaches.length; i++) {
    const widthFactor = Math.min(1, (breaches[i].width || 1) / 4);       // a 4-wide gap is "fully" open
    const marginal = 0.34 / (i + 1);                                     // 1st: .34, 2nd: .17, 3rd: .11 …
    enclosure -= marginal * (0.55 + 0.45 * widthFactor);
  }
  enclosure = Math.max(0, enclosure);

  /* Cover is measured as the LARGEST CONNECTED region, not the raw tile count.
     See the note at the top of this file — four isolated cover islands are
     worth far less than one contiguous one you can fall back through. */
  const regions = coverRegions(tiles, w, h);
  const biggest = regions.length ? regions[0].length : 0;
  const connected = Math.min(1, biggest / Math.max(1, total * 0.12));     // 12% in ONE region = full marks

  const density = Math.min(1, (structures || []).length / 10);

  return Math.round(enclosure * 54 + connected * 30 + density * 16);
}

/* ── ⚒ THE ATHENA ENGINE ADAPTER ─────────────────────────────────────────
   Registers the camp as an Athena game scene so the map can be built in 3D and
   walked with the player's character (map.player / map.cast — Athena already
   supports both).

   🔴 HOW THE 3D WORLD AND THIS GRID STAY IN AGREEMENT.
   The Athena map is an OVERLAY on the derivation above, never a replacement
   for it. Each camp structure becomes one Athena `slot` object whose `k` is the
   structure's id, so the builder moves the VISUAL, and the battle grid keeps
   coming from campLayout. If the two ever disagree, campLayout wins, because it
   is the thing the camp panel edits and the thing the raid maths reads.

   A future round can let the 3D placement write BACK to campLayout — that is
   the natural next step and it is deliberately not done here, because it makes
   the Athena map authoritative and that is a decision to take on purpose
   rather than by accident.

   Terrain is sized `cell = 2` metres per camp tile, which puts a 20×15 camp at
   40×30 m — about right for a character to walk across in a few seconds and
   the same scale the other walkable worlds use. */
export function athenaAdapter(getLayout) {
  return {
    id: 'campdefense',
    label: 'Camp Defence',
    icon: '🏰',
    describe: 'The survivor camp as a walkable world. One slot per building, '
            + 'placed from Forge.campLayout. Walls and gates decide where raiders enter. '
            + 'Set this live and the camp screen offers “🌍 Enter world”.',
    slots: [],
    build() {
      const map = buildBattleMap(typeof getLayout === 'function' ? getLayout() : null, null, { source: 'athena' });
      const cell = 2;
      const n = Math.max(16, Math.min(160, Math.max(map.w, map.h) * 2));

      // Camp tile → world metres, centred on the origin so the terrain grid and
      // the camp grid share a middle.
      const wx = (x) => (x - map.w / 2) * cell;
      const wz = (y) => (y - map.h / 2) * cell;

      const objects = map.structures.map(s => ({
        id: 'slot_' + s.id,
        t: 'slot',
        k: s.id,                                  // the game's id — see the header
        name: s.name,
        p: [wx(s.x + s.w / 2), 0, wz(s.y + s.h / 2)],
        r: [0, 0, 0],
        s: [Math.max(1, s.w) * cell, 3, Math.max(1, s.h) * cell],
        f: s.kind === 'wall' ? 'fold_walls' : 'fold_buildings',
      }));

      // Spawn markers, so whoever builds the world can see where the fight
      // actually starts and place scenery accordingly.
      map.spawns.attacker.forEach((p, i) => objects.push({
        id: 'spawn_atk_' + i, t: 'zone', k: 'attackerSpawn', name: 'Raider entry ' + (i + 1),
        p: [wx(p.x), 0, wz(p.y)], r: [0, 0, 0], s: [cell, 1, cell], f: 'fold_spawns',
      }));
      map.spawns.defender.forEach((p, i) => objects.push({
        id: 'spawn_def_' + i, t: 'zone', k: 'defenderSpawn', name: 'Defender post ' + (i + 1),
        p: [wx(p.x), 0, wz(p.y)], r: [0, 0, 0], s: [cell, 1, cell], f: 'fold_spawns',
      }));

      return {
        game: 'campdefense',
        name: 'Survivor Camp',
        terrain: { n, cell },
        folders: [
          { id: 'fold_buildings', name: 'Buildings' },
          { id: 'fold_walls', name: 'Walls & gates' },
          { id: 'fold_spawns', name: 'Spawns' },
        ],
        objects,
        // 🧍 The player walks this world as their own character. The cast is
        // filled by whoever builds the map in Athena; an empty one falls back
        // to the author's default character, which Athena already handles.
        player: { view: 'tps' },
        scene: { ground: true, water: false, sky: true },
        _derived: { w: map.w, h: map.h, fortifyScore: map.fortifyScore },
      };
    },
  };
}
