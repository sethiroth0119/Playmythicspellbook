/* ════════════════════════════════════════════════════════════════════════════
   🏰 _campdefense_smoke.mjs — proves the camp layout ACTUALLY changes the map.
   ----------------------------------------------------------------------------
   The claim this feature makes is "where you put your buildings decides how the
   raid goes". That claim is only true if two different layouts produce two
   different battle maps, so that is what this asserts — not just that the
   function returns an object.

       node _campdefense_smoke.mjs
   ════════════════════════════════════════════════════════════════════════════ */
import { buildBattleMap, entryPoints, TILE } from './public/src/campdefense/campdefense.map.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
};
const countTiles = (m, t) => { let n = 0; for (const v of m.tiles) if (v === t) n++; return n; };

console.log('\n🏰 CAMP → BATTLE MAP\n');

/* ── an empty yard ─────────────────────────────────────────────────────── */
{
  const m = buildBattleMap(null, null);
  ok('empty layout still produces a playable map', m.w >= 8 && m.h >= 6 && m.tiles.length === m.w * m.h);
  ok('no structures', m.structures.length === 0);
  ok('defenders fall back to the centre', m.spawns.defender.length > 0);
  ok('attackers can still get in', m.spawns.attacker.length > 0);
  ok('an open yard scores low', m.fortifyScore < 40, 'score ' + m.fortifyScore);
}

/* ── one building makes cover and a spawn ─────────────────────────────── */
{
  const m = buildBattleMap({
    mapW: 20, mapH: 15,
    buildings: [{ id: 'bunker', name: 'Bunker', x: 8, y: 6, w: 3, h: 2, door: { x: 9, y: 8 } }],
  });
  ok('footprint is impassable', countTiles(m, TILE.BLOCKED) === 6, 'blocked=' + countTiles(m, TILE.BLOCKED));
  ok('a ring of cover appeared', m.cover.length > 0, 'cover=' + m.cover.length);
  ok('the door is a defender spawn',
     m.spawns.defender.some(s => s.x === 9 && s.y === 8));
  ok('structure carries HP scaled to its size', m.structures[0].hp >= 20);
}

/* ── THE CLAIM: clustering vs scattering give different maps ──────────── */
{
  const four = (coords) => ({
    mapW: 20, mapH: 15,
    buildings: coords.map((c, i) => ({ id: 'b' + i, x: c[0], y: c[1], w: 2, h: 2, door: { x: c[0], y: c[1] + 2 } })),
  });
  // Clustered: four buildings in a tight block — their cover rings overlap and
  // the gaps between them are protected corridors.
  const clustered = buildBattleMap(four([[8, 6], [11, 6], [8, 9], [11, 9]]));
  // Scattered: the same four buildings pushed to the corners.
  const scattered = buildBattleMap(four([[1, 1], [16, 1], [1, 11], [16, 11]]));

  /* ⚠ NOT the raw cover count — scattering wins that, because four separate
     rings overlap less than four adjacent ones. What matters is CONNECTED
     cover: ground you can fight and retreat through without stepping into the
     open. This assertion is the one that encodes the design intent, and the
     raw-count version of it is the mistake it exists to prevent. */
  ok('scattering yields more RAW cover tiles (the misleading number)',
     scattered.cover.length > clustered.cover.length,
     `clustered=${clustered.cover.length} scattered=${scattered.cover.length}`);
  ok('…but clustering yields a bigger CONNECTED cover region',
     clustered.largestCover > scattered.largestCover,
     `clustered=${clustered.largestCover} scattered=${scattered.largestCover}`);
  ok('…and therefore scores higher',
     clustered.fortifyScore > scattered.fortifyScore,
     `clustered=${clustered.fortifyScore} scattered=${scattered.fortifyScore}`);
  ok('the two layouts are genuinely different maps',
     clustered.tiles.join('') !== scattered.tiles.join(''));
  ok('both keep the same building count', clustered.structures.length === 4 && scattered.structures.length === 4);
}

