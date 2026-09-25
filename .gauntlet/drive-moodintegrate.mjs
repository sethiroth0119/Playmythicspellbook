/* ══════════════════════════════════════════════════════════════════════════
   🔗 DRIVE-MOODINTEGRATE — the INTEGRATION pass over P1 / P3 / P4.

   The three pieces were built in parallel, passed individually, and collided.
   This boots the shipped page in real Chromium and PLAYS it — places a
   building, lays a road, lays a pipe — then makes the claims the individual
   drivers structurally could not:

     A  P4 CADENCE. animate() runs economyTick on a 1 s accumulator and
        vitalsTick on a 2 s one, so HALF of all economy beats stand alone.
        MythicPower.solve() runs inside economyTick. drive-moodreact drives
        __nc.step, which calls the two 1:1, so the lone-beat state the player is
        in half the time NEVER OCCURS THERE. This drives __nc.ticks at the real
        cadence and asks whether the badge memo agrees with MythicPower.factorAt
        on the lone beats. Paired beats are the control.
     B  P3 DECLUTTER. A solid housing block, and the measured quantity is how
        much of each badge's own screen box is sat on by OTHER badges. The
        control is the SAME scene with MOOD.declutter raised out of reach — i.e.
        the shipped behaviour before this pass — read in the same session.
     C  P3 DEPTH ORDER. The material is depthTest:false in one indexed draw, so
        the index order IS the paint order. Read the live index buffer and the
        per-badge camera distance and count pairs where a FARTHER badge paints
        over a NEARER one — at two cameras 180 degrees apart, because a single
        camera can pass on luck of the tie-break.
     D  FRAME COST, layer off vs on, read TOGETHER before any capture.
     E  P1 CAMP CARD. Both blocks' verdict for one supply, at one instant, plus
        the roster's own state, plus a NaN/undefined sweep of the card text.
     F  IT REACTS. Place a building / lay a road / lay a pipe through the
        SHIPPED paths and read the badge over the affected tile before/after.

   🔴 THE RENDER TRAP (CLAUDE.md, .gauntlet/README.md item 6) IS OBEYED. Every
      pixel A/B calls renderer.render() between the two reads and drawImage in
      the SAME task, with a do-nothing control beside it. Note that B and C
      below are GEOMETRY reads, not framebuffer reads: the index buffer and the
      projected boxes ARE what decides the picture here, and reading them is
      exact where a pixel diff of forty overlapping badges is not. D is the
      pixel/draw-call half and follows the protocol.

   Run:  node .gauntlet/drive-moodintegrate.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8940 + (process.pid % 50);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});

const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 240)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 240)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(14000);

let fails = 0;
const fail = (m) => { fails++; console.error('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);
const pct = (n) => (n * 100).toFixed(1) + '%';

console.log('\n\u{1F517} PLOT-MOOD INTEGRATION — driven');

/* ── THE SCENE ─────────────────────────────────────────────────────────────
   A solid 6x7 housing block (the case the declutter critique measured) with a
   road spine, plus a control street light well clear of it. Agents are culled
   so nothing but the badge layer moves between two reads. */
const BLOCK = { x0: 6, x1: 11, z0: 6, z1: 12 };
const CTL = { x: 19, z: 19 };
const built = await page.evaluate(async ([B, C]) => {
  const nc = window.__nc, BR = window.MythicCityBridge;
  BR.spendCinders = async () => true; BR.spendRes = async () => true;
  BR.getCinders = async () => 9e9; BR.getRes = async () => 9e9; BR.addCinders = async () => true;
  /* ⚠ THE CONSTRUCTION QUEUE HOLDS TWO SITES. nc.build.slots() is 2 on a fresh
     city, and a third place() is refused SILENTLY — it returns the same falsy
     value a successful placement does — so the first cut of this driver built a
     12-tile city, measured it, and would have reported a clean pass on a scene
     that never existed. Every building goes down one at a time with a
     finishAll() behind it. Roads are not sites and go straight down. */
  const put = async (type, x, z) => { await nc.place(type, x, z); try { nc.build.finishAll(); } catch (e) {} };
  for (let x = B.x0 - 1; x <= B.x1 + 1; x++) await nc.place('road', x, B.z0 - 1);
  for (let x = B.x0; x <= B.x1; x++) for (let z = B.z0; z <= B.z1; z++) await put('housing', x, z);
  await put('streetlight', C.x, C.z);
  /* 🌾 TWO FARMS, because claim E2 is about a card that reads FOOD production
     and a city of nothing but houses makes none — the amber vault-hold state
     would then be unreachable and the check would pass by never running. */
  await put('farm', C.x - 2, C.z);
  await put('farm', C.x - 3, C.z);
  /* ⚡ A REAL GRID, because claim A is about MythicPower.factorAt and a city with
     no generation never leaves state.ok === false, where factorAt returns a
     constant 1 — a target that cannot move, and therefore a check that cannot
     fail. Two turbines and a line run put the block on the demand ladder. */
  await put('wind', B.x0 - 2, B.z0 - 2);
  await put('wind', B.x0 - 2, B.z0);
  try { window.MythicPower.lines.arm(true);
        window.MythicPower.lines.lay(B.x0 - 2, B.z0 - 2, B.x0 - 2, B.z1);
        window.MythicPower.lines.lay(B.x0 - 2, B.z1, B.x1, B.z1); } catch (e) {}
  try { nc.cullAgents(); } catch (e) {}
  await nc.step(2, 4);
  try { window.MythicPlotMood.invalidate('driver'); } catch (e) {}
  return { tiles: Object.keys(nc.game.tiles).length,
           cov: Object.fromEntries(Object.entries(nc.game.cov.pct).map(([k, v]) => [k, +v.toFixed(2)])) };
}, [BLOCK, CTL]);
console.log('   scene: ' + built.tiles + ' tiles · solid housing block ' +
  BLOCK.x0 + '..' + BLOCK.x1 + ' x ' + BLOCK.z0 + '..' + BLOCK.z1 + ' · control light at ' + CTL.x + ',' + CTL.z);
