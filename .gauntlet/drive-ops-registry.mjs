/* ══════════════════════════════════════════════════════════════════════════
   🏭 DRIVE-OPS-REGISTRY — the Operations cards print the ECONOMY, not a copy.

   THE DEFECT. public/corp/screens.jsx carried a hand-typed `startup` string,
   a `produces` list and a `name` on every OPERATIONS row, each under a note
   saying "display copy only, keep it in step by eye". Measured on this
   branch before the fix: OPS_ECON prices the Construction Co. at 0 (a free
   licence — OPS_FREE_LICENCE in index.html) and the card said
   "350,000 Cinder · 6k Metal"; construction's chips said Concrete / Steel and
   the operation yields metal; the Trash Crusher's chips matched its yields
   only because somebody typed them twice. The card used the string whenever
   the payload had not landed, so a player saw the wrong number and then
   watched it change.

   THE FIX. The row keeps only what the economy table does not carry (id,
   category, icon, focus, risk, tip). Name, product chips and the startup line
   are derived from econ.opEcon / econ.opLabels by opView(), with a neutral
   placeholder before the payload lands.

   WHAT IS MEASURED, out of the DOM, against the REAL tables lifted from
   index.html (so a retune there is a retune here, with no second copy):
     1  LIVE PAYLOAD — every card's name is OP_LABELS[id]; every card's startup
        is OPS_ECON[id].startup, and 0 prints as FREE; the Construction Co.
        card contains no '350,000'; the Trash Crusher's chips are exactly its
        OPS_ECON yields; every card's chip count equals its yields count.
     2  RETUNED PAYLOAD — change the payload and the card follows: a new
        label, a new price, a new yield set, and a resource NAME the payload
        carries wins over the derived one. The old figures do not appear.
     3  BEFORE THE PAYLOAD — an econ with no opEcon/opLabels (an older
        parent, or the bridge still in flight) shows the raw id, a dash for
        the price, no chips, and NONE of the old typed strings.
     4  STANDALONE — __JB.econ null, the screen still mounts and prints no
        old figure.
     5  SEARCH — "glass" finds the Trash Crusher because the payload says it
        yields glass, not because a list in screens.jsx said so.
     6  SOURCE — screens.jsx has no `startup: '`, no `produces: [`, and none of
        the OP_LABELS names as a string literal inside the OPERATIONS array.
     7  NO pageerrors in any scenario.

   ⚠ React/ReactDOM/Babel come from unpkg with SRI hashes; they must not be
     served from node_modules (substituted bytes fail SRI silently — a blank
     page with a clean console). Network is needed for those three files.

   Run:  node .gauntlet/drive-ops-registry.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const PORT = 8960 + (process.pid % 30);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};

/* ── the real tables, lifted from index.html ──────────────────────────────
   A brace-balanced slice that steps over strings and comments (OPS_ECON's
   comments quote `yields: {}` and the like, so a naive brace count is wrong),
   then evaluated as a literal. Both tables are pure literals — no identifier
   in either — so `new Function` is the same parse the browser does. */
const IDX = fs.readFileSync('public/index.html', 'utf8');
const SCREENS = fs.readFileSync('public/corp/screens.jsx', 'utf8');
function literal(src, decl) {
  const i = src.indexOf(decl); if (i < 0) throw new Error('cannot find ' + decl);
  const open = src.indexOf('{', i);
  let d = 0, j = open;
  while (j < src.length) {
    const c = src[j], n = src[j + 1];
    if (c === '/' && n === '*') { j = src.indexOf('*/', j + 2) + 2; continue; }
    if (c === '/' && n === '/') { j = src.indexOf('\n', j); continue; }
    if (c === "'" || c === '"' || c === '`') {
      let k = j + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      j = k + 1; continue;
    }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(open, j + 1); }
    j++;
  }
  throw new Error('unbalanced ' + decl);
}
const OPS_ECON = new Function('return (' + literal(IDX, 'const OPS_ECON = {') + ')')();
const OP_LABELS = new Function('return (' + literal(IDX, 'const OP_LABELS = {') + ')')();
const clone = (o) => JSON.parse(JSON.stringify(o));

/* The same derivation opView() uses for a yield id with no name on the wire —
   restated here so the harness can say what a chip MUST read, by hand. */
const humanize = (s) => s.length <= 3 ? s.toUpperCase() : s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const fmtStartup = (n) => (n | 0) === 0 ? 'FREE' : (n | 0).toLocaleString('en-US') + ' 🔥';

