/* 👷 CAMP WORKFORCE SMOKE — bug-mtyp80rx.
   "Hired and paid for multiple employees in the reconstruction area of the
   camp… Two times the employees were gone the next day… extra cinder payments
   are taken above the actual cost of the hire/job. Not always but often."

   TWO BUGS, BOTH MEASURED LIVE (2026-09-17, read-only):
   1. Profile.campWorkforce was uploaded and merged but NOT in the local loader
      whitelist, so a reload started empty and the upload wrote `{}` over the
      cloud: 30 populated -> {} transitions in user_profiles_history in 14 days
      (Mavric: 09-11 15:18 and 09-12 16:12 UTC).
   2. hireCampWorker adopted the server balance with a plain assignment; the
      spend watcher billed that drop again ("Spent in Reconstruction" 0.2-0.8 s
      after each "Hired 1 …" row, cumulative: -90, -180, -290 … -1,931).

   The shipped functions are cut out of public/index.html and RUN; the watcher
   is modelled on _gemsTaxTick's rule (a drop since the last baseline that no
   exemption covered is mirrored as a charge). Negative controls: the HEAD
   upload expression sends {} and the HEAD hire is billed twice.
   Run: node _campworkforce_smoke.mjs */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
let HEAD = '';
/* Pinned, not HEAD: once the fix was committed (1f9779cdde) HEAD carries it and
   these controls went red for the wrong reason. 767bf27084 is the commit just
   before the fix. PRE_FIX_REF=HEAD shows the pin matters. */
