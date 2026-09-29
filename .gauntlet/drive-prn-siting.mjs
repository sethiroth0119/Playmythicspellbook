/* ══════════════════════════════════════════════════════════════════════════
   🔌 DRIVE-PRN-SITING — a licensed PRN stands where the player puts it.

   THE ASK: "Make it where the PRNs that are bought buy players/build shows up in
   their city builder where they can build it vs it just appear randomly."

   WHAT WAS THERE: licensing a PRN inserted a row in economy_nodes and nothing
   else. It paid out, it showed on the Reserve panel, and it had no place on the
   map at all — there was no way to put it anywhere.

   ⚠ THE HOST IS STUBBED, DELIBERATELY AND NARROWLY. cityPrnList/Site/Unsite
     talk to Supabase through _nodeMetaWrite, which a browser with no session
     cannot reach. The stub stands in for the NETWORK only: every rule under
     test — which cards unlock, what happens on place, what a failed write does,
     what reload draws — is the shipped city code running against it.

   Pinned, with controls:
     · a PRN type the player owns none of is LOCKED, and says where to get one
     · CONTROL: an owned, un-sited one unlocks with a PLACE pill
     · placing writes the site and leaves a real tile
     · 🔴 CONTROL: a FAILED write rolls the tile back — no ghost building
     · 🔴 CONTROL: placing with none owned is refused before any tile is written
     · reload draws a PRN the row says stands here  ← the state you get by doing nothing
     · CONTROL: a prn_ tile with no row behind it is removed as a ghost
     · 🔴 CONTROL: an empty list means "cannot tell", and clears NOTHING
     · every PRN blueprint has a mesh — no invisible building on a paid plot

   Run:  node .gauntlet/drive-prn-siting.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9410 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});

/* The city looks for the seam on window.parent. Standalone, `parent === window`,
   so _prnParent() returns null — install the stub on window itself and point
   the lookup at it. Injected before any script runs. */
await pg.addInitScript(() => {
  window.__PRN = { rows: [], failNext: false, calls: [] };
  window.cityPrnList = () => window.__PRN.rows.map(r => ({ ...r }));
  window.cityPrnSite = async (id, x, y, rot) => {
    window.__PRN.calls.push({ op: 'site', id, x, y, rot });
    if (window.__PRN.failNext) { window.__PRN.failNext = false; return { ok: false, error: 'stubbed-failure' }; }
    const r = window.__PRN.rows.find(q => q.id === id);
    if (!r) return { ok: false, error: 'no-prn' };
    r.site = { nodeId: 'city', x: x | 0, y: y | 0 }; r.here = true;
    return { ok: true, site: r.site };
  };
  window.cityPrnUnsite = async (id) => {
    window.__PRN.calls.push({ op: 'unsite', id });
    const r = window.__PRN.rows.find(q => q.id === id);
    if (r) { r.site = null; r.here = false; }
    return { ok: true };
  };
});

await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4000);

/* No parent-hack needed: _prnParent() accepts a same-window host when the seam
   is present on it, which is exactly the standalone/driver case. */

const out = {};

out.blueprints = await pg.evaluate(() => {
  const o = { types: [], noMesh: [], costed: [] };
  try {
    o.types = window.__nc.jobfair.prnTypes() || [];
    for (const k of o.types) {
      /* 🧱 buildMesh has NO default arm: a type with no recipe renders an empty
         group, i.e. an invisible building on a plot a licence was spent on. */
      const mb = window.__nc.meshBox(k, 1);
      if (!mb || mb.empty || !(mb.meshes > 0)) o.noMesh.push(k);
      const d = window.__nc.jobfair.prnDef(k) || {};
      if (Object.keys(d.cost || {}).length) o.costed.push(k);   // must be FREE: already paid
    }
  } catch (e) { o.err = String(e).slice(0, 140); }
  return o;
});

/* ── the shop gate ───────────────────────────────────────────────────────── */
out.locked = await pg.evaluate(async () => {
  window.__PRN.rows = [];
  window.__nc.jobfair.shopOpen();
  await new Promise(r => setTimeout(r, 500));
  const card = document.querySelector('#shopbody [data-build="prn_supply"]');
  /* ⚠ NO MANUAL RE-PAINT HERE. An earlier draft called prnPaint() before
     reading, which made this assertion pass against a state the player never
     sees — it was diagnosing the bug, not testing the feature. The card must be
     correct from the shipped render alone. */
  return { present: !!card, locked: !!(card && card.classList.contains('opslock')),
           owned: !!(card && card.classList.contains('opsown')),
           text: card ? (card.querySelector('.sc') || {}).textContent : null };
});

