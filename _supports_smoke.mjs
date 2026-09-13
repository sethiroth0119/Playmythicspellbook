/* ════════════════════════════════════════════════════════════════════════════
   💬 _supports_smoke.mjs — support ranks and the voice engine.
   ----------------------------------------------------------------------------
   The two claims worth proving:

     1. THE PAIR KEY IS ORDER-INDEPENDENT. pairKey(a,b) === pairKey(b,a), or the
        roster silently grows two half-built relationships for every pair and
        neither ever reaches a rank.
     2. THE VOICE IS DETERMINISTIC. The same two heroes at the same rank must
        produce the SAME conversation every time. A scene that re-rolls on each
        view stops reading as a memory and starts reading as filler.

       node _supports_smoke.mjs
   ════════════════════════════════════════════════════════════════════════════ */
import {
  pairKey, splitKey, newPair, awardBattle, earnedRank, unlockedRank,
  pendingScene, bonusFor, RANKS, POINTS,
} from './public/src/supports/supports.data.js';
import { generateLocal, generate, setProvider, hasProvider } from './public/src/supports/supports.voice.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
};

console.log('\n💬 SUPPORT RANKS\n');

/* ── 1. the pair key ───────────────────────────────────────────────────── */
{
  ok('pairKey is order-independent', pairKey('vex', 'mira') === pairKey('mira', 'vex'));
  ok('…and round-trips', (() => { const s = splitKey(pairKey('mira', 'vex')); return (s.a === 'mira' && s.b === 'vex') || (s.a === 'vex' && s.b === 'mira'); })());
  ok('different pairs get different keys', pairKey('a', 'b') !== pairKey('a', 'c'));
}

/* ── ranks are gated on points AND on watching the scene ──────────────── */
{
  const p = newPair('a', 'b');
  ok('a new pair has no rank', earnedRank(p).key === 'none' && unlockedRank(p).key === 'none');
  ok('…and no scene waiting', pendingScene(p) === null);
  ok('…and gives no bonus', bonusFor(p) === null);

  p.points = 50;                                   // past C (40), short of B (110)
  ok('50 points EARNS rank C', earnedRank(p).key === 'C');
  ok('…but C is not UNLOCKED until watched', unlockedRank(p).key === 'none');
  ok('…and a C scene is waiting', pendingScene(p).key === 'C');
  ok('…and still no bonus until it is watched', bonusFor(p) === null);

  p.scenesSeen = ['C'];
  ok('watching C unlocks it', unlockedRank(p).key === 'C');
  ok('…which grants the C bonus', bonusFor(p) && bonusFor(p).rank === 'C');
  ok('…and nothing else is waiting', pendingScene(p) === null);
}

/* ── you cannot skip a rank by grinding ───────────────────────────────── */
{
  const p = newPair('a', 'b');
  p.points = 500;                                  // past S
  ok('S is earned', earnedRank(p).key === 'S');
  ok('…but the NEXT scene offered is still C', pendingScene(p).key === 'C',
     'got ' + (pendingScene(p) || {}).key);
  p.scenesSeen = ['C'];
  ok('…then B', pendingScene(p).key === 'B');
  p.scenesSeen = ['C', 'B'];
  ok('…then A', pendingScene(p).key === 'A');
  p.scenesSeen = ['C', 'B', 'A'];
  ok('…then S', pendingScene(p).key === 'S');
  p.scenesSeen = ['C', 'B', 'A', 'S'];
  ok('…then nothing', pendingScene(p) === null);
  ok('S grants the biggest bonus', bonusFor(p).rank === 'S' && bonusFor(p).hit === 12);
}

/* ── battle awards ────────────────────────────────────────────────────── */
{
  const p = newPair('a', 'b');
  const base = awardBattle(p, {});
  ok('just being deployed together awards points', base === POINTS.bothDeployed);
  ok('…and counts a battle', p.battles === 1);

  const p2 = newPair('a', 'b');
  const rich = awardBattle(p2, { adjacentTurns: 4, savedKill: true, revived: true, bothSurvived: true });
  ok('adjacency, saves and revives all add', rich > base, `rich=${rich} base=${base}`);

  const p3 = newPair('a', 'b');
  const capped = awardBattle(p3, { adjacentTurns: 999 });
  ok('adjacency is capped per battle',
     capped === POINTS.bothDeployed + POINTS.adjacentCap, 'got ' + capped);
}

