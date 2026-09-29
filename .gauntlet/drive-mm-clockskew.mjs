/* ══════════════════════════════════════════════════════════════════════════
   ⏱ DRIVE-MM-CLOCKSKEW — the matchmaking client stops poisoning its own queue

   Three client-side defects, all provable without a server:

     1. cloudEnterMatchmaking() used to send `queued_at: new Date()...` on the
        INSERT, overriding the column's server `default now()`. queued_at is
        the column try_pair_match sorts on (`order by queued_at asc`) and the
        one sql/066 ages rows out on, so a device clock decided queue position
        for everyone. Checked statically — the key is simply gone.

     2. _startMatchmakingPoll() gated match pickup on
        `.gte('created_at', <device clock − 4s>)`. Four seconds is NARROWER
        than the skew it was supposed to tolerate: a phone five minutes fast
        never saw its OWN match row and always fell through to solo-vs-AI.
        Driven for real: Date.now() is shimmed forward, `matches` is stubbed
        to return a row stamped with real server time, and the poller must
        still deliver it. 🔴 THE CONTROL: the same run feeds an unrelated
        pending row from days ago instead — the kind _acceptFriendChallenge()
        and _gymLiveBeginAsChallenger() insert and never clean up — and the
        poller must REFUSE it. Without that half this driver would pass a
        patch that simply deleted the bound and traded a skew bug for a
        drop-into-a-dead-match bug.

        Both poller modes are exercised: PRIMED (the seen-set snapshot taken
        in cloudEnterMatchmaking before the queue row goes in — no clock read
        at all, so it survives a THREE-DAY skew that defeats any age bound)
        and UNPRIMED (snapshot query failed, or the poller was started
        directly — the coarse six-hour age bound).

     3. Nothing removed an abandoned matchmaking_queue row. A killed tab left
        it behind for ever and `order by queued_at asc` pins the oldest row at
        the head of its MMR band, so every real player was paired with a ghost.
        A `pagehide` handler now releases it — and must be a NO-OP when no
        search is in flight, because deleting a row the player legitimately
        just queued turns a 30-second bug into "matchmaking never works".

   ⚠ WHAT THIS DRIVER CANNOT PROVE. It never opens a socket. Cloud.client is a
     recording stub, so nothing here shows that Postgres accepts the insert,
     that `default now()` fires, that RLS permits the pagehide delete, or that
     the browser lets an unload-time fetch reach the network at all (supabase-js
     does not set `keepalive`, so the pagehide delete is best-effort by
     construction). Pairing itself needs two real accounts and a live server.

   Run:  node .gauntlet/drive-mm-clockskew.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8890 + (process.pid % 40);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('\n\u{23F1} MATCHMAKING · DEVICE CLOCK OUT, GHOST ROW RELEASED\n');

/* ── STATIC PASS · the insert no longer stamps its own queued_at ─────────── */
const HTML = fs.readFileSync('public/index.html', 'utf8');
const insertAt = HTML.indexOf("await Cloud.client.from('matchmaking_queue').insert({");
const insertObj = insertAt < 0 ? '' : HTML.slice(insertAt, HTML.indexOf('});', insertAt));
console.log('  ── static: the queue insert');
ok('\u{23F1} the queue INSERT was found', insertAt > 0);
ok('\u{23F1} no queued_at key inside the insert object — server default now() wins',
  insertObj.length > 0 && !/queued_at/.test(insertObj));
/* Every surviving mention must be schema text or a WHY comment, never code.
   ⚠ BLOCK COMMENTS COUNT AS COMMENTS. This originally recognised only // and --,
     so the moment a WHY note about queued_at was written inside a slash-star
     block — the house style for multi-line rationale in this repo — the
     assertion failed on prose and reported the author rather than a defect.
     Scanned with a tiny state machine instead of a regex because a block
     comment spans lines by definition and a per-line regex cannot see that. */
const inBlock = (() => {
  const lines = HTML.split(/\r?\n/);
  const flags = new Array(lines.length).fill(false);
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    flags[i] = open;                         // already inside → this line is comment text
    let idx = 0;
    while (idx < l.length) {
      if (!open && l.startsWith('/*', idx)) { open = true; flags[i] = true; idx += 2; continue; }
      if (open && l.startsWith('*/', idx))  { open = false; idx += 2; continue; }
      idx++;
    }
  }
  return flags;
})();
const stray = HTML.split(/\r?\n/)
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /queued_at/.test(l))
  .filter(([n, l]) => !inBlock[n - 1] && !/^\s*(\/\/|--|\*)/.test(l)
    && !/^\s*queued_at\s+timestamptz/.test(l) && !/order by queued_at/.test(l));
