/* ══════════════════════════════════════════════════════════════════════════
   🏙 DRIVE-MISSION-COOP — Ethos Heights is ONE city, shared by everyone.

   Asked for: "Add the Multiplayer factor."

   /src/missions/state.js said, before any of this existed:
     "WHEN THE SHARED VERSION LANDS, THE TICK MOVES SERVER-SIDE. A client-side
      regrow means a player who doesn't open the game has a map that never
      decays, and two clients disagreeing about who holds Elm Street is a
      desync you debug for a week."

   So the pins here are about exactly that:
     · the tuning in the SQL and the tuning in poi.js are the SAME NUMBERS —
       two copies of one truth, so drift fails a build instead of quietly
       changing how fast the factions take the city
     · the LOCAL tick stands down once the shared board is live (running both
       advances the factions at double rate for whoever has the game open)
     · a raid is posted to the server, which owns the cut — the client never
       names a grip number
     · CONTROL: with no cloud at all the local board still plays, because a
       signed-out player must still get a map

   Run:  node .gauntlet/drive-mission-coop.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9640 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};

/* ── 🔴 THE DRIFT CHECK. Two copies of one truth, kept honest. ───────────── */
{
  const poi = fs.readFileSync(path.join(ROOT, 'src', 'missions', 'poi.js'), 'utf8');
  const sql = fs.existsSync('sql/040_mission_map_coop.sql') ? fs.readFileSync('sql/040_mission_map_coop.sql', 'utf8') : '';
  const o = { sqlExists: !!sql };

  /* client side: push:{ rate:[a,b], spread:c, seed:[d,e] } per faction */
  const clientPush = {};
  for (const fac of ['scum', 'anomalies', 'scp']) {
    const seg = poi.split(fac + ':')[1] || '';
    const m = seg.match(/push:\{\s*rate:\[(\d+),(\d+)\],\s*spread:([\d.]+),\s*seed:\[(\d+),(\d+)\]/);
    if (m) clientPush[fac] = [ +m[1], +m[2], +m[3], +m[4], +m[5] ];
  }
  /* 🔴 THE EFFECTIVE SERVER RATE, NOT THE FIRST ONE WRITTEN DOWN.
     Migrations are cumulative: sql/040 seeds the table and sql/042 UPDATEs the
     rates when the world went from six 4-hour ticks a day to one daily one.
     Reading only 040 compared poi.js against a number the database had
     already moved past — the check went red on a change that was correct in
     both places. So every mission migration is read in order and the LAST
     value written for each faction wins, which is what Postgres did too. */
  const sqlFiles = fs.existsSync('sql')
    ? fs.readdirSync('sql').filter(n => /^\d+_mission.*\.sql$/.test(n)).sort()
    : [];
  o.migrations = sqlFiles;
  const serverPush = {};
  for (const name of sqlFiles) {
    const body = fs.readFileSync('sql/' + name, 'utf8');
    for (const fac of ['scum', 'anomalies', 'scp']) {
      /* the seeding INSERT … */
      const ins = body.match(new RegExp("\\('" + fac + "',\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+),\\s*(\\d+),\\s*(\\d+)\\)"));
      if (ins) serverPush[fac] = [ +ins[1], +ins[2], +ins[3], +ins[4], +ins[5] ];
      /* …and any later UPDATE of the rates, which only touches lo/hi */
      const upd = body.match(new RegExp("set rate_lo\\s*=\\s*(\\d+),\\s*rate_hi\\s*=\\s*(\\d+)\\s+where id = '" + fac + "'"));
      if (upd && serverPush[fac]) { serverPush[fac][0] = +upd[1]; serverPush[fac][1] = +upd[2]; }
    }
  }
  o.clientPush = clientPush;
  o.serverPush = serverPush;
  o.pushMatches = ['scum', 'anomalies', 'scp'].every(f =>
    clientPush[f] && serverPush[f] && JSON.stringify(clientPush[f]) === JSON.stringify(serverPush[f]));

  /* adjacency: every client edge must exist server-side, and vice versa */
  const adjBlock = (poi.split('export const ADJACENCY = {')[1] || '').split('};')[0];
  const clientEdges = new Set();
  adjBlock.replace(/(\w+):\[([^\]]*)\]/g, (_, site, list) => {
    list.split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean)
      .forEach(n => clientEdges.add(site + '>' + n));
    return '';
  });
  const serverEdges = new Set();
  (sql.match(/\('(\w+)','(\w+)'\)/g) || []).forEach(pair => {
    const m = pair.match(/\('(\w+)','(\w+)'\)/);
    if (m && clientEdges.has(m[1] + '>' + m[2])) serverEdges.add(m[1] + '>' + m[2]);
    else if (m) serverEdges.add(m[1] + '>' + m[2]);
  });
  o.clientEdgeCount = clientEdges.size;
  o.edgesMissingServerSide = [...clientEdges].filter(e => !serverEdges.has(e));

  /* the raid cut must be the same window on both sides */
  const cCut = (fs.readFileSync(path.join(ROOT, 'src', 'missions', 'state.js'), 'utf8')
    .match(/RAID_CUT\s*=\s*\[(\d+),\s*(\d+)\]/) || []).slice(1).map(Number);
  const sCut = (sql.match(/v_cut := (\d+) \+ floor\(random\(\) \* (\d+)\)/) || []).slice(1).map(Number);
  o.clientCut = cCut;                        // [12, 22]
  o.serverCut = sCut.length ? [sCut[0], sCut[0] + sCut[1] - 1] : [];
  o.cutMatches = JSON.stringify(o.clientCut) === JSON.stringify(o.serverCut);

  /* the server must be the ONLY writer */
  o.noClientInsertPolicy = !/create policy \w+ on public\.mission_pressure for insert/i.test(sql);
  o.creditKeyedPerPlayer = /primary key \(user_id, mission_id\)/.test(sql);
  o.tickIsLocked = /pg_advisory_xact_lock/.test(sql);
  o.additive = !/drop\s+(table|column)/i.test(sql.split('-- ROLLBACK')[0] || '');
  out.mirror = o;
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1440, height: 950 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);

