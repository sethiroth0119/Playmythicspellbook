/* 🎁 REWARD PACKS ARRIVE (persistence audit → owner decision 2026-09-22).

   Season Pass pack tiers and coupon `packs` rewards called grantUnopenedPack,
   which did not exist, and fell back to Profile.packInventory — a map nothing
   read and loadForge never restored. A claimed reward pack was marked claimed
   and delivered nowhere. grantUnopenedPack now puts it in Profile.unopenedPacks
   (the store the Vendor Market inventory, the card shop and the opener use),
   and _packRewardMakeGood rebuilds the packs already claimed from the claim
   flags the forge row carries.

   Drives the REAL functions out of public/index.html headless:
     1. claim a Season Pass pack tier → a real, openable pack; claim twice → one;
     2. a coupon's packs land (aliased 'starter_pack' → 'basic', a real pack id);
     3. the pack opens (openOnePackFromInventory consumes it, cards are drawn);
     4. a reload keeps the packs and the grant ledger;
     5. the make-good for a pre-fix player: claims + a leftover packInventory
        become packs ONCE — re-run, reload, re-run: still once; the ids are
        deterministic so another device doing the same yields the same entries;
     6. the cloud path: a same-device reload that takes the local-is-fresher
        branch still runs the make-good, and the upload row carries the packs
        and the ledger.

   Run: node _packreward_smoke.mjs      (PACKREWARD_FILE=<html> for another copy) */
import vm from 'node:vm';
import { loadEngine, INDEX } from './tools/gamedev/headless.mjs';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x));
  if (c) passes++; else fails++;
};
const FILE = process.env.PACKREWARD_FILE || INDEX;
const fresh = () => {
  const e = loadEngine({ file: FILE });
  const run = (s) => vm.runInContext(s, e.sandbox);
  const J = (s) => { const t = run('JSON.stringify(' + s + ')'); return t === undefined ? undefined : JSON.parse(t); };
  // Visual layers are DOM-only; the grant and the draw are what we test.
  run(`_mountPackOpener = () => {}; _packTearCinematic = undefined; _displayPackReveal = () => {};
       openLootRewardModal = () => {}; var __toasts = []; showToast = (m) => { __toasts.push(String(m)); };
       Profile.unopenedPacks = []; delete Profile.packRewardGrants; delete Profile.packInventory;`);
  return { e, run, J };
};
const packs = (J, pid) => (J('Profile.unopenedPacks') || []).filter((p) => !pid || p.packId === pid);

/* ── 1. Season Pass ──────────────────────────────────────────────────────── */
console.log('1. a claimed Season Pass pack tier is a real pack');
{
  const { run, J } = fresh();
  run(`const sp = _ensureSeasonPass(); sp.xp = 999999; sp.tier = 30; sp.premiumOwned = true;`);
  const tier = J('SEASON_FREE_REWARDS.findIndex(r => r && r.kind === "pack")');
  const ptier = J('SEASON_PREMIUM_REWARDS.findIndex(r => r && r.kind === "pack")');
  ok(tier > 0 && ptier > 0, 'the reward tables have pack tiers (free ' + tier + ', premium ' + ptier + ')');
  const r = J(`claimSeasonReward(${tier}, 'free')`);
  ok(r && r.ok, 'the claim succeeds', JSON.stringify(r));
  const p = packs(J);
  ok(p.length === 1, 'exactly one unopened pack is in Profile.unopenedPacks', JSON.stringify(p));
  ok(p[0] && p[0].packId === 'basic' && J('PACK_DEFINITIONS.some(d => d.id === "basic")'),
    "'starter' lands as a REAL pack id (basic), not an unknown one", p[0] && p[0].packId);
  ok(p[0] && p[0].source === 'season', 'tagged source: season');
  ok(J('Profile.packInventory') === undefined, 'nothing is written to the dead packInventory map');
  ok(J('getUnopenedPackCount()') === 1, 'the HUD count sees it');
  ok(!J(`claimSeasonReward(${tier}, 'free')`).ok && packs(J).length === 1, 'a second claim is refused and adds nothing');
  ok(J(`claimSeasonReward(${ptier}, 'premium')`).ok && packs(J).length === 2, 'a premium pack tier lands too');
  ok(J(`_packRewardMakeGood()`) === 0 && packs(J).length === 2, 'the make-good does not re-grant a claim made after the fix');
}

