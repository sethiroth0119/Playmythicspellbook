/* ══════════════════════════════════════════════════════════════════════════
   ⚖ DRIVE-RICHERWEIGHT — the audit you asked for, as a failing test

   "The same 'pick one blob by weight' pattern is used elsewhere in the cloud
   restore" — this is which, and whether it can still lose things.

   AUDIT RESULT. Every _preferRicherObj() call site in index.html:
       Forge.territoryWars    authored content   (not player property)
       Forge.cinderShop       authored content   (not player property)
       Profile.fishingCorp    boats, crew, dock  · carries `log`, capped 60
       Profile.blackRiver     rig, crew, futures · carries `log`, capped 60
       Profile.fuelCommand    upgrades, workers  · carries `npcHist`, capped 40
   The last three are stores of things a player BOUGHT, decided by weighing the
   whole blob — the exact shape that lost the auction vehicles (a 140-line log
   at weight 6,764 beat three cars at 934).

   ⚠ CAPPED IS NOT SAFE, AND THAT IS WHAT THIS FILE PROVES. Every one of those
     logs has a length cap, so the obvious objection is that they cannot grow to
     dominate. They do not have to: log entries are variable-length STRINGS, so
     a stale copy with 60 verbose lines outweighs a fresh copy with 55 lines and
     an extra boat. The BEFORE case below is constructed from exactly that, and
     it is not contrived — it is a player who bought a boat during a quiet
     session and refreshed.

   ⚠ THIS PROVES ONE TERM WAS REMOVED, NOT THAT THE STORES ARE SAFE. Weighing
     is still weighing. The last section states the residual risk as a check
     that DELIBERATELY PASSES while documenting what is still not merged, so
     nobody reads a green run as "the audit is closed".

   Run:  node .gauntlet/drive-richerweight.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const P = 8700 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 170)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _preferRicherObj === "function" && typeof _approxDataWeight === "function"',
  null, { timeout: 120000 });

const r = await pg.evaluate(() => {
  const o = {};

  /* A quiet session's log — short lines. And a chatty one — long lines. Both
     inside the shipped 60-entry cap, because the cap is not the problem. */
  const quietLog = Array.from({ length: 55 }, (_, i) => ({ ts: 1, level: 'info', msg: 'tick ' + i }));
  const chattyLog = Array.from({ length: 60 }, (_, i) => ({
    ts: 1, level: 'event',
    msg: 'Expedition ' + i + ' returned to the slip with a full hold after a long haul out past the shoals',
  }));

  const boat = (id) => ({ id, name: 'Trawler ' + id, hull: 100, cargo: 60, crew: [1, 2, 3], upgrades: { net: 2, sonar: 1 } });

  // FRESH: fewer log lines, one MORE boat — the player just bought it.
  const fresh = { owned: true, dockLevel: 3, boats: [boat('a'), boat('b'), boat('c')], crew: [], log: quietLog };
  // STALE: the cloud row from before the purchase, from a chattier session.
  const stale = { owned: true, dockLevel: 3, boats: [boat('a'), boat('b')], crew: [], log: chattyLog };

  o.wFresh = _approxDataWeight(fresh, 0);
  o.wStale = _approxDataWeight(stale, 0);

  /* The BEFORE number, computed with a local copy of the ORIGINAL function so
     the regression is measured rather than remembered. If this ever stops
     showing the stale copy as heavier, the scenario has drifted and the test
     below is no longer proving anything. */
  const weighOld = (v, d) => {
    if (v == null) return 0;
    const t = typeof v;
    if (t === 'string') return v.length;
    if (t === 'number') return 8;
    if (t === 'boolean') return 4;
    if (t !== 'object') return 0;
    if ((d || 0) > 6) return 0;
    let w = 0;
    if (Array.isArray(v)) { for (const x of v) w += weighOld(x, (d || 0) + 1); return w; }
    for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) w += k.length + weighOld(v[k], (d || 0) + 1);
    return w;
  };
  o.oldFresh = weighOld(fresh, 0);
  o.oldStale = weighOld(stale, 0);
  o.oldWouldPickStale = o.oldStale > o.oldFresh;

  const picked = _preferRicherObj(stale, fresh);   // (incoming=cloud, current=local)
  o.pickedBoats = (picked.boats || []).map(x => x.id);
  o.keptTheBoat = o.pickedBoats.length === 3;
  // …and the winner is returned WHOLE — the log is skipped from the weighing,
  // not stripped from the data.
  o.winnerKeepsItsLog = Array.isArray(picked.log) && picked.log.length > 0;

  // The other two stores, same shape, their own log key names.
  const brFresh = { owned: true, crude: 10, crew: [1, 2, 3], truck: { hp: 100 }, log: quietLog };
  const brStale = { owned: true, crude: 10, crew: [1, 2], truck: { hp: 100 }, log: chattyLog };
  o.brKept = (_preferRicherObj(brStale, brFresh).crew || []).length === 3;

  const fcFresh = { owned: true, workers: 5, upgrades: { pump: 3, tanks: 2 }, npcHist: [1, 2, 3] };
  const fcStale = { owned: true, workers: 3, upgrades: { pump: 3 },
                    npcHist: Array.from({ length: 40 }, () => 88.123456789) };
  o.fcKept = (_preferRicherObj(fcStale, fcFresh).workers | 0) === 5;

  // CONTROL — with the chatter equal, real content still decides, and the
  // genuinely richer copy still wins. Skipping keys must not break the compare.
  const sameLog = quietLog;
  const poor = { boats: [boat('a')], log: sameLog };
  const rich = { boats: [boat('a'), boat('b'), boat('c'), boat('d')], log: sameLog };
  o.richStillWins = (_preferRicherObj(poor, rich).boats || []).length === 4;
  o.richStillWinsEitherWay = (_preferRicherObj(rich, poor).boats || []).length === 4;

  // CONTROL — an empty local copy must never beat a full cloud one (a fresh
  // device restoring). This is the direction the whole function exists for.
  o.emptyLocalLoses = (_preferRicherObj(stale, {}).boats || []).length === 2;

  /* 🔴 THE RESIDUAL RISK, asserted so it is on the record rather than in a
     comment nobody reads. Weighing is still weighing: if the STALE copy has
     more of something else, it still wins whole and the new boat is still
     lost. Per-asset union (what the Prince Portfolio got) is the only real
     fix, and these three do not have it. */
  /* ⚠ THE FIRST VERSION OF THIS DID NOT REPRODUCE and would have shipped an
       unproven claim as a passing check: eight bare crew NUMBERS do not
       outweigh a third boat, so `fresh` won and the "risk" looked closed.
       Real crew are objects with names and stats. Eight of those do outweigh
       one boat, and that is a perfectly ordinary save — a player who hired a
       crew on their phone and bought a boat on their desktop. */
  const hand = (i) => ({ id: i, name: 'Deckhand ' + i, skill: 3, morale: 70, wage: 40, hiredAt: 1, traits: ['steady'] });
  const staleRicherElsewhere = { owned: true, dockLevel: 9, boats: [boat('a'), boat('b')],
    crew: Array.from({ length: 8 }, (_, i) => hand(i)), log: quietLog };
  o.residualStaleWeight = _approxDataWeight(staleRicherElsewhere, 0);
  o.residualFreshWeight = _approxDataWeight(fresh, 0);
  o.stillLosesWhenOutweighedElsewhere =
    (_preferRicherObj(staleRicherElsewhere, fresh).boats || []).length === 2;

  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{2696} PICK-BY-WEIGHT · THE OTHER THREE STORES\n');
