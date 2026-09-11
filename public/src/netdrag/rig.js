/* ══════════════════════════════════════════════════════════════════════════
   🖱 THE MAP-POINTER ARBITER AND THE ONE CAPTURE-PHASE DRAG RIG.

   WHAT THIS IS. node-city's canvas has three owners already — node-city's own
   click-to-place, OrbitControls, and /src/zoning's paint tool — and this round
   adds a fourth (the road drag). Every one of them wants the same pointerdown.
   This file is the single place that decides who gets it.

   🔴 THE DEFECT THIS GENERALISES, AND IT IS A MEASURED ONE. /src/zoning/ui.js's
   header records it in full: with the Zones panel open (which arms the paint
   tool) the player picked Housing off the build bar and clicked the map. They
   got a green zone square. No house, no toast, no cue — the zone tool's
   capture-phase listener owned the gesture and NOTHING disarmed it. The fix
   shipped there was written 1-vs-1: zoning leaves build mode when it arms, and
   node-city's onModeChange stands zoning down when a building is picked. Two
   tools, two directions, hand-written.

   A THIRD CLAIMANT BREAKS THAT SHAPE. With N tools the pairwise wiring is N²
   and every missing edge is the same silent bug, which the zoning header calls
   "the worst class of UI bug: the player blames themselves". So the wiring
   becomes a registry:

     · ONE armed claimant at a time, city-wide. `arm()` names the winner and
       broadcasts a stand-down to everyone else — so a new tool costs one
       `claim()` call and can never forget an edge.
     · ONE set of document listeners, installed here, dispatching ONLY to the
       armed claimant. Two tools cannot both receive a gesture because there is
       only one dispatcher and it only knows one target.
     · node-city's setMode('place') stands EVERYONE down through `bindMode`,
       which is the 1-vs-1 hook (index.html onModeChange) turned into the
       N-claimant one. It is registered once, by whichever module gets there
       first, and both halves of the exclusion still end in a VISIBLE change —
       each claimant's own `standDown` closes its own panel and says so.

   🖱 WHY document + capture:true (inherited verbatim from /src/zoning/ui.js,
   whose header proved it). node-city AND OrbitControls both bind the CANVAS.
   Listeners on the same element run in registration order, so a canvas
   listener added later runs AFTER the click has already been read as "place a
   building" or "orbit the camera", and stopPropagation() from there is too
   late. A capture-phase listener on `document` runs before anything bound to
   the canvas, so one stopPropagation() is enough to own the gesture. Nothing
   is swallowed unless a claimant is armed AND its own `hot()` says the pointer
   is over the canvas — every UI click passes through untouched.

   🔴 THE SINGLETON LIVES ON `window`, NOT IN MODULE SCOPE, ON PURPOSE.
   node-city imports its modules with a cache-busting query string
   (`?v=` + NC_BUILD) and /src/zoning imports this file without one. Those are
   two different URLs and therefore TWO module instances with two separate
   module-scope `let`s — which would give us two arbiters, each convinced it
   held the only armed tool, i.e. exactly the bug this file exists to close.
   `window.__ncTools` is one object whatever the import specifier said.

   ⚠ NOT A GLOBAL LOOKUP OF ANYTHING ELSE. This file reads `document` and
     `window.__ncTools` and nothing else. `game`, `BUILDINGS`, `mode` and the
     rest are top-level `const` in their host file and invisible here
     (CLAUDE.md, the globals trap) — every claimant is handed what it needs.
   ══════════════════════════════════════════════════════════════════════════ */

const KEY = '__ncTools';

/* Dispatch slots. `up` deliberately also receives pointercancel: a drag that is
   interrupted by the browser (a context switch, a lost pointer capture) must
   end the same way a released one does, or the tool keeps OrbitControls
   disabled forever and the camera silently dies. */
const SLOTS = ['down', 'move', 'up', 'ctx', 'key'];

