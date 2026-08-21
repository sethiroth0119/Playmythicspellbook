/* ════════════════════════════════════════════════════════════════════════════
   🚰 THE PIPE TOOL — a dragged run, its preview, and the network overlay.
   ----------------------------------------------------------------------------
   network.js is the graph and knows nothing about a pointer. THIS file is the
   only part of the mains that touches the DOM or THREE, which is what keeps
   network.js importable from node — and therefore what makes the mains testable
   at all (see .gauntlet/drive-water-mains.mjs).

   ── 🖱 WHY THE ARBITER'S LISTENERS ARE ON `document` WITH capture:true ──────
   Verbatim the reasoning /src/zoning/ui.js wrote down and rig.js inherited,
   because it is the same canvas: node-city binds pointerdown/move/up ON THE
   CANVAS and so does OrbitControls. A listener on the same element runs in
   registration order, i.e. after the click has already been read as "place a
   building" or "orbit the camera", and stopPropagation() from there is too late.
   A capture-phase listener on `document` runs first, and one stopPropagation()
   owns the gesture. Events are swallowed ONLY while this tool is the armed
   claimant and its own hot() says the pointer is over the canvas; every UI click
   passes through untouched.

   ── 🔴 AND THIS FILE WRITES NO LISTENERS OF ITS OWN ────────────────────────
   /src/zoning/ui.js's header records the measured defect: with the Zones panel
   open, picking Housing off the build bar and clicking the map painted a green
   square and raised nothing — no building, no toast, no cue — "the worst class
   of UI bug: the player blames themselves". Its fix was written 1-vs-1. With
   four tools on this canvas the pairwise wiring is N² and every missing edge is
   that same silent bug, so this round landed /src/netdrag/rig.js: ONE armed
   claimant city-wide, ONE set of capture-phase document listeners dispatching
   only to that claimant, and one bindMode that stands everybody down when the
   player picks a building.

   This tool is a CLAIMANT on that arbiter. A fifth tool costs one claim() call
   and cannot forget an edge, which is the whole reason not to write the
   listeners again here.
   ⚠ DYNAMICALLY IMPORTED AND GUARDED. A static import would let a 404 on
     /src/netdrag take the hydrology, the mains model and the save slice down
     with it. Absent ⇒ this warns once, the button says why it is disabled, and
     everything that is not the pointer still works — including
     MythicWater.pipes.add(), which is the seam the driven test uses.
   🔴 AND NO SECOND LISTENER STACK AS A FALLBACK, DELIBERATELY. Installing our
     own document-capture listeners "just in case" is exactly the shape rig.js
     exists to stop: two dispatchers, each convinced it holds the only armed
     tool, and a build click that silently lays pipe.
   ⚠ NEVER CALL setMode FROM INSIDE A STAND-DOWN. node-city fires the mode hook
     from within setMode itself, and calling back puts two tools in a loop
     handing the pointer to each other. Arming calls setMode; standing down
     never does.

   ── THE OVERLAY IS ONE MESH ────────────────────────────────────────────────
   Same constraint /src/water/overlay.js and /src/power/overlay.js both state: a
   24×24 layer must not be 576 meshes. One PlaneGeometry, one CanvasTexture,
   repainted only when the network or the drag actually changed.
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';

let THREE = null, scene = null, host = null, api = null;
let mesh = null, tex = null, cvs = null, cx2 = null;
let GRID = 24, PX = 0;
/* 🌊 THE APRON. Columns east of the plate that a pipe run — and this overlay —
   are allowed to reach into, so a main can cross the shoreline and touch a Sea
   Drain standing in the water. WATER.sewer.drain.apron carries the measurement
   that fixed it at 3; nothing here re-derives where the water starts. */
let APRON = 0;

let armed = false, drag = null, erase = false, busy = false;
let ctrlWas = null;
let dirty = true, layerOn = false, lastSig = '';
let barBtn = null, strip = null;
let lastState = null;
let TOOLS = null, TOK = null;   // /src/netdrag/rig.js — the shared arbiter

const M = () => WATER.mains;

export function repaintNext() { dirty = true; lastSig = ''; }

