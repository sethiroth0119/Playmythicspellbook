/* 🚚 SUPPLY CHAIN smoke — no browser, no network, no new dependency.

     node _supplychain_smoke.mjs                 the real tree, every pin
     node _supplychain_smoke.mjs --fast          skip the spawned catalogue generator (§8b)
     node _supplychain_smoke.mjs --wiring        also pin index.html (§10; red until integration lands)
     node _supplychain_smoke.mjs --src DIR --tools DIR --root DIR
                                                 run the pins against a COPY of the tree.
                                                 This is what tools/supplychain/mutants.mjs uses to
                                                 prove each pin can actually go red.
     node _supplychain_smoke.mjs --only 2,4      run a subset (mutants.mjs uses it to stay fast)

   WHAT EACH SECTION PINS, AND WHY IT IS HERE.

     1. THE OWNER'S MAP. A frozen transcription of sc/brief/pdfmap.md §4 — the
        27 tiles, their four legend icons and their needs-edges — checked against
        businesses.js. WHY: the PDF is the one artefact the owner will hold next
        to the screen. Everything downstream (graph, partners, plan, the 3D
        districts) is derived from these rows, so a silent edit here re-draws the
        whole map and nothing else would notice. The transcription lives in THIS
        file, not imported from businesses.js, so the two copies can disagree.

     2. EVERY NEED IS OBTAINABLE. Every resource a business needs is battle
        lootable, or made by another business, or made by a named facility.
        WHY: the owner's goal — "make sure that all of the businesses needs what
        can be found in the loot system in the battle system". A need with no
        source is a dead end the player can never satisfy.

     3. EVERY RESOURCE HAS A USE. Zero uncovered ids over the whole catalogue
        union, and the must-win set (every ledger resource + every hand-authored
        loot id) has a PLAYER-side use, not only a city-sim one. WHY: "Make sure
        (all) of the resources 100+ resources that we have in the game has a
        use." A `sim` role means a city building burns it out of sight; that is
        not an answer a player can act on.

     4. EVERYTHING SHIPS THROUGH TRANSPORT. Every supply lane is pickup → haul
        (at Transport) → depot → deliver, carrierRequired, and claims no more
        than transport/routes.js PHASE. `enforcedToday` is true for exactly the
        two lanes the game really gates today. WHY: the goal says every business
        ships through Transport; the game does not enforce that yet. Drawing it
        is right, CLAIMING it is enforced is a lie, and this pin is the only
        thing standing between the two.

     5. EVERY ID IS REAL. Every resource id used anywhere in the feature exists
        in the generated catalogue, and no declared phantom (gunOil, sulfur,
        gold, organs) is used as a need. WHY: a retyped or invented id renders
        as a blank icon and an empty modal row, and the phantoms are real data
        bugs we must show as gaps rather than quietly launder into content.

     6. THE OWNER'S OWN EXAMPLE. Fashion Brand makes cloth, Medical buys cloth
        from Fashion, and the lane between them is a Transport haul. WHY: it is
        the one route named verbatim in the goal, so it is the first thing that
        will be checked by hand.

     7. HYGIENE. Pure files are window-free and Node-importable; only
        sc.bridge.js reads window.SupplyChainBridge; nobody imports bare 'three';
        no economy literal outside tuning.js; scene.js names no business id; the
        proposal overlay carries only {inputs,yields}. WHY: CLAUDE.md's globals
        trap, the _opEcon() rule, and the contract's "scene.js is generic".

     8. DRIFT. fixture.opsecon.json and catalog.snapshot.js still match
        public/index.html. WHY: both are GENERATED. A stale snapshot makes every
        other pin here green against last week's game.

     9. THE GRAPH. buildGraph() reports zero errors and is deterministic. WHY:
        the graph is what all four views read; a non-deterministic merge makes
        every screenshot comparison in this run meaningless.

    10. WIRING (--wiring). The bridge classic script sits ABOVE the module tag,
        the module tag carries ?v=sc, and the Ruin Exchange tile uses the
        null-when-absent idiom. WHY: the weaponsmith lesson — a module that is
        present but not reachable reports as "not mounted (non-fatal)".

    11. THE RECOMMENDER AND THE PLAN SAY SOMETHING. bestPartners() and
        planFor() are CALLED for every node on the map and their answers are
        read. WHY: two of the owner's five verbatim clauses — "shows what the
        best businesses to work with" and "Then gives them a plan so players
        can know if it is for them" — live entirely in partners.js and plan.js,
        328 KB between them. Round 2's critic gutted bestPartners() to an empty
        array and planFor() to an empty plan, and every pin above stayed green:
        section 7 only TEXT-scans those two files, so a third of the feature
        could be deleted without a red line. A pin that cannot fail is a defect;
        no pin at all is worse.
        Round 3 adds the DISTINCTNESS half. "Not empty" was pinned and "not all
        the same" was not, so round 2's critic made planText() return one fixed
        paragraph: all 33 plans collapsed to identical prose, every check here
        stayed OK and the suite exited 0 with the "is it for me" clause gone.
        The plan text must now be 33 of 33 distinct, and fitFor / notFor /
        needToStart carry measured floors on both the sentence and the verdict.

   WHAT THIS FILE DELIBERATELY DOES NOT PIN. The view modules — scene.js,
   scene.nodes.js, hover.js, modal.js, fallback.js, render.js — are covered here
   only by section 7's static hygiene. The owner's "hovering shows a modal /
   clicking shows a modal" clause is a claim about pixels and cannot be settled
   without a browser, which this file refuses to be; tools/supplychain's
   harness-*.html pages plus shoot.mjs own that half. The word "smoke" in the
   name should not be read as whole-feature coverage.

   Rules this file obeys: it writes nothing, spawns nothing but its own
   generators, and contains no economy number.                                */

import { readFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve, join } from 'path';
import { spawn } from 'child_process';

/* Node prints MODULE_TYPELESS_PACKAGE_JSON when it ES-imports a .js under a
   package.json with no "type" field. public/ is served as plain files by
   Cloudflare Assets and the repo's package.json is not ours to change, so the
   warning is correct and irrelevant — but it lands mid-pin and is the one place
   this suite's output looks like something went wrong when nothing did. The
   default 'warning' listener is removed and re-implemented so that EVERY OTHER
   warning still prints: silencing the channel wholesale would hide a real one. */
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w && w.name !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(w.stack || String(w)); });

/* ── arguments ─────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ROOT = resolve(val('--root', process.cwd()));
const SRC = resolve(val('--src', join(ROOT, 'public/src/supplychain')));
const TOOLS = resolve(val('--tools', join(ROOT, 'tools/supplychain')));
const FAST = flag('--fast');
const WIRING = flag('--wiring');
const ONLY = val('--only', '') ? new Set(val('--only', '').split(',').map((s) => s.trim())) : null;

/* ── counters ──────────────────────────────────────────────────────────────── */
let fails = 0, section = '0', skipped = 0;
const sectionFails = Object.create(null);
const ran = new Set();
const ok = (name, cond, detail) => {
  if (!cond) { fails++; sectionFails[section] = (sectionFails[section] || 0) + 1; }
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null || detail === '' ? '' : '   ' + detail));
};
/* Failures must print the offending ids, never just a count: a bare "3 bad" sends
   the next reader back to re-derive the list this file already had in hand. */
