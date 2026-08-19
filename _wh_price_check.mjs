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
const many = (src, re) => [...src.matchAll(re)].map(m => m[1]);

const checks = [];
const cmp = (label, a, b) => checks.push({ label, sql: String(a), mock: String(b), ok: String(a) === String(b) });

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
cmp('tier cinder ladder',  many(SQL, /'tier',\s+\d+,\s+'max_units',\s+\d+,\s+'aza',\s+\d+,\s+'cinder',\s+(\d+)/g).join(','),
                           many(WH,  /tier:\s+\d+,\s+max_units:\s+\d+,\s+aza:\s+\d+,\s+cinder:\s+(\d+)/g).join(','));
cmp('tier aza ladder',     many(SQL, /'tier',\s+\d+,\s+'max_units',\s+\d+,\s+'aza',\s+(\d+)/g).join(','),
                           many(WH,  /tier:\s+\d+,\s+max_units:\s+\d+,\s+aza:\s+(\d+)/g).join(','));
// NB \s+ everywhere, not a literal single space: the SQL pads these columns for
// alignment, and a regex demanding one space silently matched only the wide rows
// — which looks exactly like a drift failure when nothing has drifted.
cmp('lifter cinder ladder',many(SQL, /'carry_kg',\s+\d+,\s+'aza',\s+\d+,\s+'cinder',\s+(\d+)/g).join(','),
                           many(WH,  /carry_kg:\s+\d+,\s+aza:\s+\d+,\s+cinder:\s+(\d+)/g).join(','));
cmp('lifter aza ladder',   many(SQL, /'carry_kg',\s+\d+,\s+'aza',\s+(\d+)/g).join(','),
                           many(WH,  /carry_kg:\s+\d+,\s+aza:\s+(\d+)/g).join(','));
cmp('eta ceiling',         one(SQL, /'free_city_hours', (\d+)/, 'sql free'),
                           one(WH,  /free_city_hours: (\d+)/,   'mock free'));

let bad = 0;
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'} — ${c.label}`);
  if (!c.ok) { bad++; console.log(`       wh_config(): ${c.sql}\n       MOCK.CFG   : ${c.mock}`); }
}
console.log('');
if (bad) { console.error(`✖ ${bad} price(s) DRIFTED — the offline yard does not match the server.`); process.exit(1); }
console.log(`✔ MOCK.CFG mirrors wh_config() — ${checks.length} price groups identical.`);
