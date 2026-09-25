/* EXECUTION harness for the guild-trade escrow helpers in public/index.html.
   The four repo gates only PARSE. Conservation is the whole claim this feature
   makes on screen ("the total of every asset across the two accounts is the
   same before and after"), so it is RUN here, not read. */
import { readFileSync } from 'fs';

const HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const lines = HTML.split(/\r?\n/);

// Lift the helper block verbatim: _jbTradeMeta .. _jbTradeSqlMissing.
const a = lines.findIndex(l => l.startsWith('function _jbTradeMeta('));
const b = lines.findIndex(l => l.startsWith('async function _jbTradeFetch('));
if (a < 0 || b < 0 || b <= a) { console.error('SCRAPE FAILED — helper block not found'); process.exit(1); }
const SRC = lines.slice(a, b).join('\n');
for (const need of ['_jbTradeClean', '_jbTradeTake', '_jbTradeGive', '_jbTradeAdopt', '_jbTradeHave', '_jbTradeMove']) {
  if (!SRC.includes('function ' + need + '(')) { console.error('SCRAPE FAILED — missing ' + need); process.exit(1); }
}
console.log('scraped index.html:' + (a + 1) + '-' + b + '  (' + SRC.length + ' chars)');

let fails = 0, passes = 0;
const chk = (name, ok, extra) => {
  if (ok) { passes++; console.log('  PASS  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   ' + extra : '')); }
};

// ── Stubs. The real Profile shape, nothing more. ──────────────────────────
const Profile = { cardCollection: {}, itemInventory: {}, salvage: {}, gems: 0, walletSeqProgress: 0 };
let saves = 0;
const env = {
  Profile,
  saveProfile: () => { saves++; },
  _ensureResources: () => (Profile.salvage || (Profile.salvage = {})),
  _jbDeckNeed: () => DECK_NEED,
  _jbItemMeta: (id) => ({ name: 'Item ' + id, icon: '🔧' }),
  _meta: (id) => ({ name: 'Res ' + id, icon: '🪨' }),
  _resolveAnyCardById: (id) => ({ name: 'Card ' + id, icon: '🃏' }),
  _gemsTaxExempt: (fn) => fn(),
};
let DECK_NEED = {};

const api = new Function(...Object.keys(env),
  SRC + '\nreturn { _jbTradeClean, _jbTradeTake, _jbTradeGive, _jbTradeAdopt, _jbTradeHave, _jbTradeMove };'
)(...Object.values(env));

const snapshot = () => JSON.parse(JSON.stringify({
  cards: Profile.cardCollection, items: Profile.itemInventory, res: Profile.salvage, gems: Profile.gems,
}));
const reset = () => {
  Profile.cardCollection = { CARD_A: 5, CARD_B: 2 };
  Profile.itemInventory  = { ITEM_A: 3 };
  Profile.salvage        = { iron: 100, wire: 7 };
  Profile.gems = 1000; Profile.walletSeqProgress = 4;
  DECK_NEED = { CARD_A: 3 };   // 3 of the 5 CARD_A are locked into a deck
};

console.log('\n── 1. heldOf / _jbTradeHave: deck-locked copies are NOT tradeable');
reset();
chk('CARD_A: 5 held − 3 in deck = 2 free', api._jbTradeHave('card', 'CARD_A') === 2, 'got ' + api._jbTradeHave('card', 'CARD_A'));
chk('CARD_B: 2 held − 0 in deck = 2 free', api._jbTradeHave('card', 'CARD_B') === 2);
chk('unknown id reads 0, never NaN/undefined', api._jbTradeHave('resource', 'nope') === 0);
chk('unknown kind reads 0', api._jbTradeHave('resource', '') === 0);

console.log('\n── 2. _jbTradeClean: normalisation the server also enforces');
reset();
const cleaned = api._jbTradeClean([
  { kind: 'resource', id: 'iron', qty: 5 },
  { kind: 'resource', id: 'iron', qty: 9 },     // duplicate — must collapse to the FIRST
  { kind: 'resource', id: 'iron', qty: '3' },   // duplicate again
  { kind: 'bogus',    id: 'x',    qty: 1 },     // unknown kind — dropped
  { kind: 'card',     id: 'CARD_A', qty: 0 },   // zero — dropped
  { kind: 'card',     id: 'CARD_B', qty: -4 },  // negative — dropped
  { kind: 'item',     id: 'ITEM_A', qty: 2.7 }, // floored
  null,
]);
chk('duplicate lines collapse to one', cleaned.filter(x => x.id === 'iron').length === 1);
chk('the surviving iron line keeps qty 5', (cleaned.find(x => x.id === 'iron') || {}).qty === 5);
chk('unknown kind dropped', !cleaned.some(x => x.kind === 'bogus'));
chk('qty 0 and qty -4 dropped', !cleaned.some(x => (x.qty | 0) <= 0));
chk('2.7 floors to 2', (cleaned.find(x => x.id === 'ITEM_A') || {}).qty === 2);
chk('every line carries a name and an icon (no undefined on screen)',
  cleaned.every(x => typeof x.name === 'string' && x.name && typeof x.icon === 'string'));