ok('\u{23F1} every remaining queued_at mention is SQL text or a comment', stray.length === 0,
  stray.map(([n]) => n).join(','));

const pollAt = HTML.indexOf('function _startMatchmakingPoll()');
const pollSrc = HTML.slice(pollAt, HTML.indexOf('function _stopMatchmakingPoll()', pollAt));
console.log('  ── static: the poller');
ok('\u{23F1} the poller no longer gates pickup on .gte(created_at, <client clock>)',
  pollAt > 0 && !/\.gte\('created_at'/.test(pollSrc));
ok('\u{23F1} the replacement is a non-clock predicate, not a deletion',
  /\.is\('winner_id', null\)/.test(pollSrc) && /_mmSeen/.test(pollSrc));
ok('\u{23F1} the trigger comment sources sql/066, not api.sql',
  /sql\/066_matchmaking_server\.sql/.test(pollSrc) && !/api\.sql/.test(pollSrc));

/* ── LIVE PASS ───────────────────────────────────────────────────────────── */
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
  return r.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
/* Deliberately NOT waiting on _releaseMatchmakingQueueRow — this driver has to
   be runnable against a PRE-FIX index.html (that is how you check it is
   discriminating), and there the function does not exist. Its absence is an
   assertion below, not a hang. */
await page.waitForFunction(
  'typeof _startMatchmakingPoll === "function" && typeof cloudEnterMatchmaking === "function"',
  null, { timeout: 180000 });
await page.waitForTimeout(2500);
ok('\u{23F1} _releaseMatchmakingQueueRow exists',
  await page.evaluate(() => typeof _releaseMatchmakingQueueRow === 'function'));

/* Recording stub for Cloud.client. It is NOT a "return the fixture regardless"
   stub — it actually APPLIES eq/is/gte/or/order/limit to the fixture rows. That
   matters: a stub that ignores filters would happily deliver the match row
   through the OLD `.gte('created_at', <client clock>)` query too, and the
   skew assertion would pass against the unfixed file. Terminal builder is
   thenable so `await …from(x).select().eq().limit()` resolves like
   postgrest-js. */
await page.evaluate(() => {
  window.__mm = { calls: [], matchRows: [], fired: [] };
  const mk = (table) => {
    const ctx = { table, op: 'select', ops: [] };
    const b = {};
    const wrap = (name) => (...args) => {
      if (name === 'delete') ctx.op = 'delete';
      /* 🔴 NOTHING IS RECORDED HERE ANY MORE — see the note on b.then below.
         This used to push the call the moment .insert() or .eq() ran, i.e. while
         the BUILDER was being assembled, so an un-awaited chain that never sent
         an HTTP request still scored as a request. That is exactly how M2's
         pagehide release passed a driver while sending nothing at all. */
      if (name === 'insert') { ctx.op = 'insert'; ctx.payload = args[0]; }
      if (name === 'eq') { (ctx.eq = ctx.eq || []).push([args[0], args[1]]); }
      ctx.ops.push([name, args]);
      return b;
    };
    for (const n of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'is', 'in', 'or', 'gte', 'lt', 'lte', 'order', 'limit', 'single', 'maybeSingle'])
      b[n] = wrap(n);
    const apply = () => {
      if (table !== 'matches' || ctx.op !== 'select') return [];
      let rows = window.__mm.matchRows.slice();
      for (const [name, a] of ctx.ops) {
        if (name === 'eq')  rows = rows.filter((r) => r[a[0]] === a[1]);
        else if (name === 'neq') rows = rows.filter((r) => r[a[0]] !== a[1]);
        else if (name === 'is')  rows = rows.filter((r) => (a[1] === null ? r[a[0]] == null : r[a[0]] === a[1]));
        else if (name === 'gte') rows = rows.filter((r) => String(r[a[0]]) >= String(a[1]));
        else if (name === 'lt')  rows = rows.filter((r) => String(r[a[0]]) <  String(a[1]));
        else if (name === 'or') {
          const terms = String(a[0]).split(',').map((t) => t.split('.'));
          rows = rows.filter((r) => terms.some(([c, o, v]) => o === 'eq' && r[c] === v));
        } else if (name === 'order') {
          const asc = !(a[1] && a[1].ascending === false);
          rows.sort((x, y) => (String(x[a[0]]) < String(y[a[0]]) ? -1 : String(x[a[0]]) > String(y[a[0]]) ? 1 : 0) * (asc ? 1 : -1));
        } else if (name === 'limit') rows = rows.slice(0, a[0]);
      }
      return rows;
    };
    /* 🔴 THE REQUEST HAPPENS HERE, SO THE RECORD HAPPENS HERE.
       In supabase-js the fetch lives inside then(e,t): a PostgREST chain is a
       builder until something subscribes to it. Recording at this point means
       `from(x).delete().eq(...)` with no await and no .then records nothing and
       fails its assertion — the inert-chain bug becomes visible instead of
       invisible. Guarded by ctx.sent so one awaited chain counts once even if
       the caller then()s it twice. */
    b.then = (res, rej) => {
      if (!ctx.sent) {
        ctx.sent = true;
        const first = (ctx.eq && ctx.eq[0]) || [];
        if (ctx.op === 'delete') window.__mm.calls.push({ table, op: 'delete', col: first[0], val: first[1] });
        if (ctx.op === 'insert') window.__mm.calls.push({ table, op: 'insert', payload: ctx.payload });
      }
      return Promise.resolve({ data: apply(), error: null }).then(res, rej);
    };
    return b;
  };
  window.__mmRealClient = Cloud.client;
  /* initCloud() short-circuits on Cloud.ready, so this keeps it from trying to
     build a real supabase client (the CDN is blocked in this driver) and from
     stomping the recording stub below. */
  Cloud.ready = true;
  Cloud.client = { from: mk, channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }), removeChannel: () => {} };
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.signedIn = true;
  Profile.cloud.userId = 'me-0000-1111';
  Profile.cloud.autoSync = false;          // keep the save-flush pagehide handler quiet
  /* Spy in place of the real match handler: it is a top-level function
     declaration in a classic script, so it is a writable global property.
     Swapping it keeps the assertion about DELIVERY, not about the VS screen. */
  window.__mmRealOnFound = window.onMultiplayerMatchFound;
  window.onMultiplayerMatchFound = (m) => { window.__mm.fired.push(m && m.id); };
  _wireMatchListener();
  window.__mmClockOffset = 0;
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + window.__mmClockOffset;
  window.__mmRealNow = realNow;
});

