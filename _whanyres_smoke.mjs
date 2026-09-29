/* 🚚 EVERY RESOURCE SHIPS — the warehouse takes anything the stash holds.

   Asked for: "allow players to send every resource (any item that can be
   looted or gotten from a mini game) to a warehouse."

   Defends, headless:
     · the send modal offers every id in the stash, named through _meta()
       (base then salvage catalogue), sorted, junk ids and zeros dropped;
     · the warehouse page is handed names + icons for every catalogue id and
       merges them, so a bay of copper ore is not "📦 copperOre";
     · sql/114 widens the server: id pattern instead of the eleven weights
       keys, the sane-payload filter uses it, seed and resync accept every
       declared id, weights untouched.

   Run: node _whanyres_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
  throw new Error('unbalanced ' + name);
}

console.log('\n=== 1. the send modal lists the whole stash ===');
{
  const ctx = { RESOURCES: [{ id: 'food', name: 'Food', icon: '🥫' }], SALVAGE_RES: [{ id: 'copperOre', name: 'Copper Ore', icon: '🟠' }] };
  ctx._meta = (id) => ctx.RESOURCES.find(r => r.id === id) || ctx.SALVAGE_RES.find(r => r.id === id) || { id, name: id, icon: '📦' };
  vm.createContext(ctx);
  vm.runInContext(fnText('_whSendable') + '\n' + fnText('_whResMeta'), ctx);
  const out = vm.runInContext(`_whSendable({ food: 12, copperOre: 3, mysteryDrop: 7, zero: 0, 'bad id!': 5, neg: -4 })`, ctx);
  ok(out.length === 3, 'three sendable rows from six stash keys (zero, negative and junk dropped)', JSON.stringify(out));
  ok(out.map(x => x.id).join() === 'copperOre,food,mysteryDrop', 'sorted by name; catalogue and salvage and unknown ids all included', out.map(x => x.id).join());
  ok(out[0].name === 'Copper Ore' && out[0].icon === '🟠' && out[2].name === 'mysteryDrop' && out[2].icon === '📦', 'names come from the catalogues, unknown ids fall back to a crate');
  const meta = vm.runInContext('_whResMeta()', ctx);
  ok(meta.food[1] === 'Food' && meta.copperOre[0] === '🟠', 'the page is handed [icon, name] for every catalogue id');
  ok(/const have = _whSendable\(S\);/.test(SRC) && !/const have = \(typeof RESOURCES !== 'undefined' \? RESOURCES : \[\]\)\.filter\(r => \(S\[r\.id\] \| 0\) > 0\);/.test(SRC), 'the modal uses _whSendable, not the base catalogue filter');
  ok(/owed: _whOwedHere\(state\), resMeta: _whResMeta\(\),/.test(SRC), 'wh:state carries resMeta');
  const W = readFileSync('./public/warehouse/index.html', 'utf8');
  ok(/if \(d\.resMeta && typeof d\.resMeta === 'object'\)/.test(W) && /RES_META\[rk\] = \[String\(rv\[0\]\), String\(rv\[1\]\)\]/.test(W), 'the warehouse page merges resMeta into RES_META');
  ok(/var m = RES_META\[k\] \|\| \['📦', k\];/.test(W), 'unknown ids still render as a crate');
}

console.log('\n=== 2. sql/114 ===');
{
  const q = readFileSync('./sql/114_warehouse_any_resource.sql', 'utf8');
  ok(/create or replace function public\._wh_known_resource\(p_id text\)[\s\S]*?p_id ~ '\^\[A-Za-z\]\[A-Za-z0-9_-\]\{0,63\}\$'/.test(q), '_wh_known_resource is an id pattern, not the weights keys');
  ok(/where public\._wh_known_resource\(key\)/.test(q), '_wh_sane_payload keeps every known id');
  ok((q.match(/union select jsonb_object_keys\(v_pay\)/g) || []).length === 2, 'seed and resync loop over the declared ids too');
  ok(/v_cap constant bigint := 100000;/.test(q) && (q.match(/SELF-DECLARED/g) || []).length === 2, 'the per-resource cap and the audit rows are unchanged');
  ok(!/'weights', jsonb_build_object/.test(q), 'weights are not redefined here');
  ok(/Apply BY HAND/.test(q), 'applied by hand');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
