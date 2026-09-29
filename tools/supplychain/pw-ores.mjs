/* ═══════════════════════════════════════════════════════════════════════════
   ⛏ pw-ores — ONE QUESTION: does a card ever badge the same thing two ways?

   THE BUG THIS EXISTS FOR. Six ids come out of one line of the shipped game —
   OP_ECO_MAP mining.out is ironOre, copperOre, aluminumOre, zincOre, nickelOre,
   coal — and for three rounds the Mining card printed four of them LIVE ("a city
   firm's product, it never reaches your stash") and two PLANNED ("rate not set,
   not in the game yet"), three cells apart, on the tile whose own blurb says
   "Best for a first business". Nothing in the game distinguishes them; the only
   difference was whether a lane on the owner's PDF happened to want that id. The
   same card then printed "Weapon Smith — Metal, Copper Ore LIVE" further down, so
   it contradicted itself. Agri did the same with corn and soybeans against
   wheat, rice, potatoes and vegetables.

   WHY THE CHECK IS NOT A GREP OVER recipes.js. Round four's fix was verified by
   dumping the data, the dump looked right, and the modal still printed a product
   twice — the defect only exists once graph.js has mapped the row and modal.js
   has chosen a sentence for it. So the grouping is computed from the REAL
   OP_ECO_MAP text (not a copy typed here), and the badges are read off the REAL
   public/index.html, through the same door a player uses.

   ⚠ THE PARITY RULE IS PER TILE, NOT PER ID. Two ids in the same `out` list are
   the same kind of thing and must read the same. This says nothing about whether
   the badge should be LIVE or PLANNED — only that a card must pick one and mean
   it. Pinning the ids themselves would go stale the day a sim firm's recipe
   changes; pinning the GROUPING cannot.

   WHAT IT CHECKS, in the order the bar lists them:
     a  every id inside one OP_ECO_MAP `out` list carries the same badge on its
        maker's card, on all 25 ops, not only mining and agri.
     b  no card prints an id as "not in the game yet" among its products while
        printing that same id inside a row it has badged LIVE. Reported twice:
        hard for the ids this piece owns (anything in an `out` list), and as a
        measurement for the rest, because those rows are a lane-level LIVE badge
        in modal.js listing a proposed cargo id and recipes.js cannot fix them
        without either lying about the lane or deleting the owner's cargo.
     c  no product note printed at a player is a repo path, a file name or a
        SHOUTING_SYMBOL. graph.js resolves the note as `cite || why`, so a row
        that sets both prints its cite and silently drops its prose.
     d  the graph still reports zero errors and coverage still covers all 424.

   READ-ONLY, like pw-e2e: it forces offline mode, stubs the first-run gates,
   opens modals and reads text. It signs nothing in, spends nothing, writes no
   repo file and touches no database.

   USAGE
     node tools/supplychain/pw-ores.mjs                 exit 1 on any failure
     node tools/supplychain/pw-ores.mjs --json          + the full report
     node tools/supplychain/pw-ores.mjs --shots <dir>   write the screenshots
     node tools/supplychain/pw-ores.mjs --node-only     skip Chromium (a-d on data)
   Chromium comes from node_modules; the server is node:http on an ephemeral
   port (shoot.mjs), so parallel critics never collide and nothing is installed.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withPage, shot } from './shoot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SRC = path.join(ROOT, 'public/src/supplychain');
const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes('--' + n);
const val = (n, d) => { const i = ARGV.indexOf('--' + n); return (i >= 0 && ARGV[i + 1]) ? ARGV[i + 1] : d; };
const SHOTS = val('shots', null);

const R = { pass: 0, fail: 0, rows: [], notes: {}, shots: [] };
const ok = (cond, what, detail) => {
  const good = !!cond;
  R[good ? 'pass' : 'fail']++;
  R.rows.push({ ok: good, what, detail: detail === undefined ? '' : String(detail) });
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${what}${detail === undefined || detail === '' ? '' : '   ' + detail}`);
  return good;
};
const note = (k, v) => { R.notes[k] = v; };
const few = (a, n) => (a.length > n ? a.slice(0, n).join(' · ') + ' … (+' + (a.length - n) + ')' : a.join(' · '));

/* ── the real OP_ECO_MAP, parsed from the file that owns it ─────────────────
   A copy of the six ore ids in this file would be exactly the thing the bug is
   made of: a second, silently drifting statement of what the game does. Only
   the `out` arrays are read, by brace-matching from the declaration, so a
   comment inside the object (there are several, some of them long) cannot
   confuse it and a new row joins the check by existing. */
function readEcoMap() {
  const txt = fs.readFileSync(path.join(ROOT, 'public/node-city/index.html'), 'utf8').replace(/\r\n/g, '\n');
  const at = txt.indexOf('const OP_ECO_MAP = {');
  if (at < 0) return null;
  let i = txt.indexOf('{', at), depth = 0, end = -1;
  for (let j = i; j < txt.length; j++) {
    const c = txt[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = j; break; } }
  }
  if (end < 0) return null;
  const body = txt.slice(i, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')         // block comments, and there are many
    .replace(/(^|[^:])\/\/.*$/gm, '$1');       // line comments
  const out = {};
  const re = /(\w+)\s*:\s*\{[^{}]*?out\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body))) {
    const ids = m[2].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    if (ids.length) out[m[1]] = ids;
  }
  return Object.keys(out).length ? out : null;
}

