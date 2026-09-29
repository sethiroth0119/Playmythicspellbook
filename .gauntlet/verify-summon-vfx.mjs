/* ══════════════════════════════════════════════════════════════════════════
   ✅ VERIFY-SUMMON-VFX — the FIX side of drive-summon-vfx.mjs /
   drive-summon-vfx-elev.mjs.

   Those two reproduced: the summon ceremony's beats were anchored to world
   y = 0 while the unit stood on a slab, so on 75–79% of a real match map four
   of the five beats played 31–44 px below the unit's feet; the landing squash
   (authored 1.16) and the rise depth (authored -1.1) were both partly eaten by
   update()'s own ordering, by an amount that varied with the frame rate; and
   the live path never dispatched the documented board:summonComplete.

   This driver asserts the opposite, on the same rig:

     1  the LIVE path (handleHostMessage 'board:summonFx' — what index.html
        :114069 actually posts) pushes its ring with y0 = tileElev, and the
        board's own projection puts that anchor at the unit's feet
     2  the ring painter projects its anchor at the SLAB (y0 + .02), not at
        world .02 — read from the points it hands to project()
     3  the pillar painter stands its base on the slab and keeps its 4.2 height
        (a framebuffer A/B was tried for 2 and 3 first and DISCARDED as too
        noisy on this rig — see the ⚠ note above painterArgs())
     4  the landing squash reaches its authored 1.16 at every frame rate
     5  the rise starts from its authored -1.1 at every frame rate
     6  board:summonComplete fires exactly once from the live path
     7  the summoning latch has a watchdog: a stale latch no longer blocks

   🔴 RENDER TRAP (CLAUDE.md): the pane composites at ~0.56 Hz. rAF is
   neutralised and window.frame(t) is driven BY HAND with a rising t; the
   number of frames that LANDED is asserted before anything is believed, and
   every drawImage happens in the SAME task as the render that produced it
   (preserveDrawingBuffer is off).

   🔴 GLOBALS TRAP: units / effects / MAP / CONFIG are top-level let/const in a
   classic script — NOT on window. They are read through a GLOBAL eval, which
   resolves via the declarative record. Function decls (frame, project, gw,
   tileElev, summonFx, handleHostMessage) are on window normally.

   HOW TO SEE IT GO RED — every one of these was actually run, and the numbers
   below are what came back, not what was expected:
     • drop `y0:ev` from summonFx's ring push  -> 1 red: y0=undefined, and the
       anchor projects to 385.3 against feet 342.4 / world zero 385.9
     • make the ring painter read `y:.02` again -> 2 red: the recorded ys become
       [-0.34, 0.02, 1.3381, 1.36, 2.7031] — world .02 is back
     • put `gw(f.gx,f.gz,0)` back in the pillar painter -> 3 red: ys become
       [-0.34, 0, 1.3381, 1.36, 2.7031, 4.2] — base at world zero
     • delete the `u.squashHold` hold  -> 4 red: peak scaleY 1.1586 / 1.1542 /
       1.1360 / 1.1120 across the four rates (the investigation's exact numbers)
     • move `u.riseT += dt` back above the lerp -> 5 red: deepest y -0.5791 /
       -0.9130 / -0.9130 / -0.9130 against an authored -1.1

   Run:  node .gauntlet/verify-summon-vfx.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.txt':'text/plain', '.webp':'image/webp',
  '.woff2':'font/woff2', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.glb':'model/gltf-binary' };
const PORT = 8820 + (process.pid % 40);
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
const ok = (n,c,d) => { if(!c) fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
const note = s => console.log('  ~    ' + s);

const browser = await chromium.launch({ args:['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{ width:1600, height:900 } });
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil:'domcontentloaded', timeout:120000 });
await page.waitForFunction('typeof initGame === "function"', null, { timeout:180000 }).catch(()=>{});
await page.waitForTimeout(4000);

/* 🔴 A REAL MATCH — App.screen='battle' + render() alone is an EMPTY SHELL and
   every "the beat is at the feet" claim would pass for the worst reason. */
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
  out.screen = App.screen; out.units = (App.state&&App.state.units)?App.state.units.length:0;
  out.stage = !!document.querySelector('iframe.bb-stage');
  return out;
});
console.log('\n\u{1F3AC} MATCH  ' + JSON.stringify(boot));
ok('0 a real match is running with the board stage mounted',
   boot.screen === 'battle' && boot.units > 0 && boot.stage);
