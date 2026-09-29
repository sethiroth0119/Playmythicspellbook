/* ══════════════════════════════════════════════════════════════════════════
   CITY CYCLE LEAK — what LEAVING the city leaves behind.

   bug-muh3ubjb (critical, Mavric, 2026-09-25):
     "App crashes quite a bit the last few days. It crashes every time I leave
      my city. Also, sometimes after leaving my camp. … Certain areas are
      almost always extremely slow … the Foundation Reserve, especially when
      making contributions, and when entering the bank of ethos."

   THE PATH NOTHING HAS MEASURED. The earlier freeze hunt cleared the landing
   screen, 66 screen visits, ten full matches and a 60-turn match, and it found
   no WebGL leak — but every one of those tests stayed in the PARENT document or
   the battle stage. The city is a second same-origin iframe
   (#node-city-frame) carrying its own 3D scene, its own timers and its own
   bridge, and _closeNodeCity tears it down by hand: it renames the id, points
   src at about:blank, removes the node, then clears eight overlays, three
   intervals and a MutationObserver. Anything it forgets survives the city, and
   "every time I leave" is the shape of a cost paid per close.

   So: open the city, leave it, repeat, and count what does not go back down —
   message listeners (17 sites add one), intervals, iframes, canvases, WebGL
   contexts across EVERY frame, DOM nodes and heap.

   ⚠ A CRASH HERE IS THE POINT, NOT A FAILURE. page.on('crash') is watched, and
     the loop reports the cycle it died on, because a renderer that dies is the
     bug being chased rather than an error in the harness.

   Usage: node .gauntlet/city-cycle-leak.mjs [root] [--cycles 8] [--node N-25]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r186/public');
const CYCLES = +flag('cycles', 8);
const NODE = flag('node', 'N-25');

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.gif':'image/gif','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary','.bin':'application/octet-stream','.ttf':'font/ttf','.woff2':'font/woff2','.mp4':'video/mp4' };
const PORT = 9150 + Math.floor(Math.random() * 200);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

/* Installed in EVERY frame, before that frame's first script. */
const INIT = `
(() => {
  const S = { msgAdd: 0, msgRem: 0, addBy: {}, intervals: new Map(), gl: 0, glLost: 0, rafs: 0 };
  window.__C = S;
  const where = () => ((new Error()).stack || '').split('\\n').slice(3,6).map(s => s.trim().replace(/^at /,'').replace(/https?:[^ )]*\\//,'')).join(' < ');
  const proto = EventTarget.prototype, _a = proto.addEventListener, _r = proto.removeEventListener;
  proto.addEventListener = function (t, f, o) {
    if ((this === window || this === document) && t === 'message') {
      S.msgAdd++; const k = where(); S.addBy[k] = (S.addBy[k] || 0) + 1;
    }
    return _a.call(this, t, f, o);
  };
  proto.removeEventListener = function (t, f, o) {
    if ((this === window || this === document) && t === 'message') S.msgRem++;
    return _r.call(this, t, f, o);
  };
  const _si = window.setInterval, _ci = window.clearInterval;
  window.setInterval = function (fn, ms, ...rest) { const id = _si.call(window, fn, ms, ...rest); S.intervals.set(id, { ms, w: where() }); return id; };
  window.clearInterval = function (id) { S.intervals.delete(id); return _ci.call(window, id); };
  const _gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...r) {
    const c = _gc.call(this, t, ...r);
    if (c && /webgl/i.test(String(t))) { S.gl++; try { this.addEventListener('webglcontextlost', () => { S.glLost++; }); } catch (e) {} }
    return c;
  };
  const _raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (fn) { S.rafs++; return _raf.call(window, fn); };
})();
`;

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT);
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });

let crashed = false; page.on('crash', () => { crashed = true; });
const errs = []; page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 180)));
const conErr = []; page.on('console', m => { if (m.type() === 'error') conErr.push(m.text().slice(0, 180)); });

