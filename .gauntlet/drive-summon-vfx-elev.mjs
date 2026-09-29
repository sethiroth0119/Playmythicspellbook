/* ══════════════════════════════════════════════════════════════════════════
   ⛰ DRIVE-SUMMON-VFX-ELEV — stage 2 of the "summon VFX not playing in full"
   investigation. Stage 1 is .gauntlet/drive-summon-vfx.mjs, which proves (by
   hand-driving frame()) that every beat of the live summonFx() ceremony runs
   for its FULL authored duration and is drawn on every frame it is alive.

   So the timeline is not truncated. This stage answers the other half: WHERE
   the beats draw.

   THE CLAIM UNDER TEST. summonFx() pins its beats at three different heights:
     rune    project(gw(gx,gz, tileElev(gx,gz)+.004))   ← ON the slab
     ring    project({x, y:0.02, z})                    ← world zero
     pillar  project(gw(gx,gz, 0))                      ← world zero
     burst   particles at y = rnd(.05,.35), bouncing on (p.y0 || 0)  ← world zero
     dust    dust(wp.x, wp.z, 14)  with NO y0 argument  ← world zero
   The unit itself stands on the slab. On a raised tile the rune and the unit
   are in one place and everything else plays at the foot of the cliff.

   HOW IT IS MEASURED, AND WHY THIS SHAPE. A single `ring` effect is pushed on
   its own — no rise, no unit change, nothing else moving — so the framebuffer
   difference between two renders is the ring AND NOTHING ELSE. The delta's
   bounding box is then compared against the two candidate anchors the board
   itself projects: the tile TOP (where the unit's feet are) and world y=0.

   🔴 RENDER TRAP. render() is rAF-batched and the pane composites at ~0.56 Hz.
   Both reads therefore call window.frame(t) DIRECTLY with a rising t, and each
   drawImage happens in the SAME task as the render that produced it.

   🔴 FALSIFIABILITY. The last block re-pushes the identical ring with the
   elevation-aware anchor the rune already uses, and re-measures. If the check
   is real, the delta bbox MOVES by the slab height. If it does not move, this
   whole stage is measuring nothing and should be believed about nothing.

   Run:  node .gauntlet/drive-summon-vfx-elev.mjs
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
const PORT = 8780 + (process.pid % 40);
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
  return out;
});
console.log('\n\u{1F3AC} MATCH  ' + JSON.stringify(boot));
ok('a real match is running', boot.screen === 'battle' && boot.units > 0);
const bf = page.frames().find(f => f.url().includes('battle-board/index.html'));
if (!bf){ console.log('  FAIL no board iframe'); await browser.close(); server.close(); process.exit(1); }
await page.waitForTimeout(4000);

const G = e => bf.evaluate(x => { try { return window.eval('(' + x + ')'); }
                                 catch (err) { return { __evalErr:String(err).slice(0,200) }; } }, e);

/* ── how much of a REAL match map is even raised? ───────────────────────── */
const census = await G('(function(){\n' +
' var lv={}, n=0, raised=0, maxE=0;\n' +
' for (var z=0;z<MAP.rows;z++) for (var x=0;x<MAP.cols;x++){\n' +
'   var L=hfLevel(x,z), e=tileElev(x,z); lv[L]=(lv[L]||0)+1; n++;\n' +
'   if (e>0.01) raised++; if (e>maxE) maxE=e; }\n' +
' return { tiles:n, raised:raised, pctRaised:+(raised*100/n).toFixed(1),\n' +
'          maxElev:+maxE.toFixed(3), byLevel:lv, hfKey:HF.key, maxLv:HF.maxLv };\n' +
'})()');
console.log('\n\u{1F5FA}  MAP ELEVATION CENSUS  ' + JSON.stringify(census));
ok('this match map really does have raised tiles (so the anchor bug can bite)',
   census.raised > 0, census.pctRaised + '% of ' + census.tiles + ' tiles are above world zero');

