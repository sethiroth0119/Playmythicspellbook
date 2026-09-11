/* 🧾 THE FORGE SAVE PATH KEEPS WHAT IT WAS GIVEN (v121v76).

   captureEditorIntoCard() is the only way a card definition gets written. It
   reads the editor DOM by id — `v('ed-name')`, `num('ed-ig-chance', 1, 100, 100)`
   — and 140 of those reads end in a LITERAL fallback. A literal fallback is
   not a default; it is what the card BECOMES when the field is not on screen:

       num('ed-ig-chance', 1, 100, 100)   field gone → the card's chance becomes 100
       num('ed-onplay-amount', 0, 200, 6) field gone → the card's amount becomes 6
       _wc('ed-wall-attack', true)        field gone → the wall can attack again

   Nothing throws, nothing logs. saveCardFromInputs() then pushes the damaged
   definition to the cloud immediately (index.html:152231-152245), so every
   owner of that card gets the rewritten version. A layout change in the Forge
   that drops one field from the markup — which is exactly what a remodel does —
   is therefore silent, permanent data loss on the next Save.

   ⚠ THE NUMBER 140 IN THE PARAGRAPH ABOVE IS ASSERTED, NOT WRITTEN DOWN.
   The header of the previous revision claimed 83 literal-fallback num() reads
   while the code derived and printed 80, and nothing noticed for two months —
   a comment that drifts from its code is a lie with a long half-life. So the
   runner parses that digit back out of this file and fails if it has moved.
   Same for every other count in here: they are printed, never transcribed.

   So this suite is a contract between the two halves of the editor, and it is
   derived, never transcribed:

     HALF A — every string-literal id and every CSS selector the save path reads
       is lifted OUT OF THE RUNNING SOURCE at run time and must be findable in
       the markup renderCardEditor() actually produces, across the whole card-type
       matrix. Nothing here is a hand-written list of ids; a list would rot.

       🔴 The id derivation does NOT know a fixed set of read forms. The three
       the editor's convention names — v( , num( , getElementById( — accounted
       for 380 of the 460 ids; the other 80 arrive through helpers the save path
       defines for itself (_wc, _pc, _pv, _n, _v, _ck, _rc, _rv, _zcOn, _zcName,
       numOrNull, _readCardFilterFrom, _readMultiSelectValues, _readSearchPickRule
       and the selector-composing _readPolyMatSources). A revision of this file
       that hard-coded those fourteen id helpers would rot on the fifteenth,
       which is the same bug class this paragraph opens with. So each helper is
       LIFTED and CLASSIFIED by where its first parameter flows — into
       getElementById (an id read, with whatever suffix it appends) or into
       querySelector (a selector read) — and any call site in the save path that
       passes an editor-shaped literal to a form the classifier could not place
       is a FAIL, not a silent gap. The per-form counts are printed for the same
       reason.

       🔴 And coverage is PER CARD TYPE, not the union of eleven renderings.
       A union Set could not see ed-ig-chance renamed in the TRAP markup alone,
       because the unit markup had already ticked it off. Modelling
       captureEditorIntoCard's guards statically to fix that was tried and
       rejected: `if (igTrig && igEff)`, `if (_ctokOn && _ctokOn.checked)`,
       `card.type === 'counter' || _isCounterUnitSave` — a static model of those
       is a second implementation of the function that can be wrong in silence,
       which is the thing this file refuses to do. So the function is
       INSTRUMENTED (every id read wrapped in a recorder) and RUN once per card
       type against that type's real editor, and whatever it read there must be
       on that type's screen. Ground truth, no model.

     HALF B — the one that matters. Real cards are loaded into
       renderCardEditor() → bindCardEditor() → captureEditorIntoCard() and saved
       with ZERO user input. The card that comes out must be IDENTICAL to the
       card that went in. This is the only check that can catch a literal
       fallback quietly overwriting a live definition, because it compares
       values, not ids.

       🔴 A round trip can only SEE a dropped field if the card is holding a
       value the field's absence would not produce. The previous revision typed
       into input[type=number] and nothing else — 163 of the 190 inputs on a
       unit — so a dropped <select> or checkbox whose value happened to equal
       the code's fallback round-tripped through the bug unchanged, and a
       dropped ed-grave-chance printed ALL-IDENTICAL 153/153 at exit 0 because
       no pool card stores graveAbility at all. Now every input kind is moved,
       each one AWAY FROM ITS OWN DERIVED FALLBACK, which also turns the gated
       blocks on so their fields are stored in the first place. Half A then
       removes each rendered field in turn, saves, and compares — so the report
       says which fields a drop can actually be seen through and NAMES the ones
       it cannot, instead of counting absences and calling them coverage.

   🔴 WHY THIS ONE BOOTS A BROWSER when every other suite here uses `vm`.
   renderCardEditor() emits ~500 KB of markup per card and bindCardEditor()
   RE-PARENTS it (the nine ability drawers at index.html:150550-150605 are built
   after render by moving DOM nodes). A hand-rolled DOM shim that quietly does
   nothing would make Half B pass while proving nothing — the exact failure this
   file exists to prevent. Chromium is already a devDependency (see
   crit-harness.mjs) and the whole run is ~35 s. The page is served from a local
   http server and EVERY off-origin request is aborted: this gate never touches
   Supabase.

   Run: node _forgeids_smoke.mjs
        node _forgeids_smoke.mjs --list            ← the named mutants
        node _forgeids_smoke.mjs --selftest        ← proves the gate can fail (exit 0 when it can)
        node _forgeids_smoke.mjs --selftest=NAME   ← one named mutant
        node _forgeids_smoke.mjs --mutate=NAME     ← the GATE with that mutant injected:
                                                     its own FAIL lines, non-zero exit
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGV = process.argv.slice(2);
const SELFTEST = ARGV.some(a => a === '--selftest' || a.startsWith('--selftest='));
const ONLY = (ARGV.find(a => a.startsWith('--selftest=')) || '').split('=')[1] || '';
/* --mutate=NAME runs the GATE with one mutant injected and reports normally, so
   the FAIL lines and the non-zero exit are the gate's own and not a self-test's
   opinion of them. --selftest=NAME asserts that this happened and exits 0. */
const MUTATE = (ARGV.find(a => a.startsWith('--mutate=')) || '').split('=')[1] || '';
const LIST = ARGV.includes('--list');
let fails = 0;
/* The self-test re-runs the REAL reporting code and reads back the lines it
   printed, rather than re-deriving the verdict a second way — a self-test that
   checks its own copy of the logic proves nothing about the gate. So every line
   goes through one sink, and `captured()` borrows it. */
let SINK = null;
const emit = (s) => { if (SINK) SINK.push(s); else console.log(s); };
const ok = (c, m, x) => { emit((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c && !SINK) fails++; return !!c; };
const line = (s) => emit(s);
const note = (m) => emit('  note  ' + m);
async function captured(fn) { SINK = []; try { await fn(); } catch (e) { SINK.push('  FAIL threw: ' + e.message); } const out = SINK; SINK = null; return out; }

/* Relative to THIS file, not to the cwd: the suite is run both from the repo
   root (npm run check) and by hand from wherever. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, 'public');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SELF = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');

/* The async-aware function lifter. The naive indexOf('function ' + name + '(')
   DROPS a leading `async`, which then dies at parse time and reads as a CRASH
   with zero FAIL lines. Half A cross-checks what this returns against the
   function's own toString() in the browser, so a lifter that silently returns
   the wrong text cannot pass. */
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
  throw new Error('unbalanced braces lifting ' + name);
}

/* ── what the save path reads, derived from the source at run time ────────── */

/* The whole save path, not just captureEditorIntoCard: it delegates the rows
   that have no id of their own to these helpers, and those class hooks are
   invisible to the id convention. */
const SOURCES = ['captureEditorIntoCard', 'readEditorLearnset', 'readEditorElemMods', 'captureSubclassesFromDOM', '_fxCaptureAllFilters'];
const TEXT = {}; for (const n of SOURCES) TEXT[n] = fnText(n);
const CAP = TEXT.captureEditorIntoCard;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* All three quote forms. The previous revision swept single quotes only, which
   is why the backtick-quoted `[data-sub-faction]` in captureSubclassesFromDOM
   was missing from the css hooks it claimed to have derived. */
