/* 🤝 THE AI CORPS' DAILY TRADE ALLOWANCE COUNTS DOWN AND STAYS DOWN.
   Run: node _aitradecap_smoke.mjs
   Tracker bug-mu1i6hd6: "the number of daily trades remaining available doesn't
   count down, so you can still effectively do as many as you like".
   The allowance is counted from Profile.aiTrade.runs. Two things threw those
   stamps away: the LOCAL profile loader never read aiTrade back (every reload
   started with a full allowance), and the cloud merge replaced the whole object
   with the cloud copy (a fetch before this device's upload undid the trades).
   §2 runs the real merge; §4 is the negative control — the old assignment. */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

const L0 = SRC.indexOf("console.warn('⚠ hg_profile is corrupt/truncated");
const loader = SRC.slice(L0, SRC.indexOf('// 🦸 Starter-deck state — restore so the new-player gate never re-fires.', L0));
const m0 = SRC.indexOf('function _aiTradeMerge(');
const m1 = SRC.indexOf('function _aiDayIndex()', m0);
const merge = new Function(SRC.slice(m0, m1) + '\nreturn _aiTradeMerge;')();

console.log('\n=== 1. a reload keeps the day\'s trades ===');
ok(/\bp\.aiTrade\b[^\n]*Profile\.aiTrade\s*=\s*p\.aiTrade/.test(loader), 'the local loader restores Profile.aiTrade');
ok(/__aiTrade__:\s*\(Profile\.aiTrade/.test(SRC), 'and it is still uploaded');

console.log('\n=== 2. the cloud merge keeps both sides\' trades ===');
{
  const now = 1790000000000;
  const cloud = { runs: { vex: [now - 5000] }, done: { vex: 1 }, rep: { vex: 5 },
                  deal: { vex: { left: 2, runs: 3, lastRun: now - 5000 } } };
  const local = { runs: { vex: [now - 5000, now - 1000], ash: [now - 9000] }, done: { vex: 2 }, rep: { vex: 10 },
                  deal: { vex: { left: 1, runs: 3, lastRun: now - 1000 } } };
  const r = merge(local, cloud);
  ok(JSON.stringify(r.runs.vex) === JSON.stringify([now - 5000, now - 1000]), 'runs are a union, with the shared stamp once', JSON.stringify(r.runs.vex));
  ok(r.runs.ash && r.runs.ash.length === 1, 'a corp only this device traded with is kept');
  ok(r.deal.vex.left === 1, 'the contract that delivered most recently wins — a delivery cannot be delivered again', JSON.stringify(r.deal.vex));
  ok(r.done.vex === 2 && r.rep.vex === 10, 'done and rep keep the larger count');
  ok(cloud.runs.vex.length === 1, 'the merge does not mutate the cloud row it was handed');

  const newer = merge(local, { runs: { vex: [now - 5000, now - 1000, now - 200] }, deal: { vex: { left: 0, runs: 3, lastRun: now - 200 } } });
  ok(newer.runs.vex.length === 3 && newer.deal.vex.left === 0, 'a cloud copy with newer business still wins its contract');

  const finished = merge({ runs: { vex: [now - 5000, now - 1000] }, deal: {} },
                         { runs: { vex: [now - 5000] }, deal: { vex: { left: 1, lastRun: now - 5000 } } });
  ok(!finished.deal.vex, 'a contract this device finished is not reopened from the older cloud copy');
  const signedElsewhere = merge({ runs: { vex: [now - 9000] }, deal: {} },
                                { runs: { vex: [now - 9000] }, deal: { vex: { left: 3, started: now - 100 } } });
  ok(!!signedElsewhere.deal.vex, 'a contract signed on another device after this one last traded is kept');

  ok(JSON.stringify(merge(null, cloud)) === JSON.stringify(cloud), 'with nothing local the cloud copy is taken as it is');
}

console.log('\n=== 3. the merge is what hydration calls ===');
{
  const at = SRC.indexOf("// 🤝 AI trade history — the other half of __aiTrade__ above.");
  const blk = SRC.slice(at, at + 1600);
  ok(/Profile\.aiTrade = _aiTradeMerge\(Profile\.aiTrade, f\.__aiTrade__\)/.test(blk), 'cloudFetchProfile merges through _aiTradeMerge');
  ok(!/\n\s*if \(f\.__aiTrade__ && typeof f\.__aiTrade__ === 'object'\) Profile\.aiTrade = f\.__aiTrade__;/.test(SRC), 'the whole-object replace is gone');
}

console.log('\n=== 4. NEGATIVE CONTROL — the old replace ===');
{
  const now = 1790000000000;
  const local = { runs: { vex: [now - 5000, now - 1000] } };
  const cloud = { runs: { vex: [now - 5000] } };
  const oldMerge = (l, c) => c;
  const cap = 2;
  ok(cap - oldMerge(local, cloud).runs.vex.length === 1 && cap - merge(local, cloud).runs.vex.length === 0,
    'old: 1 trade left after 2 were made; new: 0 left — the reported symptom and its fix');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ the daily trade allowance holds\n');
process.exit(fails ? 1 : 0);
