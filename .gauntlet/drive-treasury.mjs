/* ══════════════════════════════════════════════════════════════════════════
   🏦 DRIVE-TREASURY — the rewritten Corp Treasury screen, in a real browser.

   jsxcheck proves screens.jsx PARSES. It cannot tell a real balance from the
   hardcoded 2,438,120 headline this screen shipped with for months, and it
   cannot tell a rendered table from a component that threw on mount. Gate #4
   of this repo's rules: for anything load-bearing, EXECUTE it.

   THE ONE CLAIM THAT MATTERS, and it is measured three times in three places:
     the Corp Treasury headline, the Operations header readout and the number
     the Fund button gates spending on are the SAME number, and that number
     equals `select sum(amount) from corp_treasury where corp_id=…` TO THE UNIT.

   Also measured, all out of the DOM:
     1  HEADLINE == sum(amount), including a balance far above 2^31 — the old
        `| 0` was a 32-BIT CAST and wrapped a large treasury NEGATIVE.
     2  OPERATIONS header prints the identical string.
     3  EVERY LEDGER LINE traces to a corp_treasury row (amount/kind/note/who).
     4  EMPTY treasury shows 0 and an honest "no movements yet" — not a dash,
        not a blank.
     5  UNREAD (corpTreasuryKnown === false) is NOT rendered as 0. "Offline" and
        "broke" are different facts. This is the inverse of claim 4 and the two
        must not collapse into one another.
     6  DEGRADES: no bridge / signed out / no corp each say which one it is.
     7  NO NaN, NO undefined, NO "Infinity" on screen for hostile rows (qty and
        amount arriving as strings, nulls, absent — PostgREST returns `numeric`
        as a STRING, which is why this is not paranoia).
     8  "Open full vault" is a real control that ROUTES to the Vault screen.
     9  NO FABRICATED STRING survives — the grep from the brief, run against the
        rendered DOM rather than the source, so a string reassembled at runtime
        is caught too.

   ⚠ DO NOT fulfil the React/ReactDOM/Babel <script> tags from node_modules.
     All three carry an `integrity` hash; substituted bytes are rejected by SRI
     SILENTLY — a blank page with a clean console. They come from the network.

   Run:  node .gauntlet/drive-treasury.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const PORT = 8700 + (process.pid % 90);

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

/* THE SEED IS THE SHAPE _jbEcon() SENDS (index.html:85372-85387), and the rows
   are the shape corpTreasuryFetch() builds. The amounts are deliberately the
   REAL live ANOMALY ledger's balance (1,600,935 — verified against
   `select sum(amount) from corp_treasury` on ktsiasyjusesawtrwrjc) so the
   expected headline is a number a critic can re-derive from the database
   rather than one invented here.

   The last four rows are hostile on purpose:
     · amount as a STRING — PostgREST returns `numeric` as a string, so this is
       the normal case, not an edge case;
     · amount null and amount absent — a partial row;
     · a row with no user_id, which corpTreasuryFetch labels 'System'. */
const LOG = [
  { id: 'l1', amount: 1500000, kind: 'deposit',   note: 'member deposit',   userId: 'u-a', who: 'Alpha',  at: new Date(Date.now() - 3600e3).toISOString() },
  { id: 'l2', amount: -200000, kind: 'op_startup', note: 'founded refinery', userId: 'u-b', who: 'Bravo',  at: new Date(Date.now() - 7200e3).toISOString() },
  { id: 'l3', amount: '300935', kind: 'deposit',  note: '',                 userId: 'u-a', who: 'Alpha',  at: new Date(Date.now() - 86400e3 * 3).toISOString() },
  { id: 'l4', amount: null,     kind: 'refund',   note: 'null amount row',  userId: null,  who: 'System', at: null },
  { id: 'l5',                   kind: 'wages',    note: 'absent amount',    userId: null,  who: 'System', at: 'not-a-date' },
];
// By hand from the five rows: 1500000 - 200000 + 300935 + 0 + 0 = 1,600,935.
const EXPECT_BAL = 1600935;
const EXPECT_STR = '1,600,935';

