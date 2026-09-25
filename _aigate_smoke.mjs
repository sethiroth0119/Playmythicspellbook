/* ============================================================================
 * _aigate_smoke.mjs — 🤖 AI WAIT GATE gate.            node _aigate_smoke.mjs
 * ----------------------------------------------------------------------------
 * _runAIStepWhenClear refuses to step while a cinematic, the battle loader or a
 * player prompt is up. Each of those branches REFRESHES App._aiLastSchedule on
 * every 140ms poll, deliberately, so the 8s hang watchdog stays calm while a
 * real cinematic plays.
 *
 * 🔴 THAT IS ALSO WHY A LEAKED OVERLAY IS SO EXPENSIVE. If _anyCinematicActive()
 * is wedged true, the watchdog can never trip and the AI sits out the FULL 9s
 * cap in silence, on every turn, for the rest of the match — reported as "the AI
 * does nothing and then ends its turn". The stale guard is what bounds it, and
 * this asserts the guard rather than the comment.
 * ==========================================================================*/
import fs from 'fs';
const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : '   <-- ' + extra)); if (!c) fails++; };

/* pull the real function out of the page */
const m = /function _anyCinematicActive\(\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_anyCinematicActive found', !!m);
if (!m) { process.exit(1); }

/* a mock document with exactly the overlay behaviour the function relies on */
function run(nodes, nowMs) {
  const doc = {
    querySelectorAll: () => nodes,
    querySelector: () => (nodes.length ? nodes[0] : null),
  };
  const box = { document: doc, App: { ui: {} }, console: { warn() {} }, Date: { now: () => nowMs } };
  const fn = new Function('document', 'App', 'console', 'Date',
    m[0] + '\nreturn _anyCinematicActive();');
  return fn(box.document, box.App, box.console, box.Date);
}

const mk = () => ({ id: 'ace-slam-overlay', className: 'spell-cine-overlay' });

/* 1 — a fresh overlay blocks */
const a = [mk()];
ok('a fresh overlay still blocks the AI', run(a, 1000) === true);

/* 2 — the same node, seen 5s ago, still blocks (a real cinematic runs ~6.4s) */
ok('an overlay 5s old still blocks (real cinematics run ~6.4s)',
   run(a, 6000) === true, 'stamped at ' + a[0]._cineSeen);

/* 3 — past the stale window it stops blocking */
ok('an overlay past 12s stops blocking (the leak is bounded)',
   run(a, 1000 + 12001) === false,
   'a leaked overlay would otherwise cost 9s of silence on EVERY AI turn');

/* 4 — no overlays at all */
ok('no overlay, no block', run([], 1) === false);

/* 5 — the stamp is per node, so a NEW overlay after a stale one still blocks */
const fresh = mk();
ok('a new overlay after a stale one blocks again', run([fresh], 99999) === true);

/* the diagnostic + the tags */
ok('the wait is tagged so a stuck gate can be named', /_aiWaitWhy = 'cinematic overlay'/.test(SRC));
ok('…and the loading gate', /_aiWaitWhy = 'battle loading/.test(SRC));
ok('…and the modal gate', /_aiWaitWhy = 'player prompt/.test(SRC));
ok('a long wait is reported once, with the gate name',
   /\[ai\] waited ' \+ waited \+ 'ms on: '/.test(SRC));
ok('the stale overlay names itself in the console exactly once',
   /_cineStaleLogged/.test(SRC));

console.log('');
if (fails) { console.log('❌ ' + fails + ' FAILED'); process.exit(1); }
console.log('✅ ALL PASS');
