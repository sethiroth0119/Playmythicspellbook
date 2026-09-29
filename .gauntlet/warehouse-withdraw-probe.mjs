/* ══════════════════════════════════════════════════════════════════════════
   WAREHOUSE WITHDRAW + PLANKS PROBE

   Two player reports from the in-game feature board:

     A. Mavric (Gameplay) — "The ability to withdraw selected items from
        warehouse without pulling everything out. Instead of having to empty
        the warehouse if we need something, we would be able to select from the
        same type of list we select from when we add to the warehouse and only
        pull out selected items."
     B. James (UI/Interface) — "Add planks as a resource displayed in the
        stores UI. Currently Planks are not shown on the stores ui."

   WHAT THIS DRIVES, AND WHY IT IS NOT A MOCK OF THE FEATURE.
   ---------------------------------------------------------------------------
   A. The page's REAL _whOpenMyStorage / _whOpenTakeModal / _whWithdrawSelected
      run. Only the NETWORK is faked: Cloud.client.rpc is replaced with a
      JavaScript twin of public.wh_withdraw from
      supabase/migrations/20260812000000_warehouse_storage.sql:1458 — the same
      `least(v_have, floor(p_qty))` clamp, the same contents/used_kg update, the
      same `nothing_there` refusals. The bay it holds IS the assertion surface:
      if the client asks for the wrong thing, the twin moves the wrong thing.

   🔴 THE GLOBALS TRAP IS WHY THIS INJECTS A SCRIPT INSTEAD OF page.evaluate.
      `Cloud`, `Profile`, `_whRpc` and everything else this needs are top-level
      `const`/`function` in index.html's classic script — global LEXICAL
      bindings, not properties of `window` (CLAUDE.md). page.evaluate runs in a
      function scope that can read them but cannot see them as `window.Cloud`,
      and `Cloud.ready = true` from there works only because we reach the
      binding by name. A second CLASSIC <script> tag shares the global lexical
      environment, so the harness is injected as one, before </body>, into BOTH
      the HEAD page and the candidate — identical injection, fair comparison.

   B. node-city's Stores popover (#topbar, re-homed by src/hud/statusbar.js).
      The assertion is not "a span exists": it is that `updateHUD()` WROTE to
      #d-planks. That loop is `for (const r of HUD_DISPLAY_RES) $('r-'+r)…` and
      it sets className to 'd ' (trailing space) on every pass, while the
      shipped markup says class="d". So a written chip is provably ON the list
      AND paired to markup — which is the one edit node-city's own note above
      HUD_DISPLAY_RES insists must never be half-made. #d-wood is the control:
      if the control never gets written the city never ticked and the result is
      reported INCONCLUSIVE rather than passed.

   Usage:
     node .gauntlet/warehouse-withdraw-probe.mjs                        # HEAD
     node .gauntlet/warehouse-withdraw-probe.mjs cand-index.html cand-node-city.html
   Needs the static server on http://localhost:8787.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const ARGV = process.argv.slice(2).filter((a) => a !== '--shots');
const SHOTS = process.argv.includes('--shots');   // also write PNGs of both screens
const CAND_INDEX = ARGV[0] || null;
const CAND_CITY = ARGV[1] || null;

const R = [];
const ok = (label, cond, detail) => R.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });

/* ── the injected harness. Kept free of backticks and of template
      interpolation on purpose: it is embedded verbatim into the HTML. ── */
