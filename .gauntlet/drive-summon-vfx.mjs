/* ══════════════════════════════════════════════════════════════════════════
   🌟 DRIVE-SUMMON-VFX — "the summon VFX are not playing in full".

   WHAT IS SUPPOSED TO HAPPEN (public/battle-board/index.html):
     The LIVE path is summonFx(unitId) (line ~2549), posted by the host at
     public/index.html ~114018 for every unit that appears in a new roster
     snapshot. It pushes, ALL ON THE SAME FRAME:
        rune   dur 1.50   ground pass, tileR()*0.88, elevation-aware
        flash  dur 0.55   screen pass, full-viewport wash
        pillar dur 1.00   air pass, tileR()*0.84, base pinned at world y=0
        ring   dur 0.70   ground pass, tileR()*[0.2..1.6]*2, drawn at y=.02
        burst  46 sparks
     and arms the RISE:  u.rise=1, u.riseT=0, u.y=-1.1, scale .7
     The rise is driven by the update loop (~7378) over 0.42 s, and on the
     frame it completes it fires the LANDING beat:
        squash scaleY 1.16 / scaleX .88   (springs back at dt*9, ~0.3 s)
        ring   dur 0.55   r0 .1 -> r1 1.0
        dust(wp.x, wp.z, 14)
     summonUnit() — the OTHER, card-flight ceremony (line ~2603) — is NOT the
     live path; nothing in public/index.html posts board:summon. It is probed
     here anyway because it is what the brief pointed at, and because it is the
     only path that dispatches summonComplete.

   🔴 THE TRAP THIS DRIVER EXISTS TO AVOID. The pane composites at ~0.56 Hz, so
   a rAF-driven sequence measured by WAITING does not advance at all and every
   "the beat never ran" assertion passes for the worst possible reason. So:
   rAF in the board frame is NEUTRALISED and window.frame(t) is called DIRECTLY
   with a monotonically rising t, and the number of frames that LANDED is
   asserted before anything else is believed.

   🔴 THE GLOBALS TRAP. effects / particles / units / MAP / CONFIG / CAM_FIT are
   top-level let/const in a classic script: lexical globals, NOT on window, and
   invisible to page.evaluate. They ARE visible to a GLOBAL eval —
   window.eval('effects') resolves through the global declarative record — and
   that is how every reading below is taken. Function declarations (frame,
   project, ringPx, tileR, gw, tileElev, handleHostMessage) are on window.

   Run:  node .gauntlet/drive-summon-vfx.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.txt':'text/plain', '.webp':'image/webp',
  '.woff2':'font/woff2', '.mp3':'audio/mpeg', '.ogg':'audio/ogg' };
const PORT = 8700 + (process.pid % 60);
const server = http.createServer((req,res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (name, cond, detail) => { if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail)); };
const note = (s) => console.log('  ~    ' + s);

const browser = await chromium.launch({ args:['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{ width:1600, height:900 } });
page.on('pageerror', e => console.log('  !! host pageerror ' + String(e).slice(0,140)));
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil:'domcontentloaded', timeout:120000 });
await page.waitForFunction('typeof initGame === "function" && typeof findHeroById === "function"', null, { timeout:180000 }).catch(()=>{});
await page.waitForTimeout(4000);

/* 🔴 A REAL MATCH. App.screen='battle' + render() alone gives an EMPTY shell —
   no sidebar, no units, and no stage iframe at all, so every measurement below
   would read zero and look like a total failure of the animation. */
const boot = await page.evaluate(async () => {
  const out = {};
  try {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle'; render();
  } catch (e) { out.err = String(e).slice(0,200); }
  await new Promise(r => setTimeout(r, 6000));
  out.screen = App.screen;
  out.units = (App.state && App.state.units) ? App.state.units.length : 0;
  out.iframe = !!document.querySelector('iframe.bb-stage');
  return out;
});
console.log('\n\u{1F3AC} MATCH  ' + JSON.stringify(boot));
ok('a real match is running (not an empty battle shell)', boot.screen === 'battle' && boot.units > 0,
   'screen=' + boot.screen + ' units=' + boot.units);
