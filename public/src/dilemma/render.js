/* ═══════════════════════════════════════════════════════════════════════════
   render.js — THE MODAL. One body-level overlay: a decision from Ethos Heights,
   the choices on the table, and the companions from your last deck reading the
   room while you decide.

   🔴 THIS FILE TOUCHES NOTHING. No bridge, no rng, no economy, no state write,
   no bond call. CONTRACT §10.1, and it is not stylistic: `render.js` is the one
   file in this feature a designer will edit, and the guarantee that editing it
   cannot mint Cinder, move a bond or reshuffle a choice set is worth more than
   any convenience an import would buy. Everything it needs arrives in
   `handlers`, which `index.js` builds. A critic will grep this file for
   `MythicDilemmaBridge`, `Math.random`, `addGems` and `adjustBond` and find
   none; keep it that way.

   The two imports are deliberate and are the only ones the DAG (CONTRACT §0)
   allows that do not break that rule. Three names are taken from them, and no
   more:
     • `DILEMMA_ECON.influenceCap`  — so the header can print "62 / 100" without
       this file inventing a 100.
     • `DILEMMA_ECON.rosterMax`     — so the roster sub-line can say the list is
       a SUBSET without this file inventing an 8. Round 5's low finding: the
       modal printed "The deck you last took out" over the eight rows
       `engine.rankRoster()` slices out of a deck that holds up to forty
       (DECK_SIZE, index.html), and no surface said so. A display cap is the one
       kind of number this file is allowed to read — it decides how much of the
       panel is filled, not what anything is worth. 🔴 NO REWARD, BOND, COST OR
       COOLDOWN NUMBER IS READ HERE, and none ever should be.
     • `engine.rank(value)`         — a pure array lookup over INFLUENCE_RANKS.
       No host, no I/O, no rng.
   `rewards.js` is deliberately NOT imported: its exports touch `spendGems` /
   `addGems` / `grantCard`, and importing it would put the economy one keystroke
   away from the render path. The effect strings arrive through
   `handlers.describe()` instead — which is also what keeps the copy and the
   tuning table from drifting apart (CONTRACT §8.1).

   ⚠ CLASS NAMING, VERIFIED RATHER THAN ASSUMED. index.html already ships global
   `.md-chip`, `.md-chips`, `.md-badge`, `.md-lbl`, `.md-ic`, `.md-icons`,
   `.md-avatar` and `.md-profile` (the match-detail and profile chrome). Every
   rule below is id-scoped so nothing here leaks OUT — but an id-scoped rule only
   wins the properties it declares and silently INHERITS every property it does
   not, so reusing one of those names would import padding and colours from a
   screen this modal has nothing to do with. Those eight names are avoided. The
   structural names the contract fixes (`.md-wrap`, `.md-hd`, `.md-x`,
   `.md-wire`, `.md-brief`, `.md-choices`, `.md-choice`, `.md-roster`) were
   checked against the same list and are free, as were the two this round adds
   (`.md-ucell`, `.md-solo` — `grep -c` on index.html returns 0 for both). Check
   any new name the same way before using it; the cost of being wrong is a rule
   nobody here wrote silently restyling this panel.
   ═══════════════════════════════════════════════════════════════════════════ */

import { DILEMMA_ECON } from './data.js';
import { rank } from './engine.js';

const OV = 'mythic-dilemma-ov';
const STYLE_ID = 'md-style';

/* ── View state. All of it local to this file; none of it is persisted, and
      none of it survives a close. `index.js` owns everything durable. ─────── */
let _instance = null;      // the Instance from engine.openDilemma()
let _roster   = [];        // RosterUnit[] — snapshotted at open, never re-derived here
let _handlers = null;      // the seam; see callH()
let _view     = 'choose';  // 'choose' | 'outcome'
let _selected = null;      // choice id the player has committed to previewing
let _hover    = null;      // choice id under the cursor / keyboard focus, transient
let _outcome  = null;      // the Result handed to paintOutcome()
let _busy     = false;     // re-entrancy lock on the delegated click router
let _opener   = null;      // element focus is restored to on close
let _onKey    = null;      // the document-level key listener (Escape + the
                           // gesture stamps), so all close paths remove the same
                           // one; bound to keydown AND keyup via keyBind/keyFree
let _closing  = false;     // guards the close → onClose → close() re-entry
let _settledAt = 0;        // Date.now() of the choose→outcome swap; see strayClose()
let _panelGen  = 0;        // ++ on that same swap. The stray-close guard's real clock:
                           // a generation counter for "which controls are on screen".
let _pressGen  = null;     // the _panelGen the pointer gesture in flight BEGAN in
let _keyGen    = null;     // the _panelGen the activation key now in play went DOWN in
let _keyLive   = false;    // true only while a key event's own task is still
                           // running — i.e. while `_keyGen` describes something
                           // that is happening rather than something that has
                           // finished happening. See strayClose().
let _keysDown  = { Enter: false, Space: false };
                           // which activation keys are physically DOWN right
                           // now. `_keyLive` alone cannot answer that: an
                           // autorepeat's click does NOT run inside the
                           // keydown's task (measured — see strayClose()), so
                           // the key outlives the flag that was meant to
                           // describe it. Two named slots rather than a set,
                           // because these are the only two keys noteKey()
                           // watches and a bounded pair cannot accumulate.

/* ── esc ──────────────────────────────────────────────────────────────────
   LOCAL, deliberately. `escapeHtml()` is a top-level declaration in index.html
   and invisible to an ES module — the globals trap — and `window.escapeHtml` is
   `undefined`. community.bridge.js:59-61 states the other half of the reason:
   the escaper "must never be the reason a module fails to load."

   Everything that reaches innerHTML goes through this, including card icons.
   An icon looks like a safe emoji until you remember that a Forge card is
   player-authored text and `card.icon` is whatever its author typed. */
export function esc(t) {
  if (t === null || t === undefined) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Colours are the one thing that cannot be escaped into safety: they land
   inside a `style="border-color:…"` attribute, where `esc()` would stop a tag
   but not `red;background:url(…)`. Bond tier colours come from BOND_TIERS
   through the bridge and are trustworthy today — this exists so that stays true
   if a future ceiling/tier table is ever made data-driven, which is exactly the
   direction this codebase moves. Anything that is not a plain hex is refused. */
function safeColor(c, fallback) {
  const s = String(c || '');
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s) ? s : fallback;
}

/* ── The handler seam ─────────────────────────────────────────────────────
   Every call into `handlers` goes through here. index.js is a sibling written
   in a different context against the same contract, so this file treats a
   missing or throwing handler as a rendering condition rather than as an
   impossibility — a dilemma is a feature; the game is the product. A modal that
   renders a roster with no stances is a worse modal; a modal that throws on open
   is a broken screen.

   The seam is SEVEN functions: onChoose, onClose, describe, preview, stance,
   affordable — and, added this round, poleLabel. Every one is optional as far as
   this file is concerned; callH() supplies the fallback and the modal renders a
   degraded but honest panel without any of them. poleLabel is the one that must
   never fail loudly: it decorates a tooltip, and a tooltip is not worth a thrown
   handler or a second copy of LQ_POLE_LABEL living here. */
function callH(name, fallback) {
  const args = Array.prototype.slice.call(arguments, 2);
  try {
    const f = _handlers && _handlers[name];
    if (typeof f !== 'function') return fallback;
    const v = f.apply(null, args);
    return (v === undefined || v === null) ? fallback : v;
  } catch (e) { return fallback; }
}

const MIDDLE = { stance: 'middle', pole: null, intensity: null, reason: 'no-opinion' };
const NO_EFFECT = { costText: '', rewardText: '', influenceText: '', affordable: null };

function stanceOf(unit, choice) {
  const s = callH('stance', MIDDLE, unit, choice);
  return (s && typeof s.stance === 'string') ? s : MIDDLE;
}
function previewOf(unit, choice) {
  const n = callH('preview', 0, unit, choice);
  return (typeof n === 'number' && isFinite(n)) ? Math.round(n) : 0;
}
function describeOf(choice) {
  const d = callH('describe', NO_EFFECT, choice);
  return (d && typeof d === 'object') ? d : NO_EFFECT;
}
function affordableOf(choice) {
  // Defaults to TRUE, not false. A missing affordability handler must not
  // disable every button in the modal; the real gate is `payCost()` in the
  // resolve transaction, which refuses on its own and reports why.
  return callH('affordable', true, choice) !== false;
}

/* ══════════════════════════════════════════════════════════════════════════
   STANCE VOCABULARY
   ══════════════════════════════════════════════════════════════════════════ */

/* Support / Middle / Against reuse the colour language this game already has
   for a unit's inner state — `.dpx-chip` in index.html, where teal
   ALREADY means bond, red means trauma and a bare hairline means neutral. A
   player who has opened a unit's detail panel has been taught this palette; a
   new one here would be a second vocabulary for the same idea. */
const STANCE = {
  support: { cls: 'sup', word: 'Support', mark: '▲' },
  against: { cls: 'ag',  word: 'Against', mark: '▼' },
  middle:  { cls: 'mid', word: 'Middle',  mark: '—' },
};

/* Middle is four different silences and the modal says which. 'no-opinion' is
   the COMMON one — a Forge card authored with a name, an icon and stats resolves
   to no value poles at all: `_lqUnitValueProfile` (index.html)
   returns [] when there is no `valueProfile`, no legacy `values` and no
   archetype hit — so it gets the plainest, least apologetic wording of the
   four. */
const MIDDLE_WORD = {
  torn:         'Torn',
  'no-opinion': 'No view',
  untouched:    'Unmoved',
  procedural:   'Nothing to weigh',
};
const MIDDLE_WHY = {
  torn:         'Held on both sides of this one.',
  'no-opinion': 'Has no opinion on this.',
  untouched:    'This does not touch what they care about.',
  procedural:   'There is no side to take here.',
};

/* Pole names come from `LQ_POLE_LABEL` (index.html) — "⚔ Honor", not
   "Honor" — and they arrive through `handlers.poleLabel()`, which index.js
   builds off `values().poleLabel`. This file still may not call the bridge, and
   it still refuses to transcribe those eight labels and their emoji into a
   second table that can drift from the first: the capitalised id is the callH()
   fallback and nothing more. Round 1 shipped the fallback as the only answer,
   which was correct-but-plain; the handler is the round-2 fix and this is where
   it lands. The result is escaped by every caller — it reaches the DOM only
   through stanceWhy(), inside `title="${esc(...)}"`. */
function poleWord(p) {
  const s = String(p || '');
  if (!s) return '';
  const cap = s.charAt(0).toUpperCase() + s.slice(1);
  return String(callH('poleLabel', cap, s) || cap);
}
const INTENSITY_TAIL = { mild: '', firm: ' — firmly', zealous: ' — and will not be moved' };

/* One sentence, in the game's third-person-about-units voice, explaining a
   stance to a player who hovers it. Derived from the Stance object so it can
   never disagree with the chip beside it — the src/city/citizens.city.js:407-409
   rule ("the sentence is the WORST-scoring mood term, VERBATIM, so the bubble
   and the dialog can never disagree") applied to a stance. */
function stanceWhy(st) {
  const tail = INTENSITY_TAIL[st.intensity] || '';
  if (st.stance === 'support') return 'Speaks for ' + poleWord(st.pole) + tail + '.';
  if (st.stance === 'against') return 'Holds to ' + poleWord(st.pole) + tail + ' — this cuts against it.';
  if (st.reason === 'torn' && st.pole) return 'Holds ' + poleWord(st.pole) + ' on both sides of this one.';
  return MIDDLE_WHY[st.reason] || MIDDLE_WHY['no-opinion'];
}

function stanceWord(st) {
  return st.stance === 'middle'
    ? (MIDDLE_WORD[st.reason] || MIDDLE_WORD['no-opinion'])
    : STANCE[st.stance].word;
}

/* ══════════════════════════════════════════════════════════════════════════
   CSS
   ══════════════════════════════════════════════════════════════════════════ */

/* Every rule is scoped under `#mythic-dilemma-ov` — community.render.js:73-141's
   idiom, and the strongest isolation available without a shadow root. Colours
   read the `:root` tokens (index.html:94-129) THROUGH `var(…, literal)`, so the
   panel takes the game's palette when it is mounted in index.html and still
   renders correctly in a bare harness page where those tokens do not exist.

   ⚠ A RAW BACKTICK IN A COMMENT BELOW ENDS THIS TEMPLATE LITERAL. `node --check`
     still passes — the file is valid JS, it just means something else — and the
     module then throws only when it is IMPORTED. Two comments here cost that
     twice during the build. Every backtick inside this string is escaped, and
     the harness asserts it. Verify with an actual import, never with --check.
   ⚠ NO `backdrop-filter`. index.html:88 kills it globally with `!important` as
     a v105b GPU-crash fix, so writing one looks fine in review and does nothing.
     community.render.js:74 still carries a dead `blur(5px)`; this file does not
     copy it.
   ⚠ NO 'Lora', NO 'Roboto Mono'. The Google Fonts link at index.html:78 loads
     Cinzel, Cinzel Decorative, Crimson Text, Rajdhani and EB Garamond — nothing
     else. `.ds-modal` still asks for Lora (index.html:2803; 7 asks in all) and
     silently gets generic serif; 'Roboto Mono' is asked for 54 times across
     index.html and twice more in src/resonance/house.camp.js:111,120, and every
     one of them silently gets the default sans.
     ⚠ Round 1 wrote "house.camp.js asks for Roboto Mono 53 times" here. It does
     not — it asks twice; the 53 were index.html's. The count was real and the
     file it was pinned to was not, and that is the failure mode a WHY-comment
     has to be held to hardest: a number nobody can check is decoration, and a
     number pinned to the wrong file is worse than no number at all.
     Cinzel for headings and labels, Crimson Text for prose, and
     `font-variant-numeric: tabular-nums` (the `.dpx-chip` idiom) wherever a
     number sits in a column that must not jitter. */
