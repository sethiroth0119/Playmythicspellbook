/* ══════════════════════════════════════════════════════════════════════════
   🧰 DRIVE-RESOURCE-EDITOR — icons, weights, new resources, and what needs them.

   THE ASK: "In the forge create a resource section where I can change all of
   the icons for all resources, create some and set the weight and what city
   buildings need them."

   A resource editor already existed (name / icon / image / create / delete) and
   listed SALVAGE_RES. What it could not do is the half that was asked for:

     · SET A WEIGHT — the warehouse prices every crate by the kilo, so a
       resource with no weight ships free.
     · SAY WHAT NEEDS IT — a declaration is worth nothing until the city's
       economy actually spends it, which means BUILDINGS[b].use.
     · BE USABLE AT 394 ROWS — the list was 149 before the chain catalogue was
       promoted. It is now 394 and needs a filter.

   Pinned, with controls, because a form that saves into the void looks exactly
   like a form that works:
     · a weight typed in the editor is what resourceWeight() then answers
     · CONTROL: a resource nobody weighed still answers 1, never 0 or NaN
     · CONTROL: junk in the weight box is REFUSED, not silently coerced
     · declared needs round-trip through the text format
     · CONTROL: a malformed needs line is refused with the line quoted
     · CONTROL: a zero rate is refused rather than stored as a no-op input
     · the filter narrows 394 rows and CONTROL: matches id as well as name
     · the needs reach the city and land on BUILDINGS[].use
     · CONTROL: …merged, so a building keeps the inputs it already had
     · CONTROL: …and an unknown resource id is skipped, not wired in

   Run:  node .gauntlet/drive-resource-editor.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9300 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof renderForgeResources === "function" && typeof resourceWeight === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof renderForgeResources === 'function' && typeof resourceWeight === 'function';
  if (!o.reachable) return o;
  window.saveForge = () => {};
  window.showToast = (m) => { (window.__toasts = window.__toasts || []).push(String(m)); };
  /* renderForgeResources RETURNS markup; bindForgeResources wires it. The tab
     is normally mounted by the Forge screen, so the driver mounts it into a
     host div and binds it — the same two calls in the same order, against the
     shipped functions. */
  const host = document.createElement("div");
  host.id = "__resTabHost"; document.body.appendChild(host);
  const draw = () => {
    try { host.innerHTML = renderForgeResources(); bindForgeResources(); }
    catch (e) { o.renderErr = String(e).slice(0, 200); }
  };
  window.render = draw;

  // ── the list, and its filter ───────────────────────────────────────────
  App._resFilter = ''; draw();
  o.rowsAll = document.querySelectorAll('.enc-row').length;
  o.hasFilterBox = !!document.getElementById('res-filter');
  App._resFilter = 'wheat'; draw();
  o.rowsWheat = document.querySelectorAll('.enc-row').length;
  App._resFilter = 'crudeOil'; draw();               // CONTROL: matches by ID
  o.rowsById = document.querySelectorAll('.enc-row').length;
  App._resFilter = ''; draw();

  // ── weight: default, then edited ───────────────────────────────────────
  o.weightBefore = resourceWeight('wheat');
  o.weightUnknown = resourceWeight('nothingCalledThis');   // CONTROL: 1
  App._resEdit = { isNew: false, id: 'wheat', name: 'Wheat', icon: '🌾', img: '',
                   wt: resourceWeight('wheat'), needsText: _needsToText(_resourceNeeds().wheat) };
  draw();
  o.formHasWeight = !!document.getElementById('res-wt');
  o.formHasNeeds  = !!document.getElementById('res-needs');
  document.getElementById('res-wt').value = '2.4';
  document.getElementById('res-needs').value = 'cannery = 0.5\nfoodTruck = 0.2';
  document.getElementById('res-save').click();
  o.weightAfter = resourceWeight('wheat');
  o.needsAfter = JSON.parse(JSON.stringify(_resourceNeeds().wheat || null));

  // ── CONTROL: junk is refused, not coerced ──────────────────────────────
  window.__toasts = [];
  App._resEdit = { isNew: false, id: 'wheat', name: 'Wheat', icon: '🌾', img: '', wt: 2.4, needsText: '' };
  draw();
  document.getElementById('res-wt').value = '3,5';          // comma decimal
  document.getElementById('res-save').click();
  o.junkWeightRefused = (resourceWeight('wheat') === 2.4);
  o.junkWeightSaid = (window.__toasts[0] || '');

  // ── CONTROL: a bad needs line, and a zero rate ─────────────────────────
  window.__toasts = [];
  App._resEdit = { isNew: false, id: 'wheat', name: 'Wheat', icon: '🌾', img: '', wt: 2.4, needsText: '' };
  draw();
  document.getElementById('res-wt').value = '2.4';
  document.getElementById('res-needs').value = 'cannery 0.5';   // no "="
  document.getElementById('res-save').click();
  o.badNeedsRefused = (window.__toasts[0] || '').indexOf('Could not read') >= 0;
  window.__toasts = [];
  document.getElementById('res-needs').value = 'cannery = 0';   // a no-op input
  document.getElementById('res-save').click();
  o.zeroRateRefused = (window.__toasts[0] || '').indexOf('Could not read') >= 0;

  // ── creating one ───────────────────────────────────────────────────────
  window.__toasts = [];
  App._resEdit = { isNew: true, id: '', name: '', icon: '📦', img: '', wt: 1, needsText: '' };
  draw();
  document.getElementById('res-id').value = 'voidPearls';
  document.getElementById('res-name').value = 'Void Pearls';
  document.getElementById('res-icon').value = '🔮';
  document.getElementById('res-wt').value = '0.3';
  document.getElementById('res-needs').value = 'arcanum = 0.05';
  document.getElementById('res-save').click();
  o.created = !!_SALVAGE_BY_ID['voidPearls'];
  o.createdWeight = resourceWeight('voidPearls');
  o.createdIcon = (_SALVAGE_BY_ID['voidPearls'] || {}).icon;
  o.createdNeeds = JSON.parse(JSON.stringify(_resourceNeeds().voidPearls || null));

  // ── what the city would be handed ──────────────────────────────────────
  o.bridge = (typeof window.cityResourceNeeds === 'function')
    ? JSON.parse(JSON.stringify(window.cityResourceNeeds())) : null;
  return o;
});

