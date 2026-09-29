#!/usr/bin/env node
/* gen-catalog.mjs — writes public/src/supplychain/catalog.snapshot.js.

   WHY A GENERATOR AND NOT A HAND-TYPED LIST
   The Supply Chain feature has to account for EVERY resource id in the game, and the
   truth is split across places that do not agree with each other:
     RESOURCES           public/index.html   the live ledger (camp / market / cost renderers)
     SALVAGE_RES         public/index.html   the battle-loot table + everything storable
     LOOT_RES_IDS        public/index.html   the 14-id weighted STAPLE pool camp loot rolls from
     RESOURCE_CHAIN      public/src/resources/chain.js   the industrial chain catalogue
     WF_REPAIR_RESOURCES public/index.html   the Fishing Corp drydock's four repair materials

   WHY WF_REPAIR_RESOURCES IS A CATALOGUE ROW AND WARPATH IS NOT (round-2 correction)
   Round 1 declared WF_REPAIR "out of scope" because its stock lives on
   Profile.fishingCorp.resources rather than in camp storage. That was wrong for the one
   thing this feature exists to draw: "Fishing company" is a business the OWNER DREW on PDF
   p7, with a Transport icon, and WF_REPAIR_RECIPE is its ONLY declared material demand.
   A catalogue that cannot name planking / rivets / pitch / hullPlates leaves the modal's
   "what they need to start" empty for a business on the map, and hides the four cleanest
   Transport lanes on it (they have demand and no producer). Being held in a private
   stockpile is a fact about the lane, not a reason to forget the resource — so they are
   rows carrying inShipyard:true, and shipping.js decides what that means.
   The Warpath roguelite's own RESOURCES table (public/warpath/warpath-mapgen.js) stays OUT:
   it is a parallel namespace on a different map ('gold' there is "Expedition Gold", a
   different thing from the ledger's goldOre), nothing there is a business input, and
   promoting it would make "every resource has a use" a claim about two economies at once.
   It is recorded in OTHER_TABLES instead so the audit can SAY that rather than look like
   it missed twelve ids.

   COMPLETENESS, NOT JUST ROWS
   PHANTOMS (catalog.js) is the record of ids the game names but no table defines. Round 1
   found four by hand and stopped; three more sat on the same line it had already read
   (_CS_RESOURCE_KEYS). So the generator now also extracts every OTHER id-bearing table it
   knows of into CATALOG_META.otherTables, and catalog.js's unaccounted() fails loudly for
   any id there that is neither a row, nor a phantom, nor a named local table. Finding the
   next one becomes a test failure instead of a critic's lucky grep.
   The first two are top-level const in a classic script — lexical globals, NOT on
   window (CLAUDE.md, "the globals trap") — so no ES module and no Node test can import
   them. A retyped copy would rot silently: chain.js's own header still says
   "RESOURCES (14) / SALVAGE_RES (149)" while the real numbers are 161 / 410. So the
   copy is machine-made, and re-running this file is the only way it ever changes.

   At RUNTIME the snapshot is still not the last word: catalog.js withLive() lets rows
   handed over by SupplyChainBridge override it (admin custom resources are pushed into
   SALVAGE_RES after boot). The snapshot is what Node tests and critics read.

   REJECTED: parsing the arrays with a regex per row. RESOURCES carries multi-line block
   comments between rows and the two arrays use different quote styles; an evaluated
   array literal is exact, a regex is approximately exact.
   REJECTED: stamping generatedAt / source line numbers into the file. Other sessions edit
   index.html all day; line numbers move without the data moving, and the bar is "second
   run = identical file". Lines are printed to the console instead.

   Usage:
     node tools/supplychain/gen-catalog.mjs            regenerate, print a drift report
     node tools/supplychain/gen-catalog.mjs --check    write nothing; exit 1 if stale
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX = path.join(ROOT, 'public', 'index.html');
const CHAIN = path.join(ROOT, 'public', 'src', 'resources', 'chain.js');
const OUT   = path.join(ROOT, 'public', 'src', 'supplychain', 'catalog.snapshot.js');
const CHECK = process.argv.includes('--check');

const die = (msg) => { console.error('gen-catalog: ' + msg); process.exit(2); };

/* CRLF-normalised on read: any git checkout on this machine rewrites .html/.js as CRLF
   (the "Git CRLF trap"), and a comparison over raw bytes would then report drift when
   nothing changed. */
const readLF = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');
const importSource = (src) =>
  import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));

