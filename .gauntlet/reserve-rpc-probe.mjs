/* ==========================================================================
   RESERVE-RPC PROBE — the Foundation Reserve contribution reward is paid by
   the SERVER (sql/164 fr_contribute / fr_convoy_deliver), never the client.

   The page sits on a sign-in gate, so frDeposit / frConvoyTick are driven
   directly with Cloud.client replaced by an in-page fake Supabase: the
   user_profiles row + up_guard salvage clause from donate-dupe-probe.mjs,
   plus a model of the sql/164 RPC contract (nonce log, atomic upsert,
   server-computed points + Cinder, canonical balance returned).
   The fake server pays at a DIFFERENT rate from the client's 0.5/point
   (FAKE_RATE) so "the reward came from the RPC" is visible in the numbers.

   Checks
     A  a deposit: the RPC is called, nothing is upserted by the client, no
        client addCinders/addGems, the vault debit is saved first, the local
        balance is the server's.
     B  a lost response (commit, then network error): the retry reuses the
        nonce, the server credits once, the client adopts once.
     C  the server refuses: no reward, the units come back.
     D  the function is missing (PGRST202): no reward, the units come back.
     E  no answer at all: units stay debited, no reward, nonce parked; the
        flush lands it exactly once.
     F  convoy arrival: paid by fr_convoy_deliver keyed cv:<id>; a lost
        response keeps the convoy and the next tick credits it once.

   Usage: node .gauntlet/reserve-rpc-probe.mjs [page.html]   (:8787 up)
   With no argument the live public/index.html is served. Exit 1 on failure.
   On the pre-164 client (HEAD 44ec5ee455) it FAILS — that is the "before".
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 90000 });
await p.waitForFunction(() => typeof window.frDeposit === 'function' && typeof window.cloudFetchProfile === 'function'
  && typeof window.cloudSyncProfile === 'function', null, { timeout: 90000 });
console.log('page: ' + (process.argv[2] || 'live public/index.html'));

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const units = (s) => { let n = 0; for (const k in (s || {})) { const v = +s[k]; if (Number.isFinite(v) && v > 0) n += v; } return n; };
  const U = '00000000-0000-4000-8000-0000000fc164';
  const FAKE_RATE = 0.25;       // server Cinder per point — NOT the client's 0.5

  // ---------------------------------------------------------------- server
  let clock = Date.parse('2026-09-19T09:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();
  const srv = {
    row: null, reserve: {}, log: {}, cinder: 500, writes: 0,
    rpcCalls: [], clientUpserts: 0,
    mode: 'ok',                  // ok | refuse | missing | lost (commit then error) | down (error, no commit)
    lostOnce: false,
  };
  const upGuard = (oldRow, next) => {
    const o = units(oldRow.forge && oldRow.forge.__salvage__), n = units(next.forge && next.forge.__salvage__);
    let declared = 0;
    if (next.forge && next.forge.__vaultSpend__) {
      declared = Math.max(0, +next.forge.__vaultSpend__.spent || 0);
      next.forge = Object.assign({}, next.forge); delete next.forge.__vaultSpend__;
    }
    if (o >= 200 && n <= o * 0.10 && (o - n - declared) > Math.max(50, o * 0.10)) {
      next.forge = Object.assign({}, next.forge || {}, { __salvage__: clone((oldRow.forge || {}).__salvage__ || {}) });
    }
    return next;
  };
  const writeProfile = (payload) => {
    srv.writes++;
    const next = Object.assign(clone(srv.row), clone(payload));
    delete next.gems;            // wallet columns are server-owned (sql/026)
    srv.row = upGuard(srv.row, next);
    srv.row.gems = srv.cinder;
    srv.row.updated_at = tick();
    return srv.row.updated_at;
  };
  // The sql/164 contract, modelled.
  const W = { corn: 2, metal: 1, memoryShards: 8 };
  const core = (source, a) => {
    const nonce = String(a.p_client_nonce || '');
    if (nonce.length < 8) return { ok: false, error: 'bad_nonce' };
    if (!(a.p_qty > 0)) return { ok: false, error: 'bad_qty' };
    if (a.p_qty > 100000) return { ok: false, error: 'too_many', max: 100000 };
    const lg = srv.log[nonce];
    if (lg) {
      if (lg.resource !== a.p_res_id || lg.qty !== a.p_qty || lg.source !== source) return { ok: false, error: 'nonce_conflict' };
      return { ok: true, already: true, source, resource: lg.resource, qty: lg.qty, points: lg.points, credited: lg.paid,
               cinder: srv.cinder, wallet_seq: 0, reserve: Object.assign({ resource: lg.resource }, srv.reserve[lg.resource]) };
    }
    const w = W[a.p_res_id]; if (!w) return { ok: false, error: 'unknown_resource' };
    const mul = source === 'convoy' ? 1.5 : 1;
    const points = Math.round(a.p_qty * w * mul);
    const paid = Math.max(1, Math.round(points * FAKE_RATE));
    srv.log[nonce] = { source, resource: a.p_res_id, qty: a.p_qty, points, paid };
    const r = srv.reserve[a.p_res_id] || { qty: 0, points: 0 };
    srv.reserve[a.p_res_id] = { qty: r.qty + a.p_qty, points: r.points + points };
    srv.cinder += paid;
    if (srv.row) srv.row.gems = srv.cinder;
    return { ok: true, already: false, source, resource: a.p_res_id, qty: a.p_qty, points, credited: paid, wanted: paid,
             clamped: false, cinder: srv.cinder, wallet_seq: 0, reserve: Object.assign({ resource: a.p_res_id }, srv.reserve[a.p_res_id]) };
  };
  const rpc = async (fn, args) => {
    srv.rpcCalls.push({ fn, args: clone(args || {}), mode: srv.mode });
    if (fn !== 'fr_contribute' && fn !== 'fr_convoy_deliver') return { data: null, error: null };
    if (srv.mode === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn } };
    if (srv.mode === 'down') return { data: null, error: { code: '', message: 'Failed to fetch' } };
    if (srv.mode === 'refuse') return { data: { ok: false, error: 'disabled' }, error: null };
    const j = core(fn === 'fr_convoy_deliver' ? 'convoy' : 'deposit', args);
    if (srv.mode === 'lost' && !srv.lostOnce) { srv.lostOnce = true; return { data: null, error: { code: '', message: 'Failed to fetch' } }; }
    return { data: j, error: null };
  };

  // ------------------------------------------------------------ fake client
  function q(table) {
    const st = { table, op: 'select', filters: {}, payload: null, single: false };
    const exec = async () => {
      if (table === 'user_profiles') {
        if (st.op === 'select') return { data: srv.row ? clone(srv.row) : null, error: null };
        if (st.op === 'update') {
          if (st.filters.updated_at && st.filters.updated_at !== srv.row.updated_at) return { data: [], error: null };
          return { data: [{ updated_at: writeProfile(st.payload) }], error: null };
        }
        if (st.op === 'upsert' || st.op === 'insert') return { data: [{ updated_at: writeProfile(st.payload) }], error: null };
      }
      if (table === 'reserve_contributions') {
        if (st.op === 'select') {
          if (st.filters.resource) { const r = srv.reserve[st.filters.resource]; return { data: r ? clone(r) : null, error: null }; }
          return { data: Object.keys(srv.reserve).map(k => Object.assign({ resource: k, user_id: U }, srv.reserve[k])), error: null };
        }
        if (st.op === 'upsert' || st.op === 'insert' || st.op === 'update') {
          // sql/164 revokes this. Recorded (so the old client is visible) and
          // applied the way the old policy allowed.
          srv.clientUpserts++;
          const pl = st.payload; srv.reserve[pl.resource] = { qty: +pl.qty, points: +pl.points };
          return { data: null, error: null };
        }
      }
      return { data: st.single ? null : [], error: null, count: 0 };
    };
    const api = {
      select() { return api; }, eq(k, v) { st.filters[k] = v; return api; }, neq() { return api; }, in() { return api; },
      gt() { return api; }, gte() { return api; }, lt() { return api; }, lte() { return api; }, is() { return api; },
      ilike() { return api; }, like() { return api; }, or() { return api; }, not() { return api; }, filter() { return api; },
      contains() { return api; }, match() { return api; }, order() { return api; }, limit() { return api; }, range() { return api; },
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

  // Spy on every client-side Cinder credit.
  const spy = { addCinders: 0, addGems: 0 };
  const _ac = window.addCinders, _ag = window.addGems;
  window.addCinders = function () { spy.addCinders++; return _ac.apply(this, arguments); };
  window.addGems = function () { spy.addGems++; return _ag.apply(this, arguments); };
  const spyReset = () => { spy.addCinders = 0; spy.addGems = 0; };
  // Silence the toasts but keep them for the report.
  const toasts = []; const _st = window.showToast; window.showToast = (m) => { toasts.push(String(m)); };

  // ----------------------------------------------------------- the account
  Cloud.ready = true; Cloud.client = fake;
  Object.assign(Profile.cloud, { signedIn: true, userId: U, displayName: 'Probe', email: '', lastLocalEditAt: 0, pendingChanges: false,
    _hydratedFromCloud: true, _foreignProfile: false, _forceRestoreFromCloud: false });
  try { localStorage.setItem(PROFILE_OWNER_KEY, U); } catch (e) {}
  try { localStorage.removeItem('mythic_fr_pend_' + U); } catch (e) {}
  try { if (typeof MultiTab !== 'undefined' && MultiTab) MultiTab.amWriter = true; } catch (e) {}
  if (typeof FoundationReserve !== 'undefined') FoundationReserve.tableMissing = false;
  srv.row = {
    user_id: U, display_name: 'Probe', records: { wins: 3 }, competitive: {}, heroes: { h1: { id: 'h1', level: 3 } },
    units: { u1: { id: 'u1' } }, gems: srv.cinder, sovereigns: 0, deck_history: {}, decks: { h1: { name: 'd', cards: ['a'] } },
    settings: {}, forge: { __salvage__: { corn: 1000, metal: 400, memoryShards: 300 } }, wallet_seq: 0, updated_at: tick(),
  };
  Profile.salvage = {};
  try { await cloudFetchProfile(); } catch (e) {}
  try { if (_cloudSyncQueue) await _cloudSyncQueue; } catch (e) {}
  try { _gemsTaxExempt(() => { Profile.gems = srv.cinder; }); } catch (e) { Profile.gems = srv.cinder; }
  ok('0 setup: device hydrated (corn 1000, metal 400, shards 300; 500 Cinder both sides)',
     (Profile.salvage.corn | 0) === 1000 && (Profile.salvage.metal | 0) === 400 && (Profile.gems | 0) === 500,
     'corn=' + Profile.salvage.corn + ' metal=' + Profile.salvage.metal + ' gems=' + Profile.gems);
  const calls = (fn) => srv.rpcCalls.filter(c => c.fn === fn);
  const srvCorn = () => +((srv.row.forge.__salvage__ || {}).corn || 0);

  // A. a plain deposit.
  spyReset(); srv.mode = 'ok';
  const g0 = srv.cinder, w0 = srv.writes;
  const a = await frDeposit('corn', 200);
  const aCalls = calls('fr_contribute');
  ok('A1 the deposit is accepted', a === true, a);
  ok('A2 it went through fr_contribute (once)', aCalls.length === 1, aCalls.length);
  ok('A3 the client wrote nothing to reserve_contributions', srv.clientUpserts === 0, srv.clientUpserts);
  ok('A4 no client-side addCinders / addGems', spy.addCinders === 0 && spy.addGems === 0, JSON.stringify(spy));
  ok('A5 the server paid its own number (200 corn x 2 pts x 0.25 = 100)', srv.cinder - g0 === 100, srv.cinder - g0);
  ok('A6 the local balance IS the server balance', (Profile.gems | 0) === srv.cinder, 'local=' + Profile.gems + ' server=' + srv.cinder);
  ok('A7 the vault debit was saved BEFORE the RPC (server corn 800)', srvCorn() === 800 && srv.writes > w0, 'server corn=' + srvCorn());
  ok('A8 the Reserve holds 200 corn', srv.reserve.corn && srv.reserve.corn.qty === 200, JSON.stringify(srv.reserve.corn));

  // B. the response is lost after the server committed.
  spyReset(); srv.mode = 'lost'; srv.lostOnce = false;
  const nB0 = calls('fr_contribute').length, gB = srv.cinder;
  const bRes = await frDeposit('metal', 100);
  const bCalls = calls('fr_contribute').slice(nB0);
  ok('B1 the lost response is retried with the SAME nonce', bCalls.length >= 2 && bCalls.every(c => c.args.p_client_nonce === bCalls[0].args.p_client_nonce),
     bCalls.map(c => c.args.p_client_nonce).join(' | '));
  ok('B2 the server credited ONCE (100 metal x 1 x 0.25 = 25)', srv.cinder - gB === 25, srv.cinder - gB);
  ok('B3 the Reserve got the metal once', srv.reserve.metal && srv.reserve.metal.qty === 100, JSON.stringify(srv.reserve.metal));
  ok('B4 the local balance is the server balance (no double add)', (Profile.gems | 0) === srv.cinder, 'local=' + Profile.gems + ' server=' + srv.cinder);
  ok('B5 no client-side Cinder credit', spy.addCinders === 0 && spy.addGems === 0, JSON.stringify(spy));
  ok('B6 the call reports success', bRes === true, bRes);

  // C. the server refuses.
  spyReset(); srv.mode = 'refuse';
  const gC = srv.cinder, lC = Profile.gems | 0, mC = Profile.salvage.metal | 0;
  const cRes = await frDeposit('metal', 50);
  ok('C1 a refused contribution returns false', cRes === false, cRes);
  ok('C2 no Cinder anywhere (server + local unchanged)', srv.cinder === gC && (Profile.gems | 0) === lC, 'srv ' + gC + '->' + srv.cinder + ' local ' + lC + '->' + Profile.gems);
  ok('C3 the metal came back', (Profile.salvage.metal | 0) === mC, mC + ' -> ' + Profile.salvage.metal);
  ok('C4 no client-side Cinder credit', spy.addCinders === 0 && spy.addGems === 0, JSON.stringify(spy));

  // D. the function does not exist yet (sql/164 not applied).
  spyReset(); srv.mode = 'missing';
  const gD = srv.cinder, lD = Profile.gems | 0, mD = Profile.salvage.metal | 0;
  const dRes = await frDeposit('metal', 50);
  ok('D1 missing RPC: the contribution is refused', dRes === false, dRes);
  ok('D2 missing RPC: NO local reward', (Profile.gems | 0) === lD && srv.cinder === gD && spy.addCinders === 0 && spy.addGems === 0,
     'local ' + lD + '->' + Profile.gems + ' spy ' + JSON.stringify(spy));
  ok('D3 missing RPC: the metal came back', (Profile.salvage.metal | 0) === mD, mD + ' -> ' + Profile.salvage.metal);

  // E. no answer at all: parked, then flushed once.
  spyReset(); srv.mode = 'down';
  const gE = srv.cinder, lE = Profile.gems | 0, sE = Profile.salvage.memoryShards | 0;
  const eRes = await frDeposit('memoryShards', 10);
  let pend = []; try { pend = JSON.parse(localStorage.getItem('mythic_fr_pend_' + U) || '[]'); } catch (e) {}
  ok('E1 no answer: not reported as done', eRes === false, eRes);
  ok('E2 no answer: no reward anywhere', srv.cinder === gE && (Profile.gems | 0) === lE && spy.addCinders === 0 && spy.addGems === 0,
     'local ' + lE + '->' + Profile.gems);
  ok('E3 no answer: the shards stay debited (no refund of a maybe-landed call)', (Profile.salvage.memoryShards | 0) === sE - 10, sE + ' -> ' + Profile.salvage.memoryShards);
  ok('E4 no answer: the nonce is parked', pend.length === 1 && pend[0].res === 'memoryShards' && pend[0].qty === 10, JSON.stringify(pend));
  srv.mode = 'ok';
  const flush = (typeof _frPendFlush === 'function') ? _frPendFlush : null;
  if (flush) { await flush(); await flush(); }
  let pend2 = []; try { pend2 = JSON.parse(localStorage.getItem('mythic_fr_pend_' + U) || '[]'); } catch (e) {}
  ok('E5 the flush lands it exactly once (10 x 8 x 0.25 = 20)', srv.cinder - gE === 20 && srv.reserve.memoryShards && srv.reserve.memoryShards.qty === 10,
     'paid ' + (srv.cinder - gE) + ' reserve ' + JSON.stringify(srv.reserve.memoryShards));
  ok('E6 ...the balance is adopted and the queue is empty', (Profile.gems | 0) === srv.cinder && pend2.length === 0, 'local=' + Profile.gems + ' srv=' + srv.cinder + ' pend=' + pend2.length);

  // F. convoy arrival, response lost once.
  spyReset(); srv.mode = 'lost'; srv.lostOnce = false;
  const gF = srv.cinder;
  const cvId = 'cvprobe' + Date.now().toString(36);
  Profile.reserveConvoys = [{ id: cvId, resId: 'corn', qty: 40, gained: 999, reward: 999, departAt: Date.now() - 200000,
                              arriveAt: Date.now() - 1000, riskPct: 0, escorted: false, emergency: false, specialty: false }];
  await frConvoyTick();
  if ((Profile.reserveConvoys || []).length) await frConvoyTick();
  const fCalls = calls('fr_convoy_deliver');
  ok('F1 the arrival went through fr_convoy_deliver keyed cv:<id>', fCalls.length >= 1 && fCalls.every(c => c.args.p_client_nonce === 'cv:' + cvId), fCalls.map(c => c.args.p_client_nonce).join(','));
  ok('F2 paid once, at the server rate (40 x 2 x 1.5 x 0.25 = 30), not the convoy preview (999)', srv.cinder - gF === 30, srv.cinder - gF);
  ok('F3 local balance = server balance; no client credit', (Profile.gems | 0) === srv.cinder && spy.addCinders === 0 && spy.addGems === 0,
     'local=' + Profile.gems + ' srv=' + srv.cinder + ' ' + JSON.stringify(spy));
  ok('F4 the convoy is resolved', (Profile.reserveConvoys || []).length === 0, (Profile.reserveConvoys || []).length);

  window.showToast = _st; window.addCinders = _ac; window.addGems = _ag;
  return { R, toasts: toasts.slice(-8), srv: { cinder: srv.cinder, reserve: srv.reserve, clientUpserts: srv.clientUpserts,
           rpc: srv.rpcCalls.map(c => c.fn + '/' + c.mode).join(' ') } };
});

let fail = 0;
for (const r of out.R) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.label + (r.detail ? '   [' + r.detail + ']' : '')); }
console.log('server:', JSON.stringify(out.srv));
console.log('last toasts:', out.toasts);
if (errs.length) console.log('page errors (first 5):', errs.slice(0, 5));
console.log(fail ? ('\n' + fail + ' check(s) FAILED') : '\nALL PASS');
await b.close();
process.exit(fail ? 1 : 0);
