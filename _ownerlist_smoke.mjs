/* 📋 v121v101 — the owner's 2026-09-10 list.

   1. Feed Operation / Homestead Farm opened to a black screen: renderFarm()
      RETURNED its HTML while every other screen writes #app itself.
   2. Construction Co. is the cheapest operation (20,000 🔥 or 10 ◈ Aza); the
      Construction License is free and open; owning a Construction Co. holds
      it; a mayor's own Co. adds build gangs and speed in a client's city.
   3. Bank of Ethos: a one-time starter loan of 40,000 🔥.
   4. Reconstruction: the labour pool is the city's residents (not only the
      jobless); the board says "no city built there yet" when that is true;
      sql/129 lists cities with 0 free instead of hiding them.
   5. PRN anchors ring a city with the viewer's OWN nodes, never the
      corporation's other members' nodes.
   6. The Operations registry cards line up.

   Run: node _ownerlist_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const ETH = readFileSync('./public/ethos/app.jsx', 'utf8').replace(/\r\n/g, '\n');
const JSX = readFileSync('./public/corp/screens.jsx', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/129_labour_market_lists_cities.sql', 'utf8').replace(/\r\n/g, '\n');
const SQL88B = readFileSync('./sql/088b_labour_reach.sql', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the farm screen paints itself ── */
{
  const body = SRC.slice(SRC.indexOf('function renderFarm() {'), SRC.indexOf('async function _openMyCity() {'));
  ok(/const html = '<div class="screen" style="display:flex;flex-direction:column;min-height:100vh">'/.test(body), 'renderFarm builds its markup into `html`');
  ok(/try \{ const r0 = document\.getElementById\('app'\); if \(r0\) r0\.innerHTML = html; \} catch \(e\) \{\}\n\s*return html;\n\}/.test(body), '…writes it into #app like every other screen, then returns it');
  ok(/<div id="farm-root" style="flex:1 1 auto;min-height:70vh"><\/div>/.test(body) && /window\.MythicFarm\.mount\(el\)/.test(body), 'the mount target and the module mount are unchanged');
  /* run it against a fake document */
  const g = { App: { screen: 'farm' }, window: {}, document: { _app: { innerHTML: '' }, getElementById: (id) => (id === 'app' ? g.document._app : null) }, setTimeout: () => 0 };
  const fn = new Function('g', 'with (g) { ' + body + ' return renderFarm; }')(g);
  const out = fn();
  ok(typeof out === 'string' && out.indexOf('farm-root') > 0 && g.document._app.innerHTML === out, 'run for real: #app receives the farm screen (it used to stay empty — the black screen)');
}

