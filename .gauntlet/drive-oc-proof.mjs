/* ══════════════════════════════════════════════════════════════════════════
   🛣 OUTSIDE CONNECTIONS — THE PROOF DRIVER.

   drive-outside.mjs can photograph the chip and print a probe. It cannot press
   it: `page.evaluate(el => el.click())` is a scripted click, and a scripted
   click proves nothing about a chip that is buried under eleven launcher
   pills — it fires the handler even when the element is completely occluded
   and unreachable by a mouse. That is exactly how this defect survived a
   round: a verifier's panel "only ever opened via a scripted chip.click()".

   So this driver drives the REAL MOUSE (page.mouse.click → trusted CDP input
   at viewport coordinates), and it checks BOTH connection states:

     A. CUT OFF   — the shipped scene has no interchange. elementsFromPoint
                    across the chip, real mouse click, screenshot the HUD band.
     B. CONNECTED — an interchange is placed on the north edge through the
                    SHIPPED __nc.place() path plus the two road tiles that
                    reach the grid, then the same three checks again.

   Usage: node .gauntlet/drive-oc-proof.mjs <outdir> [--w px] [--h px]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT   = path.resolve(process.cwd(), 'public');
const THREE_ = '/home/user/Playmythicspellbook/.gauntlet/package';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.txt':'text/plain', '.webp':'image/webp' };

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i+1] : d; };
const OUT  = process.argv[2] || '.gauntlet/shots/oc-proof';
const W    = +arg('--w', 1600), H = +arg('--h', 900);
const WAIT = +arg('--wait', 22000);
const PORT = 8900 + (process.pid % 90);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTPS?_PROXY|https?_proxy|ALL_PROXY|all_proxy)$/.test(k))),
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await page.route('**/*', route => {
  const u = route.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('jsdelivr')) return route.continue();
  route.abort();
});
await page.route('**/cdn.jsdelivr.net/npm/three@0.171.0/**', route => {
  const u = new URL(route.request().url());
  const f = path.join(THREE_, u.pathname.replace('/npm/three@0.171.0/', ''));
  if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
});
/* ⏱ THE CLOCK IS PINNED TO 15:00, the same shift capture.mjs installs and for
   the same reason — node-city's day/night runs off wall-clock time, and a HUD
   band photographed at 22:38 is a different picture from the one the bar is
   scored against. Copied rather than imported: capture.mjs does this inline. */
const PIN_HOUR = +(process.argv.includes('--hour') ? process.argv[process.argv.indexOf('--hour')+1] : 15);
await page.addInitScript(({ hour }) => {
  const _D = Date; const now = new _D(); const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now))
    parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class ShiftedDate extends _D {
    constructor(...a) { if (a.length === 0) super(_D.now() + shiftMs); else super(...a); }
    static now() { return _D.now() + shiftMs; }
  }
  ShiftedDate.parse = _D.parse; ShiftedDate.UTC = _D.UTC;
  window.Date = ShiftedDate;
}, { hour: PIN_HOUR });

const logs = [];
page.on('console',   m => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0, 400)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(WAIT);
const built = await page.evaluate(fs.readFileSync('.gauntlet/scene.js', 'utf8'));
await page.waitForTimeout(4000);

fs.mkdirSync(OUT, { recursive: true });

/* ── the probe, run in-page ─────────────────────────────────────────────── */
const PROBE = `(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
  const el = (id) => document.getElementById(id);
  const nm = (e) => e.tagName + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
  try { window.MythicOutside && window.MythicOutside.hud(); } catch (e) {}
  const chip = el('oc-chip'), bar = el('railbar'), dk = el('oc-dock');
  const rls = [...document.querySelectorAll('#railbar .rl')].filter(b => b.style.display !== 'none');
  const stackAt = (x, y) => document.elementsFromPoint(x, y).slice(0, 4).map(nm);
  let centre = null, across = null, cr = null;
  if (chip) {
    const r = chip.getBoundingClientRect();
    cr = { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
    centre = stackAt(cr.cx, cr.cy);
    across = [0.08, 0.3, 0.5, 0.7, 0.92].map(f => ({
      at: Math.round(f * 100) + '%', top: stackAt(Math.round(r.x + r.width * f), Math.round(r.y + r.height / 2))[0] }));
  }
  const overlap = (a, b) => (a && b) ? !(a.bottom <= b.y || b.bottom <= a.y) : null;
  const rowYs = [...new Set(rls.map(b => Math.round(b.getBoundingClientRect().y)))];
  return {
    innerWidth, topbarh: getComputedStyle(document.documentElement).getPropertyValue('--topbarh').trim(),
    connected: (() => { try { return window.MythicOutside.state().connected; } catch (e) { return 'ERR'; } })(),
    chipText: chip ? chip.textContent : null,
    chipTag: chip ? chip.tagName : null,
    chipParent: chip && chip.parentElement ? nm(chip.parentElement) : null,
    dockParent: dk && dk.parentElement ? nm(dk.parentElement) : null,
    chipRect: R(chip), dockRect: R(dk), railbar: R(bar), daypill: R(el('daypill')),
    railVisible: rls.length, railRowYs: rowYs,
    railRowBottom: rls.length ? Math.max(...rls.map(b => Math.round(b.getBoundingClientRect().bottom))) : null,
    chipOverlapsRailRow: chip && rls.length ? overlap(R(chip), { y: Math.min(...rowYs), bottom: Math.max(...rls.map(b => Math.round(b.getBoundingClientRect().bottom))) }) : null,
    chipCentre: cr, underChipCentre: centre, topAcrossChip: across,
    /* The strict form of the question the brief asks. elementsFromPoint returns
       the deepest node, which for a chip with a <span> inside it is that span —
       so "is the chip on top" means "is the topmost node the chip or inside
       it", and anything else (a .rl, the canvas) is a fail. */
    topIsChip: (() => { if (!chip || !cr) return null;
      const t = document.elementFromPoint(cr.cx, cr.cy);
      return !!t && (t === chip || chip.contains(t)); })(),
    topIsChipAcross: (() => { if (!chip) return null; const r = chip.getBoundingClientRect();
      return [0.08, 0.3, 0.5, 0.7, 0.92].every(f => { const t = document.elementFromPoint(
        Math.round(r.x + r.width * f), Math.round(r.y + r.height / 2));
        return !!t && (t === chip || chip.contains(t)); }); })(),
    panelOpen: (() => { const p = el('oc-panel'); return !!p && p.style.display !== 'none'; })(),
    panelRect: R(el('oc-panel')),
    panelText: (() => { const p = el('oc-panel'); return p && p.style.display !== 'none' ? p.textContent.replace(/\\s+/g, ' ').trim() : null; })(),
  };
})()`;

