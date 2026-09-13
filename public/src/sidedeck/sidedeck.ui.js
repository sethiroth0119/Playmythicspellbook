/* ════════════════════════════════════════════════════════════════════════════
   🔀 THE SIDING SCREEN — between game 1 and game 2.
   ----------------------------------------------------------------------------
   Two columns: MAIN on the left, SIDE on the right, click a card to move it.
   A running legality strip at the bottom says exactly why the Confirm button is
   disabled, because "Confirm (disabled)" with no reason is the single most
   infuriating thing a deck editor can do.

   ⚠ It shows what the opponent PLAYED last game, above the columns. Siding
   blind is not a decision, it is a guess — the information is the mechanic.
   The list comes from the caller (the battle knows what it saw); this file
   just renders it.

   🔴 CANCEL MUST BE LOSSLESS. Every move builds a NEW deck object (sideboard.move
   never mutates), so Cancel is a pointer assignment back to the original. A
   mutating editor that "undoes" by replaying moves backwards gets this wrong
   the first time a move is refused halfway.
   ════════════════════════════════════════════════════════════════════════════ */

import { SIDE_MAX, inventory, sideOf, move, swapErrors } from './sideboard.js';
import { scoreLine } from './match.js';

const STYLE_ID = 'msd-style';
const ROOT_ID = 'msd-root';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #${ROOT_ID}{position:fixed;inset:0;z-index:1480;display:flex;align-items:center;justify-content:center;
    background:rgba(4,6,12,.8);backdrop-filter:blur(3px);padding:14px;}
  .msd-box{width:min(860px,100%);max-height:92vh;display:flex;flex-direction:column;
    background:linear-gradient(180deg,#101520,#080b12);border:2px solid #4a6a8a;border-radius:12px;
    box-shadow:0 24px 70px rgba(0,0,0,.72);overflow:hidden;}
  .msd-head{padding:12px 18px;background:linear-gradient(90deg,rgba(90,160,255,.18),transparent);
    border-bottom:1px solid rgba(90,160,255,.28);display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
  .msd-title{font-family:'Cinzel',serif;font-size:1.1rem;color:#cfe4ff;letter-spacing:.07em;flex:1;min-width:160px;}
  .msd-score{font-size:.8rem;color:#8fb6e0;}
  .msd-seen{padding:9px 18px;border-bottom:1px solid rgba(90,160,255,.16);font-size:.78rem;color:#9aa8c0;}
  .msd-seen b{color:#cfe4ff;font-weight:600;}
  .msd-cols{display:flex;gap:12px;padding:12px 18px;overflow:auto;flex:1;min-height:0;}
  .msd-col{flex:1;min-width:0;display:flex;flex-direction:column;}
  .msd-colhead{font-size:.76rem;letter-spacing:.1em;text-transform:uppercase;color:#7f93b0;
    padding:0 2px 6px;display:flex;justify-content:space-between;}
  .msd-list{flex:1;overflow:auto;border:1px solid rgba(120,150,190,.2);border-radius:8px;
    background:rgba(12,16,26,.7);padding:5px;min-height:120px;}
  .msd-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;cursor:pointer;
    padding:6px 9px;margin-bottom:3px;border-radius:6px;font:inherit;font-size:.84rem;color:#dce6f5;
    background:rgba(24,30,44,.85);border:1px solid rgba(120,150,190,.18);}
  .msd-row:hover,.msd-row:focus-visible{border-color:#8fb6e0;background:rgba(36,46,66,.95);outline:none;}
  .msd-row .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .msd-row .c{flex:none;font-size:.75rem;color:#8fb6e0;}
  .msd-row .arrow{flex:none;opacity:.55;}
  .msd-empty{padding:18px 6px;text-align:center;font-size:.8rem;color:#6f7f96;}
  .msd-errs{padding:8px 18px;border-top:1px solid rgba(90,160,255,.2);min-height:20px;}
  .msd-err{font-size:.79rem;color:#ff9e9e;}
  .msd-okmsg{font-size:.79rem;color:#8fe0a8;}
  .msd-foot{padding:11px 18px;border-top:1px solid rgba(90,160,255,.24);display:flex;gap:9px;
    justify-content:flex-end;flex-wrap:wrap;}
  .msd-btn{padding:8px 18px;border-radius:8px;cursor:pointer;font:inherit;font-size:.85rem;
    background:rgba(30,38,54,.9);border:1px solid rgba(140,170,210,.36);color:#cfe0f4;}
  .msd-btn:hover{border-color:#cfe0f4;}
  .msd-btn.pri{background:linear-gradient(180deg,#2c6ea8,#1d4d78);border-color:#5fa0d8;color:#eaf4ff;font-weight:600;}
  .msd-btn[disabled]{opacity:.42;cursor:not-allowed;}
  .msd-first{display:flex;gap:7px;align-items:center;padding:9px 18px;
    border-top:1px solid rgba(90,160,255,.16);font-size:.8rem;color:#9aa8c0;flex-wrap:wrap;}
  .msd-first button{padding:5px 13px;border-radius:999px;cursor:pointer;font:inherit;font-size:.78rem;
    background:rgba(24,30,44,.9);border:1px solid rgba(140,170,210,.3);color:#cfe0f4;}
  .msd-first button[aria-pressed="true"]{background:#2c6ea8;border-color:#7fc0ff;color:#fff;}
  @media (max-width:560px){ .msd-cols{flex-direction:column;} .msd-box{max-height:96vh;} }
  `;
  document.head.appendChild(s);
}

/* Open the siding screen.
     deck      the deck as it stands (match.deckNow)
     ref       the deck at match start (match.deckAtStart) — the size reference
     match     for the score line and the first-player choice
     env       { nameOf, copyLimit, deckSize }  (see sideboard.legalityErrors)
     seen      [name…] cards the opponent showed last game
   Resolves to { deck, firstPlayer } on confirm, or null on cancel/skip. */
export function openSiding({ deck, ref, match, env, seen }) {
  return new Promise((resolve) => {
    let done = false;
    let working = { ...deck, cards: (deck.cards || []).slice(), side: sideOf(deck).slice() };
    let first = (match && match.firstPlayer) || 'player';
    // Only the side that LOST the previous game picks who starts.
    const mayChoose = !match || match.chooserSide === 'player';

    const finish = (val) => {
      if (done) return;
      done = true;
      try { document.removeEventListener('keydown', onKey, true); } catch (e) {}
      try { const n = document.getElementById(ROOT_ID); if (n) n.remove(); } catch (e) {}
      resolve(val || null);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finish(null); } };

    const nameOf = (env && env.nameOf) || (k => String(k));

    function rowsFor(where) {
      const inv = inventory(working)
        .filter(e => e[where] > 0)
        .sort((a, b) => nameOf(a.key).localeCompare(nameOf(b.key)));
      if (!inv.length) {
        return `<div class="msd-empty">${where === 'side'
          ? 'Side deck empty — move up to ' + SIDE_MAX + ' cards here.'
          : 'Main deck empty.'}</div>`;
      }
      const arrow = where === 'main' ? '→' : '←';
      return inv.map(e => `
        <button class="msd-row" data-msd-move="${esc(e.key)}" data-msd-dir="${where === 'main' ? 'toSide' : 'toMain'}">
          <span class="n">${esc(nameOf(e.key))}</span>
          <span class="c">×${e[where]}</span>
          <span class="arrow">${arrow}</span>
        </button>`).join('');
    }

    function render() {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      const errs = swapErrors(ref, working, env);
      const seenList = (seen && seen.length)
        ? seen.slice(0, 12).map(s => `<b>${esc(s)}</b>`).join(', ')
        : '<span style="opacity:.6">nothing recorded</span>';

      root.innerHTML = `
        <div class="msd-box" role="dialog" aria-modal="true" aria-label="Side deck">
          <div class="msd-head">
            <div class="msd-title">🔀 SIDE DECK</div>
            <div class="msd-score">${esc(scoreLine(match))}</div>
          </div>
          <div class="msd-seen">👁 They played: ${seenList}</div>
          <div class="msd-cols">
            <div class="msd-col">
              <div class="msd-colhead"><span>Main</span><span>${working.cards.length}${env && env.deckSize ? ' / ' + env.deckSize : ''}</span></div>
              <div class="msd-list">${rowsFor('main')}</div>
            </div>
            <div class="msd-col">
              <div class="msd-colhead"><span>Side</span><span>${sideOf(working).length} / ${SIDE_MAX}</span></div>
              <div class="msd-list">${rowsFor('side')}</div>
            </div>
          </div>
          ${mayChoose ? `
          <div class="msd-first">
            <span>You lost the last game — you choose who starts:</span>
            <button data-msd-first="player" aria-pressed="${first === 'player'}">I go first</button>
            <button data-msd-first="ai" aria-pressed="${first === 'ai'}">They go first</button>
          </div>` : ''}
          <div class="msd-errs">
            ${errs.length
              ? errs.map(e => `<div class="msd-err">⚠ ${esc(e)}</div>`).join('')
              : '<div class="msd-okmsg">✓ Legal — ready for the next game.</div>'}
          </div>
          <div class="msd-foot">
            <button class="msd-btn" data-msd-reset="1">Reset</button>
            <button class="msd-btn" data-msd-cancel="1">Skip siding</button>
            <button class="msd-btn pri" data-msd-ok="1" ${errs.length ? 'disabled' : ''}>Confirm</button>
          </div>
        </div>`;
    }

    try {
      ensureStyle();
      try { const old = document.getElementById(ROOT_ID); if (old) old.remove(); } catch (e) {}
      const root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
      render();

      root.addEventListener('click', (ev) => {
        const t = ev.target && ev.target.closest ? ev.target : null;
        if (!t) return;
        const mv = t.closest('[data-msd-move]');
        if (mv) { working = move(working, mv.dataset.msdMove, mv.dataset.msdDir); render(); return; }
        const fp = t.closest('[data-msd-first]');
        if (fp) { first = fp.dataset.msdFirst; render(); return; }
        if (t.closest('[data-msd-reset]')) {
          working = { ...ref, cards: (ref.cards || []).slice(), side: sideOf(ref).slice() };
          render(); return;
        }
        if (t.closest('[data-msd-cancel]')) { finish(null); return; }
        if (t.closest('[data-msd-ok]')) {
          // Re-validate at the moment of commit. The button's disabled state is
          // a hint, not a gate — a stale render must never let an illegal deck through.
          if (swapErrors(ref, working, env).length) { render(); return; }
          finish({ deck: working, firstPlayer: mayChoose ? first : (match && match.firstPlayer) || 'player' });
          return;
        }
        if (ev.target === root) finish(null);
      });
      document.addEventListener('keydown', onKey, true);
    } catch (e) {
      try { console.warn('[sidedeck] siding screen failed — skipping', e); } catch (e2) {}
      finish(null);
    }
  });
}