/* ── 2. Construction Co. ── */
ok(/  construction: \{ startup: 20000,  azaStartup: 10, ratePerWorkerHr: 800,  salaryPerWorkerHr: 200, maxWorkers: 25, yields: \{ metal: 2\.0 \}, inputs: \{ fuel: 0\.5 \} \},/.test(SRC), 'OPS_ECON.construction: 20,000 🔥 or 10 ◈ Aza — the cheapest company');
{
  const OPS = SRC.slice(SRC.indexOf('const OPS_ECON = {'), SRC.indexOf('\n};', SRC.indexOf('const OPS_ECON = {')));
  const starts = [...OPS.matchAll(/^\s+[a-zA-Z]+:\s*\{\s*startup:\s*(\d+)/gm)].map((m) => +m[1]).filter((n) => n > 0);
  ok(starts.length > 5 && Math.min(...starts) === 20000, 'no priced operation is cheaper than the Construction Co.', starts.length + ' priced, min ' + Math.min(...starts));
}
ok(/const OPS_FREE_LICENCE = \{\};\n/.test(SRC) && /const OPS_PINNED_PRICE = \{ construction: 1 \};\n/.test(SRC), 'the h016 free list is empty; construction is on the PINNED list instead');
ok(/if \(OPS_PINNED_PRICE\[t\]\) \{ merged\.startup = base\.startup; if \('azaStartup' in base\) merged\.azaStartup = base\.azaStartup; else delete merged\.azaStartup; \}\n\s*return merged;/.test(SRC), '_opEcon: a pinned row keeps the TABLE\'s startup and azaStartup through any published override (a stale 350,000 or 0 catalog cannot reprice it)');
ok(/\{ id: 'construction', name: 'Construction License', icon: '🏗', cinder: 0,      res: \{\},\s+minCompliance: 0,  blurb: 'Permits Manufacturing & Storage nodes\. Free — own a Construction Co\. and it is yours\.' \},/.test(SRC), 'the Construction License is free: no fee, no materials, no compliance floor');
ok(/function _ownsConstructionCo\(\) \{\n\s*try \{ return \(typeof Operations !== 'undefined' && Array\.isArray\(Operations\.list\)\) && Operations\.list\.some\(o => o && o\.op_type === 'construction'\); \}/.test(SRC), '_ownsConstructionCo reads the corp_operations rows Just Business already holds');
ok(/if \(id !== 'construction'\) return false;\n\s*if \(_ownsConstructionCo\(\)\) return true;/.test(SRC), 'cityHoldsLicense: owning the business IS the licence');
ok(/return _ownsConstructionCo\(\) \|\| \(\(FoundationReserve && FoundationReserve\.nodes\) \|\| \[\]\)\.length > 0 \|\| _ownsAnyCityNode\(\);/.test(SRC) && /if \(_ownsConstructionCo\(\)\) return 'a Construction Co\.';/.test(SRC), '…and the licence row says "waived — you operate a Construction Co."');
ok(/window\.cityMayorBuildCo = \(\) => \{[\s\S]*?filter\(o => o && o\.op_type === 'construction'\)[\s\S]*?return \{ co: rows\.length, workers: w \};/.test(SRC), 'the parent publishes the mayor\'s Co. count and workers');
{
  const body = SRC.slice(SRC.indexOf('function _ownsConstructionCo() {'), SRC.indexOf('function cityHoldsLicense(id) {'));
  const g = { Operations: { list: [{ op_type: 'mining', workers: 4 }, { op_type: 'construction', workers: 7 }, { op_type: 'construction', workers: 2 }] }, window: {} };
  new Function('g', 'with (g) { ' + body + ' g.owns = _ownsConstructionCo; }')(g);
  ok(g.owns() === true && JSON.stringify(g.window.cityMayorBuildCo()) === '{"co":2,"workers":9}', 'run for real: two Companies with 7 + 2 workers → { co: 2, workers: 9 }');
  g.Operations.list = [{ op_type: 'mining' }];
  ok(g.owns() === false && g.window.cityMayorBuildCo().co === 0, 'no Company → no licence, no gangs');
}
ok(/function bldMayorCoStats\(\) \{[\s\S]*?if \(!gov \|\| gov\.isOwner !== false\) return \{ co: 0, workers: 0 \};[\s\S]*?par\.cityMayorBuildCo\(\)/.test(NC), 'node-city reads the mayor\'s Co. only while managing (gov.isOwner exactly false), from the parent');
ok(/const mc = \(typeof bldMayorCoStats === 'function'\) \? bldMayorCoStats\(\) : \{ co: 0, workers: 0 \}; if \(mc\.co > 0\) n \+= C\.slots\.perCo \+ Math\.floor\(mc\.workers \/ C\.slots\.perWorkerStep\);\n\s*return Math\.min\(C\.slots\.max, n\);/.test(NC), 'bldSlots adds the mayor\'s Co. with the same per-Co / per-worker rule (typeof-guarded for the economy harness, which lifts bldSlots alone)');
ok(/const mc = \(typeof bldMayorCoStats === 'function'\) \? bldMayorCoStats\(\) : \{ co: 0, workers: 0 \}; if \(mc\.co > 0\) m \+= C\.speed\.perCo \+ mc\.workers \* C\.speed\.perWorker;\n\s*return Math\.min\(C\.speed\.maxMul, m\);/.test(NC), 'bldSpeed too');
{
  const body = NC.slice(NC.indexOf('function bldMayorCoStats() {'), NC.indexOf('function bldActive() {'));
  const mk = (isOwner, par, cfg) => {
    const g = { gov: { isOwner }, window: { parent: par }, bldCfg: () => cfg, bldCoTiles: () => [], bldWorkersOf: () => 0, opsRowsOf: () => ({ all: [] }) };
    g.window.parent = par || g.window;
    new Function('g', 'with (g) { ' + body + ' g.slots = bldSlots; g.speed = bldSpeed; }')(g);
    return g;
  };
  const cfg = { municipal: { slots: 2 }, slots: { perCo: 1, perWorkerStep: 4, max: 25 }, speed: { perCo: 0.2, perWorker: 0.05, maxMul: 2 } };
  let g = mk(false, { cityMayorBuildCo: () => ({ co: 1, workers: 8 }) }, cfg);
  ok(g.slots() === 2 + 1 + 2 && Math.abs(g.speed() - (1 + 0.2 + 0.4)) < 1e-9, 'managing with an 8-worker Co.: 2 → 5 gangs, 1.0 → 1.6× speed');
  g = mk(true, { cityMayorBuildCo: () => ({ co: 1, workers: 8 }) }, cfg);
  ok(g.slots() === 2 && g.speed() === 1, 'in the mayor\'s OWN city the sited rule holds — nothing is added');
}

/* ── 3. the starter loan ── */
ok(/const BOE_STARTER_LOAN_CINDER = 40000;\nconst BOE_STARTER_LOAN_INSTALLMENTS = 4;\nconst BOE_STARTER_NOTE = 'starter';/.test(SRC), '40,000 🔥, four weekly installments, tagged starter');
ok(/function boeStarterLoanUsed\(\) \{ try \{ return \(BankEthos\.loans \|\| \[\]\)\.some\(l => l && l\.note === BOE_STARTER_NOTE\); \}/.test(SRC), 'once per account: a starter row already on the loans list');
{
  const body = SRC.slice(SRC.indexOf('async function boeCreateStarterLoan() {'), SRC.indexOf('async function boeCreateLoan(azaAmt, installments) {'));
  ok(/await boeFetchLoans\(\);\n\s*if \(boeStarterLoanUsed\(\)\) \{ showToast\('🏦 The starter loan is once per account/.test(body), 'refreshes the list, then refuses a second starter loan');
  ok(/some\(l => l && l\.status === 'active'\)\) \{ showToast\('You already have an active loan/.test(body), 'and refuses while another loan is active');
  ok(/aza_amount: azaAmt, cinder_owed: cinderOwed, cinder_paid: 0, installments: BOE_STARTER_LOAN_INSTALLMENTS, period_days: 7, status: 'active', hero_capacity_aza: 0, note: BOE_STARTER_NOTE/.test(body) && /const azaAmt = Math\.max\(1, Math\.round\(cinderOwed \/ AZA_TO_CINDER\)\);/.test(body), 'an ordinary boe_loans row (aza_amount 8 for the > 0 check), no hero collateral');
  ok(/_boeDisburseLoan\(\(ins && ins\.data && ins\.data\.id\) \|\| ins\.id\)/.test(body), 'principal is credited by the server RPC off the inserted row');
  /* run the refusals for real */
  const toasts = [];
  const g = { BankEthos: { ready: true, _extCols: true, loans: [{ note: 'starter', status: 'closed' }], balance: 0 }, showToast: (m) => toasts.push(m), boeFetchLoans: async () => {}, AZA_TO_CINDER: 5000, BOE_STARTER_LOAN_CINDER: 40000, BOE_STARTER_LOAN_INSTALLMENTS: 4, BOE_STARTER_NOTE: 'starter', _boeTbl: () => { throw new Error('must not reach the table'); } };
  g.boeStarterLoanUsed = () => g.BankEthos.loans.some((l) => l && l.note === 'starter');
  const fn = new Function('g', 'with (g) { ' + body + ' return boeCreateStarterLoan; }')(g);
  const res = await fn();
  ok(res === false && /once per account/.test(toasts[0] || ''), 'second application: refused before the table is touched', toasts[0]);
  g.BankEthos.loans = [{ note: 'Hero-collateralized loan', status: 'active' }];
  ok((await fn()) === false && /active loan/.test(toasts[1] || ''), 'active loan: refused');
}
ok(/starterLoan: \{ cinder: BOE_STARTER_LOAN_CINDER, installments: BOE_STARTER_LOAN_INSTALLMENTS, used: boeStarterLoanUsed\(\) \},/.test(SRC), 'the bank payload carries starterLoan');
ok(/else if \(d\.op === 'starter'\) fin\(boeCreateStarterLoan\(\)\);/.test(SRC), 'the boe:loan handler routes op starter');
ok(/starterLoan: \(d\.starterLoan && typeof d\.starterLoan === 'object'\) \? d\.starterLoan : \(\(prev && prev\.starterLoan\) \|\| \{ cinder: 40000, installments: 4, used: false \}\),/.test(ETH), 'Ethos app keeps starterLoan in the account');
ok(/const canStarter = !starter\.used && active\.length === 0;/.test(ETH) && /onClick=\{\(\) => boeLoan\("starter", \{\}\)\}/.test(ETH) && /Starter loan · \{fmt\(starter\.cinder\)\} 🜂 \{starter\.used \? "\(taken\)" : "\(once\)"\}/.test(ETH), 'Loans page: a Starter loan button, disabled once taken or while a loan is active');

/* ── 4. Reconstruction ── */
ok(/function citLabourByRole\(\) \{\n  const out = \{\};\n  try \{\n    for \(const c of citizens\) \{\n      if \(citTaskOf\(c\.id\)\) continue;\n      const r = citAptOf\(c\.id\)\.role \|\| 'Civilian';/.test(NC) && !/for \(const c of citizens\) \{\n      if \(c\.job\) continue;\n      if \(citTaskOf\(c\.id\)\) continue;/.test(NC), 'the published pool is every resident not on an errand — employed included');
ok(/Nobody can be hired out of \$\{escapeHtml\(node\.name\)\} yet: no player city on this node has residents to spare — its owner has not built a city there, or it has no residents yet\./.test(SRC), 'the empty board says what is true: no city with residents on that node');
ok(!/is looking for work right now\. You can only hire from OTHER players' cities/.test(SRC), 'the old "nobody is looking for work" line is gone');
const SQLFN = SQL.slice(SQL.indexOf('create or replace function public.camp_labour_market()'), SQL.indexOf('end $$;') + 7);
ok(/create or replace function public\.camp_labour_market\(\)/.test(SQLFN) && !/p\.available > 0/.test(SQLFN) && /and \(p\.node_id = v_node or cp\.owner_id = v_owner\)/.test(SQLFN) && /cp\.owner_id <> v_uid/.test(SQLFN), 'sql/129: lists every published trade (0 free included), keeps 088b\'s reach and never-your-own-city rules');
ok(/p\.node_id, p\.role, p\.available, cp\.population/.test(SQL) && !/p\.available - p\.hired/.test(SQL), '…and reads available raw — the hire function already decrements it (no double subtraction)');
{
  const pick = (s) => s.slice(s.indexOf('create or replace function public.camp_labour_market()'), s.indexOf('end $$;', s.indexOf('create or replace function public.camp_labour_market()')) + 7);
  const a = pick(SQL88B).replace(/\s*--[^\n]*/g, '').replace(/\s+/g, ' ');
  const b = pick(SQL).replace(/\s*--[^\n]*/g, '').replace(/\s+/g, ' ');
  ok(a.replace(' and p.available > 0', '') === b, 'with the one filter removed and comments stripped, the function is 088b word for word', a.length + ' vs ' + b.length);
}

/* ── 5. anchors are the viewer's own nodes ── */
ok(/let me = null; try \{ me = \(P\.cityOwnerIdentity\(\) \|\| \{\}\)\.viewerId \|\| null; \} catch \(e\) \{\}\n\s*if \(FR && Array\.isArray\(FR\.nodes\) && FR\.nodes\.length\) \{\n\s*const mine = FR\.nodes\.filter\(n => n && \(!me \|\| !n\.owner_id \|\| String\(n\.owner_id\) === String\(me\)\)\);\n\s*return mine\.map\(anchorRow\);/.test(NC), 'fetchNodes (own city) keeps only nodes the viewer licensed; rows without owner_id are kept');
{
  const body = NC.slice(NC.indexOf('  B.fetchNodes = async () => {'), NC.indexOf('  B.fetchNodes = async () => {') + 1400);
  const seg = body.slice(0, body.indexOf("if (B.mode === 'message')"));
  const g = { B: { mode: 'parent' }, P: { cityOwnerIdentity: () => ({ viewerId: 'me', isOwner: true }), FoundationReserve: { nodes: [{ id: 'a', owner_id: 'me' }, { id: 'b', owner_id: 'founder' }, { id: 'c' }] } }, anchorRow: (n) => n.id };
  const fn = new Function('g', 'with (g) { ' + seg + ' }; return B.fetchNodes; }')(g);
  ok(JSON.stringify(await fn()) === '["a","c"]', 'run for real: the founder\'s node b is not rung in this member\'s city; a (mine) and c (no owner) are');
}

/* ── 6. the registry ── */
ok(/className="card" style=\{\{ padding: 14, display: 'flex', flexDirection: 'column' \}\}/.test(JSX) && /style=\{\{ padding: 10, fontSize: 11\.5, marginTop: 'auto' \}\}/.test(JSX), 'a registry card is a flex column with the stat block at the bottom');
ok((JSX.match(/padding: '4px 0', borderBottom: '1px dashed var\(--line-soft\)'/g) || []).length >= 11 && !/padding: '3px 0' \}\}/.test(JSX), 'every stat row shares one padding and one dashed rule');

/* the six knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 101, 'BUILD_VERSION is v121v101 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
