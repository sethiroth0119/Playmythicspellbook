/* 🛠 THE FORGE DRIVER HARNESS — a driver that actually reaches the card editor.

   THE BUG THIS EXISTS FOR: every Forge screenshot taken with the house driver
   (.gauntlet/_shot-screen.mjs, which does `App.screen = s; render()`) was a
   photograph of the TITLE SCREEN, and every one of them reported success.

   renderForge() opens with an admin gate (public/index.html:144667-144673):

       if (typeof isAdmin === 'function' && !isAdmin()) {
         showToast('👑 The Forge is admin-only.', 2500);
         App.screen = 'title'; App.titleHub = 'forge';
         setTimeout(render, 0);
         return;                       // ← no throw, no return value, no error
       }

   isAdmin() (59442) reads Profile.cloud.email against ADMIN_EMAILS (59437). A
   headless page is signed out, so the gate fires, the screen silently becomes
   'title', and the driver's `pg.screenshot()` and its `panels=` / `buttons=`
   counts all come back non-zero — from the wrong screen. Nothing fails. That
   is the worst possible failure mode for a measurement harness, so every entry
   point here HARD-ASSERTS what it reached instead of trusting a return.
   (The 144667 above is where the gate was when this was written; every message
   the harness prints derives the CURRENT line from the source — see
   forgeGateLine — because a stale line number in a blame is its own small lie.)

   Three more traps this wraps, each of which silently returns zero:

   · _fxOpen() (133951) returns '' unless App._fxOpen was populated by a real
     person clicking, so a freshly rendered editor has EVERY <details> section
     CLOSED. offsetParent is null inside a detached host div, which is how
     drive-scale-per.mjs builds the editor — but NOT inside a closed <details>
     (measured below). An unforced A/B therefore compares two different
     open-sets, or 0 against 0.
   · bindCardEditor (150611) sets display:none on any .fx-sec / .fx-sub holding
     zero .editor-field. Opening a section is not enough on its own.
   · deckKeyOwnedCount (59966) returns Infinity for admins. Ownership-gated UI
     cannot be judged from the admin client that opened the editor — and worse,
     ensureAdminCardGrant (43026) has by then WRITTEN 3 of every card into
     Profile.cardCollection, which survives changing the email. seedNonAdmin()
     undoes both halves.

   ── 🔴 SEVEN HOLES FOUND BY CRITICS WHO BUILT A MUTANT AND WATCHED IT PASS ──
   Every one of them made this file report a confident wrong number, which is
   the exact class of bug it exists to kill. All seven are fixed here and each
   one is pinned by a named clause of the self-check that FAILS on the old
   behaviour. The measurements quoted are from this tree, 2026-09-08, Chromium
   142 headless, 1500×1400.

   1. forceOpen() attached the detached host to document.body and NEVER took it
      off again, and openCardEditor only asserted `.card-editor` was non-zero.
      The recipe this very file documented — openCardEditor → detached
      renderCardEditor() host → forceOpen(sel, host) → openCardEditor — left
      TWO editors in one document: measured .card-editor=2, .editor-field=570
      (from 289), two #fx-onplay, and openCardEditor RETURNED OK. Every
      document-scoped number taken afterwards was silently doubled.
      → forceOpen detaches the host it attached (opts.keep to hold it for a
        screenshot, then releaseForced()), and openCardEditor demands EXACTLY
        one editor and names the duplicates when it finds more.
   2. The old clause (3b) proved nothing. A critic deleted forceOpen's single
      `el.open = true;` and it still read 0 → 70 with the details never opened,
      because the "0 before" came from the host being DETACHED, not from
      anything being hidden. And the premise was false: on the ATTACHED editor
      71 of 86 #fx-onplay fields report offsetParent !== null while the section
      is shut. checkVisibility() is the only predicate that answers 0 → 71 and
      it is killed by that mutant (0 → 0), so it is the honest one. The mutant
      SHIPS as clause (5): the harness mutates its own source and fails if the
      mutant survives.
   3. abRun's worktrees were cone-sparse on ['public/src', '.gauntlet'], so
      public/assets, public/models, public/node-city, public/pack-opener,
      public/corp and public/battle-board existed on the live side and not on
      the HEAD side — 26 public/ subdirs against 1. Any metric touching them
      reported a false difference with no guard and no way to detect it.
      → the default cone is now EVERY public/ subdir except public/assets (23
        dirs, 129 MB, 13 s a checkout), and what is still one-sided is REFUSED
        by name (AbAsymmetricPathError) instead of being reported as a
        difference. public/assets cannot join them — 4 GB, and it dies with
        "Filename too long" mid-checkout — so a page that needs it (a Forge
        editor pulls 47 asset requests, measured) is served it FROM THE MAIN
        TREE ON BOTH SIDES: bootPage({ assetsFrom: REPO }) plus
        abRun(…, { allowOneSided: ['public/assets'] }). Same bytes both sides,
        allowance printed in the report.
   4. abRun used fixed ../head-ab and ../base-ab: two agents A/Bing at once was
      a hard refusal (a critic hit it for real), and a killed process left a
      worktree that blocked the next run until a human cleared it.
      → per-run paths under <repo>/../forge-ab, each with an owner stamp, and
        a reaper that takes back the ones whose owner is dead.
   5. openCardEditor replaced window.showToast to capture the gate's toast and
      never put it back, so any later piece asserting on a toast saw nothing.
      → the original is restored inside the same evaluate.
   6. forceOpen's toggle events land in App._fxOpen (bindCardEditor, 149058)
      and that survives a re-render: measured App._fxOpen =
      {"fx-onplay":true,"fx-effects":true} after a forceOpen, and the NEXT
      editor rendered in the same page came back with open=1 where the first
      was open=0. A same-page A/B on `opened` was asymmetric by construction.
      → openCardEditor clears App._fxOpen (opts.keepFxOpen to keep it).
   7. The doc promised a pre-flight ADMIN_EMAILS check for a typo'd email that
      the code never ran (assertAdminEmail only ever saw the constant), and the
      throw blamed the gate unconditionally for any isAdmin()=false state.
      → every email is checked unless opts.allowNonAdmin, and the message says
        the gate only when the gate's signature (its toast + screen='title' +
        titleHub='forge') was actually observed.

   ── 🔴 ROUND 2: FIVE MORE, from two critics who ran the fixes above ─────────
   The first round's fixes were real and are still here; these are the holes
   LEFT, each one measured on this tree the same way.

   8. THE GATE ITSELF WENT RED WHEN A COLLEAGUE WAS WORKING. Clauses (10),
      (12) and (12b) asserted on machine-GLOBAL state: `git worktree list`
      compared as an exact string and as an absolute line count, and
      `git status --porcelain` of a tree this file's own header says other
      agents write to. Two critics ran the full self-check four times between
      them and got exit 1 every time — once because a foreign node pid 32332
      held a D:/forge-ab worktree during the window, once because another
      agent's untracked `.forgetmp/` vanished from git status mid-run. Bug 4's
      fix (two agents MAY A/B at once) is what made bug 4's own proof false-red,
      and a gate that reddens when a colleague is working is the gate nobody
      runs.
      → the assertions are per-run now: none of THIS run's worktrees is still
        listed and every foreign entry survived (mainTree.ownWorktreesGone /
        foreignWorktreesPreserved), the dead worktree is named rather than
        counted, and "the tree was left alone" is proved by INSTRUMENTING this
        process's own fs writes and this file's own git verbs
        (mainTree.repoWrites, gitMainTreeGuard) instead of by diffing shared
        state across time. The raw before/after strings are still in the report
        — as evidence, not as the assertion.
   9. THE ONE-SIDED-PATH GUARD ONLY SAW PATHS HANDED TO IT AS STRINGS. Three
      one-line drivers walked through it: fs.readdirSync('public') (35 entries
      vs 32), fs.readdirSync('public/src') (69 modules vs 66 — the builder's
      OWN headline example, delivered as a confident wrong number),
      fs.opendirSync('public/assets'), and 'public/Assets' with one letter
      re-cased. The shim wrapped 16 hand-listed fs names and compared the
      relative path case-SENSITIVELY, and asymmetricPaths deliberately reports a
      one-sided DIRECTORY as one entry and never walks its children — so the
      watch list held 'public/assets' and never 'public', which is what a
      listing actually names.
      → the shim now wraps EVERY lowercase path-taking function on fs and
        fs.promises (100 + 32, not 16 + 7) AND every lowercase function property
        copied off them (bug 13 — that sentence was true and still leaked
        fs.realpathSync.native for a whole round), compares case-insensitively,
        and carries a second list: the PARENTS of every watched path, matched
        only for the listing family (readdir/opendir/glob/cp/rm/watch). Reading
        public/index.html still passes; LISTING public does not.
        ⚠ STILL OUT OF REACH, and saying so is the point: a read through
          child_process, or a native addon, never touches this shim. The guard
          is a --require preload, not a filesystem sandbox.
  10. openCardEditor's EXACTLY-ONE assertion counted only `.card-editor`, so a
      forceOpen host holding ONE SECTION of the editor (#fx-effects.outerHTML:
      200 .editor-field, 0 .card-editor — a driver photographing one section)
      was waved straight through and took the document from 289 .editor-field
      to 481, and #fx-onplay from 86 to 171. Bug 1's exact failure, reached by
      a host that merely lacks the wrapper element.
      → the invariant is the one that actually holds, measured on this tree:
        EVERY .editor-field in the document is inside the ONE .card-editor
        (289 in / 0 out). A leftover host is refused on its own count too.
  11. The duplicate-editor message blamed forceOpen and told the reader to call
      releaseForced() even when it had counted ZERO hosts ("0 of them are
      inside 0 host(s)") — the same unearned blame bug 7 fixed for the admin
      gate, left standing in the sibling message.
      → the blame follows the count: hosts when there are hosts, and otherwise
        the id of the element the strays are actually under.
  12. Assertions weaker than the numbers printed above them: clause (3) printed
      '.editor-field=289' and asserted '> 100' (an editor that lost 65% of its
      fields passed); clause (5) asserted 'shown > 0' (opening ONE field
      passed); clause (4)'s second conjunct was `fxOpen !== 'null'`, which the
      '{}' openCardEditor had just written satisfies — it printed "forceOpen
      really did write App._fxOpen" during a run in which forceOpen wrote
      nothing. forceOpen's own `shown` — the field this file calls the one to
      judge on — silently fell back to the offsetParent predicate the same file
      calls a liar, under the same name.
      → floors are derived from the same run's matched count, the fxOpen
        conjunct counts KEYS, and `shown` is null (never a fallback) when
        checkVisibility is unavailable.
      → and forceOpen's display:none branch, which no clause exercised (a new
        card's only hidden section, #fx-obtain, holds 0 fields), is pinned by
        clause (8b) hiding a section that DOES hold fields.
  13. THE GUARD RE-EXPORTED ITS OWN BYPASS. Bug 9's fix wraps every lowercase
      path-taking function — and then handed one back unwrapped: wrap() copies
      the original's own properties onto the wrapper with Object.assign, and
      fs.realpathSync's own `.native` function is one of them. A critic's
      control pair isolated it to that one property: fs.realpathSync('public/
      assets') refused by name, fs.realpathSync.native('public/assets')
      reporting base has-assets=true / head has-assets=false as a plain
      difference, exit 0 both sides.
      → the copied properties are wrapped too, by the parent's rule rather than
        by name, and clause (11d) asserts it as a PROPERTY of the whole surface:
        inside the guarded process, top=123/123 wrapped and 0 of the 2 own
        lowercase sub-functions (fs.realpath.native, fs.realpathSync.native)
        unwrapped. Unguarded the same walk reads 0/123 and unwrapped=2.
  14. …AND THE OPPOSITE FAILURE WAS UNGUARDED ENTIRELY. Every clause above stops
      a false DIFFERENCE. A driver holding an ABSOLUTE path into the main repo
      A/Bs NOTHING — both sides open the same bytes — and the report said
      identical=true with no refusal and no note, because relOf() answers null
      for anything outside the side under test. Measured on public/index.html:
      15,860,682 on both sides, where the same file read through process.cwd()
      is 15,860,682 vs 15,799,040.
      → a read of the MAIN tree from inside a side is recorded on its own
        channel and refused as AbEscapedTreeError, naming the path. Three reads
        are exempt because the design requires them: node_modules (chromium can
        only come from the main tree), the harness, and the driver itself —
        clause (11e) proves a driver doing exactly those is NOT refused.
      → AND THE GUARD IMMEDIATELY CAUGHT THIS FILE DOING IT. A real bootPage
        driver A/B'd under the new guard reported escaped=["public/index.html"]:
        appSource() read path.join(REPO, 'public/index.html'), and REPO is where
        the HARNESS lives — the main tree — so openCardEditor's ADMIN_EMAILS
        pre-flight was reading a different file from the one the browser was
        rendering, and its error messages quoted line numbers out of it. It now
        follows process.cwd() like everything else (appSourcePath(), exported so
        a caller can print which file it got), and clause (11e) asserts the path
        is under the tree under test on BOTH sides.
  15. A DUPLICATE ELEMENT ID passed every assertion in openCardEditor. An empty
      <div id="fx-onplay"> prepended to <body> (outside #app, so renderForge
      rebuilds the editor around it forever) left editors=1, .editor-field=289,
      0 stray, 0 hosts — all green — while
      getElementById('fx-onplay').querySelectorAll('.editor-field') read 0
      against a truth of 86. Not an inflated count: a wrong one, out of the most
      ordinary DOM read there is.
      → ids the EDITOR uses are refused when duplicated, naming the id, which
        copy getElementById actually answers with, and both field counts.
        Duplicates elsewhere in the document are reported, not refused — they
        are a real bug but not this driver's wrong number (bugs 7 and 11 again).
        Measured clean: 697 elements carry an id, all 697 unique, 673 in the
        editor; the scan is one querySelectorAll and costs 1.6 ms.
  16. SECTION-SHAPED LITTER WITH NO FIELDS IN IT slipped past bug 10's fix,
      which is written on .editor-field only. Seven empty
      <details class="fx-sec"/"fx-sub"> appended to <body>: every assertion
      green, while .fx-sec went 5 → 8 and .fx-sub 13 → 17 — the two counters
      this harness's own A/B driver prints.
      → sections outside the one .card-editor are refused too (clean: 18 in /
        0 out), with { allowStraySections: true } for measuring litter on
        purpose.

   ── 🔴 ROUND 3: THREE MORE, from two critics who ran the round-2 file ──────
  17. IT COULD NOT TELL "VISIBLE" FROM "PAINTED", WHICH IS ITS ENTIRE JOB. Two
      bypasses, both of which left EVERY count above green and returned OK:
        · `body{opacity:0}` before the visibility read — forceOpen still
          reported shown=71 of 86 "really visible", openCardEditor did not
          throw, and the screenshot was 9,243 bytes against 497,843 for a clean
          render.
        · an opaque full-viewport fixed overlay over the editor — same
          shown=71 of 86, and document.elementFromPoint said ZERO of the fields
          were actually on top.
      Counting the DOM cannot see either one. checkVisibility() answers the
      CSS-box question, not the ink question.
      → the assertion path now ends in a PAINT gate (assertPainted, called by
        openCardEditor and not optional): 16 points spread over the editor's
        on-screen rectangle plus the fields it CLAIMS are visible must resolve
        through document.elementFromPoint to the editor or something inside it,
        checkVisibility now carries {opacityProperty}, and the PNG of that same
        rectangle must clear 0.02 B/px against a measured clean 0.24-0.41 and a
        blank 0.0054. Both bypasses ship as named mutants (--mutant=opacity-zero
        / overlay) that must go red, and so does a third the critic asked about:
        a .card-editor clone inside an OPEN shadow root, which is refused only
        when it COVERS the editor — see runMutant('shadow-clone') for why the
        document-scoped counts being untouched (289/1/18, measured) is the
        reason it is not refused otherwise.
      → AND IT CAUGHT A REAL ONE ON ITS FIRST RUN: bouncing off the admin gate
        renders the title screen, which opens `#narr-overlay` — position fixed,
        inset 0, z-index 2147483400, an opaque full-viewport iframe
        (index.html:203475) — over everything. Under it .card-editor=1,
        .editor-field=289, 0 stray, and the screenshot is 1,267,415 bytes of the
        NARRATIVE REEL. Clause (2b).
  18. A CLAUSE THAT REDDENED BECAUSE A COLLEAGUE WAS WORKING — bug 8's own
      failure mode, inside the clause that claims to fix it. (12b) ended in
      `othersKept`: "every other entry in the machine-global `git worktree list`
      survived the reap". A critic's first full run exited 1 (36 PASS / 1 FAIL)
      because ANOTHER agent's dead-owner worktree was on the machine and the
      reaper correctly took it; their second run, on a quiet box, was green.
      → every conjunct is about a worktree THIS clause created: the dead one is
        reaped and named, the live one — owned by a real second process now, not
        by this one — is skipped and named, and the reap touched nothing outside
        AB_HOME. Reaping a colleague's dead worktree is printed as evidence.
        Clause (10) moved the same way: `foreignWorktreesPreserved` (a
        before/after diff of shared state) is evidence, and the assertion is
        `foreignWorktreesDropped` — every worktree this process actually removed
        was its own or a reap it reported, recorded in WORKTREES_DROPPED because
        dropWorktree() is the only hand it has.
      Re-measured with three foreign worktrees planted (one dead-owner, one
      whose owner dies mid-run, one owned by a live process): exit 0 and 45 PASS
      on both of two consecutive full runs, the live one untouched both times.
  19. BOTH A/B PATH GUARDS WERE SPELLING-SPECIFIC. path.toNamespacedPath() —
      the \\?\ extended-length prefix, which is what node itself hands out — is
      NOT stripped by path.resolve(), so neither relOf() nor escOf() recognised
      the path and the read was never recorded at all. Measured with clause
      (11)'s own driver, one call along: base has-assets=true, head
      has-assets=false, identical=false, asymmetricRead=[], exit 0 — a silent
      false difference, which is the exact thing clause (11) exists to refuse.
      → one canonPath() (resolve + namespaced-prefix strip + case-fold on
        win32) in front of every guard comparison — the shim's absOf, the write
        watch behind repoWrites, git()'s main-tree refusal, normWt, abRun's
        "not the repo itself" check — and the shim gets it by VALUE
        (String(canonPath) interpolated) so there is only ever one spelling of
        "canonical" to keep right. Both bypasses ship as named mutants
        (--mutant=namespaced-asym / namespaced-escape).

   ⚠ NOTHING HERE MOVES THE WORKING TREE — no save-and-restore of uncommitted
     changes, by name or by hand. Other agents write to this tree and deploy.mjs
     minifies public/index.html in place, so a harness that parks their edits
     somewhere and puts them back later can lose real work. A/B goes through
     `git worktree` only, and abRun() records the main tree's `git status`
     before and after so the report proves it was left alone. The self-check
     greps this file for the banned verb and FAILS if it ever comes back.

   USING IT from another driver in .gauntlet/ (relative import — an absolute
   Windows path is not a legal ESM specifier, it must be a file:/// URL):

       import { bootPage, openCardEditor, forceOpen, seedNonAdmin, abRun }
         from './_forge-harness.mjs';
       const b = await bootPage({ assetsFrom: REPO });      // serves <cwd>/public
       try {
         await openCardEditor(b.page, 'NEW');               // throws if it did not land
         await b.page.evaluate(forceOpen, '#fx-onplay .editor-field');
         await b.page.screenshot({ path: 'tmp/forge.png' });
       } finally { await b.close(); }
       // b.served.fallback is how many requests came out of the main tree —
       // print it, don't assume it. Under abRun, pair it with
       // allowOneSided: ['public/assets'].

   Self-check (prints the numbers this harness is judged on):
       node .gauntlet/_forge-harness.mjs            page + A/B   (~4m15s, 45 PASS)
       node .gauntlet/_forge-harness.mjs --no-ab    page only    (~15 s, 29 PASS)
   And each named mutant on its own — exit 1 means the harness CAUGHT it, which
   is the point of the command; exit 3 means it SURVIVED and a guard is gone:
       node .gauntlet/_forge-harness.mjs --mutant=opacity-zero        (page)
       node .gauntlet/_forge-harness.mjs --mutant=overlay             (page)
       node .gauntlet/_forge-harness.mjs --mutant=shadow-clone        (page)
       node .gauntlet/_forge-harness.mjs --mutant=no-open             (page)
       node .gauntlet/_forge-harness.mjs --mutant=namespaced-asym     (A/B)
       node .gauntlet/_forge-harness.mjs --mutant=namespaced-escape   (A/B)
       node .gauntlet/_forge-harness.mjs --mutant=list

   Registered in _checkall.mjs (it was registered NOWHERE, so `npm run check`
   never ran it and an index.html edit could invalidate the driver every
   screenshot piece depends on): `forgeharness` = `--no-ab` in the FAST tier,
   because that half is the part an index.html edit can break and it costs
   ~15 s / 29 passes; `forgeab` = the whole thing — a dozen git worktrees,
   4m15s, 45 passes — in the `--full` tier. Both with expect:0, so one FAIL
   reddens the suite. The four page mutants run inside the fast tier and the two
   A/B ones inside the full tier, so nobody has to remember to type them.
   ⚠ AND IT HAS TO STAY GREEN WITH A COLLEAGUE AT THEIR DESK. Re-measured under
     a deliberate noisy neighbour (a second process looping its own A/Bs and
     creating/deleting an untracked file in this tree): exit 0, while the run's
     own evidence showed `git worktree list` identical=false, one foreign A/B
     worktree still present at the end, and `?? .forge-selftest-churn/`
     vanishing from git status mid-window. That is the shape of run that used to
     report 1-2 FAIL. See bug 8.
*/
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/* The harness lives at <repo>/.gauntlet/, so the repo root is one level up.
   Derived from import.meta.url and NOT from process.cwd(), because abRun()
   deliberately runs drivers with cwd pointed at a worktree. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* canonPath(p) — THE ONE SPELLING every guard in this file compares.
   ⚠ WHY (round 3, and it got BOTH path guards in one line). Two critics walked
     through clause (11) and clause (11e) with the same idiomatic Windows form:
     path.toNamespacedPath(), i.e. the \\?\ extended-length prefix. Measured
     with `path.toNamespacedPath(path.resolve(cwd, 'public/assets'))` under the
     asymmetric guard: base has-assets=true, head has-assets=false,
     identical=false, asymmetricRead=[], exit 0 — a silent false difference, out
     of the exact call clause (11) refuses when it is spelled the ordinary way.
     The cause is that path.resolve() does NOT strip the prefix, so
     '\\\\?\\d:\\game-deploy\\public\\assets' does not start with
     'd:\\game-deploy' and BOTH relOf() and escOf() answered null — the guard
     never saw the read at all.
   ⚠ AND IT IS ONE FUNCTION, SHARED BY VALUE, ON PURPOSE. The A/B shim is a
     separate CommonJS file written out as source, so a second copy of this
     logic would live there — and the two copies drift, which is how a guard
     grows a hole nobody edited. AB_SHIM interpolates String(canonPath), so
     there is exactly one spelling of "canonical" in this process and in every
     driver it preloads. It therefore may not close over anything but `path`
     and `process`, which exist in both.
   Case is folded on win32 only, where the filesystem folds it too; the guards
   lowercase their own comparisons on top of this, which can only refuse MORE. */
export function canonPath(p) {
  let s = String(p);
  if (process.platform === 'win32') {
    const B = String.fromCharCode(92);                      // one backslash, no escaping puzzle
    if (s.slice(0, 4) === B + B + '?' + B || s.slice(0, 4) === B + B + '.' + B) {
      s = s.slice(4);
      if (s.slice(0, 4).toUpperCase() === 'UNC' + B) s = B + B + s.slice(4);   // \\?\UNC\srv\sh
    }
  }
  s = path.resolve(s);
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

/* A REAL entry from ADMIN_EMAILS (public/index.html:59437). assertAdminEmail()
   below re-reads that Set out of the source on every run, so if the whitelist
   is ever edited this harness fails loudly instead of quietly screenshotting
   the title screen again — which is the exact failure it was written for. */
export const ADMIN_EMAIL = 'play@mythicsoa.com';

/* Deliberately NOT in ADMIN_EMAILS. Kept in step with the literal inside
   seedNonAdmin() by _selfCheck; the literal is duplicated there because that
   function has to survive being stringified into the page (see its comment). */
export const NON_ADMIN_EMAIL = 'nonadmin@mythicsoa.test';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
/* Everything below reads public/index.html, which is 15 MB. Read it once.
   ⚠ THE TREE UNDER TEST, NOT THE MAIN ONE (bug 14, second half). This read
     used to be path.join(REPO, …) unconditionally, and REPO is derived from
     where the HARNESS file lives — always the main tree, because that is where
     abRun runs a driver from. So under an A/B, openCardEditor's pre-flight read
     ADMIN_EMAILS out of the main tree's index.html while the browser was
     rendering the WORKTREE's, and its error message quoted a line number from
     a file the page under test was not using. The escape guard added for the
     other half of bug 14 is what found it: a real bootPage driver A/B'd under
     the new guard reported escaped=["public/index.html"] and nothing else.
     Same rule the abRun doc gives every driver — read the tree under test
     through process.cwd() — applied to this file. REPO is the fallback for a
     driver whose cwd is not a checkout at all, and the path actually used is
     exported as appSourcePath() so a caller can print which one it got. */
let _srcCache = null;
let _srcPath = null;
export function appSourcePath() {
  if (_srcPath == null) {
    const here = path.resolve(process.cwd(), 'public', 'index.html');
    _srcPath = fs.existsSync(here) ? here : path.join(REPO, 'public', 'index.html');
  }
  return _srcPath;
}
function appSource() {
  if (_srcCache == null) _srcCache = fs.readFileSync(appSourcePath(), 'utf8');
  return _srcCache;
}

/* ── the admin whitelist is read back out of the app, not trusted ────────── */
let _adminSetCache = null;
export function adminEmailsFromSource(src) {
  const s = src || appSource();
  const i = s.indexOf('const ADMIN_EMAILS = new Set([');
  if (i < 0) throw new Error('adminEmailsFromSource: ADMIN_EMAILS literal is gone from public/index.html');
  const block = s.slice(i, s.indexOf(']);', i));
  return (block.match(/'([^']+@[^']+)'/g) || []).map(q => q.slice(1, -1).toLowerCase());
}
export function assertAdminEmail(email) {
  if (!_adminSetCache) _adminSetCache = adminEmailsFromSource();
  const e = String(email || '').trim().toLowerCase();
  if (!_adminSetCache.includes(e)) {
    throw new Error('assertAdminEmail: "' + e + '" is NOT in ADMIN_EMAILS ('
      + _adminSetCache.join(', ') + '). isAdmin() would be false and renderForge() '
      + 'would bounce this driver to the title screen without erroring. '
      + 'Pass { allowNonAdmin: true } if being bounced is the point.');
  }
  return e;
}

/* forgeGateLine() — the CURRENT 1-based line of the admin gate's `if`.
   ⚠ WHY THIS IS DERIVED AND NOT A CONSTANT: the old throw message quoted
     "public/index.html:144667" for every isAdmin()=false state, including ones
     the gate had nothing to do with. Two lies in one string: the number goes
     stale the first time anybody inserts a line above 144667, and the blame was
     never checked. Returns null if the gate cannot be found, and the message
     says so rather than inventing a location. */
let _gateLineCache;
export function forgeGateLine(src) {
  if (_gateLineCache !== undefined && !src) return _gateLineCache;
  const s = src || appSource();
  const f = s.indexOf('function renderForge(');
  const g = f < 0 ? -1 : s.indexOf('!isAdmin()', f);
  let line = null;
  if (g >= 0) line = s.slice(0, s.lastIndexOf('\n', g) + 1).split('\n').length;
  if (!src) _gateLineCache = line;
  return line;
}
const gateWhere = () => {
  const l = forgeGateLine();
  return l ? 'public/index.html:' + l : 'public/index.html (the gate could not be located — it may have been renamed or removed)';
};

/* ── booting a page on the real public/ tree ─────────────────────────────── */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.jsx': 'text/babel', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary' };

/* The one directory an A/B cannot check out (defaultSparse says why), and so
   the one a page can only get from a shared tree. MEASURED: a Forge card
   editor makes 47 requests under /assets/ between openCardEditor and the
   screenshot, so "just don't read it" is not on the table. */
export const ASSET_FALLBACK_PREFIXES = ['/assets/'];

