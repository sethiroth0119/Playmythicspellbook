/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — the operator: movement, camera, and E-to-interact
   ---------------------------------------------------------------------------
   The yard used to be a fixed top-down plate you clicked. Now you walk it, and
   the panels open because you went and stood at the thing.

   THREE THINGS THIS FILE IS CAREFUL ABOUT
     1. It never assumes a character MODEL exists. A procedural figure with a
        hand-authored walk cycle ships in the box, so the yard is playable
        before anyone uploads a rig, and a supplied GLB simply replaces it.
     2. Interaction is PROXIMITY plus FACING, not proximity alone. Standing
        between two units and having the prompt flicker between them is the
        classic version of this bug; the pick is scored so the thing you are
        looking at wins.
     3. The camera never passes through a wall of the office. It shortens
        instead — the standard third-person answer, and the only one that does
        not need collision geometry the yard has no reason to carry.
   ═════════════════════════════════════════════════════════════════════════ */

import * as Models from './models.js';

let T = null;
const KEYS = Object.create(null);

/* Movement feel. Tuned against the yard's 88-unit span: a full crossing is
   about twelve seconds at a walk, four at a run, which is long enough for the
   place to feel like a site and short enough not to be a chore. */
const SPEED_WALK = 7.4;      // yard units / second
const SPEED_RUN  = 13.2;
const ACCEL      = 12.0;
const TURN_RATE  = 11.0;     // radians / second toward the heading
const EYE        = 1.62;

/* Interaction. REACH is generous because a player should not have to nose
   into a tank to open it; the facing term is what keeps it unambiguous. */
const REACH      = 7.0;

export function create(scene, camera, opts) {
  T = window.THREE;
  if (!T) return null;

  const o = opts || {};
  const self = {
    group: new T.Group(),
    pos: new T.Vector3(o.x || 0, 0, o.z == null ? 30 : o.z),
    vel: new T.Vector3(),
    heading: Math.PI,          // facing into the yard from the apron
    camYaw: Math.PI,
    camPitch: 0.62,
    camDist: 19.5,
    speed: 0,
    mixer: null,
    actions: {},
    current: null,
    procedural: null,
    blockers: [],              // { x, z, r } footprints the player cannot enter
    interactables: [],         // { id, label, x, z, r, action }
    focus: null,
    inside: null,              // id of the interior volume the player is in
    interiors: [],             // { id, minX, maxX, minZ, maxZ }
    enabled: true,
    onInteract: o.onInteract || null,
    onEnter: o.onEnter || null,
  };

  self.group.position.copy(self.pos);
  scene.add(self.group);
  buildAvatar(self);

  self.camera = camera;
  return self;
}

/* ── THE AVATAR ═══════════════════════════════════════════════════════════
   A supplied GLB wins. Otherwise a jointed figure whose limbs are swung by
   the same phase the footstep timing uses, so the placeholder actually walks
   rather than sliding. */
function buildAvatar(self) {
  while (self.group.children.length) self.group.remove(self.group.children[0]);
  self.mixer = null; self.actions = {}; self.current = null; self.procedural = null;

  const model = Models.build('character', () => proceduralFigure());
  self.group.add(model);
  self.model = model;

  if (model.userData.custom) {
    const idle = Models.clipFor('character', 'idle');
    const walk = Models.clipFor('character', 'walk');
    const run  = Models.clipFor('character', 'run');
    if (idle || walk || run) {
      self.mixer = new T.AnimationMixer(model);
      if (idle) self.actions.idle = self.mixer.clipAction(idle);
      if (walk) self.actions.walk = self.mixer.clipAction(walk);
      if (run)  self.actions.run  = self.mixer.clipAction(run);
      for (const k in self.actions) { self.actions[k].loop = T.LoopRepeat; self.actions[k].enabled = true; }
      play(self, self.actions.idle ? 'idle' : (self.actions.walk ? 'walk' : 'run'));
    }
  } else {
    self.procedural = model.userData.rig || null;
  }
}
export function rebuildAvatar(self) { if (self) buildAvatar(self); }

/* Crossfade between clips. Without the fade a supplied rig snaps between
   stances on every speed change, which reads as a stutter, not a step. */
function play(self, name) {
  const next = self.actions[name];
  if (!next || self.current === name) return;
  const prev = self.actions[self.current];
  next.reset().play();
  if (prev) { next.crossFadeFrom(prev, 0.22, true); } else { next.fadeIn(0.18); }
  self.current = name;
}

