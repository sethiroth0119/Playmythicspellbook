/* ============================================================================
   🛣 OUTSIDE CONNECTIONS — the HUD chip.
   ============================================================================
   A silent gate is indistinguishable from a broken feature. If caravans stop
   leaving and nothing on screen says why, the player's only available reading
   is "the game is broken" — so the state is always on screen, and when it is
   red it says what to build.

   The chip OWNS ITS OWN DOM. It is created here, so the feature needs no markup
   in node-city/index.html and a 404 on this module costs a chip and nothing
   else.

   🔴 WHERE IT LIVES, AND WHY THAT IS NOT A TASTE DECISION.
   It used to be `position:absolute` on <body> at top:calc(--topbarh + 34px),
   which is the EXACT top #railbar claims (index.html, the rail-dock block).
   Two absolutely-positioned elements were then racing for one band of screen,
   and the rail won: it is z-index 43 against this chip's 5. Photographed, the
   chip was not merely overlapped, it was GONE — the eleven visible launcher
   pills painted straight over it and all that survived was a few pixels of its
   red border bleeding through the 6px gaps between them. elementsFromPoint at the chip's
   centre landed on whatever pill happened to be there, so it was unclickable
   too, and the ONLY HUD affordance for the whole outside-trade system read as
   a missing feature rather than as a gate.

   The fix is to stop floating over that layout and JOIN it. #railbar is a
   `flex-wrap:wrap` track that already spans the full width and already centres
   its children, so the chip goes IN it as `#oc-dock` — a flex item with
   `flex:0 0 100%`, which forces its own line, and `order:9`, which pins that
   line BELOW the launchers no matter which finishes appending first (the rail
   block is top-level in index.html's module script; this module is imported
   from an async boot(), so the DOM order is a race and the order property is
   the thing that is not).

   Consequences that are load-bearing, not incidental:
     • The chip inherits the rail's z-index 43, so it now sits above the
       service panels (#ncpol / #ncpwr / #ncwtr, z-index 8) instead of under
       them — which is the correct reading for the one element that explains
       why trade has stopped.
     • It inherits `pointer-events:none` on the track, so the empty width
       either side of the chip still passes camera drags through. The chip and
       the panel turn pointer events back on for themselves, exactly as `.rl`
       does.
     • When the rail wraps to a second line at a narrow width, the chip moves
       down with it instead of being buried. Nothing is measured or hardcoded.
   It keeps #daypill's pill shape rather than `.rl`'s 8px box on purpose: it is
   a STATUS READOUT that happens to open a panel, not a thirteenth launcher,
   and the rail row is explicitly full — read the width note above RAILS in
   index.html before ever trying to make it one.
   ============================================================================ */