/* ════════════════════════════════════════════════════════════════════════
   🌊 THE FLOW — 'show water going through the pipes if they are connected'.
   ------------------------------------------------------------------------
   The trunk already tells the player whether a run is LIVE (a waterworks is
   on this component) by drawing it cyan rather than dead slate. That is a
   colour a player has to be told about. Motion is not: a main with water in
   it moves, and one without it sits still.

   🔴 DIRECTION IS DERIVED, NOT DECORATIVE. The dashes travel AWAY from the
      waterworks, because that is where the water is going. A BFS over the
      pipe graph from every tile a well is attached to gives each pipe tile a
      hop count; an edge then flows from its lower end to its higher one.
      Dashes that all drifted one way on screen would be a screensaver — and
      worse, would point the wrong way on half the network, which is a
      readout that lies.

   ⚠ COST. This is the ONE thing in this file that repaints without the
     picture having changed, so it is gated hard: `flowLive` is recomputed by
     paint() itself and the frame loop refuses to schedule unless the mesh is
     visible AND some component is live. Toggle the layer off, or lose the
     last waterworks, and the loop stops on the next frame. It also throttles
     to FLOW_HZ rather than running at display rate — the dashes move 1.6
     tiles a second and nothing about that needs 60 fps.
   ════════════════════════════════════════════════════════════════════════ */
const FLOW_HZ = 15;
let flowPhase = 0;      // tiles travelled, wrapped to the dash period
let flowLive = false;   // is there anything to animate at all?
let flowReq = 0;        // rAF handle, 0 when not scheduled
let flowAt = 0;         // timestamp of the last frame we actually drew

function flowStop() {
  if (flowReq) { try { cancelAnimationFrame(flowReq); } catch (e) {} flowReq = 0; }
  flowAt = 0;
}
function flowSchedule() {
  if (flowReq || !flowLive) return;
  try { flowReq = requestAnimationFrame(flowFrame); } catch (e) { flowReq = 0; }
}
function flowFrame(now) {
  flowReq = 0;
  if (!flowLive) { flowAt = 0; return; }
  const t = typeof now === 'number' ? now : 0;
  /* ⚠ CLAMPED. A backgrounded tab hands back a dt of many seconds on the
     first frame after it wakes; without the clamp the dashes teleport, which
     reads as the network having glitched rather than as time having passed. */
  const dt = flowAt ? Math.min(0.2, Math.max(0, (t - flowAt) / 1000)) : 0;
  if (dt > 0 && dt < 1 / FLOW_HZ) { flowSchedule(); return; }   // throttle
  flowAt = t;
  if (dt > 0) {
    const period = Math.max(0.2, M().flowDash) * 2;
    flowPhase = (flowPhase + dt * Math.max(0, M().flowSpeed)) % period;
    dirty = true;                    // the picture DID change — bypass the sig gate
    paint();
  }
  flowSchedule();
}

/* Hops from the nearest waterworks, over the pipe graph. A function of the
   network and the well list, both of which are already in paint()'s
   signature, so it is rebuilt exactly when the picture is. */
function flowField(st, set) {
  const d = Object.create(null);
  if (!st || !st.wells || !st.wells.length) return d;
  const R = M().reach;
  const q = [];
  for (const w of st.wells) {
    if (w.comp < 0) continue;
    /* The same reach rule attachOf() uses, so 'which pipe does this
       waterworks feed' has one answer in this package and not two. */
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > R) continue;
      const k = (w.x + dx) + ',' + (w.z + dz);
      if (set.has(k) && d[k] === undefined) { d[k] = 0; q.push(k); }
    }
  }
  for (let i = 0; i < q.length; i++) {
    const k = q[i]; const p = parse(k); const n = d[k] + 1;
    const nb = [(p.x + 1) + ',' + p.z, (p.x - 1) + ',' + p.z,
                p.x + ',' + (p.z + 1), p.x + ',' + (p.z - 1)];
    for (const m of nb) if (set.has(m) && d[m] === undefined) { d[m] = n; q.push(m); }
  }
  return d;
}

/* One trunk edge with the moving dash over it. `a` is always the END NEAREST
   THE WATERWORKS — the caller orders them — so a negative dash offset walks
   the dashes from a to b, i.e. away from the source. */
function flowEdge(a, b) {
  const w = Math.max(1, PX * 0.26) * Math.max(0.1, M().flowWidth);
  const dash = Math.max(0.2, M().flowDash) * PX;
  cx2.save();
  cx2.strokeStyle = WATER.col.pipeFlow;
  cx2.lineWidth = w;
  cx2.lineCap = 'butt';
  try { cx2.setLineDash([dash, dash]); } catch (e) {}
  cx2.lineDashOffset = -flowPhase * PX;
  cx2.beginPath();
  cx2.moveTo(px(a.x), px(a.z));
  cx2.lineTo(px(b.x), px(b.z));
  cx2.stroke();
  cx2.restore();
}
export function isArmed() { return armed; }

