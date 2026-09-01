/* ══════════════════════════════════════════════════════════════════════════
   🚶 PLAYER — walking the lab floor. Input, collision, camera follow.
   ──────────────────────────────────────────────────────────────────────────
   No three.js in this file. It owns a position, a facing and a velocity, and
   the scene reads them; that split is what lets the movement be stepped and
   asserted in a headless test, which matters here because the Browser pane in
   this environment NEVER COMPOSITES (CLAUDE.md, "Verifying"): requestAnimation
   Frame does not fire, so anything only observable through the render loop is
   effectively unverifiable. `step()` is the whole simulation and takes dt as
   an argument, so a driver can walk the player into a wall by hand.

   ⚠ TOUCH IS NOT AN AFTERTHOUGHT. This game ships as a PWA and most sessions
   are phones. The virtual stick is built here, in the same code path as WASD,
   so the two can never drift into different movement behaviours.
   ══════════════════════════════════════════════════════════════════════════ */

import { ROOM, colliders } from './stations.js';

export const SPEED = 5.2;             // metres/sec, walking
export const RADIUS = 0.42;           // the player's collision radius

/* ── screen space → world space ───────────────────────────────────────────
   🔴 SHIPPED BACKWARDS ONCE: A MOVED RIGHT AND D MOVED LEFT.

   axisOf() returns the player's SCREEN intent — `ax` is "how far right on the
   screen", `az` is "how far up the screen" — because that is what a key press
   and a thumb on a stick actually mean. Turning that into world metres needs
   the camera's orientation, and the camera is fixed (scene.js: positioned at
   z − 13.5 and looking at z + 2.5, so its view direction is world +z).

   Three.js builds a lookAt basis as xAxis = cross(up, eye − target). Here that
   is cross((0,1,0), (0,0,−1)) = (−1, 0, 0), so:

       screen right = world −x        screen up = world +z

   The z half was right by luck; the x half was not, and mapping `d` to world
   +x sent the player left. Anyone who moves the camera must revisit THIS
   constant — it is the only place the two spaces are reconciled, and a second
   sign flip hidden somewhere downstream is how this bug comes back. */
export const SCREEN_X_TO_WORLD = -1;

export function makePlayer() {
  return {
    x: 0, z: -15.5,                   // just outside the airlock, facing in
    vx: 0, vz: 0,
    facing: 0,                        // radians; 0 = +z (into the lab)
    moving: false,
    bob: 0,                           // walk-cycle phase, for the scene's bob
  };
}

/* ── input ─────────────────────────────────────────────────────────────────
   One object with an `axis` the simulation reads, filled by whichever device
   is present. Keys and stick both write the same two numbers, so there is no
   "keyboard movement" and "touch movement" — there is movement. */
export function makeInput() {
  return { keys: {}, stickX: 0, stickY: 0, interact: false, _interactEdge: false };
}

/* Returns SCREEN intent, not world direction: `ax` is how far right on the
   screen the player is asking to go, `az` how far up. step() converts. Keeping
   this in screen space is what lets the keyboard and the thumbstick share one
   code path — both of them mean "right", neither means "+x". */
export function axisOf(input) {
  let ax = 0, az = 0;
  const k = input.keys;
  if (k.w || k.ArrowUp) az += 1;      // up the screen
  if (k.s || k.ArrowDown) az -= 1;    // down the screen
  if (k.a || k.ArrowLeft) ax -= 1;    // left on the screen
  if (k.d || k.ArrowRight) ax += 1;   // right on the screen
  ax += input.stickX;
  az += input.stickY;
  const m = Math.hypot(ax, az);
  // Normalise so diagonal walking is not 41% faster than straight — the
  // classic bug, and very visible in a room this small.
  if (m > 1) { ax /= m; az /= m; }
  return { ax, az, mag: Math.min(1, m) };
}

/* ── collision ─────────────────────────────────────────────────────────────
   Axis-separated AABB sweep. Move on x, resolve; move on z, resolve. Cheap,
   stable, and it slides along a bench instead of sticking to it — which is the
   difference between a room that feels walkable and one that feels like glue.

   🔴 IT RESOLVES OUT OF THE SHORTEST AXIS AND NEVER TELEPORTS. An overlap
   deeper than the box (only reachable if something spawned the player inside
   a bench) is pushed out the near side rather than snapped to the centre,
   because snapping is how a player ends up on the wrong side of a wall. */
function resolveAxis(px, pz, boxes, axis) {
  for (const b of boxes) {
    const dx = px - b.x, dz = pz - b.z;
    const ox = (b.hx + RADIUS) - Math.abs(dx);
    const oz = (b.hz + RADIUS) - Math.abs(dz);
    if (ox <= 0 || oz <= 0) continue;                  // no overlap
    if (axis === 'x') px += (dx >= 0 ? ox : -ox);
    else pz += (dz >= 0 ? oz : -oz);
  }
  return axis === 'x' ? px : pz;
}

