/* 🏭 THE PRODUCTION CHAIN CARD LISTS WHAT THE VERDICT CHECKS.
   Run: node _ecochain_smoke.mjs
   Tracker bug-mu2tq6op (Gas Station "needs Crude Oil"), bug-mu2qa22o (Munitions
   "no Aluminum"), bug-mu2oz3ve (Fast Food / Food Truck "no feedstock at all"),
   bug-mu2p9ya7 (Housing held up by Structural Steel): the "How this block
   feels" verdict reads the economy firm's RECIPE, the Production Chain card
   read only the building's own BUILDINGS def, so the card never named the good
   the verdict said was missing. _ecoChainInputs lists the recipe the verdict
   reads. This suite runs it against the REAL recipe module and the REAL
   ECO_BUILDING_MAP / BUILDINGS rows lifted from node-city.
   §3 is the negative control: the city def alone does not mention those goods. */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const Recipes = await import(pathToFileURL(resolve('./public/src/economy/recipes.js')).href);

function block(start) {                      // a `const X = { … };` literal
  const i = NC.indexOf(start);
  if (i < 0) throw new Error('missing ' + start);
  let d = 0;
  for (let k = NC.indexOf('{', i); k < NC.length; k++) {
    if (NC[k] === '{') d++; else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1) + ';'; }
  }
}
function fnText(name) {
  const i = NC.indexOf('function ' + name + '(');
  let d = 0;
  for (let k = NC.indexOf('{', NC.indexOf(')', i)); k < NC.length; k++) {
    if (NC[k] === '{') d++; else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1); }
  }
}

const ctx = { console, window: {} };
vm.createContext(ctx);
vm.runInContext(block('const ECO_BUILDING_MAP = {').replace('const ', 'var '), ctx);
// BUILDINGS: only name/ico matter here; take them from the real def rows.
const BUILD = {};
for (const key of Object.keys(ctx.ECO_BUILDING_MAP)) {
  const m = NC.match(new RegExp('\\n\\s*' + key + ':\\s*\\{[^\\n]*?name:\\s*\'([^\']+)\'[^\\n]*?ico:\\s*\'([^\']+)\''));
  if (m) BUILD[key] = { name: m[1], ico: m[2] };
}
ctx.BUILDINGS = BUILD;
ctx.resName = (r) => ({ fuel: 'Fuel', metal: 'Metal' })[r] || r;
vm.runInContext(fnText('_ecoChainIdName') + '\n' + fnText('_ecoChainInputs'), ctx);

const firmsFor = (list) => ({ ready: () => true, firms: () => list, recipes: Recipes });
const eco = (type, out, others) => {
  ctx.window.MythicEconomy = firmsFor([{ id: 1, tileKey: '4,5', out }].concat(others || []));
  return ctx._ecoChainInputs('4,5');
};

console.log('\n=== 1. the card now names the goods the verdict names ===');
{
  const gas = eco('gasstation', ctx.ECO_BUILDING_MAP.gasstation.out[0]);
  const gasIds = gas ? gas.legs.flat().map(i => i.id) : [];
  ok(gas && gas.out === 'gasoline', 'the Gas Station\'s business makes gasoline', gas && gas.out);
  ok(gasIds.includes('crudeOil'), 'and its listed inputs include crude oil — the good the verdict reported', gasIds.join(','));
  const crude = gas.legs.flat().find(i => i.id === 'crudeOil');
  ok(crude.name === 'Crude Oil' && crude.made === 0, 'named in words, and marked as made by nobody here');
  ok(crude.makers.some(m => m.key === 'fuelrig'), 'with the city building that can make it (Fuel Rig)', JSON.stringify(crude.makers));

  const mun = eco('munitions', ctx.ECO_BUILDING_MAP.munitions.out[0]);
  const munIds = mun ? mun.legs.flat().map(i => i.id) : [];
  ok(munIds.includes('aluminum'), 'Munitions lists aluminum', munIds.join(','));

  const ft = eco('foodtruck', ctx.ECO_BUILDING_MAP.foodtruck.out[0]);
  ok(ft && ft.alternatives && ft.legs.length >= 2, 'Food Truck: the feedstock alternatives are listed as "any one of"', ft && ft.legs.length);

  const house = eco('housing', ctx.ECO_BUILDING_MAP.housing.out[0]);
  const steel = house && house.legs.flat().find(i => i.id === 'structuralSteel');
  ok(!!steel, 'Housing lists structural steel');
  ok(steel && steel.makers.length === 0, 'and says no city building makes it (import it) — the honest answer today', steel && JSON.stringify(steel.makers));

  const fed = eco('gasstation', 'gasoline', [{ id: 2, tileKey: '9,9', out: 'crudeOil' }]);
  ok(fed.legs.flat().find(i => i.id === 'crudeOil').made === 1, 'a crude-oil business standing in the city is counted');
}

console.log('\n=== 2. absent module, absent firm ===');
{
  ctx.window.MythicEconomy = undefined;
  ok(ctx._ecoChainInputs('4,5') === null, 'no economy module: nothing is added to the card');
  ctx.window.MythicEconomy = firmsFor([{ id: 1, tileKey: '1,1', out: 'gasoline' }]);
  ok(ctx._ecoChainInputs('4,5') === null, 'no firm on this tile: nothing is added');
  const src = fnText('insChain');
  ok(/const eco = _ecoChainInputs\(x \+ ',' \+ z\);/.test(src), 'insChain asks for this tile, by the same key the firms carry');
}

console.log('\n=== 3. NEGATIVE CONTROL — the city def alone ===');
{
  const row = (key) => (NC.match(new RegExp('\\n\\s*' + key + ':\\s*\\{[^\\n]*')) || [''])[0];
  ok(!/crudeOil/.test(row('gasstation')) && !/aluminum/.test(row('munitions')),
    'the Gas Station and Munitions defs never mention crude oil or aluminum — what the old card was limited to');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ the chain card and the verdict name the same inputs\n');
process.exit(fails ? 1 : 0);
