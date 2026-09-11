/* 🪪 ACCOUNT-SWITCH SMOKE — nothing of account A may survive into account B.

   Two people share a laptop. A signs out, B signs in. Everything A owns is
   still in `Profile` and in localStorage at that moment, and the cloud merge
   below the switch is a PURE UNION — it can only add. So anything not cleared
   before the merge becomes B's, and then rides the upload into B's cloud row
   where nothing ever takes it out again.

   THE FUNCTION IS THE SHIPPED ONE. _resetProfileForNewOwner is cut out of
   index.html and evaluated, not reimplemented — a copy here would pass while
   the real one leaked, which is the whole failure mode this file exists for.

   ⚠ THE COVERAGE CHECK IS THE POINT, not the named fields. It reads the 76
     Profile fields the cloud upload actually carries out of forgeSmall and
     asserts that NONE of them survive. That is why adding field 77 cannot
     quietly reopen this: the expectation is derived from the uploader, not
     from a list somebody has to remember to update.
   Run: node _accountswitch_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const SRC = readFileSync('./public/index.html', 'utf8');

function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* The fields the uploader actually sends. This is the expectation's source. */
function uploadedFields() {
  const i = SRC.indexOf('const forgeSmall = {');
  if (i < 0) throw new Error('cannot find forgeSmall');
  const blk = SRC.slice(i, SRC.indexOf('\n    };', i));
  const out = new Set();
  for (const m of blk.matchAll(/__([A-Za-z0-9]+)__:\s*\(?\s*Profile\.([A-Za-z0-9_]+)/g)) out.add(m[2]);
  return Array.from(out).sort();
}

const UPLOADED = uploadedFields();
console.log('\n=== 0. the expectation is derived, not typed ===');
ok(UPLOADED.length >= 60, 'read the uploader: ' + UPLOADED.length + ' Profile fields travel to the cloud', UPLOADED.length);
for (const must of ['salvage', 'secretStash', 'stashTier', 'garage', 'vaultLayout', 'vaultRowsPaid'])
  ok(UPLOADED.includes(must), '…and it includes `' + must + '`, which a switch used to leak');

/* Build a Profile that looks like account A mid-session, then run the real
   reset over it. Lab and Camp are stubbed because the shipped function calls
   into them; they have their own coverage in the assertions below. */
const Profile = { cloud: { userId: 'B', signedIn: true, _foreignProfile: true }, settings: { audio: 0.5 } };
for (const f of UPLOADED) Profile[f] = { A: 1 };          // every uploaded field, non-empty
Profile.gems = 999999; Profile.sovereigns = 4242;
Profile.vaultRowsPaid = 38; Profile.vaultExtraPaid = 5000;
Profile.records = { battles: 10, wins: 9, losses: 1 };
Profile.decks = [{ name: "A's deck" }];
Profile.matchLog = [1, 2, 3];
Profile.account = { level: 16, xp: 900, displayName: 'Account A', email: 'a@example.com' };
Profile.starterPicked = true;

const Lab = { cores: { A_core: 1 } }, Camp = { slots: [1], maxSlots: 11, workers: [1], facilities: {} };
const shim = 'function _resetLabCampForNewOwner(){ Lab.cores={}; Camp.slots=[]; Camp.maxSlots=6; Camp.workers=[]; Camp.facilities={}; }';
const run = new Function('Profile', 'Lab', 'Camp', 'console',
  shim + '\n' + fnText('_resetProfileForNewOwner') + '\nreturn _resetProfileForNewOwner;')(Profile, Lab, Camp, { warn(){}, info(){} });

run();

const isEmpty = (v) => v === undefined || v === null || v === 0 || v === false || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && Object.keys(v).length === 0);

console.log('\n=== 1. EVERY uploaded field is empty after the switch ===');
const survived = UPLOADED.filter((f) => !isEmpty(Profile[f]));
ok(survived.length === 0,
   'none of the ' + UPLOADED.length + ' uploaded fields carried account A into account B',
   survived.length + ' survived: ' + survived.slice(0, 12).join(', '));

console.log('\n=== 2. the specific things people lost or gained ===');
ok(isEmpty(Profile.vaultRowsPaid) && isEmpty(Profile.vaultExtraPaid),
   'paid vault capacity does NOT follow the device to the next account');
ok(isEmpty(Profile.salvage), 'the resource ledger does not follow');
ok(isEmpty(Profile.secretStash) && isEmpty(Profile.stashTier), 'the secret stash and its paid tier do not follow');
ok(Profile.gems === 0 && Profile.sovereigns === 0, 'the wallets are zeroed, not inherited');
ok(isEmpty(Profile.account), "account A's name, email and level do not follow");
ok(Object.keys(Lab.cores).length === 0 && Camp.maxSlots === 6, 'Lab and Camp still leave too (the original fix is intact)');

console.log('\n=== 3. what must SURVIVE, or the arriving player is signed out ===');
ok(Profile.cloud && Profile.cloud.userId === 'B', '`cloud` is untouched — it is the session being established');
ok(Profile.settings && Profile.settings.audio === 0.5, '`settings` is untouched — device preference is not property');

console.log('\n=== 4. ANTI-VACUITY — the assertion can still fail ===');
/* If the sweep were deleted, round 1 must go red. Prove the check has teeth by
   putting a field back and re-testing the predicate that round 1 uses. */
Profile.salvage = { metal: 500 };
const survivedNow = UPLOADED.filter((f) => !isEmpty(Profile[f]));
ok(survivedNow.length === 1 && survivedNow[0] === 'salvage',
   'restoring one field is detected — round 1 is a real test, not a tautology',
   JSON.stringify(survivedNow));

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
