import fs from 'node:fs';
const F = 'public/index.html';
const APPLY = process.argv.includes('--apply');
const src = fs.readFileSync(F, 'utf8');
const lines = src.split(/\r?\n/);
const NL = src.includes('\r\n') ? '\r\n' : '\n';

/* The function's own span, found by name so a moved line does not silently
   repaint half the file. */
const start = lines.findIndex(l => l.startsWith('function openFoundationReserve()'));
if (start < 0) { console.error('openFoundationReserve not found'); process.exit(1); }
let end = -1;
for (let i = start + 1; i < lines.length; i++) { if (lines[i] === '}') { end = i; break; } }
if (end < 0) { console.error('end of function not found'); process.exit(1); }

/* ── the colour move: the skin block's own transform ──────────────────────
   hue 32°, saturation capped at 0.30, LIGHTNESS UNTOUCHED — identical to
   .gauntlet/_gen-warm-gradients.mjs, so a panel warmed here lands on the same
   charcoal as every panel warmed in the CSS pass. */
const toHsl = (r, g, b) => { r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h * 360, s, l]; };
const toRgb = (h, s, l) => { h = ((h % 360) + 360) % 360 / 360;
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255)); };
const hx = (n) => n.toString(16).padStart(2, '0');
const parse = (c) => {
  if (c[0] === '#') return { rgb: [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)], a: null };
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(c);
  return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? null : m[4] } : null;
};
const warm = (c) => {
  const p = parse(c); if (!p) return null;
  const [h, s, l] = toHsl(...p.rgb);
  const [R, G, B] = toRgb(32, Math.min(s, 0.30), l);
  return p.a === null ? ('#' + hx(R) + hx(G) + hx(B)) : ('rgba(' + R + ',' + G + ',' + B + ',' + p.a + ')');
};

const body = lines.slice(start, end + 1).join('\n');
const all = [...new Set(body.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\)|#[0-9a-fA-F]{6}/g) || [])];

/* WHAT IS CHROME AND WHAT CARRIES MEANING.
   Blue here is the theme — borders, grounds, ink, the depth pills. It is
   chrome and it all goes. Everything else in this modal is information and is
   left exactly as it is:
     · green   #7fe0a0 / #5fbf88 / rgba(127,224,160,…)  yours · supplied · positive
     · amber   #ffd166 / #e0b84a / #e8cf94              cinder, warnings
     · red     #e07a6a / #ff9a6b                        loss, seizure, danger
     · purple  #caa0e6 / #e0a0ff / rgba(176,140,255,…)  Black Market · "not yours"
   The purples are the same class the theme audit already excuses by name
   (.csx-chip, Aza, pledge tiers): a category colour, not a frame that drifted. */
const isBlue = (c) => {
  const p = parse(c); if (!p) return false;
  const [r, g, b] = p.rgb;
  if (!((b - r) > 8 && b >= g)) return false;      // audit-theme's own cool() test
  const [h] = toHsl(r, g, b);
  return h >= 175 && h <= 255;                     // blue band only; purple starts above
};
const map = new Map();
for (const c of all) if (isBlue(c)) map.set(c, warm(c));

console.log('\n🏛 FOUNDATION RESERVE · ' + map.size + ' blue chrome values of ' + all.length + ' total\n');
for (const [a, b] of [...map].sort()) {
  const p = parse(a), q = parse(b);
  console.log('   ' + a.padEnd(24) + ' → ' + String(b).padEnd(24)
    + ' rgb(' + p.rgb.join(',') + ') → rgb(' + q.rgb.join(',') + ')');
}
const kept = all.filter(c => !map.has(c) && (() => { const p = parse(c); return p && (p.rgb[2] - p.rgb[0]) > 8 && p.rgb[2] >= p.rgb[1]; })());
console.log('\n   kept as meaning-colour (' + kept.length + '): ' + kept.join(' '));

if (!APPLY) { console.log('\n   dry run — pass --apply to write\n'); process.exit(0); }

let out = body, hits = 0;
/* Longest first: "#9fc0ec" must not be eaten by a shorter overlapping token,
   and rgba(120,170,255,0.4) must not be matched inside rgba(120,170,255,0.45). */
for (const [a, b] of [...map].sort((x, y) => y[0].length - x[0].length)) {
  const parts = out.split(a);
  hits += parts.length - 1;
  out = parts.join(b);
}
const merged = lines.slice(0, start).concat(out.split('\n'), lines.slice(end + 1)).join(NL);
fs.writeFileSync(F, merged);
console.log('\n   replaced ' + hits + ' occurrences inside openFoundationReserve\n');