function econ(over) {
  return Object.assign({
    signedIn: true, corpChecked: true, isAdmin: false,
    corp: { id: 'corp-1', name: 'BLACK SUN', tag: 'BSN', role: 'owner' },
    handle: 'Charlie', amOwner: true, cinders: 0, aza: 0, mt: 0,
    corpTreasury: 5000000, corpTreasuryKnown: true, laborPool: 10, operations: [],
    roster: [], memberCount: 2, memberCap: 25, requests: [], pendingHires: [],
    vault: [], vaultRpc: 'ok', vaultUnknown: false,
    transfers: [], corps: [], resources: [], memberCities: [], memberCitiesState: 'ok',
    depositable: { cards: [], items: [], resources: [] },
    guildChat: [], legalCases: [], agencyListings: [], myOwnedHouses: [],
    realEstateListings: [], convoys: [], opArt: {}, reArt: {},
    opEcon: clone(OPS_ECON), opLabels: clone(OP_LABELS),
  }, over || {});
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function open(e) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (x) => errs.push(String(x).slice(0, 240)));
  await page.addInitScript((seed) => { window.__JB = { econ: seed, ready: true }; }, e);
  await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 60000 }).catch(() => {});
  // The Sidebar owns route state and listens for this — the same door the
  // Treasury screen's "Open full vault" uses.
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('jb:route', { detail: 'operations' })); });
  await page.waitForFunction(() => /OperaFind/.test((document.querySelector('.screen') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

/* One entry per card in the registry grid, read the way a player sees it. The
   grid is the auto-fill one; the sponsored row is the fixed 3-column one. */
const readCards = (page) => page.evaluate(() => {
  const scr = document.querySelector('.screen');
  if (!scr) return null;
  const grids = Array.from(scr.querySelectorAll('div[style*="auto-fill"]'));
  const grid = grids[grids.length - 1];
  const cards = grid ? Array.from(grid.children).filter((c) => c.classList.contains('card')) : [];
  const rowVal = (card, label) => {
    const row = Array.from(card.querySelectorAll('.row')).find((r) => r.children[0] && r.children[0].textContent.trim() === label);
    return row && row.children[1] ? row.children[1].textContent.trim() : null;
  };
  return {
    text: scr.textContent.replace(/\s+/g, ' ').trim(),
    // The sponsored grid is the element right after the "Featured operations"
    // label — found by the label, not by a style string React may reformat.
    sponsored: (() => {
      const lab = Array.from(scr.querySelectorAll('div')).find((d) => d.textContent.trim() === 'Featured operations');
      const g = lab && lab.nextElementSibling;
      return g ? Array.from(g.querySelectorAll('.disp')).map((d) => d.textContent.trim()) : [];
    })(),
    cards: cards.map((c) => ({
      name: ((c.querySelector('.disp') || {}).textContent || '').trim(),
      chips: Array.from(c.querySelectorAll('.chip')).map((x) => x.textContent.trim()),
      startup: rowVal(c, 'Startup (Treasury)'),
      wages: rowVal(c, 'Wages'),
      output: rowVal(c, 'Output'),
      button: ((c.querySelector('button.btn.primary') || {}).textContent || '').trim(),
      text: c.textContent.replace(/\s+/g, ' ').trim(),
    })),
  };
});

// ── 1 · the live payload ───────────────────────────────────────────────────
console.log('\n1. LIVE PAYLOAD — every card prints OPS_ECON / OP_LABELS, nothing typed');
{
  const { ctx, page, errs } = await open(econ());
  const s = await readCards(page);
  ok('the Operations screen mounted', !!s && s.cards.length > 0, errs[0] || (s ? s.cards.length + ' cards' : 'no screen'));
  if (s) {
    const ids = Object.keys(OPS_ECON);
    ok('one card per OPS_ECON row (' + ids.length + ')', s.cards.length === ids.length, s.cards.length + ' cards');
    const byName = {};
    s.cards.forEach((c) => { byName[c.name] = c; });
    let nameMiss = [], priceMiss = [], chipMiss = [];
    for (const id of ids) {
      const c = byName[OP_LABELS[id]];
      if (!c) { nameMiss.push(id); continue; }
      const want = fmtStartup(OPS_ECON[id].startup);
      if (c.startup !== want) priceMiss.push(id + ': ' + c.startup + ' ≠ ' + want);
      const y = Object.keys(OPS_ECON[id].yields || {}).map(humanize);
      if (JSON.stringify(c.chips) !== JSON.stringify(y)) chipMiss.push(id + ': ' + JSON.stringify(c.chips) + ' ≠ ' + JSON.stringify(y));
    }
    ok('🔴 every card is titled with OP_LABELS[id]', nameMiss.length === 0, nameMiss.length ? 'unnamed: ' + nameMiss.join(', ') : ids.length + ' names');
    ok('🔴 every card\'s startup line is OPS_ECON[id].startup (0 → FREE)', priceMiss.length === 0, priceMiss[0]);
    ok('🔴 every card\'s chips are exactly OPS_ECON[id].yields, labelled', chipMiss.length === 0, chipMiss[0]);

    const con = byName[OP_LABELS.construction];
    console.log('   Construction Co. card: ' + (con ? JSON.stringify({ startup: con.startup, chips: con.chips, button: con.button }) : 'MISSING'));
    ok('🔴 the Construction Co. card shows no 350,000', !!con && !/350,000/.test(con.text));
    ok('🔴 the Construction Co. startup line reads FREE', !!con && con.startup === 'FREE', con && con.startup);
    ok('…and its Fund button says FREE, not "0 🔥"', !!con && /FREE/.test(con.button) && !/\b0 🔥/.test(con.button), con && con.button);
    ok('the Construction Co. no longer claims Concrete / Steel', !!con && !/Concrete|Steel/.test(con.text));

    const tc = byName[OP_LABELS.trashcrusher];
    const tcWant = Object.keys(OPS_ECON.trashcrusher.yields).map(humanize);
    console.log('   Trash Crusher chips: ' + JSON.stringify(tc && tc.chips) + '   OPS_ECON yields: ' + JSON.stringify(Object.keys(OPS_ECON.trashcrusher.yields)));
    ok('🔴 the Trash Crusher\'s produces equals its OPS_ECON yields', !!tc && JSON.stringify(tc.chips) === JSON.stringify(tcWant));
    ok('an op with `yields: {}` (bank) has no product chips', !!byName[OP_LABELS.bank] && byName[OP_LABELS.bank].chips.length === 0);
    ok('the sponsored tiles are titled from OP_LABELS too', s.sponsored.length === 3 && s.sponsored.every((n) => Object.values(OP_LABELS).includes(n)), JSON.stringify(s.sponsored));
    ok('none of the old typed price strings survive on screen', !/6k Metal|off-ledger|or 2,000 MT staked/.test(s.text));
    /* 350,000 IS a live price — the Gas Station Chain's — so "nowhere on the
       screen" would be the wrong claim. The right one: it appears exactly as
       many times as OPS_ECON prices an operation at 350,000, and on those
       cards only. That is what "derived, not typed" means in numbers. */
    const at350 = Object.keys(OPS_ECON).filter((id) => (OPS_ECON[id].startup | 0) === 350000);
    const on350 = s.cards.filter((c) => /350,000/.test(c.text)).map((c) => c.name);
    ok('350,000 appears only on the cards OPS_ECON prices at 350,000 (' + at350.join(', ') + ')',
       JSON.stringify(on350) === JSON.stringify(at350.map((id) => OP_LABELS[id])), JSON.stringify(on350));
  }
  ok('no pageerrors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ── 2 · a retuned payload ──────────────────────────────────────────────────
console.log('\n2. RETUNED PAYLOAD — change the numbers and the card follows');
{
  const e = econ();
  e.opEcon.mining.startup = 123456;
  e.opLabels.mining = 'Mining Co. (retuned)';
  e.opEcon.trashcrusher.yields = { glass: 0.5, fooBarBaz: 1 };
  e.resources = [{ id: 'glass', name: 'Bottle Glass', icon: '🍾', qty: 3 }];
  const { ctx, page, errs } = await open(e);
  const s = await readCards(page);
  const m = s && s.cards.find((c) => c.name === 'Mining Co. (retuned)');
  console.log('   mining card: ' + JSON.stringify(m && { startup: m.startup, button: m.button }));
  ok('🔴 the card title is the payload\'s label', !!m);
  ok('🔴 the startup line is the payload\'s price (123,456 🔥)', !!m && m.startup === '123,456 🔥', m && m.startup);
  ok('the Fund button carries the same figure', !!m && /123,456/.test(m.button), m && m.button);
  ok('the old 400,000 appears nowhere', !!s && !/400,000/.test(s.text));
  ok('the old label "Mining Company" appears nowhere', !!s && !/Mining Company/.test(s.text));
  const tc = s && s.cards.find((c) => c.name === OP_LABELS.trashcrusher);
  console.log('   trashcrusher chips: ' + JSON.stringify(tc && tc.chips));
  ok('🔴 chips follow the payload\'s yields, in its order', !!tc && JSON.stringify(tc.chips) === JSON.stringify(['Bottle Glass', 'Foo Bar Baz']), tc && JSON.stringify(tc.chips));
  ok('a resource name the payload carries wins over the derived one', !!tc && tc.chips[0] === 'Bottle Glass');
  ok('an unknown camelCase yield id is still readable, not raw', !!tc && tc.chips[1] === 'Foo Bar Baz');
  ok('the old typed chips (Recycled Metal / Plastic) are gone', !!tc && !/Recycled Metal|Plastic/.test(tc.chips.join(' ')));
  ok('no pageerrors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ── 3 · before the payload lands ───────────────────────────────────────────
console.log('\n3. BEFORE THE PAYLOAD — a neutral placeholder, never a typed number');
{
  const e = econ(); delete e.opEcon; delete e.opLabels;
  const { ctx, page, errs } = await open(e);
  const s = await readCards(page);
  ok('the screen mounted with no opEcon / opLabels at all', !!s && s.cards.length === Object.keys(OPS_ECON).length, s && s.cards.length);
  if (s) {
    const con = s.cards.find((c) => c.name === 'construction');
    console.log('   construction card: ' + JSON.stringify(con && { startup: con.startup, chips: con.chips, button: con.button }));
    ok('🔴 the title is the raw id (the same degraded answer OP_LABELS\' other consumers give)', !!con);
    ok('🔴 the startup line is a dash, not a price', !!con && con.startup === '—', con && con.startup);
    ok('no product chips are invented', s.cards.every((c) => c.chips.length === 0));
    ok('🔴 none of the old typed prices appear (350,000 / 400,000 / 270,000 / 10,000,000)', !/350,000|400,000|270,000|10,000,000/.test(s.text));
    ok('none of the old typed chips appear (Concrete / Data Cores / Clone access)', !/Concrete|Data Cores|Clone access/.test(s.text));
    ok('the Fund button does not guess a price', !!con && /\?/.test(con.button) && !/\d{3},\d{3}/.test(con.button), con && con.button);
  }
  ok('no pageerrors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ── 4 · standalone (no bridge at all) ──────────────────────────────────────
console.log('\n4. STANDALONE — __JB.econ null, the screen still stands');
{
  const { ctx, page, errs } = await open(null);
  const s = await readCards(page);
  ok('the screen mounted', !!s && s.cards.length > 0, s && s.cards.length);
  ok('no old typed price on screen', !!s && !/350,000|400,000/.test(s.text));
  ok('no pageerrors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ── 5 · search runs on the derived chips ───────────────────────────────────
console.log('\n5. SEARCH — "glass" finds the Trash Crusher because OPS_ECON says so');
{
  const { ctx, page, errs } = await open(econ());
  await page.fill('input.input[placeholder*="Search operations"]', 'glass');
  await page.waitForTimeout(250);
  const s = await readCards(page);
  ok('exactly the ops whose OPS_ECON yields include glass are listed',
     !!s && s.cards.length === Object.keys(OPS_ECON).filter((id) => Object.keys(OPS_ECON[id].yields || {}).some((k) => /glass/i.test(humanize(k)))).length
        && s.cards.some((c) => c.name === OP_LABELS.trashcrusher),
     s && JSON.stringify(s.cards.map((c) => c.name)));
  await page.fill('input.input[placeholder*="Search operations"]', OP_LABELS.genelab);
  await page.waitForTimeout(250);
  const s2 = await readCards(page);
  ok('searching by the payload\'s label finds the card', !!s2 && s2.cards.length === 1 && s2.cards[0].name === OP_LABELS.genelab, s2 && JSON.stringify(s2.cards.map((c) => c.name)));
  ok('no pageerrors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ── 6 · the source ─────────────────────────────────────────────────────────
console.log('\n6. SOURCE — screens.jsx carries no second copy of the economy');
{
  const i = SCREENS.indexOf('const OPERATIONS = [');
  const j = SCREENS.indexOf('];', i);
  const arr = SCREENS.slice(i, j);
  ok('no `startup: \'` anywhere in screens.jsx', !/startup: '/.test(SCREENS));
  ok('no `produces: [` anywhere in screens.jsx', !/produces: \[/.test(SCREENS));
  ok('no `name:` field on any OPERATIONS row', !/\bname:/.test(arr));
  ok('no `maint:` field on any OPERATIONS row', !/\bmaint:/.test(arr));
  const leaked = Object.values(OP_LABELS).filter((n) => arr.includes("'" + n + "'"));
  ok('no OP_LABELS name as a string literal inside the OPERATIONS array', leaked.length === 0, leaked.join(', '));
  ok('opView() reads econ.opEcon and econ.opLabels', /function opView/.test(SCREENS) && /E\.opEcon/.test(SCREENS) && /E\.opLabels/.test(SCREENS));
}

await browser.close();
server.close();
console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
