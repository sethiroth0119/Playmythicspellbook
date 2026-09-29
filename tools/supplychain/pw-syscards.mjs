/* ═══════════════════════════════════════════════════════════════════════════
   🏛 pw-syscards — the six SYSTEM and CHANNEL hover cards, measured inside the
   REAL public/index.html at 1600x900.

   WHY A SUITE OF ITS OWN, next to pw-e2e. pw-e2e proves the map is reachable
   and that a BUSINESS card is drawn above the chrome; it hovers businesses
   only. The thinnest cards on the map were the four systems and the two trade
   channels — the very surfaces the owner's "show the players how the economy
   all works together" points at. Round 4 measured 0 of their 32 chips carrying
   a sub-line against 179 of 179 on the business cards, an empty foot line on
   all six, and Battle System and Camp reading as one card. This file is the
   gate for that, and it asks the question in the only place that counts: the
   shipped page, not the harness.

   WHAT IT MEASURES (the bar, one assertion each)
     1. every chip on each of the six carries a sub-line;
     2. each of the six has a foot summary line;
     3. each card is at least (median business card height − 15 %);
     4. Battle System and Camp each state the coverage fact as a sentence;
     5. that number is READ FROM coverage at runtime — proved by importing
        hoverVM in Node with one USES row emptied and watching it fall;
     6. Battle and Camp are not the same card (chip sets and sentences differ);
     7. no card is painted under the .sc-head chrome (the z rule still holds).

   ROUND 6 added four questions the round-5 critic asked and this file could
   not answer:
     1b. a counter names the good it is named after. ch:carmarket printed
         "Fuel, Butane, Wheat, Wool" — no car — on the counter its own seller
         chip credits to the Car Dealer. The assertion finds the seller whose
         NAME shares a word with the channel's (no id typed here) and demands
         the sample name something that seller brings; and the two counters
         must not share section labels, cover template or foot template, the
         way Battle and Camp used not to.
     1c. all six state the coverage fact, and no two use one template.
     1d. no resource section repeats one sub-line down its chips (round 5's
         "Exotic salvage off any body" three times on the City card).
     3.  a 390x844 leg, because every fact round 5 added was display:none on a
         phone and nobody had looked.

   Assertion 5 is the one that cannot be done in the browser: nothing in the
   page lets a test delete a coverage row, and an in-page read of "409" would
   pass just as happily against a literal. So the suite runs a pure Node leg
   first (fast, no browser) and the page leg second.

   READ-ONLY, like pw-e2e: it forces offline mode and the first-run gates,
   navigates, hovers, and writes nothing but screenshots.

   USAGE
     node tools/supplychain/pw-syscards.mjs
     node tools/supplychain/pw-syscards.mjs --json
     node tools/supplychain/pw-syscards.mjs --shots <dir>
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { withPage, shot } from './shoot.mjs';

const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes('--' + n);
const val = (n, d) => { const i = ARGV.indexOf('--' + n); return (i >= 0 && ARGV[i + 1]) ? ARGV[i + 1] : d; };
const SHOTS = val('shots', null);

const SIX = ['sys:battle', 'sys:camp', 'sys:city', 'sys:business', 'ch:market', 'ch:carmarket'];
/* the control group for the height bar: a spread of business tiles, small and
   large, drawn from the PDF's own pages rather than the ones that flatter us */
const BIZ = ['medical', 'fashion', 'mining', 'weaponsmith', 'bank', 'carfactory', 'restaurant', 'warehouse', 'transport'];

