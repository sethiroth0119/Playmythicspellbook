/* ══════════════════════════════════════════════════════════════════════════
   🏙 DRIVE-MEMBERCITIES — the Treasury panel, in a real browser.

   screens.jsx has no runtime gate. jsxcheck proves it PARSES; it cannot tell a
   rendered table from a component that threw on mount and left the screen
   blank. And the claims this panel makes are all claims about pixels:
     1  ONE ROW PER MEMBER — the row count equals the roster count, and equals
        the "Members" stat printed at the top of the same screen.
     2  VERBATIM — every city name, population, sells and buys figure on screen
        is the seeded city_profiles row and nothing else.
     3  THE SUMMARY IS DERIVABLE BY HAND from the rows above it — a resource is
        listed as a gap only if some member buys it and NO member sells it.
     4  NO NaN / undefined ANYWHERE, for a member whose row has null columns.
     5  IT DEGRADES — with memberCitiesState 'unavailable' the panel is one
        honest line and the rest of the Treasury screen still renders.

   ⚠ DO NOT fulfil the React/ReactDOM/Babel <script> tags from node_modules.
     All three carry an `integrity` hash; substituted bytes are rejected by SRI
     SILENTLY — the page renders nothing with a clean console, which reads
     exactly like the app being broken. They come from the network.

   Run:  node .gauntlet/drive-membercities.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const PORT = 8800 + (process.pid % 90);

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

/* The seed is the SHAPE index.html's _corpMemberCitiesFetch produces — proved
   against the shipped function by drive-membercities-fetch.mjs. Four members,
   one of them with two cities, one with a null population and a null unit
   figure, one with no city at all. */
const ROSTER = [
  { userId: 'u-alpha',   name: 'Alpha',   role: 'founder' },
  { userId: 'u-bravo',   name: 'Bravo',   role: 'member' },
  { userId: 'u-charlie', name: 'Charlie', role: 'member' },
  { userId: 'u-delta',   name: 'Delta',   role: 'member' },
];
const MEMBER_CITIES = [
  { userId: 'u-alpha', name: 'Alpha', role: 'founder', cities: [
    { nodeId: 'local-city', name: 'Ashfall', specs: ['energy'], pop: 340,
      sells: [{ id: 'lumber', units: 4500.13 }, { id: 'zincOre', units: 170 }],
      buys:  [{ id: 'crudeOil', units: 5760 }, { id: 'silica', units: 10 }] },
    { nodeId: 'node-77', name: '', specs: [], pop: null,
      sells: [{ id: 'crudeOil', units: 12 }], buys: [] },
  ] },
  { userId: 'u-bravo', name: 'Bravo', role: 'member', cities: [
    { nodeId: 'local-city', name: 'Sausage', specs: [], pop: 224,
      sells: [{ id: 'ironOre', units: 595.57 }],
      buys:  [{ id: 'limestone', units: 135 }, { id: 'silica', units: 10 }] },
  ] },
  { userId: 'u-charlie', name: 'Charlie', role: 'member', cities: [
    { nodeId: 'local-city', name: 'Nowhere', specs: [], pop: null,
      sells: [{ id: 'gasoline', units: null }], buys: [] },
  ] },
  { userId: 'u-delta', name: 'Delta', role: 'member', cities: [] },
];

/* By hand, from the four rows above:
     produced: lumber, zincOre, crudeOil, ironOre, gasoline   → 5 covered
     bought:   crudeOil (Alpha), silica (Alpha, Bravo), limestone (Bravo)
     crudeOil IS produced (Alpha's second city) ⇒ not a gap.
     silica and limestone are produced by nobody ⇒ 2 gaps.               */
const EXPECT_COVERED = ['crudeOil', 'gasoline', 'ironOre', 'lumber', 'zincOre'];
const EXPECT_GAPS    = ['limestone', 'silica'];

