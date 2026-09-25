/* ══════════════════════════════════════════════════════════════════════════
   ⚡ DRIVE-POWER-GRID — the four things asked for, against the real modules.

   THE REPORT, in the player's words: "make it where any power building has to
   hook up to the highway interchange and have the lines connect even on the
   roads and buildings just like the pipes do, and when they are connected the
   right way have a yellow surge just like the pipes surge blue. Just like with
   the water, any building, road etc that needs power the lines go through gets
   power. Now make it where sometimes players need more power source or more
   powerful power source."

   Four claims, each with a CONTROL, because a rule that fires in every state is
   not a rule:

   1. A CABLE MAY CROSS A ROAD OR A BUILDING. It could not. quote() pushed every
      occupied cell into `blocked` and the preview painted it red, so a line
      could not leave the block it started in — and a city is made of roads.
      /src/water lays pipe over any tile and never asks; this now matches.
      CONTROL: a cell OFF the plate is still refused.

   2. WHAT THE LINE RUNS THROUGH GETS POWER. A load used to attach only to an
      orthogonal neighbour — the only rule possible while its own tile could
      never hold cable. CONTROL: a load with no cable on or beside it is still
      unserved.

   3. A PLANT MUST REACH THE GRID CONNECTOR. The Highway Connection modal has
      always told the player to run lines to the pole; nothing enforced it.
      CONTROL 1: the same plant, wired to the connector, counts in full.
      CONTROL 2: with `enforce` off (an old save's latch) it counts anyway —
      the grandfather rule the save-compatibility argument turns on.

   4. DEMAND PEAKS IN THE EVENING, so a grid sized to the average browns out and
      the player needs more, or bigger, plants. CONTROL: the working day is
      unchanged at 1.0, and a host with no clock gets no peak at all.

   Node-only: grid.js and lines.js are pure ES modules over plain objects.

   Run:  node .gauntlet/drive-power-grid.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import * as Grid from '../public/src/power/grid.js';
import { POWER } from '../public/src/power/tuning.js';

const bad = [];
const ok = (name, cond, detail) => { if (!cond) bad.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); };
const K = (x, z) => x + ',' + z;

/* A 6x6 city: a road down column 2, a house at (4,4) away from it, one plant.
   `lines.seeds` is the Grid Connector on the verge at (0,-1) — off the plate,
   exactly where lines.js puts it. */
function city(opts) {
  const o = opts || {};
  const tiles = [];
  for (let z = 0; z < 6; z++) tiles.push({ k: K(2, z), x: 2, z, road: true });
  const loads = [{ k: K(4, 4), x: 4, z: 4, draw: 2, cls: 'households' }];
  const plants = [{ k: K(0, 0), x: 0, z: 0, type: 'powerstation', name: 'Plant', ico: '⚡', out: 10 }];
  return {
    grid: 6, tiles, loads, plants,
    pop: 100, hasGrid: true, perPop: 0.02, floor: 0.25, dtMin: 1,
    enforce: o.enforce !== false,
    hour: o.hour,
    lines: { cells: new Set(o.cells || []), seeds: o.noConn ? [] : [{ k: K(0, -1), x: 0, z: -1, kind: 'connector' }], sig: String(o.sig || Math.random()) },
  };
}
const solve = (o) => Grid.solve(city(o), 0);

/* ── 1 · a cable may cross a road or a building ──────────────────────────── */
// lines.js owns placement; it needs a host ctx to answer `occupied`, so the
// rule is read where it is enforced — quote()'s own blocked list — through a
// tiny stand-in host. (mount() takes the ctx object node-city hands over.)
const Lines = await import('../public/src/power/lines.js');
const occupiedCells = new Set([K(2, 2), K(3, 3)]);   // a road tile and a building tile
Lines.mount({
  GRID: 6,
  tileAt: (x, z) => (occupiedCells.has(K(x, z)) ? { type: 'road' } : null),
});
const run = [{ k: K(2, 2), x: 2, z: 2 }, { k: K(3, 3), x: 3, z: 3 }, { k: K(1, 1), x: 1, z: 1 }];
const q = Lines.quote(run, false);
ok('a cable may cross an occupied tile', q.blocked.length === 0, { blocked: q.blocked.length, add: q.add.length });
ok('…and all three cells are chargeable', q.add.length === 3, q.add.length);
// CONTROL: off the plate and past the apron is still refused.
const qOff = Lines.quote([{ k: K(0, -9), x: 0, z: -9 }], false);
ok('CONTROL: off-domain is still refused', qOff.add.length === 0 && qOff.out.length === 1);

/* ── 2 · what the line runs through gets power ───────────────────────────── */
// A line from the plant to the house, ending ON the house's own tile.
const through = [K(0, 0), K(1, 0), K(2, 0), K(3, 0), K(4, 0), K(4, 1), K(4, 2), K(4, 3), K(4, 4)];
const sThrough = solve({ cells: through, hour: 8 });
ok('the solve ran', sThrough && sThrough.ok === true, sThrough && sThrough.why);
ok('a load under the cable is served', sThrough.topo.unserved.length === 0, sThrough.topo.unserved.length);
// CONTROL: the same city with the line stopping two tiles short.
const sShort = solve({ cells: through.slice(0, 6), hour: 8 });
ok('CONTROL: a load off the line is unserved', sShort.topo.unserved.length === 1, sShort.topo.unserved.length);

