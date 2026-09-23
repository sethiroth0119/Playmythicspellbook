/* 🏙 THE CITY BOOT MUST REACH ITS RENDER LOOP (bug-mtr5xz8t, round 2).

   "The load stalls, then leave and come back and it loads … the game crashes a
   lot when loading the cities." 4f769e51 bounded the anchor ring and the city
   read. boot() then AWAITS MythicCityBridge.fetchCards() and
   fetchNeighborCities(), and in parent mode both are network reads
   (cityNeighbors always; cityCardCollection for a managed city). Every line
   after them — the economy, the offline catch-up, and setAnimationLoop at the
   very end — waited on a read that might never answer, so the canvas never
   drew and the 9 s failsafe lifted the spinner over a frozen city.

   Reproduced in Chromium (node-city in a same-origin iframe under a stub host
   whose cityNeighbors / cityCardCollection never resolve): MythicCityBridge
   .ready stayed false and __nc was never assembled; with the bounds it boots.
   This suite drives the SHIPPED bridge against the same hanging host.

   Run: node _cityboot_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = (p, ms) => Promise.race([Promise.resolve(p).then((v) => ({ done: true, v })), sleep(ms).then(() => ({ done: false }))]);

function bridgeText(src) {
  const at = src.indexOf('const MythicCityBridge = (() =>');
  const i = src.indexOf('{', at);
  let d = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (c === '/' && n === '*') { k = src.indexOf('*/', k + 2) + 1; continue; }
    if (c === '/' && n === '/') { k = src.indexOf('\n', k + 2); continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; k++; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++; } continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
}
// Shrink the bounds so the suite runs in well under a second.
const BRIDGE = bridgeText(NC).replace(/_ncBound\(p, 10000, LATE\)/, '_ncBound(p, 60, LATE)').replace(/_ncBound\(P\.cityNeighbors\(\), 8000, \[\]\)/, '_ncBound(P.cityNeighbors(), 60, [])');
function makeBridge(P) {
  const fn = new Function('window', 'localStorage', 'location', 'URLSearchParams', 'console', 'setTimeout',
    'return (() => ' + BRIDGE + ')();');
  const LS = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  return fn({ parent: P, addEventListener: () => {} }, LS, { search: '' }, URLSearchParams, { warn() {}, log() {}, error() {} }, setTimeout);
}
const host = (over) => Object.assign({ getRes: () => 0, addCinders() {} }, over);

/* ── 1. the two boot reads are bounded ─────────────────────────────────── */
{
  let resolveCards;
  const B = makeBridge(host({
    cityNeighbors: () => new Promise(() => {}),
    cityCardCollection: () => new Promise((r) => { resolveCards = r; }),
  }));
  ok(B.mode === 'parent', 'the shipped bridge runs in parent mode against the fake host');
  const n = await settle(B.fetchNeighborCities(), 2000);
  ok(n.done && Array.isArray(n.v) && n.v.length === 0, 'a neighbour read that never answers gives [] (its own failure value) and boot carries on', JSON.stringify(n));
  const c = await settle(B.fetchCards(), 2000);
  ok(c.done && Array.isArray(c.v) && c.v.length === 0, 'a card read that never answers gives [] and boot carries on', JSON.stringify(c));
  ok(B.cardsLate && typeof B.cardsLate.then === 'function', '…and the read in flight is kept so a late answer can still be adopted');
  resolveCards([{ id: 'u1' }]);
  const late = await B.cardsLate;
  ok(Array.isArray(late) && late[0].id === 'u1', '…which is the card list the host eventually sent');
}
{
  const B = makeBridge(host({ cityNeighbors: async () => [{ name: 'A' }], cityCardCollection: async () => [{ id: 'c' }] }));
  const n = await B.fetchNeighborCities(), c = await B.fetchCards();
  ok(n.length === 1 && c.length === 1 && B.cardsLate === null, 'a host that answers is passed straight through (no late promise)');
}
{
  const B = makeBridge(host({ cityCardCollection: () => { throw new Error('host'); } }));
  const c = await settle(B.fetchCards(), 2000);
  ok(c.done && Array.isArray(c.v) && c.v.length === 0, 'a host that throws still answers []');
}

/* ── 2. boot asks both together and adopts late cards ───────────────────── */
{
  const i = NC.indexOf('(async function boot()');
  const B = NC.slice(i, NC.indexOf('renderer.setAnimationLoop(animate);', i));
  ok(/const _cardsP = MythicCityBridge\.fetchCards\(\), _nbP = MythicCityBridge\.fetchNeighborCities\(\);/.test(B), 'boot starts both reads before awaiting either (one bound, not two)');
  ok(/MythicCityBridge\.cardsLate\.then\(\(v\) => \{ if \(Array\.isArray\(v\) && v\.length && !CARDS\.length\) CARDS = v; \}/.test(B), 'late cards are adopted only if nothing filled CARDS since');
  ok(!/await MythicCityBridge\.fetchCards\(\)/.test(B) && !/await MythicCityBridge\.fetchNeighborCities\(\)/.test(B), 'no unbounded await of either read is left in boot');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