ok('the 3D stage iframe is mounted', boot.iframe === true);

const bf = page.frames().find(f => f.url().includes('battle-board/index.html'));
if (!bf) { console.log('\n  FAIL board iframe never appeared — nothing below can be measured.');
  await browser.close(); server.close(); process.exit(1); }
await page.waitForTimeout(4000);

/* ── the board's own vocabulary, read through a GLOBAL eval ─────────────── */
const G = (expr) => bf.evaluate((e) => {
  try { return window.eval('(' + e + ')'); } catch (err) { return { __evalErr:String(err).slice(0,200) }; }
}, expr);

const boardUnits = await G('units.map(u=>({id:String(u.id),gx:u.gx,gz:u.gz,rise:u.rise,y:u.y,sx:u.scaleX,sy:u.scaleY}))');
console.log('\n\u{1F9ED} BOARD UNITS  ' + JSON.stringify(boardUnits).slice(0,400));
ok('the board received the match roster (board globals reachable via global eval)',
   Array.isArray(boardUnits) && boardUnits.length > 0,
   Array.isArray(boardUnits) ? boardUnits.length + ' units' : JSON.stringify(boardUnits));
if (!Array.isArray(boardUnits) || !boardUnits.length){ await browser.close(); server.close(); process.exit(1); }

const target = boardUnits[0];
console.log('   target unit ' + target.id + ' at ' + target.gx + ',' + target.gz);

/* ── 🔴 KILL rAF IN THE BOARD, THEN PROVE frame() LANDS ─────────────────── */
const drove = await bf.evaluate(() => {
  window.__rafKilled = 0;
  window.requestAnimationFrame = () => { window.__rafKilled++; return 0; };
  window.__frames = 0;
  const _f = window.frame;
  window.__driveFrame = (t) => { window.__frames++; _f(t); };
  return typeof _f === 'function';
});
ok('window.frame() is reachable (a function declaration, not a const)', drove === true);

const step = 1000/60;

/* one sample = everything the ceremony can be judged on, taken from inside the
   board's own globals and re-run through its own projection maths. */
const SAMPLE = (id) => '(function(){\n' +
'  var u = units.find(function(x){return String(x.id)===' + JSON.stringify(String(id)) + ';});\n' +
'  var fx = effects.map(function(f){\n' +
'    var p = f.t/f.dur;\n' +
'    var o = { k:f.k, t:+f.t.toFixed(3), dur:f.dur, a:+(1-p).toFixed(3) };\n' +
'    if (f.k==="ring"){ var c = project({x:f.x,y:.02,z:f.z});\n' +
'      o.drawn = !!c; o.Rpx = c ? +ringPx(c, tileR()*(f.r0+(f.r1-f.r0)*(1-Math.pow(1-p,3)))*2).toFixed(2) : null; }\n' +
'    if (f.k==="rune"){ var c2 = project(gw(f.gx,f.gz,tileElev(f.gx,f.gz)+.004));\n' +
'      o.drawn = !!c2; o.Rpx = c2 ? +ringPx(c2, tileR()*0.88).toFixed(2) : null; }\n' +
'    if (f.k==="pillar"){ var b = project(gw(f.gx,f.gz,0)), t2 = project(gw(f.gx,f.gz,4.2));\n' +
'      o.drawn = !!(b&&t2); o.Rpx = b ? +(ringPx(b, tileR()*0.84)*(1-p*.25)).toFixed(2) : null; }\n' +
'    if (f.k==="flash"){ o.drawn = true; o.alpha = +(Math.pow(1-p,2)*0.75).toFixed(4); }\n' +
'    return o;\n' +
'  });\n' +
'  return { fx:fx, nfx:effects.length,\n' +
'           spark: particles.filter(function(p){return !p.puff&&!p.amb;}).length,\n' +
'           puff:  particles.filter(function(p){return !!p.puff;}).length,\n' +
'           u: u ? { rise:u.rise, riseT:(u.riseT===undefined?null:+u.riseT.toFixed(4)),\n' +
'                    y:+u.y.toFixed(4), sx:+u.scaleX.toFixed(4), sy:+u.scaleY.toFixed(4) } : null,\n' +
'           frameErr: frameErr, T:+T.toFixed(3) };\n' +
'})()';

