#!/usr/bin/env node
/* 🗺 WARPATH GATE — the FOUR-state gate on the Warpath menu entry.
   The mode is UNSEALED FOR ADMINS ONLY: the admin can run it, everyone else
   keeps the greyed, inert entry, and the kill switch still hides it from both.
   Three ways to get this wrong and all three are bad: letting players in (they
   hit content that is not finished), locking the admin out of their own tool,
   or hiding the entry instead of greying it so nobody can see the mode coming.

   ⚠ WHY A FOURTH STATE AND NOT A FLIP OF WARPATH_ADMIN_ONLY. Setting
     WARPATH_ADMIN_ONLY = true leaves the admin account able to run the mode,
     which is the exact back door being closed here; and the 'hg_warpath' kill
     switch HIDES the entry rather than greying it. Neither shipped flag can
     express visible-and-dead-for-everyone, so WARPATH_MODE_OPEN is its own
     constant. If this ever gets "simplified" back onto WARPATH_ADMIN_ONLY, the
     admin cases below go red.

   ⚠ CRLF. index.html is \r\n in this working tree, so anchors are normalised
     the way every other gate here does it. A '\n' anchor matches ZERO times
     and reports a real check as vacuously fine. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.MP_SRC || join(ROOT, 'public', 'index.html');
const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

/* The block starts at WARPATH_MODE_OPEN, not WARPATH_ADMIN_ONLY — starting at
   the old anchor would slice the new constant off the front of the extracted
   body and every evaluation below would throw ReferenceError. */
const start = src.indexOf('const WARPATH_MODE_OPEN');
const endMark = '  try { return (typeof isAdmin === \'function\') && isAdmin(); } catch (e) { return false; }\n}\n';
const endAt = src.indexOf(endMark, start);
if (start < 0 || endAt < 0) {
  console.log('❌ could not extract the Warpath gate from index.html');
  process.exit(1);
}
let body = src.slice(start, endAt + endMark.length);

/* `open` is optional ON PURPOSE. Passing it substitutes WARPATH_MODE_OPEN so
   the admin-only logic can still be exercised in isolation; OMITTING it runs
   the SHIPPED constant, which is what makes "the mode is sealed right now"
   a falsifiable claim rather than a restatement of the substitution. */
const mk = (killed, admin, adminOnly, open) => {
  let b = body.replace(/const WARPATH_ADMIN_ONLY = (?:true|false);/,
                       'const WARPATH_ADMIN_ONLY = ' + (adminOnly ? 'true' : 'false') + ';');
  if (open !== undefined) {
    b = b.replace(/const WARPATH_MODE_OPEN = (?:true|false);/,
                  'const WARPATH_MODE_OPEN = ' + (open ? 'true' : 'false') + ';');
  }
  return new Function(`
    const localStorage = { getItem: (k) => (${killed} && k === 'hg_warpath') ? '0' : null };
    const isAdmin = () => ${admin};
    ${b}
    return { warpathVisible, warpathEnabled };`)();
};

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

console.log('\n── warpath gate: the SHIPPED state — unsealed, admins only ──');
/* 🔓 THE SHIPPED STATE IS NOW UNSEALED, ADMINS ONLY.
   This block used to assert the mode was sealed against everyone. That was the
   intent then; the owner has since asked for admin access, so the assertion
   moves with the intent rather than being deleted — the point of the block is
   "the shipped constants are what we meant", not any particular answer.

   ⚠ STILL FALSIFIABLE ON THE SHIPPED FILE. `open` is omitted throughout, so
     WARPATH_MODE_OPEN is read from index.html: if a later hand re-seals it, the
     admin row below goes red. `adminOnly` is a required parameter of mk() and
     is therefore ALWAYS substituted — so it is pinned separately, by reading
     the constant out of the file directly. Without that pin this block would
     pass just as happily with the mode open to everyone, which is the one
     outcome it most needs to catch. */
ok('the shipped file really is ADMIN_ONLY (not open to all)',
   /const WARPATH_ADMIN_ONLY = true;/.test(body));

let g = mk(false, false, true);
ok('non-admin: entry is VISIBLE (greyed, not hidden)', g.warpathVisible() === true);
ok('non-admin: mode is NOT enabled — admins only', g.warpathEnabled() === false);

