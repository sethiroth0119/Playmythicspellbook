/* ══════════════════════════════════════════════════════════════════════════
   FREEZE HUNT — IN GAME. The landing screen is stable (freeze-hunt.mjs, live,
   3 min: heap flat at 33MB, 162 nodes). A player's tab does not die on the
   sign-in gate, so this one gets PAST it and does what a player does: moves
   between screens, over and over, for as long as you ask.

   WHY SCREEN CHURN IS THE RIGHT LOAD. Nothing in this app runs forever on one
   screen — the player walks the hub, opens the market, plays a match, comes
   back. Every one of those transitions is a chance to build something and not
   tear it down: a WebGL context, an interval, a window listener, a detached
   subtree. A leak of 2MB per visit is invisible in one visit and fatal in an
   hour, and this is the only way to see it in three minutes.

   It reuses _shot-screen.mjs's boot exactly (local static server over public/,
   remove #auth-gate, set App.screen + render()) because that is the idiom in
   this repo that is known to work against the real index.html, and the
   instrumentation from freeze-hunt.mjs, installed before the first page
   script.

   Usage:
     node .gauntlet/freeze-hunt-ingame.mjs [--root public] [--laps 6]
                                           [--screens a,b,c] [--dwell 1200]
                                           [--json out.json]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROOT = path.resolve(process.cwd(), flag('root', 'public'));
const LAPS = +flag('laps', 6);
const DWELL = +flag('dwell', 1200);
const JSON_OUT = flag('json', null);
const SCREENS = flag('screens',
  'title,camp,market,cardShop,deck,collection,justBusiness,vendorMarket,leaderboard,friends,settings').split(',');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jsx': 'text/babel',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
const PORT = 9600 + Math.floor(Math.random() * 300);
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const INIT = `
(() => {
  const M = { intervals: new Map(), timeouts: new Map(), rafs: 0, rafLive: new Set(),
              listeners: new Map(), longTasks: [], errors: [], glContexts: 0, glLost: 0,
              intervalStacks: new Map(), listenerStacks: new Map() };
  window.__FH = M;
  const shortStack = () => {
    const s = (new Error()).stack || '';
    return s.split('\\n').slice(2, 6).map(l => l.trim().replace(/^at /, '').replace(/https?:[^ )]*\\//, '')).join(' < ');
  };
  const _si = window.setInterval, _ci = window.clearInterval;
  window.setInterval = function (fn, ms, ...rest) {
    const id = _si.call(window, fn, ms, ...rest);
    M.intervals.set(id, { ms, stack: shortStack() });
    return id;
  };
  window.clearInterval = function (id) { M.intervals.delete(id); return _ci.call(window, id); };
  const _st = window.setTimeout, _ct = window.clearTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    let id;
    id = _st.call(window, function () { M.timeouts.delete(id); return fn.apply(this, arguments); }, ms, ...rest);
    M.timeouts.set(id, { ms });
    return id;
  };
  window.clearTimeout = function (id) { M.timeouts.delete(id); return _ct.call(window, id); };
  const _raf = window.requestAnimationFrame, _caf = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (fn) {
    M.rafs++;
    let id; id = _raf.call(window, function (t) { M.rafLive.delete(id); return fn.call(this, t); });
    M.rafLive.add(id); return id;
  };
  window.cancelAnimationFrame = function (id) { M.rafLive.delete(id); return _caf.call(window, id); };
  const proto = EventTarget.prototype;
  const _ael = proto.addEventListener, _rel = proto.removeEventListener;
  const keyOf = (t, type) => (t === window ? 'window:' : t === document ? 'document:' : 'element:') + type;
  proto.addEventListener = function (type, fn, opts) {
    const k = keyOf(this, type);
    const e = M.listeners.get(k) || { add: 0, rem: 0 };
    e.add++; M.listeners.set(k, e);
    if ((this === window || this === document)) {
      const sk = k + ' @ ' + shortStack();
      M.listenerStacks.set(sk, (M.listenerStacks.get(sk) || 0) + 1);
    }
    return _ael.call(this, type, fn, opts);
  };
  proto.removeEventListener = function (type, fn, opts) {
    const k = keyOf(this, type);
    const e = M.listeners.get(k) || { add: 0, rem: 0 };
    e.rem++; M.listeners.set(k, e);
    return _rel.call(this, type, fn, opts);
  };
  const _gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = _gc.call(this, type, ...rest);
    if (ctx && /webgl/i.test(String(type))) {
      M.glContexts++;
      try { this.addEventListener('webglcontextlost', () => { M.glLost++; }); } catch (e) {}
    }
    return ctx;
  };
  try {
    new PerformanceObserver(list => {
      for (const t of list.getEntries()) if (t.duration >= 200) M.longTasks.push({ dur: Math.round(t.duration), at: Math.round(t.startTime) });
      if (M.longTasks.length > 500) M.longTasks.splice(0, M.longTasks.length - 500);
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}
  window.addEventListener('error', e => { M.errors.push(String((e && e.message) || e).slice(0, 200)); if (M.errors.length > 200) M.errors.shift(); });
})();
`;

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT);
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });

let crashed = false;
page.on('crash', () => { crashed = true; });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));

/* Only local + the CDNs index.html genuinely needs; everything else is aborted
   so a slow third party cannot be mistaken for a freeze. */
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('fonts.googleapis') || u.includes('fonts.gstatic') || u.includes('cdn.jsdelivr') || u.includes('cdnjs.cloudflare')) return r.continue();
  return r.abort();
});

