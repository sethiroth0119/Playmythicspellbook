/* ═══════════════════════════════════════════════════════════════════════════
   ROUND 1 — IDLE CADENCE (the part of this round that cannot be CSS)
   Loads after index.html. Additive only: it defines nothing the app already
   defines, edits no app source, and is a no-op if the globals it wraps are
   missing.

   WHY THIS FILE EXISTS AT ALL
   Frame timing and frame COUNT live in JS. The idle index is
       Math.floor(_bsNow / frameMs + phase) % frames.length     (index ~97995)
   and neither the rate nor the number of frames is reachable from CSS. The
   companion `r1_idle.css` owns everything that CAN be expressed in CSS; this
   file owns the two things that cannot:

     A. Frame-count-aware idle cadence floor — §1
     B. Telling CSS whether a streaming board sprite is actually animated — §2
        (this is the load-bearing one — see below)

   ───────────────────────────────────────────────────────────────────────────
   WHAT THE REAL LIBRARY LOOKS LIKE  (public-catalog/sprites-0.json, 297 sets
   with idle frames — measured, not assumed)

       72 sets   1 idle frame     ← 24%: no idle of their own
        1 set    5 frames
      190 sets  25 frames         ← 64%: 1550ms cycle at 62ms/frame
       28 sets  64 frames         ← 3968ms cycle
        6 sets  26/35/36/49 frames

   That distribution corrected the assumption this file started from. The
   strobe case — a 2–4 frame idle flickering 4–8 times a second at 62ms — is
   real in principle but occurs in ONE published set today. And the single
   biggest group, 25 frames, is exactly one second of 25fps video, which
   suggests those reels were authored to run in 1.0s and are being played in
   1.55s. Re-timing them is a change to how every sprite in the game moves,
   with a real decode cost on the streaming path (`src` swap + one-frame
   pre-decode per tick, dozens of sprites). This file does NOT make that call.
   It only enforces a floor.

   ───────────────────────────────────────────────────────────────────────────
   A. THE CADENCE FLOOR
   `DEFAULT_SPRITE_FRAME_MS = 62` (~16fps) is a per-FRAME constant, so the
   loop length is whatever the frame count makes it:

       2 frames →  124ms  (8 alternations/sec — a buzz, not an idle)
       3 frames →  186ms
       4 frames →  248ms  (4 loops/sec — hyperventilating)
      25 frames → 1550ms  (fine)

   16fps is a fine PLAYBACK rate for hand-drawn art. It is the wrong way to
   choose a LOOP LENGTH. A finished 2D game's idle cycles roughly once a
   second no matter how many drawings are in it: few frames → hold each one
   longer. So: stretch short cycles, never shorten long ones.

   THE POLICY: target a ~720ms idle cycle, clamped so the per-frame hold never
   goes below the 62ms default (never speeds anything up) and never above
   200ms (never turns a flicker effect into a slideshow).

       frameMs = clamp(round(720 / n), 62, 200)
        n=2 → 200 (400ms cycle)   n=6 → 120 (720ms)
        n=3 → 200 (600ms)         n=8 →  90 (720ms)
        n=4 → 180 (720ms)         n=10→  72 (720ms)
        n=5 → 144 (720ms)         n≥12→  62 → unchanged, policy stands down

   WHAT IT WILL NOT TOUCH
   • Any animation the artist set a speed for in the Sprite Atelier. The
     original `getSpriteAnimFps` is asked first and its answer always wins.
   • Anything that is not `idle`. attack / hurt / death / summon are one-shot
     beats whose durations are computed from their fps at several call sites
     (index ~98518, ~101077, ~129071); re-timing them would desync those.
   • Kalon (`k_`) sprites. The stack ticker gives them a deliberately slower
     150ms default (index ~106389) and that choice is left alone.
   • Sprite frame DATA. Nothing here reorders, reverses, ping-pongs or drops a
     frame. A cycle whose last drawing does not lead back to its first is an
     art fact; guessing at it (auto ping-pong) would silently reverse sets
     that really are cycles — a spinning orb would visibly rock instead of
     turning. What CAN be done about the seam is done elsewhere: both tickers
     already pre-decode the wrap frame, and `r1_idle.css` removes the second
     rhythm that made the wrap findable.
   • Anything with 12+ frames — which is 224 of the 225 multi-frame sets
     published today. On the current library this wrapper changes exactly one
     sprite. It is a floor, not a re-timing.

   KNOWN SIDE EFFECT (accepted, and it is honest): the Sprite Atelier reads
   the same function to label its preview ("Animating 4 idle frames at ~N
   fps") and to position its speed slider. For a set the floor applies to,
   both now show the rate the board actually plays instead of a nominal 16.
   Nothing is written to `Forge.sprites.__speed` — the value stays "unset" in
   storage, Reset still works, and saving still only happens on a real slider
   change.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var TARGET_CYCLE_MS = 720;   // what a finished idle loop should take
  var MIN_FRAME_MS    = 62;    // == DEFAULT_SPRITE_FRAME_MS; never go faster
  var MAX_FRAME_MS    = 200;   // never hold a frame longer than this
  var COUNT_TTL_MS    = 1500;  // frame-count cache lifetime (see §1)
  var SCAN_MS         = 500;   // DOM stamp interval (see §2)

  var W = (typeof window !== 'undefined') ? window : null;
  if (!W) return;

  /* ---------------------------------------------------------------------
     §1  CADENCE — wrap getSpriteAnimFps

     The wrapper runs on the ticker's hot path (once per sprite per tick,
     ~30Hz × dozens of units), so it must not do real work. getSpriteFrames
     allocates a filtered array and touches the art LRU on every call, so the
     frame COUNT is cached per sprite id with a short TTL. That bounds the
     extra cost to about one lookup per sprite per 1.5s, and the TTL is what
     lets a sprite whose frames are still streaming in pick up its real
     cadence once they land.
     ------------------------------------------------------------------ */
  var countCache = Object.create(null);

  function idleFrameCount(sid) {
    var now = (W.performance && W.performance.now) ? W.performance.now() : Date.now();
    var hit = countCache[sid];
    if (hit && (now - hit.t) < COUNT_TTL_MS) return hit.n;
    var n = 0;
    try {
      if (typeof W.getSpriteFrames === 'function') {
        var f = W.getSpriteFrames(sid, 'idle');
        n = (f && f.length) ? f.length : 0;
      }
    } catch (e) { n = 0; }
    countCache[sid] = { n: n, t: now };
    return n;
  }

  // The cadence policy itself. Returns a per-frame ms hold, or 0 to mean
  // "leave the engine default alone".
  function idleFrameMs(n) {
    if (!(n > 1)) return 0;
    var ms = Math.round(TARGET_CYCLE_MS / n);
    if (ms > MAX_FRAME_MS) ms = MAX_FRAME_MS;
    if (ms <= MIN_FRAME_MS) return 0;   // default already right → stay "unset"
    return ms;
  }
  try { W.__idleFrameMsPolicy = idleFrameMs; } catch (e) {}

  function wrapFps() {
    var orig = W.getSpriteAnimFps;
    if (typeof orig !== 'function') return false;
    if (orig.__r1IdleCadence) return true;          // already wrapped

    function wrapped(spriteId, anim) {
      var set = null;
      try { set = orig.apply(this, arguments); } catch (e) { set = null; }
      if (set != null) return set;                  // artist's choice always wins
      if (anim !== 'idle') return set;              // one-shots keep their timing
      if (!spriteId || String(spriteId).indexOf('k_') === 0) return set;   // Kalon
      var ms = idleFrameMs(idleFrameCount(spriteId));
      if (!ms) return set;
      return 1000 / ms;                             // round-trips exactly: 1000/fps === ms
    }
    wrapped.__r1IdleCadence = true;
    wrapped.__orig = orig;
    try { W.getSpriteAnimFps = wrapped; } catch (e) { return false; }
    return true;
  }

  /* ---------------------------------------------------------------------
     §2  STAMPS — give CSS the two facts it cannot see

     (a) `data-bsn="1"` on a streaming board sprite whose set resolves to a
         single frame. r1_idle.css §3 keeps the 1px breath for those and
         removes it from everything the ticker is actually cycling. Without
         this stamp the CSS assumes "animated", which is the safe default.

     (b) `data-sprite-frame-ms` on already-rendered eager stacks. That
         attribute is baked at render time from `_spriteCustomFrameMs`
         (index ~98351), so stacks that were painted before this file loaded
         would keep the old cadence until the next board rebuild. Stamping
         them applies §1 immediately. Only ever ADDS the attribute — an
         artist-set value, or the Atelier's live slider preview, is never
         overwritten.

     A 500ms interval, not a MutationObserver: renderBattle replaces the
     whole board on every action, so an observer would fire a large record
     list per action for work that is not urgent. Two attribute-filtered
     selector queries twice a second cost nothing and return empty outside
     battle. No layout is read — no getBoundingClientRect, no offsetWidth —
     so this cannot force a reflow.
     ------------------------------------------------------------------ */
  function scan() {
    try {
      var imgs = document.querySelectorAll('img.bsprite[data-bsid]:not([data-bsn])');
      for (var i = 0; i < imgs.length; i++) {
        var el = imgs[i];
        var n = idleFrameCount(el.dataset.bsid);
        // n === 0 means the frames have not streamed in yet — leave it
        // unstamped and re-check on the next pass.
        if (n > 0) el.dataset.bsn = (n === 1) ? '1' : String(n);
      }
    } catch (e) {}
    try {
      var stacks = document.querySelectorAll(
        '.unit .unit-icon .sprite-stack[data-sprite-id]:not([data-sprite-frame-ms])');
      for (var j = 0; j < stacks.length; j++) {
        var st = stacks[j];
        var id = st.dataset.spriteId;
        if (!id || String(id).indexOf('k_') === 0) continue;
        if ((st.dataset.spriteAnim || 'idle') !== 'idle') continue;
        if (st.dataset.spriteOneshot === '1') continue;
        // Count the frames actually in this stack's DOM — that is what the
        // ticker will cycle for it, regardless of what has streamed in since.
        var n2 = st.querySelectorAll(':scope > .sprite-frame').length || 0;
        var ms = idleFrameMs(n2);
        if (ms) st.dataset.spriteFrameMs = String(ms);
      }
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------
     §3  BOOT — this file may be spliced in before index.html has finished
     defining its globals, so retry briefly instead of failing silently.
     ------------------------------------------------------------------ */
  var tries = 0;
  (function boot() {
    var ok = wrapFps();
    if (!ok && ++tries < 60) { setTimeout(boot, 250); return; }   // ~15s
    try { setInterval(scan, SCAN_MS); } catch (e) {}
    scan();
  })();
})();
