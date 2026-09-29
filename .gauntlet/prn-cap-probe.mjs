/* ══════════════════════════════════════════════════════════════════════════
   PRN CAP PROBE — own many anchors, place six.

   Player ask (feature board, Clarence Freycinet, Gameplay, 2026-09-19):
     "I would like to be able to purchase all PRN Anchors, currently you can
      only purchase 6 … being able to purchase more than 6 but only place 6 at
      a time would be a great solution."

   WHAT IT DRIVES. The real reducers in the loaded page — nodeEstablish,
   nodeStore, nodePlace, nodeCollect, nodeFetch, _nodeActive, _nodeClaimable
   and window.cityMyNodes — against a FAKE economy_nodes table. There is a
   sign-in gate in front of the Reserve screen, so nothing here clicks: the
   probe installs a stand-in Supabase client and calls the functions.

   ⚠ Profile / Cloud / Corp / FoundationReserve are top-level `const`s — they
     are global LEXICAL bindings and are NOT on window (CLAUDE.md, "the globals
     trap"). page.evaluate CAN see them by bare name (same realm, same global
     lexical environment) and their OBJECTS are mutable, which is how the
     fixture is installed. `window.foo = fn` still works for the FUNCTION
     declarations (those are properties of the global object).

   EXPECTED: FAIL on HEAD (no way to buy a 7th, no store/place, a stored row
   still rings the city), PASS on the candidate.

   Usage: node .gauntlet/prn-cap-probe.mjs [candidate.html]     (:8787 up)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message || e)));
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 90000 });
await p.waitForFunction(() => typeof window.nodeEstablish === 'function' && typeof window.nodeFetch === 'function', null, { timeout: 60000 });

const out = await p.evaluate(async () => {
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
  const ME = '00000000-0000-4000-8000-00000000beef';
  const CORP = '00000000-0000-4000-8000-0000000c0000';
  const toasts = [];
  let rpcCalls = 0;
  let uid = 0;

  // ── the fake economy_nodes table ────────────────────────────────────────
  const store = { rows: [] };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const get = (row, k) => {
    if (k === 'meta->rev') { const m = row.meta || {}; return (typeof m.rev === 'number') ? m.rev : null; }
    return row[k];
  };
  class Q {
    constructor(table) { this.table = table; this.op = null; this.f = []; this.payload = null; this.want = false; }
    select() { if (!this.op) this.op = 'select'; else this.want = true; return this; }
    insert(row) { this.op = 'insert'; this.payload = row; return this; }
    update(obj) { this.op = 'update'; this.payload = obj; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(k, v) { this.f.push(['eq', k, v]); return this; }
    is(k, v) { this.f.push(['is', k, v]); return this; }
    in(k, v) { this.f.push(['in', k, v]); return this; }
    order() { return this; }
    limit() { return this; }
    match(row) {
      return this.f.every(([kind, k, v]) => {
        const got = get(row, k);
        if (kind === 'is') return v === null ? (got === null || got === undefined) : got === v;
        if (kind === 'in') return (v || []).some((x) => String(x) === String(got));
        return String(got) === String(v);
      });
    }
    run() {
      if (this.table !== 'economy_nodes') return { data: [], error: null };
      const hit = store.rows.filter((r) => this.match(r));
      if (this.op === 'select') return { data: hit.map(clone), error: null };
      if (this.op === 'insert') {
        const row = Object.assign({ id: 'n-' + (++uid), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, clone(this.payload));
        store.rows.push(row);
        return { data: [clone(row)], error: null };
      }
      if (this.op === 'update') { hit.forEach((r) => Object.assign(r, clone(this.payload))); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      if (this.op === 'delete') { store.rows = store.rows.filter((r) => !this.match(r)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      return { data: [], error: null };
    }
    then(res, rej) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.resolve({ data: null, error: e }).then(res); } }
  }

  // ── install the fixture (objects are mutable; the bindings are const) ────
  try {
    Cloud.client = { from: (t) => new Q(t) };
    Cloud.ready = true;
    Profile.cloud = { signedIn: true, userId: ME, email: 'probe@test' };
    Profile.gems = 999999999;
    Corp.mine = { id: CORP, tag: 'PRB', name: 'Probe Corp' };
    Corp.amOwner = true;
    Corp.treasury = 0;
    Corp.licenses = ['construction', 'security'];
    FoundationReserve.myPoints = 500000;
    FoundationReserve.nodesNeedSetup = false;
    FoundationReserve.tableMissing = false;
  } catch (e) { ok('fixture installed', false, e.message); }

  window.initCloud = () => true;
  window.showToast = (m) => { toasts.push(String(m)); };
  window.gcConfirm = async () => true;
  window.saveProfile = () => {};
  window.spendGems = () => true;
  window.addGems = () => {};
  window.canAffordResources = () => true;
  window.spendResources = () => true;
  window.addSalvage = () => {};
  window.cityHoldsLicense = () => true;
  window._jailBlocked = () => false;
  window.nodeTierFetchPledge = async () => {};
  window.corpTreasuryFetch = async () => {};
  window.corpEnsure = async () => {};
  window.frFetch = async () => {};
  window.nodePoolFetch = async () => {};
  window._npCall = async () => { rpcCalls++; return { state: 'error', data: { ok: false, error: 'probe' } }; };

  const seed = (i, status, extra) => Object.assign({
    id: 'seed-' + i, owner_id: ME, corp_id: CORP, name: 'Seed ' + i, node_type: 'supply',
    resource: 'Food', level: 1, status: status,
    meta: Object.assign({ claimedPoints: 0, lastClaim: 0, eff: 100, lastTick: Date.now(), rev: 0, readyAt: Date.now() - 1000 }, extra || {}),
  });
  for (let i = 1; i <= 6; i++) store.rows.push(seed(i, 'active'));
  await window.nodeFetch();
  const placed = () => store.rows.filter((r) => r.status !== 'stored').length;
  const owned = () => store.rows.length;
  ok('S0 fixture: 6 placed, 6 owned', placed() === 6 && owned() === 6, placed() + '/' + owned());

  // ── T1. BUYING A SEVENTH IS ALLOWED ─────────────────────────────────────
  toasts.length = 0;
  let bought = false;
  try { bought = await window.nodeEstablish('fuel', false); } catch (e) { ok('T1 nodeEstablish ran', false, e.message); }
  ok('T1a buying a 7th anchor is ALLOWED while 6 are placed', bought === true && owned() === 7, 'returned ' + bought + ', owned ' + owned());
  const extra = store.rows.find((r) => r.node_type === 'fuel') || null;
  ok('T1b …and it lands OWNED-BUT-UNPLACED (status stored)', !!extra && extra.status === 'stored', extra ? extra.status : '(no row)');
  ok('T1c …it has NOT started building on the shelf', !!extra && !(extra.meta || {}).readyAt, extra ? JSON.stringify(extra.meta || {}) : '');
  ok('T1d …and still only 6 are placed', placed() === 6, placed());
  ok('T1e the player is told where it went', toasts.some((t) => /stor/i.test(t)), toasts.join(' | ').slice(0, 200));

  // ── T2. PLACING A SEVENTH IS REFUSED, CLEARLY ───────────────────────────
  toasts.length = 0;
  let placedIt = null;
  if (typeof window.nodePlace !== 'function') ok('T2a nodePlace exists', false, 'nodePlace is not a function');
  else {
    try { placedIt = await window.nodePlace(extra.id); } catch (e) { ok('T2 nodePlace ran', false, e.message); }
    ok('T2a placing a 7th is REFUSED', placedIt === false, 'returned ' + placedIt);
    ok('T2b …with a message naming the 6-placed limit and the way out', toasts.some((t) => /6/.test(t) && /stor/i.test(t)), toasts.join(' | ').slice(0, 240));
    ok('T2c …and nothing moved', placed() === 6 && store.rows.find((r) => r.id === extra.id).status === 'stored', placed());
  }

  // ── T3. STORING FREES A SLOT, PLACING THEN WORKS ────────────────────────
  toasts.length = 0;
  if (typeof window.nodeStore !== 'function') ok('T3a nodeStore exists', false, 'nodeStore is not a function');
  else {
    const before = clone(store.rows.find((r) => r.id === 'seed-1'));
    let stored = null;
    try { stored = await window.nodeStore('seed-1'); } catch (e) { ok('T3 nodeStore ran', false, e.message); }
    const s1 = store.rows.find((r) => r.id === 'seed-1');
    ok('T3a storing a placed anchor succeeds', stored === true && s1.status === 'stored', 'returned ' + stored + ', status ' + s1.status);
    ok('T3b …the row is KEPT (same id), not deleted', !!s1, '');
    ok('T3c …a slot is free', placed() === 5, placed());
    ok('T3d …and the claim marker / cooldown stamp are untouched',
      (s1.meta || {}).claimedPoints === 0 && (s1.meta || {}).lastClaim === 0, JSON.stringify(s1.meta));
    ok('T3e …no free Maintain: eff and lastTick were not reset',
      (s1.meta || {}).eff === before.meta.eff && (s1.meta || {}).lastTick === before.meta.lastTick,
      JSON.stringify({ eff: (s1.meta || {}).eff, lastTick: (s1.meta || {}).lastTick }));
    let placed2 = null;
    try { placed2 = await window.nodePlace(extra.id); } catch (e) { ok('T3 nodePlace ran', false, e.message); }
    const ex2 = store.rows.find((r) => r.id === extra.id);
    ok('T3f placing the shelved anchor now SUCCEEDS', placed2 === true && ex2.status === 'building', 'returned ' + placed2 + ', status ' + ex2.status);
    ok('T3g …its build starts only now', !!(ex2.meta || {}).readyAt && ex2.meta.readyAt > Date.now(), String((ex2.meta || {}).readyAt));
    ok('T3h …and still exactly 6 placed, 7 owned', placed() === 6 && owned() === 7, placed() + '/' + owned());
  }

  // ── T4. AN UNPLACED ANCHOR PAYS NOTHING ─────────────────────────────────
  toasts.length = 0;
  await window.nodeFetch();
  const shelf = (FoundationReserve.nodes || []).find((n) => n.status === 'stored');
  ok('T4a there is a stored anchor in the owned list', !!shelf, '');
  if (shelf) {
    ok('T4b _nodeActive(stored) is false', window._nodeActive(shelf) === false);
    ok('T4c _nodeClaimable(stored) is 0', window._nodeClaimable(shelf) === 0, String(window._nodeClaimable(shelf)));
    rpcCalls = 0;
    const paid = await window.nodeCollect(shelf.id);
    ok('T4d collecting from it is refused', paid === false, 'returned ' + paid);
    ok('T4e …without calling the payout RPC at all', rpcCalls === 0, 'rpc calls ' + rpcCalls);
    ok('T4f …and the refusal names STORAGE, not "under construction"',
      toasts.some((t) => /stor/i.test(t)) && !toasts.some((t) => /under construction/i.test(t)), toasts.join(' | ').slice(0, 240));
  }

  // ── T5. THE OWNED LIST SURVIVES A RELOAD; THE CITY DOES NOT SEE THE SHELF ─
  FoundationReserve.nodes = [];
  try { _cityMyNodesCache.rows = null; _cityMyNodesCache.at = 0; _cityMyNodesCache.me = null; } catch (e) {}
  await window.nodeFetch();
  const after = FoundationReserve.nodes || [];
  ok('T5a all 7 owned anchors come back after a refetch', after.length === 7, String(after.length));
  ok('T5b …one of them is still on the shelf', after.filter((n) => n.status === 'stored').length === 1);
  ok('T5c …and exactly 6 are placed', after.filter((n) => n.status !== 'stored').length === 6);
  let ring = [];
  try { ring = (await window.cityMyNodes(true)) || []; } catch (e) { ok('T5 cityMyNodes ran', false, e.message); }
  ok('T5d the city rings the PLACED anchors only', ring.length === 6, 'ring ' + ring.length + ' of ' + after.length);
  ok('T5e …the stored one is NOT an anchor in the city', !ring.some((n) => String(n.status || '') === 'stored'));

  return { R, toasts: toasts.slice(-6) };
});

console.log('\n══ PRN CAP PROBE ' + (process.argv[2] ? '(candidate: ' + process.argv[2] + ')' : '(HEAD)') + ' ══');
let bad = 0;
for (const r of out.R) { if (!r.pass) bad++; console.log((r.pass ? '  ok   ' : '  FAIL ') + r.label + (r.detail ? '   [' + r.detail + ']' : '')); }
if (errs.length) console.log('\npage errors: ' + errs.slice(0, 5).join(' | '));
console.log('\n' + (bad ? 'FAIL — ' + bad + ' of ' + out.R.length : 'PASS — all ' + out.R.length) + ' checks');
await b.close();
process.exit(bad ? 1 : 0);