/* ── 3 · a plant must reach the connector ────────────────────────────────── */
// The line above never touches the connector cell (0,-1), so the plant is
// islanded from the outside grid.
ok('an unlinked plant contributes nothing', sThrough.capacity === 0, sThrough.capacity);
ok('…and says why', /Highway/i.test((sThrough.byPlant[0] || {}).why || ''), (sThrough.byPlant[0] || {}).why);
// CONTROL 1: add the two cells that reach the connector.
const sLinked = solve({ cells: through.concat([K(0, -1)]), hour: 8 });
ok('CONTROL: a linked plant counts in full', sLinked.capacity === 10, sLinked.capacity);
// CONTROL 2: an old save (latch off) is untouched by the whole rule.
const sOld = solve({ cells: through, hour: 8, enforce: false });
ok('CONTROL: an unlatched (old) city is unaffected', sOld.capacity === 10, sOld.capacity);
// CONTROL 3: a host with no connector at all must not lose its power.
const sNoConn = solve({ cells: through, hour: 8, noConn: true });
ok('CONTROL: no connector in the host → no gate', sNoConn.capacity === 10, sNoConn.capacity);

/* ── 3b · THE HIGHWAY INTERCHANGE IS A CONNECTION POINT ──────────────────
   The report: 'make it where any power building has to hook up to the highway
   interchange' … then 'the lines are not working correctly'. Both were the same
   fact — the only connection point was the Grid Connector pole at (-1,-1), the
   extreme north-west CORNER, so a line counted only if the player landed a cell
   on the apron beside it. Their interchange is at 11,0 and their line reached
   THAT, which is what the tooltip tells them to do. It now seeds the grid. */
{
  /* ⚠ THE PLANT HAS TO BE ON THE ROAD FOR THIS TO MEAN ANYTHING. The default
     board puts it at (0,0) with the road down column 2 — not adjacent to any
     conductor, so it is unlinked for a reason that has nothing to do with the
     interchange. The first cut of this case asserted against that board and
     went red; the board was wrong, not the rule. */
  const withIx = (o) => {
    const h = city(o);
    h.plants = [{ k: K(1, 0), x: 1, z: 0, type: 'powerstation', name: 'Plant', ico: '⚡', out: 10 }];
    // the interchange stands on the north end of the road column, as it does
    // in a real city (theirs is at 11,0 on the north edge)
    h.tiles.push({ k: K(2, 0) + ':ix', x: 2, z: 0, conn: 1, type: 'interchange' });
    return h;
  };
  // NO line cells at all, and no connector reach — the plant links through the
  // interchange over the ROAD, which is the case that was blacked out.
  const sIx = Grid.solve(withIx({ cells: [], hour: 8 }), 0);
  ok('a plant on the road links through the interchange', sIx.capacity === 10, sIx.capacity);
  // CONTROL: the same city with the interchange demolished is still refused.
  const noIx = city({ cells: [], hour: 8 });
  noIx.plants = [{ k: K(1, 0), x: 1, z: 0, type: 'powerstation', name: 'Plant', ico: '⚡', out: 10 }];
  const sNoIx = Grid.solve(noIx, 0);
  ok('CONTROL: no interchange, no link, no capacity', sNoIx.capacity === 0, sNoIx.capacity);
}

/* ── 4 · the evening peak ────────────────────────────────────────────────── */
const loadAt = (h) => solve({ cells: through.concat([K(0, -1)]), hour: h }).load;
const day = loadAt(10), evening = loadAt(19), night = loadAt(3), none = solve({ cells: through.concat([K(0, -1)]) }).load;
ok('the evening draws more than the working day', evening > day, { day, evening });
ok('the small hours draw less', night < day, { night, day });
/* The peak is a multiplier on the HOUSEHOLD term only, so the rise from the
   working day to the evening must be exactly perPop × pop × (1.40 − 1.00) and
   nothing else — if it were scaling building draws too, this would be bigger.
   (The first draft of this line asserted `Math.abs(x) >= 0`, which is true of
   every number there is. A vacuous assertion in a green suite is worse than no
   assertion, because it is counted.) */
const _expected = 0.02 * 100 * (POWER.demand.peak.byHour[19] - POWER.demand.peak.byHour[10]);
ok('the evening rise is exactly the household term × the peak',
   Math.abs((evening - day) - _expected) < 1e-9, { rise: +(evening - day).toFixed(4), expected: _expected });
ok('CONTROL: the working day is unchanged (x1.0)', POWER.demand.peak.byHour[10] === 1.00);
ok('CONTROL: no clock → no peak', Math.abs(none - day) < 1e-9, { none, day });

console.log(JSON.stringify({
  laid: { blocked: q.blocked.length, add: q.add.length },
  served: { through: sThrough.topo.unserved.length, short: sShort.topo.unserved.length },
  capacity: { unlinked: sThrough.capacity, linked: sLinked.capacity, oldSave: sOld.capacity, noConnector: sNoConn.capacity },
  demand: { night: +night.toFixed(3), day: +day.toFixed(3), evening: +evening.toFixed(3), noClock: +none.toFixed(3) },
}, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — cable crosses the city, what it runs through is powered, a plant must reach the connector, and the evening bites.');
process.exit(bad.length ? 1 : 0);
