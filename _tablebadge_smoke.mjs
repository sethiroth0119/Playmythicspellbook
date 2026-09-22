/* 🪵 THE TABLE BADGE COUNTS DOWN (bug-mucgw4pi).

   Reported: "the number on the Table button (e.g. 6) does not decrease as I
   give gifts — it stays static even when no more actions are available."

   Two causes, both pinned here:
     1. The badge was computed once, when renderCamp() built the command bar,
        and the Table overlay deliberately never calls render(). Now the Table
        calls MythicRanchBridge.tableChanged after every paint and on close,
        which rewrites the button from _campTableBtnInner().
     2. A unit that "asked for X" counted in the badge, but the Table could not
        fill a request — handing X over as a gift ate it at the ordinary rate
        and left the request open. The Table now fills it through
        _lqFulfilRequest, the same function the arrival dialog uses.

   Run: node _tablebadge_smoke.mjs */
import { loadEngine } from './tools/gamedev/headless.mjs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

/* ── index.html half, on the real engine ── */
const e = loadEngine();
const S = e.sandbox, W = e.window;
const RB = W.MythicRanchBridge;
ok(RB && typeof RB.fillRequest === 'function' && typeof RB.tableChanged === 'function', 'MythicRanchBridge exposes fillRequest + tableChanged');
const P = RB.Profile;
P.itemInventory = { powerBand: 2 };
const prof = RB.unitProf('u1');
prof.request = { item: 'powerBand', visits: 0, tier: 0 };
const bond0 = prof.bond | 0;
ok(RB.fillRequest('u1') === true, 'the Table can fill an open request');
ok(!prof.request, 'the request is closed');
ok((P.itemInventory.powerBand | 0) === 1, 'exactly one item was taken', P.itemInventory.powerBand);
ok((prof.bond | 0) > bond0, 'loyalty was paid at the request rate', prof.bond);
ok(RB.fillRequest('u1') === false, 'no open request -> nothing happens');

let roster = [{ id: 'a', giftReady: true }, { id: 'b', hasRequested: true }, { id: 'c' }];
W.MythicRanch = { open() {}, stewardRoster: () => roster, hasBanter: (id) => id === 'c' };
ok(/>3</.test(S._campTableBtnInner()), 'badge counts gift-ready, request and banter', S._campTableBtnInner());
roster = [{ id: 'a' }, { id: 'b', hasRequested: true }, { id: 'c' }];
ok(/>2</.test(S._campTableBtnInner()), 'recounts after a gift', S._campTableBtnInner());
roster = [{ id: 'a' }, { id: 'b' }];
W.MythicRanch.hasBanter = () => false;
ok(S._campTableBtnInner() === '🪵 Table', 'no badge when nothing is waiting', S._campTableBtnInner());
let threw = false; try { RB.tableChanged(); } catch (err) { threw = true; }
ok(!threw, 'tableChanged is safe with no button on screen');

/* ── the module half: gift of the requested item fills it; paint/close notify ── */
let fills = 0, changed = 0, taken = 0;
const mprof = { bond: 0, request: { item: 'ring' } };
globalThis.window = {
  MythicRanchBridge: {
    unitProf: () => mprof, card: () => ({ id: 'u', name: 'U' }), giftPool: () => [], bondTierIndex: () => 0,
    ownCount: () => 1, battleCount: () => 0, takeItem: () => { taken++; return true; },
    adjustBond: (p, d) => { p.bond += d; }, saveProfile() {}, showToast() {}, itemName: (i) => i,
    fillRequest: () => { fills++; mprof.request = null; return true; },
    tableChanged: () => { changed++; },
  },
};
const removed = { n: 0 };
globalThis.document = { getElementById: (id) => (id === 'rt-ov' ? { remove() { removed.n++; } } : null), removeEventListener() {} };
const T = await import('./public/src/ranch/table.js');
const r = T.gift('u', 'ring');
ok(r && r.request === true && fills === 1 && taken === 0, 'gifting the requested item fills the request instead of an ordinary gift');
T.close();
ok(removed.n === 1 && changed === 1, 'closing the Table repaints the badge');

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
