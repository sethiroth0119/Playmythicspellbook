/* 🔁 bug-mu1pbwb4 — "When you go into the Ruin Exchange main menu, particularly
   after a fresh start of the day, the Ruin Exchange menu will redraw several
   times (at least twice, up to 5)."

   Opening the Exchange runs every tile gate (isTutorUnlocked, isCampUnlocked,
   …), which warm several caches on a fresh page load. Two of those landed with
   an UNCONDITIONAL render() — a whole-hub rebuild that changes nothing on it:
     • tw_fetchNodeMayors (index.html) — nothing on a title hub reads mayors;
     • the Athena menu-tile prime (src/mapforge/mapforge.menu.js) — redrew when
       ANY public menu world existed, even with none placed on this hub, and
       again on the signed-out → signed-in re-prime.
   (Plus the boot cloud pull's own re-render, which is legitimate — the data
   really changed — and is left alone.)

   Pinned here:
     1. mayors landing while the player sits on a title hub: 0 renders
     2. NEGATIVE CONTROL: the same fetch on the War Map still renders
     3. menu tiles for a hub nobody placed a world on: 0 renders
     4. NEGATIVE CONTROL: a world placed ON the hub being drawn → 1 render
     5. a re-prime returning the same rows (the sign-in flip): 0 renders
     6. HEAD control (only while HEAD has the old code): the old mayor fetch
        redraws the title hub — the bug, reproduced.

   Run: node _hubredraw_smoke.mjs */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

function liftFn(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('missing ' + head);
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j + 3);
}

/* ---- 1/2: tw_fetchNodeMayors against a stub cloud ---- */
async function mayorRenders(src, screen) {
  const fn = liftFn(src, 'async function tw_fetchNodeMayors(');
  let renders = 0;
  const q = { select() { return q; }, eq() { return q; }, limit() { return Promise.resolve({ data: [{ node_id: 'N-1', mayor_id: 'u2', active: true }] }); } };
  const Cloud = { client: { from: () => q } };
  const run = new Function('App', 'Cloud', 'initCloud', 'render',
    'let _twMayors = null, _twMayorsFetching = false, _twMayorsMissing = false;\n' + fn + '\nreturn tw_fetchNodeMayors;');
  const f = run({ screen }, Cloud, () => true, () => { renders++; });
  const out = await f();
  return { renders, out };
}
const SRC = readFileSync('./public/index.html', 'utf8');
console.log('\n=== 1. mayors land while a title hub is showing ===');
{ const r = await mayorRenders(SRC, 'title'); ok(r.out && r.out['N-1'], 'the cache still fills'); ok(r.renders === 0, 'no hub rebuild', r.renders); }
console.log('\n=== 2. NEGATIVE CONTROL: same fetch on the War Map ===');
{ const r = await mayorRenders(SRC, 'territoryWars'); ok(r.renders === 1, 'the map redraws once with the mayors', r.renders); }

/* ---- 3/4/5: the Athena menu module ---- */
let renders = 0, rows = [];
const lim = { order() { return lim; }, limit() { return Promise.resolve({ data: rows.slice() }); } };
const chain = { select() { return chain; }, eq() { return chain; }, filter() { return lim; } };
globalThis.window = globalThis.window || {};
globalThis.window.MythicBridge = {
  signedIn: () => true, render: () => { renders++; },
  cloud: { client: { from: () => chain } },
};
const M = await import('./public/src/mapforge/mapforge.menu.js');
console.log('\n=== 3. a public world exists, but on another hub ===');
{
  rows = [{ id: 'w1', name: 'Keep', menu: { on: true, hub: 'main', label: 'Keep' } }];
  renders = 0;
  M.menuTiles('exchange');
  await M.prime();            // the in-flight load (prime returns it while loading)
  await new Promise((r) => setTimeout(r, 0));
  ok(M.cached().length === 1, 'the row loaded');
  ok(renders === 0, 'no Exchange redraw for a Keep-only world', renders);
}
console.log('\n=== 4. NEGATIVE CONTROL: a world placed ON the Exchange ===');
{
  rows = [{ id: 'w1', name: 'Keep', menu: { on: true, hub: 'main', label: 'Keep' } },
          { id: 'w2', name: 'Bazaar', menu: { on: true, hub: 'exchange', label: 'Bazaar' } }];
  renders = 0;
  await M.refreshMenu();
  ok(renders === 1, 'the hub redraws exactly once to show its new tile', renders);
  ok(M.menuTiles('exchange').length === 1, 'and the tile is there');
}
console.log('\n=== 5. re-prime with the same rows (sign-in flip) ===');
{ renders = 0; await M.refreshMenu(); ok(renders === 0, 'unchanged tiles → no redraw', renders); }

console.log('\n=== 6. HEAD control (the bug, reproduced) ===');
{
  let head = null;
  try { head = execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'show', 'HEAD:public/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {}
  if (!head || /bug-mu1pbwb4/.test(liftFn(head, 'async function tw_fetchNodeMayors('))) console.log('  (skipped: HEAD already carries the fix)');
  else { const r = await mayorRenders(head, 'title'); ok(r.renders === 1, 'OLD code rebuilds the title hub when mayors land', r.renders); }
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
