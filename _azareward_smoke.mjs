// _azareward_smoke.mjs — bug-mu7bk9gy / mu8x9c2u / mu8rh141 / mu2s9wa7.
// "AZA from a Resource Run shows in the debrief but never hits the wallet."
//
// Root cause: _covertCollect bumped Profile.sovereigns locally with the
// ADVERTISED amount and printed "+1 Aza", then fired sov_reward without
// reading the answer. A refusal (rate_limited / daily_cap / offline) carries
// no `aza`, so nothing corrected the bump until the next boot's canonical
// adopt took it away. This drives the real code headless with a stubbed RPC:
//   * refused  -> wallet unchanged, the debrief SAYS no Aza and why
//   * granted  -> wallet = the server's balance, debrief says credited
//   * the client's weekly gate counts by collectedAt, like the server's log
// Run: node _azareward_smoke.mjs   (exit 0 = pass)
import { loadEngine } from './tools/gamedev/headless.mjs';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

const eng = loadEngine(process.env.AZA_FILE ? { file: process.env.AZA_FILE } : {});
const S = eng.sandbox, P = eng.Profile, App = eng.App;
S.render = () => 0; S.showToast = () => 0; S.saveProfile = () => 0;

function runCollect(reply) {
  let calls = 0;
  S._sovRpc = (fn, args) => { calls++; return Promise.resolve(reply); };
  P.sovereigns = 10;
  const now = Date.now();
  P.covertActions = [{ id: 'm1', missionId: 'cv_resource', unitIds: [], startedAt: now - 5 * 3600e3, endsAt: now - 3600e3 }];
  P.covertActionHistory = [];
  App._covertResult = null; App._covertResultQueue = [];
  const snap = S._covertCollect('m1');
  App._covertResult = snap;
  return { snap, before: P.sovereigns, calls: () => calls };
}

const tick = () => new Promise(r => setTimeout(r, 0));

// 1. server refuses (rate limit)
{
  const r = runCollect({ ok: false, error: 'rate_limited', used: 2, limit: 2, window_seconds: 604800 });
  ok(r.before === 10, 'refused: no optimistic local Aza bump at collect (wallet 10, was ' + r.before + ')');
  ok(!/\+1 Aza/.test(r.snap.reward), 'refused: debrief does not claim "+1 Aza" up front: ' + r.snap.reward);
  await tick(); await tick();
  ok(P.sovereigns === 10, 'refused: wallet still 10 after the reply');
  ok(/no Aza/.test(App._covertResult.reward) && /2× per 7 days/.test(App._covertResult.reward), 'refused: open debrief now explains: ' + App._covertResult.reward);
  ok(/no Aza/.test(P.covertActionHistory[0].reward), 'refused: history entry resolved too');
  ok(r.calls() === 1, 'exactly one sov_reward call');
}
// 2. offline
{
  runCollect(null);
  await tick(); await tick();
  ok(P.sovereigns === 10 && /not signed in/.test(App._covertResult.reward), 'offline: wallet unchanged, says why: ' + App._covertResult.reward);
}
// 3. server grants
{
  runCollect({ ok: true, kind: 'cv_resource', granted: 1, aza: 11 });
  await tick(); await tick();
  ok(P.sovereigns === 11, 'granted: wallet adopts the server balance 11 (got ' + P.sovereigns + ') — no double count');
  ok(/\+1 Aza credited/.test(App._covertResult.reward), 'granted: debrief says credited: ' + App._covertResult.reward);
}
// 4. weekly gate counts by collectedAt (server logs at collect time)
{
  const now = Date.now(), wk = 7 * 24 * 3600e3;
  P.covertActions = [];
  P.covertActionHistory = [
    { missionId: 'cv_resource', startedAt: now - wk - 3600e3, collectedAt: now - wk + 86400e3, collected: true },
    { missionId: 'cv_resource', startedAt: now - 2 * 86400e3, collectedAt: now - 86400e3, collected: true },
  ];
  ok(S._covertWeeklyUsesRemaining('cv_resource') === 0, 'gate: a run started 7d+1h ago but collected 6d ago still counts (server still counts it)');
  P.covertActionHistory.pop();
  P.covertActions = [{ id: 'x', missionId: 'cv_resource', startedAt: now - wk - 7200e3, endsAt: now - wk }];
  ok(S._covertWeeklyUsesRemaining('cv_resource') === 0, 'gate: an uncollected run counts however old (it is logged when collected)');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
