/* 🎮 BATTLE SCREEN PERF — the hidden DOM board idles, one post per sky change.

   The owner: "fix the game slowing up and lagging during the day time changing
   in battles" / "make the performance of the game better and smoother".
   While the 3D stage is the board, the DOM board underneath is visibility:hidden
   — but hidden is not idle: its idle bobs, marker bobs, fog roll and light
   sweep kept ticking on the compositor, each unit on its own will-change layer,
   and the sprite ticker kept flipping .is-on across every hidden stack. And a
   host day→night change re-pushed the LOCATION as well as the sky, so the stage
   ran a full ground + backdrop cross-fade on top of its light lerp.

   Defends, from the source text and by evaluating the mount tick in a sandbox:
     · the stage stylesheet pauses every animation under .board-area.bb-on .board
       and releases the will-change layers;
     · the sprite ticker skips stacks inside the hidden board, and only there;
     · _bbStagePost carries the __bbPostCount seam;
     · the mount tick's key branch, run against a fake _BBS: a timeOfDay-only
       change posts exactly ONE board:timeOfDay, no location, no init, no defs;
       a location change still pushes the location AND re-asserts the sky;
     · nothing in the key branch can reach _bbStagePost('init' / 'defs'.
   Round 5 (the stage's ~300 per-frame flame gradients were a third of the GPU
   frame): drawFlames blits each puff from a once-baked atlas (one cell per ramp
   colour, globalAlpha = the puff's alpha) with the gradient path kept as the
   no-canvas fallback and a one-flag counterfactual, run in a sandbox; vista's
   readback worker carries a watchdog — a read past RB_TIMEOUT_MS rejects
   (postRead re-asks, captureGround drops its pend), two hung reads in a row
   retire the worker, a hidden document does not count.
   Round 6 (the two remaining per-frame passes of a parked board — 219 clip()
   masks and ~30 stone ops per boulder): clipBehindTerrain clips ONCE per actor
   when a separating-axis test shows no cut piece of one slab overlaps a piece
   of another (the per-slab loop kept verbatim for the terrace case and as the
   counterfactual); dressing bakes each boulder's body into a per-rock sprite
   keyed on the quantised light rig + scale, with a per-frame re-bake budget,
   the live painter as the fallback and a one-flag counterfactual.
   Live numbers (getAnimations, rAF, longtasks, post counts) come from
   .gauntlet/sprites/sprites-2026-09-05/r1/battle-screen-perf/measure-host.mjs.

   Run: node _battleperf_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');

/* balanced-brace body of `function <name>(` */
function fnBody(name) {
  const m = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(SRC); if (!m) return null;
  let d = 0; for (let k = m.index + m[0].length - 1; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(m.index, k + 1); } }
  return null;
}

