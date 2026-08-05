/* ═══════════════════════════════════════════════════════════════════════════
   community.render.js — the UI. One full-screen overlay, four tabs.

   Styling is injected by this module rather than added to index.html, so the
   feature owns its own chrome and the legacy stylesheet is untouched.
   Text only — no image or video surface anywhere, deliberately (see CLAUDE.md).
   ═══════════════════════════════════════════════════════════════════════════ */

import { Community, loadDirectory, loadCommunity, standings, myMembershipFor, api } from './community.state.js';
import { bridge, esc, fmtNum, fmtDate } from './community.bridge.js';
import * as roles from './community.roles.js';

const OV = 'mythic-community-ov';
let view = 'directory';     // 'directory' | 'community'
let tab = 'standings';      // 'standings' | 'members' | 'corps' | 'ledger'
let openId = null;
let busy = false;

/* ── chrome ──────────────────────────────────────────────────────────────── */
function injectStyle() {
  if (document.getElementById('mc-style')) return;
  const s = document.createElement('style');
  s.id = 'mc-style';
  s.textContent = `
  #${OV}{position:fixed;inset:0;z-index:2147483200;background:rgba(6,5,12,.86);backdrop-filter:blur(5px);
    display:flex;align-items:center;justify-content:center;padding:2vh 2vw;font-family:'Crimson Text',Georgia,serif}
  #${OV} .mc{width:min(1040px,97vw);max-height:95vh;display:flex;flex-direction:column;
    background:linear-gradient(180deg,#161122,#0b0813);border:1.5px solid rgba(210,164,78,.55);
    border-radius:14px;box-shadow:0 26px 74px rgba(0,0,0,.78);overflow:hidden}
  #${OV} .mc-hd{display:flex;align-items:center;gap:.7rem;padding:14px 18px;border-bottom:1px solid rgba(210,164,78,.28)}
  #${OV} .mc-hd h2{font-family:'Cinzel',serif;font-weight:900;color:#f6dc95;font-size:1.06rem;letter-spacing:.06em;margin:0}
  #${OV} .mc-hd .sp{flex:1}
  #${OV} .mc-x{background:none;border:1px solid rgba(210,164,78,.5);color:#e2c37a;border-radius:8px;
    width:32px;height:32px;cursor:pointer;font-size:1rem}
  #${OV} .mc-x:hover{border-color:#f6dc95;color:#f6dc95}
  #${OV} .mc-body{flex:1;overflow-y:auto;padding:14px 18px 18px}
  #${OV} .mc-tabs{display:flex;gap:6px;padding:10px 18px 0;flex-wrap:wrap}
  #${OV} .mc-tab{background:rgba(255,255,255,.04);border:1px solid rgba(210,164,78,.3);
    color:#cbb890;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:.82rem;font-family:'Cinzel',serif;letter-spacing:.05em}
  #${OV} .mc-tab.on{background:linear-gradient(180deg,rgba(212,175,55,.22),rgba(0,0,0,.25));border-color:#f0cf7a;color:#f6dc95}
  #${OV} .mc-note{border:1px solid rgba(210,164,78,.35);background:rgba(212,175,55,.07);border-radius:9px;
    padding:10px 12px;color:#d8c79b;font-size:.86rem;line-height:1.55;margin-bottom:12px}
  #${OV} .mc-note.bad{border-color:rgba(220,90,70,.5);background:rgba(220,90,70,.09);color:#f0b3a6}
  #${OV} .mc-card{border:1px solid rgba(210,164,78,.28);background:rgba(255,255,255,.028);border-radius:10px;
    padding:12px 14px;margin-bottom:10px}
  #${OV} .mc-card h3{font-family:'Cinzel',serif;color:#e9cf8c;font-size:.86rem;letter-spacing:.1em;
    text-transform:uppercase;margin:0 0 8px}
  #${OV} .mc-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid rgba(210,164,78,.16)}
  #${OV} .mc-row:first-of-type{border-top:none}
  #${OV} .mc-row .nm{flex:1;min-width:0;color:#efe3c4;font-size:.92rem;overflow:hidden;text-overflow:ellipsis}
  #${OV} .mc-row .sub{display:block;color:#9b9078;font-size:.76rem}
  #${OV} .mc-row .val{color:#f0cf7a;font-variant-numeric:tabular-nums;font-size:.9rem;white-space:nowrap}
  #${OV} .mc-b{background:rgba(212,175,55,.14);border:1px solid rgba(210,164,78,.5);color:#f2dca2;
    border-radius:7px;padding:4px 10px;cursor:pointer;font-size:.78rem;font-family:'Cinzel',serif;white-space:nowrap}
  #${OV} .mc-b:hover{background:rgba(212,175,55,.26)}
  #${OV} .mc-b[disabled]{opacity:.45;cursor:default}
  #${OV} .mc-b.danger{border-color:rgba(220,90,70,.5);color:#ff9f8a;background:rgba(220,90,70,.1)}
  #${OV} .mc-pill{border:1px solid rgba(210,164,78,.4);border-radius:999px;padding:1px 8px;font-size:.7rem;
    color:#cbb890;letter-spacing:.06em;text-transform:uppercase}
  #${OV} .mc-pill.on{border-color:#7fd8a4;color:#7fd8a4}
  #${OV} .mc-pill.pend{border-color:#e0b45a;color:#e0b45a}
  #${OV} input,#${OV} select,#${OV} textarea{background:rgba(10,8,18,.9);border:1px solid rgba(210,164,78,.35);
    color:#e9dab2;border-radius:7px;padding:7px 10px;font-family:inherit;font-size:.88rem;width:100%}
  #${OV} input:focus,#${OV} select:focus,#${OV} textarea:focus{outline:none;border-color:#f6dc95}
  #${OV} .mc-form{display:grid;gap:8px;margin-top:8px}
  #${OV} .mc-empty{color:#8d8370;font-size:.86rem;padding:8px 0}
  #${OV} .mc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
  `;
  document.head.appendChild(s);
}