/* ── walls close the perimeter; a gap is found ────────────────────────── */
{
  const walls = [];
  const W = 12, H = 10;
  for (let x = 0; x < W; x++) { walls.push({ id: 'w', kind: 'wall', x, y: 0, w: 1, h: 1 }); walls.push({ id: 'w', kind: 'wall', x, y: H - 1, w: 1, h: 1 }); }
  for (let y = 1; y < H - 1; y++) { walls.push({ id: 'w', kind: 'wall', x: 0, y, w: 1, h: 1 }); walls.push({ id: 'w', kind: 'wall', x: W - 1, y, w: 1, h: 1 }); }

  const sealed = buildBattleMap({ mapW: W, mapH: H, buildings: walls });
  ok('a fully walled camp has no breaches', sealed.breaches.length === 0,
     'breaches=' + sealed.breaches.length);
  ok('…and scores high', sealed.fortifyScore > 45, 'score ' + sealed.fortifyScore);

  // Knock one wall out of the north side.
  const holed = walls.filter(w => !(w.y === 0 && w.x === 5));
  const breached = buildBattleMap({ mapW: W, mapH: H, buildings: holed });
  ok('a hole becomes exactly one breach', breached.breaches.length === 1,
     'breaches=' + breached.breaches.length);
  ok('…on the side the hole is on', breached.breaches[0].side === 'north',
     'side=' + breached.breaches[0].side);
  ok('…and attackers spawn there', breached.spawns.attacker[0].x === 5 && breached.spawns.attacker[0].y === 0);
  ok('a breached camp scores lower than a sealed one',
     breached.fortifyScore < sealed.fortifyScore,
     `breached=${breached.fortifyScore} sealed=${sealed.fortifyScore}`);
}

/* ── a WIDE hole is one entry, not many ───────────────────────────────── */
{
  const W = 14, H = 10;
  const walls = [];
  for (let x = 0; x < W; x++) {
    if (x < 4 || x > 8) walls.push({ id: 'w', kind: 'wall', x, y: 0, w: 1, h: 1 });   // 5-wide gap
    walls.push({ id: 'w', kind: 'wall', x, y: H - 1, w: 1, h: 1 });
  }
  for (let y = 1; y < H - 1; y++) { walls.push({ id: 'w', kind: 'wall', x: 0, y, w: 1, h: 1 }); walls.push({ id: 'w', kind: 'wall', x: W - 1, y, w: 1, h: 1 }); }
  const m = buildBattleMap({ mapW: W, mapH: H, buildings: walls });
  ok('a 5-tile hole collapses to ONE breach', m.breaches.length === 1, 'breaches=' + m.breaches.length);
  ok('…that knows how wide it is', m.breaches[0].width >= 4, 'width=' + m.breaches[0].width);
}

/* ── entryPoints is IDEMPOTENT over its own markings ──────────────────
   buildBattleMap stamps breach tiles and then re-derives the score from them.
   If entryPoints stopped recognising a tile it had already marked, a breached
   camp would score as sealed — which is exactly what happened once. */
{
  const W = 12, H = 10;
  const walls = [];
  for (let x = 0; x < W; x++) { if (x !== 5) walls.push({ id: 'w', kind: 'wall', x, y: 0, w: 1, h: 1 }); walls.push({ id: 'w', kind: 'wall', x, y: H - 1, w: 1, h: 1 }); }
  for (let y = 1; y < H - 1; y++) { walls.push({ id: 'w', kind: 'wall', x: 0, y, w: 1, h: 1 }); walls.push({ id: 'w', kind: 'wall', x: W - 1, y, w: 1, h: 1 }); }
  const m = buildBattleMap({ mapW: W, mapH: H, buildings: walls });
  const again = entryPoints(m.tiles, m.w, m.h);
  ok('re-running entryPoints on marked tiles finds the SAME breaches',
     again.length === m.breaches.length && again.length === 1,
     `first=${m.breaches.length} second=${again.length}`);
}

/* ── the derivation never mutates its input ──────────────────────────── */
{
  const layout = { mapW: 20, mapH: 15, buildings: [{ id: 'a', x: 3, y: 3, w: 2, h: 2, door: { x: 3, y: 5 } }] };
  const before = JSON.stringify(layout);
  buildBattleMap(layout);
  ok('the camp layout is untouched (a defence is a READ)', JSON.stringify(layout) === before);
}

/* ── out-of-bounds buildings do not crash or corrupt ─────────────────── */
{
  const m = buildBattleMap({
    mapW: 10, mapH: 8,
    buildings: [{ id: 'oob', x: 8, y: 6, w: 6, h: 6 }, { id: 'neg', x: -3, y: -2, w: 2, h: 2 }],
  });
  ok('an out-of-bounds building is clipped, not crashed', m.tiles.length === 80);
  ok('…and nothing wrote outside the grid', m.tiles.every(v => v >= 0 && v <= 5));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
