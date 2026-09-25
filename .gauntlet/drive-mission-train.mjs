/* ══════════════════════════════════════════════════════════════════════════
   🚂 DRIVE-MISSION-TRAIN — the mobile base that makes the map a POSITION.

   Asked for: a train as the main factor alongside the mission map.

   🔴 WHAT IT IS FOR, AND WHAT THIS DRIVER THEREFORE PINS. Without the train
      every district is one click away and the map is a list with a nicer
      background — you pick the weakest district and never think about the
      board again. The train can only deploy where it is PARKED or NEXT DOOR,
      so taking the north of the city means moving there, one district at a
      time, while the factions push into the ground you are crossing.
      Every assertion below is about that gate actually biting.

   ⚠ FUEL IS NOT AN EIGHTH CURRENCY. It was already in the map's own fiction
     (poi.js prints `haul:'fuel · medicine · corrupted essence'` on the
     district panel), it lives on the train, and nothing else in the game can
     see or spend it.

   Run:  node .gauntlet/drive-mission-train.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9680 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};
{
  const t = fs.readFileSync(path.join(ROOT, 'src', 'missions', 'train.js'), 'utf8');
  const poi = fs.readFileSync(path.join(ROOT, 'src', 'missions', 'poi.js'), 'utf8');
  const re  = fs.readFileSync(path.join(ROOT, 'src', 'missions', 'render.js'), 'utf8');
  const artRel = (t.match(/art: '([^']+)'/) || [])[1] || '';
  const artAbs = artRel ? path.join(ROOT, artRel) : '';
  out.src = {
    artExists: !!(artAbs && fs.existsSync(artAbs)),
    artKB: (artAbs && fs.existsSync(artAbs)) ? Math.round(fs.statSync(artAbs).size / 1024) : 0,
    /* 🚂 THE MODEL IS WIRED — and this pins the CLAIM, not the placeholder.
       It used to assert `art: null`, which was true only while no model
       existed; the moment the owner's Cosmic Steamliner landed, a correct
       change failed the build. What matters is that the slot points at a file
       that IS THERE, that the file is small enough to deploy, and that the
       vector train still draws when it is not. */
    artPath: (t.match(/art: '([^']+)'/) || [])[1] || null,
    drawsWithoutArt: /const hasArt = !!\(art && art\.complete && art\.naturalWidth\)/.test(t),
    /* 🚂 THE JOURNEY IS DRAWN ON THE FX CANVAS, and that is the whole trick:
       the city canvas paints once per render() — fine for a marker that
       teleports, useless for one that travels — while the fx canvas already
       runs a requestAnimationFrame loop for the embers and ash and sits ABOVE
       the city in the stack. No second loop to start, stop or leak. */
    drawnOnFxLoop: /drawTrainMarker\(ctx, t\);/.test(re) && !/drawTrainMarker\(ctx\);/.test(re),
    /* ⚠ interpolated in the CITY's coords and projected per frame — doing it in
       screen space would make the train jump if the map resized mid-journey */
    interpolatesInWorldSpace: /ax = a\.ax \+ \(b\.ax - a\.ax\) \* e;/.test(re),
    /* ⚠ prefers-reduced-motion stops the ambient drift after one frame, which is
       right for ash and wrong for a train the player just told to move: a
       journey is a response to an action, not decoration. */
    journeyOutlivesReducedMotion: /if \(!still \|\| trainTrip\) requestAnimationFrame\(frame\);/.test(re),
    /* fuel was already the map's own fiction, not a new currency */
    fuelWasAlreadyInTheFiction: /haul:'fuel/.test(poi),
  };
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1440, height: 950 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);

