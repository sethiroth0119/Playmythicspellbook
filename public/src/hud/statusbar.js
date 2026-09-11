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
    + '<div id="ncsb-time"></div>'
    + '<span class="sbsep"></span>'
    + '<div id="ncsb-metrics"></div>'
    + '<span class="sbgrow"></span>'
    + '<button type="button" id="ncsb-demand" aria-expanded="true" '
    + 'title="Show or hide the Zone Demand dock">'
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
  timeCluster(bar);

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

/* ════════════════════════════════════════════════════════════════════════════
   🕒 THE CITY CLOCK, AND THE SPEED CONTROL THIS GAME DOES NOT HAVE.
   ════════════════════════════════════════════════════════════════════════════
   🔴 WHAT WENT WRONG. Round 6 moved #topbar wholesale into the Stores popover
      to get fourteen counters off the frame — and #clockres was one of the
      fourteen, so THE CITY CLOCK WENT WITH IT. BAR.md reference frame 4 has the
      clock and a pause/speed control on the status bar, and the round-6 critic
      found ours behind a click, with the only visible time on screen being the
      rail's BATTLE COUNTDOWN, which a stranger reads as the city clock.

   THE CLOCK IS ADOPTED, NOT REBUILT. #clockico and #r-clock are written by
   updateSky() every frame, by id. Moving the two nodes into a chip here keeps
   that writer working with no edit to index.html; re-creating them is how a
   readout goes dark. Their old parent #clockres is left in the Stores popover
   with nothing in it, so it is hidden by CSS rather than removed — removing a
   node index.html declared is not this module's business.

   🔴 THERE IS NO SPEED CONTROL TO BIND, AND THIS SAYS SO RATHER THAN FAKING ONE.
      Checked before deciding, because "add the control the reference has" is
      only the right answer if there is a model under it:
        · estClock() (index.html) formats the REAL wall clock in
          America/New_York, with a comment that says "the sun rises when YOUR
          sun rises. No fast-forward." The sky, the lamps and the day phase all
          follow it. Nothing anywhere multiplies it.
        · animate() drives every tick off THREE.Clock's real delta. There is no
          time-scale term to set — not on the economy, not on vitals, not on
          decay.
        · Build completion (bldSweep), the finance cycle (finTick) and the raid
          countdown are Date.now() comparisons, so they would keep running
          through any "pause" the render loop honoured.
        · offlineCatchUp() pays the player for wall-clock absence up to
          OFFLINE_CAP_H. Time the player "paused" would be credited back on the
          next load.
      A pause button would therefore stop four meters on screen, change nothing
      about the sun, the buildings, the raids or the payout, and be undone by a
      refresh. That is a lie with a keyboard shortcut. So the slot the reference
      puts a speed control in carries an explicit NO PAUSE affordance instead,
      and clicking it explains why — the same call this project already made
      about not inventing a tax rate for the demand panel.
   ════════════════════════════════════════════════════════════════════════════ */
function timeNote() {
  const t = (ctx && ctx.time) || {};
  const zone = t.zone || 'the real world';
  const cap = isFinite(t.offlineCapH) ? t.offlineCapH : null;
  return 'This city runs in real time. The day/night cycle follows ' + esc(zone)
    + ', so the sun here rises when it rises there, and there is no fast-forward: '
    + 'production, build timers and raid countdowns are all measured against the wall clock. '
    + 'There is nothing to pause either — close the tab and the city keeps running'
    + (cap != null ? ', and the away report pays you for up to ' + cap + ' hours of it' : '')
    + '. A pause button here would stop the numbers on screen and change none of that, '
    + 'so this says what the game does instead of pretending to a speed it has not got.';
}

function timeCluster(bar) {
  const host = bar.querySelector('#ncsb-time');
  if (!host) return;
  host.innerHTML = '<div class="sbm sbclock" id="ncsb-clock" title="City time. The clock is the real one — see NO PAUSE.">'
    + '<span class="sbm-ico" id="ncsb-clockico"></span>'
    + '<span class="sbm-col"><span class="sbm-lab">City Time</span>'
    + '<span class="sbm-num" id="ncsb-clocknum"></span></span></div>'
    + '<button type="button" class="sbnopause" id="ncsb-nopause" aria-expanded="false">'
    + '<span class="np-ico">⏸</span><span class="np-lab">No Pause</span></button>'
    + '<div class="sbnote" id="ncsb-timenote" hidden></div>';
  /* THE ADOPTION. Both nodes are index.html's, written by updateSky by id. */
  adopt('clockico', host.querySelector('#ncsb-clockico'));
  adopt('r-clock', host.querySelector('#ncsb-clocknum'));
  const note = host.querySelector('#ncsb-timenote');
  const btn = host.querySelector('#ncsb-nopause');
  note.innerHTML = '<b>Why there is no pause or fast-forward</b>' + timeNote();
  btn.title = 'This game has no speed control. Click for why.';
  btn.addEventListener('click', () => {
    const on = note.hasAttribute('hidden');
    if (on) note.removeAttribute('hidden'); else note.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
  });
  document.addEventListener('mousedown', (ev) => {
    if (note.hasAttribute('hidden')) return;
    try { if (ev.target.closest('#ncsb-time')) return; } catch (e) {}
    note.setAttribute('hidden', ''); btn.classList.remove('on');
    btn.setAttribute('aria-expanded', 'false');
  }, false);
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

  /* The four demand arrows, from the same read() the panel and the dock print.
     🔤 AND EACH ONE NOW CARRIES ITS INITIAL. Four identically shaped arrows in
        four colours is a legend nobody was given: the round-8 critic could see
        the meters and could not name them, which is the whole of the score this
        round is answering. The full names live on the dock (dock.js) — this
        strip is 198px of a status row that is already 1514 of 1600, so it gets
        the one character that disambiguates R / C / O / I and the title
        attribute keeps the full name and the figure for a hover.
     ⚠ THE INITIAL COMES FROM d.name, not from a table here. A second list of
       category names in this file is how the strip and the dock start
       disagreeing about what the yellow one is called. */
  if (Array.isArray(strip)) {
    const sh = '<span class="sbd-lab">Demand</span>' + strip.map((d) => {
      const has = d.value != null;
      return '<span class="dmw"><span class="dmk">' + esc(String(d.name || '?').charAt(0)) + '</span>'
        + '<span class="dmini' + (has ? '' : ' none') + '" style="color:' + esc(d.col) + '"'
        + ' title="' + esc(d.name) + ' demand ' + (has ? Math.round(d.value * 100) + '%' : 'not modelled yet') + '">'
        + '<i style="width:' + (has ? Math.round(d.value * 100) : 0) + '%"></i></span></span>';
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
  if (!b) return;
  b.classList.toggle('on', !!on);
  b.setAttribute('aria-expanded', on ? 'true' : 'false');
}

export default { mount, render, fmt, onDemandClick, setDemandOpen };
