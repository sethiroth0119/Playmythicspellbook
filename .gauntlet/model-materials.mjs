/* ══════════════════════════════════════════════════════════════════════════
   🧪 MODEL-MATERIALS — what the eight shops need before they can stock a shelf.

   Every shop placed by the commerce round founds a firm, hires a crew and
   earns nothing. The cause is not the shops: sim.js availabilityMap() computes
   a firm's input availability from S.INV — LOCAL inventory — so an input bought
   in from outside (payUpstream books it as an import) never lifts production
   above zero. A shop therefore needs a LOCAL PRODUCER for every input, all the
   way down, and this city has no chemical tier at all.

   This walks the recipe graph under a proposed set of new producer buildings
   and reports exactly which shops light up. It is the same primary-leg walk
   tools/economy-tests round0j uses, so its answer and the gate's agree.

   Run:  node .gauntlet/model-materials.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';

const R = await import('../public/src/economy/recipes.js');
const nc = readFileSync(new URL('../public/node-city/index.html', import.meta.url), 'utf8');
const s0 = nc.indexOf('const ECO_BUILDING_MAP = {');
const seg = nc.slice(s0, nc.indexOf('\n};', s0));

const BASE = new Set();
for (const m of seg.matchAll(/out:\s*\[([^\]]*)\]/g))
  for (const q of m[1].matchAll(/'([^']+)'/g)) BASE.add(q[1]);

/* round0j's rule, verbatim: a deposit is the ground (or an import the trade
   layer can actually source); a byproduct is never banked; everything else has
   to be MADE BY A CITY TILE and have every primary-leg input reachable. */
function reachFor(set) {
  const memo = new Map();
  return function reach(id, stack) {
    if (R.isDeposit(id)) return true;
    if (R.isByproduct(id)) return false;
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return false;
    if (!set.has(id)) { memo.set(id, false); return false; }
    stack.add(id);
    const leg = R.legsOf(id)[0] || { in: {} };
    let ok = true;
    for (const inp in (leg.in || {})) if (!reach(inp, stack)) { ok = false; break; }
    stack.delete(id);
    memo.set(id, ok);
    return ok;
  };
}

/* The proposed tier. Each one is a real recipe whose own inputs bottom out in
   ground this city already digs (rawWater, crudeOil, naturalGas, sugarCrops,
   lumber, quartz, silica/sand) or in another member of the tier. */
const TIER = [
  'industrialWater', 'petrochemicals', 'chemicalFeedstock', 'industrialChemicals',
  'syntheticFiber', 'adhesives', 'solvents', 'paint', 'rubber', 'sugar',
  'woodPanels', 'furnitureComponents', 'plasticFeedstock', 'plastic',
];

const SHOPS = {
  'Clothing Store': 'clothing', 'Great Buy': 'appliances', Pharmacy: 'medicine',
  'Furniture Store': 'furniture', 'Game Store': 'toys', Cinema: 'beverages',
  'Fast Food': 'preparedMeals', 'Weapon Shop': 'sportingGoods',
};

const before = reachFor(BASE);
const after = reachFor(new Set([...BASE, ...TIER]));

console.log('THE EIGHT SHOPS');
let lit = 0;
for (const [shop, out] of Object.entries(SHOPS)) {
  const b = before(out, new Set()), a = after(out, new Set());
  if (a) lit++;
  console.log('  ' + shop.padEnd(16) + out.padEnd(15) +
              (b ? 'lit' : 'dark') + '  ->  ' + (a ? 'LIT' : 'still dark'));
}

console.log('\nTHE TIER ITSELF — each member must reach the ground too');
for (const t of TIER) console.log('  ' + t.padEnd(22) + (after(t, new Set()) ? 'ok' : 'STILL DARK'));

const darkBefore = [...BASE].filter((id) => !before(id, new Set()));
const darkAfter = [...new Set([...BASE, ...TIER])].filter((id) => !after(id, new Set()));
console.log('\nROUND0J DARK LIST (the gate\'s ceiling is 19)');
console.log('  before: ' + darkBefore.length);
console.log('  after:  ' + darkAfter.length + (darkAfter.length <= 19 ? '   ✅ under the shipped ceiling' : '   ❌ still over'));
console.log('  still dark: ' + darkAfter.sort().join(', '));
console.log('\n  ' + lit + ' of 8 shops light up.');

/* What the ones that stay dark are waiting on — named, so the next round has a
   shopping list rather than a mystery. */
console.log('\nWHAT THE REST STILL NEED');
const S2 = new Set([...BASE, ...TIER]);
for (const [shop, out] of Object.entries(SHOPS)) {
  if (after(out, new Set())) continue;
  const need = new Set();
  (function walk(id, seen) {
    if (R.isDeposit(id) || seen.has(id)) return;
    seen.add(id);
    if (R.isByproduct(id)) { need.add(id + ' (byproduct — never banked)'); return; }
    if (!S2.has(id)) need.add(id);
    const leg = R.legsOf(id)[0];
    if (!leg) { need.add(id + ' (no recipe)'); return; }
    for (const inp in (leg.in || {})) walk(inp, seen);
  })(out, new Set());
  need.delete(out);
  console.log('  ' + shop + ': ' + ([...need].join(', ') || '—'));
}
