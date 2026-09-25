/* ══════════════════════════════════════════════════════════════════════════
   TABLETOP GAUNTLET — the one fixture every round is rendered against.

   WHY THIS EXISTS
   `.gauntlet/boardshot.mjs` boots the board with no host map, so every tile
   comes out `dirt`. A critic A/B-ing two all-dirt boards is judging nothing.
   And a critic who invents their OWN map each round is comparing two different
   boards, which is worse — it lets a regression hide behind a friendlier seed.

   So the fixture is FROZEN here. Same tiles, same elevation, same camera,
   every round, for every builder and every critic. If the fixture changes, the
   whole A/B history is invalidated — treat it the way `_SURF_ORDER` is treated
   (see .gauntlet/TABLETOP-BAR.md §8.1). Add a NEW named scene instead.

   🔴 REBUILT 2026-09-15 AFTER THE TREE MOVED FROM D: TO E:.
   This file and the whole of `.gauntlet/tabletop/` were UNTRACKED, so they did
   not survive the move; the product code did, because it was tracked. The
   rebuild is faithful to the version that was lost — same three seeds, same
   scene shapes, same ladder — but note honestly what that means:
     • every PNG from rounds 0-3 is GONE. There is no image history to A/B
       against any more. The first render after this rebuild is a new baseline,
       and it is a baseline of a board that already carries ~8 landed pieces,
       not of the original board.
     • so a blind A/B can only compare rounds from here forward. Earlier
       verdicts stand on their written evidence, not on re-openable pictures.
   Do not paper over that by calling a fresh capture "before".

   🔴 THE ELEVATION LADDER WAS WRONG ONCE, AND IT LOOKED FINE — see ELEV below.

   ⚠ WHAT THIS FIXTURE IS NOT
   It is the TARGET-STATE payload, not the as-shipped one. The game's real
   sender only recently began populating `tile.elev`; the board defers to host
   heights only when some tile carries a numeric `elev > 0`. `_harness.html`'s
   header makes the same warning about its map payload. So a board that looks
   right HERE has not yet been proven to look right IN GAME; that is a separate
   check, and the gauntlet must not let a pretty fixture stand in for it.

   🔴 EVERY SCENE ABOVE POSTS A MAP AND NOTHING ELSE — there is not one body
   on any of them. TABLETOP-BAR §12's defect ("when units bunch together they
   cannot see where they can move or what is around them") CANNOT OCCUR on an
   empty board, so this rig was blind to it until `crowd` was added below. A
   crowding fix scored on `mixed` is scored on a board the defect cannot
   appear on — §11's "a check one degree off the question", for the tenth
   time. 👉 JUDGE CROWDING ON `crowd`. §12.7.

   Usage:
     node .gauntlet/tabletop/shot.mjs <out.png> [--scene mixed|basics|cliff|crowd]
                                                [--wait ms] [--w px] [--h px]
                                                [--check]
   Prints the boardshot JSON through, so a caller can still tell "rendered a
   board" from "rendered a blank page" by its diag. For `crowd` it also prints
   a `crowd` block: roster size, move-set size, the bodies sitting INSIDE the
   move region and the front-to-back stacks — the facts that make the capture
   CAPABLE of showing §12's defect, so "the scene still contains a crowd" is
   something a reader checks rather than assumes. `--check` prints exactly
   that block and exits without rendering, which is how those asserts are
   negative-controlled.
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const COLS = 14, ROWS = 12;

/* A tiny deterministic PRNG. Math.random() is forbidden in this repo's harness
   scripts for the same reason it is forbidden in a workflow script: a fixture
   that moves between rounds cannot be A/B'd. */