/* ════════════════════════════════════════════════════════════════════════════
   MOUNT
   `h` is node-city's hand-over (the globals trap: THREE, scene, canvas,
   controls, game and every helper below are top-level `const` in the host's
   module script and invisible to an ES module). EVERY one of them is optional:
   an older node-city that mounts /src/water with the original four-key ctx gets
   no tool and no overlay, and the simulation is unchanged — the pipe set is
   data, and a toolbar is only one way to edit it.
   ════════════════════════════════════════════════════════════════════════════ */
export function mount(h, a) {
  host = h || {}; api = a;
  GRID = (h && h.grid) | 0 || 24;
  PX = WATER.overlay.px;
  APRON = Math.max(0, WATER.sewer.drain.apron | 0);
  if (h && h.THREE && h.scene) buildMesh(h.THREE, h.scene);
  if (typeof document !== 'undefined' && document.body) { buildButton(); buildStrip(); }
  /* Deliberately NOT awaited by the caller. /src/water's mount() is synchronous
     and the simulation must be live the moment it returns — the arbiter is only
     needed by the time a human can press a button, which is several frames
     later. Failure leaves `TOOLS` null and the button explaining itself. */
  claimPointer();
  return true;
}

async function claimPointer() {
  try {
    const rig = await import('../netdrag/rig.js');
    TOOLS = (rig && typeof rig.tools === 'function') ? rig.tools() : null;
  } catch (e) { TOOLS = null; }
  if (!TOOLS) {
    try { console.warn('[water/mains] /src/netdrag/rig.js is absent, so the pipe drag cannot arm without becoming a second pointer owner. Everything else in /src/water is unaffected.'); } catch (e) {}
    if (barBtn) {
      barBtn.disabled = true;
      barBtn.title = 'The shared map-pointer tool is not loaded, so mains cannot be laid by hand right now.';
    }
    return;
  }
  TOK = TOOLS.claim('water-mains', { label: '🚰 Pipes', standDown });
  TOK.on({
    down: onDown, move: onMove, up: onUp, ctx: onCtx, key: onKey,
    /* `cancel` is the mid-gesture case: the arbiter hands the seat away while a
       drag is in flight. Releasing OrbitControls here is not cosmetic — a tool
       that stands down still holding `controls.enabled = false` kills the camera
       for the rest of the session. */
    cancel: () => { drag = null; releaseControls(); dirty = true; paint(); },
  });
  /* Registered ONCE by whichever module gets there first; a second call is a
     no-op that returns true, so neither this file nor the road tool has to know
     which of them mounted earlier. BUILDINGS is not in this module's ctx — the
     arbiter uses it only to NAME the building in the stand-down reason, and
     whichever claimant did pass it has already bound the hook. */
  try { TOOLS.bindMode(host.onMode, host.BUILDINGS); } catch (e) {}
}

/* 🔴 THE STAND-DOWN MUST END IN SOMETHING THE PLAYER CAN SEE — rig.js says so in
   as many words, and /src/zoning's header explains what a silent one costs. The
   strip closes, the bar button clears, and a toast names the tool that took the
   pointer. */
function standDown(reason) {
  if (!armed) return;
  armed = false;
  drag = null;
  releaseControls();
  dirty = true;
  refreshStrip();
  syncVisible();
  paint();
  const who = reason && (reason.name || reason.label);
  /* 🚰 …and it names the LAYER going with it. The `pipes` legend row now
     defaults OFF (see /src/water/panel.js), so standing the tool down usually
     takes the painted mains off the map as well — a network the player just
     laid appearing to vanish is a stand-down they cannot read, which is the
     exact failure rig.js requires this toast to prevent. Plain text: node-city's
     toast() assigns textContent. */
  const hidden = !layerOn && api && api.Net && api.Net.count() > 0;
  toast('🚰 Pipe tool put away' + (who ? ' — you picked ' + who + '.' : '.') +
        ' Click 🚰 Pipes to lay mains again' +
        (hidden ? ' — your mains are still there; switch on “Water Mains” in the 💧 panel to keep them in view.' : '.'), 'good');
}