/* Pull one top-level "const NAME = [ ... ];" out of index.html by SYMBOL, never by line
   number. The terminator is the first line that is exactly "];" at column 0 — rows are
   indented, so nothing inside the literal can match. Evaluated in an empty vm context:
   if someone ever puts a function call inside the array this throws loudly rather than
   quietly running page code inside the generator. */
function extractArray(lines, name, kind = 'rows', decl = 'const') {
  const head = decl + ' ' + name + ' = [';
  const hits = [];
  lines.forEach((l, i) => { if (l.startsWith(head)) hits.push(i); });
  if (hits.length !== 1) die('expected exactly one "' + head + '" in index.html, found ' + hits.length);
  const a = hits[0];
  let b = -1;
  // A row table closes on a line that is exactly "];" at column 0. An id list (LOOT_RES_IDS)
  // is a short wrapped literal of strings that closes at the END of its last line — and
  // could be a one-liner — so there the first line ending in "];" is the terminator.
  const close = kind === 'ids' ? /\];\s*$/ : /^\];?\s*$/;
  for (let i = kind === 'ids' ? a : a + 1; i < lines.length; i++) if (close.test(lines[i])) { b = i; break; }
  if (b < 0) die('no closing "];" after ' + name);
  const literal = '[' + lines.slice(a, b + 1).join('\n').slice(head.length).replace(/;\s*$/, '');
  let rows;
  try { rows = vm.runInNewContext('(' + literal + ')', Object.create(null), { timeout: 5000 }); }
  catch (e) { die(name + ' did not evaluate as a plain array literal: ' + e.message); }
  // vm arrays belong to another realm (Array.isArray is fine, instanceof is not); re-box.
  rows = JSON.parse(JSON.stringify(rows));
  // Sanity floor: a big table that suddenly has three rows means the extractor found the
  // wrong terminator. WF_REPAIR_RESOURCES is genuinely four rows, so the floor is per-table.
  const floor = kind === 'ids' ? 1 : (name === 'WF_REPAIR_RESOURCES' ? 4 : 10);
  if (!Array.isArray(rows) || rows.length < floor) die(name + ' looks wrong (' + (rows && rows.length) + ' rows)');
  if (kind === 'ids') {
    const badId = rows.find((r) => typeof r !== 'string' || !r);
    if (badId !== undefined) die(name + ' has an entry that is not a string id: ' + JSON.stringify(badId));
    return { rows, firstLine: a + 1, lastLine: b + 1 };
  }
  const bad = rows.find((r) => !r || typeof r.id !== 'string' || !r.id);
  if (bad) die(name + ' has a row without a string id: ' + JSON.stringify(bad));
  return { rows, firstLine: a + 1, lastLine: b + 1 };
}

/* Same trick for a top-level object literal ("var RESOURCES = {" ... "};" at column 0).
   Only used for tables OUTSIDE the catalogue, where we want the ids (and, so nothing is
   ever retyped, the names/icons) but not a row. */
function extractObject(lines, name, decl = 'const') {
  const head = decl + ' ' + name + ' = {';
  const hits = [];
  lines.forEach((l, i) => { if (l.startsWith(head)) hits.push(i); });
  if (hits.length !== 1) die('expected exactly one "' + head + '", found ' + hits.length);
  const a = hits[0];
  let b = -1;
  for (let i = a + 1; i < lines.length; i++) if (/^\};?\s*$/.test(lines[i])) { b = i; break; }
  if (b < 0) die('no closing "};" after ' + name);
  const literal = '{' + lines.slice(a, b + 1).join('\n').slice(head.length).replace(/;\s*$/, '');
  let obj;
  try { obj = vm.runInNewContext('(' + literal + ')', Object.create(null), { timeout: 5000 }); }
  catch (e) { die(name + ' did not evaluate as a plain object literal: ' + e.message); }
  return { obj: JSON.parse(JSON.stringify(obj)), firstLine: a + 1, lastLine: b + 1 };
}

