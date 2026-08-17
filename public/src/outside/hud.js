/* ============================================================================
   🛣 OUTSIDE CONNECTIONS — the HUD chip.
   ============================================================================
   A silent gate is indistinguishable from a broken feature. If caravans stop
   leaving and nothing on screen says why, the player's only available reading
   is "the game is broken" — so the state is always on screen, and when it is
   red it says what to build.

   The chip OWNS ITS OWN DOM. It is created here and appended to <body>, so the
   feature needs no markup in node-city/index.html and a 404 on this module
   costs a chip and nothing else. It sits directly under #daypill and borrows
   that pill's visual language deliberately: same radius, same blur, same
   Cinzel caps, so it reads as part of the HUD and not as a debug overlay.
   ============================================================================ */

const CSS = `
#oc-chip{position:absolute;left:50%;transform:translateX(-50%);
  top:calc(var(--topbarh,54px) + 34px);z-index:5;cursor:pointer;
  display:flex;align-items:center;gap:8px;padding:5px 15px;border-radius:999px;
  font-size:11px;letter-spacing:.09em;text-transform:uppercase;
  font-family:'Cinzel','Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  background:linear-gradient(180deg,rgba(24,20,44,.94),rgba(9,8,18,.96));
  box-shadow:0 6px 22px rgba(0,0,0,.5);backdrop-filter:blur(6px);
  border:1px solid rgba(140,190,160,.45);color:#cfe6d6;transition:opacity .2s;}
#oc-chip .oc-ico{font-size:14px;}
#oc-chip .oc-sub{opacity:.72;text-transform:none;letter-spacing:.02em;font-family:inherit;}
#oc-chip.bad{border-color:rgba(226,110,92,.7);color:#f0c3b6;
  animation:ocpulse 1.6s ease-in-out infinite;}
#oc-chip.warn{border-color:rgba(226,186,92,.65);color:#efdcb0;}
@keyframes ocpulse{0%,100%{box-shadow:0 6px 22px rgba(0,0,0,.5);}
  50%{box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 16px rgba(226,110,92,.45);}}

#oc-panel{position:absolute;left:50%;transform:translateX(-50%);
  top:calc(var(--topbarh,54px) + 68px);z-index:6;width:min(430px,92vw);
  background:linear-gradient(180deg,rgba(22,19,40,.98),rgba(10,9,20,.99));
  border:1px solid rgba(212,175,55,.4);border-radius:12px;padding:14px 16px;
  box-shadow:0 14px 40px rgba(0,0,0,.65);color:#cfc7e0;font-size:12px;line-height:1.5;}
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

let _chip = null, _panel = null, _open = false, _styled = false;
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
    if (!_chip) {
      _chip = document.createElement('div');
      _chip.id = 'oc-chip';
      _chip.title = 'Outside Connections — click for detail';
      _chip.onclick = () => toggle(_last);
      document.body.appendChild(_chip);
    }
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
    if (!_panel) {
      _panel = document.createElement('div');
      _panel.id = 'oc-panel';
      _panel.onclick = (e) => { if (e.target.closest('[data-oc-close]')) close(); };
      document.body.appendChild(_panel);
    }
    _panel.innerHTML = panelHtml(st);
    _panel.style.display = '';
    _open = true;
  } catch (e) {}
}
export function close() { _open = false; if (_panel) _panel.style.display = 'none'; }
export function isOpen() { return _open; }
