/* ══════════════════════════════════════════════════════════════════════════
   🖌 THE ZONING TOOLBAR — paint, marquee, fill, and the right-button rule.

   THE ONE RULE THE SPEC IS EMPHATIC ABOUT: there is no de-zone tool. The RIGHT
   MOUSE BUTTON de-zones with whichever tool is active — right-click paints one
   cell clear, right-drag clears a rectangle, right-click with fill clears a
   whole contiguous block. And changing zone type never requires de-zoning
   first, which falls out for free because setZone overwrites.

   🖱 WHY THE LISTENERS ARE ON `document` WITH capture:true.
   node-city already owns pointerdown/pointermove/pointerup ON THE CANVAS, and
   OrbitControls owns them too. Listeners registered on the same element run in
   registration order — ours would be last, i.e. after the click had already
   been read as "place a building" or "orbit the camera", and stopping
   propagation from there is too late. A capture-phase listener on `document`
   runs BEFORE anything bound to the canvas, so one stopPropagation() there is
   enough to own the gesture. Events are only swallowed while a zone tool is
   armed AND the pointer is over the canvas; every UI click passes through
   untouched.

   ⛔ CAMERA DRAG IS SUSPENDED WHILE ZONING, deliberately. Left drag paints and
   right drag marquees, which leaves OrbitControls nothing to bind to — the same
   trade every paint tool in every city builder makes. Scroll zoom, middle-drag
   and the game's WASD panning all still work, and the panel says so.
   ══════════════════════════════════════════════════════════════════════════ */

const ERASE_COL = 0xff5f4a;