/* extractLiteral — the LOOSE extractor, for tables we only want the IDS of.

   WHY A THIRD EXTRACTOR. The catalogue tables above are top-level, unindented and close
   with "];" / "};" at column 0, so the two strict extractors can key off that shape and
   fail loudly when it moves. The eight completeness tables below do NOT share it:
   `_RES_SLOT` closes inline ("cloth:1 };"), `RESOURCE_NEEDS` is indented inside a
   function, `CONSUMABLE_RESOURCES` holds arrow functions. Eight special cases would be
   eight things to get wrong, so this walks candidate closing lines and keeps the FIRST
   span that evaluates as a literal of the expected bracket type — a prefix of a table
   does not evaluate, so the first success is the real end.
   Evaluated in an empty vm context like the others: arrow functions inside
   CONSUMABLE_RESOURCES are only PARSED here, never called.
   REJECTED: a regex over `id:` / quoted keys. RESOURCE_CINDER_VALUE carries block comments
   with prices in them and CONSUMABLE_RESOURCES carries whole function bodies; a regex
   would harvest words out of prose. */
function extractLiteral(lines, name, { file = 'public/index.html', maxSpan = 400 } = {}) {
  const head = new RegExp('^\\s*(?:const|let|var)\\s+' + name + '\\s*=\\s*([\\[{])');
  const hits = [];
  lines.forEach((l, i) => { const m = head.exec(l); if (m) hits.push([i, m[1]]); });
  if (hits.length !== 1) die('expected exactly one declaration of ' + name + ' in ' + file + ', found ' + hits.length);
  const [a, open] = hits[0];
  const close = open === '[' ? '\\]' : '\\}';
  const tail = new RegExp(close + '\\s*;?\\s*(?:\\/\\/.*)?$');
  const start = lines[a].indexOf(open, lines[a].indexOf(name));
  for (let b = a; b < Math.min(lines.length, a + maxSpan); b++) {
    if (!tail.test(lines[b])) continue;
    const text = [lines[a].slice(start), ...lines.slice(a + 1, b + 1)].join('\n').replace(/;\s*(?:\/\/.*)?$/, '');
    let v;
    try { v = vm.runInNewContext('(' + text + ')', Object.create(null), { timeout: 5000 }); } catch { continue; }
    if (open === '[' ? !Array.isArray(v) : (!v || typeof v !== 'object' || Array.isArray(v))) continue;
    // Ids are read off the RAW value: a JSON round-trip drops a key whose value is a
    // function, which is exactly the CONSUMABLE_RESOURCES shape.
    const ids = Array.isArray(v)
      ? v.map((x) => (typeof x === 'string' ? x : (x && x.id)))
      : Object.keys(v);
    const bad = ids.find((x) => typeof x !== 'string' || !x);
    if (bad !== undefined) die(name + ' (' + file + ') has an entry with no string id: ' + JSON.stringify(bad));
    return { ids, firstLine: a + 1, lastLine: b + 1 };
  }
  die('could not find the end of ' + name + ' in ' + file + ' within ' + maxSpan + ' lines');
}

const lines = readLF(INDEX).split('\n');
const R  = extractArray(lines, 'RESOURCES');
const SV = extractArray(lines, 'SALVAGE_RES');
/* LOOT_RES_IDS is NOT "is in SALVAGE_RES". It is the weighted allow-list the camp loot bag
   rolls from, and the two disagree on purpose: energyDrink is a staple (missions and
   containers pay it) but has no SALVAGE_RES row, so no chest, field bag or salvage roll can
   ever produce it. Round 1 folded this list into inLoot at runtime and gave energyDrink
   four drop sources it does not have. It is its own flag (staple) so a Node audit can see
   the difference without a browser. */
const LR = extractArray(lines, 'LOOT_RES_IDS', 'ids');
const stapleIds = new Set(LR.rows);
if (stapleIds.size !== LR.rows.length) die('duplicate id inside LOOT_RES_IDS');

/* 🛠 The drydock's four materials. Same {id,name,icon} shape as RESOURCES, but the colour
   key is `col`, not `color` — normalising it here is the only place that difference is
   allowed to exist. */
const WF = extractArray(lines, 'WF_REPAIR_RESOURCES');
const wfBadKey = WF.rows.find((r) => !('col' in r) || ('color' in r));
if (wfBadKey) die('WF_REPAIR_RESOURCES row ' + wfBadKey.id + ' no longer uses `col` — re-check the shape');
const shipyardById = new Map(WF.rows.map((r) => [r.id, { ...r, color: r.col }]));
if (shipyardById.size !== WF.rows.length) die('duplicate id inside WF_REPAIR_RESOURCES');
/* The demand side. Every non-cinder key of WF_REPAIR_RECIPE must be one of those four, or
   the drydock has a material this catalogue cannot name — which is exactly the hole this
   round is closing, so it is fatal rather than a warning. */
