/* ══════════════════════════════════════════════════════════════════════════
   🖱 THE ROAD CLASS PALETTE — a drag that lays a CLASS, on the shared arbiter.

   🔴 THIS FILE INSTALLS NO POINTER LISTENERS. Not one.

   That is the whole point of it. node-city's canvas already had three owners
   (its own click-to-place, OrbitControls, /src/zoning's paint tool) and
   /src/netdrag made four. /src/zoning/ui.js's header records the measured bug
   that shape produces: with the Zones panel open the player picked Housing off
   the build bar, clicked the map, and got a green zone square — no building, no
   toast, no cue. Its own words: "the worst class of UI bug: the player blames
   themselves."

   The fix shipped there was written 1-vs-1 and is therefore N² in the number of
   tools, with one silent conflict per missing edge. /src/netdrag/rig.js turned
   that wiring into a REGISTRY — one armed map tool city-wide, one set of
   document listeners dispatching only to it, node-city's onModeChange bound
   once for everybody. A fifth claimant that opened its own capture-phase stack
   would be outside that registry and would re-create the bug in a new pair, at
   the exact moment the codebase had just finished paying to close it.

   So this file calls `tools().claim('roadclass', …)` and hands over handlers.
   Two tools cannot both receive a gesture, because there is only one dispatcher
   and it only knows one target.

   ⚠ WE IMPORT rig.js WITHOUT A CACHE-BUSTING QUERY STRING, exactly as
     /src/netdrag does. The registry itself lives on `window.__ncTools` for
     precisely this reason (its header: two import specifiers are two module
     instances with two module-scope `let`s, i.e. two arbiters each convinced it
     held the only armed tool) — but matching the specifier keeps us on one
     module record as well, which is one fewer thing to be subtly wrong.

   ⚠ standDown() ENDS IN SOMETHING THE PLAYER CAN SEE. The registry requires it
     and it is the half of the exclusion that actually fixes the bug: the panel
     closes, the build-bar button clears, and a toast names the tool that took
     the pointer.
   ══════════════════════════════════════════════════════════════════════════ */

import { rd } from './tuning.js';
import { tools } from '../netdrag/rig.js';

const PREVIEW_COL = 0xffd08a;

