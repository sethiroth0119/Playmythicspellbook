/* 👻 THE STASH CHARGED FOR THREE TIMES WHAT IT SHOWED (v121v81).

   Reported: "After doing a rough count up, I had approximately 9000 units in my
   stash. However, the stash is showing approx 24000 units… I know Ingots count
   for nearly 3000 of these, but an investigation needs to be done to find out
   which other resources are invisible before the stashes are completely full.
   Unfortunately adding more detail to this is tough as I don't know what else
   is missing."

   THE INVESTIGATION, ANSWERED: Profile.salvage is ONE map and TWO catalogues
   live in it. RESOURCES carries 143 ids (the chain and city ledger).
   SALVAGE_RES carries 397 (loot, crafting and camp material), and 265 of those
   appear in NO RESOURCES row. getResourceUnits() sums every key in the map, so
   all 265 counted against the vault ceiling — and the panel rendered
   `RESOURCES.filter(held)`, so not one of them could ever be seen. A player
   could be pushed into a full vault by crystal dust and drone parts they had no
   way to look at, never mind spend.

   THE INVARIANT THIS SUITE EXISTS FOR: the rows the stash prints must sum to
   the number the cap is charged against. Anything else is a panel that lies.

   Run: node _stashvis_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const IDX = readFileSync('./public/index.html', 'utf8');

function fnText(name) {
  const i = IDX.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = IDX.indexOf('{', i); k < IDX.length; k++) {
    if (IDX[k] === '{') d++;
    else if (IDX[k] === '}') { d--; if (!d) return IDX.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function litOf(name, open) {
  const i = IDX.indexOf('const ' + name + ' = ' + open);
  if (i < 0) throw new Error('cannot find ' + name);
  const close = open === '[' ? ']' : '}';
  let d = 0;
  for (let k = IDX.indexOf(open, i); k < IDX.length; k++) {
    if (IDX[k] === open) d++;
    else if (IDX[k] === close) { d--; if (!d) return IDX.slice(IDX.indexOf(open, i), k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const RESOURCES = vm.runInNewContext('(' + litOf('RESOURCES', '[') + ')');
const SALVAGE_RES = vm.runInNewContext('(' + litOf('SALVAGE_RES', '[') + ')');
const resIds = new Set(RESOURCES.map(r => r.id));
const salIds = new Set(SALVAGE_RES.map(r => r.id));
const salOnly = [...salIds].filter(id => !resIds.has(id));

/* ── 1. THE SCALE OF THE PROBLEM, MEASURED ───────────────────────────────── */
{
  ok(RESOURCES.length >= 140, 'RESOURCES carries the chain/city ledger', String(RESOURCES.length));
  ok(SALVAGE_RES.length >= 380, 'SALVAGE_RES carries loot and crafting material', String(SALVAGE_RES.length));
  ok(salOnly.length >= 200,
    salOnly.length + ' ids live ONLY in SALVAGE_RES — every one of them counted against the vault and was never listed',
    salOnly.slice(0, 5).join(', ') + ' …');
  /* Named individually because the report asked what else was missing. */
  for (const id of ['crystalDust', 'droneParts', 'toolKits', 'weaponParts', 'scrapMetal'])
    ok(salIds.has(id) && !resIds.has(id), id + ' is one of them');
}

/* ── 2. THE RESOLVER ANSWERS FOR EVERY ID ────────────────────────────────── */
function world(ledger) {
  const ctx = { RESOURCES, SALVAGE_RES, String, Object, _ensureResources: () => ledger || {} };
  vm.createContext(ctx);
  vm.runInContext('let _stashMetaCache = null;\n' + fnText('_stashMeta') + '\n' + fnText('_stashNameOf') + '\n' +
    fnText('_stashRowOf') + '\n' + fnText('stashHeldRows'), ctx);
  return ctx;
}
{
  const c = world({});
  const row = (id) => vm.runInContext('_stashRowOf(' + JSON.stringify(id) + ')', c);
  ok(row('metal').from === 'ledger', 'a chain id resolves from RESOURCES', row('metal').from);
  ok(row('crystalDust').from === 'salvage' && row('crystalDust').name === 'Crystal Dust',
    'a loot id resolves from SALVAGE_RES and gets its real name', JSON.stringify(row('crystalDust')));
  ok(row('crystalDust').icon && row('crystalDust').icon !== '❔', 'with its real icon', row('crystalDust').icon);
  /* The last resort must ALWAYS answer — an unnameable pile is the bug. */
  const gh = row('someUnknownThing');
  ok(gh.from === 'unknown' && gh.name === 'Some Unknown Thing',
    'an id NEITHER catalogue claims is still shown, humanised — a row nobody can name beats a pile nobody knows exists',
    JSON.stringify(gh));
  ok(gh.icon === '❔', 'and is visibly marked as unrecognised', gh.icon);
  /* Shared ids: the chain row wins, so the city and the camp print one glyph. */
  const both = [...resIds].filter(id => salIds.has(id));
  ok(both.length > 0, 'some ids sit in BOTH catalogues', both.slice(0, 4).join(', '));
  for (const id of both.slice(0, 3))
    ok(row(id).from === 'ledger', id + ' resolves from RESOURCES, not SALVAGE_RES — one glyph everywhere');
}

