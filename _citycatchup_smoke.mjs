/* ⏳ A BIG CITY'S LOAD MUST NOT FREEZE THE PAGE (bug-mtr5xz8t, round 3).

   "The game crashes a lot when loading the cities … exit after a minute or
   two and go back in, and it loads with the previous data plus the additional
   data." Measured in Chromium on a full 24×24 grid with a 3 h absence:
   boot took 65 s, 49 s of it the offline catch-up, with the main thread
   blocked for up to 38 s at a time behind a loading screen the 9 s failsafe
   had already hidden. Exit-and-re-enter "worked" because pagehide saved
   mid-catch-up, stamping savedAt to now, so the second open had no absence.

   Cause: tileMult() asks kalonCityBoost() and finBoost()→finCount() once PER
   TILE, and each walks every tile (O(tiles²) a tick; kalonCityBoost alone was
   25% of CPU); stockCap() the same per refining tile; and the catch-up yielded
   every 400 slices, sized for a ~0.4 ms slice when a full grid costs 20–50 ms.
   After: 35 s, longest block ~7 s, and a 1 h catch-up on a seeded RNG pays
   byte-identical Cinder and resources (658 🔥, same gained map).

   This suite lifts the three functions and pins the memo's contract, and pins
   the time-bounded yield and the progress overlay in offlineCatchUp.

   Run: node _citycatchup_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
function fnText(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('cannot find ' + head);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
  throw new Error('unbalanced ' + head);
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ── 1. the three city-wide scans are asked once per synchronous pass ───── */
{
  const decl = NC.match(/var _kalonMemoOn = [\s\S]*?;\n/);
  ok(!!decl, 'the memo state is declared with var (safe to read before its line runs)');
  let walks = 0;
  const tiles = {};
  for (let i = 0; i < 400; i++) tiles['t' + i] = { type: i % 50 === 0 ? 'kalonstable' : i % 40 === 0 ? 'bank' : i % 30 === 0 ? 'silo' : 'house', lvl: 1, cards: i % 50 === 0 ? ['k1'] : [] };
  const ctx = {
    queueMicrotask, Promise,
    game: { tiles },
    BUILDINGS: { kalonstable: {}, bank: { fin: true }, silo: { stockCap: 10 }, house: {} },
    STOCK_CAP_BASE: 100, KALON_CITY_CAP: 1, KALON_CITY_BOOST: 0.05,
    bldSite: () => false,
    cardById: (id) => (id === 'k1' ? { type: 'Kalon' } : null),
  };
  ctx.Object = { values: (o) => { if (o === tiles) walks++; return Object.values(o); } };
  vm.createContext(ctx);
  vm.runInContext(decl[0] + fnText(NC, 'function _syncMemoExpire(clear)') + fnText(NC, 'function kalonCityBoost()') + fnText(NC, 'function finCount()') + fnText(NC, 'function stockCap()') +
    '\nthis.k = kalonCityBoost; this.f = finCount; this.s = stockCap;', ctx);
  const k1 = ctx.k(), f1 = ctx.f(), s1 = ctx.s();
  ok(Math.abs(k1 - 1.4) < 1e-9 && f1 === 8 && s1 === 100 + 8 * 10, 'the answers are the same numbers the scans give', [k1, f1, s1].join(','));
  const w1 = walks;
  for (let i = 0; i < 400; i++) { ctx.k(); ctx.f(); ctx.s(); }
  ok(walks === w1 && w1 === 3, '400 per-tile asks in one pass cost one walk each (was 1,200 walks)', walks);
  await tick();
  tiles.t1 = { type: 'bank', lvl: 1 };
  ok(ctx.f() === 9 && walks === 4, 'after the pass (a microtask later) the next ask walks again and sees the change');
  delete tiles.t1; await tick();
}

/* ── 2. the catch-up yields on time, not only on a slice count ─────────── */
{
  const C = fnText(NC, 'async function offlineCatchUp(awayMsOverride)');
  ok(/const OFFLINE_YIELD_MS = \d+;/.test(NC), 'a time bound between yields exists');
  ok(/if \(\(slices % OFFLINE_YIELD_EVERY\) === 0 \|\| performance\.now\(\) - _lastYield > OFFLINE_YIELD_MS\) \{/.test(C), 'the slice loop yields on the slice count OR the time bound');
  ok(/await offlineYield\(\);\s*_lastYield = performance\.now\(\);/.test(C), '…and restarts the clock after each yield');
  ok(/if \(!MythicCityBridge\.ready\) \{[\s\S]{0,200}_bootEl\.classList\.remove\('done'\)/.test(C), 'during BOOT the loading overlay (with its % line) is shown while catching up');
  ok(/finally \{[\s\S]{0,200}if \(_bootWasDone && _bootEl\) _bootEl\.classList\.add\('done'\)/.test(C), '…and put back as it was when the loop ends, however it ends');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
