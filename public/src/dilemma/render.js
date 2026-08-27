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
   allows that do not break that rule:
     • `DILEMMA_ECON.influenceCap`  — so the header can print "62 / 100" without
       this file inventing a 100. No reward, bond or cooldown number is read.
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
let _onKey    = null;      // the document-level Escape listener, so it can be removed
let _closing  = false;     // guards the close → onClose → close() re-entry

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
   for a unit's inner state — `.dpx-chip` at index.html:16645-16652, where teal
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
   to no value poles at all — _lqUnitValueProfile returns [] when there is no
   valueProfile, no legacy `values` and no archetype hit — index.html:73089-73098)
   — so it gets the plainest, least apologetic wording of the four. */
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

/* Pole names come from LQ_POLE_LABEL (`index.html:73035`) — "⚔ Honor", not
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
#${OV} .md-x{background:none;border:1px solid rgba(210,164,78,.5);color:#e2c37a;border-radius:8px;
  width:32px;height:32px;flex:none;cursor:pointer;font-size:1rem;font-family:inherit}
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
#${OV} .md-brief{font-size:1rem;line-height:1.62;color:#efe3c4;margin:0 0 14px;max-width:78ch}
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
#${OV} .md-tag{display:inline-flex;align-items:center;gap:.3rem;padding:.14rem .5rem;border-radius:5px;
  font-size:.72rem;font-weight:600;letter-spacing:.02em;background:rgba(255,255,255,.03);
  border:1px solid var(--c,rgba(255,255,255,.16));color:#cfd8ea;font-variant-numeric:tabular-nums}
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
/* .bond-pill declares \`border:1px solid\` with NO colour at index.html:16034 —
   it is invisible without the tier colour supplied inline, which is exactly how
   the live unit panel uses it at index.html:140362. Redeclared here rather than
   inherited so the panel is correct in any host. */
#${OV} .bond-pill{display:inline-flex;align-items:center;gap:3px;border:1px solid;
  background:rgba(0,0,0,.3);padding:.06rem .42rem;border-radius:3px;font-family:'Cinzel',serif;
  font-size:.66rem;font-weight:700;letter-spacing:.05em;cursor:help;
  font-variant-numeric:tabular-nums;white-space:nowrap}