/* ── 3. THE INVARIANT: WHAT IS SHOWN SUMS TO WHAT IS CHARGED ─────────────── */
{
  /* A ledger with all three kinds in it: chain, loot, and an id nobody claims. */
  /* THE REPORTED NUMBERS, as a fixture: ~9,000 units the player could count,
     ~24,000 the stash charged for, and ingots ~3,000 of the visible part. */
  const ledger = { metal: 3100, ingots: 2900, food: 3000,
                   crystalDust: 6400, droneParts: 4100, toolKits: 3200, someUnknownThing: 1300,
                   fuel: 0, cloth: -5 };
  const c = world(ledger);
  vm.runInContext(fnText('getResourceUnits'), c);
  const rows = vm.runInContext('stashHeldRows()', c);
  const units = vm.runInContext('getResourceUnits()', c);
  const shown = rows.reduce((a, x) => a + x.n, 0);
  ok(shown === units,
    'the rows the panel prints sum EXACTLY to the units the cap is charged against — this is the whole defect',
    shown + ' shown vs ' + units + ' charged');
  ok(rows.length === 7, 'zero and negative holdings are not listed', String(rows.length));
  ok(rows[0].id === 'crystalDust' && rows[0].n === 6400, 'biggest pile first — and on the reported numbers the biggest pile is one that was INVISIBLE', JSON.stringify(rows[0]));
  ok(rows.some(x => x.id === 'crystalDust'), 'and a loot id IS in the list now — it never was before');
  ok(rows.some(x => x.id === 'someUnknownThing'), 'as is an id from neither catalogue');
  /* The old behaviour, reproduced, so the regression is evidence rather than a story. */
  const oldShown = RESOURCES.filter(x => (ledger[x.id] | 0) > 0).reduce((a, x) => a + (ledger[x.id] | 0), 0);
  ok(oldShown < units, 'the OLD filter showed strictly less than it charged for',
    oldShown + ' of ' + units + ' — ' + (units - oldShown) + ' units invisible');
  ok(Math.round((units - oldShown) / units * 100) >= 55,
    'and the fixture reproduces the report: about 9,000 countable against about 24,000 charged', oldShown + ' visible of ' + units + ', ' + Math.round((units - oldShown) / units * 100) + '% hidden');
}

/* ── 4. THE PANEL USES IT ────────────────────────────────────────────────── */
{
  ok(!/const _held = \(typeof RESOURCES !== 'undefined' \? RESOURCES : \[\]\)\.filter\(x => \(_R\[x\.id\] \| 0\) > 0\)/.test(IDX),
    'the panel no longer filters the RESOURCES catalogue');
  ok(/const _held = stashHeldRows\(\);/.test(IDX), 'it asks the ledger what it is actually holding');
  ok(/_hiddenKinds/.test(IDX) && /_hiddenUnits/.test(IDX),
    'and counts what the chain catalogue does not carry, so the make-up of the pile is legible');
  ok(/were always taking up vault space and were never listed here before/.test(IDX),
    'with a line saying so — a player who has been fighting a full vault deserves the explanation');
  ok(/loot \/ crafting material/.test(IDX), 'and each such row says what it is on hover');
  ok(/<b>\$\{x\.n\.toLocaleString\(\)\}<\/b>/.test(IDX),
    'the amount comes off the row, not a second lookup that could disagree with the sum');
}

/* ── 5. NOTHING ELSE CHANGED ─────────────────────────────────────────────── */
{
  ok(/function getResourceUnits\(\) \{[\s\S]{0,200}for \(const k in R\) n \+= Math\.max\(0, R\[k\] \| 0\);/.test(IDX),
    'the CAP still counts every key exactly as it did — the fix is that the panel caught up, not that the ceiling moved');
  ok(/_stashMetaCache/.test(IDX), 'the catalogue merge is cached — it is read on every panel paint');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