function buildMesh(T, sc) {
  THREE = T; scene = sc;
  try {
    /* 🌊 THE CANVAS IS WIDER THAN THE PLATE. A main that stops at the plate edge
       can never reach a Sea Drain, so the pipe DOMAIN runs `APRON` columns
       further east than the city does — and an overlay that only covered the
       plate would draw the run right up to the shoreline and then stop, which
       reads as the pipe having failed rather than as the picture having ended.
       Width is (GRID + APRON) tiles, height is still GRID; the plane below is
       offset east by APRON/2 so canvas x still maps tile x with no flip. */
    cvs = document.createElement('canvas');
    cvs.width = (GRID + APRON) * PX;
    cvs.height = GRID * PX;
    cx2 = cvs.getContext('2d');
    if (!cx2) return;
    tex = new THREE.CanvasTexture(cvs);
    /* NearestFilter, unlike the aquifer overlay's Linear one, and for the reason
       that file states in the other direction: an aquifer is a continuous body
       and hard tile edges draw a staircase the geology does not have — but a
       pipe either is under this tile or is not, and a smeared main is a main the
       player cannot tell the extent of. */
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(GRID + APRON, GRID);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true,
      opacity: M().overlayOpacity, depthWrite: false, toneMapped: false });
    mesh = new THREE.Mesh(geo, mat);
    /* 👁 NAMED, so a driver can read this one surface's visibility off the scene
       graph instead of inferring it. syncVisible() is the shipped gate (`armed
       || (layerOn && count > 0)`) and .gauntlet/utilgate-ab.mjs asserts it here
       beside the identical gate /src/power/lines.js now carries; an A/B that can
       only see pixels cannot tell "hidden" from "drawn behind something". */
    mesh.name = 'mythic-water-mains';
    // -PI/2 about X lays it flat with canvas (0,0) over tile (0,0) — node-city's
    // own mapping, no flip anywhere. Above both other info-view planes; see
    // WATER.mains.overlayY for why the y-stack is load-bearing.
    mesh.rotation.x = -Math.PI / 2;
    /* x = APRON/2, not 0. The plate's centre is the world origin; a plane that
       is APRON tiles wider but still centred there would hang half an apron off
       the WEST edge and paint the pipe network one and a half tiles out of
       register — a silent, uniform offset, which is the worst kind. */
    mesh.position.set(APRON / 2, M().overlayY, 0);
    mesh.renderOrder = M().renderOrder;
    mesh.visible = false;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
  } catch (e) { mesh = null; }
}

/* ── THE BUILD-BAR BUTTON ───────────────────────────────────────────────────
   Created here rather than in node-city so the whole feature is one import: a
   404 on /src/water leaves no dead button pointing at nothing. Same argument
   /src/zoning/ui.js makes for its own. */
function buildButton() {
  const bar = document.getElementById('buildbar');
  if (!bar) return;
  if (!document.getElementById('nwp-style')) {
    const st = document.createElement('style');
    st.id = 'nwp-style';
    st.textContent = `
#nwp-strip{position:absolute;left:50%;transform:translateX(-50%);bottom:92px;z-index:7;display:none;
  background:var(--panel,rgba(16,12,26,.92));border:1px solid var(--edge,rgba(212,175,55,.35));
  border-radius:10px;padding:7px 12px;color:var(--bone,#e9e0cc);font-size:12px;line-height:1.4;
  box-shadow:0 14px 34px rgba(0,0,0,.55);max-width:min(680px,calc(100% - 24px))}
#nwp-strip.on{display:block}
#nwp-strip b{color:var(--sky,#8fd0e8)}
#nwp-strip .nwphint{color:var(--mist,#8f87a3);font-size:11px}
#nwp-strip .nwpwarn{color:#ffbf9a}
#nwp-strip .nwpx{background:none;border:0;color:var(--mist,#8f87a3);cursor:pointer;font-size:13px;
  float:right;margin-left:10px}`;
    document.head.appendChild(st);
  }
  barBtn = document.createElement('button');
  barBtn.className = 'bbtn tool';
  barBtn.id = 'nwp-open';
  barBtn.innerHTML = '<span class="bico">🚰</span><span class="bname">Pipes</span>';
  barBtn.onclick = () => arm(!armed);
  bar.appendChild(barBtn);
}

function buildStrip() {
  strip = document.createElement('div');
  strip.id = 'nwp-strip';
  strip.addEventListener('click', (ev) => { if (ev.target.closest('[data-nwpx]')) arm(false); });
  (document.body || document.documentElement).appendChild(strip);
}

const money = (n) => Math.round(n).toLocaleString();

/* The price of ONE tile of main. The authored figure lives in this module's
   tuning table (WATER.mains.pipeCost, on node-city's own 2..600 shelf) and the
   ×100 scaling lives in the host's single scaleCost() helper — the same split
   /src/streets/index.js uses for `roadCost`, and with the same warning attached:
   reading a raw table figure without the host's scaling quotes 100× low and
   looks perfectly correct. */
function tilePrice() {
  const raw = M().pipeCost;
  try { if (typeof host.scaleCinder === 'function') return host.scaleCinder(raw) | 0; } catch (e) {}
  return null;   // unknown, NOT a guess — see commit()
}

