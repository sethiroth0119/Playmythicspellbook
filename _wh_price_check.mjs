// Guards MOCK.CFG in public/warehouse/index.html against drifting away from
// wh_config() in the migration.
//
// This has bitten twice. The standalone yard runs on MOCK when there is no game
// around it — which is how it is tested — so when MOCK says one price and the
// server says another, the tests pass, production is fine, and the offline yard
// is quietly wrong (or unplayable: crate_kg drifted to 50 against a 25 kg
// bare-hands limit and every crate became unliftable).
//
// Exit 0 only if every price matches. Node builtins only, so it can never be
// skipped by the runner.
import { readFileSync } from 'node:fs';
const SQL = readFileSync('supabase/migrations/20260812000000_warehouse_storage.sql', 'utf8');
const WH  = readFileSync('public/warehouse/index.html', 'utf8');
const one = (src, re, label) => { const m = src.match(re); if (!m) throw new Error('could not find ' + label); return m[1]; };
const many = (src, re, label) => {
  const out = [...src.matchAll(re)].map(m => m[1]);
  // ⚠ ARITY IS PART OF THE CHECK. one() throws on a miss but many() returned []
  // silently, so a formatting change that stopped BOTH regexes matching deleted
  // the whole row from the comparison and the gate still reported "identical".
  // Verified: reformatting tier 2 in both files to 999 vs 111 passed, exit 0.
  if (!out.length) throw new Error('matched NOTHING for ' + label + ' — the regex or the file changed');
  return out;
};

const checks = [];
const cmp = (label, a, b) => checks.push({ label, sql: String(a), mock: String(b), ok: String(a) === String(b) });
// Compare two lists AND their lengths — a short list is a failure, not a match.
const cmpL = (label, a, b) => checks.push({ label, sql: a.join(','), mock: b.join(','),
  ok: a.length === b.length && a.length > 0 && a.join(',') === b.join(',') });

cmp('unit_price_cinder',   one(SQL, /'unit_price_cinder', (\d+)/, 'sql unit_price_cinder'),
                           one(WH,  /unit_price_cinder: (\d+)/,   'mock unit_price_cinder'));
cmp('unit_price_aza',      one(SQL, /'unit_price_aza', (\d+)/, 'sql aza'),
                           one(WH,  /unit_price_aza: (\d+)/,   'mock aza'));
cmp('unit_capacity_kg',    one(SQL, /'unit_capacity_kg', (\d+)/, 'sql cap'),
                           one(WH,  /unit_capacity_kg: (\d+)/,   'mock cap'));
cmp('rent_cinder_per_day', one(SQL, /'rent_cinder_per_day', (\d+)/, 'sql rent'),
                           one(WH,  /rent_cinder_per_day: (\d+)/,   'mock rent'));
cmp('crate_kg',            one(SQL, /'crate_kg', (\d+)/, 'sql crate'),
                           one(WH,  /crate_kg: (\d+)/,   'mock crate'));
cmp('max_shipment_kg',     one(SQL, /'max_shipment_kg', (\d+)/, 'sql maxship'),
                           one(WH,  /max_shipment_kg: (\d+)/,   'mock maxship'));
// ⚠ max_units IS A PRICE. It is the number of bays a tier may hold, so a drift
// here does not misquote a cost — it hands the player a tier that cannot fit
// what they paid for, or one that can fit more than the yard will draw. It sat
// INSIDE the anchor of both tier regexes below, matched as \d+ and thrown away,
// which is the most dangerous place for a value to be: present enough that the
// regex keeps working, never once compared. Verified before this line existed:
// changing tier 5 from 32 to 12 in MOCK reported "identical", exit 0.
cmpL('tier max_units ladder', many(SQL, /'tier',\s+\d+,\s+'max_units',\s+(\d+)/g, 'sql tier max_units ladder'),
                           many(WH,  /tier:\s+\d+,\s+max_units:\s+(\d+)/g, 'mock tier max_units ladder'));
cmpL('tier cinder ladder', many(SQL, /'tier',\s+\d+,\s+'max_units',\s+\d+,\s+'aza',\s+\d+,\s+'cinder',\s+(\d+)/g, 'sql tier cinder ladder'),
                           many(WH,  /tier:\s+\d+,\s+max_units:\s+\d+,\s+aza:\s+\d+,\s+cinder:\s+(\d+)/g, 'mock tier cinder ladder'));
cmpL('tier aza ladder', many(SQL, /'tier',\s+\d+,\s+'max_units',\s+\d+,\s+'aza',\s+(\d+)/g, 'sql tier aza ladder'),
                           many(WH,  /tier:\s+\d+,\s+max_units:\s+\d+,\s+aza:\s+(\d+)/g, 'mock tier aza ladder'));
