/* ═══════════════════════════════════════════════════════════════════════════
   merc.render.js — the UI. One full-screen overlay, six tabs.

   Styling is injected by this module rather than added to index.html, so the
   feature owns its own chrome and the 215k-line legacy stylesheet is untouched
   (the same arrangement /src/community uses).

   Text only — no image or video surface anywhere, deliberately. CLAUDE.md puts
   user-generated media out of scope for a reason that has nothing to do with
   effort, and a mercenary "portfolio" upload would walk straight into it.

   ⚠ Every repaint rebuilds the panel's innerHTML, so anything the player is
     typing must live in Merc.draft (see merc.state.js) and NOT only in the
     DOM. That is why the post form reads itself back into the draft on every
     input rather than only on submit.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Merc, loadAll, refreshProgress, myPostings, myJobs, claimCount, api } from './merc.state.js';
import { bridge, ctx as mkCtx, io as mkIo, esc, fmtNum, fmtWhen } from './merc.bridge.js';
import * as M from './merc.manifest.js';
import * as B from './merc.badges.js';

const OV = 'mythic-merc-ov';
let tab = 'board';   // board | post | jobs | contracts | hire | collect
let busy = false;

const $ = (id) => document.getElementById(id);
const ctx = () => mkCtx();
const io  = () => mkIo();

/* ── chrome ──────────────────────────────────────────────────────────────── */

function injectStyle() {
  if ($('mrc-style')) return;
  const s = document.createElement('style');
  s.id = 'mrc-style';
  s.textContent = `
#${OV}{position:fixed;inset:0;z-index:2147483400;background:rgba(6,7,11,.92);backdrop-filter:blur(7px);
  display:flex;align-items:stretch;justify-content:center;padding:0;font-family:inherit;color:#EDEFF3;overflow:hidden}
.mrc-shell{width:100%;max-width:1080px;display:flex;flex-direction:column;background:#12141A;
  border-left:1px solid #262B34;border-right:1px solid #262B34}
.mrc-top{display:flex;align-items:center;gap:12px;padding:16px 18px 12px;border-bottom:1px solid #23272F;flex:0 0 auto}
.mrc-title{font-family:'Cinzel',serif;font-size:1.3rem;font-weight:800;color:#ff8a4b;letter-spacing:.02em}
.mrc-sub{color:#8B929C;font-size:.82rem;margin-top:2px}
.mrc-x{margin-left:auto;background:#1B1F27;border:1px solid #2C323C;color:#C6CAD1;border-radius:9px;
  padding:8px 14px;cursor:pointer;font-size:.9rem}
.mrc-x:hover{background:#232833;color:#fff}
.mrc-tabs{display:flex;gap:6px;padding:10px 18px;border-bottom:1px solid #23272F;overflow-x:auto;flex:0 0 auto}
.mrc-tab{background:transparent;border:1px solid transparent;color:#9BA1AB;border-radius:8px;padding:7px 13px;
  cursor:pointer;font-size:.88rem;white-space:nowrap}
.mrc-tab:hover{color:#EDEFF3;background:#191D25}
.mrc-tab.on{background:#241a14;border-color:#5a3a24;color:#ffb07a}
.mrc-pip{display:inline-block;min-width:17px;padding:0 5px;margin-left:6px;border-radius:9px;background:#ff6a2b;
  color:#120b06;font-size:.72rem;font-weight:800;text-align:center}
.mrc-body{flex:1 1 auto;overflow-y:auto;padding:16px 18px 40px}
.mrc-card{background:#171A21;border:1px solid #252A33;border-radius:12px;padding:14px 15px;margin-bottom:11px}
.mrc-card h4{margin:0 0 4px;font-size:1rem;color:#EDEFF3;font-weight:700}
.mrc-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.mrc-dim{color:#7D838D}
.mrc-small{font-size:.82rem}
.mrc-reward{color:#ffb07a;font-weight:800}
.mrc-man{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px}
.mrc-chip{background:#1D222B;border:1px solid #2C323C;border-radius:8px;padding:4px 9px;font-size:.82rem;color:#C6CAD1}
.mrc-chip.done{border-color:#2f6b3f;color:#8fe0a5;background:#16241b}
.mrc-chip.short{border-color:#6b3a2f;color:#ffb49a;background:#241a16}
.mrc-badge{display:inline-block;background:#1a1710;border:1px solid #4a3a20;color:#ffd48a;border-radius:20px;
  padding:3px 10px;font-size:.76rem;margin:2px 4px 2px 0}
.mrc-bar{height:6px;background:#20242C;border-radius:4px;overflow:hidden;margin:8px 0 2px}
.mrc-bar i{display:block;height:100%;background:linear-gradient(90deg,#ff6a2b,#ffb07a)}
.mrc-btn{background:#ff6a2b;border:none;color:#120b06;border-radius:9px;padding:8px 14px;cursor:pointer;
  font-weight:700;font-size:.88rem}
.mrc-btn:hover{filter:brightness(1.08)}
.mrc-btn[disabled]{opacity:.45;cursor:not-allowed;filter:none}
.mrc-btn.ghost{background:#1B1F27;border:1px solid #2C323C;color:#C6CAD1;font-weight:600}
.mrc-btn.danger{background:#3a1c18;border:1px solid #6b3128;color:#ffb0a0;font-weight:600}
.mrc-in,.mrc-ta,.mrc-sel{width:100%;background:#0F1116;border:1px solid #262B34;border-radius:9px;color:#EDEFF3;
  padding:9px 11px;font-size:.9rem;font-family:inherit}
.mrc-ta{resize:vertical}
.mrc-lbl{display:block;color:#9BA1AB;font-size:.8rem;margin:11px 0 5px}
.mrc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:640px){.mrc-grid{grid-template-columns:1fr}}
.mrc-empty{text-align:center;color:#7D838D;padding:38px 12px;font-size:.92rem;line-height:1.6}
.mrc-note{background:#1a1409;border:1px solid #4a3a20;color:#e8c98d;border-radius:9px;padding:10px 12px;
  font-size:.84rem;margin-bottom:12px;line-height:1.5}
.mrc-err{background:#2a1512;border:1px solid #6b3128;color:#ffb0a0}
.mrc-line{display:flex;gap:8px;align-items:center;margin-bottom:7px}
.mrc-line .mrc-sel{flex:1 1 auto}
.mrc-line .mrc-in{width:96px;flex:0 0 auto}
`;
  document.head.appendChild(s);
}