const LIT3 = "(?:'([^']*)'|\"([^\"]*)\"|`([^`]*)`)";
const LEAD = /^(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/;
const pick3 = (m, i) => (m[i] !== undefined ? m[i] : m[i + 1] !== undefined ? m[i + 1] : m[i + 2]);
/* Selector-shaped, and shaped tightly enough that console.warn('[filter-sweep]')
   is not mistaken for an attribute selector. */
const SEL_SHAPED = (s) => /^[.#][A-Za-z_][\w-]*/.test(s) || /^\[[A-Za-z_:-][\w:.-]*(?:[~|^$*]?=\s*(?:"[^"]*"|'[^']*'|[\w-]+))?\](?::[a-z-]+)?(?:\s|$|[.#[])/.test(s);

/* A balanced argument list, so `num('ed-x', 1, 2, card.stats.hp || 20)` yields
   its four arguments and not a regex's guess at them. */
function argsAt(t, openParen) {
  let d = 0, out = [], cur = '', q = null;
  for (let i = openParen; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '\\') { cur += c + t[++i]; continue; } if (c === q) q = null; cur += c; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { d++; if (d === 1 && c === '(') continue; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { d--; if (d === 0 && c === ')') { out.push(cur); return { args: out.map(s => s.trim()), end: i + 1 }; } cur += c; continue; }
    if (c === ',' && d === 1) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  return null;
}

/* Every `NAME('literal' …)` call site in a function, whatever NAME is. The
   receiver is kept so console.* can be excluded by name rather than by luck. */
function callsites(t, who) {
  const out = []; const re = /([A-Za-z_$][\w$]*)\s*\(/g; let m;
  while ((m = re.exec(t))) {
    const before = t[m.index - 1] || '';
    if (/[\w$]/.test(before)) continue;                       // tail of a longer identifier
    let recv = '';
    if (before === '.') { let z = m.index - 1; while (z > 0 && /[\w$]/.test(t[z - 1])) z--; recv = t.slice(z, m.index - 1); }
    const op = m.index + m[0].length - 1;
    const a = argsAt(t, op); if (!a || !a.args.length) continue;
    const lm = LEAD.exec(a.args[0]); if (!lm) continue;
    out.push({ fn: m[1], recv, lit: (lm[1] !== undefined ? lm[1] : lm[2] !== undefined ? lm[2] : lm[3]), args: a.args, who, at: m.index, end: a.end, staticLit: a.args[0] === lm[0] });
  }
  return out;
}

/* A helper defined as a local arrow inside one of the save-path functions. */
function localArrows(scope, name) {
  const outs = []; const re = new RegExp('(?:const|let|var)\\s+' + esc(name) + '\\s*=\\s*\\(([^)]*)\\)\\s*=>', 'g'); let m;
  while ((m = re.exec(scope))) {
    const params = m[1].split(',').map(s => s.trim()).filter(Boolean);
    let k = re.lastIndex; while (/\s/.test(scope[k])) k++;
    let body = '';
    if (scope[k] === '{') { let d = 0; for (let z = k; z < scope.length; z++) { if (scope[z] === '{') d++; else if (scope[z] === '}') { d--; if (!d) { body = scope.slice(k, z + 1); break; } } } }
    else { let d = 0, z = k; for (; z < scope.length; z++) { const c = scope[z]; if (c === '(') d++; else if (c === ')') { if (!d) break; d--; } else if ((c === ';' || c === '\n') && !d) break; } body = scope.slice(k, z); }
    outs.push({ params, body, src: '(' + m[1] + ') => ' + body });
  }
  return outs;
}

/* 🔴 THE READ-FORM CLASSIFIER. Not a list of helper names — a question asked of
   each helper's own source: where does its FIRST PARAMETER end up?
     · in getElementById(p) or getElementById(p + '-suffix')  → an id read
     · in querySelector(p)                                     → a selector read
     · concatenated into a '[data-x="' + p + '"]' selector      → a selector composer
   Resolution is scope-aware (the `g`/`val` inside _readCardFilterFrom are ITS
   locals, not captureEditorIntoCard's) and follows one helper into the next, so
   _readCardFilterFrom('ed-onplay') expands to the seven ids it really reads. */
const BUILTIN = {
  getElementById: { kind: 'id', sufs: [''], selc: [], builtin: true, src: '' },
  querySelector: { kind: 'sel', builtin: true }, querySelectorAll: { kind: 'sel', builtin: true },
  closest: { kind: 'sel', builtin: true }, matches: { kind: 'sel', builtin: true },
};
const clsMemo = new Map();
function classify(name, scope, depth = 0) {
  if (BUILTIN[name]) return BUILTIN[name];
  if (depth > 5) return null;
  const key = name + '@' + scope.length + ':' + scope.slice(0, 48);
  if (clsMemo.has(key)) return clsMemo.get(key);
  clsMemo.set(key, null);                                     // recursion guard
  let defs = localArrows(scope, name), own = scope;
  if (!defs.length) {
    try { const g = fnText(name); const a = argsAt(g, g.indexOf('(')); defs = [{ params: a.args, body: g.slice(g.indexOf('{')), src: g }]; own = g; }
    catch (e) { clsMemo.set(key, null); return null; }
  }
  const results = [];
  for (const d of defs) {
    const p = d.params[0]; if (!p) continue;
    const P = esc(p), sufs = new Set(); let kind = null, m;
    const callRe = new RegExp('([A-Za-z_$][\\w$]*)\\s*\\(\\s*' + P + '\\s*(?:\\+\\s*' + LIT3 + ')?\\s*[,)]', 'g');
    while ((m = callRe.exec(d.body))) {
      const callee = m[1], suf = pick3(m, 2);
      const k = classify(callee, localArrows(d.body, callee).length ? d.body : own, depth + 1);
      if (!k) continue;
      if (k.kind === 'id') { kind = kind || 'id'; for (const s of (k.sufs && k.sufs.length ? k.sufs : [''])) sufs.add((suf === undefined ? '' : suf) + s); }
      else if (k.kind === 'sel' && suf === undefined) kind = kind || 'sel';
    }
    const selc = []; const scRe = new RegExp(LIT3 + '\\s*\\+\\s*' + P, 'g');
    while ((m = scRe.exec(d.body))) selc.push(pick3(m, 1));
    if (!kind && selc.length) kind = 'selcompose';
    if (kind) results.push({ kind, sufs: [...sufs], selc, src: d.src, params: d.params });
  }
  const out = results.length ? results[0] : null;
  clsMemo.set(key, out); return out;
}

const SITES = []; for (const n of SOURCES) SITES.push(...callsites(TEXT[n], n));
const idOf = new Map(), selOf = new Map(), formIds = new Map(), formSels = new Map();
const dynPrefixes = new Set(), unattributed = [];
/* An editor-shaped literal handed to a read form the classifier could not place
   is the failure mode this rewrite exists to remove: it must be loud. */
const EDITORISH = (s) => /^(?:ed-|fx-)[a-z0-9]/i.test(s);
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
for (const c of SITES) {
  const k = classify(c.fn, TEXT[c.who]);
  if (!k) {
    if (c.recv === 'console') continue;                       // console.warn('[filter-sweep]') is not a selector
    if (EDITORISH(c.lit) || SEL_SHAPED(c.lit)) unattributed.push(c.fn + "('" + c.lit + "') in " + c.who + '()');
    continue;
  }
  if (SEL_SHAPED(c.lit) || k.kind === 'sel') { if (!selOf.has(c.lit)) selOf.set(c.lit, c.who); bump(formSels, c.fn); continue; }
  if (k.kind === 'selcompose') { for (const p of k.selc) { const s = p + c.lit + '"]'; if (!selOf.has(s)) selOf.set(s, c.who); bump(formSels, c.fn); } continue; }
  if (k.kind !== 'id') continue;
  /* `num('ed-onplayx-' + i + '-amount', …)` — a computed id. The literal is a
     PREFIX, not an id; counted separately and reported, never asserted. */
  if (!c.staticLit) { dynPrefixes.add(c.lit); continue; }
  for (const s of (k.sufs.length ? k.sufs : [''])) { const id = c.lit + s; if (!idOf.has(id)) idOf.set(id, { who: c.who, form: c.fn }); }
  bump(formIds, c.fn);
}
const IDS = [...idOf.keys()], SELS = [...selOf.keys()];

/* 🔴 THE DANGEROUS SUBSET, measured rather than pattern-matched. For every call
   site whose arguments after the id are all constants, the helper is rebuilt in
   a sandbox whose document has NO elements and CALLED — so the recorded value is
   literally "what the card becomes when the field is not on screen", for every
   read form at once, instead of a regex that only understood num()'s 4th
   argument. A card-derived fallback (`num('ed-hp', 1, 200, card.stats.hp || 20)`)
   is not a constant and is skipped: it keeps the card's own value. null and
   undefined are skipped too — those are the absence sentinels the guards test. */
const CONSTARG = /^(?:-?[\d.]+|true|false|null|'[^']*'|"[^"]*"|`[^`]*`)$/s;
const LITERAL_FB = new Map();
const fbUnevaluable = [];
{
  const cache = new Map();
  const mk = (name, scope) => {
    const key = name + '@' + scope.length;
    if (cache.has(key)) return cache.get(key);
    const k = classify(name, scope); let f = null;
    if (k && k.src) {
      /* the helper's own dependencies, lifted the same way it was */
      const deps = [];
      for (const d of ['v', '_v', 'g', 'val', 'num', '_readMultiSelectValues']) {
        if (d === name) continue;
        const kk = classify(d, k.src.startsWith('function') ? k.src : scope);
        if (kk && kk.kind === 'id' && kk.src) deps.push('var ' + d + ' = ' + kk.src + ';');
      }
      const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
      try { f = new Function('document', deps.join('\n') + '\nreturn (' + k.src + ');')(doc); } catch (e) { f = null; }
    }
    cache.set(key, f); return f;
  };
  for (const c of SITES) {
    const k = classify(c.fn, TEXT[c.who]);
    if (!k || k.kind !== 'id' || !c.staticLit) continue;
    /* getElementById is the sink, not a read form with a fallback: it hands back
       the element or null, and null is the absence sentinel the guards test. */
    if (k.builtin) continue;
    const rest = c.args.slice(1);
    if (!rest.every(a => CONSTARG.test(a))) continue;
    const f = mk(c.fn, TEXT[c.who]);
    if (!f) { fbUnevaluable.push(c.fn); continue; }
    let val;
    try { val = f('__forge_absent_id__', ...rest.map(a => JSON.parse(a.replace(/^'([\s\S]*)'$/, '"$1"').replace(/^`([\s\S]*)`$/, '"$1"')))); }
    catch (e) { fbUnevaluable.push(c.fn + ': ' + e.message); continue; }
    if (val === null || val === undefined) continue;
    for (const s of (k.sufs.length ? k.sufs : [''])) if (!LITERAL_FB.has(c.lit + s)) LITERAL_FB.set(c.lit + s, val);
  }
}

/* 🔴 WHICH READS ACTUALLY FIRE, PER CARD TYPE. The previous revision checked
   every id against the UNION of all 11 renderings through one Set, so renaming
   ed-ig-chance in the TRAP rendering alone was invisible — the unit rendering
   had already ticked it off. Modelling captureEditorIntoCard's guards statically
   was tried and is not honest: the guards are `if (igTrig && igEff)`, `if (_ctokOn
   && _ctokOn.checked)`, `card.type === 'spell' || _isCounterUnitSave`, and a
   static model of those is a second implementation that can be wrong in silence.
   So the function is INSTRUMENTED instead — each id read is wrapped in a call
   that records it — and the real thing is run once per card type. Whatever it
   read on that type must be on that type's screen. Ground truth, no model. */
const INSTRUMENTED = (() => {
  const ifTests = []; { const re = /(?:^|[^\w$.])if\s*\(/g; let m;
    while ((m = re.exec(CAP))) { const op = m.index + m[0].length - 1; const a = argsAt(CAP, op); if (a) ifTests.push({ test: a.args.join(','), from: op, to: a.end }); } }
  /* 🔴 `const V = document.getElementById('X')` is a PRESENCE HANDLE, not a value
     read: what happens next is `if (V)` or `V ? V.value : …`, so X's absence is
     something the code is looking at rather than something it walks into. Those
     sites are excluded — with the exact character offset of the getElementById
     token, not a window around the declaration, because
     `const secondary = document.getElementById('ed-element2') ? v('ed-element2') : ''`
     puts a REAL value read on the same line and a sloppy window swallowed it
     (that read WAS the one and only per-type hole this suite ever found; it is
     fixed now — see KNOWN_TYPE_HOLES — and is kept here because it is still the
     shape of read the exclusion has to get right).
     ⚠ The cost of the exclusion, stated: a field read ONLY through such a handle
     — ed-counter-effect / -window / -amount / -duration, whose fallbacks
     'negate' / 15 / 1 / 'once' are written when the element is missing — is
     outside the per-type check. Half B still covers them by value. */
  const handleAt = new Set(); { const re = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(document\.getElementById\(\s*'[^']+'\s*\))(\s*[?;,])/g; let m;
    while ((m = re.exec(CAP))) if (m[2].trim() !== '?') handleAt.add(m.index + m[0].indexOf(m[1])); }
  const marks = [];
  for (const c of callsites(CAP, 'captureEditorIntoCard')) {
    const k = classify(c.fn, CAP);
    if (!k || k.kind !== 'id' || !c.staticLit || SEL_SHAPED(c.lit)) continue;
    if (ifTests.some(b => c.at > b.from && c.at < b.to)) continue;                    // the read IS the presence test
    let tokAt = c.at; { let z = c.at; while (z > 0 && CAP[z - 1] === '.') { let y = z - 1; while (y > 0 && /[\w$]/.test(CAP[y - 1])) y--; z = y; } tokAt = z; }
    if (handleAt.has(tokAt)) continue;
    marks.push({ start: tokAt, end: c.end, ids: (k.sufs.length ? k.sufs : ['']).map(s => c.lit + s) });
  }
  marks.sort((a, b) => b.start - a.start);
  let s = CAP;
  for (const m of marks) s = s.slice(0, m.start) + '(__forgeHit(' + JSON.stringify(m.ids) + '), ' + s.slice(m.start, m.end) + ')' + s.slice(m.end);
  return { src: s, nMarks: marks.length, nHandles: handleAt.size };
})();

/* 🔴 KNOWN HOLES — ids the save path reads that the editor does NOT render.
   This is a baseline, not permission: each entry says what it costs today.
   `live` means the read is NOT guarded by the missing id itself, so its absence
   writes the literal into the card; `inert` means the only read sits behind
   `if (document.getElementById('<that same id>'))` and therefore does nothing.
   The classification is DERIVED below and checked against these claims, so an
   entry cannot quietly become dangerous. Fix a hole → delete its line here in
   the same commit. Never add a line to make a run pass. */
const KNOWN_HOLES = [
  { id: 'ed-hand-effects', live: false,
    why: 'the Hand Effects field was deleted in v119i8; the read is guarded by `if (v(...) != null)` so old cards keep their handEffects until edited' },
  { id: 'ed-traitpool', live: false,
    why: 'the inline trait checkboxes were replaced by the trait-pool MODAL (renderTraitPoolModal, data-trait-toggle); the read is guarded by its own id so card.traitPool is never wiped' },
  /* ✅ ed-playreq-mincost was the third entry and was the LIVE one: the editor
     rendered no field, so `num('ed-playreq-mincost', 0, 20, 0)` forced every
     vanishUnit card's minCost to 0 on save. Both halves are fixed — the control
     is rendered (index.html:147513) AND the fallback is now card-derived — so
     the line is gone rather than re-worded. `node _forgesave_proof.mjs
     --check=vanish-mincost` is the card-level proof. */
];

/* 🔴 KNOWN PER-TYPE HOLES — the id IS rendered, but not on every card type the
   save path reads it on. Invisible to the union check by construction; this
   list is what the per-type sweep found on the build it was written against.
   Same discipline as KNOWN_HOLES: fixing one means deleting its line. */
/* ✅ EMPTY, AND THAT IS THE POINT. It held one entry — ed-element2 on spell:
   the spell editor rendered no Secondary Element control, so the save path's
   probe found nothing and wrote card.elements = [primary], dropping a
   two-element spell's second element on every save. The spell block now renders
   the control (index.html:145975) and the capture keeps the card's own extra
   elements when the control is absent on the other screens, so the per-type
   sweep finds nothing on any of the 11 types. `node _forgesave_proof.mjs
   --check=two-element-spell` is the card-level proof. Do not add a line here to
   make a run pass — an entry means a card type is losing data today. */
const KNOWN_TYPE_HOLES = [
];

/* 🔴 BLIND SPOTS — literal-fallback fields that ARE rendered, but whose removal
   changes nothing in the saved card even after this suite has moved every field
   it can off its own fallback. These are the fields a drop mutation cannot be
   seen through, and naming them is the honest version of "153/153 reopens":
   without this list, a field nothing can observe scores a perfect round trip
   and looks like coverage. Each is here because the sweep below could not move
   it away from its fallback with the probe fixture. */
const BLIND_SPOTS_WHY = 'seven multi-selects (_readMultiSelectValues → [], and the probe card owns no cards to select in them), plus the rebirth row and two singletons whose own block stays off for every probe card';
const BLIND_SPOTS = [
  'ed-grave-searchcards', 'ed-ongrave-searchcards', 'ed-hand-searchcards', 'ed-onplay-searchcards',
  'ed-onplay-summoncards', 'ed-onplay-filter-cards', 'ed-onplay-salvage-cards',
  'ed-kalon-onx-weatherdur', 'ed-kalon-onx-gturns',
  'ed-rb-max', 'ed-rb-fallback', 'ed-rb-repeat', 'ed-rb-istats', 'ed-rb-iequip', 'ed-rb-popup',
  'ed-px-range',
];

/* ── the page ─────────────────────────────────────────────────────────────── */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.glb': 'model/gltf-binary' };
async function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  /* Other agents run harnesses in this tree at the same time — take the first
     free port instead of dying on EADDRINUSE. */
  for (let port = 8820; port < 8860; port++) {
    const got = await new Promise((r) => { server.once('error', () => r(0)); server.listen(port, '127.0.0.1', () => r(port)); });
    if (got) return { server, port: got };
  }
  throw new Error('no free port in 8820-8859');
}

/* Real cards, from the two places the game actually keeps them: the built-in
   pools in index.html and the shipped content packs in public/cardsets. */
function packCards() {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'cardsets'))) {
    if (f === 'index.json' || !f.endsWith('.json')) continue;
    const arr = JSON.parse(fs.readFileSync(path.join(ROOT, 'cardsets', f), 'utf8'));
    if (!Array.isArray(arr)) continue;
    /* Pack cards carry no id (the importer assigns one) — give them a stable
       one so the editor can find them, and change nothing else. */
    arr.forEach((c, i) => out.push(Object.assign({ id: 'pack_' + f.replace(/\W+/g, '_') + '_' + i }, c)));
  }
  return out;
}

/* ── the two halves, as ONE code path used by both the gate and the self-test.
   `mut` is the mutation the self-test injects; the gate passes null. ───────── */

/* HALF A, in-page. Renders the whole card-type matrix and reports which of the
   derived ids / selectors never appear anywhere, which ones the instrumented
   capture READ on a type that does not render them, and which literal-fallback
   fields could be removed without the saved card noticing. */
const HALF_A = ({ ids, sels, fb, instr, mut }) => {
  const FB = new Map(fb);
  const host = document.createElement('div'); host.id = '__forge_probe'; document.body.appendChild(host);
  /* One rich card per type: every optional row-array populated, because the
     row hooks (.trg-row, .fusion-req-row, .archon-req-row, .elem-mod-row,
     .sub-card) only exist when the card has rows to render. */
  const rich = (t) => {
    const c = {
      id: 'probe_' + t, name: 'Probe ' + t, type: (t === 'bred' ? 'unit' : t), icon: '✦', cost: 3, rarity: 'rare', desc: 'probe',
      elements: ['fire', 'water'], factions: ['warrior'], traitPool: ['swift'],
      stats: { hp: 20, atk: 10, def: 8, mag: 8, res: 8, spd: 1 },
      learnset: [{ lvl: 1, m: 'slash' }, { lvl: 4, m: 'cleave' }],
      customEffects: { elemMods: [{ el: 'fire', mode: 'weaken', pct: 25, affects: 'both', dmgType: 'physical' }] },
      triggers: [{ id: 't0', name: 'Probe trigger', event: 'cardPlayed', effect: 'draw', amount: 2, duration: 3, chance: 55, limitPerTurn: 1, limitPerMatch: 2 }],
      fusionRequirements: [{ count: 2, type: 'element', cardId: '', zone: 'field', elements: ['fire'] }],
      archonSummon: { offerings: [{ faction: 'warrior', element: 'fire', trait: 'flying', minLevel: 3, count: 2 }] },
      isFusionTarget: true, isArchon: true,
    };
    if (t === 'bred') c.isBred = true;
    if (t === 'hero') {
      c.class = 'vanguard';
      c.subclasses = JSON.parse(JSON.stringify(SUBCLASSES.cedric));
      /* The per-subclass Kalon name/icon/passive row only renders when that
         subclass HAS a kalonForm (index.html:146334), so one of them must. */
      c.subclasses[0].kalonForm = { name: 'Probe Kalon', icon: '🌟', passive: 'none' };
    }
    return c;
  };
  const types = ['unit', 'hero', 'summon', 'spell', 'trap', 'weather', 'wall', 'location', 'counter', 'enchantment', 'bred'];
  /* 🔴 Every stale probe host must go before the next one is built. The gate
     calls this twice in a self-test run, and the ids read by the instrumented
     capture come from document.getElementById — which happily finds the
     PREVIOUS run's leftover markup while `here` is scoped to the current host.
     Leaving one behind made the trap-only rename print 694 FAIL lines about
     ids belonging to the last card type of the previous run, which is a false
     positive dressed as thoroughness. */
  const sweepStrays = () => document.querySelectorAll('#__forge_probe').forEach(el => { if (el !== host) el.remove(); });
  sweepStrays();
  const seenId = new Set(), seenSel = new Set(), perType = {}, bindErrs = [], readNotRendered = {};
  const bearing = {}, inert = {}, unmovable = new Set(), renamed = {};
  let drawersAfterBind = [];
  const DRAWERS = ['fx-g-ingrave', 'fx-g-graveab', 'fx-g-ongrave', 'fx-g-aura', 'fx-g-onatk', 'fx-g-onkill', 'fx-g-field', 'fx-g-milled', 'fx-g-hand'];

  let HITS = null;
  let capInstr = null, instrErr = '';
  try { capInstr = new Function('__forgeHit', 'return (' + instr + ');')((list) => { if (HITS) for (const i of list) HITS.add(i); }); }
  catch (e) { instrErr = 'instrumented source did not compile: ' + e.message; }

  /* Move one field OFF a target value. Used to push every literal-fallback field
     away from its fallback, so that removing it MUST change the saved card —
     the difference between measuring absence and measuring effect. */
  const away = (el, want) => {
    if (el.tagName === 'SELECT') {
      if (el.multiple) { const o = Array.from(el.options).find(o => o.value && String(o.value) !== String(want)); if (!o) return false; o.selected = true; return true; }
      const o = Array.from(el.options).find(o => o.value && String(o.value) !== String(want)); if (!o) return false; el.value = o.value; return true;
    }
    if (el.type === 'checkbox') { el.checked = !(want === true || want === 'true'); return true; }
    if (el.type === 'number') {
      const mn = el.min === '' ? -1e9 : +el.min, mx = el.max === '' ? 1e9 : +el.max, w = Number(want);
      for (const cand of [w + 1, w - 1, mn, mx, mn + 1]) if (cand >= mn && cand <= mx && cand !== w) { el.value = String(cand); return true; }
      return false;
    }
    if (el.tagName === 'TEXTAREA' || el.type === 'text') { el.value = (String(want) === 'zzprobe' ? 'yyprobe' : 'zzprobe'); return true; }
    return false;
  };

  for (const t of types) {
    const c = rich(t);
    Forge.customCards = [c]; App.editingCardId = c.id; App._traitPoolModal = false;
    let html = renderCardEditor();
    /* self-test mutation (1): rename one id in the markup the editor produced.
       `onlyType` scopes it to a single card type — the union check cannot see
       that, and it is what the per-type sweep exists for. */
    if (mut && mut.renameId && (!mut.onlyType || mut.onlyType === t)) {
      const before = html;
      html = html.split('id="' + mut.renameId + '"').join('id="' + mut.renameId + '-RENAMED"');
      renamed[t] = html !== before;
    }
    host.innerHTML = html;
    /* Recorded, never swallowed: a bind that throws leaves half the editor
       unwired and would otherwise look like a clean run. */
    try { bindCardEditor(); } catch (e) { bindErrs.push(t + ': ' + (e && e.message)); }
    const here = new Set(); host.querySelectorAll('[id]').forEach(el => here.add(el.id));
    perType[t] = ids.filter(i => here.has(i)).length;
    ids.forEach(i => { if (here.has(i)) seenId.add(i); });
    sels.forEach(s => {
      /* `:checked` is a STATE, not a hook — a fixture that ticks nothing would
         report the hook as missing. The hook itself must exist; that the ticked
         state survives a save is Half B's job. */
      const probe = s.replace(/:checked\b/g, '');
      let n = 0; try { n = host.querySelectorAll(probe).length; } catch (e) { n = 0; }
      if (n) seenSel.add(s);
    });
    if (t === 'unit') drawersAfterBind = DRAWERS.filter(d => !!document.getElementById(d));

    /* Open every gated block, then push every literal-fallback field off its
       own fallback. Without the first step most reads never fire; without the
       second, removing a field whose value already equals its fallback is a
       no-op and the sweep would report coverage it does not have. */
    host.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
    host.querySelectorAll('select').forEach(s => { const v = s.value; if (!v || v === 'none' || v === 'any') { const o = Array.from(s.options).find(o => o.value && o.value !== 'none' && o.value !== 'any'); if (o) s.value = o.value; } });
    for (const [id, want] of FB) { const el = host.querySelector('[id="' + (id + '').replace(/"/g, '') + '"]'); if (el && !away(el, want)) unmovable.add(id); }

    if (capInstr) {
      HITS = new Set();
      try { capInstr(JSON.parse(JSON.stringify(c))); } catch (e) { bindErrs.push(t + ' instrumented capture: ' + (e && e.message)); }
      readNotRendered[t] = [...HITS].filter(i => !here.has(i));
      HITS = null;
    }

    /* THE DAMAGE SWEEP. Remove one field, save, put it back, and compare. This
       is the only thing that can say "a drop of this field is observable" —
       counting that a field is absent says nothing about whether anyone noticed. */
    const cap = (card) => { const o = JSON.parse(JSON.stringify(card)); captureEditorIntoCard(o); delete o._editedAt; return JSON.stringify(o); };
    let base = null; try { base = cap(c); } catch (e) { bindErrs.push(t + ' capture: ' + (e && e.message)); }
    bearing[t] = []; inert[t] = [];
    if (base !== null) {
      for (const id of ids) {
        const el = host.querySelector('[id="' + id.replace(/"/g, '') + '"]'); if (!el) continue;
        const par = el.parentNode, nx = el.nextSibling;
        el.remove();
        let got; try { got = cap(c); } catch (e) { got = 'THREW ' + e.message; }
        par.insertBefore(el, nx);
        (got === base ? inert[t] : bearing[t]).push(id);
      }
    }
  }
  return {
    missingIds: ids.filter(i => !seenId.has(i)),
    missingSels: sels.filter(s => !seenSel.has(s)),
    perType, drawersAfterBind, drawersWanted: DRAWERS, bindErrs,
    readNotRendered, bearing, inert, unmovable: [...unmovable], instrErr, renamed,
  };
};

/* HALF B, in-page. The no-op round trip. */
const HALF_B = ({ packs, fb, mut }) => {
  const FB = new Map(fb);
  const host = document.getElementById('__forge_probe') || document.body.appendChild(document.createElement('div'));
  host.id = '__forge_probe';
  /* self-test mutation (2): the layout change this suite exists to catch — one
     field is gone from the editor when the card is reopened.
     🔴 It is armed only for the FINAL cycle, because that is the real
     sequence: cards were saved while the field existed, THEN the field went
     away, and the next save is what destroys them. Arming it for every cycle
     would damage the fixture as well and the round trip would look clean.
     🔴 It removes the ELEMENT from the bound DOM, not a regex match in the
     markup. The previous revision used /<input id="X"[^>]*>/, which requires id
     to be the first attribute and therefore silently removed NOTHING from a
     <select> or a checkbox — a maintainer repointing it at one got a green run
     off a mutation that never happened. `dropRemoved` below counts what was
     really taken out, and the self-test asserts it. */
  let DROP = null, dropPresent = 0, dropRemoved = 0, dropTag = '';
  const pool = [];
  const add = (arr, tag, fix) => (arr || []).forEach((c, i) => {
    const o = JSON.parse(JSON.stringify(c));
    pool.push(Object.assign({ id: o.id || (tag + i) }, fix ? fix(o) : o));
  });
  add(UNIT_CARDS, 'u'); add(SPELL_CARDS, 's'); add(TRAP_CARDS, 't'); add(WEATHER_CARDS, 'w');
  add(WALL_CARDS, 'wl'); add(LOCATION_CARDS, 'lo');
  /* A hero as the Forge stores one: type 'hero', hp inside stats, and the real
     subclass rows so .sub-card[data-sub-idx] is exercised. */
  add(STARTER_HEROES, 'h', (h) => Object.assign({}, h, {
    type: 'hero', stats: Object.assign({ hp: h.hp }, h.stats),
    subclasses: (typeof SUBCLASSES !== 'undefined' && SUBCLASSES[h.id]) ? JSON.parse(JSON.stringify(SUBCLASSES[h.id])) : [],
  }));
  add(packs, 'p');

  const diff = (a, b) => {
    const out = [];
    const walk = (x, y, p) => {
      const ks = new Set([...Object.keys(x || {}), ...Object.keys(y || {})]);
      for (const k of ks) {
        const u = x ? x[k] : undefined, v = y ? y[k] : undefined;
        if (u && v && typeof u === 'object' && typeof v === 'object' && Array.isArray(u) === Array.isArray(v)) walk(u, v, p + '.' + k);
        else if (JSON.stringify(u) !== JSON.stringify(v)) out.push(p + '.' + k + ': ' + JSON.stringify(u) + ' → ' + JSON.stringify(v));
      }
    };
    walk(a, b, ''); return out;
  };

  /* 🔴 THE PERTURBATION, and why it is not just number fields.
     The round trip can only see a dropped field if the card is holding a value
     that DIFFERS from what the field's absence would produce. The previous
     revision typed into input[type=number] only — 163 of the 190 inputs on a
     unit — so a dropped <select> or checkbox whose card value happened to equal
     the code's fallback round-tripped through the bug unchanged. Every kind is
     moved now, and each is moved AWAY FROM ITS OWN DERIVED FALLBACK rather than
     just to some other legal value.
     Deliberately not touched, with reasons:
       · input[type=hidden] — the *-rule fields hold JSON written by a sub-editor
         (_readSearchPickRule JSON.parses them); random text there is a parse
         failure, not an edit.
       · input[type=file]   — a file input's value cannot be set from script.
       · #ed-type           — changing it re-renders the editor as a DIFFERENT
         card type. That is a different test, not a perturbation. */
  const SKIP = new Set(['ed-type']);
  const perturb = (host) => {
    const counts = { number: 0, text: 0, textarea: 0, checkbox: 0, select: 0 };
    host.querySelectorAll('input,select,textarea').forEach(el => {
      if (!el.id || SKIP.has(el.id)) return;
      const want = FB.has(el.id) ? FB.get(el.id) : undefined;
      if (el.tagName === 'SELECT') {
        const cur = el.value;
        const cand = Array.from(el.options).map(o => o.value).filter(v => v && v !== 'none' && v !== 'any' && String(v) !== String(want));
        const pickFrom = cand.length ? cand : Array.from(el.options).map(o => o.value).filter(v => String(v) !== String(want));
        const nv = pickFrom.find(v => v !== cur) !== undefined ? pickFrom.find(v => v !== cur) : pickFrom[0];
        if (nv !== undefined && nv !== cur) { el.value = nv; counts.select++; }
        return;
      }
      if (el.tagName === 'TEXTAREA') { const nv = (el.value === 'zzprobe' ? 'yyprobe' : 'zzprobe'); if (nv !== el.value) { el.value = nv; counts.textarea++; } return; }
      if (el.type === 'checkbox') { const nv = want === undefined ? true : !(want === true || want === 'true'); if (nv !== el.checked) { el.checked = nv; counts.checkbox++; } return; }
      if (el.type === 'number') {
        const min = el.min === '' ? -1e9 : Number(el.min), max = el.max === '' ? 1e9 : Number(el.max);
        const cur = Number(el.value);
        let nv = cur + 1; if (!(nv <= max)) nv = cur - 1; if (!(nv >= min)) nv = cur;
        if (want !== undefined && nv === Number(want)) { const alt = nv + 1 <= max ? nv + 1 : nv - 1; if (alt >= min && alt <= max) nv = alt; }
        if (nv !== cur) { el.value = String(nv); counts.number++; }
        return;
      }
      if (el.type === 'text') { const nv = (el.value === 'zzprobe' ? 'yyprobe' : 'zzprobe'); if (nv !== el.value) { el.value = nv; counts.text++; } return; }
    });
    return counts;
  };

  /* One open-the-editor-and-press-Save cycle, exactly as the app does it. */
  const cycle = (card, doPerturb) => {
    Forge.customCards = [card]; App.editingCardId = card.id; App._traitPoolModal = false;
    host.innerHTML = renderCardEditor();
    bindCardEditor();
    let counts = null;
    if (doPerturb) counts = perturb(host);
    if (DROP) {
      /* 🔴 dropRemoved counts a removal that HAPPENED — it is only incremented
         inside the `if (el)`. Counting "the id is absent afterwards" is the
         metric that made a field which was never rendered score a perfect
         153/153 and read as coverage. */
      const sel = '[id="' + DROP.replace(/"/g, '') + '"]';
      const el = host.querySelector(sel);
      if (el) { dropPresent++; dropTag = el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''); el.remove(); if (!host.querySelector(sel)) dropRemoved++; }
    }
    captureEditorIntoCard(card);
    /* _editedAt is a deliberate stamp, not card content. */
    delete card._editedAt;
    return counts;
  };

  const rows = [];
  const typed = { number: 0, text: 0, textarea: 0, checkbox: 0, select: 0 };
  for (const src of pool) {
    const raw = JSON.parse(JSON.stringify(src));
    try {
      /* 1 — normalise: what one save does to a card that has never been saved
         from this editor. Reported, not asserted; see the note in the runner. */
      const norm = JSON.parse(JSON.stringify(raw));
      cycle(norm, false);
      const overwrites = diff(raw, norm).filter(l => !/: undefined →/.test(l));
      /* 2 — the player edits it and saves. Now every rendered field of every
         kind holds a value that is NOT what its absence would produce. */
      const loaded = JSON.parse(JSON.stringify(norm));
      const c = cycle(loaded, true);
      for (const k of Object.keys(typed)) typed[k] += c[k];
      /* 3 — SETTLE. Reopen and save once more with no input, and take THAT as
         the card under test.
         🔴 Why this cycle exists. Moving every select off its fallback found a
         family the editor cannot re-render what it wrote — 74 field paths on
         153/153 cards: inVoid.filter.element/cardType/faction/costMode (the
         in-grave Card Filter markup read card.inGrave only, so a void-only
         card's filter came back blank) and 68 onResurrect.* paths (the Auto-copy
         box ticked itself for any card that merely HAD an onResurrect, so the
         next save replaced a hand-authored block with a copy of onPlay). Both
         are fixed and the count below now prints 0 — but the cycle STAYS. It is
         a report, not an assertion, deliberately: this pool is content data
         other agents edit, and a card that cannot express one of its own values
         must not turn someone else's edit red. What it does is name the next
         family of this kind by field path the moment one appears. The claim
         asserted is the one in the heading: reopening a SAVED card and saving
         again changes nothing. */
      const settled = JSON.parse(JSON.stringify(loaded));
      cycle(settled, false);
      const unsettled = diff(loaded, settled);
      /* 4 — THE TEST. Re-open that saved card and save again, touching nothing. */
      const again = JSON.parse(JSON.stringify(settled));
      if (mut && mut.dropField) DROP = mut.dropField;
      cycle(again, false);
      DROP = null;
      rows.push({ id: src.id, type: src.type || '?', overwrites, unsettled, drift: diff(settled, again) });
    } catch (e) {
      rows.push({ id: src.id, type: src.type || '?', err: String(e && e.message || e), overwrites: [], unsettled: [], drift: ['THREW: ' + String(e && e.message || e)] });
    }
  }
  return { rows, typed, dropPresent, dropRemoved, dropTag, auraCards: pool.filter(c => Array.isArray(c.auras) && c.auras.length).length, onPlayXCards: pool.filter(c => Array.isArray(c.onPlayExtra) && c.onPlayExtra.length).length };
};

/* ── the named mutants, so a critic reproduces each with one command ──────── */
const MUTANTS = [
  { name: 'rename-ig-chance', half: 'A', mut: { renameId: 'ed-ig-chance' },
    what: 'rename id="ed-ig-chance" everywhere renderCardEditor() emits it (num fallback 100)',
    expect: [/"ed-ig-chance"/, /num\(\) fallback 100/] },
  { name: 'rename-ig-chance-trap-only', half: 'A', mut: { renameId: 'ed-ig-chance', onlyType: 'trap' },
    what: 'rename id="ed-ig-chance" in the TRAP rendering ONLY — invisible to a union check',
    expect: [/ed-ig-chance/, /\btrap\b/] },
  { name: 'rename-wall-attack', half: 'A', mut: { renameId: 'ed-wall-attack' },
    what: 'rename id="ed-wall-attack" — read only through the helper _wc(\'ed-wall-attack\', true)',
    expect: [/"ed-wall-attack"/, /_wc/] },
  { name: 'rename-px-heroes', half: 'A', mut: { renameId: 'ed-px-heroes' },
    what: 'rename id="ed-px-heroes" — read only through the helper _pc(\'ed-px-heroes\')',
    expect: [/"ed-px-heroes"/, /_pc/] },
  { name: 'drop-onplay-amount', half: 'B', mut: { dropField: 'ed-onplay-amount' },
    what: 'DOM-remove ed-onplay-amount before the reopen save (num fallback 6)',
    expect: [/onPlay\.amount/, /onPlay\.amount: \d+ → 6/, /ALL-IDENTICAL/] },
  /* The expected FAIL text names the CARD FIELD, not the element id, because
     that is the damage a maintainer has to recognise: `.mutate.hostMinCost`
     is what num('ed-mutate-mincost', …) writes, and an expectation written
     against the id would pass on a run that reported the wrong field. */
  { name: 'drop-mutate-mincost', half: 'B', mut: { dropField: 'ed-mutate-mincost' },
    what: 'DOM-remove ed-mutate-mincost before the reopen save (writes mutate.hostMinCost)',
    expect: [/\.mutate\.hostMinCost: \d+ → undefined/, /ALL-IDENTICAL/] },
  { name: 'drop-ctok-start', half: 'B', mut: { dropField: 'ed-ctok-start' },
    what: 'DOM-remove ed-ctok-start before the reopen save (writes counterToken.start, _n fallback 0)',
    expect: [/\.counterToken\.start: \d+ → 0/, /ALL-IDENTICAL/] },
  { name: 'drop-grave-chance', half: 'B', mut: { dropField: 'ed-grave-chance' },
    what: 'DOM-remove ed-grave-chance — rendered on every card, stored by no pool card until the perturbation turns the grave ability on',
    expect: [/\.graveActive\.effect\.chance: \d+ → 100/, /ALL-IDENTICAL/] },
  /* 🔴 The two non-<input type=number> drops. index.html:146110 emits
     `<input type="checkbox" id="ed-wall-attack" …>` — id SECOND — and
     index.html:148556 emits a bare `<select id="ed-ctok-grantto">`. The drop
     helper the previous revision shipped was /<input id="X"[^>]*>/, which
     matches neither: repointing it at either of these removed nothing and the
     run went green off a mutation that never happened. */
  { name: 'drop-wall-attack', half: 'B', mut: { dropField: 'ed-wall-attack' },
    what: 'DOM-remove the ed-wall-attack CHECKBOX (id is its second attribute) before the reopen save',
    expect: [/\.wall\.canAttack: false → true/, /ALL-IDENTICAL/] },
  { name: 'drop-ctok-grantto', half: 'B', mut: { dropField: 'ed-ctok-grantto' },
    what: 'DOM-remove the ed-ctok-grantto SELECT before the reopen save (_v fallback "self")',
    expect: [/\.counterToken\.grantTo: "[a-z]+" → "self"/, /ALL-IDENTICAL/] },
];

if (LIST) {
  console.log('\n  self-test mutants (node _forgeids_smoke.mjs --selftest=NAME):\n');
  for (const m of MUTANTS) console.log('   ' + m.name.padEnd(30) + 'half ' + m.half + '   ' + m.what);
  console.log('\n   --selftest         runs all ' + MUTANTS.length + ' and asserts each one goes red (exit 0 when they do).');
  console.log('   --mutate=NAME      runs the GATE with that mutant injected: real FAIL lines, non-zero exit.\n');
  process.exit(0);
}

/* ── runner ───────────────────────────────────────────────────────────────── */

const { server, port } = await serve();
let browser;
try {
  browser = await chromium.launch({ args: ['--no-sandbox'] });
} catch (e) {
  /* No browser, no verdict. Say so in words rather than dying in a stack trace:
     with zero FAIL lines and a non-zero exit, _checkall reports this as CRASH —
     "the suite threw, it checked NOTHING" — which is the honest state. */
  console.log('\n  cannot launch chromium: ' + (e && e.message ? e.message.split('\n')[0] : e));
  console.log('  this suite drives the REAL editor in a real DOM. Install the browser with:  npx playwright install chromium');
  server.close();
  process.exit(1);
}
const page = await browser.newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(String(e).slice(0, 200)));
/* 🔴 The gate must never reach the live database. Everything that is not this
   local server is aborted. */
await page.route('**', r => (r.request().url().startsWith('http://127.0.0.1:' + port) ? r.continue() : r.abort()));
await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });
const PACKS = packCards();
const FB_ARR = [...LITERAL_FB];

async function runA(mut, p) { return (p || page).evaluate(HALF_A, { ids: IDS, sels: SELS, fb: FB_ARR, instr: INSTRUMENTED.src, mut: mut || null }); }
async function runB(mut, p) { return (p || page).evaluate(HALF_B, { packs: PACKS, fb: FB_ARR, mut: mut || null }); }

/* Half B's mutations mutate the page's DOM state card by card; the self-test
   runs them in a fresh page rather than poisoning the gate's own page. */
async function freshPage() {
  const p = await browser.newPage();
  await p.route('**', r => (r.request().url().startsWith('http://127.0.0.1:' + port) ? r.continue() : r.abort()));
  await p.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });
  return p;
}

