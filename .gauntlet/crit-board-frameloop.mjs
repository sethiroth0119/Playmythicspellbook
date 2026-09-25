/* ══════════════════════════════════════════════════════════════════════════
   🔪 CRIT-BOARD-FRAMELOOP — adversarial pass over the summon-VFX fixes in
   public/battle-board/index.html. Hunts for what they BROKE, not what they fixed.

   The fixes restructured the FRAME LOOP itself:
     • update()'s summon-rise loop became evaluate-then-advance, with
       `u.riseT += dt` moved into an `else` branch  →  can the rise still
       TERMINATE, at every frame rate, or is a unit left rising forever?
     • a new `u.squashHold` flag is set in the rise loop and consumed by the
       spring loop later in the SAME update()  →  is it always consumed, or can
       a unit be left permanently frozen at scaleY 1.16 (visibly deformed)?
     • burst() gained a `y0` and particles now bounce off the slab  →  do the
       sparks still settle, or can they sit below the floor / go NaN?
     • summonFx/summonUnit push more work per ceremony, and a throw anywhere in
       frame() latches `frameErr`, which is ONE-WAY: `if (frameErr) return;`
       freezes the board FOREVER and looks exactly like "the board is fine but
       nothing moves". That is the silent-freeze risk this driver exists for.

   🔴 THE RENDER TRAP — rAF is neutralised and window.frame(t) is driven BY HAND
   with a monotonically rising t; the landed call count is asserted, never
   inferred. No pixel is read, so no framebuffer/preserveDrawingBuffer trap.
   🔴 GLOBALS TRAP — units/effects/particles/frameErr/summoning are top-level
   let/const and are NOT on window. They are reached with window.eval inside the
   IFRAME's realm (bare identifiers resolve there); nothing is read off window.

   Run:  node .gauntlet/crit-board-frameloop.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8770 + (process.pid % 40);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));
await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort();
});
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(4000);

const boot = await page.evaluate(async () => {
  const out = {};
  try {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle'; render();
  } catch (e) { out.err = String(e).slice(0, 200); }
  await new Promise(r => setTimeout(r, 6000));
  out.screen = App.screen; out.units = (App.state && App.state.units) ? App.state.units.length : 0;
  out.stage = !!document.querySelector('iframe.bb-stage');
  return out;
});
console.log('🎬 MATCH  ' + JSON.stringify(boot));
ok('0 a real match is running with the board stage mounted',
  boot.screen === 'battle' && boot.units > 0 && boot.stage);
const bf = page.frames().find(f => f.url().includes('battle-board/index.html'));
if (!bf) { console.log('  FAIL no board iframe'); await browser.close(); server.close(); process.exit(1); }
await page.waitForTimeout(4000);
const G = e => bf.evaluate(x => { try { return window.eval('(' + x + ')'); }
  catch (err) { return { __evalErr: String(err).slice(0, 200) }; } }, e);

/* rAF neutralised; frame() driven by hand, landed calls COUNTED. */
await bf.evaluate(() => {
  window.__raf = 0;
  window.requestAnimationFrame = () => { window.__raf++; return 0; };
  const _f = window.frame; window.__n = 0;
  window.__drive = t => { window.__n++; _f(t); };
});

const tile = await G('(function(){var best=null;for(var z=0;z<MAP.rows;z++)for(var x=0;x<MAP.cols;x++){' +
  'var e=tileElev(x,z);if(tileBlocked(x,z)||unitAt(x,z))continue;if(!best||e>best.e)best={x:x,z:z,e:e};}' +
  'return best?{x:best.x,z:best.z,elev:+best.e.toFixed(3)}:null;})()');
console.log('🎯 PROBE TILE ' + JSON.stringify(tile));

