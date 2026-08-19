/* ============================================================================
   🤝 CITY TRADE — the modal, and the sweep that settles standing deals
   ============================================================================
   Registers `window.MythicCityTrade`. INERT until index.html opens it.

   WHAT THIS OWNS
     • the "Do business with this city" dialog — terms, preview, submit
     • the catch-up sweep: which cycles are due, drawing the cargo, recording
       the shipment, telling both players when a leg comes up short

   WHAT THIS DOES NOT OWN
     The Supabase calls, and every read of the player's property. `Cloud`,
     `Profile`, `RESOURCES`, `getRes` and the city economy are all top-level
     `const` in index.html and are NOT on window — the globals trap in
     CLAUDE.md, which has cost this project real time twice. index.html hands
     this module everything through `window.MythicCityTradeBridge`.
     If that bridge is absent this module warns ONCE and does nothing, which is
     the same failure shape /src/trading uses: a missing bridge costs you the
     feature and never a broken screen.

   The arithmetic lives in ./plan.js and is tested by
   tools/mp-tests/citytrade.mjs. Nothing in this file decides how much moves.
============================================================================ */
import { dueCycles, cycleDueAt, planDraw, outcomeOf, shortfallMessages } from './plan.js';

const B = () => (typeof window !== 'undefined' ? window.MythicCityTradeBridge : null);
let _warned = false;
function bridge() {
  const b = B();
  if (!b && !_warned) {
    _warned = true;
    try { console.warn('[citytrade] MythicCityTradeBridge absent — trade is inert (globals trap; see CLAUDE.md).'); } catch (e) {}
  }
  return b;
}

/* Terms the dialog offers. `cycleHours` is a CONTRACT TERM, not an economy
   number — see plan.js's header for why it does not belong in ECON. */
const CYCLE_HOURS = 12;
const DAY_CHOICES = [1, 3, 7, 14, 30];
const MAX_UNITS = 9999;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ── THE DIALOG ─────────────────────────────────────────────────────────── */
function resourceOptions(selected) {
  const b = bridge();
  const list = (b && b.resources && b.resources()) || [];
  return list.filter(r => r && r.id).map(r =>
    '<option value="' + esc(r.id) + '"' + (r.id === selected ? ' selected' : '') + '>'
    + esc((r.icon ? r.icon + ' ' : '') + (r.name || r.id)) + '</option>').join('');
}

function shipmentCount(days) {
  return Math.max(0, Math.floor((Number(days) * 24) / CYCLE_HOURS));
}

