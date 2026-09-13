/* ════════════════════════════════════════════════════════════════════════════
   🕯 THE WALL — the roster history, read.
   ----------------------------------------------------------------------------
   A list of names is a spreadsheet. What makes a memorial land is the RECORD:
   what they did, how long they served, who they were close to, and the one line
   that sums it up. So each row opens into a full service record.

   ⚠ Legacy rows (the survivor entries already on Profile.memorial) have none of
   that detail. They render as a name, a cause and a date — no empty stat boxes,
   no "0 kills" implying they never fought. Absent is absent, never zero.
   ════════════════════════════════════════════════════════════════════════════ */

const STYLE_ID = 'mmem-style';
const ROOT_ID = 'mmem-root';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function when(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (e) { return ''; }
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #${ROOT_ID}{position:fixed;inset:0;z-index:1465;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse at center,rgba(24,8,12,.66),rgba(2,1,4,.95));backdrop-filter:blur(4px);padding:16px;}
  .mmem-box{width:min(680px,100%);max-height:92vh;display:flex;flex-direction:column;
    background:linear-gradient(180deg,#150c10,#080508);border:2px solid #6a3a44;border-radius:13px;
    box-shadow:0 24px 70px rgba(0,0,0,.78);overflow:hidden;}
  .mmem-head{padding:14px 20px;background:linear-gradient(90deg,rgba(224,85,106,.16),transparent);
    border-bottom:1px solid rgba(224,85,106,.28);}
  .mmem-title{font-family:'Cinzel',serif;font-size:1.16rem;color:#f0b8c4;letter-spacing:.1em;}
  .mmem-sum{font-size:.79rem;color:#a87884;margin-top:4px;}
  .mmem-tabs{display:flex;gap:6px;padding:10px 20px 0;flex-wrap:wrap;}
  .mmem-tab{padding:5px 13px;border-radius:999px;cursor:pointer;font:inherit;font-size:.78rem;
    background:rgba(30,18,22,.9);border:1px solid rgba(224,85,106,.24);color:#e0b0b8;}
  .mmem-tab[aria-pressed="true"]{background:#6a2f3c;border-color:#f0b8c4;color:#fff;font-weight:600;}
  .mmem-body{padding:12px 20px;overflow:auto;flex:1;min-height:0;}
  .mmem-row{display:flex;align-items:center;gap:11px;width:100%;text-align:left;cursor:pointer;font:inherit;
    padding:9px 12px;margin-bottom:5px;border-radius:9px;color:#e8d0d4;font-size:.86rem;
    background:rgba(26,14,18,.85);border:1px solid rgba(224,85,106,.16);border-left:3px solid;}
  .mmem-row:hover,.mmem-row:focus-visible{background:rgba(40,20,26,.95);outline:none;}
  .mmem-ic{font-size:1.3rem;flex:none;}
  .mmem-nm{flex:1;min-width:0;}
  .mmem-nm b{display:block;color:#f0dce0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .mmem-nm span{font-size:.76rem;color:#a88490;}
  .mmem-kia{flex:none;font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.1em;color:#7a4550;}
  .mmem-empty{padding:34px 10px;text-align:center;font-size:.88rem;color:#8a6870;line-height:1.7;}
  /* detail */
  .mmem-det{padding:2px 0 6px;}
  .mmem-dtop{display:flex;align-items:center;gap:13px;margin-bottom:11px;}
  .mmem-dic{font-size:2.6rem;filter:grayscale(.35);}
  .mmem-dnm{font-family:'Cinzel',serif;font-size:1.3rem;color:#f0dce0;}
  .mmem-dcause{font-size:.82rem;margin-top:2px;}
  .mmem-epi{font-style:italic;font-size:.95rem;line-height:1.6;color:#d8c0c6;
    padding:11px 14px;margin-bottom:13px;border-radius:9px;border-left:3px solid #8a4a56;
    background:rgba(40,20,26,.6);}
  .mmem-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;margin-bottom:13px;}
  .mmem-st{padding:9px 6px;border-radius:8px;text-align:center;
    background:rgba(30,17,21,.8);border:1px solid rgba(224,85,106,.14);}
  .mmem-st b{display:block;font-family:'Cinzel',serif;font-size:1.2rem;color:#f0dce0;}
  .mmem-st span{font-size:.69rem;letter-spacing:.06em;text-transform:uppercase;color:#a07880;}
  .mmem-sect{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#a07880;margin:12px 0 6px;}
  .mmem-chips{display:flex;flex-wrap:wrap;gap:6px;}
  .mmem-chip{padding:4px 11px;border-radius:999px;font-size:.78rem;
    background:rgba(255,158,203,.09);border:1px solid rgba(255,158,203,.28);color:#f0c0d4;}
  .mmem-foot{padding:11px 20px;border-top:1px solid rgba(224,85,106,.24);display:flex;
    justify-content:space-between;gap:9px;flex-wrap:wrap;}
  .mmem-btn{padding:8px 18px;border-radius:8px;cursor:pointer;font:inherit;font-size:.85rem;
    background:rgba(36,20,25,.9);border:1px solid rgba(224,85,106,.34);color:#e8ccd2;}
  .mmem-btn:hover{border-color:#f0b8c4;}
  @media (max-width:460px){ .mmem-box{max-height:96vh;} }
  `;
  document.head.appendChild(s);
}

function close() { try { const n = document.getElementById(ROOT_ID); if (n) n.remove(); } catch (e) {} }

export function openWall(rows, stats, initialFilter) {
  ensureStyle(); close();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);

  let filter = initialFilter || 'all';
  let detail = null;

  const FILTERS = [
    { k: 'all',       label: 'All' },
    { k: 'hero',      label: 'Heroes' },
    { k: 'survivor',  label: 'Survivors' },
  ];

  function listHtml() {
    const shown = rows.filter(r => filter === 'all' || r.kind === filter);
    if (!shown.length) {
      return `<div class="mmem-empty">${rows.length
        ? 'Nobody here under that filter.'
        : 'The wall is empty.<br>Long may it stay that way.'}</div>`;
    }
    return shown.map(r => `
      <button class="mmem-row" data-mmem-open="${esc(r.id)}" style="border-left-color:${r.causeColor}">
        <span class="mmem-ic">${esc(r.icon)}</span>
        <span class="mmem-nm">
          <b>${esc(r.name)}</b>
          <span>${esc(r.causeIcon)} ${esc(r.cause)}${r.ts ? ' · ' + esc(when(r.ts)) : ''}${
            r.level != null ? ' · Lv ' + r.level : ''}</span>
        </span>
        <span class="mmem-kia">K.I.A.</span>
      </button>`).join('');
  }

  function detailHtml(r) {
    // ⚠ Every stat box is conditional — a legacy survivor row must not render
    // as a hero with zero of everything. See the header.
    const st = [];
    if (r.level != null)      st.push(['Lv ' + r.level, 'Level']);
    if (r.kills != null)      st.push([r.kills, 'Kills']);
    if (r.battles != null)    st.push([r.battles, 'Battles']);
    if (r.wins != null)       st.push([r.wins, 'Wins']);
    if (r.daysServed != null) st.push([r.daysServed, 'Days served']);
    if (r.bond != null)       st.push([r.bond, 'Bond']);

    return `
      <div class="mmem-det">
        <div class="mmem-dtop">
          <span class="mmem-dic">${esc(r.icon)}</span>
          <span>
            <div class="mmem-dnm">${esc(r.name)}</div>
            <div class="mmem-dcause" style="color:${r.causeColor}">${esc(r.causeIcon)} ${esc(r.cause)}${
              r.killedBy ? ' — ' + esc(r.killedBy) : ''}${r.battleName ? ' at ' + esc(r.battleName) : ''}</div>
            ${r.ts ? `<div style="font-size:.76rem;color:#a07880;margin-top:2px">${esc(when(r.ts))}</div>` : ''}
          </span>
        </div>
        ${r.epitaph ? `<div class="mmem-epi">“${esc(r.epitaph)}”</div>` : ''}
        ${st.length ? `<div class="mmem-stats">${st.map(([v, l]) =>
          `<div class="mmem-st"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
        ${r.traits && r.traits.length ? `
          <div class="mmem-sect">Traits</div>
          <div class="mmem-chips">${r.traits.map(t => `<span class="mmem-chip">${esc(t)}</span>`).join('')}</div>` : ''}
        ${r.supports && r.supports.length ? `
          <div class="mmem-sect">Bonds left behind</div>
          <div class="mmem-chips">${r.supports.map(s =>
            `<span class="mmem-chip">${esc(s.with)} · ${esc(s.rank)}</span>`).join('')}</div>` : ''}
        ${r.lastWords ? `<div class="mmem-sect">Last transmission</div>
          <div class="mmem-epi" style="font-style:normal">${esc(r.lastWords)}</div>` : ''}
      </div>`;
  }

  function render() {
    const s = stats || {};
    root.innerHTML = `
      <div class="mmem-box" role="dialog" aria-modal="true" aria-label="Memorial Wall">
        <div class="mmem-head">
          <div class="mmem-title">🕯 MEMORIAL WALL</div>
          <div class="mmem-sum">${s.total | 0} lost — ${s.heroes | 0} hero${(s.heroes | 0) === 1 ? '' : 'es'}, ${s.survivors | 0} survivor${(s.survivors | 0) === 1 ? '' : 's'}${
            s.kills ? ` · ${s.kills} kills between them` : ''}</div>
        </div>
        ${detail ? '' : `<div class="mmem-tabs">${FILTERS.map(f =>
          `<button class="mmem-tab" data-mmem-filter="${f.k}" aria-pressed="${filter === f.k}">${esc(f.label)}</button>`).join('')}</div>`}
        <div class="mmem-body">${detail ? detailHtml(detail) : listHtml()}</div>
        <div class="mmem-foot">
          ${detail ? `<button class="mmem-btn" data-mmem-back="1">← Wall</button>` : '<span></span>'}
          <button class="mmem-btn" data-mmem-close="1">Close</button>
        </div>
      </div>`;
  }
  render();

  root.addEventListener('click', (ev) => {
    if (ev.target === root) { close(); return; }
    const t = ev.target;
    if (!t.closest) return;
    const f = t.closest('[data-mmem-filter]');
    if (f) { filter = f.dataset.mmemFilter; render(); return; }
    const o = t.closest('[data-mmem-open]');
    if (o) { detail = rows.find(r => r.id === o.dataset.mmemOpen) || null; render(); return; }
    if (t.closest('[data-mmem-back]')) { detail = null; render(); return; }
    if (t.closest('[data-mmem-close]')) close();
  });
}