console.log('   coverage: ' + JSON.stringify(built.cov));

/* ══ A. P4 — THE LONE ECONOMY BEAT ═══════════════════════════════════════ */
console.log('\nA  P4 CADENCE — does the badge memo agree with MythicPower.factorAt');
console.log('   on the beats animate() runs economyTick WITHOUT vitalsTick?');
{
  const r = await page.evaluate(async () => {
    const nc = window.__nc, M = window.MythicPlotMood;
    if (!M || !M.ready()) return { skip: 'plotmood not ready' };
    const PW = window.MythicPower;
    if (!PW) return { skip: 'MythicPower absent' };
    /* 🔴 factorAt, NOT node-city's pwFactorOf. /src/plotmood reads
       MythicPower.factorAt(x,z).factor — see the `power` arm of its scorer — and
       node-city's pwFactorOf reads a DIFFERENT map (_pwFac, the tick's own
       cache) which is null on a city with no solved grid. Checking the wrong one
       is how this claim gets a free pass: the first cut of this driver skipped
       out with "no judged tile with a power factor" on a scene that had one. */
    const cand = [];
    for (const k of Object.keys(nc.game.tiles)) {
      const m = M.moodAtKey(k); if (!m) continue;
      const p = k.split(','), x = +p[0], z = +p[1];
      const r = PW.factorAt(x, z);
      if (r && Number.isFinite(r.factor)) cand.push({ k, x, z });
    }
    if (!cand.length) return { skip: 'no judged tile with a power factor' };
    const T = cand[Math.floor(cand.length / 2)];
    const liveOf = () => { const r = PW.factorAt(T.x, T.z); return r && Number.isFinite(r.factor) ? r.factor : 1; };

    const seen = new Set();
    let loneDisagree = 0, loneTotal = 0, pairDisagree = 0, pairTotal = 0;
    let loneInvalidated = 0, loneBeats = 0;
    /* THE SHIPPED CADENCE, from __nc.ticks — economyTick on every beat,
       vitalsTick on every SECOND one, which is the 1 s / 2 s ratio animate()
       runs. Beats 1,3,5… are paired; 0,2,4… stand ALONE, and the lone beat is
       the state drive-moodreact structurally cannot produce because __nc.step
       calls the two 1:1.
       ⚠ dt is 0.25 min per economy beat rather than the wall-clock 1 s: the
         RATIO is what this claim is about, and at 1 s a beat the city does not
         move far enough in 32 beats for the power factor to change at all —
         which yields a target that cannot vary and a check that cannot fail. */
    const DT = 0.25;
    for (let beat = 0; beat < 32; beat++) {
      const genBefore = (M.report() || {}).gen;
      await nc.ticks.economyTick(DT);
      const paired = (beat % 2) === 1;
      if (!paired) {
        /* 🔴 THE STRUCTURAL HALF, AND IT IS THE ONE THAT CANNOT BE LUCKY.
           Whatever the numbers do, a lone economy beat MUST bump the memo's
           generation — that is the hook this pass restored. If it does not, the
           badge and the dossier are reading a table nothing has told to move. */
        loneBeats++;
        if ((M.report() || {}).gen !== genBefore) loneInvalidated++;
      }
      if (paired) nc.ticks.vitalsTick(DT * 60 * 2);
      const live = liveOf();
      const memo = M.moodAtKey(T.k);
      const termed = memo && memo.terms && memo.terms.power;
      /* The memo's `power` term is clamped to 1 above MOOD.powerShed (0.999),
         so an un-shed tile reads 1 either way and is not evidence. Only beats
         where the live factor is actually below the shed threshold count. */
      if (!(live < 0.999)) continue;
      seen.add(Number(live).toFixed(4));
      const disagree = Number.isFinite(termed) && Math.abs(termed - live) > 1e-4;
      if (paired) { pairTotal++; if (disagree) pairDisagree++; }
      else { loneTotal++; if (disagree) loneDisagree++; }
    }
    return { tile: T.k, loneDisagree, loneTotal, pairDisagree, pairTotal, distinct: seen.size,
             loneInvalidated, loneBeats,
             model: (nc.power() || {}).model };
  });
  if (r.skip) { console.log('   ~ skipped: ' + r.skip); }
  else {
    console.log('   power model: ' + r.model + ' · target tile ' + r.tile + ' · ' +
                r.distinct + ' distinct live factorAt values over the run');
    console.log('   LONE economy beats that bumped the memo generation: ' + r.loneInvalidated + '/' + r.loneBeats);
    if (r.loneInvalidated !== r.loneBeats)
      fail('a lone economy beat did NOT invalidate the badge memo — the economyTick hook is missing');
    else ok('every lone economy beat invalidates — the restored hook fires on the beats vitalsTick misses');
    console.log('   LONE  economy beats disagreeing with factorAt: ' + r.loneDisagree + '/' + r.loneTotal);
    console.log('   PAIRED beats (the control)                   : ' + r.pairDisagree + '/' + r.pairTotal);
    if (r.distinct < 2) console.log('   ~ the factor held one value all run, so the numeric half could not have');
    else if (r.loneDisagree > r.pairDisagree) fail('lone beats are staler than paired ones');
    else ok('lone beats are no staler than paired ones, over ' + r.distinct + ' distinct factor values');
    /* THE CONTROL. A 16/16 that can only ever be 16/16 is not evidence. With
       invalidate() stubbed out — i.e. the state this pass was fixing — the same
       loop must read 0/16, or the check is measuring nothing. */
    const ctl = await page.evaluate(async () => {
      const nc = window.__nc, M = window.MythicPlotMood;
      const real = M.invalidate; M.invalidate = () => false;
      let bumped = 0, beats = 0;
      try {
        for (let b = 0; b < 32; b++) {
          const g0 = (M.report() || {}).gen;
          await nc.ticks.economyTick(0.25);
          if ((b % 2) === 0) { beats++; if ((M.report() || {}).gen !== g0) bumped++; }
          else nc.ticks.vitalsTick(30);
        }
      } finally { M.invalidate = real; }
      return { bumped, beats };
    });
    console.log('   CONTROL, invalidate() stubbed out: ' + ctl.bumped + '/' + ctl.beats + ' lone beats bumped');
    if (ctl.bumped !== 0) fail('the control still bumped — this check cannot detect a missing hook');
    else ok('control reads 0/' + ctl.beats + ' — the check can fail, so the 16/16 above means something');
  }
}

