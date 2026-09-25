/* ════════════════════════════════════════════════════════════════════════════
   🎯 NODE CAMPAIGNS — module entry point. Registers window.MythicNodeCampaigns.
   ----------------------------------------------------------------------------
   The City Node drawer's "⚔ Attack PRN" button is now "🎯 Do Campaign". It
   opens a picker of the campaigns attached to that node:

     relief   "Standing With El Paso" — give the node food / water / crude oil /
              Cinder (500,000,000 of each). Two doors inside:
                🎁 GIVE      → ledger row (sql/038), leaderboard, Ⓜ airdrops
                🗺 MISSION   → the roguelite campaign of the same name, built by
                               the admin in the Guide + roguelite map
     assault  the old attack flow, unchanged, so nothing was lost.

   Lives OUTSIDE index.html (CLAUDE.md). index.html contributes only the
   button, the tab slot, and `window.MythicBridge.nodeCampaigns`.

   🔴 THE GLOBALS TRAP: this file reads no legacy global. Everything comes
   through campaigns.bridge.js; without the bridge it registers, stays inert
   and warns once.
   ⚠ Everything is wrapped. A failure here can never take the node map down.
   ════════════════════════════════════════════════════════════════════════════ */
import { bridge, bridgeReady, nc, esc } from './campaigns.bridge.js';
import * as api from './campaigns.api.js';
import {
  SEED_CAMPAIGNS, ASSAULT_CAMPAIGN, RESOURCE_ORDER, resMeta, fromRow, toRow, fmtBig, slugify,
} from './campaigns.data.js';

/* ── state ──────────────────────────────────────────────────────────────── */
const S = {
  rows: null, rowsAt: 0, rowsMissing: false, fetchingRows: false,
  boards: {},            // campaignId → { data, at, missing }
  fetchingBoard: {},
  modal: null,           // { step:'pick'|'detail'|'give', nodeId, campId, res, amount, flash }
  edit: null,            // admin editor: { nodeId, camp } | null
  busy: false,
  warned: false,
};
const ROWS_TTL = 60000, BOARD_TTL = 45000;

/* ── catalog ────────────────────────────────────────────────────────────── */
function dbCampaigns() {
  return (S.rows || []).map(fromRow).filter(Boolean);
}
// Campaigns for a node: DB rows for its id, plus any seed not already in the
// DB (matched by id OR by node name), plus the assault option for non-owners.
export function listForNode(nodeId) {
  const node = nc().node(nodeId);
  if (!node) return [];
  const out = [];
  const seen = {};
  dbCampaigns().forEach((c) => { if (c.active && c.nodeId === node.id) { out.push(c); seen[c.id] = true; } });
  SEED_CAMPAIGNS.forEach((s) => {
    if (seen[s.id]) return;
    // A DB row for this seed on ANOTHER node means the admin moved it — hide the seed.
    if (dbCampaigns().some((c) => c.id === s.id)) return;
    const hit = s.nodeId === node.id || (s.nodeMatch && s.nodeMatch.test(String(node.name || '')));
    if (hit) { out.push(Object.assign({}, s, { nodeId: node.id })); seen[s.id] = true; }
  });
  if (nc().canAttack(node.id)) out.push(ASSAULT_CAMPAIGN);
  return out;
}
function findCampaign(nodeId, campId) {
  return listForNode(nodeId).find((c) => c.id === campId) || null;
}

/* ── fetching (best-effort, re-renders the drawer once when done) ───────── */
function rerenderIfShowing(nodeId) {
  try {
    if (nc().onNodeScreen() && nc().selectedNode() === nodeId) bridge().render();
    if (S.modal && S.modal.nodeId === nodeId) paintModal();
  } catch (e) {}
}
function ensureRows(nodeId, force) {
  if (S.fetchingRows) return;
  if (!force && S.rows && (Date.now() - S.rowsAt) < ROWS_TTL) return;
  if (!bridge().signedIn()) { if (!S.rows) { S.rows = []; S.rowsAt = Date.now(); } return; }
  S.fetchingRows = true;
  api.listCampaigns().then((r) => {
    S.fetchingRows = false;
    S.rowsAt = Date.now();
    S.rowsMissing = !!r.missing;
    if (r.ok) S.rows = r.rows; else if (!S.rows) S.rows = [];
    rerenderIfShowing(nodeId);
  }).catch(() => { S.fetchingRows = false; });
}
function ensureBoard(nodeId, campId, force) {
  if (!campId || campId === ASSAULT_CAMPAIGN.id) return;
  if (S.fetchingBoard[campId]) return;
  const cur = S.boards[campId];
  if (!force && cur && (Date.now() - cur.at) < BOARD_TTL) return;
  if (!bridge().signedIn()) return;
  S.fetchingBoard[campId] = true;
  api.board(campId).then((r) => {
    S.fetchingBoard[campId] = false;
    S.boards[campId] = { data: r.ok ? r.data : ((cur && cur.data) || null), at: Date.now(), missing: !!r.missing };
    rerenderIfShowing(nodeId);
  }).catch(() => { S.fetchingBoard[campId] = false; });
}
function boardOf(campId) { const b = S.boards[campId]; return (b && b.data) || null; }