/* ⚠ NO CapsuleGeometry. The game is on the legacy three.js r128 global (see
   the note at the top of scene.js); CapsuleGeometry did not land until r142,
   and calling it here threw and took the entire 3D yard down to its fallback
   card. Built from a cylinder and two hemispheres instead — same silhouette,
   available since forever. */
function capsule(radius, length, radialSeg) {
  const g = new T.Group();
  const seg = radialSeg || 10;
  const mid = new T.Mesh(new T.CylinderGeometry(radius, radius, length, seg, 1, true), null);
  const top = new T.Mesh(new T.SphereGeometry(radius, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2), null);
  const bot = new T.Mesh(new T.SphereGeometry(radius, seg, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), null);
  top.position.y = length / 2; bot.position.y = -length / 2;
  g.add(mid, top, bot);
  g.userData.parts = [mid, top, bot];
  return g;
}
/* Apply one material across a capsule's three pieces. */
function paint(cap, material) {
  cap.userData.parts.forEach(p => { p.material = material; p.castShadow = true; p.receiveShadow = true; });
  return cap;
}

/* The stand-in operator: hi-vis vest, hard hat, and limbs that actually
   articulate. Deliberately readable from the yard camera rather than detailed
   — at this distance a silhouette and a colour are the whole of it. */