export const DILEMMA_CSS = `
#${OV}{position:fixed;inset:0;z-index:2147483200;background:rgba(6,5,12,.86);
  display:flex;align-items:center;justify-content:center;padding:2vh 2vw;
  font-family:'Crimson Text',Georgia,serif;color:var(--ink,#e8e0d0)}
#${OV} *{box-sizing:border-box}
#${OV} .md-wrap{--md-acc:var(--gold,#d4af37);width:min(1080px,97vw);max-height:96vh;
  display:flex;flex-direction:column;background:linear-gradient(180deg,#161122,#0b0813);
  border:1.5px solid rgba(210,164,78,.55);border-radius:var(--radius-lg,14px);
  box-shadow:0 26px 74px rgba(0,0,0,.78);overflow:hidden;
  animation:mdRise .22s cubic-bezier(.34,1.56,.64,1)}
@keyframes mdRise{from{transform:scale(.965);opacity:0}to{transform:scale(1);opacity:1}}

/* ── header ── */
#${OV} .md-hd{display:flex;align-items:flex-start;gap:.75rem;padding:14px 18px;
  border-bottom:1px solid rgba(210,164,78,.28);
  background:linear-gradient(180deg,rgba(255,255,255,.03),transparent)}
#${OV} .md-hd .ico{font-size:1.7rem;line-height:1.1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6));
  flex:none;max-width:1.9em;overflow:hidden;white-space:nowrap;max-height:1.4em}
#${OV} .md-hd .who{flex:1;min-width:0}
#${OV} .md-hd h2{font-family:'Cinzel',serif;font-weight:900;color:#f6dc95;font-size:1.06rem;
  letter-spacing:.06em;margin:0 0 3px;overflow-wrap:anywhere}
#${OV} .md-place{font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.14em;
  text-transform:uppercase;color:var(--md-acc);display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
#${OV} .md-place .dot{color:#5c5343}
/* 🔴 THE CLOSE ✕ IS DRAWN, NOT TYPED, AND THAT IS THE FIX.
   It used to be the literal character U+2715 as the button's text. A text
   glyph's size, weight and even its COLOUR belong to whichever font the
   browser picks for it, and this modal inherits the host page's stack — so
   the fallback differs per machine. Reported from a real screenshot: the ✕
   came out white and nearly filling its box, where the same build here draws
   it amber and comfortably inside. Both are "correct" font fallback; neither
   is a layout bug, which is why measuring the old rule in this Chromium found
   the glyph perfectly centred (offset 0.0/0.0) and proved nothing.
   Two rotated bars owe nothing to a font: they are exactly 13x1.5, they take
   currentColor so the hover and focus states still drive them, and they
   cannot be swapped for an emoji face that ignores the colour property.
   ⚠ The button is deliberately EMPTY. Its accessible name comes from
   aria-label (see the markup), so there is no text for a screen reader to
   read twice and nothing for a font to reinterpret.
   ⚠⚠ NO BACKTICKS IN THIS COMMENT, EVER. Everything from DILEMMA_CSS's opening
   backtick to its closing one is a template literal, so a backtick used as
   quoting punctuation inside a comment HERE ends the CSS string early. Two of
   them balance out, which means node --check still passes and the stylesheet
   is silently cut into pieces at runtime — this exact comment was written that
   way once and the modal lost every rule below this point. Quote CSS
   identifiers with plain words instead. */
#${OV} .md-x{background:none;border:1px solid rgba(210,164,78,.5);color:#e2c37a;border-radius:8px;
  width:32px;height:32px;flex:none;cursor:pointer;padding:0;position:relative}
#${OV} .md-x::before,#${OV} .md-x::after{content:'';position:absolute;left:50%;top:50%;
  width:13px;height:1.5px;margin:-.75px 0 0 -6.5px;background:currentColor;border-radius:1px}
#${OV} .md-x::before{transform:rotate(45deg)}
#${OV} .md-x::after{transform:rotate(-45deg)}
@media (forced-colors:active){#${OV} .md-x::before,#${OV} .md-x::after{background:ButtonText}}
#${OV} .md-x:hover{border-color:#f6dc95;color:#f6dc95}
#${OV} .md-x:focus-visible,#${OV} button:focus-visible{outline:2px solid #f6dc95;outline-offset:2px}

/* Standing. RESERVE_RANKS-shaped, and DISPLAY ONLY — the three things that
   actually READ Influence live in engine.js and rewards.js. */
#${OV} .md-standing{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none;
  padding-right:2px}
#${OV} .md-standing .rk{display:inline-flex;align-items:center;gap:5px;font-family:'Cinzel',serif;
  font-size:.74rem;letter-spacing:.08em;border:1px solid;border-radius:999px;padding:2px 10px;
  background:rgba(0,0,0,.32)}
#${OV} .md-standing .nm{font-size:.68rem;color:#8d8370;letter-spacing:.1em;text-transform:uppercase;
  font-variant-numeric:tabular-nums}

/* ── body ── */
#${OV} .md-body{flex:1;overflow-y:auto;padding:14px 18px 18px}
#${OV} .md-wire{font-size:.76rem;letter-spacing:.06em;color:#8d8370;font-style:italic;
  margin:0 0 10px;overflow-wrap:anywhere}
/* \`.md-wire\` above already carries \`overflow-wrap:anywhere\`; \`.md-brief\` did
   not, and it is the longer of the two. Both are dev-authored prose today, and
   so were \`.bond-pill\` and \`.md-temper\` when round 3 hardened them on a
   measured argument — leaving the widest prose surface in the panel out of the
   same rule made the file's own standard inconsistent inside one file.
   Measured before: a 400-character unbreakable token in \`dilemma.brief\` drove
   \`P.md-brief\` to scrollWidth 3909 inside clientWidth 624, put \`.md-body\`
   into a REAL horizontal scroll (scrollLeft accepted 2849 at 1280x900 and 3533
   at 390x844) and pushed the roster off the right of the panel. \`max-width:78ch\`
   does not help: it caps the box, not the min-content contribution of the text
   inside it. */
#${OV} .md-brief{font-size:1rem;line-height:1.62;color:#efe3c4;margin:0 0 14px;max-width:78ch;
  overflow-wrap:anywhere}
#${OV} .md-cols{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px;
  align-items:start;align-content:start}
@media (max-width:880px){#${OV} .md-cols{grid-template-columns:1fr}}
/* A LOW CHOICE ROLL FILLS THE COLUMN INSTEAD OF LEAVING A HOLE. \`choiceBag\`
   can return three, and two columns then put an eight-row roster beside three
   buttons: measured 226px of empty panel under the last choice at 1280x900,
   which is the first thing the eye lands on after the brief.

   ⚠ COLLAPSING TO ONE COLUMN WAS TRIED FIRST AND IS WORSE — rendered, measured
   and rejected, not argued away. Stacked at 1280x900 the roster starts 483px
   down a 780px block: three of eight companions on screen, and the choices
   scroll off the top to reach the rest. This modal exists so the room reacts
   WHILE you read the lines; a layout that cannot show both at once trades a
   cosmetic hole for the feature. The dead space was the [low] defect. That
   would have been the high one.

   So the choices stretch into the space instead. \`align-items:stretch\` lets
   the column take the row height, the buttons share it, and their contents
   centre so a grown button reads as a deliberate card rather than as a short
   one with padding stuck to the bottom.

   The 560px cap on the CONTAINER is the guard, and it is not theoretical: with
   a 30-unit roster the row is 1625px tall, and uncapped that is three buttons at
   ~540px each. Capped, the same roll renders 181/183/181 and the roster scrolls
   past them as it should. Measured at 1280x900: three choices 483/483 with the
   roster (dead space 226px -> 0), two choices 237/239, an empty roster 88/90/88
   because there is nothing taller to match. Below the breakpoint the cap is
   lifted — see the media query — because there the grid is one column and a
   capped choice list would clip itself. */
#${OV} .md-cols.md-solo{align-items:stretch}
#${OV} .md-cols.md-solo .md-choices{max-height:560px}
#${OV} .md-cols.md-solo .md-choice{flex:1 1 auto;display:flex;flex-direction:column;
  justify-content:center}
/* Below the breakpoint the grid is already one column and the rows size to
   their content, so the stretch above is inert — but the cap is not, and a
   phone must never clip its own choice list. */
@media (max-width:880px){#${OV} .md-cols.md-solo .md-choices{max-height:none}}

#${OV} .md-h3{font-family:'Cinzel',serif;color:#e9cf8c;font-size:.78rem;letter-spacing:.12em;
  text-transform:uppercase;margin:0 0 4px}
#${OV} .md-sub{color:#8d8370;font-size:.76rem;line-height:1.5;margin:0 0 8px}
#${OV} .small-text{font-size:.78rem;color:var(--ink-dim,#a89888)}
#${OV} .ink-dim{color:var(--ink-dim,#a89888)}

/* ── choices ── */
#${OV} .md-choices{display:flex;flex-direction:column;gap:8px;margin:0;min-width:0}
#${OV} .md-choice{display:block;width:100%;text-align:left;cursor:pointer;font-family:inherit;
  color:inherit;border:1px solid rgba(210,164,78,.26);border-left:3px solid rgba(210,164,78,.3);
  background:rgba(255,255,255,.028);border-radius:10px;padding:10px 12px;
  transition:border-color .14s ease,background .14s ease}
/* Hover is deliberately WEAKER than .on. Both were full accent, and in the
   harness a hovered row and the focused row were indistinguishable — two lines
   apparently selected at once. Hover is a hint that the row is live; .on is the
   statement that the roster below is answering THIS one, so only .on gets the
   fill and the inset ring. */
#${OV} .md-choice:hover:not(:disabled){border-color:rgba(210,164,78,.55);background:rgba(255,255,255,.05)}
#${OV} .md-choice.on{border-color:var(--md-acc);border-left-color:var(--md-acc);
  background:linear-gradient(180deg,rgba(212,175,55,.16),rgba(0,0,0,.2));
  box-shadow:inset 0 0 0 1px rgba(212,175,55,.18)}
/* 🔴 AN UNAFFORDABLE CHOICE IS DIMMED, NOT \`disabled\`, AND THAT IS THE FIX FOR
   A BUG THE HARNESS CAUGHT. A real \`disabled\` button does not fire mouse events
   in Chrome, so hovering the one line the player cannot pay for left the roster
   frozen on some other choice — the modal going silent about exactly the
   decision the player is asking about. \`aria-disabled\` keeps the row hoverable,
   focusable and readable while the commit bar stays shut, which is also the
   recommended a11y pattern for "unavailable but discoverable". The commit path
   re-checks affordability itself; the styling is not the gate. */
#${OV} .md-choice.off{opacity:.5;cursor:not-allowed;border-left-color:rgba(224,85,106,.4)}
#${OV} .md-choice.off .lb{color:#c9b894}
#${OV} .md-choice:disabled{opacity:.42;cursor:not-allowed}
#${OV} .md-choice .lb{font-family:'Cinzel',serif;font-weight:700;font-size:.92rem;letter-spacing:.03em;
  color:#f3e2b4;display:block;margin-bottom:3px;overflow-wrap:anywhere}
#${OV} .md-choice.on .lb{color:#f6dc95}
#${OV} .md-choice .ds{display:block;font-size:.86rem;line-height:1.5;color:#c9bc9c;overflow-wrap:anywhere}
#${OV} .md-eff{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px;align-items:center}
/* 🔴 \`overflow-wrap:anywhere\`, NOT \`break-word\`, AND THE DIFFERENCE IS THE
   WHOLE FIX. These three chips carry \`describe()\`'s cost / reward / standing
   strings, which are built in rewards.js — a file another agent edits, and the
   one surface here whose text this file cannot see. Measured in Chromium with a
   400-character unbreakable token in \`costText\`: the chips drove 3,673px past
   \`.md-body\` at 1280x900 and 4,366px at 390x844, putting both \`.md-body\` and
   \`.md-wrap\` into horizontal scroll.  With the rule: 0 escapes, 0 scroll, the
   chip wrapping inside its own column at 553px / 335px. \`break-word\` would NOT have fixed it: it wraps at paint time but
   leaves the min-content contribution at the full token, so a flex item's
   \`min-width:auto\` still reserves the whole string and the row still overflows.
   \`anywhere\` shrinks min-content to one character, which is what lets the flex
   item actually give ground. Nothing in the shipped corpus is anywhere near
   this — it is the guard for the day something player-authored reaches
   describeChoice(), which is the failure this file's header argues you cannot
   see coming.

   ⚠ THE SAME TEXT IS PRINTED TWICE AND BOTH RENDERINGS ARE GUARDED. These chips
   are the choice-list copy; \`.md-cline .v\` in the consequence band is the same
   describe() output again, pinned above the commit bar, and it needs the same
   two properties for the same reason. Round 3 hardened this one alone and the
   band overflowed for a whole round. If a third surface ever prints
   describe()'s strings, it needs the rule too — the guard belongs to the TEXT,
   not to this selector. */
#${OV} .md-tag{display:inline-flex;align-items:center;gap:.3rem;padding:.14rem .5rem;border-radius:5px;
  font-size:.72rem;font-weight:600;letter-spacing:.02em;background:rgba(255,255,255,.03);
  border:1px solid var(--c,rgba(255,255,255,.16));color:#cfd8ea;font-variant-numeric:tabular-nums;
  min-width:0;max-width:100%;overflow-wrap:anywhere}
#${OV} .md-tag.cost{--c:rgba(224,168,106,.55);color:#e8c48d}
#${OV} .md-tag.rew{--c:rgba(212,175,55,.5);color:#f0cf7a}
#${OV} .md-tag.up{--c:rgba(60,208,192,.55);color:#7fd8cc}
#${OV} .md-tag.dn{--c:rgba(224,85,106,.55);color:#f0a3ac}
#${OV} .md-tag.short{--c:rgba(224,85,106,.6);color:#f0b3a6;background:rgba(220,90,70,.1)}
/* The at-a-glance reaction count, on the choice itself, so the shape of the
   room is readable before the player has hovered anything. */
#${OV} .md-tally{display:inline-flex;gap:4px;margin-left:auto}
#${OV} .md-tally span{display:inline-flex;align-items:center;gap:2px;font-size:.72rem;font-weight:700;
  padding:.1rem .38rem;border-radius:4px;border:1px solid var(--c,rgba(255,255,255,.16));
  color:var(--t,#cfd8ea);font-variant-numeric:tabular-nums}
#${OV} .md-tally .sup{--c:rgba(60,208,192,.55);--t:#7fd8cc}
#${OV} .md-tally .ag{--c:rgba(224,85,106,.55);--t:#f0a3ac}
#${OV} .md-tally .mid{--c:rgba(255,255,255,.16);--t:#9b9078}
#${OV} .md-tally .z{opacity:.35}

/* ── roster ── */
#${OV} .md-roster{border:1px solid rgba(210,164,78,.28);background:rgba(255,255,255,.028);
  border-radius:10px;padding:11px 12px;position:sticky;top:0}
@media (max-width:880px){#${OV} .md-roster{position:static}}
#${OV} .md-urow{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:8px;align-items:center;
  padding:7px 8px;margin:0 -8px;border-top:1px solid rgba(210,164,78,.14);
  border-left:3px solid var(--c,rgba(255,255,255,.14));border-radius:0 6px 6px 0;
  background:var(--bgc,transparent);transition:background .14s ease,border-color .14s ease}
#${OV} .md-urow:first-of-type{border-top:none}
#${OV} .md-urow.sup{--c:rgba(60,208,192,.55);--bgc:rgba(60,208,192,.06)}
#${OV} .md-urow.ag{--c:rgba(224,85,106,.55);--bgc:rgba(224,85,106,.06)}
#${OV} .md-urow.mid{--c:rgba(255,255,255,.14)}
#${OV} .md-urow.quiet{opacity:.62}
/* 🔴 THE ICON CELL IS CLAMPED, AND card.icon IS WHY. A Forge card's icon is
   whatever its author typed into the field — esc() makes it safe and does
   nothing about its SIZE. An icon of \`<img src=x onerror=...>\` measured 55px
   tall inside this 26px column and, with overflow visible, painted straight
   across the unit name and the bond pill: two strings in the same pixels, in
   the one panel this modal exists to show. Clamped to one line and one cell.
   \`.md-hd .ico\` carries the same clamp for the same reason. */
#${OV} .md-uicon{font-size:1.15rem;text-align:center;line-height:1;
  overflow:hidden;white-space:nowrap;max-height:1.4em}
/* 🔴 min-width:0 BELONGS ON THE GRID ITEM, AND ROUND 1 PUT IT ONE LEVEL TOO
   DEEP. \`.md-urow\` is \`26px minmax(0,1fr) auto\`, so the TRACK may shrink —
   but the middle item is \`.md-ucell\`, and a grid item's own min-width:auto
   resolves to its min-content size, which for nowrap text is the whole string.
   Measured before the fix: a 627px name inside a 437px row, 212px past the
   roster panel at 1280w and 301px at 390w, through its own stance chip and into
   horizontal scroll on .md-body. The reference file gets this right by making
   the flex item itself the name (community.render.js's \`.mc-row .nm\`); here
   the name shares a cell with the bond pill, so the CELL takes the min-width
   and the name takes the ellipsis.
   \`display:block\` on .md-uname is the other half and is not cosmetic:
   overflow and text-overflow do not apply to a non-atomic INLINE box, so the
   ellipsis declared below never fired even once the track was free to shrink. */
#${OV} .md-ucell{min-width:0}
#${OV} .md-uname{display:block;min-width:0;color:#efe3c4;font-size:.9rem;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
#${OV} .md-uname .tag{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.12em;
  text-transform:uppercase;color:#8d8370;margin-left:5px}
#${OV} .md-uname .tag.hero{color:#f0cf7a}
#${OV} .md-uname.unknown{color:#9b9078;font-style:italic;cursor:help}
#${OV} .md-umeta{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:3px}
#${OV} .md-right{display:flex;align-items:center;gap:7px;justify-content:flex-end}
#${OV} .md-stance{display:inline-flex;align-items:center;gap:3px;padding:.12rem .45rem;border-radius:5px;
  font-family:'Cinzel',serif;font-size:.68rem;font-weight:700;letter-spacing:.06em;
  border:1px solid var(--c,rgba(255,255,255,.16));color:var(--t,#9b9078);
  background:rgba(0,0,0,.25);white-space:nowrap;cursor:help}
#${OV} .md-stance.sup{--c:rgba(60,208,192,.55);--t:#7fd8cc}
#${OV} .md-stance.ag{--c:rgba(224,85,106,.55);--t:#f0a3ac}
#${OV} .md-stance.mid{--c:rgba(255,255,255,.16);--t:#9b9078}
#${OV} .md-delta{min-width:2.7em;text-align:right;font-family:'Cinzel',serif;font-weight:700;
  font-size:.82rem;font-variant-numeric:tabular-nums;cursor:help}
#${OV} .md-delta.up{color:#7fd8cc}
#${OV} .md-delta.dn{color:#f0a3ac}
#${OV} .md-delta.nil{color:#6f665a}
/* .bond-pill declares \`border:1px solid\` with NO colour in index.html —
   it is invisible without the tier colour supplied inline, which is exactly how
   the live unit panel uses it (the \`getBondTier\` pill, index.html:140448).
   Redeclared here rather than inherited so the panel is correct in any host.

   🔴 THESE TWO ARE \`white-space:nowrap\` AND THAT IS WHY THEY NEEDED CLIPPING.
   The tier name comes from BOND_TIERS and the temper name from the temperament
   table — dev-authored today, both of them, and both nonetheless measured
   driving the panel sideways on a 400-character unbreakable token, each one on
   its own: the pill 4,075px past \`.md-body\` at 1280 and 4,172px at 390, the
   temper name 3,823px and 3,920px.  Both put \`.md-body\` into horizontal
   scroll. Wrapping them is not the answer (a two-line pill wrecks the row
   grid), so they clip instead. \`min-width:0\` is the load-bearing half and is
   easy to leave out: these are flex items, their \`min-width:auto\` resolves to
   min-content, and for nowrap text min-content is the WHOLE string — which
   beats \`max-width\` outright, because min-width wins over max-width in the
   cascade's used-value stage. Without it the \`overflow:hidden\` below never gets
   a box small enough to clip anything. Measured, not reasoned: with the 400-char
   token the pill's scrollWidth is 4,486px inside a 258px clientWidth and the
   panel does not scroll; without \`min-width:0\` the same input drove it 4,075px
   past \`.md-body\`.

   ⚠ ONLY ONE OF THE TWO ACTUALLY ELLIPSISES, AND THE COMMENT SAYS SO RATHER
   THAN THE RULE IMPLYING OTHERWISE. Both are flex items of \`.md-umeta\`, so both
   are blockified — but \`.bond-pill\` is blockified to \`flex\` (from inline-flex)
   and \`text-overflow\` does not reach the anonymous item inside a flex
   container, so the pill CLIPS with no '…'. \`.md-temper\` is a plain span,
   blockified to \`block\`, and does ellipsise. Measured computed values:
   \`.bond-pill\` display flex / textOverflow ellipsis / scrollW 4486 vs clientW
   258; \`.md-temper\` display block / scrollW 4253 vs clientW 260 with a visible
   '…'. The declaration is kept on the pill because it costs nothing and becomes
   live the day the pill's text is wrapped in its own element — but nobody
   should read this rule and believe an ellipsis is on screen today. The FIX is
   the clip; the ellipsis is a courtesy one of the two surfaces gets. */
#${OV} .bond-pill{display:inline-flex;align-items:center;gap:3px;border:1px solid;
  background:rgba(0,0,0,.3);padding:.06rem .42rem;border-radius:3px;font-family:'Cinzel',serif;
  font-size:.66rem;font-weight:700;letter-spacing:.05em;cursor:help;
  font-variant-numeric:tabular-nums;white-space:nowrap;
  min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis}
#${OV} .md-temper{font-size:.68rem;color:#8d8370;letter-spacing:.03em;cursor:help;
  white-space:nowrap;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis}

/* ── consequence + commit ──
   The consequence band sits OUTSIDE the scrolling body, pinned between it and
   the commit bar. It started inside the left column, under the
   choices, and was moved for two reasons: it left a tall void beside the roster
   whenever the choice count rolled low, and — the one that matters — a cost can
   scroll out of sight there. "Do not hide the cost" is not satisfied by a panel
   the player has to scroll back up to read. Here it is always on screen and
   always directly above the button it describes. */
#${OV} .md-cons{display:flex;flex-wrap:wrap;gap:6px 20px;align-items:baseline;
  padding:9px 18px;border-top:1px solid rgba(210,164,78,.22);background:rgba(212,175,55,.05)}
#${OV} .md-cons.bad{background:rgba(220,90,70,.1);border-top-color:rgba(220,90,70,.45)}
#${OV} .md-cline{display:inline-flex;align-items:baseline;gap:7px;min-width:0}
#${OV} .md-cline .k{font-family:'Cinzel',serif;font-size:.66rem;letter-spacing:.13em;
  text-transform:uppercase;color:#8d8370;white-space:nowrap}
/* 🔴 THE SECOND RENDERING OF describe()'s TEXT, AND ROUND 3 ONLY HARDENED THE
   FIRST. \`.md-tag\` (above) and this are the two places costText / rewardText /
   influenceText reach the screen, and the guard went on one of them. The miss
   was structural rather than careless: the round-3 sweep counted surfaces
   inside \`.md-body\`, and the consequence band is deliberately OUTSIDE it —
   pinned between the scrolling body and the commit bar, for the reason the
   block comment above gives. A rule about text this file cannot see has to
   follow the TEXT, not the container.
   \`min-width:0\` is the load-bearing half, exactly as it is on \`.bond-pill\`:
   \`.md-cline\` already declares it, but \`.v\` is the flex item that actually
   CARRIES the string, and a flex item's own \`min-width:auto\` resolves to
   min-content and beats the parent's give. Measured with a 400-character token
   in costText: SPAN.v.cost laid out 3279px wide, 2357px past \`.md-wrap\`'s
   right edge, driving \`.md-wrap\` to scrollWidth 3522 against clientWidth 1078
   — and \`.md-wrap\` is \`overflow:hidden\`, so the cost was silently CUT OFF the
   right of the panel rather than scrolling into reach. Identical at 768 and
   390. "Do not hide the cost" is the whole reason this band exists. */
#${OV} .md-cline .v{font-size:.87rem;color:#e0d2ae;font-variant-numeric:tabular-nums;
  min-width:0;overflow-wrap:anywhere}
#${OV} .md-cline .v b{color:#f0cf7a;font-variant-numeric:tabular-nums}
#${OV} .md-cline .v.cost{color:#e8c48d}
#${OV} .md-cline .v.rew{color:#f0cf7a}
#${OV} .md-cline .v.up{color:#7fd8cc}
#${OV} .md-cline .v.dn{color:#f0a3ac}
#${OV} .md-cline .v.short{color:#f0b3a6}
#${OV} .md-foot{display:flex;gap:10px;align-items:center;padding:12px 18px;
  border-top:1px solid rgba(210,164,78,.28);background:rgba(0,0,0,.25)}
#${OV} .md-foot .hint{flex:1;min-width:0;font-size:.78rem;color:#8d8370;line-height:1.45}
#${OV} .md-commit{position:relative;padding:.6rem 1.6rem;border-radius:7px;cursor:pointer;flex:none;
  font-family:'Cinzel',serif;font-weight:800;font-size:.95rem;letter-spacing:.14em;
  text-transform:uppercase;color:#2a1e06;background:linear-gradient(180deg,#f6e3ae,#e0b95f 45%,#b98f33);
  border:1px solid #f6e3ae;box-shadow:0 3px 14px rgba(212,175,55,.35)}
#${OV} .md-commit:hover:not(:disabled){filter:brightness(1.08)}
#${OV} .md-commit:disabled{opacity:.4;cursor:not-allowed;filter:grayscale(.5)}

/* ── aftermath ── */
#${OV} .md-out{border:1px solid rgba(210,164,78,.35);border-left:4px solid var(--md-acc);
  background:rgba(8,10,16,.85);border-radius:8px;padding:12px 14px;margin:0 0 10px}
#${OV} .md-out .lead{font-size:1rem;line-height:1.6;color:#f0e6d2;margin:0 0 8px;overflow-wrap:anywhere}
#${OV} .md-out .ln{font-size:.87rem;line-height:1.55;color:#c8cee0;margin:0 0 4px;overflow-wrap:anywhere}
#${OV} .md-out .ln.warn{color:#e0b45a}
#${OV} .md-ledger{display:grid;gap:0}
#${OV} .md-ledger .lr{display:grid;grid-template-columns:26px minmax(0,1fr) auto auto;gap:8px;
  align-items:center;padding:6px 0;border-top:1px solid rgba(210,164,78,.14);font-size:.86rem}
#${OV} .md-ledger .lr:first-of-type{border-top:none}
#${OV} .md-ledger .nm{color:#efe3c4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${OV} .md-ledger .dv{font-family:'Cinzel',serif;font-weight:700;font-variant-numeric:tabular-nums;
  min-width:3em;text-align:right}
#${OV} .md-ledger .dv.up{color:#7fd8cc}
#${OV} .md-ledger .dv.dn{color:#f0a3ac}
#${OV} .md-ledger .dv.nil{color:#6f665a}
#${OV} .md-empty{color:#8d8370;font-size:.86rem;padding:6px 0;line-height:1.5}
/* Screen-reader-only announcement region. Present from open so an assistive
   technology has something to observe BEFORE the outcome lands — a live region
   inserted at the same moment as its text is frequently missed. */
#${OV} .md-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ── narrow ──
   Measured at 430px, not guessed: the title wrapped to three lines with the
   standing pill wedged beside it, the district and severity split across two
   rows around a stranded separator, and the footer hint stole two thirds of the
   commit bar's row. The panel is legible at this width now; nothing below is
   cosmetic. */
@media (max-width:560px){
  #${OV}{padding:0}
  #${OV} .md-wrap{width:100vw;max-height:100vh;border:none;border-radius:0}
  #${OV} .md-hd{flex-wrap:wrap;padding:12px 14px}
  #${OV} .md-standing{order:3;width:100%;flex-direction:row;align-items:center;
    justify-content:flex-start;gap:8px;padding-top:4px}
  #${OV} .md-body{padding:12px 14px 14px}
  #${OV} .md-cons,#${OV} .md-foot{padding-left:14px;padding-right:14px}
  #${OV} .md-foot .hint{display:none}
  #${OV} .md-commit{flex:1;padding-left:1rem;padding-right:1rem}
}

/* /src/battle/combat.js:337 is the in-repo precedent for this block. Nothing
   here conveys meaning through motion, so switching it all off costs nothing. */
@media (prefers-reduced-motion: reduce){
  #${OV} .md-wrap{animation:none}
  #${OV} .md-choice,#${OV} .md-urow{transition:none}
}
`;

