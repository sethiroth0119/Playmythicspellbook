/* 🚛 v121v120 — the Highway Haul rig faces the right way whatever truck it is
   (the owner's HidnEx feed truck drove tail-first: its box stands taller than
   its cab, and the old rule put the tall end at the nose), at full resolution
   (normal-mapped, anisotropic, feed + stock trucks repacked at 45k / 2048px,
   no 1.1k-tri wrecked pack), blinkers on the model's corners, and traffic that
   is pooled, comes in at the fog line, seeds the road, and comes up from
   behind a slow rig. Run: node _haulrig_smoke.mjs */
import { readFileSync, statSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const HAUL = readFileSync('./public/src/haul/index.js', 'utf8').replace(/\r\n/g, '\n');
const RIGS = readFileSync('./public/src/transport/rigs.data.js', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. which way round ── */
ok(/const HAUL_KNOWN_ROT = \{ 'freight_semi\.glb': 90, 'freight_semi_wrecked\.glb': 90, 'feed_truck\.glb': 90, 'livestock_truck\.glb': 90, 'tanker\.glb': 90 \};/.test(HAUL), 'every truck file the game ships has its nose written down (all long along X, cab at −X)');
ok(/function haulAutoOrient\(THREE, obj, url\) \{\n\s*const known = haulKnownRot\(url\);\n\s*if \(known != null\) return known;/.test(HAUL), 'a shipped truck is looked up before anything is measured');
ok(/haulAutoOrient\(THREE, raw, RIG\.model\.url\)/.test(HAUL), 'the run hands the model URL to the orient step');
ok(/for \(let j = 0; j <= n; j\+\+\) put\(v\.lerpVectors\(p, q, n \? j \/ n : 0\)\);/.test(HAUL), 'an upload\'s roofline is sampled along triangle edges (a decimated roof has no vertices between its corners)');
ok(/const first = h\.slice\(0, Math\.ceil\(N \* 0\.15\)\)\.sort\(\(a, b\) => a - b\), med = first\[Math\.floor\(first\.length \/ 2\)\];/.test(HAUL), 'the ramp is a median, so a two-bin tow hitch cannot pass for a bonnet');

/* ── 2. resolution ── */
ok(/o\.material = new THREE\.MeshStandardMaterial\(\{ map: m\.map \|\| null, normalMap: m\.normalMap \|\| null, color: m\.color \? m\.color\.clone\(\) : 0xffffff, metalness: 0, roughness: 0\.78, side: m\.side \}\);/.test(HAUL), 'the rig keeps the scan\'s normal map (Lambert dropped it), metalness 0 so it is not black with no environment');
ok(/for \(const t of \[m\.map, m\.normalMap\]\) if \(t\) \{ t\.anisotropy = HAUL_ANISO; t\.needsUpdate = true; \}/.test(HAUL) && /HAUL_ANISO = Math\.max\(1, Math\.min\(16, \+mx \|\| 8\)\);/.test(HAUL), 'textures are sampled with the renderer\'s anisotropy');
ok(/const raw = await haulLoadGLB\(THREE, RIG\.model\.url\);/.test(HAUL) && !/RIG\.model\.wrecked/.test(HAUL) && /o\.material\.color\.multiplyScalar\(0\.6\);/.test(HAUL), 'a Wrecked or Salvage rig drives the same full-resolution file, dimmed — never the 1.1k-tri pack');
ok(/const FREIGHT_MODEL = \{ url: '\/models\/trucks\/freight_semi\.glb', scale: 1, rotY: 90 \};/.test(RIGS), 'FREIGHT_MODEL no longer points at the wrecked pack');
const webpDims = (file) => {
  const b = readFileSync(file); const len = b.readUInt32LE(12); const j = JSON.parse(b.slice(20, 20 + len).toString()); const bin = b.slice(20 + len + 8);
  return (j.images || []).map((i) => { const bv = j.bufferViews[i.bufferView]; const d = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); return d.slice(12, 16).toString() === 'VP8 ' ? (d.readUInt16LE(26) & 0x3fff) : 0; });
};
for (const f of ['feed_truck', 'livestock_truck']) {
  const p = './public/models/trucks/' + f + '.glb', sz = statSync(p).size, dims = webpDims(p);
  ok(sz > 1500000 && sz < 3000000 && dims.length === 3 && dims.every((w) => w === 2048), f + '.glb is the 45k-tri / 2048px repack from its master (was 1024px)', JSON.stringify({ sz, dims }));
}

/* ── 3. blinkers on the model ── */
ok(/bl\[key\]\.forEach\(\(m, i\) => \{ m\.position\.set\(sx \* hw, by, i === 0 \? fz : rz\); m\.scale\.setScalar\(1\.8\); \}\);/.test(HAUL) && /hw = size\.w \/ 2 \+ 0\.02, fz = size\.l \/ 2 - 0\.3, rz = -size\.l \/ 2 \+ 0\.3/.test(HAUL), 'the rig\'s blinkers move onto the fitted model\'s four corners');
ok(/for \(const \[side, key\] of \[\[1, 'L'\], \[-1, 'R'\]\]\)/.test(HAUL), 'L is still local +x (the driver\'s left once the rig is turned 180°)');

/* ── 4. traffic ── */
ok(HAUL.indexOf('const carMat = ') > 0 && HAUL.indexOf('const carMat = ') < HAUL.indexOf("if (hz.kind === 'breakdown')"), 'the shared car paints exist before a breakdown hazard builds its car');
{
  const mk = HAUL.slice(HAUL.indexOf('  function makeCar(truck, color, mat) {'), HAUL.indexOf('  const carPool = { t: [], c: [] };'));
  ok(mk.length > 200 && !/new THREE\.BoxGeometry\(/.test(mk) && !/new THREE\.MeshLambertMaterial\(/.test(mk), 'makeCar builds from shared boxes and paints — no geometry or material per car');
}
ok(/function takeCar\(truck, color\) \{/.test(HAUL) && /function dropCar\(v\) \{ scene\.remove\(v\.mesh\); carPool\[v\.truck \? 't' : 'c'\]\.push\(v\.mesh\); \}/.test(HAUL) && /\{ dropCar\(v\); traffic\.splice\(i, 1\); continue; \}/.test(HAUL), 'a car leaving the road goes back in the pool and the next spawn takes it');
ok(/if \(v\.z < S\.z - 70 \|\| v\.z > S\.z \+ weather\.fogFar \+ 40\)/.test(HAUL) && /const want = Math\.floor\(320 \* density \* Math\.min\(1\.25, \(110 \+ weather\.fogFar\) \/ 490\)\);/.test(HAUL), 'the traffic window is as long as the sight line');
ok(/const behind = S\.speed < 20 && Math\.random\(\) < 0\.5;\n\s*spawnTraffic\(behind \? S\.z - 45 - Math\.random\(\) \* 20 : S\.z \+ sightZ \+ Math\.random\(\) \* 30, behind\);/.test(HAUL), 'cars come in at the fog line, and up from behind a slow rig');
ok(/if \(!S\.trafficSeeded\) \{ S\.trafficSeeded = true; for \(let tries = 0; traffic\.length < want && tries < want \* 4; tries\+\+\) spawnTraffic\(S\.z \+ 60 \+ Math\.random\(\) \* \(sightZ - 60\), false\); \}/.test(HAUL), 'the first tick lays the visible road with traffic');
ok(/const cruise = Math\.max\(\(truck \? 17 : 22\) \+ Math\.random\(\) \* \(truck \? 5 : 11\), behind \? S\.speed \+ 6 \+ Math\.random\(\) \* 6 : 0\);/.test(HAUL), 'a car from behind is faster than the rig it joins');

/* ── 5. run the orient step for real ── */
{
  const block = HAUL.slice(HAUL.indexOf('/* ═══ 🚛 GLB rigs and containers'), HAUL.indexOf('/* ───── haul.game.js ───── */'));
  const T = await import('three');
  const api = new Function('THREE', block + '\nreturn { haulAutoOrient, haulKnownRot, haulRooflineScore };')(T);
  ok(api.haulKnownRot('/models/trucks/feed_truck.glb') === 90 && api.haulKnownRot('/models/trucks/tanker.glb?v=3') === 90 && api.haulKnownRot('https://cdn.example/uploads/feed_truck.glb') === null && api.haulKnownRot('/models/trucks/someone_else.glb') === null, 'the table answers only for the game\'s own truck files');
  /* parts: [from, to, height] measured from the CAB end along a 16 m truck */
  const TRUCKS = {
    flatbed: [[0, 3, 3.5], [3, 16, 1.2]],
    boxtruck: [[0, 3, 2.4], [0, 16, 0.8], [3.5, 15.4, 3.5], [15.4, 16, 0.5]],   // cab lower than its box, a tow hitch at the tail
    tanker: [[0, 1.8, 1.5], [1.8, 4.2, 3.0], [0, 16, 0.9], [4.8, 16, 3.2]],      // a bonnet, the cab, then a taller tank
  };
  const build = (parts, axis, cabAt) => {
    const g = new T.Group();
    for (const [a, b, hgt] of parts) {
      const L = b - a, u = (a + b) / 2, along = cabAt * (8 - u);
      const m = new T.Mesh(axis === 'x' ? new T.BoxGeometry(L, hgt, 2.5) : new T.BoxGeometry(2.5, hgt, L));
      m.position.y = hgt / 2; m.position[axis] = along; g.add(m);
    }
    return g;
  };
  for (const [name, parts] of Object.entries(TRUCKS)) {
    const res = [];
    for (const [axis, cabAt] of [['x', -1], ['x', 1], ['z', 1], ['z', -1]]) {
      const rot = api.haulAutoOrient(T, build(parts, axis, cabAt));
      const d = new T.Vector3(axis === 'x' ? cabAt : 0, 0, axis === 'z' ? cabAt : 0).applyAxisAngle(new T.Vector3(0, 1, 0), rot * Math.PI / 180);
      res.push({ axis, cabAt, rot, ok: d.z > 0.99 });
    }
    ok(res.every((r) => r.ok), 'run for real: a ' + name + ' lying four ways round → the cab ends at the nose every time', JSON.stringify(res));
  }
  const box = new Array(40).fill(1); box[0] = 0.08; box[1] = 0.06;   // a box with a tow hitch at this end
  const cab = [0.55, 0.6, 0.66, 0.7, 0.72, 0.72, 0.72, 1, 1, 1].concat(new Array(30).fill(1));
  ok(api.haulRooflineScore(box).taper === 0 && api.haulRooflineScore(cab).taper > 0.25, 'run for real: a two-bin hitch reads as no ramp; a bonnet-and-cab reads as one', JSON.stringify([api.haulRooflineScore(box), api.haulRooflineScore(cab)]));
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 120, 'BUILD_VERSION is v121v120 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
ok(/src\/haul\/index\.js\?v=v121v1(2\d|[3-9]\d)haul\d/.test(SRC), 'the haul buster moved (it had sat at v121v111 since, so v114\'s haul edits shipped under an old URL)');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
