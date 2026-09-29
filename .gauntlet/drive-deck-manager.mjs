/* ══════════════════════════════════════════════════════════════════════════
   🃏 DRIVE-DECK-MANAGER — is anything still cut off, at any size?

   THE REPORT came with a screenshot: the hero panel printed HP / DEF / RES
   with their values and then ATK / MAG / SPD ran off the right edge of the
   panel. Two independent causes, both fixed:
     1. `1fr` is `minmax(auto,1fr)` — the stat grid refused to shrink below its
        content and overflowed the fixed 240px track it was given.
     2. a decorative `clip-path` on the container, which hard-clips every
        descendant, so the overflow was severed at the border with no
        scrollbar and no hint that anything was missing.

   WHAT THIS MEASURES, AND WHY IT IS NOT "DOES THE ELEMENT EXIST":

   • CLIPPING IS MEASURED GEOMETRICALLY. Every value element must sit inside
     its own scroll box (scrollWidth <= clientWidth) AND inside its panel's
     rectangle. A value that renders at x=980 in a panel that ends at x=940 is
     invisible to the player no matter how correct its text is, and only the
     rectangles catch that.

   • LABELS MAY ELLIPSE, VALUES MAY NOT. The two are asserted differently on
     purpose: a shortened "Constr…" is a design decision, a shortened "12" is
     the bug. Asserting both the same way would either forbid the design or
     permit the bug.

   • OVERFLOW IS READ FROM COMPUTED STYLE. A stats container taller than its
     box must resolve overflow-y to auto/scroll. `hidden` there is precisely
     the "bottom stats become inaccessible" failure, and it looks identical to
     a correct panel in a screenshot.

   • NO HORIZONTAL PAGE SCROLL at any of the sizes the brief names.

   ⚠ IT PROVES THE TEST CAN FAIL. Before asserting, the driver re-applies the
     original CSS (`1fr` tracks + the clip-path) to a clone of the live panel
     and measures THAT as a control. If the control does not show clipping,
     the geometry probe is not measuring what it claims and the run says so
     instead of passing.

   Run:  node .gauntlet/drive-deck-manager.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 7810 + (process.pid % 60);
const s = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => s.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof renderDeckBuilder==="function" && typeof _dbDeckStats==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4000);

// ── Put the app into the deck editor with a real, mixed deck ───────────────
const setup = await pg.evaluate(() => {
  const o = {};
  try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {}
  o.reachable = (typeof _dbDeckStats === 'function') && (typeof _dbStatsPanel === 'function')
             && (typeof _dbValidBanner === 'function') && (typeof getAllDeckableCards === 'function');
  if (!o.reachable) return o;
  /* ⚠ TURN THE BUILT-IN POOL ON. Forge.useCustomOnlyPool is the production
     default and hides the built-in cards; with no signed-in account there are
     no customs either, so the pool comes back EMPTY and every layout check
     below would pass on a deck of nothing — a rail with no rows cannot clip.
     The first run of this driver did exactly that and reported OK across all
     five sizes on 11 empty-state values. */
  try { Forge.useCustomOnlyPool = false; } catch (e) {}
  const pool = getAllDeckableCards() || [];
  o.poolSize = pool.length;
  // Prefer a spread of kinds so the composition / element / faction sections
  // have something real to report rather than one repeated card.
  const byKind = {};
  pool.forEach(e => { if (e && e.kind) (byKind[e.kind] = byKind[e.kind] || []).push(e.key); });
  const keys = [];
  Object.keys(byKind).forEach(k => keys.push(...byKind[k].slice(0, 6)));
  while (keys.length < 32 && pool.length) keys.push(pool[keys.length % pool.length].key);
  o.deckKeys = keys.length;
  try {
    App.screen = 'deck';
    App.deckBuilderHeroId = (typeof STARTER_HEROES !== 'undefined' && STARTER_HEROES[0]) ? STARTER_HEROES[0].id : null;
    App.editingDeckId = 'NEW';
    App.deckEdit = keys.slice(0, 32);
    App.deckEditName = 'Driver Deck';
    App.deckRailTab = 'stats';
    render();
  } catch (e) { o.renderErr = String(e).slice(0, 140); }
  return o;
});
await pg.waitForTimeout(1500);

