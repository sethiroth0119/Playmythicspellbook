/* ══════════════════════════════════════════════════════════════════════════
   🏷 DRIVE-NODE-MANAGER-LABEL — the city never says "Mayor" to a player.

   THE ASK (owner, 2026-09-17): "Change the mayor name to Node Manager."

   WHY A BROWSER DRIVE AND NOT A GREP. node-city/index.html has ~175 lines
   that say mayor, and almost all of them MUST keep saying it: comments that
   explain past bugs, `gov.mayorName`, MAYOR_LSK (a save key), the
   cityMayorGet/Set bridge calls index.html answers, the #mayorname input id,
   the node_mayors table. Renaming those breaks old saves and the parent
   bridge for a label change. So a text scan cannot tell a violation from a
   contract; only what a player can SEE can. This drive boots the real page,
   walks every surface that names the office, and reads
     · document.body.innerText (visible text only),
     · every title / aria-label / placeholder / alt attribute,
     · document.title,
     · every toast, captured by a MutationObserver as it is added (they fade,
       so a read after the fact would pass by missing them).

   Surfaces walked:
     P1 parent · owner, no seat   → card, then the APPOINT flow (search, pick,
                                    pay) → seated card → a farm's inspect
                                    Efficiency factors (the "in office" row)
                                    → the REMOVE flow → vacant again
     P2 parent · owner, a Hall contract seat (no Appoint, no Remove)
     P3 parent · the viewer IS the seated manager on a client's city
     S1 standalone mock bridge   → appoint + remove through the local mock

   ⚠ NEGATIVE CONTROL (C1): the SAME probe, P1's walk, against HEAD's page
     served from `git show HEAD:` — the page before the rename. It must find
     "mayor" in the card and in the appoint toast. A probe that finds nothing
     there is blind, and its green on the working tree means nothing. When
     HEAD itself carries the rename (after the integrator commits) the control
     cannot bite on HEAD any more, so it falls back to a synthetic page: the
     working-tree page with the old card label injected back in. It must still
     be caught.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const PORT = 9130 + (process.pid % 50);

const WT = fs.readFileSync(path.join(ROOT, 'node-city/index.html'), 'utf8');
let HEADPAGE = null;
try {
  HEADPAGE = execFileSync('git', ['-c', 'core.autocrlf=false', 'show', 'HEAD:public/node-city/index.html'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
} catch (e) { HEADPAGE = null; }
// HEAD before the rename carries the old badge; after it, synthesise one.
// NM_SYNTH_CONTROL=1 exercises the post-commit fallback today, so it is not first run the day it is needed.
const HEAD_IS_OLD = !process.env.NM_SYNTH_CONTROL && !!HEADPAGE && HEADPAGE.includes('No mayor seated');
const CONTROL_PAGE = HEAD_IS_OLD ? HEADPAGE
  : WT.replace("<span>🎩 Node Manager</span>", "<span>🎩 Mayor</span>").replace('No Node Manager seated', 'No mayor seated');

/* The parent: just enough of index.html's hooks for 'parent' mode. The seat is
   read from window.__seat, which each scenario sets through the query. */
function parentHtml(q) {
  const who = q.get('who') || 'owner';       // owner | manager
  const seat = q.get('seat') || 'none';      // none | contract | me
  const page = q.get('page') || '/node-city/index.html';
  return '<!doctype html><meta charset="utf-8"><title>nm host</title>' +
  '<style>html,body{margin:0;height:100%;background:#0d0b12}iframe{border:0;width:100vw;height:100vh}</style><script>' +
  'window.getRes=function(){return 0};window.addRes=function(){};window.spendResources=function(){return false};' +
  'window.addCinders=function(){return true};window.spendCinders=function(){return false};window.getCinders=function(){return 0};' +
  'window.cityStateLoad=async function(){return null};window.cityStateSave=function(){return false};' +
  'window.__seat=' + JSON.stringify(seat === 'contract' ? { mayorId: 'u-rhoda', mayorName: 'Rhoda', contract: true }
                                  : seat === 'me' ? { mayorId: 'u-me', mayorName: 'You', contract: true } : null) + ';' +
  'window.__sets=[];' +
  'window.cityOwnerIdentity=function(){return ' + JSON.stringify(who === 'owner'
      ? { viewerId: 'u-me', viewerName: 'You', ownerId: 'u-me', ownerName: 'You', isOwner: true }
      : { viewerId: 'u-me', viewerName: 'You', ownerId: 'u-own', ownerName: 'Oswin', isOwner: false }) + '};' +
  'window.cityMayorGet=async function(){return window.__seat};' +
  'window.cityMayorSet=async function(n){window.__sets.push(n);window.__seat=n?{mayorId:"u-"+n.toLowerCase(),mayorName:n}:null;return window.__seat};' +
  'window.citySearchPlayers=async function(q){return [{name:"Rhoda"},{name:"Kael"}].filter(function(h){return h.name.toLowerCase().indexOf(String(q).toLowerCase())>=0})};' +
  '</script><iframe id="f" src="' + page + '"></iframe>';
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
  if (p === '/__parent') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(parentHtml(u.searchParams)); }
  if (p === '/node-city/__control.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(CONTROL_PAGE); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'] });

