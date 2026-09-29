/* ══════════════════════════════════════════════════════════════════════════
   🏗 DRIVE-CAMPSAVE — "this section is not saving".

   It WAS saving. reconReclaim() writes Profile.recon.sites, calls saveProfile()
   (which stringifies the whole Profile to localStorage) and saveProgressCloud(),
   and __recon__ is both uploaded and hydrated. Every half of the sync exists.

   What was wrong is the two gates that decide whether a cloud row deserves to
   be restored, and whether a local profile is worth protecting:

       _cloudRowHasProgress(d)   battles, wins, gems, decks, units, heroes,
       _profileLooksEmpty(p)     forge decks — AND NOTHING FROM THE CAMP.

   So a player whose progress IS the settlement had a cloud row that read as
   EMPTY. Two consequences, both of which delete the board:
     · the fresh-device branch `localEmpty && cloudHasProg` never fires, so the
       "always restore the cloud account" protection is skipped and an empty
       local profile can win and be uploaded over their save;
     · the foreignProfile branch calls _resetProfileForNewOwner() because it
       believes there is nothing in the cloud to restore.

   And separately, __recon__ hydrated by STRAIGHT ASSIGNMENT while both of its
   neighbours merge, each with a comment explaining that an older cloud copy
   must not delete something the player paid for. A reclaim costs Cinder and
   resources and the code calls reconstruction PERMANENT.

   ⚠ THIS DRIVER IS RUN AGAINST THE OLD CODE TOO. A regression test for a data
     loss that cannot demonstrate the loss is a comment. `--legacy` re-derives
     the two gates as they shipped and asserts they FAIL.

   Run:  node .gauntlet/drive-campsave.mjs
         node .gauntlet/drive-campsave.mjs --legacy
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';

const LEGACY = process.argv.includes('--legacy');
const src = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* Lift the three functions straight out of the shipped file and evaluate them.
   Reading the SOURCE rather than restating it is the point: a driver carrying
   its own copy of the gate is testing its own copy. */
function lift(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  // brace-match from the first {
  let j = src.indexOf('{', i), depth = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}

const bodies = [lift('_cloudRowHasProgress'), lift('_profileLooksEmpty')];
let helper = '';
try { helper = lift('_campProgressFrom'); } catch (e) { helper = ''; }

/* The legacy build is the shipped one with the camp lines stripped back out —
   which is exactly what the file looked like before this fix. */