const R = { pass: 0, fail: 0, rows: [], notes: {}, shots: [] };
const ok = (cond, what, detail) => {
  const good = !!cond;
  R[good ? 'pass' : 'fail']++;
  R.rows.push({ ok: good, what, detail: detail === undefined ? '' : String(detail) });
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${what}${detail === undefined || detail === '' ? '' : '   ' + detail}`);
  return good;
};
const note = (k, v) => { R.notes[k] = v; };

/* ── leg 1: PURE. Is the printed number read, or written down? ─────────────
   The bar says "changing a USES entry changes the printed number". So change
   one and read the sentence back. data.js is imported once and the coverage
   object is shadowed on a COPY — nothing on disk is touched and the real graph
   is left alone (dropCoverage memoises per graph object, so the copy must not
   share the graph's identity for the second read to recompute; it does not,
   because the copy carries a new object). */
async function pureLeg() {
  console.log('\n  ── 1. the coverage number is read, not typed (Node)');
  const { getData } = await import('../../public/src/supplychain/data.js');
  const { hoverVM } = await import('../../public/src/supplychain/hover.js');
  const data = getData();
  const base = {};
  for (const id of SIX) base[id] = hoverVM(id, data);

  const nums = (s) => (String(s || '').match(/\d+/g) || []).map(Number);
  for (const id of ['sys:battle', 'sys:camp']) {
    const vm = base[id];
    ok(vm.coverLine && /wanted by a business on the map/.test(vm.coverLine),
      id + ' states the coverage fact as a sentence', vm.coverLine);
    ok(nums(vm.coverLine).length >= 1, id + "'s sentence carries the number", nums(vm.coverLine).join('/'));
  }
  /* empty two USES rows: two drops lose their buyer */
  const U2 = Object.assign({}, data.coverage.USES);
  U2.seaweed = []; U2.concrete = [];
  const mutated = Object.assign({}, data, {
    coverage: Object.assign({}, data.coverage, { USES: U2 }),
    graph: Object.assign({}, data.graph),
  });
  const rows = {};
  for (const id of ['sys:battle', 'sys:camp']) {
    const a = base[id].coverLine, b = hoverVM(id, mutated).coverLine;
    rows[id] = { before: a, after: b };
    const na = nums(a), nb = nums(b);
    ok(a !== b && JSON.stringify(na) !== JSON.stringify(nb),
      id + "'s number moves when a coverage row is emptied", nb.join('/') + ' (was ' + na.join('/') + ')');
    ok(/\b2\b/.test(b), id + ' names the two ids that lost their buyer', b);
  }
  note('coverageMutation', rows);

  /* the two cards must not be the same card */
  const chipSet = (vm) => new Set([].concat(vm.makes, vm.resSample, vm.bizList, vm.lootNeeds, vm.bizNeeds, vm.sells).map((c) => c.name));
  const A = chipSet(base['sys:battle']), B = chipSet(base['sys:camp']);
  const shared = [...A].filter((x) => B.has(x));
  const jacc = shared.length / Math.max(1, new Set([...A, ...B]).size);
  ok(jacc < 0.5, 'Battle System and Camp do not share half their chips',
    shared.length + ' shared of ' + new Set([...A, ...B]).size + ' (' + Math.round(jacc * 100) + '%)');
  ok(base['sys:battle'].coverLine !== base['sys:camp'].coverLine, 'their coverage sentences are different sentences');
  ok(base['sys:battle'].liveLine !== base['sys:camp'].liveLine, 'their foot lines are different lines',
    base['sys:battle'].liveLine + '  ·  ' + base['sys:camp'].liveLine);
  note('battleVsCamp', { shared, battle: [...A], camp: [...B] });

  /* ── ROUND 6: A COUNTER MUST NAME ITS OWN GOOD ─────────────────────────
     The regression this exists to stop: ch:carmarket's "Traded here" printed
     Fuel, Butane, Wheat, Wool and not one car, while its own seller chip two
     rows below said "Car Dealer · brings Cars". The sampler spread by index
     across a 46-good array the Oil Company dominates and skipped the good the
     stall is named for.
     The assertion is written the way the card is: find the seller whose NAME
     shares a distinctive word with the channel's (no id is typed here, so a
     renamed or added channel is covered too) and require the sample to name
     something that seller brings. A channel with no such seller — the general
     Marketplace — is skipped, not failed. */
  console.log('\n  ── 1b. a counter names the good it is named after');
  const words = (s) => String(s || '').split(/[^A-Za-z]+/).filter(Boolean)
    .map((w) => w.toLowerCase().replace(/s$/, ''))
    .filter((w) => w.length > 2 && !/^(the|and|market|marketplace|exchange|counter|trade|shop|stall|hub)$/.test(w));
  const nodeOf = (id) => (data.graph.nodes || []).find((x) => x && x.id === id) || null;
  for (const cid of ['ch:market', 'ch:carmarket']) {
    const ch = nodeOf(cid); if (!ch) continue;
    const keys = words(ch.label);
    const sellers = (data.graph.edges || []).filter((e) => e && e.kind === 'channel' && e.to === cid).map((e) => e.from);
    const named = sellers.filter((sid) => words((nodeOf(sid) || {}).label).some((w) => keys.includes(w)));
    if (!named.length) { console.log('    · ' + cid + ': named after nothing in particular — sample is a free spread'); continue; }
    const theirGoods = new Set();
    for (const sid of named) for (const m of (nodeOf(sid) || {}).makes || []) theirGoods.add(m.id);
    const sample = base[cid].resSample.map((c) => c.id);
    const hit = sample.filter((id) => theirGoods.has(id));
    ok(hit.length > 0, cid + ': its sample names a good ' + named.map((s) => nodeOf(s).label).join('/') + ' brings',
      sample.join(', '));
    ok(base[cid].resSample.some((c) => keys.some((k) => words(c.name).includes(k))),
      cid + ": a good on the sample carries the counter's own word", base[cid].resSample.map((c) => c.name).join(', '));
  }
  /* the two counters must not be the twins Battle and Camp were */
  const M = base['ch:market'], C = base['ch:carmarket'];
  ok(M.resSampleLabel !== C.resSampleLabel && M.bizListLabel !== C.bizListLabel && M.extraLabel !== C.extraLabel,
    'the two counters do not share their section labels',
    [M.resSampleLabel, M.bizListLabel, M.extraLabel].join(' / ') + '   vs   ' + [C.resSampleLabel, C.bizListLabel, C.extraLabel].join(' / '));
  const shape = (s) => String(s || '').replace(/\d+/g, '#');
  ok(shape(M.coverLine) !== shape(C.coverLine), 'their coverage sentences are not one template with two numbers', C.coverLine);
  ok(shape(M.liveLine) !== shape(C.liveLine), 'their foot lines are not one template with two numbers', C.liveLine);

  /* ── ROUND 6: all six answer the owner's headline question ───────────── */
  console.log('\n  ── 1c. every one of the six states the coverage fact');
  for (const id of SIX) ok(!!base[id].coverLine, id + ': carries a coverage sentence', base[id].coverLine);
  const covers = SIX.map((id) => shape(base[id].coverLine));
  ok(new Set(covers).size === SIX.length, 'no two of the six share a coverage sentence template',
    SIX.length - new Set(covers).size + ' duplicates');
  /* the making systems' number must be read from coverage too */
  for (const id of ['sys:city', 'sys:business']) {
    const b = hoverVM(id, mutated).coverLine;
    ok(b !== base[id].coverLine, id + "'s coverage number moves when a USES row is emptied", b);
  }

  /* ── ROUND 6: a sub-line that repeats the one above it is not a fact ─── */
  console.log('\n  ── 1d. no section repeats one sub-line down its chips');
  for (const id of SIX) {
    const vm = base[id];
    /* A RESOURCE list's sub names who makes, brings or wants the id, and two
       chips saying the same words there tell the reader one thing (the round-5
       bug: three City chips all reading "Exotic salvage off any body"). A
       BUSINESS list's sub names what THAT business hands over, and two tiles
       both sending Medicine to the camp is the fact, not a repetition — so
       those are checked as name+sub pairs and the repeat is printed, not
       failed. */
    for (const [lbl, list] of [[vm.resSampleLabel, vm.resSample], ['Needs from battle loot', vm.lootNeeds]]) {
      if (!list || list.length < 2) continue;
      const subs = list.map((c) => c.sub).filter(Boolean);
      ok(new Set(subs).size === subs.length, id + ' · ' + lbl + ': its sub-lines are ' + subs.length + ' different facts',
        subs.length - new Set(subs).size + ' repeated');
    }
    for (const [lbl, list] of [[vm.bizListLabel, vm.bizList], [vm.extraLabel, vm.extraList], ['Needs from businesses', vm.bizNeeds]]) {
      if (!list || list.length < 2) continue;
      const pairs = list.map((c) => c.name + ' · ' + (c.sub || ''));
      ok(new Set(pairs).size === pairs.length, id + ' · ' + lbl + ': no two business chips are the same chip', pairs.length + ' chips');
      const subs = list.map((c) => c.sub).filter(Boolean);
      if (new Set(subs).size !== subs.length) console.log('       note: ' + (subs.length - new Set(subs).size) + ' of its cargo lines name the same goods (two lanes, one cargo)');
    }
  }
  return base;
}

/* ── leg 2: the real page ──────────────────────────────────────────────── */
const BOOT = (hub) => `
(function () {
  var HUB = ${JSON.stringify(hub)};
  var S = window.__E2E = { forced: 0, errors: [] };
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
        if (typeof window[k] === 'function' && !window[k].__e2e) {
          var v = ST[k], f = function () { return v; }; f.__e2e = true; window[k] = f;
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
      if (document.getElementById('sc-overlay')) return;
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

/* project() answers in the canvas's LAYOUT pixels and page.mouse works in
   CLIENT pixels; inside index.html those differ twice (the stage starts below
   the header AND the app scales its UI). Same conversion as pw-e2e — copied
   rather than imported because that file exports nothing. */
async function aimAt(page, id) {
  return page.evaluate((nid) => {
    const v = window.__mg.supplyChain.view();
    if (v && typeof v.project === 'function') {
      const p = v.project(nid);
      const cv = document.querySelector('#sc-overlay canvas');
      if (cv && p && isFinite(p.x) && isFinite(p.y) && p.visible !== false) {
        const r = cv.getBoundingClientRect();
        const kx = r.width / Math.max(1, cv.clientWidth), ky = r.height / Math.max(1, cv.clientHeight);
        return { x: Math.round(r.left + p.x * kx), y: Math.round(r.top + p.y * ky), via: 'project' };
      }
    }
    const el = document.querySelector('[data-sc-node="' + nid + '"]');
    if (el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), via: 'dom' }; }
    return null;
  }, id);
}

/* Read the DRAWN card, not the view-model: this whole piece exists because a
   fact the view-model computed was not being drawn. Every number below comes
   off the DOM the player sees. */
function readCard() {
  const c = document.getElementById('sc-hover');
  if (!c || getComputedStyle(c).visibility !== 'visible') return null;
  const r = c.getBoundingClientRect();
  const items = [...c.querySelectorAll('.sc-hover-item')].filter((li) => !li.classList.contains('sc-hover-more'));
  const chips = items.map((li) => ({
    name: (li.querySelector('.sc-hover-name') || {}).textContent || '',
    sub: ((li.querySelector('.sc-hover-sub') || {}).textContent || '').replace(/^·\s*/, '').trim(),
    overflow: li.scrollWidth > li.clientWidth + 1,
  }));
  const footSpans = [...c.querySelectorAll('.sc-hover-foot > span')];
  const cz = parseInt(getComputedStyle(c).zIndex, 10) || 0;
  let chromeHidden = 0;
  for (const sel of ['.sc-head', '.sc-rail', '.sc-find', '.sc-map-legend', '.sc-foot']) {
    for (const el of document.querySelectorAll('#sc-overlay ' + sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if ((parseInt(cs.zIndex, 10) || 0) < cz) continue;
      const q = el.getBoundingClientRect();
      const ix = Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left));
      const iy = Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top));
      chromeHidden += ix * iy;
    }
  }
  return {
    title: ((c.querySelector('.sc-hover-title') || {}).textContent || '').trim(),
    w: Math.round(r.width), h: Math.round(r.height), z: cz,
    compact: c.dataset.compact,
    cover: ((c.querySelector('.sc-hover-cover') || {}).textContent || '').trim(),
    what: ((c.querySelector('.sc-hover-what') || {}).textContent || '').trim(),
    foot: footSpans.length ? footSpans[0].textContent.trim() : '',
    labels: [...c.querySelectorAll('.sc-hover-lbl')].map((x) => x.textContent.trim()),
    chips,
    noSub: chips.filter((x) => !x.sub).length,
    overflow: chips.filter((x) => x.overflow).length,
    chromeHidden: Math.round(chromeHidden),
    text: (c.textContent || '').replace(/\s+/g, ' ').trim(),
  };
}