function rng(seed){
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/* 🪜 THE LADDER, AND WHY THIS IS AN ARRAY AND NOT A MULTIPLY.
   This was once `const RUNG = 0.18` with a multiply at the emit, sourced from
   the renderer's comment at board index.html:95. That comment is a MAP-FORMAT
   DOC ("tile.elev : world units of raise (0, .18, .36 …)") — an illustrative
   example of the field's shape, NOT the shipped ladder. The shipped ladder is
   `_BB_ELEV` in public/index.html, and it is [0,.34,.68,1.02,1.36] — evenly
   spaced, and the spacing is a PICKING constraint derived at that anchor, not
   a taste call. (A later round re-measured it and deliberately LEFT it at .34
   for exactly that reason: the cap is the pick ray, not aesthetics.)

   So the fixture spent its first rounds posting 0/.18/.36/.54 — a little over
   half the real step — and every §5.1 judgement made through it ("can you see
   a rung?", "are the side walls lit?") was scored against a ladder the renderer
   has never shipped and has never had to shade.

   Kept as an ARRAY indexed by rung, not a step multiplied by a rung, because
   the ladder is not required to stay evenly spaced: it has already been
   [0,.13,.26,.34] and [0,.30,.62,.95,1.35] in its history, and a multiply
   silently invents the intermediate values whenever it is not.

   ⚠ The number lives in FOUR places: public/index.html (the generator, the
   source), public/battle-board/_harness.html (a byte-for-byte copy of the
   header), public/src/battle/ley.js (re-hardcoded as ELEV_STEP — the copy the
   RULES read), and here. This one is deliberately a copy, because the fixture
   must be able to post a ladder before the page has loaded one.
   tileElevRungs() derives the renderer's ladder from whatever elevations
   actually arrive, so a mismatch here does NOT throw — it just quietly shades
   a ladder nobody ships, which is exactly how this file spent round 0. */
const ELEV = [0, 0.34, 0.68, 1.02, 1.36];

/* ── the scenes ──────────────────────────────────────────────────────────
   `mixed` is the scene the bar is scored against: it is built to HIT the
   §4 mix table, so a board that still reads as sand or as one painted
   landscape is failing on the RENDERER, not on a stacked deck.
     basics  ≥ 60 %   (grass, asphalt, dirt)
     filler  ≤ 15 %   (rubble, water, mud, sand)
     element 15–25 %  (clustered in pockets, ≤ 6 distinct per board)          */
const SCENES = {
  mixed: { seed: 0x5EED, elements: ['lava', 'ice', 'nature', 'void', 'storm', 'crystal'], relief: 'ridge' },
  /* the control: no elemental tiles at all. If the board does not read well
     here, the problem is the basics and the framing, not the realm art. */
  basics: { seed: 0xBA51C, elements: [], relief: 'ridge' },
  /* a deliberate elevation torture test — one long cliff and a plateau, so a
     critic can score §5.1 (lit side walls, contact shadows, legible rungs)
     without hunting for a height difference to look at. */
  cliff: { seed: 0xC11FF, elements: ['nature', 'water'], relief: 'cliff' },
};
/* 👥 crowd = THE mixed BOARD, PLUS BODIES. Derived, never re-typed: copied
   seed/elements/relief would drift, and the moment they drift `mixed` stops
   being crowd's empty-board control and "the bodies did this" stops being
   provable from the two PNGs. `crowd:true` is the only difference, read once,
   at the eval. */
SCENES.crowd = Object.assign({}, SCENES.mixed, { crowd: true });

/* ══════════════════════════════════════════════════════════════════════
   👥 THE CROWD SCENE — TABLETOP-BAR §12
   ══════════════════════════════════════════════════════════════════════
   §12's defect is ONLY visible with bodies on the board: "every cue that
   answers 'can I go here' is painted on the ground, and a body standing on
   that ground covers it". The three scenes above post `board:map` alone, so
   none of them can show it — and none of them can show a fix FAILING either,
   which is the half that matters.

   🧊 FROZEN, exactly like the terrain seeds above. The roster, the tiles they
   stand on, which unit is selected and the speed the region is derived from
   are all literals here. If any of them changes the A/B history is
   invalidated — add a NEW named scene instead (BAR §8.1).

   ⚠ WHAT THIS SCENE IS HONEST ABOUT
   • TERRAIN IS NOT RE-TYPED. `SCENES.crowd` is Object.assign'd FROM
     `SCENES.mixed` below, so the ground under the crowd is byte-identical to
     the `mixed` board, and `mixed` is therefore crowd's empty-board CONTROL:
     the only difference between the two captures is the bodies. It also means
     a change to mixed's terrain moves crowd's with it. That is intended; the
     pair must never be allowed to drift apart, because the moment they do,
     "the bodies did this" stops being provable from the two files.
   • NO `board:defs` IS POSTED, so every unit falls to the board's own
     procedural silhouette (PROC_DEFS, battle-board/index.html:408).
     Deliberate: procedural bodies need no network, cannot lose a decode race,
     and are the same shape on every machine. They are also a FLOOR, not a
     ceiling — real match art is at least as tall and at least as wide, so it
     occludes MORE. A cue that survives occlusion here is NOT yet proven in
     game; a cue that fails here fails in game too. That is the direction a
     fixture is allowed to be wrong in, and the direction this one is wrong in.
   • THE FRAME IS NOT FROZEN, ONLY THE SCENE. spawnUnit seeds each unit's idle
     bob with Math.random() (battle-board/index.html:3136) and the telegraph
     wash pulses on wall-clock time, so two captures differ by a few pixels of
     bob and glow. Structure — tiles, bodies, the move set — is identical every
     run. Do not read a sub-pixel diff here as a regression. (And do NOT try to
     fix it by shimming Math.random: the board also seeds rain and vegetation
     from it at LOAD, before any --eval can run, so a shim buys a false
     assurance rather than a frozen frame.)

   📐 WHICH WAY IS "IN FRONT". gw() puts a tile at world
   z = (gz-(rows-1)/2)*hexV() and camAt() parks the eye at +z looking back at
   the origin (battle-board/index.html:1812 and :2566). So HIGHER gz IS NEARER
   THE CAMERA, and (7,8) stands in FRONT of (7,6). Those two share a row
   PARITY, so they share rowShift() and land on exactly the same screen x — a
   true front-to-back stack, not a near miss. (7,7)/(7,5) are the second pair.

   🧬 PAYLOAD SHAPE, READ OFF THE SENDER — NOT INVENTED. A `board:units` entry
   is id / key / x / z / side / name / hp / hpMax / hero: bridgeUnitList() at
   public/battle-board/_harness.html:473, which mirrors the game's own
   _bbStageUnitList, and applyPlate() at battle-board/index.html:14857 for what
   the board does with the last four. `board:paint` is {move, attack, place,
   swap, sel} — four arrays of "x,z" strings and one {x,z} — bridgePaint() at
   _harness.html:511 and the handler at battle-board/index.html:15075.
   The contour §12.1 says already traces holes is traced from PAINT.move by
   teleContour(), so posting `move` is all it takes to put the telegraph on
   screen; that is why no `board:tele` rides along. `attack` is left empty for
   the same reason: a red target paint in this frame would let a critic read
   the wrong overlay and call the move cue legible. */
const CROWD_UNITS = [
  /* ── THE SCRUM. Six bodies, one connected blob under hex adjacency. ──────
     Both sides are present because §12.3 R4 makes ownership part of the bar:
     the blue/red directional foot rings exist BECAUSE overlapping sprites made
     ownership ambiguous, and a cue that buries them has failed even if it
     reads. 4 mine / 2 foe, deliberately interleaved rather than two clean
     blocks — a scrum where ownership is decidable from POSITION alone would
     not test the rings at all.
     u-b is the tallest silhouette on the board (wyrm, h 1.30) and stands on
     the tile nearest the camera in the stack, so it is the primary occluder.
     u-sel is the selected unit: the one whose region is painted, and also the
     most buried thing in the frame — four of its six neighbours are occupied.
     That is not a stacked deck, it is the player's complaint. */
  { id:'u-sel', key:'knight',  x:7,  z:6, side:'mine', name:'Vail',  hp:18, hpMax:22, hero:true  },
  { id:'u-a',   key:'mage',    x:7,  z:7, side:'mine', name:'Ember', hp:9,  hpMax:14, hero:false },
  { id:'u-b',   key:'wyrm',    x:7,  z:8, side:'mine', name:'Skarn', hp:24, hpMax:30, hero:false },
  { id:'u-c',   key:'imp',     x:7,  z:5, side:'foe',  name:'Grint', hp:7,  hpMax:10, hero:false },
  { id:'u-d',   key:'crystal', x:8,  z:6, side:'foe',  name:'Shard', hp:12, hpMax:16, hero:false },
  { id:'u-e',   key:'bunny',   x:6,  z:6, side:'mine', name:'Pip',   hp:6,  hpMax:8,  hero:false },
  /* ── TWO ISOLATED CONTROLS, IN THE SAME FRAME. ──────────────────────────
     One per side, far from the scrum and from each other, on open ground.
     They are not decoration: they are the in-picture control for §12.7. A cue
     that reads on these two and vanishes in the scrum has failed the only case
     it was built for — and with both in ONE capture that verdict needs no
     second file and no memory of a previous round. u-lone stands OUTSIDE the
     move region on purpose, so the frame also shows what an unhighlighted unit
     looks like beside highlighted ground. */
  { id:'u-lone',key:'jelly',   x:11, z:4, side:'foe',  name:'Ooze',  hp:11, hpMax:12, hero:false },
  { id:'u-far', key:'imp',     x:2,  z:9, side:'mine', name:'Tass',  hp:5,  hpMax:9,  hero:false }
];
/* The selected unit's tile, and the speed the region is derived from. `sel`
   rides the paint payload as {x,z} and the board draws a RUNE on it
   (battle-board/index.html:7595) — a ground mark, on a tile a body is standing
   on, i.e. §12.2 in one line. Speed 4 because the region still has to wrap the
   cluster after the bodies block the route; at 3 it never gets round. */
const CROWD_SEL   = { x:7, z:6 };
const CROWD_SPEED = 4;

/* The six neighbours, BY ROW PARITY. A DELIBERATE COPY of the game's
   HEX_DIRS_EVEN / HEX_DIRS_ODD (public/index.html:85599), for the same reason
   ELEV above is a copy: the fixture must be able to state a payload before any
   page has loaded one. SIX, NEVER EIGHT — a 3×3 square admits two offsets that
   are hex distance 2 (HEXSPEC §5), and a fixture built on those would paint a
   region the rules can never emit and then invite a fix to match it.
   ⚠ If the game's table ever changes, this copy goes WRONG AND SILENT: the set
   still renders, it is simply no longer a set the rules could have produced. */
const HEX_DIRS_EVEN = [[+1,0],[-1,0],[0,-1],[-1,-1],[0,+1],[-1,+1]];
const HEX_DIRS_ODD  = [[+1,0],[-1,0],[+1,-1],[0,-1],[+1,+1],[0,+1]];
const hexDirs = z => (z & 1) ? HEX_DIRS_ODD : HEX_DIRS_EVEN;

/* THE MOVE REGION IS DERIVED, NEVER HAND-LISTED. A hand-listed region is a
   picture of what someone HOPED the rules said, and §12.1's whole point is
   that the set is already RIGHT — so a fixture stating a wrong one would send
   the next round chasing a bug that does not exist.

   This mirrors getValidMoves (public/index.html:103309) in the one respect
   §12 turns on: the occupancy test sits BEFORE visited.set and before the
   push, so an occupied tile is neither a destination NOR a step. Bodies block
   the ROUTE as well as the landing. That is what punches the holes in the
   region, and it is why the region here leans WEST — four of u-sel's six
   neighbours are occupied and only (6,5) and (6,7) are open. The lopsided
   shape is not a mistake in the fixture; it is the defect, drawn.

   What this does NOT mirror: speed from getMoveRange, walls, the Sea,
   tombstones, zone of control, Follow My Lead, stationary units. The fixture
   STATES a plausible set; only the game can prove the set. Exactly the limit
   bridgeTele() writes down in _harness.html. */
function crowdMoveSet(units, sel, speed){
  const occ  = new Set(units.map(u => u.x + ',' + u.z));
  const seen = new Map([[sel.x + ',' + sel.z, 0]]);
  const q    = [[sel.x, sel.z, 0]];
  const out  = [];
  while (q.length){
    const [x, z, d] = q.shift();
    if (d >= speed) continue;
    for (const [dx, dz] of hexDirs(z)){
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= COLS || nz >= ROWS) continue;   // inBounds()
      const k = nx + ',' + nz;
      if (seen.has(k)) continue;
      if (occ.has(k)) continue;              /* ← the one line §12.1 is about */
      seen.set(k, d + 1); out.push(k); q.push([nx, nz, d + 1]);
    }
  }
  return out;
}

