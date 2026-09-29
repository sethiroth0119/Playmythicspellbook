/* ⇄ LOGISTICS DRIVER — the corp Logistics screen, rendered in a real browser.
   The parse gates only prove screens.jsx parses; this renders it and reads the
   DOM back. Copied from drive-mailbox.mjs, including its warning:

   public/ is served over loopback and public/corp/index.html is opened for
   real (React + Babel still come from unpkg — the CDN <script> tags carry SRI
   hashes and swapping them for node_modules copies is rejected SILENTLY,
   giving a blank page with a clean console, so they are left alone).

   The bridge is stubbed the way the game drives it: set window.__JB.econ and
   dispatch 'jbdata'. That is the exact seam _jbridge.js writes through, so
   nothing here is a private back door into the screen.

   node .gauntlet/drive-logistics.mjs                                        */
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
const errs = [], warns = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => {
  if (m.type() === 'error') errs.push('console: ' + m.text());
  if (m.type() === 'warning') warns.push(m.text());
});

await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.sidebar', { timeout: 30000 });
chk('the corp app mounted at all (CDN React/Babel reachable)', await page.locator('.sidebar').count() === 1);

// ── fixtures ───────────────────────────────────────────────────────────────
// Convoy rows in exactly the shape _jbConvoys() emits (verified against the
// shipped function by .gauntlet/exec-logistics-bridge.mjs). The two ids here
// are the pair that COLLIDED under the old 900-wide rule — node_120 / node_201.
const CONVOYS = [
  { id: 'CV-339766', from: 'Node A', to: 'Camp', cargo: '600 food', qtyUnits: 600, resource: 'food',
    escort: 'unescorted', risk: 0.05, progress: 0.62, eta: '34m', status: 'in-transit', flag: '',
    nodeId: 'node_120', rig: 'Hand-hauled', rigIcon: '🧺', rigOwned: false, baseCargo: '600 food', rigBonus: '' },
  { id: 'CV-338866', from: 'Node B', to: 'Camp', cargo: '240 metal', qtyUnits: 240, resource: 'metal',
    escort: '2 guards', risk: 0.4, progress: 0.99, eta: '1m', status: 'in-transit', flag: '',
    nodeId: 'node_201', rig: 'Hand-hauled', rigIcon: '🧺', rigOwned: false, baseCargo: '240 metal', rigBonus: '' },
];
const H = 3600000;
const LANES = [
  { id: 'ag-1:p', agreementId: 'ag-1', status: 'active', fromCity: 'Ashfall Commons', toCity: 'Ironrow',
    fromName: 'Sethiroth', toName: 'Marrow', mine: true, resource: 'metal', units: 200,
    cycleHours: 12, days: 3, cyclesTotal: 6, cyclesSettled: 1, nextDueAt: Date.now() + 4 * H,
    startsAt: Date.now() - 30 * H, lastSent: 140, lastOutcome: 'short_proposer',
    lastDueAt: Date.now() - 6 * H, lastSettledAt: Date.now() - 5 * H },
  { id: 'ag-2:w', agreementId: 'ag-2', status: 'active', fromCity: 'Saltmarch', toCity: 'Ironrow',
    fromName: 'Vane', toName: 'Marrow', mine: false, resource: 'food', units: 75,
    cycleHours: 24, days: 4, cyclesTotal: 4, cyclesSettled: 0, nextDueAt: null,
    startsAt: Date.now() - 30 * H, lastSent: null, lastOutcome: null, lastDueAt: null, lastSettledAt: null },
];
const WH_ROWS = [
  { id: 'sh-1', senderId: 'u-mate', senderName: 'Marrow', ownerName: 'Corvin', bayNo: 3,
    originKind: 'city', originLabel: 'Ironrow', freeCity: false, nodeLevel: 8,
    etaAt: Date.now() + 4 * H, sentAt: Date.now() - 16 * H, etaHours: 20, weightKg: 412.5,
    status: 'transit', cratesTotal: 4, cratesStored: 1, units: 75,
    cargo: [{ id: 'medicine', qty: 40 }, { id: 'fuel', qty: 30 }, { id: 'metal', qty: 5 }], mine: false },
];

