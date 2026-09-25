/* 🔎 FIND-THE-EFFECT, part 3 — the heading count follows the filter.
   Screenshot of the first cut: filtering to "discard" left the heading reading
   "🃏 Cards & Hand · 1 of 2 (7)" over THREE rows. A count on screen that does
   not match what is under it is a wrong number, and this file's house rule is
   that wrong numbers get fixed rather than explained. */
import fs from 'node:fs';
const F = 'public/index.html';
let S = fs.readFileSync(F, 'utf8');
const n0 = S.length;
let step = 0;
function sub(name, find, repl, want = 1) {
  const parts = S.split(find);
  const got = parts.length - 1;
  if (got !== want) throw new Error('anchor "' + name + '": matched ' + got + ', wanted ' + want);
  S = parts.join(repl);
  console.log('  ok ' + String(++step).padStart(2) + '  ' + name + '  (' + got + ')');
}

sub('optgroup-live-count',
`  // a heading with nothing left under it is a heading over empty space
  sel.querySelectorAll('optgroup').forEach(g => {
    let live = 0;
    for (let i = 0; i < g.children.length; i++) if (!g.children[i].hidden) live++;
    g.hidden = live === 0;
    g.classList.toggle('fx-nomatch', live === 0);
  });`,
`  // A heading with nothing left under it is a heading over empty space — and a
  // heading whose "(n)" no longer counts what is under it is a wrong number on
  // screen, which is worse. The unfiltered label is stashed on first touch and
  // the count is rewritten to the live one while a needle is typed.
  sel.querySelectorAll('optgroup').forEach(g => {
    let live = 0;
    for (let i = 0; i < g.children.length; i++) if (!g.children[i].hidden) live++;
    g.hidden = live === 0;
    g.classList.toggle('fx-nomatch', live === 0);
    if (g.dataset.fxLabel == null) g.dataset.fxLabel = g.label;
    g.label = needle ? g.dataset.fxLabel.replace(/\\(\\d+\\)\\s*$/, '(' + live + ')') : g.dataset.fxLabel;
  });`);

fs.writeFileSync(F, S);
console.log('bytes ' + n0 + ' -> ' + S.length + '  (+' + (S.length - n0) + ')');