function econ(over) {
  return Object.assign({
    signedIn: true, corpChecked: true, isAdmin: false,
    corp: { id: 'corp-1', name: 'BLACK SUN', tag: 'BSN', role: 'founder' },
    amOwner: true, cinders: 1000, aza: 0, mt: 0,
    roster: ROSTER, memberCount: ROSTER.length, memberCap: 25,
    memberCities: MEMBER_CITIES, memberCitiesState: 'ok',
    requests: [], pendingHires: [], vault: [], transfers: [], corps: [],
    resources: [], operations: [], realEstateListings: [], convoys: [],
    depositable: { cards: [], items: [], resources: [] },
    guildChat: [], legalCases: [], agencyListings: [], myOwnedHouses: [],
    opArt: {}, reArt: {}, opEcon: {}, corpTreasury: 0, laborPool: 1,
  }, over || {});
}

async function open(e) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (x) => errs.push(String(x).slice(0, 240)));
  await page.addInitScript((seed) => { window.__JB = { econ: seed, ready: true }; }, e);
  await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'load', timeout: 90000 });
  // Babel transforms five JSX files in-page; the mount is not synchronous.
  await page.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 60000 }).catch(() => {});
  const nav = page.locator('text=Corp Treasury').first();
  if (await nav.count()) { await nav.click({ timeout: 15000 }).catch(() => {}); }
  await page.waitForTimeout(900);
  return { ctx, page, errs };
}

/* Read the panel out of the DOM by its heading, so this measures what a player
   sees and not what a component returned. */
const readPanel = (page) => page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.card'));
  const card = cards.find(c => /Member cities/i.test((c.querySelector('h3') || {}).textContent || ''));
  if (!card) return null;
  /* ONE <tr> PER CITY, with the Member cell carrying rowSpan — so a
     continuation row has FOUR <td>s, not five, and reading cells by index
     off the raw row silently compares a population against a city name.
     Normalise back to five columns by carrying the spanning member cell
     down, which is what a player's eye does when it reads the table. */
  const tbl = card.querySelector('table.tbl');
  const rows = [];
  const members = [];
  if (tbl) {
    let carry = null, left = 0;
    for (const tr of Array.from(tbl.querySelectorAll('tbody tr'))) {
      const tds = Array.from(tr.querySelectorAll('td'));
      let cells;
      if (left > 0 && tds.length === 4) { cells = [carry, ...tds]; }
      else {
        carry = tds[0]; left = (tds[0] && tds[0].rowSpan) || 1;
        cells = tds;
        members.push(tds[0] ? tds[0].textContent.replace(/\s+/g, ' ').trim() : '');
      }
      left--;
      rows.push(cells.map(td => (td ? td.textContent.replace(/\s+/g, ' ').trim() : '')));
    }
  }
  /* The FIRST .mono of a chip is the resource id; a gap chip carries a second
     one listing who needs it, so textContent would read "silicaAlpha, Bravo". */
  const chipIds = (sel) => Array.from(card.querySelectorAll(sel))
    .map(s => ((s.querySelector('.mono') || {}).textContent || '').trim()).filter(Boolean);
  return {
    head: (card.querySelector('.more') || {}).textContent || '',
    rows,
    members,
    text: card.textContent.replace(/\s+/g, ' ').trim(),
    gapChips: chipIds('.chip.rust'),
  };
});