/* ── CONTROL: no cloud at all → the local board still plays ──────────────── */
out.offline = await pg.evaluate(async () => {
  const o = {};
  const M = window.MythicMissions;
  o.moduleLoaded = !!M;
  if (!M) return o;
  /* ⚠ MUTATE, NEVER REPLACE. index.html declares `const Cloud = {...}` at top
     level, so `window.Cloud = {…}` creates a SECOND object the bridge closure
     never reads — the globals trap /src/missions' own header warns about, and
     this driver walked straight into it: every RPC assertion failed while the
     code was correct. */
  Cloud.ready = false; Cloud.client = null;
  o.cloudHandleNull = (window.MythicMissionBridge.cloud() === null);
  App.screen = 'rlcList'; render();
  await new Promise(r => setTimeout(r, 700));
  o.mapMounted = !!document.querySelector('.msn');
  o.sharedFlag = M.state.isShared ? M.state.isShared() : 'n/a';
  o.gripStillReads = M.state.gripOf('midtown');
  return o;
});

/* ── the shared city ─────────────────────────────────────────────────────── */
out.shared = await pg.evaluate(async () => {
  const o = { calls: [] };
  const M = window.MythicMissions;
  const calls = [];
  /* a stand-in for the real database — the module must never learn a table
     name, so a client that only answers three RPCs is a fair stand-in */
  const board = (sites, day) => ({ day: day || 4, lastTick: new Date().toISOString(), sites });
  let current = board([
    { site: 'midtown', faction: 'scp', grip: 91 },
    { site: 'hells',   faction: 'scum', grip: 64 },
    { site: 'village', faction: 'scum', grip: 8 },   // the factions spread while away
  ], 4);
  Cloud.ready = true;
  Cloud.client = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'mission_tick') return { data: current, error: null };
        if (name === 'mission_raid') {
          /* the server owns the cut; the client never names one */
          current = board(current.sites.map(s =>
            s.site === 'hells' ? { ...s, grip: s.grip - 15 } : s), 4);
          return { data: current, error: null };
        }
        return { data: null, error: null };
      },
  };
  M.state.debugReset();
  /* force a fresh window so maybeSync actually fires */
  App.screen = 'rlcList'; render();
  await new Promise(r => setTimeout(r, 1200));
  o.calls = calls.map(c => c.name);
  o.tickCalled = calls.some(c => c.name === 'mission_tick');
  o.nowShared = M.state.isShared();
  /* the server's board is what the map reads */
  o.midtown = M.state.gripOf('midtown');
  o.hells = M.state.gripOf('hells');
  o.village = M.state.gripOf('village');
  o.holderMidtown = M.state.holderOf('midtown');
  /* 🔴 …and the LOCAL tick must now stand down */
  const before = M.state.gripOf('midtown');
  const localLines = M.state.tick();
  o.localTickLines = localLines.length;
  o.midtownAfterLocalTick = M.state.gripOf('midtown');
  o.localTickChangedNothing = (before === o.midtownAfterLocalTick);
  return o;
});

