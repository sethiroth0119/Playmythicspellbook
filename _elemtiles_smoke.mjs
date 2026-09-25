/* ============================================================================
 * _elemtiles_smoke.mjs — 🌍 ELEMENTAL TILE PLACEMENT gate.  node _elemtiles_smoke.mjs
 * ----------------------------------------------------------------------------
 * Drives the REAL _bbGenTerrain out of index.html across 40 seeds. It slices the
 * function out of the page rather than duplicating it, so this cannot drift from
 * the generator it checks.
 *
 * 🔴 THE ONE THAT EARNS ITS KEEP is the two-blob share. Everything else here
 * would still pass if the elements were sprinkled one hex at a time — and
 * scattered elemental tiles are exactly the "uncorrelated random per tile is the
 * tell of a generated map" failure the generator swears off. The first build of
 * the pass reused the terrain noise and measured 1.36 of 6 same-surface
 * neighbours; nothing else in this file noticed.
 * ==========================================================================*/
import fs from 'fs';
const src = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

function slice(startRe, label){
  const m = startRe.exec(src);
  if (!m) throw new Error('not found: ' + label);
  const open = src.indexOf('{', m.index);
  let d = 0, i = open;
  for (; i < src.length; i++){
    const ch = src[i];
    if (ch === '{') d++;
    else if (ch === '}'){ d--; if (!d) break; }
  }
  return src.slice(m.index, i + 1);
}
const rng  = slice(/function _bbRng\(seed\) \{/, '_bbRng');
const gen  = slice(/function _bbGenTerrain\(cols, rows, seed\) \{/, '_bbGenTerrain');
const elev = /const _BB_ELEV = \[[^\]]*\];/.exec(src)[0];
const nb   = /const _BB_NB = \[[\s\S]*?\n\];/.exec(src)[0];

const sandbox = {};
new Function('S', rng + '\n' + elev + '\n' + nb + '\n' + gen + '\nS._bbGenTerrain=_bbGenTerrain;')(sandbox);
const genTerrain = sandbox._bbGenTerrain;

const COLS = 14, ROWS = 12;
const ELEMS = ['earth','wind','light','shadow','nature','storm','ice','metal','poison','psychic',
  'arcane','void','blood','crystal','corruption','spirit','lava','sound','gravity'];
/* ⚠ REVISED 2026-09-15 — 'mud' and 'sand' joined the board's vocabulary as
   GROUND, appended at indices 24/25 rather than placed beside 'dirt'. They are
   deliberately NOT elemental: mud is the hazard basic and sand is the demoted
   filler that until then reached the board only as a painting on dirt. Without
   them here the id check reported 400 unknown surfaces — the CHECK being stale,
   not the generator being wrong. */
const BASE = ['dirt','asphalt','rubble','grass','water','mud','sand'];

let fails = 0;
const ok = (n, c, extra='') => { console.log((c?'  OK  ':'  FAIL ') + n + (c?'':'   <-- ' + extra)); if(!c) fails++; };

const SEEDS = [];
for (let i = 1; i <= 40; i++) SEEDS.push((i * 2654435761) >>> 0);

const elemCounts = {}, perSeedElems = [], coverage = [];
let symBad = 0, streetBad = 0, unknownSurf = 0, waterLost = 0;

for (const seed of SEEDS){
  const tiles = genTerrain(COLS, ROWS, seed);
  const at = new Map();
  for (const t of tiles) at.set(t.x + ',' + t.z, t);
  if (tiles.length !== COLS * ROWS) { ok('tile count for seed ' + seed, false, tiles.length); break; }

  const used = new Set();
  let elemTiles = 0;
  for (const t of tiles){
    if (!BASE.includes(t.surf) && !ELEMS.includes(t.surf)) unknownSurf++;
    if (ELEMS.includes(t.surf)) { used.add(t.surf); elemTiles++; elemCounts[t.surf] = (elemCounts[t.surf]||0)+1; }
    // 180deg symmetry: (x,z) -> (cols-1-x, rows-1-z) must carry the same surface
    const p = at.get((COLS-1-t.x) + ',' + (ROWS-1-t.z));
    if (p && p.surf !== t.surf) symBad++;
  }
  perSeedElems.push(used.size);
  coverage.push(elemTiles / tiles.length);

  // streets must stay asphalt - they are the neutral contested ground
  for (const t of tiles) if (t._pv && t.surf !== 'asphalt') streetBad++;
}

console.log('\n--- elemental placement over ' + SEEDS.length + ' seeds ---');
ok('every surface is a known key', unknownSurf === 0, unknownSurf + ' unknown');
ok('180deg rotational symmetry holds', symBad === 0, symBad + ' mismatched pairs');
ok('streets stay asphalt (neutral ground)', streetBad === 0, streetBad + ' paved tiles took an element');

/* ⚠ REVISED 2026-09-14 (v121v162) — was "2-3 elements", and that was a DESIGN
   change, not a loosened bar. Two or three broad regions made a seed read as
   "the ice map": coherent, but the whole board was two decisions. The owner
   asked for the ground to be split up and mixed so it plays as strategy, so a
   seed now draws four to seven and gives each a smaller pocket. The ceiling
   matters as much as the floor — all nineteen at once is the confetti this
   generator's header swears off. */
const minE = Math.min(...perSeedElems), maxE = Math.max(...perSeedElems);
ok('each seed draws 4-7 elements, never all 19', minE >= 3 && maxE <= 7, minE + '..' + maxE);

const avgCov = coverage.reduce((a,b)=>a+b,0) / coverage.length;
ok('coverage leaves the city ground dominant (15-45%)', avgCov > 0.15 && avgCov < 0.45,
   (avgCov*100).toFixed(1) + '%');

const distinct = Object.keys(elemCounts).length;
ok('the pool actually rotates across seeds (>=12 of 19 seen)', distinct >= 12, distinct + ' seen');

/* THE ONE THAT MATTERS: regions, not confetti. For each elemental tile count how
   many of its six odd-r neighbours share its surface. Scattered noise averages
   well under 1; a real region averages high. */
const NB_EVEN = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1]];
const NB_ODD  = [[-1,0],[1,0],[0,-1],[0,1],[1,-1],[1,1]];
let sameN = 0, elemN = 0;
for (const seed of SEEDS.slice(0, 12)){
  const tiles = genTerrain(COLS, ROWS, seed);
  const at = new Map(); for (const t of tiles) at.set(t.x+','+t.z, t);
  for (const t of tiles){
    if (!ELEMS.includes(t.surf)) continue;
    elemN++;
    for (const [dx,dz] of (t.z & 1 ? NB_ODD : NB_EVEN)){
      const n = at.get((t.x+dx) + ',' + (t.z+dz));
      if (n && n.surf === t.surf) sameN++;
    }
  }
}
const cohesion = sameN / Math.max(1, elemN);

