/* ══════════════════════════════════════════════════════════════════════════
   🛣 NETDRAG — CLICK-DRAG A ROAD RUN, ROUND 1.

   WHAT THIS ROUND IS. node-city has no drag placement at all: its pointerup
   bails on `Math.hypot(...) > 6` because "it was a camera drag"
   (index.html:33018), so a ten-tile road is TEN separate clicks, each one an
   awaited payCost round trip through the bridge. This module turns one
   pointerdown → N pointermoves → one pointerup into an ordered tile RUN and
   commits it as a batch.

   🔴 WHAT THIS ROUND DELIBERATELY IS NOT. It lays the EXISTING `road` type and
   nothing else. There is no second road class, no widened carriageway, no new
   tile type. /src/streets' scout trace counted `t.type === 'road'` re-derived
   independently in at least twelve places — index.html's own isRoad (handed BY
   VALUE to ~12 modules), computeLinks, allRoadKeys, the power snapshot's
   `road:` projection, and worst, /src/parking and /src/crowd each RE-COMPUTING
   the N/S/E/W neighbour mask for themselves. index.html has already named that
   bug class twice in its own comments (TRUCK_STOPS, "the seventh instance"; a
   load-order snapshot, "the eighth"). A new road type here would be instance #9
   pre-written, and it would be shipped by a module whose actual subject is the
   POINTER. Road classes wait for the round that first collapses those sites
   into one resolver. Everything this file does is therefore judgeable against
   shipped behaviour: the same tiles, the same price, the same gate.

   ══ THE FOUR SEAMS, AND WHY EACH IS THE ONLY ONE ═════════════════════════

   1. 🖱 THE POINTER: /src/netdrag/rig.js, shared with /src/zoning/ui.js.
      NOT a second capture-phase listener stack. zoning's header documents the
      measured bug where a second armed tool silently painted zones; a third
      claimant on the same document-capture pointer is that bug again unless
      the arbitration is a registry rather than pairwise wiring. See rig.js.

   2. 💰 THE COMMIT: ctx.place → node-city's tryPlace, THE CURRENT BINDING.
      tryPlace is REASSIGNED TWICE after its definition (the ops wrapper at
      index.html:35461 and the order gate outermost), so this module holds a
      one-line closure the host owns and never a copy of the body. Everything
      the gate does — the road maintenance cap, `_placing`, `_pendingType`,
      progression, the power siting refusal, the ground refusal, population,
      payCost — happens for every tile of a drag exactly as it happens for a
      hand click. This module has no ledger call of its own and cannot mint a
      coin: see ECONOMY.md.

   3. 🛣 THE MESH: refreshRoadArea, and ONLY through tryPlace.
      refreshRoadArea (index.html:24416) is the choke point on purpose — it
      rebuilds the tile plus its four neighbours AND drops MythicOutside's
      cached connection BFS, which is why /src/outside and /src/power/link never
      have to poll. tryPlace already calls it for every road that lands
      (index.html:28511), and it calls it for the NEIGHBOURS too, so a run laid
      one tile at a time re-cuts every junction as it goes. This file therefore
      does not sweep the run a second time — that would be ~5N redundant mesh
      rebuilds for zero correctness — but it does keep the choke point in its
      ctx and runs one integrity pass at the end (see commit()): five separate
      sites in index.html hard-code `=== 'road'` to route to refreshRoad, and a
      road that misses all five is an INVISIBLE BUILDING ON A REAL TILE the
      player paid for. That failure is silent, so it is checked rather than
      assumed.

   4. 🍞 THE REFUSALS: window.__ncToastSink (index.html:33269).
      The toast rail holds THREE. A 20-tile run that crosses the road cap would
      otherwise show three arbitrary refusals, drop the rest, and tell the
      player nothing about the other 17. The sink is installed around the whole
      batch, the refusal text tryPlace already wrote is KEPT (it says both what
      is wrong and how to fix it — "build a Supply Depot (+10)"), identical
      reasons are counted, and ONE line is printed. Saved and restored, never
      assigned blind: /src/zoning installs the same sink around its develop run.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `tryPlace`, `costOf`,
      `roadCap`, `mode`, `toast` and the rest are top-level `const`/`let` in
      node-city's module script and are invisible to an ES module — there is no
      `window.game` and no `window.tryPlace`. The ctx object handed to mount()
      IS the hand-over, and this file reaches for no bare global.

   ⚠ PRICE. The unit price comes from ctx.roadCost() = costOf('road').cinder =
     400. NEVER BUILDINGS.road.cost, which says 4: scaleCost multiplies cinder
     by BUILD_CINDER_MULT = 100 (index.html:28233). /src/streets' mount carries
     the same note because reading the raw table quotes 100× low AND LOOKS
     CORRECT — a wrong number that renders plausibly is worse than a crash.
   ══════════════════════════════════════════════════════════════════════════ */