const SHIP = (over) => Object.assign({
  ready: true, scope: 'corp', at: Date.now(),
  city: { ok: true, missing: false, error: null, lanes: LANES },
  warehouse: { ok: true, missing: false, error: null, scope: 'corp', rows: WH_ROWS },
}, over || {});

const ECON = (over) => Object.assign({
  cinders: 1000, aza: 0, mt: 0, wallet: null, handle: 'Sethiroth', signedIn: true, isAdmin: false,
  corp: { id: 'corp-1', name: 'Ashford & Keel', tag: 'AK', role: 'founder' },
  corpChecked: true, roster: [], requests: [], pendingHires: [], vault: [], transfers: [],
  corps: [], resources: [], operations: [], corpActivity: [], corpActivityLoaded: true,
  guildChat: [], legalCases: [], agencyListings: [], realEstateListings: [],
  convoys: CONVOYS, corpShipments: SHIP(),
}, over || {});

const push = (econ) => page.evaluate((e) => {
  window.__JB.econ = e; window.__JB.ready = true;
  window.dispatchEvent(new Event('jbdata'));
}, econ);
const openLogistics = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('.sidebar .nav button')].find(x => /Logistics/.test(x.textContent));
  b && b.click();
});

// The screen, read back as data.
const read = () => page.evaluate(() => {
  const cards = [...document.querySelectorAll('.screen .card')];
  const head = document.querySelector('.screen-head');
  const cardOf = (title) => cards.find(c => {
    const h = c.querySelector('.row-head h3');
    return h && h.textContent.trim() === title;
  }) || null;
  const rowsOf = (c) => c ? [...c.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim())) : [];
  const conv = cardOf('Active convoys');
  const city = cardOf('City trade agreements');
  const wh = cardOf('Inbound to warehouse bays');
  return {
    headText: head ? head.innerText : '',
    convoyRows: rowsOf(conv),
    convoyHeads: conv ? [...conv.querySelectorAll('thead th')].map(t => t.textContent.trim()) : [],
    convoyButtons: conv ? [...conv.querySelectorAll('button')].map(b => b.textContent.trim()) : [],
    convoyMore: conv ? [...conv.querySelectorAll('.more')].map(b => b.textContent.trim()) : [],
    cityRows: rowsOf(city),
    cityText: city ? city.innerText : '',
    whRows: rowsOf(wh),
    whText: wh ? wh.innerText : '',
    screenText: document.querySelector('.screen') ? document.querySelector('.screen').innerText : '',
  };
});

// ── 1. the full, live screen ───────────────────────────────────────────────
await push(ECON());
await openLogistics();
await page.waitForTimeout(350);
let v = await read();

chk('the Logistics screen renders its three cards',
    v.convoyRows.length > 0 && v.cityRows.length > 0 && v.whRows.length > 0,
    'convoy ' + v.convoyRows.length + ' / city ' + v.cityRows.length + ' / warehouse ' + v.whRows.length);

// ── 2. the headline: a UNIT total, never currency ──────────────────────────
chk('the headline is labelled CONVOY CARGO, not "in-transit value"',
    /CONVOY CARGO/i.test(v.headText), JSON.stringify(v.headText.split('\n').slice(-2)));
chk('…and it says "units"', /\bunits\b/.test(v.headText), v.headText.split('\n').pop());
chk('…and it never says Aza coin', !/Aza coin/.test(v.headText));
{
  // The Cargo column is index 2 of the convoy table. Sum its leading numbers
  // and compare against the headline — this is the "numbers agree with their
  // own source" requirement, measured rather than asserted.
  const sum = v.convoyRows.reduce((s, r) => s + Number(String(r[2]).split(' ')[0].replace(/,/g, '')), 0);
  const shown = Number((v.headText.match(/([\d,]+)\s*units/) || [])[1]?.replace(/,/g, ''));
  chk('the headline EQUALS the sum of the Cargo column below it', sum === shown, sum + ' vs ' + shown);
}

// ── 3. the colliding pair renders as two distinct rows ─────────────────────
{
  const ids = v.convoyRows.map(r => r[0]);
  chk('two owned nodes that used to collide are two rows', v.convoyRows.length === 2, ids.join(' / '));
  chk('…with distinct ids', new Set(ids).size === 2, ids.join(' / '));
  const dupKey = warns.concat(errs).filter(t => /same key|duplicate key|Encountered two children/i.test(t));
  chk('React logged no duplicate-key warning', dupKey.length === 0, dupKey.join(' | '));
}

