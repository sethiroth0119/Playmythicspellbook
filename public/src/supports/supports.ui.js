/* ════════════════════════════════════════════════════════════════════════════
   💬 SUPPORT SCENES — the conversation view and the pair roster.
   ----------------------------------------------------------------------------
   The scene plays line by line: tap (or wait) to advance. It is the only place
   in the game where two heroes address each other, so it is worth the beat of
   pacing — dumping the whole exchange at once reads as a changelog.

   ♿ Reduced motion skips the typing reveal entirely and prints each line whole.
   ⚠ Advance is idempotent and the whole scene is skippable; a player who has
   read it once must never be trapped in it.
   ════════════════════════════════════════════════════════════════════════════ */

const STYLE_ID = 'msup-style';
const ROOT_ID = 'msup-root';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function reduced() {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #${ROOT_ID}{position:fixed;inset:0;z-index:1470;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse at center,rgba(20,10,28,.62),rgba(3,2,8,.94));backdrop-filter:blur(4px);padding:16px;}
  .msup-box{width:min(620px,100%);max-height:90vh;display:flex;flex-direction:column;
    background:linear-gradient(180deg,#1a1420,#0c0910);border:2px solid #8a5a7a;border-radius:14px;
    box-shadow:0 24px 70px rgba(0,0,0,.75),0 0 70px rgba(255,158,203,.08);overflow:hidden;}
  .msup-head{padding:13px 20px;background:linear-gradient(90deg,rgba(255,158,203,.16),transparent);
    border-bottom:1px solid rgba(255,158,203,.26);}
  .msup-rank{font-family:'Cinzel',serif;font-size:1.15rem;color:#ffc8e0;letter-spacing:.08em;}
  .msup-scene{font-size:.82rem;color:#b8a0b8;font-style:italic;margin-top:3px;}
  .msup-body{padding:16px 20px;overflow:auto;flex:1;min-height:140px;}
  .msup-line{margin-bottom:13px;opacity:0;animation:msupIn .34s ease-out forwards;}
  @keyframes msupIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .msup-who{font-family:'Cinzel',serif;font-size:.82rem;letter-spacing:.07em;color:#ffc8e0;margin-bottom:2px;}
  .msup-text{font-size:.95rem;line-height:1.6;color:#e8e0ea;}
  .msup-foot{padding:12px 20px;border-top:1px solid rgba(255,158,203,.24);display:flex;
    justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
  .msup-hint{font-size:.76rem;color:#9a8a9a;}
  .msup-btn{padding:8px 20px;border-radius:8px;cursor:pointer;font:inherit;font-size:.86rem;
    background:rgba(40,28,44,.9);border:1px solid rgba(255,158,203,.36);color:#f0d8e6;}
  .msup-btn:hover{border-color:#ffc8e0;}
  .msup-btn.pri{background:linear-gradient(180deg,#9a4a78,#6a2f52);border-color:#ffc8e0;color:#fff;font-weight:600;}
  .msup-bonus{margin-top:10px;padding:9px 12px;border-radius:8px;font-size:.82rem;
    background:rgba(255,209,102,.09);border:1px solid rgba(255,209,102,.3);color:#ffe0a0;}

  /* roster */
  .msup-rrow{display:flex;align-items:center;gap:10px;padding:9px 11px;margin-bottom:5px;border-radius:8px;
    background:rgba(26,20,30,.85);border:1px solid rgba(255,158,203,.14);font-size:.85rem;color:#e8dce8;}
  .msup-rrow .who{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .msup-rk{font-family:'Cinzel',serif;font-weight:700;flex:none;width:34px;text-align:center;}
  .msup-bar{flex:none;width:84px;height:5px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden;}
  .msup-bar > i{display:block;height:100%;background:linear-gradient(90deg,#ff9ecb,#ffd166);}
  .msup-go{flex:none;padding:4px 12px;border-radius:999px;cursor:pointer;font:inherit;font-size:.76rem;
    background:#9a4a78;border:1px solid #ffc8e0;color:#fff;}
  .msup-empty{padding:22px 8px;text-align:center;font-size:.85rem;color:#9a8a9a;line-height:1.6;}
  @media (max-width:460px){ .msup-box{max-height:95vh;} .msup-bar{display:none;} }
  `;
  document.head.appendChild(s);
}

function close() { try { const n = document.getElementById(ROOT_ID); if (n) n.remove(); } catch (e) {} }

/* Play a generated conversation. Always resolves — see the chain UI's note on
   why a modal in a game flow may never be able to strand the caller. */
export function playScene(convo, a, b, rank) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { document.removeEventListener('keydown', onKey, true); } catch (e) {}
      close();
      resolve(true);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); finish(); }
      else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); step(); }
    };

    let shown = 0;
    const lines = (convo && convo.lines) || [];
    const all = reduced();

    function step() {
      if (done) return;
      if (shown >= lines.length) { finish(); return; }
      shown = all ? lines.length : shown + 1;
      render();
    }

    function render() {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      const complete = shown >= lines.length;
      const bonus = rank && rank.bonus;
      root.innerHTML = `
        <div class="msup-box" role="dialog" aria-modal="true" aria-label="Support conversation">
          <div class="msup-head">
            <div class="msup-rank">${esc(rank ? rank.icon : '💬')} SUPPORT ${esc(rank ? rank.key : '')} — ${esc(a.name)} &amp; ${esc(b.name)}</div>
            ${convo && convo.scene ? `<div class="msup-scene">${esc(convo.scene)}</div>` : ''}
          </div>
          <div class="msup-body">
            ${lines.slice(0, shown).map(l => `
              <div class="msup-line">
                <div class="msup-who">${esc(l.name)}</div>
                <div class="msup-text">${esc(l.text)}</div>
              </div>`).join('')}
            ${complete && bonus ? `<div class="msup-bonus">${esc(rank.icon)} <b>Support ${esc(rank.key)}</b> — when these two fight adjacent: ${
              Object.keys(bonus).filter(k => k !== 'rank').map(k => `+${bonus[k]} ${k}`).join(' · ')}</div>` : ''}
          </div>
          <div class="msup-foot">
            <span class="msup-hint">${complete ? '' : 'Tap, Space or Enter to continue'}</span>
            <button class="msup-btn ${complete ? 'pri' : ''}" data-msup-next="1">${complete ? 'Done' : 'Continue'}</button>
          </div>
        </div>`;
    }

    try {
      ensureStyle(); close();
      const root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
      shown = all ? lines.length : 1;
      render();
      root.addEventListener('click', (ev) => {
        if (ev.target === root) { finish(); return; }
        step();
      });
      document.addEventListener('keydown', onKey, true);
    } catch (e) {
      try { console.warn('[supports] scene render failed', e); } catch (e2) {}
      finish();
    }
  });
}

/* The pair roster — every relationship, what it gives, what is waiting. */
export function openRoster(rows, playFn) {
  ensureStyle(); close();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);

  function render() {
    const waiting = rows.filter(r => r.ready).length;
    root.innerHTML = `
      <div class="msup-box" role="dialog" aria-modal="true" aria-label="Supports">
        <div class="msup-head">
          <div class="msup-rank">💬 SUPPORTS</div>
          <div class="msup-scene">${waiting ? waiting + ' conversation' + (waiting === 1 ? '' : 's') + ' waiting' : 'Fight together to build these.'}</div>
        </div>
        <div class="msup-body">
          ${rows.length ? rows.map(r => {
            const pct = r.nextAt ? Math.max(0, Math.min(100, Math.round((r.points / r.nextAt) * 100))) : 100;
            return `<div class="msup-rrow">
              <span class="msup-rk" style="color:${r.color}">${esc(r.icon)}${esc(r.unlocked === 'none' ? '–' : r.unlocked)}</span>
              <span class="who">${esc(r.aName)} &amp; ${esc(r.bName)}</span>
              <span class="msup-bar"><i style="width:${pct}%"></i></span>
              ${r.ready
                ? `<button class="msup-go" data-msup-play="${esc(r.a)}|${esc(r.b)}">Talk (${esc(r.ready)})</button>`
                : `<span class="msup-hint">${r.toNext ? r.toNext + ' to ' + (r.earned === 'none' ? 'C' : 'next') : 'maxed'}</span>`}
            </div>`;
          }).join('') : `<div class="msup-empty">No supports yet.<br>Deploy two heroes in the same battle and keep them close.</div>`}
        </div>
        <div class="msup-foot">
          <span class="msup-hint">Adjacent pairs gain their rank's bonus in battle.</span>
          <button class="msup-btn" data-msup-close="1">Close</button>
        </div>
      </div>`;
  }
  render();

  root.addEventListener('click', async (ev) => {
    if (ev.target === root) { close(); return; }
    const t = ev.target.closest && ev.target.closest('[data-msup-play]');
    if (t) {
      const [a, b] = t.dataset.msupPlay.split('|');
      close();
      try { await playFn(a, b); } catch (e) {}
      return;
    }
    if (ev.target.closest && ev.target.closest('[data-msup-close]')) close();
  });
}
