/* ⚔⏳ v121v139 — a battle loading screen that covers the REAL lag, and an AI
   that waits for it. Run: node _battleload_smoke.mjs

   Owner: "The game lags hard before the battle starts so What I want to do is ad
   the loading screen when the camera zoom out happens with the players cards in
   their hand has this fade out to the zoomout from the camera and have the ai
   wait until cards are drawn from both players and lag is over. Also that
   progress bar in the image make it move to the full of the game starting."

   WHAT WAS ACTUALLY WRONG — three things racing, nothing waiting:
     · the board iframe boots and bakes (its own budget note measures ~435ms in
       ONE frame: vista 106, terrain 130, grade 59) and the host answers
       board:ready with EIGHT push bursts;
     · the camera pull-back is 900ms and its own comment says it does not gate
       input;
     · the AI is kicked with scheduleAIStep(900) — and applyAnimSpeed can make
       that SHORTER — while the last hand card does not finish arriving until
       ~1520ms. So the AI could act before the player's hand finished dealing. */
import { readFileSync, existsSync, statSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the art ships small ──────────────────────────────────────────────────── */
for (const [f, cap] of [['avif', 420], ['webp', 430], ['jpg', 340]]) {
  const p = './public/assets/artwork/ui/battle-loading.' + f;
  ok(existsSync(p), 'the loading art ships as ' + f);
  if (existsSync(p)) {
    const kb = Math.round(statSync(p).size / 1024);
    ok(kb <= cap, '…and it is ' + kb + 'KB — a screen whose job is to COVER startup lag must not be a download that causes it', kb + 'KB > ' + cap + 'KB');
  }
}
ok(/image-set\(url\('assets\/artwork\/ui\/battle-loading\.avif'\) type\('image\/avif'\)/.test(SRC),
  'the page asks for AVIF first, WebP next, JPEG last — the smallest format the browser can take');

/* ── the controller ───────────────────────────────────────────────────────── */
ok(/window\.BattleLoading = API;/.test(SRC), 'there is a BattleLoading controller');
{
  const f = SRC.slice(SRC.indexOf('⚔ BATTLE LOADING (v121v139)'), SRC.indexOf('window.BattleLoading = API;'));
  ok(/var WEIGHTS = \{ state: 0\.15, stage: 0\.35, reveal: 0\.20, settle: 0\.30 \};/.test(f),
    'the bar is weighted across four REAL milestones, not a timer');
  ok(/THE settle STEP IS THE HONEST PART/.test(f),
    '…and the reason the biggest weight is frame health is written down: "lag is over" depends on the machine, so it is MEASURED');
  ok(/var MIN_MS = 800, MAX_MS = 12000, SETTLE_FRAMES = 8, SETTLE_MS = 40;/.test(f),
    'a floor so it cannot blink on a fast rematch, and a ceiling so a machine that never settles is not stranded');
  ok(/if \(dt < SETTLE_MS\) smooth\+\+; else smooth = 0;/.test(f),
    'frame health is measured by consecutive fast frames — one good frame in a stutter does not count');
  ok(/if \(smooth >= SETTLE_FRAMES\) \{ API\.markReady\(\); return; \}/.test(f), '…and that is what completes the screen');
  ok(/if \(waited < MIN_MS\) \{ setTimeout\(function \(\) \{ API\.done\(\); \}, MIN_MS - waited\); return; \}/.test(f),
    'markReady honours the floor rather than closing instantly');
  ok(/safety = setTimeout\(function \(\) \{ try \{ API\.done\(true\); \} catch \(e\) \{\} \}, MAX_MS\);/.test(f),
    'the safety net is the same shape as BootSplash\'s, which this is modelled on');
  ok(/el = null; bar = null; stepEl = null;     \/\/ \.active\(\) is false from here/.test(f),
    'active() flips FALSE before the fade finishes — the AI and the deal must release when the decision is made, not 560ms later');
  ok(/progress\[key\] = Math\.max\(progress\[key\], Math\.max\(0, Math\.min\(1, value\)\)\)/.test(f),
    'a milestone never goes BACKWARDS — a late lower report cannot make the bar retreat');
  ok(/window\._btlAfterLoad === 'function'/.test(f), '…and clearing the screen is what releases the opening deal');
}

/* ── it is raised before the first paint ──────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('⚔ v121v139 — COVER THE OPENING'), SRC.indexOf('⚔ v121v139 — COVER THE OPENING') + 1400);
  ok(/window\.BattleLoading\.show\('Entering the realm'\);/.test(f), 'the screen is raised at the start of the battle');
  ok(/window\.BattleLoading\.set\('state', 1, 'Hands dealt/.test(f),
    'BOTH HANDS ARE ALREADY DEALT when it appears — initGame slices them in the same object literal in one tick, which is exactly the owner\'s "cards are drawn from both players"');
  const showAt = f.indexOf("BattleLoading.show"), flipAt = f.indexOf("App.screen = 'battle'");
  ok(showAt > 0 && flipAt > showAt,
    '…and it goes up BEFORE the screen flip and first render, which is where the iframe bakes and the eight push bursts land');
}

/* ── the AI waits, in the same place the modals made it wait ──────────────── */
{
  const f = SRC.slice(SRC.indexOf('function _runAIStepWhenClear(waited) {'), SRC.indexOf('/* 🛑 AI STEP BUDGET'));
  ok(/if \(window\.BattleLoading && window\.BattleLoading\.active\(\) && waited < 15000\) \{/.test(f),
    'THE AI WAITS for the opening to finish — the owner\'s "have the ai wait until cards are drawn from both players and lag is over"');
  const modalAt = f.indexOf('_playerChoiceModalOpen'), loadAt = f.indexOf('BattleLoading.active()');
  ok(modalAt > 0 && loadAt > modalAt,
    '…beside the v121v137 modal wait, so ONE place decides whether the AI may step and the two answers cannot disagree');
  ok(/applyAnimSpeed can make\n\s*that 900 SHORTER/.test(f),
    'the note records WHY the old scheduleAIStep(900) was not enough — applyAnimSpeed can shorten it below the camera pull-back');
  const guard = f.indexOf('BattleLoading.active()');
  ok(f.indexOf('App._aiLastSchedule = Date.now();', guard) > guard,
    '…and the wait refreshes the schedule stamp, or the 8s hang-watchdog would force-end the turn under the loading screen');
}

/* ── the deal plays where it can be seen ──────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function _playOpeningDeal() {'), SRC.indexOf('function _playOpeningDeal() {') + 1600);
  ok(/if \(window\.BattleLoading && window\.BattleLoading\.active\(\)\) \{/.test(f),
    'the opening deal is DEFERRED while the cover is up');
  ok(/window\._btlAfterLoad = function \(\) \{/.test(f) && /window\._btlAfterLoad = null;/.test(f),
    '…and runs once when it clears, clearing its own hook so a rematch cannot double-fire it');
  ok(/the 1800ms class removal would\n\s*strip it before the screen lifted/.test(f),
    'the note records the real failure this avoids: the class would be removed before the animation was ever visible');
  ok(/prefers-reduced-motion/.test(f), 'reduced motion still opts out entirely, as before');
}

/* ── the board's own milestones drive the bar ─────────────────────────────── */
ok(/window\.BattleLoading\.set\('stage', 1, 'Field raised/.test(SRC),
  'board:ready completes the STAGE step — the largest non-settle weight, because its bakes are the biggest real cost');
ok(/window\.BattleLoading\.set\('reveal', 0\.6, 'Pulling back…'\)/.test(SRC) && /set\('reveal', 1, 'Steadying the view…'\); \} catch \(e2\) \{\}\n\s*\}, 900\);/.test(SRC),
  'the camera pull-back completes on a 900ms timer — the ONE step that is honestly a fixed duration, because it is an animation we own rather than work whose cost depends on the machine');
ok(/If REVEAL\.DUR ever changes, this number moves with it/.test(SRC),
  '…and that coupling is written down, exactly as the opening-deal delays already require');

/* ── run the weighting for real ───────────────────────────────────────────── */
{
  const W = { state: 0.15, stage: 0.35, reveal: 0.20, settle: 0.30 };
  const total = Object.keys(W).reduce((a, k) => a + W[k], 0);
  ok(Math.abs(total - 1) < 1e-9, 'run for real: the weights sum to exactly 1, so the bar can reach 100%', String(total));
  const bar = (p) => Math.round(Object.keys(W).reduce((a, k) => a + Math.max(0, Math.min(1, p[k] || 0)) * W[k], 0) * 100);
  ok(bar({}) === 0, 'run for real: nothing done is 0%');
  ok(bar({ state: 1 }) === 15, 'run for real: hands dealt alone is 15%');
  ok(bar({ state: 1, stage: 1 }) === 50, 'run for real: …plus the board is half way');
  ok(bar({ state: 1, stage: 1, reveal: 1 }) === 70, 'run for real: …plus the camera is 70%');
  ok(bar({ state: 1, stage: 1, reveal: 1, settle: 1 }) === 100, 'run for real: everything done is FULL — the owner\'s "move to the full of the game starting"');
  ok(bar({ state: 1, stage: 1, reveal: 1, settle: 0.5 }) === 85,
    'run for real: a machine still stuttering sits at 85% and does NOT claim to be ready — the whole point of tracking real work');
  ok(bar({ state: 5, stage: -3 }) === 15, 'run for real: a nonsense report is clamped rather than blowing the bar past 100%');
  /* the settle detector */
  const SETTLE_FRAMES = 8, SETTLE_MS = 40;
  const run = (deltas) => { let sm = 0; for (const d of deltas) { if (d < SETTLE_MS) sm++; else sm = 0; } return sm; };
  ok(run([16, 16, 16, 16, 16, 16, 16, 16]) >= SETTLE_FRAMES, 'run for real: eight smooth frames settles');
  ok(run([16, 16, 16, 120, 16, 16]) === 2, 'run for real: a stutter RESETS the streak — it does not merely pause it');
  ok(run([200, 180, 90]) === 0, 'run for real: a sustained stall never settles, and the 12s ceiling is what ends it');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 139, 'BUILD_VERSION is v121v139 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