function stripHtml() {
  const n = api.Net.count();
  const parts = api.Net.components().count;
  const price = tilePrice();
  const st = api.netState && api.netState();
  let h = '<button class="nwpx" type="button" data-nwpx="1" aria-label="Close">✖</button>';
  h += '<b>🚰 MAINS</b> — drag to lay a run · right-drag to lift one · Esc to stop';
  h += '<div class="nwphint">' + n + ' tile' + (n === 1 ? '' : 's') + ' of main · ' +
       parts + ' network' + (parts === 1 ? '' : 's') +
       (price != null ? ' · ' + money(price) + ' 🔥 per tile' : '') + '</div>';
  /* 🌊 THE SEA IS PART OF THE DOMAIN NOW, so the strip says so — a player who
     cannot drag past the city edge will not discover that they can. The count
     printed is LIVE drains (in the water AND on a main), because "you have two"
     and "two of yours are doing anything" are different sentences and only the
     second is advice. */
  if (APRON > 0) {
    const dz = api.Net.drainCount();
    const dl = st ? (st.drainsLive | 0) : 0;
    h += '<div class="nwphint">🌊 Drag east past the city edge to reach the water — ' +
         (dz ? dl + ' of ' + dz + ' Sea Drain' + (dz === 1 ? '' : 's') + ' on a main.'
             : 'place a 🌊 Sea Drain out there first.') + '</div>';
  }
  if (drag) {
    const path = api.Net.pathBetween(drag.x0, drag.z0, drag.x1, drag.z1, api.grid());
    const fresh = erase ? path.filter(k => api.Net.has(k)) : path.filter(k => !api.Net.has(k));
    h += '<div class="nwphint">' + (erase ? '🧽 Lifting ' : '▬ ') + fresh.length + ' of ' + path.length + ' tile' +
         (path.length === 1 ? '' : 's') +
         (!erase && price != null ? ' · <b>' + money(fresh.length * price) + ' 🔥</b>' : '') + '</div>';
  } else if (st && st.plumbed) {
    if (st.demand.unservedTiles) {
      h += '<div class="nwphint nwpwarn">⚠ ' + st.demand.unservedTiles +
           ' building' + (st.demand.unservedTiles === 1 ? '' : 's') + ' the mains do not reach.</div>';
    }
    if (st.backup > WATER.sewer.warnAbove) {
      h += '<div class="nwphint nwpwarn">🚱 ' + Math.round(st.backup * 100) +
           '% of the sewage has nowhere to go — build a Sewer Outfall on open water, or a 🌊 Sea Drain out in the ocean, and pipe it in.</div>';
    }
  }
  return h;
}

function refreshStrip() {
  if (!strip) return;
  strip.classList.toggle('on', armed);
  if (armed) strip.innerHTML = stripHtml();
  if (barBtn) barBtn.classList.toggle('active', armed);
}

/* ── ARMING, AND THE TOOL EXCLUSION ─────────────────────────────────────── */
export function arm(v) {
  const want = v == null ? true : !!v;
  if (want === armed) { refreshStrip(); return armed; }
  if (want) {
    if (!TOK) {
      toast('🚰 The shared map tool is not loaded in this build, so mains cannot be laid by hand.', 'bad');
      return false;
    }
    /* 🔴 THE ARBITER DECIDES, NOT THIS FILE. `arm()` returns false when it is
       re-entered from inside a stand-down — which is the loop rig.js exists to
       refuse — and taking the seat regardless is how two tools end up both
       believing they hold it. */
    if (!TOK.arm()) return armed;
    armed = true;
    /* Leave build mode, exactly as /src/zoning does — and tell the player, so a
       building taken out of their hand is a tool swap rather than a lost click.
       ⚠ SAFE TO CALL setMode HERE: this is the ARM path, not a stand-down. The
         arbiter's bindMode only reacts to setMode('place'). */
    let held = false;
    try { held = typeof host.mode === 'function' && host.mode() === 'place'; } catch (e) {}
    try { if (typeof host.setMode === 'function') host.setMode('inspect'); } catch (e) {}
    if (held) toast('🚰 Pipe tool armed — the building you were holding was put back. Press ✖, or pick a building again, to build.', 'good');
  } else {
    armed = false;
    drag = null; releaseControls();
    try { if (TOK) TOK.disarm(); } catch (e) {}
  }
  dirty = true;
  refreshStrip();
  syncVisible();
  /* 🐞 AND PAINT, WHICH THIS PATH DID NOT DO. paint() early-returns while the
     mesh is hidden, so the canvas holds whatever was last drawn into it — and
     with the `pipes` layer now defaulting OFF (see panel.js) that is NOTHING on
     a fresh city. arm() made the plane visible and then left it blank until the
     next water tick pushed a sync through, i.e. the player armed the pipe tool
     and got an empty map for up to a second. Measured at exactly 0.00% against
     a control of 0.00% by .gauntlet/utilgate-ab.mjs — the gate was right and the
     surface behind it was empty, which no `visible` assertion can tell apart.
     standDown() has always called paint() here; this path simply forgot. */
  paint();
  return armed;
}