async function hoverNode(page, id) {
  const s = await aimAt(page, id);
  if (!s) return null;
  /* two moves a beat apart: render.js debounces the hover and scene.js drops a
     move that lands on the node it already considers hovered */
  await page.mouse.move(s.x - 7, s.y - 5);
  await page.waitForTimeout(160);
  await page.mouse.move(s.x, s.y);
  /* ROUND 6: wait for the card to be THIS node's card, not just for a card.
     The old wait ("visible and longer than 40 characters") was satisfied by
     the PREVIOUS node's card still on screen, and one run in ten measured
     sys:camp and read back sys:battle — then failed "Battle and Camp are not
     the same card" against two photographs of Battle. `data-node` is set by
     mountHover on every render, so it is the honest handle. */
  const settled = await page.waitForFunction((nid) => {
    const c = document.getElementById('sc-hover');
    return !!c && getComputedStyle(c).visibility === 'visible' && c.dataset.node === nid && c.textContent.length > 40;
  }, id, { timeout: 8000 }).then(() => true).catch(() => false);
  if (!settled) {
    /* one retry: nudge off the node and back on, the way a player would */
    await page.mouse.move(s.x - 40, s.y - 40); await page.waitForTimeout(220);
    await page.mouse.move(s.x, s.y);
    await page.waitForFunction((nid) => {
      const c = document.getElementById('sc-hover');
      return !!c && getComputedStyle(c).visibility === 'visible' && c.dataset.node === nid;
    }, id, { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(120);
  const drawn = await page.evaluate(() => { const c = document.getElementById('sc-hover'); return c ? c.dataset.node : null; });
  if (drawn !== id) { ok(false, 'the card drawn for ' + id + ' is that node\'s card', 'got ' + drawn); return null; }
  return page.evaluate(readCard);
}

async function pageLeg(pure) {
  console.log('\n  ── 2. the six cards, drawn inside public/index.html at 1600x900');
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  await withPage(async (page, t) => {
    t.allowErrors = true;
    await page.addInitScript(BOOT('exchange'));
    await t.goto('index.html');
    await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 60000 });
    await page.waitForFunction(() => !!document.getElementById('btn-supply-chain'), null, { timeout: 30000 }).catch(() => {});
    await page.click('#btn-supply-chain');
    await page.waitForFunction(() => {
      const s = window.__mg.supplyChain.state();
      return s.open && s.nodes > 0 && s.view !== null;
    }, null, { timeout: 60000 }).catch(() => {});
    const st = await page.evaluate(() => window.__mg.supplyChain.state());
    ok(st.open && st.nodes === 33, 'the map is open with all 33 nodes', st.view + ' · ' + st.nodes);
    /* let the fit-tween finish before asking where a node is: an early
       projection aims off the plate and reads as "hover is broken" */
    await page.waitForFunction(() => {
      try {
        const v = window.__mg.supplyChain.view();
        if (!v || !v.project) return true;
        const cv = document.querySelector('#sc-overlay canvas');
        const p = v.project('sys:battle');
        return !!(p && p.visible && cv && p.y > 4 && p.y < cv.clientHeight - 4);
      } catch (e) { return false; }
    }, null, { timeout: 20000 }).catch(() => {});

    const cards = {};
    for (const id of SIX.concat(BIZ)) {
      const c = await hoverNode(page, id);
      cards[id] = c;
      if (!c) { ok(false, 'could not hover ' + id, 'no card'); continue; }
      if (SHOTS && SIX.includes(id)) {
        const f = path.join(SHOTS, id.replace(':', '-') + '.png');
        R.shots.push(await shot(page, f));
      }
    }
    note('cards', cards);

    const bizH = BIZ.map((id) => cards[id] && cards[id].h).filter(Boolean).sort((a, b) => a - b);
    const median = bizH.length ? bizH[Math.floor(bizH.length / 2)] : 0;
    const floor = Math.round(median * 0.85);
    note('businessHeights', bizH); note('medianBusinessH', median); note('heightFloor', floor);
    ok(bizH.length >= 5, 'the business control group was measured', bizH.join(', '));

    for (const id of SIX) {
      const c = cards[id];
      if (!c) continue;
      console.log('    · ' + id + '  ' + c.w + 'x' + c.h + '  chips ' + c.chips.length);
      ok(c.chips.length > 0 && c.noSub === 0, id + ': every chip carries a sub-line',
        (c.chips.length - c.noSub) + ' of ' + c.chips.length);
      ok(!!c.foot, id + ': the foot carries a summary line', c.foot);
      ok(c.h >= floor, id + ': the card is not the thinnest thing on the map', c.h + ' px ≥ ' + floor + ' px');
      ok(c.overflow === 0, id + ': no chip overflows its box', c.overflow + ' overflowing');
      ok(c.chromeHidden === 0, id + ': no part of the card is under the .sc-head chrome', c.chromeHidden + ' px²');
    }
    for (const id of ['sys:battle', 'sys:camp']) {
      const c = cards[id];
      if (!c) continue;
      ok(/wanted by a business on the map/.test(c.cover), id + ': the coverage sentence is DRAWN on the card', c.cover);
      ok(c.cover === (pure[id] || {}).coverLine, id + ": the drawn sentence is the view-model's, unclipped");
    }
    const b = cards['sys:battle'], k = cards['sys:camp'];
    if (b && k) {
      const bs = new Set(b.chips.map((x) => x.name)), ks = new Set(k.chips.map((x) => x.name));
      const shared = [...bs].filter((x) => ks.has(x));
      ok(b.text !== k.text, 'the two cards are not the same text');
      ok(shared.length / Math.max(1, new Set([...bs, ...ks]).size) < 0.5,
        'Battle and Camp do not share half their drawn chips', shared.join(', ') || 'none shared');
      ok(JSON.stringify(b.labels) !== JSON.stringify(k.labels), 'their sections differ',
        b.labels.join(' / ') + '   vs   ' + k.labels.join(' / '));
    }

    const errs = (await page.evaluate(() => (window.__E2E && window.__E2E.errors) || []))
      .filter((e) => /supplychain|sc-hover|sc-overlay/i.test(e));
    ok(errs.length === 0, 'no page error attributable to the map', errs.join(' | ') || 'clean');
  }, { w: 1600, h: 900, webgl: true });
}

/* ── leg 3: the same six on a phone ────────────────────────────────────────
   ROUND 6, and the round-5 critic's fair hit: every fact round 5 added — the
   62 sub-lines, the six foot lines and (at MINI) the coverage sentences — was
   `display: none` at 390 px, so the work existed only on desktop and nobody
   had looked. The bar is written at 1600x900 and this leg is therefore not a
   bar assertion but a floor: at 390x844 each of the six must still draw at
   least ONE of the two facts this piece is about (the coverage sentence or the
   foot summary), and must still be on the screen. */
async function phoneLeg() {
  console.log('\n  ── 3. the six on a 390x844 phone (floor, not the bar)');
  await withPage(async (page, t) => {
    t.allowErrors = true;
    await page.addInitScript(BOOT('exchange'));
    await t.goto('index.html');
    await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 60000 });
    await page.waitForFunction(() => !!document.getElementById('btn-supply-chain'), null, { timeout: 30000 }).catch(() => {});
    await page.click('#btn-supply-chain');
    await page.waitForFunction(() => {
      const s = window.__mg.supplyChain.state();
      return s.open && s.nodes > 0 && s.view !== null;
    }, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const st = await page.evaluate(() => window.__mg.supplyChain.state());
    note('phoneState', st);
    /* MEASURED, NOT ASSUMED: at 390x844 the overlay opens with view === null
       and no [data-sc-node] in the DOM, so on a phone there is today nothing
       to hover at all. That is the shell's / scene's ground to cover, not
       hover.js's, and this suite must not claim a pass for it — it says so and
       then measures the thing this piece DOES own: whether the compact card,
       drawn at 390 px inside the real page, still carries its facts. */
    if (!st.view) console.log('    ! the map mounts no view at 390x844 (view: null, 0 hoverable nodes) — nothing to hover; the compact CARD is measured directly below');
    const out = await page.evaluate(async (ids) => {
      const [{ hoverVM }, { mountHover }, { getData }] = await Promise.all([
        import('/src/supplychain/hover.js'), import('/src/supplychain/hover.js'), import('/src/supplychain/data.js'),
      ]);
      const host = document.getElementById('sc-overlay') || document.body;
      const h = mountHover(host);
      const data = getData();
      const rows = {};
      for (const id of ids) {
        const vm = hoverVM(id, data);
        rows[id] = {};
        for (const lvl of ['0', '1', '2']) {
          h.show(vm, { x: 190, y: 400, rect: { left: 10, top: 10, right: 380, bottom: 300 } });
          h.el.dataset.compact = lvl;
          const vis = (sel) => { const e = h.el.querySelector(sel); return !!e && e.offsetHeight > 0; };
          rows[id][lvl] = { h: h.el.offsetHeight, w: h.el.offsetWidth, cover: vis('.sc-hover-cover'), foot: vis('.sc-hover-foot > span'), subs: [...h.el.querySelectorAll('.sc-hover-sub')].filter((e) => e.offsetHeight > 0).length };
        }
      }
      h.dispose();
      return rows;
    }, SIX);
    note('phoneCompact', out);
    for (const id of SIX) {
      const r = out[id];
      console.log('    · ' + id + '  full ' + r['0'].w + 'x' + r['0'].h + '  compact ' + r['1'].h + '  mini ' + r['2'].h);
      ok(r['1'].foot, id + ' (390px, compact): the foot summary survives');
      ok(r['2'].cover && r['2'].foot, id + ' (390px, mini): the coverage sentence and the foot survive',
        'mini ' + r['2'].h + ' px');
      if (!r['1'].subs) console.log('       note: sub-lines are hidden at compact (they widen chips into extra rows; the modal is the full answer on a phone)');
    }
  }, { w: 390, h: 844, webgl: true });
}

(async function main() {
  console.log('\n  🏛 Supply Chain — the six system and channel hover cards\n');
  const pure = await pureLeg();
  await pageLeg(pure);
  if (!flag('no-phone')) await phoneLeg();
  console.log('\n  ' + R.pass + ' passed, ' + R.fail + ' failed');
  if (flag('json')) console.log(JSON.stringify(R, null, 2));
  process.exit(R.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
