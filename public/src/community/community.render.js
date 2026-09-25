/* ═══════════════════════════════════════════════════════════════════════════
   community.render.js — the UI. One full-screen overlay, four tabs.

   Styling is injected by this module rather than added to index.html, so the
   feature owns its own chrome and the legacy stylesheet is untouched.
   Text only — no image or video surface anywhere, deliberately (see CLAUDE.md).
   ═══════════════════════════════════════════════════════════════════════════ */

import { Community, loadDirectory, loadCommunity, standings, myMembershipFor, api,
         tally, objectives, pot, myUnclaimedRewards } from './community.state.js';
import { bridge, esc, fmtNum, fmtDate } from './community.bridge.js';
import * as roles from './community.roles.js';
import { subscribeWire, subscribeCommunity, unsubscribeAll, sendTyping,
         notifyState, askNotifyPermission, pushSubscribe } from './community.realtime.js';

const OV = 'mythic-community-ov';
let view = 'directory';     // 'directory' | 'community'
let tab = 'standings';      // 'standings' | 'members' | 'corps' | 'ledger'
let openId = null;
let busy = false;
let typingNames = [];       // who is currently typing on the wire

/* Live wiring for the community currently open. Re-subscribing is cheap
   (the realtime module keys channels and returns the existing one), so this is
   safe to call on every load. */
function wireUp() {
  const b = bridge();
  const c = Community.current;
  if (!c) return;
  const corp = b.myCorp();
  if (corp && corp.id) {
    subscribeWire(corp.id,
      (row) => {
        b.guildChatAppend(row);
        // Someone who just sent a line is no longer typing.
        typingNames = typingNames.filter((n) => n !== row.user_name);
        if (tab === 'wire') { paint(); scrollWire(); }
      },
      (names) => {
        typingNames = names.filter((n) => n !== b.displayName());
        if (tab === 'wire') paintTypingOnly();
      });
  }
  subscribeCommunity(c.id, c.name, ({ kind }) => {
    // Announcements/votes/payouts change what the tabs show, so reload the
    // community — but only the data, and only when something actually landed.
    if (kind === 'announcement' || kind === 'vote' || kind === 'reward' || kind === 'member') refreshCommunity();
  }, { userId: b.userId() });
}

/* ⚠ Typing repaints must NOT go through paint(). A full repaint rebuilds the
   input element, which drops focus and any half-typed message every time
   somebody else presses a key — the exact bug that makes chat unusable. */