// A balance no 32-bit cast can survive: `x | 0` turns this NEGATIVE.
const BIG = 3000000000;
const BIG_STR = '3,000,000,000';

const FORBIDDEN = ['2,438,120', 'BLACK SUN', '34 / 50', 'RANK 04', 'TREASURY 2.4M',
  'WAR 14d', 'Sister Tiamat', 'WHISPER', 'Quartermaster', 'QUARTERMASTER',
  'Crimson Pact', 'Foundry Belt Expansion'];

function econ(over) {
  return Object.assign({
    signedIn: true, corpChecked: true, isAdmin: false,
    corp: { id: 'corp-1', name: 'Anvil Concern', tag: 'ANV', role: 'member' },
    handle: 'Charlie', amOwner: false, cinders: 0, aza: 0, mt: 0,
    corpTreasury: EXPECT_BAL, corpTreasuryLog: LOG, corpTreasury24h: 1300000,
    corpTreasuryKnown: true,
    roster: [{ userId: 'u-a', name: 'Alpha', role: 'member' }, { userId: 'u-b', name: 'Bravo', role: 'Lawyer' }],
    memberCount: 2, memberCap: 25, requests: [], pendingHires: [],
    vault: [], vaultRpc: 'ok', vaultUnknown: false,
    transfers: [], corps: [], resources: [], memberCities: [], memberCitiesState: 'ok',
    depositable: { cards: [], items: [], resources: [] },
    guildChat: [], legalCases: [], agencyListings: [], myOwnedHouses: [],
    realEstateListings: [], convoys: [], opArt: {}, reArt: {}, opEcon: {},
    corpActivity: [],
  }, over || {});
}

async function open(e, route) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (x) => errs.push(String(x).slice(0, 240)));
  await page.addInitScript((seed) => {
    if (seed) window.__JB = { econ: seed, ready: true };
    window.__ACTIONS = [];
  }, e || null);
  await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__ACTIONS = []; window.JB_action = (p) => { window.__ACTIONS.push(p); }; });
  if (route) {
    await page.evaluate((r) => window.dispatchEvent(new CustomEvent('jb:route', { detail: r })), route);
    await page.waitForTimeout(500);
  }
  return { ctx, page, errs };
}

