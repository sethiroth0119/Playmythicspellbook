/* ══════════════════════════════════════════════════════════════════════════
   👥 DRIVE-CITY-POP — the node's population becomes the city's real one.

   Reported: "make it where cities match actual population and vital signs
   match their node stats, so players can actually see how many people they
   have in their city — make it 1 to 1."

   NPC POPULATION was a 200,000 baseline bled daily by corruption: a
   simulation with no connection to any city. /src/city/population.js has known
   the true figure since it shipped — every person accountable to a birth, an
   arrival, a death or a departure — and it was never told to anyone.

   🔴 THE TRAP THIS DRIVER EXISTS TO PIN. CIVILIZATION is population/capacity,
      TRADE STABILITY is derived from CIVILIZATION, and trade stability SCALES
      THE RESOURCE PAYOUT every registered player collects from the node. Send
      the real population WITHOUT the real capacity and ~400 people sit over a
      fictional 200,000 — civilization reads 0 on every node in the game and
      everyone's income quietly goes to nothing. The naive arm below is that
      exact build, and it is MEASURED, not argued.

   Run:  node .gauntlet/drive-city-pop.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml' };
const P = 9600 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};

/* ── the source-level contract ───────────────────────────────────────────── */
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nc = fs.readFileSync(path.join(ROOT, 'node-city', 'index.html'), 'utf8');
  const sql = fs.existsSync('sql/039_city_pop.sql') ? fs.readFileSync('sql/039_city_pop.sql', 'utf8') : '';
  const body = sql.split('-- ROLLBACK')[0] || '';
  out.src = {
    migrationExists: !!sql,
    /* 🔴 ADDITIVE ONLY — above the ROLLBACK block there must be no drop of a
       table or column, because `population`, `civilians_total` and `residents`
       are still what every node WITHOUT a city runs on. */
    migrationDropsNothing: !!sql && !/drop\s+(table|column)/i.test(body),
    rpcSumsBoth: /sum\(pop\)[\s\S]{0,80}sum\(cap\)/.test(sql),
    cityReportsBoth: /cityPop: _cityPop, cityCap: _cityCap,/.test(nc),
    hostPushes: /rpc\('tw_set_city_pop'/.test(idx),
    /* 🔴 the mayor double-count guard */
    ownerGuard: /if \(App\._cityOwnerId && me && App\._cityOwnerId !== me\) return;/.test(idx),
    /* the card must NOT repoint _popMax — CIVILIANS SHELTERED shares it */
    separateLiveNames: /const _liveMax  = _hasCity/.test(idx) && /const _popMax = _rc\.civiliansTotal/.test(idx),
    /* 🔴 THE CRASH THIS NEARLY SHIPPED, AND WHY IT IS CHECKED STATICALLY.
       _liveMaxTxt and _liveFoot call _fmtN, a `const` arrow declared 88 lines
       further down the SAME function. Computing them beside the other _live*
       values threw "Cannot access '_fmtN' before initialization" — a temporal
       dead zone error that takes the ENTIRE Territory Wars screen down.
       render() catches the throw and keeps the last good screen, so it does
       not look like a crash: it looks like a dead button.
       ⚠ THE ARITHMETIC ARMS BELOW PASSED CLEAN THROUGH IT, because they call
         _twNodeCivilization directly and never render the drawer. And the
         drawer cannot be rendered from here — renderTerritoryWars returns a
         9-byte stub when signed out — which is why this is an ordering check
         on the source rather than a render assertion. It is the weaker test.
         It is also the one that actually catches this. */
    fmtNDeclaredFirst: (() => {
      const d = idx.indexOf('const _fmtN = (v) =>');
      const a = idx.indexOf('const _liveMaxTxt = _hasCity');
      const c = idx.indexOf('const _liveFoot = _hasCity');
      return d > 0 && a > d && c > d;
    })(),
  };
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(5000);

out.math = await pg.evaluate(() => {
  const mk = (extra) => ({ id: 'T', recon: Object.assign({
    civiliansTotal: 200000, population: 100000, corruption: 30,
    buildingsRestored: 0, buildingsTotal: 48, roadsRepaired: 0, roadsTotal: 60,
  }, extra || {}) });
  const o = {};
  /* CONTROL — a node nobody has built on behaves EXACTLY as before. */
  o.civNoCity = _twNodeCivilization(mk());
  o.tradeNoCity = _twNodeTradeStability(mk());
  /* the fix — 412 real people in 460 real homes */
  o.civWithCity = _twNodeCivilization(mk({ cityPop: 412, cityCap: 460 }));
  /* 🔴 THE NAIVE BUILD — real numerator, fictional denominator. This is what
     "just show the real population" would have shipped to every live node. */
  o.civNaive = _twNodeCivilization(mk({ population: 412 }));
  /* the recon shape carries the pair through */
  const r = _twNodeRecon(mk({ cityPop: 412, cityCap: 460 }));
  o.carriedPop = r.cityPop; o.carriedCap = r.cityCap;
  /* …and a node with no city carries zeroes, which is what makes the fallback
     above reachable at all rather than dead code */
  const r0 = _twNodeRecon(mk());
  o.zeroPop = r0.cityPop; o.zeroCap = r0.cityCap;
  /* full is full — an overfull city cannot read past its own capacity */
  o.civFull = _twNodeCivilization(mk({ cityPop: 460, cityCap: 460 }));
  o.civOver = _twNodeCivilization(mk({ cityPop: 9999, cityCap: 460 }));
  return o;
});

/* 🔴 THE MAYOR DOUBLE-COUNT GUARD, exercised rather than read. */
out.guard = await pg.evaluate(async () => {
  const calls = [];
  const o = {};
  if (!window.Cloud) window.Cloud = {};
  Cloud.ready = true;
  Cloud.client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: null }; } };
  window.Profile = window.Profile || {};
  Profile.cloud = { userId: 'me-111' };
  App._cityNodeId = 'N-99';

  /* my own city → it counts */
  App._cityOwnerId = null;
  _cityPopPushAt = 0;
  await _twPushCityPop({ cityPop: 412, cityCap: 460 });
  o.ownCityPushed = calls.length;

  /* a client's city opened by a mayor → it must NOT be filed under the mayor,
     or the RPC's SUM counts the same people twice */
  App._cityOwnerId = 'someone-else-222';
  _cityPopPushAt = 0;
  await _twPushCityPop({ cityPop: 999, cityCap: 999 });
  o.afterMayorOpen = calls.length;

  /* …and back on my own city it resumes */
  App._cityOwnerId = 'me-111';
  _cityPopPushAt = 0;
  await _twPushCityPop({ cityPop: 413, cityCap: 460 });
  o.afterMineAgain = calls.length;
  o.lastArgs = calls.length ? calls[calls.length - 1].args : null;

  /* the throttle holds */
  await _twPushCityPop({ cityPop: 414, cityCap: 460 });
  o.afterImmediateRepeat = calls.length;
  return o;
});

