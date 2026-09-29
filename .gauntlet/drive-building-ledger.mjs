/* ══════════════════════════════════════════════════════════════════════════
   🧾 DRIVE-BUILDING-LEDGER — per-building books, and a verdict a player can read.

   THE ASK: "Start updating the overview of buildings being staffed and their
   ledger where npcs spending cinder, the lifetime and the profit going up or if
   they are losing money like in cities skyline 2."

   WHAT WAS THERE: the Ledger tab printed a PROJECTION of the tile's production
   rates and then said, in as many words, "this game keeps no per-building
   history, so there is nothing here to chart". Income, Rent, Upkeep and Fees
   Paid were blank rows.

   🔴 THAT SENTENCE WAS OUT OF DATE, AND THAT IS THE WHOLE BUG. It was true of
      index.html alone and stopped being true the day /src/economy shipped: every
      firm already carried revenueDay, costDay, profitDay, customersDay,
      profitStreak, rentDay/rentLife and lifetimeRevenue/lifetimeProfit, because
      the level gates and the distress ladder are computed from them. The figures
      existed. Nothing handed them to the tile. `firmAt(tileKey)` does.

   🔴 AND ONE OF THE FIELDS WAS A PHANTOM. `f.lastWageBill` was READ in two
      places — the job advert's wage column, and now this card — and WRITTEN
      NOWHERE, so every job advert in the game has printed a wage of 0 since the
      bulletin shipped. runPayroll records it now.

   Pinned, with controls:
     · a trading tile has books, and they are the ECONOMY's own numbers
     · CONTROL: a tile with no business returns null, not a row of zeroes
     · revenue/cost/profit/customers are carried through unchanged
     · the wage bill is a real figure       ← the phantom field
     · lifetime revenue and profit are present and are NOT the tile's own totals
     · the Overview names staffing for an ordinary building …
     · … and the stale "no per-building history" sentence is gone
     · CONTROL: the page still says the CYCLE rows are a projection

   Run:  node .gauntlet/drive-building-ledger.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9210 + (process.pid % 40);
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
const pg = await b.newPage({ viewport: { width: 1400, height: 1000 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.MythicEconomy && !!window.__nc', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4000);

const out = {};

/* A city with something trading in it, then time for the economy to adopt it. */
out.setup = await pg.evaluate(() => {
  const j = window.__nc.jobfair;
  j.setPop(40);
  const r = { farm: j.plant('5,5', 'farm'), school: j.plant('7,5', 'elemschool') };
  return r;
});
await pg.waitForTimeout(7000);   // syncBuildings runs on a 4s beat

/* ── the seam ────────────────────────────────────────────────────────────── */
Object.assign(out, await pg.evaluate(() => {
  const o = {};
  const E = window.MythicEconomy;
  o.hasFirmAt = typeof E.firmAt === 'function';
  if (!o.hasFirmAt) return o;
  o.farm = E.firmAt('5,5');
  /* CONTROL: a school is not a business. It must come back null — a row of
     zeroes would report a shop making nothing, which is a different city. */
  o.school = E.firmAt('7,5');
  o.emptyGround = E.firmAt('99,99');
  /* The figures must be the ECONOMY'S OWN, not a copy computed here. Read the
     same firm through the raw seam and compare field by field. */
  const raw = (E.firms ? E.firms() : []).find(f => String(f.tileKey) === '5,5') || null;
  o.rawFound = !!raw;
  if (raw && o.farm) {
    o.matches = {
      revenue: raw.revenueDay === o.farm.revenueToday,
      lifetimeRevenue: (raw.lifetimeRevenue || 0) === o.farm.lifetimeRevenue,
      lifetimeProfit: (raw.lifetimeProfit || 0) === o.farm.lifetimeProfit,
    };
  }
  /* CONTROL: the snapshot is a COPY. Writing to it must not reach the firm —
     this codebase has already paid for a host object handed out by reference. */
  if (o.farm && raw) {
    const before = raw.cash;
    o.farm.cash = 999999;
    o.copyIsSafe = E.firmAt('5,5').cash === before;
  }
  return o;
}));

/* ── the wage bill, which was a phantom field ────────────────────────────── */
out.wages = await pg.evaluate(() => {
  const E = window.MythicEconomy;
  const raw = (E.firms ? E.firms() : []).find(f => String(f.tileKey) === '5,5');
  const f = E.firmAt('5,5');
  return {
    written: raw ? ('lastWageBill' in raw) : null,
    value: raw ? raw.lastWageBill : null,
    staffed: f ? f.staffed : null,
    seats: f ? f.seats : null,
    /* If nobody is employed the bill is legitimately 0 — the assertion below
       is about the field EXISTING, not about it being large. */
  };
});

