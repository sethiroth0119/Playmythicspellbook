/* ════════════════════════════════════════════════════════════════════════════
   🛏 THE REST PANEL — two options, and the honest price of each.
   ----------------------------------------------------------------------------
   The whole design goal is one sentence on screen: "you cannot afford this
   tonight". So the cost is shown as have/need per resource, in red when short,
   BEFORE the button is pressed — never as a toast after a refusal.

   ⚠ A blocked option is still rendered, with its reason. Hiding the long rest
   when food is low is how a player ends up not knowing the feature exists.
   ════════════════════════════════════════════════════════════════════════════ */

const STYLE_ID = 'mrest-style';
const ROOT_ID = 'mrest-root';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const RES_ICON = { food: '🥫', supplies: '📦', water: '💧', medicine: '💊', fuel: '⛽', ammo: '🔫', metal: '⛓' };

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #${ROOT_ID}{position:fixed;inset:0;z-index:1450;display:flex;align-items:center;justify-content:center;
    background:rgba(4,6,12,.78);backdrop-filter:blur(3px);padding:16px;}
  .mrest-box{width:min(600px,100%);max-height:90vh;display:flex;flex-direction:column;
    background:linear-gradient(180deg,#0e1420,#080b12);border:2px solid #4a6a8a;border-radius:13px;
    box-shadow:0 24px 70px rgba(0,0,0,.72);overflow:hidden;}
  .mrest-head{padding:13px 20px;background:linear-gradient(90deg,rgba(120,170,255,.16),transparent);
    border-bottom:1px solid rgba(120,170,255,.26);display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .mrest-title{font-family:'Cinzel',serif;font-size:1.12rem;color:#cfe0ff;letter-spacing:.08em;flex:1;min-width:140px;}
  .mrest-charges{font-size:.8rem;color:#8fb6e0;}
  .mrest-body{padding:14px 20px;overflow:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;}
  .mrest-opt{border-radius:11px;padding:13px 15px;border:1px solid rgba(120,170,255,.22);
    background:rgba(16,22,34,.82);}
  .mrest-opt.blocked{opacity:.72;border-color:rgba(255,120,120,.26);}
  .mrest-otop{display:flex;align-items:baseline;gap:9px;margin-bottom:5px;flex-wrap:wrap;}
  .mrest-oname{font-family:'Cinzel',serif;font-size:1rem;color:#e8f0ff;letter-spacing:.05em;}
  .mrest-odur{font-size:.76rem;color:#8fb6e0;}
  .mrest-oblurb{font-size:.85rem;color:#b8c4d8;line-height:1.5;margin-bottom:9px;}
  .mrest-gains{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;}
  .mrest-gain{font-size:.75rem;padding:3px 9px;border-radius:999px;
    background:rgba(140,224,168,.1);border:1px solid rgba(140,224,168,.3);color:#a8e8c0;}
  .mrest-cost{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-bottom:11px;}
  .mrest-c{font-size:.8rem;padding:4px 10px;border-radius:7px;
    background:rgba(255,209,102,.08);border:1px solid rgba(255,209,102,.28);color:#ffd98a;}
  .mrest-c.short{background:rgba(255,110,110,.1);border-color:rgba(255,110,110,.4);color:#ff9e9e;}
  .mrest-c.free{background:rgba(140,224,168,.08);border-color:rgba(140,224,168,.28);color:#a8e8c0;}
  .mrest-why{font-size:.8rem;color:#ff9e9e;margin-bottom:9px;}
  .mrest-btn{width:100%;padding:10px;border-radius:9px;cursor:pointer;font:inherit;font-size:.9rem;
    background:linear-gradient(180deg,#2c6ea8,#1d4d78);border:1px solid #5fa0d8;color:#eaf4ff;font-weight:600;}
  .mrest-btn:hover{filter:brightness(1.12);}
  .mrest-btn[disabled]{opacity:.4;cursor:not-allowed;filter:none;}
  .mrest-foot{padding:11px 20px;border-top:1px solid rgba(120,170,255,.22);text-align:right;}
  .mrest-close{padding:8px 18px;border-radius:8px;cursor:pointer;font:inherit;font-size:.85rem;
    background:rgba(30,38,54,.9);border:1px solid rgba(140,170,210,.34);color:#cfe0f4;}
  @media (max-width:460px){ .mrest-box{max-height:95vh;} }
  `;
  document.head.appendChild(s);
}

function close() { try { const n = document.getElementById(ROOT_ID); if (n) n.remove(); } catch (e) {} }

function gainChips(spec) {
  const out = [];
  if (spec.energyPct >= 1) out.push('Full stamina');
  else if (spec.energyPct > 0) out.push(`+${Math.round(spec.energyPct * 100)}% stamina`);
  if (spec.healPct >= 1) out.push('Fully healed');
  else if (spec.healPct > 0) out.push(`+${Math.round(spec.healPct * 100)}% of missing HP`);
  if (spec.fatigueClear >= 1) out.push('Fatigue cleared');
  else if (spec.fatigueClear > 0) out.push(`−${Math.round(spec.fatigueClear * 100)}% fatigue`);
  if (spec.refillsShortCharges) out.push('Short rests restored');
  if (spec.rollsDream) out.push('🌙 Dream');
  if (spec.supportScene) out.push('💬 Support scene');
  if (spec.bondGain) out.push(`+${spec.bondGain} bond`);
  return out;
}

export function openRestPanel({ quote, take }) {
  ensureStyle(); close();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);
  let busy = false;

  function render() {
    const qs = ['short', 'long'].map(m => quote(m));
    const charges = qs[0];
    root.innerHTML = `
      <div class="mrest-box" role="dialog" aria-modal="true" aria-label="Rest">
        <div class="mrest-head">
          <div class="mrest-title">🛏 REST</div>
          <div class="mrest-charges">🔥 ${charges.charges}/${charges.maxCharges} short rests · ${charges.resting} in camp</div>
        </div>
        <div class="mrest-body">
          ${qs.map(q => {
            const spec = q.spec;
            const costKeys = Object.keys(q.cost);
            return `
            <div class="mrest-opt ${q.canRest ? '' : 'blocked'}">
              <div class="mrest-otop">
                <span class="mrest-oname">${esc(spec.icon)} ${esc(spec.name)}</span>
                <span class="mrest-odur">${spec.durationH}h</span>
              </div>
              <div class="mrest-oblurb">${esc(spec.blurb)}</div>
              <div class="mrest-gains">${gainChips(spec).map(g => `<span class="mrest-gain">${esc(g)}</span>`).join('')}</div>
              <div class="mrest-cost">
                ${costKeys.length
                  ? costKeys.map(k => {
                      const lack = (q.have[k] | 0) < q.cost[k];
                      return `<span class="mrest-c ${lack ? 'short' : ''}">${RES_ICON[k] || '•'} ${q.cost[k]} ${esc(k)} <span style="opacity:.65">(${q.have[k] | 0})</span></span>`;
                    }).join('')
                  : `<span class="mrest-c free">No resources — costs 1 of ${q.maxCharges} short rests</span>`}
              </div>
              ${q.canRest ? '' : `<div class="mrest-why">⚠ ${esc(q.blocked)}</div>`}
              <button class="mrest-btn" data-mrest-take="${spec.id}" ${q.canRest && !busy ? '' : 'disabled'}>
                ${busy ? 'Resting…' : esc(spec.name)}
              </button>
            </div>`;
          }).join('')}
        </div>
        <div class="mrest-foot"><button class="mrest-close" data-mrest-close="1">Close</button></div>
      </div>`;
  }
  render();

  root.addEventListener('click', async (ev) => {
    if (ev.target === root) { close(); return; }
    if (ev.target.closest && ev.target.closest('[data-mrest-close]')) { close(); return; }
    const t = ev.target.closest && ev.target.closest('[data-mrest-take]');
    if (!t || busy) return;
    busy = true; render();
    let res = null;
    try { res = await take(t.dataset.mrestTake); } catch (e) {}
    busy = false;
    // A successful rest closes the panel — the dream and the support scene need
    // the screen, and leaving a stale panel behind them is the bug that made
    // the camp feel like two UIs fighting.
    if (res && res.ok) close(); else render();
  });
}