function shell(title, bodyHtml, tabsHtml) {
  return `<div class="mc">
    <div class="mc-hd">
      <h2>${title}</h2><span class="sp"></span>
      <button class="mc-x" data-mc="close" title="Close">✕</button>
    </div>
    ${tabsHtml || ''}
    <div class="mc-body">${bodyHtml}</div>
  </div>`;
}

function banner() {
  if (Community.offline) return `<div class="mc-note">☁ Sign in to see communities. You can still browse the rest of the game.</div>`;
  if (Community.missing) return `<div class="mc-note bad">🗄 The Community tables are not set up yet. Run <b>sql/001_community_core.sql</b>, <b>002</b> and <b>003</b> in the Supabase editor, then reopen this. Nothing else in the game is affected.</div>`;
  if (Community.error) return `<div class="mc-note bad">⚠ ${esc(Community.error)}</div>`;
  return '';
}

/* ── directory ───────────────────────────────────────────────────────────── */
function directoryHtml() {
  const b = bridge();
  const rows = Community.list.map((c) => {
    const mine = myMembershipFor(c.id);
    const state = mine ? (mine.status === 'active' ? `<span class="mc-pill on">${esc(roles.ROLE_LABEL[mine.role] || 'Member')}</span>`
                         : `<span class="mc-pill pend">${esc(mine.status)}</span>`) : '';
    const canJoin = !mine || ['rejected', 'left'].includes(mine.status);
    return `<div class="mc-card">
      <div class="mc-row">
        <span class="nm"><b>[${esc(c.tag)}]</b> ${esc(c.name)} ${state}
          <span class="sub">${esc(c.description || 'No description.')}</span></span>
      </div>
      <div class="mc-row">
        <span class="nm sub">Joining: ${esc(c.join_policy)}</span>
        <button class="mc-b" data-mc="open" data-id="${esc(c.id)}">View</button>
        ${c.join_policy !== 'closed' && canJoin ? `<button class="mc-b" data-mc="apply" data-id="${esc(c.id)}">${c.join_policy === 'open' ? 'Join' : 'Apply'}</button>` : ''}
      </div></div>`;
  }).join('');

  return banner() + `
    <div class="mc-note">Communities sit <b>above</b> corporations. A corporation holds ground; a community holds corporations together — shared standings, a contribution record, and one place to see who is actually winning.</div>
    ${rows || '<div class="mc-empty">No communities yet. Found the first one.</div>'}
    <div class="mc-card">
      <h3>Found a community</h3>
      <div class="mc-form">
        <input id="mc-name" maxlength="48" placeholder="Name — e.g. The Ashfall Compact">
        <input id="mc-tag" maxlength="8" placeholder="Tag — up to 8 characters, e.g. ASH">
        <textarea id="mc-desc" maxlength="400" rows="2" placeholder="What is this community for?"></textarea>
        <select id="mc-policy">
          <option value="apply">Applications reviewed by leadership</option>
          <option value="open">Open — anyone may join instantly</option>
          <option value="closed">Closed — invite only</option>
        </select>
        <button class="mc-b" data-mc="create" ${b.signedIn() ? '' : 'disabled'}>Found it</button>
      </div>
    </div>`;
}

