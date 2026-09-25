/* ══════════════════════════════════════════════════════════════════════════
   BATTLE CYCLE LEAK — what one match leaves behind, ten times over.

   Owner, 2026-09-19: "the game in the browser froze and crashed."

   freeze-hunt.mjs cleared the landing screen (flat over 3 min) and
   freeze-hunt-ingame.mjs cleared the 2D screens (+6MB over 66 visits, and NO
   WebGL context created at all). That last fact is the whole reason this file
   exists: the screens a leak hunt can reach by setting App.screen never build
   a renderer, and the one screen players spend their evening in does.

   A match mounts iframe.bb-stage, which builds a THREE.js scene and takes a
   WebGL context. Chromium allows roughly 16 live contexts per renderer
   process; at the cap it starts FORCE-LOSING the oldest ones, so the symptom
   of this particular leak is not a clean error — it is a board that goes black
   or a tab that dies, which is exactly what was reported.

   So: start a real battle, leave it, start another. Ten times. Count the
   contexts, the canvases, the iframes, the detached-but-live renderers and the
   heap, and report what ONE match costs.

   ⚠ The instrumentation is installed in EVERY frame (addInitScript applies to
     child frames too), because the renderer lives in the iframe, not the page.

   Usage: node .gauntlet/battle-cycle-leak.mjs [root] [--cycles 10]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const ROOT = path.resolve((args[0] && !args[0].startsWith('--')) ? args[0] : 'C:/r185/public');
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const CYCLES = +flag('cycles', 10);

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.gif':'image/gif','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary','.bin':'application/octet-stream','.ttf':'font/ttf','.woff2':'font/woff2' };
const PORT = 9700 + Math.floor(Math.random() * 200);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

/* Counts contexts in whatever frame it is injected into, and — the part that
   matters — keeps a WeakRef to each THREE.WebGLRenderer it sees constructed so
   we can tell "disposed" from "merely unreferenced". */
const INIT = `
(() => {
  const S = { made: 0, lost: 0, restored: 0, disposed: 0, rafLive: new Set(), rafs: 0 };
  window.__GL = S;
  const _gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...r) {
    const c = _gc.call(this, t, ...r);
    if (c && /webgl/i.test(String(t))) {
      S.made++;
      try {
        this.addEventListener('webglcontextlost', () => { S.lost++; });
        this.addEventListener('webglcontextrestored', () => { S.restored++; });
      } catch (e) {}
    }
    return c;
  };
  const _raf = window.requestAnimationFrame, _caf = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (fn) { S.rafs++; let id; id = _raf.call(window, function (t) { S.rafLive.delete(id); return fn.call(this, t); }); S.rafLive.add(id); return id; };
  window.cancelAnimationFrame = function (id) { S.rafLive.delete(id); return _caf.call(window, id); };
  /* wrap dispose() the moment THREE lands, whenever that is */
  let tries = 0;
  const hook = setInterval(() => {
    tries++;
    const T = window.THREE;
    if (T && T.WebGLRenderer && !T.WebGLRenderer.__fhWrapped) {
      const _d = T.WebGLRenderer.prototype.dispose;
      T.WebGLRenderer.prototype.dispose = function () { S.disposed++; return _d && _d.apply(this, arguments); };
      T.WebGLRenderer.__fhWrapped = true;
      clearInterval(hook);
    }
    if (tries > 200) clearInterval(hook);
  }, 100);
})();
`;

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT);
await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });

let crashed = false; page.on('crash', () => { crashed = true; });
const errs = []; page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 180)));
const conMsgs = [];
page.on('console', m => { if (m.type() === 'error') conMsgs.push(m.text().slice(0, 180)); });

await page.route('**/*', r => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('fonts.g') || u.includes('cdn.jsdelivr') || u.includes('cdnjs')) ? r.continue() : r.abort();
});

console.log('══ BATTLE CYCLE LEAK ══');
console.log('root   : ' + ROOT);
console.log('cycles : ' + CYCLES + '\n');

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
await page.evaluate(() => { try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {} });
await page.waitForTimeout(4000);