function toast(msg, cls) { try { if (typeof host.toast === 'function') host.toast(msg, cls); } catch (e) {} }

function holdControls() {
  if (ctrlWas === null && host.controls) { ctrlWas = host.controls.enabled; host.controls.enabled = false; }
}
function releaseControls() {
  if (ctrlWas !== null && host.controls) { host.controls.enabled = ctrlWas; }
  ctrlWas = null;
}

/* ── POINTER ────────────────────────────────────────────────────────────────
   `hot` is the whole guard: armed, over the canvas, and the page able to turn a
   pointer into a tile. Anything else and the event is left alone.
   ⚠ THE `place` BELT, same as /src/zoning's. If this is ever loaded against a
     page with no mode hook, the exclusion above cannot fire — and then the
     player who just picked a building must win, because they are holding it. */
function hot(ev) {
  const canvas = host.canvas;
  if (!armed || !canvas || !canPick()) return false;
  if (ev.target !== canvas) return false;
  try { if (typeof host.mode === 'function' && host.mode() === 'place') return false; } catch (e) {}
  return true;
}

function canPick() {
  return typeof host.cellFromEvent === 'function' || typeof host.tileFromEvent === 'function';
}

/* 🌊 THE PICKER IS cellFromEvent, NOT tileFromEvent, AND THAT IS THE ONE LINE
   THAT LETS A MAIN CROSS THE SHORELINE. node-city's tileFromEvent ends in
   `inGrid(x, z) ? {x, z} : null`, so it refuses every cell off the plate —
   including every cell the Sea Drain can stand on. cellFromEvent is the same
   raycast against the same mathematical y = 0 plane with the apron allowed, and
   its own header states what it is: "a PICKER, not a permission. It widens what
   can be POINTED AT by `pad` cells; it grants nothing." tryPlace is untouched;
   nothing here writes game.tiles.
   ⚠ FALLBACK COSTS THE APRON, NOT THE FEATURE. An older node-city with no
     cellFromEvent still lays mains across the plate exactly as it did before —
     it simply cannot reach the water, and /src/water/drain.js says so once. */
function pick(ev) {
  try {
    if (typeof host.cellFromEvent === 'function') return host.cellFromEvent(ev, APRON);
    if (typeof host.tileFromEvent === 'function') return host.tileFromEvent(ev);
  } catch (e) {}
  return null;
}

function onDown(ev) {
  if (!hot(ev) || (ev.button !== 0 && ev.button !== 2)) return;
  const t = pick(ev);
  if (!t) return;
  ev.preventDefault(); ev.stopPropagation();
  erase = ev.button === 2;
  drag = { x0: t.x, z0: t.z, x1: t.x, z1: t.z };
  holdControls();
  dirty = true; refreshStrip(); paint();
}

function onMove(ev) {
  if (!hot(ev)) return;
  if (!drag) return;
  const t = pick(ev);
  ev.preventDefault(); ev.stopPropagation();
  if (t && (t.x !== drag.x1 || t.z !== drag.z1)) {
    drag.x1 = t.x; drag.z1 = t.z;
    dirty = true; refreshStrip(); paint();
  }
}

function onUp(ev) {
  if (!drag) return;
  const d = drag;
  drag = null;
  releaseControls();
  if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); }
  commit(d);
}

function onCtx(ev) { if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); } }

function onKey(ev) {
  if (!armed) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (ev.key === 'Escape') { arm(false); ev.stopPropagation(); }
}

/* ── THE COMMIT ─────────────────────────────────────────────────────────────
   🔴 ONE AWAITED CHARGE FOR THE WHOLE RUN, NOT ONE PER TILE. node-city's
      tryPlace() is an awaited bridge round-trip per building and its refusals
      are toasts on a three-slot rail; a 20-tile drag through that path shows the
      player three arbitrary refusals and no account of the rest, which is why
      /src/zoning's develop() had to invent the __ncToastSink batching pattern.
      A pipe is not a BUILDINGS row and does not go near tryPlace, so the honest
      shape here is the simple one: price the run, charge it once, lay it once,
      say so once.
   ⚠ AND THE PRICE IS NEVER GUESSED. If the host did not hand over its cost
     scaler, tilePrice() returns null and this refuses rather than laying free
     pipe — a utility that is silently free is a balance change nobody chose.
     ⚠ `busy` because payCost is awaited: a second drag released while the first
       is in flight would spend twice against one quote. */