/* ── FIRE THE LIVE PATH ─────────────────────────────────────────────────── */
const t0 = 100000;
await bf.evaluate((t) => window.__driveFrame(t), t0);           /* seed `last` */
await bf.evaluate((id) => { window.handleHostMessage({ type:'board:summonFx', id:id }); }, target.id);
const armed = await G(SAMPLE(target.id));
console.log('\n\u{1F387} ARM   effects pushed: ' + JSON.stringify((armed.fx||[]).map(f=>f.k)) +
            '  sparks=' + armed.spark + '  unit=' + JSON.stringify(armed.u));
ok('summonFx() pushed all four beats + the spark burst',
   (armed.fx||[]).length >= 4 && armed.spark >= 40,
   JSON.stringify((armed.fx||[]).map(f=>f.k)) + ' sparks=' + armed.spark);
ok('summonFx() armed the rise (y=-1.1, scale .7)',
   !!armed.u && armed.u.rise === 1 && armed.u.y <= -1.09 && armed.u.sy <= 0.71,
   JSON.stringify(armed.u));

const SEQ = [];
const FRAMES = 180;                                   /* 3.00 s at 60 Hz */
for (let i = 1; i <= FRAMES; i++){
  await bf.evaluate((t) => window.__driveFrame(t), t0 + i*step);
  SEQ.push(Object.assign({ i:i, ms:+(i*step).toFixed(1) }, await G(SAMPLE(target.id))));
}
const landed = await bf.evaluate(() => ({ frames: window.__frames, rafKilled: window.__rafKilled }));
console.log('\n\u{23F1}  DROVE ' + landed.frames + ' frames by hand (rAF calls swallowed: ' + landed.rafKilled + ')');
ok('\u{1F534} the frames actually LANDED — the sequence really advanced',
   landed.frames >= FRAMES, landed.frames + ' / ' + (FRAMES+1));
ok('no RENDER ERROR latched during the ceremony', SEQ[SEQ.length-1].frameErr === false);

/* ── WHAT RAN, AND FOR HOW LONG ─────────────────────────────────────────── */
const life = {};
for (const s of SEQ) for (const f of (s.fx||[])){
  const key = f.k + '@' + f.dur;
  const L = life[key] || (life[key] = { k:f.k, firstMs:s.ms, lastMs:s.ms, frames:0, dur:f.dur, maxR:0, drawnFrames:0 });
  L.lastMs = s.ms; L.frames++;
  if (f.drawn) L.drawnFrames++;
  if (f.Rpx != null && f.Rpx > L.maxR) L.maxR = f.Rpx;
}
console.log('\n\u{1F4CA} EFFECT LIFETIMES (hand-driven 60 Hz, 3.00 s window)');
for (const key of Object.keys(life)){
  const L = life[key];
  console.log('   ' + key.padEnd(12) + ' alive ' + L.firstMs.toFixed(1) + '→' + L.lastMs.toFixed(1) +
    ' ms (' + L.frames + ' frames)  drawn ' + L.drawnFrames + '/' + L.frames + '  maxR ' + L.maxR.toFixed(1) + 'px');
}
for (const key of ['rune@1.5','flash@0.55','pillar@1','ring@0.7']){
  const L = life[key];
  ok('beat "' + key + '" ran', !!L, L ? '' : 'NEVER APPEARED');
  if (!L) continue;
  const want = L.dur*1000;
  ok('beat "' + key + '" ran to its FULL ' + want + ' ms',
     (L.lastMs - L.firstMs) >= want - 2.5*step,
     'measured ' + (L.lastMs - L.firstMs).toFixed(1) + ' ms of ' + want);
  ok('beat "' + key + '" was DRAWN on every frame it was alive (projection never bailed)',
     L.drawnFrames === L.frames, L.drawnFrames + '/' + L.frames);
}

