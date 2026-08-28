/* ════════════════════════════════════════════════════════════════════════════
   🚛 TRANSPORT UI — the Depot, the Fleet and the Freight Exchange rate board.
   ----------------------------------------------------------------------------
   Three rules drive every choice in this file:

     1. IT IS A PURE STRING BUILDER. Every export takes the `view` object and
        returns HTML. No DOM, no listeners, no fetch, no clock, no globals. The
        whole reason this is a separate file from index.js is that a renderer
        which also reads state is a renderer nobody can test with a literal.

     2. A REFUSED OR STOPPED THING SAYS WHY, IN THE PANEL, IN WORDS — with a
        `fix` naming the concrete thing to go do. This is production.render.js's
        second rule and it is here verbatim because this project has shipped the
        opposite twice: an invisible halt reads as a bug, and a blank panel
        where "not set up yet" belongs reads as a dead feature. Every state the
        rest of the feature can produce has a banner below.

     3. NOTHING IN HERE MAY THROW. index.js calls renderTransport() from paint(),
        which runs on open and after every click. It has its own last-ditch
        fallback (fallbackHtml), but a throw from here costs the player the whole
        overlay, so each section is wrapped independently: a rate board that
        cannot draw must not take the depot card down with it. That is the same
        per-leg philosophy as index.js's refresh().

   🔴 THE GLOBALS TRAP — the reason this file reads NOTHING but its argument.
   `Profile`, `Cloud`, `App`, `Corp`, `Forge`, `RESOURCES`, `showToast`,
   `escapeHtml` and `root` are top-level `const`/`function` declarations in
   index.html. Those are global LEXICAL bindings; they are NOT properties of the
   global object, so an ES module cannot see them and `window.Profile` is
   undefined even though `const Profile` exists. CLAUDE.md records this costing
   real time twice (FoundationReserve and Profile, both in the Node City bridge).
   index.js hands this file a plain `view` object and gets a string back. There
   is no seam here to reach around, by construction.

   📎 HOW THE CITATIONS IN THIS FILE ARE WRITTEN, AND THE BUG THAT SET THE RULE.
   Comments here point at other files by SYMBOL first and line number second —
   `index.js's selection()`, `index.html's _garageRig()` (164476). An earlier
   revision of this file cited three of them by line alone and every one had
   drifted by roughly 230 lines, which is worse than citing nothing: a confident
   wrong pointer costs the next reader the search AND the trust. The symbol is
   the address; the number is a hint. The same rule applies to claims ABOUT the
   caller — this file now asserts no upstream guarantee it does not itself
   enforce, which is a rule it learned the hard way in clip().

   ⛔ NO IMAGE OR VIDEO SURFACE ANYWHERE, and no image element whose source
   is bound to text that came from another player. Hosting user-supplied media
   carries a legal obligation this project has ruled out (CLAUDE.md, Out of
   scope). Everything drawn here is emoji, CSS and escaped text — nothing in
   this file fetches anything.
   ════════════════════════════════════════════════════════════════════════════ */

/* 🚚 MERIDIAN HAULAGE constants, read from routes.js because routes.js OWNS
   them: `MERIDIAN_TARIFF_MULT` is literally the number every player tariff is
   clamped to (routes.js tariffCap/quote), so a second copy of 2.5 in this file
   is a rate board advertising a ceiling the pricing code does not enforce. The
   rubric's "two ladders" failure, exactly.

   ⚠ WHY A NAMESPACE IMPORT AND NOT `import { MERIDIAN_TARIFF_MULT }`:
   a named import of a binding another module later renames is a LINK error —
   the module graph fails before a single line runs, and index.js's whole panel
   dies at load with a console message the player never sees. A namespace import
   cannot fail that way; a missing name is just `undefined`, which falls through
   to the ratified literal below and prints slightly stale copy instead of
   killing the feature. index.js already imports routes.js, so this adds no new
   failure mode of its own — only a milder one.

   The literals are the fallback ONLY. They are the owner-ratified design
   numbers ("2.5× the median player tariff, 1.6× trip time, no escort, no
   illicit freight") and if routes.js ever moves them without this file being
   able to read them, this copy is what goes stale — pass them on the carrier
   row (`tariffMult` / `timeMult`) and this fallback stops mattering. */
import * as ROUTES from './routes.js';

const MERIDIAN_ID   = pick(() => ROUTES.MERIDIAN.id, 'meridian');
const MERIDIAN_NAME = pick(() => ROUTES.MERIDIAN.name, 'Meridian Haulage');
const TARIFF_MULT   = pick(() => ROUTES.MERIDIAN_TARIFF_MULT, 2.5);
const TIME_MULT     = pick(() => ROUTES.MERIDIAN_TIME_MULT, 1.6);

function pick(fn, fallback) {
  try { const v = fn(); return (v === undefined || v === null || v === '') ? fallback : v; }
  catch (e) { return fallback; }
}

/* ── the escaper ────────────────────────────────────────────────────────────
   `esc` is defined HERE, locally, and is not imported from the legacy app or
   from a shared helper module, for one reason: every single render path in this
   file needs it, and it must never be the thing that stops the module loading.
   index.html's `escapeHtml` is a lexical const (see the globals trap above) and
   is therefore unreachable; a shared `/src/util/esc.js` would put one more
   fetch between the player and a panel whose entire job is to be the legible
   fallback when something else has already failed. Four characters of
   duplication buys a module with one dependency.

   The single quote is escaped as well as the double, because attribute values
   below are written with double quotes today and a future edit to single quotes
   would otherwise silently open every one of them. */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/* 🔒 COLOUR IS NOT TEXT. `rarityColor` arrives from the bridge's rarity table
   and lands inside `style="color:…"`. esc() stops the value breaking OUT of the
   attribute (the quote is encoded), but it does NOT stop it staying inside and
   adding declarations — `#fff;position:fixed;inset:0` is a valid CSS colour
   followed by a valid overlay. So the value is WHITELISTED to a hex literal
   rather than escaped, and anything else falls back to the neutral text colour.
   Limits, stated: this is a shape check, not a claim that the rarity table is
   trustworthy. It is here because a colour is the one player-adjacent string in
   this file that is not printed as text. */
const HEXCOLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const safeColor = (c, fallback) => {
  const s = String(c == null ? '' : c).trim();
  return HEXCOLOR.test(s) ? s : fallback;
};

/* ── numbers ─ the rule this file was WRONG about, and the fix ───────────────
   🔴 UNKNOWN IS NOT ZERO — AND `Number()` DISAGREES WITH THAT, LOUDLY.
   `Number(null)` is 0. `Number('')` is 0. `Number('  ')` is 0. `Number([])` is
   0. `Number(false)` is 0. So the obvious one-liner this helper used to be —

       const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

   — answered **0** for every absent value the view actually carries, and index.js
   really does send nulls: an unset `tariff` column, an unpublished `free_bays`,
   a depot that was never built, a fleet row written before its run ladder
   resolved. Every "unknown renders as a dash" promise below was therefore
   false, and the failures were not cosmetic:

     • the SYNTHESISED MERIDIAN ROW sets `tariff:null, coverage:null,
       freeBays:null` on purpose, so the ceiling prints '—' rather than a number
       nobody sent. It printed `0` and `0 · full` instead — advertising the price
       ceiling as FREE and the one carrier that never refuses anyone as FULL.
       That is the exact lockout Meridian exists to prevent, rendered by the UI.
     • the rate-board sort claims "unpublished rates sink, they do not lead".
       With null coerced to 0 they LED: a carrier who has never published a
       tariff sat at the top of the board as the cheapest offer on it.
     • `bays === 0`, `cap >= 0 && fleet.length > cap`, `runs === 0` and the
       `price - cinder` shortfall all fired on ABSENT data — a false "every bay
       is loaded", a false "the depot supports 0 rigs", a false "rated for zero
       runs", a false "you are short". Four refusals invented out of nothing,
       which is the one sin this file's header forbids.

   So N NEVER hands a value to `Number()` unless it is already a number or a
   non-blank string. Booleans, arrays, objects, Dates, null and undefined all
   answer null, because none of them is a count. Dates are called out on
   purpose: a Date coerces to a 13-digit timestamp, which IS finite, and would
   have sailed through the old guard and printed as a fare.

   It also cannot throw, which the old version could: `Number(Symbol())` throws
   a TypeError, and rule 3 of this file is that nothing in it may throw. The
   typeof gate removes that edge without a try/catch.

   ⚠ N IS IDEMPOTENT — `N(N(x)) === N(x)` — and that is LOAD-BEARING, not a
   coincidence. fmt() below runs N on whatever it is given, and a dozen call
   sites in this file pass a value that has ALREADY been through N
   (`fmt(bays, '—')` where `const bays = N(depot.bays)`). Idempotence is the
   only reason that double pass is safe, and it is the second half of the bug
   above: an already-N'd null went into fmt, got re-coerced by `Number()`, and
   came back out as 0 even at a call site that had checked for null first. If N
   is ever edited, idempotence over `null` is the property to keep. */
const N = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;   // NaN/±Infinity are unknown too
  if (typeof v === 'string') {
    /* Strings are accepted because Postgres numeric/bigint columns arrive as
       strings through PostgREST — refusing them would turn a real tariff into
       '—'. But a blank string is ABSENT, not zero, which is what Number() gets
       wrong. */
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'bigint') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;                        // null, undefined, boolean, array, object, Date, Symbol
};

/* fmt(v, dash) is the ONE place a number becomes display text. `dash` is what an
   unknown prints as and defaults to '—'. It is safe on a raw view value or on
   an already-N'd one — see the idempotence note above. Never pass '0' as the
   dash: there is no column in this panel where absent and zero mean the same
   thing, and that substitution is the whole bug documented above. */
function fmt(v, dash) {
  const n = N(v);
  if (n === null) return (dash === undefined) ? '—' : dash;
  try { return n.toLocaleString(); } catch (e) { return String(n); }
}
const pctText = (v) => { const n = N(v); return n === null ? '—' : (Math.round(n) + '%'); };
const plural = (n, one, many) => (n === 1 ? one : many);
/* The colour has to honour the same three-way split as the text, or the panel
   contradicts itself: a red '—' says "this is zero and that is a problem" while
   the dash beside it says "nobody sent this". Unknown is DIM, zero is red, a
   real count is gold. This was the last place the two-way split survived. */
