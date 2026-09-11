/* 🚛📦🚨 v121v110 — the white flatbed semi on every freight rig (Truck Yard and
   Highway Haul), the two shipping containers on its deck with the old cargo
   animation, and raiders that cannot drive through traffic.
   Run: node _semi_smoke.mjs */
import { readFileSync, statSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const HAUL = readFileSync('./public/src/haul/index.js', 'utf8').replace(/\r\n/g, '\n');
const RIGS = readFileSync('./public/src/transport/rigs.data.js', 'utf8').replace(/\r\n/g, '\n');
const IGN = readFileSync('./public/.assetsignore', 'utf8');

/* ── 1. the files ship, small ── */
for (const f of ['freight_semi', 'container_blue', 'container_red']) {
  let sz = 0; try { sz = statSync('./public/models/trucks/' + f + '.glb').size; } catch (e) {}
  ok(sz > 100000 && sz < 3000000, f + '.glb is packed and under 3 MB', sz);
  ok(IGN.includes('!models/trucks/' + f + '.glb'), f + '.glb is on the upload allow-list (the blanket **/*.glb rule would 404 it in production)');
}

/* ── 2. every freight rig carries the semi ── */
ok(/const FREIGHT_MODEL = \{ url: '\/models\/trucks\/freight_semi\.glb', scale: 1, rotY: 90, wrecked: '\/models\/trucks\/freight_semi_wrecked\.glb' \};/.test(RIGS), 'FREIGHT_MODEL is the semi, turned 90° (its long axis is X, cab at −X), with its wrecked pack');
ok((RIGS.match(/emoji: '🚛', accent: RIG_ACCENT, model: FREIGHT_MODEL,/g) || []).length === 6, 'all six freight rows carry it');
ok(/sku: v\.rigId \|\| null, model: _haulModelOf\(v\)/.test(SRC) && /^function _haulModelOf\(v\) \{/m.test(SRC), 'the haul bridge hands the CATALOGUE model to the run (the semi for freight), a row upload only when the class has none');
ok(/model: \(v\.model && typeof v\.model\.url === 'string' && v\.model\.url\) \? \{ url: v\.model\.url, scale: \+v\.model\.scale \|\| 1, rotY: \+v\.model\.rotY \|\| 0, wrecked:/.test(HAUL), 'rigProfile keeps it (and the wrecked pack)');

/* ── 3. the run: model over the boxes, containers on the deck ── */
ok(/const PLAYER_HALF_W = 1\.15, BASE_PLAYER_HALF_L = 4\.2;/.test(HAUL) && /const RIG = rigProfile\(opts\.rig\);\n\s*let PLAYER_HALF_L = BASE_PLAYER_HALF_L;/.test(HAUL), 'the collision half-length is per run and grows to the model');
ok(/PLAYER_HALF_L = Math\.max\(BASE_PLAYER_HALF_L, Math\.min\(7\.6, size\.l \/ 2\)\);/.test(HAUL) && /S\.camExtra = Math\.max\(0, \(PLAYER_HALF_L - BASE_PLAYER_HALF_L\) \* 1\.15\);/.test(HAUL), '…and the chase camera backs off by the extra length');
ok(/const slot = new THREE\.Group\(\); slot\.position\.set\(0, 1\.1, 0\.4 - i \* 1\.9\); slot\.userData\.cargo = true;/.test(HAUL), 'cargo slots are groups (the crate is a child), so the cargo animation is untouched');
ok(/rig\.children\.forEach\(\(c\) => \{ if \(c\.userData\.cargo\) \{ const k = 0\.5 \+ 0\.5 \* \(S\.cargo \/ 100\); c\.scale\.set\(k, k, k\); c\.rotation\.z = \(1 - k\) \* 0\.6; \} \}\);/.test(HAUL), 'the old shrink-and-tilt cargo animation is still the one that runs');
ok(/const raw = await haulLoadGLB\(THREE, wrecked \? RIG\.model\.wrecked : RIG\.model\.url\);[^\n]*const fit = haulFit\(THREE, raw, \{ w: 2\.6, l: 15\.0 \}, haulAutoOrient\(THREE, raw\), true\); truck = fit\.node; size = fit;/.test(HAUL) && /proc\.forEach\(\(o\) => \{ o\.visible = false; \}\);/.test(HAUL), 'the semi is fitted to the traffic trucks\' width and the procedural rig is hidden, never removed (it is the fallback)');
ok(/const deck = haulDeckOf\(THREE, truck, size, rig\);/.test(HAUL) && /const fit = haulFit\(THREE, box, \{ w: Math\.max\(1\.6, size\.w - 0\.15\), l: L, h: 2\.1 \}, spec\.rotY, false\);/.test(HAUL) && /slot\.add\(fit\.node\);/.test(HAUL), 'the containers are laid along the deck the mesh reveals');
ok(/\{ url: '\/models\/trucks\/container_red\.glb',\s+rotY: 90, frac: 0\.58 \}/.test(HAUL) && /\{ url: '\/models\/trucks\/container_blue\.glb', rotY: 90, frac: 0\.42 \}/.test(HAUL), 'red 40-footer rear, blue 20-footer front');
ok(/let alive = true;/.test(HAUL) && /function destroy\(\) \{\n\s*alive = false;/.test(HAUL) && /if \(!alive\) return;\n\s*truck\.userData\.rigModel = true;/.test(HAUL), 'a model that lands after the run ended is dropped');
ok(/const HAUL_THREE_ADDONS = 'https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.171\.0\/examples\/jsm\/loaders\/GLTFLoader\.js';/.test(HAUL) && /"three": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.171\.0\/build\/three\.webgpu\.js"/.test(SRC), 'the GLTFLoader comes from the same three.js build the run imports (one instance)');

/* ── 4. raiders vs traffic ── */
ok(/const lead = raiderLead\(R, S, traffic\);\n\s*const want = raiderSteer\(R, S, lead, ROAD_W \/ 2, dt\);/.test(HAUL), 'the raider steers around a lead car instead of homing through it');
ok(/if \(lead && want\.gap < 0\.3 && lead\.z - R\.z > 0\) R\.z = lead\.z - lead\.halfL - R\.halfL - 0\.3;/.test(HAUL), '…and can never overlap it');
ok(/if \(R\.blockedT >= RAIDER_GIVE_UP_S\) \{ S\.raidersBeaten\+\+; scene\.remove\(R\.mesh\); S\.raider = null; flash\('🚗 TRAFFIC HELD THE RAIDERS OFF'\); \}/.test(HAUL), 'raiders held off long enough give up, and that counts as beaten');
ok(/Raiders cannot drive through traffic: a car between you and them holds them off/.test(HAUL), 'the how-to says so');

/* ── 5. run the helpers for real ── */
{
  const block = HAUL.slice(HAUL.indexOf('/* ═══ 🚛 GLB rigs and containers'), HAUL.indexOf('/* ───── haul.game.js ───── */'));
  const api = new Function('THREE', block + '\nreturn { raiderLead, raiderSteer, haulFit, haulDeckOf, RAIDER_GIVE_UP_S };');
  const T = await import('three');
  const H = api(T);
  const S = { x: 1.8, z: 500, speed: 40 };
  const R = { x: 1.8, z: 470, speed: 48, halfL: 2.2, halfW: 1.0 };
  const car = { x: 1.8, z: 480, speed: 22, halfL: 2.2, halfW: 1.0 };
  ok(H.raiderLead(R, S, [car]) === car, 'a car between the raider and the rig, in its width, is its lead');
  ok(H.raiderLead(R, S, [{ ...car, x: 5.4 }]) === null, 'a car a lane over is not');
  ok(H.raiderLead(R, S, [{ ...car, z: 503 }]) === null, 'nor is a car already past the rig');
  ok(H.raiderLead(R, S, [{ ...car, z: 460 }]) === null, 'nor one behind the raider');
  const w1 = H.raiderSteer(R, S, car, 7.2, 0.016);
  ok(w1.blocked === true && w1.speed <= car.speed && Math.abs(w1.x - (car.x + 2.7)) < 1e-9, 'blocked: brake to the lead, aim for the gap beside it on the rig\'s side', JSON.stringify(w1));
  const w2 = H.raiderSteer(R, S, { ...car, x: 5.4 }, 7.2, 0.016);
  ok(w2.blocked === true && w2.x < 5.4, 'when that side is off the road, the other side', JSON.stringify(w2));
  const w3 = H.raiderSteer(R, S, null, 7.2, 0.016);
  ok(w3.blocked === false && w3.x === S.x && w3.speed === 52, 'nothing in the way: straight at the rig, flat out');
  ok(H.RAIDER_GIVE_UP_S === 6, 'six seconds held off and they give up');
  // a synthetic semi: 16 long on X, cab at −X, deck 1 high
  const truck = new T.Group();
  // (segmented, so the centre strip the deck finder samples has vertices in it, as any real mesh does)
  const body = new T.Mesh(new T.BoxGeometry(16, 1, 2.5, 16, 1, 4)); body.position.y = 0.5; truck.add(body);
  const cab = new T.Mesh(new T.BoxGeometry(3, 3.5, 2.5, 2, 1, 4)); cab.position.set(-6.5, 1.75, 0); truck.add(cab);
  const size = H.haulFit(T, truck, { w: 2.4, l: 14 }, 90, true);
  ok(Math.abs(size.l - 14) < 1e-6 && Math.abs(size.w - 2.1875) < 1e-6 && Math.abs(size.h - 3.0625) < 1e-6, 'run for real: fitted uniformly to 14 m long (the width has room)', JSON.stringify(size));
  const rig = new T.Group(); rig.rotation.y = Math.PI; const outer = new T.Group(); outer.position.set(30, 0, -400); outer.add(rig); rig.add(size.node);
  const b = new T.Box3().setFromObject(size.node);
  ok(Math.abs(b.min.y) < 1e-6, 'floor at y 0');
  const deck = H.haulDeckOf(T, size.node, size, rig);
  ok(!deck.guessed && Math.abs(deck.top - 0.875) < 1e-6 && deck.z0 < -6 && deck.z1 > 3 && deck.z1 < 4.6, 'the deck is found: top 0.875, from the rear up to the cab, in the rig\'s own frame despite the rig sitting at (30, −400) turned round', JSON.stringify(deck));
  const box = new T.Group(); const bm = new T.Mesh(new T.BoxGeometry(12, 2.6, 2.4)); bm.position.y = 1.3; box.add(bm);
  const cs = H.haulFit(T, box, { w: 2.3, l: 6, h: 2.3 }, 90, false);
  ok(Math.abs(cs.w - 2.3) < 1e-6 && Math.abs(cs.l - 6) < 1e-6 && Math.abs(cs.h - 2.3) < 1e-6 && cs.node.children[0] === box, 'a container fits its slot on every axis (the holder is scaled, the model inside it only turned)', JSON.stringify({ w: cs.w, l: cs.l, h: cs.h }));
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 110, 'BUILD_VERSION is v121v110 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
ok(/src\/haul\/index\.js\?v=v121v1\d\dhaul\d/.test(SRC), 'the haul buster moved');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