/* resolveServedFile(root, urlPath, opts) — the file bootPage's server would
   send, or null for a 404. Exported because the A/B self-check exercises this
   resolver directly: booting two browsers inside two worktrees to prove one
   `if` would cost a minute per run.

   opts.fallbackRoot — a SECOND public/ root, used only for
   opts.fallbackPrefixes (default /assets/) and only when the primary tree does
   not have the file. That is how a worktree with no public/assets still
   renders: both sides of an A/B are served the SAME asset bytes out of one
   tree, so the images cannot be the difference the A/B reports. Without it the
   head side 404s 47 requests and the screenshots differ for a reason that has
   nothing to do with the change under test. */
export function resolveServedFile(root, urlPath, opts = {}) {
  let p = decodeURIComponent(String(urlPath).split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const hit = (dir) => {
    const f = path.join(dir, p);
    return (f.startsWith(dir) && fs.existsSync(f) && !fs.statSync(f).isDirectory()) ? f : null;
  };
  const direct = hit(root);
  if (direct) return { file: direct, fallback: false, urlPath: p };
  const fb = opts.fallbackRoot;
  if (fb && (opts.fallbackPrefixes || ASSET_FALLBACK_PREFIXES).some(x => p.indexOf(x) === 0)) {
    const f = hit(fb);
    if (f) return { file: f, fallback: true, urlPath: p };
  }
  return null;
}

/* Serves <cwd>/public the way _shot-screen.mjs does. cwd, not REPO: abRun()
   runs a driver against a worktree by changing cwd, and the whole point is
   that the SAME driver file reads a DIFFERENT tree.

   opts.assetsFrom — a repo root to serve /assets/ from when the tree under
   test has none (i.e. every worktree). Pass REPO. boot.served.fallback counts
   how many requests took it, so a driver can print the number instead of
   assuming. */
export async function bootPage(opts = {}) {
  const { chromium } = await import('playwright');
  const root = path.resolve(opts.cwd || process.cwd(), 'public');
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    throw new Error('bootPage: no public/index.html under ' + root + ' (cwd=' + process.cwd() + ')');
  }
  const fallbackRoot = opts.assetsFrom ? path.resolve(opts.assetsFrom, 'public') : null;
  const served = { ok: 0, fallback: 0, missing: 0, missingPaths: [] };
  const srv = http.createServer((q, r) => {
    const hit = resolveServedFile(root, q.url, { fallbackRoot, fallbackPrefixes: opts.fallbackPrefixes });
    if (!hit) {
      served.missing++;
      if (served.missingPaths.length < 20) served.missingPaths.push(String(q.url).split('?')[0]);
      r.writeHead(404); return r.end('nf');
    }
    served.ok++; if (hit.fallback) served.fallback++;
    r.writeHead(200, { 'Content-Type': MIME[path.extname(hit.file)] || 'application/octet-stream' });
    fs.createReadStream(hit.file).pipe(r);
  });
  const port = await new Promise((res, rej) => {
    const p = 9600 + Math.floor(Math.random() * 300);
    srv.once('error', rej); srv.listen(p, '127.0.0.1', () => res(p));
  });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1500, height: 1400 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  /* Everything off-box is aborted: the harness must not depend on the network,
     and a live Supabase call from a test client is not something to fire at a
     game with real money in it. */
  await page.route('**/*', r => {
    const u = r.request().url();
    return (u.includes('127.0.0.1') || u.includes('fonts.googleapis') || u.includes('fonts.gstatic')
      || u.includes('cdn.jsdelivr')) ? r.continue() : r.abort();
  });
  await page.addInitScript(() => { try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {} });
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof render === "function" && typeof App === "object" && typeof Forge === "object"',
    null, { timeout: 180000 });
  await page.waitForTimeout(opts.settle == null ? 3500 : opts.settle);
  const close = async () => { try { await browser.close(); } catch (e) {} try { srv.close(); } catch (e) {} };
  return { page, browser, server: srv, port, errors, close, root, served, fallbackRoot };
}

/* ── the one entry point that is allowed to say "the editor is open" ─────── */
/* openCardEditor(page, cardId, opts)
   Signs the page in as an ADMIN_EMAILS address, renders the Forge, and throws
   unless App.screen === 'forge' AND EXACTLY ONE .card-editor is really in the
   DOM. Returns the page on success — so `await openCardEditor(...)` is the page.

   opts.email         — override the identity. null/false leaves whatever
                        seedNonAdmin() already put on Profile.cloud alone.
   opts.allowNonAdmin — skip the pre-flight ADMIN_EMAILS check, for the callers
                        whose point is to prove the gate still bites. Without
                        it a typo'd address fails HERE, in node, naming the
                        whitelist — not three screenshots later.
   opts.keepFxOpen    — do not clear App._fxOpen first (see below).
   opts.allowForcedHosts / opts.allowStrayFields — keep litter deliberately.
   opts.paintSettleMs — how long the PAINT gate waits for the app's 0.22 s
                        page-fade before judging (default 900 ms). It changes
                        the waiting, never the judging; there is no flag that
                        turns the paint gate off.

   ⚠ AND IT ENDS BY ASKING WHETHER THE EDITOR IS PAINTED (bug 17). Every count
     below can be right while the screen shows none of it: a critic got
     .card-editor=1, .editor-field=289, 0 stray and forceOpen's shown=71 of 86
     out of `body{opacity:0}` (screenshot: 9,243 B against 497,843) and out of
     an opaque full-viewport overlay. assertPainted is the last thing this
     function does, after every count assertion has had its say.

   ⚠ EXACTLY ONE, NOT AT LEAST ONE (bug 1 above). A leftover forceOpen host or
     a second editor rendered elsewhere in the page doubles every
     document-scoped count taken afterwards, and the old `if (!r.editors)`
     waved that straight through: measured .card-editor=2 and .editor-field=570
     against a true 289.
   ⚠ AND EVERY .editor-field IS INSIDE THAT ONE EDITOR (bug 10). Counting
     .card-editor alone let a host holding ONE SECTION (#fx-effects: 200
     .editor-field, 0 .card-editor) through, and the document read 481 fields
     where the truth is 289. Measured on a clean page: 289 in, 0 out.
   ⚠ App._fxOpen IS CLEARED FIRST (bug 6 above). Opening a <details> here fires
     a toggle that bindCardEditor (149058) records in App._fxOpen, and that
     survives the next render — so the second editor built in one page comes
     back with sections already open and a same-page A/B on `opened` compares
     two different open-sets. Clearing it makes render N and render N+1
     comparable, which is the whole reason a driver renders twice. */
export async function openCardEditor(page, cardId, opts = {}) {
  const id = cardId == null || cardId === '' ? 'NEW' : String(cardId);
  const hasEmail = Object.prototype.hasOwnProperty.call(opts, 'email');
  const email = hasEmail ? opts.email : ADMIN_EMAIL;
  const keepIdentity = hasEmail && !email;
  if (!keepIdentity && !opts.allowNonAdmin) assertAdminEmail(email);

  const r = await page.evaluate((a) => {
    const out = { toasts: [] };
    /* The sign-in overlay sits above everything and swallows clicks; the house
       driver removes it too. */
    try { const g = document.getElementById('auth-gate'); if (g) g.remove(); } catch (e) {}
    /* Toasts are the ONLY thing the admin gate emits, so capture them — the
       assertion below quotes it back as proof of which path ran.
       ⚠ AND PUT IT BACK (bug 5): the first version left the capture stub in
         window.showToast forever, so every later piece that asserted on a toast
         saw an empty screen and called it a missing feature. */
    let toastOrig = null;
    try {
      toastOrig = window.showToast;
      if (typeof toastOrig === 'function') {
        window.__harnessToasts = [];
        window.showToast = function (m) { try { window.__harnessToasts.push(String(m)); } catch (e) {} };
      }
    } catch (e) {}
    if (!a.keep) {
      Profile.cloud = Object.assign({}, Profile.cloud || {}, { signedIn: true, email: a.email });
    }
    out.email = (Profile.cloud && Profile.cloud.email) || null;
    out.isAdmin = (typeof isAdmin === 'function') ? !!isAdmin() : null;
    App.screen = 'forge';
    App.forgeTab = 'cards';
    /* renderForge picks the FIRST editing id that is set (144711), so a stale
       one from an earlier call would render the wrong editor and the
       .card-editor assertion would pass on the wrong screen. */
    App.editingMoveId = null; App.editingEventId = null; App.editingEncounterId = null;
    App.editingPackId = null; App.editingStructDeckId = null; App.editingGuideId = null;
    App.editingItemId = null; App.editingTutorialId = null;
    try { out.fxOpenBefore = JSON.stringify(App._fxOpen || null); } catch (e) {}
    if (!a.keepFxOpen) { try { App._fxOpen = {}; } catch (e) {} }
    out.customCards = (Forge && Forge.customCards && Forge.customCards.length) || 0;
    out.known = a.id === 'NEW' || !!(Forge.customCards || []).find(c => c && c.id === a.id);
    App.editingCardId = a.id;
    if (a.id === 'NEW' && typeof makeNewCardDraft === 'function') App._newCardDraft = makeNewCardDraft();
    /* renderForge() DIRECTLY, not render(): render() wraps _renderImpl in a
       try/catch that logs a crash and keeps the last good screen (131845), so
       a driver that goes through it cannot tell "the editor threw" from "the
       editor rendered". Straight into the renderer, exceptions and all. */
    try {
      if (typeof renderForge !== 'function') throw new Error('renderForge is not a function');
      renderForge();
    } catch (e) { out.renderError = String((e && e.stack) || e).slice(0, 500); }
    out.screen = App.screen;
    out.titleHub = App.titleHub || null;
    out.editors = document.querySelectorAll('.card-editor').length;
    out.fields = document.querySelectorAll('.editor-field').length;
    out.sections = document.querySelectorAll('.fx-sec, .fx-sub').length;
    out.openSections = document.querySelectorAll('.fx-sec[open], .fx-sub[open]').length;
    out.editingCardId = App.editingCardId;
    /* Where a duplicate came from, named: a host forceOpen(…, {keep:true}) left
       attached carries this marker. */
    try {
      const hosts = document.querySelectorAll('[data-forge-harness-host]');
      out.forcedHosts = hosts.length;
      out.forcedHostEditors = 0;
      out.forcedHostFields = 0;
      for (const h of hosts) {
        out.forcedHostEditors += h.querySelectorAll('.card-editor').length;
        out.forcedHostFields += h.querySelectorAll('.editor-field').length;
      }
    } catch (e) { out.forcedHosts = -1; }
    /* ⚠ COUNTING .card-editor IS NOT ENOUGH (bug 10). A critic left a host
       attached whose innerHTML was ONE SECTION of the editor —
       #fx-effects.outerHTML, 200 .editor-field and 0 .card-editor, which is
       what a driver photographing a single section actually builds — and the
       EXACTLY-ONE check waved it through while the document went from 289
       .editor-field to 481 and #fx-onplay from 86 to 171. The invariant that
       really holds on a clean page, measured 2026-09-08: every one of the 289
       .editor-field is inside the one .card-editor, 0 outside. */
    try {
      let inside = 0;
      const eds = document.querySelectorAll('.card-editor');
      for (const e of eds) inside += e.querySelectorAll('.editor-field').length;
      out.fieldsInEditor = inside;
      out.fieldsOutside = out.fields - inside;
      /* …and WHERE they are, so the blame is earned rather than assumed. */
      /* the whole id chain up to <body>, not just the nearest one: a clone of a
         SECTION of the editor carries that section's own id (#fx-effects), so
         the nearest id names the thing that was copied and tells the reader
         nothing about who copied it. The chain names both. */
      const nameOf = (node) => {
        const parts = [];
        for (let el = node; el && parts.length < 5; el = el.parentElement) {
          if (el.hasAttribute && el.hasAttribute('data-forge-harness-host')) parts.push('[data-forge-harness-host]');
          else if (el.id) parts.push('#' + el.id);
          else if (el === document.body) parts.push('body');
        }
        return parts.length ? parts.join(' < ') : '(detached from the document)';
      };
      const strays = [];
      const fieldNodes = document.querySelectorAll('.editor-field');
      for (let i = 0; i < fieldNodes.length && strays.length < 4; i++) {
        const f = fieldNodes[i];
        if (f.closest && f.closest('.card-editor')) continue;
        const k = nameOf(f.parentElement);
        if (strays.indexOf(k) < 0) strays.push(k);
      }
      out.strayFieldsUnder = strays;
      out.editorsUnder = [];
      for (const e of eds) out.editorsUnder.push(nameOf(e.parentElement));

      /* ⚠ AND NEITHER OF THOSE SEES SECTION-SHAPED LITTER (bug 16). A critic
         appended 7 <details class="fx-sec"/"fx-sub"> holding ZERO .editor-field
         to <body>: .card-editor=1, .editor-field=289, 0 outside — every
         assertion above green — while .fx-sec went 5 → 8 and .fx-sub 13 → 17.
         Those two counters are not hypothetical: the harness's OWN A/B driver
         prints them ("fx-sec=5 fx-sub=10"), so the litter moves a number this
         file measures on. The stray invariant was written for .editor-field
         only, and empty sections were free. Measured on a clean page
         2026-09-08: 18 sections, 0 of them outside the one editor. */
      const secNodes = document.querySelectorAll('.fx-sec, .fx-sub');
      const strandedSecs = [];
      out.sectionsOutside = 0;
      for (const s of secNodes) {
        if (s.closest && s.closest('.card-editor')) continue;
        out.sectionsOutside++;
        const k = nameOf(s.parentElement);
        if (strandedSecs.indexOf(k) < 0 && strandedSecs.length < 4) strandedSecs.push(k);
      }
      out.straySectionsUnder = strandedSecs;
    } catch (e) { out.fieldsOutside = -1; }

    /* ⚠ A DUPLICATE ID IS A WRONG NUMBER OUT OF THE MOST ORDINARY DOM READ
       THERE IS (bug 15), and nothing above can see one. A critic prepended an
       EMPTY <div id="fx-onplay"> to <body> — outside #app, so renderForge
       rebuilds the editor around it forever — and every assertion above stayed
       green: editors=1, fields=289, 0 outside, 0 hosts. Then
       document.getElementById('fx-onplay').querySelectorAll('.editor-field')
       reads 0 against a truth of 86, because getElementById answers with the
       FIRST match in document order. Measured on a clean page 2026-09-08: 697
       elements carry an id, all 697 unique, 673 of them inside the editor; the
       whole scan is one querySelectorAll and costs 1.6 ms.
       ⚠ ONLY IDS THE EDITOR ACTUALLY USES ARE REFUSED. A duplicate id over on
         the city screen is a real bug, but it is not this driver's wrong
         number, and failing every screenshot piece over one would be the same
         unearned blame as bugs 7 and 11. The count of the others is reported
         instead, so a reader still sees them. */
    try {
      const counts = new Map();
      const withId = document.querySelectorAll('[id]');
      for (const el of withId) counts.set(el.id, (counts.get(el.id) || 0) + 1);
      out.idElems = withId.length;
      out.uniqueIds = counts.size;
      let dupTotal = 0;
      for (const n of counts.values()) if (n > 1) dupTotal++;
      const ed = document.querySelector('.card-editor');
      const dups = [];
      let dupEditorTotal = 0;
      if (ed) {
        const done = new Set();
        for (const el of ed.querySelectorAll('[id]')) {
          if (done.has(el.id)) continue;
          done.add(el.id);
          if ((counts.get(el.id) || 0) < 2) continue;
          dupEditorTotal++;
          if (dups.length >= 4) continue;
          const first = document.getElementById(el.id);
          dups.push({
            id: el.id, n: counts.get(el.id),
            /* what getElementById actually hands the next reader, and what it
               costs them: the field count of the winner vs of the editor's. */
            resolvesInsideEditor: !!(first && first.closest && first.closest('.card-editor')),
            fieldsInEditorCopy: el.querySelectorAll('.editor-field').length,
            fieldsInWinner: first ? first.querySelectorAll('.editor-field').length : -1,
          });
        }
      }
      out.dupEditorIds = dups;
      out.dupEditorIdCount = dupEditorTotal;
      out.dupIdsElsewhere = dupTotal - dupEditorTotal;
    } catch (e) { out.dupEditorIdCount = -1; out.dupEditorIds = []; }
    try { out.toasts = (window.__harnessToasts || []).slice(0, 4); } catch (e) {}
    try {
      if (typeof toastOrig === 'function') { window.showToast = toastOrig; }
      out.toastRestored = window.showToast === toastOrig;
    } catch (e) { out.toastRestored = false; }
    return out;
  }, { email: keepIdentity ? null : email, keep: keepIdentity, keepFxOpen: !!opts.keepFxOpen, id });

  /* ⚠ THE WHOLE POINT OF THE FILE. The gate does not throw and does not return
     a value, so the only evidence it fired is the state it leaves behind.
     ⚠ AND THE BLAME HAS TO BE EARNED (bug 7). The gate's signature is its own
       toast plus screen='title' plus titleHub='forge'. Anything else that
       leaves isAdmin() false or the screen wrong is a DIFFERENT bug, and
       pointing at the gate would send the next reader to the wrong function. */
  if (!r.isAdmin || r.screen !== 'forge') {
    const toastSeen = (r.toasts || []).some(t => /Forge is admin-only/i.test(String(t)));
    const gateSig = toastSeen && r.screen === 'title' && r.titleHub === 'forge';
    const common = ' isAdmin()=' + r.isAdmin + ' for email=' + JSON.stringify(r.email)
      + ', App.screen=' + JSON.stringify(r.screen) + ' (titleHub=' + JSON.stringify(r.titleHub) + ')'
      + ', toasts=' + JSON.stringify(r.toasts)
      + ', .card-editor=' + r.editors + ', .editor-field=' + r.fields + '.';
    throw new Error(gateSig
      ? 'openCardEditor: BLOCKED BY THE FORGE ADMIN GATE (renderForge, ' + gateWhere() + ').'
        + common + ' It RETURNED WITHOUT THROWING — a driver that skips this'
        + ' assertion photographs the title screen and reports a pass.'
      : 'openCardEditor: did NOT reach the Forge, and the admin gate at ' + gateWhere()
        + ' did NOT fire — its signature (the "Forge is admin-only" toast +'
        + ' screen="title" + titleHub="forge") was not observed, so this is'
        + ' something else and the gate is not the place to look.' + common
        + (r.renderError ? ' renderError=' + r.renderError : ''));
  }
  /* ⚠ THE BLAME FOLLOWS THE COUNT (bug 11). The first version of this message
     told every reader to call releaseForced() — including the one whose second
     editor was appended straight to document.body, for whom it printed "0 of
     them are inside 0 host(s)" and sent them to a function that would not have
     helped. Same unearned blame as the admin gate's (bug 7), one message over. */
  const blameHosts = () => (r.forcedHostEditors > 0
    ? r.forcedHostEditors + ' of them are inside ' + r.forcedHosts
      + ' host(s) left attached by forceOpen(sel, host, { keep: true }); call releaseForced()'
      + ' (or drop the keep flag) before rendering again.'
    : 'NO forceOpen host holds any of them (' + r.forcedHosts + ' host(s) attached), so'
      + ' releaseForced() will NOT help — they are under ' + JSON.stringify(r.editorsUnder)
      + ' and something other than this harness put them there.');
  if (r.editors !== 1) {
    throw new Error('openCardEditor: expected EXACTLY ONE .card-editor, found ' + r.editors
      + (r.editors === 0
        ? ' — cardId=' + JSON.stringify(id) + ' known=' + r.known
          + ' (Forge.customCards=' + r.customCards + '), App.editingCardId=' + JSON.stringify(r.editingCardId)
          + '. renderCardEditor() falls back to renderForgeCards() for an unknown id (145737),'
          + ' which renders the card LIST and would be measured as if it were the editor.'
        : ' — DUPLICATE EDITORS IN ONE DOCUMENT. ' + blameHosts()
          + ' Every document-scoped count taken now is multiplied: .editor-field=' + r.fields
          + ' where one editor is ~289, .fx-sec/.fx-sub=' + r.sections + '.')
      + ' .editor-field=' + r.fields + (r.renderError ? ' renderError=' + r.renderError : ''));
  }
  /* ⚠ AND EXACTLY ONE EDITOR IS STILL NOT ENOUGH (bug 10). A host carrying a
     SECTION of the editor has no .card-editor in it at all and inflates every
     document-scoped count just the same: measured .editor-field 289 → 481,
     #fx-onplay 86 → 171, and the old check returned OK. */
  if (r.fieldsOutside !== 0 && !opts.allowStrayFields) {
    throw new Error('openCardEditor: ' + r.fieldsOutside + ' .editor-field are in the document but'
      + ' NOT inside the one .card-editor (' + r.fieldsInEditor + ' in / ' + r.fields + ' total;'
      + ' a clean page measures 289 in / 0 out). They are under '
      + JSON.stringify(r.strayFieldsUnder) + ' — ' + r.forcedHosts + ' forceOpen host(s) attached,'
      + ' holding ' + r.forcedHostFields + ' field(s).'
      + (r.forcedHosts > 0 ? ' Call releaseForced() before rendering again.' : '')
      + ' EVERY document-scoped count taken now is inflated by them, which is the exact'
      + ' failure this assertion exists to stop. Pass { allowStrayFields: true } only if'
      + ' measuring the litter is the point.');
  }
  /* ⚠ SECTION-SHAPED LITTER WITH NO FIELDS IN IT (bug 16) — see the measurement
     note in the evaluate above. It slips past the .editor-field invariant by
     carrying no fields at all, and still moves .fx-sec / .fx-sub, which this
     harness's own A/B driver prints. */
  if (r.sectionsOutside !== 0 && !opts.allowStraySections) {
    throw new Error('openCardEditor: ' + r.sectionsOutside + ' .fx-sec/.fx-sub are in the document but'
      + ' NOT inside the one .card-editor (' + r.sections + ' total, ' + r.openSections + ' open;'
      + ' a clean page measures 18 in / 0 out). They are under '
      + JSON.stringify(r.straySectionsUnder) + '. They hold no .editor-field, which is exactly'
      + ' why the stray-field assertion above let them through, and document-scoped .fx-sec /'
      + ' .fx-sub counts — which this harness prints in its own A/B — are inflated by them.'
      + ' Pass { allowStraySections: true } only if measuring the litter is the point.');
  }
  /* ⚠ THE DUPLICATE ID (bug 15). Not an inflated count — a wrong one, handed
     out by getElementById to whoever asks next. */
  if (r.dupEditorIdCount > 0 && !opts.allowDuplicateIds) {
    const d = r.dupEditorIds[0] || {};
    throw new Error('openCardEditor: ' + r.dupEditorIdCount + ' id(s) used by the editor are DUPLICATED'
      + ' in the document — ' + JSON.stringify(r.dupEditorIds) + '.'
      + ' (' + r.idElems + ' elements carry an id, ' + r.uniqueIds + ' of them unique; a clean page'
      + ' measures 697 / 697. ' + r.dupIdsElsewhere + ' more duplicate id(s) exist outside the'
      + ' editor and are NOT refused — they are not this driver\'s number.)'
      + ' Every count above is still right; document.getElementById(' + JSON.stringify(d.id || '')
      + ') is NOT — it answers with the FIRST match in document order, which is'
      + (d.resolvesInsideEditor ? '' : ' NOT') + ' the editor\'s copy'
      + ' (' + d.fieldsInWinner + ' .editor-field in the winner vs ' + d.fieldsInEditorCopy
      + ' in the editor\'s). A screenshot scoped by id photographs the wrong element and reports'
      + ' a confident zero. Pass { allowDuplicateIds: true } only if the duplicate is the point.');
  }
  /* A host with no fields in it is not a wrong number today, but it is the same
     litter one render away from being one, and it is one line to refuse. */
  if (r.forcedHosts > 0 && !opts.allowForcedHosts) {
    throw new Error('openCardEditor: ' + r.forcedHosts + ' forceOpen host(s) are still attached to the'
      + ' document (' + r.forcedHostFields + ' .editor-field, ' + r.forcedHostEditors + ' .card-editor'
      + ' inside them). Call releaseForced() — or drop { keep: true } — before rendering again.'
      + ' Pass { allowForcedHosts: true } to keep them deliberately.');
  }
  if (r.renderError) throw new Error('openCardEditor: renderForge() threw — ' + r.renderError);
  /* ⚠ AND EVERY COUNT ABOVE CAN BE RIGHT WHILE THE SCREEN IS BLANK (round 3,
     defect 1). Both of a critic's bypasses — body{opacity:0} and an opaque
     full-viewport fixed overlay — leave editors=1, .editor-field=289, 0 stray,
     0 duplicate ids, and forceOpen still reporting shown=71 of 86 "really
     visible"; the screenshots were 9,243 B and a flat rectangle. Counting the
     DOM cannot see either one, so the paint gate runs LAST, after every count
     assertion has had its say, and it is not optional: a driver that could skip
     it is the next confident wrong number. */
  /* opts.paintSettleMs only changes how long the gate WAITS for the app's
     0.22 s page-fade to finish before judging — never whether it judges. */
  page.forgePaint = await assertPainted(page, { sel: '.card-editor', fieldSel: '.editor-field',
                                                settleMs: opts.paintSettleMs });
  page.forgeOpen = r;   // handy for callers; the assertions above are the contract
  return page;
}

/* ── ownership-gated UI cannot be judged from the admin's own client ─────── */
/* seedNonAdmin(profile[, own])
   Mutates and returns the profile object it is given.

   ⚠ SELF-CONTAINED ON PURPOSE — it references nothing from module scope so it
     can be stringified into the page, which is how it is actually used:
         await page.evaluate('(' + seedNonAdmin + ')(Profile)')
     A default argument pointing at NON_ADMIN_EMAIL would look tidier and would
     throw ReferenceError inside the page. _selfCheck asserts the literal below
     still equals the exported NON_ADMIN_EMAIL so the two cannot drift.

   ⚠ IT CLEARS cardCollection, and that is not optional. ensureAdminCardGrant
     (index.html:43026) tops the admin up to 3 of EVERY card and writes it into
     Profile.cardCollection. Changing the email afterwards makes isAdmin() false
     — so deckKeyOwnedCount stops returning Infinity (59966) — but the granted
     copies are still sitting in the profile, and every ownership-gated control
     still reads as owned. Half a sign-out is worse than none: it looks like the
     gate was tested. */
export function seedNonAdmin(profile, own) {
  const p = profile || {};
  p.cloud = { signedIn: true, email: 'nonadmin@mythicsoa.test', id: 'harness-nonadmin' };
  p.cardCollection = own || {};
  return p;
}

/* forceOpen(selector[, scope[, opts]])
   Opens every <details> on the path to each matched node and, if the subtree
   is detached, attaches it to document.body for the measurement and TAKES IT
   OFF AGAIN. Returns a report; run it in the page:
       await page.evaluate(forceOpen, '#fx-onplay .editor-field')
   or, for a host built the drive-scale-per.mjs way (detached div + innerHTML):
       await page.evaluate((s) => forceOpenFn(s, window.__host), sel)
   To keep the host attached — the only reason being to photograph it —
       forceOpenFn(sel, host, { keep: true })
   and call releaseForced() before the next render. openCardEditor refuses to
   run with one still attached, by name.

   ⚠ ALSO SELF-CONTAINED (see seedNonAdmin).
   ⚠ WHY THE HOST IS ATTACHED AT ALL: a detached subtree is not in the document,
     so document.querySelectorAll() matches ZERO nodes and every measurement
     over it is 0 — not "the control is missing", which is how it reads in a
     report.
   ⚠ WHY IT IS DETACHED AGAIN: it used to be left there forever. The recipe in
     this file's own header then produced .card-editor=2 and .editor-field=570
     against a true 289, and openCardEditor said OK. A driver cleans up after
     itself or it is measuring its own litter.
   ⚠ WHY EVERY ANCESTOR AND NOT JUST THE SECTION: #fx-onplay is a .fx-sub
     nested inside the .fx-sec #fx-effects (index.html:148900-148905). Opening
     the sub alone leaves it inside a closed parent.
   ⚠ MEASURED, AND IT MATTERS: in Chromium 142 a CLOSED <details> hides its
     contents with content-visibility, NOT display:none. Inside one,
     offsetParent is still non-null and offsetHeight still reports the last
     layout — 71 of the 86 #fx-onplay fields answer "visible" to all three of
     offsetParent / offsetHeight / getClientRects while the section is shut.
     element.checkVisibility() is the only one that answers 0 → 71, and it is
     the only one a mutant with the opening line deleted can kill. The report
     carries both counts so a caller cannot pick the flattering one by accident:
     `shown` is checkVisibility and is the one to judge on, `visible` is
     offsetParent and is kept only to show it lying.
   ⚠ SETTING .open FIRES A `toggle` EVENT, and bindCardEditor listens for it
     (index.html:149058-149065) and writes App._fxOpen[id] — asynchronously, so
     this function cannot undo it before it happens. openCardEditor clears
     App._fxOpen instead; a driver that renders twice WITHOUT going through
     openCardEditor must clear it itself or its second `opened` count is
     smaller than its first for no reason at all.
   ⚠ display:none is cleared ONLY on a .fx-sec / .fx-sub that really holds an
     .editor-field. bindCardEditor hides genuinely empty sections on purpose
     (150609-150614) — Obtain & Craft is one on a new card — and un-hiding
     those would inflate every count taken afterwards. Nothing else on the
     ancestor path is touched: the editor hides type-gated controls inline, and
     revealing those would report options the author does not actually have. */
