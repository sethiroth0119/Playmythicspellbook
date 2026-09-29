/* ═══════════════════════════════════════════════════════════════════════════
   🚗 pw-carmarket — section 6 ("Best businesses to work with") must not open
   with anti-partners, on every system and channel card, in the REAL page.

   WHY THIS SUITE EXISTS. `bestPartners()` ranked the Car Marketplace's card
   Car Dealer, Oil Company, Gas Station, Agricultural Op., Home Feed — and the
   last four said only "X is marked for this market, but only vehicles trade
   here; its fuel sells on the Marketplace instead". Empty cargo, nothing to
   act on. The tiles a player can actually deal with (Car Factory, the Battle
   System, the City Builder, Salvage) were ranks 7-10, and modal.js cuts the
   list at MODAL.maxPartners = 6, so the whole section was unusable as advice.
   A node one-liner can prove the ORDER; only the page can prove what a player
   READS, because modal.js calls bestPartners() with no limit and slices the
   six itself. So this suite measures the rendered card.

   THE BAR, measured here:
     (a) on every one of the 6 system/channel cards, no VISIBLE partner row has
         an empty cargo chip list paired with a "…only vehicles trade here…" /
         "…sells on the Marketplace instead" reason;
     (b) the Car Marketplace's visible six are exactly Car Dealer, Car Factory,
         Transport, Battle System, City Builder and Salvage Operation (any
         order);
     (c) the four corrections are NOT deleted — they are still on the card's
         full list, below the fold, and the header still counts them
         ("top 6 of 10");
     (d) 🔴 the combined sentence that stands in for them is DRAWN. Round 10
         passed (a)-(c) with pins that read bestPartners()'s return value inside
         page.evaluate, and the player saw nothing at all: modal.js paints
         rows[] and has no expand control, so the four were unreachable while
         section 7 still said "use the tow-truck icon as your guide". (d) reads
         the DOM — section 6's own text, on ch:carmarket and on oil.
   (a) is then re-run over all 33 nodes through the module's own data, in the
   page, so a tile card cannot regress the same way unseen.

   READ-ONLY. It forces Profile.cloud.offlineMode, stubs the first-run gates
   and navigates. It signs nothing in, buys nothing, writes no repo file and
   touches no database; the map's bridge has no spendGems / addGems / rpc.

   USAGE
     node tools/supplychain/pw-carmarket.mjs                 exit 1 on failure
     node tools/supplychain/pw-carmarket.mjs --json          + the full report
     node tools/supplychain/pw-carmarket.mjs --shots <dir>   write the PNGs
   One Chromium page, 1600x900, from node_modules; the server is node:http on
   an ephemeral port (shoot.mjs), so parallel critics never collide.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { withPage, shot } from './shoot.mjs';

const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes('--' + n);
const val = (n, d) => { const i = ARGV.indexOf('--' + n); return (i >= 0 && ARGV[i + 1]) ? ARGV[i + 1] : d; };
const SHOTS = val('shots', null);

/* The sentence this suite is hunting. Kept as ONE regex so the assertion, the
   report and the below-the-fold check cannot drift apart. It is deliberately
   the player-facing wording, not a flag: a future rewrite that says the same
   thing in new words must still be caught by the cargo test beside it.

   🔴 ROUND 12 — this is no longer only a RANKING smell, it is a FALSE CLAIM,
   and it must not appear anywhere on the card at any rank. Section 1 of
   ch:carmarket renders fifteen live rows ("Fuel — listed by Oil Company", …)
   because recipes.js derives a sellsTo edge from the drawn tow truck; a card
   that lists a product against this market and then says the product does not
   trade here contradicts itself on one screen. And the map's legend
   (businesses.js PDF.iconRule) says an icon means the tile NEEDS that market to
   earn — it never said the tile makes that market's goods, so "makes no
   vehicle" rebuts a claim nobody made. Hence FALSE_CLAIM is now swept over the
   WHOLE card text, not just the visible rows. */
