/* 📍 bug-mu2r4z2p — "When viewing the Water Supply info panel (press G), it
   references multiple water sources. I can't locate where these sources are
   on the map (nothing brings any information up) — is there a way for these
   to be highlighted on the city map if you select them?"

   Every named source row in the 💧 panel (each basin, the river/lakes, the
   coast) is now a button: clicking it outlines that source on the water
   overlay and slides the camera to it; clicking it again clears it. This
   suite runs the REAL modules (public/src/water/*) in node on a DOM stub:

     1. the footprint of each basin is exactly that basin's painted tiles —
        the overlay's own cut (basinAt + minRead), disjoint between basins
     2. the coast footprint is where sourceAt would offer the sea
     3. focusSource() pans by TRANSLATION: target lands on the source, the
        camera keeps its offset (zoom and angle survive); again = clear
     4. the panel prints one clickable row per source, ids matching 1–2, and
        marks the selected one
     5. NEGATIVE CONTROL: a footprint that ignores WHICH basin (the plain
        aquifer paint) fails check 1's ownership test — so check 1 can fail.

   Run: node _waterfocus_smoke.mjs */
import { pathToFileURL } from 'url';
import { resolve } from 'path';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

/* The smallest DOM the panel and the pipe tool will mount on. */
const mk = () => ({ style: {}, children: [], dataset: {}, innerHTML: '', textContent: '', addEventListener() {}, removeEventListener() {},
  appendChild(c) { this.children.push(c); return c; }, setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  contains() { return false; }, remove() {} });
globalThis.document = { createElement: mk, head: mk(), body: mk(), documentElement: mk(), getElementById: () => null,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null };
globalThis.window = globalThis;
const _log = console.log; console.warn = () => {};
console.log = (...a) => { if (!/^\[water/.test(String(a[0]))) _log(...a); };

const url = (p) => pathToFileURL(resolve(p)).href;
const Endow = await import(url('./public/src/water/endowment.js'));
const { WATER } = await import(url('./public/src/water/tuning.js'));
// The SAME module instance index.js uses (it imports with ?v=wf1).
const Overlay = await import(url('./public/src/water/overlay.js') + '?v=wf1');
const W = (await import(url('./public/src/water/index.js'))).default;

const CITY = 'probe', G = 24;
const H = Endow.hydrologyFor(CITY, G);
const cut = WATER.aquifer.minRead;
const basins = (H.basins || []).map((b, i) => (b && b.i != null ? b.i : i));

console.log('\n=== 1. a basin footprint is that basin, and only it ===');
function ownershipOK(fp) {
  const seen = new Map(); let bad = 0;
  for (const i of basins) for (const [x, z] of fp(i)) {
    const at = H.basinAt(x, z);
    if (!at || at.basin.i !== i || H.groundAt(x, z) < cut) bad++;
    const k = x + ',' + z; if (seen.has(k) && seen.get(k) !== i) bad++; seen.set(k, i);
  }
  return bad;
}
{
  ok(basins.length >= 1, 'the probe city has ' + basins.length + ' basin(s)');
  const sizes = basins.map(i => Overlay.footprint(H, 'basin:' + i, G).length);
  ok(sizes.every(n => n > 0), 'every basin has tiles on the plate (' + sizes.join(', ') + ')');
  ok(ownershipOK(i => Overlay.footprint(H, 'basin:' + i, G)) === 0, 'every tile is in its own basin, above minRead, and no tile is claimed twice');
  // …and it is the whole painted body, not a sample of it
  let painted = 0;
  for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) { const at = H.basinAt(x, z); if (at && at.basin.i === basins[0] && H.groundAt(x, z) >= cut) painted++; }
  ok(painted === sizes[0], 'basin ' + basins[0] + ': the footprint is every tile the aquifer layer paints for it (' + painted + ')');
  const c = Overlay.centreOf(Overlay.footprint(H, 'basin:' + basins[0], G));
  ok(c && Overlay.footprint(H, 'basin:' + basins[0], G).some(t => t[0] === c.x && t[1] === c.z), 'the centre is a tile of the body itself');
  ok(Overlay.footprint(H, 'basin:999', G).length === 0 && Overlay.footprint(H, 'nonsense', G).length === 0, 'an unknown id is an empty footprint, not a throw');
}