/* ── community ───────────────────────────────────────────────────────────── */
function tabsHtml() {
  const t = (k, label) => `<button class="mc-tab ${tab === k ? 'on' : ''}" data-mc="tab" data-tab="${k}">${label}</button>`;
  return `<div class="mc-tabs">${t('standings', 'Standings')}${t('members', 'Members')}${t('corps', 'Corporations')}${t('ledger', 'Contributions')}</div>`;
}

function standingsHtml() {
  const s = standings();
  const c = Community.current;
  const corpRows = s.corps.map((r) => `<div class="mc-row">
      <span class="nm"><b>[${esc(r.tag)}]</b> ${esc(r.name)}<span class="sub">Affiliated ${fmtDate(r.since)}</span></span>
      <span class="val">🗺 ${r.territory ? r.territory + '%' : '—'}</span>
      <span class="val">🏦 ${r.treasury ? fmtNum(r.treasury) : '—'}</span>
    </div>`).join('');

  const top = s.contributors.slice(0, 8).map((x, i) => `<div class="mc-row">
      <span class="nm">${i + 1}. ${esc(x.name)}</span>
      <span class="val">🔥 ${fmtNum(x.amount)}</span></div>`).join('');

  return `
    <div class="mc-card"><h3>${esc(c ? c.name : 'Community')}</h3>
      <div class="mc-row"><span class="nm">Members</span><span class="val">${s.activeMembers}${s.pendingMembers ? ` <span class="mc-pill pend">${s.pendingMembers} pending</span>` : ''}</span></div>
      <div class="mc-row"><span class="nm">Affiliated corporations</span><span class="val">${s.corps.length}${s.pendingCorps ? ` <span class="mc-pill pend">${s.pendingCorps} pending</span>` : ''}</span></div>
      <div class="mc-row"><span class="nm">Total contributed</span><span class="val">🔥 ${fmtNum(s.contributed)}</span></div>
    </div>
    <div class="mc-card"><h3>Corporations</h3>
      ${corpRows || '<div class="mc-empty">No corporations have affiliated yet.</div>'}
      ${s.partial ? '<div class="mc-note" style="margin:10px 0 0">Territory and treasury are read from your own view of the world, so a corporation you have no visibility into shows “—” rather than a number this client cannot honestly claim to know.</div>' : ''}
    </div>
    <div class="mc-card"><h3>Top contributors</h3>
      ${top || '<div class="mc-empty">Nothing contributed yet.</div>'}
    </div>`;
}