/* ══ B. P3 DECLUTTER, AGAINST THE PRE-FIX BEHAVIOUR ══════════════════════ */
console.log('\nB  P3 DECLUTTER — how much of each badge is buried under other badges');
{
  const r = await page.evaluate(() => {
    const nc = window.__nc, I = window.MythicPlotIcons, { renderer, scene, camera } = nc.three();
    nc.plotIconLayer(true);
    const T = I.tuning;
    /* Project the LIVE geometry the way the renderer will, and measure box
       overlap in NDC. This is geometry, not pixels, on purpose: forty
       overlapping alpha-blended badges do not decompose in a framebuffer diff,
       and the boxes ARE what the declutter decides on. */
    /* 🔴 THE CONTROL MUST FORCE THE BILLBOARD TO REBUILD, AND THE FIRST CUT DID
       NOT. faceCamera() is gated on `camSig` — the camera basis plus the data
       signature — so changing MOOD.declutter and re-rendering measures the
       PREVIOUS pass's geometry and reports the two arms as identical. That is
       the same class of mistake as reading the framebuffer a task late: a
       confident number describing the state before the change. Jogging the
       camera away and back moves the signature twice and leaves the camera
       exactly where it was, so both arms are measured at the SAME viewpoint. */
    const jog = () => {
      const p = camera.position.clone();
      camera.position.set(p.x + 7, p.y + 5, p.z + 7); camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
      camera.position.copy(p); camera.updateMatrixWorld(true);
    };
    const measure = () => {
      jog();
      renderer.render(scene, camera);        // onBeforeRender -> faceCamera -> declutter
      const g = I.mesh().geometry;
      const pos = g.attributes.position.array;
      const idx = g.index.array;
      const n = g.drawRange.count / 6;
      const pv = new (nc.three().THREE.Matrix4)().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const V = nc.three().THREE.Vector3;
      const boxes = [];
      for (let s = 0; s < n; s++) {
        const q = idx[s * 6] ;               // vertex 0 of this quad
        const a = new V(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]).applyMatrix4(pv);
        const c = new V(pos[(q + 2) * 3], pos[(q + 2) * 3 + 1], pos[(q + 2) * 3 + 2]).applyMatrix4(pv);
        boxes.push([Math.min(a.x, c.x), Math.min(a.y, c.y), Math.max(a.x, c.x), Math.max(a.y, c.y)]);
      }
      const covered = boxes.map((b, i) => {
        const area = (b[2] - b[0]) * (b[3] - b[1]);
        if (!(area > 0)) return 1;
        let t = 0;
        boxes.forEach((o, j) => {
          if (i === j) return;
          const ox = Math.min(b[2], o[2]) - Math.max(b[0], o[0]);
          const oy = Math.min(b[3], o[3]) - Math.max(b[1], o[1]);
          if (ox > 0 && oy > 0) t += (ox * oy) / area;
        });
        return Math.min(1, t);
      }).sort((p, q2) => p - q2);
      return { drawn: n, flagged: I.drawn().length, culled: I.culled(),
               median: covered.length ? covered[Math.floor(covered.length / 2)] : 0,
               over90: covered.filter(v => v > 0.9).length };
    };
    const after = measure();
    const keep = T.declutter;
    T.declutter = 99;                        // the SHIPPED-BEFORE behaviour
    const before = measure();
    T.declutter = keep;
    const back = measure();                  // and back again — a drifted run says so
    return { before, after, back };
  });
  console.log('   control (declutter disabled = the shipped-before layer):');
  console.log('     badges drawn ' + r.before.drawn + '/' + r.before.flagged +
              ' · median badge covered ' + pct(r.before.median) + ' · >90% covered: ' + r.before.over90);
  console.log('   with the declutter:');
  console.log('     badges drawn ' + r.after.drawn + '/' + r.after.flagged +
              ' (culled ' + r.after.culled + ') · median covered ' + pct(r.after.median) +
              ' · >90% covered: ' + r.after.over90);
  console.log('   restored          : drawn ' + r.back.drawn + ' · median ' + pct(r.back.median));
  if (r.before.flagged < 8) fail('too few badges to be a dense-block measurement (' + r.before.flagged + ')');
  else if (!(r.after.median < r.before.median)) fail('the declutter did not reduce burial (' + pct(r.after.median) + ' vs ' + pct(r.before.median) + ')');
  else ok('median burial ' + pct(r.before.median) + ' -> ' + pct(r.after.median));
  if (r.after.over90 >= r.before.over90 && r.before.over90 > 0) fail('badges >90% buried did not fall');
  else ok('badges more than 90% buried: ' + r.before.over90 + ' -> ' + r.after.over90);
  if (r.after.drawn < 1) fail('the declutter hid EVERYTHING — the worst plot must always survive');
  else ok(r.after.drawn + ' badges still on screen — the layer did not delete itself');
}