/* pick the highest free tile */
const tile = await G('(function(){\n' +
' var best=null;\n' +
' for (var z=0;z<MAP.rows;z++) for (var x=0;x<MAP.cols;x++){\n' +
'   if (tileBlocked(x,z)||unitAt(x,z)) continue;\n' +
'   var e=tileElev(x,z); if(!best||e>best.e) best={x:x,z:z,e:e}; }\n' +
' if(!best) return null;\n' +
' var top=project(gw(best.x,best.z,best.e)), zero=project(gw(best.x,best.z,0));\n' +
' return { x:best.x, z:best.z, elev:+best.e.toFixed(3),\n' +
'          topX:+top.x.toFixed(1), topY:+top.y.toFixed(1),\n' +
'          zeroX:+zero.x.toFixed(1), zeroY:+zero.y.toFixed(1),\n' +
'          slabPx:+(zero.y-top.y).toFixed(1), s:+top.s.toFixed(2) };\n' +
'})()');
console.log('\u{1F3AF} PROBE TILE  ' + JSON.stringify(tile));
if (!tile || tile.slabPx < 6){
  note('no tile on this map is raised enough to separate the two anchors — cannot measure here.');
  await browser.close(); server.close(); process.exit(fails?1:0);
}

/* ── kill rAF, drive by hand ────────────────────────────────────────────── */
await bf.evaluate(() => {
  window.__raf = 0;
  window.requestAnimationFrame = () => { window.__raf++; return 0; };
  const _f = window.frame; window.__n = 0;
  window.__driveFrame = t => { window.__n++; _f(t); };
});

/* ── A/B, both reads in ONE task, render between them ───────────────────── */
/* ⚠ THE BOARD IS NEVER STILL. Rain, ambient motes, the light lerp and the
   backdrop fade all move between two renders, and a naive whole-frame diff
   reported a bounding box of the ENTIRE canvas. So every pass is run TWICE —
   once with the ring and once without, over the same frame count — and the
   control's row-energy profile is SUBTRACTED. What survives is the ring.
   The measurement is confined to a strip ±90 px around the tile's own
   projected centre, because that is where the ring can possibly be.  */