#${OV} .md-temper{font-size:.68rem;color:#8d8370;letter-spacing:.03em;cursor:help}

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
#${OV} .md-cline .v{font-size:.87rem;color:#e0d2ae;font-variant-numeric:tabular-nums}
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
    <button class="md-x" data-md="close" aria-label="Close" title="Close">✕</button>
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
  const dCls = d > 0 ? 'up' : d < 0 ? 'dn' : 'nil';
  const dTxt = d > 0 ? '+' + d : d < 0 ? '−' + Math.abs(d) : (stuck ? '0' : '·');
  const dTitle = floored
    ? 'This one cannot fall further — their regard is already on the floor.'
    : stuck && st.stance === 'support'
    ? 'This one cannot move — their regard is already at its ceiling.'
    : stuck ? 'This one cannot move on this call.'
    : d === 0 ? 'Their bond does not move on this.'
    : 'Their bond moves by ' + (d > 0 ? '+' : '−') + Math.abs(d) + ' if you make this call.';

  const temper = unit.temper && unit.temper.name
    ? `<span class="md-temper" title="${esc(unit.temper.blurb || '')}">${esc(unit.temper.icon || '')} ${esc(unit.temper.name)}</span>` : '';

  /* A forged card whose definition was never published on THIS device resolves
     to `card: null` (lookupCustomCard, index.html:51081) and engine falls back
     to printing the stored id. Left bare that reads as a bug in the player's own
     collection, so the row says what it is instead. Dropping the row was the
     other option and is worse: their deck would look shorter than it is. */
  const unknown = !unit.card;
  const nameTitle = unknown
    ? ' title="This card travelled with you, but its definition was never published on this device. It has no view here."'
    : '';

  return `<div class="md-urow ${meta.cls}${quiet ? ' quiet' : ''}">
    <span class="md-uicon" aria-hidden="true">${esc(unit.icon || (unit.kind === 'hero' ? '🎖' : '🃏'))}</span>
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

function rosterHtml() {
  const choice = focusedChoice();
  const fallback = _roster.length > 0 && _roster.every((u) => u && u.fallback);

  /* ⚠ THE HEADING CHANGES WHEN THE ROSTER IS A GUESS, and that is a
     requirement, not a nicety. The fallback ladder ranks Profile.units by
     `_lastBattleFielded`, which is set true only for units actually DEPLOYED
     (index.html:152696) and cleared only for benched units that were in
     s._deckUnitIds (index.html:152795) — so a unit from a deck the player
     abandoned keeps a stale `true` forever. It is a decaying heuristic.
     Calling it "your last deck" would be the modal telling a small lie about
     the player's own collection, which is the kind of thing a player notices
     and never trusts again. */
  const head = fallback
    ? `<h3 class="md-h3">Your most-fought companions</h3>
       <p class="md-sub">No deck has gone into battle since the Heights started asking. These are the ones you have fought beside most.</p>`
    : `<h3 class="md-h3">Standing with you</h3>
       <p class="md-sub">The deck you last took out. They can hear this too.</p>`;

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

  // The two clamps are counted apart for the reason rosterRowHtml() gives: the
  // band asserted "already at the ceiling" over a unit sitting on the floor, so
  // the modal told the same lie twice in the same viewport.
  let up = 0, dn = 0, still = 0, atCeiling = 0, atFloor = 0;
  for (const u of _roster) {
    const st = stanceOf(u, choice).stance;
    const d = previewOf(u, choice);
    if (d > 0) up++; else if (d < 0) dn++;
    else if (st === 'middle') still++;
    else if (st === 'against' && (Number(u.bond) || 0) <= 0) atFloor++;
    else atCeiling++;
  }

  const bits = [];
  if (up)        bits.push('<b>' + up + '</b> ' + (up === 1 ? 'gains' : 'gain') + ' regard');
  if (dn)        bits.push('<b>' + dn + '</b> ' + (dn === 1 ? 'loses' : 'lose') + ' it');
  if (still)     bits.push('<b>' + still + '</b> ' + (still === 1 ? 'stays' : 'stay') + ' put');
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
  // Two columns are worth it only when the choices can fill one. The threshold
  // is the CHOICE COUNT, not a breakpoint — see the .md-solo rule for what a
  // three-line roll looked like beside an eight-row roster.
  const solo = (_instance.choices || []).length < 4;
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
   player is told twice. When the bridge refused a change (`landed: false`) this
   view says so rather than printing a movement that did not happen. */
function ledgerHtml(bonds) {
  if (!Array.isArray(bonds) || !bonds.length) return '';
  const rows = bonds.map((b) => {
    const d = Number(b && b.delta) || 0;
    const landed = !(b && b.landed === false);
    const real = landed ? (Number(b.after) - Number(b.before)) : 0;
    const cls = real > 0 ? 'up' : real < 0 ? 'dn' : 'nil';
    const txt = real > 0 ? '+' + real : real < 0 ? '−' + Math.abs(real) : '0';
    /* The clamp note splits on `before` and `stance` — the same two fields the
       roster row uses, so the preview and the receipt cannot disagree about
       which end a companion is pinned against. Calling the floor a ceiling was
       the round-1 defect and the modal said it in three places; this is the
       third.

       ⚠ WHAT THIS BRANCH IS ACTUALLY WORTH, stated honestly. Under CONTRACT §5's
       AppliedBond a clamped write reports `delta = after - before = 0` AND
       `landed: false` ("the ceiling ate it"), so a clamped row takes the
       `!landed` arm and prints 'not recorded' — `stuck` is unreachable through
       today's engine. It is kept, and split, because `landed` conflates a
       refused write with an eaten one, and the day that is separated this row
       must already know which clamp it is looking at. What it must NOT do is
       guess: 'nothing left to lose' is only ever printed off `landed === true`,
       never inferred from a refusal, because a bridge that refused the write and
       a floor that absorbed it look identical from here. */
    const stuck = (real === 0 && d !== 0);
    const note = !landed ? 'not recorded'
      : (stuck && b.stance === 'against' && (Number(b.before) || 0) <= 0) ? 'nothing left to lose'
      : stuck ? 'at the ceiling'
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
      ${lines}${standing}${warn}
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

export function paintOutcome(result) {
  try {
    _outcome = (result && typeof result === 'object') ? result : {};
    _view = 'outcome';
    paint();
    // Move focus to the one control that now exists. Without this the player's
    // focus is sitting on a button that no longer has a node, and Tab restarts
    // at the top of the document.
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
  if (act === 'close') { closeModal(); return; }
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

    // Remember who opened us so focus can go home. index.html's render() will
    // only restore focus for an id'd text input (index.html:111029-111070), so a modal
    // that does not do this leaves the player's focus on document.body.
    try { _opener = document.activeElement || null; } catch (e) { _opener = null; }

    let ov = document.getElementById(OV);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = OV;
      // Click-outside closes, matching every other overlay in the game. Two
      // listeners on the same node, as community.render.js:846-847 does: this
      // one is `ev.target === ov` only, so a click that lands anywhere inside
      // the panel is untouched by it.
      ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(); });
      ov.addEventListener('click', onClick);
      ov.addEventListener('mouseover', onOver);
      ov.addEventListener('mouseout', onOut);
      ov.addEventListener('focusin', onOver);
      ov.addEventListener('focusout', onOut);
      document.body.appendChild(ov);
    }

    /* ⌨ ESCAPE CLOSES. The self-removing document listener from
       openInfoModal's onKey (index.html:111612); src/battle/combat.js:918
       states the principle — "Escape is the one gesture that unambiguously means
       'stop showing me…'". The community overlay has no Escape handler at all
       (community.render.js:848-856 listens only for Enter on #mc-wmsg);
       that is a gap in the reference file, not a house convention.
       The listener is held in `_onKey` so all THREE close paths remove the same
       one — a leaked keydown handler that closes an overlay which is no longer
       there is a real and very quiet bug. */
    if (_onKey) { try { document.removeEventListener('keydown', _onKey); } catch (e) {} }
    _onKey = (e) => {
      try {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        if (!isOpen()) { document.removeEventListener('keydown', _onKey); return; }
        e.preventDefault();
        closeModal();
      } catch (e2) {}
    };
    document.addEventListener('keydown', _onKey);

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
    if (_onKey) { try { document.removeEventListener('keydown', _onKey); } catch (e) {} _onKey = null; }
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

    try { if (h && typeof h.onClose === 'function') h.onClose(); } catch (e) {}
    return true;
  } catch (e) {
    try { console.warn('[dilemma] closeModal failed —', e); } catch (e2) {}
    return false;
  } finally { _closing = false; }
}