/* ══ C. P3 DEPTH ORDER, AT TWO CAMERAS ═══════════════════════════════════ */
console.log('\nC  P3 DEPTH ORDER — does a FARTHER badge ever paint over a NEARER one?');
{
  const r = await page.evaluate(() => {
    const nc = window.__nc, I = window.MythicPlotIcons, { renderer, scene, camera } = nc.three();
    const THREE = nc.three().THREE;
    const shoot = (cx, cy, cz) => {
      camera.position.set(cx, cy, cz); camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);       // the billboard + declutter rebuild
      const g = I.mesh().geometry;
      const pos = g.attributes.position.array;
      const idx = g.index.array;
      const n = g.drawRange.count / 6;
      const pv = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const rec = [];
      for (let s = 0; s < n; s++) {
        const q = idx[s * 6];
        const ax = pos[q * 3], ay = pos[q * 3 + 1], az = pos[q * 3 + 2];
        const cX = pos[(q + 2) * 3], cY = pos[(q + 2) * 3 + 1], cZ = pos[(q + 2) * 3 + 2];
        const mx = (ax + cX) / 2, my = (ay + cY) / 2, mz = (az + cZ) / 2;
        const d = Math.hypot(mx - camera.position.x, my - camera.position.y, mz - camera.position.z);
        const A = new THREE.Vector3(ax, ay, az).applyMatrix4(pv);
        const C = new THREE.Vector3(cX, cY, cZ).applyMatrix4(pv);
        rec.push({ order: s, dist: d,
                   b: [Math.min(A.x, C.x), Math.min(A.y, C.y), Math.max(A.x, C.x), Math.max(A.y, C.y)] });
      }
      let pairs = 0, wrong = 0;
      for (let i = 0; i < rec.length; i++) for (let j = i + 1; j < rec.length; j++) {
        const a = rec[i], b = rec[j];
        const ox = Math.min(a.b[2], b.b[2]) - Math.max(a.b[0], b.b[0]);
        const oy = Math.min(a.b[3], b.b[3]) - Math.max(a.b[1], b.b[1]);
        if (!(ox > 0 && oy > 0)) continue;
        const area = Math.min((a.b[2] - a.b[0]) * (a.b[3] - a.b[1]), (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]));
        if (!(area > 0) || (ox * oy) / area < 0.05) continue;   // "significantly overlapping"
        pairs++;
        // Later in the index buffer paints ON TOP (depthTest is off).
        const later = a.order > b.order ? a : b, earlier = a.order > b.order ? b : a;
        if (later.dist > earlier.dist + 1e-4) wrong++;
      }
      /* THE CONTROL, AND C IS UNFALSIFIABLE WITHOUT IT. Rewrite the index
         buffer in the PRE-FIX order — identity, i.e. apply()'s (score, x, z),
         arbitrary with respect to the camera — and count the same pairs again.
         No render between: `rec` already holds the projected boxes and the
         distances, and only the paint ORDER is being changed, so re-rendering
         would just let faceCamera put the sorted order back. */
      const byQuad = rec.slice().sort((a, b) => idx[a.order * 6] - idx[b.order * 6]);
      let cPairs = 0, cWrong = 0;
      for (let i = 0; i < byQuad.length; i++) for (let j = i + 1; j < byQuad.length; j++) {
        const a = byQuad[i], b = byQuad[j];
        const ox = Math.min(a.b[2], b.b[2]) - Math.max(a.b[0], b.b[0]);
        const oy = Math.min(a.b[3], b.b[3]) - Math.max(a.b[1], b.b[1]);
        if (!(ox > 0 && oy > 0)) continue;
        const area = Math.min((a.b[2] - a.b[0]) * (a.b[3] - a.b[1]), (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]));
        if (!(area > 0) || (ox * oy) / area < 0.05) continue;
        cPairs++;
        // i<j in vertex order == painted earlier, so j paints over i.
        if (b.dist > a.dist + 1e-4) cWrong++;
      }
      return { n: rec.length, pairs, wrong, cPairs, cWrong };
    };
    const cam0 = shoot(20, 22, 20);
    const cam1 = shoot(-30, 22, -30);
    return { cam0, cam1 };
  });
  for (const [name, v] of [['cam [20,22,20]', r.cam0], ['cam [-30,22,-30]', r.cam1]]) {
    console.log('   ' + name.padEnd(18) + ' badges ' + v.n + ' · significantly-overlapping pairs ' + v.pairs +
                ' · FAR-over-NEAR: ' + v.wrong +
                '   [control, pre-fix index order: ' + v.cWrong + '/' + v.cPairs + ']');
    if (v.wrong > 0) fail(name + ': ' + v.wrong + ' pairs paint a farther badge over a nearer one');
    else if (v.cPairs && v.cWrong === 0) console.log('     ~ the control is also 0 here — this camera cannot distinguish the two orders');
    else ok(name + ': every overlapping pair paints near-over-far (control got ' + v.cWrong + ' wrong)');
  }
}

