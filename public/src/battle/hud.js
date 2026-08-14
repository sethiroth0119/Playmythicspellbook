/* ============================================================================
   src/battle/hud.js — BATTLE HUD RELAYOUT            (piece: battle-hud)

   Companion to src/battle/hud.css. This file owns ONLY the moves that cannot
   be expressed in CSS: hoisting the two hero cards into a top-centre band,
   splitting the opponent's piles out of the right rail into a left-edge
   cluster, and putting END TURN in the bottom-right corner.

   ── WHY A MUTATION OBSERVER, AND NOT A ONE-SHOT DOM EDIT ──────────────────
   `renderBattle()` does a full `root.innerHTML = …` rebuild of #app on EVERY
   state change (index.html ~134185). A one-shot edit is wiped by the next
   card play. So this re-runs after every battle render, rAF-coalesced and
   keyed: the whole screen element is new after a rebuild, so a flag set on it
   is a perfect "already laid out" key and a no-op render costs one
   querySelector plus one property read.

   ── MOVE NODES, NEVER CLONE THEM ──────────────────────────────────────────
   `bindBattleEvents()` / `bindBattlePiles()` / `bindPhaseBar()` attach their
   listeners to the freshly rendered nodes BEFORE this runs, and a pile of code
   addresses elements by id it is not allowed to lose: #btn-end-turn,
   #turn-timer, #energyVal, #energyFill, #energyMax, #btn-concede,
   #btn-battle-prefs, #btn-open-battle-log, #bsxLog, #btn-bc-bag, #fighters,
   #foeDeck, #foeGrave, #graveyard, #yourDeck, #playerName, #rankBadge,
   #phase-bar. Every operation below is `appendChild` / `insertBefore` on the
   LIVE element, which preserves both. Nothing is re-emitted from a string, so
   no unit label and no face-down card can leak through this file.

   ── THINGS THIS FILE MUST NEVER TOUCH (each fails silently) ───────────────
   • `.board-area`, `.bb-catch`, `#bb-stage-host`, `.bb-stage`, `.wx-canvas`.
     Every board click travels .bb-catch -> postMessage -> the stage's
     pickTile() -> back, `_bbStageTrack()` sizes the stage to `.board-area`'s
     rect, and `.bb-catch` is re-created by every render. grep this file: none
     of them is selected, moved or styled.
   • `.hand-strip` — fit.js measures it and writes --hand-clear, which is the
     board's height reservation.
   • `.cbx-float` — positioned from --bpw, patched in place every tick by
     _cbxRender()'s string diff. Never re-parented here.

   ── FAIL TO THE UNTOUCHED LAYOUT ──────────────────────────────────────────
   `renderBattle()` is wrapped in a crash guard that keeps the LAST GOOD FRAME,
   so an exception thrown near it produces a silently frozen board rather than
   an error anyone sees. Everything below is inside try/catch: if any step
   throws, the screen is left in whatever state it reached and the next render
   starts clean — the game is still fully playable on the original layout.
   ========================================================================== */

const SVG_VANISH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' +
  '<path d="M12 3l4.6 9L12 21l-4.6-9z"/><path d="M4 8.5c2.6 1.6 13.4 1.6 16 0" opacity=".65"/></svg>';

let queued = false;
let reported = false;

/* Never let a styling module take the battle down with it. One warning, then
   silence — a per-render console flood would be its own bug. */
function guard(fn) {
  try { fn(); } catch (e) {
    window.__hudxErr = String((e && e.message) || e);
    if (!reported) { reported = true; try { console.warn('[hud.js] relayout skipped:', e); } catch (_) {} }
  }
}

/* ── THE GLOBALS TRAP ──────────────────────────────────────────────────────
   `App` is a top-level `const` in index.html, which is a global LEXICAL
   binding — it is NOT on `window`, so an ES module cannot see it. (CLAUDE.md
   records that this has already cost real time twice.) index.html cannot be
   edited by this piece, so instead of reaching for a bare global we install a
   one-line CLASSIC script, which does run in that scope, and read the Void
   pile through it. If anything about this fails the vanish slot renders its
   honest empty state rather than a made-up number. */