export function step(p, input, dtMs) {
  const dt = Math.max(0, Math.min(100, +dtMs || 0)) / 1000;   // clamp: a tab that
  // was backgrounded must not deliver a two-second frame and shove the player
  // through a wall. 100ms is ~6 frames of catch-up, which is plenty.
  const { ax, az, mag } = axisOf(input);
  const boxes = colliders();

  p.moving = mag > 0.05;
  if (p.moving) {
    // Screen intent → world metres. See SCREEN_X_TO_WORLD.
    p.vx = ax * SCREEN_X_TO_WORLD * SPEED;
    p.vz = az * SPEED;
    p.facing = Math.atan2(p.vx, p.vz);
    p.bob = (p.bob + dt * 9 * mag) % (Math.PI * 2);
  } else {
    // A short glide rather than a dead stop — it reads as weight.
    p.vx *= Math.pow(0.0015, dt);
    p.vz *= Math.pow(0.0015, dt);
    if (Math.abs(p.vx) < 0.01) p.vx = 0;
    if (Math.abs(p.vz) < 0.01) p.vz = 0;
  }

  let nx = p.x + p.vx * dt;
  let nz = p.z + p.vz * dt;

  nx = resolveAxis(nx, p.z, boxes, 'x');
  nz = resolveAxis(nx, nz, boxes, 'z');

  // Walls. The airlock end is open to the corridor the player entered from,
  // so the −z wall sits a little further out than the room's nominal depth.
  const hw = ROOM.w / 2 - RADIUS, hd = ROOM.d / 2 - RADIUS;
  p.x = Math.max(-hw, Math.min(hw, nx));
  p.z = Math.max(-hd, Math.min(hd, nz));
  return p;
}

/* ── the DOM half ──────────────────────────────────────────────────────────
   Attaches keyboard + a floating virtual stick to a root element and returns
   a detach function. Every listener it adds is removed by that function —
   this overlay is opened and closed repeatedly and a leaked keydown handler
   would eat the game's own keys after the lab closes. */
export function attachInput(root, input, opts) {
  const o = opts || {};
  const onInteract = typeof o.onInteract === 'function' ? o.onInteract : () => {};
  const onExit = typeof o.onExit === 'function' ? o.onExit : () => {};
  const offs = [];
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); };

  const kd = (e) => {
    const k = e.key;
    if (k === 'Escape') { onExit(); return; }
    if (k === ' ' || k === 'Enter' || k === 'e' || k === 'E') {
      if (!input._interactEdge) { input._interactEdge = true; onInteract(); }
      e.preventDefault();
      return;
    }
    const n = k.length === 1 ? k.toLowerCase() : k;
    if (n === 'w' || n === 'a' || n === 's' || n === 'd' || k.startsWith('Arrow')) {
      input.keys[n] = true;
      e.preventDefault();
    }
  };
  const ku = (e) => {
    const k = e.key;
    if (k === ' ' || k === 'Enter' || k === 'e' || k === 'E') { input._interactEdge = false; return; }
    const n = k.length === 1 ? k.toLowerCase() : k;
    delete input.keys[n];
  };
  on(window, 'keydown', kd);
  on(window, 'keyup', ku);
  /* 🔴 A BLURRED WINDOW MUST DROP EVERY KEY. Alt-tabbing while holding W and
     coming back to a player walking into a wall forever is the single most
     reported bug in every game that forgets this line. */
  const blur = () => { input.keys = {}; input.stickX = 0; input.stickY = 0; input._interactEdge = false; };
  on(window, 'blur', blur);

  // ── virtual stick. Anywhere on the left half of the screen; the base is
  //    placed where the finger lands rather than at a fixed spot, which is
  //    what makes it usable without looking.
  const stick = root.querySelector('.bl-stick');
  const nub = root.querySelector('.bl-stick-nub');
  let touchId = null, baseX = 0, baseY = 0;
  const R = 52;

  const startAt = (id, x, y) => {
    touchId = id; baseX = x; baseY = y;
    if (stick) { stick.style.left = x + 'px'; stick.style.top = y + 'px'; stick.classList.add('on'); }
    if (nub) nub.style.transform = 'translate(-50%,-50%)';
  };
  const moveTo = (x, y) => {
    let dx = x - baseX, dy = y - baseY;
    const m = Math.hypot(dx, dy);
    if (m > R) { dx = dx / m * R; dy = dy / m * R; }
    input.stickX = dx / R;
    // Screen −y is forward (into the room), so the sign flips here and only here.
    input.stickY = -dy / R;
    if (nub) nub.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
  };
  const end = () => {
    touchId = null; input.stickX = 0; input.stickY = 0;
    if (stick) stick.classList.remove('on');
    if (nub) nub.style.transform = 'translate(-50%,-50%)';
  };

  const ts = (e) => {
    for (const t of e.changedTouches) {
      if (touchId !== null) break;
      // Right half is reserved for the interact button and the panels.
      if (t.clientX > window.innerWidth * 0.55) continue;
      startAt(t.identifier, t.clientX, t.clientY);
      e.preventDefault();
    }
  };
  const tm = (e) => {
    for (const t of e.changedTouches) if (t.identifier === touchId) { moveTo(t.clientX, t.clientY); e.preventDefault(); }
  };
  const te = (e) => {
    for (const t of e.changedTouches) if (t.identifier === touchId) end();
  };
  on(root, 'touchstart', ts, { passive: false });
  on(root, 'touchmove', tm, { passive: false });
  on(root, 'touchend', te);
  on(root, 'touchcancel', te);

  return function detach() {
    for (const f of offs) { try { f(); } catch (e) {} }
    offs.length = 0;
    blur();
  };
}
