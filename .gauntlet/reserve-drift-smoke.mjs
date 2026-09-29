/* ==========================================================================
   RESERVE DRIFT SMOKE — the Foundation Reserve's economy numbers exist twice:
   index.html (SALVAGE_RES, RESERVE_WEIGHTS, RESERVE_EVENTS, _frHash, the
   1.6 / 1.35 / 2.4 multipliers, FR_CONVOY_BONUS, the 0.5 Cinder per point)
   and the seed of sql/164 (reserve_resources / reserve_events /
   reserve_config + the _fr_hash port and its verify fixtures).
   THE SERVER COPY WINS — it is what pays. This fails when the two drift, so
   a client change that re-weighs a resource, adds one, or re-orders the
   events is caught before it silently disagrees with what the server pays.
   (Same idea as _carfactory_smoke.mjs for cf_tuning / tuning.js.)

   Usage: node .gauntlet/reserve-drift-smoke.mjs [index.html] [164.sql]
   Defaults: public/index.html, sql/164_reserve_contribute_rpc.sql.
   Pure text: no page load, no database. Exit 1 on any drift.
   ⚠ It reads the SEED in the file. A figure the owner tuned live (the seeds
     are ON CONFLICT DO NOTHING) is not visible here — compare with
     `select * from reserve_config` / `reserve_resources` when that matters.
   ========================================================================== */
import fs from 'node:fs';

const htmlPath = process.argv[2] || 'public/index.html';
const sqlPath = process.argv[3] || 'sql/164_reserve_contribute_rpc.sql';
if (!fs.existsSync(sqlPath)) { console.error('no SQL at ' + sqlPath + ' — pass the path of 164_reserve_contribute_rpc.sql'); process.exit(2); }
const src = fs.readFileSync(htmlPath, 'utf8');
const sql = fs.readFileSync(sqlPath, 'utf8');

function grabLiteral(s, head) {
  const i = s.indexOf(head);
  if (i < 0) throw new Error('client: not found: ' + head);
  const start = i + head.length;
  const open = s[start - 1], close = open === '[' ? ']' : '}';
  let depth = 1, j = start, inStr = null;
  for (; j < s.length && depth > 0; j++) {
    const c = s[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && s[j + 1] === '/') { j = s.indexOf('\n', j); continue; }
    if (c === open) depth++; else if (c === close) depth--;
  }
  return (0, eval)('(' + open + s.slice(start, j - 1) + close + ')');
}

// ---------------------------------------------------------------- client
const salvage = grabLiteral(src, 'const SALVAGE_RES = [');
const weights = grabLiteral(src, 'const RESERVE_WEIGHTS = {');
const wDef = Number((src.match(/const RESERVE_WEIGHT_DEFAULT = (\d+(?:\.\d+)?);/) || [])[1]);
const events = grabLiteral(src, 'const RESERVE_EVENTS = [');
const products = grabLiteral(src, 'const RESERVE_PRODUCTS = [');
const windowMs = (0, eval)((src.match(/const FR_EVENT_WINDOW_MS = ([^;]+);/) || [])[1]);
const convoyBonus = Number((src.match(/const FR_CONVOY_BONUS\s*=\s*([\d.]+);/) || [])[1]);
const frHash = (0, eval)('(' + (src.match(/function _frHash\(n\) \{[\s\S]*?\n\}/) || [])[0] + ')');
const mm = src.match(/Math\.min\(([\d.]+), \(emergency \? ([\d.]+) : 1\) \* \(specialty \? ([\d.]+) : 1\)\) \* FR_CONVOY_BONUS/);
const rp = src.match(/reward: Math\.max\((\d+), Math\.round\(gained \* ([\d.]+)\)\)/);
const ids = [...new Set(salvage.map(r => r.id))];
const specIds = new Set(products.flatMap(p => Object.keys(p.recipe)));

// ------------------------------------------------------------------- sql
const cfgM = sql.match(/insert into public\.reserve_config \([^)]*\)\s*values \(([^;]*?)\)\s*on conflict/);
const cfgCols = (sql.match(/insert into public\.reserve_config \(([^)]*)\)/) || [])[1];
const R = [];
const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
ok('sql: reserve_config seed found', !!(cfgM && cfgCols));
const cfg = {};
if (cfgM && cfgCols) {
  const cols = cfgCols.split(',').map(s => s.trim());
  const vals = cfgM[1].split(',').slice(0, cols.length - 1).map(s => s.trim());   // last col is the note (has commas)
  cols.slice(0, -1).forEach((c, i) => { cfg[c] = vals[i]; });
}
const resBlock = (sql.match(/insert into public\.reserve_resources \(res_id, weight, specialty_ok\) values\n([\s\S]*?)\non conflict/) || [])[1] || '';
const sqlRes = {};
for (const m of resBlock.matchAll(/\('([A-Za-z0-9_]+)', ([\d.]+), (true|false)\)/g)) sqlRes[m[1]] = { w: Number(m[2]), spec: m[3] === 'true' };
const evBlock = (sql.match(/insert into public\.reserve_events \(ord, id, res, relief\) values\n([\s\S]*?)\non conflict/) || [])[1] || '';
const sqlEv = [];
for (const m of evBlock.matchAll(/\((\d+), '([^']+)', (?:array\[([^\]]*)\]::text\[\]|'\{\}'::text\[\]), (true|false)\)/g)) {
  sqlEv[Number(m[1])] = { id: m[2], res: m[3] ? m[3].split(',').map(s => s.trim().replace(/^'|'$/g, '')) : [], relief: m[4] === 'true' };
}
const fixtures = [...sql.matchAll(/public\._fr_hash\((\d+)\) = (\d+)/g)].map(m => [Number(m[1]), Number(m[2])]);

