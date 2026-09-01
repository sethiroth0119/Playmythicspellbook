/* ══════════════════════════════════════════════════════════════════════════
   🏠 THE BUILDING DOSSIER — address, zone, level, residents and the money.
   ──────────────────────────────────────────────────────────────────────────
   node-city's dossier (index.html's openInspect) already knew a great deal
   about a building: its rates, its efficiency terms, its risk, its ledger.
   What it could not say was the first thing anyone asks about a building —
   WHERE IS IT and WHO IS IN IT. This module answers those two, and the money
   lines that hang off them, and nothing else.

   WHAT IT ADDS TO THE PANEL
     · the HEADER becomes an address: "118 Row 8" for a home,
       "Deepcut Mining Co., 121 Row 4" for a business.
     · an ADDRESS card: a mood strip, ZONE, LEVEL as PIPS, RESIDENTS or STAFF,
       HOUSEHOLD WEALTH.
     · a BOOKS card: Income / Rent / Building Upkeep / Resource Cost / Fees
       Paid, per accounting cycle, with the two this city cannot answer marked
       unavailable rather than guessed. See books.js.
     · a HOUSEHOLD card: the named family living at the address, each row a
       real citizen whose name opens the citizen dialogue that already exists.

   🔴 THE GLOBALS TRAP (CLAUDE.md), and this is the fifth module to hit it.
      `game`, `BUILDINGS`, `tileMult`, `lotValue`, `genOf`, `staffingRatio`,
      `logEsc` and everything else this file uses are top-level `const` inside
      node-city's module script. They are LEXICAL bindings — they are NOT on
      window and an ES module cannot see them. `mount(ctx)` IS the hand-over.
      Nothing below reaches for a bare global except the three OPTIONAL SIBLING
      LAYERS (citizens, streets, zoning), and every one of those is read
      through a duck-typed probe that tolerates absence.

   🔴 WHAT IT DOES NOT DO. It never writes. Not to game.tiles, not to a
      citizen, not to the save. There is no new save field — every fact here is
      derived from state that is already persisted, which is why a save written
      before this module opens with addresses in it and a save written after
      opens in a build without it. That is the entire compatibility story.

   🔴 IT NEVER THROWS INTO openInspect. Every entry point is wrapped by the
      caller AND returns '' / null on its own failure, because a dossier that
      cannot render its address card must still render the rest of the dossier.
      A 404 on this file costs the player these three cards and nothing else.
   ══════════════════════════════════════════════════════════════════════════ */

import { addressOf } from './address.js';
import { householdOf, workersOf, moodBand, averageMood, surnameOf, _flush } from './household.js';
import { zoneOf, wealthOf } from './zone.js';
import { booksOf } from './books.js';

export const V = 1;

let C = null;                       // the ctx hand-over. null ⇒ not mounted.

const esc = (s) => {
  try { return C && C.esc ? C.esc(s) : String(s == null ? '' : s); }
  catch (e) { return ''; }
};

/* ── styling ────────────────────────────────────────────────────────────────
   Everything is scoped under #inspect and prefixed `dsr-`, so it cannot reach
   any other panel and cannot collide with a sibling module's classes. The
   palette is read from the page's own custom properties (--gold, --bone,
   --mist, --valid, --ember, --invalid) rather than restated, so this card
   changes colour with the rest of the dossier and not against it.
   ⚠ The pips and the mood strip are the two things this module draws that the
     panel had no vocabulary for. Everything else reuses insCardHtml / insFac /
     .wfrow, which is why these cards sit inside the existing language instead
     of beside it. */