const cap = api._jbTradeClean(Array.from({ length: 40 }, (_, i) => ({ kind: 'resource', id: 'r' + i, qty: 1 })));
chk('at most 20 lines (matches _ct_norm\'s server cap)', cap.length === 20, 'got ' + cap.length);
chk('null / non-array input returns []', api._jbTradeClean(null).length === 0 && api._jbTradeClean('x').length === 0);

console.log('\n── 3. CONSERVATION: take → give restores the inventory EXACTLY');
reset();
const before = snapshot();
const side = api._jbTradeClean([
  { kind: 'card', id: 'CARD_A', qty: 2 },
  { kind: 'item', id: 'ITEM_A', qty: 3 },
  { kind: 'resource', id: 'iron', qty: 60 },
]);
chk('take succeeds when everything is held', api._jbTradeTake(side) === true);
const mid = snapshot();
chk('CARD_A debited 5→3', mid.cards.CARD_A === 3, JSON.stringify(mid.cards));
chk('ITEM_A debited to 0 and the key is REMOVED (no 0-qty ghost row)', mid.items.ITEM_A === undefined, JSON.stringify(mid.items));
chk('iron debited 100→40', mid.res.iron === 40);
api._jbTradeGive(side);
chk('refund restores the inventory byte-for-byte', JSON.stringify(snapshot()) === JSON.stringify(before),
  '\n     before ' + JSON.stringify(before) + '\n     after  ' + JSON.stringify(snapshot()));

console.log('\n── 4. ALL-OR-NOTHING: a short line takes NOTHING');
reset();
const before2 = snapshot();
const tooMuch = api._jbTradeClean([
  { kind: 'resource', id: 'iron', qty: 10 },
  { kind: 'card', id: 'CARD_A', qty: 3 },   // only 2 are free of the deck
]);
chk('take refuses', api._jbTradeTake(tooMuch) === false);
chk('and the iron listed BEFORE the short line was not debited',
  JSON.stringify(snapshot()) === JSON.stringify(before2), JSON.stringify(snapshot()));

console.log('\n── 5. Deck-locked cards cannot be traded away');
reset();
chk('offering 3 CARD_A (5 held, 3 in a deck) is refused',
  api._jbTradeTake(api._jbTradeClean([{ kind: 'card', id: 'CARD_A', qty: 3 }])) === false);
chk('offering 2 is allowed', api._jbTradeTake(api._jbTradeClean([{ kind: 'card', id: 'CARD_A', qty: 2 }])) === true);
chk('…and the 3 deck copies survive', Profile.cardCollection.CARD_A === 3);

console.log('\n── 6. _jbTradeAdopt: the wallet answer, and the debit/credit split');
reset();
api._jbTradeAdopt({ id: 'x', cinder: 640, wallet_seq: 9 });     // propose: pure debit
chk('a debit answer is adopted verbatim (1000 → 640)', Profile.gems === 640, 'got ' + Profile.gems);
chk('wallet_seq adopted — an unadopted debit seq is refunded at next sign-in', Profile.walletSeqProgress === 9);
api._jbTradeAdopt({ ok: true, credit_cinder: 250 });            // cancel: pure credit
chk('a pure credit is ADDED, not adopted (640 + 250)', Profile.gems === 890, 'got ' + Profile.gems);
reset();
api._jbTradeAdopt({ ok: true, cinder: null, wallet_seq: null, credit_cinder: 0 });
chk('a goods-only trade (null cinder) leaves the balance alone', Profile.gems === 1000);
chk('…and does not rewind wallet_seq', Profile.walletSeqProgress === 4);
reset();
api._jbTradeAdopt(null); api._jbTradeAdopt(undefined); api._jbTradeAdopt('nope');
chk('garbage in leaves the balance untouched and finite',
  Profile.gems === 1000 && Number.isFinite(Profile.gems));
reset();
api._jbTradeAdopt({ cinder: 300, wallet_seq: 11, credit_cinder: 120 });  // accept: debit THEN credit
chk('accept = adopt the post-debit balance, then add the credit (300 + 120)', Profile.gems === 420, 'got ' + Profile.gems);

console.log('\n── 7. Nothing here can mint. Sum across both sides is invariant.');
reset();
const A = { cards: {}, items: {}, res: {} };
// Simulate the full escrow round trip across two players' local saves.
const total = () => (Profile.salvage.iron | 0) + (A.res.iron | 0);
const t0 = total();
const leg = api._jbTradeClean([{ kind: 'resource', id: 'iron', qty: 30 }]);
api._jbTradeTake(leg);                        // proposer -> escrow
chk('mid-flight the units are OUT of the proposer and not yet anywhere', total() === t0 - 30);
A.res.iron = (A.res.iron | 0) + 30;           // escrow -> accepter (corp_trade_claim)
chk('after delivery the two-account total is identical to before', total() === t0, 'was ' + t0 + ' now ' + total());

console.log('\n' + (fails === 0 ? 'ALL ' + passes + ' EXECUTED CHECKS PASS' : fails + ' FAILED of ' + (passes + fails)));
process.exit(fails ? 1 : 0);