const CORRECTION = /only vehicles trade (here|there)|sells? on the Marketplace instead|sell on the Marketplace instead/i;
const FALSE_CLAIM = /only vehicles trade (here|there)|sells? on the Marketplace instead|sell on the Marketplace instead|makes? no vehicle|make no vehicle|none of it is a vehicle/i;
/* What the four demoted rows must say INSTEAD: the legend's own reading. */
const MARK_EXPLAINED = /tow-truck mark|needs? to earn|need to earn/i;

/* The six cards the map's own filter bar counts. */
const CARDS = ['ch:carmarket', 'ch:market', 'sys:battle', 'sys:business', 'sys:city', 'sys:camp'];
/* (b): who must be readable on the Car Marketplace's card. Ids, not labels —
   a label is copy and may be reworded; an id is the contract. */
const CARMARKET_SIX = ['cars', 'carfactory', 'transport', 'sys:battle', 'sys:city', 'salvage'];

/* ── the bootstrap ──────────────────────────────────────────────────────────
   Same shape as pw-e2e.mjs and for the same reason: App / Profile / render are
   top-level LEXICAL consts in index.html, so this MUST be a classic init
   script — an ES module (and page.evaluate, which is one in effect) cannot see
   them. Stubbing the first-run PREDICATES changes which screen we land on and
   nothing about how the card is drawn. */
const BOOT = `
(function () {
  var S = window.__CM = { forced: 0, errors: [] };
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
        if (typeof window[k] === 'function' && !window[k].__cm) {
          var v = ST[k], f = function () { return v; }; f.__cm = true; window[k] = f;
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
      /* Never re-render under an open overlay: that is a real failure mode and
         it looks exactly like the map losing its host. */
      if (document.getElementById('sc-overlay')) return;
      App.screen = 'title'; App.titleHub = 'exchange';
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

/* ── the tiny assertion harness ─────────────────────────────────────────────
   Never throws on a red: a suite that stops at the first failure tells you one
   thing per run, and this one costs a Chromium launch. */
const R = { pass: 0, fail: 0, rows: [], notes: {}, shots: [] };
const ok = (cond, what, detail) => {
  const good = !!cond;
  R[good ? 'pass' : 'fail']++;
  R.rows.push({ ok: good, what, detail: detail === undefined ? '' : String(detail) });
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${what}${detail === undefined || detail === '' ? '' : '   ' + detail}`);
  return good;
};
const note = (k, v) => { R.notes[k] = v; };

/* Errors the MAP is responsible for. The real index.html talks to Supabase and
   loads art, so its console is noisy for reasons that are not ours. */
const MINE = /supplychain|SupplyChainBridge|MythicSupplyChain|sc-overlay|openSupplyChain/i;

/* ── read one rendered card ─────────────────────────────────────────────────
   In ONE pass so the read cannot straddle a re-render: open the node, wait for
   the modal to carry that node, then scrape section 6 exactly as it is drawn
   (the buttons modal.js writes, their chips and their <p> reasons). */
async function readCard(page, id) {
  await page.evaluate((nid) => { window.__mg.supplyChain.open({ select: nid }); }, id);
  await page.waitForFunction(() => !!document.querySelector('[data-sc-modal] .scm-partner'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const m = document.querySelector('[data-sc-modal]');
    if (!m) return { present: false };
    /* section 6's own <h3> carries the "top N of M" count modal.js prints */
    let head = '';
    for (const h of m.querySelectorAll('h3')) if (/Best businesses to work with/i.test(h.textContent || '')) head = (h.textContent || '').replace(/\s+/g, ' ').trim();
    const rows = [...m.querySelectorAll('.scm-partner')].map((b) => ({
      id: b.getAttribute('data-id') || '',
      rank: (b.querySelector('.r') || {}).textContent || '',
      label: ((b.querySelector('.nm') || {}).textContent || '').trim(),
      chips: b.querySelectorAll('.scm-chips .scm-res').length,
      reasons: [...b.querySelectorAll('p')].map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    }));
    /* Round 11: the pins below assert on what is DRAWN, so the card's own text
       is part of the read. `secText` is section 6 alone (the section a reader
       judges partners by); `cardText` is the whole modal, for the weaker claim
       "the mark is explained SOMEWHERE on the card". Both are whitespace
       -flattened so a line break inside a <p> cannot hide a match. */
    const flat = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
    let sec = m.querySelector('section[data-sec="partners"]');
    if (!sec) for (const h of m.querySelectorAll('h3')) if (/Best businesses to work with/i.test(h.textContent || '')) sec = h.closest('section') || h.parentNode;
    return { present: true, head, rows, secText: flat(sec), cardText: flat(m), title: ((m.querySelector('h2') || {}).textContent || '').trim() };
  });
}