const CSS = `
#oc-dock{flex:0 0 100%;order:9;display:flex;justify-content:center;
  position:relative;pointer-events:none;}
/* Fallback ONLY for a page with no rail dock to join (the module is meant to
   survive being loaded into a host that never shipped #railbar). Then, and only
   then, +34 is free real estate and the old absolute placement is right. */
#oc-dock.oc-loose{position:absolute;left:12px;right:12px;
  top:calc(var(--topbarh,54px) + 34px);z-index:43;}

#oc-chip{pointer-events:auto;appearance:none;-webkit-appearance:none;
  margin:0;cursor:pointer;
  /* ⚠ WRAPS RATHER THAN OVERFLOWS. The cut-off chip is 515px of text and the
     dock is only as wide as the viewport, so below ~560px it has to go
     somewhere. Two centred lines inside the pill, NOT a hidden .oc-sub: the
     sub-clause IS the instruction the player has to follow, and dropping it is
     how the chip goes half-dark again on a phone. */
  max-width:calc(100vw - 28px);flex-wrap:wrap;justify-content:center;text-align:center;
  display:flex;align-items:center;gap:8px;padding:5px 15px;border-radius:999px;
  font-size:11px;letter-spacing:.09em;text-transform:uppercase;
  font-family:'Cinzel','Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  background:linear-gradient(180deg,rgba(24,20,44,.94),rgba(9,8,18,.96));
  box-shadow:0 6px 22px rgba(0,0,0,.5);backdrop-filter:blur(6px);
  border:1px solid rgba(140,190,160,.45);color:#cfe6d6;transition:opacity .2s,border-color .15s;}
#oc-chip:hover{border-color:rgba(170,225,190,.85);}
#oc-chip:focus-visible{outline:2px solid #d4af37;outline-offset:2px;}
#oc-chip .oc-ico{font-size:14px;}
#oc-chip .oc-sub{opacity:.72;text-transform:none;letter-spacing:.02em;font-family:inherit;}
#oc-chip.bad{border-color:rgba(226,110,92,.7);color:#f0c3b6;
  animation:ocpulse 1.6s ease-in-out infinite;}
#oc-chip.warn{border-color:rgba(226,186,92,.65);color:#efdcb0;}
@keyframes ocpulse{0%,100%{box-shadow:0 6px 22px rgba(0,0,0,.5);}
  50%{box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 16px rgba(226,110,92,.45);}}
@media (prefers-reduced-motion:reduce){#oc-chip.bad{animation:none;
  box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 16px rgba(226,110,92,.45);}}

/* Hung off the DOCK, not off the viewport: the panel has to follow the chip
   when the rail row wraps, and the old hardcoded top:calc(--topbarh + 68px)
   could not. pointer-events back on, because the track turned them off. */
#oc-panel{position:absolute;top:calc(100% + 8px);left:50%;
  transform:translateX(-50%);pointer-events:auto;
  width:min(430px,92vw);
  background:linear-gradient(180deg,rgba(22,19,40,.98),rgba(10,9,20,.99));
  border:1px solid rgba(212,175,55,.4);border-radius:12px;padding:14px 16px;
  box-shadow:0 14px 40px rgba(0,0,0,.65);color:#cfc7e0;font-size:12px;line-height:1.5;
  max-height:calc(100vh - var(--topbarh,54px) - 160px);overflow-y:auto;}
#oc-panel h3{margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;
  font-family:'Cinzel',serif;color:#e8dcc0;}
#oc-panel .oc-lede{color:#9a93ad;margin:0 0 10px;}
#oc-panel .oc-row{display:flex;gap:9px;align-items:flex-start;padding:7px 0;
  border-top:1px solid rgba(255,255,255,.07);}
#oc-panel .oc-row b{display:block;color:#e6dfff;font-size:11.5px;letter-spacing:.05em;}
#oc-panel .oc-row span{color:#9a93ad;}
#oc-panel .oc-ok{color:#8fd6ab;} #oc-panel .oc-no{color:#e08a76;}
#oc-panel .oc-fix{margin-top:9px;padding:8px 10px;border-radius:8px;
  background:rgba(226,110,92,.12);border:1px solid rgba(226,110,92,.3);color:#f0cfc4;}
#oc-panel .oc-seam{margin-top:9px;color:#6f6885;font-size:10.5px;}
#oc-panel .oc-close{position:absolute;right:9px;top:7px;cursor:pointer;color:#7d7695;
  font-size:14px;line-height:1;}
`;

let _dock = null, _chip = null, _panel = null, _open = false, _styled = false, _dismissWired = false;
/* ⚠ THE CLICK HANDLER READS THIS, NOT ITS CLOSURE. The chip's onclick is bound
   once, on first render; capturing `st` there would pin the panel to whatever
   the connection state was the first time the HUD painted — the panel would
   still say "cut off" after the player fixed it. */
let _last = { connected: true, modes: [], fix: '', waived: false, waivedUntil: 0, viaLabel: null };

function style() {
  if (_styled) return; _styled = true;
  const s = document.createElement('style'); s.id = 'oc-style'; s.textContent = CSS;
  document.head.appendChild(s);
}

/** The one line of DOM this module inserts into somebody else's layout.
    ⚠ It is re-resolved on every call rather than cached-and-forgotten, because
      the rail dock may not have been built the first time render() runs: this
      module is imported from an async boot(), the rail block is synchronous
      top-level code in the same script, and which one lands first is a race we
      do not get to win. If we opened in the `oc-loose` fallback and #railbar
      turns up later, the dock MOVES into it. */
function dock() {
  if (typeof document === 'undefined' || !document.body) return null;
  const bar = document.getElementById('railbar');
  if (!_dock) {
    _dock = document.createElement('div');
    _dock.id = 'oc-dock';
  }
  const host = bar || document.body;
  if (_dock.parentElement !== host) host.appendChild(_dock);
  _dock.classList.toggle('oc-loose', !bar);
  return _dock;
}

/* 🖱 CLICK-AWAY. Bound once, on <body>, in the BUBBLE phase so it can never eat
   a click the game wanted — by the time it runs, the rail launcher (or the map)
   has already had it. This is what closes the panel when the player opens a
   rail panel instead: the modal that would otherwise be overlapped by a 430px
   box hanging off a z-index-43 dock is simply never overlapped, because the
   mousedown that opened it dismissed us first. */
