/* ══ THE COLOUR PICKER — hand built, no dependency ═════════════════════════
   A hue RING with a draggable handle, a saturation/value SQUARE inside it with
   its own handle, three horizontal sliders (hue / saturation / luminance) and a
   two-way HEX field.

   ── Keyboard is not an afterthought here ────────────────────────────────
   CLAUDE.md's conventions require focus-visible to work, and a picker that is
   mouse-only fails that outright — so EVERY value is reachable without a
   pointer, by three different routes:
     · the three sliders are native <input type="range">, so arrows, Home/End
       and PageUp/PageDown all work with no code from us and the browser's own
       focus ring is honoured;
     · the hex field is a native <input type="text"> that commits on Enter and
       on blur, and rejects anything that is not a colour without clobbering
       what you typed;
     · the ring/square canvas itself is tabbable (`tabindex=0`, role=application)
       and takes ←/→ for hue, ↑/↓ for value and PageUp/PageDown for saturation,
       ×10 with Shift, so the visual control is drivable too rather than being
       a dead zone in the tab order.

   ── One model, one source of truth ──────────────────────────────────────
   See color.js's header: the hex string is the state. Nothing here caches an
   H, an S or a V between events except `lastHue`, which exists because hue is
   undefined at zero saturation and every picker has to remember it or the ring
   handle snaps to red the moment you drag into the grey column.
   ══════════════════════════════════════════════════════════════════════════ */
import {
  clamp, normHex, hexToHsv, hexToHsl, hsvToHex, hslToHex, lum,
} from './color.js';

const R_OUT = 88, R_IN = 68, SIZE = 190;
// The square is inscribed in the ring's inner circle: side = 2·r/√2, minus a
// hair so its corners cannot bleed over the ring's inner edge.
const SQ = Math.floor(R_IN * Math.SQRT2) - 6;

const el = (tag, cls, attrs) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/**
 * @param {{value?:string, onInput?:(hex)=>void, onCommit?:(hex)=>void}} opt
 *   onInput fires continuously while dragging (live preview on the mesh);
 *   onCommit fires when the gesture ends (that is the one that saves).
 * @returns {{root:HTMLElement, set:(hex)=>void, get:()=>string, focus:()=>void, destroy:()=>void}}
 */