const probe = () => page.evaluate(PROBE);
/* ⚠ The clip is DERIVED, and it has to be guarded: a closed #oc-panel is
   display:none, so its rect is all zeros and the naive `panelRect.bottom - y`
   went NEGATIVE — Playwright then hangs for 30 s and dies on a bad clip rather
   than telling you the rectangle is nonsense. */
const band = async (name, p) => {
  const y = Math.max(0, (p.daypill ? p.daypill.y : 100) - 10);
  const foot = (p.panelOpen && p.panelRect ? p.panelRect.bottom
              : p.chipRect ? p.chipRect.bottom : y + 90);
  const h = Math.max(60, Math.min(H - y, foot - y + 16));
  await page.screenshot({ path: path.join(OUT, name + '-band.png'), clip: { x: 260, y, width: Math.min(1080, W - 260), height: h } });
};

const report = {};

/* ── A. CUT OFF ─────────────────────────────────────────────────────────── */
let a = await probe();
await page.screenshot({ path: path.join(OUT, 'cutoff-full.png') });
await band('cutoff', a);
report.A_cutoff_layout = a;

// THE REAL CLICK. Trusted input at the chip's centre — no element handle.
await page.mouse.move(a.chipCentre.cx, a.chipCentre.cy);
await page.waitForTimeout(200);
await page.mouse.click(a.chipCentre.cx, a.chipCentre.cy);
await page.waitForTimeout(600);
let aOpen = await probe();
report.A_cutoff_afterRealClick = { panelOpen: aOpen.panelOpen, panelRect: aOpen.panelRect, panelText: aOpen.panelText };
await page.screenshot({ path: path.join(OUT, 'cutoff-open-full.png') });
await band('cutoff-open', aOpen);

// and a real click away must dismiss it (the new click-away)
await page.mouse.click(120, Math.round(H * 0.6));
await page.waitForTimeout(400);
report.A_dismissedByClickAway = !(await probe()).panelOpen;

/* ── B. CONNECTED ───────────────────────────────────────────────────────── */
report.B_wire = await page.evaluate(async () => {
  const nc = window.__nc; const out = { placed: [] };
  const p = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) { out.err = String(e); }
    try { nc.build.finishAll('oc proof'); } catch (e) {}
    out.placed.push(t + '@' + x + ',' + z + (nc.game.tiles[x + ',' + z] ? ' ok' : ' FAIL')); };
  out.roadUsed = (() => { try { return window.MythicOutside.ctx().roadUsed(); } catch (e) { return '?'; } })();
  out.roadCap  = (() => { try { return window.MythicOutside.ctx().roadCap(); } catch (e) { return '?'; } })();
  await p('interchange', 12, 0);
  await p('road', 12, 1);
  await p('road', 12, 2);
  /* ⚠ The gauntlet district is already OVER its road maintenance cap (the scene
     lays five avenues both ways against ROAD_CAP_BASE 40 + 10 per depot), so
     tryPlace refuses two more road tiles — nothing to do with this feature.
     Fall back to the SAME ungated write the shipped grandfather migration uses,
     for the reason index.html documents at the mount: reconnecting a city must
     never be refused for road capacity, or a city at its cap could never be
     reconnected at all. */
  for (const z of [1, 2]) if (!nc.game.tiles['12,' + z]) {
    try { window.MythicOutside.ctx().place('road', 12, z); out.placed.push('road@12,' + z + ' via migration write ' + (nc.game.tiles['12,' + z] ? 'ok' : 'FAIL')); }
    catch (e) { out.placed.push('road@12,' + z + ' migration write threw ' + e); }
  }
  try { window.MythicOutside.invalidate(); window.MythicOutside.hud(); } catch (e) {}
  return out;
});
await page.waitForTimeout(1200);
let b = await probe();
report.B_connected_layout = b;
await page.screenshot({ path: path.join(OUT, 'linked-full.png') });
await band('linked', b);

await page.mouse.move(b.chipCentre.cx, b.chipCentre.cy);
await page.waitForTimeout(200);
await page.mouse.click(b.chipCentre.cx, b.chipCentre.cy);
await page.waitForTimeout(600);
let bOpen = await probe();
report.B_connected_afterRealClick = { panelOpen: bOpen.panelOpen, panelRect: bOpen.panelRect, panelText: bOpen.panelText };
await page.screenshot({ path: path.join(OUT, 'linked-open-full.png') });
await band('linked-open', bOpen);

console.log(JSON.stringify({ out: OUT, viewport: { W, H }, built, report, logs: logs.slice(-14) }, null, 2));
await browser.close();
server.close();
