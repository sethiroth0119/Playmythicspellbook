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
/* ⚠ THE GATE IS ON `__hudxVoidCards`, THE NEWEST SYMBOL — NOT ON `__hudxVoid`.
   The bridge grew a second reader (the vanish VIEWER needs the cards, not just
   their count). Gating on the oldest symbol would let a page that already has
   the count-only bridge skip the install and leave the viewer permanently
   unreadable; gating on the newest one means the whole seam is re-emitted
   whenever any part of it is missing. Both functions are idempotent
   assignments, so re-emitting is free.

   ⚠ AND THE CARD READER HANDS BACK PLAIN STRINGS, NEVER THE LIVE CARD OBJECTS.
   `App.state[side].void` holds the reducer's own card objects, and several
   effects push a card that is still referenced by `state.units` /
   `state[side].graveyard` (index.html ~88473: the graveyard entry is SPLICED
   OUT and the same object pushed to `void`). Handing those across the seam
   would give a styling module a live handle on battle state it has no business
   holding. Four scalar fields are copied out instead — id (for the art
   resolver), name, icon, type — so nothing this file touches can be written
   back into the match. */
function installStateBridge() {
  if (window.__hudxVoidCards) return;
  try {
    const s = document.createElement('script');
    s.textContent =
      'window.__hudxVoid=function(){try{return{player:((App.state.player.void)||[]).length,' +
      'ai:((App.state.ai.void)||[]).length};}catch(e){return null;}};' +
      /* Returns null — never [] — when the state cannot be read, so "the pile is
         empty" and "the bridge failed" stay distinguishable at the call site.
         `void` entries are NOT uniform: index.html:88474 pushes a bare
         `{id, name, type:'unit'}` for a unit that died and was banished, while
         88125 pushes the whole hand card. Every field is therefore coerced
         defensively and a missing one becomes ''. */
      'window.__hudxVoidCards=function(side){try{var a=App.state[side==="ai"?"ai":"player"].void;' +
      'if(!Array.isArray(a))return null;return a.map(function(c){c=c||{};return{' +
      'id:(typeof c.id==="string"||typeof c.id==="number")?String(c.id):"",' +
      'name:(c.name==null?"":String(c.name)),' +
      'icon:(c.icon==null?"":String(c.icon)),' +
      'type:(c.type==null?"":String(c.type))};});}catch(e){return null;}};' +
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

/* ══ THE VANISH PILE, AND WHY IT USED TO LIE ═══════════════════════════════
   This is genuinely new UI — the game has a `void` array per side (banish,
   vanishGrave*, hand-banish and Void-cost effects all push to it) but has never
   had a pile for it anywhere in the battle HUD.

   🔴 WHAT WAS WRONG. The cell rendered `cardslot empty hudx-voidslot` for EVERY
   count. MEASURED, live match, three cards seeded into `App.state.player.void`
   and re-rendered through the game's own `renderBattleNow()`:
       .hudx-vanish .hudx-voidslot  class="cardslot empty hudx-voidslot"
       img elements 0 · .hudx-voidface 1 · count "3" · cursor "default"
       role null · tabindex null · click -> 0 overlays anywhere in the document
   i.e. the slot said "3" while painting the *empty* placeholder next to a deck
   stack that was painting a real card back for the same kind of number, and
   there was no way to find out WHICH three cards had gone.

   THE FIX, AND ITS TWO HALVES:
     · >0 cards  -> the SAME markup index.html's own `_slot()` emits
       (`<img class="cbk">`, no `.empty`), so `.bsx .cardslot` / `.cbk` /
       `:hover` / the stacked ::before-::after shadow cards all apply without a
       line of new skin, and the pile matches the deck beside it exactly;
     · clicking opens a viewer built from the bridge (see openVoidView).

   ⚠ AN EMPTY PILE STILL RENDERS TODAY'S EMPTY STATE. A card back over a count
   of 0 is a picture of a card that is not there. `filled` is false for 0, for a
   null count, and for a bridge that cannot hand over the array at all.

   ⚠ AND `filled` IS KEYED ON THE **CARDS**, NOT ON THE COUNT. The two readers
   can disagree — an older cached bridge has `__hudxVoid` and no
   `__hudxVoidCards` — and a card back that opens nothing is a worse bug than
   the one being fixed, because it looks like a working control. Gating the
   card back on the same read the viewer will do makes "clickable" and
   "openable" one fact instead of two.

   ⚠ PLAYER ONLY, DELIBERATELY. Making the OPPONENT's banish pile browsable is a
   gameplay-information change (it is hidden knowledge in every card game that
   has the zone), not a HUD change, so the foe's cell is untouched: empty face,
   count, not clickable. If that is wanted it is the owner's call, not this
   file's. */
function vanishCell(side) {
  const v = (typeof window.__hudxVoid === 'function') ? window.__hudxVoid() : null;
  const n = v && typeof v[side] === 'number' ? v[side] : null;
  const cards = (side === 'player') ? voidCards() : null;
  const filled = !!(cards && cards.length);

  const cell = mk('div', 'hudx-cell hudx-vanish');
  cell.appendChild(mk('div', 'slabel', SVG_VANISH + 'VANISH'));
  const stack = mk('div', 'stack');
  const slot = mk('div', 'cardslot hudx-voidslot' + (filled ? ' hudx-voidfull' : ' empty'));
  slot.title = (side === 'ai' ? "Opponent's" : 'Your') + ' Vanish pile — cards banished out of play to the Void'
             + (filled ? ' — click to view' : '');

  if (filled) {
    /* THE BACK IS COPIED FROM THE DECK STACK IN THE SAME RAIL, not hard-coded.
       index.html's `_slot()` uses `getCardBackImage('player')` (index.html
       135369), which is the player's CHOSEN back — a literal path here would
       put the default back on the vanish pile and the player's own back on the
       deck two cells away. `#yourDeck` has already been moved into this grid by
       the time this runs, so its img is in the document and its src is the
       answer. The literal is only the last resort. */
    const img = mk('img', 'cbk');
    img.setAttribute('src', cardBackSrc());
    img.setAttribute('alt', '');
    img.setAttribute('draggable', 'false');
    /* A 404 on the back must not leave a broken-image glyph where the empty
       well used to be — fall all the way back to today's face. */
    img.addEventListener('error', () => {
      try { img.remove(); slot.insertBefore(mk('span', 'hudx-voidface'), slot.firstChild); } catch (_) {}
    });
    slot.appendChild(img);
    slot.setAttribute('role', 'button');
    slot.setAttribute('tabindex', '0');
    slot.addEventListener('click', () => openVoidView());
    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVoidView(); }
    });
  } else {
    slot.appendChild(mk('span', 'hudx-voidface'));
  }

  slot.appendChild(mk('span', 'count grey', '<i>' + (n == null ? '—' : n) + '</i>'));
  stack.appendChild(slot);
  cell.appendChild(stack);
  return cell;
}