out.unlocked = await pg.evaluate(async () => {
  window.__PRN.rows = [{ id: 'p1', type: 'supply', label: 'Supply PRN', icon: '📦',
                         status: 'building', active: true, site: null, here: false }];
  window.__nc.jobfair.shopOpen();
  await new Promise(r => setTimeout(r, 400));
  const card = document.querySelector('#shopbody [data-build="prn_supply"]');
  return { present: !!card, owned: !!(card && card.classList.contains('opsown')),
           text: card ? (card.querySelector('.sc') || {}).textContent : null };
});

/* ── placing ─────────────────────────────────────────────────────────────── */
out.place = await pg.evaluate(async () => {
  const o = {};
  window.__PRN.rows = [{ id: 'p1', type: 'supply', label: 'Supply PRN', icon: '📦',
                         status: 'building', active: true, site: null, here: false }];
  window.__nc.jobfair.prnReconcile();
  await window.__nc.jobfair.place(9, 9, 'prn_supply');
  await new Promise(r => setTimeout(r, 400));
  const t = window.__nc.jobfair.tileAt('9,9');
  o.tileType = t && t.type;
  o.sited = !!(window.__PRN.rows[0].site);
  o.at = window.__PRN.rows[0].site;
  return o;
});

/* 🔴 a failed write must roll the tile back */
out.rollback = await pg.evaluate(async () => {
  const o = {};
  window.__PRN.rows = [{ id: 'p2', type: 'fuel', label: 'Fuel PRN', icon: '⛽',
                         status: 'building', active: true, site: null, here: false }];
  window.__PRN.failNext = true;
  await window.__nc.jobfair.place(11, 9, 'prn_fuel');
  await new Promise(r => setTimeout(r, 400));
  o.tile = window.__nc.jobfair.tileAt('11,9');
  o.sited = !!(window.__PRN.rows[0].site);
  return o;
});

/* 🔴 placing with none owned must be refused before any tile is written */
out.refused = await pg.evaluate(async () => {
  window.__PRN.rows = [];
  await window.__nc.jobfair.place(13, 9, 'prn_mining');
  await new Promise(r => setTimeout(r, 300));
  return { tile: window.__nc.jobfair.tileAt('13,9'), calls: window.__PRN.calls.filter(c => c.op === 'site' && c.id === undefined).length };
});

/* ── reconcile ───────────────────────────────────────────────────────────── */
out.reconcile = await pg.evaluate(async () => {
  const o = {};
  /* a) the row says it stands here, the map has nothing → draw it */
  window.__PRN.rows = [{ id: 'p9', type: 'storage', label: 'Storage PRN', icon: '🏗',
                         status: 'building', active: true, site: { nodeId: 'city', x: 15, y: 15 }, here: true }];
  window.__nc.jobfair.prnReconcile();
  o.drew = (window.__nc.jobfair.tileAt('15,15') || {}).type;

  /* b) a prn_ tile with no row behind it → a ghost, removed */
  window.__PRN.rows = [{ id: 'p9', type: 'storage', label: 'Storage PRN', icon: '🏗',
                         status: 'building', active: true, site: { nodeId: 'city', x: 15, y: 15 }, here: true }];
  await window.__nc.jobfair.place(17, 15, 'prn_convoy');   // no row for convoy
  window.__nc.jobfair.prnReconcile();
  o.ghostGone = !window.__nc.jobfair.tileAt('17,15');

  /* 🔴 c) an EMPTY list means "cannot tell" and must clear NOTHING. */
  window.__PRN.rows = [];
  window.__nc.jobfair.prnReconcile();
  o.survivedEmptyList = (window.__nc.jobfair.tileAt('15,15') || {}).type;
  return o;
});

