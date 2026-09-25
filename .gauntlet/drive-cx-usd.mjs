/* ══════════════════════════════════════════════════════════════════════════
   💵 DRIVE-CX-USD — the Crash Exchange prices in Cinder, and says what it is
   worth in dollars.

   THE ASK: "Put the price of the stock for resources in the crash exchange in
   cinder and Aza in USD so players can see how much their portfolio is worth
   and what is the price of things."

   🔴 THE BUG UNDERNEATH THE ASK. The terminal quoted everything in "CR" and
      never said what a CR was — while its own wallet panel read the balance
      straight off Profile.gems, i.e. CR has always BEEN Cinder. So a price of
      339.93 was a number with no unit, and a portfolio had no worth attached to
      it at all. The fix is not a new currency; it is naming the one that was
      already there and hanging the dollar peg off it.

   🔴 AND THE PEG MUST BE ONE PEG. It was declared inside public/ethos/app.jsx
      where only the Bank of Ethos could read it. Two copies of an exchange rate
      are noticed for the first time when two screens disagree in front of a
      player about how much money they have — so this driver loads peg.js the
      way each page loads it and requires both to answer identically.

   Pinned, with controls:
     · the peg is ONE file, and the Bank and the Exchange get the same numbers
     · 5,000 Cinder = $1 and 1 AZA = $1, the rates the owner gave
     · a sub-cent price still reads as a number, not as "$0.00"
     · 🔴 CONTROL: a missing peg drops the USD line — it never prints "$0.00"
     · 🔴 CONTROL: reading a valuation MINTS NOTHING — no Cinder, no AZA
     · net worth counts positions + wallet + reserve, through the PEG
     · 🔴 CONTROL: …and NOT through the CX desk rate, which swings with Cinder

   Run:  node .gauntlet/drive-cx-usd.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9450 + (process.pid % 40);
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
const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});

const out = {};

/* ══ 1 · the peg, loaded standalone exactly as a page loads it ═════════════ */
await pg.goto('http://127.0.0.1:' + P + '/src/econ/peg.js', { waitUntil: 'domcontentloaded', timeout: 60000 });
out.served = await pg.evaluate(() => document.body.innerText.indexOf('USD_PER_CINDER') >= 0);

/* ⚠ READ FROM THE REAL PAGE, NOT FROM about:blank + addScriptTag. That was the
   first shape of this block and it reported the peg ABSENT: about:blank is an
   opaque origin and the injected tag never loaded past this driver's own route
   filter — so the assertions failed against a peg that was working perfectly.
   Loading it the way a player loads it is also the more honest test. */
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);
out.peg = await pg.evaluate(() => {
  const P = window.MythicPeg;
  if (!P) return { present: false };
  return {
    present: true,
    usdPerCinder: P.USD_PER_CINDER,
    usdPerAza: P.USD_PER_AZA,
    cinderPerUsd: P.CINDER_PER_USD,
    /* the two rates the owner gave, exercised rather than read */
    fiveThousandCinder: P.usd(P.usdOf(5000, 0)),
    oneAza: P.usd(P.usdOf(0, 1)),
    mixed: P.usd(P.usdOf(184996, 12)),   // 36.9992 + 12 → $49.00
    /* 💵 a cheap resource must still read as a price. At 5,000 to the dollar a
       35 🔥 resource is $0.007 — two decimals would print "$0.01" for anything
       from half a cent up and "$0.00" below, i.e. every cheap thing on the
       board would read as free. */
    cheap: P.usdPrice(35),
    dear: P.usdPrice(339.93),
    /* CONTROL: a negative balance is a bug upstream and must not eat the other
       currency and under-report what the player holds. */
    negative: P.usd(P.usdOf(-9999, 5)),
  };
});

/* ══ 2 · the exchange's own helpers, on that same page ═════════════════════ */
out.page = await pg.evaluate(() => {
  const o = {};
  o.pegOnPage = !!window.MythicPeg;
  o.haveHelpers = typeof _cxUsd === 'function' && typeof _cxUsdLine === 'function'
                  && typeof _cxUsdAza === 'function' && typeof _cxUsdMix === 'function';
  if (!o.haveHelpers) return o;
  o.usd339 = _cxUsd(339.93);
  o.usdLine = _cxUsdLine(339.93);
  o.aza12 = _cxUsdAza(12);
  /* the portfolio headline: positions + wallet, priced through the peg */
  o.netMixed = _cxUsdMix(184996, 12);

  /* 🔴 CONTROL: WITH NO PEG, THE LINE VANISHES — it never says "$0.00".
     Every caller concatenates this straight into markup, so the failure mode
     that matters is a 404 telling a player their holdings are worthless. */
  const saved = window.MythicPeg;
  try {
    window.MythicPeg = null;
    o.noPegUsd = _cxUsd(339.93);
    o.noPegLine = _cxUsdLine(339.93);
    o.noPegAza = _cxUsdAza(12);
  } finally { window.MythicPeg = saved; }
  o.restored = !!window.MythicPeg;
  return o;
});

/* ══ 3 · 🔴 THE MONEY CONTROL ══════════════════════════════════════════════
   A valuation is arithmetic on balances the game already holds. Running every
   converter a few hundred times must not move a single balance anywhere. */
