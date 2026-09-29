/* ══════════════════════════════════════════════════════════════════════════
   🎴 MythicCardSheet — the tabletop character sheet
   ──────────────────────────────────────────────────────────────────────────
   Renders ONE layout that serves BOTH detail surfaces the owner asked to
   rebuild: the in-hand card detail, and the on-field unit detail. They differ
   in exactly three ways, and the difference is DATA, not a second template:

     · the portrait  — card art in hand, the unit's field sprite on the board
     · the bond hex  — units only; a spell has nothing to be loyal to
     · the actions   — Play / Cast / Activate in hand, Close only when viewing

   🔴 THE GLOBALS TRAP (CLAUDE.md). `App`, `Profile`, `Forge` and friends are
   top-level `const` in index.html — lexical bindings that are NOT on `window`,
   so nothing in this file can see them and nothing in this file may try. Every
   value arrives in the `ctx` object that index.html hands us. That is also why
   the long-tail effect blocks (counters, in-grave, on-resurrect, while-in-hand,
   city work) arrive as PRE-BUILT HTML strings: they are produced by a dozen
   describe* helpers that live over there, and re-deriving them here would mean
   two descriptions of the same effect drifting apart.

   ⚠ WHAT THIS MODULE MUST NEVER DO: decide whether a card can be played. The
   caller computes `disabled` for every action and we render it. The old modal
   had a play-gate expressed twice — once for the button and once for the click
   handler — and they disagreed on Underdog cards.
   ══════════════════════════════════════════════════════════════════════════ */

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Bar colours, keyed to the stat gems. Deliberately NOT read from a CSS var per
   stat: the fill needs the colour as a value for its own box-shadow glow too,
   and one source beats two that can disagree. */
const STAT_COLOR = {
  hp: '#5fd47a', atk: '#ff6b5e', def: '#c9d4e2',
  mag: '#c07bff', res: '#4fd6c0', spd: '#ffd45e',
};
const STAT_MAX = { hp: 250, atk: 100, def: 100, mag: 100, res: 100, spd: 3 };
const STAT_ORDER = [
  ['HP', 'hp'], ['ATK', 'atk'], ['DEF', 'def'],
  ['MAG', 'mag'], ['RES', 'res'], ['SPD', 'spd'],
];

/* `iconOf` is handed in by the caller (index.html's getStatIcon), because the
   icon filenames live in a table over there and a second copy of that table
   here is a promise to forget one of them when art changes. */
function statCells(stats, iconOf) {
  const cells = STAT_ORDER
    .filter(([, k]) => stats[k] != null)
    .map(([label, k]) => `<div class="tts-cell">${iconOf ? iconOf(k, '15px') : ''}`
      + `<span class="k">${label}</span><span class="v">${stats[k] | 0}</span></div>`);
  if (!cells.length) return '';
  return `<div class="tts-stats"><div class="tts-grid">${cells.join('')}</div></div>`;
}

function statBars(stats, iconOf, opts) {
  const o = opts || {};
  const rows = STAT_ORDER.filter(([, k]) => stats[k] != null).map(([label, k]) => {
    /* ❤️ A unit on the board has a CURRENT hp that is not its max, and the bar is
       the only place that distinction is visible at a glance. The ceiling is the
       larger of the table max and this unit's own max, so a 300-hp boss does not
       render a bar that is silently clipped at 100%. */
    const isHp = k === 'hp';
    const max = isHp ? Math.max(STAT_MAX.hp, o.maxHp || stats.hp || 1) : (STAT_MAX[k] || 100);
    const val = (isHp && o.currentHp != null) ? o.currentHp : (stats[k] || 0);
    const shown = (isHp && o.currentHp != null) ? `${o.currentHp}/${o.maxHp}` : (stats[k] | 0);
    const pct = Math.max(0, Math.min(100, (val / (max || 1)) * 100));
    return `<div class="tts-row">`
      + `<span class="k">${iconOf ? iconOf(k, '13px') : ''}${label}</span>`
      + `<span class="tts-track"><span class="tts-fill" style="width:${pct.toFixed(1)}%;--c:${STAT_COLOR[k]}"></span></span>`
      + `<span class="v">${esc(shown)}</span></div>`;
  });
  return rows.length ? `<div class="tts-bars">${rows.join('')}</div>` : '';
}

