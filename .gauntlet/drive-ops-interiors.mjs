/* ══════════════════════════════════════════════════════════════════════════
   🚪 DRIVE-OPS-INTERIORS — ONE INTERIOR LIST FOR OPERATIONS.

   THE BUG. "Does this operation have an interior?" was answered by THREE
   hand-kept lists that had all drifted apart:
       · index.html  OP_INTERIORS  = { cardshop, dojo, bank, restaurant }
                     — what cityOpsState stamped on the manifest;
       · index.html  cityEnterBusiness's `routes` = cardshop, dojo, bank,
                     medical, research — what the game could actually open;
       · node-city   OPS_INTERIORS = { cardshop, dojo, bank }
                     — what the inspector offered a button for.
   So a sited Medical Corp. read "Its own interior is not built yet" in the
   city while cityEnterBusiness('medical') would have opened the Hospital, and
   the manifest advertised `restaurant` at a route that answered 'no-interior'.

   THE FIX under test: cityEnterBusiness's routing table IS the list. Its keys
   are what the manifest stamps (_opInterior reads that very object), and
   node-city reads only the manifest's `interior` field.

   WHAT THIS MEASURES — four things a description could not:

   A. SET EQUALITY, BY CALLING BOTH SIDES. For every catalogued op type it
      compares "cityOpsState marked it" against "cityEnterBusiness routed it",
      the second measured by INVOKING cityEnterBusiness and watching where it
      landed — App.screen for the three screen doors, and a spy on
      MythicHospital / MythicContainment / MythicCityBridge.openKitchen for the
      three overlay doors. Nothing is read out of the source text.
      ⚠ THE OVERLAY MODULES ARE STUBBED, and that is the point of the phase:
        a route that "works" only because /src/hospital happened to load is not
        what is being tested — WHICH FUNCTION IS REACHED is.

   B. THE NEGATIVE. mining/oil/gas/agri/... must be marked `interior: null` AND
      answer 'no-interior'. A list that simply said yes to everything passes A
      and fails here.

   C. THE DRIVE, IN THE REAL IFRAME. A Medical Corp. row is sited into the open
      city, the tile is planted, the inspector is opened on it, and the
      assertion is on the DOM: #ops-enter exists, says ENTER BUSINESS, and its
      note names the Hospital. Then it is CLICKED and the hospital spy must
      fire with the city torn down — the door, not the label.

   D. THE CONTROL, IN THE SAME PANEL. A Mining Co. sited two tiles over gets no
      #ops-enter at all, so "the button is there" is measured against a state
      where it must not be.

   ⚠ AND IT PROVES IT CAN FAIL. `--negate` deletes the `medical` entry from the
     live OP_INTERIOR_ROUTES before anything is measured — the exact regression
     this piece fixed — and the run must go RED. A green --negate means the
     drive is not looking at what it claims to.

   Run:  node .gauntlet/drive-ops-interiors.mjs
         node .gauntlet/drive-ops-interiors.mjs --negate     (must go red)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.txt': 'text/plain', '.glb': 'model/gltf-binary', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 9200 + (process.pid % 180);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const NEGATE = process.argv.includes('--negate');
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };

/* ── PHASE 0: the source claim. The city must carry no interior list of its
   own — this is the grep from the piece's judge, run where it cannot rot. ── */
const NC = fs.readFileSync(path.join(ROOT, 'node-city', 'index.html'), 'utf8');
const GAME = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ncOwnList = (NC.match(/OPS_INTERIORS/g) || []).length;
ok(ncOwnList === 0, 'node-city still mentions OPS_INTERIORS ×' + ncOwnList);
ok(/opsInteriorOf/.test(NC), 'node-city has no opsInteriorOf() — nothing reads the manifest');
ok(/row\.interior/.test(NC) && /c\.interior/.test(NC), 'node-city does not read row.interior / catalog.interior');
ok(!/const OP_INTERIORS\s*=/.test(GAME), 'index.html still declares a second OP_INTERIORS list');
ok(/const OP_INTERIOR_ROUTES\s*=/.test(GAME), 'index.html has no OP_INTERIOR_ROUTES table');

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
/* Everything off-box is 502'd: this drives the client's own logic, and a real
   network call would make the run depend on the live database.
   ⚠ EXCEPT cdn.jsdelivr.net, which is where node-city's importmap pins three
     0.171.0. Blocking it does not "test offline" — the city's whole module
     never evaluates, so __nc never appears and there is no inspector to drive.
     drive-city-bank-doors carries the same exception for the same reason. */
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1:' + P) || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.fulfill({ status: 502, contentType: 'text/plain', body: '// offline' });
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof window.cityOpsState === "function" && typeof window.cityEnterBusiness === "function"',
  null, { timeout: 180000 });