function build() {
  const claims = new Map();
  let armedId = null;
  let busy = false;       // re-entry guard: a stand-down must not re-arm
  let installed = false;
  let modeBound = false;
  let gestures = 0;       // diagnostics: how many downs this rig has dispatched

  function fire(slot, ev) {
    const t = armedId ? claims.get(armedId) : null;
    if (!t) return;
    const fn = t.handlers[slot];
    if (typeof fn !== 'function') return;
    if (slot === 'down') gestures++;
    try { fn(ev); } catch (e) { console.warn('[tools] ' + t.id + '.' + slot, e); }
  }

  function install() {
    if (installed) return;
    const doc = (typeof document !== 'undefined') ? document : null;
    if (!doc) return;
    installed = true;
    doc.addEventListener('pointerdown', (e) => fire('down', e), true);
    doc.addEventListener('pointermove', (e) => fire('move', e), true);
    doc.addEventListener('pointerup', (e) => fire('up', e), true);
    doc.addEventListener('pointercancel', (e) => fire('up', e), true);
    doc.addEventListener('contextmenu', (e) => fire('ctx', e), true);
    doc.addEventListener('keydown', (e) => fire('key', e), true);
  }

  /* Tell everyone except the winner to put their tool away.
     `prev` — the claimant that WAS armed — additionally gets `cancel()` first,
     because it may be mid-gesture: a half-finished drag holds OrbitControls
     disabled and a preview on screen, and both have to be released before the
     panel closes or the camera never comes back. Non-armed claimants get only
     `standDown`, which each of them guards for itself. */
  function broadcast(exceptId, prev, reason) {
    if (prev && prev !== exceptId) {
      const p = claims.get(prev);
      if (p && typeof p.handlers.cancel === 'function') {
        try { p.handlers.cancel(reason); } catch (e) { console.warn('[tools] ' + prev + '.cancel', e); }
      }
    }
    for (const [id, t] of claims) {
      if (id === exceptId || typeof t.standDown !== 'function') continue;
      try { t.standDown(reason); } catch (e) { console.warn('[tools] ' + id + '.standDown', e); }
    }
  }

  const A = {
    version: 1,

    /* Register a map tool. `standDown(reason)` MUST end in something the player
       can see — a closed panel, a cleared button, a toast naming the tool that
       took the pointer. A silent stand-down is the bug, not the fix. */
    claim(id, opts) {
      opts = opts || {};
      const t = { id, label: opts.label || id, standDown: opts.standDown || null, handlers: {} };
      claims.set(id, t);
      install();
      const tok = {
        id,
        on(handlers) {
          for (const k of SLOTS) if (handlers && typeof handlers[k] === 'function') t.handlers[k] = handlers[k];
          if (handlers && typeof handlers.cancel === 'function') t.handlers.cancel = handlers.cancel;
          install();
          return tok;
        },
        arm() {
          if (armedId === id) return true;
          /* Re-entry: we are already inside a broadcast. Arming from within a
             stand-down is how two tools end up handing the pointer to each
             other forever — the same loop node-city's onModeChange header
             forbids. Refuse, and say so to anyone who checks the return. */
          if (busy) return false;
          const prev = armedId;
          armedId = id;                      // set BEFORE the broadcast, so a
          busy = true;                       // stand-down's own disarm() is a
          try { broadcast(id, prev, { kind: 'tool', id, label: t.label }); }
          finally { busy = false; }
          return true;
        },
        /* Only the CURRENT holder can clear the seat. A claimant that stands
           itself down inside a broadcast (the normal path) would otherwise blank
           the arm the winner just took. */
        disarm() {
          if (armedId !== id) return false;
          if (typeof t.handlers.cancel === 'function') {
            try { t.handlers.cancel(null); } catch (e) { console.warn('[tools] ' + id + '.cancel', e); }
          }
          armedId = null;
          return true;
        },
        armed() { return armedId === id; },
        release() { claims.delete(id); if (armedId === id) armedId = null; },
      };
      return tok;
    },

    armedId: () => armedId,
    armedLabel: () => (armedId && claims.get(armedId) ? claims.get(armedId).label : null),
    list: () => [...claims.keys()],
    gestures: () => gestures,

    /* Everyone puts their tool away. Returns whoever was holding it, so a
       caller can assert the hand-over actually happened rather than photograph
       a panel. */
    standDownAll(reason) {
      const prev = armedId;
      armedId = null;
      broadcast(null, prev, reason || { kind: 'external' });
      return prev;
    },

    /* 🖱 THE OTHER HALF, FOR ALL N CLAIMANTS AT ONCE.
       node-city's onModeChange is a one-way notification fired from inside
       setMode: listeners are told what the mode BECAME and may stand their own
       tool down, but must never call setMode back (index.html's own header:
       "two tools sit in a loop handing the pointer to each other"). We do not —
       standDownAll only calls claimants' standDown, and a claimant's arm path
       is what calls setMode, never this one.
       Registered ONCE, by whichever module mounts first; a second call is a
       no-op and returns true so the caller need not care about order. */
    bindMode(onMode, BUILDINGS) {
      if (modeBound) return true;
      if (typeof onMode !== 'function') return false;
      modeBound = true;
      onMode((m, type) => {
        if (m !== 'place' || !armedId) return;
        let name = null;
        try { name = (BUILDINGS && BUILDINGS[type] && BUILDINGS[type].name) || null; } catch (e) { name = null; }
        A.standDownAll({ kind: 'place', type: type || null, name });
      });
      return true;
    },
    modeBound: () => modeBound,
  };
  return A;
}

/* The one accessor. Idempotent, safe to call from any module at any time, and
   it never throws — a tool that cannot find a window still gets an object whose
   claim() works and simply never fires (which is what a headless parse of this
   file should see). */
export function tools() {
  const W = (typeof window !== 'undefined') ? window : null;
  if (!W) return build();
  if (!W[KEY]) W[KEY] = build();
  return W[KEY];
}
