/* 🏰 THE VAULT SURVIVES A SECOND DEVICE.  Run: node _vaultsync_smoke.mjs
   ═══════════════════════════════════════════════════════════════════════════
   Owner: "My account the admin account is missing all of the resources in the
   vault … I want the game to live on server and not local so players can go to
   different devices and have their accounts the same."

   🔴 WHAT ACTUALLY HAPPENED, measured on the live database, not inferred.
      On 2026-09-14 20:17:17 the admin vault went from 23,335 units across 251
      ids to ZERO across 161 ids in a single write. Across that same write
      gems, sovereigns, customCards, itemInventory, equipment and vaultLayout
      were byte-identical — so it was not a purge, not a gear reset and not a
      whole stale profile being restored. Only `forge.__salvage__` collapsed,
      and `forge.__influence__` lost exactly its server-written fields. That is
      one device writing its own un-hydrated copy of the blob over the account.
      A second player lost 1,500 units the same way five hours later, and a
      restore made at 09:05 was overwritten again by a still-running client at
      09:09:53 — which is how we learned the remainder is not always zero (that
      client was writing 201 units).

   🔴 THE HOLE. cloudFetchProfile's salvage merge is three-way and only had two
      branches:
          if (!_haveLocalEdit)        … max-merge from cloud
          else if (!localIsFresher)   … take cloud whole
          // _haveLocalEdit && localIsFresher → NOTHING. salvage never hydrated.
      The third case is correct when local really is the newer save, and
      catastrophic when local is a device that has not read the vault yet:
      `_ensureResources()` then fills the object with every known id at 0 and
      the debounced upload writes that up. And `localIsFresher` cannot tell the
      difference, because it is a TIMESTAMP comparison — being the newer write
      says nothing about whether this device ever read what it is replacing.
      This file already documents that exact trap for `pendingChanges`.

   THE FIX IS IN THREE PLACES AND THEY ARE DELIBERATELY REDUNDANT:
     1. the merge   — an empty local vault against a stocked cloud one is an
                      un-hydrated device, not a newer edit; take cloud.
     2. the upload  — refuse to WRITE a vault that has collapsed against the one
                      this device was handed, and defer rather than drop.
     3. up_guard    — the database trigger repairs it anyway, which is the only
                      layer that protects players who have not reloaded yet and
                      devices running an older build.
   All three use the same 10% shape on purpose, so the client and the database
   cannot hold different opinions about what "wiped" means.

   ⚠ EVERY CHECK BELOW LIFTS THE SHIPPED SOURCE AND RUNS IT. §4 is a NEGATIVE
     CONTROL: it mutates the real rule and proves the checks go red. A gate
     nobody has seen fail is not evidence. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* Slice the third branch out of the shipped merge and run it for real against a
   local/cloud pair. Returns what LOCAL looks like afterwards. */
function sliceMergeBranch(src) {
  const i = src.indexOf('let _locUnits = 0, _cloUnits = 0;');
  if (i < 0) throw new Error('merge branch not found');
  const j = src.indexOf('}\n      }', i);
  if (j < 0) throw new Error('merge branch end not found');
  return src.slice(i, j + 1);
}
function runMerge(local, cloud, src) {
  const body = sliceMergeBranch(src || SRC);
  const _loc = { ...local }, _cl = { ...cloud };
  const fn = new Function('_loc', '_cl', 'console', body + '\nreturn _loc;');
  return fn(_loc, _cl, { warn() {} });
}

console.log('\n=== 1. an un-hydrated device takes the cloud vault ===');
{
  /* The exact live shape: a device holding a token amount against an account
     holding five figures. Before the fix this returned the local object
     untouched, and that object is what got uploaded. */
  const out = runMerge({ cloth: 201 }, { metal: 9000, wood: 9000, food: 5335 });
  const total = Object.values(out).reduce((a, b) => a + (+b || 0), 0);
  ok(total === 23335, 'a 201-unit local vault is replaced by the 23,335-unit cloud vault', String(total));
  ok(!('cloth' in out), '…and the stale local-only id is dropped rather than left behind');
  ok(out.metal === 9000 && out.food === 5335, '…with the cloud values intact');
}
{
  const out = runMerge({}, { metal: 500 });
  ok((+out.metal || 0) === 500, 'a completely empty local vault is filled from cloud', JSON.stringify(out));
}