const few = (arr, n) => { const a = Array.from(arr); return a.length ? a.slice(0, n).join(', ') + (a.length > n ? ` … (+${a.length - n} more)` : '') : ''; };
const S = (n, title) => {
  section = String(n);
  const skip = ONLY && !ONLY.has(section);
  if (skip) { skipped++; return false; }
  ran.add(section);
  console.log('\n  ── ' + n + '. ' + title);
  return true;
};

const imp = (f) => import(pathToFileURL(join(SRC, f)).href);
const readIf = (p) => { try { return readFileSync(p, 'utf8'); } catch (e) { return null; } };
/* Any git checkout on this box rewrites .html/.js as CRLF (memory: "Git CRLF
   trap"), so every text comparison here normalises first or it goes red for
   nothing. */
const lf = (s) => (s == null ? s : String(s).replace(/\r\n/g, '\n'));

/* Kick the catalogue generator off NOW and collect it in §8: it re-parses
   index.html in a child process and is by far the slowest thing here, and it
   does not depend on anything below. (Timed on this box over several clean runs, no pipe: the whole
   suite lands between 0.7 s and 1.9 s, the spread being this spawn. An
   earlier header quoted 0.47 s as the whole run, which was the --fast figure
   — quote a range you have actually measured or quote nothing.) */
