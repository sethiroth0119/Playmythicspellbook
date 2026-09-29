/* ═══════════════════════════════════════════════════════════════════════════
   🔗 pw-e2e — the Supply Chain map, driven inside the REAL public/index.html.

   WHY A SEPARATE SUITE. Every other gate in this feature runs against
   `tools/supplychain/harness-*.html`, which loads `fake-bridge.js` and nothing
   else. A harness proves the module works; it cannot prove the module is
   REACHABLE, and "present but not reachable" is the exact failure mode this
   repo has already paid for once — a module that never mounts is reported at
   runtime as "not mounted (non-fatal)", which is indistinguishable from the
   module being absent (CLAUDE.md, "Verifying"). So this file asserts the three
   index.html hunks and only those: the tile exists in the Ruin Exchange, the
   classic bridge block answers with the real game's numbers, the overlay opens
   and closes, and with the module file taken away the tile is simply gone.

   WHAT IT DELIBERATELY DOES NOT RE-TEST. Layout, palette, section order, plan
   wording, 3D framing: those belong to the view pieces' own harnesses and are
   measured there at a dozen viewports. Repeating them here would double the
   cost of the slowest suite in the feature and give a second, weaker verdict.

   🔴 THE ONE NUMBER THAT MATTERS HERE is the one that crosses the seam. The
   suite reads `_opEcon(id).startup` for three operations INSIDE THE PAGE
   through `window.__mg.opsEcon.live` (index.html:98164 — a door that has always
   existed and needed no edit of ours), then reads what the modal PRINTED, and
   requires the printed figure to contain the live one. If the bridge were
   wired to the raw OPS_ECON table instead of `_opEcon`, an admin override would
   make the map lie and every harness in the feature would stay green.

   READ-ONLY. It forces `Profile.cloud.offlineMode`, stubs the first-run gates
   and navigates. It signs nothing in, buys nothing, writes no file in the repo
   and touches no database. The map itself has no way to spend: the bridge has
   no spendGems / addGems / addRes / rpc member, by construction.

   ⚠ ABOUT THE 0.56 Hz BROWSER PANE. That warning is about the Browser pane,
   not about headless Chromium — but the map still has an idle turntable and
   animated freight, so every screenshot here is taken after
   `view().pause()` + `renderNow()` where the view exposes them, and the
   assertions are on the DOM, never on pixels. An A/B of the rendered frame is
   scene3d's job and is done in its own suite, with the render/drawImage rule.

   USAGE
     node tools/supplychain/pw-e2e.mjs                    exit 1 on any failure
     node tools/supplychain/pw-e2e.mjs --json             + the full report
     node tools/supplychain/pw-e2e.mjs --shots <dir>      write the screenshots
   Cost: two Chromium pages in one launch (~35 s). Chromium comes from
   node_modules; the server is node:http on an ephemeral port, so parallel runs
   never collide and nothing is installed.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { withPage, shot } from './shoot.mjs';

const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes('--' + n);
const val = (n, d) => { const i = ARGV.indexOf('--' + n); return (i >= 0 && ARGV[i + 1]) ? ARGV[i + 1] : d; };
const SHOTS = val('shots', null);

/* ── the bootstrap ──────────────────────────────────────────────────────────
   index.html boots into App.screen 'authGate' and only reaches a hub through
   sign-in. App / Profile / render are top-level LEXICAL consts, so this MUST be
   a classic init script: an ES module (and `page.evaluate`, which is one in
   effect for module scope) cannot see them. Modelled on tools/shot.mjs, cut
   down to what this suite needs, and forced on a decaying schedule because the
   app's own async boot keeps re-rendering over us.
   Stubbing the first-run PREDICATES is honest: it changes which screen we land
   on and nothing about how that screen is drawn. Faking a profile instead would
   invent the badges and counts this suite then reads back. */
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
      /* Do not fight the overlay. Once the map is up, re-forcing the hub would
         re-render the page underneath it — which is a real thing that happens
         and looks exactly like the overlay "losing" its host. */
      if (document.getElementById('sc-overlay')) return;
      App.screen = 'title'; App.titleHub = HUB;
      render(); gates();
      S.forced++; S.hub = App.titleHub; S.ready = true;
    } catch (e) { try { S.errors.push('force: ' + ((e && e.stack) || e)); } catch (_) {} }
  }
  [0, 60, 150, 300, 600, 900, 1400, 2000, 2600, 3200].forEach(function (t) { setTimeout(force, t); });
  setInterval(gates, 150);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', force);
  window.addEventListener('load', force);
})();
`;

/* ── the tiny assertion harness ─────────────────────────────────────────────
   Plain, printed as it goes, and it never throws on a failure: a suite that
   stops at the first red tells you one thing per run, and this one costs 35 s.
   `note` records a measurement that is not a pass/fail. */
const R = { pass: 0, fail: 0, rows: [], notes: {}, shots: [] };
const ok = (cond, what, detail) => {
  const good = !!cond;
  R[good ? 'pass' : 'fail']++;
  R.rows.push({ ok: good, what, detail: detail === undefined ? '' : String(detail) });
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${what}${detail === undefined || detail === '' ? '' : '   ' + detail}`);
  return good;
};
const note = (k, v) => { R.notes[k] = v; };
/* Photograph ONE deterministic frame. The map has an idle turntable and moving
   freight, so a shot taken while the RAF loop runs is of an unknown clock;
   pause() + renderNow() in the same task is the rule from CLAUDE.md
   ("Verifying"). Resumed immediately, because a paused scene stops answering
   camera moves and the next step would then photograph a stale frame. */
