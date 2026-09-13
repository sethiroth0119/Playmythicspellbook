/* ════════════════════════════════════════════════════════════════════════════
   ⚖️ THE BANLIST PANEL — admin editor + the players' read-only view.
   ----------------------------------------------------------------------------
   Two surfaces from one file, because they render the same data and letting
   them drift is how a banlist ends up saying different things to the admin who
   wrote it and the player it is enforced against.

     openAdmin()   full editor — formats, per-card tiers, activate, delete
     openPlayer()  read-only "current format" — what is banned and why

   ⚠ The editor writes to a LOCAL draft and only pushes on Save. A banlist that
   writes per keystroke would publish half-finished lists to live players.
   ════════════════════════════════════════════════════════════════════════════ */

import { TIERS, UNLIMITED, tierOf, slugify, emptyFormat, banlistView, limitFor } from './formats.data.js';
import * as api from './formats.api.js';

const STYLE_ID = 'mfmt-style';
const ROOT_ID = 'mfmt-root';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function b() { try { return window.MythicFormatsBridge || null; } catch (e) { return null; } }

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #${ROOT_ID}{position:fixed;inset:0;z-index:1460;display:flex;align-items:center;justify-content:center;
    background:rgba(4,6,12,.8);backdrop-filter:blur(3px);padding:14px;}
  .mfmt-box{width:min(880px,100%);max-height:92vh;display:flex;flex-direction:column;
    background:linear-gradient(180deg,#161218,#0b0a0e);border:2px solid #8a6a4a;border-radius:12px;
    box-shadow:0 24px 70px rgba(0,0,0,.72);overflow:hidden;}
  .mfmt-head{padding:12px 18px;background:linear-gradient(90deg,rgba(230,180,80,.16),transparent);
    border-bottom:1px solid rgba(230,180,80,.28);display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
  .mfmt-title{font-family:'Cinzel',serif;font-size:1.1rem;color:#f6dc95;letter-spacing:.07em;flex:1;min-width:150px;}
  .mfmt-body{padding:12px 18px;overflow:auto;flex:1;min-height:0;}
  .mfmt-warn{margin:0 0 12px;padding:9px 12px;border-radius:8px;font-size:.8rem;
    background:rgba(255,140,90,.1);border:1px solid rgba(255,140,90,.34);color:#ffc0a0;}
  .mfmt-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
  .mfmt-tab{padding:6px 13px;border-radius:999px;cursor:pointer;font:inherit;font-size:.8rem;
    background:rgba(28,24,32,.9);border:1px solid rgba(200,170,120,.28);color:#e0d0b0;}
  .mfmt-tab[aria-pressed="true"]{background:#8a6a3a;border-color:#f6dc95;color:#fff6e0;font-weight:600;}
  .mfmt-tab .live{color:#8fe0a8;margin-left:5px;}
  .mfmt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:14px;}
  .mfmt-fld label{display:block;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;
    color:#a89878;margin-bottom:3px;}
  .mfmt-fld input,.mfmt-fld textarea{width:100%;padding:7px 10px;border-radius:7px;font:inherit;font-size:.85rem;
    background:rgba(20,17,24,.9);border:1px solid rgba(200,170,120,.26);color:#f0e6d2;}
  .mfmt-search{width:100%;padding:8px 12px;border-radius:8px;font:inherit;font-size:.86rem;margin-bottom:9px;
    background:rgba(20,17,24,.9);border:1px solid rgba(200,170,120,.3);color:#f0e6d2;}
  .mfmt-row{display:flex;align-items:center;gap:9px;padding:6px 9px;margin-bottom:3px;border-radius:7px;
    background:rgba(22,19,26,.85);border:1px solid rgba(200,170,120,.14);font-size:.84rem;color:#e8dcc8;}
  .mfmt-row .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .mfmt-tiers{display:flex;gap:3px;flex:none;}
  .mfmt-tiers button{width:30px;height:26px;border-radius:5px;cursor:pointer;font:inherit;font-size:.8rem;
    background:rgba(30,26,34,.9);border:1px solid rgba(200,170,120,.24);color:#c8b898;}
  .mfmt-tiers button[aria-pressed="true"]{font-weight:700;}
  .mfmt-sect{margin:14px 0 6px;font-family:'Cinzel',serif;font-size:.92rem;letter-spacing:.06em;}
  .mfmt-chips{display:flex;flex-wrap:wrap;gap:6px;}
  .mfmt-chip{padding:4px 11px;border-radius:999px;font-size:.79rem;border:1px solid currentColor;}
  .mfmt-empty{font-size:.8rem;color:#8a7f6c;padding:6px 2px;}
  .mfmt-foot{padding:11px 18px;border-top:1px solid rgba(230,180,80,.24);display:flex;gap:9px;
    justify-content:flex-end;flex-wrap:wrap;}
  .mfmt-btn{padding:8px 17px;border-radius:8px;cursor:pointer;font:inherit;font-size:.85rem;
    background:rgba(34,28,38,.9);border:1px solid rgba(200,170,120,.36);color:#e8dcc8;}
  .mfmt-btn:hover{border-color:#f6dc95;}
  .mfmt-btn.pri{background:linear-gradient(180deg,#a8792c,#79561d);border-color:#f6dc95;color:#fff8e8;font-weight:600;}
  .mfmt-btn.danger{border-color:#c05a5a;color:#ffb0b0;}
  .mfmt-btn[disabled]{opacity:.45;cursor:not-allowed;}
  @media (max-width:520px){ .mfmt-box{max-height:96vh;} .mfmt-row{flex-wrap:wrap;} }
  `;
  document.head.appendChild(s);
}

function close() { try { const n = document.getElementById(ROOT_ID); if (n) n.remove(); } catch (e) {} }

function mount(html, wire) {
  ensureStyle(); close();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = html;
  document.body.appendChild(root);
  root.addEventListener('click', (ev) => { if (ev.target === root) close(); });
  if (wire) wire(root);
  return root;
}

/* ── The players' view ──────────────────────────────────────────────────── */
export async function openPlayer() {
  await api.refresh();
  const f = api.activeFormat();
  const nameOf = (k) => { try { return (b() && b().nameOf) ? b().nameOf(k) : k; } catch (e) { return k; } };

  const body = !f
    ? `<div class="mfmt-empty">No format is active — decks follow each card's own copy limit.</div>`
    : banlistView(f, nameOf).map(g => `
        <div class="mfmt-sect" style="color:${g.color}">${g.icon} ${esc(g.label)} <span style="opacity:.6;font-size:.8rem">(${g.cards.length})</span></div>
        ${g.cards.length
          ? `<div class="mfmt-chips">${g.cards.map(c => `<span class="mfmt-chip" style="color:${g.color}">${esc(c.name)}</span>`).join('')}</div>`
          : `<div class="mfmt-empty">Nothing ${esc(g.label.toLowerCase())}.</div>`}
      `).join('');

  mount(`
    <div class="mfmt-box" role="dialog" aria-modal="true" aria-label="Current format">
      <div class="mfmt-head"><div class="mfmt-title">⚖️ ${esc(f ? f.name : 'No Active Format')}</div>
        ${f ? `<span style="font-size:.8rem;color:#a89878">Best of ${f.bestOf} · side ${f.sideMax}</span>` : ''}</div>
      <div class="mfmt-body">
        ${f && f.notes ? `<div class="mfmt-warn">${esc(f.notes)}</div>` : ''}
        ${body}
      </div>
      <div class="mfmt-foot"><button class="mfmt-btn" data-mfmt-close="1">Close</button></div>
    </div>`,
    (root) => root.addEventListener('click', (ev) => {
      if (ev.target.closest && ev.target.closest('[data-mfmt-close]')) close();
    }));
}

/* ── The admin editor ───────────────────────────────────────────────────── */
export async function openAdmin() {
  const br = b();
  if (!br || !br.isAdmin || !br.isAdmin()) { try { br && br.toast && br.toast('🔒 Admin only.', 2600); } catch (e) {} return; }

  let formats = await api.list();
  let draft = formats.find(f => f.active) || formats[0] || emptyFormat('Standard');
  draft = { ...draft, limits: { ...(draft.limits || {}) } };
  let filter = '';
  let dirty = false;

  const cards = (() => { try { return (br.allCards && br.allCards()) || []; } catch (e) { return []; } })();

  function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const q = filter.trim().toLowerCase();

    /* Restricted cards ALWAYS show, even when filtered out by the search box.
       An admin who filters to "dragon", bans one, then clears the filter must
       never wonder where the ban went — and more importantly must never lose
       track of a restriction they cannot see. */
    const shown = cards.filter(c => {
      if (draft.limits[c.key] != null) return true;
      if (!q) return false;                      // no query: only restricted cards listed
      return String(c.name || '').toLowerCase().includes(q) || String(c.key).toLowerCase().includes(q);
    }).slice(0, 300);

    root.innerHTML = `
      <div class="mfmt-box" role="dialog" aria-modal="true" aria-label="Format editor">
        <div class="mfmt-head">
          <div class="mfmt-title">⚖️ FORMATS &amp; BANLIST</div>
          <span style="font-size:.78rem;color:#a89878">👑 admin</span>
        </div>
        <div class="mfmt-body">
          ${api.tableMissing() ? `<div class="mfmt-warn">⚠ <b>card_formats table not found.</b> Apply <code>sql/100_card_formats_banlist.sql</code> in the Supabase SQL editor. Until then nothing here can be saved, and players follow each card's own copy limit.</div>` : ''}

          <div class="mfmt-tabs">
            ${formats.map(f => `<button class="mfmt-tab" data-mfmt-pick="${esc(f.slug)}" aria-pressed="${f.slug === draft.slug}">${esc(f.name)}${f.active ? '<span class="live">● live</span>' : ''}</button>`).join('')}
            <button class="mfmt-tab" data-mfmt-new="1">＋ New</button>
          </div>

          <div class="mfmt-grid">
            <div class="mfmt-fld"><label>Name</label><input data-mfmt-f="name" value="${esc(draft.name)}"></div>
            <div class="mfmt-fld"><label>Slug</label><input data-mfmt-f="slug" value="${esc(draft.slug)}"></div>
            <div class="mfmt-fld"><label>Best of</label><input data-mfmt-f="bestOf" type="number" min="1" max="9" step="2" value="${draft.bestOf}"></div>
            <div class="mfmt-fld"><label>Side deck max</label><input data-mfmt-f="sideMax" type="number" min="0" max="30" value="${draft.sideMax}"></div>
          </div>
          <div class="mfmt-fld" style="margin-bottom:12px"><label>Notes (shown to players)</label>
            <textarea data-mfmt-f="notes" rows="2">${esc(draft.notes)}</textarea></div>

          <input class="mfmt-search" data-mfmt-search="1" placeholder="Search the card pool to restrict…  (restricted cards always listed)" value="${esc(filter)}">

          ${shown.length ? shown.map(c => {
            const cur = draft.limits[c.key] != null ? draft.limits[c.key] : UNLIMITED;
            return `<div class="mfmt-row">
              <span class="n">${esc(c.name)}</span>
              <span class="mfmt-tiers">${TIERS.map(t => `
                <button data-mfmt-set="${esc(c.key)}" data-mfmt-n="${t.n}" aria-pressed="${cur === t.n}"
                  title="${esc(t.label)}" style="${cur === t.n ? 'color:' + t.color + ';border-color:' + t.color : ''}">${t.icon}</button>`).join('')}</span>
            </div>`;
          }).join('') : `<div class="mfmt-empty">${q ? 'No cards match.' : 'Nothing restricted yet — search above to add a restriction.'}</div>`}
        </div>
        <div class="mfmt-foot">
          ${draft.id ? `<button class="mfmt-btn danger" data-mfmt-del="1">Delete</button>` : ''}
          <button class="mfmt-btn" data-mfmt-close="1">Close</button>
          ${draft.id && !draft.active ? `<button class="mfmt-btn" data-mfmt-activate="1">Make live</button>` : ''}
          <button class="mfmt-btn pri" data-mfmt-save="1" ${api.tableMissing() ? 'disabled' : ''}>${dirty ? 'Save *' : 'Save'}</button>
        </div>
      </div>`;
  }

  const root = mount('<div></div>');
  render();

  root.addEventListener('input', (ev) => {
    const f = ev.target.closest && ev.target.closest('[data-mfmt-f]');
    if (f) {
      const k = f.dataset.mfmtF;
      draft[k] = (k === 'bestOf' || k === 'sideMax') ? (parseInt(f.value, 10) || 0) : f.value;
      if (k === 'name' && !draft.id) draft.slug = slugify(f.value);
      dirty = true;
      return;
    }
    const s = ev.target.closest && ev.target.closest('[data-mfmt-search]');
    if (s) {
      filter = s.value;
      const at = s.selectionStart;
      render();
      // Keep focus and caret — re-rendering the whole panel on every keystroke
      // otherwise throws the admin out of the box mid-word.
      try {
        const el = document.querySelector('[data-mfmt-search]');
        if (el) { el.focus(); el.setSelectionRange(at, at); }
      } catch (e) {}
    }
  });

  root.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;

    const set = t.closest('[data-mfmt-set]');
    if (set) {
      const key = set.dataset.mfmtSet, n = parseInt(set.dataset.mfmtN, 10);
      if (n >= UNLIMITED) delete draft.limits[key];     // unlimited = absent (see formats.data.js)
      else draft.limits[key] = n;
      dirty = true; render(); return;
    }
    const pick = t.closest('[data-mfmt-pick]');
    if (pick) {
      const f = formats.find(x => x.slug === pick.dataset.mfmtPick);
      if (f) { draft = { ...f, limits: { ...f.limits } }; dirty = false; render(); }
      return;
    }
    if (t.closest('[data-mfmt-new]')) { draft = emptyFormat('New Format'); dirty = true; render(); return; }
    if (t.closest('[data-mfmt-close]')) { close(); return; }

    if (t.closest('[data-mfmt-save]')) {
      const r = await api.save(draft);
      if (!r.ok) { try { br.toast('⚠ ' + r.why, 4200); } catch (e) {} return; }
      draft = { ...r.format, limits: { ...r.format.limits } };
      dirty = false;
      formats = await api.list();
      try { br.toast('⚖️ Saved “' + draft.name + '”.', 3000); } catch (e) {}
      render(); return;
    }
    if (t.closest('[data-mfmt-activate]')) {
      const r = await api.activate(draft.slug);
      if (!r.ok) { try { br.toast('⚠ ' + r.why, 4200); } catch (e) {} return; }
      formats = await api.list();
      draft = formats.find(f => f.slug === draft.slug) || draft;
      try { br.toast('⚖️ “' + draft.name + '” is now the live format.', 3600); } catch (e) {}
      render(); return;
    }
    if (t.closest('[data-mfmt-del]')) {
      let ok = true;
      try { ok = br.confirm ? await br.confirm('Delete the format “' + draft.name + '”? Its banlist is lost.') : confirm('Delete?'); } catch (e) { ok = false; }
      if (!ok) return;
      const r = await api.remove(draft.id);
      if (!r.ok) { try { br.toast('⚠ ' + r.why, 4200); } catch (e) {} return; }
      formats = await api.list();
      draft = formats[0] ? { ...formats[0], limits: { ...formats[0].limits } } : emptyFormat('Standard');
      render(); return;
    }
  });
}
