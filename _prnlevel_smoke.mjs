/* 🔮 PRN LEVELS: THE CITY SAID 54, THE RESERVE SAID 1 (bug-mtwuhbwu).

   The city levels a node by sustained link (node-city nodeXpTick) and stores
   it in economy_nodes.meta.level through city_set_node_level, which clamps to
   least(50, …) and only ever raises it. The Foundation Reserve's PRN tab
   printed the `level` COLUMN, which nothing writes above 1 — "all Level 1".
   And the city kept levelling past the server's 50, announcing LEVEL 54 for a
   level the next boot read back as 50.

   Drives the real _nodeShownLevel (index.html) and nodeXpTick (node-city).
   Run: node _prnlevel_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const IX = readFileSync('./public/index.html', 'utf8');
function fnText(src, name) {
  const i = src.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const lineOf = (src, re) => { const m = src.match(re); if (!m) throw new Error('cannot find ' + re); return m[0].replace(/^const /, 'var '); };

/* ── 1. the Reserve shows the city's level ─────────────────────────────── */
{
  const ctx = { Math };
  vm.createContext(ctx);
  vm.runInContext(lineOf(IX, /const NODE_CITY_LEVEL_MAX = [^;]*;/), ctx);
  vm.runInContext(fnText(IX, '_nodeShownLevel'), ctx);
  const L = (n) => vm.runInContext('_nodeShownLevel(' + JSON.stringify(n) + ')', ctx);
  ok(L({ level: 1, meta: { level: 12 } }) === 12, 'column 1, city level 12 → LV 12', L({ level: 1, meta: { level: 12 } }));
  ok(L({ level: 1, meta: {} }) === 1, 'never levelled → LV 1');
  ok(L({ level: 1 }) === 1 && L({}) === 1 && L(null) === 1, 'no meta / empty row → LV 1');
  ok(L({ level: 1, meta: { level: 400 } }) === 50, 'a patched meta.level is shown at the server ceiling, never above', L({ level: 1, meta: { level: 400 } }));
  ok(L({ level: 3, meta: { level: 2 } }) === 3, 'the higher of the two is shown');
  ok(/' · LV ' \+ _nodeShownLevel\(n\) \+ ' · eff '/.test(IX), 'the Reserve PRN tab prints _nodeShownLevel');
  ok(/level: _nodeShownLevel\(n\),/.test(IX), 'the city PRN list (cityPrnList) prints the same level');
  // The payout multiplier must NOT move: it still reads the column through NODE_PAY_MAX_LEVEL.
  ok(/Math\.min\(NODE_PAY_MAX_LEVEL, \(n\.level \| 0\) \|\| 1\)/.test(fnText(IX, '_nodeClaimable')), 'payout still prices the column, clamped — display-only change');
}

/* ── 2. the city stops at the server's ceiling ─────────────────────────── */
{
  const pushed = [], toasts = [];
  const ctx = {
    Math, game: { anchors: [], nodeXp: {} }, NODE_TYPES: {}, ARMY: { nodePopPerLvl: 4 },
    MythicCityBridge: { pushNodeLevel: (id, l) => pushed.push(l) },
    toast: (m) => toasts.push(m), saveSoon: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(lineOf(NC, /const NODE_XP_PER_LEVEL = \d+;/), ctx);
  vm.runInContext(lineOf(NC, /const NODE_LEVEL_MAX = \d+;/), ctx);
  vm.runInContext(fnText(NC, 'nodeXpTick'), ctx);
  ctx.game.anchors.push({ link: 100, node: { id: 'n1', level: 48, node_type: 'supply', name: 'S' } });
  for (let i = 0; i < 20; i++) vm.runInContext('nodeXpTick(500)', ctx);   // 100 × 500 = one level per tick
  ok(ctx.game.anchors[0].node.level === 50, 'levels up to 50 and stops', ctx.game.anchors[0].node.level);
  ok(JSON.stringify(pushed) === '[49,50]', 'pushes 49 and 50 only — never a level the server would clamp', JSON.stringify(pushed));
  ok(toasts.length === 2, 'two level-up notifications, not twenty', toasts.length);
  ctx.game.anchors[0].node.level = 10;
  vm.runInContext('nodeXpTick(500)', ctx);
  ok(ctx.game.anchors[0].node.level === 11, 'below the ceiling it still levels as before');
}

console.log(fails ? '\n' + fails + ' FAIL' : '\nall PASS');
process.exit(fails ? 1 : 0);
