/* ══ 🛣 THE TRAFFIC RING, WITHOUT A BROWSER ════════════════════════════════
   traffic.js touches no DOM and no THREE — it takes a ctx and a clock — so the
   bucket maths, the rolling window and the save format can be driven in node in
   a second instead of in a twelve-minute capture. This asserts the things the
   browser run is too slow to sweep: every bucket boundary, a full lap of the
   ring, and the two save/load cases that only appear on a real player's disk.

   node .gauntlet/check-streets-clock.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { createMeter } from '../public/src/streets/traffic.js';
import { STREET } from '../public/src/streets/tuning.js';

let fails = 0;
const ok = (cond, what, extra) => {
  if (cond) console.log('  ok   ' + what);
  else { fails++; console.log('  FAIL ' + what + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

const mk = (cycleMin = 20) => {
  const game = { cityAge: 0, tiles: {} };
  const ctx = { game, cycleMin: () => cycleMin, carSpeed: () => 1.9, fleetMax: () => 18 };
  const m = createMeter(ctx);
  m.setNetwork(100);
  return { game, m };
};
/* Advance the clock the way animate() does — in beats, ticking the meter each
   frame — because the meter credits observed time PER TICK and a test that
   jumped the clock in one go would prove nothing about the clamp. */
const run = (game, m, seconds, beat = 0.25, onFrame) => {
  for (let t = 0; t < seconds; t += beat) {
    game.cityAge += beat;
    m.tick(beat);
    if (onFrame) onFrame();
  }
};

console.log('1. the clock is the CITY clock, not the wall clock');
{
  const { game, m } = mk();
  ok(m.hourSec() === 50, 'one bucket is 50 city seconds at CITY_DAY_MIN=20', m.hourSec());
  ok(m.cycleSec() === 1200, 'one cycle is 1200 city seconds', m.cycleSec());
  game.cityAge = 0;   ok(Math.floor(m.cycleHour()) === 0, 'cityAge 0 -> bucket 0');
  game.cityAge = 50;  ok(Math.floor(m.cycleHour()) === 1, 'cityAge 50 -> bucket 1');
  game.cityAge = 620; ok(Math.floor(m.cycleHour()) === 12, 'cityAge 620 -> bucket 12');
  game.cityAge = 1200; ok(Math.floor(m.cycleHour()) === 0, 'a full cycle wraps to bucket 0');
  const alt = mk(40);
  ok(alt.m.hourSec() === 100, 'a 40-minute cycle makes 100-second buckets', alt.m.hourSec());
}

console.log('2. one session fills the ring — 24 buckets in one cycle');
{
  const { game, m } = mk();
  /* 12 counted passes per city second on one tile, for one cycle less the last
     bucket. Stopping short of the wrap is the point: cross 1200 and the ring
     starts its SECOND lap, bucket 0 is expired on the spot, and 23 is the
     honest answer. */
  run(game, m, 1195, 0.25, () => { for (let i = 0; i < 3; i++) m.count('5,5', 'car'); });
  const s = m.series(['5,5']);
  ok(s.observedBuckets === 24, '24 of 24 buckets observed within one cycle', s.observedBuckets);
  ok(s.seen.every(Boolean), 'no gaps in the observed window');
  ok(Math.abs(s.volume[5] - 600) < 30, 'volume ~600 veh per city hour at 12/s', s.volume[5]);
  ok(s.vehTotal > 14000, 'every pass in the window is counted', s.vehTotal);
  ok(m.lifeOf('5,5') >= s.vehTotal, 'lifetime is never less than the window', [m.lifeOf('5,5'), s.vehTotal]);
  // And the lap after it: bucket 0 is expired the moment the ring wraps.
  run(game, m, 10, 0.25);
  ok(m.series(['5,5']).observedBuckets === 23, 'the wrap expires the bucket it lands in',
     m.series(['5,5']).observedBuckets);
}

console.log('3. the window rolls — the previous cycle does not add to this one');
{
  const { game, m } = mk();
  run(game, m, 60, 0.25, () => m.count('5,5', 'car'));      // buckets 0 and 1
  const a = m.series(['5,5']).veh[0];
  run(game, m, 1200, 0.25, () => m.count('5,5', 'car'));    // lap the ring once
  const b = m.series(['5,5']).veh[0];
  ok(a > 0 && b > 0, 'bucket 0 has traffic in both laps', [a, b]);
  ok(b < a * 1.6, 'the second lap REPLACED the first, it did not accumulate', [a, b]);
}

console.log('4. an unobserved bucket is a gap, never a zero');
{
  const { game, m } = mk();
  run(game, m, 30, 0.25, () => m.count('5,5', 'car'));   // most of bucket 0
  game.cityAge = 300;                                     // jump to bucket 6, unobserved
  m.tick(0.25);
  const s = m.series(['5,5']);
  ok(s.seen[0], 'the watched bucket is plotted');
  ok(!s.seen[3], 'a bucket nobody watched is NOT plotted');
  ok(s.observedBuckets < 3, 'the jump did not manufacture observation', s.observedBuckets);
}