const CSS = `
#inspect .dsr-mood{display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:8px;
  margin:0 0 11px;border:1px solid currentColor;background:rgba(255,255,255,.035);}
#inspect .dsr-mood .fc{font-size:16px;line-height:1;flex:none;}
#inspect .dsr-mood .lb{font-family:'Cinzel',Georgia,serif;font-size:10px;letter-spacing:.14em;
  text-transform:uppercase;flex:none;}
#inspect .dsr-mood .bar{flex:1;min-width:40px;height:6px;border-radius:3px;
  background:rgba(255,255,255,.09);overflow:hidden;}
#inspect .dsr-mood .bar > i{display:block;height:100%;background:currentColor;}
#inspect .dsr-mood .vv{flex:none;font-size:11.5px;font-variant-numeric:tabular-nums;opacity:.9;}
#inspect .dsr-mood.good{color:var(--valid,#5ac47a);}
#inspect .dsr-mood.warn{color:var(--gold,#d4af37);}
#inspect .dsr-mood.bad{color:var(--ember,#e0873f);}
#inspect .dsr-mood.fl{color:var(--mist,#8b8299);}

#inspect .dsr-pips{display:inline-flex;gap:3px;align-items:center;vertical-align:middle;margin-left:9px;}
#inspect .dsr-pips i{width:15px;height:9px;border-radius:2px;background:#241d33;
  border:1px solid rgba(255,255,255,.09);}
#inspect .dsr-pips i.on{background:linear-gradient(180deg,#f2dc9c,#d4af37);
  border-color:rgba(212,175,55,.75);box-shadow:0 0 5px rgba(212,175,55,.35);}

#inspect .dsr-fam{display:flex;align-items:center;gap:9px;padding:2px 0 9px;
  border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:3px;}
#inspect .dsr-fam .nm{flex:1;min-width:0;font-size:12.5px;color:var(--bone,#e8dcc0);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#inspect .dsr-fam .cnt{flex:none;font-size:10px;font-variant-numeric:tabular-nums;
  padding:2px 8px;border-radius:20px;background:rgba(212,175,55,.13);color:var(--gold,#d4af37);
  border:1px solid rgba(212,175,55,.35);}
#inspect .dsr-un{color:var(--mist,#8b8299);opacity:.75;}
#inspect .dsr-sub{display:block;font-size:10px;color:var(--mist,#8b8299);line-height:1.4;
  margin-top:2px;overflow-wrap:anywhere;}
#inspect .dsr-fac{display:block;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.055);}
#inspect .dsr-fac:last-child{border-bottom:0;}
#inspect .dsr-fac .tp{display:flex;justify-content:space-between;align-items:baseline;gap:10px;}
#inspect .dsr-fac .tp > .l{font-family:'Cinzel',Georgia,serif;font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:#8b8299;min-width:0;overflow-wrap:anywhere;}
#inspect .dsr-fac .tp > .v{font-size:13px;font-variant-numeric:tabular-nums;color:var(--bone,#e8dcc0);
  text-align:right;white-space:nowrap;}
#insname .dsr-addr{font-family:'Crimson Text',Georgia,serif;font-size:14px;color:#d8c9a4;
  letter-spacing:.02em;font-weight:400;}
`;
function ensureCss() {
  try {
    if (typeof document === 'undefined') return;
    if (document.getElementById('dsr-css')) return;
    const s = document.createElement('style');
    s.id = 'dsr-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  } catch (e) {}
}

/* ── small renderers ──────────────────────────────────────────────────────── */

/* One labelled row. Deliberately NOT insFac: the eyebrow-over-value shape with
   a source line underneath is what makes six dense rows legible at a glance,
   and insFac is a single line with no room for the "where this came from"
   sentence that every row in this panel owes the reader. */
function facRow(label, value, cls, sub) {
  return '<div class="dsr-fac"><div class="tp"><span class="l">' + label + '</span>' +
    '<span class="v ' + (cls || '') + '">' + value + '</span></div>' +
    (sub ? '<span class="dsr-sub">' + sub + '</span>' : '') + '</div>';
}

/* LEVEL AS A METER, not a number — rubric dimension 12. The pip count is the
   building's OWN maximum (def.maxLvl, falling back to the global MAX_LVL);
   index.html paid for that distinction once already, when a Tier-4 Resting
   House read "Level 4 / 3". */
function pips(lvl, max) {
  let h = '';
  for (let i = 0; i < max; i++) h += '<i' + (i < lvl ? ' class="on"' : '') + '></i>';
  return '<span class="dsr-pips" role="img" aria-label="level ' + lvl + ' of ' + max + '">' + h + '</span>';
}

function moodStrip(people, whoLabel) {
  const a = averageMood(people);
  if (!a.n) return '';
  const b = moodBand(a.v);
  return '<div class="dsr-mood ' + b.tone + '"><span class="fc">' + b.face + '</span>' +
    '<span class="lb">' + b.label + '</span>' +
    '<span class="bar"><i style="width:' + Math.round(Math.max(0, Math.min(100, a.v))) + '%"></i></span>' +
    '<span class="vv">' + Math.round(a.v) + ' <span style="opacity:.6">/ 100 · ' + whoLabel + '</span></span></div>';
}

/* A citizen row. `.wfrow[data-cit]` is not a new control: index.html already
   delegates a click on exactly that selector, anywhere inside #inspanes, to
   openCitTalk. Reusing the selector is what makes a household member's name
   open the SAME dialogue their workplace roster opens, with no second listener
   and no new hook. */
function personRow(c) {
  const m = Number.isFinite(c.mood) ? c.mood : null;
  let col = 'var(--mist)';
  try { col = m == null ? 'var(--mist)' : C.pctCol(m / 100); } catch (e) {}
  return '<button type="button" class="wfrow" data-cit="' + esc(c.id) + '" title="Talk to ' + esc(c.name) + '">' +
    '<span class="wfn">👤 ' + esc(c.name) + '</span>' +
    '<span class="wfb"><i style="width:' + (m == null ? 0 : Math.round(m)) + '%;background:' + col + '"></i></span>' +
    '<span class="wfv" style="color:' + col + '">' + (m == null ? '—' : Math.round(m)) + '</span></button>';
}

function streetNote(addr) {
  if (!addr || !addr.ok) return '';
  if (addr.source === 'streets') return 'Street name from the streets layer.';
  return 'No streets layer is loaded, so the street is NUMBERED by the grid line this building fronts ' +
    '(streets run east–west, avenues north–south). The house number is derived either way: ' +
    (addr.side === 'odd' ? 'odd' : 'even') + ' side, ascending along the street.';
}

/* ── the public renderers ─────────────────────────────────────────────────── */

/* THE HEADER. The reference titles a home with its address alone and a
   business with "Business Name, Address" — and index.html's own comment at the
   header (`def.name is the blueprint; the player named this one`) is the
   concept this extends rather than replaces: `base` is whatever that line
   already resolved to, operation label included. Returns null when there is no
   address, and the caller then prints exactly what it printed before. */
export function headerHtml(k, base) {
  if (!C) return null;
  try {
    const t = C.game.tiles[k];
    if (!t) return null;
    const def = C.BUILDINGS[t.type] || {};
    const addr = addressOf(C, k);

    // A road IS the street. Title it with the street, not with "Road".
    if (addr.why === 'isroad') {
      return esc(addr.street) + (addr.crossing ? ' <span class="dsr-addr">crossing</span>' : '');
    }
    if (!addr.ok) return null;

    /* A home is titled with its address ALONE — but only when the name it was
       handed is the blueprint's. The original rule here was "a home has no
       name", which was true of a building whose title could only ever be the
       word "Housing": saying that above an address tells the reader nothing.
       /src/naming lands in the same round and gives a residential block a name
       of its own ("Ashgrove Court"), which is NOT the blueprint and IS worth
       the line — so the test is "is this still just the blueprint?", not "is
       this a home?". With no naming module the two questions have the same
       answer and this behaves exactly as it did. */
    const isHome = def.popCap > 0 && !def.gen && !def.svc;
    const named = base && def.name && String(base).trim() !== String(def.name).trim();
    if (isHome && !named) return '<span class="dsr-addr">' + esc(addr.text) + '</span>';
    return esc(base) + '<span class="dsr-addr">, ' + esc(addr.text) + '</span>';
  } catch (e) { return null; }
}

/* THE CARDS, in TWO columns, because the reference is two panels side by side
   and because one column of five cards runs past the fold at 1280. The
   building's own facts go left, under the description; the people go right,
   at the top of the column the Risk and Systems cards already live in.
   Every section is independently guarded: a fault in the household deal must
   not cost the reader the address. */
export function cardsHtml(k) {
  if (!C) return '';
  let out = '';
  try { out += addressCard(k); } catch (e) { out += ''; }
  try { out += booksCard(k); } catch (e) { out += ''; }
  return out;
}
export function sideHtml(k) {
  if (!C) return '';
  try { return householdCard(k); } catch (e) { return ''; }
}

function addressCard(k) {
  const t = C.game.tiles[k];
  if (!t) return '';
  const def = C.BUILDINGS[t.type] || {};
  const p = String(k).split(',');
  const x = +p[0], z = +p[1];
  const addr = addressOf(C, k);
  const zn = zoneOf(C, k, t, x, z);
  const max = def.maxLvl || C.MAX_LVL || 3;
  const lvl = Math.max(1, Math.min(max, t.lvl || 1));

  const isHome = def.popCap > 0;
  const house = isHome ? householdOf(C, k) : null;
  const staff = def.crew ? workersOf(k) : null;
  const people = isHome ? (house && house.ok ? house.members : []) : (staff || []);

  let body = moodStrip(people, isHome ? 'residents' : 'staff');

  body += facRow('Zone', esc(zn.label), '',
    zn.source === 'zoning' ? 'from the zoning layer'
      : 'derived from what this building actually does — no zoning layer is loaded');

  body += facRow('Level', lvl + ' <small style="color:var(--mist)">/ ' + max + '</small>' + pips(lvl, max),
    '', max === 1 ? 'this building has only one level' : 'each level multiplies its rates ×' + (C.RATE_MULT || 2));

  if (isHome) {
    if (!house || !house.ok) {
      body += facRow('Residents', '<span class="dsr-un">unavailable</span>', 'fl',
        'the citizens layer did not answer — this is a fault in the panel, not an empty house');
    } else {
      const beds = (def.popCap | 0) * lvl;
      body += facRow('Residents', house.members.length + ' <small style="color:var(--mist)">/ ' + beds + ' beds</small>', '',
        house.members.length
          ? 'named people the city has put in this house'
          : 'no named citizen lives here yet — the city names a working set of its population, and it has not reached this house');
    }
    const w = wealthOf(C, k, t, x, z);
    if (w) body += facRow('Household Wealth', esc(w.label), '', esc(w.note || ''));
  }
  if (def.crew) {
    if (!staff) {
      body += facRow('Staff', '<span class="dsr-un">unavailable</span>', 'fl',
        'the citizens layer did not answer; the seats are still crewed out of the city labour pool');
    } else {
      body += facRow('Staff', staff.length + ' <small style="color:var(--mist)">/ ' + (def.crew | 0) + ' seats</small>', '',
        'named people holding a seat here — the full roster is on the Workforce tab');
    }
  }

  const title = addr.ok ? esc(addr.text) : addr.why === 'isroad' ? esc(addr.street) : 'No address';
  const right = addr.ok ? esc(zn.label.split(' — ')[0])
    : addr.why === 'isroad' ? 'this is the street'
    : 'no road frontage';
  const foot = addr.ok
    ? '<div class="ins-desc" style="margin:10px 0 0">' + esc(streetNote(addr)) +
      ' It fronts the road on tile ' + esc(addr.road) + '.</div>'
    : addr.why === 'nofrontage'
      ? '<div class="ins-desc" style="margin:10px 0 0">This building touches no road, so it has no address. ' +
        'Lay a road beside it and it takes a number on that street — and its producers work ' +
        'faster for the same reason.</div>'
      : '';
  return C.card('🏠 ' + title, right, body + foot);
}

function booksCard(k) {
  const t = C.game.tiles[k];
  if (!t || t.type === 'road') return '';
  const B = booksOf(C, k);
  if (!B) return '';
  let body = B.rows.map(r => facRow(esc(r.label),
    (r.un ? '<span class="dsr-un">' : '<span>') + (r.raw ? r.value : esc(r.value)) + '</span>',
    r.cls, esc(r.sub || ''))).join('');
  if (B.lifetime.ok) {
    body += facRow('Lifetime, measured', (B.lifetime.net >= 0 ? '<span class="up">+' : '<span class="dn">−') +
      Math.round(Math.abs(B.lifetime.net)).toLocaleString() + ' 🔥</span>', '',
      'earned ' + Math.round(B.lifetime.earn).toLocaleString() + ' 🔥 against ' +
      Math.round(B.lifetime.spent).toLocaleString() + ' 🔥 invested, banked tile by tile since it was raised');
  }
  body += '<div class="ins-desc" style="margin:10px 0 0">' + B.notes.map(esc).join(' ') + '</div>';
  return C.card('💰 The books', 'per cycle · ' + B.cycle + ' real min', body);
}

function householdCard(k) {
  const t = C.game.tiles[k];
  if (!t) return '';
  const def = C.BUILDINGS[t.type] || {};
  if (!(def.popCap > 0)) return '';
  const addr = addressOf(C, k);
  const house = householdOf(C, k);

  if (!house.ok) {
    return C.card('👥 Household', 'unavailable',
      C.alert('bad', '⚠', 'Could not read the citizen roster',
        'The citizens layer did not answer. This is a fault in the panel, <b>not</b> an empty house — ' +
        'the beds here still count toward the city’s population either way.'));
  }
  if (!house.members.length) {
    return C.card('👥 Household', 'nobody named yet',
      '<div class="ins-desc" style="margin:0"><b>No named citizen lives here yet.</b> ' +
      'The city puts names to a working set of its population and settles them into the housing it can reach ' +
      'as that set grows. This address is real and its beds count; it simply has no named household in it.</div>');
  }
  const rows = house.members.map(personRow).join('');
  const a = averageMood(house.members);
  return C.card('👥 ' + (addr.ok ? esc(addr.text) : 'Household'),
    house.members.length + (house.members.length === 1 ? ' resident' : ' residents'),
    '<div class="dsr-fam"><span class="nm">👥 ' + esc(house.name) + '</span>' +
    '<span class="cnt">' + house.members.length + '</span></div>' + rows +
    '<div class="ins-desc" style="margin:9px 0 0">Each bar is that person’s own <b>mood</b>, 0–100' +
    (a.n ? ' — this household averages ' + Math.round(a.v) : '') + '. Click a name to talk to them. ' +
    (house.family
      ? 'They share a surname, so this household is a family.'
      : 'They share an address rather than a name, so it is a household, not a family.') +
    ' Residence is worked out from the roster and the housing stock, so building or clearing housing can move people.</div>');
}

/* ── mount ────────────────────────────────────────────────────────────────── */
export function mount(ctx) {
  C = ctx || null;
  ensureCss();
  const api = {
    V,
    headerHtml, cardsHtml, sideHtml,
    // read seam — everything the panel prints, callable from a test
    addressOf: (k) => { try { return addressOf(C, k); } catch (e) { return null; } },
    zoneOf: (k) => { try { const t = C.game.tiles[k], p = String(k).split(','); return t ? zoneOf(C, k, t, +p[0], +p[1]) : null; } catch (e) { return null; } },
    wealthOf: (k) => { try { const t = C.game.tiles[k], p = String(k).split(','); return t ? wealthOf(C, k, t, +p[0], +p[1]) : null; } catch (e) { return null; } },
    householdOf: (k) => { try { return householdOf(C, k); } catch (e) { return null; } },
    workersOf: (k) => { try { return workersOf(k); } catch (e) { return null; } },
    booksOf: (k) => { try { return booksOf(C, k); } catch (e) { return null; } },
    surnameOf, moodBand,
    flush: _flush,
    _ctx: () => C,
  };
  try { window.MythicDossier = api; } catch (e) {}
  return api;
}
