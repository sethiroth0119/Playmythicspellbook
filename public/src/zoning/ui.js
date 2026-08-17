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
#nz-badge{margin-left:4px;font-size:10px;color:var(--mist,#8f87a3)}`;
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
    + '<span class="nzhint">Right mouse button de-zones with whichever tool is active · scroll and WASD still move the camera</span>'
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

  function refresh() {
    panel.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', armed && b.dataset.tool === tool));
    panel.querySelectorAll('[data-zone]').forEach(b => b.classList.toggle('on', armed && b.dataset.zone === zone));
    const ovBtn = panel.querySelector('[data-act="overlay"]');
    const st = api.stats();
    if (ovBtn) ovBtn.classList.toggle('on', st.overlay);
    const d = zdef(zone);
    const sel = panel.querySelector('#nz-sel');
    if (sel) {
      sel.innerHTML = d
        ? '<b>' + esc(d.ico + ' ' + d.name) + '</b> — ' + esc(d.desc)
          + '<br>' + st.zoned + ' tile' + (st.zoned === 1 ? '' : 's') + ' zoned · ' + st.developed + ' built · ' + st.empty + ' vacant'
        : '';
    }
    const go = panel.querySelector('#nz-go');
    if (go) {
      const p = api.plan(null);
      const cost = api.planCost(p.out, p.grow);
      const work = p.out.length + p.grow.length;
      go.disabled = !work;
      // The button names the price BEFORE it is spent — a bulk action that
      // quietly empties the treasury is the one thing a player cannot undo.
      go.textContent = work
        ? '🏗 Develop ' + (p.out.length ? p.out.length + ' plot' + (p.out.length === 1 ? '' : 's') : '')
          + (p.out.length && p.grow.length ? ' + ' : '') + (p.grow.length ? p.grow.length + ' taller' : '')
          + ' · ' + cost.toLocaleString() + ' 🔥'
        : '🏗 Develop — nothing ready';
      go.title = work ? 'Raises a building on every zoned, road-fronted, empty plot, and grows what is already there to the density its zone asks for. One summary, not one toast per tile.'
        : 'Zoned plots need to be empty and to touch a road before anything can be raised on them.';
    }
    if (barBtn) barBtn.classList.toggle('active', armed);
  }
  api.onChange(refresh);

  function setOpen(v) {
    open = !!v;
    panel.classList.toggle('on', open);
    if (open) { setArmed(true); api.overlay(true); }
    else setArmed(false);
    refresh();
  }
  function setArmed(v) {
    armed = !!v;
    if (armed && ctx.setMode) { try { ctx.setMode('inspect'); } catch (e) {} }
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
      a.disabled = true;
      try { await api.develop(); } finally { refresh(); }
    }
  });

  /* ── pointer ────────────────────────────────────────────────────────────
     `hot` is the whole guard: armed, over the canvas, and the page able to
     turn a pointer into a tile. Anything else and the event is left alone. */
  function hot(ev) {
    return armed && canvas && ev.target === canvas && typeof ctx.tileFromEvent === 'function';
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
