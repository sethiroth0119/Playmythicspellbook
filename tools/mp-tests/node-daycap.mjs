#!/usr/bin/env node
/* ⏳ PRN DAILY PAYOUT CAP — the gate on a ceiling that guards real money.
   ---------------------------------------------------------------------------
   Run:  node tools/mp-tests/node-daycap.mjs   (or via tools/mp-tests/run.mjs)

   The anti-abuse ceiling was 250,000 PER COLLECT, per node — which the cooldown
   was the only real brake on, and a player with six nodes had six of them. It
   is now a rolling 24-hour allowance for the PLAYER, scaled by tier:
   cap = tier.rate × 7,500, so Eternal Founder (rate 20) is 150,000/24h.

   Cinder converts to Aza and Aza settles at 1 ◈ = $1, so an error here is a
   money error in one direction and a locked-out player in the other. Both
   directions are tested.

   🔴 THE ONE THAT WAS ALREADY WRONG. _nodeOwnerTierMul()'s OFF value carries
      `rate: 0`, and it is returned whenever /src/nodes/tiers.js is absent or a
      pledge has not been fetched. The first version read that as "allowance
      zero" and clamped every payout to nothing — one guarded module 404ing
      would have stopped ALL PRN collection. No tier information must mean NO
      day cap, never a cap of zero. That case is first below.
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.MP_SRC || join(ROOT, 'public', 'index.html');
const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');

function extractFn(name) {
  const start = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (start === -1) throw new Error('no top-level `function ' + name + '(` in index.html');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('}')) { end = i; break; }
  if (end === -1) throw new Error('no column-0 closing brace for ' + name);
  return lines.slice(start, end + 1).join('\n');
}
function constOf(name) {
  const l = lines.find(x => x.startsWith('const ' + name + ' '));
  if (!l) throw new Error('no `const ' + name + '` in index.html');
  const m = /=\s*([0-9]+)/.exec(l);
  if (!m) throw new Error('could not read the value of ' + name);
  return Number(m[1]);
}

const PER_RATE = constOf('NODE_DAILY_CAP_PER_RATE');
const DAY_MS = constOf('NODE_DAY_MS');

// Sandbox: the three helpers plus the two globals they read.
const build = (tierRate, nodes) => new Function(`
  const NODE_DAILY_CAP_PER_RATE = ${PER_RATE}, NODE_DAY_MS = ${DAY_MS};
  const FoundationReserve = { nodes: ${JSON.stringify(nodes)} };
  function _nodeOwnerTierMul() { return { rate: ${tierRate === null ? 0 : tierRate} }; }
  ${extractFn('_nodeDailyCap')}
  ${extractFn('_nodeDayUsed')}
  ${extractFn('_nodeDayLeft')}
  return { _nodeDailyCap, _nodeDayUsed, _nodeDayLeft };
`)();

const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail: cond ? '' : detail });
const NOW = Date.now();
const node = (dayPaid, ageMs) => ({ meta: { dayPaid, dayStart: NOW - ageMs } });

// ── 1. NO TIER INFO MUST NOT LOCK PAYOUTS OUT ──────────────────────────────
{
  const s = build(0, [node(0, 0)]);
  check('rate 0 (module absent / untiered) means NO cap, not a zero cap',
    s._nodeDailyCap() === Infinity, 'cap ' + s._nodeDailyCap());
  check('…so the remaining allowance is unbounded', s._nodeDayLeft() === Infinity,
    'left ' + s._nodeDayLeft());
}

// ── 2. THE LADDER ──────────────────────────────────────────────────────────
{
  const table = [[0.5, 3750], [1, 7500], [3, 22500], [5, 37500], [8, 60000], [10, 75000], [20, 150000]];
  for (const [rate, want] of table) {
    const s = build(rate, []);
    check('tier rate ' + rate + ' → ' + want.toLocaleString() + ' / 24h', s._nodeDailyCap() === want,
      'got ' + s._nodeDailyCap());
  }
  check('Eternal Founder is exactly 150,000', build(20, [])._nodeDailyCap() === 150000, 'mismatch');
}

// ── 3. THE ROLLING WINDOW ──────────────────────────────────────────────────
{
  const s = build(20, [node(40000, 1000), node(10000, 2000)]);
  check('usage sums across the player\'s own nodes', s._nodeDayUsed() === 50000, 'used ' + s._nodeDayUsed());
  check('and the remainder is cap minus usage', s._nodeDayLeft() === 100000, 'left ' + s._nodeDayLeft());
}
{
  // A tally older than 24h has expired and must not count.
  const s = build(20, [node(150000, DAY_MS + 1000), node(20000, 5000)]);
  check('an expired window contributes nothing', s._nodeDayUsed() === 20000, 'used ' + s._nodeDayUsed());
  check('so the allowance comes back', s._nodeDayLeft() === 130000, 'left ' + s._nodeDayLeft());
}
{
  // Exactly 24h old is expired — the boundary, asserted so it cannot drift.
  const s = build(20, [node(150000, DAY_MS)]);
  check('the window closes AT 24h, not after', s._nodeDayUsed() === 0, 'used ' + s._nodeDayUsed());
}
{
  const s = build(20, [node(150000, 1000)]);
  check('a spent allowance leaves zero', s._nodeDayLeft() === 0, 'left ' + s._nodeDayLeft());
}
{
  // Over-spend (a legacy row, or a cap lowered under a player) must clamp to 0.
  const s = build(1, [node(999999, 1000)]);
  check('over-spend never goes negative', s._nodeDayLeft() === 0, 'left ' + s._nodeDayLeft());
}

// ── 4. HOSTILE / ABSENT META ───────────────────────────────────────────────
{
  const s = build(20, [{}, { meta: null }, { meta: {} }, { meta: { dayPaid: 'x', dayStart: NOW } },
                       { meta: { dayPaid: -500, dayStart: NOW } }, null]);
  check('missing, null and non-numeric meta count as zero', s._nodeDayUsed() === 0, 'used ' + s._nodeDayUsed());
  check('a negative dayPaid cannot credit the allowance back', s._nodeDayLeft() === 150000,
    'left ' + s._nodeDayLeft());
}
{
  const s = build(20, [node(10000, 1000), { meta: { dayPaid: 5000 } }]);   // no dayStart
  check('a tally with no dayStart is ignored', s._nodeDayUsed() === 10000, 'used ' + s._nodeDayUsed());
}

const failed = results.filter(r => !r.ok);
console.log('\n⏳ PRN DAILY PAYOUT CAP — ' + results.length + ' properties\n');
for (const r of results) console.log('  ' + (r.ok ? '✅' : '❌') + ' ' + r.name + (r.ok ? '' : '  → ' + r.detail));
if (failed.length) { console.log('\n  ' + failed.length + ' failed.\n'); process.exit(1); }
console.log('\n  ✅ 150,000 / 24h at Eternal, and no tier info never means no payout.\n');
process.exit(0);