const png = async (page, name) => {
  if (!SHOTS) return null;
  await page.evaluate(() => {
    try { const v = window.__mg.supplyChain.view(); if (v && v.pause) { v.pause(); v.renderNow && v.renderNow(); } } catch (e) {}
  });
  const f = path.join(SHOTS, name + '.png');
  const abs = await shot(page, f);
  await page.evaluate(() => { try { const v = window.__mg.supplyChain.view(); if (v && v.resume) v.resume(); } catch (e) {} });
  R.shots.push(abs);
  return abs;
};

/* Errors the MAP is responsible for. The real index.html talks to Supabase,
   loads art and registers a service worker (blocked here), so its console is
   noisy for reasons that are not ours; the bar is "0 console errors
   ATTRIBUTABLE TO supplychain", and that is what this filter answers. The
   match is deliberately wide (the folder name, the globals, the overlay id) so
   a stack that only mentions the file path still counts against us. */
const MINE = /supplychain|SupplyChainBridge|MythicSupplyChain|sc-overlay|openSupplyChain/i;
const mine = (errs) => errs.filter((e) => MINE.test(e));

/* ── what to read inside the page ───────────────────────────────────────────
   One evaluate per question, but each question is answered in a single pass so
   it cannot straddle a render. */
function readBridge(members) {
  const b = window.SupplyChainBridge;
  const out = { present: !!b, missing: [], types: {}, answers: {}, threw: {} };
  if (!b) return out;
  for (const m of members) {
    const f = b[m];
    out.types[m] = typeof f;
    if (typeof f !== 'function') out.missing.push(m);
  }
  const probe = {
    opEcon: ['mining'], opLabel: ['mining'], ownsOp: ['mining'], resources: [],
    salvageRes: [], lootResIds: [], structureSalvage: [], held: ['metal'],
    gems: [], isAdmin: [], signedIn: [], transportPhase: [],
  };
  for (const m of Object.keys(probe)) {
    try {
      const v = b[m].apply(b, probe[m]);
      out.answers[m] = (v && typeof v === 'object')
        ? (Array.isArray(v) ? { array: v.length } : { keys: Object.keys(v).length })
        : v;
    } catch (e) { out.threw[m] = String((e && e.message) || e); }
  }
  return out;
}

/* The seam's single most important property, measured on both sides in the
   same task: the bridge's opEcon IS _opEcon, override clamps and all. */
function readOpEconAgreement(ids) {
  const out = {};
  const live = window.__mg && window.__mg.opsEcon && window.__mg.opsEcon.live;
  const b = window.SupplyChainBridge;
  for (const id of ids) {
    let a = null, c = null;
    try { const r = live ? live(id) : null; a = r ? r.startup : null; } catch (e) {}
    try { const r = b ? b.opEcon(id) : null; c = r ? r.startup : null; } catch (e) {}
    out[id] = { live: a, bridge: c, same: a === c };
  }
  return out;
}

// held() must be the alias-folding read of Profile.salvage, not the raw object.
function readHeld(ids) {
  const out = {};
  const b = window.SupplyChainBridge;
  for (const id of ids) {
    let raw = null, viaGetRes = null, viaBridge = null;
    try { raw = (window.Profile && window.Profile.salvage && window.Profile.salvage[id]) | 0; } catch (e) {}
    try { viaGetRes = (typeof window.getRes === 'function') ? (window.getRes(id) | 0) : null; } catch (e) {}
    try { viaBridge = b ? b.held(id) : null; } catch (e) {}
    out[id] = { raw, viaGetRes, viaBridge };
  }
  return out;
}

/* aimAt(page, id) -> {x, y, via} in CLIENT pixels, or null.
   🔴 TWO CONVERSIONS, AND MISSING EITHER ONE LOOKS LIKE "HOVER IS BROKEN".
   project() answers in the canvas's own LAYOUT pixels (scene.js sizes its
   renderer from host.clientWidth/clientHeight), while page.mouse works in
   CLIENT pixels. Inside the real index.html those two spaces differ TWICE: the
   stage starts ~182 px down the overlay, and the app scales its whole UI, so
   the canvas lays out at 1742x752 and paints at 1600x690 — a factor of 0.918
   that getBoundingClientRect() sees and clientWidth does not. Aiming with the
   raw numbers lands ~80 px off the plate, aim() returns null, and nothing at
   all happens. scene.js itself is right: it converts the pointer to a 0..1
   ratio first, which is why a human hovering this map has never had a problem.
   The 2D fallback has no project(), so it falls back to its own DOM button. */
