/* ══════════════════════════════════════════════════════════════════════════
   🚚 DRIVE-AI-CONTROLPOINTS — does the AI actually fight for the SCP trucks?

   The control-point objective is already written into the AI's movement
   scorer, with a long comment claiming it works. This measures it, because a
   scoring term that is present and INEFFECTIVE is indistinguishable from one
   that is absent — and the comment itself quotes "ai max trucks ever held = 0"
   as the before, which is precisely the number this file recomputes.

   ⚠ THE AI IS DRIVEN, NOT SIMULATED. doAIStep runs on real timers against a
     real initGame board; this waits for aiBusy to clear rather than calling
     any private twin of the AI. A test of a twin is a test of the twin.

   ⚠ THE CONTROL IS AN A/B ON THE SAME BOARD, and it has to be, because "AI
     units were near the trucks" proves nothing on its own: trucks sit in open
     ground and units cross open ground. So the identical seeded battle is run
     twice — once with controlPoints seeded, once with the array EMPTIED before
     the AI moves — and the AI's occupancy of those same coordinates is
     compared. If both runs put the same number of bodies on the same tiles,
     the objective term is decoration and the board shape was doing the work.

   ⚠ THE CONTROL ARM IS NOISY AND THAT IS RECORDED, NOT HIDDEN. Across five
     runs the control arm measured 15, 12, 12, 15 and 1 unit-turns while the
     objective arm sat at 17-19. The spread is real — card draws, weather rolls
     and readiness rolls all move where units end up — so the threshold is a
     MARGIN (>= +25% and >= +3 bodies) rather than a bare `>`, which a one-body
     difference used to satisfy. If this file ever starts failing intermittently
     rather than consistently, raise the turn count before touching the bar:
     more samples is the honest fix, a lower bar is not.

   ⚠ IT IS A STOCHASTIC SYSTEM AND THE ASSERTION SAYS SO. Card draws, weather
     and readiness rolls are random, so this measures over several turns and
     asserts a MARGIN, not an exact figure. A flaky threshold that fails one run
     in five is worse than no test; the bar is set where the A/B gap is large.

   🔻 2026-08 · THIS FILE IS NOW INTERMITTENT AND HAS NOT BEEN RE-BASELINED.
     calculateDamage gained an opt-in deterministic AI estimate mode
     (opts.aiExpectedValue, set only by aiEstimateThreat and aiScoreAttack), so
     the AI stopped scoring attacks off a fresh dice roll and genuinely walks
     differently. Measured objective-vs-control ring traffic, 7 turns per arm:

         BEFORE the change   26v12 pass · 17v1 pass · 14v8 pass · 22v14 · 22v1
         AFTER  the change   15v13 FAIL · 17v12 pass · 13v14 FAIL

     The objective arm dropped (26/22/17/14 → 17/15/13) while the control arm
     stayed noisy, so the two arms now overlap. Following the note above, the
     turn count was doubled to 14 first — that did NOT fix it either (27v3 pass,
     then 26v31 FAIL, the control arm winning outright), so the doubling was
     REVERTED rather than left in as a change that bought nothing.
     ⚠ THE BAR WAS NOT LOWERED AND THE NUMBERS ABOVE ARE A HANDFUL OF RUNS, NOT
       A DISTRIBUTION. An honest re-baseline needs someone to measure the new
       spread properly and then decide whether ring traffic still discriminates
       at all. Until then this file reports a real behaviour change; it is not
       proof the objective term broke, and it is not proof it still works.

     ROUND 2 (the KO term in aiScoreAttack was fixed to test LANDED damage and
     scale the +800 by hit chance — see drive-ai-damage-determinism ARM E).
     Three more runs, same 7 turns per arm, measured AFTER that fix:

         24v2 pass · 14v16 FAIL · 12v12 FAIL     (maxHeld 1 · 1 · 2)

     STILL INTERMITTENT, and the KO fix did NOT rescue it — 1 of 3 runs passes
     the ring-traffic check, the same as before. The objective arm now spans
     12–24 against a control spanning 2–16, so the arms overlap almost
     completely and a single run decides nothing. The "hold-to-win count" check
     also failed 2 of 3 (maxHeld 1, needs 2). NOTHING WAS TUNED TO MAKE THIS
     PASS: the bar, the turn count and the board are all untouched. The
     conclusion of the note above is unchanged and now has 6 post-change runs
     behind it instead of 3 — at 7 turns this scenario does not discriminate,
     and re-baselining it means re-designing the measurement, not moving a
     threshold.

     ROUND 3 (the DEFENDER half of the same fix — aiEstimateThreat now carries
     LANDED damage up to the movement loop's suicide guard, which had gone
     silent against anything evasive; see drive-ai-damage-determinism ARM F).
     Three more runs, same 7 turns per arm, nothing in this file touched:

         19v2 pass · 17v13 pass · 14v13 FAIL     (maxHeld 2 · 2 · 2)

     Better than round 2 and still intermittent. Ring traffic passes 2 of 3
     rather than 1 of 3, and the HOLD-TO-WIN check — which failed 2 of 3 in
     round 2 with maxHeld 1 — now reaches 2 of 3 trucks on ALL THREE runs. That
     is the direction you would expect from a guard that stopped feeding units
     into lethal tiles: bodies that survive are bodies still standing in a ring.
     ⚠ THREE RUNS IS NOT A DISTRIBUTION AND THE BAR WAS NOT MOVED. The objective
     arm now spans 14–19 against a control spanning 2–13, which still overlaps,
     so a single run of the ring-traffic check decides nothing. The conclusion
     of the note above stands: re-baselining this file means re-designing the
     measurement, not adjusting a threshold, and nobody has done that yet.

   Run:  node .gauntlet/drive-ai-controlpoints.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8740 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof _cpSeedControlPoints === "function" && typeof initGame === "function"',
  null, { timeout: 200000 });
await pg.waitForTimeout(5000);

/* One scripted run. `keepCps` false empties the control-point array right after
   the board is built — same board, same units, same seeds, no objective. */