/* ── 2. coupon ───────────────────────────────────────────────────────────── */
console.log('2. a coupon with packs delivers them');
{
  const { run, J } = fresh();
  run(`Forge.coupons = [{ id: 'cpn_t', code: 'PACKS', name: 'Packs', rewards: { packs: { starter_pack: 2, spell: 1 } },
                          maxUses: 0, uniquePerPlayer: true, expiresAt: 0, usedCount: 0 }]; Profile.redeemedCoupons = [];`);
  const r = J(`_redeemCouponCode('PACKS')`);
  ok(r && r.ok, 'the code redeems', JSON.stringify(r));
  ok(packs(J, 'basic').length === 2 && packs(J, 'spell').length === 1, '2 basic + 1 spell pack are in the inventory', JSON.stringify(packs(J).map((p) => p.packId)));
  ok(J('Profile.packInventory') === undefined, 'nothing is written to packInventory');
  ok(!J(`_redeemCouponCode('PACKS')`).ok && packs(J).length === 3, 'redeeming again is refused and adds nothing');
  ok(J(`_packRewardMakeGood()`) === 0, 'the make-good sees the coupon as already granted');
}

/* ── 3. open it ──────────────────────────────────────────────────────────── */
console.log('3. the reward pack opens');
const { run: runA, J: JA } = fresh();
{
  const run = runA, J = JA;
  // headless has no card catalogue — publish a small custom pool to draw from.
  run(`Forge.customCards = ['common','uncommon','rare','epic','legendary','mythic'].flatMap((r, i) =>
         [0,1,2,3].map(k => ({ id: 'pr_' + r + k, name: r + k, type: 'unit', rarity: r, element: 'fire', cost: 1, atk: 1, hp: 1 })));
       const sp = _ensureSeasonPass(); sp.xp = 999999; sp.tier = 30;`);
  const tier = J('SEASON_FREE_REWARDS.findIndex(r => r && r.kind === "pack")');
  J(`claimSeasonReward(${tier}, 'free')`);
  const before = packs(J).length;
  const hist0 = (J('Profile.packHistory') || []).length;
  run(`openOnePackFromInventory('basic')`);
  ok(packs(J).length === before - 1, 'opening consumes the reward pack', packs(J).length + ' left of ' + before);
  ok((J('Profile.packHistory') || []).length > hist0, 'and cards were drawn (pack history recorded)', (J('Profile.packHistory') || []).length);
  ok(!J('__toasts').some((t) => /No packs of that type/.test(t)), 'the opener found it');
}

/* ── 4. reload ───────────────────────────────────────────────────────────── */
console.log('4. a reload keeps reward packs and the grant ledger');
{
  const { run, J } = fresh();
  run(`const sp = _ensureSeasonPass(); sp.xp = 999999; sp.tier = 30;`);
  const tier = J('SEASON_FREE_REWARDS.findIndex(r => r && r.kind === "pack")');
  J(`claimSeasonReward(${tier}, 'free')`);
  const ids = packs(J).map((p) => p.id);
  run(`saveProfile(); Profile.unopenedPacks = []; delete Profile.packRewardGrants; Profile.seasonPass = null; loadForge();`);
  ok(JSON.stringify(packs(J).map((p) => p.id)) === JSON.stringify(ids), 'the pack is back after loadForge', JSON.stringify(packs(J)));
  ok(Object.keys(J('Profile.packRewardGrants') || {}).length === 1, 'the grant ledger is back');
  ok(J('_packRewardMakeGood()') === 0 && packs(J).length === 1, 'and the make-good after reload grants nothing');
}