/* ── THE HOVER-MENU "STICK", AND THE FIX THAT WAS MEASURED AND REJECTED ────
   Wave 3 asked for "hover menu and character box stick on the previous unit for
   2 of 8 units on a clean sweep with the pointer parked off-board between".
   That was chased here, and the finding is recorded so it is not chased again.

   THE MEASUREMENT (real Playwright pointer, all 8 live units, pointer parked at
   (18,460) off the board for 700ms between each):
     · App._bbHover.unitId retargets correctly 8/8 — never the previous unit;
     · the hover menu opens on the hovered unit 8/8 and carries `class="show"`
       with the right `_uhmUnitId`, so 0/8 stick;
     · on every park the menu goes to `uhm-closing` — it IS being dismissed;
     · the CHARACTER BOX does stay up after the pointer leaves, and that is
       DESIGNED: `_cbxArmHide()` gives it a 10-SECOND auto-dismiss
       (`CBX_HIDE_MS = 10000`) precisely so you can read it, and its subject is
       correct on all 8 units. It is not stuck, it is still counting down.

   THE THEORY THAT LOOKED RIGHT AND IS WRONG: `_bbSoftHideHoverMenu()` early-outs
   on `_bbMenuHovered()`, which tests `_BBS._ptr` — written only by the catcher's
   own handlers, so it is STALE the moment the pointer leaves the board. A
   document-level mousemove that keeps `_BBS._ptr` honest was written, injected
   through this same classic-script seam, and then measured: with the menu open
   on Orc Warrior the menu rect is [641,393,272,61] and the last on-board pointer
   is (661,645) — 191px below it, nowhere near BB_MENU_HALO (28). `_bbMenuHovered()`
   returns FALSE with the stale pointer and FALSE with the live one. The halo
   never suppresses this hide, so the listener bought nothing and cost a handler
   on every mouse move across the whole app. It was removed.

   What DID measure as broken on every render is the click catcher — see
   rearmCatcher() below. */
function installStateBridge() {
  if (window.__hudxVoid) return;
  try {
    const s = document.createElement('script');
    s.textContent =
      'window.__hudxVoid=function(){try{return{player:((App.state.player.void)||[]).length,' +
      'ai:((App.state.ai.void)||[]).length};}catch(e){return null;}};' +
      /* `App.state.gameOver` is the ONLY thing that distinguishes "the rail is
         missing because the match ended" from "the rail is missing because the
         state is half-built". The freeze below is gated on it, so it needs the
         same lexical-scope seam. Returns null — never false — when it cannot
         read the state, so the caller can fall back to the DOM marker. */
      'window.__hudxOver=function(){try{return !!App.state.gameOver;}catch(e){return null;}};';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) { /* CSP or no head — the empty state is the fallback */ }
}