console.log('══ FREEZE HUNT — IN GAME ══');
console.log('root    : ' + ROOT);
console.log('screens : ' + SCREENS.join(' → '));
console.log('laps    : ' + LAPS + '   dwell ' + DWELL + 'ms\n');

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof render === "function" && typeof App === "object"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(3000);

const read = async () => {
  const probe = page.evaluate(() => {
    const M = window.__FH || {};
    const L = {};
    for (const [k, v] of (M.listeners || new Map())) { const live = v.add - v.rem; if (live > 0) L[k] = live; }
    const mem = performance.memory || {};
    return {
      heapMB: Math.round((mem.usedJSHeapSize || 0) / 1048576),
      intervals: (M.intervals || new Map()).size,
      timeouts: (M.timeouts || new Map()).size,
      rafLive: (M.rafLive || new Set()).size,
      listenerTotal: Object.values(L).reduce((a, b) => a + b, 0),
      listeners: L,
      domNodes: document.getElementsByTagName('*').length,
      canvases: document.getElementsByTagName('canvas').length,
      iframes: document.getElementsByTagName('iframe').length,
      glContexts: M.glContexts || 0,
      glLost: M.glLost || 0,
      longTasks: (M.longTasks || []).length,
      worstTask: (M.longTasks || []).reduce((a, t) => Math.max(a, t.dur), 0),
      errors: (M.errors || []).length,
    };
  });
  const to = new Promise((_, rej) => setTimeout(() => rej(new Error('MAIN THREAD DID NOT ANSWER IN 15s')), 15000));
  return Promise.race([probe, to]);
};

const rows = [];
let frozen = null;
const base = await read();
console.log('  baseline  heap ' + base.heapMB + 'MB  nodes ' + base.domNodes + '  intervals ' + base.intervals +
            '  listeners ' + base.listenerTotal + '  canvas ' + base.canvases + '  gl ' + base.glContexts + '\n');

outer:
for (let lap = 1; lap <= LAPS; lap++) {
  for (const scr of SCREENS) {
    if (crashed) { console.log('\n🔴 RENDERER CRASHED on ' + scr + ' (lap ' + lap + ')'); break outer; }
    const t = Date.now();
    try {
      await page.evaluate((s) => { App.screen = s; render(); }, scr);
    } catch (e) {
      console.log('  lap ' + lap + ' ' + scr.padEnd(14) + ' RENDER THREW: ' + String(e.message).slice(0, 110));
      continue;
    }
    await page.waitForTimeout(DWELL);
    let s;
    try { s = await read(); }
    catch (e) { frozen = { lap, scr, why: e.message }; console.log('\n🔴 FROZE on ' + scr + ' (lap ' + lap + ') — ' + e.message); break outer; }
    s.lap = lap; s.screen = scr; s.renderMs = Date.now() - t;
    rows.push(s);
    if (lap === 1 || lap === LAPS || s.heapMB - base.heapMB > 150) {
      console.log('  lap ' + lap + ' ' + scr.padEnd(14) +
        ' heap ' + String(s.heapMB).padStart(5) + 'MB' +
        '  nodes ' + String(s.domNodes).padStart(6) +
        '  int ' + String(s.intervals).padStart(3) +
        '  lis ' + String(s.listenerTotal).padStart(5) +
        '  cvs ' + String(s.canvases).padStart(3) +
        '  gl ' + String(s.glContexts).padStart(3) + (s.glLost ? ' LOST' + s.glLost : '') +
        '  ifr ' + s.iframes +
        (s.worstTask ? '  worst ' + s.worstTask + 'ms' : ''));
    }
  }
  if (lap === 1) console.log('  …');
}

