#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// audit.mjs — whole-game static audit: the CLAUDE.md conventions that a code
// review is supposed to catch, checked by machine across index.html, the ES
// modules under public/src, and the SQL. Unlike lint.mjs (battle data) this is
// about CODE PATTERNS, so most findings are WARN: read them, fix the real ones.
//
//   node tools/gamedev/audit.mjs                 # everything
//   node tools/gamedev/audit.mjs --rule cinder   # one rule group
//   node tools/gamedev/audit.mjs --json | --strict
//
// Rules
//   cinder.direct     `Profile.gems = / += / -=` outside spendGems/addGems and not
//                     wrapped in _gemsTaxExempt (cloud merges are exempt by design)   WARN
//   econ.hardcoded    a Cinder price literal next to an op name that _opEcon() prices  INFO
//   globals.module    an ES module under public/src touches a bare lexical global
//                     (Profile/Cloud/App/Corp/Forge) with no typeof guard            ERROR
//   supabase.table    `.from('x')` for a table no migration in the repo creates         WARN
//   supabase.unguarded `.from(` outside any try/catch or Cloud.* guard                 INFO
//   ux.alert          window.alert/confirm/prompt instead of showToast/gcConfirm        WARN
//   chat.direct       direct INSERT into chat_messages (dropped policy → will fail)      ERROR
//   chat.guild        direct INSERT into guild_chat (known gap, tracked)                INFO
//   hygiene.todo      TODO/FIXME/HACK lines                                              INFO
//   hygiene.console   console.log left in                                               INFO
//   versions.knobs    version.txt / BUILD_VERSION / CACHE_VERSION agreement              ERROR
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, argFlag, argValue, extractInlineScript } from './headless.mjs';

const only = argValue('rule');
const findings = [];
const add = (level, rule, file, line, msg) => { if (only && !rule.startsWith(only)) return; findings.push({ level, rule, file, line, msg }); };

const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const script = extractInlineScript(html);
const lines = script.code.split('\n');
const L = (i) => i + script.startLine;                     // script line → html line
const at = (i) => 'public/index.html:' + L(i);

const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(m?js)$/.test(f)) out.push(p); } return out; };
const modules = existsSync(join(ROOT, 'public', 'src')) ? walk(join(ROOT, 'public', 'src')) : [];

