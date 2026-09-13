/* ════════════════════════════════════════════════════════════════════════════
   ⛓ THE RESPONSE PROMPT — "in response to that, I activate…"
   ----------------------------------------------------------------------------
   One modal, one job: show the chain as it stands, offer the cards that may
   legally answer the top link, and resolve to either a chosen card or a pass.

   🔴 IT MUST NEVER HANG THE BATTLE. A response window sits in the middle of a
   turn with the board mid-mutation; a prompt that can be dismissed into nothing
   would strand the match. So EVERY exit route lands on the same idempotent
   `finish()` — button, timer, Escape, backdrop click, an exception inside the
   renderer. The returned promise always resolves and never rejects. This is the
   same rule FEBattle's cut-away follows (src/battle/combat.js) and for the same
   reason.

   ⏳ THE TIMER IS NOT PRESSURE, IT IS A DEADLOCK GUARD. Sitting on a response
   window forever is a legal way to stall a multiplayer match, and an unattended
   tab is an accidental one. It defaults generously and is skippable by just
   answering. Auto-pass on expiry is the safe default: passing never costs you a
   card, it only costs you the chance.

   ♿ Reduced motion is honoured, the modal is focus-trapped and Escape passes.
   ════════════════════════════════════════════════════════════════════════════ */

import { bx, esc } from './chain.bridge.js';
import { speedLabel, topSpeedOf } from './chain.engine.js';

const STYLE_ID = 'mchain-style';
const ROOT_ID = 'mchain-root';