/* Break it on purpose, before anything is read. OP_INTERIOR_ROUTES is a
   top-level `const` in a classic script — not on window — but a driver body
   runs in page scope, so the binding resolves and its properties are mutable. */
if (NEGATE) await pg.evaluate(() => { delete OP_INTERIOR_ROUTES.medical; });

/* ── PHASES A + B: the two sets, both measured by calling. ─────────────── */
const A = await pg.evaluate(async () => {
  const o = { marked: [], routed: [], landed: {} };
  try { Profile.cloud = Profile.cloud || {}; Profile.cloud.signedIn = false; } catch (e) {}
  try { Profile.jbLocalOps = []; Operations.list = []; Operations.fetchFailed = false; } catch (e) {}

  const st = window.cityOpsState();
  o.types = st.catalog.map(c => c.type);
  o.marked = st.catalog.filter(c => c.interior).map(c => c.type);
  // The field must be the TYPE, not `true` — the city hands it straight back.
  o.markedShapeOk = st.catalog.filter(c => c.interior).every(c => c.interior === c.type);

  /* Stub every overlay door so "routed" means "reached ITS function", never
     "the module happened to load". Saved and restored around the phase. */
  const hit = {};
  const prev = { H: window.MythicHospital, W: window.MythicWard, C: window.MythicContainment,
                 K: window.MythicCityBridge && window.MythicCityBridge.openKitchen };
  window.MythicHospital = { open: () => { hit.hospital = true; } };
  window.MythicWard = { open: () => { hit.ward = true; } };
  window.MythicContainment = { openLab: () => { hit.lab = true; } };
  try { window.MythicCityBridge.openKitchen = () => { hit.kitchen = true; return true; }; } catch (e) {}
  const screen0 = App.screen;

  for (const t of o.types) {
    for (const k in hit) delete hit[k];
    let r = null;
    try { r = window.cityEnterBusiness(t); } catch (e) { r = { ok: false, error: 'threw:' + e }; }
    const where = App.screen !== screen0 ? ('screen:' + App.screen) : Object.keys(hit).join(',');
    App.screen = screen0;
    if (r && r.ok) { o.routed.push(t); o.landed[t] = where || '(nothing)'; }
    else if (!r || r.error !== 'no-interior') o.landed[t] = 'odd:' + JSON.stringify(r);
  }
  window.MythicHospital = prev.H; window.MythicWard = prev.W; window.MythicContainment = prev.C;
  try { if (prev.K) window.MythicCityBridge.openKitchen = prev.K; } catch (e) {}
  try { render(); } catch (e) {}

  // A row carries the same field as the catalog entry, from the same read.
  o.unknownRouted = (() => { const r = window.cityEnterBusiness('not-a-business'); return !!(r && r.ok); })();
  o.protoRouted = (() => { const r = window.cityEnterBusiness('constructor'); return !!(r && r.ok); })();
  return o;
});

const WANT = ['cardshop', 'dojo', 'bank', 'medical', 'research', 'restaurant'].sort().join(',');
ok(A.marked.slice().sort().join(',') === WANT, 'manifest marks [' + A.marked.sort().join(',') + '], want [' + WANT + ']');
ok(A.routed.slice().sort().join(',') === WANT, 'cityEnterBusiness routes [' + A.routed.sort().join(',') + '], want [' + WANT + ']');
ok(A.markedShapeOk, 'a catalog entry stamped `interior` that is not its own type');
// B — the negative. Every non-interior type must be silent on both sides.
for (const t of A.types) {
  if (WANT.split(',').includes(t)) continue;
  ok(!A.marked.includes(t), t + ' is marked with an interior it has no route for');
  ok(!A.routed.includes(t), t + ' routed somewhere despite carrying no interior');
}
ok(!A.unknownRouted, 'an unknown op type routed instead of answering no-interior');
ok(!A.protoRouted, "op type 'constructor' resolved up the prototype chain and routed");
// …and each door must land in ITS room, not merely return ok.
const LAND = { cardshop: 'screen:cardShop', dojo: 'screen:dojoShop', bank: 'screen:bankDesk',
               medical: 'hospital', research: 'lab', restaurant: 'kitchen' };