/* 🔴 THE FACTS THE SCENE HAS TO CARRY, MEASURED — not asserted in a comment.
   A fixture that quietly stops containing a crowd is worse than no fixture: it
   renders, it exits 0, and it answers a question one degree away from §12's.
   So the four properties the brief names are COUNTED here, checked by
   assertCrowd() below, and shipped in the diag, so a reader never has to take
   this file's word for it.

   • enclosedHoles — occupied tiles every one of whose in-bounds neighbours is
     itself either in the region or occupied, with at least one neighbour IN
     the region. That is "a body sitting on a hole INSIDE the region", which is
     strictly stronger than "a body on a tile absent from the region" — every
     body is that, including the two isolated controls, so the loose test would
     pass on a scene with no crowd in it at all and prove nothing.
   • alignedStacks — pairs on the same column, same row PARITY, |dz| == 2:
     identical screen x, one directly behind the other. The |dz| == 1 pairs are
     reported separately as halfOffsetPairs because rowShift() puts those half
     a column apart — real occlusion, but partial, so they must never be
     allowed to stand in for a true stack.
   • biggestBlob — the largest set of units connected through hex edges.
   • sides — both must be present, or ownership is not under test. */
function crowdFacts(units, sel, speed){
  const move = crowdMoveSet(units, sel, speed);
  const mv   = new Set(move);
  const occ  = new Set(units.map(u => u.x + ',' + u.z));

  const enclosedHoles = [];
  for (const u of units){
    const nb = hexDirs(u.z).map(d => [u.x + d[0], u.z + d[1]])
                           .filter(p => p[0] >= 0 && p[1] >= 0 && p[0] < COLS && p[1] < ROWS)
                           .map(p => p[0] + ',' + p[1]);
    if (nb.some(k => mv.has(k)) && nb.every(k => mv.has(k) || occ.has(k)))
      enclosedHoles.push(u.x + ',' + u.z);
  }

  const alignedStacks = [], halfOffsetPairs = [];
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++){
    const a = units[i], b = units[j];
    if (a.x !== b.x) continue;
    const dz = Math.abs(a.z - b.z);
    /* name the NEARER one second: it is the occluder, and a reader of the diag
       should be able to tell which body is hiding which without a diagram */
    const back = (a.z < b.z) ? a : b, front = (a.z < b.z) ? b : a;
    if (dz === 2 && ((a.z & 1) === (b.z & 1))) alignedStacks.push(back.id + ' hidden by ' + front.id);
    else if (dz === 1) halfOffsetPairs.push(back.id + ' half-hidden by ' + front.id);
  }

  /* largest hex-connected group of units — flood fill over the roster */
  const byKey = new Map(units.map(u => [u.x + ',' + u.z, u]));
  const done = new Set(); let biggestBlob = 0;
  for (const u of units){
    const k0 = u.x + ',' + u.z;
    if (done.has(k0)) continue;
    let n = 0; const st = [k0]; done.add(k0);
    while (st.length){
      const k = st.pop(); n++;
      const parts = k.split(','), x = +parts[0], z = +parts[1];
      for (const d of hexDirs(z)){
        const nk = (x + d[0]) + ',' + (z + d[1]);
        if (byKey.has(nk) && !done.has(nk)){ done.add(nk); st.push(nk); }
      }
    }
    if (n > biggestBlob) biggestBlob = n;
  }

  return { units: units.length, sel: sel, speed: speed,
           sides: [...new Set(units.map(u => u.side))].sort(),
           moveTiles: move.length, enclosedHoles: enclosedHoles,
           alignedStacks: alignedStacks, halfOffsetPairs: halfOffsetPairs,
           biggestBlob: biggestBlob, move: move };
}

