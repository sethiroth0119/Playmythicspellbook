/* ══════════════════════════════════════════════════════════════════════════
   🎯 DRIVE-MATCHMAKING — every poll tick attempts pairing, and the AI
   fallback stops lying about why it fired

   THE BUG. `trigger_pair_match` is `after insert on public.matchmaking_queue`
   and nothing else, so a queue row is judged for pairing exactly once — at the
   instant it is written. Branch (b) of the client poll tick
   (_startMatchmakingPoll, public/index.html) had been deliberately stripped of
   its ability to create a match and was left as nothing but a comment
   explaining why. The result: the first player into an empty band is evaluated
   against an empty queue, then SELECTs for thirty seconds and is dropped to
   solo-vs-AI with "No opponent found" — a sentence that is simply false when
   somebody else is sitting in the queue. The Online/Searching counters that
   would have shown it are admin-gated on that screen, and the tick swallows
   every error, which is how it survived.

   WHAT THIS DRIVER PINS DOWN, all of it client-side and all of it stubbed:
     · the queue entry writes exactly one DELETE then one INSERT (never an
       upsert — an upsert resolving to UPDATE fires no AFTER-INSERT trigger),
       carrying user_id/mode/mmr/faction_id/hero_id/deck_json and NO queued_at;
     · N poll ticks produce N pairing ATTEMPTS — rpc('mm_try_pair') — not N
       bare SELECTs, AND that stays true when the function is missing: the
       longest gap between two attempts across a whole search is one poll
       interval, never the search itself;
     · a fed `matches` row moves App.screen off 'matchmaking' and sets
       MultiplayerMatch.matchId;
     · the AI fallback fires at MATCHMAKING_AI_FALLBACK_MS with no match row,
       and releases the queue row on its way out;
     · the two fallback messages differ — an effectively empty queue keeps
       "No opponent found", two-or-more-queued-and-unpaired says something
       else and console.warn's, naming the pairing trigger.

   🔴 THE RED CHECKS, which are the point. A green driver over swallowed errors
   proves nothing, so four of the runs below exist to go red if the guard they
   cover is removed:
     · the queue INSERT is stubbed to REJECT. Production swallows exactly that
       (the tick's transient-swallowing catch), so this driver asserts on
       cloudEnterMatchmaking's RETURN VALUE instead and must fail loudly.
     · rpc is stubbed to reject with a PGRST202-shaped error over a whole
       search: every tick must STILL attempt (the missing-function flag is a
       diagnosis flag, not a suppressor), and the re-queue fallback must be
       exercised EXACTLY ONCE — and not until the halfway mark. WHEN is as
       load-bearing as how-many: a re-queue fired on tick #1 lands ~1ms after
       the original INSERT and re-fires the AFTER-INSERT trigger against the
       identical queue contents that insert was already judged against, which
       buys the waiting player nothing. A re-queue LOOP is the other failure —
       every re-insert re-fires the trigger, and the trigger ends by deleting
       both paired rows.
     · the flag must not outlive one search: a client already sitting on the
       page when a human applies sql/066 has to notice.
     · an ORDINARY transient rpc error (statement timeout) must NOT latch, or
       one blip permanently disables pairing for that page session.
     · the re-queue INSERT RESOLVES with { error } — an RLS denial, a 5xx, a
       token-refresh 401 — which is what postgrest-js actually does instead of
       throwing. The delete has already landed by then, so an unread result
       leaves the player deleted OUT of matchmaking_queue for the rest of their
       search, invisible to the AFTER-INSERT trigger that is the only live
       pairing mechanism. The client must end that search still holding a row.
     · MultiplayerMatch.matchId is set before a tick: ZERO re-queues. A player
       who was just paired must never be pulled back into the queue, because
       the trigger ends by deleting BOTH paired rows and a re-insert racing
       that delete is the "two different boards" bug (two clients on different
       boards) that the comment in branch (b) says was already fixed once.

   ⚠ WHAT THIS DRIVER CANNOT PROVE — read this before believing anything above.
     Cloud.client is a recording stub. No socket is opened, no row is written,
     no trigger runs. Nothing here shows that two real accounts can actually
     meet: that needs a live server and two authenticated sessions, and it has
     NOT been done. And mm_try_pair() does not exist on any server — it ships
     in sql/066_matchmaking_server.sql, which has NOT been applied — so in
     production today every rpc call this driver exercises comes back PGRST202,
     and what actually runs is a failing round-trip per tick plus one re-queue
     at the halfway mark of the search.

   Run:  node .gauntlet/drive-matchmaking.mjs     (~150s — it waits out real
                                                    2500ms poll intervals, and
                                                    four runs must cross the
                                                    15s re-queue deadline)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const PORT = 8830 + (process.pid % 40);
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
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('\n\u{1F3AF} MATCHMAKING · EVERY TICK ATTEMPTS PAIRING, THE FALLBACK TELLS THE TRUTH\n');

/* ── STATIC PASS ─────────────────────────────────────────────────────────── */
const HTML = fs.readFileSync('public/index.html', 'utf8');
const pollAt  = HTML.indexOf('function _startMatchmakingPoll()');
const pollSrc = pollAt < 0 ? '' : HTML.slice(pollAt, HTML.indexOf('function _stopMatchmakingPoll()', pollAt));
/* Shape assertions run against the CODE, not the prose. Branch (b) is mostly
   comment, and those comments quote the very constructs being asserted against
   ("this used to be gated on `if (!Cloud._mmRpcMissing)`") — matched over the
   raw slice, the anti-pattern checks below would fail on a correct build and,
   worse, the presence checks would pass on a build that only talks about it. */