export function forceOpen(selector, scope, opts) {
  const o = opts || {};
  const root = (scope && scope.querySelectorAll) ? scope : document;
  const rep = { selector: String(selector), matched: 0, opened: 0, unhidden: 0,
                appendedHost: false, detachedHost: false, keptHost: false,
                visible: 0, shown: 0 };
  let attached = null;
  if (root !== document && root.nodeType === 1 && !root.isConnected) {
    try { root.setAttribute('data-forge-harness-host', '1'); } catch (e) {}
    document.body.appendChild(root); rep.appendedHost = true; attached = root;
  }
  const nodes = Array.prototype.slice.call(root.querySelectorAll(selector));
  rep.matched = nodes.length;
  for (let i = 0; i < nodes.length; i++) {
    for (let el = nodes[i]; el; el = el.parentElement) {
      if (el.tagName === 'DETAILS' && !el.open) { el.open = true; rep.opened++; }
      if (el.style && el.style.display === 'none' && el.matches
          && el.matches('.fx-sec, .fx-sub') && el.querySelector('.editor-field')) {
        el.style.display = ''; rep.unhidden++;
      }
    }
  }
  rep.visible = nodes.filter(function (e) { return e.offsetParent !== null; }).length;
  /* ⚠ NO FALLBACK, ON PURPOSE (bug 12). `shown` used to become the offsetParent
     predicate — the one this comment calls a liar — under the same field name
     when checkVisibility was absent, so a caller's before/after on the field
     the file documents as "the one to judge on" read 71 → 71 on a SHUT editor
     and concluded forceOpen did nothing. null makes every `shown > 0` and
     `shown === n` test fail closed instead. */
  var canSee = nodes.length === 0 || typeof nodes[0].checkVisibility === 'function';
  /* ⚠ WITH THE OPACITY OPTION ON (round 3, defect 1). A critic put
     `body{opacity:0}` in front of the visibility read and this line still said
     shown=71 of 86 "really visible" — while the screenshot of that same frame
     was 9,243 bytes against 497,843 for the clean render. Bare
     checkVisibility() answers the CSS-box question (is it laid out, is it in a
     shut <details>), not the ink question, and this file's entire job is the
     ink question. checkVisibility({opacityProperty}) is the ink half of it:
     measured on this tree, clean 71 of 86 either way, and 0 of 86 under
     body{opacity:0}. An engine that does not know the options object ignores it
     and this degrades to exactly the old predicate, which is why `shownLoose`
     is kept beside it — the two being equal is itself the evidence that the
     option is understood. Occlusion is the other half and no predicate on the
     element can see it at all: that is paintProbe() / assertPainted(). */
  var CV_OPTS = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  rep.shownPredicate = canSee ? 'checkVisibility({opacityProperty,visibilityProperty,contentVisibilityAuto})'
    : 'UNAVAILABLE — this engine has no Element.checkVisibility(); `visible` (offsetParent) is'
      + ' NOT a substitute (measured: it answers 71 of 86 while the section is shut)';
  rep.shown = canSee ? nodes.filter(function (e) { return e.checkVisibility(CV_OPTS); }).length : null;
  rep.shownLoose = canSee ? nodes.filter(function (e) { return e.checkVisibility(); }).length : null;
  /* …and the occlusion half, on the nodes this report CLAIMS are visible: the
     top element at the node's own coordinates has to be the node or something
     inside it. An opaque fixed overlay leaves shown untouched at 71 and takes
     `painted` to 0. Only nodes inside the viewport can be sampled — a node
     scrolled off the bottom has no coordinates to hit-test — so `paintSampled`
     is printed next to `painted` and a caller must not read painted=0 as
     "covered" when paintSampled is 0 too. */
  rep.painted = 0; rep.paintSampled = 0; rep.paintBlockers = [];
  if (canSee && typeof document !== 'undefined' && document.elementFromPoint) {
    var vw = window.innerWidth, vh = window.innerHeight;
    for (var pi = 0; pi < nodes.length && rep.paintSampled < 12; pi++) {
      var pn = nodes[pi];
      if (!pn.checkVisibility(CV_OPTS)) continue;
      var pr = pn.getBoundingClientRect();
      if (pr.width <= 0 || pr.height <= 0) continue;
      if (pr.bottom <= 0 || pr.top >= vh || pr.right <= 0 || pr.left >= vw) continue;
      var pxx = Math.min(Math.max((Math.max(0, pr.left) + Math.min(vw, pr.right)) / 2, 0), vw - 1);
      var pyy = Math.min(Math.max((Math.max(0, pr.top) + Math.min(vh, pr.bottom)) / 2, 0), vh - 1);
      rep.paintSampled++;
      var ptop = document.elementFromPoint(pxx, pyy);
      if (ptop && (ptop === pn || pn.contains(ptop))) { rep.painted++; continue; }
      var pname = !ptop ? 'null' : ptop.tagName + (ptop.id ? '#' + ptop.id : '')
        + (typeof ptop.className === 'string' && ptop.className
           ? '.' + ptop.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      if (rep.paintBlockers.indexOf(pname) < 0 && rep.paintBlockers.length < 4) rep.paintBlockers.push(pname);
    }
  }
  if (attached) {
    if (o.keep) {
      rep.keptHost = true;
      try { (window.__forgeHarnessHosts = window.__forgeHarnessHosts || []).push(attached); } catch (e) {}
    } else {
      attached.parentNode && attached.parentNode.removeChild(attached);
      rep.detachedHost = true;
    }
  }
  return rep;
}

/* releaseForced() — take every host forceOpen(…, { keep: true }) left attached
   back off the document. Returns how many. ⚠ SELF-CONTAINED (see seedNonAdmin):
       await page.evaluate('(' + releaseForced + ')()') */
export function releaseForced() {
  let n = 0;
  const hosts = document.querySelectorAll('[data-forge-harness-host]');
  for (let i = 0; i < hosts.length; i++) {
    if (hosts[i].parentNode) { hosts[i].parentNode.removeChild(hosts[i]); n++; }
  }
  try { window.__forgeHarnessHosts = []; } catch (e) {}
  return n;
}

/* ── VISIBLE IS NOT PAINTED, AND PAINTED IS THIS FILE'S WHOLE JOB ────────── */
/* paintProbe(cfg) — run in the page. Answers "is the thing this harness says
   it is looking at actually the ink on the screen", by two questions no
   element-level predicate can answer:
     · OCCLUSION — document.elementFromPoint at 16 points spread over the
       editor's on-screen rectangle, plus the same test on up to 12 of the
       .editor-field it CLAIMS are visible: the top element must be the editor
       (or the field) or something inside it.
     · OPACITY — checkVisibility({opacityProperty}) on the editor itself.
   ⚠ WHY IT EXISTS (round 3, defect 1). Two critic bypasses, both of which the
     harness waved through with confident numbers:
       body{opacity:0}        forceOpen reported shown=71 of 86 "really
                              visible", openCardEditor did not throw, and the
                              screenshot was 9,243 bytes against 497,843 for a
                              clean render.
       an opaque fixed        same shown=71 of 86, same silence — and
       full-viewport overlay  elementFromPoint said ZERO of the sampled fields
                              were on top. Measured here: gridOnTop 0 of 16.
     Both are a driver photographing something that is not the editor and
     reporting a pass, which is the one failure this file was written for.
   ⚠ THE FIELD SAMPLE IS FILTERED BY THE HARNESS'S OWN CLAIM, and that is not a
     softening: fields inside a SHUT <details> keep a stale rect that
     elementFromPoint resolves to the summary bar above them (measured: 7 of 12
     sampled that way land on SUMMARY.fx-sum on a perfectly clean page). The
     honest question is "of the fields you say are visible, how many are really
     on top", so the sample is exactly checkVisibility()-true fields. On a shut
     editor that set is EMPTY and the grid over the editor rect carries the
     assertion alone — which is why the grid is there and not only the fields.
   ⚠ ONLY WHAT IS IN THE VIEWPORT CAN BE HIT-TESTED. The card editor is 13,397
     px tall against a 1,400 px viewport, so most of it has no coordinates to
     ask about; `clip` says what part was examined and the byte floor is scaled
     to that same rectangle rather than to the whole page. */
export function paintProbe(cfg) {
  const c = cfg || {};
  const sel = c.sel || '.card-editor';
  const fieldSel = c.fieldSel || '.editor-field';
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = { vw, vh, found: 0, rect: null, clip: null, grid: 0, gridOnTop: 0,
                fieldsClaimed: 0, fieldsSampled: 0, fieldsOnTop: 0,
                blockers: [], opacityVisible: null, cvPlain: null };
  const eds = document.querySelectorAll(sel);
  out.found = eds.length;
  const ed = eds[0];
  if (!ed) return out;
  /* the id CHAIN, not just the nearest name (the same rule openCardEditor's
     stray-field blame follows, and for the same reason): the thing on top is
     often an anonymous <iframe> and the only useful part of the answer is the
     id of the overlay holding it — measured on this tree, the blocker that
     turned up on this gate's very first run reads
     "IFRAME < #narr-overlay < body". */
  const nameOf = (n) => {
    if (!n) return 'null';
    const parts = [];
    for (let el = n; el && parts.length < 4; el = el.parentElement) {
      if (el === n) {
        parts.push(el.tagName + (el.id ? '#' + el.id : '')
          + (typeof el.className === 'string' && el.className
             ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
      } else if (el.id) parts.push('#' + el.id);
      else if (el === document.body) parts.push('body');
    }
    return parts.join(' < ');
  };
  const note = (n) => { const s = nameOf(n); if (out.blockers.indexOf(s) < 0 && out.blockers.length < 4) out.blockers.push(s); };
  const r = ed.getBoundingClientRect();
  out.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
  const w = Math.min(vw, r.right) - x0, h = Math.min(vh, r.bottom) - y0;
  out.clip = [Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)];
  const OPTS = { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true };
  try { out.opacityVisible = ed.checkVisibility(OPTS); out.cvPlain = ed.checkVisibility(); } catch (e) {}
  if (w <= 0 || h <= 0) return out;                       // nothing of it is on screen
  for (let i = 1; i <= 4; i++) for (let j = 1; j <= 4; j++) {
    const x = x0 + w * i / 5, y = y0 + h * j / 5;
    out.grid++;
    const top = document.elementFromPoint(x, y);
    if (top && (top === ed || ed.contains(top))) out.gridOnTop++; else note(top);
  }
  const claimed = [];
  for (const f of ed.querySelectorAll(fieldSel)) {
    if (!f.checkVisibility(OPTS)) continue;
    const fr = f.getBoundingClientRect();
    if (fr.width <= 0 || fr.height <= 0) continue;
    if (fr.bottom <= 0 || fr.top >= vh || fr.right <= 0 || fr.left >= vw) continue;
    claimed.push([f, fr]);
  }
  out.fieldsClaimed = claimed.length;
  const step = Math.max(1, Math.floor(claimed.length / 12));
  for (let i = 0; i < claimed.length && out.fieldsSampled < 12; i += step) {
    const f = claimed[i][0], fr = claimed[i][1];
    const px = Math.min(Math.max((Math.max(0, fr.left) + Math.min(vw, fr.right)) / 2, 0), vw - 1);
    const py = Math.min(Math.max((Math.max(0, fr.top) + Math.min(vh, fr.bottom)) / 2, 0), vh - 1);
    out.fieldsSampled++;
    const top = document.elementFromPoint(px, py);
    if (top && (top === f || f.contains(top))) out.fieldsOnTop++; else note(top);
  }
  return out;
}

/* The byte floor, per pixel of the rectangle actually photographed. MEASURED
   on this tree 2026-09-08, 1500×1400, the editor's on-screen rect 844×1219 =
   1,028,836 px:
       clean, sections shut     247,114 B   0.2402 B/px
       clean, forceOpen'd       425,256 B   0.4133 B/px
       body{opacity:0}            5,601 B   0.0054 B/px   ← 44× below the shut render
       (whole viewport, for the record: 496,993 B clean, 9,243 B at opacity 0)
   0.02 B/px sits 3.7× above the blank render and 12× below the dimmest real
   one, so it catches "nothing was painted" without reddening on a legitimately
   flatter screen.
   ⚠ AND IT IS NOT THE OCCLUSION CHECK, however tempting the numbers look. A
     FLAT cover happens to fall under it (the mutant overlay photographs at
     5,602 B), but a TEXTURED one sails over: the real overlay this app puts up
     — #narr-overlay, the narrative reel — photographs at 1,267,415 B for the
     whole viewport, five times the clean editor. A byte floor tightened until
     it caught that would red on every calm layout. Occlusion is
     elementFromPoint's job above; two checks, two failure modes, neither
     pretending to do the other's work. */
export const PAINT_BYTES_PER_PX = 0.02;
export const PAINT_MIN_CLIP_PX = 10000;      // 100×100: less than this is not "on screen"

/* assertPainted(page, opts) — the assertion path's paint gate. Throws with the
   numbers in the message; returns the probe otherwise.
   opts.sel / opts.fieldSel — what to judge (default .card-editor/.editor-field)
   opts.screenshot: false — skip the byte floor only (for a page object with no
     screenshot method). The in-page half always runs; there is no flag that
     turns the whole gate off, because a driver that could pass one would be
     the next confident wrong number. */
/* why the in-page half of the gate is unhappy, or null. Separate so the gate
   can RE-ASK it: see the settle loop below. */
function paintComplaint(p, sel) {
  if (!p.found) return 'no ' + sel + ' is in the document at all';
  if (!p.clip || p.clip[2] <= 0 || p.clip[3] <= 0) {
    return 'none of it is inside the viewport — its rect is ' + JSON.stringify(p.rect);
  }
  if (p.clip[2] * p.clip[3] < PAINT_MIN_CLIP_PX) {
    return 'only ' + (p.clip[2] * p.clip[3]) + ' px² of it are on screen, under the '
      + PAINT_MIN_CLIP_PX + ' px² floor';
  }
  if (p.opacityVisible === false) {
    return 'checkVisibility({opacityProperty}) says it is INVISIBLE while plain checkVisibility()'
      + ' says ' + p.cvPlain + ' — something on its ancestor chain has opacity:0 or'
      + ' visibility:hidden, and it stayed that way for the whole settle budget';
  }
  /* one point of sixteen is allowed to land on something else — a toast, a
     rounded corner, a sticky header clipping the top edge. Two is a cover. */
  if (p.gridOnTop < p.grid - 1) {
    return 'only ' + p.gridOnTop + ' of ' + p.grid + ' points spread over it hit the editor;'
      + ' the rest hit ' + JSON.stringify(p.blockers);
  }
  if (p.fieldsSampled > 0 && p.fieldsOnTop !== p.fieldsSampled) {
    return p.fieldsOnTop + ' of ' + p.fieldsSampled + ' sampled .editor-field that the harness'
      + ' CLAIMS are visible are actually the top element at their own coordinates'
      + ' (' + p.fieldsClaimed + ' claimed and in view); the others hit ' + JSON.stringify(p.blockers);
  }
  return null;
}

export async function assertPainted(page, opts = {}) {
  const sel = opts.sel || '.card-editor';
  /* ⚠ THE SETTLE LOOP IS NOT A SLEEP-UNTIL-GREEN (measured, and it cost a run
     to find). #app carries `animation: page-fade-in 0.22s`, which restarts on a
     screen change — so for the first frames after renderForge() the computed
     opacity of an ancestor really IS 0 and checkVisibility({opacityProperty})
     really does answer false. Failing there would be a true statement about a
     frame nobody photographs. The loop re-asks until the fade is over and then
     judges; body{opacity:0} never becomes true, so the budget costs the mutant
     900 ms and changes nothing else. It is a budget, not a fixed wait: a page
     already painted asks once and pays ~5 ms. */
  const budget = opts.settleMs == null ? 900 : opts.settleMs;
  const t0 = Date.now();
  let p = null, why = null, tries = 0;
  for (;;) {
    p = await page.evaluate(paintProbe, { sel: opts.sel, fieldSel: opts.fieldSel });
    tries++;
    why = paintComplaint(p, sel);
    if (!why || Date.now() - t0 >= budget) break;
    await page.waitForTimeout(60);
  }
  p.settleMs = Date.now() - t0;
  p.attempts = tries;
  const where = ' (viewport ' + p.vw + '×' + p.vh + ', ' + sel
    + ' rect ' + JSON.stringify(p.rect) + ', on-screen ' + JSON.stringify(p.clip)
    + ', ' + tries + ' probe(s) over ' + p.settleMs + ' ms)';
  const fail = (msg) => {
    const e = new Error('assertPainted: THE EDITOR IS NOT PAINTED — ' + msg + where
      + ' A screenshot taken now is not a photograph of what the counts above describe,'
      + ' and every one of those counts is still perfectly green: this is exactly the'
      + ' "confident wrong number" case (a critic got shown=71 of 86 out of both'
      + ' body{opacity:0} and an opaque full-viewport overlay).');
    e.name = 'ForgePaintError';
    e.paint = p;
    throw e;
  };
  if (why) fail(why);
  if (opts.screenshot !== false && typeof page.screenshot === 'function') {
    const clip = { x: p.clip[0], y: p.clip[1], width: p.clip[2], height: p.clip[3] };
    const area = p.clip[2] * p.clip[3];
    p.bytesFloor = Math.max(2000, Math.round(area * PAINT_BYTES_PER_PX));
    let buf = await page.screenshot({ clip });
    /* one retry, for the same reason as the settle loop: a frame caught
       mid-fade is dimmer and compresses smaller. */
    if (buf.length < p.bytesFloor) { await page.waitForTimeout(250); buf = await page.screenshot({ clip }); }
    p.bytes = buf.length;
    p.bytesPerPx = +(buf.length / area).toFixed(4);
    if (p.bytes < p.bytesFloor) {
      fail('the PNG of that rectangle is ' + p.bytes + ' B (' + p.bytesPerPx + ' B/px) against a'
        + ' floor of ' + p.bytesFloor + ' B (' + PAINT_BYTES_PER_PX + ' B/px) — the clean render'
        + ' of the same rectangle measures ~0.24-0.41 B/px and a blank one 0.0054');
    }
  }
  return p;
}

/* forceOpenMutant() — forceOpen with its ONE <details>-opening line deleted,
   as source, for the self-check. A visibility predicate that still "passes"
   against this is not measuring anything: it is the mutant a critic built by
   hand, kept here so it runs on every check instead of once in a review. */
export const FORCE_OPEN_MUTATION = 'el.open = true;';
export function forceOpenMutant() {
  const src = String(forceOpen);
  const n = src.split(FORCE_OPEN_MUTATION).length - 1;
  if (n !== 1) {
    throw new Error('forceOpenMutant: expected exactly one "' + FORCE_OPEN_MUTATION
      + '" in forceOpen, found ' + n + ' — the mutant no longer describes the code it mutates.');
  }
  return src.replace(FORCE_OPEN_MUTATION, '/* MUTANT: the only <details>-opening line, deleted */');
}

/* ── A/B against a worktree, never against the working tree ──────────────── */
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/* opts.tries > 1 retries the git LOCK errors only — two agents A/Bing at once
   both touch .git, and losing a race to .git/index.lock is not a reason to
   fail a run (bug 4). Anything else fails on the first attempt, loudly. */
/* The ONLY git verbs this harness is allowed to run against the MAIN working
   tree. Everything a worktree needs (checkout, sparse-checkout) is run with
   `-C <worktree>` and is therefore not against the main tree at all.
   ⚠ WHY THIS IS CODE AND NOT A RULE IN A COMMENT: "nothing here moves the
     working tree" was enforced by a grep for one banned verb, and a grep does
     not stop `reset`, `restore`, `clean` or `checkout --`. Other agents write
     to this tree and deploy.mjs minifies public/index.html in place, so a
     harness that moves it can lose real work. Now a tree-moving verb throws
     inside this function, in this process, before git is spawned — and clause
     (13) proves it by trying one. */
const GIT_MAIN_TREE_VERBS = new Set(['status', 'worktree', 'ls-tree', 'ls-files',
  'rev-parse', 'config', 'diff', 'log', 'show', 'cat-file']);
export function gitVerbOf(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '-C' || a === '--git-dir' || a === '--work-tree') { i++; continue; }
    if (a[0] === '-') continue;
    return a;
  }
  return null;
}
function git(args, opts = {}) {
  const tries = opts.tries || 1;
  const cwd = opts.cwd || REPO;
  /* ⚠ canonPath, not path.resolve (round 3). `git reset --hard` with
     cwd = path.toNamespacedPath(REPO) is the same command in the same tree, and
     path.resolve() leaves the \\?\ prefix on, so the string compare below said
     "not the main tree" and the refusal never fired. */
  if (canonPath(cwd) === canonPath(REPO) && args.indexOf('-C') < 0) {
    const verb = gitVerbOf(args);
    if (!GIT_MAIN_TREE_VERBS.has(verb)) {
      throw new Error('_forge-harness: REFUSING to run `git ' + verb + '` in the MAIN working tree ('
        + REPO + '). Only ' + [...GIT_MAIN_TREE_VERBS].join('/') + ' are allowed there;'
        + ' anything that moves the tree can destroy another agent\'s uncommitted work,'
        + ' and this harness A/Bs through `git worktree` precisely so it never has to.'
        + ' Run it with -C <worktree> if the target is a worktree.');
    }
  }
  for (let i = 1; ; i++) {
    const r = spawnSync('git', args, { cwd: opts.cwd || REPO, encoding: 'utf8',
                                       maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    if (r.status === 0) return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
    const err = String(r.stderr || '').trim();
    const lock = /index\.lock|cannot lock|Unable to create|File exists/i.test(err);
    if (i < tries && lock) { sleepMs(200 * i); continue; }
    if (opts.check === false) return { code: r.status, out: String(r.stdout || ''), err };
    throw new Error('git ' + args.join(' ') + ' failed (' + r.status + '): ' + err.slice(0, 400));
  }
}

/* A fresh worktree on D:\ is owned by "Everyone", which git reports as dubious
   ownership and refuses to touch. Passing -c safe.directory per command keeps
   that fix INSIDE this run — writing it to the user's global git config would
   be a permanent config change made by a test harness. */
const safe = (p) => ['-c', 'safe.directory=' + p.replace(/\\/g, '/')];

/* Where per-run worktrees live: a sibling of the repo, never inside it (a
   worktree under the repo would show up in the main tree's own git status and
   break the one thing abRun promises). One directory so the reaper has one
   place to sweep. */
export const AB_HOME = path.resolve(REPO, '..', 'forge-ab');
/* An owner stamp older than this is assumed abandoned even if its pid is still
   alive, because pids are reused. Two hours is far longer than any A/B here
   (the slowest is ~2 min) and far shorter than "until a human notices". */
const AB_STALE_MS = 2 * 60 * 60 * 1000;

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}
function abRunId() {
  return process.pid + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}
function stampPathFor(dir) { return path.join(AB_HOME, path.basename(dir) + '.owner.json'); }
function writeStamp(dir) {
  fs.mkdirSync(AB_HOME, { recursive: true });
  fs.writeFileSync(stampPathFor(dir), JSON.stringify({ pid: process.pid, started: Date.now(), dir }));
}

/* reapStaleWorktrees() — take back the worktrees of runs that died.
   THE BUG: the paths used to be the fixed ../head-ab and ../base-ab, so a
   killed process left a directory that made every later run refuse ("already
   exists — remove it first"), and a critic hit exactly that when another agent
   was mid-A/B. Per-run paths fix the collision; this fixes the litter.
   ⚠ IT MUST NEVER TAKE A LIVE RUN'S WORKTREE — not at ANY age (round 2). The
     first version took one whose owner pid was alive once the stamp passed
     AB_STALE_MS, on a pid-reuse argument. That is the wrong trade: the paths
     are per-run and unique, so a stale directory blocks nobody and costs only
     disk, while `worktree remove --force` under a colleague's live A/B
     corrupts their measurement halfway through and they get a wrong number,
     which is the one outcome this whole file exists to prevent. A live owner is
     now reported in reaped.skipped and left completely alone.
   ⚠ Nothing outside AB_HOME (plus the two legacy fixed names, age-gated only,
     since a run of the OLD harness leaves no stamp) is ever touched. */
export function reapStaleWorktrees(now) {
  const t = now || Date.now();
  const reaped = [];
  const skipped = [];
  if (fs.existsSync(AB_HOME)) {
    for (const f of fs.readdirSync(AB_HOME)) {
      if (!/\.owner\.json$/.test(f)) continue;
      const sp = path.join(AB_HOME, f);
      let s = null;
      try { s = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch (e) {}
      const dir = (s && s.dir) || path.join(AB_HOME, f.replace(/\.owner\.json$/, ''));
      let age = Infinity;
      try { age = t - ((s && s.started) || fs.statSync(sp).mtimeMs); } catch (e) {}
      const ageMs = age === Infinity ? null : Math.round(age);
      if (pidAlive(s && s.pid)) {
        skipped.push({ dir, pid: s.pid, ageMs, why: 'owner pid ' + s.pid + ' is ALIVE — another A/B is using it' });
        continue;
      }
      const gone = dropWorktree(dir);
      try { fs.unlinkSync(sp); } catch (e) {}
      reaped.push({ dir, pid: (s && s.pid) || null, ageMs, why: 'owner pid is gone', removed: gone });
    }
  }
  reaped.skipped = skipped;   // a property on the array: JSON.stringify ignores it, callers can read it
  for (const legacy of [path.resolve(REPO, '..', 'head-ab'), path.resolve(REPO, '..', 'base-ab')]) {
    if (!fs.existsSync(legacy)) continue;
    let age = 0;
    try { age = t - fs.statSync(legacy).mtimeMs; } catch (e) {}
    if (age < AB_STALE_MS) continue;   // could belong to an agent running the old harness right now
    reaped.push({ dir: legacy, pid: null, ageMs: Math.round(age),
                  why: 'legacy fixed path, no owner stamp, untouched for ' + Math.round(age / 60000) + ' min',
                  removed: dropWorktree(legacy) });
  }
  git(['worktree', 'prune'], { check: false, tries: 3 });
  return reaped;
}

/* defaultSparse(ref) — every public/ subdir at that ref EXCEPT public/assets.
   THE BUG (3): the old default was ['public/src', '.gauntlet'], so the head
   side had ONE public/ subdir where the live side has 26 — public/models,
   node-city, corp, battle-board, pack-opener and the rest simply were not
   there, and any metric that read one reported a difference that was really a
   missing checkout.
   ⚠ public/assets STAYS OUT and cannot be argued back in: 4,332 files / 4.06 GB,
     and it does not merely cost time — measured on this tree, checking it out
     into a temp path dies with "Filename too long" on
     public/assets/Units/unit frames/…/bugs and bunny.zip and leaves a partial
     tree. Reads under it are refused by name instead (see asymmetricPaths).
   ⚠ .gauntlet is out too, deliberately: the driver is always run from the MAIN
     tree (see abRun), so a driver reading .gauntlet is reading files that are
     uncommitted on one side by definition. That is now a refusal, not a
     silent difference. */
export function defaultSparse(ref) {
  const out = git(['ls-tree', '--name-only', '-d', ref || 'HEAD', 'public/'], { tries: 3 }).out;
  const dirs = out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(d => d !== 'public/assets');
  if (!dirs.length) throw new Error('defaultSparse: git ls-tree found no public/ subdirs at ' + ref);
  return dirs;
}

function addWorktree(dir, ref, sparse) {
  git(['worktree', 'add', '--no-checkout', '--detach', dir, ref], { tries: 4 });
  if (sparse !== null) {
    /* CONE mode. The non-cone form ('/*' plus '!/public/assets/') silently
       ignores the negation here and checks out all 4 GB of public/assets —
       measured: 1,385 asset files and 2.5 GB before it was killed. Cone mode
       still gives every file directly under public/ (index.html, sw.js), which
       is what a driver reads. */
    git([...safe(dir), '-C', dir, 'sparse-checkout', 'set', '--cone', ...sparse], { tries: 3 });
  }
  git([...safe(dir), '-C', dir, 'checkout'], { tries: 3 });
  return dir;
}
/* Every worktree THIS PROCESS removed, in order. The same argument as
   repoWrites (bug 8), applied to the other hand: "no foreign worktree was
   disturbed" used to be proved by diffing the machine-global `git worktree
   list` across the run, which is a property of the machine and not of this run
   — a colleague's own A/B finishing inside the window subtracts a line, and the
   run that took nothing gets told it did. dropWorktree() is the ONLY thing here
   that removes a worktree, so recording its arguments answers the question
   exactly, and answers it about this process alone. */
export const WORKTREES_DROPPED = [];
function dropWorktree(dir) {
  WORKTREES_DROPPED.push(normWt(dir));
  if (!fs.existsSync(dir)) { git(['worktree', 'prune'], { check: false, tries: 3 }); return false; }
  git([...safe(dir), 'worktree', 'remove', '--force', dir], { check: false, tries: 3 });
  /* ⚠ PRUNE AFTER THE fs FALLBACK, NOT ONLY BEFORE IT (round 2). `worktree
     remove` loses to a Windows file lock often enough that the rmSync below is
     load-bearing, and the prune used to run BEFORE it — so it saw the directory
     still on disk, kept the administrative entry in .git/worktrees, and left a
     "prunable" line in `git worktree list` that this call would never clear. A
     critic saw one of those immediately after a run. */
  if (fs.existsSync(dir)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  git(['worktree', 'prune'], { check: false, tries: 3 });
  return !fs.existsSync(dir);   // "removed", not "we tried" — a lock we lost must not read as success
}

/* `git worktree list --porcelain` → absolute paths, normalised for comparison.
   ⚠ The non-porcelain form is column-aligned text and a worktree path with a
     space in it splits wrong; and these are compared as a SET per run, never as
     a string or a line count, because the list is machine-global (see bug 8). */
const normWt = (p) => canonPath(p).replace(/\\/g, '/').toLowerCase();
function worktreePaths() {
  const out = git(['worktree', 'list', '--porcelain'], { tries: 3 }).out;
  return out.split('\n').filter(l => l.indexOf('worktree ') === 0)
            .map(l => normWt(l.slice(9).trim()));
}

/* ── the asymmetric-path guard (bug 3) ───────────────────────────────────── */
/* Directories that are legitimately one-sided and are NOT a false difference:
   node_modules is resolved from the SCRIPT, which always lives in the main
   tree (see abRun), so both runs import the same modules by design; .git is
   not content. */
const AB_GUARD_SKIP = new Set(['node_modules', '.git']);

/* …and the same argument covers two FILES, which cost a self-check run to
   find: the driver is executed from where it lives and this harness is
   imported by absolute URL, so on the HEAD side both are read from the main
   tree (outside that side's root, never flagged) and on the BASE side they are
   read from the same main tree — the identical bytes, through a path that only
   LOOKS one-sided because the base side's root is the main tree. Flagging them
   refused the A/B for the driver's own `import` line.
   ⚠ THE LIMIT OF THAT: a driver that reads a SIBLING file relative to itself
     (.gauntlet/foo.json next to .gauntlet/foo.mjs) is symmetric for the same
     reason and is NOT exempted here, because from inside the shim it is
     indistinguishable from a cwd-relative read of a tree that has no
     .gauntlet. Pass it in opts.allowOneSided and the report will say so. */
function guardExempt(driverAbs) {
  const rel = (p) => {
    const r = path.relative(REPO, p);
    return (!r || r.startsWith('..') || path.isAbsolute(r)) ? null : r.replace(/\\/g, '/');
  };
  return [rel(fileURLToPath(import.meta.url)), rel(driverAbs)].filter(Boolean);
}

/* asymmetricPaths(a, b) — every path that exists on exactly one of the two
   trees, shallowest first. It descends only into directories present on BOTH
   sides, so a one-sided directory is reported once and its (4,332 asset)
   children are never walked. */
export function asymmetricPaths(a, b, rel, out) {
  const acc = out || [];
  const r = rel || '';
  const list = (root) => {
    const m = new Map();
    let ents = [];
    try { ents = fs.readdirSync(path.join(root, r), { withFileTypes: true }); } catch (e) { return m; }
    for (const e of ents) m.set(e.name, e.isDirectory() ? 'd' : 'f');
    return m;
  };
  const ea = list(a), eb = list(b);
  const names = new Set([...ea.keys(), ...eb.keys()]);
  for (const name of names) {
    if (AB_GUARD_SKIP.has(name)) continue;
    const rr = r ? r + '/' + name : name;
    const inA = ea.has(name), inB = eb.has(name);
    if (inA && !inB) { acc.push({ path: rr, on: 'base' }); continue; }
    if (!inA && inB) { acc.push({ path: rr, on: 'head' }); continue; }
    if (ea.get(name) === 'd' && eb.get(name) === 'd') asymmetricPaths(a, b, rr, acc);
  }
  return acc;
}

/* The preload that makes a one-sided read visible. It cannot live in the
   driver (the whole point is that the driver is unmodified and does not know
   it is being A/B'd), so it goes in as `node --require`, which runs before the
   ESM entry point and therefore before any `import fs from 'node:fs'` snapshots
   the builtin's exports. It RECORDS rather than throws: an fs error raised
   inside, say, bootPage's http handler would surface as a 404 and be read as
   "the file is missing", which is the same confident wrong answer this guard
   exists to prevent. abRun does the refusing, after the run, by name. */
/* The names whose FIRST argument is a directory the caller is about to
   ENUMERATE. They are the ones that get a wrong answer from a directory that
   exists on both sides but whose CHILDREN do not (bug 9): readdirSync('public')
   answered 35 entries on the live side and 32 on the head side, asymmetricRead
   was empty, and nothing refused. Every other read only needs the path itself
   to be one-sided. */
const AB_LISTING_FNS = ['readdir', 'readdirSync', 'opendir', 'opendirSync', 'glob', 'globSync',
  'cp', 'cpSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'watch', 'watchFile'];

const AB_SHIM = `'use strict';
const fs = require('fs'); const path = require('path');
/* ⚠ THE SAME canonPath THE HARNESS USES, BY VALUE, NOT A SECOND COPY OF IT.
   Interpolated from String(canonPath) so the guard inside a preloaded driver
   and the guard in the harness process cannot drift apart — see the comment on
   canonPath for the \\?\ bypass that made both of them necessary. */
const canonPath = ${String(canonPath)};
const ROOT = canonPath(process.env.FORGE_AB_ROOT || process.cwd());
const REPO_MAIN = process.env.FORGE_AB_REPO ? canonPath(process.env.FORGE_AB_REPO) : '';
const LOG = process.env.FORGE_AB_ASYM_LOG;
const LISTING = new Set(${JSON.stringify(AB_LISTING_FNS)});
let LIST = [], DIRS = [], ALLOW = [], ESC_ALLOW = [];
try {
  const j = JSON.parse(fs.readFileSync(process.env.FORGE_AB_ASYM_LIST, 'utf8'));
  LIST = j.paths || []; DIRS = j.dirs || [];
} catch (e) {}
try { ALLOW = JSON.parse(process.env.FORGE_AB_ASYM_ALLOW || '[]'); } catch (e) {}
try { ESC_ALLOW = JSON.parse(process.env.FORGE_AB_ESC_ALLOW || '[]'); } catch (e) {}
const append = fs.appendFileSync.bind(fs);
const seen = new Set();
function under(rel, q) { return rel === q || rel.indexOf(q + '/') === 0; }
/* ⚠ EVERYTHING IS COMPARED LOWERCASE (bug 9). The old shim lowercased only for
   the ROOT prefix test and then matched the watch list case-SENSITIVELY, so
   fs.existsSync('public/Assets') — which Windows resolves to the same 4 GB
   directory — walked past the guard and produced a confident false difference
   from clause (11)'s own driver with one letter changed. Folding case can only
   make the guard refuse MORE, which is the safe direction for a guard. */
/* ⚠ AND EVERY ONE OF THEM THROUGH canonPath (round 3). path.resolve() keeps a
   \\?\ extended-length prefix exactly as it was given, so a read spelled
   path.toNamespacedPath(path.resolve(cwd,'public/assets')) matched NEITHER the
   ROOT prefix nor the REPO_MAIN one, and the guard did not merely mis-file it
   — it never recorded it. Measured before this line: base has-assets=true,
   head has-assets=false, identical=false, asymmetricRead=[], exit 0. */
function absOf(arg) {
  let p = arg;
  if (Buffer.isBuffer(p)) p = p.toString('utf8');
  else if (p && typeof p === 'object' && p.href) p = p.pathname.replace(/^\\/([A-Za-z]:)/, '$1');
  if (typeof p !== 'string' || !p) return null;
  return canonPath(p);
}
function relOf(arg) {
  const abs = absOf(arg);
  if (abs == null) return null;
  const la = abs.toLowerCase(), lr = ROOT.toLowerCase();
  if (la === lr) return '';                      // the tree root itself, so \`readdirSync(cwd)\` is reachable
  if (la.indexOf(lr + path.sep) !== 0) return null;
  return abs.slice(ROOT.length + 1).split(path.sep).join('/').toLowerCase();
}
/* ⚠ THE FALSE-NEGATIVE TWIN (bug 14). relOf() answers null for everything
   outside the side under test, so a driver holding an ABSOLUTE path into the
   MAIN repo — statSync('D:/game-deploy/public/index.html') — was invisible to
   the guard in BOTH directions: both sides read the same main-tree file, the
   A/B measured nothing, and it reported identical=true with no refusal. That is
   the same confident wrong answer as the false difference the guard exists to
   stop, one sign flipped: the harness's own live A/B on that very file reports
   15,686,526 vs 15,629,135 bytes, a real 57 KB difference the escaped driver
   would have called zero. escOf() names such a read relative to the MAIN repo
   so abRun can refuse it by name (AbEscapedTreeError). */
function escOf(arg) {
  if (!REPO_MAIN) return null;
  const abs = absOf(arg);
  if (abs == null) return null;
  const la = abs.toLowerCase();
  /* .toLowerCase() on BOTH sides, still: canonPath folds case on win32 only,
     and this comparison has folded it everywhere since bug 9 — a guard that
     refuses more is the safe direction. */
  if (la.indexOf(REPO_MAIN.toLowerCase() + path.sep) !== 0) return null;
  if (la.indexOf(ROOT.toLowerCase() + path.sep) === 0) return null;   // inside the side; relOf owns it
  return abs.slice(REPO_MAIN.length + 1).split(path.sep).join('/').toLowerCase();
}
function note(how, rel, cause) {
  const k = how + '\\t' + rel;
  if (seen.has(k)) return;
  seen.add(k);
  try { append(LOG, how + '\\t' + rel + '\\t' + cause + '\\n'); } catch (e) {}
}
function check(arg, listing) {
  try {
    const rel = relOf(arg);
    if (rel == null) {
      const esc = escOf(arg);
      if (esc == null) return;
      for (let i = 0; i < ESC_ALLOW.length; i++) if (under(esc, ESC_ALLOW[i])) return;
      for (let i = 0; i < ALLOW.length; i++) if (under(esc, ALLOW[i])) return;
      return note('escape', esc, 'read of the MAIN tree from inside the A/B side');
    }
    for (let i = 0; i < ALLOW.length; i++) if (under(rel, ALLOW[i])) return;
    for (let i = 0; i < LIST.length; i++) if (under(rel, LIST[i])) return note('read', rel, LIST[i]);
    if (!listing) return;
    for (let i = 0; i < DIRS.length; i++) {
      if (rel === DIRS[i].dir) return note('list', rel, DIRS[i].children.join(' '));
    }
  } catch (e) {}
}
function wrap(obj, name, inheritListing, depth) {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  const listing = LISTING.has(name) || !!inheritListing;
  const w = function (p) { check(p, listing); return orig.apply(this, arguments); };
  try { Object.assign(w, orig); } catch (e) {}
  /* ⚠ Object.assign HANDS BACK AN UNWRAPPED FUNCTION (bug 13). fs.realpathSync
     .native is an OWN ENUMERABLE property of fs.realpathSync, so the line above
     copies the raw builtin onto the wrapper and the guard re-exports its own
     bypass: measured, fs.realpathSync('public/assets') was refused by name
     while fs.realpathSync.native('public/assets') — same tree, same argument —
     reported base has-assets=true / head has-assets=false as a plain
     difference, identical=false, exit 0 on both sides, no refusal. The control
     pair is what isolated it: the ONLY thing separating the refused call from
     the bypass was the .native property this line copies. So anything copied
     across that is itself a lowercase function is wrapped too, by the same
     rule as the parent rather than by name (fs.realpath.native and
     fs.promises.realpath.native are today's members; the rule does not care).
     Depth 2 because a sub-function's own sub-functions are hypothetical and an
     unbounded walk over copied properties is a way to hang the shim. */
  if ((depth || 0) < 2) {
    for (const k of Object.keys(w)) {
      if (typeof w[k] === 'function' && /^[a-z]/.test(k)) wrap(w, k, listing, (depth || 0) + 1);
    }
  }
  try { Object.defineProperty(w, 'name', { value: name }); } catch (e) {}
  try { obj[name] = w; } catch (e) {}
}
/* ⚠ WRAP EVERY path-taking function, NOT A HAND-WRITTEN LIST (bug 9). The old
   list held 16 names and a critic walked through it with fs.opendirSync;
   globSync, readlink, cp, rm and watch were open by the same argument. check()
   ignores a first argument that is not a string/Buffer/URL, so wrapping the
   fd-first functions (readSync, fstatSync…) costs a typeof and catches nothing.
   Names that begin with a capital are CONSTRUCTORS (fs.Dirent, fs.ReadStream,
   fs.Dir): calling one without \`new\` throws, so they are left alone. */
for (const n of Object.keys(fs)) if (/^[a-z]/.test(n)) wrap(fs, n);
try { for (const n of Object.keys(fs.promises)) if (/^[a-z]/.test(n)) wrap(fs.promises, n); } catch (e) {}
`;

/* watchRepoWrites(fn) — run fn with this process's fs WRITE calls instrumented,
   and return every path it wrote under REPO.
   ⚠ WHY THIS EXISTS AT ALL (bug 8). "the A/B left the main working tree alone"
     used to be proved by diffing `git status --porcelain` across the run — and
     that is not a property of THIS run, it is a property of the machine. Two
     critics watched it go red because another agent's untracked `.forgetmp/`
     appeared or vanished during the window; abRun cannot tell "I moved the
     tree" from "somebody else did" by reading a shared counter. This can: it
     watches the only hands the harness has. Together with the git verb guard
     in git() it covers both ways this file could move the tree — fs and git —
     and the git status delta stays in the report as evidence, printed with the
     names of whatever moved, instead of being asserted on. */
const REPO_WRITE_FNS = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'mkdir',
  'rmSync', 'rm', 'rmdirSync', 'rmdir', 'unlinkSync', 'unlink', 'renameSync', 'rename',
  'copyFileSync', 'copyFile', 'cpSync', 'cp', 'createWriteStream', 'truncateSync', 'truncate',
  'writeSync', 'openSync', 'open'];
export function installRepoWriteWatch() {
  const hits = [];
  const saved = [];
  const note = (a, name) => {
    try {
      let p = a;
      if (Buffer.isBuffer(p)) p = p.toString('utf8');
      else if (p && typeof p === 'object' && p.href) p = p.pathname.replace(/^\/([A-Za-z]:)/, '$1');
      if (typeof p !== 'string' || !p) return;               // an fd, not a path
      /* canonPath, not path.resolve (round 3): a write to the \\?\ spelling of
         a repo path is a write to the repo, and the prefix used to make this
         prefix-test answer "outside the repo" — the same hole the A/B guards
         had, in the watch that proves the main tree was left alone. */
      const abs = canonPath(p);
      if (abs.toLowerCase().indexOf(canonPath(REPO).toLowerCase() + path.sep) !== 0) return;
      hits.push(name + ' ' + abs.slice(REPO.length + 1).replace(/\\/g, '/'));
    } catch (e) {}
  };
  /* ⚠ open()/openSync() ARE ON THE LIST BUT MOST CALLS TO THEM ARE READS —
     fs.readFileSync goes through openSync('r'), and counting that would have
     made repoWrites non-empty for anything that so much as read
     public/index.html, i.e. a guard that cries wolf is a guard nobody believes.
     Measured while writing this: the first version recorded
     "openSync package.json" for a plain readFileSync. Only a flag that can
     write counts. */
  const readOnlyOpen = (name, flags) => {
    if (name !== 'open' && name !== 'openSync') return false;
    if (flags === undefined || flags === null) return true;                 // defaults to 'r'
    if (typeof flags === 'number') return (flags & 3) === 0;                // O_RDONLY
    return /^rs?$/.test(String(flags));                                     // 'r', 'rs' — not 'r+'
  };
  for (const n of REPO_WRITE_FNS) {
    const orig = fs[n];
    if (typeof orig !== 'function') continue;
    saved.push([n, orig]);
    const w = function (p) { if (!readOnlyOpen(n, arguments[1])) note(p, n); return orig.apply(this, arguments); };
    try { Object.assign(w, orig); } catch (e) {}
    fs[n] = w;
  }
  return { hits, restore: () => { for (const [n, orig] of saved) fs[n] = orig; } };
}

function runDriver(driverAbs, cwd, args, timeout, guard) {
  const argv = [];
  if (guard) argv.push('--require', guard.shim);
  argv.push(driverAbs, ...args);
  const env = Object.assign({}, process.env, { FORGE_AB_CWD: cwd });
  if (guard) {
    env.FORGE_AB_ROOT = cwd;
    env.FORGE_AB_ASYM_LIST = guard.list;
    env.FORGE_AB_ASYM_LOG = guard.log;
    env.FORGE_AB_ASYM_ALLOW = JSON.stringify(guard.allow || []);
    env.FORGE_AB_REPO = REPO;
    env.FORGE_AB_ESC_ALLOW = JSON.stringify(guard.escAllow || []);
  }
  const r = spawnSync(process.execPath, argv, {
    cwd, encoding: 'buffer', timeout: timeout || 900000,
    maxBuffer: 64 * 1024 * 1024, windowsHide: true, env,
  });
  const stdout = r.stdout || Buffer.alloc(0);
  let touched = [], detail = [], escaped = [];
  if (guard) {
    try {
      detail = fs.readFileSync(guard.log, 'utf8').split('\n').filter(Boolean).map((l) => {
        const [how, p, cause] = l.split('\t');
        return { how, path: p, cause: cause || '' };
      });
      /* 'escape' is a read of the MAIN tree from inside a side (bug 14) and is
         reported on its own channel: it is the opposite failure to a one-sided
         read (a false SAMENESS, not a false difference) and the two messages
         send the reader to different fixes. */
      escaped = detail.filter(d => d.how === 'escape');
      detail = detail.filter(d => d.how !== 'escape');
      touched = detail.map(d => d.path);
    } catch (e) {}
    try { fs.writeFileSync(guard.log, ''); } catch (e) {}
  }
  return { cwd, code: r.status, stdout, stdoutText: stdout.toString('utf8'),
           stderr: String(r.stderr || '').slice(0, 2000), bytes: stdout.length, sha: sha(stdout),
           touchedOneSided: touched, touchedDetail: detail, escapedDetail: escaped };
}

/* abRun(driver[, opts])
   Runs the SAME driver file against two trees and compares stdout byte for
   byte. Default: the live working tree vs a `git worktree` at HEAD.

   opts.ref      — what the HEAD side checks out (default 'HEAD')
   opts.baseRef  — check the BASE side out into its own worktree too, instead
                   of using the live working tree. baseRef:'HEAD' is the no-op
                   A/B: two identical trees must produce identical bytes, and a
                   harness that reports a difference there is measuring noise.
   opts.sparse   — cone dirs for the worktrees (default: defaultSparse(ref);
                   null = a full checkout, which FAILS on public/assets — see
                   defaultSparse)
   opts.args     — argv passed to the driver
   opts.allowOneSided — path prefixes whose one-sidedness is answered for by
                   the caller, e.g. ['public/assets'] together with
                   bootPage({ assetsFrom: REPO }), which serves BOTH sides the
                   same asset bytes out of one tree. Echoed in the report so
                   the allowance is on the record next to the numbers.
   opts.strictPaths — false to allow ALL one-sided reads (they are still
                   reported in report.asymmetricRead); default is to REFUSE.
                   Prefer allowOneSided: a blanket off-switch is how a false
                   difference gets back in.
   opts.wt/baseWt — worktree paths (default: per-run, under AB_HOME)

   ⚠ THE DRIVER IS RUN FROM WHERE IT LIVES, with cwd pointed at each tree — it
     is NOT re-resolved inside the worktree. Two reasons, both of which cost a
     run to find out: (a) a driver written today is UNCOMMITTED, so it does not
     exist in a HEAD worktree at all and the head side would die with
     ERR_MODULE_NOT_FOUND; (b) node resolves node_modules by walking up from
     the SCRIPT, so a driver executed out of the worktree cannot import
     playwright — the worktree has no node_modules and never will. Read the
     tree under test through process.cwd() (bootPage does).

   ⚠ REFUSES rather than reports a false difference (bug 3). If the driver READS
     a path that exists on only one side, this throws an
     AbAsymmetricPathError naming the paths. public/assets is the standing
     example: it is 4 GB and cannot be checked out, so `fs.existsSync('public/
     assets')` answers true on the live side and false on the head side, and an
     unguarded A/B calls that a difference in whatever it was measuring.

   ⚠ The working tree is never parked and restored: other agents write to it,
     and a lost edit there is real work. The PROOF of that is per-run, because
     a shared counter cannot carry it (bug 8): report.mainTree.repoWrites is
     every fs write this process made under the repo during the run (must be
     empty), git() refuses any main-tree verb but a read, and
     ownWorktreesGone / foreignWorktreesPreserved say this run's worktrees are
     gone and nobody else's were taken. The raw `git status --porcelain` shas,
     the line-by-line statusDelta and worktreeListIdentical are all still in the
     report — as evidence to print, never as the assertion, because on this
     machine they move when another agent saves a file. */
export async function abRun(driver, opts = {}) {
  const driverAbs = path.isAbsolute(driver) ? driver : path.resolve(REPO, driver);
  if (!fs.existsSync(driverAbs)) throw new Error('abRun: no such driver ' + driverAbs);
  const ref = opts.ref || 'HEAD';
  const sparse = opts.sparse === undefined ? defaultSparse(ref) : opts.sparse;
  const args = opts.args || [];
  const strict = opts.strictPaths !== false;
  const allowed = (opts.allowOneSided || []).map(p => String(p).replace(/\\/g, '/').replace(/\/+$/, ''));
  const id = abRunId();
  const dropMark = WORKTREES_DROPPED.length;      // before the reaper, which drops too
  const reaped = reapStaleWorktrees();
  fs.mkdirSync(AB_HOME, { recursive: true });
  const wt = path.resolve(opts.wt || path.join(AB_HOME, 'head-' + id));
  const baseWt = path.resolve(opts.baseWt || path.join(AB_HOME, 'base-' + id));
  /* canonPath on both sides (round 3): a \\?\-spelled opts.wt is the same
     directory and must hit the same refusal. */
  if (canonPath(wt) === canonPath(REPO) || canonPath(baseWt) === canonPath(REPO)) {
    throw new Error('abRun: refusing to use the repo itself as a worktree');
  }
  for (const d of [wt, opts.baseRef ? baseWt : null]) {
    if (d && fs.existsSync(d)) throw new Error('abRun: ' + d + ' already exists — remove it first (git worktree remove --force)');
  }

  const statusBefore = git(['status', '--porcelain'], { tries: 3 }).out;
  const listBefore = git(['worktree', 'list'], { tries: 3 }).out;
  const pathsBefore = worktreePaths();
  const made = [];
  const report = { driver: driverAbs, ref, baseRef: opts.baseRef || null, id, sparse,
                   worktrees: { created: [], removed: [], reaped } };
  const writeWatch = installRepoWriteWatch();
  let guard = null;
  let baseCwd = REPO;
  try {
    writeStamp(wt);
    made.push(addWorktree(wt, ref, sparse));
    report.worktrees.created.push(wt);
    if (opts.baseRef) {
      writeStamp(baseWt);
      made.push(addWorktree(baseWt, opts.baseRef, sparse));
      report.worktrees.created.push(baseWt);
      baseCwd = baseWt;
    }
    report.listDuring = git(['worktree', 'list'], { tries: 3 }).out;
    report.asymmetric = asymmetricPaths(baseCwd, wt).map(x => x.path);
    report.oneSidedAllowed = allowed;
    report.oneSidedByDesign = guardExempt(driverAbs);
    if (strict) {
      const exempt = allowed.concat(report.oneSidedByDesign);
      const watched = report.asymmetric.filter(p => !exempt.some(a => p === a || p.indexOf(a + '/') === 0));
      /* The PARENTS of everything watched, with the one-sided children named
         (bug 9). asymmetricPaths reports a one-sided DIRECTORY once and never
         walks its 4,332 children, so the watch list holds 'public/assets' and
         'public/src/mercenary' and never 'public' or 'public/src' — which is
         what fs.readdirSync actually names. A listing of a parent gets a
         different answer on the two sides for exactly the same reason a read of
         the child does, and it was the one form that got through. */
      const dirMap = new Map();
      for (const p of watched) {
        const i = p.lastIndexOf('/');
        const d = (i < 0 ? '' : p.slice(0, i)).toLowerCase();
        if (!dirMap.has(d)) dirMap.set(d, []);
        const kids = dirMap.get(d);
        if (kids.length < 6) kids.push(p);
      }
      report.watchedDirs = [...dirMap.keys()];
      const stem = path.join(os.tmpdir(), 'forge-ab-guard-' + id);
      /* What a driver is ALLOWED to read out of the main tree (bug 14). Three
         entries, each earned by a documented design decision above:
           node_modules  — "node resolves node_modules by walking up from the
                           SCRIPT", so the driver's playwright (and chromium,
                           250 MB of it) can only come from the main tree;
           the harness    — every driver imports it from where it lives, by the
           + the driver     same rule that runs the driver out of the main tree
                           (see THE DRIVER IS RUN FROM WHERE IT LIVES). Both are
                           already computed as oneSidedByDesign;
           package.json   — node stats it walking up to resolve the two above.
         Everything else under the repo is a driver reading the tree it is NOT
         under test on, which is exactly bug 14. */
      const escAllow = ['node_modules', 'package.json', 'package-lock.json']
        .concat(report.oneSidedByDesign).map(s => s.toLowerCase());
      guard = { shim: stem + '.cjs', list: stem + '.json', log: stem + '.log',
                allow: exempt.map(s => s.toLowerCase()), escAllow };
      report.escapeAllowed = escAllow;
      fs.writeFileSync(guard.shim, AB_SHIM);
      fs.writeFileSync(guard.list, JSON.stringify({
        paths: watched.map(s => s.toLowerCase()),
        dirs: [...dirMap.entries()].map(([dir, children]) => ({ dir, children })),
      }));
      fs.writeFileSync(guard.log, '');
    }
    report.base = runDriver(driverAbs, baseCwd, args, opts.timeout, guard);
    report.head = runDriver(driverAbs, wt, args, opts.timeout, guard);
  } finally {
    if (!opts.keep) {
      for (const d of made.reverse()) {
        if (dropWorktree(d)) report.worktrees.removed.push(d);
        try { fs.unlinkSync(stampPathFor(d)); } catch (e) {}
      }
    }
    if (guard) for (const f of [guard.shim, guard.list, guard.log]) { try { fs.unlinkSync(f); } catch (e) {} }
    writeWatch.restore();
  }
  const statusAfter = git(['status', '--porcelain'], { tries: 3 }).out;
  report.listAfter = git(['worktree', 'list'], { tries: 3 }).out;
  report.listBefore = listBefore;
  const pathsAfter = worktreePaths();
  const mine = report.worktrees.created.map(normWt);
  const inAbHome = (p) => p.indexOf(normWt(AB_HOME) + '/') === 0;
  const lines = (s) => s.split('\n').filter(Boolean);
  const beforeSet = new Set(lines(statusBefore)), afterSet = new Set(lines(statusAfter));
  /* ⚠ EVERY FIELD BELOW IS EITHER PER-RUN OR LABELLED AS EVIDENCE (bug 8).
     `unchanged` and `worktreeListIdentical` are comparisons of MACHINE-GLOBAL
     state across the run's window: they are true on a quiet machine and false
     when a colleague is working, and asserting on them is how this harness's
     own gate went red four times in a row on runs that had done everything
     right. The assertions belong on ownWorktreesGone / foreignWorktreesPreserved
     / repoWrites, which describe only what THIS run did. */
  report.mainTree = {
    statusShaBefore: sha(statusBefore), statusShaAfter: sha(statusAfter),
    statusLines: lines(statusBefore).length,
    unchanged: statusBefore === statusAfter,                      // evidence, not the assertion
    statusDelta: { appeared: lines(statusAfter).filter(l => !beforeSet.has(l)),
                   vanished: lines(statusBefore).filter(l => !afterSet.has(l)) },
    /* the only hands this harness has: fs writes from this process, and its own
       git verbs (git() refuses anything but a read in the main tree). */
    repoWrites: writeWatch.hits,
    ownWorktreesGone: mine.every(p => !pathsAfter.includes(p)),
    /* ⚠ EVIDENCE, NOT THE ASSERTION (defect 2, and it is bug 8's own failure
       mode one field along). This is a comparison of MACHINE-GLOBAL state
       across the run's window: a colleague's worktree that vanishes because
       THEY finished with it makes it false, and this process cannot tell that
       from having taken it. What it can tell — because dropWorktree() is its
       only hand — is which worktrees IT removed. */
    foreignWorktreesPreserved: pathsBefore.filter(p => !inAbHome(p)).every(p => pathsAfter.includes(p)),
    foreignAbWorktrees: pathsAfter.filter(p => inAbHome(p) && !mine.includes(p)).length,
    worktreeListIdentical: listBefore.trim() === report.listAfter.trim(),   // evidence, not the assertion
  };
  /* …and the per-process form of the same claim. Every worktree this run
     removed is either one of its OWN (created above) or one the reaper reported
     by name with a dead owner — reaping a colleague's dead-owner worktree is
     the reaper working, not a failure, and the report says whose. Anything else
     in this list would be this process taking a live worktree, which is the one
     outcome the reaper exists to prevent. */
  const dropped = WORKTREES_DROPPED.slice(dropMark);
  const reapedDirs = new Set(reaped.map(r => normWt(r.dir)));
  report.mainTree.worktreesDropped = dropped;
  report.mainTree.foreignWorktreesDropped =
    dropped.filter(p => !mine.includes(p) && !reapedDirs.has(p));
  report.mainTree.reapedForeign = reaped.filter(r => !mine.includes(normWt(r.dir)))
    .map(r => path.basename(r.dir) + ':' + r.why);
  report.mainTree.reapSkipped = (reaped.skipped || []).map(r => path.basename(r.dir) + ':' + r.why);
  report.mainTree.worktreeListRestored =
    report.mainTree.ownWorktreesGone && report.mainTree.foreignWorktreesDropped.length === 0;
  report.mainTree.selfClean = report.mainTree.repoWrites.length === 0;
  report.identical = report.base.stdout.equals(report.head.stdout);
  report.exitOk = report.base.code === 0 && report.head.code === 0;
  report.asymmetricReadDetail = [].concat(report.base.touchedDetail || [], report.head.touchedDetail || []);
  report.asymmetricRead = Array.from(new Set(report.asymmetricReadDetail.map(d => d.path)));
  report.escapedReadDetail = [].concat(report.base.escapedDetail || [], report.head.escapedDetail || []);
  report.escapedRead = Array.from(new Set(report.escapedReadDetail.map(d => d.path)));
  if (strict && report.asymmetricRead.length) {
    const say = (d) => d.how === 'list'
      ? d.path + ' (LISTED — its one-sided children include ' + d.cause.split(' ').slice(0, 3).join(', ') + ')'
      : d.path;
    const seen = new Set(); const shown = [];
    for (const d of report.asymmetricReadDetail) { const s = say(d); if (!seen.has(s)) { seen.add(s); shown.push(s); } }
    const e = new Error('abRun: REFUSING TO REPORT THIS A/B — the driver read '
      + report.asymmetricRead.length + ' path(s) that exist on only ONE side, or listed a directory'
      + ' whose children do: ' + shown.slice(0, 8).join(', ')
      + (shown.length > 8 ? ' …' : '')
      + '. base=' + REPO + ' head=' + wt + ' (cone: ' + (sparse === null ? 'full' : sparse.length + ' dirs') + ').'
      + ' Any difference this metric reports would be the CHECKOUT, not the change'
      + ' — public/assets alone is 4 GB and cannot be checked out at all.'
      + ' Fix the metric, widen opts.sparse, or — for public/assets specifically —'
      + ' serve BOTH sides the same bytes with bootPage({ assetsFrom: REPO }) and'
      + ' pass allowOneSided:[\'public/assets\'], which keeps the allowance in the report.'
      + ' strictPaths:false turns the guard off entirely and is the answer of last resort.');
    e.name = 'AbAsymmetricPathError';
    e.paths = report.asymmetricRead;
    e.report = report;
    throw e;
  }
  /* ⚠ AND THE OTHER DIRECTION (bug 14). A driver that reads an ABSOLUTE path
     into the main repo A/Bs NOTHING: both sides open the same file, stdout
     matches, and the report says identical=true — a confident wrong SAME where
     the guard above catches the confident wrong DIFFERENT. Measured with
     statSync('<repo>/public/index.html'): identical=true, no refusal, while
     this harness's own live A/B on that file reads 15,686,526 vs 15,629,135
     bytes. Refused by its own name so the message can name the fix (read the
     tree under test through process.cwd()) instead of the other one. */
  if (strict && report.escapedRead.length) {
    const e = new Error('abRun: REFUSING TO REPORT THIS A/B — the driver read '
      + report.escapedRead.length + ' path(s) out of the MAIN working tree (' + REPO + ')'
      + ' instead of the tree under test: ' + report.escapedRead.slice(0, 8).join(', ')
      + (report.escapedRead.length > 8 ? ' …' : '')
      + '. base=' + baseCwd + ' head=' + wt + '.'
      + ' BOTH sides read the same main-tree bytes for those, so whatever they measure is'
      + ' the SAME on both sides no matter what the change did — identical=' + report.identical
      + ' here is not evidence of anything. Read the tree under test through process.cwd()'
      + ' (bootPage does). Deliberate main-tree reads are declared: node_modules, the harness'
      + ' and the driver itself are already exempt, public/assets goes through'
      + ' allowOneSided:[\'public/assets\'] with bootPage({ assetsFrom: REPO }).'
      + ' strictPaths:false turns the guard off entirely and is the answer of last resort.');
    e.name = 'AbEscapedTreeError';
    e.paths = report.escapedRead;
    e.report = report;
    throw e;
  }
  return report;
}

/* ═══ SELF-CHECK ═══════════════════════════════════════════════════════════
   node .gauntlet/_forge-harness.mjs [--no-ab]
   Every number below is counted out of a real page or a real worktree; none is
   asserted from the source text. Each clause below FAILS on the behaviour this
   file shipped with, and each is a mutant a critic built by hand, kept here so
   it runs on every check instead of once in a review:
     (0)   a tree-moving git verb is refused in the main tree   (bug 8)
     (2b)  a REAL opaque overlay this app puts up over the
           editor (#narr-overlay) is refused, though every DOM
           count under it is clean                              (bug 17)
     (8c)  a clean editor is really the top element at every
           point sampled over it, and its PNG clears the floor  (bug 17)
     (8d)  …and body{opacity:0} is refused — by the opacity
           predicate AND by the byte floor, independently       (bug 17)
     (8e)  …and an opaque full-viewport overlay, which no
           element-level predicate can see at all               (bug 17)
     (8f)  …and a .card-editor clone in an open shadow root
           when it COVERS the editor — and NOT when it does
           not, because it moves no number this file reports    (bug 17)
     (8g)  the no-open mutant, through the same switch as the
           other four, so the command and the clause agree      (bug 2)
     (11f) the \\?\ namespaced spelling, under both guards      (bug 19)
     (4)   two renders in one page report the same open-count   (bug 6)
     (6)   the visibility check dies with forceOpen's open line (bug 2)
     (7)   a second editor in the document is refused by name   (bug 1)
     (7b)  …and a host holding one SECTION of it (0 .card-editor,
           200 .editor-field) is refused too                    (bug 10)
     (7c)  …and a duplicate no host holds is refused WITHOUT
           blaming forceOpen                                    (bug 11)
     (7d)  …and a DUPLICATE ID that passes every count above
           while getElementById returns the wrong element       (bug 15)
     (7e)  …and section-shaped litter carrying no fields at all
           (.fx-sec 5 → 8, .fx-sub 13 → 17)                     (bug 16)
     (8b)  forceOpen's display:none branch, on a hidden section
           that really holds fields                             (bug 12)
     (10)  the worktree/main-tree claims are per-RUN            (bug 8)
     (11)  a one-sided read is refused, not reported            (bug 3)
     (11c) …and so are the four one-line drivers that used to
           walk past that guard                                 (bug 9)
     (11d) …and fs.realpathSync.native, which the guard used to
           re-export UNWRAPPED off its own wrapper — checked as
           a property of the whole surface, not by name         (bug 13)
     (11e) …and the opposite failure: a driver reading the MAIN
           tree A/Bs nothing and used to report identical=true  (bug 14)
     (12)  two A/B runs overlap and neither refuses             (bug 4)
     (12b) a killed run's worktree is reaped and a LIVE owner's
           — a real second process's — is not, with every
           conjunct about a worktree the clause created itself  (bug 4/8/18)
   (2), (3b) and (6b) pin bugs 7, 5 and the retired predicate.

   ⚠ NOTHING HERE ASSERTS ON MACHINE-GLOBAL STATE. `git worktree list` as a
     string or a line count, and `git status --porcelain` compared across the
     run's window, are printed as EVIDENCE and never as a predicate: other
     agents A/B and save files on this machine (this harness's own bug-4 fix
     invites them to), and four full runs across two critics went red on
     exactly that. What the run did itself — its own worktrees, its own fs
     writes, its own git verbs — is what is asserted. */
const FIELD_SEL = '#fx-onplay .editor-field';

/* the numbers every page clause reads, at the document scope a later piece
   measures at */
const PAGE_SNAP = (s) => {
  const e = [...document.querySelectorAll(s)];
  /* 🎚 The same visibility count with the EFFECT GATE momentarily lifted.
     The editor hides the fields the chosen on-play effect cannot use (search
     _fxApplyEffectGate in index.html); that is deliberate authoring UI, it is
     not a <details> being shut, and it is not forceOpen's business. Counting it
     as "not visible" took this file's own floor clause from 71 of 86 to 21 and
     failed forceOpen for doing its job — so the clauses that judge forceOpen
     read THIS number and every other clause is untouched. The gate is lifted,
     read, and put straight back by the page's own idempotent pass; on a tree
     that has no gate (the A/B worktree at HEAD) this is exactly `shown`. */
  let shownUngated = null, strayFxOff = null;
  try {
    /* ⚠ ONLY THE GATE'S OWN HIDING IS LIFTED. Lifting every .fx-off would make
       these clauses blind to a future regression that hides editor fields with
       that class for some other reason — the instrument would excuse the very
       thing it exists to catch. So: clear the class, let the gate's own
       idempotent pass re-claim what belongs to it, and put back anything it
       does NOT claim (a stray stays hidden and therefore still counts against
       the floor). strayFxOff reports how many there were. */
    const before = [...document.querySelectorAll('.fx-off')];
    before.forEach(x => x.classList.remove('fx-off'));
    if (typeof _fxApplyEffectGate === 'function') _fxApplyEffectGate();
    const owned = [...document.querySelectorAll('.fx-off')];
    const ownedSet = new Set(owned);
    const strays = before.filter(x => !ownedSet.has(x));
    strays.forEach(x => x.classList.add('fx-off'));
    strayFxOff = strays.length;
    owned.forEach(x => x.classList.remove('fx-off'));
    shownUngated = e.filter(x => x.checkVisibility()).length;
    owned.forEach(x => x.classList.add('fx-off'));
  } catch (err) { shownUngated = null; strayFxOff = null; }
  return { shownUngated, strayFxOff,
           editors: document.querySelectorAll('.card-editor').length,
           fields: document.querySelectorAll('.editor-field').length,
           open: document.querySelectorAll('.fx-sec[open], .fx-sub[open]').length,
           matched: e.length,
           offsetParent: e.filter(x => x.offsetParent !== null).length,
           shown: e.filter(x => x.checkVisibility()).length,
           hosts: document.querySelectorAll('[data-forge-harness-host]').length,
           outside: document.querySelectorAll('.editor-field').length
                    - [...document.querySelectorAll('.card-editor')]
                        .reduce((n, c) => n + c.querySelectorAll('.editor-field').length, 0),
           hiddenSecs: [...document.querySelectorAll('.fx-sec, .fx-sub')]
                        .filter(x => x.style.display === 'none')
                        .map(x => (x.id || '?') + ':' + x.querySelectorAll('.editor-field').length),
           fxOpen: JSON.stringify((typeof App === 'object' && App._fxOpen) || null) };
};
/* how many keys forceOpen's toggles actually put in App._fxOpen. The old
   clause (4) asserted `fxOpen !== 'null'`, which the '{}' openCardEditor writes
   one line earlier already satisfies — it printed "forceOpen really did write
   App._fxOpen" during a run in which the mutant wrote nothing at all. */
const fxKeys = (s) => { try { return Object.keys(JSON.parse(s) || {}).length; } catch (e) { return -1; } };

/* the first real file under a directory, for the assets clause — hard-coding
   one would rot the first time somebody tidies public/assets */
function firstFileUnder(dir, depth) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of ents) if (e.isFile()) return path.join(dir, e.name);
  if (depth <= 0) return null;
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const f = firstFileUnder(path.join(dir, e.name), depth - 1);
    if (f) return f;
  }
  return null;
}