/* THE GATE. Thresholds are the BRIEF's own words, not taste: "a tight cluster
   of 4-6 units on ADJACENT tiles", "at least one pair stacked FRONT-TO-BACK",
   "both sides present", "at least one unit standing on a tile INSIDE another
   unit's move region". One clause each.
   🔴 NEGATIVE-CONTROLLED BEFORE IT WAS TRUSTED, clause by clause, by mutating
   CROWD_UNITS in a throwaway copy of this file and running --check: pulling
   the scrum apart reds biggestBlob AND enclosedHoles, moving u-b off column 7
   reds alignedStacks, flipping every side to 'mine' reds sides, and dropping
   speed to 0 reds moveTiles. A gate nobody has seen fail is not evidence
   (BAR §11), and five of the nine bugs it counts were exactly this shape. */
function assertCrowd(f){
  const bad = [];
  if (f.biggestBlob < 4)       bad.push('biggestBlob=' + f.biggestBlob + ' (<4): no tight cluster, §12 cannot occur');
  if (!f.alignedStacks.length) bad.push('no same-column same-parity pair: nothing is stacked front-to-back');
  if (f.sides.length < 2)      bad.push('sides=' + f.sides.join('/') + ': one side only, ownership is not under test');
  if (!f.enclosedHoles.length) bad.push('no body sits on a hole INSIDE the region: the scene cannot show §12.2');
  if (f.moveTiles < 10)        bad.push('moveTiles=' + f.moveTiles + ' (<10): region too small to read');
  if (bad.length) throw new Error('crowd scene no longer exercises TABLETOP-BAR §12:\n  - ' + bad.join('\n  - '));
  return f;
}