/* ── 1. the pause/hide rule lives in the stage stylesheet ── */
const STYLE = fnBody('_bbStageEnsureStyle');
ok(!!STYLE, '_bbStageEnsureStyle exists');
const hideRule = STYLE && /\.board-area\.bb-on \.board\{visibility:hidden!important;pointer-events:none!important;\}/.test(STYLE);
ok(hideRule, 'the DOM board under the stage is still visibility:hidden + pointer-events:none (not removed)');
const pauseRule = STYLE && /\.board-area\.bb-on \.board,\s*\.board-area\.bb-on \.board \*,\s*\.board-area\.bb-on \.board \*::before,\s*\.board-area\.bb-on \.board \*::after\{[^}]*animation-play-state:paused!important[^}]*\}/.exec(STYLE);
ok(!!pauseRule, '.board, every descendant AND their ::before / ::after under .board-area.bb-on get animation-play-state: paused !important');
/* round 2: the surface sheens / ripples / glints are keyframes on pseudo-elements — `*` never matches a pseudo and play-state is not inherited */
ok(/\.surf-oil::before \{[\s\S]{0,400}animation: surfSheen/.test(SRC), 'a surface sheen is a keyframe on a ::before (the case the pseudo halves exist for)');
ok(pauseRule && /will-change:auto!important/.test(pauseRule[0]), 'the same rule releases the will-change GPU layers');
ok(STYLE && !/\.board-area\.bb-on[^{]*\{[^}]*content-visibility/.test(STYLE), 'no content-visibility on the hidden board (tile rects must stay measurable for the hover menu / VFX)');
ok(STYLE && !/\.board-area\.bb-on \.board\{[^}]*display:none/.test(STYLE), 'the board is not display:none (spectator/replay and the stage-off fallback need its DOM)');
ok(STYLE && /\.board-area\.bb-on canvas\.wx-canvas, \.board-area\.bb-on \.wx-tint\{ visibility:visible!important; \}/.test(STYLE), 'weather VFX visibility override survives');
/* the visible-board idle keyframe is untouched — pausing is scoped to bb-on only */
ok(/@keyframes unit-idle-breathe \{/.test(SRC), '@keyframes unit-idle-breathe still exists for the visible board');
ok(!/\.unit \.unit-icon \.sprite-stack \{[^}]*animation-play-state/.test(SRC), 'the base .sprite-stack rule is not paused (stage-off board still breathes)');

/* ── 2. the sprite ticker leaves the hidden board alone ── */
const TICK = fnBody('startSpriteTicker');
ok(!!TICK, 'startSpriteTicker exists');
ok(TICK && /_bbHiddenBoard = \(typeof _bbStageOn === 'function' && _bbStageOn\(\)\) \? document\.querySelector\('\.board-area\.bb-on \.board'\) : null/.test(TICK), 'the ticker resolves the hidden board once per tick, only while the stage is on');
ok(TICK && /if \(_bbHiddenBoard && _bbHiddenBoard\.contains\(stack\)\) continue;/.test(TICK), 'stacks inside the hidden board are skipped');
ok(TICK && TICK.indexOf('_bbHiddenBoard.contains(stack)) continue;') < TICK.indexOf('const frames = getSpriteFrames(id, anim);'), 'the skip runs before frame resolution / breathe anchoring (no work for hidden stacks)');
ok(TICK && /idx = Math\.floor\(\(t \+ _spritePhaseOffset\(id\)\) \/ stepMs\) % frames\.length;/.test(TICK), 'frame index is still derived from the clock, so a skipped stack resumes in phase');
ok(TICK && /legacyEls = document\.querySelectorAll\('img\.sprite-img\[data-sprite-id\]:not\(\.sprite-frame\)'\)/.test(TICK), 'the legacy single-img path is untouched');

/* ── 3. the counter seam ── */
const POST = fnBody('_bbStagePost');
ok(!!POST, '_bbStagePost exists');
ok(POST && /const c = window\.__bbPostCount; if \(c\) c\[type\] = \(c\[type\] \| 0\) \+ 1;/.test(POST), 'window.__bbPostCount tallies posts by type when present');
ok(POST && /postMessage\(Object\.assign\(\{ type:'board:' \+ type \}, detail \|\| \{\}\), window\.location\.origin\)/.test(POST), 'posts still go to the same origin with the board: prefix');

/* ── 4. the mount tick key branch, evaluated ── */
const MOUNT = fnBody('_bbStageMount');
ok(!!MOUNT, '_bbStageMount exists');
const kb = MOUNT && /let key = '';[\s\S]*?_bbStagePost\('timeOfDay', \{ key: parts\[1\] \}\);\s*\}/.exec(MOUNT);
ok(!!kb, 'the location|timeOfDay key branch is present');
ok(kb && /const prevParts = String\(_BBS\.key \|\| ''\)\.split\('\|'\);/.test(kb[0]), 'the previous key is split before it is overwritten');
ok(kb && /if \(parts\[0\] !== prevParts\[0\]\) _bbStagePushLocation\(parts\[0\]\);/.test(kb[0]), 'the location is pushed only when the location half changed');
ok(kb && !/_bbStagePost\('init'/.test(kb[0]) && !/_bbStagePost\('defs'/.test(kb[0]) && !/_bbStagePushDefs\(true\)/.test(kb[0]), "the key branch never reaches _bbStagePost('init' / 'defs'");
/* the ready handler still owns init, and it runs exactly once per ready */
ok(MOUNT && (MOUNT.match(/_bbStagePost\('init', _bbStagePayload\(\)\)/g) || []).length === 1, "board:init is posted from the board:ready handler only (one site)");
ok(MOUNT && MOUNT.indexOf("_BBS.key = _bbActiveLocationId() + '|' + _bbTimeOfDay();") < MOUNT.indexOf("_bbStagePost('init'"), 'ready seeds _BBS.key before init so the first tick does not double-post');
/* every _bbStagePush* call in the ready-tick stays (merge-hybrid) */
for (const n of ['Units', 'Defs', 'Paint', 'Tele', 'Tombs', 'Structs', 'CPs', 'Surfaces', 'Facedown'])
  ok(MOUNT && new RegExp('_bbStagePush' + n + '\\(').test(MOUNT), '_bbStagePush' + n + ' still runs on the mount tick');

function runKeyBranch(prevKey, loc, tod) {
  const posts = [];
  const ctx = {
    _BBS: { key: prevKey },
    _bbActiveLocationId: () => loc,
    _bbTimeOfDay: () => tod,
    _bbStagePushLocation: (id) => posts.push('location:' + id),
    _bbStagePost: (t, d) => posts.push(t + ':' + ((d && d.key) || '')),
  };
  vm.runInNewContext('(function(){' + kb[0] + '})()', ctx);
  return { posts, key: ctx._BBS.key };
}
if (kb) {
  const a = runKeyBranch('battlefield|day', 'battlefield', 'night');
  ok(a.posts.length === 1 && a.posts[0] === 'timeOfDay:night', 'day→night, same location: exactly one board:timeOfDay post', JSON.stringify(a.posts));
  ok(a.key === 'battlefield|night', 'the key is advanced');
  const b = runKeyBranch('battlefield|night', 'battlefield', 'night');
  ok(b.posts.length === 0, 'unchanged key: no post at all (the tick runs every frame)', JSON.stringify(b.posts));
  const c = runKeyBranch('battlefield|day', 'dark-forest', 'day');
  ok(c.posts.join(',') === 'location:dark-forest,timeOfDay:day', 'location change: location pushed, then the sky re-asserted after it (host wins over a location\'s own sky)', JSON.stringify(c.posts));
  const d = runKeyBranch('', 'battlefield', 'day');
  ok(d.posts.join(',') === 'location:battlefield,timeOfDay:day', 'first tick with no key: both halves go', JSON.stringify(d.posts));
  const e = runKeyBranch('battlefield|day', 'dark-forest', 'dusk');
  ok(e.posts.join(',') === 'location:dark-forest,timeOfDay:dusk', 'both halves change: both go, location first', JSON.stringify(e.posts));
  ok(!a.posts.some(p => /^(init|defs)/.test(p)) && !c.posts.some(p => /^(init|defs)/.test(p)), 'no init/defs post in any scenario');
}

/* ── 5. the live harness exists and measures the right things ── */
let H = ''; try { H = readFileSync('./.gauntlet/sprites/sprites-2026-09-05/r1/battle-screen-perf/measure-host.mjs', 'utf8'); } catch (e) {}
ok(!!H, 'measure-host.mjs harness present');
ok(H && /document\.getAnimations/.test(H) && /getBoundingClientRect/.test(H) && /longtask/.test(H), 'harness measures getAnimations, layout reads and longtasks');
let H2 = ''; try { H2 = readFileSync('./.gauntlet/sprites/sprites-2026-09-05/r2/battle-screen-perf/measure-host.mjs', 'utf8'); } catch (e) {}
ok(H2 && /channel: 'chrome'/.test(H2) && /type: 'longtask', buffered: true/.test(H2) && /battle-board/.test(H2), 'round-2 harness: system Chrome (real GPU) and a buffered longtask observer in the host AND the stage frame');

/* ── 6. round 2: the white guard's GPU readback is cost-aware and holds during a sky change ──
   On a real GPU the guard's drawImage + getImageData of the stage's board canvas
   was a 52–100 ms pipeline sync every 400 ms — half the long tasks on the host.
   With the stage's rAF stopped the host runs at vsync, so this was the host's
   own share of the lag, and it is gone. */
const WG = (() => { const i = SRC.indexOf('window.__mg._wgTick = function () {'); const j = SRC.indexOf('window.__mg.wxOff = function', i); return i > 0 && j > i ? SRC.slice(i, j) : null; })();
ok(!!WG, '_wgTick source located');
ok(/window\.__mg\._wg = \{ on: true,[\s\S]{0,400}cost: \{\}, due: \{\}, since: \{\}, holdUntil: 0, skipped: 0,[\s\S]{0,200}posted: null, postedUsed: 0, stageSeen: 0 \};/.test(SRC), '_wg state carries cost / due / since / holdUntil / skipped (+ r3: posted / postedUsed / stageSeen)');
ok(/window\.__mg\._wgHold = function \(ms\) \{[\s\S]{0,300}wg\.holdUntil = Math\.max\(wg\.holdUntil \|\| 0, performance\.now\(\) \+ \(ms \| 0\)\)/.test(SRC), '__mg._wgHold(ms) extends holdUntil (never shortens it)');
ok(WG && /const held = nowMs < \(wg\.holdUntil \|\| 0\);/.test(WG), 'the tick reads the hold once per tick');
ok(WG && /if \(held && cost > 8\) \{ wg\.skipped\+\+; continue; \}/.test(WG), 'a costly layer (> 8 ms) is skipped while held; cheap ones still sample');
ok(WG && /if \(nowMs < \(wg\.due\[c\.key\] \|\| 0\)\) \{ wg\.skipped\+\+; continue; \}/.test(WG), 'a layer is skipped until its due clock');
ok(WG && /wg\.due\[c\.key\] = ms > 8 \? nowMs \+ Math\.min\(12000, Math\.max\(2000, ms \* 100\)\) : 0;/.test(WG), 'due = 100x the measured cost, clamped 2-12 s; a cheap layer keeps the 400 ms cadence');
ok(WG && WG.indexOf('smp = window.__mg._sampleCanvas(c.el);') > WG.indexOf('const nowMs = performance.now();'), 'the readback runs after the cadence checks');
ok(WG && /const sustained = wg\.strikes\[c\.key\] >= 7\s*\|\| \(wg\.strikes\[c\.key\] >= 2 && nowMs - \(wg\.since\[c\.key\] \|\| nowMs\) >= 2800\);/.test(WG), 'mute rule: 7 strikes OR >= 2 strikes spanning >= 2.8 s (a rarely-sampled layer is still caught)');
ok(WG && /if \(sustained && !wg\.muted\[c\.key\]\) \{/.test(WG), 'the mute branch keys on sustained');
ok(WG && /wg\.strikes\[c\.key\] = 0; wg\.since\[c\.key\] = 0;/.test(WG), 'a clean sample resets the strike clock');
ok(WG && /setInterval\(\(\) => \{ try \{ window\.__mg\._wgTick\(\); \} catch \(e\) \{\} \}, 400\)/.test(WG), 'the guard still ticks every 400 ms (cover log + CSS scan stay live)');
ok(/window\.__mg\._wgScratch \|\| \(window\.__mg\._wgScratch = /.test(SRC), '_sampleCanvas reuses one 48x48 scratch canvas instead of allocating one per sample');
const POSTFN = fnBody('_bbStagePost');
ok(!!POSTFN, '_bbStagePost exists');
ok(POSTFN && /if \(type === 'timeOfDay' \|\| type === 'location' \|\| type === 'init'\) \{ const h = window\.__mg && window\.__mg\._wgHold; if \(h\) h\(6000\); \}/.test(POSTFN), '_bbStagePost holds the guard 6 s on timeOfDay / location / init');
ok(POSTFN && POSTFN.indexOf('_wgHold') < POSTFN.indexOf('postMessage'), 'the hold is set before the message goes out');
ok(POSTFN && /__bbPostCount/.test(POSTFN), 'the __bbPostCount seam survives');
/* run _bbStagePost for real */
if (POSTFN) {
  const sent = [], holds = [];
  const ctx = { _BBS: { frame: { contentWindow: { postMessage: (m) => sent.push(m.type) } } }, window: { __mg: { _wgHold: (ms) => holds.push(ms) }, location: { origin: 'http://x' } } };
  vm.runInNewContext(POSTFN + '; _bbStagePost("timeOfDay", {key:"night"}); _bbStagePost("units", {}); _bbStagePost("paint", {}); _bbStagePost("location", {}); _bbStagePost("init", {}); _bbStagePost("defs", {});', ctx);
  ok(sent.join(',') === 'board:timeOfDay,board:units,board:paint,board:location,board:init,board:defs', 'every post still reaches the stage', sent.join(','));
  ok(holds.length === 3 && holds.every(h => h === 6000), 'exactly the sky / location / init posts hold the guard (6000 ms each); units / paint / defs do not', JSON.stringify(holds));
  const ctx2 = { _BBS: { frame: { contentWindow: { postMessage: () => {} } } }, window: { location: { origin: 'http://x' } } };
  let threw = false; try { vm.runInNewContext(POSTFN + '; _bbStagePost("timeOfDay", {});', ctx2); } catch (e) { threw = true; }
  ok(!threw, 'no __mg (guard not loaded yet): the post still goes, nothing throws');
}
/* run the cadence loop for real: extract from the nowMs line to the due line, close the loop */
const DUE_LINE = 'wg.due[c.key] = ms > 8 ? nowMs + Math.min(12000, Math.max(2000, ms * 100)) : 0;';
const LOOP = WG && (() => { const i = WG.indexOf('    const nowMs = performance.now();'); const j = WG.indexOf(DUE_LINE, i); return i > 0 && j > i ? WG.slice(i, j + DUE_LINE.length) : null; })();
ok(!!LOOP, 'cadence loop extracted');
function runLoop(wg, cands, costs, now, fromStage) {
  let clock = now; const out = [];
  const ctx = { wg, cands, out, performance: { now: () => clock }, window: { __mg: { _sampleCanvas: (el) => { clock += costs[el]; return { washPct: 0 }; }, _wgFromStage: fromStage || (() => null) } } };
  /* r3: the loop opens an `if (!smp) {` around the readback — close it too */
  vm.runInNewContext('(function(){' + LOOP + ' out.push({ key: c.key, ms }); } } })()', ctx);
  return out;
}
if (LOOP) {
  const wg = { cost: {}, due: {}, holdUntil: 0, skipped: 0 };
  const cands = [{ key: 'iframe|stage', el: 'stage' }, { key: 'page|fx', el: 'fx' }];
  let r = runLoop(wg, cands, { stage: 60, fx: 0.2 }, 1000);
  ok(r.length === 2, 'first tick: every layer is sampled once (cost unknown)', JSON.stringify(r));
  ok(wg.cost['iframe|stage'] === 60 && wg.due['iframe|stage'] === 1000 + 6000, 'a 60 ms readback is next due in 6 s (100x cost)', JSON.stringify(wg));
  ok(wg.due['page|fx'] === 0, 'a 0.2 ms readback keeps the 400 ms cadence (due 0)');
  r = runLoop(wg, cands, { stage: 60, fx: 0.2 }, 1400);
  ok(r.length === 1 && r[0].key === 'page|fx' && wg.skipped === 1, 'next tick: the costly layer is skipped, the cheap one sampled', JSON.stringify(r));
  r = runLoop(wg, cands, { stage: 100, fx: 0.2 }, 7100);
  ok(r.length === 2 && wg.cost['iframe|stage'] === 80 && wg.due['iframe|stage'] === 7100 + 10000, 'after its due clock the costly layer is sampled again; cost is an EMA (60,100 -> 80), due 10 s', JSON.stringify(wg));
  wg.holdUntil = 30000; wg.due['iframe|stage'] = 0;
  r = runLoop(wg, cands, { stage: 60, fx: 0.2 }, 20000);
  ok(r.length === 1 && r[0].key === 'page|fx', 'held (a sky change in flight): the costly layer waits even when due; the cheap one still samples', JSON.stringify(r));
  const wg2 = { cost: {}, due: {}, holdUntil: 30000, skipped: 0 };
  r = runLoop(wg2, cands, { stage: 200, fx: 0.2 }, 20000);
  ok(r.length === 2 && wg2.due['iframe|stage'] === 20000 + 12000, 'a never-measured layer samples once even while held, and a 200 ms cost clamps to the 12 s ceiling', JSON.stringify(wg2));
  const wg3 = { cost: { 'iframe|stage': 9 }, due: {}, holdUntil: 0, skipped: 0 };
  r = runLoop(wg3, cands, { stage: 1, fx: 0.2 }, 100);
  ok(r.length === 2 && wg3.due['iframe|stage'] === 0, 'a layer that became cheap (1 ms) is sampled and its due clock returns to 0', JSON.stringify(r));
}
/* the mute rule, evaluated */
const SUS = WG && /const sustained = ([^;]+);/.exec(WG);
if (SUS) {
  const sus = (strikes, since, nowMs) => vm.runInNewContext(SUS[1], { wg: { strikes: { k: strikes }, since: { k: since } }, c: { key: 'k' }, nowMs });
  ok(sus(7, 0, 2400) === true, '7 strikes -> sustained (unchanged 400 ms path)');
  ok(sus(6, 0, 2400) === false, '6 strikes at 2.4 s -> not yet');
  ok(sus(2, 1000, 3800) === true, '2 strikes 2.8 s apart -> sustained (a 6 s-cadence layer is caught on its second strike)');
  ok(sus(2, 1000, 3000) === false, '2 strikes 2 s apart -> not yet');
  ok(sus(1, 0, 9000) === false, 'one strike, however old, never mutes');
}

/* ── 7. round 3: the stage reports its own wash; the guard never reads the GPU canvas back for it ──
   Even cost-aware, one readback of the stage canvas every 2–12 s was still a 50–60 ms
   task on the RTX 5060 Ti (before-gpu: a 59 ms `window` task in 5 s idle). The vista
   already reads the frame back at quarter scale for its veil map (postMap); the wash
   is now computed on THAT buffer (washOf), the board posts it every 400 ms
   (board:wash), the host keeps it (__mg._wgTake) and the guard answers the stage
   canvas from it (__mg._wgFromStage) — its readback path stays for every other layer
   and as the fallback when no report is fresh. */
const VISTA = readFileSync('./public/src/battle/stage/vista.js', 'utf8').replace(/\r\n/g, '\n');
const BOARD = readFileSync('./public/battle-board/index.html', 'utf8');
ok(/const WASH_STRIDE = 7;/.test(VISTA), 'vista: WASH_STRIDE declared (a sparse pass, not a per-pixel one)');
const WASHOF = (() => { const m = /  function washOf\(d, n, stride\) \{[\s\S]*?\n  \}\n/.exec(VISTA); return m ? m[0] : null; })();
ok(!!WASHOF, 'vista: washOf(d, n, stride) exists');
ok(/if \(!rd\) \{\s*try \{ im = gt\.getImageData\(0, 0, bw, bh\); \}\s*catch \(e\) \{ S\.post\.fail = true; return null; \}\s*\}\s*const d = rd \? rd\.d : im\.data;\s*\/\*[\s\S]{0,300}\*\/\s*try \{ const w = washOf\(d, bw \* bh, WASH_STRIDE\); w\.t = \(rd && rd\.t0\) \|\| _t0 \|\| Date\.now\(\); S\.post\.wash = w; window\.__vistaWash = w; \} catch \(e\) \{\}/.test(VISTA), 'vista: the wash is computed on postMap\'s own buffer — the worker read when there is one, the synchronous getImageData otherwise — never a second readback, and published on window.__vistaWash stamped with the time the frame was taken');
ok((VISTA.match(/getImageData\(/g) || []).length === (VISTA.match(/getImageData\(/g) || []).length && !/washOf\([^)]*getImageData/.test(VISTA), 'vista: washOf takes pixel data, never a canvas (it cannot read back)');
if (WASHOF) {
  const wash = (px, stride) => vm.runInNewContext(WASHOF + '; washOf(d, n, ' + (stride || 1) + ')', { d: Uint8ClampedArray.from(px.flat()), n: px.length });
  const W = [255, 255, 255, 255], K = [0, 0, 0, 255], H = [255, 255, 255, 128], M = [200, 200, 200, 255], T = [255, 255, 255, 0];
  ok(wash([W, W, W, W]).washPct === 100 && wash([W, W, W, W]).whitePct === 100, 'washOf: an opaque white frame is 100% wash / 100% white');
  ok(wash([K, K, K, K]).washPct === 0 && wash([K, K, K, K]).avgLuma === 0, 'washOf: an opaque black frame is 0% wash');
  const h = wash([H, H, H, H]);
  ok(h.washPct > 49 && h.washPct < 51 && h.whitePct === 0, 'washOf: half-alpha white is ~50% wash and 0% strict white (the alpha-weighted metric the guard trusts)', JSON.stringify(h));
  ok(wash([T, T, T, T]).washPct === 0 && wash([T, T, T, T]).avgAlpha === 0, 'washOf: transparent white is 0% wash');
  const m = wash([M, M, M, M]);
  ok(m.washPct > 47 && m.washPct < 48 && m.whitePct === 0, 'washOf: rgb(200) is 47.6% wash (150→0, 255→1 lightness ramp, same as __mg._sampleCanvas)', JSON.stringify(m));
  ok(wash([W, K, W, K]).washPct === 50 && wash([W, K, W, K], 2).washPct === 100 && wash([W, K, W, K], 2).n === 2, 'washOf: the stride skips pixels (stride 2 over W,K,W,K sees only the whites) and n counts what it saw');
  ok(wash([W, W], 7).n === 1 && wash([W, W], 0).n === 2, 'washOf: a stride past the end still samples pixel 0; stride 0 is clamped to 1');
}
/* the board posts it on a cadence */
const WT = (() => { const i = BOARD.indexOf('const WASH = { every: 400, lastPost: 0, sent: 0 };'); const j = BOARD.indexOf("setInterval(() => { try { washTick(); } catch (e) {} }, WASH.every);", i); return i > 0 && j > i ? BOARD.slice(i, j) : null; })();
ok(!!WT, 'board: WASH state + washTick located, ticked by setInterval every WASH.every ms');
ok(WT && /post\('wash', \{ canvas: 'stage', washPct: w\.washPct, whitePct: w\.whitePct, avgLuma: w\.avgLuma, avgAlpha: w\.avgAlpha, at: w\.t \}\);/.test(WT), 'board: posts board:wash with the canvas id, the four metrics and the readback time');
ok(/<canvas id="stage"><\/canvas>/.test(BOARD), 'board: the main canvas is #stage (the id the report names)');
if (WT) {
  const run = (embedded, washes, times) => { const posts = [], r = [], now = { v: 0 };
    const ctx = { EMBEDDED: embedded, window: {}, performance: { now: () => now.v }, post: (t, d) => posts.push(d.washPct + '@' + d.at), washes, times, r, now };
    vm.runInNewContext(WT + '; for (let k = 0; k < times.length; k++) { now.v = times[k]; window.__vistaWash = washes[k]; r.push(washTick()); }', ctx);
    return { posts, r, sent: vm.runInNewContext('WASH.sent', ctx) }; };
  const a = run(true, [{ washPct: 1, t: 10 }, { washPct: 2, t: 20 }, { washPct: 3, t: 30 }, { washPct: 3, t: 30 }], [1000, 1300, 1400, 1800]);
  ok(a.posts.join(',') === '1@10,3@30,3@30' && a.sent === 3, 'washTick: posts at t=1000, not at +300 (throttled), again at +400 and +800 — an unchanged value is re-sent so the host\'s freshness clock keeps running', a.posts.join(','));
  const b = run(true, [null, undefined], [1000, 1400]);
  ok(b.posts.length === 0 && b.r.every(x => x === false), 'washTick: nothing published (vista off) → nothing posted');
  const c = run(false, [{ washPct: 9, t: 1 }], [1000]);
  ok(c.posts.length === 0, 'washTick: a standalone (not embedded) board never posts');
}
/* the host takes it */
const TAKE = (() => { const i = SRC.indexOf('  window.__mg._wgTake = function (d) {'); const j = SRC.indexOf('  window.__mg.whiteGuard = function (v) {', i); return i > 0 && j > i ? SRC.slice(i, j) : null; })();
ok(!!TAKE, 'host: __mg._wgTake and __mg._wgFromStage located');
ok(/if \(d\.type === 'board:wash'\) \{ try \{ const t = window\.__mg && window\.__mg\._wgTake; if \(t\) t\(d\); \} catch \(e3\) \{\} return; \}/.test(SRC), 'host: the stage message handler routes board:wash to __mg._wgTake (and nothing else) — inside the e.source === _BBS.frame.contentWindow gate');
ok(SRC.indexOf("if (d.type === 'board:wash')") > SRC.indexOf('if (!_BBS.frame || e.source !== _BBS.frame.contentWindow) return;') && SRC.indexOf("if (d.type === 'board:wash')") < SRC.indexOf("if (d.type !== 'board:ready') return;"), 'host: the board:wash branch sits after the source gate and before the ready handler');
ok(TAKE && /if \(!c \|\| !c\.el \|\| String\(c\.el\.id \|\| ''\) !== \(p \? p\.canvas : 'stage'\)\) return null;\s*const fd = window\.__mg\._wgStageDoc\(\);\s*if \(!fd \|\| c\.el\.ownerDocument !== fd\) return null;/.test(TAKE), 'host: only the canvas named by the report AND living in the stage iframe\'s document is answered from it (the stage iframe has no id — matched by document identity)');
ok(TAKE && /document\.querySelectorAll\('#bb-stage-host iframe\.bb-stage'\)/.test(TAKE) && !/window\._BBS|[^ ]_BBS\./.test(TAKE), 'host: the stage iframe is found through the DOM (#bb-stage-host iframe.bb-stage) — _BBS is a top-level const the guard cannot see (the r3 harness\'s seeded.stageReady=false is that same invisibility)');
ok(/const f = document\.createElement\('iframe'\);\s*f\.className = 'bb-stage';/.test(SRC) && /_BBS\.frame = f; _BBS\.host = host;/.test(SRC) && /host\.appendChild\(f\)/.test(SRC) && /^const _BBS = \{/m.test(SRC), 'the stage iframe is created with class bb-stage (no id) under #bb-stage-host; _BBS is a top-level const');
ok(TAKE && /if \(nowMs - p\.recv > 2500\) return null;/.test(TAKE), 'host: a report older than 2.5 s is not used (the guard reads back instead)');
ok(WG && /const posted = window\.__mg\._wgFromStage\(c, nowMs\);\s*if \(posted && posted\.pending\) \{ wg\.skipped\+\+; continue; \}[^\n]*\n\s*let smp = posted;\s*if \(!smp\) \{/.test(WG), 'guard loop: the stage report is consulted first; a pending one (boot grace) skips the layer; the cost-aware readback runs only without one');
ok(/window\.__mg\.WG_STAGE_GRACE = 3000;/.test(SRC) && TAKE && /if \(!p\) \{\s*if \(!wg\.stageSeen\) wg\.stageSeen = nowMs;\s*return \(nowMs - wg\.stageSeen < window\.__mg\.WG_STAGE_GRACE\) \? \{ pending: true \} : null;\s*\}/.test(TAKE), 'host: with no report yet the stage canvas is pending for WG_STAGE_GRACE (3 s) from the first sighting, then falls back to the readback');
ok(WG && WG.indexOf('const posted = window.__mg._wgFromStage(c, nowMs);') < WG.indexOf('smp = window.__mg._sampleCanvas(c.el);'), 'guard loop: report before readback');
ok(WG && /const eff = smp\.washPct \* c\.op;/.test(WG) && /if \(eff >= 45\) \{/.test(WG), 'guard loop: the strike / mute rule is unchanged and runs on whichever sample was used');
if (TAKE) {
  const DOC = { stage: 1 }, OTHER = { other: 1 };
  const mk = (now, frames) => { const list = frames === undefined ? [{ contentDocument: DOC }] : frames; const ctx = { performance: { now: () => now.v }, document: { querySelectorAll: (sel) => sel === '#bb-stage-host iframe.bb-stage' ? list : [] }, window: { __mg: { _wg: { posted: null, postedUsed: 0 } } } }; vm.runInNewContext(TAKE, ctx); return ctx.window.__mg; };
  const now = { v: 1000 }; const mg = mk(now);
  ok(mg._wgTake({ type: 'board:wash', canvas: 'stage', washPct: 12.5, whitePct: 1, avgLuma: 90, avgAlpha: 255, at: 990 }) === true && mg._wg.posted.washPct === 12.5 && mg._wg.posted.recv === 1000, '_wgTake stores the report with its arrival time');
  ok(mg._wgTake({ type: 'board:wash' }) === false && mg._wg.posted.washPct === 12.5, '_wgTake ignores a report without a numeric washPct (keeps the last good one)');
  const stage = { where: 'iframe#?', el: { id: 'stage', ownerDocument: DOC }, key: 'iframe#?|stage', op: 1 };
  now.v = 1400; const s1 = mg._wgFromStage(stage, now.v);
  ok(s1 && s1.fromStage === true && s1.washPct === 12.5 && s1.allZero === false && mg._wg.postedUsed === 1, 'a 400 ms-old report answers for the stage canvas (fromStage, never allZero)', JSON.stringify(s1));
  ok(mg._wgFromStage({ where: 'iframe#?', el: { id: 'stage', ownerDocument: OTHER } }, now.v) === null, 'another iframe\'s canvas (even one called #stage) is not answered from the report');
  ok(mg._wgFromStage({ where: 'iframe#?', el: { id: 'fx', ownerDocument: DOC } }, now.v) === null, 'another canvas in the stage frame is not answered from the report');
  ok(mg._wgFromStage({ where: 'page', el: { id: 'stage', ownerDocument: OTHER } }, now.v) === null, 'a page canvas is not answered from the report');
  { const mg3 = mk({ v: 1 }, []); mg3._wgTake({ washPct: 1 }); ok(mg3._wgFromStage(stage, 1) === null, 'no stage iframe in the DOM (stage torn down) → null, nothing throws'); }
  { const mg4 = mk({ v: 1 }, [{ get contentDocument() { throw new Error('cross-origin'); } }]); mg4._wgTake({ washPct: 1 }); ok(mg4._wgFromStage(stage, 1) === null, 'a frame whose document cannot be read → null, nothing throws'); }
  { const mg5 = mk({ v: 1 }, [{ contentDocument: null }, { contentDocument: DOC }]); mg5._wgTake({ washPct: 1 }); ok(mg5._wgFromStage(stage, 1) !== null, 'two stage iframes (one unloaded): the loaded one\'s document is matched'); }
  ok(mg._wgFromStage(stage, 1000 + 2600) === null && mg._wg.postedUsed === 1, 'a 2.6 s-old report is stale → null (readback fallback)');
  ok(mg._wgFromStage(stage, 1000 + 2400) !== null, 'a 2.4 s-old report is still fresh');
  const mg2 = mk({ v: 5 }); const g0 = mg2._wgFromStage(stage, 5);
  ok(g0 && g0.pending === true && mg2._wg.stageSeen === 5, 'no report yet, stage just seen → pending (no readback), stageSeen recorded', JSON.stringify(g0));
  ok(mg2._wgFromStage(stage, 5 + 2999).pending === true, 'still pending at +2.999 s');
  ok(mg2._wgFromStage(stage, 5 + 3000) === null, 'at +3 s with still no report → null (the readback fallback)');
  ok(mg2._wgFromStage({ where: 'page', el: { id: 'stage', ownerDocument: OTHER } }, 5) === null, 'a non-stage canvas is never pending');
  ok(mg2._wg.postedUsed === 0, 'a pending answer is not counted as a used report');
}
/* the loop, with a fresh report: the stage canvas is scored without a readback and its cost/due clocks are untouched */
if (LOOP) {
  const wg = { cost: {}, due: {}, holdUntil: 0, skipped: 0 };
  const cands = [{ key: 'iframe#?|stage', el: 'stage', where: 'iframe#?' }, { key: 'page|fx', el: 'fx', where: 'page' }];
  const calls = []; const fromStage = (c) => { calls.push(c.key); return c.el === 'stage' ? { washPct: 3, fromStage: true } : null; };
  const r = runLoop(wg, cands, { stage: 60, fx: 0.2 }, 1000, fromStage);
  ok(calls.join(',') === 'iframe#?|stage,page|fx', 'the report is asked for every candidate', calls.join(','));
  ok(r.length === 1 && r[0].key === 'page|fx' && wg.cost['iframe#?|stage'] === undefined && wg.due['iframe#?|stage'] === undefined, 'with a report the stage canvas is NOT read back (no cost / due entry); the page canvas still is', JSON.stringify({ r, wg }));
  const wg2 = { cost: {}, due: {}, holdUntil: 30000, skipped: 0 };
  const r2 = runLoop(wg2, cands, { stage: 60, fx: 0.2 }, 20000, fromStage);
  ok(r2.length === 1 && r2[0].key === 'page|fx', 'held + reported: same — the report costs nothing, so the hold does not skip it', JSON.stringify(r2));
  const wg3 = { cost: {}, due: {}, holdUntil: 0, skipped: 0 };
  const r3 = runLoop(wg3, cands, { stage: 60, fx: 0.2 }, 1000, (c) => c.el === 'stage' ? { pending: true } : null);
  ok(r3.length === 1 && r3[0].key === 'page|fx' && wg3.skipped === 1 && wg3.cost['iframe#?|stage'] === undefined, 'pending (boot grace): the stage canvas is skipped, not read back; the page canvas still samples', JSON.stringify({ r3, wg3 }));
}


/* ── 7. round 4: the stage's steady-state readbacks run on a worker thread ──
   The critic's gap after round 3: every remaining > 50 ms task on the host with the stage ON
   was the stage's own postMap getImageData (every 12 frames) and tilefx's captureGround
   (every 2 s) — pipeline syncs that wait behind two or three frames of queued raster on a
   saturated GPU process (round 4 trace: 48–88 ms each). They now run as
   createImageBitmap(board) → transferred to a Blob worker → OffscreenCanvas
   (willReadFrequently).getImageData there; the main thread pays 0.1 ms per read. The idle
   warm's first terrain band paid three lazy PNG decodes (50 ms task ~4 s after every press):
   the tile paintings become ImageBitmaps once, one per staging task. */
const TILEFX = readFileSync('./public/src/battle/stage/tilefx.js', 'utf8').replace(/\r\n/g, '\n');
const RBI = VISTA.indexOf('  const RB = { ok: null, w: null, seq: 0, inflight: new Map(), reads: 0, fails: 0, ms: [] };');
const RBJ = VISTA.indexOf('  /* ── THE PER-FRAME MAP ─');
const RBBLOCK = RBI > 0 && RBJ > RBI ? VISTA.slice(RBI, RBJ) : null;
ok(!!RBBLOCK, 'vista: the RB block (worker readback) sits before THE PER-FRAME MAP');
ok(RBBLOCK && /const RB_SRC = \[[\s\S]*?\]\.join\('\\n'\);/.test(RBBLOCK), 'vista: the worker source is an inline string (a Blob worker — no new network resource, no CSP surface)');
ok(RBBLOCK && /new OffscreenCanvas\(s\.w, s\.h\)/.test(RBBLOCK) && /getContext\("2d", \{ willReadFrequently: true \}\)/.test(RBBLOCK) && /getImageData\(0, 0, s\.w, s\.h\)\.data\.buffer/.test(RBBLOCK), 'worker: draws into an OffscreenCanvas (willReadFrequently) and getImageData\'s it THERE — the sync lands on the worker thread');
ok(RBBLOCK && /m\.bmp\.close\(\)/.test(RBBLOCK) && /self\.postMessage\(\{ id: m\.id, planes: planes, ms: performance\.now\(\) - t0 \}, planes\)/.test(RBBLOCK), 'worker: closes the bitmap and transfers the planes back (no copy)');
ok(RBBLOCK && /catch \(err\) \{ try \{ m\.bmp\.close\(\); \} catch \(e2\) \{\} self\.postMessage\(\{ id: m\.id, err: String\(err\) \}\); return; \}/.test(RBBLOCK), 'worker: a throw posts { id, err } (the main side rejects) rather than going silent');
ok(RBBLOCK && /if \(off\('worker'\)\) return false;/.test(RBBLOCK), 'vista: __vistaOff.worker = 1 forces the synchronous fallback (one-flag counterfactual)');
ok(RBBLOCK && /typeof Worker !== 'function' \|\| typeof OffscreenCanvas !== 'function' \|\| typeof createImageBitmap !== 'function' \|\|\s*typeof Blob !== 'function' \|\| typeof URL === 'undefined' \|\| typeof URL\.createObjectURL !== 'function'\) return false;/.test(RBBLOCK), 'vista: rbOK feature-detects Worker / OffscreenCanvas / createImageBitmap / Blob / URL.createObjectURL and falls back without any of them');
ok(RBBLOCK && /try \{ bmpP = createImageBitmap\(source\); \} catch \(e\) \{ return null; \}/.test(RBBLOCK) && !/createImageBitmap\([^)]*resize/.test(VISTA), 'vista: createImageBitmap(source) with NO resize options (a resize is a software scale that reads back on the main thread — measured worse)');
ok(RBBLOCK && /RB\.w\.postMessage\(\{ id: id, bmp: bmp, sizes: sizes \}, \[bmp\]\)/.test(RBBLOCK), 'vista: the bitmap is TRANSFERRED to the worker');
ok(RBBLOCK && /if \(!S\.post\.ready && !A\.asked\) return false;/.test(RBBLOCK), 'postRead: the very first map is read synchronously (the opening frames never ship ungraded)');
ok(RBBLOCK && /if \(A\.errs >= 3\) rbDead\(\);/.test(RBBLOCK), 'postRead: three failed reads in a row retire the worker (the sync path takes over)');
const PM = (() => { const m = /  function postMap\(api, bw, bh\) \{[\s\S]*?\n  \}\n/.exec(VISTA); return m ? m[0] : null; })();
ok(!!PM, 'vista: postMap located');
ok(PM && /const rd = postRead\(api, key, bw, bh, tw, th\);\s*if \(rd === null\) return S\.post\.ready \? S\.post : null;\s*S\.post\.key = key; S\.post\.age = 1; S\.post\.reads\+\+;/.test(PM), 'postMap: asks postRead first; while a read is in flight it keeps the map it has (no key / age reset, so the next frame asks again)');
ok(PM && (PM.match(/getImageData\(/g) || []).length === 2 && /if \(!rd\) \{\s*try \{ im = gt\.getImageData/.test(PM) && /const ds = rd \? rd\.ds : gs\.getImageData\(0, 0, tw, th\)\.data;/.test(PM), 'postMap: both main-thread getImageData calls are behind !rd (the worker path never reads back on the main thread)');
ok(PM && /if \(rd \? !!rd\.ds : \(S\.t\.cv && S\.t\.cv\.width === tw && S\.t\.cv\.height === th\)\)/.test(PM), 'postMap: the thumbnail luma comes from plane 1 of the same read (no second read, same box average as S.t off S.q)');
ok(/const tg = scratch\(S\.t, bw, bh, true\);/.test(VISTA) && /const qg = scratch\(S\.q, mw, mh, true\);/.test(VISTA), 'grade: S.q and S.t STAY willReadFrequently (measured: accelerating them cost p95 33.4 → 49.8 — see the comment on the flag)');
ok(/window\.BBX\.readback = \{ ok: rbOK, read: readback, stats: rbStats \};/.test(VISTA), 'vista: window.BBX.readback = { ok, read, stats } (the seam tilefx uses)');
ok(/readback: rbStats\(\),/.test(VISTA), '__vistaDebug reports the readback (worker / reads / fails / inflight / workerMsP50 / map)');
ok(/async: \{ p: null, res: null, asked: 0, stale: 0, errs: 0 \}/.test(VISTA), 'S.post.async state declared');

/* the RB block and postRead, run for real against fake Worker / OffscreenCanvas / createImageBitmap */
if (RBBLOCK) {
  const mk = (opts) => {
    const o = Object.assign({ worker: true, offscreen: true, cib: true, offFlag: false }, opts || {});
    const L = { workers: [], posted: [], urls: 0, timers: [], cleared: [], tn: 0 };
    class FakeWorker { constructor(u) { this.url = u; this.onmessage = null; this.onerror = null; this.terminated = false; L.workers.push(this); }
      postMessage(m, t) { L.posted.push({ m, t }); } terminate() { this.terminated = true; }
      reply(id, planes, ms) { this.onmessage({ data: { id, planes, ms: ms || 5 } }); } fail(id, err) { this.onmessage({ data: { id, err } }); } }
    const ctx = { S: { post: { ready: false, async: { p: null, res: null, asked: 0, stale: 0, errs: 0 } } }, off: (n) => n === 'worker' && o.offFlag,
      performance: { now: () => 100 }, Map, Promise, Uint8ClampedArray, Error, String, console, L,
      Blob: function (parts) { this.parts = parts; }, URL: { createObjectURL: () => { L.urls++; return 'blob:x' + L.urls; } },
      setTimeout: (fn, ms) => { const id = ++L.tn; L.timers.push({ id, fn, ms }); return id; }, clearTimeout: (id) => { L.cleared.push(id); } };
    if (o.hidden !== undefined) ctx.document = { hidden: o.hidden };
    if (o.worker) ctx.Worker = FakeWorker;
    if (o.offscreen) ctx.OffscreenCanvas = function () {};
    if (o.cib) ctx.createImageBitmap = (src) => Promise.resolve({ src, closed: false, close() { this.closed = true; } });
    ctx.window = ctx;
    vm.runInNewContext(RBBLOCK + '\n this.__rb = { rbOK, rbDead, readback, rbStats, postRead, rbTimeout, RB, RB_SRC, RB_TIMEOUT_MS };', ctx);
    return { ctx, L, ...ctx.__rb };
  };
  const tick = () => new Promise(r => setImmediate(r));
  (async () => {
    /* feature detection */
    ok(mk({ worker: false }).rbOK() === false && mk({ offscreen: false }).rbOK() === false && mk({ cib: false }).rbOK() === false, 'rbOK: no Worker / no OffscreenCanvas / no createImageBitmap → false (sync fallback)');
    ok(mk({ offFlag: true }).rbOK() === false, 'rbOK: __vistaOff.worker → false');
    const A = mk();
    ok(A.rbOK() === true && A.L.workers.length === 1 && A.L.urls === 1 && A.rbOK() === true && A.L.workers.length === 1, 'rbOK: one Blob worker, made once, answer cached');
    const src = { tag: 'board' };
    const p1 = A.readback(src, [{ w: 4, h: 3 }, { w: 2, h: 1 }], 'k1');
    ok(p1 && typeof p1.then === 'function' && A.RB.inflight.size === 1, 'readback: returns a promise and records the read in flight');
    await tick();
    const post = A.L.posted[0];
    ok(post && post.m.id === 1 && post.m.bmp && post.m.bmp.src === src && post.t[0] === post.m.bmp && post.m.sizes.length === 2, 'readback: the bitmap of the source is posted with the sizes and TRANSFERRED', JSON.stringify(post && post.m.sizes));
    const buf0 = new Uint8ClampedArray(4 * 3 * 4).fill(7).buffer, buf1 = new Uint8ClampedArray(2 * 1 * 4).fill(9).buffer;
    A.L.workers[0].reply(1, [buf0, buf1], 12);
    const r1 = await p1;
    ok(r1.key === 'k1' && r1.planes.length === 2 && r1.planes[0] instanceof Uint8ClampedArray && r1.planes[0][0] === 7 && r1.planes[1][3] === 9 && r1.workerMs === 12 && A.RB.reads === 1 && A.RB.inflight.size === 0, 'readback: resolves with the planes as Uint8ClampedArray, the key and the worker\'s time', JSON.stringify(r1));
    ok(A.rbStats().workerMsP50 === 12 && A.rbStats().reads === 1 && A.rbStats().worker === true, 'rbStats: reads / worker ms');
    const p2 = A.readback(src, [{ w: 4, h: 3 }], 'k2'); await tick();
    A.L.workers[0].fail(2, 'boom');
    let e2 = null; try { await p2; } catch (e) { e2 = e; }
    ok(e2 && /boom/.test(String(e2)) && A.RB.fails === 1, 'readback: a worker error rejects the read and counts a fail');
    const p3 = A.readback(src, [{ w: 4, h: 3 }], 'k3'); await tick();
    A.L.workers[0].onerror(new Error('dead'));
    let e3 = null; try { await p3; } catch (e) { e3 = e; }
    ok(e3 && A.rbOK() === false && A.L.workers[0].terminated && A.RB.inflight.size === 0 && A.readback(src, [{ w: 1, h: 1 }], 'k') === null, 'rbDead: worker onerror → in-flight reads reject, worker terminated, rbOK false, readback null from then on');
    /* postRead: the state machine the map runs on */
    const B = mk(); const api = { ctx: { canvas: { tag: 'board' } } };
    ok(B.postRead(api, 'K', 4, 3, 2, 1) === false && B.ctx.S.post.async.asked === 0, 'postRead: no map yet → false (read the first map synchronously)');
    B.ctx.S.post.ready = true;
    ok(B.postRead(api, 'K', 4, 3, 2, 1) === null && B.ctx.S.post.async.asked === 1 && B.RB.inflight.size === 1, 'postRead: map exists → null (keep it) and ONE read asked');
    ok(B.postRead(api, 'K', 4, 3, 2, 1) === null && B.ctx.S.post.async.asked === 1, 'postRead: asked again while in flight → still null, no second read');
    await tick(); B.L.workers[0].reply(1, [new Uint8ClampedArray(48).fill(1).buffer, new Uint8ClampedArray(8).fill(2).buffer]); await tick();
    const got = B.postRead(api, 'K', 4, 3, 2, 1);
    ok(got && got.d && got.d[0] === 1 && got.ds && got.ds[0] === 2 && got.t0 === 100, 'postRead: the finished read is handed over once — { d, ds, t0 }', JSON.stringify(got && { d0: got.d && got.d[0], ds0: got.ds && got.ds[0], t0: got.t0 }));
    ok(B.postRead(api, 'K', 4, 3, 2, 1) === null && B.ctx.S.post.async.asked === 2, 'postRead: consumed → the next call asks for a fresh read');
    await tick(); B.L.workers[0].reply(2, [new Uint8ClampedArray(48).buffer, new Uint8ClampedArray(8).buffer]); await tick();
    ok(B.postRead(api, 'K2', 4, 3, 2, 1) === null && B.ctx.S.post.async.stale === 1 && B.ctx.S.post.async.asked === 3, 'postRead: a finished read for an OLD key (a bake landed meanwhile) is dropped and re-asked, never applied');
    await tick(); B.L.workers[0].reply(3, [new Uint8ClampedArray(48).buffer, new Uint8ClampedArray(8).buffer]); await tick();
    ok(B.postRead(api, 'K2', 5, 3, 2, 1) === null && B.ctx.S.post.async.stale === 2, 'postRead: a finished read at the OLD size (a resize) is dropped too');
    for (let k = 0; k < 3; k++) { await tick(); B.L.workers[0].fail(4 + k, 'x'); await tick(); if (k < 2) B.postRead(api, 'K2', 5, 3, 2, 1); }
    ok(B.ctx.S.post.async.errs === 3 && B.rbOK() === false && B.postRead(api, 'K2', 5, 3, 2, 1) === false, 'postRead: three rejected reads in a row → the worker is retired and postRead answers false (sync path)');
    /* the worker script itself */
    const W = mk(); const draws = [], reads = []; let closed = false;
    const wctx = { performance: { now: () => 1 }, String, Error, posted: null,
      OffscreenCanvas: function (w, h) { this.width = w; this.height = h; const cv = this; this.getContext = () => ({ setTransform() {}, drawImage(s, x, y, w2, h2) { draws.push((s.tag || 'cv' + s.width + 'x' + s.height) + '->' + w2 + 'x' + h2); }, getImageData(x, y, w2, h2) { reads.push(w2 + 'x' + h2); return { data: { buffer: 'buf' + w2 + 'x' + h2 } }; } }); },
      self: { postMessage(m, t) { wctx.posted = { m, t }; } } };
    vm.runInNewContext(W.RB_SRC, wctx);
    vm.runInNewContext('self.onmessage({ data: { id: 9, bmp: { tag: "bmp", close() { closed = true; } }, sizes: [{ w: 4, h: 3 }, { w: 2, h: 1 }] } })', Object.assign(wctx, { closed: false }));
    ok(draws.join(',') === 'bmp->4x3,cv4x3->2x1' && reads.join(',') === '4x3,2x1', 'worker: draws the bitmap at sizes[0], then THAT canvas at sizes[1], and reads both', draws.join(',') + ' | ' + reads.join(','));
    ok(wctx.posted && wctx.posted.m.id === 9 && wctx.posted.m.planes.join(',') === 'buf4x3,buf2x1' && wctx.posted.t === wctx.posted.m.planes, 'worker: posts { id, planes, ms } and transfers the planes');
    const wctx2 = { performance: { now: () => 1 }, String, Error, posted: null, OffscreenCanvas: function () { throw new Error('no canvas'); }, self: { postMessage(m) { wctx2.posted = m; } } };
    let closed2 = false; vm.runInNewContext(W.RB_SRC, wctx2);
    vm.runInNewContext('self.onmessage({ data: { id: 3, bmp: { close() { closed2 = true; } }, sizes: [{ w: 1, h: 1 }] } })', Object.assign(wctx2, { closed2: false }));
    ok(wctx2.posted && wctx2.posted.id === 3 && /no canvas/.test(wctx2.posted.err) && wctx2.closed2 === true, 'worker: a throw → { id, err } posted and the bitmap still closed');
    /* ── round 5: the watchdog ── */
    ok(/const RB_TIMEOUT_MS = 4000;/.test(RBBLOCK) && /RB\.hung = 0;/.test(RBBLOCK) && /RB\.timedOut = 0;/.test(RBBLOCK), 'vista: RB_TIMEOUT_MS = 4000 (the worker\'s p50 is ~50 ms; 4 s is a hang), RB.hung / RB.timedOut');
    ok(/const wd = setTimeout\(function \(\) \{ rbTimeout\(id\); \}, RB_TIMEOUT_MS\);\s*p\.then\(function \(\) \{ clearTimeout\(wd\); \}, function \(\) \{ clearTimeout\(wd\); \}\);/.test(RBBLOCK), 'readback: every read arms a watchdog, cleared when the read settles either way');
    ok(/RB\.reads\+\+; RB\.hung = 0;/.test(RBBLOCK), 'rbOnMessage: an answered read resets the consecutive-hang count');
    ok(/if \(!hidden && RB\.hung >= 2\) rbDead\(\);/.test(RBBLOCK) && /document\.hidden/.test(RBBLOCK), 'rbTimeout: two hung reads in a row retire the worker; a timeout while the document is hidden does not count');
    ok(/timedOut: RB\.timedOut, hung: RB\.hung, timeoutMs: RB_TIMEOUT_MS/.test(RBBLOCK), 'rbStats reports timedOut / hung / timeoutMs');
    const T1 = mk(); const tsrc = { tag: 'board' };
    const q1 = T1.readback(tsrc, [{ w: 4, h: 3 }], 'w1'); await tick();
    ok(T1.L.timers.length === 1 && T1.L.timers[0].ms === T1.RB_TIMEOUT_MS && T1.L.timers[0].ms === 4000, 'watchdog: one timer armed per read, at RB_TIMEOUT_MS');
    T1.L.timers[0].fn();
    let eq1 = null; try { await q1; } catch (e) { eq1 = e; }
    ok(eq1 && /readback timeout/.test(String(eq1)) && T1.RB.inflight.size === 0 && T1.RB.hung === 1 && T1.RB.timedOut === 1 && T1.rbOK() === true && !T1.L.workers[0].terminated, 'watchdog: a read the worker never answers rejects with "readback timeout", leaves nothing in flight, and ONE hang keeps the worker', String(eq1));
    ok(T1.L.cleared.indexOf(T1.L.timers[0].id) >= 0, 'watchdog: the settled read clears its timer');
    let lateThrew = false; try { T1.L.workers[0].reply(1, [new Uint8ClampedArray(48).buffer], 5); } catch (e) { lateThrew = true; }
    ok(!lateThrew && T1.RB.reads === 0, 'watchdog: a late answer for a timed-out id is ignored (not in flight)');
    const q2 = T1.readback(tsrc, [{ w: 4, h: 3 }], 'w2'); await tick();
    T1.L.workers[0].reply(2, [new Uint8ClampedArray(48).buffer], 5); await q2;
    ok(T1.RB.hung === 0 && T1.RB.timedOut === 1 && T1.L.cleared.indexOf(T1.L.timers[1].id) >= 0, 'watchdog: an answered read resets the consecutive count (timedOut total stays) and clears its timer');
    const q3 = T1.readback(tsrc, [{ w: 4, h: 3 }], 'w3'); await tick(); T1.L.timers[2].fn(); try { await q3; } catch (e) {}
    const q4 = T1.readback(tsrc, [{ w: 4, h: 3 }], 'w4'); await tick(); T1.L.timers[3].fn(); let eq4 = null; try { await q4; } catch (e) { eq4 = e; }
    ok(eq4 && T1.RB.hung === 2 && T1.rbOK() === false && T1.L.workers[0].terminated && T1.readback(tsrc, [{ w: 1, h: 1 }], 'k') === null, 'watchdog: the SECOND hung read in a row retires the worker (rbDead) — the sync path from then on');
    ok(T1.rbStats().timedOut === 3 && T1.rbStats().hung === 2 && T1.rbStats().timeoutMs === 4000, 'rbStats: timedOut 3, hung 2, timeoutMs 4000', JSON.stringify(T1.rbStats()));
    const T2 = mk({ hidden: true });
    const h1 = T2.readback(tsrc, [{ w: 4, h: 3 }], 'h1'); await tick(); T2.L.timers[0].fn(); let eh1 = null; try { await h1; } catch (e) { eh1 = e; }
    const h2 = T2.readback(tsrc, [{ w: 4, h: 3 }], 'h2'); await tick(); T2.L.timers[1].fn(); try { await h2; } catch (e) {}
    ok(eh1 && /readback timeout/.test(String(eh1)) && T2.RB.hung === 0 && T2.RB.timedOut === 0 && T2.rbOK() === true && !T2.L.workers[0].terminated, 'watchdog: timeouts while document.hidden reject the read but count nothing and never retire the worker (a background tab starves the worker, not the other way round)');
    /* postRead across a hang: the map is kept for one ask, then a fresh read is asked instead of waiting for ever */
    const T3 = mk(); const tapi = { ctx: { canvas: { tag: 'board' } } }; T3.ctx.S.post.ready = true;
    ok(T3.postRead(tapi, 'K', 4, 3, 2, 1) === null && T3.ctx.S.post.async.asked === 1, 'postRead (hang): first ask in flight');
    await tick(); T3.L.timers[0].fn(); await tick(); await tick();
    ok(T3.ctx.S.post.async.p === null && T3.ctx.S.post.async.errs === 1, 'postRead (hang): the timed-out read clears the in-flight slot and counts one error');
    ok(T3.postRead(tapi, 'K', 4, 3, 2, 1) === null && T3.ctx.S.post.async.asked === 2 && T3.RB.inflight.size === 1, 'postRead (hang): the next frame asks again instead of keeping a frozen map');
    /* the wrap-up runs after every async assertion */
    finish();
  })().catch((e) => { ok(false, 'round-4 vm section threw', String(e && e.stack || e)); finish(); });
}

/* ── tilefx: captureGround reads through the same worker ── */
const CG = (() => { const m = /function captureGround\(api, src, lit, T\) \{[\s\S]*?\n\}\n/.exec(TILEFX); return m ? m[0] : null; })();
ok(!!CG, 'tilefx: captureGround located');
ok(CG && /const sig = _bgLit;/.test(CG) && CG.indexOf('const sig = _bgLit;') < CG.indexOf('rb.read('), 'captureGround: the lit-set signature is bound BEFORE the read (the canvas and the lit set come from the same frame — the existing invariant, kept across the async gap)');
ok(CG && /const rb = window\.BBX && window\.BBX\.readback;\s*if \(rb && typeof rb\.ok === 'function' && rb\.ok\(\)\) \{\s*const p = rb\.read\(src, \[\{ w: dw, h: dh \}\], 'ground'\);/.test(CG), 'captureGround: asks window.BBX.readback for the frame at dw×dh when the worker is up');
ok(CG && /_bgPend = 1;\s*p\.then\(\(r\) => \{ _bgPend = 0; try \{ applyGround\(api, r\.planes\[0\], dw, dh, src\.width, lit, sig, T\); \} catch \(e\) \{\} \},\s*\(\) => \{ _bgPend = 0; \}\);\s*return;/.test(CG), 'captureGround: _bgPend stays up until the pixels are back (no re-ask meanwhile), then applyGround runs on plane 0 with the frame\'s own lit set / sig / clock; a rejection just clears the pend');
ok(CG && /const img = _bg\.ctx\.getImageData\(0, 0, dw, dh\);\s*applyGround\(api, img\.data, dw, dh, src\.width, lit, sig, T\);/.test(CG), 'captureGround: without the worker the synchronous read runs exactly as before and feeds the same applyGround');
ok(/function applyGround\(api, d, dw, dh, srcW, lit, sig, T\) \{\s*if \(!_bg \|\| _bg\.w !== dw \|\| _bg\.h !== dh\) _bg = \{ cv: null, ctx: null, w: dw, h: dh, s: dw \/ srcW, t: -1e9 \};\s*_bg\.t = T; _bg\.sig = sig;/.test(TILEFX), 'applyGround: records the frame clock and sig (the 2 s / lit-set staleness test keeps working on the async path)');
ok(/if \(api\.lightLerp \|\| api\.staging\) return;/.test(TILEFX), 'scheduleGround: still declines during a light lerp / staging');
if (CG) {
  const run = (rbOk, resolveWith) => {
    let pend = 0; const calls = [];
    const ctx = { window: { BBX: { readback: { ok: () => rbOk, read: (src, sizes, key) => { calls.push({ sizes, key }); return resolveWith ? Promise.resolve(resolveWith) : Promise.reject(new Error('x')); } } } },
      BG_MINI: 320, _bgLit: '1,1 2,2', _bgPend: 0, _bg: null, applied: [], Math, Set, Promise, Error,
      mkCv: (w, h) => ({ width: w, height: h, getContext: () => ({ setTransform() {}, drawImage() {}, getImageData: () => ({ data: 'syncpx' }) }) }),
      applyGround: (api, d, dw, dh, srcW, lit, sig, T) => ctx.applied.push({ d, dw, dh, srcW, sig, T }) };
    vm.runInNewContext(CG + '\n captureGround({}, { width: 640, height: 400 }, new Set(["1,1"]), 7); this.__pend = _bgPend;', ctx);
    return { ctx, calls, pend: ctx.__pend };
  };
  const a = run(true, { planes: ['px'] });
  ok(a.calls.length === 1 && a.calls[0].key === 'ground' && a.calls[0].sizes[0].w === 320 && a.calls[0].sizes[0].h === 200 && a.pend === 1 && a.ctx.applied.length === 0, 'captureGround (worker): one read at the thumbnail size, pend up, nothing applied yet', JSON.stringify({ calls: a.calls, pend: a.pend }));
  setImmediate(() => {
    ok(a.ctx.applied.length === 1 && a.ctx.applied[0].d === 'px' && a.ctx.applied[0].sig === '1,1 2,2' && a.ctx.applied[0].T === 7 && a.ctx.applied[0].srcW === 640 && vm.runInNewContext('_bgPend', a.ctx) === 0, 'captureGround (worker): the pixels apply with the bound sig / clock, pend cleared', JSON.stringify(a.ctx.applied));
    const b = run(true, null);
    setImmediate(() => { ok(b.ctx.applied.length === 0 && vm.runInNewContext('_bgPend', b.ctx) === 0, 'captureGround (worker): a rejected read applies nothing and clears the pend'); });
  });
  const c = run(false, null);
  ok(c.calls.length === 0 && c.ctx.applied.length === 1 && c.ctx.applied[0].d === 'syncpx' && c.pend === 0, 'captureGround (no worker): the synchronous read + applyGround, as before');
}

/* ── board: the tile paintings are decoded once ── */
ok(/const TILE_BMP = \{\};/.test(BOARD) && /function tileArtBitmap\(i\)\{/.test(BOARD), 'board: TILE_BMP + tileArtBitmap(i) exist');
ok(/createImageBitmap\(img\)\.then\(\(bmp\) => \{ rec\.bmp = bmp; rec\.pending = false; __bbCount\('artBitmaps'\); \}/.test(BOARD) && !/createImageBitmap\(img, \{/.test(BOARD), 'board: createImageBitmap(img) with no resize (same pixels as the painting)');
ok(/return \{ img: \(r && r\.bmp\) \|\| img, top: sp\.top \};/.test(BOARD), 'board: tileArtImage hands drawTileArt the bitmap once it exists, the <img> until then');
ok(/const nP = tileArtSrcs\(\)\.length;\s*for \(let p = 0; p < nP; p\+\+\) steps\.push\(\['terrainP' \+ p, \(\) => tileArtBitmap\(p\)\]\);\s*for \(let b = 0; b < TB\.n; b\+\+\) steps\.push\(\['terrainB' \+ b/.test(BOARD), 'board: one terrainP<i> staging step per painting, after terrainA and before the first band that would decode them');
ok(/terrainP:11/.test(BOARD) && /terrainP:0/.test(BOARD), 'board: STAGE_GUESS.terrainP = 11 ms (one decode per task), STAGE_GPU.terrainP = 0');
ok(/if \(TILE_BMP\[src\]\) return false;/.test(BOARD), 'board: a painting is bitmapped once (a done step costs nothing)');

/* ── round 5: the board's flame puff atlas ── */
const PUFFBLK = (() => { const i = BOARD.indexOf('const PUFF = { n: 48, px: 48, cv: null, failed: false, off: false };'); if (i < 0) return null; const j = BOARD.indexOf('function drawFlames(br){', i); if (j < 0) return null; const k = BOARD.indexOf('\n}\n', j); return k > 0 ? BOARD.slice(i, k + 2) : null; })();
ok(!!PUFFBLK, 'board: PUFF + puffAtlas + drawFlames located');
ok(PUFFBLK && /window\.__bbPuff = \(opt\) => \{ if \(opt && 'off' in opt\) PUFF\.off = !!opt\.off; return \{ n: PUFF\.n, px: PUFF\.px, ready: !!PUFF\.cv, failed: PUFF\.failed, off: PUFF\.off \}; \};/.test(PUFFBLK), 'board: the window.__bbPuff seam (n / px / ready / failed / off) with the off flag');
ok(PUFFBLK && /if \(PUFF\.off \|\| PUFF\.failed\) return null;/.test(PUFFBLK) && /if \(PUFF\.cv\) return PUFF\.cv;/.test(PUFFBLK), 'puffAtlas: off or failed → null (the gradient path); baked once');
ok(PUFFBLK && /const col = flameColor\(i \/ \(PUFF\.n - 1\)\);/.test(PUFFBLK) && /gr\.addColorStop\(0,\s*`rgba\(\$\{col\.r\},\$\{col\.g\},\$\{col\.b\},1\)`\);\s*gr\.addColorStop\(\.55, `rgba\(\$\{col\.r\},\$\{col\.g\},\$\{col\.b\},\.45\)`\);\s*gr\.addColorStop\(1,\s*`rgba\(\$\{col\.r\},\$\{col\.g\},\$\{col\.b\},0\)`\);/.test(PUFFBLK), 'puffAtlas: one cell per ramp colour, the gradient at alpha 1 / .45 / 0 (the old stops were col.a × exactly these)');
ok(PUFFBLK && /g\.fillStyle = gr; g\.beginPath\(\); g\.ellipse\(cx, cy, R\*0\.78, R\*1\.45, 0, 0, 7\); g\.fill\(\);/.test(PUFFBLK), 'puffAtlas: the cell is the same 0.78R × 1.45R ellipse the gradient path fills');
ok(PUFFBLK && /catch \(e\) \{ PUFF\.failed = true; PUFF\.cv = null; \}/.test(PUFFBLK), 'puffAtlas: a throw marks the atlas failed (gradient path from then on), never latches the frame');
ok(PUFFBLK && /const i = Math\.round\(p \* nmax\);\s*ctx\.globalAlpha = col\.a;\s*ctx\.drawImage\(atlas, i \* px, 0, px, px, sx - R, sy - R, R \* 2, R \* 2\);\s*__bbCount\('puffBlits'\);\s*continue;/.test(PUFFBLK), 'drawFlames: with the atlas each puff is ONE drawImage of its cell at globalAlpha = col.a, scaled to R');
ok(PUFFBLK && /ctx\.globalCompositeOperation = p < 0\.66 \? 'lighter' : 'source-over';\s*if \(atlas\)\{/.test(PUFFBLK), 'drawFlames: the lighter / source-over rule is set before the blit, as before');
ok(PUFFBLK && /const list = flames\.filter\(f => f\.br === br\.id\)\.sort\(\(a,b\) => b\.t - a\.t\);/.test(PUFFBLK) && /if \(col\.a <= 0\.003\) continue;/.test(PUFFBLK), 'drawFlames: sort order and the invisible-puff skip are unchanged');
ok(PUFFBLK && /__bbCount\('puffGradients'\);\s*const g = ctx\.createRadialGradient\(sx, sy, 0, sx, sy, R\);/.test(PUFFBLK) && /ctx\.beginPath\(\); ctx\.ellipse\(sx, sy, R\*0\.78, R\*1\.45, 0, 0, 7\); ctx\.fill\(\);/.test(PUFFBLK), 'drawFlames: the gradient path is kept verbatim as the fallback');
ok(PUFFBLK && /ctx\.globalAlpha = 1;\s*ctx\.globalCompositeOperation = 'source-over';\s*ctx\.restore\(\);/.test(PUFFBLK), 'drawFlames: globalAlpha and the composite op are reset before the restore');
ok(PUFFBLK && (PUFFBLK.match(/createRadialGradient/g) || []).length === 2, 'board: only two gradient sites in the block — the bake and the fallback');
if (PUFFBLK) {
  const RAMP = (() => { const m = /const FLAME_RAMP = \[[\s\S]*?\];\nfunction flameColor\(p\)\{[\s\S]*?\n\}\n/.exec(BOARD); return m ? m[0] : null; })();
  ok(!!RAMP, 'board: FLAME_RAMP + flameColor located for the sandbox');
  const mkP = (o) => {
    o = Object.assign({ canvas: true, off: false }, o || {});
    const L = { ops: [], cells: [], blits: [], grads: 0, counts: {} };
    const gradFake = () => ({ stops: [], addColorStop(p, c) { this.stops.push([p, c]); } });
    const bakeCtx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, ellipse(cx, cy, rx, ry) { L.cells.push([cx, cy, rx, ry]); }, fill() {}, createRadialGradient() { L.grads++; return gradFake(); } };
    const ctx = { L, Math, Error, document: { createElement: () => o.canvas ? { width: 0, height: 0, getContext: () => bakeCtx } : { getContext: () => null } },
      ctx: { save() { L.ops.push('save'); }, restore() { L.ops.push('restore'); }, beginPath() { L.ops.push('beginPath'); }, ellipse(...a) { L.ops.push('ellipse'); }, fill() { L.ops.push('fill'); }, createRadialGradient() { L.ops.push('grad'); return gradFake(); },
        drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) { L.blits.push({ cell: sx / sw, dw, dh, dx, dy, alpha: ctx.ctx.globalAlpha, op: ctx.ctx.globalCompositeOperation }); L.ops.push('blit'); }, globalAlpha: 1, globalCompositeOperation: 'source-over' },
      window: {}, clamp: (v, a, b) => Math.min(b, Math.max(a, v)), lerp: (a, b, k) => a + (b - a) * k, easeOut: (k) => 1 - (1 - k) * (1 - k),
      flames: [ { br: 1, t: 0.05, life: 1, ox: 0, oy: 0, r0: .1, r1: .02 }, { br: 1, t: 0.5, life: 1, ox: .1, oy: .2, r0: .1, r1: .02 }, { br: 1, t: 0.8, life: 1, ox: 0, oy: .4, r0: .1, r1: .02 }, { br: 2, t: 0.1, life: 1, ox: 0, oy: 0, r0: .1, r1: .02 }, { br: 1, t: 0.999, life: 1, ox: 0, oy: 0, r0: .1, r1: .02 } ],
      __bbCount: (k) => { L.counts[k] = (L.counts[k] || 0) + 1; } };
    vm.runInNewContext(RAMP + PUFFBLK + '\n this.__p = { PUFF, puffAtlas, drawFlames, flameColor };', ctx);
    if (o.off) ctx.window.__bbPuff({ off: true });
    return { ctx, L, ...ctx.__p, draw: () => ctx.drawFlames({ id: 1, _spr: { x: 100, y: 50, s: 200, fireY: 40 } }) };
  };
  const A = mkP();
  ok(A.puffAtlas() && A.PUFF.cv && A.L.grads === 48 && A.L.cells.length === 48 && A.L.cells[0].join(',') === '24,24,18.72,34.8' && A.L.cells[47][0] === 47 * 48 + 24 && A.puffAtlas() === A.PUFF.cv && A.L.grads === 48, 'puffAtlas (sandbox): 48 cells, R = 24, ellipse 0.78R × 1.45R centred in each, baked ONCE', JSON.stringify(A.L.cells.slice(0, 2)) + ' grads ' + A.L.grads);
  A.draw();
  const bl = A.L.blits;
  ok(bl.length === 3 && A.L.ops.indexOf('grad') < 0 && A.L.counts.puffBlits === 3 && !A.L.counts.puffGradients, 'drawFlames (sandbox, atlas): the brazier\'s three visible puffs (the 4th is on another brazier, the 5th is transparent) are three blits and no gradient', JSON.stringify(A.L.counts) + ' ops ' + A.L.ops.join(' '));
  const c0 = A.flameColor(0.8), c2 = A.flameColor(0.05);
  ok(bl[0].cell === Math.round(0.8 * 47) && Math.abs(bl[0].alpha - c0.a) < 1e-9 && bl[0].op === 'source-over' && bl[2].cell === Math.round(0.05 * 47) && Math.abs(bl[2].alpha - c2.a) < 1e-9 && bl[2].op === 'lighter', 'drawFlames (sandbox, atlas): oldest first; each blit uses the cell nearest its p, globalAlpha = flameColor(p).a, lighter under .66 and source-over above', JSON.stringify(bl.map(b => [b.cell, +b.alpha.toFixed(3), b.op])));
  const R0 = Math.max(0.6, A.ctx.lerp(.1, .02, A.ctx.easeOut(0.8)) * (1 + Math.sin(0.8 * Math.PI) * 0.35) * 200);
  ok(Math.abs(bl[0].dw - R0 * 2) < 1e-9 && Math.abs(bl[0].dh - R0 * 2) < 1e-9 && Math.abs(bl[0].dx - (100 - R0)) < 1e-9 && Math.abs(bl[0].dy - (40 - 0.4 * 200 - R0)) < 1e-9, 'drawFlames (sandbox, atlas): the cell lands centred on the puff at 2R × 2R (the same R as the gradient path)', JSON.stringify(bl[0]));
  ok(A.ctx.ctx.globalAlpha === 1 && A.ctx.ctx.globalCompositeOperation === 'source-over' && A.L.ops[0] === 'save' && A.L.ops[A.L.ops.length - 1] === 'restore', 'drawFlames (sandbox, atlas): alpha / op reset, save … restore');
  const Bf = mkP({ off: true }); Bf.draw();
  ok(Bf.L.blits.length === 0 && Bf.L.ops.filter(x => x === 'grad').length === 3 && Bf.L.ops.filter(x => x === 'ellipse').length === 3 && Bf.L.counts.puffGradients === 3 && !Bf.L.counts.puffBlits && Bf.PUFF.cv === null, 'drawFlames (sandbox, __bbPuff off): three gradients + three ellipse fills, no atlas baked — the one-flag counterfactual');
  const Cf = mkP({ canvas: false }); Cf.draw();
  ok(Cf.PUFF.failed === true && Cf.PUFF.cv === null && Cf.L.blits.length === 0 && Cf.L.counts.puffGradients === 3 && Cf.window === undefined, 'drawFlames (sandbox, no 2d context): the atlas fails once and the gradient path runs exactly as before');
  const D = mkP(); D.flames = null; D.ctx.flames = []; ok(D.ctx.drawFlames(null) === undefined && D.L.ops.length === 0, 'drawFlames (sandbox): no brazier sprite → nothing drawn');
}

/* ── round 6: ONE clip per actor (the board) ── */
const CLIPBLK = (() => { const i = BOARD.indexOf('const CLIPM = { off: false, eps: 0.25, cap: 2000 };'); if (i < 0) return null; const j = BOARD.indexOf('function clipBehindTerrain(footWorld, footElev, box, sx, sz){', i); if (j < 0) return null; const k = BOARD.indexOf('\n}\n', j); return k > 0 ? BOARD.slice(i, k + 2) : null; })();
ok(!!CLIPBLK, 'board: CLIPM + convexOverlap + pieceBox + clipPerSlab + mergeableCuts + clipBehindTerrain located');
ok(CLIPBLK && /window\.__bbClip = \(opt\) => \{ if \(opt && 'off' in opt\) CLIPM\.off = !!opt\.off;/.test(CLIPBLK), 'board: window.__bbClip({ off }) is the one-flag counterfactual');
ok(CLIPBLK && /function clipPerSlab\(mask\)\{\n  for \(let i = 0; i < mask\.length; i\+\+\)\{\n    ctx\.beginPath\(\);\n    ctx\.rect\(0, 0, W, H\);[\s\S]*?ctx\.clip\('evenodd'\);\n  \}\n\}/.test(CLIPBLK), 'board: the per-slab loop (one clip per slab, even-odd within a slab) is kept verbatim as clipPerSlab');
ok(CLIPBLK && (CLIPBLK.match(/ctx\.clip\('evenodd'\)/g) || []).length === 2, 'board: exactly two clip sites — the per-slab loop and the merged path');
ok(CLIPBLK && /const m = mergeableCuts\(mask, box, CLIPM\.eps\);\n  if \(!m\)\{ ctx\.save\(\); clipPerSlab\(mask\);/.test(CLIPBLK) && /if \(\+\+work > CLIPM\.cap\) return null;/.test(CLIPBLK), 'board: only the work cap (CLIPM.cap subtraction steps per actor) falls back to the per-slab loop');
ok(CLIPBLK && /const CLIPM = \{ off: false, eps: 0\.25, cap: 2000 \};/.test(CLIPBLK) && /function splitConvex\(P, a, b, sgn, eps\)\{/.test(CLIPBLK) && /function convexSubtract\(F, N, eps\)\{/.test(CLIPBLK) && /if \(r\[1\] && Math\.abs\(polyArea\(r\[1\]\)\) > 0\.05\) parts\.push\(r\[1\]\);/.test(CLIPBLK), 'board: CLIPM {eps .25, cap 2000}; splitConvex + convexSubtract (edge-by-edge peel, slivers under 0.05 px² dropped)');
ok(CLIPBLK && /if \(CLIPM\.off\)\{ ctx\.save\(\); clipPerSlab\(mask\);/.test(CLIPBLK), 'board: __bbClip off → the per-slab loop for every actor');
ok(CLIPBLK && /if \(own\[k\] === owner\[i\]\) continue;/.test(CLIPBLK) && /if \(convexOverlap\(q, out\[k\], eps\)\)\{ hit = k; break; \}/.test(CLIPBLK) && /const parts = convexSubtract\(q, out\[hit\], eps\); for \(let p = 0; p < parts\.length; p\+\+\) queue\.push\(parts\[p\]\);/.test(CLIPBLK), 'board: only CROSS-slab pairs are overlap-tested (same-slab pieces cannot overlap by construction); an overlapping piece is replaced by its convex difference and its parts re-queued');
ok(CLIPBLK && /if \(!m\.pieces\.length\)\{ window\.__bbCount && __bbCount\('clipNone'\); return false; \}/.test(CLIPBLK), 'board: when every piece misses the actor box there is no clip and no save (the caller restores only on true)');
ok(BOARD.indexOf('const _clip = _p ? clipBehindTerrain(d.wp, d.fe, actorBox(_p, d.bw, d.bh), d.sx, d.sz) : false;') > 0 && /if \(_clip\) ctx\.restore\(\);/.test(BOARD), 'board: the actor loop still asks clipBehindTerrain per drawable and restores in its finally');
if (CLIPBLK) {
  const mkC = (o) => {
    o = Object.assign({ mask: null, off: false }, o || {});
    const L = { ops: [], paths: [], counts: {}, saves: 0 };
    let cur = null;
    const ctx = { L, Math, Infinity, W: 800, H: 600, occluderMask: () => o.mask, window: {}, __bbCount: (k, n) => { L.counts[k] = (L.counts[k] || 0) + (n == null ? 1 : n); },
      ctx: { save() { L.saves++; L.ops.push('save'); }, beginPath() { cur = { rect: null, polys: [] }; L.ops.push('beginPath'); }, rect(x, y, w, h) { cur.rect = [x, y, w, h]; }, moveTo(x, y) { cur.polys.push([[x, y]]); }, lineTo(x, y) { cur.polys[cur.polys.length - 1].push([x, y]); }, closePath() {}, clip(rule) { L.ops.push('clip:' + rule); L.paths.push(cur); } } };
    vm.runInNewContext(CLIPBLK + '\n this.__c = { CLIPM, convexOverlap, pieceBox, mergeableCuts, clipBehindTerrain, convexSubtract, splitConvex, polyArea };', ctx);
    ctx.__bbCount = ctx.__bbCount; ctx.window.__bbCount = ctx.__bbCount;
    if (o.off) ctx.window.__bbClip({ off: true });
    return { ctx, L, ...ctx.__c, clip: (box) => ctx.clipBehindTerrain({ x: 0, y: 0, z: 0 }, 0, box || { x0: 0, x1: 800, y0: 0, y1: 600 }, 0, 0) };
  };
  const sq = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const C0 = mkC();
  ok(C0.convexOverlap(sq(0, 0, 10, 10), sq(10, 0, 10, 10), 0.25) === false && C0.convexOverlap(sq(0, 0, 10, 10), sq(9.9, 0, 10, 10), 0.25) === false && C0.convexOverlap(sq(0, 0, 10, 10), sq(8, 3, 10, 10), 0.25) === true && C0.convexOverlap(sq(0, 0, 10, 10), sq(30, 30, 5, 5), 0.25) === false, 'convexOverlap (sandbox): a shared edge (and a 0.1 px graze) is NOT an overlap; real area is; disjoint is not');
  ok(C0.convexOverlap([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 15 }], [{ x: 10, y: 5 }, { x: 30, y: 5 }, { x: 20, y: 20 }], 0.25) === true && C0.convexOverlap([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 15 }], [{ x: 25, y: 0 }, { x: 45, y: 0 }, { x: 35, y: 15 }], 0.25) === false, 'convexOverlap (sandbox): triangles, both ways');
  /* two slabs, three pieces, none overlapping (a top and its wall, and a neighbour top sharing the wall's foot edge) */
  const top1 = sq(100, 100, 40, 20), wall1 = sq(100, 120, 40, 30), top2 = sq(140, 120, 40, 20);
  const A = mkC({ mask: [ { o: { x: 1, z: 1 }, cut: [top1, wall1] }, { o: { x: 2, z: 1 }, cut: [top2] } ] });
  ok(A.clip() === true && A.L.ops.filter(x => x.startsWith('clip')).length === 1 && A.L.paths[0].rect.join(',') === '0,0,800,600' && A.L.paths[0].polys.length === 3 && A.L.counts.clipOne === 1 && !A.L.counts.clipPerSlab && A.L.saves === 1, 'clipBehindTerrain (sandbox): two slabs whose pieces only touch → ONE clip(evenodd) of rect + all three pieces', JSON.stringify(A.L.ops) + ' ' + JSON.stringify(A.L.counts));
  /* the same, but the far slab's top is partly BEHIND the near slab's wall (a terrace) → the far top is cut by the wall and it is still ONE clip */
  const B = mkC({ mask: [ { o: { x: 1, z: 1 }, cut: [top1, wall1] }, { o: { x: 1, z: 2 }, cut: [sq(110, 130, 40, 20)] } ] });
  ok(B.clip() === true && B.L.ops.filter(x => x.startsWith('clip')).length === 1 && B.L.paths[0].polys.length === 3 && B.L.counts.clipOne === 1 && B.L.counts.clipSplits === 1 && !B.L.counts.clipPerSlab && B.L.saves === 1, 'clipBehindTerrain (sandbox): a far top under a near wall (a terrace) is replaced by its part outside the wall — still ONE clip, one split counted', JSON.stringify(B.L.ops) + ' ' + JSON.stringify(B.L.counts) + ' polys ' + (B.L.paths[0] && B.L.paths[0].polys.length));
  const Bs = C0.convexSubtract(sq(110, 130, 40, 20), wall1, 0.25);
  ok(Bs.length === 1 && Math.abs(Bs.reduce((t, p) => t + Math.abs(C0.polyArea(p)), 0) - (40 * 20 - 30 * 20)) < 1e-6, 'convexSubtract (sandbox): (110..150 × 130..150) minus the wall (100..140 × 120..150) = the 200 px² strip east of it, one convex part', JSON.stringify(Bs));
  const Bs2 = C0.convexSubtract(sq(0, 0, 40, 40), sq(10, 10, 20, 20), 0.25);
  ok(Bs2.length === 4 && Math.abs(Bs2.reduce((t, p) => t + Math.abs(C0.polyArea(p)), 0) - (1600 - 400)) < 1e-6, 'convexSubtract (sandbox): a square minus a square inside it = four disjoint convex parts totalling 1200 px²', JSON.stringify(Bs2.map(p => p.length)));
  ok(C0.convexSubtract(sq(0, 0, 10, 10), sq(20, 0, 10, 10), 0.25).length === 1 && C0.convexSubtract(sq(2, 2, 4, 4), sq(0, 0, 10, 10), 0.25).length === 0, 'convexSubtract (sandbox): disjoint → the piece itself; wholly inside → nothing');
  const Cap = mkC({ mask: [ { o: { x: 1, z: 1 }, cut: [top1] }, { o: { x: 2, z: 1 }, cut: [sq(110, 105, 40, 20)] } ] }); Cap.CLIPM.cap = 1;
  ok(Cap.clip() === true && Cap.L.ops.filter(x => x.startsWith('clip')).length === 2 && Cap.L.counts.clipPerSlab === 1, 'clipBehindTerrain (sandbox, cap 1): the work cap trips → the per-slab loop, exactly as before');
  /* pieces of the SAME slab that overlap do not veto (they cannot in the real geometry; the rule is per-slab even-odd, unchanged) */
  const B2 = mkC({ mask: [ { o: { x: 1, z: 1 }, cut: [top1, sq(105, 105, 10, 10)] } ] });
  ok(B2.clip() === true && B2.L.ops.filter(x => x.startsWith('clip')).length === 1 && B2.L.counts.clipOne === 1, 'clipBehindTerrain (sandbox): one slab is always one clip');
  /* a piece that misses the actor box is dropped from the path; when all miss, no clip and no save */
  const D = mkC({ mask: [ { o: { x: 1, z: 1 }, cut: [top1, sq(500, 500, 20, 20)] } ] });
  ok(D.clip({ x0: 90, x1: 200, y0: 90, y1: 200 }) === true && D.L.paths[0].polys.length === 1 && D.L.counts.clipDroppedPieces === 1, 'clipBehindTerrain (sandbox): a cut piece outside the actor box is dropped from the path', JSON.stringify(D.L.counts));
  const E = mkC({ mask: [ { o: { x: 1, z: 1 }, cut: [sq(500, 500, 20, 20)] } ] });
  ok(E.clip({ x0: 90, x1: 200, y0: 90, y1: 200 }) === false && E.L.saves === 0 && E.L.counts.clipNone === 1, 'clipBehindTerrain (sandbox): every piece outside the box → returns false with NO save (nothing to restore)');
  const O = mkC({ mask: [ { o: { x: 1, z: 1 }, cut: [top1, wall1] }, { o: { x: 2, z: 1 }, cut: [top2] } ], off: true });
  ok(O.clip() === true && O.L.ops.filter(x => x.startsWith('clip')).length === 2 && O.L.counts.clipPerSlab === 1, 'clipBehindTerrain (sandbox, __bbClip off): the per-slab loop for every actor — the counterfactual');
  const N = mkC({ mask: null }); ok(N.clip() === false && N.L.saves === 0, 'clipBehindTerrain (sandbox): no occluders → false, no save');
  /* the merged region IS the per-slab region: even-odd over the merged pieces == AND of per-slab even-odd, sampled on a grid — with overlapping slabs (terraces) */
  const inPoly = (p, pt) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  const hex = (cx, cy, r) => [0, 1, 2, 3, 4, 5].map(i => ({ x: cx + r * Math.cos(i * Math.PI / 3), y: cy + r * 0.55 * Math.sin(i * Math.PI / 3) }));
  const mask = [ { cut: [hex(120, 110, 22), sq(100, 122, 40, 25)] }, { cut: [hex(140, 135, 22)] }, { cut: [hex(165, 100, 22), sq(150, 112, 36, 30)] }, { cut: [sq(200, 90, 30, 30), sq(200, 120, 30, 25)] } ];
  const M = C0.mergeableCuts(mask, null, 0.25);
  let agree = 0, total = 0, skipped = 0;
  for (let y = 80; y < 200; y += 2) for (let x = 80; x < 260; x += 2) { const pt = { x: x + 0.37, y: y + 0.61 };
    let near = false; for (const m of mask) for (const pc of m.cut) for (let a = 0; a < pc.length; a++) { const A2 = pc[a], B2 = pc[(a + 1) % pc.length]; const ex = B2.x - A2.x, ey = B2.y - A2.y, Lg = Math.hypot(ex, ey) || 1; const d = Math.abs(ex * (pt.y - A2.y) - ey * (pt.x - A2.x)) / Lg; const tt = ((pt.x - A2.x) * ex + (pt.y - A2.y) * ey) / (Lg * Lg); if (d < 0.6 && tt > -0.02 && tt < 1.02) near = true; }
    if (near) { skipped++; continue; }
    let per = true; for (const m of mask) { let n = 0; for (const pc of m.cut) if (inPoly(pc, pt)) n++; if (n % 2 === 1) per = false; }
    let all = 0; for (const pc of M.pieces) if (inPoly(pc, pt)) all++;
    total++; if ((all % 2 === 0) === per) agree++; }
  ok(M && M.splits >= 2 && M.pieces.length > 7 && agree === total && total > 3000, 'mergeableCuts (sandbox): four slabs with terrace overlaps merge into one even-odd path (' + (M && M.splits) + ' splits, ' + (M && M.pieces.length) + ' pieces) that equals the intersection of the per-slab clips at every sampled point off the edges', agree + '/' + total + ' skipped ' + skipped);
}

/* ── round 6: the rock sprites (dressing) ── */
const DRESSING = readFileSync('./public/src/battle/stage/dressing.js', 'utf8').replace(/\r\n/g, '\n');
const ROCKBLK = (() => { const i = DRESSING.indexOf('const ROCKSPR = { off: false, failed: false, budget: 12, perFrame: 12,'); if (i < 0) return null; const j = DRESSING.indexOf('function drawRock(api, it){', i); if (j < 0) return null; const k = DRESSING.indexOf('\n}\n', j); return k > 0 ? DRESSING.slice(i, k + 2) : null; })();
ok(!!ROCKBLK, 'dressing: ROCKSPR + qHex + rockKey + rockBounds + paintRockBody + bakeRock + drawRock located');
ok(ROCKBLK && /window\.__bbRockSprite = \(opt\) => \{\n  if \(opt && 'off' in opt\) ROCKSPR\.off = !!opt\.off;/.test(ROCKBLK), 'dressing: window.__bbRockSprite({ off }) is the one-flag counterfactual');
ok(ROCKBLK && /function rockKey\(a\)\{\n  return qStep\(a\.sx, 0\.25\) \+ '\|' \+ qStep\(a\.sy, 0\.25\) \+ '\|' \+ ROCKSPR\.dpr \+ '\|' \+\n\s+qStep\(FRAME\.lx, 0\.02\) \+ '\|' \+ qStep\(FRAME\.ly, 0\.02\) \+ '\|' \+\n\s+qHex\(FRAME\.lit\) \+ '\|' \+ qHex\(FRAME\.mid\) \+ '\|' \+ qHex\(FRAME\.shd\) \+ '\|' \+ qHex\(FRAME\.rim\);/.test(ROCKBLK), 'dressing: the sprite key is the QUANTISED rig — scale to ¼ px/unit, light direction to 0.02, each graded tone to 6 levels per channel, plus the DPR');
ok(ROCKBLK && /contact\(api, a, B\.w \* 0\.85, 1\.05\);\n  occlude\(api, a, B\.w \* 1\.15, 0\.34\);\n  if \(!ROCKSPR\.off && !ROCKSPR\.failed\)\{/.test(ROCKBLK), 'dressing: the contact shadow and the foot occlusion stay live, before the sprite');
ok(ROCKBLK && /\} catch \(e\)\{ ROCKSPR\.failed = true; spr = null; \}/.test(ROCKBLK) && /ROCKSPR\.live\+\+;\n  paintRockBody\(api, a, it\);\n\}/.test(ROCKBLK), 'dressing: a throw in the bake latches failed and the live painter runs (the old body, verbatim in paintRockBody)');
ok(ROCKBLK && /g\.setTransform\(dpr, 0, 0, dpr, 0, 0\);/.test(ROCKBLK) && /paintRockBody\(Object\.assign\(\{\}, api, \{ ctx: g \}\), \{ x: ox, y: oy, sx, sy \}, it\);/.test(ROCKBLK), 'dressing: the bake paints with the SAME paintStone into a context carrying the stage DPR transform');
ok(/ROCKSPR\.budget = ROCKSPR\.perFrame;\n\s+try \{\n\s+const t = api\.ctx && api\.ctx\.getTransform \? api\.ctx\.getTransform\(\) : null;/.test(DRESSING) && DRESSING.indexOf('ROCKSPR.budget = ROCKSPR.perFrame;') > DRESSING.indexOf('  items(api){'), 'dressing: items() resets the per-frame bake budget and reads the DPR off the frame context every frame');
if (ROCKBLK) {
  const mkR = (o) => {
    o = Object.assign({ canvas: true, throwBake: false, off: false, sx: 30, sy: 18, dpr: 2 }, o || {});
    const L = { paints: [], blits: [], bakeCtx: [], contact: 0, occlude: 0 };
    const mkG = () => { const g = { ops: [], setTransform(...a) { g.ops.push(['setTransform', ...a]); }, clearRect(...a) { g.ops.push(['clearRect', ...a]); } }; L.bakeCtx.push(g); return g; };
    const FRAME = { lx: 0.55, ly: -0.83, lit: '#b09470', mid: '#6a5540', shd: '#2a2018', rim: '#cfe4ff' };
    const mainCtx = { drawImage(cv, x, y, w, h) { L.blits.push({ cv, x, y, w, h }); } };
    const api = { ctx: mainCtx, hash: () => 0.5, mixHex: (a) => a, rgba: (c) => c };
    const ctx = { L, Math, Infinity, isFinite, parseInt, String, Object, FRAME, window: {},
      document: { createElement: () => { if (o.throwBake) throw new Error('boom'); return { width: 0, height: 0, getContext() { return o.canvas ? (this._g || (this._g = mkG())) : null; } }; } },
      anchor: (a, gx, gz, y) => ({ x: 400.3, y: 300.7, sx: o.sx, sy: o.sy }),
      contact: () => { L.contact++; }, occlude: () => { L.occlude++; },
      paintStone: (a2, a, pts, ox, oy, r, tone, seed) => { L.paints.push({ ctx: a2.ctx, a, r, seed }); } };
    vm.runInNewContext(ROCKBLK + '\n this.__r = { ROCKSPR, qHex, rockKey, rockBounds, bakeRock, drawRock };', ctx);
    ctx.__r.ROCKSPR.dpr = o.dpr;
    if (o.off) ctx.window.__bbRockSprite({ off: true });
    const pts = [{ x: -0.5, y: 0 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.9 }, { x: -0.3, y: 0.7 }];
    const it = { gx: 3, gz: 4, y: 0, body: { w: 1, h: 1, pts }, tone: { lit: '#fff', mid: '#888', shd: '#222' }, seed: 7 };
    return { ctx, L, api, it, pts, FRAME, ...ctx.__r, draw: () => ctx.drawRock(api, it) };
  };
  const A = mkR(); A.draw();
  ok(A.L.contact === 1 && A.L.occlude === 1 && A.L.paints.length === 1 && A.L.paints[0].ctx === A.L.bakeCtx[0] && A.L.paints[0].ctx !== A.api.ctx && A.L.blits.length === 1 && A.ROCKSPR.bakes === 1 && A.ROCKSPR.blits === 1 && A.ROCKSPR.live === 0, 'drawRock (sandbox): first frame — shadow + occlusion live, the stone painted ONCE into the sprite context, one drawImage on the frame', JSON.stringify(A.ROCKSPR));
  const spr = A.it._rs, g0 = A.L.bakeCtx[0];
  ok(spr && spr.w === Math.ceil(1.1 * 30 + 8) && spr.h === Math.ceil(0.9 * 18 + 8) && spr.cv.width === spr.w * 2 && spr.cv.height === spr.h * 2 && g0.ops[0][0] === 'setTransform' && g0.ops[0].slice(1).join(',') === '1,0,0,1,0,0' && g0.ops[1][0] === 'clearRect' && g0.ops[2].slice(1).join(',') === '2,0,0,2,0,0', 'bakeRock (sandbox): the sprite is the silhouette bounds + 4 px pad, at DPR resolution (canvas = w·2 × h·2), cleared then given the DPR transform');
  const a2 = A.L.paints[0].a, inside = A.pts.every(p => { const X = a2.x + p.x * a2.sx, Y = a2.y - p.y * a2.sy; return X >= 4 - 1e-9 && X <= spr.w - 4 + 1e-9 && Y >= 4 - 1e-9 && Y <= spr.h - 4 + 1e-9; });
  ok(inside && a2.sx === 30 && a2.sy === 18, 'bakeRock (sandbox): every silhouette vertex lands inside the pad at the quantised scale');
  const b0 = A.L.blits[0];
  ok(b0.cv === spr.cv && b0.w === spr.w && b0.h === spr.h && Math.abs(b0.x - Math.round((400.3 - spr.ox) * 2) / 2) < 1e-9 && Math.abs(b0.y - Math.round((300.7 - spr.oy) * 2) / 2) < 1e-9 && Math.abs((b0.x + spr.ox) - 400.3) <= 0.25 + 1e-9, 'drawRock (sandbox): the blit puts the sprite\'s anchor on the item\'s anchor, snapped to the device pixel (≤ ¼ CSS px at DPR 2)');
  A.draw();
  ok(A.ROCKSPR.bakes === 1 && A.ROCKSPR.blits === 2 && A.L.paints.length === 1, 'drawRock (sandbox): a steady rig re-uses the sprite — no second bake');
  A.FRAME.lit = '#af9470'; A.draw();
  ok(A.ROCKSPR.bakes === 1 && A.L.paints.length === 1, 'drawRock (sandbox): a tone change under one quantum (b0→af, both to ae) does not re-bake');
  A.FRAME.lit = '#c0a080'; A.draw();
  ok(A.ROCKSPR.bakes === 2 && A.L.paints.length === 2 && A.L.paints[1].ctx === A.L.bakeCtx[0] && A.it._rs.cv === spr.cv, 'drawRock (sandbox): a real light change re-bakes, re-using the same canvas when the size holds');
  A.FRAME.lit = '#ffffff'; A.ROCKSPR.budget = 0; A.draw();
  ok(A.ROCKSPR.bakes === 2 && A.ROCKSPR.stale === 1 && A.ROCKSPR.blits === 5 && A.L.paints.length === 2, 'drawRock (sandbox): budget spent → the previous sprite is blitted (stale) rather than painted live');
  A.ROCKSPR.budget = 12; A.draw(); ok(A.ROCKSPR.bakes === 3, 'drawRock (sandbox): the next frame\'s budget bakes it');
  const Bq = mkR(); Bq.ROCKSPR.budget = 0; Bq.draw();
  ok(Bq.L.paints.length === 1 && Bq.L.paints[0].ctx === Bq.api.ctx && Bq.L.blits.length === 0 && Bq.ROCKSPR.live === 1 && Bq.L.contact === 1, 'drawRock (sandbox): budget spent with NO sprite yet → painted live on the frame, exactly as before');
  const Off = mkR({ off: true }); Off.draw(); Off.draw();
  ok(Off.L.paints.length === 2 && Off.L.paints.every(p => p.ctx === Off.api.ctx) && Off.L.blits.length === 0 && Off.ROCKSPR.bakes === 0, 'drawRock (sandbox, __bbRockSprite off): the live painter every frame — the counterfactual');
  const Nc = mkR({ canvas: false }); Nc.draw();
  ok(Nc.L.paints.length === 1 && Nc.L.paints[0].ctx === Nc.api.ctx && Nc.L.blits.length === 0, 'drawRock (sandbox, no 2d context): the live painter');
  const Th = mkR({ throwBake: true }); Th.draw(); Th.draw();
  ok(Th.ROCKSPR.failed === true && Th.L.paints.length === 2 && Th.L.paints.every(p => p.ctx === Th.api.ctx) && Th.ROCKSPR.bakes === 0, 'drawRock (sandbox, the bake throws): failed latches once and the live painter runs from then on');
  const P = mkR(); P.it.body = { w: 1, parts: [ { pts: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0.5 }], r: 0.3 }, { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.5 }], r: 0.5 } ] }; P.draw();
  ok(P.L.paints.length === 2 && P.L.paints.map(p => p.seed).join(',') === '7,24' && P.L.paints.every(p => p.ctx === P.L.bakeCtx[0]) && P.it._rb.x0 === -1 && P.it._rb.x1 === 1 && P.it._rb.y1 === 1.5 && P.it._rs.w === Math.ceil(2 * 30 + 8) && P.it._rs.h === Math.ceil(1.5 * 18 + 8), 'drawRock (sandbox): a multi-part rock bakes every part (seed + i·17, as before) into ONE sprite spanning all of them');
  ok(A.qHex('#b09470') === '#ae9672' && A.qHex('#000000') === '#000000' && A.qHex('#ffffff') === '#ffffff' && A.qHex('#0a0b0c') === '#0c0c0c' && A.qHex('rgb(1,2,3)') === 'rgb(1,2,3)', 'qHex (sandbox): each channel to the nearest multiple of 6 (capped at 255); a non-hex string passes through');
  const K = mkR(); const k1 = K.rockKey({ sx: 30.1, sy: 18.05 }), k2 = K.rockKey({ sx: 30.05, sy: 17.95 }), k3 = K.rockKey({ sx: 31, sy: 18 });
  ok(k1 === k2 && k1 !== k3 && k1.split('|').length === 9, 'rockKey (sandbox): ¼ px/unit scale steps share a key; a real zoom does not; nine fields');
}

let _finished = false;
function finish() { if (_finished) return; _finished = true; setTimeout(() => { console.log(fails ? '\n  ' + fails + ' FAIL' : '\n  all green'); process.exit(fails ? 1 : 0); }, 30); }
if (!RBBLOCK) finish();