const WFR = extractObject(lines, 'WF_REPAIR_RECIPE');
const wfRecipeIds = [...new Set(Object.values(WFR.obj).flatMap((t) => Object.keys(t)))]
  .filter((k) => k !== 'cinder');
const wfUnknown = wfRecipeIds.filter((k) => !shipyardById.has(k));
if (wfUnknown.length) die('WF_REPAIR_RECIPE costs ids with no WF_REPAIR_RESOURCES row: ' + wfUnknown.join(' '));

/* ── OTHER id-bearing tables (recorded, never rows) ────────────────────────────────
   Each of these is a place the game names a resource id. catalog.js must account for every
   id here — as a row, a PHANTOM, or a named LOCAL_TABLE — and unaccounted() fails if not.
   Adding a source to this list is how the next blind spot becomes a test failure. */
const CSK = extractArray(lines, '_CS_RESOURCE_KEYS', 'ids');          // admin restock-cost whitelist
const WPM = extractArray(lines, 'WARPATH_MATERIALS', 'ids');          // the six extraction materials
const wpSrc = readLF(path.join(ROOT, 'public', 'warpath', 'warpath-mapgen.js')).split('\n');
const WPR = extractObject(wpSrc, 'RESOURCES', 'var');                 // the roguelite's own table
/* The fishing stockpile's seeded keys. Read from the seeder itself (`f.resources.<key> =`)
   rather than typed, because `indust` is seeded there and named by NO resource table at
   all — the kind of id a hand-written list is guaranteed to miss. */
const wfStockKeys = [...new Set(lines.join('\n').match(/f\.resources\.([A-Za-z0-9_]+)\s*=/g) || [])]
  .map((m) => m.replace(/^f\.resources\./, '').replace(/\s*=$/, ''));
if (wfStockKeys.length < 4) die('could not read the fishing stockpile seed keys');
/* ROUND 3 — the guard watched four tables and a critic defeated it in one edit: two brand
   new ids (one in RESOURCE_CINDER_VALUE, one in CONSUMABLE_RESOURCES) and `--check` still
   printed "unacct : ok". Every table below carries genuine resource ids and none of them
   was read. All of their ids are accounted for TODAY, so adding them changes no output —
   which is the point: it costs nothing now and fails on the next real drift. They are
   recorded, never rows: being priced or eaten is not being a catalogue entry.
     RESOURCE_CINDER_VALUE  every resource's Cinder price — the widest id list in the game
     _RES_SLOT / _RES_VALUE the field bag's per-unit slot cost and its keep order
     AI_CORP_RESOURCE       which AI corp is famous for which resource
     _FR_RES_TO_WB          ledger id -> warband stockpile key (the VALUES are warband
                            aliases, not resource ids — keys only)
     CRAFT_CARD_RES         the card-industry products the crafting screen counts
     CONSUMABLE_RESOURCES   the ids a player can consume from the camp
     RESOURCE_NEEDS         the four a business panel lists as its running needs */
const CINV = extractLiteral(lines, 'RESOURCE_CINDER_VALUE');
const RSLOT = extractLiteral(lines, '_RES_SLOT');
const RVAL = extractLiteral(lines, '_RES_VALUE');
const AICR = extractLiteral(lines, 'AI_CORP_RESOURCE');
const FRWB = extractLiteral(lines, '_FR_RES_TO_WB');
const CCR = extractLiteral(lines, 'CRAFT_CARD_RES');
const CONS = extractLiteral(lines, 'CONSUMABLE_RESOURCES');
const RNEEDS = extractLiteral(lines, 'RESOURCE_NEEDS');
const otherTables = {
  csRestockKeys:    { symbol: '_CS_RESOURCE_KEYS',  file: 'public/index.html', ids: CSK.rows },
  cinderValue:      { symbol: 'RESOURCE_CINDER_VALUE', file: 'public/index.html', ids: CINV.ids },
  bagSlotCost:      { symbol: '_RES_SLOT',          file: 'public/index.html', ids: RSLOT.ids },
  bagKeepOrder:     { symbol: '_RES_VALUE',         file: 'public/index.html', ids: RVAL.ids },
  aiCorpResource:   { symbol: 'AI_CORP_RESOURCE',   file: 'public/index.html', ids: AICR.ids },
  warbandStockKeys: { symbol: '_FR_RES_TO_WB',      file: 'public/index.html', ids: FRWB.ids },
  craftCardRes:     { symbol: 'CRAFT_CARD_RES',     file: 'public/index.html', ids: CCR.ids },
  consumables:      { symbol: 'CONSUMABLE_RESOURCES', file: 'public/index.html', ids: CONS.ids },
  businessNeeds:    { symbol: 'RESOURCE_NEEDS',     file: 'public/index.html', ids: RNEEDS.ids },
  warpathMaterials: { symbol: 'WARPATH_MATERIALS',  file: 'public/index.html', ids: WPM.rows },
  warpathResources: { symbol: 'RESOURCES',          file: 'public/warpath/warpath-mapgen.js',
    ids: Object.keys(WPR.obj),
    rows: Object.values(WPR.obj).map((r) => ({ id: r.id, name: r.name, icon: r.icon, tier: r.tier })) },
  fishingStockpile: { symbol: 'ensureFishingCorp',  file: 'public/index.html', ids: wfStockKeys },
};
const wpMissing = WPM.rows.filter((id) => !WPR.obj[id]);
if (wpMissing.length) die('WARPATH_MATERIALS names ids the warpath RESOURCES table does not define: ' + wpMissing.join(' '));

