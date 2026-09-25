#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   🗒 COMMENT-SCAN — the gate _synckcheck.mjs structurally cannot be.

   THE BUG THAT BOUGHT THIS FILE. A block comment above the src/city module tag
   in public/index.html lost its OPENING marker at some point before HEAD. The
   eight lines inside it stopped being a comment and became BODY TEXT, so every
   player on every screen got a paragraph about service-worker cache busting
   printed under the UI, trailed by a stray closing marker. It was found in a
   screenshot, not by a tool.

   🔴 WHY THE EXISTING GATE COULD NEVER SEE IT. _synckcheck.mjs extracts the
      <script> blocks and parses each one. Every block parsed perfectly, before
      and after the damage, because the damage is in the HTML AROUND them. A
      passing syntax gate is not evidence about markup, and this project had no
      other check on it. CLEAN SYNTAX, BROKEN PAGE — the same shape as the
      Restaurant that was priced, labelled and unbuyable.

   ⚠ AND THE SECOND HALF, learned by breaking it while fixing it: neither
     marker may be QUOTED inside a comment. The opening one makes the comment
     non-conforming; the closing one ENDS the comment there and leaks the rest —
     which reproduced the original defect two lines below a paragraph describing
     it. So this scans for both, and a fix that describes itself too literally
     fails here rather than in front of a player.

   WHAT IT DOES. Strips raw-text elements (script/style — a marker inside them
   is not a comment), then walks the remaining markup:
     · an opening marker while already inside a comment  → nested, non-conforming
     · a closing marker while not inside one             → an orphan: text is
                                                            leaking onto the page
     · end of file still inside a comment                → the rest of the page
                                                            is swallowed

   Run:  node .gauntlet/comment-scan.mjs
         node .gauntlet/comment-scan.mjs public/foo.html
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OPEN = '<' + '!--';
const CLOSE = '--' + '>';   // built, not written, for the reason in the header

const FILES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'public/index.html',
      'public/node-city/index.html',
      'public/ethos-buy.html',
    ].filter((f) => fs.existsSync(path.join(ROOT, f)));

/* Raw-text elements: their contents are NOT markup, so a marker inside a script
   is just characters. Replaced with same-length blanks rather than removed, so
   every reported offset still points at the real place in the real file. */
function blankRawText(s) {
  return s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (m) => {
    const open = m.indexOf('>') + 1;
    const close = m.lastIndexOf('</');
    return m.slice(0, open) + ' '.repeat(close - open) + m.slice(close);
  });
}

function lineOf(s, idx) { return s.slice(0, idx).split('\n').length; }

let bad = 0;
for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  const src = fs.readFileSync(full, 'utf8');
  const scan = blankRawText(src);
  const re = new RegExp(OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|' + CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

  let m, depth = 0, openedAt = 0, problems = [], n = 0;
  while ((m = re.exec(scan))) {
    n++;
    if (m[0] === OPEN) {
      if (depth > 0) problems.push(rel + ':' + lineOf(src, m.index) + '  a comment opens INSIDE a comment (non-conforming)');
      else openedAt = m.index;
      depth++;
    } else {
      if (depth === 0) problems.push(rel + ':' + lineOf(src, m.index) + '  a comment CLOSES with none open — the lines above it are rendering as page text');
      else depth--;
    }
  }
  if (depth > 0) problems.push(rel + ':' + lineOf(src, openedAt) + '  a comment is never closed — everything after it is swallowed');

  if (problems.length) { bad += problems.length; console.log('❌ ' + problems.join('\n❌ ')); }
  else console.log('✅ ' + rel.padEnd(30) + n + ' comment markers, every one matched');
}

if (bad) {
  console.log('\n' + bad + ' problem(s). A page can render this and still pass every syntax gate —');
  console.log('the symptom is prose appearing under the UI, not an error in the console.');
  process.exit(1);
}
console.log('\n✅ markup comments are balanced.');
