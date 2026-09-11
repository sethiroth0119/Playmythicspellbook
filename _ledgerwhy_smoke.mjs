/* 🧾 LEDGER WHY + GLOBAL DATA + CAMP RETURN (v121v48).

   Asked for, with a screenshot of the phone Ledger:
     · "where it says spent I didn't spend anything, I was raided — be clear
       where money is coming from and where it's going; if it's spent in the
       city builder say so";
     · "always show global data everywhere, never local";
     · "back buttons in camp go to the camp page; the camp page's back goes
       to the bunker".

   Defends, headless:
     · the Profile.gems setter books every direct write with a reason: the
       _ledgerWhy context wins, a _gemsTaxExempt adopt reads as a sync, and
       an anonymous write is "Spent in <screen>";
     · addGems / spendGems / the bank / the incoming watcher do not double-book;
     · repeats fold into one counted row; the server mirror carries the reason;
     · the named sites: three camp raids, Black River fire + raid, Fuel
       Command theft / fine / opex, warehouse rent, the city builder;
     · the valuation and stock pills never say LOCAL and warm the aggregates;
     · _campBackTarget: ops → campOps, bunker → camp; the sub-screens use it;
       the Camp page's own back goes to the Bunker;
     · the phone opens on the account record and folds counts.

   Run: node _ledgerwhy_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const HS = readFileSync('./public/src/phone/handset.js', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── the diary engine, run for real in a sandbox ── */
function sandbox(screen) {
  const ctx = { App: { screen: screen || 'campOps' }, Profile: {}, window: {}, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, Math, String, Number, JSON, Array, Object, isFinite, console, notifySpend() {}, _juiceCurrency() {} };
  ctx.window.MythicHandset = null;
  vm.createContext(ctx);
  const pieces = [
    'let _gemsTaxOff = 0;',
    'function _gemsTaxExempt(fn) { _gemsTaxOff++; try { return fn(); } finally { _gemsTaxOff--; } }',
    'const _cl = { key: null, rows: [], last: null, loaded: false };',
    'function _cinderLedgerKey() { return "k"; }',
    fnText('_cinderLedgerLoad'), fnText('_cinderLedgerAdd'),
    fnText('_ledgerWhy'), fnText('_ledgerQuiet'),
    SRC.slice(SRC.indexOf('const _LEDGER_SCREEN_LABELS = {'), SRC.indexOf('function _ledgerScreenLabel()')),
    fnText('_ledgerScreenLabel'), fnText('_cinderLedgerOnSet'), fnText('_cinderLedgerRecentWhy'),
    /* the setter, exactly as installed */
    `(function () { let gemsRaw = 1000; Object.defineProperty(Profile, 'gems', { get() { return gemsRaw; }, set(v) { const old = gemsRaw; const nv = (typeof v === 'number' && isFinite(v)) ? v : 0; gemsRaw = nv; try { _cinderLedgerOnSet(old, nv); } catch (e) {} }, configurable: true, enumerable: true }); })();`,
    'function rows() { return _cl.rows; }',
  ];
  vm.runInContext(pieces.join('\n'), ctx);
  return ctx;
}
{
  const c = sandbox('campOps');
  vm.runInContext(`Profile.gems = Profile.gems - 200;`, c);
  const r = vm.runInContext('rows()', c);
  ok(r.length === 1 && r[0].d === -200 && r[0].r === 'Spent in the Camp' && r[0].k === 'spend', 'anonymous spend is booked against the screen', JSON.stringify(r));
  vm.runInContext(`_ledgerWhy('Camp raided by Ash Wolves — stores stripped', () => _gemsTaxExempt(() => { Profile.gems = Profile.gems - 300; }));`, c);
  ok(r[0].d === -300 && r[0].r === 'Camp raided by Ash Wolves — stores stripped' && r[0].k === 'spend', 'a raid inside _gemsTaxExempt is booked by its reason, not as a sync', JSON.stringify(r[0]));
  vm.runInContext(`_gemsTaxExempt(() => { Profile.gems = 5000; });`, c);
  ok(r[0].k === 'sync' && /Wallet synced with your account \(received\)/.test(r[0].r) && r[0].d === 4500, 'a bare adopt reads as a sync', JSON.stringify(r[0]));
  vm.runInContext(`_ledgerQuiet(() => { Profile.gems = 4000; });`, c);
  ok(r[0].d === 4500, 'a quiet write books nothing (addGems / spendGems own their row)', JSON.stringify(r[0]));
  vm.runInContext(`_ledgerWhy('Bank of Ethos deposit', () => { Profile.gems = 3000; }, 'bank');`, c);
  ok(r[0].k === 'bank' && r[0].d === -1000, 'the kind travels with the reason (bank icon)', JSON.stringify(r[0]));
  vm.runInContext(`_cinderLedgerAdd(1, 'Received in the Kitchen', 'gain'); _cinderLedgerAdd(1, 'Received in the Kitchen', 'gain'); _cinderLedgerAdd(1, 'Received in the Kitchen', 'gain');`, c);
  ok(r[0].d === 3 && r[0].n === 3 && r[0].r === 'Received in the Kitchen', 'repeats fold into one counted row', JSON.stringify(r[0]));
  vm.runInContext(`_cinderLedgerAdd(-40, 'Spent in the City builder', 'spend'); _cinderLedgerAdd(-9, 'Fuel Command: operating costs', 'spend');`, c);
  const w = vm.runInContext('_cinderLedgerRecentWhy(3000)', c);
  ok(/Spent in the City builder/.test(w) && /Fuel Command: operating costs/.test(w), 'the tick can read the reasons since its last look', w);
  const c2 = sandbox('blackRiver');
  ok(vm.runInContext('_ledgerScreenLabel()', c2) === 'Black River', 'screen label table');
  const c3 = sandbox('someNewScreen');
  ok(vm.runInContext('_ledgerScreenLabel()', c3) === 'some new screen', 'unknown screen is humanised');
}