// ⚠ AND carry_kg IS THE LIMIT THE HEADER OF THIS FILE IS ABOUT. The bug it
// cites — "crate_kg drifted to 50 against a 25 kg bare-hands limit and every
// crate became unliftable" — has two numbers in it, and only crate_kg was
// guarded. carry_kg sat inside the anchor of both lifter regexes, matched as
// \d+ and discarded, exactly like max_units above. Verified before this line
// existed: changing tier-0 Bare Hands from 25 to 10 in MOCK reported
// "identical", exit 0 — the offline yard would refuse a 25 kg crate that the
// server lifts, which is the same unplayable state, arrived at from the other
// side.
cmpL('lifter carry_kg ladder', many(SQL, /'tier',\s+\d+,\s+'carry_kg',\s+(\d+)/g, 'sql lifter carry_kg ladder'),
                           many(WH,  /tier:\s+\d+,\s+carry_kg:\s+(\d+)/g, 'mock lifter carry_kg ladder'));
// NB \s+ everywhere, not a literal single space: the SQL pads these columns for
// alignment, and a regex demanding one space silently matched only the wide rows
// — which looks exactly like a drift failure when nothing has drifted.
cmpL('lifter cinder ladder', many(SQL, /'carry_kg',\s+\d+,\s+'aza',\s+\d+,\s+'cinder',\s+(\d+)/g, 'sql lifter cinder ladder'),
                           many(WH,  /carry_kg:\s+\d+,\s+aza:\s+\d+,\s+cinder:\s+(\d+)/g, 'mock lifter cinder ladder'));
cmpL('lifter aza ladder', many(SQL, /'carry_kg',\s+\d+,\s+'aza',\s+(\d+)/g, 'sql lifter aza ladder'),
                           many(WH,  /carry_kg:\s+\d+,\s+aza:\s+(\d+)/g, 'mock lifter aza ladder'));
cmp('eta ceiling',         one(SQL, /'free_city_hours', (\d+)/, 'sql free'),
                           one(WH,  /free_city_hours: (\d+)/,   'mock free'));

// ⚠ THE TABLES, NOT JUST THE SCALARS. The gate covered 11 of ~19 wh_config keys,
// and `weights` — which drives kg → crate count → bay capacity — was unguarded.
// That is the SAME failure class that made the offline yard unplayable when
// crate_kg drifted. Verified before this line existed: changing metal's weight
// from 3.5 to 0.1 in MOCK still reported "identical", exit 0. So did drifting
// the entire eta_hours table, and so did aza_to_cinder 5000 → 1.
// SQL writes pairs as  'food', 1.2   and JS as  food: 1.2 — including NUMERIC
// keys in eta_hours ('0', 72 / 0: 72), which an [A-Za-z_]-anchored key pattern
// silently matched zero of. The arity guard above is what caught that; without
// it this would have reported "identical" on two empty lists.
const sqlPairs = (src, re, label) =>
  [...one(src, re, label).matchAll(/'([A-Za-z0-9_]+)'\s*,\s*([0-9.]+)/g)].map(m => m[1] + '=' + Number(m[2]));
const jsPairs = (src, re, label) =>
  [...one(src, re, label).matchAll(/([A-Za-z0-9_]+)\s*:\s*([0-9.]+)/g)].map(m => m[1] + '=' + Number(m[2]));
cmpL('resource weight table',
  sqlPairs(SQL, /'weights', jsonb_build_object\(([\s\S]*?)\n\s*\),/, 'sql weights'),
  jsPairs(WH,   /weights: \{([\s\S]*?)\},/, 'mock weights'));
cmpL('eta_hours table',
  sqlPairs(SQL, /'eta_hours', jsonb_build_object\(([\s\S]*?)\n\s*\),/, 'sql eta'),
  jsPairs(WH,   /eta_hours: \{([\s\S]*?)\},/, 'mock eta'));
for (const [k, sqlRe, whRe] of [
  ['aza_to_cinder',    /'aza_to_cinder', (\d+)/,    /aza_to_cinder: (\d+)/],
  ['start_units',      /'start_units', (\d+)/,      /start_units: (\d+)/],
  ['default_weight',   /'default_weight', ([\d.]+)/, /default_weight: ([\d.]+)/],
  ['rent_max_days',    /'rent_max_days', (\d+)/,    /rent_max_days: (\d+)/],
  ['rent_grace_days',  /'rent_grace_days', (\d+)/,  /rent_grace_days: (\d+)/],
  ['max_hours',        /'max_hours', (\d+)/,        /max_hours: (\d+)/],
]) cmp(k, one(SQL, sqlRe, 'sql ' + k), one(WH, whRe, 'mock ' + k));

let bad = 0;
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'} — ${c.label}`);
  if (!c.ok) { bad++; console.log(`       wh_config(): ${c.sql}\n       MOCK.CFG   : ${c.mock}`); }
}
console.log('');
if (bad) { console.error(`✖ ${bad} price(s) DRIFTED — the offline yard does not match the server.`); process.exit(1); }
// ⚠ Say what was actually compared. "11 price groups identical" reads as
// "MOCK mirrors wh_config()", which it did not — 8 keys were unguarded.
console.log(`✔ ${checks.length} wh_config key groups compared, all identical.`);
console.log('  Covered: ' + checks.map(c => c.label).join(', '));