/* chain.js is a real ES module with no imports, so import it — but through a data: URL.
   Importing the file path makes Node print MODULE_TYPELESS_PACKAGE_JSON noise on every
   run (package.json has no "type"), which buries the drift report this tool exists for. */
const chainSrc = readLF(CHAIN);
if (/^\s*import\s/m.test(chainSrc)) die('chain.js grew an import; switch this loader to a file import');
const chainMod = await importSource(chainSrc);
const CH   = chainMod.RESOURCE_CHAIN;
const CATS = chainMod.RESOURCE_CATEGORIES || [];
if (!Array.isArray(CH) || CH.length < 10) die('RESOURCE_CHAIN missing from chain.js');
const catColor = Object.fromEntries(CATS.map((c) => [c.key, c.color]));

/* ── merge ─────────────────────────────────────────────────────────────────────────
   Name / icon / colour precedence mirrors what a player actually sees:
     1. RESOURCES  — every camp, market and cost renderer reads this list.
     2. SALVAGE_RES, LAST duplicate wins — index.html builds _SALVAGE_BY_ID with a reduce,
        so for the one duplicated id (diesel) the later row is the one the game shows.
     3. chain.js.
   handLoot = the row sits in the hand-authored loot block at the top of SALVAGE_RES. The
   boundary is DERIVED (first row carrying wt = first promoted chain row), not a literal
   153, so it keeps working when someone appends an exotic. A duplicated id is handLoot if
   ANY of its rows is in that block (diesel: one row is, the later one is not). */
const handEnd = SV.rows.findIndex((r) => 'wt' in r);
if (handEnd < 0) die('no SALVAGE_RES row carries wt; the hand-loot boundary cannot be derived');
/* FATAL, not a warning (round-3 fix). The boundary decides which rows loot.js calls a real
   hand-authored drop; if one hand-written row ever gains a `wt`, every row below it silently
   stops being hand loot and the only symptom was a console line nobody reads on a green run.
   Same exit as the other shape invariants: the fix is to re-derive the boundary, not to
   ignore a warning. */
const straggler = SV.rows.slice(handEnd).filter((r) => !('wt' in r)).map((r) => r.id);
if (straggler.length) {
  die('rows after the first wt row carry no wt (' + straggler.join(' ')
    + '); the hand-loot boundary is no longer "first row with wt" — re-derive it before regenerating.');
}

const ledgerById = new Map(R.rows.map((r) => [r.id, r]));
const lootById = new Map(); const lootDup = []; const handIds = new Set(); const wtById = new Map();
SV.rows.forEach((r, i) => {
  if (lootById.has(r.id) && !lootDup.includes(r.id)) lootDup.push(r.id);
  lootById.set(r.id, r);
  if (i < handEnd) handIds.add(r.id);
  if (typeof r.wt === 'number') wtById.set(r.id, r.wt);
});
const chainById = new Map(CH.map((r) => [r.id, r]));
if (ledgerById.size !== R.rows.length) die('duplicate id inside RESOURCES');
if (chainById.size !== CH.length) die('duplicate id inside RESOURCE_CHAIN');