/* ── 1. THE PANEL RENDERS THE REAL ROSTER ───────────────────────────── */
console.log('\n1. four members, four rows');
{
  const { ctx, page, errs } = await open(econ());
  const p = await readPanel(page);
  ok('the panel mounted at all', !!p, errs.length ? 'pageerrors: ' + errs[0] : '');
  if (p) {
    console.log('   head: ' + JSON.stringify(p.head.trim()));
    p.rows.forEach((r, i) => console.log('   row ' + i + ': ' + JSON.stringify(r)));
    /* The ROW CONTRACT changed shape, not meaning. The table now emits one
       <tr> per CITY so that a city's population, exports and needs share a
       line (they used to stack independently inside four separate <td>s and
       drift apart — 210px on a real roster, i.e. numbers shown against the
       wrong city). What must NOT change is that every corp_members row is
       represented exactly once, which is now counted on the spanning Member
       cells rather than on <tr>s. */
    ok('🔴 exactly one MEMBER cell per corp_members row (4)', p.members.length === 4,
       p.members.length + ' member cells: ' + JSON.stringify(p.members));
    ok('🔴 one <tr> per city, plus one for the member with none (5)', p.rows.length === 5, p.rows.length + ' rows');
    ok('🔴 every row carries all five columns after the rowSpan carry-down',
       p.rows.every(r => r.length === 5), JSON.stringify(p.rows.map(r => r.length)));
    ok('…and the head says so', /4 members/.test(p.head), p.head.trim());
    ok('…and it agrees with the Members stat on the same screen',
       await page.evaluate(() => /(\b4\b)\s*\/\s*25/.test(document.body.textContent)));
    ok('every member name is on the panel',
       ['Alpha', 'Bravo', 'Charlie', 'Delta'].every(n => p.text.includes(n)));

    // 2. VERBATIM
    ok('Ashfall / 340 is verbatim', /Ashfall/.test(p.rows[0][1]) && p.rows[0][2].includes('340'), JSON.stringify(p.rows[0].slice(1, 3)));
    ok('4,500.13 lumber is printed as its own figure', /lumber ?4,500.13/.test(p.rows[0][3].replace(/\s+/g, ' ')), p.rows[0][3]);
    ok('Sausage / 224 / ironOre 595.57 is verbatim',
       /Sausage/.test(p.rows[2][1]) && p.rows[2][2].includes('224') && /ironOre ?595.57/.test(p.rows[2][3]),
       JSON.stringify(p.rows[2].slice(1, 4)));
    ok('the unnamed second city says "unnamed city", it is not given one', /unnamed city/.test(p.rows[1][1]));
    ok('🔴 a null population prints an em dash, not 0', p.rows[3][2] === '—', JSON.stringify(p.rows[3][2]));
    ok('🔴 a null unit figure prints an em dash beside its real id', /gasoline ?—/.test(p.rows[3][3]), p.rows[3][3]);
    ok('🔴 the member with no city says so, and shows no zeros', /no city founded/.test(p.rows[4][1]) && p.rows[4][2] === '—',
       JSON.stringify(p.rows[4]));

    /* 🔴 THE DEFECT THIS LAYOUT EXISTS TO REMOVE. Alpha holds two cities;
       Ashfall's population and Ashfall's exports must be on Ashfall's line
       and node-77's on node-77's — the old stacked layout put node-77's
       export list beside Ashfall's population. Asserted as a CONTROL too:
       neither row may carry the other's distinguishing value. */
    ok('🔴 city 1 of 2: name, population and exports are on ONE line',
       /Ashfall/.test(p.rows[0][1]) && p.rows[0][2].includes('340') &&
       /lumber/.test(p.rows[0][3]) && !/crudeOil ?12/.test(p.rows[0][3]),
       JSON.stringify(p.rows[0].slice(1, 4)));
    ok('🔴 city 2 of 2: its own null population and its own single export',
       /node-77/.test(p.rows[1][1]) && p.rows[1][2] === '—' &&
       /crudeOil ?12/.test(p.rows[1][3]) && !/lumber/.test(p.rows[1][3]),
       JSON.stringify(p.rows[1].slice(1, 4)));
    ok('🔴 …and both belong to Alpha, once', /Alpha/.test(p.rows[0][0]) && /Alpha/.test(p.rows[1][0]) &&
       p.members.filter(m => /Alpha/.test(m)).length === 1);
    ok('a specialization is shown, and labelled as one', /SPECIALIZED: energy/.test(p.rows[0][3]), p.rows[0][3]);

    // 4. NO NaN / undefined
    ok('🔴 the panel contains no NaN and no undefined', !/NaN|undefined/.test(p.text),
       (p.text.match(/NaN|undefined/g) || []).join(','));

    // 3. THE SUMMARY IS HAND-DERIVABLE
    // The per-row cells use .chip.flat too, so the COVERED set is read out of
    // the summary block specifically, not from every flat chip on the card.
    const summaryCovered = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card'))
        .find(c => /Member cities/i.test((c.querySelector('h3') || {}).textContent || ''));
      const blocks = Array.from(card.querySelectorAll('div'))
        .filter(d => /^Covered by this corporation/.test(d.textContent.trim()));
      const host = blocks.length ? blocks[blocks.length - 1].parentElement : null;
      return host ? Array.from(host.querySelectorAll('.chip')).map(c => c.querySelector('.mono').textContent.trim()) : [];
    });
    const summaryGaps = p.gapChips;
    console.log('   covered (summary): ' + JSON.stringify(summaryCovered));
    console.log('   gaps    (summary): ' + JSON.stringify(summaryGaps));
    ok('COVERED is exactly the union of every sells id above it',
       JSON.stringify(summaryCovered.slice().sort()) === JSON.stringify(EXPECT_COVERED),
       JSON.stringify(summaryCovered));
    ok('🔴 GAPS is exactly the bought-but-unproduced set (crudeOil is bought AND produced ⇒ not a gap)',
       JSON.stringify(summaryGaps.slice().sort()) === JSON.stringify(EXPECT_GAPS),
       JSON.stringify(summaryGaps));
    ok('a gap names who needs it', /silica[^A-Za-z]*(Alpha|Bravo)/.test(p.text));

    /* 🔴 textContent is NOT what a player reads: styles.css uppercases every
       .chip, so 'crudeOil' can be PAINTED as 'CRUDEOIL' while every assertion
       above still passes. innerText reflects text-transform, so this is the one
       check that looks at the rendered glyphs. */
    const painted = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card'))
        .find(c => /Member cities/i.test((c.querySelector('h3') || {}).textContent || ''));
      return Array.from(card.querySelectorAll('.chip')).map(c => c.querySelector('.mono').innerText.trim());
    });
    console.log('   painted ids: ' + JSON.stringify(painted.slice(0, 8)));
    ok('🔴 ids are PAINTED in their true case — crudeOil, not CRUDEOIL',
       painted.includes('crudeOil') && painted.includes('ironOre') && !painted.includes('CRUDEOIL'),
       JSON.stringify(painted));
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ── 5. DEGRADED — sql/038 absent ───────────────────────────────────── */
console.log('\n2. CONTROL — city_profiles could not be read');
{
  const { ctx, page, errs } = await open(econ({ memberCitiesState: 'unavailable',
    memberCities: ROSTER.map(m => ({ ...m, cities: [] })) }));
  const p = await readPanel(page);
  ok('the panel is still there', !!p);
  if (p) {
    console.log('   text: ' + p.text.slice(0, 180));
    ok('it says the data is not available', /City data is not available/.test(p.text));
    ok('it draws NO table of members reading as "nobody has a city"', p.rows.length === 0, p.rows.length + ' rows');
    ok('and it invents no coverage summary', !/Covered by this corporation/.test(p.text));
  }
  ok('the rest of the Treasury screen still rendered',
     await page.evaluate(() => /Ledger — every movement/.test(document.body.textContent)
                            && /Members & roles/.test(document.body.textContent)));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ── 6. NO BRIDGE AT ALL (standalone) ───────────────────────────────────
   The rebuilt CorpScreen gates on the bridge BEFORE it renders any panel, so
   the honest line here comes from its own empty state and this panel is never
   reached. That is the right answer, and it is asserted rather than assumed —
   what must not happen is a Treasury full of zeros. (MemberCitiesPanel keeps
   its own !econ branch anyway: it is mounted by a screen it does not own.) */
console.log('\n3. CONTROL — opened standalone, no game bridge');
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (x) => errs.push(String(x).slice(0, 240)));
  await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 60000 }).catch(() => {});
  const nav = page.locator('text=Corp Treasury').first();
  if (await nav.count()) { await nav.click({ timeout: 15000 }).catch(() => {}); }
  await page.waitForTimeout(900);
  const body = await page.evaluate(() => document.querySelector('.main').textContent.replace(/\s+/g, ' ').trim());
  console.log('   screen: ' + body.slice(0, 150));
  ok('the screen says there is no session, rather than inventing a corporation',
     /no session attached/.test(body));
  ok('no member-cities table is drawn with nothing behind it', !(await readPanel(page)));
  ok('no NaN / undefined anywhere on the screen', !/NaN|undefined/.test(body));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

console.log(fails ? '\n❌ ' + fails + ' CHECK(S) FAILED' : '\n✅ ALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