/* ══ D. FRAME COST ═══════════════════════════════════════════════════════ */
console.log('\nD  FRAME COST, layer OFF vs ON — read together, before any capture');
{
  const r = await page.evaluate(() => {
    const nc = window.__nc, I = window.MythicPlotIcons, { renderer, scene, camera } = nc.three();
    const read = () => { renderer.info.reset(); renderer.render(scene, camera);
      return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; };
    I.hide(); const off = read();
    I.show(); const on = read();
    /* ⚠ WARM UP FIRST, AND INTERLEAVE. The first cut timed OFF then ON, cold,
       and reported the layer making the frame 39% FASTER — shader compiles and
       buffer uploads landing in the OFF sample. Thirty warm renders in each
       state, then A/B/A/B so any remaining drift shows up as disagreement
       between the two A samples rather than as a result. */
    const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) renderer.render(scene, camera); return (performance.now() - t0) / n; };
    I.hide(); time(30); I.show(); time(30);
    I.hide(); const tOff1 = time(40);
    I.show(); const tOn1 = time(40);
    I.hide(); const tOff2 = time(40);
    I.show(); const tOn2 = time(40);
    const tOff = (tOff1 + tOff2) / 2, tOn = (tOn1 + tOn2) / 2;
    const drift = Math.abs(tOff1 - tOff2) / Math.max(1e-9, tOff);
    return { off, on, tOff, tOn, tOff1, tOff2, drift, cost: I.cost(), stats: I.sync() };
  });
  console.log('   draw calls : OFF ' + r.off.calls + '  ON ' + r.on.calls + '   (delta ' + (r.on.calls - r.off.calls) + ')');
  console.log('   triangles  : OFF ' + r.off.tris + '  ON ' + r.on.tris + '   (delta ' + (r.on.tris - r.off.tris) + ')');
  console.log('   ms/frame   : OFF ' + r.tOff.toFixed(2) + '  ON ' + r.tOn.toFixed(2) +
              '   (delta ' + (r.tOn - r.tOff).toFixed(2) + ' ms, ' + pct((r.tOn - r.tOff) / r.tOff) + ')');
  console.log('   the two OFF samples: ' + r.tOff1.toFixed(2) + ' / ' + r.tOff2.toFixed(2) +
              ' ms — drift ' + pct(r.drift) + (r.drift > Math.abs(r.tOn - r.tOff) / r.tOff
                ? '  ⚠ drift exceeds the effect: the timing is noise, read the draw calls instead' : ''));
  console.log('   cost() says: ' + JSON.stringify(r.cost));
  if (r.on.calls - r.off.calls !== 1) fail('the layer is not one draw call (delta ' + (r.on.calls - r.off.calls) + ')');
  else ok('exactly ONE extra draw call');
  if (r.on.tris - r.off.tris !== r.cost.quads * 2) fail('cost() over/under-reports triangles: says ' + r.cost.quads * 2 + ', renderer says ' + (r.on.tris - r.off.tris));
  else ok('cost() triangles agree with renderer.info (' + (r.on.tris - r.off.tris) + ') — declutter is counted');
}