function wireDismiss() {
  if (_dismissWired) return; _dismissWired = true;
  document.addEventListener('mousedown', (ev) => {
    if (!_open) return;
    try { if (ev.target && ev.target.closest && ev.target.closest('#oc-dock')) return; } catch (e) {}
    close();
  }, false);
  addEventListener('keydown', (ev) => { if (_open && ev.key === 'Escape') close(); });
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function panelHtml(st) {
  const rows = st.modes.map(m =>
    '<div class="oc-row"><span class="oc-ico">' + esc(m.ico) + '</span><div><b>' + esc(m.label) +
    ' — <span class="' + (m.ok ? 'oc-ok">Linked' : 'oc-no">Not linked') + '</span></b>' +
    '<span>' + esc(m.why) + '</span></div></div>').join('');
  const fix = st.connected ? '' :
    '<div class="oc-fix"><b>To reconnect:</b> ' + esc(st.fix) + '</div>';
  const waived = st.waived
    ? '<div class="oc-fix"><b>Grandfathered.</b> This city predates outside connections, so trade is still open until '
      + esc(new Date(st.waivedUntil).toLocaleDateString()) + '. Build the link before then.</div>' : '';
  return '<span class="oc-close" data-oc-close>✕</span>'
    + '<h3>Outside Connections</h3>'
    + '<p class="oc-lede">Your city must be joined to the highway that runs past the map before it can do business with other players’ cities. '
    + 'Caravans, shipments and lot deals all leave along it.</p>'
    + rows + fix + waived
    + '<div class="oc-seam">Air and water routes are not on this map yet — there is no coast and no flight path to connect to.</div>';
}

/** Paint. Safe to call every HUD refresh; it is a couple of string compares
    when nothing has changed, which is the common case. */
export function render(st) {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    _last = st;
    style();
    const d = dock();
    if (!d) return;
    if (!_chip) {
      /* A real <button>, not the <div> this shipped as: it now lands in a row
         of launcher buttons, and the proof this fix has to survive is A REAL
         CLICK — which means it also has to be reachable by Tab and Enter. */
      _chip = document.createElement('button');
      _chip.type = 'button';
      _chip.id = 'oc-chip';
      _chip.title = 'Outside Connections — click for detail';
      _chip.setAttribute('aria-expanded', 'false');
      _chip.onclick = () => toggle(_last);
      wireDismiss();
    }
    if (_chip.parentElement !== d) d.insertBefore(_chip, d.firstChild);
    const ok = st.connected;
    const cls = ok ? (st.waived ? 'warn' : '') : 'bad';
    const label = ok
      ? (st.waived ? 'Grandfathered link' : (st.viaLabel || 'Highway') + ' linked')
      : 'City is cut off';
    const sub = ok ? '' : ' <span class="oc-sub">· ' + esc(shortFix(st)) + '</span>';
    const html = '<span class="oc-ico">' + (ok ? '🛣' : '⛔') + '</span>' + esc(label) + sub;
    if (_chip.__h !== html) { _chip.innerHTML = html; _chip.__h = html; }
    if (_chip.className !== cls) _chip.className = cls;
    if (_open && _panel) _panel.innerHTML = panelHtml(st);
  } catch (e) { /* the HUD may never break the game loop */ }
}

/* The chip has room for a clause, not a paragraph. The paragraph is one click
   away; this is the half that has to fit. */
function shortFix(st) {
  const road = st.modes[0];
  if (!road) return 'build a Highway Interchange';
  if (/No Highway Interchange/i.test(road.why)) return 'build a Highway Interchange on the north edge';
  if (/no road touching/i.test(road.why)) return 'lay road up to the interchange';
  if (/DAMAGED/i.test(road.why)) return 'repair the interchange';
  if (/too far inland/i.test(road.why)) return 'the interchange must sit on the north edge';
  return 'join the interchange to your streets';
}

export function toggle(st) {
  try {
    st = st || _last;
    if (_open) { close(); return; }
    style();
    const d = dock();
    if (!d) return;
    if (!_panel) {
      _panel = document.createElement('div');
      _panel.id = 'oc-panel';
      _panel.setAttribute('role', 'dialog');
      _panel.setAttribute('aria-label', 'Outside Connections');
      _panel.onclick = (e) => { if (e.target.closest('[data-oc-close]')) close(); };
      wireDismiss();
    }
    /* In the dock, not on <body>: `#oc-panel` is `top:calc(100% + 8px)` of a
       `position:relative` dock, so it tracks the chip wherever the rail row
       puts it — including onto a second line at a narrow width. */
    if (_panel.parentElement !== d) d.appendChild(_panel);
    _panel.innerHTML = panelHtml(st);
    _panel.style.display = '';
    _open = true;
    if (_chip) _chip.setAttribute('aria-expanded', 'true');
  } catch (e) {}
}
export function close() {
  _open = false;
  if (_panel) _panel.style.display = 'none';
  if (_chip) _chip.setAttribute('aria-expanded', 'false');
}
export function isOpen() { return _open; }