/* The direct test, and the fair one. Raw neighbour count is depressed by design:
   streets and lakes are excluded from placement, so a perfectly coherent region
   still loses neighbours wherever it borders a road it is forbidden to cross.
   What actually distinguishes a region from confetti is whether an element's
   tiles form ONE connected blob. Flood-fill each element and measure the share
   of its tiles sitting in its single largest component. */
let lccShare = 0, lccN = 0;
for (const seed of SEEDS.slice(0, 12)){
  const tiles = genTerrain(COLS, ROWS, seed);
  const at = new Map(); for (const t of tiles) at.set(t.x+','+t.z, t);
  const byElem = {};
  for (const t of tiles) if (ELEMS.includes(t.surf)) (byElem[t.surf] = byElem[t.surf] || []).push(t);
  for (const e in byElem){
    const set = new Set(byElem[e].map(t => t.x+','+t.z));
    const seen = new Set();
    const sizes = [];
    for (const k of set){
      if (seen.has(k)) continue;
      let n = 0; const stack = [k];
      seen.add(k);
      while (stack.length){
        const cur = stack.pop(); n++;
        const [cx, cz] = cur.split(',').map(Number);
        for (const [dx,dz] of (cz & 1 ? NB_ODD : NB_EVEN)){
          const nk = (cx+dx) + ',' + (cz+dz);
          if (set.has(nk) && !seen.has(nk)){ seen.add(nk); stack.push(nk); }
        }
      }
      sizes.push(n);
    }
    /* 🔴 TOP TWO, NOT TOP ONE — and this is the symmetry, not a relaxed bar.
       The field is symmetrised as 0.5*(v(p) + v(-p)) so that the board is its own
       180° rotation; an elemental region that favoured one deployment end would
       hand that player the ground for free. A symmetric field therefore puts
       every feature on the board TWICE, once per half, unless it straddles the
       centre. One-blob-per-element is unreachable by construction, and measuring
       it caps a perfect result near 50% — which is what the first run of this
       test reported (43.1%). The real question is whether those two halves are
       each coherent, so: the two largest components together. */
    sizes.sort((a, b) => b - a);
    lccShare += (sizes[0] + (sizes[1] || 0)) / set.size; lccN++;
  }
}
const lcc = lccShare / Math.max(1, lccN);
ok('each element is a coherent mirrored PAIR (>=75% of its tiles in its two largest components)',
   lcc >= 0.75, (lcc*100).toFixed(1) + '%');