function proceduralFigure() {
  const g = new T.Group();
  const M = (c, r, m) => new T.MeshStandardMaterial({ color: c, roughness: r == null ? 0.72 : r, metalness: m || 0.05 });
  const skin = M(0xc98f63, 0.86), vest = M(0xf0a63a, 0.62), dark = M(0x2a2f38, 0.8),
        boot = M(0x18191d, 0.9), hat = M(0xf5d547, 0.5, 0.15);

  const torso = paint(capsule(0.27, 0.52, 12), vest);
  torso.position.y = 1.22; g.add(torso);
  // The reflective band is what makes the figure read as site crew at 60 units.
  const band = new T.Mesh(new T.TorusGeometry(0.28, 0.045, 6, 16), M(0xe8eef5, 0.35, 0.3));
  band.rotation.x = Math.PI / 2; band.position.y = 1.24; g.add(band);

  const head = new T.Mesh(new T.SphereGeometry(0.185, 14, 12), skin);
  head.position.y = 1.72; g.add(head);
  const helmet = new T.Mesh(new T.SphereGeometry(0.205, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hat);
  helmet.position.y = 1.73; g.add(helmet);
  const brim = new T.Mesh(new T.CylinderGeometry(0.25, 0.25, 0.03, 14), hat);
  brim.position.set(0, 1.73, 0); g.add(brim);

  const limb = (mat, len, rad) => {
    const pivot = new T.Group();
    const m = paint(capsule(rad, len, 8), mat);
    m.position.y = -len / 2 - rad * 0.5;
    pivot.add(m);
    return pivot;
  };
  const armL = limb(vest, 0.42, 0.085), armR = limb(vest, 0.42, 0.085);
  armL.position.set(-0.33, 1.46, 0); armR.position.set(0.33, 1.46, 0);
  const legL = limb(dark, 0.52, 0.105), legR = limb(dark, 0.52, 0.105);
  legL.position.set(-0.14, 0.86, 0); legR.position.set(0.14, 0.86, 0);
  g.add(armL, armR, legL, legR);

  [[-0.14, legL], [0.14, legR]].forEach(([x]) => {
    const b = new T.Mesh(new T.BoxGeometry(0.16, 0.1, 0.26), boot);
    b.position.set(x, 0.05, 0.03); g.add(b);
  });

  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData.rig = { armL, armR, legL, legR, torso, head, helmet, brim };
  return g;
}

/* ── INPUT ════════════════════════════════════════════════════════════════ */
export function bindInput(self, dom) {
  const down = e => {
    if (!self.enabled) return;
    const k = e.key.toLowerCase();
    KEYS[k] = true;
    /* Arrow keys and space scroll the panel behind the canvas; WASD does not,
       so only the ones that would misbehave are swallowed. */
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (k === 'e') { e.preventDefault(); interact(self); }
  };
  const up = e => { KEYS[e.key.toLowerCase()] = false; };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  // A window that loses focus mid-stride leaves the key stuck down and the
  // operator walks into the fence until you click back and tap the key.
  const blur = () => { for (const k in KEYS) KEYS[k] = false; };
  window.addEventListener('blur', blur);

  let drag = null;
  const pDown = e => { if (e.button === 0 || e.button === 2) drag = { x: e.clientX, y: e.clientY }; };
  const pMove = e => {
    if (!drag) return;
    self.camYaw   -= (e.clientX - drag.x) * 0.006;
    self.camPitch  = clamp(self.camPitch - (e.clientY - drag.y) * 0.004, 0.12, 1.18);
    drag = { x: e.clientX, y: e.clientY };
  };
  const pUp = () => { drag = null; };
  const wheel = e => { e.preventDefault(); self.camDist = clamp(self.camDist + e.deltaY * 0.016, 7, 42); };
  const ctx = e => e.preventDefault();       // right-drag orbits; no menu
  if (dom) {
    dom.addEventListener('pointerdown', pDown);
    dom.addEventListener('wheel', wheel, { passive: false });
    dom.addEventListener('contextmenu', ctx);
  }
  window.addEventListener('pointermove', pMove);
  window.addEventListener('pointerup', pUp);

  self._unbind = () => {
    window.removeEventListener('keydown', down); window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
    window.removeEventListener('pointermove', pMove); window.removeEventListener('pointerup', pUp);
    if (dom) { dom.removeEventListener('pointerdown', pDown); dom.removeEventListener('wheel', wheel); dom.removeEventListener('contextmenu', ctx); }
  };
  return self._unbind;
}

/* Touch stick, for phones. Set by the UI's on-screen pad. */
export function setStick(self, x, y) { self.stick = (x || y) ? { x, y } : null; }
export function setRunning(self, on) { self.stickRun = !!on; }

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ── WORLD REGISTRATION ═══════════════════════════════════════════════════
   The scene tells the controller what is solid and what can be talked to.
   Rebuilt whenever the yard is rebuilt, because a newly-built unit has to be
   both immediately. */
export function setWorld(self, { blockers, interactables, interiors }) {
  self.blockers = blockers || [];
  self.interactables = interactables || [];
  self.interiors = interiors || [];
  // The yard just changed shape. If it changed shape around the player, get
  // them out before they discover it by not being able to walk.
  return eject(self);
}

/* ── STEP ═════════════════════════════════════════════════════════════════ */
export function step(self, dt, bounds) {
  if (!self) return;
  /* Cap the step so a backgrounded tab cannot teleport the player through a
     wall on its first frame back. 0.1s (10fps) rather than 0.05: below the cap
     the world runs in SLOW MOTION rather than merely choppily, and a 0.05 cap
     halved the walking speed on any device that could not hold 20fps. */
  dt = Math.min(dt, 0.1);

  // ── Desired direction, in CAMERA space: "forward" is where you are looking,
  //    which is the only mapping that does not feel wrong when the camera has
  //    been orbited round behind a tank.
  let ix = 0, iz = 0;
  if (self.enabled) {
    if (KEYS['w'] || KEYS['arrowup'])    iz -= 1;
    if (KEYS['s'] || KEYS['arrowdown'])  iz += 1;
    if (KEYS['a'] || KEYS['arrowleft'])  ix -= 1;
    if (KEYS['d'] || KEYS['arrowright']) ix += 1;
    if (self.stick) { ix += self.stick.x; iz += self.stick.y; }
  }
  const running = !!(KEYS['shift'] || self.stickRun);
  const mag = Math.hypot(ix, iz);

  let wantX = 0, wantZ = 0;
  if (mag > 0.06) {
    const nx = ix / mag, nz = iz / mag;
    const cy = Math.cos(self.camYaw), sy = Math.sin(self.camYaw);
    /* ⚠ DERIVE THESE, DO NOT GUESS THEM. Both axes were inverted here — W
       walked backwards out of the yard and D walked west — which is the kind
       of bug that reads as "the controls feel wrong" rather than as a fault.
       updateCamera places the lens at pos − (sin(yaw), cos(yaw))·d, so the
       camera→player direction, i.e. FORWARD, is:
           F = ( sin(yaw),  cos(yaw) )
       and right-of-forward, with +Y up, is F × up:
           R = (−cos(yaw),  sin(yaw) )
       Input is +x right and −z forward (W does iz −= 1), so the world vector
       is ix·R + (−iz)·F. Check it at yaw = π (F = (0,−1), the opening view):
       W → (0,−1) into the yard, D → (1,0) east. Both correct. */
    const fwd = -nz;
    wantX = nx * (-cy) + fwd * sy;
    wantZ = nx * (sy)  + fwd * cy;
    self.heading = Math.atan2(wantX, wantZ);
  }

  const target = (mag > 0.06 ? (running ? SPEED_RUN : SPEED_WALK) : 0) * Math.min(1, mag);
  self.speed += (target - self.speed) * Math.min(1, ACCEL * dt);
  if (self.speed < 0.02) self.speed = 0;

  if (self.speed > 0) {
    const stepX = wantX * self.speed * dt;
    const stepZ = wantZ * self.speed * dt;
    /* Axis-separated collision. Resolving both axes at once makes a player who
       walks into a tank at an angle stop dead; resolving them independently
       lets them slide along it, which is what every third-person game does and
       what stops the yard feeling like a maze of glue. */
    if (!blocked(self, self.pos.x + stepX, self.pos.z)) self.pos.x += stepX;
    if (!blocked(self, self.pos.x, self.pos.z + stepZ)) self.pos.z += stepZ;
  }

  // Site fence.
  const B = bounds || 44;
  self.pos.x = clamp(self.pos.x, -B, B);
  self.pos.z = clamp(self.pos.z, -B, B);

  // Turn toward the heading rather than snapping — a snap reads as a glitch.
  const cur = self.group.rotation.y;
  let d = self.heading - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  self.group.rotation.y = cur + d * Math.min(1, TURN_RATE * dt);
  self.group.position.copy(self.pos);

  // ── Animation
  if (self.mixer) {
    self.mixer.update(dt);
    play(self, self.speed < 0.4 ? 'idle' : (self.speed > SPEED_WALK * 1.12 ? 'run' : 'walk'));
    // A rig with only a walk clip still needs to look faster when running.
    const a = self.actions[self.current];
    if (a) a.timeScale = self.current === 'idle' ? 1 : clamp(self.speed / SPEED_WALK, 0.55, 1.9);
  } else if (self.procedural) {
    animateProcedural(self, dt);
  }

  // ── Which interior am I in? Drives the office roof fade.
  const wasInside = self.inside;
  self.inside = null;
  for (const r of self.interiors) {
    if (self.pos.x > r.minX && self.pos.x < r.maxX && self.pos.z > r.minZ && self.pos.z < r.maxZ) { self.inside = r.id; break; }
  }
  if (self.inside !== wasInside && self.onEnter) { try { self.onEnter(self.inside, wasInside); } catch (e) {} }

  pickFocus(self);
  updateCamera(self, dt);
}

/* The placeholder's walk cycle. Phase is driven by DISTANCE COVERED, not by
   time, so the legs never scissor while the figure stands still and never
   skate when it speeds up. */
function animateProcedural(self, dt) {
  const r = self.procedural;
  self.phase = (self.phase || 0) + self.speed * dt * 1.5;
  const moving = self.speed > 0.3;
  const amp = moving ? Math.min(1, self.speed / SPEED_WALK) * 0.72 : 0;
  const s = Math.sin(self.phase * 2);
  const c = Math.cos(self.phase * 2);
  r.legL.rotation.x =  s * amp;
  r.legR.rotation.x = -s * amp;
  r.armL.rotation.x = -s * amp * 0.8;
  r.armR.rotation.x =  s * amp * 0.8;
  // A little vertical bob and torso counter-rotation; without them the figure
  // reads as a mannequin being dragged.
  const bob = moving ? Math.abs(c) * 0.045 * amp : 0;
  self.group.position.y = bob;
  if (r.torso) r.torso.rotation.y = -s * amp * 0.11;
  if (!moving) {
    // Ease back to a stand rather than freezing mid-stride.
    for (const k of ['legL', 'legR', 'armL', 'armR']) r[k].rotation.x *= 0.86;
  }
}

/* ⚠ A MOVE THAT ESCAPES A BLOCKER IS ALWAYS ALLOWED.
   This used to be a flat "is the destination inside a footprint?" test, which
   is correct right up until the player is ALREADY inside one — and then every
   direction is inside it too, so every step is refused and the operator is
   stuck forever. Building does exactly that: you stand on the plot to press E,
   and the unit you commission lands on your head.
   eject() below is the belt; this is the braces. Even if a player ends up
   inside geometry by some route nobody predicted, walking away from its centre
   still works, so no state of the world can permanently trap them. */
function blocked(self, x, z) {
  for (const b of self.blockers) {
    const dx = x - b.x, dz = z - b.z;
    const dest2 = dx * dx + dz * dz;
    const r2 = b.r * b.r;
    if (dest2 >= r2) continue;                       // destination is clear of this one
    const cx = self.pos.x - b.x, cz = self.pos.z - b.z;
    const here2 = cx * cx + cz * cz;
    if (here2 < r2 && dest2 > here2) continue;       // already inside, and heading out
    return true;
  }
  return false;
}

/* Shove the player clear of anything they are standing inside. Called whenever
   the world changes, because the world changing is how they get inside
   something in the first place — commissioning a unit on the plot you are
   stood on is the whole point of the build flow.
   Iterates: pushing out of one footprint can put you inside its neighbour, and
   a single pass would leave you in the second one. */
export function eject(self) {
  if (!self) return false;
  let pushed = false;
  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (const b of self.blockers) {
      const dx = self.pos.x - b.x, dz = self.pos.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d >= b.r) continue;
      const out = b.r - d + 0.4;                     // clear it, with a margin
      if (d < 1e-4) {
        // Dead centre, so there is no "away" — pick a direction and commit.
        self.pos.x += out;
      } else {
        self.pos.x += (dx / d) * out;
        self.pos.z += (dz / d) * out;
      }
      moved = pushed = true;
    }
    if (!moved) break;
  }
  if (pushed) {
    self.group.position.copy(self.pos);
    self.vel.set(0, 0, 0);
    self.speed = 0;
  }
  return pushed;
}

