/* ════════════════════════════════════════════════════════════════════════════
   🏢 THE TENANT MARKET PANEL — who is bidding, who is trading, who has failed.
   ----------------------------------------------------------------------------
   Three sections, and the third one is the reason this panel exists.

   1. THE MARKET — how many companies are looking, how many lots they are
      looking at, and the ratio between them. That ratio IS the feature: more
      candidates than lots is what makes it competition rather than allocation.
   2. THE TENANTS — every let lot, its company, its size, its firm's rung and
      the level its business has actually reached.
   3. THE LEDGER — every business that has failed here, with how long it lasted
      and why. And under it, the two lists this project has learned to print:
      WHAT IS SCORED with the live call behind each factor, and WHAT IS NOT,
      with the reason. An omission the player cannot see is indistinguishable
      from an oversight; a factor with no source printed is indistinguishable
      from an invention.

   🔴 THIS FILE COMPUTES NOTHING. Every number is read off the API. That is the
      same rule /src/economy's render.js ships under ("Markup only. No number is
      computed here") and it is what stops a panel and its model drifting.
   ══════════════════════════════════════════════════════════════════════════ */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let host = null, el = null, open = false;

export function mount(h) {
  host = h || {};
  style();
  return true;
}
export function isOpen() { return open; }

function style() {
  const doc = (typeof document !== 'undefined') ? document : null;
  if (!doc || !doc.head || doc.getElementById('ntn-style')) return;
  const st = doc.createElement('style');
  st.id = 'ntn-style';
  st.textContent = `
#ntn-panel{position:fixed;right:14px;top:74px;width:390px;max-height:76vh;overflow:auto;z-index:60;
  background:rgba(14,13,18,.94);border:1px solid rgba(212,175,55,.34);border-radius:12px;
  padding:12px 13px;color:var(--bone,#e9e0cc);font-size:12px;line-height:1.4;
  box-shadow:0 18px 44px rgba(0,0,0,.55);backdrop-filter:blur(7px)}
#ntn-panel h3{margin:0 0 8px;font-size:13px;letter-spacing:.1em;color:var(--gold,#d4af37);
  display:flex;align-items:center;justify-content:space-between}
#ntn-panel h3 button{background:none;border:0;color:var(--mist,#8f87a3);cursor:pointer;font-size:15px}
#ntn-panel .ntsec{margin:10px 0 0;border-top:1px solid rgba(255,255,255,.08);padding-top:8px}
#ntn-panel .ntsec>b{display:block;color:var(--gold,#d4af37);font-size:10px;letter-spacing:.13em;margin-bottom:5px}
#ntn-panel .ntrow{display:flex;justify-content:space-between;gap:8px;padding:2px 0}
#ntn-panel .ntrow span:last-child{color:#fff;white-space:nowrap}
#ntn-panel .ntmute{color:var(--mist,#8f87a3)}
#ntn-panel .nttab{width:100%;border-collapse:collapse}
#ntn-panel .nttab td{padding:2px 4px 2px 0;vertical-align:top}
#ntn-panel .nttab td.n{color:#fff}
#ntn-panel .ntpill{display:inline-block;border-radius:5px;padding:0 5px;font-size:10px;
  border:1px solid rgba(255,255,255,.18)}
#ntn-panel .ntfail{color:#e0556a}
#ntn-panel .ntok{color:#9ad17a}
#ntn-panel .ntwarn{color:#e0a060}
#ntn-panel .ntsrc{color:var(--mist,#8f87a3);font-size:10.5px;margin:1px 0 5px 12px}
#ntn-panel .ntno{color:#c9a0a0;font-size:10.5px;margin:1px 0 5px 12px}`;
  doc.head.appendChild(st);
}

