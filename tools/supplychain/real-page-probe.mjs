/* ═══════════════════════════════════════════════════════════════════════════
   🔬 real-page-probe — the fixture, checked against the GAME AS IT RUNS.

   WHY THIS EXISTS. `gen-fixture --check` compares the fixture to index.html's
   SOURCE TEXT. That is the right test for "did somebody retune a wage", and it
   is blind to the only thing that decides what a player actually sees: the
   clamps and overrides inside `_opEcon` itself.

     • `getOpsEconOverrides()` merges a local (`Forge.opsEcon`) or PUBLISHED
       (`Catalog.opsEcon`) admin override over the base row.
     • `OPS_FREE_LICENCE` (public/index.html:98127, currently `{}`) forces a
       row's acquisition price to 0 whatever the table or an override says.
     • `OPS_PINNED_PRICE` (public/index.html:98135, currently
       `{ construction: 1 }`) does the opposite: for a pinned row the TABLE's
       `startup`/`azaStartup` are the last word and an override cannot reprice
       it. So `construction` is the one op that is immune to overrides, and the
       other 24 are not — a distinction named nowhere else in this folder.

   The README's "the fixture is the base table, with no overrides applied"
   caveat is therefore true but incomplete, and both directions of it are
   invisible to a text diff. This file closes that: it loads the real
   `/index.html` in headless Chromium and reads the LIVE `_opEcon` through the
   door index.html already publishes —

       window.__mg.opsEcon = { table: OPS_ECON, live: _opEcon, computed: _opComputed }
       (public/index.html:98164, immediately below _opEcon)

   — for all 25 ops, plus `window.MythicTransport.routes.PHASE`, and diffs the
   answers against fixture.opsecon.json with the SAME `drift()` the generator
   uses. On this tree, with no admin override published, every row comes back
   byte-identical (construction included) and PHASE === the fixture's — and the
   day that stops being true, the gate says which field moved instead of a
   builder discovering it in a screenshot.

   READ-ONLY. It opens a page and evaluates getters. It writes nothing, clicks
   nothing, signs nothing in, and touches no file in the repo. It needs NO edit
   to index.html: every symbol it reads is already published. (The round-2
   claim that this proof had to wait for the W5 integration piece was simply
   wrong.)

   WHAT IT ALSO RECORDS — the reachability facts the W5 bridge block depends
   on, MEASURED on the running page rather than assumed (EXPECTED_REACH below,
   and a change either way is printed as a note):
     `window.getRes`            function   → `held()` has a source
     `window.Profile`           object     → NOT the globals trap: index.html:258162
                                             defines an explicit read-only getter
                                             (`get: () => Profile, set: () => {}`) for
                                             the Node City iframe bridge. A dozen
                                             comments in this repo say "window.Profile
                                             is undefined"; on the shipped page it is
                                             not, and only because of that one line.
     `window.MythicTransport`   object     → `transportPhase()` (look it up LAZILY)
     `window.showToast` / `gcConfirm` / `getRes` / `_opEcon` / `_ownsOp`
                                function   → a top-level `function NAME(){}` in a
                                             CLASSIC script IS a window property. The
                                             globals trap is about `const` and `let`,
                                             not about every legacy symbol — a
                                             distinction this repo's comments never draw.
     `window.OP_LABELS` / `RESOURCES` / `SALVAGE_RES` / `LOOT_RES_IDS` /
     `STRUCTURE_SALVAGE` / `OPS_ECON`
                                undefined  → the trap proper (`const` at the top level
                                             of a classic script). The bridge MUST hand
                                             these over; there is no other door.
   So `BRIDGE_MEMBERS` cannot shrink to nothing. It could technically shrink by
   the members backed by a function declaration or by that one Profile getter —
   and it must not: the house pattern is ONE seam per feature (CLAUDE.md), the
   Profile getter is a courtesy for one iframe rather than a contract, and
   `opEcon` must keep going through `_opEcon` so an admin override reaches the
   map. The measurement is here so that choice is made knowingly.

   USAGE
     node tools/supplychain/real-page-probe.mjs            exit 1 on drift
     node tools/supplychain/real-page-probe.mjs --json     + the full report
     node tools/supplychain/real-page-probe.mjs --shot f.png
   Cost: one Chromium launch (~6 s). Chromium comes from node_modules; nothing
   is installed and the server picks an ephemeral port, so parallel runs never
   collide.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage, shot } from './shoot.mjs';
import { drift, FIXTURE } from './gen-fixture.mjs';

/* Read inside the page. Kept as ONE evaluate so the whole reading is of a
   single moment: index.html keeps loading (saves, catalogs, sockets) and two
   evaluates could straddle a catalog arriving and disagree with each other for
   an honest reason, which would read as drift. */
