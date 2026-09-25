/* ══════════════════════════════════════════════════════════════════════════
   🎨 DRIVE-VAN-LIVERY — the fail-closed proof, and the van actually changing

   Two things have to be true and they are tested very differently.

   ── 1. THE SAFETY PROPERTY ────────────────────────────────────────────────
   An uploaded logo must be invisible in every state except 'approved'. This is
   not a "does the happy path work" test — the happy path working proves almost
   nothing here. What matters is the NINE other states, so every one of them is
   driven through the real renderPlan() and asserted to yield no logo.

   ⚠ THE CONTROL IS 'approved'. If the only assertions were "these states show
     nothing", a renderPlan() that returned null unconditionally would score a
     perfect pass while shipping a feature that never works. So 'approved' must
     PRODUCE a url in the same run, from the same function, with the same input
     shape. One test, both directions.

   ── 2. THE VAN ───────────────────────────────────────────────────────────
   Paint is the half that needs no review, so it is the half that has to be
   visibly real. The driver builds the actual WHTruck, reads the paint
   material's colour, applies a livery, and reads it again — with a control that
   asserts the wheels and glass did NOT move, because "recolour the van" is one
   sloppy traverse away from "recolour everything including the tyres".

   ⚠ NO FRAMEBUFFER READS. Per .gauntlet/README.md item 6 the pane composites
     at ~0.56 Hz and an A/B of the rendered frame reports a confident, wrong
     zero. Material colours and scene-graph membership are read directly
     instead, which is what actually determines what would be drawn.

   Run:  node .gauntlet/drive-van-livery.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const P = 9300 + Math.floor(Math.random() * 500);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + P;

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g')) return r.continue();
  return r.abort();
});
await pg.goto(base + '/warehouse/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.WHTruck && !!window.THREE', null, { timeout: 120000 });
await pg.waitForTimeout(3000);

/* ── 1. THE VISIBILITY MATRIX ───────────────────────────────────────────── */
const vis = await pg.evaluate(async (v) => {
  const L = await import('/src/livery/livery.js?v=' + v);
  const STATES = ['none', 'uploaded', 'scanning', 'scan_failed', 'rejected',
                  'frozen', 'awaiting_review', 'revoked', 'approved'];
  const out = {};
  for (const st of STATES) {
    // Identical input every time. The ONLY thing that varies is the status.
    const plan = L.renderPlan({
      paint: '#2f4f43', accent: '#d9c079', emblem: 'cog', fleet_name: 'Ashvane',
      logo_status: st, logoUrl: 'https://example.invalid/logo.png',
    });
    out[st] = { logo: plan.logoUrl, paint: plan.paint, emblem: plan.emblem };
  }
  // …and an outright unknown state, which must also be invisible.
  const junk = L.renderPlan({ logo_status: 'definitely_fine_ship_it', logoUrl: 'https://x.invalid/a.png' });
  out.__junk = { logo: junk.logoUrl };
  out.__statusUnknown = L.statusInfo('definitely_fine_ship_it').say;
  return out;
}, 'test');

/* ── 2. VALIDATION MIRRORS THE SQL ──────────────────────────────────────── */
const valid = await pg.evaluate(async (v) => {
  const L = await import('/src/livery/livery.js?v=' + v);
  const f = (type, size) => ({ type, size, name: 'x' });
  return {
    tooBig:  L.checkFile(f('image/png', 3 * 1024 * 1024)).ok,
    badType: L.checkFile(f('image/gif', 1000)).ok,
    svg:     L.checkFile(f('image/svg+xml', 1000)).ok,   // scriptable — must be refused
    empty:   L.checkFile(f('image/png', 0)).ok,
    good:    L.checkFile(f('image/webp', 50000)).ok,
    // Placement cannot be walked off the panel.
    farX:    L.clampPlace('side', { x: 99, y: 0, s: 1, r: 0 }).x,
    fullS:   L.clampPlace('side', { x: 99, y: 0, s: 1, r: 0 }).x,
    halfX:   L.clampPlace('side', { x: 99, y: 0, s: 0.5, r: 0 }).x,
    nanX:    L.clampPlace('side', { x: NaN, y: 0, s: 1, r: 0 }).x,
    hugeS:   L.clampPlace('side', { x: 0, y: 0, s: 40, r: 0 }).s,
    // Colour must be pinned — it reaches a THREE material and CSS.
    badHex:  L.normalise({ paint: 'red; }--x:' }).paint,
    okHex:   L.normalise({ paint: '#123ABC' }).paint,
    badEmb:  L.normalise({ emblem: '../../etc/passwd' }).emblem,
  };
}, 'test');

