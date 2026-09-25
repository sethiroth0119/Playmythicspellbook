/* ══════════════════════════════════════════════════════════════════════════
   🏦 DRIVE-CORPVAULT — the rewritten Vault screen, in a real browser.

   jsxcheck proves screens.jsx PARSES. It cannot tell a table full of real
   corp_vault rows from a component that threw on mount and left the screen
   blank — which is exactly the failure this screen shipped with for months
   (it read window.ECON.ASSETS, a permanently empty array, and drew a
   headerless table with an Est. Net Worth of 0).

   What is measured here, all of it out of the DOM:
     1  ONE ROW PER corp_vault ROW — name, item_id, kind, depositor and qty on
        screen are the seeded row and nothing else. A critic can diff the same
        way against `select depositor_name,kind,item_id,name,qty from corp_vault`.
     2  CARD ART — a card row paints the <img> at the art URL the bridge sent,
        not a glyph; a resource row paints no <img>.
     3  EVERY NUMBER ADDS UP — the header total, the "showing N of M" line and
        the per-tab counts all equal the sum of what is listed, under filtering.
     4  NOTHING COMES FROM ECON.ASSETS — a poison row pushed into that array
        must not appear.
     5  WITHDRAW POSTS THE RIGHT ACTION — the dialog offers the POOLED figure
        across depositors and JB_action carries the exact kind/id/qty.
     6  IT DEGRADES — vaultRpc 'missing' disables withdraw and names sql/045;
        no econ / not signed in / no corp / a failed read each say which one it
        is instead of drawing an empty table.
     7  NO NaN, NO undefined, for rows with a null / string / absent qty.

   ⚠ DO NOT fulfil the React/ReactDOM/Babel <script> tags from node_modules.
     All three carry an `integrity` hash; substituted bytes are rejected by SRI
     SILENTLY — a blank page with a clean console. They come from the network.

   Run:  node .gauntlet/drive-corpvault.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const PORT = 8900 + (process.pid % 90);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};

/* THE SEED IS THE SHAPE _jbEcon() SENDS (index.html): one entry per corp_vault
   row, `art` present only on cards. Two depositors hold the SAME resource on
   purpose — that is the case the pooled withdrawal exists for. The last three
   rows are the hostile ones: qty as a string (PostgREST returns `numeric` as a
   string), qty null, and qty 0 (a stack that has been fully drawn down). */
const ART = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyIiBoZWlnaHQ9IjIiLz4=';
const VAULT = [
  { rowId: 'r1', depId: 'u-alpha', dep: 'Alpha',  kind: 'card',     id: 'card:ashen-rider', name: 'Ashen Rider', icon: '🃏', qty: 3,     art: ART },
  { rowId: 'r2', depId: 'u-bravo', dep: 'Bravo',  kind: 'card',     id: 'card:no-art',      name: 'No Art Card', icon: '🃏', qty: 1,     art: '' },
  { rowId: 'r3', depId: 'u-alpha', dep: 'Alpha',  kind: 'resource', id: 'scrapMetal',       name: 'Scrap Metal', icon: '⚙', qty: 120,   art: '' },
  { rowId: 'r4', depId: 'u-bravo', dep: 'Bravo',  kind: 'resource', id: 'scrapMetal',       name: 'Scrap Metal', icon: '⚙', qty: '80',  art: '' },
  { rowId: 'r5', depId: 'u-alpha', dep: 'Alpha',  kind: 'item',     id: 'relic:coil',       name: 'Coil Relic',  icon: '🏺', qty: null,  art: '' },
  { rowId: 'r6', depId: 'u-bravo', dep: 'Bravo',  kind: 'item',     id: 'relic:spent',      name: 'Spent Relic', icon: '🏺', qty: 0,     art: '' },
];
/* By hand from the six rows: r5 (null) and r6 (0) are not holdings and must not
   be listed. That leaves 4 stacks — 2 cards, 2 resources, 0 items — totalling
   3 + 1 + 120 + 80 = 204 units, and a scrapMetal POOL of 200. */
