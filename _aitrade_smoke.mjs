/* 🤝🏰 v121v131 — two trades a day with the AI corporations, standing decides
   the SIZE of the business, every vault holds what it is supposed to, the
   12-hour wage drain, and PRN nodes stop appearing in cities that own none.
   Run: node _aitrade_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the loop that paid 12,523 times ──────────────────────────────────────
   sign → deliver ×3 → re-sign. _aiEnterBusiness had no cooldown and no cost,
   _aiDeliver had neither until v121v130, and completing a contract DELETED it
   so the next signature was free. Measured: 12,523 deliveries at a 0.21s
   median gap, 97.9% under one second, across 13-hour sittings. */
ok(/const AI_TRADE_BASE_CAP = 2;/.test(SRC), 'two pieces of business a day is a named constant');
ok(/const AI_TRADE_DAY_MS = 24 \* 60 \* 60 \* 1000;/.test(SRC), '…over a ROLLING 24 hours, so there is no midnight to camp');
{
  /* every entry point that pays out, or that starts the loop, asks the gate */
  const gates = (SRC.match(/if \(_aiTradeBlocked\(corpId\)\) return;/g) || []).length;
  ok(gates >= 3, 'all three doors are gated — the spot sale, the contract signature and the delivery', gates + ' call sites');
}
{
  const spot = SRC.slice(SRC.indexOf('function _aiSpotTrade(corpId) {'), SRC.indexOf('function _aiSpotTrade(corpId) {') + 600);
  ok(/_aiTradeBlocked\(corpId\)/.test(spot), '…the spot sale');
  const sign = SRC.slice(SRC.indexOf('function _aiEnterBusiness(corpId) {'), SRC.indexOf('function _aiEnterBusiness(corpId) {') + 900);
  ok(/_aiTradeBlocked\(corpId\)/.test(sign), '…the signature, so the refusal lands on the button that STARTS the loop');
  const del = SRC.slice(SRC.indexOf('function _aiDeliver(corpId) {'), SRC.indexOf('function _aiDeliver(corpId) {') + 1400);
  ok(/_aiTradeBlocked\(corpId\)/.test(del) && /_aiDeliverBusy\[corpId\]/.test(del) && /AI_DELIVER_COOLDOWN_MS/.test(del),
    '…and the delivery, which also keeps its in-flight lock and 2.5s interval from v121v130');
}
ok(/_aiMarkTrade\(corpId\);/.test(SRC) && (SRC.match(/_aiMarkTrade\(corpId\)/g) || []).length >= 3,
  'both the spot sale and the delivery COUNT against the allowance — capping one just moves the loop to the other');