const run = (fn, arg) => page.evaluate(fn, arg);

/* Drive one poller run and report what was delivered. */
const poll = async (cfg) => {
  const r = await page.evaluate(async (c) => {
    window.__mm.fired = [];
    window.__mm.calls = [];
    window.__mm.matchRows = c.rows;
    window.__mmClockOffset = c.offsetMs;
    Cloud._mmSeen = c.seen ? new Set(c.seen) : null;
    MultiplayerMatch.active = true;
    MultiplayerMatch.matchId = null;
    _startMatchmakingPoll();
    await new Promise((r2) => setTimeout(r2, 400));
    _stopMatchmakingPoll();
    /* What the PRE-FIX predicate would have done with this clock, so the
       assertion below is visibly discriminating rather than vacuous. */
    const oldSince = new Date(Date.now() - 4000).toISOString();
    const oldWouldTake = c.rows.filter((x) => x.created_at >= oldSince).length;
    return { fired: window.__mm.fired.slice(), oldWouldTake };
  }, cfg);
  return r;
};

const serverNow = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const FIVE_MIN = 300000;
const THREE_DAYS = 3 * 86400000;

console.log('  ── live: a fast phone must still see its own match');
{
  const rows = [{ id: 'mine-fresh', status: 'pending', winner_id: null, created_at: serverNow(),
    player1_id: 'me-0000-1111', player2_id: 'them', hero1_id: null, hero2_id: null, deck1: {}, deck2: {} }];
  const r = await poll({ rows, offsetMs: FIVE_MIN, seen: null });
  ok('\u{23F1} device 5 min fast, unprimed — own match delivered', r.fired[0] === 'mine-fresh', JSON.stringify(r.fired));
  ok('\u{23F1} \u{1F534} and the OLD 4s bound would have dropped it (assertion is discriminating)',
    r.oldWouldTake === 0, 'old-window-take=' + r.oldWouldTake);
}
{
  const rows = [{ id: 'mine-fresh-2', status: 'pending', winner_id: null, created_at: serverNow(),
    player1_id: 'me-0000-1111', player2_id: 'them' }];
  const r = await poll({ rows, offsetMs: THREE_DAYS, seen: ['ghost-a', 'ghost-b'] });
  ok('\u{23F1} device THREE DAYS fast, primed seen-set — own match still delivered',
    r.fired[0] === 'mine-fresh-2', JSON.stringify(r.fired));
}