out.run = await pg.evaluate(async () => {
  const r = {};
  const M = window.MythicMissions;
  r.exposed = !!(M && M.train);
  if (!r.exposed) return r;
  /* local board, so the arithmetic is deterministic and nothing touches the
     shared city while a driver is poking at it */
  Cloud.ready = false; Cloud.client = null;
  M.state.debugReset();
  M.train.debugPark('chelsea'); M.train.debugFuel(6);
  App.screen = 'rlcList'; render();
  await new Promise(x => setTimeout(x, 900));

  r.mapStillMounts = !!document.querySelector('.msn');
  r.at = M.train.at();
  r.fuel = M.train.fuel();
  r.reach = M.train.reachable().sort();

  const panel = () => ({
    deploy: !!document.getElementById('msn-go'),
    deployDisabled: !!(document.getElementById('msn-go') || {}).disabled,
    move: !!document.getElementById('msn-move'),
    text: (document.querySelector('.msn-panel') || {}).textContent || '',
  });
  const pick = async (id) => { M.select(id); render(); await new Promise(x => setTimeout(x, 450)); return panel(); };

  const parked = await pick('chelsea');
  r.parked = { deployable: parked.deploy && !parked.deployDisabled, offersMove: parked.move,
               saysParked: /Parked here/.test(parked.text) };
  const near = await pick('village');
  r.adjacent = { deployable: near.deploy && !near.deployDisabled, offersMove: near.move,
                 saysInReach: /In reach/.test(near.text) };
  /* 🔴 THE GATE. A district across the city must be refused — and must SAY so. */
  const far = await pick('harlem');
  r.far = { deployRefused: far.deploy && far.deployDisabled, noMove: !far.move,
            saysOutOfReach: /Out of reach/.test(far.text),
            explainsHow: /one district at a time/.test(far.text) };

  /* moving costs fuel and the reach follows the train */
  M.select('village'); render(); await new Promise(x => setTimeout(x, 400));
  const mv = document.getElementById('msn-move');
  r.moveButtonPresent = !!mv;
  if (mv) mv.click();
  await new Promise(x => setTimeout(x, 600));
  r.hopCost = M.train.TRAIN.HOP_COST;
  r.afterMove = { at: M.train.at(), fuel: M.train.fuel(), reach: M.train.reachable().sort() };
  r.fuelSpent = 6 - M.train.fuel();
  r.reachFollowed = M.train.reaches('soho') && !M.train.reaches('harlem');

  /* 🚂 THE JOURNEY, MEASURED OFF THE CANVAS ITSELF.
     Not "did a flag flip" — where the sprite's PIXELS are, twice, mid-flight.
     The train is opaque; the ash is a scatter of 1px dots at alpha ≲0.38 and
     the ember glow is fainter still, so thresholding at alpha > 200 isolates
     the locomotive from the weather around it. */
  const centroid = () => {
    const fx = document.getElementById('msn-fx');
    if (!fx) return null;
    const c = document.createElement('canvas'); c.width = fx.width; c.height = fx.height;
    c.getContext('2d').drawImage(fx, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      if (d[(y * c.width + x) * 4 + 3] > 200) { sx += x; sy += y; n++; }
    }
    return n > 40 ? { x: Math.round(sx / n), y: Math.round(sy / n), n } : null;
  };

  M.train.debugFuel(9); M.train.debugPark('chelsea');
  M.select('village'); render(); await new Promise(x => setTimeout(x, 500));
  r.restBefore = centroid();
  const mv2 = document.getElementById('msn-move');
  if (mv2) mv2.click();
  r.travellingImmediately = M.travelling();
  await new Promise(x => setTimeout(x, 220));
  r.midA = centroid();
  r.travellingMid = M.travelling();
  await new Promise(x => setTimeout(x, 330));
  r.midB = centroid();
  await new Promise(x => setTimeout(x, 900));
  r.restAfter = centroid();
  r.travellingAfter = M.travelling();
  /* it must have been somewhere ELSE in between, and ended somewhere else again */
  const dist = (a, b) => (a && b) ? Math.round(Math.hypot(a.x - b.x, a.y - b.y)) : -1;
  r.movedDuring = dist(r.midA, r.midB);
  r.movedOverall = dist(r.restBefore, r.restAfter);
  M.train.debugPark('village');

  /* 🔴 ONE DISTRICT AT A TIME — no teleporting across the city */
  /* the move result must not carry a day any more */
  M.train.debugFuel(9); M.train.debugPark('chelsea');
  /* 🔴 THE COST IS MEASURED HERE, NOT AROUND THE BUTTON CLICK, AND THAT IS THE
     FIX FOR A TEST THAT FAILED 2 RUNS IN 6 ON AN UNTOUCHED TREE.
     Clicking #msn-move runs the whole handler: the move AND the encounter roll
     that follows it. Encounters carry fuel — leak -1, ambush -2, scav +2,
     tanker +4 — so `6 - fuel()` after a click is the move PLUS a random
     number, and asserting it equals HOP_COST was only ever true when the roll
     happened to be fuel-neutral. train.move() is the move by itself.
     ⚠ The click is still driven below; what changed is which number the cost
       assertion reads. The button working and the move costing 2 are two
       different claims and were being made by one measurement. */
  const fuelBeforeDirect = M.train.fuel();
  const mp = M.train.move('village');
  r.directMoveCost = fuelBeforeDirect - M.train.fuel();
  r.movePayload = mp;
  r.movePayloadHasNoDay = !('day' in mp);
  M.train.debugPark('village');
  r.nonAdjacentRefused = M.train.moveCheck('harlem');
  /* …and no fuel means no move, with a reason the panel can print */
  M.train.debugFuel(0);
  r.noFuelRefused = M.train.moveCheck('soho');
  M.train.debugFuel(6);

  /* 🔴 A SURVIVED RAID REFUELS IT — and only a survived one. The engine writes
     rlcCompleted on a finalBoss clear and nowhere else, so this is the same
     poll that credits grip. */
  M.train.debugFuel(3);
  const P2 = window.MythicMissionBridge.profile();
  P2.rlcCompleted = ['msn_village_scum_20_1'];
  const before = M.train.fuel();
  M.state.creditRuns(P2.rlcCompleted);
  r.fuelFromRaid = { before, after: M.train.fuel() };
  /* …and crediting the same run twice must not refuel twice */
  M.state.creditRuns(P2.rlcCompleted);
  r.fuelAfterRepeat = M.train.fuel();
  return r;
});

