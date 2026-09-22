/* 🏙 CITY LOAD, STORAGE AND SAVE — five reports from one player group.

   · bug-mtr5xz8t "Managed cities not loading first time after a break … sit on
     the blank gameplay screen with just the control bars". v121v92 retried a
     REFUSED read; nothing bounded a read that never answers. After hours idle
     the first request can hang (expired token being refreshed, a dead pooled
     connection), and boot() awaited it for ever: the 9 s failsafe lifts the
     spinner over a city that never loads. Now every city read is bounded, a
     timeout is a refusal (so the existing refresh-and-retry runs), and a read
     that answers late can no longer overwrite a newer read's record.
   · bug-mu6bxip6 "saved to another device when no other device is logged in".
     The toast is node-city's save CONFLICT. A read from an EARLIER open (the
     stalled first open above, left behind by exit-and-re-enter) resolved after
     the new open had read and saved, put the older row version back on record,
     and the next autosave was refused against this device's own write.
   · bug-mu424ej6 "Browser Storage Warning" — every client city a mayor opens
     leaves a ~150 KB copy in localStorage and nothing ever removed one. A full
     origin now evicts the least-recently-opened copies the server has
     confirmed, never the city on screen and never an unconfirmed one.

   Run: node _cityload_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const NC = readFileSync('./public/node-city/index.html', 'utf8');
function fnText(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('cannot find ' + head);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = (p, ms) => Promise.race([p.then((v) => ({ done: true, v })), sleep(ms).then(() => ({ done: false }))]);

/* A fake PostgREST: every city_state select is answered by `plan(n)` — n is
   the 0-based read index — which returns { ms, row } or { hang: true }. */
function fakeCloud(plan) {
  let n = 0;
  const reads = [];
  const q = () => {
    const b = {
      select() { return b; }, eq() { return b; }, is() { return b; }, limit() { return b; },
      maybeSingle() {
        const i = n++; const p = plan(i); reads.push(i);
        if (p.hang) return new Promise(() => {});
        return new Promise((res) => setTimeout(() => res(p.err ? { data: null, error: p.err } : { data: p.row, error: null }), p.ms || 0));
      },
      then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
    };
    return b;
  };
  return {
    reads,
    client: {
      from: () => q(),
      rpc: async () => ({ data: null, error: { code: 'X' } }),
      auth: { refreshSession: async () => ({}) },
    },
  };
}
function parentCtx(plan, opts = {}) {
  const fc = fakeCloud(plan);
  const ctx = {
    Cloud: { ready: true, client: fc.client },
    Profile: { cloud: { userId: 'me' } },
    App: { _cityOwnerId: opts.mayor ? 'owner' : null, _cityNodeId: 'N-26', _cityResolveToken: 1 },
    CITY_NODE_SENTINEL: 'local-city',
    window: {},
    console: { warn() {}, log() {} },
    showToast() {}, setTimeout, clearTimeout, Promise, Date, Number, String, Set, JSON, Object,
    _cityStateUserId: () => opts.mayor ? 'owner' : 'me',
    _cityNodeKey: () => 'N-26',
    _cityClaimNode: async () => false,
    reads: fc.reads,
  };
  vm.createContext(ctx);
  const decl = SRC.slice(SRC.indexOf('App._cityRow = null;'), SRC.indexOf('/* The one read of a city row.'));
  vm.runInContext(decl.replace('CITY_ROW_READ_MS = 10000', 'CITY_ROW_READ_MS = 300') + '\n' + fnText(SRC, 'async function _cityRowRead(target, nodeKey)') + '\n' +
    fnText(SRC, 'window.cityStateLoad = async function ()') + ';\nthis.load = window.cityStateLoad; this.rowRead = _cityRowRead;', ctx);
  return ctx;
}

/* ── 1. bug-mtr5xz8t: a read that never answers ─────────────────────────── */
{
  const row = { state: { tiles: { '1,1': { type: 'house' } }, savedAt: 5 }, updated_at: 't1', version: 7 };
  // First read hangs for ever (the stale-connection / stuck-refresh case), the retry answers.
  const c = parentCtx((i) => i === 0 ? { hang: true } : { ms: 5, row });
  const r = await settle(c.load(), 20000);
  ok(r.done, 'a hung first city_state read no longer hangs the load');
  ok(r.done && typeof r.v === 'string' && r.v.indexOf('house') > 0, '…and the retry behind it returns the city', r.done ? String(r.v).slice(0, 60) : 'pending');
  ok(r.done && c.window.__cityLoadUnsafe === false, '…as a trusted read (unsafe flag clear)');
  ok(c.App._cityRow && c.App._cityRow.version === 7, '…and records the version it loaded', JSON.stringify(c.App._cityRow));
  // Both reads hang: the load must still answer, and answer "not proven".
  const c2 = parentCtx(() => ({ hang: true }));
  const r2 = await settle(c2.load(), 30000);
  ok(r2.done && r2.v === null && c2.window.__cityLoadUnsafe === true, 'two hung reads answer null with the unsafe flag raised (never "no city")', JSON.stringify(r2));
}