const genCatalog = FAST || (ONLY && !ONLY.has('8')) ? null : new Promise((res) => {
  /* The GENERATORS always come from the repo — they are bound to public/index.html
     by their own location. --tools only swaps the GENERATED files beside them, which
     is exactly what a drift mutant needs to change. */
  const p = spawn(process.execPath, [join(ROOT, 'tools/supplychain/gen-catalog.mjs'), '--check'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => res({ code, out })); p.on('error', (e) => res({ code: -1, out: String(e.message) }));
});

/* ── §7 PREFLIGHT — the text scan runs BEFORE anything is imported ──────────
   Round 2's critic: an UNGUARDED window.x in a pure file used to crash this
   file on the import below with a raw ReferenceError, before the first pin had
   run — no PINS: line, no section number, nothing pointing at §7, which is the
   pin that exists to catch exactly that. Only the guarded
   typeof-window-not-undefined form survived long enough to be REPORTED.
   The scan is pure text, so it can run first; §7 below only prints it. The
   import is then guarded, and a pure module that will not load in Node is
   itself a §7 finding rather than a stack trace. */
const PURE = ['businesses.js', 'catalog.js', 'catalog.snapshot.js', 'coverage.js', 'data.js', 'flux.snapshot.js', 'graph.js', 'loot.js', 'partners.js', 'plan.js', 'proposal.js', 'recipes.js', 'shipping.js', 'tuning.js'];
const DOMFILES = ['sc.bridge.js', 'scene.js', 'scene.nodes.js', 'hover.js', 'modal.js', 'fallback.js', 'render.js', 'index.js', 'sc.css.js'];
/* Comments and strings are allowed to SAY "window" — stripping block and line
   comments first is what keeps this pin about code. Never quote a comment marker
   inside a comment here (CLAUDE.md). */
const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SRCTEXT = new Map();
for (const f of PURE.concat(DOMFILES)) { const t = readIf(join(SRC, f)); if (t != null) SRCTEXT.set(f, lf(t)); }
/* An economy number written down anywhere but tuning.js is the _opEcon() rule
   being broken. The leading look-behind keeps a READ of a live field
   (live.maxWorkers) out of it — the rule is about literals, not about reading
   the game. */
const ECON_LIT = /(?<![.\w'"])(startup|azaStartup|ratePerWorkerHr|salaryPerWorkerHr|maxWorkers|wage|wages|salary|price|payback|cinderPerHr|gems)\w*\s*[:=]\s*-?\d/i;
const HYG = (() => {
  const econ = [];
  for (const [f, t] of SRCTEXT) {
    if (f === 'tuning.js') continue;
    strip(t).split('\n').forEach((line, i) => { if (ECON_LIT.test(line)) econ.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 70)); });
  }
  return {
    missing: PURE.filter((f) => !SRCTEXT.has(f)),
    touchesWindow: PURE.filter((f) => /(^|[^\w.$])window\s*[.[]/.test(strip(SRCTEXT.get(f) || ''))),
    readsBridge: [...SRCTEXT].filter(([, t]) => /SupplyChainBridge/.test(strip(t))).map(([f]) => f),
    bareThree: [...SRCTEXT].filter(([, t]) => /from\s*['"]three['"]/.test(t) || /import\s*\(\s*['"]three['"]/.test(t)).map(([f]) => f),
    econ,
  };
})();

let getData, assemble, SC, data, catalog, businesses, recipes, coverage, shipping, loot, graph;
try {
  ({ getData, assemble } = await imp('data.js'));
  ({ SC } = await imp('tuning.js'));
  data = getData();
  ({ catalog, businesses, recipes, coverage, shipping, loot, graph } = data);
} catch (err) {
  /* Attributed, not thrown: the reader gets a section number and the offending
     file list, the same as any other red line here. */
  S(7, 'hygiene — the pure modules do not even LOAD in Node');
  ok('data.js / tuning.js import cleanly in Node (no DOM, no bare window)', false, String((err && err.message) || err));
  ok('no pure file touches window (CLAUDE.md: a module cannot see the legacy consts)', HYG.touchesWindow.length === 0, HYG.touchesWindow.join(', '));
  ok('every pure file is present', HYG.missing.length === 0, HYG.missing.join(', '));
  console.log('\n  PINS: 7=fail (the import itself)');
  console.log('\n  \u274c supply chain: the pure data modules could not be imported — every other pin is unknown\n');
  console.log((err && err.stack) || '');
  process.exit(1);
}

/* ════════════════════════════════════════════════════════════════════════════
   1. THE OWNER'S MAP — frozen transcription of sc/brief/pdfmap.md §4.
   T = Transport truck · M = Marketplace · C = Car Marketplace tow truck ·
   K = the battler card. '?' = drawn but its owner is AMBIGUOUS (pdfmap §6-A:
   the p8 card at (405,710) reads as either Genetics Lab or Car Factory), which
   the data must carry as a doubt rather than silently pick a side.
   ════════════════════════════════════════════════════════════════════════════ */
const PDF = {
  transport:    { p: 6, i: '----', needs: ['gas', 'cars'] },
  mining:       { p: 6, i: 'TM--', needs: [] },
  oil:          { p: 6, i: 'TMC-', needs: ['mining'] },
  gas:          { p: 6, i: 'TMC-', needs: ['oil'] },
  cars:         { p: 6, i: '-MC-', needs: ['gas'] },
  construction: { p: 6, i: 'T---', needs: ['trashcrusher', 'mining'] },
  trashcrusher: { p: 6, i: 'TM--', needs: ['mining'] },
  weaponsmith:  { p: 6, i: '-M-K', needs: ['mining', 'trashcrusher'] },
  restaurant:   { p: 7, i: 'TM--', needs: ['fishing', 'agri', 'feed'] },
  agri:         { p: 7, i: 'TMC-', needs: ['oil'] },
  feed:         { p: 7, i: 'TMC-', needs: ['agri'] },
  dojo:         { p: 7, i: '---K', needs: [] },
  cardshop:     { p: 7, i: '-M-K', needs: [] },
  fishing:      { p: 7, i: 'TM--', needs: ['gas'] },
  cannery:      { p: 7, i: 'TM--', needs: ['trashcrusher', 'fishing'] },
  bank:         { p: 7, i: '----', needs: [] },
  genelab:      { p: 8, i: 'T--?', needs: ['research', 'agri', 'feed', 'mining'] },
  medical:      { p: 8, i: 'TM--', needs: ['research', 'fashion'] },
  fashion:      { p: 8, i: 'TM--', needs: [] },
  research:     { p: 8, i: 'TM-K', needs: ['genelab', 'medical'] },
  carfactory:   { p: 8, i: '-M-?', needs: ['gas', 'oil', 'trashcrusher', 'mining', 'cars'] },
  smuggling:    { p: 8, i: 'TM--', needs: ['research', 'fishing', 'gas', 'agri'] },
  salvage:      { p: 8, i: 'TM--', needs: ['cars', 'trashcrusher', 'research'] },
  warehouse:    { p: 8, i: '----', needs: [] },
  bus:          { p: 9, i: '----', needs: [] },
  rail:         { p: 9, i: '----', needs: [] },
  airport:      { p: 9, i: '----', needs: [] },
};
/* Tallies quoted from pdfmap.md §5, kept as a second, independent statement of
   the same table: a transcription slip that changes one tile would have to slip
   the tally by the same amount to stay green. */
const PDF_TALLY = { tiles: 27, truck: 16, carMarket: 5, planned: ['fashion', 'airport'], cityTransit: ['bus', 'rail', 'airport'], services: ['bank', 'warehouse'] };

if (S(1, "the owner's map (pdfmap.md §4) vs businesses.js")) {
  const rows = businesses.BUSINESSES;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const expected = Object.keys(PDF);
  ok('27 tiles, exactly the ids of the PDF transcription', rows.length === PDF_TALLY.tiles && expected.every((id) => byId.has(id)) && rows.every((r) => PDF[r.id]),
    [...expected.filter((id) => !byId.has(id)).map((id) => 'missing ' + id), ...rows.filter((r) => !PDF[r.id]).map((r) => 'unexpected ' + r.id)].join(', '));

  const iconBad = [], pageBad = [], needBad = [], doubtBad = [];
  for (const id of expected) {
    const r = byId.get(id); if (!r) continue;
    const e = PDF[id], ic = r.icons || {};
    const got = (ic.transport ? 'T' : '-') + (ic.market ? 'M' : '-') + (ic.carMarket ? 'C' : '-') + (ic.card ? 'K' : '-');
    const want = e.i.replace('?', 'K');
    if (got !== want) iconBad.push(`${id} drawn ${e.i} got ${got}`);
    /* An '?' tile must ALSO record the doubt; carrying it as a plain yes is how
       an ambiguity the owner was promised would be surfaced gets swallowed. */
    const doubts = (r.iconDoubt || []).map((d) => (typeof d === 'string' ? d : d && d.icon));
    if (e.i.includes('?') && !doubts.includes('card')) doubtBad.push(id + ' (p8 card ambiguity not recorded)');
    if (!e.i.includes('?') && doubts.includes('card')) doubtBad.push(id + ' (card marked doubtful but the PDF is clear)');
    if (r.page !== e.p) pageBad.push(`${id} p${r.page} want p${e.p}`);
    const gotNeeds = (r.needs || []).map((n) => n.biz);
    if (gotNeeds.join('|') !== e.needs.join('|')) needBad.push(`${id} [${gotNeeds.join(',')}] want [${e.needs.join(',')}]`);
  }
  ok('every tile carries exactly its drawn legend icons', iconBad.length === 0, few(iconBad, 6));
  ok('the two ambiguous p8 cards are carried as a doubt, not a decision', doubtBad.length === 0, few(doubtBad, 4));
  ok('every tile is on the page it was drawn on', pageBad.length === 0, few(pageBad, 6));
  ok('every needs-edge matches the icon column beside the tile, in drawn order', needBad.length === 0, few(needBad, 6));

  const trucks = rows.filter((r) => r.icons && r.icons.transport).map((r) => r.id);
  const cms = rows.filter((r) => r.icons && r.icons.carMarket).map((r) => r.id);
  ok(`${PDF_TALLY.truck} tiles have a truck drawn (pdfmap §5 tally)`, trucks.length === PDF_TALLY.truck, trucks.length + ': ' + few(trucks, 20));
  ok(`${PDF_TALLY.carMarket} tiles have the tow truck`, cms.length === PDF_TALLY.carMarket, cms.join(', '));
  ok('Fashion Brand and Airport are the only PLANNED tiles (neither is an op today)',
    JSON.stringify(rows.filter((r) => r.status === 'planned').map((r) => r.id).sort()) === JSON.stringify([...PDF_TALLY.planned].sort()),
    rows.filter((r) => r.status === 'planned').map((r) => r.id).join(', '));
  ok('Bus, Rail Road and Airport are city-only, not Just Business tiles (p9 rule)',
    PDF_TALLY.cityTransit.every((id) => byId.get(id) && byId.get(id).kind === 'cityTransit'),
    PDF_TALLY.cityTransit.filter((id) => !byId.get(id) || byId.get(id).kind !== 'cityTransit').join(', '));
  ok('Bank and Warehouse are services with a caption and no icons',
    PDF_TALLY.services.every((id) => { const r = byId.get(id); return r && r.kind === 'service' && r.caption && !Object.values(r.icons || {}).some(Boolean); }),
    PDF_TALLY.services.filter((id) => { const r = byId.get(id); return !(r && r.kind === 'service' && r.caption); }).join(', '));
  ok('every ambiguity of pdfmap §6 is carried as data, none resolved silently', Array.isArray(businesses.AMBIGUITIES) && businesses.AMBIGUITIES.length >= 10, String((businesses.AMBIGUITIES || []).length) + ' rows');
  ok("businesses.validate() finds nothing wrong with its own table", (businesses.validate() || []).length === 0, few((businesses.validate() || []).map((e) => e.id || e.code || JSON.stringify(e)), 5));
}

/* ════════════════════════════════════════════════════════════════════════════
   2. EVERY NEED IS OBTAINABLE.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(2, 'every business need is battle loot, or made by somebody')) {
  const bizIds = businesses.BUSINESSES.map((b) => b.id);
  const madeAtFacility = new Set(Object.keys(loot.MADE_NOT_LOOTED || {}));
  const dead = [], noLootAtAll = [];
  for (const b of bizIds) {
    const needs = coverage.needsOf(b) || [];
    let lootable = 0;
    for (const n of needs) {
      const isLoot = loot.isLootable(n.id, catalog);
      if (isLoot) lootable++;
      const others = (recipes.producersOf(n.id) || []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter((x) => x && x !== b);
      if (!isLoot && !others.length && !madeAtFacility.has(n.id)) dead.push(b + '/' + n.id);
    }
    /* The goal's actual sentence is about LOOT, so a business whose every input
       comes from another business still owes the battle system at least one. */
    if (needs.length && !lootable) noLootAtAll.push(b);
  }
  ok('no business needs a resource nothing produces and nothing drops', dead.length === 0, few(dead, 10));
  ok('every business that consumes anything consumes at least one battle-lootable id', noLootAtAll.length === 0, few(noLootAtAll, 10));
  const facilityCited = Object.entries(loot.MADE_NOT_LOOTED || {}).filter(([, v]) => !(v && v.cite)).map(([k]) => k);
  ok('every "made, never dropped" id names the facility that makes it, with a cite', facilityCited.length === 0, few(facilityCited, 6));
  const consumers = bizIds.filter((b) => (coverage.needsOf(b) || []).length);
  ok('most tiles consume something (a map of pure sources explains nothing)', consumers.length >= 20, consumers.length + ' of ' + bizIds.length);
}

/* ════════════════════════════════════════════════════════════════════════════
   3. EVERY RESOURCE HAS A USE.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(3, 'a use for every resource id in the game')) {
  const rows = catalog.all();
  const unc = coverage.uncovered(catalog) || [];
  ok(`zero uncovered ids over the whole union (${rows.length} ids)`, unc.length === 0, few(unc.map((u) => u.id || u), 12));
  ok('the union is the whole catalogue, not a subset (ledger + loot + chain)', rows.length >= 420 && catalog.CATALOG_META.counts.ledger >= 161 && catalog.CATALOG_META.counts.handLoot >= 153,
    JSON.stringify(catalog.CATALOG_META.counts));
  /* The must-win set: what a player can actually hold. A `sim` use means a city
     building consumes it invisibly — true, but not an answer to "what is this
     for?", so it does not count here. */
  const must = rows.filter((r) => r.inLedger || r.handLoot).map((r) => r.id);
  const simOnly = must.filter((id) => !((coverage.USES[id] || []).some((u) => u.role !== 'sim')));
  ok(`every one of the ${must.length} ids a player can hold has a use that is not just the city sim`, simOnly.length === 0, few(simOnly, 12));
  const noWhy = [];
  for (const id of Object.keys(coverage.USES)) for (const u of coverage.USES[id]) if (!u.why || !u.by) noWhy.push(id);
  ok('every use names the business or system that consumes it, in plain words', noWhy.length === 0, few([...new Set(noWhy)], 8));
  const badRole = [];
  for (const id of Object.keys(coverage.USES)) for (const u of coverage.USES[id]) if (!coverage.ROLES.includes(u.role)) badRole.push(id + '/' + u.role);
  ok('every use has one of the declared roles', badRole.length === 0, few(badRole, 8));
  /* live must be claimable, not assumed: an unsourced `live:true` is exactly the
     lie section 4 exists to prevent, one layer down. */
  const liveNoCite = [];
  for (const id of Object.keys(coverage.USES)) for (const u of coverage.USES[id]) if (u.live && !u.cite) liveNoCite.push(id);
  ok('every use claimed LIVE carries a cite', liveNoCite.length === 0, few([...new Set(liveNoCite)], 8));
  /* PRESENCE is not enough. Round 2's critic: a fabricated cite like
     src/nowhere/fake.js:999 passed the check above, whose own name promises "a
     cite a reader can re-grep". So resolve it: the file must exist under
     public/ and the line number must be inside it. Line counts are cached, so
     the whole sweep costs a handful of reads. */
  const lineCount = new Map();
  const linesIn = (rel) => {
    if (lineCount.has(rel)) return lineCount.get(rel);
    const t = readIf(join(ROOT, 'public', rel));
    const n = t == null ? -1 : lf(t).split('\n').length;
    lineCount.set(rel, n);
    return n;
  };
  const badCite = [];
  for (const id of Object.keys(coverage.USES)) for (const u of coverage.USES[id]) {
    if (!u.live || !u.cite) continue;
    /* A cite is one or more targets joined by " ; ". A target is "path:line" or
       "path:from-to", and may carry a trailing parenthetical — either " (+N)"
       ("N more of the same, not listed") or a note such as
       "(generated chain_* row)". The note is prose for the reader; what this
       pin checks is the path and the line. */
    for (const raw of String(u.cite).split(' ; ')) {
      const part = raw.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!part) continue;
      const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) { badCite.push(id + ' -> ' + part + ' (not path:line)'); continue; }
      const n = linesIn(m[1]);
      if (n < 0) { badCite.push(id + ' -> ' + part + ' (no such file under public/)'); continue; }
      const from = +m[2], to = m[3] ? +m[3] : from;
      if (from < 1 || to < from || to > n) badCite.push(id + ' -> ' + part + ' (file has ' + n + ' lines)');
    }
  }
  ok('…and every cite resolves: the file exists and the line is inside it', badCite.length === 0, few([...new Set(badCite)], 8));
}