const HARNESS = '<script>\n' + [
  'window.__whProbe = (function () {',
  '  var W = { metal: 2, wood: 1, planks: 1 };',
  '  var BAY = null, calls = [];',
  '  function weigh(m) { var n = 0; for (var k in m) n += m[k] * (W[k] || 1); return n; }',
  '  function reset() {',
  '    BAY = { unit_id: "bay-1", bay_no: 7, warehouse_id: "wh-1", owner_name: "Nyx",',
  '            capacity_kg: 5000, used_kg: 0, contents: { metal: 100, wood: 40, planks: 25 } };',
  '    BAY.used_kg = weigh(BAY.contents);',
  '    calls = [];',
  '  }',
  /* A faithful twin of public.wh_withdraw. Deliberately NOT written from the
     client’s point of view: it refuses and clamps exactly where the SQL
     does, so a client that over-asks is caught here rather than flattered. */
  '  function srv(fn, a) {',
  '    a = a || {};',
  '    if (fn === "wh_config") return { weights: W, max_shipment_kg: 18000, default_weight: 1 };',
  '    if (fn === "wh_my_rentals") return [JSON.parse(JSON.stringify(BAY))];',
  '    if (fn === "wh_my_shipments") return [];',
  '    if (fn === "wh_my_resources") return { metal: 5 };',
  '    if (fn === "wh_withdraw") {',
  '      if (String(a.p_unit_id) !== BAY.unit_id) return { ok: false, reason: "no_unit" };',
  '      var keys = Object.keys(BAY.contents);',
  '      if (!keys.length) return { ok: false, reason: "nothing_there" };',
  '      var out;',
  '      if (a.p_resource == null) {',
  '        out = BAY.contents; BAY.contents = {}; BAY.used_kg = 0;',
  '        return { ok: true, payload: out, weight_kg: weigh(out), unit_id: BAY.unit_id };',
  '      }',
  '      var have = +BAY.contents[a.p_resource] || 0;',
  '      var want = (a.p_qty == null) ? have : Math.floor(+a.p_qty || 0);',
  '      var take = Math.min(have, Math.max(0, want));',
  '      if (take <= 0) return { ok: false, reason: "nothing_there" };',
  '      out = {}; out[a.p_resource] = take;',
  '      if (have - take <= 0) delete BAY.contents[a.p_resource];',
  '      else BAY.contents[a.p_resource] = have - take;',
  '      BAY.used_kg = Math.max(0, BAY.used_kg - weigh(out));',
  '      return { ok: true, payload: out, weight_kg: weigh(out), unit_id: BAY.unit_id };',
  '    }',
  '    return null;',
  '  }',
  '  function install() {',
  '    reset();',
  '    Cloud.ready = true;',
  '    Cloud._initError = null;',
  '    Profile.cloud = Profile.cloud || {};',
  '    Profile.cloud.signedIn = true;',
  '    Profile.cloud.userId = "probe-user";',
  '    Profile.cloud.displayName = "Probe";',
  '    Cloud.client = { rpc: function (fn, args) { calls.push({ fn: fn, args: args });',
  '                       return Promise.resolve({ data: srv(fn, args), error: null }); } };',
  '    var L = _ensureResources();',
  '    for (var k in L) delete L[k];',
  '    L.metal = 5;',
  '    return true;',
  '  }',
  '  function stash() { var L = _ensureResources(), o = {}; for (var k in L) if ((L[k] | 0) > 0) o[k] = L[k] | 0; return o; }',
  '  function sum(m) { var n = 0; for (var k in m) n += m[k] | 0; return n; }',
  '  return {',
  '    install: install, reset: reset,',
  '    bay: function () { return JSON.parse(JSON.stringify(BAY)); },',
  '    stash: stash,',
  '    total: function () { return sum(BAY.contents) + sum(stash()); },',
  '    weigh: weigh,',
  '    calls: function () { return calls.slice(); },',
  '    clearCalls: function () { calls = []; },',
  '    plan: function (c, s) { return _whTakePlan(c, s); },',
  '    mine: function () { return _whOpenMyStorage(); },',
  '    pick: function (u) { return _whOpenTakeModal(u); },',
  '    take: function (u, c, s) { return _whWithdrawSelected(u, c, s); }',
  '  };',
  '})();',
].join('\n') + '\n</script>\n';

function inject(html) {
  const n = html.split('</body>').length - 1;
  if (n !== 1) throw new Error('</body> matched ' + n + ' times');
  return html.replace('</body>', HARNESS + '</body>');
}

const b = await chromium.launch();