function buildTiles(scene){
  const S = SCENES[scene];
  if (!S) throw new Error(`unknown scene "${scene}" — have: ${Object.keys(SCENES).join(', ')}`);
  const rand = rng(S.seed);
  const tiles = [];

  /* 1. Ground everything in basics first. Two road runs and grass elsewhere,
        with dirt as the shoulder — §4 says basics are the MAJORITY and the
        connective tissue, so they are laid down before anything loud. */
  const roadRows = new Set([3, 8]);
  const roadCols = new Set([6]);
  const surf = [];
  for (let z = 0; z < ROWS; z++){
    surf[z] = [];
    for (let x = 0; x < COLS; x++){
      let s = 'grass';
      if (roadRows.has(z) || roadCols.has(x)) s = 'asphalt';
      else if (roadRows.has(z - 1) || roadRows.has(z + 1) || roadCols.has(x - 1) || roadCols.has(x + 1)) s = rand() < .45 ? 'dirt' : 'grass';
      surf[z][x] = s;
    }
  }

  /* 2. Filler, sparse. Mud sits beside the road where it would actually be
        churned up — it is a hazard basic (§5.4), not decoration, and a player
        needs to meet it often enough to learn the −1 speed. */
  const filler = [
    { s: 'water',  at: [[11, 1], [12, 1], [11, 2]] },
    { s: 'mud',    at: [[5, 4], [5, 5], [7, 9]] },
    { s: 'rubble', at: [[2, 10], [3, 10]] },
    { s: 'sand',   at: [[13, 6], [13, 7]] },
  ];
  for (const f of filler) for (const [x, z] of f.at) if (surf[z] && surf[z][x]) surf[z][x] = f.s;

  /* 3. Elemental POCKETS. §4: a pocket reads as a place, a speckle reads as
        noise. 4–6 tiles each: smaller pockets left the board at 11 % elemental,
        under the §4 band of 15–25 %, and a fixture that misses the target mix
        lets the renderer off the hook for the very thing being judged. */
  const anchors = [[1, 1], [9, 2], [2, 6], [11, 9], [7, 6], [4, 8]];
  S.elements.forEach((el, i) => {
    const a = anchors[i];
    if (!a) return;
    const [ax, az] = a;
    const size = 4 + Math.floor(rand() * 3);
    const cells = [[ax, az], [ax + 1, az], [ax, az + 1], [ax + 1, az + 1],
                   [ax + 2, az], [ax + 1, az + 2]].slice(0, size);
    for (const [x, z] of cells) if (surf[z] && surf[z][x]) surf[z][x] = el;
  });

  /* 4. Relief, as RUNG INDICES into the real ladder. Never a multiply — see
        the ELEV block above for the round-0 story. */
  const rungOf = (x, z) => {
    if (S.relief === 'cliff'){
      if (z <= 3) return 3;                              // plateau
      if (z === 4) return 2;                             // the step down
      if (x >= 10 && z >= 7) return 2;                   // a second shelf
      return 0;
    }
    // 'ridge': a spine across the middle, so most tiles have a neighbour at a
    // different rung and §5.1's side walls are actually exercised.
    const d = Math.abs(z - 5.5) + Math.abs(x - 7) * .35;
    if (d < 1.4) return 3;
    if (d < 2.6) return 2;
    if (d < 4.0) return 1;
    return 0;
  };

  for (let z = 0; z < ROWS; z++)
    for (let x = 0; x < COLS; x++)
      tiles.push({ x, z, surf: surf[z][x], elev: ELEV[rungOf(x, z)] });

  return tiles;
}

