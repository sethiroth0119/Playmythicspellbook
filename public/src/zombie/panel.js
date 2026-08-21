/* ════════════════════════════════════════════════════════════════════════════
   🧟 THE OUTBREAK CARD — the forecast, rendered.
   ----------------------------------------------------------------------------
   Pure string building. No DOM reads, no globals, no THREE — index.js owns the
   two elements this fills, exactly as node-city owns #ecocard and /src/economy
   owns every byte inside it. Keeping it pure is also what lets the headless
   driver print the card and diff its defence breakdown against raidTick's own
   tally without a browser (criterion 6).

   ── WHAT THE CARD HAS TO SAY, AND WHY EACH LINE IS THERE ──────────────────
   "CS2-grade means the player saw it coming, knew what caused it, knew what
    would stop it, and could afford to."  Four lines, in that order:
      1. THE METER + the beat it resolves on.
      2. THE CAUSE — unburied bodies, the death rate feeding them, the burial
         capacity draining them, and the NET. A meter with no input is a mood.
      3. THE FORECAST — days until the warning, days until the first possible
         outbreak, and the odds. With its assumptions printed, because a
         projection whose assumptions are hidden is a promise nobody made.
      4. WHAT WOULD STOP IT — capacity (lowers the risk), quarantine (absorbs
         strikes), defence (repels the wave), each with its live number.
   ⚠ And the DELTA. tick() returns what moved; the card names it. That is the
     difference between "risk 62" and "risk 62, down 4 since you opened the
     second morgue".
   ════════════════════════════════════════════════════════════════════════════ */

import { ZOM } from './tuning.js';

const esc = (t) => String(t == null ? '' : t)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
const pct = (v) => Math.round(v * 100) + '%';

/* Seconds → the unit the player thinks in. The city day is 20 real minutes, so
   both are worth printing: "1.8 days (36m)". */
export function dur(sec, daySec) {
  if (sec == null) return '—';
  const d = sec / Math.max(1, daySec);
  const m = Math.round(sec / 60);
  const day = d >= 10 ? Math.round(d) : n1(d);
  /* Both units, and the second one labelled `real`. A city day is 20 real
     minutes, so "60 days (20h)" reads as a contradiction unless the card says
     which clock each number is on. */
  return day + (d === 1 ? ' city day' : ' city days') +
    ' (' + (m >= 90 ? n1(m / 60) + 'h' : m + 'm') + ' real)';
}