/* ── 3. THE VAN ACTUALLY CHANGES ────────────────────────────────────────── */
const van = await pg.evaluate(async (v) => {
  const D = await import('/src/livery/decal.js?v=' + v);
  const T = window.THREE;
  const truck = window.WHTruck.build(T, { profile: 'squircle', doorOpen: true, cargoOpen: true });

  const sample = () => {
    const o = { paint: null, rubber: null, glass: null, decals: 0 };
    truck.traverse((n) => {
      if (n.userData && n.userData.__livery) { o.decals++; return; }
      if (!n.isMesh || !n.material) return;
      const list = Array.isArray(n.material) ? n.material : [n.material];
      list.forEach((m) => {
        if (!m || !m.color) return;
        const base = m.userData.__basePaint !== undefined ? m.userData.__basePaint : m.color.getHex();
        if (base === 0xe8e4da && o.paint === null) o.paint = m.color.getHex();
        if (base === 0x121417 && o.rubber === null) o.rubber = m.color.getHex();   // tyres
        if (base === 0x1b2634 && o.glass === null) o.glass = m.color.getHex();     // glass
      });
    });
    return o;
  };

  const before = sample();
  D.applyLivery(T, truck, {
    paint: '#2f4f43', accent: '#d9c079', emblem: 'cog', fleet_name: 'Ashvane Haulage',
    logo_status: 'none',
  }, { dims: window.WHTruck.DIMS, document });
  const after = sample();

  // Re-apply — decals must NOT stack. The player drags a slider; this runs a lot.
  D.applyLivery(T, truck, { paint: '#7d2320', accent: '#e8cea0', emblem: 'star', fleet_name: 'Ashvane Haulage' },
    { dims: window.WHTruck.DIMS, document });
  const twice = sample();

  // An UNAPPROVED logo url must never reach the mesh. renderPlan strips it, so
  // this asserts the whole chain and not just the pure function.
  D.applyLivery(T, truck, {
    paint: '#2f4f43', accent: '#d9c079', emblem: 'cog',
    logo_status: 'awaiting_review', logoUrl: 'https://example.invalid/nope.png',
  }, { dims: window.WHTruck.DIMS, document });
  let sawUrl = false;
  truck.traverse((n) => {
    if (n.userData && n.userData.__livery && n.material && n.material.map
        && n.material.map.image && n.material.map.image.src) sawUrl = true;
  });

  return { before, after, twice, sawUrl,
           decalsAfter: after.decals, decalsTwice: twice.decals };
}, 'test');