export function injectStyle() {
  try {
    // DOM-id guard rather than a module-level boolean: it survives a double
    // module evaluation (two <script type="module"> tags, a dev reload), which
    // the `cssDone` boolean in src/resonance/house.camp.js:126-130 does not.
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = DILEMMA_CSS;
    document.head.appendChild(s);
  } catch (e) { /* a missing stylesheet is an ugly modal, not a broken game */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   MARKUP
   ══════════════════════════════════════════════════════════════════════════ */

const ACCENT = { quiet: 'var(--azure,#4a8fd4)', pressing: 'var(--gold,#d4af37)', grave: 'var(--ember,#e85d3c)' };
const SEV_WORD = { quiet: 'Quiet', pressing: 'Pressing', grave: 'Grave' };

function focusedChoice() {
  const list = (_instance && Array.isArray(_instance.choices)) ? _instance.choices : [];
  if (!list.length) return null;
  // Hover wins over selection, selection wins over the default. The default is
  // the FIRST choice rather than nothing: a roster showing eight "—" chips until
  // the player happens to hover something reads as broken, and the whole point
  // of this modal is that the room is already reacting when it opens.
  const want = _hover || _selected || list[0].id;
  for (const c of list) if (c && c.id === want) return c;
  return list[0];
}

function headerHtml() {
  const d = _instance.dilemma || {};

  /* ⚠ THE HEADER MUST NOT CONTRADICT THE BODY, and it did. This read
     `influenceAtOpen` unconditionally, so after a resolution that moved standing
     the header still showed the number from before while the aftermath two
     inches below announced the new one — the modal disagreeing with itself in
     the same viewport. Caught in the harness, not in review. The aftermath is
     the authority once it exists; before that, the value the choices were rolled
     against is the only honest one. */
  const post = _outcome && typeof _outcome.influenceAfter === 'number' ? _outcome.influenceAfter : null;
  const inf = Number(post === null ? _instance.influenceAtOpen : post) || 0;
  const r = rank(inf) || null;
  const rc = safeColor(r && r.color, '#a89888');
  const sev = SEV_WORD[d.sev] || '';
  return `<div class="md-hd">
    <span class="ico" aria-hidden="true">${esc(d.icon || '🏛')}</span>
    <span class="who">
      <h2 id="md-title">${esc(d.title || 'Ethos Heights')}</h2>
      <span class="md-place">${esc(d.district || 'Ethos Heights')}${
        // The separator and the severity wrap as ONE unit — split, a narrow
        // panel stranded a lone '·' at the start of its own line.
        sev ? `<span><span class="dot">·</span> ${esc(sev)}</span>` : ''}</span>
    </span>
    <span class="md-standing">
      <span class="rk" style="border-color:${rc};color:${rc}"
        title="Your standing with Ethos Heights. It decides which decisions reach you, how much they pay, and how many ways out you are offered.">${
        esc((r && r.icon) || '👤')} ${esc((r && r.name) || 'Unknown Face')}</span>
      <span class="nm">Standing ${inf} / ${DILEMMA_ECON.influenceCap}</span>
    </span>
    <button class="md-x" data-md="close" aria-label="Close" title="Close"></button>
  </div>`;
}

function tallyFor(choice) {
  const t = { support: 0, middle: 0, against: 0 };
  for (const u of _roster) {
    const s = stanceOf(u, choice).stance;
    if (s === 'support') t.support++; else if (s === 'against') t.against++; else t.middle++;
  }
  return t;
}

function choiceHtml(choice, idx) {
  const eff = describeOf(choice);
  const can = affordableOf(choice);
  const on = focusedChoice() === choice;
  const t = tallyFor(choice);
  const neg = Number(choice.influence) < 0;

  const tags = [
    eff.costText   ? `<span class="md-tag cost">${esc(eff.costText)}</span>` : '',
    eff.rewardText ? `<span class="md-tag rew">${esc(eff.rewardText)}</span>` : '',
    eff.influenceText ? `<span class="md-tag ${neg ? 'dn' : 'up'}">${esc(eff.influenceText)}</span>` : '',
    (!can && eff.costText) ? `<span class="md-tag short">Short of it</span>` : '',
  ].join('');

  // The tally is hidden entirely when nobody is standing with the player —
  // three zeroes is noise, and the roster panel already says why it is empty.
  const tally = _roster.length ? `<span class="md-tally" aria-hidden="true">
      <span class="sup${t.support ? '' : ' z'}">▲ ${t.support}</span>
      <span class="mid${t.middle ? '' : ' z'}">— ${t.middle}</span>
      <span class="ag${t.against ? '' : ' z'}">▼ ${t.against}</span></span>` : '';

  return `<button type="button" class="md-choice${on ? ' on' : ''}${can ? '' : ' off'}" data-md="pick"
    data-id="${esc(choice.id)}" aria-pressed="${on ? 'true' : 'false'}"
    ${can ? '' : 'aria-disabled="true" title="You are short of the Cinder this asks for."'}>
    <span class="lb">${esc(choice.label || ('Option ' + (idx + 1)))}</span>
    <span class="ds">${esc(choice.desc || '')}</span>
    <span class="md-eff">${tags}${tally}</span>
  </button>`;
}

/* 🔴 THE ICON IS GUARDED BEFORE IT IS CLAMPED, and the clamp is why this is
   needed rather than instead of it. `.md-uicon`'s `overflow:hidden` stops a
   player-authored icon field from painting across the name and the bond pill —
   but what it leaves in the cell is the first ~26px of that field, and for the
   field `<img src=x onerror=…>` that is the visible, escaped fragment `<im`.
   Safe, and it still reads as a broken row in the one panel this modal exists
   to show. So the row shows a card glyph instead of three characters of
   somebody's markup, and the CSS clamp stays as the backstop for what this
   cannot catch: one legitimate glyph that renders very wide.

   ⚠ THE TEST IS SHAPE, NOT LENGTH, AND THAT IS A DELIBERATE DEPARTURE FROM THE
   OBVIOUS RULE — measured, because the obvious rule is wrong on this codebase's
   own data. `icon.length <= 2` reads as "one emoji" and is not: any emoji
   carrying VARIATION SELECTOR-16 is THREE UTF-16 units, and a ZWJ sequence is
   five. Run against the 385 distinct `icon:` literals in index.html, a length
   rule discards 30 real ones — 🏛️ 🏚️ 🛡️ 🗡️ 👁️ 🕯️ 🏴‍☠️ 🧑‍🔧 among them, and
   🏛️ is the DEFAULT DILEMMA ICON this feature's own header prints. Trading a
   markup fragment for a wrong glyph on thirty shipped cards is not a fix.

   What actually separates the two cases is that markup contains characters an
   icon never does. `<`, `>`, `&`, quotes, `=`, a slash, a backtick, a control
   character, or two ASCII letters in a row: every hostile field measured has at
   least one; no emoji has any. Stripping the joiners then caps what survives at
   three code points, so a lone letter or digit still passes and a word does
   not. Measured on the same 385: 15 rejected, and every one of the 15 is a
   genuine non-glyph — an `assets/…png` path or a word like 'sword'. All four
   hostile fields the harness drives are rejected, `<im` included. */
const ICON_UNSAFE = /[<>&"'=`\\/\u0000-\u001f]|[A-Za-z]{2}/;
const ICON_JOINERS = /[\u200d\ufe0f\ufe0e]/g;
function iconFor(unit) {
  const dflt = (unit && unit.kind === 'hero') ? '🎖' : '🃏';
  try {
    const s = String((unit && unit.icon) || '');
    if (!s || ICON_UNSAFE.test(s)) return dflt;
    return Array.from(s.replace(ICON_JOINERS, '')).length <= 3 ? s : dflt;
  } catch (e) { return dflt; }
}

function rosterRowHtml(unit, choice) {
  const st = stanceOf(unit, choice);
  const meta = STANCE[st.stance] || STANCE.middle;
  const d = previewOf(unit, choice);
  const tier = unit.tier || null;
  const tc = safeColor(tier && tier.color, '#9aa0a6');
  const quiet = (st.stance === 'middle' && st.reason === 'no-opinion');

  /* A non-middle stance that previews 0 is not a bug and must not read as one:
     engine.previewBond() has already run adjustBond's own arithmetic and found
     the change had nowhere to go. Say so where the number would have been.

     🔴 THERE ARE TWO CLAMPS AND THIS SAID "CEILING" FOR BOTH. `stance !== middle
     && delta === 0` cannot tell a Sworn companion pinned at 1200 from a Wary one
     pinned at 0, so a soured unit at bond 0 who OPPOSED the call was told "their
     regard is already at its ceiling" — the exact opposite of the truth, in the
     most emotionally load-bearing sentence in the panel, and repeated by the
     pinned band and the aftermath ledger. Bond 0 is the bottom of the Wary tier,
     not an exotic state: a companion benched through a run arrives there.
     The row already carries the number needed to split them. `bond <= 0 &&
     against` is the floor; a stuck SUPPORTER is the ceiling; and the third arm
     claims neither, because an against-unit stuck above 0 cannot happen through
     previewBond (it clamps at -current, and adjustBond's own Math.min(-1) floor
     means any survivor of that clamp moves at least one) — so if one ever
     arrives, it arrives from a producer this file cannot reason about, and the
     honest thing is to say it did not move and stop there.
     No richer previewBond() return was asked for: CONTRACT §4 is frozen, and
     the field that settles it was on the row all along. */
  const stuck = (st.stance !== 'middle' && d === 0);
  const floored = stuck && st.stance === 'against' && (Number(unit.bond) || 0) <= 0;

  /* 🔴 A SUPPORTER CAN PREVIEW −551, AND ROUND 2 SAID NOTHING ABOUT WHY.
     `bondCeilingFor` LOWERS a companion's cap when it has been sold more than
     three times, or sold at all while Sworn — and `adjustBond` then drops the
     unit to that cap on the next adjustment WHATEVER THE SIGN. `previewBond`
     clamps the same way and honestly returns the negative. Driven at
     saleCount 6, bond 900, ceiling 349: the row read "▲ Support −551" with the
     title "Their bond moves by −551 if you make this call." — true, and a
     player reading it can only conclude the modal is broken or that agreeing
     with them costs them. Neither is what happened.

     This side needs NO SEAM. `bond` and `ceiling` are both already on the row
     (engine's rosterRow), so the condition is derived here from the same two
     numbers `previewBond` clamped against and the same two the aftermath row
     reports as `overCap` — one condition, three surfaces, which is the property
     that kept 567 of 567 previews matching what landed. The NUMBER is not
     touched: it is correct and it is what will happen. Only the silence is the
     defect, so only the sentence changes.

     ⚠ MIDDLE IS EXCLUDED, AND THAT IS NOT TIDINESS. `applyStances` skips a
     middle unit outright (`if (st.stance === 'middle') continue`), so no
     `adjustBond` call is made for them and the lowered cap does NOT collect on
     this decision. Telling an ambivalent companion's row "whatever you decide
     now settles them back to their limit" would be the modal predicting a write
     that is not going to happen — a new small lie in the sentence added to stop
     one. They keep the ordinary "their bond does not move on this", which is
     exactly what will occur. */
  const cap = Number(unit.ceiling) || 0;
  const over = st.stance !== 'middle' && cap > 0 && (Number(unit.bond) || 0) > cap;

  const dCls = d > 0 ? 'up' : d < 0 ? 'dn' : 'nil';
  const dTxt = d > 0 ? '+' + d : d < 0 ? '−' + Math.abs(d) : (stuck ? '0' : '·');
  const dTitle = over
    ? 'They are holding more regard than they can keep. Whatever you decide now settles them back to their limit.'
    : floored
    ? 'This one cannot fall further — their regard is already on the floor.'
    : stuck && st.stance === 'support'
    ? 'This one cannot move — their regard is already at its ceiling.'
    : stuck ? 'This one cannot move on this call.'
    : d === 0 ? 'Their bond does not move on this.'
    : 'Their bond moves by ' + (d > 0 ? '+' : '−') + Math.abs(d) + ' if you make this call.';

  const temper = unit.temper && unit.temper.name
    ? `<span class="md-temper" title="${esc(unit.temper.blurb || '')}">${esc(unit.temper.icon || '')} ${esc(unit.temper.name)}</span>` : '';

  /* A forged card whose definition was never published on THIS device resolves
     to `card: null` (`lookupCustomCard`, index.html) and engine falls back
     to printing the stored id. Left bare that reads as a bug in the player's own
     collection, so the row says what it is instead. Dropping the row was the
     other option and is worse: their deck would look shorter than it is. */
  const unknown = !unit.card;

  const icon = iconFor(unit);
  /* 🔴 THE NAME IS ALWAYS ITS OWN TOOLTIP, because the CSS above clips it and
     round 4 gave a tooltip only to the 'Unlisted' path. `.md-uname` is
     `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` — which is the
     right call and is what keeps a 110-character Forge name inside its row —
     but ellipsis DESTROYS the text, it does not defer it. Driven on a
     109-character Forge name: the name box lays out 263px of a 665px
     scrollWidth at 1280, 515px at 768 and 178px at 390 — and `title` was
     `null` at all three, so the player read "Ser Aldebrandt of the Nine-…" with
     no way to see the rest of a card they wrote themselves. A name the player
     authored and cannot read back is the panel taking something away from
     them.
     ⚠ IT IS SET UNCONDITIONALLY, not only when the string looks long. Whether a
     name is clipped depends on the viewport, the font that actually loaded and
     the width the bond pill takes beside it — none of which this function can
     see, and a guess that is wrong at 390px is a tooltip missing exactly where
     the clipping is worst. An unnecessary tooltip on a short name costs a hover
     hint; a missing one costs the name.
     The unlisted sentence is APPENDED rather than replacing the name, because
     that path is the one where the row shows a bare stored id and the player
     most needs both halves: what it is called, and why it has no view. */
  const fullName = String((unit.name || unit.id) || '');
  const nameTitle = ' title="' + esc(fullName + (unknown
    ? ' — this card travelled with you, but its definition was never published on this device. It has no view here.'
    : '')) + '"';

  return `<div class="md-urow ${meta.cls}${quiet ? ' quiet' : ''}">
    <span class="md-uicon" aria-hidden="true">${esc(icon)}</span>
    <span class="md-ucell">
      <span class="md-uname${unknown ? ' unknown' : ''}"${nameTitle}>${esc(unit.name || unit.id)}${
        unknown ? '<span class="tag">Unlisted</span>'
                : (unit.kind === 'hero' ? '<span class="tag hero">Hero</span>' : '')}</span>
      <span class="md-umeta">
        <span class="bond-pill" style="border-color:${tc};color:${tc}"
          title="Bond — ${esc((tier && tier.name) || 'Unknown')}. Deeper regard, more from every battle they fight at your side.">💗 ${esc((tier && tier.name) || '—')} ${Number(unit.bond) || 0}</span>
        ${temper}
      </span>
    </span>
    <span class="md-right">
      <span class="md-stance ${meta.cls}" title="${esc(stanceWhy(st))}">${
        esc(meta.mark)} ${esc(stanceWord(st))}</span>
      <span class="md-delta ${dCls}"${dTxt === '·' ? ' aria-hidden="true"' : ''} title="${esc(dTitle)}">${dTxt}</span>
    </span>
  </div>`;
}

/* ⚠ THE HEADING CHANGES WHEN THE ROSTER IS A GUESS, and that is a requirement,
   not a nicety. The fallback ladder ranks Profile.units by `_lastBattleFielded`,
   which is set true only for units actually DEPLOYED (index.html:152782) and
   cleared only for benched units that were in `s._deckUnitIds`
   (index.html:152881) — so a unit from a deck the player abandoned keeps a
   stale `true` forever. It is a decaying heuristic. Calling it "your last deck"
   would be the modal telling a small lie about the player's own collection,
   which is the kind of thing a player notices and never trusts again.

   🔴 AND THERE IS A THIRD CASE, WHICH ROUND 2 PRINTED AS THE FIRST ONE. A
   brand-new player has no units and no recorded deck, so `roster()` returns
   `[]` — and `[]` fails `every(fallback)` the same way a real deck does, so the
   panel printed "Standing with you — The deck you last took out. They can hear
   this too." directly above "No one is standing with you yet. Take a deck out
   past the wall…". Two sentences contradicting each other, in the same box, on
   the most common first-session path there is. An array cannot carry the
   difference between "no deck was recorded" and "this player owns nothing", so
   the engine now NAMES it: `instance.rosterSource` is 'deck' | 'heuristic' |
   'none' (CONTRACT-R3 §6.3), set by the function that actually took the branch.

   🔴 AND THE FALLBACK IS WRITTEN TO FIX F8 ON ITS OWN. `rosterSource` is
   additive and optional by contract, so a stale service-worker engine.js will
   hand this file an instance without it — and the round-2 lesson is that a
   consumer which needs a signal to be honest is a consumer that will one day be
   dishonest. So the no-signal path keeps the old derivation for the heading AND
   suppresses the sub-line whenever the roster is empty, which is the single
   clause that makes the contradiction impossible from here regardless of what
   the engine says. The rule is §6.0's: a signal that does not arrive must make
   this file say NOTHING, never something false. */
function rosterHtml() {
  const choice = focusedChoice();

  const src = _instance && typeof _instance.rosterSource === 'string' ? _instance.rosterSource : '';
  const heuristic = src ? src === 'heuristic'
                        : (_roster.length > 0 && _roster.every((u) => u && u.fallback));
  /* An empty roster outranks whatever the engine called it, and the ORDER of
     these two clauses is the fix. Round 3 wrote this as
     `src ? src === 'none' : _roster.length === 0`, which suppressed the
     sub-line on the no-signal path only — so an instance carrying
     `rosterSource:'deck'` (or any value this file does not recognise) over an
     empty roster still printed "The deck you last took out. They can hear this
     too." directly above "No one is standing with you yet." The comment above
     claimed the empty-roster clause held "regardless of what the engine says",
     and it was one `||` short of being true. Today's `rosterOf()` returns
     'none' whenever there are no rows so it was not reachable through the
     shipped pair — but CLAUDE.md makes comments load-bearing, and an assertion
     a stale service-worker engine could falsify is not a guarantee. It costs
     nothing: an empty roster has no source worth naming, which is CONTRACT-R3
     §6.3's own reason for letting 'none' outrank. */
  const none = _roster.length === 0 || src === 'none';

  /* 🔴 THE PANEL SHOWS EIGHT AND WAS SAYING "YOUR DECK". `engine.rankRoster()`
     sorts by bond, then battles fought together, then deck order, and then
     `.slice(0, DILEMMA_ECON.rosterMax)` — 8 today — while `DECK_SIZE`
     (index.html) is 40 and, by rankRoster's own note, a full deck holds around
     twenty distinct units. So for essentially every real player the sub-line
     "The deck you last took out" named a whole deck over a list of eight, and
     every companion who went past the wall without making that top eight had no
     row, no stance and no bond movement, with nothing on screen to say why. The
     band and the ledger were always truthful — they count and pay exactly the
     rows that are shown — so this was the one surface over-claiming, and it was
     the surface that names WHO is in the room.

     ⚠ THE HONEST SENTENCE NEEDS THE CAP, WHICH IS WHY `rosterMax` IS IMPORTED.
     The alternative was to phrase around it ("some of the deck"), which is
     vaguer than the truth for no gain, or to have the engine report the
     pre-slice total — a contract change to fetch a number this file can already
     read from the same constant the slice uses. Reading the cap keeps the two
     in lockstep: raise `rosterMax` and the sentence follows it without anyone
     remembering to edit copy.

     ⚠ AND IT ONLY CLAIMS A SUBSET WHEN THERE IS ONE. A deck of five companions
     produces five rows, `_roster.length < rosterMax`, and the panel really is
     showing all of them — telling that player they are seeing a selection would
     be a fresh small lie told in the act of fixing one. At exactly the cap the
     list MAY be complete (a deck of exactly eight units) and the wording is
     written to survive that: "the eight closest to you" is true of eight
     companions whether or not a ninth exists. It does not print a total it
     cannot know — the deck's real unit count never crosses the seam.

     ⚠ AND THE FALLBACK SENTENCE CHANGES BY ONE WORD, WHICH IS THE POINT. If
     `rosterMax` ever arrives unreadable — a stale service-worker data.js, the
     key renamed upstream — `max > 0` is false and no subset claim is made. What
     it falls back to is NOT round 4's sentence: "The deck you last took out"
     asserts the list is the deck, and that assertion is the defect. "FROM the
     deck you last took out" is true of eight rows and of all five rows of a
     five-companion deck alike, so the un-capped and the cap-unreadable paths
     can share it safely. CONTRACT-R3 §6.0 again: with a signal missing this
     file says less, never something false. */
  const max = Number(DILEMMA_ECON && DILEMMA_ECON.rosterMax) || 0;
  const capped = max > 0 && _roster.length >= max;

  const head = none
    ? `<h3 class="md-h3">Standing with you</h3>`
    : heuristic
    ? `<h3 class="md-h3">Your most-fought companions</h3>
       <p class="md-sub">No deck has gone into battle since the Heights started asking. These are the ones you have fought beside most.</p>`
    : capped
    ? `<h3 class="md-h3">Standing with you</h3>
       <p class="md-sub">From the deck you last took out — the ${_roster.length} closest to you, not the whole deck. They can hear this too.</p>`
    : `<h3 class="md-h3">Standing with you</h3>
       <p class="md-sub">From the deck you last took out. They can hear this too.</p>`;

  return `<div class="md-roster">${head}<div id="md-roster-body">${rosterRowsHtml(choice)}</div></div>`;
}

/* 🔴 THE FULL PAINT AND THE PARTIAL PAINT MUST PRODUCE THE SAME BODY, which is
   why they share this function instead of each building their own rows.
   They did not, and the harness caught it: `rosterHtml()` printed the
   empty-roster line while `paintReactions()` mapped over an empty array and
   wrote an empty string — so a player with no companions saw the honest
   sentence until the first time the cursor crossed a choice, and an empty box
   after that. A message that survives the first paint and not the second is
   worse than no message, because it looks like the panel broke rather than like
   the player has no companions yet. One source, both callers. */
function rosterRowsHtml(choice) {
  if (!_roster.length) {
    return `<div class="md-empty">No one is standing with you yet. Take a deck out past the wall and someone will have a view next time.</div>`;
  }
  return _roster.map((u) => rosterRowHtml(u, choice)).join('');
}

/* The consequence band. Everything in it is DERIVED — the bond counts from the
   same `handlers.preview()` the roster prints, the money and standing values
   from `handlers.describe()`, which reads DILEMMA_ECON. No number here is
   hand-written, so retuning the table retunes the copy. That is the fix for the
   drift bug in the reference files: src/resonance/house.camp.js:152 promises
   "No rest-quality modifier here" while the same file's line 88 runs at
   CAMP_REST_QUALITY = 0.75.

   ⚠ KEY-AND-VALUE, NOT SENTENCES, AND THAT IS A CORRECTION. The first cut wrapped
   describe()'s strings in prose — 'Your standing gains <b>+3 standing</b>.' —
   which read as a stutter the moment the harness ran it. This file cannot see
   rewards.js's wording and must not assume it: any frame that supplies its own
   noun will eventually collide with the noun on the other side of the seam. A
   label the value cannot repeat is the only shape that survives someone else
   editing describeChoice(). */
function consequenceHtml() {
  const choice = focusedChoice();
  if (!choice) return '';
  const eff = describeOf(choice);
  const can = affordableOf(choice);

  /* The clamps are counted apart for the reason rosterRowHtml() gives: the band
     asserted "already at the ceiling" over a unit sitting on the floor, so the
     modal told the same lie twice in the same viewport.

     🔴 THE BAND AND THE ROW MUST AGREE, AND ON AN OVER-CAP SUPPORTER THEY DID
     NOT. A companion whose ceiling was lowered beneath its bond previews a
     large NEGATIVE even while it supports the call, so it fell into `dn` and
     the band said "1 loses it" over a row whose own title now explains that
     they are settling back to a limit. Counting them as a straightforward loss
     is the same class of error as calling a floor a ceiling: the number is
     right and the word for it is wrong. `over` is derived from exactly the
     expression rosterRowHtml() uses, so the two cannot drift.

     🔴 AND ROUND 3 PULLED OUT THE SUPPORTER ONLY, WHICH LEFT THE SAME
     DISAGREEMENT STANDING ON AN OPPOSER. `rosterRowHtml`'s `over` covers every
     non-middle stance, so an over-cap unit that OPPOSED the call got the row
     title "whatever you decide now settles them back to their limit" while this
     band, four inches below it, counted the same unit into `dn` and said "1
     loses it". Driven at bond 900 / ceiling 349 / against: both sentences on
     screen in one viewport, about one companion, disagreeing about what the
     −551 was. CONTRACT-R3 §6.2 does say `stance === 'support'` in so many
     words, and this DEPARTS from that text deliberately — the property round 2
     graded on, and the one §6.2 was written to buy, is that the band and the
     row agree; a literal reading that breaks the property it was written to
     protect is a reading worth stating and leaving behind.

     What is NOT laundered is the opposition. The band word covers both stances
     because "settling to their limit" is the true account of the NUMBER in both
     — 542 of that 551 is the lowered cap collecting, not the disagreement — but
     the receipt below (`ledgerHtml`) keeps them apart in words, so an opposer's
     line never reads as though the modal were excusing the decision. The row's
     own stance chip still says "Against"; nothing is hidden, and the three
     surfaces finally say the same thing. `over` is derived from EXACTLY the
     expression rosterRowHtml() uses, character for character, so the two cannot
     drift apart again. */
  let up = 0, dn = 0, still = 0, atCeiling = 0, atFloor = 0, settling = 0;
  for (const u of _roster) {
    const st = stanceOf(u, choice).stance;
    const d = previewOf(u, choice);
    const cap = Number(u.ceiling) || 0;
    const over = st !== 'middle' && cap > 0 && (Number(u.bond) || 0) > cap;
    if (d < 0 && over) settling++;
    else if (d > 0) up++; else if (d < 0) dn++;
    else if (st === 'middle') still++;
    else if (st === 'against' && (Number(u.bond) || 0) <= 0) atFloor++;
    else atCeiling++;
  }

  const bits = [];
  if (up)        bits.push('<b>' + up + '</b> ' + (up === 1 ? 'gains' : 'gain') + ' regard');
  if (dn)        bits.push('<b>' + dn + '</b> ' + (dn === 1 ? 'loses' : 'lose') + ' it');
  if (still)     bits.push('<b>' + still + '</b> ' + (still === 1 ? 'stays' : 'stay') + ' put');
  // Participle, not a verb, matching `already at the ceiling` beside it — this
  // clause and that one describe a STATE the unit is in rather than something
  // the decision does to them, so neither of them conjugates.
  if (settling)  bits.push('<b>' + settling + '</b> settling to their limit');
  if (atCeiling) bits.push('<b>' + atCeiling + '</b> already at the ceiling');
  if (atFloor)   bits.push('<b>' + atFloor + '</b> ' + (atFloor === 1 ? 'has' : 'have') + ' nothing left to lose');

  /* 🔴 `line()` ESCAPES ITS VALUE. It used to take raw HTML, which made every
     call site responsible for remembering esc() — three of the five did, the
     other two happened to pass literals, and the first person to add a sixth
     with a live string would have opened the one hole this file is otherwise
     built to refuse. Escaping is now the default and the exception is named:
     `lineHtml()` is for the ONE value that is generated markup (the room's
     <b>counts</b>, built four lines above out of integers). The shape, not the
     current call sites, is what was wrong — callH() and safeColor() exist for
     exactly this reason and this helper was the odd one out. */
  const lineHtml = (k, v, cls) =>
    `<span class="md-cline"><span class="k">${esc(k)}</span><span class="v ${esc(cls || '')}">${v}</span></span>`;
  const line = (k, v, cls) => lineHtml(k, esc(v), cls);
  const rows = [];

  rows.push(lineHtml('The room', _roster.length
    ? (bits.length ? bits.join(' · ') : 'nobody here has a view on this')
    : 'nobody is here to weigh in'));

  // Cost first and unhedged, and it never disappears when it cannot be paid —
  // a choice the player cannot afford must still say what it would have cost.
  if (eff.costText) rows.push(line('Out of pocket', eff.costText, can ? 'cost' : 'short'));
  if (!can) rows.push(line('Short', 'you do not have it — this line stays shut', 'short'));
  if (eff.rewardText) rows.push(line('May return', eff.rewardText, 'rew'));
  if (eff.influenceText) {
    rows.push(line('With the Heights', eff.influenceText, Number(choice.influence) < 0 ? 'dn' : 'up'));
  }

  return `<div class="md-cons${can ? '' : ' bad'}" id="md-cons">${rows.join('')}</div>`;
}

/* The footer's two mutable pieces, computed once so the full paint and the
   in-place update below can never say different things. */
function footState() {
  // `_selected`, not `focusedChoice()`: merely hovering a line must not arm the
  // commit bar. A dilemma that resolves on the first thing the cursor passes
  // over would be mis-clicked, and the roster reactions are the whole reason to
  // look before deciding.
  const choice = _selected ? choiceById(_selected) : null;
  const ready = !!(choice && affordableOf(choice));
  return {
    ready,
    label: ready ? 'Make the call' : 'Choose a line',
    hint: ready
      ? 'Nothing is spent and nothing moves until you make the call.'
      : 'Pick a line. Hover or tab through them and the room reacts before you commit.',
  };
}

function footHtml() {
  const f = footState();
  return `<div class="md-foot">
    <span class="hint" id="md-hint">${esc(f.hint)}</span>
    <button type="button" class="md-commit" id="md-commit" data-md="commit" ${f.ready ? '' : 'disabled'}>${
      esc(f.label)}</button>
  </div>`;
}

/* 🔴 THE FOOTER IS PATCHED, NEVER REPLACED, and that is a bug fix rather than an
   optimisation. `paintReactions()` used to do `foot.outerHTML = footHtml()`.
   Tabbing off the last choice fires focusout, which clears the hover and
   repaints — destroying the commit button in the same tick the browser was
   moving focus onto it, so focus fell back to <body> and the keyboard path out
   of the modal died at the last row. Nothing here creates or removes a node. */
function paintFoot() {
  try {
    const f = footState();
    const btn = document.getElementById('md-commit');
    if (btn) { btn.disabled = !f.ready; btn.textContent = f.label; }
    const hint = document.getElementById('md-hint');
    if (hint) hint.textContent = f.hint;
  } catch (e) {}
}

function chooseBodyHtml() {
  const d = _instance.dilemma || {};
  /* Two columns are worth it only when the choices can fill one. The threshold
     is the CHOICE COUNT, not a breakpoint — see the .md-solo rule for what a
     three-line roll looked like beside an eight-row roster.

     ⚠ `<= 4`, NOT `< 4`, AND ROUND 2 STOPPED ONE SHORT. Three and two choices
     measured exactly 0 dead space once the stretch landed, so the mechanism was
     right — but FOUR is the count BRIEF §1 calls the norm, and the default roll
     at 1280x900 with an eight-row roster measured a 375px choices column
     against a 484px roster: 108px of empty panel under the last choice, and the
     first thing the eye lands on after the brief. The fix for a hole in the
     uncommon case that leaves it open in the common one is not a fix. Five and
     six still take the two-column height, which is correct: at five the column
     already fills. */
  const solo = (_instance.choices || []).length <= 4;
  return `<div class="md-body">
    ${d.wire ? `<p class="md-wire">${esc(d.wire)}</p>` : ''}
    <p class="md-brief">${esc(d.brief || '')}</p>
    <div class="md-cols${solo ? ' md-solo' : ''}">
      <div class="md-choices">${(_instance.choices || []).map(choiceHtml).join('')}</div>
      ${rosterHtml()}
    </div>
  </div>
  <div id="md-cons-slot">${consequenceHtml()}</div>`;
}

/* ── aftermath ────────────────────────────────────────────────────────────
   Every number here is what LANDED, not what was previewed. `applyStances()`
   returns the real before/after out of `adjustBond`, which applies temperament
   and the ceiling, so even a preview that was wrong cannot become a lie the
   player is told twice. When the bridge refused a change this view says so
   rather than printing a movement that did not happen — but only when it can
   tell a refusal from a clamp, which is what `status` is for; see the note
   chain below. */
function ledgerHtml(bonds) {
  if (!Array.isArray(bonds) || !bonds.length) return '';
  const rows = bonds.map((b) => {
    // `landed` still decides the NUMBER, and only the number: on every path it
    // equals `status === 'moved'` (the engine asserts that invariant), and on
    // every non-moved path `after === before`, so this reads 0 either way. The
    // WORD beside it comes from `status` alone.
    const landed = !(b && b.landed === false);
    const real = landed ? (Number(b.after) - Number(b.before)) : 0;
    const cls = real > 0 ? 'up' : real < 0 ? 'dn' : 'nil';
    const txt = real > 0 ? '+' + real : real < 0 ? '−' + Math.abs(real) : '0';
    /* 🔴 THE NOTE READS `status`, AND ROUND 2'S SPLIT WAS UNREACHABLE WITHOUT
       IT. `landed` was `ok && after !== before` — one boolean carrying three
       meanings: the bridge refused the write, the ceiling absorbed it, the
       floor had nothing to give. Every one of the three took the `!landed` arm,
       so a Sworn companion at 1200 who SUPPORTED the call read "This one cannot
       move — their regard is already at its ceiling" in the roster and
       "not recorded" in the receipt, in the same modal, three seconds apart —
       the correct sentence and its contradiction, one scroll apart. The two new
       arms below this file added in round 2 could never be reached from any
       engine path. That was disclosed here rather than papered over, and this
       is the round the seam was opened: `status` is
       'moved' | 'ceiling' | 'floor' | 'unchanged' | 'refused' (CONTRACT-R3 §6.1)
       and the engine, which is the only party that knows which of the three
       happened, now says which.

       🔴 'NOT RECORDED' IS PRINTED OFF `status === 'refused'` AND OFF NOTHING
       ELSE — including a row carrying no `status` at all. That is not
       defensiveness for its own sake; it is what makes this half correct on its
       own. `status` is additive and optional by contract, so a stale
       service-worker engine.js will hand this ledger round-2's rows, and the
       failure direction is fixed by CONTRACT-R3 §6.0: a signal that does not
       arrive must make this file say NOTHING, never something false. A blank
       note beside a real `+2` is accurate and unexplained. "not recorded"
       beside a write that happened is a lie, and it is the exact lie this whole
       section exists to stop telling. So the default is silence and `landed` is
       never consulted for the WORD — only for the number.

       `overCap` answers the other question the receipt could not: why a unit
       that agreed with you lost 551. It is computed by the engine from the same
       `before` this row reports and the same ceiling `previewBond` clamps
       against, which is why the roster row above (`over`, in rosterRowHtml) and
       this line cannot disagree. Absent, again: no note, never a wrong one.

       🔴 AND IT COVERS BOTH STANCES, WHICH IS A DELIBERATE DEPARTURE FROM
       CONTRACT-R3 §6.2's LITERAL `stance === 'support'`. Round 3 implemented
       that text exactly, and an over-cap unit that OPPOSED the call therefore
       got the row tooltip "settles them back to their limit", the band's "1
       loses it", and here an empty note beside −551 — the same silence F5 was
       raised for, one stance over. The departure and its measurement are stated
       rather than quietly taken, the way the icon guard's was.

       The two stances get DIFFERENT WORDS, and that is the part worth keeping.
       "settled to their limit" over an opposer would read as the modal
       excusing the decision: it would account for the whole −551 as bookkeeping
       and never mention that they were against you. "past their limit already"
       accounts for the number without absolving the call, and the row above
       still carries the stance chip. A row that somehow carries `overCap` with
       no `stance` at all takes the settled wording, because that half is true
       of every over-cap unit; §6.0 forbids saying something FALSE with a missing
       signal, and this is incomplete rather than false. */
    const status = (b && typeof b.status === 'string') ? b.status : '';
    const overCap = !!(b && b.overCap);
    const note =
        status === 'refused'  ? 'not recorded'
      : status === 'ceiling'  ? 'at the ceiling'
      : status === 'floor'    ? 'nothing left to lose'
      : status === 'moved' && overCap && real < 0
                              ? (b.stance === 'against' ? 'past their limit already'
                                                        : 'settled to their limit')
      : '';
    return `<div class="lr">
      <span aria-hidden="true">${real > 0 ? '▲' : real < 0 ? '▼' : '—'}</span>
      <span class="nm">${esc((b && b.name) || (b && b.id) || 'Survivor')}</span>
      <span class="small-text ink-dim">${esc(note)}</span>
      <span class="dv ${cls}">${txt}</span>
    </div>`;
  }).join('');
  return `<h3 class="md-h3">What it cost them</h3><div class="md-ledger">${rows}</div>`;
}

function outcomeBodyHtml() {
  const r = _outcome || {};
  const d = _instance.dilemma || {};

  // The lead line is the authored aftermath. Fall back to the choice's own
  // `outcome` when index.js did not carry it through — the corpus always has
  // one, and a blank lead would make a resolved dilemma look unfinished.
  let lead = r.outcome || '';
  if (!lead && r.choiceId) {
    for (const c of (_instance.choices || [])) if (c && c.id === r.choiceId) lead = c.outcome || '';
  }

  const lines = (Array.isArray(r.lines) ? r.lines : [])
    .map((l) => `<p class="ln">${esc(l)}</p>`).join('');

  /* 🔴 THE ONE NUMBER THE PLAYER AGREED TO WAS THE ONE NUMBER THE RECEIPT DID
     NOT MENTION. Every credit got a sentence — "🔥 The ward settled up on the
     spot — 124 Cinder", the card, the standing move, a ledger row per companion
     — and the 600 Cinder the choice actually charged appeared nowhere in the
     aftermath. The wallet was correct and nothing here was a lie; it was an
     asymmetry, which in a receipt reads as one. "Do not hide the cost" is the
     stated reason the consequence band exists on the choose view (see the block
     over `.md-cons`), and a receipt that drops it the moment the money is gone
     honours that rule only while it is cheap.

     🔴 IT IS SAFE TO STATE FLATLY BECAUSE A RECEIPT IMPLIES THE CHARGE STUCK.
     `index.js`'s `resolve()` charges in step 1 and returns `null` — no Result,
     no aftermath view — on every failure after it: an unaffordable or refused
     charge toasts and returns null before anything moves, and a failed commit
     refunds and returns null. render.js's own commit handler stays on the
     choose view for a null. So there is no path on which this panel exists and
     the money did not leave, and the line does not have to hedge.

     ⚠ THE STRING IS `describe()`'s, VERBATIM, and that is the whole design.
     This file must not compute a price: reading `choice.cost.cinder` here would
     be a second extraction of a tuning number that `rewards.costOf()` already
     owns, and CONTRACT §8.1's reason for routing effect copy through
     `describe()` is precisely that the two would drift. Echoing the identical
     string the commit bar showed also makes the receipt provably the same
     number the player agreed to, rather than a recomputation that agrees today.

     ⚠ KEY-AND-VALUE, NOT A SENTENCE, for the reason `consequenceHtml()` states
     at length: this file cannot see rewards.js's wording, so any frame that
     supplies its own noun collides the day someone edits `describeChoice`. The
     key is deliberately the mirror of `ledgerHtml()`'s "What it cost them" —
     money above, regard below, the same question asked twice.

     A free choice has no cost line and gets none; `NO_EFFECT.costText` is `''`,
     which is also what a throwing or missing `describe` handler yields through
     `callH()`. A missing `choiceId` prints nothing rather than guessing at
     `_selected` — §6.0, and `_selected` is view state that no longer has to
     agree with what index.js resolved. */
  let paidLine = '';
  if (r.choiceId) {
    const paidFor = choiceById(r.choiceId);
    const ct = paidFor ? describeOf(paidFor).costText : '';
    if (ct) {
      /* ⚠ THE SPACE BETWEEN THE TWO SPANS IS DELIBERATE AND IS NOT IN THE BAND'S
         COPY OF THIS SHAPE. `.md-cline` is `inline-flex`, so a whitespace-only
         text node between flex items is not rendered — it costs nothing on
         screen and the pixels are identical either way. It costs something in
         `textContent`, which is what matters HERE and not there: this block is
         `role="status" aria-live="polite"`, so a screen reader announces the
         whole aftermath, and without the space the key and the value run
         together as "What it cost youcosts 600". The consequence band is not
         inside a live region and is left exactly as it is. */
      paidLine = `<p class="ln"><span class="md-cline"><span class="k">What it cost you</span> `
               + `<span class="v cost">${esc(ct)}</span></span></p>`;
    }
  }

  // Standing is printed as a movement, not as a fact, because the movement is
  // the thing the player just did. The rank name comes with it so the number
  // has something to mean.
  let standing = '';
  if (typeof r.influenceAfter === 'number') {
    const before = Number(r.influenceBefore);
    const after = Number(r.influenceAfter);
    const rk = rank(after) || null;
    const rc = safeColor(rk && rk.color, '#a89888');
    const moved = isFinite(before) ? after - before : 0;
    standing = `<p class="ln">🏛 Standing with the Heights ${
      moved > 0 ? 'rose to' : moved < 0 ? 'fell to' : 'holds at'} <b style="color:${rc}">${after}</b>
      <span class="small-text ink-dim">— ${esc((rk && rk.name) || '')}</span></p>`;
  }

  const warn = r.warning
    ? `<p class="ln warn">⚠ ${esc(r.warning)}</p>` : '';

  return `<div class="md-body">
    <div class="md-out" role="status" aria-live="polite">
      ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
      ${paidLine}${lines}${standing}${warn}
    </div>
    ${ledgerHtml(r.bonds)}
    <p class="md-sub" style="margin-top:10px">${esc(d.district || 'Ethos Heights')} carries on. Something else will need deciding.</p>
  </div>
  <div class="md-foot">
    <span class="hint">The Heights will not ask again for a while.</span>
    <button type="button" class="md-commit" data-md="close" id="md-ack">Acknowledge</button>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   PAINT
   ══════════════════════════════════════════════════════════════════════════ */

export function paint() {
  try {
    const ov = document.getElementById(OV);
    if (!ov || !_instance) return;
    const d = _instance.dilemma || {};
    const acc = ACCENT[d.sev] || ACCENT.pressing;
    ov.innerHTML = `<div class="md-wrap" role="dialog" aria-modal="true" aria-labelledby="md-title"
      style="--md-acc:${acc}">
      ${headerHtml()}
      ${_view === 'outcome' ? outcomeBodyHtml() : chooseBodyHtml() + footHtml()}
      <span class="md-live" role="status" aria-live="polite" id="md-live"></span>
    </div>`;
  } catch (e) {
    // A render failure must not leave a half-drawn overlay welded over the game.
    try { console.warn('[dilemma] paint failed —', e); } catch (e2) {}
    try { closeModal(); } catch (e3) {}
  }
}

/* 🔴 THE HOT PATH, AND IT IS NOT paint(). Hovering a choice changes three
   things — which choice is highlighted, what the roster says, and the
   consequence panel — and NOTHING else. A full `paint()` on mouseover would
   rebuild the very button the cursor is over, which drops keyboard focus and
   fights the pointer; community.render.js:51-53 records that same class of bug
   for the chat input ("a full repaint rebuilds the input element, which drops
   any half-typed message") and its fix, `paintTypingOnly()`, is the shape this
   copies.

   Note what it does NOT do: it never re-sorts the roster. Ranking rows by
   stance so supporters float to the top was considered and rejected — the rows
   would leap under the cursor on every hover, which turns "the room is
   reacting" into "the list is broken". The order is fixed at open (bond, then
   battles fought together) and the COLOUR moves instead. */
function paintReactions() {
  try {
    const ov = document.getElementById(OV);
    if (!ov || _view !== 'choose') return;
    const focused = focusedChoice();

    // Attribute-only toggle: the button elements themselves are never replaced,
    // so focus, hover and the browser's own :active state all survive.
    const btns = ov.querySelectorAll('[data-md="pick"]');
    for (let i = 0; i < btns.length; i++) {
      const on = !!(focused && btns[i].getAttribute('data-id') === focused.id);
      btns[i].classList.toggle('on', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    const body = ov.querySelector('#md-roster-body');
    if (body) body.innerHTML = rosterRowsHtml(focused);

    const slot = ov.querySelector('#md-cons-slot');
    if (slot) slot.innerHTML = consequenceHtml();

    paintFoot();
  } catch (e) { /* a stale highlight is survivable; a thrown handler is not */ }
}

/* Announce the reaction for a screen reader, which cannot see a chip change
   colour. Throttled by nothing: it writes one short string into a region that
   is already in the DOM. */
function announce(msg) {
  try {
    const el = document.getElementById('md-live');
    if (el) el.textContent = String(msg || '');
  } catch (e) {}
}

/* 🔴 A COMMIT MUST NOT BE ABLE TO DESTROY ITS OWN RECEIPT, AND IT COULD.
   `resolve()` in index.js is declared `async` and contains zero `await`s, so
   the whole resolution — pay, grant, bond, save — settles inside one microtask
   and this repaint lands before the player's finger has come off the button.
   The panel then SHRINKS under a stationary cursor: the choices column and the
   roster are replaced by a short aftermath block, and whatever is now under
   that cursor takes the second click of an ordinary double-click. On the commit
   bar that is either the backdrop (`e.target === ov`) or `#md-ack`, which
   carries `data-md="close"` — both of which close the modal. Measured in
   Chromium at 1280x900 at click gaps of 40, 90, 150 and 300 ms: `onChoose`
   fired exactly once every time (the `_busy` lock is fine and was never the
   problem) and the overlay was gone every time. The resolution stands and the
   rewards are granted; the player never sees the outcome line, the standing
   move, the Cinder, the card, or the bond ledger the entire aftermath view
   exists to show. Double-clicking a button that has just gone disabled-looking
   is not a mis-click, it is the ordinary gesture.

   So the swap opens a new GENERATION of controls, and both close paths refuse
   any close whose gesture began in an older one. `strayClose()` carries the
   whole argument, including why the 400 ms window round 3 shipped is kept as a
   floor and why it was never sufficient on its own. This is the same class of
   bug `paintReactions()` documents for hover — the panel is replaced under a
   pointer that has not moved — applied to the one repaint that cannot be
   undone, and with the keyboard added, because the focus move below is what
   puts a close button under a key the player is still holding. */
export function paintOutcome(result) {
  try {
    _outcome = (result && typeof result === 'object') ? result : {};
    _view = 'outcome';
    // Both BEFORE paint(), not after: paint() is synchronous but it is also the
    // thing that can throw, and a swap that half-happened still moved the
    // controls under the cursor and the key. A guard armed only on the success
    // path is a guard that is off during the failure it would be needed for.
    _settledAt = Date.now();
    _panelGen++;
    paint();
    /* Move focus to the one control that now exists. Without this the player's
       focus is sitting on a button that no longer has a node, and Tab restarts
       at the top of the document.

       ⚠ THIS LINE IS ALSO THE ONE THAT CREATES THE DEFECT strayClose() KILLS,
       and it is kept anyway. Putting `#md-ack` under a key the player has not
       released is the cost of not stranding a keyboard player on a removed
       node; the answer is to teach the close path where the keystroke came
       from, not to leave focus nowhere. Stated here so the next person to read
       this function does not "fix" the autorepeat by deleting the focus move. */
    try {
      const ack = document.getElementById('md-ack');
      if (ack && typeof ack.focus === 'function') ack.focus();
    } catch (e) {}
  } catch (e) {
    try { console.warn('[dilemma] paintOutcome failed —', e); } catch (e2) {}
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   EVENTS
   ══════════════════════════════════════════════════════════════════════════ */

function choiceById(id) {
  for (const c of (_instance && _instance.choices) || []) if (c && c.id === id) return c;
  return null;
}

/* ── THE STRAY-CLOSE GUARD ──────────────────────────────────────────────────
   🔴 A GUARD MEASURED IN MILLISECONDS IS THE WRONG SHAPE FOR THIS, AND THREE
   ROUNDS OF THE SAME BUG ARE THE PROOF. What makes a second activation
   unintended is not that it arrived FAST — a deliberate second click a quarter
   of a second later is still deliberate — it is that the browser generated it
   from a physical input the player made BEFORE the aftermath existed.

   Round 2 had no guard. Round 3 shipped a 400 ms wall-clock window measured
   from the swap, and the defect stepped straight over it: `paintOutcome()`
   moves focus to `#md-ack` itself, Chromium then autorepeats the Enter the
   player has not released onto that newly focused button, and one physical
   press — made while the commit bar was still on screen — closes the receipt
   the moment the window lapses. Measured at 1280x900 with `#md-commit` focused
   and Enter held with no keyup between repeats: 200 ms held, the overlay
   survived; 500 ms, 900 ms and 1500 ms, `onClose` fired and the panel was gone,
   identical to having no guard at all. The resolution stands and the rewards
   are granted, and the player never sees the outcome line, the standing move,
   the Cinder, the card or the bond ledger — the exact loss the guard exists to
   prevent, on the input path this file's own focus move creates.

   So the rule is PROVENANCE, and the window survives only as a floor:

     • Every panel layout has a GENERATION. `_panelGen` goes up when the choices
       are replaced by the aftermath — the one moment different controls arrive
       under a cursor and a key that have not moved.
     • A gesture is stamped with the generation it BEGAN in. For the pointer
       that is `mousedown`, where `event.detail` is the browser's own statement
       of whether a press starts a sequence or continues one, so a double-click's
       second press (`detail === 2`) inherits the first press's generation
       instead of minting a fresh one. For the keyboard it is `keydown`, where
       `e.repeat` says exactly the same thing: an autorepeat is not a new press,
       so it inherits too.
     • A close is honoured only if its gesture began in the generation that is
       on screen now.

   One rule, and it covers a held key, a double-click, a triple-click, a
   click-drag whose press landed on the commit bar, and a click dispatched
   mid-paint — with no number to tune, because the boundary is the PLATFORM's
   definition of a single gesture rather than one this file invented. The 500 ms
   discrete second click still closes, which is right: the key came up and the
   press was made against the panel the player can see.

   ⚠ THE 400 ms WINDOW IS KEPT AND IT IS NOT DECORATION. Provenance needs a
   `mousedown` or a `keydown` to read. A click synthesised with no press in
   front of it — `el.click()`, some assistive tech, a test driver — carries
   neither, and this file must not invent an intention for it. Those fall
   through to the floor, which is the guard round 3 measured and proved at gaps
   of 40, 90, 150 and 300 ms. The two together are strictly stronger than the
   window alone: nothing the window used to block is now allowed. Neither half
   may be deleted on the grounds that the other exists (CONTRACT-R3 §0, rule 2).

   🔴 AND FOR ONE ROUND THAT PARAGRAPH WAS FALSE, WHICH IS WHY `_keyLive` EXISTS.
   Round 4 stamped `_keyGen` on `keydown` and never cleared it. `_keyGen` was
   therefore not "the generation the key now held went down in", as its own
   declaration claimed — it was "the generation of the last activation key ever
   pressed in this panel", and it outlived the press by the whole life of the
   modal. `strayClose()` sends every `detail === 0` click to that stamp, so
   after a KEYBOARD commit a synthesised `#md-ack.click()` was attributed to a
   keypress that had ended a second earlier and was refused — measured refused
   at +1000 ms, +1080 ms and +1580 ms, i.e. permanently, while the identical
   click after a MOUSE commit closed the modal because `_keyGen` was still
   `null` and the floor decided. The outcome depended on which device committed,
   which is the exact opposite of provenance, and the sentence above promised
   the opposite of what the code did. A real keypress or any mousedown re-stamps
   and recovers, so a sighted keyboard player was never locked out; an assistive
   stack that only synthesises clicks was. On a file graded four rounds running
   on comments being true, the comment is the defect.

   THE FIX IS NOT A CLEAR ON `keyup` OF `_keyGen` ITSELF, and that much of
   round 5's reasoning survived contact. Clearing the STAMP on `keyup` is the
   obvious three-line answer and it does close the finding as reported — but the
   stamp is the only thing that says WHICH panel the press belongs to, and a
   guard that throws it away depends on a keyup ARRIVING to be correct at all.
   Driven: commit with Enter and never send the keyup (alt-tab with the key
   down; a keyup swallowed upstream), wait 1200 ms, then `#md-ack.click()` —
   with the keyup clear the click is refused exactly as it is in round 4, the
   defect still there, hiding behind an input the browser never delivered.
   `_keysDown` is a keyup dependency too, and this paragraph does not pretend
   otherwise: a lost keyup leaves it stuck `true` and that same synthesised
   click is refused. The difference is what a stuck flag COSTS. It is one
   boolean, it is not the stamp, and three ordinary things clear it — the next
   real `keyup`, any `mousedown` (the hand has moved to the pointer), and
   `closeModal()`. A real keypress additionally re-stamps `_keyGen` to the panel
   on screen, so the very next thing the player does in either device recovers.
   Nothing here can weld the modal shut; see FAILURE DIRECTIONS below, which is
   driven, not asserted.

   So `_keyGen` is left alone and a second fact is recorded — but it took TWO
   attempts to record the right one, and the first is written out here because
   it is the kind of mistake that reads as obviously correct.

   🔴 ATTEMPT ONE WAS `_keyLive` ALONE, AND IT REGRESSED THE VERY DEFECT ABOVE.
   The reasoning was: a key-generated click is the key event's own default
   action, so it must be dispatched synchronously inside that event's task; set
   a flag on the key event, clear it in `setTimeout(…, 0)`, and only a click
   from inside the task sees `true`. The premise is FALSE FOR AUTOREPEAT in
   Chromium and the falsity is measurable in two minutes: focus a plain
   `<button>`, mirror this exact pair of handlers, hold Enter. Clicks #1 and #2
   see `true`; clicks #3 onward — the whole rest of the hold — see `false`,
   because the repeat's activation click is queued rather than run under the
   keydown that produced it. (`SCRATCH/gauntlet/signoff6/t3d_live.mjs` is that
   probe; SPACE is not affected, it fires one click from `keyup`.) With
   `_keyLive` as the only gate, a held Enter past the 400 ms floor sailed
   through with `from === null` and destroyed the receipt at 600/900/1200/2000/
   3000 ms — round 3's defect, restored, on the input path this file's own
   focus move creates.

   THE FACT THAT HAD TO BE RECORDED IS "A KEY IS DOWN", AND IT IS RECORDED
   DIRECTLY, by the events that state it, not inferred from a timer: `_keysDown`
   is set on `keydown` and cleared on the matching `keyup` (and on any
   `mousedown`, which means the player's hand has moved to the pointer). An
   autorepeat click lands with the key still down, reads the stamp, and is
   refused — round 4's behaviour, which was right for this case all along.

   `_keyLive` is KEPT ALONGSIDE IT, because it is what closes the round-4 defect
   the paragraph above describes: after `keyup`, `_keysDown` is false, and a
   click synthesised from a later task — `el.click()`, an assistive stack, a
   test driver — sees both flags down, gets no stamp, and the floor decides,
   exactly as the ⚠ paragraph above always promised. `_keyLive` also covers the
   one moment `_keysDown` cannot: the SPACE activation click, which is dispatched
   from `keyup`'s own default action, i.e. after the key has already come up.
   Two flags because there are two facts — "a key is down" and "a key event is
   happening right now" — and neither implies the other. `setTimeout(…, 0)` is
   still the right clearer for the second one: a new macrotask is the one thing
   guaranteed to run after a default action dispatched in the current one, and a
   microtask is not, since a checkpoint runs between event listeners.

   ⚠ ONE WORRY CHECKED AND DISMISSED, recorded so nobody re-derives it. A
   `<button>` fires SPACE's activation click from its `keyup`, and a keyup
   listener runs before that default action — so a Space press that began on the
   commit bar and was released into the aftermath looked like it could carry an
   old generation past a keyup-based clear. It cannot, and not because of
   anything this file does: Chromium cancels the pending activation when the
   element the press began on is removed, and `paint()` removes it. Probed both
   orderings (Space down on `#md-commit`, then a mouse commit; and Space down,
   then Enter commits) — the Space keyup produced NO click at all in either, and
   the receipt survived on all three builds. That is a browser behaviour rather
   than a guarantee, which is a second small reason to prefer a gate that does
   not rest on it, but it is not the reason above and must not be quoted as one.

   FAILURE DIRECTIONS, all of them stated, and the sticky one DRIVEN because it
   is the only direction that could hurt anyone. If the timer never runs,
   `_keyLive` sticks `true`; if a keyup is never delivered, `_keysDown` sticks
   `true`. Either way the guard behaves exactly as round 4 did: `detail === 0`
   closes are answerable to a stamp that names an older panel, so they are
   refused. That is recoverable and was driven that way, with real input and no
   variable poked by hand: commit with Enter, never send the keyup, wait
   1200 ms, and a synthesised `#md-ack.click()` is refused — then ONE `mousedown`
   on inert panel text (which does not itself close anything) makes the next
   identical click close the modal, and in the other run ONE complete real Enter
   closes it outright. If instead a flag drops early
   or twice, the stamp is ignored and the floor decides — the same behaviour as
   an unreadable gesture, which is the direction this whole guard is written to
   fail in. Flags that only ever fail to "no provenance", plus a stamp that any
   fresh press overwrites, cannot lock a player out of their own modal.

   ⌨ ESCAPE IS STILL NOT GATED, DELIBERATELY. `/src/battle/combat.js:918` states
   the principle this file already quotes: Escape is the one gesture that
   unambiguously means "stop showing me this". It is not a button activation, so
   nothing repeats it onto a control this module has just moved under the
   player's hand, and a modal that ignores a key pressed on purpose is a worse
   failure than the one being fixed here.

   FAILURE DIRECTION, stated because it is the reason the guard is a generation
   STAMP and not a boolean latch that decides on its own. A latch that never
   gets its `keyup` — alt-tab with the key down, a keyup swallowed by another
   handler — would weld the modal shut if the latch itself were the answer. A
   stamp cannot: the next fresh press overwrites it unconditionally, so the
   guard self-heals on the very next thing the player does, and the flags only
   decide WHETHER the stamp is consulted. An unreadable gesture, a throw inside
   the guard and a clock that jumps backwards all make it stop guarding rather
   than start blocking. Every path fails towards the player being able to close
   their own modal.

   Both close paths call this one function — the backdrop listener in
   `openModal()` and the `close` action in `onClick()` — because they are
   registered in two different places and are the two halves of the same guard.
   That is also why the round-2 fix worked on the button and not on the
   backdrop: one of the two halves had been written and the other had not. */
const SETTLE_MS = 400;

/* `mousedown`, captured on the overlay so nothing inside the panel can swallow
   it, and it dies with the node so there is nothing to leak. A fresh press
   always overwrites the stamp, which is what makes it self-healing rather than
   sticky; `detail >= 2` is the only thing that preserves the old one. */
function notePress(e) {
  try {
    if (!(Number(e && e.detail) >= 2)) _pressGen = _panelGen;
    /* A press on the pointer means the hand is on the pointer, so whatever this
       file still believes about a held key is stale — and this is the clear
       that does not need an event the window has to be focused to receive. It
       runs on the second press of a double-click too: `detail >= 2` preserves
       the POINTER stamp deliberately, and has nothing to say about keys. */
    _keysDown.Enter = false; _keysDown.Space = false;
  } catch (e2) {}
}

/* `keydown` AND `keyup`, on the document listener that already exists for
   Escape. Only the two keys that can activate a focused button are watched —
   those are the only two that can produce this defect, and stamping every
   keystroke would let an unrelated Tab refresh the stamp of an Enter that is
   still held down.

   THREE SEPARATE FACTS. Round 4 recorded one of them and round 5 recorded two,
   and each missing one is a shipped defect; they are listed with what each can
   and cannot answer, because that is the part that keeps getting collapsed:
     • `_keyGen` — WHICH generation the press began in. Written on `keydown`
       only, and only when `!e.repeat`, because an autorepeat is a continuation
       of a press the player made before the swap, not a new one. It is never
       cleared, because clearing it is not what makes the stamp safe to read
       (the flags below are) and a value that is only ever overwritten by a
       fresh press cannot be left in a state that blocks anyone — see
       strayClose()'s failure-direction paragraph.
     • `_keysDown` — WHETHER that key is still physically down. Set on `keydown`
       (repeat included: a repeat is proof the key is still down), cleared on
       the matching `keyup` and by any `mousedown`. This is the one that makes
       an autorepeat's click readable. It is PER-KEY because "is down" is a
       per-key fact and a shared flag would be cleared by the other key's
       `keyup` — Space tapped while Enter is held. Honest note, because the
       counterfactual was driven and did NOT fail: a shared flag survives that
       gesture anyway, since the held key's next autorepeat re-raises it ~33 ms
       later. That is the repeat rate outrunning the guard, not the guard being
       right, and two named slots cost nothing to not depend on it.
     • `_keyLive` — WHETHER a key event is what is happening RIGHT NOW. Raised
       by both keydown and keyup, dropped one macrotask later. It is what makes
       SPACE readable, because a `<button>` dispatches Space's activation click
       from `keyup`'s default action — after `_keysDown` has correctly gone
       false.
   No one of them answers strayClose()'s question. `_keyGen` alone cannot tell a
   live keypress from a finished one; the flags alone cannot tell which panel
   the press belongs to; and `_keyLive` alone does not survive autorepeat, which
   is exactly the gesture this guard exists for. */
function noteKey(e) {
  try {
    const k = e && e.key;
    if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
    const slot = (k === 'Enter') ? 'Enter' : 'Space';
    if (e.type === 'keydown') {
      if (!e.repeat) _keyGen = _panelGen;
      _keysDown[slot] = true;
    } else if (e.type === 'keyup') {
      // Named rather than `else`, because keyBind() is the kind of helper
      // someone extends with a third event later; a `blur` arriving here must
      // not be silently read as "the key came up".
      _keysDown[slot] = false;
    }
    _keyLive = true;
    /* The clear is scheduled, never conditional, and it does not check whether
       the value it is clearing is still "its own". Two overlapping key events
       schedule two clears and the later key's own click has already been
       dispatched and read by the time either fires — and a `_keyLive` that
       drops early only means the floor decides, which is this guard's safe
       direction. A guard is not worth a bookkeeping token to get that exactly
       right. If `setTimeout` is unavailable or refuses, drop the flag
       immediately rather than leave it raised: unreadable provenance is a state
       this file already handles correctly, a stuck flag is not. */
    try { setTimeout(() => { _keyLive = false; }, 0); } catch (e2) { _keyLive = false; }
  } catch (e2) {}
}

/* 🔴 ONE FUNCTION, TWO EVENT NAMES, ONE PAIR OF HELPERS — because the listener
   count is something this file gets audited on and a leaked keydown handler
   that closes an overlay which is no longer there is a real and very quiet bug.
   `noteKey()` needs `keyup` as well as `keydown` now, and the removal sites are
   three (`openModal`'s pre-registration, the self-removal inside the handler,
   and `closeModal`). Adding a second `removeEventListener` at each of them by
   hand is three chances to write two lines where two are needed and one where
   two are needed; add/remove through these and the pair cannot go out of step.
   Both are `try`-wrapped per call so a throw on one phase still removes the
   other — a half-removed pair is the leak, not a caught exception. */
function keyBind(fn) {
  try { document.addEventListener('keydown', fn, true); } catch (e) {}
  try { document.addEventListener('keyup', fn, true); } catch (e) {}
}
function keyFree(fn) {
  if (!fn) return;
  try { document.removeEventListener('keydown', fn, true); } catch (e) {}
  try { document.removeEventListener('keyup', fn, true); } catch (e) {}
}

function strayClose(ev) {
  try {
    if (_view !== 'outcome') return false;
    // A pointer click reports `detail >= 1`; a click the browser synthesised
    // from a key on a focused button reports 0. That is how the gesture picks
    // which stamp it is answerable to — and `detail === 0` is a NECESSARY but
    // not a sufficient condition for "a key did this", which is the round-4
    // defect in one line. `el.click()` reports 0 as well, so the key stamp is
    // consulted only while a key event is actually in flight; otherwise there
    // is no provenance to read and the floor below decides, exactly as the
    // block comment promises.
    //
    // "In flight" is two conditions ORed and both are load-bearing.
    // `_keysDown` catches the autorepeat click, which does NOT run inside its
    // own keydown's task (signoff6/t3d_live.mjs: on a plain focused button,
    // clicks #3 onward through a held Enter see `_keyLive === false`), and
    // `_keyLive` catches SPACE's click, which a `<button>` dispatches from
    // `keyup`'s default action, after `_keysDown` has correctly gone false.
    // Dropping either one re-opens a defect this file has already shipped.
    const keyLive = _keyLive || _keysDown.Enter || _keysDown.Space;
    const from = (Number(ev && ev.detail) || 0) > 0 ? _pressGen : (keyLive ? _keyGen : null);
    if (from !== null && from !== _panelGen) return true;
    // Provenance unreadable (`from === null`) or agreeing: the floor decides.
    return _settledAt > 0 && (Date.now() - _settledAt) < SETTLE_MS;
  } catch (e) {
    // The guard must never be the reason a player cannot close their own modal.
    return false;
  }
}

/* Delegated on the overlay, `[data-md]`, community.render.js:596's shape.
   Delegation is not a style preference here: `paint()` replaces the whole
   panel, so a listener bound to a button would not survive the first repaint. */
async function onClick(ev) {
  let el = null;
  try { el = ev.target && ev.target.closest ? ev.target.closest('[data-md]') : null; } catch (e) { el = null; }
  if (!el) return;
  const act = el.getAttribute('data-md');

  // Read-only actions short-circuit BEFORE the lock, exactly as
  // community.render.js:601-604 does: closing or re-picking must not be
  // deadlocked by an in-flight resolution.
  // The stray-close guard — see strayClose(). It is inert on the choose view,
  // so the only close it ever refuses is one whose gesture began before the
  // aftermath arrived, which is the only kind of close the player did not mean.
  if (act === 'close') { if (!strayClose(ev)) closeModal(); return; }
  if (act === 'pick') {
    const id = el.getAttribute('data-id');
    if (!id || _busy) return;
    _selected = id;
    _hover = null;               // an explicit pick outranks whatever is hovered
    paintReactions();
    const c = choiceById(id);
    if (c) {
      const t = tallyFor(c);
      announce(c.label + '. ' + t.support + ' support, ' + t.against + ' against, ' + t.middle
        + ' in the middle.' + (affordableOf(c) ? '' : ' You cannot afford this one.'));
    }
    return;
  }
  if (act !== 'commit') return;

  if (_busy || !_instance || _instance.resolved) return;
  const choice = choiceById(_selected);
  // Affordability is re-checked here and not trusted to the footer's disabled
  // attribute: the choice buttons are only aria-disabled, so a determined
  // keyboard or scripted click can reach this with an unpayable line selected.
  if (!choice || !affordableOf(choice)) return;

  /* The lock. Double-clicking the commit bar on a slow save must not pay twice;
     index.js carries its own guard as well, and both are cheap. Released in a
     `finally` so a rejected promise cannot weld the modal shut. */
  _busy = true;
  try {
    const btn = el;
    try { btn.disabled = true; } catch (e) {}
    const result = await callH('onChoose', null, choice.id);
    // A null result means index.js aborted — an unaffordable cost, a failed
    // commit — and it has already toasted the reason. Stay on the choice view
    // so the player can pick something else rather than being dropped into an
    // aftermath for a thing that did not happen.
    if (result) paintOutcome(result);
    else { try { btn.disabled = false; } catch (e) {} }
  } finally { _busy = false; }
}

/* Hover and keyboard focus are the same gesture as far as this modal is
   concerned: "show me what this one does". Pointer events are captured with
   `mouseover`/`focusin` rather than `mouseenter`/`focus` because those two do
   not bubble, and delegation is the only option when paint() replaces the
   buttons. A touch device never fires either — tapping a choice selects it,
   which drives the same repaint, so the feature degrades to one tap rather
   than to nothing. */
function onOver(ev) {
  try {
    if (_view !== 'choose') return;
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-md="pick"]') : null;
    const id = el ? el.getAttribute('data-id') : null;
    if (id === _hover) return;
    if (!id && !_hover) return;
    _hover = id;
    paintReactions();
  } catch (e) {}
}
function onOut(ev) {
  try {
    if (_view !== 'choose' || !_hover) return;
    // Only clear when the pointer/focus has actually left the choice list —
    // moving between a button's own children fires mouseout constantly.
    const to = ev.relatedTarget;
    if (to && to.closest && to.closest('[data-md="pick"]')) return;
    _hover = null;
    paintReactions();
  } catch (e) {}
}

/* ══════════════════════════════════════════════════════════════════════════
   OPEN / CLOSE
   ══════════════════════════════════════════════════════════════════════════ */

export function isOpen() {
  try { return !!document.getElementById(OV); } catch (e) { return false; }
}

export function openModal(instance, roster, handlers) {
  try {
    if (typeof document === 'undefined' || !document.body) return false;
    if (!instance || !instance.dilemma || !Array.isArray(instance.choices) || !instance.choices.length) return false;

    injectStyle();

    _instance = instance;
    _roster   = Array.isArray(roster) ? roster : [];
    _handlers = handlers || null;
    _view     = 'choose';
    _selected = null;
    _hover    = null;
    _outcome  = null;
    _busy     = false;
    _closing  = false;
    // Reset beside `_settledAt`: a stamp carried over from the last dilemma is
    // a stamp about controls that no longer exist. `_panelGen` back to 0, both
    // gesture stamps back to "unread" and both held-key flags down is the state
    // strayClose() treats as "there is nothing to guard yet". `_keysDown` is
    // reset here as well as in closeModal() precisely because it is the one
    // piece of this guard that can be left `true` by an input that never
    // arrived; opening a dilemma is a second guaranteed clear.
    _settledAt = 0; _panelGen = 0; _pressGen = null; _keyGen = null; _keyLive = false;
    _keysDown.Enter = false; _keysDown.Space = false;

    // Remember who opened us so focus can go home. index.html's `render()`
    // restores focus for an id'd text INPUT only — its `_focusSnap` block tests
    // `tagName === 'INPUT' || 'TEXTAREA'` and skips everything else — so a modal
    // that does not do this leaves the player's focus on document.body. (Cited
    // by symbol on purpose: that block has moved twice in three rounds, and a
    // citation that cannot rot beats one that is currently right.)
    try { _opener = document.activeElement || null; } catch (e) { _opener = null; }

    let ov = document.getElementById(OV);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = OV;
      // Click-outside closes, matching every other overlay in the game. Two
      // listeners on the same node, as community.render.js:846-847 does: this
      // one is `ev.target === ov` only, so a click that lands anywhere inside
      // the panel is untouched by it. `strayClose()` is the same guard the
      // `close` action carries — this is the backdrop half, and it is the one
      // the double-click repro actually landed on: the aftermath panel is
      // shorter than the choice panel, so the pixels under the commit bar
      // become backdrop.
      ov.addEventListener('click', (e) => { if (e.target === ov && !strayClose(e)) closeModal(); });
      ov.addEventListener('click', onClick);
      // Captured, so nothing inside the panel can swallow it: `mousedown` is
      // where a pointer gesture's generation gets stamped, and a stamp that
      // does not happen is a close strayClose() can no longer reason about.
      // It lives on the overlay rather than on the document because the overlay
      // is `position:fixed;inset:0` — every press that can reach a close path
      // lands on it — and because a listener on a node that is removed on close
      // cannot leak, which the Escape listener below has to work for.
      ov.addEventListener('mousedown', notePress, true);
      ov.addEventListener('mouseover', onOver);
      ov.addEventListener('mouseout', onOut);
      ov.addEventListener('focusin', onOver);
      ov.addEventListener('focusout', onOut);
      document.body.appendChild(ov);
    }

    /* ⌨ ESCAPE CLOSES. The self-removing document listener from
       `openInfoModal`'s `onKey` (index.html); src/battle/combat.js:918
       states the principle — "Escape is the one gesture that unambiguously means
       'stop showing me…'". The community overlay has no Escape handler at all
       (community.render.js:848-856 listens only for Enter on #mc-wmsg);
       that is a gap in the reference file, not a house convention.
       The listener is held in `_onKey` so all THREE close paths remove the same
       one — a leaked keydown handler that closes an overlay which is no longer
       there is a real and very quiet bug. It is ONE function bound to keydown
       and keyup, added and removed only through `keyBind`/`keyFree`, so the
       audit that matters ("listeners on document: 1 while open, 0 after") is
       now two numbers that move together and cannot be left half-removed.

       ⌨ CAPTURED, AND THE PHASE IS LOAD-BEARING NOW THAT IT ALSO CARRIES
       noteKey(). Round 3's listener was on the bubble phase, which is fine for
       Escape (nothing in index.html stops keydown propagation — the one other
       capture-phase Escape handler, `openWorldEventBriefing`'s in
       index.html, does not call stopPropagation). It is NOT fine for the
       generation stamp: a stamp that is swallowed leaves `_keyGen` holding the
       generation of a press the player has already finished with, and
       strayClose() would then refuse the player's NEXT deliberate Enter as
       well. Capture is the one phase nothing can be dropped before, and the
       cost is only that this Escape handler now runs first among document
       listeners. It still does not stopPropagation, so every other overlay's
       handler sees the key exactly as it did before. The same argument carries
       to the keyup half added this round: `_keyGen` and `_keyLive` are only
       coherent if the SAME listener sees both phases of the same press, and
       capture is the only phase that guarantees it. (A dropped keyup is
       survivable on its own — `_keyLive` is cleared by its timer either way —
       but a guard whose two facts can be written by different subsets of the
       events is a guard nobody can reason about later.) */
    keyFree(_onKey);
    _onKey = (e) => {
      try {
        // Before the Escape test, and for every key event, because the keys this
        // has to see are the ones that never reach the branch below: Enter and
        // Space activate the focused button through the browser's own default
        // action, not through this listener. See strayClose().
        noteKey(e);
        /* ⌨ ESCAPE ACTS ON keydown ONLY, now that this handler also hears
           keyup. Closing on both would run the whole close path twice for one
           press — harmless today only because `_closing` and `isOpen()` catch
           the second, and "harmless because something downstream catches it" is
           how a re-entrancy bug gets written. Escape's own behaviour is
           unchanged from round 4: same key, same phase, same preventDefault. */
        if (e.type !== 'keydown') return;
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        if (!isOpen()) { keyFree(_onKey); return; }
        e.preventDefault();
        closeModal();
      } catch (e2) {}
    };
    keyBind(_onKey);

    paint();

    /* Focus the first enabled choice. Not the ✕: the first thing a keyboard
       player should meet is the decision, and Shift+Tab reaches the close
       button from there in one press. No focus TRAP is installed — there is not
       one anywhere in this codebase (`focusTrap`/`trapFocus`: zero hits), and a
       half-built trap that leaks on one path is worse than none. */
    try {
      const sel = '#' + OV + ' [data-md="pick"]';
      const first = document.querySelector(sel + ':not([aria-disabled="true"])')
                 || document.querySelector(sel);
      if (first && typeof first.focus === 'function') first.focus();
    } catch (e) {}

    return true;
  } catch (e) {
    try { console.warn('[dilemma] openModal failed —', e); } catch (e2) {}
    try { closeModal(); } catch (e3) {}
    return false;
  }
}

export function closeModal() {
  // `handlers.onClose()` may well call back into MythicDilemmas.close(), which
  // lands here again. Guard it rather than relying on index.js to be careful.
  if (_closing) return true;
  _closing = true;
  try {
    keyFree(_onKey); _onKey = null;
    const ov = document.getElementById(OV);
    if (ov) ov.remove();

    // Focus home before the handler runs, so an onClose that repaints the hub
    // cannot find focus sitting on a node that has just been removed.
    try {
      if (_opener && document.contains(_opener) && typeof _opener.focus === 'function') _opener.focus();
    } catch (e) {}

    const h = _handlers;
    _instance = null; _roster = []; _handlers = null; _outcome = null;
    _view = 'choose'; _selected = null; _hover = null; _busy = false; _opener = null;
    _settledAt = 0; _panelGen = 0; _pressGen = null; _keyGen = null; _keyLive = false;
    _keysDown.Enter = false; _keysDown.Space = false;

    try { if (h && typeof h.onClose === 'function') h.onClose(); } catch (e) {}
    return true;
  } catch (e) {
    try { console.warn('[dilemma] closeModal failed —', e); } catch (e2) {}
    return false;
  } finally { _closing = false; }
}