export function mmss(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* ── The band the meter is in. Drives the colour AND the headline verb, so the
      card never says "Stable" in red. ── */
export function band(f) {
  if (!f.armed) return { id: 'dormant', cls: '', word: 'Dormant' };
  if (f.risk >= ZOM.arm) return { id: 'danger', cls: 'bad', word: 'OUTBREAK LIKELY' };
  if (f.risk >= ZOM.watch) return { id: 'watch', cls: 'warn', word: 'Watch' };
  if (f.risk > 0) return { id: 'low', cls: '', word: 'Low' };
  return { id: 'clear', cls: 'ok', word: 'Clear' };
}

export function timerText(f) {
  return f.armed ? mmss(f.nextCheckIn) : '—';
}

/* ── "raise it with:" — and whether the player can actually raise it yet ────
   `types` is [{ label, lock }] from index.js's burialTypes(); `lock` is the
   research node standing between the player and that building, or null.
   🔴 WHY THIS IS NOT JUST A LIST OF NAMES. The bar for this piece ends "…knew
   what would stop it, AND COULD AFFORD TO". A card that says "raise it with:
   🪦 Graveyard" to a player whose build bar does not have a Graveyard on it
   yet has named a fix they cannot buy, which is the same failure as naming a
   Clinic morgue that buries nobody. When EVERY answer is locked the hint leads
   with the node instead of the buildings, because the node is the thing to go
   and do. Backwards-compatible with a bare string entry, so an older caller
   still renders. */
function burialHint(types) {
  if (!types || !types.length) return '';
  const rows = types.map((t) => (typeof t === 'string' ? { label: t, lock: null } : (t || {})))
                    .filter((t) => t.label);
  if (!rows.length) return '';
  const open = rows.filter((t) => !t.lock);
  const cost = (l) => l.cost > 0 ? ' — ' + l.cost + ' pt' + (l.cost === 1 ? '' : 's') : '';
  if (!open.length) {
    /* Every distinct node blocking every answer, deduped — usually exactly one. */
    const seen = [];
    for (const t of rows) if (!seen.some((s) => s.name === t.lock.name)) seen.push(t.lock);
    return ' <span class="warn">— locked: research <b>' +
      seen.map((l) => esc(l.name) + cost(l)).join('</b> or <b>') + '</b> 🌳 to unlock ' +
      rows.map((t) => esc(t.label)).join(', ') + '</span>';
  }
  return ' <span class="mut">— raise it with: ' + open.map((t) => esc(t.label)).join(', ') +
    (open.length < rows.length
      ? ' <span class="warn">(' + rows.filter((t) => t.lock)
          .map((t) => esc(t.label) + ' needs ' + esc(t.lock.name) + cost(t.lock)).join('; ') + ')</span>'
      : '') + '</span>';
}

/* `f` is risk.forecast(); `x` is the live context the model does not own:
   { cap, shield, def, delta, src, waves, deaths, interred, cemeteryTypes } */
export function render(f, x) {
  const b = band(f);
  const L = [];

  /* 1 ── THE METER ────────────────────────────────────────────────────────── */
  L.push('<b class="' + b.cls + '">' + esc(b.word) + '</b> · outbreak risk <b class="' + b.cls + '">' +
    Math.round(f.risk) + '</b>/100' +
    (x.delta && Math.abs(x.delta.risk) >= 0.05
      ? ' <span class="' + (x.delta.risk < 0 ? 'ok' : 'bad') + '">' +
        (x.delta.risk < 0 ? '▼' : '▲') + n1(Math.abs(x.delta.risk)) + '</span>'
      : ''));

  /* ── THE DORMANT CASE, NAMED RATHER THAN HIDDEN ────────────────────────────
     The `need` capability row that /src/pollution and /src/landvalue both ship:
     a capability that is absent renders DISABLED and NAMES what it is waiting
     for — never a plausible substitute. There is no burial building in this
     build's BUILDINGS table, so the engine will not roll against a player who
     cannot possibly prevent it, and the card says exactly that.
     🔗 The cemeteries/graveyards round arms this by writing ONE field —
        `deathcare: { inter: n }` — on its own row. No edit here. */
  if (!f.armed) {
    L.push('<span class="mut">No burial building exists in this build, so the outbreak engine is <b>dormant</b> ' +
      'and will not roll. It arms itself the moment a building declares <code>deathcare</code>. ' +
      'Bodies are still being counted: <b>' + Math.round(f.unburied) + '</b> unburied.</span>');
    return L.join('<br>');
  }

  /* 2 ── THE CAUSE ────────────────────────────────────────────────────────── */
  /* 🔴 THE BURIAL FIGURE IS THE ONE THE GROUND PERMITS, not the one the
     buildings could manage if they had somewhere to dig. A city whose last plot
     is taken buries NOBODY, and printing its nameplate rate beside a backlog
     that is climbing is how the card came to contradict itself in adjacent
     lines: "3/24 plots free" with no time on it, and a net that said the player
     was fine. `effCapPerDay` is 0 once the ground is gone; the nameplate is
     kept in the parenthetical so the player can see WHICH limit is biting,
     because the fixes are different — more staff versus more land. */
  const eff = f.effCapPerDay == null ? f.capPerDay : f.effCapPerDay;
  const stalled = eff < f.capPerDay - 1e-9;
  const net = f.netPerDay;
  L.push('<b>' + Math.round(f.unburied) + '</b> unburied 🪦 · deaths <b>' + n1(f.ratePerDay) +
    '</b>/day vs burial <b class="' + (stalled ? 'bad' : '') + '">' + n1(eff) + '</b>/day' +
    (stalled ? ' <span class="bad">(no ground left — ' + n1(f.capPerDay) +
      '/day of burial capacity standing idle)</span>' : '') +
    ' → net <b class="' +
    (net > 0 ? 'bad' : 'ok') + '">' + (net > 0 ? '+' : '') + n1(net) + '</b>/day' +
    (x.src ? ' <span class="mut">(deaths from ' + esc(x.src) + ')</span>' : ''));

  /* 3 ── THE FORECAST ─────────────────────────────────────────────────────── */
  if (f.gate && f.gate.ok) {
    L.push('Next check in <b>' + mmss(f.nextCheckIn) + '</b> at <b class="bad">' + pct(f.pNext) +
      '</b> — the odds are published before the draw, and the draw is seeded.');
  } else if (f.gate && f.gate.why === 'warn-dwell') {
    L.push('<span class="warn">Warning standing.</span> No outbreak can be rolled for another <b>' +
      mmss(Math.max(0, f.gate.need - f.gate.stood)) + '</b> — a full wave interval of notice is guaranteed.');
  } else if (f.firstIn != null) {
    L.push('First possible outbreak in <b>' + dur(f.firstIn, f.daySec) + '</b>' +
      (f.p50In != null ? ' · even odds by <b>' + dur(f.p50In, f.daySec) + '</b>' : '') +
      (f.p90In != null ? ' · <b class="bad">9 in 10 by ' + dur(f.p90In, f.daySec) + '</b>' : ''));
  } else if (f.watchIn != null) {
    L.push('At this rate the warning starts in <b>' + dur(f.watchIn, f.daySec) + '</b>.');
  } else {
    L.push('<span class="ok">No outbreak in the next ' + dur(f.horizonSec, f.daySec) +
      '</span> at this rate.');
  }
  L.push('<span class="mut">Forecast assumes ' + esc(f.assumes) + '.</span>');

  /* 4 ── WHAT WOULD STOP IT ───────────────────────────────────────────────── */
  const capBits = (x.cap && x.cap.sources && x.cap.sources.length)
    ? x.cap.sources.map((s) => s.n + '× ' + (s.ico ? s.ico + ' ' : '') + esc(s.name) +
        ' <b>' + n1(s.perDay) + '</b>/day').join(' · ')
    : '<span class="bad">nothing is burying anyone</span>';
  /* 🔴 A COUNT OF PLOTS IS NOT A FORECAST UNTIL IT CARRIES A TIME.
     "3/24 plots free" and "no outbreak in the next 60 city days" were on the
     card together, one line apart, and only one of them was true. The plot
     count is the input; `groundOutIn` is what the projection makes of it, and
     the two now sit in the same sentence so they can be read against each
     other. When the ground is already gone the line says so in the present
     tense, because a duration of "0 days" reads as a rounding error. */
  const groundBit = (() => {
    if (!(x.cap && x.cap.plots > 0)) return '';
    const free = Math.round(x.cap.plotsFree);
    const head = ' · <b class="' + (free > 0 ? 'ok' : 'bad') + '">' + free +
      '</b>/' + Math.round(x.cap.plots) + ' plots free';
    if (free <= 0) return head + ' <span class="bad">— the ground is full; nothing more can be buried here</span>';
    if (f.groundOutIn != null) return head + ' <span class="warn">— full in <b>' + dur(f.groundOutIn, f.daySec) + '</b></span>';
    return head + ' <span class="mut">— enough for the whole forecast</span>';
  })();
  L.push('🪦 <b>Burial</b> ' + capBits + groundBit + burialHint(x.cemeteryTypes));
  L.push('☣️ <b>Quarantine</b> ' + (x.shield > 0
    ? '<span class="ok">' + pct(x.shield) + '</span> of strikes absorbed'
    : '<span class="bad">none</span> — a Containment Field absorbs strikes, capped'));
  /* The defence line only once there is something to defend against. Printing
     "Defence 7 vs a horde of 12" on a city with no dead reads as a threat that
     does not exist, and the strBase floor makes that number non-zero for ever. */
  if (x.def && b.id !== 'clear' && b.id !== 'low') {
    L.push('🛡 <b>Defence</b> <b class="' + (x.def.effDefense >= x.projStrength ? 'ok' : 'bad') + '">' +
      x.def.effDefense + '</b> vs a horde of <b>' + x.projStrength + '</b> ' +
      '<span class="mut">(' + esc(x.def.breakdown) + ')</span>' +
      (x.def.ammoShort ? '<br><span class="bad">Ammo short — defence cut from ' + x.def.defense +
        ' to ' + x.def.effDefense + '.</span>' : ''));
  }
  if (x.waves > 0) L.push('<span class="mut">' + x.waves + ' outbreak' + (x.waves === 1 ? '' : 's') +
    ' survived · ' + Math.round(x.interred) + ' interred of ' + Math.round(x.deaths) + ' dead.</span>');

  return L.join('<br>');
}

export default { render, band, timerText, dur, mmss };