export const DEFAULT_WINDOW_MS = 20000;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #${ROOT_ID}{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center;
    background:rgba(4,6,12,.72);backdrop-filter:blur(3px);padding:16px;}
  .mchain-box{width:min(560px,100%);max-height:min(86vh,720px);display:flex;flex-direction:column;
    background:linear-gradient(180deg,#12141f,#0a0c14);border:2px solid #6a5a8a;border-radius:12px;
    box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 0 1px rgba(180,150,255,.14) inset;overflow:hidden;}
  .mchain-head{padding:12px 18px;background:linear-gradient(90deg,rgba(150,110,255,.20),transparent);
    border-bottom:1px solid rgba(150,110,255,.3);}
  .mchain-title{font-family:'Cinzel',serif;font-size:1.12rem;color:#e6d8ff;letter-spacing:.07em;}
  .mchain-sub{font-size:.8rem;color:#9aa0b5;margin-top:2px;}
  .mchain-timer{height:3px;background:rgba(150,110,255,.15);}
  .mchain-timer > i{display:block;height:100%;background:linear-gradient(90deg,#b58cff,#7f6ad6);
    width:100%;transform-origin:left center;}
  .mchain-body{padding:12px 18px;overflow:auto;}
  .mchain-stack{margin:0 0 12px;padding:0;list-style:none;border-left:2px solid rgba(150,110,255,.35);}
  .mchain-stack li{position:relative;padding:5px 0 5px 14px;font-size:.85rem;color:#c8cee0;}
  .mchain-stack li::before{content:'';position:absolute;left:-5px;top:12px;width:8px;height:8px;
    border-radius:50%;background:#7f6ad6;box-shadow:0 0 0 3px rgba(127,106,214,.2);}
  .mchain-stack li.top{color:#f0e6d2;font-weight:600;}
  .mchain-stack li.top::before{background:#ffd166;box-shadow:0 0 0 3px rgba(255,209,102,.22);}
  .mchain-lnum{font-family:'Cinzel',serif;color:#8b7fb8;margin-right:6px;}
  .mchain-opts{display:flex;flex-direction:column;gap:7px;}
  .mchain-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;cursor:pointer;
    padding:9px 12px;border-radius:8px;color:#e8ecf6;font:inherit;font-size:.88rem;
    background:rgba(22,26,40,.9);border:1px solid rgba(150,110,255,.28);}
  .mchain-opt:hover,.mchain-opt:focus-visible{background:rgba(40,32,64,.95);border-color:#b58cff;outline:none;}
  .mchain-opt .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .mchain-spd{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;
    border-radius:999px;border:1px solid currentColor;flex:none;}
  .mchain-spd.s2{color:#7fd6ff;} .mchain-spd.s3{color:#ff9ecb;} .mchain-spd.s1{color:#9aa0b5;}
  .mchain-src{font-size:.68rem;color:#8b93a8;flex:none;}
  .mchain-foot{padding:11px 18px;border-top:1px solid rgba(150,110,255,.25);display:flex;
    gap:10px;align-items:center;justify-content:space-between;}
  .mchain-pass{padding:8px 20px;border-radius:8px;cursor:pointer;font:inherit;font-size:.86rem;
    background:rgba(30,34,48,.9);border:1px solid rgba(160,170,200,.35);color:#cdd4e4;}
  .mchain-pass:hover{border-color:#cdd4e4;}
  .mchain-count{font-size:.76rem;color:#8b93a8;}
  .mchain-empty{padding:14px 4px;font-size:.85rem;color:#8b93a8;text-align:center;}
  @media (prefers-reduced-motion: reduce){ .mchain-timer > i{transition:none !important;} }
  @media (max-width:430px){ .mchain-box{max-height:92vh;} .mchain-head{padding:10px 13px;} .mchain-body{padding:10px 13px;} .mchain-foot{padding:10px 13px;} }
  `;
  document.head.appendChild(s);
}

function teardown() {
  try { const n = document.getElementById(ROOT_ID); if (n) n.remove(); } catch (e) {}
}

function stackHtml(chain) {
  if (!chain.links.length) {
    return `<div class="mchain-empty">No links yet — you are responding to the event itself.</div>`;
  }
  return `<ul class="mchain-stack">` + chain.links.map((l, i) => {
    const top = i === chain.links.length - 1;
    const who = l.side === 'player' ? 'You' : 'Opponent';
    return `<li class="${top ? 'top' : ''}"><span class="mchain-lnum">L${i + 1}</span>${esc(who)} · ${esc(l.label)}</li>`;
  }).join('') + `</ul>`;
}

/* Show the prompt. Resolves to the chosen option object, or null for a pass.
   `opts.timeoutMs <= 0` disables the deadline entirely (used by the practice
   modes, never by multiplayer). */
export function prompt(chain, options, opts) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const b = bx();

    // 🔴 The one exit. Every route below calls exactly this.
    const finish = (val) => {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { document.removeEventListener('keydown', onKey, true); } catch (e) {}
      teardown();
      resolve(val || null);
    };

    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); finish(null); }
    };

    try {
      ensureStyle();
      teardown();

      const ms = (opts && typeof opts.timeoutMs === 'number') ? opts.timeoutMs : DEFAULT_WINDOW_MS;
      const trig = (opts && opts.triggerLabel) || 'that';
      const top = topSpeedOf(chain);
      const rule = top >= 3
        ? 'Only a Counter effect can answer a Counter.'
        : top === 2 ? 'Quick and Counter effects may respond.'
        : 'Quick and Counter effects may respond. Normal effects cannot.';

      const root = document.createElement('div');
      root.id = ROOT_ID;
      root.innerHTML = `
        <div class="mchain-box" role="dialog" aria-modal="true" aria-label="Respond to effect">
          <div class="mchain-head">
            <div class="mchain-title">⛓ RESPOND?</div>
            <div class="mchain-sub">In response to ${esc(trig)} — ${esc(rule)}</div>
          </div>
          <div class="mchain-timer"><i id="mchain-bar"></i></div>
          <div class="mchain-body">
            ${stackHtml(chain)}
            <div class="mchain-opts">
              ${options.map((o, i) => `
                <button class="mchain-opt" data-mchain-pick="${i}">
                  <span class="mchain-spd s${o.speed}">${esc(speedLabel(o.speed))}</span>
                  <span class="nm">${esc(o.label)}</span>
                  <span class="mchain-src">${esc(o.source)}</span>
                </button>`).join('')}
            </div>
          </div>
          <div class="mchain-foot">
            <span class="mchain-count">Chain length ${chain.links.length}</span>
            <button class="mchain-pass" data-mchain-pass="1">Pass</button>
          </div>
        </div>`;

      document.body.appendChild(root);

      root.addEventListener('click', (ev) => {
        const pick = ev.target && ev.target.closest && ev.target.closest('[data-mchain-pick]');
        if (pick) { try { b.sfx('chainLink'); } catch (e) {} finish(options[parseInt(pick.dataset.mchainPick, 10)]); return; }
        if (ev.target && ev.target.closest && ev.target.closest('[data-mchain-pass]')) { finish(null); return; }
        if (ev.target === root) finish(null);          // backdrop
      });

      document.addEventListener('keydown', onKey, true);

      // Focus the first option so a keyboard player can answer without a mouse.
      try { const f = root.querySelector('.mchain-opt'); if (f) f.focus(); } catch (e) {}

      if (ms > 0) {
        // The bar is a pure transform animation on one node — no RAF loop. The
        // Browser pane composites at ~0.56Hz (CLAUDE.md) so a JS-driven bar
        // would stutter badly; a single CSS transition is handled off-thread.
        try {
          const bar = root.querySelector('#mchain-bar');
          const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (bar && !reduce) {
            bar.style.transition = `transform ${ms}ms linear`;
            // Force a style flush so the transition actually starts from 1.
            void bar.offsetWidth;
            bar.style.transform = 'scaleX(0)';
          }
        } catch (e) {}
        timer = setTimeout(() => finish(null), ms);    // auto-PASS, never auto-play
      }
    } catch (e) {
      // A renderer failure must not strand the battle — pass and carry on.
      try { console.warn('[chain] prompt failed, auto-passing', e); } catch (e2) {}
      finish(null);
    }
  });
}

/* A short non-blocking banner announcing how the chain resolved. Purely
   informational; the authoritative record goes to the battle log. */
export function flashResolution(lines) {
  try {
    const b = bx();
    if (!lines || !lines.length) return;
    b.toast('⛓ ' + lines.join('  ·  '), Math.min(9000, 2600 + lines.length * 900));
  } catch (e) {}
}
