/* 🌗 DAY/NIGHT TRANSITION PERF — the 2.5 s sky lerp bakes once, not twenty times,
   and nothing it bakes is paid inside a frame or in one long task.

   The owner: "fix the game slowing up and lagging during the day time changing
   in battles."

   Measured before round 1 (12 units, 10x8, headless): ONE night transition
   did 58 full terrain bakes, 6 vista plate bakes + 1 steady re-bake, 9 grade
   readbacks and 170 silhouette bakes (each a getImageData sync) — 34 long
   tasks inside the lerp. After round 3, on a real GPU: 1 terrain bake (in 8
   band-sliced tasks), 2 plates (in 12 band tasks each), 0 steady, 0 silhouette
   bakes, no task over 50 ms, no frame over 33.4 ms on the warmed path.

   Defends, from the source text and by running the real functions in a vm
   with fake canvases, timers and frames:
     · the counter seam: window.__bbCount, PERFC, __bbPerf().counters, reset;
     · the silhouette STAMP is cached without the tint (silStamp, _SIL_STAMP),
       spriteEdgeCanvas recolours from it, and the rim tint is PINNED across a
       lerp (silRim: from-rim below k=0.5, to-rim above) — the call site uses it;
     · the terrain key names the lerp (id + 1/16 step), never the per-frame
       light, while a lerp runs; terrainLayer cross-fades two endpoint bakes
       (terrainMix) and adopts the `to` bake when the lerp ends;
     · (round 2) setTimeOfDay STAGES the press: the pending lerp (lightPending)
       is not live until stageLerp has run every step in tasks of its own — the
       press's own task bakes nothing; a running lerp is held, not dropped; the
       pair and the plates are keyed by JOURNEY so warmNext() can pre-bake the
       likely next preset at idle and the press adopts it;
     · (round 3) every step is a SLICE: the ground pair is baked in horizontal
       BANDS (terrainBands / bakeTerrainBand — A copied in its own step, B one
       band per step, the pair adopted only when the last band lands), each
       plate third in bands (vista.primeStep band/nb via bandInto's clip), the
       art grade in two steps (bakeArt's `split`: the recording in one, its
       readbacks — finish() — a task later) and graded over ITS rung's sky;
       a staged bake is KICKED to the GPU (stageKick / flushBake: one pixel
       drawn into a small scratch canvas), never read back; ONE staging task
       per frame (stageNext: rAF, then setTimeout 0, a 250 ms stand-in when
       hidden); a task takes a further step only if its predicted main-thread
       cost fits STAGE_BUDGET_MS AND its predicted raster fits STAGE_GPU_MS —
       the GPU's spare in a frame, not a frame; "staging" (stagingNow, the
       vista's api.staging) stays true for STAGE_DRAIN_MS after the last task
       so the veil-map readback resumes on a drained queue;
     · vista: PLATE_K is the two endpoints, the ladder PARKS on the last rung,
       postMap is skipped while api.lightLerp or api.staging is set;
     · TIME_PRESETS colours are untouched; lightAtK keeps its body step.

   Run: node _daynightperf_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const BB = readFileSync('./public/battle-board/index.html', 'utf8');
const VISTA = readFileSync('./public/src/battle/stage/vista.js', 'utf8').replace(/\r\n/g, '\n');
function fnText(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
}
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
/* a top-level `const NAME = …;` line of the board, for the vm harnesses */
function constLine(name) { const m = new RegExp('^const ' + name + ' = [^\\n]*;', 'm').exec(BB); if (!m) throw new Error('cannot find const ' + name); return m[0]; }

/* ── the counter seam ─────────────────────────────────────────────────────── */
ok(/const PERFC = \{ terrainBakes:0, terrainMixes:0, plateBakes:0, steadyBakes:0, postReads:0,\s*silMisses:0, silRetints:0, applyDefs:0, texLoads:0, inits:0, stageTasks:0, stageSteps:0, warms:0,\s*terrainBands:0, plateBands:0, artBakes:0 \};/.test(BB), 'PERFC names every counter the bar reads (round 3 adds the band and art-bake counts)');
ok(/window\.__bbCount = \(k, n\) => \{ PERFC\[k\] = \(PERFC\[k\] \|\| 0\) \+ \(n == null \? 1 : n\); \};/.test(BB), 'window.__bbCount is the one write seam');
ok(/counters: Object\.assign\(\{\}, PERFC\),/.test(BB.slice(BB.indexOf('window.__bbPerf = '), BB.indexOf('window.__bbPerfReset = '))), '__bbPerf() reports the counters');
ok(/window\.__bbPerfReset = \(\) => \{[^\n]*for \(const k in PERFC\) PERFC\[k\] = 0; \};/.test(BB), '__bbPerfReset zeroes them');
ok(/__bbCount\('applyDefs'\)/.test(fnText(BB, 'applyDefs')) && /__bbCount\('texLoads'\)/.test(fnText(BB, 'artImage')) && /__bbCount\('inits'\)/.test(BB), 'applyDefs / texture loads / inits are counted (the things a transition must not do)');
ok(/warmSteps: PRESS\.warmSteps\.map/.test(BB) && /steps: PRESS\.steps\.map/.test(BB), '__bbPerf().press reports the press\'s steps and the last warm\'s');

