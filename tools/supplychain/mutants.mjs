/* 🧪 SUPPLY CHAIN — NEGATIVE CONTROLS for _supplychain_smoke.mjs.
     node tools/supplychain/mutants.mjs            every mutant
     node tools/supplychain/mutants.mjs --pin 4    only the mutants aimed at pin 4
     node tools/supplychain/mutants.mjs --keep     leave the temp trees on disk to inspect

   WHY THIS FILE EXISTS. A green suite proves nothing on its own: a pin that
   cannot fail is a defect, and the cheapest way to write one by accident is to
   assert over an empty list (`[].every(...)` is true) or to read a field that
   was renamed out from under it. So for every pin 1-9 and 11 this file breaks
   the data the pin claims to watch and demands that the pin goes RED. A mutant
   that leaves the suite green is reported as a FAILURE OF THE SUITE, not of
   the data.

   PIN 10 HAS NO MUTANT HERE, on purpose. It reads public/index.html, which
   other Claude sessions are editing right now and which this file has promised
   not to touch; --root deliberately stays the real repo. Pin 10 proves it can
   go red a different way: without --wiring it is skipped, and with --wiring on
   a tree where integration has not landed it is the only failing section
   (PINS: 1..9,11=ok 10=fail). That IS its negative control.

   HOW IT BREAKS THINGS WITHOUT TOUCHING THE REPO. Other Claude sessions are
   editing this tree right now, so nothing here writes inside E:/game-deploy.
   Each mutant gets a throwaway copy of the handful of files the pure modules
   need, under the OS temp dir, and the suite is pointed at it:

       node _supplychain_smoke.mjs --src <tmp>/public/src/supplychain
                                   --tools <tmp>/tools/supplychain --root <repo>

   --root stays the REAL repo on purpose: public/index.html and the two
   generators are the fixed point every drift pin measures against, so a mutant
   changes the generated copy and index.html stays honest.

   THE CONTROL RUN comes first: the unmutated copy must be green on pins 1-9. If
   it is not, the copy is missing a file and every "red" below would be red for
   the wrong reason.                                                           */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SMOKE = path.join(REPO, '_supplychain_smoke.mjs');
const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const ONLY_PIN = val('--pin');
const KEEP = argv.includes('--keep');

/* The files a pure import of data.js pulls in. Kept explicit rather than copying
   public/src wholesale: the whole folder is tens of megabytes of scenes and
   art, and a surprise new import should announce itself as a control-run
   failure here, not be silently swallowed by a recursive copy. */
const COPY_DIRS = ['public/src/supplychain'];
const COPY_FILES = [
  'public/src/city/production.data.js',
  'public/src/resources/chain.js',
  'public/src/transport/routes.js',
  'tools/supplychain/fixture.opsecon.json',
];

/* ── mutation helpers ──────────────────────────────────────────────────────── */
/* Every edit must be proven to have LANDED. A regex that silently matches
   nothing produces an unmutated copy, the pin stays green, and this file would
   then report a real pin as broken. So `sub` throws when it changes nothing. */
const sub = (find, replace) => (text, id) => {
  const out = text.replace(find, replace);
  if (out === text) throw new Error(`mutant ${id}: the edit ${find} matched nothing — the file moved under it`);
  return out;
};
const append = (code) => (text) => text + '\n' + code + '\n';

