// CRITIC-3 independent engine scan. Different technique from the builder's:
// mask strings/comments, then for each `eff.<key>` read walk OUT through the
// enclosing blocks and take the innermost block whose head names effect types.
import fs from 'fs';
const ROOT = process.argv[2] || 'D:/game-deploy';
const SRC = fs.readFileSync(ROOT + '/public/index.html', 'utf8');
const start = SRC.indexOf('function _applyOnPlayOneRaw(state, unit, card) {');
if (start < 0) throw new Error('no engine fn');
let i = SRC.indexOf('{', start), end = -1;
{
  let st = 0, q = '', d = 0;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j], n = SRC[j + 1];
    if (st === 0) {
      if (c === '/' && n === '/') { st = 1; j++; continue; }
      if (c === '/' && n === '*') { st = 2; j++; continue; }
      if (c === '"' || c === "'" || c === '`') { st = 3; q = c; continue; }
      if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) { end = j; break; } }
    } else if (st === 1) { if (c === '\n') st = 0; }
    else if (st === 2) { if (c === '*' && n === '/') { st = 0; j++; } }
    else if (st === 3) { if (c === String.fromCharCode(92)) { j++; continue; } if (c === q) st = 0; }
  }
}
if (end < 0) throw new Error('unterminated');
const RAW = SRC.slice(i, end + 1);
let body;
{
  const a = RAW.split(''); let st = 0, q = '';
  const BS = String.fromCharCode(92);
  for (let j = 0; j < a.length; j++) {
    const c = a[j], n = a[j + 1];
    if (st === 0) {
      if (c === '/' && n === '/') { st = 1; a[j] = ' '; continue; }
      if (c === '/' && n === '*') { st = 2; a[j] = ' '; continue; }
      if (c === '"' || c === "'" || c === '`') { st = 3; q = c; a[j] = ' '; continue; }
    } else if (st === 1) { if (c === '\n') { st = 0; continue; } a[j] = ' '; continue; }
    else if (st === 2) { if (c === '*' && n === '/') { a[j] = ' '; a[j + 1] = ' '; j++; st = 0; continue; } if (c !== '\n') a[j] = ' '; continue; }
    else if (st === 3) { if (c === BS) { a[j] = ' '; a[j + 1] = ' '; j++; continue; } if (c === q) { a[j] = ' '; st = 0; continue; } if (c !== '\n') a[j] = ' '; continue; }
  }
  body = a.join('');
}
const stack = [], blocks = [];
for (let j = 0; j < body.length; j++) {
  if (body[j] === '{') stack.push(j);
  else if (body[j] === '}') { const s = stack.pop(); if (s != null) blocks.push([s, j]); }
}
const IDS = new Set(JSON.parse(fs.readFileSync(process.argv[3] || 'D:/game-deploy/.gauntlet/_crit3-ids.json', 'utf8')));
// read the head of a block from the MASKED body but the literals from RAW at the
// same offsets, so string contents never look like predicates but the type name
// inside the quotes is still readable.
function headTypes(bs) {
  // ⚠ The head must start at the START OF THIS STATEMENT, not N chars back.
  // A flat 600-char window swept up the PREVIOUS branch's literals, so
  // drawCards' `eff.amount` was attributed to peekHand/peekDiscard/peekBanish
  // as well — six phantom "gate hides an engine read" hits, all mine.
  let from = Math.max(0, bs - 600);
  for (let k = bs - 1; k >= from; k--) {
    const ch = body[k];
    if (ch === '}' || ch === ';' || ch === '{') { from = k + 1; break; }
  }
  const headRaw = RAW.slice(from, bs);
  const headMask = body.slice(from, bs);
  const pos = new Set(), neg = new Set();
  // find quote runs in RAW that were masked in body => those are string literals
  const re = /['"]([A-Za-z][A-Za-z0-9_]*)['"]/g; let m;
  while ((m = re.exec(headRaw))) {
    const at = from + m.index;
    // the char before the literal, in the masked body, decides the operator
    const before = body.slice(Math.max(0, at - 12), at);
    if (/!==?\s*$/.test(before)) neg.add(m[1]);
    else if (/[^!<>=]===?\s*$/.test(before) || /^\s*===?\s*$/.test(before)) pos.add(m[1]);
    else if (/[[,(]\s*$/.test(before)) pos.add(m[1]);   // ['a','b'].includes(t)
  }
  for (const n of neg) pos.delete(n);
  void headMask;
  return pos;
}
const reads = [];
{
  const re = /\beff\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g; let m;
  while ((m = re.exec(body))) reads.push([m.index, m[1]]);
}
const perEffect = {}; for (const id of IDS) perEffect[id] = new Set();
const universal = new Set();
for (const [off, key] of reads) {
  if (key === 'type') continue;
  const enc = blocks.filter(b => b[0] < off && b[1] > off).sort((a, b) => b[0] - a[0]);
  let owners = null;
  for (const b of enc) {
    const hit = [...headTypes(b[0])].filter(x => IDS.has(x));
    if (hit.length) { owners = hit; break; }
  }
  if (!owners) universal.add(key);
  else owners.forEach(o => { if (perEffect[o]) perEffect[o].add(key); });
}
{
  const reC = /\bcase\s+['"]([A-Za-z][A-Za-z0-9_]*)['"]\s*:/g; let m; const cases = [];
  while ((m = reC.exec(RAW))) if (IDS.has(m[1])) cases.push([m.index, m[1]]);
  for (let k = 0; k < cases.length; k++) {
    const s = cases[k][0], e = (k + 1 < cases.length ? cases[k + 1][0] : s + 4000);
    for (const [off, key] of reads) if (off > s && off < e && key !== 'type') perEffect[cases[k][1]].add(key);
  }
}
const out = { universal: [...universal].sort(), perEffect: {} };
for (const id of IDS) out.perEffect[id] = [...perEffect[id]].sort();
fs.writeFileSync(process.argv[4] || 'D:/game-deploy/.gauntlet/_crit3-engine.json', JSON.stringify(out, null, 1));
console.log('eff.<key> reads:', reads.length, '| universal keys:', out.universal.length);
console.log('universal:', out.universal.join(' '));
let tot = 0; for (const id of IDS) tot += out.perEffect[id].length;
console.log('effects:', IDS.size, '| mean per-effect keys:', (tot / IDS.size).toFixed(2));
