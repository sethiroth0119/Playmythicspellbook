/* ═══════════════════════════════════════════════════════════════════════════
   🪟 pw-partnerwindow — THE WINDOW THE PLAYER ACTUALLY READS, on all 33 cards.

   WHY THIS SUITE EXISTS, AND WHY pw-carmarket DID NOT CATCH IT.
   pw-carmarket proves the ranking with two instruments: it scrapes the DOM for
   the six system/channel cards, and for the other 27 it calls
   `bestPartners(id, data)` inside the page and slices the top `MODAL.maxPartners`
   itself. That slice is NOT what a player sees. modal.js draws
   `pinLegendPartners(all, node.badges, MAX)`, which lifts a row from BELOW the
   fold back into the visible six whenever its id is one of the icons the card
   badges in its header (transport / ch:market / ch:carmarket / sys:battle),
   trading away the lowest visible row to make room.

   Measured before the fix that comes with this file: on oil, gas, agri and
   feed the row lifted back was the sunk, EMPTY-CARGO Car Marketplace
   correction, and what it displaced was cargo — agri lost genelab and
   smuggling, feed lost the Battle System (15 ids, its richest partner). The
   card said so itself in its footer ("2 higher-ranked partners were pushed off
   the list to make room"). Every pin in pw-carmarket was green on those four
   cards, because all 27 of them were measured on module data.

   So this suite has ONE rule and measures it the only way that counts:

     For every node on the map, scrape section 6 AS DRAWN. No row inside the
     visible window may have zero cargo chips AND a "marked here but does not
     trade here" reason while a chip-bearing partner sits below the fold.

   It also records, per card, which rows a view lifted and what they displaced,
   so a future lift that pays a cargo-bearing partner for a bare row is visible
   in the report even when it is not yet a failure.

   READ-ONLY. It forces Profile.cloud.offlineMode, stubs the first-run gates and
   navigates. It signs nothing in, buys nothing, writes no repo file and touches
   no database.

   USAGE
     node tools/supplychain/pw-partnerwindow.mjs               exit 1 on failure
     node tools/supplychain/pw-partnerwindow.mjs --json        + the full report
     node tools/supplychain/pw-partnerwindow.mjs --shots <dir> PNGs of the cards
   One Chromium page, 1600x900, from node_modules; the server is node:http on an
   ephemeral port (shoot.mjs), so parallel critics never collide.
   ═══════════════════════════════════════════════════════════════════════════ */
import path from 'node:path';
import { withPage, shot } from './shoot.mjs';

const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes('--' + n);
const val = (n, d) => { const i = ARGV.indexOf('--' + n); return (i >= 0 && ARGV[i + 1]) ? ARGV[i + 1] : d; };
const SHOTS = val('shots', null);

/* The sentences a bare correction is made of, in the player's own wording —
   deliberately not a flag, so a rewrite that says the same thing in new words
   is still caught. The last two alternatives are modal.js's own
   counterScopeReason(), which is what the lifted row printed on agri and feed:
   "Nothing this tile makes falls in that scope, so it has nothing of its own to
   list at that counter — its goods sell on the Marketplace instead." */
const CORRECTION = new RegExp([
  'only vehicles trade (here|there)',
  'sells? on the Marketplace instead',
  'sell on the Marketplace instead',
  'nothing of its own to list',
  'Nothing this tile makes falls in that scope',
  'makes? no vehicle', 'make no vehicle', 'none of it is a vehicle',
].join('|'), 'i');

const BOOT = `
(function () {
  var S = window.__PW = { forced: 0, errors: [] };
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
        if (typeof window[k] === 'function' && !window[k].__pw) {
          var v = ST[k], f = function () { return v; }; f.__pw = true; window[k] = f;
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
      if (document.getElementById('sc-overlay')) return;   // never re-render under an open overlay
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

const R = { pass: 0, fail: 0, rows: [], notes: {}, shots: [] };
const ok = (cond, what, detail) => {
  const good = !!cond;
  R[good ? 'pass' : 'fail']++;
  R.rows.push({ ok: good, what, detail: detail === undefined ? '' : String(detail) });
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${what}${detail === undefined || detail === '' ? '' : '   ' + detail}`);
  return good;
};
const note = (k, v) => { R.notes[k] = v; };
const MINE = /supplychain|SupplyChainBridge|MythicSupplyChain|sc-overlay|openSupplyChain/i;

