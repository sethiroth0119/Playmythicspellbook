/* 🏟 THE STADIUM CAN REACH THE RATIONS IN YOUR STASH (bug-mucr6azr).

   Reported: "Plan an event says I only have 2 rations — I have several hundred
   in my wallet." Both were true. Since v121v105 rations and remedies are game
   resources in the stash AND city stock in Node City; the stadium (like every
   city consumer) reads city stock, and the only mover ran city → stash. The
   stadium's own fix line said "Buy N on the Exchange", which lands them in the
   stash, where no stadium can see them.

   Pins: node-city's stockPullFromStash (lifted verbatim) spends BEFORE it
   stocks, clamps to the shelf and to what was asked, and moves nothing on a
   refused spend; the stadium row offers the pull and the click moves goods
   into city stock so the readiness row goes green.

   Run: node _stadiumstash_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

/* ── 1. node-city's mover, lifted verbatim ── */
const NC = readFileSync('./public/node-city/index.html', 'utf8');
function fnText(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
}
const PULL = fnText(NC, 'stockPullFromStash');
function world({ stash = 300, stock = 2, cap = 120, spendOk = true } = {}) {
  const log = [];
  const ctx = {
    CITY_STOCK: { rations: {}, remedies: {}, planks: {}, goods: {} },
    STOCK_STASHABLE: ['rations', 'planks', 'remedies'],
    game: { stock: { rations: stock } },
    stockCap: () => cap, saveSoon: () => log.push('save'), updateHUD: () => {},
    MythicCityBridge: {
      getRes: async () => stash,
      spendRes: async (c) => { log.push('spend ' + JSON.stringify(c)); if (spendOk) { stash -= Object.values(c)[0]; } return spendOk; },
    },
    Math, Number, Infinity,
  };
  ctx.stockOf = (r) => ctx.game.stock[r] || 0;
  vm.runInNewContext(PULL + '\nthis.pull = stockPullFromStash;', ctx);
  return { ctx, log, stash: () => stash };
}
let w = world();
let n = await w.ctx.pull('rations', 50);
ok(n === 50 && w.ctx.game.stock.rations === 52, 'pulls exactly what was asked', n + ' / stock ' + w.ctx.game.stock.rations);
ok(w.stash() === 250 && w.log[0] === 'spend {"rations":50}', 'the stash is debited first, through the bridge', w.log.join(','));
w = world({ stash: 300, stock: 2, cap: 120 });
n = await w.ctx.pull('rations');
ok(n === 118 && w.ctx.game.stock.rations === 120, 'no amount -> fills the shelf and no further', n);
ok(w.stash() === 182, 'the rest stays in the stash', w.stash());
w = world({ spendOk: false });
n = await w.ctx.pull('rations', 50);
ok(n === 0 && w.ctx.game.stock.rations === 2, 'a refused spend moves nothing (never minted)');
w = world({ stash: 0 });
ok((await w.ctx.pull('rations', 50)) === 0, 'empty stash -> nothing');
w = world();
ok((await w.ctx.pull('goods', 50)) === 0 && w.log.length === 0, 'a city-only good is never pulled');

/* ── 2. the stadium dialog ── */
const els = {};
function el(id) {
  const o = { id, innerHTML: '', handlers: {}, addEventListener(t, f) { this.handlers[t] = f; }, remove() { delete els[id]; } };
  return o;
}
globalThis.document = {
  getElementById: (id) => els[id] || null,
  createElement: () => el(''),
  head: { appendChild() {} },
  body: { appendChild(o) { if (o.id) els[o.id] = o; } },
};
globalThis.window = {};
const S = await import('./public/src/city/stadium.city.js');
let stash = 400, toasts = [];
const game = {
  tiles: { '0,0': { type: 'stadium', lvl: 1 } }, stock: { rations: 2, water: 0, goods: 500, remedies: 500 },
  res: { water: 500 }, power: { gen: 99, demand: 0, ratio: 1 }, cov: { pct: {} }, anchors: [{ node: { recon: { population: 200000 } } }],
};
S.mount({
  game, vitals: {}, wellbeing: {}, BUILDINGS: {}, pop: () => 50, popCap: () => 100,
  toast: (m) => toasts.push(m), saveSoon() {}, updateHUD() {}, logEvent() {}, identity: () => ({ userId: 'me', name: 'Me' }),
  neighbours: () => [], cloud: () => null,
  stashCount: async () => stash,
  pullFromStash: async (r, want) => { const k = Math.min(stash, want); stash -= k; game.stock[r] += k; return k; },
});
const API = window.MythicStadium;
const before = API.readinessNow('0,0').checks.find((c) => c.id === 'conc_rations');
ok(before && before.status !== 'ok' && before.short > 0, 'readiness: rations short with city stock 2', before && (before.status + ' short ' + before.short));
ok(/stash/.test(before.fix || ''), 'the fix line points at the stash, not only the Exchange', before && before.fix);
API.open('0,0');
await new Promise((r) => setTimeout(r, 0));
const box = els.stadmod;
ok(box && /data-pull="rations"/.test(box.innerHTML), 'the rations row offers "Bring N in from your stash"');
const want = before.short;
await box.handlers.click({ target: { id: '', closest: (s) => (s === '[data-pull]' ? { dataset: { pull: 'rations', want: String(want) }, disabled: false } : null) } });
ok(game.stock.rations === 2 + want && stash === 400 - want, 'the click moved exactly the shortfall', game.stock.rations);
const after = API.readinessNow('0,0').checks.find((c) => c.id === 'conc_rations');
ok(after.status === 'ok', 'and the rations row is satisfied', after.status + ' ' + after.detail);
ok(toasts.some((t) => /brought in from your stash/.test(t)), 'the player is told what moved');

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
