/* ==========================================================================
   NODE-PAYOUT DRIFT SMOKE — the PRN payout's numbers exist twice: the client
   PREVIEW (index.html NODE_* constants, _nodeClaimable / _nodeEff /
   _nodeActiveRisk / frNodePayoutMul / frEconomyState, NODE_RISK_EVENTS,
   RESERVE_PRODUCTS, RESERVE_EVENTS[].stockMul, and /src/nodes/tiers.js) and
   the seed of sql/165 (node_payout_config / node_tiers / node_risk_events /
   reserve_products / reserve_events.stock_mul) that the server PAYS from.
   THE SERVER COPY WINS. This fails when the two drift, so a client change
   that retunes a constant is caught before the row label and the payout
   silently disagree. Sibling of reserve-drift-smoke.mjs (sql/164).

   Usage: node .gauntlet/node-payout-drift-smoke.mjs [index.html] [165.sql] [tiers.js]
   Defaults: public/index.html, sql/165_node_payout_rpc.sql, public/src/nodes/tiers.js.
   Pure text + the client's own functions evaluated in isolation; no page, no
   database. Exit 1 on any drift.
   ⚠ It reads the SEED in the file. A figure the owner tuned live (seeds are ON
     CONFLICT DO NOTHING) is not visible here — compare with
     `select * from node_payout_config` when that matters.
   ========================================================================== */
import fs from 'node:fs';

const htmlPath = process.argv[2] || 'public/index.html';
const sqlPath = process.argv[3] || 'sql/165_node_payout_rpc.sql';
const tiersPath = process.argv[4] || 'public/src/nodes/tiers.js';
if (!fs.existsSync(sqlPath)) { console.error('no SQL at ' + sqlPath + ' — pass the path of 165_node_payout_rpc.sql'); process.exit(2); }
const src = fs.readFileSync(htmlPath, 'utf8');
const sql = fs.readFileSync(sqlPath, 'utf8');
const tiersSrc = fs.readFileSync(tiersPath, 'utf8');

const R = [];
const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });

function literalAfter(s, head) {
  const i = s.indexOf(head);
  if (i < 0) throw new Error('not found: ' + head);
  const start = i + head.length;
  const open = s[start - 1], close = open === '[' ? ']' : '}';
  let depth = 1, j = start, inStr = null;
  for (; j < s.length && depth > 0; j++) {
    const c = s[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && s[j + 1] === '/') { j = s.indexOf('\n', j); continue; }
    if (c === '/' && s[j + 1] === '*') { j = s.indexOf('*/', j) + 1; continue; }
    if (c === open) depth++; else if (c === close) depth--;
  }
  return { text: s.slice(i, j), value: (0, eval)('(' + open + s.slice(start, j - 1) + close + ')') };
}
const fnSrc = (s, head) => { const i = s.indexOf(head); if (i < 0) throw new Error('not found: ' + head); return s.slice(i, s.indexOf('\n}\n', i) + 2); };
const cnum = (name) => { const m = src.match(new RegExp('const ' + name + '\\s*=\\s*([^;]+);')); if (!m) throw new Error('client const missing: ' + name); return Number((0, eval)(m[1])); };
const grab = (re, what) => { const m = src.match(re); ok('client: ' + what + ' line found', !!m); return m; };