let passes = 0; const bad = [];
const need = (k, ok, d) => {
  if (ok) { passes++; console.log('  ✅ ' + k); }
  else { bad.push(k); console.log('  ❌ ' + k + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); }
};

async function boot(url, framed) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('cdn.jsdelivr.net') && u.includes('three@') && fs.existsSync(THREE_DIR)) {
      const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, ''); const f = path.join(THREE_DIR, rel);
      return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.continue();
    }
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return route.continue();
    return route.abort();
  });
  await page.goto('http://127.0.0.1:' + PORT + url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let fr = page.mainFrame();
  if (framed) { const fh = await page.waitForSelector('#f', { timeout: 60000 }); fr = await fh.contentFrame(); }
  await fr.waitForFunction('!!(window.__nc && window.__nc.gov && (window.__nc.rail || window.__ncRail))', null, { timeout: 180000 });
  await fr.waitForFunction('!!document.getElementById("govbody") && document.getElementById("govbody").innerHTML.length > 0', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  // Every toast, as it arrives: they fade, so reading #toasts later would miss them.
  await fr.evaluate(() => {
    window.__toastLog = [];
    const box = document.getElementById('toasts') || document.body;
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) window.__toastLog.push(n.textContent || ''); })
      .observe(box, { childList: true, subtree: true });
    const rail = window.__nc.rail || window.__ncRail;
    try { rail.open('govcard'); } catch (e) {}
  });
  await page.waitForTimeout(400);
  return { page, fr, errs };
}

/* What a player can read. Returns every hit with a little context. */
const scan = (fr) => fr.evaluate(() => {
  const hits = [];
  const look = (where, s) => { const m = String(s || '').match(/.{0,40}mayor.{0,40}/ig); if (m) for (const x of m) hits.push(where + ': ' + x); };
  look('body', document.body.innerText);
  look('title', document.title);
  for (const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')) {
    for (const a of ['title', 'aria-label', 'placeholder', 'alt']) if (el.hasAttribute(a)) look('@' + a, el.getAttribute(a));
  }
  for (const t of (window.__toastLog || [])) look('toast', t);
  const gb = document.getElementById('govbody');
  return { hits, gov: gb ? gb.innerText : null, toasts: (window.__toastLog || []).slice(), state: window.__nc.gov() };
});

/* Appoint through the real box: type, pick the suggestion, pay. */
async function appoint(fr, page, name) {
  const withSearch = await fr.evaluate(() => !!document.getElementById('mayorname'));
  if (!withSearch) return false;
  // fill() fires the box's own input event; the list is debounced 280 ms.
  await fr.fill('#mayorname', name.slice(0, 3));
  const row = await fr.waitForSelector('#mayorsug .msug-row', { timeout: 8000 }).catch(() => null);
  if (row) await row.click(); else await fr.fill('#mayorname', name);
  /* Clicked through the DOM: a late suggestion list can sit over the button on
     a loaded machine (seen once: "No players found." intercepting the click),
     and what this suite checks is the words, not the hit-testing. */
  await fr.evaluate(() => document.getElementById('gov-appoint').click());
  await page.waitForTimeout(600);
  return true;
}

