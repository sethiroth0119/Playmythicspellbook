/* 🔎 FIND-THE-EFFECT, part 5 — say nothing rather than say it twice.
   Screenshot of the spell picker: choosing the classic "⚡ Restore Energy"
   printed "⚡ Restore Energy" again on the explanation line, because the nine
   classics are hand-written above the engine list and most have no parenthetical
   to lift. An explanation that repeats the label is noise wearing a label's
   clothes; the line hides itself instead. */
import fs from 'node:fs';
const F = 'public/index.html';
let S = fs.readFileSync(F, 'utf8');
const n0 = S.length;
const find = `// The explanation under the picker. It is _onplayTypeDesc verbatim for anything
// in the registry — the driver asserts that equality — and falls back to the
// option's own parenthetical for the nine classic spell / seven classic trap
// effects, which are hand-written above the engine list and have no registry row.
function _fxFindDescribe(sel) {
  const box = sel && sel._fxFindDesc;
  if (!box) return;
  const o = sel.options[sel.selectedIndex];
  let txt = _onplayTypeDesc(sel.value);
  if (!txt && o && sel.value) txt = _fxLabelDesc(o.text) || String(o.text || '');
  box.textContent = txt;
  box.style.display = txt ? '' : 'none';
}`;
const repl = `// The explanation under the picker. It is _onplayTypeDesc verbatim for anything
// in the registry — the driver asserts that equality — and falls back to the
// option's own parenthetical for the nine classic spell / seven classic trap
// effects, which are hand-written above the engine list and have no registry row.
// ⚠ AND IT SHOWS NOTHING WHEN THERE IS NOTHING TO ADD. The first cut fell back
//   to the option's whole label, so picking the classic "⚡ Restore Energy"
//   printed "⚡ Restore Energy" a second line down — an explanation that repeats
//   the label is noise wearing a label's clothes. Most of the classics carry no
//   parenthetical, so the line hides itself for those and the row keeps its
//   height for the 118 that do have something to say.
function _fxFindDescribe(sel) {
  const box = sel && sel._fxFindDesc;
  if (!box) return;
  const o = sel.options[sel.selectedIndex];
  let txt = _onplayTypeDesc(sel.value);
  if (!txt && o && sel.value) txt = _fxLabelDesc(o.text);
  box.textContent = txt;
  box.style.display = txt ? '' : 'none';
}`;
const got = S.split(find).length - 1;
if (got !== 1) throw new Error('anchor matched ' + got + ', wanted 1');
S = S.split(find).join(repl);
fs.writeFileSync(F, S);
console.log('ok  bytes ' + n0 + ' -> ' + S.length);