g = mk(false, true, true);
ok('ADMIN: entry is VISIBLE', g.warpathVisible() === true);
ok('ADMIN: mode IS enabled — this is the access that was asked for', g.warpathEnabled() === true);

g = mk(true, true, true);
ok('kill switch beats the admin: not visible (HIDDEN, not greyed)', g.warpathVisible() === false);
ok('kill switch beats the admin: not enabled either', g.warpathEnabled() === false);

console.log('\n── warpath gate: the other three states still work (substituted) ──');
g = mk(false, true, true, true);
ok('unsealed + admin-only: admin is enabled', g.warpathEnabled() === true);

g = mk(false, false, true, true);
ok('unsealed + admin-only: player is visible but not enabled', g.warpathVisible() === true && g.warpathEnabled() === false);

g = mk(false, false, false, true);
ok('unsealed + open to all: player is enabled', g.warpathEnabled() === true);

g = mk(true, true, false, true);
ok('...but the kill switch still wins over everything', g.warpathVisible() === false && g.warpathEnabled() === false);

/* The surfaces. Greyed-but-clickable would be worse than hidden, so assert the
   refusals exist rather than trusting the CSS. */
console.log('\n── the surfaces ──');
ok('classic hub tile shows-but-locks', /locked: \(\) => !\(typeof warpathEnabled === 'function' && warpathEnabled\(\)\)/.test(src));
ok('classic hub click refuses a locked tile', /if \(sec\.locked && sec\.locked\(\)\) \{ try \{ showToast\(sec\.lockMsg/.test(src));
ok('cinematic mm:nav refuses a locked section', (src.match(/if \(sec\.locked && sec\.locked\(\)\)/g) || []).length >= 2);
ok('the gate itself still refuses', /if \(!warpathEnabled\(\)\) \{\n\s*showToast\(warpathVisible\(\)/.test(src));

/* ⚠ THE MOUNT IS THE THIRD DOOR. _warpathOpen() is exposed as
   window.__mg.warpath.open and is called unconditionally at the tail of
   warpathAfterBattle(); with no check of its own, both walked past the gate
   above. Anchored as "immediately after the opening brace" so a later edit
   cannot slip a mount ahead of the refusal. */
ok('_warpathOpen() refuses the moment it is entered',
   /function _warpathOpen\(\) \{\n  if \(!warpathEnabled\(\)\) return;\n/.test(src));

/* The seal must NOT freeze owed extractions — warpath_grants is an outbox the
   server has already written. The drain therefore sits on its own predicate. */
console.log('\n── the extraction drain is exempt from the seal ──');
ok('a separate drain predicate exists, on the kill switch alone',
   /function warpathDrainEnabled\(\) \{ return warpathVisible\(\); \}/.test(src));
ok('the boot drain uses it', /if \(warpathDrainEnabled\(\) && warpathEverEntered\(\)/.test(src));
ok('warpathClaimGrants uses it too', /async function warpathClaimGrants\(\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(!warpathDrainEnabled\(\)\) return;/.test(src));
ok('...and nothing gates the drain on warpathEnabled any more',
   !/warpathEnabled\(\) && warpathEverEntered\(\)/.test(src));

/* The cinematic menu. Grey is presentation; `disabled` is the enforcement. */
console.log('\n── the cinematic menu button is inert, not merely grey ──');
const MENU = readFileSync(join(ROOT, 'public', 'main-menu', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
ok('a locked Warpath button gets disabled', /_wpBtn\.disabled = _wpLock;/.test(MENU));
ok('...and aria-disabled, un-set when it unlocks',
   /if \(_wpLock\) _wpBtn\.setAttribute\('aria-disabled', 'true'\);\n\s*else _wpBtn\.removeAttribute\('aria-disabled'\);/.test(MENU));
ok('the nav click handler bails before .active / the sweep / mm:nav',
   /if \(btn\.disabled \|\| btn\.getAttribute\('aria-disabled'\) === 'true'\) return;/.test(MENU));

/* Copy. With the mode sealed for everyone, "admin only" is a lie in the UI. */
console.log('\n── copy: nothing claims this is an admin-only phase ──');
ok('index.html says nothing about "admin only for now"', !/admin only for now/i.test(src));
ok('the cinematic menu says nothing about it either', !/admin only for now/i.test(MENU));
ok('the locked hub tile carries no 👑 ADMIN badge', !/md-mlock">👑 ADMIN/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