const CARDBACK_FALLBACK = 'assets/artwork/cardback.png?v=5';

function cardBackSrc() {
  try {
    const im = document.querySelector('#yourDeck img.cbk');
    const src = im && im.getAttribute('src');
    if (src) return src;
  } catch (e) {}
  return CARDBACK_FALLBACK;
}

/* ══ THE VANISH VIEWER ═════════════════════════════════════════════════════
   index.html already owns a pile viewer — `App._pileView = 'player'|'ai'|'realm'`
   plus `render()` (index.html 135631-135744) — and adding a `'void'` branch to
   it would be the right place for this. It is not available: this piece may not
   edit index.html, and `App._pileView` is read only by that function's own
   `if` ladder, so setting it from here would re-render the battle screen with
   NO modal at all and cost a frame for nothing.

   So the modal is built here — but it is built out of the game's OWN modal
   parts (`.modal-backdrop` > `.ds-modal`, `.btn-mini` for the close button, the
   74px `auto-fill` tile grid, `getCardArt(id)` for the face) so it is the same
   object as the graveyard viewer rather than a second dialect of modal in the
   same HUD. z-index 1400 is copied from that viewer for the same reason:
   `.modal-backdrop`'s own default is 2147483647, which would put a pile list
   ABOVE the surveil modal (2147483000) and above the result card.

   ⚠ IT HANGS OFF `document.body`, NOT OFF `.battle-screen`. `renderBattle()`
   replaces #app's children wholesale on every state change, so a modal parented
   inside the screen is destroyed mid-read by anything that ticks — the turn
   timer included. On body it survives, and relayout() refreshes its list from
   the bridge on every rebuild instead (see the call at the top of relayout), so
   what it shows is never one state change stale.

   ⚠ NAMES GO IN AS `textContent`. `escapeHtml` already ran on this data once
   inside index.html; routing a card name back through innerHTML here would be a
   second chance to get that wrong, and this file's rule everywhere else is that
   nothing is re-emitted from a string. */