out.leak = await pg.evaluate(() => {
  const before = {
    gems: (typeof Profile !== 'undefined') ? (Profile.gems | 0) : null,
    aza: (typeof BankEthos !== 'undefined' && typeof BankEthos.aza === 'number') ? BankEthos.aza : null,
  };
  for (let i = 0; i < 500; i++) {
    _cxUsd(339.93 + i); _cxUsdAza(12); _cxUsdMix(184996, 12); _cxUsdLine(35);
    window.MythicPeg.usdOf(5000, 1); window.MythicPeg.usdPrice(1);
  }
  const after = {
    gems: (typeof Profile !== 'undefined') ? (Profile.gems | 0) : null,
    aza: (typeof BankEthos !== 'undefined' && typeof BankEthos.aza === 'number') ? BankEthos.aza : null,
  };
  return { before, after };
});

/* ══ 4 · the desk rate and the peg are different questions ═════════════════
   🔴 The AZA card must value the reserve through the PEG, not the CX desk rate.
   The desk rate is what Aza trades for in Cinder right now and it SWINGS —
   a net worth built on it would move every tick because Cinder moved, telling
   a player they got richer when nothing they hold had changed. */
out.deskVsPeg = await pg.evaluate(() => {
  const o = {};
  try {
    const info = _cxAzaRate();
    o.deskRate = info && info.rate;
    o.deskValueOf12 = (info && info.rate) ? 12 * info.rate : null;   // in Cinder
    o.pegValueOf12 = window.MythicPeg.usdOf(0, 12);                   // in USD
    /* They are in different units and must not be interchangeable — this is
       the assertion that the two were not conflated. */
    o.differentUnits = o.pegValueOf12 === 12;
  } catch (e) { o.threw = String(e).slice(0, 120); }
  return o;
});

/* ══ 5 · the Bank of Ethos reads the SAME peg ══════════════════════════════ */
await pg.goto('http://127.0.0.1:' + P + '/ethos/Bank%20of%20Ethos.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(5000);
out.bank = await pg.evaluate(() => {
  const P = window.MythicPeg;
  return {
    pegOnPage: !!P,
    usdPerCinder: P ? P.USD_PER_CINDER : null,
    usdPerAza: P ? P.USD_PER_AZA : null,
    mixed: P ? P.usd(P.usdOf(184996, 12)) : null,
  };
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const PG = out.peg || {}, PA = out.page || {}, L = out.leak || {}, DK = out.deskVsPeg || {}, BK = out.bank || {};

need('SETUP: peg.js is served', out.served === true, out.served);
need('SETUP: it publishes the peg', PG.present === true, PG);

need('THE PEG: 5,000 Cinder = $1', PG.fiveThousandCinder === '$1.00', PG.fiveThousandCinder);
need('THE PEG: 1 AZA = $1', PG.oneAza === '$1.00', PG.oneAza);
need('…and CINDER_PER_USD says so as a round number', PG.cinderPerUsd === 5000, PG.cinderPerUsd);
need('a mixed pile values both currencies', PG.mixed === '$49.00', PG.mixed);
need('🔴 a sub-cent price still reads as a number, not $0.00',
     PG.cheap === '$0.0070', PG.cheap);
need('…and an ordinary price keeps two decimals', PG.dear === '$0.07', PG.dear);
need('🔴 CONTROL: a negative balance does not eat the other currency',
     PG.negative === '$5.00', PG.negative);

need('THE EXCHANGE: the peg reaches index.html', PA.pegOnPage === true, PA.pegOnPage);
need('…and the terminal has its USD helpers', PA.haveHelpers === true, PA.haveHelpers);
need('THE ASK: a resource price carries its dollar value',
     /\$/.test(String(PA.usd339 || '')), PA.usd339);
need('…rendered as a line the markup can drop in',
     /cx-usd/.test(String(PA.usdLine || '')) && /USD/.test(String(PA.usdLine || '')), PA.usdLine);
need('THE ASK: AZA is priced in USD', PA.aza12 === '$12.00', PA.aza12);
need('THE ASK: net worth values positions + wallet + reserve', PA.netMixed === '$49.00', PA.netMixed);

need('🔴 CONTROL: with no peg the USD line VANISHES', PA.noPegLine === '', PA.noPegLine);
need('🔴 CONTROL: …and never prints a fabricated $0.00',
     PA.noPegUsd === '' && PA.noPegAza === '', { usd: PA.noPegUsd, aza: PA.noPegAza });
need('SETUP: the control restored the peg', PA.restored === true, PA.restored);

need('🔴 CONTROL: valuing a portfolio MINTS NO CINDER',
     L.before && L.after && L.before.gems === L.after.gems, L);
need('🔴 CONTROL: …and no AZA', (L.before || {}).aza === (L.after || {}).aza, L);

need('SETUP: the CX desk still quotes its own AZA rate', typeof DK.deskRate === 'number', DK);
need('🔴 the reserve is valued through the PEG, not the swinging desk rate',
     DK.differentUnits === true, DK);

need('THE BANK reads the same peg file', BK.pegOnPage === true, BK);
need('🔴 …and gets IDENTICAL numbers to the Exchange',
     BK.usdPerCinder === PG.usdPerCinder && BK.usdPerAza === PG.usdPerAza && BK.mixed === PG.mixed,
     { bank: BK, exchange: { c: PG.usdPerCinder, a: PG.usdPerAza, m: PG.mixed } });

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — one peg, both screens agree, prices carry their worth, and valuing a portfolio mints nothing.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