await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});

console.log('══ CITY CYCLE LEAK ══');
console.log('root   : ' + ROOT);
console.log('cycles : ' + CYCLES + '   node: ' + NODE + '\n');

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof render === "function" && typeof App === "object"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(3000);

/* 🔬 FORCED COLLECTION BEFORE EVERY READING. usedJSHeapSize counts garbage that
   simply has not been collected yet, so an un-GC'd sample cannot tell "leaked"
   from "not swept". CDP's HeapProfiler.collectGarbage runs a real full GC, so
   what is left afterwards is RETAINED — which is the only number worth acting
   on, and the difference between a fix and a wild goose chase. */
const cdp = await page.context().newCDPSession(page);
const gc = async () => { try { await cdp.send('HeapProfiler.collectGarbage'); } catch (e) {} };

const census = async () => {
  await gc();
  await page.waitForTimeout(250);
  const top = await page.evaluate(() => {
    const S = window.__C || {};
    const mem = performance.memory || {};
    return {
      heapMB: Math.round((mem.usedJSHeapSize || 0) / 1048576),
      msgLive: (S.msgAdd || 0) - (S.msgRem || 0),
      msgAdd: S.msgAdd || 0, msgRem: S.msgRem || 0,
      intervals: (S.intervals || new Map()).size,
      gl: S.gl || 0, glLost: S.glLost || 0,
      iframes: document.getElementsByTagName('iframe').length,
      cityFrames: document.querySelectorAll('[id^="node-city-frame"]').length,
      canvases: document.getElementsByTagName('canvas').length,
      nodes: document.getElementsByTagName('*').length,
      overlays: document.querySelectorAll('[id^="node-city-"]').length,
    };
  });
  let glAll = 0, glLostAll = 0, frames = 0, childCanvas = 0;
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate(() => ({ gl: (window.__C || {}).gl || 0, lost: (window.__C || {}).glLost || 0, c: document.getElementsByTagName('canvas').length }));
      glAll += r.gl; glLostAll += r.lost; childCanvas += r.c; frames++;
    } catch (e) {}
  }
  return { ...top, glAll, glLostAll, frames, childCanvas };
};

const openCity = () => page.evaluate((n) => {
  /* 🔑 THE FIXTURE IS THE THIRD WAY IN, not a disabled guard. _openNodeCity
     refuses a node that is not yours by land, by mayoral appointment, or by
     "a city of mine already stands here" (App._myCityNodes, built from
     city_state rows where user_id = me). The last one is the honest one to
     stage offline: a player whose own city is on this node. Without it the
     open returns before the iframe is ever built — which is exactly how the
     first run of this probe reported a clean city cycle while never opening
     the city at all. */
  try {
    App._myCityNodes = [String(n)];
    App._cityNodeId = null;
    _openNodeCity(n, true);
    return document.getElementById('node-city-frame') ? 'ok' : 'NO FRAME BUILT';
  } catch (e) { return 'threw: ' + String(e.message).slice(0, 120); }
}, NODE);
const leaveCity = () => page.evaluate(() => {
  try { _closeNodeCity(); return 'ok'; } catch (e) { return 'threw: ' + String(e.message).slice(0, 120); }
});

const base = await census();
console.log('  baseline  heap ' + base.heapMB + 'MB  msgLive ' + base.msgLive + '  intervals ' + base.intervals +
            '  iframes ' + base.iframes + '  gl ' + base.glAll + '  nodes ' + base.nodes + '  frames ' + base.frames + '\n');

