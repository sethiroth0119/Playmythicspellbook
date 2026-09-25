/* 🚦 v121v111 (owner) — blinkers on the correct side, A/D the right way in the
   city builder, the haul drives the catalogue truck auto-oriented from its
   mesh, no containers on a deck-less truck, traffic never shoved.
   Run: node _signals_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const HAUL = readFileSync('./public/src/haul/index.js', 'utf8').replace(/\r\n/g, '\n');
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. blinkers ── */
ok(/for \(const \[side, key\] of \[\[1, 'L'\], \[-1, 'R'\]\]\)/.test(HAUL), 'the left blinkers sit at local +x — the RIGHT side after the 180° turn is the wrong one they used to sit on');
ok(/setBlink\(rig, steer \|\| \(rampOpen \? 1 : 0\)/.test(HAUL) && /const steer = \(right \? 1 : 0\) - \(left \? 1 : 0\);/.test(HAUL), 'steering right (+1) lights R, left (−1) lights L, unchanged');

/* ── 2. the city builder's pan ── */
ok(/_kpRight\.set\(-_kpFwd\.z, 0, _kpFwd\.x\);/.test(NC) && !/_kpRight\.set\(_kpFwd\.z, 0, -_kpFwd\.x\)/.test(NC), 'right = forward × up');
ok(/const x = KEYPAN\.d - KEYPAN\.a, z = KEYPAN\.s - KEYPAN\.w;/.test(NC), 'D is +x, A is −x, as before');
{
  // run the vector for real: looking down −Z (the default), D must move toward +X
  const fwd = { x: 0, z: -1 }; const right = { x: -fwd.z, z: fwd.x };
  ok(right.x === 1 && right.z === 0, 'looking down −Z, D pans toward +X (screen right)');
  const fwd2 = { x: 1, z: 0 }; const right2 = { x: -fwd2.z, z: fwd2.x };
  ok(right2.x === 0 && right2.z === 1, 'looking down +X, D pans toward +Z — still the camera\'s right');
}

/* ── 3. the haul drives the catalogue truck, auto-oriented ── */
ok(/^function _haulModelOf\(v\) \{/m.test(SRC) && /const def = \(typeof _ppRigDef === 'function'\) \? _ppRigDef\(v\) : null;\n\s*const own = pick\(def && def\.model\);\n\s*if \(own\) return own;/.test(SRC), 'the class model (the semi for freight) comes first for the haul; a row upload only when the class has none');
ok(/if \(v && v\.modelUrl\) return \{ url: v\.modelUrl/.test(SRC), '…while the yard card still lets a row\'s own render win (unchanged)');
ok(/function haulAutoOrient\(THREE, obj, url\)/.test(HAUL) && /haulFit\(THREE, raw, \{ w: 2\.6, l: 15\.0 \}, haulAutoOrient\(THREE, raw, RIG\.model\.url\), true\)/.test(HAUL), 'the run measures the mesh for its rotation and fits it to 2.6 m wide / 15 m long');
ok(/if \(deck\.guessed\) \{ slots\.forEach\(\(slot\) => \{ slot\.visible = false; slot\.userData\.cargo = false; \}\); return; \}/.test(HAUL), 'a truck with no deck in its mesh gets no containers stacked on it');

/* ── 4. traffic ── */
ok(/if \(gap < 0\.3 && !lead\.rig && lead\.z > v\.z\) v\.z = Math\.max\(v\.z - 6 \* dt, lead\.z - lead\.halfL - v\.halfL - 0\.3\);/.test(HAUL), 'a car is only ever eased BACK behind a lead that is ahead of it — never snapped into one');
ok(/v\.x = Math\.max\(-ROAD_W \/ 2 \+ v\.halfW, Math\.min\(ROAD_W \/ 2 - v\.halfW, v\.x \+ push \* 0\.8 \* dt \* 20\)\);/.test(HAUL), 'a side-swiped car is pushed by the second and stays on the road');

/* ── 5. run haulAutoOrient for real, four ways round ── */
{
  const block = HAUL.slice(HAUL.indexOf('/* ═══ 🚛 GLB rigs and containers'), HAUL.indexOf('/* ───── haul.game.js ───── */'));
  const api = new Function('THREE', block + '\nreturn { haulAutoOrient, haulFit, haulDeckOf };');
  const T = await import('three');
  const H = api(T);
  const make = (axis, cabAt) => {
    const g = new T.Group();
    const body = new T.Mesh(axis === 'x' ? new T.BoxGeometry(16, 1, 2.5, 16, 1, 4) : new T.BoxGeometry(2.5, 1, 16, 4, 1, 16)); body.position.y = 0.5; g.add(body);
    const cab = new T.Mesh(axis === 'x' ? new T.BoxGeometry(3, 3.5, 2.5, 2, 1, 4) : new T.BoxGeometry(2.5, 3.5, 3, 4, 1, 2)); cab.position.y = 1.75; cab.position[axis] = cabAt * 6.5; g.add(cab);
    return g;
  };
  const tallEnd = (node, rig) => { // which end of Z is the cab, in the rig's frame
    rig.updateMatrixWorld(true); const inv = new T.Matrix4().copy(rig.matrixWorld).invert(); const v = new T.Vector3(); const mm = new T.Matrix4();
    let lo = -Infinity, hi = -Infinity;
    node.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position; mm.multiplyMatrices(inv, o.matrixWorld); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mm); if (v.z < -5) lo = Math.max(lo, v.y); if (v.z > 5) hi = Math.max(hi, v.y); } });
    return hi > lo ? '+z' : '-z';
  };
  for (const [axis, cabAt, want] of [['x', -1, 90], ['x', 1, 270], ['z', 1, 0], ['z', -1, 180]]) {
    const raw = make(axis, cabAt);
    const rot = H.haulAutoOrient(T, raw);
    const fit = H.haulFit(T, raw, { w: 2.6, l: 15 }, rot, true);
    const rig = new T.Group(); rig.rotation.y = Math.PI; rig.add(fit.node);
    ok(rot === want && Math.abs(fit.l - 15) < 1e-6 && tallEnd(fit.node, rig) === '+z', 'a truck along ' + axis + ' with its cab at ' + (cabAt > 0 ? '+' : '−') + axis + ' → rotation ' + want + '°, 15 m long, cab at the nose (+Z)', JSON.stringify({ rot, l: fit.l, end: tallEnd(fit.node, rig) }));
  }
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 111, 'BUILD_VERSION is v121v111 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