function membersHtml() {
  const c = Community.current;
  const lead = roles.isLeadership(c, Community.members);
  const rows = Community.members
    .slice()
    .sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0))
    .map((m) => {
      const isOwnerRow = c && m.user_id === c.owner_id;
      const canManage = roles.canManageMember(c, Community.members, m.user_id) && !isOwnerRow;
      const acts = [];
      if (lead && m.status === 'pending') {
        acts.push(`<button class="mc-b" data-mc="mem" data-u="${esc(m.user_id)}" data-status="active">Approve</button>`);
        acts.push(`<button class="mc-b danger" data-mc="mem" data-u="${esc(m.user_id)}" data-status="rejected">Reject</button>`);
      } else if (canManage && m.status === 'active') {
        if (m.role === 'member') acts.push(`<button class="mc-b" data-mc="mem" data-u="${esc(m.user_id)}" data-role="officer">Make officer</button>`);
        if (m.role === 'officer' && roles.isOwner(c)) acts.push(`<button class="mc-b" data-mc="mem" data-u="${esc(m.user_id)}" data-role="leader">Make leader</button>`);
        if (m.role !== 'member') acts.push(`<button class="mc-b" data-mc="mem" data-u="${esc(m.user_id)}" data-role="member">Demote</button>`);
        acts.push(`<button class="mc-b danger" data-mc="mem" data-u="${esc(m.user_id)}" data-status="banned">Ban</button>`);
      }
      const badge = isOwnerRow ? '<span class="mc-pill on">Owner</span>'
        : m.status === 'active' ? `<span class="mc-pill">${esc(roles.ROLE_LABEL[m.role] || 'Member')}</span>`
        : `<span class="mc-pill pend">${esc(m.status)}</span>`;
      return `<div class="mc-row"><span class="nm">${esc(m.user_name || 'Survivor')} ${badge}
        <span class="sub">Joined ${fmtDate(m.joined_at)}</span></span>${acts.join(' ')}</div>`;
    }).join('');

  const mine = roles.myMembership(Community.members);
  const leaveBtn = (mine && mine.status === 'active' && !roles.isOwner(c))
    ? `<div class="mc-row"><span class="nm sub">You are a member of this community.</span>
       <button class="mc-b danger" data-mc="leave">Leave</button></div>` : '';

  return `<div class="mc-card"><h3>Roster</h3>${rows || '<div class="mc-empty">No members yet.</div>'}${leaveBtn}</div>
    ${roles.canViewAudit(c, Community.members) ? auditHtml() : ''}`;
}

function auditHtml() {
  const rows = Community.audit.map((a) => `<div class="mc-row">
      <span class="nm">${esc(a.action)}<span class="sub">${esc(a.actor_name || '—')}${a.target ? ' → ' + esc(a.target) : ''}</span></span>
      <span class="val sub">${fmtDate(a.created_at)}</span></div>`).join('');
  return `<div class="mc-card"><h3>Audit log <span class="mc-pill">leadership</span></h3>
    ${rows || '<div class="mc-empty">Nothing logged yet.</div>'}</div>`;
}

function corpsHtml() {
  const b = bridge();
  const c = Community.current;
  const lead = roles.canApproveCorps(c, Community.members);
  const rows = Community.corps.map((link) => {
    const meta = Community.corpMeta[link.corp_id] || {};
    const acts = [];
    if (lead && link.status === 'pending') {
      acts.push(`<button class="mc-b" data-mc="corp" data-c="${esc(link.corp_id)}" data-status="active">Approve</button>`);
      acts.push(`<button class="mc-b danger" data-mc="corp" data-c="${esc(link.corp_id)}" data-status="rejected">Reject</button>`);
    } else if (lead && link.status === 'active') {
      acts.push(`<button class="mc-b danger" data-mc="corp" data-c="${esc(link.corp_id)}" data-status="left">Remove</button>`);
    }
    const pill = link.status === 'active' ? '<span class="mc-pill on">Affiliated</span>'
      : `<span class="mc-pill pend">${esc(link.status)}</span>`;
    return `<div class="mc-row"><span class="nm"><b>[${esc(meta.tag || '—')}]</b> ${esc(meta.name || 'Corporation')} ${pill}
      <span class="sub">${esc(meta.faction || 'Unaligned')}</span></span>${acts.join(' ')}</div>`;
  }).join('');

  const myCorp = b.myCorp();
  const canAff = roles.canAffiliateMyCorp(Community.corps);
  const affiliateBox = myCorp
    ? (canAff
        ? `<div class="mc-row"><span class="nm">Affiliate <b>[${esc(myCorp.tag || '')}]</b> ${esc(myCorp.name || '')} with this community.<span class="sub">You are its founder, so you may sign it in. Leadership here approves.</span></span>
           <button class="mc-b" data-mc="affiliate">Apply to affiliate</button></div>`
        : `<div class="mc-row"><span class="nm sub">${b.amCorpFounder() ? 'Your corporation has already applied or is affiliated — a corporation can belong to one community at a time.' : 'Only the founder of a corporation can affiliate it.'}</span></div>`)
    : `<div class="mc-row"><span class="nm sub">You are not in a corporation. Found or join one in Just Business, then affiliate it here.</span></div>`;

  return `<div class="mc-card"><h3>Affiliated corporations</h3>
      ${rows || '<div class="mc-empty">No corporations yet.</div>'}</div>
    <div class="mc-card"><h3>Your corporation</h3>${affiliateBox}</div>`;
}