export function mountUI(api, ctx) {
  const doc = document;
  if (!doc || !doc.body) return null;
  const canvas = ctx.canvas || null;

  let tool = 'line', cls = api.CLASSES[0], open = false;
  let drag = null, ctrlWas = null, busy = false;

  const T = tools();
  const seat = T.claim('roadclass', {
    label: 'Road classes',
    standDown: () => {
      if (!open && !seat.armed()) return;
      cancelDrag();
      setOpen(false, true);
      const who = T.armedLabel();
      if (ctx.toast) ctx.toast('🛣 Road classes put away' + (who ? ' — ' + who + ' has the map pointer.' : '.') +
        ' Click 🛣 Class to come back.', 'good');
    },
  });
  /* One registration for every claimant, by whichever module gets there first;
     a second call is a no-op. Handing it over from here as well as from
     /src/netdrag is what makes the two mount orders interchangeable. */
  try { T.bindMode(ctx.onMode, ctx.BUILDINGS); } catch (e) {}

  /* ── styles. Own prefix (nrc-), borrowing node-city's CSS variables where they
     exist and falling back to literals where they might not — the contract
     /src/zoning's panel keeps, so the card still reads against a moved theme. */
  if (!doc.getElementById('nrc-style')) {
    const st = doc.createElement('style');
    st.id = 'nrc-style';
    st.textContent = `
#nrc-panel{position:absolute;left:50%;transform:translateX(-50%);bottom:92px;z-index:6;
  width:min(860px,calc(100% - 24px));box-sizing:border-box;display:none;
  background:var(--panel,rgba(16,12,26,.92));border:1px solid var(--edge,rgba(212,175,55,.35));
  border-radius:12px;padding:9px 11px 10px;backdrop-filter:blur(6px);
  box-shadow:0 18px 44px rgba(0,0,0,.6);color:var(--bone,#e9e0cc);font-size:12px}
#nrc-panel.on{display:block}
#nrc-panel .hd{display:flex;align-items:center;gap:8px;margin-bottom:7px}
#nrc-panel .hd b{color:var(--gold,#d4af37);letter-spacing:.09em;font-size:12px}
#nrc-panel .hint{color:var(--mist,#8f87a3);font-size:11px;flex:1;min-width:0}
#nrc-panel .x{margin-left:auto;background:none;border:none;color:var(--mist,#8f87a3);cursor:pointer;font-size:13px}
#nrc-panel .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
#nrc-panel .t{border:1px solid var(--edge,rgba(212,175,55,.3));background:#120e1c;color:var(--bone,#e9e0cc);
  border-radius:8px;padding:5px 9px;cursor:pointer;font-size:12px}
#nrc-panel .t:hover{border-color:var(--gold,#d4af37)}
#nrc-panel .t.on{border-color:#ff7a2f;box-shadow:0 0 10px rgba(255,122,47,.28);color:#ffd08a}
#nrc-panel .chips{display:flex;gap:5px;flex-wrap:wrap}
#nrc-panel .c{display:flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.12);
  background:rgba(0,0,0,.32);border-radius:7px;padding:4px 8px 4px 5px;cursor:pointer;
  color:var(--bone,#e9e0cc);font-size:11px;line-height:1.15;text-align:left}
#nrc-panel .c:hover{border-color:var(--gold,#d4af37)}
#nrc-panel .c.on{border-color:#fff;background:rgba(255,255,255,.14)}
#nrc-panel .sw{width:13px;height:13px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.45);flex:none}
#nrc-panel .pr{color:var(--mist,#8f87a3);font-variant-numeric:tabular-nums;font-size:10px}
#nrc-panel .ft{display:flex;align-items:flex-start;gap:10px;margin-top:8px;
  border-top:1px solid rgba(255,255,255,.08);padding-top:8px}
#nrc-panel .sel{flex:1;min-width:0;color:var(--mist,#8f87a3);font-size:11px;line-height:1.4}
#nrc-panel .sel b{color:var(--bone,#e9e0cc)}
#nrc-panel .meter{white-space:nowrap;font-size:11px;color:var(--mist,#8f87a3);font-variant-numeric:tabular-nums}
#nrc-panel .meter.full{color:#ff8a6a;font-weight:700}
#nrc-panel .fullmeter:empty{display:none}
#nrc-panel .fullmeter{margin-top:7px}
#nrc-panel .fullmeter .roadmeter{font-size:11px}`;
    doc.head.appendChild(st);
  }

  const panel = doc.createElement('div');
  panel.id = 'nrc-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Road classes');
  doc.body.appendChild(panel);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hex = (n) => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);

  panel.innerHTML =
    '<div class="hd"><b>🛣 ROAD CLASSES</b>'
    + '<span class="hint">Drag to lay a run · right-click a road to pick up its class · scroll and WASD still move the camera</span>'
    + '<button class="x" type="button" data-act="close" aria-label="Close">✖</button></div>'
    + '<div class="row">'
    + '<button class="t" type="button" data-tool="line">📏 Run</button>'
    + '<button class="t" type="button" data-tool="elbow">⌐ Elbow</button>'
    + '<button class="t" type="button" data-tool="diag">🌀 Diagonal</button>'
    + '<button class="t" type="button" data-tool="free">✎ Freehand</button>'
    + '<span style="flex:1"></span>'
    + '<button class="t" type="button" data-act="off">🚫 Stop</button>'
    + '</div>'
    + '<div class="chips">' + api.CLASSES.map(id => {
        const d = api.defOf(id);
        return '<button class="c" type="button" data-cls="' + esc(id) + '" title="' + esc(d.name + ' — ' + d.desc) + '">'
          + '<span class="sw" style="background:' + hex(d.col) + '"></span>'
          + '<span>' + esc(d.ico + ' ' + d.short) + '<br><span class="pr" data-price="' + esc(id) + '"></span></span></button>';
      }).join('') + '</div>'
    /* 🛤️ THE ROAD CAP METER, RE-HOMED. node-city's buildShopBody() injected
       roadMeterHtml() into whichever shop section contained a carriageway
       (`sec.items.some(isRoadType)`); no section does any more, so the full
       meter — the bar, and the "Base N · +N per Supply Depot · +N per Convoy
       anchor" breakdown that tells the player how to RAISE the cap — had
       nowhere left to render. It renders here, where roads are now bought,
       which is the same argument the shop made for showing it where roads were
       bought before. The compact `used / cap` readout below stays as the
       fallback for a host that does not hand the builder over. */
    + '<div class="fullmeter" id="nrc-fullmeter"></div>'
    + '<div class="ft"><div class="sel" id="nrc-sel"></div><div class="meter" id="nrc-meter"></div></div>';

  /* The build-bar button lives here rather than in node-city so the whole
     feature is one import: a 404 leaves no dead button pointing at nothing.

     ══ 🛣 THIS BUTTON IS NOW THE CITY'S ONLY ROAD TAB ═══════════════════════
     node-city's build shop no longer sells 'road' or 'roadlane' as cards, and
     /src/netdrag stands its own duplicate button down when it sees the claim
     below. The full argument — why this palette is the superset, and why the
     48-cell run cap loses nothing against a 24×24 plate — is written where the
     stand-down happens, in /src/netdrag/index.js. Two halves of one decision,
     one copy of the reasoning.

     ⚠ "ONLY ROAD TAB" IS A CLAIM ABOUT 'road', NOT ABOUT EVERY CARRIAGEWAY
       TYPE, and the difference is worth one sentence because the superset
       argument next door quietly assumed otherwise. This palette lays exactly
       ONE type — applyRun() calls ctx.place('road', …) — and its nine entries
       are CLASSES in `t.rc`, not types. The shop's other carriageway, the Lane,
       is therefore NOT re-homed here: it is retired at the source, by the
       `retired` flag on node-city's ROAD_CLASSES row. What this palette does
       still do for a Lane already standing is CONVERT it — the branch above
       quotes convertQuote(baseCost(t.type), …) off the tile's own type, so
       dragging Avenue over a Lane charges the Lane's ladder and leaves the type
       alone. A retired type keeps every class in this palette; it just stops
       being something new ground can become.

     ⚠ THE CLAIM IS UNCONDITIONAL AND THE SWEEP IS NOT OPTIONAL. These two
       modules arrive on two different dynamic imports and neither controls the
       order, so this path must handle "netdrag got here first and has already
       appended its button" as well as "netdrag has not run yet". Setting the
       flag covers the second; removing #ndg-open covers the first. netdrag's
       own dispose() calls barBtn.remove() as well and a double remove() is a
       no-op, so nothing here can strand it.
     ⚠ RENAMED "Class" → "Roads". It is not a modifier on a road tool any more;
       it IS the road tool, and a bar button called "Class" beside no "Roads" is
       a label that only makes sense to whoever shipped the previous round. */
  const bar = doc.getElementById('buildbar');
  let barBtn = null;
  if (bar) {
    try { window.__ncRoadTab = 'roadclass'; } catch (e) {}
    try { const dup = doc.getElementById('ndg-open'); if (dup) dup.remove(); } catch (e) {}
    barBtn = doc.createElement('button');
    barBtn.className = 'bbtn tool';
    barBtn.id = 'nrc-open';
    barBtn.innerHTML = '<span class="bico">🛣</span><span class="bname">Roads</span>';
    barBtn.title = 'Lay roads — every class, on a drag';
    barBtn.onclick = () => setOpen(!open);
    /* Beside Zones, which is where the road tab has always sat: laying the
       network and zoning the land it serves are the same job. netdrag placed
       its button here for that reason and the seat moves with the tab. */
    const z = doc.getElementById('nz-open');
    if (z && z.parentNode === bar) bar.insertBefore(barBtn, z.nextSibling);
    else bar.appendChild(barBtn);
  }

  function refresh() {
    const armed = seat.armed();
    panel.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', armed && b.dataset.tool === tool));
    panel.querySelectorAll('[data-cls]').forEach(b => b.classList.toggle('on', armed && b.dataset.cls === cls));
    // Live prices: they derive from costOf() and the host may reprice roads
    // under an open panel. Never cached — see price.js.
    panel.querySelectorAll('[data-price]').forEach(el => { el.textContent = api.priceLabel(el.dataset.cls || el.dataset.price); });
    const d = api.defOf(cls), stampN = api.stampOf(cls);
    const sel = panel.querySelector('#nrc-sel');
    if (sel) {
      sel.innerHTML = '<b>' + esc(d.ico + ' ' + d.name) + '</b> — ' + esc(d.desc)
        + '<br>' + esc(stampN
            ? 'Click to stamp a ' + stampN + '×' + stampN + ' roundabout: ' + (stampN * stampN) +
              ' road tiles, one island, and it connects as one component like any other ' + (stampN * stampN) + ' touching roads.'
            : tool === 'diag' ? 'Drag a diagonal. The staircase is laid as curves, so the run reads as one continuous carriageway.'
            : tool === 'elbow' ? 'Two legs and a corner.'
            : tool === 'free' ? 'Follows the pointer; gaps are closed with a right angle so the run is always connected.'
            : 'One leg, along whichever axis you dragged furthest.')
        + '<br>' + esc('Dragging over a road of another class re-lays it at the full ' + d.name.toLowerCase() + ' price.');
    }
    /* The full cap card first — it is the one that says how to RAISE the cap,
       and it is built by the HOST so the refusal in tryPlace, the inspector and
       this panel cannot disagree about how full the network is. Guarded: an
       older host, or one that dropped the hand-over, falls back to the compact
       readout rather than to a number this file invented. */
    const fm = panel.querySelector('#nrc-fullmeter');
    let fullShown = false;
    if (fm) {
      let html = '';
      try { html = typeof ctx.roadMeterHtml === 'function' ? ctx.roadMeterHtml() : ''; } catch (e) { html = ''; }
      if (fm.innerHTML !== html) fm.innerHTML = html;
      fullShown = !!html;
    }
    const m = panel.querySelector('#nrc-meter');
    if (m) {
      const c = api.capInfo();
      m.textContent = fullShown ? '' : '🛤️ ' + c.used + ' / ' + c.cap;
      m.classList.toggle('full', !fullShown && c.used >= c.cap);
    }
    if (barBtn) barBtn.classList.toggle('active', armed);
  }

  /* `quiet` is set only when the registry is already standing us down — arming
     or disarming from inside a broadcast is the loop rig.js refuses. */
  function setOpen(v, quiet) {
    open = !!v;
    panel.classList.toggle('on', open);
    if (open) {
      /* Leaving build mode is not enough on its own — a player who had a
         building in hand has just had it taken away, and being told is the
         difference between a tool swap and a lost click. */
      let held = false;
      try { held = typeof ctx.mode === 'function' && ctx.mode() === 'place'; } catch (e) {}
      try { if (ctx.setMode) ctx.setMode('inspect'); } catch (e) {}
      seat.arm();
      if (held && ctx.toast) ctx.toast('🛣 Road class tool armed — the building you were holding was put back.', 'good');
    } else if (!quiet) {
      cancelDrag();
      seat.disarm();
    }
    refresh();
  }

  function holdControls() {
    if (ctrlWas === null && ctx.controls) { ctrlWas = ctx.controls.enabled; ctx.controls.enabled = false; }
  }
  function releaseControls() {
    if (ctrlWas !== null && ctx.controls) { ctx.controls.enabled = ctrlWas; }
    ctrlWas = null;
  }
  /* A gesture interrupted by anything at all — a stand-down, a pointercancel, a
     lost capture — must release OrbitControls and clear the preview. A tool that
     is disarmed mid-drag and leaves controls.enabled false kills the camera with
     no way back, which is why rig.js calls cancel() before standDown(). */
  function cancelDrag() {
    drag = null;
    releaseControls();
    try { api.preview(null, null); } catch (e) {}
  }

  panel.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tool]');
    if (t) { tool = t.dataset.tool; setOpen(true); return; }
    const c = ev.target.closest('[data-cls]');
    if (c) { cls = c.dataset.cls; setOpen(true); return; }
    const a = ev.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'close' || a.dataset.act === 'off') setOpen(false);
  });

  /* ── the run shapes ───────────────────────────────────────────────────────
     Every one returns a 4-CONNECTED ordered cell list. Four-connected is not a
     detail: makeRoad derives its entire geometry from a four-boolean neighbour
     mask, so a run that stepped diagonally would render as a string of
     disconnected stubs AND would be two components in computeLinks that look
     like one — the picture and the graph would disagree, which is the failure
     no screenshot catches. */
  function leg(out, seen, from, to) {
    let x = from.x, z = from.z;
    const sx = Math.sign(to.x - x), sz = Math.sign(to.z - z);
    const push = () => { const k = x + ',' + z; if (!seen.has(k)) { seen.add(k); out.push({ x, z }); } };
    while (x !== to.x) { x += sx; push(); }
    while (z !== to.z) { z += sz; push(); }
    return { x, z };
  }
  /* The diagonal: a Bresenham walk that NEVER takes a diagonal step. When both
     axes want to advance it takes the two orthogonal steps in turn, so the run
     is a connected staircase — and the `curve` class is what turns that
     staircase back into something to look at. See mesh.js's curve(). */
  function diagRun(a, b, out, seen) {
    let x = a.x, z = a.z;
    const sx = b.x >= a.x ? 1 : -1, sz = b.z >= a.z ? 1 : -1;
    const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
    let err = dx - dz, guard = 0;
    const push = () => { const k = x + ',' + z; if (!seen.has(k)) { seen.add(k); out.push({ x, z }); } };
    while ((x !== b.x || z !== b.z) && guard++ < 4096) {
      const e2 = err * 2;
      if (e2 > -dz && x !== b.x) { err -= dz; x += sx; push(); }
      else if (z !== b.z) { err += dx; z += sz; push(); }
      else if (x !== b.x) { x += sx; push(); }
    }
  }
  function plan(a, b, mode, trail) {
    const out = [], seen = new Set();
    if (!a) return out;
    seen.add(a.x + ',' + a.z); out.push({ x: a.x, z: a.z });
    if (!b) return out;
    if (mode === 'free' && Array.isArray(trail)) {
      let cur = a;
      for (const p of trail) { cur = leg(out, seen, cur, p); if (out.length >= rd('drag.max', 48)) break; }
    } else if (mode === 'diag') {
      diagRun(a, b, out, seen);
    } else if (mode === 'elbow') {
      const corner = { x: b.x, z: a.z };
      const c = leg(out, seen, a, corner);
      leg(out, seen, c, b);
    } else {
      const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
      leg(out, seen, a, (dx >= dz) ? { x: b.x, z: a.z } : { x: a.x, z: b.z });
    }
    return out.slice(0, rd('drag.max', 48));
  }
  function stampCells(x, z, n) {
    const out = [], r = (n - 1) / 2;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.push({ x: x + dx, z: z + dz });
    return out;
  }
  function cellsNow(t) {
    const n = api.stampOf(cls);
    if (n) return t ? stampCells(t.x, t.z, n) : [];
    if (!drag) return t ? [{ x: t.x, z: t.z }] : [];
    return plan(drag.a, drag.b, tool, drag.trail);
  }

  /* ── the handlers the registry dispatches to ─────────────────────────────
     `hot` is narrower than the registry's own guard on purpose: being the armed
     claimant is not enough, the pointer also has to be over the canvas and the
     page has to be able to turn it into a tile. Every UI click passes through. */
  function hot(ev) {
    if (busy || !canvas || ev.target !== canvas || typeof ctx.tileFromEvent !== 'function') return false;
    try { if (typeof ctx.mode === 'function' && ctx.mode() === 'place') return false; } catch (e) {}
    return true;
  }

  function onDown(ev) {
    if (!hot(ev) || (ev.button !== 0 && ev.button !== 2)) return;
    const t = ctx.tileFromEvent(ev);
    if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    if (ev.button === 2) {
      /* Right button is an EYEDROPPER, not an eraser. Demolition already has a
         price, a confirmation and a ledger row in node-city's inspector
         (ROAD_DEMOLISH_COST, read at six sites), and a right-drag that quietly
         spent it a tile at a time through a second, cheaper-looking path would
         be a second demolition price in a codebase that deliberately keeps one. */
      const got = api.classAt(t.x, t.z);
      if (got) {
        cls = got;
        if (ctx.toast) ctx.toast('🛣 Picked up ' + api.defOf(got).ico + ' ' + api.defOf(got).name + '.', 'good');
      } else if (ctx.toast) ctx.toast('🛣 Nothing to pick up — that tile is not a road.', 'bad');
      refresh();
      return;
    }
    drag = { a: { x: t.x, z: t.z }, b: { x: t.x, z: t.z }, trail: [{ x: t.x, z: t.z }] };
    holdControls();
    api.preview(cellsNow(t), PREVIEW_COL);
  }
  function onMove(ev) {
    if (!hot(ev)) return;
    const t = ctx.tileFromEvent(ev);
    if (drag && t) {
      ev.preventDefault(); ev.stopPropagation();
      drag.b = { x: t.x, z: t.z };
      const last = drag.trail[drag.trail.length - 1];
      if (!last || last.x !== t.x || last.z !== t.z) drag.trail.push({ x: t.x, z: t.z });
    }
    api.preview(cellsNow(t), PREVIEW_COL);
  }
  async function onUp(ev) {
    if (!drag) { if (hot(ev)) api.preview(null, null); return; }
    const t = (typeof ctx.tileFromEvent === 'function' && ev && ev.target === canvas) ? ctx.tileFromEvent(ev) : null;
    const cells = cellsNow(t || drag.b);
    const wasHot = hot(ev);
    drag = null;
    releaseControls();
    if (wasHot && ev && ev.preventDefault) { ev.preventDefault(); ev.stopPropagation(); }
    api.preview(null, null);
    if (!cells.length) { refresh(); return; }
    busy = true;
    try { await api.apply(cells, cls); } finally { busy = false; refresh(); }
  }
  function onCtx(ev) { if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); } }
  function onKey(ev) {
    if (ev.key === 'Escape') { setOpen(false); return; }
    const el = doc.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const map = { '1': 'line', '2': 'elbow', '3': 'diag', '4': 'free' };
    if (map[ev.key]) { tool = map[ev.key]; refresh(); }
  }

  seat.on({ down: onDown, move: onMove, up: onUp, ctx: onCtx, key: onKey, cancel: cancelDrag });
  refresh();

  return {
    open: (v) => setOpen(v == null ? true : v),
    isOpen: () => open,
    armed: () => seat.armed(),
    cls: (v) => { if (v && api.defOf(v)) { cls = v; setOpen(true); } return cls; },
    tool: (v) => { if (v) { tool = v; refresh(); } return tool; },
    refresh,
    /* Harness seams: the pure run shapes, with no pointer and no DOM in the way.
       .gauntlet drives these directly rather than synthesising pointer events at
       0.56 Hz (CLAUDE.md — the Browser pane barely composites). */
    _plan: plan,
    _stamp: stampCells,
  };
}

export default { mountUI };