/* The gate's own reporting, so the self-test can run it verbatim. */
async function reportA(A) {
  line('\n=== HALF A — every id the save path reads is on the screen it saves from ===');
  const live = await page.evaluate(() => ({
    cap: captureEditorIntoCard.toString(), lls: readEditorLearnset.toString(), ems: readEditorElemMods.toString(),
  }));
  const norm = (s) => s.replace(/\r/g, '');
  ok(norm(CAP) === norm(live.cap),
    'the lifted captureEditorIntoCard text IS the function the browser runs (' + CAP.length + ' bytes, ' + CAP.split('\n').length + ' lines)',
    'lifted ' + CAP.length + ' vs runtime ' + live.cap.length);
  ok(norm(TEXT.readEditorLearnset) === norm(live.lls) && norm(TEXT.readEditorElemMods) === norm(live.ems),
    'and so are the row helpers it delegates to');

  /* ── read forms. Printed per form so a future helper that goes unrecognised
     is visible in the diff of one line, not invisible in a total. */
  const idForms = [...formIds].sort((a, b) => b[1] - a[1]);
  const selForms = [...formSels].sort((a, b) => b[1] - a[1]);
  line('  derived from ' + SOURCES.length + ' save-path functions: ' + IDS.length + ' string-literal ids, ' + SELS.length + ' css hooks, '
    + LITERAL_FB.size + ' reads with a LITERAL fallback');
  line('  id read forms (' + idForms.length + '): ' + idForms.map(([f, n]) => f + ' ' + n).join(' · '));
  line('  selector read forms (' + selForms.length + '): ' + selForms.map(([f, n]) => f + ' ' + n).join(' · '));
  const NAMED = ['v', 'num', 'getElementById'];
  const conv = NAMED.reduce((a, f) => a + (formIds.get(f) || 0), 0);
  const viaHelper = [...formIds].reduce((a, [f, n]) => a + n, 0) - conv;
  const nHelpers = idForms.filter(([f]) => !NAMED.includes(f)).length;
  const idsNamed = [...idOf].filter(([, o]) => NAMED.includes(o.form)).length;
  line('  ' + conv + ' of those id reads use the editor\'s three named forms; ' + viaHelper + ' arrive through '
    + nHelpers + ' helpers the classifier lifted and placed, and ' + INSTRUMENTED.nHandles + ' more are presence probes bound to a variable');
  line('  by id: ' + idsNamed + '/' + IDS.length + ' ids are reachable through the three named forms; ' + (IDS.length - idsNamed) + ' exist ONLY because a helper was lifted');
  /* the doc-drift guard, part 2: the header's split is the derived split. */
  const hdrSplit = /accounted\s+for\s+(\d+)\s+of\s+the\s+(\d+)\s+ids;\s+the\s+other\s+(\d+)/.exec(SELF.replace(/\s+/g, ' '));
  ok(!!hdrSplit && Number(hdrSplit[1]) === idsNamed && Number(hdrSplit[2]) === IDS.length && Number(hdrSplit[3]) === IDS.length - idsNamed,
    'the header of this file says ' + (hdrSplit ? hdrSplit[1] + '/' + hdrSplit[2] + ' + ' + hdrSplit[3] : '?') + ' and the code derives ' + idsNamed + '/' + IDS.length + ' + ' + (IDS.length - idsNamed),
    'header ' + (hdrSplit ? hdrSplit.slice(1, 4).join('/') : 'MISSING'));
  ok(unattributed.length === 0,
    'every save-path call site that takes an editor-shaped literal is attributed to a classified read form',
    unattributed.slice(0, 4).join(' | '));
  ok(IDS.length >= 200, 'the derivation found ' + IDS.length + ' ids (a lifter that returns nothing cannot pass this)', String(IDS.length));
  ok(SELS.length >= 20, 'and ' + SELS.length + ' class/attribute hooks that the id convention cannot see', String(SELS.length));
  ok(fbUnevaluable.length === 0, 'every constant-argument read form could be run against an empty document to find out what its absence writes', [...new Set(fbUnevaluable)].join(' '));
  /* the doc-drift guard: the number in this file's own header is the number the
     code derives, or the header is wrong and this line says so. */
  const hdr = /(\d+) of those reads end in a LITERAL fallback/.exec(SELF);
  ok(!!hdr && Number(hdr[1]) === LITERAL_FB.size,
    'the header of this file says ' + (hdr ? hdr[1] : '?') + ' literal-fallback reads and the code derives ' + LITERAL_FB.size,
    'header ' + (hdr ? hdr[1] : 'MISSING') + ' vs derived ' + LITERAL_FB.size);

  line('  ids present per card type: ' + Object.keys(A.perType).map(t => t + ' ' + A.perType[t]).join(' · '));
  const holeIds = KNOWN_HOLES.map(h => h.id);
  const unexpected = A.missingIds.filter(i => !holeIds.includes(i));
  for (const id of unexpected) ok(false, 'id "' + id + '" is read by ' + idOf.get(id).form + '() in ' + idOf.get(id).who + '() but NO card type renders it', LITERAL_FB.has(id) ? (idOf.get(id).form + '() fallback ' + JSON.stringify(LITERAL_FB.get(id)) + ' — saving overwrites the card') : 'read as v()/getElementById()');
  ok(unexpected.length === 0, 'all ' + IDS.length + ' derived ids exist in the editor markup, except the ' + KNOWN_HOLES.length + ' known holes below',
    unexpected.length + ' unexpected');
  const fixed = holeIds.filter(i => !A.missingIds.includes(i));
  ok(fixed.length === 0, 'no known hole has been fixed without lowering the baseline in this file', fixed.join(' '));
  for (const h of KNOWN_HOLES) {
    /* Derived, not trusted: a hole is inert only if its own id guards its read. */
    const guarded = CAP.includes("if (document.getElementById('" + h.id + "'))") || CAP.includes("if (v('" + h.id + "') != null)");
    ok(guarded === !h.live, 'known hole ' + h.id + ' is still ' + (h.live ? 'LIVE' : 'inert') + ' — ' + h.why, 'self-guard=' + guarded);
  }

  const dangerous = [...LITERAL_FB.keys()].filter(id => A.missingIds.includes(id));
  ok(dangerous.length === (KNOWN_HOLES.filter(h => h.live).length),
    'every one of the ' + LITERAL_FB.size + ' literal-fallback fields is rendered, but for the known live hole',
    dangerous.join(' '));

  /* ── PER CARD TYPE, from the instrumented capture. */
  ok(!A.instrErr, 'the instrumented copy of captureEditorIntoCard compiled and ran (' + INSTRUMENTED.nMarks + ' read sites wrapped)', A.instrErr);
  const typeHoleIds = KNOWN_TYPE_HOLES.map(h => h.id);
  const rnr = [], readPairs = [];
  for (const t of Object.keys(A.readNotRendered)) for (const id of A.readNotRendered[t]) { readPairs.push(t); if (!typeHoleIds.includes(id)) rnr.push({ id, t }); }
  const readTotals = Object.keys(A.readNotRendered).length ? Object.keys(A.perType).map(t => t + ' ' + ((A.readNotRendered[t] || []).length)) : [];
  line('  the instrumented capture read ' + INSTRUMENTED.nMarks + ' wrapped sites; ids it read that the type does not render: ' + readTotals.join(' · '));
  for (const r of rnr) ok(false, 'id "' + r.id + '" is READ while saving a ' + r.t + ' card but the ' + r.t + ' editor does not render it',
    LITERAL_FB.has(r.id) ? ('absence writes ' + JSON.stringify(LITERAL_FB.get(r.id))) : 'absence is read as a missing element');
  ok(rnr.length === 0, 'on all 11 card types, every id the real capture READ on that type is rendered on that type, but for the ' + KNOWN_TYPE_HOLES.length + ' known per-type hole',
    rnr.map(r => r.id + '/' + r.t).join(' '));
  for (const h of KNOWN_TYPE_HOLES) {
    const still = h.types.filter(t => (A.readNotRendered[t] || []).includes(h.id));
    ok(still.length === h.types.length, 'known per-type hole ' + h.id + ' is still read-but-unrendered on ' + h.types.join(',') + ' — ' + h.why,
      'still ' + still.join(',') + ' of ' + h.types.join(','));
  }

  /* ── the damage sweep: which fields a drop can actually be SEEN through. */
  const types = Object.keys(A.bearing);
  const bearAny = new Set(), presentAny = new Set();
  for (const t of types) { for (const id of A.bearing[t]) { bearAny.add(id); presentAny.add(id); } for (const id of A.inert[t]) presentAny.add(id); }
  const fbPresent = [...LITERAL_FB.keys()].filter(id => presentAny.has(id));
  const blind = fbPresent.filter(id => !bearAny.has(id));
  line('  damage sweep: each rendered field removed, saved, restored — ' + bearAny.size + '/' + presentAny.size
    + ' rendered ids change the saved card when they go; of the ' + fbPresent.length + ' literal-fallback fields that render, '
    + (fbPresent.length - blind.length) + ' are observable and ' + blind.length + ' are not');
  const newBlind = blind.filter(id => !BLIND_SPOTS.includes(id));
  const goneBlind = BLIND_SPOTS.filter(id => !blind.includes(id));
  for (const id of newBlind) ok(false, 'literal-fallback field ' + id + ' (absence writes ' + JSON.stringify(LITERAL_FB.get(id)) + ') is rendered but removing it changes NOTHING — no mutation of it can be seen', 'new blind spot');
  ok(newBlind.length === 0 && goneBlind.length === 0,
    'the ' + BLIND_SPOTS.length + ' literal-fallback fields a drop cannot be seen through are exactly the ones named in BLIND_SPOTS — ' + BLIND_SPOTS_WHY,
    (newBlind.length ? 'new: ' + newBlind.join(' ') + '  ' : '') + (goneBlind.length ? 'now observable, lower the baseline: ' + goneBlind.join(' ') : ''));
  note('blind spots (' + blind.length + '): ' + (blind.join(' ') || 'none'));
  note('fields the sweep could not move off their own fallback at all: ' + (A.unmovable.join(' ') || 'none'));

  /* A selector rooted at a known hole is that hole, not a second finding. */
  const holeSels = A.missingSels.filter(s => KNOWN_HOLES.some(h => s.startsWith('#' + h.id)));
  const unexpectedSels = A.missingSels.filter(s => !holeSels.includes(s));
  for (const s of unexpectedSels) ok(false, 'css hook ' + JSON.stringify(s) + ' is read by ' + selOf.get(s) + '() but matches nothing in any rendering');
  ok(unexpectedSels.length === 0, 'all ' + SELS.length + ' class/attribute readback hooks (.learn-row, .em-*, .trg-*, .fr-*, .ar-*, .sub-*, [data-faction], [data-sub-faction] …) render, but for ' + holeSels.length + ' rooted at a known hole',
    unexpectedSels.join(' | '));

  ok(A.bindErrs.length === 0, 'bindCardEditor() ran clean on all 11 card types', A.bindErrs.join(' | '));
  const missDraw = A.drawersWanted.filter(d => !A.drawersAfterBind.includes(d));
  ok(missDraw.length === 0, 'all nine ability drawers exist BY NAME on a unit card after bindCardEditor() re-parents the 56k In-Grave template', missDraw.join(' '));

  note('computed-id families the literal sweep cannot see: ' + ([...dynPrefixes].join(' ') || 'none') + ' plus `const p = \'ed-aura-\' + i`.');
  note('those are covered by value in Half B instead — see the aura / onPlayExtra card counts below.');
}