function ledgerHtml() {
  const c = Community.current;
  const member = roles.isActiveMember(c, Community.members);
  const rows = Community.ledger.slice(0, 60).map((e) => `<div class="mc-row">
      <span class="nm">${esc(e.user_name || 'Survivor')}<span class="sub">${esc(e.note || e.kind)} · ${fmtDate(e.created_at)}</span></span>
      <span class="val">🔥 ${fmtNum(e.amount)}</span></div>`).join('');
  return `
    <div class="mc-card"><h3>Contribute</h3>
      ${member ? `<div class="mc-note">Contributing spends your Cinder and records it permanently against your name. The ledger is append-only — entries can never be edited or removed, by anyone.</div>
      <div class="mc-form">
        <input id="mc-amt" type="number" min="1" step="1" placeholder="Amount of 🔥 Cinder">
        <input id="mc-note" maxlength="120" placeholder="Note (optional)">
        <button class="mc-b" data-mc="contribute">Contribute</button>
      </div>` : '<div class="mc-empty">Join this community to contribute.</div>'}
    </div>
    <div class="mc-card"><h3>Ledger</h3>${rows || '<div class="mc-empty">Nothing contributed yet.</div>'}</div>`;
}

function communityHtml() {
  const c = Community.current;
  if (!c) return banner() + '<div class="mc-empty">Community not found.</div>';
  const body = tab === 'members' ? membersHtml()
             : tab === 'corps' ? corpsHtml()
             : tab === 'ledger' ? ledgerHtml()
             : standingsHtml();
  return banner() + body;
}

/* ── paint + events ──────────────────────────────────────────────────────── */
export function paint() {
  const ov = document.getElementById(OV); if (!ov) return;
  if (view === 'directory') {
    ov.innerHTML = shell('🏛 Communities', Community.loading ? '<div class="mc-empty">Loading…</div>' : directoryHtml(), '');
  } else {
    const c = Community.current;
    const title = c ? `🏛 [${esc(c.tag)}] ${esc(c.name)}` : '🏛 Community';
    ov.innerHTML = shell(title + ' <button class="mc-b" data-mc="back" style="margin-left:10px">← All</button>',
      Community.loading ? '<div class="mc-empty">Loading…</div>' : communityHtml(), tabsHtml());
  }
}

async function refreshDirectory() { await loadDirectory(); paint(); }
async function refreshCommunity() { if (openId) { await loadCommunity(openId); paint(); } }