/* ═══ THE NAMED MUTANTS ════════════════════════════════════════════════════
   Every one of these is a bypass a critic actually ran against this file and
   watched succeed. Each is runnable on its own —

       node .gauntlet/_forge-harness.mjs --mutant=overlay

   — and each is ALSO a clause of the self-check, so `npm run check` runs them
   without anybody remembering to. A gate nobody runs is a comment.

   ⚠ THE EXIT CODES ARE THE OPPOSITE OF A TEST'S, AND THAT IS THE POINT: a
     mutant run exits 1 when the harness CAUGHT it (the mutant went red, which
     is the outcome being demonstrated) and 3 when the mutant SURVIVED, which
     means the guard it was built against is gone. 0 is never returned, so a
     wrapper that only knows "non-zero" still reads the demonstration correctly,
     and a reader who wants the difference has two codes and two messages.
     page mutants (a browser, ~10 s each):
       opacity-zero   body{opacity:0} in front of the visibility read
       overlay        an opaque full-viewport fixed overlay over the editor
       shadow-clone   a .card-editor clone inside an OPEN shadow root
       no-open        forceOpen with its only <details>-opening line deleted
     A/B mutants (git worktrees, ~30 s each):
       namespaced-asym    path.toNamespacedPath() under the asymmetric guard
       namespaced-escape  the \\?\ spelling of a main-tree read */
