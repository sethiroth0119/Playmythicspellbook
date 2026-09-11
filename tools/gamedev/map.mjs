#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// map.mjs — find your way around 215k lines without reading them.
//
//   node tools/gamedev/map.mjs sections [--grep city]   # the `// ═══ TITLE` banner index with line numbers
//   node tools/gamedev/map.mjs where <name>              # where a function/const is DECLARED, which section it
//                                                        # lives in, how many call sites, and the first few
//   node tools/gamedev/map.mjs consts [--grep NODE]      # every top-level `const NAME = {|[` catalog, classified
//   node tools/gamedev/map.mjs modules                   # public/src ES modules + what each imports/exports
//   node tools/gamedev/map.mjs stats                     # size of the world
//
// index.html is organised by banner comments (`// ═══ 🤝 FACTION CONCORD … ═══` or a
// three-line box). Those banners are the file's table of contents; this reads them.
// Line numbers are HTML lines (what your editor shows), computed from the inline
// script's offset, so they stay right as the file grows.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, argFlag, argValue, positional, extractInlineScript } from './headless.mjs';

const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const script = extractInlineScript(html);
const lines = script.code.split('\n');
const L = (i) => i + script.startLine;
const [cmd, ...rest] = positional(['grep']);
const grep = argValue('grep');
const m = (s) => !grep || s.toLowerCase().includes(grep.toLowerCase());

function sections() {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*\/\/ ═{3,}/.test(l)) continue;
    let title = l.replace(/^\s*\/\/\s*/, '').replace(/═+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) {                                      // boxed banner: title on the next line
      const n = (lines[i + 1] || '').replace(/^\s*\/\/\s*/, '').replace(/═+/g, '').trim();
      if (n) { title = n; i++; }
      if (/^\s*\/\/ ═{3,}\s*$/.test(lines[i + 1] || '')) i++;   // skip the closing rule
    }
    if (title && (!out.length || out[out.length - 1].title !== title)) out.push({ line: L(i), title });
  }
  return out;
}
function sectionOf(htmlLine) {
  const s = sections(); let best = null;
  for (const x of s) { if (x.line <= htmlLine) best = x; else break; }
  return best;
}
const DECL = (name) => new RegExp('^(?:(?:async )?function ' + name + '\\s*\\(|(?:const|let|var) ' + name + '\\s*=|' + name + '\\s*[:=]\\s*(?:async\\s*)?(?:function|\\()|\\s{2}' + name + '\\s*\\(.*\\)\\s*\\{)');

if (cmd === 'sections') {
  const s = sections().filter((x) => m(x.title));
  s.forEach((x) => console.log(String(x.line).padStart(7) + '  ' + x.title.slice(0, 110)));
  console.log('\n' + s.length + ' section(s)' + (grep ? ' matching "' + grep + '"' : ''));
} else if (cmd === 'where') {
  const name = rest[0]; if (!name) { console.error('where <name>'); process.exit(1); }
  const decl = lines.findIndex((l) => DECL(name).test(l));
  const uses = []; const re = new RegExp('(^|[^\\w$.])' + name + '\\b');
  lines.forEach((l, i) => { if (i !== decl && re.test(l) && !/^\s*\/\//.test(l)) uses.push(i); });
  const modHits = [];
  for (const f of modulesList()) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) modHits.push(relative(ROOT, f) + ':' + (i + 1)); });
  if (decl === -1) console.log('no top-level declaration of "' + name + '" found in index.html (' + uses.length + ' reference(s))');
  else {
    const sec = sectionOf(L(decl));
    console.log('declared  public/index.html:' + L(decl) + '   ' + lines[decl].trim().slice(0, 100));
    if (sec) console.log('section   ' + sec.title.slice(0, 100) + '  (from line ' + sec.line + ')');
    let end = lines.findIndex((l, i) => i > decl && /^(?:async )?function |^const \w+ = /.test(l)); if (end === -1) end = lines.length;
    console.log('length    ~' + (end - decl) + ' lines');
  }
  console.log('uses      ' + uses.length + ' in index.html' + (modHits.length ? ', ' + modHits.length + ' in modules' : ''));
  uses.slice(0, argFlag('all') ? 1e9 : 12).forEach((i) => console.log('   ' + String(L(i)).padStart(7) + '  ' + lines[i].trim().slice(0, 100)));
  if (uses.length > 12 && !argFlag('all')) console.log('   … ' + (uses.length - 12) + ' more (--all)');
  modHits.slice(0, 8).forEach((h) => console.log('   ' + h));
} else if (cmd === 'consts') {
  const rows = [];
  lines.forEach((l, i) => { const mm = l.match(/^const ([A-Z][A-Z0-9_]+) = ([\[{]|new Set|new Map)/); if (mm && m(mm[1])) rows.push({ line: L(i), name: mm[1], kind: mm[2] === '[' ? 'list' : mm[2] === '{' ? 'dict' : mm[2], section: (sectionOf(L(i)) || {}).title || '' }); });
  rows.forEach((r) => console.log(String(r.line).padStart(7) + '  ' + r.kind.padEnd(7) + r.name.padEnd(34) + r.section.slice(0, 60)));
  console.log('\n' + rows.length + ' catalog const(s)');
} else if (cmd === 'modules') {
  for (const f of modulesList()) {
    const src = readFileSync(f, 'utf8');
    const imports = [...src.matchAll(/^import\s.*?from\s+['"]([^'"]+)['"]/gm)].map((x) => x[1]);
    const exports = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)|^export\s*\{([^}]+)\}/gm)].flatMap((x) => x[1] ? [x[1]] : x[2].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()));
    const bridge = /MythicBridge/.test(src);
    console.log(relative(ROOT, f).padEnd(44) + String(src.split('\n').length).padStart(6) + ' lines  ' + (bridge ? 'bridge ' : '       ') + (imports.length ? 'imports: ' + imports.join(', ') : '') + (exports.length ? '  exports: ' + exports.slice(0, 8).join(', ') + (exports.length > 8 ? '…' : '') : ''));
  }
  const loaded = [...html.matchAll(/<script type="module" src="([^"?]+)/g)].map((x) => x[1]);
  console.log('\nmodule entry points loaded by index.html: ' + loaded.join(', '));
} else if (cmd === 'stats') {
  const fns = lines.filter((l) => /^(?:async )?function |^const \w+ = (?:async )?\(/.test(l)).length;
  const consts = lines.filter((l) => /^const [A-Z][A-Z0-9_]+ = [\[{]/.test(l)).length;
  console.log('public/index.html: ' + html.split('\n').length + ' lines, ' + (html.length / 1048576).toFixed(1) + ' MB; inline script ' + lines.length + ' lines from html line ' + script.startLine);
  console.log('top-level functions ' + fns + ', catalog consts ' + consts + ', banner sections ' + sections().length + ', ES modules ' + modulesList().length);
} else {
  console.log('usage: map.mjs sections [--grep x] | where <name> [--all] | consts [--grep X] | modules | stats');
}

function modulesList() {
  const out = []; const d = join(ROOT, 'public', 'src'); if (!existsSync(d)) return out;
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(f)) out.push(p); } };
  walk(d); return out;
}