console.log('  ── live: \u{1F534} CONTROL — a stale pending row must NOT be delivered');
{
  const rows = [{ id: 'ghost-friend-challenge', status: 'pending', winner_id: null, created_at: daysAgo(4),
    player1_id: 'me-0000-1111', player2_id: 'them' }];
  const r = await poll({ rows, offsetMs: FIVE_MIN, seen: null });
  ok('\u{23F1} 4-day-old friend-challenge row refused (unprimed / age bound)', r.fired.length === 0, JSON.stringify(r.fired));
}
{
  const rows = [{ id: 'ghost-gym-live', status: 'pending', winner_id: null, created_at: serverNow(),
    player1_id: 'me-0000-1111', player2_id: 'them' }];
  const r = await poll({ rows, offsetMs: 0, seen: ['ghost-gym-live'] });
  ok('\u{23F1} a row that existed BEFORE I queued is refused even though it is recent',
    r.fired.length === 0, JSON.stringify(r.fired));
}
{
  /* Mixed: the ghosts sort newest-first ahead of nothing; the real row must
     survive the limit(5) window rather than being crowded out by ghosts. */
  const rows = [
    { id: 'g1', status: 'pending', winner_id: null, created_at: serverNow(), player1_id: 'me-0000-1111', player2_id: 'them' },
    { id: 'g2', status: 'pending', winner_id: null, created_at: serverNow(), player1_id: 'me-0000-1111', player2_id: 'them' },
    { id: 'real', status: 'pending', winner_id: null, created_at: serverNow(), player1_id: 'me-0000-1111', player2_id: 'them' },
    { id: 'g3', status: 'pending', winner_id: null, created_at: serverNow(), player1_id: 'me-0000-1111', player2_id: 'them' },
  ];
  const r = await poll({ rows, offsetMs: FIVE_MIN, seen: ['g1', 'g2', 'g3'] });
  ok('\u{23F1} four rows, three of them ghosts — exactly the real one is delivered',
    r.fired.length === 1 && r.fired[0] === 'real', JSON.stringify(r.fired));
}

console.log('  ── live: cloudEnterMatchmaking primes the seen-set and sends no queued_at');
{
  const r = await page.evaluate(async () => {
    window.__mm.calls = [];
    window.__mm.matchRows = [{ id: 'pre-existing', status: 'pending', winner_id: null,
      created_at: new Date().toISOString(), player1_id: 'me-0000-1111', player2_id: 'them' }];
    Cloud._mmSeen = undefined;
    const res = await cloudEnterMatchmaking({ mode: 'ranked', hiddenMmr: 1000, heroId: 'h', deck: {} });
    _stopMatchmakingPoll();
    const ins = window.__mm.calls.filter((c) => c.op === 'insert' && c.table === 'matchmaking_queue');
    return {
      okRes: !!(res && res.ok),
      insertKeys: ins.length ? Object.keys(ins[0].payload) : [],
      seen: (Cloud._mmSeen instanceof Set) ? Array.from(Cloud._mmSeen) : null,
    };
  });
  ok('\u{23F1} the queue insert carries no queued_at key at runtime either',
    r.insertKeys.length > 0 && !r.insertKeys.includes('queued_at'), r.insertKeys.join(','));
  ok('\u{23F1} the pre-existing pending row was snapshotted before the queue insert',
    Array.isArray(r.seen) && r.seen.includes('pre-existing'), JSON.stringify(r.seen));
}