// ---------------------------------------------------------------- the seed
const colsM = sql.match(/insert into public\.node_payout_config \(([^)]*)\)\s*values \(([\s\S]*?)\)\s*on conflict/);
ok('sql: node_payout_config seed found', !!colsM);
const cfg = {};
if (colsM) {
  const cols = colsM[1].split(',').map(s => s.trim());
  const vals = colsM[2].split(',').map(s => s.trim());
  cols.slice(0, -1).forEach((c, i) => { cfg[c] = vals[i]; });     // the last column is the note (has commas)
}
const pairs = [
  ['cinder_per_point', 'NODE_CINDER_PER_POINT'], ['cooldown_ms', 'NODE_CLAIM_COOLDOWN_MS'], ['eff_decay_per_hr', 'NODE_EFF_DECAY_PER_HR'],
  ['eff_floor', 'NODE_EFF_FLOOR'], ['payout_cap', 'NODE_PAYOUT_CAP'], ['daily_cap_per_rate', 'NODE_DAILY_CAP_PER_RATE'],
  ['day_ms', 'NODE_DAY_MS'], ['max_level', 'NODE_PAY_MAX_LEVEL'], ['pool_floor', 'NODE_POOL_FLOOR_CINDER'],
  ['pool_treasury_share', 'NODE_POOL_TREASURY_SHARE'], ['tier_payout_max_bp', 'NODE_TIER_PAYOUT_MAX_BP'],
  ['town_boost_per_tier', 'TOWN_BOOST_PER_TIER'], ['town_boost_cap', 'TOWN_BOOST_CAP'], ['risk_window_ms', 'NODE_RISK_WINDOW_MS'],
];
for (const [col, name] of pairs) ok(col + ' = ' + name, Number(cfg[col]) === cnum(name), cfg[col] + ' vs ' + cnum(name));

const lv = grab(/const lvlMul = 1 \+ ([\d.]+) \* \(lvl - 1\);/, 'level step');
if (lv) ok('level_step = _nodeClaimable level step', Number(cfg.level_step) === Number(lv[1]), cfg.level_step + ' vs ' + lv[1]);
const gate = grab(/const gate = sec \? (\d+) : (\d+);/, 'risk gate');
if (gate) ok('risk_gate / risk_gate_sec = _nodeActiveRisk gates', Number(cfg.risk_gate_sec) === Number(gate[1]) && Number(cfg.risk_gate) === Number(gate[2]), cfg.risk_gate_sec + '/' + cfg.risk_gate + ' vs ' + gate[1] + '/' + gate[2]);
const sm = grab(/Math\.round\(ev\.effHit \* ([\d.]+)\)/, 'security mitigation');
if (sm) ok('risk_sec_mul = the Security mitigation', Number(cfg.risk_sec_mul) === Number(sm[1]), cfg.risk_sec_mul + ' vs ' + sm[1]);

const guard = fnSrc(src, 'function frNodePayoutMul() {');
const g1 = guard.match(/state === 'CRISIS'\) m = ([\d.]+)/), g2 = guard.match(/state === 'STRAINED'\) m = ([\d.]+)/);
const g3 = guard.match(/!es\.ev\.relief\) m = Math\.min\(m, ([\d.]+)\)/);
const g4 = [...guard.matchAll(/frac < ([\d.]+)\) m = Math\.min\(m, ([\d.]+)\)/g)];
const g5 = guard.match(/return Math\.max\(([\d.]+), Math\.min\(1, m\)\)/);
ok('client: frNodePayoutMul shape recognised', !!(g1 && g2 && g3 && g4.length === 2 && g5));
if (g1 && g2 && g3 && g4.length === 2 && g5) {
  ok('guard_crisis / guard_strained / guard_event', Number(cfg.guard_crisis) === Number(g1[1]) && Number(cfg.guard_strained) === Number(g2[1]) && Number(cfg.guard_event) === Number(g3[1]),
     [cfg.guard_crisis, cfg.guard_strained, cfg.guard_event].join('/') + ' vs ' + [g1[1], g2[1], g3[1]].join('/'));
  ok('guard pool bands', Number(cfg.guard_pool_low_frac) === Number(g4[0][1]) && Number(cfg.guard_pool_low_mul) === Number(g4[0][2])
     && Number(cfg.guard_pool_mid_frac) === Number(g4[1][1]) && Number(cfg.guard_pool_mid_mul) === Number(g4[1][2]),
     [cfg.guard_pool_low_frac, cfg.guard_pool_low_mul, cfg.guard_pool_mid_frac, cfg.guard_pool_mid_mul].join('/') + ' vs ' + g4.map(m => m[1] + '/' + m[2]).join('/'));
  ok('guard_floor', Number(cfg.guard_floor) === Number(g5[1]), cfg.guard_floor + ' vs ' + g5[1]);
}
// Inline factors the SQL port carries as literals — both sides must still say them.
ok('eff link shield 0.6 / floor 0.5 on both sides', /\(1 - \(_link \/ 100\) \* 0\.6\)/.test(src) && /NODE_EFF_FLOOR \+ Math\.round\(_link \* 0\.5\)/.test(src)
   && /\(1 - \(link \/ 100\) \* 0\.6\)/.test(sql) && /cfg\.eff_floor \+ floor\(link \* 0\.5 \+ 0\.5\)/.test(sql));