function mk(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

/* Wrap a `.cardslot`'s label + stack into one grid cell of the 2x2 pile grid.
   `_slabel()` emits the label as the stack's immediately preceding sibling, so
   that is where it is picked up from. Both are MOVED, never rebuilt. */
function cellFor(slot) {
  if (!slot) return null;
  const stack = slot.closest('.stack');
  if (!stack) return null;
  const cell = mk('div', 'hudx-cell');
  const prev = stack.previousElementSibling;
  if (prev && prev.classList.contains('slabel')) cell.appendChild(prev);
  cell.appendChild(stack);
  return cell;
}

/* The vanish / Void pile. This is genuinely new UI — the game has a `void`
   array per side (banish, vanishGrave*, hand-banish and Void-cost effects all
   push to it) but has never had a pile for it anywhere in the battle HUD. */
function vanishCell(side) {
  const v = (typeof window.__hudxVoid === 'function') ? window.__hudxVoid() : null;
  const n = v && typeof v[side] === 'number' ? v[side] : null;
  const cell = mk('div', 'hudx-cell hudx-vanish');
  cell.appendChild(mk('div', 'slabel', SVG_VANISH + 'VANISH'));
  const stack = mk('div', 'stack');
  const slot = mk('div', 'cardslot empty hudx-voidslot');
  slot.title = (side === 'ai' ? "Opponent's" : 'Your') + ' Vanish pile — cards banished out of play to the Void';
  slot.appendChild(mk('span', 'hudx-voidface'));
  slot.appendChild(mk('span', 'count grey', '<i>' + (n == null ? '—' : n) + '</i>'));
  stack.appendChild(slot);
  cell.appendChild(stack);
  return cell;
}

/* The opponent has no energy readout anywhere in the UI today — only the orbs
   inside their fighter card, whose art (assets/hud/energy-orb.png) does not
   exist in the repo. Build the same component the player already has, from the
   numbers the fighter card is already showing ("4 / 4"), so the two clusters
   are identical and neither invents a value. */
function foeEnergy(foeFighter) {
  let en = 0, max = 0;
  try {
    const t = foeFighter && foeFighter.querySelector('.estrip .num');
    const m = t && /(-?\d+)\s*\/\s*(-?\d+)/.exec(t.textContent || '');
    if (m) { en = Math.max(0, +m[1]); max = Math.max(0, +m[2]); }
  } catch (e) { /* fall through to 0 / 0 */ }
  const total = Math.max(1, Math.min(14, max));
  let pips = '';
  for (let i = 0; i < total; i++) pips += '<span class="pip' + (i < en ? ' on' : '') + '"></span>';
  return mk('div', 'energy hudx-foe-energy',
    '<div class="epips"><span class="eorb">' + en + '</span>' +
    '<span class="ebar">' + pips + '</span>' +
    '<span class="emax">/ ' + max + '</span></div>');
}

/* An empty `.bsx` shell: frame + corner braces + scaled body, exactly the
   structure _bpFit()/the mockup use, so every existing `.bsx …` rule applies
   to the opponent's cluster without being re-authored. Ids are deliberately
   NOT copied (#bsxBody / #bsxInner stay unique to the player's rail). */
function clusterShell(side) {
  const root = mk('aside', 'hudx-cluster bsx');
  root.setAttribute('data-hudx-side', side);
  const frame = mk('div', 'bsx-frame',
    '<span class="brace tl"></span><span class="brace tr"></span>' +
    '<span class="brace bl"></span><span class="brace br"></span>' +
    '<span class="hudx-dia t"></span><span class="hudx-dia b"></span>');
  const body = mk('div', 'bsx-body');
  const inner = mk('div', 'bsx-inner');
  body.appendChild(inner);
  frame.appendChild(body);
  root.appendChild(frame);
  return { root: root, frame: frame, inner: inner };
}

/* The opponent's cluster is height:auto and shares `.battle-left` with the rest
   of the rail chrome, which _bcpFit() then fits into whatever is left. On a
   short window the cluster alone can outgrow its share, so clamp it with the
   same `--fit` mechanism `.bsx-inner` already uses. hud.css caps the scale at
   1 in both directions of use, so this can only ever shrink. */
function fitCluster(root, host) {
  try {
    const inner = root.querySelector('.bsx-inner');
    if (!inner || !host) return;
    const budget = Math.max(180, host.clientHeight * 0.6);
    const need = root.scrollHeight;
    if (need > budget) inner.style.setProperty('--fit', Math.max(0.55, budget / need).toFixed(3));
    else inner.style.removeProperty('--fit');
  } catch (e) {}
}

/* ══ THE GAME-OVER FRAME: FREEZE THE LAST TRUE RAIL, NEVER INVENT ONE ══════
   `renderBattlePiles()` opens with

       if (!s || !s.player || !s.ai || s.gameOver) return '';      // ~134697

   so the moment a match ends the game DELETES the pile markup: no `.bp-wrap`,
   no #foeDeck, no #graveyard, no `.opp`, no `.energy`. Both clusters are built
   by MOVING those nodes, so with nothing to move `.bp-wrap.bsx` and
   `.hudx-cluster[data-hudx-side="foe"]` went null and half the new HUD vanished
   on the last screen of the game. index.html is not this piece's to edit, so
   the source markup cannot be brought back.

   ⚠ WHAT WAS REJECTED, AND WHY THIS IS NOT THAT. Re-deriving a rail from
   `App.state` at game over would mean this file MAKING UP pile counts for a
   finished match — the one thing the brief forbids. What is kept instead is the
   LAST FRAME THAT WAS TRUE: every successful relayout serialises the two
   clusters exactly as the game rendered them, and the game-over screen re-mounts
   those bytes. Every number on it was produced by index.html, one render ago,
   from real state. Nothing is computed here.

   ⚠ AND IT IS MOUNTED DEAD. The restored nodes are `inert` + `aria-hidden` +
   `pointer-events:none` (hud.css `.hudx-frozen`), and every `id` is stripped to
   `data-hudx-was-id` so no live code can address, re-bind or write into a
   frozen deck — `bindBattlePiles()` has already run and found nothing by the
   time these mount, and they must never look like a control on a screen whose
   controls are gone. The command bar is dropped from the copy for the same
   reason: CONCEDE is still LIVE in the left rail on this screen, and a second
   dead one would be a trap.

   The freeze is scoped to the finished match by `App.state.gameOver` (with the
   `.gameover-backdrop` node as the DOM fallback), so a mid-match render that
   somehow lost its rail still gets today's honest empty column. */
const FROZEN = { rail: null, foe: null };

function snapshot(bp, foeRoot) {
  try {
    if (bp) FROZEN.rail = bp.outerHTML;
    if (foeRoot) FROZEN.foe = foeRoot.outerHTML;
  } catch (e) { /* a failed snapshot just means the previous one is kept */ }
}

function matchIsOver(scr) {
  try {
    if (typeof window.__hudxOver === 'function') {
      const v = window.__hudxOver();
      if (v === true) return true;
      if (v === false) return false;      // null = could not read; fall through
    }
  } catch (e) {}
  return !!(scr && (scr.querySelector('.gameover-backdrop') ||
                    document.querySelector('.gameover-backdrop')));
}

/* Rebuild one cached cluster as an inert frozen frame. */
function thaw(html, tag) {
  const box = document.createElement('div');
  box.innerHTML = html;
  const n = box.firstElementChild;
  if (!n) return null;
  n.classList.add('hudx-frozen');
  n.setAttribute('data-hudx-frozen', tag);
  n.setAttribute('aria-hidden', 'true');
  try { n.inert = true; } catch (e) { /* older engines: the CSS still kills it */ }
  // Ids first — a duplicate id is how a frozen copy would start stealing
  // getElementById() from something live.
  if (n.id) { n.setAttribute('data-hudx-was-id', n.id); n.removeAttribute('id'); }
  n.querySelectorAll('[id]').forEach((el) => {
    el.setAttribute('data-hudx-was-id', el.id);
    el.removeAttribute('id');
  });
  // CONCEDE / prefs / the turn plaque are still live in the left rail here.
  n.querySelectorAll('.hudx-cmd').forEach((el) => el.remove());
  // Inline handlers survive innerHTML; strip them so an inert frame is inert
  // even if a browser ignores `inert` and something forwards a synthetic event.
  n.querySelectorAll('[onclick],[oncontextmenu],[onmousedown]').forEach((el) => {
    el.removeAttribute('onclick'); el.removeAttribute('oncontextmenu'); el.removeAttribute('onmousedown');
  });
  return n;
}

/* `.bsx-inner` is scaled by --fit, which _bpFit() writes on a later frame from
   a measurement. The snapshot is taken before that write, so the restored rail
   starts at --fit:1 and can overflow `.bsx-body` (overflow:hidden). Measure it
   once here, the same way _bpFit does, so the frozen frame is never clipped.
   _bpFit() still finds it afterwards (it selects `.bp-wrap` by class) and will
   refine the number on its own ticker. */
function fitFrozenRail(n) {
  try {
    const body = n.querySelector('.bsx-body');
    const inner = n.querySelector('.bsx-inner');
    if (!body || !inner) return;
    const avail = body.clientHeight, need = inner.scrollHeight;
    if (avail && need && need > avail) {
      inner.style.setProperty('--fit', Math.max(0.55, avail / need).toFixed(3));
    }
  } catch (e) {}
}

function restoreFrozen(scr, left) {
  if (!FROZEN.rail && !FROZEN.foe) return;      // never saw a live rail
  if (!matchIsOver(scr)) return;
  if (FROZEN.rail && !scr.querySelector('.bp-wrap')) {
    const n = thaw(FROZEN.rail, 'rail');
    if (n) { scr.appendChild(n); fitFrozenRail(n); }
  }
  if (FROZEN.foe && left && !left.querySelector('.hudx-cluster[data-hudx-side="foe"]')) {
    const n = thaw(FROZEN.foe, 'foe');
    if (n) { left.insertBefore(n, left.firstChild); fitCluster(n, left); }
  }
}

/* ── THE BOARD IS UNCLICKABLE FOR ~60ms AFTER EVERY renderBattle() ──────────
   `.bb-catch` is a child of `.board-area`, and `renderBattle()` rebuilds the
   whole screen with `innerHTML =`, so the catcher is destroyed on every state
   change. index.html re-creates it in `_bbStageCatcher()`, which is only
   reached from `_bbStageMount()` — and that runs off the app's rAF ticker, so
   for one to four frames after every card play there is NOTHING listening on
   the battlefield. Measured: `document.querySelector('.bb-catch')` is null the
   instant `renderBattleNow()` returns.

   The fix is not to re-implement the catcher — that would duplicate the pointer
   normalisation and the hover-halo state, and get them wrong. `_bbStageCatcher`
   and `_bbStageTrack` are plain top-level FUNCTION DECLARATIONS in a classic
   script, which (unlike the `const` globals in CLAUDE.md's globals trap) DO
   land on `window`. So this calls index.html's own re-arm, from inside the
   MutationObserver callback, i.e. after renderBattle's synchronous body and
   BEFORE the browser paints. `_bbStageCatcher` early-outs when a catcher is
   already there, so on any render that did not destroy it this costs one
   `querySelector`.
   Everything is typeof-guarded: if either function ever stops being global the
   catcher is simply left to the rAF ticker, which is today's behaviour. */
function rearmCatcher() {
  try {
    const area = document.querySelector('.board-area');
    if (!area) return;
    if (typeof window._bbStageCatcher === 'function') window._bbStageCatcher(area);
    if (typeof window._bbStageTrack === 'function') window._bbStageTrack(area);
  } catch (e) { /* the ticker will get there a few frames later */ }
}

function relayout() {
  const scr = document.querySelector('.battle-screen');
  if (!scr) return;
  rearmCatcher();                    // before the early-out: every render kills it
  if (scr.__hudx) return;            // already laid out — the cheap early-out
  scr.__hudx = 1;

  const left = scr.querySelector('.battle-left');
  const bp = scr.querySelector('.bp-wrap');
  const fighters = scr.querySelector('#fighters');
  /* ⚠ THE GAME-OVER SCREEN IS A DIFFERENT SCREEN, AND THE PILE RAIL IS NOT
     MISSING BY ACCIDENT — THE GAME DELETES IT ON PURPOSE (renderBattlePiles
     early-returns '' on `s.gameOver`, ~134697). Both clusters are built by
     MOVING those nodes, so with nothing to move `.bp-wrap.bsx` and
     `.hudx-cluster[data-hudx-side="foe"]` used to go null and half the new HUD
     disappeared on the last screen of the match. `restoreFrozen()` re-mounts the
     LAST TRUE frame instead — see the long note above it for why that is not the
     same thing as inventing a rail. `hudx-norail` still flags the screen (the
     right column stays reserved either way) so hud.css can tell a frozen rail
     from a live one.

     Everything that still exists keeps its new home regardless. Measured with
     `App.state.gameOver` forced and one frame allowed to settle: `.hudx-topband`
     [0,0,1600,118], #fighters [437,4,726,92], #phase-bar [460,86,681,32],
     `.hudx-endturn` [1264,880,336,104], #btn-end-turn [1264,897,336,71], the
     command bar still bound in `.bc-rail`, and `window.__hudxErr` null. Every
     section below is independently guarded: one missing element must never take
     the band, the rail or END TURN down with it. */
  if (!bp) { scr.classList.add('hudx-norail'); restoreFrozen(scr, left); }

  /* ── 1. TOP BAND: the two hero banners, then the phase track ─────────── */
  const band = mk('div', 'hudx-topband');
  const banners = mk('div', 'hudx-banners');
  const phaseRow = mk('div', 'hudx-phaserow');
  band.appendChild(banners);
  band.appendChild(phaseRow);

  if (fighters) {
    fighters.classList.add('hudx-fighters');
    banners.appendChild(fighters);                       // MOVE, ids intact
    // hex-cut the portraits: the clip needs its own box so the gold rim can sit
    // outside the image, so each portrait gains a wrapper (its own node and
    // every listener on it are untouched — only its parent changes).
    fighters.querySelectorAll('.fighter > .portrait').forEach((p) => {
      if (p.parentElement && p.parentElement.classList.contains('hudx-hex')) return;
      const hex = mk('span', 'hudx-hex');
      p.parentElement.insertBefore(hex, p);
      hex.appendChild(p);
    });
  }
  // The phase track is chrome, not board furniture; hoisting it out of
  // `.battle-center` keeps it clear of the banners AND gives the board column
  // its height back. It is still never a child of `.board-area` — putting it
  // there is what once shifted the DOM board out from under the stage.
  const phz = scr.querySelector('#phase-bar');
  if (phz) phaseRow.appendChild(phz);
  if (banners.childElementCount || phaseRow.childElementCount) scr.appendChild(band);

  /* ── 2. LEFT CLUSTER: the opponent's energy / deck / grave / realm /
        vanish, split out of the right rail where they live today ───────── */
  if (left && bp) {
    const L = clusterShell('foe');
    left.insertBefore(L.root, left.firstChild);

    const opp = bp.querySelector('.opp');                // foe name + CPU/rank
    if (opp) { opp.classList.add('hudx-head'); L.inner.appendChild(opp); }

    const piles = mk('div', 'hudx-piles');
    L.inner.appendChild(piles);
    // The foe's realm slot is the only `.cardslot` in the rail with neither an
    // id nor a data-bp-realm hook — `_realmSlot(n, open=false, 'ai')` renders
    // it closed, so it has no click target to identify it by.
    const foeRealm = bp.querySelector('.bsx-inner .stack .cardslot:not([id]):not([data-bp-realm])');
    [bp.querySelector('#foeDeck'), bp.querySelector('#foeGrave'), foeRealm].forEach((slot) => {
      const c = cellFor(slot);
      if (c) piles.appendChild(c);
    });
    piles.appendChild(vanishCell('ai'));

    /* ⚠ THE TWO IDENTICAL "KALON SOURCE x3" CHIPS ARE NOT A DUPLICATE — THEY
       ARE TWO SIDES' COUNTERS STACKED IN ONE RAIL. index.html renders
       `<div class="buffs">${_buff(s.ai.kalonsRemaining)}${_buff(s.player
       .kalonsRemaining)}</div>` (~134932): the FIRST is the opponent's, the
       SECOND is yours, and because the label is the same string on both they
       read as the same chip printed twice. Splitting them by side is the whole
       fix — one per cluster, under that side's own name plate, and it is also
       the last piece of the opponent-parity brief. The `.buffs` box is MOVED
       when only one chip is left over so `_buff`'s click binding and its
       `title` survive; a second box is built for the foe only when both
       exist. */
    const buffs = bp.querySelector('#buffs, .buffs');
    if (buffs) {
      const chips = Array.from(buffs.querySelectorAll(':scope > .buff'));
      if (chips.length > 1) {
        const foeBuffs = mk('div', 'buffs hudx-buffs');
        foeBuffs.appendChild(chips[0]);           // MOVE — id-less, listener intact
        L.inner.appendChild(foeBuffs);
      }
      buffs.classList.add('hudx-buffs');
    }

    L.frame.appendChild(foeEnergy(fighters && fighters.querySelector('.fighter[data-side="foe"]')));

    /* ── 3. RIGHT CLUSTER: the player's identical cluster, re-grouped in
          place so `_bpFit()` keeps measuring the same `.bsx-body`. ─────── */
    const inner = bp.querySelector('.bsx-inner');
    const energy = bp.querySelector('.energy');
    if (inner) {
      // Head plate: the player's name + rank already live in `.energy > .top`.
      // Move that row up to mirror the foe's `.opp` head, leaving `.energy`
      // holding just the pips — the same shape on both sides.
      const top = energy && energy.querySelector('.top');
      if (top) { top.classList.add('opp', 'hudx-head'); inner.insertBefore(top, inner.firstChild); }

      const myPiles = mk('div', 'hudx-piles');
      if (top && top.nextSibling) inner.insertBefore(myPiles, top.nextSibling);
      else inner.insertBefore(myPiles, inner.firstChild);

      [bp.querySelector('#yourDeck'), bp.querySelector('#graveyard'),
       bp.querySelector('[data-bp-realm="player"]')].forEach((slot) => {
        const c = cellFor(slot);
        if (c) myPiles.appendChild(c);
      });
      myPiles.appendChild(vanishCell('player'));

      // Re-order what is left so the rail reads head · piles · rule · buffs ·
      // tools · tunneled, and drop the now-orphaned separators (`.rule` is a
      // 1px line with a diamond — decoration, not a control).
      const rules = Array.from(inner.querySelectorAll(':scope > .rule'));
      const keep = rules.shift();
      rules.forEach((r) => r.remove());
      [keep,
       inner.querySelector(':scope > .buffs'),
       inner.querySelector(':scope > .tools'),
       inner.querySelector(':scope > .kv'),
       inner.querySelector(':scope > .tunchips')].forEach((n) => { if (n) inner.appendChild(n); });

      // Concede / turn plaque / turn timer / settings move to the FOOT of the
      // player's own cluster — the left edge belongs to the opponent now. The
      // `bchrome bcp` wrapper is what keeps every existing `.bcp .topbar …`
      // rule (and its !important compression passes) applying to them.
      const topbar = scr.querySelector('.bcp .topbar');
      if (topbar) {
        const cmd = mk('div', 'bchrome bcp hudx-cmd');
        cmd.appendChild(topbar);
        inner.appendChild(cmd);
      }

      // Match the foe frame's diamond tabs.
      const frame = bp.querySelector('.bsx-frame');
      if (frame && !frame.querySelector('.hudx-dia')) {
        frame.appendChild(mk('span', 'hudx-dia t'));
        frame.appendChild(mk('span', 'hudx-dia b'));
      }
    }

    fitCluster(L.root, left);
  }

  /* ── 3b. FREEZE-FRAME the two clusters as the game just rendered them.
        This is the ONLY place the game-over rail's contents can come from —
        see the note on FROZEN. It runs after every successful relayout, so
        what a finished match shows is the state at its final render, never a
        value this file worked out. Two outerHTML reads per render; relayout()
        early-outs on `scr.__hudx`, so that is once per renderBattle(), not per
        tick. ─────────────────────────────────────────────────────────────── */
  if (bp) snapshot(bp, scr.querySelector('.hudx-cluster[data-hudx-side="foe"]'));

  /* ── 4. END TURN: the rail's LIVE button, moved to the bottom-right hex.
        (index.html carries a second #btn-end-turn inside the unused
        renderHandColumn; bindBattleEvents binds only the first, and that
        second copy is still not mounted.) ─────────────────────────────── */
  const etwrap = scr.querySelector('.etwrap');
  if (etwrap) {
    const dock = mk('div', 'hudx-endturn');
    dock.appendChild(etwrap);
    scr.appendChild(dock);
  }
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; guard(relayout); });
}