// ── P1 · parent, owner, vacant → appoint → inspect → remove ─────────────────
async function walkOwnerFlows(url, label) {
  const { page, fr, errs } = await boot(url, true);
  const out = {};
  out.vacant = await scan(fr);
  out.hasAppoint = await fr.evaluate(() => !!document.getElementById('gov-appoint'));
  out.appointBtn = await fr.evaluate(() => (document.getElementById('gov-appoint') || {}).textContent || '');
  out.appointed = await appoint(fr, page, 'Rhoda');
  out.sets = await page.evaluate(() => window.__sets.slice());
  out.seated = await scan(fr);
  out.hasRemove = await fr.evaluate(() => !!document.getElementById('gov-remove'));
  // The "in office" efficiency row: a farm with a seated manager, inspected.
  out.inspect = await fr.evaluate(() => {
    const k = '3,3';
    window.__nc.jobfair.plant(k, 'farm');
    try { window.__nc.inspect(k); } catch (e) { return { err: String(e).slice(0, 160) }; }
    const ins = document.getElementById('inspect');
    return { open: !!ins, text: ins ? ins.innerText : '' };
  });
  await page.waitForTimeout(300);
  out.inspectScan = await scan(fr);
  // The inspector takes the right side; put the Governance card back first.
  await fr.evaluate(() => { try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {}
    const rail = window.__nc.rail || window.__ncRail; try { rail.open('govcard'); } catch (e) {} });
  await page.waitForTimeout(400);
  out.removeVisible = await fr.evaluate(() => { const b = document.getElementById('gov-remove'); return !!(b && b.offsetParent); });
  if (out.hasRemove) { await fr.evaluate(() => document.getElementById('gov-remove').click()); await page.waitForTimeout(600); }
  out.removed = await scan(fr);
  out.errs = errs;
  await page.close();
  return out;
}

console.log('\n── P1 · parent mode, owner: vacant → appoint → inspect → remove');
const P1 = await walkOwnerFlows('/__parent?who=owner&seat=none', 'P1');
// innerText, so the badge's CSS uppercase shows through: match without case.
need('P1: the vacant card says "No Node Manager seated"', /No Node Manager seated/i.test(P1.vacant.gov || ''), P1.vacant.gov);
need('P1: the vacant card offers Appoint, and its button reads "Appoint Node Manager"', P1.hasAppoint && /Appoint Node Manager/.test(P1.appointBtn), P1.appointBtn);
need('P1: nothing visible says mayor on the vacant card', P1.vacant.hits.length === 0, P1.vacant.hits);
need('P1: the appoint flow still reaches the bridge (cityMayorSet("Rhoda"))', P1.appointed && P1.sets[0] === 'Rhoda', P1.sets);
need('P1: the card now seats Rhoda under the "Node Manager" row', P1.seated.state.mayorName === 'Rhoda' && /Node Manager\s+Rhoda/.test(P1.seated.gov || ''), P1.seated.gov);
need('P1: the appoint toast names the office as Node Manager', P1.seated.toasts.some((t) => /appointed Node Manager/.test(t)), P1.seated.toasts);
need('P1: nothing visible (text, attributes, toasts) says mayor once seated', P1.seated.hits.length === 0, P1.seated.hits);
need('P1: Remove is offered for a non-contract seat', P1.hasRemove === true);
need('P1: the Governance card (with Remove) is on screen again after the inspector', P1.removeVisible === true);
need('P1: the farm inspector opened and lists "Node Manager Rhoda in office"', P1.inspect.open && /Node Manager Rhoda in office/.test(P1.inspect.text), (P1.inspect.text || P1.inspect.err || '').slice(0, 200));
need('P1: nothing visible says mayor with the inspector open', P1.inspectScan.hits.length === 0, P1.inspectScan.hits);
need('P1: the remove flow cleared the seat and the bridge got null', P1.removed.state.mayorName === null && P1.sets.length >= 1, P1.removed.state);
need('P1: the remove toast says "has been removed from office" and not mayor', P1.removed.toasts.some((t) => /Rhoda has been removed from office/.test(t)) && P1.removed.hits.length === 0, { t: P1.removed.toasts, h: P1.removed.hits });
need('P1: no page errors', P1.errs.length === 0, P1.errs);

// ── P2 · parent, owner, Hall contract ───────────────────────────────────────
console.log('\n── P2 · parent mode, owner, contract seat');
{
  const { page, fr, errs } = await boot('/__parent?who=owner&seat=contract', true);
  const s = await scan(fr);
  const btns = await fr.evaluate(() => ({ ap: !!document.getElementById('gov-appoint'), rm: !!document.getElementById('gov-remove') }));
  need('P2: the contract note names the Node Manager Hall', /Hired through the Node Manager Hall/.test(s.gov || ''), s.gov);
  need('P2: a contract seat still hides Appoint and Remove', !btns.ap && !btns.rm, btns);
  need('P2: nothing visible says mayor on a contract seat', s.hits.length === 0, s.hits);
  need('P2: no page errors', errs.length === 0, errs);
  await page.close();
}

