/* 🎣🚛🏛 v121v96 — the catch is a resource; Drive it closes the board and needs a
   freight truck; the Feed card says both prices; a mayor sees the owner's vault
   and the owner's cards.

   Driven where a function can be lifted (the freight gate, the contracts board,
   the bench, the catch banking, the tide), pinned by text where it is wiring.

   Run: node _fishing1_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const SCREENS = readFileSync('./public/corp/screens.jsx', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/126_city_owner_cards.sql', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── 1. the freight gate, driven ────────────────────────────────────────── */
{
  const code = fnText('_ppFreightRigs') + '\n' + fnText('_ppOwnsFreightRig') + '\n' + fnText('_haulDriveIt');
  const mk = (lot, starterRigIssued, opened) => {
    const log = { toasts: [], opened: 0, removed: 0 };
    const ctx = { Profile: { princePortfolios: { lot, starterRigIssued } }, _ppCargoClassOf: (v) => v.cargoClass || 'freight',
      showToast: (m) => log.toasts.push(m), window: { MythicHaul: opened === false ? null : { open: () => { log.opened++; } } },
      document: { getElementById: () => ({ remove: () => { log.removed++; } }) }, Math, Number, Array, String, Object };
    vm.createContext(ctx);
    vm.runInContext(code + '\nthis.rigs = _ppFreightRigs; this.owns = _ppOwnsFreightRig; this.drive = _haulDriveIt;', ctx);
    ctx.log = log; return ctx;
  };
  let c = mk([], false);
  ok(c.owns() === false, 'an empty lot cannot drive');
  c = mk([{ id: 'a', haul: true, issued: true }], true);
  ok(c.owns() === false, 'the charter\'s issued rig (flagged) does not count');
  c = mk([{ id: 'a', haul: true }], true);
  ok(c.owns() === false, 'a legacy issued rig (unflagged, starterRigIssued set) does not count either');
  c = mk([{ id: 'a', haul: true }, { id: 'b', haul: true }], true);
  ok(c.owns() === true, '…but a second freight truck on that lot does');
  c = mk([{ id: 'a', haul: true }], false);
  ok(c.owns() === true, 'a bought freight truck with no starter history counts');
  c = mk([{ id: 'a', haul: true, cargoClass: 'oil' }, { id: 'b', haul: true, cargoClass: 'feed' }], false);
  ok(c.owns() === false, 'oil and feed rigs are not freight trucks');
  c = mk([{ id: 'a', haul: false, type: 'Coupe' }], false);
  ok(c.owns() === false, 'a car is not a truck');
  c = mk([], false); c.drive();
  ok(c.log.removed === 1 && c.log.opened === 0 && /Buy one from Prince Portfolios/.test(c.log.toasts[0] || ''), 'Drive it closes the board first, then refuses without a truck and says where to buy one');
  c = mk([{ id: 'a', haul: true }], false); c.drive();
  ok(c.log.removed === 1 && c.log.opened === 1 && c.log.toasts.length === 0, 'with a truck: the board closes and Highway Haul opens');
  ok(/rigs: \(\) => \{ try \{ return _ppFreightRigs\(\)\.map/.test(SRC) && /canDrive: \(\) => \{ try \{ return _ppOwnsFreightRig\(\); \}/.test(SRC), 'the haul bridge lists the lot\'s freight trucks and exposes the gate');
  ok(/issued: true,   \/\/ 🚛 the charter's gift/.test(SRC), 'the charter\'s starter rig is minted flagged');
}

/* ── 2. the Feed card says both prices ──────────────────────────────────── */
{
  ok(/const aza = oe \? \(oe\.azaStartup \| 0\) : 0;/.test(SCREENS) && /\(aza > 0 \? ' · or ' \+ aza \+ ' ◈ Aza' : ''\)/.test(SCREENS), 'startupText reads "1,500,000 🔥 · or 55 ◈ Aza" for the Feed Operation');
}

/* ── 3. the mayor sees the owner's vault and the owner's cards ──────────── */
{
  const H = SRC.slice(SRC.indexOf('window.cityResourceHeadroom = () => {'), SRC.indexOf('window.cityResourceHeadroom = () => {') + 1400);
  ok(/if \(CityMgr\.active\) \{[\s\S]*?return \{ cap: 0, units: u, free: Infinity, managed: true \};/.test(H), 'managing: the headroom reports the OWNER\'s units and an open vault, never the mayor\'s totals');
  ok(H.indexOf('if (CityMgr.active)') < H.indexOf("(typeof getResourceUnits === 'function')"), '…and that branch sits before the mayor\'s own getResourceUnits read');
  ok(/rpc\('city_owner_cards_get', \{ p_node_id: String\(node\) \}\)/.test(SRC), 'the crew picker reads the owner\'s collection through city_owner_cards_get');
  ok(/if \(typeof _cityManagedOwner === 'function' && _cityManagedOwner\(\)\) \{\s*const oc = await _cityOwnerCardCollection\(\);\s*if \(!oc\) \{[\s\S]*?return \[\]; \}\s*col = oc;/.test(SRC), '…only when managing, and a failed read is an empty roster, never the mayor\'s cards');
  ok(/create or replace function public\.city_owner_cards_get\(p_node_id text\)/.test(SQL) && /public\._node_manager_owner\(p_node_id\)/.test(SQL) && /security definer/.test(SQL), 'sql/126 gates the read on the caller\'s active mayoral contract');
  ok(/revoke all on function public\.city_owner_cards_get\(text\) from public, anon;/.test(SQL) && /grant execute on function public\.city_owner_cards_get\(text\) to authenticated;/.test(SQL), '…revoked from anon, granted to authenticated');
}

/* ── 4. the catch is a resource ─────────────────────────────────────────── */
{
  const R = SRC.slice(SRC.indexOf('const RESOURCES = ['), SRC.indexOf('\n];', SRC.indexOf('const RESOURCES = [')));
  for (const id of ['freshFish', 'shellfish', 'seaweed', 'primeSeafood', 'monsterParts']) ok(new RegExp("\\{ id: '" + id + "',").test(R), 'RESOURCES has ' + id);
  const ids = (R.match(/^  \{ id: '([A-Za-z0-9_]+)'/gm) || []).map((m) => m.slice(9, -1));
  ok(ids.slice(-5).join(',') === 'primeSeafood,monsterParts,rations,planks,remedies', 'the two fishing ids sit right before the three v121v105 city goods, all LAST (the gauntlet pins the order)');
  ok(new Set(ids).size === ids.length, 'no RESOURCES id is duplicated');
  /* catch banking, driven */
  const bank = fnText('_wf3BankCatch');
  const mk = (rnd) => { const got = {}; const ctx = { WF_CATCH_RES: { Common: 'freshFish', Uncommon: 'shellfish', Rare: 'primeSeafood', Legendary: 'primeSeafood' }, addSalvage: (b) => { for (const k in b) got[k] = (got[k] || 0) + b[k]; }, cxProduce: () => {}, Math: Object.assign(Object.create(Math), { random: () => rnd }), Object }; vm.createContext(ctx); vm.runInContext(bank + '\nthis.bank = _wf3BankCatch;', ctx); return { ctx, got }; };
  let m = mk(0.9); m.ctx.bank({ rarity: 'Common', amount: 7 });
  ok(m.got.freshFish === 7 && !m.got.seaweed, 'a Common catch is 7 Fresh Fish, same units as the old food number');
  m = mk(0.9); m.ctx.bank({ rarity: 'Rare', amount: 15 });
  ok(m.got.primeSeafood === 15, 'a Rare catch is Prime Seafood');
  m = mk(0.9); m.ctx.bank({ rarity: 'Uncommon', amount: 9 });
  ok(m.got.shellfish === 9, 'an Uncommon catch is Shellfish');
  m = mk(0.05); m.ctx.bank({ rarity: 'Common', amount: 3 });
  ok(m.got.freshFish === 3 && m.got.seaweed >= 1 && m.got.seaweed <= 3, 'one cast in six brings up Seaweed with the fish');
  ok(/const banked = _wf3BankCatch\(result\);/.test(SRC) && !/_wf3AddFood\(result\.amount\)/.test(SRC), 'the live trip banks fish, not food');
  ok(/Iced in the hold as/.test(SRC), 'the catch card says "Iced in the hold as …"');
  ok(/salvage: 'freshFish',      qty: \[8, 22\]/.test(SRC) && /salvage: 'shellfish',      qty: \[4, 10\]/.test(SRC) && /salvage: 'primeSeafood',   qty: \[2, 6\]/.test(SRC), 'fleet expeditions drop fish at the old food quantities');
  ok(/fishing:\s+\{ startup: 300000, ratePerWorkerHr: 750,\s+salaryPerWorkerHr: 180, maxWorkers: 14, yields: \{ freshFish: 1\.5, shellfish: 0\.6, seaweed: 0\.3 \}, inputs: \{ fuel: 0\.6 \} \},/.test(SRC), 'the Fishing Company yields 1.5 fresh + 0.6 shellfish + 0.3 seaweed (the old 2.4 food)');
  ok(/cannery:\s+\{ startup: 400000,[^\n]*yields: \{ food: 2\.8 \}, inputs: \{ freshFish: 2\.0 \} \},/.test(SRC) && /cannery: 'Fish Cannery',/.test(SRC), 'the Fish Cannery op eats fresh fish and packs food');
  ok(/\{ id: 'cannery',\s+cat: 'Medical',\s+icon: '🥫'/.test(SCREENS), '…and is on the Just Business shelf');
  ok(/cannery:\s+\{ label: 'Fish Cannery',\s+ico: '🥫',\s+mesh: 'cannery',/.test(NC) && /cannery:\s+\{ out: \['cannedFood'\],\s+ind: 'foodPlant' \},/.test(NC), '…with a city tile and a firm');
}

/* ── 5. the bench and the contracts board, driven ───────────────────────── */
{
  const code = SRC.slice(SRC.indexOf('const WF_BENCH = ['), SRC.indexOf('function _wfRenderContracts(f)'));
  const mk = (salvage, uid, now) => {
    const log = { gems: 0, toasts: [] };
    const ctx = { Profile: { salvage, cloud: { userId: uid }, fishingCorp: {} }, showToast: (m) => log.toasts.push(m),
      spendResources: (c) => { for (const k in c) if ((salvage[k] | 0) < c[k]) return false; for (const k in c) salvage[k] -= c[k]; return true; },
      addRes: (id, n) => { salvage[id] = (salvage[id] | 0) + n; }, addGems: (n) => { log.gems += n; }, saveProfile: () => {}, render: () => {},
      _meta: (id) => ({ icon: '🐟', name: id }), _resCinderValue: (id) => ({ freshFish: 3, shellfish: 4, seaweed: 2, primeSeafood: 8, monsterParts: 12 })[id] || 3,
      _wfResLabel: (id, n) => n + ' ' + id, Date: Object.assign(() => now, Date, { now: () => now }), Math, Object, String, Number, Array };
    vm.createContext(ctx);
    vm.runInContext(code + '\nthis.bench = _wfBenchConvert; this.contracts = _wfContracts; this.fill = _wfFillContract; this.tide = _wfTide; this.done = _wfContractsDone;', ctx);
    ctx.log = log; return ctx;
  };
  const NOW = 1789000000000;
  let c = mk({ freshFish: 12 }, 'u1', NOW);
  c.bench('fresh');
  ok(c.Profile.salvage.freshFish === 7 && c.Profile.salvage.food === 7, 'the bench: 5 fresh fish → 7 food');
  c.bench('prime');
  ok(c.log.toasts.some((t) => /Not enough/.test(t)) && !c.Profile.salvage.food || c.Profile.salvage.food === 7, 'no prime seafood: refused, nothing moves');
  c = mk({}, 'u1', NOW);
  const b1 = c.contracts(), b2 = c.contracts();
  ok(b1.list.length === 4 && JSON.stringify(b1.list) === JSON.stringify(b2.list), 'four contracts per window, identical on every read');
  const c2 = mk({}, 'u2', NOW);
  ok(JSON.stringify(c2.contracts().list) !== JSON.stringify(b1.list), 'a different player gets a different board');
  const c3 = mk({}, 'u1', NOW + 8 * 3600000 + 1);
  ok(JSON.stringify(c3.contracts().list) !== JSON.stringify(b1.list) && c3.contracts().window === b1.window + 1, 'the next 8-hour window is a new board');
  ok(b1.list.every((x) => x.pay >= x.qty * 1 && x.premium >= 1.25 && x.premium <= 1.7), 'every contract pays a premium of 1.25–1.70 over the ledger price');
  const t1 = c.tide(NOW), t2 = c.tide(NOW + 3 * 86400000), t3 = c.tide(NOW + 8 * 86400000);
  ok(t1.id === t2.id && t1.week === t2.week && t3.week === t1.week + 1, 'the tide holds for the week and rolls on the eighth day');
  /* fill one */
  const want = b1.list[0];
  const sal = {}; sal[want.id] = want.qty + 2;
  c = mk(sal, 'u1', NOW);
  c.fill(want.key);
  ok(c.Profile.salvage[want.id] === 2 && c.log.gems === want.pay && c.done()[want.key] === true, 'delivering pays the quoted Cinder, takes exactly the fish, and marks the contract filled');
  c.fill(want.key);
  ok(c.log.gems === want.pay, 'a filled contract cannot be filled twice');
  c = mk({}, 'u1', NOW); c.fill(want.key);
  ok(c.log.gems === 0 && c.log.toasts.some((t) => /Not enough/.test(t)), 'no fish: refused, no Cinder');
  ok(/navItem\('contracts',   'CONTRACTS', null\)/.test(SRC) && /else if \(tab === 'contracts'\)   body = _wfRenderContracts\(f\);/.test(SRC) && /else if \(tab === 'contracts'\)   _wfBindContracts\(\);/.test(SRC), 'the CONTRACTS tab is wired into Woods Fishing');
}

/* ── 6. the knobs ────────────────────────────────────────────────────────── */
{
  const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
  ok(!!v && readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION', v);
  ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
  ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
  ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