// ── 4. the inert controls are gone ─────────────────────────────────────────
chk('no "Dispatch new" control survives', !v.convoyMore.some(t => /Dispatch/i.test(t)) && !/Dispatch new/.test(v.screenText));
chk('no inert Track / Recall buttons survive on a convoy row',
    !v.convoyButtons.some(t => /^(Track|Recall)$/.test(t)), v.convoyButtons.join(','));

// ── 5. no fabricated content anywhere on the screen ────────────────────────
for (const s of ['Iron Foundry 04', 'Tenement Row 14', 'AI Lab Klyx', 'Drowned Chapel',
                 'CV-011', 'CV-005', '48,240', 'Production chains', 'Recent incidents',
                 'Insurance payout', 'unaccounted']) {
  chk('the screen never says "' + s + '"', v.screenText.indexOf(s) < 0);
}

// ── 6. every rendered number is real and finite ────────────────────────────
chk('nothing on the screen reads NaN / undefined / Invalid Date',
    !/\bNaN\b|\bundefined\b|Invalid Date/.test(v.screenText),
    (v.screenText.match(/.{0,40}(NaN|undefined|Invalid Date).{0,40}/) || [''])[0]);

// ── 7. the city lane numbers trace to the fixture ──────────────────────────
{
  const r = v.cityRows[0];
  chk('lane route is the two real city names', r && /Ashfall Commons/.test(r[0]) && /Ironrow/.test(r[0]), r && r[0]);
  chk('lane cargo is the agreement quantity and resource', r && r[2] === '200 metal', r && r[2]);
  chk('lane cycle is the agreement term', r && /every 12h/.test(r[3]) && /1 \/ 6 settled/.test(r[3]), r && r[3].replace(/\n/g, ' | '));
  chk('lane next-due renders as a relative time, not a raw timestamp', r && /^in \d/.test(r[5]), r && r[5]);
  chk('lane last cycle shows what really shipped, and that it was short',
      r && /140 shipped/.test(r[6]) && /short proposer/.test(r[6]), r && r[6].replace(/\n/g, ' | '));
  const r2 = v.cityRows[1];
  chk('a lane with no cycles yet says "nothing yet" rather than 0',
      r2 && /nothing yet/.test(r2[6]), r2 && r2[6]);
  chk('…and a null due time renders as an em dash, not NaN', r2 && r2[5] === '—', r2 && r2[5]);
}

// ── 8. the warehouse row numbers trace to the fixture ──────────────────────
{
  const r = v.whRows[0];
  chk('warehouse route names the origin and the destination bay',
      r && /Ironrow/.test(r[0]) && /Corvin/.test(r[0]) && /bay 3/.test(r[0]), r && r[0].replace(/\n/g, ' | '));
  chk('warehouse cargo lists the payload and its unit total',
      r && /40 medicine/.test(r[2]) && /75 units/.test(r[2]), r && r[2].replace(/\n/g, ' | '));
  chk('warehouse weight is the row weight in kg', r && r[3] === '412.5 kg', r && r[3]);
  chk('crates unloaded is stored / total', r && r[6] === '1 / 4 crates', r && r[6]);
}

// ── 9. sql/038-039 absent — the panel says so, convoys still work ──────────
await push(ECON({ corpShipments: SHIP({ city: { ok: false, missing: true, error: null, lanes: [] } }) }));
await page.waitForTimeout(300);
v = await read();
chk('with the city tables missing the convoy table still renders', v.convoyRows.length === 2);
chk('…and the city panel SAYS the network is not switched on',
    /not switched on yet/.test(v.cityText), v.cityText.replace(/\n/g, ' | ').slice(0, 160));
chk('…and it does not claim the guild is idle', !/No standing city trade agreements/.test(v.cityText));
chk('…and the warehouse panel is unaffected', v.whRows.length === 1);