/* ── 4. THE PAGE'S OWN WIRING ───────────────────────────────────────────── */
const page = await pg.evaluate(() => ({
  wrapBtn: !!document.getElementById('b-wrap'),
  // Hidden until the module proves it mounted.
  wrapVisible: (() => { const b = document.getElementById('b-wrap'); return !!b && b.style.display !== 'none'; })(),
  shopMounted: !!document.getElementById('wrapshop'),
  // Standalone (unbridged) the upload path must REFUSE, not pretend.
  hasUpload: typeof WH.liveryUpload === 'function',
}));
const refuses = await pg.evaluate(async () => {
  const r = await WH.liveryUpload(new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
  return r;
});

/* ── 5. CONTROL · the modules are missing ───────────────────────────────── */
const pg2 = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs2 = []; pg2.on('pageerror', e => errs2.push(String(e).slice(0, 150)));
await pg2.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('/src/livery/')) return r.abort();            // 🔴 kill it
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g')) return r.continue();
  return r.abort();
});
await pg2.goto(base + '/warehouse/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg2.waitForTimeout(7000);
const fallback = await pg2.evaluate(() => {
  const b = document.getElementById('b-wrap');
  return { hidden: !b || b.style.display === 'none',
           truckStillThere: !!(window.App && App.truck),
           shopAbsent: !document.getElementById('wrapshop') };
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F3A8} VAN LIVERY · NOTHING GOES ON THE ROAD UNTIL IT IS SIGNED OFF\n');

console.log('  ── the visibility matrix (the safety property)');
for (const st of ['none', 'uploaded', 'scanning', 'scan_failed', 'rejected', 'frozen', 'awaiting_review', 'revoked']) {
  ok('\u{1F3AF} ' + st.padEnd(15) + ' → no logo', vis[st] && vis[st].logo === null, String(vis[st] && vis[st].logo));
}
ok('\u{1F3AF} an UNKNOWN status → no logo', vis.__junk.logo === null, String(vis.__junk.logo));
ok('…and it reads as not-live in words too', /not on the road/i.test(vis.__statusUnknown || ''));
console.log('  ── CONTROL · the one state that must SHOW it');
ok('\u{1F3AF} approved → the logo IS returned', !!(vis.approved && vis.approved.logo),
  String(vis.approved && vis.approved.logo));
ok('paint is applied in every state, approved or not',
  Object.keys(vis).filter(k => !k.startsWith('__')).every(k => vis[k].paint === '#2f4f43'));

console.log('\n  ── the file gate mirrors the SQL');
ok('\u{1F3AF} 3 MB is refused',        valid.tooBig === false);
ok('\u{1F3AF} image/gif is refused',   valid.badType === false);
ok('\u{1F3AF} SVG is refused',         valid.svg === false, 'scriptable — must never be allowed');
ok('an empty file is refused',         valid.empty === false);
ok('CONTROL · a real 50 KB webp passes', valid.good === true);

console.log('\n  ── placement cannot leave the bodywork');
ok('\u{1F3AF} a full-size decal cannot travel at all', valid.fullS === 0, String(valid.fullS));
ok('a half-size one can, but only to the edge', valid.halfX > 0 && valid.halfX <= 0.83,
  String(valid.halfX));
ok('NaN does not become a NaN position', valid.nanX === 0, String(valid.nanX));
ok('scale is capped at 1', valid.hugeS === 1, String(valid.hugeS));
ok('\u{1F3AF} a junk colour never reaches a material', valid.badHex === '#e8e4da', valid.badHex);
ok('CONTROL · a real hex is kept', valid.okHex === '#123ABC', valid.okHex);
ok('\u{1F3AF} a junk emblem id falls back', valid.badEmb === 'none', valid.badEmb);

console.log('\n  ── the van itself');
ok('CONTROL · it started bone-white', van.before.paint === 0xe8e4da,
  '0x' + (van.before.paint || 0).toString(16));
ok('\u{1F3AF} the body took the paint', van.after.paint === 0x2f4f43,
  '0x' + (van.after.paint || 0).toString(16));
ok('\u{1F3AF} the TYRES did not', van.after.rubber === 0x121417,
  '0x' + (van.after.rubber || 0).toString(16));
ok('\u{1F3AF} the GLASS did not', van.after.glass === 0x1b2634,
  '0x' + (van.after.glass || 0).toString(16));
ok('decals were actually added', van.decalsAfter >= 3, van.decalsAfter + ' (2 flanks + rear)');
ok('\u{1F3AF} re-applying does not stack them', van.decalsTwice === van.decalsAfter,
  van.decalsAfter + ' → ' + van.decalsTwice);
ok('\u{1F3AF} an awaiting_review logo never reaches the mesh', van.sawUrl === false);

console.log('\n  ── the page wiring');
ok('a Wrap button exists', page.wrapBtn === true);
ok('the shop mounted', page.shopMounted === true);
ok('\u{1F3AF} standalone, upload REFUSES rather than pretending',
  !!(refuses && refuses.ok === false), JSON.stringify(refuses));

console.log('\n  ── CONTROL · /src/livery fails to load');
ok('\u{1F3AF} the Wrap button hides itself', fallback.hidden === true);
ok('\u{1F3AF} the van is still there', fallback.truckStillThere === true);
ok('no half-built shop is left behind', fallback.shopAbsent === true);
ok('the page still runs', !errs2.some(e => /livery/i.test(e)), errs2.length + ' error(s)');

console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