function start() {
  installStateBridge();
  const app = document.getElementById('app');
  // #app's direct children ARE the screen — `renderBattle()` replaces them
  // wholesale. Observing childList on #app alone (no subtree, no attributes)
  // means every in-place patch the game does per tick — _cbxRender's string
  // diff, _bpFit's --fit write, the turn timer — costs this module nothing.
  //
  // ⚠ SYNCHRONOUS, NOT rAF-DEFERRED — this is a correctness fix, not a
  // micro-optimisation. `renderBattle()` re-emits the whole screen in the
  // LEGACY layout: END TURN back in the left rail, both hero cards back in the
  // rail, no top band. Deferring the re-layout to requestAnimationFrame let
  // that legacy frame REACH THE SCREEN after every card play — measured in the
  // harness at #btn-end-turn = [8,853,320,48] (its legacy rect) 48ms after a
  // rebuild, and still [8,649,320,36] at the following paint, against
  // [1281,835,302,140] once the HUD settled. A whole-HUD flicker on every
  // state change.
  //
  // A MutationObserver callback is a MICROTASK: it runs when the JS stack
  // empties, i.e. after `renderBattle()`'s synchronous body (innerHTML +
  // bindBattleEvents + bindBattlePiles) has completed but BEFORE the browser
  // paints. Doing the work there means the legacy layout is never composited.
  //
  // Two things make this safe to do inline:
  //   · relayout() early-outs on `scr.__hudx` and touches nothing on a screen
  //     it has already laid out, so a burst of mutations costs one property
  //     read each;
  //   · it appends only to `.battle-screen`, never to #app itself, so it
  //     cannot re-trigger this observer and loop.
  // guard() still wraps it, so a throw here leaves the untouched (playable)
  // layout rather than taking renderBattle's crash guard down with it.
  //
  // rAF coalescing is still right for the two paths where nothing is painting
  // a stale frame — first start and resize — so schedule() is kept for those.
  if (app) new MutationObserver(() => { guard(relayout); }).observe(app, { childList: true });
  // A resize changes the rail budget and therefore the cluster fit.
  window.addEventListener('resize', () => {
    const scr = document.querySelector('.battle-screen');
    const left = scr && scr.querySelector('.battle-left');
    const cl = scr && scr.querySelector('.hudx-cluster');
    if (cl && left) guard(() => fitCluster(cl, left));
  });
  schedule();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