async function run(keepCps, turns) {
  await pg.evaluate(({ keepCps }) => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle';
    const s = App.state;

    /* 🔴 THE BOARD HAS TO HAVE UNITS ON IT, and the first version of this file
       did not check. initGame with an empty deck seeds TWO units — the two
       heroes — and the AI's hero is DELIBERATELY excluded from the objective
       ("walking it into the middle of the field to sit on a truck is how the AI
       throws the primary condition to win the secondary one"). So the run
       measured a board on which nothing was allowed to want a truck, got zero,
       and would have reported the feature broken. Bodies are placed the same
       way verify-ruins-cp places them. */
    const mk = (id, owner, pos) => ({
      id, owner, name: 'Drv ' + id, isHero: false, alive: true, pos,
      currentHp: 30, maxHp: 30, stats: { atk: 5, def: 5, spd: 3, mag: 0, res: 0 },
      statusEffects: [], hasMoved: false, hasAttacked: false,
      energy: 3, maxEnergy: 3, moves: [], elements: ['normal'],
    });
    const heroA = s.units.find(u => u.owner === 'ai' && u.isHero);
    const heroP = s.units.find(u => u.owner === 'player' && u.isHero);
    const free = (x, y) => !s.units.some(u => u.pos && u.pos.x === x && u.pos.y === y);
    let n = 0;
    // Four AI bodies parked beside their own hero — nowhere near a truck, so
    // any ring occupancy later is something they WALKED to.
    for (let dx = -2; dx <= 2 && n < 4; dx++) {
      for (let dy = -1; dy <= 1 && n < 4; dy++) {
        const x = heroA.pos.x + dx, y = heroA.pos.y + dy;
        if ((!dx && !dy) || x < 0 || y < 0 || !free(x, y)) continue;
        s.units.push(mk('ai' + (n++), 'ai', { x, y }));
      }
    }
    // Two player bodies by their hero, so the rings can genuinely be contested
    // and "strictly more units" is a question with two answers.
    let m = 0;
    for (let dx = -1; dx <= 1 && m < 2; dx++) {
      const x = heroP.pos.x + dx, y = heroP.pos.y;
      if (!dx || x < 0 || !free(x, y)) continue;
      s.units.push(mk('pl' + (m++), 'player', { x, y }));
    }
    window.__cpSeeded = { ai: n, player: m };

    // Remember where the trucks ARE in both arms, so the B arm can be measured
    // against the same coordinates it is not being told about.
    window.__cpSites = (s.controlPoints || []).map(c => ({ x: c.x, y: c.y }));
    if (!keepCps) s.controlPoints = [];
    window.__cpMaxHeld = 0;
    window.__cpRingBodies = 0;
    window.__cpTurns = 0;
  }, { keepCps });

  for (let t = 0; t < turns; t++) {
    /* The REAL handoff. endPlayerTurn runs startTurn(s,'ai') and hands control
       to the async AI loop; aiBusy is the signal it is still thinking. */
    /* ⚠ THE AI PHASE IS DRIVEN DIRECTLY, NOT THROUGH endPlayerTurn.
       Going through the real handoff ended the battle after ONE turn with
       gameOver:'player', both heroes alive, streak 0 and eight units standing —
       a turn-start victory sweep firing on this synthetic board, not anything
       the AI did. Rather than paper over it by clearing gameOver (which would
       be editing the game to make the test pass), the phase is entered the way
       doAIStep itself expects: it is the AI's turn, nothing has acted yet, go.
       ⚠ WHAT THIS COSTS, STATED: turn-start ticks do not run, so cpScore and
         cpStreak stay at zero here. This driver measures WHERE THE AI WALKS,
         which is the question. The scoring and the win condition are already
         covered by .gauntlet/verify-ruins-cp.mjs, which drives the real cycle
         and does not run the AI. Neither file covers both, and saying so is
         better than one of them pretending to. */
    await pg.evaluate(() => {
      const s = App.state; if (!s) return;
      s.turn = 'ai';
      for (const u of (s.units || [])) {
        if (u && u.owner === 'ai') { u.aiActed = false; u.hasMoved = false; u.hasAttacked = false; }
      }
      App.ui = App.ui || {};
      App.ui.aiBusy = true;
      try { scheduleAIStep(1); } catch (e) { App.ui.aiBusy = false; }
    });
    // Wait for the AI phase to finish, or give up on this turn.
    await pg.waitForFunction('!(App.ui && App.ui.aiBusy) || !App.state || App.state.gameOver',
      null, { timeout: 45000 }).catch(() => {});
    await pg.evaluate(() => {
      const s = App.state; if (!s) return;
      /* Measured against the SITES, not against s.controlPoints — the B arm has
         none, and the whole question is whether the AI stands on those tiles
         anyway. Same ring rule the game uses. */
      let bodies = 0, held = 0;
      for (const site of (window.__cpSites || [])) {
        let a = 0, p = 0;
        for (const u of (s.units || [])) {
          if (!u || !u.alive || !u.pos) continue;
          if (distance(u.pos, site) > CP_RING) continue;
          if (u.owner === 'ai') a++; else if (u.owner === 'player') p++;
        }
        bodies += a;
        if (a > p) held++;
      }
      window.__cpRingBodies += bodies;
      window.__cpMaxHeld = Math.max(window.__cpMaxHeld | 0, held);
      window.__cpTurns++;
      // No endAITurn either — same reason as the note above.
    });
    const over = await pg.evaluate(() => (!App.state ? { gone: true } : {
      over: !!App.state.gameOver, why: App.state.gameOver, streak: JSON.stringify(App.state.cpStreak || {}), score: JSON.stringify(App.state.cpScore || {}), units: (App.state.units||[]).filter(u=>u.alive).length,
      heroP: (App.state.units.find(u => u.owner === "player" && u.isHero) || {}).alive,
      heroA: (App.state.units.find(u => u.owner === "ai" && u.isHero) || {}).alive,
    }));
    if (over.gone || over.over) { console.log('    battle ended after turn ' + (t + 1) + ': ' + JSON.stringify(over)); break; }
  }
  return await pg.evaluate(() => ({
    maxHeld: window.__cpMaxHeld | 0,
    ringBodies: window.__cpRingBodies | 0,
    turns: window.__cpTurns | 0,
    sites: (window.__cpSites || []).length,
  }));
}

