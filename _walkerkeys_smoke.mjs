/* 🚶 WALKER KEYS — the Containment Lab and Hospital never latch a key (v121v54).

   Reported: "the character gets stuck moving in one direction randomly; they
   move normally, then when you interact with an object the controller breaks
   and the player cannot move correctly."

   Defends, by running the real attachInput / axisOf / step from
   public/src/biolab/player.js against a fake window:
     · a keyup that spells the key differently from its keydown (Shift held,
       Caps Lock) still releases it — keys are tracked by physical code;
     · pressing E / Space / Enter (interact) lets go of every movement key
       before the panel opens, so a swallowed keyup cannot latch;
     · a native dialog: the window regains focus with no keyup → keys drop;
     · a focused number field owns its keys: movement keys typed into it are
       ignored and any held key is released;
     · a lost keyup after auto-repeat has been seen expires after two seconds;
       with no repeat ever seen (repeat disabled), a held key never expires;
     · the stick lets go on a touchcancel that names another finger;
     · the hospital walks the same module (one movement rule).

   Run: node _walkerkeys_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/src/biolab/player.js', 'utf8')
  .replace(/^import[^\n]*\n/m, "const ROOM = { w: 20, d: 30 }; const colliders = () => [];\n")
  .replace(/^export (const|function) /gm, '$1 ');
function world() {
  const listeners = {};
  const on = (target) => (ev, fn) => { (listeners[target + ':' + ev] = listeners[target + ':' + ev] || []).push(fn); };
  const off = (target) => (ev, fn) => { const a = listeners[target + ':' + ev] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  const fire = (target, ev, e) => { (listeners[target + ':' + ev] || []).slice().forEach((f) => f(Object.assign({ type: ev, preventDefault() {}, changedTouches: [] }, e))); };
  const doc = { hidden: false, body: { tagName: 'BODY' }, activeElement: null, addEventListener: on('doc'), removeEventListener: off('doc') };
  doc.activeElement = doc.body;
  const win = { innerWidth: 1000, addEventListener: on('win'), removeEventListener: off('win') };
  const root = { querySelector: () => null, addEventListener: on('root'), removeEventListener: off('root') };
  let now = 1000;
  const ctx = { window: win, document: doc, Date: { now: () => now }, Math, Number, console, Object, Array, String };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const input = vm.runInContext('makeInput()', ctx);
  const calls = { interact: 0, exit: 0 };
  ctx.__root = root; ctx.__input = input; ctx.__cb = { onInteract: () => calls.interact++, onExit: () => calls.exit++ };
  const detach = vm.runInContext('attachInput(__root, __input, __cb)', ctx);
  const axis = () => vm.runInContext('axisOf(__input)', ctx);
  return { input, fire, doc, win, root, calls, detach, axis, tick: (ms) => { now += ms; }, ctx };
}
{
  const w = world();
  w.fire('win', 'keydown', { key: 'w', code: 'KeyW' });
  ok(w.axis().az === 1, 'W down → walking up the screen');
  w.fire('win', 'keyup', { key: 'W', code: 'KeyW' });            // Shift pressed mid-hold
  ok(w.axis().az === 0, 'keyup spelled "W" (Shift) still releases the key pressed as "w"');
  w.fire('win', 'keydown', { key: 'd', code: 'KeyD' });
  w.fire('win', 'keydown', { key: 'e', code: 'KeyE' });           // interact
  ok(w.calls.interact === 1 && w.axis().ax === 0 && w.axis().mag === 0, 'interact lets go of every movement key before the panel opens');
  w.fire('win', 'keyup', { key: 'e', code: 'KeyE' });
}
{
  const w = world();
  w.fire('win', 'keydown', { key: 'a', code: 'KeyA' });
  ok(w.axis().ax === -1, 'A down');
  w.fire('win', 'focus', {});                                     // a native confirm() closed: focus returns, no keyup ever comes
  ok(w.axis().ax === 0, 'window focus (a dialog closed) drops every held key');
  w.fire('win', 'keydown', { key: 's', code: 'KeyS' });
  w.doc.hidden = true; w.fire('doc', 'visibilitychange', {});
  ok(w.axis().az === 0, 'a hidden tab drops every held key');
  w.doc.hidden = false;
}
{
  const w = world();
  w.fire('win', 'keydown', { key: 'w', code: 'KeyW' });
  const field = { tagName: 'INPUT', isContentEditable: false };
  w.doc.activeElement = field; w.fire('doc', 'focusin', { target: field });
  ok(w.axis().az === 0, 'focusing a number field releases the held key');
  w.fire('win', 'keydown', { key: 'w', code: 'KeyW' });
  ok(w.axis().az === 0, 'a movement key typed into the field does not walk');
  w.doc.activeElement = w.doc.body;
}
{
  const w = world();
  w.fire('win', 'keydown', { key: 'd', code: 'KeyD' });
  w.tick(5000);
  ok(w.axis().ax === 1, 'with no auto-repeat ever seen, a held key never expires (repeat disabled in the OS)');
  w.fire('win', 'keydown', { key: 'd', code: 'KeyD', repeat: true });
  w.tick(1000);
  ok(w.axis().ax === 1, 'one second after the last repeat the key is still down');
  w.tick(1500);
  ok(w.axis().ax === 0 && !w.input.keys.d, 'a lost keyup: 2.5 s after the last repeat the key has expired and is forgotten');
  w.fire('win', 'keydown', { key: 'd', code: 'KeyD', repeat: true });
  ok(w.axis().ax === 1, 'the next repeat brings it straight back');
}
{
  const w = world();
  w.input.keys.w = true;                                          // the old shape tests and the stick may write
  w.tick(60000);
  ok(w.axis().az === 1, 'a literal true never expires');
}
{
  const w = world();
  w.fire('root', 'touchstart', { changedTouches: [{ identifier: 7, clientX: 200, clientY: 400 }] });
  w.fire('root', 'touchmove', { changedTouches: [{ identifier: 7, clientX: 200, clientY: 340 }] });
  ok(w.input.stickY > 0.9, 'the stick pushed forward');
  w.fire('root', 'touchcancel', { changedTouches: [{ identifier: 99, clientX: 0, clientY: 0 }] });
  ok(w.input.stickY === 0, 'a touchcancel naming another finger still lets go of the stick');
}
{
  const w = world();
  w.fire('win', 'keydown', { key: 'w', code: 'KeyW' });
  w.detach();
  ok(w.axis().mag === 0, 'detach drops everything');
  w.fire('win', 'keydown', { key: 'w', code: 'KeyW' });
  ok(w.axis().mag === 0, 'and no listener survives it');
}
ok(/import \{ makePlayer, makeInput, step, attachInput \} from '\.\.\/biolab\/player\.js'/.test(readFileSync('./public/src/hospital/index.js', 'utf8')), 'the hospital walks the same module');
ok(/input\.keys = \{\};\n\s*onInteract\(\);/.test(readFileSync('./public/src/biolab/player.js', 'utf8')), 'source: interact clears keys before calling out');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
