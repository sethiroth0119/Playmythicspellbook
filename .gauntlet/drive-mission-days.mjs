/* ══════════════════════════════════════════════════════════════════════════
   🕛 DRIVE-MISSION-DAYS — one day, 24 real hours, the same for everyone.

   Asked for: "Make the day actually connect to everyone so one day is 24 real
   hours since it is multiplayer. Instead of spending a day, spend fuel — 2
   fuel for each move. Instead, the day gives the chance for the map to change
   collectively."

   🔴 WHAT THIS PINS, AND WHY IT IS THE WHOLE POINT. The day used to be a
      PRIVATE counter on each train that ticked when its owner travelled — so
      your day 14 and someone else's day 3 were both true and neither meant
      anything to the other. In a city everyone raids, "day 6 in Ethos Heights"
      has to mean ONE thing. The day is the world's now, derived from real time
      on the server, and the daily rollover is when the factions push — for
      everybody, at the same moment, to the same new board.

   🔴 AND TRAVEL CAN NO LONGER TOUCH IT. A move costs fuel. If it still spent a
      day, one player riding back and forth would drag a clock every other
      player is reading. What a crossing turns up is INTELLIGENCE — where a
      faction is massing — which cannot be farmed and is worth more than a
      private nudge nobody else can see.

   ⚠ THE RATES ARE PER DAY AND MIRRORED IN poi.js. Six 4-hour ticks at 4–9 was
     ~24–54 a day; one daily tick at the old rate would have frozen the city.
     drive-mission-coop compares the two sides and fails on drift.

   Run:  node .gauntlet/drive-mission-days.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9720 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};
{
  const sql = fs.existsSync('sql/042_mission_day.sql') ? fs.readFileSync('sql/042_mission_day.sql', 'utf8') : '';
  const enc = fs.readFileSync(path.join(ROOT, 'src', 'missions', 'encounters.js'), 'utf8');
  const st  = fs.readFileSync(path.join(ROOT, 'src', 'missions', 'state.js'), 'utf8');
  const tr  = fs.readFileSync(path.join(ROOT, 'src', 'missions', 'train.js'), 'utf8');
  out.src = {
    migrationExists: !!sql,
    /* 🔴 86400 = one real day. The tick used to run on 14400 (4h). */
    tickIsOneRealDay: /86400/.test(sql) && !/14400/.test(sql),
    /* ⚠ the clock advances by WHOLE DAYS, not to now() — setting it to now()
       would discard the rest of the current day every time somebody opened the
       map, and the "daily" event would drift later for ever. */
    clockAdvancesInWholeDays: /last_tick = last_tick \+ \(v_owed \* interval '1 day'\)/.test(sql),
    /* 🔴 the encounter RPC is GONE, not merely uncalled: a SECURITY DEFINER
       function that can write to the pressure ledger and is called by nothing
       is an attack surface with no upside. */
    encounterRpcDropped: /drop function if exists public\.mission_encounter/.test(sql),
    /* ⚠ A CALL, NOT A MENTION. This matched the bare name and went red on the
       comment that explains why the function was dropped — the same trap a gate
       marker hit earlier in this module, where prose quoting a literal made the
       count wrong. What matters is that nothing INVOKES it. */
    clientNeverCallsIt: !/rpc\(\s*'mission_encounter'/.test(enc),
    /* the client mirrors 24h for its offline board */
    clientDayIs24h: /const DAY_MS    = 24 \* 60 \* 60 \* 1000;/.test(st),
    clientTickIsADay: /const TICK_MS   = DAY_MS;/.test(st),
    /* a move costs fuel and nothing else */
    hopCost: (tr.match(/HOP_COST: (\d+)/) || [])[1] ? +tr.match(/HOP_COST: (\d+)/)[1] : null,
    moveSpendsNoDay: !/t\.day\+\+/.test(tr),
  };
}
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1440, height: 950 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);