const args  = process.argv.slice(2);
const out   = args[0] || 'tabletop.png';
const argOf = (k, d) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : d; };
const scene = argOf('--scene', 'mixed');

const tiles = buildTiles(scene);

/* Report the mix, so a caller does not have to trust the comments above. */
const count = {};
for (const t of tiles) count[t.surf] = (count[t.surf] || 0) + 1;
const BASIC  = ['grass', 'asphalt', 'dirt'];
const FILLER = ['rubble', 'water', 'mud', 'sand'];
const pct = keys => Math.round(keys.reduce((n, k) => n + (count[k] || 0), 0) / tiles.length * 100);
const mix = {
  basics: pct(BASIC),
  filler: pct(FILLER),
  elemental: 100 - pct(BASIC) - pct(FILLER),
  distinctElements: Object.keys(count).filter(k => !BASIC.includes(k) && !FILLER.includes(k)).length,
  rungs: [...new Set(tiles.map(t => t.elev))].sort((a, b) => a - b),
};

const payload = JSON.stringify({ cols: COLS, rows: ROWS, tiles });
let   evalJs  = `window.postMessage({type:'board:map',map:${payload}},location.origin)`;

/* 👥 THE CROWD PUSH. Three messages in the host's own order — map, then the
   roster, then the paint — because that is the order the game sends them
   (_harness.html mounts the stage, pushes units "a beat later", and paints
   after that) and because applyUnits() has to land on a stage that already has
   the right dimensions.

   ⏱ THE SLEEPS ARE LOAD-BEARING, TWICE OVER.
   1. The standalone board is NOT embedded here — boardshot loads it as the TOP
      document, so EMBEDDED is false and its boot spawns FIVE DEMO UNITS
      (imp/knight/wyrm/mage/crystal, battle-board/index.html:15191).
      applyUnits() kills everything absent from the snapshot, and killUnit()
      fires a 34-particle burst and leaves a corpse that squashes out over
      0.8 s (:11065). Posting the paint immediately would photograph five death
      bursts sitting on the board. 700 ms is ~2× the corpse lifetime.
   2. A map push re-bakes the terrain across several tasks — boardshot's own
      note at its --eval. The roster waits for that too.

   ⏱ AND THE TOTAL IS BUDGETED TO SURVIVE EITHER HARNESS BEHAVIOUR. boardshot
   waits a fixed 2500 ms after --eval. Playwright awaits an expression string
   that evaluates to a promise, so normally the capture sits ~4.2 s after the
   paint — but if that await were ever dropped, the last message still goes out
   at +1400 ms and a screenshot at +2500 ms catches units 1.8 s old and paint
   1.1 s old. Neither path can photograph a half-pushed board. That is the
   point: the failure is made IMPOSSIBLE rather than unlikely, because a
   fixture that intermittently renders a board with no telegraph on it is worth
   less than no fixture — it would be read as "the cue is invisible". */