await pg.close(); await b.close(); srv.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.src, R = out.run || {};

need('the model slot points at a file', typeof S.artPath === 'string' && !!S.artPath, S.artPath);
need('🔴 …and that file actually exists on disk', S.artExists === true, S.artPath);
/* 🔴 CLOUDFLARE ABORTS AN ENTIRE DEPLOY ON ONE ASSET OVER 25 MiB, which is why
   the supplied 37.8 MB .glb was baked to a sprite instead of shipped.
   public/.assetsignore carries that warning because production once sat
   frozen on a stale build for exactly this reason. */
need('🔴 …and is far under the 25 MiB per-asset cap that aborts deploys',
     S.artKB > 0 && S.artKB < 25 * 1024, S.artKB + ' KB');
need('…and the train draws without any art at all', S.drawsWithoutArt === true);
need('fuel was already the map\'s own fiction, not an eighth currency',
     S.fuelWasAlreadyInTheFiction === true);

need('SETUP: the train is on the module api', R.exposed === true, R);
need('🔴 the map still mounts with the train wired in', R.mapStillMounts === true, R);
need('SETUP: parked at Chelsea with fuel', R.at === 'chelsea' && R.fuel === 6, R);
need('reach is parked-or-adjacent, nothing wider',
     JSON.stringify(R.reach) === JSON.stringify(['chelsea', 'hells', 'midtown', 'village']), R.reach);