// Order: ledger order, then loot-only in loot order, then chain-only. Stable by construction.
const order = [...new Set([...R.rows, ...SV.rows, ...CH, ...WF.rows].map((r) => r.id))];
const CATALOG = order.map((id) => {
  const l = ledgerById.get(id), s = lootById.get(id), c = chainById.get(id), y = shipyardById.get(id);
  // Precedence unchanged; shipyard is LAST because if an id ever appears in both the ledger
  // and the drydock, what every camp / market renderer shows is the ledger's row.
  const src = l || s || c || y;
  /* WHY `from` EXISTS (round 3). Name and icon come from ONE table (the first that has the
     id); colour has its own order, because SALVAGE_RES rows carry no colour at all — so for
     7 ids the icon is the loot table's and the colour is chain.js's, and the two tables
     disagree about what the thing is (medicalSupplies: 🥫 from loot, 💊 in chain). Both
     bytes are real source, nothing is invented, and the ledger/loot icon is what the player
     already sees everywhere else — so the precedence stays. What was missing is that a
     consumer could not TELL. `from` names the table behind each field. `altIcon` is the
     OTHER table's icon, and only when it genuinely differs — 133 rows take a chain colour
     under a loot icon, but on all but a handful the two tables draw the same glyph and
     there is nothing to disagree about. mixedSource = !!altIcon, so it flags a real
     conflict a view can mark, not a bookkeeping difference. */
  const nameFrom = l ? 'ledger' : s ? 'loot' : c ? 'chain' : 'shipyard';
  const colorFrom = (l && l.color) ? 'ledger'
    : (c && (c.color || catColor[c.cat])) ? 'chain'
      : (y && y.color) ? 'shipyard' : null;
  const colorSrcRow = colorFrom === 'ledger' ? l : colorFrom === 'chain' ? c : colorFrom === 'shipyard' ? y : null;
  const altIcon = colorFrom && colorFrom !== nameFrom && colorSrcRow && colorSrcRow.icon
    && colorSrcRow.icon !== src.icon ? colorSrcRow.icon : null;
  return {
    id,
    name: src.name,
    icon: src.icon,
    color: (l && l.color) || (c && (c.color || catColor[c.cat])) || (y && y.color) || null,
    from: { name: nameFrom, icon: nameFrom, color: colorFrom },
    altIcon,
    mixedSource: !!altIcon,
    inLedger: !!l,
    inLoot: !!s,
    staple: stapleIds.has(id),
    inChain: !!c,
    handLoot: handIds.has(id),
    // Held in Profile.fishingCorp.resources, not camp storage: it can be a NEED on the map
    // (the drydock spends it) without being something a market roll can hand you.
    inShipyard: !!y,
    chainCat: c ? c.cat : null,
    tier: c && typeof c.tier === 'number' ? c.tier : null,
    wt: wtById.has(id) ? wtById.get(id) : null,
  };
});

const counts = {
  ledger: R.rows.length,
  lootRows: SV.rows.length,
  lootUnique: lootById.size,
  chain: CH.length,
  union: CATALOG.length,
  handLoot: handIds.size,
  shipyard: WF.rows.length,
  ledgerNotLootable: CATALOG.filter((r) => r.inLedger && !r.inLoot).length,
  staples: CATALOG.filter((r) => r.staple).length,
  // Staples that no SALVAGE_RES roll can drop (today: energyDrink). loot.js must not list
  // a whole-table source for these.
  staplesNotInLoot: CATALOG.filter((r) => r.staple && !r.inLoot).length,
  noSourceColor: CATALOG.filter((r) => !r.color).length,
  // Rows whose colour and icon come from DIFFERENT source tables (see `from` above).
  mixedSource: CATALOG.filter((r) => r.mixedSource).length,
};
const orphanStaples = LR.rows.filter((id) => !order.includes(id));
if (orphanStaples.length) die('LOOT_RES_IDS names ids with no catalogue row: ' + orphanStaples.join(' '));
/* Hash the DATA, not the source text. A comment edited inside RESOURCES is not drift and
   must not make every downstream pin go red. */
const hash = crypto.createHash('sha256')
  .update(JSON.stringify([R.rows, SV.rows, CH.map((r) => [r.id, r.name, r.icon, r.color, r.cat, r.tier]), LR.rows,
    WF.rows, wfRecipeIds, otherTables]))
  .digest('hex').slice(0, 16);
/* PIN `hash`. It is the contract's name (CATALOG_META{counts,hash}) and the one the drift
   report prints. `sourceHash` is the same value under the piece brief's name, kept only so
   neither document is wrong; a sibling that pins it is pinning an alias. */
