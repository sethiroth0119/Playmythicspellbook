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
function installStateBridge() {
  if (window.__hudxVoid) return;
  try {
    const s = document.createElement('script');
    s.textContent =
      'window.__hudxVoid=function(){try{return{player:((App.state.player.void)||[]).length,' +
      'ai:((App.state.ai.void)||[]).length};}catch(e){return null;}};';
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

function relayout() {
  const scr = document.querySelector('.battle-screen');
  if (!scr) return;
  if (scr.__hudx) return;            // already laid out — the cheap early-out
  scr.__hudx = 1;

  const left = scr.querySelector('.battle-left');
  const bp = scr.querySelector('.bp-wrap');
  const fighters = scr.querySelector('#fighters');

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
  if (app) new MutationObserver(schedule).observe(app, { childList: true });
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