const EXPECT_STACKS = 4;
const EXPECT_UNITS  = 204;
const EXPECT_COUNTS = { all: 4, card: 2, item: 0, resource: 2 };
const EXPECT_POOL   = 200;

function econ(over) {
  return Object.assign({
    signedIn: true, corpChecked: true, isAdmin: false,
    corp: { id: 'corp-1', name: 'BLACK SUN', tag: 'BSN', role: 'member' },
    handle: 'Charlie', amOwner: false, cinders: 0, aza: 0, mt: 0,
    roster: [], memberCount: 2, memberCap: 25, requests: [], pendingHires: [],
    vault: VAULT, vaultRpc: 'ok', vaultUnknown: false,
    transfers: [], corps: [], resources: [], memberCities: [], memberCitiesState: 'ok',
    depositable: { cards: [], items: [], resources: [] },
    guildChat: [], legalCases: [], agencyListings: [], myOwnedHouses: [],
    realEstateListings: [], convoys: [], opArt: {}, reArt: {}, opEcon: {},
  }, over || {});
}

async function open(e) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (x) => errs.push(String(x).slice(0, 240)));
  // Record what the screen posts back instead of letting it reach a parent
  // that is not there — this is how claim 5 is measured.
  await page.addInitScript((seed) => {
    window.__JB = { econ: seed, ready: true };
    window.__ACTIONS = [];
    window.JB_action = (p) => { window.__ACTIONS.push(p); };
  }, e);
  await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
  // ⚠ _jbridge.js DEFINES window.JB_action at load, clobbering any stub planted
  //   by addInitScript — so the recorder is installed after the page is up.
  await page.evaluate(() => { window.__ACTIONS = []; window.JB_action = (p) => { window.__ACTIONS.push(p); }; });
  return { ctx, page, errs };
}