/* ⚔ THE MOVESET. Rows are BUTTONS carrying the caller's `data-move` id, because
   this is the one part of the sheet you act through rather than read. Three
   things arrive decided and are never re-derived here:
     · `cost` is the EFFECTIVE cost after reductions, with `costWas` set only
       when a passive actually discounted it — the old modal printed the raw
       cost on the very button that spent the reduced one, which is
       indistinguishable from the passive being broken.
     · `disabled` folds together energy, turn, priority-slot and dispel.
     · `selected` mirrors the board's move ring.
   `note` replaces the whole list for a face-down or un-scanned enemy: that is a
   deliberate absence and has to say so, or it reads as a unit with no attacks. */
function movesPanel(moves, note, cap) {
  if (!moves && !note) return '';
  /* 📐 THE MOVE-SLOT LAW, stated on the sheet. The cap is passed in from the
     engine's own MAX_KNOWN_MOVES rather than typed here, so if that constant
     ever becomes hero-aware this counter follows it with no edit. Rendered only
     when there is a real list to count. */
  const slots = (cap > 0 && moves) ? `<span class="tts-slots">${moves.length}/${cap | 0}</span>` : '';
  const body = note
    ? `<div class="tts-move-note">${note}</div>`
    : `<div class="tts-moves-b">${(moves || []).map(m => {
        const cls = ['tts-move', m.selected ? 'sel' : '', m.priority ? 'prio' : ''].filter(Boolean).join(' ');
        const meta = [
          m.range != null ? 'range ' + (m.range | 0) : '',
          m.kind || '', m.priority ? 'Priority' : '', m.meta || '',
        ].filter(Boolean).join(' · ');
        return `<button class="${cls}" data-move="${esc(m.id)}"${m.disabled ? ' disabled' : ''}`
          + (m.title ? ` title="${esc(m.title)}"` : '') + `>`
          + `<span class="tts-move-h">`
          +   `<span class="tts-move-nm">${m.priority ? '⚡ ' : ''}${m.dotHtml || ''}${esc(m.name)}</span>`
          +   `<span class="tts-move-cost">`
          +     (m.costWas != null ? `<s>${m.costWas | 0}</s>` : '')
          +     `${m.cost | 0}<span class="tts-orb"></span></span>`
          + `</span>`
          + (meta ? `<span class="tts-move-meta">${esc(meta)}</span>` : '')
          + (m.desc ? `<span class="tts-move-desc">${esc(m.desc)}</span>` : '')
          + `</button>`;
      }).join('')}</div>`;
  return `<div class="tts-moves">`
    + `<div class="tts-moves-h">⚔ Moves &amp; Attacks<span class="ln"></span>${slots}</div>`
    + body + `</div>`;
}

