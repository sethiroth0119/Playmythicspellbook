/* ============================================================================
 * 🎴 THE CARD FACE — rank mark + six-point radial.  round 8 / piece: resonance
 * ----------------------------------------------------------------------------
 * "Players want a badge. Rank is a readout of investment, not a power tier."
 *                                          — resonance-card-training.md §8
 *
 *   Unproven   0        no mark
 *   Blooded    1–150    single bar
 *   Tempered   151–330  double bar
 *   Veteran    331–509  triple bar, subtle glow
 *   Attuned    510      gold sigil
 *
 * "Show the spread on the card face as a small six-point radial. Players will
 *  read those at a glance and it makes deck inspection genuinely interesting."
 *
 * PURE STRING BUILDERS. Nothing here reads a profile, a global or the DOM;
 * every function takes a spread and returns markup. The one impure function
 * is `injectStyle()`, which is idempotent and adds a single <style> — kept in
 * this file rather than a .css so the mark can never fall out of sync with a
 * stylesheet that didn't ship.
 *
 * ⚠ INLINE SVG, NO IMAGES, NO EXTERNAL FONT. This renders inside index.html's
 * existing modals, which already carry their own theme; the radial inherits
 * `currentColor` for its frame so it sits correctly on any card face.
 * ==========================================================================*/

import { STAT_CAP, TOTAL_CAP, normalize, total, rank, statBonus } from './model.js';

const STYLE_ID = 'mres-style';

/** The six axes, in the order they are drawn — clockwise from the top.
 *  ATK and DEF sit opposite each other, MAG opposite RES, HP opposite SPD, so
 *  a bruiser and a mage read as visibly different SHAPES, not just sizes. */
const AXES = [
  { k: 'hp',  label: 'HP',  color: '#7fd18a' },
  { k: 'atk', label: 'ATK', color: '#ff8f6b' },
  { k: 'mag', label: 'MAG', color: '#b78cf0' },
  { k: 'spd', label: 'SPD', color: '#ece68a' },
  { k: 'def', label: 'DEF', color: '#7fb4e6' },
  { k: 'res', label: 'RES', color: '#6fd8cf' },
];

export function injectStyle(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || d.getElementById(STYLE_ID)) return;
  const el = d.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.mres-wrap{display:flex;align-items:center;gap:.7rem;margin-top:.55rem;padding:.5rem .6rem;
  background:rgba(0,0,0,.24);border:1px solid rgba(160,140,90,.28);border-radius:6px}
