/* 🧭 bug-mtylr070 ("Trouble scrolling") — "Not able to end a match have to
   re-refresh computer".

   The result card (.gameover-modal inside .gameover-backdrop) carries every
   way out of a finished match — Exit to Menu, Play Again, View Battlefield —
   at its BOTTOM. The backdrop was `overflow: hidden` and centred the card with
   align-items:center; the v120b1 card is ~1,100–1,200px tall, so on a laptop
   (≈640px of viewport) the buttons sat below the fold and nothing scrolled.
   Measured in the browser pane at 1366×640 with the real stylesheet and a
   1,100px card: before — overflow-y hidden, card top at −79px, exit button
   off-screen, not user-scrollable. After — overflow-y auto, card top at the
   padding, scrollable, exit visible after scrolling; a 200px card still sits
   centred (218→422 of 640) with nothing to scroll.

   Pinned here (CSS needs a browser to lay out; the rules are what matter):
     1. .gameover-backdrop scrolls (overflow-y:auto) and no longer centres with
        align-items:center; the card is centred with auto margins instead
     2. the spark/scanline layer is clipped, so it cannot pad the scroll height
     3. the battle camera's wheel-zoom ignores wheels over an overlay
     4. HEAD control (while HEAD has the old rule): overflow hidden, the bug.

   Run: node _gameoverscroll_smoke.mjs */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const rule = (src, sel) => { const i = src.indexOf('\n  ' + sel + ' {'); if (i < 0) return ''; return src.slice(i, src.indexOf('\n  }', i)); };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\n=== 1. the backdrop scrolls, the card centres by margin ===');
{
  const r = strip(rule(SRC, '.gameover-backdrop'));
  ok(/overflow-y:\s*auto/.test(r), 'overflow-y: auto');
  ok(!/overflow:\s*hidden/.test(r), 'no overflow: hidden');
  ok(/align-items:\s*flex-start/.test(r) && !/align-items:\s*center/.test(r.split('align-items: flex-start')[1] || ''), 'align-items ends as flex-start');
  ok(/\.gameover-backdrop > \.gameover-modal \{ margin: auto 0; flex-shrink: 0; \}/.test(SRC), 'card centred with auto margins, never shrunk');
}
console.log('\n=== 2. fx layer clipped ===');
ok(/overflow:\s*hidden/.test(rule(SRC, '.gameover-fx')), '.gameover-fx overflow hidden');
console.log('\n=== 3. wheel over an overlay is not camera zoom ===');
{
  const i = SRC.indexOf("document.addEventListener('wheel', function (e) {\n      if (!_bfLive()) return;");
  const body = i > 0 ? SRC.slice(i, i + 900) : '';
  ok(/closest\('\.gameover-backdrop, \.modal-backdrop, \[role="dialog"\]'\)\) return;/.test(body), 'battle wheel handler steps aside for overlays');
}
console.log('\n=== 4. HEAD control ===');
{
  let head = null;
  try { head = execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'show', 'HEAD:public/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {}
  const r = head ? strip(rule(head, '.gameover-backdrop')) : '';
  if (!r || /overflow-y:\s*auto/.test(r)) console.log('  (skipped: HEAD already carries the fix)');
  else ok(/overflow:\s*hidden/.test(r) && /align-items:\s*center/.test(r), 'OLD backdrop: overflow hidden + centred — the stuck result card');
}
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