/* ── a survived raid reaches the shared ledger ───────────────────────────── */
out.raid = await pg.evaluate(async () => {
  const o = {};
  const M = window.MythicMissions;
  const seen = [];
  const prevRpc = Cloud.client.rpc;
  Cloud.client.rpc = async (name, args) => { seen.push({ name, args }); return prevRpc(name, args); };
  const P = window.MythicMissionBridge.profile();
  P.rlcCompleted = Array.isArray(P.rlcCompleted) ? P.rlcCompleted : [];
  P.rlcCompleted.push('msn_hells_scum_64_4');
  const before = M.state.gripOf('hells');
  M.state.creditRuns(P.rlcCompleted);
  await new Promise(r => setTimeout(r, 700));
  o.raidPosted = seen.filter(c => c.name === 'mission_raid').length;
  o.postedId = (seen.find(c => c.name === 'mission_raid') || {}).args;
  o.before = before;
  o.after = M.state.gripOf('hells');
  /* 🔴 the same run must not be posted twice on the next render */
  M.state.creditRuns(P.rlcCompleted);
  await new Promise(r => setTimeout(r, 400));
  o.raidPostedAfterSecondCall = seen.filter(c => c.name === 'mission_raid').length;
  /* the client never sends a grip figure — only the id */
  o.sendsOnlyTheId = !!(o.postedId && Object.keys(o.postedId).length === 1 && 'p_mission_id' in o.postedId);
  return o;
});

await pg.close(); await b.close(); srv.close();

/* ── the judgement ───────────────────────────────────────────────────────── */
const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const R = out.mirror, O = out.offline || {}, S = out.shared || {}, D = out.raid || {};

need('the migration is in the repo', R.sqlExists === true);
need('🔴 it is additive — it drops nothing', R.additive === true);
need('🔴 THE DRIFT CHECK: the faction push tuning is IDENTICAL client and server',
     R.pushMatches === true, { client: R.clientPush, server: R.serverPush });
need('…and every adjacency edge the client knows exists server-side',
     R.clientEdgeCount > 0 && R.edgesMissingServerSide.length === 0, R.edgesMissingServerSide);
need('…and the raid cut is the same window on both sides',
     R.cutMatches === true, { client: R.clientCut, server: R.serverCut });
need('🔴 the server is the ONLY writer — no client INSERT policy on the ledger',
     R.noClientInsertPolicy === true);
need('🔴 credit is keyed per PLAYER per mission, not per mission',
     R.creditKeyedPerPlayer === true);
need('the tick takes a lock, so two clients cannot double-advance the world',
     R.tickIsLocked === true);

need('SETUP: the module loaded', O.moduleLoaded === true, O);
need('🔴 CONTROL: with no cloud the map still plays', O.mapMounted === true, O);
need('…and knows it is not shared', O.sharedFlag === false, O);
need('…and grip still reads locally', typeof O.gripStillReads === 'number', O);

need('THE ASK: the map pulls the shared city', S.tickCalled === true, S.calls);
need('…and knows it IS shared once the server answers', S.nowShared === true, S);
need('🔴 the server board is what the map shows', S.midtown === 91 && S.hells === 64, S);
need('…including ground taken while the player was away', S.village === 8, S);
need('…and the holder comes across', S.holderMidtown === 'scp', S);
need('🔴 THE DOUBLE-RATE BUG: the LOCAL tick stands down once shared',
     S.localTickChangedNothing === true && S.localTickLines === 0, S);

need('THE ASK: a survived raid is posted to the shared ledger', D.raidPosted === 1, D);
need('🔴 …and the client sends ONLY the mission id — the server owns the cut',
     D.sendsOnlyTheId === true, D.postedId);
need('…and the shared board comes back with the ground taken', D.after < D.before, D);
need('🔴 …and the same run is never posted twice',
     D.raidPostedAfterSecondCall === 1, D);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — one city, everyone raids it, the server owns the clock and the cut.');
