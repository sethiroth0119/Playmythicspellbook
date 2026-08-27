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
     window.__mk.selftest()                               # browser console

   Exit code is 1 when anything FAILs (and, with --strict, when anything WARNs).
   That is the point: it is meant to be usable as a gate, not as a suggestion.

   ── WHAT IT CHECKS ───────────────────────────────────────────────────────
     1  DEAD EXPORTS        an export no other module names.        (rounds 1, 5)
     2  ECON KEYS           declared-and-never-read, and the inverse —
                            READ-AND-NEVER-DECLARED, which evaluates to
                            `undefined` in total silence.           (rounds 3, 5)
     3  COMPUTED, NEVER READ  state fields written and never read back;
                            action-result keys nothing outside the producing
                            file ever touches.                      (rounds 3, 4)
     4  CONTRACT DRIFT      §1 signatures vs the real ones, §1's id vocabulary
                            vs the real ids, §6's closed event set vs what is
                            actually emitted, §7's bridge table vs the bridge
                            index.html actually builds.             (round 5)
     5  COMMENT LIES        the specific, checkable forms this codebase uses.
     6  RESERVED PAYLOAD KEYS  `name` and `t` in an event payload, which
                            silently overwrite the event name (CONTRACT §6).

   ── 🔴 WHAT IT CANNOT CATCH, STATED HONESTLY ─────────────────────────────
   A check that produces false confidence is worse than no check at all, so
   here is the boundary, and it is not narrow:

   • **It cannot read English.** Check 5 handles four mechanical shapes: a
     present-tense "nothing/nobody calls X" claim, an "X is called by <file>"
     claim, a comment naming an `ECON.KEY`, and a `file.js:1234` citation. A
     comment that argues a WRONG DESIGN in fluent prose — round 5's three
     comments arguing the opposite of the shipped numbers — sails straight
     past. Only a human reading the file catches that one.
   • **It is textual, not semantic.** A call site reached through a computed
     name (`State[verb]()`), a re-export, or a string dispatched through a
     table is invisible to it. Conversely, a symbol named ONLY in dead code —
     inside a branch that can never be true, or behind a listener that is never
     wired — counts as "used". Round 1's `serveCar` would be caught; a
     `serveCar` wired to a button that `paint()` never renders would NOT.
   • **"Referenced" ≠ "reachable".** This is the honest limit of the whole
     tool. It proves a name is mentioned somewhere. It does not run the game.
     CONTRACT §11's demand — run the path end to end and print what the PLAYER
     receives — is still the real bar. This file only closes the cheap half.
   • **It ignores itself.** kitchen.selftest.js is deliberately NOT counted as
     a consumer of anything. A symbol used only by the self-test is still dead
     to the player, and a test that keeps its own subject alive is a lie.
   • In the browser it skips the index.html checks (11.6 MB is not worth
     fetching to run a grep) and says SKIP rather than passing them silently.

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

   Two of those runs found bugs in THIS FILE rather than in the repo — the
   state-field check was matching its own assignments and had been quietly
   finding nothing at all, and the §1 section slicer was inventing a finding out
   of §2. Both are commented at the fix. If you add a check, injure the code on
   purpose and watch it scream before you believe it.

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
        if (UBIQUITOUS.has(k)) continue;
        let seen = false;
        for (const { f: other, c } of allCode) {
          if (other === f) continue;
          if (new RegExp('\\.\\s*' + k + '\\b').test(c)) { seen = true; break; }
          if (new RegExp('\\{[^{}]*\\b' + k + '\\b[^{}]*\\}\\s*=').test(c)) { seen = true; break; }
        }
        if (!seen) {
          F.warn('COMPUTED, NEVER READ', f + ':' + lineAt(code, m.index),
            fnName + '() returns `' + k + '` and NO OTHER FILE reads `.' + k + '`.',
            'Round 3 shape: computed on every call, drawn by nobody. Heuristic — a caller forwarding the whole object would not be seen.');
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
  ['DEAD EXPORTS', checkDeadExports],
  ['ECON KEYS', checkEcon],
  ['COMPUTED, NEVER READ', checkComputedNeverRead],
  ['CONTRACT DRIFT', checkContract],
  ['COMMENT LIES', checkCommentLies],
  ['RESERVED PAYLOAD KEYS', checkReservedPayload],
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
    try { fn(W, F); }
    catch (e) {
      F.fail(name, '(the check itself)', 'The check threw: ' + (e && e.message) + '. Treat this as unchecked, not as clean.');
    }
  }

  const text = format(F.rows, W, o);
  if (!o.quiet) log(text);
  const fail = F.rows.filter(r => r.sev === 'FAIL').length;
  const warn = F.rows.filter(r => r.sev === 'WARN').length;
  return { ok: fail === 0 && (!o.strict || warn === 0), fail, warn, rows: F.rows, text };
}

function log(text) {
  try { (typeof console !== 'undefined') && console.log(text); } catch (e) {}
}

function format(rows, W, o) {
  const L = [];
  const bar = '─'.repeat(74);
  L.push('');
  L.push('🔬 MYTHIC KITCHEN SELF-TEST');
  L.push('   ' + (IS_NODE ? 'node' : 'browser') + ' · ' + MODULES.filter(f => W.code[f]).length + '/' + MODULES.length + ' modules read · '
    + MODULES.filter(f => W.ns[f]).length + ' imported live');
  L.push('   It proves a name is MENTIONED. It does not prove the player can reach it.');
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
  if (zeroCall.length || noKey.length || deadKey.length) {
    L.push('🔴 HEADLINE — the two shapes that have actually shipped, six rounds running');
    if (zeroCall.length) L.push('   ' + zeroCall.length + ' export(s) with ZERO call sites (FAIL + the console-tool WARNs): ' + zeroCall.map(nm).join(', '));
    if (noKey.length) L.push('   ' + noKey.length + ' ECON key(s) READ but never declared — the number lives outside the ECON table: ' + noKey.map(nm).join(', '));
    if (deadKey.length) L.push('   ' + deadKey.length + ' ECON key(s) declared and read by nothing: ' + deadKey.map(nm).join(', '));
    L.push('');
  }

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
  L.push('SUMMARY   ' + fail + ' FAIL   ' + warn + ' WARN   ' + skip + ' SKIP'
    + (fail ? '   → this is the round-6 bug, again.' : (warn ? '   → nothing fatal; read the warnings.' : '   → clean.')));
  L.push(bar);
  L.push('SKIP is not a pass. Anything listed as SKIP was NOT checked.');
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
        quiet: argv.includes('--json'),
      });
      if (argv.includes('--json')) console.log(JSON.stringify({ ok: res.ok, fail: res.fail, warn: res.warn, rows: res.rows }, null, 2));
      process.exit(res.ok ? 0 : 1);
    }
  } catch (e) {
    console.error('🔬 self-test runner failed —', e);
    process.exit(2);
  }
}

export default selftest;