export function open(target) {
  const b = bridge();
  if (!b) { return; }
  const t = target || {};
  const partnerName = t.cityName || t.nodeName || 'this city';

  close();
  const ov = document.createElement('div');
  ov.id = 'citytrade-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483400;background:rgba(6,4,12,.78);'
    + 'backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:1.2rem';

  const firstRes = ((b.resources && b.resources()) || [])[0];
  const rid = (firstRes && firstRes.id) || '';

  ov.innerHTML =
    '<div style="max-width:560px;width:100%;max-height:88vh;overflow:auto;background:rgba(14,11,20,.98);'
    + 'border:1px solid rgba(212,175,55,.5);border-radius:14px;padding:1.1rem 1.2rem;box-shadow:0 18px 60px rgba(0,0,0,.7)">'
    + '<div style="font-family:Cinzel,serif;font-weight:800;font-size:1.15rem;color:#ffe6b0;letter-spacing:.06em">'
    + '🤝 Do business with ' + esc(partnerName) + '</div>'
    + '<div class="small-text" style="color:#b59a66;margin:.35rem 0 .9rem">'
    + 'A standing deal. Every ' + CYCLE_HOURS + ' hours a shipment leaves each city, until the term ends.'
    + ' Nothing moves until ' + esc(partnerName) + ' accepts.</div>'

    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">'
    +   '<div><div class="small-text" style="color:#9fc48a;font-weight:700;margin-bottom:.25rem">📤 YOU SEND</div>'
    +     '<select id="ct-give-res" style="width:100%;padding:.45rem;border-radius:7px;background:rgba(0,0,0,.4);color:#ffe6b0;border:1px solid rgba(212,175,55,.35)">'
    +       resourceOptions(rid) + '</select>'
    +     '<input id="ct-give-units" type="number" min="0" max="' + MAX_UNITS + '" value="0" '
    +       'style="width:100%;margin-top:.35rem;padding:.45rem;border-radius:7px;background:rgba(0,0,0,.4);color:#ffe6b0;border:1px solid rgba(212,175,55,.35)"></div>'
    +   '<div><div class="small-text" style="color:#e0c070;font-weight:700;margin-bottom:.25rem">📥 YOU RECEIVE</div>'
    +     '<select id="ct-want-res" style="width:100%;padding:.45rem;border-radius:7px;background:rgba(0,0,0,.4);color:#ffe6b0;border:1px solid rgba(212,175,55,.35)">'
    +       resourceOptions(rid) + '</select>'
    +     '<input id="ct-want-units" type="number" min="0" max="' + MAX_UNITS + '" value="0" '
    +       'style="width:100%;margin-top:.35rem;padding:.45rem;border-radius:7px;background:rgba(0,0,0,.4);color:#ffe6b0;border:1px solid rgba(212,175,55,.35)"></div>'
    + '</div>'

    + '<div style="margin-top:.9rem"><div class="small-text" style="color:#b59a66;font-weight:700;margin-bottom:.25rem">FOR HOW LONG</div>'
    +   '<div id="ct-days" style="display:flex;gap:.4rem;flex-wrap:wrap">'
    +     DAY_CHOICES.map((d, i) => '<button data-d="' + d + '" style="cursor:pointer;padding:.4rem .7rem;border-radius:7px;'
    +       'border:1px solid rgba(212,175,55,' + (i === 1 ? '.9' : '.3') + ');background:rgba(212,175,55,' + (i === 1 ? '.22' : '.06')
    +       + ');color:#ffcf5a;font-weight:700">' + d + (d === 1 ? ' day' : ' days') + '</button>').join('')
    +   '</div></div>'

    /* The preview exists because "3 days" and "6 shipments of 200" are the same
       deal and only the second one tells you what you are committing. A player
       agreeing to 30 days at 500/cycle is agreeing to 30,000 units. */
    + '<div id="ct-preview" style="margin-top:.9rem;padding:.6rem .7rem;border-radius:8px;'
    +   'background:rgba(40,32,12,.3);border:1px solid rgba(212,175,55,.22);color:#e8d9b0;font-size:.9rem"></div>'

    + '<div style="display:flex;gap:.6rem;margin-top:1rem;justify-content:flex-end">'
    +   '<button id="ct-cancel" style="cursor:pointer;padding:.55rem 1rem;border-radius:8px;border:1px solid rgba(150,150,170,.35);background:rgba(0,0,0,.3);color:#cfd8e6;font-weight:700">Cancel</button>'
    +   '<button id="ct-send" style="cursor:pointer;padding:.55rem 1.1rem;border-radius:8px;border:1px solid rgba(212,175,55,.6);background:rgba(212,175,55,.18);color:#ffcf5a;font-weight:800">Send proposal</button>'
    + '</div></div>';

  document.body.appendChild(ov);

  let days = DAY_CHOICES[1];
  const $ = (id) => ov.querySelector('#' + id);
  const refresh = () => {
    const gu = Math.max(0, Number($('ct-give-units').value) || 0);
    const wu = Math.max(0, Number($('ct-want-units').value) || 0);
    const n = shipmentCount(days);
    const gm = (b.meta && b.meta($('ct-give-res').value)) || {};
    const wm = (b.meta && b.meta($('ct-want-res').value)) || {};
    $('ct-preview').innerHTML = n === 0
      ? '<span style="color:#ff9a6b">That term is shorter than one ' + CYCLE_HOURS + '-hour cycle — nothing would ship.</span>'
      : '<b>' + n + '</b> shipment' + (n === 1 ? '' : 's') + ' over <b>' + days + '</b> day' + (days === 1 ? '' : 's') + '.<br>'
        + 'You send <b>' + (gu * n).toLocaleString() + '</b>× ' + esc(gm.name || '—') + ' in total'
        + ' and receive <b>' + (wu * n).toLocaleString() + '</b>× ' + esc(wm.name || '—') + '.'
        + '<div class="small-text" style="color:#b59a66;margin-top:.3rem">Each shipment draws from your city, then your vault, then your Bank of Ethos.</div>';
  };
  ov.querySelectorAll('#ct-days button').forEach(btn => {
    btn.onclick = () => {
      days = Number(btn.dataset.d) || 1;
      ov.querySelectorAll('#ct-days button').forEach(o => {
        const on = o === btn;
        o.style.borderColor = 'rgba(212,175,55,' + (on ? '.9' : '.3') + ')';
        o.style.background = 'rgba(212,175,55,' + (on ? '.22' : '.06') + ')';
      });
      refresh();
    };
  });
  ['ct-give-res', 'ct-want-res', 'ct-give-units', 'ct-want-units']
    .forEach(id => { const el = $(id); if (el) { el.oninput = refresh; el.onchange = refresh; } });
  $('ct-cancel').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  $('ct-send').onclick = async () => {
    const gu = Math.max(0, Number($('ct-give-units').value) || 0);
    const wu = Math.max(0, Number($('ct-want-units').value) || 0);
    if (gu === 0 && wu === 0) { b.toast && b.toast('🤝 Set at least one side of the deal.', 3600); return; }
    if (shipmentCount(days) === 0) { b.toast && b.toast('🤝 That term is shorter than one cycle.', 3600); return; }
    const btn = $('ct-send'); btn.disabled = true; btn.textContent = 'Sending…';
    const ok = await (b.propose ? b.propose({
      target: t,
      givesResource: $('ct-give-res').value, givesUnits: gu,
      wantsResource: $('ct-want-res').value, wantsUnits: wu,
      cycleHours: CYCLE_HOURS, days: days,
    }) : Promise.resolve(false));
    if (ok) { b.toast && b.toast('🤝 Proposal sent to ' + partnerName + '. Nothing ships until they accept.', 5200); close(); }
    else { btn.disabled = false; btn.textContent = 'Send proposal'; }
  };
  refresh();
}

