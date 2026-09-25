/* 🐄 A RELOAD KEEPS THE FARM, AND AN UN-HYDRATED DEVICE NEVER UPLOADS "NO FARM".
   Run: node _farmpersist_smoke.mjs
   Tracker bug-mtzijeyw ("farm builds not saved after logoff/logon") and
   bug-mu44lr6j ("my feeder mill disappeared").
   Profile.farm was uploaded as __farm__ and merged back from the cloud, but the
   LOCAL profile loader is a whitelist and farm was not on it. Every reload
   started with no farm, the upload sent `__farm__: null`, and two players'
   farms were replaced with null on the server (user_profiles_history).
   §1 the loader restores it (and the other fields in the same gap),
   §2 the upload guard, run for real, §3 negative control. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* The local loader: from the defensive hg_profile parse to the end of the block
   that restores the business stores. */
const L0 = SRC.indexOf("console.warn('⚠ hg_profile is corrupt/truncated");
const loader = SRC.slice(L0, SRC.indexOf('// 🦸 Starter-deck state — restore so the new-player gate never re-fires.', L0));
const up0 = SRC.indexOf('__unlockedTraders__: Array.isArray(Profile.unlockedTraders)');
const upload = SRC.slice(up0, SRC.indexOf("__furnitureOwned__", up0) + 200);

console.log('\n=== 1. every profile-level store the upload sends is read back on reload ===');
{
  ok(L0 > 0 && loader.length > 1000 && loader.length < 100000, 'found the local loader', String(loader.length));
  const fields = ['farm', 'wagePool', 'jbLocalOps', 'dojoUnlocked', 'dojoStock', 'gemsOwned', 'cityCards',
    'breedCooldowns', 'traderStock', 'foundry', 'furnitureOwned', 'workSalt'];
  for (const k of fields) {
    ok(new RegExp('Profile\\.' + k + '\\b').test(upload), `${k} is uploaded`);
    ok(new RegExp('\\bp\\.' + k + '\\b[^\\n]*Profile\\.' + k + '\\s*=').test(loader), `${k} is restored by the local loader`);
  }
}

console.log('\n=== 2. the upload never replaces a seen farm with null ===');
{
  ok(/__farm__:\s*_farmUploadValue\(\),/.test(upload), 'the upload asks _farmUploadValue()');
  ok(!/__farm__:\s*\(Profile\.farm && typeof Profile\.farm === 'object'\) \? Profile\.farm : null/.test(SRC), 'the bare null fallback is gone');
  const a = SRC.indexOf('let _farmSeen = null;');
  const b = SRC.indexOf('function saveProfile() {', a);
  ok(a > 0 && b > a, 'found the guard');
  const make = (Profile) => new Function('Profile', SRC.slice(a, b) + '\nreturn { set: (v) => { _farmSeen = v; }, val: _farmUploadValue };')(Profile);
  const FARM = { v: 2, ts: 1789531660747, look: { name: 'Golden Meadows' } };

  let P = { cloud: { userId: 'u1' } }; let g = make(P);
  ok(g.val() === null, 'a brand-new account with no farm anywhere uploads null');
  g.set({ uid: 'u1', farm: FARM });
  ok(g.val() === FARM, 'a device with no farm, handed one by the cloud, uploads the cloud farm — not null');
  P.farm = { v: 2, ts: 1789531669999 };
  ok(g.val() === P.farm, 'a device that has a farm uploads its own farm');
  P = { cloud: { userId: 'u2' } }; g = make(P); g.set({ uid: 'u1', farm: FARM });
  ok(g.val() === null, 'a farm seen for one account is never uploaded for another');

  const merge = SRC.slice(SRC.indexOf('// 🐄 Farm — newest `ts` wins; a farm is one save, never a union.'));
  ok(/_farmSeen = \{ uid: \(Profile\.cloud && Profile\.cloud\.userId\) \|\| '', farm: _cf \};/.test(merge.slice(0, 600)),
    'every cloud read that carries a farm records it, with its owner');
  const fp = SRC.indexOf('const foreignProfile = !!(Profile.cloud && Profile.cloud._foreignProfile);');
  const skip = SRC.indexOf("return { ok: true, skippedMerge: true };", fp);
  /* ORDER, not a fixed window: the record must sit inside cloudFetchProfile and
     before the foreign-profile / local-is-fresher branches. An 800-char window
     went red when unrelated code was added between them, with the order intact. */
  const fnStart = SRC.lastIndexOf('async function cloudFetchProfile(', fp);
  const early = fnStart > 0 ? SRC.slice(fnStart, fp) : '';
  ok(fp > 0 && skip > fp && fnStart > 0 && /data\.forge\.__farm__/.test(early) && /_farmSeen = \{ uid:/.test(early),
    'and it is recorded BEFORE the local-is-fresher branch, which returns without merging (the path that uploaded null)');
}

console.log('\n=== 3. NEGATIVE CONTROL — the old upload line and the old loader ===');
{
  const oldUpload = (Profile) => (Profile.farm && typeof Profile.farm === 'object') ? Profile.farm : null;
  ok(oldUpload({ cloud: { userId: 'u1' } }) === null, 'after a reload the old line uploads null — the value found in the history rows');
  const oldLoader = loader.replace(/\n\s*if \(p\.farm\b[^\n]*/, '');
  ok(!/\bp\.farm\b[^\n]*Profile\.farm\s*=/.test(oldLoader), 'with the new line removed, §1\'s check for farm fails — it is measuring the line');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ the farm survives a reload and a stale device\n');
process.exit(fails ? 1 : 0);