ok('economy-state thresholds on both sides (3 stalled / 1 stalled or 2 critical / pct < 15)',
   /stalled >= 3 \? 'CRISIS' : \(stalled >= 1 \|\| critical >= 2\) \? 'STRAINED'/.test(src) && /mf\.pct < 15/.test(src)
   && /stalled >= 3 then 'CRISIS' when stalled >= 1 or critical >= 2 then 'STRAINED'/.test(sql) && /v_pct < 15/.test(sql));
ok('tier bp formula on both sides', /Math\.min\(NODE_TIER_PAYOUT_MAX_BP, Math\.max\(10000, 10000 \+ Math\.round\(rate \* 100\)\)\)/.test(src)
   && /least\(cfg\.tier_payout_max_bp, greatest\(10000, 10000 \+ floor\(v_rate \* 100 \+ 0\.5\)\)\)/.test(sql));
ok('town share clamp 0.005..0.20 on both sides', /Math\.max\(0\.005, Math\.min\(0\.20, Number\(_nodeTierPoolShare\(t\)\) \|\| 0\.005\)\)/.test(src)
   && /greatest\(0\.005::double precision, least\(0\.20::double precision/.test(sql));

// ------------------------------------------------------------------ tiers
const T = literalAfter(tiersSrc, 'export const NODE_TIERS = [').value;
const P2T = literalAfter(tiersSrc, 'const PLEDGE_TO_TIER = {').value;
const tierRows = [...sql.matchAll(/\('([a-z]+)', (\d+), '([^']+)', ([\d.]+), (null|'[^']+')\)/g)]
  .map(m => ({ id: m[1], ord: Number(m[2]), name: m[3], rate: Number(m[4]), pledge: m[5] === 'null' ? null : m[5].slice(1, -1) }));
ok('node_tiers: same tiers in the same order (rank) with the same rates', tierRows.length === T.length
   && T.every((t, i) => tierRows[i] && tierRows[i].id === t.id && tierRows[i].ord === i && tierRows[i].rate === t.rate),
   T.map(t => t.id + ':' + t.rate).join(',') + ' vs ' + tierRows.map(t => t.id + ':' + t.rate).join(','));
const pledgeSql = {}; tierRows.forEach(t => { if (t.pledge) pledgeSql[t.pledge] = t.id; });
ok('node_tiers.pledge_id = PLEDGE_TO_TIER', JSON.stringify(Object.keys(P2T).sort().map(k => k + '>' + P2T[k])) === JSON.stringify(Object.keys(pledgeSql).sort().map(k => k + '>' + pledgeSql[k])),
   JSON.stringify(P2T) + ' vs ' + JSON.stringify(pledgeSql));
ok("the Free tier is id 'free' with no pledge", tierRows.some(t => t.id === 'free' && t.pledge === null) && /FREE_TIER_ID = 'free'/.test(tiersSrc));

// ------------------------------------------------------------ risk events
const RE = literalAfter(src, 'const NODE_RISK_EVENTS = [').value;
const reRows = [...sql.matchAll(/\((\d+), '([a-z]+)', (\d+), (true|false), array\[([^\]]*)\]::text\[\]\)/g)]
  .map(m => ({ ord: Number(m[1]), id: m[2], hit: Number(m[3]), lock: m[4] === 'true', vuln: m[5].split(',').map(s => s.trim().replace(/^'|'$/g, '')) }));