need('THE ASK: you can deploy where the train is parked', R.parked && R.parked.deployable === true, R.parked);
need('…and the panel says the train is there', R.parked && R.parked.saysParked === true, R.parked);
need('…and offers no pointless move to where it already is', R.parked && R.parked.offersMove === false, R.parked);
need('THE ASK: a neighbouring district is deployable AND offers the move',
     R.adjacent && R.adjacent.deployable === true && R.adjacent.offersMove === true, R.adjacent);

need('🔴 THE GATE: a district across the city REFUSES the deploy',
     R.far && R.far.deployRefused === true, R.far);
need('🔴 …and says so rather than greying out in silence',
     R.far && R.far.saysOutOfReach === true && R.far.explainsHow === true, R.far);

/* ⚠ SPENT === HOP_COST, not a hard-coded 5. The literal was written when a hop
   cost 1 fuel and a day; the day moved to the world clock and the fuel cost
   doubled, so a correct change failed on a number the driver had memorised
   rather than on the rule it meant to protect. */
need('THE ASK: moving the train costs fuel', R.afterMove && R.afterMove.at === 'village', R.afterMove);
/* …and the move itself costs exactly HOP_COST, measured off train.move() so a
   random encounter cannot make a correct move look like a wrong one. */
need('…exactly HOP_COST of it', R.directMoveCost === R.hopCost, { spent: R.directMoveCost, cost: R.hopCost });
/* The BUTTON is a separate claim: it moved the train and it charged something.
   The exact figure belongs to the assertion above; here an encounter may have
   added or burned fuel on top and that is the feature working, not a fault. */
need('the move button charges the tank', R.fuelSpent > 0, { spent: R.fuelSpent });
need('🔴 …and a move no longer spends a DAY — the day is the world\'s now',
     R.movePayloadHasNoDay === true, R.movePayload);
need('🔴 …and the reach FOLLOWS it — SoHo opens, Harlem stays shut', R.reachFollowed === true, R.afterMove);
need('🔴 no teleporting: a non-adjacent district is refused with a reason',
     R.nonAdjacentRefused && R.nonAdjacentRefused.ok === false && /one district at a time/.test(R.nonAdjacentRefused.why || ''),
     R.nonAdjacentRefused);
need('…and an empty tank is refused with a reason the panel can print',
     R.noFuelRefused && R.noFuelRefused.ok === false && /fuel/i.test(R.noFuelRefused.why || ''), R.noFuelRefused);

need('🔴 a SURVIVED raid brings fuel home', R.fuelFromRaid && R.fuelFromRaid.after > R.fuelFromRaid.before, R.fuelFromRaid);
need('🔴 CONTROL: crediting the same run twice refuels once',
     R.fuelAfterRepeat === (R.fuelFromRaid || {}).after, { once: (R.fuelFromRaid || {}).after, twice: R.fuelAfterRepeat });

need('🚂 the journey is drawn in the loop that already runs, not a second one',
     S.drawnOnFxLoop === true, S);
need('…interpolated in the city\'s own coords, so a resize cannot make it jump',
     S.interpolatesInWorldSpace === true, S);
need('…and a journey still animates under prefers-reduced-motion',
     S.journeyOutlivesReducedMotion === true, S);

need('SETUP: the train is visible at rest', !!R.restBefore, R.restBefore);
need('🔴 THE ASK: clicking Move here starts a journey', R.travellingImmediately === true, R);
need('…that is still running a fifth of a second later', R.travellingMid === true, R);
need('🔴 …and the sprite is in DIFFERENT places while it runs — it travels,',
     R.movedDuring > 4, { midA: R.midA, midB: R.midB, moved: R.movedDuring });
need('…and it ends somewhere else entirely', R.movedOverall > 20,
     { from: R.restBefore, to: R.restAfter, moved: R.movedOverall });
need('🔴 …and the journey ENDS rather than looping for ever',
     R.travellingAfter === false, R);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — the map is a position, not a menu: the train gates it, fuel moves it, raids feed it.');