// ── 9b. …and an ADMIN gets the filename, a player never does ───────────────
await push(ECON({ isAdmin: true, corpShipments: SHIP({ city: { ok: false, missing: true, error: null, lanes: [] } }) }));
await page.waitForTimeout(300);
v = await read();
chk('an admin is told exactly which migrations to apply',
    /038_city_economy_trade\.sql/.test(v.cityText) && /039_city_trade_agreements\.sql/.test(v.cityText));

// ── 10. genuinely empty — an honest empty state with a door ────────────────
await push(ECON({ corpShipments: SHIP({
  city: { ok: true, missing: false, error: null, lanes: [] },
  warehouse: { ok: true, missing: false, error: null, scope: 'corp', rows: [] } }) }));
await page.waitForTimeout(300);
v = await read();
chk('an empty guild says it is empty and names the way in',
    /No standing city trade agreements/.test(v.cityText) && /Do business with this city/.test(v.cityText));
chk('an empty warehouse panel names its way in too',
    /Nothing inbound to a warehouse bay/.test(v.whText) && /Rent a bay/.test(v.whText));

// ── 11. self scope — the panel admits it is only showing your own ──────────
await push(ECON({ corpShipments: SHIP({ scope: 'self',
  warehouse: { ok: true, missing: false, error: null, scope: 'self', rows: WH_ROWS } }) }));
await page.waitForTimeout(300);
v = await read();
chk('with sql/049 unapplied the city panel says it shows YOUR OWN agreements only',
    /your own.{0,20}agreements only/is.test(v.cityText), v.cityText.replace(/\n/g, ' | ').slice(0, 200));
chk('…and the warehouse panel says the same about loads',
    /your own.{0,20}loads only/is.test(v.whText));

// ── 12. no convoys at all — no headline, no invented balance ───────────────
await push(ECON({ convoys: [], corpShipments: SHIP() }));
await page.waitForTimeout(300);
v = await read();
chk('with nothing on the road the headline is ABSENT rather than a fallback number',
    !/units/.test(v.headText) && !/48/.test(v.headText), JSON.stringify(v.headText));
chk('…and the convoy table shows its honest empty state',
    /No convoys on the road/.test(v.screenText));

// ── 12b. a lane whose cycle history could not be read in full ─────────────
// The bridge sets cyclesUnknown when its shipment page came back capped. The
// screen must then print neither a count nor "nothing yet" — the second is a
// claim that no cycle has fired, and that is exactly what is not known.
await push(ECON({ corpShipments: SHIP({ city: { ok: true, missing: false, error: null, lanes: [
  Object.assign({}, LANES[0], { cyclesUnknown: true, cyclesSettled: null, nextDueAt: null,
                                lastSent: null, lastOutcome: null, lastSettledAt: null }),
] } }) }));
await page.waitForTimeout(300);
v = await read();
{
  const r = v.cityRows[0];
  chk('an unread cycle history prints "cycles unread" in the cycle cell',
      r && /cycles unread/.test(r[3]), r && r[3].replace(/\n/g, ' | '));
  chk('…and in the last-cycle cell too', r && /cycles unread/.test(r[6]), r && r[6]);
  chk('…and never a "/ 6 settled" count it could not verify', r && !/settled/.test(r[3]), r && r[3]);
  chk('…and never claims nothing has shipped', r && !/nothing yet/.test(r[6]), r && r[6]);
  chk('…and the quantity and route are still shown', r && r[2] === '200 metal', r && r[2]);
  chk('…and nothing reads NaN or null', !/\bNaN\b|\bnull\b|\bundefined\b/.test(v.cityText),
      (v.cityText.match(/.{0,40}(NaN|null|undefined).{0,40}/) || [''])[0]);
}
// ── 13. standalone, with no bridge at all ─────────────────────────────────
await page.evaluate(() => { window.__JB.econ = null; window.__JB.ready = false; window.dispatchEvent(new Event('jbdata')); });
await page.waitForTimeout(300);
v = await read();
chk('with no bridge the screen still renders and explains itself',
    /Open .*Just Business.* from inside the game/is.test(v.cityText), v.cityText.replace(/\n/g, ' | ').slice(0, 140));
chk('…and nothing threw', errs.filter(e => !/favicon|net::ERR/.test(e)).length === 0,
    errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\n' + (bad ? '❌ ' + bad + ' FAILED' : '✅ all logistics screen checks passed'));
process.exit(bad ? 1 : 0);
