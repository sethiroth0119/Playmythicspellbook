/* 🧾 PROFILE PERSISTENCE AUDIT (2026-09-22) — and the guard that keeps it closed.

   Five player reports in one sweep (gymWars, missions, seasonPass, aiTrade,
   research, campWorkforce) were ONE defect: saveProfile() writes the WHOLE
   Profile to localStorage, but loadForge() restores a WHITELIST of `p.<field>`
   — and on a same-device reload the boot saveProfile() stamps
   lastLocalEditAt, so cloudFetchProfile() takes the local-is-fresher branch,
   SKIPS hydration and re-uploads local. A field missing from loadForge
   therefore resets on reload and the blank is written over the good cloud copy.

   The audit found ~50 more. This file drives the REAL functions out of
   public/index.html (tools/gamedev/headless loadEngine) — TRAP 8 in the bug
   handoff is a fix that read right and was dead — and pins:
     1. every fixed field comes back from hg_profile through loadForge;
     2. the reload race end to end: loadForge → boot saveProfile → a signed-in
        cloudFetchProfile that takes the local-is-fresher branch → the upload
        row still carries what the player bought;
     3. a STALE cloud row (cloud judged fresher) cannot remove an owned thing,
        and a FRESH device adopts the cloud's;
     4. rentals are rebuilt from the realty_listings receipt;
     5. the dilemma standing no longer depends on owning a Bunkhouse, and a
        mid-battle side-deck loan is returned on load;
     6. THE GUARD: every Profile field index.html writes must be (a) restored
        by loadForge, (b) on the documented transient list, or (c) on the
        documented own-key list below. A new field on none of them FAILS here,
        naming the field — so this class cannot come back silently. And every
        field loadForge claims to restore is restored when present ALONE (a
        text scan cannot see a restore nested inside another field's `if`,
        which is how the dilemma one hid).

   Run: node _persistaudit_smoke.mjs      (PERSIST_FILE=<html> to run another copy) */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadEngine, INDEX } from './tools/gamedev/headless.mjs';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x));
  if (c) passes++; else fails++;
};
const FILE = process.env.PERSIST_FILE || INDEX;
const SRC = readFileSync(FILE, 'utf8');
const fresh = () => {
  const e = loadEngine({ file: FILE });
  const run = (s) => vm.runInContext(s, e.sandbox);
  const J = (s) => { const t = run('JSON.stringify(' + s + ')'); return t === undefined ? undefined : JSON.parse(t); };
  return { e, run, J };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── 1. reload restores ──────────────────────────────────────────────────── */
const SAMPLES = {
  // paid for (commit "bought furniture, gems, crafted weapons …")
  furnitureOwned: { sofa_red: 2, lamp: 1 }, gemsOwned: { ruby: 3 },
  craftedItems: { wsc_carbine_7: { id: 'wsc_carbine_7', name: 'Carbine' } },
  ownedDiceSkins: ['dice_bone'], equippedDiceSkin: 'img/dice_bone.png', equippedDiceSkinId: 'dice_bone',
  unlockedTraders: ['trader_moss'], traderStock: { trader_moss: { food: 12 } },
  dojoUnlocked: true, dojoStock: { fireball: 2 }, weaponSmithUnlocked: true,
  weaponSmith: { bench: { id: 'b1' }, log: [] }, jbLocalOps: [{ id: 'op1', op_type: 'bakery' }],
  farm: { ts: 5, plots: [1] }, cityCards: { card_a: true }, wagePool: { bal: 900, updated: 7 },
  // on no list at all
  kitchen: { xp: 40, upgrades: ['grill'], startGranted: true, reliefAt: 9 },
  rentals: { L1: { until: 4102444800000, name: 'Flat' } },
  tw_state: { ownedNodes: { n1: { guards: [{ deckId: 'g' }], upgrades: ['wall'] } }, vault: { metal: 5 }, capturedSectors: {}, lastDecayCheck: 0 },
  reserveConvoys: [{ id: 'cv1', resId: 'metal', qty: 40, arriveAt: 4102444800000 }],
  walletOutbox: [{ ref: 'c_1', amount: 50, reason: 'win', at: 1, tries: 0 }],
  fieldShop: { traders: { t1: { float: 1200, lots: {} } } },
  // reset stamps
  gearResetApplied: '2026-07-29-gear-clean', purgeResetApplied: 'p1', seasonResetApplied: 's1',
  // progress / cooldowns the cloud carried
  breedCooldowns: { u1: 4102444800000 }, workSalt: 'salt-abc', will: { u1: { current: 20 } },
  permadeath: [{ id: 'x' }], stabilizeBleeding: { u1: { bleedingOut: true } }, labCampTombs: { 'core:c1': 5 },
  packHistory: [{ id: 'h1' }], squads: { a: { b: 3 } }, onboarding: { complete: true },
  tutorialsSeen: { camp: 1 }, corpPick: 'corp-9', purgeReTutorial: true,
  // cooldowns, latches, choices
  _csBedRestAt: 1700000000000, lastDreamAt: 1700000000001, hunger: 33, thirst: 44, ownedNodeEver: true,
  forceStarterPick: true, corpLaws: { c1: { tax: 3 } }, _corpXferSeen: { t9: 1 }, _staffSeen: { 's:offered:5:0': 1 },
  campNodeContrib: { n1: { buildings: 2 } }, cityPrint: { units: 10, lastDay: 3 }, readNotes: { n_1: 5 },
  reserveSpecialty: 'metal', athenaAvatar: 'avatar_7', lastHuntCard: 'card_x',
  // restored before, and now cross-device
  campDefense: 4, campPoweredUntil: 4102444800000, campRepairUntil: 4102444800001,
  bunkhouse: { built: 1, house: { billets: [], lastAt: 1, lastCollect: 0 } },
  dilemma: { resolved: 4, updatedAt: 5 },
};
console.log('1. a reload restores every audited field');
{
  const { run, J } = fresh();
  run(`for (const k of ${JSON.stringify(Object.keys(SAMPLES))}) delete Profile[k];
       localStorage.setItem(STORAGE_KEYS.profile, ${JSON.stringify(JSON.stringify(SAMPLES))}); loadForge();`);
  const lost = Object.keys(SAMPLES).filter((k) => !same(J('Profile[' + JSON.stringify(k) + ']'), SAMPLES[k]));
  ok(!lost.length, 'all ' + Object.keys(SAMPLES).length + ' fields survive loadForge', lost.join(', '));
}

/* ── 2. the reload race, end to end ──────────────────────────────────────── */
function cloudStub(run) {
  run(`
    var __rows = [], __fetchRow = null, __realty = [];
    const __q = (tbl) => { const q = {
      select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return tbl === 'realty_listings' ? Promise.resolve({ data: __realty, error: null }) : q; },
      maybeSingle() { return Promise.resolve({ data: __fetchRow, error: null }); },
      update() { return q; }, upsert(row) { __rows.push(row); return Promise.resolve({ error: null }); } }; return q; };
    Cloud.client = { from: (t) => __q(t), rpc: () => Promise.resolve({ data: null }), auth: {} };
    initCloud = () => true;
    Profile.cloud.signedIn = true; Profile.cloud.userId = 'u1'; Profile.cloud.ownerUserId = 'u1';
  `);
}
const tick = () => new Promise((r) => setTimeout(r, 20));
console.log('2. same-device reload: local wins, and the upload still carries the purchases');
{
  const { e, run, J } = fresh();
  cloudStub(run);
  const blob = { furnitureOwned: { sofa_red: 2 }, gemsOwned: { ruby: 3 }, unlockedTraders: ['trader_moss'],
    jbLocalOps: [{ id: 'op1', op_type: 'bakery' }], gearResetApplied: 'g1', workSalt: 'salt-abc',
    kitchen: { xp: 40, upgrades: ['grill'], startGranted: true }, campDefense: 4,
    records: { battles: 30, wins: 20, losses: 10 }, heroes: { cedric: { level: 5 } } };
  run(`localStorage.setItem(STORAGE_KEYS.profile, ${JSON.stringify(JSON.stringify(blob))});
       for (const k of ['furnitureOwned','gemsOwned','unlockedTraders','jbLocalOps','gearResetApplied','workSalt','kitchen']) delete Profile[k];
       loadForge(); saveProfile();                      // boot: restore, then the boot save stamps lastLocalEditAt
       Profile.cloud._hydratedFromCloud = true;
       __fetchRow = { user_id: 'u1', updated_at: new Date(Date.now() - 60000).toISOString(),
                      records: { battles: 30, wins: 20, losses: 10 }, gems: 10,
                      forge: { __furnitureOwned__: { sofa_red: 2 }, __gemsOwned__: { ruby: 3 }, __gearReset__: 'g1' } };`);
  const r = await run('cloudFetchProfile()');
  await tick(); await tick();
  ok(!!(r && r.skippedMerge), 'the fetch takes the local-is-fresher branch (hydration skipped)', JSON.stringify(r));
  const up = e.sandbox.__rows.map((x) => x && x.forge).filter(Boolean).pop() || {};
  ok(same(up.__furnitureOwned__, { sofa_red: 2 }), 'the re-upload still carries the bought furniture', JSON.stringify(up.__furnitureOwned__));
  ok(same(up.__gemsOwned__, { ruby: 3 }), '…the socket gems', JSON.stringify(up.__gemsOwned__));
  ok(same(up.__unlockedTraders__, ['trader_moss']), '…the 25,000-Cinder trader unlock', JSON.stringify(up.__unlockedTraders__));
  ok(Array.isArray(up.__jbLocalOps__) && up.__jbLocalOps__.length === 1, '…the personally-funded operation');
  ok(up.__gearReset__ === 'g1', '…and the one-time gear-clean stamp is not blanked', JSON.stringify(up.__gearReset__));
  ok(up.__workSalt__ === 'salt-abc', 'the work salt is not re-minted on reload', up.__workSalt__);
  ok(!!(up.__kitchen__ && up.__kitchen__.startGranted), 'the Kitchen rides the cloud row');
  ok(up.__campDefense__ === 4, 'the camp fortify level rides the cloud row', up.__campDefense__);
}

/* ── 3. hydration: a stale cloud removes nothing; a fresh device adopts ──── */
console.log('3. cloud hydration merges never undo a purchase');
async function hydrate(local, forge) {
  const { run, J } = fresh();
  cloudStub(run);
  run(`Object.assign(Profile, ${JSON.stringify(local)});
       Profile.cloud.lastLocalEditAt = 0; Profile.cloud.pendingChanges = false; Profile.cloud._hydratedFromCloud = true;
       __fetchRow = { user_id: 'u1', updated_at: new Date().toISOString(), records: { battles: 30, wins: 20, losses: 10 },
                      gems: 10, forge: ${JSON.stringify(forge)} };`);
  await run('cloudFetchProfile()');
  return J;
}
{
  const J = await hydrate(
    { furnitureOwned: { sofa_red: 2, lamp: 1 }, unlockedTraders: ['a', 'b'], ownedDiceSkins: ['d1'], dojoUnlocked: true,
      gemsOwned: { ruby: 3 }, kitchen: { xp: 50, upgrades: ['grill'], startGranted: true, reliefAt: 9 },
      campDefense: 6, campPoweredUntil: 900, bunkhouse: { built: 1, house: { billets: ['mine'] } }, gearResetApplied: 'g1' },
    { __furnitureOwned__: { sofa_red: 1 }, __unlockedTraders__: ['a'], __ownedDiceSkins__: [], __dojoUnlocked__: false,
      __gemsOwned__: { ruby: 1 }, __kitchen__: { xp: 10, upgrades: ['fryer'], startGranted: false, reliefAt: 2 },
      __campDefense__: 2, __campPoweredUntil__: 100, __bunkhouse__: { built: 1, house: { billets: ['theirs'] } }, __gearReset__: '' });
  ok(same(J('Profile.furnitureOwned'), { sofa_red: 2, lamp: 1 }), 'stale cloud: furniture kept (max per piece)', JSON.stringify(J('Profile.furnitureOwned')));
  ok(same(J('Profile.unlockedTraders').sort(), ['a', 'b']), 'stale cloud: trader unlocks kept (union)');
  ok(same(J('Profile.ownedDiceSkins'), ['d1']), 'stale cloud: dice skins kept');
  ok(J('Profile.dojoUnlocked') === true, 'stale cloud: Dojo licence stays on');
  ok(J('Profile.gemsOwned.ruby') === 3, 'stale cloud: gems kept (max)');
  const k = J('Profile.kitchen');
  ok(k.xp === 50 && same(k.upgrades.slice().sort(), ['fryer', 'grill']) && k.startGranted === true && k.reliefAt === 9,
    'kitchen: more-xp body kept, upgrades unioned, receipts never re-armed', JSON.stringify(k));
  ok(J('Profile.campDefense') === 6 && J('Profile.campPoweredUntil') === 900, 'camp fortify / overclock only rise');
  ok(same(J('Profile.bunkhouse.house.billets'), ['mine']), 'a built Bunkhouse is never overwritten by the cloud copy');
  ok(J('Profile.gearResetApplied') === 'g1', 'a blank cloud stamp does not clear the local one');
}
{
  const J = await hydrate({ kitchen: {}, campDefense: 0, bunkhouse: { built: 0, house: null } },
    { __kitchen__: { xp: 70, upgrades: ['grill'], startGranted: true, reliefAt: 3 }, __campDefense__: 5,
      __campRepairUntil__: 4102444800000, __bunkhouse__: { built: 1, house: { billets: ['c1'] } } });
  ok(J('Profile.kitchen.xp') === 70 && J('Profile.kitchen.startGranted') === true, 'fresh device adopts the cloud Kitchen');
  ok(J('Profile.campDefense') === 5 && J('Profile.campRepairUntil') === 4102444800000, 'fresh device adopts fortify level and repair window');
  ok(J('Profile.bunkhouse.built') === 1 && same(J('Profile.bunkhouse.house.billets'), ['c1']), 'fresh device adopts the built Bunkhouse');
}

/* ── 4. rentals rebuilt from the server receipt ──────────────────────────── */
console.log('4. a paid rental is rebuilt from realty_listings');
{
  const { e, run, J } = fresh();
  cloudStub(run);
  const until = new Date(Date.now() + 3 * 86400000).toISOString();
  run(`Profile.rentals = {};
       __realty = [
         { id: 'L1', seller_id: 's', buyer_id: 'u1', status: 'rented', rent_until: '${until}', node_id: 'n4', residents: 3, prop_id: 'p1', prop_json: { name: 'Loft' }, paid_out: true },
         { id: 'L2', seller_id: 's', buyer_id: 'u1', status: 'rented', rent_until: '2001-01-01T00:00:00Z', prop_json: {}, paid_out: true },
         { id: 'L3', seller_id: 's', buyer_id: 'someone', status: 'rented', rent_until: '${until}', prop_json: {}, paid_out: true } ];`);
  await run('realtyFetch()');
  const R = J('Profile.rentals');
  ok(!!(R && R.L1 && R.L1.nodeId === 'n4' && R.L1.name === 'Loft'), 'my active rental is adopted', JSON.stringify(R));
  ok(!R.L2 && !R.L3, 'an expired rental and someone else\'s are not');
}

/* ── 5. the two structural cases ─────────────────────────────────────────── */
console.log('5. dilemma without a Bunkhouse; the side-deck loan');
{
  const { run, J } = fresh();
  run(`delete Profile.dilemma; delete Profile.bunkhouse;
       localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify({ dilemma: { resolved: 4, updatedAt: 5 } })); loadForge();`);
  ok(J('Profile.dilemma && Profile.dilemma.resolved') === 4, 'dilemma standing restored for a player with no Bunkhouse');
  run(`localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify({ sideDeck: { cards: ['swapped_in'], gems: [] }, _sideDeckPreBattle: ['real_1', 'real_2'] })); loadForge();`);
  ok(same(J('Profile.sideDeck.cards'), ['real_1', 'real_2']), 'a reload mid-battle returns the real side deck', JSON.stringify(J('Profile.sideDeck.cards')));
  ok(J('Profile._sideDeckPreBattle') === undefined, 'and does not keep a stale snapshot');
}

/* ── 6. THE GUARD ────────────────────────────────────────────────────────── */
/* (b) INTENTIONALLY NOT RESTORED BY loadForge — each with the reason.
   Adding a name here is a decision: write down why a reload may reset it. */
const TRANSIENT = {
  cloud:               'session + sync bookkeeping, re-established at sign-in; the owner stamp has its own key (PROFILE_OWNER_KEY, see saveProfile)',
  _bondScale:          'global short-circuit only; the real per-entry flag (bondScaled) is saved inside units/heroes',
  _resMergedV1:        'legacy fold flag; Profile.resources is blanked after the one-time fold, so re-running is a no-op',
  resources:           'legacy pre-salvage ledger, folded into Profile.salvage and blanked (_ensureResources)',
  _dreamPremonition:   'write-only: nothing reads it',
  activeDream:         'write-only: nothing reads it',
  _starterRestore:     'self-heal version flag; _starterDeckRestoreCheck re-runs idempotently, guarded by ownedStarterDecks + entitlement',
  cardShopUnlocked:    'legacy flag; the licence is _ownsOp(\'cardshop\') on operation rows, and _csApplyResetOnce clears the flag',
  campMilestoneClaims: 'client cache only; tw_node_claim_milestone dedups server-side (already_claimed)',
  walletSeqProfile:    'device snapshot marker, local-only by design; 0 after reload means "adopt the server" — the fail-safe direction',
  walletSeqProgress:   'as walletSeqProfile',
  lockedGems:          'LEGACY soft bid lock, used only when sql/193 is not applied; with it, bids are debited into the server escrow and auction_escrow_sync rebuilds CardMarket.escrowHeld after a reload (_auctionescrow_smoke.mjs). Restoring this alone would strand funds on an outbid',
  lockedSov:           'as lockedGems (Aza auctions)',
};
/* (c) PERSISTED UNDER ITS OWN KEY / BY THE SERVER — cite where. */
const OWN_KEY = {
  bmPass:                'localStorage BM_PASS_KEY, read back in hasBmPass()',
  campNodeId:            'tw_camp_registrations, restored by tw_cloudRestoreMyCampReg (never emit a blank — see the campWorkforce note in loadForge)',
  seasonWalletResetOwed: 'localStorage hg_season_wallet_owed, read back in _seasonClearServerCinder()',
  salvageSync:           'restored from p by _salvageNoteBoot(p), which loadForge calls (sql/190 merge base; device id also in localStorage hg_salvage_dev)',
};
console.log('6. guard: every Profile field is restored, transient, or own-key');
{
  const lines = SRC.split('\n');
  const body = (re) => {
    const i = lines.findIndex((l) => re.test(l));
    let j = i + 1; while (j < lines.length && lines[j] !== '}') j++;
    return lines.slice(i, j + 1).join('\n');
  };
  const LF = body(/^function loadForge\(/);
  const restored = new Set([...LF.matchAll(/\bp\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const written = new Set();
  for (const m of SRC.matchAll(/\bProfile\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\|\|=|\?\?=)/g)) written.add(m[1]);
  for (const m of SRC.matchAll(/\bProfile\.([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]+\])+\s*(?:=(?!=)|\+=|-=)/g)) written.add(m[1]);
  const orphans = [...written].filter((f) => !restored.has(f) && !TRANSIENT[f] && !OWN_KEY[f]).sort();
  ok(written.size > 100 && restored.size > 100, 'scan sanity: ' + written.size + ' written fields, ' + restored.size + ' restored');
  ok(!orphans.length, 'no Profile field is saved and silently dropped on reload', orphans.join(', ')
    + '  → add it to loadForge (and the cloud lists if it must reach other devices), or document it in TRANSIENT / OWN_KEY here');
  const stale = [...Object.keys(TRANSIENT), ...Object.keys(OWN_KEY)].filter((f) => restored.has(f));
  ok(!stale.length, 'no allowlisted field is also restored (keep the lists honest)', stale.join(', '));

  /* Runtime half: a text scan cannot see a restore nested inside another
     field's `if` (the dilemma bug). Put each whitelisted field in the blob
     ALONE and check it lands. Values are tried by type; a field passes if any
     shape lands. Exceptions are restores that deliberately only move in one
     direction or go through a merge helper, and are covered elsewhere. */
  const RUNTIME_SKIP = {
    vaultLayout: '_vaultAdoptPaid (paid capacity; _vault_smoke.mjs)',
    devPoints: 'max-merged pair; a dummy object reads as {0,0}',
    princePortfolios: '_mergePrincePortfolios merges by id',
    competitive: 'spread-merged into the default',
    playerStudy: 'spread-merged into the default',
    leaderboard: 'merged key by key into the default records',
    settings: 'field-by-field whitelist of typed settings',
    cosmetics: 'normalised (default frame re-added)',
    achievements: 'normalised into earned/stats',
    wagers: 'normalised into schedule/history/stats',
    cashout: 'normalised field by field',
    account: 'normalised field by field',
    deckByHero: 'migrated to { name, cards }',
    decks: 'filtered to rows with id + heroId',
    essence: 'numeric values only',
    matchLog: 'objects only',
    ownedHouses: 'rows with a houseId only',
    starterPicked: 'true only',
    _sideDeckPreBattle: 'returned into sideDeck.cards, not kept (section 5)',
    sideDeck: 'normalised { cards, gems }',
    archonDeck: 'normalised { cards }',
    stewardLast: 'normalised { id, kind, at }',
    bunkhouse: 'normalised { built, house }',
    replays: 'sliced to REPLAY_HISTORY_MAX',
    resetEpoch: 'max-merged; the boot global-reset check re-stamps it right after the load',
  };
  const TRY = [{ __pa: 1 }, ['__pa'], [{ id: '__pa', ref: '__pa' }], '__pa', 7, true];
  const { run, J } = fresh();
  const blank = [];
  for (const f of [...restored].sort()) {
    if (RUNTIME_SKIP[f]) continue;
    let landed = false;
    for (const v of TRY) {
      const blob = {}; blob[f] = v;
      run(`try { delete Profile[${JSON.stringify(f)}]; } catch (e) {}
           localStorage.setItem(STORAGE_KEYS.profile, ${JSON.stringify(JSON.stringify(blob))}); loadForge();`);
      const got = J('Profile[' + JSON.stringify(f) + ']');
      if (got !== undefined && (JSON.stringify(got).includes('__pa') || got === 7 || (v === true && got === true))) { landed = true; break; }
    }
    if (!landed) blank.push(f);
  }
  ok(!blank.length, 'every field loadForge names is restored when it is the only one in the save', blank.join(', '));
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