console.log('\n══ PER-SCREEN COST (what one visit leaves behind) ══');
console.log('  screen          Δheap/visit  Δnodes/visit  Δlisteners/visit  Δintervals/visit  Δgl');
for (const scr of SCREENS) {
  const mine = rows.filter(r => r.screen === scr);
  if (mine.length < 2) continue;
  const a = mine[0], b = mine[mine.length - 1], n = mine.length - 1;
  const per = (x, y) => Math.round(((y - x) / n) * 10) / 10;
  const dh = per(a.heapMB, b.heapMB), dn = per(a.domNodes, b.domNodes),
        dl = per(a.listenerTotal, b.listenerTotal), di = per(a.intervals, b.intervals),
        dg = per(a.glContexts, b.glContexts);
  const bad = dh > 2 || dn > 150 || dl > 2 || di > 0.5 || dg > 0.5;
  console.log('  ' + (bad ? '⚠ ' : '  ') + scr.padEnd(15) +
    String(dh).padStart(9) + 'MB' + String(dn).padStart(13) + String(dl).padStart(18) +
    String(di).padStart(18) + String(dg).padStart(6));
}

const last = rows[rows.length - 1];
if (last) {
  console.log('\n══ TOTAL DRIFT over ' + rows.length + ' screen visits ══');
  const d = (k) => (last[k] - base[k] >= 0 ? '+' : '') + (last[k] - base[k]);
  console.log('    heap       ' + base.heapMB + 'MB → ' + last.heapMB + 'MB  (' + d('heapMB') + ')');
  console.log('    domNodes   ' + base.domNodes + ' → ' + last.domNodes + '  (' + d('domNodes') + ')');
  console.log('    intervals  ' + base.intervals + ' → ' + last.intervals + '  (' + d('intervals') + ')');
  console.log('    timeouts   ' + base.timeouts + ' → ' + last.timeouts + '  (' + d('timeouts') + ')');
  console.log('    listeners  ' + base.listenerTotal + ' → ' + last.listenerTotal + '  (' + d('listenerTotal') + ')');
  console.log('    canvases   ' + base.canvases + ' → ' + last.canvases + '  (' + d('canvases') + ')');
  console.log('    gl ctx     ' + base.glContexts + ' → ' + last.glContexts + '  (' + d('glContexts') + ')' + (last.glLost ? '  ⚠ ' + last.glLost + ' CONTEXTS LOST' : ''));
  console.log('    worst task ' + last.worstTask + 'ms');

  const grew = Object.keys(last.listeners).map(k => ({ k, d: (last.listeners[k] || 0) - (base.listeners[k] || 0), now: last.listeners[k] }))
    .filter(x => x.d > 2).sort((a, b) => b.d - a.d).slice(0, 15);
  if (grew.length) {
    console.log('\n  listener kinds that GREW:');
    for (const x of grew) console.log('    +' + String(x.d).padStart(5) + '  now ' + String(x.now).padStart(6) + '  ' + x.k);
  }
}

/* WHO created the intervals and the window/document listeners that are still
   live. A count says there is a leak; this says which line to open. */
const who = await page.evaluate(() => {
  const M = window.__FH || {};
  const byStack = new Map();
  for (const [, v] of (M.intervals || new Map())) {
    const k = 'every ' + v.ms + 'ms  ' + v.stack;
    byStack.set(k, (byStack.get(k) || 0) + 1);
  }
  return {
    intervals: [...byStack.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    listenerStacks: [...(M.listenerStacks || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    errors: [...new Set(M.errors || [])].slice(0, 15),
  };
}).catch(() => null);

if (who) {
  if (who.intervals.length) {
    console.log('\n══ LIVE INTERVALS, by who started them ══');
    for (const [k, n] of who.intervals) console.log('  x' + String(n).padStart(3) + '  ' + k.slice(0, 150));
  }
  if (who.listenerStacks.length) {
    console.log('\n══ window/document LISTENERS, by who added them ══');
    for (const [k, n] of who.listenerStacks) console.log('  x' + String(n).padStart(4) + '  ' + k.slice(0, 150));
  }
  if (who.errors.length) {
    console.log('\n══ DISTINCT PAGE ERRORS ══');
    for (const e of who.errors) console.log('  ' + e);
  }
}
if (pageErrors.length) {
  console.log('\n  pageerror: ' + pageErrors.length + ' (' + new Set(pageErrors).size + ' distinct)');
  for (const e of [...new Set(pageErrors)].slice(0, 8)) console.log('    ' + e);
}

console.log('\n  verdict: ' + (crashed ? '🔴 RENDERER CRASHED' : frozen ? '🔴 FROZE on ' + frozen.scr : '✅ survived ' + rows.length + ' screen visits'));
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify({ base, rows, who, pageErrors, crashed, frozen }, null, 2)); console.log('  json → ' + JSON_OUT); }

await browser.close();
srv.close();
