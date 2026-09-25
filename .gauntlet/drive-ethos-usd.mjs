/* ══════════════════════════════════════════════════════════════════════════
   💵 DRIVE-ETHOS-USD — the Bank of Ethos says what the account is worth.

   THE ASK: "Remove Live Session — Vash Korr · Ranked Battle Ops from Bank of
   Ethos and put there how much the player bank account is worth in USD.
   Remember every 5000 cinder is $1 and 1 aza coin equal 1 aza coin."

   WHAT WAS THERE was demo furniture end to end — a mercenary nobody owns, a
   clock counting from a hardcoded 11,520 seconds, a "+12/sec" no stream
   produced, and a flat 18,240 loot estimate sitting on a real banking page
   next to real balances. It is gone.

   ⚠ ONE RATE WAS ASSUMED, AND IT IS THE ONE TO CHECK. "1 aza coin equal 1 aza
     coin" reads as a typo; taken literally it states no rate at all. AZA is the
     card labelled STABLE · MARKET-PEGGED, and the sentence contrasts it with
     Cinder's 5,000:1, so it is implemented as 1 AZA = $1. Both rates are named
     constants (USD_PER_CINDER / USD_PER_AZA) and printed ON the cards, so if
     the peg is something else it is one line to change and the screen already
     tells the player which rate it used.

   Driven against the numbers from the report's own screenshot, so the
   arithmetic is checkable by hand:
     Cinder  2,871,123 bank + 920,114 wallet = 3,791,237 → $758.25
     Aza            12 bank +   1,584 wallet =     1,596 → $1,596.00
     Bank $586.22 · Wallet $1,768.02 · Total $2,354.25

   Pinned, with controls:
     · the total, the bank half and the wallet half are all correct
     · both rates are shown on screen, not hidden in the source
     · CONTROL: the retired panel is gone from the page
     · CONTROL: an empty account reads $0.00 and does not divide by zero

   Run:  node .gauntlet/drive-ethos-usd.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9010 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const PAGE = 'http://127.0.0.1:' + P + '/ethos/' + encodeURIComponent('Bank of Ethos.html');
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];

/* Babel-standalone transpiles app.jsx in the browser, so the page must reach
   unpkg. Everything else off-box is cut. */
async function open(account) {
  const pg = await b.newPage({ viewport: { width: 1500, height: 1200 } });
  pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('unpkg.com') || u.includes('cdn.jsdelivr.net')) return r.continue();
    return r.abort();
  });
  await pg.addInitScript((acc) => {
    try { localStorage.setItem('boe.account.v1', JSON.stringify(acc)); } catch (e) {}
  }, account);
  await pg.goto(PAGE, { waitUntil: 'load', timeout: 120000 });
  await pg.waitForFunction('!!document.querySelector(".panel")', null, { timeout: 90000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  return pg;
}
const ACCOUNT = {
  handle: 'operator', callsign: 'Sethiroth Tha Dev', initials: 'ST', c1: '#8a6bff', c2: '#ff7a3d',
  cinder: 2871123, aza: 12, walletCinder: 920114, walletAza: 1584,
  vault: { bankReady: true }, mercListings: [], loans: [], contracts: [], ledger: [], res: {}, walletRes: {},
};

const out = {};
{
  const pg = await open(ACCOUNT);
  /* The panel lives on the Vaults route — click the nav item by its text so the
     test goes where a player would rather than reaching into React state. */
  out.navigated = await pg.evaluate(() => {
    const hit = [...document.querySelectorAll('a,button,div,li,span')]
      .find(el => /^\s*vaults?\b/i.test(el.textContent || '') && (el.textContent || '').length < 40);
    if (hit) { hit.click(); return true; }
    return false;
  });
  await pg.waitForTimeout(1500);
  out.page = await pg.evaluate(() => {
    const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
    const panels = [...document.querySelectorAll('.panel')];
    const p = panels.find(x => /Account Value/i.test(x.textContent || ''));
    return {
      text: txt.slice(0, 4000),
      hasPanel: !!p,
      panelText: p ? (p.innerText || '').replace(/\s+/g, ' ').trim() : null,
      /* ⚠ NARROW ON PURPOSE. 'Vash Korr' is a demo NPC used all over this
         mock bank — the directory, a marketplace seller, the ledger, a live
         contract — and the ask was to remove the PANEL, not to purge the
         character. The first version of this control scanned the whole page for
         the name and failed on those, i.e. it was testing something nobody
         asked for. These two strings belonged to the retired panel alone. */
      retiredPanelGone: !/Live Session —/i.test(txt) && txt.indexOf('+12/sec') < 0,
    };
  });
  await pg.close();
}
{
  // CONTROL: a brand-new account holds nothing.
  const pg = await open(Object.assign({}, ACCOUNT, { cinder: 0, aza: 0, walletCinder: 0, walletAza: 0 }));
  await pg.evaluate(() => {
    const hit = [...document.querySelectorAll('a,button,div,li,span')]
      .find(el => /^\s*vaults?\b/i.test(el.textContent || '') && (el.textContent || '').length < 40);
    if (hit) hit.click();
  });
  await pg.waitForTimeout(1500);
  out.empty = await pg.evaluate(() => {
    const p = [...document.querySelectorAll('.panel')].find(x => /Account Value/i.test(x.textContent || ''));
    return p ? (p.innerText || '').replace(/\s+/g, ' ').trim() : null;
  });
  await pg.close();
}

const P_ = out.page || {};
const t = P_.panelText || '';
const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
need('the Vaults page was reached', out.navigated === true, out.navigated);
need('CONTROL: the Vash Korr session panel is gone', P_.retiredPanelGone === true,
     (P_.text || '').slice(0, 300));
need('the Account Value panel is on the page', P_.hasPanel === true, P_.hasPanel);
need('THE ASK: the total reads $2,354.25', t.includes('$2,354.25'), t.slice(0, 400));
need('…the banked half reads $586.22', t.includes('$586.22'), t.slice(0, 400));
need('…and the wallet half reads $1,768.02', t.includes('$1,768.02'), t.slice(0, 400));
need('Cinder converts to $758.25', t.includes('$758.25'), t.slice(0, 400));
need('Aza converts to $1,596.00', t.includes('$1,596.00'), t.slice(0, 400));
need('the Cinder rate is stated on screen', /5,000 CDR = \$1/.test(t), t.slice(0, 400));
need('the Aza rate is stated on screen', /1 AZA = \$1/.test(t), t.slice(0, 400));
need('CONTROL: an empty account reads $0.00, with no NaN', /\$0\.00/.test(out.empty || '') && !/NaN/.test(out.empty || ''), out.empty);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify({ navigated: out.navigated, hasPanel: P_.hasPanel,
  retiredPanelGone: P_.retiredPanelGone, panelText: t, empty: out.empty,
  pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the bank shows what the account is worth, and says which rates it used.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
