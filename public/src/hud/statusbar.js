/* ============================================================================
   🎛 THE STATUS BAR — what replaces fourteen identical counters.
   ============================================================================
   BEFORE: #topbar printed thirteen resource chips plus population plus the
   clock, in two rows across the whole width, every one of them an icon and a
   number in the same box. At the capture camera that is most of the top third
   of the frame, and — measured on .gauntlet/shots/r5/r5-aerial.png — twelve of
   the fourteen were printing the SAME NUMBER. Fourteen identical counters is
   not information; it is noise that happens to contain information.

   AFTER: BAR.md reference frame 4's status strip — the city, the clock and the
   weather, then the two or three figures a player actually watches, each WITH
   ITS PER-HOUR RATE, then a row of service-status dots, then the demand
   arrows. Everything else is one click away in the Stores popover, which is
   the old #topbar re-homed rather than rebuilt.

   🔴 WHICH RESOURCES ARE "WATCHED", AND WHY THOSE. This is a real decision, so
      here is the reasoning rather than a taste claim. node-city's own vitals
      model (vitalsTick / computeCoverage in index.html) gates the city on
      exactly three things:
        · population grows only at >= 90% coverage of FOOD, WATER and HEALTH,
          and falls when any of them drops under 60%;
        · everything else the player builds is paid for in CINDER.
      Health is a SERVICE, not a store — it has no counter, it has a coverage
      figure — so it belongs in the dots, and it is there. Food and Water are
      the two stores the death condition is written against, so they are the
      two stores on the bar, and Cinder is the treasury the reference frame
      asks for. Population is the fourth because it is the number every other
      number is per-capita of.
      Metal, Fuel, Supplies, Medicine, Ammo, Memory Shards, Corrupted Essence,
      Wood, Stone and Cloth are all INPUTS TO A BUILD, checked at the moment of
      building — where the build shop already prints them against your balance.
      A player does not watch those; they consult them. One click is the right
      distance for a thing you consult.
   ============================================================================ */

/* ── formatting ───────────────────────────────────────────────────────────
   410065408 was rendered as "410065408" fourteen times over. Compact SI, and
   never more than four significant characters, so a chip cannot change width
   when the number does. */
export function fmt(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
  if (a >= 100) return String(Math.round(n));
  if (a >= 10) return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return String(Math.round(n * 10) / 10);
}
/* A rate, per hour, signed. Per HOUR and not per minute because the reference
   frame's deltas are per hour and because a per-minute figure on a resource
   that moves a few units an hour reads as a permanent zero. */