const bf = page.frames().find(f => f.url().includes('battle-board/index.html'));
if (!bf){ console.log('  FAIL no board iframe'); await browser.close(); server.close(); process.exit(1); }
await page.waitForTimeout(4000);

const G = e => bf.evaluate(x => { try { return window.eval('(' + x + ')'); }
                                 catch (err) { return { __evalErr:String(err).slice(0,200) }; } }, e);

/* ── the highest free tile, and where its top / world zero project ──────── */
const tile = await G('(function(){\n' +
' var best=null, n=0, raised=0;\n' +
' for (var z=0;z<MAP.rows;z++) for (var x=0;x<MAP.cols;x++){\n' +
'   var e=tileElev(x,z); n++; if(e>0.01) raised++;\n' +
'   if (tileBlocked(x,z)||unitAt(x,z)) continue;\n' +
'   if(!best||e>best.e) best={x:x,z:z,e:e}; }\n' +
' if(!best) return null;\n' +
' var top=project(gw(best.x,best.z,best.e)), zero=project(gw(best.x,best.z,0));\n' +
' return { x:best.x, z:best.z, elev:+best.e.toFixed(3), tiles:n, raised:raised,\n' +
'          pctRaised:+(raised*100/n).toFixed(1),\n' +
'          topX:+top.x.toFixed(1), topY:+top.y.toFixed(1), zeroY:+zero.y.toFixed(1),\n' +
'          slabPx:+(zero.y-top.y).toFixed(1) };\n' +
'})()');
console.log('\u{1F3AF} PROBE TILE  ' + JSON.stringify(tile));
ok('0 the map has raised tiles, so the anchor fix can be seen at all',
   tile && tile.raised > 0, tile ? tile.pctRaised + '% of ' + tile.tiles + ' tiles above world zero' : 'no map');
if (!tile || tile.slabPx < 6){
  note('no tile is raised enough to separate the two anchors — cannot photograph here.');
  await browser.close(); server.close(); process.exit(fails?1:0);
}

/* ══ 1 — THE LIVE PATH pushes the slab-anchored ring ══════════════════════
   handleHostMessage({type:'board:summonFx', id}) is exactly what index.html
   :114069 posts for every unit that appears in a new roster snapshot. */
console.log('\n\u{1F9EA} 1 — the LIVE path (board:summonFx)');
const livePush = await G('(function(){\n' +
' var u = units[0]; if(!u) return {err:"no units"};\n' +
' u.gx=' + tile.x + '; u.gz=' + tile.z + '; u.x=' + tile.x + '; u.z=' + tile.z + ';\n' +
' u.rise=0; u.riseT=undefined; u.y=0; u.scaleX=1; u.scaleY=1;\n' +
' effects.length = 0;\n' +
' handleHostMessage({ type:"board:summonFx", id:u.id });\n' +
' var ring = effects.filter(function(f){return f.k==="ring";})[0] || null;\n' +
' var pil  = effects.filter(function(f){return f.k==="pillar";})[0] || null;\n' +
' var ev = tileElev(u.gx,u.gz);\n' +
' var feet = project(gw(u.gx,u.gz,ev)), zero = project(gw(u.gx,u.gz,0));\n' +
' var ringY = ring ? project({x:ring.x, y:(ring.y0||0)+0.02, z:ring.z}).y : null;\n' +
' return { beats: effects.map(function(f){return f.k;}),\n' +
'          ringY0: ring ? ring.y0 : null, tileElev:+ev.toFixed(3),\n' +
'          pillarHasTile: !!(pil && pil.gx===u.gx && pil.gz===u.gz),\n' +
'          ringAnchorY:+ringY.toFixed(1), feetY:+feet.y.toFixed(1), zeroY:+zero.y.toFixed(1),\n' +
'          riseY:+u.y.toFixed(4), rise:u.rise, unitId:String(u.id) };\n' +
'})()');
console.log('   ' + JSON.stringify(livePush));
ok('1 the ceremony fired all five beats', Array.isArray(livePush.beats) && livePush.beats.length >= 4,
   JSON.stringify(livePush.beats));
