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

   Usage:
     node .gauntlet/tabletop/shot.mjs <out.png> [--scene mixed|basics|cliff]
                                                [--wait ms] [--w px] [--h px]
   Prints the boardshot JSON through, so a caller can still tell "rendered a
   board" from "rendered a blank page" by its diag.
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
const PRE = argOf('--pre', '');
const evalJs  = PRE + `;window.postMessage({type:'board:map',map:${payload}},location.origin)`;

const boardshot = fileURLToPath(new URL('../boardshot.mjs', import.meta.url));
const r = spawnSync(process.execPath, [
  boardshot, out,
  '--wait', argOf('--wait', '7000'),
  '--w',    argOf('--w', '1600'),
  '--h',    argOf('--h', '900'),
  '--eval', evalJs,
  ...(argOf('--report','') ? ['--report', argOf('--report','')] : []),
  /* --page passthrough: lets one run point at a THROWAWAY COPY of the board
     page, so a before/after ablation pair can be captured without reverting
     the live file other sessions are reading. */
  ...(argOf('--page','') ? ['--page', argOf('--page','')] : []),
], { encoding: 'utf8', maxBuffer: 1 << 26 });

process.stderr.write(r.stderr || '');
console.log(JSON.stringify({ scene, out, mix, boardshot: safeParse(r.stdout) }, null, 1));
process.exit(r.status || 0);

function safeParse(s){ try { return JSON.parse(s); } catch { return { raw: String(s || '').slice(-2000) }; } }