export function show() {
  const doc = (typeof document !== 'undefined') ? document : null;
  if (!doc) return false;
  if (!el) {
    el = doc.createElement('div');
    el.id = 'ntn-panel';
    doc.body.appendChild(el);
  }
  open = true;
  el.style.display = '';
  render();
  return true;
}
export function hide() { open = false; if (el) el.style.display = 'none'; return true; }

export function render() {
  if (!el || !open || !host || !host.api) return;
  const API = host.api();
  if (!API || !API.ready()) { el.innerHTML = '<h3>🏢 Tenant market</h3><div class="ntmute">Not mounted.</div>'; return; }
  const s = API.stats();
  const fails = API.failures();
  const src = API.sources();
  const omit = API.omitted();
  const RUNG = { HEALTHY: 'ntok', REDUCED: 'ntwarn', LAYOFFS: 'ntwarn', DEBT: 'ntwarn',
                 DEFAULT: 'ntfail', BANKRUPT: 'ntfail' };

  const lets = API._store().lets();
  const rows = Object.keys(lets).sort().map((k) => {
    const t = API.tenantAt(+k.split(',')[0], +k.split(',')[1]);
    if (!t) return '';
    return '<tr><td class="n">' + esc(t.name) + '</td>' +
      '<td class="ntmute">' + esc(t.size.ico + ' ' + t.typeName) + '</td>' +
      '<td class="' + (RUNG[t.rung] || 'ntmute') + '">' + esc(t.rung) + '</td>' +
      '<td>L' + (t.level | 0) + '</td></tr>';
  }).join('');

  const failRows = fails.slice().reverse().slice(0, 12).map((f) =>
    '<tr><td class="n">' + esc(f.n) + '</td><td class="ntmute">' + esc(f.k) + '</td>' +
    '<td class="ntmute">' + f.days + 'd</td><td class="ntfail">' + esc(f.rung) + '</td></tr>').join('');

  const pool = s.pool || { candidates: 0, unhoused: 0 };
  el.innerHTML =
    '<h3>🏢 Tenant market <button id="ntn-x">✕</button></h3>' +
    '<div class="ntsec"><b>THE MARKET</b>' +
      row('Companies looking', pool.unhoused + ' of ' + pool.candidates) +
      row('Lots let', s.tenancies) +
      row('Lots nobody will take', s.vacant + (s.vacant ? ' ✕' : '')) +
      row('Businesses opened here', s.lifetime.let) +
      row('Businesses failed here', '<span class="' + (s.lifetime.failed ? 'ntfail' : 'ntmute') + '">' + s.lifetime.failed + '</span>') +
      row('Catchment radius', API.radius() + ' tiles') +
    '</div>' +
    '<div class="ntsec"><b>TENANTS</b>' +
      (rows ? '<table class="nttab">' + rows + '</table>'
            : '<div class="ntmute">Nobody has taken a zoned lot yet.</div>') +
    '</div>' +
    '<div class="ntsec"><b>WHO HAS FAILED HERE</b>' +
      (failRows ? '<table class="nttab">' + failRows + '</table>'
                : '<div class="ntmute">No business has failed in this city.</div>') +
    '</div>' +
    '<div class="ntsec"><b>WHAT A BID SCORES — AND WHAT IT ASKED</b>' +
      Object.keys(src).map((k) =>
        '<div><b class="ntmute">' + esc(k) + '</b></div><div class="ntsrc">' + esc(src[k]) + '</div>').join('') +
    '</div>' +
    '<div class="ntsec"><b>NOT SCORED, AND WHY</b>' +
      omit.map((o) => '<div><b class="ntmute">' + esc(o.name) + '</b></div><div class="ntno">' + esc(o.why) + '</div>').join('') +
    '</div>';

  const x = document.getElementById('ntn-x');
  if (x) x.onclick = () => { try { host.close && host.close(); } catch (e) {} };
}

function row(label, v) {
  return '<div class="ntrow"><span class="ntmute">' + esc(label) + '</span><span>' + v + '</span></div>';
}

export default { mount, show, hide, isOpen, render };