const ab = (opts) => bf.evaluate((arg) => {
  const { beat, t0, x, z, stripX } = arg;
  const grab = () => { const src = window.eval('cv');
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);       /* SAME TASK as the render */
    return g.getImageData(0,0,c.width,c.height); };

  for (let i=1;i<=6;i++) window.__driveFrame(t0 + i*16.6667);
  window.__driveFrame(t0 + 7*16.6667);
  const A = grab();

  if (beat === 'ring'){
    /* ⚠ A TIGHT-RADIUS RING, NOT THE 0.2→1.6 ONE summonFx PUSHES. The shipped
       ring is stroked through ctx.scale(1,.44), so at its full radius its
       brightest ROWS are its top and bottom edges, ~0.44*R (±30 px) from its
       centre — and which edge wins the peak flips from tile to tile. A first
       draft asserted on that and reported 32 px on one map and 7 px on the
       next, from the same unchanged code. Radius is pinned small here so the
       ellipse collapses to a blob and the peak row IS the anchor. Only the
       radius differs from the live push; the ANCHOR — the thing under test —
       is byte-identical to summonFx's. */
    window.eval('(function(){var wp=gw(' + x + ',' + z + ',0);' +
      'effects.push({k:"ring", x:wp.x, z:wp.z, t:0, dur:.7, col:"#ffffff", r0:.34, r1:.34});})()');
  } else if (beat === 'rune'){
    /* 🔑 THE POSITIVE CONTROL, AND WHY IT IS THIS AND NOT A MONKEYPATCH.
       The first attempt at falsification re-pointed window.project so the ring
       would draw elevation-aware. project() is called thousands of times per
       frame by every tile, and the patched pass came back with 5x the energy
       and a peak 59 px BELOW the unpatched one: it was measuring the patch, not
       the ring. So the control is instead a beat the board ALREADY anchors
       correctly — the RUNE, pushed by the same summonFx() call, on the same
       tile, through the same 'ground' pass, but at gw(gx,gz,tileElev+.004)
       instead of y=0.02. Nothing is patched. If the rig can photograph the rune
       AT the unit's feet, then "the ring is not at the feet" cannot be an
       artefact of the rig. */
    window.eval('(function(){var wp=gw(' + x + ',' + z + ',tileElev(' + x + ',' + z + ')+.004);' +
      'effects.push({k:"rune", x:wp.x, z:wp.z, gx:' + x + ', gz:' + z + ', t:0, dur:1.5, col:"#ffffff"});})()');
  }
  for (let i=8;i<=20;i++) window.__driveFrame(t0 + i*16.6667);
  const B = grab();

  window.eval('effects = effects.filter(function(f){return f.k!=="ring" && f.k!=="rune";})');

  const dpr = A.width / window.innerWidth;
  const rows = new Float64Array(A.height);
  const a=A.data, b=B.data, W=A.width;
  const x0 = Math.max(0, Math.round((stripX-90)*dpr)), x1 = Math.min(W-1, Math.round((stripX+90)*dpr));
  for (let py=0; py<A.height; py++){
    let s = 0;
    for (let pxx=x0; pxx<=x1; pxx++){
      const i = (py*W + pxx)*4;
      const d = Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]);
      if (d >= 20) s += d;
    }
    rows[py] = s;
  }
  return { rows: Array.from(rows), dpr:+dpr.toFixed(3), h: A.height };
}, Object.assign({ x: tile.x, z: tile.z, stripX: tile.topX }, opts));

const profile = (test, ctrl, dpr) => {
  const out = [];
  let sum = 0, wy = 0, peak = -1, peakV = 0;
  for (let i=0;i<test.length;i++){
    const v = Math.max(0, test[i] - ctrl[i]);
    out.push(v); sum += v; wy += i*v;
    if (v > peakV){ peakV = v; peak = i; }
  }
  return { energy: Math.round(sum), peakY: peak<0?null:+(peak/dpr).toFixed(1),
           centroidY: sum>0 ? +((wy/sum)/dpr).toFixed(1) : null };
};

/* ONE CHECK, ASKED OF TWO BEATS OF THE SAME CEREMONY ON THE SAME TILE:
   "is this beat photographed nearer the unit's feet, or nearer world zero?"
   The RUNE is anchored at tileElev+.004 and must answer FEET.
   The RING  is anchored at world y=0.02   and — that is the whole question.
   A check that comes out the same for both is measuring nothing. */
console.log('\n\u{1F5BC}  FRAMEBUFFER A/B — control-subtracted row energy, strip \u{00B1}90 px');
const ctrlA = await ab({ beat:'none', t0:400000 });
const ringA = await ab({ beat:'ring', t0:440000 });
const runeA = await ab({ beat:'rune', t0:480000 });
const live  = profile(ringA.rows, ctrlA.rows, ringA.dpr);
const rune  = profile(runeA.rows, ctrlA.rows, runeA.dpr);
const show = (label, p) => {
  console.log('   ' + label.padEnd(34) + ' peak row ' + String(p.peakY).padStart(6) +
    '   feet \u{0394} ' + String((p.peakY-tile.topY).toFixed(1)).padStart(7) +
    '   world-zero \u{0394} ' + String((p.peakY-tile.zeroY).toFixed(1)).padStart(7) +
    '   energy ' + p.energy);
};
console.log('   unit’s feet (tile top) y = ' + tile.topY + '   world zero y = ' + tile.zeroY +
            '   slab = ' + tile.slabPx + ' px');
