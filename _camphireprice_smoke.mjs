/* 💰 CAMP HIRE PRICE SMOKE — the server prices a camp hire, never the device.
   Owner ask (2026-09-17): "Hire prices for camp workers are set by the player's
   device, so a player could pick their own price. Fix this server side."

   THE HOLE (measured live, rolled back): camp_hire_from_city(088/088b) charged
   exactly p_cost and skipped the charge when p_cost <= 0 — qty 50, p_cost 0
   moved 50 residents for 0 Cinder. sql/158 (DRAFT) prices by role + the
   registered node on tw_world_map and ignores p_cost.

   What this suite proves, without a database:
   1. sql/158's shape: DRAFT header, both tables RLS'd with admin-only writes,
      the hire body never READS p_cost, charges through _ct_cinder_take with
      the server total, and the file ends with a verify SELECT.
   2. PARITY: the seeded numbers equal index.html's CAMP_WORKER_ROLES (wage*5),
      the prime map equals _nodePrimeRole's, and the SQL arithmetic (float8,
      floor(x+0.5)) equals the shipped _campHireCost over every role x tier x
      resource — including the 31.499999999999996 Civilian case.
   3. CLIENT: the board shows the server quote for ITS node only; a hire adopts
      the server's charged amount, balance and wallet_seq; a server that
      ignores p_cost is what decides the wallet; a missing quote function
      falls back to the local formula and the market still loads.
   Negative controls: sql/088's body DOES read p_cost (so check 1 can fail);
   numeric half-up rounding disagrees with JS on Civilian prime (so check 2 can
   fail); the pre-158 client (commit 1f9779cdde, pinned rather than HEAD so the
   control does not go stale the moment this lands — the fate of
   _campworkforce_smoke's three HEAD controls) ignores a server quote.
   Run: node _camphireprice_smoke.mjs */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/158_camp_hire_server_price.sql', 'utf8').replace(/\r\n/g, '\n');
const SQL088 = readFileSync('./sql/088b_labour_reach.sql', 'utf8').replace(/\r\n/g, '\n');
let HEAD = '';
try { HEAD = execSync('git -c core.eol=lf -c core.autocrlf=false show 1f9779cdde:public/index.html', { maxBuffer: 64 * 1024 * 1024 }).toString().replace(/\r\n/g, '\n'); } catch (e) {}

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
const stripSqlComments = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
function sqlFn(sql, name) {
  const i = sql.search(new RegExp('create or replace function public\\.' + name + '\\('));
  if (i < 0) return null;
  const j = sql.indexOf('end $$;', i);
  return j < 0 ? null : sql.slice(i, j + 7);
}
// The hire body with its signature line removed — what remains may not mention p_cost.
const readsPcost = (fnSql) => /\bp_cost\b/.test(stripSqlComments(fnSql).replace(/^create or replace function[^\n]*\n/, ''));

