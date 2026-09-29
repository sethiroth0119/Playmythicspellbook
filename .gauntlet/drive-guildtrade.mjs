/* 🤝 GUILD TRADE DRIVER — the rebuilt Trade Window, driven in a real browser.
   The parse gates only prove screens.jsx parses; this renders it and works it.

   public/ is served over loopback and public/corp/index.html is opened for
   real (React + Babel still come from unpkg — the CDN <script> tags carry SRI
   hashes and swapping them for node_modules copies is rejected SILENTLY,
   giving a blank page with a clean console, so they are left alone).

   The bridge is stubbed the way the game drives it: set window.__JB.econ and
   dispatch 'jbdata'. That is the exact seam _jbridge.js writes through, so
   nothing here is a private back door into the screen. window.JB_action is
   replaced with a recorder — that is the only outbound seam the screen has, so
   what it records IS what index.html would receive.

   node .gauntlet/drive-guildtrade.mjs                                       */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.jsx': 'text/babel', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const PORT = 8850 + (process.pid % 60);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

let bad = 0;
const chk = (name, ok, extra) => {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ↳ ' + extra : ''));
  if (!ok) bad++;
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.sidebar', { timeout: 30000 });
chk('the corp app mounted (CDN React/Babel reachable)', await page.locator('.sidebar').count() === 1);

await page.evaluate(() => { window.__acts = []; window.JB_action = (p) => window.__acts.push(p); });

// ── fixtures ───────────────────────────────────────────────────────────────
const ROSTER = [
  { userId: 'me',   name: 'Sethiroth', role: 'founder' },
  { userId: 'u-2',  name: 'Marrow',    role: 'quartermaster' },
  { userId: 'u-3',  name: 'Vane',      role: 'member' },
];
const DEP = {
  resources: [{ id: 'metal', name: 'Scrap Metal', icon: '⛓', qty: 3 },
              { id: 'fuel',  name: 'Fuel',        icon: '⛽', qty: 120 }],
  cards:     [{ id: 'c_ash', name: 'Ashwalker', icon: '🃏', have: 5, free: 2, locked: 3 }],
  items:     [{ id: 'i_kit', name: 'Repair Kit', icon: '🧰', qty: 7 }],
};
const CATALOG = [{ id: 'metal', name: 'Scrap Metal', icon: '⛓' },
                 { id: 'fuel',  name: 'Fuel',        icon: '⛽' },
                 { id: 'wire',  name: 'Copper Wire', icon: '🧵' }];
const base = (over) => Object.assign({
  cinders: 5000, aza: 0, mt: 0, wallet: null, handle: 'Sethiroth', signedIn: true,
  myUid: 'me', corpChecked: true,
  corp: { id: 'corp-1', name: 'Ashford & Keel', tag: 'AK', role: 'founder' },
  roster: ROSTER, requests: [], pendingHires: [], vault: [], transfers: [], corps: [],
  resources: [], operations: [], depositable: DEP, resourceCatalog: CATALOG,
  cardArt: { c_ash: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' },
  tradeOffers: [], tradeReady: true, tradeErr: '',
  guildChat: [], legalCases: [], agencyListings: [], realEstateListings: [],
}, over || {});

const push = (econ) => page.evaluate((e) => {
  window.__JB.econ = e; window.__JB.ready = true;
  window.dispatchEvent(new Event('jbdata'));
}, econ);

const goTrade = async () => {
  await page.locator('.sidebar .nav button', { hasText: 'Trade Window' }).first().click();
  await page.waitForTimeout(140);
};
const txt = () => page.locator('.main').innerText();
// Locate by CONTENT, not by index: the sql/048 banner is itself a .card and
// shifts every positional selector the moment the migration is missing — which
// is exactly the state most of these checks run in.
const giveCard = () => page.locator('.screen .card').filter({ hasText: 'You give' }).first();
const askCard  = () => page.locator('.screen .card').filter({ hasText: 'You ask for' }).first();

// ── 1. degradation: no bridge at all / signed out ──────────────────────────
await push(base({ signedIn: false }));
await goTrade();
let t = await txt();
chk('signed out → an honest sign-in state, not a composer', /Sign in inside the game to trade/i.test(t), t.slice(0, 90));

// ── 2. no corporation ──────────────────────────────────────────────────────
await push(base({ corp: null }));
await page.waitForTimeout(140);
t = await txt();
chk('no corporation → says so and offers the door to Guild & Hiring',
  /not in one yet/i.test(t) && /Guild & Hiring/i.test(t));

// ── 3. sql/048 NOT applied — the default state a critic sees ───────────────
await push(base({ tradeReady: false, tradeErr: 'missing' }));
await page.waitForTimeout(160);
t = await txt();
chk('names the pending migration by file', /sql\/048_corp_trade_offers\.sql/.test(t));
chk('the real roster is on screen', /Marrow/.test(t) && /Vane/.test(t));
// The picker is tabbed (same shape as the vault deposit list), so each kind is
// checked on its own tab rather than expecting all three at once.
chk('the real stash — resources', /Scrap Metal/.test(t) && /Fuel/.test(t));
for (const [tabName, want] of [['Cards', 'Ashwalker'], ['Items / Equipment', 'Repair Kit']]) {
  await giveCard().locator('button', { hasText: tabName }).first().click();
  await page.waitForTimeout(120);
  chk('the real stash — ' + tabName, (await txt()).includes(want));
}
await giveCard().locator('button', { hasText: 'Resources' }).first().click();
await page.waitForTimeout(120);
t = await txt();
const sendLabel = await page.locator('.screen .btn.primary').last().innerText();
const sendDisabled = await page.locator('.screen .btn.primary').last().isDisabled();
chk('Send is disabled and says what is missing', sendDisabled && /sql\/048/i.test(sendLabel), sendLabel);

// the fabricated content must be gone from the rendered page, not just the source
const FAB = ['WRAITH-9', 'TRD-2204', '34,500', '58,000', '11,500', 'Drag asset here'];
const found = FAB.filter(s => t.includes(s));
chk('no fabricated counterparty / session id / balance is rendered', found.length === 0, found.join(', '));

/* The kinds that were OMITTED have to be omitted OUT LOUD. A player who owns a
   deed or a car will look for it in this picker, and silence reads as a bug.
   The reason living only in a source comment does not reach them. */
chk('the give side says on screen why property and vehicles are absent',
  /Property and vehicles are not tradeable here/i.test(t) && /sql\/048/i.test(t));
/* ⚠ NOT /Car/ — that matches the legitimate "Cards" tab and turned this check
   red against a correct screen. Match the vehicle/deed words only. */
chk('…and there is no fourth tab pretending to offer them',
  !(await giveCard().locator('button', { hasText: /Propert|Vehicle|Real Estate|Deed|Garage/i }).count()));

// ── 4. the balance with two empty sides is 0 ───────────────────────────────
await push(base());
await page.waitForTimeout(160);
const balOf = async () => (await page.locator('.screen .disp').nth(1).innerText()).trim();
chk('empty ⇄ empty reads exactly 0 (not 11,500, not blank)', (await balOf()) === '0', await balOf());

// ── 5. totals are arithmetic over the two lists ────────────────────────────
const cinIn = (side) => page.locator('.screen .card').nth(side).locator('input[type=number]').first();
// left card index: 0 = composer bar card, 1 = "You give", (balance col), 2 = "You ask for"
await page.locator('.screen input[type=number]').nth(0).fill('1200');   // give cinder
await page.locator('.screen input[type=number]').nth(0).dispatchEvent('change');
await page.waitForTimeout(120);
chk('give 1,200 with an empty other side ⇒ balance −1,200', (await balOf()) === '-1,200', await balOf());
await page.locator('.screen input[type=number]').nth(1).fill('2000');   // ask cinder
await page.locator('.screen input[type=number]').nth(1).dispatchEvent('change');
await page.waitForTimeout(120);
chk('ask 2,000 against give 1,200 ⇒ balance +800', (await balOf()) === '+800', await balOf());

// Cinder cannot exceed what the player holds (5,000).
await page.locator('.screen input[type=number]').nth(0).fill('999999');
await page.locator('.screen input[type=number]').nth(0).dispatchEvent('change');
await page.waitForTimeout(120);
const capped = await page.locator('.screen input[type=number]').nth(0).inputValue();
chk('the Cinder offer is clamped to the balance actually held', capped === '5000', capped);

// ── 6. goods: nothing can be added that the player does not hold ───────────
await push(base());                                   // reset the composer state
await page.waitForTimeout(160);
const addBtns = () => giveCard().locator('button', { hasText: /^(\+1|All)$/ });
// Scrap Metal is the first row of the resource tab (qty 3). "All" adds 3.
await giveCard().locator('.row', { hasText: 'Scrap Metal' }).locator('button', { hasText: 'All' }).click();
await page.waitForTimeout(140);
t = await txt();
chk('adding "All" of a 3-unit stack shows ×3', /×3/.test(t));
const plusDisabled = await giveCard().locator('.row', { hasText: 'Scrap Metal' }).locator('button', { hasText: '+1' }).isDisabled();
chk('once the whole stack is in the offer, +1 is refused', plusDisabled);
chk('the side total counts the units it is showing', /1\/20 lines · 3 units/.test(t.replace(/\s+/g, ' ')),
  (t.replace(/\s+/g, ' ').match(/Your side[^·]*·[^·]*·[^A-Z]*/) || [''])[0]);

// cards: 5 held, 3 deck-locked ⇒ only 2 free
await giveCard().locator('button', { hasText: 'Cards' }).click();
await page.waitForTimeout(120);
await giveCard().locator('.row', { hasText: 'Ashwalker' }).locator('button', { hasText: 'All' }).click();
await page.waitForTimeout(140);
t = await txt();
chk('deck-locked copies are not offerable — 5 held, 3 locked ⇒ ×2', /×2/.test(t));
const artCount = await giveCard().locator('img').count();
chk('a card line renders its art from econ.cardArt', artCount >= 1, 'imgs=' + artCount);

// ── 7. sending emits one real action with the real payload ────────────────
await page.locator('.screen select').first().selectOption('u-2');
await page.waitForTimeout(120);
await page.locator('.screen .btn.primary', { hasText: 'Send offer' }).click();
await page.waitForTimeout(120);
await page.locator('.screen .btn.primary', { hasText: /^Confirm/ }).click();
await page.waitForTimeout(160);
const acts = await page.evaluate(() => window.__acts);
const prop = acts.filter(a => a && a.kind === 'tradePropose').pop();
chk('Confirm emits tradePropose (the old button had no onClick at all)', !!prop);
chk('…to the real member id picked from the roster', !!prop && prop.toId === 'u-2' && prop.toName === 'Marrow', JSON.stringify(prop && { toId: prop.toId, toName: prop.toName }));
chk('…carrying exactly the two lines shown, with their real ids and quantities',
  !!prop && prop.give.length === 2 &&
  prop.give.some(l => l.kind === 'resource' && l.id === 'metal' && l.qty === 3) &&
  prop.give.some(l => l.kind === 'card' && l.id === 'c_ash' && l.qty === 2),
  JSON.stringify(prop && prop.give));

// ── 8. an incoming offer the player cannot cover cannot be accepted ────────
await push(base({ cinders: 100, tradeOffers: [{
  id: 'off-1', corpId: 'corp-1', fromId: 'u-2', from: 'Marrow', toId: 'me', to: 'Sethiroth',
  give: [{ kind: 'resource', id: 'fuel', name: 'Fuel', icon: '⛽', qty: 40 }],
  want: [{ kind: 'resource', id: 'metal', name: 'Scrap Metal', icon: '⛓', qty: 999 }],
  giveCinder: 0, wantCinder: 0, note: 'need metal', status: 'open',
  fromClaimed: false, toClaimed: false, at: '2026-08-21T10:00:00.000Z', settledAt: null,
  mine: false, incoming: true, claimable: [],
}] }));
await page.waitForTimeout(180);
t = await txt();
chk('an incoming offer renders from the real row', /Offer from/.test(t) && /Marrow/.test(t));
chk('…and names the exact shortfall instead of failing at send time', /You cannot cover this/.test(t) && /Scrap Metal ×999/.test(t));
const accDis = await page.locator('.screen button', { hasText: /Cannot cover it|Accept trade/ }).first().isDisabled();
chk('…Accept is disabled', accDis);

// ── 9. an unclaimed settled trade offers a Collect button ─────────────────
await push(base({ tradeOffers: [{
  id: 'off-2', corpId: 'corp-1', fromId: 'u-2', from: 'Marrow', toId: 'me', to: 'Sethiroth',
  give: [{ kind: 'resource', id: 'fuel', name: 'Fuel', icon: '⛽', qty: 40 }],
  want: [], giveCinder: 0, wantCinder: 0, note: '', status: 'accepted',
  fromClaimed: false, toClaimed: false, at: '2026-08-21T10:00:00.000Z', settledAt: '2026-08-21T10:05:00.000Z',
  mine: false, incoming: true,
  claimable: [{ kind: 'resource', id: 'fuel', name: 'Fuel', icon: '⛽', qty: 40 }],
}] }));
await page.waitForTimeout(180);
t = await txt();
chk('goods still owed show a Collect step', /Waiting for you to collect/.test(t));
await page.locator('.screen button', { hasText: 'Collect' }).first().click();
await page.waitForTimeout(140);
const acts2 = await page.evaluate(() => window.__acts);
const clm = acts2.filter(a => a && a.kind === 'tradeClaim').pop();
chk('…Collect emits tradeClaim for that row', !!clm && clm.offerId === 'off-2', JSON.stringify(clm));

/* ── 10. THE PER-SIDE LINE CAP IS ENFORCED WHERE THE PLAYER CAN SEE IT ─────
   sql/048's _ct_norm raises on a 21st line. Before this round the composer
   let a 25-line side be built and _jbTradeClean silently .slice(0,20)'d it, so
   the player was shown — and debited for — five lines that never entered the
   escrow. The cap has to hold in the UI, because the UI is where the totals
   the player trusts are drawn. */
const MANY = Array.from({ length: 25 }, (_, i) => ({
  id: 'r' + i, name: 'Res ' + i, icon: '⛓', qty: 5,
}));
await push(base({ depositable: { resources: MANY, cards: [], items: [] },
                  resourceCatalog: MANY.map(r => ({ id: r.id, name: r.name, icon: r.icon })) }));
await page.waitForTimeout(180);
await giveCard().locator('button', { hasText: 'Resources' }).first().click();
await page.waitForTimeout(140);
for (let i = 0; i < 25; i++) {
  const row = giveCard().locator('.row', { hasText: new RegExp('Res ' + i + '(?!\\d)') }).first();
  const b = row.locator('button', { hasText: '+1' }).first();
  if (await b.count() && !(await b.isDisabled())) await b.click();
}
await page.waitForTimeout(200);
t = await txt();
// ⚠ /i and the uppercase spelling: these labels carry text-transform:uppercase
//   and innerText returns the TRANSFORMED text, so "Your side" never matches.
const giveFooter = (t.replace(/\s+/g, ' ').match(/YOUR SIDE 🔥 [\d,]+ · (\d+)\/20 lines/i) || [])[1];
chk('the give side stops at the server\'s 20-line cap', giveFooter === '20', 'lines=' + giveFooter);
const over = await giveCard().locator('.row', { hasText: /Res 24(?!\d)/ }).locator('button', { hasText: '+1' }).first().isDisabled();
chk('…and the 21st asset\'s +1 is disabled rather than silently dropped later', over);

// The ask side carries the same cap for the same reason.
for (let i = 0; i < 25; i++) {
  await page.locator('.screen select').last().selectOption('r' + i).catch(() => {});
  const add = askCard().locator('button', { hasText: 'Add' }).first();
  if (!(await add.isDisabled())) await add.click();
}
await page.waitForTimeout(200);
t = await txt();
const askFooter = (t.replace(/\s+/g, ' ').match(/THEIR SIDE 🔥 [\d,]+ · (\d+)\/20 lines/i) || [])[1];
chk('the ask side stops at 20 too', askFooter === '20', 'lines=' + askFooter);

/* ── 11. A STASH THAT SHRINKS UNDER A COMPOSED OFFER SAYS SO ───────────────
   The offer has always been re-clamped to what is actually held — that part
   was right and is what stops a send failing at the last moment. What was
   wrong is that it happened in SILENCE: a line composed as 120 came back
   reading 5 with no explanation, which is the same class of defect as a
   number that was never real. */
await push(base());
await page.waitForTimeout(160);
await giveCard().locator('.row', { hasText: 'Fuel' }).locator('button', { hasText: 'All' }).click();
await page.waitForTimeout(160);
t = await txt();
chk('a 120-unit stack composes as ×120', /×120/.test(t));
// Now the same player, with the fuel mostly spent elsewhere.
await push(base({ depositable: {
  resources: [{ id: 'metal', name: 'Scrap Metal', icon: '⛓', qty: 3 },
              { id: 'fuel',  name: 'Fuel',        icon: '⛽', qty: 5 }],
  cards: DEP.cards, items: DEP.items } }));
await page.waitForTimeout(220);
t = await txt();
chk('the offer follows the stash down to ×5', /×5/.test(t) && !/×120/.test(t));
chk('…and the change is STATED, not made in silence',
  /stash changed/i.test(t) && /reduced from 120 to 5/i.test(t),
  (t.match(/reduced from[^\n]*/) || ['(no notice)'])[0]);

// ── 12. no offers at all is an empty state, not a demo row ────────────────
await push(base());
await page.waitForTimeout(160);
t = await txt();
chk('zero trades reads as zero trades', /No trades yet in this corporation/.test(t));

chk('no page errors while driving all of the above', errs.length === 0, errs.slice(0, 3).join(' | '));

await page.screenshot({ path: '.gauntlet/shots/guildtrade.png', fullPage: true }).catch(() => {});
await browser.close();
server.close();
console.log(bad === 0 ? '\n=== GUILD TRADE: ALL PASS ===' : '\n=== GUILD TRADE: ' + bad + ' FAILED ===');
process.exit(bad === 0 ? 0 : 1);