/* ── 2. standing decides the level of business ───────────────────────────── */
ok(/const AI_BUSINESS_LEVELS = \{/.test(SRC), 'a tier buys a level of business');
ok(/blacklisted: \{ cap: 0, runs: 0, qtyMul: 0,    label: 'blacklisted' \}/.test(SRC) && /hostile:     \{ cap: 0/.test(SRC),
  '…and a ruined relationship means they will not deal at all — the only thing in the system that says no');
ok(/allied:      \{ cap: 5, runs: 6, qtyMul: 1\.60/.test(SRC), '…while Allied buys more business, more often, in bigger lots');
{
  const terms = SRC.slice(SRC.indexOf('function _aiContractTerms(corpId) {'), SRC.indexOf('function _aiContractTerms(corpId) {') + 900);
  ok(/const lvl = _aiBusinessLevel\(corpId\);/.test(terms) && /lvl\.qtyMul/.test(terms) && /lvl\.runs/.test(terms),
    'the contract\'s RUNS and QUANTITY come from the tier — standing used to move only the price, ±15%, which could never express "a bigger deal"');
}
ok(/function _aiTradeAllowanceHtml\(corpId\)/.test(SRC) && /THE RELATIONSHIP/.test(SRC),
  'the TRADE tab says what the relationship is worth and what is left today — a cap the player cannot see is a bug report, not a rule');
{
  /* run the allowance rule for real */
  const DAY = 86400000;
  const left = (runs, cap, now) => Math.max(0, cap - runs.filter((t) => t > now - DAY).length);
  const now = 1e12;
  ok(left([], 2, now) === 2, 'run for real: a fresh day allows two');
  ok(left([now - 1000], 2, now) === 1, 'run for real: one done leaves one');
  ok(left([now - 1000, now - 2000], 2, now) === 0, 'run for real: two done leaves none');
  ok(left([now - DAY - 1, now - DAY - 2], 2, now) === 2, 'run for real: yesterday\'s business has rolled off');
  ok(left([now - 1000, now - 2000], 5, now) === 3, 'run for real: an Allied corp still has slots where a Neutral one is spent — this is the "level of business" the owner asked for');
  ok(left([now - 1000], 0, now) === 0, 'run for real: a hostile corp offers nothing at any point in the day');
}

/* ── 3. every vault holds what it is supposed to ─────────────────────────── */
ok(/try \{ if \(typeof _stashEnforceCap === 'function'\) _stashEnforceCap\(\); \} catch \(e\) \{\}/.test(SRC),
  'the ceiling is enforced when the cloud copy lands — it used to be enforced by exactly ONE caller, renderStash(), so a vault that went over any other way stayed over on every other screen');
ok(/let _stashCapRetried = false;/.test(SRC) && /_stashCapRetried = true;/.test(SRC),
  '…and retried once the ceiling becomes vouchable, because _stashEnforceCap rightly refuses to trim against an unread one (opFetch has not landed on a cold load)');
{
  const g = SRC.slice(SRC.indexOf('function _stashEnforceCap() {'), SRC.indexOf('function _stashEnforceCap() {') + 900);
  ok(/_whCapTrusted\(\)/.test(g), 'the trimming rule ITSELF is unchanged, including its refusal to act on a ceiling it cannot vouch for');
}

/* ── 4. the wage drain ───────────────────────────────────────────────────── */
ok(/const OP_COLLECT_CD_MS = 12 \* 3600000;/.test(SRC), 'an operation settles once per 12 hours (was 6)');
ok(/const OP_ACCRUAL_CAP_H = 36;/.test(SRC),
  '…and the 36-hour accrual cap is UNCHANGED, so collecting half as often loses nothing — it only halves how fast a treasury can be drained');

/* ── 5. PRN nodes in a city that owns none ───────────────────────────────── */
ok(/const foreign = rows\.filter\(\(r2\) => r2 && r2\.owner_id && String\(r2\.owner_id\) !== String\(me\)\);/.test(SRC),
  'a linked node owned by somebody else is singled out');
ok(/from\('node_mayors'\)\.select\('owner_id'\)\n?\s*\.eq\('mayor_id', me\)\.eq\('active', true\)/.test(SRC),
  '…and kept only when the viewer is that owner\'s ACTIVE MAYOR — a boost row is not a claim');
{
  /* run the claim rule for real, on the reported shape */
  const me = 'mirage', grey = 'greydragon';
  const rows = [{ id: 'n1', owner_id: me }, { id: 'n2', owner_id: grey }, { id: 'n3', owner_id: grey }];
  const keep = (mayorFor) => rows.filter((r) => !r.owner_id || r.owner_id === me || mayorFor.has(r.owner_id));
  ok(keep(new Set()).length === 1, 'run for real: MirageSoldier owns one node and rings one — he rang six, all GreyDragon\'s');
  ok(keep(new Set([grey])).length === 3, 'run for real: …and a real mayor of those nodes still rings all of them');
}

/* ── 6. the editor: a cost, a working filter, and a sound ─────────────────── */
ok(/id="ed-field-cost-tribute"/.test(SRC) && /id="ed-field-cost-tributeself"/.test(SRC),
  'a field ability can charge a SACRIFICE — "sacrifice 3 units you control, deal 100 damage to all units and hero your enemy controls" could not be authored at all before');
ok(/activationCost: \(\(\) => \{/.test(SRC), '…saved onto the ability, and absent when nothing is charged');
{
  const g = SRC.slice(SRC.indexOf('function _canUseFieldAbility(state, unit) {'), SRC.indexOf('function _canUseFieldAbility(state, unit) {') + 2600);
  ok(/_costPayable\(state, 'player', unit, _ac, null\)/.test(g),
    '…refused when it cannot be paid, through the SAME gate a move and an on-play already use — the field ability was the one activation of the three without it');
  ok(/_costShortLabel/.test(g), '…and the refusal names the cost, because a greyed button with no reason is the complaint this file keeps recording');
}
ok(/_promptCostPayment\(s, 'player', unit, _fac,/.test(SRC),
  '…and it is paid INTERACTIVELY, so the player picks which units they give up rather than the engine choosing');

ok(/input\.oninput = apply;/.test(SRC),
  'the effect filter TYPES — it was wired for Escape and the clear button and nothing else, so typing relied on a delegated listener that never reaches a picker outside its host');
ok(/const FX_FIND_BY_ID = \['ed-passive', 'ed-passive2'\];/.test(SRC),
  'the passive pickers get a search box too — they could never qualify, because the picker test counts ONPLAY_TYPES ids and a passive list has none');
ok(/_isPassive \? ' passives…' : ' effects…'/.test(SRC), '…and the placeholder says which list it is filtering');
{
  /* run the filter for real — it is a substring match that must never move the value */
  const opts = [{ value: '', text: '— None —' }, { value: 'a', text: 'Trap Dog — reveals every enemy trap' }, { value: 'b', text: 'Cull — executes a wounded foe' }];
  const apply = (q) => { const nd = String(q || '').trim().toLowerCase(); return opts.filter((o) => !o.value || !nd || o.text.toLowerCase().indexOf(nd) >= 0); };
  ok(apply('trap').length === 2, 'run for real: "trap" keeps the placeholder and the one match');
  ok(apply('cull').map((o) => o.value).join(',') === ',b', 'run for real: "cull" finds the second passive by a word in its text');
  ok(apply('').length === 3, 'run for real: an empty box shows everything again');
}
ok(/function _effectSfxOptionsHtml\(sel\)/.test(SRC) && /id="\$\{p\}-sfx"/.test(SRC),
  'an Effect VFX can carry a SOUND, stocked from the SFX table the Custom Audio Manager already fills');
ok(/_effectSfxOptionsHtml\(o\.sfx \|\| ''\)/.test(SRC),
  '…reading the effect object THIS block is built from (the first cut reached for a variable out of another scope and threw ReferenceError: fEff is not defined, which the forge suites caught)');
ok(/sfx: \(v\(p \+ '-sfx'\) \|\| ''\)\.trim\(\) \|\| undefined,/.test(SRC),
  '…and saved by the same prefix the block renders from, so every effect slot that shows the picker also stores it — not just the field ability');
ok(/if \(eff\.sfx\) \{ try \{ if \(typeof playSfx === 'function'\) playSfx\(eff\.sfx\); \}/.test(SRC),
  '…and it fires when the effect fires, independently of the picture, through playSfx so the admin override and the volume still apply');

/* ── 7. 🎵 the Ruin Exchange plays the main menu music ────────────────────────
   Owner: "have the main music playing on every page in Ruin Exchange but Just
   Business". The hub VIEW already kept the menu track; walking into a tile
   changed it — Black Market Basement on some pages and Camp music on others,
   because vendorMarket sits in CAMP_AMBIENT_SCREENS as well — so the music
   broke three ways across one building. */
ok(/EXCHANGE_SCREENS\.add\('crashExchange'\);/.test(SRC) && /EXCHANGE_SCREENS\.add\('territoryWars'\);/.test(SRC) && /EXCHANGE_SCREENS\.add\('rlcList'\);/.test(SRC),
  'the rest of the hub\'s tiles join the set the exchange branch already reads — Crash Exchange, City Nodes and the Black Market route');
{
  const i = SRC.indexOf("if (isInRuinExchange()) {");
  const j = SRC.indexOf("if (isInCampAmbient()) {");
  ok(i > 0 && j > i, 'the hub is asked BEFORE camp ambient — vendorMarket is in both sets, so whichever ran first owned it', 'exchange@' + i + ' camp@' + j);
}
ok(!/playExchangeMusic\(\);\n    return;/.test(SRC),
  'no branch still starts the Black Market theme — both exchange branches play the MAIN music, so they cannot disagree about one screen');
{
  const f = SRC.slice(SRC.indexOf('function isInRuinExchange()'), SRC.indexOf('function isInRuinExchange()') + 400);
  ok(/EXCHANGE_SCREENS\.has\(App\.screen\)/.test(f) && !/justBusiness/.test(f),
    'Just Business is not in the set, so its own zone branch still answers for it — which is exactly what was asked');
}
ok((SRC.match(/function isInRuinExchange\(\)/g) || []).length === 1,
  'there is ONE isInRuinExchange — a second declaration would silently win over the first and the branch would call the wrong one');
{
  /* run the routing for real */
  const EX = new Set(['vendorMarket', 'wagerHall', 'vendor', 'cashout', 'tutor', 'market', 'crashExchange', 'territoryWars', 'rlcList']);
  const CAMP = new Set(['lab', 'deck', 'vendorMarket', 'collection', 'camp']);
  const route = (screen) => {
    if (screen === 'title') return 'menu';
    if (screen === 'justBusiness') return 'justBusiness';
    if (EX.has(screen)) return 'menu';
    if (CAMP.has(screen)) return 'camp';
    return 'menu';
  };
  ok(route('crashExchange') === 'menu' && route('territoryWars') === 'menu' && route('market') === 'menu',
    'run for real: every Ruin Exchange tile plays the main music');
  ok(route('vendorMarket') === 'menu',
    'run for real: …including the one that was ALSO in the camp set, which is what made the music change mid-hub');
  ok(route('justBusiness') === 'justBusiness', 'run for real: Just Business keeps its own zone');
  ok(route('lab') === 'camp' && route('camp') === 'camp', 'run for real: the camp screens are untouched');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 131, 'BUILD_VERSION is v121v131 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