async function commit(d) {
  if (busy) return;
  const path = api.Net.pathBetween(d.x0, d.z0, d.x1, d.z1, api.grid());
  if (!path.length) { dirty = true; paint(); return; }

  if (erase) {
    const n = api.Net.remove(path);
    if (n) {
      toast('🧽 Lifted ' + n + ' tile' + (n === 1 ? '' : 's') + ' of main.', 'good');
      after();
    }
    dirty = true; refreshStrip(); paint();
    return;
  }

  const fresh = path.filter(k => !api.Net.has(k));
  if (!fresh.length) { dirty = true; paint(); refreshStrip(); return; }

  const price = tilePrice();
  if (price == null) {
    toast('🚰 The pipe price is unavailable in this build, so nothing was laid. (The city did not hand /src/water its cost scaler.)', 'bad');
    dirty = true; paint(); return;
  }
  const total = fresh.length * price;
  busy = true;
  try {
    let paid = false;
    try { paid = typeof host.payCost === 'function' ? await host.payCost({ cinder: total }) : false; }
    catch (e) { paid = false; }
    if (!paid) {
      toast('🚰 Cannot afford ' + fresh.length + ' tile' + (fresh.length === 1 ? '' : 's') +
            ' of main (' + money(total) + ' 🔥).', 'bad');
      dirty = true; paint(); return;
    }
    api.Net.add(fresh);
    toast('🚰 Laid ' + fresh.length + ' tile' + (fresh.length === 1 ? '' : 's') + ' of main · ' +
          money(total) + ' 🔥.', 'good');
    after();
  } finally {
    busy = false;
    dirty = true; refreshStrip(); paint();
  }
}