function readLivePage({ ids, reachKeys }) {
  const out = {
    have: !!(window.__mg && window.__mg.opsEcon),
    live: {}, missing: [], threw: {},
    transportPhase: null, transportSeen: false,
    reach: {},
    version: (window.__mg && window.__mg.version) || window.BUILD_VERSION || null,
  };
  const oe = window.__mg && window.__mg.opsEcon;
  if (oe && typeof oe.live === 'function') {
    for (const id of ids) {
      try {
        const r = oe.live(id);
        if (r && typeof r === 'object') out.live[id] = JSON.parse(JSON.stringify(r));
        else out.missing.push(id);
      } catch (e) { out.threw[id] = String((e && e.message) || e); }
    }
    // Ops the LIVE table has and the fixture does not: a 26th business.
    try { out.tableIds = Object.keys(oe.table || {}); } catch (e) { out.tableIds = null; }
  }
  try {
    const T = window.MythicTransport;
    out.transportSeen = !!T;
    if (T && T.routes && typeof T.routes.PHASE === 'number') out.transportPhase = T.routes.PHASE;
  } catch (e) {}
  for (const k of reachKeys) {
    try { out.reach[k] = typeof window[k]; } catch (e) { out.reach[k] = 'threw'; }
  }
  return out;
}

/* What the shipped page answers TODAY, measured (2026-09-25, v121v116 tree).
   This is the only written-down statement in the repo of which legacy symbols
   an ES module can and cannot see, and it is a measurement, not a belief:
   every value here was read by this file from the running game. A difference
   is a NOTE, not a failure — `window.Profile` appearing is a bridge that could
   shrink, `window.getRes` disappearing is `held()` losing its source (that one
   IS a failure, below). */
const EXPECTED_REACH = {
  // ── `function NAME(){}` at the top level of a CLASSIC script IS a window
  //    property. The globals trap is about `const`/`let`, not about every
  //    legacy symbol, and nothing in this repo said so until this probe.
  getRes: 'function',          // index.html:43873 — the alias-folding read held() needs
  showToast: 'function',       // index.html — function declaration
  gcConfirm: 'function',       // index.html:144685 — function declaration
  _opEcon: 'function',         // index.html:98136 — also published as __mg.opsEcon.live
  _ownsOp: 'function',
  // ── the explicit exceptions
  Profile: 'object',           // index.html:258162 — a read-only getter, added for the city iframe
  MythicTransport: 'object',   // src/transport/index.js:1802 — an ES module, so it mounts LATE
  // ── the globals trap proper: `const` at the top level of a classic script.
  //    These five are why the W5 bridge block cannot be skipped.
  OPS_ECON: 'undefined',       // (reachable as __mg.opsEcon.table, but not by its own name)
  OP_LABELS: 'undefined',
  RESOURCES: 'undefined',
  SALVAGE_RES: 'undefined',
  LOOT_RES_IDS: 'undefined',
  STRUCTURE_SALVAGE: 'undefined',
  SupplyChainBridge: 'undefined',   // until the W5 integration block lands
};