await pg.close(); await b.close(); srv.close();

/* ── the judgement ───────────────────────────────────────────────────────── */
const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.src, X = out.math || {}, G = out.guard || {};

need('the migration is in the repo', S.migrationExists === true);
need('🔴 it is additive — it drops nothing the old model still uses', S.migrationDropsNothing === true);
need('the RPC sums BOTH people and homes', S.rpcSumsBoth === true);
need('THE ASK: the city reports its real population AND its capacity', S.cityReportsBoth === true);
need('…and the host pushes them to the shared node row', S.hostPushes === true);
need('🔴 the mayor double-count guard is present', S.ownerGuard === true);
need('the card does not repoint _popMax (CIVILIANS SHELTERED shares it)', S.separateLiveNames === true);
need('🔴 _fmtN is declared BEFORE the values that call it (temporal dead zone)',
     S.fmtNDeclaredFirst === true, S.fmtNDeclaredFirst);

need('the recon shape carries people and homes through',
     X.carriedPop === 412 && X.carriedCap === 460, X);
need('CONTROL: a node with no city carries zeroes, so the fallback is reachable',
     X.zeroPop === 0 && X.zeroCap === 0, X);
need('🔴 CONTROL: a node nobody built on is UNCHANGED by all of this',
     X.civNoCity === 41 && X.tradeNoCity > 0, X);
need('THE ASK: a real city measures its real people against its real homes',
     X.civWithCity > 60 && X.civWithCity < 85, X.civWithCity);
/* 🔴 THE ONE THAT JUSTIFIES THE WHOLE DESIGN. */
need('🔴 THE TRAP: real people over the FICTIONAL denominator collapse to 0 — '
   + 'which is why capacity had to travel with population',
     X.civNaive === 0, X.civNaive);
need('…and the honest pair is dramatically higher on the SAME 412 people',
     X.civWithCity > X.civNaive + 50, { real: X.civWithCity, naive: X.civNaive });
need('an overfull city cannot read past its own capacity', X.civOver === X.civFull, X);

need('SETUP: my own city pushes', G.ownCityPushed === 1, G);
need('🔴 a mayor opening a CLIENT city files nothing under the mayor',
     G.afterMayorOpen === 1, G);
need('…and my own city resumes afterwards', G.afterMineAgain === 2, G);
need('…with the real figures on the wire',
     !!G.lastArgs && G.lastArgs.p_pop === 413 && G.lastArgs.p_cap === 460, G.lastArgs);
need('the push is throttled', G.afterImmediateRepeat === 2, G);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — the node counts the city real people against its real homes, and a node with no city is untouched.');