/* ───────────────────────── A · the warehouse ───────────────────────── */
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message || e)));
  const src = CAND_INDEX ? fs.readFileSync(CAND_INDEX, 'utf8') : fs.readFileSync('public/index.html', 'utf8');
  const body = inject(src);
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }));
  await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 90000 });
  await p.waitForFunction(() => window.__whProbe && window.__mg && window.__mg.warehouse, null, { timeout: 60000 });

  const present = await p.evaluate(() => ({
    takePlan: typeof (window.__mg.warehouse.takePlan) === 'function',
    takeSelected: typeof (window.__mg.warehouse.takeSelected) === 'function',
    takeModal: typeof (window.__mg.warehouse.take) === 'function',
  }));
  ok('A0  the selective-withdraw entry points exist (__mg.warehouse.take / takePlan / takeSelected)',
    present.takePlan && present.takeSelected && present.takeModal, JSON.stringify(present));

  const out = await p.evaluate(async () => {
    const P = window.__whProbe;
    const res = [];
    const say = (label, cond, detail) => res.push({ label, pass: !!cond, detail: detail == null ? '' : String(detail) });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    P.install();

    const t0 = P.total();
    say('A1  fixture: bay holds 165 units (metal 100 / wood 40 / planks 25), stash holds 5 metal',
      P.total() === 170 && P.bay().contents.metal === 100, JSON.stringify({ bay: P.bay().contents, stash: P.stash() }));

    // ── the picker exists at all, and it is reached from My storage ────────
    await P.mine();
    await sleep(120);
    const store = document.getElementById('wh-storage');
    const pickBtn = store && store.querySelector('.wh-pick');
    say('A2  My storage offers a selective take beside "Withdraw all"', !!pickBtn,
      store ? ('buttons: ' + Array.from(store.querySelectorAll('button')).map((x) => x.textContent.trim()).join(' | ')) : 'no #wh-storage');
    if (!pickBtn) return res;                              // nothing below can run on HEAD

    pickBtn.click();
    await sleep(250);
    let modal = document.getElementById('wh-take');
    say('A3  it opens a picker of the same shape as the send list (one numeric input per resource)',
      !!modal && modal.querySelectorAll('.wh-tqty').length === 3,
      modal ? ('inputs=' + modal.querySelectorAll('.wh-tqty').length) : 'no #wh-take');
    if (!modal) return res;

    const maxes = {};
    modal.querySelectorAll('.wh-tqty').forEach((i) => { maxes[i.dataset.res] = +i.max; });
    say('A4  each row is capped at what the BAY holds — the mirror of the send list capping at the stash',
      maxes.metal === 100 && maxes.wood === 40 && maxes.planks === 25, JSON.stringify(maxes));

    // ── a cancelled picker changes NOTHING ────────────────────────────────
    P.clearCalls();
    modal.querySelectorAll('.wh-tqty').forEach((i) => { i.value = String(i.max); i.dispatchEvent(new Event('input')); });
    modal.querySelector('.wh-x').click();
    await sleep(200);
    say('A5  a cancelled picker moves nothing — no server call, bay and stash untouched',
      P.calls().filter((c) => c.fn === 'wh_withdraw').length === 0
      && P.total() === t0 && P.bay().contents.metal === 100 && (P.stash().metal | 0) === 5,
      'withdraw calls=' + P.calls().filter((c) => c.fn === 'wh_withdraw').length + ' total=' + P.total());

    // ── the partial take itself ───────────────────────────────────────────
    await P.pick('bay-1');
    await sleep(250);
    modal = document.getElementById('wh-take');
    const set = (id, v) => { const i = modal.querySelector('.wh-tqty[data-res="' + id + '"]'); i.value = String(v); i.dispatchEvent(new Event('input')); };
    set('metal', 30); set('wood', 0); set('planks', 25);
    P.clearCalls();
    modal.querySelector('.wh-take-go').click();
    await sleep(700);

    const bay = P.bay(), st = P.stash();
    say('A6  ONLY the selected amounts left the bay — metal 100→70, planks 25→0',
      (bay.contents.metal | 0) === 70 && !('planks' in bay.contents), JSON.stringify(bay.contents));
    say('A7  the rest STAYS — wood was left at 0 and is still all there',
      (bay.contents.wood | 0) === 40, JSON.stringify(bay.contents));
    say('A8  the stash was credited with exactly what was taken — metal 5→35, planks 0→25',
      (st.metal | 0) === 35 && (st.planks | 0) === 25 && !(st.wood | 0), JSON.stringify(st));
    say('A9  nothing minted, nothing lost — bay + stash still totals ' + t0,
      P.total() === t0, 'total=' + P.total());
    say('A10 the bay’s weight reconciles with what is left in it',
      Math.abs(bay.used_kg - P.weigh(bay.contents)) < 1e-6, 'used_kg=' + bay.used_kg + ' weigh=' + P.weigh(bay.contents));
    const wcalls = P.calls().filter((c) => c.fn === 'wh_withdraw');
    say('A11 it asked the server per selected resource, with p_resource AND p_qty — never the empty-the-bay call',
      wcalls.length === 2 && wcalls.every((c) => c.args.p_resource && c.args.p_qty > 0),
      JSON.stringify(wcalls.map((c) => [c.args.p_resource, c.args.p_qty])));

    // ── the clamps and refusals, matched against the deposit picker's ─────
    const over = P.plan({ metal: 70, wood: 40 }, { metal: 99999, wood: 5 });
    say('A12 an over-ask is clamped to what the bay holds, exactly as the send list clamps to the stash',
      over.take.metal === 70 && over.take.wood === 5 && over.clamped === 99929, JSON.stringify(over));
    const junk = P.plan({ metal: 70 }, { metal: -4, nope: 10, wood: 2.9 });
    say('A13 negatives, unknown ids and fractions are dropped or floored before anything is asked for',
      Object.keys(junk.take).length === 0, JSON.stringify(junk));
    const none = await P.take('bay-1', { metal: 70 }, {});
    say('A14 an empty selection refuses instead of emptying the bay (the deposit picker’s "pick at least one")',
      none === null && (P.bay().contents.metal | 0) === 70, 'returned=' + JSON.stringify(none));

    // ── "Withdraw all" still works, and is still one click ────────────────
    P.clearCalls();
    await P.mine();
    await sleep(200);
    const allBtn = document.getElementById('wh-storage').querySelector('.wh-take');
    allBtn.click();
    await sleep(700);
    say('A15 "Withdraw all" is unchanged — one click still empties the bay, and still conserves the total',
      Object.keys(P.bay().contents).length === 0 && P.total() === t0,
      JSON.stringify({ bay: P.bay().contents, total: P.total() }));
    return res;
  });
  out.forEach((r) => R.push(r));
  if (SHOTS) {
    // Re-open the two screens purely to photograph them.
    await p.evaluate(async () => {
      window.__whProbe.install();
      await window.__whProbe.mine();
      await new Promise((r) => setTimeout(r, 300));
    });
    await p.screenshot({ path: '.gauntlet/shots/warehouse-my-storage.png' });
    await p.evaluate(async () => {
      const b2 = document.getElementById('wh-storage').querySelector('.wh-pick');
      b2.click();
      await new Promise((r) => setTimeout(r, 400));
      const m = document.getElementById('wh-take');
      const set = (id, v) => { const i = m.querySelector('.wh-tqty[data-res="' + id + '"]'); if (i) { i.value = String(v); i.dispatchEvent(new Event('input')); } };
      set('metal', 30); set('planks', 25);
    });
    await p.screenshot({ path: '.gauntlet/shots/warehouse-take-picker.png' });
  }
  const bad = errs.filter((e) => !/supabase|Failed to fetch|NetworkError|net::/i.test(e));
  ok('A16 no page errors while driving the withdraw flow', bad.length === 0, bad.slice(0, 3).join(' | '));
  await ctx.close();
}

