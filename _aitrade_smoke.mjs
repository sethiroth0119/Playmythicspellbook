/* 🤝 THE AI-TRADE DAILY ALLOWANCE HOLDS (bug-mu1i6hd6, bug-mu7azbpf, bug-mu8vi4pp).

   Reported: the "daily trades remaining" counter on an AI corp does not count
   down (and goes UP); deliveries can be repeated by flipping tabs; and the
   excess-Cinder fix can be dodged by alternating SPOT TRADE and ENTER BUSINESS.

   Root cause in this tree: the only limit anywhere was the spot trade's own
   once-a-day flag. A contract could be signed, delivered three times back to
   back and signed again, forever, each delivery minting Cinder. The fix is
   ONE per-corp per-day allowance, _aiTradesLeft(), that every paying entry
   point spends and every entry point checks, and that the panel prints.
   Also pinned: the allowance survives a reload, and an older cloud copy
   cannot hand spent trades back (_aiTradeMerge).

   Drives the REAL engine headless. Run: node _aitrade_smoke.mjs */
import { loadEngine, EXPORTS } from './tools/gamedev/headless.mjs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
EXPORTS.push('loadForge', 'saveProfile', '_aiTradeState', '_aiSpotTrade', '_aiEnterBusiness', '_aiDeliver',
  '_aiSpotOffer', '_aiContractTerms', '_aiTradesLeft', '_aiTradeMerge', 'AI_TRADE_DAILY', 'AI_CORP_BY_ID');
const e = loadEngine();
const P = e.Profile;
if (typeof e._aiTradesLeft !== 'function') { console.log('  FAIL _aiTradesLeft does not exist — no daily allowance at all'); process.exit(1); }
const CAP = e.AI_TRADE_DAILY;
const corp = Object.keys(e.AI_CORP_BY_ID)[0];
const stock = () => {
  const o = e._aiSpotOffer(corp), t = e._aiContractTerms(corp);
  e.addRes(o.res, 500); if (t.res !== o.res) e.addRes(t.res, 500);
};
stock();
const cinder = () => P.gems | 0;

console.log('— every entry point spends and checks the one allowance (' + corp + ', cap ' + CAP + ')');
ok(e._aiTradesLeft(corp) === CAP, 'a fresh day starts at the cap', e._aiTradesLeft(corp));
let g = cinder();
e._aiSpotTrade(corp);
ok(cinder() > g, 'spot trade pays');
ok(e._aiTradesLeft(corp) === CAP - 1, 'spot trade counts DOWN', e._aiTradesLeft(corp));
e._aiEnterBusiness(corp);
ok(!!e._aiTradeState().deal[corp], 'contract signs while a trade is left');
ok(e._aiTradesLeft(corp) === CAP - 1, 'signing pays nothing and spends nothing');
let paid = 0;
for (let i = 0; i < 6; i++) { g = cinder(); e._aiDeliver(corp); if (cinder() > g) paid++; }
ok(paid === CAP - 1, 'deliveries stop when the allowance is spent', paid + ' paid of 6 tries');
ok(e._aiTradesLeft(corp) === 0, 'counter reads 0', e._aiTradesLeft(corp));

console.log('— the alternating loop (bug-mu8vi4pp) and re-sign loop are closed');
g = cinder();
for (let i = 0; i < 5; i++) {
  e._aiSpotTrade(corp); e._aiEnterBusiness(corp); e._aiDeliver(corp);
  delete e._aiTradeState().deal[corp];         // even with the contract gone
  e._aiEnterBusiness(corp); e._aiDeliver(corp);
}
ok(cinder() === g, 'no Cinder once the day is spent, whatever the order', cinder() - g);
ok(e._aiTradesLeft(corp) === 0, 'counter never goes back up', e._aiTradesLeft(corp));

console.log('— the allowance survives a reload and a stale cloud copy');
e.saveProfile();
const before = JSON.parse(JSON.stringify(P.aiTrade));
P.aiTrade = null;
e.loadForge();
ok(e._aiTradesLeft(corp) === 0, 'reload keeps today spent', e._aiTradesLeft(corp));
const staleCloud = JSON.parse(JSON.stringify(before)); staleCloud.used = {}; staleCloud.spot = {};
P.aiTrade = e._aiTradeMerge(P.aiTrade, staleCloud);
ok(e._aiTradesLeft(corp) === 0, 'an older cloud copy cannot re-open today', e._aiTradesLeft(corp));
ok(P.aiTrade.spot[corp] === before.spot[corp], 'spot flag kept through the merge');
const yesterday = JSON.parse(JSON.stringify(before));
yesterday.used[corp] = { d: before.used[corp].d - 1, n: 0 };
ok(e._aiTradeMerge(before, yesterday).used[corp].d === before.used[corp].d, 'the later day wins the merge');
const moreHist = JSON.parse(JSON.stringify(before));
moreHist.done[corp] = (before.done[corp] | 0) + 3; moreHist.deal = {};
const mh = e._aiTradeMerge(before, moreHist);
ok(mh.done[corp] === moreHist.done[corp] && !mh.deal[corp], 'the copy with more history owns the contract and rep');

console.log('— a new day restores the allowance');
const t = e._aiTradeState();
t.used[corp] = { d: t.used[corp].d - 1, n: CAP };
ok(e._aiTradesLeft(corp) === CAP, 'yesterday\'s spend does not carry over', e._aiTradesLeft(corp));

console.log(fails ? `\n${fails} FAIL, ${passes} pass` : `\nall ${passes} pass`);
process.exit(fails ? 1 : 0);