/* ════════════════════════════════════════════════════════════════════════════
   4. EVERYTHING SHIPS THROUGH TRANSPORT.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(4, 'every business-to-business lane goes through Transport')) {
  const { PHASE } = await import(pathToFileURL(resolve(SRC, '../transport/routes.js')).href);
  const supply = graph.edges.filter((e) => e.kind === 'supply');
  const lanes = new Map((graph.lanes || []).map((l) => [l.edge, l]));
  const noVia = supply.filter((e) => e.via !== 'transport').map((e) => e.id);
  const noCargo = supply.filter((e) => !(e.cargo || []).length).map((e) => e.id);
  ok(`all ${supply.length} supply edges are routed via Transport`, noVia.length === 0, few(noVia, 8));
  ok('every supply edge names at least one real cargo id', noCargo.length === 0, few(noCargo, 8));
  const badLegs = [], noCarrier = [], overclaim = [], enforced = [];
  for (const e of supply) {
    const l = lanes.get(e.id);
    if (!l) { badLegs.push(e.id + ' (no lane)'); continue; }
    const kinds = (l.legs || []).map((x) => x.kind).join('>');
    if (kinds !== 'pickup>haul>depot>deliver') badLegs.push(e.id + ' = ' + kinds);
    else if (l.legs[1].node !== 'transport') badLegs.push(e.id + ' hauled at ' + l.legs[1].node);
    if (!l.carrierRequired) noCarrier.push(e.id);
    if (!(l.phase <= PHASE)) overclaim.push(e.id + ' phase ' + l.phase);
    if (l.enforcedToday) enforced.push(e.id);
  }
  ok('every lane is pickup → haul at Transport → depot → deliver, 0 direct lanes', badLegs.length === 0, few(badLegs, 8));
  ok('every lane says a carrier is required (the written goal)', noCarrier.length === 0, few(noCarrier, 8));
  ok(`no lane claims a phase above transport/routes.js PHASE (${PHASE})`, overclaim.length === 0, few(overclaim, 8));
  ok('NO mapped lane claims the game enforces it today — that is the honest half', enforced.length === 0, few(enforced, 8));
  const live = shipping.LIVE_LANES || [];
  ok('exactly two lanes ARE enforced today, and they are the pharma ones', live.length === 2 && live.every((l) => shipping.route({ from: l.from, to: l.to, resId: l.resId, cargoKind: l.cargoKind, lane: l.id }).enforcedToday),
    live.map((l) => l.id).join(', '));
  ok('the five tiles the PDF drew no truck beside are still routed, and flagged',
    JSON.stringify([...(shipping.PDF_TRUCK_NOT_DRAWN || [])].sort()) === JSON.stringify(['cardshop', 'cars', 'carfactory', 'dojo', 'weaponsmith'].sort()),
    (shipping.PDF_TRUCK_NOT_DRAWN || []).join(', '));
  ok('shipping.audit() finds nothing wrong with its own lanes', (shipping.audit(data) || []).length === 0, few((shipping.audit(data) || []).map((x) => x.id || JSON.stringify(x)), 5));
  ok('effectivePhase() mirrors routes.js and never exceeds it', shipping.effectivePhase() <= PHASE, String(shipping.effectivePhase()));
}

/* ════════════════════════════════════════════════════════════════════════════
   5. EVERY ID IS REAL; PHANTOMS UNUSED.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(5, 'every resource id in the feature is a real catalogue id')) {
  const used = new Map(); /* id -> where it was first seen, so a failure names the file */
  const add = (id, where) => { if (typeof id === 'string' && id && !used.has(id)) used.set(id, where); };
  for (const id of Object.keys(coverage.USES)) add(id, 'coverage.USES');
  for (const e of graph.edges) for (const id of e.cargo || []) add(id, 'graph edge ' + e.id);
  for (const b of Object.keys(recipes.RECIPES)) {
    const r = recipes.RECIPES[b];
    for (const m of r.makes || []) add(m.id, 'recipes.' + b + '.makes');
    for (const buy of r.buys || []) for (const id of buy.ids || []) add(id, 'recipes.' + b + '.buys');
  }
  for (const s of loot.LOOT_SOURCES || []) for (const id of s.drops || []) add(id, 'loot.' + s.id);
  const unreal = [...used].filter(([id]) => !catalog.has(id)).map(([id, w]) => id + ' (' + w + ')');
  ok(`all ${used.size} ids used anywhere in the feature exist in the catalogue`, unreal.length === 0, few(unreal, 10));
  const phantoms = coverage.PHANTOMS || [];
  const laundered = phantoms.filter((p) => used.has(p)).map((p) => p + ' (' + used.get(p) + ')');
  ok('no declared phantom is used as a need or a cargo', laundered.length === 0, few(laundered, 6));
  ok('the four known phantoms are all still declared', ['gunOil', 'sulfur', 'gold', 'organs'].every((p) => phantoms.includes(p)), phantoms.join(', '));
  ok('gunOil is explained as a known data gap, with both halves cited', !!(recipes.PHANTOMS && recipes.PHANTOMS.gunOil && recipes.PHANTOMS.gunOil.cite), recipes.PHANTOMS && recipes.PHANTOMS.gunOil ? '' : 'missing');
}