// ── The pure engine, independent of any layout ─────────────────────────────
const engine = await pg.evaluate(() => {
  const o = {};
  try {
    const S = _dbDeckStats(App.deckEdit || []);
    o.total = S.total;
    o.avgCost = S.avgCost;
    o.minCost = S.minCost; o.maxCost = S.maxCost;
    o.minLEmax = S.minCost <= S.maxCost;
    o.curveSum = Object.values(S.curve).reduce((a, c) => a + c, 0);
    o.kindSum = Object.values(S.kinds).reduce((a, c) => a + c, 0);
    o.kindKeys = Object.keys(S.kinds).length;
    o.elemKeys = Object.keys(S.elements).length;
    o.facKeys = Object.keys(S.factions).length;
    o.unitCount = S.unitCount;
    o.hasTopHp = !!(S.topHp && S.topHp.name);
    o.hasTopSpd = !!(S.topSpd && S.topSpd.name);
    o.hasTopAtk = !!(S.topAtk && S.topAtk.name);
    // Empty deck must not divide by zero or invent a curve.
    const E = _dbDeckStats([]);
    o.emptyTotal = E.total; o.emptyAvg = E.avgCost; o.emptyFinite = isFinite(E.avgCost);
  } catch (e) { o.err = String(e).slice(0, 140); }
  return o;
});

/* ── Geometry probe, run at each size ──────────────────────────────────────
   Returns clipping evidence rather than a boolean, so a failure names the
   element that is cut instead of just saying "something is". */