/* ══ E. P1 CAMP CARD ═════════════════════════════════════════════════════ */
console.log('\nE  P1 CAMP CARD — the two blocks, one supply, one instant');
{
  const r = await page.evaluate(async () => {
    const nc = window.__nc;
    let roster = null;
    try { roster = await nc.campRosterRefresh(); } catch (e) { roster = { threw: String(e) }; }
    const rowsOf = (sel) => Array.from(document.querySelectorAll(sel)).map(d => ({
      name: d.querySelector('span:first-child').textContent.trim(),
      val: d.querySelector('span:last-child').textContent.trim(),
      cls: d.querySelector('span:last-child').className }));
    const card = document.getElementById('campcard');
    const txt = card ? card.textContent : '';
    return { up: rowsOf('#campup .urow'), burn: rowsOf('#camproster .crb'),
             ready: roster && roster.ready, why: roster && roster.why,
             camps: roster && roster.camps ? roster.camps.length : 0,
             note: (document.querySelector('#camproster .crnote') || {}).textContent || '',
             badge: document.querySelectorAll('#campup .bad, #campup .hold').length,
             nan: /\bNaN\b/.test(txt), undef: /\bundefined\b/.test(txt),
             choke: nc.stashChoke ? !!nc.stashChoke() : false };
  });
  console.log('   roster: ready=' + r.ready + ' why=' + r.why + ' camps=' + r.camps);
  if (r.note) console.log('   empty-state text: "' + r.note.slice(0, 120).trim() + '"');
  console.log('   #campup rows      : ' + r.up.map(o => o.name + ' [' + o.cls + '] ' + o.val).join(' | '));
  console.log('   roster burn rows  : ' + (r.burn.length ? r.burn.map(o => o.name + ' [' + o.cls + '] ' + o.val).join(' | ') : '(none — no camps)'));
  console.log('   rail badge counts : ' + r.badge + ' · stash choke active: ' + r.choke);
  if (r.nan || r.undef) fail('the camp card prints NaN/undefined');
  else ok('no NaN and no undefined anywhere in the card text');
  if (!r.ready && !r.why) fail('the roster is not ready and does not say why');
  else ok(r.ready ? 'roster answered ready' : 'roster degraded honestly, named state "' + r.why + '"');
  // The coupling: for every supply both blocks name, the class must agree in kind.
  const kind = (c) => (c === 'ok' || c === 'crmet') ? 'ok' : (c === 'hold' || c === 'crhold') ? 'hold' : 'bad';
  let mism = 0;
  for (const b of r.burn) { const u = r.up.find(o => o.name === b.name); if (u && kind(u.cls) !== kind(b.cls)) mism++; }
  if (r.burn.length && mism) fail(mism + ' supplies where #campup and the roster burn disagree in kind');
  else ok(r.burn.length ? 'both blocks agree in kind on all ' + r.burn.length + ' supplies' : 'no burn rows to couple (node empty) — nothing to disagree');
}

