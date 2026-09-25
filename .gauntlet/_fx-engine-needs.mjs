#!/usr/bin/env node
/* 🔬 ENGINE-DERIVED FIELD REQUIREMENTS — the independent whitelist.
 *
 * WHY THIS EXISTS: the effect gate reads ONPLAY_TYPES[].needs. A driver that
 * scores the gate against that same list cannot fail — it is a tautology, and
 * the first round of this piece shipped exactly that mistake: `needs` is wrong
 * for a handful of effects (intimidate omits `chance` while aoeStatus, which
 * shares its engine branch, lists it), so fields the ENGINE reads were hidden
 * and nothing measured it.
 *
 * So this file never looks at `needs`. It reads three things out of index.html:
 *   1. _applyOnPlayOneRaw — every `eff.<key>` read, attributed to the
 *      `eff.type === 'X'` branch(es) it sits inside (positive AND negative:
 *      an `else` after `if (eff.type === 'a')` excludes 'a', it does not mean
 *      "every effect").
 *   2. the `card.onPlay = { … }` capture — key -> the editor field id(s) that
 *      write it, so an engine key becomes a concrete field on screen.
 *   3. FX_GATE_FIELDS — field-id suffix -> gate token, so the requirement can
 *      be stated in the gate's own vocabulary.
 * Output: for each effect id, the field suffixes the engine genuinely needs.
 *
 * Static analysis over-approximates on purpose. Attributing a read to MORE
 * effects than really use it makes the gate show a field it could have hidden,
 * which costs a line of screen. Attributing to FEWER hides a field an author
 * needs, which is the failure this whole file is here to catch.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* 🔴 THE DEFAULT ROOT WAS HARDCODED TO 'D:/game-deploy' AND THE REPO MOVED TO E:.
   That is not a cosmetic breakage. checkall runs this suite, the readFileSync
   below throws ENOENT, and the suite is reported as "threw, it checked
   NOTHING" — every assertion in it silently discarded while the gate still
   looks like it ran. `drive-fx-gate.mjs` was hit by exactly this and lost all
   118 of its effect assertions. Derive the root from this file's own location
   instead: .gauntlet/<this file> -> repo root. An explicit argv[2] still wins,
   because the audit passes one. */
const ROOT = process.argv[2] || path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

// ── mask: comments -> spaces; braces/parens/semicolons inside string and
// template literals -> spaces. Length-preserving, so every offset still lines
// up with the raw source and a reported position can be read by hand.
function mask(s, killStrings) {
  const a = s.split('');
  let i = 0;
  const N = s.length;
  const blank = (from, to, keepId) => {
    for (let k = from; k < to; k++) {
      const c = a[k];
      if (keepId && !'{}()[];,'.includes(c)) continue;
      if (c !== '\n') a[k] = ' ';
    }
  };
  while (i < N) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { let j = s.indexOf('\n', i); if (j < 0) j = N; blank(i, j, false); i = j; continue; }
    if (c === '/' && d === '*') { let j = s.indexOf('*/', i + 2); j = j < 0 ? N : j + 2; blank(i, j, false); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < N) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === c) { j++; break; }
        // ⚠ A ' OR " NEVER CROSSES A LINE. This masker has no idea what a regex
        // literal is, so /['"]/ in the middle of index.html used to open a
        // "string" that swallowed 60,000 characters — and every brace in them.
        // That is how the capture parse came back with an EMPTY function body
        // and reported that no effect needs any field. Backticks still span.
        if (c !== '`' && s[j] === '\n') { j = i + 1; break; }
        j++;
      }
      if (j === i + 1) { i++; continue; }   // not a string after all
      // keep the text (ids like 'damage' are the dispatch) but kill structure;
      // killStrings blanks it outright for the identifier scan, where the literal
      // 'radius' inside ['amount','statusDuration','radius'] otherwise reads as a
      // USE of the local named radius and hands every effect a Radius box.
      blank(i + 1, j - 1, !killStrings);
      i = j; continue;
    }
    i++;
  }
  return a.join('');
}

function matchBrace(t, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[t[open]];
  let d = 0;
  for (let i = open; i < t.length; i++) {
    if (t[i] === t[open]) d++;
    else if (t[i] === close) { d--; if (d === 0) return i; }
  }
  return -1;
}