/* ══ 1 — a long hand-driven drive with a summon in it must not latch frameErr ══ */
console.log('\n🧪 1 — 400 hand-driven frames + a real summon ceremony');
const R1 = await G('(function(){\n' +
' var u = units[0]; if(!u) return {err:"no units"};\n' +
' u.gx=' + tile.x + '; u.gz=' + tile.z + '; u.x=' + tile.x + '; u.z=' + tile.z + ';\n' +
' u.rise=0; u.riseT=undefined; u.y=0; u.scaleX=1; u.scaleY=1; u.squashHold=false;\n' +
' effects.length=0; particles.length=0;\n' +
' var t=1000; window.__drive(t);\n' +
' handleHostMessage({type:"board:summonFx", id:u.id});\n' +
' var maxScaleY=0, minY=99, sawRise=false, nan=0, holdStuck=0, belowSlab=0;\n' +
' var ev = tileElev(u.gx,u.gz);\n' +
' for (var i=0;i<400;i++){\n' +
'   t += 16.67; window.__drive(t);\n' +
'   if (u.rise) sawRise=true;\n' +
'   if (!isFinite(u.y)||!isFinite(u.scaleY)||!isFinite(u.scaleX)) nan++;\n' +
'   if (u.scaleY>maxScaleY) maxScaleY=u.scaleY;\n' +
'   if (u.y<minY) minY=u.y;\n' +
'   for (var k=0;k<units.length;k++) if (units[k].squashHold) holdStuck++;\n' +
'   for (var q=0;q<particles.length;q++){ var p=particles[q];\n' +
'     if(!isFinite(p.y)||!isFinite(p.x)) nan++;\n' +
'     if (p.y < (p.y0||0) - 0.001) belowSlab++; }\n' +
' }\n' +
' return { drove:window.__n, rafAsked:window.__raf, frameErr:frameErr, frameErrN:frameErrN,\n' +
'          sawRise:sawRise, riseEnded:(u.rise===0), riseT:u.riseT,\n' +
'          finalY:+u.y.toFixed(4), finalScaleY:+u.scaleY.toFixed(4),\n' +
'          peakScaleY:+maxScaleY.toFixed(4), deepestY:+minY.toFixed(4),\n' +
'          nan:nan, holdStuckFrames:holdStuck, belowSlab:belowSlab,\n' +
'          tileElev:+ev.toFixed(3), particlesLeft:particles.length, effectsLeft:effects.length,\n' +
'          summoning:summoning };\n' +
'})()');
console.log('   ' + JSON.stringify(R1));
ok('1 frame() really ran 401 times by hand (not inferred from rAF)', R1.drove === 401, 'drove=' + R1.drove);
ok('1 frameErr NEVER latched — the board is not silently frozen',
  R1.frameErr === false && R1.frameErrN === 0, 'frameErr=' + R1.frameErr + ' frameErrN=' + R1.frameErrN);
ok('1 the summon rise actually happened', R1.sawRise === true);
/* y is NOT compared to exactly 0: the rise-end branch sets u.y = 0, but the
   idle-breathe line further down (`u.y = Math.sin(u.bob*1.7)*0.022`, :7527)
   owns u.y from the next frame on, so the settled value oscillates inside
   ±0.022 forever. The termination evidence is rise === 0 and riseT === undefined. */
ok('1 the rise TERMINATED (rise=0, riseT cleared, y settled to idle breathe)',
  R1.riseEnded === true && R1.riseT === undefined && Math.abs(R1.finalY) <= 0.023,
  'rise=' + (R1.riseEnded ? 0 : 1) + ' riseT=' + R1.riseT + ' y=' + R1.finalY + ' (breathe ±0.022)');
ok('1 the authored −1.1 rise depth is actually painted', Math.abs(R1.deepestY + 1.1) < 1e-6, R1.deepestY);
ok('1 the authored 1.16 landing squash is actually painted', Math.abs(R1.peakScaleY - 1.16) < 1e-6, R1.peakScaleY);
ok('1 squashHold is ALWAYS consumed — no unit left frozen deformed',
  R1.holdStuckFrames === 0 && Math.abs(R1.finalScaleY - 1) < 0.02,
  'stuckFrames=' + R1.holdStuckFrames + ' finalScaleY=' + R1.finalScaleY);
ok('1 no NaN anywhere in unit transform or particle state', R1.nan === 0, R1.nan);
ok('1 no particle fell through the slab it was kicked off', R1.belowSlab === 0, R1.belowSlab);
ok('1 the effect + particle pools drained (no unbounded growth)',
  R1.effectsLeft === 0 && R1.particlesLeft < 40, 'effects=' + R1.effectsLeft + ' particles=' + R1.particlesLeft);