/* One pass per card so the read cannot straddle a re-render: open the node,
   wait for the modal to carry it, then scrape section 6 as it is drawn AND ask
   the module for the full ranked list in the same evaluate, so "below the fold"
   is measured against the same instant. */
async function readCard(page, id) {
  await page.evaluate((nid) => { window.__mg.supplyChain.open({ select: nid }); }, id);
  await page.waitForFunction((nid) => {
    const m = document.querySelector('[data-sc-modal]');
    return !!m && !!m.querySelector('.scm-partner') && (m.getAttribute('data-node') === nid || true);
  }, id, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(180);
  return page.evaluate(async (nid) => {
    const m = document.querySelector('[data-sc-modal]');
    if (!m) return { id: nid, present: false };
    let head = '';
    for (const h of m.querySelectorAll('h3')) if (/Best businesses to work with/i.test(h.textContent || '')) head = (h.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = [...m.querySelectorAll('.scm-partner')].map((b) => ({
      id: b.getAttribute('data-id') || '',
      rank: ((b.querySelector('.r') || {}).textContent || '').trim(),
      label: ((b.querySelector('.nm') || {}).textContent || '').trim(),
      chips: b.querySelectorAll('.scm-chips .scm-res').length,
      reasons: [...b.querySelectorAll('p')].map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    }));
    /* the full ranking, for the below-the-fold half of the rule */
    let all = []; let fold = null;
    try {
      const mod = await import('/src/supplychain/partners.js');
      const d = (await import('/src/supplychain/data.js')).getData();
      const full = mod.bestPartners(nid, d);
      all = full.map((r) => ({ id: r.id, rank: r.rank, cargo: (r.cargo || []).length, markOnly: !!r.markOnly }));
      /* the sentence that stands in for the rows this card folded OUT of its
         list. A fold that is not drawn is a deleted fact, and after round 16
         the folded rows are gone from `all`, so the module's own list can no
         longer be the place a player reads them. */
      fold = (full.find((r) => r.foldLineShown || r.foldLine) || {});
      fold = fold.foldLineShown || fold.foldLine || null;
    } catch (_) { /* reported as an empty list, which fails loudly below */ }
    const flat = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
    let sec = m.querySelector('section[data-sec="partners"]');
    if (!sec) for (const h of m.querySelectorAll('h3')) if (/Best businesses to work with/i.test(h.textContent || '')) sec = h.closest('section') || h.parentNode;
    return { id: nid, present: true, head, visible, all, fold, secText: flat(sec) };
  }, id);
}

async function shootPartners(page, name) {
  if (!SHOTS) return null;
  await page.evaluate(() => {
    const m = document.querySelector('[data-sc-modal]');
    if (!m) return;
    for (const h of m.querySelectorAll('h3')) {
      if (!/Best businesses to work with/i.test(h.textContent || '')) continue;
      h.scrollIntoView({ block: 'start' });
      let sc = h.parentNode;
      while (sc && sc !== document.body && sc.scrollHeight <= sc.clientHeight + 2) sc = sc.parentNode;
      const bar = m.querySelector('nav, [role="tablist"], .scm-tabs');
      if (sc && sc.scrollBy) sc.scrollBy(0, -((bar ? bar.getBoundingClientRect().height : 0) + h.getBoundingClientRect().height + 12));
      return;
    }
  });
  await page.waitForTimeout(150);
  const abs = await shot(page, path.join(SHOTS, name + '.png'));
  R.shots.push(abs);
  return abs;
}

async function main() {
  await withPage(async (page, t) => {
    t.allowErrors = true;
    await page.addInitScript(BOOT);
    await page.goto(t.url('/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 45000 });
    ok(true, 'the module mounted (window.__mg.supplyChain exists)');
    await page.evaluate(() => window.__mg.supplyChain.open({}));
    await page.waitForTimeout(600);

    const ids = await page.evaluate(async () => {
      const d = (await import('/src/supplychain/data.js')).getData();
      return d.graph.nodes.map((n) => n.id);
    });
    ok(ids.length >= 30, 'the map has every node to sweep', ids.length + ' nodes');

    const cards = [];
    for (const id of ids) cards.push(await readCard(page, id));

    const missing = cards.filter((c) => !c.present || !c.visible.length).map((c) => c.id);
    ok(!missing.length, 'every card drew section 6 as a player opens it', missing.join(', ') || cards.length + ' cards');

    /* ── THE RULE ─────────────────────────────────────────────────────────── */
    const bad = [];
    const lifts = [];
    for (const c of cards) {
      if (!c.present) continue;
      const shown = new Set(c.visible.map((r) => r.id));
      const below = (c.all || []).filter((r) => !shown.has(r.id));
      const richBelow = below.filter((r) => r.cargo > 0);
      for (const r of c.visible) {
        const corr = r.reasons.some((x) => CORRECTION.test(x));
        if (r.chips === 0 && corr && richBelow.length) {
          bad.push(`${c.id} #${r.rank} ${r.id || r.label}: 0 chips + correction, while ${richBelow.slice(0, 3).map((b) => b.id + '(' + b.cargo + ')').join(', ')} sit below the fold`);
        }
      }
      /* the report half: what a view lifted, and what that cost */
      const maxRank = Math.max(0, ...c.visible.map((r) => parseInt(r.rank, 10) || 0));
      const lifted = c.visible.filter((r) => (parseInt(r.rank, 10) || 0) > c.visible.length);
      if (lifted.length) {
        lifts.push({ node: c.id, lifted: lifted.map((r) => r.id + '#' + r.rank + '/' + r.chips + 'chips'),
          displaced: below.filter((b) => b.rank <= maxRank).map((b) => b.id + '(' + b.cargo + ')') });
      }
    }
    note('lifts', lifts);
    note('bad', bad);
    ok(bad.length === 0,
      `no RENDERED card on any of the ${cards.length} nodes shows a bare correction while cargo sits below the fold`,
      bad.length ? bad.slice(0, 6).join(' | ') : 'clean in the drawn window of all ' + cards.length + ' cards');

    /* A lift that pays a cargo-bearing partner for a row with NOTHING to act on
       is the defect itself; a lift that pays for a row that names cargo is the
       view doing its job. Reported either way, failed only in the first case —
       already covered above, so this is the louder, earlier warning. */
    const barterBad = lifts.filter((l) => l.lifted.some((x) => /\/0chips$/.test(x)) && l.displaced.length);
    ok(barterBad.length === 0, 'and no view traded a cargo-bearing row away for a chipless one',
      barterBad.length ? JSON.stringify(barterBad).slice(0, 300) : lifts.length + ' lifts, all chip-bearing');

    /* ── and the aside that stands in for them is DRAWN ──────────────────── */
    const folded = cards.filter((c) => c.present && c.fold);
    const lost = folded.filter((c) => !c.secText.includes(c.fold)).map((c) => c.id);
    ok(folded.length > 0 && lost.length === 0,
      'every card that folds a correction off its list prints the combined aside inside section 6',
      lost.length ? 'MISSING ON: ' + lost.join(', ') : folded.length + ' folded (' + folded.map((c) => c.id).join(', ') + ')');

    /* The four cards this suite was written for, photographed. */
    for (const id of ['agri', 'feed', 'oil', 'gas']) {
      const c = cards.find((x) => x.id === id);
      if (!c) continue;
      await readCard(page, id);
      await shootPartners(page, id + '-window');
      ok(c.visible.every((r) => r.chips > 0 || !r.reasons.some((x) => CORRECTION.test(x))),
        `${id}: every visible partner names real cargo or makes no correction`,
        c.visible.map((r) => r.id + '(' + r.chips + ')').join(', '));
    }

    const errs = await page.evaluate(() => (window.__PW && window.__PW.errors) || []);
    const mine = errs.filter((e) => MINE.test(e));
    ok(mine.length === 0, '0 console errors attributable to the supply chain', mine.slice(0, 3).join(' | ') || 'clean');
  });

  console.log(`\n  ${R.fail ? '❌' : '✅'} partner window: ${R.pass} ok, ${R.fail} failed`);
  if (SHOTS) console.log('  shots: ' + SHOTS);
  if (flag('json')) console.log(JSON.stringify(R, null, 2));
  process.exit(R.fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