console.log('  ── the scenario: a boat bought during a quiet session, then a refresh');
ok('\u{1F3AF} the OLD weighing picked the stale copy (the defect, measured)',
  r.oldWouldPickStale === true, 'stale ' + r.oldStale + ' vs fresh ' + r.oldFresh);
ok('…chatter no longer counts toward the weight', r.wFresh > r.wStale,
  'fresh ' + r.wFresh + ' vs stale ' + r.wStale);
ok('\u{1F3AF} the boat survives the refresh', r.keptTheBoat === true, JSON.stringify(r.pickedBoats));
ok('the winner is returned WHOLE — its log is not stripped', r.winnerKeepsItsLog === true);

console.log('\n  ── the same defect in the other two stores');
ok('\u{1F3AF} Black River keeps the third crew member', r.brKept === true);
ok('\u{1F3AF} Fuel Command keeps the workers and the upgrade', r.fcKept === true);

console.log('\n  ── CONTROLS · skipping keys must not break the comparison');
ok('the genuinely richer copy still wins', r.richStillWins === true);
ok('…in either argument order', r.richStillWinsEitherWay === true);
ok('an empty local copy still loses to a full cloud one', r.emptyLocalLoses === true);

console.log('\n  ── RESIDUAL RISK, on the record');
ok('\u{1F534} a stale copy that outweighs on OTHER fields STILL wins whole — ' +
   'these three want per-asset union like the Portfolio got',
  r.stillLosesWhenOutweighedElsewhere === true,
  'stale ' + r.residualStaleWeight + ' vs fresh ' + r.residualFreshWeight + ' — this check PASSING is the open issue, not a fix');

console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