async function aimAt(page, id) {
  return page.evaluate((nid) => {
    const v = window.__mg.supplyChain.view();
    if (v && typeof v.project === 'function') {
      const p = v.project(nid);
      const cv = document.querySelector('#sc-overlay canvas');
      if (cv && p && isFinite(p.x) && isFinite(p.y) && p.visible !== false) {
        const r = cv.getBoundingClientRect();
        const kx = r.width / Math.max(1, cv.clientWidth), ky = r.height / Math.max(1, cv.clientHeight);
        return { x: Math.round(r.left + p.x * kx), y: Math.round(r.top + p.y * ky), via: 'project+scale', kx: Math.round(kx * 1000) / 1000 };
      }
    }
    const el = document.querySelector('[data-sc-node="' + nid + '"]');
    if (el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), via: 'dom' }; }
    return null;
  }, id);
}

/* hoverGeometry() — run INSIDE the page. Answers "is any part of the hover card
   painted UNDER the overlay chrome", which is the thing the old
   "the card is inside the viewport" assertion could not see.

   🔴 WHY THIS EXISTS. The card shipped at z-index 4 while `.sc-head` (the
   search/legend header) is z-index 6 and spans the top ~182 px of the overlay.
   On any node near the top of the stage the card's own HEAD ROW — the business
   NAME, its LIVE/PLANNED badge, its map-page line and the first "Makes…" line —
   was drawn behind the header. 4 of 8 sampled businesses lost 58–129 px at both
   1600x900 and 1366x768, and the viewport-bounds check stayed green the entire
   time. Fixed by SC.hover.zIndex (tuning.js); this assertion is what stops it
   coming back.

   WHY GEOMETRY AND NOT elementFromPoint: the card is `pointer-events:none`, so
   a hit test at its own title returns whatever is behind it whether or not the
   card is on top. So compare RECTS and computed z-index directly. Every
   candidate here is a positioned child of the same stacking context (#sc-overlay
   creates one via its own z-index), so plain numeric z-index comparison is the
   right test; a candidate that is `display:none` or zero-sized is skipped. */
function hoverGeometry() {
  const card = document.getElementById('sc-hover');
  if (!card || getComputedStyle(card).visibility !== 'visible') return null;
  const cz = parseInt(getComputedStyle(card).zIndex, 10) || 0;
  const cr = card.getBoundingClientRect();
  const title = card.querySelector('.sc-hover-title');
  const tr = title ? title.getBoundingClientRect() : cr;
  const SEL = ['.sc-head', '.sc-rail', '.sc-find', '.sc-map-legend', '.sc-foot'];
  const over = [];
  let cardHidden = 0, titleHidden = 0;
  for (const sel of SEL) {
    for (const el of document.querySelectorAll('#sc-overlay ' + sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const z = parseInt(cs.zIndex, 10) || 0;
      if (z < cz) continue;                                   // painted below the card: harmless
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const ix = Math.max(0, Math.min(cr.right, r.right) - Math.max(cr.left, r.left));
      const iy = Math.max(0, Math.min(cr.bottom, r.bottom) - Math.max(cr.top, r.top));
      const tx = Math.max(0, Math.min(tr.right, r.right) - Math.max(tr.left, r.left));
      const ty = Math.max(0, Math.min(tr.bottom, r.bottom) - Math.max(tr.top, r.top));
      if (ix * iy > 0 || tx * ty > 0) over.push({ sel, z, cardPx: Math.round(ix * iy), titlePx: Math.round(tx * ty) });
      cardHidden += ix * iy; titleHidden += tx * ty;
    }
  }
  return {
    z: cz, cardArea: Math.round(cr.width * cr.height),
    cardHidden: Math.round(cardHidden), titleHidden: Math.round(titleHidden),
    titleText: title ? (title.textContent || '').trim() : null,
    rect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) },
    over,
  };
}