const tone = (n) => (n === null ? 'mt-dim' : (n > 0 ? 'mt-gold' : 'mt-bad'));
const str = (v, d) => { const s = (v === undefined || v === null) ? '' : String(v); return s || (d === undefined ? '' : d); };
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => ((v && typeof v === 'object') ? v : {});

/* ── clip() ─ THE ERROR BUDGET, ENFORCED HERE BECAUSE NOTHING ELSE ENFORCES IT ─
   🔴 PAST BUG, AND IT LIVED IN THIS FILE'S COMMENTS RATHER THAN ITS CODE.
   The server-error banner below used to open with "index.js has already trimmed
   it to 160 chars". index.js does not, and never did: classify() (index.js:191)
   is the only writer of `S.error` and the whole of the treatment is

       if (r.error && !S.error) S.error = String(r.why || r.error);

   — a String(), no slice anywhere in the module. So `renderTransport({error:
   'Z'.repeat(5000)})` emitted all five thousand characters into a banner that is
   styled to sit ABOVE the tab body, pushing the depot card off the screen. The
   panel whose entire job is to explain a failure legibly became the failure, and
   the comment asserting otherwise is what stopped anyone looking.

   REJECTED: "trust the caller and document the guarantee." A renderer that
   asserts an upstream invariant it does not check is correct exactly until
   someone edits the caller — and then it is a comment that actively misleads.
   The clip costs one call and it belongs here, at the point where the string
   stops being data and becomes pixels.

   TRUNCATION IS VISIBLE. The ellipsis is appended and the banner says the text
   was cut, because a server message that simply stops mid-word reads as the
   SERVER having truncated it, which sends the next debugger after the wrong bug.

   160 is the same budget index.html uses for the same job — `_msg.slice(0, 160)`
   in `_bankEnsureCharter()`'s toast (79951) — one number, so a player who
   reports a message from either surface reports a comparable amount of it. */
const ERR_MAX = 160;
function clip(v, max) {
  const t = str(v).trim();
  const n = (max === undefined || !(max > 0)) ? ERR_MAX : max;
  return t.length <= n ? t : (t.slice(0, n - 1).replace(/\s+$/, '') + '…');
}

/* ════════════════════════════════════════════════════════════════════════════
   THE STYLESHEET
   Exported as a string and injected ONCE, lazily, by index.js's ensureCss().
   It is deliberately not appended here: a module that appends a <style> at
   import time charges every page load for a panel most sessions never open, and
   two copies of the module would stack two <style> blocks. index.js guards on
   the element id for exactly that reason.

   The grammar is production.render.js's on purpose — same card gradient, same
   border, same 3px accent, same Cinzel headings, same is-bad/is-warn/is-ok
   modifiers — so the freight panel reads as the same game as the city panel
   instead of as a bolt-on. Only the accent and the namespace differ.
   ════════════════════════════════════════════════════════════════════════════ */
export const TRANSPORT_CSS = `
/* 🔴 THE OVERLAY RULE. THE ID BELOW IS index.js's, AND THIS COMMENT IS THE
   ONLY THING JOINING THEM. index.js declares \`const OV = 'mythic-transport-ov'\`
   and its open() creates <div id="mythic-transport-ov">, appends it to
   document.body and attaches the click-outside close "matching every other
   overlay in the game". It sets no inline style and paint() sets none either, so
   the rule below is the ONLY thing that lifts the depot out of document flow.
   For one revision it existed nowhere in the repo: index.js owned the element,
   this file owned the stylesheet, and each half assumed the other had shipped
   the rule. What the player got was an unstyled block appended to the end of
   <body> — the depot drawn BELOW the entire game in normal flow, the page's
   scroll height grown by the length of the panel, and the click-outside close
   unreachable because the div was only ever as tall as its own content.
   ⚠ IF OV IS EVER RENAMED, THIS SELECTOR IS ITS OTHER HALF. index.js carries the
   matching note. A rename that touches only one file silently restores the bug
   above, and it will look fine in review.
   ⛔ REJECTED: copying community.render.js's \`display:flex;align-items:center\`
   overlay wholesale. That works there because .mc is a height-capped dialog with
   its own internal scroller; .mt-wrap is a plain column that grows with the
   fleet and the rate board, so centring it would push the head and the tab bar
   off the top of a long depot with no way to scroll back up to them. Block flow
   plus \`overflow:auto\` here gives the same horizontal centring — .mt-wrap
   already carries \`margin:0 auto\` — and keeps every row reachable. */
#mythic-transport-ov{position:fixed;inset:0;z-index:2147483200;overflow:auto;
  background:rgba(6,5,12,.86);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}
.mt-wrap{--mt-acc:#e0a45c;display:flex;flex-direction:column;gap:12px;font-family:inherit;color:#dfe5ee;
  max-width:920px;margin:0 auto;padding:14px}
.mt-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mt-head h2{margin:0;flex:1 1 auto;font-family:'Cinzel',serif;font-size:1.25rem;color:var(--mt-acc)}
.mt-cinder{font-family:'Cinzel',serif;color:#ffd166;font-size:0.95rem;white-space:nowrap}
.mt-tabs{display:flex;gap:6px;flex-wrap:wrap}
.mt-tab{padding:5px 12px;border-radius:4px;cursor:pointer;font:inherit;font-size:0.82rem;
  background:transparent;border:1px solid rgba(255,255,255,0.18);color:#b9c2d0}
.mt-tab.is-on{border-color:var(--mt-acc);color:var(--mt-acc);background:rgba(224,164,92,0.10)}
.mt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.mt-card{border:1px solid rgba(255,255,255,0.12);border-left:3px solid var(--acc,var(--mt-acc));border-radius:6px;
  padding:10px 12px;background:linear-gradient(180deg,#0c1118,#070a0f)}
.mt-card h4{margin:0 0 4px;font-family:'Cinzel',serif;font-size:0.98rem;color:var(--acc,var(--mt-acc))}
.mt-card.is-wide{grid-column:1/-1}
.mt-vitals{display:flex;flex-wrap:wrap;gap:8px}
.mt-vital{flex:1 1 110px;padding:8px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;
  background:linear-gradient(180deg,#0c1118,#070a0f)}
.mt-vital b{display:block;font-family:'Cinzel',serif;font-size:1.05rem;color:#ffd166}
.mt-vital span{font-size:0.72rem;letter-spacing:0.08em;opacity:0.7;text-transform:uppercase}
.mt-vital.is-bad b{color:#e0556a}
.mt-io{font-size:0.78rem;line-height:1.7;margin:3px 0}
.mt-io em{font-style:normal;opacity:0.6;letter-spacing:0.06em;font-size:0.68rem;text-transform:uppercase;margin-right:5px}
.mt-dim{opacity:0.62}
.mt-bad{color:#e0556a}
.mt-gold{color:#ffd166}
/* 🛑 The halt banner is deliberately loud, and this comment is the reason it is
   allowed to be ugly. A refused haul, an unstaffed charter or a rig that has
   used its runs LOOKS EXACTLY LIKE a working one unless the chrome shouts: a
   stopped thing that renders the same as a running one is the single most
   common "the game is broken" report this project gets. The variants are not
   decoration either — is-bad is "this will not work", is-warn is "this works
   but not the way you think", is-ok is "this is fine, and here is the proof",
   is-info is "read this before you click". Collapsing them loses that. */
.mt-halt{margin-top:6px;padding:6px 8px;border-radius:4px;font-size:0.78rem;line-height:1.5;
  background:rgba(224,85,106,0.12);border:1px solid rgba(224,85,106,0.45);color:#ffb3c0}
.mt-halt.is-warn{background:rgba(255,194,74,0.10);border-color:rgba(255,194,74,0.45);color:#ffd79a}
.mt-halt.is-ok{background:rgba(154,209,122,0.10);border-color:rgba(154,209,122,0.40);color:#bfe6a8}
.mt-halt.is-info{background:rgba(224,164,92,0.10);border-color:rgba(224,164,92,0.40);color:#f0cfa6}
.mt-fix{display:block;margin-top:3px;opacity:0.85;font-size:0.74rem}
/* An instruction, not a blank. Every empty list in this panel renders one of
   these instead of nothing, because "no rows" and "this feature is broken" are
   indistinguishable to a player looking at an empty box. */
.mt-note{font-size:0.76rem;opacity:0.85;line-height:1.6;padding:8px 10px;border-radius:5px;
  border:1px dashed rgba(212,175,55,0.4);background:rgba(212,175,55,0.06);color:#e7d6a2}
.mt-btn{margin-top:8px;margin-right:6px;padding:5px 10px;border-radius:4px;cursor:pointer;font:inherit;font-size:0.8rem;
  background:transparent;border:1px solid var(--acc,var(--mt-acc));color:var(--acc,var(--mt-acc))}
.mt-btn[disabled]{opacity:0.4;cursor:not-allowed;border-color:#555;color:#777}
.mt-field{display:inline-flex;flex-direction:column;gap:2px;margin:0 8px 6px 0}
.mt-field label{font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;opacity:0.65}
.mt-field input{padding:5px 7px;border-radius:4px;font:inherit;font-size:0.82rem;width:150px;
  background:#0a0e14;border:1px solid rgba(255,255,255,0.18);color:#e6ecf5}
.mt-table{width:100%;border-collapse:collapse;font-size:0.8rem}
.mt-table th{text-align:left;font-family:'Cinzel',serif;font-weight:600;font-size:0.72rem;letter-spacing:0.06em;
  text-transform:uppercase;opacity:0.65;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.14)}
.mt-table td{padding:5px 6px;border-bottom:1px solid rgba(255,255,255,0.07);vertical-align:top}
.mt-scroll{overflow-x:auto}
/* The NPC row is marked, always, and never sorted in with the players. It is a
   ceiling and a backstop, not a competitor, and a shipper who mistakes it for
   the cheapest offer on the board has been misled by the UI. */
.mt-npc td{background:rgba(224,164,92,0.07)}
.mt-tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.68rem;letter-spacing:0.05em;
  border:1px solid rgba(255,255,255,0.2);opacity:0.9;white-space:nowrap}
.mt-chip{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.7rem;
  border:1px solid currentColor;opacity:0.95;white-space:nowrap}
.mt-bar{height:5px;border-radius:3px;background:rgba(255,255,255,0.10);overflow:hidden;margin-top:5px}
.mt-bar i{display:block;height:100%;background:var(--mt-acc)}
.mt-calc{font-size:0.78rem;line-height:1.75;margin:2px 0;display:flex;justify-content:space-between;gap:10px;
  border-bottom:1px dotted rgba(255,255,255,0.10)}
.mt-calc b{font-weight:700;color:#ffd166;white-space:nowrap}
.mt-calc.is-total b{font-size:1.02rem;font-family:'Cinzel',serif}
.mt-calc.is-bad b{color:#e0556a}
`;

