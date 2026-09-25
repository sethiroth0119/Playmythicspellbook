/* 🧹 v121v100 — seven fixes from the 2026-09-10 late-morning tracker sweep.

   bug-mtvg7q4f  (critical) the mayor's own ledger, vault and needs list leaked
                 into a client city through three bridges cityGetRes had
                 already been fixed on.
   bug-mtvg7l39  the daily-limit toast covered the city builder's bottom bar.
   bug-mtvgyt59  a campaign run fought as the first hero whatever deck was
                 picked.
   bug-mtty05g7  a development-points purchase returned to the title, not the
                 city it was bought in.
   bug-mtvgfy5s  "Services falling short" printed 0% beside two standing
                 grocers without saying the shelves were empty.
   bug-mtrm50hn  redeeming a NEWER player's code was accepted and spent the
                 one redemption (sql/128).
   bug-mtqasoy6  members helping run a corp city read "no city founded".

   Run: node _sweep3_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const IDX = readFileSync('./public/src/demographics/index.js', 'utf8').replace(/\r\n/g, '\n');
const PIPE = readFileSync('./public/src/demographics/pipeline.js', 'utf8').replace(/\r\n/g, '\n');
const PROG = readFileSync('./public/src/progression/index.js', 'utf8').replace(/\r\n/g, '\n');
const JSX = readFileSync('./public/corp/screens.jsx', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/128_referral_referrer_older.sql', 'utf8').replace(/\r\n/g, '\n');
const SQL58 = readFileSync('./sql/058_referral_one_way_only.sql', 'utf8').replace(/\r\n/g, '\n');
const P = await import('./public/src/demographics/pipeline.js');
const fnBody = (name) => { const i = SRC.indexOf(name); return SRC.slice(i, SRC.indexOf('\n};', i) + 3); };

/* ── 1. bug-mtvg7q4f: the three bridges answer for the OWNER ── */
{
  const many = SRC.slice(SRC.indexOf('function cityGetResMany(ids) {'), SRC.indexOf('window.cityGetResMany = cityGetResMany;'));
  ok(/if \(_cityMgrStalled\(\)\) \{ \(Array\.isArray\(ids\) \? ids : \[\]\)\.forEach\(id => \{ out\[id\] = 0; \}\); return out; \}/.test(many), 'cityGetResMany: stalled ledger → zeros, never the mayor\'s numbers');
  ok(/const R = CityMgr\.active \? \(CityMgr\.salvage \|\| \{\}\) : _ensureResources\(\);/.test(many), 'cityGetResMany: managing → the owner\'s units (CityMgr.salvage)');
  ok(many.indexOf('_cityMgrStalled()') < many.indexOf('CityMgr.active ?'), '…stalled is answered before the ledger is chosen');
  const vs = fnBody('window.cityVaultState = function () {');
  ok(/if \(CityMgr\.active \|\| _cityMgrStalled\(\)\) return \{ ready: false, canBank: false, bank: \{\}, managed: true \};/.test(vs), 'cityVaultState: a managed city is told the vault is not its own');
  ok(vs.indexOf('managed: true') < vs.indexOf('ready: !!(BankEthos && BankEthos.ready)'), '…before the mayor\'s Bank of Ethos is read');
  const vm = fnBody('window.cityVaultMove = async function (id, qty, dir) {');
  ok(/if \(CityMgr\.active \|\| _cityMgrStalled\(\)\) return false;/.test(vm) && vm.indexOf('return false;') < vm.indexOf('boeWithdrawRes'), 'cityVaultMove: refuses before touching the mayor\'s bank');
  ok(/window\.cityResourceNeeds = \(\) => \{ try \{\n[^\n]*\n\s*try \{ if \(\(typeof CityMgr !== 'undefined' && CityMgr && CityMgr\.active\) \|\| \(typeof _cityMgrStalled === 'function' && _cityMgrStalled\(\)\)\) return \{\}; \} catch \(e\) \{\}/.test(SRC), 'cityResourceNeeds: a managed city gets no needs list (it is the mayor\'s Forge setting)');
  ok(/st\.managed \? 'this is a city you manage for its owner — the vault is theirs, and it stays in their own Bank of Ethos\.'/.test(NC), 'node-city\'s vault panel says whose vault it is');
  /* run the three bridges for real against a fake host */
  const mk = (active, stalled) => {
    const g = { CityMgr: { active, salvage: { ore: 7, wood: 3, cinder: 99 } }, _cityMgrStalled: () => stalled,
      _ensureResources: () => ({ ore: 500, wood: 400 }), BankEthos: { ready: true, _extCols: true, resources: { ore: 1 } },
      BOE_VAULT_CAP: 1, BOE_DEPOSIT_FEE: 0, _boeVaultUsed: () => 0, _boeVaultRoom: () => 1,
      boeWithdrawRes: async () => { g.touched = true; return true; }, boeDepositRes: async () => { g.touched = true; return true; }, window: {} };
    const code = many.replace('function cityGetResMany', 'g.cityGetResMany = function') + '\n' + vs.replace('window.cityVaultState', 'g.cityVaultState') + '\n' + vm.replace('window.cityVaultMove', 'g.cityVaultMove');
    new Function('g', 'with (g) { ' + code + ' }')(g);
    return g;
  };
  let g = mk(true, false);
  ok(JSON.stringify(g.cityGetResMany(['ore', 'wood', 'gold'])) === '{"ore":7,"wood":3,"gold":0}', 'managing: bulk read answers the owner\'s 7 ore / 3 wood, not the mayor\'s 500 / 400');
  ok(g.cityVaultState().managed === true && g.cityVaultState().canBank === false, 'managing: vault reads managed, cannot bank');
  g = mk(true, false);
  ok(await g.cityVaultMove('ore', 5, 'deposit') === false && !g.touched, 'managing: a vault move is refused and the mayor\'s bank is never called');
  g = mk(false, true);
  ok(JSON.stringify(g.cityGetResMany(['ore'])) === '{"ore":0}' && g.cityVaultState().managed === true, 'stalled: zeros and a managed vault');
  g = mk(false, false);
  ok(JSON.stringify(g.cityGetResMany(['ore', 'wood'])) === '{"ore":500,"wood":400}' && g.cityVaultState().ready === true && await g.cityVaultMove('ore', 1, 'deposit') === true, 'own camp: unchanged — own ledger, own vault');
}

/* ── 2. bug-mtvg7l39: the toast never blocks, floats at the top over the city, held line rate-limited ── */
ok(/\.toast \{[\s\S]*?pointer-events: none;\n  \}/.test(SRC), '.toast is pointer-events none (clicks pass through to the build bar)');
ok(/\.toast\.toast-top \{ bottom: auto; top: 14px; \}/.test(SRC), '…and .toast-top moves it off the bottom bar');
ok(/try \{ if \(document\.getElementById\('node-city-frame'\)\) el\.classList\.add\('toast-top'\); \} catch \(e\) \{\}/.test(SRC), 'showToast adds toast-top while the city builder is open');
ok(/_walletHoldsLastToast = 0;\nconst WALLET_HOLDS_TOAST_EVERY = 30 \* 60 \* 1000;/.test(SRC), 'the held-Cinder toast has a 30-minute clock');
ok(/if \(Date\.now\(\) - _walletHoldsLastToast > WALLET_HOLDS_TOAST_EVERY\) \{ _walletHoldsLastToast = Date\.now\(\); showToast\(line, 9000\); \}\n\s*\/\/ …and it stays in the bell/.test(SRC), '…and the bell still gets every change');
ok((SRC.match(/showToast\([^)]*<button/g) || []).length === 0, 'no toast carries a button, so pointer-events none loses nothing');

/* ── 3. bug-mtvgyt59: the chosen deck brings its hero ── */
ok(/run\.deck = _rlcDeckKeys\(b\.dataset\.rlcPickdeck\)\.slice\(0\);\n[\s\S]{0,400}?try \{ const _h = _rlcDeckHero\(b\.dataset\.rlcPickdeck\); if \(_h\) run\.heroId = _h; \} catch \(e\) \{\}/.test(SRC), 'the deck-pick handler sets run.heroId from the deck');
{
  const body = SRC.slice(SRC.indexOf('function _rlcDeckHero(deckId) {'), SRC.indexOf('function _rlcStartNodes(camp) {'));
  ok(/getAllStarterDecks/.test(body) && /getDeckById/.test(body) && /Profile\.decks\.find/.test(body) && /findHeroById\(hid\)/.test(body), '_rlcDeckHero looks at starter decks, player decks by id, and Profile.decks, and checks the hero exists');
  const g = { Profile: { decks: [{ id: 'pd1', heroId: 'lyra' }] }, getAllStarterDecks: () => [{ id: 'sd1', heroId: 'cedric' }], getDeckById: (id) => (id === 'pd2' ? { id: 'pd2', heroId: 'ghost' } : null), findHeroById: (h) => (h === 'ghost' ? null : { id: h }) };
  const fn = new Function('g', 'with (g) { ' + body + ' return _rlcDeckHero; }')(g);
  ok(fn('pd1') === 'lyra' && fn('sd1') === 'cedric', 'a player deck and a starter deck each name their hero');
  ok(fn('pd2') === null && fn('admin-deck') === null, 'a deck whose hero does not exist, or an admin deck with none, leaves the run\'s hero alone');
}

/* ── 4. bug-mtty05g7: the checkout return lands back in the city ── */
ok(/let city = null; try \{ if \(document\.getElementById\('node-city-frame'\) && App\._cityNodeId\) city = String\(App\._cityNodeId\); \} catch \(e\) \{\}\n\s*localStorage\.setItem\(PAY_RETURN_KEY, JSON\.stringify\(\{ screen: sc, hub: [^\n]*, city, at: Date\.now\(\) \}\)\);/.test(SRC), 'payReturnRemember records the open city');
ok(/if \(v\.city\) \{\n\s*try \{ window\.__ncBootOpen = 'progression'; \} catch \(e\) \{\}\n\s*setTimeout\(\(\) => \{ try \{ if \(typeof _openNodeCity === 'function'\) _openNodeCity\(String\(v\.city\)\); \} catch \(e\) \{\} \}, 700\);\n\s*\}\n\s*if \(String\(App\.screen \|\| ''\) === v\.screen\) return !!v\.city;/.test(SRC), 'payReturnRestore reopens that city and asks for the tree, even when the screen already matches');
ok(/if \(par && par\.__ncBootOpen === 'progression'\) \{ par\.__ncBootOpen = null; setTimeout\(\(\) => \{ try \{ gmod\.open\(\); \} catch \(e\) \{\} \}, 900\); \}/.test(NC), 'node-city clears the flag and opens the tree after the progression module mounts');
ok(/export function open\(\) \{ try \{ if \(panel && !panel\.isOpen\(\)\) panel\.open\(true\); return true; \} catch \(e\) \{ return false; \} \}/.test(PROG), 'the progression module exports open()');

/* ── 5. bug-mtvgfy5s: the services row says what stands and why it sells nothing ── */
ok(/let firms = \[\]; try \{ firms = \(typeof E\.firms === 'function' && E\.firms\(\)\) \|\| \[\]; \}/.test(IDX) && /let inv = \{\}; try \{ inv = \(typeof E\.inventory === 'function' && E\.inventory\(\)\) \|\| \{\}; \}/.test(IDX), 'servicesBreakdown reads the live firms and the city inventory');
ok(/let shops = 0; for \(const f of firms\) if \(f && b && f\.ind === b\.ind\) shops\+\+;/.test(IDX) && /let stock = 0; for \(const id of res\) stock \+= Math\.max\(0, Number\(inv\[id\]\) \|\| 0\);/.test(IDX) && /shops, stock, res, makers \}\);/.test(IDX), '…and counts the shops of that kind, the stock of what they sell, and the producers that make it');
{
  const dm = { ui: { servicesGood: 0.75 } };
  ok(P.servicesWhy({ shop: 'Grocery Store', shops: 0 }) === ' (no Grocery Store here — found one)', 'no shop → says so');
  ok(P.servicesWhy({ shop: 'Grocery Store', shops: 2, stock: 0, res: ['bread', 'packagedFood', 'vegetables', 'meat'], makers: ['Bakery', 'Food Plant'] }) === ' (2 Grocery Stores standing with nothing to sell: nothing here makes bread, packaged food, vegetables — found a Bakery or Food Plant)', 'two grocers with empty shelves → the shops are named as standing, the missing goods and their makers are named');
  ok(P.servicesWhy({ shop: 'Pharmacy', shops: 1, stock: 40, res: ['medicine'], makers: [] }) === ' (1 Pharmacy stocked; residents could not pay — see wages)', 'stocked and still short → the residents could not pay');
  ok(P.servicesWhy({ shop: 'Pharmacy' }) === ' (Pharmacy)', 'a row without counts keeps the plain form');
  const t = P.servicesShortText([{ key: 'food', name: 'Food', ico: '🍞', sat: 0, want: 300, shop: 'Grocery Store', shops: 2, stock: 0, res: ['bread'], makers: ['Bakery'] }], dm);
  ok(/Short: 🍞 Food 0% \(2 Grocery Stores standing with nothing to sell: nothing here makes bread — found a Bakery\)\. A shop only serves what the city makes or imports/.test(t), 'the cause line, whole', t);
}