const META = { counts, lootDuplicates: lootDup, hash, sourceHash: hash,
  // Demand with no producer: the four drydock materials, straight off WF_REPAIR_RECIPE.
  // shipping.js reads this to draw the lanes; nothing else is allowed to retype them.
  shipyardDemand: wfRecipeIds,
  /* Named, not just counted, so the audit piece and the modal can print exactly which rows
     wear one table's icon and another table's colour, instead of a reader finding them by eye. */
  mixedSourceRows: CATALOG.filter((r) => r.mixedSource).map((r) => r.id),
  otherTables };

const banner = [
  '/* GENERATED by tools/supplychain/gen-catalog.mjs — DO NOT EDIT BY HAND.',
  '   Source of truth: RESOURCES + SALVAGE_RES (public/index.html) and RESOURCE_CHAIN',
  '   (public/src/resources/chain.js). Re-run the generator when any of them changes; it',
  '   prints a drift report. No timestamp on purpose: a second run must produce this exact',
  '   file, so a diff here always means the catalogue of the game really moved.',
  '   Runtime rows handed over the bridge override this snapshot (catalog.js withLive). */',
  '',
].join('\n');
const body = banner
  /* FROZEN at the source. ~20 sibling modules import these rows; one stray `row.color = x`
     in any of them would silently rewrite the catalogue for every other consumer, and
     nothing would throw. Freezing here (not in catalog.js) means even a module that imports
     the snapshot directly gets the protection. */
  + '/* deepFreeze, because BOTH halves are nested — meta by counts / otherTables and every\n'
  + '   row by `from` — and a shallow freeze would still let one consumer edit\n'
  + '   meta.counts.union or row.from.color for every other importer in the process. */\n'
  + 'const deepFreeze = (o) => { if (o && typeof o === \'object\') Object.values(o).forEach(deepFreeze); return Object.freeze(o); };\n\n'
  + 'export const CATALOG = deepFreeze([\n'
  + CATALOG.map((r) => '  ' + JSON.stringify(r) + ',').join('\n') + '\n]);\n\n'
  + 'export const CATALOG_META = deepFreeze(' + JSON.stringify(META, null, 2) + ');\n';

/* ── drift report: compare with whatever is on disk ─────────────────────────────── */
let prev = null; let prevText = null;
if (fs.existsSync(OUT)) {
  prevText = readLF(OUT);
  try { const m = await importSource(prevText); prev = { rows: m.CATALOG || [], meta: m.CATALOG_META || {} }; }
  catch (e) { console.warn('gen-catalog: previous snapshot unreadable (' + e.message + ') — treating as new'); }
}
const same = prevText === body;

console.log('sources: RESOURCES index.html:' + R.firstLine + '-' + R.lastLine
  + ' · SALVAGE_RES index.html:' + SV.firstLine + '-' + SV.lastLine + ' (hand loot = first ' + handEnd + ' rows)'
  + ' · LOOT_RES_IDS index.html:' + LR.firstLine + '-' + LR.lastLine
  + ' · WF_REPAIR_RESOURCES index.html:' + WF.firstLine + '-' + WF.lastLine + ' · chain.js');
console.log('other  : ' + Object.entries(otherTables).map(([k, t]) => k + '=' + t.ids.length).join('  ')
  + '  (recorded, not rows — every id must be a row, a PHANTOM or a LOCAL_TABLE)');
console.log('counts : ' + Object.entries(counts).map(([k, v]) => k + '=' + v).join('  ')
  + (lootDup.length ? '  lootDuplicates=' + lootDup.join(',') : ''));
console.log('hash   : ' + hash);