// ---------------------------------------------------------------- checks
const missing = ids.filter(id => !sqlRes[id]);
const extra = Object.keys(sqlRes).filter(id => !ids.includes(id));
ok('every client resource id is seeded on the server', missing.length === 0, missing.slice(0, 12).join(','));
ok('the server seeds no id the client does not have', extra.length === 0, extra.slice(0, 12).join(','));
const wBad = ids.filter(id => sqlRes[id] && sqlRes[id].w !== (weights[id] != null ? weights[id] : wDef));
ok('every weight matches RESERVE_WEIGHTS / RESERVE_WEIGHT_DEFAULT', wBad.length === 0, wBad.map(id => id + ' client=' + (weights[id] ?? wDef) + ' sql=' + sqlRes[id].w).slice(0, 8).join('; '));
const sBad = ids.filter(id => sqlRes[id] && sqlRes[id].spec !== specIds.has(id));
ok('specialty_ok = the RESERVE_PRODUCTS recipe inputs', sBad.length === 0, sBad.join(','));
ok('weight_default = RESERVE_WEIGHT_DEFAULT', Number(cfg.weight_default) === wDef, cfg.weight_default + ' vs ' + wDef);
ok('event_window_ms = FR_EVENT_WINDOW_MS', Number(cfg.event_window_ms) === windowMs, cfg.event_window_ms + ' vs ' + windowMs);
ok('convoy_mul = FR_CONVOY_BONUS', Number(cfg.convoy_mul) === convoyBonus, cfg.convoy_mul + ' vs ' + convoyBonus);
ok('client multiplier line found (convoy dispatch)', !!mm);
if (mm) {
  ok('mul_cap = client cap', Number(cfg.mul_cap) === Number(mm[1]), cfg.mul_cap + ' vs ' + mm[1]);
  ok('emergency_mul = client emergency bonus', Number(cfg.emergency_mul) === Number(mm[2]), cfg.emergency_mul + ' vs ' + mm[2]);
  ok('specialty_mul = client specialty bonus', Number(cfg.specialty_mul) === Number(mm[3]), cfg.specialty_mul + ' vs ' + mm[3]);
}
ok('client reward line found (convoy dispatch preview)', !!rp);
if (rp) {
  ok('min_reward = client Math.max floor', Number(cfg.min_reward) === Number(rp[1]), cfg.min_reward + ' vs ' + rp[1]);
  ok('cinder_per_point = client rate', Number(cfg.cinder_per_point) === Number(rp[2]), cfg.cinder_per_point + ' vs ' + rp[2]);
}
ok('same number of events, same order', sqlEv.length === events.length && events.every((e, i) => sqlEv[i] && sqlEv[i].id === e.id),
   events.map(e => e.id).join(',') + ' vs ' + sqlEv.map(e => e && e.id).join(','));
ok('each event hits the same resources / relief flag', events.every((e, i) => sqlEv[i]
   && JSON.stringify((e.res || []).slice().sort()) === JSON.stringify(sqlEv[i].res.slice().sort()) && !!e.relief === sqlEv[i].relief));
ok('verify-query hash fixtures present', fixtures.length >= 4, fixtures.length);
const fxBad = fixtures.filter(([w, h]) => frHash(w) !== h);
ok('verify-query fixtures = the client _frHash', fxBad.length === 0, fxBad.map(([w, h]) => w + ': sql expects ' + h + ', js ' + frHash(w)).join('; '));

// The SQL port, re-done in BigInt exactly as written in _fr_hash, against the
// JS function over a wide band of windows (past, now, next ~3 years).
const M = 4294967296n;
const sqlPort = (w) => {
  let n = (BigInt(w) & 4294967295n) ^ 2654435769n;
  n = ((n ^ (n >> 15n)) * 2246822507n) % M;
  n = ((n ^ (n >> 13n)) * 3266489909n) % M;
  return Number(n ^ (n >> 16n));
};
const now = Math.floor(Date.now() / windowMs);
let portBad = null;
for (let w = now - 5000; w <= now + 5000 && !portBad; w++) if (sqlPort(w) !== frHash(w)) portBad = w;
for (const w of [0, 1, 2, 12345, 2147483647]) if (!portBad && sqlPort(w) !== frHash(w)) portBad = w;
ok('the SQL hash port equals _frHash over 10,000 windows around now', portBad === null, portBad);
const sqlHasPort = /n bigint := \(p_w & m\) # 2654435769;[\s\S]*?\* 2246822507\) % 4294967296[\s\S]*?\* 3266489909\) % 4294967296[\s\S]*?return n # \(n >> 16\);/.test(sql);
ok('_fr_hash body in the SQL is the ported one', sqlHasPort);

let fail = 0;
for (const r of R) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + r.label + (r.detail && !r.pass ? '   [' + r.detail + ']' : '')); }
console.log('\nclient ids ' + ids.length + ' · sql ids ' + Object.keys(sqlRes).length + ' · events ' + events.length + ' · window ' + now);
console.log(fail ? (fail + ' drift check(s) FAILED') : 'NO DRIFT');
process.exit(fail ? 1 : 0);