/* ── wiring in index.html ── */
ok(/try \{ _cinderLedgerOnSet\(old, nv\); \} catch \(e\) \{\}/.test(SRC), 'the gems setter calls the diary');
ok(/_ledgerQuiet\(\(\) => \{ Profile\.gems = \(Profile\.gems \|\| 0\) \+ amount; \}\);/.test(SRC) && /_ledgerQuiet\(\(\) => \{ Profile\.gems = \(Profile\.gems \|\| 0\) - amount; \}\);/.test(SRC), 'addGems / spendGems write quietly');
ok(/_ledgerQuiet\(\(\) => \{ try \{ _gemsTaxExempt\(\(\) => \{ Profile\.gems = local \+ take; \}\);/.test(SRC), 'the incoming watcher writes quietly');
ok(!/_cinderLedgerAdd\(-amt, 'Bank of Ethos deposit', 'bank'\)/.test(SRC) && (SRC.split("_ledgerWhy(dir === 'deposit' ? 'Bank of Ethos deposit' : 'Bank of Ethos withdrawal'").length - 1) === 2, 'bank transfers are booked by their write, once');
ok(/_mirrorLegacySpend\(taxable, _cinderLedgerRecentWhy\(3000\)\)/.test(SRC) && /p_reason: \(why && String\(why\)\.trim\(\)\) \|\| 'Cinder spending'/.test(SRC), 'the server mirror carries the reason');
ok(/_ledgerWhy\('Camp sacked by ' \+ rival\.name/.test(SRC) && /_ledgerWhy\('Camp overrun by ' \+ rival\.name/.test(SRC) && /_ledgerWhy\('Camp raided by ' \+ rival\.name/.test(SRC), 'the three camp raids name the rival');
ok(/_ledgerWhy\('Black River: refinery fire repairs'/.test(SRC) && /_ledgerWhy\('Black River: City Hall raid seized Cinder'/.test(SRC), 'Black River losses are named');
ok(/_ledgerWhy\('Fuel Command: register theft'/.test(SRC) && /_ledgerWhy\('Fuel Command: failed inspection fine'/.test(SRC) && /_ledgerWhy\('Fuel Command: operating costs'/.test(SRC), 'Fuel Command losses are named');
ok(/_ledgerWhy\('Storage warehouse: bay rent'/.test(SRC), 'warehouse rent is named');
ok(/spendCinders\(n, 'City builder'\)/.test(SRC) && /spendGems\(n, 'City builder'\)/.test(SRC) && /function spendCinders\(amount, why\)\{ return spendGems\(amount, why\); \}/.test(SRC), 'city builder spends say so');
ok(/return 'the City builder'; \} catch \(e\) \{\}/.test(SRC), 'the city iframe is detected for the screen label');
ok(/window\.MythicLedger = \{ why: _ledgerWhy, quiet: _ledgerQuiet/.test(SRC), 'seam on window');

/* ── global data ── */
ok(!/📍 LOCAL/.test(SRC) && !/🏠 LOCAL ONLY/.test(SRC), 'no LOCAL badge anywhere');
ok(/🌐 GLOBAL DATA\$\{srcGlobal \? '' : ' · syncing…'\}/.test(SRC), 'valuation pill reads GLOBAL, syncing while cold');
ok(/🌐 GLOBAL' \+ \(_usageSource === 'global' \? '' : ' · SYNCING'\)/.test(SRC), 'stock pill reads GLOBAL, syncing while cold');
const warm = fnText('_dvsWarmGlobal');
ok(/\['win', 'loss', 'trade', 'kill', 'card', 'hero', 'item'\]/.test(warm) && /dvsRecompute\(true\)/.test(warm) && /render\(\)/.test(warm), 'a cold cache fetches every aggregate, recomputes and repaints');
ok(/if \(DVS\.source !== 'global'\) \{ try \{ _dvsWarmGlobal\(\); \}/.test(SRC) && /if \(_usageSource !== 'global'\) \{ try \{ _dvsWarmGlobal\(\); \}/.test(SRC), 'both screens warm when not global');

/* ── camp return rule ── */
ok(/function _campBackTarget\(\) \{ try \{ return \(App\._campVia === 'ops'\) \? 'campOps' : 'camp'; \}/.test(SRC), '_campBackTarget: ops → Camp page, otherwise Bunker');
ok(/function renderCamp\(\) \{\n  try \{ App\._campVia = \(App\.screen === 'campOps'\) \? 'ops' : 'bunker'; \}/.test(SRC), 'renderCamp records which of the two the player is on');
ok(/if \(back\) back\.onclick = \(\) => \{ _campBack\(\); \};/.test(SRC) && /getElementById\('cr-back'\)\.onclick = \(\) => \{ _campBack\(\); \};/.test(SRC) && /if \(a === 'rest'\)      \{ _campBack\(\); return; \}/.test(SRC), 'research, crafting and the house hub return to where the player came from');
ok(/App\.screen = _campBackTarget\(\); render\(\); _runAfter\(\); return;/.test(SRC) && /App\._worldAfter = null; App\.screen = _campBackTarget\(\); render\(\); return;/.test(SRC), 'the black-market run and world battles return to where the player came from');
{
  const a = SRC.indexOf('function worldBattleAfter() {'); const b = SRC.indexOf('// 🛏 HERO BEDS', a);
  ok(a > 0 && b > a && SRC.slice(a, b).indexOf("App.screen = 'camp';") < 0, 'worldBattleAfter never names the Bunker directly');
}
ok(/App\.vaultReturnScreen = _campBackTarget\(\); App\.screen = 'baseVault'/.test(SRC), 'the vault returns to where the player came from');
ok(/if \(App\.screen === 'campOps'\) \{ App\._campReturnsToBunker = false; App\.screen = 'camp'; \}/.test(SRC) && /\$\{App\.screen === 'campOps' \? '← Bunker' : '← Back to Menu'\}/.test(SRC), "the Camp page's own back goes to the Bunker and says so");

/* ── phone ── */
ok(/let ledgerMode = 'server';/.test(HS), 'the phone Ledger opens on the account record');
ok(/data-lm="server"[^>]*>Account record<\/button><button type="button" data-lm="wallet"/.test(HS) && !/Server audit<\/button>/.test(HS), 'account record is the first tab');
ok(/if \(!r\.ok && r\.reason === 'missing'\) \{ paint\(rows, 'wallet'\)/.test(HS), 'falls back to the device diary when the audit RPC is absent');
ok(/\(e\.n > 1 \? ' <i class="mgp-n">×' \+ e\.n \+ '<\/i>' : ''\)/.test(HS), 'folded rows show their count');
ok(/window\.BUILD_VERSION = 'v121v(4[8-9]|[5-9]\d|\d{3,})'/.test(SRC), 'build v121v48 or later');

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
