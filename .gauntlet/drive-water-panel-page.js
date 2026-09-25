/* 🚰 DRIVE THE WATER PANEL IN THE REAL PAGE — what the panel SAYS.
   Run:  node .gauntlet/win-drive.mjs --rich --wait 45000 \
           --eval-file .gauntlet/drive-water-panel-page.js

   drive-water-mains.mjs proves the arithmetic in node. drive-water-mains-page.js
   proves the wiring. THIS proves the sentences, because the defect this round
   fixed was visible in the panel before it was visible anywhere else: the mains
   header read "100% of demand · every building reached" three lines above a
   warning that a waterworks was at 65% and that "a run of pipe is the whole
   fix" — two lines of one panel disagreeing, and the advice could not work
   because the ratio's denominator was the whole city.

   So the assertion here is not a number, it is a CONTRADICTION CHECK: the
   coverage figure and the per-waterworks warning must never both be shown as
   good/bad at once, and each branch must render without throwing on the new
   per-component fields (`wells[].onMain`, `wells[].missed`, `sewage.byComp`).

   MEASURED, city `mock-supply`, Station over the Kessel/Lake tile at 8,14 with a
   house at 8,6 that the first 3-tile run does not reach:
     A  "MAINS 0% of demand · 3 tiles of main · 1 network · 1 building unreached"
        + "the worst is at 8,14, at 30% … its own main reaches 0.0 m³/min and
           there is 1.8 m³/min nearer to it that no main reaches"
        charged 0.4042 = ground 1.3474 × mains 0.300 × sewer 1
     B  after a 10-tile run out to the house:
        "MAINS 100% of demand · every building reached", no below-capacity line,
        and the SEWER half takes over: "100% … has nowhere to go … the
        waterworks on it is at 50%"
        charged 0.6737 = ground 1.3474 × mains 1.000 × sewer 0.500
   i.e. the two halves hand off to each other and neither sentence contradicts
   the meter above it.

   ⚠ KEEP THIS SHORT — see drive-water-mains-page.js's note on the renderer
     dying after about a minute of page time under SwiftShader.
   ⚠ --rich seeds the mock ledger; a Water Station is 3,400🔥. */
const nc = window.__nc, W = window.MythicWater; const out = {};
if (!nc || !W) return { fail: 'no __nc / no MythicWater' };
const E = W.endowment();

/* A free tile over the aquifer for the Station, and a free tile FAR from it for
   a house — far, so the house is demand no main reaches and the mains factor
   has something to be short of. */
let wet = null;
for (let z = 4; z < 20 && !wet; z++) for (let x = 4; x < 16; x++)
  if (!nc.game.tiles[x + ',' + z] && E.groundAt(x, z) >= 0.25) { wet = [x, z]; break; }
if (!wet) return { fail: 'no free aquifer tile in this scene' };
// Eight tiles away down the same column, or as far as the grid allows — far
// enough that the short run beside the Station cannot reach it.
let far = null;
for (let d = 8; d >= 5 && !far; d--) {
  const z = wet[1] + d <= 21 ? wet[1] + d : wet[1] - d;
  for (let x = wet[0]; x < wet[0] + 4 && !far; x++)
    if (z > 1 && z < 23 && !nc.game.tiles[x + ',' + z]) far = [x, z];
}
if (!far) return Object.assign(out, { fail: 'no free far tile', wet });
out.wet = wet; out.far = far;

try { await nc.place('waterstation', wet[0], wet[1]); } catch (e) { out.errStation = e.message; }
try { await nc.place('housing', far[0], far[1]); } catch (e) { out.errHome = e.message; }
try { nc.build.finishAll('panel driver'); } catch (e) {}
const SK = wet[0] + ',' + wet[1];
out.placed = { station: !!nc.game.tiles[SK], home: !!nc.game.tiles[far[0] + ',' + far[1]] };

// A short run of main beside the Station, going nowhere near the house.
out.laid = nc.waterPipe(wet[0], wet[1] + 1, wet[0], wet[1] + 3);
await nc.step(0.2, 1);

const text = () => {
  W.openPanel();
  const r = document.getElementById('ncwtr');
  return r ? (r.innerText || '').replace(/\s+/g, ' ') : null;
};
const grab = (t) => {
  if (!t) return null;
  const i = t.indexOf('MAINS');
  return i < 0 ? t.slice(0, 400) : t.slice(i, i + 900);
};

const m1 = W.mains(), t1 = text();
out.unreached = { mains: m1, well: (nc.water().wells || []).find(w => w.k === SK), panel: grab(t1) };

/* Now connect the house to the same main and re-read. The coverage figure, the
   per-waterworks warning and the sewer note must all move together. */
out.laid2 = nc.waterPipe(wet[0], wet[1] + 3, far[0], far[1] - 1);
await nc.step(0.2, 1);
const m2 = W.mains(), t2 = text();
out.reached = { mains: m2, well: (nc.water().wells || []).find(w => w.k === SK), panel: grab(t2) };
W.closePanel();

const saysAllReached = (t) => !!t && t.indexOf('every building reached') >= 0;
const saysBelow = (t) => !!t && t.indexOf('delivering below capacity') >= 0;
out.verdict = {
  panelRendered: !!t1 && !!t2,
  // 🔴 THE CONTRADICTION CHECK, both ways round.
  noContradictionBefore: !(saysAllReached(t1) && saysBelow(t1)),
  noContradictionAfter: !(saysAllReached(t2) && saysBelow(t2)),
  // …and the fix the panel advertises actually moves the number it complains about.
  dragRaisedReach: m2.reach > m1.reach - 1e-9 && m2.unservedTiles <= m1.unservedTiles,
  sewerSectionRendered: !!t1 && t1.indexOf('SEWER') >= 0,
};
return out;