const census = async () => {
  const top = await page.evaluate(() => {
    const S = window.__GL || {};
    const mem = performance.memory || {};
    return {
      heapMB: Math.round((mem.usedJSHeapSize || 0) / 1048576),
      topMade: S.made || 0, topLost: S.lost || 0, topDisposed: S.disposed || 0,
      iframes: document.getElementsByTagName('iframe').length,
      stages: document.querySelectorAll('iframe.bb-stage').length,
      canvases: document.getElementsByTagName('canvas').length,
      nodes: document.getElementsByTagName('*').length,
    };
  });
  /* every live frame, including the battle stage */
  let made = 0, lost = 0, disposed = 0, rafLive = 0, canv = 0, frames = 0;
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate(() => {
        const S = window.__GL || {};
        return { made: S.made || 0, lost: S.lost || 0, disposed: S.disposed || 0,
                 rafLive: (S.rafLive || new Set()).size, canv: document.getElementsByTagName('canvas').length };
      });
      made += r.made; lost += r.lost; disposed += r.disposed; rafLive += r.rafLive; canv += r.canv; frames++;
    } catch (e) { /* frame detached mid-read — that is itself normal here */ }
  }
  return { ...top, made, lost, disposed, rafLive, canv, frames };
};

const startBattle = () => page.evaluate(() => {
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  App.screen = 'battle'; render();
});
const leaveBattle = () => page.evaluate(() => { App.state = null; App.screen = 'title'; render(); });

const rows = [];
const base = await census();
console.log('  baseline   heap ' + base.heapMB + 'MB  frames ' + base.frames + '  gl(made/lost/disposed) ' +
            base.made + '/' + base.lost + '/' + base.disposed + '  canvas ' + base.canv + '  nodes ' + base.nodes + '\n');

for (let c = 1; c <= CYCLES; c++) {
  if (crashed) { console.log('\n🔴 RENDERER CRASHED during cycle ' + c); break; }
  try { await startBattle(); } catch (e) { console.log('  cycle ' + c + ' start threw: ' + String(e.message).slice(0, 120)); break; }
  await page.waitForTimeout(5000);
  const inB = await census();
  await leaveBattle();
  await page.waitForTimeout(1800);
  const out = await census();
  rows.push({ c, inB, out });
  console.log('  cycle ' + String(c).padStart(2) +
    '  IN: heap ' + String(inB.heapMB).padStart(4) + 'MB gl ' + inB.made + '/' + inB.lost + '/' + inB.disposed + ' cvs ' + inB.canv + ' frm ' + inB.frames +
    '   OUT: heap ' + String(out.heapMB).padStart(4) + 'MB gl ' + out.made + '/' + out.lost + '/' + out.disposed +
    ' cvs ' + out.canv + ' stages ' + out.stages + ' ifr ' + out.iframes + ' raf ' + out.rafLive + ' nodes ' + out.nodes +
    (out.lost > 0 ? '  ⚠ CONTEXT LOST' : ''));
}

console.log('\n══ WHAT ONE MATCH COSTS ══');
if (rows.length >= 2) {
  const a = rows[0].out, b = rows[rows.length - 1].out, n = rows.length - 1;
  const per = (x, y) => Math.round(((y - x) / n) * 10) / 10;
  const line = (k, label, warn) => {
    const v = per(a[k], b[k]);
    console.log('  ' + (v > warn ? '⚠ ' : '  ') + label.padEnd(26) + (v >= 0 ? '+' : '') + v + ' per match   (' + a[k] + ' → ' + b[k] + ')');
  };
  line('heapMB', 'heap MB', 2);
  line('made', 'WebGL contexts created', 0.2);
  line('canv', 'canvas elements', 0.2);
  line('iframes', 'iframes in the page', 0.2);
  line('nodes', 'DOM nodes', 100);
  line('rafLive', 'rAF callbacks pending', 0.5);
  console.log('    contexts LOST so far      ' + b.lost + (b.lost ? '   🔴 Chromium is force-losing contexts' : ''));
  console.log('    renderer.dispose() calls  ' + b.disposed + (b.disposed === 0 && b.made > 1 ? '   🔴 NEVER DISPOSED' : ''));
}
if (errs.length) {
  console.log('\n  pageerror (' + errs.length + ', ' + new Set(errs).size + ' distinct):');
  for (const e of [...new Set(errs)].slice(0, 8)) console.log('    ' + e);
}
if (conMsgs.length) {
  const gl = [...new Set(conMsgs)].filter(m => /webgl|context|gpu|memory/i.test(m));
  if (gl.length) { console.log('\n  GL/console errors:'); for (const m of gl.slice(0, 8)) console.log('    ' + m); }
}
console.log('\n  verdict: ' + (crashed ? '🔴 RENDERER CRASHED' : 'survived ' + rows.length + ' matches'));

await browser.close(); srv.close();