out.day = await pg.evaluate(async () => {
  const o = {};
  const M = window.MythicMissions;
  const calls = [];
  /* a server board on day 9, with the day boundary two hours ago */
  const started = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  Cloud.ready = true;
  Cloud.client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'mission_tick') return { data: { day: 9, lastTick: started, sites: [{ site: 'harlem', faction: 'scum', grip: 44 }] }, error: null };
    return { data: null, error: null };
  } };
  window.isAdmin = () => false;
  M.state.debugReset(); M.train.debugPark('chelsea'); M.train.debugFuel(9);
  App.screen = 'rlcList'; M.select('village'); render();
  await new Promise(x => setTimeout(x, 1400));

  /* 🔴 THE DAY IS THE SERVER'S, not the train's */
  o.sharedDay = M.state.day();
  o.hudShowsSharedDay = /Day\s*9/.test((document.querySelector('.msn-hud') || {}).textContent || '');
  /* …and it counts down to the next one, about 22h from a boundary 2h ago */
  o.minsToNextDay = Math.round(M.state.msToNextDay() / 60000);
  o.countdownShown = /next in/.test((document.querySelector('.msn-hud') || {}).textContent || '');

  o.buttonSaysFuelOnly = (() => {
    const t = (document.getElementById('msn-move') || {}).textContent || '';
    return /fuel/.test(t) && !/day/i.test(t);
  })();

  const fuelBefore = M.train.fuel();
  const mv = document.getElementById('msn-move');
  o.hasMove = !!mv;
  if (mv) mv.click();
  await new Promise(x => setTimeout(x, 900));
  o.fuelSpent = fuelBefore - M.train.fuel();
  o.movedTo = M.train.at();
  /* 🔴 the shared day must NOT have moved because one player travelled */
  o.dayAfterMove = M.state.day();
  /* the crossing is still narrated, and stays on screen */
  o.logMentionsTheDay = /Day 9/.test((document.querySelector('.msn-log') || {}).textContent || '');
  M.select('harlem'); render(); await new Promise(x => setTimeout(x, 400));
  M.select('chelsea'); render(); await new Promise(x => setTimeout(x, 400));
  o.logSurvivesRerender = /Day 9/.test((document.querySelector('.msn-log') || {}).textContent || '');
  o.journalLength = M.state.journal().length;

  /* 🔴 NOTHING A CROSSING DOES REACHES THE SHARED LEDGER ANY MORE */
  o.rpcNames = Array.from(new Set(calls.map(c => c.name)));
  o.noEncounterRpc = !calls.some(c => c.name === 'mission_encounter');
  o.clientHasNoApplyPush = (typeof M.encounters.applyPush === 'undefined');
  return o;
});
/* the crossing table itself: quiet is common, fuel moves, and sightings name
   a real district — exercised 400 times, which is only possible because this
   module owns no state and writes nothing. */
out.table = await pg.evaluate(async () => {
  const M = window.MythicMissions;
  const o = { kinds: {}, fuelMoved: 0, pushes: 0 };
  let fuel = 6;
  const ctx = {
    gripOf: M.state.gripOf, holderOf: M.state.holderOf,
    refuel: (n) => { const b4 = fuel; fuel = Math.max(0, Math.min(12, fuel + n)); return fuel - b4; },
  };
  for (let i = 0; i < 400; i++) {
    const r = M.encounters.roll(ctx);
    o.kinds[r.id] = (o.kinds[r.id] || 0) + 1;
    if (r.fuel) o.fuelMoved++;
    if (r.push) { o.pushes++; o.lastPush = r.push; }
    if (!r.line) o.blankLine = true;
  }
  o.distinct = Object.keys(o.kinds).length;
  return o;
});

await pg.close(); await b.close(); srv.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.src, D = out.day || {}, T = out.table || {};

need('the migration is in the repo', S.migrationExists === true);
need('🔴 THE ASK: a day is 24 REAL HOURS', S.tickIsOneRealDay === true, S);
need('…and the clock advances in whole days, so the rollover does not drift later for ever',
     S.clockAdvancesInWholeDays === true, S);
need('…the client mirrors the same day length for its offline board',
     S.clientDayIs24h === true && S.clientTickIsADay === true, S);
need('🔴 THE ASK: a move costs 2 fuel', S.hopCost === 2, S.hopCost);
need('🔴 …and spends no day at all', S.moveSpendsNoDay === true, S);
need('🔴 the encounter write-path is DROPPED server-side, not just uncalled',
     S.encounterRpcDropped === true, S);
need('…and the client no longer references it', S.clientNeverCallsIt === true, S);

need('SETUP: the move button is there', D.hasMove === true, D);
need('🔴 THE ASK: the day shown is the SERVER\'s, shared by everyone',
     D.sharedDay === 9 && D.hudShowsSharedDay === true, D);
need('…with the time left in it, counted from the server\'s own boundary',
     D.countdownShown === true && D.minsToNextDay > 1250 && D.minsToNextDay < 1330, D.minsToNextDay);
need('…and the move button names fuel and not days', D.buttonSaysFuelOnly === true, D);
need('🔴 a move spends exactly 2 fuel', D.fuelSpent === 2, D);
need('…and the train actually moved', D.movedTo === 'village', D);
need('🔴 THE EXPLOIT THIS CLOSES: one player travelling does NOT move the shared day',
     D.dayAfterMove === 9, D);
need('🔴 …and nothing a crossing does reaches the shared ledger',
     D.noEncounterRpc === true && D.clientHasNoApplyPush === true, D.rpcNames);
need('the crossing is narrated against the shared day', D.logMentionsTheDay === true, D);
need('…and is still there two clicks later — the journal is read, not drained',
     D.logSurvivesRerender === true, D);
need('…and the journal is bounded, since it rides the profile save',
     D.journalLength > 0 && D.journalLength <= 12, D.journalLength);

need('the encounter table is varied, not one outcome', T.distinct >= 4, T.kinds);
need('…quiet is the most common single outcome, so travel is not a toll',
     (T.kinds.quiet || 0) > (T.kinds.push || 0), T.kinds);
need('…fuel genuinely moves on some crossings', T.fuelMoved > 0, T);
need('🔴 …and some crossings spot a faction massing — intelligence, not a write',
     T.pushes > 0, T);
need('every encounter says something', T.blankLine !== true, T);

need('no page errors', errs.length === 0, errs.slice(0, 3));
console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — one clock for the whole city, fuel for the train, and travel that reports rather than rewrites.');
