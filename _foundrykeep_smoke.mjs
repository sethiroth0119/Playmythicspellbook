/* ♻️ FOUNDRY KEEP SMOKE — bug-mtzmjvgz (Trash Crusher minigame = the Foundry).
   "Spent a chunk of time and significant amount of cinder developing the Trash
   Crusher minigame. Logged back in today and all the progress has reset."

   Measured in user_profiles_history (read-only, 2026-09-17): six foundries
   replaced by a blank one between 09-12 and 09-16 (Sausage: 8 machines, 2,151
   bytes -> 86 bytes at 2026-09-12 22:14 UTC), each time by a state whose
   lastTick was NEWER — a device that booted without the foundry re-creates it
   with lastTick = now. And the merge compared `lastTick | 0`, which is negative
   for every real 2026-09 timestamp while `{}` reads 0.

   The shipped functions are cut out and RUN. Negative control: HEAD's merge
   keeps the blank local over the real cloud foundry.
   Run: node _foundrykeep_smoke.mjs */
import { readFileSync } from 'fs';
/* Negative controls read the commit BEFORE the fix (767bf27084), not HEAD: once
   the fix was committed (1f9779cdde) HEAD carries it and the controls went red
   for the wrong reason. PRE_FIX_REF=HEAD shows the pin matters. */
import { execSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const MOD = readFileSync('./public/src/foundry/index.js', 'utf8');
let HEAD = '';
try { HEAD = execSync('git -c core.eol=lf -c core.autocrlf=false show ' + (process.env.PRE_FIX_REF || '767bf27084') + ':public/index.html', { maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) {}
function fnText(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; } else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const T_REAL = Date.parse('2026-09-12T22:00:44Z'), T_BLANK = Date.parse('2026-09-12T22:14:21Z');
const REAL = { v: 1, inv: { steel: { qty: 40, purity: 0.7 } }, machines: { crusher: { lv: 3 }, baler: { lv: 2 } }, trim: 0.5, lastTick: T_REAL, log: [] };
const BLANK = { v: 1, inv: {}, machines: {}, trim: 0.5, lastTick: T_BLANK, log: [] };

console.log('\n=== 1. the merge never lets a blank foundry replace a real one ===');
{
  const merge = new Function(fnText(SRC, '_foundryHasProgress') + '\n' + fnText(SRC, '_foundryMergeState') + '\nreturn _foundryMergeState;')();
  ok(merge(BLANK, REAL) === REAL, 'blank local (newer tick) vs real cloud -> the REAL one');
  ok(merge({}, REAL) === REAL, '{} local vs real cloud -> the REAL one');
  ok(merge(REAL, BLANK) === REAL, 'real local vs blank cloud (newer tick) -> the REAL one');
  const newer = Object.assign({}, REAL, { lastTick: T_REAL + 60000, machines: { crusher: { lv: 4 } } });
  ok(merge(REAL, newer) === newer && merge(newer, REAL) === newer, 'two real ones -> the newer clock, compared as Number (not | 0)');
  ok((T_REAL | 0) < 0, 'measurement: a 2026-09 Date.now() is negative after | 0 (' + (T_REAL | 0) + ')');
}
{
  const headMerge = new Function(fnText(HEAD, '_foundryMergeState') + '\nreturn _foundryMergeState;')();
  ok(headMerge({}, REAL) !== REAL && headMerge(BLANK, REAL) === BLANK, 'negative control: HEAD keeps the blank local over the real cloud foundry');
}

console.log('\n=== 2. a blank device never uploads over the real foundry ===');
{
  const Profile = { cloud: { userId: 'U1' }, foundry: BLANK };
  const api = new Function('Profile', 'var _foundrySeen = null;\n' + fnText(SRC, '_foundryHasProgress') + '\n' + fnText(SRC, '_foundryUploadValue') +
    '\nreturn { up: _foundryUploadValue, see: (s) => { _foundrySeen = s; } };')(Profile);
  api.see({ uid: 'U1', foundry: REAL });
  ok(api.up() === REAL, 'blank local -> uploads the foundry the cloud last held');
  Profile.foundry = Object.assign({}, REAL, { lastTick: T_REAL + 5 });
  ok(api.up() === Profile.foundry, 'a real local always uploads itself');
  Profile.cloud.userId = 'U2'; Profile.foundry = {};
  ok(JSON.stringify(api.up()) === '{}', 'another account never receives U1\'s foundry');
  ok(/__foundry__: _foundryUploadValue\(\),/.test(SRC), 'the uploader uses it');
  ok(/if \(_foundryHasProgress\(_cfd\)\) _foundrySeen = /.test(SRC), 'the fetch records what the cloud held before any early return');
  ok(/^var _foundrySeen = null;/m.test(SRC), '`var`, so an early read is null, never a TDZ throw');
}

console.log('\n=== 3. the module follows the live Profile.foundry, and a failed save is a failure ===');
{
  const m = MOD.match(/function state\(\) \{[\s\S]*?\n\}/);
  ok(!!m, 'found state()');
  let live = { machines: {} };
  const ensureState = (h) => { const s = h.foundryState(); s.inv = s.inv || {}; return s; };
  const h = { foundryState: () => live };
  const state = new Function('host', 'ensureState', 'let _st = null;\n' + m[0] + '\nreturn state;')(() => h, ensureState);
  const a = state();
  live = { machines: { crusher: { lv: 1 } } };                 // the cloud merge swaps the object
  const b = state();
  ok(a !== b && b === live, 'after Profile.foundry is replaced, builds go into the NEW object (not an orphan)');
  ok(/save: \(\) => \{ try \{ return saveProfile\(\) !== false; \} catch \(e\) \{ return false; \} \},\s*\n\s*\/\/ ⏱ The game's EXISTING idle contract/.test(SRC), 'the Foundry bridge save reports saveProfile()\'s false');
  ok(/src\/foundry\/index\.js\?v=v121v117foundry6/.test(SRC), 'module cache-bust bumped');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