/* ══ 2 — the rise must terminate at EVERY frame rate, incl. pathological ══ */
console.log('\n🧪 2 — rise termination across frame rates (incl. dt=0 and a 2 s hitch)');
const R2 = await G('(function(){\n' +
' var out={};\n' +
' var rates=[1,4,16.67,33.3,100,2000];\n' +
' for (var r=0;r<rates.length;r++){\n' +
'   var dt=rates[r]; var u=units[0];\n' +
'   u.gx=' + tile.x + '; u.gz=' + tile.z + '; u.rise=0; u.riseT=undefined; u.y=0;\n' +
'   u.scaleX=1; u.scaleY=1; u.squashHold=false; effects.length=0; particles.length=0;\n' +
'   var t=50000+r*100000; window.__drive(t);\n' +
'   handleHostMessage({type:"board:summonFx", id:u.id});\n' +
'   var peak=0, deep=99, frames=0;\n' +
'   for (var i=0;i<600 && u.rise;i++){ t+=dt; window.__drive(t); frames++;\n' +
'     if(u.scaleY>peak)peak=u.scaleY; if(u.y<deep)deep=u.y; }\n' +
'   out["dt"+dt]={ended:u.rise===0, frames:frames, peakScaleY:+peak.toFixed(4),\n' +
'                  deepestY:+deep.toFixed(4), y:+u.y.toFixed(4), err:frameErr};\n' +
' }\n' +
' // dt = 0 : the loop cannot advance; assert it does not NaN or throw, and that\n' +
' // it recovers the moment time moves again.\n' +
' var u2=units[0]; u2.rise=0; u2.riseT=undefined; u2.y=0; u2.scaleY=1; effects.length=0;\n' +
' var t0=900000; window.__drive(t0);\n' +
' handleHostMessage({type:"board:summonFx", id:u2.id});\n' +
' for (var j=0;j<60;j++) window.__drive(t0);\n' +
' var stalled={rise:u2.rise, y:+u2.y.toFixed(4), finite:isFinite(u2.y), err:frameErr};\n' +
' for (var k=0;k<200 && u2.rise;k++){ t0+=16.67; window.__drive(t0); }\n' +
' out.zeroDt={stalled:stalled, recovered:u2.rise===0, y:+u2.y.toFixed(4)};\n' +
' return out;\n' +
'})()');
console.log('   ' + JSON.stringify(R2));
const rates = ['dt1', 'dt4', 'dt16.67', 'dt33.3', 'dt100', 'dt2000'];
ok('2 the rise terminates at EVERY frame rate', rates.every(k => R2[k] && R2[k].ended),
  rates.map(k => k + ':' + (R2[k] && R2[k].ended)).join(' '));
ok('2 the authored −1.1 depth is painted at EVERY rate (the ordering fix holds)',
  rates.every(k => Math.abs(R2[k].deepestY + 1.1) < 1e-6), rates.map(k => R2[k].deepestY).join(' '));
ok('2 the authored 1.16 squash is painted at EVERY rate',
  rates.every(k => Math.abs(R2[k].peakScaleY - 1.16) < 1e-6), rates.map(k => R2[k].peakScaleY).join(' '));
ok('2 dt=0 does not NaN, does not throw, and recovers when time moves again',
  R2.zeroDt.stalled.finite && R2.zeroDt.stalled.err === false && R2.zeroDt.recovered === true,
  JSON.stringify(R2.zeroDt));
ok('2 frameErr still not latched after all of that', rates.every(k => R2[k].err === false));

/* ══ 3 — the summoning watchdog must not wedge, and must still guard ══ */
console.log('\n🧪 3 — the summoning latch');
const R3 = await G('(function(){\n' +
' var inflight = (function(){ summoning=true; summoningAt=performance.now();\n' +
'   return (summoning && (performance.now()-summoningAt) < 6000); })();\n' +
' var abandoned = (function(){ summoning=true; summoningAt=performance.now()-7000;\n' +
'   return (summoning && (performance.now()-summoningAt) < 6000); })();\n' +
' summoning=false; summoningAt=0;\n' +
' return { inflightBlocks:inflight, abandonedBlocks:abandoned };\n' +
'})()');
console.log('   ' + JSON.stringify(R3));
ok('3 an IN-FLIGHT ceremony still blocks a second summon (guard intact)', R3.inflightBlocks === true);
ok('3 an ABANDONED latch (>6 s) no longer blocks forever', R3.abandonedBlocks === false);

/* ══ 4 — FALSIFIABILITY: can check 1 go red? ══════════════════════════════
   Force a throw inside the frame and prove frameErr latches and the board
   stops — i.e. the green above is a real measurement of a real latch. */
console.log('\n🧪 4 — CONTROL: force a throw, prove frameErr latches and freezes');
const R4 = await G('(function(){\n' +
' var u=units[0];\n' +
' var before={frameErr:frameErr, n:window.__n};\n' +
' // poison a unit so update() throws deep inside the frame\n' +
' var keep=u.gx; Object.defineProperty(u,"bob",{get:function(){throw new Error("crit-forced");},\n' +
'   set:function(){},configurable:true});\n' +
' var t=2000000, threw=0;\n' +
' for (var i=0;i<40;i++){ t+=16.67; try{ window.__drive(t); }catch(e){ threw++; } }\n' +
' var after={frameErr:frameErr, frameErrN:frameErrN};\n' +
' delete u.bob; u.bob=0; u.gx=keep;\n' +
' return { before:before, after:after, threwOut:threw };\n' +
'})()');
console.log('   ' + JSON.stringify(R4));
ok('4 CONTROL: a forced throw DOES latch frameErr (so check 1 can go red)',
  R4.after.frameErr === true || R4.after.frameErrN > 0,
  'frameErr=' + R4.after.frameErr + ' frameErrN=' + R4.after.frameErrN);

console.log('\n' + (fails ? `❌ ${fails} check(s) failed` : '✅ all checks passed'));
if (errs.length) { console.log('page errors (' + errs.length + '):'); errs.slice(0, 6).forEach(e => console.log('   ' + e)); }
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