console.log('  ── live: pagehide releases the queue row — and only while searching');
{
  const r = await page.evaluate(async () => {
    const out = {};
    const dels = () => window.__mm.calls.filter((c) => c.table === 'matchmaking_queue' && c.op === 'delete');
    /* (i) search in flight */
    _stopMatchmakingPoll();
    MultiplayerMatch.active = true;
    window.__mm.calls = [];
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r2) => setTimeout(r2, 60));
    out.searching = dels();
    /* (ii) not searching at all */
    MultiplayerMatch.active = false;
    Cloud._mmPoll = null;
    window.__mm.calls = [];
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r2) => setTimeout(r2, 60));
    out.idle = dels();
    /* (iii) poll still ticking even though `active` was never set — a search
       IS in flight by the other measure and the row must still be released */
    window.__mm.matchRows = [];          // nothing to deliver — isolate the pagehide delete
    MultiplayerMatch.active = true;
    _startMatchmakingPoll();
    await new Promise((r2) => setTimeout(r2, 120));
    MultiplayerMatch.active = undefined;
    window.__mm.calls = [];
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r2) => setTimeout(r2, 60));
    out.pollOnly = dels();
    _stopMatchmakingPoll();
    MultiplayerMatch.active = false;
    return out;
  });
  ok('\u{23F1} searching — exactly ONE delete on matchmaking_queue', r.searching.length === 1, JSON.stringify(r.searching));
  ok('\u{23F1} searching — that delete is scoped to the signed-in user id',
    r.searching.length === 1 && r.searching[0].col === 'user_id' && r.searching[0].val === 'me-0000-1111',
    JSON.stringify(r.searching[0] || null));
  ok('\u{23F1} \u{1F534} NOT searching — ZERO deletes (never nuke a row the player owns)', r.idle.length === 0, JSON.stringify(r.idle));
  ok('\u{23F1} poller still running — the row is released', r.pollOnly.length === 1, JSON.stringify(r.pollOnly));
}

/* ── pageshow: the other half of the release ───────────────────────────────
   🔴 WHY THIS EXISTS. The pagehide delete above was a bare PostgREST chain
      and sent nothing, so the hazard it creates was invisible: an iOS or
      standalone-PWA player who backgrounds mid-search has their queue row
      deleted and — with no pageshow handler — comes back to a page where the
      search timer is still counting and MultiplayerMatch.active is still true,
      but they are no longer in the queue and can never be paired. They watch
      the clock run out and drop to solo-vs-AI. Fixing the delete ARMED that.
   The re-queue must fire on a RESTORE while a search is genuinely live, and
   must stay silent otherwise — a stray insert is a ghost of our own making. */
console.log('  ── live: pageshow re-queues a search the pagehide release dropped');
{
  const r = await page.evaluate(async () => {
    const out = {};
    const ins = () => window.__mm.calls.filter((c) => c.table === 'matchmaking_queue' && c.op === 'insert');
    _stopMatchmakingPoll();
    /* (i) restored mid-search — exactly one re-insert */
    MultiplayerMatch.active = true;
    MultiplayerMatch.matchId = null;
    window.__mm.calls = [];
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await new Promise((r2) => setTimeout(r2, 60));
    out.restored = ins();
    /* (ii) not searching — silence */
    MultiplayerMatch.active = false;
    window.__mm.calls = [];
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await new Promise((r2) => setTimeout(r2, 60));
    out.idle = ins();
    /* (iii) a match was already found — re-queueing would BE the ghost */
    MultiplayerMatch.active = true;
    MultiplayerMatch.matchId = 'match-abc';
    window.__mm.calls = [];
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await new Promise((r2) => setTimeout(r2, 60));
    out.matched = ins();
    MultiplayerMatch.active = false;
    MultiplayerMatch.matchId = null;
    return out;
  });
  ok('\u{23F1} restored mid-search — exactly ONE re-insert', r.restored.length === 1, JSON.stringify(r.restored));
  ok('\u{23F1} the re-insert carries NO queued_at (server clock must stamp it)',
    r.restored.length === 1 && !('queued_at' in (r.restored[0].payload || {})),
    JSON.stringify(r.restored[0] && r.restored[0].payload));
  ok('\u{23F1} the re-insert reuses the stashed queue payload (mode present)',
    r.restored.length === 1 && !!(r.restored[0].payload && r.restored[0].payload.mode),
    JSON.stringify(r.restored[0] && r.restored[0].payload));
  ok('\u{23F1} \u{1F534} NOT searching — ZERO re-inserts', r.idle.length === 0, JSON.stringify(r.idle));
  ok('\u{23F1} \u{1F534} match already found — ZERO re-inserts (that would be a ghost)',
    r.matched.length === 0, JSON.stringify(r.matched));
}

ok('\u{23F1} no page errors during the run', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ ALL PASS') + '\n');
process.exit(fails ? 1 : 0);