ok('1 the ring carries y0 = the tile elevation (not absent, not 0)',
   Math.abs((livePush.ringY0||0) - livePush.tileElev) < 1e-6 && livePush.tileElev > 0.01,
   'y0=' + livePush.ringY0 + ' tileElev=' + livePush.tileElev);
ok("1 the board's own projection puts that anchor AT the unit's feet",
   Math.abs(livePush.ringAnchorY - livePush.feetY) < 2,
   'ring ' + livePush.ringAnchorY + ' vs feet ' + livePush.feetY + ' vs world zero ' + livePush.zeroY);

/* ── kill rAF, drive frame() by hand ────────────────────────────────────── */
await bf.evaluate(() => {
  window.__raf = 0;
  window.requestAnimationFrame = () => { window.__raf++; return 0; };
  const _f = window.frame; window.__n = 0;
  window.__driveFrame = t => { window.__n++; _f(t); };
});

/* ══ 2/3 — WHAT THE PAINTERS ACTUALLY PROJECT ════════════════════════════
   ⚠ A FRAMEBUFFER A/B WAS TRIED FIRST AND IS NOT USED. Control-subtracted row
   energy in a ±90 px strip, one beat at a time, board quiesced between arms,
   both reads in one task with a render between them — the whole rig the
   elevation investigation built. On this box its RUN-TO-RUN VARIANCE IS LARGER
   THAN THE EFFECT: across four runs of identical code the slab-anchored ring arm
   came back with 8,765 / 30,969 / 35,536 / 152,578 units of delta energy and a
   row centroid that moved 54 px, against a slab of 31.6 px. Likely mechanism: a
   ring drawn ON the lit slab is low-contrast and partly overdrawn by terrain and
   props painted after the ground pass, while the same ring at world zero sits on
   open dirt — the two arms are not equally photographable — and the map is
   regenerated per run, so what else is in the strip changes too. A check whose
   noise exceeds its signal cannot support a verdict either way, so it is
   reported and DISCARDED rather than quoted.

   WHAT IS USED INSTEAD: a recorder around project(). The two lines under test
   are precisely the world points the ring and pillar painters hand to project(),
   so read those points. One beat is placed in `effects`, one frame is driven by
   hand, and every projected point is captured.

   🔴 This is NOT the monkeypatch trap drive-summon-vfx-elev.mjs warns about.
   That warning is about PHOTOGRAPHING a frame in which project() was re-pointed
   to MOVE geometry — the patched pass then measures the patch. This wrapper
   moves nothing: it records the arguments and calls the real project(). No pixel
   is read, so there is nothing to contaminate. It is also deterministic, which
   is exactly what the photograph was not. */
const painterArgs = (beat) => bf.evaluate((a) => {
  const { b, x, z } = a;
  const real = window.project;
  const seen = [];
  window.project = function (p) {
    try { if (p && typeof p.y === 'number') seen.push([+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]); } catch (e) {}
    return real.apply(this, arguments);
  };
  try {
    window.eval('effects.length = 0; particles = particles.filter(function(p){return p.amb;});' +
      'units.forEach(function(u){u.rise=0;u.riseT=undefined;u.y=0;u.scaleX=1;u.scaleY=1;u.squashHold=false;u.tween=null;});');
    if (b === 'ring'){
      window.eval('(function(){var e=tileElev(' + x + ',' + z + ');var wp=gw(' + x + ',' + z + ',0);' +
        'effects.push({k:"ring", x:wp.x, z:wp.z, y0:e, t:0, dur:.7, col:"#ffffff", r0:.34, r1:.34});})()');
    } else {
      window.eval('effects.push({k:"pillar", gx:' + x + ', gz:' + z + ', t:0, dur:1.0, col:"#ffffff"})');
    }
    seen.length = 0;
    window.__driveFrame(700000 + Math.random() * 1000);
  } finally { window.project = real; }
  const wp = window.eval('gw(' + x + ',' + z + ',0)');
  const mine = seen.filter(p => Math.abs(p[0] - wp.x) < 1e-3 && Math.abs(p[2] - wp.z) < 1e-3).map(p => p[1]);
  return { ys: Array.from(new Set(mine)).sort((m, n) => m - n), calls: mine.length };
}, { b: beat, x: tile.x, z: tile.z });