console.log('\n=== 1. sql/158 shape ===');
{
  ok(/DRAFT — NOT APPLIED/.test(SQL.slice(0, 400)), 'header says DRAFT — NOT APPLIED');
  ok(/create table if not exists public\.camp_hire_prices/.test(SQL), 'camp_hire_prices table');
  ok(/create table if not exists public\.camp_hire_rules/.test(SQL), 'camp_hire_rules table');
  for (const t of ['camp_hire_prices', 'camp_hire_rules'])
    ok(new RegExp('alter table public\\.' + t + '\\s+enable row level security').test(SQL), 'RLS enabled on ' + t);
  for (const p of ['chp', 'chr']) {
    ok(new RegExp('create policy ' + p + '_sel [^;]*for select to authenticated using \\(true\\)').test(SQL), p + ': signed-in read');
    ok(new RegExp('create policy ' + p + '_ins [^;]*for insert to authenticated with check \\(public\\.is_admin\\(\\)\\)').test(SQL), p + ': admin-only insert');
    ok(new RegExp('create policy ' + p + '_upd [^;]*using \\(public\\.is_admin\\(\\)\\) with check \\(public\\.is_admin\\(\\)\\)').test(SQL), p + ': admin-only update (using + check)');
    ok(new RegExp('create policy ' + p + '_del [^;]*using \\(public\\.is_admin\\(\\)\\)').test(SQL), p + ': admin-only delete');
  }
  ok(/on conflict \(role\) do nothing/.test(SQL) && /on conflict \(id\) do nothing/.test(SQL), 'seeds never revert an admin edit on re-run');
  const hire = sqlFn(SQL, 'camp_hire_from_city');
  ok(!!hire && /p_cost integer\)/.test(hire.split('\n')[0]), 'hire keeps the (uuid,text,integer,integer) signature for live clients');
  ok(hire && !readsPcost(hire), 'the hire body never READS p_cost');
  ok(hire && /_camp_hire_unit_price\(v_node, p_role\)/.test(hire), 'price comes from _camp_hire_unit_price(registered node, role)');
  ok(hire && /v_total := v_unit::bigint \* v_want/.test(hire), 'charged per worker (unit x qty)');
  ok(hire && /_ct_cinder_take\(v_uid, v_total,/.test(hire), 'charged through _ct_cinder_take with the server total');
  ok(hire && /exception when raise_exception then/.test(hire) && hire.indexOf('_ct_cinder_take') < hire.indexOf('update public.city_labour_pool'), 'short wallet is caught before the pool moves');
  ok(hire && /Nobody hires/.test(hire) && hire.indexOf('Nobody hires') < hire.indexOf('for update'), 'unknown role refused before anything is locked');
  ok(hire && /'balance', v_bal, 'wallet_seq', v_seq/.test(hire), 'returns balance + wallet_seq');
  const up = sqlFn(SQL, '_camp_hire_unit_price');
  ok(up && /tw_world_map/.test(up) && !/user_profiles/.test(up), 'node read from tw_world_map, never a player-writable forge copy');
  ok(/revoke all on function public\._camp_hire_unit_price\(text, text\) from public, anon, authenticated/.test(SQL), 'the price helper is not directly callable');
  ok(/grant execute on function public\.camp_hire_quote\(\) to authenticated/.test(SQL), 'quote callable by signed-in players');
  ok(/select\s+\(select count\(\*\) from public\.camp_hire_prices\)/.test(SQL.slice(SQL.lastIndexOf('VERIFY'))), 'ends with a verify SELECT');
  // negative control: the live function (088b) reads p_cost — the check above can fail
  ok(readsPcost(sqlFn(SQL088, 'camp_hire_from_city') || 'create or replace function x(\nx p_cost'), 'negative control: 088b\'s hire body DOES read p_cost');
}