/* ── 🔌 the inspector panel ──────────────────────────────────────────────── */
out.panel = await pg.evaluate(async () => {
  const o = {};
  const J = window.__nc.jobfair;
  /* An ONLINE node with money waiting and a hazard running — the three things
     a player cannot learn from the generic building panel. */
  window.__PRN.rows = [{ id: 'pi', type: 'mining', label: 'Mining PRN', icon: '⛏',
    name: 'ACME Mining PRN', status: 'building', active: true, level: 3,
    eff: 64, claimable: 4200, risk: { name: 'Convoy raid', lock: true },
    site: { nodeId: 'city', x: 6, y: 6 }, here: true }];
  J.prnReconcile();
  J.openInspect('6,6');
  await new Promise(r => setTimeout(r, 300));
  const el = document.getElementById('prn-inspect');
  o.present = !!el;
  o.text = el ? el.textContent : null;
  o.hasButton = !!(el && el.querySelector('#prn-open'));

  /* 🏗 …and one still under construction shows the countdown instead. */
  window.__PRN.rows = [{ id: 'pb', type: 'fuel', label: 'Fuel PRN', icon: '⛽',
    name: 'ACME Fuel PRN', status: 'building', active: false, level: 1,
    eff: 100, claimable: 0, risk: null, readyAt: Date.now() + 3 * 3600000,
    site: { nodeId: 'city', x: 8, y: 6 }, here: true }];
  J.prnReconcile();
  J.openInspect('8,6');
  await new Promise(r => setTimeout(r, 300));
  o.buildingText = (document.getElementById('prn-inspect') || {}).textContent || null;

  /* 🔴 …and a tile whose node the Reserve has never heard of SAYS SO rather
     than rendering empty fields that read as a broken panel. */
  window.__PRN.rows = [{ id: 'px', type: 'mining', label: 'Mining PRN', icon: '⛏',
    status: 'building', active: true, site: { nodeId: 'city', x: 6, y: 6 }, here: true }];
  /* ⚠ The read cache holds for 1.5s, so the swap above is invisible without
     this — an earlier run 'passed' the wrong branch because the panel was still
     reading the row that had just been removed. Bust it, and do NOT reconcile:
     reconcile would clear the ghost tile, which is the OTHER behaviour. */
  J.prnBust();
  J.openInspect('8,6');   // 8,6 still holds a prn_fuel tile, now with no row
  await new Promise(r => setTimeout(r, 300));
  o.orphanText = (document.getElementById('prn-inspect') || {}).textContent || null;
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const B = out.blueprints || {}, L = out.locked || {}, U = out.unlocked || {},
      PL = out.place || {}, RB = out.rollback || {}, RF = out.refused || {}, RC = out.reconcile || {};

need('THE ASK: every PRN type is a build blueprint', (B.types || []).length === 9, B.types);
need('🧱 …and every one has a mesh — no invisible building on a paid plot',
     (B.noMesh || []).length === 0, B.noMesh);
need('…and every one is FREE to place, the licence being already paid',
     (B.costed || []).length === 0, B.costed);

need('a PRN you own none of is LOCKED', L.present === true && L.locked === true, L);
need('…and says where to get one', /Foundation Reserve/i.test(String(L.text || '')), L.text);
need('CONTROL: one you own unlocks', U.present === true && U.owned === true, U);
need('…with a PLACE pill', /PLACE/.test(String(U.text || '')), U.text);
/* 🔴 THE status COLUMN IS NEVER FLIPPED — measured on the live database, all 30
   PRNs finished weeks ago and every one still reads status 'building'. The card
   must read the COMPUTED active flag, or it tells every holder their finished
   PRN is still under construction, forever. The stub above therefore ships the
   real shape: status 'building' AND active true. */
need('🔴 CONTROL: a finished PRN is not labelled still-building',
     !/still building/i.test(String(U.text || '')), U.text);

need('THE ASK: placing leaves a real tile', PL.tileType === 'prn_supply', PL);
need('…and records the site', PL.sited === true, PL.at);

need('🔴 CONTROL: a failed write leaves NO ghost building', !RB.tile, RB);
need('…and records no site', RB.sited === false, RB);
need('🔴 CONTROL: placing with none owned writes no tile', !RF.tile, RF);

need('reload draws a PRN the row says stands here', RC.drew === 'prn_storage', RC);
need('CONTROL: a tile with no row behind it is cleared as a ghost', RC.ghostGone === true, RC);
need('🔴 CONTROL: an empty list means "cannot tell" and clears NOTHING',
     RC.survivedEmptyList === 'prn_storage', RC);
const PN = out.panel || {};
need('THE ASK: a placed PRN gets its own panel', PN.present === true, PN);
need('…naming the node and its level', /ACME Mining PRN/.test(String(PN.text || '')) && /level 3/.test(String(PN.text || '')), PN.text);
need('…its efficiency', /64%/.test(String(PN.text || '')), PN.text);
need('…what is waiting to be collected', /4,200/.test(String(PN.text || '')), PN.text);
need('🔴 …and a live hazard, which is the thing a player would otherwise miss',
     /Convoy raid/.test(String(PN.text || '')) && /until it is defended/.test(String(PN.text || '')), PN.text);
need('…with a way back to the Reserve', PN.hasButton === true, PN.hasButton);
need('CONTROL: one still building shows a countdown, not an efficiency',
     /Still being built/.test(String(PN.buildingText || '')) && !/Efficiency/.test(String(PN.buildingText || '')), PN.buildingText);
need('🔴 CONTROL: a tile the Reserve has no record of SAYS SO', /no record of a node/.test(String(PN.orphanText || '')), PN.orphanText);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2).slice(0, 2600));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — a licensed PRN is placed where the player chooses, and never appears anywhere they did not.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