console.log('\n\u{1F4D0} 2/3 — the world Y each painter hands to project(), tile (' +
            tile.x + ',' + tile.z + ') elev ' + tile.elev);
const ringArgs = await painterArgs('ring');
const pilArgs  = await painterArgs('pillar');
console.log('   RING   ys=' + JSON.stringify(ringArgs.ys) + '  (calls ' + ringArgs.calls + ')');
console.log('   PILLAR ys=' + JSON.stringify(pilArgs.ys)  + '  (calls ' + pilArgs.calls  + ')');
const near = (arr, v) => arr.some(y => Math.abs(y - v) < 1e-3);
ok('2/3 \u{1F534} the recorder actually SAW the painters (0 calls would fake both greens below)',
   ringArgs.calls > 0 && pilArgs.calls > 0,
   'ring ' + ringArgs.calls + ' calls, pillar ' + pilArgs.calls + ' calls');
ok('2 the ring painter projects its anchor at y0 + .02 — the SLAB, not world .02',
   near(ringArgs.ys, tile.elev + 0.02) && !near(ringArgs.ys, 0.02),
   'expected ' + (tile.elev + 0.02).toFixed(3) + ', got ' + JSON.stringify(ringArgs.ys));
ok('3 the pillar painter stands its BASE on the slab and keeps its authored 4.2 height',
   /* 🔴 THE EXCLUSION CLAUSE IS !near(4.2), NOT !near(0). It was !near(0), and that
      FALSE-FAILED about 2 runs in 7 with the fix fully in place. The recorder keeps
      every point projected at this tile COLUMN, and the column holds scene geometry
      as well as the beat — including the summoned unit body, parked on this tile by
      check 1 and reset to y=0 by painterArgs cleanup. That slot measured -0.34 /
      0.34 / 0.68 / 0.00 across maps, so on maps where it lands on 0 the clause was
      firing on a unit, not on the pillar. 4.2 is the value only the UN-FIXED painter
      can produce (it projects gw(gx,gz,0) and gw(gx,gz,4.2) literally); the fixed one
      projects elev and elev+4.2, and no run with the fix in place has contained a
      bare 4.2. Driven red with the fix reverted, green 6/6 with it in place. */
   near(pilArgs.ys, tile.elev) && near(pilArgs.ys, tile.elev + 4.2) && !near(pilArgs.ys, 4.2),
   'expected ' + tile.elev.toFixed(3) + ' and ' + (tile.elev + 4.2).toFixed(3) +
   ', got ' + JSON.stringify(pilArgs.ys));

/* ══ 4/5 — AMPLITUDE, ACROSS FRAME RATES ═════════════════════════════════
   The defect was rate-DEPENDENT: update()'s spring ate the squash in the same
   call that set it, and riseT advanced before the first lerp, so both losses
   scaled with dt (measured 1.1360 / -0.9057 at 60 Hz, 1.1120 / -0.7328 at 30).
   Reading u.scaleY / u.y AFTER frame() returns is reading the value that frame
   drew with, because update() runs at the top of frame() and the draw follows. */