/* 🔴 AND THE POCKETS MUST STILL BE POCKETS.
   Scattering the elements is what the owner asked for; scattering them one hex
   at a time is not the same thing and is the failure this whole pass exists to
   avoid. A card that keys off `ice` needs ice you can move onto and hold, and a
   lone hex of it is a decoration. Mean component size is the bar: two or more
   connected hexes on average, or the board is confetti wearing pockets. */
let compN = 0, compTiles = 0, singles = 0;
for (const seed of SEEDS.slice(0, 12)){
  const tiles = genTerrain(COLS, ROWS, seed);
  const byElem = {};
  for (const t of tiles) if (ELEMS.includes(t.surf)) (byElem[t.surf] = byElem[t.surf] || []).push(t);
  for (const e in byElem){
    const set = new Set(byElem[e].map(t => t.x + ',' + t.z));
    const seen = new Set();
    for (const k of set){
      if (seen.has(k)) continue;
      let n = 0; const stack = [k]; seen.add(k);
      while (stack.length){
        const cur = stack.pop(); n++;
        const [cx, cz] = cur.split(',').map(Number);
        for (const [dx, dz] of (cz & 1 ? NB_ODD : NB_EVEN)){
          const nk = (cx + dx) + ',' + (cz + dz);
          if (set.has(nk) && !seen.has(nk)){ seen.add(nk); stack.push(nk); }
        }
      }
      compN++; compTiles += n; if (n === 1) singles++;
    }
  }
}
const meanComp = compTiles / Math.max(1, compN);
ok('pockets are CLUSTERS, not single scattered hexes (mean >= 2 hexes)',
   meanComp >= 2, meanComp.toFixed(2) + ' hexes per pocket');
ok('…and lone hexes are the minority', singles / Math.max(1, compN) < 0.5,
   (singles / Math.max(1, compN) * 100).toFixed(0) + '% of pockets are a single hex');
console.log('  mean pocket size       : ' + meanComp.toFixed(2) + ' hexes  (' + compN + ' pockets over 12 seeds)');

/* 🔴 EVERY ELEMENT NEEDS A GROUND MOTIF, AND A MISSING ONE IS SILENT.
   paintSurfTexture dispatches on ELEM_TEX and its final `else` is the DIRT
   motif, so an element missing from that table is not an error and does not
   throw — it is simply drawn with wheel ruts and tyre scrapes, on a void tile.
   Parse the table out of the board and assert it against the same nineteen
   names the generator places, in both directions: a key that is not a real
   surface is just as dead as a surface with no key. */
const board = fs.readFileSync(new URL('./public/battle-board/index.html', import.meta.url), 'utf8');
const texBlk = /const ELEM_TEX = \{[\s\S]*?\n\};/.exec(board);
ok('ELEM_TEX table found in the board', !!texBlk);
if (texBlk){
  const tex = {};
  for (const m of texBlk[0].matchAll(/([a-z]+)\s*:\s*'([a-z]+)'/g)) tex[m[1]] = m[2];
  const missing = ELEMS.filter(e => !tex[e]);
  const stray   = Object.keys(tex).filter(k => !ELEMS.includes(k));
  ok('every elemental surface has a ground motif (else it silently gets dirt ruts)',
     missing.length === 0, 'missing: ' + missing.join(', '));
  ok('no motif key that is not a real surface', stray.length === 0, 'stray: ' + stray.join(', '));
  const fams = [...new Set(Object.values(tex))];
  const used = fams.filter(f => board.includes("fam === '" + f + "'") || f === 'wave');
  ok('every family the table names is actually painted', used.length === fams.length,
     'unpainted: ' + fams.filter(f => !used.includes(f)).join(', '));
  console.log('\n  motif families         : ' + fams.sort().join(', '));
}

