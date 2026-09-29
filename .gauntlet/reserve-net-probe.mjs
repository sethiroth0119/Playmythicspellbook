/* ==========================================================================
   RESERVE-NET PROBE — (1) every client reader of Reserve contribution TOTALS
   reads the NET figures (sql/163 reserve_contributions_net), and (2) a PRN
   node payout comes ONLY from the server (sql/165 fr_node_payout).

   The page sits on a sign-in gate, so the functions are driven directly with
   Cloud.client replaced by an in-page fake Supabase (the shape of
   reserve-rpc-probe.mjs's fake): raw reserve_contributions rows, an
   append-only adjustment set, the net view computed from both exactly as
   sql/163 defines it, economy_nodes / node_payouts, and a model of the
   sql/165 RPC contract (nonce log, server-priced credit, canonical balance).
   The fake server pays FAKE_PAY — a number the client preview can never
   produce — so "the payout came from the RPC" is visible in the numbers.

   Fixture: the probe player has 5,000 GROSS points and 3,000 NET (two
   negative adjustments); the rival has 4,000. By the gross figure the probe
   player leads the board, is "Strategic Contributor" and is the metal baron;
   by the net figure they are #2, "Foundation Supplier", and the rival is.

   Checks
     N1-N7  leaderboard, own rank, myPoints, repPoints (MythicInfluenceBridge),
            Reserve Powers (barons), the admin dossier and the node payout
            preview base all move with a negative adjustment.
     N8     no raw reserve_contributions reader is left except the name-only
            searches (static, over the page source).
     P1     a collect goes through fr_node_payout (once), writes nothing
            itself (no node_payouts insert, no economy_nodes claim CAS), no
            client addCinders / addGems, and the balance is the server's.
     P2     lost response: the retry reuses the nonce; credited once.
     P3     refused: nothing paid anywhere.
     P4     function missing (sql/165 not applied): nothing paid.
     P5     no answer: nothing paid, the nonce is parked; the flush lands it
            exactly once.
     P6     nodeCollect's source holds no client credit (static).

   Usage: node .gauntlet/reserve-net-probe.mjs [page.html]   (:8787 up)
   With no argument the live public/index.html is served. Exit 1 on failure.
   It FAILS on HEAD (pre-patch) — that is the "before".
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'node:fs';

const pagePath = process.argv[2] || null;
const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
let pageSrc;
if (pagePath) {
  pageSrc = fs.readFileSync(pagePath, 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageSrc }));
} else {
  pageSrc = await (await fetch('http://localhost:8787/index.html')).text();
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 90000 });
await p.waitForFunction(() => typeof window.frLeaderboardFetch === 'function' && typeof window.nodeCollect === 'function'
  && typeof window.frFetch === 'function', null, { timeout: 90000 });
console.log('page: ' + (pagePath || 'live public/index.html'));

// N8 — static: the only raw readers left are the name searches.
const rawAll = (pageSrc.match(/from\('reserve_contributions'\)/g) || []).length;
const rawNames = (pageSrc.match(/from\('reserve_contributions'\)\.select\('user_id,user_name'\)\.ilike\(/g) || []).length;

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const U = '00000000-0000-4000-8000-0000000fc165';
  const RIVAL = '00000000-0000-4000-8000-00000000a1a1';
  const CP = '00000000-0000-4000-8000-0000000c0c0c';
  const FAKE_PAY = 777;          // what the fake server pays per collect

  // ---------------------------------------------------------------- server
  let clock = Date.parse('2026-09-19T09:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();
  const srv = {
    raw: [
      { user_id: U, user_name: 'Probe', resource: 'metal', qty: 900, points: 3000 },
      { user_id: U, user_name: 'Probe', resource: 'fuel', qty: 200, points: 2000 },
      { user_id: RIVAL, user_name: 'Rival', resource: 'metal', qty: 700, points: 4000 },
    ],
    adj: [
      { user_id: U, res_id: 'metal', qty: -400, points: -1000 },
      { user_id: U, res_id: 'fuel', qty: -200, points: -1000 },
    ],
    nodes: [], payoutsInserted: 0, nodeUpdates: 0, log: {}, cinder: 1000, row: null,
    rpcCalls: [], reads: [], mode: 'ok', lostOnce: false,
  };
  // sql/163: net = raw + sum(adjustments), floored at 0, per (user, resource).
  const netRows = () => srv.raw.map((c) => {
    let q = 0, pts = 0;
    srv.adj.forEach((a) => { if (a.user_id === c.user_id && a.res_id === c.resource) { q += a.qty; pts += a.points; } });
    return Object.assign({}, c, { qty: Math.max(0, c.qty + q), points: Math.max(0, c.points + pts) });
  });
  const rpc = async (fn, args) => {
    srv.rpcCalls.push({ fn, args: clone(args || {}), mode: srv.mode });
    if (fn !== 'fr_node_payout') return { data: null, error: null };
    if (srv.mode === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fr_node_payout' } };
    if (srv.mode === 'down') return { data: null, error: { code: '', message: 'Failed to fetch' } };
    if (srv.mode === 'refuse') return { data: { ok: false, error: 'cooldown', node_id: args.p_node_id, left_ms: 3 * 3600000 }, error: null };
    const nonce = String(args.p_client_nonce || '');
    let j;
    const lg = srv.log[nonce];
    if (lg) {
      j = lg.node !== args.p_node_id ? { ok: false, error: 'nonce_conflict' }
        : Object.assign({}, lg.res, { already: true, cinder: srv.cinder, wallet_seq: 0 });
    } else {
      const n = srv.nodes.find((x) => x.id === args.p_node_id);
      if (!n || n.owner_id !== U) j = { ok: false, error: 'not_your_node' };
      else {
        srv.cinder += FAKE_PAY; if (srv.row) srv.row.gems = srv.cinder;
        n.meta = Object.assign({}, n.meta, { lastClaim: Date.now(), claimedPoints: 3000, rev: (n.meta.rev | 0) + 1 });
        const res = { ok: true, already: false, node_id: n.id, credited: FAKE_PAY, wanted: FAKE_PAY, clamped: false,
                      pool: { total: 50000000, paid: 100000, avail: 49900000 }, tier: { rate: 0.5, bp: 10050, mul: 1.005, name: 'Free' } };
        srv.log[nonce] = { node: n.id, res };
        j = Object.assign({}, res, { cinder: srv.cinder, wallet_seq: 0 });
      }
    }
    if (srv.mode === 'lost' && !srv.lostOnce) { srv.lostOnce = true; return { data: null, error: { code: '', message: 'Failed to fetch' } }; }
    return { data: j, error: null };
  };

  // ------------------------------------------------------------ fake client
  function q(table) {
    const st = { table, op: 'select', cols: '', filters: {}, ins: {}, payload: null, single: false, order: null };
    const exec = async () => {
      if (st.op === 'select') srv.reads.push({ table, cols: st.cols });
      if (table === 'user_profiles') {
        if (st.op === 'select') return { data: srv.row ? clone(srv.row) : null, error: null };
        srv.row = Object.assign(srv.row || {}, clone(st.payload || {}), { gems: srv.cinder, updated_at: tick() });
        return { data: [{ updated_at: srv.row.updated_at }], error: null };
      }
      if (table === 'reserve_contributions' || table === 'reserve_contributions_net') {
        if (st.op !== 'select') return { data: null, error: { code: '42501', message: 'permission denied' } };
        let rows = table === 'reserve_contributions' ? clone(srv.raw) : netRows();
        if (st.filters.user_id) rows = rows.filter((r) => r.user_id === st.filters.user_id);
        if (st.ins.user_id) rows = rows.filter((r) => st.ins.user_id.includes(r.user_id));
        if (st.order) rows.sort((a, b2) => (b2[st.order] || 0) - (a[st.order] || 0));
        return { data: rows, error: null };
      }
      if (table === 'reserve_totals') return { data: [], error: null };
      if (table === 'economy_nodes') {
        if (st.op === 'select') {
          let rows = clone(srv.nodes);
          if (st.filters.id) rows = rows.filter((r) => r.id === st.filters.id);
          if (st.filters.corp_id) rows = rows.filter((r) => r.corp_id === st.filters.corp_id);
          return { data: rows, error: null };
        }
        if (st.op === 'update') {
          // The pre-165 client claim CAS. Recorded, and applied as en_upd allowed.
          srv.nodeUpdates++;
          const n = srv.nodes.find((r) => r.id === st.filters.id);
          if (n && st.payload) Object.assign(n, clone(st.payload));
          return { data: n ? [{ id: n.id }] : [], error: null };
        }
      }
      if (table === 'node_payouts') {
        if (st.op === 'insert') { srv.payoutsInserted++; return { data: null, error: null }; }
        return { data: [], error: null };
      }
      return { data: st.single ? null : [], error: null, count: 0 };
    };
    const api = {
      select(c) { if (st.op === 'select') st.cols = c || ''; return api; },
      eq(k, v) { st.filters[k] = v; return api; }, in(k, v) { st.ins[k] = v; return api; },
      neq() { return api; }, gt() { return api; }, gte() { return api; }, lt() { return api; }, lte() { return api; }, is() { return api; },
      ilike() { return api; }, like() { return api; }, or() { return api; }, not() { return api; }, filter() { return api; },
      contains() { return api; }, match() { return api; }, order(k) { st.order = k; return api; }, limit() { return api; }, range() { return api; },
      maybeSingle() { st.single = true; return api; }, single() { st.single = true; return api; },
      update(pl) { st.op = 'update'; st.payload = pl; return api; },
      upsert(pl) { st.op = 'upsert'; st.payload = pl; return api; },
      insert(pl) { st.op = 'insert'; st.payload = pl; return api; },
      delete() { st.op = 'delete'; return api; },
      then(res, rej) { return exec().then(res, rej); },
    };
    return api;
  }
  const fake = {
    from: q, rpc,
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    removeChannel() {},
    auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: { id: U } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: {} }) }) },
  };

  const spy = { addCinders: 0, addGems: 0 };
  const _ac = window.addCinders, _ag = window.addGems;
  window.addCinders = function () { spy.addCinders++; return _ac.apply(this, arguments); };
  window.addGems = function () { spy.addGems++; return _ag.apply(this, arguments); };
  const spyReset = () => { spy.addCinders = 0; spy.addGems = 0; };
  const toasts = []; const _st = window.showToast; window.showToast = (m) => { toasts.push(String(m)); };

  // ----------------------------------------------------------- the account
  Cloud.ready = true; Cloud.client = fake;
  Object.assign(Profile.cloud, { signedIn: true, userId: U, displayName: 'Probe', email: '', lastLocalEditAt: 0, pendingChanges: false,
    _hydratedFromCloud: true, _foreignProfile: false, _forceRestoreFromCloud: false });
  try { localStorage.setItem(PROFILE_OWNER_KEY, U); } catch (e) {}
  try { localStorage.removeItem('mythic_np_pend_' + U); } catch (e) {}
  try { if (typeof MultiTab !== 'undefined' && MultiTab) MultiTab.amWriter = true; } catch (e) {}
  srv.row = { user_id: U, display_name: 'Probe', gems: srv.cinder, forge: {}, wallet_seq: 0, updated_at: tick() };
  try { _gemsTaxExempt(() => { Profile.gems = srv.cinder; }); } catch (e) { Profile.gems = srv.cinder; }
  FoundationReserve.tableMissing = false;
  try { Corp.mine = { id: CP, tag: 'PRB', name: 'Probe Corp' }; } catch (e) {}

  // ------------------------------------------------------ N. the net readers
  await frLeaderboardFetch();
  const lb = FoundationReserve.leaderboard || [], me = FoundationReserve.lbMe || {};
  ok('N1 leaderboard reads NET: the rival (4,000) leads, the probe player shows 3,000',
     lb[0] && lb[0].name === 'Rival' && lb[1] && lb[1].me && lb[1].points === 3000, lb.map(x => x.name + ':' + x.points).join(', '));
  ok('N2 own rank on the board is NET (#2, 3,000 points)', me.pos === 2 && me.points === 3000, JSON.stringify({ pos: me.pos, points: me.points }));
  ok('N3 the rank title follows the NET points (Foundation Supplier, not Strategic Contributor)',
     me.rank && me.rank.name === 'Foundation Supplier', me.rank && me.rank.name);
  await frFetch();
  ok('N4 myPoints is NET (3,000; gross would be 5,000)', FoundationReserve.myPoints === 3000, FoundationReserve.myPoints);
  let rep = null; try { rep = window.MythicInfluenceBridge.repPoints(); } catch (e) { rep = 'ERR ' + e.message; }
  ok('N5 MythicInfluenceBridge.repPoints() is NET', rep === 3000, rep);
  const B = FoundationReserve.barons || {};
  ok('N6 Reserve Powers read NET: the rival (700) is the metal baron, not the probe player (900 gross / 500 net)',
     B.metal && B.metal.userId === RIVAL, JSON.stringify(B.metal));
  let dos = null; try { dos = await _admDossier({ user_id: U, handle: 'Probe' }); } catch (e) { dos = { rep: 'ERR ' + e.message }; }
  ok('N7a the admin dossier shows NET rep (3,000)', dos && dos.rep === 3000, dos && dos.rep);
  // The payout preview base: a node whose marker sits at 3,500 has nothing
  // fresh against the NET 3,000 (it would show 1,500 fresh against gross).
  const w = (typeof _nodeRiskWindow === 'function') ? _nodeRiskWindow() : 0;
  const preview = { id: 'probe-preview', owner_id: U, corp_id: CP, name: 'Preview', node_type: 'supply', level: 1, status: 'active',
                    meta: { claimedPoints: 3500, lastClaim: 0, eff: 100, lastTick: Date.now(), rev: 1, riskClear: w } };
  ok('N7b the node payout preview base is NET (marker 3,500 > net 3,000 → nothing claimable)', _nodeClaimable(preview) === 0, _nodeClaimable(preview));
  const netReads = srv.reads.filter(r => r.table === 'reserve_contributions_net').length;
  const rawTotals = srv.reads.filter(r => r.table === 'reserve_contributions' && /points|qty/.test(r.cols)).length;
  ok('N7c every totals read in N1-N7 hit reserve_contributions_net (none hit the raw table)', netReads >= 4 && rawTotals === 0, 'net=' + netReads + ' rawTotals=' + rawTotals);

  // ---------------------------------------------------------- P. the payout
  const mkNode = (id) => {
    const n = { id, owner_id: U, corp_id: CP, name: 'PRB ' + id, node_type: 'supply', level: 1, status: 'active',
                meta: { claimedPoints: 0, lastClaim: 0, eff: 100, lastTick: Date.now(), rev: 3, riskClear: w, role: 'town' },
                updated_at: new Date().toISOString() };
    srv.nodes.push(n);
    FoundationReserve.nodes = clone(srv.nodes);
    return n;
  };
  const calls = () => srv.rpcCalls.filter(c => c.fn === 'fr_node_payout');
  const lastToast = () => toasts[toasts.length - 1] || '';

  // P1. a plain collect.
  spyReset(); srv.mode = 'ok';
  mkNode('00000000-0000-4000-8000-000000000001');
  const n1 = srv.nodes[0].id;
  const preview1 = _nodeRealPay(FoundationReserve.nodes.find(x => x.id === n1));
  const c0 = srv.cinder, pi0 = srv.payoutsInserted, nu0 = srv.nodeUpdates, k0 = calls().length;
  const r1 = await nodeCollect(n1);
  const p1 = calls().slice(k0);
  ok('P1a the collect is accepted', r1 === true, r1);
  ok('P1b it went through fr_node_payout, once, with the node id and a nonce',
     p1.length === 1 && p1[0].args.p_node_id === n1 && String(p1[0].args.p_client_nonce || '').length >= 8, JSON.stringify(p1.map(c => c.args)));
  ok('P1c the client wrote NO node_payouts row and NO economy_nodes claim update',
     srv.payoutsInserted === pi0 && srv.nodeUpdates === nu0, 'inserts ' + (srv.payoutsInserted - pi0) + ' updates ' + (srv.nodeUpdates - nu0));
  ok('P1d no client-side addCinders / addGems', spy.addCinders === 0 && spy.addGems === 0, JSON.stringify(spy));
  ok('P1e the server paid its own number (' + FAKE_PAY + '), not the preview (' + preview1 + ')', srv.cinder - c0 === FAKE_PAY, srv.cinder - c0);
  ok('P1f the local balance IS the server balance', (Profile.gems | 0) === srv.cinder, 'local=' + Profile.gems + ' server=' + srv.cinder);
  ok('P1g the toast prints the server credit', /\+777/.test(lastToast()), lastToast());

  // P2. the response is lost after the server committed.
  spyReset(); srv.mode = 'lost'; srv.lostOnce = false;
  mkNode('00000000-0000-4000-8000-000000000002');
  const n2 = srv.nodes[1].id, c2 = srv.cinder, k2 = calls().length;
  const r2 = await nodeCollect(n2);
  const p2 = calls().slice(k2);
  ok('P2a the lost response is retried with the SAME nonce', p2.length >= 2 && p2.every(c => c.args.p_client_nonce === p2[0].args.p_client_nonce),
     p2.map(c => c.args.p_client_nonce).join(' | '));
  ok('P2b the server credited ONCE', srv.cinder - c2 === FAKE_PAY, srv.cinder - c2);
  ok('P2c local = server (no double add), no client credit', (Profile.gems | 0) === srv.cinder && spy.addCinders === 0 && spy.addGems === 0,
     'local=' + Profile.gems + ' srv=' + srv.cinder + ' ' + JSON.stringify(spy));
  ok('P2d the call reports success', r2 === true, r2);

  // P3. the server refuses.
  spyReset(); srv.mode = 'refuse';
  mkNode('00000000-0000-4000-8000-000000000003');
  const n3 = srv.nodes[2].id, c3 = srv.cinder, l3 = Profile.gems | 0, pi3 = srv.payoutsInserted;
  const r3 = await nodeCollect(n3);
  ok('P3a a refused collect returns false', r3 === false, r3);
  ok('P3b refused: no Cinder anywhere, no client credit, no pool row', srv.cinder === c3 && (Profile.gems | 0) === l3 && spy.addCinders === 0
     && spy.addGems === 0 && srv.payoutsInserted === pi3, 'srv ' + c3 + '->' + srv.cinder + ' local ' + l3 + '->' + Profile.gems + ' ' + JSON.stringify(spy));
  ok('P3c the refusal is explained', /Nothing was paid/.test(lastToast()), lastToast());

  // P4. the function is missing (sql/165 not applied).
  spyReset(); srv.mode = 'missing';
  mkNode('00000000-0000-4000-8000-000000000004');
  const n4 = srv.nodes[3].id, c4 = srv.cinder, l4 = Profile.gems | 0, pi4 = srv.payoutsInserted;
  const r4 = await nodeCollect(n4);
  ok('P4 missing RPC: refused, nothing paid, no client credit, no pool row', r4 === false && srv.cinder === c4 && (Profile.gems | 0) === l4
     && spy.addCinders === 0 && spy.addGems === 0 && srv.payoutsInserted === pi4, 'r=' + r4 + ' local ' + l4 + '->' + Profile.gems + ' ' + JSON.stringify(spy));

  // P5. no answer at all: parked, then flushed once.
  spyReset(); srv.mode = 'down';
  mkNode('00000000-0000-4000-8000-000000000005');
  const n5 = srv.nodes[4].id, c5 = srv.cinder, l5 = Profile.gems | 0;
  const r5 = await nodeCollect(n5);
  let pend = []; try { pend = JSON.parse(localStorage.getItem('mythic_np_pend_' + U) || '[]'); } catch (e) {}
  ok('P5a no answer: not reported as done, nothing paid', r5 === false && srv.cinder === c5 && (Profile.gems | 0) === l5 && spy.addCinders === 0 && spy.addGems === 0,
     'r=' + r5 + ' local ' + l5 + '->' + Profile.gems + ' ' + JSON.stringify(spy));
  ok('P5b no answer: the nonce is parked', pend.length === 1 && pend[0].node === n5, JSON.stringify(pend));
  srv.mode = 'ok';
  const flush = (typeof _npPendFlush === 'function') ? _npPendFlush : null;
  if (flush) { await flush(); await flush(); }
  let pend2 = []; try { pend2 = JSON.parse(localStorage.getItem('mythic_np_pend_' + U) || '[]'); } catch (e) {}
  ok('P5c the flush lands it exactly once', srv.cinder - c5 === FAKE_PAY, srv.cinder - c5);
  ok('P5d ...the balance is adopted, the queue is empty, no client credit', (Profile.gems | 0) === srv.cinder && pend2.length === 0
     && spy.addCinders === 0 && spy.addGems === 0, 'local=' + Profile.gems + ' srv=' + srv.cinder + ' pend=' + pend2.length);

  // P6. static: nodeCollect holds no client credit / pool write / claim CAS.
  const srcNC = String(window.nodeCollect);
  ok('P6 nodeCollect source: no addCinders / addGems / node_payouts / _nodeMetaWrite', !/addCinders|addGems|node_payouts|_nodeMetaWrite/.test(srcNC),
     (srcNC.match(/addCinders|addGems|node_payouts|_nodeMetaWrite/g) || []).join(','));

  window.showToast = _st; window.addCinders = _ac; window.addGems = _ag;
  return { R, toasts: toasts.slice(-6), srv: { cinder: srv.cinder, payoutsInserted: srv.payoutsInserted, nodeUpdates: srv.nodeUpdates,
           rpc: srv.rpcCalls.map(c => c.fn + '/' + c.mode).join(' ') } };
});

out.R.push({ label: 'N8 static: the only raw reserve_contributions readers left are the name searches', pass: rawAll === rawNames,
             detail: rawAll + ' raw vs ' + rawNames + ' name-only' });
let fail = 0;
for (const r of out.R) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.label + (r.detail ? '   [' + r.detail + ']' : '')); }
console.log('server:', JSON.stringify(out.srv));
console.log('last toasts:', out.toasts);
if (errs.length) console.log('page errors (first 5):', errs.slice(0, 5));
console.log(fail ? ('\n' + fail + ' check(s) FAILED') : '\nALL PASS');
await b.close();
process.exit(fail ? 1 : 0);
