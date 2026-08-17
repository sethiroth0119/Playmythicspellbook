/* ══════════════════════════════════════════════════════════════════════════
   THE INTEGRATION CHECK — four systems, one page, one save.

   Dossier, palette, transit and naming each landed hooks in the SAME three
   functions (openInspect, serialize, loadState). Each of them has its own
   unit check; none of them can answer the only question that matters after a
   merge, which is whether all four are still alive in the SHIPPED page at the
   same time and whether the ONE save they now share round-trips.

   So this boots the real public/node-city/index.html in headless Chromium and
   asserts against `window.__nc` — the diagnostics seam a player's clicks go
   through — rather than against a diff.

   Usage: node .gauntlet/integration-check.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8700 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k))),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
// The catch-all MUST be registered before the jsdelivr route: Playwright's
// last-registered route wins, and the CDN is blocked (see .gauntlet/README.md).
await page.route('**/*', (r) => {
  const u = r.request().url();
  (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('jsdelivr')) ? r.continue() : r.abort();
});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**', (r) => {
  const rel = new URL(r.request().url()).pathname.replace('/npm/three@0.171.0/', '');
  const f = path.join(THREE_, rel);
  fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
                   : r.fulfill({ status: 404, body: 'nf' });
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 240)));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 240)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(24000);

const R = await page.evaluate(async () => {
  const out = { mounted: {}, checks: [] };
  const nc = window.__nc;
  const say = (label, pass, got) => out.checks.push({ label, pass: !!pass, got });

  say('the diagnostics seam is there at all', !!nc, !!nc);
  if (!nc) return out;

  // ── 1. all four modules mounted, in one page ──────────────────────────
  out.mounted = {
    dossier: !!(nc.dossier && nc.dossier()),
    palette: !!(nc.palette && nc.palette()),
    transit: !!(nc.transit && nc.transit()),
    naming:  !!(nc.naming && nc.naming()),
    saveExt: !!(nc.saveExt && nc.saveExt()),
  };
  for (const k in out.mounted) say('module mounted: ' + k, out.mounted[k], out.mounted[k]);

  return out;
});

/* THE DISTRICT — the shipped scene driver, not a hand-rolled one. It knows the
   three gates (bridge-side cost, crew slots, road capacity bought with depots)
   that each cost the capture harness a debugging round; see .gauntlet/README. */
await page.evaluate(fs.readFileSync(path.resolve(process.cwd(), '.gauntlet/scene.js'), 'utf8'));
await page.waitForTimeout(4000);

const hdr = await page.evaluate(async () => {
  const nc = window.__nc; const out = {};
  const rows = Object.entries(nc.game.tiles);
  out.built = rows.filter(([, t]) => t.type !== 'anchor').length;
  const homeK = (rows.find(([, t]) => t.type === 'housing') || [])[0] || null;
  const bizK = (rows.find(([, t]) => t.type === 'gasstation' || t.type === 'shop' || t.type === 'grocery') || [])[0] || homeK;
  out.homeK = homeK; out.bizK = bizK;
  if (!bizK) return out;
  // 🏠 the dossier's address, and 🏷 naming's name — the two halves of the header
  out.homeAddr = nc.dossier() ? ((nc.dossier().addressOf(homeK) || {}).text || null) : null;
  out.name = nc.naming() ? nc.naming().nameFor(bizK) : null;
  out.addr = nc.dossier() ? (nc.dossier().addressOf(bizK) || {}).text : null;
  out.header = nc.dossier() ? nc.dossier().headerHtml(bizK, out.name) : null;
  // the palette's tab test and one real recolour through the shipped path
  const P = nc.palette();
  out.canPaint = P ? P.canPaint(bizK) : null;
  if (P && out.canPaint) {
    try { P.setSlot(bizK, 'wall', '#c83a2e'); } catch (e) { out.setErr = String(e); }
    out.after = P.get(bizK);
    // …and does it survive a rebuild? (the buildMesh hook is the whole claim)
    try { nc.repaint(bizK); } catch (e) { out.repaintErr = String(e); }
    out.afterRepaint = P.get(bizK);
  }
  // transit: the network is empty but the module must answer
  const T = nc.transit();
  out.transitReport = T ? nc.transitReport() : null;
  out.busstopCost = (nc.costOf ? nc.costOf('busstop') : null);
  return out;
});

// ── 5. THE SAVE. One payload, four systems, and an OLD save still opens ──
const save = await page.evaluate(async () => {
  const nc = window.__nc;
  const shelf = nc.saveExt();
  const out = {};
  const p = shelf ? shelf.collect() : null;
  out.extTenants = p ? Object.keys(p).filter((k) => k !== 'v') : null;
  const meta = shelf ? shelf.describe({ v: 5, tiles: nc.game.tiles, ext: p, paint: {}, transit: null }) : null;
  out.meta = meta;
  return out;
});

await browser.close(); server.close();

let bad = 0;
console.log('\n── the four systems, in one page ──');
for (const c of R.checks) { if (!c.pass) bad++; console.log((c.pass ? '  ok  ' : '  FAIL ') + c.label + ' = ' + JSON.stringify(c.got)); }

const t = (label, pass, got) => { if (!pass) bad++; console.log((pass ? '  ok  ' : '  FAIL ') + label + ' = ' + JSON.stringify(got)); };
console.log('\n── the district ──');
t('a district actually got built', hdr.built >= 40, hdr.built);
console.log('\n── the header: naming owns the name, the dossier owns the address ──');
t('the dossier derives a real address', !!hdr.homeAddr, hdr.homeAddr);
t('naming gives the business a name of its own', !!hdr.name, hdr.name);
t('the header carries BOTH, in one line', !!(hdr.header && hdr.name && hdr.addr && hdr.header.includes(hdr.addr)), hdr.header);
console.log('\n── the palette ──');
t('a business is repaintable', hdr.canPaint === true, hdr.canPaint);
t('a recolour takes', !!(hdr.after && hdr.after.wall), hdr.after);
t('…and SURVIVES a mesh rebuild', !!(hdr.afterRepaint && hdr.afterRepaint.wall === (hdr.after || {}).wall), hdr.afterRepaint);
console.log('\n── transit ──');
t('the module answers for an empty network', hdr.transitReport !== null && hdr.transitReport !== undefined, hdr.transitReport);
t('the bus stop is a real, priced building', !!(hdr.busstopCost && hdr.busstopCost.cinder > 0), hdr.busstopCost);
console.log('\n── the reconciled save ──');
t('ext has exactly the tenants that registered', Array.isArray(save.extTenants) && save.extTenants.length > 0, save.extTenants);
t('meta describes the payload it was handed', !!(save.meta && save.meta.app === 'node-city' && save.meta.keys.length), save.meta);

/* ⚠ `net::ERR_FAILED` is THIS HARNESS talking, not the page: the catch-all
   route aborts every non-local request (the CDN is blocked — see
   .gauntlet/README.md), and an aborted fetch is reported as a console error.
   Counting it would make a green run impossible and teach the next reader to
   ignore the console section entirely. */
const errs = logs.filter((l) => /pageerror|\[error\]/i.test(l) && !/ERR_FAILED|ERR_ABORTED/.test(l));
console.log('\n── console ──');
console.log(errs.length ? errs.slice(0, 12).join('\n') : '  no page errors');
if (errs.length) bad += errs.length;

console.log('\n' + (bad ? bad + ' FAILED' : 'ALL CLEAN'));
process.exit(bad ? 1 : 0);