/* ── the silhouette cache ─────────────────────────────────────────────────── */
const SS = fnText(BB, 'silStamp');
ok(/const key = src \+ '\|' \+ sx \+ ',' \+ sy \+ ',' \+ sw \+ ',' \+ sh;/.test(SS) && !/rim|dark/.test(strip(SS)), 'silStamp is keyed on the source rect only — no tint in the key');
ok(/getImageData\(/.test(SS) && /__bbCount\('silMisses'\)/.test(SS), 'the ring probe (the readback) lives in silStamp and counts as the miss');
const SE = fnText(BB, 'spriteEdgeCanvas');
ok(/const stamp = silStamp\(img, src, sx, sy, sw, sh\);/.test(SE), 'spriteEdgeCanvas takes its stamp from the cache');
ok(!/getImageData\(/.test(SE) && /gs\.drawImage\(stamp, 0, 0\);/.test(SE) && /__bbCount\('silRetints'\)/.test(SE), 'a retint is a recolour of the stamp — no readback');
const SR = fnText(BB, 'silRim');
ok(/lightLerp\.t < 0\.5 \? lightLerp\.from\.rim : lightLerp\.to\.rim/.test(SR), 'silRim pins the rim to the from-light below k=0.5 and the to-light above');
ok(/rim : silRim\(\) \|\| '#cfe4ff'/.test(BB), 'the unit contour asks silRim(), not LIGHT.rim');
{
  const ctx = { LIGHT: { rim: '#live00' }, lightLerp: null };
  vm.createContext(ctx); vm.runInContext(SR, ctx);
  const at = (t) => { ctx.lightLerp = t == null ? null : { t, from: { rim: '#aaaaaa' }, to: { rim: '#bbbbbb' } }; return vm.runInContext('silRim()', ctx); };
  ok(at(null) === '#live00' && at(0) === '#aaaaaa' && at(0.49) === '#aaaaaa' && at(0.5) === '#bbbbbb' && at(0.99) === '#bbbbbb', 'silRim run for real: steady → live rim; k<0.5 → from; k≥0.5 → to');
}

/* ── the terrain key and the cross-fade ───────────────────────────────────── */
const TKP = fnText(BB, 'terrainKeyParts');
ok(/const lk = lightLerp \? \('L' \+ lightLerp\.id \+ '@' \+ Math\.round\(clamp\(lightLerp\.t, 0, 1\) \* TERR_MIX_Q\)\) : lightLk\(LIGHT\);/.test(TKP), 'during a lerp the terrain key names the lerp id and a quantised step, not the light');
ok(/return \{ base, lk, lerp: !!lightLerp \};/.test(TKP), 'terrainKeyParts splits base from the light term');
ok(/const TERR_MIX_Q = 16;/.test(BB), '16 cross-fade steps per lerp');
const TL = fnText(BB, 'terrainLayer');
ok(/if \(parts\.lerp && terrainMix\(parts\)\)\{ TERR\.key = key; return TERR\.cv; \}/.test(TL), 'terrainLayer serves a lerp step from terrainMix');
ok(/TERR\.ab\.toLk === parts\.lk/.test(TL) && /g\.drawImage\(TERR\.ab\.b, 0, 0\);/.test(TL), 'the lerp\'s end adopts the `to` bake instead of baking again');
ok(/__bbCount\('terrainBakes'\)/.test(TL) && /__bbCount\('terrainBakes'\)/.test(fnText(BB, 'bakeTerrainInto')) && /__bbCount\('terrainBakes'\)/.test(fnText(BB, 'terrainStage')), 'every paintTerrain path counts a terrain bake — the banded pair counts once, when it is whole');
const STD = fnText(BB, 'setTimeOfDay');
ok(/const lp = \{ from:\{\.\.\.LIGHT\}, to:\{\.\.\.TIME_PRESETS\[key\]\}, t:0, dur:2\.5, id:\+\+_lerpSeq \};/.test(STD), 'the lerp itself is unchanged: 2.5 s, from the live light');

/* ── round 2: the STAGED press ────────────────────────────────────────────── */
ok(/^let lightPending = null;/m.test(BB), 'lightPending: the lerp that is staged but not live');
ok(!/lightLerp = /.test(strip(STD)) && /lightPending = lp;/.test(STD) && /stageLerp\(lp\);/.test(STD), 'setTimeOfDay does not set lightLerp: it stages the press');
ok(/if \(lightLerp\) lightLerp\.hold = true;/.test(STD), 'a lerp still running is HELD while the new press stages');
ok(/if \(lightLerp && !lightLerp\.hold\)\{\s*lightLerp\.t \+= dt\/lightLerp\.dur;/.test(BB), 'update does not advance a held lerp');
ok(!/terrainLayer\(\)/.test(STD) && !/vista\.prime\(/.test(STD), 'nothing bakes in the press\'s own task');
ok(/dispatch\('timeOfDay', \{ key \}\);/.test(STD), 'the host event still fires at the press');
const SL = fnText(BB, 'stageLerp');
const SST = fnText(BB, 'stageSteps');
ok(/const steps = stageSteps\(lp\);/.test(SL), 'stageLerp runs the step list stageSteps builds');
ok(/if \(warm \? \(lightPending \|\| lightLerp\) : lightPending !== lp\) return;/.test(SL), 'a superseded press stops; a warm stands down for a real press or a lerp');
ok(/lightPending = null;\s*lightLerp = lp;\s*PRESS\.startMs/.test(SL), 'the lerp goes live on the task after the last step');
ok(/primeStep\(lerpApiFor\(lp\), j, part, b, n\)/.test(SST) && /typeof window\.BBX\.vista\.primeStep === 'function'/.test(SST), 'the plates are staged through vista.primeStep, feature-tested, band by band');
const LAF = fnText(BB, 'lerpApiFor');
ok(/api\.lightLerp = \{ k:0, dur:lp\.dur, id:lp\.id \};/.test(LAF) && /api\.lightAt = k => lightAtK\(k, lp\);/.test(LAF), 'a staged bake sees the pending lerp as if it were live');
ok(/function lightAtK\(k, lp\)\{\s*const L = lp \|\| lightLerp;/.test(BB), 'lightAtK evaluates a lerp that is not the live one');
ok(/if \(lightPending && TERR\.cv && TERR\.key && TERR\.key\.slice\(0, TERR\.key\.lastIndexOf\('\|'\)\) === parts\.base\) return TERR\.cv;/.test(TL), 'terrainLayer holds the on-screen ground while a press is staged (same base)');
ok(/function lerpJourney\(lp\)\{ return lightLk\(lp\.from\) \+ '>' \+ lightLk\(lp\.to\); \}/.test(BB), 'a journey is from-light > to-light, quantised like the steady key');
const TPF = fnText(BB, 'terrainPairFits');
ok(/if \(ab\.id === lp\.id\) return true;/.test(TPF) && /if \(ab\.journey === lerpJourney\(lp\)\)\{ ab\.id = lp\.id; return true; \}/.test(TPF), 'a pair serves a lerp by id or by journey (adopting the id)');
ok(/const WARM_NEXT = \{ day:'night', night:'day', dusk:'night', dawn:'day' \};/.test(BB), 'the likely next preset per time of day');
const WN = fnText(BB, 'warmNext');
ok(/if \(window\.__vistaOff && window\.__vistaOff\.warm\) return;/.test(WN) && /if \(lightLerp \|\| stagingNow\(\)\) \{ scheduleWarm\(\); return; \}/.test(WN) && /id:0, warm:true \};/.test(WN) && /stageLerp\(lp, true\);/.test(WN), 'warmNext stages the next preset without starting it; declines mid-transition and while anything is staging or draining; ablatable');
ok(/if \(TERR\.cv\.width \* TERR\.cv\.height > WARM_MAX_PX\) return;/.test(WN) && /const WARM_MAX_PX = 6e6;/.test(BB), 'no warm on an oversized canvas (memory)');
ok(/if \(lightLerp\.t>=1\) \{ lightLerp = null; scheduleWarm\(\); \}/.test(BB), 'a lerp\'s end schedules the warm');
ok(/__bbCount\('inits'\);[\s\S]{0,600}scheduleWarm\(1500\);/.test(BB.slice(BB.indexOf("if (t === 'init'){"), BB.indexOf("if (t === 'init'){") + 1200)), 'board:init schedules the warm 1.5 s in (round 3: the sliced warm takes ~35 frames, and must be done before a press 3 s in)');

/* ── round 3: SLICES, KICKS, ONE TASK PER FRAME, THE DRAIN ────────────────── */
ok(/const STAGE_BUDGET_MS = 16;/.test(BB) && /const STAGE_GPU_MS = 6;/.test(BB) && /const STAGE_DRAIN_MS = 250;/.test(BB), 'the three budgets: 16 ms of main thread a task, 6 ms of raster a task (the frame\'s spare), a 250 ms drain');
ok(/if \(ran && \(gpu > 0 \|\| \(now\(\) - tTask\) > 1\) && \(\(now\(\) - tTask\) \+ stageCost\(nm\) > STAGE_BUDGET_MS \|\| gpu \+ stageGpu\(nm\) > STAGE_GPU_MS\)\) break;/.test(SL), 'once a task has baked anything (or spent > 1 ms) it takes a further step only if its predicted main-thread cost AND its predicted raster fit what is left');
ok(/const did = stageWork\(\) !== w0 \|\| ms > 1;\s*if \(did\) STAGE_COST\[nm\] = ms;\s*if \(did\) gpu \+= stageGpu\(nm\);/.test(SL), 'a step that did work (a band or bake counter moved, or > 1 ms) learns its cost and charges its raster; a done step charges nothing');
ok(/function stageWork\(\)\{ return \(PERFC\.terrainBands \|\| 0\) \+ \(PERFC\.plateBands \|\| 0\) \+ \(PERFC\.artBakes \|\| 0\)/.test(BB), 'stageWork reads the band / art-bake counters');
ok(/_stageIdleUntil = now\(\) \+ STAGE_DRAIN_MS;\s*if \(i < steps\.length\)\{ stageNext\(run\); return; \}/.test(SL), 'every staging task arms the drain and hands the rest to the next frame');
ok(!/setTimeout\(run, 0\)/.test(SL), 'no task chains a setTimeout(0) to itself any more');
const SN = fnText(BB, 'stageNext');
ok(/_stageRaf = requestAnimationFrame\(go\);\s*_stageTimer = setTimeout\(go, 250\);/.test(SN) && /_stageTimer = setTimeout\(fn, 0\);/.test(SN), 'stageNext: the next task runs after the next frame (rAF, then setTimeout 0), or after 250 ms when there are no frames');
const SNOW = fnText(BB, 'stagingNow');
ok(/if \(lightPending \|\| _stageTimer \|\| _stageRaf\) return true;/.test(SNOW) && /return t < _stageIdleUntil;/.test(SNOW), 'stagingNow: a press pending, a task queued, or the drain still running');
ok(/staging: stagingNow\(\),/.test(BB), 'the stage api carries `staging` (the vista holds its readback on it)');
/* the step list */
ok(/const steps = \[\['terrainA', \(\) => terrainStage\(lp, -1\)\]\];\s*(\/\*[\s\S]*?\*\/\s*)?const nP = tileArtSrcs\(\)\.length;\s*for \(let p = 0; p < nP; p\+\+\) steps\.push\(\['terrainP' \+ p, \(\) => tileArtBitmap\(p\)\]\);\s*for \(let b = 0; b < TB\.n; b\+\+\) steps\.push\(\['terrainB' \+ b, \(\) => terrainStage\(lp, b\)\]\);/.test(SST), 'the ground: A in its own step, then the paintings\' one-time bitmaps one per step (sprites gauntlet round 4), then B one band per step');
ok(/steps\.push\(\['sky' \+ j \+ '\.' \+ b,\s*\(\) => plate\(j, 'sky', b, SKY_BANDS\)\]\);\s*steps\.push\(\['art' \+ j, \(\) => plate\(j, 'art'\)\]\);\s*steps\.push\(\['artB' \+ j, \(\) => plate\(j, 'artB'\)\]\);\s*for \(let b = 0; b < LAND_BANDS; b\+\+\) steps\.push\(\['land' \+ j \+ '\.' \+ b, \(\) => plate\(j, 'land', b, LAND_BANDS\)\]\);\s*for \(let b = 0; b < FAR_BANDS; b\+\+\)\s*steps\.push\(\['far' \+ j \+ '\.' \+ b,\s*\(\) => plate\(j, 'far', b, FAR_BANDS\)\]\);/.test(strip(SST)), 'each plate: sky bands, then the art grade in two steps (after its sky), then land bands, then far bands');
ok(/const SKY_BANDS = 4, LAND_BANDS = 6, FAR_BANDS = 2;/.test(BB) && /const TERR_BAND_PX = 80;/.test(BB), 'the band counts: 4 sky, 6 land, 2 far; ground bands of ~80 CSS px');
ok(/const STAGE_GPU = \{ terrainA:2, terrainP:0, terrainB:6, sky:6, land:8, art:20, artB:12, far:5 \};/.test(BB) && /const STAGE_GUESS = \{ terrainA:3, terrainP:11, terrainB:12, sky:1, land:6, art:8, artB:12, far:1 \};/.test(BB), 'every step kind has a raster estimate and a first-run guess (terrainP: 11 ms of decode, no raster)');
/* the ground bands */
const TB = fnText(BB, 'terrainBands');
ok(/const edges = \[0\];/.test(TB) && /edges\.push\(H\);/.test(TB) && /return \{ edges, n: edges\.length - 1 \};/.test(TB), 'terrainBands cuts the WHOLE canvas: 0 … H, the ground\'s extent finer');
const BTB = fnText(BB, 'bakeTerrainBand');
ok(/g\.save\(\); g\.beginPath\(\); g\.rect\(0, y0, W, y1 - y0\); g\.clip\(\);\s*g\.clearRect\(0, y0, W, y1 - y0\);/.test(BTB) && /try \{ paintTerrain\(\); \} finally \{ ctx = prevCtx; LIGHT = prevL; g\.restore\(\); \}/.test(BTB) && /__bbCount\('terrainBands'\)/.test(BTB), 'bakeTerrainBand: paintTerrain under a clip to the band, ctx/LIGHT swapped back in a finally, counted');
const TS = fnText(BB, 'terrainStage');
ok(/if \(!lp \|\| !TERR\.cv \|\| !TERR\.key \|\| CAMERA\.moving\) return false;/.test(TS) && /if \(terrainPairFits\(lp, parts\.base\)\) return true;/.test(TS), 'terrainStage declines with no ground or a moving camera, and is a no-op for a pair that already fits');
ok(/if \(cur === parts\.base\) a\.getContext\('2d'\)\.drawImage\(TERR\.cv, 0, 0\);\s*else bakeTerrainInto\(a, lp\.from\);\s*terrainFlush\(a\);\s*TERR\.stage = \{ id: lp\.id, journey, base: parts\.base, a, b, toLk: lightLk\(lp\.to\), bands: terrainBands\(\), done: 0 \};/.test(TS), 'band -1: A is the on-screen ground copied (baked whole only for another base), kicked, and the pair-in-progress is opened');
ok(/if \(!st \|\| st\.journey !== journey \|\| st\.base !== parts\.base\) return false;\s*if \(band !== st\.done\) return band < st\.done;/.test(TS), 'a band for another journey / base declines; bands are taken in order, a band out of turn reports whether it is done');
ok(/bakeTerrainBand\(st\.b, lp\.to, y0, y1\);\s*terrainFlush\(st\.b, Math\.floor\(y0 \* DPR\)\);\s*st\.done\+\+;\s*if \(st\.done >= nb\)\{\s*__bbCount\('terrainBakes'\);\s*TERR\.ab = \{ id: st\.id, base: st\.base, a: st\.a, b: st\.b, toLk: st\.toLk, journey: st\.journey \};\s*TERR\.stage = null;/.test(TS), 'each band is baked and kicked; the pair becomes TERR.ab only when the last band lands');
/* the kick */
const SK = fnText(BB, 'stageKick');
ok(/if \(o\.stageread\)\{ canvas\.getContext\('2d'\)\.getImageData\(0, y, 1, 1\); return; \}/.test(SK) && /_kickCv\.getContext\('2d'\)\.drawImage\(canvas, 0, y, 1, 1, 0, 0, 1, 1\);/.test(SK) && /_kickCv\.width = _kickCv\.height = 256;/.test(SK) && /if \(o\.stageflush\) return;/.test(SK), 'stageKick draws one pixel of the staged canvas into a 256px scratch — a flush without a sync; __vistaOff.stageread restores the readback, stageflush ablates');
ok(/function terrainFlush\(canvas, yDev\)\{ stageKick\(canvas, yDev\); \}/.test(BB), 'the ground\'s flush is the kick');

/* stageLerp, run for real with fake timers and frames */
{
  const log = { steps: [], count: {}, tasks: [] };
  const timers = []; let rafs = [];
  let clock = 0; let cost = 0;                 /* cost: what each step that does work spends */
  let work = true;                             /* whether the stubbed steps "do work" (bump a counter) */
  const ctx = {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (id > 0 && timers[id - 1]) timers[id - 1] = null; },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    cancelAnimationFrame: (id) => { if (id > 0 && rafs[id - 1]) rafs[id - 1] = null; },
    performance: { now: () => clock },
    PERFC: { terrainBands: 0, plateBands: 0, artBakes: 0, terrainBakes: 0, plateBakes: 0 },
    window: { BBX: { vista: { primeStep: (api, j, part, b, n) => { log.steps.push(part + j + (b == null ? '' : '.' + b) + ':' + api.lightLerp.id); if (work) { ctx.PERFC.plateBands++; clock += cost; } return true; } } } },
    __bbCount: (k) => { log.count[k] = (log.count[k] || 0) + 1; },
    terrainStage: (lp, band) => { log.steps.push((band < 0 ? 'terrainA' : 'terrainB' + band) + ':' + lp.id); if (work) { ctx.PERFC.terrainBands++; clock += cost; } return true; },
    terrainBands: () => ({ edges: [0, 40, 80], n: 2 }),
    /* no paintings in the sandbox: the bitmap steps (round 4) add nothing to the sequence */
    tileArtSrcs: () => [], tileArtBitmap: () => false,
    buildApi: () => ({}),
    lightAtK: (k, lp) => ({ k, id: lp.id }),
    lightPending: null, lightLerp: null,
    PRESS: { id: 0, key: '', steps: [], warmSteps: [], pressMs: 0, startMs: null, at: 0 },
  };
  vm.createContext(ctx);
  vm.runInContext([
    constLine('STAGE_BUDGET_MS'), constLine('STAGE_COST'), constLine('STAGE_GUESS'), constLine('STAGE_GPU'), constLine('STAGE_GPU_MS'), constLine('STAGE_DRAIN_MS'),
    'const SKY_BANDS = 4, LAND_BANDS = 6, FAR_BANDS = 2;',
    'let _stageTimer = 0; let _stageRaf = 0; let _stageIdleUntil = 0;',
    fnText(BB, 'stageKind'), fnText(BB, 'stageCost'), fnText(BB, 'stageGpu'), fnText(BB, 'stageWork'),
    fnText(BB, 'lerpApiFor'), fnText(BB, 'stageSteps'), fnText(BB, 'stageLerp'), fnText(BB, 'stagingNow'), fnText(BB, 'stageCancel'), fnText(BB, 'stageNext'),
    'this.go = (lp, warm) => stageLerp(lp, warm); this.stagingNow = stagingNow; this.idleUntil = () => _stageIdleUntil;',
  ].join('\n'), ctx);
  /* a frame: the rAF callbacks run, then the setTimeout(0)s they posted */
  const frame = () => { const r = rafs; rafs = []; for (const fn of r) if (fn) fn(); clock += 1; let ran = 0; for (let i = 0; i < timers.length; i++) { const t = timers[i]; if (t && t.ms === 0) { timers[i] = null; const n0 = log.steps.length; t.fn(); ran++; log.tasks.push(log.steps.length - n0); } } return ran; };
  const drain = () => { let n = 0; while (rafs.some(Boolean) || timers.some(t => t && t.ms === 0)) { n += frame(); if (n > 400) throw new Error('runaway'); } return n; };
  const EXPECT = (id) => {
    const s = ['terrainA', 'terrainB0', 'terrainB1'];
    for (let j = 0; j < 2; j++) { for (let b = 0; b < 4; b++) s.push('sky' + j + '.' + b); s.push('art' + j, 'artB' + j); for (let b = 0; b < 6; b++) s.push('land' + j + '.' + b); for (let b = 0; b < 2; b++) s.push('far' + j + '.' + b); }
    return s.map(x => x + ':' + id).join(' ');
  };
  cost = 10;
  const lp = { id: 7, dur: 2.5, from: {}, to: {} };
  ctx.lightPending = lp;
  ctx.go(lp);
  ok(ctx.lightLerp === null && log.steps.length === 0 && ctx.stagingNow() === true, 'the press\'s own task stages nothing and starts nothing; staging is on');
  ok(rafs.filter(Boolean).length === 1 && timers.filter(t => t && t.ms === 250).length === 1 && !timers.some(t => t && t.ms === 0), 'the first task waits for a frame (one rAF, one 250 ms stand-in, no setTimeout 0 yet)');
  const tasks = drain();
  ok(ctx.lightLerp === lp && ctx.lightPending === null, 'after the frames the pending lerp is live', JSON.stringify({ lerp: ctx.lightLerp && ctx.lightLerp.id, pending: ctx.lightPending }));
  ok(log.steps.join(' ') === EXPECT(7), 'the 31 steps run in order: ground A, ground bands, then per plate sky bands → art → artB → land bands → far bands, all for the pending lerp', log.steps.join(' '));
  ok(tasks === log.count.stageTasks && tasks === 31 && log.tasks.every(n => n === 1), 'every step did work at 10 ms: one step per task, 31 tasks, one per frame', JSON.stringify({ tasks, counted: log.count.stageTasks, perTask: log.tasks.join('') }));
  ok(ctx.PRESS.steps.length === 31 && ctx.PRESS.steps.every(s => s.ok), '__bbPerf().press records all 31 steps');
  ok(ctx.stagingNow() === true && ctx.idleUntil() > clock, 'the drain: staging stays on after the last task');
  clock = ctx.idleUntil() + 1;
  ok(ctx.stagingNow() === false, '…and ends STAGE_DRAIN_MS later');
  /* the raster budget alone: cheap steps that bake (a sky band records in 0.2 ms) still take one task each */
  log.steps.length = 0; log.tasks.length = 0; ctx.lightLerp = null; cost = 0.2;
  const lpB = { id: 11, dur: 2.5, from: {}, to: {} }; ctx.lightPending = lpB; ctx.go(lpB); drain();
  ok(ctx.lightLerp === lpB && log.tasks.every(n => n === 1), 'steps that record in 0.2 ms but bake are still one per task — the raster budget, not the clock, decides', log.tasks.join(''));
  /* a warmed press: every step finds its work done (no counter moves, no time) — one task, then live */
  log.steps.length = 0; log.tasks.length = 0; ctx.lightLerp = null; work = false;
  const lpW = { id: 12, dur: 2.5, from: {}, to: {} }; ctx.lightPending = lpW; ctx.go(lpW); const tW = drain();
  ok(ctx.lightLerp === lpW && tW === 1 && log.tasks[0] === 31, 'a warmed press: 31 done-steps in ONE task, live on the next frame', JSON.stringify({ tasks: tW, perTask: log.tasks.join(',') }));
  work = true; cost = 10;
  /* a second press supersedes the first: the old one's remaining tasks do nothing */
  log.steps.length = 0; ctx.lightLerp = null;
  const p1 = { id: 8, dur: 2.5, from: {}, to: {} }, p2 = { id: 9, dur: 2.5, from: {}, to: {} };
  ctx.lightPending = p1; ctx.go(p1); frame(); frame();
  ctx.lightPending = p2; ctx.go(p2); drain();
  const first9 = log.steps.findIndex(x => /:9$/.test(x));
  ok(ctx.lightLerp === p2 && first9 > 0 && !log.steps.slice(first9).some(x => /:8$/.test(x)) && log.steps.filter(x => /:9$/.test(x)).length === 31, 'a newer press supersedes: the old one runs no step after it, the new one runs all 31 and goes live', log.steps.slice(0, 6).join(' '));
  /* a warm: same steps, nothing goes live, and it stands down for a real lerp */
  log.steps.length = 0; ctx.lightLerp = null; ctx.lightPending = null;
  const w = { id: 0, dur: 2.5, from: {}, to: {}, warm: true };
  ctx.PRESS.steps.length = 0; ctx.PRESS.warmSteps.length = 0;
  ctx.go(w, true); drain();
  ok(ctx.lightLerp === null && ctx.lightPending === null && log.steps.filter(x => /:0$/.test(x)).length === 31 && log.count.warms === 1, 'a warm runs all 31 steps and starts no lerp', JSON.stringify({ steps: log.steps.length, warms: log.count.warms }));
  ok(ctx.PRESS.warmSteps.length === 31 && ctx.PRESS.steps.length === 0, 'the warm\'s steps are reported apart from the press\'s');
  log.steps.length = 0;
  ctx.go(w, true); ctx.lightLerp = { id: 99 }; drain();
  ok(log.steps.length === 0 && log.count.warms === 1, 'a warm stands down when a lerp is live');
}

/* the terrain path with a PENDING lerp, run for real with fake canvases:
   the whole-pair step (round 2), then the banded protocol (round 3) */
{
  const calls = { paint: 0, reads: 0, kicks: 0, clips: 0, count: {} };
  let kick = null;
  const mkCtx = (owner) => ({ setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() { calls.clips++; },
    drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) { if (owner === kick && sw === 1 && sh === 1) calls.kicks++; owner._drew = src; },
    getImageData() { calls.reads++; return {}; }, globalAlpha: 1, globalCompositeOperation: 'source-over' });
  const mkCanvas = () => { const c = { width: 0, height: 0 }; c.getContext = () => (c._g || (c._g = mkCtx(c))); return c; };
  const ctx = {
    document: { createElement: () => { const c = mkCanvas(); if (!kick && ctx.__wantKick) { kick = c; } return c; } }, performance: { now: () => 0 }, window: {},
    __bbCount: (k) => { calls.count[k] = (calls.count[k] || 0) + 1; },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    W: 100, H: 80, DPR: 1, VIEW: { cx: 0, cy: 0, scale: 1 }, MAP: { cols: 10, rows: 8 }, MAPSIG: 0,
    CONFIG: { wall: 1, camera: { pos: { x: 0, y: 1, z: 2 }, target: { x: 0, z: 0 } } }, CAMERA: { yaw: 0, moving: false },
    GROUND: { img: null, key: '', fade: 1 }, tileArtLoaded: () => 0,
    cv: { width: 100, height: 80 }, ctx: mkCtx(null),
    LIGHT: { key: '#e9e5ce', fog: '#3a4454', keyI: 1.15, elev: 1.1, az: 0.8, ambI: 0.6, rim: '#cfe4ff' },
    lightLerp: null, lightPending: null,
    paintTerrain: () => { calls.paint++; },
    /* the ground's screen extent for terrainBands: rows 20 … 60 of an 80-row canvas */
    groundExtent: () => ({ x: 5, far: 4, near: 4 }), gp: (x, z) => ({ x, z }), project: (p) => ({ x: 0, y: 40 + p.z * 4 }),
  };
  vm.createContext(ctx);
  vm.runInContext([
    "const TERR = { cv:null, g:null, key:'', ms:0, ab:null, stage:null };", 'const TERR_MIX_Q = 16;', constLine('TERR_BAND_PX'), 'let _kickCv = null;',
    fnText(BB, 'lightLk'), fnText(BB, 'terrainKey'), TKP, fnText(BB, 'bakeTerrainInto'), fnText(BB, 'terrainPrepLerp'),
    fnText(BB, 'lerpJourney'), fnText(BB, 'terrainPairFits'), fnText(BB, 'terrainBands'), fnText(BB, 'bakeTerrainBand'), fnText(BB, 'stageKick'), fnText(BB, 'terrainFlush'),
    fnText(BB, 'terrainStage'), fnText(BB, 'terrainMix'), TL,
    'this.TERR = TERR;'
  ].join('\n'), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  run('terrainLayer();');
  const NIGHT = { key: '#8ea0c8', fog: '#050a18', keyI: 0.48, elev: 0.9, az: 2.4, ambI: 0.3, rim: '#6f9ce8' };
  /* ── the whole-pair step (band omitted) ── */
  const lp = { id: 3, t: 0, from: Object.assign({}, ctx.LIGHT), to: NIGHT };
  ctx.lightPending = lp;
  const staged = run('terrainStage(lightPending)');
  ok(staged === true && calls.paint === 2 && calls.reads === 0 && ctx.TERR.ab && ctx.TERR.ab.id === 3, 'terrainStage (whole): one bake for the to-light, A copied, both KICKED — no readback', JSON.stringify({ staged, paint: calls.paint, reads: calls.reads }));
  ok(run('terrainStage(lightPending)') === true && calls.paint === 2, 'staging again is a no-op');
  const held = run('terrainLayer()');
  ok(held === ctx.TERR.cv && calls.paint === 2 && !calls.count.terrainMixes, 'while the press is staged the on-screen ground is held — no bake, no mix');
  ctx.lightPending = null; ctx.lightLerp = lp;
  for (let i = 0; i <= 50; i++) { ctx.lightLerp.t = i / 50; run('terrainLayer();'); }
  ok(calls.paint === 2 && calls.count.terrainMixes === 17, 'the lerp then mixes the staged pair: 0 bakes over 50 frames', JSON.stringify({ paint: calls.paint, mixes: calls.count.terrainMixes }));
  ctx.LIGHT = Object.assign({}, NIGHT); ctx.lightLerp = null; run('terrainLayer();');
  ok(calls.paint === 2 && ctx.TERR.ab === null, 'the lerp\'s end adopts B, no bake');
  /* ── the banded protocol ── */
  const bands = run('terrainBands()');
  ok(bands.edges[0] === 0 && bands.edges[bands.edges.length - 1] === 80 && bands.edges.every((e, i) => i === 0 || e > bands.edges[i - 1]) && bands.n === bands.edges.length - 1 && bands.n >= 3, 'terrainBands run for real: edges climb from 0 to H, the ground\'s rows cut finer, the rows above and below are bands too', JSON.stringify(bands));
  const lp2 = { id: 21, t: 0, from: Object.assign({}, ctx.LIGHT), to: Object.assign({}, ctx.LIGHT, { key: '#e9e5ce', keyI: 1.15 }) };
  ctx.lightPending = lp2;
  const p0 = calls.paint, c0 = calls.clips, b0 = calls.count.terrainBakes || 0, tb0 = calls.count.terrainBands || 0;
  ok(run('terrainStage(lightPending, -1)') === true && ctx.TERR.stage && ctx.TERR.stage.id === 21 && ctx.TERR.stage.done === 0 && ctx.TERR.stage.a._drew === ctx.TERR.cv && calls.paint === p0 && ctx.TERR.ab === null, 'band -1 opens the pair: A is a COPY of the on-screen ground (no paint), nothing adopted yet', JSON.stringify({ paint: calls.paint - p0, stage: !!ctx.TERR.stage }));
  ok(run('terrainStage(lightPending, 1)') === false && ctx.TERR.stage.done === 0, 'a band out of turn is refused (not done)');
  ok(run('terrainStage(lightPending, 0)') === true && calls.paint === p0 + 1 && calls.clips === c0 + 1 && ctx.TERR.stage.done === 1 && ctx.TERR.ab === null && (calls.count.terrainBands || 0) === tb0 + 1, 'band 0: one paintTerrain under one clip, counted as a band, still not adopted');
  ok(run('terrainStage(lightPending, 0)') === true && calls.paint === p0 + 1, 'a band already done reports done without painting');
  const other = { id: 22, t: 0, from: Object.assign({}, ctx.LIGHT), to: Object.assign({}, NIGHT, { keyI: 0.2 }) };
  ok(run('terrainStage(' + JSON.stringify(other) + ', 1)') === false && ctx.TERR.stage.id === 21, 'a band for another journey declines and leaves the pair-in-progress alone');
  for (let b = 1; b < bands.n; b++) run('terrainStage(lightPending, ' + b + ')');
  ok(calls.paint === p0 + bands.n && ctx.TERR.stage === null && ctx.TERR.ab && ctx.TERR.ab.id === 21 && ctx.TERR.ab.journey === run('lerpJourney(lightPending)') && (calls.count.terrainBakes || 0) === b0 + 1, 'the last band adopts the pair as TERR.ab (journey-keyed) and counts ONE terrain bake', JSON.stringify({ paint: calls.paint - p0, n: bands.n, ab: ctx.TERR.ab && ctx.TERR.ab.id, bakes: (calls.count.terrainBakes || 0) - b0 }));
  ok(calls.reads === 0, 'not one getImageData anywhere in the staged path');
  /* a WARM pair (id 0) is adopted by the press for the same journey */
  ctx.lightPending = null; ctx.TERR.ab = null;
  const warm = { id: 0, t: 0, from: Object.assign({}, ctx.LIGHT), to: Object.assign({}, ctx.LIGHT, { key: '#e9e5ce', keyI: 1.15 }), warm: true };
  const pw = calls.paint;
  ok(run('terrainStage(' + JSON.stringify(warm) + ')') === true && calls.paint === pw + 1 && ctx.TERR.ab.id === 0, 'a warm stages a pair under id 0');
  const press = Object.assign({}, warm, { id: 4, warm: false });
  ok(run('terrainStage(' + JSON.stringify(press) + ', -1)') === true && calls.paint === pw + 1 && ctx.TERR.ab.id === 4 && ctx.TERR.stage === null, 'the press for that journey adopts the warm pair (id taken over, no bake, no pair-in-progress)');
}

/* the terrain path, run for real with fake canvases (round 1's in-lerp path, unchanged) */
{
  const calls = { paint: 0, draws: [], count: {} };
  const mkCtx = () => ({ setTransform() {}, clearRect() {}, drawImage(src) { calls.draws.push(src && src._id); }, globalAlpha: 1, globalCompositeOperation: 'source-over' });
  let cid = 0;
  const mkCanvas = () => { const c = { _id: 'c' + (++cid), width: 0, height: 0 }; c.getContext = () => (c._g || (c._g = mkCtx())); return c; };
  const ctx = {
    document: { createElement: () => mkCanvas() },
    performance: { now: () => 0 },
    window: { BBX: null },
    __bbCount: (k) => { calls.count[k] = (calls.count[k] || 0) + 1; },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    W: 100, H: 80, DPR: 1, VIEW: { cx: 0, cy: 0, scale: 1 }, MAP: { cols: 10, rows: 8 }, MAPSIG: 0,
    CONFIG: { camera: { pos: { x: 0, y: 1, z: 2 }, target: { x: 0, z: 0 } } }, CAMERA: { yaw: 0, moving: false },
    GROUND: { img: null, key: '', fade: 1 }, tileArtLoaded: () => 0,
    cv: { width: 100, height: 80 }, ctx: mkCtx(),
    LIGHT: { key: '#e9e5ce', fog: '#3a4454', keyI: 1.15, elev: 1.1, az: 0.8, ambI: 0.6, rim: '#cfe4ff' },
    lightLerp: null, lightPending: null,
    paintTerrain: () => { calls.paint++; },
  };
  vm.createContext(ctx);
  const src = [
    "const TERR = { cv:null, g:null, key:'', ms:0, ab:null, stage:null };",
    'const TERR_MIX_Q = 16;',
    fnText(BB, 'lightLk'), fnText(BB, 'terrainKey'), TKP, fnText(BB, 'bakeTerrainInto'), fnText(BB, 'terrainPrepLerp'),
    fnText(BB, 'lerpJourney'), fnText(BB, 'terrainPairFits'), fnText(BB, 'terrainMix'), TL,
    'this.TERR = TERR;'
  ].join('\n');
  vm.runInContext(src, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  run('terrainLayer(); terrainLayer();');
  ok(calls.paint === 1 && calls.count.terrainBakes === 1, 'steady: one bake, the second call is a cache hit', JSON.stringify(calls.count));
  const NIGHT = { key: '#8ea0c8', fog: '#050a18', keyI: 0.48, elev: 0.9, az: 2.4, ambI: 0.3, rim: '#6f9ce8' };
  ctx.lightLerp = { id: 1, t: 0, from: Object.assign({}, ctx.LIGHT), to: NIGHT };
  run('terrainLayer();');
  ok(calls.paint === 2 && calls.count.terrainBakes === 2 && calls.count.terrainMixes === 1, 'lerp start (unstaged): ONE bake (the `to` light), A copied from the screen, one mix', JSON.stringify(calls.count));
  ok(ctx.TERR.ab && ctx.TERR.ab.id === 1 && ctx.TERR.ab.toLk === run('lightLk(lightLerp.to)'), 'the pair is named by the lerp id and the `to` light');
  const keys = new Set();
  for (let i = 1; i <= 50; i++) { ctx.lightLerp.t = i / 50; ctx.LIGHT = { key: '#000000', fog: '#111111', keyI: 1 + i, elev: i, az: i, ambI: i, rim: '#123456' }; run('terrainLayer();'); keys.add(ctx.TERR.key); }
  ok(calls.paint === 2 && calls.count.terrainMixes === 17 && keys.size === 17, '50 frames of a lerp with the live light changing every frame: 0 bakes, 16 new mix steps', JSON.stringify({ paint: calls.paint, mixes: calls.count.terrainMixes, keys: keys.size }));
  ctx.LIGHT = Object.assign({}, NIGHT); ctx.lightLerp = null;
  run('terrainLayer();');
  ok(calls.paint === 2 && ctx.TERR.ab === null && ctx.TERR.key.endsWith('|' + run('lightLk(LIGHT)')), 'the lerp ends: B is adopted as the steady bake for the new light, no bake', JSON.stringify({ paint: calls.paint, key: ctx.TERR.key }));
  run('terrainLayer();');
  ok(calls.paint === 2, '…and the next steady frame is a cache hit');
  ctx.LIGHT = Object.assign({}, NIGHT, { keyI: 0.9 });
  run('terrainLayer();');
  ok(calls.paint === 3, 'a steady light change (no lerp) still rebakes');
  ctx.lightLerp = { id: 2, t: 0.1, from: Object.assign({}, ctx.LIGHT), to: Object.assign({}, ctx.LIGHT, { key: '#e9e5ce' }) };
  run('terrainLayer();'); const p0 = calls.paint;
  ctx.CONFIG.camera.pos.x = 5; ctx.lightLerp.t = 0.2; run('terrainLayer();');
  ok(calls.paint === p0 + 2 && ctx.TERR.ab && ctx.TERR.ab.base.includes('5000'), 'a base change mid-lerp rebuilds both endpoints for the new eye (A cannot be copied)', JSON.stringify({ p0, paint: calls.paint }));
}

/* ── the vista ────────────────────────────────────────────────────────────── */
ok(/const PLATE_K = \[0, 1\];/.test(VISTA), 'PLATE_K is the two endpoints');
ok(/function prime\(api\)/.test(VISTA) && /ladderStep\(api, K\.dpr, lp, K\.sig, K\.artWins, K\.settled, true\)/.test(VISTA), 'prime() bakes every rung through the ladder\'s own step');
ok(/window\.BBX\.vista = \{ draw: draw, grade: grade, prime: prime, primeStep: primeStep \};/.test(VISTA), 'prime and primeStep are exported on BBX.vista');
const PS = fnText(VISTA, 'primeStep');
ok(/function primeStep\(api, j, part, band, nb\)/.test(PS) && /const journey = journeyOf\(api, K\.sig\);/.test(PS) && /if \(!St \|\| St\.journey !== journey\) \{/.test(PS), 'primeStep takes a band of a part and stages into a set keyed by journey');
ok(/return sig \+ '\|' \+ lightKey\(a\) \+ '>' \+ lightKey\(b\);/.test(fnText(VISTA, 'journeyOf')), 'a journey is the signature plus both lights, keyed like the steady bake');
ok(/const y0 = Math\.floor\(api\.H \* bi \/ n\), y1 = bi >= n - 1 \? api\.H : Math\.floor\(api\.H \* \(bi \+ 1\) \/ n\);/.test(PS) && /if \(!Wp\[kind\]\) \{ const o = mkCanvas\(api\.W, api\.H, K\.dpr\); if \(!o\.g\) return null; Wp\[kind\] = o; \}/.test(PS), 'a part\'s bands cut the height evenly into ONE canvas kept until whole');
ok(/if \(bi !== P\.sky\) return bi < P\.sky;[\s\S]*if \(!bakeSky\(p, K\.dpr, t\)\) return false;\s*flushBake\(t\.cv, t\.y0 \* K\.dpr\);[\s\S]*P\.sky\+\+;\s*if \(P\.sky >= n\) St\.sky\[j\] = t\.cv;/.test(PS) && /if \(!bakeLand\(p, K\.dpr, K\.artWins, t\)\) return false;/.test(PS) && /if \(!bakeFar\(p, K\.dpr, K\.settled, t\)\) return false;/.test(PS), 'sky / land / far bands: in order, each baked under the band and kicked, the part whole on its last band');
ok(/function bandInto\(into, W, H, dpr\)/.test(VISTA) && /g\.save\(\); g\.setTransform\(dpr, 0, 0, dpr, 0, 0\); g\.beginPath\(\); g\.rect\(0, into\.y0, W, into\.y1 - into\.y0\); g\.clip\(\);/.test(fnText(VISTA, 'bandInto')) && /function bandDone\(o, into\) \{ if \(into && o\.g\) o\.g\.restore\(\); return o\.cv; \}/.test(VISTA), 'a band bake is the whole bake under a clip (bandInto), lifted after (bandDone)');
ok(/function bakeSky\(api, dpr, into\)/.test(VISTA) && /function bakeLand\(api, dpr, artWins, into\)/.test(VISTA) && /function bakeFar\(api, dpr, withArt, into\)/.test(VISTA) && (VISTA.match(/return bandDone\(o, into\);/g) || []).length === 3, 'the three plate bakes take `into` and return through bandDone');
/* the art grade: over its rung's sky, in two steps */
ok(/if \(want === 'art'\) \{[\s\S]*if \(!St\.sky\[j\]\) return false;\s*S\.sky\.cv = St\.sky\[j\];[\s\S]*const sp = \{\};\s*const cv = artForLight\(p, K\.img, K\.dpr, sp\);\s*if \(!cv\) return false;\s*if \(sp\.finish\) \{ St\.artWip\[j\] = sp; flushBake\(cv\); \}/.test(PS), 'the art step waits for its rung\'s sky, grades OVER it (S.sky.cv swapped in), records the grade and kicks it');
ok(/if \(want === 'artB'\) \{[\s\S]*const sp = St\.artWip\[j\];\s*if \(!sp \|\| !St\.sky\[j\]\) return false;\s*S\.sky\.cv = St\.sky\[j\];[\s\S]*St\.art\[j\] = sp\.finish\(\);/.test(PS), 'artB finishes the recorded grade a task later, over the same sky');
ok(/function bakeArt\(api, img, dpr, split\)/.test(VISTA) && /const finish = function \(\) \{\s*const artL = meanLuma\(o\.cv,/.test(VISTA) && /if \(split\) \{ split\.finish = finish; return o\.cv; \}\s*return finish\(\);/.test(VISTA), 'bakeArt is split at its first readback: finish() holds the readbacks and the tail; the steady path calls it at once');
{ const BA = strip(fnText(VISTA, 'bakeArt')); const f = BA.indexOf('const finish = function () {'); ok(f > 0 && !/getImageData|meanLuma\(/.test(BA.slice(0, f).replace(/DET = \(S\.detCache[^\n]*artDetField[^\n]*/, '')) && /meanLuma\(S\.sky\.cv/.test(BA.slice(f)), 'nothing before the split reads a canvas back (the detail field is cached by geometry); the sky\'s luma is read inside finish'); }
ok(/const k = img\.src \+ '\|' \+ lightKey\(api\) \+ '\|' \+ dpr \+ '\|' \+ api\.W \+ 'x' \+ api\.H;/.test(fnText(VISTA, 'artForLight')) && /const ART_LIGHTS = 3;/.test(VISTA), 'the graded art is cached per image, light AND geometry (three lights)');
ok(/if \(window\.__bbCount\) window\.__bbCount\('artBakes'\);\s*const remember = function \(c\) \{/.test(fnText(VISTA, 'artForLight')) && /if \(split && split\.finish\) \{ const fin = split\.finish; split\.finish = function \(\) \{ return remember\(fin\(\)\); \}; return cv; \}/.test(fnText(VISTA, 'artForLight')), 'a split bake counts at its recording and is remembered when it finishes');
ok(/if \(rec && rec\.lk && rec\.lk !== lightKey\(api\)\) rec = null;/.test(fnText(VISTA, 'artCanvas')) && /if \(St\.art\[j\] && K\.img\) \{ S\.art\.clear\(\); S\.art\.set\(K\.img\.src, \{ cv: St\.art\[j\], lk: lightKey\(p\) \}\); \}/.test(PS), 'the far step composes the rung\'s own graded art; an entry graded at another light is never served');
ok(/const dk = \[img\.src, dpr, W, H, detBand, blurPx\.toFixed\(2\), ax\.toFixed\(1\), ay\.toFixed\(1\), aw\.toFixed\(1\), ah\.toFixed\(1\)\]\.join\('\|'\);\s*DET = \(S\.detCache && S\.detCache\.k === dk\) \? S\.detCache\.v : artDetField\(sh\.cv, dpr, W, detBand, blurPx\);/.test(VISTA), 'the detail field (a readback) is cached by image and geometry — never by light');
/* the kick, the restore, the adoption */
const FB = fnText(VISTA, 'flushBake');
ok(/if \(off\('stageread'\)\) \{ const g = cv\.getContext\('2d'\); if \(g\) g\.getImageData\(0, y, 1, 1\); return; \}/.test(FB) && /kickCv\.getContext\('2d'\)\.drawImage\(cv, 0, y, 1, 1, 0, 0, 1, 1\);/.test(FB) && /off\('stageflush'\)/.test(FB), 'flushBake is a kick (one pixel into a scratch canvas); __vistaOff.stageread restores the readback, stageflush ablates');
ok(/const keep = \{ skyCv: S\.sky\.cv, skyKey: S\.sky\.key, landCv: S\.land\.cv, landKey: S\.land\.key, worldKey: S\.world\.key, art: Array\.from\(S\.art\) \};/.test(PS) && /finally \{[\s\S]*S\.sky\.cv = keep\.skyCv; S\.sky\.key = keep\.skyKey; S\.land\.cv = keep\.landCv; S\.land\.key = keep\.landKey; S\.world\.key = keep\.worldKey;\s*S\.art\.clear\(\);/.test(PS), 'the steady sky/land, their keys and the art cache are put back — the frames before the lerp see nothing');
ok(!/S\.blend|S\.lastBake|L\.far\[|S\.ladder/.test(strip(PS)), 'primeStep never touches the live ladder or the blend');
ok(/if \(St && St\.journey === journeyOf\(api, sig\)\) \{[\s\S]*if \(St\.far\[j\] && St\.near\[j\]\) \{ L\.far\[j\] = St\.far\[j\]; L\.near\[j\] = St\.near\[j\]; \}/.test(fnText(VISTA, 'ladderStep')), 'ladderStep adopts the staged whole rungs for its journey when the lerp goes live');
ok(/staged: null,/.test(VISTA) && /S\.staged = null;/.test(fnText(VISTA, 'ladderStep')), 'the staged set is dropped once adopted');
ok(/const want = all \? PLATE_K\.map\(function \(_, j\) \{ return j; \}\)/.test(VISTA) && /if \(!all\) break;/.test(VISTA), 'ladderStep bakes one rung per frame unless primed');
ok(/function ladderPark\(sig, skyKey, landKey, worldKey\)/.test(VISTA) && /S\.blend = \{ farA: L\.far\[last\], nearA: L\.near\[last\], farB: null, nearB: null, f: 0 \};/.test(VISTA), 'ladderPark keeps the last rung as the steady sky');
ok(/if \(ladderPark\(K\.sig, skyKey, landKey, worldKey\)\) return;\s*ladderRetire\(\);/.test(VISTA), 'ensureBakes parks before it would re-bake');
ok(/if \(L\.parked\) return L\.parked === pk;/.test(VISTA), 'a park is released when any steady key moves');
ok(/L\.parked = '';/.test(fnText(VISTA, 'ladderRetire')), 'ladderRetire clears the park');
ok(/if \(S\.post\.ready && \(api\.lightLerp \|\| api\.staging\) && !off\('lerpmap'\)\) \{ S\.post\.age\+\+; return S\.post; \}/.test(VISTA), 'postMap skips its readback while the light lerps AND while the board is staging or draining (__vistaOff.lerpmap restores it)');
{ const pm = fnText(VISTA, 'postMap'); ok(pm.indexOf("off('lerpmap')") < pm.indexOf('gt.getImageData('), 'the skip sits before the getImageData'); }
/* the tile-fx ground capture is the other main-canvas readback in the transition */
{
  const TFX = readFileSync('./public/src/battle/stage/tilefx.js', 'utf8').replace(/\r\n/g, '\n');
  const SG = fnText(TFX, 'scheduleGround');
  ok(/if \(api\.lightLerp \|\| api\.staging\) return;/.test(SG) && SG.indexOf('if (api.lightLerp || api.staging) return;') < SG.indexOf('_bgPend = 1;'), 'tilefx.scheduleGround holds its main-canvas readback while the light lerps or the board is staging — before it arms the capture');
  ok(/getImageData\(0, 0, dw, dh\)/.test(fnText(TFX, 'captureGround')), '(captureGround is a readback, which is why)');
}
ok(/__bbCount\('plateBakes'\)/.test(VISTA) && /__bbCount\('steadyBakes'\)/.test(VISTA) && /__bbCount\('postReads'\)/.test(VISTA) && /__bbCount\('plateBands'\)/.test(VISTA), 'plate / steady / readback / band counts reach the board\'s counters');
ok(/const dk = \(window\.BBX && window\.BBX\.terrain/.test(BB), 'the terrain-detail module term survives in the key');

/* primeStep's art steps, run for real with a fake bakeArt: the sky swap, the two-step finish, the restore */
{
  const log = { swapAt: [], finishAt: [], kicks: 0 };
  const SKY = { id: 'rungSky' }, DAYSKY = { id: 'daySky' };
  const S = { staged: null, sky: { cv: DAYSKY, key: 'dk' }, land: { cv: { id: 'dayLand' }, key: 'lk' }, world: { key: 'wk' }, art: new Map([['img', { cv: { id: 'dayArt' }, lk: 'day' }]]), artByLight: new Map(), bakeMs: { plate: [] } };
  const ctx = {
    S, PLATE_K: [0, 1], performance: { now: () => 0 }, window: {},
    off: () => false, bakeKeys: () => ({ sig: 'sig', dpr: 1, hasArt: true, settled: true, img: { src: 'img' }, artWins: false }),
    journeyOf: () => 'J', lightKey: (api) => api.LIGHT.k, mkCanvas: () => ({ cv: SKY, g: {} }), pushMs: () => {},
    bakeSky: (api, dpr, into) => into.cv, bakeLand: () => null, bakeFar: () => null,
    flushBake: () => { log.kicks++; },
    artForLight: (api, img, dpr, split) => { log.swapAt.push(S.sky.cv.id); const cv = { id: 'art@' + api.LIGHT.k }; split.finish = () => { log.finishAt.push(S.sky.cv.id); return cv; }; return cv; },
  };
  vm.createContext(ctx);
  vm.runInContext(fnText(VISTA, 'primeStep') + '\nthis.ps = primeStep;', ctx);
  const api = { lightLerp: { id: 5 }, lightAt: (k) => ({ k: k ? 'night' : 'day' }), W: 100, H: 80 };
  ok(ctx.ps(api, 1, 'art') === false && log.swapAt.length === 0, 'the art step declines until the rung\'s sky is whole');
  for (let b = 0; b < 2; b++) ctx.ps(api, 1, 'sky', b, 2);
  ok(S.staged.sky[1] === SKY && S.sky.cv === DAYSKY, 'two sky bands make the rung sky whole; the steady sky is untouched');
  ok(ctx.ps(api, 1, 'art') === true && log.swapAt[0] === 'rungSky' && S.staged.artWip[1] && !S.staged.art[1] && log.kicks >= 3 && S.sky.cv === DAYSKY, 'the art step grades with the RUNG sky in S.sky.cv, kicks the recording, keeps it as work-in-progress, and puts the day sky back', JSON.stringify({ swap: log.swapAt, wip: !!S.staged.artWip[1], kicks: log.kicks }));
  ok(ctx.ps(api, 1, 'artB') === true && log.finishAt[0] === 'rungSky' && S.staged.art[1] && S.staged.art[1].id === 'art@night' && !S.staged.artWip[1] && S.sky.cv === DAYSKY && S.art.get('img').cv.id === 'dayArt', 'artB finishes over the rung sky, the night art is staged, the steady sky and art cache are restored', JSON.stringify({ fin: log.finishAt, art: S.staged.art[1] && S.staged.art[1].id }));
  ok(ctx.ps(api, 1, 'art') === true && ctx.ps(api, 1, 'artB') === true && log.swapAt.length === 1, 'both art steps are no-ops once the rung\'s art is staged');
}

/* ── the presets are untouched ────────────────────────────────────────────── */
ok(/night:\s*\{[^}]*rim:'#6f9ce8', body:'moon', disc:'#cfe0ff', haze:\.14 \}/.test(BB) && (BB.match(/body:'sun'/g) || []).length === 3, 'TIME_PRESETS colours as shipped (three suns, one moon)');
ok(/body: k>\.5 \? B\.body : A\.body/.test(fnText(BB, 'lightAtK')), 'lightAtK keeps the documented body step');

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