/* ── THE RISE + THE LANDING BEAT ────────────────────────────────────────── */
const yMin = Math.min.apply(null, SEQ.map(s => s.u ? s.u.y : 0));
const syPeak = Math.max.apply(null, SEQ.map(s => s.u ? s.u.sy : 0));
const landIdx = SEQ.findIndex(s => s.u && !s.u.rise && s.u.sy > 1.0);
console.log('\n\u{1F53C} RISE  yMin=' + yMin.toFixed(3) + '  peak scaleY=' + syPeak.toFixed(4) +
  '  landing frame=' + (landIdx<0?'NEVER':landIdx + ' (' + SEQ[landIdx].ms.toFixed(1) + ' ms)'));
ok('the unit rises from its AUTHORED depth of -1.1', yMin <= -1.09,
   'deepest y ever drawn = ' + yMin.toFixed(3) + ' of the authored -1.1');
ok('the rise finishes and the LANDING SQUASH fires', landIdx >= 0,
   landIdx < 0 ? 'scaleY never exceeded 1.0 after the rise ended' : '');
ok('\u{1F534} the landing squash actually REACHES its authored 1.16 / .88',
   syPeak >= 1.155, 'peak scaleY measured = ' + syPeak.toFixed(4) + ' (authored 1.16)');
if (landIdx >= 0){
  const puffAfter = Math.max.apply(null, SEQ.slice(landIdx).map(s=>s.puff));
  ok('the landing DUST fires', puffAfter > 0, 'max puffs after landing = ' + puffAfter);
  ok('the landing RING (dur .55) fires', !!life['ring@0.55']);
}
console.log('\n\u{1F4C8} SCALE TRACE around the landing (frame: ms  y  sy  sx  rise)');
const from = Math.max(0, (landIdx<0?24:landIdx)-4);
for (const s of SEQ.slice(from, from+14)) if (s.u)
  console.log('   ' + String(s.i).padStart(3) + ': ' + s.ms.toFixed(1).padStart(7) +
    '  y=' + s.u.y.toFixed(4).padStart(8) + '  sy=' + s.u.sy.toFixed(4) + '  sx=' + s.u.sx.toFixed(4) +
    '  rise=' + s.u.rise);

/* ══════════════════════════════════════════════════════════════════════════
   🔴 FALSIFIABILITY FOR THE TWO AMPLITUDE FINDINGS.

   Claim: the landing squash is authored at scaleY 1.16 but is never DRAWN at
   1.16, because update() sets it in its first unit loop (~7387) and then the
   spring-back in its SECOND unit loop (~7404) runs in the SAME update(),
   before anything is painted:
        u.scaleY += (1 - u.scaleY) * Math.min(1, dt*9)
   so the first frame the player ever sees is already at
        1.16 - 0.16*min(1, dt*9)
   The same shape applies to the rise: summonFx sets u.y = -1.1 outside any
   frame, and the first frame advances riseT by dt before drawing, so -1.1 is
   never on screen either.

   If that attribution is right, both amplitudes are a FUNCTION OF dt and must
   move when dt moves. So the whole ceremony is re-run at 1 ms per frame and
   the prediction is checked against the measurement. If the numbers do NOT
   track dt, the attribution is wrong and this driver should be disbelieved.
   ══════════════════════════════════════════════════════════════════════════ */