export const MUTANT_NAMES = ['opacity-zero', 'overlay', 'shadow-clone', 'no-open',
                             'namespaced-asym', 'namespaced-escape'];
const PAGE_MUTANTS = new Set(['opacity-zero', 'overlay', 'shadow-clone', 'no-open']);

/* the clip of the editor as it stands right now, for a byte-size comparison
   that is against the SAME rectangle on both sides of the mutation */
async function editorClipShot(page) {
  const p = await page.evaluate(paintProbe, {});
  if (!p.clip || p.clip[2] <= 0 || p.clip[3] <= 0) return { probe: p, bytes: -1, floor: -1 };
  const buf = await page.screenshot({ clip: { x: p.clip[0], y: p.clip[1], width: p.clip[2], height: p.clip[3] } });
  const area = p.clip[2] * p.clip[3];
  return { probe: p, bytes: buf.length, area, floor: Math.max(2000, Math.round(area * PAINT_BYTES_PER_PX)),
           perPx: +(buf.length / area).toFixed(4) };
}

/* runMutant(name, ctx) → { name, caught, by, detail, numbers }
   ctx.page — a page already booted by the caller (the self-check reuses one;
   the CLI boots its own). Every mutant puts the page back the way it found it,
   because the clauses after it keep measuring on it. */
export async function runMutant(name, ctx = {}) {
  const page = ctx.page;
  const out = { name, caught: false, by: null, detail: '', numbers: {} };

  if (name === 'opacity-zero') {
    await openCardEditor(page, 'NEW');
    const clean = await editorClipShot(page);
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.id = 'forge-mutant-opacity'; s.textContent = 'body{opacity:0}';
      document.head.appendChild(s);
    });
    const rep = await page.evaluate(forceOpen, FIELD_SEL);
    const dark = await editorClipShot(page);
    let err = null;
    try { await openCardEditor(page, 'NEW'); } catch (e) { err = e; }
    await page.evaluate(() => { const s = document.getElementById('forge-mutant-opacity'); if (s) s.remove(); });
    out.numbers = { cleanBytes: clean.bytes, cleanPerPx: clean.perPx, mutantBytes: dark.bytes,
                    mutantPerPx: dark.perPx, floor: clean.floor, clip: clean.probe.clip,
                    forceOpenShown: rep.shown, forceOpenLoose: rep.shownLoose, matched: rep.matched,
                    opacityVisible: dark.probe.opacityVisible, cvPlain: dark.probe.cvPlain };
    /* TWO independent proofs, because the gate has two halves and only the
       first of them fires first: the paint gate refused, AND the screenshot of
       the very same rectangle is under the byte floor. */
    const byFloor = dark.bytes >= 0 && dark.bytes < clean.floor;
    out.caught = !!err && err.name === 'ForgePaintError' && byFloor;
    out.by = err ? err.name : null;
    out.detail = 'openCardEditor threw=' + (!!err) + ' as ' + (err && err.name)
      + '; the same rectangle is ' + dark.bytes + ' B (' + dark.perPx + ' B/px) against '
      + clean.bytes + ' B (' + clean.perPx + ' B/px) clean and a floor of ' + clean.floor + ' B'
      + '; forceOpen still reported shownLoose=' + rep.shownLoose + ' of ' + rep.matched
      + ' with bare checkVisibility() — the number the critic got past this file —'
      + ' against shown=' + rep.shown + ' with the opacity option on'
      + (err ? '. ' + err.message.replace(/\s+/g, ' ').slice(0, 180) : '');
    return out;
  }

  if (name === 'overlay') {
    await openCardEditor(page, 'NEW');
    const clean = await editorClipShot(page);
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'forge-mutant-overlay';
      /* ⚠ inset:0, NOT width:100vw/height:100vh — the same spelling the app's
         own #narr-overlay uses. MEASURED: this page is zoomed (~0.937), so a
         100vw × 100vh box lays out at 1406 × 1312 against a 1500 × 1400
         viewport and leaves a 94 px strip uncovered — one of the three sampled
         fields sat in it and reported painted, out of an overlay that was
         supposed to cover everything. A mutant that only nearly covers the
         screen is a weaker mutant than the bug it stands for. */
      d.style.cssText = 'position:fixed;inset:0;background:#101014;z-index:2147483647;';
      document.body.appendChild(d);
    });
    const rep = await page.evaluate(forceOpen, FIELD_SEL);
    const covered = await editorClipShot(page);
    let err = null;
    try { await openCardEditor(page, 'NEW'); } catch (e) { err = e; }
    await page.evaluate(() => { const d = document.getElementById('forge-mutant-overlay'); if (d) d.remove(); });
    out.numbers = { cleanGridOnTop: clean.probe.gridOnTop, grid: clean.probe.grid,
                    mutantGridOnTop: covered.probe.gridOnTop, blockers: covered.probe.blockers,
                    cleanBytes: clean.bytes, mutantBytes: covered.bytes, floor: clean.floor,
                    forceOpenShown: rep.shown, forceOpenLoose: rep.shownLoose, matched: rep.matched,
                    forceOpenPainted: rep.painted, forceOpenPaintSampled: rep.paintSampled };
    out.caught = !!err && err.name === 'ForgePaintError'
      && /points spread over it hit the editor/.test(err.message);
    out.by = err ? err.name : null;
    out.detail = 'openCardEditor threw=' + (!!err) + ' as ' + (err && err.name)
      + '; elementFromPoint ' + covered.probe.gridOnTop + ' of ' + covered.probe.grid
      + ' (clean ' + clean.probe.gridOnTop + '/' + clean.probe.grid + '), blockers '
      + JSON.stringify(covered.probe.blockers)
      + '; forceOpen still reported shown=' + rep.shown + ' of ' + rep.matched
      + ' visible with painted=' + rep.painted + ' of ' + rep.paintSampled + ' sampled'
      + '; the PNG is ' + covered.bytes + ' B against the ' + clean.floor + ' B floor ('
      + (covered.bytes < clean.floor ? 'under it, because a FLAT cover compresses to nothing —'
           + ' but a textured one does not: this app\'s own #narr-overlay photographs at 1,267,415 B,'
           + ' which is why the byte floor is not what is asked to catch an occlusion'
         : 'over it — the byte floor cannot catch an occlusion, which is elementFromPoint\'s job') + ')'
      + (err ? '. ' + err.message.replace(/\s+/g, ' ').slice(0, 180) : '');
    return out;
  }

  if (name === 'shadow-clone') {
    /* ⚠ THE DECISION, WRITTEN DOWN EITHER WAY (asked for by name). A
       .card-editor clone inside an OPEN shadow root leaves every
       document-scoped count of this harness UNTOUCHED — measured on this tree:
       .card-editor=1, .editor-field=289, .fx-sec/.fx-sub=18, with 289 more
       fields sitting inside the shadow tree — because document.querySelectorAll
       does not cross a shadow boundary in either direction. So it is NOT the
       bug class bugs 1/10/16 are about (an inflated count), and refusing it
       would be blaming a page for a DOM that gives this file's numbers no
       trouble at all — the same unearned blame as bugs 7 and 11.
       It becomes this file's problem in exactly one way: when the clone is
       PAINTED OVER the real editor, the screenshot is of the clone while the
       counts describe the original. That is an occlusion, and the paint gate
       already refuses it without knowing anything about shadow DOM —
       document.elementFromPoint retargets to the HOST, which is not inside
       .card-editor. Both halves are asserted: covering is refused, off-screen
       is not. */
    await openCardEditor(page, 'NEW');
    /* the baseline is READ, never written down: the editor measures 289-290
       .editor-field depending on what the app has finished loading, and a
       clause that hard-codes one of them is a clause that goes red for a reason
       that has nothing to do with shadow DOM. */
    const base = await page.evaluate(() => ({
      editors: document.querySelectorAll('.card-editor').length,
      fields: document.querySelectorAll('.editor-field').length,
      sections: document.querySelectorAll('.fx-sec, .fx-sub').length }));
    const cover = await page.evaluate(() => {
      const src = document.querySelector('.card-editor');
      const host = document.createElement('div');
      host.id = 'forge-mutant-shadow';
      /* inset:0 for the same measured reason as the overlay mutant above */
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#111;overflow:hidden';
      host.attachShadow({ mode: 'open' }).innerHTML = src.outerHTML;
      document.body.appendChild(host);
      return { editors: document.querySelectorAll('.card-editor').length,
               fields: document.querySelectorAll('.editor-field').length,
               sections: document.querySelectorAll('.fx-sec, .fx-sub').length,
               inShadow: host.shadowRoot.querySelectorAll('.editor-field').length };
    });
    let coverErr = null;
    try { await openCardEditor(page, 'NEW'); } catch (e) { coverErr = e; }
    const coverProbe = await page.evaluate(paintProbe, {});
    await page.evaluate(() => { const h = document.getElementById('forge-mutant-shadow'); if (h) h.remove(); });
    const aside = await page.evaluate(() => {
      const src = document.querySelector('.card-editor');
      const host = document.createElement('div');
      host.id = 'forge-mutant-shadow-aside';
      host.style.cssText = 'position:absolute;left:-9999px;top:0;width:100px;height:100px;overflow:hidden';
      host.attachShadow({ mode: 'open' }).innerHTML = src.outerHTML;
      document.body.appendChild(host);
      return { editors: document.querySelectorAll('.card-editor').length,
               fields: document.querySelectorAll('.editor-field').length,
               inShadow: host.shadowRoot.querySelectorAll('.editor-field').length };
    });
    let asideErr = null;
    try { await openCardEditor(page, 'NEW'); } catch (e) { asideErr = e; }
    await page.evaluate(() => { const h = document.getElementById('forge-mutant-shadow-aside'); if (h) h.remove(); });
    await openCardEditor(page, 'NEW');
    out.numbers = { base, cover, coverGridOnTop: coverProbe.gridOnTop, grid: coverProbe.grid,
                    blockers: coverProbe.blockers, aside, asideThrew: asideErr ? asideErr.name : null };
    out.caught = !!coverErr && coverErr.name === 'ForgePaintError' && !asideErr
      && cover.editors === base.editors && cover.fields === base.fields
      && cover.sections === base.sections
      && aside.editors === base.editors && aside.fields === base.fields
      && cover.inShadow >= 200 && aside.inShadow >= 200;
    out.by = coverErr ? coverErr.name : null;
    out.detail = 'a clone in an open shadow root leaves the document-scoped counts alone'
      + ' (unchanged from the clean ' + JSON.stringify(base) + ': .card-editor=' + cover.editors
      + ' .editor-field=' + cover.fields
      + ' .fx-sec/.fx-sub=' + cover.sections + ', with ' + cover.inShadow + ' more inside the shadow tree),'
      + ' so it is refused ONLY when it covers the editor: covering threw=' + (!!coverErr)
      + ' as ' + (coverErr && coverErr.name) + ' with elementFromPoint ' + coverProbe.gridOnTop
      + ' of ' + coverProbe.grid + ' and blockers ' + JSON.stringify(coverProbe.blockers)
      + '; the same clone parked off-screen threw=' + (!!asideErr) + ' (it must not)';
    return out;
  }

  if (name === 'no-open') {
    const mutSrc = forceOpenMutant();
    await openCardEditor(page, 'NEW');                    // fresh, sections shut
    const before = await page.evaluate(PAGE_SNAP, FIELD_SEL);
    const rep = await page.evaluate(new Function('s', 'return (' + mutSrc + ')(s)'), FIELD_SEL);
    const after = await page.evaluate(PAGE_SNAP, FIELD_SEL);
    const survives = before.shown === 0 && after.shown > 0 && rep.opened >= 2;
    out.numbers = { shownBefore: before.shown, shownAfter: after.shown,
                    offsetParentBefore: before.offsetParent, offsetParentAfter: after.offsetParent,
                    detailsOpenBefore: before.open, detailsOpenAfter: after.open, repOpened: rep.opened };
    out.caught = !survives;
    out.by = 'clause (5) — checkVisibility before/after forceOpen';
    out.detail = 'forceOpen with "' + FORCE_OPEN_MUTATION + '" deleted: checkVisibility '
      + before.shown + ' → ' + after.shown + ' (the real one reads 0 → 71), offsetParent '
      + before.offsetParent + ' → ' + after.offsetParent + ' (the predicate this replaced, which the'
      + ' mutant passes), <details open> ' + before.open + ' → ' + after.open;
    return out;
  }

  /* ── the two A/B mutants: one idiomatic Windows spelling, both guards ──── */
  if (name === 'namespaced-asym' || name === 'namespaced-escape') {
    const f = path.join(os.tmpdir(), 'forge-mutant-' + name + '-' + process.pid + '.mjs');
    const abs = path.join(REPO, 'public', 'index.html');
    const body = name === 'namespaced-asym'
      ? [
          "import fs from 'node:fs'; import path from 'node:path';",
          "const p = path.toNamespacedPath(path.resolve(process.cwd(), 'public/assets'));",
          "console.log('spelling=' + p);",
          "console.log('bytes=' + fs.statSync(path.resolve(process.cwd(), 'public/index.html')).size);",
          "console.log('has-assets=' + fs.existsSync(p));",
        ]
      : [
          "import fs from 'node:fs'; import path from 'node:path';",
          /* the hand-typed \\?\ spelling, not toNamespacedPath(), so the guard
             is proved against the string a person writes as well as the one
             node hands out */
          "const abs = " + JSON.stringify('\\\\?\\' + abs) + ";",
          "console.log('cwd-bytes=' + fs.statSync(path.resolve(process.cwd(), 'public/index.html')).size);",
          "console.log('abs-bytes=' + fs.statSync(abs).size);",
        ];
    fs.writeFileSync(f, body.join('\n') + '\n');
    let err = null, rep = null;
    try { rep = await abRun(f, { sparse: ['public/src'] }); } catch (e) { err = e; }
    try { fs.unlinkSync(f); } catch (e) {}
    const want = name === 'namespaced-asym' ? 'AbAsymmetricPathError' : 'AbEscapedTreeError';
    const wantPath = name === 'namespaced-asym' ? 'public/assets' : 'public/index.html';
    out.caught = !!err && err.name === want && (err.paths || []).includes(wantPath);
    out.by = err ? err.name : null;
    const r = (err && err.report) || rep;
    const say = (t) => String(t || '').trim().replace(/\n/g, ' | ').slice(0, 160);
    out.numbers = { refusedAs: err && err.name, paths: (err && err.paths) || [],
                    identical: r ? r.identical : null,
                    base: r ? say(r.base.stdoutText) : null, head: r ? say(r.head.stdoutText) : null };
    out.detail = 'abRun threw=' + (!!err) + ' as ' + (err && err.name)
      + ' ' + JSON.stringify((err && err.paths) || [])
      + '; the two sides read base=' + JSON.stringify(out.numbers.base)
      + ' head=' + JSON.stringify(out.numbers.head) + ' identical=' + out.numbers.identical
      + ' — unguarded that is a silent false ' + (name === 'namespaced-asym' ? 'DIFFERENCE' : 'SAMENESS');
    return out;
  }

  throw new Error('runMutant: no mutant named ' + JSON.stringify(name)
    + ' — the five (plus shadow-clone) are ' + MUTANT_NAMES.join(', '));
}