export function open() {
  injectStyle();
  if ($(OV)) close();
  const wrap = document.createElement('div');
  wrap.id = OV;
  wrap.innerHTML =
    '<div class="mrc-shell">' +
      '<div class="mrc-top">' +
        '<div><div class="mrc-title">⚔ Mercenaries</div>' +
        '<div class="mrc-sub">Hire a survivor to bring you Forge resources and custom cards. Cinder sits in escrow until they deliver.</div></div>' +
        '<button class="mrc-x" id="mrc-close">Close</button>' +
      '</div>' +
      '<div class="mrc-tabs" id="mrc-tabs"></div>' +
      '<div class="mrc-body" id="mrc-body"></div>' +
    '</div>';
  document.body.appendChild(wrap);
  $('mrc-close').onclick = close;
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  paint();
  refresh();
}

export function close() {
  const el = $(OV);
  if (el) { try { el.remove(); } catch (e) {} }
}

async function refresh() {
  await loadAll();
  paint();
}

/* ── paint ───────────────────────────────────────────────────────────────── */

const TABS = [
  ['board',     '📋 Open board'],
  ['post',      '➕ Post a contract'],
  ['jobs',      '🎒 My jobs'],
  ['contracts', '📑 My contracts'],
  ['hire',      '🎖 For hire'],
  ['collect',   '📦 Collect'],
];

export function paint() {
  const tabsEl = $('mrc-tabs'); const bodyEl = $('mrc-body');
  if (!tabsEl || !bodyEl) return;

  tabsEl.innerHTML = TABS.map(([id, label]) => {
    const pip = (id === 'collect' && claimCount()) ? `<span class="mrc-pip">${claimCount()}</span>` : '';
    return `<button class="mrc-tab${id === tab ? ' on' : ''}" data-mrc-tab="${id}">${label}${pip}</button>`;
  }).join('');
  tabsEl.querySelectorAll('[data-mrc-tab]').forEach((b) => {
    b.onclick = () => { tab = b.getAttribute('data-mrc-tab'); paint(); };
  });

  bodyEl.innerHTML = statusHtml() + (
    tab === 'board'     ? boardHtml()
  : tab === 'post'      ? postHtml()
  : tab === 'jobs'      ? jobsHtml()
  : tab === 'contracts' ? contractsHtml()
  : tab === 'hire'      ? hireHtml()
  :                       collectHtml());
  bind();
}