const dtProbe = async (stepMs, base) => {
  await bf.evaluate((a) => {
    window.eval('(function(){var u=units.find(function(x){return String(x.id)===' +
      JSON.stringify(String(a.id)) + ';});if(u){u.rise=0;u.riseT=undefined;u.y=0;u.scaleX=1;u.scaleY=1;}})()');
    window.__driveFrame(a.base);
    window.handleHostMessage({ type:'board:summonFx', id:a.id });
    window.__peakSy = 0; window.__minY = 0;
    for (let i=1;i<=Math.ceil(1200/a.stepMs);i++){
      window.__driveFrame(a.base + i*a.stepMs);
      const s = window.eval('(function(){var u=units.find(function(x){return String(x.id)===' +
        JSON.stringify(String(a.id)) + ';});return u?[u.scaleY,u.y]:[0,0];})()');
      if (s[0] > window.__peakSy) window.__peakSy = s[0];
      if (s[1] < window.__minY) window.__minY = s[1];
    }
  }, { id: target.id, stepMs, base });
  return bf.evaluate(() => ({ peakSy: window.__peakSy, minY: window.__minY }));
};
console.log('\n\u{1F513} FALSIFIABILITY — amplitude vs dt (authored squash 1.16, authored rise depth -1.1)');
const rows = [];
for (const ms of [1, 4, 1000/60, 33.3]){
  const r = await dtProbe(ms, 600000 + rows.length*100000);
  const dt = ms/1000;
  const predSy = 1.16 - 0.16*Math.min(1, dt*9);
  rows.push({ ms, dt, predSy, r });
  console.log('   dt ' + String(ms.toFixed(2)).padStart(6) + ' ms   peak scaleY ' + r.peakSy.toFixed(4) +
    '  (predicted by the same-frame spring: ' + predSy.toFixed(4) + ')   deepest y ' + r.minY.toFixed(4));
}
const tracks = rows.every(x => Math.abs(x.r.peakSy - x.predSy) < 0.004);
ok('\u{1F534} the squash amplitude TRACKS dt exactly as "the spring eats it in the same frame" predicts',
   tracks, rows.map(x => x.ms.toFixed(1) + 'ms:' + x.r.peakSy.toFixed(4) + '/' + x.predSy.toFixed(4)).join('  '));
const fine = rows[0], coarse = rows[rows.length-1];
ok('...so the SAME assertion passes at 1 ms and fails at 60 Hz — not a green that cannot go red',
   fine.r.peakSy > 1.155 && coarse.r.peakSy < fine.r.peakSy - 0.04,
   '1 ms reaches ' + fine.r.peakSy.toFixed(4) + ' of the authored 1.16; 33 ms only reaches ' +
   coarse.r.peakSy.toFixed(4) + ' \u{2014} ' + ((1.16-coarse.r.peakSy)/0.16*100).toFixed(0) + '% of the squash eaten');
ok('the rise depth is dt-dependent too — the authored -1.1 is never drawn at any real frame rate',
   fine.r.minY < coarse.r.minY - 0.05,
   '1 ms reaches y=' + fine.r.minY.toFixed(4) + ', 33 ms only reaches y=' + coarse.r.minY.toFixed(4) +
   ' (authored -1.1)');

/* ── ELEVATION: where the ground beats are actually pinned ──────────────── */
const el = await G('(function(){\n' +
' var gx=' + target.gx + ', gz=' + target.gz + ', e=tileElev(gx,gz);\n' +
' var top = project(gw(gx,gz,e)), zero = project(gw(gx,gz,0));\n' +
' return { elev:+e.toFixed(4), topY: top?+top.y.toFixed(1):null, zeroY: zero?+zero.y.toFixed(1):null,\n' +
'          dyPx: (top&&zero)? +(zero.y-top.y).toFixed(1) : null, scale: top?+top.s.toFixed(2):null };\n' +
'})()');
console.log('\n\u{26F0}  ELEVATION at the target tile  ' + JSON.stringify(el));

/* the same reading taken on the HIGHEST tile on the map — the target may be flat */
const hi = await G('(function(){\n' +
' var best=null;\n' +
' for (var z=0; z<MAP.rows; z++) for (var x=0; x<MAP.cols; x++){\n' +
'   var e=tileElev(x,z); if(!best||e>best.e) best={x:x,z:z,e:e}; }\n' +
' var top=project(gw(best.x,best.z,best.e)), zero=project(gw(best.x,best.z,0));\n' +
' return { x:best.x, z:best.z, elev:+best.e.toFixed(4),\n' +
'          dyPx:(top&&zero)?+(zero.y-top.y).toFixed(1):null,\n' +
'          ringRpx:(zero?+ringPx(zero, tileR()*1.6*2).toFixed(1):null) };\n' +
'})()');
console.log('\u{26F0}  HIGHEST tile on this map      ' + JSON.stringify(hi));
note('ring is drawn at project({x,y:.02,z}) and pillar at gw(gx,gz,0) — both IGNORE tileElev.');
note('rune uses gw(gx,gz,tileElev+.004), so the rune sits on the slab and the ring/pillar do not.');
ok('\u{1F534} the shockwave ring is pinned to the SAME height as the unit it belongs to',
   !hi || hi.dyPx === null || Math.abs(hi.dyPx) < 2,
   'on the highest tile (' + (hi&&hi.x) + ',' + (hi&&hi.z) + ') the ring draws ' +
   (hi&&hi.dyPx) + ' px below the unit’s feet');

