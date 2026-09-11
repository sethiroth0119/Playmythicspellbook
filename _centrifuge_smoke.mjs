/* 🌀 THE CENTRIFUGE TRAPPED THE PLAYER (v121v73).

   Reported: "the button do not work and it makes the player stuck in the modal
   and they cannot exit, they cannot stop the rotor."

   BOTH buttons were dead, and that is the tell. The rotor tick called the
   panel's full render EVERY FRAME, and modal() assigns host.innerHTML — so
   every button inside it was destroyed and rebuilt ~60 times a second. A click
   only fires when mousedown and mouseup land on the SAME element, which at
   that rate essentially never happens. Nothing was wrong with either handler;
   they were never reached.

   The needle's x position is the only thing that changes between frames, so
   only that is written now, and the panel re-renders solely when its content
   really changes (start / stop / result).

   Run: node _centrifuge_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const HUD = readFileSync('./public/src/biolab/hud.js', 'utf8');
const IDX = readFileSync('./public/src/biolab/index.js', 'utf8');

/* ── the per-frame rebuild is gone ── */
{
  const i = IDX.indexOf('if (run.spin && run.spin.running) {');
  const seg = IDX.slice(i, i + 1400);
  ok(i > 0, 'the rotor tick is still there');
  ok(/HUD\.centrifugeMove\(run\.nodes, run\.spin\.pos\)/.test(seg), 'it MOVES the needle');
  ok(!/^\s*if \(run\.spinRender && run\.panel === 'centrifuge'\) run\.spinRender\(\);/m.test(seg),
    'and no longer rebuilds the whole modal every frame');
  {
    /* The fallback may call the full render, but only when the needle is
       missing — never unconditionally. */
    const iFall = seg.indexOf('if (!moved && run.spinRender) run.spinRender();');
    ok(iFall > 0, 'a full render survives only as a fallback for a missing needle');
    /* Count CALLS, not mentions — the comment above the fix names the function
       it replaced, and that is documentation, not a second rebuild. */
    const code = seg.replace(/\/\*[\s\S]*?\*\//g, '');
    ok((code.match(/run\.spinRender\(\)/g) || []).length === 1,
      'and it is the ONLY spinRender call left in the tick',
      String((code.match(/run\.spinRender\(\)/g) || []).length));
  }
}

/* ── the needle move, run for real ── */
{
  let html = '<div class="bl-spin"><u></u><i style="left:0%"></i></div>';
  const needle = { style: { left: '0%' } };
  const host = { querySelector: (sel) => (sel === '.bl-spin i' ? needle : null), innerHTML: html };
  const ctx = { console };
  vm.createContext(ctx);
  const i = HUD.indexOf('export function centrifugeMove(');
  const body = HUD.slice(i, HUD.indexOf('\n}', i) + 2).replace('export ', '');
  vm.runInContext(body, ctx);
  ctx.__host = { modalhost: host };
  const move = (p) => vm.runInContext('centrifugeMove(__host,' + p + ')', ctx);

  ok(move(0.5) === true, 'it reports that it moved');
  ok(needle.style.left === '50%', 'the needle is placed by percentage', needle.style.left);
  move(0.25); ok(needle.style.left === '25%', 'and follows the rotor', needle.style.left);
  move(2);    ok(needle.style.left === '100%', 'a position past the end clamps rather than escaping the track', needle.style.left);
  move(-1);   ok(needle.style.left === '0%', 'and so does one before the start', needle.style.left);
  ok(host.innerHTML === html, 'THE PANEL HTML IS NEVER TOUCHED — that is the whole fix', host.innerHTML === html ? '' : 'rewritten');
  {
    /* No needle on screen (the panel was replaced) must report false so the
       caller can fall back, not throw into the frame loop. */
    const ctx2 = { console };
    vm.createContext(ctx2);
    vm.runInContext(body, ctx2);
    ctx2.__none = { modalhost: { querySelector: () => null } };
    ok(vm.runInContext('centrifugeMove(__none,0.5)', ctx2) === false, 'a missing needle reports false instead of throwing');
    ctx2.__bad = {};
    ok(vm.runInContext('centrifugeMove(__bad,0.5)', ctx2) === false, 'and so does a missing modal host');
  }
}

/* ── both buttons still exist and still say what they do ── */
{
  const i = HUD.indexOf('export function centrifugePanel(');
  const seg = HUD.slice(i, i + 1400);
  ok(/data-act="spin-stop"/.test(seg), 'STOP THE ROTOR is still wired to spin-stop');
  ok(/data-act="close"/.test(seg), 'and CLOSE is still wired to close');
  ok(/state\.running \? 'STOP THE ROTOR' : 'START'/.test(seg), 'the primary button flips between START and STOP');
}
{
  /* The close path must actually clear the spin state, or reopening the bench
     would drop the player back into a running rotor. */
  const i = IDX.indexOf("if (act === 'close') { run.spin = null; run.panel = null; HUD.closeModal(run.nodes); return; }");
  ok(i > 0, 'closing clears the rotor state as well as the panel');
}
ok(/mousedown and mouseup/.test(IDX) || /mousedown AND mouseup/.test(HUD), 'the reason is written down where the next person will look');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