/* ── 6. bug-mtrm50hn: sql/128 ── */
ok(/create or replace function public\.referral_redeem\(p_code text\)/.test(SQL) && /end \$function\$;/.test(SQL), 'sql/128 re-issues referral_redeem');
ok(/if v_ref = v_uid then return jsonb_build_object\('ok', false, 'error', 'self_referral'\); end if;\n\n\s*\/\* bug-mtrm50hn[\s\S]*?if \(select u\.created_at from auth\.users u where u\.id = v_ref\) > \(select u\.created_at from auth\.users u where u\.id = v_uid\) then\n\s*return jsonb_build_object\('ok', false, 'error', 'referrer_newer'\);\n\s*end if;/.test(SQL), 'the referrer must be the older account, checked right after self-referral');
{
  /* everything else is verbatim 058 */
  const a = SQL58.indexOf('create or replace function public.referral_redeem(p_code text)');
  const orig = SQL58.slice(a, SQL58.indexOf('end $function$;', a) + 'end $function$;'.length);
  const mine = SQL.slice(SQL.indexOf('create or replace function public.referral_redeem(p_code text)'), SQL.indexOf('end $function$;') + 'end $function$;'.length);
  const stripped = mine.replace(/\n\n\s*\/\* bug-mtrm50hn[\s\S]*?end if;\n/, '\n');
  ok(stripped === orig, 'with the new block removed, the function is byte-for-byte sql/058', stripped.length + ' vs ' + orig.length);
  ok(SQL.indexOf('referrer_newer') < SQL.indexOf("if exists (select 1 from referral_redemptions where redeemer_id = v_uid)"), '…and it runs before the already-redeemed check, so nothing is consumed');
}
ok(/res\.error === 'referrer_newer' \? '⚠ That code belongs to a player who joined AFTER you/.test(SRC), 'the client explains the refusal and says nothing was used up');

/* ── 7. bug-mtqasoy6: shared corp cities ── */
ok(/const nodeOwner = Object\.create\(null\);\n\s*const shared = \{\};\n\s*const nameOf = Object\.create\(null\);/.test(SRC), 'the loader keeps node → owner and a shared list');
ok(/if \(owned && !owned\[String\(c\.owner_id\) \+ '\|' \+ nid\]\) \{[\s\S]*?const ownerId = nodeOwner\[nid\];\n\s*if \(ownerId && ownerId !== String\(c\.owner_id\) && nameOf\[ownerId\]\) \{/.test(SRC), 'a row on a node owned by ANOTHER roster member becomes a shared row, named with the owner');
ok(/cities: by\[uid\] \|\| \[\], shared: sh \};/.test(SRC), 'each member row carries shared');
ok(/\{shared\.length \? 'no city of their own' : 'no city founded'\}/.test(JSX) && /works in \{shared\.slice\(0, 3\)\.map\(\(s\) => \(s\.name \|\| 'unnamed city'\) \+ ' \(' \+ s\.ownerName \+ '\)'\)\.join\(', '\)\}/.test(JSX), 'the panel says "no city of their own · works in <city> (<owner>)"');

/* the six knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 100, 'BUILD_VERSION is v121v100 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