console.log('\n\u{1F69A} AI vs THE SCP TRUCKS\n');
console.log('  running A · trucks on the board…');
const A = await run(true, 7);
console.log('  running B · CONTROL, same board with the objective removed…');
const B = await run(false, 7);

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

console.log('');
ok('the board seeds three trucks', A.sites === 3, A.sites + ' sites');
ok('both arms actually ran', A.turns >= 3 && B.turns >= 3, 'A ' + A.turns + ' turns · B ' + B.turns + ' turns');

console.log('');
ok('\u{1F3AF} the AI HOLDS trucks — the figure the code comment says was 0',
  A.maxHeld >= 1, 'max held: ' + A.maxHeld + ' of ' + A.sites);
ok('\u{1F3AF} …and reaches the HOLD-TO-WIN count, so the objective is genuinely contested',
  A.maxHeld >= 2, 'max held: ' + A.maxHeld + ' (2 of 3 is the win threshold)');

/* ── CONTROL · the same board with no objective to chase ──────────────────
   📊 WHICH METRIC DISCRIMINATES, AND HOW THAT ANSWER CHANGED — recorded here
   because I got it wrong first and the wrong version passed.

   Both figures were measured across four runs, two before the gradient fix in
   the AI's _pull term and two after:

       before          ring traffic 16 vs 15, 13 vs 12     maxHeld  1
       after           ring traffic 17 vs 12, 18 vs 12     maxHeld  2 vs 2

   BEFORE the fix, ring traffic separated the arms by one unit-turn, which is
   noise — and a `>` assertion on it PASSED, which is exactly the vacuous check
   this project keeps having to delete. I nearly rewrote the file around
   maxHeld on the strength of that.

   AFTER the fix, ring traffic separates cleanly and repeatedly (~45%), while
   maxHeld SATURATES at 2 in both arms: the trucks sit in open ground between
   the starting lines, so on this board the AI's units end up momentarily
   holding two of them on their way to the hero whether or not they were aiming
   for anything. maxHeld is the better statement of "the objective is
   contested"; it is the worse discriminator.

   So the A/B rests on ring traffic with a MARGIN, not a bare `>` — a one-body
   difference must not pass — and maxHeld is asserted only as an absolute. */
console.log('\n  ── CONTROL · the same board with no objective to chase');
ok('\u{1F3AF} the AI crowds the capture rings materially MORE when the trucks are real',
  A.ringBodies >= Math.ceil(B.ringBodies * 1.25) && A.ringBodies - B.ringBodies >= 3,
  'objective ' + A.ringBodies + ' vs control ' + B.ringBodies + ' unit-turns' +
  ' (needs ≥ +25% and ≥ +3 — a one-body edge is noise and used to pass)');
console.log('     (maxHeld, reported not asserted — saturates at 2 in BOTH arms on this board: ' +
  A.maxHeld + ' vs ' + B.maxHeld + ')');

console.log('\npage errors: ' + errs.length); errs.slice(0, 5).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