export function close() {
  try { const o = document.getElementById('citytrade-overlay'); if (o) o.remove(); } catch (e) {}
}

/* ── THE SWEEP ──────────────────────────────────────────────────────────────
   Called on city open / sign-in. For every ACTIVE agreement this player is in,
   work out which cycles are due and settle OUR OWN leg of each.

   🔴 WE ONLY EVER SHIP OUR OWN CARGO. The counterparty's leg is their client's
      job — this never writes to their stores and could not if it tried (RLS
      scopes bank_of_ethos to auth.uid()). So a cycle can be half-recorded for a
      while: we delivered, they have not logged in yet. That is honest and is
      what `proposer_sent` / `partner_sent` are for.
   🔴 THE SHIPMENT ROW IS THE LOCK. We insert it; if the partner already did,
      the unique constraint rejects and we treat that as "already recorded" and
      still claim our own side. */
export async function sweep() {
  const b = bridge();
  if (!b || !b.listAgreements) return { settled: 0, short: 0 };
  let settled = 0, short = 0;
  let agreements = [];
  try { agreements = (await b.listAgreements()) || []; } catch (e) { return { settled: 0, short: 0 }; }

  for (const a of agreements) {
    if (!a || a.status !== 'active' || !a.starts_at) continue;
    const mine = b.myUserId && b.myUserId();
    const iAmProposer = a.proposer_id === mine;
    const owedRes = iAmProposer ? a.gives_resource : a.wants_resource;
    const owedUnits = Number(iAmProposer ? a.gives_units : a.wants_units) || 0;

    let done = [];
    try { done = (await b.settledCycles(a.id)) || []; } catch (e) { continue; }
    const { due } = dueCycles(new Date(a.starts_at).getTime(), a.cycle_hours, a.days, b.now ? b.now() : Date.now(), done);
    if (!due.length) continue;

    for (const i of due) {
      const dueAt = cycleDueAt(new Date(a.starts_at).getTime(), a.cycle_hours, i);
      // Nothing owed by us this cycle (a one-way deal, other direction) — still
      // record the cycle so the partner's sweep is not the only writer.
      const have = (b.available && b.available(owedRes)) || { city: 0, vault: 0, boe: 0 };
      const drawn = planDraw(owedUnits, have);

      if (!drawn.ok) {
        short++;
        const msgs = shortfallMessages({
          resourceName: (b.meta && b.meta(owedRes) || {}).name || owedRes,
          partnerName: a.partner_name || 'Your trade partner',
          shortBy: drawn.shortBy,
        });
        try { b.toast && b.toast(msgs.debtor, 7000); } catch (e) {}
        try { b.notifyPartner && await b.notifyPartner(a, msgs.creditor); } catch (e) {}
        try {
          await b.recordShipment(a.id, i, dueAt, {
            sent: 0, from: {}, iAmProposer,
            outcome: outcomeOf(iAmProposer ? false : true, iAmProposer ? true : false),
          });
        } catch (e) {}
        continue;
      }
      /* Take FIRST, record second. If the write fails we have already moved
         cargo, so the bridge's take() is the unwinding one — same contract as
         /src/trading/settle.js, where a failed leg rolls back every leg taken.
         Recording a shipment we did not ship would be the worse direction. */
      const took = (b.take && await b.take(owedRes, drawn.plan)) || false;
      if (!took) { short++; continue; }
      try {
        await b.recordShipment(a.id, i, dueAt, {
          sent: drawn.total, from: drawn.plan, iAmProposer, outcome: 'settled',
        });
        settled++;
        try { b.truck && b.truck(a, owedRes, drawn.total); } catch (e) {}
      } catch (e) {
        // The row already existed (partner beat us to it) — our cargo still
        // left, and our claim below is what stops us shipping it twice.
        settled++;
      }
    }
  }
  return { settled, short };
}

const API = { open, close, sweep, CYCLE_HOURS };
try { if (typeof window !== 'undefined') window.MythicCityTrade = API; } catch (e) {}
export default API;