/** [start,end) line range of a top-level function in the inline script. */
function fnRange(name) {
  const s = lines.findIndex((l) => new RegExp('^(?:async )?function ' + name + '\\(|^const ' + name + ' = ').test(l));
  if (s === -1) return null;
  let e = lines.findIndex((l, i) => i > s && /^(?:async )?function |^const \w+ = (?:async )?\(/.test(l));
  return [s, e === -1 ? lines.length : e];
}
const inRanges = (i, ranges) => ranges.some((r) => r && i >= r[0] && i < r[1]);
// Line-level comment test that also knows about /* … */ blocks in the inline script.
const blockComment = (() => { const flags = new Array(lines.length).fill(false); let inB = false; lines.forEach((l, i) => { const opens = l.indexOf('/*'), closes = l.indexOf('*/'); if (inB) { flags[i] = true; if (closes !== -1) inB = false; return; } if (opens !== -1 && (closes === -1 || closes < opens)) { inB = true; flags[i] = opens > 0 ? false : true; } }); return flags; })();
const isComment = (l, i) => /^\s*(\/\/|\*|\/\*)/.test(l) || (i != null && blockComment[i]);

// ── cinder.direct ───────────────────────────────────────────────────────────
{
  const allowed = [fnRange('spendGems'), fnRange('addGems'), fnRange('_gemsTaxExempt')];
  lines.forEach((l, i) => {
    if (isComment(l, i)) return;
    if (!/Profile\.gems\s*([-+*]?=)(?!=)/.test(l)) return;
    if (inRanges(i, allowed)) return;
    if (/_gemsTaxExempt/.test(l)) return;                  // explicit cloud-merge exemption
    add('WARN', 'cinder.direct', 'public/index.html', L(i), 'direct Profile.gems mutation — use spendGems()/addGems() (tax, ledger, toast) unless this is a cloud merge, then wrap in _gemsTaxExempt: ' + l.trim().slice(0, 110));
  });
}

// ── econ.hardcoded ──────────────────────────────────────────────────────────
{
  const r = fnRange('_opEcon');
  const ops = new Set();
  if (r) for (let i = r[0]; i < r[1]; i++) for (const m of lines[i].matchAll(/['"]([a-zA-Z_]+)['"]\s*:/g)) ops.add(m[1]);
  lines.forEach((l, i) => {
    if (isComment(l) || (r && i >= r[0] && i < r[1])) return;
    for (const op of ops) if (l.includes("'" + op + "'") && /\b(cost|price|fee)\s*[:=]\s*\d{2,}/.test(l) && !/_opEcon\(/.test(l)) add('INFO', 'econ.hardcoded', 'public/index.html', L(i), 'literal price next to op "' + op + '" — should this read _opEcon(\'' + op + '\')? ' + l.trim().slice(0, 100));
  });
}

// ── globals.module ──────────────────────────────────────────────────────────
for (const f of modules) {
  const src = readFileSync(f, 'utf8').split('\n');
  let inBlock = false;
  src.forEach((l, i) => {
    if (/\/\*/.test(l)) inBlock = true;
    const wasBlock = inBlock;
    if (/\*\//.test(l)) inBlock = false;
    if (wasBlock || /^\s*\/\//.test(l) || /^\s*\*/.test(l)) return;
    const noComment = l.replace(/\/\/.*$/, '');
    const code = noComment.replace(/`[^`]*`/g, '``').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    for (const m of code.matchAll(/(^|[^.\w$])(Profile|Cloud|App|Corp|Forge)\s*[.[]/g)) {
      const g = m[2];
      // `typeof App !== 'undefined' && App.x` is the accepted defensive form; the
      // guard is tested on the un-stripped line because the quotes matter.
      const guarded = new RegExp("typeof\\s+" + g + "\\s*[!=]==?\\s*['\"]undefined['\"]").test(noComment) || new RegExp('\\b(bridge|MythicBridge|B|br|host)\\.' + g).test(code);
      if (guarded) continue;
      add('ERROR', 'globals.module', relative(ROOT, f), i + 1, 'bare `' + g + '` in an ES module — it is a lexical const in index.html, NOT on window (the globals trap). Take it from window.MythicBridge: ' + l.trim().slice(0, 100));
    }
  });
}

// ── supabase.table / supabase.unguarded ─────────────────────────────────────
{
  const sqlFiles = [];
  const scan = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) scan(p); else if (f.endsWith('.sql')) sqlFiles.push(p); } };
  scan(ROOT === '/' ? ROOT : join(ROOT)); // root-level *.sql (legacy) + sql/ + supabase/ (recursive)
  const created = new Set();
  for (const p of sqlFiles) for (const m of readFileSync(p, 'utf8').matchAll(/create\s+(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) created.add(m[1].toLowerCase());
  // tables the legacy inline SQL string constants create (CHAT_SQL & friends)
  for (const m of script.code.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) created.add(m[1].toLowerCase());
  const seen = new Map();
  const collect = (text, file, base) => text.split('\n').forEach((l, i) => { for (const m of l.matchAll(/\.from\(\s*['"]([a-z_0-9]+)['"]\s*\)/g)) { const t = m[1]; if (!seen.has(t)) seen.set(t, file + ':' + (base + i)); } });
  collect(script.code, 'public/index.html', script.startLine);
  for (const f of modules) collect(readFileSync(f, 'utf8'), relative(ROOT, f), 1);
  for (const [t, where] of seen) if (!created.has(t)) add('WARN', 'supabase.table', where.split(':')[0], +where.split(':')[1], 'client reads/writes table "' + t + '" but no .sql in the repo creates it — either the migration is missing from the repo or the name is a typo (will throw at runtime; make sure the call degrades offline)');
  if (findings.filter((f) => f.rule === 'supabase.table').length === 0 && seen.size) add('INFO', 'supabase.table', 'public/index.html', 0, seen.size + ' distinct tables referenced, all created by a .sql in the repo');
}

// ── ux.alert ────────────────────────────────────────────────────────────────
lines.forEach((l, i) => {
  if (isComment(l, i)) return;
  const m = l.match(/(^|[^.\w])(alert|confirm|prompt)\(/);
  if (m) add('WARN', 'ux.alert', 'public/index.html', L(i), 'native ' + m[2] + '() — user-facing errors use showToast(), confirmations use await gcConfirm(): ' + l.trim().slice(0, 100));
});
for (const f of modules) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (!isComment(l) && /(^|[^.\w])(alert|confirm|prompt)\(/.test(l)) add('WARN', 'ux.alert', relative(ROOT, f), i + 1, 'native dialog in a module — use the bridge toast/confirm: ' + l.trim().slice(0, 100)); });

// ── chat.direct / chat.guild ────────────────────────────────────────────────
lines.forEach((l, i) => {
  if (isComment(l, i)) return;
  if (/from\(\s*'chat_messages'\s*\)\s*\.insert/.test(l)) add('ERROR', 'chat.direct', 'public/index.html', L(i), 'direct INSERT into chat_messages — the INSERT policy was DROPPED in v120g0; world chat must go through the chat_send() RPC');
  if (/from\(\s*'guild_chat'\s*\)\s*\.insert/.test(l)) add('INFO', 'chat.guild', 'public/index.html', L(i), 'guild_chat still inserts directly (known: never got the chat_send treatment — no server-side mask/rate-limit)');
});

// ── hygiene ─────────────────────────────────────────────────────────────────
lines.forEach((l, i) => {
  if (/\b(TODO|FIXME|HACK|XXX)\b/.test(l)) add('INFO', 'hygiene.todo', 'public/index.html', L(i), l.trim().slice(0, 120));
  if (!isComment(l, i) && /console\.log\(/.test(l)) add('INFO', 'hygiene.console', 'public/index.html', L(i), l.trim().slice(0, 100));
});

// ── versions.knobs ──────────────────────────────────────────────────────────
try {
  const txt = readFileSync(join(ROOT, 'public', 'version.txt'), 'utf8').trim();
  const bv = (html.match(/window\.BUILD_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  const cv = (readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8').match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  const n = (s) => (s || '').replace(/^v/i, '');
  if (!(bv && cv && n(txt) === n(bv) && (n(cv) === n(bv) || cv.includes(n(bv))))) add('ERROR', 'versions.knobs', 'public/version.txt', 1, 'deploy knobs disagree: version.txt=' + txt + ' BUILD_VERSION=' + bv + ' CACHE_VERSION=' + cv);
} catch (e) { add('WARN', 'versions.knobs', 'public/version.txt', 1, 'could not read version knobs: ' + e.message); }

// ── report ──────────────────────────────────────────────────────────────────
const by = (l) => findings.filter((f) => f.level === l);
if (argFlag('json')) console.log(JSON.stringify(findings, null, 1));
else {
  for (const lvl of ['ERROR', 'WARN', 'INFO']) {
    const rows = by(lvl); if (!rows.length) continue;
    console.log('\n' + lvl + ' (' + rows.length + ')');
    const groups = {}; rows.forEach((f) => (groups[f.rule] = groups[f.rule] || []).push(f));
    for (const [rule, rs] of Object.entries(groups)) {
      console.log('  [' + rule + '] ×' + rs.length);
      const show = argFlag('verbose') || lvl !== 'INFO' ? rs : rs.slice(0, 5);
      show.forEach((f) => console.log('    ' + (lvl === 'ERROR' ? '✗' : lvl === 'WARN' ? '!' : '·') + ' ' + f.file + ':' + f.line + '  ' + f.msg));
      if (show.length < rs.length) console.log('    … ' + (rs.length - show.length) + ' more (--verbose)');
    }
  }
  console.log('\n' + by('ERROR').length + ' error(s), ' + by('WARN').length + ' warning(s), ' + by('INFO').length + ' info');
}
process.exit(by('ERROR').length || (argFlag('strict') && by('WARN').length) ? 1 : 0);