async function _runOneMutant(name) {
  if (name === 'list' || !name) {
    console.log('mutants: ' + MUTANT_NAMES.join(', ')
      + '\n  node .gauntlet/_forge-harness.mjs --mutant=<name>'
      + '\n  exit 1 = the harness CAUGHT it (what should happen), exit 3 = it SURVIVED');
    process.exit(name === 'list' ? 0 : 2);
  }
  if (MUTANT_NAMES.indexOf(name) < 0) {
    console.error('MUTANT ' + name + ': UNKNOWN — the mutants are ' + MUTANT_NAMES.join(', '));
    process.exit(2);
  }
  let res = null, boot = null;
  try {
    if (PAGE_MUTANTS.has(name)) boot = await bootPage({});
    res = await runMutant(name, { page: boot && boot.page });
  } finally { if (boot) await boot.close(); }
  if (res.caught) {
    console.log('MUTANT ' + name + ': CAUGHT by ' + res.by + ' — ' + res.detail);
    console.log('numbers: ' + JSON.stringify(res.numbers));
    console.log('exit 1 — the mutant went RED, which is what this command is for.');
    process.exit(1);
  }
  console.log('MUTANT ' + name + ': SURVIVED — the harness did NOT catch it. ' + res.detail);
  console.log('numbers: ' + JSON.stringify(res.numbers));
  process.exit(3);
}