// ── P3 · parent, the viewer is the seated manager ───────────────────────────
console.log('\n── P3 · parent mode, viewer is the Node Manager of a client city');
{
  const { page, fr, errs } = await boot('/__parent?who=manager&seat=me', true);
  const s = await scan(fr);
  need('P3: the manager sees "You govern this city on behalf of Oswin" and YOU on the seat', /on behalf of Oswin/.test(s.gov || '') && /YOU/.test(s.gov || ''), s.gov);
  need('P3: the manager is handed no owner controls', await fr.evaluate(() => !document.getElementById('gov-appoint') && !document.getElementById('gov-remove')));
  need('P3: nothing visible says mayor for the manager', s.hits.length === 0, s.hits);
  need('P3: no page errors', errs.length === 0, errs);
  await page.close();
}

// ── S1 · standalone mock bridge ─────────────────────────────────────────────
console.log('\n── S1 · standalone mode, mock bridge');
{
  const { page, fr, errs } = await boot('/node-city/index.html?bridge=standalone', false);
  await fr.evaluate(() => { try { localStorage.removeItem('mythic_city_mayor_v1'); } catch (e) {} });
  const v = await scan(fr);
  /* Standalone search answers [] — the box takes a typed name. Its "No players
     found." list covers the button once the debounce fires, so click through
     the DOM (see appoint()). */
  await fr.fill('#mayorname', 'Kael');
  await fr.evaluate(() => document.getElementById('gov-appoint').click());
  await page.waitForTimeout(600);
  const a = await scan(fr);
  const stored = await fr.evaluate(() => { try { return JSON.parse(localStorage.getItem('mythic_city_mayor_v1') || 'null'); } catch (e) { return 'err'; } });
  const hasRm = await fr.evaluate(() => !!document.getElementById('gov-remove'));
  if (hasRm) { await fr.click('#gov-remove'); await page.waitForTimeout(600); }
  const r = await scan(fr);
  need('S1: the mock appoint still saves under the unchanged key (mythic_city_mayor_v1)', stored && stored.mayorName === 'Kael', stored);
  need('S1: the seat shows under "Node Manager", and Remove clears it', a.state.mayorName === 'Kael' && /Node Manager\s+Kael/.test(a.gov || '') && hasRm && r.state.mayorName === null, { a: a.gov, r: r.state });
  need('S1: the offline note is still shown', /offline: stored on this device/.test(v.gov || ''), v.gov);
  need('S1: nothing visible says mayor through the whole standalone walk', !v.hits.length && !a.hits.length && !r.hits.length, [v.hits, a.hits, r.hits]);
  need('S1: no page errors', errs.length === 0, errs);
  await page.close();
}

// ── C1 · NEGATIVE CONTROL — the same probe must catch the old wording ──────
console.log('\n── C1 · control: the probe on the page ' + (HEAD_IS_OLD ? 'at HEAD (before the rename)' : 'with the old label injected'));
{
  need('C1: the control page differs from the working tree', CONTROL_PAGE !== WT);
  const C = await walkOwnerFlows('/__parent?who=owner&seat=none&page=/node-city/__control.html', 'C1');
  need('C1: CONTROL — the probe finds "mayor" on the old card', C.vacant.hits.some((h) => /mayor/i.test(h)), C.vacant.hits);
  if (HEAD_IS_OLD) {
    need('C1: CONTROL — the probe catches the old appoint toast ("appointed Mayor")', C.seated.hits.some((h) => /toast: .*appointed Mayor/.test(h)), C.seated.hits);
    need('C1: CONTROL — the probe catches the old "Mayor … in office" factor row', C.inspectScan.hits.some((h) => /Mayor Rhoda in office/.test(h)), C.inspectScan.hits);
  }
  need('C1: CONTROL — the old page still ran the same flows (the probe was not simply looking at an empty frame)', C.appointed && C.sets[0] === 'Rhoda', C.sets);
}

await browser.close(); server.close();
console.log('\n' + passes + ' passed, ' + bad.length + ' failed');
if (bad.length) { console.log('FAILED:\n  - ' + bad.join('\n  - ')); process.exit(1); }
console.log('ALL CHECKS PASSED · the city calls the office Node Manager everywhere a player reads it, and the probe catches the old word');
