/* 🪪 TWO PLAYERS, ONE COMPUTER, WITH A RELOAD IN BETWEEN.

   Reported: "Drum Dude and Skippy both signed in on the same computer and it
   connected their accounts together. This is a multiplayer online game with
   real money being used, we cannot be blending accounts."

   v121u4 already wiped the departing account's profile on a switch, and
   _accountswitch_smoke.mjs proves that wipe is thorough. Both were true and a
   player still got somebody else's account, because the wipe's TRIGGER could
   not survive a page load:

     saveProfile() stringifies the WHOLE Profile, so cloud.ownerUserId reaches
     localStorage. loadProfile() is a WHITELIST and `p.cloud` is not on it. So a
     reload restores heroes, wallet, vault and ledger while `cloud` comes back
     blank — and the switch test, which reads only cloud.ownerUserId, sees no
     previous owner and declares no switch.

   The existing smoke could not catch this: it calls the reset directly and asks
   what it clears. THIS file asks the question one level up — after a RELOAD,
   does the switch get detected at all? — which is the only question the two
   players were actually asking.

   Run: node _accountowner_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const SRC = readFileSync('./public/index.html', 'utf8');

/* A localStorage that behaves like the browser's: survives a reload, and is the
   only thing that does. */
function makeDisk() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get size() { return m.size; }, _map: m };
}
const OWNER_KEY = (/const PROFILE_OWNER_KEY = '([^']+)'/.exec(SRC) || [])[1];

console.log('\n=== 0. the stamp exists and is not inside the whitelist object ===');
ok(!!OWNER_KEY, 'PROFILE_OWNER_KEY is declared', OWNER_KEY);
ok(/const PROFILE_OWNER_KEY/.test(SRC) && !/STORAGE_KEYS = \{[^}]*profileOwner/.test(SRC),
   'it is its own const, not a STORAGE_KEYS member a whitelist trim could take with it');

/* The three shipped fragments this bug lives in, read out of the file so the
   test cannot pass against a copy of the fix that is not the one shipping. */
const savesStamp   = /localStorage\.setItem\(PROFILE_OWNER_KEY/.test(SRC);
const readsStamp   = /localStorage\.getItem\(PROFILE_OWNER_KEY\)/.test(SRC);
const clearsStamp  = /localStorage\.removeItem\(PROFILE_OWNER_KEY\)/.test(SRC);
/* ⚠ SCOPED TO THE RESTORE STATEMENTS, NOT THE WHOLE FILE. A bare /\bp\.cloud\b/
   matched the PROSE in saveProfile's own comment — which names `p.cloud` to
   explain this very bug — so the check read its own explanation as code and
   went red. Same trap the kitchen comment-stripper hit: a file that documents
   its identifiers cannot be grepped for them. The load path assigns with
   `Profile.X = p.X`, so that is the shape to look for. */
const cloudInLoad  = /Profile\.cloud\s*=\s*p\.cloud/.test(SRC);

console.log('\n=== 1. the three places the stamp has to appear ===');
ok(savesStamp,  'saveProfile writes the stamp beside the blob');
ok(readsStamp,  'the sign-in switch test reads it back from disk');
ok(clearsStamp, 'sign-out removes it with the blob it describes');

console.log('\n=== 2. THE BUG ITSELF — the load path still does not restore `cloud` ===');
/* Not a regression to fix here: restoring `cloud` wholesale would carry a live
   session object across accounts. The point is that the fix must not DEPEND on
   it, and this records why the memory-only test was doomed. */
ok(!cloudInLoad, 'loadProfile still does not restore Profile.cloud — so a memory-only owner check is still dead across a reload', String(cloudInLoad));

console.log('\n=== 3. THE REPORTED SEQUENCE, driven ===');
/* Model the three shipped behaviours exactly: save stamps the disk, reload
   restores everything EXCEPT cloud, sign-in reads memory then disk. */
const SKIPPY = 'a4774ec3-14ce-43dc-9c1a-6e12ffcafa28';
const DRUM   = '3de499ed-d693-447f-b3f3-6e1eb8d925e2';

function boot(disk) {
  // a fresh page: Profile.cloud is the blank initialiser, the rest is restored
  return { cloud: { userId: null, ownerUserId: null, signedIn: false }, gems: 550700, account: { displayName: 'Skippy' } };
}
function saveProfile(P, disk) {
  disk.setItem('hg_profile', JSON.stringify(P));
  const own = (P.cloud && P.cloud.userId) || '';
  if (own) disk.setItem(OWNER_KEY, own);
}
function signIn(P, disk, uid, useDisk) {
  let prev = P.cloud.ownerUserId || null;
  if (!prev && useDisk) prev = disk.getItem(OWNER_KEY) || null;
  const switched = !!(prev && prev !== uid);
  P.cloud.userId = uid; P.cloud.ownerUserId = uid; P.cloud.signedIn = true;
  return { prev, switched };
}

for (const [label, useDisk] of [['the OLD behaviour (memory only)', false], ['the SHIPPED behaviour (memory, then disk)', true]]) {
  const disk = makeDisk();
  const p1 = boot(disk);
  signIn(p1, disk, SKIPPY, useDisk);
  saveProfile(p1, disk);                       // Skippy plays and the game autosaves
  const p2 = boot(disk);                       // ── the reload: cloud comes back blank ──
  const r = signIn(p2, disk, DRUM, useDisk);   // Drum Dude signs in on the same PC
  if (useDisk) {
    ok(r.switched === true, label + ' → the switch IS detected, so the wipe fires', 'prevOwner ' + r.prev);
    ok(r.prev === SKIPPY, '…and it names Skippy as the departing account', String(r.prev));
  } else {
    ok(r.switched === false, label + ' → no switch detected (this is the bug, reproduced)', 'prevOwner ' + r.prev);
  }
}

console.log('\n=== 4. the cases that must NOT trip a wipe ===');
{
  const disk = makeDisk();
  const p = boot(disk); signIn(p, disk, SKIPPY, true); saveProfile(p, disk);
  const again = signIn(boot(disk), disk, SKIPPY, true);
  ok(again.switched === false, 'the SAME player reloading and signing back in is not a switch');
}
{
  const disk = makeDisk();   // a guest who never signed in, then signs in
  const r = signIn(boot(disk), disk, DRUM, true);
  ok(r.switched === false && r.prev === null, 'a first-ever sign-in keeps the guest progress it just made');
}
{
  const disk = makeDisk();
  const p = boot(disk); signIn(p, disk, SKIPPY, true); saveProfile(p, disk);
  disk.removeItem('hg_profile'); disk.removeItem(OWNER_KEY);        // sign-out clears both
  const r = signIn(boot(disk), disk, DRUM, true);
  ok(r.switched === false && disk.getItem(OWNER_KEY) === null,
     'after a clean sign-out there is no stamp and no profile to inherit');
}

console.log('\n=== 5. ANTI-VACUITY — round 3 can fail ===');
ok(OWNER_KEY !== 'hg_profile', 'the stamp is a DIFFERENT key from the blob (or clearing one would hide the other)', OWNER_KEY);

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
