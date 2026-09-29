/* ❌ THE CRAFTING STATION MAKES NOTHING CARD-SHAPED — driven, not read.

   Reported: "players are able to craft booster packs". They were: the
   Crafting Station shipped 'pack' and 'box' recipes whose grant put REAL
   unopened packs in the inventory, on a station that survived the removal of
   the Card Forge because it was never called a forge. The instruction is
   "cannot craft anything that has anything to do with cards", so packs,
   boxes and card sleeves are out, and the rule is enforced at the GRANT: a
   card recipe still sitting in a published Catalog, a cached Forge copy or an
   old device is not listed, is not made, and spends nothing.

   Run: node _nocardcraft_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');

/* ── lift the station: from the rule down to craftStationMake ───────────── */
const b = SRC.indexOf('const CRAFT_CARD_RES = {');
const e = SRC.indexOf("try { window.__mg = window.__mg || {}; window.__mg.craft = { recipes: getAllCraftRecipes, make: craftStationMake }; }");
ok(b > 0 && e > b, 'the station block is where expected');
const BLOCK = SRC.slice(b, e);

function station(opts) {
  const log = { spent: [], refunded: [], packs: 0, dice: 0, saved: 0 };
  const ctx = {
    Forge: { craftRecipes: opts.forge || [] },
    Catalog: { craftRecipes: opts.catalog || [] },
    Profile: { ownedDiceSkins: [], ownedSleeves: [] },
    addRes: (id, n) => log.refunded.push([id, n]),
    canAffordResources: () => true,
    spendResources: (cost) => { log.spent.push(cost); return true; },
    getAllCustomPacks: () => [{ id: 'p1', name: 'Set One' }],
    addUnopenedPack: () => { log.packs++; },
    addUnopenedPacks: (d, n) => { log.packs += n; },
    getAllDiceSkins: () => [{ id: 'd1', name: 'Bone', img: 'x' }],
    getAllDeckSleeves: () => [{ id: 's1', name: 'Velvet' }],
    saveProfile: () => { log.saved++; },
    _meta: (id) => ({ icon: '📦', name: id }),
    Math, Object, Array, String, console,
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK + '\nthis.recipes = getAllCraftRecipes; this.make = craftStationMake; this.allowed = _craftKindAllowed; this.DEF = CRAFT_RECIPES_DEFAULT;', ctx);
  ctx.log = log;
  return ctx;
}

/* ── 1. the defaults ────────────────────────────────────────────────────── */
{
  const c = station({});
  ok(c.DEF.length === 1 && c.DEF[0].id === 'dice', 'the default table is the dice skin alone', c.DEF.map(r => r.id).join(','));
  ok(!/id: 'pack',\s+icon: '🎴', name: 'Booster Pack'/.test(SRC) && !/id: 'box',\s+icon: '📦', name: 'Booster Box'/.test(SRC) && !/id: 'sleeve', icon: '🃏', name: 'Card Sleeve'/.test(SRC),
    'the pack, box and sleeve rows are gone from the page');
}

/* ── 2. the rule ────────────────────────────────────────────────────────── */
{
  const c = station({});
  ok(c.allowed({ out: { kind: 'pack' } }) === false, 'pack is refused');
  ok(c.allowed({ out: {} }) === false && c.allowed({}) === false, 'a recipe with no kind is a pack (the historic default) and is refused');
  ok(c.allowed({ out: { kind: 'sleeve' } }) === false, 'sleeve is refused');
  ok(c.allowed({ out: { kind: 'dice' } }) === true, 'dice is allowed');
  ok(c.allowed({ out: { kind: 'resource', resId: 'metal' } }) === true, 'a resource recipe for metal is allowed');
  for (const id of ['boosterPacks', 'starterDecks', 'cardBoxes', 'collectorPacks', 'tournamentProducts'])
    ok(c.allowed({ out: { kind: 'resource', resId: id } }) === false, 'a resource recipe refining ' + id + ' is refused');
  ok(c.allowed({ out: { kind: 'resource' } }) === false, 'a resource recipe with no id is refused');
}

/* ── 3. a published pack recipe is neither listed nor made ──────────────── */
{
  const cat = [
    { id: 'pack', name: 'Booster Pack', cost: { supplies: 8 }, out: { kind: 'pack', amount: 1 } },
    { id: 'box',  name: 'Booster Box',  cost: { supplies: 48 }, out: { kind: 'pack', amount: 8 } },
    { id: 'legacy', name: 'Old Pack',   cost: { supplies: 8 } },
    { id: 'dice', name: 'Dice Skin',    cost: { metal: 12 }, out: { kind: 'dice', amount: 1 } },
  ];
  const c = station({ catalog: cat });
  ok(c.recipes().map(r => r.id).join(',') === 'dice', 'a published catalog lists only the dice recipe', c.recipes().map(r => r.id).join(','));
  for (const id of ['pack', 'box', 'legacy']) {
    const r = c.make(id);
    ok(r.ok === false && /cannot be crafted/.test(r.msg), 'making "' + id + '" is refused by name', JSON.stringify(r));
  }
  ok(c.log.spent.length === 0 && c.log.packs === 0 && c.log.refunded.length === 0, 'nothing was spent, granted or refunded');
  const d = c.make('dice');
  ok(d.ok === true && c.log.spent.length === 1 && c.Profile.ownedDiceSkins.length === 1, 'the dice recipe still crafts', JSON.stringify(d));
  ok(c.make('nope').msg === 'Unknown recipe.', 'an id nobody published is simply unknown');
}

/* ── 4. a cached device copy with only pack recipes falls through, not open */
{
  const c = station({ forge: [{ id: 'pack', cost: { supplies: 8 }, out: { kind: 'pack' } }] });
  ok(c.recipes().map(r => r.id).join(',') === 'dice', 'a Forge copy holding only card recipes yields the default dice recipe, not the packs');
  ok(c.make('pack').ok === false && c.log.packs === 0, '…and the pack still cannot be made from it');
}

/* ── 5. the grant itself refuses, even if handed a pack recipe directly ── */
{
  const c = station({});
  const out = vm.runInContext("_craftProduce({ id: 'x', out: { kind: 'pack', amount: 8 } })", c);
  ok(out === null && c.log.packs === 0, '_craftProduce hands back null for a pack and grants nothing');
}

/* ── 6. the editor ──────────────────────────────────────────────────────── */
{
  const i = SRC.indexOf('const OUT_KINDS = [');
  const K = SRC.slice(i, i + 200);
  ok(!/'pack'/.test(K) && !/'sleeve'/.test(K) && /'dice'/.test(K) && /'resource'/.test(K), 'the recipe editor offers dice and resource only');
  ok(!/out: \{ kind: 'pack', amount: 1 \}/.test(SRC), 'no default anywhere on the page creates a pack recipe');
}

/* ── 7. the six version knobs ───────────────────────────────────────────── */
{
  const NC = readFileSync('./public/node-city/index.html', 'utf8');
  const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
  ok(!!v && readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION', v);
  ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js CACHE_VERSION carries the build');
  ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
  ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js cache-busters equal the build');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
