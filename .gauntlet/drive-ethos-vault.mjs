/* ══════════════════════════════════════════════════════════════════════════
   🏦 DRIVE-ETHOS-VAULT — the other half of the readout, on the bank page.

   ⚠ ethos/app.jsx had NO SYNTAX GATE AT ALL until this round (_synckcheck only
   reads inline <script> in .html, modcheck only walks public/src), and it still
   has no runtime one. It is 197k of JSX behind an in-browser Babel transform,
   so a mistake in it does not fail a build — it renders nothing and logs to a
   console no one is reading. Hence a real browser.

   The claim under test is the same one drive-vault.mjs makes for the city, at
   the other end of the same bridge: the page prints the ceiling it was HANDED.
     1  IT RENDERS THE CAP — "Resources in bank" reads used / cap, and the
        sub-line reads the room, on both the Ops Vault page and the dashboard.
     2  CONTROL, AND IT IS THE WHOLE POINT — an account seeded WITHOUT cap (an
        older parent, which is every returning player until index.html reaches
        their cache) must fall back to the original "x of N types" wording and
        must NOT invent "0 / 0". Guarding on cap > 0 is the entire fix; a
        `|| 8000` default would pass check 1 and fail here.
     3  THE NUMBER IS NOT WRITTEN DOWN — re-seed with a different ceiling and
        the page prints that one instead.

   React/ReactDOM/Babel come from unpkg, exactly as they do for a player —
   see the SRI note below for why they are NOT swapped for local copies.

   Run:  node .gauntlet/drive-ethos-vault.mjs
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

/* A 149-row catalogue is not needed to render a metric; three rows are, so the
   "x of N types" fallback has a real N to print. */
const CAT = [
  { id: 'metal', name: 'Metal', ico: '⛓' },
  { id: 'food', name: 'Food', ico: '🥫' },
  { id: 'water', name: 'Water', ico: '💧' },
];

function acct(vaultExtra) {
  return {
    handle: '@driver', callsign: 'Driver', initials: 'DR', c1: '#8a6bff', c2: '#ff7a3d',
    cinder: 12000, aza: 3, walletCinder: 5000, walletAza: 1,
    vault: Object.assign({
      resCatalog: CAT,
      walletRes: { metal: 400, food: 20, water: 10 },
      bankRes: { metal: 7000, food: 900 },
      bankReady: true, extCols: true,
    }, vaultExtra),
    ledger: [], reqIn: [], reqOut: [], loans: [],
    loanCap: { aza: 0, max: 20, perLv: 5, heroLv: 0, perCinder: 5000 },
    businessLoans: [], mercListings: [], mercAsEmployer: [], mercAsMerc: [],
    pendingApplication: false, created: '2026-01-01T00:00:00.000Z', recoveryKey: '—',
  };
}

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};

/* Load the page with a given account and return what the two metrics read.
   A fresh context each time — the app reads localStorage once, at mount. */
async function readMetrics(account, label) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

  /* ⚠ DO NOT fulfil the CDN tags from node_modules. All three carry an
     `integrity` hash, so substituted bytes are REJECTED BY SRI — and an SRI
     rejection is not a pageerror. The page then renders nothing at all, with a
     clean error log, which reads exactly like the app being broken. That cost a
     full false-negative run of this driver. React/ReactDOM/Babel come from the
     network, as they do for a player. */
  await page.addInitScript((a) => {
    try { localStorage.setItem('boe.account.v1', JSON.stringify(a)); } catch (e) {}
  }, account);

  await page.goto(`http://127.0.0.1:${PORT}/ethos/Bank%20of%20Ethos.html`, { waitUntil: 'load', timeout: 90000 });
  // Babel transforms 197k of JSX in-page; the mount is not synchronous with load.
  await page.waitForFunction(
    () => !!document.querySelector('.metric'), null, { timeout: 60000 },
  ).catch(() => {});

  const grab = () => page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.metric').forEach((m) => {
      const k = m.querySelector('.k'), v = m.querySelector('.v');
      if (k && v) out.push({ k: k.textContent.trim(), v: v.textContent.replace(/\s+/g, ' ').trim() });
    });
    return out;
  });

  const dash = (await grab()).find((m) => /^Resources in Bank$/i.test(m.k)) || null;

  // Navigate to the Ops Vault page by its sidebar label.
  const nav = page.locator('text=Ops Vault').first();
  if (await nav.count()) { await nav.click({ timeout: 10000 }).catch(() => {}); await page.waitForTimeout(1200); }
  const ops = (await grab()).find((m) => /^Resources in bank$/.test(m.k)) || null;

  await ctx.close();
  return { dash, ops, errs, label };
}