async function onClick(ev) {
  const el = ev.target.closest('[data-mc]'); if (!el || busy) return;
  const b = bridge();
  const act = el.dataset.mc;

  if (act === 'close') { close(); return; }
  if (act === 'back') { view = 'directory'; openId = null; paint(); refreshDirectory(); return; }
  if (act === 'tab') { tab = el.dataset.tab; paint(); return; }
  if (act === 'open') { openId = el.dataset.id; view = 'community'; tab = 'standings'; paint(); await refreshCommunity(); return; }

  busy = true;
  try {
    if (act === 'create') {
      const name = (document.getElementById('mc-name') || {}).value || '';
      const tag = (document.getElementById('mc-tag') || {}).value || '';
      if (!name.trim() || !tag.trim()) { b.toast('A community needs a name and a tag.'); return; }
      const r = await api.createCommunity({
        name, tag,
        description: (document.getElementById('mc-desc') || {}).value || '',
        joinPolicy: (document.getElementById('mc-policy') || {}).value || 'apply',
      });
      if (!r.ok) { b.toast(r.missing ? '🗄 Run the Community SQL first.' : '⚠ Could not found it: ' + (r.error || '')); return; }
      b.toast('🏛 ' + name.trim() + ' founded.');
      await refreshDirectory();
      return;
    }

    if (act === 'apply') {
      const r = await api.applyToCommunity(el.dataset.id);
      if (!r.ok) { b.toast(r.missing ? '🗄 Run the Community SQL first.' : '⚠ ' + (r.error || 'Could not apply.')); return; }
      b.toast(r.status === 'active' ? '🏛 You are in.' : '📨 Application sent — leadership will review it.');
      await refreshDirectory();
      return;
    }

    if (act === 'mem') {
      const r = await api.setMember(openId, el.dataset.u, el.dataset.role || null, el.dataset.status || null);
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not update that member.')); return; }
      await api.logAction(openId, 'member ' + (el.dataset.role ? 'role → ' + el.dataset.role : el.dataset.status), el.dataset.u);
      await refreshCommunity();
      return;
    }

    if (act === 'leave') {
      if (!(await b.confirm('Leave this community? Your contribution record stays — it is history, not a balance.'))) return;
      const r = await api.leaveCommunity(openId);
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not leave.')); return; }
      b.toast('You have left the community.');
      view = 'directory'; openId = null;
      await refreshDirectory();
      return;
    }

    if (act === 'affiliate') {
      const corp = b.myCorp();
      if (!corp || !corp.id) { b.toast('You are not in a corporation.'); return; }
      const r = await api.affiliateCorp(openId, corp.id);
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not apply to affiliate.')); return; }
      b.toast('📨 Affiliation requested — this community’s leadership will review it.');
      await refreshCommunity();
      return;
    }

    if (act === 'corp') {
      const r = await api.setCorpStatus(openId, el.dataset.c, el.dataset.status);
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not update that corporation.')); return; }
      await api.logAction(openId, 'corp → ' + el.dataset.status, el.dataset.c);
      await refreshCommunity();
      return;
    }

    if (act === 'contribute') {
      const amt = Math.floor(Number((document.getElementById('mc-amt') || {}).value) || 0);
      const note = (document.getElementById('mc-note') || {}).value || '';
      if (!(amt > 0)) { b.toast('Enter an amount.'); return; }
      if (b.gems() < amt) { b.toast('You have ' + fmtNum(b.gems()) + ' 🔥.'); return; }
      if (!(await b.confirm('Contribute ' + amt.toLocaleString() + ' 🔥 to this community?\n\nThis is recorded permanently against your name and cannot be withdrawn.'))) return;
      // ⚠ Spend FIRST, then record — and refund if the record fails. Same order
      //   and same refund as corpTreasuryDeposit(); a contribution that is not
      //   written must not have cost anything.
      if (!b.spendGems(amt)) { b.toast('Not enough Cinder.'); return; }
      try { b.saveProfile(); } catch (e) {}
      const r = await api.addContribution(openId, amt, note);
      if (!r.ok) {
        b.addGems(amt); try { b.saveProfile(); } catch (e) {}
        b.toast('⚠ Contribution failed — refunded. ' + (r.missing ? 'Run the Community SQL first.' : (r.error || '')));
        return;
      }
      b.toast('🔥 Contributed ' + amt.toLocaleString() + ' to the community.');
      try { b.render(); } catch (e) {}
      await refreshCommunity();
      return;
    }
  } finally { busy = false; }
}

/* ── open / close ────────────────────────────────────────────────────────── */
export function open() {
  injectStyle();
  let ov = document.getElementById(OV);
  if (!ov) {
    ov = document.createElement('div');
    ov.id = OV;
    // Click-outside closes, matching every other overlay in the game.
    ov.addEventListener('click', (ev) => { if (ev.target === ov) close(); });
    ov.addEventListener('click', onClick);
    document.body.appendChild(ov);
  }
  view = 'directory'; openId = null; tab = 'standings';
  paint();
  refreshDirectory();
}

export function close() {
  const ov = document.getElementById(OV);
  if (ov) ov.remove();
}