function after() {
  try { if (typeof host.saveSoon === 'function') host.saveSoon(); } catch (e) {}
  try { if (api && api.onEdit) api.onEdit(); } catch (e) {}
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PAINT. Tile space throughout, one canvas, repainted only when the picture
   actually changed — the signature gate /src/water/overlay.js states.
   ════════════════════════════════════════════════════════════════════════════ */
const px = (v) => v * PX + PX / 2;

function line(a, b, col, w) {
  cx2.strokeStyle = col;
  cx2.lineWidth = w;
  cx2.lineCap = 'round';
  cx2.beginPath();
  cx2.moveTo(px(a.x), px(a.z));
  cx2.lineTo(px(b.x), px(b.z));
  cx2.stroke();
}
function dot(p, col, r) {
  cx2.fillStyle = col;
  cx2.beginPath();
  cx2.arc(px(p.x), px(p.z), r, 0, Math.PI * 2);
  cx2.fill();
}
const parse = (k) => { const p = String(k).split(','); return { x: +p[0], z: +p[1] }; };

export function sync(state, layerEnabled) {
  lastState = state || lastState;
  layerOn = !!layerEnabled;
  syncVisible();
  paint();
}

export function onSolve(s) { lastState = s; dirty = true; paint(); refreshStrip(); }

function syncVisible() {
  if (!mesh) return;
  mesh.visible = armed || (layerOn && api.Net.count() > 0);
}

function paint() {
  if (!mesh || !cx2) return;
  syncVisible();
  if (!mesh.visible) return;

  const st = api.netState && api.netState();
  const sig = [
    api.Net.count(), api.Net.keys().join('|'),
    drag ? drag.x0 + ':' + drag.z0 + ':' + drag.x1 + ':' + drag.z1 + ':' + (erase ? 'e' : 'd') : '-',
    st ? st.components + ':' + st.wells.map(w => w.comp).join(',') : '-',
    api.Net.drainKeys().join('|'),
  ].join('#');
  if (!dirty && sig === lastSig) return;
  dirty = false; lastSig = sig;

  cx2.clearRect(0, 0, cvs.width, cvs.height);
  const C = WATER.col;
  const W = Math.max(2, PX * 0.26);

  /* WHICH COMPONENTS ARE ALIVE. A main with no waterworks on it is drawn dead
     slate rather than left out: the player built it, it is there, and "why is
     that run grey" is precisely the question this overlay exists to answer —
     the same argument /src/water/overlay.js makes for its grey well marker. */
  const live = new Set();
  if (st) for (const w of st.wells) if (w.comp >= 0) live.add(w.comp);

  const comp = st ? st.comp : api.Net.components();
  const keys = api.Net.keys();
  const set = new Set(keys);

  // Trunks first, then junctions on top, so a corner reads as a joint.
  for (const k of keys) {
    const a = parse(k);
    const c = comp.id[k];
    const col = (!st || !st.plumbed) ? C.pipe : (live.has(c) ? C.pipe : C.pipeDead);
    for (const b of [{ x: a.x + 1, z: a.z }, { x: a.x, z: a.z + 1 }]) {
      if (set.has(b.x + ',' + b.z)) line(a, b, col, W);
    }
    dot(a, col, W * 0.62);
  }

  /* 🌊 THE MOVING WATER, over the trunks. A SECOND PASS rather than an extra
     stroke inside the trunk loop, because every dash has to be drawn with the
     same phase and the same dash array — interleaving it would mean setting
     and clearing the dash pattern once per edge for no benefit.
     ⚠ `st.plumbed` MATTERS. Before the first solve every run would otherwise
       animate, which tells the player their pipes work before anything has
       checked whether they do. */
  const carrying = !!(st && st.plumbed && live.size);
  if (carrying) {
    const fd = flowField(st, set);
    for (const k of keys) {
      if (!live.has(comp.id[k])) continue;
      const da = fd[k];
      if (da === undefined) continue;          // live component, unreached tile
      const a = parse(k);
      for (const b of [{ x: a.x + 1, z: a.z }, { x: a.x, z: a.z + 1 }]) {
        const bk = b.x + ',' + b.z;
        if (!set.has(bk)) continue;
        const db = fd[bk];
        if (db === undefined || da === db) continue;
        /* Equal hops means the two tiles are fed from opposite directions and
           neither leads; that edge is left still rather than given a side at
           random. Otherwise the nearest-the-source end goes first. */
        if (da < db) flowEdge(a, b); else flowEdge(b, a);
      }
    }
  }
  /* 🌊 ARM OR DISARM THE LOOP, from the same pass that decided whether there
     is anything to animate. Nothing else in this file may set `flowLive`. */
  if (carrying !== flowLive) { flowLive = carrying; if (!carrying) flowStop(); }
  flowSchedule();

  /* THE DRAG PREVIEW. Ember for new tiles, red for the ones a right-drag will
     lift, and the tiles already carrying a main are drawn in neither — a
     preview that highlights what will not change is a preview that lies about
     the price on the strip beside it. */
  if (drag) {
    const path = api.Net.pathBetween(drag.x0, drag.z0, drag.x1, drag.z1, api.grid());
    const col = erase ? C.pipeBad : C.pipeGhost;
    for (let i = 0; i < path.length; i++) {
      const a = parse(path[i]);
      const shown = erase ? set.has(path[i]) : !set.has(path[i]);
      if (i + 1 < path.length) {
        const b = parse(path[i + 1]);
        const bShown = erase ? set.has(path[i + 1]) : !set.has(path[i + 1]);
        if (shown || bShown) line(a, b, col, W * 0.9);
      }
      if (shown) dot(a, col, W * 0.55);
    }
  }

  /* THE OUTFALLS. Marked on the network they are attached to, because "is my
     outfall on the main" is the second question the sewer meter provokes and
     the answer is otherwise invisible. */
  if (st) for (const o of st.sewage.outfalls) {
    /* `live` — wet AND on a main — not `effective > 0`. An outfall on a main
       that has no demand on it yet treats nothing simply because there is
       nothing to treat, and painting that red tells a player who just built it
       correctly that they built it wrong. */
    cx2.strokeStyle = o.live ? C.sewer : C.pipeBad;
    cx2.lineWidth = Math.max(2, PX * 0.14);
    cx2.strokeRect(o.x * PX + PX * 0.16, o.z * PX + PX * 0.16, PX * 0.68, PX * 0.68);
    /* 🌊 A DRAIN IS FILLED, AN OUTFALL IS OUTLINED. Two endpoints on one graph
       with two different rules about where they may stand should not be one
       symbol — the player has to be able to tell, at a glance, which of their
       sewer capacity is out in the water. */
    if (o.kind === 'drain') {
      cx2.fillStyle = o.live ? C.sewer : C.pipeBad;
      cx2.globalAlpha = 0.42;
      cx2.fillRect(o.x * PX + PX * 0.16, o.z * PX + PX * 0.16, PX * 0.68, PX * 0.68);
      cx2.globalAlpha = 1;
    }
  }

  tex.needsUpdate = true;
}

export function dispose() {
  if (!mesh) return;
  try { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); tex.dispose(); } catch (e) {}
  mesh = tex = cvs = cx2 = null;
}

export default { mount, arm, isArmed, sync, onSolve, repaintNext, dispose };
