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
const DEFAULT_DAY_IX = 1;                     // 3 days — long enough to see it work, short enough to risk
const MAX_UNITS = 9999;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ── THE DIALOG ─────────────────────────────────────────────────────────── */

/* Everything a city could put on a truck, in two named groups.
   The first build offered only index.html's RESOURCES — 70 camp goods — which
   is the wrong catalogue for a CITY trade: what a city actually produces is the
   258-entry resource chain, and those are the goods takeForExport() draws from.
   Both are offered because the three stores speak both id spaces: the vault and
   the Bank of Ethos hold camp resources, the city economy holds chain goods,
   and the 56 promoted ids are in both.

   <optgroup> rather than one flat list of 300+: a native select is searchable
   and keyboard-navigable, and grouping is what makes that usable instead of a
   wall. Chain goods are grouped by their own `cat` for the same reason. */
function catalogue() {
  const b = bridge();
  const out = [];
  const camp = (b && b.resources && b.resources()) || [];
  if (camp.length) out.push({ label: 'Camp resources', items: camp.filter(r => r && r.id) });
  const chain = (b && b.chainResources && b.chainResources()) || [];
  if (chain.length) {
    const seen = Object.create(null);
    for (const r of camp) if (r && r.id) seen[r.id] = 1;
    const byCat = new Map();
    for (const r of chain) {
      if (!r || !r.id || seen[r.id]) continue;      // promoted ids already listed above
      const c = r.cat || 'other';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(r);
    }
    for (const [c, items] of [...byCat.entries()].sort((a, z) => a[0].localeCompare(z[0]))) {
      out.push({ label: 'City goods · ' + c, items });
    }
  }
  return out;
}

function resourceOptions(selected) {
  const groups = catalogue();
  const opt = (r) => '<option value="' + esc(r.id) + '"' + (r.id === selected ? ' selected' : '') + '>'
    + esc((r.icon ? r.icon + ' ' : '') + (r.name || r.id)) + '</option>';
  return groups.map(g =>
    '<optgroup label="' + esc(g.label) + '">' + g.items.map(opt).join('') + '</optgroup>').join('');
}

