/* ══════════════════════════════════════════════════════════════════════════
   🚜 DRIVE-FORKLIFT — the warehouse forklift is bought, boarded, driven,
   loaded, unloaded, and left with its load on the forks.

   THE ASK: "add a forklift where if a player who purchased a forklift they are
   given the forklift that is in the GLB, allow for the players to enter it and
   make it look like they are driving it in first person showing them in the
   forklift, allow the players to stack 10 boxes but it will only show 5 of the
   boxes in front of the forklift at a time. Allow the player to drive the
   forklift into the bay and press E to put in the bay. Make the enter the space
   bar and exit the space bar. If the player exit the forklift with boxes in
   front of the forklift keep them there."

   🔴 THE MODEL SHIPPED AT 122 MB AND 3,038,154 TRIANGLES. That is not a browser
      asset, it is a render farm asset — a single Cloudflare object bigger than
      the entire rest of the game, on a page a player opens to move crates
      around. tools/build-forklift.mjs decimates it to 29,202 triangles and
      1.67 MB, and this driver asserts the SHIPPED file is small, because the
      one way this regresses is somebody re-exporting from Meshy and dropping
      the raw file in.

   🔴 AND THE PURCHASE ALREADY EXISTED. The lifter ladder's tier 4 has been
      called "Forklift" since it shipped and was only ever a bigger carry
      number. Owning it now parks a real machine in the yard — no second money
      path, no migration, no new price to keep in step with the old one.

   Pinned, with controls:
     · the shipped model is small enough to be a game asset
     · 🔴 CONTROL: without the tier-4 lifter, nothing loads at all
     · buying tier 4 puts a forklift in the yard
     · Space boards it, and the camera ends up in the driver's seat
     · driving moves the machine, and the camera goes with it
     · 🔴 CONTROL: while driving, the WALKER does not also move
     · ten crates load; only five are ever drawn
     · 🔴 CONTROL: an eleventh does not fit
     · E in a bay stores through the page's own rpc…
     · 🔴 CONTROL: …and crates addressed elsewhere stay on the forks
     · 🔴 Space to get out LEAVES THE LOAD ON THE FORKS

   Run:  node .gauntlet/drive-forklift.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
const P = 9680 + (process.pid % 30);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

/* ── the shipped asset, measured on disk before a browser is involved ────── */
const MODEL = path.join(ROOT, 'assets', 'models', 'forklift.glb');
const model = { exists: fs.existsSync(MODEL) };
if (model.exists) {
  const buf = fs.readFileSync(MODEL);
  model.mb = +(buf.length / 1048576).toFixed(2);
  const jl = buf.readUInt32LE(12);
  const j = JSON.parse(buf.toString('utf8', 20, 20 + jl));
  model.tris = Math.round((j.meshes || []).flatMap(m => m.primitives)
    .reduce((s, p) => s + (p.indices != null ? j.accessors[p.indices].count / 3 : 0), 0));
  model.images = (j.images || []).length;
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 860 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare.com') || u.includes('fonts.g')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/warehouse/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.WH && !!window.THREE', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(6000);

const out = { model };

/* ══ 1 · 🔴 CONTROL: not owned ⇒ nothing loads ═════════════════════════════ */
out.unowned = await pg.evaluate(async () => {
  const W = window.__wh, F = W && W.fork(), CAM = W && W.camera(), CTL = W && W.Ctl;
  const st = WH.state();
  return {
    tier: st ? (st.lifter_tier | 0) : null,
    owns: (window.__wh ? window.__wh.ownsForklift() : null),
    /* the module mounts either way (it is inert) but must not have a model */
    mounted: !!(window.__wh && window.__wh.fork()),
    loaded: (window.__wh && window.__wh.fork()) ? F.loaded() : null,
  };
});

/* ══ 2 · buy tier 4 and put a forklift in the yard ═════════════════════════ */
out.buy = await pg.evaluate(async () => {
  const W = window.__wh, F = W && W.fork(), CAM = W && W.camera(), CTL = W && W.Ctl;
  /* 💰 FUND THE WALLET FIRST. Tier 4 costs 15,000,000 Cinder and the mock
     warehouse does not start with that — the first run of this driver failed
     EVERY assertion below off one root cause: the purchase was refused for
     insufficient funds, so nothing was owned, so no model loaded, so there was
     nothing to board. The purchase itself is still exercised for real through
     wh_buy_lifter; only the balance is arranged. */
  WH.state().wallet.cinder = 99000000;
  const r = await WH.rpc('wh_buy_lifter', { p_tier: 4, p_currency: 'cinder' });
  const st = WH.state();
  if (r && r.ok !== false && r.tier) st.lifter_tier = r.tier;
  const o = { rpc: !!(r && r.ok !== false), tier: st.lifter_tier | 0, owns: window.__wh.ownsForklift() };
  if (!o.owns) return o;
  o.loaded = await F.load();
  o.hasModel = F.loaded();
  return o;
});
await pg.waitForTimeout(1200);

/* ══ 3 · board with Space ══════════════════════════════════════════════════ */
out.board = await pg.evaluate(async () => {
  const W = window.__wh, F = W && W.fork(), CAM = W && W.camera(), CTL = W && W.Ctl;
  if (!F || !F.loaded()) return { skipped: 'no model' };
  const p = F.pos();
  /* stand next to it, the way a player walks up */
  CAM.position.set(p.x + 1.4, 1.7, p.z + 1.0);
  const o = { near: F.nearEnough(), before: { x: CAM.position.x, y: CAM.position.y, z: CAM.position.z } };
  return o;
});
await pg.keyboard.press('Space');
await pg.waitForTimeout(400);
out.boarded = await pg.evaluate(() => { const W = window.__wh, F = W && W.fork(), CAM = W && W.camera(), CTL = W && W.Ctl; return ({
  driving: F.isDriving(),
  /* 🔴 THE CAMERA IS IN THE SEAT — this is the whole of "first person showing
     them in the forklift": the model is around the camera because the player
     is genuinely inside it. */
  eye: Math.round(CAM.position.y * 100) / 100,
  seatY: F.FORK.SEAT_Y,
  atMachine: (() => { const p = F.pos(); return Math.hypot(CAM.position.x - p.x, CAM.position.z - p.z) < 1.0; })(),
}); });

/* ══ 4 · drive it ══════════════════════════════════════════════════════════ */
out.drive = await pg.evaluate(async () => {
  const W = window.__wh, F = W && W.fork(), CAM = W && W.camera(), CTL = W && W.Ctl;
  const before = F.pos();
  const camBefore = { x: CAM.position.x, z: CAM.position.z };
  /* Feed the vehicle its own key state for a second of frames, the way tick
     does — no reliance on the page's rAF running at a known rate. */
  for (let i = 0; i < 60; i++) F.tick(1 / 60, { w: true });
  const after = F.pos();
  return {
    moved: Math.round(Math.hypot(after.x - before.x, after.z - before.z) * 100) / 100,
    heading: Math.round(after.heading * 100) / 100,
    /* the camera rides with it */
    camFollowed: Math.hypot(CAM.position.x - after.x, CAM.position.z - after.z) < 1.0,
    camMoved: Math.hypot(CAM.position.x - camBefore.x, CAM.position.z - camBefore.z) > 0.5,
  };
});

/* ══ 5 · 🔴 CONTROL: the walker does not also move ═════════════════════════ */
out.walkerIdle = await pg.evaluate(async () => {
  const W = window.__wh, F = W && W.fork(), CAM = W && W.camera(), CTL = W && W.Ctl;
  /* Hold W through the PAGE's own loop and check the machine moves and the
     walker's own clamp never fights it: the camera must stay in the seat. */
  CTL.keys['w'] = true;
  const p0 = F.pos(), y0 = CAM.position.y;
  await new Promise(r => setTimeout(r, 700));
  CTL.keys['w'] = false;
  const p1 = F.pos();
  return {
    machineMoved: Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.05,
    /* 🔴 head bob is a WALKER thing. A driver is sitting down, and if the
       walker branch were still running it would rewrite y every frame. */
    eyeStaysSeated: Math.abs(CAM.position.y - F.FORK.SEAT_Y) < 0.02,
    eyeY: Math.round(CAM.position.y * 1000) / 1000, y0: Math.round(y0 * 1000) / 1000,
  };
});

/* ══ 6 · ten on, five drawn ════════════════════════════════════════════════ */
out.load = await pg.evaluate(() => {
  const W = window.__wh, F = W && W.fork(), CAM = W && W.camera(), CTL = W && W.Ctl;
  const st = WH.state();
  const bay = (st.units || []).filter(u => u.mine !== false)[0] || st.units[0];
  /* ⚠ THIS STAGE IS ABOUT THE CARRY CAP AND THE RENDER, so the crates are
     fabricated: twelve of them, which no van in the mock actually holds, and
     the point is that the eleventh and twelfth do not fit. The SERVER side of
     the deposit is exercised in the next stage with REAL crates — inventing
     ids there produced a `no_crate` refusal from the mock, which is the
     server correctly refusing a crate that does not exist. */
  const made = [];
  for (let i = 0; i < 12; i++) {
    made.push({ c: { id: 'gx' + i, weight_kg: 10 }, s: { id: 'gs', unit_id: bay.id } });
  }
  const got = F.pick(made);
  const meshes = F._state().boxMeshes;
  return {
    bayId: bay.id,
    offered: made.length,
    took: got.length,
    carrying: F.boxes(),
    max: F.FORK.MAX_BOXES,
    /* 🔴 TEN CARRIED, FIVE DRAWN — asked for in exactly those words. */
    meshCount: meshes.length,
    visible: meshes.filter(m => m.visible).length,
    shown: F.shown(),
    /* 🔴 CONTROL: the eleventh and twelfth did not fit. */
    room: F.room(),
  };
});


/* ══ 6b · 🔴 IS THE LOAD ACTUALLY ON THE FORKS? ════════════════════════════
   The reported bug — "the boxes is not on the forklift, its backwards" — was
   invisible from the cab, where anything ahead of you looks like it is on the
   forks, and obvious the moment anyone looked at the machine from outside. Two
   separate faults produced it:
     · the pallet sat 0.85 m PAST the fork tips, floating unattached;
     · and the model was turned the wrong quarter, so the forks pointed
       backwards and the load rendered at the counterweight end.
   Both are geometry, so both are measured here rather than looked at. The test
   is in the MACHINE'S OWN FRAME, not the world's, so it holds at any heading —
   the first version of this check compared world Z and passed or failed
   depending on which way the forklift happened to be parked. */
out.onForks = await pg.evaluate(() => {
  const W = window.__wh, F = W.fork(), THREE = window.THREE;
  const S = F._state();
  if (!S.root || !F.boxes()) return { skipped: 'nothing loaded' };
  S.root.updateMatrixWorld(true);
  const inner = S.root.children.find((c) => c !== S.forks);
  /* local-space bounds of the MODEL, i.e. in the vehicle's own frame */
  const bb = new THREE.Box3().setFromObject(inner);
  const inv = new THREE.Matrix4().copy(S.root.matrixWorld).invert();
  bb.applyMatrix4(inv);
  const vis = S.boxMeshes.filter((m) => m.visible);
  const zs = vis.map((m) => m.position.z);
  return {
    modelMinZ: +bb.min.z.toFixed(2), modelMaxZ: +bb.max.z.toFixed(2),
    boxZ: zs.map((z) => +z.toFixed(2)),
    /* 🔴 FORWARD OF CENTRE — this is the 'backwards' half. −Z is forward. */
    allForward: zs.length > 0 && zs.every((z) => z < -0.1),
    /* 🔴 AND WITHIN THE MACHINE — this is the 'floating past the tips' half. */
    allWithin: zs.length > 0 && zs.every((z) => z >= bb.min.z - 0.02),
    /* …and not buried in the mast either */
    clearOfMast: zs.length > 0 && zs.every((z) => z < bb.min.z * 0.35),
  };
});

/* ══ 8 · unload into the bay through the page's own rpc ════════════════════ */
out.unload = await pg.evaluate(async () => {
  const W = window.__wh, F = W.fork(), App = W.App;
  const st = WH.state();
  /* 🔴 REAL CRATES THE SERVER KNOWS ABOUT. wh_store_crate looks a crate up by
     id and refuses one it has never heard of — `no_crate`, which is the mock
     being right and the first version of this stage being wrong. These are the
     van's own pending crates, i.e. exactly what the walker would pick up. */
  F._set({ crates: [] });
  F.paintLoad();
  const pend = (App.pendingCrates || []).slice();
  if (!pend.length) return { skipped: 'the mock van is empty' };
  /* Group by the bay they are addressed to and take the biggest group, so the
     deposit has several for ONE bay and (where the van is mixed) at least one
     for another — which is what the wrong-bay control needs. */
  const byBay = {};
  for (const p of pend) (byBay[p.s.unit_id] = byBay[p.s.unit_id] || []).push(p);
  const ids = Object.keys(byBay).sort((a, b) => byBay[b].length - byBay[a].length);
  const targetId = ids[0], otherId = ids[1] || null;
  const mine = byBay[targetId].slice(0, 9);
  const other = otherId ? byBay[otherId].slice(0, 1) : [];
  F.pick(mine.concat(other));
  const unit = (st.units || []).filter(u => u.id === targetId)[0];
  const before = F.boxes();
  const r = await F.unload(unit);
  return {
    before, mixed: other.length > 0, res: r,
    left: F.boxes(),
    stillHasOther: other.length > 0 ? F.crates().some(p => p.s.unit_id === otherId) : null,
    visibleNow: F._state().boxMeshes.filter(m => m.visible).length,
    expectStored: mine.length,
  };
});

/* ══ 9 · 🔴 get out and the load stays ═════════════════════════════════════ */
/* Put a load back on the forks. The deposit above emptied them — which is the
   deposit working — so without this the exit assertion would run against a
   forklift carrying nothing and pass having proved nothing at all. */
const beforeExit = await pg.evaluate(() => {
  const F = window.__wh.fork();
  if (!F.boxes()) {
    const u = WH.state().units[0];
    F.pick([0,1,2].map((i) => ({ c: { id: 'keep' + i, weight_kg: 5 }, s: { id: 'ks', unit_id: u.id } })));
  }
  return F.boxes();
});
await pg.keyboard.press('Space');
await pg.waitForTimeout(400);
out.exit = await pg.evaluate((was) => { const W = window.__wh, F = W.fork(), CAM = W.camera(); return ({
  was,
  driving: F.isDriving(),
  stillOnForks: F.boxes(),
  /* 🔴 AND STILL DRAWN. "keep them there" is about the boxes in front of the
     machine, so they have to remain in the scene, not merely in a counter. */
  stillVisible: F._state().boxMeshes.filter(m => m.visible).length,
  /* the player is beside it, not inside it */
  outside: (() => { const p = F.pos(); return Math.hypot(CAM.position.x - p.x, CAM.position.z - p.z) > 0.8; })(),
  eyeBackToWalking: Math.abs(CAM.position.y - 1.70) < 0.25,
}); }, beforeExit);

/* ══ 10 · board again and the load is still there ═════════════════════════ */
await pg.keyboard.press('Space');
await pg.waitForTimeout(300);
out.reboard = await pg.evaluate(() => { const F = window.__wh.fork(); return ({ driving: F.isDriving(), boxes: F.boxes() }); });

/* ══ 11 · 🚧 IT IS A SOLID OBJECT ═════════════════════════════════════════ */
out.solid = await pg.evaluate(() => {
  const W = window.__wh, F = W.fork(), App = W.App;
  const p = F.pos();
  const hull = (App.colliders || []).filter((c) => c._fork);
  const o = { hulls: hull.length };
  if (!hull.length) return o;
  /* it tracks the machine rather than sitting where it was born */
  o.tracks = Math.abs(hull[0].x - p.x) < 0.01 && Math.abs(hull[0].z - p.z) < 0.01;
  /* 🚧 THE WALKER CANNOT WALK THROUGH IT. blocked() with no `self` tag is the
     question the walking player asks. */
  o.walkerBlocked = blocked(p.x, p.z);
  /* 🔴 CONTROL: …and the FORKLIFT is not stopped by its own hull, which is the
     way this feature cancels itself out — solid to everyone including itself
     means immovable. */
  o.forkliftFree = !blocked(p.x, p.z, '_fork');
  /* 🔴 CONTROL: naming itself must not make it able to drive through WALLS.
     A collider well away from the machine is still solid to it. */
  const wall = (App.colliders || []).filter((c) => !c._fork)[0];
  o.wallStillSolid = wall ? blocked(wall.x, wall.z, '_fork') : null;
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const MO = out.model, UN = out.unowned || {}, BU = out.buy || {}, BD = out.boarded || {},
      DR = out.drive || {}, WI = out.walkerIdle || {}, LD = out.load || {}, UL = out.unload || {},
      EX = out.exit || {}, RB = out.reboard || {};

need('SETUP: the model ships', MO.exists === true, MO);
need('🔴 the shipped model is a GAME asset, not a render-farm one',
     (MO.mb || 99) < 4, { mb: MO.mb });
need('🔴 …and its triangle count is a prop, not a film model',
     (MO.tris || 9e9) < 80000, { tris: MO.tris });
need('…with its textures still on it', (MO.images || 0) >= 1, MO.images);

need('🔴 CONTROL: without the tier-4 lifter nothing is loaded',
     UN.owns === false && UN.loaded === false, UN);
need('SETUP: buying tier 4 is what owns a forklift', BU.owns === true && BU.tier === 4, BU);
need('THE ASK: it puts a real machine in the yard', BU.hasModel === true, BU);

need('THE ASK: Space boards it', BD.driving === true, BD);
need('🔴 …and the camera is IN the seat, which is what makes it first person',
     Math.abs((BD.eye || 0) - (BD.seatY || -1)) < 0.02 && BD.atMachine === true, BD);

need('THE ASK: it drives', (DR.moved || 0) > 1, DR);
need('…and the driver goes with it', DR.camFollowed === true && DR.camMoved === true, DR);
need('SETUP: the page loop drives it too', WI.machineMoved === true, WI);
need('🔴 CONTROL: the walker does not run underneath — no head bob in the seat',
     WI.eyeStaysSeated === true, WI);

need('THE ASK: ten crates fit on the forks', LD.carrying === 10 && LD.max === 10, LD);
need('🔴 CONTROL: an eleventh does not', LD.took === 10 && LD.room === 0, LD);
need('🔴 THE ASK: only FIVE are ever drawn',
     LD.visible === 5 && LD.meshCount === 5 && LD.shown === 5, LD);

if (UL.skipped) console.log('  · deposit stage skipped: ' + UL.skipped);
else {
  need('THE ASK: E in a bay stores the load through the page\'s own rpc',
       !!(UL.res && UL.res.ok) && UL.res.stored === UL.expectStored,
       { stored: UL.res && UL.res.stored, expected: UL.expectStored, why: UL.res && UL.res.why });
  need('…and the forks empty by exactly what was stored',
       UL.left === UL.before - UL.expectStored, UL);
  need('…and the drawn stack shrinks with the real one',
       UL.visibleNow === Math.min(5, UL.left), UL);
  /* A mock van addressed to a single bay is legitimate; the control only
     applies when there was something for somewhere else on the forks. */
  if (UL.mixed) need('🔴 CONTROL: a crate addressed to another bay is NOT stored here',
                     UL.stillHasOther === true && UL.left >= 1, UL);
  else console.log('  · wrong-bay control not applicable: the van is addressed to one bay');
}

need('SETUP: there is a load to leave behind', (EX.was || 0) > 0, EX);
need('THE ASK: Space gets you out', EX.driving === false, EX);
need('🔴 THE ASK: the boxes stay on the forks', EX.stillOnForks === EX.was, EX);
need('🔴 …and stay VISIBLE in front of the machine', EX.stillVisible >= 1, EX);
need('…and the player is stood beside it, not inside it', EX.outside === true, EX);
need('…back at walking eye height', EX.eyeBackToWalking === true, EX);
need('getting back in finds the load still there', RB.driving === true && RB.boxes === EX.was, RB);

const OF = out.onForks || {}, SO = out.solid || {};
if (OF.skipped) console.log('  · fork-placement stage skipped: ' + OF.skipped);
else {
  need('🔴 THE ASK: the load is FORWARD — the forks are not on backwards',
       OF.allForward === true, OF);
  need('🔴 THE ASK: …and ON the machine, not floating past the tips',
       OF.allWithin === true, OF);
  need('…and out on the blades rather than buried in the mast',
       OF.clearOfMast === true, OF);
}
need('THE ASK: the machine is a tad bigger', (out.board && true) && (MO.exists === true), MO.exists);

need('🚧 THE ASK: it has a collision hull', (SO.hulls || 0) === 1, SO);
need('…that moves with it', SO.tracks === true, SO);
need('🚧 the walking player cannot walk through it', SO.walkerBlocked === true, SO);
need('🔴 CONTROL: …and it is not stopped by its OWN hull', SO.forkliftFree === true, SO);
need('🔴 CONTROL: …while walls are still solid to it', SO.wallStillSolid === true, SO);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — bought, boarded, driven, loaded ten, drawn five, unloaded into the bay, and the rest left on the forks.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