if (!prev) console.log('drift  : no previous snapshot — first generation');
else if (same) console.log('drift  : none — snapshot is current');
else {
  const pm = new Map(prev.rows.map((r) => [r.id, r]));
  const nm = new Map(CATALOG.map((r) => [r.id, r]));
  const added = CATALOG.filter((r) => !pm.has(r.id)).map((r) => r.id);
  const removed = prev.rows.filter((r) => !nm.has(r.id)).map((r) => r.id);
  const changed = [];
  for (const r of CATALOG) {
    const p = pm.get(r.id); if (!p) continue;
    const f = Object.keys(r).filter((k) => JSON.stringify(r[k]) !== JSON.stringify(p[k]));
    if (f.length) changed.push(r.id + ' {' + f.map((k) => k + ': ' + JSON.stringify(p[k]) + ' -> ' + JSON.stringify(r[k])).join(', ') + '}');
  }
  console.log('DRIFT  : hash ' + prev.meta.hash + ' -> ' + hash);
  for (const [k, v] of Object.entries(counts)) {
    const o = prev.meta.counts && prev.meta.counts[k];
    if (o !== v) console.log('  count ' + k + ': ' + o + ' -> ' + v);
  }
  console.log('  added   (' + added.length + '): ' + (added.join(' ') || '-'));
  console.log('  removed (' + removed.length + '): ' + (removed.join(' ') || '-'));
  console.log('  changed (' + changed.length + '):' + (changed.length ? '\n    ' + changed.join('\n    ') : ' -'));
  if (!added.length && !removed.length && !changed.length) console.log('  (rows identical — only order, meta or banner moved)');
  /* The boundary can move in TWO directions and only one of them is a shape error. A hand
     row that gains a `wt` leaves rows below it without one — fatal, above. A promoted chain
     row that LOSES its `wt` just slides the boundary down by one, which is well-formed and
     silently changes what loot.js calls a hand-authored drop. There is no way to tell that
     from a legitimate edit, so it is called out loudly here instead of guessed at. */
  if (prev.meta.counts && prev.meta.counts.handLoot !== counts.handLoot) {
    console.log('  NOTE: the hand-loot boundary MOVED (' + prev.meta.counts.handLoot + ' -> ' + counts.handLoot
      + ' rows). Check that this was a real SALVAGE_RES edit — loot.js treats these rows as authored drops.');
  }
  if (added.length) console.log('  NOTE: every added id needs a use in coverage.js and a source in loot.js — run the audit.');
  if (removed.length) console.log('  NOTE: a removed id may still be named by recipes.js / coverage.js — run the audit.');
}

if (CHECK) {
  if (same) await parity();
  if (!same) { console.log('check  : STALE — run: node tools/supplychain/gen-catalog.mjs'); process.exit(1); }
  console.log('check  : ok');
  process.exit(0);
}
if (!same) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body, 'utf8');
  console.log('wrote  : ' + path.relative(ROOT, OUT).replace(/\\/g, '/'));
}
await parity();

/* ── parity self-check ─────────────────────────────────────────────────────────────
   The snapshot is what Node sees; withLive(bridge trio) is what the player sees. Fed the
   SAME source data they must agree on every flag of every id and on every count — round 1
   shipped a withLive() that flipped energyDrink to inLoot and still reported the snapshot's
   counts, and nothing in Node could notice. Runs against the snapshot on disk: after a
   write, and under --check whenever the file is current (a stale file already fails).
   Exit 3 = parity failure, distinct from 1 = stale and 2 = source could not be read. */
async function parity() {
  const { pathToFileURL } = await import('node:url');
  // catalog.js is imported by PATH (it has a relative import, so the data: URL trick used
  // for chain.js cannot work) and package.json has no "type": Node would print a three-line
  // MODULE_TYPELESS_PACKAGE_JSON warning over the drift report. Nothing else in this
  // process can warn after this point, so the default printer is simply dropped.
  process.removeAllListeners('warning');
  const cat = await import(pathToFileURL(path.join(path.dirname(OUT), 'catalog.js')).href + '?t=' + hash);
  const live = cat.withLive({ resources: R.rows, salvageRes: SV.rows, lootResIds: LR.rows });
  /* The completeness record, checked here so it is impossible to regenerate a snapshot that
     the phantom / local-table lists no longer cover. Exit 4 = an id no one has accounted for. */
  const un = cat.unaccounted();
  if (un.length) {
    console.error('unacct : FAIL — ' + un.length + ' id(s) named by a game table but neither a row, a PHANTOM nor a LOCAL_TABLE:');
    un.forEach((x) => console.error('  ' + x.id + '  (' + x.from.join(', ') + ')'));
    process.exit(4);
  }
  console.log('unacct : ok — every id in ' + Object.keys(META.otherTables).length
    + ' other game tables is a row, a declared phantom or a named local table');
  const d = cat.diffCatalogs(cat.catalog(), live);
  if (d.length) {
    console.error('parity : FAIL — snapshot and withLive(same source) disagree on ' + d.length + ' point(s):');
    d.slice(0, 20).forEach((x) => console.error('  ' + x));
    process.exit(3);
  }
  console.log('parity : ok — snapshot == withLive(same source) on every flag of ' + live.rows.length + ' ids and every count');
}