const PRE_FIX_REF = process.env.PRE_FIX_REF || '767bf27084';
try { HEAD = execSync('git -c core.eol=lf -c core.autocrlf=false show ' + PRE_FIX_REF + ':public/index.html', { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) {}
function fnText(src, name, prefix) {
  const i = src.indexOf((prefix || 'function ') + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; } else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

console.log('\n=== 1. the loader restores the workforce (the third list) ===');
{
  for (const f of ['campWorkforce', 'campNodeHire', 'campContrib', 'campPrestige', 'campName', 'campNodeId', 'campRoute'])
    ok(new RegExp('Profile\\.' + f + '\\s+= p\\.' + f + ';').test(SRC), 'loader restores Profile.' + f);
  ok(!/Profile\.campWorkforce\s+= p\.campWorkforce;/.test(HEAD), 'negative control: HEAD loader never restored campWorkforce');
}

console.log('\n=== 2. the upload never sends "no workforce" over a workforce ===');
{
  const Profile = { cloud: { userId: 'U1' } };
  const api = new Function('Profile', 'let _campSeen = null;\n' + fnText(SRC, '_campMapEmpty') + '\n' + fnText(SRC, '_campUploadValue') +
    '\nreturn { up: _campUploadValue, see: (s) => { _campSeen = s; } };')(Profile);
  const WF = { Guard: 5, Builder: 1, Civilian: 9 };
  api.see({ uid: 'U1', campWorkforce: WF, campNodeHire: { 'N-1': { Guard: 5 } } });
  Profile.campWorkforce = {};
  ok(JSON.stringify(api.up('campWorkforce')) === JSON.stringify(WF), 'empty local -> uploads what the cloud held for this account');
  Profile.campWorkforce = undefined;
  ok(JSON.stringify(api.up('campWorkforce')) === JSON.stringify(WF), 'missing local -> same');
  Profile.campWorkforce = { Guard: 0, Builder: 0 };
  ok(JSON.stringify(api.up('campWorkforce')) === '{"Guard":0,"Builder":0}', 'a real roster emptied by play (role keys at 0) still uploads');
  Profile.campWorkforce = { Guard: 7 };
  ok(api.up('campWorkforce').Guard === 7, 'a populated local always wins');
  Profile.cloud.userId = 'U2'; Profile.campWorkforce = {};
  ok(JSON.stringify(api.up('campWorkforce')) === '{}', 'another account never receives U1\'s workforce');
  // negative control: HEAD's upload expression
  const m = HEAD.match(/__campWorkforce__:\s*(\(Profile\.campWorkforce[^\n]*?\{\}),/);
  const headVal = m ? new Function('Profile', 'return ' + m[1] + ';')({ campWorkforce: {} }) : null;
  ok(headVal && JSON.stringify(headVal) === '{}', 'negative control: HEAD uploads {} for an empty local (the wipe)', JSON.stringify(headVal));
}

console.log('\n=== 3. the merge: an empty cloud map never replaces a populated local one ===');
{
  const line = SRC.split('\n').find((l) => /if \(f\.__campWorkforce__ && typeof f\.__campWorkforce__ === 'object' && !\(_campMapEmpty/.test(l));
  ok(!!line, 'the merge line is guarded');
  const run = (local, cloud) => { const Profile = { campWorkforce: local }; const f = { __campWorkforce__: cloud };
    new Function('Profile', 'f', fnText(SRC, '_campMapEmpty') + '\n' + line)(Profile, f); return Profile.campWorkforce; };
  ok(run({ Guard: 5 }, {}).Guard === 5, 'cloud {} vs local {Guard:5} -> local kept');
  ok(run({}, { Guard: 5 }).Guard === 5, 'cloud {Guard:5} vs local {} -> cloud restores it');
  ok(run({ Guard: 2 }, { Guard: 5 }).Guard === 5, 'both populated -> cloud (the existing freshness rule) unchanged');
}

console.log('\n=== 4. a hire is charged ONCE ===');
async function hire(src) {
  let gems = 1000, server = 1000, base = 1000, exempt = 0; const mirrors = [];
  const Profile = { cloud: { signedIn: true }, campWorkforce: {}, campNodeHire: {} };
  Object.defineProperty(Profile, 'gems', { get: () => gems, set: (v) => { gems = v; } });
  const _gemsTaxExempt = (fn) => { exempt++; try { return fn(); } finally { exempt--; base = gems; } };
  const tick = () => { if (gems < base) mirrors.push(base - gems); base = gems; };   // _gemsTaxTick's rule
  const Cloud = { client: { rpc: async (fn, a) => { server -= a.p_cost; return { data: { ok: true, hired: 1, balance: server, city_name: 'X' } }; } } };
  const body = fnText(src, 'hireCampWorker', 'async function ');
  const f = new Function('Profile', 'Cloud', 'getCampNode', 'CAMP_WORKER_ROLES', 'showToast', 'initCloud', '_campHireCost', '_jbRpcMissing', 'saveProfile', 'saveProgressCloud', '_twLog', 'escapeHtml', '_campRegName', '_campWorkforceTotal', 'openEmploymentBoard', 'App', 'render', '_gemsTaxExempt',
    body + '\nreturn hireCampWorker;');
  const fn = f(Profile, Cloud, () => ({ id: 'N-1', name: 'N' }), [{ id: 'Guard' }], () => {}, () => true, () => 110, () => false, () => {}, () => {}, () => {}, (s) => s, () => 'Camp', () => 1, () => {}, { screen: 'x' }, () => {}, _gemsTaxExempt);
  await fn('Guard', 'city1', 110); tick();
  const p1 = fn('Guard', 'city1', 110), p2 = fn('Guard', 'city1', 110);   // a double click
  await Promise.all([p1, p2]); tick();
  return { mirrors, server, gems };
}
{
  const r = await hire(SRC);
  ok(r.mirrors.length === 0, 'no watcher mirror after the hire (server already charged)', JSON.stringify(r.mirrors));
  ok(r.server === 1000 - 110 * 2, 'a double click hires once: 2 hires total, not 3', r.server);
}
{
  const r = await hire(HEAD);
  ok(r.mirrors.length > 0, 'negative control: HEAD\'s adoption is billed again by the watcher (' + JSON.stringify(r.mirrors) + ')');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