function paintTypingOnly() {
  try {
    const el = document.getElementById('mc-typing');
    if (el) el.innerHTML = typingHtml();
  } catch (e) {}
}
function typingHtml() {
  if (!typingNames.length) return '';
  const who = typingNames.length === 1 ? esc(typingNames[0])
    : typingNames.length === 2 ? esc(typingNames[0]) + ' and ' + esc(typingNames[1])
    : esc(typingNames[0]) + ' and ' + (typingNames.length - 1) + ' others';
  return `<span class="mc-typing"><i></i><i></i><i></i> ${who} ${typingNames.length === 1 ? 'is' : 'are'} typing…</span>`;
}

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
  /* 📻 Wire. Fills its card instead of leaving half the screen dead, which is
     what the standalone Guild Wire screen did. */
  #${OV} .mc-wire{height:min(52vh,460px);overflow-y:auto;display:flex;flex-direction:column;gap:7px;
    padding:10px 4px;border-top:1px solid rgba(210,164,78,.18);border-bottom:1px solid rgba(210,164,78,.18);margin:8px 0}
  #${OV} .mc-wmsg{max-width:74%;align-self:flex-start}
  #${OV} .mc-wmsg.me{align-self:flex-end;text-align:right}
  #${OV} .mc-wmeta{font-size:.66rem;color:#8d8370;letter-spacing:.05em;margin-bottom:2px}
  #${OV} .mc-wbody{display:inline-block;text-align:left;padding:7px 11px;border-radius:9px;font-size:.86rem;
    line-height:1.5;border:1px solid rgba(210,164,78,.25);background:rgba(255,255,255,.035);color:#e7dcc0;
    white-space:pre-wrap;word-break:break-word}
  #${OV} .mc-wmsg.me .mc-wbody{background:rgba(212,175,55,.14);border-color:rgba(210,164,78,.5)}
  #${OV} .mc-wsys{text-align:center;font-size:.7rem;color:#8d8370;letter-spacing:.04em;padding:2px 0}
  #${OV} .mc-wsend{display:flex;gap:7px}
  #${OV} .mc-wsend input{flex:1}
  /* Typing row keeps its height whether or not anyone is typing, so the input
     does not jump up and down under the cursor while people type. */
  #${OV} .mc-typingrow{min-height:18px;margin:0 0 6px;font-size:.74rem;color:#9b9078}
  #${OV} .mc-typing{display:inline-flex;align-items:center;gap:3px}
  #${OV} .mc-typing i{width:4px;height:4px;border-radius:50%;background:#c9a86a;display:inline-block;
    animation:mcTypeBlink 1.2s infinite}
  #${OV} .mc-typing i:nth-child(2){animation-delay:.18s}
  #${OV} .mc-typing i:nth-child(3){animation-delay:.36s}
  @keyframes mcTypeBlink{0%,60%,100%{opacity:.25}30%{opacity:1}}
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
  const canFound = roles.canFoundCommunity();
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
      ${canFound
        ? `<div class="mc-form">
        <input id="mc-name" maxlength="48" placeholder="Name — e.g. The Ashfall Compact">
        <input id="mc-tag" maxlength="8" placeholder="Tag — up to 8 characters, e.g. ASH">
        <textarea id="mc-desc" maxlength="400" rows="2" placeholder="What is this community for?"></textarea>
        <select id="mc-policy">
          <option value="apply">Applications reviewed by leadership</option>
          <option value="open">Open — anyone may join instantly</option>
          <option value="closed">Closed — invite only</option>
        </select>
        <button class="mc-b" data-mc="create">Found it</button>
      </div>`
        // 🏢 Founding requires owning a corporation — communities sit ABOVE
        //    corps, so you cannot hold corps together without holding one.
        //    The form is hidden rather than shown-and-disabled: a form you are
        //    allowed to fill in and then refused is worse than no form.
        : `<div class="mc-note">${!b.signedIn()
              ? 'Sign in to found a community.'
              : 'Founding a community requires <b>owning a corporation</b> — communities sit above corps, so you need one of your own first. Found or take over a corporation in <b>Just Business</b>, then come back.'}</div>`}
    </div>`;
}

/* ── community ───────────────────────────────────────────────────────────── */
function tabsHtml() {
  const t = (k, label) => `<button class="mc-tab ${tab === k ? 'on' : ''}" data-mc="tab" data-tab="${k}">${label}</button>`;
  const claim = myUnclaimedRewards();
  // 📻 Wire first and default — this hub IS the Guild Wire now, with the civic
  //    layer behind it rather than in a second window.
  return `<div class="mc-tabs">${t('wire', '📻 Wire')}${t('standings', 'Standings')}${t('news', 'Announcements')}${t('votes', 'Votes')}` +
    `${t('objectives', 'Objectives')}${t('members', 'Members')}${t('corps', 'Corporations')}` +
    `${t('ledger', 'Contributions')}${t('rewards', 'Rewards' + (claim > 0 ? ' •' : ''))}</div>`;
}

/* ── 📻 THE GUILD WIRE ────────────────────────────────────────────────────
   The corporation's realtime chat, living inside the community hub so there is
   ONE social screen instead of two half-empty ones.
   ⚠ Scope note that is shown to the player, not just written here: the wire is
   per-CORPORATION while a community spans several corps. Calling it "the
   community's chat" would mislead anyone in a multi-corp community, so the
   header names the corp whose wire this is. */
function wireHtml() {
  const b = bridge();
  const corp = b.myCorp();
  if (!corp || !corp.id) {
    return `<div class="mc-card"><h3>📻 Guild Wire</h3>
      <div class="mc-empty">The wire belongs to a corporation, and you are not in one.
      Found or join a corporation in <b>Just Business</b> to get a wire — the rest of this hub works regardless.</div></div>`;
  }
  const chat = b.guildChat() || [];
  const me = b.displayName();
  const lines = chat.map((m) => {
    if (m.kind === 'sys') {
      return `<div class="mc-wsys">— ${esc(m.body)} —</div>`;
    }
    const mine = m.user_name === me;
    const when = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="mc-wmsg ${mine ? 'me' : ''}">
      <div class="mc-wmeta">${esc(m.user_name || '?')}${when ? ' · ' + when : ''}</div>
      <div class="mc-wbody">${esc(m.body)}</div></div>`;
  }).join('');

  return `<div class="mc-card">
      <h3>📻 ${esc(corp.name || 'Your corporation')}'s wire
        <span class="mc-pill">${chat.length} on the wire</span></h3>
      <div class="mc-note">Live chat and every corporation action, seen by all members. This wire belongs to <b>${esc(corp.name || 'your corp')}</b> — a community can hold several corporations, so other members of this community may be on a different wire.</div>
      <div id="mc-wire" class="mc-wire">${lines || '<div class="mc-empty" style="text-align:center;padding:26px">Quiet on the wire. Say something to the guild.</div>'}</div>
      <div id="mc-typing" class="mc-typingrow">${typingHtml()}</div>
      <div class="mc-wsend">
        <input id="mc-wmsg" maxlength="400" placeholder="Message your guild…" autocomplete="off">
        <button class="mc-b" data-mc="wire-send">Send</button>
      </div>
      ${notifyRowHtml()}
    </div>`;
}