.mres-radial{flex:0 0 auto;line-height:0}
.mres-meta{min-width:0;flex:1 1 auto}
.mres-rankline{display:flex;align-items:center;gap:.4rem;font-size:.82rem;font-weight:700;letter-spacing:.03em}
.mres-name{color:#e8ddc0}
.mres-name.is-attuned{color:#ffd166;text-shadow:0 0 8px rgba(255,209,102,.55)}
.mres-bars{display:inline-flex;gap:2px;align-items:flex-end}
.mres-bar{width:4px;height:11px;background:linear-gradient(180deg,#e8ddc0,#a8945f);border-radius:1px}
.mres-bars.is-glow .mres-bar{box-shadow:0 0 6px rgba(232,221,192,.75)}
.mres-sigil{font-size:.95rem;filter:drop-shadow(0 0 5px rgba(255,209,102,.8))}
.mres-total{font-size:.72rem;color:#bfae87;font-weight:600}
.mres-spread{margin-top:.25rem;display:flex;flex-wrap:wrap;gap:3px}
.mres-chip{font-size:.66rem;padding:1px 5px;border-radius:3px;border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.05);color:#d8cfb4;white-space:nowrap}
.mres-chip b{font-weight:800}
.mres-none{font-size:.72rem;color:#8d8570}
.mres-hint{font-size:.68rem;color:#8d8570;margin-top:.2rem}
`;
  d.head.appendChild(el);
}

/** Rank mark only — bars / glow / gold sigil. Safe to drop anywhere. */
export function markHTML(spread) {
  const r = rank(spread);
  if (r.id === 'unproven') return '<span class="mres-name">Unproven</span>';
  const bars = '<span class="mres-bar"></span>'.repeat(r.bars);
  const sigil = r.sigil ? '<span class="mres-sigil">✦</span>' : '';
  return `<span class="mres-name${r.sigil ? ' is-attuned' : ''}">${r.name}</span>`
    + `<span class="mres-bars${r.glow ? ' is-glow' : ''}">${bars}</span>${sigil}`;
}

function pt(cx, cy, radius, i, n) {
  const a = (Math.PI * 2 * i) / n - Math.PI / 2;   // start at 12 o'clock
  return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
}

/**
 * The six-point radial. Each axis is drawn as a fraction of ITS OWN 252 cap,
 * so a card that dumped everything into ATK reads as a spike and an even
 * spread reads as a hexagon — which is the whole point of showing it.
 */
export function radialSVG(spread, size) {
  const s = normalize(spread);
  const S = Math.max(40, Number(size) || 76);
  const c = S / 2, R = c - 7, n = AXES.length;
  const grid = [];
  for (const frac of [0.33, 0.66, 1]) {
    const pts = AXES.map((_, i) => pt(c, c, R * frac, i, n).map(v => v.toFixed(1)).join(',')).join(' ');
    grid.push(`<polygon points="${pts}" fill="none" stroke="currentColor" stroke-opacity="${frac === 1 ? 0.34 : 0.16}" stroke-width="1"/>`);
  }
  const spokes = AXES.map((_, i) => {
    const [x, y] = pt(c, c, R, i, n);
    return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.14" stroke-width="1"/>`;
  }).join('');
  const shape = AXES.map((a, i) => {
    const f = Math.max(0, Math.min(1, s[a.k] / STAT_CAP));
    return pt(c, c, R * f, i, n).map(v => v.toFixed(1)).join(',');
  }).join(' ');
  const dots = AXES.map((a, i) => {
    const f = Math.max(0, Math.min(1, s[a.k] / STAT_CAP));
    if (f <= 0) return '';
    const [x, y] = pt(c, c, R * f, i, n);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${a.color}"/>`;
  }).join('');
  const isAttuned = total(s) >= TOTAL_CAP;
  const fill = isAttuned ? 'rgba(255,209,102,0.26)' : 'rgba(150,190,255,0.20)';
  const line = isAttuned ? '#ffd166' : '#9ec7ff';
  const title = AXES.map(a => `${a.label} ${s[a.k]}`).join(' · ');
  return `<svg class="mres-radial-svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="Resonance spread: ${title}">`
    + `<title>${title}</title>${grid.join('')}${spokes}`
    + `<polygon points="${shape}" fill="${fill}" stroke="${line}" stroke-width="1.5" stroke-linejoin="round"/>`
    + dots + `</svg>`;
}

/** The full block: radial + rank mark + the numbers, for a card detail panel. */
export function faceHTML(spread, opts) {
  const o = opts || {};
  const s = normalize(spread);
  const t = total(s);
  const b = statBonus(s);
  const chips = AXES
    .filter(a => s[a.k] > 0)
    .map(a => {
      /* SPD reports TILES, not the raw 4:1 number, and says what the next tile
         costs when none has landed yet — otherwise a half-invested SPD spread
         reads as "+0" and looks like a bug rather than a threshold. */
      const gain = a.k === 'spd'
        ? (b.spdTiles ? `+${b.spdTiles} tile${b.spdTiles === 1 ? '' : 's'}`
                      : `+1 tile at ${Math.floor(STAT_CAP / 2)}`)
        : `+${b[a.k]}`;
      return `<span class="mres-chip" style="border-color:${a.color}55"><b>${a.label}</b> ${s[a.k]} <span style="opacity:.7">(${gain})</span></span>`;
    }).join('');
  const body = t > 0
    ? `<div class="mres-spread">${chips}</div>`
    : `<div class="mres-none">No Resonance yet — fight with this card and the spread follows what it does.</div>`;
  const hint = o.hint === false ? '' :
    `<div class="mres-hint">Every card has the same ${TOTAL_CAP} budget · max ${STAT_CAP} in one stat · 4 = +1</div>`;
  return `<div class="mres-wrap">
    <div class="mres-radial">${radialSVG(s, o.size || 76)}</div>
    <div class="mres-meta">
      <div class="mres-rankline">${markHTML(s)}<span class="mres-total">${t} / ${TOTAL_CAP}</span></div>
      ${body}${hint}
    </div>
  </div>`;
}

export default { injectStyle, markHTML, radialSVG, faceHTML, AXES };