async function _selfCheck() {
  let fails = 0;
  const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

  console.log('FORGE HARNESS SELF-CHECK   repo=' + REPO);
  console.log('ADMIN_EMAILS in public/index.html: ' + adminEmailsFromSource().join(', ')
    + '   admin gate at ' + gateWhere());
  ok(seedNonAdmin({}).cloud.email === NON_ADMIN_EMAIL,
     'seedNonAdmin literal matches the exported NON_ADMIN_EMAIL', seedNonAdmin({}).cloud.email);
  ok(!fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').toLowerCase().includes('st' + 'ash'),
     'the harness contains no working-tree-moving command');
  ok(forgeGateLine() !== null, 'the admin gate is still findable in public/index.html');

  /* (0) THE GREP ABOVE IS NOT ENOUGH, and that is the point of this clause. It
     looks for ONE banned verb; it does not stop `reset`, `restore`, `clean` or
     `checkout --`, any of which would destroy another agent's uncommitted work
     in a tree they are actively editing. git() now refuses every main-tree verb
     but a read, in this process, before git is spawned. Proved by trying two —
     the banned one and an allowed one — rather than by reading the allow-list. */
  let banned = null, allowedOk = null, nsBanned = null;
  try { git(['reset', '--hard'], { check: false }); } catch (e) { banned = e; }
  try { allowedOk = git(['status', '--porcelain'], { tries: 3 }).code === 0; } catch (e) { allowedOk = false; }
  /* ⚠ AND IN THE \\?\ SPELLING OF THE SAME DIRECTORY (bug 19). This guard
     compared path.resolve(cwd) to REPO as strings, and path.resolve() leaves an
     extended-length prefix in place, so `cwd: path.toNamespacedPath(REPO)` was
     "not the main tree" and the refusal never fired.
     ⚠ PROVED WITH `git version`, NOT `git reset --hard`. Every verb outside
       GIT_MAIN_TREE_VERBS is refused by the same line, and `version` is refused
       the same way while doing NOTHING if the guard is ever broken — a
       self-check clause that destroys another agent's uncommitted work on the
       day it fails is not a check, it is the accident it was written to
       prevent. */
  try { git(['version'], { cwd: path.toNamespacedPath(REPO), check: false }); } catch (e) { nsBanned = e; }
  console.log('(0) git guard: `git reset --hard` in ' + REPO + ' → threw=' + (!!banned)
    + '   `git status --porcelain` → ok=' + allowedOk
    + '   `git version` with cwd=' + path.toNamespacedPath(REPO) + ' → threw=' + (!!nsBanned)
    + '   verbs allowed in the main tree: ' + [...GIT_MAIN_TREE_VERBS].join(' '));
  ok(!!banned && /REFUSING to run/.test(banned.message) && allowedOk === true
     && !!nsBanned && /REFUSING to run/.test(nsBanned.message),
     'a tree-moving git verb is REFUSED in the main working tree — in the ordinary spelling AND in'
     + ' the \\\\?\\ namespaced one, which used to walk past the string compare — and a read still works',
     'banned=' + (banned ? banned.message.slice(0, 90) : 'DID NOT THROW') + ' read=' + allowedOk
     + ' namespaced=' + (nsBanned ? 'refused' : 'DID NOT THROW'));

  /* (0b) the OTHER hand: report.mainTree.repoWrites, which is what clause (10)
     asserts on instead of a git status diff across the run's window. Armed
     here against a write that CANNOT succeed — the directory does not exist, so
     writeFileSync throws ENOENT — because note() runs before the real call and
     a self-check that proved this by actually creating a file in a live repo
     would be adding the very git-status noise the rest of this fix is about.
     The read of package.json is the other half: the first version of the watch
     recorded readFileSync's internal openSync('r') as a write, which would have
     put a false entry in repoWrites for anything that read the tree at all. */
  const probe = installRepoWriteWatch();
  let wErr = null;
  try { fs.writeFileSync(path.join(REPO, '.gauntlet', '__no_such_dir__', 'x'), 'x'); } catch (e) { wErr = e.code; }
  try { fs.readFileSync(path.join(REPO, 'package.json')); } catch (e) {}      // a READ must not register
  try { fs.writeFileSync(path.join(os.tmpdir(), 'forge-outside-probe.txt'), 'x'); } catch (e) {}
  probe.restore();
  try { fs.unlinkSync(path.join(os.tmpdir(), 'forge-outside-probe.txt')); } catch (e) {}
  console.log('(0b) fs write watch: attempted 1 write under the repo (' + wErr + ', nothing created),'
    + ' 1 read of package.json, 1 write in ' + os.tmpdir() + '  → recorded '
    + probe.hits.length + ' ' + JSON.stringify(probe.hits));
  ok(probe.hits.length === 1 && /__no_such_dir__/.test(probe.hits[0]) && wErr === 'ENOENT',
     'the fs write watch behind mainTree.repoWrites sees a write AIMED at the repo, and only that —'
     + ' reads and writes elsewhere do not register',
     JSON.stringify(probe.hits) + ' wErr=' + wErr);

  const boot = await bootPage({});
  try {
    /* ── 1 · the gate bites ── */
    let threw = null, returned = null;
    try { returned = await openCardEditor(boot.page, 'NEW', { email: NON_ADMIN_EMAIL, allowNonAdmin: true }); }
    catch (e) { threw = e; }
    const gateNamed = !!(threw && /ADMIN GATE/.test(threw.message)
      && threw.message.includes('public/index.html:' + forgeGateLine()));
    console.log('(1) non-admin openCardEditor  threw=' + (!!threw) + '  returnedPage=' + (returned !== null)
      + '  namesTheGate=' + gateNamed);
    if (threw) console.log('    ' + threw.message.replace(/\s+/g, ' ').slice(0, 230));
    ok(!!threw && returned === null && gateNamed,
       'openCardEditor THROWS for a non-admin and names the admin gate at its CURRENT line');

    /* ── 2 · a typo'd address is refused BEFORE the browser (bug 7) ── */
    let typo = null;
    try { await openCardEditor(boot.page, 'NEW', { email: 'play@mythicsoa.co' }); }
    catch (e) { typo = e; }
    console.log('(2) typo\'d admin email        threw=' + (!!typo) + '  '
      + (typo ? typo.message.replace(/\s+/g, ' ').slice(0, 150) : ''));
    ok(!!typo && /assertAdminEmail/.test(typo.message) && /ADMIN_EMAILS/.test(typo.message),
       'a typo\'d address fails the pre-flight ADMIN_EMAILS check the doc promises');

    /* ── 2b · THE OVERLAY THE PAINT GATE FOUND ON ITS FIRST RUN ────────────
       Not a mutant — a real one, in this app, found by defect 1's fix the first
       time it ran. Bouncing off the admin gate renders the TITLE screen, and
       the title screen opens the narrative reel: `#narr-overlay`, position
       fixed, inset 0, z-index 2147483400, background #070a16, holding a
       full-viewport <iframe src="narrative/index.html"> (index.html:203475).
       Every count in openCardEditor stays green under it — editors=1,
       .editor-field=289, 0 stray — and the screenshot is 1,267,415 bytes of
       the NARRATIVE REEL. That is a Forge screenshot piece photographing the
       wrong screen and reporting a pass, which is the sentence this whole file
       opens with. So it is asserted here rather than quietly worked around, and
       only then dismissed.
       ⚠ AND IT IS TRIGGERED HERE RATHER THAN WAITED FOR. The reel is mounted
         off a timer, so on the first run it landed on top of clause (3) and on
         the next it had not appeared yet — a clause that waits for it is a
         coin toss, and worse, a reel that arrives in the middle of ANY later
         clause reddens that one instead. So this calls the app's own
         _playNarrativeScript (index.html:203472) to mount the real thing, keeps
         the original, asserts the refusal, dismisses it, and leaves a no-op in
         its place for the rest of the run. */
    const spontaneous = await boot.page.evaluate(() => {
      const o = document.getElementById('narr-overlay');
      const was = !!o;
      if (o) o.remove();
      if (typeof _playNarrativeScript !== 'function') return { was, fn: false };
      window.__harnessNarr = _playNarrativeScript;          // the real one, kept
      window._playNarrativeScript = function () {};         // …and neutralised for the rest
      return { was, fn: true };
    });
    /* …and only THEN a clean editor, so the reel mounted below is the one and
       only thing the gate can complain about: any reel the gate clause left up
       is gone, and the app's own 0.22 s page fade is over. */
    await openCardEditor(boot.page, 'NEW');
    const narrUp = await boot.page.evaluate(() => {
      if (typeof window.__harnessNarr !== 'function') return null;
      /* a script with a real node in it: [{type:'end'}] alone plays out and the
         reel dismisses ITSELF within a few frames, which is a race, not a
         fixture. */
      window.__harnessNarr([{ type: 'title', kicker: 'harness', title: 'paint gate fixture' },
                            { type: 'end' }], {});
      const o = document.getElementById('narr-overlay');
      if (!o) return null;
      const cs = getComputedStyle(o), r = o.getBoundingClientRect();
      return { z: cs.zIndex, bg: cs.backgroundColor, pos: cs.position,
               rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
               iframes: o.querySelectorAll('iframe').length };
    });
    /* the ordinary settle budget, on purpose — this is the whole assertion
       path, not a probe. MEASURED with the fixture script above: the reel holds
       the screen for ~4,000 ms before it auto-advances and fades (opacity 0 →
       1 over 450 ms, then 1 until t≈4 s), against openCardEditor's ~300 ms of
       DOM work plus a 900 ms paint budget. The complaint moves from the fade
       (the first ~220 ms, opacity) to the reel (the grid) inside that window,
       which is exactly why the budget re-asks instead of judging once. */
    let narrErr = null;
    try { await openCardEditor(boot.page, 'NEW'); } catch (e) { narrErr = e; }
    const narrCounts = await boot.page.evaluate(() => {
      const out = { editors: document.querySelectorAll('.card-editor').length,
                    fields: document.querySelectorAll('.editor-field').length,
                    outside: document.querySelectorAll('.editor-field').length
                             - [...document.querySelectorAll('.card-editor')]
                                 .reduce((n, c) => n + c.querySelectorAll('.editor-field').length, 0) };
      const o = document.getElementById('narr-overlay');
      if (o) o.remove();                       // dismissed HERE, deliberately, and printed
      return out;
    });
    console.log('(2b) the title screen\'s narrative reel (spontaneous during the gate clause='
      + spontaneous.was + ', mounted here deterministically): ' + JSON.stringify(narrUp)
      + '   under it the counts are clean (' + JSON.stringify(narrCounts)
      + ') and openCardEditor threw=' + (!!narrErr) + ' as ' + (narrErr && narrErr.name));
    if (narrErr) console.log('     ' + narrErr.message.replace(/\s+/g, ' ').slice(0, 240));
    ok(!!narrUp && narrCounts.editors === 1 && narrCounts.outside === 0
       && !!narrErr && narrErr.name === 'ForgePaintError' && /narr-overlay/.test(narrErr.message),
       'a REAL opaque overlay this app puts up over the editor (#narr-overlay, z-index '
       + (narrUp && narrUp.z) + ', ' + (narrUp && narrUp.iframes) + ' iframe) is refused by name'
       + ' even though every DOM count under it is clean — found by this gate on its first run,'
       + ' not written for it',
       'overlay=' + JSON.stringify(narrUp) + ' counts=' + JSON.stringify(narrCounts)
       + ' threw=' + (narrErr && narrErr.name));

    /* ── 3 · the admin really reaches ONE editor ── */
    await openCardEditor(boot.page, 'NEW');
    const n3 = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    console.log('(3) admin openCardEditor      screen=forge  .card-editor=' + n3.editors
      + '  .editor-field=' + n3.fields + ' (' + n3.outside + ' outside the editor)  ' + FIELD_SEL + '=' + n3.matched
      + '  open=' + n3.open);
    /* ⚠ THE FLOOR IS 240, NOT 100 (bug 12). This line printed '.editor-field=289'
       and asserted '> 100', so an editor that had lost 188 of its 289 fields —
       65% of the thing being measured — still reported PASS. 240 is ~83% of the
       measured 289 and leaves room for the editor legitimately gaining or
       shedding a row. `outside === 0` is the invariant openCardEditor now
       enforces (bug 10) checked from the outside as well. */
    ok(n3.editors === 1 && n3.fields >= 240 && n3.outside === 0 && n3.matched >= 70,
       'the admin client lands on exactly ONE card editor, ≥240 .editor-field, none of them outside it',
       n3.editors + ' editors / ' + n3.fields + ' fields / ' + n3.outside + ' outside / '
       + n3.matched + ' under ' + FIELD_SEL);

    /* ── 3b · showToast is put back (bug 5) ── */
    const toastState = await boot.page.evaluate(() => ({
      src: String(window.showToast).replace(/\s+/g, ' ').slice(0, 60),
      hooked: /__harnessToasts/.test(String(window.showToast)),
      native: typeof showToast === 'function' && window.showToast === showToast,
    }));
    console.log('(3b) window.showToast after openCardEditor: ' + JSON.stringify(toastState.src)
      + '  stillHooked=' + toastState.hooked);
    ok(!toastState.hooked && toastState.native,
       'openCardEditor RESTORES window.showToast (it used to leave the capture stub forever)');

    /* ── 4 · TWO RENDERS IN ONE PAGE REPORT THE SAME OPEN-COUNT (bug 6) ──
       forceOpen's toggles land in App._fxOpen and survive a re-render; before
       the fix render 1 was open=0 and render 2 came back open=1. */
    const r1 = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    const forced1 = await boot.page.evaluate(forceOpen, FIELD_SEL);
    await boot.page.waitForTimeout(250);          // the toggle event is async
    const afterForce = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    await openCardEditor(boot.page, 'NEW');
    const r2 = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    console.log('(4) render 1 open=' + r1.open + '  → forceOpen (opened=' + forced1.opened
      + ') → App._fxOpen=' + afterForce.fxOpen + ' open=' + afterForce.open
      + '  → render 2 open=' + r2.open + ' App._fxOpen=' + r2.fxOpen);
    ok(r1.open === r2.open && fxKeys(afterForce.fxOpen) >= 1,
       'two consecutive renders in one page report the SAME open-count ('
       + r1.open + ' and ' + r2.open + '), even though forceOpen really did write '
       + fxKeys(afterForce.fxOpen) + ' key(s) into App._fxOpen',
       'open ' + r1.open + ' vs ' + r2.open + ', App._fxOpen keys=' + fxKeys(afterForce.fxOpen));

    /* ── 5 · the CLOSED-details half, with the honest predicate, PLUS the
       mutant that killed the old one (bug 2). */
    const shutBefore = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    const shutRep = await boot.page.evaluate(forceOpen, FIELD_SEL);
    const shutAfter = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    console.log('(5) attached editor, sections SHUT (' + shutBefore.open + ' open):  ' + FIELD_SEL
      + '  matched=' + shutBefore.matched
      + '   checkVisibility() ' + shutBefore.shown + ' → ' + shutAfter.shown
      + '   offsetParent!==null ' + shutBefore.offsetParent + ' → ' + shutAfter.offsetParent
      + '   (details opened=' + shutRep.opened + ')');
    /* ⚠ A FLOOR, NOT `> 0` (bug 12). `shutAfter.shown > 0` passed a forceOpen
       that revealed ONE field of 86. The floor is derived from the SAME run's
       matched count so it cannot rot: 70% of 86 is 61, against a measured 71
       (the other 15 are type-gated controls the editor hides inline, and
       revealing those would report options the author does not have).
       🎚 …read on shownUngated, not shown — see PAGE_SNAP. The effect gate
          hides on purpose; this clause is about the <details>. */
    const shutSeen = (x) => (x.shownUngated == null ? x.shown : x.shownUngated);
    const shownFloor = Math.round(shutBefore.matched * 0.7);
    const realPredicate = shutSeen(shutBefore) === 0 && shutSeen(shutAfter) >= shownFloor && shutRep.opened >= 2;
    ok(realPredicate,
       'forceOpen opens the shut sections: ' + shutSeen(shutBefore) + ' → ' + shutSeen(shutAfter)
       + ' really-visible fields (checkVisibility, effect gate lifted), floor ' + shownFloor + ' = 70% of the '
       + shutBefore.matched + ' matched',
       shutSeen(shutBefore) + ' → ' + shutSeen(shutAfter) + ' vs floor ' + shownFloor
       + ', opened=' + shutRep.opened + ', predicate=' + shutRep.shownPredicate);
    /* the lift above is gate-owned only, so a field hidden with .fx-off by
       anything else is NOT excused — it would depress the count above. This
       prints how many such strays there were, which is 0 while the gate is the
       class's only author. */
    ok(shutAfter.strayFxOff === 0 || shutAfter.strayFxOff == null,
       'every .fx-off on the page belongs to the effect gate (strays not excused by the lift: '
       + shutAfter.strayFxOff + ')',
       'stray .fx-off elements: ' + shutAfter.strayFxOff);
    ok(shutBefore.offsetParent > 0,
       'and offsetParent LIES inside a closed <details> — ' + shutBefore.offsetParent + ' of '
       + shutBefore.matched + ' fields claim to be visible while the section is shut');

    /* ── 6 · SHIP THE MUTANT. forceOpen with its only <details>-opening line
       deleted must make clause (5) FAIL. The old clause used the detached-host
       + offsetParent form and this same mutant sailed through it 0 → 70, which
       is why the predicate changed; both are run here so the difference is on
       the record instead of in a review comment. */
    const mutSrc = forceOpenMutant();
    await openCardEditor(boot.page, 'NEW');                       // fresh, sections shut
    const mBefore = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    const mRep = await boot.page.evaluate(new Function('s', 'return (' + mutSrc + ')(s)'), FIELD_SEL);
    const mAfter = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    /* the mutant is judged by the LENIENT form (`> 0`, not clause (5)'s 70%
       floor) on purpose: "even at > 0 the mutant reveals nothing" is a stronger
       statement than "it missed the floor". */
    const mutantPredicate = shutSeen(mBefore) === 0 && shutSeen(mAfter) > 0 && mRep.opened >= 2;
    console.log('(6) MUTANT (forceOpen with "' + FORCE_OPEN_MUTATION + '" deleted) on the ATTACHED editor:'
      + '  checkVisibility() ' + mBefore.shown + ' → ' + mAfter.shown
      + '   offsetParent!==null ' + mBefore.offsetParent + ' → ' + mAfter.offsetParent
      + '   <details open> ' + mBefore.open + ' → ' + mAfter.open
      + '   (rep.opened=' + mRep.opened + ', which is why the check does not lean on that counter)');
    ok(realPredicate && !mutantPredicate,
       'the visibility check is DISCRIMINATING: the real forceOpen passes it and the mutant FAILS it',
       'real=' + realPredicate + ' mutant=' + mutantPredicate);

    /* and the old clause, for the record: detached host + offsetParent, which
       the same mutant passes because the "0 before" is the detachment, not
       anything being hidden. */
    const oldForm = await boot.page.evaluate((s) => {
      document.getElementById('app').innerHTML = '';      // as the old clause did
      const host = document.createElement('div');
      host.id = 'harness-detached-oldform';
      host.innerHTML = renderCardEditor();
      window.__harnessHost = host;
      const e = [...document.querySelectorAll(s)];
      return { inHost: host.querySelectorAll('.editor-field').length,
               matched: e.length, visible: e.filter(x => x.offsetParent !== null).length };
    }, FIELD_SEL);
    const oldRep = await boot.page.evaluate(
      new Function('s', 'return (' + mutSrc + ')(s, window.__harnessHost, { keep: true })'), FIELD_SEL);
    const oldAfter = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    const oldPredicate = oldForm.visible === 0 && oldAfter.offsetParent > 0;
    console.log('(6b) the RETIRED clause (detached host + offsetParent) under the SAME mutant:'
      + '  before matched=' + oldForm.matched + ' offsetParent=' + oldForm.visible
      + '  → after matched=' + oldAfter.matched + ' offsetParent=' + oldAfter.offsetParent
      + ' checkVisibility=' + oldAfter.shown + '  (details opened=' + oldRep.opened
      + ') → it says ' + (oldPredicate ? 'PASS' : 'FAIL'));
    ok(oldPredicate,
       'the retired offsetParent clause really does pass the mutant (0 → ' + oldAfter.offsetParent
       + ' with nothing opened) — that is why it was replaced, not a regression');

    /* ── 7 · the leftover host is a HARD ERROR now, not a silent doubling ──
       This is the file's own documented recipe with { keep: true }, which is
       exactly what the old forceOpen did on every call. */
    const kept = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    let dup = null;
    try { await openCardEditor(boot.page, 'NEW'); } catch (e) { dup = e; }
    console.log('(7) with a kept host attached: .card-editor=' + kept.editors + ' .editor-field=' + kept.fields
      + ' hosts=' + kept.hosts + '  → openCardEditor threw=' + (!!dup));
    if (dup) console.log('    ' + dup.message.replace(/\s+/g, ' ').slice(0, 230));
    ok(!!dup && /EXACTLY ONE \.card-editor/.test(dup.message) && /DUPLICATE EDITORS/.test(dup.message),
       'a second editor in the document is REFUSED by name (it used to return OK on .card-editor=2,'
       + ' .editor-field=570 against a true 289)');

    const released = await boot.page.evaluate('(' + releaseForced + ')()');
    await openCardEditor(boot.page, 'NEW');
    const cleared = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    console.log('    releaseForced() removed ' + released + ' host(s) → .card-editor=' + cleared.editors
      + ' .editor-field=' + cleared.fields + ' hosts=' + cleared.hosts);
    ok(released === 1 && cleared.editors === 1 && cleared.hosts === 0,
       'releaseForced() puts the document back to exactly one editor');

    /* ── 7b · THE MUTANT THAT GOT THROUGH THE FIRST FIX (bug 10) ────────────
       A critic left a host attached whose innerHTML is ONE SECTION of the
       editor — what a driver photographing a single section actually builds.
       It carries 200 real .editor-field and ZERO .card-editor, so the
       EXACTLY-ONE check saw one editor and returned OK while the document went
       289 → 481 fields and #fx-onplay 86 → 171. Built here WITHOUT the harness
       marker on purpose, so the host counter cannot see it either and the only
       thing that can catch it is the field invariant. */
    const clone = await boot.page.evaluate(() => {
      const sec = document.getElementById('fx-effects');
      const d = document.createElement('div');
      d.id = 'critic-section-clone';
      d.innerHTML = sec.outerHTML;          // a REAL slice of the editor, not a stub
      document.body.appendChild(d);
      return { inClone: d.querySelectorAll('.editor-field').length,
               editorsInClone: d.querySelectorAll('.card-editor').length,
               docFields: document.querySelectorAll('.editor-field').length,
               docOnPlay: document.querySelectorAll('#fx-onplay .editor-field').length,
               hosts: document.querySelectorAll('[data-forge-harness-host]').length };
    });
    let strayErr = null;
    try { await openCardEditor(boot.page, 'NEW'); } catch (e) { strayErr = e; }
    console.log('(7b) a plain <div> holding ONE SECTION of the editor (' + clone.inClone
      + ' .editor-field, ' + clone.editorsInClone + ' .card-editor, ' + clone.hosts + ' harness hosts):'
      + ' document .editor-field=' + clone.docFields + ' (one editor is ' + cleared.fields + ')'
      + '  #fx-onplay=' + clone.docOnPlay + '  → openCardEditor threw=' + (!!strayErr));
    if (strayErr) console.log('    ' + strayErr.message.replace(/\s+/g, ' ').slice(0, 230));
    ok(clone.editorsInClone === 0 && clone.inClone > 100 && !!strayErr
       && /NOT inside the one \.card-editor/.test(strayErr.message)
       && /critic-section-clone/.test(strayErr.message),
       'a host with NO .card-editor in it but ' + clone.inClone + ' real .editor-field is REFUSED'
       + ' and named (it used to return OK while the document read ' + clone.docFields
       + ' .editor-field where one editor is ' + cleared.fields + ', and ' + FIELD_SEL + ' read '
       + clone.docOnPlay + ' where one editor is ' + cleared.matched + ')',
       'threw=' + (!!strayErr) + ' msg=' + (strayErr ? strayErr.message.slice(0, 120) : ''));

    /* ── 7c · AND THE BLAME IS EARNED (bug 11) ──────────────────────────────
       A second editor appended straight to document.body has nothing to do with
       forceOpen, and the old message told its reader to call releaseForced()
       anyway while printing "0 of them are inside 0 host(s)". Same unearned
       blame bug 7 fixed for the admin gate. */
    await boot.page.evaluate(() => { const d = document.getElementById('critic-section-clone'); if (d) d.remove(); });
    const twin = await boot.page.evaluate(() => {
      const src = document.querySelector('.card-editor');
      const d = document.createElement('div');
      d.id = 'critic-body-twin';
      d.innerHTML = src.outerHTML;
      document.body.appendChild(d);
      return { editors: document.querySelectorAll('.card-editor').length,
               hosts: document.querySelectorAll('[data-forge-harness-host]').length };
    });
    let twinErr = null;
    try { await openCardEditor(boot.page, 'NEW'); } catch (e) { twinErr = e; }
    console.log('(7c) a second .card-editor appended straight to document.body: editors=' + twin.editors
      + ' hosts=' + twin.hosts + '  → threw=' + (!!twinErr));
    if (twinErr) console.log('    ' + twinErr.message.replace(/\s+/g, ' ').slice(0, 230));
    ok(!!twinErr && /DUPLICATE EDITORS/.test(twinErr.message)
       && /will NOT help/.test(twinErr.message) && !/call releaseForced\(\)/.test(twinErr.message)
       && /critic-body-twin/.test(twinErr.message),
       'a duplicate that no forceOpen host holds is refused WITHOUT blaming forceOpen — the message'
       + ' says releaseForced() will not help and names where the editors actually are',
       twinErr ? twinErr.message.slice(0, 150) : 'did not throw');
    await boot.page.evaluate(() => { const d = document.getElementById('critic-body-twin'); if (d) d.remove(); });
    await openCardEditor(boot.page, 'NEW');

    /* ── 7d · THE DUPLICATE ID (bug 15) ─────────────────────────────────────
       Not litter that inflates a count — litter that makes an ORDINARY read
       return a wrong one. An empty <div id="fx-onplay"> PREPENDED to <body>
       (outside #app, so every renderForge leaves it standing) keeps every
       earlier assertion green and turns getElementById('fx-onplay') into the
       empty div: 0 .editor-field where the truth is 88. The clause measures
       that wrong number itself rather than asserting the shape of the DOM. */
    const dupId = await boot.page.evaluate(() => {
      const truth = document.querySelectorAll('#fx-onplay .editor-field').length;
      const d = document.createElement('div');
      d.id = 'fx-onplay';                       // the SAME id the editor uses
      document.body.insertBefore(d, document.body.firstChild);   // first in document order
      const byId = document.getElementById('fx-onplay');
      return { truth,
               byIdFields: byId.querySelectorAll('.editor-field').length,
               byIdIsTheDiv: byId === d,
               editors: document.querySelectorAll('.card-editor').length,
               fields: document.querySelectorAll('.editor-field').length,
               outside: document.querySelectorAll('.editor-field').length
                        - [...document.querySelectorAll('.card-editor')]
                            .reduce((n, c) => n + c.querySelectorAll('.editor-field').length, 0),
               hosts: document.querySelectorAll('[data-forge-harness-host]').length };
    });
    let dupErr = null;
    try { await openCardEditor(boot.page, 'NEW'); } catch (e) { dupErr = e; }
    console.log('(7d) an EMPTY <div id="fx-onplay"> prepended to <body>: every earlier invariant still'
      + ' clean (editors=' + dupId.editors + ' fields=' + dupId.fields + ' outside=' + dupId.outside
      + ' hosts=' + dupId.hosts + ') — but getElementById(\'fx-onplay\') now answers with the DIV'
      + ' (' + dupId.byIdIsTheDiv + '), and reads ' + dupId.byIdFields + ' .editor-field where'
      + ' the truth is ' + dupId.truth + '  → openCardEditor threw=' + (!!dupErr));
    if (dupErr) console.log('    ' + dupErr.message.replace(/\s+/g, ' ').slice(0, 260));
    ok(dupId.editors === 1 && dupId.outside === 0 && dupId.hosts === 0
       && dupId.byIdFields === 0 && dupId.truth === 88 && !!dupErr
       && /DUPLICATED/.test(dupErr.message) && /fx-onplay/.test(dupErr.message)
       && /getElementById/.test(dupErr.message),
       'a duplicate of an id the editor uses is REFUSED by name, even though editors=1,'
       + ' .editor-field=' + dupId.fields + ' and 0 stray — it used to pass while'
       + ' getElementById(\'fx-onplay\') read ' + dupId.byIdFields + ' fields against a truth of '
       + dupId.truth,
       'threw=' + (!!dupErr) + ' msg=' + (dupErr ? dupErr.message.slice(0, 140) : ''));
    await boot.page.evaluate(() => {
      /* the editor's own copy is inside #app; remove only the body-level twin */
      for (const el of [...document.querySelectorAll('#fx-onplay, [id="fx-onplay"]')]) {
        if (el.parentElement === document.body) el.remove();
      }
    });
    await openCardEditor(boot.page, 'NEW');

    /* ── 7e · SECTION-SHAPED LITTER WITH NO FIELDS IN IT (bug 16) ────────────
       The stray-field invariant is on .editor-field, so litter that carries
       none is free — and .fx-sec / .fx-sub are two counters this harness's own
       A/B driver prints. Seven empty <details> is all it takes. */
    const litter = await boot.page.evaluate(() => {
      const before = { sec: document.querySelectorAll('.fx-sec').length,
                       sub: document.querySelectorAll('.fx-sub').length };
      const box = document.createElement('div');
      box.id = 'critic-empty-sections';
      for (let i = 0; i < 7; i++) {
        const d = document.createElement('details');
        d.className = i % 2 ? 'fx-sec' : 'fx-sub';        // 4 subs, 3 secs
        d.innerHTML = '<summary>litter</summary>';        // and ZERO .editor-field
        box.appendChild(d);
      }
      document.body.appendChild(box);
      return { before,
               sec: document.querySelectorAll('.fx-sec').length,
               sub: document.querySelectorAll('.fx-sub').length,
               fields: document.querySelectorAll('.editor-field').length,
               outside: document.querySelectorAll('.editor-field').length
                        - [...document.querySelectorAll('.card-editor')]
                            .reduce((n, c) => n + c.querySelectorAll('.editor-field').length, 0),
               editors: document.querySelectorAll('.card-editor').length };
    });
    let litterErr = null;
    try { await openCardEditor(boot.page, 'NEW'); } catch (e) { litterErr = e; }
    console.log('(7e) 7 empty <details class="fx-sec"/"fx-sub"> appended to <body>: .fx-sec '
      + litter.before.sec + ' → ' + litter.sec + '   .fx-sub ' + litter.before.sub + ' → ' + litter.sub
      + '   while .editor-field=' + litter.fields + ' (' + litter.outside + ' outside) and editors='
      + litter.editors + ' stay clean  → openCardEditor threw=' + (!!litterErr));
    if (litterErr) console.log('    ' + litterErr.message.replace(/\s+/g, ' ').slice(0, 230));
    ok(litter.outside === 0 && litter.editors === 1 && litter.sec + litter.sub === 25
       && !!litterErr && /\.fx-sec\/\.fx-sub/.test(litterErr.message)
       && /critic-empty-sections/.test(litterErr.message),
       'section-shaped litter holding ZERO .editor-field is REFUSED and named — it used to pass'
       + ' every assertion while .fx-sec went ' + litter.before.sec + ' → ' + litter.sec
       + ' and .fx-sub ' + litter.before.sub + ' → ' + litter.sub
       + ', the two counters this harness prints in its own A/B',
       'threw=' + (!!litterErr) + ' msg=' + (litterErr ? litterErr.message.slice(0, 140) : ''));
    await boot.page.evaluate(() => { const d = document.getElementById('critic-empty-sections'); if (d) d.remove(); });
    await openCardEditor(boot.page, 'NEW');

    /* ── 8 · and by DEFAULT forceOpen leaves nothing behind at all ── */
    const detBefore = await boot.page.evaluate((s) => {
      const host = document.createElement('div');
      host.id = 'harness-detached';
      host.innerHTML = renderCardEditor();
      window.__harnessHost2 = host;
      const e = [...document.querySelectorAll(s)];
      return { inHost: host.querySelectorAll('.editor-field').length, matched: e.length };
    }, FIELD_SEL);
    const detRep = await boot.page.evaluate(
      new Function('s', 'return (' + forceOpen + ')(s, window.__harnessHost2)'), FIELD_SEL);
    const detAfter = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    console.log('(8) detached host (renderCardEditor into an unattached div, ' + detBefore.inHost + ' fields):'
      + ' forceOpen matched=' + detRep.matched + ' opened=' + detRep.opened
      + ' checkVisibility=' + detRep.shown + ' offsetParent=' + detRep.visible
      + '  appended=' + detRep.appendedHost + ' detached=' + detRep.detachedHost
      + '  → document .card-editor=' + detAfter.editors + ' .editor-field=' + detAfter.fields
      + ' hosts=' + detAfter.hosts);
    ok(detRep.appendedHost && detRep.detachedHost && detRep.shown > 0
       && detAfter.editors === 1 && detAfter.fields === cleared.fields && detAfter.hosts === 0,
       'forceOpen measures the detached host (' + detRep.shown + ' visible fields) and cleans up after itself',
       '.editor-field ' + cleared.fields + ' → ' + detAfter.fields);

    /* ── 8b · THE display:none BRANCH, WHICH NO CLAUSE EXERCISED ────────────
       A critic deleted forceOpen's `&& el.querySelector('.editor-field')` guard
       and NOTHING moved: unhidden=0 on both, because the only section
       bindCardEditor hides on a new card is #fx-obtain (Obtain & Craft) and it
       holds ZERO fields — so the branch the comment defends at length was dead
       code as far as the check was concerned. The state it exists for is built
       here instead of waited for: hide a section that DOES hold fields
       (#fx-effects, 200 of them) and assert forceOpen un-hides that one and
       leaves the genuinely-empty one alone. Both halves of the guard, pinned. */
    await openCardEditor(boot.page, 'NEW');
    const hidBefore = await boot.page.evaluate(() => {
      const fx = document.getElementById('fx-effects');
      fx.style.display = 'none';
      return { hidden: [...document.querySelectorAll('.fx-sec, .fx-sub')]
                        .filter(x => x.style.display === 'none')
                        .map(x => (x.id || '?') + ':' + x.querySelectorAll('.editor-field').length) };
    });
    const hidRep = await boot.page.evaluate(forceOpen, FIELD_SEL);
    const hidAfter = await boot.page.evaluate(PAGE_SNAP, FIELD_SEL);
    const emptyStillHidden = hidAfter.hiddenSecs.some(s => /^fx-obtain:0$/.test(s));
    const fieldSecShown = !hidAfter.hiddenSecs.some(s => s.indexOf('fx-effects:') === 0);
    console.log('(8b) display:none sections before ' + JSON.stringify(hidBefore.hidden)
      + ' → forceOpen unhidden=' + hidRep.unhidden + ' → after ' + JSON.stringify(hidAfter.hiddenSecs)
      + '  (checkVisibility ' + hidAfter.shown + ' of ' + hidAfter.matched + ')');
    ok(hidRep.unhidden === 1 && fieldSecShown && emptyStillHidden && shutSeen(hidAfter) >= 60,
       'forceOpen un-hides a display:none section that HOLDS fields (#fx-effects, 200) and leaves the'
       + ' genuinely empty one hidden (#fx-obtain, 0) — the guard bindCardEditor needs',
       'unhidden=' + hidRep.unhidden + ' fx-effects shown=' + fieldSecShown
       + ' fx-obtain still hidden=' + emptyStillHidden + ' shown=' + shutSeen(hidAfter));

    /* ── 8c · PAINTED, NOT MERELY "VISIBLE" (defect 1) ──────────────────────
       Everything above this line counts the DOM, and a critic proved twice
       over that every one of those counts stays green while the screen shows
       nothing of what they describe. The clean numbers first, so the mutants
       below have something to be measured against. */
    await openCardEditor(boot.page, 'NEW');
    /* forceOpen FIRST, on purpose: on a freshly rendered editor every field is
       inside a shut <details>, so the harness claims NONE of them are visible
       and the field sample is legitimately empty (openCardEditor's own gate
       runs in exactly that state and leans on the 16-point grid). To measure
       the field half of the probe there have to be fields it claims. */
    await boot.page.evaluate(forceOpen, FIELD_SEL);
    const paintClean = await assertPainted(boot.page);
    const cleanShot = await editorClipShot(boot.page);
    console.log('(8c) paint of a clean editor: rect ' + JSON.stringify(paintClean.rect)
      + ' on-screen ' + JSON.stringify(paintClean.clip)
      + '  elementFromPoint grid ' + paintClean.gridOnTop + '/' + paintClean.grid
      + '  claimed-visible fields on top ' + paintClean.fieldsOnTop + '/' + paintClean.fieldsSampled
      + ' (of ' + paintClean.fieldsClaimed + ' claimed and in view)'
      + '  opacityVisible=' + paintClean.opacityVisible
      + '  PNG ' + cleanShot.bytes + ' B = ' + cleanShot.perPx + ' B/px against a floor of '
      + cleanShot.floor + ' (' + PAINT_BYTES_PER_PX + ' B/px)');
    ok(paintClean.gridOnTop === paintClean.grid && paintClean.fieldsOnTop === paintClean.fieldsSampled
       && paintClean.fieldsSampled > 0 && paintClean.opacityVisible === true
       && cleanShot.bytes > cleanShot.floor * 5,
       'a clean editor is genuinely the top element at every one of the ' + paintClean.grid
       + ' points sampled over it and at all ' + paintClean.fieldsSampled + ' sampled fields, and its'
       + ' PNG is ' + Math.round(cleanShot.bytes / cleanShot.floor) + '× the byte floor',
       'grid=' + paintClean.gridOnTop + '/' + paintClean.grid + ' fields=' + paintClean.fieldsOnTop
       + '/' + paintClean.fieldsSampled + ' bytes=' + cleanShot.bytes + ' floor=' + cleanShot.floor);

    /* ── 8d · MUTANT: body{opacity:0} ───────────────────────────────────────
       The critic's first bypass. forceOpen reported shown=71 of 86 "really
       visible" and openCardEditor returned OK, on a frame whose screenshot was
       9,243 bytes against 497,843. */
    const mOpacity = await runMutant('opacity-zero', { page: boot.page });
    console.log('(8d) MUTANT opacity-zero: ' + mOpacity.detail.slice(0, 300));
    ok(mOpacity.caught,
       'body{opacity:0} in front of the visibility read is REFUSED — by the opacity predicate AND'
       + ' independently by the byte floor (' + mOpacity.numbers.mutantBytes + ' B vs '
       + mOpacity.numbers.cleanBytes + ' B clean, floor ' + mOpacity.numbers.floor + ')',
       JSON.stringify(mOpacity.numbers));

    /* ── 8e · MUTANT: an opaque full-viewport overlay ───────────────────────
       The second bypass, and the one no element-level predicate can see: the
       fields really ARE laid out and really ARE opaque — they are just under
       something. The byte floor is NOT what is asked to catch it: a flat cover
       happens to fall under the floor, but the real overlay this app puts up
       (#narr-overlay, clause 2b) photographs at 1,267,415 B. */
    const mOverlay = await runMutant('overlay', { page: boot.page });
    console.log('(8e) MUTANT overlay: ' + mOverlay.detail.slice(0, 320));
    ok(mOverlay.caught,
       'an opaque full-viewport fixed overlay over the editor is REFUSED — elementFromPoint reads '
       + mOverlay.numbers.mutantGridOnTop + ' of ' + mOverlay.numbers.grid + ' where clean is '
       + mOverlay.numbers.cleanGridOnTop + ', while checkVisibility still says '
       + mOverlay.numbers.forceOpenShown + ' of ' + mOverlay.numbers.matched + ' are visible',
       JSON.stringify(mOverlay.numbers));

    /* ── 8f · MUTANT: a .card-editor clone in an OPEN shadow root ───────────
       The decision is in runMutant's comment: the document-scoped counts are
       untouched by it (that is what a shadow boundary means), so it is refused
       only when it is painted OVER the editor — and then by the ordinary
       occlusion check, which knows nothing about shadow DOM. */
    const mShadow = await runMutant('shadow-clone', { page: boot.page });
    console.log('(8f) MUTANT shadow-clone: ' + mShadow.detail.slice(0, 340));
    ok(mShadow.caught,
       'a .card-editor clone in an open shadow root does not move ONE number this harness reports'
       + ' (editors=' + mShadow.numbers.cover.editors + ' fields=' + mShadow.numbers.cover.fields
       + ' with ' + mShadow.numbers.cover.inShadow + ' more in the shadow tree), so it is refused'
       + ' when it COVERS the editor and left alone when it does not',
       JSON.stringify(mShadow.numbers));

    /* ── 8g · MUTANT: no-open, run through the same switch as the other four,
       so `--mutant=no-open` and clause (6) cannot drift apart. */
    const mNoOpen = await runMutant('no-open', { page: boot.page });
    console.log('(8g) MUTANT no-open: ' + mNoOpen.detail.slice(0, 260));
    ok(mNoOpen.caught, 'the no-open mutant is still caught by the visibility check',
       JSON.stringify(mNoOpen.numbers));

    await openCardEditor(boot.page, 'NEW');

    /* seedNonAdmin has to work through the page, not only in node. */
    const na = await boot.page.evaluate('(' + seedNonAdmin + ')(Profile) && ({'
      + ' email: Profile.cloud.email, admin: isAdmin(),'
      + ' owned: Object.keys(Profile.cardCollection||{}).length,'
      + ' cap: (typeof deckKeyOwnedCount === "function") ? deckKeyOwnedCount("nope_missing_card") : null })');
    console.log('    seedNonAdmin in-page       email=' + na.email + '  isAdmin=' + na.admin
      + '  ownedCardIds=' + na.owned + '  deckKeyOwnedCount=' + na.cap);
    ok(na.admin === false && na.owned === 0 && na.cap !== Infinity,
       'seedNonAdmin drops admin AND the 3-of-everything grant');
  } finally { await boot.close(); }
  if (boot.errors.length) console.log('    page errors: ' + boot.errors.length + '  ' + boot.errors.slice(0, 2).join(' | '));

  if (process.argv.includes('--no-ab')) { console.log('(9,10,11,12) skipped (--no-ab)'); }
  else {
    /* ── 9 … 12 · the A/B half ──────────────────────────────────────────────
       The drivers are written to the OS temp dir, NOT into the repo: a scratch
       file inside the tree would show up in `git status` and break the very
       thing clause (10) measures. They count things out of process.cwd(), so
       one unchanged script reads two different trees. */
    const drv = path.join(os.tmpdir(), 'forge-ab-probe-' + process.pid + '.mjs');
    fs.writeFileSync(drv, [
      "import fs from 'node:fs'; import path from 'node:path';",
      "const s = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf8');",
      "const c = (re) => (s.match(re) || []).length;",
      "console.log('bytes=' + s.length);",
      "console.log('editor-field=' + c(/class=\"editor-field/g));",
      "console.log('fx-sec=' + c(/class=\"fx-sec/g) + ' fx-sub=' + c(/class=\"fx-sub/g));",
      "console.log('renderForge=' + c(/function renderForge\\(/g));",
      "if (process.env.FORGE_PROBE_SLEEP) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, +process.env.FORGE_PROBE_SLEEP);",
    ].join('\n'));
    /* the one-sided driver: it reads public/assets, which is 4 GB and is in no
       worktree. Without the guard this is a confident false difference. */
    const drvAsym = path.join(os.tmpdir(), 'forge-ab-asym-' + process.pid + '.mjs');
    fs.writeFileSync(drvAsym, [
      "import fs from 'node:fs'; import path from 'node:path';",
      "const s = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf8');",
      "console.log('bytes=' + s.length);",
      "console.log('has-assets=' + fs.existsSync(path.resolve(process.cwd(), 'public/assets')));",
    ].join('\n'));
    const harnessUrl = 'file:///' + fileURLToPath(import.meta.url).replace(/\\/g, '/');
    const runner = path.join(os.tmpdir(), 'forge-ab-runner-' + process.pid + '.mjs');
    fs.writeFileSync(runner, [
      "import { abRun } from " + JSON.stringify(harnessUrl) + ";",
      "const t0 = Date.now();",
      "const r = await abRun(process.argv[2], { sparse: ['public/src'] });",
      "console.log(JSON.stringify({ started: t0, ended: Date.now(), wt: r.worktrees.created[0],",
      "  identical: r.identical, exitOk: r.exitOk, unchanged: r.mainTree.unchanged,",
      "  selfClean: r.mainTree.selfClean, ownGone: r.mainTree.ownWorktreesGone,",
      "  removed: r.worktrees.removed.length }));",
    ].join('\n'));
    try {
      const cone = defaultSparse('HEAD');
      console.log('    default cone: ' + cone.length + ' public/ dirs (public/assets excluded — 4,332 files,'
        + ' 4.06 GB, and it dies with "Filename too long" on checkout)');

      /* (9) the no-op A/B, on the COMPLETE cone */
      const nop = await abRun(drv, { baseRef: 'HEAD', ref: 'HEAD' });
      console.log('(9) no-op A/B (HEAD vs HEAD)  base sha256=' + nop.base.sha + ' (' + nop.base.bytes + 'B)'
        + '  head sha256=' + nop.head.sha + ' (' + nop.head.bytes + 'B)  identical=' + nop.identical);
      console.log('    base stdout: ' + nop.base.stdoutText.trim().replace(/\n/g, ' | '));
      console.log('    head stdout: ' + nop.head.stdoutText.trim().replace(/\n/g, ' | '));
      console.log('    one-sided paths between the two trees: ' + nop.asymmetric.length
        + (nop.asymmetric.length ? '  e.g. ' + nop.asymmetric.slice(0, 4).join(', ') : '')
        + '   read by the driver: ' + nop.asymmetricRead.length);
      ok(nop.identical && nop.exitOk, 'a no-op diff produces byte-identical metrics');

      /* (10) THE WORKTREES AND THE MAIN TREE — PER RUN, NOT PER MACHINE.
         ⚠ This clause used to compare the GLOBAL `git worktree list` before and
           after as a string, and it failed on three of four full runs across
           two critics: every time, another agent held an A/B worktree while
           `listAfter` was taken, and the run that had created and removed
           exactly its own two was told it had not restored anything. Bug 4's
           fix — two agents MAY A/B at once — is what put those entries there.
           The per-run property is what is asserted now; the global strings stay
           on the record, printed, as evidence. */
      const foreign = nop.mainTree.foreignAbWorktrees;
      console.log('(10) worktrees created=' + nop.worktrees.created.length
        + ' removed=' + nop.worktrees.removed.length + ' reaped=' + nop.worktrees.reaped.length
        + ' (skipped, owner alive: ' + (nop.worktrees.reaped.skipped || []).length + ')'
        + '  ownGone=' + nop.mainTree.ownWorktreesGone
        + '  worktrees THIS run removed=' + JSON.stringify(nop.mainTree.worktreesDropped.map(p => p.split('/').pop()))
        + ' of which foreign-and-unreaped=' + nop.mainTree.foreignWorktreesDropped.length
        + '  (reaped foreign: ' + JSON.stringify(nop.mainTree.reapedForeign)
        + ', left alone because the owner is alive: ' + JSON.stringify(nop.mainTree.reapSkipped) + ')'
        + '  foreignPreserved=' + nop.mainTree.foreignWorktreesPreserved + ' ← EVIDENCE ONLY'
        + '  otherAgents\' AB worktrees present at the end=' + foreign);
      console.log('     `git worktree list` ' + nop.listBefore.split('\n').filter(Boolean).length
        + ' → ' + nop.listDuring.split('\n').filter(Boolean).length
        + ' → ' + nop.listAfter.split('\n').filter(Boolean).length + ' lines'
        + ' (identical string=' + nop.mainTree.worktreeListIdentical
        + ' — EVIDENCE, not the assertion: it is machine-global and a colleague moves it)');
      console.log('     paths: ' + nop.worktrees.created.map(p => path.basename(p)).join(', ')
        + '  (per-run, under ' + AB_HOME + ')');
      console.log('     main tree git status: ' + nop.mainTree.statusLines + ' lines,'
        + ' sha256 before=' + nop.mainTree.statusShaBefore + ' after=' + nop.mainTree.statusShaAfter
        + '  unchanged=' + nop.mainTree.unchanged
        + '  delta: +' + JSON.stringify(nop.mainTree.statusDelta.appeared.slice(0, 3))
        + ' -' + JSON.stringify(nop.mainTree.statusDelta.vanished.slice(0, 3)));
      console.log('     fs writes this process made under ' + REPO + ' during the A/B: '
        + nop.mainTree.repoWrites.length + (nop.mainTree.repoWrites.length ? ' ← ' + nop.mainTree.repoWrites.slice(0, 5).join(', ') : ''));
      /* ⚠ foreignWorktreesDropped, NOT foreignWorktreesPreserved (defect 2).
         The old conjunct asked whether every foreign worktree that existed
         before the run still exists after it — machine-global, and false the
         moment a colleague's own A/B finishes inside the window, which is
         precisely the thing bug 4's fix invites them to do. The question this
         run can answer is which worktrees IT removed: its own two, plus any the
         reaper reported by name as dead-owner. */
      ok(nop.worktrees.created.length === 2 && nop.worktrees.removed.length === 2
         && nop.mainTree.ownWorktreesGone && nop.mainTree.foreignWorktreesDropped.length === 0,
         'both worktrees were created and removed cleanly, and the only worktrees this run removed'
         + ' were its own' + (nop.mainTree.reapedForeign.length
             ? ' plus ' + nop.mainTree.reapedForeign.length + ' dead-owner one(s) the reaper named: '
               + JSON.stringify(nop.mainTree.reapedForeign) : '')
         + (foreign ? ' (' + foreign + ' other agent(s) were A/Bing at the same time)' : ''),
         'created=' + nop.worktrees.created.length + ' removed=' + nop.worktrees.removed.length
         + ' ownGone=' + nop.mainTree.ownWorktreesGone
         + ' foreignDropped=' + JSON.stringify(nop.mainTree.foreignWorktreesDropped));
      /* ⚠ NOT `statusBefore === statusAfter` (bug 8). That is a property of the
         MACHINE — a critic watched it go red because another agent's untracked
         .forgetmp/ vanished from git status mid-run — and abRun cannot tell
         "I moved the tree" from "somebody else did" by reading it. What it CAN
         prove is that it never touched the tree: zero fs writes under the repo
         from this process (instrumented for the whole call) and a git() that
         refuses every main-tree verb but a read. The status delta is printed
         above so a human can see what the other agents did. */
      ok(nop.mainTree.selfClean,
         'the A/B wrote NOTHING into the main working tree — 0 fs writes under ' + REPO
         + ' from this process for the whole call'
         + (nop.mainTree.unchanged ? ' (and git status did not move either)'
            : ' (git status DID move, by +' + nop.mainTree.statusDelta.appeared.length
              + '/-' + nop.mainTree.statusDelta.vanished.length + ' lines, none of them ours — another agent is working)'),
         nop.mainTree.repoWrites.join(', '));
      ok(!/head-ab$|base-ab$/.test(nop.worktrees.created.join(' ')),
         'the worktree paths are per-run, not the fixed ../head-ab and ../base-ab');

      /* And the live one, which is what the remodel will actually use. */
      const live = await abRun(drv, {});
      console.log('     live A/B (working tree vs HEAD)  base=' + live.base.sha + '  head=' + live.head.sha
        + '  identical=' + live.identical + '  repoWrites=' + live.mainTree.repoWrites.length);
      console.log('     base stdout: ' + live.base.stdoutText.trim().replace(/\n/g, ' | '));
      console.log('     head stdout: ' + live.head.stdoutText.trim().replace(/\n/g, ' | '));
      ok(live.mainTree.selfClean && live.mainTree.ownWorktreesGone && live.worktrees.removed.length === 1,
         'the live A/B also cleans up and leaves the tree alone');

      /* (11) THE ONE-SIDED READ. First with the guard off, to show the false
         difference it is there to catch; then with the default, which refuses. */
      const loose = await abRun(drvAsym, { sparse: ['public/src'], strictPaths: false });
      console.log('(11) a metric that reads public/assets, guard OFF:  base: '
        + loose.base.stdoutText.trim().replace(/\n/g, ' | ') + '   head: '
        + loose.head.stdoutText.trim().replace(/\n/g, ' | ') + '   identical=' + loose.identical);
      let refused = null;
      try { await abRun(drvAsym, { sparse: ['public/src'] }); }
      catch (e) { refused = e; }
      console.log('     guard ON: threw=' + (!!refused) + ' name=' + (refused && refused.name)
        + ' paths=' + JSON.stringify(refused && refused.paths));
      if (refused) console.log('     ' + refused.message.replace(/\s+/g, ' ').slice(0, 200));
      ok(!loose.identical && !!refused && refused.name === 'AbAsymmetricPathError'
         && (refused.paths || []).includes('public/assets'),
         'a metric reading a path that exists on only one side is REFUSED by name'
         + ' (unguarded it reports a false difference: ' + JSON.stringify(loose.base.stdoutText.trim().split('\n').pop())
         + ' vs ' + JSON.stringify(loose.head.stdoutText.trim().split('\n').pop()) + ')');

      /* (11b) …and the ONE legitimate way through it, because a Forge
         screenshot makes 47 /assets/ requests and public/assets can never be
         in a worktree: serve both sides the same bytes out of one tree
         (bootPage({ assetsFrom: REPO }), whose resolver this driver calls
         directly) and declare the allowance. The stdout metric is then
         IDENTICAL — the point is not to silence the guard but to remove the
         difference it was pointing at. */
      const assetFile = firstFileUnder(path.join(REPO, 'public', 'assets'), 3);
      const assetUrl = '/assets/' + path.relative(path.join(REPO, 'public', 'assets'), assetFile).replace(/\\/g, '/');
      const drvAsset = path.join(os.tmpdir(), 'forge-ab-asset-' + process.pid + '.mjs');
      fs.writeFileSync(drvAsset, [
        "import fs from 'node:fs'; import path from 'node:path';",
        "import { resolveServedFile } from " + JSON.stringify(harnessUrl) + ";",
        "const root = path.resolve(process.cwd(), 'public');",
        "const hit = resolveServedFile(root, process.argv[2], { fallbackRoot: "
          + JSON.stringify(path.join(REPO, 'public')) + " });",
        "console.log('asset-bytes=' + (hit ? fs.statSync(hit.file).size : 'MISSING'));",
        "console.error('fallback=' + !!(hit && hit.fallback));",
      ].join('\n'));
      let assetRefused = null;
      try { await abRun(drvAsset, { sparse: ['public/src'], args: [assetUrl] }); }
      catch (e) { assetRefused = e; }
      const shared = await abRun(drvAsset, { sparse: ['public/src'], args: [assetUrl],
                                             allowOneSided: ['public/assets'] });
      console.log('(11b) ' + assetUrl + ' served to both sides from one tree:'
        + '  base ' + shared.base.stdoutText.trim() + ' (' + shared.base.stderr.trim() + ')'
        + '  head ' + shared.head.stdoutText.trim() + ' (' + shared.head.stderr.trim() + ')'
        + '  identical=' + shared.identical + '  allowed=' + JSON.stringify(shared.oneSidedAllowed)
        + '   without the allowance it is ' + (assetRefused ? assetRefused.name : 'NOT refused'));
      ok(shared.identical && shared.exitOk && /fallback=true/.test(shared.head.stderr)
         && /fallback=false/.test(shared.base.stderr)
         && !!assetRefused && assetRefused.name === 'AbAsymmetricPathError',
         'the assets fallback makes the two sides read the SAME bytes (' + shared.base.stdoutText.trim()
         + '), and the allowance is targeted — the same driver without it is still refused');
      try { fs.unlinkSync(drvAsset); } catch (e) {}

      /* ── 11c · THE FOUR DRIVERS THAT WALKED THROUGH THE GUARD (bug 9) ──────
         Two critics got a confident false difference past clause (11) with
         one-line drivers. Each is shipped here as its own named mutant, with
         the number it reported when it was NOT refused, so a future edit to the
         shim's wrap list or its path matching goes red instead of quiet.
           readdir-parent   fs.readdirSync('public')        35 entries vs 32
           readdir-src      fs.readdirSync('public/src')    69 modules vs 66
                            ← the builder's OWN headline example, delivered as a
                              confident wrong number
           opendir          fs.opendirSync('public/assets') true vs MISSING
           case             fs.existsSync('public/Assets')  true vs false */
      /* 🔴 readdir-src IS ONE-SIDED BY CONSTRUCTION, NOT BY LUCK. It used to run
         under the same cone as the others (['public/src']) and relied on the
         MAIN tree carrying modules the HEAD commit did not — "69 modules vs
         66" was three untracked directories that happened to be sitting in
         public/src. The day the tree was committed (v121v92, 07dc451367) both
         sides listed 69, the listing was symmetric, the guard had nothing to
         refuse, and this check went red for a repository that was simply
         clean. A check that passes only while work is uncommitted is a check
         on the calendar. So this driver runs under a cone one level DOWN:
         head's public/src holds only 'economy', base's holds all of it, and
         the children are one-sided whatever the commit state. Same shim, same
         'list' refusal, same driver text. */
      const bypass = [
        ['readdir-parent', "console.log('n=' + fs.readdirSync(path.resolve(process.cwd(),'public')).length);"],
        ['readdir-src', "console.log('n=' + fs.readdirSync(path.resolve(process.cwd(),'public/src')).length);", ['public/src/economy']],
        ['opendir', "let d=null; try { d = fs.opendirSync(path.resolve(process.cwd(),'public/assets')); d.closeSync(); } catch (e) {}\nconsole.log('assets=' + !!d);"],
        ['case-Assets', "console.log('has=' + fs.existsSync(path.resolve(process.cwd(),'public/Assets')));"],
      ];
      const bypassRows = [];
      for (const [name, body, cone] of bypass) {
        const f = path.join(os.tmpdir(), 'forge-ab-bypass-' + name + '-' + process.pid + '.mjs');
        fs.writeFileSync(f, "import fs from 'node:fs'; import path from 'node:path';\n" + body + '\n');
        let err = null, rep = null;
        try { rep = await abRun(f, { sparse: cone || ['public/src'] }); } catch (e) { err = e; }
        bypassRows.push({ name, refused: !!err && err.name === 'AbAsymmetricPathError',
                          paths: (err && err.paths || []).slice(0, 2),
                          how: (err && err.report && err.report.asymmetricReadDetail || []).map(d => d.how)[0] || null,
                          identical: rep ? rep.identical : null,
                          base: rep ? rep.base.stdoutText.trim() : null,
                          head: rep ? rep.head.stdoutText.trim() : null });
        try { fs.unlinkSync(f); } catch (e) {}
      }
      for (const r of bypassRows) {
        console.log('(11c) ' + r.name.padEnd(14) + ' refused=' + r.refused
          + (r.refused ? ' as ' + r.how + ' ' + JSON.stringify(r.paths)
             : '  ← NOT REFUSED, and it reported base=' + JSON.stringify(r.base)
               + ' head=' + JSON.stringify(r.head) + ' identical=' + r.identical));
      }
      ok(bypassRows.every(r => r.refused),
         'all four one-line drivers that used to walk past the guard are refused by name'
         + ' (a directory listing whose CHILDREN are one-sided, fs.opendirSync, and a re-cased path)',
         bypassRows.filter(r => !r.refused).map(r => r.name).join(', ') + ' got through');

      /* ── 11d · THE GUARD RE-EXPORTED ITS OWN BYPASS (bug 13) ───────────────
         A critic isolated this with a control pair: fs.realpathSync('public/
         assets') was refused by name, and fs.realpathSync.native() — same
         tree, same argument, one property along — reported base has-assets=true
         / head has-assets=false as a plain difference with exit 0 on both
         sides. The cause was one line of the shim: wrap()'s Object.assign(w,
         orig) copies realpathSync's own `.native` function off the ORIGINAL
         onto the wrapper, so the guard handed back the unwrapped builtin
         through a property it deliberately copies.
         ⚠ THE ENUMERATED PAIR IS NOT THE CHECK — it is one line of it. The
           driver also walks the WHOLE wrapped surface inside the guarded
           process and prints how many own lowercase sub-functions exist and how
           many of them are unwrapped, so the next .native-shaped property is
           caught by the same clause without anybody naming it. Both come out of
           ONE A/B: stdout is captured before the refusal, and the thrown error
           carries the report. */
      const drvNative = path.join(os.tmpdir(), 'forge-ab-native-' + process.pid + '.mjs');
      fs.writeFileSync(drvNative, [
        "import fs from 'node:fs'; import path from 'node:path';",
        /* the shim's wrapper body is the only function whose source says this */
        "const wrapped = (f) => /check\\(p, listing\\)/.test(String(f));",
        "let subs = 0, top = 0, topWrapped = 0; const bad = [], names = [];",
        "for (const [label, obj] of [['fs', fs], ['fs.promises', fs.promises]]) {",
        "  for (const n of Object.keys(obj)) {",
        "    let f; try { f = obj[n]; } catch (e) { continue; }",
        "    if (typeof f !== 'function' || !/^[a-z]/.test(n)) continue;",
        "    top++; if (wrapped(f)) topWrapped++;",
        "    for (const k of Object.keys(f)) {",
        "      if (typeof f[k] !== 'function' || !/^[a-z]/.test(k)) continue;",
        "      subs++; names.push(label + '.' + n + '.' + k);",
        "      if (!wrapped(f[k])) bad.push(label + '.' + n + '.' + k);",
        "    }",
        "  }",
        "}",
        "console.log('surface top=' + topWrapped + '/' + top + ' subs=' + subs",
        "  + ' [' + names.join(' ') + '] unwrapped=' + bad.length + (bad.length ? ' ' + bad.join(' ') : ''));",
        /* and the concrete bypass, last, because it is what triggers the refusal */
        "let v = null; try { v = fs.realpathSync.native(path.resolve(process.cwd(), 'public/assets')); } catch (e) {}",
        "console.log('has-assets=' + !!v);",
      ].join('\n'));
      const looseNative = await abRun(drvNative, { sparse: ['public/src'], strictPaths: false });
      let nativeErr = null;
      try { await abRun(drvNative, { sparse: ['public/src'] }); } catch (e) { nativeErr = e; }
      const surfaceLine = looseNative.base.stdoutText.split('\n').find(l => l.indexOf('surface ') === 0) || '';
      const guardedSurface = ((nativeErr && nativeErr.report && nativeErr.report.base.stdoutText) || '')
        .split('\n').find(l => l.indexOf('surface ') === 0) || '';
      const mSubs = /subs=(\d+)/.exec(guardedSurface);
      const mUnwrapped = /unwrapped=(\d+)/.exec(guardedSurface);
      const subsSeen = mSubs ? +mSubs[1] : -1;
      const unwrappedSeen = mUnwrapped ? +mUnwrapped[1] : -1;
      console.log('(11d) fs.realpathSync.native, guard OFF:  base '
        + JSON.stringify(looseNative.base.stdoutText.trim().split('\n').pop()) + '  head '
        + JSON.stringify(looseNative.head.stdoutText.trim().split('\n').pop())
        + '  identical=' + looseNative.identical
        + '      guard ON: threw=' + (!!nativeErr) + ' as ' + (nativeErr && nativeErr.name)
        + ' ' + JSON.stringify((nativeErr && nativeErr.paths) || []));
      console.log('      wrapped surface INSIDE the guarded process: ' + guardedSurface.trim());
      console.log('      (unguarded, the same walk reads: ' + surfaceLine.trim().slice(0, 120) + ')');
      ok(!looseNative.identical && !!nativeErr && nativeErr.name === 'AbAsymmetricPathError'
         && (nativeErr.paths || []).includes('public/assets')
         && subsSeen >= 2 && unwrappedSeen === 0,
         'fs.realpathSync.native is refused like fs.realpathSync — and it is not one name in a list:'
         + ' all ' + subsSeen + ' own lowercase sub-function(s) across the wrapped fs surface are'
         + ' wrapped, 0 unwrapped (unguarded it reported '
         + JSON.stringify(looseNative.base.stdoutText.trim().split('\n').pop()) + ' vs '
         + JSON.stringify(looseNative.head.stdoutText.trim().split('\n').pop()) + ')',
         'refused=' + (nativeErr && nativeErr.name) + ' subs=' + subsSeen + ' unwrapped=' + unwrappedSeen
         + ' guardedSurface=' + JSON.stringify(guardedSurface.slice(0, 200)));
      try { fs.unlinkSync(drvNative); } catch (e) {}

      /* ── 11e · THE FALSE-NEGATIVE TWIN (bug 14) ────────────────────────────
         Everything above stops a false DIFFERENCE. This stops a false SAME: a
         driver holding an ABSOLUTE path into the main repo A/Bs nothing at all
         — both sides open the same bytes — and the old report said
         identical=true with no refusal and no note. One driver proves the whole
         thing, because it reads public/index.html BOTH ways in the same run:
         absolutely (identical on both sides by construction) and through
         process.cwd() (the real difference the escaped read reports as zero). */
      const drvEsc = path.join(os.tmpdir(), 'forge-ab-escape-' + process.pid + '.mjs');
      fs.writeFileSync(drvEsc, [
        "import fs from 'node:fs'; import path from 'node:path';",
        "const abs = " + JSON.stringify(path.join(REPO, 'public', 'index.html').replace(/\\/g, '/')) + ";",
        "console.log('cwd-bytes=' + fs.statSync(path.resolve(process.cwd(), 'public/index.html')).size);",
        "console.log('abs-bytes=' + fs.statSync(abs).size);",
      ].join('\n'));
      let escErr = null;
      try { await abRun(drvEsc, { sparse: ['public/src'] }); } catch (e) { escErr = e; }
      const num = (txt, key) => { const m = new RegExp(key + '=(\\d+)').exec(txt || ''); return m ? +m[1] : -1; };
      const escRep = (escErr && escErr.report) || null;
      const absBase = num(escRep && escRep.base.stdoutText, 'abs-bytes');
      const absHead = num(escRep && escRep.head.stdoutText, 'abs-bytes');
      const cwdBase = num(escRep && escRep.base.stdoutText, 'cwd-bytes');
      const cwdHead = num(escRep && escRep.head.stdoutText, 'cwd-bytes');
      console.log('(11e) one driver, one file, two ways:  ABSOLUTE into ' + REPO + '  base=' + absBase
        + '  head=' + absHead + ' (difference ' + Math.abs(absBase - absHead) + ')'
        + '   vs through process.cwd()  base=' + cwdBase + '  head=' + cwdHead
        + ' (difference ' + Math.abs(cwdBase - cwdHead) + ')');
      console.log('      → threw=' + (!!escErr) + ' as ' + (escErr && escErr.name)
        + ' ' + JSON.stringify((escErr && escErr.paths) || []));
      if (escErr) console.log('      ' + escErr.message.replace(/\s+/g, ' ').slice(0, 210));
      ok(!!escErr && escErr.name === 'AbEscapedTreeError'
         && (escErr.paths || []).includes('public/index.html')
         && absBase > 0 && absBase === absHead && cwdBase !== cwdHead,
         'a driver that reads the MAIN tree instead of the tree under test is REFUSED by its own name'
         + ' — read absolutely that file is ' + absBase + ' on BOTH sides (a difference of 0, which is'
         + ' not a measurement), where the same file read through process.cwd() is ' + cwdBase + ' vs '
         + cwdHead + ', a real difference of ' + Math.abs(cwdBase - cwdHead) + ' bytes',
         'threw=' + (escErr && escErr.name) + ' abs=' + absBase + '/' + absHead
         + ' cwd=' + cwdBase + '/' + cwdHead);
      try { fs.unlinkSync(drvEsc); } catch (e) {}

      /* …and the exemptions that make (11e) survivable are earned, not blanket:
         node_modules (playwright and 250 MB of chromium can only come from the
         main tree), the harness, the driver itself. Proved by a driver that
         imports the harness and reads node_modules — it must NOT be refused,
         or every screenshot piece in this run dies at its import line. */
      /* …and it carries the SECOND HALF of bug 14 with it: appSourcePath() is
         the file openCardEditor's pre-flight reads ADMIN_EMAILS out of, and it
         used to be REPO's index.html unconditionally — the MAIN tree's, while
         the browser rendered the worktree's. This clause is how that was
         found: it must print a path under the tree under test on BOTH sides. */
      const drvImp = path.join(os.tmpdir(), 'forge-ab-escape-ok-' + process.pid + '.mjs');
      fs.writeFileSync(drvImp, [
        "import fs from 'node:fs'; import path from 'node:path';",
        "import { NON_ADMIN_EMAIL, appSourcePath } from " + JSON.stringify(harnessUrl) + ";",
        "const nm = " + JSON.stringify(path.join(REPO, 'node_modules').replace(/\\/g, '/')) + ";",
        "const src = appSourcePath();",
        "console.log('harness=' + NON_ADMIN_EMAIL + ' node_modules=' + fs.existsSync(nm)",
        "  + ' cwd-bytes=' + fs.statSync(path.resolve(process.cwd(), 'public/index.html')).size",
        "  + ' src-under-cwd=' + (path.resolve(src).toLowerCase().indexOf(process.cwd().toLowerCase() + path.sep) === 0)",
        "  + ' src-bytes=' + fs.statSync(src).size);",
      ].join('\n'));
      let impErr = null, impRep = null;
      try { impRep = await abRun(drvImp, { sparse: ['public/src'] }); } catch (e) { impErr = e; }
      console.log('      the by-design escapes (' + JSON.stringify(impRep ? impRep.escapeAllowed : [])
        + '): threw=' + (impErr ? impErr.name : 'no')
        + '  base ' + JSON.stringify(impRep ? impRep.base.stdoutText.trim() : '')
        + '  head ' + JSON.stringify(impRep ? impRep.head.stdoutText.trim() : ''));
      const srcUnderCwd = (t) => /src-under-cwd=true/.test(t || '');
      ok(!impErr && impRep && impRep.exitOk && !impRep.identical
         && (impRep.escapedRead || []).length === 0
         && srcUnderCwd(impRep.base.stdoutText) && srcUnderCwd(impRep.head.stdoutText),
         'a driver that imports the harness out of the main tree and stats node_modules is NOT'
         + ' refused — the escape allowance is exactly the declared by-design reads ('
         + JSON.stringify(impRep ? impRep.escapeAllowed : []) + ') and nothing else — and the'
         + ' harness\'s OWN index.html read follows the tree under test on both sides, which is'
         + ' the second half of the same bug (it used to read the main tree\'s ADMIN_EMAILS'
         + ' while the browser rendered the worktree\'s)',
         'threw=' + (impErr && impErr.name) + ' escaped='
         + JSON.stringify((impErr && impErr.paths) || (impRep && impRep.escapedRead) || [])
         + ' base=' + JSON.stringify(impRep && impRep.base.stdoutText.trim())
         + ' head=' + JSON.stringify(impRep && impRep.head.stdoutText.trim()));
      try { fs.unlinkSync(drvImp); } catch (e) {}

      /* ── 11f · THE SPELLING THAT WALKED THROUGH BOTH GUARDS AT ONCE ────────
         (defect 3.) path.toNamespacedPath() / the \\?\ extended-length prefix
         is what node itself hands out and what a Windows driver writes without
         thinking about it, and path.resolve() leaves it in place — so neither
         relOf() nor escOf() recognised the path and the read was not merely
         mis-filed, it was never recorded. Measured before the fix, with the
         asymmetric driver: base has-assets=true, head has-assets=false,
         identical=false, asymmetricRead=[], exit 0 — a silent false difference
         out of clause (11)'s own driver, one spelling along. Both guards get
         the same one-command mutant. */
      for (const nm of ['namespaced-asym', 'namespaced-escape']) {
        const m = await runMutant(nm, {});
        console.log('(11f) MUTANT ' + nm.padEnd(18) + ' ' + m.detail.slice(0, 300));
        ok(m.caught, 'the ' + nm + ' spelling is REFUSED as ' + (nm === 'namespaced-asym'
             ? 'AbAsymmetricPathError like the ordinary spelling of the same read'
             : 'AbEscapedTreeError like the ordinary spelling of the same read'),
           JSON.stringify(m.numbers));
      }

      /* (12) TWO RUNS IN FLIGHT AT ONCE. A child process holds an A/B open for
         ~6 s while this one runs its own; with the fixed ../head-ab both used
         the same path and the second refused outright. Note abRun is
         synchronous inside (spawnSync), so a second call in THIS process would
         not overlap — it has to be a real second process. */
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, [runner, drv], {
        cwd: REPO, env: Object.assign({}, process.env, { FORGE_PROBE_SLEEP: '6000' }), windowsHide: true });
      let childOut = '';
      child.stdout.on('data', d => { childOut += d; });
      child.stderr.on('data', d => { childOut += d; });
      const childDone = new Promise(res => child.on('close', res));
      await new Promise(r => setTimeout(r, 3000));   // let the child get its worktree first
      const mineT0 = Date.now();
      let mine = null, mineErr = null;
      try { mine = await abRun(drv, { sparse: ['public/src'], args: [] }); }
      catch (e) { mineErr = e; }
      const mineT1 = Date.now();
      const childCode = await childDone;
      let childRep = null;
      try { childRep = JSON.parse(childOut.trim().split('\n').filter(l => l.startsWith('{')).pop()); } catch (e) {}
      const overlap = childRep ? Math.min(mineT1, childRep.ended) - Math.max(mineT0, childRep.started) : -1;
      console.log('(12) two abRun calls in flight: child exit=' + childCode
        + ' wt=' + (childRep && path.basename(childRep.wt)) + ' ok=' + (childRep && childRep.exitOk)
        + '   this process wt=' + (mine && path.basename(mine.worktrees.created[0]))
        + ' ok=' + (mine ? mine.exitOk : 'threw: ' + String(mineErr).slice(0, 120))
        + '   overlap=' + overlap + 'ms');
      if (!childRep) console.log('     child output: ' + childOut.replace(/\s+/g, ' ').slice(0, 300));
      /* ⚠ `mine.mainTree.selfClean`, not `unchanged`: the child A/B is running
         in the same window BY DESIGN, so a git status compared across it is a
         comparison of two agents' work. selfClean is this process's own hands. */
      ok(!!childRep && childCode === 0 && !mineErr && mine && mine.exitOk && childRep.exitOk
         && overlap > 0 && childRep.wt !== mine.worktrees.created[0]
         && mine.mainTree.selfClean && childRep.selfClean,
         'two A/B runs overlapped by ' + overlap + 'ms, neither refused, and they used different worktrees',
         'childRep=' + JSON.stringify(childRep) + ' mineErr=' + String(mineErr).slice(0, 120)
         + ' overlap=' + overlap + ' selfClean=' + (mine && mine.mainTree.selfClean));

      /* (12b) a run that was KILLED leaves a worktree; the next run reaps it.
         ⚠ EVERY CONJUNCT BELOW IS ABOUT A WORKTREE THIS CLAUSE CREATED (defect
           2). It used to end in `othersKept` — "every other entry in the
           machine-global worktree list survived the reap" — and a critic's
           first full run exited 1 (36 PASS / 1 FAIL) for the best possible
           reason: ANOTHER agent's dead-owner worktree was on the machine and
           the reaper correctly took it. Their second run, on a quiet box, was
           green. That is a flaky gate, and it is bug 8's own failure mode
           living inside the clause that claims to fix it. Reaping a colleague's
           DEAD worktree is the reaper working; it is reported here as evidence
           and is not a predicate.
         ⚠ AND THE LIVE OWNER IS NOW A REAL FOREIGN PROCESS, not this one. The
           fixture used process.pid, which proves "the reaper skips a pid that
           happens to be alive" but not "the reaper leaves a COLLEAGUE alone" —
           the case that matters, since `worktree remove --force` under a
           running A/B corrupts their measurement silently. A child process is
           spawned to own it, and it is killed at the end of the clause. */
      const { spawn: spawnOwner } = await import('node:child_process');
      const owner = spawnOwner(process.execPath, ['-e', 'setTimeout(function(){}, 600000)'],
        { windowsHide: true, stdio: 'ignore' });
      const deadId = 'head-' + abRunId() + '-dead';
      const deadDir = path.join(AB_HOME, deadId);
      fs.mkdirSync(AB_HOME, { recursive: true });
      addWorktree(deadDir, 'HEAD', ['public/src']);
      fs.writeFileSync(path.join(AB_HOME, deadId + '.owner.json'),
        JSON.stringify({ pid: 0x7ffffff0, started: Date.now(), dir: deadDir }));   // a pid that is not alive
      /* …and a SECOND stamp owned by that live child, which must be left alone
         at any age: the reaper used to take a live owner's worktree once the
         stamp passed AB_STALE_MS, on a pid-reuse argument. */
      const liveId = 'head-' + abRunId() + '-alive';
      const liveDir = path.join(AB_HOME, liveId);
      addWorktree(liveDir, 'HEAD', ['public/src']);
      fs.writeFileSync(path.join(AB_HOME, liveId + '.owner.json'),
        JSON.stringify({ pid: owner.pid, started: Date.now() - 24 * 3600 * 1000, dir: liveDir }));
      const listWithDead = worktreePaths();
      const dropMark12b = WORKTREES_DROPPED.length;
      const reaped = reapStaleWorktrees();
      const listAfterReap = worktreePaths();
      const droppedHere = WORKTREES_DROPPED.slice(dropMark12b);
      const deadGone = !fs.existsSync(deadDir) && !listAfterReap.includes(normWt(deadDir));
      const liveKept = fs.existsSync(liveDir) && listAfterReap.includes(normWt(liveDir));
      /* the reaper's own sweep boundary: it may only ever touch AB_HOME and the
         two legacy fixed names, so nothing outside them can be in the list of
         directories this reap actually removed. */
      const legacy = [normWt(path.resolve(REPO, '..', 'head-ab')), normWt(path.resolve(REPO, '..', 'base-ab'))];
      const inSweep = (p) => p.indexOf(normWt(AB_HOME) + '/') === 0 || legacy.includes(p);
      const sweptOutside = droppedHere.filter(p => !inSweep(p));
      const foreignReaped = reaped.filter(r => normWt(r.dir) !== normWt(deadDir));
      console.log('(12b) a killed run\'s leftover vs a LIVE owner (pid ' + owner.pid + ', a DIFFERENT'
        + ' process) 24 h old:  dead reaped=' + deadGone + '  live kept=' + liveKept
        + '  (' + listWithDead.length + ' → ' + listAfterReap.length + ' entries; the count is'
        + ' machine-global and is NOT what is asserted)');
      console.log('     reaped=' + JSON.stringify(reaped.map(r => path.basename(r.dir) + ':' + r.why))
        + '  skipped=' + JSON.stringify((reaped.skipped || []).map(r => path.basename(r.dir) + ':' + r.why)));
      console.log('     of those, ' + foreignReaped.length + ' belonged to ANOTHER agent'
        + (foreignReaped.length ? ' — ' + JSON.stringify(foreignReaped.map(r => path.basename(r.dir) + ':' + r.why))
             + ', which is the reaper working and is EVIDENCE here, never a failure'
           : ' (a quiet machine)')
        + '.  directories this reap removed: ' + JSON.stringify(droppedHere.map(p => p.split('/').pop()))
        + ', none outside its sweep=' + (sweptOutside.length === 0));
      ok(deadGone && reaped.some(r => normWt(r.dir) === normWt(deadDir)) && sweptOutside.length === 0,
         'a worktree whose owner process is gone is reaped by the next run, not left to block it —'
         + ' and the reap touched nothing outside ' + AB_HOME,
         'deadGone=' + deadGone + ' outsideSweep=' + JSON.stringify(sweptOutside));
      ok(liveKept && (reaped.skipped || []).some(r => normWt(r.dir) === normWt(liveDir))
         && !droppedHere.includes(normWt(liveDir)),
         'a worktree whose owner is ALIVE — and is somebody ELSE\'s process (pid ' + owner.pid + ') —'
         + ' is left alone at any age: taking one mid-run is how a colleague gets a wrong number,'
         + ' and the paths are per-run so a stale one blocks nobody',
         'liveKept=' + liveKept + ' skipped='
         + JSON.stringify((reaped.skipped || []).map(r => path.basename(r.dir))));
      /* clean up the live-owner fixture ourselves: by design the reaper won't. */
      try { owner.kill(); } catch (e) {}
      dropWorktree(liveDir);
      try { fs.unlinkSync(path.join(AB_HOME, liveId + '.owner.json')); } catch (e) {}
    } finally { for (const f of [drv, drvAsym, runner]) { try { fs.unlinkSync(f); } catch (e) {} } }
  }

  console.log(fails ? '\nFORGE HARNESS: ' + fails + ' FAIL' : '\nFORGE HARNESS: all checks passed');
  process.exit(fails ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mut = process.argv.find(a => a.indexOf('--mutant') === 0);
  if (mut) {
    _runOneMutant((mut.split('=')[1] || '').trim())
      .catch(e => { console.error('MUTANT RUN CRASHED\n' + (e && e.stack || e)); process.exit(2); });
  } else {
    _selfCheck().catch(e => { console.error('SELF-CHECK CRASHED\n' + (e && e.stack || e)); process.exit(2); });
  }
}