/* ── the same bootstrap pw-e2e uses ────────────────────────────────────────
   Duplicated on purpose: pw-e2e.mjs exports nothing (it is a suite, not a
   library) and it belongs to the integration piece, so importing it would make
   this suite fail whenever that one is mid-edit, and editing it to add an
   export would be a piece touching a file it does not own. The cost of the
   copy is that a change to the app's boot has to be made twice; the comment is
   here so the second place is findable.
   App / Profile / render are top-level LEXICAL consts (CLAUDE.md, the globals
   trap), so this MUST be a classic init script — an evaluate() cannot see them. */
const BOOT = (hub) => `
(function () {
  var HUB = ${JSON.stringify(hub)};
  var S = window.__ORES = { forced: 0, errors: [] };
  window.addEventListener('error', function (e) { try { S.errors.push(String((e && e.message) || e)); } catch (_) {} });
  function gates() {
    try {
      if (typeof Profile !== 'undefined' && Profile) {
        if (!Profile.onboarding) Profile.onboarding = {};
        Profile.onboarding.done = true; Profile.onboarding.skipped = true; Profile.onboarding.step = 'complete';
        if (Profile.cloud) Profile.cloud.offlineMode = true;
      }
      if (typeof Onboarding === 'object' && Onboarding) { Onboarding.step = null; Onboarding._forceNew = false; }
    } catch (_) {}
    var ST = { shouldRunOnboarding: false, _mustPickStarter: false, needsStarterPick: false,
               _isWipedNewPlayer: false, _maintenanceOn: false, hasPickedStarter: true };
    Object.keys(ST).forEach(function (k) {
      try {
        if (typeof window[k] === 'function' && !window[k].__ores) {
          var v = ST[k], f = function () { return v; }; f.__ores = true; window[k] = f;
        }
      } catch (_) {}
    });
    try { document.querySelectorAll('.onb-screen').forEach(function (n) { n.remove(); }); } catch (_) {}
    try { var b = document.getElementById('offline-warn-banner'); if (b) b.remove(); } catch (_) {}
    try { var s = document.getElementById('boot-splash'); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (_) {}
  }
  function force() {
    try {
      if (typeof App === 'undefined' || typeof render !== 'function') return;
      gates();
      if (document.getElementById('sc-overlay')) return;   // never re-render under the open map
      App.screen = 'title'; App.titleHub = HUB;
      render(); gates();
      S.forced++; S.ready = true;
    } catch (e) { try { S.errors.push('force: ' + ((e && e.stack) || e)); } catch (_) {} }
  }
  [0, 60, 150, 300, 600, 900, 1400, 2000, 2600, 3200].forEach(function (t) { setTimeout(force, t); });
  setInterval(gates, 150);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', force);
  window.addEventListener('load', force);
})();
`;

/* A player-facing sentence that turns out to be a repo path, a file name or a
   symbol. `[A-Z][A-Z_]{3,}` catches OP_ECO_MAP and OPS_ECON without catching an
   ordinary capitalised word or an acronym as short as PDF.
   `->` is in the bar's own grep and was missing here for a round: it catches a
   note written as an edge ("gas -> transport"), which is how this file talks to
   itself and not how a player reads. */
const LEAK = /public\/|src\/|sql\/|\.js\b|\.html\b|\.mjs\b|[A-Z][A-Z_]{3,}|\w+\(\)|->/;

/* The same grep, minus the bare-SHOUT clause, for a sweep over a WHOLE rendered
   card. The card is full of legitimate all-caps UI: LIVE, PLANNED, PHASE 1,
   CARRIER, YOU OWN IT, and Chromium's innerText applies text-transform, so the
   headings arrive shouting too. Running the strict regex over innerText
   returned 1,663 "leaks", none of them real, which is a check nobody would ever
   read. A leaked SYMBOL always carries an underscore (OP_ECO_MAP, OPS_ECON,
   RESOURCE_IDS, GS_RUN_ID) — that is what separates it from a badge. */
/* ⚠ ROUND SEVEN — `transport.inputs.fuel` IS A SYMBOL AND NOTHING CAUGHT IT.
   A dotted member path has no underscore, no capital and no "()", so it slid
   past every clause above AND past the bar's own grep, and 23 of them reached
   `title=` attributes across 16 cards — modal.js puts a cite into title=
   unconditionally and only gates the VISIBLE span on admin mode, so a screen
   reader was reading "the game's own business table transport.inputs.fuel" to
   somebody. Two dots minimum keeps an ordinary "e.g." out of it. */
const MEMBER_PATH = '\\b[a-z][A-Za-z0-9]*(?:\\.[a-z][A-Za-z0-9]*){2,}\\b'
  + '|\\w\\((?:\'[^\']*\'|"[^"]*")\\)'   // Econ('transport') — a call WITH an argument; `\w+\(\)` only caught the empty one
  + '|\\)\\.[a-z]';                       // …').inputs — the join that made the member path unrecognisable