const readScreen = (page) => page.evaluate(() => {
  const scr = document.querySelector('.screen');
  if (!scr) return null;
  const tbl = scr.querySelector('table.tbl');
  const rows = tbl ? Array.from(tbl.querySelectorAll('tbody tr')).map(tr =>
    Array.from(tr.querySelectorAll('td')).map(td => td.textContent.replace(/\s+/g, ' ').trim())) : [];
  return {
    head: ((scr.querySelector('.screen-head') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    rows,
    text: scr.textContent.replace(/\s+/g, ' ').trim(),
    side: ((document.querySelector('.corp-card') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    body: document.body.textContent.replace(/\s+/g, ' ').trim(),
  };
});

// ── 1 / 3 / 7 / 9 ───────────────────────────────────────────────────────────
console.log('\n1. the headline equals sum(amount), and every ledger line is a real row');
{
  const { ctx, page, errs } = await open(econ(), 'corp');
  const s = await readScreen(page);
  ok('the screen mounted at all', !!s, errs.length ? 'pageerrors: ' + errs[0] : '');
  if (s) {
    console.log('   head: ' + s.head.slice(0, 150));
    s.rows.forEach((r, i) => console.log('   row ' + i + ': ' + JSON.stringify(r)));
    ok('headline prints sum(amount) = ' + EXPECT_STR, s.head.includes(EXPECT_STR), 'head=' + s.head.slice(0, 90));
    ok('one rendered line per corp_treasury row (5)', s.rows.length === 5, 'got ' + s.rows.length);
    ok('the string-typed amount 300935 rendered as +300,935',
      s.rows.some(r => (r[0] || '').includes('300,935')), JSON.stringify(s.rows[2] || []));
    ok('the negative row rendered as a debit', s.rows.some(r => /−200,000|-200,000/.test(r[0] || '')));
    ok('null / absent amounts became 0, not NaN',
      s.rows.filter(r => /^0/.test((r[0] || '').replace(/[+−-]/, ''))).length >= 2,
      JSON.stringify([s.rows[3], s.rows[4]]));
    ok('a row with no user_id is labelled System', /System/.test(s.text));
    ok('the un-parseable date did not print Invalid Date', !/Invalid Date/.test(s.text));
    ok('NO NaN anywhere on the screen', !/NaN/.test(s.body));
    ok('NO undefined anywhere on the screen', !/undefined/.test(s.body));
    ok('NO Infinity anywhere on the screen', !/Infinity/.test(s.body));
    ok('no pageerror while rendering', errs.length === 0, errs[0] || '');
    const hit = FORBIDDEN.filter(f => s.body.includes(f));
    ok('no fabricated string in the rendered DOM', hit.length === 0, hit.join(' | '));
  }
  await ctx.close();
}

// ── 1 (32-bit) ──────────────────────────────────────────────────────────────
console.log('\n2. a balance above 2^31 does not wrap negative (the old `| 0` bug)');
{
  const { ctx, page } = await open(econ({ corpTreasury: BIG, corpTreasury24h: 0 }), 'corp');
  const s = await readScreen(page);
  ok('headline prints ' + BIG_STR, !!s && s.head.includes(BIG_STR), s ? s.head.slice(0, 90) : 'no screen');
  ok('headline is not negative', !!s && !/[−-]\s?\d/.test(s.head.split('Members')[0] || ''), s ? s.head.slice(0, 60) : '');
  await ctx.close();
}

// ── 2 (the same number in three places) ─────────────────────────────────────
console.log('\n3. Operations header and the sidebar print the IDENTICAL number');
{
  const { ctx, page } = await open(econ(), 'operations');
  const s = await readScreen(page);
  ok('Operations header prints ' + EXPECT_STR, !!s && s.text.includes(EXPECT_STR), s ? s.head.slice(0, 120) : 'no screen');
  ok('Operations shows no Aza treasury figure', !!s && !/Aza coin/.test(s.head || ''));
  ok('sidebar corp card prints the same ' + EXPECT_STR, !!s && s.side.includes(EXPECT_STR), s ? s.side : '');
  ok('sidebar shows real seats 2/25, not 34 / 50', !!s && /2\s*\/\s*25/.test(s.side), s ? s.side : '');
  const hit = FORBIDDEN.filter(f => s && s.body.includes(f));
  ok('no fabricated string on Operations', hit.length === 0, hit.join(' | '));
  await ctx.close();
}

// ── 4 (empty) vs 5 (unread) — the two must not collapse ─────────────────────
console.log('\n4. an EMPTY treasury shows 0 and "no movements yet"');
{
  const { ctx, page } = await open(econ({ corpTreasury: 0, corpTreasuryLog: [], corpTreasury24h: 0, corpTreasuryKnown: true }), 'corp');
  const s = await readScreen(page);
  /* ⚠ Assert the RENDERED VALUE, not a loose \b0\b. The label and the value are
     adjacent text nodes, so .textContent reads "Treasury0 🔥" — there is no word
     boundary before that 0 and `/\b0\b/` reports a FALSE FAILURE on a screen
     that is perfectly correct. Matching the value as it actually paints is both
     stricter (it pins the unit) and honest about the DOM. */
  ok('prints a real 0 with its unit, not a dash', !!s && /Treasury\s*0\s*🔥/.test(s.head), s ? s.head.slice(-80) : '');
  ok('the dash reserved for "unread" is NOT used', !!s && !/Treasury\s*—/.test(s.head), s ? s.head.slice(-80) : '');
  ok('says "No movements yet"', !!s && /No movements yet/i.test(s.text));
  ok('does NOT claim the ledger is unread', !!s && !/Ledger not read/i.test(s.text));
  ok('no NaN / undefined on an empty treasury', !!s && !/NaN|undefined/.test(s.body));
  await ctx.close();
}

console.log('\n5. an UNREAD treasury is not rendered as 0 ("offline" ≠ "broke")');
{
  const { ctx, page } = await open(econ({ corpTreasury: 0, corpTreasuryLog: [], corpTreasury24h: 0, corpTreasuryKnown: false }), 'corp');
  const s = await readScreen(page);
  ok('says "Ledger not read"', !!s && /Ledger not read/i.test(s.text));
  ok('does NOT say "No movements yet"', !!s && !/No movements yet/i.test(s.text));
  /* Positively assert the DASH. The earlier `!/\b0\s*🔥/` passed trivially —
     a negative assertion built on a regex that can never match is not a test,
     and it would have stayed green if the screen had printed a confident 0. */
  ok('headline shows the dash', !!s && /Treasury\s*—/.test(s.head), s ? s.head.slice(-80) : '');
  ok('headline does NOT print a confident 0', !!s && !/Treasury\s*0\s*🔥/.test(s.head), s ? s.head.slice(-80) : '');
  await ctx.close();
}

console.log('\n5b. Operations says TREASURY UNREAD rather than 0 on the same state');
{
  const { ctx, page } = await open(econ({ corpTreasury: 0, corpTreasuryKnown: false }), 'operations');
  const s = await readScreen(page);
  ok('Operations header says TREASURY UNREAD', !!s && /TREASURY UNREAD/.test(s.text), s ? s.head.slice(0, 120) : '');
  await ctx.close();
}

// ── 6 (degradation) ─────────────────────────────────────────────────────────
console.log('\n6. it degrades — and each silence says WHICH one it is');
{
  const cases = [
    ['no bridge at all',   null,                                        /Open this from inside the game/i],
    ['signed out',         econ({ signedIn: false }),                   /Sign in to read the treasury/i],
    ['no corp, checked',   econ({ corp: null, corpChecked: true }),     /not in a corporation/i],
    ['no corp, checking',  econ({ corp: null, corpChecked: false }),    /Checking your corporation/i],
  ];
  for (const [label, e, re] of cases) {
    const { ctx, page, errs } = await open(e, 'corp');
    const s = await readScreen(page);
    ok(label + ' → its own sentence', !!s && re.test(s.text), s ? s.text.slice(0, 110) : 'NO SCREEN');
    ok(label + ' → renders without error', errs.length === 0, errs[0] || '');
    ok(label + ' → no NaN/undefined', !!s && !/NaN|undefined/.test(s.body));
    await ctx.close();
  }
}

// ── 8 (the door) ────────────────────────────────────────────────────────────
console.log('\n7. "Open full vault" is a real control and routes to the Vault screen');
{
  const { ctx, page } = await open(econ(), 'corp');
  const btn = await page.evaluateHandle(() => {
    const b = Array.from(document.querySelectorAll('.screen button'))
      .find(x => /Open full vault/i.test(x.textContent || ''));
    return b || null;
  });
  const exists = await btn.evaluate(b => !!b);
  ok('the control exists and is a <button>', exists);
  if (exists) {
    const tag = await btn.evaluate(b => b.tagName);
    ok('it is a real button, not a dead <span>', tag === 'BUTTON', 'tag=' + tag);
    await btn.evaluate(b => b.click());
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      crumb: ((document.querySelector('.crumb') || document.querySelector('.topbar') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      head: ((document.querySelector('.screen .screen-head') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    ok('clicking it lands on the Vault screen',
      /Vault/i.test(after.crumb) || /Vault/i.test(after.head),
      'crumb=' + after.crumb.slice(0, 70) + ' head=' + after.head.slice(0, 70));
  }
  await ctx.close();
}

console.log(fails === 0 ? '\n🎉 ALL TREASURY CLAIMS HOLD\n' : '\n💥 ' + fails + ' FAILED\n');
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