/* ── 2. bug-mu6bxip6: a late answer must not put an older version on record ── */
{
  const v7 = { state: { tiles: {}, savedAt: 1 }, updated_at: 't7', version: 7 };
  const v8 = { state: { tiles: {}, savedAt: 2 }, updated_at: 't8', version: 8 };
  // read 0 (the stalled first open) is served v7 but answers LATE; read 1 (the re-entry) answers v8 at once.
  const c = parentCtx((i) => i === 0 ? { ms: 400, row: v7 } : { ms: 5, row: v8 });
  const first = c.rowRead('me', 'N-26');
  await sleep(20);
  await c.rowRead('me', 'N-26');
  ok(c.App._cityRow && c.App._cityRow.version === 8, 'the newer read is on record', JSON.stringify(c.App._cityRow));
  await first;
  ok(c.App._cityRow && c.App._cityRow.version === 8, 'an OLDER read answering afterwards does not replace it (the false "another device" conflict)', JSON.stringify(c.App._cityRow));
}

/* ── node-city: the shipped bridge, instantiated against a fake parent ────── */
function bridgeText(src) {
  const at = src.indexOf('const MythicCityBridge = (() =>');
  const i = src.indexOf('{', at);
  // brace-match, skipping comments and strings (the bridge is full of both)
  let d = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (c === '/' && n === '*') { k = src.indexOf('*/', k + 2) + 1; continue; }
    if (c === '/' && n === '/') { k = src.indexOf('\n', k + 2); continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; k++; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++; } continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
}
const BRIDGE = bridgeText(NC);
function quotaLS(limit, seed) {
  const m = new Map(Object.entries(seed || {}));
  const used = () => { let n = 0; for (const [k, v] of m) n += k.length + v.length; return n; };
  return {
    m,
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      v = String(v);
      const next = used() - (m.has(k) ? k.length + m.get(k).length : 0) + k.length + v.length;
      if (next > limit) { const e = new Error("Failed to execute 'setItem' on 'Storage': Setting the value of '" + k + "' exceeded the quota."); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, v);
    },
    removeItem: (k) => { m.delete(k); },
  };
}
function makeBridge(P, LS, text) {
  const fn = new Function('window', 'localStorage', 'location', 'URLSearchParams', 'console', 'setTimeout',
    'return (() => ' + (text || BRIDGE) + ')();');
  return fn({ parent: P, addEventListener: () => {} }, LS, { search: '' }, URLSearchParams, { warn() {}, log() {}, error() {} }, setTimeout);
}
const pad = (n) => 'x'.repeat(n);
const blob = (o, n) => JSON.stringify(Object.assign({ tiles: { '1,1': { type: 'house' } }, pad: pad(n) }, o));