/* ════════════════════════════════════════════════════════════════════════════
   PRIMITIVES
   ════════════════════════════════════════════════════════════════════════════ */

/* The one banner builder. Structurally identical to production.render.js's
   halt block on purpose — `reason` is what stopped, `fix` is where to go — so
   the two panels teach the player the same thing. `fix` is a separate argument
   and not a sentence glued onto `reason` because "no free bay" tells a carrier
   nothing and "no free bay — upgrade the depot" tells them where to go; index.js
   makes the same split in reasonOf(). */
function banner(kind, reason, fix) {
  const cls = (kind === 'ok' || kind === 'warn' || kind === 'info') ? ' is-' + kind : '';
  return '<div class="mt-halt' + cls + '">' + esc(reason)
    + (fix ? '<span class="mt-fix">→ ' + esc(fix) + '</span>' : '') + '</div>';
}

function note(text) { return '<div class="mt-note">' + esc(text) + '</div>'; }

function vital(label, value, bad) {
  return '<div class="mt-vital' + (bad ? ' is-bad' : '') + '"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
}

function line(label, html) {
  return '<div class="mt-io"><em>' + esc(label) + '</em>' + html + '</div>';
}

/* Every clickable thing in this panel is a `data-mt` attribute and NOTHING
   else. There is no onclick, no addEventListener and no element reference
   anywhere in this file, because index.js's paint() assigns innerHTML on the
   overlay root after every action — a listener bound to a button here would be
   discarded by the first repaint and the panel would go dead after one click.
   That is not hypothetical; it is why community.render.js is written the same
   way. index.js binds ONE delegated click on the root and resolves it with
   ev.target.closest('[data-mt]'), which keeps working across every repaint. */
function btn(action, label, opts) {
  const o = obj(opts);
  const attrs = [
    'class="mt-btn"',
    'type="button"',
    'data-mt="' + esc(action) + '"',
    o.id ? 'data-mt-id="' + esc(o.id) + '"' : '',
    o.tab ? 'data-mt-tab="' + esc(o.tab) + '"' : '',
    o.from ? 'data-mt-from="' + esc(o.from) + '"' : '',
    o.to ? 'data-mt-to="' + esc(o.to) + '"' : '',
    o.disabled ? 'disabled' : '',
    o.style ? 'style="' + esc(o.style) + '"' : '',
  ].filter(Boolean).join(' ');
  return '<button ' + attrs + '>' + esc(label) + '</button>';
}

/* ⚠ THESE SEVEN IDS ARE A PINNED CONTRACT WITH index.js AND CANNOT BE RENAMED
   HERE ALONE: mt-name, mt-tariff, mt-carrier, mt-from, mt-to, mt-cargo-id,
   mt-cargo-n. index.js reads them through fieldVal(), which answers '' for an
   element it cannot find — so a typo in one of them does NOT throw and does NOT
   log. It quietly becomes "Pick where the cargo is and where it is going" on a
   form the player has already filled in, which is the worst possible failure
   mode: a correct action refused with a wrong reason. Grep index.js for
   fieldVal( before touching any of them. */
function field(id, label, opts) {
  const o = obj(opts);
  return '<div class="mt-field"><label for="' + esc(id) + '">' + esc(label) + '</label>'
    + '<input id="' + esc(id) + '" type="' + esc(o.type || 'text') + '"'
    + ' value="' + esc(o.value == null ? '' : o.value) + '"'
    + ' placeholder="' + esc(o.placeholder || '') + '"'
    + ' autocomplete="off" spellcheck="false"></div>';
}

/* A section that throws must cost the player that section and nothing else.
   index.js has a whole-overlay fallback for a throw out of renderTransport(),
   but reaching it means the depot card, the fleet and the rate board all vanish
   because one carrier row had a shape nobody expected — and the player is then
   told "the depot screen could not be drawn" for a panel that was 90% fine.
   The error text is SHOWN, not summarised — through the same clip() and the
   same ERR_MAX as a server error, because a reader comparing two banners should
   not have to wonder whether two different budgets cut them differently. */