/* ── THE SIZE QUESTION the brief flagged (PROP_SCALE 0.55 / fillX 0.76) ─── */
const sz = await G('({ tile:CONFIG.tile, tileR:+tileR().toFixed(4), fillX:CAM_FIT.fillX, propScale:PROP_SCALE })');
console.log('\n\u{1F50D} SIZE   ' + JSON.stringify(sz));
note('ringPx(p,worldR) = worldR * p.s. Every summon beat is sized in TILE UNITS,');
note('so the v121f4 camera pull-back shrinks them exactly as much as it shrinks the tile.');
note('No summon beat routes through drawStruct/drawTruck, so the W<2 / H<3 bails cannot reach it.');

/* ── summonComplete: does the LIVE path ever report done? ───────────────── */
const scLive = await bf.evaluate((id) => {
  let got = 0; const h = () => got++;
  document.addEventListener('board:summonComplete', h);
  window.eval('(function(){var u=units.find(function(x){return String(x.id)===' + JSON.stringify(String(id)) + ';});if(u){u.rise=0;u.riseT=undefined;u.y=0;}})()');
  window.handleHostMessage({ type:'board:summonFx', id:id });
  for (let i=1;i<=120;i++) window.__driveFrame(200000 + i*(1000/60));
  document.removeEventListener('board:summonComplete', h);
  return got;
}, target.id);
console.log('\n\u{1F4E3} board:summonComplete dispatches from the LIVE summonFx path: ' + scLive);
ok('the LIVE ceremony reports completion (board:summonComplete)', scLive > 0,
   'dispatched ' + scLive + ' times — summonFx() never calls dispatch(); only summonUnit() does');

/* ── the OTHER ceremony (summonUnit) — what the brief pointed at ────────── */
const su = await bf.evaluate(() => {
  const out = { events:0, err:null };
  try {
    const h = () => out.events++;
    document.addEventListener('board:summonComplete', h);
    const free = window.eval('(function(){for(var z=0;z<MAP.rows;z++)for(var x=0;x<MAP.cols;x++)' +
      'if(!tileBlocked(x,z)&&!unitAt(x,z)) return {x:x,z:z}; return null;})()');
    out.tile = free;
    out.key = window.eval('Object.keys(UNIT_DEFS)[0]');
    const before = window.__rafKilled;
    window.handleHostMessage({ type:'board:summon', key:out.key, x:free.x, z:free.z, id:'VFXPROBE' });
    for (let i=1;i<=200;i++) window.__driveFrame(300000 + i*(1000/60));
    out.rafFromStep = window.__rafKilled - before;
    out.summoningStuck = window.eval('summoning');
    document.removeEventListener('board:summonComplete', h);
  } catch (e) { out.err = String(e).slice(0,200); }
  return out;
});
console.log('\n\u{1F0CF} summonUnit() (board:summon) — ' + JSON.stringify(su));
note('summonUnit’s step() re-schedules itself with requestAnimationFrame, which this');
note('driver neutralised on purpose. Its non-completion here is a property of the RIG,');
note('not a defect — it is exactly the render trap the brief warned about.');
note('Nothing in public/index.html posts board:summon, so this path is dead in the live game.');

fs.writeFileSync(path.join(process.cwd(), '.gauntlet', 'summon-vfx-trace.json'),
  JSON.stringify({ target:target, elev:el, highest:hi, size:sz, life:life, seq:SEQ }, null, 1));
console.log('\n   full per-frame trace -> .gauntlet/summon-vfx-trace.json');

console.log('\n' + (fails ? '❌ ' + fails + ' FAIL' : '✅ all checks green'));
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
