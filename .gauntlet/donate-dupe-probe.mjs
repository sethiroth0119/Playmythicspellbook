/* ==========================================================================
   DONATE-DUPE PROBE -- "I can donate and the resources reappear, so multiple
   donations happen, and also I can't empty my vault as a result."

   The feature: Foundation Reserve -> Contribute (frDeposit). It debits the
   player's vault (Profile.salvage, which rides the profile row as
   forge.__salvage__) and credits reserve_contributions + a Cinder reward.

   The mechanism under test: the anti-wipe "10% rule" exists THREE times --
     C. cloudSyncProfile's upload guard (refuses to upload a vault <= 10% of
        Profile.cloud._vaultSeen, which is only set at hydration),
     H. cloudFetchProfile's salvage merge (max-merge with no local edit; the
        cloud copy taken whole when the cloud row is newer),
     S. the server trigger up_guard (sql/100: old >= 200 and new <= 10% of old
        -> keep OLD forge.__salvage__).
   A deposit that takes the vault below 10% of what this device was handed is
   indistinguishable from a wipe to all three, so the debit never reaches the
   server, the reserve credit and the reward do, and the next hydration puts
   the donated units back. Donate again. Repeat.

   The page is driven directly (it sits on a sign-in gate). Cloud.client is
   replaced with an in-page fake Supabase that holds ONE user_profiles row and
   the reserve rows, and applies the live up_guard salvage clause to every
   profile write, exactly as deployed (pg_get_functiondef(up_guard), 2026-09-19).

   Usage: node .gauntlet/donate-dupe-probe.mjs [candidate.html]   (:8787 up)
          sql/162 is APPLIED (2026-09-19), so the default now models it.
          DONATE_TRIGGER=old models the pre-162 trigger (the fixed client
          still dupes against it — that is why the SQL had to go in first).
   Exit 1 when any check fails. On the current file it FAILS.
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

const TRIGGER = process.env.DONATE_TRIGGER === 'old' ? 'live' : 'draft';   // 'draft' = sql/162, live since 2026-09-19
console.log('server trigger model: ' + TRIGGER + (process.argv[2] ? ' · page: ' + process.argv[2] : ' · page: live public/index.html'));
const out = await p.evaluate(async (TRIGGER) => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const units = (s) => { let n = 0; for (const k in (s || {})) { const v = +s[k]; if (Number.isFinite(v) && v > 0) n += v; } return n; };
  const U = '00000000-0000-4000-8000-00000000d0da';

  // ---------------------------------------------------------------- server
  let clock = Date.parse('2026-09-19T09:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();
  const srv = {
    row: null,                 // user_profiles row
    reserve: {},               // resource -> { qty, points }
    writes: 0, refused: 0,
  };
  // up_guard, the salvage clause: 'live' = as deployed; 'draft' = sql/162 draft
  // (a declared forge.__vaultSpend__ is subtracted before calling it a wipe).
  const upGuard = (oldRow, next) => {
    const o = units(oldRow.forge && oldRow.forge.__salvage__), n = units(next.forge && next.forge.__salvage__);
    let declared = 0;
    if (TRIGGER === 'draft' && next.forge && next.forge.__vaultSpend__) {
      declared = Math.max(0, +next.forge.__vaultSpend__.spent || 0);
      next.forge = Object.assign({}, next.forge); delete next.forge.__vaultSpend__;
    }
    if (o >= 200 && n <= o * 0.10 && (TRIGGER !== 'draft' || (o - n - declared) > Math.max(50, o * 0.10))) {
      next.forge = Object.assign({}, next.forge || {}, { __salvage__: clone((oldRow.forge || {}).__salvage__ || {}) });
      srv.refused++;
    }
    return next;
  };
  const writeProfile = (payload) => {
    srv.writes++;
    const next = Object.assign(clone(srv.row), clone(payload));
    srv.row = upGuard(srv.row, next);
    srv.row.updated_at = tick();
    return srv.row.updated_at;
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
        if (st.op === 'upsert') { const pl = st.payload; srv.reserve[pl.resource] = { qty: +pl.qty, points: +pl.points }; return { data: null, error: null }; }
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
  /* sql/164: the contribution + its reward go through fr_contribute (the
     client no longer upserts reserve_contributions). Minimal model: one log
     row per nonce, qty added once, a balance returned. The full contract is
     exercised by .gauntlet/reserve-rpc-probe.mjs. A pre-164 page never calls
     it and keeps using the upsert branch above. */
  const frLog = {};
  const fake = {
    from: q,
    rpc: async (fn, a) => {
      if (fn !== 'fr_contribute') return { data: null, error: null };
      const n = String((a && a.p_client_nonce) || '');
      if (!frLog[n]) {
        frLog[n] = { res: a.p_res_id, qty: +a.p_qty };
        const r = srv.reserve[a.p_res_id] || { qty: 0, points: 0 };
        srv.reserve[a.p_res_id] = { qty: r.qty + (+a.p_qty), points: r.points + (+a.p_qty) };
      }
      return { data: { ok: true, already: false, resource: a.p_res_id, qty: +a.p_qty, points: +a.p_qty, credited: 0,
                       cinder: (Profile.gems | 0), wallet_seq: 0 }, error: null };
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    removeChannel() {},
    auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: { id: U } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: {} }) }) },
  };

  // ----------------------------------------------------------- the account
  Cloud.ready = true; Cloud.client = fake;
  Object.assign(Profile.cloud, { signedIn: true, userId: U, displayName: 'Probe', email: '', lastLocalEditAt: 0, pendingChanges: false,
    _hydratedFromCloud: true, _foreignProfile: false, _forceRestoreFromCloud: false });
  try { localStorage.setItem(PROFILE_OWNER_KEY, U); } catch (e) {}
  try { if (typeof MultiTab !== 'undefined' && MultiTab) MultiTab.amWriter = true; } catch (e) {}
  if (typeof FoundationReserve !== 'undefined') FoundationReserve.tableMissing = false;
  // Real progress so the anti-wipe gates see a genuine account on both sides.
  const vault0 = { corn: 1000, metal: 100 };
  srv.row = {
    user_id: U, display_name: 'Probe', records: { wins: 3 }, competitive: {}, heroes: { h1: { id: 'h1', level: 3 } },
    units: { u1: { id: 'u1' } }, gems: 500, sovereigns: 0, deck_history: {}, decks: { h1: { name: 'd', cards: ['a'] } },
    settings: {}, forge: { __salvage__: clone(vault0) }, wallet_seq: 0, updated_at: tick(),
  };
  Profile.salvage = {};

  // 0. hydrate this device from the cloud row (sets _vaultSeen to 1,100)
  let f0 = null;
  try { f0 = await cloudFetchProfile(); } catch (e) { f0 = { threw: e.message }; }
  // Let any queued upload from the fetch drain.
  try { if (_cloudSyncQueue) await _cloudSyncQueue; } catch (e) {}
  const hyd = (Profile.salvage.corn | 0);
  ok('0 setup: device hydrated 1,000 corn from the cloud row', hyd === 1000, 'fetch=' + JSON.stringify(f0) + ' corn=' + hyd + ' seen=' + Profile.cloud._vaultSeen);

  // 1. donate the whole corn stack to the Reserve
  const d1 = await frDeposit('corn', 1000);
  ok('1a the first donation is accepted', d1 === true, d1);
  ok('1b ...and the vault shows it gone locally', (Profile.salvage.corn | 0) === 0, Profile.salvage.corn);

  // 2. the save round trip: does the debit reach the server?
  const w0 = srv.writes;
  let s1 = null;
  try { s1 = await cloudSyncProfile(); } catch (e) { s1 = { threw: e.message }; }
  const srvCorn = +((srv.row.forge.__salvage__ || {}).corn || 0);
  ok('2a the save uploads the donated vault (not deferred as a "wipe")', !(s1 && s1.deferred), JSON.stringify(s1));
  ok('2b the server row no longer holds the donated corn', srvCorn === 0, 'server corn=' + srvCorn + ' writes=' + (srv.writes - w0) + ' up_guard kept=' + srv.refused);

  // 3. the next hydration. The Cinder reward's wallet credit bumps the row
  //    (user_profiles_touch), so the cloud row is newer than this device.
  srv.row.updated_at = tick(); clock += 60000;
  try { await cloudFetchProfile(); } catch (e) {}
  try { if (_cloudSyncQueue) await _cloudSyncQueue; } catch (e) {}
  ok('3 after the next cloud fetch the donated corn does NOT reappear', (Profile.salvage.corn | 0) === 0, 'local corn=' + (Profile.salvage.corn | 0));

  // 3r. a reload: Profile.cloud is not restored from localStorage, so the
  //     edit stamps come back as 0 and the salvage merge is the max-merge.
  Profile.cloud.lastLocalEditAt = 0; Profile.cloud.pendingChanges = false;
  try { await cloudFetchProfile(); } catch (e) {}
  try { if (_cloudSyncQueue) await _cloudSyncQueue; } catch (e) {}
  ok('3r after a reload the donated corn does NOT reappear', (Profile.salvage.corn | 0) === 0, 'local corn=' + (Profile.salvage.corn | 0));

  // 4. donate again
  const d2 = await frDeposit('corn', 1000);
  const given = (srv.reserve.corn && srv.reserve.corn.qty) || 0;
  ok('4a a second 1,000-corn donation from a 1,000-corn vault is refused', d2 !== true, d2);
  ok('4b the Reserve never holds more corn than the vault ever had (1,000)', given <= 1000, 'reserve corn=' + given);

  // 5. control -- the anti-wipe guard still stops an UN-HYDRATED device
  //    (a vault that collapses with no spend behind it) from writing.
  srv.row.forge = Object.assign({}, srv.row.forge, { __salvage__: { corn: 1000, metal: 100 } });
  srv.row.updated_at = tick();
  try { _setProfileRowBase(U, srv.row.updated_at, false); } catch (e) {}
  const before = units(srv.row.forge.__salvage__);
  Profile.cloud._vaultSeen = before; Profile.cloud._vaultSpent = 0;
  const keep = clone(Profile.salvage);
  for (const k in Profile.salvage) Profile.salvage[k] = 0;
  Profile.salvage.metal = 5;
  try { Profile.cloud.pendingChanges = true; await cloudSyncProfile(); } catch (e) {}
  const after = units(srv.row.forge.__salvage__);
  ok('5a control (client): an unexplained collapse is still not written over the cloud vault', after === before, 'server units ' + before + ' -> ' + after);
  // 5b. the trigger on its own: an undeclared collapse written straight at the row.
  writeProfile({ forge: Object.assign({}, srv.row.forge, { __salvage__: { metal: 5 } }) });
  ok('5b control (server): an undeclared collapse is still kept by up_guard', units(srv.row.forge.__salvage__) === before, 'server units -> ' + units(srv.row.forge.__salvage__));
  Profile.salvage = keep;

  return { R, srv: { writes: srv.writes, refused: srv.refused, reserve: srv.reserve } };
}, TRIGGER);

let fail = 0;
for (const r of out.R) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.label + (r.detail ? '   [' + r.detail + ']' : '')); }
console.log('server:', JSON.stringify(out.srv));
if (errs.length) console.log('page errors (first 5):', errs.slice(0, 5));
console.log(fail ? ('\n' + fail + ' check(s) FAILED') : '\nALL PASS');
await b.close();
process.exit(fail ? 1 : 0);