const LEAK_TEXT = new RegExp('public\\/|src\\/|sql\\/|\\.js\\b|\\.html\\b|\\.mjs\\b|[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}|\\w+\\(\\)|->|' + MEMBER_PATH);

/* ════════════════════════ part A — the data, in node ════════════════════════ */
const ecoMap = readEcoMap();
const { getData } = await import(pathToFileURL(path.join(SRC, 'data.js')).href);
const data = getData();
const { RECIPES, validateRecipes } = await import(pathToFileURL(path.join(SRC, 'recipes.js')).href);
const nodeById = new Map(data.graph.nodes.map((n) => [n.id, n]));

console.log('\n  ⛏ ore parity — the same thing must not be badged two ways\n');
console.log('  ── A. the data');
ok(!!ecoMap, 'OP_ECO_MAP parsed out of public/node-city/index.html', ecoMap ? Object.keys(ecoMap).length + ' firms' : 'NOT FOUND');
ok(ecoMap && (ecoMap.mining || []).length >= 6, 'the mining firm still makes the six ores', ecoMap && (ecoMap.mining || []).join(','));

/* The cross-check recipes.js has always been able to run and nothing has ever
   fed it: every cityFirm claim against the real OP_ECO_MAP. */
const vr = validateRecipes({ ecoMap, ids: data.catalog.all().map((r) => r.id), bizIds: data.businesses.BUSINESSES.map((b) => b.id) });
ok(vr.errors.length === 0, 'validateRecipes() with the REAL ecoMap reports no error', few(vr.errors, 4) || 'clean');

const groups = [];                       // one per OP_ECO_MAP row that a tile makes
if (ecoMap) for (const biz of Object.keys(ecoMap)) {
  const n = nodeById.get(biz);
  if (!n) continue;
  const rows = (n.makes || []).filter((m) => ecoMap[biz].includes(m.id));
  if (rows.length < 2) continue;
  const live = rows.filter((m) => m.live !== false).map((m) => m.id);
  const planned = rows.filter((m) => m.live === false).map((m) => m.id);
  groups.push({ biz, live, planned, split: live.length > 0 && planned.length > 0 });
}
const splitA = groups.filter((g) => g.split);
ok(splitA.length === 0, 'a. no OP_ECO_MAP out-list is split across two badges (data)',
  splitA.length ? splitA.map((g) => g.biz + ': LIVE ' + g.live.join('/') + ' vs PLANNED ' + g.planned.join('/')).join(' | ') : groups.length + ' groups, each uniform');
note('groups', groups);

/* ⚠ EVERY row, not only the planned ones. Round 5 scanned `m.live === false`
   because that is all modal.js happens to render today — a parity check that
   depends on a sibling view choosing not to paint a field is one edit away from
   passing a regression silently (and admin mode already paints more). The six
   plain cityFirm ores carry a cite, so this is scanned in two buckets: a row a
   player can read today must be prose, and a row nobody paints yet is reported
   as a measurement so the day modal.js starts painting it is not a surprise. */
const leakRows = [], leakLatent = [];
for (const n of data.graph.nodes) for (const m of (n.makes || [])) {
  if (!LEAK.test(String(m.note || ''))) continue;
  (m.live === false ? leakRows : leakLatent).push(n.id + '.' + m.id + ': "' + String(m.note).slice(0, 48) + '"');
}
ok(leakRows.length === 0, 'c. no planned product note is a path, a file or a symbol (data)', few(leakRows, 3) || 'all prose');
note('latent-cite-notes-on-live-rows', leakLatent);
console.log('  NOTE ' + leakLatent.length + ' live row note(s) are a cite, not prose — unpainted today, and they are'
  + ' evidence (a cityFirm row proves itself against OP_ECO_MAP); listed so a modal.js that starts painting live notes is caught.');

/* graph.js:740 resolves the on-screen note as `cite || why`, so a row that sets
   BOTH loses its prose without a word. That is a data defect this file owns. */
const bothRows = [];
for (const b of Object.keys(RECIPES)) for (const m of (RECIPES[b].makes || [])) if (m.cite && m.why) bothRows.push(b + '.' + m.id);
ok(bothRows.length === 0, 'c. no makes row sets both a cite and prose (the cite would swallow the prose)', few(bothRows, 4) || 'none');

/* ── b, on the OTHER card ──────────────────────────────────────────────────
   The owner's goal names the hover card FIRST ("hovering over businesses and
   system show a modal"), and for six rounds nothing in this suite looked at it.
   hover.js builds its own makes list and its own per-cargo live flags, so the
   parity proved on the modal said nothing about it — and it was wrong in BOTH
   directions: the Gas Station's card marked Diesel live inside a live chip
   while its own product row called it planned, and the Mining card marked
   Metal DEAD inside the Oil Company chip while its product row called it live,
   because that one lane is planned. hoverVM() is pure, so this costs no
   browser: the check is that no id is badged two ways on one hover card. */