/* ════════════════════════════════════════════════════════════════════════════
   6. THE OWNER'S OWN EXAMPLE.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(6, "the owner's example: fashion makes cloth → Transport → medical")) {
  const makes = (recipes.makesOf('fashion') || []).map((m) => (typeof m === 'string' ? m : m && m.id));
  ok('Fashion Brand makes cloth', makes.includes('cloth'), makes.join(', '));
  const buy = (recipes.RECIPES.medical.buys || []).find((b) => b.from === 'fashion');
  ok('Medical Corporation buys from Fashion Brand', !!buy, buy ? '' : (recipes.RECIPES.medical.buys || []).map((b) => b.from).join(', '));
  ok('…and cloth is on that shipment', !!buy && (buy.ids || []).includes('cloth'), buy ? (buy.ids || []).join(', ') : '');
  const r = shipping.route({ from: 'fashion', to: 'medical', resId: 'cloth' });
  ok('the cloth lane is a Transport haul, not a direct hand-off',
    r.carrierRequired && (r.legs || []).map((l) => l.kind).join('>') === 'pickup>haul>depot>deliver' && r.legs[1].node === 'transport',
    (r.legs || []).map((l) => l.kind + '@' + (l.node || '')).join(' > '));
  ok('…and it is honestly tagged as NOT enforced today (Fashion Brand is planned)', r.enforcedToday === false, String(r.enforcedToday));
  const e = graph.edges.find((x) => x.kind === 'supply' && x.from === 'fashion' && x.to === 'medical');
  ok('the merged graph carries the same edge with cloth aboard', !!e && (e.cargo || []).includes('cloth'), e ? (e.cargo || []).join(', ') : 'no edge');
  ok('graph.resourceFlow("cloth") returns a path, so the map can light it up', (graph.resourceFlow ? (graph.resourceFlow('cloth') || {}) : {}) && Object.keys(graph.resourceFlow('cloth') || {}).length > 0);
}

/* ════════════════════════════════════════════════════════════════════════════
   7. HYGIENE.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(7, 'hygiene: the bridge seam, three.js, economy literals, generic scene')) {
  /* Every check below was computed in the PREFLIGHT above, before any import,
     so an unguarded window in a pure file is REPORTED here rather than
     crashing the run before pin 1. */
  const src = SRCTEXT;
  ok('every pure file is present and Node-importable', HYG.missing.length === 0, HYG.missing.join(', '));
  ok('no pure file touches window (CLAUDE.md: a module cannot see the legacy consts)', HYG.touchesWindow.length === 0, HYG.touchesWindow.join(', '));
  ok('only sc.bridge.js reads window.SupplyChainBridge', JSON.stringify(HYG.readsBridge) === JSON.stringify(['sc.bridge.js']), HYG.readsBridge.join(', '));
  ok("nobody imports bare 'three' — r128 comes through ../weaponsmith/three.boot.js", HYG.bareThree.length === 0, HYG.bareThree.join(', '));
  const sceneSrc = src.get('scene.js');
  ok('scene.js boots three through the shared loader', sceneSrc == null || /three\.boot\.js/.test(sceneSrc));

  ok('no economy number is written down outside tuning.js', HYG.econ.length === 0, few(HYG.econ, 5));

  /* scene.js draws SHAPES; which shape belongs to which tile lives in
     scene.nodes.js. A business id inside scene.js means the 3D view has grown a
     special case that the data can no longer move. */
  const bizIds = businesses.BUSINESSES.map((b) => b.id);
  const named = sceneSrc == null ? [] : bizIds.filter((id) => new RegExp("['\"]" + id + "['\"]").test(strip(sceneSrc)));
  ok('scene.js names no business id (the tile registry is scene.nodes.js)', named.length === 0, named.join(', '));

  const proposal = await imp('proposal.js');
  const fx = JSON.parse(lf(readFileSync(join(TOOLS, 'fixture.opsecon.json'), 'utf8')));
  const overlay = proposal.buildOpsEconOverlay(data, SC, fx.opsEcon);
  const rowKeys = new Set(); for (const k of Object.keys(overlay)) for (const kk of Object.keys(overlay[k])) rowKeys.add(kk);
  ok('the overlay carries ONLY {inputs, yields} — never a startup, wage or rate', [...rowKeys].every((k) => proposal.OVERLAY_KEYS.includes(k)), [...rowKeys].join(', '));
  const badOp = Object.keys(overlay).filter((id) => !fx.opsEcon[id]);
  ok('every overlay row is keyed by a real live op id', badOp.length === 0, few(badOp, 6));
  ok('the overlay is switched OFF by default', SC.proposal.enabledByDefault === false, String(SC.proposal.enabledByDefault));
  const newOps = proposal.newOpRows(data, SC);
  const priced = Object.keys(newOps).filter((id) => proposal.OWNER_PRICED_FIELDS.some((f) => newOps[id].row[f] != null));
  ok("the new-op rows leave every owner-priced field null — we invent no price", priced.length === 0, priced.join(', '));
}