const VOID_MODAL_CLS = 'hudx-voidmodal';
let voidOpen = false;

function voidCards() {
  try {
    if (typeof window.__hudxVoidCards !== 'function') return null;
    const a = window.__hudxVoidCards('player');
    return Array.isArray(a) ? a : null;
  } catch (e) { return null; }
}

function voidTile(c) {
  const tile = mk('div', 'hudx-vtile');
  const face = mk('div', 'hudx-vface');
  let art = null;
  try { if (typeof window.getCardArt === 'function' && c.id) art = window.getCardArt(c.id); } catch (e) {}
  if (art) {
    const im = mk('img');
    im.setAttribute('src', String(art));
    im.setAttribute('alt', '');
    im.setAttribute('draggable', 'false');
    // Same fallback ladder index.html uses: art, then the card's own glyph.
    im.addEventListener('error', () => {
      try { im.remove(); face.classList.add('hudx-vglyph'); face.textContent = c.icon || '🕊'; } catch (_) {}
    });
    face.appendChild(im);
  } else {
    face.classList.add('hudx-vglyph');
    face.textContent = c.icon || '🕊';
  }
  const nm = mk('div', 'hudx-vname');
  nm.textContent = c.name || '?';
  tile.title = (c.name || '?') + (c.type ? ' — ' + c.type : '');
  tile.appendChild(face);
  tile.appendChild(nm);
  return tile;
}

function onVoidKey(e) {
  // Capture + stopPropagation: while this is the top layer, Escape belongs to
  // it and must not also reach whatever the battle screen does with the key.
  if (e.key === 'Escape') { e.stopPropagation(); closeVoidView(); }
}

function closeVoidView() {
  voidOpen = false;
  try { document.removeEventListener('keydown', onVoidKey, true); } catch (e) {}
  try { document.querySelectorAll('.' + VOID_MODAL_CLS).forEach((n) => n.remove()); } catch (e) {}
}

/* Re-fill the open list from the bridge. Called on every battle rebuild, so a
   card vanished while the list is open appears in it; a pile that has been
   emptied (Void -> deck / grave effects exist) closes the list rather than
   showing a stale one. Never throws — it is called from relayout()'s hot path. */
function refreshVoidView() {
  try {
    const bd = document.querySelector('.' + VOID_MODAL_CLS);
    if (!bd) { voidOpen = false; return; }
    const cards = voidCards();
    if (!cards || !cards.length) { closeVoidView(); return; }
    const sub = bd.querySelector('.hudx-vsub');
    if (sub) sub.textContent = '(' + cards.length + ' card' + (cards.length === 1 ? '' : 's') + ')';
    const grid = bd.querySelector('.hudx-vgrid');
    if (!grid) return;
    grid.textContent = '';
    cards.forEach((c) => grid.appendChild(voidTile(c)));
  } catch (e) { /* a stale list is still better than taking the relayout down */ }
}