/* ───────────────────────── B · planks in Stores ───────────────────────── */
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message || e)));
  if (CAND_CITY) {
    const html = fs.readFileSync(CAND_CITY, 'utf8');
    await p.route('**/node-city/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  }
  await p.goto('http://localhost:8787/node-city/index.html', { waitUntil: 'load', timeout: 90000 });
  await p.waitForSelector('#topbar', { timeout: 60000 });

  // The control first: wait until updateHUD has written a chip we know ships.
  let ticked = false;
  try {
    await p.waitForFunction(() => {
      const d = document.getElementById('d-wood');
      return d && d.getAttribute('class') !== 'd';
    }, null, { timeout: 30000 });
    ticked = true;
  } catch (e) { ticked = false; }

  const b1 = await p.evaluate(() => {
    const chip = document.getElementById('r-planks');
    const d = document.getElementById('d-planks');
    const host = chip && chip.closest('#topbar');
    const row = chip && chip.closest('.res');
    return {
      chip: !!chip,
      inTopbar: !!host,
      icon: row ? (row.querySelector('.ico') || {}).textContent : null,
      tip: row ? !!row.querySelector('.rtip') : false,
      dClass: d ? d.getAttribute('class') : null,
      woodClass: (document.getElementById('d-wood') || {}).getAttribute ? document.getElementById('d-wood').getAttribute('class') : null,
      text: chip ? chip.textContent : null,
      order: Array.from(document.querySelectorAll('#topbar .res .amt')).map((x) => x.id).join(','),
    };
  });
  ok('B1  the Stores popover has a Planks chip', b1.chip && b1.inTopbar, JSON.stringify({ inTopbar: b1.inTopbar }));
  ok('B2  it is formatted like its neighbours — \u{1FA9A} icon and a hover tip', b1.icon === '\u{1FA9A}' && b1.tip, 'icon=' + b1.icon + ' tip=' + b1.tip);
  ok('B3  it sits with the construction materials (wood, stone, planks, cloth)',
    /r-wood,r-stone,r-planks,r-cloth/.test(b1.order || ''), b1.order);
  if (!ticked) {
    ok('B4  updateHUD writes the chip (so planks really is on HUD_DISPLAY_RES) — INCONCLUSIVE, the city never ticked',
      false, 'control #d-wood was never written; re-run with the city able to boot');
  } else {
    ok('B4  updateHUD writes the chip, so planks is on HUD_DISPLAY_RES and paired to markup (control #d-wood=' + JSON.stringify(b1.woodClass) + ')',
      b1.dClass != null && b1.dClass !== 'd', 'd-planks class=' + JSON.stringify(b1.dClass));
  }
  ok('B5  the number comes from the same readout as every other chip (no second counter)',
    b1.text != null && /^[0-9,]+$/.test(String(b1.text).trim()), 'text=' + JSON.stringify(b1.text));

  /* The 📦 Stores button is created by src/hud/index.js, imported LATE and
     awaited (node-city/index.html:54058) — measured ~10 s behind the first HUD
     tick in this box. Waiting on the button, not on the tick, or B6 asks
     before the dock exists and reports a mount delay as a missing chip. */
  try { await p.waitForSelector('#ncsb-stores', { timeout: 45000 }); } catch (e) {}
  // the popover actually opens with it inside
  const shown = await p.evaluate(async () => {
    const btn = document.getElementById('ncsb-stores');
    if (!btn) return 'no-button';
    btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const tb = document.getElementById('topbar');
    const chip = document.getElementById('r-planks');
    if (!tb || !chip) return 'no-chip';
    return tb.classList.contains('ncopen') && chip.getClientRects().length > 0 ? 'visible' : 'hidden';
  });
  ok('B6  opening 📦 Stores shows it on screen', shown === 'visible', shown);
  if (SHOTS && shown === 'visible') {
    const tb = await p.$('#topbar');
    if (tb) await tb.screenshot({ path: '.gauntlet/shots/stores-planks.png' });
  }
  const bad = errs.filter((e) => !/supabase|Failed to fetch|NetworkError|net::/i.test(e));
  ok('B7  the city boots with no page error (an unpaired HUD id throws inside updateHUD)', bad.length === 0, bad.slice(0, 3).join(' | '));
  await ctx.close();
}

await b.close();

const pass = R.filter((r) => r.pass).length;
console.log('\n══ WAREHOUSE WITHDRAW + PLANKS ══  ' + (CAND_INDEX || CAND_CITY ? 'CANDIDATE' : 'HEAD') + '\n');
R.forEach((r) => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.label + (r.detail ? '\n        ' + r.detail : '')));
console.log('\n  ' + pass + ' / ' + R.length + ' checks passed\n');
process.exit(pass === R.length ? 0 : 1);
