/* 🏗 CAMP STAFF AND PROGRESS STAY PAID FOR (bug-mtyp80rx, bug-mu8rpr6s,
   bug-mu84559b, bug-mucgicr6, bug-mu8xil3s).

   Drives the REAL functions out of public/index.html (tools/gamedev/headless
   loadEngine) rather than asserting on source text — TRAP 8 in the bug
   handoff is a fix that read right and was dead.

   1. A hire is charged ONCE. camp_hire_from_city debits the wallet on the
      server; the client adopting that balance used to be seen by the spend
      watcher as a legacy spend and charged again through wallet_charge.
   2. The hire credits the trade that was hired (Doctor, not Civilian).
   3. The Reconstruction roster survives a reload. campWorkforce and the rest
      of the Reconstruction state were in the cloud lists but not the local
      loader, so every reload dropped paid staff.

   Run: node _campkeep_smoke.mjs */
import vm from 'node:vm';
import { loadEngine } from './tools/gamedev/headless.mjs';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x));
  if (c) passes++; else fails++;
};
const eng = loadEngine();
const run = (s) => vm.runInContext(s, eng.sandbox);
const J = (s) => { const t = run('JSON.stringify(' + s + ')'); return t === undefined ? undefined : JSON.parse(t); };

// ── 1 + 2: the hire ─────────────────────────────────────────────────────────
console.log('hire from the Employment Board');
eng.sandbox.__calls = [];
run(`
  initCloud = () => true;
  getCampNode = () => ({ id: 'N1', name: 'Node One', difficulty: 'T1', resourceYield: { FOOD: 1 } });
  openEmploymentBoard = () => {}; _twLog = () => {}; saveProgressCloud = () => {};
  Profile.cloud.signedIn = true; Profile.cloud.userId = 'u1';
  Profile.gems = 1000; Profile.walletSeqProgress = 5; Profile.campWorkforce = {};
  Cloud.client = { rpc: (fn, args) => { __calls.push([fn, args]);
    if (fn === 'camp_hire_from_city') return Promise.resolve({ data: { ok: true, hired: 1, cost: 190,
      balance: 810, wallet_seq: 6, city_name: 'Town', role: args.p_role } });
    return Promise.resolve({ data: {} }); } };
  _installGemsTaxInterceptor(); _gemsTaxArmed = true; _gemsWatchLast = Profile.gems;
`);
await run(`hireCampWorker('Doctor', 'city-1', 190)`);
run(`_gemsTaxTick(); _gemsTaxTick();`);
await new Promise((r) => setTimeout(r, 10));
const calls = eng.sandbox.__calls.map((c) => c[0]);
ok(calls.filter((c) => c === 'camp_hire_from_city').length === 1, 'the hire RPC ran once');
ok(calls.indexOf('wallet_charge') < 0, 'no second debit — the adopted server balance is not a legacy spend', calls.join(','));
ok(J('Profile.gems') === 810, 'local balance is the server balance', J('Profile.gems'));
ok(J('Profile.walletSeqProgress') === 6, 'level with the server debit counter', J('Profile.walletSeqProgress'));
ok(J('Profile.campWorkforce.Doctor') === 1, 'a Doctor hire lands in the Doctor row');
ok(!J('Profile.campWorkforce.Civilian'), 'and not in the Civilian row');
ok(J('__calls[0][1].p_role') === 'Doctor', 'the trade is sent to the server as asked');

// ── 3: reload keeps the Reconstruction state ────────────────────────────────
console.log('reload from localStorage');
run(`
  localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify({
    campWorkforce: { Builder: 3, Guard: 2, Doctor: 1 }, campNodeHire: { N1: { Builder: 3 } },
    campContrib: 14, campPrestige: 9, campName: 'Haven',
    campRoute: { lastDeliveryAt: 1789000000000, status: 'active' } }));
  for (const k of ['campWorkforce', 'campNodeHire', 'campContrib', 'campPrestige', 'campName', 'campRoute']) delete Profile[k];
  loadForge();
`);
ok(J('Profile.campWorkforce && Profile.campWorkforce.Builder') === 3, 'hired Builders survive a reload', J('Profile.campWorkforce'));
ok(J('Profile.campWorkforce && Profile.campWorkforce.Guard') === 2, 'hired Guards survive a reload');
ok(J('Profile.campNodeHire && Profile.campNodeHire.N1.Builder') === 3, 'hire history survives a reload');
ok(J('Profile.campContrib') === 14, 'node contribution survives a reload');
ok(J('Profile.campPrestige') === 9, 'prestige survives a reload');
ok(J('Profile.campName') === 'Haven', 'settlement name survives a reload');
ok(J('Profile.campRoute && Profile.campRoute.lastDeliveryAt') === 1789000000000, 'convoy clock survives a reload (not truncated)');

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