console.log('\n=== 2. parity: sql/158 numbers and arithmetic == the shipped client formula ===');
const ROLES = new Function('return ' + SRC.match(/const CAMP_WORKER_ROLES = (\[[\s\S]*?\n\]);/)[1] + ';')();
const seeds = {};
for (const m of SQL.matchAll(/\('([A-Za-z]+)',\s*(\d+)\)/g)) seeds[m[1]] = +m[2];
{
  ok(ROLES.length === 9, 'client has 9 roles', ROLES.length);
  for (const r of ROLES) ok(seeds[r.id] === r.wage * 5, `seed ${r.id} = wage ${r.wage} x 5 = ${r.wage * 5}`, seeds[r.id]);
  ok(Object.keys(seeds).length === ROLES.length, 'no seeded role the client does not have', Object.keys(seeds).join(','));
}
const primeSrc = fnText(SRC, '_nodePrimeRole');
const CLIENT_MAP = new Function('return ' + primeSrc.match(/const map = (\{[^}]*\});/)[1] + ';')();
const SQL_MAP = JSON.parse(SQL.match(/\(1, ([\d.]+), ([\d.]+), '(\{[^']*\})'::jsonb\)/)[3]);
const [, SQL_STEP, SQL_PRIME] = SQL.match(/\(1, ([\d.]+), ([\d.]+), '/).map(Number);
{
  ok(JSON.stringify(Object.entries(CLIENT_MAP).sort()) === JSON.stringify(Object.entries(SQL_MAP).sort()), 'prime map identical', JSON.stringify(SQL_MAP));
  ok(/\(tier - 1\) \* 0\.25/.test(fnText(SRC, '_nodeTierMul')) && SQL_STEP === 0.25, 'tier step 0.25 both sides');
  ok(/=== role \? 0\.7 : 1/.test(SRC.slice(SRC.indexOf('function _campHireCost('), SRC.indexOf('function _campHireCost(') + 800)) && SQL_PRIME === 0.7, 'prime discount 0.7 both sides');
}
// The SQL function's arithmetic, transcribed operation for operation (float8 == JS double).
function sqlPrice(node, role, roundMode) {
  const base = seeds[role]; if (base == null) return null;
  const digits = String((node.difficulty == null || node.difficulty === '') ? 'T1' : node.difficulty).replace(/[^0-9]/g, '');
  const tier = digits === '' ? 1 : (parseInt(digits.slice(0, 9), 10) || 1);
  const ry = node.resourceYield && typeof node.resourceYield === 'object' ? Object.keys(node.resourceYield) : [];
  const prime = SQL_MAP[String(ry[0] || '').toUpperCase()] || 'Civilian';
  let x = base * (1 + (tier - 1) * SQL_STEP);
  if (prime === role) x = x * SQL_PRIME;
  if (roundMode === 'numeric') { x = Number((base * (1 + (tier - 1) * 0.25) * (prime === role ? 0.7 : 1)).toFixed(10)); return Math.floor(x + 0.5); }
  return Math.max(0, Math.floor(x + 0.5));
}
const clientCost = new Function('CAMP_WORKER_ROLES',
  'let _campMarket = { rows: [] };\n' + fnText(SRC, '_nodeTierMul') + '\n' + fnText(SRC, '_nodePrimeRole') + '\n' +
  fnText(SRC, '_campHireServerPrice') + '\n' + fnText(SRC, '_campHireCost') + '\nreturn _campHireCost;')(ROLES);
{
  let n = 0, bad = [];
  const RES = ['FOOD', 'STEEL', 'METAL', 'WOOD', 'MEDICINE', 'FUEL', 'RESEARCH', 'GOLD', 'MED', 'ELEC', 'ETHER', 'CRYSTAL', 'BIO', 'RELIC', 'food'];
  for (const diff of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', '', null, 'T0', 'x']) for (const res of [...RES, null]) for (const r of ROLES) {
    const node = { id: 'N-X', difficulty: diff, resourceYield: res ? { [res]: 5 } : {} };
    const a = clientCost(node, r.id), b = sqlPrice(node, r.id); n++;
    if (a !== b) bad.push(`${diff}/${res}/${r.id}: js ${a} sql ${b}`);
  }
  ok(bad.length === 0, `SQL arithmetic == shipped _campHireCost on ${n} role x tier x resource cases`, bad.slice(0, 4).join('; '));
  const civ = { id: 'N-13', difficulty: 'T1', resourceYield: { ELEC: 10 } };
  ok(clientCost(civ, 'Civilian') === 31 && sqlPrice(civ, 'Civilian') === 31, 'Civilian prime = 31 (the 15 live hires were charged 31)');
  ok(sqlPrice({ difficulty: 'T1', resourceYield: { METAL: 15 } }, 'Mechanic') === 91, 'N-26 METAL Mechanic = 91 (live hire)');
  ok(sqlPrice(civ, 'Researcher') === 220 && sqlPrice(civ, 'Guard') === 110, 'non-prime T1 = wage x 5');
  // negative control: exact-decimal half-up rounding would say 32 and overcharge every Civilian hire
  ok(sqlPrice(civ, 'Civilian', 'numeric') === 32, 'negative control: numeric() half-up gives 32 — the float8 choice is load-bearing');
}

console.log('\n=== 3. client: server quote shown, server charge adopted ===');
{
  const mk = (src, market) => new Function('CAMP_WORKER_ROLES', 'M',
    'let _campMarket = M;\n' + fnText(src, '_nodeTierMul') + '\n' + fnText(src, '_nodePrimeRole') + '\n' +
    (src.includes('function _campHireServerPrice(') ? fnText(src, '_campHireServerPrice') + '\n' : '') + fnText(src, '_campHireCost') + '\nreturn _campHireCost;')(ROLES, market);
  const node = { id: 'N-13', difficulty: 'T1', resourceYield: { ELEC: 1 } };
  const q = { rows: [], quote: { node_id: 'N-13', prices: { Guard: 999, Civilian: 5 } } };
  ok(mk(SRC, q)(node, 'Guard') === 999, 'board shows the server quote for the registered node');
  ok(mk(SRC, q)(node, 'Builder') === 90, 'a role the quote lacks falls back to the local formula');
  ok(mk(SRC, q)({ ...node, id: 'N-20' }, 'Guard') === 110, 'a quote for another node is never used');
  ok(mk(SRC, { rows: [], quote: { node_id: 'N-13', prices: { Guard: 'x' } } })(node, 'Guard') === 110, 'a malformed quote value is ignored');
  ok(mk(SRC, { rows: [] })(node, 'Guard') === 110, 'no quote (pre-158 server) -> local formula');
  if (HEAD) ok(mk(HEAD, q)(node, 'Guard') === 110, 'negative control: pre-158 client (1f9779cdde, pinned so it never goes stale on commit) ignores the server quote (shows 110 while the server charges 999)');
}
async function hire(src, serverPrice) {
  let gems = 1000, server = 1000, seq = 7; const toasts = [], sent = [];
  const Profile = { cloud: { signedIn: true }, campWorkforce: {}, campNodeHire: {}, walletSeqProgress: 3 };
  Object.defineProperty(Profile, 'gems', { get: () => gems, set: (v) => { gems = v; } });
  const _gemsTaxExempt = (fn) => fn();
  const Cloud = { client: { rpc: async (fn, a) => {
    sent.push(a);
    const charge = serverPrice == null ? a.p_cost : serverPrice;   // 158 ignores p_cost; 088 charges it
    server -= charge; seq++;
    return { data: { ok: true, hired: 1, cost: charge, balance: server, wallet_seq: seq, city_name: 'X', price_source: serverPrice == null ? undefined : 'server' } };
  } } };
  const body = fnText(src, 'hireCampWorker', 'async function ');
  const f = new Function('Profile', 'Cloud', 'getCampNode', 'CAMP_WORKER_ROLES', 'showToast', 'initCloud', '_campHireCost', '_jbRpcMissing', 'saveProfile', 'saveProgressCloud', '_twLog', 'escapeHtml', '_campRegName', '_campWorkforceTotal', 'openEmploymentBoard', 'App', 'render', '_gemsTaxExempt',
    body + '\nreturn hireCampWorker;');
  const fn = f(Profile, Cloud, () => ({ id: 'N-13', name: 'N' }), ROLES, (m) => toasts.push(String(m)), () => true, () => 130, () => false, () => {}, () => {}, () => {}, (s) => s, () => 'Camp', () => 1, () => {}, { screen: 'x' }, () => {}, _gemsTaxExempt);
  await fn('Mechanic', 'city1', 0);          // a doctored call: board said 0
  return { gems, server, toasts, sent, Profile };
}
{
  const r = await hire(SRC, 130);
  ok(r.server === 870 && r.gems === 870, 'server ignores p_cost=0 and charges 130; the client adopts 870', `${r.server}/${r.gems}`);
  ok(r.Profile.walletSeqProgress === 8, 'wallet_seq adopted', r.Profile.walletSeqProgress);
  ok(r.toasts.some((t) => /−130 🔥/.test(t)), 'the toast names the SERVER charge', r.toasts.join(' | '));
  ok(r.sent[0] && r.sent[0].p_cost === 130, 'p_cost still sent (a pre-158 server charges exactly it)', JSON.stringify(r.sent[0]));
  const legacy = await hire(SRC, null);
  ok(legacy.server === 870 && legacy.gems === 870, 'pre-158 server: charged the local price, adopted', `${legacy.server}/${legacy.gems}`);
}
{
  // _campLoadMarket: missing quote function never blocks the market
  const run = async (quoteRes) => {
    const Profile = { cloud: { signedIn: true } };
    const Cloud = { client: { rpc: async (fn) => fn === 'camp_hire_quote' ? quoteRes : { data: [{ role: 'Guard', city_id: 'c', available: 3 }] } } };
    const _jbRpcMissing = (e) => !!e && (e.code === 'PGRST202');
    return new Function('Profile', 'Cloud', 'initCloud', '_jbRpcMissing',
      'let _campMarket = { rows: [], at: 0, why: "" };\n' + fnText(SRC, '_campLoadMarket', 'async function ') + '\nreturn _campLoadMarket();')(Profile, Cloud, () => true, _jbRpcMissing);
  };
  const a = await run({ error: { code: 'PGRST202', message: 'Could not find the function public.camp_hire_quote' } });
  ok(a.rows.length === 1 && !a.quote && !a.why, 'quote function missing -> market loads, no quote, no error line');
  const b = await run({ data: { ok: true, node_id: 'N-13', prices: { Guard: 110 } } });
  ok(b.rows.length === 1 && b.quote && b.quote.prices.Guard === 110 && b.quote.node_id === 'N-13', 'quote stored with its node');
  const c = await run(Promise.reject(new Error('network')));
  ok(c.rows.length === 1 && !c.why, 'a thrown quote call never breaks the market');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