// the engine function, by brace matching from its declaration
const fnStart = SRC.indexOf('function _applyOnPlayOneRaw');
if (fnStart < 0) throw new Error('_applyOnPlayOneRaw not found');
const M = mask(SRC);
const MID = mask(SRC, true);   // same offsets, string contents blanked
const bodyOpen = M.indexOf('{', fnStart);
const bodyEnd = matchBrace(M, bodyOpen);
const lineOf = (pos) => SRC.slice(0, pos).split('\n').length;
const ENGINE_FROM = lineOf(fnStart), ENGINE_TO = lineOf(bodyEnd);

// ── the catalogue's id list (ids only — never its `needs`)
const catStart = SRC.indexOf('const ONPLAY_TYPES = [');
const catEnd = matchBrace(M, M.indexOf('[', catStart));
const CAT = SRC.slice(catStart, catEnd + 1);
const ALL_IDS = [...CAT.matchAll(/\{\s*id:\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]);

// ── walk the engine body, tracking the active eff.type constraint
const typesIn = (cond) => new Set([...cond.matchAll(/eff\.type\s*===\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]));
const notTypesIn = (cond) => new Set([...cond.matchAll(/eff\.type\s*!==\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]));

const reads = [];   // {key, pos, ids:[effect ids this read is reachable from]}
let out_carriers = [], out_universal = [];
const frames = [];  // every constrained block, for constraintAt()
const decls = [];   // top-level `const NAME = …;` in the function body
function activeSet(stack) {
  let pos = null; const neg = new Set();
  for (const f of stack) {
    if (f.pos && f.pos.size) pos = pos === null ? new Set(f.pos) : new Set([...pos].filter(x => f.pos.has(x)));
    for (const n of f.neg) neg.add(n);
  }
  const base = pos === null ? ALL_IDS : [...pos];
  return base.filter(x => !neg.has(x));
}

const stack = [];
const pendingNeg = new Map(); // depth -> Set of types the preceding if consumed
let depth = 0;
const isWord = (c) => c && /[\w$]/.test(c);

const RD = /eff\.([A-Za-z_$][\w$]*)/g;
const CF = /_effCardFilter\s*\(\s*eff\s*,\s*'?([A-Za-z]*)'?/g;

for (let i = bodyOpen + 1; i < bodyEnd; i++) {
  while (stack.length && stack[stack.length - 1].end <= i) {
    const f = stack.pop();
    if (f.pos && f.pos.size) {
      const prev = pendingNeg.get(f.depth) || new Set();
      pendingNeg.set(f.depth, new Set([...prev, ...f.pos]));
    }
  }
  const c = M[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; }

  // `if (` — open a constrained frame
  if (c === 'i' && M[i + 1] === 'f' && !isWord(M[i - 1]) && !isWord(M[i + 2])) {
    let p = i + 2; while (p < bodyEnd && /\s/.test(M[p])) p++;
    if (M[p] === '(') {
      const pe = matchBrace(M, p);
      const cond = M.slice(p, pe + 1);
      let q = pe + 1; while (q < bodyEnd && /\s/.test(M[q])) q++;
      // is this the `if` of an `else if`? then it inherits the chain's negatives
      let back = i - 1; while (back > bodyOpen && /\s/.test(M[back])) back--;
      const isElseIf = M.slice(Math.max(0, back - 3), back + 1) === 'else';
      const neg = new Set(isElseIf ? (pendingNeg.get(depth) || []) : []);
      for (const n of notTypesIn(cond)) neg.add(n);
      let end;
      if (M[q] === '{') end = matchBrace(M, q) + 1;
      else { let k = q, d2 = 0; while (k < bodyEnd) { const ch = M[k]; if ('([{'.includes(ch)) d2++; else if (')]}'.includes(ch)) d2--; else if (ch === ';' && d2 <= 0) break; k++; } end = k + 1; }
      const pos = typesIn(cond);
      const fr = { start: i, end, pos: pos.size ? pos : null, neg, depth };
      stack.push(fr); frames.push(fr);
    }
  }
  // a top-level `const NAME = …` in the function body. The targeting prelude
  // reads eff.radius / eff.aoeAll / eff.tSide ONCE into closures every branch
  // may or may not call, so a read there is not "every effect needs radius" —
  // it is a read that travels to wherever the closure is USED. See the carrier
  // pass below, without which this scanner says all 118 effects need Radius.
  if (depth === 0 && /[\s;{}]/.test(M[i - 1] || ' ')) {
    const dm = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(M.slice(i, i + 60));
    if (dm) {
      let k = i + dm[0].length, d2 = 0;
      while (k < bodyEnd) { const ch = M[k]; if ('([{'.includes(ch)) d2++; else if (')]}'.includes(ch)) d2--; else if (ch === ';' && d2 <= 0) break; k++; }
      decls.push({ name: dm[1], start: i, end: k + 1 });
    }
  }
  // `else {` / `else <stmt>` — the negative side of the chain
  if (c === 'e' && M.slice(i, i + 4) === 'else' && !isWord(M[i - 1]) && !isWord(M[i + 4])) {
    let q = i + 4; while (q < bodyEnd && /\s/.test(M[q])) q++;
    if (M.slice(q, q + 2) !== 'if') {
      const neg = new Set(pendingNeg.get(depth) || []);
      let end;
      if (M[q] === '{') end = matchBrace(M, q) + 1;
      else { let k = q, d2 = 0; while (k < bodyEnd) { const ch = M[k]; if ('([{'.includes(ch)) d2++; else if (')]}'.includes(ch)) d2--; else if (ch === ';' && d2 <= 0) break; k++; } end = k + 1; }
      const fr = { start: i, end, pos: null, neg, depth };
      stack.push(fr); frames.push(fr);
    }
  }

  // reads at this position
  if (c === 'e' && M.slice(i, i + 4) === 'eff.' && !isWord(M[i - 1])) {
    RD.lastIndex = i; const m = RD.exec(M);
    if (m && m.index === i) reads.push({ key: m[1], pos: i, ids: activeSet(stack) });
  }
  if (c === '_' && M.slice(i, i + 15) === '_effCardFilter(') {
    CF.lastIndex = i; const m = CF.exec(M);
    if (m && m.index === i) {
      const rule = m[1];
      const ids = activeSet(stack);
      reads.push({ key: 'filter', pos: i, ids });
      if (rule) {
        reads.push({ key: rule, pos: i, ids });
        const idsKey = { summonCardRule: 'summonCardIds', searchDeckCardRule: 'searchDeckCardIds' }[rule];
        if (idsKey) reads.push({ key: idsKey, pos: i, ids });
      }
    }
  }
}

function constraintAt(pos) {
  return activeSet(frames.filter(f => f.start <= pos && pos < f.end));
}
const declAt = (pos) => decls.find(d => d.start <= pos && pos < d.end) || null;

// ── CALLEE PASS. Some branches hand the whole `eff` to a helper defined
// elsewhere in the file (_polyFuseFromSources reads matSources / radius /
// seizeTreatAs / summonCardId), so scanning only this function under-reports —
// under-reporting is the direction that hides a field an author needs.
{
  const callRe = /(^|[^\w$.])(_?[A-Za-z][\w$]*)\s*\(([^()]*)\)/g;
  const body = M.slice(bodyOpen, bodyEnd);
  const cache = new Map();
  const keysOfFn = (name) => {
    if (cache.has(name)) return cache.get(name);
    let keys = [];
    const at = M.indexOf('function ' + name + '(');
    if (at >= 0) {
      const o = M.indexOf('{', at), e = matchBrace(M, o);
      if (e > o && e - o < 400000) keys = [...new Set([...M.slice(o, e).matchAll(/eff\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))];
    }
    cache.set(name, keys);
    return keys;
  };
  let m;
  while ((m = callRe.exec(body))) {
    if (!/\beff\b/.test(m[3])) continue;
    const name = m[2];
    if (name === '_effCardFilter' || name === 'if' || name === 'for' || name === 'while') continue;
    const pos = bodyOpen + m.index + m[1].length;
    const ids = constraintAt(pos);
    for (const k of keysOfFn(name)) reads.push({ key: k, pos, ids, via: 'call:' + name });
  }
}

// ── CARRIER PASS. A read that lands in the shared prelude belongs to whoever
// USES the local it was read into, not to all 118 effects. Without this,
// `const radius = … eff.radius …` claims every effect needs the Radius box.
// Over-approximating is still the rule: a carrier's keys travel to EVERY use
// site, so a closure called from two branches feeds both.
{
  const carriers = new Map();  // local name -> Set(eff keys it carries)
  const universal = [];
  for (const r of reads) {
    if (r.ids.length !== ALL_IDS.length) continue;
    const d = declAt(r.pos);
    if (!d) { universal.push(r); continue; }
    if (!carriers.has(d.name)) carriers.set(d.name, new Set());
    carriers.get(d.name).add(r.key);
    r.carried = d.name;         // no longer counts as a read of its own
  }
  const useSites = (name) => {
    const out = [];
    const re = new RegExp('(^|[^\\w$.])' + name.replace(/[$]/g, '\\$&') + '(?![\\w$])', 'g');
    let m; while ((m = re.exec(MID.slice(bodyOpen, bodyEnd)))) out.push(bodyOpen + m.index + m[1].length);
    return out;
  };
  for (let round = 0; round < 6; round++) {
    let grew = false;
    for (const [name, keys] of [...carriers]) {
      for (const p of useSites(name)) {
        const own = decls.find(d => d.name === name && d.start <= p && p < d.end);
        if (own) continue;                    // the declaration itself
        const into = declAt(p);
        if (into) {                           // one closure calling another
          if (!carriers.has(into.name)) carriers.set(into.name, new Set());
          const s = carriers.get(into.name);
          for (const k of keys) if (!s.has(k)) { s.add(k); grew = true; }
          continue;
        }
        const ids = constraintAt(p);
        for (const k of keys) reads.push({ key: k, pos: p, ids, via: name });
      }
    }
    if (!grew) break;
    for (const r of reads.filter(x => x.via)) r.stale = true;
    for (let i = reads.length - 1; i >= 0; i--) if (reads[i].stale) reads.splice(i, 1);
  }
  out_carriers = [...carriers].map(([n, s]) => n + ':' + [...s].join(','));
  out_universal = universal.map(r => r.key + '@' + lineOf(r.pos));
}
for (let i = reads.length - 1; i >= 0; i--) if (reads[i].carried) reads.splice(i, 1);

// ── key -> field-id SUFFIXES, parsed out of the WHOLE capture function.
// Not just the on-play object: the five sibling trigger blocks and the six
// extra slots write the same engine keys through DIFFERENT suffixes
// (statusDuration is '-status-dur' on the primary block and '-dur' on a slot;
// the slot's Card Filter is '-fname'/'-felem'/'-ftype'), so a whitelist built
// only from the on-play object would silently check nothing in those blocks.
const capStart = SRC.indexOf('card.onPlay = {');
const capEnd = matchBrace(M, M.indexOf('{', capStart));
const CAPTURE_FROM = lineOf(capStart), CAPTURE_TO = lineOf(capEnd);
const fnCap = SRC.indexOf('function captureEditorIntoCard');
const capBodyOpen = M.indexOf('{', fnCap), capBodyEnd = matchBrace(M, capBodyOpen);
// every editor prefix whose ids the gate can hide, longest first so
// 'ed-onplayx-3-fname' resolves to the slot and not to 'ed-onplay'
const PREFIXES = ['ed-onplay', 'ed-grave', 'ed-ongrave', 'ed-onatk', 'ed-onkill', 'ed-field', 'ed-hand', 'ed-onplayx']
  .concat([0, 1, 2, 3, 4, 5].map(i => 'ed-onplayx-' + i))
  .sort((a, b) => b.length - a.length);
const sufOf = (id) => {
  for (const p of PREFIXES) if (id.lastIndexOf(p + '-', 0) === 0) return id.slice(p.length + 1);
  return null;   // ed-verdict-*, ed-kalon-* … not a gated block, not our business
};
const keyToFields = {};   // engine key -> the suffixes that write it
{
  const body = SRC.slice(capBodyOpen, capBodyEnd);
  const mb = M.slice(capBodyOpen, capBodyEnd);
  // ids reachable through a local: the slot filter is read into _fn/_fe/_ft
  // three lines above the object that uses them.
  const locals = {};
  for (const m of mb.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    const seg = body.slice(m.index, m.index + 220);
    const stop = seg.indexOf(';');
    const ids = [...(stop > 0 ? seg.slice(0, stop) : seg).matchAll(/'(ed-[a-z0-9-]+)'/g)].map(x => x[1]);
    if (ids.length) locals[m[1]] = [...new Set(ids)];
  }
  // every `key:` in the function, with the brace depth it sits at; its segment
  // runs to the next key at the same depth or shallower.
  const keys = [];
  let d = 0;
  for (let i = 0; i < mb.length; i++) {
    const ch = mb[i];
    if ('([{'.includes(ch)) { d++; continue; }
    if (')]}'.includes(ch)) { d--; continue; }
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(mb.slice(i, i + 40));
    if (m && !isWord(mb[i - 1]) && /[\s,{(]/.test(mb[i - 1] || ',')) { keys.push({ key: m[1], at: i, d }); i += m[0].length - 1; }
  }
  for (let k = 0; k < keys.length; k++) {
    let end = body.length;
    for (let j = k + 1; j < keys.length; j++) if (keys[j].d <= keys[k].d) { end = keys[j].at; break; }
    const seg = body.slice(keys[k].at, end);
    const ids = [...seg.matchAll(/'(ed-[a-z0-9-]+)'/g)].map(m => m[1]);
    for (const m of seg.matchAll(/(?:^|[^\w$.])(_[A-Za-z_$][\w$]*)/g)) if (locals[m[1]]) ids.push(...locals[m[1]]);
    const sufs = ids.map(sufOf).filter(Boolean);
    // UNION, never assign: the Verdict sub-objects repeat key names ('amount',
    // 'status'), and an assignment let the second one blank the first — which is
    // how the first cut of this scanner reported drawCards as needing no fields.
    keyToFields[keys[k].key] = [...new Set([...(keyToFields[keys[k].key] || []), ...sufs])];
  }
}

// ── FX_GATE_FIELDS, lifted from source (suffix -> tokens)
const gfStart = SRC.indexOf('const FX_GATE_FIELDS = {');
const gfEnd = matchBrace(M, M.indexOf('{', gfStart));
const GATEF = {};
for (const m of SRC.slice(gfStart, gfEnd + 1).matchAll(/'([a-z0-9-]+)'\s*:\s*\[([^\]]*)\]/g)) {
  GATEF[m[1]] = [...m[2].matchAll(/'([A-Za-z]+)'/g)].map(x => x[1]);
}

// ── requirement per effect: engine key -> capture field -> suffix (gated only)
const req = {};      // id -> Set of gated field suffixes
const reqKeys = {};  // id -> Set of engine keys (for the report)
for (const id of ALL_IDS) { req[id] = new Set(); reqKeys[id] = new Set(); }
const UNMAPPED = new Set();
for (const r of reads) {
  const fields = keyToFields[r.key];
  if (!fields || !fields.length) { UNMAPPED.add(r.key); continue; }
  const sufs = fields.filter(s => GATEF[s]);
  if (!sufs.length) continue;                    // written by an ungated field
  // an id the engine branches on but the catalogue no longer offers (legacy
  // aliases live in the engine forever) has no picker, so nothing to gate
  for (const id of r.ids) { if (!req[id]) continue; sufs.forEach(s => req[id].add(s)); reqKeys[id].add(r.key); }
}

const out = { engineLines: [ENGINE_FROM, ENGINE_TO], captureLines: [CAPTURE_FROM, CAPTURE_TO],
  ids: ALL_IDS.length, reads: reads.length,
  req: Object.fromEntries(ALL_IDS.map(id => [id, [...req[id]].sort()])),
  reqKeys: Object.fromEntries(ALL_IDS.map(id => [id, [...reqKeys[id]].sort()])),
  gateFields: GATEF, keyToFields,
  unmappedKeys: [...UNMAPPED].sort() };
if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
if (process.argv.includes('--reads')) {
  const want = process.argv[process.argv.indexOf('--reads') + 1];
  for (const r of reads) {
    if (want && r.key !== want) continue;
    const ln = lineOf(r.pos);
    console.log(`${String(r.ids.length).padStart(3)} ids  ${String(ln).padStart(6)}  eff.${r.key}   ${SRC.split('\n')[ln - 1].trim().slice(0, 110)}`);
  }
  process.exit(0);
}
console.log(`engine _applyOnPlayOneRaw ${ENGINE_FROM}..${ENGINE_TO}, capture ${CAPTURE_FROM}..${CAPTURE_TO}`);
console.log(`${ALL_IDS.length} effect ids, ${reads.length} eff.<key> reads attributed`);
const sizes = ALL_IDS.map(id => req[id].size);
console.log(`gated fields required: min ${Math.min(...sizes)} max ${Math.max(...sizes)} mean ${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1)}`);
for (const id of ALL_IDS) console.log('  ' + id.padEnd(22) + [...req[id]].sort().join(' '));
export default out;