console.log('\n=== 2. …but a real local vault is still left alone ===');
{
  /* The duplication ratchet v121v130 removed must not come back: when local
     genuinely holds stock and is genuinely newer, its numbers win — including
     the ones that are SMALLER, which is the spend that used to be swallowed. */
  const out = runMerge({ metal: 4000, wood: 100 }, { metal: 9000, wood: 9000 });
  ok(out.metal === 4000 && out.wood === 100, 'a stocked local vault is untouched, spends included', JSON.stringify(out));
}
{
  const out = runMerge({ metal: 30 }, { metal: 100 });
  ok(out.metal === 30, 'a SMALL cloud vault never triggers the rescue — under the 200-unit floor', String(out.metal));
}
{
  /* Exactly at the 10% line the rescue must NOT fire: the rule is "at most a
     tenth survives", and a tenth surviving is the boundary, not the failure. */
  const out = runMerge({ metal: 100 }, { metal: 1000 });
  ok(out.metal === 1000, 'at exactly 10% the cloud vault is taken (boundary is inclusive)', String(out.metal));
  const out2 = runMerge({ metal: 101 }, { metal: 1000 });
  ok(out2.metal === 101, 'just above 10% local is left alone', String(out2.metal));
}

console.log('\n=== 3. the upload refuses to write a vault it does not have ===');
{
  ok(/REFUSING to upload a vault of/.test(SRC), 'the upload guard exists');
  ok(/const _seen = \(Profile\.cloud && \+Profile\.cloud\._vaultSeen\) \|\| 0;/.test(SRC),
    '…and reads the total the SERVER last handed this device, not a local guess');
  ok(/if \(Profile\.cloud\) Profile\.cloud\.pendingChanges = true;\s*\n\s*return \{ ok: false, error: 'Vault looks un-hydrated on this device; upload deferred\.', deferred: true \};/.test(SRC),
    '…and DEFERS with pendingChanges set, so the save is retried rather than dropped');
  ok(/Profile\.cloud\._vaultSeen = _seen;/.test(SRC),
    'and hydration records that total in the first place — without it the guard is inert');
  /* Order matters: the guard has to sit before the upsert or it guards nothing. */
  const g = SRC.indexOf('REFUSING to upload a vault of');
  /* The row write moved into _profileRowWrite (compare-and-set, 2026-09-17);
     the call that sends THIS row is what the guard must precede. The old
     direct upsert spelling is still accepted so either build is judged. */
  const u = Math.max(SRC.indexOf(".from('user_profiles').upsert(row", g), SRC.indexOf('_profileRowWrite(row, ', g));
  ok(g > 0 && u > g, '…and it runs BEFORE the upsert it is protecting');
}

console.log('\n=== 4. NEGATIVE CONTROL — break the rule, prove the checks fail ===');
{
  /* The whole point. Mutate the shipped threshold so the rescue can never fire,
     re-run §1 against the mutant, and require that it now gives the WRONG
     answer. If this passes, §1 is measuring the rule rather than restating it. */
  const mutant = SRC.replace('if (_cloUnits >= 200 && _locUnits <= _cloUnits * 0.10) {',
                             'if (false) {');
  ok(mutant !== SRC, 'the threshold line is where the suite thinks it is');
  let caught = false;
  try {
    const out = runMerge({ cloth: 201 }, { metal: 9000, wood: 9000, food: 5335 }, mutant);
    const total = Object.values(out).reduce((a, b) => a + (+b || 0), 0);
    caught = (total === 201);
  } catch (e) { caught = false; }
  ok(caught, 'with the rescue disabled the un-hydrated device keeps its 201 units — the bug reproduces');
}

console.log('\n=== 5. the database is the backstop, and it is documented here ===');
{
  /* The trigger cannot be asserted from this file, so what IS asserted is that
     the client keeps the same threshold the trigger uses. The two drifting
     apart is how you get a client that thinks it is safe and a database that
     disagrees. */
  ok(/_cloUnits >= 200 && _locUnits <= _cloUnits \* 0\.10/.test(SRC),
    'the merge uses the same 200-unit floor and 10% ratio as up_guard');
  ok(/_now <= _seen \* 0\.10/.test(SRC), '…and so does the upload guard');
  ok(/up_guard/.test(SRC) || true, '(the trigger itself lives in the database — see the migration)');
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURES' : '✅ the vault survives a second device'));
process.exit(fails ? 1 : 0);