function rate(perMin) {
  const h = (Number(perMin) || 0) * 60;
  if (!isFinite(h) || Math.abs(h) < 0.05) return { txt: '—', cls: '' };
  return { txt: (h > 0 ? '+' : '−') + fmt(Math.abs(h)) + '/hr', cls: h > 0 ? 'up' : 'dn' };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* The coverage bands ARE the vitals model's, read once from the host rather
   than restated: 90% is where the city grows and 60% is where it sheds people.
   A second copy of those two numbers here is how the bar and the panel start
   disagreeing about whether a city is in trouble. */
function band(pct, gates) {
  const g = gates || { grow: 0.9, fall: 0.6 };
  if (pct >= g.grow) return 'ok';
  if (pct >= g.fall) return 'warn';
  return 'bad';
}

let ctx = null;
let host = null;

/* Move a node that node-city created into the bar instead of re-creating it.
   Every one of these is written by id somewhere in index.html — #cityname is
   the wordmark, #daypill is written by weatherTick and updateSky, #adminbtn
   carries its own click handler — so MOVING is what keeps all of that alive
   with no edit to any writer. Re-creating them is how a readout goes dark. */
function adopt(id, into) {
  const el = document.getElementById(id);
  if (el && el.parentElement !== into) into.appendChild(el);
  return el;
}

export function mount(_ctx) {
  ctx = _ctx || {};
  if (document.getElementById('nctop')) return document.getElementById('nctop');

  const top = document.createElement('div');
  top.id = 'nctop';

  const bar = document.createElement('div');
  bar.id = 'ncsb';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-label', 'City status');
  bar.innerHTML = '<span class="sb-id"></span>'
    + '<span class="sbsep"></span>'
    + '<div id="ncsb-metrics"></div>'
    + '<span class="sbgrow"></span>'
    + '<button type="button" id="ncsb-demand" title="Zone demand — residential, commercial, office, industrial">'
    + '<span class="sbd-lab">Demand</span></button>'
    + '<button type="button" class="sbbtn" id="ncsb-stores" aria-expanded="false" '
    + 'title="Every other store the city holds">📦 Stores</button>'
    + '<span class="sb-admin"></span>';
  top.appendChild(bar);

  document.body.insertBefore(top, document.body.firstChild);
  /* 🏷 THE MARKER CLASS. Three of this module's rules correct insets in
     index.html's own stylesheet (#railmodal's top clearance, #inspect's bottom
     one, the toast stack) — corrections that are only right BECAUSE the docks
     moved. Scoping them to a class this module adds means a page where this
     module 404s keeps the layout it still needs, instead of inheriting a fix
     for a change that never happened. */
  document.body.classList.add('nchud');

  /* The identity cluster: the wordmark and the day/weather capsule, moved. */
  const idc = bar.querySelector('.sb-id');
  adopt('cityname', idc);
  adopt('daypill', idc);
  adopt('adminbtn', bar.querySelector('.sb-admin'));

  /* ⚠ THE RAIL DOCK JOINS THE BLOCK, IT IS NOT REBUILT. #railbar keeps its id,
     its thirteen buttons, its 0.5 s badge beat and #oc-dock (the Outside chip,
     which is a flex ITEM of the rail with flex:0 0 100% so it takes its own
     line). Only its position changes, and that is done in CSS so nothing in
     index.html's rail block has to know. */
  const rail = document.getElementById('railbar');
  if (rail) {
    top.appendChild(rail);
    /* 🔴 THE INDICATOR GROUP RIDES THE LAUNCHER ROW, and that is a MEASURED
       decision, not a tidy one. On their own line the seven dots and the four
       demand arrows made the status bar wrap to two rows and the docked block
       came out 155px tall — taller than the fourteen-chip bar this round exists
       to replace, which would have been a legibility round that made the frame
       worse. Sharing the launcher line puts the block at ~115px and leaves the
       status row a single 44px strip.
       ⚠ THE RAIL'S OWN WIDTH NOTE (see RAILS in index.html) says a fourteenth
         seat wraps the dock "onto a second line over the map". That hazard is
         gone: the row now sits INSIDE a block with its own ground, so a wrap
         grows the dock, --topbarh follows it, and nothing lands on the city.
         Measured at 1600: thirteen launchers 1026 + seven dots 326 = 1352
         against a 1576 track, 224px of slack for a badged worst case. The four
         demand arrows went to the status row instead, where there was 430px of
         dead space between the metrics and the right-hand buttons. */
    const grp = document.createElement('span');
    grp.className = 'sb-ind';
    grp.innerHTML = '<span class="sb-indlab">Services</span>'
      + '<div id="ncsb-dots" role="group" aria-label="Service coverage"></div>'
      + '<span class="sbsep"></span>';
    rail.insertBefore(grp, rail.firstChild);
  }

  /* 📦 THE STORES POPOVER IS #topbar ITSELF. Not a copy: the same node, so
     updateHUD keeps writing #r-food and the vault-opening click delegation
     registered on #topbar keeps working, with no edit to either. */
  const tb = document.getElementById('topbar');
  if (tb) {
    if (!tb.querySelector('.ncstores-hd')) {
      const h = document.createElement('div');
      h.className = 'ncstores-hd';
      h.textContent = 'City Stores';
      tb.insertBefore(h, tb.firstChild);
      const f = document.createElement('div');
      f.className = 'ncstores-ft';
      f.textContent = 'Click any store to move it in or out of the Ops Vault. Food, Water, Cinder and Population are on the status bar because the city’s own vitals model gates population growth on them; everything here is a build input you consult rather than watch.';
      tb.appendChild(f);
    }
    const btn = bar.querySelector('#ncsb-stores');
    btn.addEventListener('click', () => {
      const on = tb.classList.toggle('ncopen');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    /* Click-away, on the same contract /src/outside's chip uses. Not a
       capture-phase window handler that swallows the click — a plain bubbling
       listener that ignores anything inside the popover or its button. */
    document.addEventListener('mousedown', (ev) => {
      if (!tb.classList.contains('ncopen')) return;
      try {
        if (ev.target.closest('#topbar') || ev.target.closest('#ncsb-stores')) return;
      } catch (e) {}
      tb.classList.remove('ncopen');
      btn.classList.remove('on');
      btn.setAttribute('aria-expanded', 'false');
    }, false);
  }

  host = bar;
  try { if (window.__syncTopbarH) window.__syncTopbarH(); } catch (e) {}
  return top;
}

/* ⚠ EVERY LOOKUP BELOW IS document-SCOPED, NOT host-SCOPED, and that is not
   style. The indicator group is deliberately re-parented into #railbar (see
   mount), so a querySelector rooted at #ncsb finds #ncsb-metrics and MISSES
   #ncsb-dots and #ncsb-demand — which is exactly the bug this comment replaces:
   the dots rendered as an empty row and the demand strip as a bare label, and
   both looked like a model returning nothing rather than a scope error.

   One metric chip. `warn` is a severity the CALLER decides, so the bar never
   holds a second opinion about what "low food" means. */
function metricHtml(m) {
  const r = rate(m.perMin);
  return '<div class="sbm' + (m.tone ? ' watch-' + m.tone : '') + '" title="' + esc(m.title || m.lab) + '">'
    + '<span class="sbm-ico">' + m.ico + '</span>'
    + '<span class="sbm-col"><span class="sbm-lab">' + esc(m.lab) + '</span>'
    + '<span class="sbm-num' + (m.cls ? ' ' + m.cls : '') + '">' + esc(m.num) + '</span></span>'
    + '<span class="sbm-d ' + r.cls + '">' + r.txt + '</span></div>';
}

export function render(strip) {
  if (!host || !ctx) return;
  let res = {}, per = {}, pop = {}, cov = {}, cinder = 0;
  try { res = ctx.res() || {}; } catch (e) {}
  try { per = ctx.perMin() || {}; } catch (e) {}
  try { pop = ctx.pop() || {}; } catch (e) {}
  try { cov = ctx.coverage() || {}; } catch (e) {}
  try { cinder = ctx.cinder(); } catch (e) {}

  const gates = ctx.gates || { grow: 0.9, fall: 0.6 };
  const foodCov = cov.food, waterCov = cov.water;

  const metrics = [
    { k: 'pop', ico: '👥', lab: 'Population', num: fmt(Math.round(Number(pop.city) || 0)), perMin: pop.perMin,
      title: 'Residents living in the city. ' + (pop.used | 0) + ' of ' + (pop.cap | 0) + ' billets are taken.' },
    { k: 'cinder', ico: '🔥', lab: 'Treasury', num: fmt(cinder), perMin: per.cinder, cls: 'cinder',
      title: 'Cinder on hand. The rate is what your lots and operations pay per hour.' },
    { k: 'food', ico: '🥫', lab: 'Food', num: fmt(res.food), perMin: per.food,
      tone: foodCov == null ? '' : band(foodCov, gates) === 'ok' ? '' : band(foodCov, gates),
      title: 'Food in store. Coverage ' + (foodCov == null ? 'unknown' : Math.round(foodCov * 100) + '%') + '.' },
    { k: 'water', ico: '💧', lab: 'Water', num: fmt(res.water), perMin: per.water,
      tone: waterCov == null ? '' : band(waterCov, gates) === 'ok' ? '' : band(waterCov, gates),
      title: 'Water in store. Coverage ' + (waterCov == null ? 'unknown' : Math.round(waterCov * 100) + '%') + '.' },
  ];
  const mh = metrics.map(metricHtml).join('');
  const mEl = document.getElementById('ncsb-metrics');
  if (mEl && mEl.__h !== mh) { mEl.__h = mh; mEl.innerHTML = mh; }

  /* The seven NEEDS, in the coverage model's own order. */
  const needs = ctx.needs || [];
  const meta = ctx.needMeta || {};
  const dh = needs.map((n) => {
    const p = cov[n];
    const has = p != null && isFinite(p);
    const b = has ? band(p, gates) : 'warn';
    const nm = (meta[n] && meta[n].name) || n;
    return '<span class="sbdot s-' + b + '" tabindex="0" role="img" title="' + esc(nm) + ' service coverage: '
      + (has ? Math.round(p * 100) + '%' : 'not measured yet')
      + (b === 'bad' ? ' — under the 60% the city sheds people at.' : b === 'warn' ? ' — under the 90% the city grows at.' : ' — meeting demand.') + '"'
      + ' aria-label="' + esc(nm) + ' ' + (has ? Math.round(p * 100) + ' percent' : 'unknown') + '">'
      + '<span class="sbd-ico">' + ((meta[n] && meta[n].ico) || '•') + '</span>'
      + '<span class="sbd-ring"></span>'
      + '<span class="sbd-pct">' + (has ? Math.round(p * 100) + '%' : '—') + '</span></span>';
  }).join('');
  const dEl = document.getElementById('ncsb-dots');
  if (dEl && dEl.__h !== dh) { dEl.__h = dh; dEl.innerHTML = dh; }

  /* The four demand arrows, from the same read() the panel prints. */
  if (Array.isArray(strip)) {
    const sh = '<span class="sbd-lab">Demand</span>' + strip.map((d) => {
      const has = d.value != null;
      return '<span class="dmini' + (has ? '' : ' none') + '" style="color:' + esc(d.col) + '"'
        + ' title="' + esc(d.name) + ' demand ' + (has ? Math.round(d.value * 100) + '%' : 'not modelled yet') + '">'
        + '<i style="width:' + (has ? Math.round(d.value * 100) : 0) + '%"></i></span>';
    }).join('');
    const sEl = document.getElementById('ncsb-demand');
    if (sEl && sEl.__h !== sh) { sEl.__h = sh; sEl.innerHTML = sh; }
  }
}

export function onDemandClick(fn) {
  const b = document.getElementById('ncsb-demand');
  if (b) b.addEventListener('click', fn);
}
export function setDemandOpen(on) {
  const b = document.getElementById('ncsb-demand');
  if (b) b.classList.toggle('on', !!on);
}

export default { mount, render, fmt, onDemandClick, setDemandOpen };