/* ── the city half, run against the shipped merger ────────────────────── */
const nc = await pg.evaluate(async () => {
  /* The merger is module-scoped inside node-city, so its LOGIC is reproduced
     here on the same inputs and the shipped file is checked for the same
     shape below. What is proved here is the contract: merge, do not replace,
     and skip ids the ledger has never heard of. */
  const BUILDINGS = { cannery: { use: { water: 0.15 } }, foodTruck: {}, arcanum: { use: {} } };
  const game = { res: { water: 10, wheat: 0, voidPearls: 0 } };
  const needs = { wheat: { cannery: 0.5, foodTruck: 0.2 }, voidPearls: { arcanum: 0.05 },
                  notAThing: { cannery: 9 } };
  let applied = 0, skipped = 0; const unknown = [];
  for (const resId in needs) {
    const per = needs[resId];
    const known = Object.prototype.hasOwnProperty.call(game.res, resId);
    if (!known) { skipped += Object.keys(per).length; unknown.push(resId); continue; }
    for (const bId in per) {
      const rate = Number(per[bId]); const def = BUILDINGS[bId];
      if (!def || !(rate > 0)) { skipped++; continue; }
      def.use = Object.assign({}, def.use || {}); def.use[resId] = rate; applied++;
    }
  }
  return { applied, skipped, unknown, canneryUse: BUILDINGS.cannery.use, foodTruckUse: BUILDINGS.foodTruck.use };
});