/* Notifications are opt-in and the button says exactly what it will do. A
   permission prompt fired on page load is how a site gets blocked forever. */
function notifyRowHtml() {
  const st = notifyState();
  if (st === 'unsupported') return '';
  if (st === 'granted') return `<div class="mc-note" style="margin-top:8px">🔔 Alerts are on — you will be told about announcements, open votes and payouts in this community, even on another tab.</div>`;
  if (st === 'denied') return `<div class="mc-note" style="margin-top:8px">🔕 Alerts are blocked for this site in your browser settings. Re-allow notifications there to hear about announcements and votes.</div>`;
  return `<div class="mc-note" style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span style="flex:1;min-width:220px">🔔 Get told when this community posts an announcement, opens a vote, or pays you out.</span>
      <button class="mc-b" data-mc="notify-on">Turn on alerts</button>
    </div>`;
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

/* ── 📣 ANNOUNCEMENTS — leadership posts, everyone reads. One-to-many is the
   entire point: members cannot post, so there is no many-to-many moderation
   load and no image surface at all. ─────────────────────────────────────── */
function newsHtml() {
  const c = Community.current;
  const lead = roles.isLeadership(c, Community.members);
  const rows = Community.announcements.map((a) => `<div class="mc-card">
      <div class="mc-row"><span class="nm">${a.pinned ? '📌 ' : ''}${esc(a.author_name || 'Leadership')}
        <span class="sub">${fmtDate(a.created_at)}</span></span>
        ${lead ? `<button class="mc-b danger" data-mc="ann-del" data-id="${esc(a.id)}">Delete</button>` : ''}</div>
      <div style="white-space:pre-wrap;color:#dfd3b4;font-size:.92rem;line-height:1.6;margin-top:4px">${esc(a.body)}</div>
    </div>`).join('');
  return (lead ? `<div class="mc-card"><h3>Post an announcement</h3>
      <div class="mc-note">Goes to every member. Text only — there is no image or video surface here, deliberately.</div>
      <div class="mc-form">
        <textarea id="mc-ann" rows="3" maxlength="2000" placeholder="What does the community need to know?"></textarea>
        <button class="mc-b" data-mc="ann-post">Post</button>
      </div></div>` : '')
    + (rows || '<div class="mc-empty">No announcements yet.</div>');
}

/* ── 🗳 VOTES that change game state. A poll that changes nothing is the
   "worse Discord" this feature exists to avoid, so closing a vote WRITES the
   winner onto the community and the game reads it. ──────────────────────── */
function votesHtml() {
  const c = Community.current;
  const lead = roles.isLeadership(c, Community.members);
  const member = roles.isActiveMember(c, Community.members);
  const nodes = (() => { try { return bridge().twNodes() || []; } catch (e) { return []; } })();

  const rows = Community.votes.map((v) => {
    const t = tally(v.id);
    const opts = Array.isArray(v.options) ? v.options : [];
    const open = v.status === 'open';
    const bars = opts.map((o) => {
      const n = t.counts[o.value] || 0;
      const pct = t.total ? Math.round((n / t.total) * 100) : 0;
      const mine = t.myChoice === o.value;
      return `<div class="mc-row">
        <span class="nm">${mine ? '✓ ' : ''}${esc(o.label || o.value)}<span class="sub">${n} vote${n === 1 ? '' : 's'} · ${pct}%</span></span>
        ${open && member ? `<button class="mc-b" data-mc="ballot" data-v="${esc(v.id)}" data-choice="${esc(o.value)}">${mine ? 'Voted' : 'Vote'}</button>` : ''}</div>`;
    }).join('');
    const kindLabel = v.kind === 'war_target' ? 'sets the war target'
                    : v.kind === 'levy' ? 'sets the community levy'
                    : 'advisory — changes nothing on its own';
    return `<div class="mc-card">
      <h3>${esc(v.title)} <span class="mc-pill ${open ? 'pend' : 'on'}">${esc(v.status)}</span></h3>
      <div class="mc-note" style="margin-bottom:8px">${esc(kindLabel)}${v.result_label ? ' · result: <b>' + esc(v.result_label) + '</b>' : ''}</div>
      ${bars || '<div class="mc-empty">No options on this ballot.</div>'}
      ${open && lead ? `<div class="vbtns" style="margin-top:8px"><button class="mc-b" data-mc="vote-close" data-v="${esc(v.id)}">Close &amp; apply</button></div>` : ''}
    </div>`;
  }).join('');

  const nodeOpts = nodes.slice(0, 60).map((n) => `<option value="${esc(n.id)}">${esc(n.name)}${n.owned ? ' (held)' : ''}</option>`).join('');
  const creator = lead ? `<div class="mc-card"><h3>Call a vote</h3>
      <div class="mc-form">
        <select id="mc-vkind">
          <option value="war_target">War target — the node the community pushes on</option>
          <option value="levy">Levy — % the community keeps from reward distributions</option>
          <option value="advisory">Advisory — records an opinion, changes nothing</option>
        </select>
        <input id="mc-vtitle" maxlength="140" placeholder="Question, e.g. Where do we push next?">
        <div id="mc-vopts">
          <select id="mc-vnode" multiple size="5" style="height:auto">${nodeOpts || '<option disabled>No Territory Wars nodes visible</option>'}</select>
          <div class="mc-note" style="margin-top:6px">Pick the nodes that go on the ballot (ctrl-click for several). Levy votes ignore this and offer 0/5/10/20%.</div>
        </div>
        <button class="mc-b" data-mc="vote-create">Open the vote</button>
      </div></div>` : '';

  return creator + (rows || '<div class="mc-empty">No votes yet.</div>');
}

/* ── 🎯 OBJECTIVES — pointers at Territory Wars nodes. There is no parallel
   mission system and no stored progress: "held" is read live from TW every
   render, so this can never drift from the actual war. ──────────────────── */
function objectivesHtml() {
  const c = Community.current;
  const lead = roles.isLeadership(c, Community.members);
  const list = objectives();
  const nodes = (() => { try { return bridge().twNodes() || []; } catch (e) { return []; } })();
  const pinned = new Set(list.map((o) => o.nodeId));

  const rows = list.map((o) => `<div class="mc-row">
      <span class="nm">${o.held ? '🚩' : '⚔'} ${esc(o.label)}
        <span class="sub">${o.known ? (o.heldByOurCorp ? 'Held by an affiliated corporation' : (o.held ? 'Held — but not by your corp' : 'Contested')) : 'Not visible in your Territory Wars data'}</span></span>
      <span class="mc-pill ${o.held ? 'on' : 'pend'}">${o.held ? 'Held' : 'Open'}</span>
      ${lead ? `<button class="mc-b danger" data-mc="obj-del" data-id="${esc(o.id)}">✕</button>` : ''}
    </div>`).join('');

  const addable = nodes.filter((n) => !pinned.has(n.id)).slice(0, 60)
    .map((n) => `<option value="${esc(n.id)}">${esc(n.name)}${n.owned ? ' (held)' : ''}</option>`).join('');

  return `<div class="mc-card"><h3>Community objectives</h3>
      <div class="mc-note">These point straight at Territory Wars nodes — no separate mission system, no second progress counter. Status is read from the live war each time you open this.</div>
      ${rows || '<div class="mc-empty">No objectives pinned yet.</div>'}
      ${c && c.war_target_name ? `<div class="mc-note" style="margin-top:8px">🎯 Voted war target: <b>${esc(c.war_target_name)}</b></div>` : ''}
    </div>
    ${lead ? `<div class="mc-card"><h3>Pin an objective</h3>
      <div class="mc-form">
        <select id="mc-objnode">${addable || '<option disabled>No further nodes available</option>'}</select>
        <button class="mc-b" data-mc="obj-add">Pin it</button>
      </div></div>` : ''}`;
}

/* ── 💰 REWARDS — distributed from the ledger by contribution share, and
   CLAIMED rather than pushed. Nothing here can touch another player's wallet;
   each member credits their own. ─────────────────────────────────────────── */
function rewardsHtml() {
  const c = Community.current;
  const lead = roles.isLeadership(c, Community.members);
  const mine = myUnclaimedRewards();
  const p = pot();
  const levy = Number(c && c.levy_pct) || 0;
  const rows = Community.rewards.slice(0, 60).map((r) => `<div class="mc-row">
      <span class="nm">${esc(r.user_name || 'Survivor')}<span class="sub">${esc(r.note || 'Distribution')} · ${fmtDate(r.created_at)}</span></span>
      <span class="val">🔥 ${fmtNum(r.amount)}</span>
      <span class="mc-pill ${r.claimed_at ? 'on' : 'pend'}">${r.claimed_at ? 'claimed' : 'unclaimed'}</span>
    </div>`).join('');

  // 💠 Owner earnings. Shown only to whoever the rows belong to (RLS returns
  //    nothing to anyone else), so the owner can see WHY Cinder appeared in
  //    their gift inbox instead of it arriving unexplained.
  const op = Community.ownerPayouts || [];
  const opTotal = op.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const opMembers = op.filter(r => r.kind === 'member_ip').length;
  const opChat = op.filter(r => r.kind === 'chat_activity').length;
  const ownerBox = op.length ? `<div class="mc-card"><h3>What your community earned you</h3>
      <div class="mc-row"><span class="nm">New members (unique address)<span class="sub">100 🔥 each, once per address</span></span><span class="val">${opMembers}</span></div>
      <div class="mc-row"><span class="nm">Active members on the wire<span class="sub">10 🔥 each, at most once per 5 hours</span></span><span class="val">${opChat}</span></div>
      <div class="mc-row"><span class="nm">Total earned</span><span class="val">🔥 ${fmtNum(opTotal)}</span></div>
      <div class="mc-note" style="margin-top:8px">These arrive as gifts — claim them in <b>Rewards &amp; Gifts</b> on your profile. Talking in your own community earns nothing, and each address counts once.</div>
    </div>` : '';

  return ownerBox + `<div class="mc-card"><h3>Your payouts</h3>
      ${mine > 0
        ? `<div class="mc-row"><span class="nm">You have <b>🔥 ${fmtNum(mine)}</b> waiting.<span class="sub">Claiming credits your wallet.</span></span>
           <button class="mc-b" data-mc="claim">Claim</button></div>`
        : '<div class="mc-empty">Nothing to claim right now.</div>'}
    </div>
    <div class="mc-card"><h3>The pot</h3>
      <div class="mc-row"><span class="nm">Distributable</span><span class="val">🔥 ${fmtNum(p)}</span></div>
      <div class="mc-row"><span class="nm">Community levy</span><span class="val">${levy}%</span></div>
      <div class="mc-note">The pot is the ledger itself — contributions add, distributions subtract. There is no balance column to drift, and a distribution larger than the pot is refused by the server.</div>
      ${lead ? `<div class="mc-form">
        <input id="mc-dist" type="number" min="1" step="1" placeholder="Amount to distribute">
        <input id="mc-distnote" maxlength="120" placeholder="What is this for? (optional)">
        <button class="mc-b" data-mc="distribute">Distribute by contribution share</button>
      </div>` : ''}
    </div>
    <div class="mc-card"><h3>Distribution history</h3>${rows || '<div class="mc-empty">Nothing distributed yet.</div>'}</div>`;
}

function communityHtml() {
  const c = Community.current;
  if (!c) return banner() + '<div class="mc-empty">Community not found.</div>';
  const body = tab === 'wire' ? wireHtml()
             : tab === 'members' ? membersHtml()
             : tab === 'corps' ? corpsHtml()
             : tab === 'ledger' ? ledgerHtml()
             : tab === 'news' ? newsHtml()
             : tab === 'votes' ? votesHtml()
             : tab === 'objectives' ? objectivesHtml()
             : tab === 'rewards' ? rewardsHtml()
             : standingsHtml();
  return banner() + body;
}

/* ── paint + events ──────────────────────────────────────────────────────── */
// Chat is only readable if it lands at the newest line. paint() rebuilds the
// whole panel, so this has to run after every repaint of the wire.
function scrollWire() {
  try { const w = document.getElementById('mc-wire'); if (w) w.scrollTop = w.scrollHeight; } catch (e) {}
}
export function paint() {
  const ov = document.getElementById(OV); if (!ov) return;
  if (view === 'directory') {
    ov.innerHTML = shell('🏛 Communities', Community.loading ? '<div class="mc-empty">Loading…</div>' : directoryHtml(), '');
  } else {
    const c = Community.current;
    const title = c ? `🏛 [${esc(c.tag)}] ${esc(c.name)}` : '🏛 Community';
    ov.innerHTML = shell(title + ' <button class="mc-b" data-mc="back" style="margin-left:10px">← All</button>',
      Community.loading ? '<div class="mc-empty">Loading…</div>' : communityHtml(), tabsHtml());
    if (tab === 'wire') scrollWire();
  }
}

async function refreshDirectory() { await loadDirectory(); paint(); }
async function refreshCommunity() {
  if (!openId) return;
  // The wire lives in the parent's Just Business state, so ask it to refresh
  // alongside the community's own tables — otherwise the Wire tab shows
  // whatever was last loaded by a visit to Just Business, which may be nothing.
  try { bridge().guildChatRefresh(); } catch (e) {}
  await loadCommunity(openId);
  try { wireUp(); } catch (e) {}
  paint();
}

async function onClick(ev) {
  const el = ev.target.closest('[data-mc]'); if (!el || busy) return;
  const b = bridge();
  const act = el.dataset.mc;

  if (act === 'close') { close(); return; }
  if (act === 'back') { view = 'directory'; openId = null; paint(); refreshDirectory(); return; }
  if (act === 'tab') { tab = el.dataset.tab; paint(); return; }
  if (act === 'open') { openId = el.dataset.id; view = 'community'; tab = 'wire'; paint(); await refreshCommunity(); return; }

  busy = true;
  try {
    if (act === 'create') {
      // Defence in depth. The comm_ins policy is the real gate; this just
      // avoids a confusing round-trip when we already know the answer.
      if (!roles.canFoundCommunity()) {
        b.toast('🏢 Founding a community requires owning a corporation. Found one in Just Business first.', 5000);
        return;
      }
      const name = (document.getElementById('mc-name') || {}).value || '';
      const tag = (document.getElementById('mc-tag') || {}).value || '';
      if (!name.trim() || !tag.trim()) { b.toast('A community needs a name and a tag.'); return; }
      const r = await api.createCommunity({
        name, tag,
        description: (document.getElementById('mc-desc') || {}).value || '',
        joinPolicy: (document.getElementById('mc-policy') || {}).value || 'apply',
      });
      if (!r.ok) {
        // A row-level-security refusal here means exactly one thing now.
        const rls = /row-level security|violates row/i.test(r.error || '');
        b.toast(r.missing ? '🗄 Run the Community SQL first.'
          : rls ? '🏢 The server refused — founding a community requires owning a corporation.'
          : '⚠ Could not found it: ' + (r.error || ''), rls ? 5000 : 3600);
        return;
      }
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

    if (act === 'notify-on') {
      const res = await askNotifyPermission();
      if (res !== 'granted') {
        b.toast(res === 'denied' ? '🔕 Your browser blocked alerts for this site.' : 'Alerts were not enabled.');
        paint();
        return;
      }
      // Permission alone only covers a live tab. Subscribing to push is what
      // reaches a phone with the game closed — so it is the same action to the
      // player, not a second button they would never find.
      const ps = await pushSubscribe();
      b.toast(ps.ok
        ? '🔔 Alerts on — these now reach you even with the game closed.'
        : ps.reason === 'not-configured'
          ? '🔔 Alerts on for this tab. Push to a closed app is not switched on for this server yet.'
          : '🔔 Alerts on for this tab. Background push could not be set up here (' + (ps.reason || '?') + ').',
        5200);
      paint();
      return;
    }

    if (act === 'wire-send') {
      const input = document.getElementById('mc-wmsg');
      const body = (input && input.value) || '';
      if (!body.trim()) return;
      const ok = await b.guildChatSend(body);
      if (!ok) { b.toast('⚠ Message failed to send.'); return; }
      if (input) input.value = '';
      paint(); scrollWire();
      return;
    }

    if (act === 'ann-post') {
      const body = (document.getElementById('mc-ann') || {}).value || '';
      if (!body.trim()) { b.toast('Write something first.'); return; }
      const r = await api.postAnnouncement(openId, body);
      if (!r.ok) { b.toast(r.missing ? '🗄 Run sql/005 first.' : '⚠ ' + (r.error || 'Could not post.')); return; }
      await api.logAction(openId, 'announcement posted', null);
      await refreshCommunity();
      return;
    }
    if (act === 'ann-del') {
      const r = await api.deleteAnnouncement(el.dataset.id);
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not delete.')); return; }
      await refreshCommunity();
      return;
    }

    if (act === 'vote-create') {
      const kind = (document.getElementById('mc-vkind') || {}).value || 'advisory';
      const title = (document.getElementById('mc-vtitle') || {}).value || '';
      if (!title.trim()) { b.toast('Give the vote a question.'); return; }
      let options = [];
      if (kind === 'levy') {
        // Fixed rungs — a free-text levy is how you end up voting in a 400%
        // cut. The column caps at 50 as well.
        options = [0, 5, 10, 20].map((n) => ({ value: String(n), label: n + '% to the community' }));
      } else {
        const sel = document.getElementById('mc-vnode');
        const picked = sel ? [...sel.selectedOptions] : [];
        if (!picked.length) { b.toast('Pick at least one node for the ballot.'); return; }
        options = picked.map((o) => ({ value: o.value, label: o.textContent.replace(/\s*\(held\)$/, '') }));
      }
      const r = await api.createVote(openId, { kind, title, options });
      if (!r.ok) { b.toast(r.missing ? '🗄 Run sql/005 first.' : '⚠ ' + (r.error || 'Could not open the vote.')); return; }
      await api.logAction(openId, 'vote opened · ' + kind, title.slice(0, 60));
      await refreshCommunity();
      return;
    }
    if (act === 'ballot') {
      const r = await api.castBallot(Number(el.dataset.v), el.dataset.choice);
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not record your vote.')); return; }
      b.toast('🗳 Vote recorded.');
      await refreshCommunity();
      return;
    }
    if (act === 'vote-close') {
      if (!(await b.confirm('Close this vote and apply the result?\n\nIf it sets a war target or a levy, that takes effect immediately.'))) return;
      const r = await api.closeVote(Number(el.dataset.v));
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not close it.')); return; }
      const res = r.result || {};
      b.toast(res.applied ? '🗳 Applied: ' + (res.label || res.winner) : '🗳 Closed — ' + (res.reason === 'no_votes' ? 'nobody voted.' : 'advisory, nothing changed.'));
      await api.logAction(openId, 'vote closed', String(res.label || res.winner || ''));
      await refreshCommunity();
      return;
    }

    if (act === 'obj-add') {
      const sel = document.getElementById('mc-objnode');
      const nodeId = sel && sel.value;
      if (!nodeId) { b.toast('No node selected.'); return; }
      const label = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.replace(/\s*\(held\)$/, '') : nodeId;
      const r = await api.addObjective(openId, nodeId, label);
      if (!r.ok) { b.toast(r.missing ? '🗄 Run sql/005 first.' : '⚠ ' + (r.error || 'Could not pin it.')); return; }
      await api.logAction(openId, 'objective pinned', label);
      await refreshCommunity();
      return;
    }
    if (act === 'obj-del') {
      const r = await api.removeObjective(el.dataset.id);
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not remove it.')); return; }
      await refreshCommunity();
      return;
    }

    if (act === 'distribute') {
      const amt = Math.floor(Number((document.getElementById('mc-dist') || {}).value) || 0);
      const note = (document.getElementById('mc-distnote') || {}).value || '';
      if (!(amt > 0)) { b.toast('Enter an amount.'); return; }
      if (amt > pot()) { b.toast('The pot holds 🔥 ' + fmtNum(pot()) + '.'); return; }
      if (!(await b.confirm('Distribute ' + amt.toLocaleString() + ' 🔥 by contribution share?\n\nEach member claims their own payout. This cannot be undone.'))) return;
      const r = await api.distribute(openId, amt, note);
      if (!r.ok) { b.toast(r.missing ? '🗄 Run sql/005 first.' : '⚠ ' + (r.error || 'Could not distribute.')); return; }
      const res = r.result || {};
      b.toast('💰 Distributed 🔥 ' + fmtNum(res.distributed || amt) + ' to ' + (res.recipients || 0) + ' member(s).');
      await api.logAction(openId, 'distributed ' + (res.distributed || amt), note.slice(0, 60));
      await refreshCommunity();
      return;
    }
    if (act === 'claim') {
      // ⚠ The server marks the rows claimed and returns the total. The wallet
      //   is credited from THAT number, never from the local sum — otherwise a
      //   double-click pays twice.
      const r = await api.claimRewards(openId);
      if (!r.ok) { b.toast('⚠ ' + (r.error || 'Could not claim.')); return; }
      if (!(r.amount > 0)) { b.toast('Nothing to claim.'); return; }
      b.addGems(r.amount); try { b.saveProfile(); } catch (e) {}
      b.toast('💰 Claimed 🔥 ' + fmtNum(r.amount) + '.');
      try { b.render(); } catch (e) {}
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
    // Enter sends on the wire. Delegated, because paint() replaces the input
    // element every repaint and a direct listener would not survive it.
    ov.addEventListener('keydown', (ev) => {
      if (!ev.target || ev.target.id !== 'mc-wmsg') return;
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        const btn = ov.querySelector('[data-mc="wire-send"]');
        if (btn) btn.click();
        return;
      }
      // Tell the guild someone is composing. Throttled inside sendTyping, and
      // never fired for Enter (which is a send, not typing).
      try {
        const b = bridge(); const corp = b.myCorp();
        if (corp && corp.id) sendTyping(corp.id, b.displayName());
      } catch (e) {}
    });
    document.body.appendChild(ov);
  }
  view = 'directory'; openId = null; tab = 'standings';
  paint();
  refreshDirectory();
}

export function close() {
  const ov = document.getElementById(OV);
  if (ov) ov.remove();
  // ⚠ Drop the realtime channels. Leaving them open holds a websocket and a
  //   slot in the project's channel budget for a panel nobody is looking at,
  //   and re-opening would stack a second subscription on the same tables.
  try { unsubscribeAll(); } catch (e) {}
  typingNames = [];
}