console.log('5. the offline lump is refused as observation');
{
  const { game, m } = mk();
  run(game, m, 10, 0.25);
  const before = m.series(['5,5']).obsSec;
  game.cityAge += 36 * 3600;     // offlineCatchUp's worst case
  m.tick(0.25);
  const after = m.series(['5,5']).obsSec;
  ok(after - before <= STREET.MAX_TICK_CREDIT_SEC + 0.01,
     'a 36-hour catch-up credits at most MAX_TICK_CREDIT_SEC', after - before);
}

console.log('6. the vitals beat is credited in full (the clamp is not too tight)');
{
  const { game, m } = mk();
  // cityAge really moves in 2-second lumps, on vitalsTick's own beat.
  for (let i = 0; i < 10; i++) { game.cityAge += 2; m.tick(0.25); for (let j = 0; j < 8; j++) m.tick(0.25); }
  const s = m.series(['5,5']);
  /* 18, not 20: the very first tick has no previous reading to difference
     against, so it sets the mark and credits nothing. Losing one beat at mount
     is the correct price for never crediting a lump nobody watched. */
  ok(Math.abs(s.obsSec - 18) < 0.01, 'every lumped city second after the first beat is observed', s.obsSec);
}

console.log('7. save / load round trip');
{
  const { game, m } = mk();
  run(game, m, 120, 0.25, () => { m.count('5,5', 'car'); m.count('5,5', 'civilian'); });
  const before = m.series(['5,5']);
  const blob = m.save();
  const two = mk();
  two.game.cityAge = game.cityAge;
  two.m.load(blob);
  const after = two.m.series(['5,5']);
  ok(after.observedBuckets === before.observedBuckets, 'observed buckets survive', [before.observedBuckets, after.observedBuckets]);
  ok(after.vehTotal === before.vehTotal, 'vehicle counts survive', [before.vehTotal, after.vehTotal]);
  ok(after.pedTotal === before.pedTotal, 'footfall survives');
  ok(two.m.lifeOf('5,5') === m.lifeOf('5,5'), 'lifetime passes survive (wear is continuous)');
}

console.log('8. a save from the WALL-CLOCK build is dropped, not shown as today');
{
  const { game, m } = mk();
  game.cityAge = 300;
  // What the previous build wrote: stamps are hours since 1970, base 36.
  const wallHour = Math.floor(Date.now() / 3600000);
  m.load({ ob: '0:1e:' + wallHour.toString(36), tr: { '5,5': '2s|0:2s:0' } });
  const s = m.series(['5,5']);
  ok(s.observedBuckets === 0, 'no bucket from a wall-clock save is plotted', s.observedBuckets);
  ok(s.vehTotal === 0, 'its per-hour counts are dropped', s.vehTotal);
  ok(m.lifeOf('5,5') === 100, 'but LIFETIME passes are kept — wear is not a window', m.lifeOf('5,5'));
}

console.log('9. capacity and flow are in one unit');
{
  const { game, m } = mk();
  run(game, m, 60, 0.25, () => m.count('5,5', 'car'));
  const s = m.series(['5,5']);
  const parts = m.capacityParts();
  ok(Math.abs(s.capacity - Math.min(parts.lane, parts.share)) < 0.01,
     'capacity() is the smaller of the two parts, same unit', [s.capacity, parts.lane, parts.share]);
  const i = s.seen.findIndex(Boolean);
  ok(Math.abs(s.flow[i] - (s.volume[i] / s.capacity) * 100) < 0.01, 'flow is volume/capacity');
  // 18 vehicles over 100 road tiles at 1.9 tiles/s, in a 50-second hour.
  ok(Math.abs(parts.share - (18 * 1.9 * 50) / 100) < 0.01, 'fleet share is per CITY hour', parts.share);
}

console.log('10. wear reaches a scale a session can see');
{
  const W = STREET.WEAR_PER_1K_PASSES;
  // The per-tile rates measured on the standard district (see tuning.js), in
  // passes per city second, put through one 1,200-second cycle.
  const mean = 0.19 * 1200, busy = 0.48 * 1200;
  const wMean = (mean / 1000) * W, wBusy = (busy / 1000) * W;
  const capCycles = STREET.WEAR_CAP / wBusy;
  console.log('  one cycle: mean tile ' + wMean.toFixed(2) + '%, busy tile ' + wBusy.toFixed(2) +
              '%; cap in ' + capCycles.toFixed(0) + ' cycles (' + (capCycles / 3).toFixed(1) + ' h)');
  ok(wBusy >= 1, 'a busy tile moves at least a whole point per cycle', wBusy);
  ok(wMean >= 0.5, 'the AVERAGE moves off 100 within a cycle', wMean);
  ok(wBusy <= 8, 'and not so fast that one session ruins the road', wBusy);
  ok(capCycles >= 12, 'the cap is hours of play away, not one session', capCycles);
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL CLEAR');
process.exit(fails ? 1 : 0);