function reportB(B) {
  line('\n=== HALF B — a save with zero user input changes nothing ===');
  const byType = {}; B.rows.forEach(r => byType[r.type] = (byType[r.type] || 0) + 1);
  line('  ' + B.rows.length + ' real cards: ' + Object.keys(byType).sort().map(t => t + ' ' + byType[t]).join(' · '));
  line('  fields moved off their fallback across the pool before the no-op save: '
    + Object.keys(B.typed).map(k => k + ' ' + B.typed[k]).join(' · '));
  line('  ' + B.auraCards + ' cards carry auras and ' + B.onPlayXCards + ' carry onPlayExtra (the computed-id families)');
  ok(B.rows.length >= 30, 'the pool is ' + B.rows.length + ' real cards from public/index.html and public/cardsets', String(B.rows.length));
  for (const k of ['number', 'select', 'checkbox', 'text']) ok(B.typed[k] > 0, 'the perturbation moved ' + B.typed[k] + ' ' + k + ' field(s) — a kind that is never moved cannot be seen to disappear', String(B.typed[k]));
  for (const t of ['unit', 'spell', 'trap', 'summon', 'weather', 'hero']) ok((byType[t] | 0) > 0, 'the pool contains ' + (byType[t] | 0) + ' real ' + t + ' card(s)');
  const drifted = B.rows.filter(r => r.drift.length);
  for (const r of drifted.slice(0, 12)) for (const d of r.drift.slice(0, 4)) ok(false, 'saving "' + r.id + '" (' + r.type + ') with NO user input changed it: ' + d);
  ok(drifted.length === 0, 'ALL-IDENTICAL — ' + (B.rows.length - drifted.length) + '/' + B.rows.length + ' cards round-trip byte-for-byte through render → bind → capture',
    drifted.length + ' cards drifted');

  /* Reported, never asserted: this is the state of the world before this suite
     existed, and the pool is content data other agents edit. A rise here is
     worth a look, but it must not turn someone else's card edit red. */
  const ow = B.rows.filter(r => r.overwrites.length);
  note('first-save overwrite surface: ' + ow.length + '/' + B.rows.length + ' real cards do NOT survive their first save unchanged.');
  note('these are values the editor cannot express (out-of-range numbers, options missing from a select). Examples:');
  for (const r of ow.slice(0, 6)) note('   ' + r.id + ' (' + r.type + ') ' + r.overwrites.slice(0, 2).join(' · '));
  /* What the settle cycle had to give back — the fields captureEditorIntoCard
     writes that renderCardEditor cannot put back on screen. Reported by name,
     because a field in this list is one the perturbation cannot hold and
     therefore one a drop cannot be seen through. */
  const uns = B.rows.filter(r => r.unsettled && r.unsettled.length);
  const unsKeys = {}; for (const r of uns) for (const d of r.unsettled) { const k = d.split(':')[0]; unsKeys[k] = (unsKeys[k] || 0) + 1; }
  note('perturbation the editor could not hold: ' + uns.length + '/' + B.rows.length + ' cards changed again on the settle save, over '
    + Object.keys(unsKeys).length + ' field paths: ' + (Object.keys(unsKeys).sort((a, b) => unsKeys[b] - unsKeys[a]).slice(0, 8).join(' ') || 'none'));
}

