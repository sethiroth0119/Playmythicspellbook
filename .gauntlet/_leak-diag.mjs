/* Focused diagnosis for the three leaking sites freeze-hunt-ingame found.
   Alternates the screens that mount them and reports, per lap, how many
   listeners were ADDED vs REMOVED and what the mount guards believe. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'C:/r185/public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const P = 9900 + Math.floor(Math.random() * 90);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox','--enable-precise-memory-info'] });
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
await pg.addInitScript(`(() => {
  const T = { add: [], rem: [] }; window.__T = T;
  const proto = EventTarget.prototype, _a = proto.addEventListener, _r = proto.removeEventListener;
  const where = () => ((new Error()).stack || '').split('\\n').slice(2,5).map(s=>s.trim().replace(/^at /,'').replace(/https?:[^ )]*\\//,'')).join(' < ');
  proto.addEventListener = function (t, f, o) { if (this === window || this === document) T.add.push({ t, tgt: this===window?'window':'document', w: where() }); return _a.call(this, t, f, o); };
  proto.removeEventListener = function (t, f, o) { if (this === window || this === document) T.rem.push({ t, tgt: this===window?'window':'document', w: where() }); return _r.call(this, t, f, o); };
})();`);
await pg.addInitScript(() => { try { localStorage.setItem('mg_onboarded','1'); } catch(e){} });
await pg.route('**/*', r => { const u = r.request().url();
  if (u.includes('127.0.0.1')||u.includes('fonts.g')||u.includes('cdn.jsdelivr')||u.includes('cdnjs')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:'+P+'/index.html', { waitUntil:'domcontentloaded', timeout:120000 });
await pg.waitForFunction('typeof render === "function" && typeof App === "object"', null, { timeout: 180000 });
await pg.evaluate(() => { const g = document.getElementById('auth-gate'); if (g) g.remove(); });
await pg.waitForTimeout(2500);

const snap = () => pg.evaluate(() => {
  const T = window.__T;
  const count = (arr, t) => arr.filter(x => x.t === t).length;
  return {
    msgAdd: count(T.add,'message'), msgRem: count(T.rem,'message'),
    keyAdd: count(T.add,'keydown'), keyRem: count(T.rem,'keydown'),
    jbBound: !!(window.App && App._jbMsgBound),
    bbBound: !!(window.App && (App._bbMsgBound || App._baseMsgBound)),
    nodes: document.getElementsByTagName('*').length,
    heap: Math.round((performance.memory||{}).usedJSHeapSize/1048576),
  };
});

console.log('══ LEAK DIAG  root=' + ROOT + ' ══');
let prev = await snap();
console.log('baseline  msg +' + prev.msgAdd + '/-' + prev.msgRem + '  keydown +' + prev.keyAdd + '/-' + prev.keyRem + '  jbBound=' + prev.jbBound + '  nodes=' + prev.nodes);

for (let lap = 1; lap <= 5; lap++) {
  for (const s of ['justBusiness', 'title', 'camp', 'title']) {
    await pg.evaluate(scr => { App.screen = scr; render(); }, s);
    await pg.waitForTimeout(700);
  }
  const n = await snap();
  console.log('lap ' + lap +
    '  msg +' + (n.msgAdd - prev.msgAdd) + '/-' + (n.msgRem - prev.msgRem) +
    '  keydown +' + (n.keyAdd - prev.keyAdd) + '/-' + (n.keyRem - prev.keyRem) +
    '  jbBound=' + n.jbBound +
    '  nodes ' + n.nodes + ' (+' + (n.nodes - prev.nodes) + ')' +
    '  heap ' + n.heap + 'MB');
  prev = n;
}

const detail = await pg.evaluate(() => {
  const T = window.__T, g = {};
  for (const x of T.add) { const k = x.tgt + ':' + x.t + ' @ ' + x.w; g[k] = (g[k]||0)+1; }
  const r = {};
  for (const x of T.rem) { const k = x.tgt + ':' + x.t + ' @ ' + x.w; r[k] = (r[k]||0)+1; }
  return { adds: Object.entries(g).sort((a,b)=>b[1]-a[1]).slice(0,12), rems: Object.entries(r).sort((a,b)=>b[1]-a[1]).slice(0,12) };
});
console.log('\n── ADDS ──');
for (const [k,n] of detail.adds) console.log('  x'+String(n).padStart(3)+'  '+k.slice(0,145));
console.log('\n── REMOVES ──');
if (!detail.rems.length) console.log('  (none at all)');
for (const [k,n] of detail.rems) console.log('  x'+String(n).padStart(3)+'  '+k.slice(0,145));

await b.close(); srv.close();