const MUTANTS = [
  /* ── 1. the owner's map ─────────────────────────────────────────────────── */
  { id: 'map-extra-icon', pin: 1, what: 'draw a Marketplace icon beside the Dojo that the PDF does not draw',
    why: 'An invented icon is the failure mode that matters: it tells the player a business earns somewhere it does not.',
    files: { 'public/src/supplychain/businesses.js': sub("drawn: [CARD(1530, 533)] })", "drawn: [CARD(1530, 533), M(1530, 620)] })") } },
  { id: 'map-lost-need', pin: 1, what: 'drop Home Feed from the Restaurant\'s needs column',
    why: 'A missing needs-edge silently deletes a lane from the graph, the partner list and the plan.',
    files: { 'public/src/supplychain/businesses.js': sub(/,\s*B\('feed', 410, 715\)/, '') } },
  { id: 'map-wrong-page', pin: 1, what: 'move Medical Corporation to page 7',
    why: 'Page is how a critic re-checks an icon against the JPG; a wrong page makes every cite unverifiable.',
    files: { 'public/src/supplychain/businesses.js': sub("id: 'medical', label: 'Medical Corporation', page: 8", "id: 'medical', label: 'Medical Corporation', page: 7") } },

  /* ── 2. every need is obtainable ────────────────────────────────────────── */
  { id: 'loot-index-dead', pin: 2, what: 'make isLootable() answer "no" for everything',
    why: 'This is what a renamed catalogue flag would do. The map would keep listing needs while the battle system no longer answers any of them.',
    files: { 'public/src/supplychain/loot.js': sub(/export function isLootable\(([^)]*)\) \{/, 'export function isLootable($1) {\n  return false;') } },

  /* ── 3. a use for every resource ────────────────────────────────────────── */
  { id: 'catalog-orphan-row', pin: 3, what: 'add a resource row that nothing consumes',
    why: 'Exactly what adding a resource to index.html and forgetting coverage.js looks like. The owner asked for ALL of them; this is the pin that notices number 425.',
    files: { 'public/src/supplychain/catalog.snapshot.js': sub(/export const CATALOG = deepFreeze\(\[\n/,
      'export const CATALOG = deepFreeze([\n  {"id":"mutantOre","name":"Mutant Ore","icon":"🪨","color":"#888888","from":{"name":"ledger","icon":"ledger","color":"ledger"},"altIcon":null,"mixedSource":false,"inLedger":true,"inLoot":true,"staple":false,"inChain":false,"handLoot":true,"inShipyard":false,"chainCat":null,"tier":null,"wt":null},\n') } },

  /* A cite that merely EXISTS is not a cite. Round 2's critic: the pin's own
     name promises "a cite a reader can re-grep", but it only tested presence,
     so a fabricated path sailed through. Two mutants, one for each half of a
     resolvable cite. */
  { id: 'cite-file-invented', pin: 3, what: 'point a LIVE cite at a file that does not exist',
    why: 'A cite is the only thing separating "the game really does this" from "we think it does". An unresolvable one is worse than none: it reads as evidence.',
    files: { 'public/src/supplychain/coverage.js': sub('"src/weaponsmith/blueprints.js:109"', '"src/nowhere/fake.js:999"') } },
  { id: 'cite-line-past-eof', pin: 3, what: 'cite a real file at a line it does not have',
    why: 'The commoner failure by far: the file is right and the line number rotted when the file moved. A reader lands in the wrong function and believes it.',
    files: { 'public/src/supplychain/coverage.js': sub('"src/plague/cures.js:66"', '"src/plague/cures.js:999999"') } },

  /* ── 4. everything ships through Transport ──────────────────────────────── */
  { id: 'phase-overclaim', pin: 4, what: 'move transport/routes.js back to PHASE 0 while the lanes still claim phase 1',
    why: 'The honesty pin. If the game retreats a phase and the map keeps saying "enforced", the screen is lying about a rule players are being judged by.',
    files: { 'public/src/transport/routes.js': sub(/^export const PHASE = \d+;/m, 'export const PHASE = 0;') } },
  { id: 'truck-flag-lost', pin: 4, what: 'forget that the PDF drew no truck beside the Dojo',
    why: 'The five no-truck tiles are the open conflict between the drawn map and the written goal (pdfmap §6-B). Losing the flag hides the conflict instead of showing it.',
    files: { 'public/src/supplychain/shipping.js': sub(/'dojo',\s*/, '') } },

  /* ── 5. every id is real ────────────────────────────────────────────────── */
  { id: 'phantom-laundered', pin: 5, what: 'let the Fashion Brand produce gunOil, an id with no catalogue row',
    why: 'gunOil is a real data bug we promised to SHOW as a gap. Using it as cargo would quietly turn a bug into content that renders as a blank icon.',
    files: { 'public/src/supplychain/recipes.js': sub(/want\('cloth',/, "want('gunOil',") } },

  /* ── 6. the owner's own example ─────────────────────────────────────────── */
  { id: 'cloth-lane-cut', pin: 6, what: 'stop Medical buying cloth from the Fashion Brand',
    why: 'The one route the owner wrote out in words. It is the first thing that will be clicked, so it gets a pin of its own.',
    files: { 'public/src/supplychain/recipes.js': sub(/lane\('fashion', \['cloth', 'fabric'\]/, "lane('fashion', ['fabric']") } },

  /* ── 7. hygiene ─────────────────────────────────────────────────────────── */
  { id: 'pure-file-window', pin: 7, what: 'read a global out of a pure file',
    why: "CLAUDE.md's globals trap. A module that reaches for window gets undefined at runtime and un-importable in node, which is how this whole layer stops being testable.",
    /* Round 2: this used to crash the suite on its top-level import with a raw
       ReferenceError, before any pin had run, and this file papered over that
       with a `tolerateCrash` flag. The smoke now text-scans for window BEFORE
       importing anything and attributes the failed import to pin 7, so the
       mutant is an ordinary red pin like every other one here and the flag is
       gone. */
    files: { 'public/src/supplychain/graph.js': append('const _mutantProbe = window.Profile;') } },
  { id: 'econ-literal', pin: 7, what: 'write a startup cost down in a module',
    why: 'The _opEcon() rule. A number typed here is a number that will be wrong the day the owner retunes the op, and it will look authoritative on screen.',
    files: { 'public/src/supplychain/plan.js': append('const _mutantStartup = { startup: 25000 };') } },
  { id: 'scene-names-a-tile', pin: 7, what: "hard-code 'medical' inside scene.js",
    why: 'The contract says scene.js draws shapes and scene.nodes.js says which shape. A business id in scene.js is a special case the data can no longer move.',
    files: { 'public/src/supplychain/scene.js': append("const _mutantTile = 'medical';") } },
  { id: 'overlay-carries-a-price', pin: 7, what: 'add a startup field to the proposal overlay',
    why: 'The overlay is the one artefact that could CHANGE the game. It is allowed to carry inputs and yields and nothing else; a price in it would be us setting the owner\'s prices.',
    files: { 'public/src/supplychain/proposal.js': sub(/export function buildOpsEconOverlay\(data, SC, liveOpEcon, opts\) \{\n  return explainOverlay\(data, SC, liveOpEcon, opts\)\.overlay;/,
      'export function buildOpsEconOverlay(data, SC, liveOpEcon, opts) {\n'
      + '  const _m = explainOverlay(data, SC, liveOpEcon, opts).overlay;\n'
      + '  for (const k of Object.keys(_m)) _m[k] = Object.assign({}, _m[k], { startup: 1 });\n'
      + '  return _m;') } },

  /* ── 8. drift ───────────────────────────────────────────────────────────── */
  { id: 'fixture-stale', pin: 8, what: 'edit one number in the generated fixture',
    why: 'The fixture is what every Node test reads instead of the live economy. Stale, it makes the other eight sections green against last week\'s game.',
    files: { 'tools/supplychain/fixture.opsecon.json': (t, id) => {
      const j = JSON.parse(t); const op = Object.keys(j.opsEcon)[0];
      if (j.opsEcon[op].ratePerWorkerHr == null) throw new Error(`mutant ${id}: op ${op} has no ratePerWorkerHr to move`);
      j.opsEcon[op].ratePerWorkerHr = j.opsEcon[op].ratePerWorkerHr + 1;
      return JSON.stringify(j, null, 2);
    } } },
  { id: 'snapshot-forked', pin: 8, what: 'hand-edit the generated catalogue snapshot',
    why: 'A hand edit to a GENERATED file survives every other check here and dies at the next regeneration. The pin says: the modules under test must BE the shipped snapshot.',
    files: { 'public/src/supplychain/catalog.snapshot.js': sub(/"name":"Ammo"/, '"name":"Ammunition"') } },

  /* ── 9. the graph ───────────────────────────────────────────────────────── */
  { id: 'graph-broken-example', pin: 9, what: "point the owner's cloth example at a business that does not make cloth",
    why: 'graph.js promises report.errors is empty. If its own checks stop firing, every downstream view is drawing an unvalidated map.',
    files: { 'public/src/supplychain/data.js': sub(/res: 'cloth', from: 'fashion', to: 'medical'/, "res: 'cloth', from: 'bank', to: 'medical'") } },
  { id: 'graph-nondeterministic', pin: 9, what: 'make buildGraph() put one changing value in its output',
    why: 'The subtlest failure in the run: a Set or Map iterated into the merge passes once and re-orders every screenshot the next time. Views, partner ranks and the 3D layout all read this order, so "same input, same bytes" is a real promise, not a tidiness rule.',
    files: { 'public/src/supplychain/graph.js': append(
      'const _mutantOrig = buildGraph;\n'
      + 'buildGraph = (d) => Object.assign({}, _mutantOrig(d), { mutantNonce: Math.random() });') } },

  /* ── 11. the recommender and the plan ───────────────────────────────────── */
  /* These three are the reason pin 11 exists. Round 2's critic made the first
     two edits by hand and the whole suite stayed green and exited 0, with the
     "best businesses to work with" and "is this for me" halves of the owner's
     goal deleted. If any of the three ever goes green again, pin 11 has
     stopped watching 328 KB of the feature. */
  { id: 'partners-say-nothing', pin: 11, what: 'make bestPartners() return an empty list for every tile',
    why: 'The owner asked the screen to show the best businesses to work with. An empty list is not an answer, and modal.js paints it as a confident sentence about the MAP.',
    files: { 'public/src/supplychain/partners.js': sub(/export function bestPartners\(nodeId, data, opts\) \{\n  try \{/,
      'export function bestPartners(nodeId, data, opts) {\n  return [];\n  try {') } },
  { id: 'reason-leaks-jargon', pin: 11, what: 'let audit wording out into a reason a player reads',
    why: 'partners.js ships REASON_LEAK precisely because these sentences are written next to the audit notes. A file path or an OPS_ECON in a partner card is the map talking to its authors, not to the player.',
    files: { 'public/src/supplychain/partners.js': append(
      'const _mutantRank = bestPartners;\n'
      + 'bestPartners = (id, d, o) => (_mutantRank(id, d, o) || []).map((r, i) => (i === 0 ? Object.assign({}, r, { reasons: ["Set the OPS_ECON inputs row in public/src/foo.js first."] }) : r));') } },
  { id: 'plan-says-nothing', pin: 11, what: 'make planFor() return a plan with no steps and no prose',
    why: 'The goal says in so many words: then gives them a plan so players can know if it is for them. An empty plan still renders a modal, which is how this would ship unnoticed.',
    files: { 'public/src/supplychain/plan.js': sub(/export function planFor\(nodeId, opts\) \{\n  const o = isObj\(opts\) \? opts : \{\};/,
      'export function planFor(nodeId, opts) {\n'
      + "  return { id: nodeId, label: String(nodeId), kind: 'business', status: 'live', steps: [], fitFor: [], notFor: [], needToStart: { resources: [], businesses: [] }, risks: [], text: '', verdictFor: () => ({}) };\n"
      + '  const o = isObj(opts) ? opts : {};') } },

  /* ── 11b. the round-2 escape, and the assertions that had no control ──────
     THE ONE THAT GOT AWAY. The round-2 critic overrode planText() to return a
     single fixed paragraph. Every plan was then long, jargon-free prose — and
     all 33 were THE SAME prose. The suite printed "every plan renders to real
     prose, not a stub" OK and exited 0 with the owner's "gives them a plan so
     players can know if it is for them" wholly destroyed. "Not empty" was
     pinned; "not all the same" was not. That is the exact shape of a real
     regression: a refactor in which planText quietly falls through to a
     generic template ships green. `plan-says-the-same-thing` is that break,
     kept forever.

     THE REST OF THIS BLOCK exists because mutants.mjs is pin-GRANULAR: one
     green line for pin 11 proved only that ONE of its twenty-odd assertions
     could fail. Twelve had no control at all. Each mutant below re-binds ONE
     exported function on a throwaway copy (a function declaration's binding is
     mutable and live across the import, which is why `append` suffices) and
     breaks exactly one promise the player is shown. Several trip more than one
     assertion — that is fine; a mutant's job is to turn the PIN red, and the
     detail line names which promise broke. */
  { id: 'plan-says-the-same-thing', pin: 11, what: 'make planText() return one fixed paragraph for all 33 plans',
    why: 'THE ROUND-2 ESCAPE. Long, jargon-free, identical prose passed every earlier check. A plan that reads the same on the Dojo and the Oil Rig answers "is this for me" for nobody.',
    files: { 'public/src/supplychain/plan.js': sub(/export function planText\(plan\) \{\n  if \(!isObj\(plan\)\) return '';/,
      'export function planText(plan) {\n'
      + "  return 'This business takes inputs, turns them into outputs and ships them to other players through the Transport company. Hire workers, keep the inputs in stock, and watch the hourly Cinder. Loot from battles covers part of what it needs, and the Marketplace covers the rest. Work with the businesses upstream and downstream of you on the map, and it pays back over time.';\n"
      + "  if (!isObj(plan)) return '';") } },
  { id: 'partner-not-on-the-map', pin: 11, what: 'recommend a business that does not exist',
    why: 'A partner card naming a node the map does not draw sends the player looking for a tile that is not there.',
    files: { 'public/src/supplychain/partners.js': append(
      'const _mA = bestPartners;\nbestPartners = (id, d, o) => (_mA(id, d, o) || []).map((r, i) => (i === 0 ? Object.assign({}, r, { id: "biz:does-not-exist" }) : r));') } },
  { id: 'partner-recommends-itself', pin: 11, what: 'put a tile at the top of its own partner list',
    why: 'Self-recommendation is the classic off-by-one in a ranker that forgets to drop the subject, and it reads as confident advice.',
    files: { 'public/src/supplychain/partners.js': append(
      'const _mB = bestPartners;\nbestPartners = (id, d, o) => (_mB(id, d, o) || []).map((r, i) => (i === 0 ? Object.assign({}, r, { id }) : r));') } },
  { id: 'partner-bad-role', pin: 11, what: 'hand back a role that is not one of partners.ROLES',
    why: 'The views colour and sort by role. An unknown role is an uncoloured, unsorted card, and the module’s own vocabulary has drifted.',
    files: { 'public/src/supplychain/partners.js': append(
      'const _mC = bestPartners;\nbestPartners = (id, d, o) => (_mC(id, d, o) || []).map((r, i) => (i === 0 ? Object.assign({}, r, { role: "frenemy" }) : r));') } },
  { id: 'partner-gives-no-reason', pin: 11, what: 'strip the WHY off the top recommendation',
    why: 'The owner asked for "the best businesses to work with" — a name with no reason is a ranking the player has to take on faith.',
    files: { 'public/src/supplychain/partners.js': append(
      'const _mD = bestPartners;\nbestPartners = (id, d, o) => (_mD(id, d, o) || []).map((r, i) => (i === 0 ? Object.assign({}, r, { reasons: [] }) : r));') } },
  { id: 'partner-degraded-card', pin: 11, what: 'return a card flagged degraded (bestPartners caught itself)',
    why: 'partners.js degrades rather than throwing, so a swallowed internal error looks like a rendered card. Nothing consumed the flag until pin 11.',
    files: { 'public/src/supplychain/partners.js': append(
      'const _mE = bestPartners;\nbestPartners = (id, d, o) => (_mE(id, d, o) || []).map((r, i) => (i === 0 ? Object.assign({}, r, { degraded: true, error: "mutant" }) : r));') } },
  { id: 'medical-loses-fashion', pin: 11, what: "drop Fashion Brand from Medical's partner list",
    why: "The owner's verbatim example is fashion makes cloth -> Transport -> medical. If that one lane stops being recommended, the feature no longer says what the owner asked it to say.",
    files: { 'public/src/supplychain/partners.js': append(
      'const _mF = bestPartners;\nbestPartners = (id, d, o) => (_mF(id, d, o) || []).filter((r) => !(id === "medical" && r.id === "fashion"));') } },
  { id: 'plan-drops-a-node', pin: 11, what: 'leave one node off planIds()',
    why: 'Every tile, system and channel on the map is clickable. A node with no plan is a modal that opens empty.',
    files: { 'public/src/supplychain/plan.js': append(
      'const _mG = planIds;\nplanIds = (d) => (_mG(d) || []).slice(1);') } },
  { id: 'plan-forgets-who-its-for', pin: 11, what: 'empty fitFor and notFor on every plan',
    why: '"so players can know if it is for them" is literally these two lists. A plan that only sells is not a plan.',
    files: { 'public/src/supplychain/plan.js': append(
      'const _mH = planFor;\nplanFor = (id, o) => Object.assign({}, _mH(id, o), { fitFor: [], notFor: [] });') } },
  { id: 'plan-forgets-the-shopping-list', pin: 11, what: 'empty needToStart.resources on every plan',
    why: '"what they need to start" is one of the five verbatim clauses, and an empty list renders as a tidy heading with nothing under it.',
    files: { 'public/src/supplychain/plan.js': append(
      'const _mI = planFor;\nplanFor = (id, o) => { const p = _mI(id, o); return Object.assign({}, p, { needToStart: Object.assign({}, p.needToStart, { resources: [] }) }); };') } },
  { id: 'plan-invents-a-resource', pin: 11, what: 'tell the player to bring a resource id the game does not have',
    why: 'A shopping list is actionable only if every id is a real catalogue id; an invented one sends the player hunting for loot that does not drop.',
    files: { 'public/src/supplychain/plan.js': append(
      'const _mJ = planFor;\nplanFor = (id, o) => { const p = _mJ(id, o); const r = ((p.needToStart || {}).resources || []).slice();'
      + ' if (r.length) r[0] = Object.assign({}, r[0], { id: "unobtainium" });'
      + ' return Object.assign({}, p, { needToStart: Object.assign({}, p.needToStart, { resources: r }) }); };') } },
  { id: 'plan-has-no-verdict', pin: 11, what: 'drop verdictFor() off every plan',
    why: 'verdictFor is how the modal answers the question for THIS player. A missing function is a TypeError at click time, which a data suite can catch before a browser can.',
    files: { 'public/src/supplychain/plan.js': append(
      'const _mK = planFor;\nplanFor = (id, o) => Object.assign({}, _mK(id, o), { verdictFor: null });') } },
  { id: 'plan-same-starting-kit', pin: 11, what: 'give every tile the identical needToStart list',
    why: 'The distinctness floors exist for this: 27 tiles that all say "bring Food and Water" look complete and teach the player nothing about the map.',
    files: { 'public/src/supplychain/plan.js': append(
      'const _mL = planFor;\nconst _mLseed = null;\nlet _mLfixed = null;\n'
      + 'planFor = (id, o) => { const p = _mL(id, o); if (!_mLfixed && ((p.needToStart || {}).resources || []).length) _mLfixed = p.needToStart.resources;'
      + ' return _mLfixed ? Object.assign({}, p, { needToStart: Object.assign({}, p.needToStart, { resources: _mLfixed }) }) : p; };') } },
];

/* ── plumbing ──────────────────────────────────────────────────────────────── */
const run = (args) => new Promise((res) => {
  execFile(process.execPath, [SMOKE, ...args], { cwd: REPO, maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
    res({ code: err ? (err.code == null ? 1 : err.code) : 0, out: String(stdout || '') + String(stderr || '') });
  });
});
const pinsOf = (out) => {
  const m = /^\s*PINS: (.*)$/m.exec(out);
  const map = Object.create(null);
  if (m) for (const p of m[1].trim().split(/\s+/)) { const [k, v] = p.split('='); map[k] = v; }
  return map;
};

function copyTree(dest) {
  for (const d of COPY_DIRS) {
    fs.mkdirSync(path.join(dest, d), { recursive: true });
    for (const f of fs.readdirSync(path.join(REPO, d))) {
      const s = path.join(REPO, d, f);
      if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dest, d, f));
    }
  }
  for (const f of COPY_FILES) {
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(dest, f));
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'supplychain-mutants-'));
const argsFor = (dest, pin) => ['--root', REPO, '--src', path.join(dest, 'public/src/supplychain'),
  '--tools', path.join(dest, 'tools/supplychain'), '--fast', '--only', String(pin)];

let bad = 0, n = 0;
const list = MUTANTS.filter((m) => !ONLY_PIN || String(m.pin) === String(ONLY_PIN));
const pinsCovered = new Set(list.map((m) => m.pin));

console.log('\n  🧪 negative controls — every pin must be provable red.  temp: ' + TMP + '\n');

/* ── control ───────────────────────────────────────────────────────────────── */
const control = path.join(TMP, '_control');
copyTree(control);
{
  const pins = [...new Set(MUTANTS.map((m) => m.pin))].sort((a, b) => a - b);
  const r = await run(['--root', REPO, '--src', path.join(control, 'public/src/supplychain'),
    '--tools', path.join(control, 'tools/supplychain'), '--fast', '--only', pins.join(',')]);
  const green = r.code === 0;
  console.log((green ? '  OK   ' : '  FAIL ') + 'CONTROL — an unmutated copy of the tree is green on pins ' + pins.join(','));
  if (!green) {
    bad++;
    console.log(r.out.split('\n').filter((l) => /FAIL|Error|error/.test(l)).slice(0, 12).map((l) => '         ' + l.trim()).join('\n'));
    console.log('\n  The copy is not faithful, so nothing below would mean anything. Stopping.\n');
    if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(1);
  }
}

/* ── mutants ───────────────────────────────────────────────────────────────── */
for (const m of list) {
  n++;
  const dest = path.join(TMP, m.id);
  copyTree(dest);
  let applied = true, note = '';
  try {
    for (const [rel, fn] of Object.entries(m.files)) {
      const p = path.join(dest, rel);
      fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'), m.id));
    }
  } catch (e) { applied = false; note = String(e.message); }

  if (!applied) {
    bad++;
    console.log('  FAIL pin ' + m.pin + '  ' + m.id + ' — could not be applied: ' + note);
    continue;
  }
  const r = await run(argsFor(dest, m.pin));
  const pins = pinsOf(r.out);
  /* Two ways a pin can legitimately go red: it reports FAIL, or — for a mutant
     that makes a pure file un-importable — the suite refuses to start at all,
     which is itself the message ("a module that fails to parse is reported at
     runtime as not mounted", CLAUDE.md). Anything else means the pin slept. */
  /* The tolerateCrash flag is the escape hatch for a mutant the suite cannot attribute
     to a section. NO mutant uses it today: the window mutant used to, and the
     smoke now attributes that crash to pin 7 instead, which is the point. It is
     kept because the next un-attributable mutant should be visibly exceptional
     rather than quietly re-lowering the bar. */
  const red = pins[String(m.pin)] === 'fail' || (m.tolerateCrash && r.code !== 0 && !Object.keys(pins).length);
  if (!red) bad++;
  const how = pins[String(m.pin)] === 'fail' ? 'pin went red' : (red ? 'the suite refused to run at all' : 'PIN STAYED GREEN');
  console.log((red ? '  OK   ' : '  FAIL ') + 'pin ' + m.pin + '  ' + m.id + ' — ' + m.what);
  console.log('         ' + how + (red ? '' : '   ← this pin cannot fail; it is not testing anything'));
  if (red && pins[String(m.pin)] === 'fail') {
    const lines = r.out.split('\n').filter((l) => l.includes('FAIL ')).slice(0, 2).map((l) => l.trim());
    for (const l of lines) console.log('         > ' + l);
  }
}

if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n  ' + n + ' mutants over pins ' + [...pinsCovered].sort((a, b) => a - b).join(', ')
  + (bad === 0 ? ' — every pin is provably red under its own mutant ✅\n' : '  — ' + bad + ' pin(s) could not be made to fail ❌\n'));
process.exit(bad === 0 ? 0 : 1);