function firstResourceId() {
  const g = catalogue();
  return (g[0] && g[0].items[0] && g[0].items[0].id) || '';
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

  const rid = firstResourceId();

  /* Built as an ARRAY of lines rather than one long `+` chain. The first
     version was a chain, and a line that began with a structural `+` next to an
     existing one produced `+ +'…'` — a unary plus on a string, i.e. NaN — which
     left a style attribute unterminated and collapsed all five day buttons into
     one unlabelled pill. Nothing flagged it: it is valid JavaScript and valid
     (if wrong) HTML. An array cannot make that mistake. */
  const S = {
    field: 'width:100%;padding:.5rem .7rem;border-radius:6px;background:var(--bg-deep,#0e0b14);'
         + 'border:1px solid var(--border,rgba(212,175,55,.28));color:var(--ink,#ffe6b0);'
         + 'font-family:inherit;font-size:.95rem;transition:border-color .15s',
    // Native select, game-dressed: the browser arrow is replaced with a gold
    // chevron so it stops looking like a form control dropped onto the page.
    select: 'appearance:none;-webkit-appearance:none;background-image:'
          + "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'><path d='M3 5l4 4 4-4' fill='none' stroke='%23d4af37' stroke-width='2' stroke-linecap='round'/></svg>\");"
          + 'background-repeat:no-repeat;background-position:right .55rem center;padding-right:1.9rem',
    label: 'font-size:.72rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;margin-bottom:.3rem',
  };

  const side = (dir, tone, selId, unitId) => [
    '<div>',
      '<div style="' + S.label + ';color:' + tone + '">' + dir + '</div>',
      '<select id="' + selId + '" style="' + S.field + S.select + '">' + resourceOptions(rid) + '</select>',
      '<div style="position:relative;margin-top:.4rem">',
        '<input id="' + unitId + '" type="number" min="0" max="' + MAX_UNITS + '" value="0" inputmode="numeric"',
          ' style="' + S.field + ';padding-right:3.6rem" />',
        '<span style="position:absolute;right:.7rem;top:50%;transform:translateY(-50%);pointer-events:none;',
          'font-size:.68rem;letter-spacing:.08em;color:#8a7a4a">/ CYCLE</span>',
      '</div>',
    '</div>',
  ].join('');

  ov.innerHTML = [
    '<div style="max-width:600px;width:100%;max-height:88vh;overflow:auto;background:linear-gradient(180deg,rgba(18,14,26,.99),rgba(11,9,16,.99));',
      'border:1px solid rgba(212,175,55,.5);border-radius:14px;padding:1.15rem 1.25rem;box-shadow:0 18px 60px rgba(0,0,0,.7)">',

      '<div style="font-family:Cinzel,serif;font-weight:800;font-size:1.18rem;color:#ffe6b0;letter-spacing:.05em">',
        '\u{1F91D} Do business with ' + esc(partnerName),
      '</div>',
      '<div style="height:1px;background:linear-gradient(90deg,rgba(212,175,55,.55),transparent);margin:.55rem 0 .7rem"></div>',
      '<div style="color:#b59a66;font-size:.86rem;line-height:1.45;margin-bottom:1rem">',
        'A standing deal. Every ' + CYCLE_HOURS + ' hours a shipment leaves each city, until the term ends.',
        ' Nothing moves until ' + esc(partnerName) + ' accepts.',
      '</div>',

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem">',
        side('\u{1F4E4} You send', '#9fc48a', 'ct-give-res', 'ct-give-units'),
        side('\u{1F4E5} You receive', '#e0c070', 'ct-want-res', 'ct-want-units'),
      '</div>',

      '<div style="margin-top:1rem">',
        '<div style="' + S.label + ';color:#b59a66">For how long</div>',
        '<div id="ct-days" style="display:flex;gap:.4rem;flex-wrap:wrap">',
          DAY_CHOICES.map(function (d, i) {
            const on = i === DEFAULT_DAY_IX;
            return [
              '<button type="button" data-d="' + d + '" style="cursor:pointer;padding:.42rem .8rem;border-radius:999px;',
                'font-family:inherit;font-size:.86rem;font-weight:700;white-space:nowrap;transition:all .15s;',
                'border:1px solid rgba(212,175,55,' + (on ? '.85' : '.28') + ');',
                'background:rgba(212,175,55,' + (on ? '.2' : '.05') + ');',
                'color:' + (on ? '#ffcf5a' : '#b59a66') + '">',
                d + (d === 1 ? ' day' : ' days'),
              '</button>',
            ].join('');
          }).join(''),
        '</div>',
      '</div>',

      /* The preview exists because "3 days" and "6 shipments of 200" are the
         same deal and only the second one tells you what you are committing. */
      '<div id="ct-preview" style="margin-top:1rem;padding:.7rem .8rem;border-radius:9px;',
        'background:rgba(40,32,12,.28);border:1px solid rgba(212,175,55,.2);color:#e8d9b0;font-size:.88rem;line-height:1.5"></div>',

      '<div style="display:flex;gap:.6rem;margin-top:1.1rem;justify-content:flex-end">',
        '<button type="button" id="ct-cancel" style="cursor:pointer;padding:.55rem 1.1rem;border-radius:8px;font-family:inherit;font-weight:700;',
          'border:1px solid rgba(150,150,170,.3);background:rgba(0,0,0,.25);color:#cfd8e6">Cancel</button>',
        '<button type="button" id="ct-send" style="cursor:pointer;padding:.55rem 1.25rem;border-radius:8px;font-family:inherit;font-weight:800;',
          'border:1px solid rgba(212,175,55,.6);background:linear-gradient(180deg,rgba(212,175,55,.28),rgba(212,175,55,.12));color:#ffcf5a">Send proposal</button>',
      '</div>',
    '</div>',
  ].join('');

  document.body.appendChild(ov);

  let days = DAY_CHOICES[DEFAULT_DAY_IX];
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
        o.style.borderColor = 'rgba(212,175,55,' + (on ? '.85' : '.28') + ')';
        o.style.background = 'rgba(212,175,55,' + (on ? '.2' : '.05') + ')';
        o.style.color = on ? '#ffcf5a' : '#b59a66';
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