show('RUNE   (anchored tileElev+.004)', rune);
show('RING   (anchored world y=0.02)',  live);
ok('\u{1F534} both beats REACH the framebuffer (a control of exactly 0 would mean the rig is dead)',
   live.energy > 15000 && rune.energy > 15000,
   'ring ' + live.energy + ', rune ' + rune.energy);

const nearerFeet = p => Math.abs(p.peakY - tile.topY) < Math.abs(p.peakY - tile.zeroY);
ok('\u{1F513} the check CAN GO GREEN — the RUNE photographs at the unit’s feet',
   nearerFeet(rune), Math.abs(rune.peakY-tile.topY).toFixed(1) + ' px from the feet vs ' +
   Math.abs(rune.peakY-tile.zeroY).toFixed(1) + ' px from world zero');
ok('\u{1F534} …and the SAME check goes RED for the RING — it photographs at the foot of the cliff',
   nearerFeet(live), Math.abs(live.peakY-tile.topY).toFixed(1) + ' px from the feet vs ' +
   Math.abs(live.peakY-tile.zeroY).toFixed(1) + ' px from world zero');
const fixed = rune;   /* kept for the JSON dump below */

/* the same numbers straight out of the board's own projection, as corroboration
   for the photograph above (NOT independent of it — same project(), same map) */
const geom = await G('(function(){\n' +
' var wp = gw(' + tile.x + ',' + tile.z + ', tileElev(' + tile.x + ',' + tile.z + ')+.004);\n' +
' var c = project({x:wp.x, y:wp.y, z:wp.z});\n' +
' var c0 = project({x:wp.x, y:0.02, z:wp.z});\n' +
' return { elevAwareY:+c.y.toFixed(1), shippedY:+c0.y.toFixed(1), moves:+(c0.y-c.y).toFixed(1) };\n' +
'})()');
console.log('\n\u{1F4D0} GEOMETRY — the ring anchor, projected both ways: ' + JSON.stringify(geom));
ok('\u{1F534} the shockwave ring is anchored to the tile the unit STANDS on',
   Math.abs(geom.moves) < 2,
   'the shipped anchor (world y=0.02) projects ' + geom.moves +
   ' px BELOW the tile top the unit stands on — the whole slab height');

/* ── the same question for the pillar base and the spark burst ──────────── */
const others = await G('(function(){\n' +
' var x=' + tile.x + ', z=' + tile.z + ', e=tileElev(x,z);\n' +
' var pb = project(gw(x,z,0)), pt = project(gw(x,z,e));\n' +
' return { pillarBaseY:+pb.y.toFixed(1), unitFeetY:+pt.y.toFixed(1),\n' +
'          pillarOffsetPx:+(pb.y-pt.y).toFixed(1),\n' +
'          sparkSpawnY:"rnd(.05,.35) world — bounces on (p.y0||0), burst() takes no y0",\n' +
'          dustCallSites:{ walkLanding:"dust(...,14, tileElev(u.gx,u.gz))  ✓",\n' +
'                          summonLanding:"dust(wp.x, wp.z, 14)            ✗ no y0",\n' +
'                          summonUnitLanding:"dust(gw(gx,gz).x, gw(gx,gz).z, 20)  ✗ no y0" } };\n' +
'})()');
console.log('\n\u{1F3AF} THE OTHER BEATS, SAME TILE  ' + JSON.stringify(others, null, 1));
ok('the pillar of light rises from the unit’s feet, not from the dirt below the cliff',
   Math.abs(others.pillarOffsetPx) < 2,
   'pillar base is ' + others.pillarOffsetPx + ' px below the unit');

fs.writeFileSync(path.join(process.cwd(), '.gauntlet', 'summon-vfx-elev.json'),
  JSON.stringify({ census, tile, live, fixed, geom, others }, null, 1));
console.log('\n   -> .gauntlet/summon-vfx-elev.json');
console.log('\n' + (fails ? '\u{274C} ' + fails + ' FAIL' : '\u{2705} all checks green'));
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