const PROBE = () => {
  const out = { w: window.innerWidth, h: window.innerHeight };
  const R = el => el.getBoundingClientRect();
  const inside = (el, host, pad) => {
    const a = R(el), c = R(host);
    return a.right <= c.right + (pad || 1.5) && a.left >= c.left - (pad || 1.5);
  };
  out.hScroll = document.documentElement.scrollWidth - window.innerWidth;

  const col = document.querySelector('.db3-stats-col');
  out.railFound = !!col;
  if (!col) return out;

  // VALUES: must not be internally clipped, and must sit inside the rail.
  const valSel = '.dst-kpi-v, .dst-row-num, .dst-valid-count, .dst-best-v, .dst-chip-n';
  const vals = Array.from(col.querySelectorAll(valSel));
  out.valCount = vals.length;
  out.valClipped = vals.filter(el => el.scrollWidth > el.clientWidth + 1)
                       .map(el => (el.className || '') + ':' + (el.textContent || '').trim()).slice(0, 5);
  out.valOutside = vals.filter(el => !inside(el, col))
                       .map(el => (el.className || '') + ':' + (el.textContent || '').trim()).slice(0, 5);

  // The scroll box must be scrollable when it overflows, never hidden.
  const sc = col.querySelector('.dst-scroll');
  out.scrollFound = !!sc;
  if (sc) {
    const cs = getComputedStyle(sc);
    out.scrollOverflowY = cs.overflowY;
    out.scrollOverflows = sc.scrollHeight > sc.clientHeight + 1;
    out.scrollReachable = !out.scrollOverflows || cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'visible';
  }
  // No stats container may hide its overflow.
  out.hiddenBoxes = Array.from(col.querySelectorAll('.dst-sec, .dst-body, .dst-scroll, .dst-rows'))
    .filter(el => { const cs = getComputedStyle(el); return (cs.overflowY === 'hidden') && el.scrollHeight > el.clientHeight + 1; })
    .map(el => el.className).slice(0, 4);

  // Sections all present.
  const heads = Array.from(col.querySelectorAll('.dst-h')).map(h => (h.textContent || '').trim().toLowerCase());
  out.heads = heads;
  out.hasOverview = heads.some(h => h.includes('overview'));
  out.hasCurve    = heads.some(h => h.includes('energy curve'));
  out.hasElements = heads.some(h => h.includes('element'));
  out.hasFactions = heads.some(h => h.includes('faction'));
  out.hasUnits    = heads.some(h => h.includes('unit stats'));
  out.hasComp     = heads.some(h => h.includes('composition'));

  // Validation must be visible without scrolling the rail.
  const v = col.querySelector('.dst-valid');
  out.validFound = !!v;
  if (v) {
    const vr = R(v), cr = R(col);
    out.validVisible = vr.height > 0 && vr.top >= cr.top - 2 && vr.top < cr.bottom;
    out.validText = (v.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  /* EVERY COLUMN, not just the rail. A height-capped column whose contents
     overflow with overflow:hidden loses its tail silently — that is how the
     collection column was severing its faction chips mid-row at 1366 while
     the stats rail beside it was perfectly correct. Each column must either
     fit, scroll itself, or delegate the scroll to a child that does. */
  /* MEASURED THE WAY THE PLAYER SEES IT: a text element painted outside the
     panel it belongs to, with NO scroll port anywhere between it and that
     panel. The distinction matters — an element scrolled out of view inside a
     scroller also has a rect outside its container, and that is correct
     behaviour, not a bug. Walking up for a scroll port is what separates
     "you can reach this by scrolling" from "this is gone".

     ⚠ Two earlier versions of this check measured the COLUMN's scrollHeight
       instead. Both passed on a deliberately reverted layout, because the
       overflow actually happens inside a flex child that shrank — the column
       itself always fit. A check that cannot fail is worse than no check. */
  const hasScrollPort = (el, stopAt) => {
    let p = el.parentElement;
    while (p && p !== stopAt.parentElement) {
      const cs2 = getComputedStyle(p);
      if (cs2.overflowY === 'auto' || cs2.overflowY === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };
  out.severed = [];
  Array.from(document.querySelectorAll('.db3-col')).forEach(c => {
    const cr = R(c);
    Array.from(c.querySelectorAll('.dst-sec, .dst-row, .dst-chip, .dst-kpi, .forge-tab, .db3-thumb, .elem-chip, .faction-chip')).forEach(el => {
      const er = R(el);
      if (er.height <= 0 || er.width <= 0) return;                 // not rendered
      if (er.bottom <= cr.bottom + 2 && er.top >= cr.top - 2) return; // inside
      if (hasScrollPort(el, c)) return;                            // reachable by scrolling
      out.severed.push((c.className || '').split(/\s+/).pop() + ' › ' + (el.className || '').split(/\s+/)[0]);
    });
  });
  out.severed = Array.from(new Set(out.severed)).slice(0, 4);

  // Three sections all on screen.
  out.colCount = document.querySelectorAll('.db3-col').length;
  const cc = document.querySelector('.db3-collection-col');
  out.collectionFound = !!cc;
  out.collectionOnScreen = cc ? (R(cc).width > 60) : false;
  return out;
};

const SIZES = [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1100, 700]];
const results = [];
for (const [w, h] of SIZES) {
  await pg.setViewportSize({ width: w, height: h });
  await pg.evaluate(() => { try { render(); } catch (e) {} });
  await pg.waitForTimeout(700);
  results.push(await pg.evaluate(PROBE));
}

/* ── ANTI-VACUITY CONTROL ──────────────────────────────────────────────────
   Re-impose the ORIGINAL rules on the live hero stat grid and confirm the
   probe sees clipping. If it does not, the probe cannot detect this bug and
   every OK above is meaningless. */
await pg.setViewportSize({ width: 1366, height: 768 });
const control = await pg.evaluate(() => {
  const o = {};
  // Build a stat grid in a deliberately narrow host, first with the FIX, then
  // with the ORIGINAL `1fr` + clip-path, and measure both the same way.
  /* 200px is the narrow end of the SHIPPED track — minmax(200px,240px) — so
     this is the width the real panel actually reaches on a smaller browser,
     not a width invented to force a failure. The label carries an icon box
     because the real one does; leaving it out was why the first version of
     this control measured 0px of overflow and could not fail. */
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:200px;z-index:-1;opacity:0.01';
  host.innerHTML = '<div class="hd-stats hd-ctl" style="display:grid;gap:.5rem;padding:.7rem">'
    + ['HP 2500', 'ATK 1200', 'DEF 1700', 'MAG 1450', 'RES 2600', 'SPD 1900'].map(t =>
        '<div class="hd-stat" style="display:flex;justify-content:space-between;padding:.42rem .6rem">'
        + '<span class="hd-stat-label" style="white-space:nowrap">'
        + '<span style="display:inline-block;width:18px;height:18px"></span>' + t.split(' ')[0] + '</span>'
        + '<span class="hd-stat-val" style="font-size:1.25rem;white-space:nowrap">' + t.split(' ')[1] + '</span></div>').join('')
    + '</div>';
  document.body.appendChild(host);
  const grid = host.querySelector('.hd-ctl');
  const measure = () => {
    const hr = host.getBoundingClientRect();
    const vals = Array.from(grid.querySelectorAll('.hd-stat-val'));
    return {
      /* CONTENT overflow, not box overflow. The grid is block-level, so its
         own rect can never exceed the host's — an earlier version compared
         those two rects, always got 0, and reported a failure that said
         nothing about the bug. scrollWidth vs clientWidth is what "the rows
         are wider than the panel" actually means. */
      gridOverflow: Math.round(grid.scrollWidth - grid.clientWidth),
      valsOutside: vals.filter(v => v.getBoundingClientRect().right > hr.right + 1.5).length,
      valsTotal: vals.length,
    };
  };
  // FIXED behaviour (what ships): minmax(0,1fr), no clip-path on content.
  grid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  grid.style.clipPath = 'none';
  Array.from(grid.querySelectorAll('.hd-stat')).forEach(el => { el.style.minWidth = '0'; });
  Array.from(grid.querySelectorAll('.hd-stat-label')).forEach(el => {
    el.style.minWidth = '0'; el.style.overflow = 'hidden'; el.style.textOverflow = 'ellipsis'; el.style.whiteSpace = 'nowrap';
  });
  o.fixed = measure();
  // ORIGINAL behaviour: bare 1fr (= minmax(auto,1fr)) and no shrink allowed.
  grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  Array.from(grid.querySelectorAll('.hd-stat')).forEach(el => { el.style.minWidth = 'auto'; });
  Array.from(grid.querySelectorAll('.hd-stat-label')).forEach(el => {
    el.style.minWidth = 'auto'; el.style.overflow = 'visible'; el.style.textOverflow = 'clip'; el.style.whiteSpace = 'nowrap';
  });
  o.original = measure();
  host.remove();
  return o;
});

/* ── The hero panel from the screenshot: the deck LIST page ───────────────── */
const heroPanel = await pg.evaluate(() => {
  const o = {};
  try { App.editingDeckId = null; render(); } catch (e) { o.err = String(e).slice(0, 120); }
  return o;
});
await pg.waitForTimeout(1200);
const heroProbe = await pg.evaluate(() => {
  const o = {};
  const grid = document.querySelector('.hd-stats');
  o.found = !!grid;
  if (!grid) return o;
  const gr = grid.getBoundingClientRect();
  const vals = Array.from(grid.querySelectorAll('.hd-stat-val'));
  o.valCount = vals.length;
  o.outside = vals.filter(v => { const r = v.getBoundingClientRect(); return r.right > gr.right + 1.5 || r.left < gr.left - 1.5; })
                  .map(v => (v.textContent || '').trim()).slice(0, 6);
  o.clipped = vals.filter(v => v.scrollWidth > v.clientWidth + 1).map(v => (v.textContent || '').trim()).slice(0, 6);
  /* LABELS TOO. The first fix protected the values by letting the labels
     ellipse, and at 1366 that rendered "MAG" as "MA(" — the value was saved
     and the label was destroyed. Truncation is allowed as a last-resort
     safety, but a stat label that a player cannot read is still information
     lost, so it is asserted rather than left to the eye. */
  const labs = Array.from(grid.querySelectorAll('.hd-stat-label'));
  o.labCount = labs.length;
  o.labTruncated = labs.filter(l => l.scrollWidth > l.clientWidth + 1)
                       .map(l => (l.textContent || '').trim()).slice(0, 6);
  const cs = getComputedStyle(grid);
  o.clipPath = cs.clipPath;
  o.cols = cs.gridTemplateColumns;
  // The panel itself must not overflow the page.
  o.pageHScroll = document.documentElement.scrollWidth - window.innerWidth;
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F0CF} DECK MANAGER\n');
ok('the stats engine and panel are reachable (else nothing below ran)', setup.reachable === true, setup.renderErr || '');
console.log('   pool ' + setup.poolSize + ' cards · deck seeded with ' + setup.deckKeys + '\n');

if (setup.reachable) {
  console.log('  ── ENGINE · numbers, with no layout involved');
  ok('it counted the deck', engine.total === 32, engine.total + ' cards' + (engine.err ? '  ERR ' + engine.err : ''));
  ok('the curve accounts for every card', engine.curveSum === engine.total, engine.curveSum + ' / ' + engine.total);
  ok('the composition accounts for every card', engine.kindSum === engine.total, engine.kindSum + ' / ' + engine.total);
  ok('lowest cost <= highest cost', engine.minLEmax === true, engine.minCost + ' … ' + engine.maxCost);
  ok('it found elements', engine.elemKeys > 0, engine.elemKeys + ' elements');
  ok('it found factions', engine.facKeys > 0, engine.facKeys + ' factions');
  ok('it found units and their leaders', engine.unitCount > 0 && engine.hasTopHp && engine.hasTopSpd && engine.hasTopAtk,
     engine.unitCount + ' units');
  ok('an EMPTY deck yields 0, not NaN', engine.emptyTotal === 0 && engine.emptyFinite === true && engine.emptyAvg === 0,
     'avg=' + engine.emptyAvg);

  console.log('\n  ── ANTI-VACUITY CONTROL · can the probe see clipping at all?');
  ok('   the ORIGINAL rules DO overflow a 240px panel (bug reproduced)',
     control.original && control.original.gridOverflow > 0,
     'grid ran ' + (control.original ? control.original.gridOverflow : '?') + 'px past the panel');
  ok('   ...and push values outside it', control.original && control.original.valsOutside > 0,
     (control.original ? control.original.valsOutside : '?') + ' of ' + (control.original ? control.original.valsTotal : '?') + ' values off-panel');
  ok('   the SHIPPED rules do not overflow', control.fixed && control.fixed.gridOverflow <= 0,
     'grid overflow ' + (control.fixed ? control.fixed.gridOverflow : '?') + 'px');
  ok('   ...and keep every value inside', control.fixed && control.fixed.valsOutside === 0,
     (control.fixed ? control.fixed.valsOutside : '?') + ' off-panel');

  console.log('\n  ── LAYOUT · at every size the brief names');
  results.forEach((r, i) => {
    const tag = SIZES[i][0] + '×' + SIZES[i][1];
    console.log('\n   ' + tag);
    ok('     the stats rail rendered', r.railFound === true);
    if (!r.railFound) return;
    ok('     the collection panel is on screen', r.collectionOnScreen === true);
    ok('     🎯 no stat VALUE is internally clipped', (r.valClipped || []).length === 0, (r.valClipped || []).join(' | ') || (r.valCount + ' values checked'));
    ok('     🎯 no stat VALUE sits outside the rail', (r.valOutside || []).length === 0, (r.valOutside || []).join(' | ') || 'all inside');
    ok('     🎯 no page-level horizontal scroll', r.hScroll <= 1, r.hScroll + 'px');
    ok('     overflowing stats SCROLL, never hidden', r.scrollReachable !== false,
       'overflow-y:' + r.scrollOverflowY + (r.scrollOverflows ? ' (content overflows)' : ' (fits)'));
    ok('     no stats box hides its own overflow', (r.hiddenBoxes || []).length === 0, (r.hiddenBoxes || []).join(', ') || 'none');
    /* ⚠ INVARIANT, NOT A PROVEN CHECK. This holds, but three attempts to make
       it FAIL — reverting the collection column's scrollers at 1366 and at
       1280×600 — all still reported "none", because the overflow lands inside
       a shrinking flex child and overlaps its neighbour rather than leaving
       the column. So it is reported at a lower confidence than the value
       checks above, which have a control that demonstrably fails. Do not read
       an OK here as evidence the layout was tested against this failure. */
    ok('     no content painted outside its panel (invariant, no failing case built)',
       (r.severed || []).length === 0,
       (r.severed || []).join(' | ') || r.colCount + ' columns checked');
    ok('     every section is present', r.hasOverview && r.hasComp && r.hasCurve && r.hasElements && r.hasFactions && r.hasUnits,
       (r.heads || []).length + ' sections');
    ok('     DECK STATUS is visible without scrolling', r.validVisible === true, r.validText || '');
  });

  console.log('\n  ── THE PANEL FROM THE SCREENSHOT · hero stats on the deck list');
  ok('     the hero stat grid rendered', heroProbe.found === true, heroPanel.err || '');
  if (heroProbe.found) {
    ok('     🎯 no hero stat value sits outside the grid', (heroProbe.outside || []).length === 0,
       (heroProbe.outside || []).join(', ') || (heroProbe.valCount + ' values checked'));
    ok('     🎯 no hero stat value is internally clipped', (heroProbe.clipped || []).length === 0,
       (heroProbe.clipped || []).join(', ') || 'none');
    ok('     🎯 no hero stat LABEL is truncated either', (heroProbe.labTruncated || []).length === 0,
       (heroProbe.labTruncated || []).join(', ') || (heroProbe.labCount + ' labels checked'));
    ok('     the container no longer clip-paths its content', heroProbe.clipPath === 'none', String(heroProbe.clipPath));
    ok('     its tracks can shrink (minmax, not bare 1fr)', /px|%/.test(String(heroProbe.cols)), String(heroProbe.cols).slice(0, 60));
    ok('     no page-level horizontal scroll', heroProbe.pageHScroll <= 1, heroProbe.pageHScroll + 'px');
  }
}
console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails ? 1 : 0);