for (const t in LAND) ok(A.landed[t] === LAND[t], t + ' landed at "' + A.landed[t] + '", want "' + LAND[t] + '"');

/* ── PHASES C + D: the real iframe, a sited Medical Corp. and a control. ── */
const C = await pg.evaluate(async () => {
  const o = {}; const sleep = ms => new Promise(r => setTimeout(r, ms));
  const NODE = 'drv-ops-int';
  /* The open gate wants one of: I own the land, I am its mayor, or a city of
     mine already stands there (App._myCityNodes, from city_state). Offline
     there is no land and no appointment, so the third door is the one a driver
     can honestly use — and it is the OWNER path, which is what this measures:
     `manager` false, the manifest is mine. */
  try { Profile.campNodeId = NODE; App._myCityNodes = [NODE]; } catch (e) {}
  const row = (type, x, y) => ({
    id: 'drv_' + type, corp_id: 'local', op_type: type, level: 1, workers: 4, status: 'active',
    created_at: new Date().toISOString(),
    meta: { localOnly: true, lastCollect: Date.now(), site: { nodeId: NODE, x, y, rot: 0, sitedAt: Date.now(), eff: 1 } },
  });
  try { Profile.jbLocalOps = [row('medical', 9, 9), row('mining', 11, 9)]; } catch (e) {}
  const st = window.cityOpsState();
  o.rowInterior = (st.ops.find(r => r.type === 'medical') || {}).interior;
  o.miningRowInterior = (st.ops.find(r => r.type === 'mining') || {}).interior;

  // Spy on the hospital for the click at the end of the phase.
  window.__drvHit = {};
  window.MythicHospital = { open: () => { window.__drvHit.hospital = true; } };

  try { _openNodeCity(NODE); } catch (e) { o.openErr = String(e).slice(0, 120); }
  for (let i = 0; i < 60 && !document.getElementById('node-city-frame'); i++) await sleep(200);
  const fr = document.getElementById('node-city-frame');
  o.cityOpened = !!fr;
  if (!fr) return o;
  const w = fr.contentWindow;
  for (let i = 0; i < 150; i++) { if (w.__nc && w.__nc.ops && w.__nc.ops.booted && w.__nc.ops.booted()) break; await sleep(300); }
  o.opsBooted = !!(w.__nc && w.__nc.ops && w.__nc.ops.booted && w.__nc.ops.booted());
  if (!o.opsBooted) return o;

  await w.__nc.ops.refresh(true);
  // Plant both buildings on their sited squares — the tile the reconcile pass
  // would restore, finished, so nothing here waits out a build timer.
  const kMed = '9,9', kMine = '11,9';
  w.__nc.jobfair.plant(kMed, 'op_medical');
  w.__nc.jobfair.plant(kMine, 'op_mining');
  o.medRowSeen = !!w.__nc.ops.rowAt(9, 9, 'medical');

  const act = w.__nc.ops.action(kMed);
  o.actLabel = act && act.label;
  o.actInterior = act && act.interior;
  o.actNote = act && act.note;

  // The DOM, not the object: this is what a player clicks.
  w.__nc.inspect(kMed);
  await sleep(300);
  const btn = w.document.getElementById('ops-enter');
  o.btn = !!btn;
  o.btnText = btn ? (btn.textContent || '').trim() : null;
  o.panelText = (w.document.getElementById('ops-inspect') || {}).textContent || '';

  /* D — the control, same panel machinery, a type with no interior. The button
     is the assertion: opsAugmentInspect renders the note only alongside a
     label, so a door-less operation is measured by #ops-enter being ABSENT and
     by the action itself carrying no label and no interior. */
  const mineAct = w.__nc.ops.action(kMine);
  o.mineLabel = mineAct && mineAct.label;
  o.mineInterior = (mineAct && mineAct.interior) || null;
  o.mineNote = mineAct && mineAct.note;
  w.__nc.inspect(kMine);
  await sleep(300);
  o.mineBtn = !!w.document.getElementById('ops-enter');
  o.minePanel = ((w.document.getElementById('ops-inspect') || {}).textContent || '').slice(0, 90);

  // …and back to the hospital, and CLICK it.
  w.__nc.inspect(kMed);
  await sleep(300);
  const btn2 = w.document.getElementById('ops-enter');
  if (btn2) btn2.click();
  await sleep(1400);
  o.hospitalOpened = !!window.__drvHit.hospital;
  o.cityTornDown = !document.getElementById('node-city-frame');
  return o;
});