/* The tri-state banner. "Not set up yet" and "signed out" are DIFFERENT
   answers and must never collapse into one "something went wrong" — the first
   is a migration nobody has run, the second is a fixable user state. */
function statusHtml() {
  if (Merc.offline) {
    return '<div class="mrc-note">☁ <b>Sign in</b> to hire, apply, or get paid. The board needs an account so escrow has somewhere to sit.</div>';
  }
  if (Merc.missing) {
    return '<div class="mrc-note">🛠 The Mercenary Board is not set up on this world yet — <code>sql/038_mercenary_board.sql</code> has not been applied. Everything else in the game is unaffected.</div>';
  }
  if (Merc.error) {
    return `<div class="mrc-note mrc-err">⚠ ${esc(Merc.error).slice(0, 200)}</div>`;
  }
  if (Merc.loading) return '<div class="mrc-note">Loading the board…</div>';
  return '';
}

/* ── tab: the open board ─────────────────────────────────────────────────── */

function manifestChips(manifest, prog) {
  const c = ctx();
  const rows = prog || M.normalise(manifest).map((l) => ({ ...l, got: 0, still: l.qty }));
  return '<div class="mrc-man">' + rows.map((r) => {
    const meta = r.kind === 'res' ? c.meta(r.id) : null;
    const label = r.kind === 'res'
      ? `${(meta && meta.icon) || '📦'} ${esc((meta && meta.name) || r.id)}`
      : `🃏 ${esc(r.name || r.id)}`;
    const cls = r.still <= 0 ? ' done' : (r.got > 0 ? ' short' : '');
    const count = prog ? `${r.got.toLocaleString()} / ${r.qty.toLocaleString()}` : r.qty.toLocaleString();
    return `<span class="mrc-chip${cls}">${label} · ${count}</span>`;
  }).join('') + '</div>';
}

function boardHtml() {
  const uid = bridge().userId();
  const rows = Merc.open || [];
  if (!rows.length) {
    return '<div class="mrc-empty">Nobody is hiring right now.<br>Post the first contract — the job goes out on Emergency Broadcast the moment you do.</div>';
  }
  return rows.map((c) => {
    const mine = c.employer_id === uid;
    const applied = Merc.applied.get(c.id);
    const act = mine
      ? '<span class="mrc-dim mrc-small">Your posting — manage it under 📑 My contracts.</span>'
      : (applied === 'pending'
          ? `<span class="mrc-dim mrc-small">✅ Applied.</span> <button class="mrc-btn ghost" data-mrc-withdraw="${c.id}">Withdraw</button>`
          : `<button class="mrc-btn" data-mrc-apply="${c.id}">Apply</button>`);
    return `<div class="mrc-card">
      <div class="mrc-row"><h4>${esc(c.title)}</h4>
        <span class="mrc-reward" style="margin-left:auto">🔥 ${fmtNum(c.reward)}</span></div>
      <div class="mrc-small mrc-dim">by ${esc(c.employer_name || 'Survivor')} · deadline ${esc(fmtWhen(c.deadline_at))}</div>
      ${c.brief ? `<div class="mrc-small" style="margin-top:7px">${esc(c.brief)}</div>` : ''}
      ${manifestChips(c.manifest)}
      <div class="mrc-row" style="margin-top:9px">${act}</div>
    </div>`;
  }).join('');
}

/* ── tab: post ───────────────────────────────────────────────────────────── */

function resourceOptions(selected) {
  const c = ctx();
  return (c.resources() || []).map((r) => {
    if (!r || !r.id) return '';
    return `<option value="res::${esc(r.id)}"${r.id === selected ? ' selected' : ''}>${esc((r.icon || '📦') + ' ' + (r.name || r.id))}</option>`;
  }).join('');
}

function cardOptions(selected) {
  const c = ctx();
  return (c.customCards() || []).map((k) => {
    if (!k || !k.id) return '';
    return `<option value="card::${esc(k.id)}"${k.id === selected ? ' selected' : ''}>🃏 ${esc(k.name || k.id)}</option>`;
  }).join('');
}

