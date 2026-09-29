#!/usr/bin/env node
/* 🚫 BUILT-IN MOCKUP CARDS — the gate on _hideBuiltins / _noBuiltins /
   _isBuiltinCardId in index.html.

   The bug this exists for: the camp Table listed 13 placeholder units (Orc
   Warrior, Ice Elemental, Cave Troll...) with bond tiers, as real companions.
   Forge.useCustomOnlyPool already promised "built-ins hidden everywhere" and
   was clamped ON in production; only three surfaces honoured it, and
   ensureAdminCardGrant() actively granted the placeholders into
   Profile.cardCollection, which the Table reads directly.

   ⚠ READ THE SOURCE THE WAY THE OTHER GATES DO. The first version of this file
     sliced the helper block with a '\n'-anchored end marker and read the file
     raw. A merge handed index.html CRLF and the anchor matched nothing, so the
     slice came back EMPTY and every assertion died on "_hideBuiltins is not
     defined" — a green-to-red flip that said nothing about the code. MP_SRC +
     \r\n normalisation, same as perspective.mjs and private-zones.mjs. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.MP_SRC || join(ROOT, 'public', 'index.html');
const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

const start = src.indexOf('function _hideBuiltins()');
const endMark = '  return true;\n}\n';
const endAt = src.indexOf(endMark, start);
if (start < 0 || endAt < 0) {
  console.log('❌ could not extract the built-in gate helpers from index.html');
  process.exit(1);
}
const body = src.slice(start, endAt + endMark.length);

const mk = (forge, units, customs) => new Function(
  `const Forge=${JSON.stringify(forge)};
   const UNIT_CARDS=${JSON.stringify(units)}; const SPELL_CARDS=[]; const TRAP_CARDS=[];
   const LOCATION_CARDS=[]; const WEATHER_CARDS=[]; const WALL_CARDS=[];
   const getAllCustomCards=()=>${JSON.stringify(customs)};
   ${body}
   return {_hideBuiltins,_noBuiltins,_isBuiltinCardId};`)();

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };
const UNITS = [{ id: 'orc', name: 'Orc Warrior' }, { id: 'goblin', name: 'Goblin Scout' }];

console.log('\n── built-in mockup cards ──');
let g = mk({ useCustomOnlyPool: true }, UNITS, [{ id: 'realCard' }]);
ok('production: built-ins are hidden', g._hideBuiltins() === true);
ok('production: a pool empties', g._noBuiltins(UNITS).length === 0);
ok('production: a built-in id is hidden', g._isBuiltinCardId('orc') === true);
ok('production: an unknown id is not hidden', g._isBuiltinCardId('nope') === false);

g = mk({ useCustomOnlyPool: true }, UNITS, [{ id: 'orc', name: 'Orc (forged)' }]);
ok('a forged card WINS an id collision', g._isBuiltinCardId('orc') === false);
ok('...and the others still hide', g._isBuiltinCardId('goblin') === true);

g = mk({ useCustomOnlyPool: false }, UNITS, []);
ok('dev mode: nothing is hidden', g._hideBuiltins() === false);
ok('dev mode: the pool passes through', g._noBuiltins(UNITS).length === 2);
ok('dev mode: no id is hidden', g._isBuiltinCardId('orc') === false);

const bare = new Function(`const UNIT_CARDS=[];const SPELL_CARDS=[];const TRAP_CARDS=[];
  const LOCATION_CARDS=[];const WEATHER_CARDS=[];const WALL_CARDS=[];
  ${body}
  return {_hideBuiltins};`)();
ok('no Forge at all → hide NOTHING (fail-open, never a blank game)', bare._hideBuiltins() === false);

/* The grant is the root cause, so assert the source directly: the built-in
   pools must sit behind the flag inside ensureAdminCardGrant. */
const grant = src.slice(src.indexOf('function ensureAdminCardGrant'), src.indexOf('function ownsHero'));
ok('ensureAdminCardGrant gates the built-in pools', /if \(!_hideBuiltins\(\)\) \{/.test(grant));
/* And the Table, which is the surface that was actually wrong. */
ok('the camp Table roster skips built-in ids', /if \(_isBuiltinCardId\(id\)\) continue;/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
