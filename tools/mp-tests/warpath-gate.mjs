#!/usr/bin/env node
/* 🗺 WARPATH ADMIN GATE — the three-state gate on the Warpath menu entry.
   During the admin-only phase the mode must be VISIBLE AND DEAD for players:
   greyed in both menus, refused on click, and never able to issue an RPC.
   Two ways to get this wrong and both are bad — letting players in (they hit
   an error, or worse a half-applied database), or locking the admin out of the
   thing they are trying to build.

   ⚠ CRLF. index.html is \r\n in this working tree, so anchors are normalised
     the way every other gate here does it. A '\n' anchor matches ZERO times
     and reports a real check as vacuously fine. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.MP_SRC || join(ROOT, 'public', 'index.html');
const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

const start = src.indexOf('const WARPATH_ADMIN_ONLY');
const endMark = '  try { return (typeof isAdmin === \'function\') && isAdmin(); } catch (e) { return false; }\n}\n';
const endAt = src.indexOf(endMark, start);
if (start < 0 || endAt < 0) {
  console.log('❌ could not extract the Warpath gate from index.html');
  process.exit(1);
}
let body = src.slice(start, endAt + endMark.length);

const mk = (killed, admin, adminOnly) => {
  const b = adminOnly ? body : body.replace('const WARPATH_ADMIN_ONLY = true;', 'const WARPATH_ADMIN_ONLY = false;');
  return new Function(`
    const localStorage = { getItem: (k) => (${killed} && k === 'hg_warpath') ? '0' : null };
    const isAdmin = () => ${admin};
    ${b}
    return { warpathVisible, warpathEnabled };`)();
};

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

console.log('\n── warpath admin gate ──');
let g = mk(false, true, true);
ok('admin: entry is visible', g.warpathVisible() === true);
ok('admin: mode is ENABLED', g.warpathEnabled() === true);

g = mk(false, false, true);
ok('player: entry is VISIBLE (greyed, not hidden)', g.warpathVisible() === true);
ok('player: mode is NOT enabled', g.warpathEnabled() === false);

g = mk(true, true, true);
ok('kill switch beats admin: not visible', g.warpathVisible() === false);
ok('kill switch beats admin: not enabled', g.warpathEnabled() === false);

g = mk(false, false, false);
ok('ADMIN_ONLY=false opens it to players', g.warpathEnabled() === true);

g = mk(true, false, false);
ok('...but the kill switch still wins', g.warpathEnabled() === false);

/* The surfaces. Greyed-but-clickable would be worse than hidden, so assert the
   refusals exist rather than trusting the CSS. */
ok('classic hub tile shows-but-locks', /locked: \(\) => !\(typeof warpathEnabled === 'function' && warpathEnabled\(\)\)/.test(src));
ok('classic hub click refuses a locked tile', /if \(sec\.locked && sec\.locked\(\)\) \{ try \{ showToast\(sec\.lockMsg/.test(src));
ok('cinematic mm:nav refuses a locked section', (src.match(/if \(sec\.locked && sec\.locked\(\)\)/g) || []).length >= 2);
ok('the gate itself still refuses', /if \(!warpathEnabled\(\)\) \{\n\s*showToast\(warpathVisible\(\)/.test(src));
ok('the drain stays on warpathEnabled', /if \(warpathEnabled\(\) && warpathEverEntered\(\)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