/* ── the sheet ─────────────────────────────────────────────────────────────*/
export function renderSheet(ctx) {
  const c = ctx || {};
  const stats = c.stats || null;
  const iconOf = typeof c.statIcon === 'function' ? c.statIcon : null;

  /* PORTRAIT. `artHtml` wins when the caller has real art; otherwise a glyph at
     plate size. Never an <img> with an empty src — that paints a broken-image
     icon in the middle of the sheet, which looks like a crash rather than like
     a card without art. */
  const art = c.artUrl
    ? `<img class="tts-art" src="${esc(c.artUrl)}" alt="${esc(c.name || '')}" draggable="false">`
    : (c.artHtml || `<div class="tts-art-fallback">${c.glyph || '🂠'}</div>`);

  /* COST. An Underdog card shows 0 with the original struck through beside it —
     the modal and the hand strip must never quote different prices. */
  /* `costText` overrides the number outright. The field variant uses it to put
     LEVEL in the hex (a unit already on the board cannot be paid for again) and
     to show "?" for a face-down card, neither of which is an integer. */
  const costTxt = c.costText != null ? String(c.costText)
                : c.costFree ? '0' : String(c.cost | 0);
  const wasCost = (c.costFree && (c.costOriginal | 0) !== 0)
    ? `<span class="tts-wascost">${c.costOriginal | 0}</span>` : '';

  const bond = c.bond ? `
      <div class="tts-pip">
        <div class="tts-hex bond">${esc(c.bond.icon || '❤')}</div>
        <div class="tts-slot">Bond${c.bond.label ? `<b>${esc(c.bond.label)}</b>` : ''}</div>
      </div>` : '';

  const chips = []
    .concat((c.elements || []).map(e => `<span class="tts-chip">${e.iconHtml || ''}${esc(e.name)}</span>`))
    .concat(c.faction ? [`<span class="tts-chip faction">${c.faction.iconHtml || ''}${esc(c.faction.name)}</span>`] : []);

  const passives = (c.passives || []).length ? `
      <div class="tts-h">✦ Passive Abilities<span class="ln"></span></div>
      ${(c.passives || []).map(p => `<div class="tts-box">`
        + `<div class="nm">${esc(p.name)}</div>`
        + (p.desc ? `<div class="bd">${esc(p.desc)}</div>` : '')
        + `</div>`).join('')}` : '';

  /* Long-tail blocks. Each is {title, html} and the html is trusted because it
     was built by index.html from data it already escaped. A title-less entry
     renders bare, which is how the city-work panel keeps its own header. */
  const blocks = (c.blocks || []).filter(b => b && b.html).map(b => (b.title
    ? `<div class="tts-h">${esc(b.title)}<span class="ln"></span></div>${b.html}`
    : b.html)).join('');

  const empty = !c.flavor && !passives && !blocks;

  const acts = (c.actions || []).map(a => `<button class="tts-btn ${esc(a.kind || '')}"`
    + ` id="${esc(a.id)}"${a.disabled ? ' disabled' : ''}`
    + (a.title ? ` title="${esc(a.title)}"` : '')
    + `>${esc(a.label)}</button>`).join('');

  return `
<div class="tts-backdrop" id="${esc(c.backdropId || 'tts-backdrop')}" style="z-index:${c.z | 0 || 1450}">
  <div class="tts">
    <span class="tts-greeble tl"></span><span class="tts-greeble tr"></span>
    <span class="tts-greeble bl"></span><span class="tts-greeble br"></span>
    <span class="tts-stitch"></span>

    <div class="tts-left">
      <div class="tts-stage">
        <div class="tts-pips">
          <div class="tts-pip">
            <div class="tts-hex">${esc(costTxt)}</div>
            <div class="tts-slot">${esc(c.costLabel || 'Cost')}${wasCost}</div>
          </div>
          ${bond}
        </div>
        ${art}
      </div>
      ${movesPanel(c.moves, c.movesNote, c.movesCap)}
      <div class="tts-bar">${chips.length
        ? `<span class="tts-chips">${chips.join('')}</span>`
        : esc(c.name || '')}</div>
    </div>

    <div class="tts-right">
      <div class="tts-head">
        ${c.heraldUrl ? `<img class="tts-herald" src="${esc(c.heraldUrl)}" alt="" aria-hidden="true" draggable="false">` : ''}
        <div class="tts-bar slim">${esc(c.title || c.name || '')}</div>
        <button class="tts-close" id="${esc(c.closeId || 'tts-close')}" aria-label="Close">×</button>
      </div>
      <div class="tts-read">
        ${c.flavor ? `<div class="tts-flavor">${esc(c.flavor)}</div>` : ''}
        ${passives}
        ${blocks}
        ${empty ? `<div class="tts-note">No card effect.</div>` : ''}
        ${c.note ? `<div class="tts-note${c.noteWarn ? ' warn' : ''}">${c.noteHtml ? c.note : esc(c.note)}</div>` : ''}
        <div class="tts-dots"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      ${stats ? statCells(stats, iconOf) : ''}
      ${stats ? statBars(stats, iconOf, c) : ''}
      <div class="tts-bar"><span class="tts-acts">${acts}</span></div>
    </div>
  </div>
</div>`;
}

/* The seam. index.html cannot `import` (it is not a module), so the bridge is a
   window global — the same shape hud.js uses. */
try {
  window.MythicCardSheet = { render: renderSheet, version: 'tts-1' };
} catch (e) {}