console.log('\n=== 2. the coast is where the sea is offered ===');
{
  const sea = Overlay.footprint(H, 'sea', G);
  ok(sea.length > 0 && sea.every(([x, z]) => H.seaAt(x, z) > 0.02), 'the sea footprint: ' + sea.length + ' coastal tiles, all with seaAt > 0.02');
  ok(sea.every(([x]) => x >= G / 2), 'all on the east half (the coast is east)');
  const surf = Overlay.footprint(H, 'surface', G);
  ok(surf.every(([x, z]) => H.surfaceAt(x, z) > 0.12), 'the surface footprint uses the surface layer\'s own cut (' + surf.length + ' tiles)');
}

console.log('\n=== 3. focusSource pans by translation, and toggles ===');
{
  const target = { x: 0, z: 0 }, object = { position: { x: 3, y: 20, z: 17 } };
  let updates = 0;
  W.mount({ grid: G, cityId: CITY, controls: { target, object, update() { updates++; } }, toast() {} });
  W.openPanel();
  const id = 'basin:' + basins[0];
  const off0 = { x: object.position.x - target.x, z: object.position.z - target.z, y: object.position.y };
  const r = W.focusSource(id);
  ok(r && r.id === id && r.tiles.length > 0 && r.panned, 'selecting ' + id + ' focuses it and pans');
  ok(Math.abs(target.x - (r.centre.x - G / 2 + 0.5)) < 1e-9 && Math.abs(target.z - (r.centre.z - G / 2 + 0.5)) < 1e-9,
    'the orbit target sits on the source centre in world space (' + target.x + ', ' + target.z + ')');
  ok(Math.abs(object.position.x - target.x - off0.x) < 1e-9 && Math.abs(object.position.z - target.z - off0.z) < 1e-9 && object.position.y === off0.y,
    'the camera keeps its offset and height — zoom and angle survive');
  ok(updates === 1 && Overlay.focused() === id, 'controls.update() ran once and the overlay holds the focus');
  const again = W.focusSource(id);
  ok(again.id === null && Overlay.focused() === null, 'selecting it again clears the highlight');
  W.focusSource('sea');
  W.closePanel();
  ok(Overlay.focused() === null, 'closing the panel drops the focus (no paint without its key)');
}

console.log('\n=== 4. the panel rows are the buttons ===');
{
  // mount() ran above against the stub; a solve gives the panel sources to list.
  W.solve({ cityId: CITY, grid: G, dtMin: 0, wells: [], users: [] });
  W.openPanel();
  W.focusSource('basin:' + basins[0]);
  // The panel's root is the element it appended to <body> with id ncwtr.
  const root = document.body.children.find(e => e.id === 'ncwtr');
  const html = root ? root.innerHTML : '';
  const ids = [...html.matchAll(/data-wtsrc="([^"]+)"/g)].map(m => m[1]);
  ok(basins.every(i => ids.includes('basin:' + i)), 'one clickable row per basin (' + ids.join(', ') + ')');
  ok(ids.includes('sea'), 'and one for the coast');
  ok(/class="wtsrcitem on"[^>]*data-wtsrc="basin:/.test(html) && /aria-pressed="true"/.test(html), 'the selected row is marked on and aria-pressed');
  ok(/role="button" tabindex="0"/.test(html), 'rows are keyboard-reachable buttons');
  ok(/click one to find it on the map/.test(html), 'the section says the rows can be clicked');
  W.closePanel();
}

console.log('\n=== 5. NEGATIVE CONTROL: a footprint blind to WHICH basin fails check 1 ===');
{
  if (basins.length >= 2) {
    const blind = () => { const out = []; for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) if (H.groundAt(x, z) >= cut) out.push([x, z]); return out; };
    const bad = ownershipOK(blind);
    ok(bad > 0, 'the plain aquifer paint, offered as every basin\'s footprint, is caught (' + bad + ' misattributed tiles)');
  } else {
    const blind = () => { const out = []; for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) out.push([x, z]); return out; };
    ok(ownershipOK(blind) > 0, 'the whole plate, offered as the basin footprint, is caught');
  }
}

console.log = _log;
console.log('\n' + (fails ? '❌ ' + fails + ' failed, ' + passes + ' passed' : '✅ all clear (' + passes + ' passed)'));
process.exit(fails ? 1 : 0);