const hover = await import(pathToFileURL(path.join(SRC, 'hover.js')).href);
const hoverSplit = [], hoverLane = [];
for (const n of data.graph.nodes) {
  if (n.type !== 'business') continue;
  let vm = null;
  try { vm = hover.hoverVM(n.id, data); } catch (e) { hoverSplit.push(n.id + ' hoverVM threw: ' + e.message); }
  if (!vm || !Array.isArray(vm.makes)) continue;
  const status = new Map();
  for (const m of vm.makes) status.set(m.id, m.live !== false);
  /* SELLS ONLY, and the difference is not a technicality. On a `sells` chip the
     cargo is THIS tile's own product, so a second badge for it is the card
     disagreeing with itself. On a `bizNeeds` chip the cargo belongs to the tile
     you buy it FROM, and the badge is about that LANE — the Construction card
     really does both make Metal (live) and want Metal off a Mining lane that
     does not run, and the chip says which. Counting those would force the
     wrong fix, so they are measured, not failed. */
  for (const chip of (vm.sells || [])) for (const c of (chip.cargo || [])) {
    if (!status.has(c.id)) continue;                 // not one of this tile's own products
    if (status.get(c.id) !== (c.live !== false)) hoverSplit.push(n.id + '.' + c.id + ' is ' + (status.get(c.id) ? 'LIVE' : 'PLANNED') + ' as a product and ' + (c.live !== false ? 'LIVE' : 'PLANNED') + ' on the ' + chip.id + ' chip');
  }
  for (const chip of (vm.bizNeeds || [])) for (const c of (chip.cargo || [])) {
    if (status.has(c.id) && status.get(c.id) !== (c.live !== false)) hoverLane.push(n.id + '.' + c.id + ' (bought from ' + chip.id + ')');
  }
}
ok(hoverSplit.length === 0, 'b. the HOVER card badges an id the same way everywhere on it', few(hoverSplit, 3) || 'no id badged two ways on any hover card');
note('hover-inbound-lane-differs', hoverLane);
console.log('  NOTE ' + hoverLane.length + ' hover chip(s) show an id a tile also MAKES as dead on an inbound lane'
  + (hoverLane.length ? ' (' + few(hoverLane, 3) + ')' : '') + ' — the lane is what is planned there, not the product.');

const cov = await import(pathToFileURL(path.join(SRC, 'coverage.js')).href);
const unc = cov.uncovered(data.catalog);
ok(data.graph.report.errors.length === 0, 'd. buildGraph() still reports zero errors', data.graph.report.errors.length);
ok((Array.isArray(unc) ? unc.length : unc) === 0, 'd. coverage.uncovered() is still 0 of ' + data.catalog.all().length,
  Array.isArray(unc) ? few(unc, 5) : String(unc));