/* ══ E2. THE FOUR HONEST EMPTIES, AND THE AMBER VAULT HOLD ═══════════════ */
console.log('\nE2 P1 CAMP CARD — the degraded states, and the amber vault hold');
{
  /* THE FOUR NOT-READY STATES. The bar says the roster must show real rows or
     an honest empty NAMING why — this project has shipped fabricated demo rows
     before. Each state is driven through the shipped bridge seam and the card
     is read back, so a state that silently falls through to another state's
     wording (or to nothing) is visible. */
  const states = await page.evaluate(async () => {
    const nc = window.__nc, B = window.MythicCityBridge;
    const real = B.fetchCampRoster;
    const out = [];
    try {
      for (const why of ['no-hook', 'signed-out', 'no-node', 'unreachable']) {
        B.fetchCampRoster = async () => ({ ready: false, why: why, camps: [] });
        await nc.campRosterRefresh();
        const el = document.getElementById('camproster');
        out.push({ why: why, text: (el ? el.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 130),
                   rows: document.querySelectorAll('#camproster .crrow').length,
                   burn: document.querySelectorAll('#camproster .crb').length });
      }
      // …and ready:true with nobody on the node, which is a DIFFERENT answer.
      B.fetchCampRoster = async () => ({ ready: true, why: null, nodeId: 'node-x', camps: [] });
      await nc.campRosterRefresh();
      const el = document.getElementById('camproster');
      out.push({ why: 'empty-node', text: (el ? el.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 130),
                 rows: document.querySelectorAll('#camproster .crrow').length,
                 burn: document.querySelectorAll('#camproster .crb').length });
    } finally { B.fetchCampRoster = real; }
    return out;
  });
  for (const s of states) {
    console.log('   ' + s.why.padEnd(11) + ' rows=' + s.rows + ' burn=' + s.burn + '  "' + s.text + '"');
    if (s.rows) fail(s.why + ': invented ' + s.rows + ' roster row(s) in a not-ready state');
  }
  const words = new Set(states.map(s => s.text));
  if (words.size !== states.length) fail('two states print the same text — the player cannot tell them apart');
  else ok('all ' + states.length + ' empty states print distinct, named wording and zero invented rows');

  /* THE AMBER VAULT HOLD, DRIVEN THROUGH THE REAL THROTTLE. resourceHeadroom()
     is the bridge call _ledgerFree comes from; pinning it to 0 makes
     _stashSplit bite for real, which is the state the critique measured: farms
     working, prodPerMin clamped to ~0, and the row printing red 'build another
     farm' when the fix is storage. Nothing here writes _stashChoke — it is set
     by economyTick from the shipped path. */
  const hold = await page.evaluate(async () => {
    const nc = window.__nc, B = window.MythicCityBridge;
    const real = B.resourceHeadroom;
    const rowsOf = (sel) => Array.from(document.querySelectorAll(sel)).map(d => ({
      name: d.querySelector('span:first-child').textContent.trim(),
      val: d.querySelector('span:last-child').textContent.trim(),
      cls: d.querySelector('span:last-child').className,
      title: d.querySelector('span:last-child').getAttribute('title') || '' }));
    const read = () => ({ up: rowsOf('#campup .urow'), burn: rowsOf('#camproster .crb'),
                          choke: nc.stashChoke(),
                          food: (nc.prod && nc.prod().food) });
    B.fetchCampRoster = B.fetchCampRoster;
    await nc.campRosterRefresh();
    await nc.step(4, 8);
    const before = read();
    B.resourceHeadroom = async () => ({ free: 0, cap: 0, used: 0 });
    try { await nc.step(4, 8); } finally { /* restored below, after the read */ }
    const after = read();
    B.resourceHeadroom = real;
    return { before, after,
             mix: after.choke ? after.choke.mix : null };
  });
  const line = (o) => o.map(x => x.name + ' [' + x.cls + '] ' + x.val).join(' | ');
  console.log('   headroom normal : ' + line(hold.before.up));
  console.log('   headroom pinned 0: ' + line(hold.after.up));
  console.log('   stash choke now  : ' + JSON.stringify(hold.after.choke && {
    factor: +hold.after.choke.factor.toFixed(3), mixFood: hold.after.choke.mix && hold.after.choke.mix.food }));
  const amberUp = hold.after.up.filter(r => r.cls === 'hold');
  const amberBurn = hold.after.burn.filter(r => r.cls === 'crhold');
  if (!hold.after.choke) {
    console.log('   ~ the throttle did not bite in this run, so the amber state was not reached;');
    console.log('     the hold branch is therefore UNPROVEN by this driver, not proven absent.');
  } else if (!amberUp.length) {
    console.log('   ~ the throttle bit but no supply had a gross rate above its camp burn,');
    console.log('     so `hold` correctly did not fire. Conservative by design, not a pass for the branch.');
  } else {
    ok(amberUp.length + ' #campup row(s) went amber instead of red: ' + line(amberUp));
    if (amberUp.every(r => r.title)) ok('every amber row carries the reason at hover: "' + amberUp[0].title + '"');
    else fail('an amber row has no title — the player is shown a colour with no cause');
    if (hold.after.burn.length && amberBurn.length !== amberUp.length)
      fail('the two blocks disagree on which supplies are held (' + amberUp.length + ' vs ' + amberBurn.length + ')');
    else ok('both blocks agree on the held supplies');
  }

  /* THE THREE BRANCHES, DRIVEN EXACTLY. The vault choke needs real production,
     which needs population, which needs a serviced city — 4 pop on 18 houses in
     a starved harness is not a bug, it is the game. So the RULE is driven
     directly through __nc.campCoverVerdict, which is the same function both
     blocks paint from (see _campCoverState). This proves the branch exists and
     is correct; it does NOT prove the live throttle reaches it, and that is
     stated rather than blurred.
     ⚠ INCLUDING THE BOUNDARY. gross === need must read 'bad', not 'hold': a
       gross rate that exactly meets the burn has no surplus left to be held
       back, so blaming the vault there would be inventing the cause. */
  const rule = await page.evaluate(() => {
    const V = window.__nc.campCoverVerdict;
    return [
      ['covered outright       made 20  need 6 gross 0  ', V(20, 6, 0).cls, 'ok'],
      ['short, no gross figure made  0  need 6 gross 0  ', V(0, 6, 0).cls, 'bad'],
      ['short, gross covers it made  0  need 6 gross 18 ', V(0, 6, 18).cls, 'hold'],
      ['short, gross too small made  0  need 6 gross 3  ', V(0, 6, 3).cls, 'bad'],
      ['BOUNDARY gross == need made  0  need 6 gross 6  ', V(0, 6, 6).cls, 'bad'],
      ['exactly meets the need made  6  need 6 gross 0  ', V(6, 6, 0).cls, 'ok'],
      ['garbage in             made NaN need 6 gross NaN', V(NaN, 6, NaN).cls, 'bad'],
    ];
  });
  let ruleBad = 0;
  for (const [what, got, want] of rule) {
    console.log('   ' + what + ' -> ' + got + (got === want ? '' : '   EXPECTED ' + want));
    if (got !== want) ruleBad++;
  }
  if (ruleBad) fail(ruleBad + ' of ' + rule.length + ' coverage-rule cases are wrong');
  else ok('all ' + rule.length + ' coverage-rule cases correct, boundary and NaN included');

  /* …and the DOM must be showing what that model says. Same coupling claim as E,
     but with the MODEL on one side instead of the two DOM blocks on both — so a
     rule and a renderer that drifted together would still be caught. */
  const vsDom = await page.evaluate(() => {
    const model = window.__nc.campCover();
    const rows = Array.from(document.querySelectorAll('#campup .urow')).map(d => ({
      cls: d.querySelector('span:last-child').className,
      val: d.querySelector('span:last-child').textContent.trim() }));
    return { model: Object.fromEntries(Object.entries(model).map(([k, v]) => [k, v.cls])), rows };
  });
  console.log('   model says: ' + JSON.stringify(vsDom.model));
  const order = Object.keys(vsDom.model);
  let drift = 0;
  vsDom.rows.forEach((row, i) => { if (vsDom.model[order[i]] !== row.cls) drift++; });
  if (drift) fail(drift + ' #campup row(s) wear a class the model did not produce');
  else ok('every #campup row wears exactly the class __nc.campCover() reports');
}