/* ── shared renderers ───────────────────────────────────────────────────── */
function goalRows(c) {
  const b = boardOf(c.id);
  const totals = (b && b.totals) || {};
  const mine = (b && b.mine) || {};
  const ids = RESOURCE_ORDER.filter((k) => c.goals[k] > 0).concat(Object.keys(c.goals).filter((k) => RESOURCE_ORDER.indexOf(k) < 0));
  if (!ids.length) return '';
  return `<div class="nc-goals">${ids.map((id) => {
    const m = resMeta(id);
    const goal = Number(c.goals[id]) || 0;
    const got = Number(totals[id]) || 0;
    const pct = goal > 0 ? Math.min(100, (got / goal) * 100) : 0;
    const my = Number(mine[id]) || 0;
    return `<div class="nc-goal" title="${esc(m.name)}: ${got.toLocaleString()} of ${goal.toLocaleString()} given${my ? ' · you gave ' + my.toLocaleString() : ''}">
      <div class="nc-goal-top"><span class="nc-goal-name" style="color:${m.color}">${m.icon} ${esc(m.name)}</span><span class="nc-goal-num">${fmtBig(got)} <span class="nc-dim">/ ${fmtBig(goal)}</span></span></div>
      <div class="nc-bar"><div class="nc-bar-fill" style="width:${pct.toFixed(1)}%;background:${m.color}"></div></div>
      ${my ? `<div class="nc-goal-mine">you: ${fmtBig(my)}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}
function leaderboard(c, limit) {
  const b = boardOf(c.id);
  if (!bridge().signedIn()) return `<div class="nc-empty">☁ Sign in to give and to see the leaderboard.</div>`;
  const miss = S.boards[c.id] && S.boards[c.id].missing;
  if (miss) return `<div class="nc-empty">Campaign ledger not set up yet (run sql/038).</div>`;
  if (!b) return `<div class="nc-empty">Loading standings…</div>`;
  const top = Array.isArray(b.top) ? b.top.slice(0, limit || 10) : [];
  const me = bridge().userId();
  const myTotal = Object.keys(b.mine || {}).reduce((s, k) => s + (Number(b.mine[k]) || 0), 0);
  const myMt = Number(b.my_mt) || 0;
  return `
    <div class="nc-lb">
      <div class="nc-lb-hdr"><span>🏆 LEADERBOARD</span><span class="nc-dim">${(b.contributors | 0).toLocaleString()} giver${(b.contributors | 0) === 1 ? '' : 's'}</span></div>
      ${top.length ? top.map((r, i) => `<div class="nc-lb-row${r.user_id === me ? ' is-me' : ''}">
        <span class="nc-lb-rank">${i + 1}</span>
        <span class="nc-lb-name">${esc(r.user_name || 'Survivor')}</span>
        <span class="nc-lb-total">${fmtBig(r.total)}</span>
      </div>`).join('') : '<div class="nc-empty">No gifts yet — be the first on the board.</div>'}
      <div class="nc-lb-me">You: <b>${fmtBig(myTotal)}</b> given · <b style="color:#cdb6ff">Ⓜ ${myMt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> earned
        <span class="nc-dim">· 1 Ⓜ per ${c.airdropMtPerMillion === 1 ? '1M' : (1 / (c.airdropMtPerMillion || 1)).toLocaleString() + 'M'} given, airdropped to your linked wallet</span></div>
    </div>`;
}

/* ── the CAMPAIGNS tab inside the node drawer ───────────────────────────── */
export function renderTab(nodeId) {
  try {
    if (!bridgeReady()) return '';
    ensureRows(nodeId);
    const list = listForNode(nodeId);
    list.forEach((c) => { if (c.kind === 'relief') ensureBoard(nodeId, c.id); });
    const node = nc().node(nodeId) || { name: 'this node' };
    const relief = list.filter((c) => c.kind === 'relief');
    const cards = list.map((c) => `
      <div class="nc-card nc-kind-${esc(c.kind)}" data-nc-card="${esc(c.id)}">
        <div class="nc-card-head">
          <span class="nc-card-icon">${esc(c.icon)}</span>
          <div class="nc-card-title"><div class="nc-card-name">${esc(c.name)}</div><div class="nc-card-tag">${esc(c.tagline || '')}</div></div>
          <button class="nc-btn nc-btn-gold" data-nc-act="open" data-nc-node="${esc(nodeId)}" data-nc-camp="${esc(c.id)}">${c.kind === 'assault' ? '⚔ Raid' : '🎯 Do Campaign'}</button>
        </div>
        ${c.kind === 'relief' ? goalRows(c) : ''}
        ${c.kind === 'relief' ? leaderboard(c, 10) : ''}
      </div>`).join('');
    return `
      <div class="nc-tab">
        <div class="tw-nd-section-hdr">— CAMPAIGNS (${list.length})${S.fetchingRows ? ' <span class="nc-dim" style="font-weight:400">· syncing</span>' : ''}</div>
        ${list.length ? cards : `<div class="nc-empty">No campaigns on ${esc(node.name)} yet.</div>`}
        ${!relief.length && S.rowsMissing ? '<div class="nc-empty">Campaign tables not set up yet — run sql/038 in Supabase.</div>' : ''}
        ${bridge().isAdmin() ? adminBlock(nodeId) : ''}
      </div>`;
  } catch (e) {
    try { console.warn('[campaigns] tab failed:', e); } catch (e2) {}
    return '';
  }
}

/* ── admin editor (in the tab, not the modal) ───────────────────────────── */
function adminBlock(nodeId) {
  const e = S.edit && S.edit.nodeId === nodeId ? S.edit : null;
  if (!e) {
    const mine = listForNode(nodeId).filter((c) => c.kind === 'relief');
    return `<div class="nc-admin">
      <div class="tw-nd-section-hdr">— ADMIN · CAMPAIGNS</div>
      <div class="nc-admin-row">
        <button class="nc-btn" data-nc-act="admin-new" data-nc-node="${esc(nodeId)}">＋ New Campaign</button>
        ${mine.map((c) => `<button class="nc-btn" data-nc-act="admin-edit" data-nc-node="${esc(nodeId)}" data-nc-camp="${esc(c.id)}">✎ ${esc(c.name)}</button>`).join('')}
      </div>
      ${!bridge().signedIn() ? '<div class="nc-empty">Sign in to save campaigns to the shared table.</div>' : ''}
    </div>`;
  }
  const c = e.camp;
  const missions = nc().missions();
  const g = (k) => (c.goals && c.goals[k]) || '';
  return `<div class="nc-admin nc-admin-form" data-nc-form="${esc(nodeId)}">
    <div class="tw-nd-section-hdr">— ADMIN · ${c._new ? 'NEW CAMPAIGN' : 'EDIT ' + esc(c.name).toUpperCase()}</div>
    <div class="nc-f"><label>Name</label><input id="nc-f-name" value="${esc(c.name)}" maxlength="60"></div>
    <div class="nc-f nc-f-2">
      <div><label>Icon</label><input id="nc-f-icon" value="${esc(c.icon || '🤝')}" maxlength="4"></div>
      <div><label>Node id</label><input id="nc-f-node" value="${esc(c.nodeId || nodeId)}" maxlength="24"></div>
    </div>
    <div class="nc-f"><label>Tagline</label><input id="nc-f-tag" value="${esc(c.tagline || '')}" maxlength="120"></div>
    <div class="nc-f"><label>Description</label><textarea id="nc-f-desc" rows="3" maxlength="600">${esc(c.description || '')}</textarea></div>
    <div class="nc-f"><label>Goals (units to give)</label>
      <div class="nc-f-goals">${RESOURCE_ORDER.map((k) => { const m = resMeta(k); return `<div><span>${m.icon} ${esc(m.name)}</span><input type="number" min="0" step="1" id="nc-f-goal-${k}" value="${esc(g(k))}" placeholder="0 = not asked"></div>`; }).join('')}</div>
    </div>
    <div class="nc-f nc-f-2">
      <div><label>Mission name (roguelite)</label><input id="nc-f-mname" value="${esc(c.missionName || '')}" maxlength="80" placeholder="Standing With El Paso"></div>
      <div><label>Pin a mission</label><select id="nc-f-mid"><option value="">— match by name —</option>${missions.map((m) => `<option value="${esc(m.id)}"${c.missionId === m.id ? ' selected' : ''}>${esc(m.name)}${m.isPublished ? '' : ' (unpublished)'}</option>`).join('')}</select></div>
    </div>
    <div class="nc-f nc-f-2">
      <div><label>Ⓜ per 1,000,000 given</label><input type="number" min="0" step="0.01" id="nc-f-mt" value="${esc(c.airdropMtPerMillion == null ? 1 : c.airdropMtPerMillion)}"></div>
      <div><label>Active</label><select id="nc-f-active"><option value="1"${c.active !== false ? ' selected' : ''}>Yes — players can see it</option><option value="0"${c.active === false ? ' selected' : ''}>No — hidden</option></select></div>
    </div>
    <div class="nc-admin-row">
      <button class="nc-btn nc-btn-gold" data-nc-act="admin-save" data-nc-node="${esc(nodeId)}"${S.busy ? ' disabled' : ''}>💾 Save</button>
      <button class="nc-btn" data-nc-act="admin-cancel" data-nc-node="${esc(nodeId)}">Cancel</button>
      ${!c._new && !c.seed ? `<button class="nc-btn nc-btn-danger" data-nc-act="admin-off" data-nc-node="${esc(nodeId)}" data-nc-camp="${esc(c.id)}">Deactivate</button>` : ''}
    </div>
    <div class="nc-dim" style="padding:0 1rem 0.6rem;font-size:0.62rem">Goals and the Ⓜ rate are enforced by the server (sql/038). The mission is matched by name against the published roguelite campaigns unless you pin one.</div>
  </div>`;
}
function readForm(nodeId) {
  const v = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  const e = S.edit; if (!e) return null;
  const goals = {};
  RESOURCE_ORDER.forEach((k) => { const n = Math.floor(Number(v('nc-f-goal-' + k)) || 0); if (n > 0) goals[k] = n; });
  const name = v('nc-f-name');
  if (!name) { bridge().toast('⚠ Give the campaign a name.'); return null; }
  if (!Object.keys(goals).length) { bridge().toast('⚠ Set at least one goal.'); return null; }
  return {
    id: e.camp._new ? slugify(name, v('nc-f-node') || nodeId) : e.camp.id,
    nodeId: v('nc-f-node') || nodeId, kind: 'relief', name, icon: v('nc-f-icon') || '🤝',
    tagline: v('nc-f-tag'), description: v('nc-f-desc'), goals,
    missionName: v('nc-f-mname'), missionId: v('nc-f-mid') || null,
    airdropMtPerMillion: Math.max(0, Number(v('nc-f-mt')) || 0), active: v('nc-f-active') !== '0',
  };
}
async function adminSave(nodeId) {
  const c = readForm(nodeId); if (!c) return;
  if (!bridge().signedIn()) { bridge().toast('☁ Sign in to save campaigns.'); return; }
  S.busy = true;
  const r = await api.saveCampaign(toRow(c));
  S.busy = false;
  if (!r.ok) { bridge().toast(r.missing ? '⚠ Campaign table missing — run sql/038 first.' : '⚠ Save failed: ' + (r.error || 'unknown'), 5000); return; }
  S.edit = null;
  bridge().toast('💾 Campaign saved — every player sees it on the next sync.');
  ensureRows(nodeId, true);
  bridge().render();
}

/* ── the DO CAMPAIGN modal ──────────────────────────────────────────────── */
export function open(nodeId, campId) {
  try {
    if (!bridgeReady()) { warnOnce(); return; }
    const node = nc().node(nodeId); if (!node) return;
    ensureRows(nodeId);
    const list = listForNode(nodeId);
    list.forEach((c) => { if (c.kind === 'relief') ensureBoard(nodeId, c.id); });
    let step = 'pick', chosen = campId || null;
    if (chosen) {
      const c = findCampaign(nodeId, chosen);
      if (c && c.kind === 'assault') { nc().attack(nodeId); return; }
      if (c) step = 'detail'; else chosen = null;
    } else if (list.length === 1 && list[0].kind === 'assault') {
      // Only the raid exists here — no picker needed, behave like the old button.
      nc().attack(nodeId); return;
    }
    S.modal = { step, nodeId, campId: chosen, res: null, amount: '', flash: '' };
    paintModal();
  } catch (e) { try { console.warn('[campaigns] open failed:', e); } catch (e2) {} }
}
export function close() {
  S.modal = null;
  const el = document.getElementById('nc-overlay'); if (el) el.remove();
}
function ensureCss() {
  if (document.getElementById('nc-css')) return;
  const st = document.createElement('style'); st.id = 'nc-css'; st.textContent = CSS; document.head.appendChild(st);
}
function paintModal() {
  const m = S.modal; if (!m) return;
  ensureCss();
  let ov = document.getElementById('nc-overlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'nc-overlay'; ov.className = 'nc-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }
  const node = nc().node(m.nodeId) || { name: 'Node' };
  let body = '';
  if (m.step === 'pick') body = paintPick(m, node);
  else if (m.step === 'detail') body = paintDetail(m, node);
  else if (m.step === 'give') body = paintGive(m, node);
  ov.innerHTML = `<div class="nc-modal" role="dialog" aria-label="Do Campaign">
    <span class="cd-corner tl"></span><span class="cd-corner tr"></span><span class="cd-corner bl"></span><span class="cd-corner br"></span>
    <div class="nc-modal-bar"><span class="nc-modal-crumb">🎯 DO CAMPAIGN · ${esc(String(node.name || '').toUpperCase())}</span><button class="nc-x" data-nc-act="close">✕</button></div>
    ${body}
  </div>`;
  const inp = ov.querySelector('#nc-amount'); if (inp && m.step === 'give') { try { inp.focus(); } catch (e) {} }
}
function paintPick(m, node) {
  const list = listForNode(m.nodeId);
  return `<div class="nc-modal-body">
    <div class="nc-h1">Choose a campaign</div>
    <div class="nc-sub">What will you do for ${esc(node.name)}?</div>
    ${list.length ? list.map((c) => `<button class="nc-pick" data-nc-act="pick" data-nc-camp="${esc(c.id)}">
      <span class="nc-pick-icon">${esc(c.icon)}</span>
      <span class="nc-pick-text"><b>${esc(c.name)}</b><small>${esc(c.tagline || '')}</small></span>
      <span class="nc-pick-go">▸</span>
    </button>`).join('') : '<div class="nc-empty">No campaigns on this node yet.</div>'}
  </div>`;
}
function paintDetail(m, node) {
  const c = findCampaign(m.nodeId, m.campId);
  if (!c) { m.step = 'pick'; return paintPick(m, node); }
  const mission = resolveMission(c);
  return `<div class="nc-modal-body">
    ${m.flash ? `<div class="nc-flash">${m.flash}</div>` : ''}
    <div class="nc-h1">${esc(c.icon)} ${esc(c.name)}</div>
    <div class="nc-sub">${esc(c.tagline || '')}</div>
    <p class="nc-desc">${esc(c.description || '')}</p>
    ${goalRows(c)}
    <div class="nc-doors">
      <button class="nc-door nc-door-give" data-nc-act="to-give">
        <span class="nc-door-icon">🎁</span>
        <span class="nc-door-title">Give to ${esc(node.name)}</span>
        <span class="nc-door-sub">Food · Water · Crude Oil · Cinder. Climbs the leaderboard and earns Ⓜ Mythic Token airdrops.</span>
      </button>
      <button class="nc-door nc-door-mission" data-nc-act="mission">
        <span class="nc-door-icon">🗺</span>
        <span class="nc-door-title">${esc(c.missionName || c.name)} Mission</span>
        <span class="nc-door-sub">${mission ? 'Run the mission on the roguelite map.' : 'Opens the mission map. This mission is not published yet.'}</span>
      </button>
    </div>
    ${leaderboard(c, 10)}
    <div class="nc-modal-foot"><button class="nc-btn" data-nc-act="back-pick">◂ Other campaigns</button></div>
  </div>`;
}
function holdings(resId) {
  return resId === 'cinder' ? (bridge().gems() | 0) : (nc().getRes(resId) | 0);
}
function paintGive(m, node) {
  const c = findCampaign(m.nodeId, m.campId);
  if (!c) { m.step = 'pick'; return paintPick(m, node); }
  const b = boardOf(c.id); const totals = (b && b.totals) || {};
  const ids = RESOURCE_ORDER.filter((k) => c.goals[k] > 0);
  if (!m.res || ids.indexOf(m.res) < 0) m.res = ids[0] || null;
  const signed = bridge().signedIn();
  const miss = S.boards[c.id] && S.boards[c.id].missing;
  const have = m.res ? holdings(m.res) : 0;
  const goal = m.res ? (Number(c.goals[m.res]) || 0) : 0;
  const remain = Math.max(0, goal - (Number(totals[m.res]) || 0));
  const max = Math.max(0, Math.min(have, remain));
  const amt = Math.floor(Number(m.amount) || 0);
  const meta = m.res ? resMeta(m.res) : null;
  const quick = (f, label) => `<button class="nc-chip" data-nc-act="amt" data-nc-amt="${Math.floor(max * f)}"${max <= 0 ? ' disabled' : ''}>${label}</button>`;
  const canGive = signed && !miss && amt > 0 && amt <= have && remain > 0 && !S.busy;
  return `<div class="nc-modal-body">
    <div class="nc-h1">🎁 Give to ${esc(node.name)}</div>
    <div class="nc-sub">${esc(c.name)}</div>
    <div class="nc-res-grid">${ids.map((id) => { const r = resMeta(id); const g = Number(c.goals[id]) || 0; const got = Number(totals[id]) || 0;
      return `<button class="nc-res${m.res === id ? ' is-on' : ''}" data-nc-act="res" data-nc-res="${esc(id)}" style="--c:${r.color}">
        <span class="nc-res-icon">${r.icon}</span><span class="nc-res-name">${esc(r.name)}</span>
        <span class="nc-res-have">you hold ${fmtBig(holdings(id))}</span>
        <span class="nc-res-left">${got >= g ? '✓ goal met' : fmtBig(g - got) + ' still needed'}</span>
      </button>`; }).join('')}</div>
    ${meta ? `<div class="nc-amount-wrap">
      <label class="nc-amount-label">${meta.icon} Amount of ${esc(meta.name)} <span class="nc-dim">· you hold ${have.toLocaleString()} · ${remain.toLocaleString()} still needed</span></label>
      <input id="nc-amount" class="nc-amount" type="number" min="1" step="1" inputmode="numeric" value="${amt > 0 ? amt : ''}" placeholder="0" data-nc-input="amount">
      <div class="nc-chips">${quick(0.1, '10%')}${quick(0.25, '25%')}${quick(0.5, '50%')}${quick(1, 'MAX')}</div>
      ${amt > have ? `<div class="nc-warn">You only hold ${have.toLocaleString()} ${esc(meta.name)}.</div>` : ''}
      ${remain <= 0 ? `<div class="nc-warn">This goal is already met — pick another resource.</div>` : ''}
      ${!signed ? '<div class="nc-warn">☁ Sign in to give. Gifts are recorded on the shared ledger, so nothing is taken while you are offline.</div>' : ''}
      ${miss ? '<div class="nc-warn">Campaign ledger not set up yet (sql/038) — nothing is taken until it is.</div>' : ''}
      ${m.res === 'cinder' ? '<div class="nc-dim" style="font-size:0.66rem;margin-top:4px">🔥 Cinder is debited from your wallet by the server, with no Foundation Tax — a gift is not a purchase.</div>' : ''}
    </div>` : '<div class="nc-empty">This campaign asks for nothing.</div>'}
    <div class="nc-modal-foot">
      <button class="nc-btn" data-nc-act="back-detail">◂ Back</button>
      <button class="nc-btn nc-btn-gold nc-btn-big" data-nc-act="give"${canGive ? '' : ' disabled'}>${S.busy ? '⏳ Giving…' : `🎁 Give ${amt > 0 ? fmtBig(amt) : ''} ${meta ? esc(meta.name) : ''}`}</button>
    </div>
  </div>`;
}

/* ── giving ─────────────────────────────────────────────────────────────── */
async function doGive() {
  const m = S.modal; if (!m || S.busy) return;
  const c = findCampaign(m.nodeId, m.campId); if (!c || !m.res) return;
  const b = bridge();
  const amt = Math.floor(Number(m.amount) || 0);
  const meta = resMeta(m.res);
  if (amt <= 0) { b.toast('⚠ Enter an amount.'); return; }
  if (!b.signedIn()) { b.toast('☁ Sign in to give — gifts live on the shared ledger.'); return; }
  const have = holdings(m.res);
  if (amt > have) { b.toast(`⚠ You only hold ${have.toLocaleString()} ${meta.name}.`); return; }
  const node = nc().node(m.nodeId) || { name: 'the node' };
  if (!await b.confirm(`Give ${amt.toLocaleString()} ${meta.name} to ${node.name}?\n\nThis is a gift — it is not refundable.`)) return;

  S.busy = true; paintModal();
  let spentLocal = false;
  try {
    // Food / water / oil live client-side: take them FIRST, refund on failure.
    // Cinder is debited by the server inside the RPC and never spent here.
    if (m.res !== 'cinder') {
      if (!nc().spendRes(m.res, amt)) { S.busy = false; paintModal(); b.toast('⚠ Could not take that from your stash.'); return; }
      spentLocal = true;
    }
    const r = await api.give(c.id, m.res, amt);
    if (!r.ok) {
      if (spentLocal) nc().refundRes(m.res, amt);
      const why = r.missing ? 'Campaign ledger not set up yet — run sql/038.'
        : r.error === 'insufficient' ? 'Your wallet does not hold that much Cinder.'
        : r.error === 'no_campaign' ? 'That campaign is not on the server yet — an admin must save it first.'
        : r.error === 'bad_resource' ? 'This campaign does not ask for that resource.'
        : r.error === 'not_authenticated' ? 'Sign in and try again.'
        : ('Could not record the gift: ' + (r.error || 'unknown'));
      S.busy = false; paintModal();
      b.toast('⚠ ' + why, 5200);
      return;
    }
    const d = r.data || {};
    if (m.res === 'cinder' && d.new_balance != null) nc().adoptCinder(d.new_balance, d.wallet_seq);
    const mt = Number(d.mt_awarded) || 0;
    b.toast(`🎁 Gave ${amt.toLocaleString()} ${meta.name} to ${node.name}!` + (mt > 0 ? ` +Ⓜ ${mt.toLocaleString(undefined, { maximumFractionDigits: 2 })} airdrop queued.` : ''), 5200);
    S.busy = false;
    m.step = 'detail'; m.amount = '';
    m.flash = `✓ ${fmtBig(amt)} ${esc(meta.name)} given` + (mt > 0 ? ` · Ⓜ ${mt.toLocaleString(undefined, { maximumFractionDigits: 2 })} airdrop queued` : '');
    ensureBoard(m.nodeId, c.id, true);
    paintModal();
    try { b.render(); } catch (e) {}
  } catch (e) {
    if (spentLocal) { try { nc().refundRes(m.res, amt); } catch (e2) {} }
    S.busy = false; paintModal();
    b.toast('⚠ Gift failed — nothing was taken.', 4200);
  }
}

/* ── the mission door ───────────────────────────────────────────────────── */
function resolveMission(c) {
  const list = nc().missions() || [];
  if (c.missionId) { const hit = list.find((x) => x.id === c.missionId); if (hit) return hit; }
  const want = String(c.missionName || c.name || '').trim().toLowerCase();
  if (!want) return null;
  return list.find((x) => String(x.name || '').trim().toLowerCase() === want)
      || list.find((x) => String(x.name || '').toLowerCase().indexOf(want) >= 0)
      || null;
}
async function goMission() {
  const m = S.modal; if (!m) return;
  const c = findCampaign(m.nodeId, m.campId); if (!c) return;
  const b = bridge();
  const mis = resolveMission(c);
  if (!mis) {
    close();
    b.toast(`🗺 "${c.missionName || c.name}" is not on the mission map yet — opening the map.`, 4600);
    nc().goMissions(); return;
  }
  if (!mis.hasMap) {
    close();
    b.toast(`🗺 "${mis.name}" has no map yet — opening the mission list.`, 4600);
    nc().goMissions(); return;
  }
  const run = nc().missionRun();
  if (run && run.campaignId === mis.id && !run.isComplete && !run.isFailed) { close(); nc().missionResume(); return; }
  if (run && run.campaignId !== mis.id && !run.isComplete && !run.isFailed) {
    close();
    b.toast('🗺 You have another run in progress — finish or abandon it from the mission map first.', 5200);
    nc().goMissions(); return;
  }
  close();
  nc().missionStart(mis.id);
}

/* ── events: ONE delegated listener, survives every drawer re-render ────── */
function onClick(e) {
  const el = e.target && e.target.closest && e.target.closest('[data-nc-act]');
  if (!el) return;
  const act = el.dataset.ncAct;
  const m = S.modal;
  try {
    switch (act) {
      case 'open':        e.preventDefault(); open(el.dataset.ncNode, el.dataset.ncCamp); break;
      case 'close':       close(); break;
      case 'pick': {
        if (!m) break;
        const c = findCampaign(m.nodeId, el.dataset.ncCamp); if (!c) break;
        if (c.kind === 'assault') { close(); nc().attack(m.nodeId); break; }
        m.campId = c.id; m.step = 'detail'; m.flash = ''; ensureBoard(m.nodeId, c.id); paintModal(); break;
      }
      case 'back-pick':   if (m) { m.step = 'pick'; m.flash = ''; paintModal(); } break;
      case 'back-detail': if (m) { m.step = 'detail'; paintModal(); } break;
      case 'to-give':     if (m) { m.step = 'give'; m.flash = ''; paintModal(); } break;
      case 'res':         if (m) { m.res = el.dataset.ncRes; m.amount = ''; paintModal(); } break;
      case 'amt':         if (m) { m.amount = el.dataset.ncAmt; paintModal(); } break;
      case 'give':        doGive(); break;
      case 'mission':     goMission(); break;
      case 'admin-new':   S.edit = { nodeId: el.dataset.ncNode, camp: { _new: true, nodeId: el.dataset.ncNode, name: '', icon: '🤝', goals: {}, airdropMtPerMillion: 1, active: true } }; bridge().render(); break;
      case 'admin-edit': { const c = findCampaign(el.dataset.ncNode, el.dataset.ncCamp); if (c) { S.edit = { nodeId: el.dataset.ncNode, camp: Object.assign({}, c) }; bridge().render(); } break; }
      case 'admin-cancel': S.edit = null; bridge().render(); break;
      case 'admin-save':  adminSave(el.dataset.ncNode); break;
      case 'admin-off': {
        (async () => {
          if (!await bridge().confirm('Deactivate this campaign? Players will no longer see it; the ledger is kept.')) return;
          const r = await api.deactivateCampaign(el.dataset.ncCamp);
          bridge().toast(r.ok ? 'Campaign deactivated.' : '⚠ ' + (r.error || 'failed'));
          S.edit = null; ensureRows(el.dataset.ncNode, true); bridge().render();
        })();
        break;
      }
      default: break;
    }
  } catch (err) { try { console.warn('[campaigns] action failed:', act, err); } catch (e2) {} }
}
function onInput(e) {
  const el = e.target;
  if (!el || el.dataset.ncInput !== 'amount' || !S.modal) return;
  S.modal.amount = el.value;
  // Re-enable / relabel the Give button without repainting the input under the cursor.
  const btn = document.querySelector('#nc-overlay [data-nc-act="give"]');
  if (!btn) return;
  const c = findCampaign(S.modal.nodeId, S.modal.campId); if (!c) return;
  const amt = Math.floor(Number(el.value) || 0);
  const have = holdings(S.modal.res);
  const b = boardOf(c.id); const totals = (b && b.totals) || {};
  const remain = Math.max(0, (Number(c.goals[S.modal.res]) || 0) - (Number(totals[S.modal.res]) || 0));
  const miss = S.boards[c.id] && S.boards[c.id].missing;
  btn.disabled = !(bridge().signedIn() && !miss && amt > 0 && amt <= have && remain > 0 && !S.busy);
  btn.textContent = `🎁 Give ${amt > 0 ? fmtBig(amt) : ''} ${resMeta(S.modal.res).name}`;
}
function onKey(e) { if (e.key === 'Escape' && S.modal) close(); }

function warnOnce() {
  if (S.warned) return; S.warned = true;
  try { console.warn('[campaigns] window.MythicBridge.nodeCampaigns missing — module inert. See CLAUDE.md (the globals trap).'); } catch (e) {}
}

/* ── styles (scoped nc-*, injected once) ────────────────────────────────── */
const CSS = `
.nc-tab{padding-bottom:.6rem}
.nc-card{margin:0 1rem .7rem;background:rgba(22,28,35,.55);border:1px solid rgba(216,178,74,.28);padding:.7rem .85rem;position:relative}
.nc-card.nc-kind-assault{border-color:rgba(184,78,44,.4)}
.nc-card-head{display:flex;align-items:center;gap:.6rem}
.nc-card-icon{font-size:1.5rem;flex:0 0 auto}
.nc-card-title{flex:1;min-width:0}
.nc-card-name{font-weight:800;color:#f3e6c2;font-size:.95rem;letter-spacing:.02em}
.nc-card-tag{font-size:.66rem;color:#8a96a3;margin-top:2px}
.nc-btn{cursor:pointer;border-radius:6px;padding:.42rem .8rem;border:1px solid rgba(216,178,74,.45);background:rgba(40,32,18,.55);color:#f3e6c2;font-weight:800;font-size:.72rem;letter-spacing:.06em;white-space:nowrap}
.nc-btn:hover{background:rgba(216,178,74,.18)}
.nc-btn:disabled{opacity:.45;cursor:not-allowed}
.nc-btn-gold{background:linear-gradient(180deg,#f0cf6a,#c9a227);color:#1a1408;border-color:#f6dd8a;text-shadow:0 1px 0 rgba(255,255,255,.3)}
.nc-btn-gold:hover{background:linear-gradient(180deg,#f6dd8a,#d4ad2e)}
.nc-btn-big{font-size:.9rem;padding:.6rem 1.1rem}
.nc-btn-danger{border-color:rgba(226,72,66,.5);color:#ffb0aa}
.nc-dim{color:#7c8a99;font-weight:400}
.nc-empty{font-family:'JetBrains Mono','Consolas',monospace;font-size:.62rem;color:#5b6772;padding:.5rem 1rem;font-style:italic}
.nc-goals{display:flex;flex-direction:column;gap:.45rem;margin-top:.6rem}
.nc-goal-top{display:flex;justify-content:space-between;font-size:.7rem;font-weight:700}
.nc-goal-num{color:#e8e0cc;font-family:'JetBrains Mono','Consolas',monospace}
.nc-bar{height:7px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);margin-top:3px;overflow:hidden}
.nc-bar-fill{height:100%;transition:width .5s ease}
.nc-goal-mine{font-size:.6rem;color:#9fb4d8;margin-top:2px;text-align:right}
.nc-lb{margin-top:.65rem;border-top:1px dashed rgba(216,178,74,.2);padding-top:.5rem}
.nc-lb-hdr{display:flex;justify-content:space-between;font-family:'JetBrains Mono','Consolas',monospace;font-size:.64rem;letter-spacing:.14em;color:#d8b24a;font-weight:800;margin-bottom:.3rem}
.nc-lb-row{display:flex;align-items:center;gap:.5rem;font-size:.72rem;padding:.2rem .3rem;border-left:2px solid rgba(255,255,255,.08)}
.nc-lb-row.is-me{background:rgba(216,178,74,.1);border-left-color:#d8b24a}
.nc-lb-rank{width:1.4rem;color:#d8b24a;font-weight:800;font-family:'JetBrains Mono','Consolas',monospace}
.nc-lb-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e8e0cc}
.nc-lb-total{font-family:'JetBrains Mono','Consolas',monospace;color:#9ad17a}
.nc-lb-me{margin-top:.4rem;font-size:.66rem;color:#cfd6e4}
.nc-admin{margin-top:.4rem;border-top:1px solid rgba(35,44,54,.6)}
.nc-admin-row{display:flex;flex-wrap:wrap;gap:.4rem;padding:.3rem 1rem .6rem}
.nc-f{padding:.25rem 1rem}
.nc-f label{display:block;font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:#7c8a99;margin-bottom:2px}
.nc-f input,.nc-f textarea,.nc-f select{width:100%;box-sizing:border-box;background:#0f1319;border:1px solid rgba(216,178,74,.3);color:#f3e6c2;padding:.35rem .5rem;font-size:.8rem;border-radius:4px}
.nc-f-2{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.nc-f-goals{display:grid;grid-template-columns:1fr 1fr;gap:.4rem}
.nc-f-goals span{display:block;font-size:.66rem;color:#cfd6e4;margin-bottom:2px}
.nc-overlay{position:fixed;inset:0;z-index:10050;background:rgba(4,6,10,.78);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto}
.nc-modal{position:relative;width:min(560px,100%);max-height:min(92vh,900px);overflow:auto;background:linear-gradient(180deg,#141821,#0c0f15);border:1px solid rgba(216,178,74,.5);box-shadow:0 20px 60px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.6);color:#e8e0cc;font-family:inherit}
.nc-modal-bar{display:flex;justify-content:space-between;align-items:center;padding:.5rem .9rem;border-bottom:1px solid rgba(216,178,74,.25);background:rgba(216,178,74,.06)}
.nc-modal-crumb{font-family:'JetBrains Mono','Consolas',monospace;font-size:.64rem;letter-spacing:.2em;color:#d8b24a;font-weight:800}
.nc-x{background:none;border:1px solid rgba(255,255,255,.2);color:#cfd6e4;width:26px;height:26px;border-radius:4px;cursor:pointer}
.nc-modal-body{padding:1rem 1.1rem 1.1rem}
.nc-h1{font-size:1.35rem;font-weight:900;color:#f3e6c2;letter-spacing:.02em;line-height:1.15}
.nc-sub{font-size:.74rem;color:#8a96a3;margin-top:2px;margin-bottom:.7rem}
.nc-desc{font-size:.8rem;line-height:1.5;color:#cfd6e4;margin:.2rem 0 .6rem}
.nc-flash{background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.4);color:#c8f0c4;padding:.45rem .7rem;font-size:.74rem;margin-bottom:.7rem;font-weight:700}
.nc-pick{display:flex;align-items:center;gap:.7rem;width:100%;text-align:left;cursor:pointer;background:rgba(22,28,35,.6);border:1px solid rgba(216,178,74,.3);padding:.7rem .8rem;margin-bottom:.5rem;color:#e8e0cc}
.nc-pick:hover{border-color:#d8b24a;background:rgba(216,178,74,.1)}
.nc-pick-icon{font-size:1.6rem}
.nc-pick-text{flex:1;min-width:0;display:flex;flex-direction:column}
.nc-pick-text b{font-size:.95rem;color:#f3e6c2}
.nc-pick-text small{font-size:.66rem;color:#8a96a3}
.nc-pick-go{color:#d8b24a;font-size:1.2rem}
.nc-doors{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin:.9rem 0 .4rem}
@media (max-width:480px){.nc-doors{grid-template-columns:1fr}}
.nc-door{display:flex;flex-direction:column;align-items:flex-start;gap:.25rem;text-align:left;cursor:pointer;padding:.85rem .9rem;border-radius:6px;color:#1a1408;border:1px solid transparent}
.nc-door-give{background:linear-gradient(180deg,#f0cf6a,#c9a227);border-color:#f6dd8a}
.nc-door-mission{background:linear-gradient(180deg,#2a2440,#171426);color:#e8e0ff;border-color:rgba(184,136,255,.5)}
.nc-door:hover{filter:brightness(1.08)}
.nc-door-icon{font-size:1.5rem}
.nc-door-title{font-weight:900;font-size:1rem;letter-spacing:.02em}
.nc-door-sub{font-size:.64rem;opacity:.85;line-height:1.35}
.nc-modal-foot{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-top:.9rem;flex-wrap:wrap}
.nc-res-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.5rem;margin:.4rem 0 .8rem}
.nc-res{display:flex;flex-direction:column;align-items:flex-start;gap:1px;cursor:pointer;text-align:left;background:rgba(22,28,35,.6);border:1px solid rgba(255,255,255,.12);padding:.55rem .65rem;color:#e8e0cc;border-radius:5px}
.nc-res.is-on{border-color:var(--c);box-shadow:inset 0 0 0 1px var(--c),0 0 12px rgba(0,0,0,.4);background:rgba(255,255,255,.04)}
.nc-res-icon{font-size:1.3rem}
.nc-res-name{font-weight:800;font-size:.82rem;color:var(--c)}
.nc-res-have{font-size:.62rem;color:#cfd6e4}
.nc-res-left{font-size:.6rem;color:#8a96a3}
.nc-amount-label{display:block;font-size:.7rem;font-weight:700;color:#e8e0cc;margin-bottom:4px}
.nc-amount{width:100%;box-sizing:border-box;background:#0f1319;border:1px solid rgba(216,178,74,.45);color:#f3e6c2;padding:.55rem .7rem;font-size:1.2rem;font-family:'JetBrains Mono','Consolas',monospace;border-radius:4px}
.nc-chips{display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap}
.nc-chip{cursor:pointer;background:rgba(216,178,74,.12);border:1px solid rgba(216,178,74,.35);color:#f3e6c2;padding:.25rem .6rem;font-size:.68rem;font-weight:800;border-radius:999px}
.nc-chip:disabled{opacity:.4;cursor:not-allowed}
.nc-warn{margin-top:.4rem;font-size:.68rem;color:#ffb0aa}
`;

/* ── register ───────────────────────────────────────────────────────────── */
try {
  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  window.MythicNodeCampaigns = {
    open, close, renderTab, listForNode,
    refresh: (nodeId) => { try { ensureRows(nodeId, true); listForNode(nodeId).forEach((c) => ensureBoard(nodeId, c.id, true)); } catch (e) {} },
    _state: S,
  };
  if (!bridgeReady()) warnOnce();
} catch (e) { try { console.warn('[campaigns] register failed:', e); } catch (e2) {} }