function safe(label, fn) {
  try {
    const s = fn();
    return (typeof s === 'string') ? s : '';
  } catch (e) {
    return banner('bad',
      '⚠ The ' + label + ' could not be drawn: ' + clip(str(e && e.message, String(e))),
      'Nothing was charged and no contract was changed. Reload the game; if it repeats, this is a bug in depot.render.js and the message above is the whole of it.');
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   THE GLOBAL BANNER STRIP — the four states that are about the FEATURE rather
   than about any one panel. They stack above the tab body and the body still
   draws underneath: degrading legibly beats blanking. In particular the rate
   board is still worth drawing with no session and no tables, because Meridian
   Haulage is on it unconditionally and a shipper can at least read the ceiling.
   ════════════════════════════════════════════════════════════════════════════ */
function statusBanners(v) {
  const out = [];

  /* NO BRIDGE. index.html hands this feature its bridge; if the module loaded
     but the bridge did not, everything below is empty for a reason that has
     nothing to do with the player. Say it is a LOAD problem, in those words —
     the alternative is a panel full of zeroes that reads as "I own nothing". */
  if (!v.ready) {
    out.push(banner('bad',
      '🔌 Freight loaded, but the game did not hand it anything — the transport bridge is missing on this build.',
      'Reload the game. If it survives a reload, index.html is missing its MythicTransportBridge block; nothing you do in this panel will work until it is back.'));
  }

  /* NOT SIGNED IN. Distinct from "no tables" and from "an error": there is
     nothing wrong, there is just no session to read a company out of. */
  if (v.offline) {
    out.push(banner('warn',
      '🔒 You are not signed in, so the exchange cannot read your charter, your fleet or the rate board.',
      'Sign in and reopen the depot. The Meridian Haulage rate below is still accurate — it is fixed to the exchange ceiling, not to your account.'));
  }

  /* 🧱 MISSING TABLES ARE NOT AN EMPTY MARKET, and this repo separates the two
     deliberately: contracts.js answers `{ok:false, missing:true}` for an
     undefined-table error precisely so this line can say "run the SQL" instead
     of "something went wrong". Treating missing as empty would draw a rate board
     with zero carriers and no explanation, and the first bug report would be
     "nobody is on the exchange" from a project where the exchange does not yet
     exist. The migration is named because "run the migration" is not an
     instruction anyone can follow. */
  if (v.missing) {
    out.push(banner('bad',
      '🧱 The freight tables are not installed on this project yet — this is a setup step, not a fault.',
      'Open the Supabase SQL editor, paste sql/038 and run it. It is idempotent, so running it twice is safe.'));
  }

  /* ⚠ THE REAL ERROR, IN THE SERVER'S OWN WORDS. Clipped, never rewritten.
     It is NOT replaced with a guessed cause, and there is a scar behind that:
     index.html's `_bankEnsureCharter()` carries the rule verbatim — "Name the
     real error instead of guessing at a cause" (index.html:79943) — written on
     top of four wasted debugging sessions caused by a toast telling an admin to
     run a .sql file they had already run. A renderer that swaps a server message
     for a friendlier theory is exactly the mechanism that produced that, so the
     friendly framing goes in `fix`, where it cannot displace the evidence.

     CLIPPING IS NOT REWRITING, and this file does the clipping itself — see
     clip() for the "index.js already trimmed it" claim that was false and for
     what it cost. The first 160 characters of a PostgREST error carry the
     message; what follows is the hint, the detail and sometimes the entire
     failing statement, none of which fits in a banner and all of which is still
     on the failed request. `raw` is kept only to detect that a cut happened —
     the banner says so rather than trailing off. */
  const raw = str(v.error).trim();
  if (raw) {
    const err = clip(raw);
    out.push(banner('bad',
      '⚠ The freight service answered with an error: ' + err,
      (err.length < raw.length
        ? 'Shown to the first ' + ERR_MAX + ' characters of a longer message; the whole of it is on the failed request in the network tab. '
        : '')
      + 'That is the server’s own words, not a guess. Retry with Refresh; if it repeats, this message is what to report.'));
  }

  return out.join('');
}

/* ════════════════════════════════════════════════════════════════════════════
   TAB 1 — THE DEPOT
   ════════════════════════════════════════════════════════════════════════════ */
export function renderDepot(view) {
  /* Every exported renderer normalises its own argument. They are exported so a
     test can call one with a literal, and a test literal is exactly the shape
     that is missing half its keys — a section renderer that throws on `{}` is a
     section renderer nobody writes a test for. */
  const v = obj(view);
  const charter = obj(v.charter);
  const depot = obj(v.depot);
  const garage = obj(v.garage);
  const cards = [];

  /* ── the charter ──────────────────────────────────────────────────────────
     The charter is BOUGHT ELSEWHERE (Just Business, through _opFound/_opEcon)
     and this panel only opens the yard. That split is index.js's, and its
     comment says why: charging here would bill the player twice for one charter
     and put the price in two places. So this card never shows a Buy button —
     it shows where to go, and the startup price only if the economy module
     actually answered.

     ⚠ `startup: null` is rendered as UNKNOWN and never as a guessed number.
     CLAUDE.md: "All operation pricing goes through _opEcon(). Never hardcode
     economy numbers." A hardcoded fallback here would be a second price the
     panel could advertise while the till charges the first. */
  const startup = N(charter.startup);
  if (!charter.owned) {
    cards.push('<div class="mt-card is-wide"><h4>📜 Charter</h4>'
      + banner('bad',
        'You do not hold a Transportation Company charter, so there is no carrier to run.',
        'Found it in Just Business' + (startup === null ? '' : ' (startup ' + fmt(startup) + ' 🔥)') + ' — this screen only opens the yard once the charter exists.')
      + (startup === null
        ? banner('info',
          'The startup price could not be read on this build.',
          'It is whatever Just Business quotes you. This panel deliberately does not print a number it did not get from the economy table, because a second price is a price the till does not honour.')
        : '')
      + '</div>');
  } else {
    const workers = N(charter.workers);
    cards.push('<div class="mt-card is-wide"><h4>📜 Charter · ' + esc(str(charter.label, 'transport')) + '</h4>'
      + banner('ok', '◉ CHARTERED — the company is yours and may trade on the exchange.', '')
      + line('drivers', '<span class="' + tone(workers) + '">' + fmt(workers, '—') + '</span> staffed')
      /* Deliberately worded as an observation, not as a server rule. This panel
         does not know whether transport_dispatch() refuses an unstaffed
         charter, and asserting it would be a confident claim about behaviour
         nobody here measured. What IS certain is that a yard with no drivers is
         not a business, so it is a warning and not a halt. */
      + (workers === 0 ? banner('warn',
        'No drivers are on the roster.',
        'Hire crew for the company in Just Business. A yard with no drivers is paperwork; whether the exchange refuses the haul outright is the server’s call, not this panel’s.')
        /* An UNREPORTED roster is not an empty one. Accusing a player of having
           hired nobody because a column did not come back is the same class of
           mistake as the '0 · full' bay: a confident refusal built out of
           missing data. */
        : workers === null ? banner('info',
          'The driver count did not come back on this build, so this card cannot tell you whether the yard is staffed.',
          'Check the roster in Just Business. This is a missing number, not a missing crew — nothing here has been refused.')
        : '')
      + '<div class="mt-io" style="margin-top:8px"><em>register on the exchange</em>Shippers find you by name.</div>'
      + field('mt-name', 'Carrier name', { placeholder: 'e.g. Ninefold Freight' })
      + btn('found', '🚛 Register carrier')
      + field('mt-tariff', 'Tariff 🔥 / unit·hop', { type: 'number', placeholder: 'e.g. 60' })
      + btn('tariff', '💰 Publish tariff')
      /* The server clamps the tariff to the Meridian ceiling and index.js's
         toast prints what LANDED rather than what was asked for. This line
         warns before the click for the same reason: a rate that silently
         becomes a different rate is the "shown one price, billed another"
         class of bug, and it is cheaper to explain the ceiling than to explain
         the surprise. */
      + banner('info',
        'A published tariff is clamped to the exchange ceiling (' + TARIFF_MULT + '× the median player rate — the Meridian Haulage rate).',
        'Asking above the ceiling is not an error; you are simply quoted at the ceiling. The confirmation will say what actually landed.')
      + '</div>');
  }

  /* ── the Freight Depot building ───────────────────────────────────────────
     depot.js is the SINGLE AUTHORITY for bays, fleet capacity and reach, and it
     ships its own `why` for BOTH outcomes — the ready case sets why to
     "◉ YARD OPEN — n bays…". So this card prints depot.why in every state and
     re-derives nothing from the level: a second copy of that table is how a UI
     ends up promising four bays while dispatch enforces two. */
  const bays = N(depot.bays), cap = N(depot.fleetCap), radius = N(depot.radius);
  const depotOk = !!depot.ok;
  const why = str(depot.why);
  cards.push('<div class="mt-card is-wide"><h4>🏗 Freight Depot' + (depot.level ? ' · Lv ' + fmt(depot.level) : '') + '</h4>'
    + '<div class="mt-vitals">'
    + vital('Bays', fmt(bays, '—'), bays === 0)
    + vital('Fleet cap', fmt(cap, '—'), cap === 0)
    + vital('Reach', radius === null ? '—' : (fmt(radius) + ' ' + plural(radius, 'hop', 'hops')), radius === 0)
    + '</div>'
    + (why
      ? banner(depotOk ? 'ok' : 'bad', why, str(depot.fix))
      /* depot.js always sends a `why`. If one ever arrives without it, the panel
         must still say something — an unexplained depot card is precisely the
         blank this file exists to prevent — and it must not invent a cause. */
      : banner(depotOk ? 'ok' : 'bad',
        depotOk ? '◉ The yard is open.' : 'The yard is not usable, and this build did not send a reason.',
        depotOk ? '' : 'Reload the game; if the card stays like this, depot.js returned a refusal with an empty `why` and that is the bug to report.'))
    /* REACH is called out separately because it is the failure a player is most
       likely to read as a broken quote button: both ends of a haul must sit
       inside the radius, and a route that fails that gets refused with
       "out-of-reach" on the exchange tab, several clicks away from here. */
    + (depotOk && radius !== null
      ? banner('info',
        'Both ends of a haul must sit within ' + fmt(radius) + ' ' + plural(radius, 'hop', 'hops') + ' of this yard.',
        'A route with either end outside that is refused on the Exchange tab as out of reach — that is this number, not a fault.')
      : '')
    + '</div>');

  cards.push(garageCard(garage, N(depot.fleetCap)));
  return '<div class="mt-grid">' + cards.join('') + '</div>';
}

/* 🏁 THE GARAGE CREDIT — rendered as a CREDIT, on purpose.
   RATIFIED AND NOT UP FOR REVISITING: paid Garage rigs are a SEPARATE RAIL from
   Cinder-bought fleet rigs. A Garage rig is the player's own capacity and own
   freight; it never hauls another player's cargo and it is never listed as a
   fleet rig. What owning one buys in THIS feature is a fleet-wide perk, and
   that has to be visible or the paid product silently got worse when freight
   shipped. The bonuses are printed from the view's slotBonus/runBonus rather
   than from the tier, because rigs.data.js owns that ladder and a second copy
   here would let the panel promise a run the dispatcher does not grant.

   'Hand-hauled' is the EXACT shipped label for the no-rig case. index.html's
   `_garageRig()` returns it from both the no-rig path (164476) and its catch
   (164479), and the bridge repeats the same shape at 207985 — three sites, one
   word. A parallel name invented here would be a second vocabulary for one
   state, and the player would meet both. (Cited by function name, not by line
   alone — see the note on citations in the header for why.) */
function garageCard(garage, fleetCap) {
  const slot = N(garage.slotBonus) || 0;
  const run = N(garage.runBonus) || 0;
  const name = str(garage.name, 'Hand-hauled');
  if (!garage.owned) {
    return '<div class="mt-card is-wide"><h4>🧺 ' + esc(name) + '</h4>'
      + note('No Garage rig of your own. The yard runs on registered fleet rigs only. A Garage rig is a separate thing from a fleet rig — it carries your own freight, never a shipper’s — and owning one credits the whole fleet: tier 1 adds a fleet slot, tier 2 adds a run per day to every rig, tier 3 does both.')
      + '</div>';
  }
  const credits = [];
  if (slot > 0) credits.push('+' + fmt(slot) + ' fleet ' + plural(slot, 'slot', 'slots') + (fleetCap === null ? '' : ' (already counted in the ' + fmt(fleetCap) + ' above)'));
  if (run > 0) credits.push('+' + fmt(run) + ' ' + plural(run, 'run', 'runs') + '/day on every rig in the fleet');
  return '<div class="mt-card is-wide" style="--acc:#ffd166"><h4>🏁 ' + esc(name) + '</h4>'
    + banner('ok',
      credits.length
        ? '🏁 GARAGE PERK ACTIVE — ' + credits.join(' · ')
        : '🏁 Garage rig owned' + (N(garage.tier) ? ' (tier ' + fmt(garage.tier) + ')' : '') + ', but this build reports no fleet bonus from it.',
      credits.length
        ? 'It applies fleet-wide and is already in the numbers on this screen.'
        : 'Tier 1 grants a fleet slot and tier 2 a run per day. If your tier should grant one, reload before reporting it — a zero here is this panel reading the perk table, not the perk being revoked.')
    + '</div>';
}

/* ════════════════════════════════════════════════════════════════════════════
   TAB 2 — THE FLEET
   ════════════════════════════════════════════════════════════════════════════ */
export function renderFleet(view) {
  const v = obj(view);
  const fleet = arr(v.fleet);
  const depot = obj(v.depot);
  const garage = obj(v.garage);
  const cap = N(depot.fleetCap);
  const slot = N(garage.slotBonus) || 0;

  const head = '<div class="mt-vitals">'
    + vital('Rigs', fmt(fleet.length), false)
    + vital('Fleet cap', cap === null ? '—' : fmt(cap), cap === 0)
    + vital('Runs left today', fmt(fleet.reduce((n, r) => n + Math.max(0, N(obj(r).runsLeft) || 0), 0)), false)
    + '</div>'
    + (garage.owned && slot > 0
      ? banner('ok', '🏁 ' + str(garage.name, 'Your Garage rig') + ' is crediting the fleet +' + fmt(slot) + ' ' + plural(slot, 'slot', 'slots') + '.', 'Included in the cap above. The Garage rig itself is not a fleet rig and never appears in the list below.')
      : '')
    /* Over cap is a WARNING and not a halt: the client does not decide which
       rig gets refused, the dispatcher does. Saying "some of these cannot be
       dispatched" without naming which one is honest; naming one would be this
       panel inventing a policy the server has not published. */
    + (cap !== null && cap >= 0 && fleet.length > cap
      ? banner('warn',
        'The yard holds ' + fmt(fleet.length) + ' ' + plural(fleet.length, 'rig', 'rigs') + ' but the depot supports ' + fmt(cap) + '.',
        'Upgrade the Freight Depot, or retire a rig. Which of them the exchange refuses is the server’s call — this panel does not guess at it.')
      : '');

  if (!fleet.length) {
    /* An empty fleet is an INSTRUCTION, not a blank box — and it names the
       actual place rigs come from. "No rigs" alone sends a player looking for a
       Buy button in a panel that has never had one. */
    return head
      + note('🚛 No rigs in the yard yet. Rigs are bought on the Prince Portfolios auction floor — win one there, then register it to the fleet from here. Until then this carrier can publish a tariff but cannot accept a haul.')
      + lotBlock(v);
  }

  return head + '<div class="mt-grid">' + fleet.map(fleetRow).join('') + '</div>' + lotBlock(v);
}

function fleetRow(row) {
  const r = obj(row);
  const vid = str(r.vehicleId);
  const runs = N(r.runs), used = N(r.runsUsed), left = N(r.runsLeft);
  const status = str(r.status, 'idle');
  /* Rarity colour comes from the ROW. rigs.data.js / the bridge's rarity table
     owns the six-id ladder and its colours; a second ladder written here is two
     places that can disagree about what "epic" looks like, and the one that is
     wrong is always the copy nobody remembered existed. An unrecognised colour
     falls back to neutral text, never to a guessed rarity. */
  const colour = safeColor(r.rarityColor, '#cfd6e4');
  const rarity = str(r.rarityName, str(r.rarity, 'unranked'));

  /* Salvage is read ONCE, here, because it is tested in two places — the banner
     below and `repairable` at the bottom — and two copies of one test is exactly
     how this card came to print "this rig will not repair" beside an ENABLED
     Repair button. It is a CONDITION, not a status: transport_repair refuses on
     `condition = 'Salvage'` (sql/038_transport_companies.sql, transport_repair,
     :2396 — grep `rig_is_salvage`; the line number moves, the token does not)
     and 'salvage' is not in transport_rigs' status CHECK at all. The
     status disjunct is kept anyway as a tolerant read of a row that puts it
     there — it costs nothing, and the alternative is a rig the server calls
     finished rendering as ready to haul. */
  const salvaged = status === 'salvage' || /salvage/i.test(str(r.condition));

  const stops = [];
  /* A row with no vehicle id is UNADDRESSABLE, and index.js says why: vehicle id
     is what setRigField() takes and the only id the view row carries, so a
     repair sent without one goes to an id the fleet does not use. Rendering the
     buttons anyway would give the player a control that fails with a toast. */
  if (!vid) {
    stops.push(banner('bad',
      'This rig has no vehicle id, so nothing on it can be addressed.',
      'Reopen the depot. If it persists the fleet row was written before its vehicle id was recorded — the rig is not lost, it just cannot be commanded from here.'));
  }
  if (status === 'retired') {
    stops.push(banner('bad', 'Retired — it is out of the fleet.', 'Register another rig from the auction floor.'));
  } else if (salvaged) {
    stops.push(banner('bad', 'Salvage — this rig is finished as freight and will not repair.', 'Strip it for parts or sell it on, and register a replacement.'));
  } else if (status === 'hauling' || status === 'assigned' || str(r.assignedTo)) {
    /* 🔴 THE RIG VOCABULARY IS THE SERVER'S, AND THIS ARM ONCE INVENTED ITS OWN.
       transport_rigs.status is CHECKed to ('idle','hauling','assigned','retired')
       — sql/038_transport_companies.sql, the `create table transport_rigs`,
       :596 — and transport_dispatch is the only thing that sends a rig out,
       setting `status = 'hauling'` (:2018). This arm used to test
       `status === 'in_transit'`, which is the CONTRACT ladder
       (transport_contracts' own CHECK, :640), not the rig one; index.js's
       fleetBlock passes the column through verbatim
       (`status: row.status || 'idle'`), so a rig that was genuinely hauling fell
       past here into the unknown-status arm below and the panel told the player
       that a perfectly normal rig was in a state this build had never heard of —
       and `repairable` at the bottom of this function stayed true for it, which
       cost real Cinder. Two ladders, one word apart. Read the CHECK constraint;
       never borrow a vocabulary from a sibling table because the words rhyme.
       'assigned' rides along because sql/038's assigned_to hook parks a rig the
       same way — out of the fleet for the duration, not broken. */
    stops.push(banner('info', 'Out on a haul' + (str(r.assignedTo) ? ' (contract ' + esc(str(r.assignedTo)).slice(0, 24) + ')' : '') + '.', 'It comes free when that contract settles.'));
  } else if (status !== 'idle' && status !== '') {
    /* An unknown status SAYS SO rather than being drawn as idle. A rig the
       server has parked for a reason this build has never heard of must not
       render as ready to dispatch — that turns one unknown state into a
       refusal the player cannot explain. */
    stops.push(banner('warn', 'Status "' + status + '" is not one this build recognises.', 'Refresh the yard. Treat the rig as unavailable until it reads idle; the exchange, not this panel, decides whether it can haul.'));
  }
  /* OUT OF RUNS is a warn, not a bad: the rig is fine, the day is spent. The
     fix names the SERVER day deliberately — index.js's comment records that the
     client's todayKey() is index.html's unanchored local-clock one, so moving
     the device clock mints a fresh day locally and changes nothing at all on
     the exchange. Telling a player to "wait until tomorrow" without that would
     invite them to reset the clock and file a bug when it did not work. */
  if (left === 0 && runs !== null && runs > 0) {
    stops.push(banner('warn',
      'Out of runs — all ' + fmt(runs) + ' of today’s ' + plural(runs, 'run', 'runs') + ' are used.',
      'Use another rig, repair this one to raise its ladder, or wait for the reset on the SERVER day — the device clock is not what counts.'));
  } else if (runs === 0) {
    stops.push(banner('warn',
      'This rig is rated for zero runs a day, which is not a state it can haul in.',
      'Repair it: runs/day is the rarity’s run count scaled by condition. If it is already in top condition, refresh — a zero here usually means its rig id did not resolve in the catalog.'));
  } else if (runs === null && left === null) {
    /* A MISSING run ladder is its own state and gets its own words, because the
       alternative is the row rendering "— left" with no banner and reading as a
       healthy rig. It is deliberately NOT drawn as "0 runs" above: that branch
       accuses the rig of being broken, and this one says the panel did not get
       the numbers. Telling a player to repair a rig over a column the server
       never sent is the "guessed at a cause" failure this file is organised
       against, one card down. */
    stops.push(banner('warn',
      'This build did not report a run ladder for this rig — runs/day and runs left are both unknown, which is not the same as zero.',
      'Refresh the yard. If it stays blank the fleet row is missing its runs columns; the rig is fine and the exchange still knows its ladder, this panel just cannot show it.'));
  }

  /* REPAIRABLE MIRRORS transport_repair()'s OWN REFUSALS, ONE FOR ONE, so the
     button is never offered for a call that cannot succeed. The RPC (sql/038,
     `create or replace function public.transport_repair`, :2353) refuses THREE
     things, and this expression is those three and nothing else:
       `status = 'hauling'`    → `rig_in_transit` (:2386)
       `status = 'retired'`    → `rig_retired`    (:2393)
       `condition = 'Salvage'` → `rig_is_salvage` (:2396)
     They matter more than a greyed button usually would, because contracts.js's
     repair() SPENDS FIRST — gcConfirm, spendGems(bill.cinder), takeRes(parts),
     persist — and only then calls the RPC, so an offered button on a rig the
     server will refuse is a real Cinder-and-parts round trip out and back for
     nothing.
     Three bugs are recorded here rather than quietly corrected:
       (1) this line tested `status !== 'in_transit'`, a contract status no rig
           ever carries, so Repair rendered ENABLED on every rig mid-haul and
           clicking it ran that whole spend/refuse/unwind loop;
       (2) `salvaged` was not tested at all, so the salvage banner above and this
           button contradicted each other two elements apart;
       (3) this comment itself then said the RPC "refuses exactly two things" and
           that 'retired' was "NOT a server refusal — it is this panel's own
           rule". That was true when it was written and is FALSE now: the
           `rig_retired` branch was added to transport_repair in the same round,
           and its comment there explains why (nothing un-retires a rig, so
           repairing one buys a condition that can never haul). No behaviour
           changed — both halves disable Repair on 'retired' — but the sentence
           invited the next reader to delete `status !== 'retired'` below as a
           mere panel preference, and that would have re-opened the exact
           spend/refuse/unwind loop bug (1) closed. A rule that is only this
           panel's taste is deletable; every test below mirrors the server.
     WHAT IS DELIBERATELY *NOT* TESTED HERE: an unrecognised status stays
     repairable. The three above are a DENY list copied from the RPC, so a status
     that is not on it is one the server will accept, and refusing it here would
     be this panel inventing a refusal the exchange does not have — the same
     class of mistake as (1), just in the other direction.
     ⚠ That is the OPPOSITE call from contractRow()'s Settle button, which DOES
     disable on an unrecognised status. The asymmetry is deliberate: see the
     comment on that button. Each control mirrors the shape of its own RPC's
     guard — a deny list here, a single positive test there.
     REJECTED: making the two cards agree for symmetry's sake. Whichever one you
     converted would stop matching its server function, which is the only thing
     either mirror is for. */
  const repairable = !!vid && !salvaged && status !== 'retired' && status !== 'hauling';
  return '<div class="mt-card" style="--acc:' + colour + '">'
    + '<h4>🚚 ' + esc(str(r.name, 'Unnamed rig')) + '</h4>'
    + line('rarity', '<span class="mt-chip" style="color:' + colour + '">' + esc(rarity) + '</span>'
      + (str(r.condition) ? ' <span class="mt-dim">' + esc(str(r.condition)) + '</span>' : ' <span class="mt-dim">condition unknown</span>'))
    + line('runs today', '<span class="' + tone(left) + '">' + fmt(left, '—') + ' left</span>'
      + ' <span class="mt-dim">(' + fmt(used, '—') + ' used of ' + fmt(runs, '—') + ')</span>')
    + stops.join('')
    + btn('repair', '🔧 Repair', { id: vid, disabled: !repairable })
    + (repairable ? '' : '<div class="mt-io mt-dim">Repair is unavailable for this rig — the banner above says why.</div>')
    + '</div>';
}

/* 🏷 THE LIVE HALF OF THE `register` ACTION — no longer a dead hook.
   index.js's onClick handles `act === 'register'` and takes the vehicle id from
   data-mt-id ONLY, with no form-field fallback, so the action is unreachable
   unless something draws a button carrying that id. This is that something, and
   for one revision it did not draw: the panel handled an action it never
   offered.
   index.js's `lotBlock()` now supplies `view.lot` in the shape read below,
   verbatim — {vehicleId, name, rarityName, rarityColor, condition} — already
   filtered to haul-class vehicles that are not registered rigs. This file adds
   no filter of its own on purpose: a second opinion about what is registerable
   would draw buttons index.js then refuses, and the refusal would be correct
   while the button was wrong.
   `view.lot` is still read through arr() rather than assumed, because it is NOT
   in the pinned view shape this file was contracted against — a renderer that
   throws on a key the contract does not promise dies on the first test literal.
   REJECTED: a "vehicle id" text box as a way to reach the action without this
   list. Asking a player to type an internal id is a worse UI than not offering
   the action at all.
   AN EMPTY LOT DRAWS NOTHING, deliberately, and that is not the blank-instead-
   of-an-instruction failure this file exists to prevent: nothing is
   registerable, and the fleet's own empty state one card up already names the
   Prince Portfolios auction floor as where rigs come from. A second "nothing
   here" box under it is noise, and noise is what makes real banners ignorable. */
function lotBlock(v) {
  const lot = arr(v.lot);
  if (!lot.length) return '';
  return '<div class="mt-card is-wide" style="margin-top:10px"><h4>🏷 Unregistered rigs</h4>'
    + note('These are in your Prince Portfolios lot but not in the fleet. Registering one lets it haul other players’ freight.')
    + lot.map((x) => {
      const it = obj(x);
      const id = str(it.vehicleId);
      return '<div class="mt-io">🚚 ' + esc(str(it.name, 'Unnamed rig'))
        + ' <span class="mt-chip" style="color:' + safeColor(it.rarityColor, '#cfd6e4') + '">' + esc(str(it.rarityName, 'unranked')) + '</span> '
        /* Condition is shown BEFORE the click because registerRig() copies it
           onto the fleet row and it sets the rig's runs/day for good — a player
           registering a wreck should read that here, not discover it as a run
           ladder on the fleet tab afterwards. */
        + (str(it.condition) ? '<span class="mt-dim">' + esc(str(it.condition)) + '</span> ' : '')
        + btn('register', '➕ Register', { id: id, disabled: !id })
        + (id ? '' : ' <span class="mt-dim">— no vehicle id, so it cannot be registered from here.</span>')
        + '</div>';
    }).join('')
    + '</div>';
}

/* ════════════════════════════════════════════════════════════════════════════
   TAB 3 — THE FREIGHT EXCHANGE
   ════════════════════════════════════════════════════════════════════════════ */
export function renderExchange(view) {
  const v = obj(view);
  return quoteForm(v) + rateBoard(v) + quoteCard(v) + contractList(v);
}

function quoteForm(v) {
  const f = obj(v.form);   // optional echo; see the warning below
  return '<div class="mt-card is-wide"><h4>📦 Quote a haul</h4>'
    + field('mt-from', 'From node', { value: f.from, placeholder: 'node id' })
    + field('mt-to', 'To node', { value: f.to, placeholder: 'node id' })
    + field('mt-cargo-id', 'Resource', { value: f.resId, placeholder: 'resource id' })
    + field('mt-cargo-n', 'Units', { type: 'number', value: f.units, placeholder: '0' })
    + field('mt-carrier', 'Carrier id', { value: f.carrierId, placeholder: 'blank = pick from the board' })
    + '<div>' + btn('quote', '💬 Get a quote') + btn('meridian', '🚚 Quote Meridian instead') + '</div>'
    /* ✔ CLOSED — and the history stays because it is the reason `view.form`
       exists at all, and the reason nobody may delete it as an unused key.
       index.js's paint() replaces the overlay's innerHTML after every action,
       which destroys these five inputs and everything typed into them. The
       fields went blank after each click, so a second "Get a quote" press on a
       visibly-filled form was refused with "Pick where the cargo is and where
       it is going" — a correct action refused for a wrong reason, the failure
       this whole file is organised against.
       It is closed at BOTH ends, and both halves are load-bearing: selection()
       falls back to S.form when a live field reads '' (index.js, `pick(...)`),
       and buildView() echoes S.form back as `view.form`, which is what the
       `value:` arguments above re-render. The echo alone would repaint values
       that selection() then ignored.
       REJECTED: having this file remember the values in a module variable. That
       makes a pure renderer stateful and gives two places an opinion about what
       the form says; index.js's own comment on `S.form` rejects it from the
       other side too.
       ⚠ REMAINING LIMIT, stated because it is not zero. S.form is written when
       an ACTION is dispatched, and index.js repaints on a 15-second ticker as
       well — so half-typed text that has never been submitted is still lost to
       the next tick, and what comes back is the last submitted selection. That
       is a much smaller loss than the refusal above; closing it would need an
       input listener, which is the one thing this file does not do. */
    + banner('info',
      'A quote is a price at a moment, not a booking. The exchange re-prices the haul when you dispatch it and charges what IT computes.',
      'If the two ever differ, the server’s number is the real one — this panel cannot bind a price and does not pretend to.')
    + '</div>';
}

/* 💰 THE RATE BOARD.
   Sorted cheapest-first among player carriers, with MERIDIAN HAULAGE ALWAYS
   LAST and ALWAYS PRESENT.

   🔴 THE NPC ROW IS NOT CONDITIONAL ON ANYTHING. Not on the carrier list being
   non-empty, not on a session, not on sql/038 existing, not on the list having
   loaded at all. Meridian is a PRICE CEILING, ratified, and its whole purpose
   is that a sole carrier cannot end another player's game by refusing them
   service or by naming an infinite price. If the board fails to load and the
   NPC disappears with it, a shipper holding freight has zero carriers — which
   is precisely the lockout it exists to prevent. So the row is SYNTHESISED when
   the list does not contain it. index.js's carrierBlock() already appends it;
   this is the second belt, and it is cheap.

   The sort is on a COPY. Sorting v.carriers in place would reorder the array
   index.js is holding in its own state through a shared reference, which is a
   renderer quietly mutating its caller — the kind of bug that only shows up as
   "the board reshuffles itself every repaint". */
function rateBoard(v) {
  const list = arr(v.carriers).map(obj);
  const players = list.filter((c) => !c.meridian);
  const npc = list.filter((c) => c.meridian)[0] || {
    id: MERIDIAN_ID, name: MERIDIAN_NAME,
    // No invented tariff. `null` prints '—'; a 0 here would read as "free",
    // which is the opposite of what this carrier is.
    tariff: null, reliability: 100, coverage: null, freeBays: null, meridian: true,
  };

  /* Cheapest first, and an UNPUBLISHED tariff SINKS rather than leads. That
     depends entirely on N answering `null` for a null column: while N coerced
     null to 0, a carrier who had never published a rate sorted to the TOP of
     the board as the cheapest offer on it, and the comparator read as if it
     were doing the opposite of what it did. Behaviour that is only correct
     because of a helper's edge case is worth naming where it is relied on. */
  const ranked = players.slice().sort((a, b) => {
    const x = N(a.tariff), y = N(b.tariff);
    if (x === null && y === null) return 0;
    if (x === null) return 1;          // no rate published → last, never first
    if (y === null) return -1;
    return x - y;
  });

  const rows = ranked.map((c) => carrierRow(c, false)).join('') + carrierRow(npc, true);

  return '<div class="mt-card is-wide"><h4>💰 Rate board</h4>'
    + (players.length
      ? ''
      /* An empty board is an INSTRUCTION and it names the way out. This is also
         the line that must never be reached by mistaking a missing table for an
         empty market — that is why `missing` has its own banner in the strip
         above and is not folded into this sentence. */
      : note('No player carriers are trading right now. That is not a fault, and it does not strand your cargo: Meridian Haulage is on the board below and always is — it never refuses anyone.'))
    + '<div class="mt-scroll"><table class="mt-table">'
    + '<thead><tr><th>Carrier</th><th>Tariff 🔥/unit·hop</th><th>Reliability</th><th>Coverage</th><th>Free bays</th><th></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>'
    + banner('info',
      '🚚 ' + MERIDIAN_NAME + ' is the NPC carrier and the exchange’s price ceiling: ' + TARIFF_MULT + '× the median player tariff, ' + TIME_MULT + '× the trip time, no escort and no illicit freight.',
      'It is deliberately the worst deal on the board and deliberately always on it. No player carrier may charge above its rate, and it will carry your freight when every other carrier has refused you.')
    + '</div>';
}

function carrierRow(c, isNpc) {
  const id = str(c.id);
  const tariff = N(c.tariff);
  const bays = N(c.freeBays);
  /* 🪝 `blocked` IS A LABELLED DEAD BRANCH TODAY, and saying so is the point.
     contracts.js DELIBERATELY does not select the carrier's `blacklist` column
     (its own comment: the row policy would allow it, but reading every
     carrier's refusal list to draw a board is a lot of rows for one bit), so
     index.js's carrierBlock() never sets this flag and this banner never
     fires from the rate board. The LIVE path for a refusal is the quote —
     routes.js returns code 'blocked' with its own reason and fix, and
     quoteCard() prints both. This branch exists so that if the board ever does
     carry the bit, the shipper learns it before spending a click on a quote
     that cannot succeed. Read contracts.js's "`blacklist` IS DELIBERATELY NOT
     SELECTED" note before deleting it — grep that phrase rather than a line
     number, contracts.js moves under this file. */
  const blocked = !!c.blocked;
  const cells = [];

  cells.push('<td>' + (isNpc ? '🚚 ' : '') + '<strong>' + esc(str(c.name, 'Unnamed carrier')) + '</strong>'
    + (isNpc ? ' <span class="mt-tag">NPC · fallback · price ceiling</span>' : '')
    + (blocked ? '<div class="mt-halt">This carrier has refused your business.<span class="mt-fix">→ Ship with ' + esc(MERIDIAN_NAME) + ' — it never refuses anyone; that is what it is for.</span></div>' : '')
    + '</td>');
  /* An unpublished tariff prints '—', never 0. routes.js quotes a carrier with
     no rate at the FLOOR rather than free, on the grounds that an unset rate is
     missing data and not a gift; printing 0 here would advertise the opposite
     of what the pricing code does. */
  cells.push('<td class="mt-gold">' + fmt(tariff, '—') + '</td>');
  cells.push('<td>' + pctText(c.reliability) + '</td>');
  /* COVERAGE IS A COUNT FOR A PLAYER AND A SENTINEL FOR THE NPC, and printing
     the sentinel as a count misleads in the one row that must not. routes.js's
     MERIDIAN carries `coverage: 100` under the comment "every node pair,
     always", and index.js passes it through untouched — so this column would
     read "100 pairs" against the carrier whose entire guarantee is that there
     is no pair it refuses, and a shipper comparing it against a player carrier
     serving 140 would conclude Meridian could not take their route. The NPC row
     prints what the number MEANS instead of what it is. */
  cells.push('<td>' + (isNpc
    ? 'every pair'
    : (N(c.coverage) === null ? '—' : fmt(c.coverage) + ' pairs')) + '</td>');
  /* FREE BAYS IS A THREE-WAY COLUMN and collapsing it to two is the bug this
     file shipped: null = "not published" ('—'), 0 = "full" (red, plus the
     spelled-out row below), n = capacity. index.js makes the same call on the
     way in and its reason holds here too — rendering an ABSENT column as 0
     reads as "full" and quietly pushes the shipper to the NPC at 2.5× over a
     number the board never sent. Meridian itself is the worst case: its
     synthesised row carries `freeBays:null` (it has no bays to run out of), so
     the fallback carrier used to advertise itself as full. */
  cells.push('<td>' + (bays === null
    ? '<span class="mt-dim" title="not published">—</span>'
    : (bays > 0 ? fmt(bays) : '<span class="mt-bad">0 · full</span>'))
    + (isNpc ? ' <span class="mt-dim">n/a</span>' : '') + '</td>');
  cells.push('<td>' + btn(isNpc ? 'meridian' : 'quote', isNpc ? 'Quote' : 'Quote', { id: id, disabled: !isNpc && !id }) + '</td>');

  return '<tr' + (isNpc ? ' class="mt-npc"' : '') + '>' + cells.join('') + '</tr>'
    /* A full carrier is stated in words under the row, not left to a red 0 that
       says nothing about what to do next. Bays are the carrier's limit, never
       the shipper's, and a shipper reading "0" has no way to know that. */
    + (!isNpc && bays === 0
      ? '<tr><td colspan="6">' + banner('warn',
        'Every bay this carrier has is loaded, so they cannot take another haul right now.',
        'Wait for one of their contracts to land, pick another carrier, or take the ' + MERIDIAN_NAME + ' quote.') + '</td></tr>'
      : '');
}

/* 🧾 THE QUOTE — SHOW THE WORKING.
   A fare is tariff × units × hops, plus an escort surcharge, clamped to the
   ceiling. Printing only the total makes every one of those a place the player
   suspects the game of cheating, and a CAPPED price that is silently clamped is
   the worst of them: the board said one number, the till took another, and
   nothing on screen connects the two. So every component gets a line, and the
   clamp gets a loud one.

   The pinned view shape guarantees only {carrierId, carrierName, price, capped,
   hops, etaText, riskPct, meridian}. routes.js's quote() actually returns more
   than that (ok/code/reason/fix/note/tariff/cap/unit/hopsKnown/cargoUnits/
   runs/escort) and index.js passes its object straight through. Everything
   beyond the pinned eight is therefore read DEFENSIVELY — present it when it is
   there, omit the line when it is not — so this renderer works against both the
   contract it was promised and the object it is actually handed. */
function quoteCard(v) {
  const q = v.quote;
  if (!q || typeof q !== 'object') {
    return '<div class="mt-card is-wide"><h4>🧾 Quote</h4>'
      + note('No quote yet. Fill in the two nodes and the cargo above, then pick a carrier from the rate board — or take the ' + MERIDIAN_NAME + ' quote, which is always available.')
      + '</div>';
  }

  /* `ok` is not in the pinned shape. Derive it the safe way: an explicit ok
     wins, otherwise a quote with a price is a quote and one without is a
     refusal. Defaulting the other way would render a refusal as a bookable
     haul with a blank price. */
  const ok = ('ok' in q) ? !!q.ok : (N(q.price) !== null);
  const price = N(q.price);
  const cap = N(q.cap);
  const tariff = N(q.tariff);
  const hops = N(q.hops);
  const hopsKnown = ('hopsKnown' in q) ? !!q.hopsKnown : (hops !== null && hops >= 0);
  const units = N(q.cargoUnits);
  const escort = !!q.escort;
  const rows = [];

  const calc = (label, value, cls) =>
    '<div class="mt-calc' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';

  rows.push(calc('Carrier', str(q.carrierName, str(q.carrierId, '—')) + (q.meridian ? ' · NPC' : '')));
  rows.push(calc('Base tariff', tariff === null ? 'not sent' : fmt(tariff) + ' 🔥 ' + str(q.unit, 'per unit·hop')));
  rows.push(calc('Cargo', units === null ? 'not sent' : fmt(units) + ' ' + plural(units, 'unit', 'units')));
  /* Hops is the multiplier, and it is billed at a MINIMUM OF ONE — a same-node
     or zero-hop haul still costs a hop. Printing "× 0" beside a non-zero
     price is the kind of arithmetic that makes a player think the panel is
     lying, so the billed figure is what is shown and the raw one is named. */
  rows.push(calc('Hops billed', !hopsKnown || hops === null || hops < 0
    ? 'route not measurable'
    : '× ' + fmt(Math.max(1, hops)) + (hops < 1 ? ' (minimum, actual ' + fmt(hops) + ')' : '')));
  rows.push(calc('Escort', escort ? 'surcharge applied' : 'none — no surcharge'));
  if (cap !== null) rows.push(calc('Exchange ceiling', fmt(cap) + ' 🔥 ' + str(q.unit, 'per unit·hop')));
  if (N(q.runs)) rows.push(calc('Runs needed', fmt(q.runs) + ' ' + plural(N(q.runs), 'run', 'runs')));
  rows.push(calc('ETA', str(q.etaText, '—')));
  rows.push(calc('Loss risk', pctText(q.riskPct)));
  rows.push(calc('Price', price === null ? 'no price' : fmt(price) + ' 🔥', 'is-total' + (price === null ? ' is-bad' : '')));

  const cinder = N(v.cinder);
  const short = (price !== null && cinder !== null) ? (price - cinder) : null;

  return '<div class="mt-card is-wide"><h4>🧾 Quote</h4>'
    + rows.join('')
    /* A refusal prints the server’s own reason and fix. routes.js writes both
       and names Meridian in every one of them, deliberately, because the whole
       promise of this system is that a shipper is never stuck. Rewriting them
       here would break that promise in the one place the player reads. */
    + (ok ? '' : banner('bad',
      str(q.reason, 'That haul was refused, and no reason came back with it.'),
      str(q.fix, 'Take the ' + MERIDIAN_NAME + ' quote — it carries what nobody else will.')))
    + (str(q.note) ? banner('info', str(q.note), '') : '')
    /* 🔴 CAPPED IS FLAGGED, NEVER SILENTLY CLAMPED. The carrier asked more than
       the ceiling and is being paid the ceiling. index.js repeats this on the
       dispatch confirmation for the same reason: a number that changes between
       the board and the bill, with nothing saying why, is indistinguishable
       from the game taking money it should not have. */
    + (q.capped ? banner('warn',
      '⚖ CAPPED — this carrier’s asking rate is above the exchange ceiling, so the haul is priced AT the ceiling.',
      'You are charged the lower number. No carrier may bill above ' + TARIFF_MULT + '× the median player tariff; that is what ' + MERIDIAN_NAME + ' exists to enforce.') : '')
    + (q.meridian ? banner('info',
      '🚚 This is the ' + MERIDIAN_NAME + ' quote: ' + TIME_MULT + '× the trip time, no escort, no illicit freight.',
      'It is the dearest and slowest offer on the board on purpose. Take it when no player carrier will serve the route — it never refuses.') : '')
    /* Affordability is shown as a WARNING and does NOT disable dispatch. The
       Cinder figure on the view is a client-side snapshot; the exchange holds
       the authority on the balance and will refuse the spend itself. Disabling
       the button on a stale local number would block a haul the player can in
       fact afford, and "the button is greyed out and I have the money" is a
       worse report than a refused click that explains itself. */
    + (short !== null && short > 0 ? banner('warn',
      'This costs ' + fmt(price) + ' 🔥 and this panel last read your balance as ' + fmt(cinder) + ' 🔥 — short ' + fmt(short) + '.',
      'The exchange checks the real balance when you dispatch; this is a heads-up, not a refusal.') : '')
    + btn('dispatch', '🚀 Dispatch', { disabled: !ok || price === null })
    + (ok && price !== null ? '' : '<div class="mt-io mt-dim">Dispatch is unavailable for this quote — the banner above says why.</div>')
    + '</div>';
}

/* 📋 IN-FLIGHT CONTRACTS. */
function contractList(v) {
  const rows = arr(v.contracts).map(obj);
  if (!rows.length) {
    return '<div class="mt-card is-wide"><h4>📋 Freight in flight</h4>'
      + note('Nothing on the road. Quote a haul above and dispatch it; contracts show up here with their ETA, and you settle them from this list when they land.')
      + '</div>';
  }
  return '<div class="mt-card is-wide"><h4>📋 Freight in flight</h4>' + rows.map(contractRow).join('') + '</div>';
}

/* Status vocabulary. An UNRECOGNISED status says so out loud instead of being
   drawn as in-transit: a contract in a state this build has never heard of is
   exactly the thing a player needs told, and quietly picking the friendliest
   rendering for it is how "my cargo says in transit forever" happens.

   🔴 THESE FIVE NAMES ARE transport_contracts' CHECK CONSTRAINT, NOT A GUESS.
   sql/038_transport_companies.sql (the `create table transport_contracts`,
   :640) reads `check (status in
   ('in_transit','delivered','lost','late','refused'))`, and transport_settle
   (:2255) is the ONLY writer of any of them: it sets status to 'delivered' or
   'lost' AND settled_at in one UPDATE. There is no separate 'settled' state and
   there has never been an 'arrived'.
   An earlier revision of this map invented both — states the exchange cannot
   emit — and, following from that, worded 'delivered' as a step on the way to
   settling. Because 'delivered' is only ever REACHED by settling, that arm told
   the player to settle a haul that was already closed, beside a live Settle
   button; transport_settle answered `retried: true` and credited nothing
   (contracts.js's settle() checks `d.retried !== true` before touching the
   stash), so a correct server reply read to the player as a delivery that would
   not deliver. The invented names are what made the drift invisible: nothing
   could ever hit those arms, so nothing ever looked wrong. If a name in here is
   not in the CHECK, it is a bug.
   'late' and 'refused' are carried even though sql/038's own comment (:634,
   immediately above that CHECK) says NOTHING PRODUCES THEM YET. That is
   deliberate and it is not dead code for its own sake: the constraint permits
   them, so on the day something starts writing one the panel must say what it
   is instead of dropping into the unknown-status arm below. Their wording
   claims nothing about money moving,
   because sql/038 does not say. */
const CONTRACT_STATE = {
  in_transit: { kind: 'info', text: '🚚 On the road.', fix: 'Settle it once it arrives.' },
  /* Terminal. settled_at is written in the same UPDATE as this status, so a row
     that reads 'delivered' is a row that is already closed and paid. */
  delivered: { kind: 'ok', text: '📥 Delivered — the cargo is in the stash.', fix: '' },
  late: {
    kind: 'warn', text: '⏰ Marked late.',
    fix: 'Nothing left to do — the contract is closed. Lateness feeds the carrier’s reliability score, not your fare.',
  },
  refused: {
    kind: 'bad', text: '🚫 Refused — the haul was not taken.',
    fix: 'Nothing was carried. Quote it again on the rate board; another carrier, or Meridian Haulage, can take it.',
  },
  lost: {
    kind: 'bad', text: '💥 Lost on the road.',
    /* Stated plainly because it is the rule, not a bug: a lost haul is not
       refunded — that is what reliability and escorts are for. Leaving it
       unsaid turns a designed outcome into a suspected theft. */
    fix: 'A lost haul is not refunded. Reliability and escorts are what buy that risk down; pick a higher-reliability carrier next time.',
  },
};

function contractRow(c) {
  const id = str(c.id);
  const status = str(c.status, 'in_transit');
  const st = CONTRACT_STATE[status] || null;
  const prog = Math.max(0, Math.min(1, N(c.progress) || 0));
  const price = N(c.price);
  const risk = N(c.risk);

  return '<div class="mt-card" style="--acc:#8fb8e0;margin-top:8px">'
    + '<h4>' + esc(str(c.fromName, '—')) + ' → ' + esc(str(c.toName, '—')) + '</h4>'
    + line('cargo', cargoHtml(c))
    + line('fare', '<span class="mt-gold">' + fmt(price, '—') + ' 🔥</span>'
      + ' <span class="mt-dim">· ETA ' + esc(str(c.etaText, '—')) + '</span>'
      + (risk === null ? '' : ' <span class="mt-dim">· ' + pctText(risk) + ' loss risk</span>'))
    + '<div class="mt-bar"><i style="width:' + Math.round(prog * 100) + '%"></i></div>'
    + (st
      ? banner(st.kind, st.text, st.fix)
      : banner('warn',
        'Status "' + status + '" is not one this build recognises, so this panel will not guess what it means.',
        'Refresh the depot. If it stays, report the status text above — it is the whole of what the exchange said.'))
    + (id ? '' : banner('bad',
      'This contract came back without an id, so it cannot be settled from here.',
      'Refresh the depot. Nothing is lost — the haul exists on the exchange; this row simply has no handle on it.'))
    /* SETTLE IS OFFERED FOR EXACTLY ONE STATUS, because transport_settle guards
       on exactly one: `if v_ct.status <> 'in_transit'` returns `retried: true`
       and moves nothing (sql/038, `transport_settle`, :2211). Enumerating the
       terminal states here instead ('delivered', 'lost', …) would be a second
       copy of that predicate living in another language, and it would drift the
       first time 'late' or 'refused' is written — both are terminal under the
       server's test, and a list of terminal names would have left a live Settle
       button under them. One predicate, mirrored from the guard, is the whole
       fix.
       An unrecognised status is therefore disabled too, deliberately: the banner
       above refuses to guess what it means, and a button whose only possible
       answer is `retried: true` is a control that cannot work.
       ⚠ THIS IS NOT THE CALL THE FLEET CARD MAKES, and an earlier revision of
       this comment claimed it was — "the same call the fleet card makes for a
       rig status this build does not know". Measured against the code, it is
       not: fleetRow() draws its unrecognised-status banner but leaves Repair
       ENABLED, because transport_repair guards with a deny list of three
       refusals and an unknown status is on none of them. transport_settle
       guards with one positive test, so here an unknown status falls outside
       the allow list. The two cards differ because the two RPCs differ; each
       mirrors its own, and neither should be converted to match the other. */
    + btn('settle', '📥 Settle', { id: id, disabled: !id || status !== 'in_transit' })
    + ((id && status === 'in_transit') ? ''
      : '<div class="mt-io mt-dim">Settle is unavailable for this contract — the banner above says why.</div>')
    + '</div>';
}

/* CARGO. index.js's cargoText() is the AUTHORITY for resource names — it holds
   the resource table (tolerantly: the two existing bridges disagree about
   whether `resources` is an array or a function) and already falls back to the
   raw resource id for an id it cannot name. This file must not build a second
   lookup; two name tables is how a manifest reads "40 Iron" in one panel and
   "40 res_iron" in another.

   ⚠ WHAT THIS MEANS FOR AN UNKNOWN RESOURCE: because cargoText arrives as a
   finished STRING, this renderer cannot tell "40 Iron" from "40 res_unknown" —
   the flag has to come with the data. So the structured `cargo` array is read
   first when it is present and marks unknown legs with ⚠; the string path
   relies on index.js's own fallback, which shows the raw id rather than
   dropping the leg. Either way an unrecognised resource is VISIBLE. What is
   never acceptable is a leg vanishing from the manifest while still being
   carried — production.render.js makes the same argument about a cost naming a
   resource the ledger has never heard of.

   And an EMPTY manifest is called out rather than left blank: a contract with a
   blank cargo cell reads as an empty truck, when what it actually means is that
   the manifest did not come back. */
function cargoHtml(c) {
  const legs = arr(c.cargo);
  if (legs.length) {
    return legs.map((x) => {
      const leg = obj(x);
      const known = ('known' in leg) ? !!leg.known : !!str(leg.name);
      const label = str(leg.name, str(leg.id, 'unnamed'));
      return known
        ? esc(fmt(leg.n, '?') + ' ' + label)
        : '<span class="mt-bad">⚠ ' + esc(fmt(leg.n, '?') + ' ' + str(leg.id, 'unknown resource')) + '</span>';
    }).join(', ');
  }
  const text = str(c.cargoText).trim();
  if (!text || text === '—') {
    return '<span class="mt-bad">⚠ manifest not returned — the haul is real, its contents are not on this row</span>';
  }
  return esc(text);
}

/* ════════════════════════════════════════════════════════════════════════════
   THE ENTRY POINT
   ════════════════════════════════════════════════════════════════════════════ */
const TABS = [
  { id: 'depot', label: '🏗 Depot' },
  { id: 'fleet', label: '🚚 Fleet' },
  { id: 'exchange', label: '💰 Exchange' },
];

export function renderTransport(view) {
  try {
    const v = obj(view);
    /* The tab is whitelisted HERE as well as in index.js's click handler, and
       the duplication is deliberate: index.js guards the value a CLICK can set,
       this guards the value the view actually arrives with — a restored tab, a
       future deep link, a test literal. An unrecognised tab must never fall
       through to an empty body, because an empty body with no explanation is
       indistinguishable from a broken feature, which is the failure this whole
       file is organised around. */
    const tab = (v.tab === 'fleet' || v.tab === 'exchange') ? v.tab : 'depot';
    const cinder = N(v.cinder);

    const head = '<div class="mt-head">'
      + '<h2>🚛 Freight Depot</h2>'
      + '<span class="mt-cinder">' + fmt(cinder, '—') + ' 🔥</span>'
      + btn('refresh', '↻ Refresh', { style: 'margin-top:0' })
      + btn('close', '✕ Close', { style: 'margin-top:0' })
      + '</div>'
      + '<div class="mt-tabs">' + TABS.map((t) =>
        '<button class="mt-tab' + (t.id === tab ? ' is-on' : '') + '" type="button"'
        + ' data-mt="tab" data-mt-tab="' + esc(t.id) + '">' + esc(t.label) + '</button>').join('') + '</div>';

    const body = tab === 'fleet' ? safe('fleet', () => renderFleet(v))
      : tab === 'exchange' ? safe('rate board', () => renderExchange(v))
        : safe('depot card', () => renderDepot(v));

    return '<div class="mt-wrap">' + head + safe('status banners', () => statusBanners(v)) + body + '</div>';
  } catch (e) {
    /* Last line of defence. index.js has its own fallback for a throw out of
       here, but that one loses the tab bar and the close button styling; this
       one keeps the player oriented and still names the real error. Neither is
       allowed to be silent. */
    return '<div class="mt-wrap"><div class="mt-head"><h2>🚛 Freight Depot</h2>'
      + '<button class="mt-btn" type="button" data-mt="close" style="margin-top:0">✕ Close</button></div>'
      + banner('bad',
        '⚠ The depot screen could not be drawn: ' + clip(str(e && e.message, String(e))),
        'Nothing was charged and no contract was changed. Reload the game; the message above is the whole of what went wrong.')
      + '</div>';
  }
}