const rows = [];
for (let c = 1; c <= CYCLES; c++) {
  if (crashed) { console.log('\n🔴 RENDERER CRASHED during cycle ' + c); break; }
  const o = await openCity();
  await page.waitForTimeout(4500);
  const inC = await census();
  const l = await leaveCity();
  await page.waitForTimeout(1800);
  const out = await census();
  rows.push({ c, inC, out });
  console.log('  cycle ' + String(c).padStart(2) + '  open=' + o + ' leave=' + l);
  console.log('        IN   heap ' + String(inC.heapMB).padStart(4) + 'MB  frames ' + inC.frames + '  cityFrames ' + inC.cityFrames +
              '  gl ' + inC.glAll + '  childCanvas ' + inC.childCanvas + '  msgLive ' + inC.msgLive + '  intervals ' + inC.intervals);
  console.log('        OUT  heap ' + String(out.heapMB).padStart(4) + 'MB  frames ' + out.frames + '  cityFrames ' + out.cityFrames +
              '  gl ' + out.glAll + (out.glLostAll ? ' LOST ' + out.glLostAll : '') + '  msgLive ' + out.msgLive +
              '  intervals ' + out.intervals + '  overlays ' + out.overlays + '  nodes ' + out.nodes);
}

console.log('\n══ WHAT ONE VISIT TO THE CITY COSTS ══');
if (rows.length >= 2) {
  const a = rows[0].out, b = rows[rows.length - 1].out, n = rows.length - 1;
  const per = (k) => Math.round((((b[k] || 0) - (a[k] || 0)) / n) * 100) / 100;
  const show = (k, label, warn) => {
    const v = per(k);
    console.log('  ' + (v > warn ? '⚠ ' : '  ') + label.padEnd(26) + (v >= 0 ? '+' : '') + v + ' per visit   (' + (a[k] || 0) + ' → ' + (b[k] || 0) + ')');
  };
  show('heapMB', 'heap MB', 2);
  show('msgLive', 'live message listeners', 0.2);
  show('intervals', 'live intervals', 0.2);
  show('iframes', 'iframes left in the page', 0.2);
  show('cityFrames', 'city frames left', 0.01);
  show('glAll', 'WebGL contexts created', 0.5);
  show('canvases', 'canvases in the parent', 0.2);
  show('overlays', 'node-city-* overlays left', 0.2);
  show('nodes', 'DOM nodes', 50);
  console.log('    contexts LOST           ' + (b.glLostAll || 0) + ((b.glLostAll || 0) > 0 ? '   🔴 Chromium is force-losing contexts — the crash' : ''));
}

/* who added the message listeners that never came off */
const who = await page.evaluate(() => {
  const S = window.__C || {};
  return { addBy: Object.entries(S.addBy || {}).sort((a, b) => b[1] - a[1]).slice(0, 12),
           intervals: [...(S.intervals || new Map()).values()].reduce((m, v) => { const k = 'every ' + v.ms + 'ms  ' + v.w; m[k] = (m[k] || 0) + 1; return m; }, {}) };
}).catch(() => null);
if (who) {
  if (who.addBy.length) {
    console.log('\n══ message listeners, by who added them ══');
    for (const [k, n] of who.addBy) console.log('  x' + String(n).padStart(3) + '  ' + k.slice(0, 150));
  }
  const iv = Object.entries(who.intervals).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (iv.length) {
    console.log('\n══ live intervals at the end ══');
    for (const [k, n] of iv) console.log('  x' + String(n).padStart(3) + '  ' + k.slice(0, 150));
  }
}
if (errs.length) {
  console.log('\n  pageerror (' + errs.length + ', ' + new Set(errs).size + ' distinct):');
  for (const e of [...new Set(errs)].slice(0, 10)) console.log('    ' + e);
}
const glc = [...new Set(conErr)].filter(m => /webgl|context|gpu|memory|out of/i.test(m));
if (glc.length) { console.log('\n  GL/memory console errors:'); for (const m of glc.slice(0, 8)) console.log('    ' + m); }

console.log('\n  verdict: ' + (crashed ? '🔴 RENDERER CRASHED' : 'survived ' + rows.length + ' city visits'));
await browser.close(); srv.close();
