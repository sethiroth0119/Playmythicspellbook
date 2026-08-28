/* ═══════════════════════════════════════════════════════════════════════════
   🔬 kitchen.selftest.js — THE THING THAT CATCHES THE BUG WE KEEP SHIPPING
   ═══════════════════════════════════════════════════════════════════════════

   DO NOT DELETE THIS FILE AS REDUNDANT. Read the list first.

   Mythic Kitchen has shipped the SAME defect six times running. Not six
   different bugs — one bug, six costumes. Every round, the single biggest
   finding was a value that was computed and never consumed, or a fix that
   landed BESIDE the problem instead of on it:

     round 1 — the lane's two player verbs, `serveCar()` and `waveCar()`, were
               written, documented, tuned… and had ZERO callers in the repo.
               The renderer served through a different path entirely.
     round 2 — the modifier verdict was computed and drawn as chips, and the
               till never paid it. The promise was cosmetic.
     round 3 — `modCinder` / `modPop` were computed on every serve and no
               renderer read either one. The dock hold had no renderer at all.
     round 4 — the skill signal was measured perfectly, then thrown away by a
               `min()` inside `gradeFor()` before it could reach the grade.
     round 5 — the free relief drop — the ONE door that made "a stranded player
               can always get back to cooking" literally true, and the entire
               centrepiece of that round's design argument — SHIPPED AS DATA
               WITH NO CONSUMER. Measured on a fresh account: 102 dishes, then
               permanently unable to cook, holding 7,827 Cinder while all 41
               crates refused. Days 3–10: served 0, lost 36–41. Every day.

   Five rounds of exhortation did not stop it. CONTRACT §11 ends with "🔴 GREP
   FOR THE CALL SITE" in red and it happened anyway, INSIDE the fix that was
   designed to prevent it. So round 6 stops asking people to remember and makes
   it mechanical instead. This file is the grep, written down, runnable, and
   loud.

   ── HOW TO RUN IT ────────────────────────────────────────────────────────
     node public/src/kitchen/kitchen.selftest.js          # from the repo root
     node public/src/kitchen/kitchen.selftest.js --strict # warnings fail too
     node public/src/kitchen/kitchen.selftest.js --json   # machine-readable
     node public/src/kitchen/kitchen.selftest.js --baseline  # reprint CHECK 11's
                                                          #   committed numbers
     window.__mk.selftest()                               # browser console —
                                                          #   STATIC ARM ONLY

   Exit code is 1 when anything FAILs (and, with --strict, when anything WARNs).
   That is the point: it is meant to be usable as a gate, not as a suggestion.

   ── THE TWO ARMS ─────────────────────────────────────────────────────────
   🔴 ROUND 6 PROVED THE STATIC ARM ALONE IS NOT ENOUGH, AND PROVED IT ON THIS
      FILE. `judgeTicket()` read three identifiers declared nowhere; it threw a
      ReferenceError on every ticket carrying a modifier; three defensive catch
      blocks ate it; 45.6% of drive-thru customers could not be handed their
      food — and this file printed `0 FAIL 64 WARN`. A ReferenceError inside a
      `try { … } catch (e) {}` is structurally invisible to a checker that reads
      NAMES. So there are now two arms, and the second one runs the game.

   ── ARM ONE: STATIC ──────────────────────────────────────────────────────
     1  DEAD EXPORTS        an export no other module names.        (rounds 1, 5)
     2  ECON KEYS           declared-and-never-read, and the inverse —
                            READ-AND-NEVER-DECLARED, which evaluates to
                            `undefined` in total silence.           (rounds 3, 5)
     3  COMPUTED, NEVER READ  state fields written and never read back;
                            action-result keys nothing outside the producing
                            file ever touches;                      (rounds 3, 4)
                            …and (3c) the keys of a RECEIPT VARIABLE — an object
                            literal built as `const report = {…}` and then
                            emitted rather than returned, which is how three
                            fields of the day's receipt (`resLine`, `net`,
                            `lifetime`) had zero readers anywhere and this very
                            check could not see one of them.         (round 7)
     4  CONTRACT DRIFT      §1 signatures vs the real ones, §1's id vocabulary
                            vs the real ids, §6's closed event set vs what is
                            actually emitted, §7's bridge table vs the bridge
                            index.html actually builds.             (round 5)
                            …and §1's `→ boolean` annotations against the real
                            return statements, which is how `canCook` was
                            documented as a boolean for two rounds while
                            returning a TRUTHY failure object.      (round 6)
     5  COMMENT LIES        the specific, checkable forms this codebase uses.
     6  RESERVED PAYLOAD KEYS  `name` and `t` in an event payload, which
                            silently overwrite the event name (CONTRACT §6).
     7  FREE IDENTIFIERS    a name that is READ and declared nowhere in its own
                            file. `hit`, `miss`, `meh`.             (round 6)
     8  STATE FIELDS        `K.totals.foodSpent` written in the sim against
                            `k.totals.food` read in the renderer — the premise
                            number that could never render.        (round 6)

   ── ARM TWO: EXECUTION (node only) ───────────────────────────────────────
    10  It BOOTS THE GAME headlessly against a memory-backed §7 bridge, plays a
        280-second shift with a bot that mirrors kitchen.render.js's own serve
        path — including `DriveThru.serveCar()`, the door the old harness never
        used — ships a convoy, LANDS IT, UNLOADS IT, and asserts OUTCOMES.
        Every module is copied to a temp directory with an instrument injected
        into all ~170 `catch` blocks, so THE RUN CAN SEE WHAT THE CATCHES ATE.
        A swallowed ReferenceError/TypeError is a FAIL with its file:line.
        Nothing in the repo is touched.

        🔴 ROUND 7 PROVED THIS ARM ALONE WAS NOT ENOUGH EITHER, AND THREE
           CRITICS PROVED IT INDEPENDENTLY IN THE SAME WORDS: "it asserts that
           things HAPPEN and never that they are RIGHT." E3–E9 all counted
           occurrences (`served > 0`, `K.convoys.length` grew), and EIGHT
           semantic mutations — the claim paying nothing, the settlement never
           delivered, a broken promise paying you, the wave-off free, half the
           supply sheet reverting to pure Cinder — each scored BYTE-IDENTICAL to
           the shipped build. Every defect this feature has actually shipped
           since round 2 is a wrong NUMBER inside an event that did occur. So
           round 8's assertions carry VALUES: what the till paid against what
           the chip promised, what the meter moved against what the verdict
           quoted, what the stash gained against what the manifest said.

   ── THE SCORE (11) ───────────────────────────────────────────────────────
   🔴 The old headline COULD MOVE THE WRONG WAY: deleting the sole consumer of
      a live export took it from 64 WARN to 63. So the raw warning count is no
      longer presented as a score. The primary number is UNWIRED — exports with
      no consumer outside their own module — which RISES when a consumer is
      deleted, and every per-file warning count is diffed against a dated,
      committed baseline so a new line is a FAIL rather than a 64th row in an
      accepted wall.

   ── 🔴 WHAT IT CANNOT CATCH, STATED HONESTLY ─────────────────────────────
   A check that produces false confidence is worse than no check at all, so
   here is the boundary, and it is not narrow:

   • **It cannot read English.** Check 5 handles four mechanical shapes: a
     present-tense "nothing/nobody calls X" claim, an "X is called by <file>"
     claim, a comment naming an `ECON.KEY`, and a `file.js:1234` citation. A
     comment that argues a WRONG DESIGN in fluent prose — round 5's three
     comments arguing the opposite of the shipped numbers — sails straight
     past. Only a human reading the file catches that one.
   • **The static arm is textual, not semantic.** A call site reached through a
     computed name (`State[verb]()`), a re-export, or a string dispatched
     through a table is invisible to it. Conversely, a symbol named ONLY in
     dead code — inside a branch that can never be true, or behind a listener
     that is never wired — counts as "used". Round 1's `serveCar` would be
     caught; a `serveCar` wired to a button `paint()` never renders would NOT.
   • **🔴 NOTHING IN kitchen.render.js OR index.js IS EVER EXECUTED.** The
     execution arm boots data/bridge/api/state/drivethru/convoy and nothing
     else, because the other two want a DOM. So a defect in the HTML, the CSS,
     the layout, an event handler that is never bound, or a value the sim
     computes correctly and the renderer draws wrongly is OUTSIDE BOTH ARMS.
     "Reaches the player" still ends at a browser and a screenshot; CONTRACT
     §11 is still the real bar and this file does not replace it.
   • **The bot walks ONE seeded 280-second shift.** A branch it does not reach
     — a level-20 recipe, a convoy hold-up, an offline gap — is not executed and
     therefore not checked. `--json` prints what it did reach.
   • **🔴 A DEAD MEMBER ACCESS IS INVISIBLE TO BOTH ARMS, AND THAT IS THE ONE
     THE FEATURE ACTUALLY SHIPPED.** `r.k` where `k` is simply absent from what
     `fn()` returns evaluates to `undefined` in silence: check 7 FAILs a FREE
     IDENTIFIER (`landed` declared nowhere) and says nothing at all about
     `r.delivering` on an object that has no `delivering`. That is round 6's
     blocker exactly — "undefined boxes handed over." on the payoff screen at
     zero page errors — and the static arm cannot see it by construction.
     E10 covers the one instance on the arrival card (it FAILs on the literal
     string `undefined`), and nothing covers the general case.
   • **E10 lands a PRACTICE RUN, not an inbound shipment.** Offline there is no
     server leg, so `claim()` takes its local branch: the payout line, the dock
     beat, the arrival payload and the card are all real, and they are the same
     lines both directions run through. What is NOT executed anywhere in this
     file is `API.claimConvoy()`, `firstClaim`, the double-payout wall, the
     depot hold's drain, or RLS. Those need a live database — sql/038's own
     verify block is the instrument for them, not this one.
   • **E11's counterfactual needs an UNCLAMPED tip.** The §SETTLEMENT probe
     skips any sale where either reading pins to `TIP_FRACTION_MAX`, because a
     clamped pair is equal for a legitimate reason. If a run reports zero
     samples it says so and calls the settlement UNVERIFIED rather than passing.
   • **E11 does not assert the settlement's SIZE, only its direction.** The
     Cinder figure is delivered as `verdict.cinder / payoutEstimate()`, and
     `payoutEstimate()` is documented as a MIRROR of `serveTicket()`'s formula
     rather than the formula itself — so an exact-value assertion here would
     fail on a legitimate fourth multiplier before it failed on a bug. What is
     asserted is that the promise moves the till at all and moves it the way the
     chip said. A settlement delivered at 80% of its quoted size would pass.
   • **The property check (8) sees one shape of mismatch and not the others.**
     It compares `k.<field>.<sub>` in the renderer against `K.<field>.<sub>` in
     the sim. It does NOT see: a read that destructures (`const {food} =
     k.totals`), a field indexed by a variable (`k.pantry[id]`, `k.stations[s]`
     — skipped on purpose, their keys are ingredient ids), a third level
     (`k.a.b.c`), a mismatch on an object PASSED as an argument rather than
     read off `K` (a report, a verdict, an action result — `rep.kept` is
     invisible to it), or a key written only through `Object.assign`.
   • **"Wired" and "reaches the player" are still different questions, and it
     only asks the first one in general.** `today.resSpent` had a writer, a
     reader and a renderer — every static check passed — and `openShift()`
     cleared the bucket one tap before the screen read it. Check 10's E8 is
     THAT ONE INSTANCE, hard-coded: buy two crates with the doors shut, open
     them, and require the ledger to survive. There is no general check for a
     consumer that runs at the wrong time, and there is no cheap one.
   • **The free-identifier check does not look inside `${…}`.** The whole
     template literal is blanked, so a free name used only in interpolated HTML
     is missed. It under-reports; it does not invent findings.
   • **The baseline can be moved.** Check 11 diffs against numbers committed in
     this file. `--baseline` regenerates them. A builder who re-baselines to
     make the run green has deleted the check; the numbers are dated and in
     version control so that is at least visible in a diff.
   • **It ignores itself.** kitchen.selftest.js is deliberately NOT counted as
     a consumer of anything. A symbol used only by the self-test is still dead
     to the player, and a test that keeps its own subject alive is a lie.
   • In the browser it skips the index.html checks (11.6 MB is not worth
     fetching to run a grep) AND THE WHOLE EXECUTION ARM, and says SKIP rather
     than passing them silently. Run it under node for the real answer.

   ── 🔬 EVERY CHECK IN HERE WAS PROVEN TO FIRE ───────────────────────────
   A checker that reports "clean" because it is measuring nothing is the same
   bug as a value nobody consumes, so each check was run against a COPY of the
   repo with the defect it hunts deliberately injected, and each one caught it:

     injected                                          caught as
     ────────────────────────────────────────────────  ─────────────────────
     `export function totallyDeadVerb(){}`             DEAD EXPORTS, FAIL
     `EC('MAX_DT_MS')` → `EC('MAX_DT_MS_TYPO')`        ECON KEYS, undeclared
     §1 `plateHand(now, forTicketId)` → `(now)`        CONTRACT DRIFT, sig
     §1 car id `hatch` → `hatchback`                   CONTRACT DRIFT, vocab
     `raise(…, 'car:order', { name: car.name, … })`    RESERVED PAYLOAD KEYS
     `K.neverReadBack = 42`                            COMPUTED, NEVER READ

   Round 7 added three arms and each was proven the same way, in a full copy of
   the module tree (index.html symlinked so nothing SKIPs) that reproduces the
   repo's own numbers exactly:

     ROUND 6'S ACTUAL BLOCKER restored — the three deleted lines of
     `judgeTicket()` put back, so `hit`/`miss`/`meh` are undeclared again:
       FREE IDENTIFIERS  3 FAIL — drivethru.js:1288 `hit`, :1289 `miss`,
                                  :1290 `meh`
       EXECUTION         3 FAIL — "A catch block SWALLOWED ReferenceError: meh
                                  is not defined" at drivethru.js:3421 (8×),
                                  :1383 (4×) and :3687 (4×) IN ONE SHIFT
       EXECUTION         1 FAIL — "5 ticket(s) carrying a promise were filed
                                  and NOT ONE could be served. First refusal:
                                  'Something went wrong at the window.'"
       …against `0 FAIL` for the same build in round 6.

     ROUND 6'S PROPERTY MISMATCH restored — `k.totals.foodSpent` →
     `k.totals.food` in the renderer:
       STATE FIELDS      1 FAIL — kitchen.render.js:4426 reads `k.totals.food`
                                  and nothing in the sim writes that key.

     THE SCORE MUTATION — every textual `buyRelief` stripped from
     kitchen.render.js only, i.e. the escape hatch killed again:
       round 6's headline went 64 WARN → 63 WARN. THE WRONG WAY.
       Now: WARN 63 → 62 (still, and it is no longer the score) while
       UNWIRED 29 → 30 and `kitchen.state.js / DEAD EXPORTS 14 → 15` FAILs.

   Round 8 added six arms and proved every one of them the same way, against
   EIGHT mutations that all scored `0 FAIL 63 WARN · UNWIRED 29/29` in round 7 —
   the critics' own knives, re-cut in a full copy of the tree at
   scratchpad/r14/lab (index.html symlinked, baseline reproduced exactly). One
   mutation at a time, everything else verbatim:

     `claim()`: `b.addRes('food', owed)` → `addRes('food', 0)`
       EXECUTION 2 FAIL — "The player tapped UNLOAD on a landed truck and was
                          refused: CAP 'Your stash filled up — 12 food is held
                          at the depot…' (granted 0)" and "THE TRUCK LANDED AND
                          THE FOOD DID NOT: the arrival quoted 12 food … the
                          live stash went 3577 → 3577 (Δ0)."
     `_salvageLine()`: the `if (primary) cost[primary] = …` line deleted
       EXECUTION 1 FAIL — "16 of 44 crate(s) cost NO live resource at all:
                          sal_dough {"cinder":36} · sal_potato {"cinder":23} …"
     `tipFor()`: `max(tipPct, MIN) + settle` → `max(tipPct, MIN)`
       EXECUTION 1 FAIL — "THE CHIP QUOTES A SETTLEMENT THE TILL DOES NOT
                          DELIVER: the chip promised -17 Cinder and the tip
                          fraction moved by 0 Cinder of a 90 payout."
     `judgeTicket()`: `out.cinder += cinder` → `+= 0`
       EXECUTION 1 FAIL — "modCinder 0 against Σ chips -17 over 1 modifier(s)
                          ('✗ no greens · −0.5 pop')."
     `judgeTicket()`: `payMiss * price` → `Math.abs(payMiss * price)`
       EXECUTION 1 FAIL — "a broken promise must not PAY — this one paid 18
                          Cinder on 0 kept / 1 broken ('✗ no greens +18')."
     `serveCar()`: the promise's `bumpPop(…)` deleted
       EXECUTION 1 FAIL — "The verdict quoted -0.5 pop and the meter recorded 0
                          from a promise (pop:change reasons: [served])."
     `waveCar()`: `EC('POP_WAVE')` → `0 * EC('POP_WAVE')`
       EXECUTION 1 FAIL — "reported a cost of 0 pop and popularity moved
                          51.455… → 51.455… (Δ0)."
     `noteArrival()`: `landed` → `r.delivering` (round 6's blocker, verbatim)
       EXECUTION 1 FAIL — "The arrival card the player is shown reads 'Your
                          practice run is back. undefined boxes handed over.'"

   Two of those runs found bugs in THIS FILE rather than in the repo — the
   state-field check was matching its own assignments and had been quietly
   finding nothing at all, and the §1 section slicer was inventing a finding out
   of §2. Both are commented at the fix. Round 8 made it four: E10's first draft
   read the array `Convoy.tick()` RETURNS and reported "no convoy:arrive was
   raised" against a build that raises it perfectly (convoy.js's `raise()` sends
   it through `State.emit` instead, on purpose, so it is not delivered twice),
   and E14's first draft held the LIVE `dayLedger.resSpent` object as its
   "before" reading, compared it to itself, and accused a real crate of booking
   nothing. Both are commented at the fix. A check that invents a finding is the
   same lie as one that reports clean — it just costs a different builder the
   afternoon. If you add a check, injure the code on purpose and watch it scream
   before you believe it, AND run it once against the untouched tree to make
   sure it goes quiet again.

   Everything it reports carries file:line. If a finding is a false positive,
   the fix is to make the check tighter or to say why in the code — not to
   delete the check and not to widen an allowlist in silence.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── environment ─────────────────────────────────────────────────────────── */

const IS_NODE = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

/** The modules under test. Order is report order. */
const MODULES = [
  'kitchen.data.js',
  'kitchen.bridge.js',
  'kitchen.api.js',
  'kitchen.state.js',
  'drivethru.js',
  'convoy.js',
  'kitchen.render.js',
  'index.js',
];

/** 🔴 This file is never a consumer. See the header. */
const SELF = 'kitchen.selftest.js';

/* Keys so common that "nobody else reads it" says nothing useful about them —
   they are the universal action result (CONTRACT §1) and the row primitives. */
const UBIQUITOUS = new Set([
  'ok', 'code', 'why', 'id', 'name', 't', 'x', 'y', 'w', 'h', 'n', 'v',
  'length', 'value', 'label', 'text', 'type', 'kind', 'state', 'error',
]);

/* ═══════════════════════════════════════════════════════════════════════════
   SOURCE ACCESS — one seam, two backends. node reads the disk, the browser
   fetches the same files it was served from. Nothing else in here knows which.
   ═══════════════════════════════════════════════════════════════════════════ */

async function readRel(rel) {
  const url = new URL(rel, import.meta.url);
  if (IS_NODE) {
    const fs = await import('node:fs/promises');
    return await fs.readFile(url, 'utf8');
  }
  const r = await fetch(url.href, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + rel);
  return await r.text();
}

/* ═══════════════════════════════════════════════════════════════════════════
   A TINY JS SCANNER

   WHY hand-rolled and not a parser: CONTRACT §1 forbids new npm dependencies
   and this file must also run in a browser console with nothing installed.
   It only has to do two jobs — separate comment text from code text, and match
   a brace — and it has to do them without mistaking a `/` for a comment.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * → { code, comments } where `code` is the source with every comment replaced
 * by spaces (line numbers and offsets preserved exactly, so a match index in
 * `code` still maps to the real line), and `comments` is [{line, text}] per
 * comment LINE — block comments are split so a citation keeps its own line.
 *
 * 🔴 Preserving offsets is the whole trick. A "call site" found in `code` is a
 * real call site; the same text found in `comments` is a claim about one, and
 * conflating the two is exactly how round 1 believed `serveCar` was wired.
 */
function scanSource(src) {
  const out = new Array(src.length);
  const comments = [];
  let i = 0, line = 1;
  const n = src.length;
  // regex-vs-division: a `/` starts a regex only after one of these.
  const REGEX_OK = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n', '+', '-', '*', '%', '<', '>', '~', '^']);
  let lastSig = '\n';
  while (i < n) {
    const c = src[i];
    if (c === '\n') { out[i] = c; i++; line++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      let j = i; while (j < n && src[j] !== '\n') j++;
      comments.push({ line, text: src.slice(i + 2, j) });
      for (let k = i; k < j; k++) out[k] = ' ';
      i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      const body = src.slice(i + 2, Math.min(j, n));
      let ln = line;
      for (const piece of body.split('\n')) { comments.push({ line: ln, text: piece }); ln++; }
      const end = Math.min(j + 2, n);
      for (let k = i; k < end; k++) { out[k] = src[k] === '\n' ? '\n' : ' '; if (src[k] === '\n') line++; }
      i = end; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; if (src[j] === '\n') break; j++; }
      for (let k = i; k <= Math.min(j, n - 1); k++) out[k] = src[k];
      i = Math.min(j + 1, n); lastSig = c; continue;
    }
    if (c === '`') {
      let j = i + 1, depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (src[j] === '}' && depth > 0) { depth--; j++; continue; }
        if (src[j] === '`' && depth === 0) break;
        if (src[j] === '\n') line++;
        j++;
      }
      for (let k = i; k <= Math.min(j, n - 1); k++) out[k] = src[k];
      i = Math.min(j + 1, n); lastSig = '`'; continue;
    }
    if (c === '/' && REGEX_OK.has(lastSig)) {
      // A regex literal. Copy it verbatim; we only need it not to look like a comment.
      let j = i + 1, cls = false, closed = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) { closed = true; break; }
        j++;
      }
      if (closed) {
        for (let k = i; k <= j; k++) out[k] = src[k];
        i = j + 1; lastSig = '/'; continue;
      }
    }
    out[i] = c;
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  for (let k = 0; k < n; k++) if (out[k] === undefined) out[k] = ' ';
  return { code: out.join(''), comments };
}