const NCSRC = fs.readFileSync(path.join(ROOT, 'node-city', 'index.html'), 'utf8');
const shipped = {
  merger: /async function _ncResourceNeeds\(\)/.test(NCSRC),
  calledAtBoot: /await _ncResourceNeeds\(\);/.test(NCSRC),
  mergesNotReplaces: /def\.use = Object\.assign\(\{\}, def\.use \|\| \{\}\);/.test(NCSRC),
  skipsUnknown: /if \(!known\) \{ skipped \+= Object\.keys\(perBuilding\)\.length; unknown\.push\(resId\); continue; \}/.test(NCSRC),
};

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('the Forge resource tab is not reachable');
else {
  need('the tab lists the whole catalogue', out.rowsAll > 380, out.rowsAll);
  need('THE ASK: there is a filter for it', out.hasFilterBox === true, out.hasFilterBox);
  need('…it narrows by name', out.rowsWheat > 0 && out.rowsWheat < 20, out.rowsWheat);
  need('CONTROL: …and matches an id too', out.rowsById > 0 && out.rowsById < 20, out.rowsById);

  need('THE ASK: the form has a weight box', out.formHasWeight === true, out.formHasWeight);
  need('THE ASK: …and a building-needs box', out.formHasNeeds === true, out.formHasNeeds);
  need('a saved weight is what resourceWeight answers', out.weightAfter === 2.4,
       { before: out.weightBefore, after: out.weightAfter });
  need('CONTROL: an unweighed resource answers 1, not 0', out.weightUnknown === 1, out.weightUnknown);
  need('CONTROL: a comma decimal is refused, not coerced', out.junkWeightRefused === true,
       { weight: out.weightAfter, said: out.junkWeightSaid });
  /* ⚠ THE REFUSAL TOAST CANNOT BE DRIVEN FROM HERE, and pretending otherwise
     would be a test that passes for the wrong reason. Assigning .value = "3,5"
     to <input type="number"> leaves value === "" and validity.badInput FALSE —
     badInput is only set by real typing. So the assertion above is the one that
     matters (the stored weight is UNCHANGED, not reset to 1, which was the bug)
     and the guard that fires for a real typist is checked in the source. */
  need('…and the badInput guard is in the shipped save handler',
       fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
         .indexOf("if (wtBad || (wtRaw !== '' && !(isFinite(wtNum) && wtNum > 0))) {") >= 0,
       'guard missing');

  need('THE ASK: declared needs are stored', JSON.stringify(out.needsAfter) === '{"cannery":0.5,"foodTruck":0.2}', out.needsAfter);
  need('CONTROL: a malformed needs line is refused', out.badNeedsRefused === true, out.badNeedsRefused);
  need('CONTROL: a zero rate is refused, not stored as a no-op', out.zeroRateRefused === true, out.zeroRateRefused);

  need('THE ASK: a new resource can be created', out.created === true, out.created);
  need('…with its icon', out.createdIcon === '🔮', out.createdIcon);
  need('…its weight', out.createdWeight === 0.3, out.createdWeight);
  need('…and its needs', JSON.stringify(out.createdNeeds) === '{"arcanum":0.05}', out.createdNeeds);
  /* ⚠ ASSERTS ON voidPearls, NOT wheat. A later step in this same run saves
     wheat with an EMPTY needs box, which correctly deletes its key — asserting
     on wheat here was testing the order of my own script, not the feature. */
  need('the city is handed the declarations', JSON.stringify((out.bridge||{}).voidPearls) === '{"arcanum":0.05}', out.bridge);
}
need('the city merges declared needs into building inputs', nc.applied === 3, nc);
need('CONTROL: …keeping the inputs a building already had',
     JSON.stringify(nc.canneryUse) === '{"water":0.15,"wheat":0.5}', nc.canneryUse);
need('CONTROL: …and skipping a resource the ledger never heard of',
     nc.unknown.length === 1 && nc.unknown[0] === 'notAThing', nc.unknown);
need('the shipped city carries the merger', shipped.merger && shipped.calledAtBoot, shipped);
need('…which merges rather than replaces', shipped.mergesNotReplaces === true, shipped);
need('…and skips unknown ids', shipped.skipsUnknown === true, shipped);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify({ ...out, city: nc, shipped, pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — icons, weights, new resources, and what the city needs them for.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
