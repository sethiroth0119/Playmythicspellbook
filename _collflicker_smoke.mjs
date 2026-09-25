/* 🪞 bug-mu0kgo44 — "On the full card list screen there is flickering when
   hovering the mouse over a card in the list of owned cards and then major
   flickering when trying to view the card details. This causes difficulty
   selecting any buttons."

   Three causes, all in public/index.html (Inventory = renderCollection):
     1. every background render() rebuilt the whole screen from a string — the
        row under the pointer and every card image were replaced;
     2. the detail modal was re-created on each of those renders, replaying
        its .modal-backdrop fade-in — the "major" flicker — and swapping the
        Close button out between mousedown and mouseup;
     3. owned rows lost their gold gradient on :hover (the generic hover rules
        replace the background), a hard on/off blink per row.
   Verified in the browser pane (injected 14 cards, then renderNow() ×3): the
   same row node survives identical renders, the open modal's node and its
   Close button survive, a changed count re-renders the SAME card with
   `.ccm-still` (animation: none), a different card still fades in.

   This suite pins the structure (the DOM behaviour needs a browser):
     1. renderCollection builds `_collHtml` and returns early when it equals the
        mounted markup AND the mounted node is still #app's first child
     2. bindCollectionCardModal marks a same-card re-render `.ccm-still`
     3. the CSS kills the animation for `.ccm-still` and keeps an owned row's
        gradient on hover, and that hover rule comes AFTER the generic
        `[role="button"]:hover` rule it must beat (equal specificity)
     4. HEAD control (only while HEAD has the old code): the old
        renderCollection assigns root.innerHTML unconditionally.

   Run: node _collflicker_smoke.mjs */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fn(src, head) { const i = src.indexOf(head); if (i < 0) return ''; return src.slice(i, src.indexOf('\n}\n', i) + 3); }

console.log('\n=== 1. identical markup is not re-mounted ===');
{
  const rc = fn(SRC, 'function renderCollection()');
  ok(/const _collHtml = `/.test(rc), 'the screen markup is built as a string first');
  const guard = rc.indexOf('root.__collHtml === _collHtml');
  const mount = rc.indexOf('root.innerHTML = _collHtml');
  ok(guard > 0 && mount > guard, 'the equality guard runs before the mount');
  ok(/root\.firstElementChild === root\.__collNode/.test(rc), 'node identity is checked, not just the string');
  ok(/#ccm-modal-host #ccm-backdrop/.test(rc), 'an open modal must still be mounted for the skip');
}

console.log('\n=== 2. same-card modal re-render is marked still ===');
{
  const b = fn(SRC, 'function bindCollectionCardModal()');
  ok(/data-ccm-card/.test(b) && /classList\.add\('ccm-still'\)/.test(b), 'bindCollectionCardModal tags a same-card rebuild');
}

console.log('\n=== 3. CSS ===');
{
  ok(/\.ccm-backdrop\.ccm-still, \.ccm-backdrop\.ccm-still \.ccm-modal \{ animation: none !important; \}/.test(SRC), '.ccm-still disables the open animation');
  const own = SRC.indexOf('.forge-list-row.is-owned:hover {');
  const gen = SRC.indexOf('.forge-list-row[role="button"]:hover {');
  ok(own > 0 && /background: linear-gradient/.test(SRC.slice(own, own + 200)), 'owned hover keeps a gradient');
  ok(gen > 0 && own > gen, 'owned hover rule is after the equal-specificity generic rule');
}

console.log('\n=== 4. HEAD control ===');
{
  let head = null;
  try { head = execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'show', 'HEAD:public/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {}
  const old = head ? fn(head, 'function renderCollection()') : '';
  if (!old || /_collHtml/.test(old)) console.log('  (skipped: HEAD already carries the fix)');
  else ok(/\n  root\.innerHTML = `/.test(old) && !/__collHtml/.test(old), 'OLD renderCollection re-mounts on every render');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