function postHtml() {
  const d = Merc.draft;
  const c = ctx();
  const lines = M.normalise(d.lines);
  const bad = M.validate(lines, d.reward);
  const gems = c.gems();
  const lineRows = (d.lines.length ? d.lines : [{ kind: 'res', id: '', name: '', qty: 1 }]).map((l, i) => `
    <div class="mrc-line">
      <select class="mrc-sel" data-mrc-line="${i}">
        <option value="">— pick a resource or card —</option>
        <optgroup label="🧰 Forge resources">${resourceOptions(l.kind === 'res' ? l.id : '')}</optgroup>
        <optgroup label="🃏 Custom cards">${cardOptions(l.kind === 'card' ? l.id : '')}</optgroup>
      </select>
      <input class="mrc-in" type="number" min="1" max="${M.MAX_QTY}" value="${Math.max(1, l.qty | 0)}" data-mrc-qty="${i}">
      <button class="mrc-btn ghost" data-mrc-rmline="${i}" title="Remove">✕</button>
    </div>`).join('');

  return `<div class="mrc-card">
    <div class="mrc-note">🔥 Posting <b>charges the reward immediately</b> — that charge <i>is</i> the escrow.
      It comes back in full if you cancel before anyone is hired, and it goes to the mercenary automatically the
      moment your manifest is complete. You do not get to approve the delivery: you already specified it here.</div>
    <label class="mrc-lbl">Title</label>
    <input class="mrc-in" id="mrc-f-title" maxlength="120" placeholder="Haul 500 Scrap to Camp Heights" value="${esc(d.title)}">
    <label class="mrc-lbl">Brief (optional)</label>
    <textarea class="mrc-ta" id="mrc-f-brief" rows="2" maxlength="1200" placeholder="Where, when, why — anything a mercenary should know.">${esc(d.brief)}</textarea>
    <label class="mrc-lbl">Manifest — what you want delivered (max ${M.MAX_LINES} lines)</label>
    ${lineRows}
    <button class="mrc-btn ghost" id="mrc-f-addline" ${lines.length >= M.MAX_LINES ? 'disabled' : ''}>+ Add a line</button>
    <div class="mrc-grid" style="margin-top:6px">
      <div><label class="mrc-lbl">Reward (Cinder) — you hold 🔥 ${fmtNum(gems)}</label>
        <input class="mrc-in" id="mrc-f-reward" type="number" min="1" max="${M.MAX_REWARD}" value="${d.reward | 0}"></div>
      <div><label class="mrc-lbl">Deadline</label>
        <select class="mrc-sel" id="mrc-f-deadline">
          ${[[6, '6 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '30 days']]
            .map(([h, t]) => `<option value="${h}"${(d.deadlineHours | 0) === h ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
    </div>
    <div class="mrc-small mrc-dim" style="margin-top:10px">Asking for: ${esc(M.summary(lines, c))}</div>
    ${bad ? `<div class="mrc-note mrc-err" style="margin-top:10px">${esc(bad)}</div>` : ''}
    ${(!bad && (d.reward | 0) > gems) ? '<div class="mrc-note mrc-err" style="margin-top:10px">You do not hold enough Cinder to escrow that reward.</div>' : ''}
    <div class="mrc-row" style="margin-top:12px">
      <button class="mrc-btn" id="mrc-f-post" ${bad || (d.reward | 0) > gems ? 'disabled' : ''}>📡 Post it — 🔥 ${fmtNum(d.reward | 0)} into escrow</button>
    </div>
  </div>`;
}

/* ── tab: my jobs (I am the mercenary) ───────────────────────────────────── */

function jobsHtml() {
  const rows = myJobs().filter((c) => c.status === 'hired');
  const done = myJobs().filter((c) => c.status !== 'hired').slice(0, 10);
  if (!rows.length && !done.length) {
    return '<div class="mrc-empty">You are not working any contracts.<br>Take one from the 📋 open board — or list yourself under 🎖 For hire so employers come to you.</div>';
  }
  const c = ctx();
  const live = rows.map((k) => {
    const prog = M.progress(k.manifest, Merc.outstanding.get(k.id));
    const pct = M.pctDone(prog);
    const d = M.deliverable(prog, c);
    const canSend = d.send.length > 0;
    const shortText = d.short.length
      ? `<div class="mrc-small mrc-dim" style="margin-top:6px">Still short: ${d.short.map((s) =>
          `${s.missing.toLocaleString()} × ${esc(s.kind === 'res' ? (c.meta(s.id).name || s.id) : (s.name || s.id))}`).join(' · ')}</div>`
      : '';
    return `<div class="mrc-card">
      <div class="mrc-row"><h4>${esc(k.title)}</h4>
        <span class="mrc-reward" style="margin-left:auto">🔥 ${fmtNum(k.reward)}</span></div>
      <div class="mrc-small mrc-dim">for ${esc(k.employer_name || 'Survivor')} · deadline ${esc(fmtWhen(k.deadline_at))}</div>
      ${k.brief ? `<div class="mrc-small" style="margin-top:7px">${esc(k.brief)}</div>` : ''}
      ${manifestChips(k.manifest, prog)}
      <div class="mrc-bar"><i style="width:${pct}%"></i></div>
      <div class="mrc-small mrc-dim">${pct}% delivered</div>
      ${shortText}
      <div class="mrc-row" style="margin-top:10px">
        <button class="mrc-btn" data-mrc-deliver="${k.id}" ${canSend ? '' : 'disabled'}>
          📦 Deliver ${d.canSendAll ? 'the rest' : 'what I have'}</button>
        ${canSend ? '' : '<span class="mrc-small mrc-dim">Nothing on this manifest is in your stash yet.</span>'}
      </div>
    </div>`;
  }).join('');
  const past = done.length ? '<div class="mrc-lbl">Finished</div>' + done.map((k) =>
    `<div class="mrc-card"><div class="mrc-row"><h4>${esc(k.title)}</h4>
      <span class="mrc-dim mrc-small" style="margin-left:auto">${esc(k.status)}</span></div>
      <div class="mrc-small mrc-dim">for ${esc(k.employer_name || 'Survivor')} · 🔥 ${fmtNum(k.reward)}</div></div>`).join('') : '';
  return live + past;
}

/* ── tab: my contracts (I am the employer) ───────────────────────────────── */

function contractsHtml() {
  const rows = myPostings();
  if (!rows.length) {
    return '<div class="mrc-empty">You have not posted a contract.<br>Head to ➕ Post a contract — your Cinder goes into escrow, not out the door.</div>';
  }
  return rows.map((k) => {
    const apps = Merc.apps.get(k.id) || [];
    const prog = k.status === 'hired' ? M.progress(k.manifest, Merc.outstanding.get(k.id)) : null;
    const pct = prog ? M.pctDone(prog) : 0;
    const overdue = k.deadline_at && new Date(k.deadline_at).getTime() < Date.now();

    let action = '';
    if (k.status === 'open') {
      action = `<button class="mrc-btn danger" data-mrc-cancel="${k.id}">Cancel & take the escrow back</button>`;
    } else if (k.status === 'hired') {
      action = overdue
        ? `<button class="mrc-btn danger" data-mrc-cancel="${k.id}">Deadline passed — cancel & refund</button>`
        : `<span class="mrc-small mrc-dim">${esc(k.merc_name || 'Your mercenary')} is on it. You can cancel once the deadline passes.</span>`;
    } else {
      action = `<span class="mrc-small mrc-dim">${esc(k.status)}</span>`;
    }

    const appList = (k.status === 'open' && apps.length)
      ? '<div class="mrc-lbl">Applications</div>' + apps.filter((a) => a.status === 'pending').map((a) =>
          `<div class="mrc-row" style="margin-bottom:7px">
             <div><b>${esc(a.merc_name || 'Survivor')}</b>${a.pitch ? `<div class="mrc-small mrc-dim">${esc(a.pitch)}</div>` : ''}</div>
             <button class="mrc-btn" style="margin-left:auto" data-mrc-hire="${k.id}" data-mrc-merc="${a.merc_id}">Hire</button>
           </div>`).join('')
      : (k.status === 'open' ? '<div class="mrc-small mrc-dim" style="margin-top:8px">No applications yet. The job is live on Emergency Broadcast.</div>' : '');

    return `<div class="mrc-card">
      <div class="mrc-row"><h4>${esc(k.title)}</h4>
        <span class="mrc-reward" style="margin-left:auto">🔥 ${fmtNum(k.reward)} in escrow</span></div>
      <div class="mrc-small mrc-dim">${esc(k.status)} · deadline ${esc(fmtWhen(k.deadline_at))}</div>
      ${manifestChips(k.manifest, prog)}
      ${prog ? `<div class="mrc-bar"><i style="width:${pct}%"></i></div><div class="mrc-small mrc-dim">${pct}% delivered</div>` : ''}
      ${appList}
      <div class="mrc-row" style="margin-top:10px">${action}</div>
    </div>`;
  }).join('');
}

/* ── tab: for hire ───────────────────────────────────────────────────────── */

function hireHtml() {
  const p = Merc.myProfile;
  const form = `<div class="mrc-card">
    <h4>${p ? 'Your mercenary listing' : 'List yourself for hire'}</h4>
    <div class="mrc-small mrc-dim">Your listing, your record and your badges are public — they show on your
      Emergency Broadcast profile at mythicspellbook.xyz, to anyone, signed in or not.</div>
    <label class="mrc-lbl">What you haul</label>
    <textarea class="mrc-ta" id="mrc-p-bio" rows="2" maxlength="600"
      placeholder="Deep-run scrap, rare Forge resources, custom card sourcing.">${esc(p ? p.bio : '')}</textarea>
    <div class="mrc-grid">
      <div><label class="mrc-lbl">Suggested rate (Cinder, a hint — not a price)</label>
        <input class="mrc-in" id="mrc-p-rate" type="number" min="0" value="${p ? (p.rate_hint | 0) : 0}"></div>
      <div><label class="mrc-lbl">Availability</label>
        <select class="mrc-sel" id="mrc-p-status">
          ${[['open', 'Open for work'], ['busy', 'Busy'], ['retired', 'Not listed']]
            .map(([v, t]) => `<option value="${v}"${p && p.status === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
    </div>
    <div class="mrc-row" style="margin-top:12px"><button class="mrc-btn" id="mrc-p-save">${p ? 'Update my listing' : '🎖 List me'}</button></div>
  </div>`;

  const roster = (Merc.mercs || []).length
    ? (Merc.mercs || []).map((m) => `<div class="mrc-card">
        <div class="mrc-row"><h4>${esc(m.handle || m.label || 'Survivor')}</h4>
          <span class="mrc-small mrc-dim" style="margin-left:auto">${esc(m.status === 'busy' ? 'Busy' : 'Open for work')}</span></div>
        <div class="mrc-small mrc-dim">${(m.jobs_done | 0).toLocaleString()} contracts · 🔥 ${fmtNum(m.cinder_earned)} earned${
          (m.rate_hint | 0) > 0 ? ` · asks around 🔥 ${fmtNum(m.rate_hint)}` : ''}</div>
        ${m.bio ? `<div class="mrc-small" style="margin-top:7px">${esc(m.bio)}</div>` : ''}
        <div style="margin-top:8px">${B.chipsHtml(m.badges)}</div>
      </div>`).join('')
    : '<div class="mrc-empty">No mercenaries have listed yet. Be the first.</div>';

  return form + '<div class="mrc-lbl">The roster</div>' + roster;
}

/* ── tab: collect ────────────────────────────────────────────────────────── */

function collectHtml() {
  const rows = Merc.claims || [];
  if (!rows.length) {
    return '<div class="mrc-empty">Nothing waiting.<br>Finished contracts drop their Cinder and their goods here.</div>';
  }
  const c = ctx();
  return rows.map((k) => {
    let items = k.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
    items = Array.isArray(items) ? items : [];
    const what = k.party === 'merc_cinder'
      ? `🔥 ${fmtNum(k.reward)} Cinder`
      : M.summary(items, c, 6);
    const why = k.party === 'merc_cinder' ? 'Contract paid out'
              : k.party === 'employer_goods' ? 'Delivered to you'
              : 'Returned — the contract was cancelled';
    // The cap check happens BEFORE the claim, not after: claiming is a
    // one-shot insert, so a stash with no room must block the button rather
    // than swallow the goods.
    const fit = k.party === 'merc_cinder' ? { ok: true } : M.acceptable(items, c);
    return `<div class="mrc-card">
      <div class="mrc-row"><h4>${esc(k.title || 'Contract')}</h4>
        <span class="mrc-small mrc-dim" style="margin-left:auto">${esc(why)}</span></div>
      <div class="mrc-small" style="margin-top:6px">${esc(what)}</div>
      <div class="mrc-small mrc-dim">with ${esc(k.counterparty || 'Survivor')}</div>
      ${fit.ok ? '' : `<div class="mrc-note mrc-err" style="margin-top:9px">Your stash has room for ${fmtNum(fit.room)} more units and this is ${fmtNum(fit.units)}. Make room first — collecting now would lose the overflow.</div>`}
      <div class="mrc-row" style="margin-top:10px">
        <button class="mrc-btn" data-mrc-claim="${k.contract_id}" data-mrc-party="${esc(k.party)}" ${fit.ok ? '' : 'disabled'}>Collect</button>
      </div>
    </div>`;
  }).join('');
}

/* ── binding ─────────────────────────────────────────────────────────────── */

async function guard(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } finally { busy = false; }
}

function toast(m, ms) { try { bridge().toast(m, ms); } catch (e) {} }

function bind() {
  const b = bridge();

  // ── post form: every input writes straight back to the draft, because the
  //    next paint() rebuilds this DOM and would otherwise eat what was typed.
  const t = $('mrc-f-title'); if (t) t.oninput = () => { Merc.draft.title = t.value; };
  const br = $('mrc-f-brief'); if (br) br.oninput = () => { Merc.draft.brief = br.value; };
  const rw = $('mrc-f-reward'); if (rw) rw.oninput = () => { Merc.draft.reward = Math.max(0, parseInt(rw.value, 10) || 0); };
  const dl = $('mrc-f-deadline'); if (dl) dl.onchange = () => { Merc.draft.deadlineHours = parseInt(dl.value, 10) || 72; };

  document.querySelectorAll('[data-mrc-line]').forEach((sel) => {
    sel.onchange = () => {
      const i = parseInt(sel.getAttribute('data-mrc-line'), 10);
      const parts = String(sel.value || '').split('::');
      ensureLine(i);
      if (!parts[1]) { Merc.draft.lines[i] = { kind: 'res', id: '', name: '', qty: Merc.draft.lines[i].qty || 1 }; }
      else {
        const kind = parts[0] === 'card' ? 'card' : 'res';
        const id = parts.slice(1).join('::');
        Merc.draft.lines[i] = { kind, id, name: nameFor(kind, id), qty: Merc.draft.lines[i].qty || 1 };
      }
      paint();
    };
  });
  document.querySelectorAll('[data-mrc-qty]').forEach((inp) => {
    inp.oninput = () => {
      const i = parseInt(inp.getAttribute('data-mrc-qty'), 10);
      ensureLine(i);
      Merc.draft.lines[i].qty = Math.max(1, Math.min(M.MAX_QTY, parseInt(inp.value, 10) || 1));
      // No repaint: repainting on every keystroke would steal focus from the
      // field being typed into. The summary catches up on the next render.
    };
  });
  document.querySelectorAll('[data-mrc-rmline]').forEach((btn) => {
    btn.onclick = () => {
      const i = parseInt(btn.getAttribute('data-mrc-rmline'), 10);
      Merc.draft.lines.splice(i, 1);
      paint();
    };
  });
  const add = $('mrc-f-addline');
  if (add) add.onclick = () => { Merc.draft.lines.push({ kind: 'res', id: '', name: '', qty: 1 }); paint(); };

  const postBtn = $('mrc-f-post');
  if (postBtn) postBtn.onclick = () => guard(async () => {
    postBtn.disabled = true;
    const d = Merc.draft;
    const r = await api.post({ title: d.title, brief: d.brief, manifest: d.lines,
                               reward: d.reward, deadlineHours: d.deadlineHours });
    if (!r.ok) { toast('⚠ ' + (r.why || r.error || 'Could not post that.'), 5200); postBtn.disabled = false; return; }
    Merc.draft = { title: '', brief: '', reward: 500, deadlineHours: 72, lines: [] };
    toast('📡 Contract posted — it is on Emergency Broadcast and your Cinder is in escrow.', 5200);
    tab = 'contracts';
    await refresh();
    try { b.render(); } catch (e) {}   // the HUD's Cinder number just changed
  });

  // ── board
  document.querySelectorAll('[data-mrc-apply]').forEach((btn) => {
    btn.onclick = () => guard(async () => {
      const id = btn.getAttribute('data-mrc-apply');
      const r = await api.apply(id, '');
      if (!r.ok) { toast('⚠ ' + (r.why || 'Could not apply.'), 4600); return; }
      toast('✅ Applied. The employer has been notified on Emergency Broadcast.', 4200);
      await refresh();
    });
  });
  document.querySelectorAll('[data-mrc-withdraw]').forEach((btn) => {
    btn.onclick = () => guard(async () => {
      const r = await api.withdraw(btn.getAttribute('data-mrc-withdraw'));
      if (!r.ok) { toast('⚠ ' + (r.why || 'Could not withdraw.'), 4200); return; }
      await refresh();
    });
  });

  // ── employer actions
  document.querySelectorAll('[data-mrc-hire]').forEach((btn) => {
    btn.onclick = () => guard(async () => {
      const r = await api.hire(btn.getAttribute('data-mrc-hire'), btn.getAttribute('data-mrc-merc'));
      if (!r.ok) { toast('⚠ ' + (r.why || 'Could not hire.'), 4600); return; }
      toast('🤝 Hired. Their Cinder is already sitting in escrow.', 4600);
      await refresh();
    });
  });
  document.querySelectorAll('[data-mrc-cancel]').forEach((btn) => {
    btn.onclick = () => guard(async () => {
      const ok = await b.confirm('Cancel this contract? The escrowed Cinder comes back to you, and anything the mercenary already delivered goes back to them.');
      if (!ok) return;
      const r = await api.cancel(btn.getAttribute('data-mrc-cancel'));
      if (!r.ok) { toast('⚠ ' + (r.why || 'Could not cancel.'), 5200); return; }
      toast('↩️ Cancelled — your escrow is back.', 4600);
      await refresh();
      try { b.render(); } catch (e) {}
    });
  });

  // ── delivery
  document.querySelectorAll('[data-mrc-deliver]').forEach((btn) => {
    btn.onclick = () => guard(async () => {
      const id = btn.getAttribute('data-mrc-deliver');
      const k = (Merc.mine || []).find((x) => x && x.id === id);
      if (!k) return;
      const prog = M.progress(k.manifest, Merc.outstanding.get(id));
      const d = M.deliverable(prog, ctx());
      if (!d.send.length) { toast('Nothing on that manifest is in your stash.', 3800); return; }
      const ok = await b.confirm('Hand over ' + M.summary(d.send, ctx(), 6) + '? This leaves your stash now.'
        + (d.canSendAll ? ' That completes the manifest — the Cinder releases to you the moment it lands.' : ''));
      if (!ok) return;
      btn.disabled = true;
      const r = await api.deliver(id, d.send, io());
      if (!r.ok) {
        toast('⚠ ' + (r.why || 'The drop was refused.') + (r.rolledBack ? ' Nothing left your stash.' : ''), 5600);
        await refresh(); return;
      }
      toast(r.complete
        ? '🎉 Manifest complete — 🔥 ' + fmtNum(k.reward) + ' released. Collect it under 📦 Collect.'
        : '📦 Delivered. Keep going — the escrow releases when the manifest is met.', 5600);
      await refreshProgress(id);
      await refresh();
      try { b.render(); } catch (e) {}
    });
  });

  // ── collect
  document.querySelectorAll('[data-mrc-claim]').forEach((btn) => {
    btn.onclick = () => guard(async () => {
      btn.disabled = true;
      const r = await api.claim(btn.getAttribute('data-mrc-claim'), btn.getAttribute('data-mrc-party'), io());
      if (!r.ok) { toast('⚠ ' + (r.why || 'Could not collect.'), 4600); await refresh(); return; }
      if (r.already) toast('Already collected.', 3200);
      else if (r.reward) toast('🔥 ' + fmtNum(r.reward) + ' Cinder collected.', 4600);
      else toast('📦 ' + M.summary(r.granted, ctx(), 6) + ' collected.', 5200);
      await refresh();
      try { b.render(); } catch (e) {}
    });
  });

  // ── listing
  const save = $('mrc-p-save');
  if (save) save.onclick = () => guard(async () => {
    save.disabled = true;
    const r = await api.register({
      label: b.displayName(),
      bio: ($('mrc-p-bio') || {}).value || '',
      rate: parseInt(($('mrc-p-rate') || {}).value, 10) || 0,
      status: ($('mrc-p-status') || {}).value || 'open',
      tags: [],
    });
    if (!r.ok) { toast('⚠ ' + (r.why || 'Could not save your listing.'), 4600); save.disabled = false; return; }
    toast('🎖 Your listing is live — on the board and on your Emergency Broadcast profile.', 5200);
    await refresh();
  });
}

function ensureLine(i) {
  if (!Array.isArray(Merc.draft.lines)) Merc.draft.lines = [];
  while (Merc.draft.lines.length <= i) Merc.draft.lines.push({ kind: 'res', id: '', name: '', qty: 1 });
}

function nameFor(kind, id) {
  const c = ctx();
  if (kind === 'res') { const m = c.meta(id) || {}; return m.name || id; }
  const k = (c.customCards() || []).find((x) => x && x.id === id);
  return (k && k.name) || id;
}

export { tab };