export async function probe({ shotTo = null } = {}) {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const ids = Object.keys(fx.opsEcon);
  const report = await withPage(async (page, t) => {
    /* The real page is not a harness: it talks to Supabase, registers a
       service worker (blocked here) and logs freely. Its console noise is not
       this probe's verdict — the verdict is the diff below — so errors are
       allowed and merely REPORTED. navStatus is still fatal: a 404'd
       index.html would otherwise "prove" nothing very convincingly. */
    t.allowErrors = true;
    await t.goto('index.html');            // no leading slash — Git Bash rewrites one
    if (t.navStatus !== null && t.navStatus >= 400) throw new Error('real-page-probe: /index.html returned HTTP ' + t.navStatus);
    /* Wait for the publication, not for a timer. __mg.opsEcon is assigned in
       the same classic script as _opEcon, so it exists as soon as that script
       has run; MythicTransport is an ES module and lands later (see the README
       note on lazy lookup) — hence the second, tolerant wait. */
    await page.waitForFunction(() => !!(window.__mg && window.__mg.opsEcon && typeof window.__mg.opsEcon.live === 'function'), null, { timeout: 60000 });
    try { await page.waitForFunction(() => !!(window.MythicTransport && window.MythicTransport.routes), null, { timeout: 20000 }); } catch (e) { /* recorded as transportSeen:false */ }
    const r = await page.evaluate(readLivePage, { ids, reachKeys: Object.keys(EXPECTED_REACH) });
    if (shotTo) r.shot = await shot(page, shotTo);
    r.pageErrors = t.errors.slice(0, 20);
    r.pageErrorCount = t.errors.length;
    return r;
  }, { w: 1280, h: 800 });

  const problems = [];
  if (!report.have) problems.push('window.__mg.opsEcon is not published — index.html:98164 moved or _opEcon was renamed');
  for (const id of report.missing) problems.push(`live _opEcon("${id}") returned no row, but the fixture has one`);
  for (const id of Object.keys(report.threw)) problems.push(`live _opEcon("${id}") threw: ${report.threw[id]}`);
  /* The heart of it: the LIVE row vs the fixture row, field by field, key
     order included, through the generator's own differ. "fixture X → index.html
     Y" in its messages reads here as "fixture X → the running game Y". */
  for (const l of drift({ opsEcon: fx.opsEcon }, { opsEcon: report.live })) problems.push('live ' + l);

  if (report.transportPhase === null) {
    problems.push(report.transportSeen
      ? 'window.MythicTransport.routes.PHASE is not a number — transportPhase() would answer 0 (unknown) forever'
      : 'window.MythicTransport never appeared — the transport module did not mount');
  } else if (report.transportPhase !== fx.transportPhase) {
    problems.push(`transportPhase: fixture ${fx.transportPhase} → the running game ${report.transportPhase}`);
  }
  if (report.reach.getRes !== 'function') problems.push('window.getRes is not a function — held() has no source (README "The bridge contract")');
  /* Not failures, INVARIANTS WORTH HEARING ABOUT. A symbol that becomes
     reachable is a bridge member that could shrink; one that stops being
     reachable is a bridge member that MUST NOT. Both directions print. */
  const notes = [];
  for (const k of Object.keys(EXPECTED_REACH)) {
    const was = EXPECTED_REACH[k], now = report.reach[k];
    if (now === was) continue;
    if (k === 'SupplyChainBridge' && now !== 'undefined') { notes.push('window.SupplyChainBridge exists on the real page — the W5 integration block has landed; this probe should then also check it member by member'); continue; }
    notes.push(`window.${k}: was ${was} on the measured tree, is ${now} now` +
      (was === 'undefined' ? ' (reachable → the bridge could hand it over more cheaply)'
                           : ' (no longer reachable → whatever depended on it is broken; see EXPECTED_REACH)'));
  }

  return { report, problems, notes, ids };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2);
  const shotTo = a.includes('--shot') ? a[a.indexOf('--shot') + 1] : null;
  try {
    const { report, problems, notes, ids } = await probe({ shotTo });
    if (a.includes('--json')) console.log(JSON.stringify(report, null, 1));
    for (const n of notes) console.log('note: ' + n);
    const extra = (report.tableIds || []).filter((id) => !ids.includes(id));
    if (extra.length) console.log('note: the live OPS_ECON has ops the fixture does not: ' + extra.join(', ') + ' — re-run gen-fixture.mjs');
    console.log(`real-page-probe: ${ids.length} ops read live, ${report.pageErrorCount} page console/error line(s), transportPhase ${report.transportPhase}, getRes ${report.reach.getRes}, OP_LABELS ${report.reach.OP_LABELS}, RESOURCES ${report.reach.RESOURCES}`);
    if (problems.length) {
      console.error(`real-page-probe: FAIL — ${problems.length} difference(s) between fixture.opsecon.json and the RUNNING game:`);
      for (const p of problems.slice(0, 40)) console.error('  ' + p);
      console.error('  (an admin Ops-Econ override, OPS_FREE_LICENCE or OPS_PINNED_PRICE can all cause this legitimately — read the row before regenerating)');
      process.exit(1);
    }
    console.log('real-page-probe: ok — every live _opEcon row matches the fixture, construction (OPS_PINNED_PRICE) included');
    process.exit(0);
  } catch (e) { console.error(String((e && e.stack) || e)); process.exit(1); }
}