/* ── 5. make-good for a pre-fix player ───────────────────────────────────── */
console.log('5. a player who claimed before the fix gets the packs, once');
const PREFIX = (J0) => {
  const free = J0('SEASON_FREE_REWARDS.map((r, i) => r && r.kind === "pack" ? i : 0).filter(Boolean)');
  const prem = J0('SEASON_PREMIUM_REWARDS.map((r, i) => r && r.kind === "pack" ? i : 0).filter(Boolean)');
  const cinder = J0('SEASON_FREE_REWARDS.findIndex(r => r && r.kind === "cinder")');
  const cf = {}; free.slice(0, 2).forEach((t) => { cf[t] = true; }); cf[cinder] = true;
  const cp = {}; cp[prem[0]] = true;
  return {
    blob: {
      seasonPass: { seasonNumber: 2, xp: 99999, tier: 30, seasonStartedAt: Date.now(), premiumOwned: true,
        claimedFreeTiers: cf, claimedPremiumTiers: cp },
      redeemedCoupons: ['cpn_t'],
      // the old writers: 3 season claims + 2 from the coupon, plus 2 extra
      // 'starter' from a season that has since rolled over, and an unknown id.
      packInventory: { starter: 5, starter_pack: 2, mystery: 1 },
      unopenedPacks: [{ id: 'pk_bought_1', packId: 'spell', name: 'Spell Pack', icon: '📦', purchasedAt: 1, source: 'shop' }],
    },
    // 2 free + 1 premium + coupon (2 basic + 1 spell) + excess starter 2 + mystery 1
    expect: 3 + 3 + 2 + 1,
  };
};
const COUPON = `Forge.coupons = [{ id: 'cpn_t', code: 'PACKS', rewards: { packs: { starter_pack: 2, spell: 1 } }, uniquePerPlayer: true }];`;
let idsA = null;
{
  const { run, J } = fresh();
  const { blob, expect } = PREFIX(J);
  run(`${COUPON} for (const k of ['seasonPass','redeemedCoupons','unopenedPacks']) delete Profile[k];
       localStorage.setItem(STORAGE_KEYS.profile, ${JSON.stringify(JSON.stringify(blob))}); loadForge();`);
  ok(J('Profile.packInventory && Profile.packInventory.starter') === 5, 'loadForge hands the leftover packInventory to the migration');
  const n = J('_packRewardMakeGood()');
  ok(n === expect, 'the make-good grants every owed pack (' + expect + ')', n);
  ok(packs(J).length === expect + 1, 'the bought pack is untouched beside them', packs(J).length);
  ok(packs(J, 'mystery').length === 1 && packs(J, 'mystery')[0].name === 'Mystery Pack', 'an unknown pack id still grants (opener falls back to the default pool)');
  ok(J('Profile.packInventory') === undefined, 'the legacy map is drained and deleted');
  ok(J('__toasts').some((t) => /never arrived/.test(t)), 'the player is told');
  ok(J('_packRewardMakeGood()') === 0 && packs(J).length === expect + 1, 're-running grants nothing');
  run(`saveProfile(); Profile.unopenedPacks = []; delete Profile.packRewardGrants; loadForge();`);
  ok(J('Profile.packInventory') === undefined, 'the saved blob no longer carries packInventory');
  ok(J('_packRewardMakeGood()') === 0 && packs(J).length === expect + 1, 'after a reload: still once');
  run(`removeUnopenedPack(Profile.unopenedPacks.find(p => p.packId === 'mystery').id);`);
  ok(J('_packRewardMakeGood()') === 0 && packs(J, 'mystery').length === 0, 'an OPENED make-good pack is not re-granted');
  idsA = packs(J).map((p) => p.id).filter((i) => i.startsWith('pk_rw_')).sort();
}
{
  // Device B, same account, runs its own make-good from the same claims.
  const { run, J } = fresh();
  const { blob } = PREFIX(J);
  run(`${COUPON} for (const k of ['seasonPass','redeemedCoupons','unopenedPacks']) delete Profile[k];
       localStorage.setItem(STORAGE_KEYS.profile, ${JSON.stringify(JSON.stringify(blob))}); loadForge(); _packRewardMakeGood();`);
  const idsB = packs(J).map((p) => p.id).filter((i) => i.startsWith('pk_rw_')).sort();
  const missingOnA = idsB.filter((i) => !idsA.includes(i));
  ok(missingOnA.length === 1 && /mystery/.test(missingOnA[0]), 'a second device mints the SAME entry ids, so the union merge by id cannot double them', JSON.stringify(missingOnA));
}