ok(C.rowInterior === 'medical', 'a sited Medical Corp. row carries interior "' + C.rowInterior + '"');
ok(C.miningRowInterior === null, 'the Mining Co. row carries an interior: ' + C.miningRowInterior);
ok(C.cityOpened, 'the city iframe never opened: ' + (C.openErr || ''));
ok(C.opsBooted, 'the city ops layer never finished its boot reconcile');
ok(C.medRowSeen, 'the city could not match the sited Medical Corp. row to its tile');
ok(C.actLabel === '🚪 ENTER BUSINESS', 'inspector action label is ' + JSON.stringify(C.actLabel));
ok(C.actInterior === 'medical', 'inspector action carries interior ' + JSON.stringify(C.actInterior));
ok(/Hospital/.test(C.actNote || ''), 'the note does not name the Hospital: ' + JSON.stringify(C.actNote));
ok(C.btn, 'no #ops-enter button in the rendered panel for a sited Medical Corp.');
ok(/ENTER BUSINESS/.test(C.btnText || ''), 'the button reads ' + JSON.stringify(C.btnText));
ok(!C.mineBtn, 'a Mining Co. got an ENTER BUSINESS button it has no interior for');
ok(!C.mineLabel, 'the Mining Co. action carries a button label: ' + JSON.stringify(C.mineLabel));
ok(!C.mineInterior, 'the Mining Co. action carries an interior: ' + JSON.stringify(C.mineInterior));
ok(/not built yet/.test(C.mineNote || ''), 'the Mining Co. note does not say its interior is unbuilt: ' + JSON.stringify(C.mineNote));
ok(C.hospitalOpened, 'clicking ENTER BUSINESS did not open the Hospital');
ok(C.cityTornDown, 'the city was still standing over the Hospital after the click');

const hard = errs.filter(e => !/502|Failed to fetch|NetworkError|ERR_/.test(e));
ok(hard.length === 0, 'page errors: ' + hard.slice(0, 3).join(' | '));

await b.close(); srv.close();
console.log('marked  :', A.marked.join(','));
console.log('routed  :', A.routed.join(','));
console.log('landed  :', JSON.stringify(A.landed));
console.log('drive   :', JSON.stringify({ btn: C.btn, btnText: C.btnText, interior: C.actInterior,
  note: C.actNote, hospitalOpened: C.hospitalOpened, cityTornDown: C.cityTornDown }));
console.log('control :', JSON.stringify({ mineBtn: C.mineBtn, mineLabel: C.mineLabel,
  mineInterior: C.mineInterior, mineNote: C.mineNote }));
if (NEGATE) {
  console.log('\n[--negate] the medical route was deleted; failures seen: ' + fail.length);
  for (const f of fail) console.log('  · ' + f);
  if (!fail.length) { console.log('❌ --negate went GREEN — the drive is not measuring what it claims.'); process.exit(1); }
  console.log('✅ --negate went red, as it must.');
  process.exit(0);
}
if (fail.length) { console.log('\n❌ FAIL ×' + fail.length); for (const f of fail) console.log('  · ' + f); process.exit(1); }
console.log('\n✅ ONE INTERIOR LIST — manifest set == route set, and the Hospital opens from a sited Medical Corp.');