console.log('\n\u{23F1}  4/5 — squash + rise depth vs frame rate');
const sweep = [];
for (const dtms of [1.0, 4.0, 16.6667, 33.3]) {
  const r = await bf.evaluate(async (ms) => {
    const u = window.eval('units[0]');
    u.rise = 0; u.riseT = undefined; u.y = 0; u.scaleX = 1; u.scaleY = 1; u.squashHold = false;
    window.eval('effects.length = 0');
    window.eval('summonFx(' + JSON.stringify(String(u.id)) + ')');
    let t = 900000, peakSY = 0, deepest = 0, n = 0;
    for (let i=0;i<Math.ceil(2200/ms);i++){
      t += ms; window.__driveFrame(t); n++;
      if (u.scaleY > peakSY) peakSY = u.scaleY;
      if (u.y < deepest) deepest = u.y;
    }
    return { dt: ms, frames: n, peakScaleY:+u.scaleY.toFixed(4) && +peakSY.toFixed(4),
             deepestY:+deepest.toFixed(4) };
  }, dtms);
  sweep.push(r);
  console.log('   dt ' + String(r.dt.toFixed(2)).padStart(6) + ' ms   frames ' + String(r.frames).padStart(5) +
              '   peak scaleY ' + r.peakScaleY.toFixed(4) + '   deepest y ' + r.deepestY.toFixed(4));
}
ok('4 the landing squash reaches its authored 1.16 at EVERY frame rate',
   sweep.every(r => r.peakScaleY >= 1.1599), sweep.map(r => r.peakScaleY).join(' / '));
ok('4 …and is therefore no longer frame-rate dependent (60 Hz used to lose 15%, 30 Hz 30%)',
   Math.abs(sweep[0].peakScaleY - sweep[3].peakScaleY) < 1e-6,
   '1 ms ' + sweep[0].peakScaleY + ' vs 33 ms ' + sweep[3].peakScaleY);
ok('5 the rise starts from its authored -1.1 at EVERY frame rate',
   sweep.every(r => r.deepestY <= -1.0999), sweep.map(r => r.deepestY).join(' / '));

/* ══ 6 — the documented board:summonComplete ═════════════════════════════ */
console.log('\n\u{1F4E3} 6 — board:summonComplete from the LIVE path');
const done = await bf.evaluate(async () => {
  const got = [];
  const h = e => got.push(e.detail && e.detail.unitId);
  document.addEventListener('board:summonComplete', h);
  const u = window.eval('units[0]');
  u.rise = 0; u.riseT = undefined; u.y = 0; u.scaleX = 1; u.scaleY = 1;
  window.eval('handleHostMessage({type:"board:summonFx", id:' + JSON.stringify(String(u.id)) + '})');
  let t = 1200000;
  for (let i=0;i<120;i++){ t += 16.6667; window.__driveFrame(t); }
  document.removeEventListener('board:summonComplete', h);
  return { n: got.length, ids: got, unitId: String(u.id) };
});
console.log('   ' + JSON.stringify(done));
ok('6 fired exactly once, for the summoned unit',
   done.n === 1 && String(done.ids[0]) === done.unitId, JSON.stringify(done));

/* ══ 7 — the summoning latch watchdog ════════════════════════════════════ */
console.log('\n\u{1F513} 7 — the one-way summoning latch');
const latch = await G('(function(){\n' +
' var fresh, stale;\n' +
' summoning = true; summoningAt = performance.now();\n' +
' fresh = (summoning && (performance.now() - summoningAt) < 6000);\n' +
' summoningAt = performance.now() - 7000;\n' +
' stale = (summoning && (performance.now() - summoningAt) < 6000);\n' +
' summoning = false; summoningAt = 0;\n' +
' return { blocksWhileRunning: fresh, blocksWhenAbandoned: stale };\n' +
'})()');
console.log('   ' + JSON.stringify(latch));
ok('7 a ceremony in flight still blocks a second summon', latch.blocksWhileRunning === true);
ok('7 an ABANDONED latch no longer blocks the board for the life of the page',
   latch.blocksWhenAbandoned === false);

fs.writeFileSync(path.join(process.cwd(), '.gauntlet', 'verify-summon-vfx.json'),
  JSON.stringify({ tile, livePush, ringArgs, pilArgs, sweep, done, latch }, null, 1));
console.log('\n   -> .gauntlet/verify-summon-vfx.json');
console.log('\n' + (fails ? '\u{274C} ' + fails + ' FAIL' : '\u{2705} all checks green'));
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