/* ── 1. THE CAP RENDERS ──────────────────────────────────────────────── */
console.log('\n1. an account seeded WITH a ceiling prints it');
const withCap = await readMetrics(acct({ cap: 8000, fee: 500, used: 7900, room: 100 }), 'with cap');
console.log('   dashboard: ' + JSON.stringify(withCap.dash));
console.log('   ops vault: ' + JSON.stringify(withCap.ops));
ok('the page mounted at all (Babel + React came up)', !!(withCap.dash || withCap.ops),
   withCap.errs.length ? 'pageerrors: ' + withCap.errs[0] : '');
ok('Ops Vault metric reads 7,900 / 8,000', !!(withCap.ops && /7,900\s*\/\s*8,000/.test(withCap.ops.v)));
ok('Ops Vault sub-line reads the room', !!(withCap.ops && /100 units of room/.test(withCap.ops.v)));
ok('dashboard tile reads 7,900 / 8,000', !!(withCap.dash && /7,900\s*\/\s*8,000/.test(withCap.dash.v)));
ok('dashboard sub-line reads the room', !!(withCap.dash && /100 units of room/.test(withCap.dash.v)));

/* ── 2. CONTROL — no cap seeded ──────────────────────────────────────── */
console.log('\n2. CONTROL — an account from an older parent, with no ceiling at all');
const noCap = await readMetrics(acct({}), 'no cap');
console.log('   dashboard: ' + JSON.stringify(noCap.dash));
console.log('   ops vault: ' + JSON.stringify(noCap.ops));
ok('Ops Vault falls back to the original units wording', !!(noCap.ops && /7,900 units/.test(noCap.ops.v)));
ok('Ops Vault invents NO ceiling', !!(noCap.ops && !/\//.test(noCap.ops.v)), JSON.stringify(noCap.ops && noCap.ops.v));
ok('Ops Vault keeps the types sub-line', !!(noCap.ops && /2 of 3 types/.test(noCap.ops.v)));
ok('dashboard invents NO ceiling', !!(noCap.dash && !/\//.test(noCap.dash.v)), JSON.stringify(noCap.dash && noCap.dash.v));

/* ── 3. THE NUMBER IS NOT WRITTEN DOWN ───────────────────────────────── */
console.log('\n3. a different ceiling prints differently — nothing is hardcoded');
const retuned = await readMetrics(acct({ cap: 25000, fee: 500, used: 7900, room: 17100 }), 'retuned');
console.log('   ops vault: ' + JSON.stringify(retuned.ops));
ok('Ops Vault reads 7,900 / 25,000', !!(retuned.ops && /7,900\s*\/\s*25,000/.test(retuned.ops.v)));
ok('and the room follows to 17,100', !!(retuned.ops && /17,100 units of room/.test(retuned.ops.v)));

const allErrs = [...withCap.errs, ...noCap.errs, ...retuned.errs];
console.log('\npage errors across all three loads: ' + allErrs.length);
allErrs.slice(0, 5).forEach((e) => console.log('   ' + e));

console.log(fails ? '\n❌ ' + fails + ' CHECK(S) FAILED' : '\n✅ ALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
