/* CRITIC driver 1 — the gap arithmetic, the STRATEGIC set, the deposit test. */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
const ROOT = '/home/user/Playmythicspellbook';
const HTML = readFileSync(ROOT + '/public/node-city/index.html', 'utf8');

const srcBlockAfter = (src, decl, open) => {
  open = open || '{'; const close = open === '[' ? ']' : '}';
  const at = src.indexOf(decl); if (at < 0) return null;
  let i = src.indexOf(open, at + decl.length - 1); if (i < 0) return null;
  const start = i; let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; i = e + 1; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); if (e < 0) return null; i = e; continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; } continue; }
    if (c === open) depth++; else if (c === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
};
const lit = (decl, open) => { const t = srcBlockAfter(HTML, decl, open); if (!t) return null; try { return (new Function('return (' + t + ');'))(); } catch (e) { return null; } };

const ECO = lit('const ECO_BUILDING_MAP = {');
const OPM = lit('const OP_ECO_MAP = {');
const PREFIX = (/const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) || [])[1];

const R = await import(pathToFileURL(ROOT + '/public/src/economy/recipes.js').href);
const E = await import(pathToFileURL(ROOT + '/public/src/economy/endowment.js').href);
const DEPOSITS = R.DEPOSITS;
const depIds = Object.keys(DEPOSITS);
console.log('DEPOSITS count =', depIds.length);
console.log('OPS_PREFIX =', JSON.stringify(PREFIX), ' ECO keys =', Object.keys(ECO).length, ' OP keys =', Object.keys(OPM).length);

// merged map, exactly like the game does at load
const merged = { ...ECO };
for (const k of Object.keys(OPM)) merged[PREFIX + k] = OPM[k];

const covered = new Set();
for (const k of Object.keys(merged)) for (const id of (merged[k].out || [])) if (DEPOSITS[id]) covered.add(id);
const missing = depIds.filter(id => !covered.has(id));
console.log('extractable deposits =', covered.size, ' missing =', missing.length);
console.log('MISSING:', missing.join(' '));

// Same, at the parent commit's map (reconstruct by removing the five new rows)
const NEW5 = ['waterintake','deepmine','alloyworks','canecroft','riftbore'];
const before = { ...merged }; for (const k of NEW5) delete before[k];
const covB = new Set();
for (const k of Object.keys(before)) for (const id of (before[k].out || [])) if (DEPOSITS[id]) covB.add(id);
const missB = depIds.filter(id => !covB.has(id));
console.log('\nBEFORE the five: extractable =', covB.size, ' missing =', missB.length);
console.log('BEFORE MISSING:', missB.join(' '));

// STRATEGIC intersection
const STRAT = (/const STRATEGIC = \[([\s\S]*?)\];/.exec(readFileSync(ROOT+'/public/src/economy/endowment.js','utf8'))||[])[1]
  .split(',').map(s=>s.trim().replace(/['\s]/g,'')).filter(Boolean);
console.log('\nSTRATEGIC (endowment.js) n=' + STRAT.length + ':', STRAT.join(' '));
const inter = STRAT.filter(id => missB.includes(id));
console.log('STRATEGIC ∩ the-19 =', inter.join(' '), ' (n=' + inter.length + ')');
console.log('alloyworks.out     =', ECO.alloyworks.out.join(' '));
console.log('IDENTICAL to intersection?', JSON.stringify([...inter].sort()) === JSON.stringify([...ECO.alloyworks.out].sort()));
console.log('IDENTICAL to whole STRATEGIC list?', JSON.stringify([...STRAT].sort()) === JSON.stringify([...ECO.alloyworks.out].sort()));

// which rows are all-deposit (the gate's §2 test)
const allDep = Object.keys(ECO).filter(k => (ECO[k].out||[]).length && ECO[k].out.every(id => !!DEPOSITS[id]));
console.log('\nAll-deposit rows in ECO_BUILDING_MAP (the gate speaks for these):');
console.log(' ', allDep.join(' '));
const partial = Object.keys(ECO).filter(k => (ECO[k].out||[]).some(id=>!!DEPOSITS[id]) && !allDep.includes(k));
console.log('Rows with SOME deposits but not all (gate waves through):', partial.join(' ') || '(none)');