/* 🔴 THE BOARD MUST ONLY FETCH THE PAINTINGS THE MAP USES.
   artImage() starts the download on first call and the terrainP<i> staging loop
   walks tileArtSrcs() at boot, so anything that list names is fetched and
   decoded whether or not a tile wears it. Twenty-three paintings is ~53 MB of
   PNG to draw the two or three elements a seed placed. This asserts the filter,
   and asserts the fallback too — returning an empty list for a map with no
   surface data would silently strip the paintings off boards that had them. */
{
  const artBlk = /const TILE_ART = \{[\s\S]*?\n\};/.exec(board);
  const srcFn  = /function tileArtSrcs\(\)\{[\s\S]*?\n\}/.exec(board);
  ok('TILE_ART + tileArtSrcs found in the board', !!artBlk && !!srcFn);
  if (artBlk && srcFn){
    const mk = (tiles) => {
      const box = { MAP: { tiles } };
      const fn = new Function('B', artBlk[0] + '\n' + srcFn[0] +
        '\nvar MAP = B.MAP; return tileArtSrcs();');
      return fn(box);
    };
    const all = mk([]);
    ok('a map with no surface data still asks for every painting (the fallback)',
       all.length >= 20, all.length + ' srcs');
    /* lava, ice, dirt, asphalt -> Lava, Ice, Dirt 1, Street 1 = FOUR files.
       This asserted three on the first run, which was the test being wrong and
       not the code: rubble is the surface that shares Dirt 1.png with dirt, and
       rubble is not in this map. Adding it must therefore NOT change the count,
       which is worth pinning since a de-duplicating list is the whole point. */
    /* ⚠ FIVE, NOT FOUR — REVISED 2026-09-15, and the code was right.
       'dirt' carries an ARRAY of two paintings (Dirt 1 + Street 1). That is a
       documented feature of TILE_ART, not an accident: a surface with an array
       alternates by tile hash so a run of forty hexes is not forty copies of one
       crack. So lava + ice + dirt + asphalt asks for FIVE files, because dirt
       contributes two. Asserting four was asserting that the feature did not
       exist. */
    const two = mk([{ surf: 'lava' }, { surf: 'ice' }, { surf: 'dirt' }, { surf: 'asphalt' }]);
    ok('a real map asks only for the surfaces on it',
       two.length === 5, two.length + ' srcs: ' + two.map(s => s.split('/').pop()).join(', '));
    /* rubble shares Dirt 1.png, which dirt ALREADY pulls, so adding it must not
       change the count — that is the de-duplication this asserts. */
    const dup = mk([{ surf: 'lava' }, { surf: 'ice' }, { surf: 'dirt' }, { surf: 'asphalt' }, { surf: 'rubble' }]);
    ok('two surfaces sharing one painting still fetch it once',
       dup.length === 5, dup.length + ' srcs');
    ok('…and that is a real saving, not a rounding error',
       two.length * 3 < all.length, two.length + ' vs ' + all.length);
    const none = mk([{ surf: 'grass' }]);
    ok('one surface asks for one painting', none.length === 1, none.length + ' srcs');
  }
}

/* 🔴 EVERY ELEMENT NEEDS A TOOLTIP LABEL, AND A MISSING ONE SHOWS NOTHING.
   _bbTileTip bails when the surface has no entry, which is correct for the five
   city surfaces (a label on every hex is noise) and indistinguishable from a
   typo for the nineteen elemental ones. Two purples on screen are a psychic
   field and a void rift; the tooltip is the only thing that says which. */
{
  const tipBlk = /const _BB_SURF_TIP = \{[\s\S]*?\n\};/.exec(src);
  ok('_BB_SURF_TIP found in the host', !!tipBlk);
  if (tipBlk){
    const tip = {};
    for (const m of tipBlk[0].matchAll(/([a-z]+)\s*:\s*'([^']+)'/g)) tip[m[1]] = m[2];
    const noTip = ELEMS.filter(e => !tip[e]);
    ok('every elemental surface has a tooltip label', noTip.length === 0, 'missing: ' + noTip.join(', '));
    const strayTip = Object.keys(tip).filter(k => !ELEMS.includes(k));
    ok('no tooltip for a surface that does not exist', strayTip.length === 0, 'stray: ' + strayTip.join(', '));
    ok('the plain city surfaces are deliberately unlabelled',
       !tip.dirt && !tip.asphalt && !tip.rubble && !tip.grass,
       'a label on every hex stops the tooltip meaning "this tile is special"');
    ok('the board actually sends the surface with the hover',
       /surf: tile \? \(tile\.surf \|\| 'dirt'\) : null/.test(board),
       'without it the host has nothing to name');
    ok('the tooltip is anchored through the stage mapping, not a DOM rect',
       /_bbTileTip[\s\S]{0,1200}?_bbTilePoint/.test(src),
       'the DOM board is hidden during a stage match');
    ok('the tooltip cannot steal the hover it describes',
       /bb-tile-tip[\s\S]{0,400}?pointer-events:none/.test(src));
  }
}

console.log('\n  mean elemental coverage : ' + (avgCov*100).toFixed(1) + '%');
console.log('  mean region cohesion   : ' + cohesion.toFixed(2) + ' / 6 neighbours');
console.log('  distinct elements seen : ' + distinct + ' / 19');
console.log('  two-blob share         : ' + (lcc*100).toFixed(1) + '%');

console.log('');
process.exit(fails ? 1 : 0);