export function mountUI(api, ctx) {
  const doc = document;
  if (!doc || !doc.body) return null;
  const canvas = ctx.canvas || null;

  let tool = 'paint', zone = 'r_low', armed = false, open = false;
  let drag = null, erase = false, ctrlWas = null;

  /* ── styles ─────────────────────────────────────────────────────────────
     Own stylesheet, own prefix. The panel borrows node-city's CSS variables
     (--gold, --panel, --edge, --bone, --mist) where they exist and falls back
     to literals where they might not, so the card still reads if this module is
     ever opened against a page whose theme has moved on. */
  if (!doc.getElementById('nz-style')) {
    const st = doc.createElement('style');
    st.id = 'nz-style';
    st.textContent = `
#nz-panel{position:absolute;left:50%;transform:translateX(-50%);bottom:92px;z-index:6;
  width:min(760px,calc(100% - 24px));box-sizing:border-box;display:none;
  background:var(--panel,rgba(16,12,26,.92));border:1px solid var(--edge,rgba(212,175,55,.35));
  border-radius:12px;padding:9px 11px 10px;backdrop-filter:blur(6px);
  box-shadow:0 18px 44px rgba(0,0,0,.6);color:var(--bone,#e9e0cc);font-size:12px}
#nz-panel.on{display:block}
#nz-panel .nzhd{display:flex;align-items:center;gap:8px;margin-bottom:7px}
#nz-panel .nzhd b{color:var(--gold,#d4af37);letter-spacing:.09em;font-size:12px}
#nz-panel .nzhint{color:var(--mist,#8f87a3);font-size:11px;flex:1;min-width:0}
#nz-panel .nzx{margin-left:auto;background:none;border:none;color:var(--mist,#8f87a3);cursor:pointer;font-size:13px}
#nz-panel .nzrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
#nz-panel .nzt{border:1px solid var(--edge,rgba(212,175,55,.3));background:#120e1c;color:var(--bone,#e9e0cc);
  border-radius:8px;padding:5px 9px;cursor:pointer;font-size:12px}
#nz-panel .nzt:hover{border-color:var(--gold,#d4af37)}
#nz-panel .nzt.on{border-color:#ff7a2f;box-shadow:0 0 10px rgba(255,122,47,.28);color:#ffd08a}
#nz-panel .nzgrp{margin-bottom:6px}
#nz-panel .nzgl{color:var(--mist,#8f87a3);font-size:10px;letter-spacing:.12em;margin:0 0 3px 2px}
#nz-panel .nzchips{display:flex;gap:5px;flex-wrap:wrap}
#nz-panel .nzc{display:flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.12);
  background:rgba(0,0,0,.32);border-radius:7px;padding:4px 8px 4px 5px;cursor:pointer;
  color:var(--bone,#e9e0cc);font-size:11px;line-height:1.1}
#nz-panel .nzc:hover{border-color:var(--gold,#d4af37)}
#nz-panel .nzc.on{border-color:#fff;background:rgba(255,255,255,.14)}
#nz-panel .nzsw{width:13px;height:13px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.45);flex:none}
#nz-panel .nzft{display:flex;align-items:center;gap:10px;margin-top:8px;
  border-top:1px solid rgba(255,255,255,.08);padding-top:8px}
#nz-panel .nzsel{flex:1;min-width:0;color:var(--mist,#8f87a3);font-size:11px;line-height:1.35}
#nz-panel .nzsel b{color:var(--bone,#e9e0cc)}
#nz-panel .nzgo{border:1px solid rgba(212,175,55,.6);border-radius:9px;padding:7px 12px;cursor:pointer;
  background:linear-gradient(180deg,rgba(212,175,55,.24),rgba(120,90,20,.2));color:#ffd98a;font-size:12px;white-space:nowrap}
#nz-panel .nzgo:disabled{opacity:.45;cursor:not-allowed}
#nz-badge{margin-left:4px;font-size:10px;color:var(--mist,#8f87a3)}
#nz-panel .nzgate{margin-top:7px;border-top:1px solid rgba(255,255,255,.08);padding-top:7px;
  font-size:11px;line-height:1.4;color:var(--mist,#8f87a3)}
#nz-panel .nzgate.shut{color:#ffcf9a}
#nz-panel .nzgate b{color:#ffb066}
#nz-panel .nzgate .nzcov{display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;font-variant-numeric:tabular-nums}
#nz-panel .nzgate .nzcov span{color:var(--bone,#e9e0cc)}
#nz-panel .nzgate .nzcov span.bad{color:#ff8a6a;font-weight:700}`;
    doc.head.appendChild(st);
  }

  /* ── the panel ─────────────────────────────────────────────────────────── */
  const panel = doc.createElement('div');
  panel.id = 'nz-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Zoning tools');
  doc.body.appendChild(panel);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hex = (n) => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);

  function paletteHtml() {
    const byCat = {};
    for (const z of api.ZONES) (byCat[z.cat] = byCat[z.cat] || []).push(z);
    return Object.keys(byCat).map(cid => {
      const cat = api.CATS[cid] || { name: cid, ico: '' };
      return '<div class="nzgrp"><div class="nzgl">' + esc(cat.ico + ' ' + cat.name.toUpperCase()) + '</div><div class="nzchips">'
        + byCat[cid].map(z =>
            '<button class="nzc" type="button" data-zone="' + esc(z.id) + '" title="' + esc(z.name + ' — ' + z.desc) + '">'
            + '<span class="nzsw" style="background:' + hex(z.col) + '"></span>'
            + esc(z.ico + ' ' + z.short) + '</button>').join('')
        + '</div></div>';
    }).join('');
  }

  panel.innerHTML =
    '<div class="nzhd"><b>🗺 ZONING</b>'
    + '<span class="nzhint">Right mouse button de-zones with whichever tool is active · scroll and WASD still move the camera · picking a building from the build bar puts the zone tool away</span>'
    + '<button class="nzx" type="button" data-act="close" aria-label="Close">✖</button></div>'
    + '<div class="nzrow">'
    + '<button class="nzt" type="button" data-tool="paint">🖌 Paint</button>'
    + '<button class="nzt" type="button" data-tool="marquee">▭ Marquee</button>'
    + '<button class="nzt" type="button" data-tool="fill">🪣 Fill</button>'
    + '<span style="flex:1"></span>'
    + '<button class="nzt" type="button" data-act="overlay">👁 Overlay</button>'
    + '<button class="nzt" type="button" data-act="off">🚫 Stop zoning</button>'
    + '</div>'
    + '<div id="nz-pal">' + paletteHtml() + '</div>'
    + '<div id="nz-gate"></div>'
    + '<div class="nzft"><div class="nzsel" id="nz-sel"></div>'
    + '<button class="nzgo" type="button" data-act="develop" id="nz-go">🏗 Develop</button></div>';

  /* ── the build-bar button. Created here rather than in node-city so the
     whole feature is one import: if this module 404s there is no dead button
     pointing at nothing. ─────────────────────────────────────────────────── */
  const bar = doc.getElementById('buildbar');
  let barBtn = null;
  if (bar) {
    barBtn = doc.createElement('button');
    barBtn.className = 'bbtn tool';
    barBtn.id = 'nz-open';
    barBtn.innerHTML = '<span class="bico">🗺</span><span class="bname">Zones</span>';
    barBtn.onclick = () => setOpen(!open);
    // Second slot, next to Build — zoning and building are the same job.
    if (bar.children.length > 1) bar.insertBefore(barBtn, bar.children[2] || null);
    else bar.appendChild(barBtn);
  }

  function zdef(id) { return api.ZONE_BY_ID[id] || null; }

  /* ══ 🚦 "ZONED, BUT NOTHING WILL MOVE IN" ═════════════════════════════════
     THE DEFECT THIS CLOSES IS A SILENCE. node-city grows its citizenry only
     while Food, Water and Health coverage are all at or above its threshold. A
     player zoning a district in a city under that line sees the tool do
     everything it promises — the film paints, the plots develop, buildings go
     up — and the resident count does not move by one. Nothing anywhere said the
     rule existed, and a silent gate is indistinguishable from a broken tool.

     🔴 THE SENTENCE IS NOT WRITTEN HERE. /src/demographics/gate.js derives it
        once per tick and every surface prints THAT one — the People tab, the
        demand meter's causal list, this panel and the map film. Two panels
        explaining one city in two different ways is the failure this codebase
        has already had to rip a panel out over.
     ⚠ ABSENT ⇒ NOTHING DRAWN. No /src/demographics, or a build with no
       growth(), and this block is simply missing — the panel is exactly what it
       was before this existed. */
  function gateHtml() {
    const g = api.gate ? api.gate() : null;
    if (!g || !g.ok || !g.text) return '';
    const cov = (g.needs || []).map((n) =>
      '<span class="' + (n.short ? 'bad' : '') + '">' + esc(n.ico + ' ' + n.name) + ' ' +
      (n.cov == null ? '—' : Math.round(n.cov * 100) + '%') + '</span>').join('');
    return '<div class="nzgate' + (g.open ? '' : ' shut') + '">' +
      (g.open ? '🚦 ' : '<b>⏸ ') + esc(g.text) + (g.open ? '' : '</b>') +
      (cov ? '<div class="nzcov">' + cov + '<span style="opacity:.7">gate ' +
        Math.round(g.grow * 100) + '%</span></div>' : '') +
      (g.open ? '' : '<div style="opacity:.75;margin-top:2px">Zoned residential land is marked ' +
        '⏸ on the map until this clears.</div>') +
      '</div>';
  }

  function refresh() {
    panel.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', armed && b.dataset.tool === tool));
    panel.querySelectorAll('[data-zone]').forEach(b => b.classList.toggle('on', armed && b.dataset.zone === zone));
    const ovBtn = panel.querySelector('[data-act="overlay"]');
    const st = api.stats();
    if (ovBtn) ovBtn.classList.toggle('on', st.overlay);
    const d = zdef(zone);
    const sel = panel.querySelector('#nz-sel');
    if (sel) {
      sel.innerHTML = (d
        ? '<b>' + esc(d.ico + ' ' + d.name) + '</b> — ' + esc(d.desc)
          + '<br>' + st.zoned + ' tile' + (st.zoned === 1 ? '' : 's') + ' zoned · ' + st.developed + ' built · ' + st.empty + ' vacant'
        : '')
        /* The run's own line. It says "while the city is open" because that is
           true and because a player who closes the tab expecting a finished
           district would rightly call the silence a bug. */
        + (st.developing
            ? '<br><b style="color:#ffd08a">🏗 Developing</b> — ' + st.built + ' raised, ' + st.sites +
              ' of ' + st.siteCap + ' sites working. New permits keep coming while the city is open.'
            : st.sites
              ? '<br>🏗 ' + st.sites + ' zoned site' + (st.sites === 1 ? '' : 's') + ' still under construction.'
              : '');
    }
    const go = panel.querySelector('#nz-go');
    if (go) {
      const p = api.plan(null);
      const cost = api.planCost(p.out, p.grow);
      const work = p.out.length + p.grow.length;
      /* 🏗 THE BUTTON HAS TWO STATES BECAUSE DEVELOPMENT NOW HAS TWO STATES.
         It is no longer "build all of this, now" — it approves the district and
         private developers build it out over time, one permit at a time (see
         index.js). So while a run is going the button is the way to STOP it,
         and the label carries the live count rather than an estimate that is
         already out of date. */
      if (st.developing) {
        go.disabled = false;
        go.textContent = '⏸ Pause · ' + st.built + ' raised, ' + st.sites + ' on site';
        go.title = 'Development is running: a zoned plot is permitted every ' + (st.permitSec || '?') +
          's, up to ' + (st.siteCap || '?') + ' under construction at once, each paid for as it starts. Pausing stops new permits — the sites already up finish on their own.';
      } else {
        go.disabled = !work;
        // The button names the price BEFORE it is spent — a bulk action that
        // quietly empties the treasury is the one thing a player cannot undo.
        go.textContent = work
          ? '🏗 Develop ' + (p.out.length ? p.out.length + ' plot' + (p.out.length === 1 ? '' : 's') : '')
            + (p.out.length && p.grow.length ? ' + ' : '') + (p.grow.length ? p.grow.length + ' taller' : '')
            + ' · ' + cost.toLocaleString() + ' 🔥'
          : '🏗 Develop — nothing ready';
        go.title = work ? 'Approves the district. Buildings go up on their own from here — one zoned plot permitted at a time, up to ' +
            (st.siteCap || 'a few') + ' under construction at once, each paying the shipped price as it starts. One summary at the end, not one toast per tile.'
          : 'Zoned plots need to be empty and to touch a road before anything can be raised on them.';
      }
    }
    const gate = panel.querySelector('#nz-gate');
    if (gate) gate.innerHTML = gateHtml();
    if (barBtn) barBtn.classList.toggle('active', armed);
  }
  api.onChange(refresh);
  /* The gate's numbers move on the city's clock, not on the player's edits, and
     refresh() otherwise only runs when the zone map changes. A stale "food is
     62%" on an open panel while the player watches their new Grocery come up is
     the same class of lie the silence was. Only while the panel is OPEN. */
  try { setInterval(() => { if (open) refresh(); }, 3000); } catch (e) {}

  function setOpen(v) {
    open = !!v;
    panel.classList.toggle('on', open);
    if (open) { setArmed(true); api.overlay(true); }
    else setArmed(false);
    refresh();
  }

  /* ══ 🖱 TWO TOOLS, ONE POINTER — THE EXCLUSION, IN BOTH DIRECTIONS ══════════
     🔴 THE DEFECT THIS CLOSES, MEASURED: with the Zones panel open (which arms
     the paint tool) the player picked Housing off the build bar and clicked the
     map. They got a green zone square. No house, no toast, no cue — because the
     capture-phase listener at the bottom of this file owns the gesture the
     moment the tool is armed, and NOTHING disarmed it. A silent mode conflict
     is the worst class of UI bug: the player blames themselves.

     Arming already left build mode (setMode('inspect') below) — that half was
     there. The missing half is the other direction, and it cannot be done from
     here alone: `mode` is a `let` inside node-city's module script and is
     invisible to an ES module (CLAUDE.md, the globals trap). So node-city hands
     over `onMode` — a one-way notification fired from setMode — and this is the
     listener. Both directions now END IN A VISIBLE CHANGE, which is the part
     that actually fixes it: the panel closes or opens, the build-bar button
     lights or clears, and a toast names the tool the player is now holding.
     ⚠ NEVER CALL ctx.setMode FROM INSIDE THIS LISTENER. It is fired from within
       setMode itself; calling back would put the two tools in a loop handing
       the pointer to each other. Standing our own tool down is enough. */
  if (typeof ctx.onMode === 'function') {
    ctx.onMode((m, type) => {
      if (m !== 'place' || !(armed || open)) return;
      const name = (ctx.BUILDINGS && ctx.BUILDINGS[type] && ctx.BUILDINGS[type].name) || null;
      setOpen(false);
      /* The overlay is deliberately LEFT ON. Land use is exactly what a player
         wants to see while they place a building into it, and it swallows no
         clicks — only the armed tool did that. */
      if (ctx.toast) ctx.toast('🗺 Zoning put away — you picked ' + (name || 'a building') +
        ', and the map is building again. Click 🗺 Zones to paint land use.', 'good');
    });
  }

  function setArmed(v) {
    const was = armed;
    armed = !!v;
    if (armed && ctx.setMode) {
      /* Leaving build mode is not enough on its own — a player who had a
         building in hand has just had it taken away, and being told is the
         difference between a tool swap and a lost click. */
      let held = false;
      try { held = typeof ctx.mode === 'function' && ctx.mode() === 'place'; } catch (e) { held = false; }
      try { ctx.setMode('inspect'); } catch (e) {}
      if (held && !was && ctx.toast) ctx.toast('🗺 Zone tool armed — the building you were holding was put back. Press 🚫 Stop zoning, or pick a building again, to build.', 'good');
    }
    if (!armed) { api.preview(null, null); releaseControls(); }
    refresh();
  }
  function holdControls() {
    if (ctrlWas === null && ctx.controls) { ctrlWas = ctx.controls.enabled; ctx.controls.enabled = false; }
  }
  function releaseControls() {
    if (ctrlWas !== null && ctx.controls) { ctx.controls.enabled = ctrlWas; }
    ctrlWas = null;
  }

  panel.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-tool]');
    if (t) { tool = t.dataset.tool; setArmed(true); return; }
    const z = ev.target.closest('[data-zone]');
    if (z) { zone = z.dataset.zone; setArmed(true); api.overlay(true); return; }
    const a = ev.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'close') setOpen(false);
    else if (a.dataset.act === 'off') setArmed(false);
    else if (a.dataset.act === 'overlay') { api.overlay(); refresh(); }
    else if (a.dataset.act === 'develop') {
      /* `toggle` — the same button starts development and pauses it, because
         they are the same decision. It is only disabled across the FIRST
         permit: a run that is already going must always be stoppable, and
         disabling the one control that stops it is how a player ends up
         watching their treasury drain with nothing to press. */
      const running = api.developing();
      if (!running) a.disabled = true;
      try { await api.develop({ toggle: true }); } finally { a.disabled = false; refresh(); }
    }
  });

  /* ── pointer ────────────────────────────────────────────────────────────
     `hot` is the whole guard: armed, over the canvas, and the page able to
     turn a pointer into a tile. Anything else and the event is left alone. */
  function hot(ev) {
    if (!armed || !canvas || ev.target !== canvas || typeof ctx.tileFromEvent !== 'function') return false;
    /* 🛟 THE BELT TO THE onMode BRACES. If this module is ever loaded against a
       page with no mode hook (an older node-city), the exclusion above cannot
       fire — and a build click silently painting a zone is precisely the bug
       that is being closed. Then the build click wins, which is the right way
       round: the player who just picked a building is holding it. */
    try { if (typeof ctx.mode === 'function' && ctx.mode() === 'place') return false; } catch (e) {}
    return true;
  }
  function rectOf() {
    return drag ? { x0: drag.x0, z0: drag.z0, x1: drag.x1, z1: drag.z1 } : null;
  }
  function showPreview(t) {
    const col = erase ? ERASE_COL : (zdef(zone) ? zdef(zone).col : 0xffffff);
    if (drag && tool === 'marquee') api.preview(rectOf(), col);
    else if (t) api.preview({ x0: t.x, z0: t.z, x1: t.x, z1: t.z }, col);
    else api.preview(null, null);
  }

  function onDown(ev) {
    if (!hot(ev) || (ev.button !== 0 && ev.button !== 2)) return;
    const t = ctx.tileFromEvent(ev);
    if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    erase = ev.button === 2;
    drag = { x0: t.x, z0: t.z, x1: t.x, z1: t.z };
    const target = erase ? null : zone;
    if (tool === 'paint') api.applyPaint(t.x, t.z, target);
    else if (tool === 'fill') {
      const r = api.applyFill(t.x, t.z, target);
      if (r.capped && ctx.toast) ctx.toast('🪣 Fill stopped at ' + r.total + ' tiles — that run of land is not closed off by roads. Draw a road, or use the marquee.', 'bad');
      drag = null;
    } else holdControls();
    showPreview(t);
    refresh();
  }
  function onMove(ev) {
    if (!hot(ev)) return;
    const t = ctx.tileFromEvent(ev);
    if (drag) {
      ev.preventDefault(); ev.stopPropagation();
      if (t) { drag.x1 = t.x; drag.z1 = t.z; }
      // Paint keeps painting as the pointer is dragged — a one-cell tool that
      // needs one click per cell is unusable on a 24x24 board.
      if (tool === 'paint' && t) api.applyPaint(t.x, t.z, erase ? null : zone);
    }
    showPreview(t);
  }
  function onUp(ev) {
    if (!drag) { if (hot(ev)) api.preview(null, null); return; }
    const wasMarquee = tool === 'marquee';
    const r = rectOf();
    drag = null;
    releaseControls();
    if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); }
    if (wasMarquee && r) {
      const res = api.applyRect(r.x0, r.z0, r.x1, r.z1, erase ? null : zone);
      /* 🍞 ONE LINE FOR THE WHOLE DRAG. A marquee across 40 tiles that changed
         34 of them must say so once — see develop()'s note on why per-tile
         reporting is not an option. Roads inside the rectangle are the usual
         reason for the gap, so the message names the count rather than the
         reason and lets the overlay show the shape. */
      if (ctx.toast && res.total > 1) {
        const d = zdef(zone);
        ctx.toast((erase ? '🧽 De-zoned ' : (d ? d.ico + ' Zoned ' : 'Zoned ')) + res.changed + ' of ' + res.total + ' tiles'
          + (erase ? '' : ' as ' + (d ? d.name : zone))
          + (res.changed < res.total ? ' — the rest were roads or already that zone.' : '.'),
          res.changed ? 'good' : 'bad');
      }
    }
    api.preview(null, null);
    refresh();
  }
  function onCtx(ev) { if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); } }
  function onKey(ev) {
    if (!armed) return;
    if (ev.key === 'Escape') { setOpen(false); return; }
    const el = doc.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const map = { '1': 'paint', '2': 'marquee', '3': 'fill' };
    if (map[ev.key]) { tool = map[ev.key]; refresh(); }
  }

  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerup', onUp, true);
  doc.addEventListener('pointercancel', onUp, true);
  doc.addEventListener('contextmenu', onCtx, true);
  doc.addEventListener('keydown', onKey, true);

  refresh();

  return {
    open: (v) => setOpen(v == null ? true : v),
    isOpen: () => open,
    tool: (t) => { if (t) { tool = t; setArmed(true); } return tool; },
    zone: (z) => { if (z && api.ZONE_BY_ID[z]) { zone = z; setArmed(true); } return zone; },
    armed: (v) => { if (v != null) setArmed(v); return armed; },
    refresh,
  };
}