/* ── 3. bug-mtr5xz8t (node-city half): the boot's host reads are bounded ── */
{
  const P = { getRes: () => 0, addCinders() {}, __cityLoadUnsafe: false,
    cityStateUserId: () => 'client9', cityNodeIdForKey: () => 'N-26',
    cityOwnerIdentity: () => ({ viewerId: 'me', isOwner: false }),
    cityStateLoad: () => new Promise(() => {}), cityOwnerNodes: () => new Promise(() => {}) };
  const B = makeBridge(P, quotaLS(1e9), BRIDGE.replace('_ncBound(P.cityStateLoad(), 30000', '_ncBound(P.cityStateLoad(), 200')
    .replace('_ncBound(P.cityOwnerNodes(), 10000', '_ncBound(P.cityOwnerNodes(), 200'));
  ok(B.mode === 'parent', 'the bridge runs in parent mode against the fake host');
  const a = await settle(B.fetchNodes(), 3000);
  ok(a.done && Array.isArray(a.v) && a.v.length === 0, "a managed city's anchor read that never answers gives the empty ring, and boot carries on", JSON.stringify(a));
  ok(B.nodesUnknown === true, '…flagged unknown, so spawnAnchors does not claim "the owner holds no PRN nodes"');
  ok(/if \(!nodes\.length && !MythicCityBridge\.nodesUnknown\) \{/.test(NC), 'spawnAnchors stays quiet when the ring was never answered');
  const l = await settle(B.loadCity(), 3000);
  ok(l.done && l.v === null && B.loadUnsafe === true, 'a city read that never answers is an UNPROVEN read (null + loadUnsafe) — boot then reads again', JSON.stringify(l) + ' unsafe=' + B.loadUnsafe);
  ok(/if \(_loadFailed && !Object\.keys\(game\.tiles \|\| \{\}\)\.length\) \{\s*await new Promise\(\(r\) => setTimeout\(r, 2500\)\);/.test(NC), '…and boot() reads again when the first read was unproven and nothing local stood in');
}

/* ── 4. bug-mu424ej6: a full origin evicts only copies this device no longer needs ── */
{
  const now = Date.now(), DAY = 864e5, base = 'mythic_node_city_v2:';
  const seed = {
    [base + 'me@N-1']: blob({ _owner: 'me', _node: 'N-1', savedAt: now - 2 * DAY }, 30000),            // own, server has it → rule 1
    [base + 'client1@N-5']: blob({ _owner: 'client1', _node: 'N-5', savedAt: now - 10 * DAY }, 30000),  // client, legacy, old → rule 3
    [base + 'client2@N-6']: blob({ _owner: 'client2', _node: 'N-6', savedAt: now - 10 * DAY, ecoDefer: 1 }, 30000), // deferred → never
    [base + 'me@N-2']: blob({ _owner: 'me', _node: 'N-2', savedAt: now - 10 * DAY }, 30000),            // own, unproven → never
    [base + 'me@N-3:conflict']: blob({ _owner: 'me', _node: 'N-3', savedAt: now - 10 * DAY }, 30000),   // old side copy → rule 2
    [base + 'client3@N-7']: blob({ _owner: 'client3', _node: 'N-7', savedAt: now - DAY }, 30000),       // client, recent, unproven → never
    nc_city_lru: JSON.stringify({ [base + 'me@N-1']: { o: now - 5 * DAY, s: now - 2 * DAY } }),
    hg_profile: pad(40000),                                                                              // the rest of the game
  };
  const LS = quotaLS(0, seed);
  let used = 0; for (const [k, v] of LS.m) used += k.length + v.length;
  const P = { getRes: () => 0, addCinders() {}, __cityLoadUnsafe: false,
    cityStateUserId: () => 'client9', cityNodeIdForKey: () => 'N-26',
    cityOwnerIdentity: () => ({ viewerId: 'me', isOwner: false }),
    cityStateSave: async () => true };
  const B = makeBridge(P, LS);
  const payload = blob({ savedAt: now }, 60000);
  const order = B.cityEvictable(base + 'client9@N-26').map((c) => c.k.replace(base, '') + ':' + c.tier).join(' ');
  ok(order === 'me@N-1:1 me@N-3:conflict:2 client1@N-5:3', 'eligible copies, in eviction order: proven-on-server, old side copy, old client-city cache', order);
  // Room for everything already there plus ~one more city, less than the new 60k one: two copies must go.
  const L2 = quotaLS(used + 5000, Object.fromEntries(LS.m));
  const B2 = makeBridge(P, L2);
  const r = await B2.saveCity(payload);
  ok(r === true && L2.getItem(base + 'client9@N-26') !== null && B2.lastLocalSaveFailed === false, "the client city's save lands on a full origin", 'saveCity=' + r + ' failed=' + B2.lastLocalSaveFailed);
  ok(L2.getItem(base + 'me@N-1') === null, 'rule 1 went first: my own other city, which the server confirmed');
  ok(L2.getItem(base + 'me@N-3:conflict') === null, 'rule 2 next: a week-old conflict side copy');
  ok(L2.getItem(base + 'me@N-2') !== null, "NEVER my own city's unproven copy");
  ok(L2.getItem(base + 'client2@N-6') !== null, 'NEVER a copy written while its founding was undecided (ecoDefer)');
  ok(L2.getItem(base + 'client3@N-7') !== null, "NEVER a recent unproven copy of a client's city");
  ok(L2.getItem('hg_profile') !== null, 'nothing outside the city keys is touched');
  const lru = JSON.parse(L2.getItem('nc_city_lru') || '{}');
  ok(lru[base + 'client9@N-26'] && lru[base + 'client9@N-26'].s === now, 'the accepted server save is recorded in the index (this copy is now provably on the server)', JSON.stringify(lru));
  // Tight enough that nothing eligible is left: the refusal is still reported, and the unproven copies survive.
  const L3 = quotaLS(used - 60000, Object.fromEntries(LS.m));
  const B3 = makeBridge(P, L3);
  const r3 = await B3.saveCity(blob({ savedAt: now }, 200000));
  ok(B3.lastLocalSaveFailed === true && L3.getItem(base + 'me@N-2') !== null && L3.getItem(base + 'client2@N-6') !== null,
    'with too little to reclaim the save is still refused loudly and no unproven copy is sacrificed', 'failed=' + B3.lastLocalSaveFailed);
  // Opening a city notes it: a trusted server row proves the copy it replaces.
  const L4 = quotaLS(1e9);
  const P4 = Object.assign({}, P, { cityStateLoad: async () => blob({ savedAt: 1234 }, 10), cityStateWasDeleted: async () => false });
  const B4 = makeBridge(P4, L4);
  await B4.loadCity();
  const lru4 = JSON.parse(L4.getItem('nc_city_lru') || '{}');
  ok(lru4[base + 'client9@N-26'] && lru4[base + 'client9@N-26'].s === 1234 && lru4[base + 'client9@N-26'].o > 0, 'loadCity records the open and the trusted server savedAt', JSON.stringify(lru4));
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ all passed') + ' (' + passes + ' passes)');
process.exit(fails ? 1 : 0);