export function createPicker(opt) {
  opt = opt || {};
  let hex = normHex(opt.value) || 'c9af8f';
  let lastHue = hexToHsv(hex).h;

  const root = el('div', 'np-picker');

  // ── canvas: ring + square ───────────────────────────────────────────────
  const cvWrap = el('div', 'np-cvwrap');
  const cv = el('canvas', 'np-cv', {
    width: String(SIZE), height: String(SIZE), tabindex: '0', role: 'application',
    'aria-label': 'Colour wheel. Left and right arrows change hue, up and down change brightness, page up and page down change saturation.',
  });
  cvWrap.appendChild(cv);
  root.appendChild(cvWrap);
  const ctx = cv.getContext('2d');

  // ── sliders ─────────────────────────────────────────────────────────────
  const mkSlider = (id, label, max) => {
    const row = el('div', 'np-srow');
    const lab = el('label', 'np-slab'); lab.textContent = label; lab.htmlFor = id;
    const inp = el('input', 'np-sl', { type: 'range', min: '0', max: String(max), step: '1', id });
    const out = el('span', 'np-sval');
    row.appendChild(lab); row.appendChild(inp); row.appendChild(out);
    return { row, inp, out };
  };
  const uid = 'np' + Math.random().toString(36).slice(2, 7);
  const sH = mkSlider(uid + 'h', 'Hue', 360);
  const sS = mkSlider(uid + 's', 'Saturation', 100);
  const sL = mkSlider(uid + 'l', 'Luminance', 100);
  const sliders = el('div', 'np-sliders');
  sliders.appendChild(sH.row); sliders.appendChild(sS.row); sliders.appendChild(sL.row);
  root.appendChild(sliders);

  // ── hex field ───────────────────────────────────────────────────────────
  const hexRow = el('div', 'np-hexrow');
  const chip = el('span', 'np-chip');
  const hlab = el('label', 'np-slab', { for: uid + 'x' }); hlab.textContent = 'Hex';
  const hin = el('input', 'np-hex', {
    type: 'text', id: uid + 'x', maxlength: '7', spellcheck: 'false',
    autocomplete: 'off', 'aria-label': 'Hex colour value',
  });
  hexRow.appendChild(chip); hexRow.appendChild(hlab); hexRow.appendChild(hin);
  /* In the SLIDER column, not on its own row under the wheel. The wheel is
     190px tall inside a dossier pane that already scrolls; a fourth row beneath
     it put the hex field below the fold at 1600x900, and the hex field is the
     one control the reference panel puts a value in. */
  sliders.appendChild(hexRow);

  /* ── painting ───────────────────────────────────────────────────────────
     Redrawn in full on every change. 190×190 with 360 wedges is well under a
     millisecond and it is only ever running while a panel is open, so caching
     the ring to an offscreen buffer would be complexity bought for nothing. */
  function draw() {
    const { h, s, v } = hexToHsv(hex);
    const hue = s < .02 ? lastHue : h;
    const c = SIZE / 2;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // hue ring — wedges, each 1° wide with a 1° overlap so no seam shows
    for (let d = 0; d < 360; d++) {
      const a0 = (d - 90.5) * Math.PI / 180, a1 = (d - 88.5) * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(c, c, R_OUT, a0, a1, false);
      ctx.arc(c, c, R_IN, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = 'hsl(' + d + ',100%,50%)';
      ctx.fill();
    }

    // saturation / value square
    const x0 = c - SQ / 2, y0 = c - SQ / 2;
    ctx.fillStyle = 'hsl(' + hue + ',100%,50%)';
    ctx.fillRect(x0, y0, SQ, SQ);
    let g = ctx.createLinearGradient(x0, 0, x0 + SQ, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, SQ, SQ);
    g = ctx.createLinearGradient(0, y0, 0, y0 + SQ);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, SQ, SQ);

    // handles — a dark ring inside a light ring, so they read on any colour
    const ha = (hue - 90) * Math.PI / 180, hr = (R_OUT + R_IN) / 2;
    ring(c + Math.cos(ha) * hr, c + Math.sin(ha) * hr, 8);
    ring(x0 + s * SQ, y0 + (1 - v) * SQ, 7);

    function ring(px, py, r) {
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function syncControls() {
    const hsl = hexToHsl(hex), hsv = hexToHsv(hex);
    const hue = hsl.s < .02 ? lastHue : hsl.h;
    sH.inp.value = String(Math.round(hue));      sH.out.textContent = Math.round(hue) + '°';
    sS.inp.value = String(Math.round(hsl.s * 100)); sS.out.textContent = Math.round(hsl.s * 100) + '%';
    sL.inp.value = String(Math.round(hsl.l * 100)); sL.out.textContent = Math.round(hsl.l * 100) + '%';
    if (document.activeElement !== hin) hin.value = hex.toUpperCase();
    chip.style.background = '#' + hex;
    chip.style.color = lum(hex) > .55 ? '#100d1a' : '#efe9dd';
    // Tint the slider tracks so each one previews what moving it would do.
    sH.inp.style.setProperty('--np-track',
      'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)');
    sS.inp.style.setProperty('--np-track',
      'linear-gradient(90deg,' + '#' + hslToHex(hue, 0, hsl.l) + ',#' + hslToHex(hue, 1, hsl.l) + ')');
    sL.inp.style.setProperty('--np-track',
      'linear-gradient(90deg,#000,' + '#' + hslToHex(hue, hsl.s, .5) + ',#fff)');
    if (hsv.s >= .02) lastHue = hsv.h;
  }

  function paint(next, commit) {
    const v = normHex(next);
    if (!v) return;
    hex = v;
    draw(); syncControls();
    try { if (opt.onInput) opt.onInput(hex); } catch (e) {}
    if (commit) { try { if (opt.onCommit) opt.onCommit(hex); } catch (e) {} }
  }

  /* ── pointer ────────────────────────────────────────────────────────────
     Which control you grabbed is decided ONCE, on pointerdown, and held for the
     whole gesture. Deciding per-move meant a fast drag out of the square and
     across the ring hijacked the hue mid-stroke, which felt broken. */
  let mode = null;
  const local = (ev) => {
    const r = cv.getBoundingClientRect();
    // The canvas is CSS-scaled on narrow panels, so map through its own rect.
    const sx = r.width ? SIZE / r.width : 1, sy = r.height ? SIZE / r.height : 1;
    return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
  };
  const applyPoint = (p, commit) => {
    const c = SIZE / 2;
    if (mode === 'ring') {
      const h = (Math.atan2(p.y - c, p.x - c) * 180 / Math.PI + 90 + 360) % 360;
      lastHue = h;
      const cur = hexToHsv(hex);
      paint(hsvToHex(h, cur.s, cur.v), commit);
    } else if (mode === 'sq') {
      const x0 = c - SQ / 2, y0 = c - SQ / 2;
      const s = clamp((p.x - x0) / SQ, 0, 1), v = clamp(1 - (p.y - y0) / SQ, 0, 1);
      const cur = hexToHsv(hex);
      paint(hsvToHex(cur.s < .02 ? lastHue : cur.h, s, v), commit);
    }
  };
  const onDown = (ev) => {
    const p = local(ev), c = SIZE / 2;
    const d = Math.hypot(p.x - c, p.y - c);
    const half = SQ / 2;
    if (Math.abs(p.x - c) <= half && Math.abs(p.y - c) <= half) mode = 'sq';
    else if (d >= R_IN - 4 && d <= R_OUT + 4) mode = 'ring';
    else return;
    ev.preventDefault();
    try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    cv.focus();
    applyPoint(p, false);
  };
  const onMove = (ev) => { if (!mode) return; ev.preventDefault(); applyPoint(local(ev), false); };
  const onUp = (ev) => {
    if (!mode) return;
    applyPoint(local(ev), true);
    mode = null;
    try { cv.releasePointerCapture(ev.pointerId); } catch (e) {}
  };
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);

  // ── keyboard on the canvas ──────────────────────────────────────────────
  cv.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 10 : 1;
    const hsv = hexToHsv(hex);
    const h = hsv.s < .02 ? lastHue : hsv.h;
    let nh = h, ns = hsv.s, nv = hsv.v, hit = true;
    switch (ev.key) {
      case 'ArrowLeft':  nh = h - step; break;
      case 'ArrowRight': nh = h + step; break;
      case 'ArrowUp':    nv = clamp(hsv.v + step / 100, 0, 1); break;
      case 'ArrowDown':  nv = clamp(hsv.v - step / 100, 0, 1); break;
      case 'PageUp':     ns = clamp(hsv.s + step / 100, 0, 1); break;
      case 'PageDown':   ns = clamp(hsv.s - step / 100, 0, 1); break;
      default: hit = false;
    }
    if (!hit) return;
    ev.preventDefault();
    lastHue = ((nh % 360) + 360) % 360;
    paint(hsvToHex(nh, ns, nv), true);
  });

  // ── sliders ─────────────────────────────────────────────────────────────
  const sliderPaint = (commit) => {
    const h = +sH.inp.value, s = +sS.inp.value / 100, l = +sL.inp.value / 100;
    lastHue = h;
    paint(hslToHex(h, s, l), commit);
  };
  for (const s of [sH, sS, sL]) {
    s.inp.addEventListener('input', () => sliderPaint(false));
    s.inp.addEventListener('change', () => sliderPaint(true));
  }

  // ── hex field: two-way, and forgiving ───────────────────────────────────
  const commitHex = () => {
    const v = normHex(hin.value);
    // Refuse silently rather than wiping what the player typed — a half-typed
    // "C9A" is a legal prefix of a legal value and clobbering it mid-keystroke
    // makes the field impossible to use.
    if (!v) { hin.value = hex.toUpperCase(); return; }
    paint(v, true);
    hin.value = v.toUpperCase();
  };
  hin.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitHex(); }
    else if (ev.key === 'Escape') { hin.value = hex.toUpperCase(); hin.blur(); }
  });
  hin.addEventListener('blur', commitHex);
  hin.addEventListener('input', () => {
    const v = normHex(hin.value);
    if (v) paint(v, false);          // live preview while typing a full value
  });

  draw(); syncControls();

  return {
    root,
    get: () => hex,
    set: (v) => { const n = normHex(v); if (!n) return; hex = n; const q = hexToHsv(n); if (q.s >= .02) lastHue = q.h; draw(); syncControls(); },
    focus: () => { try { cv.focus(); } catch (e) {} },
    destroy: () => {
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      try { root.remove(); } catch (e) {}
    },
  };
}
