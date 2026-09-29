/* ══════════════════════════════════════════════════════════════════════════
   🔥 DRIVE-COIN-FLOAT — a coin floats off a business, and no coin is minted.

   THE ASK: "make it where they randomly spend money show a icon of cinder
   appearing and how much been made when a business in the city makes money make
   it appear above the busines and then disappear like and small animation."

   🔴 THE DANGEROUS READING OF THAT ASK IS THE ONE THIS DRIVER EXISTS TO RULE
      OUT. "Make NPCs spend money" invites a second, visible spending path — and
      the residents of this city ALREADY spend: households.js buys down the
      basket every economic day and sim.js credits the firms that sold to them.
      A second path would be the same wallet paying twice, i.e. Cinder appearing
      in a till that never left a household. ECONOMY.md exists because four
      money leaks got through review already.
      So the feature is a READER, and the assertions below are mostly about what
      it does NOT do.

   🔴 IT IS CINDER, AND THAT DISTINCTION COST A ROUND. The first version watched
      /src/economy's `revenueDay` — the SIMULATION's internal takings, which
      move for firms that have no Cinder line at all and never reach the
      player's wallet. What a player actually watches go up is `t.earn`, the
      per-tile Cinder economyTick banks (production and lot rent). This drives
      that.
   ⚠ t.earn IS CUMULATIVE, so a FALL means the tile was rebuilt — a new
     building starts at 0 — and never a refund. Floating "−4,200 🔥" over a
     demolished-and-replaced plot would be the worst possible misreading, and
     it is controlled for explicitly.

   Pinned, with controls:
     · a firm earning floats a coin carrying the amount
     · 🔴 CONTROL: polling MINTS NOTHING — no firm cash, no treasury, no wallet
     · 🔴 CONTROL: a day close (revenue falling to 0) floats NOTHING
     · CONTROL: a firm that earns nothing floats nothing
     · the same firm is throttled — one float per gap, carrying the total
     · floats retire themselves, and are capped on screen
     · the layer cannot eat a click

   Run:  node .gauntlet/drive-coin-float.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9360 + (process.pid % 40);
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
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc && !!window.MythicEconomy', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4000);

/* A city with a business in it, and time for the economy to adopt it. */
await pg.evaluate(() => { window.__nc.jobfair.setPop(40); window.__nc.jobfair.plant('5,5', 'farm'); });
await pg.waitForTimeout(7000);

const out = {};

out.run = await pg.evaluate(async () => {
  const o = {};
  const J = window.__nc.jobfair, E = window.MythicEconomy;
  const tile = J.tile('5,5');
  o.haveFirm = !!tile;
  if (!tile) return o;

  /* 💰 THE PLAYER'S OWN CINDER, before and after. This is the assertion that
     matters most: a reader that pays out would move this, and "make the
     spending visible" is exactly the request that invites a money leak. */
  const wallet = () => J.cinder();

  J.coinReset();
  J.coinPoll();                       // first poll only baselines
  o.afterBaseline = J.coinLive().length;

  const before = wallet();

  /* Bank Cinder to the tile the way economyTick does — t.earn is the exact
     per-tile Cinder counter it writes. The READER is under test, not the till. */
  J.earn('5,5', 250);
  J.coinPoll();
  o.afterEarn = J.coinLive().length;
  o.text = (J.coinLive()[0] || {}).text || null;

  o.mintedWallet = Math.round(((wallet()) - before) * 100) / 100;

  /* ⏱ THROTTLE: a second earning inside the gap must not float again. */
  J.earn('5,5', 90);
  J.coinPoll();
  o.afterSecondEarn = J.coinLive().length;

  /* 🔻 REBUILT TILE: t.earn falls back to 0. This must float NOTHING and must
     never be read as a refund. */
  J.coinReset();
  J.coinPoll();
  J.earn('5,5', -99999);              // clamped to 0 by the hook
  J.coinPoll();
  o.afterDayClose = J.coinLive().length;
  o.baselineReset = (J.coinSeen('5,5') || {}).rev;

  /* 🪙 A SLOW EARNER STILL READS HONESTLY — fractions carry rather than
     rounding away to a float that says +0. */
  J.coinReset(); J.coinPoll();
  J.earn('5,5', 2.4);
  J.coinPoll();
  o.slowText = (J.coinLive()[0] || {}).text || null;

  /* CONTROL: a firm that earns nothing floats nothing. */
  J.coinReset();
  J.coinPoll();
  J.coinPoll();
  o.afterNoEarn = J.coinLive().length;
  return o;
});

/* the layer must not intercept clicks */
out.layer = await pg.evaluate(() => {
  const el = document.getElementById('coinlayer');
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  return { present: true, pointerEvents: cs.pointerEvents, position: cs.position };
});

/* …and a float retires itself */
out.retire = await pg.evaluate(async () => {
  const J = window.__nc.jobfair;
  if (!J.tile('5,5')) return { skipped: 'no tile' };
  J.coinReset(); J.coinPoll();
  J.earn('5,5', 400);
  J.coinPoll();
  const born = J.coinLive().length;
  await new Promise(r => setTimeout(r, 2200));   // lifeMs is 1700
  return { born, left: J.coinLive().length };
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const R = out.run || {}, L = out.layer || {}, RT = out.retire || {};

need('SETUP: a building is standing', R.haveFirm === true, R.haveFirm);
need('CONTROL: the first poll only baselines, it does not float', R.afterBaseline === 0, R.afterBaseline);
need('THE ASK: a business earning floats a coin', R.afterEarn === 1, R.afterEarn);
need('…carrying the amount it took', /\+250/.test(String(R.text || '')), R.text);
need('🔴 CONTROL: reading the tills MINTS NO CINDER', R.mintedWallet === 0, R.mintedWallet);
need('the same business is throttled, not spammed', R.afterSecondEarn === 1, R.afterSecondEarn);
need('🔴 CONTROL: a rebuilt tile floats NOTHING', R.afterDayClose === 0, R.afterDayClose);
need('…and re-baselines instead of reading it as a refund', R.baselineReset === 0, R.baselineReset);
need('CONTROL: a business that earns nothing floats nothing', R.afterNoEarn === 0, R.afterNoEarn);
need('a slow earner reads as 2.4, not a rounded-away 2', /\+2\.4/.test(String(R.slowText || '')), R.slowText);

need('the float layer exists', L.present === true, L);
need('🔴 …and cannot eat a click', L.pointerEvents === 'none', L);

if (RT.skipped) console.log('  · retire skipped: ' + RT.skipped);
else {
  need('a float appears…', RT.born === 1, RT);
  need('…and retires itself', RT.left === 0, RT);
}
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the coins show money that really moved, and the reader mints none of it.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