/* ════════════════════════════════════════════════════════════════════════════
   8. DRIFT.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(8, 'generated files still match public/index.html')) {
  const gf = await import(pathToFileURL(join(ROOT, 'tools/supplychain/gen-fixture.mjs')).href);
  const fresh = gf.build();
  const onDisk = JSON.parse(lf(readFileSync(join(TOOLS, 'fixture.opsecon.json'), 'utf8')));
  const d8 = gf.drift(onDisk, fresh) || [];
  ok('fixture.opsecon.json is what index.html would generate today', d8.length === 0, few(d8.map((x) => (x && (x.path || x.key || x.what)) || JSON.stringify(x)), 6));
  ok('the fixture covers every live op (nothing silently dropped)', Object.keys(onDisk.opsEcon || {}).length === fresh.counts.ops, Object.keys(onDisk.opsEcon || {}).length + ' vs ' + fresh.counts.ops);

  /* The modules under test must BE the shipped snapshot, not a copy that has
     drifted from it. Compared against the repo file, so pointing --src at a
     mutated tree turns this red even though index.html never moved. */
  const shipped = lf(readIf(join(ROOT, 'public/src/supplychain/catalog.snapshot.js')) || '');
  const hash = (shipped.match(/"hash":\s*"([0-9a-f]+)"/) || [])[1];
  /* The snapshot is one JSON object per line, so the shipped rows can be parsed
     back and compared field for field. The HASH alone is not enough: a hand edit
     to a name or an icon leaves the recorded hash untouched and would sail
     through — which is exactly the edit someone makes when a name looks wrong. */
  const shippedRows = (shipped.match(/^\s*(\{"id":.*?\}),?$/gm) || []).map((l) => JSON.parse(l.trim().replace(/,$/, '')));
  ok('the catalogue the graph was built from is the shipped snapshot (hash)', !!hash && catalog.CATALOG_META.hash === hash, catalog.CATALOG_META.hash + ' vs ' + hash);
  ok('…and has the same number of rows', shippedRows.length > 0 && catalog.all().length === shippedRows.length, catalog.all().length + ' vs ' + shippedRows.length);
  const rowDiff = [];
  { const byId = new Map(shippedRows.map((r) => [r.id, r]));
    /* Only the snapshot's OWN, STATED fields are compared. catalog.js adds fields
       of its own (colorFrom) and fills in the ones the generator left null (a
       loot-only row has no colour until the family palette gives it one); both
       are the catalogue's business, not the generator's. Everything the snapshot
       actually asserts still has to match. */
    for (const r of catalog.all()) {
      const s = byId.get(r.id);
      if (!s) { rowDiff.push(r.id + ' (not in the shipped snapshot)'); continue; }
      const off = Object.keys(s).filter((k) => s[k] !== null && JSON.stringify(s[k]) !== JSON.stringify(r[k]));
      if (off.length) rowDiff.push(r.id + '.' + off.join('/'));
    } }
  ok('…and every row is field-for-field the shipped row (a hand edit shows up here)', rowDiff.length === 0, few(rowDiff, 8));
  ok('the snapshot records the source hash it was generated from', catalog.CATALOG_META.sourceHash === catalog.CATALOG_META.hash, catalog.CATALOG_META.sourceHash);

  if (genCatalog) {
    const g = await genCatalog;
    ok('gen-catalog --check: the snapshot is current against index.html', g.code === 0, g.code === 0 ? '' : lf(g.out).split('\n').filter((l) => /drift|STALE|unacct|parity|check/.test(l)).join(' | ').slice(0, 300));
  } else { console.log('  SKIP  gen-catalog --check (--fast)'); }
}

/* ════════════════════════════════════════════════════════════════════════════
   9. THE GRAPH.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(9, 'the merged graph is clean and deterministic')) {
  ok('buildGraph() reports zero errors', (graph.report.errors || []).length === 0,
    few((graph.report.errors || []).map((e) => (e && (e.code ? e.code + ': ' + (e.id || e.what || '') : JSON.stringify(e)))), 6));
  ok('the graph has all 33 nodes (27 tiles + 4 systems + 2 channels)', graph.nodes.length === 33, String(graph.nodes.length));
  const orphan = graph.nodes.filter((n) => !graph.edges.some((e) => e.from === n.id || e.to === n.id)).map((n) => n.id);
  ok('no node is stranded with no edge at all', orphan.length === 0, few(orphan, 6));
  const kinds = new Set(graph.edges.map((e) => e.kind));
  ok('all five edge kinds are present (system, supply, loot, channel, service)',
    ['system', 'supply', 'loot', 'channel', 'service'].every((k) => kinds.has(k)), [...kinds].join(', '));
  /* Re-merging must produce byte-identical JSON. A Set or Map iterated into the
     output would pass by luck on one run and re-order screenshots on the next. */
  const a = JSON.stringify(assemble({ pin: false }).graph), b = JSON.stringify(assemble({ pin: false }).graph);
  ok('two merges of the same input produce byte-identical output', a === b, a === b ? a.length + ' bytes' : 'lengths ' + a.length + ' / ' + b.length);
  ok('every warning is a named, readable row (warnings are shown to the owner)',
    (graph.report.warnings || []).every((w) => w && w.code && w.piece && w.msg),
    String((graph.report.warnings || []).length) + ' warnings, e.g. ' + (((graph.report.warnings || [])[0] || {}).msg || ''));
}

