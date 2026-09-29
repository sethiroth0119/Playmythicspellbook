/* 💧 "REJECTED AT THE PLANT" NOW FOLLOWS PURITY.
   Run: node _waterreject_smoke.mjs
   Tracker bug-mu5agw8r: "the XXX m3/minute rejected at the plant figure is
   working in reverse … the purer I got my water supply, the higher this figure
   got". It was never reversed: it is an ABSOLUTE rate, so it grows with how
   much the plants draw and with the yield of the ground under them, and it sits
   under the PURITY meter where a player reads it as a purity consequence.
   hydro.js now also returns rejectedShare — the part of what those plants could
   have drawn from clean ground that contamination costs — and the panel leads
   with it. This suite runs the REAL solver (public/src/water/hydro.js).
   §2 is the reported case, reproduced; §4 is the negative control. */
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const H = await import(pathToFileURL(resolve('./public/src/water/hydro.js')).href);
const PANEL = readFileSync('./public/src/water/panel.js', 'utf8').replace(/\r\n/g, '\n');

const CITY = { cityId: 'probe', grid: 24, dtMin: 0, users: [], net: null };
const everyTile = [];
for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) everyTile.push({ k: x + ',' + z, x, z, want: 100 });
H.reset();
const scan = H.solve({ ...CITY, wells: everyTile });
const aquifers = (scan.wells || []).filter(w => w.src === 'aquifer');
const run = (wells, taint) => {
  H.reset();
  H.solve({ ...CITY, wells });
  const S = H.state();
  for (let i = 0; i < S.taint.length; i++) S.taint[i] = taint;
  return H.solve({ ...CITY, wells });
};
const plant = (w) => ({ k: w.k, x: w.x, z: w.z, want: 100 });

console.log('\n=== 1. one plant: dirtier ground rejects a bigger SHARE ===');
{
  ok(aquifers.length > 5, 'the probe city has aquifer tiles to stand plants on', String(aquifers.length));
  const one = [plant(aquifers[0])];
  const sweep = [0, 0.2, 0.4, 0.6, 0.8].map(t => run(one, t));
  const purity = sweep.map(r => r.meanPurity), share = sweep.map(r => r.rejectedShare);
  ok(purity.every((p, i) => i === 0 || p < purity[i - 1]), 'the sweep really does dirty the water', purity.map(p => p.toFixed(2)).join(' → '));
  ok(share.every((s, i) => i === 0 || s > share[i - 1]), 'the share rises as purity falls', share.map(s => Math.round(s * 100) + '%').join(' → '));
  ok(share.every(s => s >= 0 && s <= 1), 'the share is a fraction of the draw, always between 0 and 1');
  const clean = run(one, 0);
  ok(clean.rejectedShare < 0.05 && clean.rejected < clean.capacity * 0.05, 'clean ground rejects almost nothing', Math.round(clean.rejectedShare * 100) + '%');
}

console.log('\n=== 2. THE REPORTED CASE: purity improves while the city grows ===');
{
  const plants = aquifers.slice(0, 6).map(plant);
  const steps = [[0.8, 1], [0.5, 3], [0.2, 5], [0, 6]].map(([t, n]) => run(plants.slice(0, n), t));
  const purity = steps.map(r => r.meanPurity), vol = steps.map(r => r.rejected), share = steps.map(r => r.rejectedShare);
  ok(purity[purity.length - 1] > purity[0], 'purity improves across the steps', purity.map(p => p.toFixed(2)).join(' → '));
  ok(vol[1] > vol[0] && vol[2] > vol[0], 'the VOLUME still rises — that is what the player saw, and it is not a bug in the arithmetic',
    vol.map(v => v.toFixed(1)).join(' → '));
  ok(share.every((s, i) => i === 0 || s <= share[i - 1]), 'the SHARE falls the whole way, which is what the purity meter promises',
    share.map(s => Math.round(s * 100) + '%').join(' → '));
}

console.log('\n=== 3. the panel leads with the share, and keeps the volume ===');
{
  // The PURITY section's line, not the causal list's row of the same name.
  const at = PANEL.indexOf("s.rejected > 0.0005", PANEL.indexOf("meter(s.meanPurity"));
  const line = PANEL.slice(at, at + 400);
  ok(/pct\(s\.rejectedShare \|\| 0\)[^\n]*of the draw rejected at the plant/.test(line), 'the share is printed first, as a percentage');
  ok(/fmtQ\(s\.rejected\)/.test(line), 'the volume is still shown beside it');
  ok(/'nothing rejected'/.test(line), 'and "nothing rejected" is unchanged');
  ok(/rejectedShare: rejectedIdeal > 0 \? Math\.max\(0, Math\.min\(1, rejected \/ rejectedIdeal\)\) : 0,/.test(readFileSync('./public/src/water/hydro.js', 'utf8').replace(/\r\n/g, '\n')),
    'the share is derived from the same arithmetic the tick charged');
}

console.log('\n=== 4. NEGATIVE CONTROL — reading the volume alone ===');
{
  const plants = aquifers.slice(0, 6).map(plant);
  const a = run(plants.slice(0, 1), 0.8), b = run(plants.slice(0, 5), 0.2);
  ok(b.meanPurity > a.meanPurity && b.rejected > a.rejected,
    'volume-only: purer city, BIGGER number — the reported reading, reproduced',
    a.rejected.toFixed(1) + ' → ' + b.rejected.toFixed(1));
  ok(b.rejectedShare < a.rejectedShare, 'share: the same two cities read the right way round',
    Math.round(a.rejectedShare * 100) + '% → ' + Math.round(b.rejectedShare * 100) + '%');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ the purity panel reads the way purity moves\n');
process.exit(fails ? 1 : 0);