/* ══ F. IT REACTS ════════════════════════════════════════════════════════ */
console.log('\nF  IT REACTS — place a building, lay a road, lay a pipe');
{
  const r = await page.evaluate(async () => {
    const nc = window.__nc, M = window.MythicPlotMood, I = window.MythicPlotIcons;
    const out = [];
    /* ⚠ THE SUBJECT MUST BE A TILE THE LAYER ACTUALLY DRAWS. The first cut put a
       lone house at 18,4 and then read a badge that was never on screen: MOOD.max
       is 40 and the block above is 42 plots, so a fresh house nowhere near the
       worst of them is withheld by the CAP, and anchorAt reports flagged=false
       for a reason that has nothing to do with reacting. The subject is the plot
       the verdict module currently ranks WORST — the one badge that survives
       every cap and every declutter by construction. */
    const worst = M.all().slice().sort((a, b) => a.score - b.score)[0];
    if (!worst) return [{ step: 'no judged plot', reason: null }];
    const HX = worst.x, HZ = worst.z;
    const snap = (step, extra) => {
      const m = M.moodAtKey(HX + ',' + HZ);
      return Object.assign({ step: step, reason: m && m.reason, score: m && +m.score.toFixed(4),
                             terms: m && m.terms ? JSON.parse(JSON.stringify(m.terms)) : null,
                             drawn: I.anchorAt(HX, HZ) }, extra || {});
    };
    out.push(snap('baseline at ' + HX + ',' + HZ));

    // 1. place a building beside it, through the SHIPPED tryPlace path
    await nc.place('housing', HX + 1, HZ + 1);
    try { nc.build.finishAll(); } catch (e) {}
    M.invalidate('driver');
    out.push(snap('place housing at ' + (HX + 1) + ',' + (HZ + 1)));

    // 2. lay a road beside it
    await nc.place('road', HX, HZ + 1);
    try { nc.build.finishAll(); } catch (e) {}
    M.invalidate('driver');
    out.push(snap('lay road at ' + HX + ',' + (HZ + 1)));

    // 3. lay a pipe under it, through /src/water's own drag tool
    const laid = nc.waterPipe(HX, HZ, HX, HZ + 5);
    M.invalidate('driver');
    // water is SOLVED inside economyTick, so give it the beat its module needs.
    await nc.ticks.economyTick(1 / 60);
    out.push(snap('lay ' + laid + ' pipe cells', {
      served: window.MythicWater ? window.MythicWater.servedAt(HX + ',' + HZ) : null }));
    return out;
  });
  let moved = 0, termMoves = 0;
  for (let i = 0; i < r.length; i++) {
    const s = r[i];
    console.log('   ' + (i ? i + '. ' : '   ') + String(s.step).padEnd(32) +
                ' reason "' + s.reason + '" score ' + s.score +
                ' · badge flagged=' + (s.drawn && s.drawn.flagged) + ' drawn=' + (s.drawn && s.drawn.drawn) +
                (s.served != null ? ' · servedAt=' + s.served : ''));
    if (s.terms) console.log('        terms ' + JSON.stringify(s.terms));
    if (!i) continue;
    if (s.reason !== r[i - 1].reason) moved++;
    const a = r[i - 1].terms || {}, b = s.terms || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) termMoves++;
  }
  if (!moved && !termMoves) fail('nothing about the verdict changed across a placement, a road and a pipe');
  else ok('the verdict moved: ' + moved + ' change(s) of winning reason and ' + termMoves +
          ' term change(s) across the three placements — in-session, no reload');
}

console.log('\nconsole/pageerror lines: ' + logs.filter(l => /error|pageerror|warn/i.test(l)).length);
logs.filter(l => /pageerror/i.test(l)).slice(0, 6).forEach(l => console.log('   ! ' + l));
logs.filter(l => /error|pageerror|warn/i.test(l)).slice(0, 8).forEach(l => console.log('   · ' + l));
console.log(fails ? '\n' + fails + ' FAILING CLAIM(S)' : '\nALL CLAIMS HELD');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