import { tools } from './rig.js';
import { makeRunPreview } from './preview.js';

/* A drag is a gesture, not a script: a run longer than this is a slip of the
   hand or a driver bug, and committing it would be N awaited bridge calls the
   player did not ask for. The road maintenance cap starts at 40 (ROAD_CAP_BASE)
   so this is generous by design and is a guard rail, not a game rule. */
const MAX_RUN = 180;

const TOOLS = [
  { id: 'line',  ico: '│', name: 'Straight', hint: 'One leg, along whichever axis you dragged furthest.' },
  { id: 'elbow', ico: '⌐', name: 'Elbow',    hint: 'Two legs and a corner. Hold Shift to flip which way the corner turns.' },
  { id: 'free',  ico: '✎', name: 'Freehand', hint: 'Follows the pointer. Gaps are closed with a right angle, so the run is always connected.' },
];

export function mount(ctx) {
  if (!ctx || !ctx.THREE || !ctx.scene || !ctx.game) return null;
  const doc = (typeof document !== 'undefined') ? document : null;
  const canvas = ctx.canvas || null;

  const num = (v) => (Number(v) || 0);
  const unitCost = () => { try { return num(ctx.roadCost()); } catch (e) { return 0; } };
  const capNow = () => { try { return num(ctx.roadCap()); } catch (e) { return Infinity; } };
  const usedNow = () => { try { return num(ctx.roadUsed()); } catch (e) { return 0; } };
  const headroom = () => Math.max(0, capNow() - usedNow());

  let tool = 'line', armed = false, open = false, busy = false;
  let drag = null;          // { a:{x,z}, b:{x,z}, trail:[{x,z}] }
  let bend = false;         // elbow corner side; Shift flips it
  let ctrlWas = null;
  let lastRun = [];
  let lastQuote = { tiles: 0, unit: 0, total: 0 };
  let stats = { runs: 0, placed: 0, refused: 0, occupied: 0, spent: 0 };

  const prev = makeRunPreview({ THREE: ctx.THREE, scene: ctx.scene, HALF: ctx.HALF });

  /* ══ 1. THE RUN PLANNER ═══════════════════════════════════════════════════
     Pure, synchronous, and exported on the API so a driver can assert the shape
     of a run without driving a pointer at all. Every run it returns is
     4-CONNECTED and ORDERED from the anchor outwards — 4-connected because
     makeRoad derives its whole geometry from a four-boolean neighbour mask and
     a diagonal "run" would render as a string of disconnected stubs; ordered
     because the commit spends money one tile at a time and a run that runs out
     of Cinder half way must stop at the far END, not in the middle. */
  function pushCell(out, seen, x, z) {
    if (!ctx.inGrid(x, z)) return;
    const k = ctx.key(x, z);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, z, k });
  }
  /* Inclusive 4-connected walk from → to, x first then z. `from` is assumed
     already pushed by the caller, which is what makes chaining legs produce no
     duplicate at the corner. */
  function leg(out, seen, from, to) {
    let x = from.x, z = from.z;
    const sx = Math.sign(to.x - x), sz = Math.sign(to.z - z);
    while (x !== to.x) { x += sx; pushCell(out, seen, x, z); }
    while (z !== to.z) { z += sz; pushCell(out, seen, x, z); }
    return { x, z };
  }

  function plan(a, b, mode, flip) {
    if (!a) return [];
    const out = [], seen = new Set();
    pushCell(out, seen, a.x, a.z);
    if (!b) return out;
    mode = mode || 'line';
    if (mode === 'free' && Array.isArray(b)) {
      /* Freehand. The pointer does NOT visit every tile of its own path — at a
         zoomed-out camera one pointermove can cross three tiles, and at 0.56 Hz
         compositing (the Browser pane, CLAUDE.md) it can cross a dozen. So the
         trail's samples are joined with right-angle legs rather than trusted as
         adjacent; the run is connected whatever the frame rate did. */
      let cur = a;
      for (const p of b) { cur = leg(out, seen, cur, p); if (out.length >= MAX_RUN) break; }
      return out.slice(0, MAX_RUN);
    }
    const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
    if (mode === 'elbow') {
      const corner = flip ? { x: a.x, z: b.z } : { x: b.x, z: a.z };
      const c = leg(out, seen, a, corner);
      leg(out, seen, c, b);
    } else {
      // Straight: the axis the player dragged furthest, so the run follows the
      // gesture rather than snapping to a rule the player has to learn.
      const end = (dx >= dz) ? { x: b.x, z: a.z } : { x: a.x, z: b.z };
      leg(out, seen, a, end);
    }
    return out.slice(0, MAX_RUN);
  }

  /* ══ 2. WHAT THE RUN WILL ACTUALLY DO, BEFORE THE MONEY MOVES ═════════════
     The three states the preview paints. `over` is the interesting one: the
     road maintenance cap (ROAD_CAP_BASE 40, +10 per Supply Depot, +8 per
     road-linked Convoy anchor) is a real planning constraint, and a player who
     only meets it as a toast AFTER paying for eight tiles has been told about
     it in the least useful order. Costed here, painted amber on the ground, and
     named on the cursor chip while the drag is still live. */
  function classify(run) {
    const room = headroom();
    let free = 0;
    return run.map((c) => {
      if (ctx.tileAt(c.x, c.z)) return { ...c, state: 'blocked' };
      free++;
      return { ...c, state: free > room ? 'over' : 'ok' };
    });
  }

  function quoteOf(run) {
    const unit = unitCost();
    /* ⚠ THE HEADLINE NUMBER IS THE WHOLE RUN, NOT THE PLACEABLE PART.
       run.length × costOf('road').cinder, exactly. A quote that silently
       excluded the tiles it expects to be refused would be a DIFFERENT number
       from the one the player can check by counting squares, and "the game
       charged me something other than what it said" is the complaint no
       explanation recovers from. What will be refused is said in the warn line
       underneath, in words. */
    return { tiles: run.length, unit, total: run.length * unit };
  }

  function warnOf(cells) {
    const blocked = cells.filter((c) => c.state === 'blocked').length;
    const over = cells.filter((c) => c.state === 'over').length;
    const bits = [];
    if (blocked) bits.push(blocked + ' already built on');
    if (over) bits.push(over + ' past the road cap (' + usedNow() + '/' + capNow() + ')');
    return bits.length ? bits.join(' · ') : null;
  }

  /* ══ 3. THE BATCHED COMMITTER ═════════════════════════════════════════════ */
  async function commit(run) {
    if (busy || !run || !run.length) return null;
    busy = true;
    const unit = unitCost();
    /* 🍞 Save and RESTORE. /src/zoning installs the same sink around develop();
       assigning it blind and then nulling it would silence that module's own
       summary if the two ever overlapped. */
    const prevSink = window.__ncToastSink;
    const bag = [];
    window.__ncToastSink = (msg, cls) => { bag.push({ msg: String(msg == null ? '' : msg), cls }); };
    let placed = 0, occupied = 0, refused = 0;
    const laid = [];
    try {
      for (const c of run) {
        if (!ctx.inGrid(c.x, c.z)) continue;
        /* Occupied tiles are checked HERE as well as inside tryPlace, because
           tryPlace refuses them SILENTLY (`if (... tileAt(x,z)) return;` — no
           toast, by design, since a hand click on a building is obviously not a
           placement). Silent in a batch means unaccounted for, and a run that
           reports "8 of 20" with no explanation of the other 12 is the exact
           failure the sink exists to prevent. */
        if (ctx.tileAt(c.x, c.z)) { occupied++; continue; }
        const before = bag.length;
        try { await ctx.place('road', c.x, c.z); } catch (e) { console.warn('[netdrag] place', e); }
        /* tryPlace returns undefined on every path — success and refusal look
           identical to the caller — so success is read off the BOARD, which is
           the only thing that is actually true. */
        if (ctx.tileAt(c.x, c.z)) { placed++; laid.push(c); }
        else {
          refused++;
          if (bag.length === before) bag.push({ msg: 'Refused, with no reason given.', cls: 'bad' });
        }
      }
    } finally {
      window.__ncToastSink = prevSink;
    }

    /* 🛣 THE INTEGRITY PASS. buildMesh has NO road case and no default arm — it
       returns an EMPTY GROUP. Roads only ever get geometry because five
       separate sites in index.html hard-code `=== 'road'` and route to
       refreshRoad instead (tryPlace, loadState, build-complete, boot, admin).
       Miss any one of them and the player has paid 400🔥 for an invisible
       building on a real tile, and nothing anywhere reports it. tryPlace's own
       refreshRoadArea call has already run for every tile in `laid`, so this
       loop normally does nothing at all — it is here because "normally"
       is not a thing a silent failure respects, and re-cutting one junction is
       cheaper than the bug. */
    let healed = 0;
    if (typeof ctx.refreshRoadArea === 'function') {
      for (const c of laid) {
        const t = ctx.tileAt(c.x, c.z);
        if (t && !t.mesh) { ctx.refreshRoadArea(c.x, c.z); healed++; }
      }
    }

    const spent = placed * unit;
    stats.runs++; stats.placed += placed; stats.refused += refused;
    stats.occupied += occupied; stats.spent += spent;

    /* ONE LINE FOR THE WHOLE DRAG. Identical reasons are counted and the most
       common one is quoted verbatim — tryPlace's refusal text already says both
       what is wrong and how to fix it, and rewriting it here would be a second
       wording of one rule, which this codebase has had to rip a panel out over
       before. */
    const counts = new Map();
    for (const b of bag) counts.set(b.msg, (counts.get(b.msg) || 0) + 1);
    let top = null, topN = 0;
    for (const [m, n] of counts) if (n > topN) { top = m; topN = n; }

    if (ctx.toast) {
      if (!placed) {
        ctx.toast('🛣 Nothing laid — ' + (top || (occupied + ' tile' + (occupied === 1 ? ' is' : 's are') +
          ' already built on.')) + (topN > 1 ? ' (×' + topN + ')' : ''), 'bad');
      } else {
        const rest = [];
        if (occupied) rest.push(occupied + ' already built on');
        if (refused) rest.push(refused + ' refused');
        ctx.toast('🛣 Road run — ' + placed + ' of ' + run.length + ' tiles laid, ' +
          spent.toLocaleString() + ' 🔥.' +
          (rest.length ? ' ' + rest.join(', ') + '.' : '') +
          (refused && top ? ' ' + top : ''), 'good');
      }
    }
    if (refused && top) console.info('[netdrag] refusals', [...counts.entries()]);

    /* Drop the held type. ctx.place sets node-city's `placeType` for the length
       of the call (that is what the closure is), and leaving 'road' in hand
       after the drag means the next stray canvas click would build one. The
       mode is already 'inspect' — arming this tool set it — so this is about
       the TYPE, not the mode, and setMode is the only thing that clears it. */
    try { if (ctx.setMode) ctx.setMode('inspect'); } catch (e) {}
    try { if (ctx.updateHUD) ctx.updateHUD(); } catch (e) {}
    try { if (ctx.saveSoon) ctx.saveSoon(); } catch (e) {}
    busy = false;
    refresh();
    return { asked: run.length, placed, occupied, refused, spent, unit, healed,
             reasons: [...counts.entries()].map(([msg, n]) => ({ msg, n })) };
  }

  /* ══ 4. THE PANEL ═════════════════════════════════════════════════════════ */
  let panel = null, barBtn = null;
  if (doc && doc.body) {
    if (!doc.getElementById('ndg-style')) {
      const st = doc.createElement('style');
      st.id = 'ndg-style';
      /* Own stylesheet, own prefix, node-city's CSS variables with literal
         fallbacks — the same contract /src/zoning/ui.js's panel keeps, so the
         card still reads against a page whose theme has moved on. */
      st.textContent = `
#ndg-panel{position:absolute;left:50%;transform:translateX(-50%);bottom:92px;z-index:6;
  width:min(620px,calc(100% - 24px));box-sizing:border-box;display:none;
  background:var(--panel,rgba(16,12,26,.92));border:1px solid var(--edge,rgba(212,175,55,.35));
  border-radius:12px;padding:9px 11px 10px;backdrop-filter:blur(6px);
  box-shadow:0 18px 44px rgba(0,0,0,.6);color:var(--bone,#e9e0cc);font-size:12px}
#ndg-panel.on{display:block}
#ndg-panel .ndhd{display:flex;align-items:center;gap:8px;margin-bottom:7px}
#ndg-panel .ndhd b{color:var(--gold,#d4af37);letter-spacing:.09em;font-size:12px}
#ndg-panel .ndhint{color:var(--mist,#8f87a3);font-size:11px;flex:1;min-width:0}
#ndg-panel .ndx{margin-left:auto;background:none;border:none;color:var(--mist,#8f87a3);cursor:pointer;font-size:13px}
#ndg-panel .ndrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
#ndg-panel .ndt{border:1px solid var(--edge,rgba(212,175,55,.3));background:#120e1c;color:var(--bone,#e9e0cc);
  border-radius:8px;padding:5px 9px;cursor:pointer;font-size:12px}
#ndg-panel .ndt:hover{border-color:var(--gold,#d4af37)}
#ndg-panel .ndt.on{border-color:#ff7a2f;box-shadow:0 0 10px rgba(255,122,47,.28);color:#ffd08a}
#ndg-panel .ndft{display:flex;align-items:center;gap:10px;margin-top:8px;
  border-top:1px solid rgba(255,255,255,.08);padding-top:8px}
#ndg-panel .ndsel{flex:1;min-width:0;color:var(--mist,#8f87a3);font-size:11px;line-height:1.4}
#ndg-panel .ndsel b{color:var(--bone,#e9e0cc)}
#ndg-panel .ndmeter{margin-top:7px;font-size:11px;color:var(--mist,#8f87a3)}
#ndg-panel .ndmeter .roadmeter{font-size:11px}`;
      doc.head.appendChild(st);
    }
    panel = doc.createElement('div');
    panel.id = 'ndg-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Road tools');
    panel.innerHTML =
      '<div class="ndhd"><b>🛣 ROADS</b>'
      + '<span class="ndhint">Click and DRAG to lay a run — one gesture, one bill, one summary. '
      + 'Right button cancels the run you are drawing · scroll and WASD still move the camera.</span>'
      + '<button class="ndx" type="button" data-act="close" aria-label="Close">✖</button></div>'
      + '<div class="ndrow">'
      + TOOLS.map((t, i) => '<button class="ndt" type="button" data-tool="' + t.id + '" title="' +
          t.hint.replace(/"/g, '&quot;') + '">' + t.ico + ' ' + t.name + ' <span style="opacity:.5">' + (i + 1) + '</span></button>').join('')
      + '<span style="flex:1"></span>'
      + '<button class="ndt" type="button" data-act="off">🚫 Stop</button>'
      + '</div>'
      + '<div class="ndmeter" id="ndg-meter"></div>'
      + '<div class="ndft"><div class="ndsel" id="ndg-sel"></div></div>';
    doc.body.appendChild(panel);

    const bar = doc.getElementById('buildbar');
    if (bar) {
      barBtn = doc.createElement('button');
      barBtn.className = 'bbtn tool';
      barBtn.id = 'ndg-open';
      barBtn.innerHTML = '<span class="bico">🛣</span><span class="bname">Roads</span>';
      barBtn.onclick = () => setOpen(!open);
      // Beside Zones — laying the network and zoning the land it serves are the
      // same job, and a player doing one is about to do the other.
      const z = doc.getElementById('nz-open');
      if (z && z.parentNode === bar) bar.insertBefore(barBtn, z.nextSibling);
      else if (bar.children.length > 2) bar.insertBefore(barBtn, bar.children[2]);
      else bar.appendChild(barBtn);
    }

    panel.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-tool]');
      if (t) { tool = t.dataset.tool; setArmed(true); return; }
      const a = ev.target.closest('[data-act]');
      if (!a) return;
      if (a.dataset.act === 'close') setOpen(false);
      else if (a.dataset.act === 'off') setArmed(false);
    });
  }

  function refresh() {
    if (!panel) return;
    panel.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', armed && b.dataset.tool === tool));
    const m = panel.querySelector('#ndg-meter');
    if (m) {
      let html = '';
      try { html = ctx.roadMeterHtml ? ctx.roadMeterHtml() : ''; } catch (e) { html = ''; }
      m.innerHTML = html;
    }
    const sel = panel.querySelector('#ndg-sel');
    if (sel) {
      const td = TOOLS.find((t) => t.id === tool) || TOOLS[0];
      const unit = unitCost();
      sel.innerHTML = '<b>' + td.ico + ' ' + td.name + '</b> — ' + td.hint
        + '<br>Each tile costs <b>' + unit.toLocaleString() + ' 🔥</b>'
        + ' · <b>' + headroom() + '</b> more tile' + (headroom() === 1 ? '' : 's') + ' fit under the maintenance cap'
        + (busy ? '<br><b style="color:#ffd08a">🏗 Laying…</b>' : '')
        + (lastQuote.tiles ? '<br>Last run drawn: <b>' + lastQuote.tiles + '</b> tiles · <b>' +
            lastQuote.total.toLocaleString() + ' 🔥</b>' : '');
    }
    if (barBtn) barBtn.classList.toggle('active', armed);
  }

  function setOpen(v) {
    open = !!v;
    if (panel) panel.classList.toggle('on', open);
    setArmed(open);
    refresh();
  }

  /* ══ 5. ARBITRATION ═══════════════════════════════════════════════════════
     Both directions, and both end in something the player can SEE. This is the
     half /src/zoning/ui.js had to add after the measured bug, generalised: the
     rig broadcasts, we close our panel and name whoever took the pointer. */
  const T = tools();
  const tok = T.claim('netdrag', {
    label: '🛣 Roads',
    standDown: (why) => {
      if (!(armed || open)) return;
      const who = (why && why.kind === 'place')
        ? ((why.name || 'a building') + ', and the map is building again')
        : (((why && why.label) || 'another map tool') + ' has the pointer now');
      setOpen(false);
      if (ctx.toast) ctx.toast('🛣 Road tool put away — you picked ' + who + '. Click 🛣 Roads to lay more.', 'good');
    },
  });
  T.bindMode(ctx.onMode, ctx.BUILDINGS);

  function setArmed(v) {
    const was = armed;
    armed = !!v;
    if (armed) {
      tok.arm();
      if (ctx.setMode) {
        /* Leaving build mode is not enough on its own — a player who had a
           building in hand has just had it taken away, and being told is the
           difference between a tool swap and a lost click. Same wording shape
           as /src/zoning/ui.js, for the same reason. */
        let held = false;
        try { held = typeof ctx.mode === 'function' && ctx.mode() === 'place'; } catch (e) { held = false; }
        try { ctx.setMode('inspect'); } catch (e) {}
        if (held && !was && ctx.toast) {
          ctx.toast('🛣 Road tool armed — the building you were holding was put back. Press 🚫 Stop, or pick a building again, to build.', 'good');
        }
      }
    } else {
      tok.disarm();
      endDrag();
    }
    refresh();
  }

  function holdControls() {
    if (ctrlWas === null && ctx.controls) { ctrlWas = ctx.controls.enabled; ctx.controls.enabled = false; }
  }
  function releaseControls() {
    if (ctrlWas !== null && ctx.controls) { ctx.controls.enabled = ctrlWas; }
    ctrlWas = null;
  }
  /* One place that ends a gesture, called from pointerup, from a right-button
     cancel, from Escape, from disarm and from the rig's forced stand-down. A
     drag that is abandoned with `ctrlWas` still held leaves OrbitControls
     disabled forever and the camera silently dies — which looks like a renderer
     bug, three files away from its cause. */
  function endDrag() {
    drag = null;
    releaseControls();
    prev.hide();
  }

  /* ══ 6. THE GESTURE ═══════════════════════════════════════════════════════ */
  function hot(ev) {
    if (!armed || !canvas || ev.target !== canvas || typeof ctx.tileFromEvent !== 'function') return false;
    /* 🛟 The belt to the arbiter's braces. Against an older node-city with no
       mode hook the exclusion cannot fire, and a build click silently laying a
       road is the bug in the other direction. Then the build click wins, which
       is the right way round: the player who just picked a building is holding
       it. */
    try { if (typeof ctx.mode === 'function' && ctx.mode() === 'place') return false; } catch (e) {}
    return true;
  }

  function currentRun() {
    if (!drag) return [];
    return (tool === 'free')
      ? plan(drag.a, drag.trail, 'free', false)
      : plan(drag.a, drag.b, tool, bend);
  }

  function paint(ev) {
    const run = currentRun();
    lastRun = run;
    const cells = classify(run);
    lastQuote = quoteOf(run);
    prev.show(cells);
    prev.label(run.length + ' tile' + (run.length === 1 ? '' : 's') + ' · ' +
      lastQuote.total.toLocaleString() + ' 🔥', warnOf(cells), ev);
  }

  function onDown(ev) {
    if (!hot(ev) || busy) return;
    if (ev.button === 2) {
      /* Right button CANCELS the run being drawn. It is deliberately NOT a
         drag-demolish this round: clearing a road is a separate pre-scaled
         charge (ROAD_DEMOLISH_COST 600, index.html:4277 — half again what
         laying one costs) and a right-drag that silently cleared twelve tiles
         for 7,200🔥 is not something a player can undo. Demolition gets its own
         round, with its own confirmation. */
      if (drag) { ev.preventDefault(); ev.stopPropagation(); endDrag(); }
      return;
    }
    if (ev.button !== 0) return;
    const t = ctx.tileFromEvent(ev);
    if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    bend = !!ev.shiftKey;
    drag = { a: { x: t.x, z: t.z }, b: { x: t.x, z: t.z }, trail: [{ x: t.x, z: t.z }] };
    holdControls();
    paint(ev);
  }

  function onMove(ev) {
    if (!hot(ev)) return;
    const t = ctx.tileFromEvent(ev);
    if (!drag) { if (t) { prev.show(classify([{ x: t.x, z: t.z }])); prev.label('1 tile · ' + unitCost().toLocaleString() + ' 🔥', null, ev); } return; }
    ev.preventDefault(); ev.stopPropagation();
    bend = !!ev.shiftKey;
    if (t) {
      drag.b = { x: t.x, z: t.z };
      const last = drag.trail[drag.trail.length - 1];
      if (!last || last.x !== t.x || last.z !== t.z) drag.trail.push({ x: t.x, z: t.z });
      if (drag.trail.length > MAX_RUN) drag.trail.length = MAX_RUN;
    }
    paint(ev);
  }

  async function onUp(ev) {
    if (!drag) return;
    const run = currentRun();
    if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); }
    endDrag();
    if (run.length) await commit(run);
    else refresh();
  }

  function onCtx(ev) { if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); } }

  function onKey(ev) {
    if (!armed) return;
    if (ev.key === 'Escape') { if (drag) endDrag(); else setOpen(false); return; }
    const el = doc && doc.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const map = { '1': 'line', '2': 'elbow', '3': 'free' };
    if (map[ev.key]) { tool = map[ev.key]; if (drag) paint(ev); refresh(); }
    else if (ev.key === 'Shift' && drag) { bend = true; paint(ev); }
  }

  tok.on({ down: onDown, move: onMove, up: onUp, ctx: onCtx, key: onKey, cancel: endDrag });

  /* ══ 7. THE SEAM ══════════════════════════════════════════════════════════
     Everything a driver needs to prove the feature without photographing it.
     `plan` is pure, `commitRun` is the batched committer on its own, and `lay`
     is the two together — so "did one gesture place ten tiles" and "does the
     planner produce a connected run" are separate, separately falsifiable
     claims. A colour is not a measurement (.gauntlet/README item 6). */
  const api = {
    version: 1,
    open: (v) => { setOpen(v == null ? true : v); return open; },
    isOpen: () => open,
    armed: (v) => { if (v != null) setArmed(v); return armed; },
    tool: (t) => { if (t && TOOLS.some((x) => x.id === t)) { tool = t; setArmed(true); } return tool; },
    busy: () => busy,
    /* Pure. a/b are {x,z}; for mode 'free', b is an ARRAY of trail points. */
    plan: (a, b, mode, flip) => plan(a, b, mode || 'line', !!flip),
    classify,
    quote: (run) => quoteOf(run || lastRun),
    lastRun: () => lastRun.slice(),
    lastQuote: () => ({ ...lastQuote }),
    previewCells: () => prev.count(),
    previewText: () => prev.text(),
    unitCost, headroom,
    commitRun: (cells) => commit(cells || []),
    /* The whole gesture, without a pointer: plan a run and lay it. */
    lay: (a, b, opts) => commit(plan(a, b, (opts && opts.mode) || 'line', !!(opts && opts.flip))),
    stats: () => ({ ...stats }),
    arbiter: () => T,
    /* 🔍 "Is there actually a road there, and does it have geometry?" — the two
       halves of the only silent failure this module can cause. buildMesh has no
       road case, so `type:'road', mesh:false` is an invisible building on a
       tile the player paid for, and nothing else in the game reports it. */
    at: (x, z) => { const t = ctx.tileAt(x, z); return t ? { type: t.type, lvl: t.lvl | 0, mesh: !!t.mesh } : null; },
    /* 📐 Tile centre → client pixels, using the SAME tile→world mapping
       placeMeshAt owns (x - HALF + .5) rather than a second copy of it. This is
       what lets a driver aim a REAL pointer at a KNOWN tile: a drag asserted by
       calling plan() directly proves the planner and nothing about the pointer,
       and the pointer is the feature. */
    screenOf(x, z) {
      const c = ctx.canvas, cam = ctx.camera;
      if (!c || !cam) return null;
      const v = new ctx.THREE.Vector3(x - ctx.HALF + 0.5, 0, z - ctx.HALF + 0.5).project(cam);
      let r = null;
      try { r = c.getBoundingClientRect(); } catch (e) { r = null; }
      // ⚠ The Browser pane composites at ~0.56 Hz and canvas rects there read
      //   0×0 (CLAUDE.md). Fall back to the layout box rather than returning
      //   coordinates that are confidently in the top-left corner.
      const w = (r && r.width) || c.clientWidth || c.width;
      const h = (r && r.height) || c.clientHeight || c.height;
      const L = (r && r.left) || 0, T2 = (r && r.top) || 0;
      return { x: L + (v.x * 0.5 + 0.5) * w, y: T2 + (-v.y * 0.5 + 0.5) * h };
    },
    /* 🎥 THE CAMERA MUST NOT MOVE WHILE A RUN IS BEING DRAWN, and that is a
       promise this module makes (holdControls) rather than one OrbitControls
       makes for us. A driver has to be able to hold the claim to a number:
       `controls` is the flag we set, `cam` is what it was supposed to protect. */
    pointerState: () => ({
      armed, open, busy, dragging: !!drag, tool, bend,
      controls: !!(ctx.controls && ctx.controls.enabled),
      held: ctrlWas !== null,
      cam: ctx.camera ? [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z] : null,
      arbiter: T.armedId(), claimants: T.list(),
    }),
    /* verify() is the boot self-check. It asserts the three things that are
       silent when they are wrong: that the price is the SCALED one and not the
       raw table's 4, that the planner returns a 4-connected run, and that this
       module is a claimant on the shared arbiter rather than the owner of a
       second listener stack. */
    verify() {
      const out = { ok: true, notes: [] };
      const unit = unitCost();
      if (unit < 100) { out.ok = false; out.notes.push('road unit cost ' + unit + ' looks unscaled — costOf("road").cinder should be ~400, BUILDINGS.road.cost says 4'); }
      const r = plan({ x: 2, z: 2 }, { x: 6, z: 5 }, 'elbow', false);
      if (r.length !== 8) { out.ok = false; out.notes.push('elbow run 2,2→6,5 should be 8 tiles, got ' + r.length); }
      for (let i = 1; i < r.length; i++) {
        if (Math.abs(r[i].x - r[i - 1].x) + Math.abs(r[i].z - r[i - 1].z) !== 1) {
          out.ok = false; out.notes.push('run is not 4-connected at index ' + i); break;
        }
      }
      if (!T.list().includes('netdrag')) { out.ok = false; out.notes.push('not registered with the pointer arbiter'); }
      if (!T.modeBound()) out.notes.push('setMode arbitration is not bound — no ctx.onMode was handed over');
      out.claimants = T.list();
      out.unit = unit;
      return out;
    },
    dispose() { try { tok.release(); prev.dispose(); if (panel) panel.remove(); if (barBtn) barBtn.remove(); } catch (e) {} },
  };

  refresh();
  window.MythicNetDrag = api;
  return api;
}