ok('node_risk_events = NODE_RISK_EVENTS (order, effHit, lock, vuln)', reRows.length === RE.length && RE.every((e, i) => reRows[i]
   && reRows[i].ord === i && reRows[i].id === e.id && reRows[i].hit === e.effHit && reRows[i].lock === !!e.lock
   && JSON.stringify(reRows[i].vuln) === JSON.stringify(e.vuln)), RE.map(e => e.id).join(',') + ' vs ' + reRows.map(e => e.id).join(','));

// ---------------------------------------------------------------- products
const PR = literalAfter(src, 'const RESERVE_PRODUCTS = [').value;
const prRows = [...sql.matchAll(/\('([a-z]+)', (\d+), (\d+), '(\{[^']*\})'::jsonb\)/g)].map(m => ({ id: m[1], ord: Number(m[2]), max: Number(m[3]), recipe: JSON.parse(m[4]) }));
ok('reserve_products = RESERVE_PRODUCTS (order, max, recipe)', prRows.length === PR.length && PR.every((p, i) => prRows[i]
   && prRows[i].id === p.id && prRows[i].ord === i && prRows[i].max === p.max && JSON.stringify(prRows[i].recipe) === JSON.stringify(p.recipe)),
   PR.map(p => p.id).join(',') + ' vs ' + prRows.map(p => p.id).join(','));
const EV = literalAfter(src, 'const RESERVE_EVENTS = [').value;
const smM = sql.match(/from \(values ([^)]*\)(?:, \([^)]*\))*)\) v\(id, m\)/);
const smSql = {}; if (smM) for (const m of smM[1].matchAll(/\('([A-Za-z]+)', ([\d.]+)\)/g)) smSql[m[1]] = Number(m[2]);
ok('reserve_events.stock_mul = RESERVE_EVENTS[].stockMul', EV.every(e => smSql[e.id] === e.stockMul) && Object.keys(smSql).length === EV.length,
   JSON.stringify(smSql));

// ------------------------------------------- the ports, against the real JS
const J = new Function(fnSrc(src, 'function _frHash(n) {') + '\n' + fnSrc(src, 'function _nodeSeed(id) {') + '\nreturn { _frHash, _nodeSeed };')();
const M = 4294967296n;
const sqlHash = (w) => { let n = (BigInt(w) & 4294967295n) ^ 2654435769n; n = ((n ^ (n >> 15n)) * 2246822507n) % M; n = ((n ^ (n >> 13n)) * 3266489909n) % M; return n ^ (n >> 16n); };
const sqlSeed = (id) => { let h = 2166136261n; for (let i = 0; i < id.length; i++) h = ((h ^ BigInt(id.charCodeAt(i))) * 16777619n) % M; return h; };
let seedBad = null, rollBad = null;
for (let k = 0; k < 3000 && !seedBad; k++) {
  const id = k % 3 ? crypto.randomUUID() : 'n' + k;
  if (Number(sqlSeed(id)) !== J._nodeSeed(id)) seedBad = id;
  const w = 82000 + k;
  const jsH = J._frHash(J._nodeSeed(id) ^ Math.imul(w, 0x9e3779b1));
  const sqH = Number(sqlHash((sqlSeed(id) ^ ((BigInt(w) * 2654435761n) % M)) & 4294967295n));
  if (jsH !== sqH) rollBad = id + '@' + w;
}
ok('the SQL _np_node_seed port equals _nodeSeed (3,000 ids)', seedBad === null, seedBad);
ok('the SQL risk-roll hash equals _frHash(_nodeSeed(id) ^ imul(w, 0x9e3779b1)) (3,000 rolls)', rollBad === null, rollBad);
const fx = [...sql.matchAll(/public\._np_node_seed\('([^']*)'\) = (\d+)/g)];
ok('verify-query seed fixtures present and = the client _nodeSeed', fx.length >= 4 && fx.every(m => J._nodeSeed(m[1]) === Number(m[2])), fx.length);

let fail = 0;
for (const r of R) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.label + (r.detail && !r.pass ? '   [' + r.detail + ']' : '')); }
console.log(fail ? ('\n' + fail + ' drift check(s) FAILED') : '\nNO DRIFT');
process.exit(fail ? 1 : 0);