/* Read the screen the way a player sees it. */
const readScreen = (page) => page.evaluate(() => {
  const scr = document.querySelector('.screen');
  if (!scr) return null;
  const tbl = scr.querySelector('table.tbl');
  const rows = tbl ? Array.from(tbl.querySelectorAll('tbody tr')).map(tr => ({
    cells: Array.from(tr.querySelectorAll('td')).map(td => td.textContent.replace(/\s+/g, ' ').trim()),
    img: (tr.querySelector('img') || {}).src || '',
    withdrawDisabled: !!(tr.querySelector('button') && tr.querySelector('button').disabled),
  })) : [];
  const tabs = Array.from(scr.querySelectorAll('.tabs button')).map(b => ({
    label: (b.childNodes[0] || {}).textContent || '',
    count: Number(((b.querySelector('.count') || {}).textContent || '').trim()),
    active: b.getAttribute('data-active') === '1',
  }));
  return {
    head: (scr.querySelector('.screen-head') || {}).textContent.replace(/\s+/g, ' ').trim(),
    idTag: ((scr.querySelector('.screen-head .id') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    rows, tabs,
    text: scr.textContent.replace(/\s+/g, ' ').trim(),
    imgCount: scr.querySelectorAll('table.tbl img').length,
  };
});

// ── 1 / 2 / 3 / 7 ───────────────────────────────────────────────────────────
console.log('\n1. every listed row is a corp_vault row, and every number adds up');
{
  const { ctx, page, errs } = await open(econ());
  const s = await readScreen(page);
  ok('the screen mounted at all', !!s, errs.length ? 'pageerrors: ' + errs[0] : '');
  if (s) {
    s.rows.forEach((r, i) => console.log('   row ' + i + ': ' + JSON.stringify(r.cells) + (r.img ? '  [img]' : '')));
    console.log('   tabs: ' + JSON.stringify(s.tabs.map(t => t.label.trim() + '=' + t.count)));

    ok('🔴 one row per corp_vault row with qty > 0 (' + EXPECT_STACKS + ')', s.rows.length === EXPECT_STACKS, s.rows.length + ' rows');
    ok('🔴 a null-qty row is NOT listed as a 0 stack', !/Coil Relic/.test(s.text));
    ok('🔴 a fully drawn-down (qty 0) row is NOT listed', !/Spent Relic/.test(s.text));

    const flat = s.rows.map(r => r.cells.join(' | '));
    ok('VERBATIM: name + item_id + kind + depositor + qty, per row',
       flat.some(t => /Ashen Rider/.test(t) && /card:ashen-rider/.test(t) && /card/.test(t) && /Alpha/.test(t) && /\b3\b/.test(t)) &&
       flat.some(t => /Scrap Metal/.test(t) && /scrapMetal/.test(t) && /Bravo/.test(t) && /\b80\b/.test(t)),
       JSON.stringify(flat[0]));
    ok('🔴 a numeric qty arriving as a STRING ("80") prints as 80, not NaN',
       flat.some(t => /Bravo/.test(t) && /\b80\b/.test(t) && !/NaN/.test(t)));

    // 2 — card art
    const cardRow = s.rows.find(r => /Ashen Rider/.test(r.cells.join(' ')));
    const noArtRow = s.rows.find(r => /No Art Card/.test(r.cells.join(' ')));
    const resRow = s.rows.find(r => /Scrap Metal/.test(r.cells.join(' ')));
    ok('🔴 a card stack paints the art the bridge resolved for that card',
       !!cardRow && cardRow.img === ART, cardRow ? cardRow.img.slice(0, 42) : 'no card row');
    ok('a card with no resolvable art falls back to its icon — no invented placeholder',
       !!noArtRow && !noArtRow.img);
    ok('a resource stack paints no card art', !!resRow && !resRow.img);
    ok('exactly one <img> in the table (only the one card that has art)', s.imgCount === 1, String(s.imgCount));

    // 3 — the arithmetic
    ok('header total = sum of the listed qty (' + EXPECT_UNITS + ')',
       new RegExp(EXPECT_UNITS + '\\s*units in ' + EXPECT_STACKS + ' stacks').test(s.head), s.head.slice(0, 120));
    ok('"Showing N of M stacks" = the number of rows drawn',
       new RegExp('Showing ' + EXPECT_STACKS + ' of ' + EXPECT_STACKS + ' stacks').test(s.text));
    ok('"units in view" = sum of the listed qty', new RegExp(EXPECT_UNITS + ' units in view').test(s.text));
    const tabMap = {};
    s.tabs.forEach(t => { tabMap[t.label.trim()] = t.count; });
    ok('tab counts are the real per-kind stack counts',
       tabMap.All === EXPECT_COUNTS.all && tabMap.Cards === EXPECT_COUNTS.card &&
       tabMap['Items / Relics'] === EXPECT_COUNTS.item && tabMap.Resources === EXPECT_COUNTS.resource,
       JSON.stringify(tabMap));
    ok('…and the per-kind counts sum to the All count',
       (tabMap.Cards + tabMap['Items / Relics'] + tabMap.Resources) === tabMap.All);
    // Asserted on the CELL, not on screen text: textContent runs the columns
    // together ("120" + "200" = "120200") and a \b match there proves nothing.
    const scrapRows = s.rows.filter(r => /scrapMetal/.test(r.cells.join(' ')));
    ok('the "corp pool" column carries the cross-depositor total where two members share an item',
       scrapRows.length === 2 && scrapRows.every(r => r.cells.includes(String(EXPECT_POOL))),
       JSON.stringify(scrapRows.map(r => r.cells)));
    ok('…and a stack nobody else holds shows an em dash there, not a repeat of its own qty',
       s.rows.filter(r => /Ashen Rider/.test(r.cells.join(' '))).every(r => r.cells.includes('—')));

    // the identity line — econ.handle, never ECON.PLAYER.id
    ok('🔴 the id tag is the real corp + handle, not "HOLDER " + an empty id',
       /BLACK SUN/.test(s.idTag) && /Charlie/.test(s.idTag) && !/HOLDER/.test(s.idTag), JSON.stringify(s.idTag));
    ok('the dead "Send asset" button is gone', !/Send asset/.test(s.text));

    // 7 — no NaN / undefined
    ok('🔴 no NaN and no undefined anywhere on the screen', !/NaN|undefined/.test(s.text),
       (s.text.match(/NaN|undefined/g) || []).join(','));
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 4 — nothing on this screen comes from ECON.ASSETS ───────────────────────
console.log('\n2. ECON.ASSETS is not a source');
{
  const { ctx, page, errs } = await open(econ());
  const after = await page.evaluate(() => {
    window.ECON.ASSETS.push({ id: 'POISONED', name: 'POISONED ASSET', kind: 'relic', rarity: 'mythic', qty: 999, market: 999 });
    window.dispatchEvent(new Event('jbdata'));
    return new Promise(r => setTimeout(() => r(document.querySelector('.screen').textContent), 400));
  });
  ok('🔴 a row pushed into window.ECON.ASSETS never reaches the Vault screen', !/POISONED/.test(after));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 3 (filtering) ───────────────────────────────────────────────────────────
console.log('\n3. the totals still agree after filtering');
{
  const { ctx, page, errs } = await open(econ());
  await page.locator('.tabs button', { hasText: 'Resources' }).first().click();
  await page.waitForTimeout(250);
  const s = await readScreen(page);
  ok('the Resources tab lists exactly the resource stacks', s.rows.length === EXPECT_COUNTS.resource, s.rows.length + ' rows');
  ok('"Showing 2 of 4 stacks"', /Showing 2 of 4 stacks/.test(s.text));
  ok('🔴 "units in view" drops to the filtered sum (200), while the header total stays 204',
     /200 units in view/.test(s.text) && /204 units in 4 stacks/.test(s.head),
     s.text.match(/Showing[^A-Z]*|\d+ units in view/g));
  await page.locator('.toolbar input.search').fill('Bravo');
  await page.waitForTimeout(250);
  const s2 = await readScreen(page);
  ok('searching a depositor name filters to that depositor', s2.rows.length === 1 && /Bravo/.test(s2.rows[0].cells.join(' ')));
  ok('…and the view total follows it (80)', /80 units in view/.test(s2.text));
  ok('no NaN after filtering', !/NaN|undefined/.test(s2.text));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 5 — withdraw posts the real action, with the POOLED maximum ─────────────
console.log('\n4. withdraw');
{
  const { ctx, page, errs } = await open(econ());
  // The scrapMetal row belonging to Alpha (120) — the pool across depositors is 200.
  const row = page.locator('table.tbl tbody tr', { hasText: 'scrapMetal' }).first();
  await row.locator('button', { hasText: 'Withdraw' }).click();
  await page.waitForTimeout(300);
  const modal = await page.evaluate(() => {
    const m = document.querySelector('.modal');
    return m ? { text: m.textContent.replace(/\s+/g, ' ').trim(), max: (m.querySelector('input[type=number]') || {}).max } : null;
  });
  ok('the withdraw dialog opened', !!modal);
  if (modal) {
    ok('🔴 it offers the POOL across depositors (200), not the clicked row (120)',
       /holds 200/.test(modal.text) && modal.max === '200', JSON.stringify(modal.max) + ' · ' + modal.text.slice(0, 90));
    ok('…and it says where that number comes from', /oldest deposits first/.test(modal.text));
    ok('no NaN in the dialog', !/NaN|undefined/.test(modal.text));
  }
  await page.locator('.modal input[type=number]').fill('150');
  await page.locator('.modal-foot button', { hasText: 'Withdraw' }).click();
  await page.waitForTimeout(300);
  const acts = await page.evaluate(() => window.__ACTIONS);
  console.log('   posted: ' + JSON.stringify(acts));
  ok('🔴 exactly one action was posted', acts.length === 1, JSON.stringify(acts));
  ok('…and it is vaultWithdraw for the exact kind / item / qty',
     acts.length === 1 && acts[0].kind === 'vaultWithdraw' && acts[0].itemKind === 'resource'
     && acts[0].itemId === 'scrapMetal' && acts[0].qty === 150, JSON.stringify(acts[0]));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 6 — degradation ─────────────────────────────────────────────────────────
console.log('\n5. it degrades');
{
  // sql/045 not applied
  const { ctx, page, errs } = await open(econ({ vaultRpc: 'missing' }));
  const s = await readScreen(page);
  ok('🔴 every real row still renders with the migration unapplied', s.rows.length === EXPECT_STACKS, s.rows.length + ' rows');
  ok('🔴 withdraw is visibly disabled', s.rows.every(r => r.withdrawDisabled));
  ok('🔴 …and the message names the file to apply', /sql\/045_corp_vault_rpcs\.sql/.test(s.text));
  ok('no NaN', !/NaN|undefined/.test(s.text));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
{
  // a failed read of corp_vault — NOT an empty vault
  const { ctx, page, errs } = await open(econ({ vault: [], vaultUnknown: true }));
  const s = await readScreen(page);
  ok('a failed vault read says so instead of drawing an empty table', /Could not read the vault/.test(s.text));
  ok('…and states nothing has been lost', /nothing has been lost/i.test(s.text));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
{
  // in a corp, genuinely empty
  const { ctx, page, errs } = await open(econ({ vault: [] }));
  const s = await readScreen(page);
  ok('an empty vault says it is empty and how to fill it', /vault is empty/i.test(s.text) && /Deposit to vault/.test(s.text));
  ok('…and the totals are 0, not blank or NaN', /0 units in 0 stacks/.test(s.head), s.head.slice(0, 90));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
{
  // no corporation
  const { ctx, page, errs } = await open(econ({ corp: null, vault: [] }));
  const s = await readScreen(page);
  ok('no corporation → says so, and points at Guild & Hiring', /not in a corporation/i.test(s.text) && /Guild & Hiring/.test(s.text));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
{
  // signed out
  const { ctx, page, errs } = await open(econ({ signedIn: false, corp: null, vault: [] }));
  const s = await readScreen(page);
  ok('signed out → asks for a sign-in, draws no table', /Sign in to see the vault/.test(s.text) && s.rows.length === 0);
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
{
  // NO BRIDGE AT ALL — the standalone / offline case.
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (x) => errs.push(String(x).slice(0, 240)));
  await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
  const s = await readScreen(page);
  ok('🔴 with no bridge at all the screen still renders an honest notice', !!s && /Not connected to the game/.test(s.text));
  ok('…and no headerless table', !!s && s.rows.length === 0);
  ok('no NaN', !!s && !/NaN|undefined/.test(s.text));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── reachability ────────────────────────────────────────────────────────────
console.log('\n6. the door');
{
  const { ctx, page, errs } = await open(econ());
  /* Leave the screen first, then come back through the CHROME. Landing on the
     Vault by default proves nothing about the door. The sidebar entry carries an
     icon glyph next to its label, so it is matched on the trailing word. */
  const left = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, a'))
      .find(e => /Marketplace$/.test((e.textContent || '').trim()));
    if (!b) return false;
    b.click(); return true;
  });
  await page.waitForTimeout(400);
  ok('navigated away first (Marketplace)', left && !/Corporation Vault/.test((await readScreen(page)).text));
  const viaNav = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, a'))
      .find(e => /Vault$/.test((e.textContent || '').trim()));
    if (!b) return null;
    b.click(); return true;
  });
  await page.waitForTimeout(400);
  ok('🔴 there is a "Vault" entry in the app chrome and it opens this screen',
     viaNav === true && /Corporation Vault/.test((await readScreen(page)).text));

  /* The other door: putting things IN. The button fires the jb:open event the
     existing CorpVaultModal listens for — the screen that lists what you can
     deposit. A withdraw-only vault screen would be half a feature. */
  await page.locator('.toolbar button', { hasText: 'Deposit to vault' }).click();
  await page.waitForTimeout(400);
  const modal = await page.evaluate(() => {
    const m = document.querySelector('.modal');
    return m ? m.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  ok('🔴 "Deposit to vault" opens the deposit panel', !!modal && /Corporation Vault/.test(modal),
     modal ? modal.slice(0, 80) : 'no modal');
  ok('…and it is the real deposit list, not a second copy of the table',
     !!modal && /Deposit from your collection/.test(modal));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ ALL PASS'));
process.exit(fails ? 1 : 0);