function openVoidView() {
  try {
    if (voidOpen && document.querySelector('.' + VOID_MODAL_CLS)) return;
    closeVoidView();                       // never two backdrops
    const cards = voidCards();
    if (!cards || !cards.length) return;   // nothing to show, and nothing invented

    const bd = mk('div', 'modal-backdrop ' + VOID_MODAL_CLS);
    bd.style.zIndex = '1400';
    const box = mk('div', 'ds-modal');

    const head = mk('div', 'hudx-vhead');
    const ttl = mk('div', 'hudx-vtitle');
    ttl.appendChild(mk('span', 'hudx-vtitle-ic', SVG_VANISH));
    const t = mk('span');
    t.textContent = 'Your Vanish Pile';
    ttl.appendChild(t);
    ttl.appendChild(mk('span', 'hudx-vsub'));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'btn-mini';
    x.textContent = '✖ Close';
    x.addEventListener('click', closeVoidView);
    head.appendChild(ttl);
    head.appendChild(x);

    const note = mk('div', 'hudx-vnote');
    note.textContent = 'Cards banished out of play. They are not in your deck, hand or graveyard.';

    box.appendChild(head);
    box.appendChild(note);
    box.appendChild(mk('div', 'hudx-vgrid'));
    bd.appendChild(box);
    bd.addEventListener('click', (e) => { if (e.target === bd) closeVoidView(); });
    document.body.appendChild(bd);
    voidOpen = true;
    document.addEventListener('keydown', onVoidKey, true);
    refreshVoidView();
  } catch (e) { closeVoidView(); }
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

/* ── THE BATTLE-LOG HEADER IS THE TARGET, NOT THE 19px CHEVRON ─────────────
   MEASURED: `#btn-open-battle-log` comes out 18.7 x 18.7 CSS px at [26,571] —
   index.html sizes it 26x26 and `_bcpFit()`'s zoom (0.72-0.76 on these
   viewports) does the rest. hud.css puts it back over 24 by sizing it in the
   rail's own units, and this makes the whole ~250x48 header row open the log so
   the affordance is not a single small glyph in the first place.

   ⚠ THE HEADER'S OWN BUTTONS ARE EXCLUDED, or the live `onclick` would fire and
   then this would fire it again — `_openBattleLog()` twice in one gesture.
   ⚠ AND IT IS A LISTENER ON THE LIVE NODE, NOT A CLONE OR AN INLINE HANDLER.
   `renderBattle()` re-emits `.loghead` on every state change, so the flag lives
   on the element and dies with it; a fresh header simply gets wired again on
   the next relayout, and a header that has already been wired costs one
   property read. Nothing here re-emits markup, so index.html's own binding on
   `#btn-open-battle-log` is untouched.
   ⚠ Guarded and silent: if the button is missing this does nothing at all, and
   the header keeps whatever behaviour index.html gave it. */
function wireLogHead(scr) {
  const head = scr.querySelector('.bcp .loghead');
  if (!head || head.__hudxLog) return;
  head.__hudxLog = 1;
  head.addEventListener('click', (e) => {
    try {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      const b = head.querySelector('#btn-open-battle-log');
      if (b) b.click();
    } catch (_) {}
  });
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
  if (!scr) { closeVoidView(); return; }   // left the battle: the list is not about anything
  rearmCatcher();                    // before the early-out: every render kills it
  // Same reason as rearmCatcher: this must run on EVERY render, not only the
  // one that lays the screen out. The vanish list is a snapshot of `void`, and
  // `void` changes on exactly the renders the early-out skips.
  if (voidOpen) refreshVoidView();
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

     Everything that still exists keeps its new home regardless — RE-MEASURED
     THROUGH A REAL MATCH-ENDING TURN, not through a forced flag, because the
     previous revision of this comment measured it the easy way and got one line
     of it WRONG. Method, so it can be repeated: drop the AI hero the way the
     game's own effects do (`currentHp: 0, alive: false`), then press the REAL
     `#btn-end-turn`, so the game's own end-of-turn pipeline sets
     `state.gameOver`, mounts `.gameover-backdrop` and re-renders. It does —
     `App.state.gameOver` came back 'player' with nothing forced, on both runs.
     At 1600x1000, identical on two independent boots:
       .gameover-backdrop [0,0,1600,1000] · .gameover-modal [520,74,560,852.1]
       .hudx-topband      [0,0,1600,118]
       #fighters          [437,4,726,92], 2 banners, HP "0 / 250" and "250 / 250"
       #phase-bar         [459.7,86,680.5,32.4]
       .hudx-endturn      [1264,880,336,104]
       .hudx-endturn .endturn  [1304,896.5,256,71]
       [data-hudx-frozen=rail] [1264,0,336,874] · =foe [8,9,320,411.8]
       #btn-concede       [8,901.5,90.6,32]   (still live in the left rail)
       .hudx-norail true · window.__hudxErr null

     🔴 THE LINE THAT WAS FALSE, AND WHY IT LOOKED TRUE. The old comment claimed
     `#btn-end-turn [1264,897,336,71]` on this screen. It is NULL here — and that
     is CORRECT, not a bug. A match ends on the turn HANDOVER, so `s.turn` is
     'ai' by the time the game-over frame renders, and `_bcEndTurn()`
     (index.html:141268) early-returns
     `<button class="endturn waiting" disabled>ENEMY ACTING…</button>`, which
     carries NO id. Forcing `App.state.gameOver` mid-player-turn leaves
     `s.turn === 'player'` — the one thing the real path never does — so the
     forced test rendered the id'd button and the claim passed.
     THE HEX ITSELF IS NOT EMPTY and never was: `.hudx-endturn .endturn` is
     [1304,896.5,256,71] carrying "ENEMY ACTING…", styled by hud.css's
     `.endturn.waiting` (cold, inert, the same hexagon). So anything on this
     screen that wants END TURN must select `.hudx-endturn .endturn`, never
     `#btn-end-turn`.

     Every section below is independently guarded: one missing element must never
     take the band, the rail or END TURN down with it. */
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

    /* 📛 THE HERO NAME GETS ITS OWN BOX SO THE ▲LEVEL CHIP CANNOT BE
       ELLIPSIZED AWAY — the one thing hud.css cannot do for itself.
       index.html renders the whole readout as ONE ellipsizing run with the chip
       LAST in it (`_bcpFighter`, ~141434):
           <h2>NAME<span class="lvl">▲12</span></h2>
       `h2` is `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`, so
       when the row runs out of room the chip is the FIRST thing to go — the
       ellipsis eats it before it eats a single letter of the name. That is a
       property of HEAD, not of the YOU/FOE gutter §3 added.
       MEASURED WITHOUT A SCREENSHOT, because the harness pane does not
       composite and `text-overflow` does not move an overflowing box — it just
       stops painting it, so `getBoundingClientRect()` reports a chip that is
       not on screen. The honest test is the chip's rect against `h2`'s CONTENT
       box: `h2` is `overflow:hidden` with zero padding, so everything past that
       edge is clipped away. On HEAD's own sheet, UI zoom asserted 1 (see
       hud.css §3 — the battle screen is exempt from `_uiAutoScale`, and reading
       a stale zoom is how the earlier numbers in these files went wrong), with
       the banner heroes renamed to the bug report's names, the chip's right
       edge sits OUTSIDE that box by
         1280x800 · 1440x900   117.14 (foe ▲1) · 154.16 (player ▲1)
         1600x1000 · 1920x1200 122.78 · 163.89
       against a chip ~23px wide — i.e. entirely gone, at all four, before this
       file changes anything. And it is not only long names: `Zarra, the Brood
       Queen`, a SHIPPED starter hero, already loses 7.14px off the right edge
       of her chip at 1280x800 and 0.55px at 1600x1000. The gutter would deepen
       that to the whole chip; this wrapper takes it to 0px outside the box in
       all 24 measured cases instead.
       CSS alone cannot fix that. `text-overflow` needs a box to ellipsize in,
       an anonymous flex item cannot be given `overflow`/`text-overflow` (they
       are not inherited properties), and index.html is not this piece's to
       edit. So the name — everything in the h2 that is not the chip — is moved
       into a span of its own, which hud.css then makes the only shrinkable item
       in the row. Same trick, same guard and same "move, never re-emit" rule as
       the portrait wrapper above: the text NODES are moved, so nothing is
       re-serialised, `h2.textContent` is unchanged, and a name is never routed
       through innerHTML (escapeHtml already ran; re-emitting would be a second
       chance to get that wrong).
       ⚠ hud.css keys the flex row off `h2:has(.hudx-hname)`, so if this file
       ever fails to load or throws before here, the banner degrades to exactly
       today's behaviour instead of to a broken row. */
    fighters.querySelectorAll('.fighter .finfo > h2').forEach((h2) => {
      const first = h2.firstElementChild;
      if (first && first.classList.contains('hudx-hname')) return;   // already done
      const chip = h2.querySelector('.lvl');
      const wrap = mk('span', 'hudx-hname');
      h2.insertBefore(wrap, h2.firstChild);
      // everything up to (not including) the chip is the name; with no chip the
      // loop simply drains the h2, which is the right answer either way.
      while (wrap.nextSibling && wrap.nextSibling !== chip) wrap.appendChild(wrap.nextSibling);
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

  /* ── 5. The battle-log header becomes the log's hit target. Last, and on its
        own, so a missing header can never cost the band, the rail or END TURN
        their relayout. ──────────────────────────────────────────────────── */
  wireLogHead(scr);
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