let crowd = null;
if (SCENES[scene].crowd){
  crowd = assertCrowd(crowdFacts(CROWD_UNITS, CROWD_SEL, CROWD_SPEED));
  const uJson = JSON.stringify(CROWD_UNITS);
  const pJson = JSON.stringify({ move: crowd.move, attack: [], place: [], swap: [], sel: CROWD_SEL });
  evalJs = `(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  window.postMessage({type:'board:map',map:${payload}},location.origin);
  await w(700);
  window.postMessage({type:'board:units',units:${uJson}},location.origin);
  await w(700);
  window.postMessage(Object.assign({type:'board:paint'},${pJson}),location.origin);
  await w(300);
  ${argOf('--tail','')}
  await w(400);
  return 'crowd pushed';
})()`;
  /* `move` rode the facts object only so the payload could be built from the
     same array the asserts measured — never a second, hand-kept copy. It is 36
     strings of noise in a diag a human reads, so it stops here. The COUNTS and
     the hole list stay. */
  delete crowd.move;
}

/* --check: print the facts and stop, without booting Chromium. This is what
   makes assertCrowd() testable in under a second — mutate CROWD_UNITS in a
   throwaway copy of this file, run --check, watch the gate go red. */
if (args.includes('--check')){
  console.log(JSON.stringify({ scene, mix, crowd }, null, 1));
  process.exit(0);
}

const boardshot = fileURLToPath(new URL('../boardshot.mjs', import.meta.url));
const r = spawnSync(process.execPath, [
  boardshot, out,
  '--wait', argOf('--wait', '7000'),
  '--w',    argOf('--w', '1600'),
  '--h',    argOf('--h', '900'),
  '--eval', evalJs,
  ...(argOf('--report','') ? ['--report', argOf('--report','')] : []),
], { encoding: 'utf8', maxBuffer: 1 << 26 });

process.stderr.write(r.stderr || '');
console.log(JSON.stringify({ scene, out, mix, crowd, boardshot: safeParse(r.stdout) }, null, 1));
process.exit(r.status || 0);

function safeParse(s){ try { return JSON.parse(s); } catch { return { raw: String(s || '').slice(-2000) }; } }