/* ── FOCUS ════════════════════════════════════════════════════════════════
   Score = distance, penalised by how far off your facing it is. Two units
   equally close resolve to the one you are actually looking at, which is what
   stops the prompt flickering when you stand between them. */
function pickFocus(self) {
  let best = null, bestScore = Infinity;
  const fx = Math.sin(self.group.rotation.y), fz = Math.cos(self.group.rotation.y);
  for (const it of self.interactables) {
    const dx = it.x - self.pos.x, dz = it.z - self.pos.z;
    const dist = Math.hypot(dx, dz) - (it.r || 0);
    if (dist > REACH) continue;
    const len = Math.hypot(dx, dz) || 1;
    const facing = (dx / len) * fx + (dz / len) * fz;   // 1 = dead ahead
    if (facing < -0.35) continue;                        // behind you: ignore
    const score = Math.max(0, dist) + (1 - facing) * 2.6;
    if (score < bestScore) { bestScore = score; best = it; }
  }
  self.focus = best;
}

export function interact(self) {
  if (!self || !self.enabled || !self.focus) return false;
  const it = self.focus;
  if (self.onInteract) { try { self.onInteract(it); } catch (e) {} }
  if (it.action) { try { it.action(); } catch (e) {} }
  return true;
}

/* ── CAMERA ═══════════════════════════════════════════════════════════════
   Third person, orbiting, with a shorten-on-obstruction rule. It sits high
   enough that the yard still reads as a plant rather than a corridor — the
   original top-down legibility is the thing most worth not losing. */