/* Section 6 as a photograph: scroll its heading to the top of the scroller so
   the six rows are the frame, not a strip at the bottom of a long card. */
async function shootPartners(page, id, name) {
  if (!SHOTS) return null;
  await page.evaluate(() => {
    const m = document.querySelector('[data-sc-modal]');
    if (!m) return;
    for (const h of m.querySelectorAll('h3')) {
      if (!/Best businesses to work with/i.test(h.textContent || '')) continue;
      h.scrollIntoView({ block: 'start' });
      /* the modal's tab bar is sticky, so scrollIntoView parks the heading (and
         its "top 6 of 10" count, which is half the proof) UNDER it. Back the
         scroller off by the bar's own height rather than a guessed constant. */
      let sc = h.parentNode;
      while (sc && sc !== document.body && sc.scrollHeight <= sc.clientHeight + 2) sc = sc.parentNode;
      const bar = m.querySelector('nav, [role="tablist"], .scm-tabs');
      /* …and back off the heading's own height too, so "top 6 of 10" — the
         proof that the four corrections were demoted and not deleted — is in
         the frame with the six rows. */
      if (sc && sc.scrollBy) sc.scrollBy(0, -((bar ? bar.getBoundingClientRect().height : 0) + h.getBoundingClientRect().height + 12));
      return;
    }
  });
  await page.waitForTimeout(200);
  const abs = await shot(page, path.join(SHOTS, name + '.png'));
  R.shots.push(abs);
  return abs;
}