console.log('\n🗣 THE VOICE ENGINE\n');

/* ── 2. determinism ───────────────────────────────────────────────────── */
{
  const a = { id: 'vex', name: 'Vex', traits: ['brave', 'lucky'] };
  const b = { id: 'mira', name: 'Mira', traits: ['wise'] };

  const one = generateLocal({ a, b, rank: 'B', history: {} });
  const two = generateLocal({ a, b, rank: 'B', history: {} });
  ok('the SAME pair at the SAME rank gives the SAME conversation',
     JSON.stringify(one.lines) === JSON.stringify(two.lines));

  // Order of arguments must not change the seed — the key is sorted.
  const flipped = generateLocal({ a: b, b: a, rank: 'B', history: {} });
  ok('…regardless of which hero is passed first',
     flipped.topic === one.topic,
     `topic ${one.topic} vs ${flipped.topic}`);

  const other = generateLocal({ a, b, rank: 'A', history: {} });
  ok('a DIFFERENT rank gives a different conversation',
     JSON.stringify(other.lines) !== JSON.stringify(one.lines));

  const c = { id: 'zed', name: 'Zed', traits: ['cowardly'] };
  const diff = generateLocal({ a, b: c, rank: 'B', history: {} });
  ok('a DIFFERENT pair gives a different conversation',
     JSON.stringify(diff.lines) !== JSON.stringify(one.lines));
}

/* ── the arc lengthens with rank ──────────────────────────────────────── */
{
  const a = { id: 'a', name: 'A', traits: [] }, b = { id: 'b', name: 'B', traits: [] };
  const c = generateLocal({ a, b, rank: 'C', history: {} });
  const s = generateLocal({ a, b, rank: 'S', history: {} });
  ok('a C scene is short', c.lines.length === 3, 'got ' + c.lines.length);
  ok('an S scene is longer', s.lines.length > c.lines.length, `C=${c.lines.length} S=${s.lines.length}`);
  ok('speakers alternate strictly',
     s.lines.every((l, i) => i === 0 || l.who !== s.lines[i - 1].who));
  ok('every line has text', s.lines.every(l => l.text && l.text.length > 3));
}

/* ── traits change the words ──────────────────────────────────────────── */
{
  const brave = { id: 'x', name: 'X', traits: ['brave'] };
  const scared = { id: 'x', name: 'X', traits: ['cowardly'] };
  const partner = { id: 'y', name: 'Y', traits: [] };
  const a = generateLocal({ a: brave, b: partner, rank: 'A', history: {} });
  const b = generateLocal({ a: scared, b: partner, rank: 'A', history: {} });
  ok('the same hero id with different traits speaks differently',
     JSON.stringify(a.lines) !== JSON.stringify(b.lines));
}

/* ── a hero with no traits still speaks ───────────────────────────────── */
{
  const g = generateLocal({ a: { id: 'p', name: 'P' }, b: { id: 'q', name: 'Q' }, rank: 'C', history: {} });
  ok('an untraited pair falls back to the plain voice', g.lines.length === 3 && !!g.lines[0].text);
}

/* ── the provider seam falls back ─────────────────────────────────────── */
{
  const a = { id: 'a', name: 'A', traits: [] }, b = { id: 'b', name: 'B', traits: [] };
  ok('no provider by default', hasProvider() === false);

  setProvider(() => { throw new Error('boom'); });
  ok('a provider is registered', hasProvider() === true);
  const res = await generate({ a, b, rank: 'C', history: {} });
  ok('a THROWING provider falls back to the local engine', res.generator === 'local');

  setProvider(async () => ({ scene: 'custom', lines: [{ who: 'a', name: 'A', text: 'hello' }] }));
  const res2 = await generate({ a, b, rank: 'C', history: {} });
  ok('a working provider is used', res2.generator === 'provider' && res2.lines[0].text === 'hello');

  setProvider(async () => ({ lines: [] }));
  const res3 = await generate({ a, b, rank: 'C', history: {} });
  ok('a provider returning nothing falls back', res3.generator === 'local');

  setProvider(null);
  ok('the provider can be removed', hasProvider() === false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