/* ── 6. cloud: the same-device reload branch ─────────────────────────────── */
console.log('6. a signed-in reload (local-is-fresher) runs the make-good and uploads the packs');
{
  const { e, run, J } = fresh();
  run(`var __rows = [], __fetchRow = null;
       const __q = () => { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
         maybeSingle() { return Promise.resolve({ data: __fetchRow, error: null }); },
         update() { return q; }, upsert(row) { __rows.push(row); return Promise.resolve({ error: null }); } }; return q; };
       Cloud.client = { from: () => __q(), rpc: () => Promise.resolve({ data: null }), auth: {} };
       initCloud = () => true;
       Profile.cloud.signedIn = true; Profile.cloud.userId = 'u1'; Profile.cloud.ownerUserId = 'u1';`);
  const tier = J('SEASON_FREE_REWARDS.findIndex(r => r && r.kind === "pack")');
  const blob = { seasonPass: { seasonNumber: 1, xp: 99999, tier: 30, seasonStartedAt: Date.now(), claimedFreeTiers: { [tier]: true }, claimedPremiumTiers: {} },
    records: { battles: 30, wins: 20, losses: 10 }, heroes: { cedric: { level: 5 } } };
  run(`delete Profile.seasonPass; localStorage.setItem(STORAGE_KEYS.profile, ${JSON.stringify(JSON.stringify(blob))});
       loadForge(); saveProfile(); Profile.cloud._hydratedFromCloud = true;
       __fetchRow = { user_id: 'u1', updated_at: new Date(Date.now() - 60000).toISOString(), records: { battles: 30, wins: 20, losses: 10 }, gems: 10,
                      forge: { __seasonPass__: ${JSON.stringify(blob.seasonPass)} } };`);
  const r = await run('cloudFetchProfile()');
  await new Promise((res) => setTimeout(res, 40));
  ok(!!(r && r.skippedMerge), 'the fetch took the local-is-fresher branch', JSON.stringify(r));
  ok(packs(J, 'basic').length === 1, 'the owed pack was granted there', packs(J).length);
  const up = e.sandbox.__rows.map((x) => x && x.forge).filter(Boolean).pop() || {};
  ok(Array.isArray(up.__unopenedPacks__) && up.__unopenedPacks__.some((p) => p.packId === 'basic'), 'the re-upload carries the pack');
  ok(up.__packRewardGrants__ && Object.keys(up.__packRewardGrants__).length === 1, 'and the grant ledger', JSON.stringify(up.__packRewardGrants__));
}
{
  // hydration: a cloud ledger key blocks a stale device from re-granting a pack
  // the player already opened elsewhere.
  const { run, J } = fresh();
  run(`const sp = _ensureSeasonPass(); sp.claimedFreeTiers = { 3: true };`);
  const key = J('_seasonPackGrantKey(Profile.seasonPass, "free", 3)');
  run(`Profile.packRewardGrants = Object.assign({}, { ${JSON.stringify(key)}: 1 });`);
  ok(J('_packRewardMakeGood()') === 0 && packs(J).length === 0, 'a key already in the (cloud-merged) ledger is never re-granted');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