/* ════════════════════════════════════════════════════════════════════════════
   10. WIRING — only with --wiring. Red until the integration piece lands.
   ════════════════════════════════════════════════════════════════════════════ */
if (WIRING && S(10, 'index.html wiring (the weaponsmith lesson)')) {
  const html = lf(readIf(join(ROOT, 'public/index.html')) || '');
  const bridgeAt = html.indexOf('window.SupplyChainBridge');
  const tagAt = html.search(/src\/supplychain\/index\.js\?v=sc/);
  ok('the SupplyChainBridge classic script is in index.html', bridgeAt >= 0);
  ok('the module tag src/supplychain/index.js?v=sc… is in index.html', tagAt >= 0);
  ok('the bridge is ABOVE the module tag (a module sees no bridge declared after it)', bridgeAt >= 0 && tagAt >= 0 && bridgeAt < tagAt, bridgeAt + ' / ' + tagAt);
  /* This used to read "tagAt < 0 || …", so it reported OK while the preceding
     check was FAIL — it passed BECAUSE the tag was absent, and would have kept
     passing if integration landed the tag without type="module", which is the
     exact weaponsmith failure this section exists to prevent. */
  ok('the module tag is type="module"', tagAt >= 0 && /<script[^>]*type=["']module["'][^>]*src\/supplychain\/index\.js/.test(html), tagAt < 0 ? 'no module tag at all' : '');
  ok('the Ruin Exchange tile btn-supply-chain exists', html.includes('btn-supply-chain'));
  ok('…and uses the null-when-absent idiom (no tile when the module did not mount)',
    /MythicSupplyChain[\s\S]{0,200}?(\?\.|&&|typeof)/.test(html));
} else if (!WIRING && !ONLY) {
  console.log('\n  ── 10. index.html wiring — SKIPPED (pass --wiring; the integration piece turns it green)');
}

/* ════════════════════════════════════════════════════════════════════════════
   11. THE RECOMMENDER AND THE PLAN SAY SOMETHING.
   partners.js (167 KB) and plan.js (161 KB) carry two of the owner's five
   verbatim clauses and had NO behavioural pin: §7 text-scans them, nothing
   calls them. The critic proved it by replacing bestPartners() with `return []` and
   planFor() with an empty plan — all nine pins stayed green and the suite
   exited 0 with a third of the feature deleted. Everything below CALLS the two
   modules over every node on the map and reads the answer.
   ════════════════════════════════════════════════════════════════════════════ */
if (S(11, 'bestPartners() and planFor() are called, and answer')) {
  const partners = await imp('partners.js');
  const planmod = await imp('plan.js');
  /* The plan reads live economy numbers through opEcon; in Node that is the
     generated fixture, never a number written down here (the _opEcon() rule). */
  const opsEcon = JSON.parse(lf(readFileSync(join(TOOLS, 'fixture.opsecon.json'), 'utf8'))).opsEcon;
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const tiles = businesses.BUSINESSES.map((b) => b.id);

  /* ── the recommender ── */
  const noRows = [], unrealPartner = [], badRole = [], noReason = [], leaky = [], degraded = [], selfRec = [];
  for (const id of tiles) {
    const rows = partners.bestPartners(id, data) || [];
    if (!rows.length) { noRows.push(id); continue; }
    for (const r of rows) {
      if (r.degraded) { degraded.push(id + ': ' + (r.error || '')); continue; }
      if (!nodeIds.has(r.id)) unrealPartner.push(id + ' -> ' + JSON.stringify(r.id));
      if (r.id === id) selfRec.push(id);
      if (!partners.ROLES.includes(r.role)) badRole.push(id + ' -> ' + r.id + '/' + r.role);
      const reasons = (r.reasons || []).filter((t) => typeof t === 'string' && t.trim());
      if (!reasons.length) noReason.push(id + ' -> ' + r.id);
      /* REASON_LEAK is partners.js's own definition of audit wording escaping
         into a sentence a player reads. Using the module's regex, not a copy,
         is deliberate: the two cannot drift apart. */
      for (const t of reasons) if (partners.REASON_LEAK.test(t)) leaky.push(id + ' -> ' + r.id + ': ' + t.slice(0, 60));
    }
  }
  ok('every one of the ' + tiles.length + ' tiles is told who to work with (a ranked, non-empty list)', noRows.length === 0, few(noRows, 10));
  ok('no card came back DEGRADED (bestPartners caught something internally)', degraded.length === 0, few(degraded, 4));
  ok('every recommended partner is a real node on the map', unrealPartner.length === 0, few(unrealPartner, 8));
  ok('no tile is recommended to work with itself', selfRec.length === 0, few(selfRec, 8));
  ok('every recommendation carries one of partners.ROLES', badRole.length === 0, few(badRole, 8));
  ok('every recommendation says WHY, in a sentence', noReason.length === 0, few(noReason, 8));
  ok('no reason leaks audit wording at the player (partners.REASON_LEAK)', leaky.length === 0, few(leaky, 4));
  /* partners.js ships its own auditor and nothing consumed it until now. */
  const ar = partners.auditReasons(data) || [];
  ok('partners.auditReasons() finds nothing wrong with its own wording', ar.length === 0, few(ar, 4));
  ok("the owner's own lane is recommended: Medical is pointed at Fashion Brand",
    (partners.bestPartners('medical', data) || []).some((r) => r.id === 'fashion' && r.role === 'supplier'),
    (partners.bestPartners('medical', data) || []).map((r) => r.id).join(', '));

  /* ── the plan ── */
  const planIds = planmod.planIds(data) || [];
  ok('a plan exists for every node on the map (27 tiles + 4 systems + 2 channels)', planIds.length === graph.nodes.length, planIds.length + ' vs ' + graph.nodes.length);
  const noSteps = [], noText = [], jargon = [], noVerdict = [], unrealNeed = [], noFit = [], noNotFor = [], noNeedRes = [];
  /* ── "not empty" is not the pin that matters ─────────────────────────────
     Round-2 critic break that this suite did NOT catch: override planText() to
     return one fixed 400-char paragraph and every assertion above stays green —
     each plan is long, jargon-free prose, and all 33 are THE SAME prose. The
     owner's clause is "gives them a plan so players can know if it is for
     them"; a plan identical to the other 32 answers that question for nobody,
     and a refactor that quietly falls through to a generic template ships
     green. So collect the answers and demand they DIFFER. Texts must be 33 of
     33 (the real tree is, today). fitFor / notFor / needToStart are floors at
     the numbers measured today, not perfection: ten tiles genuinely do tell the
     player to bring the same starting kit, which is a content note in
     sc/decisions, not a red line — but the floors mean those numbers can only
     go UP, and the detail prints them so the trend is visible.
     The floors below are the numbers MEASURED on this tree today —
     27/18/27/11/27 — not aspirations: a floor above what the data does is a
     red line nobody can clear, and a floor below it is a pin that has already
     slipped. The two STYLE floors are well under 27 because a shared verdict
     ("mining == agri == salvage" are all operator plays) is honest content,
     not a bug; the SENTENCE floors are at 27 because the prose must never
     repeat. */
  const sigText = [], sigFit = [], sigFitStyle = [], sigNot = [], sigNotStyle = [], sigNeed = [];
  for (const id of planIds) {
    const pl = planmod.planFor(id, { data, opEcon: opsEcon }) || {};
    const isTile = tiles.includes(id);
    if (!(pl.steps || []).length) noSteps.push(id);
    const text = pl.text || planmod.planText(pl) || '';
    if (text.trim().length < 200) noText.push(id + ' (' + text.trim().length + ' chars)');
    /* plan.js's own definition of wording no player should be shown. */
    if (planmod.JARGON.test(text)) jargon.push(id + ': ' + (text.match(planmod.JARGON) || [''])[0]);
    if (typeof pl.verdictFor !== 'function' || !(pl.verdictFor({}) || {}).verdict) noVerdict.push(id);
    /* "so players can know if it is for them" is literally these two lists. */
    if (isTile && !(pl.fitFor || []).length) noFit.push(id);
    if (isTile && !(pl.notFor || []).length) noNotFor.push(id);
    const res = (pl.needToStart && pl.needToStart.resources) || [];
    if (isTile && !res.length) noNeedRes.push(id);
    for (const r of res) if (!catalog.has(r.id)) unrealNeed.push(id + '/' + JSON.stringify(r.id));
    sigText.push([id, text.trim()]);
    if (isTile) {
      /* Two signatures per list on purpose. The WHY is the sentence the player
         reads, so it catches a generic paragraph; the STYLE list is the
         structural answer ("operator / battler / investor"), so it catches a
         recommender that writes 27 different sentences around one verdict.
         Either alone is gameable; together they are not. */
      sigFit.push([id, JSON.stringify((pl.fitFor || []).map((x) => x.why))]);
      sigFitStyle.push([id, JSON.stringify((pl.fitFor || []).map((x) => x.style))]);
      sigNot.push([id, JSON.stringify((pl.notFor || []).map((x) => x.why))]);
      sigNotStyle.push([id, JSON.stringify((pl.notFor || []).map((x) => x.style))]);
      sigNeed.push([id, JSON.stringify(res.map((x) => x.id))]);
    }
  }
  /* Names the tiles that collide, not just a count: "17 of 27" tells you the
     pin is red, the id pairs tell you which template swallowed which tile. */
  const collisions = (pairs) => {
    const byVal = new Map();
    for (const [id, v] of pairs) { if (!byVal.has(v)) byVal.set(v, []); byVal.get(v).push(id); }
    return [...byVal.values()].filter((g) => g.length > 1).map((g) => g.join(' == '));
  };
  const distinct = (pairs) => new Set(pairs.map((p) => p[1])).size;
  ok('every plan has numbered steps (not an empty plan)', noSteps.length === 0, few(noSteps, 10));
  ok('every plan renders to real prose, not a stub', noText.length === 0, few(noText, 8));
  ok('no plan shows the player jargon (plan.JARGON)', jargon.length === 0, few(jargon, 4));
  ok('every plan answers "is this for me" with a verdict', noVerdict.length === 0, few(noVerdict, 8));
  ok('every tile says who it is FOR', noFit.length === 0, few(noFit, 10));
  ok('…and who it is NOT for (a plan that only sells is not a plan)', noNotFor.length === 0, few(noNotFor, 10));
  ok('every tile says what you need to start, by resource', noNeedRes.length === 0, few(noNeedRes, 10));
  ok('every resource a plan tells you to bring is a real catalogue id', unrealNeed.length === 0, few(unrealNeed, 8));
  ok('every plan says something DIFFERENT — no two of the ' + planIds.length + ' collapse to the same words',
    distinct(sigText) === planIds.length,
    distinct(sigText) + ' distinct of ' + planIds.length + (collisions(sigText).length ? ' · ' + few(collisions(sigText), 4) : ''));
  /* Floors, not equality — see the note above. Raise them, never lower them. */
  ok('who a tile is FOR is a different SENTENCE on every tile (floor 27)', distinct(sigFit) >= 27,
    distinct(sigFit) + ' distinct of ' + sigFit.length + ' · ' + few(collisions(sigFit), 3));
  ok('…and a different VERDICT on most of them (fitFor styles, floor 18)', distinct(sigFitStyle) >= 18,
    distinct(sigFitStyle) + ' distinct of ' + sigFitStyle.length + ' · ' + few(collisions(sigFitStyle), 2));
  ok('who a tile is NOT for is a different sentence on nearly every tile (floor 27)', distinct(sigNot) >= 27,
    distinct(sigNot) + ' distinct of ' + sigNot.length + ' · ' + few(collisions(sigNot), 3));
  ok('…and a different verdict on a third of them (notFor styles, floor 11)', distinct(sigNotStyle) >= 11,
    distinct(sigNotStyle) + ' distinct of ' + sigNotStyle.length + ' · ' + few(collisions(sigNotStyle), 2));
  ok('what you need to start is a different shopping list on every tile (floor 27)', distinct(sigNeed) >= 27,
    distinct(sigNeed) + ' distinct of ' + sigNeed.length + ' · ' + few(collisions(sigNeed), 3));
  const med = planmod.planFor('medical', { data, opEcon: opsEcon });
  ok("the owner's example reads end to end: Medical's plan names Fashion Brand",
    /Fashion Brand/.test(med.text || ''), (med.text || '').length + ' chars');
}

/* ── verdict ───────────────────────────────────────────────────────────────── */
const pinLine = [...ran].sort((a, b) => +a - +b).map((n) => n + '=' + (sectionFails[n] ? 'fail' : 'ok')).join(' ');
console.log('\n  PINS: ' + pinLine);
console.log(fails === 0 ? '\n  ✅ supply chain: every pin green\n' : '\n  ❌ supply chain: ' + fails + ' failing check(s) in section(s) ' + Object.keys(sectionFails).join(', ') + '\n');
process.exit(fails === 0 ? 0 : 1);
