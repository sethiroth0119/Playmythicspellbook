/* 🔎 WATER SOURCES ON THE MAP (bug-mu2r4z2p).

   Reported: the Water Supply panel lists its sources (basins, the coast, the
   river) and nothing on the map says where they are. Clicking a SOURCES row now
   outlines that source's tiles on the water overlay, using the same per-tile
   tests the layers already paint with.

   Drives overlay.js for real against a stub THREE / canvas (the per-tile paint
   is what is being checked, not the GPU), and checks the panel/index wiring by
   source. Run: node _watersrc_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

/* ── stub canvas that records every outlined tile and its colour ─────────── */
const strokes = [];
const ctx2d = {
  fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
  clearRect() { strokes.length = 0; }, fillRect() {}, strokeRect(x, y) { strokes.push({ x, y, col: this.strokeStyle }); },
  save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {},
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
class Obj { constructor() { this.rotation = {}; this.position = { set() {} }; } dispose() {} }
const THREE = { CanvasTexture: Obj, PlaneGeometry: Obj, MeshBasicMaterial: Obj, LinearFilter: 1,
  Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; this.visible = false; } } };
const scene = { add() {}, remove() {} };

const OV = await import('./public/src/water/overlay.js');
const { WATER } = await import('./public/src/water/tuning.js');
const PX = WATER.overlay.px;
ok(OV.mount({ THREE, scene, grid: 8 }), 'overlay mounts on the stub');

/* a city of 8×8: basin 0 in the west half, basin 1 in the east half's top,
   a river down column 5 from row 4, and a sea in column 7 */
const H = {
  cityId: 'T',
  basinAt: (x, z) => (x < 4 ? { basin: { i: 0 } } : (z < 3 ? { basin: { i: 1 } } : null)),
  surfaceAt: (x, z) => ((x === 5 && z >= 4) || x === 7 ? 0.9 : 0),
  seaAt: (x) => (x === 7 ? 1 : 0),
  groundAt: () => 0,
};
const tiles = () => strokes.filter((s) => s.col === '#ff5cf0').map((s) => Math.round((s.x - PX * 0.18) / PX) + ',' + Math.round((s.y - PX * 0.18) / PX)).sort();
const expect = (pred) => { const o = []; for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) if (pred(x, z)) o.push(x + ',' + z); return o.sort(); };
const layersOff = { aquifer: false, surface: false, stress: false, draw: false, wells: false };

OV.repaintNext(); OV.sync(null, layersOff, { H, grid: 8, focus: '' });
ok(tiles().length === 0, 'no focus, no layers → nothing outlined');

OV.repaintNext(); OV.sync(null, layersOff, { H, grid: 8, focus: 'b1' });
ok(JSON.stringify(tiles()) === JSON.stringify(expect((x, z) => x >= 4 && z < 3)), 'basin 1 → exactly its tiles, with every layer off', tiles().join(' '));

OV.repaintNext(); OV.sync(null, layersOff, { H, grid: 8, focus: 'b0' });
ok(tiles().length === 32, 'basin 0 → its 32 tiles', tiles().length);

OV.repaintNext(); OV.sync(null, layersOff, { H, grid: 8, focus: 'surface' });
ok(JSON.stringify(tiles()) === JSON.stringify(expect((x, z) => x === 5 && z >= 4)), 'river/lake → the river, not the sea', tiles().join(' '));

OV.repaintNext(); OV.sync(null, layersOff, { H, grid: 8, focus: 'sea' });
ok(JSON.stringify(tiles()) === JSON.stringify(expect((x) => x === 7)), 'sea → the coastal column', tiles().join(' '));

OV.sync(null, layersOff, { H, grid: 8, focus: 'b1' });
ok(tiles().length === 12, 'changing the focus repaints (it is in the signature)', tiles().length);

/* ── the panel and the index hand it over ───────────────────────────────── */
const PAN = readFileSync('./public/src/water/panel.js', 'utf8');
const IDX = readFileSync('./public/src/water/index.js', 'utf8');
ok((PAN.match(/'<div class="wtsrow"' \+ srcAttr\(/g) || []).length === 3, 'basin, sea and river rows carry data-wtfocus');
ok(/const row = ev\.target\.closest\('\[data-wtfocus\]'\);/.test(PAN) && /focus = focus === row\.dataset\.wtfocus \? '' : row\.dataset\.wtfocus; api\.onLayers\(\);/.test(PAN), 'a click toggles the focus and repaints');
ok(/open = false; focus = '';/.test(PAN), 'closing the panel clears it');
ok(/Overlay\.sync\(state, Panel\.layers, \{ H: H\(\), grid, focus: Panel\.focusOf\(\) \}\);/.test(IDX), 'index.js passes the focus to the overlay');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