async function main() {
  await withPage(async (page, t) => {
    t.allowErrors = true;                       // the real page is noisy; MINE is the filter
    await page.addInitScript(BOOT);

    console.log('  ── the page');
    await t.goto('index.html');
    ok(t.navStatus === null || t.navStatus < 400, 'index.html served', 'HTTP ' + t.navStatus);
    await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 60000 });
    ok(true, 'the module mounted (window.__mg.supplyChain exists)');

    /* ══ 1. the Car Marketplace card, as a player reads it ═══════════════ */
    console.log('  ── 1. the Car Marketplace card');
    const cm = await readCard(page, 'ch:carmarket');
    ok(cm.present && cm.rows.length > 0, 'the Car Marketplace card drew section 6', cm.rows.length + ' rows');
    note('carmarket', cm);
    const visible = cm.rows.map((r) => r.id);
    const missing = CARMARKET_SIX.filter((x) => !visible.includes(x));
    const extra = visible.filter((x) => !CARMARKET_SIX.includes(x));
    ok(!missing.length && !extra.length,
      'the visible six are Car Dealer, Car Factory, Transport, Battle System, City Builder and Salvage',
      visible.join(', ') + (missing.length ? '  MISSING: ' + missing.join(', ') : '') + (extra.length ? '  EXTRA: ' + extra.join(', ') : ''));

    /* the exact defect: a row whose only content is the icon correction */
    const antiOn = (card) => card.rows.filter((r) => !r.chips && r.reasons.some((x) => CORRECTION.test(x)));
    const anti = antiOn(cm);
    ok(!anti.length, 'no visible row on it is a bare "marked here but does not trade here" correction',
      anti.length ? anti.map((r) => r.rank + ':' + r.id).join(' ') : 'none');
    await shootPartners(page, 'ch:carmarket', 'carmarket-partners');

    /* ══ 2. the corrections are NOT deleted ═════════════════════════════ */
    console.log('  ── 2. the tow-truck mark is still explained');
    /* The header modal.js prints is the player's own signal that the list runs
       longer than the fold ("top 6 of 10"). Read the full list out of the
       module, in the page, and require the four to be in it, below the fold,
       each still saying what the mark means. */
    const kept = await page.evaluate(async () => {
      const mod = await import('/src/supplychain/partners.js');
      const d = (await import('/src/supplychain/data.js')).getData();
      const rows = mod.bestPartners('ch:carmarket', d);
      return {
        total: rows.length,
        below: rows.filter((r) => r.rank > 6).map((r) => ({ id: r.id, rank: r.rank, markOnly: !!r.markOnly, reason: (r.reasons || [])[0] || '' })),
        foldLine: (rows.find((r) => r.foldLine) || {}).foldLine || null,
        foldIds: (rows.find((r) => r.foldIds) || {}).foldIds || null,
      };
    });
    note('kept', kept);
    /* Round 11 required these four rows to carry the OLD correction wording.
       That wording was false (see FALSE_CLAIM above), so the pin now requires
       what replaced it: each of the four still explains its tow truck, in the
       legend's terms, below the fold. The ink is kept; the false claim is not. */
    const corrected = kept.below.filter((r) => MARK_EXPLAINED.test(r.reason)).map((r) => r.id);
    ok(['oil', 'gas', 'agri', 'feed'].every((x) => corrected.includes(x)),
      'Oil, Gas, Agricultural Op. and Home Feed still explain their tow truck, below the fold', corrected.join(', '));
    const lied = kept.below.filter((r) => FALSE_CLAIM.test(r.reason)).map((r) => r.id);
    ok(!lied.length, 'and none of them says the market refuses their goods', lied.join(', ') || 'none');
    ok(/top 6 of 10/.test(cm.head), 'the card tells the player the list runs longer than the six', cm.head);
    ok(!!kept.foldLine && !CORRECTION.test(kept.foldLine),
      'the four are also summarised as ONE combined line', kept.foldLine || '(none)');

    /* 🔴 THE PIN THAT ROUND 10 DID NOT HAVE. The two assertions above read the
       MODULE. They were green while the player saw nothing: modal.js paints
       rows[] and never touched `foldLine`, so ranks 7-10 were not below a fold,
       they were unreachable, and the only tow-truck sentence left on the card
       was section 7 telling the reader to use an icon section 6 no longer
       mentioned. These two read the DOM instead, and they are the ones that
       matter. Section 6 first (where a reader looks for it), then the whole
       card (the bar's own wording: "still explained somewhere on the card"). */
    ok(!!kept.foldLine && cm.secText.includes(kept.foldLine),
      'the combined line is DRAWN inside section 6 itself', kept.foldLine ? cm.secText.slice(-200) : '(no fold line)');
    ok(['Oil Company', 'Gas Station', 'Agricultural Op.', 'Home Feed'].every((n) => cm.secText.includes(n)),
      'all four tow-truck tiles are named in section 6 as a player reads it',
      ['Oil Company', 'Gas Station', 'Agricultural Op.', 'Home Feed'].filter((n) => !cm.secText.includes(n)).join(', ') || 'all four');

    /* ══ 2b. 🔴 the combined line must be TRUE of every tile it names ══════
       Round 13 made the aside's why-clause survive the character cut, and that
       is exactly what put a FALSE sentence on this card: the clause named the
       first goods of a UNION over all four tiles — a union headed by the Oil
       Company's twenty fuel ids — so the card told a player that Agricultural
       Op.'s and Home Feed's FUEL is what vehicles keep selling. They make food
       and animal feed. 26/26 pins were green, because every pin above asks
       only that the line is DRAWN and is not the old correction; nothing asked
       whether it is true. This one does, against recipes.makesOf() per sunk
       tile, so a future rewrite of the why-ladder cannot re-break it silently.
       It reads only the clause AFTER the meaning separator ("; " / " — "),
       which is where goods are named — tile labels live before it and must not
       be matched against the catalogue. */
    const foldTruth = await page.evaluate(async () => {
      const mod = await import('/src/supplychain/partners.js');
      const rec = await import('/src/supplychain/recipes.js');
      const cat = await import('/src/supplychain/catalog.js');
      const d = (await import('/src/supplychain/data.js')).getData();
      const out = { checked: [], violations: [] };
      for (const nodeId of d.graph.nodes.map((n) => n.id)) {
        const rows = mod.bestPartners(nodeId, d);
        const f = rows.find((r) => r.foldLine);
        if (!f) continue;
        const sunk = f.foldIds || [];
        const cut = Math.max(f.foldLine.indexOf('; '), f.foldLine.indexOf(' — '));
        const clause = cut < 0 ? '' : f.foldLine.slice(cut);
        if (!clause) continue;
        /* a TILE-voice line speaks for the one tile whose card it is, so the
           tile to check is the card itself; a CHANNEL-voice line speaks for
           every sunk tile at once */
        const tiles = sunk.every((s) => String(s).indexOf('ch:') === 0) ? [nodeId] : sunk;
        for (const t of tiles) {
          const makes = new Set(rec.makesOf(t) || []);
          for (const row of cat.all()) {
            const nm = row && row.name;
            if (!nm || nm.length < 4) continue;
            const re = new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (re.test(clause) && !makes.has(row.id)) out.violations.push(nodeId + ': ' + t + ' does not make ' + row.id + ' — "' + clause.trim() + '"');
          }
          out.checked.push(nodeId + '/' + t);
        }
      }
      return out;
    });
    note('foldTruth', foldTruth);
    ok(foldTruth.checked.length > 0 && !foldTruth.violations.length,
      'every combined tow-truck line names only goods the tiles in that same sentence actually make',
      foldTruth.violations.length ? foldTruth.violations.join(' | ') : foldTruth.checked.length + ' tile/line pairs clean');
    /* ══ 2a. 🔴 the card may not contradict itself ══════════════════════════
       The round-11 wording passed every pin above and was still wrong, because
       no pin read the REST of the card. Section 1 of ch:carmarket lists live
       products from tiles that make no vehicle (the tow-truck sellsTo edges), so
       "only vehicles trade here" / "makes no vehicle" is refuted fifteen rows
       higher on the same screen. Measure both halves: the live non-vehicle
       listings really are there (from the graph, so the pin cannot rot if the
       section is renamed), and the false sentence is nowhere in the card text. */
    const sec1 = await page.evaluate(async () => {
      const d = (await import('/src/supplychain/data.js')).getData();
      /* d.catalog is the catalogue MODULE (byId/family/all), not an array */
      const fam = (id) => { try { return d.catalog.family(id) || ''; } catch (_) { return ''; } };
      const into = (d.graph.edges || []).filter((e) => e.to === 'ch:carmarket' && e.live && (e.cargo || []).length);
      const nonVehicle = into.filter((e) => (e.cargo || []).some((c) => fam(c) !== 'vehicle'));
      return { liveEdges: into.length, nonVehicle: nonVehicle.map((e) => e.from + ':' + (e.cargo || []).slice(0, 3).join(',')).slice(0, 6) };
    });
    note('sec1', sec1);
    ok(sec1.nonVehicle.length > 0,
      'the card really does list live non-vehicle goods against this market (so "vehicles only" would be a lie)',
      sec1.nonVehicle.join(' | ') || 'none');
    ok(!FALSE_CLAIM.test(cm.cardText),
      'nowhere on the whole Car Marketplace card does it claim those goods do not trade here',
      (cm.cardText.match(FALSE_CLAIM) || ['clean'])[0]);

    /* The mark is drawn on the TILES too, and each of those cards cuts its own
       list at six. Oil Company's correction is rank 17 of 17 — invisible — so
       the same aside has to reach that card as well. */
    const oil = await readCard(page, 'oil');
    const oilFold = await page.evaluate(async () => {
      const mod = await import('/src/supplychain/partners.js');
      const d = (await import('/src/supplychain/data.js')).getData();
      return (mod.bestPartners('oil', d).find((r) => r.foldLine) || {}).foldLine || null;
    });
    /* secText is in the report because the pin below is a DOM pin: when it
       fails, "the aside is not drawn" is not actionable without the text that
       WAS drawn beside the text that was expected. */
    note('oil', { head: oil.head, rows: oil.rows.map((r) => r.id), foldLine: oilFold, secText: oil.secText });
    /* 🔴 WHAT THIS PIN IS ACTUALLY FOR. It was written when Oil Company's Car
       Marketplace row was rank 17 of 17 — off the card — so the aside was the
       only way the tow truck got explained, and "the aside is drawn" and "the
       tow truck is explained" were the same sentence. They are not any more:
       modal.js lifts a drawn legend icon into the visible six
       (pinLegendPartners), so ch:carmarket is now rank 6 on this card, and
       modal.js then SUPPRESSES the aside as stale because every id it stands
       in for is visible (`foldStale`). Asserting the aside's text verbatim
       therefore fails on a card that is doing exactly the right thing — a pin
       failing on its own obsolete premise, which is a red that teaches a
       future reader to delete the pin rather than read it.
       So the pin asks the QUESTION it always meant: the Oil Company card
       explains its tow truck, either through the aside or through the
       Car Marketplace row itself — and the escape hatch is not "or nothing":
       the row has to be there AND say what the mark means (MARK_EXPLAINED). */
    const oilRowExplains = oil.rows.some((r) => r.id === 'ch:carmarket' && (r.reasons || []).some((t) => MARK_EXPLAINED.test(t)));
    /* 🔴 THE ESCAPE HATCH IS GONE, AND WHY. The "aside OR row" form this pin
       used to take was written to stop it failing on its own obsolete premise,
       and that half was right — but the "or" made it blind in the one direction
       that mattered. When partners.js later stopped emitting the ch:carmarket
       row at all (dropFoldedBadgeRows), the aside came back, this pin stayed
       green, and Oil Company shipped a 🚗 CAR MARKETPLACE badge in its header
       over six rows that never name the Car Marketplace — exactly the
       contradiction this suite exists for, waved through by its own escape
       hatch. modal.js now SYNTHESISES the row from the same graph edge when
       the ranker omits it, so the row is no longer at the ranker's discretion
       and the question can be asked in its strong form: the row is on the card
       AND it says what the mark means. A failure here is now a real red. */
    ok(oilRowExplains,
      'Oil Company\'s own card explains its tow truck — as a visible Car Marketplace row',
      oilRowExplains ? 'ch:carmarket row is visible and explains the mark' : 'NO ROW ON THE CARD; the aside said: ' + (oilFold || '(no aside)'));
    /* The tile side used to say "takes vehicles, not your fuel" while the
       channel side said "makes no vehicle" — two voices for one fact, which is
       how the false half survived a round. Both are swept by one regex now. */
    ok(!FALSE_CLAIM.test(oil.cardText), 'and Oil Company\'s card makes no "your goods do not trade there" claim either',
      (oil.cardText.match(FALSE_CLAIM) || ['clean'])[0]);
    await shootPartners(page, 'oil', 'partners-oil');

    /* ══ 2d. 🔴 EVERY LEGEND BADGE ON EVERY ICON TILE, NOT JUST OIL'S ══════
       The three pins above ask about ONE tile, and the regression that got
       through them touched four (oil, gas, agri, feed). This asks the whole
       question the owner's legend asks: on every tile whose header draws one
       of the four legend icons, the node that icon names is a VISIBLE row in
       section 6 — inside the sliced six, not merely somewhere in the ranking.
       It is a DOM sweep, not a data sweep: the defect was always the slice,
       and a data-level check cannot see a slice. Cards are opened through the
       probe (the mouse path is pinned separately in 2c), and the badge is read
       from the card's own header so the pin cannot disagree with the ink it is
       judging. */
    const LEGEND_OF = { transport: 'transport', market: 'ch:market', carMarket: 'ch:carmarket', card: 'sys:battle' };
    const iconTiles = await page.evaluate(async () => {
      const d = (await import('/src/supplychain/data.js')).getData();
      return d.graph.nodes.filter((n) => n.badges && ['transport', 'market', 'carMarket', 'card'].some((k) => n.badges[k]))
        .map((n) => ({ id: n.id, badges: ['transport', 'market', 'carMarket', 'card'].filter((k) => n.badges[k]) }));
    });
    const badgeMisses = [];
    for (const t of iconTiles) {
      const card = await readCard(page, t.id);
      const ids = new Set((card.rows || []).map((r) => r.id));
      for (const k of t.badges) if (!ids.has(LEGEND_OF[k])) badgeMisses.push(`${t.id}:${k}(${LEGEND_OF[k]})`);
    }
    note('icon tiles swept', { count: iconTiles.length, misses: badgeMisses });
    ok(iconTiles.length >= 21, 'the sweep actually found the icon-bearing tiles (>= 21)', String(iconTiles.length));
    ok(badgeMisses.length === 0,
      'every legend icon drawn on a tile is a visible partner row on that tile\'s card',
      badgeMisses.length ? 'BADGE WITH NO ROW: ' + badgeMisses.join(', ') : iconTiles.length + ' tiles, 0 badges unanswered');

    /* ══ 2b. the tier-0 exemption round 10 left as dead code ════════════════
       `rank()` used to skip the demotion for TIER.needsIcon rows. No correction
       row is tier 0, so the branch never ran and nothing measured it — a future
       needs-icon correction would have reinstated the round-1 defect silently.
       The branch is gone; this pin holds the assumption it rested on, so if a
       markOnly row ever IS drawn as a needs-icon the suite says so out loud. */
    const tiers = await page.evaluate(async () => {
      const mod = await import('/src/supplychain/partners.js');
      const d = (await import('/src/supplychain/data.js')).getData();
      const out = { markOnly: 0, tier0: [] };
      for (const n of d.graph.nodes) for (const r of mod.bestPartners(n.id, d)) {
        if (!r.markOnly) continue;
        out.markOnly++;
        if (r.tier === 0) out.tier0.push(n.id + ' > ' + r.id);
      }
      return out;
    });
    note('tiers', tiers);
    ok(tiers.markOnly > 0 && tiers.tier0.length === 0,
      'every correction row is a legend/undrawn icon, so demotion is unconditional',
      tiers.markOnly + ' correction rows, ' + tiers.tier0.length + ' at tier 0' + (tiers.tier0.length ? ': ' + tiers.tier0.join(' | ') : ''));

    /* ══ 2c. a real mouse, not window.__mg ══════════════════════════════════
       Every card above is opened by calling the module's own door. That is not
       how a player reaches the Car Marketplace, and a critic who tried a canvas
       click at the tile's projected point landed on Salvage Operation instead.
       Close the overlay, reopen it cold, and get to the card through the map's
       own search field with real keystrokes and a real click. */
    const mouse = await page.evaluate(() => {
      try { window.__mg.supplyChain.close(); } catch (_) {}
      return true;
    });
    void mouse;
    await page.waitForTimeout(250);
    await page.evaluate(() => { window.openSupplyChain(); });
    await page.waitForSelector('#sc-overlay', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
    const box = await page.$('#sc-overlay input[type="search"], #sc-overlay input[type="text"], #sc-overlay input');
    let opened = '';
    if (box) {
      await box.click();
      await page.keyboard.type('Car Marketplace', { delay: 20 });
      await page.waitForTimeout(450);
      /* 🔴 A held ElementHandle is a race here, not a convenience: the result
         list re-renders while the debounced search settles, so `page.$` could
         hand back a node that is detached by the time `.click()` runs
         ("Element is not attached to the DOM", pw-carmarket.mjs:372 on a
         critic's run). That is a non-zero exit on a CLICK race rather than on
         a product break, which is the worst kind of red. A locator re-queries
         at click time and Playwright retries it, so the suite fails only when
         the row genuinely never appears. */
      const row = page.locator('#sc-overlay [data-id="ch:carmarket"]').first();
      if (await row.count()) {
        await row.click({ timeout: 10000 }).catch(async () => { await row.click({ timeout: 10000, force: true }).catch(() => {}); });
        opened = 'locator:#sc-overlay [data-id="ch:carmarket"]';
      }
    }
    await page.waitForTimeout(500);
    const byMouse = await page.evaluate(() => {
      const m = document.querySelector('[data-sc-modal]');
      return m ? ((m.querySelector('h2') || {}).textContent || '').trim() : '';
    });
    note('mouse', { opened, title: byMouse });
    ok(/Car Marketplace/i.test(byMouse), 'the Car Marketplace card opens from a real click, not only from the module door',
      (opened || 'no search field found') + ' -> ' + (byMouse || '(no card)'));

    /* ══ 3. the other five system / channel cards ═══════════════════════ */
    console.log('  ── 3. the other five system and channel cards');
    for (const id of CARDS.slice(1)) {
      const card = await readCard(page, id);
      const bad = antiOn(card);
      note('card:' + id, { head: card.head, rows: card.rows.map((r) => r.id) });
      ok(card.rows.length > 0 && !bad.length, id + ': no visible row is a bare icon correction',
        card.rows.map((r) => r.id).join(', ') + (bad.length ? '  BAD: ' + bad.map((r) => r.id).join(' ') : ''));
      await shootPartners(page, id, 'partners-' + id.replace(':', '-'));
    }

    /* ══ 4. all 33 nodes, through the module's own data ═════════════════ */
    console.log('  ── 4. every node on the map');
    const sweep = await page.evaluate(async () => {
      const mod = await import('/src/supplychain/partners.js');
      const { MODAL } = await import('/src/supplychain/tuning.js').then((m) => ({ MODAL: (m.SC && m.SC.modal) || {} }));
      const d = (await import('/src/supplychain/data.js')).getData();
      const max = MODAL.maxPartners || 6;
      const RE = /only vehicles trade (here|there)|sells? on the Marketplace instead|sell on the Marketplace instead/i;
      /* the same sweep, widened in round 12: the false claim is banned at EVERY
         rank and in the fold line, not only inside the visible six */
      const LIE = /only vehicles trade (here|there)|sells? on the Marketplace instead|sell on the Marketplace instead|makes? no vehicle|make no vehicle|none of it is a vehicle/i;
      const bad = [], folded = [], unshown = [], lies = [];
      for (const n of d.graph.nodes) {
        const all = mod.bestPartners(n.id, d);
        const top = all.slice(0, max);
        for (const r of top) {
          if (!(r.cargo || []).length && (r.reasons || []).some((x) => RE.test(x))) bad.push(n.id + ' #' + r.rank + ' ' + r.id);
        }
        for (const r of all) {
          const texts = [...(r.reasons || []), r.foldLine || '', r.foldLineShown || '', ...((r.lines || []).map((l) => (l && l.text) || ''))];
          if (texts.some((x) => LIE.test(x))) lies.push(n.id + ' #' + r.rank + ' ' + r.id);
        }
        /* Every card that HID a correction must show the aside in its place, in
           the same three-paragraph budget modal.js gives a row. Measured the
           way modal.js builds it, so a row that already had three reasons —
           which would silently swallow the aside — counts as unshown. */
        const fold = (all.find((r) => r.foldLine) || {}).foldLine || null;
        if (!fold) continue;
        folded.push(n.id);
        const drawn = top.some((r) => [...new Set([...(r.lines || []).map((l) => l && l.text), ...(r.reasons || [])])].slice(0, 3).includes(fold));
        if (!drawn) unshown.push(n.id);
      }
      return { nodes: d.graph.nodes.length, max, bad, folded, unshown, lies };
    });
    note('sweep', sweep);
    ok(sweep.bad.length === 0, `no card in the map's ${sweep.nodes} nodes opens with an empty-cargo correction`,
      sweep.bad.length ? sweep.bad.join(' | ') : 'clean, top ' + sweep.max + ' of every node');
    ok(sweep.lies.length === 0,
      'and no row at ANY rank, on any of the ' + sweep.nodes + ' cards, says a marked tile makes or sells nothing here',
      sweep.lies.length ? sweep.lies.slice(0, 6).join(' | ') : 'clean at every rank');
    ok(sweep.folded.length > 0 && sweep.unshown.length === 0,
      'every card that demotes a correction prints the combined aside inside its visible six',
      sweep.folded.length + ' folded (' + sweep.folded.join(', ') + ')' + (sweep.unshown.length ? '  UNSHOWN: ' + sweep.unshown.join(', ') : ''));

    const errs = t.errors.filter((e) => MINE.test(e));
    ok(errs.length === 0, '0 console errors attributable to the supply chain', errs.slice(0, 3).join(' | '));
  }, { w: 1600, h: 900 });

  console.log(`\n  ${R.fail ? '❌' : '✅'} carmarket partners: ${R.pass} ok, ${R.fail} failed`);
  if (SHOTS) console.log('  shots: ' + SHOTS);
  if (flag('json')) console.log(JSON.stringify(R, null, 2));
  process.exit(R.fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
