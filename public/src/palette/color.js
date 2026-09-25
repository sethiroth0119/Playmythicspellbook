/* ══ COLOUR MATHS — no dependency, no THREE ═══════════════════════════════
   The picker's whole model is: **the hex string is the single source of
   truth**. Every control (ring, square, three sliders, the text field) reads
   a hex, produces a hex, and never keeps its own private H/S/V state.

   ⚠ WHY THAT MATTERS, and it is not style. A picker that stores HSV for the
   square and HSL for the sliders has TWO models of the same colour, and they
   drift: drag the square, then nudge the luminance slider, and the hue jumps
   because the slider round-tripped through a different space. The only place
   any state survives a keystroke is `lastHue` (see below), because hue is
   genuinely undefined at zero saturation and every picker in existence has to
   remember it or the ring handle snaps to red the moment you drag to grey.
   ══════════════════════════════════════════════════════════════════════════ */

export const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);

/** '#c9af8f' | 'c9af8f' | 'C9A' → 'c9af8f'; anything else → null. */
export function normHex(s) {
  if (typeof s !== 'string') return null;
  let v = s.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(v)) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
  return /^[0-9a-f]{6}$/.test(v) ? v : null;
}

export function hexToRgb(hex) {
  const v = normHex(hex) || '000000';
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const f = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0');
  return f(r) + f(g) + f(b);
}

/* ── HSV: what the saturation/value SQUARE is drawn in ───────────────────── */
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); v = clamp(v, 0, 1);
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/* ── HSL: what the three SLIDERS are labelled in, because "luminance" is the
      word on the reference panel and HSL is the space that word belongs to.
      The square stays HSV; the two never meet except through a hex.        */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (d) {
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const hexToHsv = (hex) => { const c = hexToRgb(hex); return rgbToHsv(c.r, c.g, c.b); };
export const hexToHsl = (hex) => { const c = hexToRgb(hex); return rgbToHsl(c.r, c.g, c.b); };
export const hsvToHex = (h, s, v) => { const c = hsvToRgb(h, s, v); return rgbToHex(c.r, c.g, c.b); };
export const hslToHex = (h, s, l) => { const c = hslToRgb(h, s, l); return rgbToHex(c.r, c.g, c.b); };

/** Relative luminance, for deciding whether a swatch needs a light or dark label. */
export function lum(hex) {
  const c = hexToRgb(hex);
  return (c.r * .299 + c.g * .587 + c.b * .114) / 255;
}