let code = helper + '\n' + bodies.join('\n');
if (LEGACY) {
  code = code
    .replace(/if \(_campProgressFrom\([\s\S]*?\) return true;/g, '')
    .replace(/if \(_campProgressFrom\([\s\S]*?\) return false;/g, '');
}
code += '\n;({ hasProg: _cloudRowHasProgress, looksEmpty: _profileLooksEmpty })';
const G = (0, eval)(code);

console.log((LEGACY ? '🕰 LEGACY (pre-fix) build' : '✅ SHIPPED build') + '\n');

/* A player who has ONLY ever played the Camp Console: three sites reclaimed,
   a crew hired, some contribution. No battles, no decks, no heroes. */
const campRow = {
  updated_at: '2026-08-21T12:00:00Z',
  records: {}, decks: {}, units: {}, heroes: {},
  forge: {
    __recon__: { sites: { cityhall: 'built', apartments: 'built', greenhouse: 'built' },
                 vitals: { morale: 62, security: 44, hope: 58 }, day: 9 },
    __campWorkforce__: { Builder: 3, Farmer: 1 },
    __campContrib__: 14, __campPrestige__: 6, __campNodeKnown__: true,
  },
};
const campProfile = {
  records: {}, heroes: {}, decks: [], units: {},
  recon: { sites: { cityhall: 'built', apartments: 'built', greenhouse: 'built' } },
  campWorkforce: { Builder: 3, Farmer: 1 }, campContrib: 14, campPrestige: 6,
};

console.log('1. a camp-only account is recognised as having progress');
const hasProg = G.hasProg(campRow);
const looksEmpty = G.looksEmpty(campProfile);
ok('the CLOUD row counts as progress', hasProg === true, 'hasProg=' + hasProg);
ok('the LOCAL profile does not look empty', looksEmpty === false, 'looksEmpty=' + looksEmpty);

console.log('\n2. the fresh-device restore branch can actually fire');
/* The branch is `localEmpty && cloudHasProg`. On a new device local is blank. */
const blank = { records: {}, heroes: {}, decks: [], units: {} };
const freshDeviceEmpty = G.looksEmpty(blank);
ok('a genuinely blank profile still looks empty', freshDeviceEmpty === true, String(freshDeviceEmpty));
ok('...so `localEmpty && cloudHasProg` is TRUE for a camp-only account',
   freshDeviceEmpty === true && hasProg === true,
   'this is the branch that restores the cloud instead of uploading a blank profile over it');

console.log('\n3. the foreignProfile wipe cannot fire on a real camp account');
/* foreignProfile calls _resetProfileForNewOwner() when !cloudHasProg. */
ok('a camp-only cloud row is NOT treated as "nothing to restore"', hasProg === true);

console.log('\n4. the gates agree with each other');
/* They are compared against one another in cloudFetchProfile; a split
   definition is how one protects a save the other discards. */
ok('same account, both gates say "has progress"',
   hasProg === true && looksEmpty === false);

console.log('\n5. vitals alone are NOT progress (they are seeded defaults)');
const vitalsOnly = { records: {}, heroes: {}, decks: [], units: {},
                     recon: { vitals: { morale: 50, security: 30, hope: 50 }, sites: {} } };
ok('a profile that only ever opened the screen still looks empty',
   G.looksEmpty(vitalsOnly) === true,
   'otherwise every player who glanced at the camp blocks their own cloud restore');

console.log('\n6. a reclaimed site survives an OLDER cloud copy');
/* Lifted from the shipped hydration block rather than restated. A straight
   assignment (what this was) lets a cloud row written before the reclaim
   delete it — the same defect __garage__ merges to avoid, on a key that is
   also paid for and is documented as PERMANENT. */
{
  const i = src.indexOf("if (f.__recon__ && typeof f.__recon__ === 'object')");
  if (i < 0) { ok('the __recon__ hydration block was found', false); }
  else {
    let j = src.indexOf('{', i), depth = 0, k = j;
    for (; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) break; }
    }
    const blk = src.slice(i, k + 1);
    const isMerge = /Object\.assign/.test(blk);
    ok('the hydration MERGES rather than assigns', isMerge && !LEGACY ? true : isMerge,
       isMerge ? 'union' : 'straight assignment — an older cloud copy deletes a reclaim');
    if (isMerge) {
      /* local has one site the cloud has not seen yet (the reclaim that has not
         finished uploading); cloud is otherwise newer. */
      const Profile = { recon: { sites: { workshop: 'built' }, vitals: { morale: 99 }, day: 3 } };
      const fRow = { __recon__: { sites: { cityhall: 'built' }, vitals: { morale: 61 }, day: 12 } };
      (0, eval)('(function(Profile, f){' + blk + '; return Profile;})')(Profile, fRow);
      const sites = Object.keys(Profile.recon.sites).sort();
      ok('the local-only reclaim survived', sites.includes('workshop'), sites.join(','));
      ok('the cloud site is there too', sites.includes('cityhall'), sites.join(','));
      ok('vitals take the CLOUD value (living, not cumulative)',
         Profile.recon.vitals && Profile.recon.vitals.morale === 61,
         JSON.stringify(Profile.recon.vitals));
      ok('day takes the cloud value too', Profile.recon.day === 12, String(Profile.recon.day));
    }
  }
}

if (LEGACY) {
  console.log('\n🕰 Against the pre-fix build the checks above are EXPECTED to fail.');
  console.log('   ' + fails + ' failure(s) — that is the data loss, reproduced.');
  process.exit(fails > 0 ? 0 : 1);   // legacy MUST fail; a pass here means the driver proves nothing
}

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
