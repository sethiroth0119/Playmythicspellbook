/* 🏬 SIX RESOURCES THE CITY MADE, SPENT AND SAVED — AND NEVER ONCE SHOWED.

   Two reports, one cause:
     "Re-agents are apparently being produced by the smelter but they are not
      being shown through any of the game… if you go into the Bank of Ethos and
      into the Ops Vault, there is no place in the vault for those re-agents."
     "Remedies aren't showing in some of the game."

   🔴 BOTH TRUE, NEITHER A LEDGER BUG. The six CITY_STOCK goods — rations,
   components, reagents, goods, remedies, planks — are the CITY's inventory, not
   the player's salvage ledger. They are produced, they are consumed, they ride
   the save, and they are held against a WAREHOUSE ceiling, which is what makes
   "without storage, production stops when full" a real constraint. They are
   deliberately absent from Profile.salvage, so the Ops Vault cannot list them
   and never could.

   What was missing is that NOTHING SHOWED THE SHELF. The only numbers on screen
   were a "have N" beside one input inside a producer's own panel, and a
   build-cost tooltip. A player who filled a warehouse with reagents had no view
   of them anywhere, and reasonably concluded the resource was not tracked.

   ⚠ AND THE FIX IS NOT A NEW RAIL BUTTON. The card rail is at fifteen launchers
     and node-city's own note above that registry says a SIXTEENTH is the one
     that would have to be measured for a third row. The Warehouse is also the
     honest home: its levels are what SET stockCap(), so the shelf and its
     ceiling are described in one place.

   Run: node _citystock_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');

function litOf(name, open) {
  const i = NC.indexOf('const ' + name + ' = ' + open);
  if (i < 0) throw new Error('cannot find ' + name);
  const close = open === '[' ? ']' : '}';
  let d = 0;
  for (let k = NC.indexOf(open, i); k < NC.length; k++) {
    if (NC[k] === open) d++;
    else if (NC[k] === close) { d--; if (!d) return NC.slice(NC.indexOf(open, i), k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const CITY_STOCK = vm.runInNewContext('(' + litOf('CITY_STOCK', '{') + ')', { STOCK_CAP_PER_WAREHOUSE: 400 });
const BUILDINGS = (() => {
  const ctx = { STOCK_CAP_PER_WAREHOUSE: 400 };
  vm.createContext(ctx);
  for (let i = 0; i < 80; i++) {
    try { return vm.runInContext('(' + litOf('BUILDINGS', '{') + ')', ctx); }
    catch (e) { const m = /(\w+) is not defined/.exec(e.message); if (!m) throw e; ctx[m[1]] = 0; }
  }
  throw new Error('BUILDINGS would not evaluate');
})();

/* ── 1. THE SHELF HAS A VIEW ─────────────────────────────────────────────── */
{
  ok(/if \(def\.stockCap\) \{/.test(NC), 'a building that provides storage now describes what is in it');
  ok(/insCardHtml\('Refined stock'/.test(NC), 'as a Refined stock card');
  ok(/STOCK_KEYS\.map\(r => \{/.test(NC), 'listing every city-stock good, not a hand-picked few');
  /* Every one of the six must be reachable by that loop, including the two the
     reports named. A card that showed four of six would be the same bug. */
  ok(Object.keys(CITY_STOCK).length === 6, 'there are six city-stock goods', Object.keys(CITY_STOCK).join(', '));
  for (const id of ['reagents', 'remedies'])
    ok(!!CITY_STOCK[id], id + ' is one of them — it is what was reported missing');
}

/* ── 2. EXACTLY ONE BUILDING HOSTS IT, AND IT IS THE RIGHT ONE ───────────── */
{
  const hosts = Object.keys(BUILDINGS).filter(k => BUILDINGS[k] && BUILDINGS[k].stockCap);
  ok(hosts.length === 1 && hosts[0] === 'warehouse',
    'the Warehouse hosts the card — the building whose levels SET the ceiling it prints',
    hosts.join(', '));
  ok((BUILDINGS.warehouse.stockCap | 0) > 0, 'and it really does provide storage', String(BUILDINGS.warehouse.stockCap));
}

/* ── 3. THE RAIL DID NOT GROW ────────────────────────────────────────────── */
{
  /* node-city's own note says a SIXTEENTH launcher is the one that would have
     to be measured for a third row. The rail is already at sixteen — that
     predates this fix — so the claim here is not a bound on the count but that
     THIS fix spent nothing: the shelf is an inspect card on an existing
     building, not a new launcher. Asserted that way round so the check keeps
     meaning something whatever the rail does next. */
  const rail = (NC.match(/\{ id: '\w+card',\s+ico:/g) || []).length;
  const railIds = (NC.match(/\{ id: '(\w+card)',\s+ico:/g) || []).map(r => /'(\w+card)'/.exec(r)[1]);
  ok(!railIds.some(id => /stock/i.test(id)),
    'the refined-stock view added NO rail launcher — it is a card on the Warehouse, which is why the third-row risk is untouched',
    railIds.join(' '));
  ok(/insCardHtml\('Refined stock'/.test(NC) && !/id: 'stockcard'/.test(NC),
    'it is an inspect card, not a registry entry');
  ok(rail >= 15, 'the rail is where it already was', String(rail) + ' launchers');
}

/* ── 4. IT SAYS WHY THE VAULT DOES NOT HAVE THEM ─────────────────────────── */
{
  /* Both reports were filed FROM the vault, so the card has to answer the
     question that was actually asked, not merely print numbers. */
  ok(/City goods — rations, planks and remedies can be sent to your stash/.test(NC) && /data-stash-send=/.test(NC), 'the card names the distinction the reports tripped on — and since v121v105 says which goods can be sent to the stash');
  ok(/will not appear in the Bank of Ethos Ops Vault/.test(NC),
    'and says so about the exact screen the player went looking on');
  ok(/cannot be deposited, withdrawn or contributed to the Foundation Reserve/.test(NC),
    'including the three things they tried to do with them');
  ok(/A full shelf stops the buildings that make it/.test(NC),
    'and what a full shelf costs, which is the reason the ceiling exists at all');
  ok(/insAlert\('info'/.test(NC), 'as a neutral note');
  ok(/#inspect \.al\.info\{/.test(NC),
    'and the neutral style exists — warn and bad were the only two, and both would dress a plain fact as a problem');
}

/* ── 5. THE NUMBERS ARE THE REAL ONES ────────────────────────────────────── */
{
  ok(/const cap = stockCap\(\);/.test(NC), 'the ceiling comes from stockCap(), the same function the tick clamps against');
  ok(/const have = stockOf\(r\);/.test(NC), 'and the amounts from stockOf(), the same reader haveOf() uses');
  ok(/they do not share one pool/.test(NC),
    'and it states that the ceiling is PER GOOD — the tick clamps each resource against the whole cap, which is not obvious from one number');
  ok(/Held across all six/.test(NC), 'with a total, so a nearly-full city is legible at a glance');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