const pollCode = pollSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
console.log('  ── static: branch (b) of the tick');
ok('\u{1F3AF} static: the tick calls rpc(\'mm_try_pair\')', /rpc\('mm_try_pair'\)/.test(pollCode));
ok('\u{1F3AF} static: (b) still never INSERTs a `matches` row from the client',
  pollCode.length > 0 && !/from\('matches'\)[\s\S]{0,60}\.insert\(/.test(pollCode));
ok('\u{1F3AF} static: the fallback re-queue is delete-then-insert, never upsert',
  /matchmaking_queue'\)\.delete\(\)/.test(pollCode)
  && /matchmaking_queue'\)\.insert\(/.test(pollCode)
  && !/matchmaking_queue'\)\.upsert\(/.test(pollCode));
ok('\u{1F3AF} static: the re-queue payload still sends no queued_at', !/queued_at\s*:/.test(pollCode));
/* 🔴 THE ROUND-2 REGRESSION, pinned statically as well as behaviourally: the
   rpc call MUST NOT sit behind `if (!Cloud._mmRpcMissing)`. That gate made the
   first PGRST202 latch for the rest of the page's life, so a 31-second search
   attempted pairing at 0ms/1ms/1ms and then ran twelve consecutive SELECT-only
   ticks — the same "judged once, never again" shape as the bug being fixed. */
ok('\u{1F3AF} static: the rpc is NOT gated on the missing-function latch',
  !/if \(!Cloud\._mmRpcMissing\)/.test(pollCode));
ok('\u{1F3AF} static: the latch is still SET (it picks the fallback wording and unlocks the re-queue)',
  /Cloud\._mmRpcMissing = true/.test(pollCode));
ok('\u{1F3AF} static: the latch is cleared at the top of every search, not page-lifetime',
  /Cloud\._mmRpcMissing = false/.test(pollCode));
ok('\u{1F3AF} static: the re-queue is deferred to the halfway mark of MATCHMAKING_AI_FALLBACK_MS',
  /MM_REQUEUE_AFTER_MS = Math\.max\(2500, Math\.round\(MATCHMAKING_AI_FALLBACK_MS \/ 2\)\)/.test(pollCode)
  && /Date\.now\(\) - _searchStartedAt\) >= MM_REQUEUE_AFTER_MS/.test(pollCode));
/* 🔴 THE ROUND-3 REGRESSION, pinned statically as well as behaviourally (§8b):
   the re-queue INSERT's result MUST be read. postgrest-js resolves with
   { error } on an RLS denial / 5xx / token-refresh 401 — it never throws — so
   an unread result means the tick's transient catch cannot see it, _mmRequeued
   stays latched from before the awaits, and the player finishes the search with
   the DELETE applied and no row back. */
ok('\u{1F3AF} static: the re-queue INSERT destructures { error } like the entry insert does',
  /const \{ error \} = await Cloud\.client\.from\('matchmaking_queue'\)\.insert\(/.test(pollCode));
ok('\u{1F3AF} static: a failed re-insert UN-LATCHES _mmRequeued so the next tick retries',
  /if \(reqErr\)[\s\S]{0,60}Cloud\._mmRequeued = false/.test(pollCode));
ok('\u{1F3AF} static: the re-queue is guarded on BOTH matchId and the delivered latch',
  /!Cloud\._mmRequeued/.test(pollCode) && /!_delivered/.test(pollCode) && /MultiplayerMatch\.matchId/.test(pollCode));

const fbAt  = HTML.indexOf('MultiplayerMatch.aiFallbackTimer = setTimeout(');
const fbSrc = fbAt < 0 ? '' : HTML.slice(fbAt, HTML.indexOf('}, MATCHMAKING_AI_FALLBACK_MS);', fbAt));
console.log('  ── static: the AI fallback');
ok('\u{1F3AF} static: the fallback branches on LobbyPresence.queueCount', /LobbyPresence\.queueCount/.test(fbSrc));
ok('\u{1F3AF} static: it console.warn\'s and names the pairing trigger',
  /console\.warn/.test(fbSrc) && /trigger_pair_match/.test(fbSrc));
/* Count only the line that ACTUALLY SHOWS IT — the WHY comment above the split
   quotes the old wording too, and a plain substring count would happily accept
   the old single-message version. */
ok('\u{1F3AF} static: "No opponent found" is shown on exactly ONE branch',
  (fbSrc.match(/showToast\('\u{1F916} No opponent found/gu) || []).length === 1);
/* The Online/Searching counters on the matchmaking SCREEN are admin-gated and
   this piece does not touch that — asserted so a later edit cannot quietly
   un-gate them under cover of this change. */
const scrAt  = HTML.indexOf('id="mm-searching"');
const scrSrc = scrAt < 0 ? '' : HTML.slice(Math.max(0, scrAt - 1400), scrAt + 200);
ok('\u{1F3AF} static: the on-screen Online/Searching counters are STILL admin-gated (unchanged)',
  scrAt > 0 && /const _adm = \(typeof isAdmin === 'function'\) && isAdmin\(\);/.test(scrSrc)
  && /const adminStats = _adm \?/.test(scrSrc));

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
await page.waitForFunction(
  'typeof _startMatchmakingPoll === "function" && typeof cloudEnterMatchmaking === "function" && typeof startMatchmaking === "function"',
  null, { timeout: 180000 });
await page.waitForTimeout(2500);
ok('\u{1F3AF} _mmRpcFunctionMissing() exists as a real function',
  await page.evaluate(() => typeof _mmRpcFunctionMissing === 'function'));

/* Recording stub for Cloud.client. Filters are actually APPLIED to the fixture
   rows (eq/is/or/order/limit), because a stub that ignored them would deliver a
   match row through predicates that would never have matched in Postgres and
   the delivery assertions would be vacuous. The terminal builder is thenable so
   `await …from(x).select().eq().limit()` resolves the way postgrest-js does. */
await page.evaluate(() => {
  window.__mm = {
    calls: [], matchRows: [], selects: 0, rpc: [], toasts: [], warns: [],
    rejectInsert: false, rpcError: null,
    /* 🗃 A ONE-ROW MODEL OF matchmaking_queue. Counting calls is not enough for
       §8b: the failure pinned there is that the DELETE lands, the INSERT is
       REFUSED — resolved with { error }, not thrown — and the player finishes
       their search holding NO queue row, invisible to the AFTER-INSERT trigger
       that is the only live pairing mechanism while sql/066 is unapplied. Only
       a model of the table tells "re-queued" apart from "deleted and never put
       back". insertFailsLeft makes the refusal transient, which is the case the
       fix has to survive. */
    queueRows: [], insertError: null, insertFailsLeft: 0,
  };
  const mk = (table) => {
    const ctx = { table, op: 'select', ops: [] };
    const b = {};
    /* Every recorded call carries `t` — ms since __mmStart(). The re-queue
       assertions are about WHEN it fires, not only how often: fired on tick #1
       it re-fires the AFTER-INSERT trigger against the identical queue the
       original insert was already judged against, which buys the waiting player
       nothing. A count-only assertion cannot tell those two apart. */
    const at = () => Date.now() - (window.__mm.t0 || Date.now());
    const wrap = (name) => (...args) => {
      if (name === 'delete') ctx.op = 'delete';
      /* 🔴 NOTHING IS RECORDED IN THE BUILDER ANY MORE — see b.then below. These
         pushes fired while the chain was being ASSEMBLED, so an un-awaited
         chain that issued no HTTP request still scored as one. That is exactly
         how M2's pagehide release passed a driver while sending nothing. */
      if (name === 'upsert') { ctx.op = 'upsert'; ctx.payload = args[0]; }
      if (name === 'insert') { ctx.op = 'insert'; ctx.payload = args[0]; }
      if (name === 'eq') { (ctx.eq = ctx.eq || []).push([args[0], args[1]]); }
      ctx.ops.push([name, args]);
      return b;
    };
    for (const n of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'neq', 'is', 'in', 'or', 'gte', 'lt', 'lte', 'order', 'limit', 'single', 'maybeSingle'])
      b[n] = wrap(n);
    const apply = () => {
      if (table !== 'matches' || ctx.op !== 'select') return [];
      window.__mm.selects++;                    // one per poll tick's branch (a)
      let rows = window.__mm.matchRows.slice();
      for (const [name, a] of ctx.ops) {
        if (name === 'eq')  rows = rows.filter((r) => r[a[0]] === a[1]);
        else if (name === 'neq') rows = rows.filter((r) => r[a[0]] !== a[1]);
        else if (name === 'is')  rows = rows.filter((r) => (a[1] === null ? r[a[0]] == null : r[a[0]] === a[1]));
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
    b.then = (res, rej) => {
      /* 🔴 THE REQUEST HAPPENS HERE, SO THE RECORD HAPPENS HERE. A PostgREST
         chain is a builder until something subscribes to it, so recording at
         this point makes an inert chain record NOTHING and fail its assertion
         instead of passing it. ctx.sent keeps a double-then from counting twice. */
      if (!ctx.sent) {
        ctx.sent = true;
        const first = (ctx.eq && ctx.eq[0]) || [];
        if (ctx.op === 'delete') window.__mm.calls.push({ table, op: 'delete', col: first[0], val: first[1], t: at() });
        if (ctx.op === 'insert') window.__mm.calls.push({ table, op: 'insert', payload: ctx.payload, t: at() });
        if (ctx.op === 'upsert') window.__mm.calls.push({ table, op: 'upsert', payload: ctx.payload, t: at() });
      }
      /* 🔴 RED HOOK #1 — REJECT the queue INSERT, the way a dropped connection
         does. Production swallows it; this driver must not. */
      if (window.__mm.rejectInsert && table === 'matchmaking_queue' && ctx.op === 'insert')
        return Promise.reject(new Error('stubbed: matchmaking_queue insert rejected')).then(res, rej);
      if (table === 'matchmaking_queue' && ctx.op === 'delete') {
        window.__mm.queueRows = [];
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      }
      if (table === 'matchmaking_queue' && ctx.op === 'insert') {
        /* 🔴 RED HOOK #2 — RESOLVE with { error }: the shape postgrest-js really
           returns for an RLS denial, a 5xx, or a token-refresh 401. It does NOT
           throw, so nothing upstream of an explicit result check can see it —
           and the row is NOT written. */
        if (window.__mm.insertFailsLeft > 0) {
          window.__mm.insertFailsLeft--;
          return Promise.resolve({ data: null, error: window.__mm.insertError
            || { code: '42501', message: 'new row violates row-level security policy for table "matchmaking_queue"' } }).then(res, rej);
        }
        window.__mm.queueRows = [ctx.payload];
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      }
      return Promise.resolve({ data: apply(), error: null, count: 0 }).then(res, rej);
    };
    return b;
  };
  const rpc = (fn, args) => {
    window.__mm.rpc.push({ fn, args: args === undefined ? null : args,
      t: Date.now() - (window.__mm.t0 || Date.now()) });
    if (window.__mm.rpcError) return Promise.resolve({ data: null, error: window.__mm.rpcError });
    return Promise.resolve({ data: { ok: true, paired: false }, error: null });
  };
  window.__mmRealClient = Cloud.client;
  /* initCloud() short-circuits on Cloud.ready — this keeps it from building a
     real supabase client (the CDN is blocked here) and stomping the stub. */
  Cloud.ready = true;
  Cloud.client = {
    from: mk, rpc,
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: () => {},
  };
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.signedIn = true;
  Profile.cloud.userId = 'me-0000-1111';
  Profile.cloud.autoSync = false;
  window.showToast = (msg) => { window.__mm.toasts.push(String(msg)); };
  const realWarn = console.warn.bind(console);
  console.warn = (...a) => { window.__mm.warns.push(a.map(String).join(' ')); realWarn(...a); };
  _wireMatchListener();
  /* Reset helper so each scenario starts from a known state. `latched` pre-sets
     Cloud._mmRpcMissing, but _startMatchmakingPoll() now CLEARS it at the top of
     every search on purpose (see §9), so it only survives into scenarios that
     never restart the poller. */
  window.__mmReset = (o) => {
    o = o || {};
    window.__mm.calls = []; window.__mm.rpc = []; window.__mm.selects = 0;
    window.__mm.toasts = []; window.__mm.warns = [];
    window.__mm.t0 = Date.now();
    window.__mm.matchRows = o.rows || [];
    window.__mm.rpcError = o.rpcError || null;
    window.__mm.rejectInsert = !!o.rejectInsert;
    window.__mm.insertFailsLeft = o.insertFailsLeft || 0;
    window.__mm.insertError = o.insertError || null;
    /* The row cloudEnterMatchmaking's own INSERT left behind — scenarios that
       start the poller directly still have to begin from "I am in the queue". */
    window.__mm.queueRows = (o.queueRows === undefined)
      ? [{ user_id: 'me-0000-1111', mode: 'ranked' }] : o.queueRows;
    Cloud._mmRpcMissing = !!o.latched;
    Cloud._mmRequeued = false;
    Cloud._mmSeen = new Set();
    Cloud._mmMode = 'ranked'; Cloud._mmMmr = 1200; Cloud._mmFaction = 'fac-x';
    Cloud._mmHeroId = 'hero-9'; Cloud._mmDeck = { cards: ['u_a'] };
    MultiplayerMatch.active = true;
    MultiplayerMatch.matchId = o.matchId || null;
  };
  window.__mmQ = (op) => window.__mm.calls.filter((c) => c.table === 'matchmaking_queue' && c.op === op);
  /* Zero the clock at the instant the poller starts, so every recorded `t` is
     "ms into the search" and the WHEN assertions mean something. */
  window.__mmStart = () => { window.__mm.t0 = Date.now(); _startMatchmakingPoll(); };
});
/* The re-queue is deferred to the halfway mark of the search window; read the
   constant off the page rather than hard-coding 15000, so this driver follows
   MATCHMAKING_AI_FALLBACK_MS if it is ever retuned. */
const FALLBACK_MS = await page.evaluate(() => MATCHMAKING_AI_FALLBACK_MS);
const REQUEUE_AFTER_MS = Math.max(2500, Math.round(FALLBACK_MS / 2));
console.log('  (fallback=' + FALLBACK_MS + 'ms · re-queue expected at ~' + REQUEUE_AFTER_MS + 'ms into the search)');

/* ── 1 · ENTER: one delete, one insert, right keys, no queued_at ─────────── */
console.log('  ── live: entering the queue');
{
  const r = await page.evaluate(async () => {
    window.__mmReset({});
    const res = await cloudEnterMatchmaking({
      mode: 'ranked', hiddenMmr: 1200, factionId: 'fac-x', heroId: 'hero-9', deck: { cards: ['u_a'] },
    });
    _stopMatchmakingPoll();
    const c = window.__mm.calls.filter((x) => x.table === 'matchmaking_queue');
    const ins = c.filter((x) => x.op === 'insert');
    return {
      okRes: !!(res && res.ok), err: (res && res.error) || null,
      seq: c.map((x) => x.op),
      keys: ins.length ? Object.keys(ins[0].payload).sort() : [],
      faction: ins.length ? ins[0].payload.faction_id : undefined,
      upserts: c.filter((x) => x.op === 'upsert').length,
    };
  });
  /* 🔴 This is the assertion the "stub the insert to reject" red check trips.
     The recorded call list alone would still look right — the stub records at
     CALL time, so only the return value knows the write failed. */
  ok('\u{1F3AF} enter: cloudEnterMatchmaking reports ok  (RED CHECK: goes red when the insert rejects)',
    r.okRes === true, String(r.err));
  ok('\u{1F3AF} enter: exactly one DELETE then one INSERT on matchmaking_queue',
    r.seq.length === 2 && r.seq[0] === 'delete' && r.seq[1] === 'insert', JSON.stringify(r.seq));
  ok('\u{1F3AF} enter: zero upserts (an UPDATE would never fire the AFTER-INSERT trigger)', r.upserts === 0);
  ok('\u{1F3AF} enter: insert keys are exactly user_id/mode/mmr/faction_id/hero_id/deck_json',
    r.keys.join(',') === 'deck_json,faction_id,hero_id,mmr,mode,user_id', r.keys.join(','));
  ok('\u{1F3AF} enter: NO queued_at key — the server\'s default now() is the shared clock',
    !r.keys.includes('queued_at'));
  ok('\u{1F3AF} enter: faction_id reaches the payload', r.faction === 'fac-x', String(r.faction));
}

/* ── 2 · N ticks → N pairing attempts ────────────────────────────────────── */
console.log('  ── live: every tick attempts pairing');
{
  const r = await page.evaluate(async () => {
    window.__mmReset({});
    window.__mmStart();                            // tick #1 fires immediately
    await new Promise((z) => setTimeout(z, 11000)); // + ticks at 2.5/5/7.5/10s
    _stopMatchmakingPoll();
    return { rpc: window.__mm.rpc.slice(), selects: window.__mm.selects, requeues: window.__mmQ('insert').length };
  });
  ok('\u{1F3AF} ticks: the poller ticked at least 4 times over 11s', r.selects >= 4, 'selects=' + r.selects);
  ok('\u{1F3AF} ticks: N ticks produced N pairing attempts — one rpc(mm_try_pair) per SELECT',
    r.rpc.length === r.selects && r.rpc.length >= 4 && r.rpc.every((x) => x.fn === 'mm_try_pair'),
    'selects=' + r.selects + ' rpc=' + r.rpc.length);
  ok('\u{1F3AF} ticks: the rpc takes no arguments (it is scoped by auth.uid(), not a param)',
    r.rpc.every((x) => x.args == null));
  ok('\u{1F3AF} ticks: with the rpc working, ZERO re-queue inserts', r.requeues === 0, 'ins=' + r.requeues);
}

/* ── 3 · 🔴 RED: PGRST202 → still attempts EVERY tick, re-queues ONCE, LATE ─ */
console.log('  ── live: \u{1F534} mm_try_pair missing (PGRST202) — every tick still attempts, one LATE re-queue');
{
  const RUN_MS = REQUEUE_AFTER_MS + 4500;   // past the halfway mark, ~2 ticks of slack
  const EARLY_MS = Math.round(REQUEUE_AFTER_MS * 0.6);
  const r = await page.evaluate(async ({ RUN_MS, EARLY_MS }) => {
    window.__mmReset({ rpcError: { code: 'PGRST202',
      message: 'Could not find the function public.mm_try_pair without parameters in the schema cache' } });
    window.__mmStart();
    /* Snapshot mid-search: the whole point of the deferral is that NOTHING has
       been re-queued yet at this instant. */
    await new Promise((z) => setTimeout(z, EARLY_MS));
    const earlyInserts = window.__mmQ('insert').length;
    const earlyRpc = window.__mm.rpc.length;
    const earlySelects = window.__mm.selects;
    await new Promise((z) => setTimeout(z, RUN_MS - EARLY_MS));
    _stopMatchmakingPoll();
    const seq = window.__mm.calls.filter((c) => c.table === 'matchmaking_queue').map((c) => c.op);
    const ins = window.__mmQ('insert');
    /* The longest run of consecutive ticks that made NO pairing attempt. Under
       the round-1 latch this was 12; it must now be 0. A tick is "covered" if an
       rpc or a re-insert happened between its SELECT and the next one. */
    const marks = window.__mm.rpc.map((x) => x.t).concat(ins.map((x) => x.t)).sort((a, b) => a - b);
    return {
      rpc: window.__mm.rpc.length, selects: window.__mm.selects, marks,
      latched: !!Cloud._mmRpcMissing, requeued: !!Cloud._mmRequeued, seq,
      earlyInserts, earlyRpc, earlySelects,
      insT: ins.length ? ins[0].t : null,
      delT: (window.__mmQ('delete')[0] || {}).t,
      keys: ins.length ? Object.keys(ins[0].payload).sort() : [],
      delCol: (window.__mmQ('delete')[0] || {}).col,
      delVal: (window.__mmQ('delete')[0] || {}).val,
    };
  }, { RUN_MS, EARLY_MS });
  /* 🎯 THE HEADLINE. Round 1 latched on tick #1 and made zero further attempts:
     rpc=1 across 12 ticks. One attempt per tick, measured, is the requirement. */
  ok('\u{1F3AF} \u{1F534} PGRST202: EVERY tick still attempted pairing — one rpc per SELECT across ' + r.selects + ' ticks',
    r.rpc === r.selects && r.selects >= 6, 'rpc=' + r.rpc + ' ticks=' + r.selects);
  ok('\u{1F3AF} \u{1F534} PGRST202: the latch is set (it is a diagnosis flag, not a suppressor)',
    r.latched === true && r.requeued === true, 'latched=' + r.latched + ' requeued=' + r.requeued);
  /* 🎯 WHEN, not just how many. Round 1 spent the one re-queue 1ms after the
     original INSERT, re-firing the trigger against the identical queue contents
     that insert had already been judged against — zero extra opportunity. */
  ok('\u{1F3AF} \u{1F534} PGRST202: NOTHING re-queued in the first ' + EARLY_MS + 'ms (' + r.earlySelects + ' ticks, ' + r.earlyRpc + ' rpc attempts)',
    r.earlyInserts === 0 && r.earlyRpc >= 3, 'earlyIns=' + r.earlyInserts + ' earlyRpc=' + r.earlyRpc);
  ok('\u{1F3AF} \u{1F534} PGRST202: the re-queue landed at the halfway mark (>=' + REQUEUE_AFTER_MS + 'ms into the search)',
    r.insT != null && r.insT >= REQUEUE_AFTER_MS && r.delT >= REQUEUE_AFTER_MS,
    'del@' + r.delT + 'ms ins@' + r.insT + 'ms');
  ok('\u{1F3AF} \u{1F534} PGRST202: the re-queue fallback ran EXACTLY ONCE, not once per tick',
    r.seq.filter((o) => o === 'insert').length === 1, JSON.stringify(r.seq));
  ok('\u{1F3AF} \u{1F534} PGRST202: that re-queue was delete-then-insert, in that order',
    r.seq.length === 2 && r.seq[0] === 'delete' && r.seq[1] === 'insert', JSON.stringify(r.seq));
  ok('\u{1F3AF} \u{1F534} PGRST202: the delete is scoped to my own user_id',
    r.delCol === 'user_id' && r.delVal === 'me-0000-1111', r.delCol + '=' + r.delVal);
  ok('\u{1F3AF} \u{1F534} PGRST202: the re-queued row carries the same six keys and no queued_at',
    r.keys.join(',') === 'deck_json,faction_id,hero_id,mmr,mode,user_id', r.keys.join(','));
  /* No gap between pairing attempts wider than one poll interval + slack. This
     is the assertion the round-1 build failed: its longest gap was ~27.5s. */
  let gap = r.marks.length ? r.marks[0] : Infinity;
  for (let i = 1; i < r.marks.length; i++) gap = Math.max(gap, r.marks[i] - r.marks[i - 1]);
  ok('\u{1F3AF} \u{1F534} PGRST202: longest gap between pairing attempts is one poll interval, not the whole search',
    gap < 4000, 'longestGap=' + Math.round(gap) + 'ms over ' + r.marks.length + ' attempts');
}

/* ── 4 · 🔴 RED CONTROL: a transient rpc error must NOT latch ────────────── */
console.log('  ── live: \u{1F534} CONTROL — a transient rpc error must keep attempting');
{
  const r = await page.evaluate(async () => {
    window.__mmReset({ rpcError: { code: '57014', message: 'canceling statement due to statement timeout' } });
    window.__mmStart();
    await new Promise((z) => setTimeout(z, 11000));
    _stopMatchmakingPoll();
    return { rpc: window.__mm.rpc.length, selects: window.__mm.selects,
      latched: !!Cloud._mmRpcMissing, inserts: window.__mmQ('insert').length };
  });
  ok('\u{1F3AF} \u{1F534} transient rpc error did NOT latch — every tick still attempts pairing',
    r.latched === false && r.rpc === r.selects && r.rpc >= 4, 'rpc=' + r.rpc + ' latched=' + r.latched);
  ok('\u{1F3AF} \u{1F534} transient rpc error triggered ZERO re-queues (the function is not missing)',
    r.inserts === 0, 'inserts=' + r.inserts);
}

/* ── 5 · 🔴 RED: already paired → zero re-queues ─────────────────────────── */
console.log('  ── live: \u{1F534} already paired — never pulled back into the queue');
{
  /* Runs PAST the halfway mark on purpose. An 8-second run would now finish
     before the re-queue was ever eligible and the guard would go untested — the
     run has to reach the one instant where an unguarded build WOULD re-insert. */
  const RUN_MS = REQUEUE_AFTER_MS + 4500;
  const r = await page.evaluate(async ({ RUN_MS }) => {
    /* PGRST202 on purpose: with the rpc ruled out, the re-queue IS the live
       path, so this run really does exercise the matchId guard rather than
       skipping the whole branch. */
    window.__mmReset({ matchId: 'match-already-mine', rpcError: { code: 'PGRST202',
      message: 'Could not find the function public.mm_try_pair in the schema cache' } });
    window.__mmStart();
    await new Promise((z) => setTimeout(z, RUN_MS));
    _stopMatchmakingPoll();
    const out = { inserts: window.__mmQ('insert').length, deletes: window.__mmQ('delete').length,
      selects: window.__mm.selects, rpc: window.__mm.rpc.length, latched: !!Cloud._mmRpcMissing };
    MultiplayerMatch.matchId = null;
    return out;
  }, { RUN_MS });
  ok('\u{1F3AF} \u{1F534} matchId set before the tick — ZERO re-queue inserts across ' + r.selects + ' ticks past the halfway mark',
    r.inserts === 0 && r.selects >= 6, 'inserts=' + r.inserts + ' ticks=' + r.selects);
  ok('\u{1F3AF} \u{1F534} matchId set before the tick — ZERO re-queue deletes either',
    r.deletes === 0, 'deletes=' + r.deletes);
  ok('\u{1F3AF} \u{1F534} … and the run really did reach the re-queue window (latched, ' + r.rpc + ' attempts made)',
    r.latched === true && r.rpc === r.selects, 'latched=' + r.latched + ' rpc=' + r.rpc);
}

/* ── 5b · 🔴 the latch must not outlive the search ───────────────────────── */
console.log('  ── live: \u{1F534} a new search re-probes — applying sql/066 does not need a page reload');
{
  const r = await page.evaluate(async () => {
    /* SEARCH ONE against a server with no mm_try_pair: latches. */
    window.__mmReset({ rpcError: { code: 'PGRST202',
      message: 'Could not find the function public.mm_try_pair in the schema cache' } });
    window.__mmStart();
    await new Promise((z) => setTimeout(z, 3000));
    _stopMatchmakingPoll();
    const latchedAfterOne = !!Cloud._mmRpcMissing;
    /* SEARCH TWO, same page, and now the human has applied sql/066. A
       page-lifetime latch would make this second search do zero rpc calls —
       measured on the round-1 build. */
    window.__mm.rpc = []; window.__mm.selects = 0; window.__mm.calls = [];
    window.__mm.rpcError = null;
    window.__mmStart();
    const clearedAtStart = !!Cloud._mmRpcMissing;
    await new Promise((z) => setTimeout(z, 6000));
    _stopMatchmakingPoll();
    return { latchedAfterOne, clearedAtStart, rpc2: window.__mm.rpc.length,
      selects2: window.__mm.selects, stillLatched: !!Cloud._mmRpcMissing };
  });
  ok('\u{1F3AF} \u{1F534} search #1 latched Cloud._mmRpcMissing', r.latchedAfterOne === true);
  ok('\u{1F3AF} \u{1F534} search #2 cleared it at the top of the search', r.clearedAtStart === false);
  ok('\u{1F3AF} \u{1F534} search #2 called the rpc again — a client already open picks up sql/066',
    r.rpc2 >= 3 && r.rpc2 === r.selects2, 'rpc=' + r.rpc2 + ' ticks=' + r.selects2);
  ok('\u{1F3AF} \u{1F534} search #2 saw the function working, so the latch stayed clear',
    r.stillLatched === false);
}

/* ── 6 · a fed match row moves the screen and sets matchId ───────────────── */
console.log('  ── live: a fed `matches` row is picked up');
{
  const r = await page.evaluate(async () => {
    window.__mmReset({ latched: true, rows: [{
      id: 'match-fed-1', status: 'pending', winner_id: null, created_at: new Date().toISOString(),
      player1_id: 'them-2222', player2_id: 'me-0000-1111',
      hero1_id: 'hero-them', hero2_id: 'hero-9', deck1: { cards: ['u_b'] }, deck2: { cards: ['u_a'] },
    }] });
    App.screen = 'matchmaking';
    App.battlePrep = App.battlePrep || {};
    window.__mmStart();
    await new Promise((z) => setTimeout(z, 800));
    _stopMatchmakingPoll();
    return {
      screen: App.screen, matchId: MultiplayerMatch.matchId,
      oppId: MultiplayerMatch.opponentId, amIPlayer1: MultiplayerMatch.amIPlayer1,
      deletes: window.__mmQ('delete').length, inserts: window.__mmQ('insert').length,
    };
  });
  ok('\u{1F3AF} pickup: App.screen moved off \'matchmaking\'', r.screen !== 'matchmaking', 'screen=' + r.screen);
  ok('\u{1F3AF} pickup: MultiplayerMatch.matchId is the fed row', r.matchId === 'match-fed-1', String(r.matchId));
  ok('\u{1F3AF} pickup: opponent resolved from the other side of the row',
    r.oppId === 'them-2222' && r.amIPlayer1 === false, r.oppId + '/' + r.amIPlayer1);
  ok('\u{1F3AF} pickup: the queue row was released and NEVER re-inserted (the blast-radius guard)',
    r.deletes >= 1 && r.inserts === 0, 'del=' + r.deletes + ' ins=' + r.inserts);
}

/* ── 7 · the AI fallback: 30s, releases the queue, two distinct messages ─── */
console.log('  ── live: the AI fallback');
{
  const r = await page.evaluate(async () => {
    /* Read the constant rather than hard-coding 30000, and shim setTimeout for
       exactly the fallback registration so this does not sit for 30 real
       seconds. The ARMING and the BODY are the production ones. */
    const out = {};
    const realTimeout = window.setTimeout;
    let armedMs = null; let armedFn = null;
    window.setTimeout = function (fn, ms, ...rest) {
      if (ms === MATCHMAKING_AI_FALLBACK_MS && armedFn === null) { armedMs = ms; armedFn = fn; return 999999; }
      return realTimeout.call(window, fn, ms, ...rest);
    };
    window.__mmReset({ latched: true });
    MultiplayerMatch.matchId = null;
    App.battlePrep = { hero: { id: 'hero-9' }, deck: ['u_a'] };
    App.screen = 'deckSelect';
    LobbyPresence.queueCount = 0;
    await startMatchmaking({ deck: ['u_a'], hero: { id: 'hero-9', name: 'Nine' } });
    out.armedMs = armedMs;
    out.screenAfterQueue = App.screen;
    window.setTimeout = realTimeout;
    _stopMatchmakingPoll();

    /* (i) queue effectively empty (just me) → today's wording, no warn */
    window.__mm.calls = []; window.__mm.toasts = []; window.__mm.warns = [];
    LobbyPresence.queueCount = 1;
    MultiplayerMatch.active = true; MultiplayerMatch.matchId = null;
    armedFn();
    await new Promise((z) => setTimeout(z, 500));
    out.emptyToast = window.__mm.toasts.slice();
    out.emptyWarns = window.__mm.warns.slice();
    out.emptyDeletes = window.__mmQ('delete').length;
    out.emptyScreen = App.screen;
    out.emptyMultiplayer = App.battlePrep && App.battlePrep.multiplayer;
    out.matchRowCount = window.__mm.matchRows.length;

    /* (ii) two or more queued and still unpaired → a DIFFERENT message */
    window.__mm.calls = []; window.__mm.toasts = []; window.__mm.warns = [];
    LobbyPresence.queueCount = 3;
    MultiplayerMatch.active = true; MultiplayerMatch.matchId = null;
    armedFn();
    await new Promise((z) => setTimeout(z, 500));
    out.busyToast = window.__mm.toasts.slice();
    out.busyWarns = window.__mm.warns.slice();

    /* (iii) a match landed at the instant the timer elapsed — the fallback must
       say nothing at all and leave the player in their match. */
    window.__mm.toasts = []; window.__mm.warns = [];
    LobbyPresence.queueCount = 3;
    MultiplayerMatch.active = true; MultiplayerMatch.matchId = 'raced-in';
    armedFn();
    await new Promise((z) => setTimeout(z, 300));
    out.racedToast = window.__mm.toasts.slice();
    MultiplayerMatch.matchId = null; MultiplayerMatch.active = false;
    LobbyPresence.queueCount = 0;
    return out;
  });
  ok('\u{1F3AF} fallback: armed at MATCHMAKING_AI_FALLBACK_MS (30s)', r.armedMs === 30000, String(r.armedMs));
  ok('\u{1F3AF} fallback: startMatchmaking put us on the matchmaking screen first',
    r.screenAfterQueue === 'matchmaking', String(r.screenAfterQueue));
  ok('\u{1F3AF} fallback: fired with NO match row — issued the matchmaking_queue delete',
    r.emptyDeletes >= 1 && r.matchRowCount === 0, 'del=' + r.emptyDeletes + ' rows=' + r.matchRowCount);
  /* The fallback sets App.screen = 'vsScreen' and calls render(); render() is
     free to bounce a profile with no starter hero on to 'starterPick', which is
     exactly what this stubbed page is. So assert what the FALLBACK decided —
     battlePrep.multiplayer flipped to false — plus that we left the search
     screen, rather than a final screen name that render() owns. */
  ok('\u{1F3AF} fallback: handed off to the SOLO flow (battlePrep.multiplayer=false) and left the search screen',
    r.emptyMultiplayer === false && r.emptyScreen !== 'matchmaking',
    'mp=' + r.emptyMultiplayer + ' screen=' + r.emptyScreen);
  ok('\u{1F3AF} fallback: empty queue keeps "No opponent found"',
    r.emptyToast.some((t) => /No opponent found/.test(t)), JSON.stringify(r.emptyToast));
  ok('\u{1F3AF} fallback: empty queue does NOT console.warn', r.emptyWarns.length === 0, JSON.stringify(r.emptyWarns));
  ok('\u{1F3AF} fallback: 3 queued — a DIFFERENT message, and not the "no opponent" lie',
    r.busyToast.length > 0 && !r.busyToast.some((t) => /No opponent found/.test(t)), JSON.stringify(r.busyToast));
  const A = r.emptyToast[0] || '', B = r.busyToast[0] || '';
  ok('\u{1F3AF} fallback: the two messages actually differ', A !== '' && B !== '' && A !== B, JSON.stringify([A, B]));
  ok('\u{1F3AF} fallback: 3 queued — console.warn names trigger_pair_match AND mm_try_pair',
    r.busyWarns.some((w) => /trigger_pair_match/.test(w) && /mm_try_pair/.test(w)), JSON.stringify(r.busyWarns));
  ok('\u{1F3AF} fallback: a match that raced the timer suppresses BOTH messages',
    r.racedToast.length === 0, JSON.stringify(r.racedToast));
}

/* ── 8 · 🔴 RED: the queue insert rejects — prove section 1 discriminates ── */
console.log('  ── live: \u{1F534} RED CHECK — the queue INSERT rejects');
{
  const r = await page.evaluate(async () => {
    window.__mmReset({ rejectInsert: true });
    let res;
    try {
      res = await cloudEnterMatchmaking({ mode: 'ranked', hiddenMmr: 1200, factionId: null, heroId: 'h', deck: {} });
    } catch (e) { res = { ok: false, error: 'threw: ' + String(e) }; }
    _stopMatchmakingPoll();
    window.__mm.rejectInsert = false;
    return { okRes: !!(res && res.ok), recordedInsert: window.__mm.calls.filter((c) => c.op === 'insert').length };
  });
  /* Deliberately inverted. Section 1 asserts okRes === true; the SAME code path
     with a rejecting insert must report okRes === false, which is what makes
     that assertion discriminating rather than decorative. Production swallows
     this error at the tick's catch, so a driver that only counted calls would
     stay green over a queue write that never landed — the second line below is
     the proof of exactly that. */
  ok('\u{1F3AF} \u{1F534} rejecting insert → cloudEnterMatchmaking returns ok:false (section 1 is discriminating)',
    r.okRes === false);
  ok('\u{1F3AF} \u{1F534} … and the call WAS still recorded, so a call-count-only assertion would have stayed green',
    r.recordedInsert === 1, 'recorded=' + r.recordedInsert);
}

/* ── 8b · 🔴 RED: the re-queue INSERT is REFUSED (resolved, not thrown) ──── */
console.log('  ── live: \u{1F534} RED CHECK — the re-queue INSERT resolves with {error}');
{
  /* THE ORPHAN. The re-queue is delete-then-insert. postgrest-js RESOLVES with
     { error } on an RLS denial / 5xx / token-refresh 401 — it does not throw —
     so before this round the tick's transient catch never saw it, _mmRequeued
     stayed latched (it is set BEFORE the awaits), and the player finished the
     search with the DELETE applied and nothing put back: invisible to the
     AFTER-INSERT trigger, which is the only live pairing mechanism while
     sql/066 is unapplied. Measured on the round-2 build by
     .gauntlet/_crit-requeue-orphan.mjs: ops = ["delete","insert"], the insert
     refused 42501, _mmRequeued = true, no further attempt for the rest of the
     search. Strictly worse than never re-queueing at all. */
  const RUN_MS = REQUEUE_AFTER_MS + 6000;   // the refused attempt + >=2 more ticks
  const r = await page.evaluate(async ({ RUN_MS }) => {
    window.__mmReset({
      rpcError: { code: 'PGRST202', message: 'Could not find the function public.mm_try_pair in the schema cache' },
      insertFailsLeft: 1,
      insertError: { code: '42501', message: 'new row violates row-level security policy for table "matchmaking_queue"' },
    });
    window.__mmStart();
    await new Promise((z) => setTimeout(z, RUN_MS));
    _stopMatchmakingPoll();
    return {
      inserts: window.__mmQ('insert').length, deletes: window.__mmQ('delete').length,
      queueRows: window.__mm.queueRows.length,
      queueUser: (window.__mm.queueRows[0] || {}).user_id,
      queueKeys: window.__mm.queueRows.length ? Object.keys(window.__mm.queueRows[0]).sort().join(',') : '',
      requeued: !!Cloud._mmRequeued, warns: window.__mm.warns.slice(), selects: window.__mm.selects,
    };
  }, { RUN_MS });
  ok('\u{1F3AF} \u{1F534} refused re-insert: the client ENDS THE SEARCH STILL HOLDING A QUEUE ROW',
    r.queueRows === 1 && r.queueUser === 'me-0000-1111', 'rows=' + r.queueRows + ' user=' + String(r.queueUser));
  ok('\u{1F3AF} \u{1F534} refused re-insert: it was RETRIED on a later tick (round 2 stopped at one)',
    r.inserts >= 2, 'inserts=' + r.inserts + ' over ' + r.selects + ' ticks');
  ok('\u{1F3AF} \u{1F534} refused re-insert: every retry is a full delete-then-insert pair, never an upsert',
    r.deletes === r.inserts, 'del=' + r.deletes + ' ins=' + r.inserts);
  ok('\u{1F3AF} \u{1F534} refused re-insert: the retry carries the same six keys, still no queued_at',
    r.queueKeys === 'deck_json,faction_id,hero_id,mmr,mode,user_id', r.queueKeys);
  ok('\u{1F3AF} \u{1F534} refused re-insert: the failure was WARNED, not swallowed like the reads',
    r.warns.some((w) => /re-insert FAILED/.test(w) && /42501|row-level security/.test(w)),
    JSON.stringify(r.warns.slice(0, 2)));
  ok('\u{1F3AF} \u{1F534} refused re-insert: once a retry lands, the once-per-search latch is back on',
    r.requeued === true);

  /* CONTROL — a re-insert that SUCCEEDS first time must still fire EXACTLY
     ONCE. The un-latch is for failures only; unconditional, it would turn the
     fallback into a per-tick re-queue loop re-firing trigger_pair_match every
     2.5s, which is the "two different boards" blast radius. */
  const c = await page.evaluate(async ({ RUN_MS }) => {
    window.__mmReset({ rpcError: { code: 'PGRST202',
      message: 'Could not find the function public.mm_try_pair in the schema cache' } });
    window.__mmStart();
    await new Promise((z) => setTimeout(z, RUN_MS));
    _stopMatchmakingPoll();
    return { inserts: window.__mmQ('insert').length, queueRows: window.__mm.queueRows.length,
      requeued: !!Cloud._mmRequeued };
  }, { RUN_MS });
  ok('\u{1F3AF} \u{1F534} CONTROL: a re-insert that SUCCEEDS still fires exactly once for the rest of the search',
    c.inserts === 1 && c.queueRows === 1 && c.requeued === true,
    'inserts=' + c.inserts + ' rows=' + c.queueRows);
}

ok('\u{1F3AF} no page errors during the run', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\n⚠  NOT PROVEN HERE: two real accounts meeting. Cloud.client is a stub, no');
console.log('   socket is opened and no trigger runs. mm_try_pair() does not exist on any');
console.log('   server — it ships in sql/066_matchmaking_server.sql, which has NOT been');
console.log('   applied — so in production every rpc call above returns PGRST202 today, and');
console.log('   what runs is a failing round-trip per tick plus one re-queue at the halfway');
console.log('   mark. That is a client state machine behaving correctly under a stub. It is');
console.log('   NOT evidence that matchmaking pairs anybody.');
console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ ALL PASS') + '\n');
process.exit(fails ? 1 : 0);