if (MUTATE) {
  const m = MUTANTS.find(x => x.name === MUTATE);
  if (!m) { console.log('\n  no such mutant: ' + MUTATE + '   (node _forgeids_smoke.mjs --list)'); await browser.close(); server.close(); process.exit(2); }
  console.log('\n🧪 MUTANT ' + m.name + ' — ' + m.what);
  console.log('   in memory only; index.html is not written.');
  if (m.half === 'A') { await reportA(await runA(m.mut)); reportB(await runB(null)); }
  else { await reportA(await runA(null)); reportB(await runB(m.mut)); }
  ok(pageErrs.length === 0, 'the page threw nothing while the editor was driven', pageErrs.slice(0, 2).join(' | '));
} else if (!SELFTEST) {
  await reportA(await runA(null));
  reportB(await runB(null));
  ok(pageErrs.length === 0, 'the page threw nothing while the editor was driven', pageErrs.slice(0, 2).join(' | '));
  ok(/window\.BUILD_VERSION = 'v12[1-9]v\d+'/.test(SRC), 'build version present');
} else {
  /* ── THE SELF-TEST. A gate that cannot fail is a comment.
     Each mutation runs the GATE'S OWN reporting (reportA / reportB) and the
     lines it printed are read back here — so what is checked is the thing that
     would actually be printed on a bad build, not a second opinion about it.
     Every mutation lives in memory: nothing is written to the 15 MB mixed-CRLF
     index.html, which must never be edited in place. */
  const chosen = ONLY ? MUTANTS.filter(m => m.name === ONLY) : MUTANTS;
  if (!chosen.length) { console.log('\n  no such mutant: ' + ONLY + '   (node _forgeids_smoke.mjs --list)'); await browser.close(); server.close(); process.exit(2); }

  const cleanA = await captured(async () => { await reportA(await runA(null)); });
  const cleanAFails = cleanA.filter(l => l.startsWith('  FAIL'));
  ok(cleanAFails.length === 0, 'half A prints no FAIL line on unmutated HEAD', cleanAFails.join(' | '));

  for (const m of chosen) {
    console.log('\n=== SELF-TEST ' + m.name + ' — ' + m.what + ' ===');
    let lines, extra = '';
    if (m.half === 'A') {
      const A = await runA(m.mut);
      /* HOLE 6: a mutation helper that quietly mutated nothing is a green run
         off a no-op. It has to prove it changed the markup. */
      const hit = Object.keys(A.renamed).filter(t => A.renamed[t]);
      ok(hit.length > 0, 'the rename really changed the markup, on ' + hit.length + ' card type(s): ' + hit.join(','), JSON.stringify(A.renamed));
      lines = await captured(async () => { await reportA(A); });
    } else {
      const p2 = await freshPage();
      const B1 = await p2.evaluate(HALF_B, { packs: PACKS, fb: FB_ARR, mut: m.mut });
      await p2.close();
      /* HOLE 4 + HOLE 6: `dropPresent` is how many reopens still had the field
         to remove, `dropRemoved` is how many it was really removed from. The
         previous revision counted ABSENCE and called it "the field was really
         gone on 153/153 reopens" — a field that is never rendered scores 153/153
         under that metric too, which is how a dropped ed-grave-chance produced
         ALL-IDENTICAL and a green exit. */
      ok(B1.dropRemoved > 0, 'the drop really removed a <' + (B1.dropTag || '?') + '> element from ' + B1.dropRemoved + '/' + B1.rows.length
        + ' reopens (the field was on screen for ' + B1.dropPresent + ' of them)', 'present ' + B1.dropPresent + ' removed ' + B1.dropRemoved);
      const nDrift = B1.rows.filter(r => r.drift.length).length;
      ok(nDrift <= B1.dropRemoved, 'and no more cards drifted (' + nDrift + ') than had the field taken off them (' + B1.dropRemoved + ')',
        nDrift + ' drifted vs ' + B1.dropRemoved + ' removed');
      extra = '  ' + nDrift + '/' + B1.rows.length + ' cards no longer round-trip';
      lines = await captured(async () => { reportB(B1); });
    }
    const f = lines.filter(l => l.startsWith('  FAIL'));
    console.log('  half ' + m.half + ' mutated: ' + f.length + ' FAIL lines' + extra);
    for (const l of f.slice(0, 4)) console.log('  caught:' + l.slice(6));
    ok(f.length > 0, m.name + ': the gate goes red', 'no FAIL line');
    for (const re of m.expect) ok(f.some(l => re.test(l)), m.name + ': a FAIL line matches ' + re, f.slice(0, 2).join(' | '));
  }

  console.log('\n  Every mutation is reverted the moment this process exits; index.html was never written.');
}

await browser.close();
server.close();
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