function updateCamera(self, dt) {
  const cam = self.camera; if (!cam) return;
  // Indoors the camera pulls in and drops, or it sits outside the office wall.
  const wantDist = self.inside ? Math.min(self.camDist, 8.5) : self.camDist;
  const wantPitch = self.inside ? Math.max(0.5, Math.min(self.camPitch, 0.72)) : self.camPitch;

  const cd = Math.cos(wantPitch) * wantDist;
  const cy = Math.sin(wantPitch) * wantDist;
  const target = new T.Vector3(
    self.pos.x - Math.sin(self.camYaw) * cd,
    self.pos.y + EYE + cy,
    self.pos.z - Math.cos(self.camYaw) * cd
  );
  if (target.y < 1.4) target.y = 1.4;   // never go under the slab

  if (!self._camPos) self._camPos = target.clone();
  // Critically damped-ish follow. A hard lock makes the yard feel like it is
  // bolted to the player's head.
  self._camPos.lerp(target, Math.min(1, 9 * dt));
  cam.position.copy(self._camPos);
  cam.lookAt(self.pos.x, self.pos.y + EYE * 0.82, self.pos.z);
}

export function dispose(self) {
  if (!self) return;
  try { if (self._unbind) self._unbind(); } catch (e) {}
  try { if (self.mixer) self.mixer.stopAllAction(); } catch (e) {}
  try { if (self.group.parent) self.group.parent.remove(self.group); } catch (e) {}
  self.interactables = []; self.blockers = []; self.interiors = [];
}