/* ══════════════════ part B — the badges, on the real page ══════════════════ */
if (!flag('node-only')) {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const nameOf = new Map(data.catalog.all().map((r) => [r.id, r.name]));
  /* The page prints NAMES; the parity groups are ids. Mapping here (once, from
     the generated catalogue) keeps the browser side free of game knowledge. */
  const byName = {};
  if (ecoMap) for (const biz of Object.keys(ecoMap)) byName[biz] = ecoMap[biz].map((id) => nameOf.get(id)).filter(Boolean);
  /* The rows the DATA calls a city firm's product, by the name the page prints.
     Used for the sentence check below: the badge alone cannot tell a cityFirm
     row apart from a proposed one once both are planned. */
  const cityByName = {};
  for (const n of data.graph.nodes) {
    const names = (n.makes || []).filter((m) => m.via === 'cityFirm').map((m) => nameOf.get(m.id)).filter(Boolean);
    if (names.length) cityByName[n.id] = names;
  }
  const tiles = data.businesses.BUSINESSES.filter((b) => b.status !== 'planned').map((b) => b.id);

  await withPage(async (page, t) => {
    t.allowErrors = true;                 // the real page's own console noise is not this suite's verdict
    await page.addInitScript(BOOT('exchange'));

    console.log('\n  ── B. the real public/index.html');
    await t.goto('index.html');
    ok(t.navStatus === null || t.navStatus < 400, 'index.html served', 'HTTP ' + t.navStatus);
    await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 60000 });
    ok(true, 'the module mounted (window.__mg.supplyChain)');

    /* One evaluate per tile would be 25 round trips; one evaluate that walks the
       tiles keeps the suite near pw-e2e's cost. Everything it returns is TEXT
       read off the open modal — no game object is consulted in here, so the
       assertions below are about what a player can see. */
    const cards = await page.evaluate(async (ids) => {
      const out = {};
      const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
      for (const id of ids) {
        window.__mg.supplyChain.open({ select: id });
        let m = null;
        /* Poll instead of one fixed sleep: the modal is rebuilt on every select
           and a single 380 ms wait lost one card in 25 — a flaky miss reads as a
           real failure and is worse than a slow suite. */
        for (let i = 0; i < 40 && !m; i++) {
          await new Promise((r) => setTimeout(r, 50));
          const el = document.querySelector('[data-sc-modal]');
          if (el && el.querySelector('.scm-sec')) m = el;
        }
        if (!m) { out[id] = null; continue; }
        /* ⚠ SECTION 1 ONLY. `.scm-tile` is the card's general resource tile and
           every section uses it — needs, battle loot, partners. A sweep over the
           whole modal reported Medical Supplies as LIVE and PLANNED on one card,
           which was two different sections agreeing perfectly. The first
           .scm-sec is "What it makes", and the buyer chips live inside it. */
        const sec = m.querySelector('.scm-sec');
        const products = Array.from(sec.querySelectorAll('.scm-grid > .scm-tile')).map((el) => {
          const metas = Array.from(el.querySelectorAll('.m')).map(txt);
          return {
            name: txt(el.querySelector('.t b')),
            planned: el.classList.contains('planned') || !!el.querySelector('.scm-tag.planned'),
            rate: metas[0] || '',
            note: metas[1] || '',
          };
        });
        /* Past the 24-product cap the rest are chips behind "Show all"; they
           carry the same badge and the resource id in the title attribute. */
        for (const el of sec.querySelectorAll('[data-more] .scm-res')) {
          products.push({ name: txt(el.querySelector('span:not(.ic)')), planned: el.classList.contains('planned'), rate: '', note: '', overflow: true });
        }
        const chips = Array.from(sec.querySelectorAll('.scm-buyer')).map((el) => ({
          label: txt(el).replace(txt(el.querySelector('.held')), '').replace(/LIVE|PLANNED/g, '').trim(),
          cargo: txt(el.querySelector('.held')),
          live: !el.classList.contains('planned'),
        }));
        /* The WHOLE card as a player reads it, plus every tooltip. Clause (c) used
           to look only at the note field of a planned product row; a leak can
           reach the screen from any painter on the card, so the grep is run over
           the lot. Tooltips count: a title= is read aloud by a screen reader. */
        /* ⚠ SECTION 1 ONLY ends here. Everything below reads the WHOLE modal,
           because the bar is about what a player sees ANYWHERE on the card and
           a suite scoped to section 1 structurally cannot go red on a defect
           that lives in section 2 — which is exactly how this file reported
           ALL GREEN on a Mining card that printed five of the six ores in its
           "what works today vs planned" ledger and dropped Zinc Ore. The
           section-1 scoping is kept for the PRODUCT-TILE checks (a resource
           tile is reused by needs, loot and partners, and a whole-modal sweep
           there compared two different sections and cried wolf); ledger rows
           are unambiguous — one <li>, one badge, one sentence — so they are
           collected from every .scm-sec. */
        const ledger = [];
        for (const sc of m.querySelectorAll('.scm-sec')) {
          /* The section's own heading travels with its rows. Section 6 uses the
             same <ul class="scm-ledger"> for route legs — "To Medical Corp.:
             🧵 Cloth" is a LABEL, correctly, and a blind whole-modal sentence
             check would have failed on it. Widening the sweep is not the same
             as flattening it: every section is read, and each assertion says
             which heading it is about. */
          const head = txt(sc.previousElementSibling && sc.previousElementSibling.tagName === 'H3' ? sc.previousElementSibling : sc.querySelector('h3'));
          for (const li of sc.querySelectorAll('.scm-ledger li')) {
            const tg = li.querySelector('.scm-tag');
            /* `.why` is the provenance line, painted UNDER the sentence in its
               own block — reading it as part of the sentence produced
               "…found today.owner’s map, page 6". The sentence is the li's own
               text with the badge and the cite block removed. */
            const why = txt(li.querySelector('.why'));
            let text = txt(li).replace(/^(LIVE|PLANNED)\s*/, '');
            if (why) text = text.split(why).join(' ').replace(/\s+/g, ' ').trim();
            ledger.push({ head, text, live: !!tg && tg.classList.contains('live') });
          }
        }
        out[id] = {
          products, chips, ledger, head: txt(m).slice(0, 70),
          text: (m.innerText || m.textContent || '').replace(/\s+/g, ' ').trim(),
          titles: Array.from(m.querySelectorAll('[title]')).map((el) => el.getAttribute('title')).filter(Boolean),
        };
      }
      return out;
    }, tiles);

    const seen = Object.keys(cards).filter((k) => cards[k]);
    ok(seen.length === tiles.length, 'every live tile opened a modal', seen.length + '/' + tiles.length);

    /* a — the bar's first half, measured on the screen rather than in the data. */
    const splitB = [];
    for (const biz of Object.keys(byName)) {
      const card = cards[biz]; if (!card) continue;
      const rows = card.products.filter((p) => byName[biz].includes(p.name));
      if (rows.length < 2) continue;
      const live = rows.filter((p) => !p.planned).map((p) => p.name);
      const plan = rows.filter((p) => p.planned).map((p) => p.name);
      if (live.length && plan.length) splitB.push(biz + ': ' + live.join('/') + ' LIVE vs ' + plan.join('/') + ' PLANNED');
    }
    ok(splitB.length === 0, 'a. no card badges one OP_ECO_MAP out-list two ways', splitB.join(' | ') || 'uniform on every card');

    /* The sentence itself, not only the badge. Not every row in an out-list has
       to read alike — a tile that both YIELDS an id hourly and has a sim firm
       making it is telling the truth twice over, which is why fishing prints a
       rate for its fish and the city sentence for its seafood. What must read
       alike is the rows the data says are the same kind: every cityFirm row on
       one tile. That is the bug in one line, and the badge check above cannot
       see it (all six could read LIVE with two different sentences). */
    const sentSplit = [];
    for (const biz of Object.keys(cityByName)) {
      const card = cards[biz]; if (!card) continue;
      const rows = card.products.filter((p) => cityByName[biz].includes(p.name) && !p.overflow);
      const kinds = Array.from(new Set(rows.map((p) => p.rate)));
      if (rows.length >= 2 && kinds.length > 1) sentSplit.push(biz + ': ' + kinds.map((k) => '"' + k.split(' · ')[0] + '"').join(' vs '));
    }
    ok(sentSplit.length === 0, 'a. …and every city-firm row on one tile reads the same sentence', sentSplit.join(' | ') || 'one sentence per tile');

    /* a-2 — THE SAME CLAUSE, ONE SECTION LOWER. "Every id that OP_ECO_MAP
       actually produces carries the same badge and the same kind of
       explanatory line as every other such id on that tile" is not a statement
       about section 1; it is a statement about the card. Section 2 is the one
       headed "what works today vs planned", so an out-list id missing from it
       while its five siblings are named there is the bar's own failure. */
    const ledgerGap = [];
    for (const biz of Object.keys(byName)) {
      const card = cards[biz]; if (!card || !card.ledger) continue;
      const makes = card.ledger.filter((r) => /^(Makes|Would make) /.test(r.text));
      if (!makes.length) continue;
      const missing = byName[biz].filter((n) => !makes.some((r) => r.text.includes(n)));
      if (missing.length) ledgerGap.push(biz + ': ' + missing.join('/') + ' named nowhere in section 2');
      /* …and named the SAME WAY: an out-list whose ids are split across a LIVE
         line and a PLANNED line in this ledger is the round-2 defect again. */
      const badge = {};
      for (const n of byName[biz]) for (const r of makes) if (r.text.includes(n)) badge[n] = badge[n] === undefined ? r.live : (badge[n] && r.live);
      const vals = Object.values(badge);
      if (vals.length > 1 && new Set(vals).size > 1) ledgerGap.push(biz + ': section 2 badges one out-list two ways');
    }
    ok(ledgerGap.length === 0, 'a. …and section 2 names EVERY id of an out-list, identically', ledgerGap.join(' | ') || 'no out-list id dropped from any ledger');

    /* Every note a player sees is a sentence, not a symbol and a repo path —
       the second half of the bar, applied to the ledger. `Makes Naphtha
       through .` passed every check above because it is prose, is badged LIVE
       and leaks no path; it is still not a sentence. */
    const stutter = [];
    for (const biz of Object.keys(cards)) {
      const card = cards[biz]; if (!card || !card.ledger) continue;
      /* Scoped BY HEADING, not by section index: section 6's route legs live in
         the same <ul> and are labels on purpose ("To Medical Corp.: 🧵 Cloth").
         The heading travels with each row precisely so this check can say which
         section it speaks for instead of failing on a correct label. */
      for (const r of card.ledger) {
        if (!/works today/i.test(r.head)) continue;
        if (/\s(through|from|by|in|at)\s*\.\s*$/.test(r.text) || !/[.!?…]$/.test(r.text.trim())) stutter.push(biz + ': "' + r.text.slice(0, 64) + '"');
      }
    }
    /* A check that reads nothing passes for free — the exact failure mode this
       round is fixing. The row count is asserted, not merely printed. */
    let stutterSeen = 0;
    for (const biz of Object.keys(cards)) for (const r of ((cards[biz] && cards[biz].ledger) || [])) if (/works today/i.test(r.head)) stutterSeen++;
    ok(stutterSeen > 20, 'a. …the sentence check actually read section 2 on every card', stutterSeen + ' ledger rows under a "works today" heading');
    ok(stutter.length === 0, 'a. …and every ledger row on every card is a finished sentence', few(stutter, 3) || 'all ' + stutterSeen + ' sentences');

    /* 🔴 THE TWO HALVES OF A CARD MUST NOT DISAGREE ABOUT A PHANTOM.
       This suite read section-2 row TEXT but never the phantom behind the row,
       so it was 20/0 while the Oil card printed "Makes Fuel and Gun Oil
       through the hourly operation." under a LIVE badge, three inches under
       section 1's "no resource with that id exists in the game". The phantom
       is identified from the RENDERED card (the note section 1 paints), not
       from a hard-coded id, so a second phantom is covered the day it appears.
       A ledger row may name a phantom only while carrying the clause that says
       it is one. */
    const phantomSeen = [], phantomBad = [];
    for (const biz of seen) {
      const card = cards[biz]; if (!card) continue;
      const ghosts = card.products.filter((p) => /no such resource exists|no resource with that id exists/i.test(p.note)).map((p) => p.name).filter(Boolean);
      if (!ghosts.length) continue;
      phantomSeen.push(biz + ':' + ghosts.join('/'));
      for (const r of card.ledger) {
        if (!/works today/i.test(r.head)) continue;
        for (const g of ghosts) {
          if (r.text.indexOf(g) < 0) continue;
          if (!/no such resource exists|no resource with that id exists|never reaches a stash/i.test(r.text)) phantomBad.push(biz + ': "' + r.text.slice(0, 80) + '"');
        }
      }
    }
    ok(phantomSeen.length > 0, 'c. the phantom check actually found a phantom to check', phantomSeen.join(' | ') || 'NO phantom product rendered anywhere — the check proved nothing');
    ok(phantomBad.length === 0, 'c. …and no section-2 sentence names a phantom without saying it is one', few(phantomBad, 3) || 'every phantom mention carries its clause');

    /* Every note a player sees is a sentence, not a symbol — and a tooltip IS a
       note: a screen reader reads title= aloud. The fallback used to be the raw
       id, so hovering Zinc Ore on the very tile this suite is named after
       answered "zincOre". A symbol here is one token with no space and no
       sentence punctuation. */
    const badTitles = new Set(); let titleSeen = 0;
    for (const biz of seen) {
      for (const t of ((cards[biz] && cards[biz].titles) || [])) {
        titleSeen++;
        if (/^[A-Za-z][A-Za-z0-9_]*$/.test(t.trim())) badTitles.add(biz + ': title="' + t.trim() + '"');
      }
    }
    ok(titleSeen > 100, 'd. the tooltip check actually read tooltips', titleSeen + ' title attributes across ' + seen.length + ' cards');
    ok(badTitles.size === 0, 'd. …and no tooltip is a bare id', few([...badTitles], 4) || 'all ' + titleSeen + ' tooltips are prose');

    /* b — ONE HARD CHECK, whoever has to fix it.
       🔴 Round 5 split this in two and failed only on the half recipes.js owns,
       printing the other half as a NOTE. The suite was green while the bar
       clause it is named after was red on six rows over four cards — the
       confident-wrong-green CLAUDE.md warns about, and the exact defect class
       this suite exists to kill, on the same cards, in the same section. A gate
       that cannot go red on the bug is not a gate. The split is kept, but only
       as the detail line that says WHICH file has to change: an id inside an
       out-list is recipes.js's (badge parity), anything else is modal.js's
       (a lane-level LIVE chip printing a per-id-planned cargo name — graph.js
       already carries the split as `liveIds`; see sc/handoff/modal-liveids.md). */
    const contraOwned = [], contraOther = [];
    for (const biz of seen) {
      const card = cards[biz];
      const planned = new Set(card.products.filter((p) => p.planned).map((p) => p.name));
      if (!planned.size) continue;
      const mine = new Set(byName[biz] || []);
      for (const c of card.chips) {
        if (!c.live) continue;
        for (const nm of c.cargo.split(',').map((s) => s.replace(/^[^\w]*\s*/, '').trim()).filter(Boolean)) {
          if (!planned.has(nm)) continue;
          (mine.has(nm) ? contraOwned : contraOther).push(biz + ': "' + nm + '" is PLANNED above and inside the LIVE ' + c.label + ' row');
        }
      }
    }
    const contraAll = contraOwned.concat(contraOther);
    ok(contraAll.length === 0, 'b. no card prints an id as "not in the game yet" and inside a LIVE row at once',
      contraAll.length
        ? contraAll.length + ' on ' + new Set(contraAll.map((s) => s.split(':')[0])).size + ' card(s) — '
          + few(contraAll, 3) + '  [recipes.js owes ' + contraOwned.length + ', modal.js owes ' + contraOther.length + ']'
        : 'none');
    note('contradictions', { ownedByRecipes: contraOwned, ownedByModal: contraOther });

    /* c — the whole card as printed, not one field of one kind of row. */
    const leakB = [];
    for (const biz of seen) {
      for (const p of cards[biz].products) if (p.note && LEAK.test(p.note)) leakB.push(biz + '.' + p.name + ': "' + p.note.slice(0, 60) + '"');
      for (const t of cards[biz].titles) if (LEAK_TEXT.test(t)) leakB.push(biz + ' title=: "' + t.slice(0, 60) + '"');
      /* The innerText grep is per SENTENCE, so one hit points at the sentence a
         player would read rather than at "the card". */
      for (const s of cards[biz].text.split(/(?<=[.·])\s+/)) if (s.length > 3 && LEAK_TEXT.test(s)) leakB.push(biz + ' text: "' + s.slice(0, 60) + '"');
    }
    ok(leakB.length === 0, 'c. nothing printed on a card is a path, a file, a symbol or an arrow', few(leakB, 3) || 'all prose, on every card');

    /* The tooltip layer, printed rather than merely asserted. modal.js puts a
       cite into `title=` unconditionally and gates only the VISIBLE span on
       admin mode, so a screen reader reads every one of these aloud to a player
       who can see none of them — a surface no screenshot can show and no critic
       found by looking. Listing them is how the next round checks the claim
       instead of taking it. */
    const allTitles = new Set();
    for (const biz of seen) for (const t of cards[biz].titles) allTitles.add(t);
    note('titles', Array.from(allTitles));
    console.log('  NOTE ' + allTitles.size + ' distinct title= tooltip(s) across ' + seen.length + ' cards; 0 leak.'
      + (flag('titles') ? '\n' + Array.from(allTitles).map((t) => '        · ' + t).join('\n') : ' (--titles to print them)'));

    /* ── the click path itself, with a real mouse ────────────────────────────
       Everything above drives window.__mg.supplyChain.open({select}). That is
       the right door for 25 cards in one page load, but it proves nothing about
       the door a PLAYER uses: a dead click handler would leave this suite green.
       So one card is opened by moving the mouse and pressing it on a real
       element. The 3D scene hit-tests on a canvas and exposes no per-tile DOM
       node, so the handle is whichever of these the shell actually renders —
       fallback.js's [data-sc-node] tile, or a [data-pick="node"] chip. */
    /* ⚠ close() tears down the WHOLE overlay, not just the card. Probing after it
       found zero .sc-row and zero [data-tab] and read as "there is no DOM handle" —
       which is how round 5 concluded the click path could not be tested at all.
       Reopen the map with no selection, the way the hub tile does. */
    await page.evaluate(() => { window.__mg.supplyChain.close(); (window.openSupplyChain || (() => {}))(); });
    await page.waitForTimeout(900);
    /* The rail lives behind the Businesses tab, so the first real click is the tab
       itself — which is the honest sequence anyway: this is what a player does. */
    /* ⚠ RETRY, do not wait a fixed 400 ms. A single click + sleep landed the tab
       aria-selected=false on one run in three (33 rail rows present, 0 visible) and
       reported "no handle" — a flaky miss reads as a real failure and is worse than a
       slow suite, which is the same lesson the modal poll above learned. */
    for (let i = 0; i < 6; i++) {
      await page.click('[data-tab="businesses"]', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(350);
      const ready = await page.evaluate(() => { const r = document.querySelector('.sc-row[data-row="mining"]'); return !!(r && r.offsetParent !== null); });
      if (ready) break;
    }
    const handle = await page.evaluate(() => {
      /* `.sc-row[data-row]` is the shell's own rail — the handle round 5 missed,
         which is why it concluded there was no DOM handle at all. The 3D map
         hit-tests on a canvas, so the rail row IS the player's DOM door. */
      const sels = ['.sc-row[data-row="mining"]', '[data-sc-node="mining"]', '[data-pick="node"][data-id="mining"]', '[data-node="mining"]', '.sc-row[data-row]', '[data-sc-node]'];
      for (const s of sels) { const el = document.querySelector(s); if (el && el.offsetParent !== null) return { sel: s, id: el.dataset.row || el.dataset.scNode || el.dataset.id || el.dataset.node || '?' }; }
      /* When nothing is clickable, say WHY — a bare "no handle" sent round 5 to the
         wrong conclusion (there IS a rail; it was behind a tab). */
      const seen = {};
      for (const s of ['.sc-row', '[data-tab]', '[data-sc-node]', '[data-pick]']) {
        const all = document.querySelectorAll(s);
        seen[s] = all.length + ' (' + Array.from(all).filter((e) => e.offsetParent !== null).length + ' visible)';
      }
      return { miss: seen, tab: (document.querySelector('[data-tab="businesses"]') || {}).ariaSelected };
    });
    if (!handle || handle.miss) {
      ok(false, 'a real mouse click on a tile opens its modal',
        'NO VISIBLE DOM HANDLE — ' + JSON.stringify(handle && handle.miss) + ' businesses-tab aria-selected=' + (handle && handle.tab));
    } else {
      await page.click(handle.sel, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(700);
      const opened = await page.evaluate(() => {
        const el = document.querySelector('[data-sc-modal]');
        return el && el.querySelector('.scm-sec') ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : null;
      });
      ok(!!opened, 'a real mouse click on a tile opens its modal', handle.sel + ' → ' + (opened || 'NOTHING OPENED'));
      if (SHOTS && opened) R.shots.push(await shot(page, path.join(SHOTS, 'click-opened.png')));
      await page.evaluate(() => window.__mg.supplyChain.close());
    }

    /* The cards the owner will open first, plus gas — the worst (b) offender:
       Diesel PLANNED in the top row and inside three LIVE chips a few
       centimetres below, all on one screen. The bar names these files, so they
       are written under the bar's names and nowhere else. */
    for (const id of ['mining', 'agri', 'gas', 'cars', 'construction']) {
      const card = cards[id];
      if (!card) continue;
      console.log('\n  ' + id + ' — ' + card.products.length + ' products');
      for (const p of card.products) console.log('     ' + (p.planned ? 'PLANNED' : 'LIVE   ') + ' ' + p.name.padEnd(20) + ' ' + p.rate);
      for (const c of card.chips) console.log('     chip ' + (c.live ? 'LIVE   ' : 'PLANNED') + ' ' + c.label + ' — ' + c.cargo);
      note(id, card.products);
      if (SHOTS) {
        await page.evaluate((b) => window.__mg.supplyChain.open({ select: b }), id);
        await page.waitForTimeout(400);
        R.shots.push(await shot(page, path.join(SHOTS, 'modal-' + id + '.png')));
      }
    }
    await page.evaluate(() => window.__mg.supplyChain.close());
  }, { w: 1500, h: 1000 });
}

console.log('\n  ' + (R.fail ? '❌ ' + R.fail + ' FAILED' : '✅ all green') + '  (' + R.pass + ' passed)');
if (flag('json')) console.log(JSON.stringify(R, null, 2));
process.exit(R.fail ? 1 : 0);