/** 1-based line number for a character offset. */
function lineAt(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

/** Index of the `}` matching the `{` at `open`, skipping strings. −1 if unbalanced. */
function matchBrace(code, open) {
  let depth = 0, i = open, n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n && code[i] !== q) { if (code[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/** Depth-1 property names of the object literal whose `{` is at `open`. */
function literalKeys(code, open) {
  const end = matchBrace(code, open);
  if (end < 0) return [];
  const inner = code.slice(open + 1, end);
  const keys = [];
  let depth = 0, i = 0;
  const n = inner.length;
  let tokenStart = 0;
  const flush = (chunk) => {
    const m = /^\s*(?:\.\.\.)?\s*(?:'([\w$]+)'|"([\w$]+)"|([A-Za-z_$][\w$]*))\s*(:|$)/.exec(chunk);
    if (m) {
      const k = m[1] || m[2] || m[3];
      if (k && !/^(?:true|false|null|undefined|new|typeof)$/.test(k)) keys.push(k);
    }
  };
  while (i < n) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n && inner[i] !== q) { if (inner[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
    if (c === ',' && depth === 0) { flush(inner.slice(tokenStart, i)); tokenStart = i + 1; i++; continue; }
    i++;
  }
  flush(inner.slice(tokenStart));
  return keys;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FINDINGS
   ═══════════════════════════════════════════════════════════════════════════ */

function Findings() {
  const rows = [];
  const api = {
    rows,
    fail: (check, where, msg, note) => rows.push({ sev: 'FAIL', check, where, msg, note }),
    warn: (check, where, msg, note) => rows.push({ sev: 'WARN', check, where, msg, note }),
    skip: (check, msg) => rows.push({ sev: 'SKIP', check, where: '', msg }),
    info: (check, msg) => rows.push({ sev: 'INFO', check, where: '', msg }),
  };
  return api;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE WORLD — everything the checks read, gathered once.
   ═══════════════════════════════════════════════════════════════════════════ */

async function gather(opts) {
  const W = {
    src: {},          // file → raw text
    code: {},         // file → comments blanked
    comments: {},     // file → [{line,text}]
    ns: {},           // file → the live module namespace (dynamic import)
    aliases: {},      // file → { targetFile → [alias,…] }
    named: {},        // file → { targetFile → Set(names) }
    exportLine: {},   // file → { name → line }
    contract: null,
    html: null,       // the kitchen-relevant slice of index.html, or null
    htmlLines: 0,
    notes: [],
  };

  for (const f of MODULES) {
    let text;
    try { text = await readRel('./' + f); }
    catch (e) { W.notes.push('could not read ' + f + ' — ' + e.message); continue; }
    W.src[f] = text;
    const s = scanSource(text);
    W.code[f] = s.code;
    W.comments[f] = s.comments;

    // export lines, straight off the source, the same way CONTRACT §1 says to
    // regenerate itself: grep "^export".
    const el = {};
    const re = /^export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(s.code))) el[m[1]] = lineAt(text, m.index);
    W.exportLine[f] = el;

    // imports
    const al = {}, nm = {};
    const rns = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]\.\/([\w.]+\.js)['"]/g;
    while ((m = rns.exec(s.code))) { (al[m[2]] = al[m[2]] || []).push(m[1]); }
    const rnm = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.]+\.js)['"]/g;
    while ((m = rnm.exec(s.code))) {
      const set = nm[m[2]] = nm[m[2]] || new Set();
      for (const part of m[1].split(',')) {
        const p = part.trim().split(/\s+as\s+/);
        if (p[0]) set.add(p[p.length - 1].trim());
      }
    }
    W.aliases[f] = al;
    W.named[f] = nm;
  }

  // Live namespaces. This is ground truth — it is what the runtime actually
  // exports, not what a regex thinks the file says.
  for (const f of MODULES) {
    try { W.ns[f] = await import(new URL('./' + f, import.meta.url).href); }
    catch (e) { W.notes.push('could not import ' + f + ' — ' + e.message); }
  }

  try { W.contract = await readRel('./CONTRACT.md'); }
  catch (e) { W.notes.push('CONTRACT.md unreadable — ' + e.message); }

  W.htmlScanned = false;
  if (IS_NODE && opts.html !== false) {
    try {
      const raw = await readRel('../../index.html');
      W.htmlLines = raw.split('\n').length;
      // Keep only what matters: the bridge object and every line naming the
      // feature. Holding 11.6 MB for the rest of the run is pointless.
      /* ⚠ NOT indexOf('window.MythicKitchenBridge') — index.html MENTIONS the
         bridge in a comment 500 characters before it builds it, and the first
         `{` after that mention belongs to something else entirely. The first
         draft of this check reported all 24 bridge keys missing because of it,
         which is a perfect miniature of the bug this whole file exists to
         catch: a check that looked like it ran and was measuring nothing. */
      const bm = /window\.MythicKitchenBridge\s*=\s*\{/.exec(raw);
      let bridgeBlock = '';
      if (bm) {
        const ob = bm.index + bm[0].length - 1;
        const cb = matchBrace(raw, ob);
        if (cb > 0) bridgeBlock = raw.slice(ob, cb + 1);
      }
      const hits = raw.split('\n')
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(o => /MythicKitchen|__mk\b|src\/kitchen/.test(o.l));
      W.html = { bridge: bridgeBlock, lines: hits, lineCount: W.htmlLines };
      W.htmlScanned = true;
    } catch (e) {
      W.notes.push('index.html unreadable — ' + e.message);
    }
  }
  return W;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 1 — DEAD EXPORTS
   ───────────────────────────────────────────────────────────────────────────
   Round 1's `serveCar`/`waveCar` and round 5's `RELIEF` in one check.

   Two tiers, because they are two different mistakes:
     DEAD      — the name appears nowhere but its own declaration. Nothing,
                 anywhere, in any file, in any comment-free line of code. This
                 is round 1 and round 5, and it is always a FAIL.
     INTERNAL  — the module uses it itself but no other module names it. That
                 is a smell (why is it exported?) and sometimes deliberate, so
                 it is a WARN.
   ═══════════════════════════════════════════════════════════════════════════ */

function checkDeadExports(W, F) {
  const consumers = MODULES.filter(f => W.code[f] !== undefined);
  const accessors = stringAccessors(W);
  W.unconsumed = new Set();
  if (!W.htmlScanned) {
    F.skip('DEAD EXPORTS', 'index.html was NOT scanned for call sites (browser mode). An export reached only from index.html will be reported dead here and is not. Run under node for the real answer.');
  }
  /* index.js's exports are ALSO its public surface: `MythicKitchen = { open,
     close, paint, isOpen, … }` is how index.html and the console reach the
     feature. Naming those "unused" is technically true and useless, so the
     surface literal counts as the consumer it actually is. */
  const surface = new Set();
  {
    const idx = W.code['index.js'] || '';
    const sm = /const\s+MythicKitchen\s*=\s*\{/.exec(idx);
    if (sm) for (const k of literalKeys(idx, idx.indexOf('{', sm.index + sm[0].length - 1))) surface.add(k);
  }
  F.info('DEAD EXPORTS', 'string-keyed accessors honoured as call sites: '
    + ([...accessors].map(([fn, t]) => fn + "('…') → " + t).join(', ') || 'none found'));
  for (const home of MODULES) {
    const ns = W.ns[home];
    if (!ns) continue;
    const names = Object.keys(ns).filter(k => k !== 'default');
    for (const name of names) {
      const where = home + ':' + (W.exportLine[home][name] || '?');
      const seenIn = [];

      for (const f of consumers) {
        if (f === home) continue;
        const code = W.code[f];
        for (const alias of (W.aliases[f][home] || [])) {
          if (new RegExp('\\b' + alias + '\\s*\\.\\s*' + name + '\\b').test(code)) { seenIn.push(f); break; }
        }
        if (seenIn[seenIn.length - 1] === f) continue;
        // …and the string-keyed route: DF('cookMsFor').
        let viaAccessor = false;
        for (const [fn, target] of accessors) {
          if (target !== home) continue;
          if (new RegExp('\\b' + fn + '\\s*\\(\\s*[\'"]' + name + '[\'"]').test(code)) { viaAccessor = true; break; }
        }
        if (viaAccessor) { seenIn.push(f); continue; }
        const nmSet = W.named[f][home];
        if (nmSet && nmSet.has(name)) {
          // A named import that is imported and then never used is still dead.
          const uses = (code.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
          if (uses > 1) seenIn.push(f);
        }
      }

      // index.html reaches the feature only through the public surface.
      if (W.html) {
        for (const h of W.html.lines) {
          if (new RegExp('\\b' + name + '\\b').test(h.l)) { seenIn.push('index.html:' + h.i); break; }
        }
      }

      if (seenIn.length) continue;
      if (home === 'index.js' && surface.has(name)) continue;   // the public surface IS the consumer

      // Nothing outside. Does its own file use it?
      const own = W.code[home];
      const ownUses = (own.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
      const declLine = W.exportLine[home][name] || 0;
      const doc = docCommentAbove(W, home, declLine);
      /* Deliberately narrow. "a test" and "debug" on their own appear in half
         the prose in this feature; these phrases are the ones the contract and
         the modules actually use when they mean "this is a tool, not a verb". */
      const consoleOnly = /\b(?:console|headless|harness|__mk|critic)\b|tests? only|debug panel|admin panel/i.test(doc);

      W.unconsumed.add(home + '#' + name);

      if (ownUses <= 1 && !consoleOnly) {
        F.fail('DEAD EXPORTS', where,
          '`' + name + '` is exported and NAMED NOWHERE — not by another module, not by its own file, not by index.html. ZERO call sites.',
          'This is the round-1 / round-5 shape exactly: written, documented, tuned, reachable by nobody.');
      } else if (ownUses <= 1) {
        F.warn('DEAD EXPORTS', where,
          '`' + name + '` has ZERO call sites anywhere in the repo.',
          'Its own doc calls it a console/harness/debug tool, which is the only reason this is not a FAIL. If that is true, prove it from the console; if it is not, it is dead.');
      } else if (consoleOnly) {
        F.warn('DEAD EXPORTS', where,
          '`' + name + '` is used only inside ' + home + '. No other module imports it.',
          'Doc marks it console/test/debug-only, so this is a WARN, not a FAIL.');
      } else {
        F.warn('DEAD EXPORTS', where,
          '`' + name + '` is used only inside ' + home + '. No other module imports it.',
          'Either it is not part of the cross-file API and should not be exported, or its consumer was never written.');
      }
    }
  }
}

/**
 * 🔴 STRING-KEYED ACCESSORS, DISCOVERED RATHER THAN HARDCODED.
 *
 * `kitchen.state.js`, `drivethru.js` and `convoy.js` do not call the data file
 * directly. They go through `DF('cookMsFor')` — `const f = DATA[name]` — so a
 * half-written or renamed data file degrades instead of throwing. That is good
 * engineering and it is INVISIBLE to a grep for `DATA.cookMsFor`, which means a
 * naive dead-export check calls twenty live functions dead and drowns the one
 * real finding in noise. First draft of this file did exactly that.
 *
 * So the accessors are found the same way `econAccessors()` finds `EC`: any
 * function whose body indexes `DATA[<its own parameter>]`. A seventh file
 * inventing its own `D()` tomorrow is covered without editing this list.
 *
 * → Map: accessor function name → the module it reaches into.
 */
function stringAccessors(W) {
  const map = new Map();
  for (const f of MODULES) {
    const code = W.code[f];
    if (!code) continue;
    const re = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(code))) {
      const open = code.indexOf('{', m.index + m[0].length - 1);
      const end = matchBrace(code, open);
      const body = end > 0 ? code.slice(open, end) : code.slice(open, open + 400);
      const param = m[2];
      for (const [alias, target] of aliasPairs(W, f)) {
        if (new RegExp('\\b' + alias + '\\s*\\[\\s*' + param + '\\s*\\]').test(body)) map.set(m[1], target);
      }
    }
  }
  return map;
}

function aliasPairs(W, file) {
  const out = [];
  const al = W.aliases[file] || {};
  for (const target of Object.keys(al)) for (const alias of al[target]) out.push([alias, target]);
  return out;
}

/**
 * The comment block DIRECTLY above a declaration — contiguous comment lines
 * only, stopping at the first line that is not one.
 *
 * ⚠ It used to take "any comment within 24 lines above", and that read a
 * neighbouring function's doc block: a freshly injected dead export inherited
 * the word "console" from something 20 lines up and was downgraded from FAIL to
 * WARN. A checker whose severity depends on an unrelated paragraph is a
 * checker nobody will believe twice.
 */
function docCommentAbove(W, file, line) {
  if (!line) return '';
  const byLine = new Map();
  for (const c of (W.comments[file] || [])) {
    byLine.set(c.line, (byLine.get(c.line) || '') + ' ' + c.text);
  }
  const parts = [];
  for (let l = line - 1; l > 0 && byLine.has(l); l--) parts.unshift(byLine.get(l));
  return parts.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 2 — ECON KEYS, BOTH DIRECTIONS
   ───────────────────────────────────────────────────────────────────────────
   CLAUDE.md: "All operation pricing goes through `_opEcon()`. Never hardcode
   economy numbers." Kitchen's `_opEcon()` is `ECON`. Two failures live here and
   only one of them is obvious:

     DECLARED, NEVER READ  — a number a designer can tune that changes nothing.
                             Round 3's POP_REVERT family.
     READ, NEVER DECLARED  — 🔴 the dangerous one. `EC('GRADE_MIN_S')` against a
                             table with no such key yields `undefined`, and
                             `undefined` in arithmetic is `NaN`, and `NaN`
                             compares false against everything. It does not
                             throw. It does not warn. The grade just quietly
                             stops working. That is what round 5's critic found.

   Reads are counted through `ECON.KEY`, `DATA.ECON.KEY`, and every string-keyed
   accessor in the feature — the accessors are DISCOVERED, not hardcoded, by
   looking for a function whose body indexes `ECON[key]`, so a seventh file
   inventing its own `EK()` tomorrow is still covered.
   ═══════════════════════════════════════════════════════════════════════════ */

function econAccessors(W) {
  const names = new Set(['EC', 'ECb']);
  for (const f of MODULES) {
    const code = W.code[f];
    if (!code) continue;
    const re = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*key\b[^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(code))) {
      const end = matchBrace(code, code.indexOf('{', m.index + m[0].length - 1));
      const body = end > 0 ? code.slice(m.index, end) : code.slice(m.index, m.index + 400);
      if (/ECON\s*\[\s*key\s*\]/.test(body)) names.add(m[1]);
    }
  }
  return [...names];
}

function checkEcon(W, F) {
  const data = W.ns['kitchen.data.js'];
  if (!data || !data.ECON) { F.skip('ECON KEYS', 'kitchen.data.js did not import — cannot read ECON.'); return; }
  const ECON = data.ECON;
  const declared = new Set(Object.keys(ECON));
  const accessors = econAccessors(W);

  const readBy = new Map();   // key → Set(file:line)
  const hardRead = new Map(); // key → file:line   — read with NO fallback literal
  const add = (k, f, ln, hard) => {
    if (!readBy.has(k)) readBy.set(k, new Set());
    readBy.get(k).add(f + ':' + ln);
    if (hard && !hardRead.has(k)) hardRead.set(k, f + ':' + ln);
  };

  for (const f of MODULES) {
    const code = W.code[f];
    if (!code) continue;
    let m;
    const dot = /\bECON\s*\.\s*([A-Z][A-Z0-9_]*)/g;
    while ((m = dot.exec(code))) add(m[1], f, lineAt(code, m.index), true);
    for (const acc of accessors) {
      /* 🔴 THE SECOND ARGUMENT CHANGES WHAT THE BUG IS, so it is captured.
         `EC('GRADE_MIN_S')` with no fallback really does yield `undefined` and
         really does poison the arithmetic. `EC('GRADE_MIN_S', 0.92)` does not
         — it quietly serves 0.92 for ever. Both are defects (the number is
         outside the ECON table either way, so tuning ECON changes nothing),
         but they are DIFFERENT defects and a checker that calls the second one
         "silent NaN" is lying in exactly the way this file exists to stop. */
      const re = new RegExp('\\b' + acc + '\\s*\\(\\s*[\'"]([A-Za-z0-9_]+)[\'"]\\s*(,?)', 'g');
      while ((m = re.exec(code))) add(m[1], f, lineAt(code, m.index), m[2] !== ',');
    }
  }

  // ── read but never declared. Silent NaN. ──
  for (const [k, where] of readBy) {
    if (declared.has(k)) continue;
    const list = [...where];
    const hard = hardRead.get(k);
    F.fail('ECON KEYS', hard || list[0],
      hard
        ? 'ECON.' + k + ' is READ WITH NO FALLBACK and kitchen.data.js DECLARES NO SUCH KEY — it evaluates to `undefined`, and every sum touching it becomes NaN. Nothing throws.'
        : 'ECON.' + k + ' is READ but kitchen.data.js DECLARES NO SUCH KEY. Every read has a fallback literal, so the game works — on a number that lives in the READING file, where CLAUDE.md says no economy number may live. Tuning ECON does nothing.',
      'Read at: ' + list.slice(0, 5).join(', ') + (list.length > 5 ? ' (+' + (list.length - 5) + ' more)' : ''));
  }

  // ── declared but never read. A dial wired to nothing. ──
  const dataSrc = W.src['kitchen.data.js'] || '';
  const dataLines = dataSrc.split('\n');
  const lineOfKey = (k) => {
    // `KEY: 12` and the shorthand `KEY,` (ECON re-exports two tables that way).
    const re = new RegExp('^\\s*' + k + '\\s*[:,]');
    for (let i = 0; i < dataLines.length; i++) if (re.test(dataLines[i])) return i + 1;
    return 0;
  };
  const deadKeys = [];
  for (const k of declared) {
    if (readBy.has(k)) continue;
    deadKeys.push(k);
    F.fail('ECON KEYS', 'kitchen.data.js:' + lineOfKey(k),
      'ECON.' + k + ' = ' + JSON.stringify(ECON[k]) + ' is DECLARED AND READ BY NOTHING — a tuning dial connected to no wire.');
  }

  F.info('ECON KEYS', declared.size + ' keys declared · ' + readBy.size + ' distinct keys read · accessors discovered: ' + accessors.join(', '));
  return { declared, readBy, deadKeys };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 3 — COMPUTED AND NEVER READ
   ───────────────────────────────────────────────────────────────────────────
   3a. STATE FIELDS. `K.foo = …` somewhere, and `.foo` never appears anywhere
       except on the left of an `=`. Round 4's dock hold. Tight enough to be a
       FAIL: a field that is only ever written is not a field, it is a leak.

   3b. ACTION-RESULT KEYS. An exported function returns `{…, modCinder, modPop}`
       and no file other than the one that built it ever touches `.modCinder`.
       That is round 3, verbatim. Heuristic — a caller could destructure or
       forward the whole object — so it is a WARN and destructuring IS counted.
   ═══════════════════════════════════════════════════════════════════════════ */

function checkComputedNeverRead(W, F) {
  const owners = ['kitchen.state.js', 'drivethru.js', 'convoy.js'];
  const allCode = MODULES.filter(f => W.code[f]).map(f => ({ f, c: W.code[f] }));

  /* ── 3a — state fields written and never read ─────────────────────────── */
  const written = new Map();  // field → first file:line
  for (const f of owners) {
    const code = W.code[f];
    if (!code) continue;
    // K.foo = / K.shift.foo = / Kitchen.today.foo = …  (never `==`, never `=>`)
    const re = /\b(?:K|Kitchen)\s*(?:\.\s*[A-Za-z_$][\w$]*\s*)*\.\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/g;
    let m;
    while ((m = re.exec(code))) {
      if (!written.has(m[1])) written.set(m[1], f + ':' + lineAt(code, m.index));
    }
  }
  for (const [field, where] of written) {
    if (UBIQUITOUS.has(field)) continue;
    let read = false;
    for (const { c } of allCode) {
      /* Any `.field` that is NOT the target of an assignment.
         ⚠ The lookahead has to swallow the whitespace ITSELF. Written as
         `\\b\\s*(?!=)`, the `\\s*` matches zero characters and the assertion
         then looks at the SPACE before the `=`, passes, and every assignment
         counts as a read — which made this check silently find nothing at all.
         Caught only because a deliberately dead field was injected to see the
         check fire. Nothing else would have shown it. */
      const re = new RegExp('\\.\\s*' + field + '\\b(?!\\s*=(?!=))', 'g');
      if (re.test(c)) { read = true; break; }
      // …or a destructure of it
      if (new RegExp('\\{[^{}]*\\b' + field + '\\b[^{}]*\\}\\s*=').test(c)) { read = true; break; }
      // …or a computed access
      if (new RegExp('\\[\\s*[\'"]' + field + '[\'"]\\s*\\]').test(c)) { read = true; break; }
    }
    if (!read) {
      F.fail('COMPUTED, NEVER READ', where,
        'Kitchen field `' + field + '` is WRITTEN and never read back anywhere in the feature.',
        'Either something was meant to consume it, or the write is doing nothing at all.');
    }
  }

  /* One key, asked of every OTHER file: does anything read `.key`?
     🔴 FACTORED OUT IN ROUND 8 BECAUSE 3c NEEDED IT AND A SECOND COPY WOULD
        HAVE BEEN THE FILE COMMITTING ITS OWN TARGET DEFECT. Two spellings of
        "is this key read" is how one of them keeps a stale allowlist. */
  const unread = (k, ownFile) => {
    if (UBIQUITOUS.has(k)) return false;
    for (const { f: other, c } of allCode) {
      if (other === ownFile) continue;
      if (new RegExp('\\.\\s*' + k + '\\b').test(c)) return false;
      if (new RegExp('\\{[^{}]*\\b' + k + '\\b[^{}]*\\}\\s*=').test(c)) return false;
    }
    return true;
  };

  /* ── 3b — action-result keys nothing outside the producer touches ─────── */
  for (const f of owners) {
    const code = W.code[f];
    if (!code) continue;
    const fnRe = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    let m;
    while ((m = fnRe.exec(code))) {
      const fnName = m[1];
      /* If check 1 already said nothing consumes this function, listing every
         key of its return value is the same finding told eight more times. One
         loud finding beats eight quiet ones. */
      if (W.unconsumed && W.unconsumed.has(f + '#' + fnName)) continue;
      const bodyStart = code.indexOf('{', fnRe.lastIndex - 1);
      if (bodyStart < 0) continue;
      const bodyEnd = matchBrace(code, bodyStart);
      if (bodyEnd < 0) continue;
      const body = code.slice(bodyStart, bodyEnd);
      const keys = new Set();
      const retRe = /return\s+(?:[A-Za-z_$][\w$]*\s*\(\s*)?\{/g;
      let r;
      while ((r = retRe.exec(body))) {
        for (const k of literalKeys(body, body.indexOf('{', r.index + r[0].length - 1))) keys.add(k);
      }
      for (const k of keys) {
        if (unread(k, f)) {
          F.warn('COMPUTED, NEVER READ', f + ':' + lineAt(code, m.index),
            fnName + '() returns `' + k + '` and NO OTHER FILE reads `.' + k + '`.',
            'Round 3 shape: computed on every call, drawn by nobody. Heuristic — a caller forwarding the whole object would not be seen.');
        }
      }

      /* ── 3c — 🔴 THE REPORT-VARIABLE BLIND SPOT ──────────────────────────
         MEASURED, ROUND 7, BY THE PREMISE CRITIC, AND IT IS THIS FILE'S OWN
         DEFECT CLASS COMMITTED BY THIS FILE'S OWN CHECK.

         3b above scans `return {…}` and `return ok({…})` literals. The day's
         RECEIPT is neither: `closeShift()` builds it as `const report = {…}`
         and publishes it three ways — `K._report`, `emit('shift:close',
         {report})` and `emit('day:roll', {…report})`. So its keys were never
         offered to 3b at all, and three of them — `resLine` (a whole formatted
         sentence built by `resLineFor()`, with a bridge meta lookup per id),
         `net` and `lifetime` — had ZERO readers anywhere in the tree. Three
         instances of the round's defining defect, on the one screen a player
         reads to decide what to do differently tomorrow, invisible to the
         check written to find exactly that.

         So: an object literal bound to a local name inside an exported
         function, where that name is later RETURNED or handed to `emit(` /
         `raise(`, is a PUBLISHED shape and its depth-1 keys are checked like a
         returned literal's.

         ⚠ IT IS STILL A HEURISTIC AND IT UNDER-REPORTS BY DESIGN. A shape
           assembled with `Object.assign`, built key-by-key (`rep.x = …`), or
           handed to a callback rather than returned or emitted is not seen. It
           does not over-report: an unpublished local is skipped entirely. */
      const varRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
      let v;
      while ((v = varRe.exec(body))) {
        const varName = v[1];
        const open = v.index + v[0].length - 1;
        /* 🔴 `(?!\s*\.)` IS LOAD-BEARING AND IT WAS MEASURED, NOT GUESSED.
           Without it, `raise(K, null, 'convoy:launch', { id: row.id, … })` in
           `convoy.js launch()` counts as "the row is published", and the check
           then reports ten fields of a PERSISTED STATE ROW — `remoteId`,
           `paidFood`, `serverClaimed`, `clientRef` — as unread because no OTHER
           file reads them. They are convoy.js's own bookkeeping and it reads
           every one of them; "no other file" is the right question for an
           action RESULT crossing a module boundary and the wrong one for a row
           in `K.convoys`. The identifier has to be handed over WHOLE — as
           `{report}` or `{…, report}` — not merely mentioned as `row.x`. */
        const published = new RegExp('return\\s+' + varName + '\\s*[;)]').test(body)
          || new RegExp('\\b(?:emit|raise)\\s*\\([^;]{0,200}\\b' + varName + '\\b(?!\\s*\\.)').test(body);
        if (!published) continue;
        for (const k of literalKeys(body, open)) {
          if (!unread(k, f)) continue;
          F.warn('COMPUTED, NEVER READ', f + ':' + lineAt(code, bodyStart + v.index),
            fnName + '() builds `' + varName + '.' + k + '`, publishes `' + varName + '`, and NO OTHER FILE reads `.' + k + '`.',
            'The receipt shape, not the return literal — 3b cannot see this one. `closeShift().resLine` was a finished sentence on the day\'s receipt with no reader at all.');
        }
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 4 — CONTRACT DRIFT
   ───────────────────────────────────────────────────────────────────────────
   CONTRACT.md's own preamble: "a contract that lies is how four parallel
   builders disagree." It drifted for four rounds and was regenerated by hand in
   round 5. Hand-regeneration lasts exactly until the next edit, so:

     4a  every `export …` line in §1 exists, with the same parameter names
     4b  every real export appears in §1
     4c  §1's fixed id vocabulary matches the real ids
     4d  §1's declared counts ("153 keys", "(25)", "(19)") match reality
     4e  §6's closed event set matches what is actually emitted
     4f  §7's bridge table matches NULL_BRIDGE and the bridge index.html builds
   ═══════════════════════════════════════════════════════════════════════════ */

function paramsOf(fn) {
  try {
    const s = Function.prototype.toString.call(fn);
    const open = s.indexOf('(');
    if (open < 0) return null;
    const close = matchParen(s, open);
    if (close < 0) return null;
    let inner = s.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
    if (!inner.trim()) return [];
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 0) { out.push(inner.slice(start, i)); start = i + 1; }
    }
    out.push(inner.slice(start));
    return out.map(p => p.trim().split('=')[0].trim()).filter(Boolean);
  } catch (e) { return null; }
}

function matchParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')') { d--; if (!d) return i; }
  }
  return -1;
}

function checkContract(W, F) {
  const md = W.contract;
  if (!md) { F.skip('CONTRACT DRIFT', 'CONTRACT.md could not be read.'); return; }
  /* 🔴 A checker that compares nothing prints the same "clean" as one that
     compares everything. So it counts out loud what it actually compared. */
  let compared = 0, vocabChecked = 0;
  const mdLine = (needle) => {
    const idx = md.indexOf(needle);
    return idx < 0 ? 0 : lineAt(md, idx);
  };

  /* 4a/4b — signatures, per-file, from the §1 code fences. */
  const sections = [];
  const secRe = /^###\s+`public\/src\/kitchen\/([\w.]+\.js)`/gm;
  let s;
  while ((s = secRe.exec(md))) sections.push({ file: s[1], at: s.index });
  /* ⚠ Bound each block at the NEXT heading of ANY kind, not at the next
     kitchen-file heading. The last one (`index.js`) is followed by the SQL
     heading, so an unbounded slice swallowed §2 and §5 and then reported that
     §1 "declares index.js exports Kitchen" — a finding invented entirely by the
     checker. Nothing erodes trust in a tool faster. */
  for (let i = 0; i < sections.length; i++) {
    const from = sections[i].at;
    const rest = md.slice(from + 3);
    const nextHead = rest.search(/^(?:#{1,3}\s|---\s*$)/m);
    sections[i].body = nextHead < 0 ? md.slice(from) : md.slice(from, from + 3 + nextHead);
  }

  for (const sec of sections) {
    const ns = W.ns[sec.file];
    if (!ns) continue;
    const declared = new Map();  // name → params[] | null
    const fnRe = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
    let m;
    while ((m = fnRe.exec(sec.body))) {
      declared.set(m[1], m[2].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(x => x.trim().split('=')[0].trim()).filter(Boolean));
      // §1 packs several onto one line: `export function recipe(id), ingredient(id)`
      let tail = sec.body.slice(fnRe.lastIndex);
      const more = /^\s*,\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/;
      let mm;
      while ((mm = more.exec(tail))) {
        declared.set(mm[1], mm[2].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(x => x.trim().split('=')[0].trim()).filter(Boolean));
        tail = tail.slice(mm[0].length);
        fnRe.lastIndex += mm[0].length;
      }
    }
    // §1 writes `export const DAY_NAMES, POP_FACES` on one line. Both count.
    const constRe = /export\s+(?:const|class)\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)/g;
    while ((m = constRe.exec(sec.body))) for (const nm of m[1].split(',')) declared.set(nm.trim(), null);

    const real = new Set(Object.keys(ns).filter(k => k !== 'default'));

    /* CHECK 11 needs to know which exports §1 PUBLISHES — an unread one is a
       broken cross-file promise, not a note. Recorded here rather than parsed
       a second time, so the two checks can never disagree about what §1 says. */
    W.contractDeclared = W.contractDeclared || new Set();
    for (const name of declared.keys()) if (real.has(name)) W.contractDeclared.add(sec.file + '#' + name);

    for (const [name, params] of declared) {
      if (!real.has(name)) {
        F.fail('CONTRACT DRIFT', 'CONTRACT.md:' + mdLine('`public/src/kitchen/' + sec.file + '`'),
          '§1 declares `' + sec.file + '` exports `' + name + '` — the module does not export it.');
        continue;
      }
      if (params && typeof ns[name] === 'function') {
        compared++;
        const realParams = paramsOf(ns[name]);
        if (realParams && realParams.join(',') !== params.join(',')) {
          F.fail('CONTRACT DRIFT', sec.file + ':' + (W.exportLine[sec.file][name] || '?'),
            '`' + name + '` signature drift — CONTRACT §1 says (' + params.join(', ') + '), the code takes (' + realParams.join(', ') + ').',
            'CONTRACT rule 2: if you change an exported signature, you change §1 in the same edit.');
        }
      }
    }
    for (const name of real) {
      if (!declared.has(name)) {
        F.fail('CONTRACT DRIFT', sec.file + ':' + (W.exportLine[sec.file][name] || '?'),
          '`' + name + '` is exported by ' + sec.file + ' and CONTRACT §1 does not list it.',
          'Six parallel builders read §1 and not your file.');
      }
    }
  }

  /* 4c/4d — the fixed vocabulary and the counts §1 states out loud. */
  const D = W.ns['kitchen.data.js'];
  if (D) {
    const VOCAB = [
      { label: 'Ingredients', rows: D.INGREDIENTS },
      { label: 'Stations', rows: D.STATIONS },
      { label: 'Recipes', rows: D.RECIPES },
      { label: 'Customers', rows: D.CUSTOMERS },
      { label: 'Cars', rows: D.CARS },
      { label: 'Convoy tiers', rows: D.CONVOY_TIERS },
    ];
    for (const v of VOCAB) {
      if (!Array.isArray(v.rows)) continue;
      const re = new RegExp('- ' + v.label + '\\s*\\(\\*{0,2}(\\d+)\\*{0,2}\\)\\s*:\\s*`([^`]+)`', 'm');
      const m = re.exec(md);
      if (!m) { F.skip('CONTRACT DRIFT', '§1 vocabulary line for ' + v.label + ' not found in the expected shape.'); continue; }
      vocabChecked++;
      const claimed = parseInt(m[1], 10);
      const ids = m[2].split(/\s+/).map(x => x.trim()).filter(Boolean);
      const realIds = v.rows.map(r => r.id);
      if (claimed !== realIds.length) {
        F.fail('CONTRACT DRIFT', 'CONTRACT.md:' + lineAt(md, m.index),
          '§1 says ' + v.label + ' (' + claimed + '); the data file ships ' + realIds.length + '.');
      }
      const missing = realIds.filter(id => ids.indexOf(id) === -1);
      const ghost = ids.filter(id => realIds.indexOf(id) === -1);
      if (missing.length) F.fail('CONTRACT DRIFT', 'CONTRACT.md:' + lineAt(md, m.index),
        '§1\'s ' + v.label + ' list is missing shipped ids: ' + missing.join(' '));
      if (ghost.length) F.fail('CONTRACT DRIFT', 'CONTRACT.md:' + lineAt(md, m.index),
        '§1 lists ' + v.label + ' ids that do not exist: ' + ghost.join(' '));
    }
    if (D.ECON) {
      const km = /ECON\s+\/\/\s*ALL tuning\.\s*(\d+)\s*keys/.exec(md) || /\*\*No number[\s\S]{0,400}?\((\d+) of them\)/.exec(md);
      const realKeys = Object.keys(D.ECON).length;
      if (km && parseInt(km[1], 10) !== realKeys) {
        F.fail('CONTRACT DRIFT', 'CONTRACT.md:' + lineAt(md, km.index),
          'CONTRACT states ECON has ' + km[1] + ' keys; it has ' + realKeys + '.');
      }
    }
  }

  F.info('CONTRACT DRIFT', compared + ' §1 signatures compared against the live functions · '
    + vocabChecked + ' §1 id vocabularies compared against the shipped tables.');

  /* 4e — §6's closed event set vs what is emitted. */
  const evBlock = /`shift:open[\s\S]*?`/.exec(md);
  if (!evBlock) { F.skip('CONTRACT DRIFT', '§6 closed event set not found.'); }
  else {
    const closed = new Set(evBlock[0].replace(/`/g, '').split(/\s+/).map(x => x.trim()).filter(Boolean));
    const emitted = new Map();
    for (const f of MODULES) {
      const code = W.code[f];
      if (!code) continue;
      const re = /\b(?:emit|raise|raiseLater)\s*\(([^)]{0,120}?)['"]([a-z]+(?::[a-z]+)?)['"]/g;
      let m;
      while ((m = re.exec(code))) {
        if (/[{}]/.test(m[1])) continue;
        if (!emitted.has(m[2])) emitted.set(m[2], f + ':' + lineAt(code, m.index));
      }
    }
    for (const [name, where] of emitted) {
      if (!closed.has(name)) {
        F.fail('CONTRACT DRIFT', where,
          'Event `' + name + '` is emitted and is NOT in CONTRACT §6\'s closed set.',
          'A closed set stops being one the moment an unlisted event ships.');
      }
    }
    for (const name of closed) {
      if (!emitted.has(name)) {
        F.warn('CONTRACT DRIFT', 'CONTRACT.md:' + lineAt(md, evBlock.index),
          'Event `' + name + '` is in §6\'s closed set and nothing emits it.');
      }
    }
    // …and an event nobody consumes is a value computed and never drawn.
    const consumerCode = ['kitchen.render.js', 'index.js'].map(f => W.code[f] || '').join('\n');
    const orphans = [...emitted.keys()].filter(n => consumerCode.indexOf("'" + n + "'") < 0 && consumerCode.indexOf('"' + n + '"') < 0);
    if (orphans.length) {
      F.warn('CONTRACT DRIFT', 'kitchen.render.js',
        'Emitted with no literal consumer in render.js or index.js: ' + orphans.join(', '),
        'Some of these legitimately only bump `rev`. Check the ones that should have produced a toast, an FX, or a line.');
    }
  }

  /* 4f — the bridge surface, three ways. */
  const rows = [];
  const tblRe = /^\|\s*`([A-Za-z_$][\w$]*)`\s*\|/gm;
  let t;
  const s7 = md.indexOf('## 7.');
  const s8 = md.indexOf('## 8.');
  const tbl = (s7 >= 0 && s8 > s7) ? md.slice(s7, s8) : md;
  while ((t = tblRe.exec(tbl))) rows.push(t[1]);
  const contractKeys = new Set(rows);

  const nb = W.ns['kitchen.bridge.js'] && W.ns['kitchen.bridge.js'].NULL_BRIDGE;
  if (nb && contractKeys.size) {
    const nbKeys = new Set(Object.keys(nb).filter(k => k !== '_null'));
    for (const k of contractKeys) if (!nbKeys.has(k)) F.fail('CONTRACT DRIFT', 'kitchen.bridge.js',
      'NULL_BRIDGE is missing `' + k + '`, which CONTRACT §7 lists. §1: "NULL_BRIDGE mirrors EVERY key in §7."',
      'Rung 1 of the degradation ladder throws the moment something calls it.');
    for (const k of nbKeys) if (!contractKeys.has(k)) F.warn('CONTRACT DRIFT', 'kitchen.bridge.js',
      'NULL_BRIDGE defines `' + k + '`, which CONTRACT §7 does not list.');
  }

  const realBridge = W.html ? W.html.bridge : (typeof window !== 'undefined' && window.MythicKitchenBridge ? null : undefined);
  if (typeof realBridge === 'string' && realBridge) {
    const built = new Set();
    const kr = /^\s{2}(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(]/gm;
    let k;
    while ((k = kr.exec(realBridge))) built.add(k[1]);
    for (const key of contractKeys) if (!built.has(key)) F.fail('CONTRACT DRIFT', 'index.html (MythicKitchenBridge)',
      'CONTRACT §7 lists bridge key `' + key + '`; the bridge index.html builds does not define it.',
      'Every call to it lands on `undefined` at runtime — the globals trap with extra steps.');
    for (const key of built) if (!contractKeys.has(key)) F.warn('CONTRACT DRIFT', 'index.html (MythicKitchenBridge)',
      'index.html\'s bridge defines `' + key + '`, which CONTRACT §7 does not list.');
  } else if (typeof window !== 'undefined' && window.MythicKitchenBridge) {
    const built = new Set(Object.keys(window.MythicKitchenBridge));
    for (const key of contractKeys) if (!built.has(key)) F.fail('CONTRACT DRIFT', 'window.MythicKitchenBridge',
      'CONTRACT §7 lists bridge key `' + key + '`; the live bridge does not have it.');
  } else {
    F.skip('CONTRACT DRIFT', 'index.html bridge not checked (browser mode without a live bridge, or index.html unreadable).');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 5 — LIES IN COMMENTS
   ───────────────────────────────────────────────────────────────────────────
   🔴 READ THE LIMIT IN THE HEADER FIRST. This cannot read English and does not
   pretend to. It checks four shapes that this codebase uses constantly and that
   are mechanically decidable:

     5a  a PRESENT-TENSE "nothing/nobody calls X" claim that is false. Past
         tense is excluded on purpose — half the comments in this feature are
         post-mortems of round 1, and "serveCar() HAD no callers" is TRUE.
     5b  "X is called/consumed/read by <file>" where <file> does not name X.
     5c  a comment naming `ECON.SOMETHING` that ECON does not declare.
     5d  a `file.js:1234` citation pointing past the end of that file.

   What it CANNOT catch is stated in the header and is the bigger half: a
   comment that argues a wrong design in good prose. Round 5 found three of
   those arguing the opposite of the shipped numbers. Nothing here would have
   seen them.
   ═══════════════════════════════════════════════════════════════════════════ */

const HISTORICAL = /\b(?:used to|had|was|were|previously|before|no longer|until|once|round \d|shipped with|the first draft|old|earlier|never again)\b/i;

function checkCommentLies(W, F) {
  const allCode = MODULES.filter(f => W.code[f]).map(f => ({ f, c: W.code[f] }));
  const codeNames = (name) => allCode.filter(o => new RegExp('\\b' + name + '\\b').test(o.c)).map(o => o.f);
  let unverifiable = 0;

  const NOCALLER = /(?:\bhas\s+no\s+(?:caller|callers|consumer|consumers|reader|readers)\b)|(?:\bnothing\s+(?:calls|reads|consumes|draws|renders)\b)|(?:\bnobody\s+(?:calls|reads|consumes|draws|renders)\b)|(?:\bzero\s+callers?\b)/i;

  for (const f of MODULES) {
    const cs = W.comments[f] || [];
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const txt = c.text;

      /* 5a */
      if (NOCALLER.test(txt) && !HISTORICAL.test(txt)) {
        const near = [cs[i - 1] && cs[i - 1].text, txt, cs[i + 1] && cs[i + 1].text].filter(Boolean).join(' ');
        const sym = /`([A-Za-z_$][\w$]*)\(\)`/.exec(near) || /`([A-Za-z_$][\w$]*)`/.exec(near) || /\b([A-Za-z_$][\w$]*)\(\)/.exec(near);
        if (!sym) { unverifiable++; continue; }
        const name = sym[1];
        const users = allCode.filter(o => o.f !== f && new RegExp('\\b' + name + '\\s*\\(').test(o.c)).map(o => o.f);
        if (users.length) {
          F.fail('COMMENT LIES', f + ':' + c.line,
            'Comment claims `' + name + '` has no caller/consumer — but ' + users.join(', ') + ' call' + (users.length === 1 ? 's' : '') + ' it.',
            'Comment text: "' + txt.trim().slice(0, 110) + '"');
        }
      }

      /* 5b */
      const byRe = /`?([A-Za-z_$][\w$]*)\(\)`?[^.`]{0,30}?\b(?:is\s+)?(?:called|consumed|read|drawn|invoked|used)\s+by\s+`?([\w.]+\.js)`?/gi;
      let m;
      while ((m = byRe.exec(txt))) {
        const [, sym, file] = m;
        if (!W.code[file]) continue;
        if (!new RegExp('\\b' + sym + '\\b').test(W.code[file])) {
          F.fail('COMMENT LIES', f + ':' + c.line,
            'Comment says `' + sym + '()` is consumed by ' + file + ' — ' + file + ' never names it.',
            'Comment text: "' + txt.trim().slice(0, 110) + '"');
        }
      }
      const callsRe = /`?([\w.]+\.js)`?\s+(?:calls|reads|consumes|draws|renders)\s+[^.`]{0,20}?`?([A-Za-z_$][\w$]*)\(\)`?/gi;
      while ((m = callsRe.exec(txt))) {
        const [, file, sym] = m;
        if (!W.code[file]) continue;
        if (!new RegExp('\\b' + sym + '\\b').test(W.code[file])) {
          F.fail('COMMENT LIES', f + ':' + c.line,
            'Comment says ' + file + ' calls `' + sym + '()` — ' + file + ' never names it.',
            'Comment text: "' + txt.trim().slice(0, 110) + '"');
        }
      }

      /* 5c */
      const D = W.ns['kitchen.data.js'];
      if (D && D.ECON) {
        const keys = Object.keys(D.ECON);
        const er = /\bECON\.([A-Z][A-Z0-9_]*)(\*?)/g;
        while ((m = er.exec(txt))) {
          /* `ECON.Q_*` and `ECON.DEMAND_*` name a FAMILY, not a key. A family
             is a lie only when no key in it exists. Treating the wildcard as a
             key name produced four confident, wrong findings on the first run. */
          if (m[2] === '*') {
            if (!keys.some(k => k.indexOf(m[1]) === 0)) {
              F.fail('COMMENT LIES', f + ':' + c.line,
                'Comment names the ECON family ECON.' + m[1] + '* — no key in ECON starts with that.',
                'Comment text: "' + txt.trim().slice(0, 110) + '"');
            }
            continue;
          }
          if (!(m[1] in D.ECON)) {
            F.fail('COMMENT LIES', f + ':' + c.line,
              'Comment names ECON.' + m[1] + ' — no such key exists in the ECON table.',
              'Comment text: "' + txt.trim().slice(0, 110) + '"');
          }
        }
      }

      /* 5d */
      const cite = /\b([\w.\-]+\.(?:js|html|css|sql|md))\s*:\s*(\d{2,7})\b/g;
      while ((m = cite.exec(txt))) {
        const [, file, ln] = m;
        let total = 0;
        if (W.src[file]) total = W.src[file].split('\n').length;
        else if (file === 'index.html' && W.htmlLines) total = W.htmlLines;
        else continue;
        if (parseInt(ln, 10) > total) {
          F.warn('COMMENT LIES', f + ':' + c.line,
            'Citation ' + file + ':' + ln + ' points past the end of ' + file + ' (' + total + ' lines).',
            'Line citations rot on the first insert above them. This one already has.');
        }
      }
    }
  }
  if (unverifiable) {
    F.info('COMMENT LIES', unverifiable + ' present-tense "nothing calls this" claim(s) could not be tied to a symbol and were NOT checked. That is a gap, not a pass.');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 6 — RESERVED PAYLOAD KEYS
   ───────────────────────────────────────────────────────────────────────────
   CONTRACT §6, and it is written there because it already shipped: both
   emitters build the event as `Object.assign({name, t}, payload)`, so a payload
   key called `name` SILENTLY OVERWRITES THE EVENT NAME. drivethru.js once
   emitted `car:arrive` with `{name: car.name}` and every arrival in the game
   dispatched under the event name "Kid on a BMX". `on('car:arrive')` never
   fired once. Nothing threw.
   ═══════════════════════════════════════════════════════════════════════════ */

function checkReservedPayload(W, F) {
  for (const f of MODULES) {
    const code = W.code[f];
    if (!code) continue;
    const re = /\b(?:emit|raise|raiseLater)\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      const open = code.indexOf('{', m.index);
      if (open < 0) continue;
      // the payload literal is the first `{` after the event-name string
      const quote = code.slice(m.index, m.index + 160).search(/['"]/);
      if (quote < 0) continue;
      if (open > m.index + 200) continue;
      for (const k of literalKeys(code, open)) {
        if (k === 'name' || k === 't') {
          F.fail('RESERVED PAYLOAD KEYS', f + ':' + lineAt(code, open),
            'Event payload carries the reserved key `' + k + '` — it overwrites the event\'s own ' + (k === 'name' ? 'name' : 'timestamp') + ' and every subscriber stops firing, silently. Use `custName` (CONTRACT §6).');
        }
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   A SECOND SCANNER PASS — LITERAL BODIES BLANKED
   ───────────────────────────────────────────────────────────────────────────
   `scanSource()` blanks comments and KEEPS strings, because the checks above
   want to find `EC('MOD_PAY_HIT')` and `DF('cookMsFor')` inside them. The
   free-identifier check wants the opposite: a word inside a string is not a
   read, and half of kitchen.render.js is HTML in template literals.

   ⚠ THE NAIVE TEMPLATE SCANNER IS A TRAP AND IT BIT THE FIRST DRAFT. Counting
   `${` in and `}` out ends the template on the closing brace of an ordinary
   object literal or arrow body INSIDE the expression, and everything after it
   is then read as code — the first draft reported `style` as a free identifier
   in kitchen.render.js:1451, which is an HTML attribute name. So `skipTemplate`
   recurses into nested strings and templates and counts real braces.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Index just past the closing quote of the string starting at `i`. */
function skipQuoted(code, i) {
  const q = code[i];
  let j = i + 1;
  const n = code.length;
  while (j < n && code[j] !== q) { if (code[j] === '\\') j++; if (code[j] === '\n') break; j++; }
  return Math.min(j + 1, n);
}

/** Index just past the closing backtick of the template starting at `i`. */
function skipTemplate(code, i) {
  let j = i + 1;
  const n = code.length;
  while (j < n) {
    const c = code[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return j + 1;
    if (c === '$' && code[j + 1] === '{') {
      j += 2;
      let d = 1;
      while (j < n && d > 0) {
        const e = code[j];
        if (e === "'" || e === '"') { j = skipQuoted(code, j); continue; }
        if (e === '`') { j = skipTemplate(code, j); continue; }
        if (e === '{') d++; else if (e === '}') d--;
        j++;
      }
      continue;
    }
    j++;
  }
  return n;
}

/** Every string, template and regex body replaced by spaces. Offsets and line
    numbers survive, so a match index still maps to the real line. */
function blankLiterals(code) {
  const out = code.split('');
  const n = code.length;
  const REGEX_OK = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n', '+', '-', '*', '%', '<', '>', '~', '^']);
  let lastSig = '\n', i = 0;
  const sp = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'") { const e = skipQuoted(code, i); sp(i, e); i = e; lastSig = '"'; continue; }
    if (c === '`') { const e = skipTemplate(code, i); sp(i, e); i = e; lastSig = '`'; continue; }
    if (c === '/' && REGEX_OK.has(lastSig)) {
      let j = i + 1, cls = false, closed = false;
      while (j < n && code[j] !== '\n') {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === '[') cls = true;
        else if (code[j] === ']') cls = false;
        else if (code[j] === '/' && !cls) { closed = true; break; }
        j++;
      }
      if (closed) { let e = j + 1; while (e < n && /[a-z]/.test(code[e])) e++; sp(i, e); i = e; lastSig = '/'; continue; }
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return out.join('');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 7 — FREE IDENTIFIERS   🔴 the round-6 blocker, statically, in millis
   ───────────────────────────────────────────────────────────────────────────
   `judgeTicket()` read `hit`, `miss` and `meh` — three names declared NOWHERE.
   `_num(v, d)` evaluates both arguments eagerly, so the function threw
   `ReferenceError: hit is not defined` on the first modifier of any ticket;
   three separate catch blocks swallowed it; 45.6% of drive-thru customers could
   not be served; `node --check` passed; and THIS FILE reported 0 FAIL.

   A binding error is invisible to a syntax check and invisible to a name
   matcher. It is NOT invisible to "is this identifier declared anywhere in its
   own file?", which is what this check asks. It is deliberately file-scoped and
   not scope-aware: a name declared in the wrong function still counts as
   declared, so this UNDER-reports and never invents a finding.

   PROVEN TO FIRE. Against a copy of the repo with the deleted lines restored:
     drivethru.js:1288 `hit` · :1289 `miss` · :1290 `meh`   — 3 FAIL
   Against the repo as it stands: 0. Zero false positives across all eight
   modules, which took four drafts — see `skipTemplate` and `declaratorNames`
   for the two that mattered.

   🔴 WHAT IT STILL CANNOT SEE, and both are false NEGATIVES, never positives:
   a name used only inside a `${…}` template expression (the whole template is
   blanked), and a name that IS declared in the file but in a scope that cannot
   reach the use site.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Names that are always resolvable and are nobody's bug. Everything the eight
   modules legitimately touch from the platform lives here; anything NOT here
   and not declared in the file is reported, which is the point. */
const GLOBAL_NAMES = new Set((
  'Math JSON console Number String Boolean Array Object Date Set Map WeakMap WeakSet Promise Symbol ' +
  'RegExp Error TypeError RangeError ReferenceError SyntaxError EvalError URIError isNaN isFinite ' +
  'parseInt parseFloat undefined globalThis window document navigator location fetch matchMedia ' +
  'setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame ' +
  'performance localStorage sessionStorage crypto URL URLSearchParams TextEncoder TextDecoder Intl ' +
  'Proxy Reflect BigInt Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array ' +
  'Float32Array Float64Array ArrayBuffer DataView structuredClone queueMicrotask process ' +
  'Element HTMLElement Node NodeList Event CustomEvent MutationObserver ResizeObserver ' +
  'IntersectionObserver AbortController Blob File FileReader Image Audio CSS getComputedStyle ' +
  'alert confirm prompt btoa atob encodeURIComponent decodeURIComponent Function NaN Infinity ' +
  'true false null this arguments super new typeof instanceof in of void delete yield await ' +
  'async function class return if else for while do switch case default break continue try catch ' +
  'finally throw var let const export import extends static get set as from'
).split(/\s+/));

/** Binding names in one `const|let|var` statement beginning at `at`.
    🔴 `let a = 0, b = 0, c = 0` is THREE names. The first draft's regex read
    only `a`, which is why it reported 50 free identifiers of which 48 were the
    second and third declarator of an ordinary comma declaration. A check that
    cries wolf 48 times gets deleted, so this one is worth the twenty lines. */
function declaratorNames(code, at) {
  let i = at, d = 0, start = at;
  const n = code.length;
  const parts = [];
  while (i < n) {
    const c = code[i];
    if ('([{'.indexOf(c) >= 0) d++;
    else if (')]}'.indexOf(c) >= 0) { if (d === 0) break; d--; }
    else if (c === ';' && d === 0) break;
    else if (c === ',' && d === 0) { parts.push(code.slice(start, i)); start = i + 1; }
    else if (c === '\n' && d === 0) {
      // A declaration ends at a newline unless the line is obviously continued.
      const rest = code.slice(start, i).trim();
      if (rest && !/[,=+\-*/%?:&|(<>]$/.test(rest)) { parts.push(rest); start = i + 1; break; }
    }
    i++;
  }
  parts.push(code.slice(start, i));
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const m = /^(?:\{[\s\S]*?\}|\[[\s\S]*?\]|[A-Za-z_$][\w$]*)/.exec(t);
    if (m) for (const id of patternNames(m[0])) out.push(id);
  }
  return out;
}

/** Identifiers BOUND by a binding pattern — `{a, b: c}` binds `a` and `c`. */
function patternNames(pattern) {
  const cleaned = String(pattern)
    .replace(/([A-Za-z_$][\w$]*)\s*:/g, ' ')   // `b:` is the SOURCE key, not the binding
    .replace(/=[^,}\]]*/g, ' ');                // defaults are expressions, not bindings
  const out = [];
  const re = /([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(cleaned))) out.push(m[1]);
  return out;
}

/** Every name this file declares anywhere, at any depth. */
function declaredIn(code) {
  const D = new Set();
  let m;
  const decl = /\b(?:const|let|var)\s/g;
  while ((m = decl.exec(code))) for (const id of declaratorNames(code, m.index + m[0].length)) D.add(id);
  const fn = /\b(?:function\s*\*?\s*|class\s+)([A-Za-z_$][\w$]*)/g;
  while ((m = fn.exec(code))) D.add(m[1]);
  const par = /(?:function\s*\*?\s*[A-Za-z_$\w]*\s*\(([^)]*)\)|\(([^()]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/g;
  while ((m = par.exec(code))) for (const id of patternNames(m[1] || m[2] || m[3] || '')) D.add(id);
  const cat = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g;
  while ((m = cat.exec(code))) D.add(m[1]);
  const imp = /import\s*(?:\*\s*as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\}|([A-Za-z_$][\w$]*))/g;
  while ((m = imp.exec(code))) {
    if (m[1]) D.add(m[1]);
    if (m[3]) D.add(m[3]);
    if (m[2]) for (const p of m[2].split(',')) { const q = p.trim().split(/\s+as\s+/); D.add(q[q.length - 1].trim()); }
  }
  const lbl = /([A-Za-z_$][\w$]*)\s*:\s*(?:for|while|do|switch)\b/g;   // `outer:`
  while ((m = lbl.exec(code))) D.add(m[1]);
  // method shorthand — `debug() {` declares `debug` and binds its parameters
  const meth = /([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  while ((m = meth.exec(code))) { D.add(m[1]); for (const id of patternNames(m[2])) D.add(id); }
  return D;
}

function checkFreeIdentifiers(W, F) {
  let scanned = 0;
  for (const f of MODULES) {
    if (W.code[f] === undefined) continue;
    scanned++;
    const code = blankLiterals(W.code[f]);
    const D = declaredIn(code);
    const seen = new Map();
    const re = /([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(code))) {
      const id = m[1];
      if (D.has(id) || GLOBAL_NAMES.has(id)) continue;
      const prev = m.index > 0 ? code[m.index - 1] : ' ';
      if (/[\w$]/.test(prev)) continue;                       // `0xDEAD` is not an identifier
      if (/[.?]\s*$/.test(code.slice(Math.max(0, m.index - 3), m.index))) continue;   // property access
      if (/^\s*:/.test(code.slice(m.index + id.length, m.index + id.length + 3))) continue;  // key / label / case
      if (!seen.has(id)) seen.set(id, lineAt(W.src[f], m.index));
    }
    for (const [id, line] of seen) {
      F.fail('FREE IDENTIFIERS', f + ':' + line,
        '`' + id + '` is READ and is declared nowhere in ' + f + ' — not a variable, not a parameter, not an import, not a known global.',
        'This is exactly drivethru.js:1283-1285 (`hit`/`miss`/`meh`). It throws a ReferenceError the first time the line runs, a defensive catch eats it, and the mechanic dies silently.');
    }
  }
  F.info('FREE IDENTIFIERS', scanned + ' module(s) scanned. Template-literal `${…}` expressions are NOT scanned (the whole literal is blanked), so this under-reports — it never over-reports.');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 8 — CROSS-FILE STATE FIELDS   🥫 `totals.foodSpent` vs `totals.food`
   ───────────────────────────────────────────────────────────────────────────
   Round 6 shipped `K.totals.foodSpent` written in kitchen.state.js against
   `k.totals.food` read in kitchen.render.js. Every earlier check passes: the
   export is consumed, the ECON key is fine, the contract matches. The lifetime
   "food eaten" tile — the premise number — could never render for anybody, and
   this file said 0 FAIL. `Number(undefined)` is NaN and NaN fails a guard in
   silence; there is no error, no toast, nothing in the console. Only the
   spelling is wrong.

   So: collect every `K.<field>.<sub>` the SIM files touch, plus the keys of any
   object literal assigned to `K.<field>` (directly or through a factory like
   `freshToday()`), plus the field's own initialiser in the `Kitchen` literal.
   Then read kitchen.render.js and index.js for `k.<field>.<sub>` and fail on a
   sub-key nothing writes.

   Fields indexed with a variable anywhere (`K.pantry[id]`, `k.stations[sid]`)
   are SKIPPED: their sub-keys are ingredient ids, not a fixed vocabulary.

   PROVEN TO FIRE. Against a copy with the round-6 read restored:
     kitchen.render.js:4263  reads k.totals.food — nothing in the sim writes it.
                             written: binned,burnt,days,earned,foodSpent,lost,
                             served,spoiled
   ═══════════════════════════════════════════════════════════════════════════ */

const SIM_FILES = ['kitchen.state.js', 'drivethru.js', 'convoy.js'];
const READ_FILES = ['kitchen.render.js', 'index.js'];

/** Depth-1 keys of the object literal whose `{` is at `open`, in `code`. */
function objectKeysAt(code, open) {
  if (open < 0 || code[open] !== '{') return [];
  return literalKeys(code, open);
}

function checkStateFields(W, F) {
  const state = W.code['kitchen.state.js'];
  if (!state) { F.skip('STATE FIELDS', 'kitchen.state.js could not be read.'); return; }
  const km = /export\s+const\s+Kitchen\s*=\s*\{/.exec(state);
  if (!km) { F.skip('STATE FIELDS', 'the `Kitchen` literal could not be located in kitchen.state.js — the check did NOT run.'); return; }
  const litOpen = state.indexOf('{', km.index + km[0].length - 1);
  const litClose = matchBrace(state, litOpen);
  if (litClose < 0) { F.skip('STATE FIELDS', 'the `Kitchen` literal is unbalanced to this scanner — the check did NOT run.'); return; }
  const lit = state.slice(litOpen, litClose + 1);
  const fields = objectKeysAt(state, litOpen);

  const simCode = SIM_FILES.map(f => W.code[f] || '').join('\n');
  const allCode = MODULES.map(f => W.code[f] || '').join('\n');
  let fieldsChecked = 0, readsChecked = 0;

  for (const field of fields) {
    // A field indexed by a variable has no fixed sub-key vocabulary.
    if (new RegExp('[kK](?:\\(\\))?\\.' + field + '\\s*\\[').test(allCode)) continue;

    const writes = new Set();
    let m;
    const wre = new RegExp('\\bK\\.' + field + '\\.([A-Za-z_$][\\w$]*)', 'g');
    while ((m = wre.exec(simCode))) writes.add(m[1]);

    // `K.today = freshToday()` / `K.today = { … }` — the factory's keys count.
    const are = new RegExp('\\bK\\.' + field + '\\s*=\\s*', 'g');
    while ((m = are.exec(simCode))) {
      const at = are.lastIndex;
      if (simCode[at] === '{') { for (const k of objectKeysAt(simCode, at)) writes.add(k); continue; }
      const fn = /^\s*(?:[^;\n]*?\?\s*)?([A-Za-z_$][\w$]*)\s*\(/.exec(simCode.slice(at, at + 200));
      if (!fn) continue;
      const fm = new RegExp('function\\s+' + fn[1] + '\\s*\\([^)]*\\)\\s*\\{').exec(simCode);
      if (!fm) continue;
      const bOpen = fm.index + fm[0].length - 1;
      const bEnd = matchBrace(simCode, bOpen);
      if (bEnd < 0) continue;
      const body = simCode.slice(bOpen, bEnd);
      const rm = /return\s*\{/.exec(body);
      if (rm) for (const k of objectKeysAt(body, body.indexOf('{', rm.index + 6))) writes.add(k);
    }

    // …and the field's own initialiser inside the Kitchen literal.
    const im = new RegExp('(?:^|[,{])\\s*' + field + '\\s*:\\s*\\{').exec(lit);
    if (im) for (const k of objectKeysAt(lit, lit.indexOf('{', im.index + im[0].length - 1))) writes.add(k);

    if (!writes.size) continue;      // nothing to compare against; say nothing
    fieldsChecked++;

    for (const f of READ_FILES) {
      const code = W.code[f];
      if (!code) continue;
      const rre = new RegExp('\\b(?:k|K\\(\\))\\.' + field + '\\.([A-Za-z_$][\\w$]*)', 'g');
      while ((m = rre.exec(code))) {
        readsChecked++;
        const sub = m[1];
        if (writes.has(sub)) continue;
        F.fail('STATE FIELDS', f + ':' + lineAt(W.src[f], m.index),
          'reads `k.' + field + '.' + sub + '` and NOTHING in the sim writes that key. It is `undefined` every time, in silence.',
          'kitchen.state.js / drivethru.js / convoy.js write: ' + [...writes].sort().join(', ') + '. Round 6 shipped `totals.food` against `totals.foodSpent` and the tile never rendered for anybody.');
      }
    }
  }
  F.info('STATE FIELDS', fieldsChecked + ' state field(s) with a fixed sub-key vocabulary compared · ' + readsChecked + ' read(s) resolved. Fields indexed by a variable (pantry, stations) are skipped, and a read written as `State.Kitchen.x.y` or destructured out is not seen.');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 9 — CONTRACT RETURN SHAPES   (reported under CONTRACT DRIFT)
   ───────────────────────────────────────────────────────────────────────────
   §1 compares 163 signatures for EXISTENCE and never for what comes back, which
   is how `canCook(recipeId) // → boolean` survived two rounds while returning
   the `{ok,code,why}` action object — whose FAILURE value is TRUTHY. A consumer
   written against the published contract reads "every dish is cookable" and
   never finds out.

   Narrow on purpose: only §1 rows annotated `→ boolean` are checked, and only
   against `return ok(…)` / `return no(…)`, which is this codebase's one
   unambiguous action-result shape (CONTRACT §1, rule 3). Everything else needs
   a type system, and a wrong finding here would cost more than the check earns.
   ═══════════════════════════════════════════════════════════════════════════ */

function checkReturnShapes(W, F) {
  const md = W.contract;
  if (!md) return;                                  // checkContract already said SKIP
  const secs = [];
  const secRe = /^###\s+`public\/src\/kitchen\/([\w.]+\.js)`/gm;
  let s;
  while ((s = secRe.exec(md))) secs.push({ file: s[1], at: s.index });
  for (let i = 0; i < secs.length; i++) {
    const rest = md.slice(secs[i].at + 3);
    const nextHead = rest.search(/^(?:#{1,3}\s|---\s*$)/m);
    secs[i].body = nextHead < 0 ? md.slice(secs[i].at) : md.slice(secs[i].at, secs[i].at + 3 + nextHead);
  }
  let compared = 0;
  for (const sec of secs) {
    const code = W.code[sec.file];
    if (!code) continue;
    const rr = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\/\/\s*→\s*([^\n]*)/g;
    let m;
    while ((m = rr.exec(sec.body))) {
      const name = m[1], ann = m[3].trim();
      if (!/^boolean\b/i.test(ann)) continue;
      const fm = new RegExp('(?:^|\\n)export\\s+(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(code);
      if (!fm) continue;
      const ob = code.indexOf('{', fm.index + fm[0].length - 1);
      const cb = matchBrace(code, ob);
      if (ob < 0 || cb < 0) continue;
      compared++;
      const body = code.slice(ob, cb);
      const outs = [];
      const rre = /\breturn\b\s*([^\n;]*)/g;
      let r;
      while ((r = rre.exec(body))) if (/^(?:no|ok)\s*\(/.test(r[1].trim())) outs.push(r[1].trim().slice(0, 60));
      if (!outs.length) continue;
      F.fail('CONTRACT DRIFT', sec.file + ':' + (W.exportLine[sec.file][name] || '?'),
        '§1 declares `' + name + '` returns `' + ann + '` — it returns the {ok,code,why} action object, and THE FAILURE OBJECT IS TRUTHY.',
        'e.g. ' + outs[0] + ' … A caller written against §1 does `if (canCook(id))` and gets `true` for a dish it cannot cook. Fix §1, not the function.');
    }
  }
  F.info('CONTRACT DRIFT', compared + ' §1 `→ boolean` annotation(s) compared against the real return statements. Other annotated shapes ({…}, arrays, unions) are NOT compared — that needs a type checker, and a wrong finding here costs more than the check earns.');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 10 — THE EXECUTION ARM   🔴 THE ONE ROUND 6 PROVED WE NEEDED
   ───────────────────────────────────────────────────────────────────────────
   Every check above this line reads NAMES. Round 6 shipped a build in which
   45.6% of drive-thru orders could not be served and this file said 0 FAIL,
   because a `ReferenceError` inside `try { … } catch (e) {}` is structurally
   invisible to a name matcher. drivethru.js's rule 2 — never throw at a sibling
   — gives the feature ~165 defensive catch blocks. That rule is correct in a
   223k-line app AND it is exactly what hid the bug for a whole round.

   So this arm RUNS THE GAME, and it does three things a harness usually does
   not:

   1  IT INSTRUMENTS THE SWALLOWING. Every module is copied to a temp directory
      with one call injected at the top of every `catch` block, so the run can
      report what the catches ATE. A swallowed ReferenceError / TypeError /
      RangeError is always a programming error and is reported as FAIL with its
      file:line; a swallowed plain Error is control flow and is reported as
      INFO. Nothing in the repo is modified — the copies are deleted after.

   2  IT PLAYS THE PLAYER'S PATH, NOT THE BOT'S. `simulate({auto:true})` serves
      every ticket with `State.serveTicket()`. THE RENDERER DOES NOT: `doServe()`
      at kitchen.render.js:3106 routes a drive ticket to
      `DriveThru.serveCar(K, carId, now)`. That one difference is why round 6's
      blocker survived a headless suite that ran every day — the harness used a
      door the player never touches. The bot below mirrors `doServe()` exactly.
      🔴 If render.js's serve path ever changes, change this bot with it, or
      this arm goes back to testing a door nobody opens.

   3  IT ASSERTS OUTCOMES, NOT THE ABSENCE OF A THROW. Each assertion below is a
      bug that actually shipped:
        E0 a minute of play with NO game attached, on
           the real NULL_BRIDGE, throws nothing          CLAUDE.md rule 1
        E1 nothing swallowed a programming error        round 6 (`hit/miss/meh`)
        E2 the sim itself threw nothing                 tick-loop regressions
        E3 the shift served a non-zero number of orders round 5 (0 for 8 days)
        E4 a drive-thru car was served THROUGH serveCar round 1 (zero callers)
        E5 a ticket carrying a promise was servable     round 6 (45.6% could not)
        E6 a convoy composed                            round 5 (dead estimate())
        E7 the live-resource ledger moved               round 4 (LEDGER out {})
        E9 a composed convoy actually LEFT the yard     the second half of what
                                                       the player asked for
        E8 a restock done BEFORE the doors open still
           appears on the day's ledger AFTER openShift  round 6 (wiped one tap
                                                        before the screen read it)
      ── round 8: the same events, asserted on their NUMBERS ──────────────────
        E10 the truck LANDS and the live `food` rises   round 7 (`addRes('food',
            by exactly what the arrival quoted; the      owed)` → `0` scored
            arrival card says the same number the        byte-identical to the
            payload does                                 shipped build)
        E11 the till agreed with the chip: the verdict  rounds 2, 3 and 7 (the
            total is the chips it is made of, a kept     verdict drawn and never
            promise never costs and a broken one never   paid; the settlement
            pays, the toast's figure is the result's,    dropped from the tip
            the pop charge reached the meter tagged      line; 'unproven' always)
            `promise-*`, and the §SETTLEMENT actually
            moves the tip line when it is the only
            thing that changed
        E12 the wave-off charged the popularity it       round 7 (`0 *
            quoted                                        EC('POP_WAVE')`)
        E13 EVERY crate on the supply sheet costs at     round 4 (zero live
            least one of the 14 live ids                  resources / 10 days;
                                                         round 7 restored it by
                                                         deleting one line)
        E14 a crate takes out of the stash exactly what  round 6's shape, one
            it advertises, and books exactly that on     layer down: the right
            the day ledger                               event, the wrong number

   E8 is the answer to "a consumer that runs at the WRONG TIME". It is ONE
   instance of that class, hard-coded, not a general check — see the header's
   honest-limits list.

   🔴 THE BOT ASSEMBLES, AND E11 IS DEAD WITHOUT IT. Measured before it did:
   nine drive sales, `0h/0b/1u` on every promise, `modCinder` 0, `modLine` ''.
   That is CORRECT behaviour — kitchen.state.js:3145 makes an un-assembled unit
   report `built: null` on purpose, so a player who never touches assembly is
   neutral rather than paid for a promise they never made — but it meant the
   whole §SETTLEMENT half of the lane executed on nothing. The bot now lays FULL
   and HALF builds alternately, which yields both answers in one shift.

   ⚠ IT RUNS AGAINST A MEMORY-BACKED BRIDGE, NOT NULL_BRIDGE. NULL_BRIDGE's
     `spendRes` answers false by design, so a run against it can never move the
     ledger and E7 would be untestable. The stub below is the §7 bridge with a
     real 14-id stash behind it — the same seam index.html fills, with the game
     replaced by a dictionary. `bridgeReady()` is therefore true inside this arm
     and false everywhere else in the file.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The 14 live resource ids. CONTRACT §0 — exactly these, aliased to Profile.salvage. */
const EXEC_RES_IDS = ['food', 'ammo', 'water', 'medicine', 'energyDrink', 'supplies', 'metal',
  'fuel', 'corruptedEssence', 'memoryShards', 'dna', 'wood', 'stone', 'cloth'];

/** The modules the sim needs. kitchen.render.js and index.js are NOT booted —
    they want a DOM, and the bot mirrors the one render function that matters. */
const EXEC_MODULES = ['kitchen.data.js', 'kitchen.bridge.js', 'kitchen.api.js',
  'kitchen.state.js', 'drivethru.js', 'convoy.js'];

/**
 * One `__MK_SWALLOW__(e, file, line)` call injected at the top of every catch
 * block. Offsets are taken from the COMMENT-BLANKED source and applied to the
 * real source, so a `catch` written inside a comment is not instrumented and
 * the line numbers reported are the real ones.
 *
 * `.catch(` is not a catch block: the regex requires the previous character not
 * to be `.` or a word character.
 */
function instrumentCatches(src, file, blanked) {
  const re = /(^|[^.\w$])catch\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*\)\s*)?\{/g;
  const edits = [];
  let m;
  while ((m = re.exec(blanked))) edits.push({ at: m.index + m[0].length, bind: m[2] || null, line: lineAt(src, m.index) });
  let out = src;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.at)
      + 'globalThis.__MK_SWALLOW__(' + (e.bind || 'null') + ',' + JSON.stringify(file) + ',' + e.line + ');'
      + out.slice(e.at);
  }
  return { out, count: edits.length };
}

/** The §7 bridge with a dictionary where the game should be. */
function execBridge(stash, purse) {
  let mem = {};
  return {
    resources: () => EXEC_RES_IDS.map(id => ({ id, name: id })),
    meta: (id) => ({ id: String(id), name: String(id), icon: '📦', color: '#8ea0b5' }),
    getRes: (id) => stash[id] || 0,
    resourceCap: () => 1e9,
    resourceUnits: () => EXEC_RES_IDS.reduce((a, id) => a + (stash[id] || 0), 0),
    gems: () => purse.gems,
    signedIn: () => true,
    userId: () => 'u_selftest',
    displayName: () => 'Self-test',
    cloud: null,
    myCorp: () => null,
    cityProd: () => ({}),
    isAdmin: () => false,
    spendRes: (id, n) => { if ((stash[id] || 0) < n) return false; stash[id] -= n; return true; },
    addRes: (id, n) => { stash[id] = (stash[id] || 0) + n; return true; },
    refundRes: (id, n) => { stash[id] = (stash[id] || 0) + n; return true; },
    spendGems: (n) => { if (purse.gems < n) return false; purse.gems -= n; return true; },
    addGems: (n) => { purse.gems += n; return true; },
    kitchenState: () => mem,
    setKitchenState: (o) => { mem = (o && typeof o === 'object') ? o : {}; return true; },
    save: () => true,
    toast: () => {},
    confirm: async () => true,
    render: () => {},
  };
}

/** The day's live-resource bucket, wherever the sim currently keeps it.
    Round 7 moved it from `K.today` to `K.dayLedger`; read both so this arm does
    not have to be edited every time that decision is revisited. */
function execLedger(K) {
  const L = (K && K.dayLedger && typeof K.dayLedger === 'object') ? K.dayLedger : null;
  const T = (K && K.today && typeof K.today === 'object') ? K.today : {};
  const pick = (k) => {
    const a = L && L[k], b = T[k];
    if (a && typeof a === 'object' && Object.keys(a).length) return a;
    if (b && typeof b === 'object' && Object.keys(b).length) return b;
    return (a && typeof a === 'object') ? a : (b && typeof b === 'object' ? b : {});
  };
  return {
    resSpent: pick('resSpent'),
    resGained: pick('resGained'),
    cinderSpent: Math.max(Number((L && L.cinderSpent) || 0) || 0, Number(T.cinderSpent || 0) || 0),
  };
}

async function checkExecution(W, F) {
  if (!IS_NODE) {
    F.skip('EXECUTION', 'The execution arm needs a filesystem to write instrumented copies of the modules, so it runs under node only. In the browser NOTHING below was checked — and the static arm above cannot see a swallowed throw.');
    return;
  }
  let fs, os, path, urlmod, dir = null;
  try {
    fs = await import('node:fs/promises');
    os = await import('node:os');
    path = await import('node:path');
    urlmod = await import('node:url');
  } catch (e) {
    F.skip('EXECUTION', 'node builtins unavailable — ' + (e && e.message));
    return;
  }

  const swallowed = [];
  const prevHook = globalThis.__MK_SWALLOW__;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prevWindow = globalThis.window;

  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mk-selftest-'));
    let injected = 0;
    for (const f of EXEC_MODULES) {
      if (W.src[f] === undefined) { F.skip('EXECUTION', f + ' could not be read — the execution arm did NOT run.'); return; }
      const r = instrumentCatches(W.src[f], f, W.code[f]);
      injected += r.count;
      await fs.writeFile(path.join(dir, f), r.out);
    }

    globalThis.__MK_SWALLOW__ = (e, file, line) => {
      try {
        swallowed.push({
          file, line,
          kind: (e && e.constructor && e.constructor.name) || (e === null ? 'null' : typeof e),
          msg: String((e && e.message) != null ? e.message : e).slice(0, 160),
        });
      } catch (x) { /* the instrument must never be the thing that breaks the run */ }
    };

    const href = (f) => urlmod.pathToFileURL(path.join(dir, f)).href;
    const State = await import(href('kitchen.state.js'));
    const DT = await import(href('drivethru.js'));
    const CV = await import(href('convoy.js'));
    const DATA = await import(href('kitchen.data.js'));

    /* ── E0: THE OFFLINE RUNG, AGAINST THE REAL NULL_BRIDGE ────────────────
       CLAUDE.md's first non-negotiable: the app must work with no game behind
       it. `window` is not published yet, so `bridge()` returns NULL_BRIDGE —
       every reader answers 0, every mutator answers false. The kitchen must
       still tick for a minute without throwing, and without a catch block
       eating a programming error. Nothing is asserted about what it SELLS: with
       no stash there is nothing to sell, and that is the correct answer. */
    let nullRun = null;
    try {
      const r = State.simulate(60, null, { seed: 99, auto: true, quiet: true, fresh: true });
      nullRun = { errors: (r.errors || []).slice(0, 3), violations: (r.violations || []).slice(0, 3), swallowed: swallowed.length };
    } catch (e) { nullRun = { threw: String((e && e.message) || e) }; }
    const nullSwallowed = swallowed.splice(0, swallowed.length);   // scored separately, below

    const stash = {};
    for (const id of EXEC_RES_IDS) stash[id] = 4000;
    const purse = { gems: 250000 };
    globalThis.window = globalThis;
    globalThis.window.MythicKitchenBridge = execBridge(stash, purse);
    if (typeof State.reset === 'function') { try { State.reset(); } catch (e) {} }

    /* ── the bot ──────────────────────────────────────────────────────────
       A mirror of kitchen.render.js's doServe/doServeCar, plus the cook/plate
       loop and a periodic restock. Deliberately dumb: if a dumb bot cannot keep
       the board moving, the loop is not a game yet. */
    const K = State.Kitchen;
    const tally = {
      served: 0, servedDrive: 0, moddedFiled: 0, moddedServed: 0,
      moddedRefused: [], restocks: 0, botThrew: [], convoy: null,
      /* 🔴 ROUND 8. E3–E9 COUNTED OCCURRENCES; THESE HOLD VALUES.
         Three critics converged on the same sentence — "it asserts that things
         HAPPEN and never that they are RIGHT" — and proved it: seven semantic
         mutations of the drive-thru (the settlement never delivered, the
         promise paying nothing, a broken promise paying you, the wave-off free,
         `judgeMod()` always 'unproven') each scored BYTE-IDENTICAL to the
         shipped build. Every one of them is a wrong NUMBER inside an event that
         did occur, which is the only class of defect this feature has shipped
         since round 2. `tills` is one row per drive sale: what the chip
         promised, what the till paid, and what the tip line did with the
         promise on and off. */
      tills: [],
    };
    /* Popularity is charged by TWO files for one sale — `serveTicket()` prices
       the food, `serveCar()` charges the promise — and the only thing that
       tells them apart afterwards is `why`. Round 7's drive critic killed the
       promise charge outright (`bumpPop` removed) and the score did not move,
       because nothing was reading the charge. This does. */
    const popEvents = [];
    let offPop = () => {};
    try { offPop = State.on('pop:change', (ev) => { popEvents.push({ why: (ev && ev.why) || '', delta: Number((ev && ev.delta) || 0) }); }); } catch (e) {}

    /* 🔴 AND `convoy:arrive` HAS TO BE SUBSCRIBED, NOT READ OFF tick()'s RETURN.
       The first draft of E10 read the array `Convoy.tick()` returns and found
       nothing, then reported "a truck whose arrivesAt is in the past did not
       raise convoy:arrive" against a build that raises it perfectly. The reason
       is convoy.js's `raise()`: when `State.emit` exists and `State.Kitchen ===
       K` it emits through state.js and returns WITHOUT pushing to `out`,
       precisely so the same event is not delivered twice. Inside a booted sim
       that is always the live path, so the return array is empty by design. */
    const convoyEvents = [];
    let offConvoy = () => {};
    try { offConvoy = State.on('convoy:arrive', (ev) => { convoyEvents.push(ev); }); } catch (e) {}
    const seenModTickets = new Set();
    const call = (label, fn) => {
      try { return fn(); }
      catch (e) { tally.botThrew.push(label + ': ' + ((e && e.message) || e)); return null; }
    };

    const isModded = (t) => !!(t && Array.isArray(t.items)
      && t.items.some(it => it && Array.isArray(it.mods) && it.mods.length));

    /* ── THE COUNTERFACTUAL, RUN ON THE REAL TICKET, ONE FRAME BEFORE THE
       COMMIT ────────────────────────────────────────────────────────────────
       §SETTLEMENT is delivered on the tip line: `tipFor()` adds
       `verdict.cinder / payoutEstimate()` to the tip FRACTION, which
       `serveTicket()` then multiplies by the payout. There is no way to read
       that term off the outside of the call — so this asks the question twice
       with the promise the only thing that moved: `tipFor()` as it stands, then
       `tipFor()` with the ticket's `mods` arrays emptied (which is exactly what
       `judgeTicket()` walks) and immediately restored.

       🔴 THIS IS THE ONE PROBE THAT CATCHES THE ROUND-2 DEFECT COMING BACK. A
          critic deleted `+ settle` from `tipFor()`'s last line — one character
          class — and the chip still read "✓ no greens +28" while the tip paid
          32 instead of 60, at 0 FAIL. `modCinder` is returned by `serveCar()`
          whatever the till does, so no assertion on the RESULT can see it. The
          difference between these two readings is the settlement, in the
          fraction the till actually uses.

       ⚠ It mutates and restores a live ticket inside one synchronous frame,
         before the commit. `judgeTicket()` reads `item.mods` and nothing else
         off them; `payoutEstimate()`, `patiencePct()` and the generosity stack
         are untouched, which is what makes the difference the settlement and
         nothing else. */
    function settleProbe(ticketId, carId, now) {
      let ticket = null, saved = null;
      try {
        const car = (K.lane || []).find((c) => c && c.carId === carId) || null;
        ticket = (K.tickets || []).find((x) => x && x.id === ticketId) || null;
        if (!car || !ticket || !Array.isArray(ticket.items)) return null;
        if (typeof DT.tipFor !== 'function' || typeof DT.modVerdict !== 'function') return null;
        const v = DT.modVerdict(K, car, now) || null;
        saved = ticket.items.map((it) => (it && Array.isArray(it.mods)) ? it.mods : null);
        const withMods = Number(DT.tipFor(K, car, 1, now)) || 0;
        for (const it of ticket.items) if (it && Array.isArray(it.mods)) it.mods = [];
        const without = Number(DT.tipFor(K, car, 1, now)) || 0;
        return { chip: Math.round(Number((v && v.cinder) || 0)), withMods, without };
      } catch (e) {
        return null;
      } finally {
        /* 🔴 THE RESTORE IS IN A `finally` AND THAT IS NOT TIDINESS. This probe
           empties a LIVE ticket's `mods` for the length of one function call.
           If the second `tipFor()` throws — which is exactly the build this arm
           exists to catch — a restore on the happy path only would leave the
           player's order stripped of its promises, and the check would then be
           CAUSING the defect it reports. */
        try {
          if (ticket && saved) ticket.items.forEach((it, i) => { if (it && saved[i]) it.mods = saved[i]; });
        } catch (x) {}
      }
    }

    function doServe(t, now) {
      const modded = isModded(t);
      if (t.source === 'drive' && t.carId) {
        const probe = modded ? call('settleProbe', () => settleProbe(t.id, t.carId, now)) : null;
        const popBefore = Number(K.popularity) || 0;
        const popMark = popEvents.length;
        const r = call('serveCar', () => DT.serveCar(K, t.carId, now));
        if (r && r.ok) {
          tally.served++; tally.servedDrive++; if (modded) tally.moddedServed++;
          tally.tills.push({
            honoured: Number(r.honoured) || 0, broken: Number(r.broken) || 0,
            unproven: Number(r.unproven) || 0,
            modCinder: Number(r.modCinder) || 0, modPop: Number(r.modPop) || 0,
            modLine: String(r.modLine || ''),
            detail: (Array.isArray(r.mods) ? r.mods : []).map((d) => Number((d && d.cinder) || 0)),
            paid: Number(r.paid) || 0, tip: Number(r.tip) || 0,
            probe,
            popDelta: Math.round(((Number(K.popularity) || 0) - popBefore) * 1e6) / 1e6,
            popWhys: popEvents.slice(popMark).map((e) => e.why),
            popPromise: popEvents.slice(popMark).filter((e) => /^promise-/.test(e.why))
              .reduce((a, e) => a + e.delta, 0),
          });
        } else if (modded) tally.moddedRefused.push((r && r.why) || 'serveCar() threw');
        return;
      }
      const r = call('serveTicket', () => State.serveTicket(t.id, now));
      if (r && r.ok) { tally.served++; if (modded) tally.moddedServed++; }
      else if (modded) tally.moddedRefused.push((r && r.why) || 'serveTicket() threw');
    }

    const RESTOCK = ['sup_patty', 'sup_bun', 'sup_dough', 'sup_sauce', 'sup_cheese', 'sup_frank', 'sup_lettuce'];
    const LOAD_AT = 200;             // seconds: stop selling, start loading the truck

    /* ── 🔴 THE BOT NOW ASSEMBLES, AND WITHOUT THAT E11 CHECKS NOTHING ──────
       MEASURED BEFORE IT WAS ADDED: nine drive sales in a shift, verdict mix
       `0h/0b/1u` on every promise, `modCinder` 0, `modLine` empty. Not a bug —
       kitchen.state.js:3145 is explicit that an UN-ASSEMBLED unit reports
       `built: null` and `judgeMod()` reads that as 'unproven', worth nothing,
       because `startCook()` already spent the full recipe and scoring an
       un-built dish as "no onions honoured" would pay for a promise the player
       never made. The old bot never called `addStep()` ONCE, so it could not
       produce evidence, so the whole §SETTLEMENT half of the lane — the money,
       the popularity charge, the verdict line — executed on nothing.

       It lays FULL builds and HALF builds alternately, which is the cheapest
       way to get both answers out of one shift: a full burger breaks "no
       greens", a half-laid one honours it. Measured after: `{"0h/1b/0u":2,
       "1h/0b/0u":2}` — lines "✗ no greens −17", "✗ no greens −35",
       "✓ no mustard +28" ×2. Both signs, which is what E11's sign assertion
       needs to be more than a tautology.
       ⚠ `addStep()` costs no extra pantry (it refuses anything the recipe does
         not call for), so this does not change what the shift can afford. */
    let cookN = 0;
    function assemble(k, sid, i, now) {
      const slot = k.stations[sid] && k.stations[sid].slots[i];
      if (!slot || slot._mkAsm) return;
      slot._mkAsm = true;
      const r = (typeof DATA.recipe === 'function') ? DATA.recipe(slot.recipeId) : null;
      if (!r || !Array.isArray(r.steps)) return;
      const flat = [];
      for (const s of r.steps) for (let q = 0; q < Math.max(1, Number(s.qty) || 1); q++) flat.push(s.ing);
      const lay = (cookN++ % 2 === 1) ? flat.slice(0, Math.ceil(flat.length / 2)) : flat;
      for (const ing of lay) call('addStep', () => State.addStep(sid, i, ing, now));
    }

    function bot(api, k, tSec, now) {
      for (const t of k.tickets) if (isModded(t) && !seenModTickets.has(t.id)) { seenModTickets.add(t.id); tally.moddedFiled++; }

      if (Math.round(tSec * 10) % 200 === 0) {
        for (const s of RESTOCK) { const r = call('buySupply', () => State.buySupply(s, 3)); if (r && r.ok) tally.restocks++; }
      }

      if (tSec < LOAD_AT) for (const t of k.tickets.slice()) if (t.state === 'ready') doServe(t, now);

      if (!k.hand) {
        outer: for (const sid of Object.keys(k.stations)) {
          const st = k.stations[sid];
          for (let i = 0; i < st.slots.length; i++) {
            const ph = call('slotPhase', () => State.slotPhase(st.slots[i], now));
            if (ph === 'done' || ph === 'burnt') { call('pullSlot', () => State.pullSlot(sid, i, now)); break outer; }
          }
        }
      }
      if (k.hand) {
        if (k.hand.quality === 'burnt') call('dropHand', () => State.dropHand());
        else call('plateHand', () => State.plateHand(now));
      }

      // Lay a build on anything that has just started cooking. See assemble().
      for (const sid of Object.keys(k.stations)) {
        const st = k.stations[sid];
        for (let i = 0; i < st.slots.length; i++) if (st.slots[i]) assemble(k, sid, i, now);
      }
      if (tSec < LOAD_AT) for (const t of k.tickets.slice()) if (t.state === 'ready') doServe(t, now);

      if (tSec >= LOAD_AT) {
        // Cook shippable dishes so there is a load for the truck, then quote it.
        for (const sid of Object.keys(k.stations)) {
          const st = k.stations[sid];
          const free = st.slots.findIndex(s => !s);
          if (free === -1) continue;
          const cand = (DATA.RECIPES || []).filter(r => r && r.station === sid
            && (typeof DATA.shippable === 'function' ? DATA.shippable(r.id) : false)
            && (r.minLevel || 1) <= k.level);
          for (const r of cand) { const res = call('startCook', () => State.startCook(sid, free, r.id, now)); if (res && res.ok) break; }
        }
        if (!tally.convoy && (k.pass || []).length >= 6) {
          const tier = (DATA.CONVOY_TIERS || [])[0];
          if (tier) {
            const man = call('manifest', () => CV.manifest(k, tier.id, null)) || {};
            const c = man.ok ? call('compose', () => CV.compose(k, tier.id, man.items)) : null;
            tally.convoy = {
              tier: tier.id, dishes: man.dishes, fee: man.feeCinder, food: man.food,
              ok: !!man.ok, code: man.code, why: man.why,
              composed: !!(c && c.ok), composeWhy: (c && c.why) || '',
              boxes: (c && c.convoy && c.convoy.dishes) || 0,
            };
          }
        }
      }
    }

    const SHIFT_S = 280;
    let report;
    try {
      report = State.simulate(SHIFT_S, bot, { seed: 1337, auto: true, quiet: true, fresh: true });
    } catch (e) {
      F.fail('EXECUTION', 'kitchen.state.js simulate()',
        'THE SIM THREW OUT OF simulate() — ' + ((e && e.message) || e),
        'Nothing below this line ran. This is not a flaky test; a throw here is the whole game stopping.');
      return;
    }

    /* ── E9: a convoy must actually LEAVE, not merely quote ───────────────
       `launch()` is async, so it cannot run inside the sim's synchronous bot.
       Offline (cloud null) it degrades to a local truck that "turned back to
       your own city" — the designed offline behaviour, and still a real convoy
       in transit, so the assertion is that a truck EXISTS afterwards. */
    let launched = null;
    let launchedRow = null;
    try {
      const tier = (DATA.CONVOY_TIERS || [])[0];
      const man = tier ? CV.manifest(K, tier.id, null) : null;
      if (man && man.ok) {
        const c = CV.compose(K, tier.id, man.items);
        if (c && c.ok && c.convoy) {
          const before = (K.convoys || []).length;
          const r = await CV.launch(K, c.convoy, 'u_selftest', K.now);
          const last = (K.convoys || [])[(K.convoys || []).length - 1] || {};
          launchedRow = (K.convoys || []).length > before ? last : null;
          launched = {
            ok: !!(r && r.ok), why: (r && r.why) || '', id: (r && r.id) || '',
            grew: (K.convoys || []).length - before,
            state: last.state || '(none)', boxes: last.dishes || 0,
            /* The quote the loading bay put on the button, kept so E10 can hold
               the landing against it. `manifest().food` is the load BEFORE the
               road takes its cut (`estimate()` says so in as many words), so it
               is a ceiling, not the answer. */
            quotedFood: Math.max(0, Number(man.food) || 0),
            quotedDishes: Math.max(0, Number(man.dishes) || 0),
          };
        } else launched = { skipped: 'compose refused: ' + ((c && c.why) || '?') };
      } else launched = { skipped: 'manifest refused: ' + ((man && man.why) || 'no truck') };
    } catch (e) { launched = { error: String((e && e.message) || e) }; }

    /* ═══ E10 — 🔴 LAND THE TRUCK. THE SECOND HALF OF WHAT THE PLAYER ASKED
       FOR, AND UNTIL ROUND 8 NOTHING IN THIS FILE RAN IT. ═══════════════════

       "…setup shipment to send to another player's city on a convoy that will
       send the player food." E6 quoted a truck, E9 launched one, and
       `grep -n "claim" kitchen.selftest.js` returned NO CALL SITE. The arm
       stopped at the send button.

       🔴 THREE CRITICS FOUND THIS INDEPENDENTLY IN ROUND 7 AND ONE PROVED IT
          WITH A KNIFE. In a copy of the tree it changed the payout line of
          `claim()` — `b.addRes('food', owed)` → `b.addRes('food', 0)` — so the
          truck arrives, the player taps UNLOAD, and NOTHING is handed over. The
          self-test scored `0 FAIL 63 WARN · UNWIRED 29/29`, byte-identical to
          the shipped build. It then proved the mutation was real through the
          player's own door: the repo pays 12 food and the stash goes
          3616 → 3628; the mutant grants 0 and tells the player "Your stash
          filled up — 12 food is held at the depot", which is a LIE about why.
          A build that pays nothing and lies about it scored exactly as clean as
          the real one.

       It could not land by accident either: the shift is 280 simulated seconds
       and the smallest tier is a 1,200,000 ms van, so the whole back half —
       arrival, the payload, the card, the dock beat, the claim, the food
       reaching the stash — was outside the arm BY CONSTRUCTION.

       So this forces the clock rather than waiting for it: push `arrivesAt`
       into the past, run ONE `tick()` (the real `arriveDue()` path, the same
       one `catchUp()` uses), read the arrival payload and the arrival card the
       player is shown, wait out the dock beat, and call the real `claim()`.
       THE ASSERTION IS A NUMBER, NOT AN EVENT: the bridge's live `food` must
       rise by exactly the figure the arrival quoted.

       ⚠ Offline this is a PRACTICE RUN (`self:true`) — `launch()` skips the
         server leg entirely — so `claim()` takes the local branch. That is the
         right thing to exercise here for two reasons: it is the only convoy a
         signed-out player can ever land (CONTRACT §9 rungs 1–3), and the payout
         line the mutation cut is SHARED by both directions. What it does NOT
         cover is the inbound server leg — `claimConvoy()`, `firstClaim`, the
         double-payout wall — which needs a live RPC and is stated as a limit in
         the header. */
    let landing = null;
    try {
      const c = launchedRow;
      if (!c) {
        landing = { skipped: 'no truck was launched, so nothing could land' };
      } else if (c.state !== 'transit') {
        landing = { skipped: 'the launched truck is `' + c.state + '`, not in transit' };
      } else {
        const tLand = Math.max(1, Number(K.now) || 1) + 1000;
        c.arrivesAt = tLand - 1;
        const mark = convoyEvents.length;
        const evs = (CV.tick(K, 1, tLand) || []).concat(convoyEvents.slice(mark));
        const arr = evs.filter((e) => e && e.name === 'convoy:arrive'
          && String(e.id) === String(c.id)).pop() || null;
        const card = (typeof CV.arrival === 'function') ? CV.arrival(K, tLand) : null;
        /* Past the dock beat by more than its own ceiling. `CONVOY_HOLD_MS` is
           clamped to 60,000 inside convoy.js, so +61s arms the button whatever
           ECON says, and nothing retires a `self` row in between (only
           `delivered` rows — somebody else's truck — are swept). */
        const tClaim = tLand + 61000;
        const stateAfterTick = c.state;
        const before = Number(stash.food) || 0;
        const res = await CV.claim(K, c.id, tClaim);
        const after = Number(stash.food) || 0;
        landing = {
          state: stateAfterTick,
          arrived: !!arr,
          evDishes: arr ? Number(arr.dishes) : null,
          evSpoil: arr ? Number(arr.spoil) : null,
          evDelivered: arr ? Number(arr.delivered) : null,
          evFood: arr ? Number(arr.food) : null,
          cardTitle: card ? String(card.title || '') : '',
          cardLine: card ? String(card.line || '') : '',
          ok: !!(res && res.ok), code: (res && res.code) || '', why: (res && res.why) || '',
          granted: Number((res && res.granted) || 0),
          before, after, delta: after - before,
        };
      }
    } catch (e) { landing = { error: String((e && e.message) || e) }; }

    /* ═══ E12 — THE WAVE-OFF COSTS WHAT IT SAYS IT COSTS ═══════════════════
       `waveCar()` is the player's escape hatch and the file argues at length
       that "a decision that costs the same as a failure is not a decision".
       A critic made it free — `0 * EC('POP_WAVE')` — and measured popularity
       80.000 → 80.000 with the verb still answering `ok:true`. 0 FAIL.
       So: the verb must report a cost AND the meter must actually move by it.
       Both halves, or a build that reports a charge it never makes passes. */
    let waved = null;
    try {
      const car = (K.lane || []).find((x) => x && x.state !== 'gone' && x.carId);
      if (!car) {
        waved = { skipped: 'the lane was empty after the shift' };
      } else {
        const lo = Number((DATA.ECON && DATA.ECON.POP_MIN) || 0);
        const hi = Number((DATA.ECON && DATA.ECON.POP_MAX) || 100);
        const before = Number(K.popularity) || 0;
        const r = call('waveCar', () => DT.waveCar(K, car.carId, K.now));
        const after = Number(K.popularity) || 0;
        waved = {
          ok: !!(r && r.ok), why: (r && r.why) || '',
          pop: Number((r && r.pop) || 0),
          before, after, delta: Math.round((after - before) * 1e6) / 1e6,
          // At either end of the meter the clamp legitimately eats the charge.
          clamped: (before <= lo + 1e-6) || (before >= hi - 1e-6),
        };
      }
    } catch (e) { waved = { error: String((e && e.message) || e) }; }

    /* ── E8: does a pre-open restock survive `openShift()`? ────────────────
       A fresh sim, doors SHUT, buy two crates, then open. The natural player
       loop is restock-then-open, and round 6 shipped a `K.today = freshToday()`
       that erased the receipt one tap before the screen drew it. */
    let preOpen = null;
    try {
      /* 🔴 reset() FIRST, AND THAT IS NOT TIDINESS. The shift above left a real
         ledger behind; without the reset the "before" reading is contaminated
         by it and a wipe could look like a survival. The probe has to measure
         ITS OWN two crates and nothing else. */
      if (typeof State.reset === 'function') call('reset', () => State.reset());
      State.simulate(0.2, null, { seed: 4242, autoOpen: false, quiet: true, fresh: true });
      const K2 = State.Kitchen;
      const base = JSON.stringify(execLedger(K2).resSpent);
      call('preopen buy', () => State.buySupply('sup_patty', 2));
      call('preopen buy', () => State.buySupply('sup_bun', 2));
      const before = execLedger(K2);
      const dayBefore = Number((K2.shift && K2.shift.day) || 0);
      call('openShift', () => State.openShift(K2.now));
      const after = execLedger(K2);
      preOpen = {
        bought: JSON.stringify(before.resSpent) !== base,
        rolled: Number((K2.shift && K2.shift.day) || 0) !== dayBefore,
        before: JSON.stringify(before.resSpent), after: JSON.stringify(after.resSpent),
        beforeCinder: before.cinderSpent, afterCinder: after.cinderSpent,
      };
    } catch (e) {
      preOpen = { error: String((e && e.message) || e) };
    }

    /* ═══ E13 — 🔴 THE PREMISE, GUARDED MECHANICALLY ═══════════════════════
       kitchen.render.js:3641 states it to the player's face as a FACT about
       every row on the sheet: "Nothing here is bought in. Every crate is made
       out of the same 14 resources your city buildings, your businesses and
       your battles produce." That sentence IS the player's request, written
       down. It has already been false once — round 4 measured ZERO live
       resources consumed across ten days and 188 dishes — and in round 7 a
       critic made it false again by deleting ONE line from `_salvageLine()`
       (`if (primary) cost[primary] = …`), turning every scrap crate back into
       pure Cinder. The self-test scored 0 FAIL: E7 only asks whether the ledger
       MOVED, and the bot also buys core lines, so "something left the stash"
       stayed true while half the sheet stopped eating live resources and the
       banner above it became a lie.

       So the check is the sentence: EVERY row of `SUPPLY_RECIPES` must name at
       least one of the fourteen. The relief flight is the one deliberate
       exception and it is deliberately NOT in this table (kitchen.data.js:578
       says so and explains why), which is exactly what makes the rule total. */
    let premise = null;
    try {
      const rows = Array.isArray(DATA.SUPPLY_RECIPES) ? DATA.SUPPLY_RECIPES : null;
      if (!rows || !rows.length) {
        premise = { skipped: 'kitchen.data.js published no SUPPLY_RECIPES' };
      } else {
        const live = new Set(EXEC_RES_IDS);
        const bad = [];
        const byKind = {};
        for (const s of rows) {
          const kind = (s && s.kind) || 'core';
          byKind[kind] = (byKind[kind] || 0) + 1;
          const cost = (s && s.cost && typeof s.cost === 'object') ? s.cost : {};
          const legs = Object.keys(cost).filter((k) => live.has(k) && Number(cost[k]) > 0);
          if (!legs.length) bad.push(((s && s.id) || '?') + ' ' + JSON.stringify(cost));
        }
        premise = { total: rows.length, byKind, bad };
      }
    } catch (e) { premise = { error: String((e && e.message) || e) }; }

    /* ═══ E14 — WHAT THE CRATE SAYS AGAINST WHAT THE STASH LOSES ═══════════
       E7 asks whether the ledger moved. This asks whether it moved by the RIGHT
       AMOUNT: buy one declared crate on a fresh, shut kitchen and require the
       live stash to fall by exactly the cost printed on the row, and the day's
       ledger to record exactly the same figure. A crate that advertises 3 food
       and takes 1 — or takes 3 and books 1 on the receipt — is a wrong number
       inside an event that occurred, which is every defect this feature has
       shipped since round 6. */
    let crate = null;
    try {
      if (typeof State.reset === 'function') call('reset', () => State.reset());
      State.simulate(0.2, null, { seed: 909, autoOpen: false, quiet: true, fresh: true });
      const K3 = State.Kitchen;
      const live = new Set(EXEC_RES_IDS);
      const rows = Array.isArray(DATA.SUPPLY_RECIPES) ? DATA.SUPPLY_RECIPES : [];
      // The cheapest level-1 line with a live leg — whatever the sheet happens
      // to hold, so this does not have to be edited when a crate is renamed.
      const row = rows.filter((s) => s && s.cost && Number(s.minLevel || 1) <= Math.max(1, Number(K3.level) || 1)
        && Object.keys(s.cost).some((k) => live.has(k) && Number(s.cost[k]) > 0))
        .sort((a, b) => Number(a.cost.cinder || 0) - Number(b.cost.cinder || 0))[0] || null;
      if (!row) {
        crate = { skipped: 'no buyable crate on this sheet carries a live-resource leg' };
      } else {
        const want = {};
        for (const k of Object.keys(row.cost)) if (live.has(k) && Number(row.cost[k]) > 0) want[k] = Number(row.cost[k]);
        const before = {}; for (const k of Object.keys(want)) before[k] = Number(stash[k]) || 0;
        /* 🔴 A COPY, NOT THE BUCKET. `execLedger()` hands back the LIVE
           `K.dayLedger.resSpent` object, so holding it as "before" and reading
           it again as "after" compares a thing to itself and every delta is 0.
           The first draft of this probe did exactly that and reported a real
           crate as booking nothing — the check inventing its own finding, which
           is the failure mode this file is least allowed to have. */
        const ledBefore = Object.assign({}, execLedger(K3).resSpent);
        const r = call('buy one crate', () => State.buySupply(row.id, 1));
        const got = {}, led = {};
        for (const k of Object.keys(want)) {
          got[k] = before[k] - (Number(stash[k]) || 0);
          led[k] = (Number(execLedger(K3).resSpent[k]) || 0) - (Number(ledBefore[k]) || 0);
        }
        crate = {
          id: row.id, ok: !!(r && r.ok), why: (r && r.why) || '',
          want, got, led,
          stashMismatch: Object.keys(want).filter((k) => got[k] !== want[k]),
          ledgerMismatch: Object.keys(want).filter((k) => led[k] !== want[k]),
        };
      }
    } catch (e) { crate = { error: String((e && e.message) || e) }; }

    /* ── the verdicts ────────────────────────────────────────────────────── */
    F.info('EXECUTION', 'one ' + SHIFT_S + 's shift played through the PLAYER\'s doors (seed 1337, fresh account, memory-backed bridge) · '
      + injected + ' catch blocks instrumented · served ' + tally.served + ' (' + tally.servedDrive + ' through the lane window)'
      + ' · promises filed ' + tally.moddedFiled + ' / served ' + tally.moddedServed
      + ' · restocks ' + tally.restocks + ' · level ' + report.level + ' · pass ' + ((K.pass || []).length));

    // E0 — the offline rung.
    if (nullRun && nullRun.threw) {
      F.fail('EXECUTION', 'NULL_BRIDGE', 'A minute of play with NO game attached THREW: ' + nullRun.threw,
        'CLAUDE.md, first non-negotiable: the feature must degrade, not fall over, when the bridge is not there.');
    } else {
      for (const e of (nullRun.errors || [])) F.fail('EXECUTION', 'NULL_BRIDGE', 'Offline run recorded a thrown error: ' + e);
      for (const v of (nullRun.violations || [])) F.fail('EXECUTION', 'NULL_BRIDGE', 'Offline run violated an invariant: ' + v);
      const badNull = nullSwallowed.filter(x => /^(?:ReferenceError|TypeError|RangeError|SyntaxError)$/.test(x.kind));
      for (const x of badNull.slice(0, 5)) {
        F.fail('EXECUTION', x.file + ':' + x.line,
          'OFFLINE (NULL_BRIDGE): a catch block swallowed ' + x.kind + ': ' + x.msg,
          'The no-game path is the one nobody plays and everybody ships. A broken line there is invisible until a real player loads before sign-in.');
      }
      F.info('EXECUTION', 'offline rung (NULL_BRIDGE, no window, 60s): no throw, ' + nullSwallowed.length + ' catch block(s) fired, ' + badNull.length + ' of them a programming error.');
    }

    // E1 — what the catches ate.
    const BROKEN = /^(?:ReferenceError|TypeError|RangeError|SyntaxError|URIError|EvalError)$/;
    const bySite = new Map();
    for (const s of swallowed) {
      const key = s.file + ':' + s.line + '|' + s.kind + '|' + s.msg;
      const row = bySite.get(key) || { n: 0, s };
      row.n++; bySite.set(key, row);
    }
    let programmingErrors = 0;
    for (const [, row] of bySite) {
      if (!BROKEN.test(row.s.kind)) continue;
      programmingErrors++;
      F.fail('EXECUTION', row.s.file + ':' + row.s.line,
        'A catch block SWALLOWED ' + row.s.kind + ': ' + row.s.msg + '  (' + row.n + '× in one shift)',
        'A ReferenceError or TypeError is never control flow — it is broken code, and a defensive catch turns it into a mechanic that silently does nothing. This is round 6, exactly: three names declared nowhere, three catches, 45.6% of the lane unservable, 0 FAIL.');
    }
    for (const [, row] of bySite) {
      if (BROKEN.test(row.s.kind)) continue;
      F.info('EXECUTION', 'swallowed (not fatal): ' + row.s.file + ':' + row.s.line + ' ' + row.s.kind + ': ' + row.s.msg + ' ×' + row.n);
    }
    if (!swallowed.length) F.info('EXECUTION', 'no catch block caught anything at all during the shift.');

    // E2 — the sim's own error/violation channels.
    for (const e of (report.errors || [])) F.fail('EXECUTION', 'simulate()', 'The sim recorded a thrown error: ' + e);
    for (const v of (report.violations || [])) F.fail('EXECUTION', 'simulate()', 'INVARIANT VIOLATED (CONTRACT §11): ' + v);
    for (const e of tally.botThrew.slice(0, 6)) F.fail('EXECUTION', 'the bot', 'A player verb threw out of its own module: ' + e);

    // E3 — a shift must sell food.
    if (tally.served <= 0) {
      F.fail('EXECUTION', 'the shift', 'ZERO orders were served in ' + SHIFT_S + 's of play. The loop does not close.',
        'Round 5 shipped eight consecutive days of served 0 / lost 36–41. That is what this assertion exists to make impossible to miss.');
    }

    // E4 — the lane's own door, the one round 1 left with zero callers.
    const laneTickets = (report.counts && (report.counts['car:order'] || 0)) || 0;
    if (laneTickets > 0 && tally.servedDrive <= 0) {
      F.fail('EXECUTION', 'drivethru.js serveCar()',
        laneTickets + ' car(s) ordered at the speaker and NOT ONE was served through `DriveThru.serveCar()` — the door kitchen.render.js:3106 actually uses.',
        'Round 1: serveCar()/waveCar() had zero callers and every lane sale went through State.serveTicket(), so no tip, no verdict, no voice at the window, and 28% of the authored dialogue was unreachable.');
    }

    // E5 — the promise mechanic, end to end. THE round-6 blocker.
    if (tally.moddedFiled > 0 && tally.moddedServed <= 0) {
      F.fail('EXECUTION', 'drivethru.js serveCar()',
        tally.moddedFiled + ' ticket(s) carrying a promise were filed and NOT ONE could be served. First refusal: "' + (tally.moddedRefused[0] || 'no reason given') + '"',
        'This is round 6\'s blocker with the numbers on it: a correctly-cooked order that honours every promise cannot be handed over. 45.6% of drive-thru tickets carry one.');
    } else if (tally.moddedFiled > 0 && tally.moddedRefused.length > tally.moddedServed) {
      F.warn('EXECUTION', 'drivethru.js serveCar()',
        'More promise tickets were REFUSED (' + tally.moddedRefused.length + ') than served (' + tally.moddedServed + '). First refusal: "' + tally.moddedRefused[0] + '"',
        'Some refusals are legitimate (the pass no longer covers the order). A majority is not.');
    }

    // E6 — a convoy must be composable.
    if (!tally.convoy) {
      F.warn('EXECUTION', 'convoy.js',
        'The bot never got ' + 6 + ' shippable plates onto the pass, so the convoy was NOT exercised. Treat convoy as UNCHECKED this run, not as passing.');
    } else if (!tally.convoy.ok || !tally.convoy.composed) {
      F.fail('EXECUTION', 'convoy.js manifest()/compose()',
        'A full pass could not compose a convoy: manifest ' + tally.convoy.code + ' "' + tally.convoy.why + '"'
        + (tally.convoy.composed ? '' : ' · compose refused "' + tally.convoy.composeWhy + '"'),
        'Round 5 shipped `estimate()` — the one function that quotes a truck — with zero call sites, and the panel and the launch disagreed about what a load cost.');
    } else {
      F.info('EXECUTION', 'convoy composed: ' + tally.convoy.boxes + ' boxes on the ' + tally.convoy.tier
        + ' · freight ' + tally.convoy.fee + ' Cinder · ' + tally.convoy.food + ' food on landing.');
    }

    // E9 — the truck leaves the yard.
    if (launched && launched.error) {
      F.fail('EXECUTION', 'convoy.js launch()', 'launch() THREW: ' + launched.error,
        'It is async and it is the only door a shipment leaves by. A throw here is the convoy half of the feature, gone.');
    } else if (launched && launched.skipped) {
      F.warn('EXECUTION', 'convoy.js launch()', 'The truck was never launched (' + launched.skipped + '), so E9 is UNCHECKED this run.');
    } else if (launched && (!launched.ok || launched.grew < 1)) {
      F.fail('EXECUTION', 'convoy.js launch()',
        'A composed convoy did not leave: ok=' + launched.ok + ', K.convoys grew by ' + launched.grew + '. "' + launched.why + '"',
        'The player asked for shipments to another city. Offline the honest answer is a truck that turns back — but it must still be a truck.');
    } else if (launched) {
      F.info('EXECUTION', 'convoy launched: ' + launched.boxes + ' boxes, state `' + launched.state + '`, id ' + launched.id
        + (launched.why ? ' · "' + launched.why + '"' : ''));
    }

    // E7 — the premise: live resources must actually move.
    const spentIds = Object.keys(report.resSpent || {}).filter(id => Number(report.resSpent[id]) > 0);
    if (tally.restocks > 0 && !spentIds.length) {
      F.fail('EXECUTION', 'the ledger',
        tally.restocks + ' restock(s) succeeded and the day\'s ledger recorded NO live resource leaving the stash.',
        'The whole premise is that this kitchen eats what the city, the businesses and the battles produce. A round shipped 188 dishes with LEDGER out {}.');
    } else {
      F.info('EXECUTION', 'ledger moved: out ' + JSON.stringify(report.resSpent || {}) + ' · in ' + JSON.stringify(report.resGained || {}) + ' · ' + (report.cinderSpent || 0) + ' Cinder.');
    }

    // E8 — the consumer that runs at the wrong time.
    if (preOpen && preOpen.error) {
      F.warn('EXECUTION', 'openShift()', 'The pre-open restock probe threw: ' + preOpen.error + ' — E8 was NOT checked.');
    } else if (preOpen && !preOpen.bought) {
      F.warn('EXECUTION', 'openShift()', 'The pre-open restock bought nothing, so E8 (does the ledger survive opening?) was NOT checked this run.');
    } else if (preOpen && preOpen.rolled) {
      F.warn('EXECUTION', 'openShift()', 'openShift() rolled the in-game day, so clearing the ledger would be correct and E8 was NOT checked this run.');
    } else if (preOpen && preOpen.before !== preOpen.after) {
      F.fail('EXECUTION', 'kitchen.state.js openShift()',
        'A restock made BEFORE the doors open does not survive openShift(): the day ledger goes ' + preOpen.before + ' → ' + preOpen.after
        + ' (Cinder ' + preOpen.beforeCinder + ' → ' + preOpen.afterCinder + ') WITHOUT the day rolling.',
        'restock-then-open is the natural loop, so the day report shows the player zeros for the Cinder they just spent. Every static check passes on this — writer, reader and renderer all exist. "Wired" and "reaches the player" are different questions; this is the second one.');
    } else if (preOpen) {
      F.info('EXECUTION', 'a pre-open restock survives openShift(): ' + preOpen.before + ' still on the day ledger after the doors open.');
    }

    /* ── E10 — the truck lands and the food arrives. ───────────────────────
       Read the block above E10 before touching any of this. The one assertion
       that matters is `delta === evFood`: the LIVE stash rising by the number
       the arrival quoted. Everything else here exists to say which half broke
       when it does not. */
    if (landing && landing.error) {
      F.fail('EXECUTION', 'convoy.js claim()', 'THE LANDING PATH THREW: ' + landing.error,
        'arriveDue() → the arrival payload → claim() is the second half of what the player asked for. A throw here is a truck that can never be unloaded.');
    } else if (landing && landing.skipped) {
      F.warn('EXECUTION', 'convoy.js claim()', 'No convoy could be landed (' + landing.skipped + '), so E10 is UNCHECKED this run — the claim path did not execute.');
    } else if (landing) {
      if (!landing.arrived) {
        F.fail('EXECUTION', 'convoy.js arriveDue()',
          'A truck whose `arrivesAt` is in the past did not raise `convoy:arrive` after a tick(); the row is `' + landing.state + '`.',
          'Nothing downstream of this — the card, the dock beat, the claim, the food — can happen at all.');
      } else {
        if (!Number.isFinite(landing.evDelivered) || !Number.isFinite(landing.evSpoil)
            || landing.evDelivered !== landing.evDishes - landing.evSpoil) {
          F.fail('EXECUTION', 'convoy.js arriveDue()',
            'The arrival payload is wrong: dishes ' + landing.evDishes + ' − spoil ' + landing.evSpoil
            + ' should be delivered ' + (landing.evDishes - landing.evSpoil) + ', and it says ' + landing.evDelivered + '.',
            'THE ARRIVAL CARD PRINTS "undefined boxes handed over." This is round 6 exactly: `route()` stopped publishing `delivering`/`spoilFinal`, two readers were left behind, and the payoff screen of the whole feature said `undefined` for a round at zero page errors.');
        }
        if (/undefined|NaN/.test(landing.cardLine + landing.cardTitle)) {
          F.fail('EXECUTION', 'convoy.js noteArrival()',
            'The arrival card the player is shown reads "' + landing.cardTitle + ' ' + landing.cardLine + '".',
            'Round 6 shipped literally this string on the payoff screen. The card is the only convoy outcome a signed-out player can reach.');
        } else if (landing.cardLine.indexOf(String(landing.evDelivered)) === -1) {
          F.fail('EXECUTION', 'convoy.js noteArrival()',
            'The arrival card says "' + landing.cardLine + '" and the payload delivered ' + landing.evDelivered + ' boxes — the card and the event disagree about the same landing.',
            'Two derivations of one number is how only one of them gets fixed; convoy.js says so itself at `deliveredOf()`.');
        }
        if (!landing.ok) {
          F.fail('EXECUTION', 'convoy.js claim()',
            'The player tapped UNLOAD on a landed truck and was refused: ' + landing.code + ' "' + landing.why + '" (granted ' + landing.granted + ').',
            'Offline this is a practice run with no server leg, so there is nothing legitimate to refuse. A refusal here is the convoy half of the feature not paying out.');
        }
        if (landing.delta !== landing.evFood) {
          F.fail('EXECUTION', 'convoy.js claim()',
            'THE TRUCK LANDED AND THE FOOD DID NOT: the arrival quoted ' + landing.evFood
            + ' food, the claim answered ' + (landing.ok ? 'ok' : landing.code) + ' granted=' + landing.granted
            + ', and the live stash went ' + landing.before + ' → ' + landing.after + ' (Δ' + landing.delta + ').'
            + (landing.why ? ' It told the player: "' + landing.why + '"' : ''),
            'This is the assertion the whole arm was missing. A critic cut `addRes(\'food\', owed)` to `addRes(\'food\', 0)` and this file scored byte-identical to the shipped build while the player got nothing and was told their stash was full.');
        } else if (landing.granted !== landing.delta) {
          F.fail('EXECUTION', 'convoy.js claim()',
            'The claim says it granted ' + landing.granted + ' food and the stash moved by ' + landing.delta + '.',
            'The receipt and the ledger are the same transaction. The renderer prints `granted`; the player owns the stash.');
        } else {
          const cut = Math.max(0, (launched && launched.quotedFood) || 0) - landing.evFood;
          F.info('EXECUTION', 'convoy LANDED and PAID: ' + landing.evDishes + ' boxes − ' + landing.evSpoil
            + ' spoiled = ' + landing.evDelivered + ' delivered · card "' + landing.cardTitle + ' ' + landing.cardLine
            + '" · claim granted ' + landing.granted + ' · live food ' + landing.before + ' → ' + landing.after
            + ' · the bay quoted ' + ((launched && launched.quotedFood) || 0) + ' before the road took ' + cut + '.');
        }
      }
    }

    /* ── E12 — the wave-off. ───────────────────────────────────────────── */
    if (waved && waved.error) {
      F.fail('EXECUTION', 'drivethru.js waveCar()', 'waveCar() THREW: ' + waved.error);
    } else if (waved && waved.skipped) {
      F.warn('EXECUTION', 'drivethru.js waveCar()', 'E12 UNCHECKED this run (' + waved.skipped + ').');
    } else if (waved && !waved.ok) {
      F.warn('EXECUTION', 'drivethru.js waveCar()', 'The wave-off refused a live car: "' + waved.why + '" — E12 UNCHECKED.');
    } else if (waved && !waved.clamped && (!waved.pop || Math.abs(waved.delta - waved.pop) > 0.001)) {
      F.fail('EXECUTION', 'drivethru.js waveCar()',
        'The wave-off reported a cost of ' + waved.pop + ' pop and popularity moved ' + waved.before + ' → ' + waved.after + ' (Δ' + waved.delta + ').',
        'The escape hatch is meant to be a DECISION — "a decision that costs the same as a failure is not a decision", this file\'s own words. A free wave-off, or a charge reported and never made, deletes the choice. A critic zeroed POP_WAVE here and the score did not move.');
    } else if (waved) {
      F.info('EXECUTION', 'the wave-off charged what it quoted: ' + waved.pop + ' pop, meter ' + waved.before + ' → ' + waved.after + '.');
    }

    /* ── E11 — 🔴 THE TILL AGAINST THE CHIP, IN CINDER. ────────────────────
       Not "a promise ticket was servable" (E5) but "the number the player was
       shown is the number the player received". Four independent readings of
       one transaction: the chips the verdict is made of, the total the toast
       prints, the tip fraction the till uses, and the popularity meter. */
    const tills = tally.tills;
    const withVerdict = tills.filter((x) => x.honoured || x.broken);
    if (!tills.length) {
      F.warn('EXECUTION', 'drivethru.js serveCar()', 'No drive sale was recorded, so E11 (the till against the chip) is UNCHECKED this run.');
    } else if (!withVerdict.length) {
      F.warn('EXECUTION', 'drivethru.js judgeTicket()',
        tills.length + ' drive sale(s) were recorded and NOT ONE carried an honoured or broken promise (verdict mix: '
        + JSON.stringify(tills.map((x) => x.honoured + 'h/' + x.broken + 'b/' + x.unproven + 'u'))
        + '), so E11 — the till against the chip — is UNCHECKED this run.',
        'That may be the seed rather than the code, but an unproven-only shift means the whole §SETTLEMENT half of the lane executed nothing. If it is EVERY run, the mechanic is decoration.');
    } else if (tally.moddedServed > 0 && !withVerdict.length) {
      F.fail('EXECUTION', 'drivethru.js judgeTicket()',
        tally.moddedServed + ' ticket(s) carrying a promise were served and NOT ONE produced an honoured or broken verdict — every promise came back unproven.',
        'The mechanic is then decoration: the chips draw, the toast prints, and nothing is ever kept or broken. A critic made `judgeMod()` answer "unproven" always and this file scored 0 FAIL.');
    } else {
      let badSum = null, badSign = null, badLine = null, badPop = null, badSettle = null;
      let settleChecked = 0;
      for (const x of withVerdict) {
        // 1 · the total the toast prints IS the chips it is made of.
        const sum = x.detail.reduce((a, n) => a + n, 0);
        if (!badSum && Math.abs(x.modCinder - sum) > 0.5 * x.detail.length + 1) badSum = { x, sum };
        // 2 · a promise kept cannot cost and a promise broken cannot pay.
        if (!badSign) {
          if (x.broken && !x.honoured && x.modCinder > 0) badSign = { x, want: 'a broken promise must not PAY' };
          else if (x.honoured && !x.broken && x.modCinder < 0) badSign = { x, want: 'a kept promise must not COST' };
        }
        // 3 · the sentence on the toast carries the same figure as the result.
        if (!badLine && x.modLine) {
          const seg = String(x.modLine).split(' · ')[0];
          const m = /([+−])(\d+)\s*$/.exec(seg);
          const shown = m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0;
          if (m && shown !== Math.round(x.modCinder)) badLine = { x, shown };
        }
        // 4 · the popularity charge actually reached the meter, tagged as itself.
        if (!badPop && x.modPop && !x.popWhys.some((w) => /^promise-/.test(w))) badPop = { x };
        else if (!badPop && x.modPop && Math.abs(x.popPromise - x.modPop) > 0.011) badPop = { x };
        // 5 · the settlement rides the tip line. See settleProbe()'s block.
        const p = x.probe;
        if (p && p.chip && p.withMods > 0 && p.without > 0
            && p.withMods < Number((DATA.ECON && DATA.ECON.TIP_FRACTION_MAX) || 0.95) - 1e-9
            && p.without < Number((DATA.ECON && DATA.ECON.TIP_FRACTION_MAX) || 0.95) - 1e-9) {
          settleChecked++;
          const moved = (p.withMods - p.without) * (x.paid || 0);
          if (!badSettle && Math.sign(p.withMods - p.without) !== Math.sign(p.chip)) badSettle = { x, moved };
        }
      }
      if (badSum) {
        F.fail('EXECUTION', 'drivethru.js judgeTicket()',
          'The verdict total and the chips it is made of disagree: modCinder ' + badSum.x.modCinder
          + ' against Σ chips ' + Math.round(badSum.sum) + ' over ' + badSum.x.detail.length + ' modifier(s) ("' + badSum.x.modLine + '").',
          'The chips are what the player reads on the card before committing; the total is what the settlement is priced from. A critic zeroed the total and left the chips — the card still promised +28 and the till moved nothing.');
      }
      if (badSign) {
        F.fail('EXECUTION', 'drivethru.js judgeTicket()',
          badSign.want + ' — this one paid ' + badSign.x.modCinder + ' Cinder on ' + badSign.x.honoured + ' kept / ' + badSign.x.broken + ' broken ("' + badSign.x.modLine + '").',
          'Round 7 mutation M3: breaking a promise paid the player. The mechanic inverts and every surface still reads as if it worked.');
      }
      if (badLine) {
        F.fail('EXECUTION', 'drivethru.js verdictLine()',
          'The reward toast says "' + badLine.x.modLine + '" (' + badLine.shown + ') and the result carries modCinder ' + badLine.x.modCinder + '.',
          'The sentence and the number are the same transaction told twice. Round 2 shipped a verdict drawn on screen that the till never paid.');
      }
      if (badPop) {
        F.fail('EXECUTION', 'drivethru.js serveCar()',
          'The verdict quoted ' + badPop.x.modPop + ' pop and the meter recorded ' + badPop.x.popPromise
          + ' from a promise (pop:change reasons this sale: [' + badPop.x.popWhys.join(', ') + ']).',
          'Word-of-mouth is the promise\'s second channel and `serveCar()` is the only place it is charged. A critic removed the charge and obey/defy/ignore all moved popularity by an identical amount.');
      }
      if (badSettle) {
        F.fail('EXECUTION', 'drivethru.js tipFor()',
          'THE CHIP QUOTES A SETTLEMENT THE TILL DOES NOT DELIVER: the chip promised ' + badSettle.x.modCinder
          + ' Cinder and the tip fraction moved by ' + (Math.round(badSettle.moved * 100) / 100)
          + ' Cinder of a ' + badSettle.x.paid + ' payout when the promise was the only thing that changed.',
          'Round 2\'s headline finding, restored by a critic in round 7 with one deletion (`total = max(tipPct,MIN) + settle` → `max(tipPct,MIN)`): chip "✓ no greens +28", tip 32 instead of 60, 0 FAIL. §SETTLEMENT is the promise\'s ONLY Cinder channel — if it does not ride the tip line it does not exist.');
      }
      if (!badSum && !badSign && !badLine && !badPop && !badSettle) {
        const s = withVerdict.reduce((a, x) => a + x.modCinder, 0);
        F.info('EXECUTION', 'the till agreed with the chip on all ' + withVerdict.length + ' promise sale(s): '
          + s + ' Cinder settled, popularity charged as `promise-*` on every one, and the settlement was isolated on the tip line for '
          + settleChecked + ' of them.' + (settleChecked ? '' : ' ⚠ the tip-line isolation had no unclamped sample this run.'));
      }
      if (withVerdict.length && !settleChecked) {
        F.warn('EXECUTION', 'drivethru.js tipFor()',
          'No promise sale gave an unclamped reading of the tip line this run, so the §SETTLEMENT probe checked NOTHING. Treat "the promise is paid" as unverified, not as passing.');
      }
    }

    /* ── E13 — the premise. ────────────────────────────────────────────── */
    if (premise && premise.error) {
      F.fail('EXECUTION', 'kitchen.data.js SUPPLY_RECIPES', 'The premise check threw: ' + premise.error);
    } else if (premise && premise.skipped) {
      F.fail('EXECUTION', 'kitchen.data.js SUPPLY_RECIPES', premise.skipped + ' — the supply sheet is the feature.');
    } else if (premise && premise.bad.length) {
      F.fail('EXECUTION', 'kitchen.data.js SUPPLY_RECIPES',
        premise.bad.length + ' of ' + premise.total + ' crate(s) cost NO live resource at all: ' + premise.bad.slice(0, 6).join(' · '),
        'kitchen.render.js tells the player "Nothing here is bought in. Every crate is made out of the same 14 resources your city buildings, your businesses and your battles produce." That sentence IS the request. Round 4 broke it at ZERO live resources over ten days; a round-7 critic broke it again by deleting one line of `_salvageLine()` and scored 0 FAIL, because E7 only asks whether the ledger moved. The relief flight is the one deliberate Cinder-only door and it is deliberately not in this table.');
    } else if (premise) {
      F.info('EXECUTION', 'the premise holds on the sheet: all ' + premise.total + ' crate(s) cost at least one of the 14 live ids ('
        + Object.keys(premise.byKind).map((k) => k + ' ' + premise.byKind[k]).join(' · ') + ').');
    }

    /* ── E14 — the crate against the stash. ────────────────────────────── */
    if (crate && crate.error) {
      F.warn('EXECUTION', 'kitchen.state.js buySupply()', 'The crate probe threw: ' + crate.error + ' — E14 was NOT checked.');
    } else if (crate && crate.skipped) {
      F.warn('EXECUTION', 'kitchen.state.js buySupply()', 'E14 UNCHECKED this run (' + crate.skipped + ').');
    } else if (crate && !crate.ok) {
      F.warn('EXECUTION', 'kitchen.state.js buySupply()', 'A fresh kitchen could not buy `' + crate.id + '`: "' + crate.why + '" — E14 was NOT checked.');
    } else if (crate && crate.stashMismatch.length) {
      F.fail('EXECUTION', 'kitchen.state.js buySupply()',
        '`' + crate.id + '` advertises ' + JSON.stringify(crate.want) + ' and the live stash actually lost ' + JSON.stringify(crate.got) + '.',
        'The price on the row is the promise the player buys on. A crate that takes a different amount than it prints is the premise being wrong by a factor rather than absent.');
    } else if (crate && crate.ledgerMismatch.length) {
      F.fail('EXECUTION', 'kitchen.state.js buySupply()',
        '`' + crate.id + '` took ' + JSON.stringify(crate.got) + ' out of the stash and booked ' + JSON.stringify(crate.led) + ' on the day ledger.',
        'The receipt screen reads the ledger. A spend the day report cannot see is round 6\'s `today.resSpent` again with the numbers changed instead of the timing.');
    } else if (crate) {
      F.info('EXECUTION', '`' + crate.id + '` charged exactly what it advertises: ' + JSON.stringify(crate.want) + ' out of the stash and the same on the day ledger.');
    }

    if (!programmingErrors && !(report.errors || []).length && !tally.botThrew.length) {
      F.info('EXECUTION', 'no programming error was thrown or swallowed anywhere in the shift.');
    }
    try { offPop(); } catch (e) {}
  } catch (e) {
    F.fail('EXECUTION', '(the execution arm itself)',
      'The execution arm threw and therefore checked NOTHING: ' + ((e && e.stack) || e),
      'Treat this as unchecked, not as clean. A green line here would be the exact lie this file exists to stop.');
  } finally {
    globalThis.__MK_SWALLOW__ = prevHook;
    /* `window === globalThis` here, so publishing the bridge on `window` also
       published it on globalThis. Both have to go, or a harness that imports
       this file inherits a fake game. */
    try { delete globalThis.MythicKitchenBridge; } catch (e) {}
    if (hadWindow) globalThis.window = prevWindow; else { try { delete globalThis.window; } catch (e) {} }
    if (dir) { try { await fs.rm(dir, { recursive: true, force: true }); } catch (e) {} }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 11 — THE SCORE   🔴 A NUMBER THAT IMPROVES WHEN THE CODE GETS WORSE
                             IS WORSE THAN NO NUMBER
   ───────────────────────────────────────────────────────────────────────────
   Measured in round 6's mutation lab, not argued: strip every textual
   `buyRelief` from kitchen.render.js — killing the escape hatch again, round
   5's blocker restored — and this file went from `0 FAIL 64 WARN` to
   `0 FAIL 63 WARN`. THE HEADLINE IMPROVED. A builder diffing before and after
   reads that as progress. And 63 of those 64 warnings ARE the defect class the
   file exists to find, so a genuine 64th line is invisible in an accepted wall.

   Two mechanics fix both halves, and neither can be gamed by deleting code:

   1  UNWIRED — the count of exports with NO consumer outside their own module.
      DELETING A CONSUMER RAISES IT. Adding an export nobody calls raises it.
      Deleting a dead export lowers it. It is the defect class as a number that
      only moves the right way, and it is the primary headline.

   2  A DATED PER-FILE BASELINE. Every (section, file) warning count is written
      down below. ANY COUNT ABOVE ITS BASELINE IS A FAIL naming the file and the
      section, so a 64th warning is loud even inside a wall of 63. Any count
      BELOW is printed as `↓` with a nudge to check that it was a fix and not a
      consumer being deleted.

   ── HOW TO MOVE THE BASELINE, AND WHEN ──────────────────────────────────
   `node public/src/kitchen/kitchen.selftest.js --baseline` prints the literal
   to paste. Move it when you have READ the diff in the counts and each one is a
   real improvement or a deliberate, understood addition. Moving it to make the
   run green is the same act as deleting the check; the numbers are dated and in
   version control precisely so that is visible.
   ═══════════════════════════════════════════════════════════════════════════ */

/** 🔴 SNAPSHOT — regenerate with `--baseline`, never by hand.
    Taken 2026-08-27, round 7, at the end of the self-test builder's pass, with
    four other builders' round-7 work already in the tree. */
const BASELINE = {
  /* RE-VERIFIED BY THE LEAD after all six round 8 passes landed, which is the
     only moment this literal means anything — its author took the round 7 one
     mid-round and correctly flagged that four builders were still editing under
     it. Read the diff before blessing it; here is what moved and why each was
     accepted:
       • COMPUTED, NEVER READ | kitchen.state.js  25 → 23   two fewer. Good.
       • COMPUTED, NEVER READ | drivethru.js      14 → 16   serveCar() gained
         `unproven`, `modCinderTaken` and `modPop`. These are REAL instances of
         this project's signature defect and they are NOT forgiven by being
         written down — they are carried into round 9's brief by name. The
         baseline exists to make the NEXT one loud, not to declare these fine.
       • EXECUTION | drivethru.js serveCar()       0 → 1   accepted after
         checking the actual cause. The lane now refuses a car that is not at the
         window (round 8's fix), and the self-test's bot mirrors doServe() without
         honouring `canServe`, so it asks for refusals the player never can:
         kitchen.render.js:2066 renders the button `${c.canServe ? '' : 'disabled'}`.
         So this is the INSTRUMENT lagging the fix, not a defect the player meets.
         Round 9 teaches the bot the gate, and then this line should return to 0. */
  at: '2026-08-28 · round 8, re-verified by the lead against the settled tree',
  unwired: 29,
  unwiredContract: 29,
  list: ['drivethru.js#arrivalPlan', 'drivethru.js#regulars', 'drivethru.js#spawn', 'kitchen.data.js#DATA', 'kitchen.data.js#POP_FACES', 'kitchen.data.js#cheapestRoute', 'kitchen.data.js#expectedUpgradesFor', 'kitchen.data.js#reliefRouteCost', 'kitchen.data.js#resRetail', 'kitchen.data.js#salvageCinderCost', 'kitchen.data.js#salvageMenu', 'kitchen.data.js#shelf', 'kitchen.data.js#speedMulFor', 'kitchen.data.js#unlocksAt', 'kitchen.render.js#toastEvents', 'kitchen.state.js#buyUpgrade', 'kitchen.state.js#dumpSupply', 'kitchen.state.js#hydrate', 'kitchen.state.js#ownsUpgrade', 'kitchen.state.js#pantryHas', 'kitchen.state.js#pantryRoom', 'kitchen.state.js#qMult', 'kitchen.state.js#reset', 'kitchen.state.js#scoreBuild', 'kitchen.state.js#seed', 'kitchen.state.js#simulate', 'kitchen.state.js#snapshot', 'kitchen.state.js#startPantryCovers', 'kitchen.state.js#ticketPct'],
  warns: {
    'COMPUTED, NEVER READ|drivethru.js': 16,
    'COMPUTED, NEVER READ|kitchen.state.js': 23,
    'CONTRACT DRIFT|kitchen.render.js': 1,
    'DEAD EXPORTS|drivethru.js': 3,
    'DEAD EXPORTS|kitchen.data.js': 11,
    'DEAD EXPORTS|kitchen.render.js': 1,
    'DEAD EXPORTS|kitchen.state.js': 14,
    'EXECUTION|drivethru.js serveCar()': 1,
  },
};

/** `kitchen.data.js:4708` → `kitchen.data.js`; `the shift` → `the shift`. */
function whereFile(where) {
  const w = String(where || '(none)').trim();
  const cut = w.indexOf(':');
  return cut > 0 ? w.slice(0, cut) : w;
}

function tallyWarns(rows) {
  const out = {};
  for (const r of rows) {
    if (r.sev !== 'WARN') continue;
    const key = r.check + '|' + whereFile(r.where);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function checkBaseline(W, F) {
  /* UNWIRED. `W.unconsumed` is filled by CHECK 1 and holds `file#name` for
     every export nothing outside its own module names. */
  const unconsumed = W.unconsumed || new Set();
  const contractSet = W.contractDeclared || new Set();
  const inContract = [...unconsumed].filter(k => contractSet.has(k));
  W.score = {
    unwired: unconsumed.size,
    unwiredContract: inContract.length,
    unwiredList: [...unconsumed].sort(),
    contractList: inContract.sort(),
  };

  if (!W.htmlScanned) {
    F.skip('SCORE', 'index.html was not scanned, so UNWIRED counts exports that index.html may well call. The baseline below is a node-mode baseline — do not compare a browser run against it.');
    return;
  }

  /* 🔴 NAME THE ONES THAT ARE NEW, not all thirty. Round 6's report was read
     top to bottom and the finding that mattered was three screens down; a FAIL
     that prints the whole accepted list is the same mistake in miniature. */
  const baseList = new Set(BASELINE.list || []);
  const added = W.score.unwiredList.filter(k => !baseList.has(k));
  const gone = (BASELINE.list || []).filter(k => !unconsumed.has(k));

  if (unconsumed.size > BASELINE.unwired || added.length) {
    F.fail('SCORE', 'UNWIRED',
      (added.length ? added.join(', ') + ' — ' + (added.length === 1 ? 'this export has' : 'these exports have') + ' NO consumer outside their own module and did not before.'
                    : 'UNWIRED is ' + unconsumed.size + ' against a baseline of ' + BASELINE.unwired + '.'),
      'Either a consumer was deleted or an export was added with nobody to call it. Both are the bug this feature has shipped six times. UNWIRED ' + BASELINE.unwired + ' → ' + unconsumed.size + (gone.length ? ' · no longer unwired: ' + gone.join(', ') : ''));
  } else if (unconsumed.size < BASELINE.unwired) {
    F.info('SCORE', 'UNWIRED ' + unconsumed.size + ' ↓ from a baseline of ' + BASELINE.unwired
      + '. Good — if the drop is a consumer being WRITTEN. Re-baseline with --baseline once you have checked it is not an export being deleted to make a number look better.');
  }
  if (W.score.unwiredContract > BASELINE.unwiredContract) {
    F.fail('SCORE', 'UNWIRED (§1)',
      W.score.unwiredContract + ' export(s) that CONTRACT §1 publishes have no consumer outside their own module (baseline ' + BASELINE.unwiredContract + ').',
      '§1 is the promise that something across a file boundary depends on it. An unread one is a broken promise, not a note: ' + W.score.contractList.join(', '));
  }

  /* The per-file warning wall, against the written-down baseline. */
  const now = tallyWarns(F.rows);
  const keys = [...new Set(Object.keys(now).concat(Object.keys(BASELINE.warns)))].sort();
  const moved = [];
  for (const key of keys) {
    const a = now[key] || 0, b = BASELINE.warns[key] || 0;
    if (a === b) continue;
    moved.push(key.replace('|', ' · ') + ' ' + b + '→' + a);
    if (a > b) {
      const parts = key.split('|');
      F.fail('SCORE', parts[1],
        'NEW WARNING(S) in ' + parts[1] + ' / ' + parts[0] + ': ' + b + ' → ' + a + '.',
        'This is the line that would otherwise be invisible inside a wall of ' + (BASELINE.warns[key] || 0) + ' accepted ones. Read it above, fix it, or re-baseline deliberately.');
    }
  }
  if (moved.length) F.info('SCORE', 'counts that moved against the ' + BASELINE.at + ' baseline: ' + moved.join(' · '));
  else F.info('SCORE', 'every per-file warning count matches the ' + BASELINE.at + ' baseline exactly.');
}

/** The literal to paste into BASELINE, printed by `--baseline`. */
function baselineLiteral(rows, W) {
  const now = tallyWarns(rows);
  const L = ['const BASELINE = {',
    "  at: '" + new Date().toISOString().slice(0, 10) + " · <round>',",
    '  unwired: ' + ((W.score && W.score.unwired) || 0) + ',',
    '  unwiredContract: ' + ((W.score && W.score.unwiredContract) || 0) + ',',
    '  list: [' + (((W.score && W.score.unwiredList) || []).map(k => "'" + k + "'").join(', ')) + '],',
    '  warns: {'];
  for (const k of Object.keys(now).sort()) L.push("    '" + k + "': " + now[k] + ',');
  L.push('  },', '};');
  return L.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 0 — IS THE SELF-TEST ITSELF REACHABLE?
   ───────────────────────────────────────────────────────────────────────────
   A tool nobody can run is the exact bug this file exists to catch, so it
   checks itself first and says the one line it needs. It is reported at WARN,
   not FAIL, so the exit code keeps meaning "the GAME has a defect".
   ═══════════════════════════════════════════════════════════════════════════ */

function checkOwnReachability(W, F) {
  const idx = W.code['index.js'] || '';
  if (/kitchen\.selftest\.js/.test(idx)) return;
  F.warn('SELFTEST REACHABILITY', 'index.js',
    'index.js does not load kitchen.selftest.js, so `__mk.selftest()` does not exist in the browser.',
    'One line, inside the existing try/catch in index.js:  import(\'./kitchen.selftest.js\').catch(()=>{});  — the self-test attaches itself to window.__mk on import.');
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE RUNNER
   ═══════════════════════════════════════════════════════════════════════════ */

const CHECKS = [
  ['SELFTEST REACHABILITY', checkOwnReachability],
  ['FREE IDENTIFIERS', checkFreeIdentifiers],
  ['DEAD EXPORTS', checkDeadExports],
  ['ECON KEYS', checkEcon],
  ['COMPUTED, NEVER READ', checkComputedNeverRead],
  ['STATE FIELDS', checkStateFields],
  ['CONTRACT DRIFT', checkContract],
  ['CONTRACT DRIFT', checkReturnShapes],
  ['COMMENT LIES', checkCommentLies],
  ['RESERVED PAYLOAD KEYS', checkReservedPayload],
  /* 🔴 LAST BUT ONE, AND IT IS THE ONE THAT RUNS THE GAME. Everything above
     reads names. See CHECK 10 for why a build can pass all of them with 45.6%
     of its drive-thru orders unservable. */
  ['EXECUTION', checkExecution],
  /* 🔴 GENUINELY LAST: it scores the rows the others produced. */
  ['SCORE', checkBaseline],
];

/**
 * Run every check.
 * @param {{strict?:boolean, html?:boolean, quiet?:boolean}} [opts]
 * @returns {Promise<{ok:boolean, fail:number, warn:number, rows:Array, text:string}>}
 */
export async function selftest(opts) {
  const o = opts || {};
  const F = Findings();
  let W;
  try {
    W = await gather(o);
  } catch (e) {
    const text = '🔬 SELF-TEST COULD NOT START — ' + (e && e.message);
    if (!o.quiet) log(text);
    return { ok: false, fail: 1, warn: 0, rows: [{ sev: 'FAIL', check: 'BOOT', where: '', msg: String(e && e.message) }], text };
  }
  for (const n of W.notes) F.skip('SOURCES', n);

  for (const [name, fn] of CHECKS) {
    if (o.only && o.only !== name) continue;
    /* `await` even for the synchronous ones: CHECK 10 boots the game in a temp
       directory and a fire-and-forget promise here would report a clean run
       before the game had finished failing. */
    try { await fn(W, F); }
    catch (e) {
      F.fail(name, '(the check itself)', 'The check threw: ' + (e && e.stack || e) + '. Treat this as unchecked, not as clean.');
    }
  }

  const text = format(F.rows, W, o);
  if (!o.quiet) log(text);
  const fail = F.rows.filter(r => r.sev === 'FAIL').length;
  const warn = F.rows.filter(r => r.sev === 'WARN').length;
  return {
    ok: fail === 0 && (!o.strict || warn === 0), fail, warn, rows: F.rows, text,
    unwired: W.score ? W.score.unwired : null,
    baseline: baselineLiteral(F.rows, W),
  };
}

function log(text) {
  try { (typeof console !== 'undefined') && console.log(text); } catch (e) {}
}

/** WARN rows grouped by the file they name, biggest first. */
function perFileWarns(rows) {
  const by = {};
  for (const r of rows) { if (r.sev !== 'WARN') continue; const f = whereFile(r.where); by[f] = (by[f] || 0) + 1; }
  return Object.keys(by).map(f => ({ file: f, n: by[f] })).sort((a, b) => b.n - a.n);
}

/** `↑2` / `↓1` against the baseline's total for that file, or '' when level. */
function delta(file, n) {
  let base = 0;
  for (const k of Object.keys(BASELINE.warns)) if (k.split('|')[1] === file) base += BASELINE.warns[k];
  const d = n - base;
  return d === 0 ? '' : (d > 0 ? ' ↑' + d : ' ↓' + (-d));
}

function format(rows, W, o) {
  const L = [];
  const bar = '─'.repeat(74);
  L.push('');
  L.push('🔬 MYTHIC KITCHEN SELF-TEST');
  L.push('   ' + (IS_NODE ? 'node' : 'browser') + ' · ' + MODULES.filter(f => W.code[f]).length + '/' + MODULES.length + ' modules read · '
    + MODULES.filter(f => W.ns[f]).length + ' imported live');
  L.push('   Arm one reads names. Arm two (EXECUTION) runs the game — but never the renderer.');
  L.push('');

  /* THE HEADLINE. Six rounds of reports were read top-to-bottom and the one
     finding that mattered was three screens down. The two classes below are
     the ones that have actually shipped, so they go first, by name. */
  const zeroCall = rows.filter(r => r.check === 'DEAD EXPORTS' && /ZERO call sites/.test(r.msg));
  const noKey = rows.filter(r => r.check === 'ECON KEYS' && /DECLARES NO SUCH KEY/.test(r.msg));
  const deadKey = rows.filter(r => r.check === 'ECON KEYS' && /READ BY NOTHING/.test(r.msg));
  /* ⚠ ECON messages contain the literal word `undefined` in backticks, so a
     generic "first backticked thing" extractor pulled that out eleven times
     and printed a headline of nothing but the word undefined. Ask the row what
     kind of row it is. */
  const nm = (r) => (r.check === 'ECON KEYS'
    ? (/ECON\.([A-Z0-9_]+)/.exec(r.msg) || [, '?'])[1]
    : (/`([^`]+)`/.exec(r.msg) || [, '?'])[1]);
  /* 🔴 THE PRIMARY NUMBER IS UNWIRED, AND IT IS PRIMARY BECAUSE IT CANNOT BE
     IMPROVED BY DELETING CODE. Round 6 measured the old headline going 64 WARN
     → 63 WARN when the sole consumer of a live export was stripped out; UNWIRED
     goes UP in that mutation, because the export it counts just lost its
     consumer. See CHECK 11. */
  const sc = W.score || null;
  L.push('🔴 THE SCORE — built so that deleting a consumer makes it WORSE, never better');
  if (sc) {
    const d = sc.unwired - BASELINE.unwired;
    L.push('   UNWIRED  ' + sc.unwired + ' export(s) have NO consumer outside their own module'
      + '   (baseline ' + BASELINE.unwired + (d === 0 ? ', unchanged' : d > 0 ? ', ↑' + d + ' — SOMETHING LOST ITS READER' : ', ↓' + (-d)) + ')');
    L.push('            of those, ' + sc.unwiredContract + ' are published by CONTRACT §1 — a promise across a file boundary that nothing keeps.');
  } else {
    L.push('   UNWIRED  not computed (the SCORE check did not run).');
  }
  if (zeroCall.length) L.push('   ZERO CALL SITES ANYWHERE  ' + zeroCall.length + ': ' + zeroCall.map(nm).join(', '));
  if (noKey.length) L.push('   ECON READ, NEVER DECLARED  ' + noKey.length + ' — the number lives outside the ECON table: ' + noKey.map(nm).join(', '));
  if (deadKey.length) L.push('   ECON DECLARED, READ BY NOTHING  ' + deadKey.length + ': ' + deadKey.map(nm).join(', '));
  /* THE WARNING WALL, BROKEN OUT. 63 of 64 warnings ARE the defect class, so a
     single lump sum hides the 64th. Per file, a new one is a changed digit. */
  const wallRows = perFileWarns(rows);
  if (wallRows.length) L.push('   WARNING WALL  ' + wallRows.map(r => r.file + ' ' + r.n + delta(r.file, r.n)).join(' · '));
  L.push('');

  const order = ['SELFTEST REACHABILITY', 'DEAD EXPORTS', 'ECON KEYS', 'COMPUTED, NEVER READ', 'CONTRACT DRIFT', 'COMMENT LIES', 'RESERVED PAYLOAD KEYS', 'SOURCES', 'BOOT'];
  const seen = new Set();
  for (const check of order.concat(rows.map(r => r.check))) {
    if (seen.has(check)) continue;
    seen.add(check);
    const mine = rows.filter(r => r.check === check);
    if (!mine.length) continue;
    const f = mine.filter(r => r.sev === 'FAIL').length;
    const w = mine.filter(r => r.sev === 'WARN').length;
    L.push(bar);
    L.push(check + '   ' + (f ? f + ' FAIL  ' : '') + (w ? w + ' WARN  ' : '') + (!f && !w ? 'clean' : ''));
    L.push(bar);
    for (const r of mine) {
      const tag = r.sev === 'FAIL' ? '🔴 FAIL' : r.sev === 'WARN' ? '🟡 WARN' : r.sev === 'SKIP' ? '⚪ SKIP' : '   info';
      L.push(tag + '  ' + (r.where ? r.where + '\n         ' : '') + r.msg);
      if (r.note) L.push('         ↳ ' + r.note);
    }
    L.push('');
  }

  const fail = rows.filter(r => r.sev === 'FAIL').length;
  const warn = rows.filter(r => r.sev === 'WARN').length;
  const skip = rows.filter(r => r.sev === 'SKIP').length;
  L.push(bar);
  /* A baseline drift and a broken mechanic are BOTH failures and they are not
     the same news. Saying which keeps the gate believable — a builder who reads
     "the code is broken" and finds a moved counter stops reading it. */
  const scoreOnly = fail > 0 && rows.filter(r => r.sev === 'FAIL').every(r => r.check === 'SCORE');
  L.push('SUMMARY   ' + fail + ' FAIL   ' + warn + ' WARN   ' + skip + ' SKIP'
    + (scoreOnly ? '   → nothing EXECUTED or PARSED wrong; the SCORE baseline moved. Read SCORE, then --baseline.'
      : fail ? '   → something on this list is the bug we keep shipping.'
      : (warn ? '   → nothing fatal; read the warnings.' : '   → clean.')));
  /* 🔴 THE RAW WARN COUNT IS NOT A SCORE AND IS NOT PRINTED AS ONE. It went
     DOWN when round 6's mutation killed the escape hatch. UNWIRED and the
     per-file wall are the two numbers to diff between runs. */
  L.push('          UNWIRED ' + (W.score ? W.score.unwired : '?') + ' / baseline ' + BASELINE.unwired
    + '   ·   warnings by file: ' + (perFileWarns(rows).map(r => r.file + ' ' + r.n).join(' · ') || 'none'));
  L.push(bar);
  L.push('SKIP is not a pass. Anything listed as SKIP was NOT checked.');
  L.push('A falling WARN count is NOT progress on its own — round 6 lowered it by deleting a consumer.');
  if (!IS_NODE) L.push('Browser mode skips the index.html checks — run it under node for those.');
  L.push('');
  return L.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   SURFACES
   ═══════════════════════════════════════════════════════════════════════════ */

/* Browser: attach to the console surface the moment this module is imported, so
   the only thing index.js has to do is import it. Guarded like everything else
   that runs on a 223k-line page — a failure here must not take the game down. */
try {
  if (typeof window !== 'undefined') {
    window.__mkSelftest = selftest;
    const mk = window.MythicKitchen || window.__mk;
    if (mk && !mk.selftest) mk.selftest = selftest;
  }
} catch (e) { /* never fatal */ }

/* Node: only when RUN, never when imported — so a harness can import it. */
if (IS_NODE) {
  try {
    const { pathToFileURL } = await import('node:url');
    const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
    if (entry === import.meta.url) {
      const argv = process.argv.slice(2);
      const res = await selftest({
        strict: argv.includes('--strict'),
        quiet: argv.includes('--json') || argv.includes('--baseline'),
      });
      if (argv.includes('--json')) console.log(JSON.stringify({ ok: res.ok, fail: res.fail, warn: res.warn, rows: res.rows }, null, 2));
      if (argv.includes('--baseline')) {
        console.log('/* paste over BASELINE in kitchen.selftest.js — and read the diff first */');
        console.log(res.baseline);
        process.exit(0);
      }
      process.exit(res.ok ? 0 : 1);
    }
  } catch (e) {
    console.error('🔬 self-test runner failed —', e);
    process.exit(2);
  }
}

export default selftest;