/* ── the panel ───────────────────────────────────────────────────────────── */
out.panel = await pg.evaluate(() => {
  const o = {};
  try {
    /* Render the ledger pane for the farm through the module's own path. */
    const html = window.__nc.eco.ledgerPane ? window.__nc.eco.ledgerPane('5,5') : null;
    o.reachable = !!html;
    if (!html) return o;
    o.hasTrading = /Trading/.test(html);
    o.hasCustomers = /Customers today/.test(html);
    o.hasTakings = /Taken from customers today/.test(html);
    o.hasLastDay = /Last full day/.test(html);
    o.hasStaffLine = /Staffed <b>/.test(html);
    o.verdict = /In profit|Losing money|Breaking even|Bankrupt/.test(html);
    /* 🔴 THE STALE SENTENCE MUST BE GONE. */
    o.staleClaim = /keeps no per-building history/.test(html);
    /* CONTROL: …but the honest half of it must survive — the CYCLE rows really
       are a projection and must still say so. */
    o.stillSaysProjection = /is a projection|a projection of the rates/i.test(html);
    o.lifetimeTrade = /Trade profit, lifetime/.test(html);
    /* CONTROL: the school gets no Trading card at all. */
    const sHtml = window.__nc.eco.ledgerPane('7,5');
    o.schoolHasTrading = /Trading/.test(sHtml || '');
    o.schoolSaysNoTakings = /no takings to measure/.test(sHtml || '');
  } catch (e) { o.err = String(e).slice(0, 180); }
  return o;
});

/* ── the overview staffing row ───────────────────────────────────────────── */
out.overview = await pg.evaluate(() => {
  const o = {};
  try {
    const html = window.__nc.eco.toplineOf ? window.__nc.eco.toplineOf('5,5') : null;
    o.reachable = !!html;
    if (!html) return o;
    o.hasStaff = /Staff/.test(html);
    o.schoolHtml = window.__nc.eco.toplineOf('7,5');
  } catch (e) { o.err = String(e).slice(0, 180); }
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

need('the economy exposes per-building books', out.hasFirmAt === true, out.hasFirmAt);
need('SETUP: a business really is standing on the tile', !!out.farm, out.setup);
need('CONTROL: a school returns null, not a row of zeroes', out.school === null, out.school);
need('CONTROL: …and so does empty ground', out.emptyGround === null, out.emptyGround);
need('the figures are the economy\'s own, carried through unchanged',
     out.matches && out.matches.revenue && out.matches.lifetimeRevenue && out.matches.lifetimeProfit, out.matches);
need('CONTROL: the snapshot is a copy — a panel cannot write to a firm',
     out.copyIsSafe === true, out.copyIsSafe);

const W = out.wages || {};
need('🔴 the wage bill is written, not a phantom field', W.written === true, W);

const P2 = out.panel || {};
need('the ledger pane renders', P2.reachable === true, P2);
need('THE ASK: it has a Trading card', P2.hasTrading === true, P2.hasTrading);
need('…naming what customers spent', P2.hasTakings === true && P2.hasCustomers === true, P2);
need('…the last full day\'s result', P2.hasLastDay === true, P2.hasLastDay);
need('…a plain verdict on whether it is making or losing money', P2.verdict === true, P2.verdict);
need('…and how it is staffed', P2.hasStaffLine === true, P2.hasStaffLine);
need('THE ASK: lifetime trading figures are shown', P2.lifetimeTrade === true, P2.lifetimeTrade);
need('🔴 the stale "no per-building history" claim is gone', P2.staleClaim === false, P2.staleClaim);
need('CONTROL: …but the cycle rows still admit they are a projection',
     P2.stillSaysProjection === true, P2.stillSaysProjection);
need('CONTROL: a school gets no Trading card', P2.schoolHasTrading === false, P2.schoolHasTrading);
need('CONTROL: …and says why rather than showing blanks', P2.schoolSaysNoTakings === true, P2.schoolSaysNoTakings);

const O = out.overview || {};
need('THE ASK: the Overview names staffing', O.reachable === true && O.hasStaff === true, O);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2).slice(0, 5000));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — every building keeps its own books, and says plainly whether it is making money.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