async function main() {
  console.log('\n  🔗 Supply Chain — end to end inside the real public/index.html\n');
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  await withPage(async (page, t) => {
    /* The real page's own console noise is not this suite's verdict (see MINE
       above), so errors are collected and filtered rather than made fatal.
       navStatus stays fatal: a 404'd index.html renders a perfectly clean page
       that proves nothing. */
    t.allowErrors = true;
    await page.addInitScript(BOOT('exchange'));

    /* ══ 1. the tile is in the Ruin Exchange ══════════════════════════════ */
    console.log('  ── 1. the tile');
    await t.goto('index.html');
    ok(t.navStatus === null || t.navStatus < 400, 'index.html served', 'HTTP ' + t.navStatus);
    // Wait for the module, then for the hub the forced render draws.
    await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 60000 });
    ok(true, 'the module mounted (window.__mg.supplyChain exists)');
    await page.waitForFunction(() => !!document.getElementById('btn-supply-chain'), null, { timeout: 30000 })
      .catch(() => {});
    const tile = await page.evaluate(() => {
      const el = document.getElementById('btn-supply-chain');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const art = el.querySelector('img');
      return {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        w: Math.round(r.width), h: Math.round(r.height),
        onScreen: r.width > 40 && r.height > 20 && r.top < innerHeight && r.bottom > 0,
        art: art ? art.getAttribute('src') : null,
        hub: (typeof window.__E2E === 'object' && window.__E2E.hub) || null,
      };
    });
    ok(tile, 'btn-supply-chain is rendered in the Ruin Exchange', tile && tile.hub);
    ok(tile && tile.onScreen, 'the tile has a real box on screen', tile && `${tile.w}x${tile.h}`);
    /* The owner named this tile "Supply and Demand Map" (2026-09-26). Pinned on
       the owner's words, not on the feature's folder name — if someone renames
       it back to the developers' "Supply Chain", that is a change the owner did
       not ask for and this line is where it gets caught. */
    ok(tile && /Supply and Demand Map/i.test(tile.text), 'the tile is labelled Supply and Demand Map', tile && tile.text);
    ok(tile && tile.art && /hubtiles/.test(tile.art), 'the tile has a painted art panel (not the bare glyph)', tile && tile.art);
    /* Two tiles on ONE screen wearing the identical painting reads as a bug.
       It shipped that way once (btn-supply-chain and btn-market both took
       operations-salvage-hub.webp), so the art choice is asserted, not eyeballed. */
    const dupeArt = await page.evaluate(() => {
      /* the art is an <img src>, NOT an inline background — reading the style
         attribute here found nothing and made this assertion vacuously green,
         which is the same failure mode it exists to catch */
      const seen = {};
      let tiles = 0;
      for (const el of document.querySelectorAll('[id^="btn-"]')) {
        const img = el.querySelector('img[src*="hubtiles"]');
        if (!img) continue;
        tiles++;
        const src = img.getAttribute('src');
        (seen[src] = seen[src] || []).push(el.id);
      }
      return { tiles, arts: Object.keys(seen).length, dupes: Object.entries(seen).filter(([, ids]) => ids.length > 1).map(([art, ids]) => art.split('/').pop() + ' = ' + ids.join('+')) };
    });
    ok(dupeArt.tiles >= 8, 'the painting sweep actually saw the hub\'s tiles', dupeArt.tiles + ' tiles, ' + dupeArt.arts + ' paintings');
    ok(dupeArt.dupes.length === 0, 'no two tiles on this hub share the same painting', dupeArt.dupes.join(', ') || 'all distinct');
    note('tile', tile);
    await png(page, '01-exchange-hub');

    /* ══ 2. the bridge answers with the real game's numbers ═══════════════ */
    console.log('\n  ── 2. the seam');
    const MEMBERS = ['opEcon', 'opLabel', 'ownsOp', 'resources', 'salvageRes', 'lootResIds',
      'structureSalvage', 'held', 'gems', 'isAdmin', 'signedIn', 'toast', 'confirm',
      'openBusiness', 'transportPhase'];
    const br = await page.evaluate(readBridge, MEMBERS);
    ok(br.present, 'window.SupplyChainBridge exists on the real page');
    ok(br.missing.length === 0, 'all 15 BRIDGE_MEMBERS are functions', br.missing.join(', ') || '15/15');
    ok(Object.keys(br.threw).length === 0, 'no bridge member threw when called', JSON.stringify(br.threw));
    // The four tables the globals trap makes unreachable any other way.
    ok(br.answers.resources && br.answers.resources.array > 100, 'resources() hands over the RESOURCES table', br.answers.resources && br.answers.resources.array);
    ok(br.answers.salvageRes && br.answers.salvageRes.array > 100, 'salvageRes() hands over SALVAGE_RES', br.answers.salvageRes && br.answers.salvageRes.array);
    ok(br.answers.lootResIds && br.answers.lootResIds.array > 5, 'lootResIds() hands over LOOT_RES_IDS', br.answers.lootResIds && br.answers.lootResIds.array);
    ok(br.answers.structureSalvage && br.answers.structureSalvage.keys > 0, 'structureSalvage() hands over STRUCTURE_SALVAGE', br.answers.structureSalvage && br.answers.structureSalvage.keys);
    ok(typeof br.answers.opLabel === 'string' && br.answers.opLabel.length > 0, 'opLabel() answers from OP_LABELS', br.answers.opLabel);
    /* transportPhase must be the module's real routes.PHASE, read LAZILY —
       MythicTransport is an ES module and does not exist when the classic
       bridge block evaluates, so a captured value would be 0 forever. */
    const phase = await page.evaluate(() => {
      const real = (window.MythicTransport && window.MythicTransport.routes && window.MythicTransport.routes.PHASE);
      return { real: (typeof real === 'number') ? real : null, bridge: window.SupplyChainBridge.transportPhase() };
    });
    ok(phase.real === null || phase.bridge === phase.real,
      'transportPhase() is the transport module\'s real routes.PHASE (read lazily)', JSON.stringify(phase));
    note('transportPhase', phase);
    const agree = await page.evaluate(readOpEconAgreement, ['mining', 'medical', 'transport']);
    ok(Object.values(agree).every((a) => a.same && typeof a.live === 'number'),
      'opEcon() IS _opEcon — the same startup for mining / medical / transport', JSON.stringify(agree));
    note('opEcon', agree);
    /* 🔴 SEED THE STOCK FIRST, OR THIS ASSERTION PROVES NOTHING. A signed-out
       test Profile holds zero of everything, so the original form of this check
       compared 0 to 0 and would have stayed green with held() hardwired to
       return 0. The counts below are arbitrary and deliberately not round-ish,
       so a coincidental match is not possible. This writes to the in-memory
       Profile only — no save, no network; the suite already forces offline. */
    await page.evaluate(() => {
      window.Profile = window.Profile || {};
      window.Profile.salvage = window.Profile.salvage || {};
      window.Profile.salvage.metal = 4242;
      window.Profile.salvage.food = 137;
      window.Profile.salvage.cloth = 91;
    });
    const heldRead = await page.evaluate(readHeld, ['metal', 'food', 'cloth']);
    ok(Object.values(heldRead).every((h) => h.viaGetRes === null || h.viaBridge === h.viaGetRes),
      'held() is the alias-folding getRes() read of Profile.salvage', JSON.stringify(heldRead));
    ok(Object.values(heldRead).some((h) => h.viaBridge > 0),
      'held() was proved against a NON-ZERO stock, not 0 === 0',
      Object.entries(heldRead).map(([k, h]) => k + '=' + h.viaBridge).join(' '));
    note('held', heldRead);
    // The read-only guarantee, asserted rather than asserted-in-prose.
    const forbidden = await page.evaluate(() =>
      ['spendGems', 'addGems', 'addRes', 'saveProfile', 'rpc', 'walletApply']
        .filter((k) => typeof window.SupplyChainBridge[k] === 'function'));
    ok(forbidden.length === 0, 'the bridge has NO spend / grant / save / rpc member', forbidden.join(', ') || 'none');

    /* ══ 3. the tile opens the map ════════════════════════════════════════ */
    console.log('\n  ── 3. open');
    const t0 = Date.now();
    await page.click('#btn-supply-chain');
    await page.waitForFunction(() => {
      const s = window.__mg.supplyChain.state();
      return s.open && s.nodes > 0;
    }, null, { timeout: 60000 }).catch(() => {});
    /* 🔴 THE 3D MAP IS A RACE, AND INSIDE THE REAL PAGE IT LOSES.
       render.js mountView() gives mountScene() UI.sceneTimeoutMs (2200 ms,
       render.js:102) and draws the 2D fallback if three.js and the scene are
       not both ready — and a scene that arrives late is DISPOSED, so the view
       never upgrades afterwards. In the isolated harness the scene wins
       comfortably. In public/index.html, with a 15 MB script still settling,
       it does not always: the footer then reads "2D view (no WebGL)" on a
       machine whose WebGL is fine. So this suite MEASURES the race over
       several opens instead of asserting one lucky run, and reports the count.
       WebGL itself is proven separately, in the page, so a 2D result can never
       be mistaken for a machine without a GPU. */
    const gl = await page.evaluate(() => {
      try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
      catch (e) { return false; }
    });
    ok(gl, 'the page really can get a WebGL context (so 2D would be a race, not a GPU)');
    const race = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForFunction(() => window.__mg.supplyChain.state().view !== null, null, { timeout: 30000 }).catch(() => {});
      const v = await page.evaluate(() => window.__mg.supplyChain.state().view);
      race.push(v);
      if (v === 'scene') break;
      await page.evaluate(async () => { window.__mg.supplyChain.close(); await new Promise((r) => setTimeout(r, 300)); window.__mg.supplyChain.open(); });
      await page.waitForTimeout(1200);
    }
    note('sceneRace', race);
    ok(race.includes('scene'), 'the real page does reach the 3D map (WebGL, three r128)', race.join(' → '));
    const openState = await page.evaluate(() => window.__mg.supplyChain.state());
    note('viewUsed', openState.view);
    note('openMs', Date.now() - t0);
    ok(openState.open, 'clicking the tile opened the map', (Date.now() - t0) + ' ms');
    /* A BUDGET, because "it opens" said nothing about how long the player
       stares at an empty overlay. Measured 5.8–9.7 s here; headless software
       WebGL has no GPU, so a real machine is faster and this ceiling is loose
       on purpose — it is a regression tripwire (a 20 s open should fail the
       suite), not a performance target. */
    const OPEN_BUDGET_MS = 18000;
    ok((Date.now() - t0) < OPEN_BUDGET_MS, 'the map is usable well inside the open budget',
      (Date.now() - t0) + ' ms of ' + OPEN_BUDGET_MS + ' ms');
    ok(openState.nodes === 33, 'the map carries all 33 nodes (27 tiles + 4 systems + 2 channels)', openState.nodes);
    ok(openState.errors === 0, 'the graph reports zero errors inside the real page', openState.errors);
    ok(openState.bridge === true, 'the module sees the bridge', openState.bridge);
    const zc = await page.evaluate(() => {
      const el = document.getElementById('sc-overlay');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { z: cs.zIndex, pos: cs.position, vis: cs.visibility, h: Math.round(el.getBoundingClientRect().height) };
    });
    ok(zc && Number(zc.z) >= 2147483400, 'the overlay is above every legacy layer', zc && zc.z);
    ok(zc && zc.h > 300, 'the overlay fills the screen', zc && zc.h);
    await png(page, '02-map-open');

    /* ══ 4. hover ═════════════════════════════════════════════════════════ */
    console.log('\n  ── 4. hover');
    /* project(id) is the view's own screen-space answer for a node; using it
       instead of a guessed pixel is the difference between hovering Medical and
       hovering whatever happens to be at (700, 400). A 2D fallback view has no
       project(), so fall back to its own [data-sc-node] button. */
    /* Wait for the camera to SETTLE before asking where Medical is. open() fits
       the map with a tween, so project() answered 850 px down a 690 px canvas
       while the fly-in was still running — a point off the bottom of the stage,
       which then read as "hover is broken" instead of "the test aimed early".
       Poll the projection itself rather than sleeping a magic number. */
    await page.waitForFunction(() => {
      try {
        const v = window.__mg.supplyChain.view();
        if (!v || !v.project) return true;                   // the 2D fallback: no camera to settle
        const cv = document.querySelector('#sc-overlay canvas');
        const p = v.project('medical');
        // p is in LAYOUT pixels, so compare it against clientHeight, not the rect.
        return !!(p && p.visible && cv && p.y > 4 && p.y < cv.clientHeight - 4);
      } catch (e) { return false; }
    }, null, { timeout: 20000 }).catch(() => {});
    const spot = await aimAt(page, 'medical');
    ok(spot, 'the view can point at Medical Corporation', JSON.stringify(spot));
    if (spot) {
      /* Two moves, a beat apart: render.js debounces the hover, and a single
         synthetic move that happens to land on the tile the pointer is already
         "on" is swallowed by scene.js's `id === hovered` early return. */
      await page.mouse.move(spot.x - 6, spot.y - 4);
      await page.waitForTimeout(250);
      await page.mouse.move(spot.x, spot.y);
      await page.waitForFunction(() => {
        const c = document.getElementById('sc-hover');
        return !!c && getComputedStyle(c).visibility === 'visible' && c.textContent.length > 40;
      }, null, { timeout: 10000 }).catch(() => {});
    }
    const hov = await page.evaluate(() => {
      const c = document.getElementById('sc-hover');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return {
        visible: getComputedStyle(c).visibility === 'visible',
        text: (c.textContent || '').replace(/\s+/g, ' ').trim(),
        onScreen: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    ok(hov && hov.visible, 'hovering a business shows the hover card', hov && `${hov.w}x${hov.h}`);
    ok(hov && hov.onScreen, 'the hover card is inside the viewport');
    ok(hov && hov.text.length > 80, 'the hover card says something', hov && hov.text.length + ' chars');
    note('hover', hov && hov.text.slice(0, 200));
    await png(page, '03-hover');

    /* ── 4b. the card is ON TOP, not under the chrome ─────────────────────
       See hoverGeometry()'s header for why this assertion exists and why
       "inside the viewport" was never enough. Swept over the eight businesses
       at two viewports, because the failure depends on where the node sits: it
       only bites the ones the camera puts near the top of the stage, and which
       ones those are changes with the aspect ratio. */
    const SWEEP = ['carfactory', 'medical', 'fishing', 'transport', 'mining', 'fashion', 'warehouse', 'bank'];
    const sweeps = {};
    for (const [vw, vh] of [[1600, 900], [1366, 768]]) {
      await page.setViewportSize({ width: vw, height: vh });
      await page.waitForTimeout(500);
      const rows = [];
      for (const id of SWEEP) {
        const s = await aimAt(page, id);
        if (!s) { rows.push({ id, aimed: false }); continue; }
        await page.mouse.move(s.x - 6, s.y - 4);
        await page.waitForTimeout(140);
        await page.mouse.move(s.x, s.y);
        await page.waitForTimeout(260);
        const g = await page.evaluate(hoverGeometry);
        rows.push(g ? { id, aimed: true, ...g } : { id, aimed: true, shown: false });
      }
      sweeps[vw + 'x' + vh] = rows;
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(500);
    const shown = Object.values(sweeps).flat().filter((r) => r && r.z !== undefined);
    const titleCovered = shown.filter((r) => r.titleHidden > 0);
    const anyCovered = shown.filter((r) => r.cardHidden > 0);
    ok(shown.length >= 8, 'the sweep actually saw hover cards', shown.length + ' of ' + (SWEEP.length * 2));
    ok(shown.length > 0 && shown.every((r) => r.z >= 7),
      'the hover card is painted above the overlay chrome (z)', shown.length ? 'z=' + shown[0].z : '');
    ok(titleCovered.length === 0,
      "no business's name is hidden behind the chrome",
      titleCovered.map((r) => r.id + ' ' + r.titleHidden + 'px²').join(', ') || 'clean');
    ok(anyCovered.length === 0,
      'no part of any hover card is painted under the chrome',
      anyCovered.map((r) => r.id + ' ' + r.over.map((o) => o.sel).join('+')).join(', ') || 'clean');
    note('hoverSweep', sweeps);
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'hover-sweep.json'), JSON.stringify(sweeps, null, 2));

    /* re-settle the pointer on Medical for the modal step below */
    if (spot) { const s2 = await aimAt(page, 'medical'); if (s2) { spot.x = s2.x; spot.y = s2.y; } }

    /* ══ 5. click → the modal, with the live figures ══════════════════════ */
    console.log('\n  ── 5. the modal');
    if (spot) await page.mouse.click(spot.x, spot.y);
    await page.waitForFunction(() => !!document.querySelector('[data-sc-modal]'), null, { timeout: 15000 }).catch(() => {});
    const modal = await page.evaluate(() => {
      const m = document.querySelector('[data-sc-modal]');
      if (!m) return null;
      return {
        text: (m.textContent || '').replace(/\s+/g, ' ').trim(),
        chars: (m.textContent || '').length,
        secs: m.querySelectorAll('.scm-sec').length,
        links: m.querySelectorAll('.scm-link').length,
        tags: { live: m.querySelectorAll('.scm-tag.live').length, planned: m.querySelectorAll('.scm-tag.planned').length },
      };
    });
    ok(modal, 'clicking a business opens the modal');
    ok(modal && modal.chars > 3000, 'the modal is a full card, not a stub', modal && modal.chars + ' chars');
    ok(modal && modal.secs >= 7, 'the modal has the owner\'s seven sections', modal && modal.secs);
    ok(modal && modal.tags.live > 0 && modal.tags.planned > 0,
      'the modal separates LIVE from PLANNED on the player\'s screen', modal && JSON.stringify(modal.tags));
    /* The "Open readings of the map" block is the team's unresolved reading of
       the owner's PDF. It is admin-only (modal.js) because a player cannot act
       on it and it reads as the map contradicting itself. This account is not
       an admin, so it must not be here. */
    ok(modal && !/open readings of the map/i.test(modal.text),
      'the player-facing modal does not print the team\'s design debate',
      modal && /open readings of the map/i.test(modal.text) ? 'LEAKED' : 'clean');
    /* 🔴 THE HEADLINE CROSS-CHECK. The startup Cinder printed on the card must
       be the figure _opEcon answers with INSIDE this page, for three different
       operations, formatted the way the page formats numbers. A bridge wired to
       the raw table instead of _opEcon passes every harness and fails here. */
    const money = await page.evaluate(async (ids) => {
      const live = window.__mg.opsEcon.live;
      const out = {};
      for (const id of ids) {
        const row = live(id);
        const want = row && typeof row.startup === 'number' ? row.startup : null;
        window.__mg.supplyChain.open({ select: id });
        await new Promise((r) => setTimeout(r, 450));
        const m = document.querySelector('[data-sc-modal]');
        const txt = m ? (m.textContent || '').replace(/\s+/g, ' ') : '';
        out[id] = {
          want,
          printed: want === null ? null : (txt.includes(want.toLocaleString()) || txt.includes(String(want))),
          head: txt.slice(0, 60),
        };
      }
      return out;
    }, ['mining', 'medical', 'transport']);
    ok(Object.values(money).every((m) => m.printed === true),
      'the modal prints the LIVE _opEcon startup for mining / medical / transport', JSON.stringify(money));
    note('money', money);
    await png(page, '04-modal');

    /* ══ 6. a partner click re-targets the modal ══════════════════════════ */
    console.log('\n  ── 6. partners');
    const nav = await page.evaluate(async () => {
      const before = window.__mg.supplyChain.state().selected;
      const m = document.querySelector('[data-sc-modal]');
      const links = m ? Array.from(m.querySelectorAll('.scm-link[data-id]')) : [];
      const target = links.find((a) => a.dataset.id && a.dataset.id !== before);
      if (!target) return { links: links.length, clicked: null };
      const id = target.dataset.id;
      target.click();
      await new Promise((r) => setTimeout(r, 600));
      return { links: links.length, clicked: id, before, after: window.__mg.supplyChain.state().selected };
    });
    ok(nav.links > 0, 'the modal offers partners to click', nav.links + ' links');
    ok(nav.clicked && nav.after === nav.clicked, 'a partner click re-targets the modal', JSON.stringify(nav));
    await png(page, '05-partner');

    /* ══ 7. search ════════════════════════════════════════════════════════ */
    console.log('\n  ── 7. search');
    await page.evaluate(() => { const m = document.querySelector('[data-sc-modal]'); if (m) { const b = m.querySelector('[data-a="close"], .scm-close'); if (b) b.click(); } });
    await page.fill('#sc-overlay .sc-search input', 'cloth');
    await page.waitForTimeout(900);
    const search = await page.evaluate(() => {
      const s = window.__mg.supplyChain.state();
      const root = document.getElementById('sc-overlay');
      return { flow: s.flow, text: (root.textContent || '').replace(/\s+/g, ' ').includes('cloth') };
    });
    ok(search.flow === 'cloth', 'searching a resource sets the resource flow', JSON.stringify(search));
    await png(page, '06-search-cloth');

    /* ══ 8. close restores the hub ════════════════════════════════════════ */
    console.log('\n  ── 8. close');
    await page.evaluate(() => window.__mg.supplyChain.close());
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      overlays: document.querySelectorAll('#sc-overlay').length,
      hover: document.querySelectorAll('#sc-hover').length,
      modal: document.querySelectorAll('[data-sc-modal]').length,
      tile: !!document.getElementById('btn-supply-chain'),
      open: window.__mg.supplyChain.state().open,
    }));
    ok(after.overlays === 0 && after.hover === 0 && after.modal === 0, 'close() leaves nothing behind', JSON.stringify(after));
    ok(after.tile, 'the Ruin Exchange and its tile are back underneath');
    ok(after.open === false, 'the probe agrees the map is closed');
    await png(page, '07-closed-back-on-hub');

    /* ══ 9. zero console errors attributable to the map ═══════════════════ */
    console.log('\n  ── 9. the console');
    const ours = mine(t.errors);
    ok(ours.length === 0, '0 console errors attributable to supplychain', ours.slice(0, 4).join(' | ') || `0 of ${t.errors.length} page errors`);
    note('pageErrors', t.errors.length);
    note('ourErrors', ours);

    /* ══ 10. the module taken away: the tile must simply disappear ════════
       The weaponsmith lesson, tested rather than asserted. A second page in the
       same context, with the module's request routed to a 404 — everything else
       identical. A tile that stayed would be a dead button for every player on
       the day a deploy misses a file. */
    console.log('\n  ── 10. with the module file taken away');
    const p2 = await t.newPage('no-module');
    await p2.route('**/src/supplychain/index.js*', (r) => r.fulfill({ status: 404, body: '' }));
    await p2.addInitScript(BOOT('exchange'));
    await p2.goto(t.url('index.html'), { waitUntil: 'load', timeout: 60000 });
    await p2.waitForFunction(() => !!(window.__E2E && window.__E2E.ready), null, { timeout: 60000 }).catch(() => {});
    await p2.waitForTimeout(2500);
    const gone = await p2.evaluate(() => ({
      module: !!window.MythicSupplyChain,
      bridge: !!window.SupplyChainBridge,
      tile: !!document.getElementById('btn-supply-chain'),
      tiles: document.querySelectorAll('.hub-portal, [id^="btn-"]').length,
    }));
    ok(gone.module === false, 'the module really is absent on this page');
    ok(gone.tile === false, 'the Supply Chain tile is GONE, not dead', JSON.stringify(gone));
    ok(gone.bridge === true, 'the bridge block still evaluated (it is independent of the module)');
    ok(gone.tiles > 5, 'the rest of the Ruin Exchange is untouched', gone.tiles + ' tiles');
    await png(p2, '08-module-absent-no-tile');
  }, { w: 1600, h: 900 });

  console.log(`\n  ${R.fail === 0 ? '✅' : '❌'} pw-e2e: ${R.pass} passed, ${R.fail} failed`);
  if (SHOTS) console.log('  shots: ' + SHOTS);
  if (flag('json')) console.log('\n' + JSON.stringify(R, null, 2));
  process.exit(R.fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\n  ❌ pw-e2e threw:\n', (e && e.stack) || e); process.exit(1); });
